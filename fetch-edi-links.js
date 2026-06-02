import puppeteer from "puppeteer";

const browser = await puppeteer.connect({ browserURL: "http://localhost:9222" });
const page = await browser.newPage();
const TARGET_URL = process.argv[2] || "https://help.sap.com/docs/ANSIX12_4010";
await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));

const links = await page.evaluate(() =>
  Array.from(document.querySelectorAll("a[href]"))
    .map(a => a.href)
    .filter(h => h.includes("help.sap.com/doc"))
);

console.log(JSON.stringify([...new Set(links)], null, 2));
await browser.disconnect();
