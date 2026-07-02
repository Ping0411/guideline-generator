import os
import json
import threading
import requests
from pathlib import Path
from flask import Flask, request, jsonify, render_template

app = Flask(__name__)

BASE_DIR = Path(__file__).parent.parent  # ~/mcp-servers/sap-help/
CACHE_FILE = BASE_DIR / "cache.json"
TAGS_FILE = BASE_DIR / "tags.json"

_cache = None
_tags = None
_lock = threading.Lock()

SYSTEM_PROMPT_FILE = BASE_DIR / "index.js"


def load_cache():
    global _cache
    with _lock:
        if _cache is None and CACHE_FILE.exists():
            _cache = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        return _cache or {}


def load_tags():
    global _tags
    with _lock:
        if _tags is None and TAGS_FILE.exists():
            _tags = json.loads(TAGS_FILE.read_text(encoding="utf-8"))
        return _tags or {}


SCOPE_PREFIXES = {
    "SBN": ["file://SBN/"],
    "BNL": ["file://api-specs/"],
}


def matches_scope(url, scope):
    if not scope:
        return True
    prefixes = SCOPE_PREFIXES.get(scope.upper(), [])
    return any(url.startswith(p) for p in prefixes)


def get_document_key(url):
    # Strip trailing _PartN.pdf to get the document key (mirrors utils.js logic)
    import re
    return re.sub(r"_Part\d+.*\.pdf$", "", url, flags=re.IGNORECASE)


def search_cache(query, scope=None):
    cache = load_cache()
    tags = load_tags()
    keywords = [w for w in query.lower().split() if len(w) > 2]
    if not keywords:
        return []

    tag_matched_docs = set()
    for doc_key, doc_info in tags.items():
        if any(k in t for k in keywords for t in doc_info.get("tags", [])):
            tag_matched_docs.add(doc_key)

    results = []
    for url, page in cache.items():
        if not page.get("success"):
            continue
        if not matches_scope(url, scope):
            continue
        text = page["content"].lower()
        title = page["title"].lower()

        match_idx = text.find(query.lower())
        if match_idx == -1:
            idxs = [text.find(k) for k in keywords if text.find(k) != -1]
            match_idx = idxs[0] if idxs else -1

        content_hits = sum(1 for k in keywords if k in text or k in title)
        doc_key = get_document_key(url)
        tag_bonus = len(keywords) * 0.5 if doc_key in tag_matched_docs else 0
        hit_count = content_hits + tag_bonus

        if hit_count == 0:
            continue

        start = max(0, match_idx - 200) if match_idx != -1 else 0
        excerpt = page["content"][start:start + 1200]
        results.append({"url": url, "title": page["title"], "excerpt": excerpt, "hitCount": hit_count})

    results.sort(key=lambda x: x["hitCount"], reverse=True)
    return results[:5]


def get_page(url):
    cache = load_cache()
    page = cache.get(url)
    if page and page.get("success"):
        return f"[{page['title']}]\n\n{page['content']}"
    return f"Page not in cache: {url}"


# Read system prompt from index.js instructions field
def extract_system_prompt():
    try:
        text = (BASE_DIR / "index.js").read_text(encoding="utf-8")
        start = text.find("instructions: `")
        if start == -1:
            return ""
        start += len("instructions: `")
        # Closing pattern: backtick on its own line followed by });
        end = text.find("\n`\n});", start)
        if end == -1:
            return ""
        return text[start:end].strip()
    except Exception:
        return ""


SYSTEM_PROMPT = extract_system_prompt()

TOOLS = [
    {
        "name": "search_sap_docs",
        "description": "keyword search across SAP documentation, returns matching slice URLs + excerpts. Use to locate which document/slice contains the answer when the document is unknown.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search keyword, e.g. carrier integration, cXML, invoice"},
                "scope": {"type": "string", "enum": ["SBN", "BNL"], "description": "Limit search to SBN or BNL documents. Omit to search all."}
            },
            "required": ["query"]
        }
    },
    {
        "name": "get_sap_page",
        "description": "Read the full content of a specific SAP documentation slice URL from the local cache.",
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "The SAP documentation page URL to fetch"}
            },
            "required": ["url"]
        }
    }
]


def run_tool(name, inputs):
    if name == "search_sap_docs":
        results = search_cache(inputs["query"], inputs.get("scope"))
        if not results:
            return f"No results found for: {inputs['query']}"
        lines = []
        for r in results:
            lines.append(f"[{r['title']}]\nURL: {r['url']}\nExcerpt: {r['excerpt']}")
        return "\n---\n".join(lines)
    elif name == "get_sap_page":
        return get_page(inputs["url"])
    return "Unknown tool"


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/chat", methods=["POST"])
def chat():
    data = request.json
    api_key = data.get("api_key", "").strip()
    base_url = data.get("base_url", "").strip().rstrip("/")
    messages = data.get("messages", [])

    if not api_key:
        return jsonify({"error": "API key is required"}), 400
    if not messages:
        return jsonify({"error": "No messages provided"}), 400
    if not base_url:
        return jsonify({"error": "Base URL is required"}), 400

    api_url = base_url + "/anthropic/v1/messages"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }

    try:
        current_messages = list(messages)
        while True:
            payload = {
                "model": "anthropic--claude-sonnet-latest",
                "max_tokens": 4096,
                "system": SYSTEM_PROMPT,
                "tools": TOOLS,
                "messages": current_messages
            }
            resp = requests.post(api_url, headers=headers, json=payload, timeout=120)
            if not resp.ok:
                return jsonify({"error": f"API error {resp.status_code}: {resp.text[:200]}"}), 502

            body = resp.json()
            content = body.get("content", [])
            stop_reason = body.get("stop_reason", "")

            # Check for tool_use blocks
            tool_uses = [b for b in content if b.get("type") == "tool_use"]
            if not tool_uses or stop_reason == "end_turn":
                text = " ".join(b["text"] for b in content if b.get("type") == "text")
                return jsonify({"reply": text})

            # Run tools and continue loop
            current_messages.append({"role": "assistant", "content": content})
            tool_results = []
            for tu in tool_uses:
                result_text = run_tool(tu["name"], tu.get("input", {}))
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tu["id"],
                    "content": result_text
                })
            current_messages.append({"role": "user", "content": tool_results})

    except requests.exceptions.ConnectionError:
        return jsonify({"error": "Cannot connect to AI service. Check your Base URL."}), 502
    except requests.exceptions.Timeout:
        return jsonify({"error": "Request timed out."}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False)
