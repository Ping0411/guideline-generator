import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync, appendFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, "cache.json");
const TAGS_FILE = join(__dirname, "tags.json");
const MISSES_LOG = join(__dirname, "search_misses.log");

function loadCache() {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch (e) {
    return {};
  }
}

function loadTags() {
  if (!existsSync(TAGS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(TAGS_FILE, "utf-8"));
  } catch (e) {
    return {};
  }
}

function getDocumentKey(url) {
  const match = url.match(/file:\/\/(.+?)(_Part\d+)?\.pdf$/);
  if (match) return match[1];
  return url;
}

function logMiss(query) {
  const line = `${new Date().toISOString()} | "${query}" | 0 results\n`;
  try {
    appendFileSync(MISSES_LOG, line, "utf-8");
  } catch (e) {}
}

const SCOPE_PREFIXES = {
  SBN: ["file://SBN/"],
  BNL: ["file://api-specs/", "https://help.sap.com/docs/business-network-for-logistics", "https://help.sap.com/docs/business-network-global-track-and-trace", "https://help.sap.com/docs/business-network-logistics-provider"],
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
- If the question is primarily Chinese → respond entirely in Chinese
- If the question is primarily English → respond entirely in English
- If mixed, follow the dominant language

Apply this to all output: the answer body, source attribution, in-process notes, and any other text.

## Work Context
The user is likely an SAP Integration Advisor working on:
- SBN (SAP Business Network): Supplier integration / Trading Partner Integration
- BNL (Business Network for Logistics): Carrier integration within SAP Business Network Freight Collaboration
- SCC (SAP Business Collaboration Cloud): Supplier integration for PO Collaboration

The user is familiar with cXML, SAP Ariba/Business Network integration standards, and works primarily on APAC customer projects.

## When to Search vs Answer from Knowledge
Before answering, split the question into scene (who, what system, what happened) and actual ask (what the user truly wants to know). The actual ask determines the question type.

1. Pure concept / background knowledge question (e.g. "what is a Transaction Rule", "what is the relationship between CIG and SBN") — Answer from own knowledge first. End with "要不要我帮你进一步查一下详细资料？" and wait for confirmation.
   Warning: If the answer involves denying or correcting the user's stated premise (e.g. "supplier can't do X"), stop — search first.

2. Any question involving specific product behavior, feature operations, fields, configuration, or process steps — Use search_sap_docs directly without answering from knowledge first. This includes: cXML field names, config paths, UI labels, version-sensitive details, and specific product feature operation flows. All Test Central questions always fall into this category.

3. No direct knowledge of the topic — Search directly. Do not infer from "similar logic". Note at the top: "我对这个没有直接知识，以下来自文档检索".

4. User explicitly asks to check official docs — Search immediately.

## How to Search
Step 1 — Understand the actual ask: identify what the user truly wants to know (not the background scene). This drives the search direction.

Step 2 — Determine scope:
- SBN: PO / OC / ASN / Invoice / cXML / Test Central / supplier integration / buyer admin / CIG / transaction rules → scope: "SBN"
- BNL: carrier / freight / freight order / freight booking / logistics invoice / track and trace / EDI for logistics → scope: "BNL"
- Unclear: omit scope

Step 3 — Extract 2-3 core concept keywords: topic word + action/type + optional qualifier. Keywords locate the document, not describe the question. The longer the question, the more you must resist including background description. Never use sentence-like phrases — if it reads like a sentence, break it down.

Step 4 — Choose the right tool:
- If a dedicated guide likely exists (How to Guide, Setup Guide, Admin Guide): call list_sap_sources first to confirm filename, then get_sap_page to read directly
- If unsure which document contains the answer: use search_sap_docs with core keywords
- Do NOT call list_sap_sources for every question — only when a dedicated guide is likely to exist

Step 5 — Extract the answer using full semantic understanding. Keywords locate the document; the answer comes from reading and interpreting the content.

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
    const results = searchCache(query, scope);
    if (results.length === 0) {
      logMiss(query);
      return { content: [{ type: "text", text: "No results found for: " + query + (scope ? ` (scope: ${scope})` : "") }] };
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

const transport = new StdioServerTransport();
await server.connect(transport);
