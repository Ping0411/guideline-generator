/**
 * docSheetWriter.js
 *
 * Writes a single doc-type sheet into an exceljs Workbook.
 * Sheet layout:
 *   Row 1: headers  (A: cXML title, B: description title, C: empty, D: EDI title, E: EDI desc title)
 *   Row 2+: data    (A: cXML line, B: description if any, D: EDI segment, E: EDI desc if any)
 *
 * B column aligns with A column (same row = same cXML element).
 * D/E columns are independent — each EDI segment on its own row starting from row 2.
 * C column is always empty (visual separator).
 *
 * Formatting matches APJ_Framework_English_V2.xlsx:
 *   Font: Arial 11pt for all cells
 *   Header row: bold + light blue background (theme 3, tint 0.8)
 *   Column widths: A=80.75, B=50.33, C=3, D=90.5, E=44
 *   Row height: defaultRowHeight=14, no per-row override
 *   No wrapText, no explicit alignment (Excel defaults)
 */

const { buildCxmlRows } = require('./cxmlFormatter');

// ── Doc type metadata ──────────────────────────────────────────────────────────
const DOC_META = {
  PO:        { fullName: 'Purchase Order',        x12: '850', edifact: 'ORDERS'  },
  PO_CHANGE: { fullName: 'Purchase Order Change', x12: '860', edifact: 'ORDCHG'  },
  OC:        { fullName: 'Order Confirmation',    x12: '855', edifact: 'ORDRSP'  },
  ASN:       { fullName: 'Advanced Ship Notice',  x12: '856', edifact: 'DESADV'  },
  Invoice:   { fullName: 'Invoice',               x12: '810', edifact: 'INVOIC'  },
  GR:        { fullName: 'Goods Receipt',         x12: '861', edifact: 'RECADV'  },
};

const B_HEADER = 'Buyer-Specific Requirements';
const E_HEADER = 'Buyer-Specific Requirements';

// Matches the light blue header fill in sample file
const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { theme: 3, tint: 0.7999816888943144 },
  bgColor: { indexed: 64 },
};

const FONT_BASE   = { name: 'Arial', size: 11, color: { theme: 1 }, family: 2, scheme: 'minor' };
const FONT_HEADER = { ...FONT_BASE, bold: true };

/**
 * Build EDI rows from ediResult.
 * ediResult: { segments: [{ segment, description }] } or null
 * Returns: Array of { dText: string, eText: string|null }
 */
function buildEdiRows(ediResult) {
  if (!ediResult || !Array.isArray(ediResult.segments)) return [];
  return ediResult.segments.map(s => ({
    dText: s.segment || '',
    eText: s.description || null,
  }));
}

/**
 * Write a doc-type sheet into the workbook.
 *
 * @param {Workbook} workbook       - exceljs Workbook
 * @param {string}   sheetName      - name for the new worksheet
 * @param {string}   docType        - e.g. 'PO', 'OC', 'Invoice'
 * @param {string}   cxmlContent    - raw cXML string
 * @param {object}   evalResult     - { descriptionTriggers: [...], ... }
 * @param {object|null} ediResult   - { segments: [{segment, description}] } or null
 * @param {string}   ediFormat      - 'X12' | 'EDIFACT' | null
 * @param {string}   [subType]      - e.g. 'Price Adjustment Credit Memo'; overrides meta.fullName in header
 */
function writeDocSheet(workbook, sheetName, docType, cxmlContent, evalResult, ediResult, ediFormat, subType) {
  const meta = DOC_META[docType] || { fullName: docType, x12: '', edifact: '' };
  const displayName = subType || meta.fullName;
  const hasEdi = !!ediFormat && !!ediResult && !ediResult.error;

  const ws = workbook.addWorksheet(sheetName);

  // ── Default row height (matches sample) ───────────────────────────────────
  ws.properties.defaultRowHeight = 14;

  // ── Column widths (matches sample) ────────────────────────────────────────
  ws.getColumn(1).width = 80.75;   // A: cXML
  ws.getColumn(2).width = 50.33;   // B: description
  ws.getColumn(3).width = 3;       // C: separator
  if (hasEdi) {
    ws.getColumn(4).width = 90.5;  // D: EDI
    ws.getColumn(5).width = 44;    // E: EDI description
  }

  // ── Row 1: headers ─────────────────────────────────────────────────────────
  const aHeader = `Buyer Specific ${displayName}`;
  let dHeader = '';
  if (hasEdi) {
    dHeader = ediFormat === 'X12'
      ? `EDI ${displayName} (X12, ${meta.x12})`
      : `EDI ${displayName} (EDIFACT, ${meta.edifact})`;
  }

  const headerRow = ws.getRow(1);

  function setHeader(colNum, value) {
    const cell = headerRow.getCell(colNum);
    cell.value = value;
    cell.font = FONT_HEADER;
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  setHeader(1, aHeader);
  setHeader(2, B_HEADER);
  if (hasEdi) {
    setHeader(4, dHeader);
    setHeader(5, E_HEADER);
  }
  headerRow.commit();

  // ── Build data rows ────────────────────────────────────────────────────────
  const descTriggers = evalResult?.descriptionTriggers || [];
  const cxmlRows = buildCxmlRows(cxmlContent, descTriggers, docType);
  const ediRows = hasEdi ? buildEdiRows(ediResult) : [];

  const totalRows = Math.max(cxmlRows.length, ediRows.length);

  // Track pending merges: mergeId → { startRowNum }
  const pendingMerges = new Map();

  for (let i = 0; i < totalRows; i++) {
    const rowNum = i + 2;
    const row = ws.getRow(rowNum);

    const cxmlRow = cxmlRows[i];
    const ediRow  = ediRows[i];

    // A column: cXML line
    if (cxmlRow) {
      const cell = row.getCell(1);
      cell.value = cxmlRow.aText;
      cell.font = FONT_BASE;
    }

    // B column: description (regular or merge group)
    if (cxmlRow?.mergeId) {
      if (cxmlRow.mergeStart) {
        // First row of merge group: write description, record start
        const cell = row.getCell(2);
        cell.value = cxmlRow.bText;
        cell.font = FONT_BASE;
        pendingMerges.set(cxmlRow.mergeId, rowNum);
      }
      if (cxmlRow.mergeEnd) {
        // Last row of merge group: apply merge
        const startRowNum = pendingMerges.get(cxmlRow.mergeId);
        if (startRowNum && startRowNum < rowNum) {
          ws.mergeCells(startRowNum, 2, rowNum, 2);
          const mergedCell = ws.getCell(startRowNum, 2);
          mergedCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        }
        pendingMerges.delete(cxmlRow.mergeId);
      }
    } else if (cxmlRow?.bText) {
      const cell = row.getCell(2);
      cell.value = cxmlRow.bText;
      cell.font = FONT_BASE;
    }

    // D column: EDI segment
    if (ediRow && hasEdi) {
      const cell = row.getCell(4);
      cell.value = ediRow.dText;
      cell.font = FONT_BASE;
    }

    // E column: EDI description (only where applicable)
    if (ediRow?.eText && hasEdi) {
      const cell = row.getCell(5);
      cell.value = ediRow.eText;
      cell.font = FONT_BASE;
    }

    row.commit();
  }

  // ── Draw border boxes ──────────────────────────────────────────────────────
  applyBorderBoxes(ws, cxmlRows);
}

/**
 * Apply border boxes to A and B columns based on blockMark data.
 *
 * Each row's blockMark has a `boxes` array of { kind, start, end }.
 *   kind='outer'   → A + B, medium border
 *   kind='section' → A + B, thin border
 *   kind='item'    → B only, thin border
 *
 * Row numbers in the worksheet = rowIndex + 2 (header is row 1, data starts row 2).
 */
function applyBorderBoxes(ws, cxmlRows) {
  // Collect all box ranges from marks
  // pending: Map<kind+startKey, { startRow, kind }>
  // We track each box by its kind and the wsRow where it started

  // Build list of { startRow, endRow, kind } by scanning marks
  const pending = new Map(); // key = `${kind}:${startRow}` → startRow
  // We need a different approach: for each kind, track open ranges by start row

  // Simpler: collect (kind, startRow, endRow) triples
  // For each kind, we may have multiple simultaneous open ranges
  // Use a stack per kind
  const stacks = { outer: [], section: [], item: [] };
  const boxes  = [];

  for (let i = 0; i < cxmlRows.length; i++) {
    const mark = cxmlRows[i].blockMark;
    if (!mark) continue;
    const wsRow = i + 2;

    for (const box of mark.boxes) {
      if (box.start) {
        stacks[box.kind].push(wsRow);
      }
      if (box.end) {
        const startRow = stacks[box.kind].pop();
        if (startRow !== undefined) {
          boxes.push({ startRow, endRow: wsRow, kind: box.kind });
        }
      }
    }
  }

  // Apply borders
  for (const box of boxes) {
    const style = 'thin';
    const cols     = box.kind === 'item' ? [2] : [1, 2];

    for (const col of cols) {
      drawBox(ws, box.startRow, box.endRow, col, style);
    }
  }
}

/**
 * Draw a rectangular border box around a single-column range of rows.
 */
function drawBox(ws, startRow, endRow, col, style) {
  for (let r = startRow; r <= endRow; r++) {
    const cell = ws.getCell(r, col);
    const isTop    = r === startRow;
    const isBottom = r === endRow;

    cell.border = mergeBorder(cell.border, {
      top:    isTop    ? { style } : undefined,
      bottom: isBottom ? { style } : undefined,
      left:   { style },
      right:  { style },
    });
  }
}

/**
 * Merge a new border spec onto an existing border object.
 * Only sets sides that are defined in newBorder and not already set in existing.
 */
function mergeBorder(existing, newBorder) {
  const result = existing ? { ...existing } : {};
  for (const side of ['top', 'bottom', 'left', 'right']) {
    if (newBorder[side] && !result[side]) {
      result[side] = newBorder[side];
    }
  }
  return result;
}

module.exports = { writeDocSheet, DOC_META };
