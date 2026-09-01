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
  const hasBlanket    = content.includes('BlanketItemDetail') || content.includes('MaxAmount');
  const hasService    = content.includes('<ServiceItem') || content.includes('<LimitItem') ||
                        content.includes('ServiceDescription') || content.includes('<ServiceLineItem');
  const hasScheduling = content.includes('ScheduleLineItem') || content.includes('isSchedulingAgreement');

  if (hasBlanket) {
    return {
      docType: 'PO',
      subType: 'Blanket PO',
      chapters: [
        'cXML Solutions Guide Part14-22 (Purchase Orders)',
        'cXML Reference Guide Part12-21 (OrderRequest elements)',
        'cXML Solutions Guide: BlanketItemDetail section',
      ],
      notes: 'BlanketItemDetail element present; MaxAmount may be used instead of per-line pricing.',
    };
  }
  if (hasService) {
    return {
      docType: 'PO',
      subType: 'Service PO',
      chapters: [
        'cXML Solutions Guide Part14-22 (Purchase Orders, service purchase orders section)',
        'cXML Reference Guide Part12-21 (OrderRequest, ServiceItem/LimitItem elements)',
      ],
      notes: 'ServiceItem or LimitItem elements present. Line-level structure differs from material PO.',
    };
  }
  if (hasScheduling) {
    return {
      docType: 'PO',
      subType: 'Scheduling Agreement',
      chapters: [
        'cXML Solutions Guide Part14-22 (Purchase Orders)',
        'cXML Reference Guide Part12-21 (OrderRequest elements, ScheduleLineItem)',
      ],
      notes: 'Scheduling agreement release; ScheduleLineItem elements present.',
    };
  }
  return {
    docType: 'PO',
    subType: 'Standard PO',
    chapters: [
      'cXML Solutions Guide Part14-22 (Purchase Orders)',
      'cXML Reference Guide Part12-21 (OrderRequest elements)',
    ],
    notes: 'Standard material purchase order with ItemOut line items.',
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
  const hasServiceLines = content.includes('<ServiceItem') || content.includes('ServiceDescription');

  if (hasServiceLines) {
    return {
      docType: 'OC',
      subType: 'Service Order Confirmation',
      chapters: [
        'cXML Solutions Guide Part23-26 (Order Confirmations)',
        'cXML Reference Guide Part33-37 (ConfirmationRequest elements)',
      ],
      notes: 'Service line items in confirmation; lean/limit service structure applies.',
    };
  }
  return {
    docType: 'OC',
    subType: 'Standard Order Confirmation',
    chapters: [
      'cXML Solutions Guide Part23-26 (Order Confirmations)',
      'cXML Reference Guide Part33-37 (ConfirmationRequest, ConfirmationHeader, ConfirmationItem)',
    ],
    notes: 'Standard ConfirmationRequest with ConfirmationItem elements.',
  };
}

// ── ASN ───────────────────────────────────────────────────────────────────────

function detectAsnSubtype(content) {
  const hasPackaging = content.includes('Packaging') || content.includes('ShippingContainerSerialCode') ||
                       content.includes('SSCC');
  const hasHazmat    = content.includes('Hazard') || content.includes('HazardousInfo');

  if (hasPackaging) {
    return {
      docType: 'ASN',
      subType: 'ASN with Handling Units',
      chapters: [
        'cXML Solutions Guide Part23-26 (Ship Notices)',
        'cXML Reference Guide Part33-37 (ShipNoticeRequest, ShipNoticePortion, packaging)',
      ],
      notes: 'Packaging/SSCC elements present. Handling unit hierarchy applies.',
    };
  }
  return {
    docType: 'ASN',
    subType: 'Standard ASN',
    chapters: [
      'cXML Solutions Guide Part23-26 (Ship Notices)',
      'cXML Reference Guide Part33-37 (ShipNoticeRequest, ShipNoticeHeader, ShipNoticePortion)',
    ],
    notes: 'Standard ShipNoticeRequest structure.',
  };
}

// ── Invoice ───────────────────────────────────────────────────────────────────

function detectInvoiceSubtype(content) {
  const purpose = (content.match(/purpose\s*=\s*["'](\w+)["']/) || [])[1] || '';

  const isCreditMemo   = purpose === 'creditMemo'   || content.includes('purpose="creditMemo"')   || content.includes("purpose='creditMemo'");
  const isDebitMemo    = purpose === 'debitMemo'    || content.includes('purpose="debitMemo"')    || content.includes("purpose='debitMemo'");
  const hasService     = content.includes('InvoiceDetailServiceItem') || content.includes('<ServiceItem');
  const hasContract    = content.includes('MasterAgreementReference') || content.includes('ContractReference');
  const hasNonPO       = content.includes('NonPOInvoice') || !content.includes('OrderReference');

  if (isCreditMemo) {
    return {
      docType: 'Invoice',
      subType: 'Credit Memo',
      chapters: [
        'cXML Solutions Guide Part30-37 (Invoices, credit memo section)',
        'cXML Reference Guide Part38-45 (InvoiceDetailRequest, purpose=creditMemo)',
      ],
      notes: 'purpose=creditMemo. Line-item credit memos use negative quantities or amounts.',
    };
  }
  if (isDebitMemo) {
    return {
      docType: 'Invoice',
      subType: 'Debit Memo',
      chapters: [
        'cXML Solutions Guide Part30-37 (Invoices)',
        'cXML Reference Guide Part38-45 (InvoiceDetailRequest, purpose=debitMemo)',
      ],
      notes: 'purpose=debitMemo.',
    };
  }
  if (hasService) {
    return {
      docType: 'Invoice',
      subType: 'Service Invoice',
      chapters: [
        'cXML Solutions Guide Part30-37 (Invoices, service invoice section)',
        'cXML Reference Guide Part38-45 (InvoiceDetailServiceItem, UnitRate, Period)',
      ],
      notes: 'InvoiceDetailServiceItem elements present. UnitRate and Period differ from material invoice.',
    };
  }
  if (hasContract) {
    return {
      docType: 'Invoice',
      subType: 'Contract Invoice',
      chapters: [
        'cXML Solutions Guide Part30-37 (Invoices)',
        'cXML Reference Guide Part38-45 (InvoiceDetailRequest, MasterAgreementReference)',
      ],
      notes: 'Contract/BPO reference present. MasterAgreementReference element applies.',
    };
  }
  return {
    docType: 'Invoice',
    subType: 'Standard Invoice',
    chapters: [
      'cXML Solutions Guide Part30-37 (Invoices)',
      'cXML Reference Guide Part38-45 (InvoiceDetailRequest, InvoiceDetailItem)',
    ],
    notes: 'Standard material invoice with InvoiceDetailItem line items.',
  };
}

module.exports = { detectSubtype };
