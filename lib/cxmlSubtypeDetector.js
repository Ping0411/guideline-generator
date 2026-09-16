/**
 * cxmlSubtypeDetector.js
 *
 * Fast string-scan to determine the specific sub-type of a cXML document.
 * Used to direct SAP Help MCP to the right document chapters, avoiding
 * full-spec searches.
 *
 * Returns a subtype descriptor object:
 *   {
 *     docType:     'PO' | 'OC' | 'ASN' | 'Invoice' | ...
 *     subType:     human-readable sub-type label
 *     chapters:    array of chapter hints for SAP Help MCP (cXML Solutions/Reference Guide)
 *     notes:       brief description of structural differences to highlight
 *   }
 */

/**
 * Detect sub-type from cXML content and base docType.
 *
 * @param {string} docType    - base doc type from detectDocType()
 * @param {string} content    - raw cXML string
 * @returns {object}          - subtype descriptor
 */
function detectSubtype(docType, content) {
  switch (docType) {
    case 'PO':        return detectPoSubtype(content);
    case 'PO_CHANGE': return detectPoChangeSubtype(content);
    case 'OC':        return detectOcSubtype(content);
    case 'ASN':       return detectAsnSubtype(content);
    case 'Invoice':   return detectInvoiceSubtype(content);
    default:
      return {
        docType,
        subType: docType,
        chapters: [],
        notes: '',
      };
  }
}

// ── PO ────────────────────────────────────────────────────────────────────────

function detectPoSubtype(content) {
  // Extract orderType from OrderRequestHeader
  const orderTypeMatch = content.match(/OrderRequestHeader[^>]*\borderType\s*=\s*["'](\w+)["']/);
  const orderType = orderTypeMatch ? orderTypeMatch[1].toLowerCase() : 'regular';

  // Mixed Order: both ItemDetail and BlanketItemDetail present under ItemOut — must check first
  if (content.includes('<ItemDetail') && content.includes('<BlanketItemDetail')) {
    return { docType: 'PO', subType: 'Mixed Order', chapters: [], notes: 'Both ItemDetail and BlanketItemDetail present under ItemOut.' };
  }

  // Priority 1 & 2: Blanket PO
  if (orderType === 'blanket') {
    // BPO with parent-child: parentAgreementID attribute present with a non-empty value
    const hasParentAgreement = /parentAgreementID\s*=\s*["'][^"']+["']/.test(content);
    if (hasParentAgreement) {
      return {
        docType: 'PO',
        subType: 'BPO With Parent-Child',
        chapters: [
          'cXML Solutions Guide Part14-22 (Purchase Orders, blanket orders)',
          'cXML Reference Guide Part12-21 (OrderRequest, BlanketItemDetail)',
        ],
        notes: 'orderType=blanket with parentAgreementID — child release against a parent blanket PO.',
      };
    }
    return {
      docType: 'PO',
      subType: 'Blanket PO',
      chapters: [
        'cXML Solutions Guide Part14-22 (Purchase Orders, blanket orders)',
        'cXML Reference Guide Part12-21 (OrderRequest, BlanketItemDetail)',
      ],
      notes: 'orderType=blanket. MaxAmount or BlanketItemDetail structure applies.',
    };
  }

  // Priority 3: Release for Blanket PO
  if (orderType === 'release') {
    return {
      docType: 'PO',
      subType: 'Release for Blanket PO',
      chapters: [
        'cXML Solutions Guide Part14-22 (Purchase Orders, blanket orders)',
        'cXML Reference Guide Part12-21 (OrderRequest elements)',
      ],
      notes: 'orderType=release — release order drawn against a blanket PO.',
    };
  }

  // Priority 4: Service PO
  // itemClassification="service" on any ItemOut, or requiresServiceEntry attribute present anywhere
  const hasServiceClassification = /itemClassification\s*=\s*["']service["']/.test(content);
  const hasRequiresServiceEntry  = /requiresServiceEntry\s*=/.test(content);
  if (hasServiceClassification || hasRequiresServiceEntry) {
    return {
      docType: 'PO',
      subType: 'Service PO',
      chapters: [
        'cXML Solutions Guide Part14-22 (Purchase Orders, service purchase orders section)',
        'cXML Reference Guide Part12-21 (OrderRequest, ServiceItem/LimitItem elements)',
      ],
      notes: 'Service PO: itemClassification=service or requiresServiceEntry attribute present.',
    };
  }

  // Priority 5: Non-Catalog PO (orderType=regular only)
  if (orderType === 'regular') {
    const hasIsAdHoc      = /isAdHoc\s*=\s*["']yes["']/.test(content);
    const hasNotAvailable = /SupplierPartID[^<]*Not Available/.test(content);
    if (hasIsAdHoc || hasNotAvailable) {
      return {
        docType: 'PO',
        subType: 'Non-Catalog PO',
        chapters: [
          'cXML Solutions Guide Part14-22 (Purchase Orders)',
          'cXML Reference Guide Part12-21 (OrderRequest elements)',
        ],
        notes: 'Non-catalog PO: isAdHoc=yes or SupplierPartID="Not Available".',
      };
    }
  }

  // Priority 6: Material PO — further split by OrderRequestHeader/@type
  const typeMatch = content.match(/OrderRequestHeader[^>]*\btype\s*=\s*["'](\w+)["']/);
  const headerType = typeMatch ? typeMatch[1].toLowerCase() : 'new';
  const materialSubType = (headerType === 'update' || headerType === 'delete') ? 'Changed PO' : 'Material PO-New';
  return {
    docType: 'PO',
    subType: materialSubType,
    chapters: [
      'cXML Solutions Guide Part14-22 (Purchase Orders)',
      'cXML Reference Guide Part12-21 (OrderRequest elements)',
    ],
    notes: 'Standard material purchase order.',
  };
}

// ── PO Change ─────────────────────────────────────────────────────────────────

function detectPoChangeSubtype(content) {
  return {
    docType: 'PO_CHANGE',
    subType: 'PO Change',
    chapters: [
      'cXML Solutions Guide Part14-22 (change orders section)',
      'cXML Reference Guide Part12-21 (OrderRequest operation=update)',
    ],
    notes: 'OrderRequest with operation=update. May include deleted/modified line items.',
  };
}

// ── OC ────────────────────────────────────────────────────────────────────────

function detectOcSubtype(content) {
  const hasConfirmationItem = content.includes('<ConfirmationItem');

  // ConfirmationHeader@type and @operation
  const headerTypeMatch = content.match(/ConfirmationHeader[^>]*\btype\s*=\s*["'](\w+)["']/);
  const headerType = headerTypeMatch ? headerTypeMatch[1].toLowerCase() : '';
  const operationMatch = content.match(/ConfirmationHeader[^>]*\boperation\s*=\s*["'](\w+)["']/);
  const isUpdate = operationMatch ? operationMatch[1].toLowerCase() === 'update' : false;

  // Priority 1: Header Level Reject All
  if (!hasConfirmationItem && headerType === 'reject') {
    return { docType: 'OC', subType: 'OC_Reject All', chapters: [], notes: 'Header-level OC with type=reject.' };
  }

  // Priority 2: Line Level Reject All — every ConfirmationStatus@type must be "reject"
  if (hasConfirmationItem) {
    const statusTypes = [...content.matchAll(/ConfirmationStatus[^>]*\btype\s*=\s*["'](\w+)["']/g)]
      .map(m => m[1].toLowerCase());
    const allReject = statusTypes.length > 0 && statusTypes.every(t => t === 'reject');
    if (allReject) {
      return { docType: 'OC', subType: 'OC_Reject All', chapters: [], notes: 'Line-level OC with all ConfirmationStatus type=reject.' };
    }
  }

  // Priority 3 & 4: Update variants
  if (isUpdate) {
    const subType = hasConfirmationItem ? 'OC_Line Level Update' : 'OC_Header Level Update';
    return { docType: 'OC', subType, chapters: [], notes: `ConfirmationHeader operation=update.` };
  }

  // Priority 5 & 6: Standard Header/Line Level
  const subType = hasConfirmationItem ? 'OC_Line Level' : 'OC_Header Level';
  return { docType: 'OC', subType, chapters: [], notes: '' };
}

// ── ASN ───────────────────────────────────────────────────────────────────────

function detectAsnSubtype(content) {
  const operationMatch = content.match(/ShipNoticeHeader[^>]*\boperation\s*=\s*["'](\w+)["']/);
  const operation = operationMatch ? operationMatch[1].toLowerCase() : 'new';

  if (operation === 'update') {
    return { docType: 'ASN', subType: 'ASN Update', chapters: [], notes: 'ShipNoticeHeader operation=update.' };
  }
  if (operation === 'delete') {
    return { docType: 'ASN', subType: 'ASN_Delete', chapters: [], notes: 'ShipNoticeHeader operation=delete.' };
  }
  return { docType: 'ASN', subType: 'ASN', chapters: [], notes: 'ShipNoticeHeader operation=new.' };
}

// ── Invoice ───────────────────────────────────────────────────────────────────

function detectInvoiceSubtype(content) {
  // Extract key attributes from InvoiceDetailRequestHeader
  const headerMatch = content.match(/InvoiceDetailRequestHeader([^>]*>)/s);
  const headerAttrs = headerMatch ? headerMatch[1] : '';

  const purpose     = (headerAttrs.match(/\bpurpose\s*=\s*["']([^"']+)["']/)     || [])[1] || 'standard';
  const operation   = (headerAttrs.match(/\boperation\s*=\s*["']([^"']+)["']/)   || [])[1] || '';
  const infoOnly    = (headerAttrs.match(/\bisInformationOnly\s*=\s*["']([^"']+)["']/) || [])[1] || '';

  const isHeaderInvoice = /InvoiceDetailHeaderIndicator[^>]*\bisHeaderInvoice\s*=\s*["']yes["']/.test(content);

  // Priority 1: Cancel Invoice
  if (operation === 'delete') {
    return { docType: 'Invoice', subType: 'Cancel Invoice', chapters: [], notes: 'operation=delete.' };
  }

  // Priority 2: Information Only Invoice
  if (infoOnly === 'yes') {
    return { docType: 'Invoice', subType: 'Information Only Invoice', chapters: [], notes: 'isInformationOnly=yes.' };
  }

  // Priority 3: Header-Level Credit Memo
  if (purpose === 'creditMemo' && isHeaderInvoice) {
    return { docType: 'Invoice', subType: 'Header-Level Credit Memo', chapters: [], notes: 'purpose=creditMemo + isHeaderInvoice=yes.' };
  }

  // Priority 4a: Price Adjustment Credit Memo
  if (purpose === 'lineLevelCreditMemo') {
    const isPriceAdj = /InvoiceDetailLineIndicator[^>]*\bisPriceAdjustmentInLine\s*=\s*["']yes["']/.test(content);
    if (isPriceAdj) {
      return { docType: 'Invoice', subType: 'Price Adjustment Credit Memo', chapters: [], notes: 'purpose=lineLevelCreditMemo + isPriceAdjustmentInLine=yes.' };
    }
    // Priority 4b: Line-Item Credit Memo
    return { docType: 'Invoice', subType: 'Line-Item Credit Memo', chapters: [], notes: 'purpose=lineLevelCreditMemo.' };
  }

  // Priority 5: Debit Memo
  if (purpose === 'debitMemo' && isHeaderInvoice) {
    return { docType: 'Invoice', subType: 'Debit Memo', chapters: [], notes: 'purpose=debitMemo + isHeaderInvoice=yes.' };
  }

  // Priority 6: Line-Item Debit Memo
  if (purpose === 'lineLevelDebitMemo') {
    return { docType: 'Invoice', subType: 'Line-Item Debit Memo', chapters: [], notes: 'purpose=lineLevelDebitMemo.' };
  }

  // Priority 7: Header-Level Invoice (standard, no line items)
  if (isHeaderInvoice) {
    return { docType: 'Invoice', subType: 'Header-Level Invoice', chapters: [], notes: 'isHeaderInvoice=yes.' };
  }

  // Priority 8: Blanket Invoice
  const hasMasterAgreement = content.includes('MasterAgreementReference') || content.includes('MasterAgreementIDInfo');
  if (hasMasterAgreement) {
    return { docType: 'Invoice', subType: 'Blanket Invoice', chapters: [], notes: 'MasterAgreementReference or MasterAgreementIDInfo present.' };
  }

  // Priority 9: Mixed Invoice
  if (content.includes('InvoiceDetailItem') && content.includes('InvoiceDetailServiceItem')) {
    return { docType: 'Invoice', subType: 'Mixed Invoice', chapters: [], notes: 'Both InvoiceDetailItem and InvoiceDetailServiceItem present.' };
  }

  // Priority 10: Service Invoice
  if (content.includes('InvoiceDetailServiceItem')) {
    return { docType: 'Invoice', subType: 'Service Invoice', chapters: [], notes: 'InvoiceDetailServiceItem present.' };
  }

  // Priority 10: Material Invoice (fallback)
  return { docType: 'Invoice', subType: 'Material Invoice', chapters: [], notes: 'InvoiceDetailItem lines.' };
}

module.exports = { detectSubtype };
