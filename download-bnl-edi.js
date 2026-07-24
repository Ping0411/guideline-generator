import https from "https";
import http from "http";
import { createWriteStream, mkdirSync, existsSync } from "fs";
import { join } from "path";

const OUTPUT_DIR = join(process.env.HOME, "Downloads/BNL");

const PDF_URLS = [
  // How-To Guides
  "https://help.sap.com/doc/cfe1a7e4c08f40108921f0d03906a988/LBN/en-US/SAP_LBN_EDI_HowToGuide.pdf",
  "https://help.sap.com/doc/dc351ff34d4c479090fe596529920e48/LBN/en-US/SAP_LBN_ANSI_HowToGuide.pdf",
  // EDIFACT MIGs
  "https://help.sap.com/doc/709ed22386604b1d92b05f5af80f99ca/LBN/en-US/SAP_LBN_IFTMIN_D96A.pdf",
  "https://help.sap.com/doc/f350a11d62fd4706b20bca0e6ea0039b/LBN/en-US/SAP_LBN_IFTSTA_D01C.pdf",
  "https://help.sap.com/doc/message-implementation-guideline-invoic-d96a/LBN/en-US/SAP_LBN_INVOIC_D96A.pdf",
  "https://help.sap.com/doc/message-implementation-guideline-iftmbc-d96a/LBN/en-US/SAP_LBN_IFTMBC_D96A.pdf",
  // ANSI X12 MIGs
  "https://help.sap.com/doc/11af08411c5b4f5bb5337df022ad4847/LBN/en-US/SAP_LBN_ANSI_X12_204.pdf",
  "https://help.sap.com/doc/1c51c0c79d2244d7b2a861f38bdf44c0/LBN/en-US/SAP_LBN_ANSI_X12_990.pdf",
  "https://help.sap.com/doc/9894868a434742d086a2bf6baecd2809/LBN/en-US/SAP_LBN_ANSI_X12_214.pdf",
  "https://help.sap.com/doc/message-implementation-guideline-ansi-x12-210/LBN/en-US/SAP_LBN_ANSI_X12_210.pdf",
  "https://help.sap.com/doc/a3502fc761014eb7a19a98f9eac90b64/LBN/en-US/SAP_LBN_ANSI_X12_997.pdf",
  "https://help.sap.com/doc/message-implementation-guideline-ansi-x12-300/LBN/en-US/SAP_LBN_ANSI_X12_300.pdf",
  "https://help.sap.com/doc/message-implementation-guideline-ansi-x12-301/LBN/en-US/SAP_LBN_ANSI_X12_301.pdf",
  "https://help.sap.com/doc/message-implementation-guideline-ansi-x12-303-fc/LBN/en-US/SAP_LBN_ANSI_X12_303_FC.pdf",
  "https://help.sap.com/doc/message-implementation-guideline-ansi-x12-310-fc/LBN/en-US/SAP_LBN_ANSI_X12_310_FC.pdf",
  "https://help.sap.com/doc/message-implementation-guideline-ansi-x12-315-fc/LBN/en-US/SAP_LBN_ANSI_X12_315_FC.pdf",
  "https://help.sap.com/doc/message-implementation-guideline-ansi-x12-840-fc/LBN/en-US/SAP_LBN_ANSI_X12_840_FC.pdf",
  "https://help.sap.com/doc/message-implementation-guideline-ansi-x12-843-fc/LBN/en-US/SAP_LBN_ANSI_X12_843_FC.pdf",
  "https://help.sap.com/doc/message-implementation-guideline-ansi-x12-864-fc/LBN/en-US/SAP_LBN_ANSI_X12_864_FC.pdf",
];

function filenameFromUrl(url) {
  const decoded = decodeURIComponent(url);
  return decoded.split("/").pop();
}

function downloadFile(fileUrl, destPath) {
  return new Promise((resolve, reject) => {
    const proto = fileUrl.startsWith("https") ? https : http;
    const file = createWriteStream(destPath);
    proto.get(fileUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode} for ${fileUrl}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", err => {
      file.close();
      reject(err);
    });
  });
}

mkdirSync(OUTPUT_DIR, { recursive: true });

let success = 0;
let failed = 0;

for (const url of PDF_URLS) {
  const filename = filenameFromUrl(url);
  const destPath = join(OUTPUT_DIR, filename);
  if (existsSync(destPath)) {
    console.log(`SKIP (exists): ${filename}`);
    success++;
    continue;
  }
  process.stdout.write(`Downloading: ${filename} ... `);
  try {
    await downloadFile(url, destPath);
    console.log("OK");
    success++;
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
    failed++;
  }
}

console.log(`\nDone: ${success} OK, ${failed} failed`);
