/**
 * download-doc.js
 * Downloads a SAP Help Portal document as PDF (Full Document or batched Custom PDF).
 *
 * Usage:
 *   node download-doc.js <url> [output-dir]
 *
 * Example:
 *   node download-doc.js "https://help.sap.com/docs/business-network-for-procurement/cxml-solutions/cxml-solutions-guide" ~/Downloads/SAP-docs
 *
 * Requires Edge running with remote debugging:
 *   "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
 *     --remote-debugging-port=9222 --user-data-dir=/tmp/edge-debug --no-first-run &
 */

import puppeteer from "puppeteer";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { createWriteStream } from "fs";
import https from "https";
import http from "http";
const BATCH_LIMIT = 200;

const inputUrl = process.argv[2];
const outputDir = resolve(process.argv[3] || ".");

if (!inputUrl) {
  console.error("Usage: node download-doc.js <url> [output-dir]");
  process.exit(1);
}

if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

// ─── Utility: download a file from URL to local path ────────────────────────

function downloadFile(fileUrl, destPath) {
  return new Promise((resolve, reject) => {
    const proto = fileUrl.startsWith("https") ? https : http;
    const file = createWriteStream(destPath);
    proto.get(fileUrl, res => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", err => {
      file.close();
      reject(err);
    });
  });
}

// ─── Utility: wait for a new PDF tab to open ────────────────────────────────

function waitForNewPdfTab(browser, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for PDF tab")),
      timeoutMs
    );
    browser.on("targetcreated", async target => {
      const targetUrl = target.url();
      if (
        targetUrl.includes(".pdf") ||
        targetUrl.includes("pdfdownload") ||
        targetUrl.includes("GetFile")
      ) {
        clearTimeout(timer);
        resolve(targetUrl);
      }
    });
  });
}

// ─── Utility: safe filename from title ──────────────────────────────────────

function safeFilename(title) {
  return title.replace(/[^a-zA-Z0-9_\- ]/g, "_").trim().slice(0, 80);
}

// ─── Utility: read PDF metadata (page count + first-page text) ──────────────

async function readPdfMeta(filePath) {
  const { statSync } = await import("fs");
  const sizeBytes = statSync(filePath).size;
  const fileSizeMB = (sizeBytes / 1024 / 1024).toFixed(1);

  // Try to read page count — unreliable for encrypted PDFs, used as reference only
  const data = readFileSync(filePath);
  const str = data.toString("latin1");
  const counts = [...str.matchAll(/\/Count\s+(\d+)/g)].map(m => parseInt(m[1]));
  const pageCount = counts.length > 0 ? Math.max(...counts) : "unknown";

  const valid = sizeBytes > 50 * 1024; // at least 50KB
  return { pageCount, fileSizeMB, valid };
}

// ─── Utility: extract document title from PDF first page ────────────────────
// The first page contains the doc title as the largest heading.
// We look for a prominent line that is not "SAP", "Public", "Generated on:", etc.

function extractTitleFromText(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const skip = /^(SAP|Public|Generated on|Original content|This guide|Version|\d)/i;
  for (const line of lines) {
    if (line.length > 5 && !skip.test(line)) {
      return line;
    }
  }
  return null;
}

// ─── Utility: extract Original content URL from PDF first page ──────────────

function extractOriginalUrl(text) {
  const match = text.match(/Original content:\s*(https?:\/\/[^\s\n]+)/);
  return match ? match[1] : null;
}

// ─── Utility: update docs-registry.json ─────────────────────────────────────

function updateRegistry(registryPath, entry) {
  let registry = {};
  if (existsSync(registryPath)) {
    try {
      registry = JSON.parse(readFileSync(registryPath, "utf8"));
    } catch (_) {}
  }
  const key = entry.title || entry.inputUrl;
  if (!registry[key]) {
    registry[key] = {
      inputUrl: entry.inputUrl,
      originalContentUrl: entry.originalContentUrl || null,
      files: [],
    };
  }
  for (const f of entry.files) {
    if (!registry[key].files.find(x => x.filename === f.filename)) {
      registry[key].files.push(f);
    }
  }
  writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf8");
  console.log(`Registry updated: ${registryPath}`);
}

// ─── Custom PDF: read all top-level chapter checkboxes ──────────────────────
// Returns array of { label, checkboxEl } for top-level items only.

async function readAllChapters(page) {
  await page.waitForSelector(".pd-toc-node, .toc-list-item, [class*='toc']", {
    timeout: 10000,
  }).catch(() => {});

  const chapters = await page.evaluate(() => {
    // The TOC panel shows chapters as list items with a checkbox.
    // We target the checkboxes that are direct/top-level entries.
    const results = [];
    const checkboxes = Array.from(document.querySelectorAll("input[type='checkbox']"));
    for (const cb of checkboxes) {
      // Find the label text near this checkbox
      const parent = cb.closest("li, div, label") || cb.parentElement;
      const labelEl = parent
        ? parent.querySelector("span, label, a") || parent
        : cb.parentElement;
      const label = labelEl ? labelEl.textContent.trim() : "";
      if (label) {
        results.push({ label });
      }
    }
    return results;
  });

  return chapters;
}

// ─── Custom PDF: get current selected topic count ───────────────────────────

async function getTopicCount(page) {
  const text = await page.evaluate(() => {
    for (const el of document.querySelectorAll("*")) {
      if (
        el.children.length === 0 &&
        el.textContent.match(/\d+ topics? selected/)
      ) {
        return el.textContent.trim();
      }
    }
    return null;
  });
  if (!text) return { selected: 0, maximum: BATCH_LIMIT };
  const m = text.match(/(\d+) topics? selected(?:\s*\((\d+) maximum\))?/);
  return {
    selected: m ? parseInt(m[1]) : 0,
    maximum: m && m[2] ? parseInt(m[2]) : BATCH_LIMIT,
    raw: text,
  };
}

// ─── Custom PDF: click a checkbox and handle the Select/Deselect popup ──────

async function clickCheckboxWithPopup(page, index, action) {
  // action: "select" | "deselect"
  const checkboxes = await page.$$("input[type='checkbox']");
  if (index >= checkboxes.length) return false;

  const cb = checkboxes[index];
  await cb.click();
  await new Promise(r => setTimeout(r, 400));

  // Check if a popup appeared (Select/Deselect parent and children)
  const popup = await page.evaluate(actionType => {
    const keywords =
      actionType === "select"
        ? ["Select parent and children", "select parent and children"]
        : ["Deselect parent and children", "deselect parent and children"];
    const els = Array.from(document.querySelectorAll("li, button, span, div, a"));
    for (const el of els) {
      const t = el.textContent.trim();
      if (keywords.some(k => t === k || t.includes(k))) {
        return true;
      }
    }
    return false;
  }, action);

  if (popup) {
    const keyword =
      action === "select" ? "Select parent and children" : "Deselect parent and children";
    const clicked = await page.evaluate(kw => {
      const els = Array.from(document.querySelectorAll("li, button, span, div, a"));
      for (const el of els) {
        if (el.textContent.trim() === kw || el.textContent.trim().includes(kw)) {
          el.click();
          return true;
        }
      }
      return false;
    }, keyword);
    if (!clicked) {
      console.warn(`  Warning: popup appeared but could not click "${keyword}"`);
    }
    await new Promise(r => setTimeout(r, 400));
  }

  return true;
}

// ─── Custom PDF: click "Select all" then "Deselect all" to reset ────────────

async function resetSelection(page) {
  // Click Select all first (to make Deselect all appear)
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("button, span, a"));
    for (const el of els) {
      if (el.textContent.trim() === "Select all") { el.click(); return; }
    }
  });
  await new Promise(r => setTimeout(r, 600));

  // Now click Deselect all
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("button, span, a"));
    for (const el of els) {
      if (el.textContent.trim() === "Deselect all") { el.click(); return; }
    }
  });
  await new Promise(r => setTimeout(r, 600));

  const { selected } = await getTopicCount(page);
  console.log(`  After reset: ${selected} topics selected`);
}

// ─── Custom PDF: wait for "Creating PDF" modal to appear then disappear ──────

async function waitForPdfCreation(page, timeoutMs = 180000) {
  console.log("  Waiting for 'Creating PDF' modal...");

  // Wait for the modal to appear
  await page.waitForFunction(
    () => document.body.innerText.includes("Creating PDF"),
    { timeout: 15000 }
  ).catch(() => console.log("  (modal did not appear, continuing)"));

  // Wait for modal to disappear (PDF is ready → new tab will open)
  await page.waitForFunction(
    () => !document.body.innerText.includes("Creating PDF... Please don't close"),
    { timeout: timeoutMs }
  ).catch(() => {});

  await new Promise(r => setTimeout(r, 1000));
}

// ─── Full Document flow ──────────────────────────────────────────────────────

async function downloadFullDocument(page, browser, docTitle, pdfTabPromise) {
  if (!pdfTabPromise) {
    pdfTabPromise = waitForNewPdfTab(browser);
  }

  console.log("Waiting for PDF tab...");
  const pdfUrl = await pdfTabPromise;
  console.log("PDF URL: " + pdfUrl);

  // Use page title as document title
  const pageTitle = await page.title();
  const titleFromPage = pageTitle.replace(/\s*\|.*$/, "").trim();
  const finalTitle = docTitle || titleFromPage || "SAP_Document";
  const filename = safeFilename(finalTitle) + ".pdf";
  const destPath = join(outputDir, filename);

  // Download via browser session (carries cookies) to get the full file
  console.log("Downloading via browser session...");
  const buffer = await page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: "include" });
    const ab = await res.arrayBuffer();
    return Array.from(new Uint8Array(ab));
  }, pdfUrl);

  const { writeFileSync } = await import("fs");
  writeFileSync(destPath, Buffer.from(buffer));

  const meta = await readPdfMeta(destPath);
  console.log(`Saved: ${destPath} (${meta.fileSizeMB} MB)`);
  if (!meta.valid) {
    console.error(`WARNING: File size too small (${meta.fileSizeMB} MB) — download may be incomplete!`);
  }

  return {
    files: [{ filename, pageCount: meta.pageCount, part: null }],
    title: finalTitle,
    originalContentUrl: null,
    totalTopics: null,
  };
}

// ─── Custom PDF flow (with batching) ────────────────────────────────────────

async function downloadCustomPdf(page, browser, docTitle) {
  console.log("Custom PDF mode — reading chapter list...");

  // Wait for checkboxes to actually render (they take a moment after panel opens)
  await page.waitForSelector("input[type='checkbox']", { timeout: 20000 })
    .catch(() => { throw new Error("Custom PDF panel did not render checkboxes within 20s — panel may not have opened"); });
  await new Promise(r => setTimeout(r, 500));

  // Count total checkboxes = total top-level chapters
  const totalCheckboxes = await page.evaluate(
    () => document.querySelectorAll("input[type='checkbox']").length
  );
  console.log(`Total checkboxes found: ${totalCheckboxes}`);

  // Click "Select all" to learn total topic count
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("button, span, a"));
    for (const el of els) {
      if (el.textContent.trim() === "Select all") { el.click(); return; }
    }
  });
  await new Promise(r => setTimeout(r, 800));
  const { selected: totalTopics } = await getTopicCount(page);
  console.log(`Total topics in document: ${totalTopics}`);

  // ── Fast path: all topics fit in one batch → download immediately ──────────
  if (totalTopics <= BATCH_LIMIT) {
    console.log(`Total topics (${totalTopics}) ≤ ${BATCH_LIMIT} — downloading all in one go`);

    const pageTitle = await page.title();
    const titleFromPage = pageTitle.replace(/\s*\|.*$/, "").trim();
    const finalTitle = docTitle || titleFromPage || "SAP_Document";
    const filename = safeFilename(finalTitle) + ".pdf";
    const destPath = join(outputDir, filename);

    const pdfTabPromise = waitForNewPdfTab(browser);
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      for (const btn of btns) {
        if (btn.textContent.trim() === "Create PDF") { btn.click(); return; }
      }
      for (const btn of btns) {
        if (btn.textContent.trim().includes("Create PDF")) { btn.click(); return; }
      }
    });
    console.log("  Clicked Create PDF");
    await waitForPdfCreation(page);
    const pdfUrl = await pdfTabPromise;
    console.log("  PDF URL: " + pdfUrl);
    await downloadFile(pdfUrl, destPath);
    const meta = await readPdfMeta(destPath);
    console.log(`Saved: ${destPath} (${meta.fileSizeMB} MB, ${meta.pageCount} pages)`);
    if (!meta.valid) {
      console.error(`WARNING: File too small (${meta.fileSizeMB} MB) — may be incomplete!`);
    }
    return {
      files: [{ filename, pageCount: meta.pageCount, part: null }],
      title: finalTitle,
      originalContentUrl: null,
      totalTopics,
      totalTopicsDownloaded: totalTopics,
      verified: true,
    };
  }

  // ── Multi-batch path: deselect all, then select chapter by chapter ──────────
  console.log(`Total topics (${totalTopics}) > ${BATCH_LIMIT} — batching required`);

  // Reset to clean state (Select all was already clicked; now deselect)
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("button, span, a"));
    for (const el of els) {
      if (el.textContent.trim() === "Deselect all") { el.click(); return; }
    }
  });
  await new Promise(r => setTimeout(r, 600));
  const { selected: afterReset } = await getTopicCount(page);
  console.log(`After deselect all: ${afterReset} topics selected`);

  const results = [];
  let partNum = 1;
  let cbIndex = 0;           // current checkbox index
  let batchTopicsSum = 0;    // sum of topics selected in all batches
  let lastCheckedIndex = -1; // last checkbox successfully included in a batch

  while (cbIndex < totalCheckboxes) {
    console.log(`\n── Batch ${partNum} (starting from checkbox ${cbIndex}) ──`);

    const batchStart = cbIndex;
    let lastIncluded = -1;   // last checkbox index included in this batch

    // Select checkboxes one by one until we hit the limit
    while (cbIndex < totalCheckboxes) {
      await clickCheckboxWithPopup(page, cbIndex, "select");
      const { selected } = await getTopicCount(page);

      if (selected > BATCH_LIMIT) {
        // This checkbox pushed us over — deselect it and stop
        console.log(
          `  Checkbox ${cbIndex} exceeded limit (${selected} topics) — deselecting`
        );
        await clickCheckboxWithPopup(page, cbIndex, "deselect");
        break;
      }

      console.log(`  +checkbox ${cbIndex}: ${selected} topics selected`);
      lastIncluded = cbIndex;
      cbIndex++;
    }

    if (lastIncluded === -1) {
      console.error(`  ERROR: Could not include even one checkbox in batch ${partNum}. Stopping.`);
      break;
    }

    const { selected: finalSelected } = await getTopicCount(page);
    console.log(`  Batch ${partNum}: ${finalSelected} topics selected (checkboxes ${batchStart}–${lastIncluded})`);
    batchTopicsSum += finalSelected;

    // Read chapter labels for verification
    const batchChapters = await page.evaluate(() => {
      const checked = Array.from(document.querySelectorAll("input[type='checkbox']:checked"));
      return checked.map(cb => {
        const parent = cb.closest("li, div, label") || cb.parentElement;
        const labelEl = parent ? parent.querySelector("span, label, a") || parent : cb.parentElement;
        return labelEl ? labelEl.textContent.trim() : "";
      }).filter(Boolean);
    });

    const firstChapter = batchChapters[0] || "(unknown)";
    const lastChapter = batchChapters[batchChapters.length - 1] || "(unknown)";
    console.log(`  First chapter: "${firstChapter}"`);
    console.log(`  Last chapter:  "${lastChapter}"`);

    // Click Create PDF button
    const pdfTabPromise = waitForNewPdfTab(browser);
    await page.evaluate(() => {
      // Find the green "Create PDF" button specifically (not "Create Custom PDF")
      const btns = Array.from(document.querySelectorAll("button"));
      for (const btn of btns) {
        const t = btn.textContent.trim();
        if (t === "Create PDF") { btn.click(); return; }
      }
      // Fallback: any button containing "Create PDF"
      for (const btn of btns) {
        if (btn.textContent.trim().includes("Create PDF")) { btn.click(); return; }
      }
    });
    console.log("  Clicked Create PDF");

    await waitForPdfCreation(page);

    console.log("  Waiting for PDF tab...");
    const pdfUrl = await pdfTabPromise;
    console.log("  PDF URL: " + pdfUrl);

    // Determine filename
    const suffix = totalTopics > BATCH_LIMIT ? `_Part${partNum}` : "";
    const tempPath = join(outputDir, `__temp_part${partNum}.pdf`);
    await downloadFile(pdfUrl, tempPath);

    const meta = await readPdfMeta(tempPath);
    const pageTitle = await page.title();
    const titleFromPage = pageTitle.replace(/\s*\|.*$/, "").trim();
    const finalTitle = docTitle || titleFromPage || "SAP_Document";
    const originalUrl = null;
    const filename = safeFilename(finalTitle) + suffix + ".pdf";
    const destPath = join(outputDir, filename);

    const { renameSync } = await import("fs");
    renameSync(tempPath, destPath);

    console.log(`  Saved: ${destPath} (${meta.pageCount} pages)`);
    if (originalUrl && !docTitle) console.log(`  Original content URL: ${originalUrl}`);

    results.push({
      part: partNum,
      filename,
      pageCount: meta.pageCount,
      topicsSelected: finalSelected,
      firstChapter,
      lastChapter,
      originalContentUrl: originalUrl,
    });

    lastCheckedIndex = lastIncluded;
    partNum++;

    // If more batches needed, reset and continue
    if (cbIndex < totalCheckboxes) {
      console.log("\n  Resetting selection for next batch...");
      await resetSelection(page);
    }
  }

  // ── Verification ──────────────────────────────────────────────────────────

  console.log("\n══════════════════════════════════════════");
  console.log("VERIFICATION REPORT");
  console.log("══════════════════════════════════════════");
  console.log(`Total topics in document : ${totalTopics}`);
  console.log(`Total topics downloaded  : ${batchTopicsSum}`);

  const topicsMatch = totalTopics === batchTopicsSum;
  console.log(`Topic count match        : ${topicsMatch ? "✓ PASS" : "✗ FAIL"}`);

  if (results.length > 1) {
    console.log("\nBatch boundary check:");
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1];
      const curr = results[i];
      console.log(`  Part${i} last chapter : "${prev.lastChapter}"`);
      console.log(`  Part${i + 1} first chapter: "${curr.firstChapter}"`);
    }
  }

  console.log("\nFiles downloaded:");
  let totalPages = 0;
  for (const r of results) {
    console.log(`  ${r.filename} — ${r.pageCount} pages, ${r.topicsSelected} topics`);
    totalPages += r.pageCount;
  }
  console.log(`Total pages across all parts: ${totalPages}`);

  if (!topicsMatch) {
    console.error(
      `\nWARNING: Topic count mismatch! Expected ${totalTopics}, got ${batchTopicsSum}. Please verify manually.`
    );
  }

  const finalTitle = results[0]
    ? results[0].filename.replace(/_Part\d+\.pdf$/, "").replace(/.pdf$/, "")
    : "SAP_Document";
  const originalContentUrl = results.find(r => r.originalContentUrl)?.originalContentUrl || null;

  return {
    files: results.map(r => ({ filename: r.filename, pageCount: r.pageCount, part: r.part })),
    title: finalTitle,
    originalContentUrl,
    totalTopics,
    totalTopicsDownloaded: batchTopicsSum,
    verified: topicsMatch,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Connecting to Edge...");
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222" });

  const page = await browser.newPage();
  console.log("Opening: " + inputUrl);
  await page.goto(inputUrl, { waitUntil: "networkidle2", timeout: 30000 });

  const pageTitle = await page.title();
  console.log("Page title: " + pageTitle);

  // Click PDF button using the known selector #pdf-menu button
  console.log("Clicking PDF button...");
  await page.waitForSelector("#pdf-menu button", { timeout: 10000 });
  await page.click("#pdf-menu button");
  await new Promise(r => setTimeout(r, 1200));

  // Check which options are available inside #pdf-menu
  const menuOptions = await page.evaluate(() => {
    const menu = document.querySelector("#pdf-menu");
    if (!menu) return [];
    return Array.from(menu.querySelectorAll("a, button, li, span"))
      .map(el => el.textContent.trim())
      .filter(t => t.length > 0);
  });
  console.log("PDF menu options found:", menuOptions);

  const hasFullDoc = menuOptions.some(t => t.includes("Full Document"));
  const hasCustomPdf = menuOptions.some(
    t => t.includes("Create Custom PDF") || t.includes("Custom PDF")
  );

  console.log(`Options: Full Document=${hasFullDoc}, Custom PDF=${hasCustomPdf}`);

  let result;

  if (hasFullDoc) {
    // Start listening for new tab BEFORE clicking
    const pdfTabPromise = waitForNewPdfTab(browser);
    // Click Full Document using precise selector
    await page.click("#pdf-menu button.tile-button");
    console.log("Clicked Full Document, waiting for PDF tab...");
    result = await downloadFullDocument(page, browser, null, pdfTabPromise);
  } else if (hasCustomPdf) {
    // Use Puppeteer native click on the tile-button for Create Custom PDF
    await page.click("#pdf-menu button.tile-button");
    console.log("Clicked Create Custom PDF");
    result = await downloadCustomPdf(page, browser, null);
  } else {
    throw new Error("Neither 'Full Document' nor 'Create Custom PDF' option found in #pdf-menu. Options seen: " + menuOptions.join(", "));
  }

  // Update docs-registry.json
  const registryPath = join(
    resolve(process.argv[3] || "."),
    "..",
    "docs-registry.json"
  );
  updateRegistry(registryPath, {
    inputUrl,
    title: result.title,
    originalContentUrl: result.originalContentUrl,
    files: result.files,
  });

  console.log("\nAll done.");
  await browser.disconnect();
}

main().catch(err => {
  console.error("Error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
