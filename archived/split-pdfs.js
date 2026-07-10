import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { PDFDocument } = require(join(__dirname, "node_modules/pdf-lib/cjs/index.js"));

const PAGES_PER_CHUNK = 10;
const OUTPUT_DIR = join(process.env.HOME, "Downloads/split");
const X12_OUTPUT_DIR = join(process.env.HOME, "Downloads/split/X12");
const EDIFACT_OUTPUT_DIR = join(process.env.HOME, "Downloads/split/EDIFACT");
const BNL_OUTPUT_DIR = join(__dirname, "api-specs/split");

const FILES_TO_SPLIT = [
  join(process.env.HOME, "Downloads/SBN/BuyerAdminGuide for BTP Users including Rules.pdf"),
  join(process.env.HOME, "Downloads/SBN/BuyerAdminGuide including Rules.pdf"),
  join(process.env.HOME, "Downloads/SBN/CIG and SBN Overview 1.pdf"),
  join(process.env.HOME, "Downloads/SBN/CIG and SBN Overview 2.pdf"),
  join(process.env.HOME, "Downloads/SBN/CIGConfigSup.pdf"),
  join(process.env.HOME, "Downloads/SBN/CIGOverviewSup.pdf"),
  join(process.env.HOME, "Downloads/SBN/Inovice part2.pdf"),
  join(process.env.HOME, "Downloads/SBN/Invoice part1.pdf"),
  join(process.env.HOME, "Downloads/SBN/SBN BTP Supplier  Administration Guide.pdf"),
  join(process.env.HOME, "Downloads/SBN/SupplyChainCollaborationConfiguration.pdf"),
  join(process.env.HOME, "Downloads/SBN/aribaintegrationportal-CIG for Supplier.pdf"),
  join(process.env.HOME, "Downloads/SBN/cXMLGettingStarted.pdf"),
  join(process.env.HOME, "Downloads/SBN/cXMLReferenceGuide.pdf"),
  join(process.env.HOME, "Downloads/SBN/cxmlSolutions Guide.pdf"),
  join(process.env.HOME, "Downloads/SBN/Buyer Value Prop - Test Central.pdf"),
  join(process.env.HOME, "Downloads/SBN/GITP.pdf"),
  join(process.env.HOME, "Downloads/SBN/Invoice error messages.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network_ Enterprise account fee model.pdf"),
  join(process.env.HOME, "Downloads/SBN/SBN Supplier Account _ Pricing FAQ.pdf"),
  join(process.env.HOME, "Downloads/SBN/uomMappingForANSI_X12Documents.pdf"),
  join(process.env.HOME, "Downloads/SBN/SBN Supplier Administration Guide.pdf"),
  join(process.env.HOME, "Downloads/SBN/NON BTP-SAP Business Network Supplier Administration  Guide.pdf"),
  // Test Central
  join(process.env.HOME, "Downloads/SBN/Test Central/Buyer Objections and Responses.pdf"),
  join(process.env.HOME, "Downloads/SBN/Test Central/Buyer Test Central FAQ.pdf"),
  join(process.env.HOME, "Downloads/SBN/Test Central/Creating Test Case(s) and a corresponding Test scenario.pdf"),
  join(process.env.HOME, "Downloads/SBN/Test Central/How to Access Admin Area in Managed Gateway.pdf"),
  join(process.env.HOME, "Downloads/SBN/Test Central/How to Access Test Central Admin Area in Managed Gateway.pdf"),
  join(process.env.HOME, "Downloads/SBN/Test Central/How to Enable Managed Gateway in your SAP Business Network Account.pdf"),
  join(process.env.HOME, "Downloads/SBN/Test Central/How to Prep PO Examples for Test Central Templates.pdf"),
  join(process.env.HOME, "Downloads/SBN/Test Central/How to use the BUYER_TC_Scenario_Tracker Template.pdf"),
  join(process.env.HOME, "Downloads/SBN/Test Central/Internal Test Central Instructions.pdf"),
  join(process.env.HOME, "Downloads/SBN/Test Central/Quick Guide for Troubleshooting Test Scenarios.pdf"),
  join(process.env.HOME, "Downloads/SBN/Test Central/Supplier How To Use Guide – Test Central.pdf"),
  join(process.env.HOME, "Downloads/SBN/Test Central/Supplier Objections and Responses.pdf"),
  join(process.env.HOME, "Downloads/SBN/Test Central/Supplier TC Cheat Sheet.pdf"),
  join(process.env.HOME, "Downloads/SBN/Test Central/Supplier Test Central FAQ.pdf"),
  join(process.env.HOME, "Downloads/SBN/Test Central/Talking points for Introducing Test Central.pdf"),
  join(process.env.HOME, "Downloads/SBN/Test Central/Test Central - How to Guide for Suppliers.pdf"),
  join(process.env.HOME, "Downloads/SBN/Test Central/Test Central Setup Checklist.pdf"),
  // SBN new docs
  join(process.env.HOME, "Downloads/SBN/Configuration Guide for Business Network Collaboration.pdf"),
  join(process.env.HOME, "Downloads/SBN/SupplyChainCollaborationConfiguration_SBN.pdf"),
  join(process.env.HOME, "Downloads/SBN/Standard B2B Formats on Managed Gateway and SBN.pdf"),
  // SBN EDI X12 4010 docs
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 AG824 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 AG824 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 AR943 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 AR943 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 AW947 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 CA865 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 FA997 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 FA997 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 IB846 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 IB846 Consignment 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 IB846 MO PO 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 IB846 SMI 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 IN810 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 NC842 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 NC842 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 OW940 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 PC860 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 PO850 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 PO850 Salesorder 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 PR855 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 PS830 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 PS830 Order 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 PS830 ProductActivity 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 QM214 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 RA820 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 RC861 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 RC861 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 RE944 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 RE944 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 RT863 QualityInspectionDecision 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 RT863 QualityInspectionRequest 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 RT863 QualityInspectionResult 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 SC832 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 SH856 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 SH856 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 SM204 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 SM204 Multi-Consignment 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 SQ866 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 SS862 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 SW945 4010 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 SW945 4010 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network X12 TX864 4010 Outbound.pdf"),
  // SBN0508 new docs
  join(process.env.HOME, "Downloads/SBN0508/IK20 INT Supplier Integration Overview_Suppliers_JPN.pdf"),
  join(process.env.HOME, "Downloads/SBN0508/IK20 INT Supplier Integration Overview_Suppliers.pdf"),
  join(process.env.HOME, "Downloads/SBN0508/INT Integration Overview eBook_Buyers.pdf"),
  join(process.env.HOME, "Downloads/SBN0508/INT Integration Overview_Buyers.pdf"),
  // SBN EDI EDIFACT D96A docs
  join(process.env.HOME, "Downloads/SBN/SAP Business Network EDIFACT DELFOR Order based D96A Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network EDIFACT DELFOR ProductActivity based D96A Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network EDIFACT DELJIT D96A Order based Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network EDIFACT DESADV D96A Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network EDIFACT IFTMIN D96A Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network EDIFACT IFTSTA D96A Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network EDIFACT INVOIC D96A Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP_EDIFACT ORDCHG_D96A Out.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP_EDIFACT ORDERS_D96A Out.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network EDIFACT ORDRSP D96A Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network EDIFACT RECADV D96A Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network EDIFACT REMADV D96A Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network EDIFACT CONTRL D3 Inbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network EDIFACT CONTRL D3 Outbound.pdf"),
  join(process.env.HOME, "Downloads/SBN/SAP Business Network EDIFACT INVOIC D01B Inbound.pdf"),
  // BNL docs
  join(process.env.HOME, "Downloads/BNL/01SAP Business Network for Logistics – Freight Booking API (Ocean)- SAP Community.pdf"),
  join(process.env.HOME, "Downloads/BNL/02SAP Business Network for Logistics – Freight Booking API (Ocean)- SAP Community.pdf"),
  join(process.env.HOME, "Downloads/BNL/Activate Your Account.pdf"),
  join(process.env.HOME, "Downloads/BNL/Administration Guide for Logistics Providers.pdf"),
  join(process.env.HOME, "Downloads/BNL/Administration Guide for Shippers.pdf"),
  join(process.env.HOME, "Downloads/BNL/APIs in SAP Business Network Freight  Collaboration.pdf"),
  join(process.env.HOME, "Downloads/BNL/Assign Codes App - A Key to Seamless Carrier Integ... - SAP Community.pdf"),
  join(process.env.HOME, "Downloads/BNL/Business Network for Logistics - Testing BN4L API... - SAP Community.pdf"),
  join(process.env.HOME, "Downloads/BNL/Code List_SAP Business Network Freight Collaboration_BNL.pdf"),
  join(process.env.HOME, "Downloads/BNL/Frequently Asked Questions (FAQs).pdf"),
  join(process.env.HOME, "Downloads/BNL/Getting Started Guide for Shippers.pdf"),
  join(process.env.HOME, "Downloads/BNL/GTT_Activate Your Account.pdf"),
  join(process.env.HOME, "Downloads/BNL/GTT_Administration Guide for Logistics Providers.pdf"),
  join(process.env.HOME, "Downloads/BNL/GTT_Administration Guide for Solution Owners.pdf"),
  join(process.env.HOME, "Downloads/BNL/GTT_API Documentation.pdf"),
  join(process.env.HOME, "Downloads/BNL/GTT_Code List.pdf"),
  join(process.env.HOME, "Downloads/BNL/GTT_Getting Started Guide for Solution Owners.pdf"),
  join(process.env.HOME, "Downloads/BNL/GTT_How to Send Notifications.pdf"),
  join(process.env.HOME, "Downloads/BNL/GTT_SAP_BN4L_Premium_CPI_Migration.pdf"),
  join(process.env.HOME, "Downloads/BNL/GTT_uide for Model Administrators.pdf"),
  join(process.env.HOME, "Downloads/BNL/How to connect to Network Partner in Business Netw... - SAP Community.pdf"),
  join(process.env.HOME, "Downloads/BNL/How to Integrate SAP Business Network Global Track and Trace with Ariba Network.pdf"),
  join(process.env.HOME, "Downloads/BNL/How to Integrate with SAP Business Network  Freight Collaboration (Carrier APIs).pdf"),
  join(process.env.HOME, "Downloads/BNL/How to Send Messages with Tracking APIs (Global Track and Trace).pdf"),
  join(process.env.HOME, "Downloads/BNL/Integration Platform Migration Guide.pdf"),
  join(process.env.HOME, "Downloads/BNL/Integration with SAP Business Network for Logistics without SFTP server- SAP Community.pdf"),
  join(process.env.HOME, "Downloads/BNL/Invoice Upload Guide_SAP Business Network Freight Collaboration.pdf"),
  join(process.env.HOME, "Downloads/BNL/SAP Business Network For Logistics - Carrier Side API and EDI.pdf"),
  join(process.env.HOME, "Downloads/BNL/SAP Business Network For Logistics - Road EDI Integration- SAP Community.pdf"),
  join(process.env.HOME, "Downloads/BNL/SAP Business Network for Logistics_ Get your first... - SAP Community.pdf"),
  join(process.env.HOME, "Downloads/BNL/SAP Business Network for Logistics_Carrier Integration Kickoff Deck (carrier-facing).pdf"),
  join(process.env.HOME, "Downloads/BNL/SAP Business Network for Logistics- Best Practice.pdf"),
  join(process.env.HOME, "Downloads/BNL/SAP Business Network Freight Collaboration_BNL_01.pdf"),
  join(process.env.HOME, "Downloads/BNL/SAP Business Network Freight Collaboration_BNL_02.pdf"),
  join(process.env.HOME, "Downloads/BNL/SAP Business Network Global Track and Trace_Product.pdf"),
  join(process.env.HOME, "Downloads/BNL/SAP_LBN_EDI_HowToGuide_GTT.pdf"),
  join(process.env.HOME, "Downloads/BNL/SAP_LBN_GTT_FAQs.pdf"),
  join(process.env.HOME, "Downloads/BNL/SAP_LBN_p44_config_guide.pdf"),
  join(process.env.HOME, "Downloads/BNL/SAP_LBN_p44_FSD.pdf"),
  join(process.env.HOME, "Downloads/BNL/Tips & Tricks with SAP Business Network for Logist... - SAP Community.pdf"),
  join(process.env.HOME, "Downloads/BNL/Understanding Network Partner Integration in SAP B... - SAP Community.pdf"),
  join(process.env.HOME, "Downloads/BNL/04_BN4L_Carrier_Integration.pdf"),
  // SCC docs
  join(process.env.HOME, "Downloads/SBN/OC Supply chain monitor - Suppliers 2026 V1.pdf"),
  join(process.env.HOME, "Downloads/SBN/Order Confirmation Process for Suppliers 2026 V1.pdf"),
  join(process.env.HOME, "Downloads/SBN/Order confirmation with Approval Flow in Scope - Logic 2026 V1.pdf"),
  join(process.env.HOME, "Downloads/SBN/SCC Buyer Supplier SAP Resources .pdf"),
  join(process.env.HOME, "Downloads/SBN/SCC EMEA Supplier integration - FAQ (1).pdf"),
  join(process.env.HOME, "Downloads/SBN/SCC Indirect Cross Training Purchase Order Collaboration.pdf"),
  join(process.env.HOME, "Downloads/SBN/SCC Indirect Cross Training Purchase Order Strucutre.pdf"),
  join(process.env.HOME, "Downloads/SBN/SCC Indirect Cross Training Sessio 1 final.pdf"),
  join(process.env.HOME, "Downloads/SBN/Training Session 2 SCC Buyer Supplier SAP Resources .pdf"),
  join(process.env.HOME, "Downloads/SBN/What is Buyer and Supplier KO call 2026.pdf"),
];

mkdirSync(OUTPUT_DIR, { recursive: true });
mkdirSync(X12_OUTPUT_DIR, { recursive: true });
mkdirSync(EDIFACT_OUTPUT_DIR, { recursive: true });
mkdirSync(BNL_OUTPUT_DIR, { recursive: true });

async function splitPDF(filePath) {
  const isBNL = filePath.includes("/Downloads/BNL/");
  const isX12 = filePath.includes(" X12 ");
  const isEDIFACT = filePath.includes(" EDIFACT ") || filePath.includes("_EDIFACT ");
  const outDir = isBNL ? BNL_OUTPUT_DIR : isX12 ? X12_OUTPUT_DIR : isEDIFACT ? EDIFACT_OUTPUT_DIR : OUTPUT_DIR;
  const fileName = filePath.split("/").pop().replace(".pdf", "");
  const buffer = readFileSync(filePath);
  const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  const chunks = Math.ceil(totalPages / PAGES_PER_CHUNK);

  console.log(`Splitting: ${fileName} (${totalPages} pages → ${chunks} parts)`);

  for (let i = 0; i < chunks; i++) {
    const newDoc = await PDFDocument.create();
    const start = i * PAGES_PER_CHUNK;
    const end = Math.min(start + PAGES_PER_CHUNK, totalPages);
    const pages = await newDoc.copyPages(srcDoc, Array.from({ length: end - start }, (_, j) => start + j));
    pages.forEach(p => newDoc.addPage(p));
    const outBytes = await newDoc.save();
    const outName = `${fileName}_Part${i + 1}.pdf`;
    const outPath = join(outDir, outName);
    writeFileSync(outPath, outBytes);
    console.log(`  → ${outName} (pages ${start + 1}-${end})`);
  }
}

async function main() {
  for (const file of FILES_TO_SPLIT) {
    try {
      await splitPDF(file);
    } catch (e) {
      console.error(`SKIP ${file.split("/").pop()}: ${e.message}`);
    }
  }
  console.log(`\nDone. SBN split files saved to: ${OUTPUT_DIR}`);
  console.log(`      X12 split files saved to: ${X12_OUTPUT_DIR}`);
  console.log(`      EDIFACT split files saved to: ${EDIFACT_OUTPUT_DIR}`);
  console.log(`      BNL split files saved to: ${BNL_OUTPUT_DIR}`);
}

main().catch(console.error);
