/**
 * Parses a Transaction Rules Excel file and returns a normalized map.
 * Supports zh_CN (是/否), en (Yes/No), ja (はい/いいえ).
 *
 * Returns: Map<ruleKey, { section, rule, subrule1, subrule2, value, isYes, isNo, matchedId? }>
 * ruleKey = normalized lowercase of Business Rule + Subrule1 + Subrule2
 */

const ExcelJS = require('exceljs');
const { loadMapping } = require('./rulesMapping');
const { getRulesForDocType } = require('./ruleRegistry');

const YES_VALUES = new Set(['yes', '是', 'はい', 'y', 'true', '1']);
const NO_VALUES  = new Set(['no',  '否', 'いいえ', 'n', 'false', '0']);

function normalizeKey(...parts) {
  return parts
    .map(p => (p || '').trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('|');
}

// Normalize a single string for fuzzy matching: lowercase, strip punctuation, collapse spaces
function normText(s) {
  return (s || '').trim().toLowerCase()
    .replace(/[。．、，,.!！?？。:：;；]/g, '')
    .replace(/\s+/g, ' ');
}

function parseValue(raw) {
  const v = (raw || '').trim().toLowerCase();
  return {
    isYes: YES_VALUES.has(v),
    isNo:  NO_VALUES.has(v),
    raw:   (raw || '').trim(),
  };
}

// Detect dominant language of uploaded rules (same logic as vectorMatcher)
function detectRulesLanguage(rulesMap) {
  let jaCount = 0, cjkCount = 0, total = 0;
  for (const [, e] of rulesMap) {
    const t = e.rule || '';
    total++;
    if (/[぀-ヿ]/.test(t)) jaCount++;
    else if (/[一-鿿]/.test(t)) cjkCount++;
  }
  if (total === 0) return 'en';
  if (jaCount / total > 0.2) return 'ja';
  if (cjkCount / total > 0.2 || jaCount + cjkCount > total * 0.2) return 'zh';
  return 'en';
}

/**
 * Assign matchedId to each entry in rulesMap by:
 * 1. Building a reverse lookup: translated-text → ruleId  (from rulesMapping + ruleRegistry)
 * 2. For each uploaded rule, normalize its text and look it up
 *
 * This allows descriptionEngine to work without the vector service (port 7655).
 */
async function assignMatchedIds(rulesMap) {
  const lang = detectRulesLanguage(rulesMap);
  if (lang === 'en') {
    // English rules: match directly against ruleRegistry englishText
    const allRules = ['OC', 'ASN', 'Invoice', 'PO'].flatMap(d => getRulesForDocType(d));
    for (const [, entry] of rulesMap) {
      const entryNorm = normText(entry.rule);
      for (const ruleDef of allRules) {
        if (normText(ruleDef.englishText) === entryNorm) {
          entry.matchedId = ruleDef.id;
          break;
        }
      }
    }
    return;
  }

  // Non-English: build reverse map  translated-norm → { id, enText }
  const { enToZh, enToJa } = await loadMapping();
  const lookup = lang === 'ja' ? enToJa : enToZh;

  // Build: translated-norm → ruleId
  const allRules = ['OC', 'ASN', 'Invoice', 'PO'].flatMap(d => getRulesForDocType(d));
  const translatedToId = new Map(); // normText(translated) → ruleId
  for (const ruleDef of allRules) {
    const enKey = ruleDef.englishText.toLowerCase().replace(/\.$/, '');
    const translated = lookup.get(enKey);
    if (translated) {
      translatedToId.set(normText(translated), ruleDef.id);
    }
    // Also index by English in case some rows are in English
    translatedToId.set(normText(ruleDef.englishText), ruleDef.id);
  }

  let matched = 0;
  for (const [, entry] of rulesMap) {
    const key = normText(entry.rule);
    const id = translatedToId.get(key);
    if (id) {
      entry.matchedId = id;
      matched++;
    }
  }
  console.log(`[rulesParser] assignMatchedIds (${lang}): ${matched}/${rulesMap.size} matched`);
}

async function parseTransactionRules(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const sheet = wb.worksheets[0];
  const rules = new Map();

  sheet.eachRow((row, rowNum) => {
    if (rowNum <= 4) return; // skip headers

    const section  = (row.getCell(1).text || '').trim();
    const rule     = (row.getCell(2).text || '').trim();
    const sub1     = (row.getCell(3).text || '').trim();
    const sub2     = (row.getCell(4).text || '').trim();
    const rawVal   = (row.getCell(5).text || '').trim();

    if (!rule) return;

    const key = normalizeKey(rule, sub1, sub2);
    const { isYes, isNo, raw } = parseValue(rawVal);

    rules.set(key, { section, rule, subrule1: sub1, subrule2: sub2, value: raw, isYes, isNo });
  });

  await assignMatchedIds(rules);

  return rules;
}

/**
 * Look up a rule by its English rule text (partial match supported).
 * Rules file may be in any language, so we also index by row position via
 * a secondary positional map built on first parse.
 *
 * For cross-language matching we use a known English→position registry
 * defined in ruleRegistry.js and matched by row order.
 */
function getRuleValue(rulesMap, englishRuleText, sub1 = '', sub2 = '') {
  const key = normalizeKey(englishRuleText, sub1, sub2);
  if (rulesMap.has(key)) return rulesMap.get(key);

  // Fallback: partial match on rule text
  for (const [, entry] of rulesMap) {
    const entryKey = normalizeKey(entry.rule, entry.subrule1, entry.subrule2);
    if (entryKey.includes(normalizeKey(englishRuleText))) return entry;
  }
  return null;
}

module.exports = { parseTransactionRules, getRuleValue, assignMatchedIds };
