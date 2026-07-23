import os
import sys
import re
import uuid
import json
import base64
import threading
import requests
from pathlib import Path
from flask import Flask, request, jsonify, render_template, Response, stream_with_context, send_file

app = Flask(__name__)

BASE_DIR = Path(__file__).parent.parent  # ~/mcp-servers/sap-help/
CACHE_FILE = BASE_DIR / "cache.json"
TAGS_FILE = BASE_DIR / "tags.json"
EXCEL_TEMP_DIR = Path("/tmp")

_cache = None
_tags = None
_lock = threading.Lock()

# Load semantic search components once at startup
sys.path.insert(0, str(BASE_DIR))
_semantic_model = None
_semantic_collection = None
_semantic_lock = threading.Lock()

def _load_semantic():
    global _semantic_model, _semantic_collection
    with _semantic_lock:
        if _semantic_model is None:
            try:
                import chromadb
                from sentence_transformers import SentenceTransformer
                _semantic_model = SentenceTransformer(
                    "paraphrase-multilingual-MiniLM-L12-v2",
                    local_files_only=True
                )
                client = chromadb.PersistentClient(path=str(BASE_DIR / "chroma_db"))
                _semantic_collection = client.get_collection("sap_docs")
                print("Semantic search: model and index loaded.")
            except Exception as e:
                print(f"Semantic search unavailable: {e}")

# Pre-load in background so first query is fast
threading.Thread(target=_load_semantic, daemon=True).start()

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
    return url


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


SCOPE_PREFIXES_MAP = {
    "SBN": "file://SBN/",
    "BNL": "file://api-specs/",
}


def search_semantic(query, scope=None):
    """Search using in-memory semantic model with tag-based re-ranking."""
    import re
    _load_semantic()
    if _semantic_model is None or _semantic_collection is None:
        return []
    try:
        embedding = _semantic_model.encode(query).tolist()
        scope_prefix = SCOPE_PREFIXES_MAP.get(scope.upper(), None) if scope else None
        fetch_n = 20 if scope_prefix else 10
        results = _semantic_collection.query(
            query_embeddings=[embedding],
            n_results=fetch_n,
            include=["metadatas", "documents", "distances"],
        )

        # Deduplicate by URL, apply scope post-filter, keep best score per URL
        seen_urls = {}
        for i, meta in enumerate(results["metadatas"][0]):
            url = re.sub(r'\s+\d{2}\.\d{2}\.\d{2}(?=\.pdf)', '', meta["url"])
            if scope_prefix and not url.startswith(scope_prefix):
                continue
            score = 1 - results["distances"][0][i]
            doc_text = results["documents"][0][i]
            if url not in seen_urls or score > seen_urls[url]["score"]:
                seen_urls[url] = {
                    "url": url,
                    "title": meta.get("title", ""),
                    "excerpt": doc_text[:400].replace("\n", " ").strip(),
                    "score": score,
                }

        # Tag-based re-ranking bonus
        tags = load_tags()
        keywords = [w for w in query.lower().split() if len(w) > 2]
        for url, item in seen_urls.items():
            doc_key = get_document_key(url)
            doc_tags = tags.get(doc_key, {}).get("tags", [])
            tag_hits = sum(1 for k in keywords for t in doc_tags if k in t)
            if tag_hits:
                item["score"] += tag_hits * 0.05

        ranked = sorted(seen_urls.values(), key=lambda x: x["score"], reverse=True)[:5]
        for item in ranked:
            item["score"] = round(item["score"], 4)
        return ranked
    except Exception as e:
        print(f"Semantic search error: {e}")
        return []


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


SYSTEM_PROMPT = extract_system_prompt() + """

## Identity
When asked "who are you" or "what can you do", respond with the following:

I'm an **SAP Business Network Knowledge Assistant**, here to help you work with SAP Business Network and its related platforms — including SAP Business Network for Logistics as well.

**What I Can Help You With:**

- **SBN – SAP Business Network**: cXML documents (PO, OC, ASN, Invoice), Transaction Rules, Test Central, supplier & buyer onboarding, catalog setup, admin configuration
- **BNL – Business Network for Logistics**: Freight Collaboration workflows, Freight Orders, Logistics Invoices, Track & Trace, carrier-side integration specifics (EDI, API, and more)
- **SCC – SAP Supply Chain Collaboration**: Supplier integration for PO Collaboration

**Who I'm Built For:**
Primarily SAP Business Network practitioners — integration advisors, onboarding consultants, and technical consultants working on global customer projects.

I search official SAP documentation in real time and always tell you where my answer comes from.

## Web Interface Mode
You are responding via a web chat interface used by general business users (not technical developers).
- You MUST still use tools (search_sap_docs, get_sap_page) to look up information before answering — do NOT skip tool calls or answer from memory without searching first. The restriction below is about output only, not about whether to search.
- Do NOT output your reasoning process, intermediate steps, or search navigation notes (e.g. "让我搜索", "找到了文档", "这一页是关于..."). Go directly to the answer.
- Do NOT claim "according to the document" or assert that a document does not exist unless you have actually called the tools and verified it.
- Do NOT present inferences or guesses as facts. If uncertain, say so explicitly.
- Do NOT mention source or knowledge attribution during the search/retrieval process. Only at the start of the final answer, include a single brief source line (e.g. "来自文档 XXX" or "这是我自己的知识"). Do not repeat source attribution mid-answer.
- Provide the final answer directly, clearly, and concisely.

## cXML to EDI Conversion

**Triggers**: "给我EDI" / "EDI Please" / "EDIください" → full conversion, defaults: X12, description only for annotated fields.

Always retrieve the spec first via get_sap_page:
- X12: "SAP Business Network X12 [transaction set] 4010 Outbound" (810=Invoice, 855=Order Confirmation, 856=ASN)
- EDIFACT: "SAP Business Network EDIFACT D96A [message type] Outbound" (INVOIC, ORDRSP, DESADV)

**Phase 1 — Prepare**
1. Build a Header/Line-Item level assignment table for every cXML element before generating any EDI.
2. Map ALL cXML elements (including optional ones) to EDI segments or explicitly exclude them. Include optional segments whenever the data exists.
3. Read spec in order: ISA/GS → Header Loop (ST to CTT) → PO1 Loop → sub-loops → Appendix code lists.

**Phase 2 — Generate**
4. ISA fixed-length: pad alphanumeric elements with trailing spaces, numeric with leading zeros. No exceptions.
5. Follow EDI SegNo sequence — never scan cXML top-to-bottom (causes header segments to repeat inside line loops).
6. One mapping path per field: pick ONE qualifier route per spec; never mix paths.
7. Enumerated fields: look up Permitted Codes in spec. Never infer from name.
8. Time zone: look up Appendix 623. UoM: look up Appendix 355 (UN/CEFACT ≠ ANSI X12). Language: ISO 639-1 two-letter only.

**Phase 3 — Verify (mandatory before output)**
9. Header segments appear exactly once; line loop count matches cXML; every mapped element appears exactly once; segment order matches spec example.
10. Count ST→SE inclusive. Must equal SE01. Fix any mismatch before outputting.

**Descriptions**
Pre-check (mandatory, no exceptions):
- Scan the original cXML and list only elements that have a comment/annotation. All others get no description.
- For each EDI segment: if its source element is NOT in that list → leave blank. If it IS → write a pure EDI-standard explanation.
- Never mention cXML, XML element/attribute names, or source document references. Write for an EDI engineer with no cXML knowledge.

**Excel output (always required)**
After Phase 3 passes, append this block at the very end — no text after it:
```json
{"edi_excel": [{"segment": "ISA*00*          *...", "description": ""}, ...]}
```
- One object per segment, in order. "segment": exact string, spaces preserved. "description": "" if blank.
- If verification fails, fix first, then output corrected EDI and corrected JSON.

## SAP Trusted CA / Certificate Authority List
When the user is asking for the actual list of CAs trusted by SAP (e.g. "show me the SAP trusted CA list", "which certificate authorities does SAP trust", "SAP Trust CA list"), use get_sap_page directly to retrieve it:
  URL: file://SBN/split/SAP Global Trust CA List_2801396.pdf
If the user also wants to access the original SAP Note, refer them to: https://me.sap.com/notes/2801396
Note: This only applies when the user wants the list itself. For other questions about certificates or CA-related topics, follow the normal search flow.
"""

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


def extract_binary_attachment(name, mime, b64data):
    """Extract text from PDF/Word/Excel/RTF attachments server-side."""
    try:
        raw = base64.b64decode(b64data)
        ext = Path(name).suffix.lower()

        if ext == '.rtf':
            # Strip RTF markup: decode as latin-1, remove control words and groups
            import re
            text = raw.decode('latin-1', errors='replace')
            text = re.sub(r'\\[a-z]+[-]?\d*[ ]?', ' ', text)
            text = re.sub(r'[{}\\]', '', text)
            text = re.sub(r'\s+', ' ', text).strip()
            return text[:40000] if text else f"[Could not extract text from {name}]"

        if ext == '.pdf':
            import pypdf, io
            reader = pypdf.PdfReader(io.BytesIO(raw))
            text = '\n'.join(page.extract_text() or '' for page in reader.pages).strip()
            return text[:40000] if text else f"[Could not extract text from {name}]"

        elif ext in ('.doc', '.docx'):
            from docx import Document
            import io
            doc = Document(io.BytesIO(raw))
            text = '\n'.join(p.text for p in doc.paragraphs if p.text.strip())
            return text[:40000] if text else f"[Could not extract text from {name}]"

        elif ext == '.xlsx':
            import openpyxl
            import io
            wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
            lines = []
            for sheet in wb.worksheets:
                lines.append(f"[Sheet: {sheet.title}]")
                for row in sheet.iter_rows(values_only=True):
                    row_vals = [str(c) if c is not None else '' for c in row]
                    if any(v.strip() for v in row_vals):
                        lines.append('\t'.join(row_vals))
            text = '\n'.join(lines)
            return text[:40000] if text else f"[Could not extract text from {name}]"

        elif ext == '.xls':
            # openpyxl does not support legacy .xls format — use xlrd instead
            import xlrd
            import io
            wb = xlrd.open_workbook(file_contents=raw)
            lines = []
            for sheet in wb.sheets():
                lines.append(f"[Sheet: {sheet.name}]")
                for row_idx in range(sheet.nrows):
                    row_vals = [str(sheet.cell_value(row_idx, col)) for col in range(sheet.ncols)]
                    if any(v.strip() for v in row_vals):
                        lines.append('\t'.join(row_vals))
            text = '\n'.join(lines)
            return text[:40000] if text else f"[Could not extract text from {name}]"

    except Exception as e:
        return f"[Error extracting {name}: {e}]"


def normalize_messages(messages):
    """Convert frontend message format to Claude API format.
    Handles binary attachments by extracting text server-side."""
    normalized = []
    for msg in messages:
        content = msg.get('content')
        if isinstance(content, list):
            new_content = []
            for block in content:
                if block.get('type') == 'image':
                    new_content.append(block)
                elif block.get('type') == 'text' and block.get('_binary'):
                    # Extract text from binary attachment
                    b = block['_binary']
                    extracted = extract_binary_attachment(b['name'], b['mime'], b['base64'])
                    new_content.append({
                        'type': 'text',
                        'text': f"[Attached file: {b['name']}]\n```\n{extracted}\n```"
                    })
                else:
                    # Strip internal _binary key if present
                    clean = {k: v for k, v in block.items() if k != '_binary'}
                    new_content.append(clean)
            normalized.append({'role': msg['role'], 'content': new_content})
        else:
            normalized.append(msg)
    return normalized


def run_tool(name, inputs, search_mode="classic"):
    if name == "search_sap_docs":
        scope = inputs.get("scope")
        if search_mode == "semantic":
            results = search_semantic(inputs["query"], scope)
            if not results:
                return f"No results found for: {inputs['query']}"
            lines = []
            for r in results:
                lines.append(f"[{r['title']}]\nURL: {r['url']}\nExcerpt: {r['excerpt']}")
            return "\n---\n".join(lines)
        else:
            results = search_cache(inputs["query"], scope)
            if not results:
                return f"No results found for: {inputs['query']}"
            lines = []
            for r in results:
                lines.append(f"[{r['title']}]\nURL: {r['url']}\nExcerpt: {r['excerpt']}")
            return "\n---\n".join(lines)
    elif name == "get_sap_page":
        return get_page(inputs["url"])
    return "Unknown tool"


def build_excel(rows):
    """Generate an Excel workbook from EDI rows and return the file path."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "EDI"

    # Header row
    header_font = Font(bold=True)
    header_fill = PatternFill("solid", fgColor="D9E1F2")
    for col, label in enumerate(["Segment", "Description"], start=1):
        cell = ws.cell(row=1, column=col, value=label)
        cell.font = header_font
        cell.fill = header_fill

    # Data rows — segment column uses monospace font and text format
    mono = Font(name="Courier New", size=10)
    for row_idx, item in enumerate(rows, start=2):
        seg_cell = ws.cell(row=row_idx, column=1, value=item.get("segment", ""))
        seg_cell.font = mono
        seg_cell.number_format = "@"  # force text, preserve leading spaces
        seg_cell.alignment = Alignment(wrap_text=False)

        desc = item.get("description", "")
        if desc:
            ws.cell(row=row_idx, column=2, value=desc)

    # Column widths
    ws.column_dimensions[get_column_letter(1)].width = 80
    ws.column_dimensions[get_column_letter(2)].width = 60

    filename = f"edi_{uuid.uuid4().hex[:8]}.xlsx"
    path = EXCEL_TEMP_DIR / filename
    wb.save(str(path))
    return filename


@app.route("/download_excel/<filename>")
def download_excel(filename):
    # Restrict to simple filenames to prevent path traversal
    if "/" in filename or ".." in filename:
        return jsonify({"error": "Invalid filename"}), 400
    path = EXCEL_TEMP_DIR / filename
    if not path.exists():
        return jsonify({"error": "File not found or expired"}), 404
    return send_file(str(path), as_attachment=True, download_name=filename)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/chat", methods=["POST"])
def chat():
    data = request.json
    api_key = data.get("api_key", "").strip()
    base_url = (data.get("base_url") or "").strip().rstrip("/")
    messages = data.get("messages", [])
    search_mode = data.get("search_mode", "classic")  # "classic" or "semantic"

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

    def generate():
        try:
            current_messages = normalize_messages(list(messages))
            full_reply = ""

            while True:
                payload = {
                    "model": "anthropic--claude-sonnet-latest",
                    "max_tokens": 4096,
                    "system": SYSTEM_PROMPT,
                    "tools": TOOLS,
                    "messages": current_messages,
                    "stream": True
                }
                resp = requests.post(api_url, headers=headers, json=payload, timeout=120, stream=True)
                if not resp.ok:
                    yield f"data: {json.dumps({'error': f'API error {resp.status_code}'})}\n\n"
                    return

                # Parse SSE stream
                content_blocks = {}
                stop_reason = None
                assistant_content = []

                for raw_line in resp.iter_lines():
                    if not raw_line:
                        continue
                    line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
                    if not line.startswith("data:"):
                        continue
                    event_data = line[5:].strip()
                    if event_data == "[DONE]":
                        break
                    try:
                        event = json.loads(event_data)
                    except Exception:
                        continue

                    etype = event.get("type", "")

                    if etype == "content_block_start":
                        idx = event["index"]
                        block = event["content_block"]
                        content_blocks[idx] = block
                        if block["type"] == "text":
                            assistant_content.append({"type": "text", "text": ""})
                        elif block["type"] == "tool_use":
                            assistant_content.append({
                                "type": "tool_use",
                                "id": block["id"],
                                "name": block["name"],
                                "input": ""
                            })

                    elif etype == "content_block_delta":
                        idx = event["index"]
                        delta = event.get("delta", {})
                        if delta.get("type") == "text_delta":
                            chunk = delta.get("text", "")
                            full_reply += chunk
                            assistant_content[idx]["text"] += chunk
                            yield f"data: {json.dumps({'chunk': chunk})}\n\n"
                        elif delta.get("type") == "input_json_delta":
                            assistant_content[idx]["input"] += delta.get("partial_json", "")

                    elif etype == "message_delta":
                        stop_reason = event.get("delta", {}).get("stop_reason")

                # Check for tool calls
                tool_uses = [b for b in assistant_content if b.get("type") == "tool_use"]
                if not tool_uses or stop_reason == "end_turn":
                    # Extract edi_excel JSON block if present
                    excel_url = None
                    display_reply = full_reply

                    # Find the start of the edi_excel block (inside or outside a code fence)
                    json_start = None
                    fence_start = None
                    m = re.search(r'```(?:json)?\s*(\{"edi_excel"\s*:)', full_reply)
                    if m:
                        json_start = m.start(1)
                        fence_start = m.start(0)
                    else:
                        m = re.search(r'(\{"edi_excel"\s*:)', full_reply)
                        if m:
                            json_start = m.start(1)
                            fence_start = m.start(0)

                    if json_start is not None:
                        try:
                            decoder = json.JSONDecoder()
                            data, _ = decoder.raw_decode(full_reply, json_start)
                            rows = data.get("edi_excel", [])
                            if rows:
                                filename = build_excel(rows)
                                excel_url = f"/download_excel/{filename}"
                        except Exception:
                            pass
                        # Remove the JSON block (and any surrounding code fence) from display
                        display_reply = full_reply[:fence_start].rstrip()

                    done_event = {"done": True, "full_reply": display_reply}
                    if excel_url:
                        done_event["excel_url"] = excel_url
                    yield f"data: {json.dumps(done_event)}\n\n"
                    return

                # Parse tool inputs and run them
                for tu in assistant_content:
                    if tu.get("type") == "tool_use":
                        try:
                            tu["input"] = json.loads(tu["input"]) if isinstance(tu["input"], str) else tu["input"]
                        except Exception:
                            tu["input"] = {}

                current_messages.append({"role": "assistant", "content": assistant_content})

                # Signal tool execution to frontend
                yield f"data: {json.dumps({'tool_running': True})}\n\n"

                tool_results = []
                for tu in tool_uses:
                    result_text = run_tool(tu["name"], tu.get("input", {}), search_mode)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tu["id"],
                        "content": result_text
                    })
                current_messages.append({"role": "user", "content": tool_results})

        except requests.exceptions.ConnectionError:
            yield f"data: {json.dumps({'error': 'Cannot connect to AI service. Check your Base URL.'})}\n\n"
        except requests.exceptions.Timeout:
            yield f"data: {json.dumps({'error': 'Request timed out.'})}\n\n"
        except GeneratorExit:
            pass
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False)
