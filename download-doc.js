/**
 * download-doc.js
 * Downloads a SAP Help Portal document as PDF.
 *
 * Usage:
 *   node download-doc.js <url> <output-dir>
 *
 * Example:
 *   node download-doc.js "https://help.sap.com/docs/business-network-for-trading-partners/edi-configuration/edi-configuration-guide" ~/Downloads/SAP-docs
 *
 * Requires Edge running with remote debugging:
 *   "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" --remote-debugging-port=9222 --user-data-dir=/tmp/edge-debug --no-first-run &
 */

import puppeteer from "puppeteer";
import { mkdirSync, existsSync, writeFileSync } from "fs";
import { join, resolve, basename } from "path";
import { createWriteStream } from "fs";
import https from "https";
import http from "http";

const url = process.argv[2];
const outputDir = resolve(process.argv[3] || ".");

if (!url) {
  console.error("Usage: node download-doc.js <url> <output-dir>");
  process.exit(1);
}

if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

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

async function waitForNewPdfTab(browser, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for PDF tab")), timeoutMs);
    browser.on("targetcreated", async target => {
      const targetUrl = target.url();
      console.log("New tab detected: " + targetUrl);
      if (targetUrl.includes(".pdf") || targetUrl.includes("pdf") || targetUrl.includes("GetFile")) {
        clearTimeout(timer);
        resolve(targetUrl);
      }
    });
  });
}

async function findAndClickText(page, texts) {
  const items = await page.$$("a, button, li, span");
  for (const item of items) {
    const text = await item.evaluate(el => el.textContent.trim()).catch(() => "");
    for (const t of texts) {
      if (text === t || text.includes(t)) {
        return item;
      }
    }
  }
  return null;
}

async function main() {
  console.log("Connecting to Edge...");
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222" });

  const page = await browser.newPage();

  console.log("Opening: " + url);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

  const title = await page.title();
  console.log("Page title: " + title);

  // Start listening for new tab BEFORE clicking
  const pdfTabPromise = waitForNewPdfTab(browser);

  // Click PDF button
  console.log("Looking for PDF button...");
  const pdfBtn = await findAndClickText(page, ["PDF"]);
  if (!pdfBtn) throw new Error("Could not find PDF button");
  await pdfBtn.click();
  console.log("Clicked PDF button");

  await new Promise(r => setTimeout(r, 1500));

  // Try Full Document first
  console.log("Looking for Full Document option...");
  const fullDocBtn = await findAndClickText(page, ["Full Document"]);

  if (fullDocBtn) {
    console.log("Clicking Full Document...");
    await fullDocBtn.click();
  } else {
    // Fall back to Create Custom PDF
    console.log("Full Document not available, trying Create Custom PDF...");
    const customPdfBtn = await findAndClickText(page, ["Create Custom PDF", "Custom PDF"]);
    if (!customPdfBtn) throw new Error("Neither Full Document nor Create Custom PDF found");

    await customPdfBtn.click();
    console.log("Opened Custom PDF dialog");
    await new Promise(r => setTimeout(r, 1500));

    // Read topic count
    const countText = await page.evaluate(() => {
      for (const el of document.querySelectorAll("*")) {
        if (el.children.length === 0 && el.textContent.match(/\d+ topics? selected/)) {
          return el.textContent.trim();
        }
      }
      return null;
    });
    console.log("Topic count: " + (countText || "unknown"));

    const match = countText && countText.match(/(\d+) topics? selected \((\d+) maximum\)/);
    const selected = match ? parseInt(match[1]) : null;
    const maximum = match ? parseInt(match[2]) : 200;

    if (selected && selected > maximum) {
      console.log(`WARNING: ${selected} topics exceed ${maximum} limit — manual batch download required`);
      await browser.disconnect();
      return;
    }

    // Click Create PDF
    const createBtn = await findAndClickText(page, ["Create PDF"]);
    if (!createBtn) throw new Error("Could not find Create PDF button");
    await createBtn.click();
    console.log("Clicked Create PDF");
  }

  // Wait for PDF tab to open
  console.log("Waiting for PDF to open in new tab...");
  const pdfUrl = await pdfTabPromise;
  console.log("PDF URL: " + pdfUrl);

  // Derive filename from title or URL
  const safeName = title.replace(/[^a-zA-Z0-9_\- ]/g, "_").trim().slice(0, 80);
  const destPath = join(outputDir, safeName + ".pdf");

  console.log("Downloading to: " + destPath);
  await downloadFile(pdfUrl, destPath);
  console.log("Done: " + destPath);

  await browser.disconnect();
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
