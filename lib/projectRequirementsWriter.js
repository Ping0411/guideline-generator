/**
 * projectRequirementsWriter.js
 *
 * Fills the Project Requirements sheet based on user answers and evaluation results.
 * Uses semantic row detection (not row numbers) for all positioning.
 *
 * Doc type section keywords (as they appear in template):
 *   PO:      'Purchase Order'
 *   OC:      'Order Confirmation (OC)'
 *   ASN:     'Advanced Ship Notice(ASN)'
 *   Invoice: 'Invoicing'
 *   GR:      'Goods Receipt (GR)'
 *   Fence:   'Extrinsics'  ← marks the end of all doc type sections
 *
 * Template has NO merged cells in the doc-type section area.
 * After writing, title rows are merged A:I and centered programmatically.
 */

const I18N = {
  supportedPoTypes: {
    en: 'Supported PO Types: ',
    zh: '支持的采购订单类型：',
    ja: 'サポートされるPOタイプ：',
  },
  shipToHeader: {
    en: 'ShipTo is supported at header level.',
    zh: 'ShipTo将在PO的抬头级中传送。',
    ja: 'ShipToはヘッダーレベルで送信される。',
  },
  shipToLine: {
    en: 'ShipTo is supported at line level.',
    zh: 'ShipTo将在PO的行项目级中传送。',
    ja: 'ShipToは明細レベルで送信される。',
  },
  shipToBoth: {
    en: 'ShipTo is supported at both header and line level.',
    zh: 'ShipTo可以在PO的抬头级或者行项目级别传送。',
    ja: 'ShipToはヘッダーレベル，もしくは明細レベルで送信される。',
  },
  supportedInvoiceTypes: {
    en: 'Supported Invoice Types: ',
    zh: '支持的发票类型：',
    ja: 'サポートされる請求書タイプ：',
  },
  decimalPlaces: {
    en: 'Decimal Places: ',
    zh: '小数位数：',
    ja: '小数点以下桁数：',
  },
  roundingRule: {
    en: 'Rounding Rule: ',
    zh: '舍入规则：',
    ja: '丸めルール：',
  },
  invoiceNumberMaxLen: {
    en: (n) => `Invoice number must not exceed ${n} characters.`,
    zh: (n) => `发票号码不得超过 ${n} 个字符。`,
    ja: (n) => `請求書番号は${n}バイト以内であること。`,
  },
  allowedSpecialChars: {
    en: 'Allowed special characters: ',
    zh: '允许的特殊字符：',
    ja: '使用可能な特殊文字：',
  },
  disallowedSpecialChars: {
    en: 'Disallowed special characters: ',
    zh: '不允许的特殊字符：',
    ja: '使用不可特殊文字：',
  },
};

const DOC_SECTION_KEYWORDS = {
  PO:      'Purchase Order',
  OC:      'Order Confirmation (OC)',
  ASN:     'Advanced Ship Notice(ASN)',
  Invoice: 'Invoicing',
  GR:      'Goods Receipt (GR)',
};

const EXTRINSICS_KEYWORD = 'Extrinsics';
const TITLE_MERGE_END_COL = 'I';  // merge title row A:I
const DATA_FONT = { name: 'Arial', size: 11, family: 2, bold: false };

/**
 * Get plain text from a cell value (handles string, richText, null).
 */
function cellText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value.richText) return value.richText.map(r => r.text).join('');
  return String(value);
}

/**
 * Find the first row number where cell A contains the given keyword.
 * Returns -1 if not found.
 */
function findRowByKeyword(worksheet, keyword, startRow = 1) {
  let found = -1;
  worksheet.eachRow((row, rowNum) => {
    if (rowNum < startRow || found >= 0) return;
    if (cellText(row.getCell(1).value).includes(keyword)) {
      found = rowNum;
    }
  });
  return found;
}

/**
 * Find the first non-empty-looking cell to the right of the label cell on the same row.
 * "Non-empty-looking" means the cell has a border or was explicitly set (i.e. is the
 * designated input cell), while having no value yet — exactly the pattern used in the
 * ANID / Region input cells in the template.
 * Falls back to the immediately adjacent cell (col + 1) if nothing with a border is found.
 */
function findAdjacentValueCell(worksheet, rowNum) {
  const row = worksheet.getRow(rowNum);
  // Scan from col 2 rightward; pick the first cell that has a border (input box in template)
  for (let c = 2; c <= 20; c++) {
    const cell = row.getCell(c);
    const hasBorder = cell.style && cell.style.border && Object.keys(cell.style.border).length > 0;
    if (hasBorder) return cell;
  }
  // Fallback: cell immediately to the right of the label
  return row.getCell(2);
}

/**
 * Find the row number AFTER a label row (the value fill row).
 */
function findValueRowAfter(worksheet, keyword) {
  const labelRow = findRowByKeyword(worksheet, keyword);
  return labelRow >= 0 ? labelRow + 1 : -1;
}

/**
 * Build section map: { docType: { titleRow, startRow, endRow } }
 */
function buildSectionMap(worksheet) {
  const sectionMap = {};
  const order = ['PO', 'OC', 'ASN', 'Invoice', 'GR'];

  const titleRows = {};
  for (const [docType, keyword] of Object.entries(DOC_SECTION_KEYWORDS)) {
    titleRows[docType] = findRowByKeyword(worksheet, keyword);
  }
  const extrinsicsRow = findRowByKeyword(worksheet, EXTRINSICS_KEYWORD);

  for (let i = 0; i < order.length; i++) {
    const docType = order[i];
    const titleRow = titleRows[docType];
    if (titleRow < 0) continue;

    let nextBoundary = extrinsicsRow > 0 ? extrinsicsRow : 9999;
    for (let j = i + 1; j < order.length; j++) {
      const nextTitle = titleRows[order[j]];
      if (nextTitle > titleRow) {
        nextBoundary = nextTitle;
        break;
      }
    }

    sectionMap[docType] = {
      titleRow,
      startRow: titleRow + 1,
      endRow: nextBoundary - 1,
    };
  }

  return sectionMap;
}

/**
 * Collect all row numbers for a section (title + content rows).
 */
function collectRowsToDelete(sectionMap, docType) {
  const section = sectionMap[docType];
  if (!section) return [];
  const rows = [];
  for (let r = section.titleRow; r <= section.endRow; r++) {
    rows.push(r);
  }
  return rows;
}

/**
 * Merge and center a title row across columns A to TITLE_MERGE_END_COL.
 * Preserves the existing font/fill style of cell A.
 */
function mergeTitleRow(worksheet, rowNum) {
  const cell = worksheet.getRow(rowNum).getCell(1);
  const mergeAddr = `A${rowNum}:${TITLE_MERGE_END_COL}${rowNum}`;
  try { worksheet.mergeCells(mergeAddr); } catch (_) {}
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
}

/**
 * Main function: fill Project Requirements sheet.
 *
 * @param {Worksheet} worksheet      - exceljs Worksheet object
 * @param {object}    answers        - user answers { q2, q3, ... }
 * @param {object}    evalResults    - { PO: { projectReqTriggers }, OC: {...}, ... }
 */
/**
 * Extract buyer ANID from cXML file list.
 * Priority: PO first, then Invoice.
 * PO:      <From><Credential domain="NetworkId"><Identity>...
 * Invoice: <Header><To><Credential domain="NetworkID"><Identity>...
 * Returns the raw test ANID string (e.g. "AN11054636630-T"), or null if not found.
 */
function extractBuyerAnid(cxmlFileList) {
  if (!cxmlFileList || cxmlFileList.length === 0) return null;

  // Try PO first
  const poFile = cxmlFileList.find(f => f.docType === 'PO' || f.docType === 'PO_CHANGE');
  if (poFile) {
    // <From> block: find Credential with domain NetworkId (case-insensitive)
    const fromMatch = poFile.content.match(/<From[\s\S]*?<\/From>/i);
    if (fromMatch) {
      const credMatch = fromMatch[0].match(/<Credential[^>]+domain\s*=\s*["']NetworkId["'][^>]*>\s*<Identity>([^<]+)<\/Identity>/i);
      if (credMatch) return credMatch[1].trim();
    }
  }

  // Fall back to Invoice
  const invFile = cxmlFileList.find(f => f.docType === 'Invoice');
  if (invFile) {
    // <Header><To> block: find Credential with domain NetworkID (case-insensitive)
    const toMatch = invFile.content.match(/<To[\s\S]*?<\/To>/i);
    if (toMatch) {
      const credMatch = toMatch[0].match(/<Credential[^>]+domain\s*=\s*["']NetworkID["'][^>]*>\s*<Identity>([^<]+)<\/Identity>/i);
      if (credMatch) return credMatch[1].trim();
    }
  }

  return null;
}

function fillProjectRequirements(worksheet, answers, evalResults, cxmlFileList) {
  const lang = (answers.q1 === 'zh' || answers.q1 === 'ja') ? answers.q1 : 'en';
  const t = (key) => I18N[key][lang];

  const required = answers.q2 || [];
  const optional = (answers.q3 || []).filter(v => v !== 'None');
  const inScope = new Set([...required, ...optional]);

  // ── 0. Buyer ANID ────────────────────────────────────────────────────────
  const testAnid = extractBuyerAnid(cxmlFileList);
  if (testAnid) {
    const prodAnid = testAnid.replace(/-T$/i, '');
    const anidRow = findRowByKeyword(worksheet, 'SAP BUSINESS NETWORK ID:');
    if (anidRow > 0) {
      const cell = findAdjacentValueCell(worksheet, anidRow);
      cell.value = prodAnid;
      cell.font = DATA_FONT;
    }
    const testAnidRow = findRowByKeyword(worksheet, 'SAP BUSINESS NETWORK TEST ID:');
    if (testAnidRow > 0) {
      const cell = findAdjacentValueCell(worksheet, testAnidRow);
      cell.value = testAnid;
      cell.font = DATA_FONT;
    }
  }

  // ── 0b. Region (default: APJ) ────────────────────────────────────────────
  const regionValueRow = findValueRowAfter(worksheet, 'Region');
  if (regionValueRow > 0) {
    const cell = worksheet.getRow(regionValueRow).getCell(1);
    cell.value = 'APJ';
    cell.font = DATA_FONT;
  }

  // ── 1. In Scope Transactions ─────────────────────────────────────────────
  const inScopeValueRow = findValueRowAfter(worksheet, 'In Scope Transactions');
  if (inScopeValueRow > 0) {
    const cell = worksheet.getRow(inScopeValueRow).getCell(1);
    cell.value = required.length > 0 ? required.join(', ') : 'None';
    cell.font = DATA_FONT;
  }

  // ── 2. Optional Transactions ─────────────────────────────────────────────
  const optionalValueRow = findValueRowAfter(worksheet, 'Optional Transactions');
  if (optionalValueRow > 0) {
    const cell = worksheet.getRow(optionalValueRow).getCell(1);
    cell.value = optional.length > 0 ? optional.join(', ') : 'None';
    cell.font = DATA_FONT;
  }

  // ── 3. Build section map ──────────────────────────────────────────────────
  const sectionMap = buildSectionMap(worksheet);

  // ── 4. Build triggers per doc type ───────────────────────────────────────
  const triggersMap = {};
  for (const docType of Object.keys(DOC_SECTION_KEYWORDS)) {
    const triggers = [...(evalResults[docType]?.projectReqTriggers || [])];

    if (docType === 'PO') {
      const q4 = answers.q4 || [];
      const q4list = Array.isArray(q4) ? q4 : [q4];
      if (q4list.length > 0) {
        triggers.push({ ruleText: t('supportedPoTypes') + q4list.join(', ') });
      }

      const q5 = answers.q5;
      if (q5) {
        const isHeader = q5 === 'Header' || q5 === 'Header Level';
        const isLine   = q5 === 'Line Level';
        const shipToText = isHeader ? t('shipToHeader')
          : isLine ? t('shipToLine')
          : t('shipToBoth');
        triggers.push({ ruleText: shipToText });
      }

      const hasNonCatalog = q4list.some(v => v.toLowerCase().includes('non-catalog') || v.toLowerCase().includes('non catalog'));
      if (hasNonCatalog && answers.q8) {
        const q8val = answers.q8 === 'Other' && answers.q8other
          ? answers.q8other
          : answers.q8;
        const q8text = q8val === 'isAdHoc="yes"'
          ? 'Non-Catalog POs are identified by the attribute isAdHoc="yes" on the ItemOut element.'
          : q8val === 'SupplierPartID is "NotAvailable"'
          ? 'Non-Catalog POs are identified when SupplierPartID is set to "NotAvailable".'
          : `Non-Catalog PO identification: ${q8val}`;
        triggers.push({ ruleText: q8text });
      }

      // ZH/JA fixed lines from template (rows 19-20 in Project Requirements)
      // Only shown when language is zh or ja
      if (lang === 'zh' || lang === 'ja') {
        const MARKER = '（Chinese）';
        const PO_FIXED_LINES = [
          '关于订单中的交货日期，请参照工作表"PO-交货日期"（Chinese）希望納入日の詳細を"注文書_ 希望納期日"にてご参照ください。',
          '关于送货地址的详细规则，请参照工作表"PO-送货地址详情"（Chinese）shipTo(納入先）情報の詳細を"注文書_納入先住所_詳細"にてご参照ください。',
        ];
        for (const line of PO_FIXED_LINES) {
          const idx = line.indexOf(MARKER);
          const text = lang === 'zh'
            ? line.substring(0, idx).trim()
            : line.substring(idx + MARKER.length).trim();
          if (text) triggers.push({ ruleText: text });
        }
      }
    }

    if (docType === 'Invoice') {
      const q10 = answers.q10 || [];
      const q10list = Array.isArray(q10) ? q10 : [q10];
      if (q10list.length > 0) {
        triggers.push({ ruleText: t('supportedInvoiceTypes') + q10list.join(', ') });
      }

      const q11decimal = answers.q11decimal;
      const q11rounding = answers.q11rounding;
      const q11parts = [];
      if (q11decimal)  q11parts.push(t('decimalPlaces') + q11decimal);
      if (q11rounding) q11parts.push(t('roundingRule') + q11rounding);
      if (q11parts.length > 0) triggers.push({ ruleText: q11parts.join(' | ') });

      const q12parts = [];
      if (answers.q12maxlen)      q12parts.push(I18N.invoiceNumberMaxLen[lang](answers.q12maxlen));
      if (answers.q12allowed)     q12parts.push(t('allowedSpecialChars') + answers.q12allowed + '.');
      if (answers.q12disallowed)  q12parts.push(t('disallowedSpecialChars') + answers.q12disallowed + '.');
      if (answers.q12other)       q12parts.push(answers.q12other);
      if (q12parts.length > 0)    triggers.push({ ruleText: q12parts.join(' ') });
    }

    triggersMap[docType] = triggers;
  }

  // ── 5. Delete sections with no content (sorted descending to preserve indices)
  const rowsToDelete = [];
  for (const docType of Object.keys(DOC_SECTION_KEYWORDS)) {
    const noContent = !inScope.has(docType) || triggersMap[docType].length === 0;
    if (noContent && sectionMap[docType]) {
      rowsToDelete.push(...collectRowsToDelete(sectionMap, docType));
    }
  }
  rowsToDelete.sort((a, b) => b - a);
  for (const rowNum of rowsToDelete) {
    worksheet.spliceRows(rowNum, 1);
  }

  // ── 6. Rebuild section map after deletions ────────────────────────────────
  const updatedSectionMap = buildSectionMap(worksheet);

  // ── 7. Write requirements and merge+center title rows ────────────────────
  for (const [docType, section] of Object.entries(updatedSectionMap)) {
    if (!inScope.has(docType)) continue;
    const triggers = triggersMap[docType] || [];
    if (triggers.length === 0) continue;

    // Merge and center the title row
    mergeTitleRow(worksheet, section.titleRow);

    let currentRow = section.startRow;
    for (const trigger of triggers) {
      if (currentRow > section.endRow) {
        worksheet.spliceRows(currentRow, 0, []);
        section.endRow++;
      }
      const row = worksheet.getRow(currentRow);
      const cell = row.getCell(1);
      const text = (lang !== 'en' && trigger[lang]) ? trigger[lang] : trigger.ruleText;
      cell.value = text;
      cell.font = DATA_FONT;
      cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
      try { worksheet.mergeCells(`A${currentRow}:${TITLE_MERGE_END_COL}${currentRow}`); } catch (_) {}
      // Estimate row height based on text length (merged width ≈ 100 chars, line height ≈ 15pt)
      const charsPerLine = 100;
      const lineCount = Math.max(1, Math.ceil((text || '').length / charsPerLine));
      row.height = lineCount * 15;
      currentRow++;
    }
  }

  // ── 8. Merge+center Extrinsics title row (always present) ────────────────
  const extrinsicsRow = findRowByKeyword(worksheet, EXTRINSICS_KEYWORD);
  if (extrinsicsRow > 0) {
    mergeTitleRow(worksheet, extrinsicsRow);
  }
}

module.exports = { fillProjectRequirements };
