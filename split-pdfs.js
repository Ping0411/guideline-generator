import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { PDFDocument } = require(join(__dirname, "node_modules/pdf-lib/cjs/index.js"));

const PAGES_PER_CHUNK = 10;
const OUTPUT_DIR = join(process.env.HOME, "Downloads/Split1");

const FILES_TO_SPLIT = [
  join(process.env.HOME, "Downloads/SBN Add/SBN Supplier Administration Guide.pdf"),
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
