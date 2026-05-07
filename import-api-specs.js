import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
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
      const raw = JSON.parse(readFileSync(filePath, "utf8"));
      const title = raw.info?.title || entry.replace(".json", "");
      const content = JSON.stringify(raw, null, 2).slice(0, 45000);
      const key = "file://" + prefix + entry;
      cache[key] = { url: key, title, content, success: true, cachedAt: new Date().toISOString() };
      console.log("Imported JSON: " + title + " (" + content.length + " chars)");
    } else if (entry.endsWith(".pdf")) {
      const buffer = readFileSync(filePath);
      const parser = new PDFParse({ data: buffer });
      const data = await parser.getText();
      const title = entry.replace(".pdf", "");
      const content = data.text.replace(/\s+/g, " ").trim().slice(0, 45000);
      const key = "file://" + prefix + entry;
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

  // Import additional split PDF chunks from ~/Downloads/Split1
  const SPLIT1_DIR = join(process.env.HOME, "Downloads/Split1");
  await importDir(SPLIT1_DIR, "SBN/split/");

  // Import Test Central docs from ~/Downloads/SBN/Test Central
  const TC_DIR = join(process.env.HOME, "Downloads/SBN/Test Central");
  await importDir(TC_DIR, "SBN/TestCentral/");

  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log("\nDone. Total cached: " + Object.keys(cache).length);
}

main().catch(console.error);
