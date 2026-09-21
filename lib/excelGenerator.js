/**
 * excelGenerator.js
 *
 * Orchestrates the full Excel output generation.
 * Reads the template, fills each sheet, adds doc-type sheets, returns a buffer.
 *
 * Sheet order in output:
 *   1. READ ME        (language section extracted from template)
 *   2. Version History (date filled)
 *   3. Project Requirements (filled by projectRequirementsWriter)
 *   4. [doc type sheets] (one per uploaded cXML file, named by filename)
 *   5. Extrinsic fields (copied from template as-is)
 *
 * Sheets NOT included in output:
 *   - countries (dropped entirely per design)
 *   - Other language sections in READ ME
 */

const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const path = require('path');
const { extractReadmeRows } = require('./readmeExtractor');
const { formatTodayForVersionHistory } = require('./dateFormatter');
const { fillProjectRequirements } = require('./projectRequirementsWriter');
const { writeDocSheet } = require('./docSheetWriter');
const { mergeExtrinsics } = require('./extrinsicExtractor');
const { formatCxml } = require('./cxmlFormatter');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'APJ_Framework_V1.xlsx');

// Exact sheet names in template (may have trailing spaces)
const SHEET_README             = 'READ ME ';
const SHEET_VERSION_HISTORY    = 'Version History';
const SHEET_PROJECT_REQ        = 'Project Requirements ';
const SHEET_INV_MULTI_COUNTRY  = 'Invoice-Multiple Countries';
const SHEET_INV_WITH_ATTACH    = 'Invoice (INV)-with attachment';
const SHEET_EXTRINSIC          = 'Extrinsic fields';
const SHEET_JA_DESIRED_DATE    = '注文書_ 希望納期日';
const SHEET_JA_SHIPTO_DETAIL   = '注文書_納入先住所_詳細';
const SHEET_ZH_DESIRED_DATE    = 'PO-交货日期';
const SHEET_ZH_SHIPTO_DETAIL   = 'PO-送货地址详情';

/**
 * Generate the complete Excel file.
 *
 * @param {object} answers      - user answers { q1, q2, q3, ... }
 * @param {object} evalResults  - { [docType]: { descriptionTriggers, projectReqTriggers, ... }, ... }
 * @param {Array}  cxmlFiles    - [{ originalname, content, docType, ediResult }]
 * @param {string} ediFormat    - 'X12' | 'EDIFACT' | null
 * @returns {Buffer}            - Excel file buffer
 */
async function generateExcel(answers, evalResults, cxmlFiles, ediFormat) {
  const language = answers.q1 || 'en';  // 'en' | 'zh' | 'ja'

  // ── Load template ──────────────────────────────────────────────────────────
  const template = new ExcelJS.Workbook();
  await template.xlsx.readFile(TEMPLATE_PATH);

  // ── Create output workbook ─────────────────────────────────────────────────
  const output = new ExcelJS.Workbook();
  output.creator = 'Guideline Generator';
  output.created = new Date();

  // Derive in-scope doc types from answers
  const required = answers.q2 || [];
  const optional = (answers.q3 || []).filter(v => v !== 'None');
  const inScope = [...new Set([...required, ...optional])];

  // ── 1. READ ME sheet ───────────────────────────────────────────────────────
  const tmplReadme = template.getWorksheet(SHEET_README);
  if (tmplReadme) {
    const invoiceInScope = inScope.includes('Invoice');
    const multipleCountries = invoiceInScope && answers.q14mc === 'Yes';
    console.log('[README] invoiceInScope:', invoiceInScope, 'q14mc:', answers.q14mc, 'multipleCountries:', multipleCountries);
    const readmeRows = extractReadmeRows(tmplReadme, language, {
      removeColumnDE: !ediFormat,
      removeColumnC:  !(invoiceInScope && answers.q14mc === 'Yes'),
    });
    const wsReadme = output.addWorksheet('READ ME');

    // Hide grid lines (inherit from template views)
    if (tmplReadme.views && tmplReadme.views.length > 0) {
      wsReadme.views = tmplReadme.views.map(v => ({ ...v }));
    } else {
      wsReadme.views = [{ showGridLines: false }];
    }

    // Extract merges sentinel (last element has _merges key)
    const lastElem = readmeRows[readmeRows.length - 1];
    const sectionMerges = lastElem?._merges || [];
    const dataRows = lastElem?._merges ? readmeRows.slice(0, -1) : readmeRows;

    const WHITE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

    // Apply merges before writing any cell values
    for (const merge of sectionMerges) {
      try { wsReadme.mergeCells(merge); } catch (_) {}
    }

    // Copy column widths and set white default fill for all columns
    tmplReadme.columns.forEach((col, idx) => {
      const dstCol = wsReadme.getColumn(idx + 1);
      if (col.width) dstCol.width = col.width;
      dstCol.style = { fill: WHITE_FILL, font: { name: 'Arial', size: 11, family: 2 } };
    });

    dataRows.forEach((rowData, i) => {
      const row = wsReadme.getRow(i + 1);
      if (rowData.height) row.height = rowData.height;
      rowData.cells.forEach(({ colNum, value, style }) => {
        const cell = row.getCell(colNum);
        cell.value = value;
        if (style) {
          try {
            const s = JSON.parse(JSON.stringify(style));
            // Replace pattern:none with solid white so cells render as white, not grid-default
            if (!s.fill || s.fill.pattern === 'none') {
              s.fill = WHITE_FILL;
            }
            cell.style = s;
          } catch (_) {}
        } else {
          cell.fill = WHITE_FILL;
        }
      });
      row.commit();
    });
  }

  // ── 2. Version History sheet ───────────────────────────────────────────────
  const tmplVH = template.getWorksheet(SHEET_VERSION_HISTORY);
  if (tmplVH) {
    const wsVH = output.addWorksheet('Version History');
    copySheetContent(tmplVH, wsVH);

    // Fill today's date in B2 (Version History date column)
    const today = formatTodayForVersionHistory();
    const dateCell = wsVH.getRow(2).getCell(2);
    if (!dateCell.value) {
      dateCell.value = today;
    } else {
      // Append if cell already has content (shouldn't normally happen)
      dateCell.value = today;
    }
  }

  // ── 3. Project Requirements sheet ─────────────────────────────────────────
  const tmplPR = template.getWorksheet(SHEET_PROJECT_REQ);
  if (tmplPR) {
    const wsPR = output.addWorksheet('Project Requirements');
    copySheetContent(tmplPR, wsPR);
    fillProjectRequirements(wsPR, answers, evalResults, cxmlFiles);
  }

  // ── 4. Doc type sheets (one per uploaded cXML) ────────────────────────────
  const DOC_TYPE_LABELS = {
    PO:                null,   // uses subType directly
    PO_CHANGE:         null,   // uses subType directly
    OC:                null,   // uses subType directly
    ASN:               null,   // uses subType directly
    Invoice:           null,   // uses subType directly
    GR:                'GR',
    PaymentRemittance: 'Payment Remittance',
  };

  // Resolve the display label for each file: subType when available, fallback to fixed label
  function resolveLabel(fileObj) {
    if (fileObj.subType) return fileObj.subType;
    return DOC_TYPE_LABELS[fileObj.docType] ?? fileObj.docType ?? null;
  }

  // Count how many times each label appears to determine if numbering is needed
  const docTypeCounts = {};
  for (const fileObj of cxmlFiles) {
    const label = resolveLabel(fileObj);
    if (label) docTypeCounts[label] = (docTypeCounts[label] || 0) + 1;
  }

  // Assign sheet names: numbered only when the same label appears more than once
  const docTypeSeq = {};
  const unresolvedSheets = []; // file names where docType could not be determined

  for (const fileObj of cxmlFiles) {
    const label = resolveLabel(fileObj);
    let sheetName;
    if (label) {
      if (docTypeCounts[label] > 1) {
        docTypeSeq[label] = (docTypeSeq[label] || 0) + 1;
        sheetName = sanitizeSheetName(`${label} ${docTypeSeq[label]}`);
      } else {
        sheetName = sanitizeSheetName(label);
      }
    } else {
      // Could not determine doc type — fall back to original filename
      sheetName = sanitizeSheetName(fileObj.fileName);
      unresolvedSheets.push(fileObj.fileName);
    }

    const evalResult = evalResults[fileObj.docType] || {};
    writeDocSheet(
      output,
      sheetName,
      fileObj.docType,
      fileObj.content,
      evalResult,
      fileObj.edi || null,
      ediFormat,
    );
  }

  // Expose unresolved sheet names so the caller can surface a warning to the user
  generateExcel._lastUnresolvedSheets = unresolvedSheets;

  // ── 5. Invoice-Multiple Countries sheet (only when q14mc=Yes) ────────────
  if (answers.q14mc === 'Yes') {
    const tmplInvMC = template.getWorksheet(SHEET_INV_MULTI_COUNTRY);
    if (tmplInvMC) {
      const wsInvMC = output.addWorksheet(SHEET_INV_MULTI_COUNTRY);
      copySheetContent(tmplInvMC, wsInvMC);
    }
  }

  // ── 5b. Invoice with Attachment sheet (zh + q15=Yes + Invoice in scope) ──
  if (answers.q1 === 'zh' && answers.q15 === 'Yes' && inScope.includes('Invoice')) {
    const invFiles = cxmlFiles.filter(f => f.docType === 'Invoice');
    if (invFiles.length > 0) {
      const tmplInvAtt = template.getWorksheet(SHEET_INV_WITH_ATTACH);
      if (tmplInvAtt) {
        const wsInvAtt = output.addWorksheet(SHEET_INV_WITH_ATTACH);
        copySheetContent(tmplInvAtt, wsInvAtt);
        buildInvWithAttachmentSheet(wsInvAtt, invFiles[0].content);
      }
    }
  }

  // ── 6. Japanese PO sheets (only when q1=ja and PO is in scope) ────────────
  if (language === 'ja' && inScope.includes('PO')) {
    const tmplDesiredDate = template.getWorksheet(SHEET_JA_DESIRED_DATE);
    if (tmplDesiredDate) {
      const wsDD = output.addWorksheet(SHEET_JA_DESIRED_DATE);
      copySheetContent(tmplDesiredDate, wsDD);
    }

    const tmplShipTo = template.getWorksheet(SHEET_JA_SHIPTO_DETAIL);
    if (tmplShipTo) {
      const wsShipTo = output.addWorksheet(SHEET_JA_SHIPTO_DETAIL);
      copySheetContent(tmplShipTo, wsShipTo);
      fillShipToDetail(wsShipTo, tmplShipTo, cxmlFiles);
    }
  }

  // ── 6b. Chinese PO sheets (only when q1=zh and PO is in scope) ───────────
  if (language === 'zh' && inScope.includes('PO')) {
    const tmplDesiredDate = template.getWorksheet(SHEET_ZH_DESIRED_DATE);
    if (tmplDesiredDate) {
      const wsDD = output.addWorksheet(SHEET_ZH_DESIRED_DATE);
      copySheetContent(tmplDesiredDate, wsDD);
    }

    const tmplShipTo = template.getWorksheet(SHEET_ZH_SHIPTO_DETAIL);
    if (tmplShipTo) {
      const wsShipTo = output.addWorksheet(SHEET_ZH_SHIPTO_DETAIL);
      copySheetContent(tmplShipTo, wsShipTo);
      fillShipToDetail(wsShipTo, tmplShipTo, cxmlFiles);
    }
  }

  // ── 7. Extrinsic fields sheet ─────────────────────────────────────────────
  const tmplExtrinsic = template.getWorksheet(SHEET_EXTRINSIC);
  if (tmplExtrinsic) {
    const wsEx = output.addWorksheet('Extrinsic fields');
    copySheetContent(tmplExtrinsic, wsEx);
    // Replace A1 with language-appropriate content
    const a1Cell = wsEx.getCell('A1');
    if (a1Cell.value && a1Cell.value.richText) {
      const extracted = extractExtrinsicA1(a1Cell.value.richText, language);
      if (extracted) a1Cell.value = extracted;
    }
    fillExtrinsicSheet(wsEx, cxmlFiles, inScope);
  }

  // ── Enforce Arial font across all worksheets ──────────────────────────────
  // Use includeEmpty:true to catch cells whose font comes from a style index
  // (not stored in cell.font directly) — those are the ones showing as 宋体.
  for (const ws of output.worksheets) {
    // Set worksheet-level default font so empty/unstyled cells also get Arial
    ws.properties = ws.properties || {};
    ws.properties.defaultFont = { name: 'Arial', size: 11, family: 2, scheme: 'minor' };

    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        const existing = cell.font || {};
        // Some SAP template fonts (e.g. "72 Brand Black") visually appear bold
        // via the font name rather than the bold attribute. When replacing with
        // Arial, preserve the visual weight by setting bold:true for those fonts.
        const origName = (existing.name || '').toLowerCase();
        const impliedBold = /black|heavy|bold/.test(origName);
        cell.font = {
          ...existing,
          name: 'Arial',
          family: 2,
          scheme: 'minor',
          size: existing.size || 11,
          bold: existing.bold ?? (impliedBold ? true : undefined),
        };
      });
    });
  }

  // ── Write to buffer ────────────────────────────────────────────────────────
  const rawBuffer = await output.xlsx.writeBuffer();

  // ── Fix CJK fallback fonts in theme to prevent 宋体 rendering ─────────────
  // ExcelJS copies the template's theme1.xml which has Hans=宋体, Hant=新細明體, Jpan=ＭＳ Ｐゴシック.
  // When scheme="minor" cells contain CJK text, Excel uses these script-specific fallbacks
  // rather than the named font. Replace them all with Arial so the output stays consistent.
  const buffer = await fixThemeFonts(rawBuffer);
  return buffer;
}

/**
 * Post-process xlsx buffer: replace CJK script fallback fonts in theme1.xml with Arial.
 * This prevents Excel from substituting 宋体/新細明體/ＭＳ Ｐゴシック for CJK characters.
 */
async function fixThemeFonts(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const themeFile = zip.file('xl/theme/theme1.xml');
  if (!themeFile) return buffer;

  let xml = await themeFile.async('string');
  // Replace CJK script typeface values with Arial
  xml = xml.replace(/(<a:font\s+script="(?:Hans|Hant|Jpan|Hang|Kore)"\s+typeface=")[^"]*(")/g, '$1Arial$2');
  zip.file('xl/theme/theme1.xml', xml);

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/**
 * Copy all rows/cells/styles from source worksheet to target worksheet.
 * Also copies column widths and row heights.
 */
/**
 * Extract the language-appropriate richText content from the Extrinsic fields A1 cell.
 * Markers: segment text containing "(Chinese)" marks start of Chinese section,
 *          segment text containing "(Japanese)" marks start of Japanese section.
 * Returns: { richText: [...] } or null if extraction fails.
 */
function extractExtrinsicA1(richText, language) {
  // Find segment indices containing the markers
  let chineseIdx = -1;
  let japaneseIdx = -1;
  for (let i = 0; i < richText.length; i++) {
    const t = richText[i].text || '';
    if (chineseIdx < 0 && t.includes('(Chinese)')) chineseIdx = i;
    if (japaneseIdx < 0 && t.includes('(Japanese)')) japaneseIdx = i;
  }

  let segments;
  let markerToStrip;

  if (language === 'zh' && chineseIdx >= 0) {
    // Chinese title may start a few segments before the (Chinese) marker.
    // Walk back to find the real start (first segment after the English section ends).
    // The English section ends at the last segment before the first Chinese character segment.
    // Simple heuristic: find the segment index just after the last purely-ASCII segment
    // before chineseIdx, or fall back to chineseIdx - 3.
    let zhStart = chineseIdx;
    for (let i = chineseIdx - 1; i >= 0; i--) {
      const t = richText[i].text || '';
      // If segment contains only ASCII/whitespace, stop here (it belongs to English)
      if (/^[\x00-\x7F]*$/.test(t)) { zhStart = i + 1; break; }
      zhStart = i;
    }
    const end = japaneseIdx >= 0 ? japaneseIdx : richText.length;
    segments = richText.slice(zhStart, end);
    markerToStrip = '(Chinese)';
  } else if (language === 'ja' && japaneseIdx >= 0) {
    segments = richText.slice(japaneseIdx);
    markerToStrip = '(Japanese)';
  } else {
    // English: everything before the Chinese marker
    const end = chineseIdx >= 0 ? chineseIdx : richText.length;
    segments = richText.slice(0, end);
    markerToStrip = null;
  }

  if (segments.length === 0) return null;

  // Strip the marker text from whichever segment contains it, and remove leading newlines
  const cleaned = segments.map(seg => {
    if (markerToStrip && seg.text.includes(markerToStrip)) {
      const stripped = seg.text.replace(markerToStrip, '').replace(/^\n+/, '');
      return stripped ? { ...seg, text: stripped } : null;
    }
    return seg;
  }).filter(Boolean).filter(seg => seg.text !== '');

  return { richText: cleaned };
}

function copySheetContent(src, dst) {
  // Copy sheet views (includes showGridLines, zoom, etc.)
  if (src.views && src.views.length > 0) {
    dst.views = src.views.map(v => ({ ...v }));
  }

  // Column widths
  src.columns.forEach((col, idx) => {
    const dstCol = dst.getColumn(idx + 1);
    if (col.width) dstCol.width = col.width;
  });

  const merges = (src.model && src.model.merges) || [];

  const colLetterToIdx = (addr) => {
    let n = 0;
    for (const ch of addr.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
    return n;
  };
  const colIdxToLetter = (c) => {
    let col = '', tmp = c;
    while (tmp > 0) {
      const rem = (tmp - 1) % 26;
      col = String.fromCharCode(65 + rem) + col;
      tmp = Math.floor((tmp - 1) / 26);
    }
    return col;
  };

  // Build slave cell address set
  const slaveCells = new Set();
  for (const merge of merges) {
    const [startAddr, endAddr] = merge.split(':');
    const startCol = startAddr.replace(/[0-9]/g, '');
    const startRow = parseInt(startAddr.replace(/[A-Z]/gi, ''), 10);
    const endCol   = endAddr.replace(/[0-9]/g, '');
    const endRow   = parseInt(endAddr.replace(/[A-Z]/gi, ''), 10);
    for (let r = startRow; r <= endRow; r++) {
      for (let c = colLetterToIdx(startCol); c <= colLetterToIdx(endCol); c++) {
        if (r === startRow && c === colLetterToIdx(startCol)) continue;
        slaveCells.add(`${colIdxToLetter(c)}${r}`);
      }
    }
  }

  // Apply merged cells to destination first
  for (const merge of merges) {
    try { dst.mergeCells(merge); } catch (_) {}
  }

  // Copy rows — skip slave cells entirely
  src.eachRow({ includeEmpty: true }, (srcRow, rowNum) => {
    const dstRow = dst.getRow(rowNum);
    if (srcRow.height) dstRow.height = srcRow.height;

    srcRow.eachCell({ includeEmpty: true }, (srcCell, colNum) => {
      if (slaveCells.has(srcCell.address)) return;
      const dstCell = dstRow.getCell(colNum);
      dstCell.value = srcCell.value;
      if (srcCell.style) {
        try { dstCell.style = JSON.parse(JSON.stringify(srcCell.style)); } catch (_) {}
      }
    });
    dstRow.commit();
  });

  // Copy images
  const srcImages = src.getImages ? src.getImages() : [];
  for (const img of srcImages) {
    try {
      // addImage requires the image data to be registered on the workbook first.
      // We copy the raw buffer from the source workbook and register it on dst's workbook.
      const srcWb = src.workbook;
      const dstWb = dst.workbook;
      const srcImgData = srcWb.getImage(img.imageId);
      if (!srcImgData) continue;
      const newImageId = dstWb.addImage({
        buffer: srcImgData.buffer,
        extension: srcImgData.extension,
      });
      dst.addImage(newImageId, {
        tl: { col: img.range.tl.nativeCol + img.range.tl.nativeColOff / 914400,
               row: img.range.tl.nativeRow + img.range.tl.nativeRowOff / 914400 },
        br: { col: img.range.br.nativeCol + img.range.br.nativeColOff / 914400,
               row: img.range.br.nativeRow + img.range.br.nativeRowOff / 914400 },
        editAs: img.range.editAs || 'oneCell',
      });
    } catch (_) {}
  }

  // Copy data validations (e.g. dropdown lists)
  const dvModel = src.dataValidations && src.dataValidations.model;
  if (dvModel) {
    for (const [addr, dv] of Object.entries(dvModel)) {
      try { dst.dataValidations.add(addr, { ...dv }); } catch (_) {}
    }
  }

}

/**
 * Sanitize a filename into a valid Excel sheet name.
 * - Strip file extension
 * - Replace invalid characters with _
 * - Truncate to 31 characters
 */
function sanitizeSheetName(filename) {
  // Remove extension
  const base = filename.replace(/\.[^.]+$/, '');
  // Replace invalid Excel sheet name characters: \ / ? * [ ] :
  const safe = base.replace(/[\\/?*[\]:]/g, '_');
  // Truncate to 31 chars
  return safe.slice(0, 31);
}

/**
 * Fill the ShipTo detail sheet (日文: 注文書_納入先住所_詳細 / 中文: PO-交货地址详情).
 * - Reads element→description mapping dynamically from the template sheet's A/B columns
 * - Clears the sample ShipTo in A column (rows 2+)
 * - Pastes the actual ShipTo lines from the first regular PO cXML
 * - Places B-column descriptions at the matching element rows
 * - Omits descriptions for elements absent in the uploaded ShipTo
 */
function fillShipToDetail(ws, tmplWs, cxmlFiles) {
  const FONT_B = { name: 'Arial', size: 11, color: { theme: 1 }, family: 2 };
  const ALIGN_B = { vertical: 'middle', wrapText: true };

  // Tags where only the first occurrence gets a description
  const FIRST_ONLY_TAGS = new Set(['DeliverTo', 'Street']);

  // ── 1. Build tag → description mapping from template A/B columns ──────────
  // Scan template rows 2+: find opening tags in A, read description from B
  const tagDescMap = new Map(); // tag → { desc, style }
  tmplWs.eachRow((row, i) => {
    if (i < 2) return;
    const aVal = row.getCell('A').value;
    const bVal = row.getCell('B').value;
    const aText = (aVal && aVal.richText) ? aVal.richText.map(r => r.text).join('') : (aVal || '');
    const bText = (bVal && bVal.richText) ? bVal.richText.map(r => r.text).join('') : (bVal || '');
    if (!bText) return;
    // Extract tag name from patterns like <TagName or <TagName>
    const tagMatch = aText.match(/<([A-Za-z][A-Za-z0-9]*)[\s>]/);
    if (tagMatch) {
      const tag = tagMatch[1];
      if (!tagDescMap.has(tag)) {
        tagDescMap.set(tag, { desc: bText, font: row.getCell('B').font, alignment: row.getCell('B').alignment });
      }
    }
  });

  // ── 2. Find first regular PO cXML ─────────────────────────────────────────
  const poFile = cxmlFiles.find(f => f.docType === 'PO' || f.docType === 'PO_CHANGE');
  if (!poFile) return;

  const content = poFile.content;
  const regularMatch = content.match(/orderType\s*=\s*["']regular["'][^]*?(?=<OrderRequest\b|$)/s);
  const searchIn = regularMatch ? regularMatch[0] : content;

  const shipToMatch = searchIn.match(/<ShipTo[\s\S]*?<\/ShipTo>/);
  if (!shipToMatch) return;

  const shipToRaw = shipToMatch[0];

  // ── 3. Split into lines, stripping common leading whitespace ──────────────
  const lines = shipToRaw.split('\n');
  const minIndent = lines
    .filter(l => l.trim().length > 0)
    .reduce((min, l) => Math.min(min, l.match(/^(\s*)/)[1].length), Infinity);
  const normalizedLines = lines.map(l => l.slice(minIndent));

  // ── 4. Clear existing sample rows (A2 downward) ───────────────────────────
  const lastRow = ws.rowCount || 30;
  for (let r = 2; r <= Math.max(lastRow, normalizedLines.length + 1); r++) {
    const row = ws.getRow(r);
    row.getCell('A').value = null;
    row.getCell('B').value = null;
  }

  // ── 5. Write lines to A column and descriptions to B column ───────────────
  const descUsed = new Set();
  normalizedLines.forEach((line, idx) => {
    const rowNum = idx + 2;
    const row = ws.getRow(rowNum);

    row.getCell('A').value = line;

    // Find matching tag in this line
    const tagMatch = line.match(/<([A-Za-z][A-Za-z0-9]*)[\s>]/);
    if (tagMatch) {
      const tag = tagMatch[1];
      const entry = tagDescMap.get(tag);
      if (entry) {
        const isFirstOnly = FIRST_ONLY_TAGS.has(tag);
        if (!isFirstOnly || !descUsed.has(tag)) {
          const cellB = row.getCell('B');
          cellB.value = entry.desc;
          cellB.font = entry.font || FONT_B;
          cellB.alignment = entry.alignment || ALIGN_B;
          descUsed.add(tag);
        }
      }
    }

    row.commit();
  });
}

/**
 * Fill the Extrinsic fields sheet with extracted extrinsic data.
 * Fully dynamic — reads the template to locate tables and columns automatically.
 * Does NOT touch any existing content, format, or structure.
 */
function fillExtrinsicSheet(ws, cxmlFiles, inScope) {
  const FONT = { name: 'Arial', size: 11, family: 2, scheme: 'minor' };

  // ── Scan the sheet to understand its structure ────────────────────────────
  // Returns: { headerRow, colMap, dataStartRow, sectionEndRow }
  // headerRow: row containing column names
  // colMap: { fieldName: colNumber } derived from header cell text
  // dataStartRow: first empty row after header
  // sectionEndRow: last row before the next section (or end of sheet)
  function locateSection(titleKeyword, startAfterRow) {
    let titleRow   = -1;
    let headerRow  = -1;
    const colMap   = {};

    ws.eachRow((row, rowNum) => {
      if (rowNum <= startAfterRow) return;

      // Find title row containing the keyword
      // Skip rows where all filled cells have identical content (merged description rows)
      if (titleRow < 0) {
        const texts = [];
        for (let c = 1; c <= 8; c++) {
          const t = cellVal(row.getCell(c).value);
          if (t) texts.push(t);
        }
        if (texts.length === 0) return;
        // Skip merged description rows (all cells same)
        const allSame = texts.every(x => x === texts[0]);
        if (allSame && texts[0].toLowerCase().includes(titleKeyword.toLowerCase())) {
          titleRow = rowNum;
          return;
        }
        if (!allSame) {
          // Multi-column rows are header rows, not title rows — skip
          return;
        }
        return;
      }

      // After title found, find header row:
      // Must have 2+ filled cells AND the cell values must NOT all be identical
      // (merged title rows have identical content in every cell — skip those)
      if (headerRow < 0) {
        const texts = [];
        for (let c = 1; c <= 8; c++) {
          const t = cellVal(row.getCell(c).value);
          if (t) texts.push({ col: c, text: t });
        }
        if (texts.length >= 2) {
          // Check if all filled cells have the same text (= merged title row)
          const allSame = texts.every(x => x.text === texts[0].text);
          if (!allSame) {
            // This is a real header row — build colMap
            for (const { col, text } of texts) {
              colMap[text.toLowerCase().replace(/[^a-z0-9]/g, '')] = col;
            }
            headerRow = rowNum;
          }
        }
        return;
      }
    });

    if (headerRow < 0) return null;

    // dataStartRow = first row after header that is empty or has data
    const dataStartRow = headerRow + 1;

    return { titleRow, headerRow, dataStartRow, colMap };
  }

  function cellVal(v) {
    if (!v) return '';
    if (typeof v === 'string') return v.trim();
    if (v.richText) return v.richText.map(r => r.text).join('').trim();
    return String(v).trim();
  }

  const BORDER_THIN = { style: 'thin' };
  const FULL_BORDER = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };

  function writeDataRow(rowNum, values, numCols) {
    const row = ws.getRow(rowNum);
    for (let c = 1; c <= numCols; c++) {
      const cell = row.getCell(c);
      const val = values[c];
      if (val != null && val !== '') {
        cell.value = val;
        cell.font  = FONT;
        cell.alignment = { vertical: 'top', wrapText: true };
      }
      cell.border = FULL_BORDER;
    }
    row.commit();
  }

  // ── PO table ──────────────────────────────────────────────────────────────
  const poSection = locateSection('Purchase Order', 0);
  if (poSection) {
    const { dataStartRow, colMap } = poSection;

    // Resolve column numbers from header text
    const col = {
      name:     colMap['extrinsicname']     || colMap['name'] || 1,
      required: colMap['requiredbackoninvoice'] || colMap['required'] || 2,
      location: colMap['location'] || 3,
      example:  colMap['example']  || 4,
      format:   colMap['format']   || 5,
      notes:    colMap['notes']    || 6,
    };

    const poFiles = cxmlFiles.filter(f => f.docType === 'PO' || f.docType === 'PO_CHANGE');
    const poRows  = (inScope.includes('PO') && poFiles.length > 0) ? mergeExtrinsics(poFiles) : [];

    // Find where Invoice section starts to avoid overwriting it
    const invSection = locateSection('Invoice', poSection.headerRow);
    const invTitleRow = invSection ? invSection.titleRow : 99999;

    // If PO data would overflow into Invoice section, insert enough blank rows upfront
    // Also reserve 1 extra row as spacer between PO table and Invoice title
    const poEndRow = dataStartRow + poRows.length - 1;
    const needsSpacer = invTitleRow < 99999;
    if (invTitleRow < 99999 && poEndRow >= invTitleRow - 1) {
      const needed = poEndRow - invTitleRow + 2;  // +2: data rows + spacer
      ws.spliceRows(invTitleRow, 0, ...Array(needed).fill([]));
    }

    for (let i = 0; i < poRows.length; i++) {
      const r = dataStartRow + i;
      const { name, location, example, notes } = poRows[i];
      writeDataRow(r, {
        [col.name]:     name,
        [col.location]: location,
        [col.example]:  example,
        [col.format]:   'string',
        [col.notes]:    notes,
      }, col.notes);
    }

    // Insert spacer row between PO table and Invoice title if they would be adjacent
    if (needsSpacer && poRows.length > 0) {
      const poLastRow = dataStartRow + poRows.length - 1;
      const updatedInvSection = locateSection('Invoice', poSection.headerRow);
      const updatedInvTitleRow = updatedInvSection ? updatedInvSection.titleRow : 99999;
      if (updatedInvTitleRow === poLastRow + 1) {
        ws.spliceRows(updatedInvTitleRow, 0, []);
      }
    }
  }

  // ── Invoice table ─────────────────────────────────────────────────────────
  const invSection = locateSection('Invoice', poSection ? poSection.headerRow : 0);
  if (invSection) {
    const { dataStartRow, colMap } = invSection;

    const col = {
      name:       colMap['extrinsicname']   || colMap['name'] || 1,
      required:   colMap['requiredmapping'] || colMap['required'] || 2,
      mappedfrpo: colMap['mappedfrompo']    || colMap['mapped'] || 3,
      location:   colMap['location'] || 4,
      example:    colMap['example']  || 5,
      format:     colMap['format']   || 6,
      notes:      colMap['notes']    || 7,
    };

    const invFiles = cxmlFiles.filter(f => f.docType === 'Invoice');
    const invRows  = (inScope.includes('Invoice') && invFiles.length > 0) ? mergeExtrinsics(invFiles) : [];

    for (let i = 0; i < invRows.length; i++) {
      const r = dataStartRow + i;
      const { name, location, example, notes } = invRows[i];
      writeDataRow(r, {
        [col.name]:     name,
        [col.location]: location,
        [col.example]:  example,
        [col.format]:   'string',
        [col.notes]:    notes,
      }, col.notes);
    }
  }
}

module.exports = { generateExcel };

/**
 * Build the "Invoice (INV)-with attachment" sheet.
 * 1. Reads Content-ID value from A5: "Content-ID: xxx@yyy" → "xxx@yyy"
 * 2. Finds "Start of cXML Invoice" marker row, inserts cXML lines after it
 * 3. Replaces <URL>cid:ORIGINAL</URL> with <URL>cid:TEMPLATE_CONTENT_ID</URL>
 * 4. Writes B column description on the cid: line
 */
function buildInvWithAttachmentSheet(ws, cxmlContent) {
  // 1. Read Content-ID value from A5
  const contentIdCell = ws.getCell('A5').value || '';
  const contentIdMatch = contentIdCell.toString().match(/Content-ID:\s*(.+)/i);
  const templateContentId = contentIdMatch ? contentIdMatch[1].trim() : null;

  // 2. Find start/end marker rows
  let startRow = null;
  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    const bVal = (row.getCell(2).value || '').toString().trim();
    if (bVal === 'Start of cXML Invoice') startRow = rowNum;
  });

  if (!startRow) return;

  // 3. Format cXML into lines
  const lines = formatCxml(cxmlContent).map(({ text }) => text);

  // 4. Insert empty rows then fill
  const insertAt = startRow + 1;
  ws.spliceRows(insertAt, 0, ...lines.map(() => []));

  // 5. Write each line; replace cid: value and add B description
  for (let i = 0; i < lines.length; i++) {
    let lineText = lines[i];
    const row = ws.getRow(insertAt + i);

    let isCidLine = false;
    if (templateContentId && /<URL>\s*cid:/i.test(lineText)) {
      lineText = lineText.replace(/(<URL>\s*cid:)[^<]*(<\/URL>)/i, '$1' + templateContentId + '$2');
      isCidLine = true;
    }

    row.getCell(1).value = lineText;
    if (isCidLine) {
      row.getCell(2).value = 'Must match the Content-ID in the MIME header/footer';
    }
    row.commit();
  }
}
