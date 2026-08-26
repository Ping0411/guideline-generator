#!/usr/bin/env node
/**
 * ingest-pdftools.js — 专用于 pdf-lib 无法解析的 SAP PDF
 *
 * 用法：
 *   node ingest-pdftools.js <pdf文件路径> [--scope SBN|BNL|TC]
 *
 * 与 ingest.js 的区别：
 *   - Step 1: 用 pdfseparate (poppler) 切割，而不是 pdf-lib
 *   - Step 2: 用 pdftotext (poppler) 提取文本，而不是 pdf-parse
 *   - Step 3-7: 与 ingest.js 完全相同（Claude API 打标签、章节映射、向量索引）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { execSync, execFileSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CACHE_FILE    = join(__dirname, "cache.json");
const TAGS_FILE     = join(__dirname, "tags.json");
const CLAUDE_MD     = join(__dirname, "chapter-map.md");
const TAG_GUIDE     = join(__dirname, "TAG_GUIDELINES.md");
const CHAPTER_GUIDE = join(__dirname, "CHAPTER_GUIDELINES.md");

const PAGES_PER_CHUNK = 10;
const CHAR_LIMIT      = 45000;
const API_KEY         = "0399a7b7-c66d-4453-9803-b0e0ebe38b28";
const BASE_URL        = "http://localhost:6655/anthropic";
const MODEL           = "claude-sonnet-4-6";

// ─── CLI 参数 ────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const DRY_RUN    = args.includes("--dry-run");
const SKIP_INDEX = args.includes("--skip-index");
const pdfArg     = args.find(a => !a.startsWith("--"));

if (!pdfArg) {
  console.error("用法: node ingest-pdftools.js <pdf文件路径> [--scope=SBN|BNL|TC]");
  process.exit(1);
}

const PDF_PATH = pdfArg.startsWith("/") ? pdfArg : join(process.cwd(), pdfArg);
if (!existsSync(PDF_PATH)) {
  console.error("文件不存在:", PDF_PATH);
  process.exit(1);
}

function inferScope(filePath) {
  if (filePath.includes(" X12 ") || filePath.includes("_X12_")) return "X12";
  if (filePath.includes(" EDIFACT ") || filePath.includes("_EDIFACT ")) return "EDIFACT";
  if (filePath.includes("/BNL/") || filePath.includes("/Downloads/BNL")) return "BNL";
  if (filePath.includes("/Test Central/") || filePath.includes("/TestCentral/")) return "TC";
  return "SBN";
}

const SCOPE = args.find(a => a.startsWith("--scope="))?.split("=")[1] || inferScope(PDF_PATH);

const SCOPE_CONFIG = {
  SBN:     { outDir: join(process.env.HOME, "Downloads/split"),           prefix: "SBN/split/" },
  X12:     { outDir: join(process.env.HOME, "Downloads/split/X12"),       prefix: "SBN/split/X12/" },
  EDIFACT: { outDir: join(process.env.HOME, "Downloads/split/EDIFACT"),   prefix: "SBN/split/EDIFACT/" },
  BNL:     { outDir: join(__dirname, "api-specs/split"),                   prefix: "api-specs/split/" },
  TC:      { outDir: join(process.env.HOME, "Downloads/SBN/Test Central"), prefix: "SBN/TestCentral/" },
};

if (!SCOPE_CONFIG[SCOPE]) {
  console.error("未知 scope:", SCOPE);
  process.exit(1);
}

const { outDir, prefix } = SCOPE_CONFIG[SCOPE];
const docName = basename(PDF_PATH, ".pdf");

console.log(`\n========== ingest-pdftools.js ==========`);
console.log(`文档: ${docName}`);
console.log(`Scope: ${SCOPE}  →  prefix: ${prefix}`);
if (DRY_RUN) console.log(`[DRY-RUN] 不写入任何文件\n`);

const tagGuidelines     = readFileSync(TAG_GUIDE,     "utf8");
const chapterGuidelines = readFileSync(CHAPTER_GUIDE, "utf8");

// ─── Step 1: 用 pdfseparate 切割 PDF ─────────────────────────────────────────
console.log("\n[Step 1] 切割 PDF (pdfseparate)...");

// 获取总页数
let totalPages;
try {
  const info = execFileSync("pdfinfo", [PDF_PATH], { encoding: "utf8" });
  const m = info.match(/Pages:\s+(\d+)/);
  if (!m) throw new Error("无法从 pdfinfo 获取页数");
  totalPages = parseInt(m[1]);
} catch (e) {
  console.error("pdfinfo 失败:", e.message);
  process.exit(1);
}

const numChunks = Math.ceil(totalPages / PAGES_PER_CHUNK);
console.log(`  总页数: ${totalPages}，将切为 ${numChunks} 个切片`);

mkdirSync(outDir, { recursive: true });

// 用临时目录存放 pdfseparate 的单页输出，再合并成10页切片
const tmpDir = join(outDir, `_tmp_${docName}`);
mkdirSync(tmpDir, { recursive: true });

const newSliceFiles = [];

// 预加载 cache，用于判断切片是否需要处理
const cacheForStep1 = JSON.parse(readFileSync(CACHE_FILE, "utf8"));

for (let i = 0; i < numChunks; i++) {
  const partNum = i + 1;
  const outName = `${docName}_Part${partNum}.pdf`;
  const outPath = join(outDir, outName);
  const cacheKey = "file://" + prefix + outName;
  const startPage = i * PAGES_PER_CHUNK + 1;
  const endPage   = Math.min(startPage + PAGES_PER_CHUNK - 1, totalPages);

  if (existsSync(outPath)) {
    if (cacheForStep1[cacheKey]) {
      console.log(`  已存在且已缓存，跳过: ${outName}`);
      continue;
    }
    // 切片文件存在但缓存缺失，仍需处理
    console.log(`  已存在但缓存缺失，加入处理队列: ${outName}`);
    newSliceFiles.push({ outPath, outName, partNum, startPage, endPage });
    continue;
  }

  if (!DRY_RUN) {
    try {
      execFileSync("gs", [
        "-dBATCH", "-dNOPAUSE", "-q",
        "-sDEVICE=pdfwrite",
        `-dFirstPage=${startPage}`,
        `-dLastPage=${endPage}`,
        `-sOutputFile=${outPath}`,
        PDF_PATH,
      ], { stdio: "pipe" });
    } catch (e) {
      console.error(`  gs 切割失败 Part${partNum}:`, e.message);
      continue;
    }
  }

  console.log(`  → ${outName} (页 ${startPage}-${endPage})`);
  newSliceFiles.push({ outPath, outName, partNum, startPage, endPage });
}

// 清理临时目录
try { execSync(`rm -rf "${tmpDir}"`); } catch (_) {}

if (newSliceFiles.length === 0) {
  console.log("  所有切片已存在且已缓存，无需处理。");
  process.exit(0);
}

// ─── Step 2: 用 pdftotext 提取文本，写入 cache.json ──────────────────────────
console.log(`\n[Step 2] 提取文本 (pdftotext)，写入 cache.json...`);

const cache = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
const newCacheEntries = [];

for (const { outPath, outName, partNum, startPage, endPage } of newSliceFiles) {
  const key = "file://" + prefix + outName;

  if (cache[key]) {
    console.log(`  已缓存，跳过: ${outName}`);
    continue;
  }

  let content = "";
  try {
    // 直接从原始 PDF 提取对应页范围的文本（比从切片提取更可靠）
    content = execFileSync("pdftotext", [
      "-f", String(startPage),
      "-l", String(endPage),
      PDF_PATH, "-",
    ], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    content = content.replace(/\s+/g, " ").trim().slice(0, CHAR_LIMIT);
  } catch (e) {
    console.warn(`  WARNING: pdftotext 失败 (${outName}): ${e.message}`);
    content = "";
  }

  const title = outName.replace(".pdf", "");
  const entry = { url: key, title, content, success: true, cachedAt: new Date().toISOString() };

  if (!DRY_RUN) cache[key] = entry;
  newCacheEntries.push({ key, content, title, partNum });
  console.log(`  缓存: ${title} (${content.length} 字符)`);
}

if (!DRY_RUN && newCacheEntries.length > 0) {
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log(`  cache.json 已更新，新增 ${newCacheEntries.length} 条`);
}

// ─── Step 3: 调用 Claude API，生成 tags + chapter_description ────────────────
console.log(`\n[Step 3] 调用 Claude API 生成标签和章节映射...`);

async function callClaude(sliceContent, sliceTitle) {
  const systemPrompt = `You are an expert at analyzing SAP documentation content.
You will be given the COMPLETE content of a single document slice.
You must generate TWO outputs based ONLY on what you actually read in the content — no guessing, no inference from the filename.

=== TAG GUIDELINES ===
${tagGuidelines}

=== CHAPTER MAPPING GUIDELINES ===
${chapterGuidelines}

Output format (JSON only, no other text):
{
  "tags": ["tag phrase 1", "tag phrase 2", ...],
  "chapter": "PartN: Topic Title (specific detail 1, specific detail 2, specific detail 3)"
}`;

  const userPrompt = `Document slice title: ${sliceTitle}

COMPLETE CONTENT (read every word before generating output):
${sliceContent}`;

  const response = await fetch(`${BASE_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API 调用失败 (${response.status}): ${err}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`API 响应无法解析为 JSON:\n${text}`);
  return JSON.parse(jsonMatch[0]);
}

const results = [];

for (const { key, content, title, partNum } of newCacheEntries) {
  if (!content) {
    console.warn(`  SKIP (空内容): ${title}`);
    results.push({ key, partNum, tags: [], chapter: `Part${partNum}: (content unavailable)` });
    continue;
  }

  console.log(`  处理: ${title}`);
  let parsed;
  try {
    parsed = await callClaude(content, title);
  } catch (e) {
    console.error(`  ERROR: ${title}: ${e.message}`);
    results.push({ key, partNum, tags: [], chapter: `Part${partNum}: (API error)` });
    continue;
  }

  const tags    = Array.isArray(parsed.tags)         ? parsed.tags    : [];
  const chapter = typeof parsed.chapter === "string" ? parsed.chapter : `Part${partNum}: (parse error)`;

  console.log(`    tags (${tags.length}): ${tags.slice(0, 4).join(", ")}${tags.length > 4 ? " ..." : ""}`);
  console.log(`    chapter: ${chapter}`);
  results.push({ key, partNum, tags, chapter });
}

// ─── Step 4: 写入 tags.json ───────────────────────────────────────────────────
console.log(`\n[Step 4] 写入 tags.json...`);
const tagsData = JSON.parse(readFileSync(TAGS_FILE, "utf8"));

for (const { key, tags } of results) {
  if (tags.length === 0) continue;
  const entry = {
    title: cache[key]?.title || key.split("/").pop(),
    urls: [key],
    tags,
    taggedAt: new Date().toISOString(),
  };
  if (!DRY_RUN) tagsData[key] = entry;
}

if (!DRY_RUN) {
  writeFileSync(TAGS_FILE, JSON.stringify(tagsData, null, 2));
  console.log(`  tags.json 已更新，新增 ${results.filter(r => r.tags.length > 0).length} 条`);
}

// ─── Step 5: 追加章节映射到 CLAUDE.md ────────────────────────────────────────
console.log(`\n[Step 5] 追加章节映射到 CLAUDE.md...`);

const chapterLines = results
  .sort((a, b) => a.partNum - b.partNum)
  .map(r => `  - ${r.chapter}`);

const urlPattern   = `file://${prefix}${docName}_Part{N}.pdf`;
const claudeMdBlock = `\n- **${docName}** \`${urlPattern}\` (N = 1–${numChunks})\n${chapterLines.join("\n")}\n`;

if (!DRY_RUN) {
  const existing = readFileSync(CLAUDE_MD, "utf8");
  if (existing.includes(docName)) {
    console.log(`  WARNING: CLAUDE.md 中已存在 "${docName}"，跳过追加（请手动检查）`);
  } else {
    writeFileSync(CLAUDE_MD, existing + claudeMdBlock);
    console.log(`  已追加 ${chapterLines.length} 行章节映射`);
  }
}

// ─── Step 6: 向量索引增量更新 ─────────────────────────────────────────────────
console.log(`\n[Step 6] 向量索引增量更新...`);
if (SKIP_INDEX) {
  console.log("  --skip-index 已设置，跳过（由调用方统一重建）");
} else if (!DRY_RUN) {
  try {
    execSync(`python3 ${join(__dirname, "build_index.py")}`, { stdio: "inherit", env: { ...process.env, TRANSFORMERS_OFFLINE: "1", HF_DATASETS_OFFLINE: "1" } });
  } catch (e) {
    console.error("  build_index.py 执行出错:", e.message);
  }
}

// ─── Step 7: 自检报告 ──────────────────────────────────────────────────────────
console.log(`\n========== 自检报告 ==========`);
const freshCache = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
const freshTags  = JSON.parse(readFileSync(TAGS_FILE,  "utf8"));

for (const { key, title } of newCacheEntries) {
  const inCache = !!freshCache[key];
  console.log(`  [cache]  ${inCache ? "✓" : "✗"} ${title}`);
}
for (const { key, tags, partNum } of results) {
  const entry    = freshTags[key];
  const tagCount = entry?.tags?.length || 0;
  const ok       = tagCount >= 2;
  console.log(`  [tags]   ${ok ? "✓" : "✗"} Part${partNum}: ${tagCount} 个标签${!ok ? " ← 过少" : ""}`);
}

console.log(`\n完成: ${docName} — ${newCacheEntries.length} 个切片`);
