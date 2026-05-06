import { readFileSync, writeFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, "cache.json");
const API_DIR = join(process.env.HOME, "Downloads/APIS");

const cache = JSON.parse(readFileSync(CACHE_FILE, "utf8"));

const files = readdirSync(API_DIR).filter(f => f.endsWith(".json"));

for (const file of files) {
  const filePath = join(API_DIR, file);
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  const title = raw.info?.title || file.replace(".json", "");
  const content = JSON.stringify(raw, null, 2).slice(0, 50000);
  const key = "file://api-spec/" + file;

  cache[key] = {
    url: key,
    title,
    content,
    success: true,
    cachedAt: new Date().toISOString()
  };

  console.log("Imported: " + title + " (" + content.length + " chars)");
}

writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
console.log("\nDone. Total cached: " + Object.keys(cache).length);
