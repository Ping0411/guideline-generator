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
 * Elements whose attributes are semantically paired (e.g. domain+identifier, startDate+endDate).
 * These stay on one line even with 2+ attributes.
 * Elements NOT in this set with 2+ attributes get each attribute on its own line.
 */
const INLINE_PAIR_ELEMENTS = new Set([
  // domain + identifier/value pairs (缺少其中一个属性则另一个失去意义)
  'IdReference',        // domain + identifier — 分类系统名 + 该系统内的标识
  'Characteristic',     // domain + value      — 特征类型 + 值
  'ItemIndicator',      // domain + value      — 指示器类型 + 值
  'InternalID',         // domain + text value — 分类系统名 + 内部ID值
  'Classification',     // domain + code       — 分类系统名 + 分类码

  // name + value pairs
  'SearchDataElement',  // name + value        — 字段名 + 字段值，典型 key=value
  'SearchAttribute',    // name + type         — 属性名 + 类型，配对语义
  // Note: Extrinsic has text content (not empty), handled by inlineOk path

  // tolerance pairs (数值+单位缺一则意义不完整)
  'TimeTolerance',      // limit + type        — 数值 + 单位（如"3 days"）

  // reference pairs
  'DocumentReference',  // payloadID (single attr)
  'OriginalDocument',   // payloadID (single attr)
  'PaymentProposalIDInfo', // paymentProposalID (single attr)
  'TermReference',      // termName + term     — 属性名 + 属性值，配对指向外部条款

  // role/owner pairs
  'OwnerInfo',          // owner + role        — 用户ID + 角色，合起来描述一个责任人

  // code description pairs
  'QNCode',             // domain + code       — 代码域 + 代码值，配对才能定位一个质量通知代码
  'Segment',            // type + id           — 会计段类型 + 该类型下的ID，配对才能定位

  // leaf text-content elements (文本是值，属性是修饰，保持一行)
  'Email',              // text=email address, name/preferredLang are modifiers

  // single-attribute elements (always inline)
  'AccountCurrency',
  'BestBeforeDate',
  'ExpiryDate',
  'TemporaryPrice',
  'DiscountPercent',
  'DeductionPercent',
  'Percentage',
  'BatchInfo',
  'Routing',
  'TripType',
  'URLPost',
  'AutoPublish',
  'SubscriptionVersion',
  'PersonRole',
  'OrganizationRole',
  'PaymentInformation',
  'ShipNoticeLineItemReference',
  'ReceiptLineItemReference',
  'TimeCardIDInfo',
]);

/**
 * Prettify XML: re-indent with 2-space indent, each attribute on its own line.
 * Tabs are converted to spaces. Equivalent to Notepad++ XML Tools > Pretty print - indent attributes.
 */
function prettifyXml(xml) {
  const INDENT = '    ';  // 4 spaces per level
  const ATTR_EXTRA = '    '; // extra 4 spaces for attribute continuation lines

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

    if (token.startsWith('<?') || token.startsWith('<!--') || token.startsWith('<!')) {
      // XML declaration, comments, DOCTYPE — emit as-is without changing depth
      lines.push(INDENT.repeat(depth) + token);
      i++;
    } else if (token.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      lines.push(INDENT.repeat(depth) + token);
      i++;
    } else if (token.startsWith('<') && !token.startsWith('</')) {
      const isSelfClosing = token.endsWith('/>');
      const baseIndent = INDENT.repeat(depth);

      // Lookahead: if next is text node and the one after is the matching close tag → inline
      const tagNameMatch = token.match(/^<([^\s/>]+)/);
      const tagName = tagNameMatch ? tagNameMatch[1] : null;
      // Fixed attribute indent: base level indent + extra 8 spaces
      const attrIndent = baseIndent + ATTR_EXTRA;
      const nextIsText   = i + 1 < tokens.length && !tokens[i+1].startsWith('<');
      const nextIsClose  = i + 2 < tokens.length && tokens[i+2] === `</${tagName}>`;
      const nextIsEmptyClose = i + 1 < tokens.length && tokens[i+1] === `</${tagName}>`;

      // Leaf nodes with text content always render inline regardless of attribute count.
      const inlineOk = !isSelfClosing && tagName && nextIsText && nextIsClose;
      const inlineEmpty  = !isSelfClosing && tagName && nextIsEmptyClose;

      if (inlineEmpty && !nextIsText) {
        // Empty element with attributes: decide inline vs split based on element type
        const tagMatch = token.match(/^<([^\s/>]+)([\s\S]*?)(\/?>)$/);
        const attrPart = tagMatch ? tagMatch[2].trim() : '';
        if (attrPart) {
          // Count attributes
          const attrRe2 = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
          let attrCount = 0;
          while (attrRe2.exec(attrPart) !== null) attrCount++;

          if (attrCount >= 2 && !INLINE_PAIR_ELEMENTS.has(tagName)) {
            // Split: each attribute on its own line
            const attrs = [];
            const attrRe3 = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
            let am;
            while ((am = attrRe3.exec(attrPart)) !== null) {
              const val = am[2] !== undefined ? am[2] : am[3];
              const quote = attrPart.includes(`${am[1]}="`) ? '"' : "'";
              attrs.push(`${am[1]}=${quote}${val}${quote}`);
            }
            lines.push(`${baseIndent}<${tagName}`);
            attrs.forEach((a, idx) => {
              lines.push(idx === attrs.length - 1 ? `${attrIndent}${a}></${tagName}>` : `${attrIndent}${a}`);
            });
          } else {
            // Inline: keep on one line (paired attrs or single attr)
            lines.push(`${baseIndent}<${tagName} ${attrPart}></${tagName}>`);
          }
        } else {
          lines.push(`${baseIndent}<${tagName}></${tagName}>`);
        }
        i += 2;
        // depth unchanged
      } else if (inlineOk) {
        // Emit as inline line: <Tag attr="v">text</Tag>
        // If single attr (or no attr): one line
        // If multiple attrs: split attrs, last attr line includes >text</Tag>
        const textVal = tokens[i+1];
        const closeTag = tokens[i+2];
        const tagMatch = token.match(/^<([^\s/>]+)([\s\S]*?)(\/?>)$/);
        if (tagMatch && tagMatch[2].trim()) {
          const attrPart = tagMatch[2].trim();
          const attrs = [];
          const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
          let am;
          while ((am = attrRe.exec(attrPart)) !== null) {
            const val = am[2] !== undefined ? am[2] : am[3];
            const quote = attrPart.includes(`${am[1]}="`) ? '"' : "'";
            attrs.push(`${am[1]}=${quote}${val}${quote}`);
          }
          if (attrs.length <= 1 || INLINE_PAIR_ELEMENTS.has(tagName)) {
            // Single attr, no attr, or whitelisted element: keep on one line
            lines.push(`${baseIndent}<${tagName} ${attrPart}>${textVal}${closeTag}`);
          } else {
            // Multiple attrs: split, last attr gets >text</Tag> appended
            lines.push(`${baseIndent}<${tagName}`);
            attrs.forEach((a, idx) => {
              if (idx === attrs.length - 1) {
                lines.push(`${attrIndent}${a}>${textVal}${closeTag}`);
              } else {
                lines.push(`${attrIndent}${a}`);
              }
            });
          }
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
              if (attrs.length === 1) {
                // Single-attribute: always keep on one line (matches template format)
                lines.push(`${baseIndent}<${tagName} ${attrs[0]}${closing}`);
              } else if (isSelfClosing && attrs.length === 2 && INLINE_PAIR_ELEMENTS.has(tagName)) {
                // Two-attribute self-closing paired element: keep on one line
                // (e.g. <IdReference domain="x" identifier="y"/> <Extrinsic name="x"/>)
                lines.push(`${baseIndent}<${tagName} ${attrs.join(' ')}${closing}`);
              } else {
                // Multi-attribute (3+ attrs, or non-self-closing with 2+): split
                lines.push(`${baseIndent}<${tagName}`);
                attrs.forEach((a, idx) => {
                  lines.push(idx === attrs.length - 1 ? `${attrIndent}${a}${closing}` : `${attrIndent}${a}`);
                });
              }
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
  const normalized = cxmlContent.replace(
    /(<Extrinsic\s+name="invoiceSubmissionMethod">)[^<]*/,
    '$1cXML'
  );
  const prettified = prettifyXml(normalized);
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

    let attrTarget = null; // attribute name to write description to (no =value conditions)

    if (atIdx >= 0) {
      elemName = lastSegment.slice(0, atIdx).trim();
      const attrPart = lastSegment.slice(atIdx + 1);
      // Parse all @attr=value pairs; collect attr-only names separately
      const conditions = [];
      const attrOnlyNames = [];
      for (const cond of attrPart.split('@')) {
        const eq = cond.indexOf('=');
        if (eq < 0) {
          const name = cond.trim();
          if (name) attrOnlyNames.push(name);
        } else {
          conditions.push({ name: cond.slice(0, eq).trim(), value: cond.slice(eq + 1).trim() });
        }
      }
      attrConditions = conditions.length > 0 ? conditions : null;
      // If hint is "Parent/@attr" (lastSegment starts with @, no elemName prefix),
      // take the element name from the previous path segment
      if (!elemName && slashParts.length >= 2) {
        const prevSegment = slashParts[slashParts.length - 2].trim();
        elemName = prevSegment.split('@')[0].trim();
      }
      // If the hint has exactly one attr-only name (no =value) and no =value conditions,
      // record it as the target row for description placement
      if (attrOnlyNames.length === 1 && conditions.length === 0) {
        attrTarget = attrOnlyNames[0];
      }
    } else {
      elemName = lastSegment.trim();
      attrConditions = null;
    }

    if (!elemName) continue;

    entries.push({ pathSegments, elemName, attrConditions, attrTarget, desc });
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
function buildCxmlRows(cxmlContent, descriptionTriggers, docType) {
  const lines = formatCxml(cxmlContent);

  // Separate special triggers from regular/mergeGroup triggers
  const containsRoleTriggers = (descriptionTriggers || []).filter(t =>
    t.cxmlElement && t.cxmlElement.includes('@_containsRole=')
  );
  const normalTriggers = (descriptionTriggers || []).filter(t =>
    !t.mergeGroup && !(t.cxmlElement && t.cxmlElement.includes('@_containsRole='))
  );
  const mergeGroupTriggers = (descriptionTriggers || []).filter(t => t.mergeGroup && t.mergeGroup.length > 0);

  const entries = buildDescriptionMap(normalTriggers);

  // Parse element blocks to get full attribute context and path
  const blocks = parseElementBlocks(lines);

  // Build a map: lineIndex → description (regular, non-merge)
  const lineDescMap = new Map();

  for (const block of blocks) {
    // Process each entry individually to support per-attribute row targeting
    const blockAttrs = parseAttributes(block.attrText);

    for (const entry of entries) {
      if (entry.elemName !== block.elementName) continue;
      if (!pathMatches(block.pathSegments, entry.pathSegments)) continue;

      // Check attribute conditions (=value constraints)
      if (entry.attrConditions) {
        const allMatch = entry.attrConditions.every(({ name, value }) => {
          const actual = blockAttrs[name];
          return actual !== undefined && actual.toLowerCase() === value.toLowerCase();
        });
        if (!allMatch) continue;
      }

      // Determine target line
      let targetLine = block.startLine;

      if (entry.attrTarget) {
        // Find the line containing attrTarget= within the block's opening tag span.
        // If the attribute doesn't exist in this block at all, skip — don't fall back
        // to startLine, which would wrongly annotate every instance of the element.
        const attrName = entry.attrTarget;
        if (!(attrName in blockAttrs)) continue;
        for (let li = block.startLine; li < lines.length; li++) {
          const lineText = lines[li].text;
          if (new RegExp(`\\b${attrName}\\s*=`).test(lineText)) {
            targetLine = li;
            break;
          }
          // Stop scanning once we pass the tag close
          if (li > block.startLine) {
            const stripped = lineText.replace(/"[^"]*"|'[^']*'/g, '""');
            if (stripped.includes('>')) break;
          }
        }
      }

      const existing = lineDescMap.get(targetLine);
      lineDescMap.set(targetLine, existing ? existing + '\n' + entry.desc : entry.desc);
    }
  }

  // Handle InvoicePartner@_containsRole= triggers:
  // For each trigger, find the InvoicePartner block whose subtree contains
  // a Contact element with the matching role attribute, then write the
  // description to that InvoicePartner's start line.
  for (const trigger of containsRoleTriggers) {
    const roleMatch = trigger.cxmlElement.match(/@_containsRole=(.+)$/);
    if (!roleMatch) continue;
    const targetRole = roleMatch[1].toLowerCase();

    // Walk blocks to find Contact elements with matching role
    for (const block of blocks) {
      if (block.elementName !== 'Contact') continue;
      const attrs = parseAttributes(block.attrText);
      if ((attrs.role || '').toLowerCase() !== targetRole) continue;

      // Found the Contact — now walk backwards in blocks to find the nearest
      // InvoicePartner ancestor (its startLine < block.startLine and it's in the path)
      let ipStartLine = null;
      for (let bi = blocks.indexOf(block) - 1; bi >= 0; bi--) {
        if (blocks[bi].elementName === 'InvoicePartner' && blocks[bi].startLine < block.startLine) {
          ipStartLine = blocks[bi].startLine;
          break;
        }
      }
      if (ipStartLine === null) continue;

      const existing = lineDescMap.get(ipStartLine);
      lineDescMap.set(ipStartLine, existing ? existing + '\n' + trigger.description : trigger.description);
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

  const blockMarks = computeBlockMarks(lines, descriptionTriggers, docType);

  return lines.map(({ text }, i) => {
    const merge = mergeInfo.get(i);
    return {
      aText: text,
      bText: merge ? (merge.isFirst ? merge.description : null) : (lineDescMap.get(i) || null),
      mergeId: merge ? merge.mergeId : null,
      mergeStart: merge ? merge.isFirst : false,
      mergeEnd: merge ? merge.isLast : false,
      blockMark: blockMarks[i] || null,
    };
  });
}

/**
 * Compute per-line block marks for border-box rendering.
 *
 * Returns an array of marks, one per line. Each mark:
 *   { boxes: Array<{ kind: 'outer'|'section'|'item', start: bool, end: bool }> }
 *
 * 'outer'   — level 0: whole cXML document (A + B columns)
 * 'section' — level 1: major structural section (A + B columns)
 * 'item'    — level 2: individual line item (B column only)
 *
 * Per-docType section elements (A+B box, one box per contiguous block):
 *   PO / PO_CHANGE : Header, OrderRequestHeader, ItemOut (all as one group)
 *   OC             : Header, ConfirmationHeader, ConfirmationItem (all as one group)
 *   ASN            : Header, ShipNoticeHeader, ShipNoticePortion
 *   Invoice        : Header, InvoiceDetailRequestHeader, InvoiceDetailOrder, InvoiceDetailSummary
 *   GR             : Header, ReceiptRequestHeader, ReceiptOrder, Total
 *
 * Per-docType item elements (B column only, one box per element instance):
 *   PO / PO_CHANGE : ItemOut
 *   OC             : ConfirmationItem
 *   ASN            : ShipNoticeItem
 *   Invoice        : InvoiceDetailItem, InvoiceDetailServiceItem, InvoicePartner,
 *                    InvoiceDetailShipping, + any element named in B descriptions as "XXX Element"
 *   GR             : ReceiptItem
 */

const DOC_SECTION_ELEMENTS = {
  PO:        ['Header', 'OrderRequestHeader', 'ItemOut'],
  PO_CHANGE: ['Header', 'OrderRequestHeader', 'ItemOut'],
  OC:        ['Header', 'ConfirmationHeader', 'ConfirmationItem'],
  ASN:       ['Header', 'ShipNoticeHeader', 'ShipNoticePortion'],
  Invoice:   ['Header', 'InvoiceDetailRequestHeader', 'InvoiceDetailOrder', 'InvoiceDetailSummary'],
  GR:        ['Header', 'ReceiptRequestHeader', 'ReceiptOrder', 'Total'],
};

// For A column: these section elements are grouped — all instances share one box
const DOC_GROUP_SECTIONS = {
  PO:        ['ItemOut'],
  PO_CHANGE: ['ItemOut'],
  OC:        ['ConfirmationItem'],
};

// For B column: these elements each get their own individual box
const DOC_ITEM_ELEMENTS = {
  PO:        ['ItemOut'],
  PO_CHANGE: ['ItemOut'],
  OC:        ['ConfirmationItem'],
  ASN:       ['ShipNoticeItem'],
  Invoice:   ['InvoiceDetailItem', 'InvoiceDetailServiceItem', 'InvoicePartner', 'InvoiceDetailShipping'],
  GR:        ['ReceiptItem'],
};

function computeBlockMarks(lines, descriptionTriggers, docType) {
  const n = lines.length;
  // Each entry: array of box specs applied to this line
  const marks = Array.from({ length: n }, () => ({ boxes: [] }));
  const texts = lines.map(l => l.text.trim());

  // ── Level 0: outer box (entire document) ────────────────────────────────
  let outerStart = 0;
  let outerEnd   = n - 1;
  while (outerStart < n && !texts[outerStart]) outerStart++;
  while (outerEnd > outerStart && !texts[outerEnd]) outerEnd--;
  applyBox(marks, outerStart, outerEnd, 'outer');

  // Normalise docType (PO_CHANGE → PO_CHANGE, but fall back to PO for unknowns)
  const dt = docType || '';

  // ── Level 1: section boxes (A + B) ──────────────────────────────────────
  const sectionElems  = DOC_SECTION_ELEMENTS[dt] || [];
  const groupedElems  = DOC_GROUP_SECTIONS[dt]   || [];

  // Find all first-open-tag positions for each section element
  // For grouped elements (e.g. all ItemOut), find the range from first to last
  // For non-grouped, each element instance gets its own section box
  const sectionRanges = computeSectionRanges(texts, sectionElems, groupedElems, outerEnd);
  for (const { start, end } of sectionRanges) {
    applyBox(marks, start, end, 'section');
  }

  // ── Level 2: item boxes (B column only) ─────────────────────────────────
  const itemElems = [...(DOC_ITEM_ELEMENTS[dt] || [])];

  // For all doc types: also add elements mentioned as "XXX Element" in B descriptions
  if (descriptionTriggers) {
    const mentioned = extractMentionedElements(descriptionTriggers);
    for (const e of mentioned) {
      if (!itemElems.includes(e)) itemElems.push(e);
    }
  }

  for (const elem of itemElems) {
    const ranges = findElementRanges(texts, elem);
    for (const { start, end } of ranges) {
      applyBox(marks, start, end, 'item');
    }
  }

  return marks;
}

/**
 * Compute section ranges for A-column boxes.
 * Non-grouped elements: each top-level instance is its own range.
 * Grouped elements: all instances share one range (first open to last close).
 */
function computeSectionRanges(texts, sectionElems, groupedElems, outerEnd) {
  if (!sectionElems.length) return [];

  // Collect per-element first-occurrence open positions
  // We want each TOP-LEVEL occurrence (depth=0 before open)
  const ranges = [];

  // For each section element, find all top-level instance ranges
  const allInstances = []; // { elem, start, end }

  for (const elem of sectionElems) {
    const instances = findElementRanges(texts, elem);
    for (const r of instances) {
      allInstances.push({ elem, ...r });
    }
  }

  // Sort by start position
  allInstances.sort((a, b) => a.start - b.start);

  // Build section ranges:
  // - grouped elements: merge all instances of that element into one range
  // - non-grouped: each instance is its own section, ending just before the next section starts
  const grouped = new Map(); // elem → { start, end }

  for (const inst of allInstances) {
    if (groupedElems.includes(inst.elem)) {
      if (!grouped.has(inst.elem)) {
        grouped.set(inst.elem, { start: inst.start, end: inst.end });
      } else {
        grouped.get(inst.elem).end = inst.end;
      }
    }
  }

  // Build final list: non-grouped instances + merged grouped ranges
  const finalList = [];
  const seenGrouped = new Set();

  for (const inst of allInstances) {
    if (groupedElems.includes(inst.elem)) {
      if (!seenGrouped.has(inst.elem)) {
        seenGrouped.add(inst.elem);
        finalList.push({ start: grouped.get(inst.elem).start, end: grouped.get(inst.elem).end });
      }
    } else {
      finalList.push({ start: inst.start, end: inst.end });
    }
  }

  // Sort and trim overlaps: use real close positions, do NOT extend beyond actual end
  finalList.sort((a, b) => a.start - b.start);
  // Cap at outerEnd only
  for (let i = 0; i < finalList.length; i++) {
    if (finalList[i].end > outerEnd) finalList[i].end = outerEnd;
  }

  return finalList;
}

/**
 * Find all top-level (depth=0) open/close ranges for a given element name.
 * Returns: Array of { start, end } line indices.
 */
function findElementRanges(texts, elem) {
  const openRe     = new RegExp(`^<${elem}(?:[\\s>]|$)`);
  const closeRe    = new RegExp(`^<\\/${elem}\\s*>`);
  const selfCloseRe = new RegExp(`^<${elem}(?:[\\s]|$)[^>]*\\/>`);
  const ranges  = [];
  let depth = 0;
  let rangeStart = null;

  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];

    // Single-line self-closing tag
    if (selfCloseRe.test(t)) {
      if (depth === 0) ranges.push({ start: i, end: i });
      continue;
    }

    const isOpen  = openRe.test(t) && !t.endsWith('/>');
    const isClose = closeRe.test(t);

    if (isOpen) {
      if (depth === 0) {
        rangeStart = i;
        // Check if this is a multi-line self-closing element
        const closingIdx = findMultiLineSelfClose(texts, i);
        if (closingIdx !== null) {
          ranges.push({ start: i, end: closingIdx });
          rangeStart = null;
          i = closingIdx;
          continue;
        }
      }
      depth++;
    }
    if (isClose) {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && rangeStart !== null) {
        ranges.push({ start: rangeStart, end: i });
        rangeStart = null;
      }
    }
  }

  return ranges;
}

/**
 * Detect a multi-line self-closing element starting at lineIdx.
 * A multi-line self-close looks like:
 *   <Foo
 *     attr="val"
 *     attr2="val2"/>
 * We scan forward from lineIdx+1. If we hit a line ending with '/>' before
 * seeing any child open tag or close tag, it's a self-close and we return
 * the index of the '/>'-line. Otherwise return null.
 */
function findMultiLineSelfClose(texts, lineIdx) {
  // The first line must be an open tag without '>' (attribute-spread start)
  const firstLine = texts[lineIdx];
  if (firstLine.includes('>')) return null; // already closed on same line

  for (let j = lineIdx + 1; j < texts.length && j < lineIdx + 30; j++) {
    const t = texts[j];
    if (t.endsWith('/>')) return j;  // self-close found
    if (t.startsWith('<') && !t.startsWith('</')) return null; // child element — not self-close
    if (t.startsWith('</')) return null; // close tag — not expected here
    if (t.endsWith('>') && !t.endsWith('/>')) return null; // normal open close on this line
  }
  return null;
}

/**
 * Extract element names mentioned as "XXX Element" in description trigger texts.
 * e.g. "Tax Element: ..." → "Tax"
 */
function extractMentionedElements(descriptionTriggers) {
  const elems = new Set();
  const re = /\b([A-Z][A-Za-z0-9]+)\s+[Ee]lement\b/g;
  for (const t of descriptionTriggers) {
    const text = t.description || '';
    let m;
    while ((m = re.exec(text)) !== null) {
      elems.add(m[1]);
    }
  }
  return [...elems];
}

/**
 * Apply a box spec to a line range.
 */
function applyBox(marks, start, end, kind) {
  for (let i = start; i <= end; i++) {
    marks[i].boxes.push({
      kind,
      start: i === start,
      end:   i === end,
    });
  }
}

function extractTagName(text) {
  const m = text.match(/^<\/?([A-Za-z][A-Za-z0-9_:-]*)/);
  return m ? m[1].replace(/^.*:/, '') : null;
}

function isOpenTag(text) {
  return text.startsWith('<') && !text.startsWith('</') && !text.startsWith('<?') && !text.startsWith('<!--');
}

module.exports = { formatCxml, extractElementName, buildDescriptionMap, buildCxmlRows };
