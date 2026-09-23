"use strict";
var CxmlAnonymizer = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // node_modules/fast-xml-parser/lib/fxp.cjs
  var require_fxp = __commonJS({
    "node_modules/fast-xml-parser/lib/fxp.cjs"(exports, module) {
      (() => {
        "use strict";
        var t = { d: (e2, i2) => {
          for (var n2 in i2) t.o(i2, n2) && !t.o(e2, n2) && Object.defineProperty(e2, n2, { enumerable: true, get: i2[n2] });
        }, o: (t2, e2) => Object.prototype.hasOwnProperty.call(t2, e2), r: (t2) => {
          "undefined" != typeof Symbol && Symbol.toStringTag && Object.defineProperty(t2, Symbol.toStringTag, { value: "Module" }), Object.defineProperty(t2, "__esModule", { value: true });
        } }, e = {};
        t.r(e), t.d(e, { XMLBuilder: () => $e, XMLParser: () => ie, XMLValidator: () => Pe });
        const i = ":A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD", n = new RegExp("^[" + i + "][" + i + "\\-.\\d\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$"), r = function(t2) {
          return !(null == n.exec(t2));
        }, s = ["hasOwnProperty", "toString", "valueOf", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"], o = ["__proto__", "constructor", "prototype"], a = { allowBooleanAttributes: false, unpairedTags: [] };
        function l(t2, e2) {
          e2 = Object.assign({}, a, e2);
          const i2 = [];
          let n2 = false, r2 = false;
          "\uFEFF" === t2[0] && (t2 = t2.substr(1));
          for (let s2 = 0; s2 < t2.length; s2++) if ("<" === t2[s2] && "?" === t2[s2 + 1]) {
            if (s2 += 2, s2 = c(t2, s2), s2.err) return s2;
          } else {
            if ("<" !== t2[s2]) {
              if (p(t2[s2])) continue;
              return x("InvalidChar", "char '" + t2[s2] + "' is not expected.", N(t2, s2));
            }
            {
              let o2 = s2;
              if (s2++, "!" === t2[s2]) {
                s2 = h(t2, s2);
                continue;
              }
              {
                let a2 = false;
                "/" === t2[s2] && (a2 = true, s2++);
                let l2 = "";
                for (; s2 < t2.length && ">" !== t2[s2] && " " !== t2[s2] && "	" !== t2[s2] && "\n" !== t2[s2] && "\r" !== t2[s2]; s2++) l2 += t2[s2];
                if (l2 = l2.trim(), "/" === l2[l2.length - 1] && (l2 = l2.substring(0, l2.length - 1), s2--), !y(l2)) {
                  let e3;
                  return e3 = 0 === l2.trim().length ? "Invalid space after '<'." : "Tag '" + l2 + "' is an invalid name.", x("InvalidTag", e3, N(t2, s2));
                }
                const d2 = f(t2, s2);
                if (false === d2) return x("InvalidAttr", "Attributes for '" + l2 + "' have open quote.", N(t2, s2));
                let u2 = d2.value;
                if (s2 = d2.index, "/" === u2[u2.length - 1]) {
                  const i3 = s2 - u2.length;
                  u2 = u2.substring(0, u2.length - 1);
                  const r3 = g(u2, e2);
                  if (true !== r3) return x(r3.err.code, r3.err.msg, N(t2, i3 + r3.err.line));
                  n2 = true;
                } else if (a2) {
                  if (!d2.tagClosed) return x("InvalidTag", "Closing tag '" + l2 + "' doesn't have proper closing.", N(t2, s2));
                  if (u2.trim().length > 0) return x("InvalidTag", "Closing tag '" + l2 + "' can't have attributes or invalid starting.", N(t2, o2));
                  if (0 === i2.length) return x("InvalidTag", "Closing tag '" + l2 + "' has not been opened.", N(t2, o2));
                  {
                    const e3 = i2.pop();
                    if (l2 !== e3.tagName) {
                      let i3 = N(t2, e3.tagStartPos);
                      return x("InvalidTag", "Expected closing tag '" + e3.tagName + "' (opened in line " + i3.line + ", col " + i3.col + ") instead of closing tag '" + l2 + "'.", N(t2, o2));
                    }
                    0 == i2.length && (r2 = true);
                  }
                } else {
                  const a3 = g(u2, e2);
                  if (true !== a3) return x(a3.err.code, a3.err.msg, N(t2, s2 - u2.length + a3.err.line));
                  if (true === r2) return x("InvalidXml", "Multiple possible root nodes found.", N(t2, s2));
                  -1 !== e2.unpairedTags.indexOf(l2) || i2.push({ tagName: l2, tagStartPos: o2 }), n2 = true;
                }
                for (s2++; s2 < t2.length; s2++) if ("<" === t2[s2]) {
                  if ("!" === t2[s2 + 1]) {
                    s2++, s2 = h(t2, s2);
                    continue;
                  }
                  if ("?" !== t2[s2 + 1]) break;
                  if (s2 = c(t2, ++s2), s2.err) return s2;
                } else if ("&" === t2[s2]) {
                  const e3 = m(t2, s2);
                  if (-1 == e3) return x("InvalidChar", "char '&' is not expected.", N(t2, s2));
                  s2 = e3;
                } else if (true === r2 && !p(t2[s2])) return x("InvalidXml", "Extra text at the end", N(t2, s2));
                "<" === t2[s2] && s2--;
              }
            }
          }
          return n2 ? 1 == i2.length ? x("InvalidTag", "Unclosed tag '" + i2[0].tagName + "'.", N(t2, i2[0].tagStartPos)) : !(i2.length > 0) || x("InvalidXml", "Invalid '" + JSON.stringify(i2.map((t3) => t3.tagName), null, 4).replace(/\r?\n/g, "") + "' found.", { line: 1, col: 1 }) : x("InvalidXml", "Start tag expected.", 1);
        }
        function p(t2) {
          return " " === t2 || "	" === t2 || "\n" === t2 || "\r" === t2;
        }
        function c(t2, e2) {
          const i2 = e2;
          for (; e2 < t2.length; e2++) if ("?" == t2[e2] || " " == t2[e2]) {
            const n2 = t2.substr(i2, e2 - i2);
            if (e2 > 5 && "xml" === n2) return x("InvalidXml", "XML declaration allowed only at the start of the document.", N(t2, e2));
            if ("?" == t2[e2] && ">" == t2[e2 + 1]) {
              e2++;
              break;
            }
            continue;
          }
          return e2;
        }
        function h(t2, e2) {
          if (t2.length > e2 + 5 && "-" === t2[e2 + 1] && "-" === t2[e2 + 2]) {
            for (e2 += 3; e2 < t2.length; e2++) if ("-" === t2[e2] && "-" === t2[e2 + 1] && ">" === t2[e2 + 2]) {
              e2 += 2;
              break;
            }
          } else if (t2.length > e2 + 8 && "D" === t2[e2 + 1] && "O" === t2[e2 + 2] && "C" === t2[e2 + 3] && "T" === t2[e2 + 4] && "Y" === t2[e2 + 5] && "P" === t2[e2 + 6] && "E" === t2[e2 + 7]) {
            let i2 = 1;
            for (e2 += 8; e2 < t2.length; e2++) if ("<" === t2[e2]) i2++;
            else if (">" === t2[e2] && (i2--, 0 === i2)) break;
          } else if (t2.length > e2 + 9 && "[" === t2[e2 + 1] && "C" === t2[e2 + 2] && "D" === t2[e2 + 3] && "A" === t2[e2 + 4] && "T" === t2[e2 + 5] && "A" === t2[e2 + 6] && "[" === t2[e2 + 7]) {
            for (e2 += 8; e2 < t2.length; e2++) if ("]" === t2[e2] && "]" === t2[e2 + 1] && ">" === t2[e2 + 2]) {
              e2 += 2;
              break;
            }
          }
          return e2;
        }
        const d = '"', u = "'";
        function f(t2, e2) {
          let i2 = "", n2 = "", r2 = false;
          for (; e2 < t2.length; e2++) {
            if (t2[e2] === d || t2[e2] === u) "" === n2 ? n2 = t2[e2] : n2 !== t2[e2] || (n2 = "");
            else if (">" === t2[e2] && "" === n2) {
              r2 = true;
              break;
            }
            i2 += t2[e2];
          }
          return "" === n2 && { value: i2, index: e2, tagClosed: r2 };
        }
        function g(t2, e2) {
          const i2 = (function(t3) {
            const e3 = [], i3 = t3.length;
            let n3 = 0;
            for (; n3 < i3; ) {
              const r2 = n3;
              for (; n3 < i3 && p(t3[n3]); ) n3++;
              if (n3 >= i3) break;
              if ("=" === t3[n3]) {
                n3 = r2 + 1;
                continue;
              }
              const s2 = t3.slice(r2, n3), o2 = n3;
              for (; n3 < i3 && !p(t3[n3]) && "=" !== t3[n3]; ) n3++;
              const a2 = t3.slice(o2, n3);
              let l2, c2, h2, d2 = n3;
              for (; d2 < i3 && p(t3[d2]); ) d2++;
              d2 < i3 && "=" === t3[d2] && (l2 = t3.slice(n3, d2 + 1), n3 = d2 + 1);
              let u2 = n3;
              for (; u2 < i3 && p(t3[u2]); ) u2++;
              if (u2 < i3 && ('"' === t3[u2] || "'" === t3[u2])) {
                const e4 = u2 + 1, i4 = t3.indexOf(t3[u2], e4);
                -1 !== i4 && (c2 = t3[u2], h2 = t3.slice(e4, i4), n3 = i4 + 1);
              }
              const f2 = { startIndex: r2 };
              f2[1] = s2, f2[2] = a2, f2[3] = l2, f2[4] = void 0 !== c2 || void 0, f2[5] = c2, f2[6] = h2, e3.push(f2);
            }
            return e3;
          })(t2), n2 = {};
          for (let t3 = 0; t3 < i2.length; t3++) {
            if (0 === i2[t3][1].length) return x("InvalidAttr", "Attribute '" + i2[t3][2] + "' has no space in starting.", E(i2[t3]));
            if (void 0 !== i2[t3][3] && void 0 === i2[t3][4]) return x("InvalidAttr", "Attribute '" + i2[t3][2] + "' is without value.", E(i2[t3]));
            if (void 0 === i2[t3][3] && !e2.allowBooleanAttributes) return x("InvalidAttr", "boolean attribute '" + i2[t3][2] + "' is not allowed.", E(i2[t3]));
            const r2 = i2[t3][2];
            if (!b(r2)) return x("InvalidAttr", "Attribute '" + r2 + "' is an invalid name.", E(i2[t3]));
            if (Object.prototype.hasOwnProperty.call(n2, r2)) return x("InvalidAttr", "Attribute '" + r2 + "' is repeated.", E(i2[t3]));
            n2[r2] = 1;
          }
          return true;
        }
        function m(t2, e2) {
          if (";" === t2[++e2]) return -1;
          if ("#" === t2[e2]) return (function(t3, e3) {
            let i3 = /\d/;
            for ("x" === t3[e3] && (e3++, i3 = /[\da-fA-F]/); e3 < t3.length; e3++) {
              if (";" === t3[e3]) return e3;
              if (!t3[e3].match(i3)) break;
            }
            return -1;
          })(t2, ++e2);
          let i2 = 0;
          for (; e2 < t2.length; e2++, i2++) if (!(t2[e2].match(/\w/) && i2 < 20)) {
            if (";" === t2[e2]) break;
            return -1;
          }
          return e2;
        }
        function x(t2, e2, i2) {
          return { err: { code: t2, msg: e2, line: i2.line || i2, col: i2.col } };
        }
        function b(t2) {
          return r(t2);
        }
        function y(t2) {
          return r(t2);
        }
        function N(t2, e2) {
          const i2 = t2.substring(0, e2).split(/\r?\n/);
          return { line: i2.length, col: i2[i2.length - 1].length + 1 };
        }
        function E(t2) {
          return t2.startIndex + t2[1].length;
        }
        const w = (t2) => s.includes(t2) ? "__" + t2 : t2, v = { preserveOrder: false, attributeNamePrefix: "@_", attributesGroupName: false, textNodeName: "#text", ignoreAttributes: true, removeNSPrefix: false, allowBooleanAttributes: false, parseTagValue: true, parseAttributeValue: false, trimValues: true, cdataPropName: false, numberParseOptions: { hex: true, leadingZeros: true, eNotation: true, unicode: false }, tagValueProcessor: function(t2, e2) {
          return e2;
        }, attributeValueProcessor: function(t2, e2) {
          return e2;
        }, stopNodes: [], alwaysCreateTextNode: false, isArray: () => false, commentPropName: false, unpairedTags: [], processEntities: true, htmlEntities: false, entityDecoder: null, ignoreDeclaration: false, ignorePiTags: false, transformTagName: false, transformAttributeName: false, updateTag: function(t2, e2, i2) {
          return t2;
        }, captureMetaData: false, maxNestedTags: 100, strictReservedNames: true, jPath: true, onDangerousProperty: w };
        function S(t2, e2) {
          if ("string" != typeof t2) return;
          const i2 = t2.toLowerCase();
          if (s.some((t3) => i2 === t3.toLowerCase())) throw new Error(`[SECURITY] Invalid ${e2}: "${t2}" is a reserved JavaScript keyword that could cause prototype pollution`);
          if (o.some((t3) => i2 === t3.toLowerCase())) throw new Error(`[SECURITY] Invalid ${e2}: "${t2}" is a reserved JavaScript keyword that could cause prototype pollution`);
        }
        function A(t2, e2) {
          return "boolean" == typeof t2 ? { enabled: t2, maxEntitySize: 1e4, maxExpansionDepth: 1e4, maxTotalExpansions: 1 / 0, maxExpandedLength: 1e5, maxEntityCount: 1e3, allowedTags: null, tagFilter: null, appliesTo: "all" } : "object" == typeof t2 && null !== t2 ? { enabled: false !== t2.enabled, maxEntitySize: Math.max(1, t2.maxEntitySize ?? 1e4), maxExpansionDepth: Math.max(1, t2.maxExpansionDepth ?? 1e4), maxTotalExpansions: Math.max(1, t2.maxTotalExpansions ?? 1 / 0), maxExpandedLength: Math.max(1, t2.maxExpandedLength ?? 1e5), maxEntityCount: Math.max(1, t2.maxEntityCount ?? 1e3), allowedTags: t2.allowedTags ?? null, tagFilter: t2.tagFilter ?? null, appliesTo: t2.appliesTo ?? "all" } : A(true);
        }
        const T = function(t2) {
          const e2 = Object.assign({}, v, t2), i2 = [{ value: e2.attributeNamePrefix, name: "attributeNamePrefix" }, { value: e2.attributesGroupName, name: "attributesGroupName" }, { value: e2.textNodeName, name: "textNodeName" }, { value: e2.cdataPropName, name: "cdataPropName" }, { value: e2.commentPropName, name: "commentPropName" }];
          for (const { value: t3, name: e3 } of i2) t3 && S(t3, e3);
          return null === e2.onDangerousProperty && (e2.onDangerousProperty = w), e2.processEntities = A(e2.processEntities, e2.htmlEntities), e2.unpairedTagsSet = new Set(e2.unpairedTags), e2.stopNodes && Array.isArray(e2.stopNodes) && (e2.stopNodes = e2.stopNodes.map((t3) => "string" == typeof t3 && t3.startsWith("*.") ? ".." + t3.substring(2) : t3)), e2;
        };
        let _;
        _ = "function" != typeof Symbol ? "@@xmlMetadata" : /* @__PURE__ */ Symbol("XML Node Metadata");
        class C {
          constructor(t2) {
            this.tagname = t2, this.child = [], this[":@"] = /* @__PURE__ */ Object.create(null);
          }
          add(t2, e2) {
            "__proto__" === t2 && (t2 = "#__proto__"), this.child.push({ [t2]: e2 });
          }
          addChild(t2, e2) {
            "__proto__" === t2.tagname && (t2.tagname = "#__proto__"), t2[":@"] && Object.keys(t2[":@"]).length > 0 ? this.child.push({ [t2.tagname]: t2.child, ":@": t2[":@"] }) : this.child.push({ [t2.tagname]: t2.child }), this.addStartIndex(e2);
          }
          addStartIndex(t2) {
            void 0 !== t2 && (this.child[this.child.length - 1][_] = { startIndex: t2 });
          }
          addEndIndex(t2) {
            const e2 = this.child[this.child.length - 1];
            void 0 !== e2 && void 0 !== e2[_] && void 0 === e2[_].endIndex && (e2[_].endIndex = t2);
          }
          static getMetaDataSymbol() {
            return _;
          }
        }
        const $ = ":A-Za-z_\xC0-\xD6\xD8-\xF6\xF8-\u02FF\u0370-\u037D\u037F-\u0486\u0488-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD", P = ":A-Za-z_\xC0-\u02FF\u0370-\u037D\u037F-\u0486\u0488-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}", O = P + "\\-\\.\\d\xB7\u0300-\u036F\u0487\u203F-\u2040", I = (t2, e2, i2 = "") => {
          const n2 = `[${t2.replace(":", "")}][${e2.replace(":", "")}]*`;
          return { name: new RegExp(`^[${t2}][${e2}]*$`, i2), ncName: new RegExp(`^${n2}$`, i2), qName: new RegExp(`^${n2}(?::${n2})?$`, i2), nmToken: new RegExp(`^[${e2}]+$`, i2), nmTokens: new RegExp(`^[${e2}]+(?:\\s+[${e2}]+)*$`, i2) };
        }, j = I($, $ + "\\-\\.\\d\xB7\u0300-\u036F\u203F-\u2040"), k = I(P, O, "u"), L = ":A-Za-z_", D = I(L, L + "\\-\\.\\d"), R = (t2, { xmlVersion: e2 = "1.0", asciiOnly: i2 = false } = {}) => (/* @__PURE__ */ ((t3 = "1.0", e3 = false) => e3 ? D : "1.1" === t3 ? k : j)(e2, i2)).qName.test(t2);
        class M {
          constructor(t2, e2) {
            this.suppressValidationErr = !t2, this.options = t2, this.xmlVersion = e2 || 1;
          }
          setXmlVersion(t2 = 1) {
            this.xmlVersion = t2;
          }
          readDocType(t2, e2) {
            const i2 = /* @__PURE__ */ Object.create(null);
            let n2 = 0;
            if ("O" !== t2[e2 + 3] || "C" !== t2[e2 + 4] || "T" !== t2[e2 + 5] || "Y" !== t2[e2 + 6] || "P" !== t2[e2 + 7] || "E" !== t2[e2 + 8]) throw new Error("Invalid Tag instead of DOCTYPE");
            {
              e2 += 9;
              let r2 = 1, s2 = false, o2 = false, a2 = null, l2 = "";
              for (; e2 < t2.length; e2++) if (null === a2) if (s2 || o2 || '"' !== t2[e2] && "'" !== t2[e2]) if ("<" !== t2[e2] || o2) if (">" === t2[e2]) {
                if (o2 ? "-" === t2[e2 - 1] && "-" === t2[e2 - 2] && (o2 = false, r2--) : r2--, 0 === r2) break;
              } else "[" === t2[e2] ? s2 = true : l2 += t2[e2];
              else {
                if (s2 && q(t2, "!ENTITY", e2)) {
                  let r3, s3;
                  if (e2 += 7, [r3, s3, e2] = this.readEntityExp(t2, e2 + 1, this.suppressValidationErr), -1 === s3.indexOf("&")) {
                    if (false !== this.options.enabled && null != this.options.maxEntityCount && n2 >= this.options.maxEntityCount) throw new Error(`Entity count (${n2 + 1}) exceeds maximum allowed (${this.options.maxEntityCount})`);
                    i2[r3] = s3, n2++;
                  }
                } else if (s2 && q(t2, "!ELEMENT", e2)) {
                  e2 += 8;
                  const { index: i3 } = this.readElementExp(t2, e2 + 1);
                  e2 = i3;
                } else if (s2 && q(t2, "!ATTLIST", e2)) e2 += 8;
                else if (s2 && q(t2, "!NOTATION", e2)) {
                  e2 += 9;
                  const { index: i3 } = this.readNotationExp(t2, e2 + 1, this.suppressValidationErr);
                  e2 = i3;
                } else {
                  if (!q(t2, "!--", e2)) throw new Error("Invalid DOCTYPE");
                  o2 = true;
                }
                r2++, l2 = "";
              }
              else a2 = t2[e2], l2 += t2[e2];
              else t2[e2] === a2 && (a2 = null), l2 += t2[e2];
              if (null !== a2 || 0 !== r2) throw new Error("Unclosed DOCTYPE");
            }
            return { entities: i2, i: e2 };
          }
          readEntityExp(t2, e2) {
            const i2 = e2 = V(t2, e2);
            for (; e2 < t2.length && !/\s/.test(t2[e2]) && '"' !== t2[e2] && "'" !== t2[e2]; ) e2++;
            let n2 = t2.substring(i2, e2);
            if (F(n2, { xmlVersion: this.xmlVersion }), e2 = V(t2, e2), !this.suppressValidationErr) {
              if ("SYSTEM" === t2.substring(e2, e2 + 6).toUpperCase()) throw new Error("External entities are not supported");
              if ("%" === t2[e2]) throw new Error("Parameter entities are not supported");
            }
            let r2 = "";
            if ([e2, r2] = this.readIdentifierVal(t2, e2, "entity"), false !== this.options.enabled && null != this.options.maxEntitySize && r2.length > this.options.maxEntitySize) throw new Error(`Entity "${n2}" size (${r2.length}) exceeds maximum allowed size (${this.options.maxEntitySize})`);
            return [n2, r2, --e2];
          }
          readNotationExp(t2, e2) {
            const i2 = e2 = V(t2, e2);
            for (; e2 < t2.length && !/\s/.test(t2[e2]); ) e2++;
            let n2 = t2.substring(i2, e2);
            !this.suppressValidationErr && F(n2, { xmlVersion: this.xmlVersion }), e2 = V(t2, e2);
            const r2 = t2.substring(e2, e2 + 6).toUpperCase();
            if (!this.suppressValidationErr && "SYSTEM" !== r2 && "PUBLIC" !== r2) throw new Error(`Expected SYSTEM or PUBLIC, found "${r2}"`);
            e2 += r2.length, e2 = V(t2, e2);
            let s2 = null, o2 = null;
            if ("PUBLIC" === r2) [e2, s2] = this.readIdentifierVal(t2, e2, "publicIdentifier"), '"' !== t2[e2 = V(t2, e2)] && "'" !== t2[e2] || ([e2, o2] = this.readIdentifierVal(t2, e2, "systemIdentifier"));
            else if ("SYSTEM" === r2 && ([e2, o2] = this.readIdentifierVal(t2, e2, "systemIdentifier"), !this.suppressValidationErr && !o2)) throw new Error("Missing mandatory system identifier for SYSTEM notation");
            return { notationName: n2, publicIdentifier: s2, systemIdentifier: o2, index: --e2 };
          }
          readIdentifierVal(t2, e2, i2) {
            let n2 = "";
            const r2 = t2[e2];
            if ('"' !== r2 && "'" !== r2) throw new Error(`Expected quoted string, found "${r2}"`);
            const s2 = ++e2;
            for (; e2 < t2.length && t2[e2] !== r2; ) e2++;
            if (n2 = t2.substring(s2, e2), t2[e2] !== r2) throw new Error(`Unterminated ${i2} value`);
            return [++e2, n2];
          }
          readElementExp(t2, e2) {
            const i2 = e2 = V(t2, e2);
            for (; e2 < t2.length && !/\s/.test(t2[e2]); ) e2++;
            let n2 = t2.substring(i2, e2);
            if (!this.suppressValidationErr && !R(n2, { xmlVersion: this.xmlVersion })) throw new Error(`Invalid element name: "${n2}"`);
            let r2 = "";
            if ("E" === t2[e2 = V(t2, e2)] && q(t2, "MPTY", e2)) e2 += 4;
            else if ("A" === t2[e2] && q(t2, "NY", e2)) e2 += 2;
            else if ("(" === t2[e2]) {
              const i3 = ++e2;
              for (; e2 < t2.length && ")" !== t2[e2]; ) e2++;
              if (r2 = t2.substring(i3, e2), ")" !== t2[e2]) throw new Error("Unterminated content model");
            } else if (!this.suppressValidationErr) throw new Error(`Invalid Element Expression, found "${t2[e2]}"`);
            return { elementName: n2, contentModel: r2.trim(), index: e2 };
          }
          readAttlistExp(t2, e2) {
            let i2 = e2 = V(t2, e2);
            for (; e2 < t2.length && !/\s/.test(t2[e2]); ) e2++;
            let n2 = t2.substring(i2, e2);
            for (F(n2, { xmlVersion: this.xmlVersion }), i2 = e2 = V(t2, e2); e2 < t2.length && !/\s/.test(t2[e2]); ) e2++;
            let r2 = t2.substring(i2, e2);
            if (!F(r2, { xmlVersion: this.xmlVersion })) throw new Error(`Invalid attribute name: "${r2}"`);
            e2 = V(t2, e2);
            let s2 = "";
            if ("NOTATION" === t2.substring(e2, e2 + 8).toUpperCase()) {
              if (s2 = "NOTATION", "(" !== t2[e2 = V(t2, e2 += 8)]) throw new Error(`Expected '(', found "${t2[e2]}"`);
              e2++;
              let i3 = [];
              for (; e2 < t2.length && ")" !== t2[e2]; ) {
                const n3 = e2;
                for (; e2 < t2.length && "|" !== t2[e2] && ")" !== t2[e2]; ) e2++;
                let r3 = t2.substring(n3, e2);
                if (r3 = r3.trim(), !F(r3, { xmlVersion: this.xmlVersion })) throw new Error(`Invalid notation name: "${r3}"`);
                i3.push(r3), "|" === t2[e2] && (e2++, e2 = V(t2, e2));
              }
              if (")" !== t2[e2]) throw new Error("Unterminated list of notations");
              e2++, s2 += " (" + i3.join("|") + ")";
            } else {
              const i3 = e2;
              for (; e2 < t2.length && !/\s/.test(t2[e2]); ) e2++;
              s2 += t2.substring(i3, e2);
              const n3 = ["CDATA", "ID", "IDREF", "IDREFS", "ENTITY", "ENTITIES", "NMTOKEN", "NMTOKENS"];
              if (!this.suppressValidationErr && !n3.includes(s2.toUpperCase())) throw new Error(`Invalid attribute type: "${s2}"`);
            }
            e2 = V(t2, e2);
            let o2 = "";
            return "#REQUIRED" === t2.substring(e2, e2 + 8).toUpperCase() ? (o2 = "#REQUIRED", e2 += 8) : "#IMPLIED" === t2.substring(e2, e2 + 7).toUpperCase() ? (o2 = "#IMPLIED", e2 += 7) : [e2, o2] = this.readIdentifierVal(t2, e2, "ATTLIST"), { elementName: n2, attributeName: r2, attributeType: s2, defaultValue: o2, index: e2 };
          }
        }
        const V = (t2, e2) => {
          for (; e2 < t2.length && /\s/.test(t2[e2]); ) e2++;
          return e2;
        };
        function q(t2, e2, i2) {
          for (let n2 = 0; n2 < e2.length; n2++) if (e2[n2] !== t2[i2 + n2 + 1]) return false;
          return true;
        }
        function F(t2, e2) {
          if (R(t2, { xmlVersion: e2 })) return t2;
          throw new Error(`Invalid entity name ${t2}`);
        }
        const U = [48, 1632, 1776, 2406, 2534, 2662, 2790, 2918, 3046, 3174, 3302, 3430, 3558, 3664, 3792, 3872, 4160, 4240, 6112, 6160, 6470, 6608, 6784, 6800, 6992, 7088, 7232, 7248, 65296, 120782, 120792, 120802, 120812, 120822, 66720, 68912, 69734, 69872, 69942, 70096, 70384, 70736, 70864, 71248, 71360, 71472, 71904, 72016, 72688, 72784, 73040, 73120, 73552, 92768, 92864, 93008, 123200, 123632, 124144, 125264, 130032], B = /* @__PURE__ */ new Map(), G = 1632, X = new Uint8Array(63904).fill(255);
        for (const t2 of U) for (let e2 = 0; e2 < 10; e2++) {
          const i2 = t2 + e2;
          i2 <= 65535 ? X[i2 - G] = e2 : B.set(i2, e2);
        }
        const W = /* @__PURE__ */ new Set([8722, 65293, 65123]), z = /^[-+]?0x[a-fA-F0-9]+$/, Y = /^0b[01]+$/, H = /^0o[0-7]+$/, Q = /^([\-\+])?(0*)([0-9]*(\.[0-9]*)?)$/, J = { hex: true, binary: false, octal: false, leadingZeros: true, decimalPoint: ".", eNotation: true, infinity: "original", unicode: false };
        function Z(t2, e2 = {}) {
          if (e2 = Object.assign({}, J, e2), !t2 || "string" != typeof t2) return t2;
          let i2 = t2.trim();
          if (0 === i2.length) return t2;
          if (void 0 !== e2.skipLike && e2.skipLike.test(i2)) return t2;
          if ("0" === i2) return 0;
          if (e2.unicode && (i2 = (function(t3) {
            if ("string" != typeof t3) return t3;
            const e3 = t3.length;
            if (0 === e3) return t3;
            let i3 = -1;
            for (let n3 = 0; n3 < e3; n3++) {
              const r2 = t3.charCodeAt(n3);
              if (!(r2 >= 48 && r2 <= 57 || 45 === r2)) {
                if (r2 < G) {
                  if (W.has(r2)) {
                    i3 = n3;
                    break;
                  }
                } else if (r2 >= 55296 && r2 <= 56319) {
                  if (n3 + 1 < e3) {
                    const e4 = t3.charCodeAt(n3 + 1);
                    if (e4 >= 56320 && e4 <= 57343) {
                      const t4 = 65536 + (r2 - 55296 << 10) + (e4 - 56320);
                      if (B.has(t4)) {
                        i3 = n3;
                        break;
                      }
                    }
                  }
                } else if (255 !== X[r2 - G] || W.has(r2)) {
                  i3 = n3;
                  break;
                }
              }
            }
            if (-1 === i3) return t3;
            const n2 = [];
            i3 > 0 && n2.push(t3.slice(0, i3));
            for (let r2 = i3; r2 < e3; r2++) {
              const i4 = t3.charCodeAt(r2);
              if (i4 >= 48 && i4 <= 57 || 45 === i4) {
                n2.push(t3[r2]);
                continue;
              }
              if (i4 < G) {
                n2.push(W.has(i4) ? "-" : t3[r2]);
                continue;
              }
              if (i4 >= 55296 && i4 <= 56319) {
                if (r2 + 1 < e3) {
                  const e4 = t3.charCodeAt(r2 + 1);
                  if (e4 >= 56320 && e4 <= 57343) {
                    const t4 = 65536 + (i4 - 55296 << 10) + (e4 - 56320), s3 = B.get(t4);
                    if (void 0 !== s3) {
                      n2.push(String.fromCharCode(s3 + 48)), r2++;
                      continue;
                    }
                  }
                }
                n2.push(t3[r2]);
                continue;
              }
              if (W.has(i4)) {
                n2.push("-");
                continue;
              }
              const s2 = X[i4 - G];
              n2.push(255 !== s2 ? String.fromCharCode(s2 + 48) : t3[r2]);
            }
            return n2.join("");
          })(i2), "0" === i2)) return 0;
          if (e2.hex && z.test(i2)) return tt(i2, 16);
          if (e2.binary && Y.test(i2)) return tt(i2, 2);
          if (e2.octal && H.test(i2)) return tt(i2, 8);
          if (isFinite(i2)) {
            if (i2.includes("e") || i2.includes("E")) return (function(t3, e3, i3) {
              if (!i3.eNotation) return t3;
              const n2 = e3.match(K);
              if (n2) {
                let r2 = n2[1] || "";
                const s2 = -1 === n2[3].indexOf("e") ? "E" : "e", o2 = n2[2], a2 = r2 ? t3[o2.length + 1] === s2 : t3[o2.length] === s2;
                return o2.length > 1 && a2 ? t3 : (1 !== o2.length || !n2[3].startsWith(`.${s2}`) && n2[3][0] !== s2) && o2.length > 0 ? i3.leadingZeros && !a2 ? (e3 = (n2[1] || "") + n2[3], Number(e3)) : t3 : Number(e3);
              }
              return t3;
            })(t2, i2, e2);
            {
              const n2 = Q.exec(i2);
              if (n2) {
                const r2 = n2[1] || "", s2 = n2[2];
                let o2 = (function(t3) {
                  if (t3 && -1 !== t3.indexOf(".")) {
                    let e3 = t3.length;
                    for (; e3 > 0 && 48 === t3.charCodeAt(e3 - 1); ) e3--;
                    return "." === (t3 = t3.slice(0, e3)) ? t3 = "0" : "." === t3[0] ? t3 = "0" + t3 : "." === t3[t3.length - 1] && (t3 = t3.substring(0, t3.length - 1)), t3;
                  }
                  return t3;
                })(n2[3]);
                const a2 = r2 ? "." === t2[s2.length + 1] : "." === t2[s2.length];
                if (!e2.leadingZeros && (s2.length > 1 || 1 === s2.length && !a2)) return t2;
                {
                  const n3 = Number(i2), a3 = String(n3);
                  if (0 === n3) return n3;
                  if (-1 !== a3.search(/[eE]/)) return e2.eNotation ? n3 : t2;
                  if (-1 !== i2.indexOf(".")) return "0" === a3 || a3 === o2 || a3 === `${r2}${o2}` ? n3 : t2;
                  let l2 = s2 ? o2 : i2;
                  return s2 ? l2 === a3 || r2 + l2 === a3 ? n3 : t2 : l2 === a3 || l2 === r2 + a3 ? n3 : t2;
                }
              }
              return t2;
            }
          }
          return (function(t3, e3, i3) {
            const n2 = e3 === 1 / 0;
            switch (i3.infinity.toLowerCase()) {
              case "null":
                return null;
              case "infinity":
                return e3;
              case "string":
                return n2 ? "Infinity" : "-Infinity";
              default:
                return t3;
            }
          })(t2, Number(i2), e2);
        }
        const K = /^([-+])?(0*)(\d*(\.\d*)?[eE][-\+]?\d+)$/;
        function tt(t2, e2) {
          const i2 = t2.trim();
          if (2 !== e2 && 8 !== e2 || (t2 = i2.substring(2)), parseInt) return parseInt(t2, e2);
          if (Number.parseInt) return Number.parseInt(t2, e2);
          if (window && window.parseInt) return window.parseInt(t2, e2);
          throw new Error("parseInt, Number.parseInt, window.parseInt are not supported");
        }
        class et {
          constructor(t2) {
            this._matcher = t2;
          }
          get separator() {
            return this._matcher.separator;
          }
          getCurrentTag() {
            const t2 = this._matcher.path;
            return t2.length > 0 ? t2[t2.length - 1].tag : void 0;
          }
          getCurrentNamespace() {
            const t2 = this._matcher.path;
            return t2.length > 0 ? t2[t2.length - 1].namespace : void 0;
          }
          getAttrValue(t2) {
            const e2 = this._matcher.path;
            if (0 !== e2.length) return e2[e2.length - 1].values?.[t2];
          }
          hasAttr(t2) {
            const e2 = this._matcher.path;
            if (0 === e2.length) return false;
            const i2 = e2[e2.length - 1];
            return void 0 !== i2.values && t2 in i2.values;
          }
          getAnyParentAttr(t2) {
            return this._matcher.getAnyParentAttr(t2);
          }
          hasAnyParentAttr(t2) {
            return this._matcher.hasAnyParentAttr(t2);
          }
          getPosition() {
            const t2 = this._matcher.path;
            return 0 === t2.length ? -1 : t2[t2.length - 1].position ?? 0;
          }
          getCounter() {
            const t2 = this._matcher.path;
            return 0 === t2.length ? -1 : t2[t2.length - 1].counter ?? 0;
          }
          getIndex() {
            return this.getPosition();
          }
          getDepth() {
            return this._matcher.path.length;
          }
          toString(t2, e2 = true) {
            return this._matcher.toString(t2, e2);
          }
          toArray() {
            return this._matcher.path.map((t2) => t2.tag);
          }
          matches(t2) {
            return this._matcher.matches(t2);
          }
          matchesAny(t2) {
            return t2.matchesAny(this._matcher);
          }
        }
        class it {
          constructor(t2 = {}) {
            this.separator = t2.separator || ".", this.path = [], this.siblingStacks = [], this._pathStringCache = null, this._view = new et(this), this._keptAttrs = [];
          }
          push(t2, e2 = null, i2 = null, n2 = null) {
            this._pathStringCache = null, this.path.length > 0 && (this.path[this.path.length - 1].values = void 0);
            const r2 = this.path.length;
            let s2 = this.siblingStacks[r2];
            s2 || (s2 = { counts: /* @__PURE__ */ new Map(), total: 0 }, this.siblingStacks[r2] = s2);
            const o2 = i2 ? `${i2}:${t2}` : t2, a2 = s2.counts.get(o2) || 0, l2 = s2.total;
            s2.counts.set(o2, a2 + 1), s2.total++;
            const p2 = { tag: t2, position: l2, counter: a2 };
            null != i2 && (p2.namespace = i2), null != e2 && (p2.values = e2), this.path.push(p2);
            const c2 = this.path.length, h2 = null !== n2 ? n2.keep : null;
            if (null != h2 && h2.length > 0 && e2) for (let t3 = 0; t3 < h2.length; t3++) {
              const i3 = h2[t3];
              void 0 !== e2[i3] && this._keptAttrs.push({ depth: c2, name: i3, value: e2[i3] });
            }
          }
          pop() {
            if (0 === this.path.length) return;
            this._pathStringCache = null;
            const t2 = this.path.pop();
            this.siblingStacks.length > this.path.length + 1 && (this.siblingStacks.length = this.path.length + 1);
            const e2 = this.path.length + 1;
            for (; this._keptAttrs.length > 0 && this._keptAttrs[this._keptAttrs.length - 1].depth >= e2; ) this._keptAttrs.pop();
            return t2;
          }
          updateCurrent(t2) {
            if (this.path.length > 0) {
              const e2 = this.path[this.path.length - 1];
              null != t2 && (e2.values = t2);
            }
          }
          getCurrentTag() {
            return this.path.length > 0 ? this.path[this.path.length - 1].tag : void 0;
          }
          getCurrentNamespace() {
            return this.path.length > 0 ? this.path[this.path.length - 1].namespace : void 0;
          }
          getAttrValue(t2) {
            if (0 !== this.path.length) return this.path[this.path.length - 1].values?.[t2];
          }
          hasAttr(t2) {
            if (0 === this.path.length) return false;
            const e2 = this.path[this.path.length - 1];
            return void 0 !== e2.values && t2 in e2.values;
          }
          getAnyParentAttr(t2) {
            const e2 = this._keptAttrs;
            for (let i2 = e2.length - 1; i2 >= 0; i2--) if (e2[i2].name === t2) return e2[i2].value;
          }
          hasAnyParentAttr(t2) {
            const e2 = this._keptAttrs;
            for (let i2 = e2.length - 1; i2 >= 0; i2--) if (e2[i2].name === t2) return true;
            return false;
          }
          getPosition() {
            return 0 === this.path.length ? -1 : this.path[this.path.length - 1].position ?? 0;
          }
          getCounter() {
            return 0 === this.path.length ? -1 : this.path[this.path.length - 1].counter ?? 0;
          }
          getIndex() {
            return this.getPosition();
          }
          getDepth() {
            return this.path.length;
          }
          toString(t2, e2 = true) {
            const i2 = t2 || this.separator;
            if (i2 === this.separator && true === e2) {
              if (null !== this._pathStringCache) return this._pathStringCache;
              const t3 = this.path.map((t4) => t4.namespace ? `${t4.namespace}:${t4.tag}` : t4.tag).join(i2);
              return this._pathStringCache = t3, t3;
            }
            return this.path.map((t3) => e2 && t3.namespace ? `${t3.namespace}:${t3.tag}` : t3.tag).join(i2);
          }
          toArray() {
            return this.path.map((t2) => t2.tag);
          }
          reset() {
            this._pathStringCache = null, this.path = [], this.siblingStacks = [], this._keptAttrs = [];
          }
          matches(t2) {
            const e2 = t2.segments;
            return 0 !== e2.length && (t2.hasDeepWildcard() ? this._matchWithDeepWildcard(e2) : this._matchSimple(e2));
          }
          _matchSimple(t2) {
            if (this.path.length !== t2.length) return false;
            for (let e2 = 0; e2 < t2.length; e2++) if (!this._matchSegment(t2[e2], this.path[e2], e2 === this.path.length - 1)) return false;
            return true;
          }
          _matchWithDeepWildcard(t2) {
            let e2 = this.path.length - 1, i2 = t2.length - 1;
            for (; i2 >= 0 && e2 >= 0; ) {
              const n2 = t2[i2];
              if ("deep-wildcard" === n2.type) {
                if (i2--, i2 < 0) return true;
                const n3 = t2[i2];
                let r2 = false;
                for (let t3 = e2; t3 >= 0; t3--) if (this._matchSegment(n3, this.path[t3], t3 === this.path.length - 1)) {
                  e2 = t3 - 1, i2--, r2 = true;
                  break;
                }
                if (!r2) return false;
              } else {
                if (!this._matchSegment(n2, this.path[e2], e2 === this.path.length - 1)) return false;
                e2--, i2--;
              }
            }
            return i2 < 0;
          }
          _matchSegment(t2, e2, i2) {
            if ("*" !== t2.tag && t2.tag !== e2.tag) return false;
            if (void 0 !== t2.namespace && "*" !== t2.namespace && t2.namespace !== e2.namespace) return false;
            if (void 0 !== t2.attrName) {
              if (!i2) return false;
              if (!e2.values || !(t2.attrName in e2.values)) return false;
              if (void 0 !== t2.attrValue && String(e2.values[t2.attrName]) !== String(t2.attrValue)) return false;
            }
            if (void 0 !== t2.position) {
              if (!i2) return false;
              const n2 = e2.counter ?? 0;
              if ("first" === t2.position && 0 !== n2) return false;
              if ("odd" === t2.position && n2 % 2 != 1) return false;
              if ("even" === t2.position && n2 % 2 != 0) return false;
              if ("nth" === t2.position && n2 !== t2.positionValue) return false;
            }
            return true;
          }
          matchesAny(t2) {
            return t2.matchesAny(this);
          }
          snapshot() {
            return { path: this.path.map((t2) => ({ ...t2 })), siblingStacks: this.siblingStacks.map((t2) => t2 ? { counts: new Map(t2.counts), total: t2.total } : t2), keptAttrs: this._keptAttrs.map((t2) => ({ ...t2 })) };
          }
          restore(t2) {
            this._pathStringCache = null, this.path = t2.path.map((t3) => ({ ...t3 })), this.siblingStacks = t2.siblingStacks.map((t3) => t3 ? { counts: new Map(t3.counts), total: t3.total } : t3), this._keptAttrs = (t2.keptAttrs || []).map((t3) => ({ ...t3 }));
          }
          readOnly() {
            return this._view;
          }
        }
        class nt {
          constructor(t2, e2 = {}, i2) {
            this.pattern = t2, this.separator = e2.separator || ".", this.segments = this._parse(t2), this.data = i2, this._hasDeepWildcard = this.segments.some((t3) => "deep-wildcard" === t3.type), this._hasAttributeCondition = this.segments.some((t3) => void 0 !== t3.attrName), this._hasPositionSelector = this.segments.some((t3) => void 0 !== t3.position);
          }
          _parse(t2) {
            const e2 = [];
            let i2 = 0, n2 = "";
            for (; i2 < t2.length; ) t2[i2] === this.separator ? i2 + 1 < t2.length && t2[i2 + 1] === this.separator ? (n2.trim() && (e2.push(this._parseSegment(n2.trim())), n2 = ""), e2.push({ type: "deep-wildcard" }), i2 += 2) : (n2.trim() && e2.push(this._parseSegment(n2.trim())), n2 = "", i2++) : (n2 += t2[i2], i2++);
            return n2.trim() && e2.push(this._parseSegment(n2.trim())), e2;
          }
          _parseSegment(t2) {
            const e2 = { type: "tag" };
            let i2 = null, n2 = t2;
            const r2 = t2.match(/^([^\[]+)(\[[^\]]*\])(.*)$/);
            if (r2 && (n2 = r2[1] + r2[3], r2[2])) {
              const t3 = r2[2].slice(1, -1);
              t3 && (i2 = t3);
            }
            let s2, o2, a2 = n2;
            if (n2.includes("::")) {
              const e3 = n2.indexOf("::");
              if (s2 = n2.substring(0, e3).trim(), a2 = n2.substring(e3 + 2).trim(), !s2) throw new Error(`Invalid namespace in pattern: ${t2}`);
            }
            let l2 = null;
            if (a2.includes(":")) {
              const t3 = a2.lastIndexOf(":"), e3 = a2.substring(0, t3).trim(), i3 = a2.substring(t3 + 1).trim();
              ["first", "last", "odd", "even"].includes(i3) || /^nth\(\d+\)$/.test(i3) ? (o2 = e3, l2 = i3) : o2 = a2;
            } else o2 = a2;
            if (!o2) throw new Error(`Invalid segment pattern: ${t2}`);
            if (e2.tag = o2, s2 && (e2.namespace = s2), i2) if (i2.includes("=")) {
              const t3 = i2.indexOf("=");
              e2.attrName = i2.substring(0, t3).trim(), e2.attrValue = i2.substring(t3 + 1).trim();
            } else e2.attrName = i2.trim();
            if (l2) {
              const t3 = l2.match(/^nth\((\d+)\)$/);
              t3 ? (e2.position = "nth", e2.positionValue = parseInt(t3[1], 10)) : e2.position = l2;
            }
            return e2;
          }
          get length() {
            return this.segments.length;
          }
          hasDeepWildcard() {
            return this._hasDeepWildcard;
          }
          hasAttributeCondition() {
            return this._hasAttributeCondition;
          }
          hasPositionSelector() {
            return this._hasPositionSelector;
          }
          toString() {
            return this.pattern;
          }
        }
        class rt {
          constructor() {
            this._byDepthAndTag = /* @__PURE__ */ new Map(), this._wildcardByDepth = /* @__PURE__ */ new Map(), this._deepWildcards = [], this._deepByTerminalTag = /* @__PURE__ */ new Map(), this._patterns = /* @__PURE__ */ new Set(), this._sealed = false;
          }
          add(t2) {
            if (this._sealed) throw new TypeError("ExpressionSet is sealed. Create a new ExpressionSet to add more expressions.");
            if (this._patterns.has(t2.pattern)) return this;
            if (this._patterns.add(t2.pattern), t2.hasDeepWildcard()) {
              const e3 = t2.segments[t2.segments.length - 1];
              if (e3 && "deep-wildcard" !== e3.type && "*" !== e3.tag) {
                const i3 = e3.tag;
                this._deepByTerminalTag.has(i3) || this._deepByTerminalTag.set(i3, []), this._deepByTerminalTag.get(i3).push(t2);
              } else this._deepWildcards.push(t2);
              return this;
            }
            const e2 = t2.length, i2 = t2.segments[t2.segments.length - 1], n2 = i2?.tag;
            if (n2 && "*" !== n2) {
              const i3 = `${e2}:${n2}`;
              this._byDepthAndTag.has(i3) || this._byDepthAndTag.set(i3, []), this._byDepthAndTag.get(i3).push(t2);
            } else this._wildcardByDepth.has(e2) || this._wildcardByDepth.set(e2, []), this._wildcardByDepth.get(e2).push(t2);
            return this;
          }
          addAll(t2) {
            for (const e2 of t2) this.add(e2);
            return this;
          }
          has(t2) {
            return this._patterns.has(t2.pattern);
          }
          get size() {
            return this._patterns.size;
          }
          seal() {
            return this._sealed = true, this;
          }
          get isSealed() {
            return this._sealed;
          }
          matchesAny(t2) {
            return null !== this.findMatch(t2);
          }
          findMatch(t2) {
            const e2 = t2.getDepth(), i2 = t2.getCurrentTag(), n2 = `${e2}:${i2}`, r2 = this._byDepthAndTag.get(n2);
            if (r2) {
              for (let e3 = 0; e3 < r2.length; e3++) if (t2.matches(r2[e3])) return r2[e3];
            }
            const s2 = this._wildcardByDepth.get(e2);
            if (s2) {
              for (let e3 = 0; e3 < s2.length; e3++) if (t2.matches(s2[e3])) return s2[e3];
            }
            const o2 = this._deepByTerminalTag.get(i2);
            if (o2) {
              for (let e3 = 0; e3 < o2.length; e3++) if (t2.matches(o2[e3])) return o2[e3];
            }
            for (let e3 = 0; e3 < this._deepWildcards.length; e3++) if (t2.matches(this._deepWildcards[e3])) return this._deepWildcards[e3];
            return null;
          }
        }
        const st = { cent: "\xA2", pound: "\xA3", curren: "\xA4", yen: "\xA5", euro: "\u20AC", dollar: "$", fnof: "\u0192", inr: "\u20B9", af: "\u060B", birr: "\u1265\u122D", peso: "\u20B1", rub: "\u20BD", won: "\u20A9", yuan: "\xA5", cedil: "\xB8" }, ot = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' }, at = { nbsp: "\xA0", copy: "\xA9", reg: "\xAE", trade: "\u2122", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", laquo: "\xAB", raquo: "\xBB", lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D", bull: "\u2022", para: "\xB6", sect: "\xA7", deg: "\xB0", frac12: "\xBD", frac14: "\xBC", frac34: "\xBE" }, lt = Object.freeze({ ALLOW: "allow", BLOCK: "block", THROW: "throw" }), pt = new Set("!?\\\\/[]$%{}^&*()<>|+");
        function ct(t2) {
          if ("#" === t2[0]) throw new Error(`[EntityReplacer] Invalid character '#' in entity name: "${t2}"`);
          for (const e2 of t2) if (pt.has(e2)) throw new Error(`[EntityReplacer] Invalid character '${e2}' in entity name: "${t2}"`);
          return t2;
        }
        function ht(...t2) {
          const e2 = /* @__PURE__ */ Object.create(null);
          for (const i2 of t2) if (i2) for (const t3 of Object.keys(i2)) {
            const n2 = i2[t3];
            if ("string" == typeof n2) e2[t3] = n2;
            else if (n2 && "object" == typeof n2 && void 0 !== n2.val) {
              const i3 = n2.val;
              "string" == typeof i3 && (e2[t3] = i3);
            }
          }
          return e2;
        }
        const dt = "external", ut = "base", ft = "all", gt = Object.freeze({ allow: 0, leave: 1, remove: 2, throw: 3 }), mt = /* @__PURE__ */ new Set([9, 10, 13]);
        class xt {
          constructor(t2 = {}) {
            var e2;
            this._limit = t2.limit || {}, this._maxTotalExpansions = this._limit.maxTotalExpansions || 0, this._maxExpandedLength = this._limit.maxExpandedLength || 0, this._postCheck = "function" == typeof t2.postCheck ? t2.postCheck : (t3) => t3, this._limitTiers = (e2 = this._limit.applyLimitsTo ?? dt) && e2 !== dt ? e2 === ft ? /* @__PURE__ */ new Set([ft]) : e2 === ut ? /* @__PURE__ */ new Set([ut]) : Array.isArray(e2) ? new Set(e2) : /* @__PURE__ */ new Set([dt]) : /* @__PURE__ */ new Set([dt]), this._numericAllowed = t2.numericAllowed ?? true, this._baseMap = ht(ot, t2.namedEntities || null), this._externalMap = /* @__PURE__ */ Object.create(null), this._inputMap = /* @__PURE__ */ Object.create(null), this._totalExpansions = 0, this._expandedLength = 0, this._removeSet = new Set(t2.remove && Array.isArray(t2.remove) ? t2.remove : []), this._leaveSet = new Set(t2.leave && Array.isArray(t2.leave) ? t2.leave : []);
            const i2 = (function(t3) {
              if (!t3) return { xmlVersion: 1, onLevel: gt.allow, nullLevel: gt.remove };
              const e3 = 1.1 === t3.xmlVersion ? 1.1 : 1, i3 = gt[t3.onNCR] ?? gt.allow, n2 = gt[t3.nullNCR] ?? gt.remove;
              return { xmlVersion: e3, onLevel: i3, nullLevel: Math.max(n2, gt.remove) };
            })(t2.ncr);
            this._ncrXmlVersion = i2.xmlVersion, this._ncrOnLevel = i2.onLevel, this._ncrNullLevel = i2.nullLevel, this._onExternalEntity = "function" == typeof t2.onExternalEntity ? t2.onExternalEntity : null, this._onInputEntity = "function" == typeof t2.onInputEntity ? t2.onInputEntity : null;
          }
          _applyRegistrationHook(t2, e2, i2, n2) {
            if (!t2) return true;
            const r2 = t2(e2, i2);
            if (r2 === lt.BLOCK) return false;
            if (r2 === lt.THROW) throw new Error(`[EntityDecoder] Registration of ${n2} entity "&${e2};" was rejected by hook`);
            return true;
          }
          setExternalEntities(t2) {
            if (t2) for (const e3 of Object.keys(t2)) ct(e3);
            if (!this._onExternalEntity) return void (this._externalMap = ht(t2));
            const e2 = ht(t2), i2 = /* @__PURE__ */ Object.create(null);
            for (const [t3, n2] of Object.entries(e2)) this._applyRegistrationHook(this._onExternalEntity, t3, n2, "external") && (i2[t3] = n2);
            this._externalMap = i2;
          }
          addExternalEntity(t2, e2) {
            ct(t2), "string" == typeof e2 && -1 === e2.indexOf("&") && this._applyRegistrationHook(this._onExternalEntity, t2, e2, "external") && (this._externalMap[t2] = e2);
          }
          addInputEntities(t2) {
            if (this._totalExpansions = 0, this._expandedLength = 0, !this._onInputEntity) return void (this._inputMap = ht(t2));
            const e2 = ht(t2), i2 = /* @__PURE__ */ Object.create(null);
            for (const [t3, n2] of Object.entries(e2)) this._applyRegistrationHook(this._onInputEntity, t3, n2, "input") && (i2[t3] = n2);
            this._inputMap = i2;
          }
          reset() {
            return this._inputMap = /* @__PURE__ */ Object.create(null), this._totalExpansions = 0, this._expandedLength = 0, this;
          }
          setXmlVersion(t2) {
            this._ncrXmlVersion = 1.1 === t2 ? 1.1 : 1;
          }
          decode(t2) {
            if ("string" != typeof t2 || 0 === t2.length) return t2;
            if (-1 === t2.indexOf("&")) return t2;
            const e2 = t2, i2 = [], n2 = t2.length;
            let r2 = 0, s2 = 0;
            const o2 = this._maxTotalExpansions > 0, a2 = this._maxExpandedLength > 0, l2 = o2 || a2;
            for (; s2 < n2; ) {
              if (38 !== t2.charCodeAt(s2)) {
                s2++;
                continue;
              }
              let e3 = s2 + 1;
              for (; e3 < n2 && 59 !== t2.charCodeAt(e3) && e3 - s2 <= 32; ) e3++;
              if (e3 >= n2 || 59 !== t2.charCodeAt(e3)) {
                s2++;
                continue;
              }
              const p3 = t2.slice(s2 + 1, e3);
              if (0 === p3.length) {
                s2++;
                continue;
              }
              let c2, h2;
              if (this._removeSet.has(p3)) c2 = "", void 0 === h2 && (h2 = dt);
              else {
                if (this._leaveSet.has(p3)) {
                  s2++;
                  continue;
                }
                if (35 === p3.charCodeAt(0)) {
                  const t3 = this._resolveNCR(p3);
                  if (void 0 === t3) {
                    s2++;
                    continue;
                  }
                  c2 = t3, h2 = ut;
                } else {
                  const t3 = this._resolveName(p3);
                  c2 = t3?.value, h2 = t3?.tier;
                }
              }
              if (void 0 !== c2) {
                if (s2 > r2 && i2.push(t2.slice(r2, s2)), i2.push(c2), r2 = e3 + 1, s2 = r2, l2 && this._tierCounts(h2)) {
                  if (o2 && (this._totalExpansions++, this._totalExpansions > this._maxTotalExpansions)) throw new Error(`[EntityReplacer] Entity expansion count limit exceeded: ${this._totalExpansions} > ${this._maxTotalExpansions}`);
                  if (a2) {
                    const t3 = c2.length - (p3.length + 2);
                    if (t3 > 0 && (this._expandedLength += t3, this._expandedLength > this._maxExpandedLength)) throw new Error(`[EntityReplacer] Expanded content length limit exceeded: ${this._expandedLength} > ${this._maxExpandedLength}`);
                  }
                }
              } else s2++;
            }
            r2 < n2 && i2.push(t2.slice(r2));
            const p2 = 0 === i2.length ? t2 : i2.join("");
            return this._postCheck(p2, e2);
          }
          _tierCounts(t2) {
            return !!this._limitTiers.has(ft) || this._limitTiers.has(t2);
          }
          _resolveName(t2) {
            return t2 in this._inputMap ? { value: this._inputMap[t2], tier: dt } : t2 in this._externalMap ? { value: this._externalMap[t2], tier: dt } : t2 in this._baseMap ? { value: this._baseMap[t2], tier: ut } : void 0;
          }
          _classifyNCR(t2) {
            return 0 === t2 ? this._ncrNullLevel : t2 >= 55296 && t2 <= 57343 || 1 === this._ncrXmlVersion && t2 >= 1 && t2 <= 31 && !mt.has(t2) ? gt.remove : -1;
          }
          _applyNCRAction(t2, e2, i2) {
            switch (t2) {
              case gt.allow:
                return String.fromCodePoint(i2);
              case gt.remove:
                return "";
              case gt.leave:
                return;
              case gt.throw:
                throw new Error(`[EntityDecoder] Prohibited numeric character reference &${e2}; (U+${i2.toString(16).toUpperCase().padStart(4, "0")})`);
              default:
                return String.fromCodePoint(i2);
            }
          }
          _resolveNCR(t2) {
            const e2 = t2.charCodeAt(1);
            let i2;
            if (i2 = 120 === e2 || 88 === e2 ? parseInt(t2.slice(2), 16) : parseInt(t2.slice(1), 10), Number.isNaN(i2) || i2 < 0 || i2 > 1114111) return;
            const n2 = this._classifyNCR(i2);
            if (!this._numericAllowed && n2 < gt.remove) return;
            const r2 = -1 === n2 ? this._ncrOnLevel : Math.max(this._ncrOnLevel, n2);
            return this._applyNCRAction(r2, t2, i2);
          }
        }
        const bt = [{ id: "sql-block-comment-open", description: "SQL block comment open: /* ... */ \u2014 unusual in legitimate user text", pattern: /\/\*/ }, { id: "sql-union-select", description: "UNION SELECT \u2014 most common SQL injection aggregation attack", pattern: /\bUNION\s{1,20}(?:ALL\s{1,20})?SELECT\b/i }, { id: "sql-drop-table", description: "DROP TABLE \u2014 destructive DDL injection", pattern: /\bDROP\s{1,20}TABLE\b/i }, { id: "sql-drop-database", description: "DROP DATABASE \u2014 destructive DDL injection", pattern: /\bDROP\s{1,20}DATABASE\b/i }, { id: "sql-insert-into", description: "INSERT INTO \u2014 data injection", pattern: /\bINSERT\s{1,20}INTO\b/i }, { id: "sql-delete-from", description: "DELETE FROM \u2014 data deletion injection", pattern: /\bDELETE\s{1,20}FROM\b/i }, { id: "sql-update-set", description: "UPDATE ... SET \u2014 data modification injection", pattern: /\bUPDATE\b[\s\S]{1,60}\bSET\b/i }, { id: "sql-exec-xp", description: "EXEC xp_ \u2014 MSSQL extended stored procedure execution", pattern: /\bEXEC(?:UTE)?\s{1,20}xp_/i }, { id: "sql-tautology-string", description: `Classic string tautology: ' OR '1'='1 or " OR "1"="1"`, pattern: /'\s{0,10}OR\s{0,10}'[^']{0,20}'\s*=\s*'[^']{0,20}/i }, { id: "sql-tautology-numeric", description: "Numeric tautology: OR 1=1", pattern: /\bOR\s{1,10}1\s*=\s*1\b/i }, { id: "sql-always-true-zero", description: "Numeric tautology: OR 0=0", pattern: /\bOR\s{1,10}0\s*=\s*0\b/i }, { id: "sql-sleep-benchmark", description: "Time-based blind injection: SLEEP() or BENCHMARK()", pattern: /\b(?:SLEEP|BENCHMARK)\s*\(/i }, { id: "sql-waitfor-delay", description: "MSSQL time-based blind injection: WAITFOR DELAY", pattern: /\bWAITFOR\s{1,20}DELAY\b/i }, { id: "sql-char-function", description: "CHAR() function \u2014 used to obfuscate injected strings", pattern: /\bCHAR\s*\(\s*\d{1,3}/i }, { id: "sql-information-schema", description: "INFORMATION_SCHEMA \u2014 reconnaissance query for table/column enumeration", pattern: /\bINFORMATION_SCHEMA\b/i }], yt = [...bt, { id: "sql-line-comment", description: "SQL line comment: -- followed by whitespace or end of string", pattern: /--(?:\s|$)/ }, { id: "sql-stacked-query", description: "Stacked queries: semicolon immediately followed by a SQL keyword", pattern: /;\s{0,10}(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC)\b/i }, { id: "sql-hex-encoding", description: "Hex-encoded string injection: 0x41414141 style (MySQL)", pattern: /\b0x[0-9a-f]{4,}/i }], Nt = [{ id: "html-script-open", description: "<script opening tag", pattern: /<script[\s>/]/i }, { id: "html-script-close", description: "<\/script closing tag", pattern: /<\/script[\s>]/i }, { id: "html-javascript-protocol", description: "javascript: URI scheme (with optional whitespace/encoding)", pattern: /j[\t\n\r ]*a[\t\n\r ]*v[\t\n\r ]*a[\t\n\r ]*s[\t\n\r ]*c[\t\n\r ]*r[\t\n\r ]*i[\t\n\r ]*p[\t\n\r ]*t[\t\n\r ]*:/i }, { id: "html-vbscript-protocol", description: "vbscript: URI scheme", pattern: /vbscript[\t\n\r ]*:/i }, { id: "html-data-html", description: "data:text/html URI \u2014 can execute scripts in browsers", pattern: /data[\t\n\r ]*:[\t\n\r ]*text\/html/i }, { id: "html-data-xhtml", description: "data:application/xhtml+xml URI", pattern: /data[\t\n\r ]*:[\t\n\r ]*application\/xhtml/i }, { id: "html-data-svg", description: "data:image/svg+xml URI \u2014 can execute scripts", pattern: /data[\t\n\r ]*:[\t\n\r ]*image\/svg\+xml/i }, { id: "html-inline-event-handler", description: "Inline event handler attributes: onclick=, onerror=, onload=, etc.", pattern: /\bon\w{1,30}\s*=/i }, { id: "html-entity-obfuscated-script", description: "HTML-entity-encoded <script (e.g. &#x3C;script or &lt;script)", pattern: /(?:&#x0*3[Cc];?|&#0*60;?|&lt;)\s*script/i }, { id: "html-entity-obfuscated-javascript", description: 'HTML-entity-encoded javascript: (partial \u2014 catches common &#106; or &#x6a; for "j")', pattern: /(?:&#x0*6[Aa];?|&#0*106;?)\s*(?:&#x0*61;?|a)[\s\S]{0,80}script\s*:/i }, { id: "html-style-expression", description: "CSS expression() \u2014 IE-era code execution in style attributes", pattern: /style[\s\S]{0,20}expression\s*\(/i }, { id: "html-object-embed", description: "<object or <embed tags that can load active content", pattern: /<(?:object|embed)[\s>/]/i }, { id: "html-base-tag", description: "<base href= \u2014 can hijack all relative URLs on a page", pattern: /<base[\s>]/i }, { id: "html-meta-refresh", description: '<meta http-equiv="refresh" \u2014 can redirect users', pattern: /<meta[\s\S]{0,40}http-equiv[\s\S]{0,20}refresh/i }, { id: "html-srcdoc", description: "srcdoc= attribute on iframes \u2014 embeds HTML that can run scripts", pattern: /srcdoc\s*=/i }, { id: "html-iframe", description: "<iframe tag", pattern: /<iframe[\s>/]/i }, { id: "html-form", description: "<form tag \u2014 can be used for phishing / credential harvesting injection", pattern: /<form[\s>/]/i }], Et = [{ id: "xml-cdata-injection", description: "CDATA section injection: <![CDATA[ breaks out of text node context", pattern: /<!\[CDATA\[/i }, { id: "xml-cdata-close", description: "CDATA close sequence: ]]> can terminate an enclosing CDATA section", pattern: /\]\]>/ }, { id: "xml-processing-instruction", description: "XML processing instruction: <?xml-stylesheet or <?php etc.", pattern: /<\?(?:xml[\- ]|php|asp)/i }, { id: "xml-doctype-injection", description: "DOCTYPE declaration embedded in content \u2014 can define entities", pattern: /<!DOCTYPE(?:[\s[]|$)/i }, { id: "xml-entity-system", description: "SYSTEM keyword \u2014 used in external entity declarations (XXE)", pattern: /\bSYSTEM\s+["']/i }, { id: "xml-entity-public", description: "PUBLIC keyword \u2014 used in external entity declarations (XXE)", pattern: /\bPUBLIC\s+["']/i }, { id: "xml-entity-declaration", description: "<!ENTITY declaration \u2014 defines entities, potential XXE or entity expansion", pattern: /<!ENTITY[\s%]/i }, { id: "xml-billion-laughs", description: "Entity reference chaining / billion laughs: repeated &eX; style references", pattern: /(?:&\w{1,20};){3,}/ }, { id: "xml-namespace-confusion", description: "xmlns: attribute injection \u2014 can redefine namespaces to confuse parsers", pattern: /\bxmlns\s*(?::\w{1,40})?\s*=/i }, { id: "xml-comment-injection", description: "<!-- comment injection \u2014 can hide content from some parsers", pattern: /<!--/ }, { id: "xml-comment-close", description: "--> closes an enclosing XML comment", pattern: /-->/ }, { id: "xml-pi-close", description: "?> closes an enclosing processing instruction", pattern: /\?>/ }], wt = [{ id: "svg-script-element", description: "<script element inside SVG executes JavaScript", pattern: /<script[\s>/]/i }, { id: "svg-xlink-href-javascript", description: "xlink:href with javascript: \u2014 classic SVG XSS via <a> or <use>", pattern: /xlink\s*:\s*href\s*=\s*["']?\s*javascript\s*:/i }, { id: "svg-href-javascript", description: "href= with javascript: in SVG context (<a>, <animate>, etc.)", pattern: /href\s*=\s*["']?\s*javascript\s*:/i }, { id: "svg-foreignobject", description: "<foreignObject embeds HTML inside SVG \u2014 can execute scripts", pattern: /<foreignObject[\s>/]/i }, { id: "svg-use-external", description: "<use xlink:href or href pointing to external resource (non-fragment URL)", pattern: /<use[\s\S]{0,60}(?:xlink\s*:\s*)?href\s*=\s*(?:["'][^#]|[^"'#\s>])/i }, { id: "svg-animate-href", description: '<animate attributeName="href" \u2014 can dynamically change href to javascript:', pattern: /<animate[\s\S]{0,80}attributeName\s*=\s*["'][\s]*href["']/i }, { id: "svg-animate-xlinkhref", description: '<animate attributeName="xlink:href"', pattern: /<animate[\s\S]{0,80}attributeName\s*=\s*["'][\s]*xlink\s*:\s*href["']/i }, { id: "svg-set-javascript", description: '<set to="javascript:..." \u2014 sets an attribute to a javascript: URI', pattern: /<set[\s\S]{0,80}to\s*=\s*["']?\s*javascript\s*:/i }, { id: "svg-event-handler", description: "SVG-specific event handler attributes: onload=, onerror=, onactivate=, etc.", pattern: /\bon(?:load|error|activate|begin|end|repeat|focus|blur|click|mouse\w{1,20}|key\w{1,20})\s*=/i }, { id: "svg-handler-generic", description: "Generic on* handler catch-all for SVG attributes", pattern: /\bon\w{1,30}\s*=/i }, { id: "svg-filter-feimage", description: "<feImage href= \u2014 filter primitive that can load external resources", pattern: /<feImage[\s\S]{0,80}(?:xlink\s*:\s*)?href\s*=/i }, { id: "svg-image-external", description: "<image xlink:href with http/https or javascript protocol", pattern: /<image[\s\S]{0,80}(?:xlink\s*:\s*)?href\s*=\s*["']?\s*(?:https?|javascript)\s*:/i }, { id: "svg-style-javascript", description: "style= attribute containing javascript: (e.g. background:url(javascript:...))", pattern: /style\s*=[\s\S]{0,60}javascript\s*:/i }], vt = [{ id: "shell-path-traversal-unix", description: "Unix path traversal: ../  \u2014 climbing the directory tree", pattern: /\.\.\// }, { id: "shell-path-traversal-windows", description: "Windows path traversal: ..\\ \u2014 climbing the directory tree", pattern: /\.\.\\/ }, { id: "shell-path-traversal-encoded", description: "URL-encoded path traversal: %2e%2e or %2f variants", pattern: /%2e%2e|%2f\.\.|\.\.%2f/i }, { id: "shell-null-byte", description: "Null byte injection: \\x00 or %00 \u2014 truncates strings in C-backed functions", pattern: /\x00|%00/ }, { id: "shell-semicolon", description: "Semicolon command separator: cmd1; cmd2", pattern: /;/ }, { id: "shell-pipe", description: "Pipe operator: cmd1 | cmd2", pattern: /\|/ }, { id: "shell-and-operator", description: "AND operator: cmd1 && cmd2", pattern: /&&/ }, { id: "shell-or-operator", description: "OR operator: cmd1 || cmd2", pattern: /\|\|/ }, { id: "shell-backtick", description: "Backtick command substitution: `cmd`", pattern: /`/ }, { id: "shell-dollar-paren", description: "Dollar-paren command substitution: $(cmd)", pattern: /\$\(/ }, { id: "shell-dollar-brace", description: "Dollar-brace variable expansion: ${var} \u2014 can be abused for injection", pattern: /\$\{/ }, { id: "shell-redirect-out", description: "Output redirection: cmd > file or cmd >> file", pattern: />{1,2}/ }, { id: "shell-redirect-in", description: "Input redirection: cmd < file", pattern: /</ }, { id: "shell-newline-injection", description: "Newline injection: \\n or \\r \u2014 can inject new shell commands", pattern: /[\n\r]/ }, { id: "shell-glob-star", description: "Glob expansion: * or ? \u2014 can expand to unintended files", pattern: /[/\\][*?]/ }, { id: "shell-absolute-root", description: "Absolute root path injection: string starting with / or \\ (Windows UNC)", pattern: /^(?:\/|\\\\)/ }, { id: "shell-windows-drive", description: "Windows drive letter path injection: C:\\ or D:/", pattern: /^[a-zA-Z]:[/\\]/ }, { id: "shell-curl-wget", description: "curl/wget with URL or flags \u2014 can exfiltrate data or download payloads", pattern: /\b(?:curl|wget)\s+(?:https?:\/\/|ftp:\/\/|-)/i }], St = [{ id: "redos-nested-quantifier-plus", description: "Nested + quantifier inside a group with outer quantifier: (a+)+, (.+b)*, etc.", pattern: /\([^)]*\+[^)]*\)[+*]/ }, { id: "redos-nested-quantifier-star", description: "Nested * quantifier: (a*)* or (a*)+ \u2014 catastrophic backtracking", pattern: /\([^)]*\*[^)]*\)[*+]/ }, { id: "redos-nested-groups", description: "Doubly nested quantified groups: ((a+)+) \u2014 guaranteed catastrophic", pattern: /\(\([^)]{0,40}\)[+*]\)[+*]/ }, { id: "redos-alternation-overlap", description: "Overlapping alternation under quantifier: (a|a)+ \u2014 ambiguous NFA paths", pattern: /\(([^|()]{1,20})\|(?:\1)(?:\|[^|()]{1,20}){0,5}\)[+*?]{1,2}/ }, { id: "redos-star-plus-concat", description: "(x*x)+ pattern \u2014 triggers super-linear backtracking", pattern: /\([^)]{0,10}\*[^)]{0,10}\)[+*]/ }, { id: "redos-dot-star-greedy", description: "(.*){n,} or (.+){n,} \u2014 repeated greedy dot quantifiers", pattern: /\(\.[*+]\)\{?\d/ }, { id: "redos-large-repetition", description: "Very large fixed or range repetition count {1000,} or {1000,n} \u2014 denial of service via backtracking", pattern: /\{\d{4,}(?:,\d*)?\}/ }, { id: "redos-catastrophic-alternation", description: "Long alternation with many similar branches \u2014 polynomial backtracking risk", pattern: /\([^)]{0,200}(?:\|[^|)]{0,50}){9,}\)/ }], At = `["'\\s]*:`, Tt = [{ id: "nosql-where-operator", description: "$where \u2014 executes arbitrary JavaScript server-side in MongoDB", pattern: new RegExp(`\\$where${At}`, "i") }, { id: "nosql-ne-operator", description: '$ne \u2014 "not equal" operator used to bypass equality checks', pattern: new RegExp(`\\$ne${At}`, "i") }, { id: "nosql-gt-operator", description: '$gt \u2014 "greater than" used to bypass password/value checks', pattern: new RegExp(`\\$gte?${At}`, "i") }, { id: "nosql-lt-operator", description: '$lt / $lte \u2014 "less than" bypass variants', pattern: new RegExp(`\\$lte?${At}`, "i") }, { id: "nosql-regex-operator", description: "$regex \u2014 can be used to extract data character by character (blind injection)", pattern: new RegExp(`\\$regex${At}`, "i") }, { id: "nosql-or-operator", description: "$or \u2014 logical OR; used to create always-true conditions", pattern: new RegExp(`\\$or${At}\\s*\\[`, "i") }, { id: "nosql-and-operator", description: "$and \u2014 logical AND operator injection", pattern: new RegExp(`\\$and${At}\\s*\\[`, "i") }, { id: "nosql-nor-operator", description: "$nor \u2014 logical NOR operator injection", pattern: new RegExp(`\\$nor${At}\\s*\\[`, "i") }, { id: "nosql-exists-operator", description: "$exists \u2014 can enumerate fields to determine schema", pattern: new RegExp(`\\$exists${At}`, "i") }, { id: "nosql-in-operator", description: "$in \u2014 matches any value in a list; can enumerate values", pattern: new RegExp(`\\$in${At}\\s*\\[`, "i") }, { id: "nosql-expr-operator", description: "$expr \u2014 allows aggregation expressions in queries (MongoDB 3.6+)", pattern: new RegExp(`\\$expr${At}`, "i") }, { id: "nosql-function-operator", description: "$function \u2014 executes arbitrary JavaScript in MongoDB 4.4+", pattern: new RegExp(`\\$function${At}`, "i") }, { id: "nosql-accumulator-operator", description: "$accumulator \u2014 custom aggregation with arbitrary JS execution", pattern: new RegExp(`\\$accumulator${At}`, "i") }, { id: "nosql-proto-pollution", description: "__proto__ \u2014 prototype pollution via object key injection", pattern: /__proto__/ }, { id: "nosql-constructor-prototype", description: "constructor.prototype \u2014 alternative prototype pollution vector (dot notation or JSON key)", pattern: /constructor[\s"':.,{\[]*prototype/i }, { id: "nosql-proto-bracket", description: '["__proto__"] \u2014 bracket-notation prototype pollution', pattern: /\[["']__proto__["']\]/ }], _t = [{ id: "log-crlf-injection", description: "CRLF injection: literal \\r or \\n embeds fake log lines", pattern: /[\r\n]/ }, { id: "log-url-encoded-crlf", description: "URL-encoded CRLF: %0d, %0a, %0D, %0A \u2014 decoded by some log parsers", pattern: /%0[dDaA]/ }, { id: "log-unicode-newline", description: "Unicode newline variants: U+2028 (line separator), U+2029 (paragraph separator)", pattern: /[\u2028\u2029]/ }, { id: "log-log4shell-jndi", description: "Log4Shell: ${jndi:...} triggers remote code execution in Apache Log4j", pattern: /\$\{jndi\s*:/i }, { id: "log-log4shell-obfuscated", description: "Obfuscated Log4Shell: ${::-j}... lookup-bypass prefix used to evade WAF detection", pattern: /\$\{::-/ }, { id: "log-log4j-lookup", description: "Log4j lookup syntax: ${env:...}, ${sys:...}, ${ctx:...} \u2014 data exfiltration", pattern: /\$\{(?:env|sys|ctx|main|map|sd|web|docker|k8s|spring)\s*:/i }, { id: "log-ssti-double-brace", description: "SSTI double-brace: {{expression}} \u2014 Jinja2, Twig, Handlebars, etc.", pattern: /\{\{[\s\S]{0,80}\}\}/ }, { id: "log-ssti-hash-brace", description: "SSTI hash-brace: #{expression} \u2014 Thymeleaf, Velocity, Ruby ERB", pattern: /#\{[\s\S]{0,80}\}/ }, { id: "log-ssti-dollar-brace", description: "SSTI/EL injection: ${expression with operators or method calls} \u2014 JSP EL, Freemarker, SpEL", pattern: /\$\{[^}]*(?:\.|\(|\*|\+|\bclass\b|\bruntime\b|\bprocess\b|\bexec\b)[^}]{0,80}\}/i }, { id: "log-ssti-percent-tag", description: "SSTI ERB/ASP tag: <%= expression %> \u2014 Ruby ERB, ASP", pattern: /<%=[\s\S]{0,80}%>/ }, { id: "log-null-byte", description: "Null byte: \\x00 or %00 \u2014 can truncate log entries in C-backed loggers", pattern: /\x00|%00/ }, { id: "log-ansi-escape", description: "ANSI escape sequence: ESC[ \u2014 can manipulate terminal output when logs are tailed", pattern: /\x1b\[/ }];
        function Ct(t2, e2) {
          const i2 = e2.label ?? "CUSTOM";
          for (const n2 of e2) if (n2.pattern.test(t2)) return { context: i2, id: n2.id, description: n2.description, pattern: n2.pattern };
          return null;
        }
        function $t(t2, e2) {
          (function(t3) {
            if ("string" != typeof t3) throw new TypeError("is-unsafe: first argument must be a string, got " + typeof t3);
          })(t2), (function(t3) {
            if (!(t3 instanceof RegExp)) {
              if (!Array.isArray(t3)) throw new TypeError("is-unsafe: second argument must be a PatternList (e.g. HTML), an array of PatternLists (e.g. [HTML, XML]), or a RegExp. Got: " + typeof t3);
              if (0 === t3.length) throw new TypeError("is-unsafe: context must not be an empty array");
              if (Array.isArray(t3[0])) {
                for (const e3 of t3) if (!Array.isArray(e3) || 0 === e3.length) throw new TypeError("is-unsafe: each context in the array must be a non-empty pattern array (PatternList)");
              }
            }
          })(e2);
          const { lists: i2, regex: n2 } = (function(t3) {
            return t3 instanceof RegExp ? { lists: null, regex: t3 } : Array.isArray(t3[0]) ? { lists: t3, regex: null } : { lists: [t3], regex: null };
          })(e2);
          if (n2) return n2.test(t2);
          for (const e3 of i2) if (null !== Ct(t2, e3)) return true;
          return false;
        }
        function Pt(t2, e2) {
          if (!t2) return {};
          const i2 = e2.attributesGroupName ? t2[e2.attributesGroupName] : t2;
          if (!i2) return {};
          const n2 = {};
          for (const t3 in i2) t3.startsWith(e2.attributeNamePrefix) ? n2[t3.substring(e2.attributeNamePrefix.length)] = i2[t3] : n2[t3] = i2[t3];
          return n2;
        }
        function Ot(t2) {
          if (!t2 || "string" != typeof t2) return;
          const e2 = t2.indexOf(":");
          if (-1 !== e2 && e2 > 0) {
            const i2 = t2.substring(0, e2);
            if ("xmlns" !== i2) return i2;
          }
        }
        Nt.label = "HTML", Et.label = "XML", wt.label = "SVG", bt.label = "SQL", yt.label = "SQL-STRICT", vt.label = "SHELL", St.label = "REDOS", Tt.label = "NOSQL", _t.label = "LOG", Object.freeze({ HTML: Nt, XML: Et, SVG: wt, SQL: bt, "SQL-STRICT": yt, SHELL: vt, REDOS: St, NOSQL: Tt, LOG: _t });
        class It {
          constructor(t2, e2) {
            var i2;
            this.options = t2, this.currentNode = null, this.tagsNodeStack = [], this.parseXml = Rt, this.parseTextData = jt, this.resolveNameSpace = kt, this.buildAttributesMap = Dt, this.isItStopNode = Ft, this.replaceEntitiesValue = Vt, this.readStopNodeData = Xt, this.saveTextToParentTag = qt, this.addChild = Mt, this.ignoreAttributesFn = "function" == typeof (i2 = this.options.ignoreAttributes) ? i2 : Array.isArray(i2) ? (t3) => {
              for (const e3 of i2) {
                if ("string" == typeof e3 && t3 === e3) return true;
                if (e3 instanceof RegExp && e3.test(t3)) return true;
              }
            } : () => false, this.entityExpansionCount = 0, this.currentExpandedLength = 0, this.doctypefound = false;
            let n2 = { ...ot };
            this.options.entityDecoder ? this.entityDecoder = this.options.entityDecoder : ("object" == typeof this.options.htmlEntities ? n2 = this.options.htmlEntities : true === this.options.htmlEntities && (n2 = { ...at, ...st }), this.entityDecoder = new xt({ namedEntities: { ...n2, ...e2 }, numericAllowed: this.options.htmlEntities, limit: { maxTotalExpansions: this.options.processEntities.maxTotalExpansions, maxExpandedLength: this.options.processEntities.maxExpandedLength, applyLimitsTo: this.options.processEntities.appliesTo }, onInputEntity: (t3, e3) => $t(e3, [Nt, Et]) ? lt.BLOCK : lt.ALLOW })), this.matcher = new it(), this.readonlyMatcher = this.matcher.readOnly(), this.isCurrentNodeStopNode = false, this.stopNodeExpressionsSet = new rt();
            const r2 = this.options.stopNodes;
            if (r2 && r2.length > 0) {
              for (let t3 = 0; t3 < r2.length; t3++) {
                const e3 = r2[t3];
                "string" == typeof e3 ? this.stopNodeExpressionsSet.add(new nt(e3)) : e3 instanceof nt && this.stopNodeExpressionsSet.add(e3);
              }
              this.stopNodeExpressionsSet.seal();
            }
          }
        }
        function jt(t2, e2, i2, n2, r2, s2, o2) {
          const a2 = this.options;
          if (void 0 !== t2 && (a2.trimValues && !n2 && (t2 = t2.trim()), t2.length > 0)) {
            o2 || (t2 = this.replaceEntitiesValue(t2, e2, i2));
            const n3 = a2.jPath ? i2.toString() : i2, l2 = a2.tagValueProcessor(e2, t2, n3, r2, s2);
            return null == l2 ? t2 : typeof l2 != typeof t2 || l2 !== t2 ? l2 : a2.trimValues || t2.trim() === t2 ? Wt(t2, a2.parseTagValue, a2.numberParseOptions) : t2;
          }
        }
        function kt(t2) {
          if (this.options.removeNSPrefix) {
            const e2 = t2.split(":"), i2 = "/" === t2.charAt(0) ? "/" : "";
            if ("xmlns" === e2[0]) return "";
            2 === e2.length && (t2 = i2 + e2[1]);
          }
          return t2;
        }
        const Lt = new RegExp(`([^\\s=]+)\\s*(=\\s*(['"])([\\s\\S]*?)\\3)?`, "gm");
        function Dt(t2, e2, i2, n2 = false) {
          const r2 = this.options;
          if (true === n2 || true !== r2.ignoreAttributes && "string" == typeof t2) {
            const n3 = (function(t3, e3) {
              const i3 = [];
              let n4 = e3.exec(t3);
              for (; n4; ) {
                const r3 = [];
                r3.startIndex = e3.lastIndex - n4[0].length;
                const s3 = n4.length;
                for (let t4 = 0; t4 < s3; t4++) r3.push(n4[t4]);
                i3.push(r3), n4 = e3.exec(t3);
              }
              return i3;
            })(t2, Lt), s2 = n3.length, o2 = {}, a2 = new Array(s2);
            let l2 = false;
            const p2 = {};
            for (let t3 = 0; t3 < s2; t3++) {
              const e3 = this.resolveNameSpace(n3[t3][1]), s3 = n3[t3][4];
              if (e3.length && void 0 !== s3) {
                let n4 = s3;
                r2.trimValues && (n4 = n4.trim()), n4 = this.replaceEntitiesValue(n4, i2, this.readonlyMatcher), a2[t3] = n4, p2[e3] = n4, l2 = true;
              }
            }
            l2 && "object" == typeof e2 && e2.updateCurrent && e2.updateCurrent(p2);
            const c2 = r2.jPath ? e2.toString() : this.readonlyMatcher;
            let h2 = false;
            for (let t3 = 0; t3 < s2; t3++) {
              const e3 = this.resolveNameSpace(n3[t3][1]);
              if (this.ignoreAttributesFn(e3, c2)) continue;
              let i3 = r2.attributeNamePrefix + e3;
              if (e3.length) if (r2.transformAttributeName && (i3 = r2.transformAttributeName(i3)), i3 = Yt(i3, r2), void 0 !== n3[t3][4]) {
                const n4 = a2[t3], s3 = r2.attributeValueProcessor(e3, n4, c2);
                o2[i3] = null == s3 ? n4 : typeof s3 != typeof n4 || s3 !== n4 ? s3 : Wt(n4, r2.parseAttributeValue, r2.numberParseOptions), h2 = true;
              } else r2.allowBooleanAttributes && (o2[i3] = true, h2 = true);
            }
            if (!h2) return;
            if (r2.attributesGroupName && !r2.preserveOrder) {
              const t3 = {};
              return t3[r2.attributesGroupName] = o2, t3;
            }
            return o2;
          }
        }
        const Rt = function(t2) {
          t2 = t2.replace(/\r\n?/g, "\n");
          const e2 = new C("!xml");
          let i2 = e2, n2 = "";
          this.matcher.reset(), this.entityDecoder.reset(), this.entityExpansionCount = 0, this.currentExpandedLength = 0, this.doctypefound = false;
          const r2 = this.options, s2 = new M(r2.processEntities), o2 = t2.length;
          for (let a2 = 0; a2 < o2; a2++) if ("<" === t2[a2]) {
            const l2 = t2.charCodeAt(a2 + 1);
            if (47 === l2) {
              const s3 = Ut(t2, ">", a2, "Closing Tag is not closed.");
              let o3 = t2.substring(a2 + 2, s3).trim();
              if (r2.removeNSPrefix) {
                const t3 = o3.indexOf(":");
                -1 !== t3 && (o3 = o3.substr(t3 + 1));
              }
              o3 = zt(r2.transformTagName, o3, "", r2).tagName, i2 && (n2 = this.saveTextToParentTag(n2, i2, this.readonlyMatcher));
              const l3 = this.matcher.getCurrentTag();
              if (o3 && r2.unpairedTagsSet.has(o3)) throw new Error(`Unpaired tag can not be used as closing tag: </${o3}>`);
              l3 && r2.unpairedTagsSet.has(l3) && (this.matcher.pop(), this.tagsNodeStack.pop()), this.matcher.pop(), this.isCurrentNodeStopNode = false, i2 = this.tagsNodeStack.pop() || e2, r2.captureMetaData && i2 && i2.addEndIndex(s3 + 1), n2 = "", a2 = s3;
            } else if (63 === l2) {
              let e3 = Gt(t2, a2, false, "?>");
              if (!e3) throw new Error("Pi Tag is not closed.");
              n2 = this.saveTextToParentTag(n2, i2, this.readonlyMatcher);
              const o3 = this.buildAttributesMap(e3.tagExp, this.matcher, e3.tagName, true);
              if (o3) {
                const t3 = o3[this.options.attributeNamePrefix + "version"];
                this.entityDecoder.setXmlVersion(Number(t3) || 1), s2.setXmlVersion(Number(t3) || 1);
              }
              if (r2.ignoreDeclaration && "?xml" === e3.tagName || r2.ignorePiTags) ;
              else {
                const t3 = new C(e3.tagName);
                t3.add(r2.textNodeName, ""), e3.tagName !== e3.tagExp && e3.attrExpPresent && true !== r2.ignoreAttributes && (t3[":@"] = o3), this.addChild(i2, t3, this.readonlyMatcher, a2), r2.captureMetaData && i2.addEndIndex(e3.closeIndex + 2);
              }
              a2 = e3.closeIndex + 1;
            } else if (33 === l2 && 45 === t2.charCodeAt(a2 + 2) && 45 === t2.charCodeAt(a2 + 3)) {
              const e3 = Ut(t2, "-->", a2 + 4, "Comment is not closed.");
              if (r2.commentPropName) {
                const s3 = t2.substring(a2 + 4, e3 - 2);
                n2 = this.saveTextToParentTag(n2, i2, this.readonlyMatcher), i2.add(r2.commentPropName, [{ [r2.textNodeName]: s3 }]);
              }
              a2 = e3;
            } else if (33 === l2 && 68 === t2.charCodeAt(a2 + 2)) {
              if (this.doctypefound) throw new Error("Multiple DOCTYPE declarations found.");
              this.doctypefound = true;
              const e3 = s2.readDocType(t2, a2);
              this.entityDecoder.addInputEntities(e3.entities), a2 = e3.i;
            } else if (33 === l2 && 91 === t2.charCodeAt(a2 + 2)) {
              const e3 = Ut(t2, "]]>", a2, "CDATA is not closed.") - 2, s3 = t2.substring(a2 + 9, e3);
              n2 = this.saveTextToParentTag(n2, i2, this.readonlyMatcher);
              let o3 = this.parseTextData(s3, i2.tagname, this.readonlyMatcher, true, false, true, true);
              null == o3 && (o3 = ""), r2.cdataPropName ? i2.add(r2.cdataPropName, [{ [r2.textNodeName]: s3 }]) : i2.add(r2.textNodeName, o3), a2 = e3 + 2;
            } else {
              let s3 = Gt(t2, a2, r2.removeNSPrefix);
              if (!s3) {
                const e3 = t2.substring(Math.max(0, a2 - 50), Math.min(o2, a2 + 50));
                throw new Error(`readTagExp returned undefined at position ${a2}. Context: "${e3}"`);
              }
              let l3 = s3.tagName;
              const p2 = s3.rawTagName;
              let c2 = s3.tagExp, h2 = s3.attrExpPresent, d2 = s3.closeIndex;
              if ({ tagName: l3, tagExp: c2 } = zt(r2.transformTagName, l3, c2, r2), r2.strictReservedNames && (l3 === r2.commentPropName || l3 === r2.cdataPropName || l3 === r2.textNodeName || l3 === r2.attributesGroupName)) throw new Error(`Invalid tag name: ${l3}`);
              i2 && n2 && "!xml" !== i2.tagname && (n2 = this.saveTextToParentTag(n2, i2, this.readonlyMatcher, false));
              const u2 = i2;
              u2 && r2.unpairedTagsSet.has(u2.tagname) && (i2 = this.tagsNodeStack.pop(), this.matcher.pop());
              let f2 = false;
              c2.length > 0 && c2.lastIndexOf("/") === c2.length - 1 && (f2 = true, "/" === l3[l3.length - 1] ? (l3 = l3.substr(0, l3.length - 1), c2 = l3) : c2 = c2.substr(0, c2.length - 1), h2 = l3 !== c2);
              let g2, m2 = null, x2 = {};
              g2 = Ot(p2), l3 !== e2.tagname && this.matcher.push(l3, {}, g2), l3 !== c2 && h2 && (m2 = this.buildAttributesMap(c2, this.matcher, l3), m2 && (x2 = Pt(m2, r2))), l3 !== e2.tagname && (this.isCurrentNodeStopNode = this.isItStopNode());
              const b2 = a2;
              if (this.isCurrentNodeStopNode) {
                let e3 = "";
                if (f2) a2 = s3.closeIndex;
                else if (r2.unpairedTagsSet.has(l3)) a2 = s3.closeIndex;
                else {
                  const i3 = this.readStopNodeData(t2, p2, d2 + 1);
                  if (!i3) throw new Error(`Unexpected end of ${p2}`);
                  a2 = i3.i, e3 = i3.tagContent;
                }
                const n3 = new C(l3);
                m2 && (n3[":@"] = m2), n3.add(r2.textNodeName, e3), this.matcher.pop(), this.isCurrentNodeStopNode = false, this.addChild(i2, n3, this.readonlyMatcher, b2), r2.captureMetaData && i2.addEndIndex(a2 + 1);
              } else {
                if (f2) {
                  ({ tagName: l3, tagExp: c2 } = zt(r2.transformTagName, l3, c2, r2));
                  const t3 = new C(l3);
                  m2 && (t3[":@"] = m2), this.addChild(i2, t3, this.readonlyMatcher, b2), r2.captureMetaData && i2.addEndIndex(d2 + 1), this.matcher.pop(), this.isCurrentNodeStopNode = false;
                } else {
                  if (r2.unpairedTagsSet.has(l3)) {
                    const t3 = new C(l3);
                    m2 && (t3[":@"] = m2), this.addChild(i2, t3, this.readonlyMatcher, b2), r2.captureMetaData && i2.addEndIndex(s3.closeIndex + 1), this.matcher.pop(), this.isCurrentNodeStopNode = false, a2 = s3.closeIndex;
                    continue;
                  }
                  {
                    const t3 = new C(l3);
                    if (this.tagsNodeStack.length > r2.maxNestedTags) throw new Error("Maximum nested tags exceeded");
                    this.tagsNodeStack.push(i2), m2 && (t3[":@"] = m2), this.addChild(i2, t3, this.readonlyMatcher, b2), i2 = t3;
                  }
                }
                n2 = "", a2 = d2;
              }
            }
          } else n2 += t2[a2];
          return e2.child;
        };
        function Mt(t2, e2, i2, n2) {
          this.options.captureMetaData || (n2 = void 0);
          const r2 = this.options.jPath ? i2.toString() : i2, s2 = this.options.updateTag(e2.tagname, r2, e2[":@"]);
          false === s2 || ("string" == typeof s2 ? (e2.tagname = s2, t2.addChild(e2, n2)) : t2.addChild(e2, n2));
        }
        function Vt(t2, e2, i2) {
          const n2 = this.options.processEntities;
          if (!n2 || !n2.enabled) return t2;
          if (n2.allowedTags) {
            const r2 = this.options.jPath ? i2.toString() : i2;
            if (!(Array.isArray(n2.allowedTags) ? n2.allowedTags.includes(e2) : n2.allowedTags(e2, r2))) return t2;
          }
          if (n2.tagFilter) {
            const r2 = this.options.jPath ? i2.toString() : i2;
            if (!n2.tagFilter(e2, r2)) return t2;
          }
          return this.entityDecoder.decode(t2);
        }
        function qt(t2, e2, i2, n2) {
          return t2 && (void 0 === n2 && (n2 = 0 === e2.child.length), void 0 !== (t2 = this.parseTextData(t2, e2.tagname, i2, false, !!e2[":@"] && 0 !== Object.keys(e2[":@"]).length, n2)) && "" !== t2 && e2.add(this.options.textNodeName, t2), t2 = ""), t2;
        }
        function Ft() {
          return 0 !== this.stopNodeExpressionsSet.size && this.matcher.matchesAny(this.stopNodeExpressionsSet);
        }
        function Ut(t2, e2, i2, n2) {
          const r2 = t2.indexOf(e2, i2);
          if (-1 === r2) throw new Error(n2);
          return r2 + e2.length - 1;
        }
        function Bt(t2, e2, i2, n2) {
          const r2 = t2.indexOf(e2, i2);
          if (-1 === r2) throw new Error(n2);
          return r2;
        }
        function Gt(t2, e2, i2, n2 = ">") {
          const r2 = (function(t3, e3, i3 = ">") {
            let n3 = 0;
            const r3 = t3.length, s3 = i3.charCodeAt(0), o3 = i3.length > 1 ? i3.charCodeAt(1) : -1;
            let a3 = "", l3 = e3;
            for (let i4 = e3; i4 < r3; i4++) {
              const e4 = t3.charCodeAt(i4);
              if (n3) e4 === n3 && (n3 = 0);
              else if (34 === e4 || 39 === e4) n3 = e4;
              else if (e4 === s3) {
                if (-1 === o3) return a3 += t3.substring(l3, i4), { data: a3, index: i4 };
                if (t3.charCodeAt(i4 + 1) === o3) return a3 += t3.substring(l3, i4), { data: a3, index: i4 };
              } else 9 !== e4 || n3 || (a3 += t3.substring(l3, i4) + " ", l3 = i4 + 1);
            }
          })(t2, e2 + 1, n2);
          if (!r2) return;
          let s2 = r2.data;
          const o2 = r2.index, a2 = s2.search(/\s/);
          let l2 = s2, p2 = true;
          -1 !== a2 && (l2 = s2.substring(0, a2), s2 = s2.substring(a2 + 1).trimStart());
          const c2 = l2;
          if (i2) {
            const t3 = l2.indexOf(":");
            -1 !== t3 && (l2 = l2.substr(t3 + 1), p2 = l2 !== r2.data.substr(t3 + 1));
          }
          return { tagName: l2, tagExp: s2, closeIndex: o2, attrExpPresent: p2, rawTagName: c2 };
        }
        function Xt(t2, e2, i2) {
          const n2 = i2;
          let r2 = 1;
          const s2 = t2.length;
          for (; i2 < s2; i2++) if ("<" === t2[i2]) {
            const s3 = t2.charCodeAt(i2 + 1);
            if (47 === s3) {
              const s4 = Bt(t2, ">", i2, `${e2} is not closed`);
              if (t2.substring(i2 + 2, s4).trim() === e2 && (r2--, 0 === r2)) return { tagContent: t2.substring(n2, i2), i: s4 };
              i2 = s4;
            } else if (63 === s3) i2 = Ut(t2, "?>", i2 + 1, "StopNode is not closed.");
            else if (33 === s3 && 45 === t2.charCodeAt(i2 + 2) && 45 === t2.charCodeAt(i2 + 3)) i2 = Ut(t2, "-->", i2 + 3, "StopNode is not closed.");
            else if (33 === s3 && 91 === t2.charCodeAt(i2 + 2)) i2 = Ut(t2, "]]>", i2, "StopNode is not closed.") - 2;
            else {
              const n3 = Gt(t2, i2, false);
              n3 && ((n3 && n3.tagName) === e2 && "/" !== n3.tagExp[n3.tagExp.length - 1] && r2++, i2 = n3.closeIndex);
            }
          }
        }
        function Wt(t2, e2, i2) {
          if (e2 && "string" == typeof t2) {
            const e3 = t2.trim();
            return "true" === e3 || "false" !== e3 && Z(t2, i2);
          }
          return void 0 !== t2 ? t2 : "";
        }
        function zt(t2, e2, i2, n2) {
          if (t2) {
            const n3 = t2(e2);
            i2 === e2 && (i2 = n3), e2 = n3;
          }
          return { tagName: e2 = Yt(e2, n2), tagExp: i2 };
        }
        function Yt(t2, e2) {
          if (o.includes(t2)) throw new Error(`[SECURITY] Invalid name: "${t2}" is a reserved JavaScript keyword that could cause prototype pollution`);
          return s.includes(t2) ? e2.onDangerousProperty(t2) : t2;
        }
        const Ht = C.getMetaDataSymbol();
        function Qt(t2, e2) {
          if (!t2 || "object" != typeof t2) return {};
          if (!e2) return t2;
          const i2 = {};
          for (const n2 in t2) n2.startsWith(e2) ? i2[n2.substring(e2.length)] = t2[n2] : i2[n2] = t2[n2];
          return i2;
        }
        function Jt(t2, e2, i2, n2) {
          return Zt(t2, e2, i2, n2);
        }
        function Zt(t2, e2, i2, n2) {
          let r2;
          const s2 = {};
          for (let o2 = 0; o2 < t2.length; o2++) {
            const a2 = t2[o2], l2 = Kt(a2);
            if (void 0 !== l2 && l2 !== e2.textNodeName) {
              const t3 = Qt(a2[":@"] || {}, e2.attributeNamePrefix);
              i2.push(l2, t3);
            }
            if (l2 === e2.textNodeName) void 0 === r2 ? r2 = a2[l2] : r2 += "" + a2[l2];
            else {
              if (void 0 === l2) continue;
              if (a2[l2]) {
                let t3 = Zt(a2[l2], e2, i2, n2);
                const r3 = ee(t3, e2);
                if (0 === Object.keys(t3).length && e2.alwaysCreateTextNode && (t3[e2.textNodeName] = ""), a2[":@"] ? te(t3, a2[":@"], n2, e2) : 1 !== Object.keys(t3).length || void 0 === t3[e2.textNodeName] || e2.alwaysCreateTextNode ? 0 === Object.keys(t3).length && (e2.alwaysCreateTextNode ? t3[e2.textNodeName] = "" : t3 = "") : t3 = t3[e2.textNodeName], void 0 !== a2[Ht] && "object" == typeof t3 && null !== t3 && (t3[Ht] = a2[Ht]), void 0 !== s2[l2] && Object.prototype.hasOwnProperty.call(s2, l2)) Array.isArray(s2[l2]) || (s2[l2] = [s2[l2]]), s2[l2].push(t3);
                else {
                  const i3 = e2.jPath ? n2.toString() : n2;
                  e2.isArray(l2, i3, r3) ? s2[l2] = [t3] : s2[l2] = t3;
                }
                void 0 !== l2 && l2 !== e2.textNodeName && i2.pop();
              }
            }
          }
          return "string" == typeof r2 ? r2.length > 0 && (s2[e2.textNodeName] = r2) : void 0 !== r2 && (s2[e2.textNodeName] = r2), s2;
        }
        function Kt(t2) {
          const e2 = Object.keys(t2);
          for (let t3 = 0; t3 < e2.length; t3++) {
            const i2 = e2[t3];
            if (":@" !== i2) return i2;
          }
        }
        function te(t2, e2, i2, n2) {
          if (e2) {
            const r2 = Object.keys(e2), s2 = r2.length;
            for (let o2 = 0; o2 < s2; o2++) {
              const s3 = r2[o2], a2 = s3.startsWith(n2.attributeNamePrefix) ? s3.substring(n2.attributeNamePrefix.length) : s3, l2 = n2.jPath ? i2.toString() + "." + a2 : i2;
              n2.isArray(s3, l2, true, true) ? t2[s3] = [e2[s3]] : t2[s3] = e2[s3];
            }
          }
        }
        function ee(t2, e2) {
          const { textNodeName: i2 } = e2, n2 = Object.keys(t2).length;
          return 0 === n2 || !(1 !== n2 || !t2[i2] && "boolean" != typeof t2[i2] && 0 !== t2[i2]);
        }
        class ie {
          constructor(t2) {
            this.externalEntities = {}, this.options = T(t2);
          }
          parse(t2, e2) {
            if ("string" != typeof t2 && t2.toString) t2 = t2.toString();
            else if ("string" != typeof t2) throw new Error("XML data is accepted in String or Bytes[] form.");
            if (e2) {
              true === e2 && (e2 = {});
              const i3 = l(t2, e2);
              if (true !== i3) throw Error(`${i3.err.msg}:${i3.err.line}:${i3.err.col}`);
            }
            const i2 = new It(this.options, this.externalEntities), n2 = i2.parseXml(t2);
            return this.options.preserveOrder || void 0 === n2 ? n2 : Jt(n2, this.options, i2.matcher, i2.readonlyMatcher);
          }
          addEntity(t2, e2) {
            if (-1 !== e2.indexOf("&")) throw new Error("Entity value can't have '&'");
            if (-1 !== t2.indexOf("&") || -1 !== t2.indexOf(";")) throw new Error("An entity must be set without '&' and ';'. Eg. use '#xD' for '&#xD;'");
            if ("&" === e2) throw new Error("An entity with value '&' is not permitted");
            this.externalEntities[t2] = e2;
          }
          static getMetaDataSymbol() {
            return C.getMetaDataSymbol();
          }
        }
        function ne(t2) {
          return String(t2).replace(/--/g, "- -").replace(/--/g, "- -").replace(/-$/, "- ");
        }
        function re(t2) {
          return String(t2).replace(/\]\]>/g, "]]]]><![CDATA[>");
        }
        function se(t2) {
          return String(t2).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
        }
        const oe = ":A-Za-z_\xC0-\xD6\xD8-\xF6\xF8-\u02FF\u0370-\u037D\u037F-\u0486\u0488-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD", ae = ":A-Za-z_\xC0-\u02FF\u0370-\u037D\u037F-\u0486\u0488-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}", le = ae + "\\-\\.\\d\xB7\u0300-\u036F\u0487\u203F-\u2040", pe = (t2, e2, i2 = "") => {
          const n2 = `[${t2.replace(":", "")}][${e2.replace(":", "")}]*`;
          return { name: new RegExp(`^[${t2}][${e2}]*$`, i2), ncName: new RegExp(`^${n2}$`, i2), qName: new RegExp(`^${n2}(?::${n2})?$`, i2), nmToken: new RegExp(`^[${e2}]+$`, i2), nmTokens: new RegExp(`^[${e2}]+(?:\\s+[${e2}]+)*$`, i2) };
        }, ce = pe(oe, oe + "\\-\\.\\d\xB7\u0300-\u036F\u203F-\u2040"), he = pe(ae, le, "u"), de = (t2, { xmlVersion: e2 = "1.0" } = {}) => (/* @__PURE__ */ ((t3 = "1.0") => "1.1" === t3 ? he : ce)(e2)).qName.test(t2);
        function ue(t2, e2, i2, n2, r2) {
          return i2.sanitizeName ? de(t2, { xmlVersion: r2 }) ? t2 : i2.sanitizeName(t2, { isAttribute: e2, matcher: n2.readOnly() }) : t2;
        }
        function fe(t2, e2) {
          let i2 = "";
          e2.format && (i2 = "\n");
          const n2 = [];
          if (e2.stopNodes && Array.isArray(e2.stopNodes)) for (let t3 = 0; t3 < e2.stopNodes.length; t3++) {
            const i3 = e2.stopNodes[t3];
            "string" == typeof i3 ? n2.push(new nt(i3)) : i3 instanceof nt && n2.push(i3);
          }
          const r2 = (function(t3, e3) {
            if (!Array.isArray(t3) || 0 === t3.length) return "1.0";
            const i3 = t3[0];
            if ("?xml" === ye(i3)) {
              const t4 = i3[":@"];
              if (t4) {
                const i4 = e3.attributeNamePrefix + "version";
                if (t4[i4]) return t4[i4];
              }
            }
            return "1.0";
          })(t2, e2);
          return ge(t2, e2, i2, new it(), n2, r2);
        }
        function ge(t2, e2, i2, n2, r2, s2) {
          let o2 = "", a2 = false;
          if (e2.maxNestedTags && n2.getDepth() > e2.maxNestedTags) throw new Error("Maximum nested tags exceeded");
          if (!Array.isArray(t2)) {
            if (null != t2) {
              let i3 = t2.toString();
              return i3 = we(i3, e2), i3;
            }
            return "";
          }
          for (let l2 = 0; l2 < t2.length; l2++) {
            const p2 = t2[l2], c2 = ye(p2);
            if (void 0 === c2) continue;
            const h2 = c2 === e2.textNodeName || c2 === e2.cdataPropName || c2 === e2.commentPropName || "?" === c2[0] ? c2 : ue(c2, false, e2, n2, s2), d2 = me(p2[":@"], e2);
            n2.push(h2, d2);
            const u2 = Ee(n2, r2);
            if (h2 === e2.textNodeName) {
              let t3 = p2[c2];
              u2 || (t3 = e2.tagValueProcessor(h2, t3), t3 = we(t3, e2)), a2 && (o2 += i2), o2 += t3, a2 = false, n2.pop();
              continue;
            }
            if (h2 === e2.cdataPropName) {
              a2 && (o2 += i2), o2 += `<![CDATA[${re(p2[c2][0][e2.textNodeName])}]]>`, a2 = false, n2.pop();
              continue;
            }
            if (h2 === e2.commentPropName) {
              o2 += i2 + `<!--${ne(p2[c2][0][e2.textNodeName])}-->`, a2 = true, n2.pop();
              continue;
            }
            if ("?" === h2[0]) {
              o2 += ("?xml" === h2 ? "" : i2) + `<${h2}${Ne(p2[":@"], e2, u2, n2, s2)}?>`, a2 = true, n2.pop();
              continue;
            }
            let f2 = i2;
            "" !== f2 && (f2 += e2.indentBy);
            const g2 = i2 + `<${h2}${Ne(p2[":@"], e2, u2, n2, s2)}`;
            let m2;
            m2 = u2 ? xe(p2[c2], e2) : ge(p2[c2], e2, f2, n2, r2, s2), -1 !== e2.unpairedTags.indexOf(h2) ? e2.suppressUnpairedNode ? o2 += g2 + ">" : o2 += g2 + "/>" : m2 && 0 !== m2.length || !e2.suppressEmptyNode ? m2 && m2.endsWith(">") ? o2 += g2 + `>${m2}${i2}</${h2}>` : (o2 += g2 + ">", m2 && "" !== i2 && (m2.includes("/>") || m2.includes("</")) ? o2 += i2 + e2.indentBy + m2 + i2 : o2 += m2, o2 += `</${h2}>`) : o2 += g2 + "/>", a2 = true, n2.pop();
          }
          return o2;
        }
        function me(t2, e2) {
          if (!t2 || e2.ignoreAttributes) return null;
          const i2 = {};
          let n2 = false;
          for (let r2 in t2) Object.prototype.hasOwnProperty.call(t2, r2) && (i2[r2.startsWith(e2.attributeNamePrefix) ? r2.substr(e2.attributeNamePrefix.length) : r2] = se(t2[r2]), n2 = true);
          return n2 ? i2 : null;
        }
        function xe(t2, e2) {
          if (!Array.isArray(t2)) return null != t2 ? t2.toString() : "";
          let i2 = "";
          for (let n2 = 0; n2 < t2.length; n2++) {
            const r2 = t2[n2], s2 = ye(r2);
            if (s2 === e2.textNodeName) i2 += r2[s2];
            else if (s2 === e2.cdataPropName) i2 += r2[s2][0][e2.textNodeName];
            else if (s2 === e2.commentPropName) i2 += r2[s2][0][e2.textNodeName];
            else {
              if (s2 && "?" === s2[0]) continue;
              if (s2) {
                const t3 = be(r2[":@"], e2), n3 = xe(r2[s2], e2);
                n3 && 0 !== n3.length ? i2 += `<${s2}${t3}>${n3}</${s2}>` : i2 += `<${s2}${t3}/>`;
              }
            }
          }
          return i2;
        }
        function be(t2, e2) {
          let i2 = "";
          if (t2 && !e2.ignoreAttributes) for (let n2 in t2) {
            if (!Object.prototype.hasOwnProperty.call(t2, n2)) continue;
            let r2 = t2[n2];
            true === r2 && e2.suppressBooleanAttributes ? i2 += ` ${n2.substr(e2.attributeNamePrefix.length)}` : i2 += ` ${n2.substr(e2.attributeNamePrefix.length)}="${se(r2)}"`;
          }
          return i2;
        }
        function ye(t2) {
          const e2 = Object.keys(t2);
          for (let i2 = 0; i2 < e2.length; i2++) {
            const n2 = e2[i2];
            if (Object.prototype.hasOwnProperty.call(t2, n2) && ":@" !== n2) return n2;
          }
        }
        function Ne(t2, e2, i2, n2, r2) {
          let s2 = "";
          if (t2 && !e2.ignoreAttributes) for (let o2 in t2) {
            if (!Object.prototype.hasOwnProperty.call(t2, o2)) continue;
            const a2 = o2.substr(e2.attributeNamePrefix.length), l2 = i2 ? a2 : ue(a2, true, e2, n2, r2);
            let p2;
            i2 ? p2 = t2[o2] : (p2 = e2.attributeValueProcessor(o2, t2[o2]), p2 = we(p2, e2)), true === p2 && e2.suppressBooleanAttributes ? s2 += ` ${l2}` : s2 += ` ${l2}="${se(p2)}"`;
          }
          return s2;
        }
        function Ee(t2, e2) {
          if (!e2 || 0 === e2.length) return false;
          for (let i2 = 0; i2 < e2.length; i2++) if (t2.matches(e2[i2])) return true;
          return false;
        }
        function we(t2, e2) {
          if (t2 && t2.length > 0 && e2.processEntities) for (let i2 = 0; i2 < e2.entities.length; i2++) {
            const n2 = e2.entities[i2];
            t2 = t2.replace(n2.regex, n2.val);
          }
          return t2;
        }
        const ve = { attributeNamePrefix: "@_", attributesGroupName: false, textNodeName: "#text", ignoreAttributes: true, cdataPropName: false, format: false, indentBy: "  ", suppressEmptyNode: false, suppressUnpairedNode: true, suppressBooleanAttributes: true, tagValueProcessor: function(t2, e2) {
          return e2;
        }, attributeValueProcessor: function(t2, e2) {
          return e2;
        }, preserveOrder: false, commentPropName: false, unpairedTags: [], entities: [{ regex: new RegExp("&", "g"), val: "&amp;" }, { regex: new RegExp(">", "g"), val: "&gt;" }, { regex: new RegExp("<", "g"), val: "&lt;" }, { regex: new RegExp("'", "g"), val: "&apos;" }, { regex: new RegExp('"', "g"), val: "&quot;" }], processEntities: true, stopNodes: [], oneListGroup: false, maxNestedTags: 100, jPath: true, sanitizeName: false };
        function Se(t2) {
          if (this.options = Object.assign({}, ve, t2), this.options.stopNodes && Array.isArray(this.options.stopNodes) && (this.options.stopNodes = this.options.stopNodes.map((t3) => "string" == typeof t3 && t3.startsWith("*.") ? ".." + t3.substring(2) : t3)), this.stopNodeExpressions = [], this.options.stopNodes && Array.isArray(this.options.stopNodes)) for (let t3 = 0; t3 < this.options.stopNodes.length; t3++) {
            const e3 = this.options.stopNodes[t3];
            "string" == typeof e3 ? this.stopNodeExpressions.push(new nt(e3)) : e3 instanceof nt && this.stopNodeExpressions.push(e3);
          }
          var e2;
          true === this.options.ignoreAttributes || this.options.attributesGroupName ? this.isAttribute = function() {
            return false;
          } : (this.ignoreAttributesFn = "function" == typeof (e2 = this.options.ignoreAttributes) ? e2 : Array.isArray(e2) ? (t3) => {
            for (const i2 of e2) {
              if ("string" == typeof i2 && t3 === i2) return true;
              if (i2 instanceof RegExp && i2.test(t3)) return true;
            }
          } : () => false, this.attrPrefixLen = this.options.attributeNamePrefix.length, this.isAttribute = Ce), this.processTextOrObjNode = Te, this.options.format ? (this.indentate = _e, this.tagEndChar = ">\n", this.newLine = "\n") : (this.indentate = function() {
            return "";
          }, this.tagEndChar = ">", this.newLine = "");
        }
        function Ae(t2, e2, i2, n2, r2) {
          return i2.sanitizeName ? de(t2, { xmlVersion: r2 }) ? t2 : i2.sanitizeName(t2, { isAttribute: e2, matcher: n2.readOnly() }) : t2;
        }
        function Te(t2, e2, i2, n2, r2) {
          const s2 = this.extractAttributes(t2);
          if (n2.push(e2, s2), this.checkStopNode(n2)) {
            const r3 = this.buildRawContent(t2), s3 = this.buildAttributesForStopNode(t2);
            return n2.pop(), this.buildObjectNode(r3, e2, s3, i2);
          }
          const o2 = this.j2x(t2, i2 + 1, n2, r2);
          return n2.pop(), "?" === e2[0] ? this.buildTextValNode("", e2, o2.attrStr, i2, n2) : void 0 !== t2[this.options.textNodeName] && 1 === Object.keys(t2).length ? this.buildTextValNode(t2[this.options.textNodeName], e2, o2.attrStr, i2, n2) : this.buildObjectNode(o2.val, e2, o2.attrStr, i2);
        }
        function _e(t2) {
          return this.options.indentBy.repeat(t2);
        }
        function Ce(t2) {
          return !(!t2.startsWith(this.options.attributeNamePrefix) || t2 === this.options.textNodeName) && t2.substr(this.attrPrefixLen);
        }
        Se.prototype.build = function(t2) {
          if (this.options.preserveOrder) return fe(t2, this.options);
          {
            Array.isArray(t2) && this.options.arrayNodeName && this.options.arrayNodeName.length > 1 && (t2 = { [this.options.arrayNodeName]: t2 });
            const e2 = new it(), i2 = (function(t3, e3) {
              const i3 = t3["?xml"];
              if (i3 && "object" == typeof i3) {
                if (e3.attributesGroupName && i3[e3.attributesGroupName]) {
                  const t5 = i3[e3.attributesGroupName][e3.attributeNamePrefix + "version"];
                  if (t5) return t5;
                }
                const t4 = i3[e3.attributeNamePrefix + "version"];
                if (t4) return t4;
              }
              return "1.0";
            })(t2, this.options);
            return this.j2x(t2, 0, e2, i2).val;
          }
        }, Se.prototype.j2x = function(t2, e2, i2, n2) {
          let r2 = "", s2 = "";
          if (this.options.maxNestedTags && i2.getDepth() >= this.options.maxNestedTags) throw new Error("Maximum nested tags exceeded");
          const o2 = this.options.jPath ? i2.toString() : i2, a2 = this.checkStopNode(i2);
          for (let l2 in t2) {
            if (!Object.prototype.hasOwnProperty.call(t2, l2)) continue;
            const p2 = l2 === this.options.textNodeName || l2 === this.options.cdataPropName || l2 === this.options.commentPropName || this.options.attributesGroupName && l2 === this.options.attributesGroupName || this.isAttribute(l2) || "?" === l2[0] ? l2 : Ae(l2, false, this.options, i2, n2);
            if (void 0 === t2[l2]) this.isAttribute(l2) && (s2 += "");
            else if (null === t2[l2]) this.isAttribute(l2) || p2 === this.options.cdataPropName || p2 === this.options.commentPropName ? s2 += "" : "?" === p2[0] ? s2 += this.indentate(e2) + "<" + p2 + "?" + this.tagEndChar : s2 += this.indentate(e2) + "<" + p2 + "/" + this.tagEndChar;
            else if (t2[l2] instanceof Date) s2 += this.buildTextValNode(t2[l2], p2, "", e2, i2);
            else if ("object" != typeof t2[l2]) {
              const c2 = this.isAttribute(l2);
              if (c2 && !this.ignoreAttributesFn(c2, o2)) {
                const e3 = Ae(c2, true, this.options, i2, n2);
                r2 += this.buildAttrPairStr(e3, "" + t2[l2], a2);
              } else if (!c2) if (l2 === this.options.textNodeName) {
                let e3 = this.options.tagValueProcessor(l2, "" + t2[l2]);
                s2 += this.replaceEntitiesValue(e3);
              } else {
                i2.push(p2);
                const n3 = this.checkStopNode(i2);
                if (i2.pop(), n3) {
                  const i3 = "" + t2[l2];
                  s2 += "" === i3 ? this.indentate(e2) + "<" + p2 + this.closeTag(p2) + this.tagEndChar : this.indentate(e2) + "<" + p2 + ">" + i3 + "</" + p2 + this.tagEndChar;
                } else s2 += this.buildTextValNode(t2[l2], p2, "", e2, i2);
              }
            } else if (Array.isArray(t2[l2])) {
              const r3 = t2[l2].length;
              let o3 = "", a3 = "";
              for (let c2 = 0; c2 < r3; c2++) {
                const r4 = t2[l2][c2];
                if (void 0 === r4) ;
                else if (null === r4) "?" === p2[0] ? s2 += this.indentate(e2) + "<" + p2 + "?" + this.tagEndChar : s2 += this.indentate(e2) + "<" + p2 + "/" + this.tagEndChar;
                else if ("object" == typeof r4) if (this.options.oneListGroup) {
                  i2.push(p2);
                  const t3 = this.j2x(r4, e2 + 1, i2, n2);
                  i2.pop(), o3 += t3.val, this.options.attributesGroupName && r4.hasOwnProperty(this.options.attributesGroupName) && (a3 += t3.attrStr);
                } else o3 += this.processTextOrObjNode(r4, p2, e2, i2, n2);
                else if (this.options.oneListGroup) {
                  let t3 = this.options.tagValueProcessor(p2, r4);
                  t3 = this.replaceEntitiesValue(t3), o3 += t3;
                } else {
                  i2.push(p2);
                  const t3 = this.checkStopNode(i2);
                  if (i2.pop(), t3) {
                    const t4 = "" + r4;
                    o3 += "" === t4 ? this.indentate(e2) + "<" + p2 + this.closeTag(p2) + this.tagEndChar : this.indentate(e2) + "<" + p2 + ">" + t4 + "</" + p2 + this.tagEndChar;
                  } else o3 += this.buildTextValNode(r4, p2, "", e2, i2);
                }
              }
              this.options.oneListGroup && (o3 = this.buildObjectNode(o3, p2, a3, e2)), s2 += o3;
            } else if (this.options.attributesGroupName && l2 === this.options.attributesGroupName) {
              const e3 = Object.keys(t2[l2]), s3 = e3.length;
              for (let o3 = 0; o3 < s3; o3++) {
                const s4 = Ae(e3[o3], true, this.options, i2, n2);
                r2 += this.buildAttrPairStr(s4, "" + t2[l2][e3[o3]], a2);
              }
            } else s2 += this.processTextOrObjNode(t2[l2], p2, e2, i2, n2);
          }
          return { attrStr: r2, val: s2 };
        }, Se.prototype.buildAttrPairStr = function(t2, e2, i2) {
          return i2 || (e2 = this.options.attributeValueProcessor(t2, "" + e2), e2 = this.replaceEntitiesValue(e2)), this.options.suppressBooleanAttributes && "true" === e2 ? " " + t2 : " " + t2 + '="' + se(e2) + '"';
        }, Se.prototype.extractAttributes = function(t2) {
          if (!t2 || "object" != typeof t2) return null;
          const e2 = {};
          let i2 = false;
          if (this.options.attributesGroupName && t2[this.options.attributesGroupName]) {
            const n2 = t2[this.options.attributesGroupName];
            for (let t3 in n2) Object.prototype.hasOwnProperty.call(n2, t3) && (e2[t3.startsWith(this.options.attributeNamePrefix) ? t3.substring(this.options.attributeNamePrefix.length) : t3] = se(n2[t3]), i2 = true);
          } else for (let n2 in t2) {
            if (!Object.prototype.hasOwnProperty.call(t2, n2)) continue;
            const r2 = this.isAttribute(n2);
            r2 && (e2[r2] = se(t2[n2]), i2 = true);
          }
          return i2 ? e2 : null;
        }, Se.prototype.buildRawContent = function(t2) {
          if ("string" == typeof t2) return t2;
          if ("object" != typeof t2 || null === t2) return String(t2);
          if (void 0 !== t2[this.options.textNodeName]) return t2[this.options.textNodeName];
          let e2 = "";
          for (let i2 in t2) {
            if (!Object.prototype.hasOwnProperty.call(t2, i2)) continue;
            if (this.isAttribute(i2)) continue;
            if (this.options.attributesGroupName && i2 === this.options.attributesGroupName) continue;
            const n2 = t2[i2];
            if (i2 === this.options.textNodeName) e2 += n2;
            else if (Array.isArray(n2)) {
              for (let t3 of n2) if ("string" == typeof t3 || "number" == typeof t3) e2 += `<${i2}>${t3}</${i2}>`;
              else if ("object" == typeof t3 && null !== t3) {
                const n3 = this.buildRawContent(t3), r2 = this.buildAttributesForStopNode(t3);
                e2 += "" === n3 ? `<${i2}${r2}/>` : `<${i2}${r2}>${n3}</${i2}>`;
              }
            } else if ("object" == typeof n2 && null !== n2) {
              const t3 = this.buildRawContent(n2), r2 = this.buildAttributesForStopNode(n2);
              e2 += "" === t3 ? `<${i2}${r2}/>` : `<${i2}${r2}>${t3}</${i2}>`;
            } else e2 += `<${i2}>${n2}</${i2}>`;
          }
          return e2;
        }, Se.prototype.buildAttributesForStopNode = function(t2) {
          if (!t2 || "object" != typeof t2) return "";
          let e2 = "";
          if (this.options.attributesGroupName && t2[this.options.attributesGroupName]) {
            const i2 = t2[this.options.attributesGroupName];
            for (let t3 in i2) {
              if (!Object.prototype.hasOwnProperty.call(i2, t3)) continue;
              const n2 = t3.startsWith(this.options.attributeNamePrefix) ? t3.substring(this.options.attributeNamePrefix.length) : t3, r2 = i2[t3];
              true === r2 && this.options.suppressBooleanAttributes ? e2 += " " + n2 : e2 += " " + n2 + '="' + r2 + '"';
            }
          } else for (let i2 in t2) {
            if (!Object.prototype.hasOwnProperty.call(t2, i2)) continue;
            const n2 = this.isAttribute(i2);
            if (n2) {
              const r2 = t2[i2];
              true === r2 && this.options.suppressBooleanAttributes ? e2 += " " + n2 : e2 += " " + n2 + '="' + r2 + '"';
            }
          }
          return e2;
        }, Se.prototype.buildObjectNode = function(t2, e2, i2, n2) {
          if ("" === t2) return "?" === e2[0] ? this.indentate(n2) + "<" + e2 + i2 + "?" + this.tagEndChar : this.indentate(n2) + "<" + e2 + i2 + this.closeTag(e2) + this.tagEndChar;
          if ("?" === e2[0]) return this.indentate(n2) + "<" + e2 + i2 + "?" + this.tagEndChar;
          {
            let r2 = "</" + e2 + this.tagEndChar, s2 = "";
            return "?" === e2[0] && (s2 = "?", r2 = ""), !i2 && "" !== i2 || -1 !== t2.indexOf("<") ? false !== this.options.commentPropName && e2 === this.options.commentPropName && 0 === s2.length ? this.indentate(n2) + `<!--${t2}-->` + this.newLine : this.indentate(n2) + "<" + e2 + i2 + s2 + this.tagEndChar + t2 + this.indentate(n2) + r2 : this.indentate(n2) + "<" + e2 + i2 + s2 + ">" + t2 + r2;
          }
        }, Se.prototype.closeTag = function(t2) {
          let e2 = "";
          return -1 !== this.options.unpairedTags.indexOf(t2) ? this.options.suppressUnpairedNode || (e2 = "/") : e2 = this.options.suppressEmptyNode ? "/" : `></${t2}`, e2;
        }, Se.prototype.checkStopNode = function(t2) {
          if (!this.stopNodeExpressions || 0 === this.stopNodeExpressions.length) return false;
          for (let e2 = 0; e2 < this.stopNodeExpressions.length; e2++) if (t2.matches(this.stopNodeExpressions[e2])) return true;
          return false;
        }, Se.prototype.buildTextValNode = function(t2, e2, i2, n2, r2) {
          if (false !== this.options.cdataPropName && e2 === this.options.cdataPropName) {
            const e3 = re(t2);
            return this.indentate(n2) + `<![CDATA[${e3}]]>` + this.newLine;
          }
          if (false !== this.options.commentPropName && e2 === this.options.commentPropName) {
            const e3 = ne(t2);
            return this.indentate(n2) + `<!--${e3}-->` + this.newLine;
          }
          if ("?" === e2[0]) return this.indentate(n2) + "<" + e2 + i2 + "?" + this.tagEndChar;
          {
            let r3 = this.options.tagValueProcessor(e2, t2);
            return r3 = this.replaceEntitiesValue(r3), "" === r3 ? this.indentate(n2) + "<" + e2 + i2 + this.closeTag(e2) + this.tagEndChar : this.indentate(n2) + "<" + e2 + i2 + ">" + r3 + "</" + e2 + this.tagEndChar;
          }
        }, Se.prototype.replaceEntitiesValue = function(t2) {
          if (t2 && t2.length > 0 && this.options.processEntities) for (let e2 = 0; e2 < this.options.entities.length; e2++) {
            const i2 = this.options.entities[e2];
            t2 = t2.replace(i2.regex, i2.val);
          }
          return t2;
        };
        const $e = Se, Pe = { validate: l };
        module.exports = e;
      })();
    }
  });

  // lib/cxmlAnonymizer.js
  var require_cxmlAnonymizer = __commonJS({
    "lib/cxmlAnonymizer.js"(exports, module) {
      var { XMLParser, XMLBuilder } = require_fxp();
      var SUPPLIER_ROLES = /* @__PURE__ */ new Set([
        "sales",
        "customerService",
        "technicalSupport",
        "supplierCorporate",
        "SupplierAccount",
        "supplierMasterAccount",
        "billFrom",
        "from",
        "issuerOfInvoice",
        "remitTo",
        "shipFrom",
        "wireReceivingBank"
      ]);
      var ANONYMIZE_TO_TYPES = /* @__PURE__ */ new Set(["PO", "PO_CHANGE", "GR", "RA"]);
      var CONTACT_ANON_FIELDS = /* @__PURE__ */ new Set([
        "Name",
        "Street",
        "City",
        "State",
        "PostalCode",
        "Phone",
        "Fax"
      ]);
      var ANONYMIZED_EMAIL = "xxx@email.com";
      var DELIVERTO_DISQUALIFY_RE = /[_\[\]()\-;]|\d{4,}/;
      var DELIVERTO_MAX_LEN = 17;
      function anonymizeString(value) {
        if (!value || value.trim() === "") return value;
        let digitCounter = 0;
        return value.replace(/[a-zA-Z0-9]/g, (ch) => {
          if (/\d/.test(ch)) {
            const val = (digitCounter % 10 + 1) % 10;
            digitCounter++;
            return String(val === 0 ? 0 : val);
          }
          return "X";
        });
      }
      function makeParser() {
        return new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: "@_",
          allowBooleanAttributes: true,
          parseAttributeValue: false,
          // keep attribute values as strings
          parseTagValue: false,
          // keep text content as strings
          trimValues: false,
          // preserve whitespace for faithful round-trip
          cdataPropName: "__cdata",
          commentPropName: "__comment",
          preserveOrder: true
          // critical: keeps element order intact
        });
      }
      function makeBuilder() {
        return new XMLBuilder({
          ignoreAttributes: false,
          attributeNamePrefix: "@_",
          cdataPropName: "__cdata",
          commentPropName: "__comment",
          preserveOrder: true,
          format: false,
          // do not reformat — preserve original indentation
          suppressEmptyNode: false
        });
      }
      function walk(nodes, visitor, parentTags = []) {
        if (!Array.isArray(nodes)) return;
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          for (const key of Object.keys(node)) {
            if (key === ":@" || key === "__comment" || key === "__cdata") continue;
            visitor(node, key, i, nodes, parentTags);
            if (Array.isArray(node[key])) {
              walk(node[key], visitor, [...parentTags, key]);
            }
          }
        }
      }
      function findChild(nodes, tagName) {
        if (!Array.isArray(nodes)) return null;
        return nodes.find((n) => Object.prototype.hasOwnProperty.call(n, tagName)) || null;
      }
      function getText(nodeChildren) {
        if (!Array.isArray(nodeChildren)) return "";
        const textNode = nodeChildren.find((n) => n["#text"] !== void 0);
        return textNode ? String(textNode["#text"]) : "";
      }
      function setText(nodeChildren, value) {
        if (!Array.isArray(nodeChildren)) return;
        const textNode = nodeChildren.find((n) => n["#text"] !== void 0);
        if (textNode) {
          textNode["#text"] = value;
        } else {
          nodeChildren.unshift({ "#text": value });
        }
      }
      function anonymizeContactChildren(contactChildren, language, warnings) {
        if (!Array.isArray(contactChildren)) return;
        for (const child of contactChildren) {
          const tag = Object.keys(child).find((k) => k !== ":@");
          if (!tag) continue;
          const children = child[tag];
          if (tag === "PostalAddress") {
            anonymizeContactChildren(children, language, warnings);
            continue;
          }
          if (!CONTACT_ANON_FIELDS.has(tag)) continue;
          if (tag === "Phone" || tag === "Fax") {
            anonymizePhoneOrFax(children);
            continue;
          }
          if (tag === "Country") continue;
          const text = getText(children);
          if (!text || text.trim() === "") continue;
          setText(children, anonymizeString(text));
        }
      }
      function anonymizeDeliverTo(children, language, warnings) {
        if (!Array.isArray(children)) return;
        const text = getText(children);
        if (!text || text.trim() === "") return;
        const firstLine = text.split("\n")[0].trim();
        if (language === "zh" || language === "ja") {
          const isNameOnly = firstLine.length <= DELIVERTO_MAX_LEN && !DELIVERTO_DISQUALIFY_RE.test(firstLine);
          if (!isNameOnly) {
            warnings.push(
              `DeliverTo "${firstLine}" \u2014 \u53EF\u80FD\u5305\u542B\u975E\u4EBA\u540D\u4FE1\u606F\uFF0C\u8BF7\u624B\u52A8\u786E\u8BA4\u5E76\u8131\u654F\u5904\u7406\u3002`
            );
            return;
          }
        }
        setText(children, anonymizeString(text));
      }
      function anonymizePhoneOrFax(children) {
        if (!Array.isArray(children)) return;
        walk(children, (node, tag) => {
          if (tag === "AreaOrCityCode" || tag === "Number") {
            const text = getText(node[tag]);
            if (text && text.trim()) {
              setText(node[tag], anonymizeString(text));
            }
          }
        });
      }
      function anonymizeAllEmails(nodes) {
        walk(nodes, (node, tag) => {
          if (tag !== "Email") return;
          const text = getText(node[tag]);
          if (!text || text.trim() === "") return;
          setText(node[tag], ANONYMIZED_EMAIL);
        });
      }
      function anonymizeAllDeliverTo(nodes, language, warnings) {
        walk(nodes, (node, tag, index, array) => {
          if (tag !== "DeliverTo") return;
          const hasPriorSibling = array.slice(0, index).some(
            (sibling) => Object.prototype.hasOwnProperty.call(sibling, "DeliverTo")
          );
          if (hasPriorSibling) return;
          anonymizeDeliverTo(node[tag], language, warnings);
        });
      }
      function anonymizeSupplierContacts(nodes, language, warnings) {
        walk(nodes, (node, tag) => {
          if (tag !== "Contact") return;
          const attrs = node[":@"] || {};
          const role = attrs["@_role"] || "";
          if (!SUPPLIER_ROLES.has(role)) return;
          anonymizeContactChildren(node[tag], language, warnings);
        });
      }
      function anonymizePartIds(nodes) {
        walk(nodes, (node, tag) => {
          if (tag !== "SupplierPartID" && tag !== "BuyerPartID") return;
          const text = getText(node[tag]);
          if (!text || text.trim() === "" || text.trim() === "Not Available") return;
          setText(node[tag], anonymizeString(text));
        });
      }
      function anonymizeDescriptions(nodes, parentTags = []) {
        if (!Array.isArray(nodes)) return;
        for (const node of nodes) {
          for (const tag of Object.keys(node)) {
            if (tag === ":@" || tag === "__comment" || tag === "__cdata") continue;
            if (tag === "Description") {
              const inTaxContext = parentTags.some((t) => t === "TaxDetail" || t === "TaxHeader");
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
      function anonymizeHeaderBlock(headerChildren, docType) {
        if (!Array.isArray(headerChildren)) return;
        const blockTag = ANONYMIZE_TO_TYPES.has(docType) ? "To" : "From";
        const blockNode = findChild(headerChildren, blockTag);
        if (!blockNode) return;
        walk(blockNode[blockTag], (node, tag) => {
          if (tag !== "Credential") return;
          const attrs = node[":@"] || {};
          const domain = attrs["@_domain"] || "";
          const identityNode = findChild(node[tag], "Identity");
          if (!identityNode) return;
          const text = getText(identityNode["Identity"]);
          if (!text || !text.trim()) return;
          if (domain.toLowerCase() === "networkid") {
            const match = text.match(/^(AN)(\d+)(-T)?$/i);
            if (match) {
              const prefix = match[1].toUpperCase();
              const suffix = match[3] || "";
              let digitCounter = 0;
              const anonDigits = match[2].replace(/\d/g, () => {
                const val = (digitCounter % 10 + 1) % 10;
                digitCounter++;
                return String(val === 0 ? 0 : val);
              });
              setText(identityNode["Identity"], prefix + anonDigits + suffix);
            } else {
              setText(identityNode["Identity"], anonymizeString(text));
            }
          } else {
            setText(identityNode["Identity"], anonymizeString(text));
          }
        });
        const CONTACT_TEXT_TAGS = /* @__PURE__ */ new Set([
          "Name",
          "Street",
          "City",
          "State",
          "PostalCode"
        ]);
        walk(blockNode[blockTag], (node, tag) => {
          if (tag === "Country") return;
          if (CONTACT_TEXT_TAGS.has(tag)) {
            const text = getText(node[tag]);
            if (text && text.trim()) setText(node[tag], anonymizeString(text));
            return;
          }
          if (tag === "Email") {
            const text = getText(node[tag]);
            if (text && text.trim()) setText(node[tag], ANONYMIZED_EMAIL);
            return;
          }
          if (tag === "Phone" || tag === "Fax") {
            anonymizePhoneOrFax(node[tag]);
            return;
          }
        });
      }
      function truncateLongTextFields(nodes) {
        walk(nodes, (node, tag) => {
          if (tag !== "Comments" && tag !== "Description") return;
          const text = getText(node[tag]);
          if (!text || text.length <= 40) return;
          setText(node[tag], text.slice(0, 40));
        });
      }
      function anonymizeCxml(xmlContent, docType, language) {
        if (!xmlContent || xmlContent.trim() === "") {
          return { anonymized: xmlContent, warnings: [] };
        }
        const warnings = [];
        const parser = makeParser();
        const builder = makeBuilder();
        let parsed;
        try {
          parsed = parser.parse(xmlContent);
        } catch (e) {
          warnings.push(`cXML parse error \u2014 anonymization skipped: ${e.message}`);
          return { anonymized: xmlContent, warnings };
        }
        const cxmlNode = findChild(parsed, "cXML");
        if (!cxmlNode) {
          return { anonymized: xmlContent, warnings };
        }
        const cxmlChildren = cxmlNode["cXML"];
        const headerNode = findChild(cxmlChildren, "Header");
        if (headerNode) {
          anonymizeHeaderBlock(headerNode["Header"], docType);
        }
        anonymizeAllEmails(parsed);
        anonymizeAllDeliverTo(parsed, language, warnings);
        anonymizeSupplierContacts(parsed, language, warnings);
        anonymizePartIds(parsed);
        anonymizeDescriptions(parsed);
        truncateLongTextFields(parsed);
        let result;
        try {
          result = builder.build(parsed);
        } catch (e) {
          warnings.push(`cXML build error \u2014 anonymization skipped: ${e.message}`);
          return { anonymized: xmlContent, warnings };
        }
        if (xmlContent.trimStart().startsWith("<?xml") && !result.trimStart().startsWith("<?xml")) {
          const declMatch = xmlContent.match(/^<\?xml[^?]*\?>/);
          if (declMatch) result = declMatch[0] + "\n" + result;
        }
        return { anonymized: result, warnings };
      }
      module.exports = { anonymizeCxml };
    }
  });
  return require_cxmlAnonymizer();
})();
