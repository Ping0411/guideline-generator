import puppeteer from "puppeteer";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, "cache.json");

const SAP_SOURCES = [
  "https://help.sap.com/docs/business-network-for-logistics",
  "https://help.sap.com/docs/business-network-global-track-and-trace",
  "https://help.sap.com/docs/business-network-logistics-provider",
  "https://help.sap.com/docs/business-network-for-trading-partners/business-network-invoicing/sap-business-network-guide-to-invoicing",
  "https://help.sap.com/docs/business-network-for-procurement/business-network-buyer-administration/default-transaction-rules",
  "https://help.sap.com/docs/business-network-for-trading-partners/cxml-solutions/cxml-solutions-guide",
  "https://help.sap.com/docs/business-network-for-trading-partners/guided-integration-for-trading-partners-59ee04ae427245dfbb7d2766c14270b4/guided-integration-for-trading-partners",
  "https://help.sap.com/docs/sisgw/sap-ariba-cloud-integration-gateway-overview-guide/using-test-central-for-buyer-regression-testing",
  "https://help.sap.com/docs/sisgw/sap-ariba-cloud-integration-gateway-how-to-guide-for-suppliers/sap-ariba-cloud-integration-gateway-and-ariba-network-are-renamed-in-this-document",
  "https://help.sap.com/docs/business-network-for-trading-partners",
  "https://help.sap.com/docs/sisgw",
  "https://help.sap.com/docs/btp",
  "https://www.sap.com/products/business-network/suppliers/pricing.html"
];

async function fetchPage(browser, url) {
  const page = await browser.newPage();
  try {
    console.log("Fetching: " + url);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    const result = await page.evaluate(() => {
      const title = document.title;
      const selectors = ["main", "article", ".content", ".help-content", "#content", "body"];
      let content = "";
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) { content = el.innerText; break; }
      }
      return { title, content: content.replace(/\s+/g, " ").trim().slice(0, 20000) };
    });
    return { url, ...result, success: true, cachedAt: new Date().toISOString() };
  } catch (err) {
    console.log("Failed: " + url + " - " + err.message);
    return { url, title: "", content: "", success: false, cachedAt: new Date().toISOString() };
  } finally {
    await page.close();
  }
}

async function main() {
  console.log("Starting cache refresh...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const cache = {};
  for (const url of SAP_SOURCES) {
    cache[url] = await fetchPage(browser, url);
  }

  await browser.disconnect();
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  console.log("Cache saved to " + CACHE_FILE);
  console.log("Total pages cached: " + Object.keys(cache).length);
}

main().catch(console.error);
