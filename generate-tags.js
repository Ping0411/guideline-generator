/**
 * generate-tags.js
 * Reads cache.json, groups entries by source document, extracts keywords as tags,
 * and writes tags.json for use by the search function.
 *
 * Run: node generate-tags.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TAGGING STRATEGY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Tags serve one purpose: to locate the right document and exclude irrelevant
 * ones. A tag that appears in every document is worthless — it adds noise
 * without improving precision. The ultimate goal is to help the search function
 * find the document containing the answer as fast and accurately as possible.
 *
 * ## What makes a GOOD tag
 *
 * 1. Reflects actual document content
 *    Tags must come from reading the document, not guessing from its filename
 *    or category. Looking at the tag list alone should give a reasonable outline
 *    of what the document covers.
 *
 * 2. Proportional to document length
 *    A 10-page troubleshooting guide warrants ~10 tags; a 200-page reference
 *    guide warrants more. Do not assign the same tag count to every document —
 *    over-tagging short docs and under-tagging long docs are equally harmful.
 *
 * 3. Discriminating across the document set
 *    Ask: "Does this tag help distinguish THIS document from others?"
 *    - GOOD: "technical id structure", "stop id", "fc suffix", "timezone utc"
 *      → only a few documents cover these specific topics
 *    - BAD: "carrier", "api", "integration", "bnl"
 *      → true for nearly every BNL document; provides no discrimination
 *
 * ## What makes a BAD tag (avoid these)
 *
 * 1. Overly broad single words
 *    "carrier", "api", "integration", "error", "logistics" describe the entire
 *    document domain, not a specific document. Only include them if the document
 *    is specifically and primarily about that topic.
 *
 * 2. Short abbreviations matched via full-text (po, oc, gr, co)
 *    Two-letter strings appear in virtually any English text. Never add them
 *    through DOMAIN_TERMS full-text matching. Assign them explicitly in
 *    FILENAME_TAGS only when the document genuinely covers that document type.
 *
 * 3. Wildcard FILENAME_TAGS patterns
 *    A pattern like /freight|lbn|bnl/i matches every BNL document and assigns
 *    the same tags to all of them — erasing all distinction between docs.
 *    Each FILENAME_TAGS entry should match ONE document (or a tightly related
 *    group with genuinely shared content), never a broad category.
 *
 * 4. Tags not present in the document
 *    If a term does not appear in the document content, do not assign it.
 *    Cross-category contamination (e.g. SBN invoice tags leaking into a BNL
 *    troubleshooting guide) is a direct result of overly broad matching rules.
 *
 * ## Workflow for adding tags to a new document
 *
 * 1. Read the document (or its cached content)
 * 2. Identify the main topics and chapters
 * 3. Pick 1-3 tags per major topic — prefer specific phrases over single words
 * 4. Add a FILENAME_TAGS entry with a pattern that matches only this document
 * 5. Do NOT rely on DOMAIN_TERMS full-text matching as a substitute for
 *    reading and understanding the document content
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, "cache.json");
const TAGS_FILE = join(__dirname, "tags.json");

// DOMAIN_TERMS: only terms that are specific enough to be meaningful as tags.
// Rules:
// - No single words that appear in almost every doc (sap, api, integration, carrier, shipper, logistics)
// - No 2-letter abbreviations matched via full-text (po, oc, gr, co) — assign these only via FILENAME_TAGS
// - Only include terms that have real discriminating power across the document set
const DOMAIN_TERMS = [
  // Specific SAP products & platforms (discriminating — not every doc mentions these)
  // Note: "btp" is intentionally excluded from full-text matching — assigned via FILENAME_TAGS only
  // to avoid false positives from filenames containing "NON BTP"
  "ariba", "cig", "s4hana", "ecc", "scc",
  ["fc", "freight collaboration"],
  ["gtt", "global track and trace"],

  // Integration specifics — only terms specific enough to locate a doc
  ["idoc", null],
  "getpending", "datadownload", "soamanager", "peppol",
  "trading partner", "cloud connector",

  // Test Central — specific product, high discriminating value
  "test central", "test scenario", "test account", "regression testing",

  // Document types — full phrases only (not 2-letter abbrevs)
  "purchase order", "advance ship notice", "order confirmation", "goods receipt",
  "change order", "ship notice", "service sheet", "non-po invoice",
  "summary invoice", "credit memo",

  // Invoice specifics
  "invoice rules", "transaction rules", "customer relationship",
  "digital signature", "archiving", "peppol",

  // Logistics specifics — only phrases, not single words
  "freight booking", "freight order", "freight tendering",
  "dock appointment", "proof of delivery",
  "supply chain collaboration",

  // cXML — specific enough
  "cxml", "punchout",

  // Validation specifics
  "overdelivery", "underdelivery", "tolerance",
];

// Stopwords — never include these as tags even if they appear as acronyms
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "not", "no", "nor",
  "is", "it", "its", "be", "as", "at", "by", "for", "in", "of",
  "on", "to", "up", "do", "go", "so", "if", "us", "we", "he",
  "she", "my", "me", "all", "any", "can", "may", "new", "old",
  "id", "tc", "sn", "pa", "bn", "ca", "ea", "ia", "ig", "is",
  "ny", "eu", "on", "pay", "sys", "tem", "pli", "pr", "very",
  "true", "false", "save", "copy", "keep", "type", "first", "last",
  "lane", "load", "loadid", "fromid", "region", "utf", "usd",
  "ds", "si", "brp", "bssi", "tps", "cpr", "inv", "faq",
  "xslt", "pdf", "xml", "but", "with", "from", "this", "that",
  "yes", "not", "has", "have", "will", "were", "was", "are",
  "add", "use", "set", "get", "run", "see", "let", "put",
]);

// SAP acronym whitelist — only these uppercase sequences are auto-extracted
const ACRONYM_WHITELIST = new Set([
  "PO", "ASN", "EDI", "CIG", "SBN", "BNL", "BTP",
  "ERP", "ECC", "VAT", "OC", "GR", "TC",
  "FC", "GTT",
  "SOAMANAGER", "JIRA", "IATA",
]);

// File name → forced top-level tags
const FILENAME_TAGS = [
  // ── cXML technical guides ─────────────────────────────────────────────────
  {
    pattern: /cXMLReferenceGuide/i,
    tags: [
      "cxml", "punchout", "purchase order", "po", "order confirmation", "oc",
      "advance ship notice", "asn", "invoice", "ship notice", "service sheet",
      "credit memo", "change order", "catalog", "path routing",
      "rfq", "payment", "payment remittance", "timecard", "master agreement",
      "contract", "status update", "receipt request", "getpending", "datadownload",
      "provider punchout", "supply chain collaboration", "quality inspection",
      "sales order", "logistics", "transport request", "mac authentication",
      "digital signature", "data synchronization", "header", "credential",
    ],
  },
  {
    pattern: /cxmlSolutions.Guide/i,
    tags: [
      "cxml", "integration", "sbn", "purchase order", "po", "invoice", "punchout",
      "order confirmation", "oc", "advance ship notice", "asn", "credit memo",
      "change order", "ship notice", "service sheet", "non-po invoice",
      "catalog", "getpending", "datadownload", "supply chain collaboration",
      "tax", "digital signature", "archiving", "scheduled payment", "contract",
      "credential", "authentication", "url", "routing", "supplier",
    ],
    excludeTags: ["erp", "tolerance", "test account", "iata", "proof of delivery", "gtt", "fc"],
  },
  {
    pattern: /cXMLGettingStarted/i,
    tags: [
      "cxml", "punchout", "purchase order", "catalog", "authentication",
      "mac authentication", "digital signature", "credential", "header",
      "request", "response", "dtd", "protocol", "integration",
    ],
  },

  // ── Buyer Admin guides ─────────────────────────────────────────────────────
  {
    // Classic buyer admin guide (non-BTP)
    pattern: /BuyerAdminGuide including Rules/i,
    tags: [
      "buyer", "buyer admin", "sbn", "transaction rules", "invoice rules",
      "po rules", "blanket po rules", "service sheet rules",
      "order confirmation rules", "ship notice rules", "non-po invoice",
      "summary invoice", "credit memo", "tax", "vat", "supplier management",
      "supplier group", "eft payment", "ach payment", "payment",
      "notifications", "audit log", "reports", "user management",
      "catalog", "fieldglass", "routing", "purchase order", "invoice",
    ],
    excludeTags: ["erp", "btp", "goods receipt", "gr", "iata", "proof of delivery", "gtt", "fc"],
  },
  {
    // BTP buyer admin guide
    pattern: /BuyerAdminGuide for BTP Users/i,
    tags: [
      "buyer", "buyer admin", "btp", "sbn", "transaction rules", "invoice rules",
      "purchase order", "invoice", "notifications", "user management",
      "routing", "company profile", "anid", "order routing",
    ],
    excludeTags: ["erp", "goods receipt", "gr", "iata", "proof of delivery", "gtt", "fc"],
  },

  // ── Invoicing guides ───────────────────────────────────────────────────────
  {
    pattern: /Invoice part1/i,
    tags: [
      "invoice", "invoicing", "sbn", "invoice rules", "invoice validation",
      "credit memo", "debit memo", "po flip", "non-po invoice", "summary invoice",
      "tax invoice", "external tax", "esignature", "digital signature",
      "invoice archiving", "peppol", "test account", "vat",
    ],
    excludeTags: ["punchout", "erp", "order confirmation", "oc", "ship notice", "asn", "advance ship notice", "iata", "proof of delivery", "gtt", "fc"],
  },
  {
    pattern: /Inovice part2/i,
    tags: [
      "invoice", "digital signature", "esignature", "pki", "certificate",
      "vat", "tax invoice", "invoice archiving", "trustweaver", "sbn", "cxml",
      "tax", "archiving",
    ],
    excludeTags: ["fc", "trading partner", "edi", "iata", "proof of delivery", "gtt", "erp"],
  },
  {
    pattern: /Invoice.error.messages/i,
    tags: [
      "invoice", "error", "validation", "sbn", "cxml", "troubleshooting",
      "invoice rules", "purchase order", "po", "credit memo", "asn",
      "non-po invoice", "payment",
    ],
    excludeTags: ["edi", "iata", "proof of delivery", "gtt", "fc", "erp", "trading partner"],
  },

  // ── CIG guides ─────────────────────────────────────────────────────────────
  {
    pattern: /aribaintegrationportal.CIG.for.Supplier/i,
    tags: [
      "cig", "managed gateway", "supplier", "edi", "routing", "data mapping",
      "certificate", "ssl", "troubleshooting", "asn", "b2b", "integration",
      "sbn", "test tools", "project setup", "transaction tracker",
      "document validator",
    ],
  },
  {
    pattern: /CIGConfigSup/i,
    tags: [
      "cig", "managed gateway", "supplier", "erp", "s4hana", "installation",
      "cloud connector", "spro", "addon", "sbn", "authentication",
      "transport layer security", "tls",
    ],
  },
  {
    pattern: /CIGOverviewSup/i,
    tags: [
      "cig", "managed gateway", "supplier", "erp", "s4hana",
      "sales order", "order confirmation", "oc", "asn", "advance ship notice",
      "invoice", "forward error handling", "sbn", "purchase order", "po",
    ],
  },
  {
    // CIG and SBN Overview 1 — buyer-side
    pattern: /CIG and SBN Overview 1/i,
    tags: [
      "cig", "managed gateway", "buyer", "erp", "s4hana", "sbn",
      "test central", "tc", "transaction tracker", "document validator",
      "supplier reporting", "integration", "authentication", "certificate",
      "tls", "purchase requisition", "purchase order", "po",
    ],
  },
  {
    // CIG and SBN Overview 2 — buyer-side transactions detail
    pattern: /CIG and SBN Overview 2/i,
    tags: [
      "cig", "managed gateway", "buyer", "erp", "s4hana", "sbn",
      "purchase order", "po", "purchase requisition", "invoice",
      "scheduling agreement", "payment", "payment remittance",
      "service sheet", "asn", "ship notice", "order confirmation",
      "stock transport order", "spro", "integration",
    ],
  },

  // ── Supply Chain Collaboration ─────────────────────────────────────────────
  {
    pattern: /SupplyChainCollaborationConfiguration/i,
    tags: [
      "supply chain", "supply chain collaboration", "scc", "sbn",
      "component consumption", "replenishment order", "forecast",
      "planning", "quality inspection", "quality notification",
      "supplier managed inventory", "supply chain monitor",
      "scheduling agreement", "collaboration",
    ],
  },
  {
    pattern: /Configuration.Guide.for.Business.*Network.Collaboration/i,
    tags: [
      "supply chain", "supply chain collaboration", "scc", "sbn",
      "collaboration", "configuration", "scheduling agreement",
      "replenishment order", "forecast", "planning", "supplier managed inventory",
    ],
  },

  // ── SBN Supplier Admin Guide (16.26.00 version) ──────────────────────────
  {
    pattern: /^sbn supplier administration guide/i,
    tags: [
      "supplier", "sbn", "notification", "email notification", "undeliverable",
      "user management", "roles", "trading relationship",
      "enterprise account", "standard account", "company profile", "anid",
    ],
  },

  // ── NON BTP SAP Business Network Supplier Administration Guide ────────────
  {
    pattern: /NON.BTP.*Supplier.Administration/i,
    tags: [
      "supplier", "sbn", "company profile", "user management", "roles",
      "customer relationship", "customer relationships", "trading relationship",
      "transaction rules", "purchase order rules", "po rules",
      "order confirmation rules", "ship notice rules", "invoice rules",
      "enterprise account", "standard account", "anid",
      "notification", "email notification",
      "vat", "tax verification", "identity verification",
      "account linking", "generative ai",
      "transaction data download", "document archive",
    ],
    excludeTags: ["btp", "punchout", "change order"],
  },

  // ── SBN BTP Supplier Admin ─────────────────────────────────────────────────
  {
    pattern: /SBN BTP Supplier.*Administration/i,
    tags: [
      "supplier", "btp", "sbn", "account", "company profile",
      "user management", "onboarding", "trading relationship",
      "catalog", "enterprise account", "standard account",
    ],
  },

  // ── GITP ──────────────────────────────────────────────────────────────────
  {
    pattern: /GITP/i,
    tags: [
      "trading partner", "integration", "onboarding", "supplier", "sbn",
      "guided integration", "compatibility", "purchase order", "po",
      "order confirmation", "invoice", "asn", "cxml", "template",
    ],
  },

  // ── UOM Mapping ───────────────────────────────────────────────────────────
  {
    pattern: /uomMappingForANSI/i,
    tags: [
      "edi", "unit of measure", "ansi x12", "cxml",
      "purchase order", "invoice", "mapping", "unuom",
    ],
  },

  // ── Test Central — internal setup docs (IS-facing) ────────────────────────
  {
    pattern: /Internal.Test.Central.Instructions/i,
    tags: [
      "test central", "tc", "managed gateway", "sbn", "buyer", "supplier",
      "test scenario", "test case", "purchase order", "po", "cxml",
      "order confirmation", "oc", "asn", "invoice", "setup",
      "admin area", "integration testing", "jira",
    ],
  },
  {
    pattern: /Test.Central.Setup.Checklist/i,
    tags: [
      "test central", "tc", "managed gateway", "sbn", "buyer", "supplier",
      "test scenario", "test case", "purchase order", "po", "cxml",
      "setup", "checklist", "admin area", "integration testing",
    ],
  },
  {
    pattern: /Creating.Test.Case/i,
    tags: [
      "test central", "tc", "managed gateway", "test case", "test scenario",
      "purchase order", "po", "cxml", "admin area", "setup",
      "order confirmation", "change order",
    ],
  },
  {
    pattern: /How.to.Access.Test.Central.Admin/i,
    tags: [
      "test central", "tc", "managed gateway", "admin area", "setup", "sbn",
      "test case repository", "test scenario",
    ],
  },
  {
    pattern: /How.to.Prep.PO.Examples/i,
    tags: [
      "test central", "tc", "managed gateway", "purchase order", "po", "cxml",
      "test case", "setup",
    ],
  },
  {
    pattern: /How.to.use.the.BUYER_TC_Scenario_Tracker/i,
    tags: [
      "test central", "tc", "buyer", "test scenario", "purchase order", "po",
      "managed gateway", "tracking",
    ],
  },
  {
    pattern: /Quick.Guide.for.Troubleshooting.Test.Scenarios/i,
    tags: [
      "test central", "tc", "managed gateway", "troubleshooting",
      "test scenario", "buyer", "supplier", "anid",
    ],
  },

  // ── Test Central — supplier-facing guides ─────────────────────────────────
  {
    pattern: /Supplier.How.To.Use.Guide.*Test.Central/i,
    tags: [
      "test central", "tc", "managed gateway", "sbn", "supplier",
      "purchase order", "po", "order confirmation", "oc", "asn", "invoice",
      "integration testing", "routing", "test scenario", "setup",
    ],
  },
  {
    pattern: /Test.Central.*How.to.Guide.for.Suppliers/i,
    tags: [
      "test central", "tc", "managed gateway", "sbn", "supplier",
      "purchase order", "po", "order confirmation", "oc", "asn", "invoice",
      "integration testing", "routing", "test scenario", "setup",
      "electronic order routing",
    ],
  },
  {
    pattern: /Supplier.TC.Cheat.Sheet/i,
    tags: [
      "test central", "tc", "supplier", "managed gateway", "sbn",
      "purchase order", "po", "order confirmation", "oc", "asn", "invoice",
      "credit memo", "cxml", "edi", "validation",
    ],
  },
  {
    pattern: /Supplier.Test.Central.FAQ/i,
    tags: [
      "test central", "tc", "supplier", "managed gateway", "sbn",
      "purchase order", "po", "order confirmation", "asn", "invoice",
      "credit memo", "cxml", "edi", "validation", "routing",
    ],
  },

  // ── Test Central — buyer-facing docs ──────────────────────────────────────
  {
    pattern: /Buyer.Test.Central.FAQ/i,
    tags: [
      "test central", "tc", "buyer", "managed gateway", "sbn",
      "purchase order", "po", "order confirmation", "asn", "invoice",
      "integration testing", "test scenario",
    ],
  },
  {
    pattern: /Buyer.Value.Prop.*Test.Central/i,
    tags: [
      "test central", "tc", "buyer", "sbn", "managed gateway",
      "integration testing", "onboarding",
    ],
  },
  {
    pattern: /Talking.points.for.Introducing.Test.Central/i,
    tags: [
      "test central", "tc", "buyer", "supplier", "sbn", "managed gateway",
      "purchase order", "po", "order confirmation", "asn", "invoice",
      "onboarding", "integration testing",
    ],
  },
  {
    pattern: /Buyer.Objections.and.Responses/i,
    tags: [
      "test central", "tc", "buyer", "sbn", "managed gateway",
      "purchase order", "po", "integration testing", "onboarding",
    ],
  },
  {
    pattern: /Supplier.Objections.and.Responses/i,
    tags: [
      "test central", "tc", "supplier", "sbn", "managed gateway",
      "purchase order", "po", "cxml", "edi", "integration testing",
      "onboarding", "validation",
    ],
  },

  // ── Managed Gateway how-to docs ───────────────────────────────────────────
  {
    pattern: /How.to.Access.Admin.Area.in.Managed.Gateway/i,
    tags: [
      "managed gateway", "cig", "admin area", "sbn", "buyer", "supplier",
      "test central", "tc",
    ],
  },
  {
    pattern: /How.to.Enable.Managed.Gateway/i,
    tags: [
      "managed gateway", "sbn", "supplier", "buyer", "integration",
      "electronic order routing", "cig",
    ],
  },

  // ── API spec JSON files (full-text matching disabled for these) ──────────
  {
    pattern: /FreightBookingConfirmation_Provider/i,
    tags: ["freight booking", "booking confirmation", "fc", "carrier", "subcontracting", "ocean"],
  },
  {
    pattern: /FreightBookingRequest_Consumer/i,
    tags: ["freight booking", "booking request", "fc", "carrier", "subcontracting", "ocean"],
  },
  {
    pattern: /FreightOrderForSubcontracting_Consumer/i,
    tags: ["freight order", "subcontracting", "fc", "carrier", "network partner"],
  },
  {
    pattern: /FreightOrderForSubcontracting_Provider/i,
    tags: ["freight order", "subcontracting", "fc", "carrier", "network partner", "booking confirmation"],
  },
  {
    pattern: /FreightTendering_Consumer/i,
    tags: ["freight tendering", "fc", "carrier", "tendering request"],
  },
  {
    pattern: /FreightTendering_Provider/i,
    tags: ["freight tendering", "fc", "carrier", "tendering response", "booking confirmation"],
  },
  {
    pattern: /GTT_OrderEvents_Provider/i,
    tags: ["order event", "event reporting", "gtt", "global track and trace", "carrier", "tracking"],
  },
  {
    pattern: /GTT_OrderForTracking_Consumer/i,
    tags: ["order tracking", "tracking request", "gtt", "global track and trace", "carrier", "shipper"],
  },
  {
    pattern: /LogisticsInvoice_Provider(?!Cancel)/i,
    tags: ["logistics invoice", "invoice", "fc", "carrier", "freight invoice"],
  },
  {
    pattern: /LogisticsInvoiceCancel_Provider/i,
    tags: ["logistics invoice", "invoice cancellation", "credit memo", "fc", "carrier"],
  },
  {
    pattern: /OrderEvents_Provider/i,
    tags: ["order event", "event reporting", "fc", "freight collaboration", "carrier", "tracking", "technical id"],
  },
  {
    pattern: /OrderForTracking_Consumer/i,
    tags: ["order tracking", "tracking request", "fc", "freight collaboration", "carrier", "shipper", "technical id"],
  },
  {
    pattern: /TransportationDocument_Consumer/i,
    tags: ["transportation document", "fc", "carrier", "freight order", "proof of delivery"],
  },
  {
    pattern: /TransportationDocument_Provider/i,
    tags: ["transportation document", "fc", "carrier", "freight order", "proof of delivery", "document confirmation"],
  },

  // ── BNL PDF docs ──────────────────────────────────────────────────────────
  {
    pattern: /Freight.Booking.API.*Ocean/i,
    tags: [
      "bnl", "freight booking", "api", "ocean", "carrier", "shipper",
      "freight collaboration", "integration", "booking confirmation",
    ],
  },
  {
    pattern: /Activate.Your.Account/i,
    tags: [
      "bnl", "carrier", "onboarding", "account activation", "logistics provider",
      "freight collaboration", "registration",
    ],
  },
  {
    pattern: /Administration.Guide.for.Logistics.Providers/i,
    tags: [
      "bnl", "carrier", "logistics provider", "admin", "freight collaboration",
      "account management", "user management", "integration",
    ],
  },
  {
    pattern: /Administration.Guide.for.Shippers/i,
    tags: [
      "bnl", "shipper", "admin", "freight collaboration", "carrier management",
      "account management", "user management", "integration",
    ],
  },
  {
    pattern: /APIs.in.SAP.Business.Network.Freight.Collaboration/i,
    tags: [
      "bnl", "api", "freight collaboration", "carrier", "freight booking",
      "freight order", "freight tendering", "tracking", "integration",
    ],
  },
  {
    pattern: /Assign.Codes.App/i,
    tags: [
      "bnl", "carrier", "assign codes", "freight collaboration",
      "code list", "integration", "onboarding",
    ],
  },
  {
    pattern: /Business.Network.for.Logistics.*Testing.*API/i,
    tags: [
      "bnl", "api", "testing", "freight collaboration", "carrier",
      "integration", "test environment",
    ],
  },
  {
    pattern: /Code.List.*BNL/i,
    tags: [
      "bnl", "code list", "freight collaboration", "carrier", "shipper",
      "reference data", "mapping",
    ],
  },
  {
    pattern: /Frequently.Asked.Questions.*FAQs/i,
    tags: [
      "bnl", "faq", "freight collaboration", "carrier", "shipper",
      "integration", "onboarding",
    ],
  },
  {
    pattern: /Getting.Started.Guide.for.Shippers/i,
    tags: [
      "bnl", "shipper", "onboarding", "getting started", "freight collaboration",
      "carrier management", "integration",
    ],
  },
  {
    pattern: /GTT_Activate.Your.Account/i,
    tags: [
      "bnl", "gtt", "global track and trace", "onboarding", "account activation",
      "logistics provider", "carrier",
    ],
  },
  {
    pattern: /GTT_Administration.Guide.for.Logistics.Providers/i,
    tags: [
      "bnl", "gtt", "global track and trace", "carrier", "logistics provider",
      "admin", "account management", "integration",
    ],
  },
  {
    pattern: /GTT_Administration.Guide.for.Solution.Owners/i,
    tags: [
      "bnl", "gtt", "global track and trace", "shipper", "solution owner",
      "admin", "configuration", "integration",
    ],
  },
  {
    pattern: /GTT_API.Documentation/i,
    tags: [
      "bnl", "gtt", "global track and trace", "api", "tracking",
      "event reporting", "carrier", "integration",
    ],
  },
  {
    pattern: /GTT_Code.List/i,
    tags: [
      "bnl", "gtt", "global track and trace", "code list",
      "reference data", "mapping", "carrier",
    ],
  },
  {
    pattern: /GTT_Getting.Started.Guide.for.Solution.Owners/i,
    tags: [
      "bnl", "gtt", "global track and trace", "shipper", "solution owner",
      "onboarding", "getting started", "configuration",
    ],
  },
  {
    pattern: /GTT_How.to.Send.Notifications/i,
    tags: [
      "bnl", "gtt", "global track and trace", "notification",
      "alert", "tracking", "event",
    ],
  },
  {
    pattern: /GTT_SAP_BN4L_Premium_CPI_Migration/i,
    tags: [
      "bnl", "gtt", "global track and trace", "cpi", "migration",
      "integration platform", "premium", "cloud integration",
    ],
  },
  {
    pattern: /GTT_.*Model.Administrators/i,
    tags: [
      "bnl", "gtt", "global track and trace", "model administrator",
      "configuration", "tracked process", "custom model",
    ],
  },
  {
    pattern: /How.to.connect.to.Network.Partner/i,
    tags: [
      "bnl", "network partner", "freight collaboration", "carrier",
      "integration", "api", "booking confirmation",
    ],
  },
  {
    pattern: /How.to.Integrate.SAP.Business.Network.Global.Track.and.Trace.with.Ariba/i,
    tags: [
      "bnl", "gtt", "global track and trace", "ariba network", "integration",
      "shipper", "tracking",
    ],
  },
  {
    pattern: /How.to.Integrate.with.SAP.Business.Network.*Freight.Collaboration.*Carrier.APIs/i,
    tags: [
      "bnl", "freight collaboration", "carrier", "api", "integration",
      "freight order", "freight booking", "tracking", "onboarding",
    ],
  },
  {
    pattern: /How.to.Send.Messages.with.Tracking.APIs/i,
    tags: [
      "bnl", "gtt", "global track and trace", "tracking", "api",
      "event reporting", "carrier", "integration",
    ],
  },
  {
    pattern: /Integration.Platform.Migration.Guide/i,
    tags: [
      "bnl", "migration", "integration platform", "neo", "multi-cloud",
      "cloud connector", "system connections", "freight collaboration",
    ],
  },
  {
    pattern: /Integration.with.SAP.Business.Network.for.Logistics.without.SFTP/i,
    tags: [
      "bnl", "integration", "sftp", "freight collaboration", "carrier",
      "edi", "cloud integration", "alternative",
    ],
  },
  {
    pattern: /Invoice.Upload.Guide.*Freight.Collaboration/i,
    tags: [
      "bnl", "invoice", "invoice upload", "freight collaboration",
      "carrier", "logistics invoice", "xlsx",
    ],
  },
  {
    pattern: /SAP.Business.Network.For.Logistics.*Carrier.Side.API.and.EDI/i,
    tags: [
      "bnl", "carrier", "api", "edi", "freight collaboration",
      "freight order", "freight booking", "tracking", "integration",
    ],
  },
  {
    pattern: /SAP.Business.Network.For.Logistics.*Road.EDI.Integration/i,
    tags: [
      "bnl", "edi", "road", "carrier", "freight collaboration",
      "integration", "edifact", "ansi x12",
    ],
  },
  {
    pattern: /SAP.Business.Network.for.Logistics.*Get.your.first/i,
    tags: [
      "bnl", "carrier", "onboarding", "getting started", "freight collaboration",
      "api", "integration", "first steps",
    ],
  },
  {
    pattern: /Carrier.Integration.Kickoff.Deck/i,
    tags: [
      "bnl", "carrier", "onboarding", "kickoff", "freight collaboration",
      "integration", "project plan",
    ],
  },
  {
    pattern: /SAP.Business.Network.for.Logistics.*Best.Practice/i,
    tags: [
      "bnl", "best practice", "freight collaboration", "carrier", "shipper",
      "integration", "api", "tracking",
    ],
  },
  {
    pattern: /SAP.Business.Network.Freight.Collaboration_BNL_01/i,
    tags: [
      "bnl", "freight collaboration", "carrier", "shipper", "integration",
      "freight order", "freight booking", "api", "onboarding",
    ],
  },
  {
    pattern: /SAP.Business.Network.Freight.Collaboration_BNL_02/i,
    tags: [
      "bnl", "freight collaboration", "carrier", "shipper", "integration",
      "freight tendering", "invoice", "tracking", "api",
    ],
  },
  {
    pattern: /SAP.Business.Network.Global.Track.and.Trace_Product/i,
    tags: [
      "bnl", "gtt", "global track and trace", "tracking", "shipment",
      "carrier", "shipper", "visibility", "integration",
    ],
  },
  {
    pattern: /SAP_LBN_EDI_HowToGuide_GTT/i,
    tags: [
      "bnl", "edi", "gtt", "global track and trace", "integration",
      "carrier", "edifact", "tracking", "how to",
    ],
  },
  {
    pattern: /SAP_LBN_GTT_FAQs/i,
    tags: [
      "bnl", "gtt", "global track and trace", "faq",
      "carrier", "tracking", "integration",
    ],
  },
  {
    pattern: /SAP_LBN_p44_config_guide/i,
    tags: [
      "bnl", "project44", "p44", "configuration", "integration",
      "tracking", "carrier", "visibility add-on",
    ],
  },
  {
    pattern: /SAP_LBN_p44_FSD/i,
    tags: [
      "bnl", "project44", "p44", "functional specification",
      "integration", "tracking", "carrier",
    ],
  },
  {
    pattern: /Tips.*Tricks.*SAP.Business.Network.for.Logist/i,
    tags: [
      "bnl", "troubleshooting", "freight collaboration", "gtt",
      "technical id", "technical id format", "technical id structure",
      "order tracking", "order event", "event reporting",
      "stop id", "location id", "unlocode",
      "attachment", "event attachment",
      "timezone", "utc",
      "invalid client", "bad credentials", "access token",
      "freight booking", "freight order",
      "fc suffix", "gtt suffix",
    ],
  },
  {
    pattern: /Understanding.Network.Partner.Integration/i,
    tags: [
      "bnl", "network partner", "freight collaboration", "carrier",
      "api", "integration", "booking confirmation", "freight booking",
    ],
  },

  // ── Supplier Integration Overview (EN + JPN) ──────────────────────────────
  {
    pattern: /IK20.*Supplier.*Integration.*Overview.*JPN/i,
    tags: [
      "supplier", "integration", "onboarding", "sbn", "cxml", "edi",
      "managed gateway", "cig", "purchase order", "po", "order confirmation", "oc",
      "advance ship notice", "asn", "invoice", "authentication", "certificate",
      "project plan", "uat", "trading partner", "japanese",
    ],
  },
  {
    pattern: /IK20.*Supplier.*Integration.*Overview/i,
    tags: [
      "supplier", "integration", "onboarding", "sbn", "cxml", "edi",
      "managed gateway", "cig", "purchase order", "po", "order confirmation", "oc",
      "advance ship notice", "asn", "invoice", "authentication", "certificate",
      "project plan", "uat", "trading partner",
    ],
  },

  // ── Integration Overview for Buyers ───────────────────────────────────────
  {
    pattern: /INT Integration Overview eBook_Buyers/i,
    tags: [
      "buyer", "integration", "onboarding", "sbn", "cxml", "edi",
      "managed gateway", "cig", "purchase order", "po", "invoice",
      "supplier", "trading partner", "project plan",
    ],
  },
  {
    pattern: /INT Integration Overview_Buyers/i,
    tags: [
      "buyer", "integration", "onboarding", "sbn", "cxml", "edi",
      "managed gateway", "cig", "purchase order", "po", "invoice",
      "supplier", "trading partner", "project plan",
    ],
  },

  // ── Pricing / account docs ─────────────────────────────────────────────────
  {
    pattern: /Enterprise.account.fee.model/i,
    tags: [
      "pricing", "enterprise account", "sbn", "supplier", "subscription",
      "transaction fee", "invoice", "purchase order", "po",
      "standard account", "bronze", "silver", "gold", "platinum",
    ],
  },
  {
    pattern: /SBN.Supplier.Account.*Pricing.FAQ/i,
    tags: [
      "pricing", "enterprise account", "sbn", "supplier", "subscription",
      "transaction fee", "invoice", "purchase order", "po",
      "standard account", "bronze", "silver", "gold", "platinum",
    ],
  },

  // ── Standard B2B Formats overview ─────────────────────────────────────────
  {
    pattern: /Standard.B2B.Formats.on.Managed.Gateway/i,
    tags: [
      "edi", "x12", "edifact", "ansi x12", "4010", "d96a", "managed gateway",
      "cig", "b2b", "format", "sbn", "supplier", "integration",
      "purchase order", "invoice", "asn", "ship notice",
    ],
  },

  // ── X12 EDI guides (ANSI X12 4010) ───────────────────────────────────────
  // Shared base tags applied to ALL X12 4010 documents
  {
    pattern: /X12.*4010/i,
    tags: [
      "edi", "x12", "ansi x12", "4010", "sbn", "managed gateway",
      "isa", "gs", "st", "se", "ge", "iea", "segment", "element",
      "loop", "envelope", "interchange",
    ],
    excludeTags: [
      "iata", "proof of delivery", "gtt", "fc", "scc", "cig", "cxml",
      "trading partner", "tolerance", "punchout", "catalog",
      "transaction rules", "non-po invoice",
    ],
  },

  // 810 Invoice (inbound from supplier)
  {
    pattern: /X12.IN810.4010.Inbound/i,
    tags: [
      "invoice", "810", "in810", "inbound",
      "big", "big07", "invoice type", "summary invoice", "credit memo",
      "cur", "currency",
      "ref", "ref qualifier", "invoice number",
      "n1", "n3", "n4", "party identification", "ship to", "bill to", "remit to",
      "dtm", "date", "invoice date", "delivery date",
      "it1", "line item", "unit price",
      "ctp", "pricing", "csd",
      "pam", "amount qualifier",
      "pid", "product description",
      "sac", "service allowance charge", "accounting distribution", "b840",
      "txi", "tax", "tax type", "vat", "gst", "tax total",
      "tds", "total invoice amount",
      "amt", "monetary amount",
      "ctt", "transaction totals",
      "n9", "reference identification",
    ],
  },

  // 850 Purchase Order (outbound to supplier)
  {
    pattern: /X12.PO850.4010.Outbound/i,
    tags: [
      "purchase order", "po", "850", "po850", "outbound",
      "beg", "po number", "po type",
      "cur", "currency",
      "ref", "contract number",
      "n1", "n3", "n4", "ship to", "bill to", "supplier",
      "dtm", "ship date", "delivery date",
      "po1", "line item", "unit price", "quantity",
      "pid", "product description",
      "sac", "allowance charge",
      "ctt", "transaction totals",
    ],
  },

  // 850 Sales Order (inbound from buyer ERP)
  {
    pattern: /X12.PO850.Salesorder.4010.Inbound/i,
    tags: [
      "purchase order", "sales order", "850", "po850", "inbound",
      "beg", "po number",
      "n1", "ship to", "bill to",
      "po1", "line item", "quantity", "unit price",
    ],
  },

  // 856 Ship Notice / ASN (inbound = from supplier)
  {
    pattern: /X12.SH856.4010.Inbound/i,
    tags: [
      "advance ship notice", "asn", "ship notice", "856", "sh856", "inbound",
      "bsn", "shipment number", "ship date",
      "dtm", "date",
      "n1", "ship from", "ship to",
      "hl", "hierarchical level", "shipment", "order", "pack", "item",
      "td1", "carrier details", "weight",
      "td5", "carrier routing",
      "ref", "po number", "tracking number",
      "po1", "line item", "quantity",
      "man", "marks numbers",
      "ctt", "transaction totals",
    ],
  },

  // 856 Ship Notice (outbound = to buyer ERP)
  {
    pattern: /X12.SH856.4010.Outbound/i,
    tags: [
      "advance ship notice", "asn", "ship notice", "856", "sh856", "outbound",
      "bsn", "hl", "hierarchical level",
      "n1", "td1", "td5", "ref", "po1",
    ],
    excludeTags: ["change order", "gr", "goods receipt", "vat", "invoice", "credit memo", "order confirmation", "oc"],
  },

  // 855 Purchase Order Acknowledgment (OC, inbound from supplier)
  {
    pattern: /X12.PR855.4010.Inbound/i,
    tags: [
      "order confirmation", "oc", "po acknowledgment", "855", "pr855", "inbound",
      "bak", "po number", "acknowledgment type",
      "ref", "dtm",
      "n1", "po1", "line item", "quantity", "price",
    ],
    excludeTags: ["gr", "goods receipt", "vat", "asn", "ship notice", "advance ship notice", "credit memo", "change order"],
  },

  // 860 Purchase Order Change Request (outbound to supplier)
  {
    pattern: /X12.PC860.4010.Outbound/i,
    tags: [
      "purchase order change", "change order", "860", "pc860", "outbound",
      "bca", "po number", "change type",
      "ref", "dtm",
      "n1", "po1", "line item",
    ],
    excludeTags: ["asn", "ship notice", "advance ship notice", "gr", "goods receipt", "service sheet", "erp", "vat", "order confirmation", "oc", "invoice", "credit memo"],
  },

  // 997 Functional Acknowledgment
  {
    pattern: /X12.FA997.4010/i,
    tags: [
      "functional acknowledgment", "ack", "997", "fa997",
      "ak1", "ak2", "ak5", "ak9",
      "accepted", "rejected", "error",
    ],
    excludeTags: ["po", "purchase order", "invoice", "asn", "ship notice", "advance ship notice", "credit memo", "gr", "goods receipt", "vat"],
  },

  // 846 Inventory Inquiry/Advice
  {
    pattern: /X12.IB846.4010.Inbound/i,
    tags: [
      "inventory", "846", "ib846", "inbound",
      "bia", "inventory inquiry",
      "lin", "product", "quantity on hand",
    ],
    excludeTags: ["gr", "erp", "ship notice", "invoice", "credit memo", "vat", "change order"],
  },
  {
    pattern: /X12.IB846.Consignment.4010.Outbound/i,
    tags: [
      "inventory", "consignment", "846", "ib846", "outbound",
      "bia", "consignment inventory",
      "lin", "product", "quantity",
    ],
    excludeTags: ["gr", "erp", "ship notice", "invoice", "credit memo", "vat", "change order"],
  },
  {
    pattern: /X12.IB846.MO.PO.4010.Inbound/i,
    tags: [
      "inventory", "846", "ib846", "move order", "inbound",
      "bia", "lin", "quantity",
    ],
    excludeTags: ["gr", "erp", "ship notice", "invoice", "credit memo", "vat", "change order"],
  },
  {
    pattern: /X12.IB846.SMI.4010.Outbound/i,
    tags: [
      "inventory", "supplier managed inventory", "smi", "846", "ib846", "outbound",
      "bia", "lin", "quantity",
    ],
    excludeTags: ["gr", "erp", "ship notice", "invoice", "credit memo", "vat", "change order"],
  },

  // 830 Planning Schedule
  {
    pattern: /X12.PS830.4010.Inbound/i,
    tags: [
      "planning schedule", "forecast", "830", "ps830", "inbound",
      "bfr", "schedule type",
      "lin", "product", "fsb", "quantity", "delivery date",
    ],
    excludeTags: ["gr", "erp", "ship notice", "invoice", "credit memo", "vat", "change order"],
  },
  {
    pattern: /X12.PS830.Order.4010.Outbound/i,
    tags: [
      "planning schedule", "order based", "830", "ps830", "outbound",
      "bfr", "lin", "fsb",
    ],
    excludeTags: ["gr", "erp", "ship notice", "invoice", "credit memo", "vat", "change order"],
  },
  {
    pattern: /X12.PS830.ProductActivity.4010.Outbound/i,
    tags: [
      "planning schedule", "product activity", "830", "ps830", "outbound",
      "bfr", "lin", "product activity",
    ],
    excludeTags: ["gr", "erp", "ship notice", "invoice", "credit memo", "vat", "change order"],
  },

  // 862 Shipping Schedule
  {
    pattern: /X12.SS862.4010.Outbound/i,
    tags: [
      "shipping schedule", "862", "ss862", "outbound",
      "bss", "schedule type",
      "lin", "product", "sdq", "quantity", "ship date",
    ],
    excludeTags: ["gr", "goods receipt", "erp", "ship notice", "invoice", "credit memo", "vat"],
  },

  // 866 Production Sequence
  {
    pattern: /X12.SQ866.4010.Inbound/i,
    tags: [
      "production sequence", "866", "sq866", "inbound",
      "bps", "sequence",
      "lin", "product", "quantity",
    ],
    excludeTags: ["gr", "erp", "ship notice", "invoice", "credit memo", "vat", "change order"],
  },

  // 832 Price/Sales Catalog
  {
    pattern: /X12.SC832.4010.Inbound/i,
    tags: [
      "catalog", "price catalog", "832", "sc832", "inbound",
      "bct", "catalog number",
      "lin", "product", "ctp", "price",
    ],
    excludeTags: ["gr", "erp", "ship notice", "invoice", "credit memo", "vat", "change order"],
  },

  // 820 Payment Order / Remittance Advice
  {
    pattern: /X12.RA820.4010.Outbound/i,
    tags: [
      "payment", "remittance", "820", "ra820", "outbound",
      "bpr", "payment method", "eft", "ach",
      "ref", "invoice number", "check number",
      "rdm", "dtm", "ent", "rmr",
    ],
    excludeTags: ["po", "purchase order", "credit memo", "gr", "goods receipt", "asn", "ship notice", "advance ship notice", "change order", "vat"],
  },

  // 861 Receiving Advice
  {
    pattern: /X12.RC861.4010/i,
    tags: [
      "receiving advice", "goods receipt", "gr", "861", "rc861",
      "bra", "po number",
      "n1", "ref", "dtm",
      "lin", "quantity received",
    ],
    excludeTags: ["po", "purchase order", "asn", "ship notice", "advance ship notice", "invoice", "credit memo", "change order", "vat"],
  },

  // 943 Warehouse Stock Transfer Shipment Advice
  {
    pattern: /X12.AR943.4010/i,
    tags: [
      "warehouse", "stock transfer", "shipment advice", "943", "ar943",
      "w06", "n1", "lin", "quantity",
    ],
    excludeTags: ["ship notice", "gr", "invoice", "credit memo", "vat", "order confirmation", "oc"],
  },

  // 944 Warehouse Stock Transfer Receipt Advice
  {
    pattern: /X12.RE944.4010/i,
    tags: [
      "warehouse", "stock transfer", "receipt advice", "944", "re944",
      "w07", "n1", "lin", "quantity received",
    ],
    excludeTags: ["ship notice", "invoice", "credit memo", "vat", "order confirmation", "oc"],
  },

  // 945 Warehouse Shipping Advice
  {
    pattern: /X12.SW945.4010/i,
    tags: [
      "warehouse", "shipping advice", "945", "sw945",
      "w27", "n1", "lin", "quantity",
    ],
    excludeTags: ["ship notice", "gr", "invoice", "credit memo", "vat", "order confirmation", "oc"],
  },

  // 940 Warehouse Shipping Order
  {
    pattern: /X12.OW940.4010.Outbound/i,
    tags: [
      "warehouse", "shipping order", "940", "ow940", "outbound",
      "w01", "n1", "lin", "quantity",
    ],
    excludeTags: ["ship notice", "gr", "goods receipt", "order confirmation", "oc", "erp", "invoice", "credit memo", "vat"],
  },

  // 824 Application Advice
  {
    pattern: /X12.AG824.4010/i,
    tags: [
      "application advice", "acknowledgment", "824", "ag824",
      "bgn", "ota", "error", "rejection",
    ],
    excludeTags: ["po", "purchase order", "ship notice", "invoice", "credit memo", "vat", "gr", "goods receipt"],
  },

  // 947 Warehouse Inventory Adjustment Advice
  {
    pattern: /X12.AW947.4010.Inbound/i,
    tags: [
      "warehouse", "inventory adjustment", "947", "aw947", "inbound",
      "wia", "lin", "quantity adjustment",
    ],
    excludeTags: ["asn", "ship notice", "gr", "erp", "invoice", "credit memo", "vat", "change order"],
  },

  // 865 Canada Customs Invoice (CA865)
  {
    pattern: /X12.CA865.4010.Inbound/i,
    tags: [
      "customs", "customs invoice", "canada", "865", "ca865", "inbound",
      "bci", "n1", "lin", "tariff", "duty",
    ],
    excludeTags: ["change order", "gr", "order confirmation", "oc", "ship notice", "asn", "vat"],
  },

  // 842 Nonconformance Report
  {
    pattern: /X12.NC842.4010/i,
    tags: [
      "nonconformance", "quality", "842", "nc842",
      "bni", "n1", "lin", "defect", "rejection",
    ],
    excludeTags: ["po", "purchase order", "asn", "ship notice", "advance ship notice", "invoice", "credit memo", "vat", "change order", "gr", "goods receipt", "erp"],
  },

  // 863 Report of Test Results (Quality Inspection)
  {
    pattern: /X12.RT863.*QualityInspectionDecision.4010.Outbound/i,
    tags: [
      "quality inspection", "inspection decision", "863", "rt863", "outbound",
      "bqt", "n1", "lin", "inspection result", "accept", "reject",
    ],
    excludeTags: ["po", "purchase order", "ship notice", "advance ship notice", "asn", "gr", "goods receipt", "invoice", "credit memo", "vat"],
  },
  {
    pattern: /X12.RT863.*QualityInspectionRequest.4010.Outbound/i,
    tags: [
      "quality inspection", "inspection request", "863", "rt863", "outbound",
      "bqt", "n1", "lin",
    ],
    excludeTags: ["po", "purchase order", "ship notice", "advance ship notice", "asn", "gr", "goods receipt", "invoice", "credit memo", "vat"],
  },
  {
    pattern: /X12.RT863.*QualityInspectionResult.4010.Inbound/i,
    tags: [
      "quality inspection", "inspection result", "863", "rt863", "inbound",
      "bqt", "n1", "lin", "test result",
    ],
    excludeTags: ["po", "purchase order", "ship notice", "advance ship notice", "asn", "gr", "goods receipt", "invoice", "credit memo", "vat"],
  },

  // 214 Transportation Carrier Shipment Status
  {
    pattern: /X12.QM214.4010.Inbound/i,
    tags: [
      "shipment status", "transportation status", "214", "qm214", "inbound",
      "b10", "ms1", "ms2", "at7", "at8", "status code", "tracking",
    ],
    excludeTags: ["po", "purchase order", "invoice", "credit memo", "gr", "goods receipt", "ship notice", "vat"],
  },

  // 864 Text Message
  {
    pattern: /X12.TX864.4010.Outbound/i,
    tags: [
      "text message", "free text", "864", "tx864", "outbound",
      "bmt", "n1", "nte",
    ],
    excludeTags: ["po", "purchase order", "invoice", "credit memo", "gr", "goods receipt", "ship notice", "vat", "asn"],
  },

  // ── EDIFACT guides ─────────────────────────────────────────────────────────
  // Shared base tags applied to ALL EDIFACT documents
  {
    pattern: /EDIFACT/i,
    tags: [
      "edi", "edifact", "sbn", "managed gateway",
      "unb", "unh", "unt", "unz", "segment", "element",
      "envelope", "interchange",
    ],
    excludeTags: [
      "iata", "proof of delivery", "gtt", "fc", "scc", "cig", "cxml",
      "trading partner", "tolerance", "punchout", "catalog",
      "transaction rules", "non-po invoice",
    ],
  },

  // INVOIC D96A Invoice (inbound from supplier)
  {
    pattern: /EDIFACT.INVOIC.D96A.Inbound/i,
    tags: [
      "invoice", "invoic", "d96a", "inbound",
      "bgm", "invoice type", "invoice number",
      "dtm", "invoice date", "delivery date",
      "rff", "reference", "po number",
      "nad", "name and address", "ship to", "bill to", "remit to",
      "moa", "monetary amount", "total amount",
      "tax", "vat", "gst",
      "lin", "line item", "quantity", "unit price",
      "ali", "allowance charge",
    ],
    excludeTags: ["gr", "goods receipt", "ship notice", "advance ship notice", "asn", "service sheet", "change order", "order confirmation", "oc"],
  },

  // INVOIC D01B Invoice (inbound from supplier, newer version)
  {
    pattern: /EDIFACT.INVOIC.D01B.Inbound/i,
    tags: [
      "invoice", "invoic", "d01b", "inbound",
      "bgm", "dtm", "rff", "nad", "moa", "tax", "vat", "lin",
    ],
    excludeTags: ["gr", "goods receipt", "ship notice", "advance ship notice", "asn", "service sheet", "change order", "order confirmation", "oc"],
  },

  // ORDERS D96A Purchase Order (outbound to supplier)
  {
    pattern: /EDIFACT.ORDERS.D96A/i,
    tags: [
      "purchase order", "orders", "d96a", "outbound",
      "bgm", "po number",
      "dtm", "rff", "nad",
      "lin", "pia", "qty", "pri", "unit price",
    ],
    excludeTags: ["gr", "goods receipt", "ship notice", "erp", "service sheet", "order confirmation", "oc", "invoice", "credit memo", "vat"],
  },

  // ORDCHG D96A Purchase Order Change (outbound to supplier)
  {
    pattern: /EDIFACT.ORDCHG.D96A/i,
    tags: [
      "purchase order change", "change order", "ordchg", "d96a", "outbound",
      "bgm", "rff", "nad", "lin",
    ],
    excludeTags: ["gr", "goods receipt", "ship notice", "erp", "service sheet", "order confirmation", "oc", "invoice", "credit memo", "vat"],
  },

  // ORDRSP D96A Order Response / Order Confirmation (inbound from supplier)
  {
    pattern: /EDIFACT.ORDRSP.D96A.Inbound/i,
    tags: [
      "order confirmation", "oc", "order response", "ordrsp", "d96a", "inbound",
      "bgm", "rff", "dtm", "nad",
      "lin", "qty", "pri",
    ],
    excludeTags: ["gr", "goods receipt", "ship notice", "asn", "invoice", "credit memo", "vat", "change order"],
  },

  // DESADV D96A Despatch Advice / ASN (inbound from supplier)
  {
    pattern: /EDIFACT.DESADV.D96A.Inbound/i,
    tags: [
      "advance ship notice", "asn", "despatch advice", "desadv", "d96a", "inbound",
      "bgm", "dtm", "rff",
      "nad", "ship from", "ship to",
      "cps", "hierarchical level",
      "lin", "qty", "quantity",
    ],
    excludeTags: ["gr", "goods receipt", "invoice", "credit memo", "vat", "change order", "order confirmation", "oc"],
  },

  // RECADV D96A Receiving Advice / GR (outbound to supplier)
  {
    pattern: /EDIFACT.RECADV.D96A.Outbound/i,
    tags: [
      "receiving advice", "goods receipt", "gr", "recadv", "d96a", "outbound",
      "bgm", "rff", "dtm",
      "nad", "lin", "qty", "quantity received",
    ],
    excludeTags: ["ship notice", "asn", "invoice", "credit memo", "vat", "change order", "order confirmation", "oc"],
  },

  // REMADV D96A Remittance Advice / Payment (outbound to supplier)
  {
    pattern: /EDIFACT.REMADV.D96A.Outbound/i,
    tags: [
      "payment", "remittance", "remadv", "d96a", "outbound",
      "bgm", "dtm", "rff",
      "nad", "moa", "doc", "invoice reference",
    ],
    excludeTags: ["gr", "ship notice", "asn", "change order", "order confirmation", "oc", "vat"],
  },

  // DELFOR D96A Delivery Forecast / Planning Schedule
  {
    pattern: /EDIFACT.DELFOR.Order.based.D96A.Outbound/i,
    tags: [
      "delivery forecast", "planning schedule", "order based", "delfor", "d96a", "outbound",
      "bgm", "dtm", "nad",
      "lin", "qty", "schedule", "delivery date",
    ],
    excludeTags: ["gr", "ship notice", "invoice", "credit memo", "vat", "order confirmation", "oc"],
  },
  {
    pattern: /EDIFACT.DELFOR.ProductActivity.based.D96A.Outbound/i,
    tags: [
      "delivery forecast", "planning schedule", "product activity", "delfor", "d96a", "outbound",
      "bgm", "dtm", "nad", "lin", "qty",
    ],
    excludeTags: ["gr", "ship notice", "invoice", "credit memo", "vat", "order confirmation", "oc"],
  },

  // DELJIT D96A Delivery Just-In-Time / Shipping Schedule
  {
    pattern: /EDIFACT.DELJIT.D96A.Order.based.Outbound/i,
    tags: [
      "shipping schedule", "just in time", "jit", "deljit", "d96a", "outbound",
      "bgm", "dtm", "nad", "lin", "qty", "ship date",
    ],
    excludeTags: ["gr", "ship notice", "invoice", "credit memo", "vat", "order confirmation", "oc"],
  },

  // IFTMIN D96A Freight Order / Transport Instruction (outbound)
  {
    pattern: /EDIFACT.IFTMIN.D96A.Outbound/i,
    tags: [
      "freight order", "transport instruction", "iftmin", "d96a", "outbound",
      "bgm", "tsr", "dtm", "nad",
      "gid", "goods item", "mea", "weight", "volume",
    ],
    excludeTags: ["gr", "ship notice", "invoice", "credit memo", "vat", "order confirmation", "oc", "purchase order"],
  },

  // IFTSTA D96A Transport Status (inbound from carrier)
  {
    pattern: /EDIFACT.IFTSTA.D96A.Inbound/i,
    tags: [
      "transport status", "shipment status", "tracking", "iftsta", "d96a", "inbound",
      "bgm", "tsr", "dtm", "nad",
      "loc", "location", "rff", "status", "event",
    ],
    excludeTags: ["gr", "ship notice", "invoice", "credit memo", "vat", "order confirmation", "oc", "purchase order"],
  },

  // CONTRL D3 Functional Acknowledgment
  {
    pattern: /EDIFACT.CONTRL.D3/i,
    tags: [
      "functional acknowledgment", "ack", "contrl", "d3",
      "uci", "ucm", "ucs", "ucd",
      "accepted", "rejected", "error",
    ],
    excludeTags: ["purchase order", "po", "invoice", "ship notice", "gr", "vat"],
  },
];

function extractTags(text, title, docKey) {
  const lower = text.toLowerCase() + " " + title.toLowerCase();
  const found = new Set();

  // API spec JSON files: skip full-text matching entirely — their JSON schema
  // content causes too many false positives. Tags come from FILENAME_TAGS only.
  const isApiSpec = docKey.startsWith("file://api-specs/") && !docKey.includes("/split/");

  if (!isApiSpec) {
    // 1. Match domain terms
    for (const entry of DOMAIN_TERMS) {
      if (Array.isArray(entry)) {
        const [abbrev, full] = entry;
        if (abbrev && lower.includes(abbrev)) found.add(abbrev);
        if (full && lower.includes(full)) found.add(full);
      } else {
        if (lower.includes(entry)) found.add(entry);
      }
    }

    // 2. Extract whitelisted acronyms from text
    const acronyms = text.match(/\b[A-Z]{2,12}\b/g) || [];
    for (const a of acronyms) {
      if (ACRONYM_WHITELIST.has(a)) found.add(a.toLowerCase());
    }
  }

  // 3. Apply filename-based forced tags (always applied, including API specs)
  const fileName = docKey.split("/").pop().toLowerCase();
  for (const { pattern, tags, excludeTags } of FILENAME_TAGS) {
    if (pattern.test(fileName)) {
      for (const t of tags) found.add(t);
      if (excludeTags) {
        for (const t of excludeTags) found.delete(t);
      }
    }
  }

  // 4. Remove stopwords
  for (const sw of STOPWORDS) found.delete(sw);

  return [...found].sort();
}

function getDocumentKey(url) {
  const match = url.match(/file:\/\/(.+?)(_Part\d+)?\.pdf$/);
  if (match) return match[1];
  return url;
}

const cache = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
const docTags = {};

for (const [url, page] of Object.entries(cache)) {
  if (!page.success) continue;
  const docKey = getDocumentKey(url);
  if (!docTags[docKey]) {
    docTags[docKey] = { urls: [], tags: new Set(), title: page.title };
  }
  docTags[docKey].urls.push(url);
  const tags = extractTags(page.content, page.title, docKey);
  for (const t of tags) docTags[docKey].tags.add(t);
}

// Convert Sets to sorted arrays
const output = {};
for (const [key, val] of Object.entries(docTags)) {
  output[key] = {
    title: val.title.replace(/_Part\d+$/, "").replace(/ -- \d+ of \d+ --.*$/, "").trim(),
    urls: val.urls,
    tags: [...val.tags].sort(),
  };
}

writeFileSync(TAGS_FILE, JSON.stringify(output, null, 2), "utf-8");
console.log(`Generated tags for ${Object.keys(output).length} documents → tags.json`);

for (const [key, val] of Object.entries(output)) {
  console.log(`\n📄 ${key.split("/").pop()}`);
  console.log(`   Tags: ${val.tags.join(", ")}`);
}
