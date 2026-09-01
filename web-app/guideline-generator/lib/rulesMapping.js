/**
 * rulesMapping.js
 *
 * Loads the trilingual Rules Mapping Excel (templates/Rules Mapping.xlsx)
 * and provides a lookup function: given a target language, returns a
 * same-language version of the ruleRegistry englishText entries.
 *
 * Sheet: "Ruels Mapping"
 * Row 2: headers (B=English, C=Chinese, D=Japanese)
 * Row 3+: data rows
 */

const path = require('path');
const ExcelJS = require('exceljs');

const MAPPING_FILE = path.join(__dirname, '..', 'templates', 'Rules Mapping.xlsx');
const SHEET_NAME = 'Ruels Mapping';

let _cache = null;

/**
 * Load and cache the mapping table.
 * Returns { enToZh: Map<en, zh>, enToJa: Map<en, ja> }
 */
async function loadMapping() {
  if (_cache) return _cache;

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(MAPPING_FILE);
  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) throw new Error(`Sheet "${SHEET_NAME}" not found in Rules Mapping.xlsx`);

  const enToZh = new Map();
  const enToJa = new Map();

  // Row 2 is the header row; data starts at row 3
  ws.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return;
    const en = (row.getCell('B').value || '').toString().trim();
    const zh = (row.getCell('C').value || '').toString().trim();
    const ja = (row.getCell('D').value || '').toString().trim();
    if (en) {
      // Normalize key: lowercase, strip trailing period for flexible matching
      const key = en.toLowerCase().replace(/\.$/, '');
      if (zh) enToZh.set(key, zh);
      if (ja) enToJa.set(key, ja);
    }
  });

  _cache = { enToZh, enToJa };
  console.log(`[rulesMapping] Loaded ${enToZh.size} zh / ${enToJa.size} ja mappings`);
  return _cache;
}

/**
 * Given ruleRegistry targets [{id, text}] (English) and a target language,
 * returns same-language targets [{id, text}] where text has been translated.
 * Entries without a translation are kept in English as fallback.
 *
 * language: 'en' | 'zh' | 'ja'
 */
async function getTargetsForLanguage(targets, language) {
  if (language === 'en') return targets;

  const { enToZh, enToJa } = await loadMapping();
  const lookup = language === 'zh' ? enToZh : enToJa;

  return targets.map(t => ({
    id: t.id,
    // Normalize lookup key: lowercase, strip trailing period
    text: lookup.get(t.text.toLowerCase().replace(/\.$/, '')) || t.text,
  }));
}

module.exports = { loadMapping, getTargetsForLanguage };
