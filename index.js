import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync, appendFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { spawn } from "child_process";
import { getDocumentKey } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE    = join(__dirname, "cache.json");
const TAGS_FILE     = join(__dirname, "tags.json");
const MISSES_LOG    = join(__dirname, "search_misses.log");
const CHAPTER_MAP   = join(__dirname, "chapter-map.md");

const chapterMapContent = existsSync(CHAPTER_MAP)
  ? readFileSync(CHAPTER_MAP, "utf-8").trim()
  : "Known document URL patterns and chapter distribution: (chapter-map.md not found)";

let _cache = null;
let _tags = null;

function loadCache() {
  if (_cache) return _cache;
  if (!existsSync(CACHE_FILE)) return {};
  try {
    _cache = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
    return _cache;
  } catch (e) {
    return {};
  }
}

function loadTags() {
  if (_tags) return _tags;
  if (!existsSync(TAGS_FILE)) return {};
  try {
    _tags = JSON.parse(readFileSync(TAGS_FILE, "utf-8"));
    return _tags;
  } catch (e) {
    return {};
  }
}


// ── Semantic search service ──────────────────────────────────────────────────
const SEMANTIC_PORT = 7655;
const SEMANTIC_URL = `http://127.0.0.1:${SEMANTIC_PORT}/search`;
let _semanticReady = false;
let _semanticProcess = null;

function ensureSemanticService() {
  if (_semanticReady) return;
  const script = join(__dirname, "semantic_search.py");
  if (!existsSync(script)) return;
  _semanticProcess = spawn("python3", [script, "--serve", "--port", String(SEMANTIC_PORT)], {
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  _semanticProcess.stdout.on("data", (data) => {
    if (data.toString().includes("ready")) _semanticReady = true;
  });
  _semanticProcess.on("exit", () => { _semanticReady = false; _semanticProcess = null; });
}

async function searchSemantic(query, scope) {
  try {
    const body = JSON.stringify({ query, n: 5, scope: scope || null });
    const res = await fetch(SEMANTIC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Start service in background at MCP startup
ensureSemanticService();
// ─────────────────────────────────────────────────────────────────────────────

function logMiss(query) {
  const line = `${new Date().toISOString()} | "${query}" | 0 results\n`;
  try {
    appendFileSync(MISSES_LOG, line, "utf-8");
  } catch (e) {}
}

const SCOPE_PREFIXES = {
  SBN: ["file://SBN/"],
  BNL: ["file://api-specs/"],
};

function matchesScope(url, scope) {
  if (!scope) return true;
  const prefixes = SCOPE_PREFIXES[scope.toUpperCase()];
  if (!prefixes) return true;
  return prefixes.some(p => url.startsWith(p));
}

function searchCache(query, scope) {
  const cache = loadCache();
  const tags = loadTags();
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const results = [];

  // Build a set of doc keys that match via tags (tag bonus)
  const tagMatchedDocs = new Set();
  for (const [docKey, docInfo] of Object.entries(tags)) {
    const tagHits = keywords.filter(k => docInfo.tags.some(t => t.includes(k)));
    if (tagHits.length > 0) tagMatchedDocs.add(docKey);
  }

  for (const [url, page] of Object.entries(cache)) {
    if (!page.success) continue;
    if (!matchesScope(url, scope)) continue;
    const text = page.content.toLowerCase();
    const title = page.title.toLowerCase();

    // Find best matching position: prefer exact phrase, fall back to first keyword hit
    let matchIdx = text.indexOf(query.toLowerCase());
    if (matchIdx === -1) {
      matchIdx = keywords.map(k => text.indexOf(k)).find(i => i !== -1) ?? -1;
    }

    const contentHits = keywords.filter(k => text.includes(k) || title.includes(k)).length;

    // Tag bonus: if this doc's key matched via tags, add extra weight
    const docKey = getDocumentKey(url);
    const tagBonus = tagMatchedDocs.has(docKey) ? keywords.length * 0.5 : 0;
    const hitCount = contentHits + tagBonus;

    if (hitCount === 0) continue;

    // Extract excerpt centered around the best match position
    const start = matchIdx > -1 ? Math.max(0, matchIdx - 200) : 0;
    const excerpt = page.content.slice(start, start + 1200);

    results.push({ url, title: page.title, excerpt, hitCount, cachedAt: page.cachedAt });
  }

  // Sort by number of keyword hits (most relevant first)
  results.sort((a, b) => b.hitCount - a.hitCount);
  return results.slice(0, 5);
}

const server = new McpServer({
  name: "sap-help",
  version: "2.0.0",
  instructions: `
## Response Language
Before composing any response, identify the dominant language of the user's question. SAP technical terms (cXML, ASN, PO, Test Central, etc.) are neutral and do not count toward either language.
- Respond in whatever language the user's question is primarily written in — Chinese, English, Japanese, or any other language.
- If mixed, follow the dominant language.
The language of files, logs, or debug output being analyzed does NOT affect the response language.
Apply this to all output: the answer body, source attribution, in-process notes, and any other text.

## When to Search vs Answer from Knowledge
Before answering, split the question into scene (who, what system, what happened) and actual ask (what the user truly wants to know). The actual ask determines the question type.

1. Pure concept / background knowledge question (e.g. "what is a Transaction Rule", "what is the relationship between CIG and SBN") — Answer from own knowledge first. End with "要不要我帮你进一步查一下详细资料？" and wait for confirmation.
   Warning: High confidence is a risk signal, not a bypass. If the answer involves denying or correcting the user's stated premise (e.g. "supplier can't do X"), stop — search first. Similarly, if the answer would be a specific list, enumeration, or resource (e.g. "which CAs are trusted", "what are the supported countries"), do not answer from knowledge — search first.

2. Any question involving specific product behavior, feature operations, fields, configuration, or process steps — Use the MCP directly without answering from knowledge first. This includes: cXML field names, config paths, UI labels, version-sensitive details, and specific product feature operation flows. All Test Central questions always fall into this category.

3. No direct knowledge of the topic — Search directly. Do not infer from "similar logic". Note at the top: "我对这个没有直接知识，以下来自文档检索".

4. User explicitly asks to check official docs — Search immediately.

## How to Search

Core loop: Understand question → identify document and question type → choose path → get_sap_page to read content → extract answer.

Tool responsibilities:
- search_sap_docs: keyword search, returns slice URLs + excerpts. Purpose: locate — find which document/slice contains the answer when the document is unknown.
- get_sap_page: reads the full content of a specific slice URL. Purpose: read — extract the answer from the content.

${chapterMapContent}
Step 1 — Understand the actual ask: identify what the user truly wants to know (not the background scene).

Step 1.5 — Determine topic scope: identify which product area the question belongs to, then narrow to the document category.
- SBN (Invoice/PO/OC/ASN/cXML/Transaction Rules/Test Central/supplier or buyer config) → see document list above
- BNL (carrier/freight/freight order/logistics invoice/track and trace) → BNL-specific documents
- SCC (supplier integration for PO Collaboration) → SCC-specific documents
Once scope and topic are identified, you can often determine the target document directly.

Step 2 — Choose path based on document knowledge:
- Document is known and you are confident: use the chapter distribution above to identify the likely slice range, then narrow to the specific slice using topic understanding. Go directly to get_sap_page — do NOT use search_sap_docs at any point, not at the start and not mid-way. Search is only for locating unknown documents.
- Document is unknown: proceed to keyword search (Steps 3-4).

Step 3 — Determine scope (search path only):
Use the scope already identified in Step 1.5: SBN → scope: "SBN", BNL → scope: "BNL", unclear → omit scope.

Step 4 — Extract keywords and search (search path only): Use 2-3 core concept keywords. Never describe the question in full sentences.
- If the question contains a rule name, field name, or UI label: use the original phrase as keyword, do not rephrase.
- If the question is in a non-English language: translate to English first, then extract keywords.
- Search limit: maximum 2 attempts. If both fail, stop immediately — do NOT continue searching. Answer from own knowledge, label it explicitly ("我对这个没有直接知识"), and ask the user for more context to search again.

Step 5 — Target the right document (search path only):
- Match audience: supplier question → supplier-facing docs; buyer question → buyer-facing docs.
- Invoice Rule detailed descriptions → target "Guide to Invoicing", not BuyerAdminGuide.
- Do NOT call list_sap_sources — use grep cache.json to find filenames.

Step 6 — Read and extract the answer:
- Once search locates a slice URL, use get_sap_page to read the full content. Do not answer from search excerpts alone.
- Once sufficient information is found, stop and answer immediately. Do not continue searching for a "more authoritative" source.
- EDI Guide special handling: Part1 is TOC only. Segment detail starts from Part2 and is continuous — read forward if detail seems incomplete.
- BNL EDI FC vs GTT document selection: Some transaction types (214, 315, IFTSTA D01C) exist in both a Freight Collaboration (FC) version and a Global Track and Trace (GTT) version. When analyzing an actual EDI message, determine which version to reference as follows:
  - X12 214: If the transaction set header area (immediately after B10) contains \`L11*...*T7~\` (qualifier T7 = Affected Subsystem Code) with value GTT → use GTT document (\`SAP_LBN_ANSI_X12_214_GTT\`). If only \`L11*...*06~\` is present without T7 → use FC document (\`SAP_LBN_ANSI_X12_214\`).
  - EDIFACT IFTSTA D01C: If any CNI segment contains \`RFF+ZZ9:GTT'\` → use GTT document (\`SAP_LBN_IFTSTA_D01C_GTT\`). If CNI contains \`RFF+ZZ3:\` or \`RFF+ZZ4:\` (port/customs fields) → use FC document (\`SAP_LBN_IFTSTA_D01C\`).
  - X12 315: FC and GTT versions have identical message structure and examples — cannot be distinguished from the EDI message alone. Determine from business context (user's stated scenario or system context).

For supplier-submitted document validation errors (OC / ASN / Invoice), first check Transaction Rules before looking at error message lists.

## Answering
- Always state the source at the start of every answer: e.g. "来自文档 XXX", "这是我自己的知识", "前半部分来自文档，后半部分是我自己的判断". Never omit the source label.
- When answering from own knowledge and not fully confident, explicitly say so.
- Be confident when the source is clear — do not add "不确定，要我搜一下吗" when you already have the answer.
- For questions that look like fixed principles but may be buyer-configurable Transaction Rules (e.g. "must OC be submitted before Invoice?"): do not give absolute answers. Say "这取决于买家是否开启了对应的 Transaction Rule" and state the default behavior.
- When a question is clearly a follow-up to the current conversation, interpret it within that context.

## Uncertainty & Accuracy
When you are not confident that your answer is accurate:
- Proactively tell the user that you are uncertain
- Ask the user for more context or clarifying information if that would help
- Suggest verifying against the official SAP documentation (internally, use get_sap_page to do this)

## Work Context
The user is likely an SAP Integration Advisor working on:
- SBN (SAP Business Network): Supplier integration / Trading Partner Integration
- BNL (Business Network for Logistics): Carrier integration within SAP Business Network Freight Collaboration
- SCC (SAP Supply Chain Collaboration): Supplier integration for PO Collaboration

The user is familiar with cXML, SAP Ariba/Business Network integration standards, and works primarily on APAC customer projects.
`
});

server.tool(
  "search_sap_docs",
  {
    query: z.string().describe("Search keyword, e.g. carrier integration, cXML, invoice"),
    scope: z.enum(["SBN", "BNL"]).optional().describe("Limit search to a product area: SBN (SAP Business Network) or BNL (Business Network for Logistics). Omit to search all documents.")
  },
  async ({ query, scope }) => {
    const cache = loadCache();
    if (Object.keys(cache).length === 0) {
      return { content: [{ type: "text", text: "Cache is empty. Please run: node refresh-cache.js" }] };
    }

    // Try semantic search first; fall back to keyword search if unavailable
    let results = null;
    if (_semanticReady) {
      results = await searchSemantic(query, scope);
    }
    if (!results || results.length === 0) {
      const kwResults = searchCache(query, scope);
      if (kwResults.length === 0) {
        logMiss(query);
        return { content: [{ type: "text", text: "No results found for: " + query + (scope ? ` (scope: ${scope})` : "") }] };
      }
      results = kwResults;
    }

    const text = results.map(r =>
      "[" + r.title + "]\nURL: " + r.url + "\nExcerpt: " + r.excerpt
    ).join("\n---\n");
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "get_sap_page",
  { url: z.string().describe("The SAP documentation page URL to fetch") },
  async ({ url }) => {
    const cache = loadCache();
    if (cache[url] && cache[url].success) {
      return { content: [{ type: "text", text: "[" + cache[url].title + "]\n\n" + cache[url].content }] };
    }
    return { content: [{ type: "text", text: "Page not in cache. Please run refresh-cache.js to update." }] };
  }
);

server.tool(
  "list_sap_sources",
  {},
  async () => {
    const cache = loadCache();
    if (Object.keys(cache).length === 0) {
      return { content: [{ type: "text", text: "Cache is empty. Please run refresh-cache.js" }] };
    }
    const lines = Object.entries(cache).map(([url, page]) =>
      (page.success ? "✅" : "❌") + " " + url + " (cached: " + page.cachedAt + ")"
    ).join("\n");
    return { content: [{ type: "text", text: lines }] };
  }
);

const httpPort = process.env.MCP_HTTP_PORT ? parseInt(process.env.MCP_HTTP_PORT) : null;

if (httpPort) {
  const { createServer } = await import("node:http");
  const { SSEServerTransport } = await import("@modelcontextprotocol/sdk/server/sse.js");
  const transports = new Map();

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${httpPort}`);

    if (req.method === "GET" && url.pathname === "/sse") {
      // SSE connection endpoint — client connects here first
      res.setHeader("Access-Control-Allow-Origin", "*");
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);
      transport.onclose = () => transports.delete(transport.sessionId);
      try { await server.close(); } catch (_) {}
      await server.connect(transport);

    } else if (req.method === "POST" && url.pathname === "/messages") {
      // Message endpoint — client posts JSON-RPC here
      res.setHeader("Access-Control-Allow-Origin", "*");
      const sessionId = url.searchParams.get("sessionId");
      const transport = transports.get(sessionId);
      if (!transport) {
        res.writeHead(404);
        res.end("Session not found");
        return;
      }
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", async () => {
        await transport.handlePostMessage(req, res, JSON.parse(body));
      });

    } else if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.writeHead(204);
      res.end();

    } else {
      res.writeHead(404);
      res.end();
    }
  });

  httpServer.listen(httpPort, "127.0.0.1", () => {
    process.stderr.write(`SAP Help MCP SSE server listening on http://127.0.0.1:${httpPort}/sse\n`);
  });
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
