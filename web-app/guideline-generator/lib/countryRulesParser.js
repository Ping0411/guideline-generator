/**
 * countryRulesParser.js
 *
 * Parses the Country/Region Based Invoice Rules file.
 * Supported formats: Excel (.xlsx/.xls), CSV (.csv), HTML (.html/.htm), PDF (.pdf)
 *
 * Always reads the "Applied" column (first value column after the rule name).
 *
 * Returns: Map<ruleText_normalized, { rule, isYes, isNo, raw }>
 */

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const YES_VALUES = new Set(['yes', '是', 'はい', 'y', 'true', '1']);
const NO_VALUES  = new Set(['no',  '否', 'いいえ', 'n', 'false', '0']);

function normalizeKey(text) {
  return (text || '').trim()
    .replace(/\s*loading\.\.\.\s*$/i, '')  // strip SBN lazy-load artifact
    .toLowerCase()
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

/**
 * Return true if the given section header text is the Blanket PO Invoice Rules section.
 */
function isBlanketSectionHeader(text) {
  return /blanket purchase order invoice rules/i.test(text);
}

/**
 * Return true if the given full row text signals the end of the blanket section.
 * Condition: "Invoice Payment Rules" appears, OR the row contains both "Applied" and "Default"
 * (i.e. it is a new section header row).
 */
function isEndOfBlanketSection(rowText) {
  if (/invoice payment rules/i.test(rowText)) return true;
  return /applied/i.test(rowText) && /default/i.test(rowText);
}

/**
 * Build result map from array of [ruleText, appliedValue] pairs.
 */
function buildMap(pairs) {
  const map = new Map();
  for (const [ruleText, appliedRaw] of pairs) {
    if (!ruleText) continue;
    const cleaned = ruleText.trim().replace(/\s*loading\.\.\.\s*$/i, '').trim();
    const key = normalizeKey(cleaned);
    const { isYes, isNo, raw } = parseValue(appliedRaw);
    map.set(key, { rule: cleaned, isYes, isNo, raw });
  }
  return map;
}

// ── Excel parser ────────────────────────────────────────────────────────────
async function parseExcel(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet = wb.worksheets[0];

  // Find the header row: look for a cell containing "Applied" (case-insensitive)
  let appliedCol = -1;
  let ruleCol = -1;
  let headerRowNum = -1;

  sheet.eachRow((row, rowNum) => {
    if (headerRowNum >= 0) return;
    row.eachCell((cell, colNum) => {
      const text = (cell.text || '').trim().toLowerCase();
      if (text === 'applied') { appliedCol = colNum; headerRowNum = rowNum; }
      if (text === 'general invoice rules' || text === 'rule' || colNum === 1 && text) {
        if (ruleCol < 0) ruleCol = colNum;
      }
    });
  });

  // Fallback: assume col 1 = rule, col 2 = Applied
  if (appliedCol < 0) appliedCol = 2;
  if (ruleCol < 0) ruleCol = 1;

  const pairs = [];
  let inBlanket = false;

  sheet.eachRow((row, rowNum) => {
    if (rowNum <= headerRowNum) return;
    const ruleText = (row.getCell(ruleCol).text || '').trim();
    const appliedVal = (row.getCell(appliedCol).text || '').trim();
    if (!ruleText) return;
    // Detect section transitions — build full row text for end-of-blanket check
    const rowText = row.values.map(v => (v || '').toString()).join(' ');
    if (isBlanketSectionHeader(ruleText)) { inBlanket = true; return; }
    if (inBlanket && isEndOfBlanketSection(rowText)) { inBlanket = false; }
    if (inBlanket) return;
    if (appliedVal) pairs.push([ruleText, appliedVal]);
  });

  return buildMap(pairs);
}

// ── CSV parser ───────────────────────────────────────────────────────────────
function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim());

  let appliedColIdx = -1;
  let ruleColIdx = 0;
  let inBlanket = false;
  const pairs = [];

  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.replace(/^"|"$/g, '').trim());
    if (appliedColIdx < 0) {
      const idx = cols.findIndex(c => c.toLowerCase() === 'applied');
      if (idx >= 0) { appliedColIdx = idx; continue; }
      continue;
    }
    const ruleText = cols[ruleColIdx] || '';
    const appliedVal = cols[appliedColIdx] || '';
    if (!ruleText) continue;
    if (isBlanketSectionHeader(ruleText)) { inBlanket = true; continue; }
    if (inBlanket && isEndOfBlanketSection(lines[i])) { inBlanket = false; }
    if (inBlanket) continue;
    if (appliedVal) pairs.push([ruleText, appliedVal]);
  }

  // Fallback: no "Applied" header found — assume col 0 = rule, col 1 = Applied
  if (appliedColIdx < 0) {
    for (const line of lines) {
      const cols = line.split(',').map(c => c.replace(/^"|"$/g, '').trim());
      if (cols[0] && cols[1]) pairs.push([cols[0], cols[1]]);
    }
  }

  return buildMap(pairs);
}

// ── HTML parser ──────────────────────────────────────────────────────────────
function parseHtml(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  // Strip scripts and styles
  const clean = content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Extract all <tr> blocks
  const trMatches = [...clean.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

  let appliedColIdx = -1;
  let ruleColIdx = 0;
  let inBlanket = false;
  const pairs = [];

  function cellText(html) {
    // Strip inline scripts first (e.g. SBN lazy-load JS inside <td>)
    const noInlineScript = html.replace(/if\s*\(\s*ariba[\s\S]*?(?=<|$)/gi, '');
    return noInlineScript
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#[0-9]+;/g, '')
      .replace(/Loading\.\.\./gi, '')   // strip any remaining lazy-load placeholder
      .replace(/\s+/g, ' ')
      .trim();
  }

  for (const trMatch of trMatches) {
    const trHtml = trMatch[1];
    const cells = [...trHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => cellText(m[1]));

    if (!cells.length) continue;

    // If this row contains "Applied" as a cell, treat it as a section header row
    const headerIdx = cells.findIndex(c => c.toLowerCase() === 'applied');
    if (headerIdx >= 0) {
      appliedColIdx = headerIdx;
      ruleColIdx = 0;
      const sectionText = cells[0] || '';
      const rowText = cells.join(' ');
      if (isBlanketSectionHeader(sectionText)) { inBlanket = true; }
      else if (inBlanket && isEndOfBlanketSection(rowText)) { inBlanket = false; }
      continue;
    }

    // Skip rows before any header is found
    if (appliedColIdx < 0) continue;
    if (inBlanket) continue;

    const ruleText = cells[ruleColIdx] || '';
    const appliedVal = cells[appliedColIdx] || '';
    if (ruleText && appliedVal) pairs.push([ruleText, appliedVal]);
  }

  return buildMap(pairs);
}

// ── PDF parser ───────────────────────────────────────────────────────────────
function parsePdf(filePath) {
  let text;
  try {
    text = execSync(`/opt/homebrew/bin/pdftotext -layout "${filePath}" -`, { encoding: 'utf8' });
  } catch (err) {
    throw new Error(`pdftotext failed: ${err.message}`);
  }

  const pairs = [];
  let inBlanket = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    // Detect section transitions (section headers don't have Yes/No values)
    if (isBlanketSectionHeader(trimmed)) { inBlanket = true; continue; }
    if (inBlanket && isEndOfBlanketSection(trimmed)) { inBlanket = false; }
    if (inBlanket) continue;
    // Match: rule text followed by 2+ spaces, then Yes or No
    const m = line.match(/^(.+?)\s{2,}(Yes|No)\b/i);
    if (!m) continue;
    const ruleText = m[1].trim();
    const appliedVal = m[2].trim();
    if (ruleText.toLowerCase() === 'general invoice rules' || ruleText.toLowerCase() === 'rule') continue;
    // Skip continuation lines: lines starting with a lowercase letter or '(' are
    // the tail of a wrapped rule from the previous line, not a new rule.
    if (/^[a-z(]/.test(ruleText)) continue;
    // Skip lines that are clearly not rule sentences: a valid rule starts with a
    // recognised action verb, a digit (e.g. tax rate "8% Consumption Tax"), or
    // a known noun phrase ("Default Bill To Address", "W. L. Gore…" etc).
    // Reject lines that start with a preposition/article/conjunction or a
    // mid-sentence fragment (e.g. "To information if available", "Business Network").
    if (/^(To|In|Or|And|For|Of|With|From|On|At|By|As|If|The|A |An )\b/.test(ruleText)) continue;
    pairs.push([ruleText, appliedVal]);
  }

  return buildMap(pairs);
}

// ── Main entry ───────────────────────────────────────────────────────────────
async function parseCountryRules(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();

  let result;
  if (ext === '.xlsx' || ext === '.xls') result = await parseExcel(filePath);
  else if (ext === '.csv') result = parseCsv(filePath);
  else if (ext === '.html' || ext === '.htm') result = parseHtml(filePath);
  else if (ext === '.pdf') result = parsePdf(filePath);
  else {
    const sample = fs.readFileSync(filePath, 'utf8').slice(0, 500);
    result = (sample.includes('<html') || sample.includes('<!DOCTYPE')) ? parseHtml(filePath) : parseCsv(filePath);
  }

  console.log(`[countryRulesParser] parsed ${result.size} rules from ${ext || 'unknown'}`);
  for (const [key, entry] of result) {
    console.log(`  [rule] "${entry.rule.slice(0, 70)}" → ${entry.isYes ? 'YES' : entry.isNo ? 'NO' : '?'}`);
  }
  return result;
}

module.exports = { parseCountryRules };
