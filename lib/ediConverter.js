/**
 * ediConverter.js
 *
 * Converts cXML to EDI (X12 or EDIFACT) by delegating to the SAP Help MCP
 * web layer (/chat_edi endpoint in app.py). The web layer runs a full
 * tool-call loop with get_sap_page, reading the complete EDI spec from
 * cache.json and converting segment-by-segment — identical to the web
 * chat interface.
 *
 * Returns: { segments: [{ segment, description }] }
 */

const http = require('http');

// SAP Help MCP web server address
const SAP_HELP_HOST = '127.0.0.1';
const SAP_HELP_PORT = 5001;
const SAP_HELP_PATH = '/chat_edi';

// Credentials — read from environment or fall back to default IK Convert proxy values
const API_KEY  = process.env.EDI_API_KEY  || '0399a7b7-c66d-4453-9803-b0e0ebe38b28';
const BASE_URL = process.env.EDI_BASE_URL || 'http://localhost:6655';

const SPEC_NAMES = {
  X12: {
    PO:      'SAP Business Network X12 PO850 4010 Outbound',
    OC:      'SAP Business Network X12 PR855 4010 Inbound',
    ASN:     'SAP Business Network X12 SH856 4010 Inbound',
    Invoice: 'SAP Business Network X12 IN810 4010 Inbound',
    GR:      'SAP Business Network X12 AG824 4010 Outbound',
  },
  EDIFACT: {
    PO:      'SAP Business Network EDIFACT ORDERS D96A Outbound',
    OC:      'SAP Business Network EDIFACT ORDRSP D96A Inbound',
    ASN:     'SAP Business Network EDIFACT DESADV D96A Inbound',
    Invoice: 'SAP Business Network EDIFACT INVOIC D96A Inbound',
    GR:      'SAP Business Network EDIFACT RECADV D96A Outbound',
  },
};

/**
 * Convert a single cXML document to EDI via the SAP Help MCP web layer.
 * @param {string} cxmlContent - Raw cXML string
 * @param {string} docType     - 'PO' | 'OC' | 'ASN' | 'Invoice' | 'GR'
 * @param {string} format      - 'X12' | 'EDIFACT'
 * @returns {Promise<{segments: Array<{segment: string, description: string}>}>}
 */
async function convertToEdi(cxmlContent, docType, format) {
  const specName = SPEC_NAMES[format]?.[docType];
  if (!specName) {
    throw new Error(`No EDI spec available for ${format} / ${docType}`);
  }

  const body = JSON.stringify({
    api_key:  API_KEY,
    base_url: BASE_URL,
    cxml:     cxmlContent,
    doc_type: docType,
    format,
  });

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: SAP_HELP_HOST,
        port:     SAP_HELP_PORT,
        path:     SAP_HELP_PATH,
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10 * 60 * 1000,  // 10 minutes — full tool-call loop can be slow
      },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(`SAP Help EDI conversion error: ${parsed.error}`));
            } else {
              resolve({ segments: parsed.segments || [] });
            }
          } catch (e) {
            reject(new Error(`Failed to parse /chat_edi response: ${e.message}\nRaw: ${data.slice(0, 500)}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('EDI conversion request timed out (10 min limit exceeded)'));
    });

    req.on('error', (err) => {
      // Provide a clear message if app.py is not running
      if (err.code === 'ECONNREFUSED') {
        reject(new Error(
          `Cannot connect to SAP Help MCP web server at ${SAP_HELP_HOST}:${SAP_HELP_PORT}. ` +
          `Please ensure app.py is running (cd ~/mcp-servers/sap-help/web-app && python3 app.py).`
        ));
      } else {
        reject(err);
      }
    });

    req.write(body);
    req.end();
  });
}

module.exports = { convertToEdi, SPEC_NAMES };
