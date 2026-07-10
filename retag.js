#!/usr/bin/env node
/**
 * retag.js — 对已缓存但缺少 tags/chapter 的切片补打标签
 *
 * 用法：
 *   node retag.js <docName前缀> [--scope SBN|BNL|TC] [--dry-run]
 *
 * 例：
 *   node retag.js "SAP Business Network Buyer Administration Guide"
 *   node retag.js "SAP Business Network for Supply Chain Integration and Configuration Guide"
 *
 * 功能：
 *   - 从 cache.json 中找到匹配 docName 的所有切片
 *   - 跳过已有 tags 条目的切片（增量）
 *   - 调用 Claude API 生成 tags + chapter_description
 *   - 写入 tags.json（增量）
 *   - 追加/更新 CLAUDE.md 章节映射
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CACHE_FILE    = join(__dirname, "cache.json");
const TAGS_FILE     = join(__dirname, "tags.json");
const CLAUDE_MD     = join(process.env.HOME, "CLAUDE.md");
const TAG_GUIDE     = join(__dirname, "TAG_GUIDELINES.md");
const CHAPTER_GUIDE = join(__dirname, "CHAPTER_GUIDELINES.md");

const API_KEY  = "0399a7b7-c66d-4453-9803-b0e0ebe38b28";
const BASE_URL = "http://localhost:6655/anthropic";
const MODEL    = "claude-sonnet-4-6";

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const docArg  = args.find(a => !a.startsWith("--"));

if (!docArg) {
  console.error("用法: node retag.js <docName前缀> [--scope=SBN|BNL|TC] [--dry-run]");
  process.exit(1);
}

const SCOPE_PREFIX = {
  SBN: "SBN/split/",
  BNL: "api-specs/split/",
  TC:  "SBN/TestCentral/",
};
const scopeArg = args.find(a => a.startsWith("--scope="))?.split("=")[1] || "SBN";
const prefix   = SCOPE_PREFIX[scopeArg] || "SBN/split/";

const tagGuidelines     = readFileSync(TAG_GUIDE,     "utf8");
const chapterGuidelines = readFileSync(CHAPTER_GUIDE, "utf8");

// 从 cache.json 找到匹配的切片，按 partNum 排序
const cache    = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
const tagsData = JSON.parse(readFileSync(TAGS_FILE,  "utf8"));

const matchedKeys = Object.keys(cache)
  .filter(k => k.includes(docArg) && k.startsWith("file://" + prefix))
  .sort((a, b) => {
    const na = parseInt(a.match(/_Part(\d+)\.pdf/)?.[1] || "0");
    const nb = parseInt(b.match(/_Part(\d+)\.pdf/)?.[1] || "0");
    return na - nb;
  });

if (matchedKeys.length === 0) {
  console.error(`cache.json 中未找到匹配 "${docArg}" 的条目（prefix: ${prefix}）`);
  process.exit(1);
}

console.log(`\n========== retag.js ==========`);
console.log(`文档: ${docArg}`);
console.log(`Scope: ${scopeArg}  →  prefix: ${prefix}`);
console.log(`找到 ${matchedKeys.length} 个切片`);
if (DRY_RUN) console.log(`[DRY-RUN] 不写入任何文件\n`);

// 确定 docName（从第一个 key 提取）
const firstKey = matchedKeys[0];
const docName  = firstKey.replace(`file://${prefix}`, "").replace(/_Part\d+\.pdf$/, "");
const numChunks = matchedKeys.length;

// 过滤出需要处理的切片（tags 缺失）
const toProcess = matchedKeys
  .map(key => {
    const partMatch = key.match(/_Part(\d+)\.pdf$/);
    const partNum   = partMatch ? parseInt(partMatch[1]) : 0;
    return { key, partNum, content: cache[key]?.content || "", title: cache[key]?.title || key };
  })
  .filter(({ key }) => !tagsData[key]);

console.log(`需要处理: ${toProcess.length} 个切片（${matchedKeys.length - toProcess.length} 个已有 tags，跳过）\n`);

if (toProcess.length === 0) {
  console.log("所有切片已有 tags，无需处理。");
  process.exit(0);
}

// Claude API 调用
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

// 处理各切片
const results = [];

for (const { key, content, title, partNum } of toProcess) {
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

// 写入 tags.json
console.log(`\n[写入 tags.json]...`);
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

// 更新 CLAUDE.md 章节映射
// 收集所有切片（包括已有 tags 的）的 chapter 信息
console.log(`\n[更新 CLAUDE.md 章节映射]...`);

// 构建完整的章节行：已有 tags 的用 tagsData 里的 chapter，新处理的用 results
const allChapterLines = matchedKeys.map(key => {
  const partMatch = key.match(/_Part(\d+)\.pdf$/);
  const partNum   = partMatch ? parseInt(partMatch[1]) : 0;

  // 优先使用本次新生成的
  const newResult = results.find(r => r.key === key);
  if (newResult) return `  - ${newResult.chapter}`;

  // 已有 tags 条目但 CLAUDE.md 中可能已有章节，这里只生成占位
  // （retag 主要补缺失的，已有的不重复覆盖）
  return null;
}).filter(Boolean);

// 生成 CLAUDE.md block
const urlPattern = `file://${prefix}${docName}_Part{N}.pdf`;
const claudeMdBlock = `\n- **${docName}** \`${urlPattern}\` (N = 1–${numChunks})\n${allChapterLines.join("\n")}\n`;

if (!DRY_RUN) {
  const existing = readFileSync(CLAUDE_MD, "utf8");
  // 删除已有的该文档块（如有）
  const blockRegex = new RegExp(`\\n- \\*\\*${docName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*\\*[\\s\\S]*?(?=\\n- \\*\\*|\\n## |$)`, "g");
  const cleaned = existing.replace(blockRegex, "");
  writeFileSync(CLAUDE_MD, cleaned + claudeMdBlock);
  console.log(`  CLAUDE.md 已更新，章节映射 ${allChapterLines.length} 行`);
} else {
  console.log(`  [DRY-RUN] 将写入:\n${claudeMdBlock}`);
}

// 自检
console.log(`\n========== 自检 ==========`);
const freshTags = DRY_RUN ? tagsData : JSON.parse(readFileSync(TAGS_FILE, "utf8"));
let allPassed = true;
for (const { key, partNum } of toProcess) {
  const entry    = freshTags[key];
  const tagCount = entry?.tags?.length || 0;
  const ok       = tagCount >= 2;
  if (!ok) allPassed = false;
  console.log(`  [tags] ${ok ? "✓" : "✗"} Part${partNum}: ${tagCount} 个标签`);
}
console.log(`\n自检结果: ${allPassed ? "全部通过 ✓" : "存在异常 ✗"}`);
console.log(`\n========== 完成 ==========\n`);
