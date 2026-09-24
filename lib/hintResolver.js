/**
 * hintResolver.js
 *
 * Calls app.py /chat_hints to dynamically resolve cXML element positions
 * for a set of triggered rules, using SAP Help MCP documentation.
 *
 * Returns a Map<ruleId, cxmlHint> for use in buildDescriptionMap.
 *
 * Cache: keyed by (docType + subType + sorted ruleIds).
 * Same combination within a session reuses the cached result — no repeat API calls.
 */

const http = require('http');

const SAP_HELP_HOST = '127.0.0.1';
const SAP_HELP_PORT = 5001;
const SAP_HELP_PATH = '/chat_hints';

const API_KEY  = process.env.EDI_API_KEY  || '0399a7b7-c66d-4453-9803-b0e0ebe38b28';
const BASE_URL = process.env.EDI_BASE_URL || 'http://localhost:6655';

// In-process cache: cacheKey → Map<ruleId, hint>
const _cache = new Map();

function cacheKey(subTypeInfo, ruleIds) {
  return `${subTypeInfo.docType}::${subTypeInfo.subType}::${[...ruleIds].sort().join(',')}`;
}

/**
 * Resolve cXML element hints for a list of triggered rules.
 *
 * @param {object}   subTypeInfo   - from detectSubtype(): { docType, subType, chapters, notes }
 * @param {Array}    triggeredRules - [{ ruleId, ruleText, cxmlElement }] — rules that fired isYes
 * @param {string}   cxmlContent   - the actual uploaded cXML content
 * @param {string}   language      - 'en' | 'zh' | 'ja'
 * @returns {Map<ruleId, string>}  - ruleId → resolved cXML hint string
 */
async function resolveHints(subTypeInfo, triggeredRules, cxmlContent, language) {
  if (!triggeredRules || triggeredRules.length === 0) return new Map();

  const ruleIds = triggeredRules.map(r => r.ruleId);
  const key = cacheKey(subTypeInfo, ruleIds);

  if (_cache.has(key)) {
    console.log(`[hintResolver] cache hit for ${key.slice(0, 60)}`);
    return _cache.get(key);
  }

  const body = JSON.stringify({
    api_key:  API_KEY,
    base_url: BASE_URL,
    subtype_info: subTypeInfo,
    triggered_rules: triggeredRules.map(r => ({
      rule_id: r.ruleId,
      rule_text: r.ruleText || r.description || r.ruleId,
    })),
    cxml_content: cxmlContent,
    language,
  });

  let rawData;
  try {
    rawData = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: SAP_HELP_HOST,
          port: SAP_HELP_PORT,
          path: SAP_HELP_PATH,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 3000,
        },
        (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => resolve(data));
        }
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('hint resolver timeout')); });
      req.write(body);
      req.end();
    });
  } catch (err) {
    console.error('[hintResolver] HTTP error:', err.message);
    return new Map();
  }

  let parsed;
  try {
    parsed = JSON.parse(rawData);
  } catch (e) {
    console.error('[hintResolver] JSON parse error:', rawData.slice(0, 200));
    return new Map();
  }

  if (parsed.error) {
    console.error('[hintResolver] service error:', parsed.error);
    return new Map();
  }

  // parsed.hints: { ruleId: cxmlHintString, ... }
  const result = new Map(Object.entries(parsed.hints || {}));
  console.log(`[hintResolver] resolved ${result.size} hints for ${subTypeInfo.subType}`);

  _cache.set(key, result);
  return result;
}

module.exports = { resolveHints };
