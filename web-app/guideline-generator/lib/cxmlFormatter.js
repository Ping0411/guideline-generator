/**
 * cxmlFormatter.js
 *
 * Parses a cXML string into an array of lines for the A column.
 * Each line is { text, elementName } where elementName is the local XML tag
 * (without namespace/attributes), or null for non-opening-tag lines.
 *
 * The B column description engine uses elementName to match against
 * cxmlHint values from ruleRegistry descriptionTriggers.
 *
 * Matching is element-scoped: attributes spread across multiple lines
 * (pretty-printed cXML) are collected into a single element context,
 * so multi-attribute conditions like @category=VAT + @percentageRate=0
 * are evaluated against the full attribute set of the element, not
 * just a single line.
 */

/**
 * Prettify XML: re-indent with 2-space indent, each attribute on its own line.
 * Tabs are converted to spaces. Equivalent to Notepad++ XML Tools > Pretty print - indent attributes.
 */
function prettifyXml(xml) {
  const INDENT = '  ';

  // Normalise line endings and collapse all whitespace between tags
  const flat = xml
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/>\s+</g, '><')   // remove inter-tag whitespace
    .trim();

  // Tokenise into tags and text nodes
  const tokens = [];
  const re = /(<[^>]+>|[^<]+)/g;
  let m;
  while ((m = re.exec(flat)) !== null) {
    const t = m[1].trim();
    if (t) tokens.push(t);
  }

  const lines = [];
  let depth = 0;
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.startsWith('<?') || token.startsWith('<!--')) {
      lines.push(INDENT.repeat(depth) + token);
      i++;
    } else if (token.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      lines.push(INDENT.repeat(depth) + token);
      i++;
    } else if (token.startsWith('<') && !token.startsWith('</')) {
      const isSelfClosing = token.endsWith('/>');
      const baseIndent = INDENT.repeat(depth);
      const attrIndent = baseIndent + INDENT;

      // Lookahead: if next is text node and the one after is the matching close tag → inline
      const tagNameMatch = token.match(/^<([^\s/>]+)/);
      const tagName = tagNameMatch ? tagNameMatch[1] : null;
      const nextIsText   = i + 1 < tokens.length && !tokens[i+1].startsWith('<');
      const nextIsClose  = i + 2 < tokens.length && tokens[i+2] === `</${tagName}>`;
      const inlineOk     = !isSelfClosing && tagName && nextIsText && nextIsClose;

      if (inlineOk) {
        // Emit as single inline line: <Tag attr="v">text</Tag>
        const textVal = tokens[i+1];
        const closeTag = tokens[i+2];
        // Rebuild open tag with attrs on same line for inline case
        const tagMatch = token.match(/^<([^\s/>]+)([\s\S]*?)(\/?>)$/);
        if (tagMatch && tagMatch[2].trim()) {
          // Has attributes — still put attrs on separate lines, text+close on last attr line
          const attrPart = tagMatch[2].trim();
          const attrs = [];
          const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
          let am;
          while ((am = attrRe.exec(attrPart)) !== null) {
            const val = am[2] !== undefined ? am[2] : am[3];
            const quote = attrPart.includes(`${tagMatch[1]}="${am[1]}"`) || attrPart.match(new RegExp(`${am[1]}="`) ) ? '"' : "'";
            attrs.push(`${am[1]}="${val}"`);
          }
          lines.push(`${baseIndent}<${tagName}`);
          attrs.forEach((a, idx) => {
            if (idx === attrs.length - 1) {
              lines.push(`${attrIndent}${a}>${textVal}${closeTag}`);
            } else {
              lines.push(`${attrIndent}${a}`);
            }
          });
        } else {
          lines.push(`${baseIndent}<${tagName}>${textVal}${closeTag}`);
        }
        i += 3;
        // depth unchanged (open+close balanced, no depth change)
      } else {
        // Normal block rendering
        const tagMatch = token.match(/^<([^\s/>]+)([\s\S]*?)(\/?>)$/);
        if (tagMatch) {
          const attrPart = tagMatch[2].trim();
          const closing  = tagMatch[3];

          if (attrPart) {
            const attrs = [];
            const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
            let am;
            while ((am = attrRe.exec(attrPart)) !== null) {
              const val = am[2] !== undefined ? am[2] : am[3];
              const quote = attrPart.includes(`${am[1]}="`) ? '"' : "'";
              attrs.push(`${am[1]}=${quote}${val}${quote}`);
            }
            if (attrs.length > 0) {
              lines.push(`${baseIndent}<${tagName}`);
              attrs.forEach((a, idx) => {
                lines.push(idx === attrs.length - 1 ? `${attrIndent}${a}${closing}` : `${attrIndent}${a}`);
              });
            } else {
              lines.push(`${baseIndent}${token}`);
            }
          } else {
            lines.push(`${baseIndent}${token}`);
          }
        } else {
          lines.push(`${baseIndent}${token}`);
        }
        if (!isSelfClosing) depth++;
        i++;
      }
    } else {
      // Orphan text node (shouldn't appear after prettify, but handle gracefully)
      lines.push(INDENT.repeat(depth) + token);
      i++;
    }
  }

  return lines.join('\n');
}

/**
 * Split cXML into display lines.
 * Returns: Array of { text: string, elementName: string|null }
 *
 * - text: the raw line as it should appear in the A column cell
 * - elementName: extracted tag name for matching (opening tags only), e.g. "ShipmentDate"
 */
function formatCxml(cxmlContent) {
  const prettified = prettifyXml(cxmlContent);
  const lines = prettified.split('\n');

  return lines.map(line => {
    const trimmed = line.trim();
    const elementName = extractElementName(trimmed);
    return { text: line, elementName };
  });
}

/**
 * Extract the tag name from an opening XML tag line.
 * Returns null for closing tags, comments, PI, text nodes, empty lines.
 *
 * Examples:
 *   "<ShipmentDate type='actual'>"  → "ShipmentDate"
 *   "<cxml:Header>"                 → "Header"
 *   "</ShipmentDate>"               → null
 *   "<!-- comment -->"              → null
 *   "some text content"             → null
 */
function extractElementName(trimmed) {
  if (!trimmed || trimmed.startsWith('</') || trimmed.startsWith('<!--') || trimmed.startsWith('<?')) {
    return null;
  }
  const match = trimmed.match(/^<([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)/);
  if (!match) return null;
  const full = match[1];
  const colon = full.indexOf(':');
  return colon >= 0 ? full.slice(colon + 1) : full;
}

/**
 * Parse cXML content into element blocks.
 *
 * Each block represents one opening tag (possibly spread across multiple lines)
 * and records:
 *   startLine:    0-based index of the line where the tag starts
 *   elementName:  local tag name (namespace stripped)
 *   attrText:     concatenated raw text of the entire opening tag (all lines joined)
 *   pathSegments: array of ancestor element names from root to this element (inclusive)
 *
 * Used by lookupDescriptionForBlock to evaluate multi-attribute conditions
 * against the full attribute set regardless of line breaks.
 */
function parseElementBlocks(lines) {
  const blocks = [];
  let inTag = false;
  let tagStartLine = -1;
  let tagBuffer = '';
  // Path stack: tracks open (non-self-closing) elements for ancestor context
  const pathStack = [];

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text;
    const trimmed = text.trim();

    if (!inTag) {
      // Handle closing tags — pop the path stack
      if (trimmed.startsWith('</')) {
        pathStack.pop();
        continue;
      }

      // Look for a new opening tag (not closing, not comment, not PI)
      if (trimmed.startsWith('<') &&
          !trimmed.startsWith('<!--') &&
          !trimmed.startsWith('<?') &&
          !trimmed.startsWith('<!')) {
        const elemName = extractElementName(trimmed);
        if (elemName) {
          tagStartLine = i;
          tagBuffer = text;

          // Check if the tag closes on this same line (contains > or />)
          // Strip string literals to avoid false positives inside attribute values
          const stripped = trimmed.replace(/"[^"]*"|'[^']*'/g, '""');
          if (stripped.includes('>')) {
            // Self-closing: />
            // Inline-closed: <Elem ...>content</Elem> on same line
            const isSelfClosing = stripped.includes('/>');
            const isInlineClosed = !isSelfClosing && stripped.includes('</' + elemName + '>');
            const currentPath = [...pathStack, elemName];
            blocks.push({ startLine: tagStartLine, elementName: elemName, attrText: tagBuffer, pathSegments: currentPath });
            if (!isSelfClosing && !isInlineClosed) pathStack.push(elemName);
            inTag = false;
            tagBuffer = '';
            tagStartLine = -1;
          } else {
            inTag = true;
          }
        }
      }
    } else {
      // Continue accumulating tag content across lines
      tagBuffer += ' ' + text;
      const stripped = tagBuffer.replace(/"[^"]*"|'[^']*'/g, '""');
      if (stripped.includes('>')) {
        const elemName = extractElementName(tagBuffer.trim());
        if (elemName) {
          const isSelfClosing = stripped.includes('/>');
          const isInlineClosed = !isSelfClosing && stripped.includes('</' + elemName + '>');
          const currentPath = [...pathStack, elemName];
          blocks.push({ startLine: tagStartLine, elementName: elemName, attrText: tagBuffer, pathSegments: currentPath });
          if (!isSelfClosing && !isInlineClosed) pathStack.push(elemName);
        }
        inTag = false;
        tagBuffer = '';
        tagStartLine = -1;
      }
    }
  }

  return blocks;
}

/**
 * Build a description map from descriptionTriggers.
 *
 * Each entry in the returned array:
 *   { pathSegments: string[], elemName: string, attrConditions: [{name,value}]|null, desc: string }
 *
 * pathSegments: the path components from the hint (e.g. ['InvoiceDetailItem','Tax','TaxDetail'])
 * elemName:     the final element name
 * attrConditions: array of {name,value} that must ALL match — or null if hint has no = conditions
 *   (hints like Money@alternateAmount@alternateCurrency with no = are treated as path-only matches)
 * desc:         description text
 */
function buildDescriptionMap(descriptionTriggers) {
  const entries = [];

  for (const trigger of descriptionTriggers) {
    const rawHint = trigger.cxmlElement || trigger.cxmlHint;
    if (!rawHint) continue;

    const desc = trigger.description || trigger.ruleText || '';
    if (!desc) continue;

    const hint = rawHint.trim();
    const slashParts = hint.split('/');
    const lastSegment = slashParts[slashParts.length - 1].trim();
    const pathSegments = slashParts.map(s => s.split('@')[0].trim()).filter(Boolean);

    const atIdx = lastSegment.indexOf('@');
    let elemName, attrConditions;

    if (atIdx >= 0) {
      elemName = lastSegment.slice(0, atIdx).trim();
      const attrPart = lastSegment.slice(atIdx + 1);
      // Parse all @attr=value pairs; skip attr parts without =
      const conditions = attrPart.split('@').map(cond => {
        const eq = cond.indexOf('=');
        if (eq < 0) return null;
        return { name: cond.slice(0, eq).trim(), value: cond.slice(eq + 1).trim() };
      }).filter(Boolean);
      attrConditions = conditions.length > 0 ? conditions : null;
    } else {
      elemName = lastSegment.trim();
      attrConditions = null;
    }

    if (!elemName) continue;

    entries.push({ pathSegments, elemName, attrConditions, desc });
  }

  return entries;
}

/**
 * Parse all attribute key=value pairs from an element's raw tag text.
 * Handles both single and double quotes.
 * Returns: { attrName: attrValue, ... }
 */
function parseAttributes(attrText) {
  const attrs = {};
  const re = /([A-Za-z_][\w.-]*)[\s]*=[\s]*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(attrText)) !== null) {
    attrs[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return attrs;
}

/**
 * Check whether hintPathSegments is a suffix of blockPathSegments.
 * e.g. hint=['InvoiceDetailItem','Tax','TaxDetail'], block=[..., 'InvoiceDetailItem','Tax','TaxDetail'] → true
 * e.g. hint=['Tax','TaxDetail'], block=[..., 'Something','Tax','TaxDetail'] → true
 * e.g. hint=['TaxDetail'], block=['InvoiceDetailItem','Tax','TaxDetail'] → true (only element name)
 */
function pathMatches(blockPathSegments, hintPathSegments) {
  if (!hintPathSegments || hintPathSegments.length === 0) return false;
  if (hintPathSegments.length > blockPathSegments.length) return false;
  const offset = blockPathSegments.length - hintPathSegments.length;
  for (let i = 0; i < hintPathSegments.length; i++) {
    if (blockPathSegments[offset + i] !== hintPathSegments[i]) return false;
  }
  return true;
}

/**
 * Given an element block, find the best matching description from entries.
 *
 * Strategy:
 *   1. Filter entries whose pathSegments is a suffix of the block's pathSegments.
 *   2. Among those, prefer entries with the most specific path (longest pathSegments).
 *   3. If there are @attr=value conditions, all must match.
 *   4. Collect all matching descriptions and join with newline.
 */
function lookupDescriptionForBlock(block, entries) {
  if (!block.elementName) return null;
  const attrs = parseAttributes(block.attrText);

  const matched = [];

  for (const entry of entries) {
    if (entry.elemName !== block.elementName) continue;
    if (!pathMatches(block.pathSegments, entry.pathSegments)) continue;

    // Check attribute conditions
    if (entry.attrConditions) {
      const allMatch = entry.attrConditions.every(({ name, value }) => {
        const actual = attrs[name];
        if (actual === undefined) return false;
        return actual.toLowerCase() === value.toLowerCase();
      });
      if (!allMatch) continue;
    }

    matched.push(entry);
  }

  if (matched.length === 0) return null;

  // Sort by path specificity (longer = more specific), take the most specific
  // But collect ALL entries with the same max specificity
  const maxLen = Math.max(...matched.map(e => e.pathSegments.length));
  const best = matched.filter(e => e.pathSegments.length === maxLen);
  const descs = [...new Set(best.map(e => e.desc))];
  return descs.join('\n');
}

/**
 * Produce the final row data for A and B columns.
 *
 * Returns: Array of { aText: string, bText: string|null, mergeStart: bool, mergeEnd: bool, mergeId: string|null }
 *   - aText: cXML line text (for column A)
 *   - bText: description text (only on the first row of a merge group, or standalone)
 *   - mergeStart: true if this row starts a vertical B-column merge group
 *   - mergeEnd:   true if this row ends a vertical B-column merge group
 *   - mergeId:    shared id for rows in the same merge group (for docSheetWriter to merge)
 */
function buildCxmlRows(cxmlContent, descriptionTriggers) {
  const lines = formatCxml(cxmlContent);

  // Separate regular triggers from mergeGroup triggers
  const regularTriggers = (descriptionTriggers || []).filter(t => !t.mergeGroup);
  const mergeGroupTriggers = (descriptionTriggers || []).filter(t => t.mergeGroup && t.mergeGroup.length > 0);

  const entries = buildDescriptionMap(regularTriggers);

  // Parse element blocks to get full attribute context and path
  const blocks = parseElementBlocks(lines);

  // Build a map: lineIndex → description (regular, non-merge)
  const lineDescMap = new Map();

  for (const block of blocks) {
    const desc = lookupDescriptionForBlock(block, entries);
    if (desc) {
      const existing = lineDescMap.get(block.startLine);
      lineDescMap.set(block.startLine, existing ? existing + '\n' + desc : desc);
    }
  }

  // Build merge groups: for each mergeGroup trigger, find the line indices of each hint
  // mergeInfo: lineIndex → { mergeId, description, isFirst }
  const mergeInfo = new Map();

  for (const trigger of mergeGroupTriggers) {
    const mergeId = trigger.ruleId + '_' + Math.random().toString(36).slice(2, 7);
    const matchedLines = [];

    for (const hint of trigger.mergeGroup) {
      // Build a temporary single-entry map and find matching blocks
      const tempEntries = buildDescriptionMap([{ cxmlElement: hint, description: '__PLACEHOLDER__' }]);
      for (const block of blocks) {
        const desc = lookupDescriptionForBlock(block, tempEntries);
        if (desc) matchedLines.push(block.startLine);
      }
    }

    if (matchedLines.length === 0) continue;

    // Sort and deduplicate line indices
    const sortedLines = [...new Set(matchedLines)].sort((a, b) => a - b);

    sortedLines.forEach((lineIdx, i) => {
      mergeInfo.set(lineIdx, {
        mergeId,
        description: i === 0 ? trigger.description : null,
        isFirst: i === 0,
        isLast: i === sortedLines.length - 1,
      });
    });
  }

  return lines.map(({ text }, i) => {
    const merge = mergeInfo.get(i);
    return {
      aText: text,
      bText: merge ? (merge.isFirst ? merge.description : null) : (lineDescMap.get(i) || null),
      mergeId: merge ? merge.mergeId : null,
      mergeStart: merge ? merge.isFirst : false,
      mergeEnd: merge ? merge.isLast : false,
    };
  });
}

module.exports = { formatCxml, extractElementName, buildDescriptionMap, buildCxmlRows };
