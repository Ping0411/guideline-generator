/**
 * inspect-pdf-dialog.js
 * Opens a SAP Help doc, clicks Create Custom PDF, and dumps the DOM structure
 * of the topic list so we can understand how to automate batch selection.
 *
 * Usage:
 *   node inspect-pdf-dialog.js <url>
 */

import puppeteer from "puppeteer";

const url = process.argv[2];
if (!url) {
  console.error("Usage: node inspect-pdf-dialog.js <url>");
  process.exit(1);
}

async function findAndClickText(page, texts) {
  const items = await page.$$("a, button, li, span");
  for (const item of items) {
    const text = await item.evaluate(el => el.textContent.trim()).catch(() => "");
    for (const t of texts) {
      if (text === t || text.includes(t)) return item;
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
  console.log("Title: " + await page.title());

  // Click PDF button
  const pdfBtn = await findAndClickText(page, ["PDF"]);
  if (!pdfBtn) throw new Error("No PDF button found");
  await pdfBtn.click();
  await new Promise(r => setTimeout(r, 1500));

  // Click Create Custom PDF
  const customBtn = await findAndClickText(page, ["Create Custom PDF", "Custom PDF"]);
  if (!customBtn) throw new Error("No Create Custom PDF button found");
  await customBtn.click();
  console.log("Opened Custom PDF dialog");
  await new Promise(r => setTimeout(r, 2000));

  // Click Select All
  const selectAllBtn = await findAndClickText(page, ["Select all", "Select All"]);
  if (selectAllBtn) {
    await selectAllBtn.click();
    console.log("Clicked Select All");
    await new Promise(r => setTimeout(r, 1000));
  }

  // Dump topic list structure
  const result = await page.evaluate(() => {
    // Find the count text
    const countEl = Array.from(document.querySelectorAll("*")).find(
      el => el.children.length === 0 && el.textContent.match(/\d+ topics? selected/)
    );
    const countText = countEl ? countEl.textContent.trim() : "not found";

    // Find all checkboxes and their labels
    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    const topics = checkboxes.map(cb => {
      const label = cb.closest("li, label, div")?.textContent?.trim().slice(0, 80) || "";
      const checked = cb.checked;
      const id = cb.id || cb.name || cb.getAttribute("data-id") || "";
      return { id, label, checked };
    });

    // Also dump the container HTML for deeper inspection
    const container = document.querySelector('[class*="toc"], [class*="topic-list"], [class*="pdf-dialog"], [class*="custom-pdf"]');
    const containerHtml = container ? container.outerHTML.slice(0, 3000) : "container not found";

    return { countText, topics, containerHtml };
  });

  console.log("\n=== Count ===");
  console.log(result.countText);

  console.log("\n=== Topics (" + result.topics.length + " checkboxes) ===");
  result.topics.forEach((t, i) => {
    console.log(`[${i}] ${t.checked ? "✓" : " "} id="${t.id}" | ${t.label}`);
  });

  console.log("\n=== Container HTML (first 3000 chars) ===");
  console.log(result.containerHtml);

  await browser.disconnect();
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
