import https from "https";
import http from "http";
import { createWriteStream, mkdirSync, existsSync } from "fs";
import { join } from "path";

const OUTPUT_DIR = join(process.env.HOME, "Downloads/SBN");

const PDF_URLS = [
  "https://help.sap.com/doc/sap-business-network-edifact-delfor-order-based-d96a-outbound/cloud/en-US/SAP%20Business%20Network%20EDIFACT%20DELFOR%20Order%20based%20D96A%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-edifact-delfor-productactivity-based-d96a-outbound/cloud/en-US/SAP%20Business%20Network%20EDIFACT%20DELFOR%20ProductActivity%20based%20D96A%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-edifact-deljit-d96a-order-based-outbound/cloud/en-US/SAP%20Business%20Network%20EDIFACT%20DELJIT%20D96A%20Order%20based%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-edifact-desadv-d96a-inbound/cloud/en-US/SAP%20Business%20Network%20EDIFACT%20DESADV%20D96A%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-edifact-iftmin-d96a-outbound/cloud/en-US/SAP%20Business%20Network%20EDIFACT%20IFTMIN%20D96A%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-edifact-iftsta-d96a-inbound/cloud/en-US/SAP%20Business%20Network%20EDIFACT%20IFTSTA%20D96A%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-edifact-invoic-d96a-inbound/cloud/en-US/SAP%20Business%20Network%20EDIFACT%20INVOIC%20D96A%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-edifact-ordchg-d96a-outbound/cloud/en-US/SAP_EDIFACT%20ORDCHG_D96A%20Out.pdf",
  "https://help.sap.com/doc/sap-business-network-edifact-orders-d96a-outbound/cloud/en-US/SAP_EDIFACT%20ORDERS_D96A%20Out.pdf",
  "https://help.sap.com/doc/sap-business-network-edifact-ordrsp-d96a-inbound/cloud/en-US/SAP%20Business%20Network%20EDIFACT%20ORDRSP%20D96A%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-edifact-recadv-d96a-outbound/cloud/en-US/SAP%20Business%20Network%20EDIFACT%20RECADV%20D96A%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-edifact-remadv-d96a-outbound/cloud/en-US/SAP%20Business%20Network%20EDIFACT%20REMADV%20D96A%20Outbound.pdf",
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
