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

const server = new McpServer({ name: "sap-help", version: "2.0.0" });

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
