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
import { getDocumentKey } from "./utils.js";

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
  // ── cXML Reference Guide (65 parts) ──────────────────────────────────────
  {
    // P1: Table of contents for entire cXML Reference Guide 1.2.069 — all 24 chapters
    pattern: /cXMLReferenceGuide_Part1[ .]|cXMLReferenceGuide_Part1$/i,
    tags: ["cxml reference guide toc", "cxml 1.2.069", "cxml table of contents", "cxml document types list", "profilerequest profileresponse", "punchout transaction overview", "orderrequest overview", "invoicedetailrequest overview", "shipnoticerequest overview", "confirmationrequest overview", "payment cxml overview", "supply chain collaboration cxml", "cxml digital signatures overview"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P2: New features in cXML 1.2.069, cXML license agreement, introduction, DTDs, MIME attachments
    pattern: /cXMLReferenceGuide_Part2[ .]|cXMLReferenceGuide_Part2$/i,
    tags: ["cxml new features 1.2.069", "cxml license agreement", "cxml introduction", "cxml dtd", "cxml protocol specification", "request response model cxml", "cxml conventions", "cxml attachments mime", "multipart mime cxml", "cxml envelope", "cxml basics"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P3: MIME multipart attachments (cXML-urlencoded, cXML-base64, multipart/related), Header, Sender, Credential, SharedSecret, From/To
    pattern: /cXMLReferenceGuide_Part3[ .]|cXMLReferenceGuide_Part3$/i,
    tags: ["cxml attachment example", "mime multipart related cxml", "cxml-urlencoded cxml-base64", "cxml envelope header", "header element cxml", "sender element cxml", "credential element cxml", "sharedsecret cxml", "credentialmac", "from to element cxml", "multiple credentials cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P4: cXML envelope (From/To/Sender/Correspondent/Routing), Request/Response/Message, one-way async, Profile Transaction, PunchOut intro, GetPendingRequest
    pattern: /cXMLReferenceGuide_Part4[ .]|cXMLReferenceGuide_Part4$/i,
    tags: ["cxml envelope from to sender", "correspondent element cxml", "routing element cxml", "request response message cxml", "one-way asynchronous cxml", "service status response", "unitofmeasure money cxml", "profilerequest profileresponse", "profile transaction cxml", "punchout setup request response", "punchoutordermessage", "getpendingrequest getpendingresponse", "providersetuprequest cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P5: cXML-base64 HTML form posting, ProfileResponse option elements, Direct PunchOut, AuthRequest/AuthResponse, CredentialMac
    pattern: /cXMLReferenceGuide_Part5[ .]|cXMLReferenceGuide_Part5$/i,
    tags: ["cxml-base64 html form post", "form unpacking cxml", "profileresponse options", "session check cxml", "direct punchout", "punchout authentication", "authrequest authresponse", "credentialmac authentication cxml", "profile transaction options"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P6: Profile scenarios (buyer-to-supplier, hub-to-supplier etc.), PunchOut requirements, PunchOut event sequence, PunchOut documents
    pattern: /cXMLReferenceGuide_Part6[ .]|cXMLReferenceGuide_Part6$/i,
    tags: ["profile transaction scenarios", "punchout requirements", "punchout event sequence", "punchout documents", "punchout index catalog", "punchoutsetuprequest", "punchoutsetupresponse", "punchoutordermessage", "direct punchout authentication", "getpendingrequest datarequest", "dataresponse cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P7: PunchOut product selection, checkout, PO transmittal, PunchOut website implementation, BuyerCookie, personalization
    pattern: /cXMLReferenceGuide_Part7[ .]|cXMLReferenceGuide_Part7$/i,
    tags: ["punchout product selection", "punchout checkout", "punchout purchase order transmittal", "punchoutsetuprequest elements", "punchoutsetupresponse", "punchoutordermessage elements", "buyer supplier cookies punchout", "punchout personalization", "punchout website implementation", "buyercookie", "selecteditem punchout"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P8: Supplier web page modifications (Launch/Start/Sender/Order Receiver pages), ASP code samples, PunchOutSetupResponse structure
    pattern: /cXMLReferenceGuide_Part8[ .]|cXMLReferenceGuide_Part8$/i,
    tags: ["punchout supplier web pages", "launch page start page punchout", "sender page order receiver page punchout", "punchout asp implementation", "punchoutsetuprequest useragent", "sharedsecret punchout", "punchoutsetupresponse structure", "punchoutordermessage structure", "punchout session implementation"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P9: PunchOutSetupRequest detailed elements (BuyerCookie, Extrinsic, BrowserFormPost, Contact, SupplierSetup, ShipTo, SelectedItem, ItemOut), operation attributes
    pattern: /cXMLReferenceGuide_Part9[ .]|cXMLReferenceGuide_Part9$/i,
    tags: ["punchoutsetuprequest element declaration", "buyercookie extrinsic browserformpost", "suppliersetup url", "punchout operation create inspect edit source", "punchoutsetupresponse detail", "punchoutordermessage detail", "itemout punchout", "selecteditem itemid", "supplierpartid punchout", "shipto punchout"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P10: SupplierPartAuxiliaryID, BuyerPartID, ItemDetail in PunchOut, Direct PunchOut authentication, PurchaseRequisitionRequest intro
    pattern: /cXMLReferenceGuide_Part10[ .]|cXMLReferenceGuide_Part10$/i,
    tags: ["supplierpartauxiliaryid buyerpartid", "itemdetail punchout", "direct punchout authentication", "credentialmac sharedsecret", "purchaserequisitionrequest intro", "punchout item identification"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P11: PurchaseRequisitionRequest, OrderRequest, OrderRequestHeader (Total, BillTo, ShipTo, Payment, Tax, Contact, ControlKeys, ScheduleLine, Distribution, Accounting, SpendDetail)
    pattern: /cXMLReferenceGuide_Part11[ .]|cXMLReferenceGuide_Part11$/i,
    tags: ["purchaserequisitionrequest", "purchaserequisitionheader", "itemin cxml", "orderrequest cxml", "orderrequestheader", "billto shipto orderrequest", "payment tax shipping orderrequest", "legalentity businesspartner cxml", "termsofdelivery orderrequest", "controlkeys ocinstruction", "scheduleline distribution accounting", "spenddetail orderrequest"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P12: OrderRequestHeader Modifications (OriginalPrice, AdditionalCost, AdditionalDeduction), InvoiceHeaderModifications, BillTo, Money, Payment, PaymentTerm, BusinessPartner roles
    pattern: /cXMLReferenceGuide_Part12[ .]|cXMLReferenceGuide_Part12$/i,
    tags: ["orderrequestheader detailed example", "modification originalcost additionalcost", "invoiceheadermodifications", "billto address cxml", "money currency element", "alternatecurrency cxml", "payment paymentterm orderrequest", "businesspartner roles cxml", "orderrequest modification detail"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P13: BusinessPartner (shipTo/shipFrom/orderingAddress/logistics), Shipping, Tax in OrderRequestHeader, Attachment visibility, ControlKeys (OCInstruction/ASNInstruction/InvoiceInstruction), SESInstruction
    pattern: /cXMLReferenceGuide_Part13[ .]|cXMLReferenceGuide_Part13$/i,
    tags: ["businesspartner shipfrom orderingaddress", "shipping element orderrequest", "tax element orderrequestheader", "attachment visibility internal cxml", "controlkeys asn oc invoice instruction", "sesinstruction orderrequest", "quantity tolerance cxml", "ocinstruction asninstruction invoiceinstruction"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P14: DocumentReference, SupplierOrderInfo, TermsOfDelivery (Incoterms), OrderRequestHeaderIndustry, LifeSciences, AerospaceAndDefense, DPAS, ScheduleLine, AssetInfo
    pattern: /cXMLReferenceGuide_Part14[ .]|cXMLReferenceGuide_Part14$/i,
    tags: ["documentreference orderrequest", "supplierorderinfo orderrequest", "termsofdelivery incoterms cxml", "orderrequestheaderindustry", "lifesciences ordercategory", "aerospaceandefense dpas cxml", "authorizationlabels cxml", "scheduleline assetinfo cxml", "packagingindustry cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P15: ItemOut detailed (lineNumber, quantity, ItemID, ItemDetail, requestedDeliveryDate, isReturn, isDeliveryCompleted, ControlKeys, ScheduleLine, SerialNumberInfo, AssetInfo, ItemType composite/lean, DPAS)
    pattern: /cXMLReferenceGuide_Part15[ .]|cXMLReferenceGuide_Part15$/i,
    tags: ["itemout detailed cxml", "itemout linenumber quantity", "itemid itemdetail cxml", "requesteddeliverydate isreturn", "isdeliverycompleted unlimiteddelivery", "controlkeys scheduleline itemout", "serialnumberinfo assetinfo", "itemtype composite lean cxml", "productactivityheader orderrequest"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P16: ItemOut Distribution (Accounting, AccountingSegment, Charge, Money), SpendDetail, TravelDetail (ContractorInfo, JobDescription, WorkLocation), InvoiceDetailItem composite/lean
    pattern: /cXMLReferenceGuide_Part16[ .]|cXMLReferenceGuide_Part16$/i,
    tags: ["distribution accounting accountingsegment", "charge money itemout", "spenddetail traveldetail", "contractorinfo jobdescription worklocation", "itemout contractor services", "invoicedetailitem composite lean", "invoiceitemmodifications", "accounting distribution cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P17: TravelDetail detailed (AirDetail, CarRentalDetail, HotelDetail, RailDetail, PolicyViolation, TermsAndConditions), Vendor element, Money alternateAmount
    pattern: /cXMLReferenceGuide_Part17[ .]|cXMLReferenceGuide_Part17$/i,
    tags: ["traveldetail element declaration", "airdetail carrentaldetail hoteldetail raildetail", "spenddetail travel confirmation number", "policyviolation termsandconditions", "vendor element cxml", "money alternatecurrency spenddetail", "travel line item cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P18: AirDetail/AirLeg detailed (AirLegOrigin/Destination, Airport, IATA airport code, BookingClassCode), CarRentalDetail, HotelDetail, RailDetail, Indicator element
    pattern: /cXMLReferenceGuide_Part18[ .]|cXMLReferenceGuide_Part18$/i,
    tags: ["airdetail airleg cxml", "airlegorigin airlegdestination", "airport iata airportcode", "bookingclasscode airleg", "carrentaldetail hoteldetail raildetail cxml", "indicator warning error cxml", "travel detail air leg detail"],
    excludeTags: ["erp", "gtt", "fc"],
  },
  {
    // P19: Tolerances in ItemOut (QuantityTolerance, PriceTolerance, TimeTolerance), SerialNumberInfo (list/range/profile, PropertyValue, Characteristic), AssetInfo, LifeSciences, DPAS
    pattern: /cXMLReferenceGuide_Part19[ .]|cXMLReferenceGuide_Part19$/i,
    tags: ["tolerances itemout cxml", "quantitytolerance pricetolerance timetolerance", "percentage value money tolerance", "serialnumberinfo list range profile", "propertyvalue characteristic cxml", "assetinfo lifesciences cxml", "aerospaceandefense dpas itemout"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P20: ItemOut SerialNumberInfo (range/profile format), OrderedQuantity, DispatchQuantity, FreeGoodsQuantity, PackagingIndustry, ShipTo in ItemOut
    pattern: /cXMLReferenceGuide_Part20[ .]|cXMLReferenceGuide_Part20$/i,
    tags: ["serialnumberinfo range profile format", "orderedquantity dispatchquantity freegoodsquantity", "packagingindustry packaginglifesciences", "medicationlistinfo cxml", "shipto itemout cxml", "itemout continued elements"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P21: ItemOut Stock Transport Order examples, OrderRequest attachment examples, ProductActivityHeader, end of Purchase Orders chapter
    pattern: /cXMLReferenceGuide_Part21[ .]|cXMLReferenceGuide_Part21$/i,
    tags: ["itemout stock transport order", "orderrequest attachment example", "productactivityheader orderrequest", "ocinstruction asninstruction invoiceinstruction itemout", "scheduleline itemout example", "orderrequest complete example"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P22: ConfirmationHeader incoTerm, Path Routing (Path element, Router/Copy nodes, adding nodes to PunchOutOrderMessage, CopyRequest)
    pattern: /cXMLReferenceGuide_Part22[ .]|cXMLReferenceGuide_Part22$/i,
    tags: ["confirmationheader incoterm", "incoterms cxml fob ddp", "path routing cxml", "path element router nodes copy nodes", "punchoutordermessage path routing", "copyrequest cxml", "confirmationrequest path routing", "shipnoticerequest path routing"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P23: CopyRequest processingMode, Request for Quotations (Quote DTD, document sequence, QuoteRequestHeader, QuoteItemOut, ConditionType, ValidityPeriod, Scales)
    pattern: /cXMLReferenceGuide_Part23[ .]|cXMLReferenceGuide_Part23$/i,
    tags: ["copyrequest processingmode", "path routing confirmationrequest shipnoticerequest", "request for quotations cxml", "quote dtd document sequence", "quoterequestheader", "quoteitemout cxml", "conditiontype validityperiod scales", "rfq cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P24: QuoteItemOut detailed (ValidityPeriods, PricingConditions, Scales, CostTermValue, ConditionType, scaleType/scaleBasis), QuoteMessage, QuoteMessageHeader, QuoteItemIn
    pattern: /cXMLReferenceGuide_Part24[ .]|cXMLReferenceGuide_Part24$/i,
    tags: ["quoteitemout validityperiods pricingconditions", "scales scale costtermvalue", "conditiontype scaletype scalebasis", "quotemessage quotemessageheader", "quoteitemin cxml", "rfq pricing conditions scales", "validityperiod conditiontype rfq"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P25: QuoteItemIn detailed (ShipTo, Shipping, Tax, SpendDetail, TermsOfDelivery, Alternative), Payment overview (PaymentRemittance DTD, PaymentProposalRequest, PaymentToken, PCard)
    pattern: /cXMLReferenceGuide_Part25[ .]|cXMLReferenceGuide_Part25$/i,
    tags: ["quoteitemin shipto spenddetail", "alternative supplierproductionfacilityrelations", "payment cxml overview", "paymentremittance dtd", "paymentproposalrequest", "payableinfo paymentmethod paymentpartner", "paymenttoken pcard cxml", "payment document sequence"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P26: PaymentPartner details (payer/payee/originatingBank/receivingBank, abaRoutingNumber/ibanID/swiftID), PCard, PaymentRemittanceRequest, PaymentBatchRequest intro
    pattern: /cXMLReferenceGuide_Part26[ .]|cXMLReferenceGuide_Part26$/i,
    tags: ["paymentpartner contact roles payer payee", "bank routing abaroutingnumber ibanid swiftid", "paymentremittancerequest header", "paymentremittancerequestheader ispayment", "remittancedetail cxml", "paymentbatchrequest intro", "pcard paymenttoken payment", "intermediarybank correspondentbank cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P27: RemittanceDetail (PayableInvoiceInfo, InvoiceReference, PayableOrderInfo, NetAmount/GrossAmount/DiscountAmount), PaymentBatchRequest, PaymentRemittanceStatusUpdateRequest
    pattern: /cXMLReferenceGuide_Part27[ .]|cXMLReferenceGuide_Part27$/i,
    tags: ["remittancedetail payableinvoiceinfo", "invoicereference invoiceidinfo payableorderinfo", "payablemasteragreementinfo", "netamount grossamount discountamount payment", "paymentbatchrequest paymentbatchrequestheader", "paymentbatchsummary controlsum numberpayments", "paymentremittancestatusupdaterequest"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P28: Payment example documents (PaymentProposalRequest with Tax, PaymentRemittanceRequest, StatusUpdateRequest), TradeRequest, PaymentReceiptConfirmationRequest
    pattern: /cXMLReferenceGuide_Part28[ .]|cXMLReferenceGuide_Part28$/i,
    tags: ["payment example documents cxml", "paymentproposalrequest example tax", "paymentremittancerequest example", "paymentremittancestatusupdaterequest example", "traderequest traderequestheader", "traderequestsummary tradeitem", "paymentreceiptconfirmationrequest", "paymentreceiptconfirmationrequestheader"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P29: PaymentReceiptConfirmationRequest (PaymentReceiptDetails, PaymentReceiptItem, PaymentReceiptSummary), ChargeFileRequest, TimeCard Transaction (ReportedTime, Regular/Overtime/Doubletime, isNonBillable)
    pattern: /cXMLReferenceGuide_Part29[ .]|cXMLReferenceGuide_Part29$/i,
    tags: ["paymentreceiptconfirmationrequest details", "paymentreceiptitem paymentreceiptsummary", "chargefilerequest chargefiledetails", "chargefile bank charges cxml", "timecard transaction cxml", "timecard orderinfo contractor", "reportedtime overtime doubletime", "timecard isnonbillable"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P30: TimeCard ReportedTime (shift types, ExpenseAmount, TimeRange), Expense (mileage/airfare/hotel/perDiem), SubmitterInfo, ApprovalInfo, Master Agreements (MasterAgreementRequest, ContractRequest)
    pattern: /cXMLReferenceGuide_Part30[ .]|cXMLReferenceGuide_Part30$/i,
    tags: ["timecard expense expensetype mileage perdiem", "expenseamount timerange cxml", "submitterinfo approvalinfo timecard", "timecard examples cxml", "masteragreementrequest", "masteragreementrequestheader", "agreementitemout maxquantity minquantity", "contractrequest cxml intro"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P31: ContractRequest detailed (ContractRequestHeader, contractID, effectiveDate, expirationDate, operation new/update/delete, ContractItemIn, Alternative, ContractStatusUpdateRequest), StatusUpdateRequest intro
    pattern: /cXMLReferenceGuide_Part31[ .]|cXMLReferenceGuide_Part31$/i,
    tags: ["contractrequest contractrequestheader", "contractid effectivedate expirationdate", "contract operation new update delete", "contractitemin productionfacility", "alternative contractitemin", "contractstatusupdaterequest", "statusupdaterequest overview", "later status changes cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P32: StatusUpdateRequest detailed (DocumentReference, PaymentStatus, SourcingStatus, InvoiceStatus, DocumentStatus, InvoiceIDInfo, PartialAmount), ConfirmationRequest intro (ConfirmationHeader, incoTerm, OrderReference, ConfirmationItem, ConfirmationStatus)
    pattern: /cXMLReferenceGuide_Part32[ .]|cXMLReferenceGuide_Part32$/i,
    tags: ["statusupdaterequest documentreference status", "paymentstatus sourcingstatus invoicestatus", "documentstatus integrationstatus", "invoiceidinfo partial amount", "confirmationrequest confirmationheader", "orderreference confirmationitem", "confirmationstatus cxml", "invoice status update cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P33: ConfirmationRequest detailed (ConfirmationHeader with Contact/shipFrom/Comments/OrderReference, substitution, ItemIn for substitution, ConfirmationItem, ConfirmationStatus), OrderStatusRequest intro
    pattern: /cXMLReferenceGuide_Part33[ .]|cXMLReferenceGuide_Part33$/i,
    tags: ["confirmationrequest detailed example", "confirmationheader shipfrom contact comments", "orderreference documentreference confirmationrequest", "confirmationitem confirmationstatus", "substitution confirmationrequest itemin", "orderstatusrequest intro", "confirmation request substitution cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P34: ConfirmationStatus detailed (ScheduleLineReference, accept/reject types, Modifications), OrderStatusRequest elements, ShipNoticeRequest intro (ShipNoticeHeader, ShipControl)
    pattern: /cXMLReferenceGuide_Part34[ .]|cXMLReferenceGuide_Part34$/i,
    tags: ["confirmationstatus detail accept reject", "schedulelinereference confirmationstatus", "modifications confirmationstatus", "orderstatusrequest orderstatusrequestheader", "orderstatusrequestitem", "shipnoticerequest intro", "shipnoticeheader shipcontrol", "confirmationstatus contact item level"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P35: ShipNoticeRequest detailed (ShipNoticeHeader attributes, shipmentID, operation new/update/delete, ShipControl, ShipNoticePortion, Extrinsic, transport mode types)
    pattern: /cXMLReferenceGuide_Part35[ .]|cXMLReferenceGuide_Part35$/i,
    tags: ["shipnoticerequest shipnoticeheader detailed", "shipmentid operation new update delete asn", "shipnoticeheader attributes", "shipcontrol shipnoticeportion", "shipnoticeheader extrinsic", "shipment transport mode air road rail maritime", "shipnoticerequest operation cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P36: ShipControl transport means (vessel/truck/rail/air), ShipNoticePortion/ShipNoticeItem structure, hazard classification codes, batch/AssetInfo elements
    pattern: /cXMLReferenceGuide_Part36[ .]|cXMLReferenceGuide_Part36$/i,
    tags: ["shipcontrol transport means vessel", "route method motor rail air", "shipnoticeportion orderreference structure", "shipnoticeitem quantity linenumber attributes", "shipnoticeitem composite item type", "stock transport order intra inter", "shipnoticeitemdetail unitprice description dimension", "hazard undg imdg nahg classification", "supplierbatchid batch lot number", "assetinfo tagnumber serialnumber location", "shipnotice item packaging hazard", "multimodal means fixedtransport inlandwater"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P37: ShipNoticeItemRetail (BestBeforeDate, FreeGoodsQuantity, PromotionDealID), ShipNoticeItemLifeSciences (Study/ProtocolID), ReceiptRequest elements
    pattern: /cXMLReferenceGuide_Part37[ .]|cXMLReferenceGuide_Part37$/i,
    tags: ["shipnoticeitemretail bestbeforedate expirydate", "shipnoticeitem freegoodsquantity promotiondealid", "shipnoticeitemlifesciences study protocolid", "medicationlistinfo range minimum maximum", "poolid clinical study ship notice", "receiptrequest purchase order master agreement", "receiptrequestheader receiptid receiptdate operation", "receiptorder closeforReceiving attribute", "receiptorderinfo orderreference masteragreementidinfo", "receiptitem quantity type received returned", "receiptitem negative quantity corrective action", "shipnoticelinereference shipnoticelinenumber"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P38: Invoice types (header/detail/credit memo/debit memo), InvoiceDetailRequest structure, InvoiceDetailRequestHeader attributes
    pattern: /cXMLReferenceGuide_Part38[ .]|cXMLReferenceGuide_Part38$/i,
    tags: ["invoicedetailrequest header detail invoice", "invoice purpose creditMemo debitMemo linelevelcreditmemo", "invoicedetailrequestheader invoiceid invoicedate", "invoice operation new delete cancel", "isheaderinvoice invoicedetailheaderorder", "invoice ers evaluated receipt settlement", "invoicedetailheaderindicator vatrecoverable", "invoicedetaillineindicator isTaxInLine isShippingInLine", "invoicepartner billto remitto soldto", "idreference bankroutingid accountid domain"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P39: InvoiceDetailOrder, InvoiceDetailItem, InvoiceDetailItemReference, UnitPrice/UnitRate, Tax, Discount elements
    pattern: /cXMLReferenceGuide_Part39[ .]|cXMLReferenceGuide_Part39$/i,
    tags: ["invoicedetailorder invoicedetailorderinfo", "invoicedetailitem invoicedetailitemreference", "unitprice unitrate invoicedetail", "tax taxdetail invoicedetail line item", "discount payinnumberofdays discountpercent", "penalty rate discount element", "invoicedetailitem quantity unitofmeasure", "invoicedetailitem linenumber itemtype", "invoicedetailitem description classification", "tax withheld invoicedetail withholdingamount"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P40: TaxDetail attributes (purpose/category/percentageRate), tax types (sales/use/VAT/GST/withholding), TaxLocation, DetailTaxIndicator
    pattern: /cXMLReferenceGuide_Part40[ .]|cXMLReferenceGuide_Part40$/i,
    tags: ["taxdetail purpose category percentagerate", "tax type sales use vat gst", "tax withholding taxlocation", "detailtaxindicator taxcalculation method", "taxdetail taxamount taxrateapplied", "tax triangular transaction category", "tax custom duty import type", "taxdetail grossamount netamount"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P41: InvoiceDetailSummary (SubtotalAmount, Tax, SpecialHandlingAmount, ShippingAmount), InvoiceDetailService elements, service start/end dates
    pattern: /cXMLReferenceGuide_Part41[ .]|cXMLReferenceGuide_Part41$/i,
    tags: ["invoicedetailsummary subtotalamount tax", "invoicedetailsummary specialhandlingamount shippingamount", "invoicedetailservice start end date", "service period startdate enddate invoice", "invoicedetailservice itemtype description", "invoicedetailservice unitprice unitrate", "detailtaxindicator invoicedetailsummary", "totalamount invoicedetail due amount"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P42: InvoiceDetailSummaryIndustry (RetailInvoiceSummary), InvoiceDetailSummaryRetail (special retail fields), InvoiceDetailRequestHeader extrinsic fields
    pattern: /cXMLReferenceGuide_Part42[ .]|cXMLReferenceGuide_Part42$/i,
    tags: ["invoicedetailsummaryindustry retail summary", "invoicedetailsummaryretail special fields", "invoicedetailrequestheader extrinsic fields", "invoicedetail header credit memo retail", "retailinvoicesummary invoicedetailsummary industry", "invoicedetail header non po invoice", "invoicedetail service based invoice type"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P43: InvoiceDetailItemIndustry/Retail, non-PO invoice, InvoiceDetailGeneralIndustry, invoice examples (standard PO-based, service)
    pattern: /cXMLReferenceGuide_Part43[ .]|cXMLReferenceGuide_Part43$/i,
    tags: ["invoicedetailitemindustry invoicedetailitemretail", "non po invoice invoicedetailrequest", "invoicedetailgeneralindustry item type", "invoice example po based standard xml", "service invoice xml example cxml", "invoicedetailitem extrinsic custom field", "invoice line item classification unspsc"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P44: ServiceEntryRequest (new/update/delete/cancel), ServiceEntryRequestHeader, ServiceEntryOrder, ServiceEntrySummary, service sheet status
    pattern: /cXMLReferenceGuide_Part44[ .]|cXMLReferenceGuide_Part44$/i,
    tags: ["serviceentryrequest operation new update delete", "serviceentryrequestheader serviceentryid status", "serviceentryorder serviceentryorderinfo", "serviceentrysummary total approved rejected", "service sheet status pending approved rejected", "serviceentryitem quantity unitprice servicedescription", "serviceentry period startdate enddate", "serviceentry referencedocumentinfo po reference"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P45: ServiceEntryItem details (UnitPrice deprecated, PriceBasisQuantity), TypeDefinition catalog element, IndexItemAdd structure
    pattern: /cXMLReferenceGuide_Part45[ .]|cXMLReferenceGuide_Part45$/i,
    tags: ["serviceentryitem unitprice deprecated", "pricebasisquantity service entry price", "typedefinition catalog element", "indexitemadd catalogitem index", "leadtime indexitemdetail vs itemdetail", "serviceentryitem classification taxonomy", "catalog type definition structure"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P46: IndexItemDelete/IndexItemUpdate, Subscription (CatalogUploadRequest), GetPendingRequest, DataDownloadRequest, catalog management
    pattern: /cXMLReferenceGuide_Part46[ .]|cXMLReferenceGuide_Part46$/i,
    tags: ["indexitemdelete indexitemupdate catalog", "cataloguploadrequest subscription catalog", "getpendingrequest datarequest catalog", "datadownloadrequest catalog download", "catalog management upload cxml", "subscriptionchangemessage catalog status notify", "loadid catalogid catalog reference"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P47: Catalog status subscription management, CatalogStatusNotification, URLPost callback, postal address in catalog context
    pattern: /cXMLReferenceGuide_Part47[ .]|cXMLReferenceGuide_Part47$/i,
    tags: ["catalogstatusnotification urlpost catalog", "catalog status subscription management", "urlpost callback notification enabled disabled", "postaladdress structure catalog context", "catalogupload acknowledgement status", "catalog getpendingrequest statusupdaterequest"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P48: ProviderSetupRequest (Provider PunchOut, member organization info, OrganizationID)
    pattern: /cXMLReferenceGuide_Part48[ .]|cXMLReferenceGuide_Part48$/i,
    tags: ["providersetuprequest provider punchout", "member organization info setup", "organizationid networkid credential", "provider punchout setup request fields", "member organization type buyer supplier"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P49: ProductActivityMessage (SMI/consignment/sales), ProductActivityDetails, InventoryTimeSeries, SalesReport
    pattern: /cXMLReferenceGuide_Part49[ .]|cXMLReferenceGuide_Part49$/i,
    tags: ["productactivitymessage smi consignment sales", "productactivitydetails inventorytimeseries", "inventorytimeseries timeseries period", "salesreport salesreportperiod saleactivity", "productactivitymessage partid unitofmeasure", "consignment inventory product activity", "productactivity forecast demand quantity"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P50: ConsignmentInventory, SubcontractingStockInTransferQuantity, PlanningTimeSeries, ConsignmentMovement details
    pattern: /cXMLReferenceGuide_Part50[ .]|cXMLReferenceGuide_Part50$/i,
    tags: ["consignmentinventory consignment stock levels", "subcontractingstockintransferquantity component", "planningtimeseries planning horizon period", "consignmentmovement movement type transfer", "consignment stock replenishment withdrawl", "productactivity subcontracting component material"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P51: ComponentConsumptionRequest, ProductReplenishmentMessage, ReplenishmentOrder (SalesOrderRequest)
    pattern: /cXMLReferenceGuide_Part51[ .]|cXMLReferenceGuide_Part51$/i,
    tags: ["componentconsumptionrequest backflush consumption", "productreplenishmentmessage replenishment forecast", "replenishmentorder salesorderrequest", "salesorderrequest salesorderheader", "componentconsumption batch split quantity", "productreplenishment receivedquantity smi"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P52: QualityNotificationRequest (Q6/Q7/custom types, defect/complaint/deviation, attachments, RMA number)
    pattern: /cXMLReferenceGuide_Part52[ .]|cXMLReferenceGuide_Part52$/i,
    tags: ["qualitynotificationrequest q6 q7 types", "qualitynotification defect complaint deviation", "qualitynotificationheader notificationid status", "qualitynotification defectlocation defectcause", "qualitynotification rma number integration", "qualitynotification attachment long text", "qualitynotification task activity filter"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P53: QualityInspectionRequest (new/update/delete), QualityInspectionResultRequest, QualityInspectionDecisionRequest
    pattern: /cXMLReferenceGuide_Part53[ .]|cXMLReferenceGuide_Part53$/i,
    tags: ["qualityinspectionrequest new update delete", "qualityinspectionresultrequest inspection result", "qualityinspectiondecisionrequest accept reject", "qualityinspection characteristics quantitative qualitative", "qualityinspection docusign certificate of analysis", "qualityinspection plan type inspection lot", "qualityinspectionrequest purchase order reference"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P54: QualityInspectionResult/Decision details, ComplainQuantity, UN/CEFACT UOM codes table
    pattern: /cXMLReferenceGuide_Part54[ .]|cXMLReferenceGuide_Part54$/i,
    tags: ["qualityinspectionresult characteristic values", "qualityinspectiondecision usage decision stock", "complainquantity defect quantity inspection", "uncefact unit of measure common codes", "uom table common codes reference cxml", "qualityinspection defect code category"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P55: MalfunctionPeriod/FailurePeriod (quality notification), ReferenceDocumentInfo, QualityInspectionRequestReference
    pattern: /cXMLReferenceGuide_Part55[ .]|cXMLReferenceGuide_Part55$/i,
    tags: ["malfunctionperiod failureperiod quality notification", "referenceDocumentInfo document reference cxml", "qualityinspectionrequestreference inspection reference", "qualitynotification malfunction start end date", "referencedocumentinfo purchaseorderreference"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P56: QualityInspectionRequest detailed attributes, inspection lot characteristics, inspection plan
    pattern: /cXMLReferenceGuide_Part56[ .]|cXMLReferenceGuide_Part56$/i,
    tags: ["qualityinspection lot attributes detailed", "inspection plan origin sample size", "qualityinspection characteristic quantitative range", "qualityinspection defect category class code", "qualityinspection vendor batch purchase order item", "qualityinspection operation new update delete"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P57: ApprovalRequest (ApprovalRequestHeader approvalStatus), SalesOrderRequest header/item
    pattern: /cXMLReferenceGuide_Part57[ .]|cXMLReferenceGuide_Part57$/i,
    tags: ["approvalrequestheader approvalstatus values", "approvalstatus approved awaitingapproval reject", "approvedandupdatepo approval status update", "salesorderrequest salesorderheader item", "salesorderrequest replenishment order type", "approvalrequest purchase requisition cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P58: TransportRequest, TransportConfirmation — logistics provider transport arrangement
    pattern: /cXMLReferenceGuide_Part58[ .]|cXMLReferenceGuide_Part58$/i,
    tags: ["transportrequest logistics provider consignment", "transportconfirmation transport booking", "transportrequest header shipper consignee", "transport delivery arrangement freight booking", "transportrequest shipmentid carrier", "transportrequest pickup delivery time window"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P59: TransportEquipment, DateInfo, TransportTemperature, MAC authentication fields
    pattern: /cXMLReferenceGuide_Part59[ .]|cXMLReferenceGuide_Part59$/i,
    tags: ["transportequipment equipment type container", "dateinfo transport dates pickup delivery", "transporttemperature temperature control range", "mac authentication message authentication", "equipment providedby sender receiver carrier", "transport container seal number tare weight"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P60: Auth transaction (AuthRequest/AuthResponse), cXML MAC authentication, MAC element fields
    pattern: /cXMLReferenceGuide_Part60[ .]|cXMLReferenceGuide_Part60$/i,
    tags: ["authtransaction authrequest authresponse cxml", "mac authentication shared secret algorithm", "mac element cxml authentication header", "cxml auth response status code", "authentication credential mac verification"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P61: cXML Digital Signatures (W3C XML DSig, XAdES), SignatureInfo, KeyInfo, signature validation
    pattern: /cXMLReferenceGuide_Part61[ .]|cXMLReferenceGuide_Part61$/i,
    tags: ["cxml digital signature xml dsig", "xades xml advanced electronic signature", "signatureinfo keyinfo certificate signature", "signature validation canonicalization method", "w3c xml signature enveloped detached", "cxml signing invoice digital certificate"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P62: DataSyncRequest/DataSyncSnapshot (organization data sync), AuthorizationProfiles, user authorization synchronization
    pattern: /cXMLReferenceGuide_Part62[ .]|cXMLReferenceGuide_Part62$/i,
    tags: ["datasyncsnapshot organization data sync", "datasyncrequest sync type full incremental", "authorizationprofiles user authorization", "person element authorization sync", "user authorization sync network id", "data sync snapshot full organizational"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P63: DataSyncSnapshot details, AuthorizationProfiles fields, PersonRequest user sync
    pattern: /cXMLReferenceGuide_Part63[ .]|cXMLReferenceGuide_Part63$/i,
    tags: ["authorizationprofiles permission type role", "personrequest user account sync cxml", "person element authorization sync fields", "user sync personrequest operation add delete", "authorizationprofile application permission", "datasyncsnapshot person organization role"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P64-P65: cXML revision history changelog (version tables with short descriptions of new elements/features)
    pattern: /cXMLReferenceGuide_Part(64|65)[ .]|cXMLReferenceGuide_Part(64|65)$/i,
    tags: ["cxml revision history version changelog", "cxml 1.2 version new elements features", "contractrequest contractstatusupdaterequest changelog", "masteragreement contractitemin changelog entry", "inventorytimeseries businesspartner version history", "cxml purchaserequisitionrequest controlkeys version", "paymentremittancerequest chargefilerequest changelog", "cxml revision history chapter section short description"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  // ── cXML Solutions Guide (43 parts) ──────────────────────────────────────
  {
    // P1: Full TOC — all major transaction types (PunchOut, OrderRequest, ConfirmationRequest, ShipNoticeRequest, InvoiceDetailRequest, QuoteRequest, GetPendingRequest, ProductActivity, ReceiptRequest, SCF)
    pattern: /cxmlSolutions.Guide_Part1[ .]|cxmlSolutions.Guide_Part1$/i,
    tags: ["cxml solutions guide toc", "punchout orderrequest invoicedetailrequest toc", "confirmationrequest shipnoticerequest toc", "quoterequest quotemessage toc", "cataloguploadrequest getpendingrequest toc", "productactivity receiptrequest scf toc", "traderequest purchaserequisitionrequest toc"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P2: Data conventions — PostalAddress structure, TelephoneNumber, CountryCode, Name, Street, City, ISO 8601 timestamp, Extrinsic, special characters
    pattern: /cxmlSolutions.Guide_Part2[ .]|cxmlSolutions.Guide_Part2$/i,
    tags: ["postaladdress telephonenumber cxml", "countrycode name street city", "iso 8601 timestamp cxml", "extrinsic element cxml", "special characters xml encoding", "postaladdress structure cxml solutions"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P3: Data conventions continued — PostalAddress, TelephoneNumber, CountryCode details, XML character encoding
    pattern: /cxmlSolutions.Guide_Part3[ .]|cxmlSolutions.Guide_Part3$/i,
    tags: ["cxml data conventions", "postal address format", "telephone number format", "xml character encoding", "special characters cxml", "cxml naming conventions"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P4: HTTPS/TLS setup, digital certificates, URL configuration, changing SBN URLs, supplier certificate setup
    pattern: /cxmlSolutions.Guide_Part4[ .]|cxmlSolutions.Guide_Part4$/i,
    tags: ["https tls cxml", "digital certificate supplier", "url configuration sbn", "changing sbn urls supplier", "trusted ca certificate", "cxml security https", "sbn cxml url setup"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P5: NetworkID, DUNS, AribaNetworkUserId, PrivateId, VendorID, VendorSiteID, SystemID, ChildSystemId, Credential domains, DigitalSignature, test account, multiple credentials
    pattern: /cxmlSolutions.Guide_Part5[ .]|cxmlSolutions.Guide_Part5$/i,
    tags: ["networkid duns aribanetworkuserid", "privateid vendorid vendorsiteid", "systemid childsystemid credential", "credential domain cxml", "digitalsignature test account", "multiple credentials cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P6: Service provider credentials, EndPointID, SystemID, ERP integration, Correspondent, Quick Enablement, ICS invoice, PaymentProposalRequest, GetPendingRequest end points
    pattern: /cxmlSolutions.Guide_Part6[ .]|cxmlSolutions.Guide_Part6$/i,
    tags: ["service provider credentials cxml", "endpointid systemid cxml", "erp integration correspondent", "quick enablement cxml", "ics invoice endpoint", "paymentproposalrequest endpoint", "getpendingrequest endpoints"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P7: ProfileRequest/ProfileResponse, QuoteRequest, Correspondent element, Brazil NFe CTe, test URL HTTPS URL, profile transaction, tax ID
    pattern: /cxmlSolutions.Guide_Part7[ .]|cxmlSolutions.Guide_Part7$/i,
    tags: ["profilerequest profileresponse cxml", "quoterequest correspondent", "brazil nfe cte cxml", "test url https url cxml", "profile transaction cxml solutions", "tax id cxml supplier"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P8: ProfileResponse PunchOut URL, PunchOutSetupRequest message flow, PunchOut site planning, BrowserFormPost, index catalog, cXML URL
    pattern: /cxmlSolutions.Guide_Part8[ .]|cxmlSolutions.Guide_Part8$/i,
    tags: ["profileresponse punchout url", "punchoutsetuprequest message flow", "punchout site planning", "browserformpost cxml", "punchout index catalog url", "cxml punchout url setup"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P9: PunchOut SupplierPartAuxiliaryID, supplier cookie, PunchOut testing/deployment, Services Exchange, Close Session, catalog tester
    pattern: /cxmlSolutions.Guide_Part9[ .]|cxmlSolutions.Guide_Part9$/i,
    tags: ["supplierpartauxiliaryid punchout", "supplier cookie punchout", "punchout testing deployment", "services exchange punchout", "close session punchout", "catalog tester punchout"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P10: PunchOut Index Catalog, PunchoutLevel, store/aisle/shelf/product hierarchy, SupplierID, Classification, non-catalog, third-party supplier
    pattern: /cxmlSolutions.Guide_Part10[ .]|cxmlSolutions.Guide_Part10$/i,
    tags: ["punchout index catalog level", "punchoutlevel store aisle shelf", "classification supplierid catalog", "non-catalog third-party punchout", "punchout product hierarchy", "index catalog punchout structure"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P11: PunchOutSetupRequest/Response/OrderMessage elements, BuyerCookie, BrowserFormPost, SelectedItem, operation create/edit/inspect, StartPage, ItemIn, ItemDetail, UnitPrice
    pattern: /cxmlSolutions.Guide_Part11[ .]|cxmlSolutions.Guide_Part11$/i,
    tags: ["punchoutsetuprequest response ordermessage", "buyercookie browserformpost selecteditem", "punchout operation create edit inspect", "startpage itemin itemdetail", "unitprice punchoutordermessage", "punchout cxml elements detail"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P12: PunchOutOrderMessage base64 encoding, cxml-base64, Level 2 PunchOut, PunchOut URL, edit operation, ongoing shopping session
    pattern: /cxmlSolutions.Guide_Part12[ .]|cxmlSolutions.Guide_Part12$/i,
    tags: ["punchoutordermessage base64 encoding", "cxml-base64 punchout", "level 2 punchout edit", "punchout url base64", "punchout edit operation session", "ongoing punchout shopping session"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P13: Level 2 PunchOut PunchoutLevel, shelf-level PunchOut, CIF catalog, Index catalog, SelectedItem, session timeout, ASP example, store-level CIF
    pattern: /cxmlSolutions.Guide_Part13[ .]|cxmlSolutions.Guide_Part13$/i,
    tags: ["level 2 punchout punchoutlevel shelf", "cif catalog punchout index", "selecteditem punchout level 2", "punchout session timeout", "punchout asp example", "store-level cif catalog"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P14: Attachment/AttachmentOnline, PurchaseRequisitionRequest, purchase requisition, AccountCategory, BuyerPartNumber, Facility, operation new/update/delete, anti-virus
    pattern: /cxmlSolutions.Guide_Part14[ .]|cxmlSolutions.Guide_Part14$/i,
    tags: ["attachment attachmentonline cxml", "purchaserequisitionrequest cxml solutions", "accountcategory buyerpartnumber facility", "requisition operation new update delete", "anti-virus attachment cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P15: OrderRequest orderType (regular/blanket/release/stockTransport), orderID, orderDate, operation new/update/delete, order routing, isSTOOutbound
    pattern: /cxmlSolutions.Guide_Part15[ .]|cxmlSolutions.Guide_Part15$/i,
    tags: ["orderrequest ordertype regular blanket", "ordertype release stocktransport", "orderid orderdate cxml solutions", "orderrequest operation new update delete", "order routing isstooutbound cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P16: OrderRequest ShipTo, BillTo, DeliverTo, TransportInformation, Route, CarrierIdentifier, BusinessPartner, soldTo/shipFrom, TermsOfDelivery, ShippingPaymentMethod
    pattern: /cxmlSolutions.Guide_Part16[ .]|cxmlSolutions.Guide_Part16$/i,
    tags: ["orderrequest shipto billto deliverto", "transportinformation route carrieridentifier", "businesspartner soldto shipfrom orderrequest", "termsofdelivery shippingpaymentmethod", "orderrequest address elements cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P17: OrderRequest Tax TaxDetail VAT Cess withholdingTax, Modifications AdditionalDeduction AdditionalCost, Distribution Accounting AccountingSegment ControlKeys OCInstruction ASNInstruction InvoiceInstruction
    pattern: /cxmlSolutions.Guide_Part17[ .]|cxmlSolutions.Guide_Part17$/i,
    tags: ["orderrequest tax taxdetail vat", "cess withholdingtax orderrequest", "modifications additionaldeduction additionalcost", "distribution accounting accountingsegment orderrequest", "controlkeys ocinstruction asninstruction invoiceinstruction"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P18: OrderRequest BlanketItemDetail BPO, ariba.availableAmount ariba.invoicingAllowed MaxAmount, DPAS ReceivingType HideMaxAmount, service PO, blanket order, GeneralLedger CostCenter
    pattern: /cxmlSolutions.Guide_Part18[ .]|cxmlSolutions.Guide_Part18$/i,
    tags: ["blanketitemdetail bpo orderrequest", "ariba.availableamount ariba.invoicingallowed", "maxamount hideamount blanket", "dpas receivingtype orderrequest", "service po blanket order generalledger"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P19: ItemOut itemType composite/item/lean, requiresServiceEntry, parentLineNumber, itemClassification, itemCategory, subcontractingType, stockTransferType, isReturn, isKanban, confirmationDueDate
    pattern: /cxmlSolutions.Guide_Part19[ .]|cxmlSolutions.Guide_Part19$/i,
    tags: ["itemout itemtype composite lean", "requiresserviceentry parentlinenumber", "itemclassification itemcategory", "subcontractingtype stocktransfertype", "isreturn iskanban confirmationduedate"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P20: OrderRequest hideAmount hideUnitPrice, AmountBasedReceiving, ContingencyReceiving, PriceBasisQuantity, Tolerances QuantityTolerance PriceTolerance, ScheduleLine requestedDeliveryDate, cancel order change order
    pattern: /cxmlSolutions.Guide_Part20[ .]|cxmlSolutions.Guide_Part20$/i,
    tags: ["hideamount hideunitprice orderrequest", "amountbasedreceiving contingencyreceiving", "pricebasisquantity tolerances cxml", "quantitytolerance pricetolerance orderrequest", "scheduleline requesteddeliverydate", "cancel order change order orderrequest"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P21: OrderRequest cancel/change order orderVersion, Contact role soldTo/buyerCorporate, Path Routing PCard, Subcontracting SubcontractingComponent, Batch BuyerBatchID, ProductActivityMessage ComponentConsumptionRequest
    pattern: /cxmlSolutions.Guide_Part21[ .]|cxmlSolutions.Guide_Part21$/i,
    tags: ["orderrequest cancel change orderversion", "contact role soldto buyercorporate path routing", "pcard orderrequest subcontracting", "subcontractingcomponent batch buyerbatchid", "productactivitymessage componentconsumptionrequest"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P22: OrderRequest Subcontracting Incoterms EXW FCA FOB, incoTerm extrinsic, Schedule Agreement ReleaseInfo JIT forecast, MasterAgreementIDInfo ShipNoticePortion
    pattern: /cxmlSolutions.Guide_Part22[ .]|cxmlSolutions.Guide_Part22$/i,
    tags: ["subcontracting incoterms exw fca fob", "incoterm extrinsic orderrequest", "schedule agreement releaseinfo jit forecast", "masteragreementidinfo shipnoticeportion"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P23: OrderRequest service line requiresServiceEntry, BlanketItemDetail MaxAmount ExpectedUnplanned MaximumUnplanned, ServicePeriod GenericServiceCategory, SpendDetail extLineNumber, multi-level hierarchy composite itemType
    pattern: /cxmlSolutions.Guide_Part23[ .]|cxmlSolutions.Guide_Part23$/i,
    tags: ["service line requiresserviceentry po", "blanketitemdetail maxamount expectedunplanned", "serviceperiod genericservicecategory", "spenddetail extlinenumber", "multi-level hierarchy composite itemtype"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P24: ConfirmationRequest ConfirmationHeader ConfirmationItem ConfirmationStatus, BlanketOrderStatusUpdateRequest, StatusUpdateRequest, OrderStatusRequest, accept/reject/backordered/allDetail, incoTerm
    pattern: /cxmlSolutions.Guide_Part24[ .]|cxmlSolutions.Guide_Part24$/i,
    tags: ["confirmationrequest confirmationheader confirmationitem", "confirmationstatus accept reject backordered", "confirmationstatus alldetail incoterm", "blanketorderstatusupdaterequest statusupdaterequest", "orderstatusrequest order confirmation cxml solutions"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P25: ConfirmationRequest allDetail operation new/update, DocumentReference, OrderStatusRequest, OrderStatusRequestItem, enhanced order confirmation integration
    pattern: /cxmlSolutions.Guide_Part25[ .]|cxmlSolutions.Guide_Part25$/i,
    tags: ["confirmationrequest alldetail operation", "documentreference confirmationrequest", "orderstatusrequest orderstatusrequestitem", "enhanced order confirmation cxml", "shipnoticerequest payloadid restriction", "shipnoticerequest cancel change order restriction"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P26: ShipNoticeRequest ShipNoticeHeader ShipControl ShipNoticePortion ShipNoticeItem, carrier tracking, AssetInfo serialNumber, TermsOfDelivery, ServiceEntryRequest ServiceEntryID, PartnerContact, service sheet, QuoteRequestHeader
    pattern: /cxmlSolutions.Guide_Part26[ .]|cxmlSolutions.Guide_Part26$/i,
    tags: ["shipnoticerequest shipnoticeheader shipcontrol", "shipnoticeportion shipnoticeitem carrier tracking", "assetinfo serialnumber ship notice", "serviceentryrequest serviceentryid", "partnercontact service sheet cxml", "quoterequestheader service sheet"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P27: QuoteRequest QuoteRequestHeader QuoteItemOut, SupplierSelector SupplierInvitation matchingType, serviceLineType itemClassification, service hierarchy, ReferenceDocumentInfo, QuoteMessage QuoteMessageHeader QuoteItemIn, award
    pattern: /cxmlSolutions.Guide_Part27[ .]|cxmlSolutions.Guide_Part27$/i,
    tags: ["quoterequest quoteitemout supplierselector", "supplierinvitation matchingtype invitationonly", "servicelinetype itemclassification quoterequest", "quotemessage quotemessageheader quoteitemin", "award quoterequestreference"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P28: QuoteMessage QuoteItemIn PricingConditions ValidityPeriods ConditionType Scales, award, QuoteRequestReference, Quote Automation processingTarget, SAP Business Network Discovery sourcing
    pattern: /cxmlSolutions.Guide_Part28[ .]|cxmlSolutions.Guide_Part28$/i,
    tags: ["quotemessage quoteitemin pricingconditions", "validityperiods conditiontype scales award", "quote automation processingtarget", "sap business network discovery sourcing", "quoterequesstreference award rfq"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P29: InvoiceDetailRequest InvoiceDetailRequestHeader, PO matching invoicing business rules, eSignature digital signature, invoiceSubmissionMethod, ICS invoice, invoiceSourceDocument, IdReference bankRoutingID accountID
    pattern: /cxmlSolutions.Guide_Part29[ .]|cxmlSolutions.Guide_Part29$/i,
    tags: ["invoicedetailrequest invoicedetailrequestheader", "invoice po matching business rules", "esignature digital signature invoice", "invoicesubmissionmethod ics invoice", "invoicesourcedocument idreference bankroutingid"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P30: InvoiceDetailRequest InvoicePartner remitTo ACH wire transfer swiftID ibanID creditorRefID, Contact role billTo shipFrom, SerialNumber, PaymentTerm, ServiceEntryItemReference, goods receipt inspectionDate, ShipNoticeIDInfo
    pattern: /cxmlSolutions.Guide_Part30[ .]|cxmlSolutions.Guide_Part30$/i,
    tags: ["invoicepartner remitto ach wire transfer", "swiftid ibanid creditorrefiid invoice", "contact role billto shipfrom invoice", "serialnumber paymentterm invoice", "serviceentryitemreference inspectiondate", "shipnoticeidinfo invoice"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P31: InvoiceDetailItem compositeItemType groupLevel itemLevel, parentInvoiceLineNumber, Tolerances TaxDetail shippingTax specialHandlingTax, InvoiceDetailLineShipping InvoiceDetailLineSpecialHandling
    pattern: /cxmlSolutions.Guide_Part31[ .]|cxmlSolutions.Guide_Part31$/i,
    tags: ["invoicedetailitem compositeitemtype grouplevel", "parentinvoicelinenumber itemlevel invoice", "tolerances taxdetail invoice line", "shippingtax specialhandlingtax invoice", "invoicedetaillineshipping invoicedetaillinespecialhandling"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P32: InvoiceHeaderModifications InvoiceItemModifications, AdditionalDeduction AdditionalCost ModificationDetail, TotalCharges TotalAllowances TotalAmountWithoutTax, InvoiceDetailDiscount allowances charges
    pattern: /cxmlSolutions.Guide_Part32[ .]|cxmlSolutions.Guide_Part32$/i,
    tags: ["invoiceheadermodifications invoiceitemmodifications", "additionaldeduction additionalcost modificationdetail", "totalcharges totalallowances totalamountwithouttax", "invoicedetaildiscount allowances charges"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P33: Modification ModificationDetail, French parafiscal tax, withholdingTax TaxDetail withholdingTax, Mandatory VAT taxPointDate, exemptDetail zero-rate VAT, buyerVatID supplierVatID
    pattern: /cxmlSolutions.Guide_Part33[ .]|cxmlSolutions.Guide_Part33$/i,
    tags: ["modificationdetail french parafiscal tax", "withholdingtax taxdetail invoice", "mandatory vat taxpointdate invoice", "exemptdetail zero-rate vat", "buyervatid suppliervatid invoice"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P34: Mexico invoice CFDI TaxRegime Municipality, billFrom paymentMethod invoiceType, withholdingTaxType ISR IVA, TaxInvoice invoiceSourceDocument country-specific invoice
    pattern: /cxmlSolutions.Guide_Part34[ .]|cxmlSolutions.Guide_Part34$/i,
    tags: ["mexico invoice cfdi taxregime municipality", "billfrom paymentmethod invoicetype", "withholdingtaxtype isr iva mexico", "taxinvoice invoicesourcedocument", "country-specific invoice cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P35: Brazil NFe CTe NFS-e SEFAZ, externalInvoiceNumber protocolNumber digitalSignatureValue, Hungary invoice isAutoflip ERS self-billing, PDF invoice copy invoicePDF field lengths
    pattern: /cxmlSolutions.Guide_Part35[ .]|cxmlSolutions.Guide_Part35$/i,
    tags: ["brazil nfe cte nfse sefaz", "externalinvoicenumber protocoluumber digitalsignaturevalue", "hungary invoice isautoflip", "ers self-billing pdf invoice invoicepdf", "field lengths country invoice"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P36: Invoice example, summary invoice, multi-PO invoice, InvoiceDetailOrder InvoiceDetailSummary, Distribution AccountingSegment, PaymentTerm SerialNumber, InvoiceDetailShipping GrossAmount NetAmount DueAmount
    pattern: /cxmlSolutions.Guide_Part36[ .]|cxmlSolutions.Guide_Part36$/i,
    tags: ["invoice example summary multi-po", "invoicedetailorder invoicedetailsummary", "distribution accountingsegment invoice example", "paymentterm serialnumber invoice", "invoicedetailshipping grossamount netamount dueamount"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P37: Credit memo debit memo cancel invoice operation delete, creditMemo debitMemo, PaymentProposalRequest EFT payment, Discount Management immediatepay earlyPaymentDiscount paymentTermCode
    pattern: /cxmlSolutions.Guide_Part37[ .]|cxmlSolutions.Guide_Part37$/i,
    tags: ["credit memo debit memo invoice cxml", "cancel invoice operation delete cxml", "paymentproposalrequest eft payment", "discount management immediatepay earlyPaymentDiscount", "paymenttermcode invoice cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P38: PaymentProposalRequest paymentTermCode TaxAdjustment TaxAdjustmentDetail isNetworkPayment, ReceiptRequest ReceiptRequestHeader ReceiptOrder ReceiptItem ReceiptItemReference AssetInfo, CatalogUploadRequest
    pattern: /cxmlSolutions.Guide_Part38[ .]|cxmlSolutions.Guide_Part38$/i,
    tags: ["paymentproposalrequest paymenttermcode taxadjustment", "taxadjustmentdetail isnetworkpayment", "receiptrequest receiptrequestheader receiptorder", "receiptitem receiptitemreference assetinfo", "cataloguploadrequest cxml solutions"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P39: CatalogUploadRequest CatalogName AutoPublish Notification URLPost MIME attachment, CIF catalog BMEcat, UNSPSC catalog upload, StatusUpdateRequest catalog
    pattern: /cxmlSolutions.Guide_Part39[ .]|cxmlSolutions.Guide_Part39$/i,
    tags: ["cataloguploadrequest catalogname autopublish", "notification urlpost mime attachment catalog", "cif catalog bmecats unspsc", "catalog upload statusupdaterequest"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P40: TradeRequest TradeRequestHeader TradeRequestSummary TradeItem SCF supply chain financing, PrimeRevenue, GetPendingRequest GetPendingResponse DataRequest DataResponse DataAvailableMessage polling
    pattern: /cxmlSolutions.Guide_Part40[ .]|cxmlSolutions.Guide_Part40$/i,
    tags: ["traderequest traderequestheader traderequestsummary", "tradeitem scf supply chain financing", "primerevenue scf cxml", "getpendingrequest getpendingresponse datarequest", "dataresponse dataavailablemessage polling"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P41: GetPendingRequest DataRequest DataResponse, Supply Chain Network ProductActivityMessage, ProductActivityHeader ConsignmentInventory ConsignmentMovement, ProductActivityDetails Forecast Commit, ContractRequest ContractRequestHeader
    pattern: /cxmlSolutions.Guide_Part41[ .]|cxmlSolutions.Guide_Part41$/i,
    tags: ["getpendingrequest datarequest dataresponse", "supply chain network productactivitymessage", "productactivityheader consignmentinventory", "consignmentmovement productactivitydetails forecast", "contractrequest contractrequestheader cxml solutions"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P42: ContractRequest ContractRequestHeader ContractItemIn ContractStatusUpdateRequest ContractStatus ContractIDInfo, AerospaceAndDefense DPAS PricingConditions, cXML Transformations Mapping Extrinsics EDI transformation
    pattern: /cxmlSolutions.Guide_Part42[ .]|cxmlSolutions.Guide_Part42$/i,
    tags: ["contractrequest contractitemin contractstatusupdaterequest", "contractstatus contractidinfo aerospaceandefense dpas", "pricingconditions contractrequest cxml", "cxml transformations mapping extrinsics", "edi transformation cxml extrinsic mapping"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P43: UNSPSC commodity codes, ISO 4217 currency codes, UNUOM unit of measure, UN/CEFACT, ISO 3166 country/state codes, language codes, dialing codes ITU E.164 coding systems
    pattern: /cxmlSolutions.Guide_Part43[ .]|cxmlSolutions.Guide_Part43$/i,
    tags: ["unspsc commodity codes cxml", "iso 4217 currency codes cxml", "unuom unit of measure un/cefact", "iso 3166 country state codes", "language codes dialing codes itu e.164", "coding systems reference cxml"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  // ── cXML Getting Started Guide (7 parts, timestamped) ────────────────────
  {
    // P1: license + intro to cXML capabilities (DTD structure, PunchOut, PO, catalog), Profile transaction, MAC/digital signature overview, revision history
    pattern: /cXMLGettingStarted_Part1[ .]|cXMLGettingStarted_Part1$/i,
    tags: ["cxml license agreement", "xml dtd definition", "punchout catalog protocol", "catalog product content", "purchase order communication", "profile transaction capabilities", "message authentication code", "digital signature signing", "authrequest authresponse", "cxml revision history"],
    excludeTags: ["carrier", "freight", "iata", "gtt", "fc"],
  },
  {
    // P2: PunchOut chaining/routing, content delivery strategy, DTD caching, request-response vs one-way model, cXML document/envelope structure, MIME attachments, CatalogUploadRequest example
    pattern: /cXMLGettingStarted_Part2[ .]|cXMLGettingStarted_Part2$/i,
    tags: ["punchout chaining routing", "order receiving system", "dtd caching local", "profilerequest profileresponse", "request response http model", "cxml document structure", "mime multipart attachment", "cxml envelope payloadid", "utf-8 charset encoding", "cataloguploadrequest attachment"],
    excludeTags: ["carrier", "freight", "iata", "gtt", "fc"],
  },
  {
    // P3: MIME attachment examples (CopyRequest/cXMLAttachment), cXML envelope attributes (payloadID, timestamp, xml:lang), special character encoding, Header element (From/To/Sender, Credential, SharedSecret, CredentialMac)
    pattern: /cXMLGettingStarted_Part3[ .]|cXMLGettingStarted_Part3$/i,
    tags: ["cxmlattachment copyrequest mime example", "payloadid timestamp attribute", "iso 8601 timestamp format", "special character xml encoding", "header from to sender", "credential domain sharedsecret", "credentialmac hmac-sha1-96", "aribanetworkuserid networkid", "multiple credentials validation"],
    excludeTags: ["carrier", "freight", "iata", "gtt", "fc"],
  },
  {
    // P4: Correspondent/Routing element, PEPPOL routing, Request/Response elements, Status code table (2xx/4xx/5xx), one-way async model, URL-Form-Encoding transport (BrowserFormPost, GetPendingRequest)
    pattern: /cXMLGettingStarted_Part4[ .]|cXMLGettingStarted_Part4$/i,
    tags: ["correspondent routing element", "peppol destination routing", "request deploymentmode attribute", "status code 200 400 500", "catalog upload status codes", "one-way asynchronous message", "punchoutordermessage transport", "browserformpost url encoding", "cxml-urlencoded base64 field", "getpendingrequest http pull"],
    excludeTags: ["carrier", "freight", "iata", "gtt", "fc"],
  },
  {
    // P5: HTML Form POST transport, cXML-base64/cXML-urlencoded variables, Service Status Response, HTTP GET ping, UnitOfMeasure UN/CEFACT, Money element/ISO 4217 currency, MAC HMAC-SHA1-96, CredentialMac, Auth Transaction
    pattern: /cXMLGettingStarted_Part5[ .]|cXMLGettingStarted_Part5$/i,
    tags: ["html form post transport", "cxml-base64 encoding variable", "service status response http get", "unitofmeasure un cefact code", "money element iso 4217 currency", "mac hmac-sha1-96 authentication", "credentialmac element fields", "mac creation expiration date", "auth transaction authrequest"],
    excludeTags: ["carrier", "freight", "iata", "gtt", "fc"],
  },
  {
    // P6: X.509 certificate auth, W3C XML digital signature, XAdES qualifying properties, ds:Signature element, cXMLSignedInfo payloadID, signing attachments manifest, ds:Reference URI, signature error status codes
    pattern: /cXMLGettingStarted_Part6[ .]|cXMLGettingStarted_Part6$/i,
    tags: ["authresponse expirationdate caching", "x509 certificate elements", "w3c xml digital signature", "xades qualifying properties", "ds signature element structure", "cxmlsignedinfo payloadid", "signing attachments manifest", "ds reference uri fragment", "signature error status codes", "certificate revocation list"],
    excludeTags: ["carrier", "freight", "iata", "gtt", "fc"],
  },
  {
    // P7: Revision history tail — no substantive content
    pattern: /cXMLGettingStarted_Part7[ .]|cXMLGettingStarted_Part7$/i,
    tags: ["cxml revision history changelog"],
    excludeTags: ["carrier", "freight", "iata", "gtt", "fc"],
  },
  {
    // Non-timestamped fallback (merged docKey)
    pattern: /cXMLGettingStarted/i,
    tags: ["cxml dtd punchout catalog", "mime multipart attachment cxml", "credential sharedsecret header", "hmac-sha1-96 mac authentication", "status code request response", "digital signature x509 certificate", "browserformpost punchoutordermessage"],
    excludeTags: ["carrier", "freight", "iata", "gtt", "fc"],
  },

  // ── Buyer Admin guides ─────────────────────────────────────────────────────
  // ── BuyerAdminGuide including Rules (NON-BTP, 47 parts) ──────────────────
  {
    // Part1: Full TOC (500+ pages) — covers all chapters: buyer overview, order lifecycle, SCF, admin responsibilities, UI overview, company profile, configuration, locale/timezone, cXML setup, notifications, data deletion, transaction rules, reports, document management
    pattern: /BuyerAdminGuide including Rules_Part1[ .]|BuyerAdminGuide including Rules_Part1$/i,
    tags: [
      "buyer admin guide toc sbn",
      "sbn buyer administration overview",
      "order life cycle sbn buyer",
      "supply chain finance buyer",
      "invoice conversion po line level mapping",
      "buyer account administrator responsibilities",
      "sbn buyer ui home page menu bar",
      "company profile buyer sbn",
      "cxml setup buyer configuration",
      "notifications buyer setup",
      "data deletion criteria buyer",
      "transaction rules buyer overview",
      "supplier order routing methods",
      "suspended supplier accounts",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part2: Supplier service and subscription management (status/cancel/renew/credit card), SBN technical infrastructure (availability/failover/communication), cXML routing/fax/email/online routing, supplier registration duplicate check
    pattern: /BuyerAdminGuide including Rules_Part2[ .]|BuyerAdminGuide including Rules_Part2$/i,
    tags: [
      "supplier service subscription management",
      "subscription expiration renewal auto-renewal",
      "credit card management sbn buyer",
      "sbn technical infrastructure availability failover",
      "sbn physical location data center",
      "cxml routing fax email routing",
      "online order routing sbn",
      "supplier registration duplicate account check",
      "duplicate account check flow sbn",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part3: Supply chain finance SCF (early payment, third party financing, DPO), buyer company profile (DUNS/address/business type/logo/main contact), discovery posting visibility, profile data federation
    pattern: /BuyerAdminGuide including Rules_Part3[ .]|BuyerAdminGuide including Rules_Part3$/i,
    tags: [
      "supply chain finance scf early payment",
      "third party financing dpo accounts payable",
      "buyer company profile sbn",
      "company duns number address business type",
      "upload company logo buyer",
      "edit main contact buyer profile",
      "hide company profile discovery postings",
      "profile data federation sbn",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part4: Profile data federation (how it works, enabling, global data centers, one-time sync), SBN Configuration page (cXML setup, shared secret, certificate auth, download endpoints for ConfirmationRequest/ShipNoticeRequest/InvoiceDetailRequest/StatusUpdateRequest), notifications for buyers
    pattern: /BuyerAdminGuide including Rules_Part4[ .]|BuyerAdminGuide including Rules_Part4$/i,
    tags: [
      "profile data federation enable replication",
      "global data centers sbn profile sync",
      "sbn configuration page buyer",
      "cxml setup shared secret certificate buyer",
      "buyer cxml authentication method",
      "download endpoints confirmationrequest shipnoticerequest",
      "invoicedetailrequest statusupdaterequest download",
      "notifications buyer configuration page",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part5: Notification email addresses setup, notification types (order/invoice/catalog/rfq/payment/supplier registration/service sheet), data deletion criteria (retention period, document set, one-time deletion, deletion restrictions)
    pattern: /BuyerAdminGuide including Rules_Part5[ .]|BuyerAdminGuide including Rules_Part5$/i,
    tags: [
      "notification email addresses buyer sbn",
      "notification types buyer order invoice catalog",
      "rfq payment supplier registration notifications",
      "service sheet notification buyer",
      "data deletion criteria buyer sbn",
      "transaction document retention period",
      "document set deletion sequence",
      "one-time deletion buyer data",
      "data deletion restrictions buyer",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part6: Data deletion cancel/download, transaction rules overview, payment batch rules, PO rules, blanket PO rules, scheduling agreement release rules
    pattern: /BuyerAdminGuide including Rules_Part6[ .]|BuyerAdminGuide including Rules_Part6$/i,
    tags: [
      "cancel data deletion request", "download zip deleted transactions",
      "default transaction rules overview", "allow vs require rules",
      "payment batch transmission rules", "hold payments daily cut-off time",
      "cancelled payment transactions report",
      "purchase order rules", "allow change orders fully shipped",
      "allow change orders partially shipped",
      "retain confirmation status change orders",
      "allow cancel orders fully shipped", "allow cancel orders partially shipped",
      "prevent duplicate purchase orders", "override supplier routing method",
      "blanket purchase order rules", "expired blanket purchase order",
      "add child item blanket po invoice",
      "scheduling agreement release setup rules", "jit forecast shipping restriction",
      "ariba buyer contracts site setup rules", "collaborative invoicing contracts",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part7: Scheduling agreement release, attachment rules, quick enablement, OC/SN rules (reminders, OC before SN, delivery dates, non-PO ship notices, unique serial number)
    pattern: /BuyerAdminGuide including Rules_Part7[ .]|BuyerAdminGuide including Rules_Part7$/i,
    tags: [
      "scheduling agreement release concepts",
      "attachment file extension rules", "allow all attachment file extensions",
      "attachment filename character restriction",
      "quick enablement sap business network suppliers",
      "non-po invoice customer code unregistered supplier",
      "allow order confirmations material orders",
      "order confirmations line item level", "reject quantities line item order confirmation",
      "order confirmations service orders", "confirm order multiple times",
      "automatic reminder unconfirmed orders",
      "automatic reminder non-shipped items", "automatic reminder non-received items",
      "require fully confirm line items before fulfillment",
      "require order confirmation before ship notice",
      "require delivery dates order confirmations ship notices",
      "require estimated shipping date order confirmations",
      "require ship notice type",
      "allow delivery transport information ship notices",
      "non-po ship notices cxml",
      "unique asset serial number ship notice",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part8: Ship notice rules (packing slip, SSCC, multi-ship-to, delivery date tolerances), OC tolerances (quantity/price/subtotal/delivery date), control keys, tolerance hierarchy
    pattern: /BuyerAdminGuide including Rules_Part8[ .]|BuyerAdminGuide including Rules_Part8$/i,
    tags: [
      "do not allow multiple delivery dates ship notice",
      "packing slip id unique ship notices",
      "auto invoice number from packing slip id",
      "sscc serial shipping container code validation",
      "do not allow multiple ship to addresses",
      "recalculation shipment due quantity goods receipts",
      "apply delivery date tolerances ship notice line items",
      "enforce control keys entitlement",
      "allow suppliers increase item quantities order confirmations",
      "apply line item quantity tolerance order confirmations",
      "underdelivery overdelivery percentage order confirmation",
      "apply line item unit price tolerance order confirmations",
      "apply line item subtotal amount tolerance order confirmations",
      "advanced pricing details price unit quantity",
      "apply line item delivery date tolerance order confirmations",
      "require comment order confirmation line item changes",
      "allow change advanced pricing details order confirmations",
      "require rejection reason reject order", "require confirm item sets child-line",
      "allow change supplier part id auxiliary part id",
      "allow cancel ship notices", "allow edit existing ship notices",
      "order confirmation ship notice control keys",
      "ocinstruction notallowed asninstruction notallowed",
      "tolerance hierarchy quantity delivery date unit price",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part9: Tolerance hierarchy cont., delivery date tolerance procedures, service sheet rules (full list)
    pattern: /BuyerAdminGuide including Rules_Part9[ .]|BuyerAdminGuide including Rules_Part9$/i,
    tags: [
      "tolerance hierarchy cxml line item header",
      "unit price currency tolerance dependency",
      "setting delivery date tolerance ship notices all suppliers",
      "setting delivery date tolerance ship notices supplier groups",
      "service sheet rules",
      "require start end dates service sheets",
      "do not allow service sheets in progress",
      "require order confirmation before service sheet",
      "require approver information service sheets",
      "allow service sheet attachments",
      "allow ad hoc line items service sheets",
      "allow change units of measure service sheets",
      "allow increase item quantities service sheets",
      "allow change unit prices service sheets",
      "allow multiple service sheets amount-based service item",
      "allow reuse service sheet numbers rejected failed",
      "require account assignment information service sheets",
      "allow correction service sheets invoiced",
      "allow final service entry sheet indicator",
      "allow cancel service sheets",
      "do not allow manually create service entry sheets",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part10: Proof of service, SAP FSM, invoice rules overview, invoice archiving, long-term tax invoice archiving, sales order rule, DUNS rule, work order information, quality collaboration rules, manage transaction rules download/upload
    pattern: /BuyerAdminGuide including Rules_Part10[ .]|BuyerAdminGuide including Rules_Part10$/i,
    tags: [
      "proof of service before service entry sheet",
      "sap field service management proof of service",
      "invoice rules overview enabling invoicing",
      "invoice archiving zip format",
      "invoice archival frequency weekly biweekly monthly",
      "download archived invoices",
      "automatic archive invoice delivery url https",
      "send archived invoice files pending queue",
      "getpendingrequest invoicearchive maxmessages",
      "long-term archiving tax invoices",
      "third party archive providers tax audit",
      "download archived tax invoices",
      "document download status archived invoices",
      "sales order rule allow sales orders",
      "duns number rule supplier registration",
      "work order information workorder id equipment id",
      "quality collaboration rules supply chain",
      "docusign quality inspection electronic signature",
      "manage transaction rules download upload spreadsheet",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part11: Country/region-based invoice rules (full lifecycle), automatic invoice creation from receipts, external tax invoice rules
    pattern: /BuyerAdminGuide including Rules_Part11[ .]|BuyerAdminGuide including Rules_Part11$/i,
    tags: [
      "country region based invoice rules",
      "enablement process country region invoice rules",
      "ignore country-based invoice rules",
      "configuring invoice rules country region",
      "activating deactivating invoice rules country region",
      "preventing suppliers sending invoices selected countries",
      "viewing invoice rule results",
      "downloading country region invoice rules csv",
      "automatic invoice creation from receipts",
      "enable automatic invoice creation receipts rule",
      "require received quantities automatic invoicing",
      "automatic invoice supplier acceptance confirmation",
      "copy tax purchase order standard invoice rule",
      "include allowances charges unit price rule",
      "cxml shipnoticeidinfo receiptrequestheader",
      "external tax invoice rules",
      "allow automatic routing failed external tax invoices",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part12: EFT payment VeriSign, catalog validation preferences, document number preferences (invoice/SES prefix suffix max length), supplier profile customization projects
    pattern: /BuyerAdminGuide including Rules_Part12[ .]|BuyerAdminGuide including Rules_Part12$/i,
    tags: [
      "electronic funds transfer eft payment verisign",
      "catalog validation preferences",
      "unspsc code version conversion",
      "disable commodity code checking",
      "disable unit of measure checking catalog",
      "document number preferences invoices service sheets",
      "document number prefix suffix maximum length",
      "invoice document number special characters",
      "remove suffix auto-generated service sheet",
      "service sheet document number maximum characters",
      "supplier profile customization projects",
      "custom fields invoices ship notices order confirmations",
      "reviewing approving customization projects",
      "customization project publication stages",
      "invoice custom field rules customerpartid",
      "validate custom fields invoice against order",
      "csv invoice upload customization",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part13: Link multiple business applications/system IDs, Bill To addresses, end points integration (single/multiple ERP, guided buying), document routing table, CMS end point, quote automation rules
    pattern: /BuyerAdminGuide including Rules_Part13[ .]|BuyerAdminGuide including Rules_Part13$/i,
    tags: [
      "link multiple business applications system id",
      "create system id business application",
      "multiple bill to addresses system id",
      "end points integration document routing",
      "configure business end points cxml setup",
      "default document routing table",
      "configure document routing per document type",
      "single external erp system end point",
      "multiple erp systems end points",
      "guided buying tactical sourcing integration end points",
      "gbendpoint s4endpoint ariba end point",
      "non-po invoice routing ariba end point",
      "content management system cms end point url",
      "quote automation rules rfq postings",
      "supplier invitation rules product service category",
      "configure supplier invitation default rule",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part14: Audit log tracking transaction rule changes (intelligent configuration manager), currency precision and rounding (rounding modes, override rules)
    pattern: /BuyerAdminGuide including Rules_Part14[ .]|BuyerAdminGuide including Rules_Part14$/i,
    tags: [
      "tracking auditing transaction rule changes",
      "intelligent configuration manager audit log",
      "audit log default transaction rules",
      "audit log country region invoice rules",
      "audit log supplier group transaction rules",
      "searching changes account settings events tab",
      "create audit report account settings",
      "audit report download zip csv",
      "audit report operation defaultrules suppliergrouprules",
      "currency precision and rounding",
      "round half up commercial rounding",
      "round up round down currency",
      "enable currency precision rounding overrides",
      "decimal places unit price currency configuration",
      "override rounding rules tax allowances charges",
      "currency precision per system id",
      "iso standard currency precision",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part15: Customization project workflow (system test, approve, publish), custom field validation rules, ICS invoice rules
    pattern: /BuyerAdminGuide including Rules_Part15[ .]|BuyerAdminGuide including Rules_Part15$/i,
    tags: [
      "customization project system test review approve publish",
      "custom fields cxml fragment review",
      "approve customization project publication",
      "validating custom fields invoices",
      "invoice custom field rules section",
      "allow change line item field po-based invoices",
      "adding custom fields for validation extrinsic",
      "ics invoice rules custom field rules",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part16: Audit logs (classic/BTP), UOM master list upload/enable/disable, analytics activation, decimal/digit separators Peru
    pattern: /BuyerAdminGuide including Rules_Part16[ .]|BuyerAdminGuide including Rules_Part16$/i,
    tags: [
      "audit log management", "btp audit service", "audit report creation",
      "audit event types", "security audit events", "data access audit", "audit log purge",
      "unit of measure csv template", "unit of measure master list",
      "unit of measure upload", "enable disable uom codes",
      "analytics functionality activation",
      "decimal separator preference", "digit group separator",
      "peru locale settings", "organization level separator",
      "classic audit log vs btp audit log",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part17: Personal info update, supplier enablement process, verified business badge, active supplier status, supplier profiles, organizational hierarchy, supplier IDs intro
    pattern: /BuyerAdminGuide including Rules_Part17[ .]|BuyerAdminGuide including Rules_Part17$/i,
    tags: [
      "personal information update", "user name format requirements",
      "password expiration policy", "preferred language setting",
      "supplier enablement process", "supplier enablement initial setup",
      "verified business badge", "active supplier status",
      "dun bradstreet duns verification", "cdq third party verification",
      "supplier basic profile download", "supplier extended profile download",
      "supplier organizational hierarchy", "parent child organization",
      "supplier ids overview", "private supplier account",
      "vendor compound key introduction",
      "trading relationship request",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part18: Multiple unique supplier IDs, configuring/editing/deleting IDs, supplier file CSV fields, supplier ID normalization intro, vendor compound key
    pattern: /BuyerAdminGuide including Rules_Part18[ .]|BuyerAdminGuide including Rules_Part18$/i,
    tags: [
      "multiple unique supplier ids", "supplier id configuration",
      "anid mapping multiple ids", "non-po invoice routing default id",
      "editing unique supplier id", "deleting unique supplier id",
      "upload multiple supplier ids", "supplier file csv format",
      "supplier file fields anid systemid privateid", "isdefault routing field",
      "supplier id normalization", "vendor compound key uniform identification",
      "legacy supplier site keys", "ics invoice conversion services ids",
      "vendor compound key enablement", "backward compatibility legacy vendor id",
      "ssprivateid domain",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part19: Vendor compound key mapping to SAP/PeopleSoft/Oracle, supplier ID normalization workflow, transaction matching order, outbound credential configuration
    pattern: /BuyerAdminGuide including Rules_Part19[ .]|BuyerAdminGuide including Rules_Part19$/i,
    tags: [
      "vendor compound key sap erp mapping",
      "vendor compound key peoplesoft mapping",
      "vendor compound key oracle mapping",
      "vendor id site id site auxiliary id", "send vendorid siteid siteauxid outgoing",
      "supplier id normalization workflow",
      "matching enabled suppliers quick enablement",
      "ssprivateid privateid domain routing",
      "transaction matching order anid",
      "configuring supplier id normalization",
      "supplier credential cxml outbound",
      "document routing failure vendor key",
      "id conflict handling sap business network",
      "supplier id normalization on sap ariba procurement",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part20: Converting vendor IDs manually/CSV, integrating with SAP ERP and Oracle (Fusion Middleware), ID conflicts troubleshooting, correcting legacy vendor IDs, supplier relationships overview
    pattern: /BuyerAdminGuide including Rules_Part20[ .]|BuyerAdminGuide including Rules_Part20$/i,
    tags: [
      "manual vendor id conversion", "mass convert vendor ids csv",
      "vendor data export report conversion",
      "sap erp vendor id integration",
      "oracle fusion middleware vendor site id",
      "value map table adapter configuration",
      "supplier id normalization troubleshooting",
      "transaction routing failure check",
      "id conflict vendor compound key",
      "legacy vendor id conflict resolution",
      "missing supplier network id conflict",
      "correcting legacy vendor ids",
      "supplier relationships active relationships page",
      "override transaction rules per supplier",
      "terminating supplier relationships",
      "resend invitation private supplier",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part21: Override rules per supplier, terminate relationships, create supplier groups, modify groups, assign suppliers, invoice rules by supplier group
    pattern: /BuyerAdminGuide including Rules_Part21[ .]|BuyerAdminGuide including Rules_Part21$/i,
    tags: [
      "override transaction rules per supplier",
      "enable invoice rules per supplier",
      "catalog validation override per supplier",
      "terminate active supplier relationship",
      "creating supplier group",
      "supplier group customization project",
      "supplier group invoice rules",
      "supplier group discount management",
      "supplier group custom pdf layout",
      "modifying supplier group members",
      "add remove supplier group members",
      "assign supplier to supplier group",
      "vendor csv upload supplier group assignment",
      "configuring invoice rules by supplier group",
      "ics group invoice conversion service",
      "deactivating supplier groups",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part22: Deactivate/reactivate supplier groups, custom routing method, commodity/territory bulk upload, supplier contacts, custom PDF layouts, barcode labels
    pattern: /BuyerAdminGuide including Rules_Part22[ .]|BuyerAdminGuide including Rules_Part22$/i,
    tags: [
      "deactivate supplier group", "hide deactivated supplier group",
      "reactivate supplier group",
      "custom routing method non-sap b2b",
      "commodity sales territory bulk upload",
      "unspsc vendor profile upload",
      "supplier contacts management", "contact personnel pool",
      "companywide contact types", "custom contact type creation",
      "custom pdf layout orders", "xsl-fo stylesheet custom pdf",
      "ship notice barcode labels", "barcode label layout supplier group",
      "code 128 gs1-128 barcode", "pdf417 datamatrix barcode",
      "custom pdf quality inspections",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part23: Application gateway SSO, SSO CSV upload, report management, report templates, canceled payment reports, collaboration type status reports
    pattern: /BuyerAdminGuide including Rules_Part23[ .]|BuyerAdminGuide including Rules_Part23$/i,
    tags: [
      "application gateway supplier sso",
      "saml 2.0 identity provider sap business network",
      "sso service subscription csv upload",
      "third-party application gateway widget",
      "report management buyer account", "report template creation",
      "scheduled report vs manual report",
      "report queue processing status", "maximum 100 reports 20 scheduled",
      "canceled payment transactions report",
      "collaboration type status report",
      "supplier enablement collaboration type",
      "report template criteria parameters",
      "report timezone language settings",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part24: Daily payment summary, discount metrics/acceptance/early payment limit, failed dynamic discounting credit memo, failed invoice/external invoice/order reports, goods receipt reports
    pattern: /BuyerAdminGuide including Rules_Part24[ .]|BuyerAdminGuide including Rules_Part24$/i,
    tags: [
      "daily payment summary report",
      "discount metrics reports types",
      "discount volumes aggregate detail report",
      "discount metrics monthly 12-month rolling",
      "discount acceptance report fields",
      "sliding scale early payment terms",
      "early payment limit report",
      "monthly payment limit per currency",
      "failed dynamic discounting credit memo report",
      "credit memo generation failure reason",
      "failed invoice report rejection reasons",
      "failed external invoice report fattura pa cfdi",
      "failed order report routing failure reason",
      "goods receipt report fields",
      "ordered received invoiced rejected quantity",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part25: Invoice report, open orders (schedule lines, BPO), order/order summary reports, organization profile, payment transactions, SCF trade details, service sheet, proof of service reports
    pattern: /BuyerAdminGuide including Rules_Part25[ .]|BuyerAdminGuide including Rules_Part25$/i,
    tags: [
      "invoice report criteria fields", "invoice routing status fulfillment status",
      "open orders report criteria", "open orders 70000 lines maximum",
      "open orders schedule line level", "open orders oc additional information",
      "blanket po open orders report",
      "order reports blanket purchase order",
      "order summary report procurement activity",
      "bloomberg exchange rate currency conversion",
      "organization profile report csv",
      "payment transactions report status",
      "scf trade details primrevenue",
      "service sheet report routing status",
      "proof of service report buyer",
      "pos status approved rejected pending",
      "contract number extrinsic report",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part26: Service sheet activity log, ship notice report (schedule lines), supplier enablement status, task status report, supplier membership status (suspension/payment status)
    pattern: /BuyerAdminGuide including Rules_Part26[ .]|BuyerAdminGuide including Rules_Part26$/i,
    tags: [
      "service sheet activity log report",
      "service sheet line item detail",
      "lean service limit service item type",
      "ship notice report criteria fields",
      "ship notice schedule line reference",
      "ship notice completion status receipt status",
      "country of origin ship notice report",
      "packing slip id tracking number carrier report",
      "supplier enablement status report fields",
      "vendor wave collaboration status",
      "supplier enablement task status report",
      "task failure reason date due completed",
      "supplier membership status report",
      "non-payment status approaching suspension",
      "invoice payment status not paid paid",
      "active promise to pay active dispute",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part27: Supplier profile/account history/legal profile/remittance/tax book/vendor data export/messaging reports, generate/download reports, SAP Analytics Cloud
    pattern: /BuyerAdminGuide including Rules_Part27[ .]|BuyerAdminGuide including Rules_Part27$/i,
    tags: [
      "supplier profile report types",
      "account history report fields",
      "supplier registration method values",
      "ariba network status values",
      "order routing type cxml edi fax email",
      "supplier legal profile status report",
      "hungary india italy singapore legal profile",
      "clearance model tax invoice",
      "supplier remittance information report",
      "ach payment remittance tracking",
      "tax book report vat fields intra eu cross border",
      "vendor data export report csv",
      "messaging report buyer supplier conversation",
      "generate download reports queue processed",
      "data analytics sap analytics cloud",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part28: Predefined analytics stories (PO Overview, Invoice Overview, Transactions, Delivery Execution KPIs), users and roles overview, predefined roles, creating custom roles
    pattern: /BuyerAdminGuide including Rules_Part28[ .]|BuyerAdminGuide including Rules_Part28$/i,
    tags: [
      "purchase orders overview analytics story",
      "invoices overview analytics story",
      "transactions overview analytics story",
      "delivery execution analytics story",
      "perfect delivery kpi calculation",
      "sap analytics cloud predefined stories",
      "buyer roles and permissions overview",
      "administrator role single user",
      "predefined roles full access purchasing manager",
      "vendor manager catalog manager roles",
      "creating custom role permissions",
      "maximum 25 custom roles",
      "user administration permission",
      "supply chain delivery execution metrics",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part29: Modify/delete roles, reassign users to role, create buyer users, best practices, password management, export contact list
    pattern: /BuyerAdminGuide including Rules_Part29[ .]|BuyerAdminGuide including Rules_Part29$/i,
    tags: [
      "modifying role permissions",
      "reassigning users to different role",
      "deleting a role",
      "creating buyer user account",
      "maximum 6000 users buyer account",
      "best practices managing user accounts",
      "password reset forgot password",
      "pcard access password expiry 90 days",
      "unique user name per individual",
      "user creation email notification",
      "export contact list csv",
      "changing user role assignment",
      "individual user account no sharing",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part30: Reassign user sign-in, delete users, transfer admin ownership, mass upload/update users via Excel, SBN permissions list, revoke user access, MFA intro
    pattern: /BuyerAdminGuide including Rules_Part30[ .]|BuyerAdminGuide including Rules_Part30$/i,
    tags: [
      "reassigning user sign in", "deleting buyer user account",
      "transferring administrator ownership",
      "user management capabilities non-admin",
      "mass upload users excel template", "bulk user creation excel",
      "updating users excel template",
      "sap business network permissions list",
      "revoke user access personal information",
      "retention period revoked users",
      "deletion of revoked users",
      "prevention manual sign in buyer users",
      "multifactor authentication mfa buyer",
      "mfa critical fields login requirement",
      "configure mfa settings buyer account",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part31: User password reset, reassign sign-in, delete user, transfer admin, mass Excel upload, permissions table (archive, analytics, catalog, cxml, download, inbox, user admin)
    pattern: /BuyerAdminGuide including Rules_Part31[ .]|BuyerAdminGuide including Rules_Part31$/i,
    tags: [
      "reset user password", "reassign user sign-in",
      "delete user account", "transfer administrator ownership",
      "mass upload users excel template", "500 users excel upload limit",
      "update users excel template",
      "sap business network permissions table",
      "archive access permission", "analytics dashboard access permission",
      "catalog management permission", "cxml configuration permission",
      "download current transactions permission",
      "inbox order access permission", "outbox access permission",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part32: Permissions table cont. (proof of service, test account, transaction configuration), GDPR user data removal workflow, prevent manual SSO sign-in, MFA detailed intro
    pattern: /BuyerAdminGuide including Rules_Part32[ .]|BuyerAdminGuide including Rules_Part32$/i,
    tags: [
      "proof of service approval access permission",
      "proof of service create access permission",
      "test account administration permission",
      "transaction configuration permission",
      "user revocation request workflow",
      "remove personal information buyer user",
      "pseudonymized personal information gdpr",
      "revoked users table export",
      "configure retention period revoked users",
      "prevent manual sign-in sso",
      "disable manual login single sign-on",
      "mfa sap authenticator google authenticator",
      "mfa for critical fields",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part33: MFA configuration (lockout, remember me, QR code setup, new device, reset MFA), Fieldglass onboarding intro
    pattern: /BuyerAdminGuide including Rules_Part33[ .]|BuyerAdminGuide including Rules_Part33$/i,
    tags: [
      "enable multifactor authentication sign in",
      "configure mfa settings", "time allowed to skip mfa setup",
      "invalid mfa attempts lockout",
      "retry period locked out users", "remember me mfa option",
      "manage multifactor authentication users",
      "reset multifactor authentication",
      "send mfa email reminder", "unlock mfa locked user",
      "set up mfa buyer user qr code", "setup mfa new device reset",
      "sap fieldglass supplier onboarding sbn",
      "fieldglass onboarding service permission",
      "allow multiple private ids per supplier",
      "fieldglass scim api role",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part34: Fieldglass-SBN onboarding workflows, SSO Fieldglass-SBN, SAP Ariba Buying Fieldglass integration, trading partner search, network catalog product discovery
    pattern: /BuyerAdminGuide including Rules_Part34[ .]|BuyerAdminGuide including Rules_Part34$/i,
    tags: [
      "onboard sbn supplier on fieldglass",
      "fieldglass buyer relationship establishment",
      "configure fieldglass routing url",
      "fieldglass id fgid buyer profile",
      "single sign-on sbn fieldglass sso",
      "view service orders fieldglass statement of work",
      "trading partner search homepage",
      "verified business icon trading partner",
      "request for information rfi trading partner",
      "supplier network catalog product discovery",
      "check price request network catalog",
      "sap business network discovery posting check price",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part35: Customer catalog download/subscribe/view, payments overview, ACH pre-notification (pre-note), supplier remittance report, ACH EDI 820
    pattern: /BuyerAdminGuide including Rules_Part35[ .]|BuyerAdminGuide including Rules_Part35$/i,
    tags: [
      "download supplier customer catalog",
      "subscribe public catalog", "catalog interchange format cif cxml",
      "search customer catalogs", "view customer catalog contents",
      "sap ariba payables solution",
      "ach payment workflow", "card payment single-use virtual card",
      "supply chain finance discounting",
      "remittance delivery supplier portal email edi cxml",
      "ach pre-notification pre-note zero dollar",
      "notification of change noc bank",
      "batching pre-notes edi 820",
      "bank holiday calendar transmission cutoff",
      "ach pre-note status verified unverified verifying incorrect",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part36: Payment process control points, payment capability US/Canada/Germany, AribaPay Merchant ID, CTX payment format, payment capability workflow
    pattern: /BuyerAdminGuide including Rules_Part36[ .]|BuyerAdminGuide including Rules_Part36$/i,
    tags: [
      "payment process control points diagram",
      "automatic rejection duplicate batch",
      "ach payment nacha rules",
      "payment capability us canada germany",
      "aribapay merchant id supplier enablement",
      "ctx payment format addenda remittance",
      "ccd ccd plus payment format",
      "payment capability workflow high level steps",
      "payment capability canada cad",
      "payment capability germany sepa eur",
      "payment batches 7pm est cutoff settlement",
      "multiple bank accounts aribapay",
      "ariba payment professional ach",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part37: Card payment (virtual card), check payment, ACH setup/configuration fields, ACH batch rules, payment method mapping
    pattern: /BuyerAdminGuide including Rules_Part37[ .]|BuyerAdminGuide including Rules_Part37$/i,
    tags: [
      "card payment virtual card single-use pin",
      "check payment salt lake city printed mailed",
      "check payment workflow buyer supplier bank",
      "map payment method identifier check",
      "before configure payment checklist",
      "cloud integration gateway setup payment",
      "set up ach payment", "activate ach payment method",
      "view ach payment configuration",
      "originating bank account type company identification",
      "ach payment batch rules",
      "reject payment batch remittance mismatch",
      "hold payments until daily cutoff rule",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part38: Payment batches (status levels, forced transmission), remittance advice routing/document status levels, payment progress
    pattern: /BuyerAdminGuide including Rules_Part38[ .]|BuyerAdminGuide including Rules_Part38$/i,
    tags: [
      "payment batches maximum 20000 payment lines",
      "view payment batch files",
      "payment batch status pending transmitted voided partially voided incomplete canceled",
      "forced payment batch transmission",
      "partially voided batch transmit void",
      "remittance advice documents overview",
      "cxml remittance advice header attachments",
      "remittance routing status queued sent forwarding acknowledged failed",
      "remittance document status processing paid failed rejected canceled",
      "payment progress status received sent accepted funds withdrawn funds sent",
      "view remittances sap business network",
      "payment batch files ariba invoice management",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part39: Resend failed remittance, NACHA failure codes, cancel payments, hold payment batches, supplier payment collaboration/enablement for payments
    pattern: /BuyerAdminGuide including Rules_Part39[ .]|BuyerAdminGuide including Rules_Part39$/i,
    tags: [
      "resend failed remittance",
      "nacha failure codes r01 r02 r03 r04",
      "insufficient funds account closed invalid account number",
      "remittance advice history routing status",
      "suppliers view payments sbn",
      "supplier remittance bank account configuration",
      "private suppliers remittance processing",
      "aribapay activity supplier enrollment",
      "cancel payment batch before cutoff",
      "cancel payments within payment batch reason",
      "hold payment batches daily cutoff time",
      "force transmission held payment batch",
      "canceled payment transactions daily report csv",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part40: Proof of Service overview, personas, workflows, PoS API, PoS reports, SAP FSM integration — subrules
    pattern: /BuyerAdminGuide including Rules_Part40[ .]|BuyerAdminGuide including Rules_Part40$/i,
    tags: [
      "proof of service digital document service order completion",
      "proof of service service line item only",
      "proof of service roles permissions five",
      "pos assigner supervisor approver contractor",
      "proof of service workflow contractor creates pos",
      "proof of service api buyers approve reject update",
      "proof of service reports start date end date status",
      "proof of service using sap field service management",
      "service call fsm proof of service",
      "sap field service management technician mobile",
      "default transaction subrule require proof of service ses",
      "require pos before submitting service entry sheet ses",
      "allow suppliers create proof of service fsm subrule",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part41: FSM single-tenant crowd architecture, FSM integration configuration (API, shared secret, callback), workbench tiles/filtering/customization
    pattern: /BuyerAdminGuide including Rules_Part41[ .]|BuyerAdminGuide including Rules_Part41$/i,
    tags: [
      "fsm single-tenant crowd architecture",
      "crowd account buyer anid business partner",
      "configure sap field service management integration",
      "fsm api access configuration data center client id client secret",
      "fsm shared secret callback auth user",
      "streaming api callback fsm sbn",
      "service call proof of service from purchase order",
      "workbench tiles configurable transaction documents",
      "workbench tile count amount title subtitle",
      "workbench custom attributes customization project",
      "workbench actions column multi-select bulk actions",
      "workbench column grouping bulk edit",
      "workbench export xlsx button",
      "filtering workbench tiles edit filter save filter",
      "customizing workbench columns show hide rearrange",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part42: Search filters for documents, orders/releases viewing (routing/fulfillment/settlement statuses), lean service/limit service/limit order concepts
    pattern: /BuyerAdminGuide including Rules_Part42[ .]|BuyerAdminGuide including Rules_Part42$/i,
    tags: [
      "search filters document type date supplier status amount",
      "selecting suppliers for searches 50 supplier limit",
      "view orders and releases buyer",
      "order routing status queued sent acknowledged duplicated failed",
      "order settlement status invoice pcard",
      "order fulfillment status unconfirmed confirmed shipped partial replaced",
      "download orders pdf format",
      "view changes purchase orders color style icons",
      "service orders lean service limit service limit order",
      "lean service planned low value services",
      "limit service unplanned spend limit expected value",
      "limit order predetermined amount time period",
      "quantity limit order always 1 not editable",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part43: Blanket PO masked values, resend failed/rejected orders, invoice routing/document statuses, PDF invoice copy, non-PO invoices, ICS unassigned invoices
    pattern: /BuyerAdminGuide including Rules_Part43[ .]|BuyerAdminGuide including Rules_Part43$/i,
    tags: [
      "blanket purchase order masked values undisclosed",
      "mask amount quantity price blanket po",
      "resend failed orders private suppliers",
      "mark obsolete failed orders",
      "resend rejected purchase order copy ariba invoice management",
      "invoice routing status obsoleted queued sent acknowledged unassigned",
      "invoice document status sent approved paid rejected failed canceled",
      "pdf copy invoices tax authority human readable",
      "pdf invoice copy 25 languages supported",
      "unassigned ics invoices unknown supplier",
      "invoice conversion service provider ics",
      "non-po invoices no purchase order",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part44: Failed invoices show/resend, transaction rules advanced pricing fields (unit price tolerance, subtotal tolerance), scheduled payments, payment proposals, ship notices view
    pattern: /BuyerAdminGuide including Rules_Part44[ .]|BuyerAdminGuide including Rules_Part44$/i,
    tags: [
      "show failed invoices table options filter",
      "resend failed invoices routing status failed",
      "transaction rules advanced pricing fields",
      "apply line item unit price tolerance order confirmations",
      "apply line item subtotal tolerance order confirmations",
      "allow suppliers change unit price invoice",
      "check price tolerance percentage",
      "allow suppliers increase line item subtotals",
      "exception tolerance absolute amount tolerance invoice",
      "allow suppliers enter advanced pricing details line item",
      "subtotal validation calculated unit price formula",
      "viewing scheduled payments early payment offers",
      "payment timeline discount scheduled payment",
      "payment proposal batch files upload download",
      "view ship notices packing slip id tracking url",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part45: Purchase order tracking page milestones, Global Track and Trace, attachments, notifications, printing, cXML export, transaction audit reports
    pattern: /BuyerAdminGuide including Rules_Part45[ .]|BuyerAdminGuide including Rules_Part45$/i,
    tags: [
      "purchase order tracking page milestones timeline",
      "10 most recent milestones order creation invoicing",
      "sap business network global track and trace",
      "global track and trace prerequisites integration suite s4hana",
      "delivery performance kpi on time late in full partial perfect delivery",
      "viewing attachments invoices order confirmations ship notices",
      "attachment maximum 10mb to 100mb configurable",
      "attachment expiry 18 months",
      "viewing notifications online inbox email",
      "printing online documents all details screen contents only",
      "viewing cxml content online documents export cxml",
      "transaction audit reports header level utf8",
      "export all rows export current page table options menu",
    ],
    excludeTags: ["btp", "iata", "fc"],
  },
  {
    // Part46: Pending queue overview/management, re-queue documents, batch document resend CSV (file format, fields), invoice number reuse edge cases, download current transactions ZIP
    pattern: /BuyerAdminGuide including Rules_Part46[ .]|BuyerAdminGuide including Rules_Part46$/i,
    tags: [
      "pending queue documents stuck download",
      "pending queue document types invoice order confirmation ship notice",
      "documents delivery delay notification three days",
      "remove document from pending queue",
      "re-queue documents manually resend online",
      "batch document resend csv upload",
      "batch document resend file 10000 lines recommendation",
      "create batch document resend file csv",
      "upload batch document resend file pending queue",
      "batch resend file format document number type payload id network id",
      "invoice number reuse obsoleted invoice batch resend",
      "current sap business network transactions download zip",
      "download transaction data 90 days cxml zip",
      "transaction documents zip 7 days availability",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  {
    // Part47: Services subscription/credit card management, technical infrastructure (HTTPS/TLS, cXML/fax/email/EDI routing, authentication, backups, technical acknowledgment messages)
    pattern: /BuyerAdminGuide including Rules_Part47[ .]|BuyerAdminGuide including Rules_Part47$/i,
    tags: [
      "sap business network services subscription",
      "service status not subscribed subscribed paid suspended",
      "restoring suspended service payment issue",
      "canceling service subscription no refund",
      "subscription auto-renewal 30 day renewal period",
      "renewing subscription manually pay now",
      "credit card management maximum 10 cards",
      "failed credit card charges grace period notification",
      "add update remove credit card",
      "https tls encryption 128-bit",
      "tls 1.2 tls 1.3 recommended",
      "cxml routing retry 10 times failed",
      "fax routing group iii protocol 10 retries",
      "email routing smtp html plain text",
      "edi routing x12 edifact van as2 ediint",
      "shared secret digital certificate authentication",
      "database backups tape disk four times daily",
      "technical acknowledgment messages reference delivery confirmed",
    ],
    excludeTags: ["btp", "gr", "iata", "gtt", "fc"],
  },
  // ── BuyerAdminGuide for BTP Users including Rules (12 parts) ─────────────
  // Each part entry matches ONLY that slice to enable discriminating search.
  {
    // Part1: Home page/widgets/shipment tracking, Sold To address (Peppol ID, Leitweg ID, tax identifiers), company info, getting started tile bar, highlights section
    pattern: /BuyerAdminGuide for BTP Users including Rules_Part1[ .]|BuyerAdminGuide for BTP Users including Rules_Part1$/i,
    tags: [
      "buyer admin btp home page widgets",
      "shipment tracking widget btp",
      "sold to address btp buyer",
      "peppol id leitweg id buyer",
      "vat id gst id tax identifier buyer",
      "company information btp buyer",
      "getting started tile bar btp",
      "highlights section widgets btp",
    ],
    excludeTags: ["gr", "iata", "gtt", "fc", "managed gateway", "user administration"],
  },
  {
    // Part2: Bill To / Sold To entity management, email notifications configure, account deletion buyer, inactive account supplier
    pattern: /BuyerAdminGuide for BTP Users including Rules_Part2[ .]|BuyerAdminGuide for BTP Users including Rules_Part2$/i,
    tags: [
      "sold to entity management btp",
      "bill to entity management btp",
      "additional entities create edit delete",
      "configure email notifications btp buyer",
      "buyer account deletion btp",
      "inactive account supplier btp",
      "notification configuration btp buyer",
    ],
    excludeTags: ["gr", "iata", "gtt", "fc", "managed gateway"],
  },
  {
    // Part3: Data deletion (recurring/one-time/cancel/download deleted transactions), transaction rules overview/categories (order/oc/shipnotice/invoice/planning/attachment), PO rules (change order/cancel order/prevent duplicate/scheduling agreement override)
    pattern: /BuyerAdminGuide for BTP Users including Rules_Part3[ .]|BuyerAdminGuide for BTP Users including Rules_Part3$/i,
    tags: [
      "recurring deletion transaction data btp",
      "one-time deletion download deleted transactions",
      "transaction rules categories btp",
      "purchase order rules change cancel override",
      "prevent duplicate purchase orders btp",
      "scheduling agreement release rules btp",
      "transaction rules hierarchical categories btp",
    ],
    excludeTags: ["gr", "iata", "gtt", "fc", "managed gateway"],
  },
  {
    // Part4: PO rules continued (change order invoice aggregation, duplicate orders, mark received), OC rules (delivery date tolerance, advanced pricing, quantity tolerance), service sheet rules (ad hoc line items, character limit, description requirement)
    pattern: /BuyerAdminGuide for BTP Users including Rules_Part4[ .]|BuyerAdminGuide for BTP Users including Rules_Part4$/i,
    tags: [
      "change order invoice aggregation btp",
      "mark purchase order received receipt btp",
      "order confirmation delivery date tolerance btp",
      "advanced pricing details order confirmation btp",
      "service sheet ad hoc line items btp",
      "ad hoc line item character limit description",
      "apply line item quantity tolerance service sheets",
    ],
    excludeTags: ["gr", "iata", "gtt", "fc", "managed gateway"],
  },
  {
    // Part5: Service sheet rules continued (quantity/uom/price), non-PO invoice rules (sold to address match, VAT/GST/QST, unit price), PO invoice rules (prevent quantity increase), country/region-based invoice rules download
    pattern: /BuyerAdminGuide for BTP Users including Rules_Part5[ .]|BuyerAdminGuide for BTP Users including Rules_Part5$/i,
    tags: [
      "service sheet quantity uom unit price rules",
      "non-po invoice sold to address match btp",
      "vat gst qst tax categories non-po invoice btp",
      "allow unit price change non-po invoice btp",
      "prevent quantity increase po invoice btp",
      "country region invoice rules download csv btp",
    ],
    excludeTags: ["gr", "iata", "gtt", "fc", "managed gateway"],
  },
  {
    // Part6: Country-based invoice rules (automatic invoice from receipts, US/Australia/South Africa), CIG data center routing (managed gateway enable/disable), document custom attributes (extrinsic, characteristic, ship notice, OC)
    pattern: /BuyerAdminGuide for BTP Users including Rules_Part6[ .]|BuyerAdminGuide for BTP Users including Rules_Part6$/i,
    tags: [
      "automatic invoice creation from receipts country",
      "country region invoice rules btp",
      "cig data center routing managed gateway btp",
      "sap integration suite managed gateway enable disable",
      "document custom attributes btp",
      "extrinsic characteristic attribute btp buyer",
      "ship notice oc custom display attributes",
    ],
    excludeTags: ["gr", "iata", "gtt", "fc"],
  },
  {
    // Part7: Custom attribute types (extrinsic/characteristic/static), user account/profile settings, supplier group transaction rules, ERP integration managed gateway intro
    pattern: /BuyerAdminGuide for BTP Users including Rules_Part7[ .]|BuyerAdminGuide for BTP Users including Rules_Part7$/i,
    tags: [
      "custom attribute type extrinsic characteristic btp",
      "user account profile settings btp buyer",
      "supplier group transaction rules btp",
      "erp integration managed gateway sap integration suite",
      "user administration permission btp buyer",
    ],
    excludeTags: ["gr", "iata", "gtt", "fc"],
  },
  {
    // Part8: Managed gateway prerequisites/configuration, supply chain rules (product replenishment PRM/SMI/forecast/capacity/manufacturing visibility), audit log (security/data access/data modification/configuration)
    pattern: /BuyerAdminGuide for BTP Users including Rules_Part8[ .]|BuyerAdminGuide for BTP Users including Rules_Part8$/i,
    tags: [
      "managed gateway configuration prerequisites btp",
      "product replenishment prm smi forecast endpoint btp",
      "manufacturing visibility supply chain btp",
      "audit log security data access events btp",
      "data modification configuration audit btp",
      "audit report types btp buyer",
    ],
    excludeTags: ["gr", "iata", "gtt", "fc"],
  },
  {
    // Part9: Permissions reference table (transaction data export, transaction monitoring visibility, user administration, catalog network, company data deletion, punchoutsetuprequest)
    pattern: /BuyerAdminGuide for BTP Users including Rules_Part9[ .]|BuyerAdminGuide for BTP Users including Rules_Part9$/i,
    tags: [
      "buyer permissions reference table btp",
      "transaction data export deleted data permission",
      "transaction monitoring visibility permission btp",
      "user administration permission btp",
      "catalog network permission btp",
      "company data deletion permission btp",
      "punchoutsetuprequest permission btp",
    ],
    excludeTags: ["gr", "iata", "gtt", "fc"],
  },
  {
    // Part10: User management (lock/unlock), personal data removal request, role modification/user role assignment, multifactor authentication
    pattern: /BuyerAdminGuide for BTP Users including Rules_Part10[ .]|BuyerAdminGuide for BTP Users including Rules_Part10$/i,
    tags: [
      "lock unlock users btp buyer",
      "personal data removal request btp",
      "role modification user role assignment btp",
      "multifactor authentication sign in btp",
      "user administration manage roles btp",
    ],
    excludeTags: ["gr", "iata", "gtt", "fc"],
  },
  {
    // Part11: Role management (edit name/permissions), SAP Fieldglass integration (statement of work/service sheet/items to service page), Workbench intro (tile carousel/document list)
    pattern: /BuyerAdminGuide for BTP Users including Rules_Part11[ .]|BuyerAdminGuide for BTP Users including Rules_Part11$/i,
    tags: [
      "manage roles permissions edit btp",
      "sap fieldglass integration service sheet btp",
      "statement of work fieldglass service sheet",
      "items to service page fieldglass btp",
      "workbench tile carousel document list btp",
    ],
    excludeTags: ["gr", "iata", "gtt", "fc"],
  },
  {
    // Part12: Workbench UI (tile carousel, columns/sort/group/reset, filter, export), self-billing invoice (auto transmit from PO/scheduling agreement/goods receipt), service sheet not supported blanket PO
    pattern: /BuyerAdminGuide for BTP Users including Rules_Part12[ .]|BuyerAdminGuide for BTP Users including Rules_Part12$/i,
    tags: [
      "workbench tile carousel columns sort group btp",
      "workbench filter export reset btp buyer",
      "self-billing invoice auto transmit btp",
      "self-billing scheduling agreement goods receipt",
      "service sheet blanket po not supported btp",
    ],
    excludeTags: ["gr", "iata", "gtt", "fc"],
  },


  // ── SAP Business Network Guide to Invoicing part1 (14 parts) ─────────────
  {
    // p1-Part1: Guide overview, invoicing prerequisites, invoice rules overview, testing invoice process,
    // routing for test accounts, buyer/supplier perspective, invoice workbench tiles, user permissions
    pattern: /Guide to Invoicing part1_Part1[ .]|Guide to Invoicing part1_Part1$/i,
    tags: [
      "invoicing guide", "invoicing prerequisites", "invoice rules overview",
      "test account routing", "invoice workbench tiles", "invoice workbench",
      "invoice generation permission", "routing overrides", "transaction configuration",
      "ics paper invoice", "cfdi upload", "mexico invoice", "italy invoice",
      "invoice-based workbench", "rejected tile", "pending approval tile", "draft tile",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc", "ship notice", "order confirmation"],
  },
  {
    // p1-Part2: Invoice creation process steps, invoice validation (online/cXML/CSV/EDI),
    // invoice types (material/service/lean service/limit service/non-PO/credit memo/self-billing),
    // draft invoices, contract-based invoice compliance, self-billing ERS workflow
    pattern: /Guide to Invoicing part1_Part2[ .]|Guide to Invoicing part1_Part2$/i,
    tags: [
      "invoicing guide", "invoice creation process", "invoice validation",
      "cxml invoice validation", "csv invoice", "edi invoice validation",
      "functional acknowledgment", "control keys",
      "invoice types", "lean service invoice", "limit service invoice", "non-po invoice",
      "line-level debit memo", "blanket po invoice", "contract invoice", "self-billing invoice",
      "evaluated receipt settlement", "ers",
      "draft invoice", "50-day draft retention",
      "contract-based invoice compliance", "commerce automation",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p1-Part3: Invoice dates, overdue documents, invoice addresses (sold to/bill to/remit to/ship from),
    // foreign currencies, notification framework, invoice history, VAT compliance features,
    // PDF copy of invoices (supported languages, filename convention, digital signing)
    pattern: /Guide to Invoicing part1_Part3[ .]|Guide to Invoicing part1_Part3$/i,
    tags: [
      "invoicing guide", "invoice date", "invoice backdating", "overdue invoice",
      "invoice addresses", "sold to address", "bill to address", "remit to address", "ship from address",
      "foreign currency invoice", "bloomberg exchange rate",
      "invoice notification", "invoice rejection reason", "invoice history",
      "vat compliance", "reverse charge", "zero rate vat", "exempt detail", "fiscal representative",
      "intra-eu trade", "cross-border trade", "vat id rules",
      "pdf copy invoice", "pdf invoice copy", "invoice pdf languages", "digitally signed pdf",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p1-Part4: PDF invoice copy attachment (cXML extrinsic invoicePDF), invoice archival options,
    // archive zip contents, long term archiving, tax auditor role, archive access permission,
    // partner enabled PDF invoicing vs intelligent invoice conversion,
    // PDF invoices supplier onboarding, supported countries/languages for PDF invoices
    pattern: /Guide to Invoicing part1_Part4[ .]|Guide to Invoicing part1_Part4$/i,
    tags: [
      "invoicing guide", "invoice archiving", "archive delivery", "archive zip",
      "automatic archive delivery", "https archive post", "worm technology",
      "long term archiving", "tax auditor role", "archive access permission",
      "download archive document", "pending queue download",
      "partner enabled pdf invoicing", "intelligent invoice conversion",
      "pdf invoice onboarding", "pdf invoice supported countries",
      "pdf invoice file size", "email pdf invoice", "pdfinvoice-prod",
      "invoice conversions tile", "draft invoice conversions",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p1-Part5: PDF invoice workflows (onboarding/testing/processing/email), error codes for PDF invoices,
    // uploading sample PDF invoices, choosing buyers during PDF onboarding
    pattern: /Guide to Invoicing part1_Part5[ .]|Guide to Invoicing part1_Part5$/i,
    tags: [
      "invoicing guide", "pdf invoice workflow", "pdf invoice onboarding workflow",
      "pdf invoice testing", "pdf invoice production",
      "email pdf invoice workflow", "pdf invoice error codes",
      "pdf invoice error 451", "pdf invoice error 470",
      "upload sample pdf invoices", "pdf invoice buyer selection",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p1-Part6: Sample upload status (pending/completed/failed), uploading PDF invoices,
    // draft invoice from PDF upload, sending PDF invoices by email,
    // intelligent invoice conversion (IIC) intro, IIC concepts (template/schema/annotations),
    // sample file requirements, IIC onboarding setup (test account)
    pattern: /Guide to Invoicing part1_Part6[ .]|Guide to Invoicing part1_Part6$/i,
    tags: [
      "invoicing guide", "sample upload status", "pdf invoice upload",
      "draft invoice from pdf", "email pdf invoice steps",
      "intelligent invoice conversion", "iic",
      "invoice conversion template", "default template", "custom template",
      "invoice schema", "annotations", "document user interface",
      "sample file requirements", "iic onboarding",
      "india invoice", "india gst", "hsn sac code",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p1-Part7: Managing IIC templates (list/edit/delete/status), configure submission method,
    // IIC notifications, updating templates when new fields available,
    // uploading invoices for conversion, email upload for IIC,
    // India-specific IIC (place of supply, HSN/SAC, IGST/SGST/CGST/UTGST)
    pattern: /Guide to Invoicing part1_Part7[ .]|Guide to Invoicing part1_Part7$/i,
    tags: [
      "invoicing guide", "iic template management", "iic template status",
      "auto submission", "manual submission", "iic notifications",
      "update iic template", "upload invoice for conversion",
      "iic email upload", "supplierics-bn-prod", "supplierics-bn-test",
      "identify buyer tax id po number",
      "india iic", "place of supply", "igst", "sgst", "cgst", "utgst",
      "india gst fields", "qr code extraction",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p1-Part8: India IIC testing/publishing, summary invoice from ship notices,
    // summary invoice from multiple POs, standard invoice field reference,
    // invoice field descriptions (summary/tax/shipping/payment terms/allowances/service sheet lines/labor)
    pattern: /Guide to Invoicing part1_Part8[ .]|Guide to Invoicing part1_Part8$/i,
    tags: [
      "invoicing guide", "summary invoice", "summary invoice ship notices",
      "summary invoice multiple pos", "ship notices to invoice tile",
      "invoice grouping rules", "packing slip id grouping",
      "orders to summary invoice tile",
      "invoice field reference", "invoice field descriptions",
      "summary fields", "tax fields", "shipping fields", "payment terms fields",
      "allowances charges fields", "service sheet line items", "labor service items",
      "direct material fields", "country-specific tax fields",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p1-Part9: Invoice header field descriptions (invoice#/date/PO/remit to/supplier tax id/bill to),
    // tax fields (category/location/rate/exempt detail/law reference/triangular transaction),
    // tax calculation rounding, shipping fields, payment terms fields, discount fields,
    // work order fields, advanced pricing details fields,
    // additional header fields (supplier commercial register/tax representative/subsequent buyer),
    // allowances and charges fields, blanket PO fields, service sheet line item details
    pattern: /Guide to Invoicing part1_Part9[ .]|Guide to Invoicing part1_Part9$/i,
    tags: [
      "invoicing guide", "invoice header fields", "remit to address factoring",
      "supplier tax id field", "source document field",
      "tax category field", "exempt detail field", "law reference field", "triangular transaction",
      "tax calculation rounding", "date of supply",
      "shipping amount field", "payment net term", "discount percentage",
      "work order id", "equipment id",
      "price unit quantity", "unit conversion field", "pricing description",
      "supplier commercial register", "tax representative field", "subsequent buyer",
      "tax exchange rate", "gstin", "qst registration",
      "blanket po fields", "bpo status", "amount available",
      "service sheet line item fields", "service period field", "accounting reference",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p1-Part10: Goods/service line item fields, labor service item fields (rate/term/contractor/timesheet),
    // direct material fields (sales order date/shipping documents/retail details),
    // country-specific tax fields (Brazil/Chile/Mexico),
    // invoice routing statuses vs document statuses,
    // invoice rules overview (rule levels, allow vs require rules, rule interaction)
    pattern: /Guide to Invoicing part1_Part10[ .]|Guide to Invoicing part1_Part10$/i,
    tags: [
      "invoicing guide", "goods line item fields", "labor service item fields",
      "contractor name field", "timesheet number", "job description field",
      "direct material fields", "retail details", "informational pricing",
      "brazil invoice fields", "sefaz", "chile invoice fields", "rut",
      "mexico invoice fields", "municipality field",
      "invoice routing status", "invoice document status",
      "acknowledged status", "failed routing status", "queued status",
      "invoice rule levels", "default transaction rules", "supplier group rule",
      "country-based invoice rule", "allow rules", "require rules",
      "invoice rule interaction",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p1-Part11: Countries with country/region-based invoice rule templates,
    // originating country determination, document label by country,
    // country-based rules for BPO, partial credit restriction (US/Australia),
    // auto invoice from receipts (US/AU/ZA), auto invoice from approved SES (4R2),
    // invoice rule reference section index,
    // general invoice rules (allow invoices/service info/separate tax lines/single VAT instance),
    // non-PO invoice rules, credit memo and debit memo rules
    pattern: /Guide to Invoicing part1_Part11[ .]|Guide to Invoicing part1_Part11$/i,
    tags: [
      "invoicing guide", "country-based invoice rules", "originating country",
      "document label country", "partial credit restriction",
      "auto invoice from receipts", "auto invoice from ses", "4r2 integration",
      "invoice rule reference", "general invoice rules",
      "allow invoices rule", "allow non-po invoices", "allow service information",
      "separate tax lines shipping", "single vat instance rule",
      "header credit memo", "header debit memo", "zero-quantity credit memo",
      "line-item credit memo", "quantity adjustment credit memo", "price adjustment credit memo",
      "credit memo without reference", "zero-price debit memo",
      "reason for credit memo",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p1-Part12: General invoice rules (continued):
    // require credit memo to reference invoice, allow cancel invoices, require OC before invoice,
    // require line item quantity/price > 0, allow/require invoice attachments (size limits/material/service),
    // require credit memo attachments, allow reuse invoice numbers (Italy note),
    // allow advanced pricing details (PO/non-PO/BPO conditions), allow change advanced pricing,
    // allow bill to address mapped to system ID, case-insensitive invoice matching,
    // allow allowances and charges (configure list, France parafiscal),
    // require shipped quantities + tolerance limits, require ship notice references,
    // require received quantities (receipt-based verification, ControlKeys, examples),
    // require receipt references, Polish invoice title (InvoiceTitle extrinsic),
    // allow failed invoices to buyer system, allow multiple invoices for amount-based service item,
    // allow invoices directly from service POs without service sheet,
    // require start and end dates on service invoices (line level/header, subrule: services in progress),
    // auto-generate service sheets from service invoices, ignore return items
    pattern: /Guide to Invoicing part1_Part12[ .]|Guide to Invoicing part1_Part12$/i,
    tags: [
      "invoicing guide", "require oc before invoice",
      "require invoice attachment", "invoice attachment size limit", "require credit memo attachment",
      "reuse invoice numbers", "invoice number italy",
      "advanced pricing details rule", "allow change advanced pricing",
      "bill to address system id mapping", "case-insensitive invoice matching",
      "allow allowances and charges", "configure allowances charges list", "france parafiscal",
      "require shipped quantities", "shipped quantity tolerance", "upper tolerance limit", "lower tolerance limit",
      "require ship notice reference",
      "require received quantities", "receipt-based invoice verification", "control keys invoice",
      "require receipt reference",
      "polish invoice title", "invoicetitle extrinsic", "faktura",
      "allow failed invoices to buyer",
      "allow multiple invoices amount-based service",
      "allow invoices from service po without service sheet",
      "require start and end dates service invoices", "service invoice start date", "service invoice end date",
      "do not allow invoices services in progress",
      "auto-generate service sheets from invoices",
      "ignore return items invoice",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p1-Part13: Require negative tax on allowances, configure list of allowances and charges
    // (UNSPSC service code, France parafiscal, cXML validation, draft invoice behavior),
    // service sheet rules (full list: OC before SS, approver info, attachments, ad hoc lines,
    // UOM change, quantity increase, unit price change, subtotal tolerance, multiple SS for amount-based,
    // auto-generated SS taxes/allowances, multiple parent PO lines, reuse SS numbers,
    // non-zero quantity SES, part number length, description required, account assignment,
    // correction service sheets, 4R2 Fieldglass S4HANA exchange),
    // PO invoice rules (add line items, auxiliary part ID, sold to match, copy tax from PO),
    // PO and non-PO invoice rules (backdating, shipping tax, supplier tax ID, future-dated invoices,
    // legal form, commercial identifier, company capital, sold to address VAT match)
    pattern: /Guide to Invoicing part1_Part13[ .]|Guide to Invoicing part1_Part13$/i,
    tags: [
      "invoicing guide", "negative tax on allowances",
      "allowances charges list unspsc", "service code validation cxml",
      "service sheet rules", "require oc before service sheet", "approver information service sheet",
      "service sheet attachments", "ad hoc line items service sheet",
      "allow uom change service sheet", "allow quantity increase service sheet",
      "allow unit price change service sheet", "subtotal tolerance service sheet",
      "multiple service sheets amount-based", "reuse service sheet numbers",
      "non-zero quantity ses", "account assignment service sheet",
      "correction service sheets", "fieldglass s4hana exchange 4r2",
      "add line items po invoice", "auxiliary part id",
      "sold to name country match",
      "copy tax from po", "copy tax allowances charges",
      "allow backdated invoices", "allow future-dated invoices",
      "require supplier tax id", "require supplier legal form",
      "require commercial identifier", "require company capital",
      "sold to address vat match",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p1-Part14: Blanket PO invoice rules (change description/ship to/add child item),
    // PO and BPO invoice fields (currency/unit price/UOM/quantity/subtotal/part number change),
    // PO BPO non-PO invoice fields (require descriptions/valid tax values/net amount exceeds subtotal),
    // invoice payment rules (bank account/IBAN/net term/penalty/discount/omit payment terms),
    // VAT rules (full list: customer VAT ID/supplier VAT ID/supply date/local currency/
    // zero-rate explanation/intra-EU only/domestic trade/self-signed invoices),
    // online invoice forms rules (remittance/ship to/bill to/sold to/copy bill to sold to)
    pattern: /Guide to Invoicing part1_Part14[ .]|Guide to Invoicing part1_Part14$/i,
    tags: [
      "invoicing guide", "blanket po invoice rules", "bpo change description",
      "bpo change ship to", "add child item bpo",
      "allow currency change unit price", "allow unit price change po",
      "allow quantity increase po", "allow subtotal increase", "subtotal exception tolerance",
      "allow part number change",
      "require line item descriptions",
      "valid tax values list", "allow custom tax rate",
      "net amount exceeds subtotal",
      "invoice payment rules", "require bank account details", "iban requirement",
      "require net term", "require penalty terms", "require discount terms",
      "allow payment term change", "omit payment terms",
      "vat rules", "require customer vat id", "require supplier vat id",
      "require supply date", "require local currency", "zero-rate vat explanation",
      "intra-eu vat only", "self-signed invoice",
      "online invoice forms rules", "configure sold to addresses",
      "copy bill to sold to", "default sold to address",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },

  // ── SAP Business Network Guide to Invoicing part2 (16 parts) ─────────────
  {
    // p2-Part1: Digital signature process, PKI, TrustWeaver, eSigning workflow, self-signed invoices, SAP Ariba Tax Invoicing Framework intro
    pattern: /Guide to Invoicing part2_Part1[ .]|Guide to Invoicing part2_Part1$/i,
    tags: [
      "invoicing guide", "digital signature invoice", "esignature", "pki certificate",
      "trustweaver", "esigning workflow", "invoice signing process", "smart card workflow",
      "digital signing agreement", "terms of use invoice", "invoice mandate",
      "self-signed invoice", "supplier self-signed invoice", "w3c xml digital signature",
      "invoice with file attachments", "certificate authority invoice",
      "sap ariba tax invoicing framework", "tax invoicing framework prerequisites",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p2-Part2: Tax Invoicing Framework workflow, country configuration, Brazil NFe/SEFAZ, Mexico CFDI/PAC/SAT, Brazil CCe invoice addendum
    pattern: /Guide to Invoicing part2_Part2[ .]|Guide to Invoicing part2_Part2$/i,
    tags: [
      "invoicing guide", "tax invoicing framework workflow", "country configuration supplier",
      "legal regulatory profile", "additional entities",
      "brazil tax invoice", "nfe", "sefaz", "brazil e-invoicing",
      "mexico cfdi", "pac", "sat catalogue", "cfdi addendum", "cce invoice addendum",
      "cfdi carta porte", "mexico tax invoice", "cfdi xml",
      "invoice number mexico", "tax regime mexico",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p2-Part3: CFDI upload steps, Mexico payment receipt (complemento de pago), payment receipt workflow, endpoint configuration
    pattern: /Guide to Invoicing part2_Part3[ .]|Guide to Invoicing part2_Part3$/i,
    tags: [
      "invoicing guide", "cfdi upload", "cfdi invoice pdf attachment",
      "mexico payment receipt", "complemento de pago", "payment receipt workflow",
      "payment receipt confirmation", "upload cfdi wizard",
      "external document upload", "buyer vat id payment receipt",
      "france tax invoicing report",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p2-Part4: Hungary tax invoicing, NAV portal reporting, Hungary invoice number range, correction invoice, storno invoice, annul invoice, parafiscal taxes, french VAT IDs
    pattern: /Guide to Invoicing part2_Part4[ .]|Guide to Invoicing part2_Part4$/i,
    tags: [
      "invoicing guide", "hungary tax invoice", "nav portal", "nav reporting",
      "hungary invoice number range", "hungarian e-invoicing",
      "correction invoice hungary", "storno invoice hungary", "annul invoice hungary",
      "disable tax invoicing hungary", "hungary invoice summary report",
      "tax exemption hungary", "tax exempt codes hungary", "vat exemption",
      "france parafiscal taxes", "parafiscal tax line level",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p2-Part5: French Summary List Report, French Partner File Report, French legal entities (sold-to address), India GST types (IGST SGST CGST UTGST)
    pattern: /Guide to Invoicing part2_Part5[ .]|Guide to Invoicing part2_Part5$/i,
    tags: [
      "invoicing guide", "french summary list report", "french partner file report",
      "french legal entity", "sold-to address vat id", "france tax reporting",
      "france audit report", "french invoice report",
      "india gst", "igst", "sgst", "cgst", "utgst", "india tax invoice types",
      "gst invoice zero rated exempt",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p2-Part6: India country-based invoice rules, India 2019 Tax Regulation, IRP e-invoicing portal, India GST configuration, sold-to address India, India specific taxes, India API credentials
    pattern: /Guide to Invoicing part2_Part6[ .]|Guide to Invoicing part2_Part6$/i,
    tags: [
      "invoicing guide", "india country-based invoice rules", "india 2019 tax regulation",
      "irp invoice registration portal", "india e-invoicing", "india gst configuration",
      "india sold-to address gst id", "india specific taxes buyer",
      "india allowances and charges", "india tax invoice rule",
      "india api credentials", "gstin registration",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p2-Part7: India invoice field validations (HSN SAC classification, port code, entity name), India IRN cancellation, India TCS calculation, UAE country configuration
    pattern: /Guide to Invoicing part2_Part7[ .]|Guide to Invoicing part2_Part7$/i,
    tags: [
      "invoicing guide", "india invoice field validation", "hsn code", "sac code",
      "india invoice classification", "port code india", "india invoice field format",
      "irn cancellation", "india irn cancel 24 hours", "india tcs calculation",
      "uae country configuration", "uae e-invoicing",
      "india small traders irp",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p2-Part8: Italy FatturaPA, SDI portal, Italy stamp duty imposta di bollo, PagoPA, Italy withholding tax, Italy invoice types (TD01), UK Brexit VAT, UK Northern Ireland EU
    pattern: /Guide to Invoicing part2_Part8[ .]|Guide to Invoicing part2_Part8$/i,
    tags: [
      "invoicing guide", "italy fatturapa", "sdi portal", "italy e-invoicing",
      "italy stamp duty", "imposta di bollo", "pagopa", "italy withholding tax",
      "italy invoice type td01", "italy vat payment deferred", "split payment italy",
      "italy invoice archiving", "italy sdi pdf",
      "uk invoice", "brexit vat", "northern ireland eu trade", "uk northern ireland intraeu",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p2-Part9: Malaysia IRBM, Malaysia e-invoicing, Malaysia TIN BRN SST, Malaysia invoice types, Singapore GST, Singapore zero-rated exempt, Singapore debit note credit note
    pattern: /Guide to Invoicing part2_Part9[ .]|Guide to Invoicing part2_Part9$/i,
    tags: [
      "invoicing guide", "malaysia irbm portal", "malaysia e-invoicing", "malaysia tin",
      "malaysia brn", "malaysia sst id", "malaysia country configuration",
      "malaysia invoice types", "malaysia tourism tax",
      "singapore gst", "singapore gst registration number", "singapore zero-rated",
      "singapore exempt supplies", "singapore debit note", "singapore credit note",
      "singapore country configuration", "singapore sold-to address",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p2-Part10: Switzerland QR-IBAN invoice, Liechtenstein, QR Reference 27 digits, Creditor Reference, Switzerland bank account, Peppol UBL invoice receive
    pattern: /Guide to Invoicing part2_Part10[ .]|Guide to Invoicing part2_Part10$/i,
    tags: [
      "invoicing guide", "switzerland invoice", "qr-iban", "qr reference invoice",
      "creditor reference invoice", "liechtenstein invoice",
      "require iban switzerland", "bank account details on invoice",
      "additional remittance information", "switzerland country configuration",
      "peppol ubl invoice receive",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p2-Part11: Germany X-Rechnung, Germany invoice rules, external document service configuration, Japan invoicing tax registration, Seiko timestamp Japan, currency precision rounding
    pattern: /Guide to Invoicing part2_Part11[ .]|Guide to Invoicing part2_Part11$/i,
    tags: [
      "invoicing guide", "germany x-rechnung", "x-rechnung invoice", "germany invoice rules",
      "germany net term information", "external document service configuration",
      "sap document reporting compliance", "external document service create edit disable",
      "japan invoicing", "japan tax registration number", "seiko timestamp",
      "japan timestamp invoice", "japan invoice report",
      "currency precision rounding", "configure currency rounding",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p2-Part12: Japan batch timestamp verification, Poland KSeF portal, Poland NIP token, Poland country configuration, Poland external document service, Poland header tax not supported
    pattern: /Guide to Invoicing part2_Part12[ .]|Guide to Invoicing part2_Part12$/i,
    tags: [
      "invoicing guide", "japan batch verification", "timestamp verification report",
      "seiko batch verify", "japan invoice verification",
      "poland ksef", "poland nip token", "poland country configuration",
      "poland external document service", "poland header tax not supported",
      "ksef portal", "poland invoice",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p2-Part13: Romania ANAF, Romania country configuration, Romania CUI access token, Belgium UBL Peppol, invoice field rules table (non-PO invoice cancel credit memo)
    pattern: /Guide to Invoicing part2_Part13[ .]|Guide to Invoicing part2_Part13$/i,
    tags: [
      "invoicing guide", "romania anaf", "romania country configuration",
      "anaf access token", "anaf cui", "romania e-invoicing", "romania invoice",
      "belgium ubl invoice", "belgium peppol", "ubl invoice routing",
      "non-po invoice rule", "cancel invoice rule", "credit memo rule", "invoice operation rules",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p2-Part14: Invoice field reference table — payment terms, remit-to address, bill-to, tax fields (taxable amount, tax category, law reference), invoice status portal basics, ERP copy invoices
    pattern: /Guide to Invoicing part2_Part14[ .]|Guide to Invoicing part2_Part14$/i,
    tags: [
      "invoicing guide", "invoice field reference table", "payment terms invoice field",
      "remit-to address", "remit-to id", "bill-to address invoice",
      "tax category field", "taxable amount field", "law reference vat",
      "tax description zero rate", "triangular transaction vat",
      "allowances charges invoice fields", "part number invoice field",
      "invoice status portal supplier", "erp copy invoices",
      "trading partner tax responsibilities",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p2-Part15: Invoice status portal setup (invitation email, single invoice lookup, vendor id), Peppol participant configuration, Australia NZ PINT format, Configure External Network Identifiers, supplier master data upload
    pattern: /Guide to Invoicing part2_Part15[ .]|Guide to Invoicing part2_Part15$/i,
    tags: [
      "invoicing guide", "invoice status portal configuration", "invoice status portal invitation email",
      "invoice status portal single lookup", "vendor id help text",
      "peppol integration sbn", "peppol participant configuration",
      "configure external network identifiers", "peppol profile create edit delete",
      "australia peppol pint", "new zealand peppol pint",
      "supplier master data upload vendor",
      "sap document reporting compliance peppol",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
  },
  {
    // p2-Part16: Peppol API / SAP Document and Reporting Compliance, HTTP header X-ARIBA-NETWORK-ID, buyer API client ID configuration, receiverCountryCode JSON element
    pattern: /Guide to Invoicing part2_Part16[ .]|Guide to Invoicing part2_Part16$/i,
    tags: [
      "invoicing guide", "peppol api", "sap document reporting compliance setup",
      "http header x-ariba-network-id", "buyer api client id configuration",
      "receiver country code json", "external document api",
      "oauth id sap ariba developer portal",
    ],
    excludeTags: ["punchout", "iata", "gtt", "fc"],
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
    // P1: document type support matrix (PO/OC/ASN/Invoice across cXML/EDIFACT/X12/OAGIS/PIDX/EANCOM/Peppol/XRechnung)
    pattern: /aribaintegrationportal-CIG for Supplier_Part1[ .]|aribaintegrationportal-CIG for Supplier_Part1$/i,
    tags: ["document type matrix cig supplier", "supported edi formats cxml edifact x12", "cxml edifact x12 oagis pidx", "purchase order document formats", "peppol xrechnung support", "eancom bis peppol supported", "non cxml routing formats"],
    excludeTags: ["erp", "iata", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P2: document type table continued (Goods Receipt/Forecast/Inventory/Quality/PriceSheet/Warehouse/Transport), PIDX PriceSheet format, EDIFACT D98A format, Getting Started prerequisites
    pattern: /aribaintegrationportal-CIG for Supplier_Part2[ .]|aribaintegrationportal-CIG for Supplier_Part2$/i,
    tags: ["pidx price sheet catalog format", "edifact d98a format supplier", "goods receipt forecast inventory document type", "quality notification warehouse shipment type", "transport request confirmation document", "consignment settlement document", "as2 digital certificate requirement"],
    excludeTags: ["erp", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P3: accessing CIG (Sign In, Enable on SBN, configure routing method, assign user permissions), Trusted Certificate Authorities list
    pattern: /aribaintegrationportal-CIG for Supplier_Part3[ .]|aribaintegrationportal-CIG for Supplier_Part3$/i,
    tags: ["sign in cig portal steps", "enable managed gateway sbn", "electronic order routing setup", "user permissions roles cig", "trusted certificate authorities list", "digicert globalsign certificate ca", "non cxml routing method setup"],
    excludeTags: ["erp", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P4: Trusted CA list continued, data center hosting, Home Page (My Configurations/Test Central/Transaction Tracker), ERP system info, Project concept, Connection fields (HTTPS/AS2/VAN/certificate/AS2 ID/MDN), Shared connections, Mappings, Cross Reference fields, EDI Qualifier list
    pattern: /aribaintegrationportal-CIG for Supplier_Part4[ .]|aribaintegrationportal-CIG for Supplier_Part4$/i,
    tags: ["connection configuration https as2 van", "as2 mdn certificate settings", "cross reference edi qualifier list", "buyer supplier interchange id isa", "shared connection anid multi supplier", "data map document format version", "home page my configurations tracker"],
    excludeTags: ["erp", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P5: Configuration Confirmation page, Project Testing (test script, test cases, scheduling, limitations), create Project wizard (Basic Info/Connection/Data Maps/Cross References/Confirm/Test)
    pattern: /aribaintegrationportal-CIG for Supplier_Part5[ .]|aribaintegrationportal-CIG for Supplier_Part5$/i,
    tags: ["create integration project wizard", "project configuration confirmation page", "test script scheduling test cases", "data map incoming outgoing format", "cross reference lookup table project", "project testing self service", "technical acknowledgment mapping"],
    excludeTags: ["erp", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P6: edit/delete Project, Managing Authorization (CIS account/password), My Configurations (Connections/CrossRefs/Certificates), sharing connections, Lookup Table, deploying to production (Go Live), Transaction Tracker search criteria and document status
    pattern: /aribaintegrationportal-CIG for Supplier_Part6[ .]|aribaintegrationportal-CIG for Supplier_Part6$/i,
    tags: ["deploy project production go live", "manage authorization cis account password", "connection sharing supplier anid", "lookup table values maintenance", "transaction tracker document status completed failed", "edit delete project certificate", "my configurations crossrefs manage"],
    excludeTags: ["erp", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P7: Transaction Tracker operations (reprocess/download), Connectivity Tool (inbound/outbound test), Document Validator (Content/Transformation/Schema), SAML Assertion validation, ASN common errors, OC common errors (first half)
    pattern: /aribaintegrationportal-CIG for Supplier_Part7[ .]|aribaintegrationportal-CIG for Supplier_Part7$/i,
    tags: ["connectivity tool test inbound outbound", "document validator schema transformation", "saml assertion test central validation", "asn common errors resolution", "order confirmation common errors", "reprocess failed transaction payload", "custom mapping differences view"],
    excludeTags: ["erp", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P8: OC errors continued, Invoice common errors (unit price/ShipTo/RemitTo/credit memo/payment terms), EDI document errors, SSL Handshake (ClientHello/ServerHello/ChangeCipherSpec), SSL errors, network troubleshooting (ping/netstat/telnet), HTTP error codes
    pattern: /aribaintegrationportal-CIG for Supplier_Part8[ .]|aribaintegrationportal-CIG for Supplier_Part8$/i,
    tags: ["invoice common errors unit price credit memo", "ssl handshake clienthello serverhello", "ssl certificate chain error", "edi segment validation errors", "network troubleshooting ping telnet netstat", "http error codes 400 500", "shipto remitto invoice partner errors"],
    excludeTags: ["erp", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P9: HTTP error codes continued (4xx/5xx), migrate from ASCx12 Legacy Translator (AS2 ID/ISA ID/VAN differences/PO Change Order), migration steps, enable B2B routing method, Custom Routing config, create Test Account
    pattern: /aribaintegrationportal-CIG for Supplier_Part9[ .]|aribaintegrationportal-CIG for Supplier_Part9$/i,
    tags: ["migrate ascx12 legacy translator cig", "as2 id aribaedi ariba migration", "isa interchange id migration", "van direct as2 connection migration", "b2b routing method custom routing", "test account creation sbn testing", "change order edi850 edi860 migration"],
    excludeTags: ["erp", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P10: legal disclaimers, copyright, patent notices (no technical content)
    pattern: /aribaintegrationportal-CIG for Supplier_Part10[ .]|aribaintegrationportal-CIG for Supplier_Part10$/i,
    tags: ["legal disclaimers copyright patent"],
    excludeTags: ["erp", "gtt", "fc"],
  },
  {
    // Non-timestamped fallback (merged docKey)
    pattern: /aribaintegrationportal.CIG.for.Supplier/i,
    tags: ["document type matrix cig supplier", "connection configuration https as2 van", "project wizard data map cross reference", "deploy go live production", "connectivity tool document validator", "transaction tracker document status failed", "migrate ascx12 legacy b2b routing"],
    excludeTags: ["erp", "gtt", "fc", "carrier", "freight"],
  },
  // ── CIGConfigSup (Installation Guide for ERP Integration for Suppliers, 2 parts) ─
  {
    // P1: overview of integration components (supplier add-on, cloud connector, CIG gateway), high-level setup steps table, supported ERP versions (EHP4-EHP8, S/4HANA), TLS 1.2 requirement, downloading/installing supplier add-on from SAP ONE Support Launchpad
    pattern: /CIGConfigSup_Part1[ .]|CIGConfigSup_Part1$/i,
    tags: ["cig supplier addon installation guide", "supplier erp integration components", "sap cloud connector installation", "managed gateway supplier addon", "supported erp versions ehp4 ehp8", "s4hana unicode utf-8 requirement", "tls 1.2 minimum version", "download addon sap one support launchpad", "high level integration setup steps", "install configure cloud connector addon"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P2: authorization objects (ACIS/ARBCIS_CLS/ARBCIS_PRG/ARBCIS_SPR), cloud connector subaccount configuration (test/production subaccount IDs by region), location ID, buy-side vs sell-side cloud connector separation, multiple ERP system connections
    pattern: /CIGConfigSup_Part2[ .]|CIGConfigSup_Part2$/i,
    tags: ["authorization objects acis arbcis cls prg", "arbcis spro authorization erp users", "cloud connector subaccount configuration", "test production subaccount id region", "location id cloud connector", "buy side sell side connector separation", "java version cloud connector requirement", "multiple erp connections cloud connector", "reverse invoke proxy on-premise"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // Non-timestamped fallback
    pattern: /CIGConfigSup/i,
    tags: ["cig supplier addon erp installation", "cloud connector subaccount config", "authorization objects arbcis", "supported erp versions tls 1.2"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  // ── CIGOverviewSup (Overview Guide for ERP Integration for Suppliers, 2 parts) ─
  {
    // P1: overview of CIG supplier integration, prerequisites/restrictions, software components (supplier add-on + cloud connector), supported ERP versions, high-level setup steps, supported transactions (sales order, order confirmation)
    pattern: /CIGOverviewSup_Part1[ .]|CIGOverviewSup_Part1$/i,
    tags: ["cig supplier erp integration overview", "managed gateway supplier add-on cloud connector", "supported erp versions ehp4 ehp8", "sales order creation from purchase order", "order confirmation outbound supported transactions", "single sign on sbn managed gateway", "attachment size limit base64 encoding", "multi anid not supported restriction"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P2: outbound delivery (restrictions), billing document (credit memo, charges), forward error handling (FEH PPO reprocess), S/4HANA Cloud integration (4A1 order-to-invoice, SOAP web services), S/4HANA on-premise integration
    pattern: /CIGOverviewSup_Part2[ .]|CIGOverviewSup_Part2$/i,
    tags: ["outbound delivery restrictions update cancel", "billing document credit memo charges", "forward error handling feh ppo", "reprocess failed transaction feh", "status update request sur feh", "s4hana cloud 4a1 order to invoice", "soap web services s4hana cloud routing", "s4hana multi erp systemid not supported"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /CIGOverviewSup/i,
    tags: ["cig supplier erp overview guide", "sales order order confirmation outbound delivery billing", "forward error handling feh", "s4hana cloud 4a1 integration"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  // ── CIG and SBN Overview 1 (17 parts) ────────────────────────────────────
  // ERP-to-SBN integration guide — buyer-facing; master data + outbound/inbound transactions
  // Non-timestamped _PartN.pdf collapse to merged docKey; handled by the first entry.
  // Timestamped parts get individual docKeys matched by per-part entries.
  {
    pattern: /CIG and SBN Overview 1$/i,
    tags: [
      "cig", "managed gateway", "sbn", "buyer", "erp", "s4hana",
      "master data", "supplier master", "vendor", "catalog", "purchase information records",
      "direct connectivity", "mediated connectivity", "sap pi",
      "purchase order", "service po", "scheduling agreement", "goods receipt",
      "invoice", "service sheet", "advance payment", "payment remittance",
      "non-po invoice", "fi invoice", "vertex tax", "asset management", "stock reservation", "blanket po",
      "account assignment category n", "network id",
      "s4hana cloud public edition", "mdni", "mdi", "partitioned supplier data", "child site mapping",
      "central invoice management", "transaction tracker",
    ],
    excludeTags: ["iata", "fc"],
  },
  {
    // P1: CIG product renaming history, add-on components ARBCI1/ARBCI2/ARBCIGR, supported ERP/S4HANA versions, TLS 1.2, IaaS tools, unsupported features
    pattern: /CIG and SBN Overview 1_Part1[ .]|CIG and SBN Overview 1_Part1$/i,
    tags: ["cig product renaming history", "managed gateway add-on components", "arbci1 arbci2 arbcigr install", "supported erp versions ehp", "s4hana certification versions", "tls 1.2 connectivity requirement", "document validator transaction tracker", "ariba solutions overview list", "unsupported features limitations"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P2: S/4HANA 2022/2023/2025 certifications, data flow diagrams (Commerce Automation, Discounting, Payables/SCF, Supply Chain)
    pattern: /CIG and SBN Overview 1_Part2[ .]|CIG and SBN Overview 1_Part2$/i,
    tags: ["s4hana 2022 2023 2025 certification", "data flow diagrams overview", "commerce automation data flow", "supply chain financing discounting flow", "quality inspection notification flow", "smi subcontracting consignment returns", "payables collaboration flow diagram", "cig connectivity overview diagram"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P3: Data flow diagrams (Buying/Invoicing, Sourcing/Contracts/SLP), high-level setup steps, master data (full/incremental load, ASCII system IDs), import master data for Ariba Procurement
    pattern: /CIG and SBN Overview 1_Part3[ .]|CIG and SBN Overview 1_Part3$/i,
    tags: ["buying invoicing data flow", "sourcing contracts slp data flow", "cig high level setup steps", "master data full incremental load", "ascii system id configuration", "import supplier master data", "payment terms users gl account", "cost center wbs asset master"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P4: Supplier location (SL_VENDOR_ADDRESS, GRBasedInvoicingPreferred), remittance location, supplier block/delete, multi-ERP FPC, CHANGELOG_RETENTION_DAYS, parent/child realm segregation
    pattern: /CIG and SBN Overview 1_Part4[ .]|CIG and SBN Overview 1_Part4$/i,
    tags: ["supplier location vendor address", "gr based invoicing preferred flag", "remittance location rl vendor address", "supplier block delete handling", "multi erp fpc enabled export", "changelog retention days parameter", "parent child realm segregation", "user supplier master segregation"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P5: Supplier incremental load, payment terms import (ENHANCED_PAYMENT_TERMS), tax code master data (input/withholding tax, CSV), catalog CIF file integration, ARBCIG_FIELDMAP
    pattern: /CIG and SBN Overview 1_Part5[ .]|CIG and SBN Overview 1_Part5$/i,
    tags: ["supplier incremental load operations", "enhanced payment terms import", "input withholding tax code master", "taxcomponent taxcodeheader csv export", "catalog cif file integration", "arbcig buyer catalog export", "catalog incremental load fieldmap", "payment terms day limit configuration"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P6: Master data CSV-RFC mapping table, funds management CSV, language export, direct connectivity (NTLM unsupported), mediated via SAP PI (SOAP, shared secret/cert), material classification, manufacturer parts list HERS/AML
    pattern: /CIG and SBN Overview 1_Part6[ .]|CIG and SBN Overview 1_Part6$/i,
    tags: ["master data csv rfc mapping", "funds management csv export", "direct connectivity temp directory", "mediated connectivity soap pi", "shared secret client certificate", "material classification class type", "manufacturer parts list hers aml", "language export arbcig master data"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P7: SAP Retail integration (ARBCIGR, EA-RETAIL), article types, IDocs (ARTMAS/BOMMAT/CLSMAS), display set process, supplier SM Administration (BusinessPartnerSUITEBulkReplicateRequest, multi vendor ID key mapping)
    pattern: /CIG and SBN Overview 1_Part7[ .]|CIG and SBN Overview 1_Part7$/i,
    tags: ["sap retail arbcigr integration", "article types single generic variant", "display set prepack sales set", "artmas bommat idoc retail", "supplier sm administration integration", "business partner suite bulk replicate", "multiple vendor id key mapping", "ea retail component requirement"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P8: MDG/DRF supplier replication (DRFOUT), SLP integration scenarios, MDNI product master (ARBCIG_MDNI_PRODUCTMASTER, ProductMDMBulkReplicateRequest_Out, MDNIProductExport)
    pattern: /CIG and SBN Overview 1_Part8[ .]|CIG and SBN Overview 1_Part8$/i,
    tags: ["mdg drf supplier replication drfout", "supplier slp integration scenarios", "create supplier ariba erp flow", "slp integration prerequisites", "master data native integration mdni", "arbcig mdni productmaster export", "product mdm bulk replicate proxy", "mdni product export doc type"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P9: Outbound procurement transactions: contracts (service hierarchy, tiered/term pricing), payment remittance (BTE, BAdI), advance payment (F-48), goods receipts, closed PO status, ERP-initiated SES, ERP-initiated PR (full/incremental, demand aggregation, work order)
    pattern: /CIG and SBN Overview 1_Part9[ .]|CIG and SBN Overview 1_Part9$/i,
    tags: ["contract service hierarchy tiered pricing", "payment remittance export bte badi", "advance payment remittance f48", "goods receipt movement types export", "closed po status integration", "erp initiated ses service sheet", "purchase requisition full incremental load", "work order requisition demand aggregation"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P10: Budget check (FM Area/earmarked fund/grant, TLC), PO integration (amount-based, changed/canceled, ProcessERPHeaderStatusPull), taxes/charges, attachments/comments (GOS/DMS), ERS, service POs (simplified procurement, spend limits)
    pattern: /CIG and SBN Overview 1_Part10[ .]|CIG and SBN Overview 1_Part10$/i,
    tags: ["budget check funds management fm area", "earmarked fund grant po integration", "process erp header status pull", "taxes charges po integration tlc", "gos header dms line attachments", "ers evaluated receipt settlement po", "service requisition simplified procurement", "service po spend limits configuration"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P11: Service PO prerequisites (EHP4+, SRVMAPKEY), account assignment U, SAP Fieldglass (SOW/work orders), plant info (SAPPlant, AllowAdhocShipToAddress), goods receipt (movement types 101/102/negative, amount-based, subcontractor), advance payment (BTE, split accounting)
    pattern: /CIG and SBN Overview 1_Part11[ .]|CIG and SBN Overview 1_Part11$/i,
    tags: ["service po ehp4 prerequisites notes", "srvmapkey log mm p2pse1 activation", "account assignment u unknown service", "fieldglass sow work order requisition", "sapplant cluster adhoc ship to address", "goods receipt movement type 101 102", "subcontractor info goods receipt", "advance payment bte split accounting"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P12: Service sheets (planned/unplanned, hierarchy, canceled SES), invoice types (PO/non-PO/service/credit memo), withholding tax (ARBCIG_WHT_TYPE), GR-based invoice verification (multiple GR matching, partial), invoice attachments (GOS, 74MB), duplicate invoice check BAdI, non-PO FI invoices
    pattern: /CIG and SBN Overview 1_Part12[ .]|CIG and SBN Overview 1_Part12$/i,
    tags: ["service sheet planned unplanned hierarchy", "invoice types po non po credit memo", "withholding tax invoice arbcig wht type", "gr based invoice verification matching", "invoice attachments gos 74mb limit", "duplicate invoice check badi", "non po fi invoice p2p enabled", "asset transaction type fi non po"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P13: Withholding tax non-PO, one-time vendor (field lengths), Vertex external tax engine (full/partial/no accrual), asset management (asset class export, dummy asset, ARBCIG_CHANGEDOC), stock inventory (IMS, IngestStockRequest, QueryStockRequest), stock reservation (ENABLE_MRO_INVENTORY), blanket PO (item category B), account assignment N (network/activity)
    pattern: /CIG and SBN Overview 1_Part13[ .]|CIG and SBN Overview 1_Part13$/i,
    tags: ["one time vendor non po invoice", "vertex external tax engine accrual", "asset class export dummy asset", "stock inventory ims ingest query request", "inventory batch size configuration", "stock reservation mro inventory enable", "blanket po item category b framework", "account assignment network activity export"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P14: S/4HANA Cloud Public Edition integration scenarios (2NV guided buying, 42K source-to-pay, 4BL sourcing, 4AZ contracts, 5I2 subcontracting, J44 MRP, 6BJ central procurement, 4A1 order-to-invoice), Fieldglass endpoint, ARBCIG_MASTERDATA BAdI
    pattern: /CIG and SBN Overview 1_Part14[ .]|CIG and SBN Overview 1_Part14$/i,
    tags: ["s4hana cloud public edition integration scenarios", "guided buying 2nv ariba buying requisition", "source to pay 42k business network", "sourcing 4bl contract management 4az", "subcontracting 5i2 mrp exception j44", "central procurement 6bj 4b0 quotes 5jt", "fieldglass endpoint sap service procurement 4r2", "arbcig masterdata badi publish network names"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P15: Batch-managed materials ASN (supplier batch ID, manufacture/expiry date), serial numbers in inbound delivery S/4HANA Cloud, lean service items PO, account assignment N network activity, MDI/MDNI product master
    pattern: /CIG and SBN Overview 1_Part15[ .]|CIG and SBN Overview 1_Part15$/i,
    tags: ["batch managed materials asn inbound delivery", "supplier batch id manufacture expiry date", "serial numbers inbound delivery s4hana cloud", "lean service items purchase order", "account assignment category n network activity", "mdni product master export integration", "mrp change request integration 65d"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P16: MDI parameters (BPKM KeyMappingObjectSchemaCode/Type), BUP007 ANID sync to S/4HANA Cloud, partitioned supplier data child site mapping, S/4HANA Cloud supplier admin parameters
    pattern: /CIG and SBN Overview 1_Part16[ .]|CIG and SBN Overview 1_Part16$/i,
    tags: ["mdi bpkm key mapping object schema", "bup007 anid sync s4hana cloud public", "partitioned supplier data child site mapping", "application sm businesspartner enablebup007 sync", "vendor info anid field supplier data", "central invoice management configuration"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P17: Contract integration (4AZ PurchaseContractRequest/StatusUpdateRequest, cloud connector), Sourcing (4BL), Fieldglass (4R2), cXML-to-JSON conversion, Central Procurement quotes (5JT), Subcontracting (5I2), MRP J44/65D
    pattern: /CIG and SBN Overview 1_Part17[ .]|CIG and SBN Overview 1_Part17$/i,
    tags: ["purchase contract request 4az integration", "purchasecontractstatusupdate cloudconnector", "sourcing 4bl integration scenario", "service procurement fieldglass 4r2", "central procurement quotes 5jt", "subcontracting 5i2 mrp change j44 65d", "cxml to json transformation", "contract management s4hana ariba contracts"],
    excludeTags: ["iata", "fc"],
  },

  // ── CIG and SBN Overview 2 (22 parts) ────────────────────────────────────
  // ERP-to-SBN integration guide — buyer-facing; outbound/inbound transactions volume 2
  {
    pattern: /CIG and SBN Overview 2$/i,
    tags: [
      "cig", "managed gateway", "sbn", "buyer", "erp", "s4hana",
      "purchase order", "scheduling agreement", "service po", "subcontracting po", "consignment po", "stock transport order",
      "order enquiry", "erp-initiated invoice", "goods receipt", "receipt", "payment remittance", "payment batch",
      "product activity message", "smi", "forecast collaboration", "edi 830", "edi 846",
      "order confirmation", "ship notice", "invoice inbound", "service sheet inbound",
      "packaging handling units", "packing instructions",
      "quality certificates", "quality inspection", "quality notification", "docusign", "rma",
      "serial numbers", "material product hierarchy", "data format conversion", "brfplus output management",
      "clinical trial collaboration", "rfq", "bill of materials", "engineering change order",
      "contracts inbound", "pricing scales", "direct integration bypass",
      "spend analysis", "ted public procurement",
      "test central", "mapping tool", "document mapper", "conditional mapping",
      "transaction tracker", "forward error handling", "aif monitoring",
      "sap cloud alm", "business data export",
    ],
    excludeTags: ["iata"],
  },
  {
    // P1: Outbound transactions list for SBN, PR to SBN (ARBCIG_OB_VENDOR), PO types/features (company code/batch-managed, MRP controller, Sold-To/VAT ID, OrderRequest enhancements, aerospace defense FedRAMP, external document types, work order-based POs, version integration, blocking/closing DeliveryCompleted)
    pattern: /CIG and SBN Overview 2_Part1[ .]|CIG and SBN Overview 2_Part1$/i,
    tags: ["outbound transactions sbn list overview", "purchase requisition sbn vendor filter", "orderrequest cxml po enhancements", "aerospace defense fedraMP authorizeduser", "work order based purchase order", "po version integration delivery completed", "external document type purchase order", "blocking closing line items po sbn"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P2: Service PO (lean services, 5-level hierarchy, blanket/contingency/informatory, unplanned spend limits), simplified procurement, subcontracting PO (BOM, batch, multitier CopyRequest, handling units), consignment PO (category K, LP/LPA), returns (movement types 161/122)
    pattern: /CIG and SBN Overview 2_Part2[ .]|CIG and SBN Overview 2_Part2$/i,
    tags: ["service po lean services 5 level hierarchy", "blanket contingency informatory service po", "unplanned spend limit error messages", "subcontracting po bom batch handling units", "multitier copy partner subcontracting", "consignment po category k lp lpa", "returns movement type 161 122", "gr based s based invoice verification"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P3: PO prerequisites/restrictions (SRVMAPKEY, consignment APPL 604, HANDLING_UNITS, confirmation control keys AB/LA), common restrictions (surcharge/discount/freight, 100MB attachment), STO (intracompany/intercompany, serial numbers, modified ship notices Planned/Actual, inventory unrestricted/in-transit)
    pattern: /CIG and SBN Overview 2_Part3[ .]|CIG and SBN Overview 2_Part3$/i,
    tags: ["po prerequisites restrictions srvmapkey", "confirmation control key ab la", "attachment limit 100mb po restriction", "stock transport order intracompany intercompany", "sto serial numbers modified ship notice", "sto planned actual ship notice types", "inventory unrestricted in transit sto", "surcharge discount freight po mapping"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P4: STO workflows (OEM-CM, CM-CM with/without copy partner, replenishment delivery PGI, SPED, serial number BAdI), order enquiry (MAHN/AUFB output types), scheduling agreement release (LP/LPA, forecast/JIT, ARBCIG_DELINS IDoc, multitier copy partner, version integration, BRFplus output management)
    pattern: /CIG and SBN Overview 2_Part4[ .]|CIG and SBN Overview 2_Part4$/i,
    tags: ["sto oem cm workflow copy partner", "replenishment delivery pgi sped delivery", "sto serial number badi processing", "order enquiry mahn aufb output type", "scheduling agreement release lp lpa", "forecast jit delivery instruction idoc", "scheduling agreement version integration", "brfplus output management sa release"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P5: ERP-initiated invoice for SBN (GSVERF/ARBCIG_GSVERF IDocs, FIDCC2/ARBCIG_FIDCC2, invoice ID extrinsic fields, INVOICE_DOC_OPTION, MRIS invoicing plan settlement, subsequent debit memos R2108, tax details R2311, ERS services MRRL), ERP-initiated SES for SBN (specific vendors, XBLNR field)
    pattern: /CIG and SBN Overview 2_Part5[ .]|CIG and SBN Overview 2_Part5$/i,
    tags: ["erp initiated invoice gsverf fidcc2 idoc", "invoice id extrinsic fields buyerinvoiceid", "invoice doc option fi cxml indicator", "mris invoicing plan settlement periodic", "subsequent debit memo r2108 processing", "tax details r2311 line item level", "ers services mrrl erp initiated", "erp initiated ses xblnr enhancement"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P6: Receipt for SBN (multitier subcontracting receipts, correction/return movement types 101/102/103/122/123/124/161, proof of delivery 541/30A+30C), component ship notice (one-step 541/two-step, drop ship, PGI), invoice status update (ISU BTE, parked invoice limitation), scheduled payments (PaymentProposalRequest, DISCOUNT_BASE_WITH_NO_TAX)
    pattern: /CIG and SBN Overview 2_Part6[ .]|CIG and SBN Overview 2_Part6$/i,
    tags: ["receipt multitier subcontracting sbn", "proof delivery movement 541 30a 30c", "component ship notice drop ship pgi", "invoice status update bte parked invoice", "isp registration invite r2505", "payment proposal request scheduled payment", "discount base no tax parameter", "receipt correction return movement types"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P7: Payment remittance outbound (canceled payments ARBCIG_REM_CANCEL, PaymentRemittanceStatusUpdateRequest, bank account masking), AribaPay (F110/CPOR_BULK), Barclaycard Precisionpay, Goldman Sachs international (PAY_IN_DOCUMENT_CURRENCY), product activity message (SMI extract, enhanced interface MRP Group/Batch/Requirement Date, EDI X12 846 vs 830, custom BAdI)
    pattern: /CIG and SBN Overview 2_Part7[ .]|CIG and SBN Overview 2_Part7$/i,
    tags: ["payment remittance canceled arbcig rem cancel", "bank account masking payment batch request", "aribapay f110 cpor bulk processing", "barclaycard precisionpay bnk cpor badi", "goldman sachs pay document currency", "product activity message smi extract", "enhanced smi mrp group batch requirement date", "edi x12 846 830 selection logic"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P8: Product activity message custom BAdI XPaths, service sheet response, BOM integration (SOAP→JSON, material BOM, ISO UOM), inbound transactions list for SBN, order confirmation (AB category, manufacturer part HERS, OC for SA/SAR), order confirmation approval (quantity/date/price deviations, Approve/Reject/Approve-and-Update, OCA multilevel)
    pattern: /CIG and SBN Overview 2_Part8[ .]|CIG and SBN Overview 2_Part8$/i,
    tags: ["product activity message custom badi xpath", "bom integration soap json material iso uom", "inbound transactions sbn list", "order confirmation ab category manufacturer part", "oc scheduling agreement attachments header", "order confirmation approval deviation handling", "approve reject update po oc approval", "oca sa sar single multilevel approval"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P9: Ship notice (ASN cancel → inbound delivery deletion R2505, component info BAdI ARBCIG_ADVANCE_SHIPMENT_NOTICE), packaging info with handling units (13-step workflow), packaging instructions fields (PackagingSpecificationID/Material/Capacity/Level/PackagingMaterial/Dimensions/Weight), auxiliary packaging materials
    pattern: /CIG and SBN Overview 2_Part9[ .]|CIG and SBN Overview 2_Part9$/i,
    tags: ["asn cancel inbound delivery deletion r2505", "ship notice component info badi", "packaging handling units 13 step workflow", "packaging specification material capacity level", "packaging dimensions weight instructions", "auxiliary packaging materials ship notice", "arbcig advance shipment notice enhancement", "ship notice packaging info fields"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P10: Auxiliary packaging prerequisites (category D VERP, 3-level max, feature flags), invoice from SBN (non-PO as MM invoice, cross-company code, header credit memos, cancel invoice → credit memo, parking header-only invoice HEADER_FLAG/INFO_FLAG, non-PO as FI invoice, KR KG doc types)
    pattern: /CIG and SBN Overview 2_Part10[ .]|CIG and SBN Overview 2_Part10$/i,
    tags: ["auxiliary packaging category verp 3 level", "invoice sbn non po mm invoice", "cross company code invoice processing", "cancel invoice credit memo negative quantity", "header only invoice parking header flag", "fi invoice detail request inbound", "invoice erp request krdoc kg doc type", "invoice park no account assignment"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P11: Summary invoice (multiple POs, material items), direct invoicing service POs (auto-generated SES, simplified procurement), consignment withdrawal invoice (FIInvoiceDetailRequest, CONS_INVOICE), payment receipt confirmation (Mexico SAT, PaymentReceiptConfirmationRequest), service sheet for SBN (hierarchy, auto-generated, spend limits with contract reference, UOM display issue CUNI)
    pattern: /CIG and SBN Overview 2_Part11[ .]|CIG and SBN Overview 2_Part11$/i,
    tags: ["summary invoice multiple po materials", "direct invoicing service po auto ses", "consignment withdrawal invoice fi enabled", "cons invoice slg1 badi consignment", "payment receipt confirmation mexico sat", "payment receipt confirmation cxml request", "service sheet sbn hierarchy auto generated", "service sheet spend limit cuni uom issue"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P12: Service sheet limitations (negative values, character limits 16/12/40, no taxes/charges/shipping), remittance advice (supply chain financing provider), PayMeNow (SAP Note 1954584), liability transfer (SCF), component consumption request (real-time backflush, MES visibility), product replenishment message (forecast/SMI, AGGR_SMI_BATCH), replenishment order (SalesOrderRequest, RO_DOC_TYPE)
    pattern: /CIG and SBN Overview 2_Part12[ .]|CIG and SBN Overview 2_Part12$/i,
    tags: ["service sheet character limits negative values", "remittance advice supply chain financing", "payme now early payment discount", "liability transfer scf payment proposal", "component consumption backflush mes visibility", "consmptn gr split batch parameter", "product replenishment received quantity aggr smi", "replenishment order sales order request badi"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P13: Replenishment order limitations, quality certificates in ship notices (mandatory/optional per PO line, QC53, certificate received/expected), quality inspection (QualityInspectionRequest/ResultRequest/DecisionRequest cXML, DocuSign CoA, inspection plan types quantitative/qualitative, BAdI, ARBCIG_RESEND_QINSP_REQ_CRTD)
    pattern: /CIG and SBN Overview 2_Part13[ .]|CIG and SBN Overview 2_Part13$/i,
    tags: ["quality certificate ship notice mandatory optional", "qm control key certificate type qc53", "certificate received expected status", "quality inspection request result decision cxml", "docusign certificate of analysis inspection", "inspection plan quantitative qualitative characteristics", "arbcig quality inspection badi customization", "resend quality inspection failed request"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P14: Quality notification (Q6/Q7 types, customized types, defect analysis/complaint/deviation, attachments, BAdI, QN_STAT_FILTER, internal task/activity filtering, serial numbers, RMA number, QNNotes mapping, USE_PLANT_TIMEZONE, prerequisites/restrictions for supply chain quality collaboration)
    pattern: /CIG and SBN Overview 2_Part14[ .]|CIG and SBN Overview 2_Part14$/i,
    tags: ["quality notification q6 q7 custom types", "quality notification defect complaint deviation", "qn stat filter system user status", "internal task activity filter quality notification", "arbcig quality notification badi customization", "rma number quality notification integration", "qnnotes mapping long text formatting", "use plant timezone quality notification"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P15: Material product hierarchy mapping to SBN (7 levels max), EAN/UPC and manufacturer part in product activity, material group ERPCommodityCode, data format conversion (ENABLE_EXTFORMAT_MASTERDATA/SUPPLIER_ONLY/ISO_UOM), external format conversion routines, serial numbers in subcontracting/standard items (LOG_MM_SERNO business function)
    pattern: /CIG and SBN Overview 2_Part15[ .]|CIG and SBN Overview 2_Part15$/i,
    tags: ["material product hierarchy sbn classification", "erpcommoditycode ean upc manufacturer part", "data format conversion external format", "enable extformat iso uom parameter", "serial numbers subcontracting standard items", "log mm serno business function serial", "serial number purchase order ship notice receipt", "external format vendor material document conversion"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P16: RFQ (QuoteRequest cXML, SAP Ariba Sourcing integration, material/service items, new/against PR/against contract, attachments, ARBCIG_RFQ_TEXTS, SBN Discovery/Commerce Automation RFQ events), BOM for product sourcing (SOAP, simple/group/variant/multiple BOM, single-level export), engineering change orders (ECO, ChangeNumber/RevisionLevel in ItemMaster, BOM Replicate Request, BAdI)
    pattern: /CIG and SBN Overview 2_Part16[ .]|CIG and SBN Overview 2_Part16$/i,
    tags: ["rfq quote request ariba sourcing cxml", "rfq text descriptions internal external users", "sbn discovery commerce automation rfq event", "bom product sourcing single level export", "bom simple group variant multiple types", "engineering change order eco bom", "change master changenumber revisionlevel itemmaster", "arbcig change request badi customization"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P17: RFQ with service items (5-level hierarchy, alternative service specification Basic Line/Altern Line), QuoteMessage/QuoteMessageContractServices (contract document type determination, ContractRequest/ContractRequestServices), advanced pricing conditions and scales in outline agreements (gross price/discount/surcharge, monthly/quarterly/annually/custom validity, quantity scales From/To), production facility information in contracts (partner determination, ARBCI2 component), standard item categories/custom document types (LP/LPA/WK/MK)
    pattern: /CIG and SBN Overview 2_Part17[ .]|CIG and SBN Overview 2_Part17$/i,
    tags: ["rfq service items alternative specification", "contract request service document type", "quotemessage contract request determination", "advanced pricing conditions outline agreement", "quantity scale from to pricing validity", "production facility contract partner function", "contract scheduling agreement item category", "custom document type contract lp lpa wk mk"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P18: Scheduling agreements from SAP Ariba Contracts (LP/LPA, ARBCIG_SCHEDGAGRMT BAdI, ARBCIG_SRC_CONT_MAP transaction, advanced pricing scales), scheduling agreements from SAP Ariba Sourcing (QuoteMessageSchedulingAgreement), direct integration data residency requirements (SRC_DIRECT parameter, bypass SBN, Saudi Arabia data center), spend analysis (ARBCIG_SPENDVISIBILITY_EXPORT, flex dimensions BAdI, SpendAnalysisPurchaseOrderImport/InvoiceImport doc types)
    pattern: /CIG and SBN Overview 2_Part18[ .]|CIG and SBN Overview 2_Part18$/i,
    tags: ["scheduling agreement ariba contracts lp lpa", "quotemessage scheduling agreement sourcing", "scheduling agreement badi arbcig schedgagrmt", "direct integration data residency src direct", "bypass sbn saudi arabia data center", "spend analysis export flex dimensions badi", "spend analysis po invoice import doc types", "arbcig src cont map transaction code"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P19: RFQ/contract restrictions (no terminated contract support, only ERP creates POs from awards), spend analysis sending PO/invoice data (credit memo, non-PO, S-based IV, custom date range, ARBCIG_RESEND_BATCH_EXTRACT), direct integration for data residency (QuoteRequest outbound, ContractRequest/SchedulingAgreement/QuoteMessageOrder inbound, certificate-based auth), TED portal public procurement notices (PriorInformationNotice/ContractNotice/ContractAwardNotice cXML)
    pattern: /CIG and SBN Overview 2_Part19[ .]|CIG and SBN Overview 2_Part19$/i,
    tags: ["rfq contract restrictions terminated contract", "spend analysis po invoice credit memo export", "spend analysis custom date range time period", "resend batch extract spend analysis error", "direct integration certificate based authentication", "ted portal public procurement notice", "prior information contract award notice cxml", "sbn bypass ariba sourcing direct flow"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P20: Attachments/comments by transaction type (full table: OC/ASN/invoice/ship notice/SES/order enquiry/payment remittance etc.), Test Central for buyer regression testing (test suite creation, baseline vs target XML comparison, passed/updated/failed status, manual steps, Update BaseLine button, supported originating doc types, restrictions)
    pattern: /CIG and SBN Overview 2_Part20[ .]|CIG and SBN Overview 2_Part20$/i,
    tags: ["attachments comments transaction type table", "test central regression testing buyer", "test suite baseline target xml comparison", "passed updated failed test case status", "manual steps test central configuration", "update baseline xml button feature", "test central restrictions attachments esignature", "orderrequest invoicedetailrequest test central"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P21: Mapping tool (custom mappings, Document Mapper, source/target graphical view, conditional mapping operators contains/empty/exists, uppercase/lowercase functions, Add/Edit/Deploy/Undeploy/Synchronize icons, mapping version details), formatting text descriptions in mapping documents (Max Characters/Delimiter parameters), custom mapping administration (Extension Framework tab, deploy/undeploy self-service, CREATE/DEPLOY_TEST/DEPLOY_PROD actions, transaction tracking tools)
    pattern: /CIG and SBN Overview 2_Part21[ .]|CIG and SBN Overview 2_Part21$/i,
    tags: ["mapping tool custom xslt document mapper", "conditional mapping contains exists operators", "uppercase lowercase function mapping", "mapping version deploy undeploy synchronize", "extension framework self service deploy", "text description split max characters delimiter", "transaction tracker document validator connectivity", "custom mapping version log actions"],
    excludeTags: ["iata", "fc"],
  },
  {
    // P22: Error monitoring (SRT_MONI, NACE, Transaction Tracker), forward error handling FEH (PPO PostProcessingOffice, SUR status update request, edit payload reprocess, discard, supported async transactions), SAP AIF monitoring (SAP Notes, S/4HANA 1610+), audit logging (90-day retention, UTC, CUSTOMER_DATA_DOWNLOADS table), SAP Cloud ALM integration, business data export (ZIP CSV encrypted), SAP Integration Suite 42K package (S/4HANA Cloud SOAP→cXML, guided buying 2NV/3EN)
    pattern: /CIG and SBN Overview 2_Part22[ .]|CIG and SBN Overview 2_Part22$/i,
    tags: ["forward error handling feh ppo reprocess", "status update request sur inbound failure", "sap aif application interface framework monitoring", "audit logging 90 day retention utc", "sap cloud alm integration exception monitoring", "business data export zip csv encrypted", "s4hana cloud 42k integration suite package", "guided buying 2nv 3en ariba buying integration"],
    excludeTags: ["iata", "fc"],
  },

  // ── Supply Chain Collaboration Configuration (SBN variant, non-timestamped) ─
  // "SAP Business Network for Supply Chain Integration and Configuration Guide"
  // Same content as regular variant — per-part tags mirror SupplyChainCollaborationConfiguration_Part* entries.
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part1[ .]|SupplyChainCollaborationConfiguration_SBN_Part1$/i,
    tags: ["supply chain overview buyer setup guide", "cxml document routing scc", "alternate routing enablement", "deployment process stages", "adapter integration sap netweaver", "buyer account entitlement vendor csv", "logistics relationship request", "buyer controlled order routing advanced packaging"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part2[ .]|SupplyChainCollaborationConfiguration_SBN_Part2$/i,
    tags: ["enable disable scc supplier relationship", "vendor csv upload enablesccwithretail", "logistics relationship supplier request", "buyer controlled routing conditions override", "ordertype cxml mapping planning type", "mto mts ato item category subcontract", "transactioncategoryortype extrinsic routing", "supplier enablement task management"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part3[ .]|SupplyChainCollaborationConfiguration_SBN_Part3$/i,
    tags: ["handling unit labels workflow", "packaging instructions upload automated transfer", "s4hana packaging instruction xslt label", "auto numbering handling units gtl", "sscc format gs1 numbering", "sap integration suite managed gateway packaging", "packaging specification id fields", "material maximum capacity is printable"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part4[ .]|SupplyChainCollaborationConfiguration_SBN_Part4$/i,
    tags: ["handling unit profile packaging wizard", "auxiliary materials auto packaging", "freight carrier list csv upload", "carrier codes template replenishment", "replenishment order horizon time bucket", "replenishment daily weekly planning settings", "allow suppliers edit price replenishment", "custom configuration supplier group"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part5[ .]|SupplyChainCollaborationConfiguration_SBN_Part5$/i,
    tags: ["rejection code upload ocr priority csv", "key figures planning collaboration reference", "order forecast days of supply smi", "forecast commit standard key figure", "asn receipt transaction key figure", "proj stock soh projected stock", "upside forecast supplier managed replenishment", "supplier managed inventory view key figures"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part6[ .]|SupplyChainCollaborationConfiguration_SBN_Part6$/i,
    tags: ["component planning collaboration key figures", "purchase order inbound beginning inventory finishgood", "components with shortage calculated", "create custom key figures formula editor", "time based formula result i-1 previous bucket", "open firmed order open repl order", "match transaction quantities system id", "ignore supplier part number matching"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part7[ .]|SupplyChainCollaborationConfiguration_SBN_Part7$/i,
    tags: ["customer defined attributes planning view", "planning view attributes library", "root attribute searchable attribute", "create add edit delete attribute", "60 attribute maximum planning view limit", "planningtimeseries cxml expression", "planner code customer location attribute", "planning items unique combination"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part8[ .]|SupplyChainCollaborationConfiguration_SBN_Part8$/i,
    tags: ["forecast planning collaboration views standard", "custom views duplication conditions", "defining conditions attribute value view", "cxml product activity message view", "supply chain monitor configuration", "monitor component requirements buyer dashboard", "supply chain monitor settings administration", "confirmation alerts forecast inventory alerts"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part9[ .]|SupplyChainCollaborationConfiguration_SBN_Part9$/i,
    tags: ["order confirmation deviation alerts config", "supplier comments supply chain monitor", "smi exceptions above maximum below minimum", "forecast exceptions missing commits decommits", "configure supply chain monitor access", "deviation approval transaction rule", "line item tolerance quantity price date", "awaiting approval deviation status export"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part10[ .]|SupplyChainCollaborationConfiguration_SBN_Part10$/i,
    tags: ["notification types supply chain buyers", "transaction rules rule reference directory", "component consumption rules subcontracting", "require batch matching component inventory", "asset serial number consumed components", "component consumption upload download excel", "component line group 600 rows limit", "requiresrealtimeconsumption control key"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part11[ .]|SupplyChainCollaborationConfiguration_SBN_Part11$/i,
    tags: ["order change request rules supplier proposed", "split change request response line number", "order confirmation ship notice rules", "schedule line level confirmation tolerance", "edit components subcontracting order confirmation", "quality notification ship notice restriction", "allow edit estimated shipping delivery dates", "items to confirm table visibility"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part12[ .]|SupplyChainCollaborationConfiguration_SBN_Part12$/i,
    tags: ["order confirmation deviation buyer approval", "multilevel single level deviation approval", "except quantity price date deviations", "allow inspection acceptance ship notice", "quality certificate attachment ship notice", "quality collaboration rules docusign", "non po quality notifications multi erp", "scheduling agreement collaboration jit forecast rule"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part13[ .]|SupplyChainCollaborationConfiguration_SBN_Part13$/i,
    tags: ["scheduling agreement release confirmation rule", "retain schedule line confirmation new version", "ship notice sscc format packing slip unique", "ship notice type actual estimated serial number", "multitier ship notice component receipt rule", "setting default transaction rules supplier group", "quality review auto numbering", "upload quality notification codes csv type subject defect"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part14[ .]|SupplyChainCollaborationConfiguration_SBN_Part14$/i,
    tags: ["quality notification codes example upload", "quality collaboration notifications settings per supplier", "override scheduling agreement release jit forecast", "supplier rules forecast commit lock horizon", "refresh forecast data manufacturing visibility", "component planning collaboration enable setting", "match customer part id location", "supplier managed inventory process type setting"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part15[ .]|SupplyChainCollaborationConfiguration_SBN_Part15$/i,
    tags: ["sap business network roles predefined", "administrator role permissions buyer", "create modify role permissions", "reassign users different role", "delete role procedure 25 custom max", "purchasing manager vendor manager roles", "user administration permission role based", "role assignment buyer account"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part16[ .]|SupplyChainCollaborationConfiguration_SBN_Part16$/i,
    tags: ["create buyer user authorization profile", "order collaboration authorization profile config", "quality collaboration authorization fields", "planning collaboration planner code", "company code purchasing organization profile", "change user role reset password", "transfer administration ownership", "6000 users maximum upload download job"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part17[ .]|SupplyChainCollaborationConfiguration_SBN_Part17$/i,
    tags: ["sap business network permissions full list", "buyer dashboard supply chain collaboration permission", "inbox order access permission", "forecast visibility planning permission", "quality collaboration access permission", "supply chain monitor settings administration", "customization editor publisher permission", "prevent manual sign in sso corporate"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part18[ .]|SupplyChainCollaborationConfiguration_SBN_Part18$/i,
    tags: ["purchase order line item delete indicator", "operation delete itemout cxml", "retain order confirmation changed line items", "direct material fields order invoice", "external information sources saml sso", "high tech industry order collaboration", "orderrequestheaderindustry componentconsumptiondetails", "items to confirm list supplier workbench"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part19[ .]|SupplyChainCollaborationConfiguration_SBN_Part19$/i,
    tags: ["order change requests workbench tile filters", "scheduling agreement release ship notice attribute", "isschedulingagreementrelease releaseinfo cxml", "stock transport order search filters intra inter", "subcontract mro maintenance repair overhaul", "supplier copies documents multitier path node", "financial fields masked document copy", "scheduling agreement release confirmation workbench"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part20[ .]|SupplyChainCollaborationConfiguration_SBN_Part20$/i,
    tags: ["multitier order collaboration oem cm", "extended collaboration tab component inventory", "contract manufacturing subcontracting po component", "component ship notice receipt backflush", "real time component consumption message", "consignment collaboration buyer stock movement", "consignmentinventory consignmentmovement cxml", "manufacturing visibility csv productreplenishmentmessage"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part21[ .]|SupplyChainCollaborationConfiguration_SBN_Part21$/i,
    tags: ["forecast collaboration forecastconfirmation cxml", "supplier managed inventory smi vmi consigned", "self billing invoice ers scheduling agreement", "quality inspection collaboration workflow lot", "docusign electronic signature inspection", "copy suppliers quality inspection multitier", "quality inspection after ship notice workflow", "usage decision inspection lot"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part22[ .]|SupplyChainCollaborationConfiguration_SBN_Part22$/i,
    tags: ["docusign integration setup api account id", "electronic envelope docusign consent", "quality notification customization project", "customization project workflow editor publisher", "push to supplier test account customization", "create quality notification customization", "quality notification field customization self service", "request to publish customization editor"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part23[ .]|SupplyChainCollaborationConfiguration_SBN_Part23$/i,
    tags: ["add field customization quality notification", "field rules hide read only required", "quality notification type field rule condition", "document mode create edit rule", "add extrinsic fields customization cxml", "customize quality notification sections limit", "hide tabs defects partner info", "multi condition rule and if or if"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part24[ .]|SupplyChainCollaborationConfiguration_SBN_Part24$/i,
    tags: ["hide sections quality notification customization", "publish customization project assign suppliers", "create new version customization delete unpublished", "component planning collaboration bom s4hana", "enable component planning collaboration setting", "component planning tile workbench list page", "30 components maximum finished good limit", "component planning details page"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part25[ .]|SupplyChainCollaborationConfiguration_SBN_Part25$/i,
    tags: ["bom matching material id plant id examples", "component used multiple finished goods", "material component and finished good", "quality review collaboration types batch record", "complaint investigation quality review request", "quality review request statuses create", "quality review email notification reply", "supply chain monitor feature prerequisites"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part26[ .]|SupplyChainCollaborationConfiguration_SBN_Part26$/i,
    tags: ["order confirmation deviation alerts tile", "deviation approval email notification frequency", "approve reject order confirmation deviation", "purchasingagent contact cxml element", "deviation approval order type filter", "awaiting approval awaiting erp status", "export csv order confirmation approvals", "smi forecast commit shortage decommit alert"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part27[ .]|SupplyChainCollaborationConfiguration_SBN_Part27$/i,
    tags: ["deviation approval behavior po vs sa sar", "single level multilevel deviation configuration", "deviation approve update reject workflow", "smi alerts donut chart exception group", "quality notification chart top ten", "forecast alerts commit shortage decommit chart", "freight collaboration bn4l integration buyer managed transport", "supplier managed transportation lsp carrier"],
    excludeTags: ["iata", "gtt"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part28[ .]|SupplyChainCollaborationConfiguration_SBN_Part28$/i,
    tags: ["freight collaboration bn4l asn ship notice routing", "shippingnetwork bn4l indicator purchase order", "forwardingagent partner function transport", "transportation requirement lsp carrier", "shipment plan bill of lading carrier update", "shipment planning status in planning planned", "ship notice workbench tile new", "home page widgets tile bar workbench customizable"],
    excludeTags: ["iata", "gtt"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part29[ .]|SupplyChainCollaborationConfiguration_SBN_Part29$/i,
    tags: ["view component receipts ship notices buyer", "forecast commitment multitier orders view", "serial numbers list export orders view", "transport confirmations requests search filters", "resend failed document private suppliers", "serial numbers component receipts", "custom attributes customization projects extrinsic", "characteristic attribute cxml path orderrequest"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part30[ .]|SupplyChainCollaborationConfiguration_SBN_Part30$/i,
    tags: ["customization project workflow editor publisher", "create customization project excel workbench", "order confirmation ship notice excel template", "customize standard attributes excel template", "add custom attributes excel template required", "include attribute resulting cxml document", "customize workbench tile columns filters", "alternative label translation attribute customization"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    pattern: /SupplyChainCollaborationConfiguration_SBN_Part31[ .]|SupplyChainCollaborationConfiguration_SBN_Part31$/i,
    tags: ["publish customization project production account", "create new version delete unpublished project", "upload download templates job types all", "build priority consignment copy partner template", "forecast inventory replenishment template criteria", "manufacturing visibility order change requests template", "transaction document report template types", "creating running deleting jobs scc reports"],
    excludeTags: ["iata", "gtt", "fc"],
  },

  // ── Supply Chain Collaboration Configuration (non-SBN, timestamped 16.26.00) ─
  // Per-part entries handle the timestamped docKeys (_PartN 16.26.00).
  // The non-timestamped non-SBN variant (_PartN.pdf) collapses to one merged docKey;
  // the entry below handles that merged key.
  {
    pattern: /SupplyChainCollaborationConfiguration$/i,
    tags: [
      "supply chain collaboration", "scc", "sbn", "buyer configuration",
      "deployment process", "buyer system integration", "cxml adapter", "supplier enablement",
      "packaging instructions", "handling unit", "gtl numbering",
      "replenishment order", "rejection codes", "key figures", "order forecast", "forecast commit", "days of supply",
      "custom key figure", "formula editor", "planning views", "supply chain monitor",
      "oc deviation approval", "deviation alerts", "smi alerts",
      "component consumption rules", "component consumption upload",
      "order confirmation rules", "ship notice rules", "schedule line level", "tolerance validation",
      "scheduling agreement release", "jit delivery", "serial numbers", "sscc",
      "user roles", "authorization profiles", "purchasing organization",
      "permissions list", "archive access", "buyer dashboard",
      "direct material fields", "items to confirm", "order change requests workbench",
      "multitier order collaboration", "contract manufacturing", "consignment collaboration",
      "docusign integration", "quality notification collaboration", "field customization",
      "component planning", "bom data", "quality review collaboration",
      "workbench tile", "component receipts", "service sheets",
      "customization projects", "excel template", "cxml path", "extrinsic attributes",
      "copy partner addition", "freeze horizon", "commit lock",
      "component shipment report", "open orders report", "quality inspection report",
      "quality notification report", "serial number report",
      "field reference", "component shipments fields", "transport confirmations fields",
    ],
    excludeTags: ["iata", "gtt"],
  },
  {
    // P1: table of contents — overview to field reference, all chapters listed
    pattern: /SupplyChainCollaborationConfiguration_Part1[ .]|SupplyChainCollaborationConfiguration_Part1$/i,
    tags: ["supply chain overview buyer setup guide", "cxml document routing scc", "alternate routing enablement", "deployment process stages", "adapter integration sap netweaver", "buyer account entitlement vendor csv", "logistics relationship request", "buyer controlled order routing advanced packaging"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P2: supplier relationship config — enable/disable SCC, CSV batch upload, logistics relationship, buyer controlled routing (cXML field mapping), order routing override, planning types, item categories
    pattern: /SupplyChainCollaborationConfiguration_Part2[ .]|SupplyChainCollaborationConfiguration_Part2$/i,
    tags: ["enable disable scc supplier relationship", "vendor csv upload enablesccwithretail", "logistics relationship supplier request", "buyer controlled routing conditions override", "ordertype cxml mapping planning type", "mto mts ato item category subcontract", "transactioncategoryortype extrinsic routing", "supplier enablement task management"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P3: advanced packaging config — handling unit labels workflow, S/4HANA automated packaging instruction transfer, GS1/GTL numbering, SSCC format, packaging spec fields, Is Printable
    pattern: /SupplyChainCollaborationConfiguration_Part3[ .]|SupplyChainCollaborationConfiguration_Part3$/i,
    tags: ["handling unit labels workflow", "packaging instructions upload automated transfer", "s4hana packaging instruction xslt label", "auto numbering handling units gtl", "sscc format gs1 numbering", "sap integration suite managed gateway packaging", "packaging specification id fields", "material maximum capacity is printable"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P4: packaging spec fields continued, handling unit profile, packaging wizard, auxiliary materials, freight carrier list CSV upload, replenishment order config (horizon/time bucket/planning settings)
    pattern: /SupplyChainCollaborationConfiguration_Part4[ .]|SupplyChainCollaborationConfiguration_Part4$/i,
    tags: ["handling unit profile packaging wizard", "auxiliary materials auto packaging", "freight carrier list csv upload", "carrier codes template replenishment", "replenishment order horizon time bucket", "replenishment daily weekly planning settings", "allow suppliers edit price replenishment", "custom configuration supplier group"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P5: rejection code config + Planning & Forecast Key Figures reference table (standard and calculated metrics: ORDER_FORECAST, FORECAST_COMMIT, DAYS_OF_SUPPLY_SMI, ASN_RECEIPT, PROJ_STOCK_SOH, UPSIDE_FORECAST)
    pattern: /SupplyChainCollaborationConfiguration_Part5[ .]|SupplyChainCollaborationConfiguration_Part5$/i,
    tags: ["rejection code upload ocr priority csv", "key figures planning collaboration reference", "order forecast days of supply smi", "forecast commit standard key figure", "asn receipt transaction key figure", "proj stock soh projected stock", "upside forecast supplier managed replenishment", "supplier managed inventory view key figures"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P6: Component Planning Collaboration Key Figures (PURCHASE_ORDER_INBOUND, BEGINNING_INVENTORY_FINISHGOOD, COMPONENTS_WITH_SHORTAGE) + create/edit/reorder custom key figures + time-based formula editor + OPEN_FIRMED_ORDER, OPEN_REPL_ORDER + match transaction quantities/ignore supplier part number
    pattern: /SupplyChainCollaborationConfiguration_Part6[ .]|SupplyChainCollaborationConfiguration_Part6$/i,
    tags: ["component planning collaboration key figures", "purchase order inbound beginning inventory finishgood", "components with shortage calculated", "create custom key figures formula editor", "time based formula result i-1 previous bucket", "open firmed order open repl order", "match transaction quantities system id", "ignore supplier part number matching"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P7: planning view attributes — standard vs customer-defined, create/copy/add/edit/delete attribute, root/searchable attribute, 60 attribute maximum, PlanningTimeSeries cXML expression, planning items unique combination
    pattern: /SupplyChainCollaborationConfiguration_Part7[ .]|SupplyChainCollaborationConfiguration_Part7$/i,
    tags: ["customer defined attributes planning view", "planning view attributes library", "root attribute searchable attribute", "create add edit delete attribute", "60 attribute maximum planning view limit", "planningtimeseries cxml expression", "planner code customer location attribute", "planning items unique combination"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P8: Forecast & Planning Collaboration views — standard views list (aggregated), custom views duplication, defining view conditions, Supply Chain Monitor config, monitor component requirements, Buyer Dashboard, alerts tiles permissions
    pattern: /SupplyChainCollaborationConfiguration_Part8[ .]|SupplyChainCollaborationConfiguration_Part8$/i,
    tags: ["forecast planning collaboration views standard", "custom views duplication conditions", "defining conditions attribute value view", "cxml product activity message view", "supply chain monitor configuration", "monitor component requirements buyer dashboard", "supply chain monitor settings administration", "confirmation alerts forecast inventory alerts"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P9: Supply Chain Monitor — supplier comments display, OC deviation alert settings, SMI alert settings, forecast alert settings, configure monitor access permissions, allow non-compliant OC submission
    pattern: /SupplyChainCollaborationConfiguration_Part9[ .]|SupplyChainCollaborationConfiguration_Part9$/i,
    tags: ["order confirmation deviation alerts config", "supplier comments supply chain monitor", "smi exceptions above maximum below minimum", "forecast exceptions missing commits decommits", "configure supply chain monitor access", "deviation approval transaction rule", "line item tolerance quantity price date", "awaiting approval deviation status export"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P10: notification types, Rule Reference directory, Component Consumption Rules (subcontracting, require batch matching, asset serial number, upload/download Excel, job type, 600 rows limit, requiresRealTimeConsumption control key)
    pattern: /SupplyChainCollaborationConfiguration_Part10[ .]|SupplyChainCollaborationConfiguration_Part10$/i,
    tags: ["notification types supply chain buyers", "transaction rules rule reference directory", "component consumption rules subcontracting", "require batch matching component inventory", "asset serial number consumed components", "component consumption upload download excel", "component line group 600 rows limit", "requiresrealtimeconsumption control key"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P11: Order Change Request Rules + Order Confirmation and Ship Notice Rules (first half: schedule line level, validate tolerance, edit components subcontracting, quality notification restriction, allow edit dates, past date validation, Items to Confirm visibility)
    pattern: /SupplyChainCollaborationConfiguration_Part11[ .]|SupplyChainCollaborationConfiguration_Part11$/i,
    tags: ["order change request rules supplier proposed", "split change request response line number", "order confirmation ship notice rules", "schedule line level confirmation tolerance", "edit components subcontracting order confirmation", "quality notification ship notice restriction", "allow edit estimated shipping delivery dates", "items to confirm table visibility"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P12: OC and Ship Notice Rules (continued: deviation buyer approval, multilevel/single level, exceptions) + Attachment Rules + PO Rules + Quality Collaboration Rules + Scheduling Agreement Rules (first half)
    pattern: /SupplyChainCollaborationConfiguration_Part12[ .]|SupplyChainCollaborationConfiguration_Part12$/i,
    tags: ["order confirmation deviation buyer approval", "multilevel single level deviation approval", "except quantity price date deviations", "allow inspection acceptance ship notice", "quality certificate attachment ship notice", "quality collaboration rules docusign", "non po quality notifications multi erp", "scheduling agreement collaboration jit forecast rule"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P13: Scheduling Agreement Rules (continued) + Ship Notice Rules + set default rules + supplier group rules + quality auto-numbering + quality notification code upload
    pattern: /SupplyChainCollaborationConfiguration_Part13[ .]|SupplyChainCollaborationConfiguration_Part13$/i,
    tags: ["scheduling agreement release confirmation rule", "retain schedule line confirmation new version", "ship notice sscc format packing slip unique", "ship notice type actual estimated serial number", "multitier ship notice component receipt rule", "setting default transaction rules supplier group", "quality review auto numbering", "upload quality notification codes csv type subject defect"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P14: quality notification code examples + quality collaboration notification config + scheduling agreement release type override + planning/forecast/manufacturing visibility rules (detailed settings table)
    pattern: /SupplyChainCollaborationConfiguration_Part14[ .]|SupplyChainCollaborationConfiguration_Part14$/i,
    tags: ["quality notification codes example upload", "quality collaboration notifications settings per supplier", "override scheduling agreement release jit forecast", "supplier rules forecast commit lock horizon", "refresh forecast data manufacturing visibility", "component planning collaboration enable setting", "match customer part id location", "supplier managed inventory process type setting"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P15: Users and Roles — Administrator role, predefined roles, create/modify/reassign/delete roles, 25 custom roles max, role-based access control, Purchasing Manager Vendor Manager roles
    pattern: /SupplyChainCollaborationConfiguration_Part15[ .]|SupplyChainCollaborationConfiguration_Part15$/i,
    tags: ["sap business network roles predefined", "administrator role permissions buyer", "create modify role permissions", "reassign users different role", "delete role procedure 25 custom max", "purchasing manager vendor manager roles", "user administration permission role based", "role assignment buyer account"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P16: Users — create user, authorization profile config (order/quality/planning collaboration, company code/purchasing org/planner code), change role/reset password, reassign login, delete user, transfer admin, 6000 users max
    pattern: /SupplyChainCollaborationConfiguration_Part16[ .]|SupplyChainCollaborationConfiguration_Part16$/i,
    tags: ["create buyer user authorization profile", "order collaboration authorization profile config", "quality collaboration authorization fields", "planning collaboration planner code", "company code purchasing organization profile", "change user role reset password", "transfer administration ownership", "6000 users maximum upload download job"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P17: Permissions full list (alphabetical: Buyer Dashboard/Inbox/Forecast/Planning/Quality/Supply Chain Monitor Settings/Customization Editor Publisher/Transaction Configuration) + Prevention of Manual Sign In (SSO)
    pattern: /SupplyChainCollaborationConfiguration_Part17[ .]|SupplyChainCollaborationConfiguration_Part17$/i,
    tags: ["sap business network permissions full list", "buyer dashboard supply chain collaboration permission", "inbox order access permission", "forecast visibility planning permission", "quality collaboration access permission", "supply chain monitor settings administration", "customization editor publisher permission", "prevent manual sign in sso corporate"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P18: Features and Benefits — Orders overview + PO Line Items (delete indicator/retain confirmation) + Direct Material Fields + External Info Sources (SAML SSO) + High-Tech Fields (OrderRequestHeaderIndustry, ComponentConsumptionDetails)
    pattern: /SupplyChainCollaborationConfiguration_Part18[ .]|SupplyChainCollaborationConfiguration_Part18$/i,
    tags: ["purchase order line item delete indicator", "operation delete itemout cxml", "retain order confirmation changed line items", "direct material fields order invoice", "external information sources saml sso", "high tech industry order collaboration", "orderrequestheaderindustry componentconsumptiondetails", "items to confirm list supplier workbench"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P19: Order Change Requests Workbench tile + Scheduling Agreement Releases + search filters + Stock Transport Orders + Subcontract MRO + Supplier Copies of Documents (Path Node type/financial fields masked)
    pattern: /SupplyChainCollaborationConfiguration_Part19[ .]|SupplyChainCollaborationConfiguration_Part19$/i,
    tags: ["order change requests workbench tile filters", "scheduling agreement release ship notice attribute", "isschedulingagreementrelease releaseinfo cxml", "stock transport order search filters intra inter", "subcontract mro maintenance repair overhaul", "supplier copies documents multitier path node", "financial fields masked document copy", "scheduling agreement release confirmation workbench"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P20: Multitier Order Collaboration + Extended Collaboration Tab + Contract Manufacturing + Consignment Collaboration + Manufacturing Planning Visibility (CSV upload, ProductReplenishmentMessage cXML elements)
    pattern: /SupplyChainCollaborationConfiguration_Part20[ .]|SupplyChainCollaborationConfiguration_Part20$/i,
    tags: ["multitier order collaboration oem cm", "extended collaboration tab component inventory", "contract manufacturing subcontracting po component", "component ship notice receipt backflush", "real time component consumption message", "consignment collaboration buyer stock movement", "consignmentinventory consignmentmovement cxml", "manufacturing visibility csv productreplenishmentmessage"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P21: Forecast Collaboration + Supplier-Managed Inventory (consigned/non-consigned) + Self-Billing Invoice (ERS/scheduling agreement) + Quality Inspection Collaboration (workflow, DocuSign, copy suppliers)
    pattern: /SupplyChainCollaborationConfiguration_Part21[ .]|SupplyChainCollaborationConfiguration_Part21$/i,
    tags: ["forecast collaboration forecastconfirmation cxml", "supplier managed inventory smi vmi consigned", "self billing invoice ers scheduling agreement", "quality inspection collaboration workflow lot", "docusign electronic signature inspection", "copy suppliers quality inspection multitier", "quality inspection after ship notice workflow", "usage decision inspection lot"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P22: DocuSign configuration (API Account ID/secret/user ID, electronic envelope, consent) + Quality Notification Collaboration (customization project workflow editor/publisher, create customization, push to test, request publish)
    pattern: /SupplyChainCollaborationConfiguration_Part22[ .]|SupplyChainCollaborationConfiguration_Part22$/i,
    tags: ["docusign integration setup api account id", "electronic envelope docusign consent", "quality notification customization project", "customization project workflow editor publisher", "push to supplier test account customization", "create quality notification customization", "quality notification field customization self service", "request to publish customization editor"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P23: add field customization (Field/System conditions, hide/read-only/required), add new extrinsic fields, customize Sections, hide Tabs
    pattern: /SupplyChainCollaborationConfiguration_Part23[ .]|SupplyChainCollaborationConfiguration_Part23$/i,
    tags: ["add field customization quality notification", "field rules hide read only required", "quality notification type field rule condition", "document mode create edit rule", "add extrinsic fields customization cxml", "customize quality notification sections limit", "hide tabs defects partner info", "multi condition rule and if or if"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P24: QN Customization — hide Sections + publish customization project + create new version + delete unpublished project + Component Planning Collaboration (BOM, enable setting, list page, workbench tile, 30 components max)
    pattern: /SupplyChainCollaborationConfiguration_Part24[ .]|SupplyChainCollaborationConfiguration_Part24$/i,
    tags: ["hide sections quality notification customization", "publish customization project assign suppliers", "create new version customization delete unpublished", "component planning collaboration bom s4hana", "enable component planning collaboration setting", "component planning tile workbench list page", "30 components maximum finished good limit", "component planning details page"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P25: Component Planning Collaboration — BOM matching examples (component used multiple finished goods, material both component and finished good) + Quality Review Collaboration (batch record/complaint/change request/generic, statuses, create, email notification)
    pattern: /SupplyChainCollaborationConfiguration_Part25[ .]|SupplyChainCollaborationConfiguration_Part25$/i,
    tags: ["bom matching material id plant id examples", "component used multiple finished goods", "material component and finished good", "quality review collaboration types batch record", "complaint investigation quality review request", "quality review request statuses create", "quality review email notification reply", "supply chain monitor feature prerequisites"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P26: Supply Chain Monitor — OC deviation alert details + Deviation Approval alerts (email notification, approve/reject flow, purchasingAgent cXML, order type filter, awaiting approval status, export CSV, SMI/forecast alerts)
    pattern: /SupplyChainCollaborationConfiguration_Part26[ .]|SupplyChainCollaborationConfiguration_Part26$/i,
    tags: ["order confirmation deviation alerts tile", "deviation approval email notification frequency", "approve reject order confirmation deviation", "purchasingagent contact cxml element", "deviation approval order type filter", "awaiting approval awaiting erp status", "export csv order confirmation approvals", "smi forecast commit shortage decommit alert"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P27: Deviation Approval Behavior (PO vs SA/SAR) + Configurations (Single/Multi-level tables) + Workflows + Approve/Reject + SMI Alerts donut chart + Quality Notification Chart + Forecast Alerts + Freight Collaboration BN4L integration
    pattern: /SupplyChainCollaborationConfiguration_Part27[ .]|SupplyChainCollaborationConfiguration_Part27$/i,
    tags: ["deviation approval behavior po vs sa sar", "single level multilevel deviation configuration", "deviation approve update reject workflow", "smi alerts donut chart exception group", "quality notification chart top ten", "forecast alerts commit shortage decommit chart", "freight collaboration bn4l integration buyer managed transport", "supplier managed transportation lsp carrier"],
    excludeTags: ["iata", "gtt"],
  },
  {
    // P28: Freight Collaboration Feature — SCC+BN4L integration flow, ASN routing to BN4L, ShippingNetwork indicator, ForwardingAgent, Transportation Requirement LSP, shipment plan Bill of Lading, shipment planning status (In Planning/Planned), new workbench tiles, home page widgets
    pattern: /SupplyChainCollaborationConfiguration_Part28[ .]|SupplyChainCollaborationConfiguration_Part28$/i,
    tags: ["freight collaboration bn4l asn ship notice routing", "shippingnetwork bn4l indicator purchase order", "forwardingagent partner function transport", "transportation requirement lsp carrier", "shipment plan bill of lading carrier update", "shipment planning status in planning planned", "ship notice workbench tile new", "home page widgets tile bar workbench customizable"],
    excludeTags: ["iata", "gtt"],
  },
  {
    // P29: Documents for Buyers — view ComponentReceipts/ShipNotices/Forecast/MultitierOrders/SerialNumbers/TransportConfirmations/TransportRequests + resend failed documents + serial numbers in component receipts + Document Customization (custom attributes, Extrinsic/Characteristic, cXML path)
    pattern: /SupplyChainCollaborationConfiguration_Part29[ .]|SupplyChainCollaborationConfiguration_Part29$/i,
    tags: ["view component receipts ship notices buyer", "forecast commitment multitier orders view", "serial numbers list export orders view", "transport confirmations requests search filters", "resend failed document private suppliers", "serial numbers component receipts", "custom attributes customization projects extrinsic", "characteristic attribute cxml path orderrequest"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P30: Customization Projects — workflow, create project (Excel template + Workbench tile), OC/Ship Notice Excel template standard/custom attributes, customize Workbench tile columns/filters
    pattern: /SupplyChainCollaborationConfiguration_Part30[ .]|SupplyChainCollaborationConfiguration_Part30$/i,
    tags: ["customization project workflow editor publisher", "create customization project excel workbench", "order confirmation ship notice excel template", "customize standard attributes excel template", "add custom attributes excel template required", "include attribute resulting cxml document", "customize workbench tile columns filters", "alternative label translation attribute customization"],
    excludeTags: ["iata", "gtt", "fc"],
  },
  {
    // P31: Publishing/Versioning Customization Projects + Upload/Download Templates (all types: Build Priority/Consignment/Copy Partner/Forecast/Inventory/Manufacturing Visibility/Order Change Requests/Transaction Document) + Creating/Running/Deleting Jobs + Reports for SCC (report types list)
    pattern: /SupplyChainCollaborationConfiguration_Part31[ .]|SupplyChainCollaborationConfiguration_Part31$/i,
    tags: ["publish customization project production account", "create new version delete unpublished project", "upload download templates job types all", "build priority consignment copy partner template", "forecast inventory replenishment template criteria", "manufacturing visibility order change requests template", "transaction document report template types", "creating running deleting jobs scc reports"],
    excludeTags: ["iata", "gtt", "fc"],
  },

  {
    pattern: /Configuration.Guide.for.Business.*Network.Collaboration/i,
    tags: [
      "supply chain collaboration", "scc", "sbn",
      "collaboration", "configuration", "scheduling agreement",
      "replenishment order", "forecast", "planning", "supplier managed inventory",
    ],
  },

  // ── SBN Supplier Administration Guide (timestamped parts, 16.26.00) ────────
  {
    pattern: /SBN Supplier Administration Guide_Part1[ .]/i,
    tags: [
      "enterprise account standard account types",
      "convert enterprise to standard account",
      "delete expire supplier account",
      "temporary account registration type",
      "account types sbn supplier guide",
      "table of contents supplier admin guide",
    ],
    excludeTags: ["btp", "punchout"],
  },
  {
    pattern: /SBN Supplier Administration Guide_Part2[ .]/i,
    tags: [
      "trading partner search contact setting",
      "allow buyer contact company setting",
      "company profile visibility privacy",
      "contact profile allow supplier contact",
      "sbn profile settings trading partner",
    ],
    excludeTags: ["btp", "punchout"],
  },
  {
    pattern: /SBN Supplier Administration Guide_Part3[ .]/i,
    tags: [
      "contact personnel companywide assignment",
      "create contact company profile",
      "contact name email business title",
      "account settings contact management",
      "contact with companywide assignment",
    ],
    excludeTags: ["btp", "punchout"],
  },
  {
    pattern: /SBN Supplier Administration Guide_Part4[ .]/i,
    tags: [
      "vat number validation error resolution",
      "address inconsistency postal code missing",
      "business name discrepancy placeholder",
      "business verification cdq validation",
      "address validation street name mismatch",
    ],
    excludeTags: ["btp", "punchout"],
  },
  {
    pattern: /SBN Supplier Administration Guide_Part5[ .]/i,
    tags: [
      "discovery notifications daily digest",
      "business opportunities buyer postings",
      "email notification settings discovery",
      "disable daily digest notification",
      "posting responses sales contacts",
    ],
    excludeTags: ["btp", "punchout"],
  },
  {
    pattern: /SBN Supplier Administration Guide_Part6[ .]/i,
    tags: [
      "user management customer assignment",
      "customer groups select customers",
      "manage users customer assignment section",
      "sbn supplier user administration",
    ],
    excludeTags: ["btp", "punchout"],
  },
  {
    pattern: /SBN Supplier Administration Guide_Part7[ .]/i,
    tags: [
      "user permissions product sourcing",
      "s4hana sourcing collaboration permission",
      "promote subscription ariba discovery",
      "catalog roles revoke user access",
      "remove personal information account",
    ],
    excludeTags: ["btp", "punchout"],
  },
  {
    pattern: /SBN Supplier Administration Guide_Part8[ .]/i,
    tags: [
      "request trading relationship buyer",
      "viewing requesting potential relationships",
      "customer administration permission read-only",
      "buying organization project trading relationship",
    ],
    excludeTags: ["btp", "punchout"],
  },
  {
    pattern: /SBN Supplier Administration Guide_Part9[ .]/i,
    tags: [
      "account linking decline link request",
      "duplicate account expire unwanted",
      "generative ai product summaries",
      "buyer lead responses promote subscriber",
      "ai features sbn supplier account",
    ],
    excludeTags: ["btp", "punchout"],
  },
  {
    pattern: /SBN Supplier Administration Guide_Part10[ .]/i,
    tags: [
      "document archive deleted transactions",
      "download zip transaction data 30 day",
      "deleted transactions page download",
      "transaction documents permanently deleted",
    ],
    excludeTags: ["btp", "punchout"],
  },

  // ── NON BTP SAP Business Network Supplier Administration Guide (merged) ────
  // Non-timestamped: all 10 parts collapse to single docKey
  // Special entry for mangled filename (newline in path, doesn't match .*):
  {
    pattern: /NON.BTP-SAP Business Network Supplier/i,
    tags: [
      "enterprise account standard account types",
      "convert enterprise to standard account",
      "delete expire supplier account",
      "company profile visibility settings",
      "trading partner search contact settings",
      "company profile certifications quality security",
      "business verification vat number address cdq",
      "business name discrepancy verification failure",
    ],
    excludeTags: ["btp", "punchout", "change order"],
  },
  {
    pattern: /NON.BTP.*Supplier.Administration/i,
    tags: [
      "enterprise account standard account types",
      "convert enterprise to standard account",
      "delete expire supplier account",
      "company profile visibility settings",
      "trading partner search contact settings",
      "company profile certifications quality security",
      "business verification vat number address cdq",
      "business name discrepancy verification failure",
      "contact personnel companywide assignment",
      "discovery notification daily digest",
      "early payment offer standing terms notification",
      "user management roles permissions",
      "customer assignment customer groups restrict access",
      "logistics services user limited access",
      "user permissions catalog inbox orders",
      "promote subscription permissions ariba discovery",
      "revoke user access remove personal information",
      "multifactor authentication mfa user setup",
      "customer relationships trading relationship request",
      "parent child account hierarchy linking",
      "generative ai product summary catalog",
      "data deletion criteria recurring one time",
      "download zip deleted transactions 30 day",
      "transaction data download 90 day export",
      "api management developer portal sso",
      "dun bradstreet duns company profile sync",
    ],
    excludeTags: ["btp", "punchout", "change order"],
  },

  // ── SBN BTP Supplier Admin ─────────────────────────────────────────────────
  {
    // P1: account types (Standard/Enterprise), temporary account (domain ownership/TRR/QE/upgrade), delete account, company profile layout overview
    pattern: /SBN BTP Supplier  Administration Guide_Part1[ .]|SBN BTP Supplier  Administration Guide_Part1$/i,
    tags: ["standard vs enterprise account types", "temporary account domain ownership", "trr quick enablement registration", "upgrade temporary standard account", "account deletion procedure", "company profile layout overview"],
    excludeTags: ["erp", "iata", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P2: edit company info (DUNS/tax/address), product/service categories, keywords, social media, financial/tax/bank/shareholder info, D&B sync, extended profile response
    pattern: /SBN BTP Supplier  Administration Guide_Part2[ .]|SBN BTP Supplier  Administration Guide_Part2$/i,
    tags: ["edit company information duns tax", "product service categories keywords", "financial tax shareholder information", "bank information setup supplier", "sustainability ratings ecovadis", "company showcase promote subscription", "dun bradstreet synchronization profile", "extended profile buyer request"],
    excludeTags: ["erp", "iata", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P3: respond extended profile request, assessments showcase, certification categories (Diversity/Environmental/Quality/Security), manage certifications, additional entities (Sold From/Remit To/Country Config)
    pattern: /SBN BTP Supplier  Administration Guide_Part3[ .]|SBN BTP Supplier  Administration Guide_Part3$/i,
    tags: ["respond extended profile request", "assessments showcase auto share", "certification categories diversity environmental", "managing certifications version control", "certification request buyer response", "additional entities concept", "sold from remit to functions", "global address book gab country config"],
    excludeTags: ["erp", "iata", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P4: Country Config (create/edit/delete), contact management (main/companywide/customer-specific), profile visibility settings, profile data federation cross-datacenter, business verification background
    pattern: /SBN BTP Supplier  Administration Guide_Part4[ .]|SBN BTP Supplier  Administration Guide_Part4$/i,
    tags: ["country configuration tax invoicing setup", "create edit delete country config", "companywide customer specific contacts", "profile visibility settings control", "extended profile sharing options", "profile data federation global replicate", "business verification badge promote", "verification failure resubmit process"],
    excludeTags: ["erp", "iata", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P5: business verification details (CDQ/D&B steps, failure troubleshooting, re-verify), verification badge loss reasons, active supplier status (eligibility/activate/maintain), user roles overview (Manage Users/Manage Roles)
    pattern: /SBN BTP Supplier  Administration Guide_Part5[ .]|SBN BTP Supplier  Administration Guide_Part5$/i,
    tags: ["business verification cdq duns submit", "verification failure troubleshooting cases", "active supplier status eligibility", "company showcase promote exclusive", "manage users roles page", "custom roles permissions create", "mass user upload xlsx template"],
    excludeTags: ["erp", "iata", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P6: create/edit users, reset password, transfer admin role, revoke user access & personal info removal, retention period, MFA setup (organization/user level, login/critical fields MFA)
    pattern: /SBN BTP Supplier  Administration Guide_Part6[ .]|SBN BTP Supplier  Administration Guide_Part6$/i,
    tags: ["create manage users roles", "reset user password transfer admin", "revoke user access gdpr removal", "retention period revoked users", "multifactor authentication mfa setup", "mfa login critical fields configuration", "configure mfa organization level user"],
    excludeTags: ["erp", "iata", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P7: notification detailed config (SES status/failure, Pending Queue, Planning Collaboration, Upload Download, Relationship, Supplier Enablement, Ship Notice, Goods Receipt, Payments), messaging feature overview (online/email/Message Center)
    pattern: /SBN BTP Supplier  Administration Guide_Part7[ .]|SBN BTP Supplier  Administration Guide_Part7$/i,
    tags: ["ses service sheet notifications config", "ship notice payment notification settings", "planning collaboration digest notification", "relationship supplier enablement reminder", "messaging feature message center online", "email messaging conversation sync", "goods receipt remittance alert types"],
    excludeTags: ["erp", "iata", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P8: message management (reopen/delete conversation/delete single message), admin messaging email notification (global/document-level/context-free), Quality Notifications list page UI (view switch/search filters/table fields)
    pattern: /SBN BTP Supplier  Administration Guide_Part8[ .]|SBN BTP Supplier  Administration Guide_Part8$/i,
    tags: ["reopen close delete conversation", "messaging email notification admin config", "context free document specific notification", "quality notification list page ui", "quality notification filters table columns", "visual filters chart view quality", "view settings export quality notifications"],
    excludeTags: ["erp", "iata", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P9: Quality Notifications visual chart filters (status/type donut), Define Conditions, View Settings popup, permissions (Quality Notification Access/Creation), view notification details (Details/Defects/Partner/History tabs)
    pattern: /SBN BTP Supplier  Administration Guide_Part9[ .]|SBN BTP Supplier  Administration Guide_Part9$/i,
    tags: ["quality notification visual chart filter", "define conditions filter quality notification", "view settings sort group columns", "quality notification permission access creation", "quality notification detail tabs", "defects causes impacted batches fields", "partner information shipping billing quality", "quality notification history export pdf"],
    excludeTags: ["erp", "iata", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P10: quality notification header fields, Customer and Part Section fields, Notification Detail, Problem Description/attachments, Return Information, Required Tasks table fields
    pattern: /SBN BTP Supplier  Administration Guide_Part10[ .]|SBN BTP Supplier  Administration Guide_Part10$/i,
    tags: ["quality notification header fields detail", "customer part number batch notification", "notification detail category fields", "problem description attachment quality", "return information quantity field", "required tasks table task category", "activity log section complaint quantity malfunction"],
    excludeTags: ["erp", "iata", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P11: create/edit quality notification steps (supplier: required fields, defects/tasks/activity log), quality email notification settings (events), customer relationship management (auto/manual accept, suspend, customer list columns), language/region settings
    pattern: /SBN BTP Supplier  Administration Guide_Part11[ .]|SBN BTP Supplier  Administration Guide_Part11$/i,
    tags: ["create quality notification supplier steps", "quality notification defects tasks add", "quality email notification event types", "quality inspection alert settings", "customer relationships accept reject automatic", "suspended customer account handling", "preferred language region setting", "customer list columns configuration"],
    excludeTags: ["erp", "iata", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P12: account linking (parent-child concept/benefits), Recommended Accounts/Manage Account Requests/Connected Accounts, profile sync (parent→child), unlink/SSO sign-in to child, generative AI enable (requires Promote), document routing page basics (Override Default/Draft/Saved View)
    pattern: /SBN BTP Supplier  Administration Guide_Part12[ .]|SBN BTP Supplier  Administration Guide_Part12$/i,
    tags: ["parent child account linking hierarchy", "recommended accounts manage requests approve", "connected accounts unlink sso child", "profile sync parent child hierarchy", "account hierarchy permissions table", "generative ai enable promote subscription", "document routing override default", "draft saved version routing page"],
    excludeTags: ["erp", "iata", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P13: Individual Customer Document Routing UI & config steps (assign customers, Quality Collaboration routing exception, cXML Pending Queue/Post/Profile/Online options), short-term invoice archiving (frequency/WORM compliance/auto delivery/ZIP contents)
    pattern: /SBN BTP Supplier  Administration Guide_Part13[ .]|SBN BTP Supplier  Administration Guide_Part13$/i,
    tags: ["individual customer document routing", "routing exceptions quality collaboration", "cxml pending queue post profile online", "assign customer routing method supplier", "short term invoice archiving frequency", "archive worm compliance automatic delivery", "archived zip file contents invoice", "non catalog order routing preference"],
    excludeTags: ["erp", "iata", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P14: cXML Setup (auth method: Shared Secret/Certificate, Profile URL, Post URL), Managed Gateway for Spend & Network config, API client ID, audit logs, data deletion settings (Recurring/One-Time, cancel request, download deleted data ZIP), transaction data download (current/90-day)
    pattern: /SBN BTP Supplier  Administration Guide_Part14[ .]|SBN BTP Supplier  Administration Guide_Part14$/i,
    tags: ["cxml setup authentication shared secret", "cxml profile post url routing", "managed gateway spend network config", "api client id configuration", "audit logs standard access", "data deletion recurring one time request", "download deleted transactions zip 30 day", "transaction data download 90 day"],
    excludeTags: ["erp", "iata", "gtt", "fc", "carrier", "freight"],
  },
  {
    // P15: Analytics data export (request/download steps), API management (SAP Ariba Developer Portal SSO access, API client ID), D&B integration full sync steps (with/without DUNS)
    pattern: /SBN BTP Supplier  Administration Guide_Part15[ .]|SBN BTP Supplier  Administration Guide_Part15$/i,
    tags: ["analytics data export request csv", "analytics download anid permission", "api management developer portal sso", "ariba developer portal api access", "duns bradstreet sync steps profile", "invalid duns alert update procedure"],
    excludeTags: ["erp", "iata", "gtt", "fc", "carrier", "freight"],
  },
  {
    // Fallback catch-all for non-timestamped merged docKey
    pattern: /SBN BTP Supplier.*Administration/i,
    tags: ["standard enterprise account types btp", "company profile verification business", "user management roles mfa btp", "quality notification collaboration btp", "customer routing cxml setup btp", "parent child account hierarchy linking"],
    excludeTags: ["erp", "iata", "gtt", "fc", "carrier", "freight"],
  },

  // ── GITP ──────────────────────────────────────────────────────────────────
  {
    // P1: GITP overview, workflow for guided integration, permissions (Integration Management Full/Read-Only Access), entering GITP, Integration Overview page, questionnaire (Integration Capabilities tile, document-type tile)
    pattern: /GITP_Part1[ .]|GITP_Part1$/i,
    tags: ["guided integration trading partners workflow", "integration management permission access", "integration overview page buyers list", "integration capabilities tile questionnaire", "document type tile questionnaire", "supplier buyer compatibility discovery", "total amount transactions last 12 months", "integration profile completion percentage"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P2: Compatibility dashboard (search buyers, compare integration profile vs buyer rules, identify gaps), compare and reconcile templates (SAP Supplier Super Template, SAP Golden Template, Buyer Template, DTD Template)
    pattern: /GITP_Part2[ .]|GITP_Part2$/i,
    tags: ["compatibility dashboard trading partner", "integration profile buyer rules comparison", "supplier super template golden template", "buyer template dtd template compare", "reconcile template incompatibility gap", "non po invoice order confirmation gap", "add buyers document type integration", "compare reconcile cxml template"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // P3: Template comparison UI (Add All, Save as Draft, Save Template, Download XSD, Cancel), mapping and transforming template via SAP Integration Suite Managed Gateway (Map and Transform Template, SSO, sisgw)
    pattern: /GITP_Part3[ .]|GITP_Part3$/i,
    tags: ["template comparison add all reconcile", "save draft template my workspace", "download xsd supplier template file", "map transform template managed gateway", "integration suite sisgw sso template", "upload supplier template cxml xml file", "save template override current version"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    // Non-timestamped GITP parts (fallback for merged docKey)
    pattern: /GITP$/i,
    tags: ["guided integration trading partners workflow", "integration management permission access", "compatibility dashboard buyer rules", "supplier super template golden template", "reconcile cxml template incompatibility", "map transform template managed gateway"],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },

  // ── UOM Mapping ───────────────────────────────────────────────────────────
  {
    // P1: How mapping codes work (cXML UNUOM → ANSI UOM), mapping inconsistencies, unsupported codes, valid code table (A-prefix codes)
    pattern: /uomMappingForANSI_X12Documents_Part1[ .]|uomMappingForANSI_X12Documents_Part1$/i,
    tags: ["uom mapping cxml ansi x12", "unuom un cefact code ansi", "purchase order uom conversion", "mapping inconsistencies unsupported codes", "cxml to edi uom mapping", "two character ansi uom codes"],
  },
  {
    // P2: Full ANSI↔UNUOM mapping table continued (numeric codes 68-99 and AA-AQ range)
    pattern: /uomMappingForANSI_X12Documents_Part2[ .]|uomMappingForANSI_X12Documents_Part2$/i,
    tags: ["ansi uom unuom value table", "ampere volt ohm farad uom codes", "bulk pack acre byte uom codes", "uom code reference table"],
  },
  {
    // P3: Final mapping table entries (WA-ZZ range)
    pattern: /uomMappingForANSI_X12Documents_Part3[ .]|uomMappingForANSI_X12Documents_Part3$/i,
    tags: ["uom code table week year yard", "ansi uom final codes reference"],
  },
  {
    // Non-timestamped merged fallback
    pattern: /uomMappingForANSI/i,
    tags: ["uom mapping cxml ansi x12", "unuom un cefact ansi uom code table", "cxml edi uom conversion reference"],
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
      "test central supplier faq", "test po non-erp test only", "automated validation feedback", "oc asn invoice credit memo scope", "unlimited test cycles retry", "managed gateway required test central", "integration resource support role", "end-to-end testing after test central", "move connection to production go-live", "test central cxml edi both supported",
    ],
    excludeTags: ["erp", "iata", "gtt", "fc"],
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
      "supplier objections test central responses", "test central extra work response", "impact buyer risk removed design", "onboarded without test central before", "learn new tool learning curve", "test po from real buyer samples", "edi cxml both supported test central", "sap integration resource support role",
    ],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },

  // ── Managed Gateway how-to docs ───────────────────────────────────────────
  {
    pattern: /How.to.Access.Admin.Area.in.Managed.Gateway/i,
    tags: [
      "how to access admin area managed gateway", "ariba admin manage menu", "managed gateway spend network", "data center dropdown select admin area",
    ],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },
  {
    pattern: /How.to.Enable.Managed.Gateway/i,
    tags: [
      "how to enable managed gateway", "enable managed gateway sbn account", "settings manage profile enable", "test production both accounts enable", "sap integration suite managed gateway checkbox",
    ],
    excludeTags: ["erp", "iata", "gtt", "fc"],
  },

  // ── API spec JSON files (full-text matching disabled for these) ──────────
  {
    pattern: /FreightBookingConfirmation_Provider/i,
    tags: ["freight booking confirmation provider api", "booking request confirmation bnl", "lbn freight booking confirmation endpoint", "carrier booking confirmation accept reject"],
  },
  {
    pattern: /FreightBookingRequest_Consumer/i,
    tags: ["freight booking request consumer api", "carrier freight booking process bnl", "lbn freight booking consumer endpoint", "freight booking integration external system"],
  },
  {
    pattern: /FreightOrderForSubcontracting_Consumer/i,
    tags: ["freight order subcontracting consumer api", "carrier freight subcontracting order bnl", "network partner subcontracting consumer"],
  },
  {
    pattern: /FreightOrderForSubcontracting_Provider/i,
    tags: ["freight order subcontracting provider api", "carrier freight subcontracting booking confirmation", "network partner freight order provider"],
  },
  {
    pattern: /FreightTendering_Consumer/i,
    tags: ["freight tendering consumer api", "carrier freight request for quotation", "freight quotation rfq management", "bnl lbn integration endpoint", "bearer auth jwt header", "tendering request response carrier"],
  },
  {
    pattern: /FreightTendering_Provider/i,
    tags: ["freight tendering provider api", "carrier freight quotation response", "lbn bnl freight tendering booking", "tendering confirmation accept reject"],
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
    tags: ["logistics invoice provider api", "carrier invoicing logistics network", "freight invoice submit endpoint", "eu10 us20 data center invoice api", "lbn bnl invoice management"],
  },
  {
    pattern: /LogisticsInvoiceCancel_Provider/i,
    tags: ["logistics invoice cancel provider api", "carrier cancel invoice freight settlement", "invoice cancellation endpoint bnl", "eu10 us20 cancel invoice api"],
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
    tags: ["transportation document consumer api", "carrier transportation planning external system", "bnl lbn transport document management", "bearer auth jwt transportation api"],
  },
  {
    pattern: /TransportationDocument_Provider/i,
    tags: ["transportation document provider api", "carrier transportation document confirmation", "freight order transport plan bnl"],
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
  // Parts cover: document header/disclaimer, deploy model, model header (name/namespace/correlation level),
  // match actual event (match location), actual business timestamp, IDOC integration,
  // application object type, user model fields, additional options (activate/deactivate/delete/export/cache),
  // event to action log, model history, CPE app (planned event details),
  // event to action system embedded functions (toTimestamp, toDate, parseInt, parseFloat, parseTPAltkey),
  // event table parameters (eventTypeCode, eventReasonCode), forwardCurrentTP request body
  {
    pattern: /GTT_.*Model.Administrators/i,
    tags: [
      "gtt", "model administrator", "deploy model", "model header",
      "correlation level", "namespace",
      "match actual event", "match location", "actual business timestamp",
      "idoc integration", "application object type", "user model fields",
      "activate model", "deactivate model", "delete business data", "export business data",
      "model cache", "event to action log", "model history",
      "cpe app", "planned event details",
      "event to action", "embedded functions", "toTimestamp", "toDate",
      "parseInt", "parseFloat", "parseTPAltkey", "alternative key",
      "eventTypeCode", "eventReasonCode", "forwardCurrentTP",
    ],
    excludeTags: ["erp", "tolerance", "purchase order", "freight order", "invoice", "asn"],
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

  // BNL_01: Main FC application help — shipper/admin side
  // Parts cover: location management, post-event notifications, discover business partners,
  // custom headers / credential management, SAC connection, dock appointment settings,
  // time block / loading point, docking location detail, business working hours upload,
  // appointments calendar view, block time, freight order field reference,
  // emissions data (WTT/TTW/CO2), manage freight execution, event reporting,
  // charge line statuses, manage integration logs, error codes, track and trace flow
  {
    pattern: /SAP.Business.Network.Freight.Collaboration_BNL_01/i,
    tags: [
      "location management", "post-event notifications", "discover business partners",
      "custom headers", "credential management", "sac connection", "embedded analytics",
      "dock appointment", "docking location", "time block", "loading point",
      "business working hours", "appointments calendar",
      "freight order fields", "emissions", "co2", "wtt", "ttw", "ghg",
      "manage freight execution", "event reporting", "unplanned event", "reason code",
      "charge line status", "manage integration logs", "error codes",
      "track and trace", "tracking request", "transportation order",
    ],
    excludeTags: ["erp", "purchase order", "order confirmation", "tolerance", "archiving", "vat", "asn"],
  },

  // BNL_02: Main FC application help — carrier side
  // Parts cover: carrier email notification subscriptions, user management (groups/docking locations),
  // manage invitations, freight RFQ (accept/reject), freight orders for confirmation worklist,
  // reject/cancel freight orders, freight order detail (containers/locations),
  // freight booking air/ocean, manage locations (create/upload), dock appointment scheduling (grouped),
  // event reporting (proof of delivery/pickup, skip event), reporting status values,
  // collective invoice creation, invoice worklists (In Error / Ready for Submission),
  // invoice charge line details, invoice process settings / dispute resolution
  {
    pattern: /SAP.Business.Network.Freight.Collaboration_BNL_02/i,
    tags: [
      "carrier email notification", "notification subscription",
      "user management", "user groups", "accessible docking locations",
      "manage invitations",
      "freight rfq", "request for quotation",
      "freight orders for confirmation", "reject freight order", "cancel freight order",
      "freight order detail", "containers", "cargo capacity", "teu",
      "freight booking", "air freight", "ocean freight", "airport",
      "manage locations", "upload locations",
      "dock appointment scheduling", "grouped appointment", "truck license plate",
      "proof of delivery", "proof of pickup", "skip event",
      "reporting status", "reporting completed",
      "collective invoice", "invoice worklist", "invoice in error",
      "invoice charge line", "charge code", "payment terms",
      "invoice dispute", "dispute resolution",
    ],
    excludeTags: ["erp", "purchase order", "iata", "tolerance", "soamanager"],
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
  // Parts cover: carrier onboarding overview, consumer/provider API list,
  // freight settlement/invoice EDI, booking API, system connections (webhooks/outbound services),
  // carrier API settings, freight tracking APIs (post events/geo/ETA/delete),
  // invoice provider API (endpoint/bill-from party/purchasing party),
  // SFTP settings for ANSI X12 204 (file naming pattern), EDI 990 (acceptance code),
  // ANSI X12 214 demo, subcontracting flow, EDIFACT system connections,
  // SFTP settings for IFTMIN, EDIFACT IFTMBC confirmation, IFTMIN subcontracting,
  // implementation effort estimates, consumer API requirements table
  {
    pattern: /04_BN4L_Carrier_Integration/i,
    tags: [
      "carrier integration", "carrier onboarding", "api vs edi",
      "consumer api", "provider api",
      "freight tendering", "freight subcontracting", "freight booking", "order tracking",
      "logistics invoice", "dock appointment",
      "system connections", "outbound services", "webhooks",
      "carrier api settings", "configure partner connection", "cpc",
      "test tenant",
      "oauth", "authentication",
      "ansi x12", "204", "990", "210", "214",
      "sftp", "file naming pattern", "sftp polling",
      "edifact", "iftmin", "iftmbc", "iftsta", "invoic",
      "invoice provider api", "bill from party", "purchasing party",
      "geo coordinates", "eta",
      "implementation effort", "scac",
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
  {
    pattern: /What is Buyer and Supplier KO call/i,
    tags: [
      "scc si kickoff call purpose",
      "buyer ko call supplier ko call distinction",
      "seller integration specialist roles",
      "scc methodology si intro",
      "technical call vs kickoff call",
    ],
    excludeTags: ["cxml", "edi", "erp", "order confirmation", "invoice", "asn"],
  },

  // SCC Buyer Supplier SAP Resources
  // Roles & responsibilities guide: Deployment Descriptions, SCC SI team structure,
  // buyer-side/supplier-side/project holistic activities
  {
    pattern: /^SCC Buyer Supplier SAP Resources/i,
    tags: [
      "deployment description scc methodology",
      "scc si team structure sefl sifl",
      "buyer side activities project holistic",
      "supplier enablement subscription services",
      "scc si roles responsibilities guide",
    ],
    excludeTags: ["cxml", "edi", "order confirmation", "invoice", "asn", "transaction rules"],
  },

  // Training Session 2 SCC Buyer Supplier SAP Resources
  // Cross-training session 2: buyer solution deployment, scc si methodology, technical call definition, supplier integration process per supplier
  {
    pattern: /Training Session 2 SCC Buyer Supplier/i,
    tags: [
      "buyer solution deployment scc methodology",
      "scc technical call supplier integration",
      "sefl sifl sap scc si collaboration",
      "supplier integration process per supplier",
      "scc cross training session 2",
    ],
    excludeTags: ["cxml", "transaction rules", "order confirmation", "invoice", "asn"],
  },

  // SCC Indirect Cross Training Session 1 (Sessio 1 final)
  // Cross-training session 1: SCC indirect vs direct PO collaboration, buyer/supplier complexity, change management, portal/integrated/mixed suppliers
  {
    pattern: /SCC Indirect Cross Training Sessio 1/i,
    tags: [
      "indirect direct po collaboration differences",
      "buyer complexity dimensions locations erp",
      "change management supplier adoption",
      "portal integrated mixed supplier types",
      "scc indirect cross training session 1",
      "business transformation 6 month deployment",
    ],
    excludeTags: ["cxml", "edi", "order confirmation", "asn", "transaction rules"],
  },

  // SCC EMEA Supplier integration - FAQ
  // Internal FAQ: SBN back-end system access, ERP version requirements, middleware, functional design, UAT, adoption
  {
    pattern: /SCC EMEA Supplier integration.*FAQ/i,
    tags: [
      "sbn erp version requirement none",
      "middleware third party provider scc",
      "functional design uat testing supplier",
      "buyer compliance message supplier adoption",
      "scc emea faq supplier integration",
    ],
    excludeTags: ["cxml", "edi", "order confirmation", "asn", "transaction rules"],
  },

  // SCC Indirect Cross Training Purchase Order Collaboration (5 parts, non-timestamped)
  // Cross-training on PO collaboration: OC process, deviation approval, ASN/ship notice, goods receipt, IBD, tolerance rules, transaction rules, change order, cXML fields, schedule lines
  {
    pattern: /SCC Indirect Cross Training Purchase Order Collaboration/i,
    tags: [
      "scc po collaboration direct material",
      "order confirmation deviation approval tolerance",
      "supply chain monitor oc deviation buyer",
      "advance ship notice ibd inbound delivery",
      "change order schedule line cxml po",
      "material requirements planning mrp oc",
      "transaction rules line item purchase order",
      "goods receipt po collaboration scc",
    ],
  },

  // SCC Indirect Cross Training Purchase Order Strucutre (typo intentional — matches filename)
  // PO structure: cXML PO fields, header/line differences indirect vs direct, SCC PO considerations, EDIFACT/X12 alternative formats, packaging info in PO, schedule lines
  {
    pattern: /SCC Indirect Cross Training Purchase Order Stru[uc]ture/i,
    tags: [
      "scc po structure cxml fields header line",
      "indirect direct po field differences",
      "scc po consideration buyer part id",
      "schedule line packaging pallet box po",
      "edifact x12 alternative format scc",
      "order confirmation reference schedule lines",
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
      "subscription level premium bronze silver gold platinum", "annual subscription fee calculator", "transaction volume document count calculation", "enterprise account fee schedule", "non-po invoice po invoice count", "fee calculator estimate subscription", "billing currencies usd eur aud sgd", "brazil chile peru southern africa fee exception",
    ],
    excludeTags: ["erp", "iata", "gtt", "fc"],
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
const removedTags = [];
for (const key of Object.keys(output)) {
  if (!docMeta[key]) {
    removedTags.push(key);
    delete output[key];
  }
}

// Safety check: warn and abort if existing entries would be lost (unless --force)
if (!force && removedTags.length > 0) {
  console.error("\n⚠️  WARNING: The following " + removedTags.length + " existing tag entries would be DELETED:");
  for (const k of removedTags) console.error("  - " + k);
  console.error("\nAborted. No changes written. Run with --force to proceed with deletion.");
  process.exit(1);
} else {
  for (const k of removedTags) console.log(`Removed stale entry: ${k}`);
}

writeFileSync(TAGS_FILE, JSON.stringify(output, null, 2), "utf-8");
console.log(`\nDone: ${updated} updated, ${skipped} skipped (unchanged) → tags.json`);
