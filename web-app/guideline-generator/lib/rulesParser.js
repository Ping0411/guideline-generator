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
    // Build a map first to collect all matching ruleIds per normalized text
    const allRules = ['OC', 'ASN', 'Invoice', 'PO'].flatMap(d => getRulesForDocType(d));
    const enTextToIds = new Map(); // normText(englishText) → ruleId[]
    for (const ruleDef of allRules) {
      const key = normText(ruleDef.englishText);
      const existing = enTextToIds.get(key) || [];
      existing.push(ruleDef.id);
      enTextToIds.set(key, existing);
    }
    for (const [, entry] of rulesMap) {
      const entryNorm = normText(entry.rule);
      const ids = enTextToIds.get(entryNorm);
      if (ids && ids.length > 0) {
        entry.matchedId = ids[0];
        entry.matchedIds = ids;
      }
    }
    return;
  }

  // Non-English: build reverse map  translated-norm → { id, enText }
  const { enToZh, enToJa } = await loadMapping();
  const lookup = lang === 'ja' ? enToJa : enToZh;

  // Build: translated-norm → ruleId[] (array to handle same text mapping to multiple docTypes)
  const allRules = ['OC', 'ASN', 'Invoice', 'PO'].flatMap(d => getRulesForDocType(d));
  const translatedToIds = new Map(); // normText(translated) → ruleId[]
  for (const ruleDef of allRules) {
    const enKey = normText(ruleDef.englishText);
    const translated = lookup.get(enKey);
    if (translated) {
      const tKey = normText(translated);
      const existing = translatedToIds.get(tKey) || [];
      existing.push(ruleDef.id);
      translatedToIds.set(tKey, existing);
    }
    // Also index by English in case some rows are in English
    const eKey = normText(ruleDef.englishText);
    const existingEn = translatedToIds.get(eKey) || [];
    if (!existingEn.includes(ruleDef.id)) existingEn.push(ruleDef.id);
    translatedToIds.set(eKey, existingEn);
  }

  let matched = 0;
  for (const [, entry] of rulesMap) {
    const key = normText(entry.rule);
    const ids = translatedToIds.get(key);
    if (ids && ids.length > 0) {
      entry.matchedId = ids[0];   // primary (first match)
      entry.matchedIds = ids;     // all matches (for multi-docType rules)
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

    // If this key already exists from a non-BPO section, do not overwrite it with a BPO entry.
    // BPO (Blanket PO) invoice rules are excluded from matching; the non-BPO entry takes priority.
    const isBpo = section.toLowerCase().includes('blanket') ||
                  section.includes('包括注文書') ||
                  section.includes('一揽子订购单');
    if (isBpo && rules.has(key)) return;

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
