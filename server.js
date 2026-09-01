const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const http = require('http');

const { parseTransactionRules } = require('./lib/rulesParser');
const { parseCountryRules } = require('./lib/countryRulesParser');
const { evaluateRules } = require('./lib/descriptionEngine');
const { convertToEdi, SPEC_NAMES } = require('./lib/ediConverter');
const { buildCxmlRows } = require('./lib/cxmlFormatter');
const { generateExcel } = require('./lib/excelGenerator');

const app = express();
const PORT = 5002;

// SAP Help MCP address (same as ediConverter uses)
const SAP_HELP_HOST = '127.0.0.1';
const SAP_HELP_PORT = 5001;

// In-memory store for pending Excel generation requests (token → data, 10min TTL)
const pendingGenerations = {};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// File upload — store in temp dir
const upload = multer({ dest: os.tmpdir() });

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * POST /api/evaluate-rules
 * Receives: cXML files + Transaction Rules Excel + Q1-Q13 answers
 * Returns: evaluation result (description triggers + project req triggers per doc type)
 */
app.post('/api/evaluate-rules',
  upload.fields([
    { name: 'cxmlFiles', maxCount: 10 },
    { name: 'rulesFile', maxCount: 1 },
    { name: 'countryRulesFile', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const answers = JSON.parse(req.body.answers || '{}');
      const rulesFile = req.files?.rulesFile?.[0];
      const cxmlFiles = req.files?.cxmlFiles || [];
      const countryRulesFileObj = req.files?.countryRulesFile?.[0] || null;

      if (!rulesFile) {
        return res.status(400).json({ error: 'Transaction Rules file is required.' });
      }

      // Parse transaction rules
      const parsedRules = await parseTransactionRules(rulesFile.path);

      // Parse country/region rules if provided (Q14=Yes)
      let countryParsedRules = null;
      if (answers.q14 === 'Yes' && countryRulesFileObj) {
        countryParsedRules = await parseCountryRules(countryRulesFileObj.path, countryRulesFileObj.originalname);
      }

      // Determine in-scope doc types
      const required = answers.q2 || [];
      const optional = (answers.q3 || []).filter(v => v !== 'None');
      const inScope = [...new Set([...required, ...optional])];

      const results = {};
      // cxmlFileList: flat array of all processed files with content, for Excel generation
      const cxmlFileList = [];

      // Parse all files and evaluate rules first (fast, no API calls)
      const fileEntries = [];
      for (const cxmlFileObj of cxmlFiles) {
        const cxmlContent = fs.readFileSync(cxmlFileObj.path, 'utf8');
        const originalName = cxmlFileObj.originalname || '';

        const docType = detectDocType(originalName, cxmlContent, inScope);
        if (!docType) continue;

        const activeRules = (docType === 'Invoice' && countryParsedRules)
          ? countryParsedRules
          : parsedRules;

        const evaluation = await evaluateRules(docType, activeRules, cxmlContent, answers);
        fileEntries.push({ fileName: originalName, docType, content: cxmlContent, evaluation });
      }

      // EDI conversions run in parallel (each calls /chat_edi independently)
      if (answers.q13 === 'Yes' && answers.q13format) {
        await Promise.all(fileEntries.map(async (entry) => {
          try {
            // Build annotated cXML: inject <!-- B: description --> comments for lines that have descriptions
            const cxmlRows = buildCxmlRows(entry.content, entry.evaluation?.descriptionTriggers || []);
            const annotatedCxml = cxmlRows.map(({ aText, bText }) =>
              bText ? `${aText}  <!-- B: ${bText.replace(/-->/g, '- ->')} -->` : aText
            ).join('\n');
            entry.edi = await convertToEdi(annotatedCxml, entry.docType, answers.q13format);
          } catch (ediErr) {
            console.error(`EDI conversion failed for ${entry.docType}:`, ediErr.message);
            entry.edi = { error: ediErr.message };
          }
        }));
      }

      // Assemble results
      for (const entry of fileEntries) {
        const fileEntry = {
          fileName: entry.fileName,
          docType:  entry.docType,
          content:  entry.content,
          ...entry.evaluation,
          edi: entry.edi || null,
        };
        if (!results[entry.docType]) results[entry.docType] = [];
        results[entry.docType].push(fileEntry);
        cxmlFileList.push(fileEntry);
      }

      // Cleanup temp files
      const tempFiles = [...cxmlFiles, rulesFile];
      if (countryRulesFileObj) tempFiles.push(countryRulesFileObj);
      tempFiles.forEach(f => {
        try { fs.unlinkSync(f.path); } catch (_) {}
      });

      // Flatten results for frontend display (first entry per docType for summary)
      const resultsSummary = {};
      for (const [dt, entries] of Object.entries(results)) {
        resultsSummary[dt] = entries[0];
      }

      // Store full data in session-like temp for /api/generate
      // (simple in-memory, keyed by a token — suitable for single-user tool)
      const token = Date.now().toString(36);
      pendingGenerations[token] = {
        answers,
        evalResults: resultsSummary,
        cxmlFileList,
        ediFormat: answers.q13 === 'Yes' ? answers.q13format : null,
        expiresAt: Date.now() + 10 * 60 * 1000,  // 10 minutes
      };

      res.json({ success: true, inScope, results: resultsSummary, generateToken: token });

    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * Detect doc type from filename or cXML content.
 */
/**
 * Detect doc type by parsing the cXML Request element.
 * The cXML spec defines exactly one Request child per document —
 * we use that child element name as the canonical type indicator.
 */
function detectDocType(filename, content, inScope) {
  // Primary: parse the cXML Request child element (unambiguous)
  const requestMatch = content.match(/<Request[^>]*>\s*<(\w+)/);
  if (requestMatch) {
    const requestElement = requestMatch[1];
    const elementToType = {
      'OrderRequest':         () => resolvePOType(content),
      'ConfirmationRequest':  () => 'OC',
      'ShipNoticeRequest':    () => 'ASN',
      'InvoiceDetailRequest': () => 'Invoice',
      'ReceiptRequest':       () => 'GR',
    };
    const resolver = elementToType[requestElement];
    if (resolver) {
      const type = resolver();
      const resolvedType = type === 'PO_CHANGE' ? 'PO_CHANGE' : type;
      const scopeType = resolvedType === 'PO_CHANGE' ? 'PO' : resolvedType;
      if (inScope.includes(scopeType)) return resolvedType;
    }
  }

  return null;
}

/**
 * Distinguish PO (new) from PO_CHANGE (update) based on OrderRequest operation attribute.
 */
function resolvePOType(content) {
  const match = content.match(/OrderRequest[^>]*\soperation\s*=\s*["'](\w+)["']/i)
    || content.match(/operation\s*=\s*["'](\w+)["'][^>]*OrderRequest/i);
  if (match && match[1].toLowerCase() === 'update') return 'PO_CHANGE';
  return 'PO';
}

// Clean up expired pendingGenerations entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const token of Object.keys(pendingGenerations)) {
    if (pendingGenerations[token].expiresAt < now) {
      delete pendingGenerations[token];
    }
  }
}, 5 * 60 * 1000);

/**
 * GET /api/generate?token=xxx
 * Generates and downloads the Excel file for a previously evaluated result.
 */
app.get('/api/generate', async (req, res) => {
  const token = req.query.token;
  const pending = pendingGenerations[token];
  if (!pending) {
    return res.status(404).json({ error: 'Generation token not found or expired.' });
  }

  try {
    const { answers, evalResults, cxmlFileList, ediFormat } = pending;
    const buffer = await generateExcel(answers, evalResults, cxmlFileList, ediFormat);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Integration_Guideline.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error('Excel generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/edi_verify?token=xxx
 * Runs strict EDI verification on all EDI-containing sheets for the given token.
 * Calls /chat_edi_check on app.py for each doc type that has EDI segments.
 * Returns: { verified: [{ docType, fileName, issueCount, issues, corrected }] }
 * Also stores corrected segments back into pendingGenerations for later Excel rebuild.
 */
app.post('/api/edi_verify', async (req, res) => {
  const token = req.query.token;
  const pending = pendingGenerations[token];
  if (!pending) {
    return res.status(404).json({ error: 'Token not found or expired.' });
  }

  const { cxmlFileList, ediFormat, answers } = pending;
  const apiKey  = process.env.EDI_API_KEY  || '0399a7b7-c66d-4453-9803-b0e0ebe38b28';
  const baseUrl = (process.env.EDI_BASE_URL || 'http://localhost:6655').replace(/\/$/, '');

  // Files that actually have EDI segments
  const ediFiles = cxmlFileList.filter(f => f.edi && Array.isArray(f.edi.segments) && f.edi.segments.length > 0);
  if (!ediFiles.length) {
    return res.json({ verified: [], message: 'No EDI segments found to verify.' });
  }

  const verified = [];

  for (const fileObj of ediFiles) {
    const docType = fileObj.docType === 'PO_CHANGE' ? 'PO' : fileObj.docType;
    const body = JSON.stringify({
      api_key:  apiKey,
      base_url: baseUrl,
      segments: fileObj.edi.segments,
      doc_type: docType,
      format:   ediFormat || 'X12',
    });

    try {
      const checkResult = await new Promise((resolve, reject) => {
        const req2 = http.request(
          { hostname: SAP_HELP_HOST, port: SAP_HELP_PORT, path: '/chat_edi_check',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: 10 * 60 * 1000 },
          (res2) => {
            let data = '';
            res2.on('data', chunk => { data += chunk; });
            res2.on('end', () => {
              try { resolve(JSON.parse(data)); }
              catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
            });
          }
        );
        req2.on('timeout', () => { req2.destroy(); reject(new Error('EDI check timed out')); });
        req2.on('error', reject);
        req2.write(body);
        req2.end();
      });

      // Store corrected segments back so /api/edi_verified_excel can use them
      fileObj.edi_corrected        = checkResult.corrected || fileObj.edi.segments;
      fileObj.edi_corrected_failed = checkResult.corrected_failed || false;
      fileObj.edi_check_issues     = checkResult.issues || [];

      verified.push({
        docType:          fileObj.docType,
        fileName:         fileObj.fileName,
        issueCount:       checkResult.issue_count || 0,
        issues:           checkResult.issues || [],
        summary:          checkResult.check_summary || '',
        corrected_failed: checkResult.corrected_failed || false,
      });

    } catch (err) {
      verified.push({
        docType:  fileObj.docType,
        fileName: fileObj.fileName,
        error:    err.message,
      });
    }
  }

  // Extend token TTL so user has time to download after verification
  pending.expiresAt = Date.now() + 10 * 60 * 1000;

  res.json({ verified });
});

/**
 * POST /api/edi_retry_correct?token=xxx
 * For files where corrected_failed=true: sends confirmed issues back to AI
 * to obtain only the corrections JSON, then stores results.
 */
app.post('/api/edi_retry_correct', async (req, res) => {
  const token = req.query.token;
  const pending = pendingGenerations[token];
  if (!pending) {
    return res.status(404).json({ error: 'Token not found or expired.' });
  }

  const { cxmlFileList, ediFormat } = pending;
  const apiKey  = process.env.EDI_API_KEY  || '0399a7b7-c66d-4453-9803-b0e0ebe38b28';
  const baseUrl = (process.env.EDI_BASE_URL || 'http://localhost:6655').replace(/\/$/, '');

  const failedFiles = cxmlFileList.filter(f => f.edi_corrected_failed && f.edi_check_issues?.length > 0);
  if (!failedFiles.length) {
    return res.json({ retried: [], message: 'No files need retry.' });
  }

  const retried = [];

  for (const fileObj of failedFiles) {
    const docType = fileObj.docType === 'PO_CHANGE' ? 'PO' : fileObj.docType;
    const body = JSON.stringify({
      api_key:  apiKey,
      base_url: baseUrl,
      segments: fileObj.edi.segments,
      issues:   fileObj.edi_check_issues,
      doc_type: docType,
      format:   ediFormat || 'X12',
    });

    try {
      const result = await new Promise((resolve, reject) => {
        const req2 = http.request(
          { hostname: SAP_HELP_HOST, port: SAP_HELP_PORT, path: '/chat_edi_correct',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: 5 * 60 * 1000 },
          (res2) => {
            let data = '';
            res2.on('data', chunk => { data += chunk; });
            res2.on('end', () => {
              try { resolve(JSON.parse(data)); }
              catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
            });
          }
        );
        req2.on('timeout', () => { req2.destroy(); reject(new Error('Retry timed out')); });
        req2.on('error', reject);
        req2.write(body);
        req2.end();
      });

      fileObj.edi_corrected        = result.corrected || fileObj.edi.segments;
      fileObj.edi_corrected_failed = result.corrected_failed || false;

      retried.push({
        docType:          fileObj.docType,
        fileName:         fileObj.fileName,
        corrected_failed: result.corrected_failed || false,
      });

    } catch (err) {
      retried.push({ docType: fileObj.docType, fileName: fileObj.fileName, error: err.message });
    }
  }

  pending.expiresAt = Date.now() + 10 * 60 * 1000;
  res.json({ retried });
});


/**
 * GET /api/edi_verified_excel?token=xxx
 * Generates the corrected Excel using the same structure as the original,
 * but with EDI segments replaced by the verified/corrected versions.
 * All other content (README, Project Requirements, cXML, Extrinsics) is unchanged.
 */
app.get('/api/edi_verified_excel', async (req, res) => {
  const token = req.query.token;
  const pending = pendingGenerations[token];
  if (!pending) {
    return res.status(404).json({ error: 'Token not found or expired.' });
  }

  try {
    const { answers, evalResults, cxmlFileList, ediFormat } = pending;

    // Build a modified cxmlFileList where EDI segments are replaced with corrected versions
    const correctedFileList = cxmlFileList.map(fileObj => {
      if (fileObj.edi_corrected) {
        return { ...fileObj, edi: { segments: fileObj.edi_corrected } };
      }
      return fileObj;
    });

    // generateExcel uses the same template, layout, fonts — only EDI data differs
    const buffer = await generateExcel(answers, evalResults, correctedFileList, ediFormat);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Integration_Guideline_Verified.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error('Verified Excel generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Guideline Generator running at http://localhost:${PORT}`);
});

// EDI conversion via Anthropic can take several minutes for multiple files
server.timeout = 10 * 60 * 1000;       // 10 minutes total request timeout
server.keepAliveTimeout = 10 * 60 * 1000;

server.timeout = 10 * 60 * 1000;       // 10 minutes total request timeout
server.keepAliveTimeout = 10 * 60 * 1000;
