import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, "cache.json");

function loadCache() {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch (e) {
    return {};
  }
}

function searchCache(query) {
  const cache = loadCache();
  const results = [];
  for (const [url, page] of Object.entries(cache)) {
    if (!page.success) continue;
    if (page.content.toLowerCase().includes(query.toLowerCase()) ||
        page.title.toLowerCase().includes(query.toLowerCase())) {
      results.push({
        url,
        title: page.title,
        excerpt: page.content.slice(0, 600),
        cachedAt: page.cachedAt
      });
    }
    if (results.length >= 5) break;
  }
  return results;
}

const server = new McpServer({ name: "sap-help", version: "2.0.0" });

server.tool(
  "search_sap_docs",
  { query: z.string().describe("Search keyword, e.g. carrier integration, cXML, invoice") },
  async ({ query }) => {
    const cache = loadCache();
    if (Object.keys(cache).length === 0) {
      return { content: [{ type: "text", text: "Cache is empty. Please run: node refresh-cache.js" }] };
    }
    const results = searchCache(query);
    if (results.length === 0) {
      return { content: [{ type: "text", text: "No results found for: " + query }] };
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
