#!/usr/bin/env node
/**
 * remove-doc.js — 从 MCP 中彻底删除一个文档的所有数据
 *
 * 用法：
 *   node remove-doc.js "文档名（与 doc-sources.json 中的 key 一致）"
 *   node remove-doc.js "文档名" --no-rebuild      # 跳过向量索引重建（批量删除时使用）
 *   node remove-doc.js "文档名" --keep-registry   # 跳过步骤5，保留 doc-sources.json 条目
 *                                                  # 用于"替换文档"场景：先删旧版本再加新版本
 *   node remove-doc.js "文档名" --dry-run          # 预览，不实际执行
 *
 * 执行内容：
 *   1. 从 cache.json 删除该文档的所有切片条目
 *   2. 从 tags.json 删除该文档的所有切片条目
 *   3. 删除 ~/Downloads/split/ 下的切片文件
 *   4. 从 CLAUDE.md 删除对应文档块
 *   5. 从 doc-sources.json 删除登记（除非 --keep-registry）
 *   6. 重建向量索引（除非 --no-rebuild）
 *   7. 输出自检报告
 *
 * 替换文档的标准流程（必须先删后加，顺序不能反）：
 *   node remove-doc.js "旧文档名" --no-rebuild --keep-registry
 *   node batch-ingest.js "新文档名"
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SOURCES_FILE = join(__dirname, "doc-sources.json");
const CACHE_FILE   = join(__dirname, "cache.json");
const TAGS_FILE    = join(__dirname, "tags.json");
const CLAUDE_MD    = join(__dirname, "chapter-map.md");
const BUILD_INDEX  = join(__dirname, "build_index.py");

// ─── CLI 参数 ─────────────────────────────────────────────────────────────────

const args          = process.argv.slice(2);
const DRY_RUN       = args.includes("--dry-run");
const NO_REBUILD    = args.includes("--no-rebuild");
const KEEP_REGISTRY = args.includes("--keep-registry");
const docArg        = args.find(a => !a.startsWith("--"));

if (!docArg) {
  console.error('用法: node remove-doc.js "文档名" [--no-rebuild] [--keep-registry] [--dry-run]');
  process.exit(1);
}

if (DRY_RUN)       console.log("[DRY-RUN] 不实际删除任何内容\n");
if (NO_REBUILD)    console.log("[--no-rebuild] 将跳过向量索引重建\n");
if (KEEP_REGISTRY) console.log("[--keep-registry] 将保留 doc-sources.json 条目\n");

// ─── 从 doc-sources.json 找到该文档的元数据 ────────────────────────────────────

if (!existsSync(SOURCES_FILE)) {
  console.error("找不到 doc-sources.json:", SOURCES_FILE);
  process.exit(1);
}

const sources = JSON.parse(readFileSync(SOURCES_FILE, "utf8"));

// 精确匹配或部分匹配
let docTitle = Object.keys(sources).find(k => k === docArg);
if (!docTitle) {
  // 尝试部分匹配
  const matches = Object.keys(sources).filter(
    k => !k.startsWith("_") && k.toLowerCase().includes(docArg.toLowerCase())
  );
  if (matches.length === 0) {
    console.error(`doc-sources.json 中未找到匹配 "${docArg}" 的文档`);
    console.error("已登记的文档名:");
    Object.keys(sources).filter(k => !k.startsWith("_")).forEach(k => console.error(" ", k));
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`"${docArg}" 匹配到多个文档，请使用更精确的名称:`);
    matches.forEach(k => console.error(" ", k));
    process.exit(1);
  }
  docTitle = matches[0];
}

const meta      = sources[docTitle];
const localFile = meta.localFile?.replace(/^~/, process.env.HOME);
if (!localFile) {
  console.error(`"${docTitle}" 的 localFile 未设置，无法推算 docName，请检查 doc-sources.json`);
  process.exit(1);
}
const docName = basename(localFile, ".pdf");
const prefix  = meta.cachePrefix;

console.log("========== remove-doc.js ==========");
console.log(`文档: ${docTitle}`);
console.log(`docName: ${docName}`);
console.log(`prefix: ${prefix}`);
console.log();

// ─── Step 1: 从 cache.json 删除 ───────────────────────────────────────────────

console.log("[Step 1] 从 cache.json 删除...");
const cache    = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
const cacheHit = Object.keys(cache).filter(
  k => k.startsWith(`file://${prefix}${docName}_Part`)
);
console.log(`  找到 ${cacheHit.length} 个条目`);
if (!DRY_RUN) {
  for (const k of cacheHit) delete cache[k];
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log(`  已删除 ${cacheHit.length} 条`);
}

// ─── Step 2: 从 tags.json 删除 ────────────────────────────────────────────────

console.log("[Step 2] 从 tags.json 删除...");
const tags    = JSON.parse(readFileSync(TAGS_FILE, "utf8"));
const tagsHit = Object.keys(tags).filter(
  k => k.startsWith(`file://${prefix}${docName}_Part`)
);
console.log(`  找到 ${tagsHit.length} 个条目`);
if (!DRY_RUN) {
  for (const k of tagsHit) delete tags[k];
  writeFileSync(TAGS_FILE, JSON.stringify(tags, null, 2));
  console.log(`  已删除 ${tagsHit.length} 条`);
}

// ─── Step 3: 删除切片文件 ─────────────────────────────────────────────────────

console.log("[Step 3] 删除切片文件...");

// 从 SCOPE_CONFIG 推算 outDir
const scopeOutDirMap = {
  "SBN/split/":       join(process.env.HOME, "Downloads/split"),
  "api-specs/split/": join(__dirname, "api-specs/split"),
  "SBN/TestCentral/": join(process.env.HOME, "Downloads/SBN/Test Central"),
};
const outDir = scopeOutDirMap[prefix];
if (!outDir) {
  console.error(`  未知的 cachePrefix "${prefix}"，无法确定切片目录，请手动删除切片文件`);
  console.error(`  涉及的 cache key 前缀: file://${prefix}${docName}_Part*.pdf`);
  process.exit(1);
}

// 从 cache 原始条目名推算文件路径（文件名 = key 去掉 "file://" + prefix 前缀）
const sliceFiles = cacheHit.map(k => {
  const filename = k.replace(`file://${prefix}`, "");
  return join(outDir, filename);
});

let deletedFiles = 0;
let missingFiles = 0;
for (const filePath of sliceFiles) {
  if (existsSync(filePath)) {
    if (!DRY_RUN) unlinkSync(filePath);
    deletedFiles++;
  } else {
    console.log(`  文件不存在（跳过）: ${filePath}`);
    missingFiles++;
  }
}
console.log(`  已删除 ${DRY_RUN ? "(dry-run)" : ""} ${deletedFiles} 个文件，${missingFiles} 个已缺失`);

// ─── Step 4: 从 CLAUDE.md 删除文档块 ──────────────────────────────────────────

console.log("[Step 4] 从 CLAUDE.md 删除文档块...");
const existing = readFileSync(CLAUDE_MD, "utf8");

// 匹配 "- **docName** `...`" 开头直到下一个同级条目或章节
const escaped   = docName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const blockRegex = new RegExp(
  `\\n- \\*\\*${escaped}\\*\\*[\\s\\S]*?(?=\\n- \\*\\*|\\n## |$)`,
  "g"
);
const cleaned = existing.replace(blockRegex, "");
const removed = existing.length !== cleaned.length;

if (removed) {
  if (!DRY_RUN) writeFileSync(CLAUDE_MD, cleaned);
  console.log(`  已删除 CLAUDE.md 中的文档块（移除 ${existing.length - cleaned.length} 个字符）`);
} else {
  console.log(`  CLAUDE.md 中未找到该文档块（可能已手动删除）`);
}

// ─── Step 5: 从 doc-sources.json 删除登记 ────────────────────────────────────

console.log("[Step 5] 从 doc-sources.json 删除登记...");
if (KEEP_REGISTRY) {
  console.log("  --keep-registry 已设置，保留条目（替换场景下由新版本覆盖）");
} else {
  if (!DRY_RUN) {
    delete sources[docTitle];
    writeFileSync(SOURCES_FILE, JSON.stringify(sources, null, 2));
  }
  console.log(`  ${DRY_RUN ? "[DRY-RUN] 将删除" : "已删除"} doc-sources.json 中的条目: ${docTitle}`);
}

// ─── Step 6: 重建向量索引 ─────────────────────────────────────────────────────

if (!NO_REBUILD && !DRY_RUN) {
  console.log("\n[Step 6] 重建向量索引...");
  try {
    execSync(`TRANSFORMERS_OFFLINE=1 HF_HUB_OFFLINE=1 python3 ${BUILD_INDEX}`, {
      stdio: "inherit",
      env: { ...process.env, TRANSFORMERS_OFFLINE: "1", HF_HUB_OFFLINE: "1" },
    });
    console.log("  向量索引重建完成");
  } catch (e) {
    console.error("  build_index.py 执行出错:", e.message);
  }
} else if (NO_REBUILD) {
  console.log("\n[Step 6] 跳过向量索引重建（--no-rebuild）");
} else {
  console.log("\n[Step 6] 跳过向量索引重建（dry-run）");
}

// ─── Step 7: 自检报告 ─────────────────────────────────────────────────────────

console.log("\n========== 自检报告 ==========");
const freshCache   = DRY_RUN ? cache   : JSON.parse(readFileSync(CACHE_FILE,   "utf8"));
const freshTags    = DRY_RUN ? tags    : JSON.parse(readFileSync(TAGS_FILE,    "utf8"));
const freshSources = DRY_RUN ? sources : JSON.parse(readFileSync(SOURCES_FILE, "utf8"));

const remainCache   = Object.keys(freshCache).filter(
  k => k.startsWith(`file://${prefix}${docName}_Part`)
).length;
const remainTags    = Object.keys(freshTags).filter(
  k => k.startsWith(`file://${prefix}${docName}_Part`)
).length;
const remainSources = docTitle in freshSources;

console.log(`  cache.json 残留条目:       ${remainCache} ${DRY_RUN ? "(dry-run，未实际删除)" : remainCache === 0 ? "✓" : "✗ 未清干净"}`);
console.log(`  tags.json  残留条目:       ${remainTags}  ${DRY_RUN ? "(dry-run，未实际删除)" : remainTags  === 0 ? "✓" : "✗ 未清干净"}`);
console.log(`  切片文件已删除:            ${deletedFiles} 个 ${DRY_RUN ? "(dry-run)" : "✓"}`);
console.log(`  CLAUDE.md 文档块:          ${removed ? (DRY_RUN ? "将删除（dry-run）" : "已删除 ✓") : "未找到（需手动确认）"}`);
console.log(`  doc-sources.json 条目:     ${KEEP_REGISTRY ? "保留（--keep-registry）" : remainSources ? (DRY_RUN ? "将删除（dry-run）" : "✗ 未删除") : "已删除 ✓"}`);

if (!DRY_RUN && (remainCache > 0 || remainTags > 0 || (!KEEP_REGISTRY && remainSources))) {
  console.error("\n⚠ 存在残留数据，请手动检查！");
  process.exit(1);
}

console.log("\n========== 完成 ==========\n");
