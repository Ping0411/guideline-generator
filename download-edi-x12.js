import https from "https";
import http from "http";
import { createWriteStream, mkdirSync, existsSync } from "fs";
import { join } from "path";

const OUTPUT_DIR = join(process.env.HOME, "Downloads/SBN");

const PDF_URLS = [
  "https://help.sap.com/doc/sap-business-network-x12-ag824-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20AG824%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-ag824-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20AG824%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-ar943-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20AR943%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-ar943-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20AR943%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-aw947-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20AW947%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-ca865-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20CA865%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-fa997-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20FA997%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-fa997-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20FA997%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-ib846-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20IB846%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-ib846-consignment-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20IB846%20Consignment%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-ib846-mo-po-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20IB846%20MO%20PO%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-ib846-smi-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20IB846%20SMI%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-in810-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20IN810%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-nc842-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20NC842%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-nc842-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20NC842%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-ow940-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20OW940%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-pc860-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20PC860%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-po850-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20PO850%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-po850-salesorder-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20PO850%20Salesorder%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-pr855-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20PR855%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-ps830-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20PS830%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-ps830-order-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20PS830%20Order%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-ps830-productactivity-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20PS830%20ProductActivity%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-qm214-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20QM214%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-ra820-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20RA820%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-rc861-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20RC861%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-rc861-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20RC861%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-re944-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20RE944%204010%20Inbound.pdf",
  "https://help.sap.com/doc/730b1a57288a41fbbb48ddf025e99949/cloud/en-US/SAP%20Business%20Network%20X12%20RE944%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-rt863-qualityinspectiondecision-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20RT863%20QualityInspectionDecision%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-rt863-qualityinspectionrequest-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20RT863%20QualityInspectionRequest%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-rt863-qualityinspectionresult-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20RT863%20QualityInspectionResult%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-sc832-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20SC832%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-sh856-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20SH856%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-sh856-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20SH856%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-sm204-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20SM204%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-sm204-multi-consignment-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20SM204%20Multi-Consignment%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-sq866-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20SQ866%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-ss862-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20SS862%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-sw945-4010-inbound/cloud/en-US/SAP%20Business%20Network%20X12%20SW945%204010%20Inbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-sw945-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20SW945%204010%20Outbound.pdf",
  "https://help.sap.com/doc/sap-business-network-x12-tx864-4010-outbound/cloud/en-US/SAP%20Business%20Network%20X12%20TX864%204010%20Outbound.pdf",
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
