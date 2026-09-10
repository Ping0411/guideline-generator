/**
 * readmeExtractor.js
 *
 * Extracts the correct language section from the READ ME sheet of the template.
 * Splits by marker text (not row numbers) so content changes don't break logic.
 *
 * Markers:
 *   Chinese section starts at row containing "(Chinese)"
 *   Japanese section starts at row containing "(Japanese)"
 *
 * Returns array of row objects: [{ originalRowNum, cells, merges }]
 *   cells:  [{colNum, value, style}] — master cells only (slave cells excluded)
 *   merges: string[] — merge refs relative to this section (e.g. 'A1:S1')
 */

// Returns the plain text of a row's first cell (works for string and richText)
function cellText(row) {
  const v = row.getCell(1).value;
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (v.richText) return v.richText.map(r => r.text).join('');
  return String(v);
}

// Returns true if this row is the start of the "Column C" block to remove
function isColumnCStart(text) {
  return /^Column\s+C\b/.test(text) || /^C列/.test(text);
}

// Returns true if this row is the start of the "Column D — ANSI X12 EDI" block to remove
// Must NOT match "Column D onwards" (that's the Country-Based Rules block)
function isColumnDEdiStart(text) {
  return (/^Column\s+D\s+—/.test(text) || /^D列\s+—/.test(text)) &&
         !text.includes('onwards') && !text.includes('以降') && !text.includes('以后');
}

// Returns true if this row is the "Column C" anchor (stop-before when removing Column D/E block)
function isColumnCAnchor(text) {
  return /^Column\s+C\b/.test(text) || /^C列/.test(text);
}

// Returns true if this row is the "EDI D96A supplemental" block start
function isEdiSupplementalStart(text) {
  return /^EDI D96A/.test(text);
}

// Returns true if this row is the "Legend" anchor (stop-before when removing EDI supplemental block)
function isLegendAnchor(text) {
  return /^Legend\b/.test(text);
}

// Strip EDI reference from the title row (first row of each language section)
// EN: "cXML and ANSI X12 EDI Transaction Samples" → "cXML Transaction Samples"
// ZH: "cXML 和 EDI 交易示例"                      → "cXML 交易示例"
// JA: "cXML および EDI トランザクションサンプル"   → "cXML トランザクションサンプル"
function stripEdiFromTitle(value) {
  if (typeof value === 'string') {
    return value
      .replace(/\s+and ANSI X12 EDI\s+/, ' ')
      .replace(/\s+和 EDI\s+/, ' ')
      .replace(/\s+および EDI\s+/, ' ')
      .replace(/  +/, ' ')
      .trim();
  }
  if (value && value.richText) {
    const joined = value.richText.map(r => r.text).join('');
    const stripped = stripEdiFromTitle(joined);
    // Rebuild as single plain richText segment preserving first run's font
    return { richText: [{ ...value.richText[0], text: stripped }] };
  }
  return value;
}
// Returns true if this row is the "Extrinsic fields Tab" anchor (stop-before this row)
function isExtrinsicAnchor(text) {
  return text.includes('Extrinsic fields Tab') ||
         text.includes('Extrinsic表单') ||
         text.includes('Extrinsic（カスタマイズ）');
}

function extractReadmeRows(worksheet, language, options = {}) {
  const allRows = [];

  worksheet.eachRow({ includeEmpty: true }, (row, rowNum) => {
    allRows.push({ rowNum, row });
  });

  // Find section boundary row indices
  let chineseIdx = -1;
  let japaneseIdx = -1;

  for (let i = 0; i < allRows.length; i++) {
    const text = allRows[i].row.getCell(1).text || '';
    if (chineseIdx < 0 && text.includes('(Chinese)')) chineseIdx = i;
    if (japaneseIdx < 0 && text.includes('(Japanese)')) japaneseIdx = i;
  }

  let sectionRows;
  let markerToStrip = null;

  if (language === 'zh') {
    const end = japaneseIdx >= 0 ? japaneseIdx : allRows.length;
    sectionRows = allRows.slice(chineseIdx, end);
    markerToStrip = '(Chinese)';
  } else if (language === 'ja') {
    sectionRows = allRows.slice(japaneseIdx);
    markerToStrip = '(Japanese)';
  } else {
    const end = chineseIdx >= 0 ? chineseIdx : allRows.length;
    sectionRows = allRows.slice(0, end);
  }

  // Build slave cell set from worksheet merges (absolute row numbers)
  const slaveCells = new Set();
  const colLetterToIdx = a => { let n=0; for(const c of a.toUpperCase()) n=n*26+c.charCodeAt(0)-64; return n; };
  const colIdxToLetter = c => { let col='',tmp=c; while(tmp>0){const rem=(tmp-1)%26;col=String.fromCharCode(65+rem)+col;tmp=Math.floor((tmp-1)/26);} return col; };

  const allMerges = (worksheet.model && worksheet.model.merges) || [];
  for (const merge of allMerges) {
    const [s, e] = merge.split(':');
    const sc = s.replace(/[0-9]/g,''), sr = parseInt(s.replace(/[A-Z]/gi,''),10);
    const ec = e.replace(/[0-9]/g,''), er = parseInt(e.replace(/[A-Z]/gi,''),10);
    for (let r=sr; r<=er; r++) {
      for (let c=colLetterToIdx(sc); c<=colLetterToIdx(ec); c++) {
        if (r===sr && c===colLetterToIdx(sc)) continue;
        slaveCells.add(`${colIdxToLetter(c)}${r}`);
      }
    }
  }

  // Determine row number range of this section
  const sectionStartRow = sectionRows.length > 0 ? sectionRows[0].rowNum : 1;
  const sectionEndRow   = sectionRows.length > 0 ? sectionRows[sectionRows.length-1].rowNum : 1;

  // Build output rows — skip slave cells
  let filteredRows = sectionRows;

  // When removeColumnDE=true, also remove "EDI D96A Supplemental Documentation" block
  // (from "EDI D96A" row up to but NOT including the "Legend" row)
  if (options.removeColumnDE) {
    let inRemoveBlock = false;
    filteredRows = filteredRows.filter(item => {
      const text = cellText(item.row);
      if (!inRemoveBlock && isEdiSupplementalStart(text)) { inRemoveBlock = true; }
      if (inRemoveBlock && isLegendAnchor(text))          { inRemoveBlock = false; }
      return !inRemoveBlock;
    });
  }

  // When removeColumnDE=true, remove "Column D (EDI Sample)" and "Column E" blocks
  // (from the Column D — EDI row up to but NOT including the Column C row)
  if (options.removeColumnDE) {
    let inRemoveBlock = false;
    filteredRows = filteredRows.filter(item => {
      const text = cellText(item.row);
      if (!inRemoveBlock && isColumnDEdiStart(text)) { inRemoveBlock = true; }
      if (inRemoveBlock && isColumnCAnchor(text))    { inRemoveBlock = false; }
      return !inRemoveBlock;
    });
  }

  // When removeColumnC=true, remove "Column C / C列" block
  // (from the Column C row up to but NOT including the Extrinsic anchor row)
  if (options.removeColumnC) {
    let inRemoveBlock = false;
    filteredRows = filteredRows.filter(item => {
      const text = cellText(item.row);
      if (!inRemoveBlock && isColumnCStart(text)) { inRemoveBlock = true; }
      if (inRemoveBlock && isExtrinsicAnchor(text))  { inRemoveBlock = false; }
      return !inRemoveBlock;
    });
  }

  // Build originalRowNum → 1-based output row number map (after filtering)
  const rowNumMap = new Map();
  filteredRows.forEach((item, idx) => rowNumMap.set(item.rowNum, idx + 1));

  // Rebase merges using the map — skip merges whose master row was filtered out
  const sectionMerges = allMerges
    .filter(merge => {
      const sr = parseInt(merge.split(':')[0].replace(/[A-Z]/gi,''), 10);
      const er = parseInt(merge.split(':')[1].replace(/[A-Z]/gi,''), 10);
      return sr >= sectionStartRow && er <= sectionEndRow && rowNumMap.has(sr);
    })
    .map(merge => {
      const [s, e] = merge.split(':');
      const sc = s.replace(/[0-9]/g,''), sr = parseInt(s.replace(/[A-Z]/gi,''),10);
      const ec = e.replace(/[0-9]/g,''), er = parseInt(e.replace(/[A-Z]/gi,''),10);
      const newSr = rowNumMap.get(sr);
      // For the end row: use map if available, otherwise offset by same delta
      const newEr = rowNumMap.has(er) ? rowNumMap.get(er) : newSr + (er - sr);
      return `${sc}${newSr}:${ec}${newEr}`;
    });

  return filteredRows.map((item, idx) => {
    const cells = [];
    item.row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      if (slaveCells.has(cell.address)) return;
      // Skip truly empty cells (no value and no border)
      const hasBorder = cell.style && cell.style.border && Object.keys(cell.style.border).length > 0;
      if (!cell.value && !hasBorder) return;
      let value = cell.value;
      if (idx === 0 && colNum === 1 && markerToStrip && typeof value === 'string') {
        value = value.replace(markerToStrip, '').trim();
      } else if (idx === 0 && colNum === 1 && markerToStrip && value?.richText) {
        value = {
          richText: value.richText.map(rt => ({
            ...rt,
            text: rt.text.replace(markerToStrip, '').trim(),
          })).filter(rt => rt.text),
        };
      }
      // Strip EDI from title row when EDI not in scope
      if (idx === 0 && colNum === 1 && options.removeColumnDE) {
        value = stripEdiFromTitle(value);
      }
      let style = cell.style;
      cells.push({ colNum, value, style });
    });
    return { originalRowNum: item.rowNum, cells, height: item.row.height || null };
  }).concat([{ _merges: sectionMerges }]); // append merges as last sentinel element
}

module.exports = { extractReadmeRows };
