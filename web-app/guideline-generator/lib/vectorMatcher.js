/**
 * vectorMatcher.js
 *
 * Replaces Claude API semantic matching with local vector similarity.
 * Calls the /match endpoint on the SAP Help MCP semantic search service
 * (semantic_search.py --serve, default port 7655).
 *
 * The service uses paraphrase-multilingual-MiniLM-L12-v2, which handles
 * cross-language matching (zh/ja/en) with no API cost.
 */

const http = require('http');
const { getTargetsForLanguage } = require('./rulesMapping');

const MATCH_SERVICE_HOST = '127.0.0.1';
const MATCH_SERVICE_PORT = 7655;
const MATCH_THRESHOLD = 0.65;

/**
 * Detect the dominant language of rule texts from parsedRules.
 * Returns 'zh', 'ja', or 'en'.
 */
function detectRulesLanguage(entries) {
  let cjkCount = 0;
  let jaUniqueCount = 0;
  let total = 0;

  for (const entry of entries) {
    const text = entry.rule || '';
    total++;
    // Japanese-unique: hiragana or katakana
    if (/[぀-ヿ]/.test(text)) jaUniqueCount++;
    // CJK unified ideographs (shared by zh/ja)
    else if (/[一-鿿]/.test(text)) cjkCount++;
  }

  if (total === 0) return 'en';
  const jaRatio = jaUniqueCount / total;
  const zhRatio = cjkCount / total;
  if (jaRatio > 0.2) return 'ja';
  if (zhRatio > 0.2 || jaUniqueCount + cjkCount > total * 0.2) return 'zh';
  return 'en';
}

/**
 * Call /match on the semantic search service.
 * candidates: string[]        — rule texts from uploaded file (any language)
 * targets:    {id, text}[]    — ruleRegistry entries (English)
 *
 * Returns: Map<candidateIndex, targetId>
 */
async function callMatchService(candidates, targets) {
  const body = JSON.stringify({ candidates, targets, threshold: MATCH_THRESHOLD });

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: MATCH_SERVICE_HOST,
        port: MATCH_SERVICE_PORT,
        path: '/match',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const results = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(new Error(`Match service error: ${data}`));
              return;
            }
            // Return full results including score: [{ candidateIndex, targetId, score }]
            resolve(results);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Section keywords that are relevant per docType.
 * Candidates whose section matches EXCLUDED_SECTIONS[docType] are dropped before matching.
 *
 * Strategy: define which sections to EXCLUDE for each docType so that
 * cross-category mismatches (e.g. OC rules matching Invoice targets) are prevented.
 */
const INCLUDE_SECTIONS = {
  OC:      ['order confirmation and ship notice rules'],
  ASN:     ['order confirmation and ship notice rules'],
  // Invoice: split into primary (non-blanket) and fallback (blanket) — see matchRules
  Invoice: [
    'general invoice rules',
    'invoice address rules',
    'invoice payment rules',
    'online invoice form rules',
    'po invoice field rules',
    'po and non-po invoice field rules',
    'vat rules',
  ],
  // PO: driven by question answers, not transaction rules — no section filter needed
};

/**
 * Filter parsedRules to only candidates relevant to the given docType.
 * If no INCLUDE_SECTIONS mapping exists for docType, returns all entries.
 */
function filterCandidatesByDocType(parsedRules, docType) {
  const allowed = INCLUDE_SECTIONS[docType];
  if (!allowed) return [...parsedRules.values()];

  return [...parsedRules.values()].filter(e => {
    if (!e.section) return true;
    const sec = e.section.trim().toLowerCase();
    return allowed.some(a => sec.includes(a) || a.includes(sec));
  });
}

/**
 * Run one round of matching and return a scoreMap: targetId → { ruleEntry, score }.
 * targets here may already be in the same language as candidates.
 */
async function runMatchRound(candidateEntries, targets, label) {
  if (candidateEntries.length === 0) return new Map();
  const candidates = candidateEntries.map(e => e.rule);
  let matchResults;
  try {
    matchResults = await callMatchService(candidates, targets);
    console.log(`[vectorMatcher] ${label}: ${candidates.length} candidates × ${targets.length} targets → ${matchResults.length} matches`);
    for (const { candidateIndex, targetId, score } of matchResults) {
      console.log(`  matched: "${candidates[candidateIndex].slice(0, 50)}" → ${targetId} (score=${score})`);
    }
  } catch (err) {
    console.error(`[vectorMatcher] ${label} failed:`, err.message);
    return new Map();
  }

  const scoreMap = new Map();
  for (const { candidateIndex, targetId, score } of matchResults) {
    const ruleEntry = candidateEntries[candidateIndex];
    const existing = scoreMap.get(targetId);
    // Prefer higher score; on tie (or near-tie within 0.01), prefer earlier row in file
    if (!existing || score > existing.score + 0.01 ||
        (score >= existing.score - 0.01 && candidateIndex < existing.candidateIndex)) {
      scoreMap.set(targetId, { ruleEntry, score, candidateIndex });
    }
  }
  return scoreMap;
}

/**
 * Match parsedRules entries against ruleRegistry definitions using vector similarity.
 *
 * For Invoice docType: two-round matching —
 *   Round 1: non-Blanket Invoice sections (primary, takes precedence)
 *   Round 2: Blanket Purchase Order Invoice Rules (fallback, only fills gaps)
 *
 * parsedRules: Map<key, { rule, isYes, isNo, section, ... }>  — from rulesParser
 * ruleDefs:    Array<{ id, englishText, ... }>                 — from ruleRegistry
 * docType:     string — used to filter candidates by section
 *
 * Returns: Map<ruleId, ruleEntry>
 */
async function matchRules(parsedRules, ruleDefs, docType) {
  if (parsedRules.size === 0 || ruleDefs.length === 0) return new Map();

  // Detect language of uploaded rules and get same-language targets
  const allEntries = [...parsedRules.values()];
  const rulesLang = detectRulesLanguage(allEntries);
  console.log(`[vectorMatcher] Detected rules language: ${rulesLang}`);

  const englishTargets = ruleDefs.map(r => ({ id: r.id, text: r.englishText }));
  const targets = await getTargetsForLanguage(englishTargets, rulesLang);

  if (docType === 'Invoice') {
    // Only match non-Blanket Invoice sections; blanket rules are always ignored
    const primaryEntries = filterCandidatesByDocType(parsedRules, docType);
    const scoreMap = await runMatchRound(primaryEntries, targets, 'Invoice primary');
    const result = new Map();
    for (const [targetId, { ruleEntry }] of scoreMap) {
      result.set(targetId, ruleEntry);
    }
    return result;
  }

  // Non-Invoice: single round
  const candidateEntries = filterCandidatesByDocType(parsedRules, docType);
  if (candidateEntries.length === 0) return new Map();
  const scoreMap = await runMatchRound(candidateEntries, targets, docType);

  const result = new Map();
  for (const [targetId, { ruleEntry }] of scoreMap) {
    result.set(targetId, ruleEntry);
  }
  return result;
}

module.exports = { matchRules };
