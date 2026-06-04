import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, "cache.json");

// Each cache entry is capped at 45000 chars, same as PDF chunks
const CHUNK_SIZE = 45000;
// Merge this many consecutive transcript lines before splitting into chunks
const LINES_PER_SEGMENT = 30;

// VTT cue identifier: UUID or plain integer
const CUE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-\d+)?$|^\d+$/i;
const TIMESTAMP_RE = /-->/;

function parseVTT(raw) {
  const lines = raw.split(/\r?\n/);
  const textLines = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t === "WEBVTT") continue;
    if (CUE_ID_RE.test(t)) continue;
    if (TIMESTAMP_RE.test(t)) continue;
    textLines.push(t);
  }
  return textLines;
}

function chunkLines(lines) {
  const segments = [];
  for (let i = 0; i < lines.length; i += LINES_PER_SEGMENT) {
    segments.push(lines.slice(i, i + LINES_PER_SEGMENT).join(" "));
  }

  const chunks = [];
  let current = "";
  for (const seg of segments) {
    if (current.length + seg.length + 1 > CHUNK_SIZE) {
      if (current) chunks.push(current.trim());
      current = seg;
    } else {
      current += (current ? " " : "") + seg;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function importVTT(filePath, cache) {
  const raw = readFileSync(filePath, "utf8");
  const lines = parseVTT(raw);
  if (lines.length === 0) {
    console.log(`SKIP (empty after parsing): ${basename(filePath)}`);
    return 0;
  }

  const chunks = chunkLines(lines);
  // Derive a readable title from filename, strip date suffix and locale tag
  // e.g. "BN4L - API training session held by Jeff Gebo-20260311_163556-Meeting Recording-en-US"
  // → "BN4L - API training session held by Jeff Gebo (2026-03-11)"
  const stem = basename(filePath, ".vtt");
  const dateMatch = stem.match(/(\d{8})_\d{6}/);
  const dateStr = dateMatch
    ? `${dateMatch[1].slice(0, 4)}-${dateMatch[1].slice(4, 6)}-${dateMatch[1].slice(6, 8)}`
    : "";
  const baseName = stem
    .replace(/-\d{8}_\d{6}-.*$/, "")
    .replace(/-en-US$/, "")
    .trim();
  const title = dateStr ? `${baseName} (${dateStr})` : baseName;

  const urlBase = "file://api-specs/transcripts/" + stem;
  let imported = 0;
  for (let i = 0; i < chunks.length; i++) {
    const key = chunks.length === 1 ? urlBase : `${urlBase}_Part${i + 1}`;
    const entryTitle = chunks.length === 1 ? title : `${title} [Part ${i + 1}]`;
    cache[key] = {
      url: key,
      title: entryTitle,
      content: chunks[i],
      success: true,
      cachedAt: new Date().toISOString(),
    };
    imported++;
  }
  console.log(`Imported VTT: ${title} → ${imported} chunk(s), ${lines.length} lines`);
  return imported;
}

async function main() {
  const VTT_DIR = join(process.env.HOME, "Downloads/SBN");
  const cache = JSON.parse(readFileSync(CACHE_FILE, "utf8"));

  const files = readdirSync(VTT_DIR).filter((f) => f.endsWith(".vtt"));
  if (files.length === 0) {
    console.log("No VTT files found in " + VTT_DIR);
    return;
  }

  let total = 0;
  for (const file of files) {
    total += importVTT(join(VTT_DIR, file), cache);
  }

  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log(`\nDone. Imported ${files.length} VTT file(s) → ${total} cache entries.`);
  console.log(`Total cached entries: ${Object.keys(cache).length}`);
}

main().catch(console.error);
