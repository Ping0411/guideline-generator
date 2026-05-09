import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { PDFDocument } = require(join(__dirname, "node_modules/pdf-lib/cjs/index.js"));

const PAGES_PER_CHUNK = 10;
const OUTPUT_DIR = join(process.env.HOME, "Downloads/split");

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
  // SBN0508 new docs
  join(process.env.HOME, "Downloads/SBN0508/IK20 INT Supplier Integration Overview_Suppliers_JPN.pdf"),
  join(process.env.HOME, "Downloads/SBN0508/IK20 INT Supplier Integration Overview_Suppliers.pdf"),
  join(process.env.HOME, "Downloads/SBN0508/INT Integration Overview eBook_Buyers.pdf"),
  join(process.env.HOME, "Downloads/SBN0508/INT Integration Overview_Buyers.pdf"),
];

mkdirSync(OUTPUT_DIR, { recursive: true });

async function splitPDF(filePath) {
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
    const outPath = join(OUTPUT_DIR, outName);
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
  console.log(`\nDone. Split files saved to: ${OUTPUT_DIR}`);
}

main().catch(console.error);
