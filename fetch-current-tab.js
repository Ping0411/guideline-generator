import puppeteer from "puppeteer";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, "cache.json");

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222" });

  const pages = await browser.pages();
  const activePage = pages[pages.length - 1];
  const url = activePage.url();

  console.log("Capturing: " + url);

  const result = await activePage.evaluate(() => {
    const title = document.title;
    const selectors = ["main", "article", ".content", ".help-content", "#content", "body"];
    let content = "";
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) { content = el.innerText; break; }
    }
    return { title, content: content.replace(/\s+/g, " ").trim().slice(0, 50000) };
  });

  console.log("Title: " + result.title);
  console.log("Content length: " + result.content.length);

  const cache = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  cache[url] = { url, ...result, success: true, cachedAt: new Date().toISOString() };
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));

  console.log("Saved to cache: " + url);

  await browser.disconnect();
}

main().catch(console.error);
