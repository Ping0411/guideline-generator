import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cache = JSON.parse(readFileSync(join(__dirname, "cache.json"), "utf8"));

const query = process.argv.slice(2).join(" ");
const filter = "";
const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

console.log(`Searching for: "${query}" (keywords: ${keywords.join(", ")})\n`);

const results = [];
for (const [key, val] of Object.entries(cache)) {
  if (!val.success) continue;
  const text = val.content.toLowerCase();
  const title = val.title.toLowerCase();

  let matchIdx = text.indexOf(query.toLowerCase());
  if (matchIdx === -1) {
    matchIdx = keywords.map(k => text.indexOf(k)).find(i => i !== -1) ?? -1;
  }

  const hitCount = keywords.filter(k => text.includes(k) || title.includes(k)).length;
  if (hitCount === 0) continue;

  const start = matchIdx > -1 ? Math.max(0, matchIdx - 200) : 0;
  const excerpt = val.content.slice(start, start + 1200);
  results.push({ key, title: val.title, excerpt, hitCount });
}

results.sort((a, b) => b.hitCount - a.hitCount);
results.slice(0, 5).forEach(r => {
  console.log(`=== ${r.key} (hits: ${r.hitCount}) ===`);
  console.log(r.excerpt);
  console.log("---\n");
});
console.log(`Found in ${results.length} entries, showing top ${Math.min(5, results.length)}.`);
