/**
 * extrinsicExtractor.js
 *
 * Extracts <Extrinsic name="...">value</Extrinsic> elements from cXML content.
 * Determines Location (header/line) by inspecting ancestor context.
 * Supports merging multiple cXML files with deduplication.
 */

/**
 * Known header-level ancestor tags for PO.
 * If the nearest relevant ancestor is one of these, location = 'header'.
 */
const HEADER_ANCESTORS = new Set([
  'OrderRequestHeader',
  'ConfirmationHeader',
  'InvoiceDetailRequestHeader',
  'ShipNoticeHeader',
  'Header',
  'MessageHeader',
  'Request',
]);

/**
 * Known line-level ancestor tags.
 * If the nearest relevant ancestor is one of these, location = 'line'.
 */
const LINE_ANCESTORS = new Set([
  'ItemOut',
  'ItemIn',
  'ConfirmationItem',
  'ShipNoticeItem',
  'InvoiceDetailItem',
  'InvoiceDetailServiceItem',
  'InvoiceDetailOrder',
]);

/**
 * Extract all Extrinsic elements from a cXML string.
 * Returns: Array of { name, value, location }
 *   - name: the name attribute value
 *   - value: text content of the element
 *   - location: 'header' | 'line' | ''
 */
function extractExtrinsics(cxmlContent) {
  const results = [];

  // Split into lines for context tracking
  const lines = cxmlContent.split('\n');

  // Track ancestor tag stack as we scan line by line
  const tagStack = [];

  // Regex patterns
  const openTagRe  = /<([A-Za-z][A-Za-z0-9_:-]*)[\s>\/]/g;
  const closeTagRe = /<\/([A-Za-z][A-Za-z0-9_:-]*)\s*>/g;
  const selfCloseRe = /<[A-Za-z][A-Za-z0-9_:-]*[^>]*\/\s*>/g;
  // Matches both self-closing and value-bearing Extrinsic elements:
  //   <Extrinsic name="foo" />              → name="foo", value=""
  //   <Extrinsic name="foo">bar</Extrinsic> → name="foo", value="bar"
  const extrinsicRe = /<Extrinsic\s+name\s*=\s*["']([^"']+)["']\s*(?:\/>()|>([^<]*)<\/Extrinsic>)/g;

  let match;
  while ((match = extrinsicRe.exec(cxmlContent)) !== null) {
    const name  = match[1].trim();
    const value = match[2] !== undefined ? '' : (match[3] || '').trim();
    const offset = match.index;

    const before = cxmlContent.slice(0, offset);
    const location = resolveLocation(before);

    results.push({ name, value, location });
  }

  return results;
}

/**
 * Determine header/line location by scanning the XML text preceding the Extrinsic.
 * Builds a simplified tag stack from the preceding text to find the nearest
 * meaningful ancestor.
 */
function resolveLocation(before) {
  // Build a list of open/close tags in order
  const tagEvents = [];

  const openRe  = /<([A-Za-z][A-Za-z0-9_:-]*)(?:\s[^>]*)?\s*(?!\/)>/g;
  const closeRe = /<\/([A-Za-z][A-Za-z0-9_:-]*)\s*>/g;
  const selfRe  = /<([A-Za-z][A-Za-z0-9_:-]*)(?:\s[^>]*)?\s*\/>/g;

  // Collect all tag events with their position
  const events = [];

  let m;
  while ((m = openRe.exec(before)) !== null) {
    events.push({ pos: m.index, type: 'open', tag: m[1] });
  }
  openRe.lastIndex = 0;

  while ((m = closeRe.exec(before)) !== null) {
    events.push({ pos: m.index, type: 'close', tag: m[1] });
  }
  closeRe.lastIndex = 0;

  while ((m = selfRe.exec(before)) !== null) {
    events.push({ pos: m.index, type: 'self', tag: m[1] });
  }
  selfRe.lastIndex = 0;

  // Sort by position
  events.sort((a, b) => a.pos - b.pos);

  // Build tag stack
  const stack = [];
  for (const ev of events) {
    if (ev.type === 'open') {
      stack.push(ev.tag);
    } else if (ev.type === 'close') {
      // Pop matching tag
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i] === ev.tag) {
          stack.splice(i, 1);
          break;
        }
      }
    }
    // self-closing: no stack change
  }

  // Walk stack from top (innermost) to find nearest known ancestor
  for (let i = stack.length - 1; i >= 0; i--) {
    const tag = stack[i];
    if (LINE_ANCESTORS.has(tag))   return 'line';
    if (HEADER_ANCESTORS.has(tag)) return 'header';
  }

  return '';
}

/**
 * Merge extrinsics from multiple files, with deduplication.
 *
 * fileEntries: Array of { docType, originalname, content }
 *   - docType: 'PO' | 'PO_CHANGE' | 'Invoice' | etc.
 *   - originalname: filename (used for Notes when extrinsic appears in subset only)
 *   - content: raw cXML string
 *
 * Returns: Array of { name, location, example, notes }
 *   Rows are split when same name appears in both header and line.
 */
function mergeExtrinsics(fileEntries) {
  // Map: `${name}::${location}` → { name, location, example, seenIn: Set<label> }
  const map = new Map();
  const allLabels = new Set();

  for (const entry of fileEntries) {
    const label = resolveFileLabel(entry.docType, entry.fileName);
    allLabels.add(label);

    const extracted = extractExtrinsics(entry.content);

    for (const { name, value, location } of extracted) {
      const key = `${name}::${location}`;
      if (map.has(key)) {
        map.get(key).seenIn.add(label);
      } else {
        map.set(key, {
          name,
          location,
          example: value,
          seenIn: new Set([label]),
        });
      }
    }
  }

  // Build output rows
  const rows = [];
  for (const { name, location, example, seenIn } of map.values()) {
    // Notes: if not seen in all files, list which files it appeared in
    let notes = '';
    if (seenIn.size < allLabels.size) {
      notes = [...seenIn].join(', ') + ' only';
    }
    rows.push({ name, location, example, notes });
  }

  // Sort: header first, then line, then unknown; within group alphabetically by name
  rows.sort((a, b) => {
    const locOrder = { header: 0, line: 1, '': 2 };
    const lo = (locOrder[a.location] ?? 2) - (locOrder[b.location] ?? 2);
    if (lo !== 0) return lo;
    return a.name.localeCompare(b.name);
  });

  return rows;
}

/**
 * Produce a human-readable label for a file entry, used in Notes.
 * e.g. 'PO_CHANGE' → 'PO Change', 'PO' → 'PO New'
 */
function resolveFileLabel(docType, originalname) {
  const labels = {
    PO:        'PO New',
    PO_CHANGE: 'PO Change',
    OC:        'OC',
    ASN:       'ASN',
    Invoice:   'Invoice',
    GR:        'GR',
  };
  return labels[docType] || docType;
}

module.exports = { extractExtrinsics, mergeExtrinsics };
