#!/usr/bin/env node
/**
 * ingest.js — 新文档入库一键流程
 *
 * 用法：
 *   node ingest.js <pdf文件路径> [--scope SBN|BNL|TC] [--dry-run]
 *
 * scope 说明：
 *   SBN   → ~/Downloads/split/        → cache key prefix: SBN/split/
 *   X12   → ~/Downloads/split/X12/    → cache key prefix: SBN/split/X12/
 *   EDIFACT → ~/Downloads/split/EDIFACT/ → cache key prefix: SBN/split/EDIFACT/
 *   BNL   → ./api-specs/split/        → cache key prefix: api-specs/split/
 *   TC    → ~/Downloads/SBN/Test Central/ → cache key prefix: SBN/TestCentral/
 *   (自动推断：文件路径含 X12 → X12，含 EDIFACT → EDIFACT，含 /BNL/ → BNL)
 *
 * 流程：
 *   1. 切割 PDF → 对应 split 目录（已存在的切片跳过）
 *   2. import 新切片 → 增量写入 cache.json
 *   3. 逐切片调用 Claude API → 同时生成 tags + chapter_description
 *   4. 写入 tags.json（增量）
 *   5. 追加章节映射到 ~/CLAUDE.md
 *   6. build_index.py 增量更新向量索引
 *   7. 自检报告 + 抽取一个切片供人工核验
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const CACHE_FILE   = join(__dirname, "cache.json");
const TAGS_FILE    = join(__dirname, "tags.json");
const CLAUDE_MD    = join(process.env.HOME, "CLAUDE.md");
const TAG_GUIDE    = join(__dirname, "TAG_GUIDELINES.md");
const CHAPTER_GUIDE = join(__dirname, "CHAPTER_GUIDELINES.md");

const PAGES_PER_CHUNK = 10;
const CHAR_LIMIT      = 45000;
const API_KEY         = "0399a7b7-c66d-4453-9803-b0e0ebe38b28";
const BASE_URL        = "http://localhost:6655";
const MODEL           = "claude-sonnet-4-6";

// ─── CLI 参数解析 ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN  = args.includes("--dry-run");
const pdfArg   = args.find(a => !a.startsWith("--"));

if (!pdfArg) {
  console.error("用法: node ingest.js <pdf文件路径> [--dry-run]");
  process.exit(1);
}

const PDF_PATH = pdfArg.startsWith("/") ? pdfArg : join(process.cwd(), pdfArg);
if (!existsSync(PDF_PATH)) {
  console.error("文件不存在:", PDF_PATH);
  process.exit(1);
}

// ─── 推断 scope ──────────────────────────────────────────────────────────────
function inferScope(filePath) {
  if (filePath.includes(" X12 ") || filePath.includes("_X12_")) return "X12";
  if (filePath.includes(" EDIFACT ") || filePath.includes("_EDIFACT ")) return "EDIFACT";
  if (filePath.includes("/BNL/") || filePath.includes("/Downloads/BNL")) return "BNL";
  if (filePath.includes("/Test Central/") || filePath.includes("/TestCentral/")) return "TC";
  return "SBN";
}

const SCOPE = args.find(a => a.startsWith("--scope="))?.split("=")[1] || inferScope(PDF_PATH);

const SCOPE_CONFIG = {
  SBN:     { outDir: join(process.env.HOME, "Downloads/split"),          prefix: "SBN/split/" },
  X12:     { outDir: join(process.env.HOME, "Downloads/split/X12"),      prefix: "SBN/split/X12/" },
  EDIFACT: { outDir: join(process.env.HOME, "Downloads/split/EDIFACT"),  prefix: "SBN/split/EDIFACT/" },
  BNL:     { outDir: join(__dirname, "api-specs/split"),                  prefix: "api-specs/split/" },
  TC:      { outDir: join(process.env.HOME, "Downloads/SBN/Test Central"), prefix: "SBN/TestCentral/" },
};

if (!SCOPE_CONFIG[SCOPE]) {
  console.error("未知 scope:", SCOPE, "  可选: SBN / X12 / EDIFACT / BNL / TC");
  process.exit(1);
}

const { outDir, prefix } = SCOPE_CONFIG[SCOPE];
const docName = basename(PDF_PATH, ".pdf");

console.log(`\n========== ingest.js ==========`);
console.log(`文档: ${docName}`);
console.log(`Scope: ${SCOPE}  →  prefix: ${prefix}`);
if (DRY_RUN) console.log(`[DRY-RUN] 不写入任何文件\n`);

// ─── 读取指引文件 ─────────────────────────────────────────────────────────────
const tagGuidelines     = readFileSync(TAG_GUIDE,     "utf8");
const chapterGuidelines = readFileSync(CHAPTER_GUIDE, "utf8");

// ─── Step 1: 切割 PDF ────────────────────────────────────────────────────────
console.log("\n[Step 1] 切割 PDF...");

const { PDFDocument } = require(join(__dirname, "node_modules/pdf-lib/cjs/index.js"));
const { default: pdfParse } = await import(join(__dirname, "node_modules/pdf-parse/index.js")).catch(() => {
  // fallback: try require
  return { default: require("pdf-parse") };
});

mkdirSync(outDir, { recursive: true });

const pdfBuffer = readFileSync(PDF_PATH);
let srcDoc;
try {
  srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
} catch (e) {
  console.error("pdf-lib 无法解析此 PDF（可能是非标准格式）:", e.message);
  console.error("请先手动切割后再运行 ingest.js，或使用 --scope 参数指定已切割目录。");
  process.exit(1);
}

const totalPages = srcDoc.getPageCount();
const numChunks  = Math.ceil(totalPages / PAGES_PER_CHUNK);
console.log(`  总页数: ${totalPages}，将切为 ${numChunks} 个切片`);

const newSliceFiles = [];
for (let i = 0; i < numChunks; i++) {
  const partNum  = i + 1;
  const outName  = `${docName}_Part${partNum}.pdf`;
  const outPath  = join(outDir, outName);

  if (existsSync(outPath)) {
    console.log(`  已存在，跳过: ${outName}`);
    continue;
  }

  if (!DRY_RUN) {
    const newDoc = await PDFDocument.create();
    const start  = i * PAGES_PER_CHUNK;
    const end    = Math.min(start + PAGES_PER_CHUNK, totalPages);
    const pages  = await newDoc.copyPages(srcDoc, Array.from({ length: end - start }, (_, j) => start + j));
    pages.forEach(p => newDoc.addPage(p));
    const outBytes = await newDoc.save();
    writeFileSync(outPath, outBytes);
  }
  console.log(`  → ${outName}`);
  newSliceFiles.push({ outPath, outName, partNum });
}

if (newSliceFiles.length === 0) {
  console.log("  所有切片已存在，无新切片需要处理。");
  process.exit(0);
}

// ─── Step 2: 解析 PDF 文本，写入 cache.json ─────────────────────────────────
console.log(`\n[Step 2] 解析切片文本，写入 cache.json...`);

const cache = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
const newCacheEntries = []; // { key, content, title }

for (const { outPath, outName, partNum } of newSliceFiles) {
  const key = "file://" + prefix + outName;
  if (cache[key]) {
    console.log(`  已缓存，跳过: ${outName}`);
    continue;
  }
  const buf  = readFileSync(outPath);
  let content;
  try {
    const data = await pdfParse(buf);
    content = data.text.replace(/\s+/g, " ").trim().slice(0, CHAR_LIMIT);
  } catch (e) {
    console.warn(`  WARNING: pdf-parse 解析失败 (${outName}): ${e.message}，内容置空`);
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

// ─── Step 3: 调用 Claude API，生成 tags + chapter_description ───────────────
console.log(`\n[Step 3] 调用 Claude API 生成标签和章节映射...`);
console.log(`  切片数: ${newCacheEntries.length}，逐片处理`);

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

  // 解析 JSON（API 返回的 text 可能带 ```json 代码块）
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`API 响应无法解析为 JSON:\n${text}`);
  return JSON.parse(jsonMatch[0]);
}

const results = []; // { key, partNum, tags, chapter }

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

  const tags    = Array.isArray(parsed.tags)    ? parsed.tags    : [];
  const chapter = typeof parsed.chapter === "string" ? parsed.chapter : `Part${partNum}: (parse error)`;

  console.log(`    tags (${tags.length}): ${tags.slice(0, 4).join(", ")}${tags.length > 4 ? " ..." : ""}`);
  console.log(`    chapter: ${chapter}`);
  results.push({ key, partNum, tags, chapter });
}

// ─── Step 4: 写入 tags.json ──────────────────────────────────────────────────
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
} else {
  console.log(`  [DRY-RUN] 跳过写入`);
}

// ─── Step 5: 追加章节映射到 CLAUDE.md ───────────────────────────────────────
console.log(`\n[Step 5] 追加章节映射到 CLAUDE.md...`);

const chapterLines = results
  .sort((a, b) => a.partNum - b.partNum)
  .map(r => `  - ${r.chapter}`);

const totalParts = numChunks;
const urlPattern = `file://${prefix}${docName}_Part{N}.pdf`;

const claudeMdBlock = `\n- **${docName}** \`${urlPattern}\` (N = 1–${totalParts})\n${chapterLines.join("\n")}\n`;

if (!DRY_RUN) {
  const existing = readFileSync(CLAUDE_MD, "utf8");
  if (existing.includes(docName)) {
    console.log(`  WARNING: CLAUDE.md 中已存在 "${docName}"，跳过追加（请手动检查）`);
  } else {
    // 追加到文件末尾的文档列表区域（"Known document URL patterns" 段落末尾）
    writeFileSync(CLAUDE_MD, existing + claudeMdBlock);
    console.log(`  已追加 ${chapterLines.length} 行章节映射`);
  }
} else {
  console.log(`  [DRY-RUN] 将追加以下内容:\n${claudeMdBlock}`);
}

// ─── Step 6: 向量索引增量更新 ────────────────────────────────────────────────
console.log(`\n[Step 6] 向量索引增量更新...`);
if (!DRY_RUN) {
  try {
    execSync(`python3 ${join(__dirname, "build_index.py")}`, { stdio: "inherit" });
  } catch (e) {
    console.error("  build_index.py 执行出错:", e.message);
  }
} else {
  console.log(`  [DRY-RUN] 跳过`);
}

// ─── Step 7: 自检报告 ────────────────────────────────────────────────────────
console.log(`\n========== 自检报告 ==========`);
let allPassed = true;

// 检查1：所有切片是否都在 cache.json 中
const freshCache = DRY_RUN ? cache : JSON.parse(readFileSync(CACHE_FILE, "utf8"));
for (const { key, title } of newCacheEntries) {
  const inCache = DRY_RUN ? true : !!freshCache[key];
  const mark = inCache ? "✓" : "✗";
  if (!inCache) allPassed = false;
  console.log(`  [cache]  ${mark} ${title}`);
}

// 检查2：所有切片是否都有 tags 条目且标签数量合理
const freshTags = DRY_RUN ? tagsData : JSON.parse(readFileSync(TAGS_FILE, "utf8"));
for (const { key, tags, partNum } of results) {
  const entry    = DRY_RUN ? { tags } : freshTags[key];
  const tagCount = entry?.tags?.length || 0;
  const ok       = tagCount >= 2;
  if (!ok) allPassed = false;
  const mark = ok ? "✓" : "✗";
  console.log(`  [tags]   ${mark} Part${partNum}: ${tagCount} 个标签${tagCount < 2 ? " ← 过少，请检查" : ""}`);
}

// 检查3：chapter 描述是否包含具体内容（非错误占位符）
for (const { partNum, chapter } of results) {
  const ok = !chapter.includes("(API error)") && !chapter.includes("(content unavailable)") && !chapter.includes("(parse error)");
  if (!ok) allPassed = false;
  const mark = ok ? "✓" : "✗";
  console.log(`  [chapter] ${mark} Part${partNum}: ${chapter.slice(0, 80)}`);
}

// 检查4：CLAUDE.md 是否包含新文档名
if (!DRY_RUN) {
  const claudeContent = readFileSync(CLAUDE_MD, "utf8");
  const inClaude = claudeContent.includes(docName);
  if (!inClaude) allPassed = false;
  console.log(`  [CLAUDE.md] ${inClaude ? "✓" : "✗"} "${docName}" ${inClaude ? "已写入" : "未找到 ← 请检查"}`);
}

console.log(`\n自检结果: ${allPassed ? "全部通过 ✓" : "存在异常 ✗，请查看上方标记"}`);

// ─── 人工核验样本：抽取第一个切片 ───────────────────────────────────────────
if (results.length > 0) {
  const sample = results[0];
  console.log(`\n========== 人工核验样本（Part${sample.partNum}）==========`);
  console.log(`切片: ${sample.key}`);
  console.log(`标签 (${sample.tags.length} 个):`);
  sample.tags.forEach(t => console.log(`  - ${t}`));
  console.log(`章节映射:`);
  console.log(`  ${sample.chapter}`);
  console.log(`\n请确认：标签和章节描述是否基于该切片的实际内容，无推测，无泛泛描述。`);
}

console.log(`\n========== 完成 ==========\n`);
