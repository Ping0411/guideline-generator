/**
 * generate-tags.js
 * Reads cache.json, groups entries by source document, extracts keywords as tags,
 * and writes tags.json for use by the search function.
 *
 * Run: node generate-tags.js
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, "cache.json");
const TAGS_FILE = join(__dirname, "tags.json");

// SAP/SBN domain terms — full phrases and abbreviations, both included
// Format: each entry is either a string (single tag) or [abbrev, fullname] pair (both added)
const DOMAIN_TERMS = [
  // Core SAP products & platforms
  "sap", "ariba", "sbn", "cig", "btp", "s4hana", "erp", "ecc",
  ["lbn", "logistics business network"],
  ["bnl", "business network for logistics"],
  "business network", "business network for logistics",
  "freight collaboration", "managed gateway",

  // Integration & connectivity
  ["edi", "electronic data interchange"],
  ["api", null],
  ["idoc", null],
  "integration", "credential", "authentication", "routing", "onboarding",
  "trading partner", "getpending", "datadownload",

  // Test Central
  ["tc", "test central"],
  "test central", "test account", "test environment", "production account",
  "test scenario", "regression testing", "buyer test", "supplier test",

  // Document types
  ["po", "purchase order"],
  ["asn", "advance ship notice"],
  ["oc", "order confirmation"],
  ["gr", "goods receipt"],
  ["co", "change order"],
  "purchase order", "advance ship notice", "order confirmation", "goods receipt",
  "change order", "ship notice", "service sheet", "non-po invoice",
  "summary invoice", "credit memo", "catalog",

  // Invoice & payment
  "invoice", "invoicing", "invoice rules", "transaction rules",
  ["vat", null],
  "tax", "digital signature", "archiving", "payment", "discount",
  "status update", "peppol",

  // Supply chain & logistics
  ["scm", "supply chain"],
  "supply chain", "collaboration", "fulfillment",
  "freight", "carrier", "shipper", "logistics", "transportation",
  "freight booking", "freight order", "freight tendering",
  "dock appointment", "delivery proof", "proof of delivery",

  // PunchOut & catalog
  "punchout", "catalog",

  // cXML
  "cxml", "xml",

  // Common SAP terms
  "buyer", "supplier", "validation", "error", "rule",
  "quantity", "unit price", "tolerance", "delivery date",
  "overdelivery", "underdelivery",
  "soamanager", "cloud integration",
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
  "PO", "ASN", "EDI", "CIG", "SBN", "LBN", "BNL", "BTP",
  "SAP", "ERP", "ECC", "API", "VAT", "OC", "GR", "TC",
  "ANID", "APAC", "EMEA", "NAMER", "LAC", "SME",
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
  },
  {
    // BTP buyer admin guide
    pattern: /BuyerAdminGuide for BTP Users/i,
    tags: [
      "buyer", "buyer admin", "btp", "sbn", "transaction rules", "invoice rules",
      "purchase order", "invoice", "notifications", "user management",
      "routing", "company profile", "anid", "order routing",
    ],
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
  },
  {
    pattern: /Inovice part2/i,
    tags: [
      "invoice", "digital signature", "esignature", "pki", "certificate",
      "vat", "tax invoice", "invoice archiving", "trustweaver", "sbn", "cxml",
      "tax", "archiving",
    ],
  },
  {
    pattern: /Invoice.error.messages/i,
    tags: [
      "invoice", "error", "validation", "sbn", "cxml", "troubleshooting",
      "invoice rules", "purchase order", "po", "credit memo", "asn",
      "non-po invoice", "payment",
    ],
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
      "supply chain", "supply chain collaboration", "sbn",
      "component consumption", "replenishment order", "forecast",
      "planning", "quality inspection", "quality notification",
      "supplier managed inventory", "supply chain monitor",
      "scheduling agreement", "collaboration",
    ],
  },

  // ── SBN Supplier Admin Guide ──────────────────────────────────────────────
  {
    pattern: /SBN.Supplier.Administration.Guide/i,
    tags: [
      "supplier", "sbn", "notification", "email notification", "undeliverable",
      "user management", "roles", "trading relationship",
      "enterprise account", "standard account", "company profile", "anid",
    ],
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

  // ── LBN / Freight ─────────────────────────────────────────────────────────
  {
    pattern: /freight|lbn|bnl/i,
    tags: [
      "freight", "carrier", "shipper", "lbn", "bnl",
      "logistics", "logistics business network", "business network for logistics",
      "freight collaboration", "freight booking", "freight order",
      "freight tendering", "dock appointment", "proof of delivery",
      "transportation", "invoice",
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
];

function extractTags(text, title, docKey) {
  const lower = text.toLowerCase() + " " + title.toLowerCase();
  const found = new Set();

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

  // 3. Apply filename-based forced tags
  const fileName = docKey.split("/").pop().toLowerCase();
  for (const { pattern, tags } of FILENAME_TAGS) {
    if (pattern.test(fileName)) {
      for (const t of tags) found.add(t);
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
