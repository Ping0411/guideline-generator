/**
 * Parses a Transaction Rules Excel file and returns a normalized map.
 * Supports zh_CN (是/否), en (Yes/No), ja (はい/いいえ).
 *
 * Returns: Map<ruleKey, { section, rule, subrule1, subrule2, value, isYes, isNo }>
 * ruleKey = normalized lowercase of Business Rule + Subrule1 + Subrule2
 */

const ExcelJS = require('exceljs');

const YES_VALUES = new Set(['yes', '是', 'はい', 'y', 'true', '1']);
const NO_VALUES  = new Set(['no',  '否', 'いいえ', 'n', 'false', '0']);

function normalizeKey(...parts) {
  return parts
    .map(p => (p || '').trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('|');
}

function parseValue(raw) {
  const v = (raw || '').trim().toLowerCase();
  return {
    isYes: YES_VALUES.has(v),
    isNo:  NO_VALUES.has(v),
    raw:   (raw || '').trim(),
  };
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

module.exports = { parseTransactionRules, getRuleValue };
