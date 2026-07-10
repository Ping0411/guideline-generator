#!/usr/bin/env node
/**
 * batch-ingest.js — 批量处理 doc-sources.json 中登记的文档
 *
 * 用法：
 *   node batch-ingest.js                          # 处理所有未完整处理的文档
 *   node batch-ingest.js "文档名1" "文档名2"       # 处理指定文档（支持部分匹配）
 *   node batch-ingest.js --dry-run                # 预览，不实际执行
 *
 * 特性：
 *   - 以 doc-sources.json 为唯一数据源，无需手工维护文档列表
 *   - 增量：cache+tags 条目数 == parts 时视为已完整处理，跳过
 *   - 每个文档调用 ingest-pdftools.js --skip-index，最后统一重建索引一次
 *   - API 失败的切片写入 pending-retag.json，提醒用户后续用 retag.js 补救
 *   - 每个文档处理完后输出状态，全部完成后输出汇总报告
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { execFileSync, execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SOURCES_FILE     = join(__dirname, "doc-sources.json");
const CACHE_FILE       = join(__dirname, "cache.json");
const TAGS_FILE        = join(__dirname, "tags.json");
const PENDING_RETAG    = join(__dirname, "pending-retag.json");
const BUILD_INDEX      = join(__dirname, "build_index.py");

// ─── CLI 参数 ─────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const docArgs = args.filter(a => !a.startsWith("--"));

if (DRY_RUN) console.log("[DRY-RUN] 不实际执行任何操作\n");

// ─── 读取数据源 ───────────────────────────────────────────────────────────────

if (!existsSync(SOURCES_FILE)) {
  console.error("找不到 doc-sources.json:", SOURCES_FILE);
  process.exit(1);
}

const sources = JSON.parse(readFileSync(SOURCES_FILE, "utf8"));
const cache   = JSON.parse(readFileSync(CACHE_FILE,   "utf8"));
const tags    = JSON.parse(readFileSync(TAGS_FILE,    "utf8"));

// 过滤掉注释键（以 _ 开头）
const allDocs = Object.entries(sources).filter(([k]) => !k.startsWith("_"));

// ─── 确定待处理文档列表 ────────────────────────────────────────────────────────

function isComplete(docTitle, meta) {
  const localFile = meta.localFile?.replace(/^~/, process.env.HOME);
  if (!localFile) return false;
  const docName = basename(localFile, ".pdf");
  const prefix  = meta.cachePrefix;
  const expectedParts = meta.parts;
  if (!expectedParts) return false;

  // 统计 cache 中该文档的切片数
  const cacheCount = Object.keys(cache).filter(
    k => k.startsWith(`file://${prefix}${docName}_Part`)
  ).length;

  // 统计 tags 中该文档的切片数
  const tagsCount = Object.keys(tags).filter(
    k => k.startsWith(`file://${prefix}${docName}_Part`)
  ).length;

  return cacheCount === expectedParts && tagsCount === expectedParts;
}

let queue;

if (docArgs.length > 0) {
  // 指定模式：按名称部分匹配
  queue = allDocs.filter(([title]) =>
    docArgs.some(arg => title.toLowerCase().includes(arg.toLowerCase()))
  );
  const notFound = docArgs.filter(
    arg => !allDocs.some(([title]) => title.toLowerCase().includes(arg.toLowerCase()))
  );
  if (notFound.length > 0) {
    console.error("以下文档名在 doc-sources.json 中未找到:", notFound.join(", "));
    process.exit(1);
  }
} else {
  // 全量模式：只处理未完整处理的文档
  queue = allDocs.filter(([title, meta]) => !isComplete(title, meta));
}

// ─── 打印计划 ─────────────────────────────────────────────────────────────────

console.log("========== batch-ingest.js ==========");
console.log(`doc-sources.json 共 ${allDocs.length} 个文档`);
console.log(`本次处理: ${queue.length} 个\n`);

if (queue.length === 0) {
  console.log("所有文档已完整处理，无需操作。");
  process.exit(0);
}

for (const [title, meta] of queue) {
  const localFile = meta.localFile?.replace(/^~/, process.env.HOME);
  const fileExists = localFile && existsSync(localFile);
  const status = fileExists ? "待处理" : "⚠ 本地文件不存在";
  console.log(`  [${status}] ${title}`);
  if (!fileExists) console.log(`           → ${localFile}`);
}
console.log();

// ─── 逐个处理 ─────────────────────────────────────────────────────────────────

const results = [];

for (const [title, meta] of queue) {
  const localFile = meta.localFile?.replace(/^~/, process.env.HOME);

  // 跳过本地文件不存在的
  if (!localFile || !existsSync(localFile)) {
    console.log(`\n[跳过] ${title}`);
    console.log(`  原因: 本地文件不存在 → ${localFile || "(localFile 未设置)"}`);
    results.push({ title, status: "skipped", reason: "local file not found" });
    continue;
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`[处理] ${title}`);
  console.log(`  文件: ${localFile}`);
  console.log(`  Scope: ${meta.cachePrefix}`);

  if (DRY_RUN) {
    console.log("  [DRY-RUN] 跳过实际执行");
    results.push({ title, status: "dry-run" });
    continue;
  }

  // 构造 scope 参数（从 cachePrefix 反推）
  const scopeMap = {
    "SBN/split/":      "SBN",
    "api-specs/split/": "BNL",
    "SBN/TestCentral/": "TC",
  };
  const scope = scopeMap[meta.cachePrefix] || "SBN";

  try {
    execFileSync(
      "node",
      [
        join(__dirname, "ingest-pdftools.js"),
        localFile,
        `--scope=${scope}`,
        "--skip-index",
      ],
      { stdio: "inherit" }
    );
    results.push({ title, status: "success" });
  } catch (e) {
    console.error(`  [ERROR] ingest-pdftools.js 执行失败: ${e.message}`);
    results.push({ title, status: "error", reason: e.message });
  }
}

// ─── 检测 API 失败的切片，写入 pending-retag.json ─────────────────────────────

if (!DRY_RUN) {
  // 重新读取最新的 cache 和 tags（ingest 已写入）
  const freshCache = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  const freshTags  = JSON.parse(readFileSync(TAGS_FILE,  "utf8"));

  const pendingItems = [];

  for (const [title, meta] of queue) {
    const localFile = meta.localFile?.replace(/^~/, process.env.HOME);
    if (!localFile || !existsSync(localFile)) continue;

    const docName = basename(localFile, ".pdf");
    const prefix  = meta.cachePrefix;

    // 找到 cache 中有但 tags 中没有的切片
    const cacheKeys = Object.keys(freshCache).filter(
      k => k.startsWith(`file://${prefix}${docName}_Part`)
    );
    for (const key of cacheKeys) {
      if (!freshTags[key]) {
        pendingItems.push({ docTitle: title, docName, key });
      }
    }
  }

  if (pendingItems.length > 0) {
    writeFileSync(PENDING_RETAG, JSON.stringify({
      generatedAt: new Date().toISOString(),
      count: pendingItems.length,
      items: pendingItems,
    }, null, 2));
    console.log(`\n⚠ 有 ${pendingItems.length} 个切片 tags 缺失，已记录到 pending-retag.json`);
    console.log(`  修复方法: node retag.js "<docName>" 逐个补救`);
  } else {
    // 清除旧的 pending-retag.json（如果存在）
    if (existsSync(PENDING_RETAG)) {
      writeFileSync(PENDING_RETAG, JSON.stringify({
        generatedAt: new Date().toISOString(),
        count: 0,
        items: [],
      }, null, 2));
    }
  }
}

// ─── 统一重建向量索引 ─────────────────────────────────────────────────────────

const successCount = results.filter(r => r.status === "success").length;

if (!DRY_RUN && successCount > 0) {
  console.log("\n========== 重建向量索引 ==========");
  try {
    execSync(`TRANSFORMERS_OFFLINE=1 HF_HUB_OFFLINE=1 python3 ${BUILD_INDEX}`, {
      stdio: "inherit",
      env: { ...process.env, TRANSFORMERS_OFFLINE: "1", HF_HUB_OFFLINE: "1" },
    });
    console.log("  向量索引重建完成");
  } catch (e) {
    console.error("  build_index.py 执行出错:", e.message);
  }
} else if (!DRY_RUN) {
  console.log("\n（无成功处理的文档，跳过索引重建）");
}

// ─── 汇总报告 ─────────────────────────────────────────────────────────────────

console.log("\n========== 汇总报告 ==========");
const succeeded = results.filter(r => r.status === "success");
const failed    = results.filter(r => r.status === "error");
const skipped   = results.filter(r => r.status === "skipped");
const dryRun    = results.filter(r => r.status === "dry-run");

console.log(`成功: ${succeeded.length} 个`);
if (succeeded.length > 0)
  succeeded.forEach(r => console.log(`  ✓ ${r.title}`));

console.log(`失败: ${failed.length} 个`);
if (failed.length > 0)
  failed.forEach(r => console.log(`  ✗ ${r.title} — ${r.reason}`));

console.log(`跳过: ${skipped.length} 个`);
if (skipped.length > 0)
  skipped.forEach(r => console.log(`  - ${r.title} (${r.reason})`));

if (dryRun.length > 0)
  console.log(`DRY-RUN: ${dryRun.length} 个`);

console.log("\n========== 完成 ==========\n");
