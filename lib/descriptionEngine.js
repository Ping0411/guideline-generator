/**
 * descriptionEngine.js
 *
 * Uses local vector similarity (paraphrase-multilingual-MiniLM-L12-v2 via SAP Help MCP)
 * for semantic rule matching. Handles zh/en/ja rule text with zero API cost.
 */

const { getRulesForDocType } = require('./ruleRegistry');
const { matchRules } = require('./vectorMatcher');
const { detectSubtype } = require('./cxmlSubtypeDetector');
const { resolveHints } = require('./hintResolver');

/**
 * Check if the cXML content contains a hint element.
 */
function cxmlContainsHint(cxmlContent, hint) {
  if (!hint || !cxmlContent) return false;
  // For role-based address hints, match the role attribute value directly
  const roleMatch = hint.match(/@role=(.+)$/);
  if (roleMatch) {
    return cxmlContent.includes(`role="${roleMatch[1]}"`);
  }
  // For domain-based hints (e.g. IdReference@domain=deliveryNoteDate), match domain="..." directly
  const domainMatch = hint.match(/@domain=(.+)$/);
  if (domainMatch) {
    return cxmlContent.includes(`domain="${domainMatch[1]}"`);
  }
  const elementName = hint.split('@')[0].split('/').pop().split(' ')[0];
  return cxmlContent.includes(elementName);
}

/**
 * Count how many times a hint matches in the cXML content.
 * Uses the same matching logic as cxmlContainsHint.
 */
function countHintOccurrences(cxmlContent, hint) {
  if (!hint || !cxmlContent) return 0;
  let searchStr;
  const roleMatch = hint.match(/@role=(.+)$/);
  if (roleMatch) {
    searchStr = `role="${roleMatch[1]}"`;
  } else {
    const domainMatch = hint.match(/@domain=(.+)$/);
    if (domainMatch) {
      searchStr = `domain="${domainMatch[1]}"`;
    } else {
      searchStr = hint.split('@')[0].split('/').pop().split(' ')[0];
    }
  }
  let count = 0;
  let pos = 0;
  while ((pos = cxmlContent.indexOf(searchStr, pos)) !== -1) {
    count++;
    pos += searchStr.length;
  }
  return count;
}

// Rules that should repeat description once per occurrence in cXML
const REPEAT_BY_OCCURRENCE_RULES = new Set([
  'INV_REQUIRE_TAX_AT_LINE',
  'INV_REQUIRE_SHIP_ADDRESSES',
]);

/**
 * Generate description text for a triggered rule.
 * Keep descriptions short and supplier-facing: "Mandatory." + brief context.
 * No "Populate ..." technical instructions.
 */
function buildDescription(ruleId, hint, language) {
  const lang = 'en';
  const descriptions = {
    'OC_REQUIRE_DELIVERY_DATE': {
      en: 'Delivery date is required on order confirmation.',
      zh: '订单确认中的交货日期为必填项。',
      ja: 'オーダー確認の納期は必須です。',
    },
    'OC_REQUIRE_SHIP_DATE': {
      en: 'Estimated shipping date is required on order confirmation.',
      zh: '订单确认中的预计发货日期为必填项。',
      ja: 'オーダー確認の出荷予定日は必須です。',
    },
    'OC_REQUIRE_REJECT_REASON_HEADER': {
      en: 'Rejection reason at header level is required when rejecting an order.',
      zh: '拒绝订单时，抬头级拒绝原因为必填项。',
      ja: '注文を拒否する際、ヘッダーレベルの拒否理由は必須です。',
    },
    'OC_REQUIRE_REJECT_REASON_LINE': {
      en: 'Rejection reason at line item level is required when rejecting a line item.',
      zh: '拒绝行项目时，行级别的拒绝原因为必填项。',
      ja: '明細を拒否する際、明細レベルの拒否理由は必須です。',
    },
    'OC_REQUIRE_COMMENT_ON_CHANGE': {
      en: 'Comment at line item level is required when any changes are made.',
      zh: '行项目有变更时，行级别备注为必填项。',
      ja: '変更がある場合、明細レベルのコメントは必須です。',
    },
    'ASN_REQUIRE_SHIP_DATE': {
      en: 'Actual or estimated shipping date is required on ship notice.',
      zh: '发货通知中的实际或预计发货日期为必填项。',
      ja: '出荷通知の実際または出荷予定日は必須です。',
    },
    'ASN_REQUIRE_SHIP_NOTICE_TYPE': {
      en: 'Ship notice type is required on ship notice.',
      zh: '发货通知类型为必填项。',
      ja: '出荷通知タイプは必須です。',
    },
    'ASN_REQUIRE_PACKING_SLIP_UNIQUE': {
      en: 'Packing Slip ID must be unique per ship notice.',
      zh: '每份发货通知的装箱单ID必须唯一。',
      ja: '出荷通知ごとにパッキングスリップIDは一意である必要があります。',
    },

    // ── Invoice ──────────────────────────────────────────────────────────
    'INV_REQUIRE_CREDIT_MEMO_REASON': {
      en: 'Reason (Comments) is required on credit memo.',
      zh: '贷项通知单中的原因（备注）为必填项。',
      ja: 'クレジットメモの理由（コメント）は必須です。',
    },
    'INV_REQUIRE_DELIVERY_NOTE_DATE': {
      en: 'Delivery note date is required for each material line item.',
      zh: '每个物料行项目的送货单日期为必填项。',
      ja: '各物品明細の納品書日付は必須です。',
    },
    'INV_REQUIRE_SERVICE_DATES': {
      en: 'Service period start date and end date are required for each service line item.',
      zh: '每个服务行项目的服务期间开始日期和结束日期为必填项。',
      ja: '各サービス明細のサービス期間開始日・終了日は必須です。',
    },
    'INV_REQUIRE_HEADER_SERVICE_DATES': {
      en: 'Service period start date and end date are required at invoice header level.',
      zh: '发票抬头级服务期间开始日期和结束日期为必填项。',
      ja: '請求書ヘッダーレベルのサービス期間開始日・終了日は必須です。',
    },
    'INV_REQUIRE_DATE_NOT_BEFORE_ORDER': {
      en: 'Invoice date must not be earlier than the PO date.',
      zh: '发票日期不得早于采购订单日期。',
      ja: '請求書日付は発注日より前であってはなりません。',
    },
    'INV_REQUIRE_LINE_DESCRIPTION': {
      en: 'Line item description is required for each invoice line.',
      zh: '每个发票行项目的描述为必填项。',
      ja: '各請求書明細の品目説明は必須です。',
    },
    'INV_REQUIRE_VALID_TAX_LIST': {
      en: "Tax category must be selected from buyer's predefined list.",
      zh: '税种类别必须从买家预定义列表中选择。',
      ja: '税カテゴリはバイヤーの定義済みリストから選択する必要があります。',
    },
    'INV_REQUIRE_SUPPLIER_TAX_ID': {
      en: "Supplier tax ID is required on invoice.",
      zh: '发票中供应商税务ID为必填项。',
      ja: '請求書のサプライヤー税務IDは必須です。',
    },
    'INV_REQUIRE_TAX_AT_LINE': {
      en: 'Tax Element: Tax details are required at line item level.',
      zh: 'Tax Element: 行项目级别的税务详情为必填项。',
      ja: 'Tax Element: 明細レベルの税情報は必須です。',
    },
    'INV_REQUIRE_TAX_INFO': {
      en: 'Tax Element: Tax information is required on invoice.',
      zh: 'Tax Element: 发票中的税务信息为必填项。',
      ja: 'Tax Element: 請求書の税情報は必須です。',
    },
    'INV_REQUIRE_VAT_INFO': {
      en: 'VAT information is required at header or line item level.',
      zh: '抬头级或行项目级的增值税信息为必填项。',
      ja: 'ヘッダーまたは明細レベルのVAT情報は必須です。',
    },
    'INV_REQUIRE_BILL_TO': {
      en: 'Bill To address is required on invoice.',
      zh: '发票中的账单地址为必填项。',
      ja: '請求書の請求先住所は必須です。',
    },
    'INV_REQUIRE_SOLD_TO': {
      en: 'Sold To address is required on invoice.',
      zh: '发票中的销售地址为必填项。',
      ja: '請求書の販売先住所は必須です。',
    },
    'INV_REQUIRE_FROM': {
      en: 'From address is required on invoice.',
      zh: '发票中的发件方地址为必填项。',
      ja: '請求書の差出人住所は必須です。',
    },
    'INV_REQUIRE_REMIT_TO': {
      en: 'Remit To address is required on invoice.',
      zh: '发票中的汇款地址为必填项。',
      ja: '請求書の送金先住所は必須です。',
    },
    'INV_REQUIRE_SHIP_ADDRESSES': {
      'Contact@role=shipFrom': {
        en: 'Ship From address is required on invoice.',
        zh: '发票中的发货方地址为必填项。',
        ja: '請求書の出荷元住所は必須です。',
      },
      'Contact@role=shipTo': {
        en: 'Ship To address is required on invoice.',
        zh: '发票中的收货方地址为必填项。',
        ja: '請求書の出荷先住所は必須です。',
      },
    },
    'INV_REQUIRE_PENALTY_TERMS': {
      en: 'Late payment penalty information is required on invoice.',
      zh: '发票中的逾期付款罚款信息为必填项。',
      ja: '請求書の延滞ペナルティ情報は必須です。',
    },
    'INV_REQUIRE_DISCOUNT_TERMS': {
      en: 'Discount terms are required on invoice.',
      zh: '发票中的折扣条款为必填项。',
      ja: '請求書の割引条件は必須です。',
    },
    'INV_REQUIRE_NET_TERMS': {
      en: 'Net payment terms are required on standard invoice.',
      zh: '标准发票中的净付款条款为必填项。',
      ja: '標準請求書のネット支払条件は必須です。',
    },
    'INV_REQUIRE_BANK_ACCOUNT': {
      en: 'Bank account details are required on invoice.',
      zh: '发票中的银行账户信息为必填项。',
      ja: '請求書の銀行口座情報は必須です。',
    },
    'INV_REQUIRE_CUSTOMER_VAT_ID': {
      en: "Buyer's VAT ID is required on invoice.",
      zh: '发票中买方增值税ID为必填项。',
      ja: '請求書のバイヤーVAT IDは必須です。',
    },
    // mergeGroup BUYER_VAT_ID: single description for rules 299/308/310/311
    '_MERGE_BUYER_VAT_ID': {
      en: "Buyer's VAT ID is required on invoice.",
      zh: '发票中买方增值税ID为必填项。',
      ja: '請求書のバイヤーVAT IDは必須です。',
    },
    'INV_REQUIRE_VAT_DETAILS_DOMESTIC_INTRA_EU': {
      en: 'VAT details are required for domestic and intra-EU trade.',
      zh: '国内及欧盟内部交易需提供增值税详情。',
      ja: '国内取引およびEU域内取引にはVAT詳細が必要です。',
    },
    'INV_REQUIRE_SUPPLIER_VAT_ID': {
      en: "Supplier VAT/Tax ID is required on invoice.",
      zh: '发票中的供应商增值税/税务ID为必填项。',
      ja: '請求書のサプライヤーVAT/税務IDは必須です。',
    },
    'INV_REQUIRE_SUPPLY_DATE_FOR_VAT': {
      en: 'Supply date (taxPointDate) is required when tax category is VAT.',
      zh: '税种类别为增值税时，供应日期（taxPointDate）为必填项。',
      ja: '税カテゴリがVATの場合、供給日（taxPointDate）は必須です。',
    },
    'INV_REQUIRE_TAX_IN_LOCAL_CURRENCY': {
      en: 'Tax amount in local currency is required on invoice.',
      zh: '发票中以本地货币表示的税额为必填项。',
      ja: '請求書の現地通貨建て税額は必須です。',
    },
    'INV_REQUIRE_TOTALS_IN_LOCAL_CURRENCY': {
      en: 'Subtotal and amount due in local currency are required on invoice.',
      zh: '发票中以本地货币表示的小计和应付金额为必填项。',
      ja: '請求書の現地通貨建て小計・請求金額は必須です。',
    },
    'INV_REQUIRE_ZERO_VAT_EXPLANATION': {
      en: 'exemptDetail is required on TaxDetail when VAT rate is zero.',
      zh: 'VAT税率为零时，TaxDetail上的exemptDetail为必填项。',
      ja: 'VAT税率がゼロの場合、TaxDetailのexemptDetailは必須です。',
    },
    'INV_REQUIRE_ZERO_GST_EXPLANATION': {
      en: 'exemptDetail is required on TaxDetail when GST rate is zero.',
      zh: 'GST税率为零时，TaxDetail上的exemptDetail为必填项。',
      ja: 'GST税率がゼロの場合、TaxDetailのexemptDetailは必須です。',
    },
    'INV_REQUIRE_DETAILED_TAX_SUMMARY': {
      en: 'Detailed tax breakdown is required in invoice tax summary.',
      zh: '发票税务汇总中的详细税务明细为必填项。',
      ja: '請求書税サマリーの詳細な税情報は必須です。',
    },
    'INV_PAYMENT_TERMS_MUST_MATCH_PO': {
      en: 'Payment terms must be included on invoice and must match the PO.',
      zh: '付款条款必须包含在发票中且须与采购订单保持一致。',
      ja: '支払条件は請求書に含め、発注書と一致させる必要があります。',
    },
  };

  // INV_REQUIRE_SHIP_ADDRESSES: different text per hint
  if (ruleId === 'INV_REQUIRE_SHIP_ADDRESSES') {
    const map = descriptions['INV_REQUIRE_SHIP_ADDRESSES'];
    return (map && map[hint] && map[hint][lang]) || '';
  }

  return (descriptions[ruleId] && descriptions[ruleId][lang]) || '';
}

/**
 * Main function: evaluate all rules for a given docType using vector similarity matching.
 */
async function evaluateRules(docType, parsedRules, cxmlContent, answers) {
  const rules = getRulesForDocType(docType);
  const language = answers.q1 || 'en';

  const descriptionTriggers = [];
  const unmatchedTriggers = [];
  const projectReqTriggers = [];

  const matchedMap = await matchRules(parsedRules, rules, docType);

  // First pass: collect all triggered description rules (before hint resolution)
  const triggeredDescRules = [];
  for (const ruleDef of rules) {
    const ruleEntry = matchedMap.get(ruleDef.id);
    if (!ruleEntry) continue;

    const shouldTrigger = ruleDef.triggerOnBoth ? true
      : ruleDef.triggerOnNo ? !ruleEntry.isYes
      : ruleEntry.isYes;
    if (!shouldTrigger) continue;

    if (ruleDef.effect === 'projectReq') {
      // OC_CONFIRM_BEFORE_ASN only applies when ASN is in scope (Q2 or Q3)
      if (ruleDef.id === 'OC_CONFIRM_BEFORE_ASN') {
        const asnInScope = (answers.q2 || []).includes('ASN') || (answers.q3 || []).includes('ASN');
        if (!asnInScope) continue;
      }
      // INV_ALLOW_CUSTOM_TAX (247 YES alone): only write PR if 245/246 is NOT triggered
      if (ruleDef.id === 'INV_ALLOW_CUSTOM_TAX') {
        const validTaxEntry = matchedMap.get('INV_REQUIRE_VALID_TAX_LIST');
        if (validTaxEntry && validTaxEntry.isYes) continue; // 245/246 YES takes over
      }
      // INV date rules handled separately in buildInvoiceDateProjectReqs
      if (['INV_DATE_NOT_BEFORE_ORDER', 'INV_ALLOW_BACKDATING', 'INV_ALLOW_FUTUREDATING'].includes(ruleDef.id)) continue;
      const isNo = !ruleEntry.isYes;
      projectReqTriggers.push({
        ruleId: ruleDef.id,
        ruleText: (isNo && ruleDef.projectReqTextNo) ? ruleDef.projectReqTextNo
          : (ruleDef.projectReqText || ruleEntry.rule),
        zh: (isNo && ruleDef.zhNo) ? ruleDef.zhNo : (ruleDef.zh || null),
        ja: (isNo && ruleDef.jaNo) ? ruleDef.jaNo : (ruleDef.ja || null),
      });
      continue;
    }

    // INV_REQUIRE_VALID_TAX_LIST (effect: 'both'): handle description + PR together
    if (ruleDef.id === 'INV_REQUIRE_VALID_TAX_LIST') {
      const taxValues = extractTaxValues(parsedRules, ruleEntry.rule);
      const taxStr = taxValues.length > 0
        ? ` Allowed tax values (Rate(%)/Category/Description) are ${taxValues.join('; ')}.`
        : '';
      const baseText = 'Require suppliers to choose valid tax values defined by buyer.';
      // B column: base sentence only
      if (cxmlContainsHint(cxmlContent, ruleDef.cxmlHint)) {
        descriptionTriggers.push({
          ruleId: ruleDef.id,
          ruleText: ruleEntry.rule,
          cxmlElement: ruleDef.cxmlHint,
          description: baseText,
        });
      }
      // Project Requirements: full sentence with tax values
      projectReqTriggers.push({
        ruleId: ruleDef.id,
        ruleText: baseText + taxStr,
      });
      continue;
    }

    triggeredDescRules.push({ ruleDef, ruleEntry });
  }

  // Resolve cXML hints dynamically via SAP Help MCP (one call for all triggered rules)
  let resolvedHints = new Map();
  if (triggeredDescRules.length > 0) {
    const subTypeInfo = detectSubtype(docType, cxmlContent);
    const rulesForHint = triggeredDescRules.map(({ ruleDef, ruleEntry }) => ({
      ruleId: ruleDef.id,
      ruleText: ruleEntry.rule,
    }));
    resolvedHints = await resolveHints(subTypeInfo, rulesForHint, cxmlContent, language);
  }

  // Second pass: build description triggers using resolved hints
  const firedMergeGroups = new Set();
  for (const { ruleDef, ruleEntry } of triggeredDescRules) {
    // Problem 2: credit memo reason — only apply to credit memo samples
    if (ruleDef.id === 'INV_REQUIRE_CREDIT_MEMO_REASON') {
      const isCreditMemo = cxmlContent.includes('purpose="creditMemo"') ||
                           cxmlContent.includes('purpose="lineLevelCreditMemo"');
      if (!isCreditMemo) continue;
    }

    // mergeGroup: emit only one description for all rules in the same group
    if (ruleDef.mergeGroup) {
      if (firedMergeGroups.has(ruleDef.mergeGroup)) continue;
      firedMergeGroups.add(ruleDef.mergeGroup);
      const hint = Array.isArray(ruleDef.cxmlHint) ? ruleDef.cxmlHint[0] : ruleDef.cxmlHint;
      if (hint && cxmlContainsHint(cxmlContent, hint)) {
        const description = buildDescription('_MERGE_' + ruleDef.mergeGroup, hint, language);
        if (description) {
          descriptionTriggers.push({
            ruleId: ruleDef.id,
            ruleText: ruleEntry.rule,
            cxmlElement: hint,
            description,
          });
        }
      }
      continue;
    }

    // Prefer static cxmlHint (verified against docs); use dynamic hint only if static is absent
    const hintRaw = ruleDef.cxmlHint || resolvedHints.get(ruleDef.id);
    if (!hintRaw) continue;

    // cxmlHint may be a string or an array (for rules that map to multiple element paths)
    const hints = Array.isArray(hintRaw) ? hintRaw : [hintRaw];

    let anyMatched = false;
    for (const hint of hints) {
      if (!cxmlContainsHint(cxmlContent, hint)) continue;

      const description = buildDescription(ruleDef.id, hint, language);
      if (!description) continue;

      const repeatCount = REPEAT_BY_OCCURRENCE_RULES.has(ruleDef.id)
        ? countHintOccurrences(cxmlContent, hint)
        : 1;

      for (let i = 0; i < repeatCount; i++) {
        descriptionTriggers.push({
          ruleId: ruleDef.id,
          ruleText: ruleEntry.rule,
          cxmlElement: hint,
          description,
        });
      }
      anyMatched = true;
    }

    // Rule fired but no hint path matched the cXML — surface for manual review
    if (!anyMatched) {
      unmatchedTriggers.push({
        ruleId: ruleDef.id,
        ruleText: ruleEntry.rule,
      });
    }
  }

  // PO-specific descriptions from question answers
  if (docType === 'PO' || docType === 'PO_CHANGE') {
    const poDescs = buildPoDescriptions(answers, parsedRules, cxmlContent, language);
    descriptionTriggers.push(...poDescs);
  }

  // Invoice-specific: INV_ALLOW_CANCEL (triggerOnBoth → handle YES/NO manually)
  // INV_DATE rules: merge rules 4/5/6 into one PR line
  if (docType === 'Invoice') {
    buildInvoiceDateProjectReqs(matchedMap, projectReqTriggers);
  }

  // OC-specific descriptions from question answers
  if (docType === 'OC') {
    const ocDescs = buildOcDescriptions(answers, parsedRules, cxmlContent, language);
    descriptionTriggers.push(...ocDescs);

    // OC reject descriptions (conditional, may produce mergeGroup triggers)
    const ocRejectDescs = buildOcRejectDescriptions(answers, parsedRules, cxmlContent, language);
    descriptionTriggers.push(...ocRejectDescs);

    // OC reject Project Requirements (rule 1: Partially / Fully)
    for (const [, entry] of parsedRules) {
      if (entry.matchedId !== 'OC_ALLOW_PARTIAL_REJECT') continue;
      const val = (entry.value || '').trim().toLowerCase();
      if (val === 'partially' || val === 'partial') {
        projectReqTriggers.push({
          ruleId: 'OC_ALLOW_PARTIAL_REJECT_PR',
          ruleText: 'Allow suppliers to partially reject material orders at the line-item level',
          zh: '允许供应商在订单确认中对物料订单行项目进行部分拒绝。',
          ja: 'サプライヤはオーダー確認で物品注文明細の数量を部分的に拒否できます。',
        });
      } else if (val === 'fully' || val === 'full') {
        projectReqTriggers.push({
          ruleId: 'OC_ALLOW_FULL_REJECT_PR',
          ruleText: 'Allow suppliers to fully reject material orders at the line-item level',
          zh: '允许供应商在订单确认中对物料订单行项目进行完全拒绝。',
          ja: 'サプライヤはオーダー確認で物品注文明細の数量を完全に拒否できます。',
        });
      }
      break;
    }
  }

  return { descriptionTriggers, unmatchedTriggers, projectReqTriggers };
}

/**
 * Build OC-specific description triggers based on Enhanced OC answer and parsed rules.
 * Returns description triggers (for B column) AND extra projectReqTriggers for reject rules.
 */
function buildOcDescriptions(answers, parsedRules, cxmlContent, language) {
  const triggers = [];
  const lang = 'en';

  // ── Enhanced OC: Yes → type must be "allDetail" ───────────────────────────
  if (answers.q9 === 'Yes') {
    if (cxmlContainsHint(cxmlContent, 'ConfirmationHeader')) {
      const headerDesc = {
        en: 'Only "allDetail" is allowed as header confirmation type.',
        zh: '抬头确认类型只允许使用 "allDetail"。',
        ja: 'ヘッダー確認タイプは "allDetail" のみ使用可能です。',
      };
      triggers.push({
        ruleId: 'OC_ENHANCED_HEADER_TYPE',
        cxmlElement: 'ConfirmationHeader',
        description: headerDesc[lang],
      });
    }

    if (cxmlContainsHint(cxmlContent, 'ItemIn')) {
      const itemInDesc = {
        en: 'ItemIn is required when header confirmation type is "allDetail".',
        zh: '当抬头确认类型为 "allDetail" 时，ItemIn 为必填项。',
        ja: 'ヘッダー確認タイプが "allDetail" の場合、ItemIn は必須です。',
      };
      triggers.push({
        ruleId: 'OC_ENHANCED_ITEMIN',
        cxmlElement: 'ItemIn',
        description: itemInDesc[lang],
      });
    }
  }

  // ── Enhanced OC: No → type allowed values depend on reject rule ───────────
  if (answers.q9 === 'No') {
    if (cxmlContainsHint(cxmlContent, 'ConfirmationHeader')) {
      const rejectEntireAllowed = isRuleMatchedAndNo(parsedRules, 'OC_NO_REJECT_ENTIRE_PO');

      const allowedValues = rejectEntireAllowed
        ? '"detail" / "accept" / "backordered" / "reject"'
        : '"detail" / "accept" / "backordered"';

      const headerDesc = {
        en: `Allowed values for type: ${allowedValues}.`,
        zh: `type 的可用值为：${allowedValues}。`,
        ja: `type の使用可能な値：${allowedValues}。`,
      };
      triggers.push({
        ruleId: 'OC_STANDARD_HEADER_TYPE',
        cxmlElement: 'ConfirmationHeader',
        description: headerDesc[lang],
      });
    }
  }

  return triggers;
}

/**
 * Check if a rule (by registry id) was matched AND its value is No/いいえ/否.
 */
function isRuleMatchedAndNo(parsedRules, ruleId) {
  for (const [, entry] of parsedRules) {
    if (entry.matchedId === ruleId) return !entry.isYes;
  }
  return false;
}

/**
 * Build OC reject-related description triggers.
 * These require special handling: conditional on cXML content (type attribute + Extrinsic presence),
 * and may produce merged-cell groups.
 *
 * Returns: Array of { ruleId, mergeGroup: [{cxmlElement, hint}], description }
 *   mergeGroup contains the hints that should be merged vertically in B column.
 */
function buildOcRejectDescriptions(answers, parsedRules, cxmlContent, language) {
  const triggers = [];
  const lang = 'en';

  const hasRRCExtrinsic = cxmlContent.includes('name="RejectionReasonComments"');
  const hasRRExtrinsic  = cxmlContent.includes('name="RejectionReason"');
  const hasRejectExtrinsic = hasRRCExtrinsic || hasRRExtrinsic;

  // ── Rule 3: Require suppliers to provide a reason when they reject an order ──
  if (isRuleMatchedAndYes(parsedRules, 'OC_REQUIRE_REJECT_REASON_HEADER')) {
    const headerTypeReject  = cxmlContent.includes('type="reject"') &&
                              cxmlContent.includes('ConfirmationHeader');
    const headerTypeAllDetail = cxmlContent.includes('type="allDetail"');
    const headerComments    = cxmlContent.includes('ConfirmationHeader') &&
                              cxmlContent.includes('<Comments');

    const desc = {
      en: 'Rejection reason is required when rejecting an order.',
      zh: '拒绝订单时，拒绝原因为必填项。',
      ja: '注文を拒否する際、拒否理由は必須です。',
    };

    // Case D-a: type="reject" + Comments + at least one Extrinsic
    if (headerTypeReject && headerComments && hasRejectExtrinsic) {
      const mergeHints = [];
      if (headerComments) mergeHints.push('ConfirmationHeader/Comments');
      if (hasRRCExtrinsic) mergeHints.push('ConfirmationHeader/Extrinsic@name=RejectionReasonComments');
      if (hasRRExtrinsic)  mergeHints.push('ConfirmationHeader/Extrinsic@name=RejectionReason');
      triggers.push({
        ruleId: 'OC_REQUIRE_REJECT_REASON_HEADER',
        mergeGroup: mergeHints,
        description: desc[lang],
      });
    }
    // Case D-b: type="allDetail" + at least one Extrinsic (Comments optional)
    else if (headerTypeAllDetail && hasRejectExtrinsic) {
      const mergeHints = [];
      if (headerComments) mergeHints.push('ConfirmationHeader/Comments');
      if (hasRRCExtrinsic) mergeHints.push('ConfirmationHeader/Extrinsic@name=RejectionReasonComments');
      if (hasRRExtrinsic)  mergeHints.push('ConfirmationHeader/Extrinsic@name=RejectionReason');
      triggers.push({
        ruleId: 'OC_REQUIRE_REJECT_REASON_HEADER',
        mergeGroup: mergeHints,
        description: desc[lang],
      });
    }
  }

  // ── Rule 4: Require suppliers to provide a reason when they reject at line-item level ──
  if (isRuleMatchedAndYes(parsedRules, 'OC_REQUIRE_REJECT_REASON_LINE')) {
    // ConfirmationStatus type="reject" + at least one Extrinsic
    const lineTypeReject = cxmlContent.includes('ConfirmationStatus') &&
                           cxmlContent.includes('type="reject"');
    const lineComments   = cxmlContent.includes('ConfirmationStatus') &&
                           cxmlContent.includes('<Comments');

    if (lineTypeReject && hasRejectExtrinsic) {
      const mergeHints = [];
      if (lineComments)    mergeHints.push('ConfirmationItem/ConfirmationStatus/Comments');
      if (hasRRCExtrinsic) mergeHints.push('ConfirmationStatus/Extrinsic@name=RejectionReasonComments');
      if (hasRRExtrinsic)  mergeHints.push('ConfirmationStatus/Extrinsic@name=RejectionReason');

      const desc = {
        en: 'Rejection reason is required when rejecting a line item.',
        zh: '拒绝行项目时，拒绝原因为必填项。',
        ja: '明細を拒否する際、拒否理由は必須です。',
      };
      triggers.push({
        ruleId: 'OC_REQUIRE_REJECT_REASON_LINE',
        mergeGroup: mergeHints,
        description: desc['en'],
      });
    }
  }

  return triggers;
}

/**
 * Check if a rule (by registry id) was matched AND its value is Yes/はい/是.
 */
function isRuleMatchedAndYes(parsedRules, ruleId) {
  for (const [, entry] of parsedRules) {
    if (entry.matchedId === ruleId) return entry.isYes === true;
  }
  return false;
}


/**
 * Build PO-specific description triggers based on Q5/Q6/Q7/Q8 answers.
 *
 * Returns: Array of { ruleId, cxmlElement, description }
 */
function buildPoDescriptions(answers, parsedRules, cxmlContent, language) {
  const triggers = [];
  const lang = 'en';

  // ── Q5: ShipTo level ──────────────────────────────────────────────────────
  const q5 = answers.q5;
  if (q5 && cxmlContainsHint(cxmlContent, 'ShipTo')) {
    const isHeader = q5 === 'Header' || q5 === 'Header Level';
    const isLine   = q5 === 'Line Level';
    const shipToDesc = {
      en: isHeader ? 'ShipTo is sent on header level.'
        : isLine   ? 'ShipTo is sent on line level.'
        : 'ShipTo could be sent on header or line level.',
      zh: isHeader ? 'ShipTo 在抬头级发送。'
        : isLine   ? 'ShipTo 在行项目级别发送。'
        : 'ShipTo 可以在抬头级或行项目级别发送。',
      ja: isHeader ? 'ShipTo はヘッダーレベルで送信されます。'
        : isLine   ? 'ShipTo は明細レベルで送信されます。'
        : 'ShipTo はヘッダーまたは明細レベルで送信される場合があります。',
    };
    triggers.push({
      ruleId: 'PO_SHIPTO_LEVEL',
      cxmlElement: 'ShipTo',
      description: shipToDesc[lang],
    });
  }

  // ── Q6: Payment terms ─────────────────────────────────────────────────────
  const q6 = answers.q6;
  if ((q6 === 'Yes' || q6 === 'Optional') && cxmlContainsHint(cxmlContent, 'PaymentTerm')) {
    // Check if Invoice rule "Allow suppliers to omit payment terms" is set to No
    // INV_PAYMENT_TERMS_MUST_MATCH_PO has triggerOnNo:true, so if it's in parsedRules as No → add extra sentence
    const invoiceInScope = (answers.q2 || []).includes('Invoice') || (answers.q3 || []).includes('Invoice');
    const paymentTermsRuleIsNo = invoiceInScope && checkRuleIsNo(parsedRules, 'Allow suppliers to omit payment terms in PO invoices');

    const baseText = {
      en: 'Payment terms are required on all POs.',
      zh: '所有采购订单均需提供付款条款。',
      ja: 'すべての発注書に支払条件が必要です。',
    };
    const extraText = {
      en: ' Need to be returned on invoice.',
      zh: '需在发票中回传。',
      ja: '請求書に返送する必要があります。',
    };

    const desc = paymentTermsRuleIsNo
      ? baseText[lang] + extraText[lang]
      : baseText[lang];

    triggers.push({
      ruleId: 'PO_PAYMENT_TERMS',
      cxmlElement: 'PaymentTerm',
      description: desc,
    });
  }

  // ── Q7: Tax info ──────────────────────────────────────────────────────────
  const q7 = answers.q7;
  if ((q7 === 'Yes' || q7 === 'Optional') && cxmlContainsHint(cxmlContent, 'Tax')) {
    const taxDesc = {
      en: 'Tax is mandatory for all POs.',
      zh: '所有采购订单均需提供税务信息。',
      ja: 'すべての発注書に税情報が必須です。',
    };
    triggers.push({
      ruleId: 'PO_TAX_INFO',
      cxmlElement: 'Tax',
      description: taxDesc[lang],
    });
  }

  return triggers;
}

/**
 * Check if a specific rule is set to No in parsedRules (synchronous best-effort check).
 * Uses simple string inclusion match on the canonical English text.
 * Returns true if found and isYes === false.
 */
function checkRuleIsNo(parsedRules, canonicalText) {
  const lower = canonicalText.toLowerCase();
  for (const [, entry] of parsedRules) {
    if (!entry.rule) continue;
    if (entry.rule.toLowerCase().includes('omit payment terms') ||
        entry.rule.toLowerCase().includes('payment terms') && entry.rule.toLowerCase().includes('omit')) {
      return !entry.isYes;
    }
  }
  return false;
}

/**
 * Build Invoice Date merged PR line from rules 4/5/6,
 * and handle INV_ALLOW_CANCEL YES/NO PR output.
 */
function buildInvoiceDateProjectReqs(matchedMap, projectReqTriggers) {
  // Rule 1: INV_ALLOW_CANCEL — handled via triggerOnBoth in main loop already
  // (projectReqText / projectReqTextNo picked up by standard logic)

  // Rules 4/5/6: merge into one "Invoice Date: ..." line
  const parts = [];

  const rule4 = matchedMap.get('INV_DATE_NOT_BEFORE_ORDER');
  if (rule4 && rule4.isYes) {
    parts.push('Invoice date must not be before the order date.');
  }

  const rule5 = matchedMap.get('INV_ALLOW_BACKDATING');
  if (rule5) {
    const val = (rule5.value || '').trim();
    const num = parseDaysValue(val);
    if (num === 0 || val === '' || rule5.isNo) {
      parts.push('Back-dating is not allowed.');
    } else if (num > 0) {
      parts.push(`Back-dating is allowed up to ${num} days.`);
    }
  }

  const rule6 = matchedMap.get('INV_ALLOW_FUTUREDATING');
  if (rule6) {
    const val = (rule6.value || '').trim();
    const num = parseDaysValue(val);
    if (num === 0 || rule6.isNo) {
      parts.push('Future-dating is not allowed.');
    } else if (num > 0) {
      parts.push(`Future-dating is allowed up to ${num} days.`);
    }
  }

  if (parts.length > 0) {
    projectReqTriggers.push({
      ruleId: 'INV_DATE_COMBINED',
      ruleText: 'Invoice Date: ' + parts.join(' '),
    });
  }
}

/**
 * Parse a days value from strings like "30", "30 Days", "30days", "0".
 * Returns the number, or -1 if unparseable.
 */
function parseDaysValue(val) {
  if (!val) return 0;
  const match = val.match(/^(\d+)/);
  if (!match) return -1;
  return parseInt(match[1], 10);
}

module.exports = { evaluateRules };

/**
 * Extract and format tax values from parsedRules for INV_REQUIRE_VALID_TAX_LIST.
 * Each sub-row in the Excel has the format: "5% VAT / 5% 増値税"
 * Parsed to: "5/VAT/5% 増値税"
 *
 * Collects all entries whose rule text matches the main rule and have a non-empty subrule1.
 */
function extractTaxValues(parsedRules, mainRuleText) {
  const mainLower = (mainRuleText || '').toLowerCase();
  const results = [];

  for (const [, entry] of parsedRules) {
    if (!entry.subrule1) continue;
    const entryLower = (entry.rule || '').toLowerCase();
    // Match entries whose rule text contains the key phrase
    if (!entryLower.includes('choose') && !entryLower.includes('valid tax') &&
        !entryLower.includes('有効な税') && !entryLower.includes('税値') &&
        !entryLower.includes('有效税')) continue;

    const raw = entry.subrule1.trim();
    // Parse "5% VAT / 5% 増値税" → rate=5, category=VAT, description=5% 増値税
    const match = raw.match(/^([\d.]+)%\s*(.+?)\s*\/\s*(.+)$/);
    if (match) {
      const rate = match[1];
      const category = match[2].trim();
      const description = match[3].trim();
      results.push(`${rate}/${category}/${description}`);
    } else {
      // Fallback: use raw value as-is
      results.push(raw);
    }
  }

  return results;
}
