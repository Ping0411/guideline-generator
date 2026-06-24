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

import { readFileSync, writeFileSync, existsSync } from "fs";
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

  // SAP Community blog series: Freight Booking API (Ocean) part 1 & 2
  // Content: REST API walkthrough for ocean booking — request fields, VGM,
  // booking confirmation flow, shipper/carrier interaction via API
  {
    pattern: /Freight.Booking.API.*Ocean/i,
    tags: [
      "freight booking", "ocean booking", "booking request", "booking confirmation",
      "vgm", "verified gross mass", "rest api", "booking cancellation",
      "freight forwarder", "shipping instruction",
    ],
  },

  // GTT: Activate Your Account — carrier/data contributor onboarding guide
  // Content: account activation steps, business profile setup, user creation,
  // connecting to shipper invitation, test vs production environment
  {
    pattern: /GTT_Activate.Your.Account/i,
    tags: [
      "account activation", "onboarding", "business profile",
      "user management", "invitation", "test environment", "production environment",
      "data contributor", "logistics provider",
    ],
  },

  // FC: Activate Your Account (non-GTT) — same topics for FC tenant
  {
    pattern: /^activate your account$/i,
    tags: [
      "account activation", "onboarding", "business profile",
      "user management", "invitation", "test environment", "production environment",
      "logistics provider", "freight collaboration",
    ],
  },

  // GTT: Administration Guide for Logistics Providers
  // Content: system connections (outbound/inbound), IP whitelist, OAuth setup,
  // multi-cloud migration, certificate (DigiCert), manage integration logs,
  // error handling, data protection, user administration
  {
    pattern: /GTT_Administration.Guide.for.Logistics.Providers/i,
    tags: [
      "system connections", "outbound connection", "inbound connection",
      "ip whitelist", "oauth", "multi-cloud", "neo", "certificate", "digicert",
      "manage integration logs", "error handling", "user administration",
      "data protection", "sftp", "connectivity platform",
    ],
  },

  // FC: Administration Guide for Logistics Providers (non-GTT)
  {
    pattern: /^administration guide for logistics providers$/i,
    tags: [
      "system connections", "outbound connection", "inbound connection",
      "ip whitelist", "oauth", "multi-cloud", "certificate",
      "manage integration logs", "error handling", "user administration",
      "alternate id", "manage invitations",
    ],
  },

  // Administration Guide for Shippers
  // Content: system connections for shippers, TM connectivity, SOA Manager,
  // cloud connector, configure partner connection, carrier management
  {
    pattern: /Administration.Guide.for.Shippers/i,
    tags: [
      "system connections", "soamanager", "cloud connector",
      "configure partner connection", "carrier management",
      "inbound authentication", "outbound authentication",
      "document links", "navigation links",
    ],
  },

  // APIs in SAP Business Network Freight Collaboration
  // Content: API overview list, payload limits per API, technical names,
  // max item count per document, dock appointment APIs, external planning APIs
  {
    pattern: /APIs.in.SAP.Business.Network.Freight.Collaboration/i,
    tags: [
      "api overview", "payload limit", "max item count", "technical name",
      "freight tendering", "freight subcontracting", "freight booking",
      "dock appointment", "external planning", "freight settlement",
      "transportation order", "api payload",
    ],
    excludeTags: ["purchase order", "order confirmation", "change order", "credit memo"],
  },

  // Assign Codes App — how carriers map their internal codes to BNL codes
  // Content: assign codes app usage, shipper-specific code mapping,
  // freight order status codes, transport mode codes
  {
    pattern: /Assign.Codes.App/i,
    tags: [
      "assign codes", "code mapping", "shipper-specific codes",
      "transport mode", "freight order status", "carrier code",
      "single integration", "multiple shippers",
    ],
  },

  // Testing BN4L APIs with SAP Business Accelerator Hub
  // Content: how to use API Hub to test BN4L APIs, freight order confirmation,
  // OAuth token acquisition, sandbox testing
  {
    pattern: /Testing.BN4L.API/i,
    tags: [
      "api hub", "accelerator hub", "sandbox", "api testing",
      "oauth token", "freight order confirmation", "test environment",
    ],
  },

  // Code List — BNL FC
  // Content: event type codes, transport mode codes, stop type codes,
  // charge type codes, document type codes used in FC APIs
  {
    pattern: /Code.List.*BNL/i,
    tags: [
      "event type code", "transport mode code", "stop type",
      "charge type", "document type", "code list", "reference data",
      "iata", "proof of delivery", "departure", "arrival",
    ],
    excludeTags: ["purchase order", "order confirmation", "erp", "ecc", "vat"],
  },

  // Frequently Asked Questions (FAQs) — FC
  // Content: general carrier FAQs, data storage, incident reporting,
  // language support, freight tendering/subcontracting/tracking/invoicing Q&A,
  // dock appointment FAQs, troubleshooting
  {
    pattern: /Frequently.Asked.Questions.*FAQs/i,
    tags: [
      "faq", "troubleshooting", "incident reporting", "data storage",
      "freight tendering", "freight subcontracting", "order tracking",
      "logistics invoice", "dock appointment", "language support",
    ],
    excludeTags: ["erp", "ecc", "sbn", "tolerance"],
  },

  // Getting Started Guide for Shippers
  // Content: shipper onboarding steps, connecting to carriers,
  // system connections setup, first freight order flow
  {
    pattern: /Getting.Started.Guide.for.Shippers/i,
    tags: [
      "getting started", "shipper onboarding", "connect carrier",
      "system connections", "first freight order", "carrier invitation",
    ],
  },

  // GTT: API Documentation / How to Send Messages with Tracking APIs
  // Content: Consumer API for Order Tracking, Provider API for Order Events,
  // technical ID structure, tracking request payload, event reporting,
  // GTT vs FC suffix, shipper LBN ID, data contributor
  {
    pattern: /GTT_API.Documentation|How.to.Send.Messages.with.Tracking.APIs/i,
    tags: [
      "order tracking", "tracking request", "order event", "event reporting",
      "technical id", "consumer api for order tracking", "provider api for order events",
      "gtt", "shipper lbn id", "data contributor", "tracking payload",
    ],
    excludeTags: ["erp", "ecc", "idoc", "vat", "sbn", "freight booking", "freight order"],
  },

  // GTT: Code List
  // Content: event type codes (DEPARTURE, ARRIVAL, POD, POPU, DELAYED etc.),
  // location type codes, tracking-specific codes for GTT APIs
  {
    pattern: /GTT_Code.List/i,
    tags: [
      "event type code", "code list", "departure", "arrival",
      "proof of delivery", "proof of pick-up", "delayed", "geo location",
      "location type", "gate in", "gate out", "reference data",
    ],
    excludeTags: ["erp", "ecc", "vat", "purchase order", "order confirmation", "iata"],
  },

  // GTT: Getting Started Guide for Solution Owners
  // Content: GTT tenant activation, identity authentication setup,
  // BTP global account, solution owner onboarding, welcome emails
  {
    pattern: /GTT_Getting.Started.Guide.for.Solution.Owners/i,
    tags: [
      "getting started", "solution owner", "gtt", "tenant activation",
      "identity authentication", "btp global account", "onboarding",
      "welcome email", "saml", "sso",
    ],
  },

  // GTT: Guide for Model Administrators
  // Content: manage models app, tracked process definition, planned events,
  // actual events, event matching, custom GTT model, deploy model,
  // check processes and events app
  {
    pattern: /GTT_.*Model.Administrators/i,
    tags: [
      "manage models", "tracked process", "planned event", "actual event",
      "event matching", "custom model", "deploy model",
      "check processes and events", "model administrator",
      "unplanned event", "milestone",
    ],
    excludeTags: ["erp", "ecc", "idoc", "tolerance", "purchase order", "freight order"],
  },

  // GTT: How to Integrate GTT with Ariba Network
  // Content: connecting GTT tenant to Ariba Network, cross-network tracking,
  // configuration steps for solution owners
  {
    pattern: /How.to.Integrate.SAP.Business.Network.Global.Track.and.Trace.with.Ariba/i,
    tags: [
      "gtt", "ariba network", "cross-network tracking", "solution owner",
      "network connection", "tracking configuration",
    ],
  },

  // GTT: Integration Platform Migration (Premium users)
  // Content: Neo → Multi-Cloud migration for shippers/solution owners,
  // cloud connector reconfiguration, certificate chain update,
  // outbound connection migration steps
  {
    pattern: /GTT_SAP_BN4L_Premium_CPI_Migration/i,
    tags: [
      "neo", "multi-cloud", "migration", "integration platform",
      "cloud connector", "certificate chain", "premium user",
      "outbound connection", "shipper migration", "solution owner migration",
    ],
  },

  // How to Connect to Network Partner (shipper guide)
  // Content: discover business partners app, request connection to network partner,
  // configure partner connection app, credential management,
  // Fourkites example, visibility provider
  {
    pattern: /How.to.connect.to.Network.Partner/i,
    tags: [
      "network partner", "discover business partners", "configure partner connection",
      "visibility provider", "credential management", "connection request",
      "fourkites", "b2b carrier",
    ],
  },

  // How to Integrate with SAP BN Freight Collaboration (Carrier APIs)
  // Content: outbound connection setup, communication details base URL vs entire URL,
  // freight subcontracting URL appending, authentication (network-to-network vs shipper-specific),
  // inbound connection, provider API endpoints, email notification for errors,
  // manage integration logs, test service
  {
    pattern: /How.to.Integrate.with.SAP.Business.Network.*Freight.Collaboration.*Carrier.APIs/i,
    tags: [
      "outbound connection", "communication details", "base url", "entire url",
      "freight subcontracting url", "url appending", "authentication",
      "network-to-network authentication", "shipper-specific authentication",
      "inbound connection", "provider api endpoint", "email notification",
      "manage integration logs", "test service", "ip filtering",
      "system connections", "oauth",
    ],
  },

  // Integration Platform Migration Guide (Freemium/carrier)
  // Content: Neo → Multi-Cloud migration for carriers/data contributors,
  // data center specific URLs, system connections reconfiguration,
  // inbound credential regeneration, multi-cloud endpoint
  {
    pattern: /^Integration Platform Migration Guide/i,
    tags: [
      "neo", "multi-cloud", "migration", "integration platform",
      "data center", "freemium", "carrier migration",
      "inbound credential", "system connections", "endpoint url",
    ],
  },

  // Integration without SFTP server — testing EDI via email
  // Content: alternative to SFTP for EDI testing, email-based EDI outbound,
  // configuration steps, IFTMIN via email, test environment only
  {
    pattern: /Integration.with.SAP.Business.Network.for.Logistics.without.SFTP/i,
    tags: [
      "sftp alternative", "edi via email", "iftmin", "edi testing",
      "email communication", "test environment", "edifact",
    ],
  },

  // Invoice Upload Guide — Freight Collaboration
  // Content: manual invoice upload via xlsx file, invoice template,
  // charge codes, carrier invoice submission without API/EDI
  {
    pattern: /Invoice.Upload.Guide.*Freight.Collaboration/i,
    tags: [
      "invoice upload", "xlsx", "manual invoice", "invoice template",
      "charge codes", "carrier invoice", "freight settlement",
    ],
  },

  // SAP Community: Carrier Side API vs EDI (Jeff Gebo)
  // Content: comparison of API vs EDI integration options,
  // which scenarios each supports, pros and cons, decision guide
  {
    pattern: /Carrier.Side.API.and.EDI/i,
    tags: [
      "api vs edi", "integration options", "freight tendering", "freight subcontracting",
      "freight booking", "order tracking", "dock appointment",
      "road carrier", "freight forwarder", "decision guide",
    ],
  },

  // SAP Community: Road EDI Integration Tips and Tricks (Jeff Gebo)
  // Content: ANSI X12 204/990/210, EDIFACT IFTMIN/IFTMBC/INVOIC,
  // SFTP setup, known host key, file naming patterns, inbound polling schedule,
  // EDI-specific troubleshooting tips
  {
    pattern: /Road.EDI.Integration/i,
    tags: [
      "edi", "ansi x12", "edifact", "204", "990", "210",
      "iftmin", "iftmbc", "invoic",
      "sftp setup", "known host key", "file naming", "inbound polling",
      "road edi", "edi troubleshooting",
    ],
  },

  // SAP Community: Get your first API-integrated example in 3 steps
  // Content: quick start guide — system connections setup, send freight order
  // from TM, check manage integration logs; aimed at new carrier integrators
  {
    pattern: /Get.your.first/i,
    tags: [
      "quick start", "first freight order", "system connections",
      "manage integration logs", "s4hana tm", "3 steps",
      "carrier api setup",
    ],
  },

  // Carrier Integration Kickoff Deck (carrier-facing)
  // Content: introduction to BNL for carriers, integration options overview,
  // API vs EDI vs portal, roles and responsibilities, project plan timeline,
  // how to get started, test tenant ordering
  {
    pattern: /Carrier.Integration.Kickoff.Deck/i,
    tags: [
      "kickoff", "project plan", "integration options", "api vs edi",
      "roles and responsibilities", "test tenant", "portal",
      "network partner", "freight forwarder", "onboarding steps",
    ],
  },

  // Best Practice guide
  // Content: pre-implementation planning, back-end system as leading system,
  // TM/S4HANA compatibility, project44, data volume considerations,
  // go-live checklist, monitoring setup
  {
    pattern: /Best.Practice/i,
    tags: [
      "best practice", "pre-implementation", "back-end system", "tm compatibility",
      "s4hana", "project44", "data volume", "go-live", "monitoring",
      "implementation guidance",
    ],
  },

  // BNL_01: Main FC application help (part 1 — shipper side)
  // Content: FC product overview, shipper apps, system connections for shippers,
  // SOA Manager, cloud connector, configure partner connection,
  // freight tendering apps, freight subcontracting apps, carrier onboarding
  {
    pattern: /SAP.Business.Network.Freight.Collaboration_BNL_01/i,
    tags: [
      "fc product overview", "shipper apps", "system connections",
      "soamanager", "cloud connector", "configure partner connection",
      "freight tendering apps", "freight subcontracting apps",
      "carrier onboarding", "freight order apps", "freight settlement apps",
      "dock appointment apps",
    ],
    excludeTags: ["erp", "ecc", "purchase order", "order confirmation", "tolerance", "archiving", "vat"],
  },

  // BNL_02: Main FC application help (part 2 — carrier side)
  // Content: carrier apps (freight orders for confirmation, freight tendering,
  // tracking, invoicing), system connections for carriers, user management,
  // manage integration logs, manage alternate IDs, manage invitations,
  // invoice dispute
  {
    pattern: /SAP.Business.Network.Freight.Collaboration_BNL_02/i,
    tags: [
      "carrier apps", "freight orders for confirmation", "freight tendering apps",
      "freight tracking apps", "logistics invoice", "invoice dispute",
      "system connections", "manage alternate ids", "manage invitations",
      "user management", "manage integration logs",
    ],
    excludeTags: ["erp", "ecc", "purchase order", "iata", "tolerance", "trading partner"],
  },

  // GTT Product application help
  // Content: solution owner apps (manage models, check processes and events,
  // view logs), data contributor apps, track freight movement,
  // visibility provider integration, project44 add-on
  {
    pattern: /SAP.Business.Network.Global.Track.and.Trace_Product/i,
    tags: [
      "gtt", "solution owner apps", "manage models", "check processes and events",
      "view logs", "data contributor", "track freight movement",
      "visibility provider", "project44 add-on", "planned event", "actual event",
    ],
    excludeTags: ["erp", "ecc", "idoc", "vat", "archiving", "asn", "goods receipt",
                  "credit memo", "purchase order", "soamanager"],
  },

  // EDI How-To Guide for GTT (EDIFACT)
  // Content: EDIFACT integration for GTT tracking, IFTSTA inbound setup,
  // SFTP configuration, event code mapping, step-by-step implementation
  {
    pattern: /SAP_LBN_EDI_HowToGuide_GTT/i,
    tags: [
      "edifact", "iftsta", "gtt", "sftp configuration",
      "event code mapping", "edi implementation", "tracking via edi",
      "inbound edi", "data contributor edi",
    ],
  },

  // project44 Feature Scope Description
  // Content: p44 add-on features for FC and GTT, visibility data,
  // automated tracking, supported transport modes, feature list
  {
    pattern: /SAP_LBN_p44_FSD/i,
    tags: [
      "project44", "p44", "visibility add-on", "automated tracking",
      "visibility data", "transport mode support", "feature scope",
      "fc add-on", "gtt add-on",
    ],
  },

  // project44 Configuration and Application Guide
  // Content: p44 add-on setup steps, system configuration, carrier assignment,
  // track id mapping, visibility event flow, troubleshooting p44 connection
  {
    pattern: /SAP_LBN_p44_config_guide/i,
    tags: [
      "project44", "p44", "p44 configuration", "carrier assignment",
      "track id", "visibility event", "p44 troubleshooting",
      "p44 connection setup",
    ],
    excludeTags: ["erp", "ecc", "purchase order", "vat", "sbn"],
  },

  // Tips & Tricks — community blog (high-value troubleshooting doc)
  {
    pattern: /Tips.*Tricks.*SAP.Business.Network.for.Logist/i,
    tags: [
      "troubleshooting", "technical id", "technical id structure", "technical id format",
      "fc suffix", "gtt suffix", "order tracking", "order event", "event reporting",
      "stop id", "location id", "unlocode",
      "attachment", "event attachment", "timezone", "utc",
      "invalid client", "bad credentials", "access token",
    ],
  },

  // Understanding Network Partner Integration
  // Content: network partner vs direct carrier, how shipper connects to
  // network partner, configure partner connection app, credential setup,
  // Fourkites/FourKites example, visibility provider flow
  {
    pattern: /Understanding.Network.Partner.Integration/i,
    tags: [
      "network partner", "visibility provider", "configure partner connection",
      "credential setup", "shipper configuration",
      "network partner vs carrier", "fourkites",
    ],
  },

  // ── BN4L Carrier Integration training deck ────────────────────────────────
  // Content: full carrier integration overview — API+EDI, onboarding, system
  // connections, tendering/subcontracting/booking/tracking/invoicing/external
  // planning, ANSI X12 (204/990/210), EDIFACT (IFTMIN/IFTMBC/IFTSTA/INVOIC),
  // configure partner connection, test tenant, URL appending behavior
  {
    pattern: /04_BN4L_Carrier_Integration/i,
    tags: [
      "carrier integration", "integration overview", "api vs edi",
      "freight tendering", "freight subcontracting", "freight booking", "order tracking",
      "logistics invoice", "external planning", "dock appointment",
      "system connections", "configure partner connection", "cpc",
      "test tenant", "onboarding",
      "oauth", "authentication",
      "ansi x12", "204", "990", "210",
      "edifact", "iftmin", "iftmbc", "iftsta", "invoic",
      "technical id", "url appending", "base url",
      "email notification", "manage integration logs",
    ],
    excludeTags: ["purchase order", "order confirmation", "asn", "sbn", "supplier"],
  },

  // ── BN4L API training session transcripts (Jeff Gebo) ────────────────────
  // Session 1 (2026-03-11): API overview, onboarding vs integration distinction,
  // carrier types (road/forwarder), API architecture, system connections intro,
  // freight subcontracting consumer API, manage integration logs
  {
    pattern: /BN4L.*API.training.*20260311/i,
    tags: [
      "api overview", "carrier types", "freight forwarder", "onboarding vs integration",
      "freight subcontracting", "consumer api", "system connections",
      "manage integration logs", "api architecture",
    ],
  },
  // Session 2 (2026-03-18): System connections deep dive, LBN ID location,
  // manage alternate IDs, consumer vs provider API distinction,
  // manage integration logs flow direction, outbound connection setup,
  // authentication (network-to-network vs shipper-specific), test service
  {
    pattern: /BN4L.*API.training.*20260318/i,
    tags: [
      "system connections", "lbn id", "manage alternate ids",
      "consumer api", "provider api", "manage integration logs",
      "flow direction", "outbound connection", "authentication",
      "network-to-network authentication", "shipper-specific authentication",
      "test service",
    ],
  },
  // Session 3 (2026-03-25): Order tracking API, invoicing API,
  // tracking technical ID, consumer API for order tracking,
  // provider API for order events, charge mapping for invoice,
  // freight settlement, freight charges
  {
    pattern: /BN4L.*API.training.*20260325/i,
    tags: [
      "order tracking", "tracking technical id", "consumer api for order tracking",
      "provider api for order events", "logistics invoice",
      "freight charges", "charge mapping", "freight settlement",
      "invoicing api",
    ],
  },
  // Session 4 (2026-04-01): URL appending deep dive for subcontracting/tendering,
  // shipper LBN ID in URL, originator ID, freight order ID in URL path,
  // update/cancel/notification URL patterns, carrier endpoint requirements
  {
    pattern: /BN4L.*API.training.*20260401/i,
    tags: [
      "url appending", "base url", "freight subcontracting url",
      "shipper lbn id in url", "originator id", "freight order id",
      "update url", "cancellation url", "notification url",
      "carrier endpoint", "webhook",
    ],
  },
  // Session 5 (2026-04-08): Freight booking (ocean/air), async API behavior,
  // email notifications for errors, user management (admin vs all-function),
  // invoice document flow, API response codes, error monitoring
  {
    pattern: /BN4L.*API.training.*20260408/i,
    tags: [
      "freight booking", "ocean booking", "async api", "api response code",
      "email notification", "error monitoring", "user management",
      "admin user group", "invoice document flow", "document flow",
    ],
  },
  // Session 6 (2026-04-22): External planning API, freight unit,
  // consumer API for external planning, provider API for planned freight documents,
  // no UI for external planning, freight forwarder use case, Claude Code demo
  {
    pattern: /BN4L.*API.training.*20260422/i,
    tags: [
      "external planning", "freight unit", "consumer api for external planning",
      "provider api for planned freight documents",
      "freight forwarder planning", "no ui", "freight order creation",
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

  // ── SCC docs added 2026-06-23 ────────────────────────────────────────────────

  // What is Buyer and Supplier KO call 2026
  // 1-page internal guide: defines the purpose of Buyer SCC SI KO call and
  // Supplier KO call; roles of buyer team vs supplier; SCC SI methodology intro;
  // distinction between KO call and technical call
  {
    pattern: /What is Buyer and Supplier KO call/i,
    tags: [
      "scc", "ko call", "kickoff call", "seller integration", "supplier onboarding",
      "buyer responsibilities", "scc methodology", "si intro",
    ],
    excludeTags: ["cxml", "edi", "erp", "order confirmation", "invoice", "asn"],
  },

  // SCC Buyer Supplier SAP Resources
  // Roles & responsibilities guide: Deployment Descriptions, SCC SI team structure,
  // buyer-side activities, supplier-side activities, project holistic activities
  {
    pattern: /^SCC Buyer Supplier SAP Resources/i,
    tags: [
      "scc", "seller integration", "roles and responsibilities", "deployment description",
      "scc methodology", "buyer activities", "supplier activities", "project activities",
      "si team", "supplier enablement",
    ],
    excludeTags: ["cxml", "edi", "order confirmation", "invoice", "asn", "transaction rules"],
  },

  // Training Session 2 SCC Buyer Supplier SAP Resources
  // Cross-training session 2: participating roles, technical call definition,
  // supplier integration process per supplier, buyer leverage, go-live coordination
  {
    pattern: /Training Session 2 SCC Buyer Supplier/i,
    tags: [
      "scc", "seller integration", "roles and responsibilities", "scc methodology",
      "technical call", "supplier integration process", "go-live",
      "buyer activities", "supplier activities", "si team", "cross training",
    ],
    excludeTags: ["cxml", "transaction rules", "order confirmation", "invoice", "asn"],
  },

  // SCC Indirect Cross Training Session 1 (Sessio 1 final)
  // Cross-training session 1: SCC indirect vs direct PO collaboration differences,
  // buyer complexity dimensions (locations, processes, ERPs, e-invoicing regions),
  // change management, portal/integrated/mixed suppliers, go-live strategies
  {
    pattern: /SCC Indirect Cross Training Sessio 1/i,
    tags: [
      "scc", "indirect procurement", "direct vs indirect", "buyer complexity",
      "e-invoicing", "change management", "go-live strategy", "mixed suppliers",
      "cross training", "seller integration", "scc methodology",
    ],
    excludeTags: ["cxml", "edi", "order confirmation", "asn", "transaction rules"],
  },

  // SCC EMEA Supplier integration - FAQ
  // Internal FAQ: SBN back-end system access, ERP version requirements, middleware,
  // functional design, UAT, adoption, change management
  {
    pattern: /SCC EMEA Supplier integration.*FAQ/i,
    tags: [
      "scc", "faq", "supplier integration", "erp", "middleware",
      "functional design", "uat", "adoption", "change management",
      "seller integration", "buyer responsibilities",
    ],
    excludeTags: ["cxml", "edi", "order confirmation", "asn", "transaction rules"],
  },

  // SCC Indirect Cross Training Purchase Order Collaboration
  // Cross-training on PO collaboration: OC process, ASN/ship notice, goods receipt,
  // change order, cXML structure, punchout, tolerance rules, transaction rules
  {
    pattern: /SCC Indirect Cross Training Purchase Order Collaboration/i,
    tags: [
      "scc", "purchase order", "po", "order confirmation", "oc",
      "advance ship notice", "asn", "ship notice", "goods receipt", "gr",
      "change order", "punchout", "cxml", "tolerance", "transaction rules",
      "supply chain collaboration", "cross training",
    ],
  },

  // SCC Indirect Cross Training Purchase Order Strucutre (typo intentional — matches filename)
  // Cross-training on PO structure: cXML PO fields, header/line level, tolerance,
  // goods receipt, OC and ship notice fields
  {
    pattern: /SCC Indirect Cross Training Purchase Order Stru[uc]ture/i,
    tags: [
      "scc", "purchase order", "po", "cxml", "order confirmation", "oc",
      "advance ship notice", "asn", "ship notice", "goods receipt", "gr",
      "tolerance", "transaction rules", "cross training",
    ],
  },

  // OC Supply chain monitor - Suppliers 2026 V1
  // Order confirmation deviation monitoring with Supply Chain Monitor:
  // deviation types, approval process, transaction rules, tolerance,
  // cXML OC fields, reconfirmation scenarios
  {
    pattern: /OC Supply chain monitor.*Suppliers/i,
    tags: [
      "scc", "order confirmation", "oc", "supply chain monitor",
      "deviation monitoring", "approval process", "tolerance",
      "transaction rules", "cxml", "reconfirmation", "purchase order", "po",
    ],
    excludeTags: ["asn", "ship notice", "invoice", "punchout"],
  },

  // Order Confirmation Process for Suppliers 2026 V1
  // Comprehensive OC guide: confirmation required, OC message structure,
  // confirmation/reconfirmation cases, schedule-line level, header/item status,
  // delivery date, OC scenarios for integrated vendors
  {
    pattern: /Order Confirmation Process for Suppliers/i,
    tags: [
      "scc", "order confirmation", "oc", "purchase order", "po",
      "reconfirmation", "schedule line", "header status", "item status",
      "delivery date", "cxml", "seller integration", "tolerance",
    ],
    excludeTags: ["asn", "ship notice", "invoice", "punchout", "goods receipt"],
  },

  // Order confirmation with Approval Flow in Scope - Logic 2026 V1
  // Logic guide for OC with approval flow: transaction rules controlling
  // approval behavior, retain confirmation status, deviation approval,
  // compliance tolerance, change order interaction
  {
    pattern: /Order confirmation with Approval Flow/i,
    tags: [
      "scc", "order confirmation", "oc", "approval flow", "transaction rules",
      "retain confirmation status", "deviation approval", "tolerance",
      "change order", "purchase order", "po",
    ],
    excludeTags: ["asn", "ship notice", "invoice", "punchout", "goods receipt"],
  },

  // ── BNL docs added 2026-06-04 (previously missing from cache) ───────────────

  // GTT_Administration Guide for Solution Owners
  // 66-page guide: solution owner onboarding on SAP BTP, subaccount setup,
  // subscribe to apps, identity authentication, role collections, connect with
  // data contributors, configure partner connections, manage models app,
  // track outbound deliveries, track PO fulfillment, technical user in system connections
  {
    pattern: /GTT_Administration Guide for Solution Owners/i,
    tags: [
      "solution owner", "solution owner onboarding", "btp subaccount setup",
      "subscribe to apps", "identity authentication tenant", "role collections",
      "connect with data contributors", "configure partner connection",
      "manage models app", "track outbound deliveries", "track po fulfillment",
      "technical user", "system connections app",
    ],
    excludeTags: ["carrier", "shipper", "freight order", "freight booking", "edi"],
  },

  // GTT_How to Send Notifications
  // 26-page guide: create email template, event-to-action script,
  // placeholders (system/application/user-defined), create mail object,
  // implement script, send email, define rule on configuration UI,
  // add recipients, check email status, Qualtrics feedback survey
  {
    pattern: /GTT_How to Send Notifications/i,
    tags: [
      "email notification", "event-to-action script", "email template",
      "notification placeholders", "create mail object", "notification rule",
      "add recipients", "check email status", "planned event overdue notification",
      "embed public links",
    ],
    excludeTags: ["carrier", "shipper", "freight order", "freight booking", "edi", "invoice"],
  },

  // SAP_LBN_GTT_FAQs
  // 44-page FAQ: solution owners FAQ, manage models app, check processes and events app,
  // view logs app, manage message logs, manage event logs, invite business partners,
  // system connections app, configure partner connections app, track PO fulfillment app
  {
    pattern: /SAP_LBN_GTT_FAQs/i,
    tags: [
      "faq", "solution owner faq", "manage models app", "check processes and events",
      "view logs app", "manage message logs", "manage event logs",
      "invite business partners", "system connections app",
      "configure partner connections", "track po fulfillment app",
    ],
    excludeTags: ["carrier", "shipper", "freight order", "freight booking", "edi", "invoice upload"],
  },

  // Activate Your Account (GTT/BNL logistics provider onboarding)
  // Carrier/logistics provider account activation flow on SAP Business Network for Logistics;
  // invite from business partner, welcome email, account setup steps
  {
    pattern: /^file:\/\/api-specs\/split\/Activate Your Account/i,
    tags: [
      "account activation", "logistics provider onboarding", "welcome email",
      "invite from business partner", "account setup",
    ],
    excludeTags: ["freight order", "freight booking", "edi", "invoice", "shipper admin"],
  },

  // Administration Guide for Logistics Providers (GTT)
  // Logistics provider admin guide: connectivity platform, DigiCert TLS certificate,
  // browser support, business configuration, integration platform migration,
  // user administration, authentication, personal data record
  {
    pattern: /^file:\/\/api-specs\/split\/Administration Guide for Logistics Providers/i,
    tags: [
      "logistics provider administration", "connectivity platform",
      "digicert tls certificate", "business configuration", "regions and hosts",
      "integration platform migration", "user administration", "authentication",
      "personal data record",
    ],
    excludeTags: ["freight order", "freight booking", "shipper", "solution owner", "edi", "invoice upload"],
  },

  // Administration Guide for Shippers
  // 132-page shipper admin guide: SAP BTP global account, subaccount, subscribe to apps,
  // identity authentication, role collections, carrier management, invite carriers,
  // system connections, configure partner connections, freight order configuration,
  // user management, DigiCert certificate, integration platform migration
  {
    pattern: /^file:\/\/api-specs\/split\/Administration Guide for Shippers/i,
    tags: [
      "shipper administration", "btp global account", "subscribe to apps",
      "identity authentication", "role collections", "invite carriers",
      "carrier management", "system connections", "configure partner connections",
      "freight order configuration", "digicert certificate",
      "integration platform migration",
    ],
    excludeTags: ["logistics provider", "solution owner", "edi", "invoice upload", "freight booking"],
  },

  // Getting Started Guide for Shippers
  // 16-page quick-start for shippers: welcome email, getting started steps,
  // inviting carriers to connect, next steps FAQ
  {
    pattern: /Getting Started Guide for Shippers/i,
    tags: [
      "shipper getting started", "invite carriers to connect", "welcome email",
      "shipper first steps",
    ],
    excludeTags: ["logistics provider", "solution owner", "edi", "invoice", "freight booking"],
  },

  // Invoice Upload Guide (SAP Business Network Freight Collaboration)
  // 12-page guide: accepted file upload formats, invoice upload options,
  // editable invoice fields, download invoice template, upload invoice (xlsx)
  {
    pattern: /Invoice Upload Guide_SAP Business Network Freight Collaboration/i,
    tags: [
      "invoice upload", "invoice upload guide", "xlsx upload",
      "accepted file formats", "editable invoice fields", "download invoice template",
      "invoice upload options",
    ],
    excludeTags: ["carrier api", "edi", "freight order", "freight booking", "shipper admin"],
  },

  // SAP Business Network Freight Collaboration - Feature Scope Description
  // 10-page overview of available features and documentation for BNL FC:
  // lists all available guides (Getting Started, Admin for Shippers, Admin for Logistics Providers,
  // Invoice Upload, APIs guide), feature availability by license
  {
    pattern: /Feature Scope Description/i,
    tags: [
      "feature scope", "available features", "documentation overview",
      "freight collaboration feature list", "license scope",
    ],
    excludeTags: ["edi", "freight booking", "solution owner", "gtt"],
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
  // PDF: strip _PartN.pdf suffix
  const pdfMatch = url.match(/file:\/\/(.+?)(_Part\d+)?\.pdf$/);
  if (pdfMatch) return pdfMatch[1];
  // VTT transcript: strip _PartN suffix (no extension)
  const vttMatch = url.match(/^(file:\/\/api-specs\/transcripts\/.+?)(_Part\d+)?$/);
  if (vttMatch) return vttMatch[1];
  return url;
}

const force = process.argv.includes("--force");
const cache = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
const existing = existsSync(TAGS_FILE) ? JSON.parse(readFileSync(TAGS_FILE, "utf-8")) : {};

// Group cache entries by document key, tracking the latest cachedAt per doc
const docMeta = {};
for (const [url, page] of Object.entries(cache)) {
  if (!page.success) continue;
  const docKey = getDocumentKey(url);
  if (!docMeta[docKey]) docMeta[docKey] = { urls: [], latestCachedAt: null, title: page.title };
  docMeta[docKey].urls.push(url);
  if (page.cachedAt && (!docMeta[docKey].latestCachedAt || page.cachedAt > docMeta[docKey].latestCachedAt)) {
    docMeta[docKey].latestCachedAt = page.cachedAt;
  }
}

const output = { ...existing };
let updated = 0;
let skipped = 0;

for (const [docKey, meta] of Object.entries(docMeta)) {
  const existingEntry = existing[docKey];
  const taggedAt = existingEntry?.taggedAt;

  // Skip if already tagged and cache hasn't changed since
  if (!force && taggedAt && meta.latestCachedAt && meta.latestCachedAt <= taggedAt) {
    skipped++;
    continue;
  }

  // Regenerate tags for this document
  const tagSet = new Set();
  for (const url of meta.urls) {
    const page = cache[url];
    if (!page?.success) continue;
    const tags = extractTags(page.content, page.title, docKey);
    for (const t of tags) tagSet.add(t);
  }

  output[docKey] = {
    title: meta.title.replace(/_Part\d+$/, "").replace(/ \[Part \d+\]$/, "").replace(/ -- \d+ of \d+ --.*$/, "").trim(),
    urls: meta.urls,
    tags: [...tagSet].sort(),
    taggedAt: new Date().toISOString(),
  };

  console.log(`\n📄 ${docKey.split("/").pop()}`);
  console.log(`   Tags: ${output[docKey].tags.join(", ")}`);
  updated++;
}

// Remove entries from output that no longer exist in cache
for (const key of Object.keys(output)) {
  if (!docMeta[key]) {
    delete output[key];
    console.log(`Removed stale entry: ${key}`);
  }
}

writeFileSync(TAGS_FILE, JSON.stringify(output, null, 2), "utf-8");
console.log(`\nDone: ${updated} updated, ${skipped} skipped (unchanged) → tags.json`);
