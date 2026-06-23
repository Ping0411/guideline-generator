import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { PDFParse } from "pdf-parse";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, "cache.json");
const API_DIR = join(__dirname, "api-specs");

const cache = JSON.parse(readFileSync(CACHE_FILE, "utf8"));

async function importDir(dir, prefix) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const filePath = join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      await importDir(filePath, prefix + entry + "/");
      continue;
    }
    if (entry.endsWith(".json")) {
      const key = "file://" + prefix + entry;
      if (cache[key]?.cachedAt && stat.mtimeMs <= new Date(cache[key].cachedAt).getTime()) {
        console.log("Skip (unchanged): " + entry); continue;
      }
      const raw = JSON.parse(readFileSync(filePath, "utf8"));
      const title = raw.info?.title || entry.replace(".json", "");
      const content = JSON.stringify(raw, null, 2).slice(0, 45000);
      cache[key] = { url: key, title, content, success: true, cachedAt: new Date().toISOString() };
      console.log("Imported JSON: " + title + " (" + content.length + " chars)");
    } else if (entry.endsWith(".pdf")) {
      const key = "file://" + prefix + entry;
      if (cache[key]?.cachedAt && stat.mtimeMs <= new Date(cache[key].cachedAt).getTime()) {
        console.log("Skip (unchanged): " + entry); continue;
      }
      const buffer = readFileSync(filePath);
      const parser = new PDFParse({ data: buffer });
      const data = await parser.getText();
      const title = entry.replace(".pdf", "");
      const content = data.text.replace(/\s+/g, " ").trim().slice(0, 45000);
      cache[key] = { url: key, title, content, success: true, cachedAt: new Date().toISOString() };
      console.log("Imported PDF: " + title + " (" + content.length + " chars)");
    }
  }
}

async function main() {
  // Import bundled api-specs
  await importDir(API_DIR, "api-specs/");

  // Import split PDF chunks from ~/Downloads/split
  const SPLIT_DIR = join(process.env.HOME, "Downloads/split");
  await importDir(SPLIT_DIR, "SBN/split/");

  // Import X12 EDI split PDF chunks from ~/Downloads/split/X12
  const X12_SPLIT_DIR = join(process.env.HOME, "Downloads/split/X12");
  if (existsSync(X12_SPLIT_DIR)) {
    await importDir(X12_SPLIT_DIR, "SBN/split/X12/");
  } else {
    console.log("Skipping X12 split dir (not found)");
  }

  // Import EDIFACT EDI split PDF chunks from ~/Downloads/split/EDIFACT
  const EDIFACT_SPLIT_DIR = join(process.env.HOME, "Downloads/split/EDIFACT");
  if (existsSync(EDIFACT_SPLIT_DIR)) {
    await importDir(EDIFACT_SPLIT_DIR, "SBN/split/EDIFACT/");
  } else {
    console.log("Skipping EDIFACT split dir (not found)");
  }

  // Import Test Central docs from ~/Downloads/SBN/Test Central
  const TC_DIR = join(process.env.HOME, "Downloads/SBN/Test Central");
  if (existsSync(TC_DIR)) {
    await importDir(TC_DIR, "SBN/TestCentral/");
  } else {
    console.log("Skipping Test Central dir (not found)");
  }

  // Import BNL split PDF chunks from api-specs/split
  const BNL_SPLIT_DIR = join(__dirname, "api-specs/split");
  if (existsSync(BNL_SPLIT_DIR)) {
    await importDir(BNL_SPLIT_DIR, "api-specs/split/");
  } else {
    console.log("Skipping BNL split dir (not found)");
  }

  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log("\nDone. Total cached: " + Object.keys(cache).length);
}

main().catch(console.error);
