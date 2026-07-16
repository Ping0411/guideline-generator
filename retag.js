#!/usr/bin/env node
/**
 * retag.js — 自动差异化处理标签生成和章节映射
 *
 * 用法：
 *   node retag.js                    # 自动扫描全部 cache.json，处理新增/变更/删除
 *   node retag.js <docName前缀>       # 只处理匹配的文档（手动指定范围）
 *   node retag.js --dry-run          # 预览模式，不写入任何文件
 *
 * 差异化逻辑（基于 retag_state.json 记录的内容 hash）：
 *   - 新增：cache.json 有但 retag_state.json 无 → 处理
 *   - 变更：内容 hash 不一致 → 重新处理
 *   - 删除：retag_state.json 有但 cache.json 无 → 清理 tags.json 和 chapter-map.md
 *   - 不变：hash 一致且 tags.json 已有 → 跳过
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CACHE_FILE    = join(__dirname, "cache.json");
const TAGS_FILE     = join(__dirname, "tags.json");
const CHAPTER_MAP   = join(__dirname, "chapter-map.md");
const TAG_GUIDE     = join(__dirname, "TAG_GUIDELINES.md");
const CHAPTER_GUIDE = join(__dirname, "CHAPTER_GUIDELINES.md");
const STATE_FILE    = join(__dirname, "retag_state.json");

const API_KEY  = "0399a7b7-c66d-4453-9803-b0e0ebe38b28";
const BASE_URL = "http://localhost:6655/anthropic";
const MODEL    = "claude-sonnet-4-6";

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const docArg  = args.find(a => !a.startsWith("--"));

const tagGuidelines     = readFileSync(TAG_GUIDE,     "utf8");
const chapterGuidelines = readFileSync(CHAPTER_GUIDE, "utf8");

const cache    = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
const tagsData = JSON.parse(readFileSync(TAGS_FILE,  "utf8"));
const state    = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, "utf8"))
  : {};

function contentHash(text) {
  return createHash("md5").update(text).digest("hex");
}

// 从 URL 提取 partNum（无 _PartN 后缀的单文件返回 0）
function getPartNum(url) {
  const m = url.match(/_Part(\d+)\.pdf$/);
  return m ? parseInt(m[1]) : 0;
}

// 从 URL 提取文档名（去掉 file://前缀、路径、_PartN.pdf 后缀）
function getDocName(url) {
  return url
    .replace(/^file:\/\/[^/]+\/[^/]+\//, "")  // 去掉 file://SBN/split/ 或 file://api-specs/split/
    .replace(/_Part\d+\.pdf$/, "")              // 去掉 _PartN.pdf
    .replace(/\.pdf$/, "");                     // 去掉单文件的 .pdf
}

// 从 URL 提取 scope prefix（file://SBN/split/ 等）
function getScopePrefix(url) {
  const m = url.match(/^file:\/\/([^/]+\/[^/]+\/)/);
  return m ? m[1] : "";
}

// ── 确定需要处理的 URL 集合 ──────────────────────────────────────────────────

const allCacheKeys = Object.keys(cache).filter(k => cache[k].success);

// 如果指定了 docArg，只处理匹配的 key
const candidateKeys = docArg
  ? allCacheKeys.filter(k => k.includes(docArg))
  : allCacheKeys;

if (docArg && candidateKeys.length === 0) {
  console.error(`cache.json 中未找到匹配 "${docArg}" 的条目`);
  process.exit(1);
}

// 差异化分类
const toProcess = [];  // 需要生成/重新生成标签和章节的
const toDelete  = [];  // 已从 cache.json 删除，需要清理的

// 检测删除（只在全量扫描时检测，指定 docArg 时跳过）
if (!docArg) {
  for (const url of Object.keys(state)) {
    if (!cache[url]) {
      toDelete.push(url);
    }
  }
}

// 检测新增和变更
for (const url of candidateKeys) {
  const content = cache[url]?.content || "";
  const hash    = contentHash(content);
  const stateHash = state[url];
  const hasTag    = !!tagsData[url];

  if (!stateHash && hasTag) {
    // 已有 tag 但没有 state 记录（历史遗留）→ 补录 hash，跳过重新处理
    // 不加入 toProcess，但在最后更新 state
    continue;
  }

  if (!stateHash || !hasTag || stateHash !== hash) {
    toProcess.push({ url, content, hash, partNum: getPartNum(url), title: cache[url]?.title || url });
  }
}

// 按 docName 分组，同一文档的切片排在一起，按 partNum 排序
toProcess.sort((a, b) => {
  const da = getDocName(a.url);
  const db = getDocName(b.url);
  if (da !== db) return da.localeCompare(db);
  return a.partNum - b.partNum;
});

console.log(`\n========== retag.js ==========`);
if (docArg) console.log(`筛选: "${docArg}"`);
console.log(`需处理: ${toProcess.length} 个切片`);
console.log(`需清理: ${toDelete.length} 个已删除文档`);
if (DRY_RUN) console.log(`[DRY-RUN] 不写入任何文件`);

if (toProcess.length === 0 && toDelete.length === 0) {
  console.log("\n无需处理，所有文档均为最新状态。");
  // 补录历史遗留 hash
  let backfillCount = 0;
  for (const url of allCacheKeys) {
    if (!state[url] && tagsData[url]) {
      state[url] = contentHash(cache[url]?.content || "");
      backfillCount++;
    }
  }
  if (backfillCount > 0 && !DRY_RUN) {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`补录历史 hash: ${backfillCount} 条`);
  }
  console.log(`\n========== 完成 ==========\n`);
  process.exit(0);
}

// ── Claude API 调用 ──────────────────────────────────────────────────────────

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

// ── 处理各切片 ───────────────────────────────────────────────────────────────

const results = [];  // { url, partNum, tags, chapter, hash }

for (const { url, content, hash, partNum, title } of toProcess) {
  if (!content) {
    console.warn(`  SKIP (空内容): ${title}`);
    continue;
  }

  console.log(`  处理: ${title}`);
  let parsed;
  try {
    parsed = await callClaude(content, title);
  } catch (e) {
    console.error(`  ERROR: ${title}: ${e.message}`);
    continue;
  }

  const tags    = Array.isArray(parsed.tags)         ? parsed.tags    : [];
  const chapter = typeof parsed.chapter === "string" ? parsed.chapter : `Part${partNum}: (parse error)`;

  console.log(`    tags (${tags.length}): ${tags.slice(0, 4).join(", ")}${tags.length > 4 ? " ..." : ""}`);
  console.log(`    chapter: ${chapter}`);
  results.push({ url, partNum, tags, chapter, hash });
}

// ── 写入 tags.json ───────────────────────────────────────────────────────────

console.log(`\n[写入 tags.json]...`);
for (const { url, tags } of results) {
  if (tags.length === 0) continue;
  tagsData[url] = {
    title: cache[url]?.title || url.split("/").pop(),
    urls: [url],
    tags,
    taggedAt: new Date().toISOString(),
  };
}

// 清理已删除文档的 tags
for (const url of toDelete) {
  if (tagsData[url]) {
    console.log(`  清理 tags: ${url}`);
    delete tagsData[url];
  }
}

if (!DRY_RUN) {
  writeFileSync(TAGS_FILE, JSON.stringify(tagsData, null, 2));
  console.log(`  tags.json 已更新`);
}

// ── 更新 chapter-map.md ──────────────────────────────────────────────────────

console.log(`\n[更新 chapter-map.md]...`);

// 按文档分组，收集本次有新结果的文档名
const docNamesUpdated = new Set(results.map(r => getDocName(r.url)));

let chapterMd = readFileSync(CHAPTER_MAP, "utf8");

for (const docName of docNamesUpdated) {
  // 找出该文档所有切片（含未变更的，按 partNum 排序）
  const docKeys = Object.keys(cache)
    .filter(k => getDocName(k) === docName)
    .sort((a, b) => getPartNum(a) - getPartNum(b));

  const prefix    = getScopePrefix(docKeys[0]);
  const numChunks = docKeys.length;
  const isSingle  = numChunks === 1 && !docKeys[0].match(/_Part\d+\.pdf$/);

  // 构建章节行：优先用本次新生成的，否则从 chapter-map.md 中保留原有内容
  const chapterLines = [];
  for (const key of docKeys) {
    const newResult = results.find(r => r.url === key);
    if (newResult && newResult.chapter) {
      chapterLines.push(`  - ${newResult.chapter}`);
    }
    // 已有但未变更的切片：其章节行已在 chapter-map.md 中，整块替换时会保留
  }

  // 生成新的文档块
  let newBlock;
  if (isSingle) {
    const urlPattern = `file://${prefix}${docName}.pdf`;
    const chapter = chapterLines[0]?.replace(/^\s+-\s+/, "") || "";
    newBlock = `\n- **${docName}** \`${urlPattern}\`\n  - ${chapter}\n`;
  } else {
    const urlPattern = `file://${prefix}${docName}_Part{N}.pdf`;
    newBlock = `\n- **${docName}** \`${urlPattern}\` (N = 1–${numChunks})\n${chapterLines.join("\n")}\n`;
  }

  // 替换 chapter-map.md 中该文档的旧块
  const escapedName = docName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blockRegex  = new RegExp(
    `\\n- \\*\\*${escapedName}\\*\\*[\\s\\S]*?(?=\\n- \\*\\*|$)`,
    "g"
  );
  if (blockRegex.test(chapterMd)) {
    chapterMd = chapterMd.replace(blockRegex, newBlock);
    console.log(`  更新: ${docName}`);
  } else {
    chapterMd += newBlock;
    console.log(`  新增: ${docName}`);
  }
}

// 清理已删除文档的章节映射
for (const url of toDelete) {
  const docName     = getDocName(url);
  const escapedName = docName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blockRegex  = new RegExp(
    `\\n- \\*\\*${escapedName}\\*\\*[\\s\\S]*?(?=\\n- \\*\\*|$)`,
    "g"
  );
  if (blockRegex.test(chapterMd)) {
    chapterMd = chapterMd.replace(blockRegex, "");
    console.log(`  清理 chapter-map: ${docName}`);
  }
}

if (!DRY_RUN) {
  writeFileSync(CHAPTER_MAP, chapterMd);
  console.log(`  chapter-map.md 已更新`);
}

// ── 更新 retag_state.json ────────────────────────────────────────────────────

// 记录本次处理的 hash
for (const { url, hash } of results) {
  state[url] = hash;
}

// 补录历史遗留（有 tag 但无 state 记录）
for (const url of allCacheKeys) {
  if (!state[url] && tagsData[url]) {
    state[url] = contentHash(cache[url]?.content || "");
  }
}

// 清理已删除文档的 state
for (const url of toDelete) {
  delete state[url];
}

if (!DRY_RUN) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`  retag_state.json 已更新`);
}

// ── 自检 ─────────────────────────────────────────────────────────────────────

console.log(`\n========== 自检 ==========`);
const freshTags = DRY_RUN ? tagsData : JSON.parse(readFileSync(TAGS_FILE, "utf8"));
let allPassed = true;
for (const { url, partNum } of toProcess) {
  const entry    = freshTags[url];
  const tagCount = entry?.tags?.length || 0;
  const ok       = tagCount >= 2;
  if (!ok) allPassed = false;
  const label = partNum > 0 ? `Part${partNum}` : getDocName(url);
  console.log(`  [tags] ${ok ? "✓" : "✗"} ${label}: ${tagCount} 个标签`);
}
console.log(`\n自检结果: ${allPassed ? "全部通过 ✓" : "存在异常 ✗"}`);
console.log(`\n========== 完成 ==========\n`);
