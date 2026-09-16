'use strict';

/**
 * cxmlAnonymizer.js
 *
 * Anonymizes sensitive supplier information in cXML documents before Excel generation.
 *
 * Rules:
 *  1. Skip empty/missing values — only process fields that have a value.
 *  2. By doc type, anonymize the cXML Header block:
 *       PO / GR / RA  → <Header><To>
 *       OC / ASN / Invoice (incl. credit/debit memo) → <Header><From>
 *  3. Format-preserving replacement:
 *       - Values containing digits: replace each digit with a cycling digit (0→1,1→2...9→0),
 *         letters and symbols preserved in place.
 *       - Pure text (no digits): replace each letter with 'X', spaces/symbols preserved.
 *  4. Supplier Contact blocks identified by role attribute:
 *       sales, customerService, technicalSupport, supplierCorporate,
 *       SupplierAccount, supplierMasterAccount,
 *       billFrom, from, issuerOfInvoice, remitTo, shipFrom, wireReceivingBank
 *     → anonymize: Name, Street, City, State, PostalCode, Phone, Fax, Email, DeliverTo
 *     → Country is NOT anonymized.
 *  5. DeliverTo (zh/ja only): if first line length > 17, contains digits, or contains
 *     any of _ [ ] ( ) - ; → do NOT anonymize, add a warning instead.
 *     English: always anonymize.
 *  6. SupplierPartID = "Not Available" → skip.
 *  7. <Description> anonymized everywhere EXCEPT under <TaxDetail> or <TaxHeader>.
 */

const { XMLParser, XMLBuilder } = require('fast-xml-parser');

// ── Constants ────────────────────────────────────────────────────────────────

const SUPPLIER_ROLES = new Set([
  'sales', 'customerService', 'technicalSupport', 'supplierCorporate',
  'SupplierAccount', 'supplierMasterAccount',
  'billFrom', 'from', 'issuerOfInvoice', 'remitTo', 'shipFrom', 'wireReceivingBank',
]);

// Doc types that anonymize <Header><To>; all others anonymize <Header><From>
const ANONYMIZE_TO_TYPES = new Set(['PO', 'PO_CHANGE', 'GR', 'RA']);

// Fields to anonymize inside a supplier Contact block (tag names, case-sensitive)
// Email and DeliverTo are handled globally so excluded here
const CONTACT_ANON_FIELDS = new Set([
  'Name', 'Street', 'City', 'State', 'PostalCode',
  'Phone', 'Fax',
]);

const ANONYMIZED_EMAIL = 'xxx@email.com';

// Symbols that disqualify a DeliverTo line from being treated as a pure person name
// Digits: only disqualify when 4+ consecutive digits appear (e.g. postal codes, building numbers like 3F1234)
const DELIVERTO_DISQUALIFY_RE = /[_\[\]()\-;]|\d{4,}/;
const DELIVERTO_MAX_LEN = 17;

// ── Format-preserving replacement ────────────────────────────────────────────

/**
 * Replace digits sequentially starting from 1: 1,2,3,...,9,0,1,2,...
 * In mixed alphanumeric values, letters are preserved; only digits are replaced.
 * In pure-text values (no digits), every letter becomes 'X'.
 * Spaces and symbols are always preserved as-is.
 *
 * Examples:
 *   "2-1-1"          → "1-2-3"
 *   "AN134784827444" → "AN123456789012"
 *   "ACME Corp"      → "XXXX XXXX"
 *   "Plate1"         → "XXXXX1"
 */
function anonymizeString(value) {
  if (!value || value.trim() === '') return value;
  let digitCounter = 0;
  return value.replace(/[a-zA-Z0-9]/g, (ch) => {
    if (/\d/.test(ch)) {
      // counter 0→'1', 1→'2', ..., 8→'9', 9→'0', 10→'1', ...
      const val = ((digitCounter % 10) + 1) % 10;
      digitCounter++;
      return String(val === 0 ? 0 : val);
    }
    return 'X';
  });
}

// ── XML parser / builder configuration ───────────────────────────────────────

function makeParser() {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    parseAttributeValue: false,  // keep attribute values as strings
    parseTagValue: false,        // keep text content as strings
    trimValues: false,           // preserve whitespace for faithful round-trip
    cdataPropName: '__cdata',
    commentPropName: '__comment',
    preserveOrder: true,         // critical: keeps element order intact
  });
}

function makeBuilder() {
  return new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    cdataPropName: '__cdata',
    commentPropName: '__comment',
    preserveOrder: true,
    format: false,               // do not reformat — preserve original indentation
    suppressEmptyNode: false,
  });
}

// ── Traversal helpers ─────────────────────────────────────────────────────────

/**
 * Walk a preserveOrder node array, calling visitor(node, tagName, index, array).
 * The visitor may mutate node in place.
 */
function walk(nodes, visitor, parentTags = []) {
  if (!Array.isArray(nodes)) return;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    for (const key of Object.keys(node)) {
      if (key === ':@' || key === '__comment' || key === '__cdata') continue;
      visitor(node, key, i, nodes, parentTags);
      // Recurse into children
      if (Array.isArray(node[key])) {
        walk(node[key], visitor, [...parentTags, key]);
      }
    }
  }
}

/**
 * Find a direct child node with the given tag name inside a preserveOrder array.
 * Returns the node object or null.
 */
function findChild(nodes, tagName) {
  if (!Array.isArray(nodes)) return null;
  return nodes.find(n => Object.prototype.hasOwnProperty.call(n, tagName)) || null;
}

/**
 * Get text content of a node (first #text child in preserveOrder format).
 */
function getText(nodeChildren) {
  if (!Array.isArray(nodeChildren)) return '';
  const textNode = nodeChildren.find(n => n['#text'] !== undefined);
  return textNode ? String(textNode['#text']) : '';
}

/**
 * Set text content of a node's children array.
 */
function setText(nodeChildren, value) {
  if (!Array.isArray(nodeChildren)) return;
  const textNode = nodeChildren.find(n => n['#text'] !== undefined);
  if (textNode) {
    textNode['#text'] = value;
  } else {
    nodeChildren.unshift({ '#text': value });
  }
}

// ── Core anonymization logic ──────────────────────────────────────────────────

/**
 * Anonymize a Contact block's child fields in place.
 * Returns any warning string, or null.
 */
function anonymizeContactChildren(contactChildren, language, warnings) {
  if (!Array.isArray(contactChildren)) return;

  for (const child of contactChildren) {
    const tag = Object.keys(child).find(k => k !== ':@');
    if (!tag) continue;

    const children = child[tag];

    // Recurse into PostalAddress to reach Street/City/State/PostalCode
    if (tag === 'PostalAddress') {
      anonymizeContactChildren(children, language, warnings);
      continue;
    }

    if (!CONTACT_ANON_FIELDS.has(tag)) continue;

    if (tag === 'Phone' || tag === 'Fax') {
      anonymizePhoneOrFax(children);
      continue;
    }

    // Country: skip entirely
    if (tag === 'Country') continue;

    // All other fields: anonymize text content
    const text = getText(children);
    if (!text || text.trim() === '') continue;
    setText(children, anonymizeString(text));
  }
}

/**
 * Anonymize DeliverTo element, applying zh/ja rule 5.
 */
function anonymizeDeliverTo(children, language, warnings) {
  if (!Array.isArray(children)) return;

  // DeliverTo typically has up to 2 lines as separate #text nodes or child elements.
  // In cXML, DeliverTo is a simple text element; multiple lines may appear as
  // separate DeliverTo elements in the parent. Here we handle the text of this one.
  const text = getText(children);
  if (!text || text.trim() === '') return;

  const firstLine = text.split('\n')[0].trim();

  if (language === 'zh' || language === 'ja') {
    const isNameOnly = (
      firstLine.length <= DELIVERTO_MAX_LEN &&
      !DELIVERTO_DISQUALIFY_RE.test(firstLine)
    );
    if (!isNameOnly) {
      warnings.push(
        `DeliverTo "${firstLine}" — 可能包含非人名信息，请手动确认并脱敏处理。`
      );
      return; // do not anonymize
    }
  }

  setText(children, anonymizeString(text));
}

/**
 * Anonymize Phone/Fax structure.
 * cXML Phone: <Phone><TelephoneNumber><AreaOrCityCode>...</AreaOrCityCode><Number>...</Number></TelephoneNumber></Phone>
 */
function anonymizePhoneOrFax(children) {
  if (!Array.isArray(children)) return;
  walk(children, (node, tag) => {
    if (tag === 'AreaOrCityCode' || tag === 'Number') {
      const text = getText(node[tag]);
      if (text && text.trim()) {
        setText(node[tag], anonymizeString(text));
      }
    }
  });
}

/**
 * Anonymize all <Email> elements globally — regardless of parent context.
 * Replaces any non-empty value with ANONYMIZED_EMAIL.
 */
function anonymizeAllEmails(nodes) {
  walk(nodes, (node, tag) => {
    if (tag !== 'Email') return;
    const text = getText(node[tag]);
    if (!text || text.trim() === '') return;
    setText(node[tag], ANONYMIZED_EMAIL);
  });
}

/**
 * Anonymize all <DeliverTo> elements globally — regardless of parent Contact role.
 * Only the FIRST <DeliverTo> in each parent is anonymized; the second line (address)
 * is left untouched.
 * Applies zh/ja person-name check when language is 'zh' or 'ja'.
 */
function anonymizeAllDeliverTo(nodes, language, warnings) {
  walk(nodes, (node, tag, index, array) => {
    if (tag !== 'DeliverTo') return;
    // Skip if a previous sibling in the same parent array is also a DeliverTo
    const hasPriorSibling = array.slice(0, index).some(
      sibling => Object.prototype.hasOwnProperty.call(sibling, 'DeliverTo')
    );
    if (hasPriorSibling) return;
    anonymizeDeliverTo(node[tag], language, warnings);
  });
}

/**
 * Anonymize all Contact blocks whose role is in SUPPLIER_ROLES.
 */
function anonymizeSupplierContacts(nodes, language, warnings) {
  walk(nodes, (node, tag) => {
    if (tag !== 'Contact') return;
    const attrs = node[':@'] || {};
    const role = attrs['@_role'] || '';
    if (!SUPPLIER_ROLES.has(role)) return;
    anonymizeContactChildren(node[tag], language, warnings);
  });
}

/**
 * Anonymize <SupplierPartID> and <BuyerPartID>, skipping "Not Available".
 */
function anonymizePartIds(nodes) {
  walk(nodes, (node, tag) => {
    if (tag !== 'SupplierPartID' && tag !== 'BuyerPartID') return;
    const text = getText(node[tag]);
    if (!text || text.trim() === '' || text.trim() === 'Not Available') return;
    setText(node[tag], anonymizeString(text));
  });
}

/**
 * Anonymize <Description> everywhere except under <TaxDetail> or <TaxHeader>.
 */
function anonymizeDescriptions(nodes, parentTags = []) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    for (const tag of Object.keys(node)) {
      if (tag === ':@' || tag === '__comment' || tag === '__cdata') continue;

      if (tag === 'Description') {
        const inTaxContext = parentTags.some(t => t === 'TaxDetail' || t === 'TaxHeader');
        if (!inTaxContext) {
          const text = getText(node[tag]);
          if (text && text.trim()) {
            setText(node[tag], anonymizeString(text));
          }
        }
      }

      if (Array.isArray(node[tag])) {
        anonymizeDescriptions(node[tag], [...parentTags, tag]);
      }
    }
  }
}

/**
 * Anonymize the cXML Header <To> or <From> block depending on doc type.
 * NetworkId Identity: preserve "AN" prefix and "-T" suffix, anonymize numeric middle.
 * All other Credential Identity values: anonymize fully with anonymizeString.
 * All text content inside the block (Name, Street, City, State, PostalCode, Phone,
 * Fax, Email, Contact info, etc.) is also anonymized regardless of Contact role.
 */
function anonymizeHeaderBlock(headerChildren, docType) {
  if (!Array.isArray(headerChildren)) return;
  const blockTag = ANONYMIZE_TO_TYPES.has(docType) ? 'To' : 'From';
  const blockNode = findChild(headerChildren, blockTag);
  if (!blockNode) return;

  // Walk Credential nodes directly to handle NetworkId specially
  walk(blockNode[blockTag], (node, tag) => {
    if (tag !== 'Credential') return;
    const attrs = node[':@'] || {};
    const domain = attrs['@_domain'] || '';
    const identityNode = findChild(node[tag], 'Identity');
    if (!identityNode) return;
    const text = getText(identityNode['Identity']);
    if (!text || !text.trim()) return;

    if (domain.toLowerCase() === 'networkid') {
      // Preserve "AN" prefix and optional "-T" suffix; anonymize digits only
      // e.g. AN01650043859-T → AN12345678901-T
      const match = text.match(/^(AN)(\d+)(-T)?$/i);
      if (match) {
        const prefix = match[1].toUpperCase();
        const suffix = match[3] || '';
        let digitCounter = 0;
        const anonDigits = match[2].replace(/\d/g, () => {
          const val = ((digitCounter % 10) + 1) % 10;
          digitCounter++;
          return String(val === 0 ? 0 : val);
        });
        setText(identityNode['Identity'], prefix + anonDigits + suffix);
      } else {
        // Doesn't match expected AN pattern — anonymize fully
        setText(identityNode['Identity'], anonymizeString(text));
      }
    } else {
      // All other credential types (AribaNetworkUserId, VendorID, etc.)
      setText(identityNode['Identity'], anonymizeString(text));
    }
  });

  // Anonymize all contact info inside this block regardless of Contact role.
  // This covers Correspondent/Contact elements (e.g. role="correspondent") that
  // contain real company names, addresses, and phone numbers.
  const CONTACT_TEXT_TAGS = new Set([
    'Name', 'Street', 'City', 'State', 'PostalCode',
  ]);
  walk(blockNode[blockTag], (node, tag) => {
    if (tag === 'Country') return; // Country is never anonymized

    if (CONTACT_TEXT_TAGS.has(tag)) {
      const text = getText(node[tag]);
      if (text && text.trim()) setText(node[tag], anonymizeString(text));
      return;
    }

    if (tag === 'Email') {
      const text = getText(node[tag]);
      if (text && text.trim()) setText(node[tag], ANONYMIZED_EMAIL);
      return;
    }

    if (tag === 'Phone' || tag === 'Fax') {
      anonymizePhoneOrFax(node[tag]);
      return;
    }
  });
}

/**
 * Truncate text content of <Comments> and <Description> elements to 40 characters.
 * Structure is not modified — only the text value is trimmed.
 */
function truncateLongTextFields(nodes) {
  walk(nodes, (node, tag) => {
    if (tag !== 'Comments' && tag !== 'Description') return;
    const text = getText(node[tag]);
    if (!text || text.length <= 40) return;
    setText(node[tag], text.slice(0, 40));
  });
}



/**
 * Anonymize sensitive supplier data in a cXML string.
 *
 * @param {string} xmlContent  - Raw cXML string
 * @param {string} docType     - 'PO' | 'PO_CHANGE' | 'OC' | 'ASN' | 'Invoice' | 'GR' | 'RA' | ...
 * @param {string} language    - 'en' | 'zh' | 'ja'
 * @returns {{ anonymized: string, warnings: string[] }}
 */
function anonymizeCxml(xmlContent, docType, language) {
  if (!xmlContent || xmlContent.trim() === '') {
    return { anonymized: xmlContent, warnings: [] };
  }

  const warnings = [];
  const parser = makeParser();
  const builder = makeBuilder();

  let parsed;
  try {
    parsed = parser.parse(xmlContent);
  } catch (e) {
    // If parsing fails, return original content with a warning rather than crashing
    warnings.push(`cXML parse error — anonymization skipped: ${e.message}`);
    return { anonymized: xmlContent, warnings };
  }

  // parsed is a preserveOrder array; find the root <cXML> node
  const cxmlNode = findChild(parsed, 'cXML');
  if (!cxmlNode) {
    return { anonymized: xmlContent, warnings };
  }

  const cxmlChildren = cxmlNode['cXML'];

  // 1. Anonymize Header <To> or <From> block
  const headerNode = findChild(cxmlChildren, 'Header');
  if (headerNode) {
    anonymizeHeaderBlock(headerNode['Header'], docType);
  }

  // 2. Anonymize all <Email> elements globally (not limited to supplier context)
  anonymizeAllEmails(parsed);

  // 3. Anonymize all <DeliverTo> elements globally (applies zh/ja person-name check)
  anonymizeAllDeliverTo(parsed, language, warnings);

  // 4. Anonymize supplier Contact blocks (role-based)
  anonymizeSupplierContacts(parsed, language, warnings);

  // 5. Anonymize SupplierPartID / BuyerPartID
  anonymizePartIds(parsed);

  // 5. Anonymize Description (except under TaxDetail/TaxHeader)
  anonymizeDescriptions(parsed);

  // 6. Truncate <Comments> and <Description> text to 40 characters
  truncateLongTextFields(parsed);

  let result;
  try {
    result = builder.build(parsed);
  } catch (e) {
    warnings.push(`cXML build error — anonymization skipped: ${e.message}`);
    return { anonymized: xmlContent, warnings };
  }

  // Preserve the original XML declaration if present
  if (xmlContent.trimStart().startsWith('<?xml') && !result.trimStart().startsWith('<?xml')) {
    const declMatch = xmlContent.match(/^<\?xml[^?]*\?>/);
    if (declMatch) result = declMatch[0] + '\n' + result;
  }

  return { anonymized: result, warnings };
}

module.exports = { anonymizeCxml };
