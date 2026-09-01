import os
import sys
import re
import uuid
import json
import base64
import threading
import subprocess
import tempfile
import requests
import datetime
from pathlib import Path
from flask import Flask, request, jsonify, render_template, Response, stream_with_context, send_file

app = Flask(__name__)

BASE_DIR = Path(__file__).parent.parent  # ~/mcp-servers/sap-help/
CACHE_FILE = BASE_DIR / "cache.json"
TAGS_FILE = BASE_DIR / "tags.json"
EXCEL_TEMP_DIR = Path("/tmp")
EDI_LOG_FILE = BASE_DIR / "edi_conversion_log.jsonl"
EDI_LOG_RETENTION_DAYS = 7

def _write_edi_log(entry: dict):
    """Append one EDI conversion record to the JSONL log file.
    Entries older than EDI_LOG_RETENTION_DAYS are dropped on each write.
    """
    entry["ts"] = datetime.datetime.utcnow().isoformat() + "Z"
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=EDI_LOG_RETENTION_DAYS)

    # Read existing entries, filter old ones, append new one, rewrite
    existing = []
    if EDI_LOG_FILE.exists():
        try:
            with open(EDI_LOG_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                        ts_str = rec.get("ts", "")
                        ts = datetime.datetime.fromisoformat(ts_str.rstrip("Z"))
                        if ts >= cutoff:
                            existing.append(rec)
                    except Exception:
                        pass  # drop malformed lines
        except Exception:
            pass

    existing.append(entry)
    with threading.Lock():
        with open(EDI_LOG_FILE, "w", encoding="utf-8") as f:
            for rec in existing:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")

_cache = None
_tags = None
_lock = threading.Lock()

# EDI file session store — key: uuid, value: {rows: [{segment, description}], raw_text: str}
# Keyed by session ID assigned at upload time; cleared when server restarts.
_edi_sessions = {}
_edi_sessions_lock = threading.Lock()

# EDI spec file cache — one file per transaction set, stored in system temp dir
_SPEC_CACHE_DIR = Path(tempfile.gettempdir()) / "edi_spec_cache"
_SPEC_CACHE_DIR.mkdir(exist_ok=True)

# Maps transaction set → (doc_name, total_parts)
_SPEC_DOC_MAP = {
    "850": ("SAP Business Network X12 PO850 4010 Outbound", 21),
    "860": ("SAP Business Network X12 PC860 4010 Outbound", 21),
    "855": ("SAP Business Network X12 PR855 4010 Inbound",  18),
    "856": ("SAP Business Network X12 SH856 4010 Inbound",  22),
    "810": ("SAP Business Network X12 IN810 4010 Inbound",  24),
}

def get_spec_text(tx_set: str) -> str | None:
    """Return full spec text for the given transaction set.
    Reads from /tmp/edi_spec_cache/<tx_set>.txt if it exists, otherwise builds it
    from cache.json and writes the file for future requests.
    """
    if tx_set not in _SPEC_DOC_MAP:
        return None

    cache_file = _SPEC_CACHE_DIR / f"{tx_set}.txt"
    if cache_file.exists():
        text = cache_file.read_text(encoding="utf-8")
        print(f"[spec_cache] HIT — {tx_set} from {cache_file}")
        return text

    # Build from cache.json
    doc_name, total_parts = _SPEC_DOC_MAP[tx_set]
    doc_cache = load_cache()
    parts = []
    for part in range(1, total_parts + 1):
        url = f"file://SBN/split/X12/{doc_name}_Part{part}.pdf"
        page = doc_cache.get(url)
        if page and page.get("success"):
            parts.append(f"=== {doc_name} Part {part} ===\n{page['content']}")

    if not parts:
        print(f"[spec_cache] MISS — no cache.json entries found for {tx_set}")
        return None

    full_text = "\n\n".join(parts)
    cache_file.write_text(full_text, encoding="utf-8")
    print(f"[spec_cache] BUILT — {tx_set} ({len(parts)} parts) → {cache_file}")
    return full_text

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

## EDI — [MODE:CHECK]

**Triggers**: user asks to check, verify, review, or validate an existing EDI message.

**MANDATORY MODE TAG**: The very first characters of every CHECK response must be `[MODE:CHECK]` — before any other text, on its own line. No preamble, no greeting. Applies regardless of language.

---

**SHARED: The spec is the only authority.**
Every check finding must cite the spec. Using memory or confidence as a substitute is forbidden.
- Open the spec for every enumerated field — never verify from memory.
- External reference sources (prior examples, extension rules) carry zero authority.

**SHARED: Determine transaction set BEFORE reading spec.**
Identify the transaction set from the EDI message header (ST segment) before doing anything else:
- ST*850 → PO850 Outbound; ST*860 → PC860 Outbound
- ST*855 → PR855 Inbound; ST*856 → SH856 Inbound; ST*810 → IN810 Inbound; ST*861 → RC861 Inbound
- For EDIFACT: identify message type from UNH segment.

**HIGH-SIMILARITY WARNING**: 850/860 and 810/880 share almost identical structure but use different segment names. Never check one transaction set's output against another transaction set's spec.

**SHARED: Read the full spec (mandatory before checking).**

Step A — Call get_sap_page to retrieve the correct spec:
- X12: "SAP Business Network X12 [prefix+set] 4010 [Inbound|Outbound]"
  - Inbound: IN810 Invoice, PR855 Order Confirmation, SH856 ASN
  - Outbound: PO850 PO, PC860 PO Change, RA820 Remittance, AG824 GR, RC861 Receiving
- EDIFACT: "SAP Business Network EDIFACT D96A [message type] Outbound"
- Read ALL slices. Part1 is TOC only; segment detail starts from Part2. Read until fully covered.

Step B — Output this line before the checklist result:
`来自文档：<exact document name>，版本 <version>`

Prior knowledge does NOT replace reading the spec. No exceptions.

---

**Fixed checklist — apply to every EDI check, no items may be skipped:**
1. **Structure** — loop/segment order matches spec (e.g. N1 loop internal order, IT1 loop sequence)
2. **Syntax** — delimiters, segment terminators, ISA fixed-width padding (ISA elements must be exact length)
3. **Mandatory fields (M)** — every M-status element has a value
4. **Enumerated values** — every field with Permitted Codes: value must be in the spec list
5. **Not Used fields (X)** — every X-status element is empty; no value is present
6. **Conditional fields (C)** — when the trigger condition is met, the C field must be provided
7. **Segment counts** — SE01, GS06/GE02, ISA13/IEA02 match actual counts
8. **Description accuracy** — when a description column is present: description must match the spec field definition and the actual value in the segment; flag if misleading, wrong field name, or wrong qualifier meaning

---

**Output rules — strictly enforced:**
- First line of output: `来自文档：<doc name>，版本 <version>` (from Step B above)
- For every item checked, output exactly one of:
  - **No problem found**: `<SegmentID>: ✅` — one line, nothing else. No explanation, no analysis.
  - **Confirmed problem**: segment ID as header line, then bullet points: what is wrong, correct value, spec reference. One sentence per bullet.
- Last line: ONE summary — total confirmed issue count, or `✅ No issues found.`
- **Description output rule**: When outputting corrected segments with descriptions, the description column must contain ONLY the field's business meaning. It is strictly forbidden to include any modification notes, change history, or correction markers (e.g. "Corrected from", "Changed from", "Previously", "Fixed", "Updated", "was X now Y"). Write the final correct content only — no trace of what it was before.

---

## EDI — [MODE:CONVERT]

**Triggers**: "给我EDI" / "EDI Please" / "EDIください" → full conversion. Defaults: X12, description only for annotated fields.

**MANDATORY MODE TAG**: The very first characters of every CONVERT response must be `[MODE:CONVERT]` — before any other text, on its own line. No preamble, no greeting. Applies regardless of language.

---

**SHARED: The spec is the only authority. Memory and confidence are forbidden as substitutes.**
Using memory, prior knowledge, or confidence to fill any EDI value is **prohibited**. This is a hard rule with no exceptions.
- **Prohibition**: It is forbidden to write any segment value, qualifier, or code based on memory or confidence. The spec must be the direct source for every value written.
- **Prohibition**: It is forbidden to skip reading the spec for a segment because it feels familiar. Familiarity is the #1 cause of mapping errors.
- **Prohibition**: It is forbidden to self-verify against your own output. Phase 3 verification must cite the spec and Phase 1 tracking table. "What I wrote matches what I wrote" is not verification.
- **Prohibition**: It is forbidden to perform a partial correction. Any fix must restart the full Phase 2 four-step protocol for every affected segment.
- Every enumerated field — open the spec Permitted Codes table, read the list, then select. Never fill from memory.
- Every segment element count — open the Element Reference table and count explicitly. Never infer from appearance.
- External reference sources (extension rules, prior EDI examples) carry zero authority. There is only the spec.

**SHARED: Determine the correct Transaction Set BEFORE selecting the spec.**
Execute this decision tree on the cXML before doing anything else:

```
OrderRequest/@type = ?
  "new"    → ST*850, GS01=PO, spec: PO850 Outbound
  "update" → ST*860, GS01=PC, spec: PC860 Outbound
  "delete" → ST*860, GS01=PC, spec: PC860 Outbound

ConfirmationRequest         → ST*855, GS01=PR, spec: PR855 Inbound
ShipNoticeRequest           → ST*856, GS01=SH, spec: SH856 Inbound
InvoiceDetailRequest        → ST*810, GS01=IN, spec: IN810 Inbound
ReceiptRequest              → ST*861, GS01=RC, spec: RC861 Inbound
```

Getting the Transaction Set wrong invalidates the entire output. Do not proceed until confirmed.

**HIGH-SIMILARITY WARNING — Segment names differ between related transaction sets.**
850 and 860 share almost identical structure but use different segment names. Never carry over segment names from memory:
- 850 uses: BEG, PO1 — 860 uses: BCH, POC (not BEG, not PO1)
- 810 and 880 similarly differ
- Any time you switch transaction sets: discard all segment name memory. Re-read the spec Segment Table from SegNo=1. No exceptions.

**SHARED: Read the full spec. This is not optional. Skipping it is forbidden.**

Step A (mandatory, execute before any other action):
Call get_sap_page to retrieve the spec determined in the decision tree above.
- X12: document name = "SAP Business Network X12 [prefix+set] 4010 [Inbound|Outbound]"
  - Inbound (supplier→SBN): IN810 Invoice, PR855 Order Confirmation, SH856 ASN
  - Outbound (SBN→supplier): PO850 PO, PC860 PO Change, RA820 Remittance, AG824 GR/Application Advice, RC861 Receiving
- EDIFACT: "SAP Business Network EDIFACT D96A [message type] Outbound" (INVOIC, ORDRSP, DESADV)
- Read the complete spec — ISA/GS envelope → Header loop → detail loops → sub-loops → Appendix code lists.
- Read ALL slices until the spec is fully covered. Part1 is TOC only; segment detail starts from Part2.

Step B (mandatory output, proves the spec was read):
Output this line before Phase 1:
`Spec read: <exact document name>, Parts <N>–<M>`

If this line is missing, the entire conversion is invalid and must restart from Step A.
Prior knowledge, familiarity, or memory does NOT replace reading the spec. No exceptions.

- If a segment has two candidate routes (e.g. "REF*RQ or N9*ZZ"), resolve by reading the spec before proceeding.

---

**CRITICAL — Complete coverage. No exceptions.**
Every cXML element and attribute in the input — including every `<Extrinsic>`, `<Comments>`, `<Contact>`, `<URL>`, and every attribute on every tag — must be either:
- mapped to an EDI segment/element in the output, OR
- tracked internally as excluded with a reason.
Any element absent from both is a defect. Skipping silently is not permitted.

---

**Progress output**: Output a brief one-line status before each major step:
- Before reading spec: `📄 Reading spec: <document name>…`
- Before Phase 2: `⚙️ Generating EDI segments…`
- Before Phase 3: `🔍 Verifying…`
These are the only allowed progress lines. Do not narrate sub-steps or tool call details.

---

**Phase 1 — Analyze (MUST be output in full — not internal, not hidden)**
Build a mapping tracking table for every cXML element/attribute and OUTPUT IT COMPLETELY before Phase 2 begins. This table is the single source of truth — every value written in Phase 2 must trace back to a row in this table. Phase 2 must not re-derive any value from memory or re-read cXML; it reads this table only.

**Mandatory output format** — print the table with all columns filled:

| cXML path | EDI destination | SegNo | Loop | Permitted Codes (if enumerated) | Required count | Generated count | Status |

Status values — three stages, each must reflect reality:
- **analyzed**: Phase 1 complete for this row — EDI destination decided, Permitted Codes looked up from spec and recorded with definition text, SegNo confirmed. Set this status as each row is completed during Phase 1.
- **mapped**: The segment string has been physically written in Phase 2 output. Set this only after the segment is composed and written in Step 4 — not before.
- Any row still showing **analyzed** after Phase 2 completes is a coverage defect — go back to Phase 2, write the missing segments, update Status to mapped, then re-check before continuing.

Column definitions:
- **"SegNo" column**: Record the spec SegNo number. Phase 2 iterates in ascending SegNo order — not cXML document order.
- **"Loop" column**: Record which loop this segment belongs to (e.g. "Header", "IT1 Loop", "SAC Loop", "Summary"). IT1-level SAC vs Summary-level SAC must be separate rows with distinct SegNo values.
- **"Permitted Codes" column — mandatory for every enumerated field**: Open the spec Permitted Codes table, read the full list, then record the selected value AND the spec's definition text. Recording only the code value is insufficient — the definition text is the objective evidence that the code is semantically correct. Example: REF01=PY must record "PY = Payee's Bank Account Identification Number" not just "PY". This column must be completed before Phase 2 begins. Every value here must come from the spec — never from memory or confidence.
- **The value recorded in this column IS the value Phase 2 will write.** Phase 2 must not re-derive from memory or re-read cXML.
- **"Required count"** / **"Generated count"**: After Phase 2, every row where Generated ≠ Required is a coverage defect.

**Multi-element segments must be recorded at element granularity.** Segments with many elements (BPR, SAC, TXI, DTM, N1, CUR, etc.) must NOT be collapsed into one row. Each element that carries a cXML value OR requires a description must be its own row.

**Similar segment names at different levels are NOT the same segment.** SAC in IT1 loop and SAC in Summary have different SegNo entries and different semantic requirements. Each must be looked up independently.

**Mapping direction is always: spec definition → find cXML value. Never the reverse.**
For each EDI element: read the spec definition first, then find the matching cXML field. Do NOT start from cXML and ask "which EDI element does this look like?" Example: IT101 spec = "Purchase order line item number" → use lineNumber from ItemReference, NOT the invoice's own invoiceLineNumber.

**When multiple cXML fields could map to the same EDI element**, each candidate must get its own row, with the spec element definition cited as the tiebreaker.

**REF segments within the same loop must each be a separate row**, with relative ordering recorded. Use a sub-order column (e.g. "priority 1 / 2 / 3"). Phase 2 writes them in that recorded order.

**Conclusions from one document must not be carried into the next.** Every new cXML input is a fresh conversion.

**Phase 1 self-check (mandatory before proceeding to Phase 2):**
After the table is complete, verify every row against the spec — no memory, no confidence, no assumptions:
1. Every enumerated field: confirm the selected code is present in the spec Permitted Codes list — cite the spec entry.
2. Every SegNo: confirm the segment belongs to the recorded Loop by cross-checking the spec Segment Table.
3. Every mandatory (M) field: confirm a non-empty value is recorded.
4. Every Not Used (X) field: confirm the value is empty.
5. Every cXML element in the input: confirm it has a row in the table (either mapped or explicitly excluded with a reason).
6. Every conditional (C) field in the spec: for each C-type field, confirm it has a row in the table — either mapped (trigger condition met, value present in cXML) or explicitly excluded with the reason the trigger condition was not met. Silent absence is not permitted. If a C field has no row at all, go back to the spec, read the trigger condition, check the cXML, and add the row before proceeding.
If any item fails: correct it in the table before moving to Phase 2. Do not carry errors forward.

**855-specific mandatory decisions — resolve in Phase 1, record in tracking table, never defer to Phase 2:**

BAK02 (Acknowledgment Type, element 587) — determined solely by ConfirmationHeader/@type. Permitted Codes: AC / AE / AT / RJ:
- @type = "detail" or "alldetail" → **AC** (Acknowledge - With Detail and Change)
- @type = "except" → **AE** (Acknowledge - With Exception Detail Only)
- @type = "accept" → **AT** (Accepted)
- @type = "reject" → **RJ** (Rejected - No Detail)
Presence or absence of ItemIn does NOT affect BAK02.

CTP02 (Price Qualifier, element 236) — Permitted Codes: CUP / CHG:
- ItemIn present → **CUP** (Confirmed Unit Price)
- No ItemIn, only ConfirmationStatus/UnitPrice → **CHG** (Changed Price)

ACK product ID pairs (ACK07+) — fixed order: **VP → VS → BP → MG → MF → PD → C3 → B8 → UP**
Output only pairs that have a value. Do NOT reorder to match cXML document order.

Output:
- One line: `Spec read: <exact document name>, Parts <N>–<M>` (carried forward from Step B)
- One line: `Spec: <exact document name>`
- The complete mapping tracking table (all rows, all columns)
- One line: `Phase 1 self-check: PASSED` — only after all 6 self-check items above are confirmed clean. If any item failed and was corrected, list what was corrected before writing PASSED.

---

**Phase 2 — Generate**
**Mandatory first line before any segment:**
`⚠️ SE rule: SE*0*{ctrl}~ — placeholder only. System replaces. Manual counting forbidden.`

Generation order is driven by the spec SegNo table — not by cXML document order.

**Outer loop — SegNo-driven process:**
Before Phase 2 output begins: read the complete SegNo table and draw the full loop hierarchy. Assign every cXML element to its correct loop slot FIRST, then iterate in SegNo order:
1. Read the spec Segment Table from SegNo 1 to end.
2. For each SegNo entry: identify which cXML element in the tracking table maps to this segment.
3. If a match exists and not yet mapped: execute the inner four-step protocol, then mark as mapped and increment Generated count.
4. If already mapped: skip. Do not write duplicate segments.
5. If no match: skip optional segments. Flag missing mandatory segments.

Never assign a segment to a loop based on cXML document position — the spec SegNo table is the only authority.

**Inner loop — per-segment four-step protocol:**

For each segment, execute all four steps in order. Skipping any step is forbidden.

**Step 1 — SegNo position**: Confirm this segment's loop assignment from the spec SegNo table.

**Step 2 — Phase 1 tracking table lookup**: Find the corresponding row. Read the recorded cXML source value and the Permitted Codes column value. **The Permitted Codes column value IS the value to write — already decided. Do not re-open, do not re-derive.** Mark Status as "mapped" only after the segment string is physically composed in Step 4.

**Step 3 — Element Reference cross-check**: Open the Element Reference table for this segment. For every slot: confirm position, name, M/O/X status, data type. For ID-type slots: verify the Phase 1 value matches a Permitted Codes entry. This is a cross-check, not a fresh lookup.

**Step 4 — Compose and write**: Only after Steps 1–3 are complete, compose the segment string.

**Mandatory slot table for multi-element segments**: For ANY segment that has more than 8 elements OR has empty slots between filled slots (e.g. SAC, TXI, CTP, ITD, N1, DTM), write out the complete slot table FIRST before composing the string. Example:
```
SAC01=C  SAC02=H850  SAC03=  SAC04=  SAC05=10000
SAC06=   SAC07=      SAC08=  SAC09=  SAC10=
SAC11=   SAC12=      SAC13=162.74   SAC14=  SAC15=GST/TPS  SAC16=en
→ SAC*C*H850***10000********162.74**GST/TPS*en~
```
Forbidden: estimating element positions by visual counting. If the slot table is not written first, the segment string is invalid.

- ISA: fixed-length fields, pad alphanumeric with trailing spaces, numeric with leading zeros. ISA06=SENDERID12345, ISA08=RECEIVERID12345. Never use ANID.
- GS: GS02=SENDERID12345, GS03=RECEIVERID12345.
- All M (mandatory) elements: must be filled. X (not used) elements: must be empty. Never fill an X-status element.
- Time zone codes: Appendix 623. UoM codes: Appendix 355 (UN/CEFACT ≠ ANSI X12, do not confuse). Language: ISO 639-1 two-letter.
- **DTM timezone (DTM04): mandatory, never blank.** Map UTC offset from cXML to X12 Appendix 623 code:
  - +00:00 / Z → GM; +08:00 → 08; +09:00 → 09; -05:00 → ET; -06:00 → CT; -07:00 → MT; -08:00 → PT
  - Any other offset: look up Appendix 623 in the spec. Do not leave DTM04 empty.
- **Extrinsic routing by level and name length**:
  - Header-level Extrinsic (child of OrderRequestHeader / ConfirmationHeader / ShipNoticeHeader):
    - name ≤ 30 characters → REF*ZZ*{name}*{value}~
    - name > 30 characters → N9*ZZ**{name}~ followed by MSG*{value}~
  - Line-level Extrinsic (child of ItemOut / ItemIn / ShipNoticeItem): → N9*ZZ*{name}~ followed by MSG*{value}~
  - Determine the routing in Phase 1 mapping table. Never fill REF02 with a value longer than 30 characters.
- Amount format: N2 = integer ×100 (implied 2 decimals). R = literal decimal string. Verify which applies per field.
- Non-US/CA address: N405=SP + N406 for state/province. Not N403.
- SE01: write 0 as placeholder. Do not count, do not estimate.

---

**Phase 3 — Verify (all checks mandatory, no exceptions)**
Do NOT output step-by-step process. Output only the final result.

**Verification basis (mandatory)**: Every check must cite the spec or Phase 1 tracking table. "The output matches the output" is not verification.

Each finding must state one of:
- spec SegNo position (e.g. "SegNo 420, Loop IT1")
- Phase 1 tracking table row (e.g. "Phase 1 row: Tax/rate → TXI03 → Permitted Codes: R type")
- Permitted Codes table entry from spec (e.g. "Element 350: H850 confirmed in Permitted Codes list")

**Forbidden**: "looks correct", "matches what I wrote", "structure appears valid", or any conclusion without a spec/Phase 1 citation.

**Check 0 — SE placeholder**: Confirm SE01=0. If any other value: correct to 0 first.

**Check 0.5 — 860 mandatory segment audit (only when transaction set = 860)**:
Verify ALL of: GS01=PC; BCH present (not BEG); REF*PO present with original PO number; CTP present for changed prices; DTM04 filled; POC used for line items (not PO1). Fix any issue before continuing.

**Check 1 — Segment order**: Verify every segment's position against the spec SegNo table. Header segments must not appear inside detail loops. For REF segments: verify relative order matches Phase 1 priority sequence.

**Check 2 — Enumerated values**: For every segment, re-verify every enumerated element against spec Permitted Codes. High-risk fields: BEG02, FOB01/02, ITD01, DTM qualifier, N101, REF01, SAC01/02.
- 855 additionally: BAK02 (must match ConfirmationHeader/@type: detail/alldetail→AC, except→AE, accept→AT, reject→RJ — ItemIn presence is irrelevant), CTP02 (CUP when ItemIn present, CHG otherwise), ACK07+ order (VP→VS→BP→MG→MF→PD→C3→B8→UP).
- 810 additionally: IT101 must be PO line item number from ItemReference/@lineNumber, NOT invoiceLineNumber. TXI*TX (total tax) must appear as the first TXI under any SAC*C*H850.

**Check 3 — Spec example comparison**: If spec includes an example document, compare structure against it.

**Check 4 — Tracking table reconciliation**: Confirm Generated count = Required count for every row.

**Check 5 — No duplicate mappings**: Confirm no cXML element was written to two different EDI segments.

- SAC: SAC01/02 (type+code), SAC05 (N2 ×100), SAC15 (description, M), SAC16 (language, M).
- TXI: TXI01 (type), TXI02 (amount), TXI03 (rate), TXI04 (jurisdiction qualifier), TXI05 (jurisdiction), TXI08 (taxable amount).
- If any check fails: fix by re-executing the Phase 2 four-step protocol for each affected segment, then re-run all checks from Check 0.

---

**Descriptions**
Pre-check (mandatory):
- Input cXML may contain inline comments `<!-- B: <text> -->`. These mark fields requiring a description in the EDI output.
- For each segment: if source cXML element had a `<!-- B: ... -->` comment → write the description. All others → empty string.
- Format: `<SegmentID><ElementPosition>: <field meaning> — <requirement>.` One clean phrase. Example: `N1*RI: Remit To — required on invoice.`
- Never mention cXML, XML element/attribute names, or source references. Write for an EDI engineer with no cXML knowledge.
- If the `<!-- B: ... -->` comment contains cXML-specific terms (e.g. element names like "allDetail", "taxPointDate", "exemptDetail", "TaxDetail", "ItemIn", "ItemOut") — do NOT copy them. Translate the business requirement into EDI-standard language using the appropriate segment/element/qualifier codes from the spec.
- Do not copy the segment value into the description unless the original comment specifically requires it.
- **One statement per field, no repetition.** Write once, at the most specific level useful. Remove any duplicate sentences.
- **When a qualifier is borrowed from a different regional standard** (e.g. US ABA routing number used to carry an Australian BSB), the description must explicitly state: (1) what the EDI qualifier officially means, (2) what value is actually being carried, (3) the format difference if any.
- **No modification notes**: The description must contain ONLY the field's business meaning. It is strictly forbidden to include any correction markers or change history (e.g. "Corrected from", "Changed from", "Previously", "Fixed", "Updated"). Write the final correct content only.

---

**Excel output (always required, no exceptions)**
After Phase 3 passes all checks, append at the very end — no text after it:
```json
{"edi_excel": [{"segment": "ISA*00*          *...", "description": ""}, ...]}
```
- One object per segment, in order. "segment": exact string with spaces preserved. "description": empty string if no comment.
- This JSON must be a direct copy of the verified EDI above. Do not regenerate, simplify, or alter any segment string.
- If Phase 3 found issues: fix, re-run all checks until all pass, then output corrected EDI followed by corrected JSON. Do not append JSON before all checks pass.

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
            return text[:200000] if text else f"[Could not extract text from {name}]"

        elif ext in ('.doc', '.docx'):
            from docx import Document
            import io
            doc = Document(io.BytesIO(raw))
            text = '\n'.join(p.text for p in doc.paragraphs if p.text.strip())
            return text[:200000] if text else f"[Could not extract text from {name}]"

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
            return text[:200000] if text else f"[Could not extract text from {name}]"

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
            return text[:200000] if text else f"[Could not extract text from {name}]"

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


_EDI_RULES_DIR = Path(__file__).parent / "edi_rules"
_EDI_RULES_CACHE = {}

def load_edi_rules(tx_set: str) -> dict | None:
    """Load Extension mapping rules for a given X12 transaction set number (e.g. '850')."""
    if tx_set in _EDI_RULES_CACHE:
        return _EDI_RULES_CACHE[tx_set]
    fname = {
        "850": "rules_X12_850.json",
        "810": "rules_X12_810.json",
        "855": "rules_X12_855.json",
        "856": "rules_X12_856.json",
    }.get(tx_set)
    if not fname:
        return None
    fpath = _EDI_RULES_DIR / fname
    if not fpath.exists():
        return None
    try:
        rules = json.loads(fpath.read_text(encoding="utf-8"))
        _EDI_RULES_CACHE[tx_set] = rules
        return rules
    except Exception:
        return None


def detect_tx_set(edi_text: str) -> str | None:
    """Extract the X12 transaction set number from ST*NNN*ctrl~ line."""
    m = re.search(r'\bST\*(\d{3})\*', edi_text)
    return m.group(1) if m else None


def build_rules_summary(rules: dict) -> str:
    """Build a rules summary focused on cXML→EDI mapping paths for cross-check.

    Keeps xpath mapping relationships (the real value of Extension cross-check).
    Drops enumerated value tables — AI already reads those from the SAP spec directly.
    Target size: ~1500–2000 tokens.
    """
    tx = rules.get('transaction', '?')
    doc = rules.get('document_type', '?')
    lines = [
        f"# Extension cXML→EDI Mapping — {tx} {doc}",
        "Use this to verify: did the AI map each cXML element to the correct EDI segment and position?",
    ]

    for seg in rules.get("segments", []):
        sid = seg.get("segment_id", "?")
        loop = seg.get("loop", "")
        elems = seg.get("elements", [])
        note = seg.get("note", "")

        mappings = []
        for e in elems:
            pos = e.get("position", "?")
            etype = e.get("type", "")
            xpath = e.get("cxml_xpath", "")
            qual = e.get("qualifier", "")

            if etype == "literal":
                mappings.append(f"[{pos}]='{e.get('value','')}'(fixed)")
            elif etype in ("direct", "lookup") and xpath:
                mappings.append(f"[{pos}]←{xpath}")
            elif etype == "complex_logic" and e.get("note"):
                mappings.append(f"[{pos}] {e['note'][:60]}")
            elif qual and xpath:
                mappings.append(f"qual={qual}←{xpath}")

        if mappings or note:
            seg_line = f"{sid}({loop}): " + "; ".join(mappings)
            if note:
                seg_line += f" | {note[:80]}"
            lines.append(seg_line)

    return "\n".join(lines)


def fix_se_count(rows):
    """Recalculate SE01 based on actual segment count between ST and SE (inclusive)."""
    # Find ST and SE positions
    st_idx = next((i for i, r in enumerate(rows) if r.get("segment", "").startswith("ST*")), None)
    se_idx = next((i for i, r in enumerate(rows) if r.get("segment", "").startswith("SE*")), None)
    if st_idx is None or se_idx is None or se_idx <= st_idx:
        return rows
    actual_count = se_idx - st_idx + 1  # ST to SE inclusive
    se_seg = rows[se_idx]["segment"]
    # SE*<count>*<ctrl>~ — replace the count element
    parts = se_seg.rstrip("~").split("*")
    if len(parts) >= 2:
        parts[1] = str(actual_count)
        rows[se_idx]["segment"] = "*".join(parts) + "~"
    return rows


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


@app.route("/parse_edi_file", methods=["POST"])
def parse_edi_file():
    """
    Receive a base64-encoded xlsx file, parse the two-column EDI+description content,
    store it in the session store, and return a session_key for later use.
    """
    data = request.json or {}
    b64data = (data.get("base64") or "").strip()
    filename = (data.get("filename") or "file.xlsx").strip()
    if not b64data:
        return jsonify({"error": "base64 is required"}), 400

    try:
        import openpyxl, io
        raw = base64.b64decode(b64data)
        wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        ws = wb.active
        all_rows = []
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            if i == 0:
                continue  # skip header
            seg = str(row[0]).strip() if row[0] is not None else ""
            desc = str(row[1]).strip() if len(row) > 1 and row[1] is not None else ""
            if seg:
                all_rows.append({"segment": seg, "description": desc})

        # Extract only the EDI portion (ISA* ... IEA*), skipping cXML or other content
        rows = []
        in_edi = False
        for r in all_rows:
            seg = r["segment"]
            if seg.startswith("ISA*"):
                in_edi = True
            if in_edi:
                rows.append(r)
            if seg.startswith("IEA*"):
                in_edi = False

        # Fallback: if no ISA found, keep rows that look like EDI segments
        if not rows:
            rows = [r for r in all_rows if re.match(r'^[A-Z][A-Z0-9]{1,2}\*', r["segment"])]

    except Exception as e:
        return jsonify({"error": f"Failed to parse file: {e}"}), 400

    if not rows:
        return jsonify({"error": "No EDI rows found in file"}), 400

    session_key = uuid.uuid4().hex
    raw_text = "\n".join(
        f"{r['segment']}\t{r['description']}" if r['description'] else r['segment']
        for r in rows
    )
    with _edi_sessions_lock:
        _edi_sessions[session_key] = {"rows": rows, "raw_text": raw_text, "filename": filename}

    return jsonify({"session_key": session_key, "row_count": len(rows)})


@app.route("/export_corrected_edi", methods=["POST"])
def export_corrected_edi():
    """
    Generate a corrected EDI Excel from session data + check findings.
    Accepts: {api_key, base_url, session_key, check_findings}
    - session_key: returned by /parse_edi_file; contains original EDI rows+descriptions
    - check_findings: the AI's check result text (from the [MODE:CHECK] response)
    Calls AI once with a focused prompt — no conversation history needed.
    """
    data = request.json or {}
    api_key = (data.get("api_key") or "").strip()
    base_url = (data.get("base_url") or "").strip().rstrip("/")
    session_key = (data.get("session_key") or "").strip()
    check_findings = (data.get("check_findings") or "").strip()

    if not api_key:
        return jsonify({"error": "api_key is required"}), 400
    if not base_url:
        return jsonify({"error": "base_url is required"}), 400
    if not session_key:
        return jsonify({"error": "session_key is required"}), 400

    with _edi_sessions_lock:
        session = _edi_sessions.get(session_key)
    if not session:
        return jsonify({"error": "Session not found or expired. Please re-upload the EDI file."}), 404

    # Build the original EDI + description text from session rows
    rows = session.get("rows", [])
    original_lines = []
    for r in rows:
        seg = r.get("segment", "")
        desc = r.get("description", "")
        if desc:
            original_lines.append(f"{seg}\t{desc}")
        else:
            original_lines.append(seg)
    original_text = "\n".join(original_lines)

    export_prompt = (
        "You are given the original EDI message with descriptions (tab-separated), "
        "and a list of issues found during review.\n\n"
        "Original EDI (segment TAB description — description may be empty):\n"
        "```\n"
        f"{original_text}\n"
        "```\n\n"
        "Issues found during review:\n"
        "```\n"
        f"{check_findings if check_findings else '(No specific issues provided — output original EDI with descriptions as-is)'}\n"
        "```\n\n"
        "Task: Apply all the fixes identified above to produce the corrected EDI. "
        "Keep every segment that is correct as-is. "
        "For segments that had a description, keep or update the description to reflect any change made. "
        "For segments needing fixes, apply the correction and explain what changed in the description.\n\n"
        "Output ONLY the following JSON block — no explanation, no other text:\n"
        "```json\n"
        '{"edi_excel": [{"segment": "ISA*...", "description": "..."}, ...]}\n'
        "```\n"
        "Rules:\n"
        "- segment: the exact corrected EDI segment string\n"
        "- description: keep original description if unchanged; update if segment was corrected; empty string if no description needed\n"
        "- Include ALL segments from ISA to IEA"
    )

    SYSTEM_PROMPT = extract_system_prompt()
    api_url = f"{base_url}/anthropic/v1/messages"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    try:
        payload = {
            "model": "anthropic--claude-sonnet-latest",
            "max_tokens": 8192,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": [{"type": "text", "text": export_prompt}]}],
            "stream": False,
        }
        r = requests.post(api_url, headers=headers, json=payload, timeout=300)
        if not r.ok:
            print(f"[export_corrected_edi] API error {r.status_code}: {r.text[:500]}", flush=True)
            return jsonify({"error": f"API error {r.status_code}", "detail": r.text[:300]}), 502
        reply = r.json().get("content", [{}])[0].get("text", "")
        print(f"[export_corrected_edi] Got reply ({len(reply)} chars): {reply[:300]!r}", flush=True)
    except Exception as e:
        print(f"[export_corrected_edi] Exception: {e}", flush=True)
        return jsonify({"error": str(e)}), 500

    # Parse edi_excel JSON from reply
    m = re.search(r'```(?:json)?\s*(\{"edi_excel"\s*:)', reply)
    start = m.start(1) if m else None
    if start is None:
        m = re.search(r'(\{"edi_excel"\s*:)', reply)
        start = m.start(1) if m else None
    if start is None:
        return jsonify({"error": "AI did not return edi_excel JSON", "raw": reply[:500]}), 500

    try:
        ex_data, _ = json.JSONDecoder().raw_decode(reply, start)
        rows = ex_data.get("edi_excel", [])
    except Exception as e:
        return jsonify({"error": f"JSON parse error: {e}", "raw": reply[:500]}), 500

    if not rows:
        return jsonify({"error": "edi_excel list is empty"}), 500

    filename = build_excel(fix_se_count(rows))
    return jsonify({"excel_url": f"/download_excel/{filename}"})


@app.route("/generate_excel_from_edi", methods=["POST"])
def generate_excel_from_edi():
    """Accept raw EDI text and return an Excel download URL."""
    data = request.json or {}
    edi_text = (data.get("edi") or "").strip()
    if not edi_text:
        return jsonify({"error": "edi is required"}), 400
    rows = [{"segment": line.strip(), "description": ""}
            for line in edi_text.splitlines()
            if re.match(r'^[A-Z][A-Z0-9]{1,2}\*', line.strip())]
    if not rows:
        return jsonify({"error": "No EDI segments found"}), 400
    filename = build_excel(fix_se_count(rows))
    return jsonify({"excel_url": f"/download_excel/{filename}"})


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


GENERATOR_DIR   = Path(os.environ.get("GENERATOR_DIR", Path(__file__).parent / "guideline-generator"))
GENERATOR_PORT  = 5002
VECTOR_PORT     = 7655
SEMANTIC_SCRIPT = Path(os.environ.get("SEMANTIC_SCRIPT", Path(__file__).parent.parent / "semantic_search.py"))


def _is_port_up(port: int, timeout: float = 1.0) -> bool:
    """Return True if something is listening on localhost:port."""
    import socket
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False


def _ensure_vector_service():
    """Start semantic_search.py --serve if not already running on VECTOR_PORT."""
    if _is_port_up(VECTOR_PORT):
        return  # already up

    if not SEMANTIC_SCRIPT.exists():
        return  # script missing — skip silently

    python_candidates = ["python3", "python", "/opt/homebrew/bin/python3", "/usr/bin/python3"]
    python_bin = None
    for candidate in python_candidates:
        try:
            subprocess.run([candidate, "--version"], capture_output=True, timeout=3)
            python_bin = candidate
            break
        except Exception:
            continue

    if not python_bin:
        return  # no python — skip silently

    subprocess.Popen(
        [python_bin, str(SEMANTIC_SCRIPT), "--serve", "--port", str(VECTOR_PORT)],
        cwd=str(SEMANTIC_SCRIPT.parent),
        stdout=open("/tmp/semantic_search.log", "w"),
        stderr=subprocess.STDOUT,
    )


@app.route("/launch_generator")
def launch_generator():
    """
    Check if the Guideline Generator (port 5002) is already running.
    If not, start it. Also ensures the vector search service (port 7655) is running.
    Returns { "url": "http://localhost:5002" } on success.
    """
    import time

    # Start vector service if needed (non-blocking — it may still be loading)
    _ensure_vector_service()

    # Check if Generator already running
    try:
        r = requests.get(f"http://localhost:{GENERATOR_PORT}", timeout=2)
        if r.status_code < 500:
            return jsonify({"url": f"http://localhost:{GENERATOR_PORT}"})
    except Exception:
        pass  # Not running — start it

    # Start server.js in background
    node_candidates = [
        "node",
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/Users/I560320/.nvm/versions/node/v20.20.2/bin/node",
    ]
    node_bin = None
    for candidate in node_candidates:
        try:
            subprocess.run([candidate, "--version"], capture_output=True, timeout=3)
            node_bin = candidate
            break
        except Exception:
            continue

    if not node_bin:
        return jsonify({"error": "Node.js not found. Please install Node.js to use the Guideline Generator."}), 500

    server_js = GENERATOR_DIR / "server.js"
    if not server_js.exists():
        return jsonify({"error": f"Guideline Generator not found at {GENERATOR_DIR}"}), 500

    subprocess.Popen(
        [node_bin, str(server_js)],
        cwd=str(GENERATOR_DIR),
        stdout=open("/tmp/guideline_generator.log", "w"),
        stderr=subprocess.STDOUT,
    )

    # Wait up to 10 seconds for Generator to become available
    for _ in range(10):
        time.sleep(1)
        try:
            r = requests.get(f"http://localhost:{GENERATOR_PORT}", timeout=1)
            if r.status_code < 500:
                return jsonify({"url": f"http://localhost:{GENERATOR_PORT}"})
        except Exception:
            continue

    return jsonify({"error": "Guideline Generator started but did not respond in time. Try again."}), 504


@app.route("/chat_edi", methods=["POST"])
def chat_edi():
    """
    EDI conversion endpoint for Guideline Generator.
    Accepts { api_key, base_url, cxml, doc_type, format } and runs a full
    tool-call loop (get_sap_page) to convert cXML to EDI using the same
    logic as the web chat interface.
    Returns { segments: [{segment, description}, ...] } or { error: ... }.
    """
    data = request.json
    api_key = (data.get("api_key") or "").strip()
    base_url = (data.get("base_url") or "").strip().rstrip("/")
    cxml = (data.get("cxml") or "").strip()
    doc_type = (data.get("doc_type") or "").strip()   # PO | OC | ASN | Invoice | GR
    edi_format = (data.get("format") or "X12").strip()  # X12 | EDIFACT

    import time as _time
    _req_id = f"guideline-{int(_time.time()*1000) % 100000}"
    print(f"[chat_edi] {_req_id} doc_type={doc_type} format={edi_format} cxml_len={len(cxml)}", flush=True)

    if not api_key:
        return jsonify({"error": "api_key is required"}), 400
    if not base_url:
        return jsonify({"error": "base_url is required"}), 400
    if not cxml:
        return jsonify({"error": "cxml is required"}), 400

    # Determine transaction set from doc_type + cXML content
    tx_set = None
    if edi_format == "X12":
        if doc_type == "OC" or "<ConfirmationRequest" in cxml:
            tx_set = "855"
        elif doc_type == "ASN" or "<ShipNoticeRequest" in cxml:
            tx_set = "856"
        elif doc_type == "Invoice" or "<InvoiceDetailRequest" in cxml:
            tx_set = "810"
        elif doc_type == "PO" or "<OrderRequest" in cxml:
            # Distinguish 850 vs 860
            m = re.search(r'OrderRequest[^>]*\btype=["\'](\w+)["\']', cxml)
            order_type = m.group(1).lower() if m else "new"
            tx_set = "850" if order_type == "new" else "860"

    # Pre-load spec into cache and inject into system prompt so AI skips get_sap_page calls
    spec_injection = ""
    if tx_set:
        spec_text = get_spec_text(tx_set)
        if spec_text:
            doc_name = _SPEC_DOC_MAP[tx_set][0]
            spec_injection = (
                f"\n\n---\n**EDI SPEC PRE-LOADED (do NOT call get_sap_page for this spec — it is already below):**\n"
                f"Spec read: {doc_name}, all parts\n\n"
                f"{spec_text}\n---\n"
            )
            print(f"[spec_cache] Injecting cached spec for tx_set={tx_set} ({doc_name})")
        else:
            print(f"[spec_cache] No cached spec for tx_set={tx_set}, AI will fetch via get_sap_page")

    # Spec injected into user message (not system prompt) so only the relevant spec is sent per request
    if spec_injection:
        user_message = (
            f"Please convert the following cXML to {edi_format} EDI.\n"
            f"Document type: {doc_type}\n\n"
            f"EDI spec (pre-loaded — do NOT call get_sap_page for this spec):\n"
            f"{spec_injection}\n\n"
            f"cXML:\n{cxml}"
        )
    else:
        user_message = (
            f"Please convert the following cXML to {edi_format} EDI.\n"
            f"Document type: {doc_type}\n\n"
            f"cXML:\n{cxml}"
        )

    messages = [{"role": "user", "content": user_message}]

    api_url = base_url + "/anthropic/v1/messages"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }

    try:
        current_messages = list(messages)
        full_reply = ""

        while True:
            payload = {
                "model": "anthropic--claude-sonnet-latest",
                "max_tokens": 16000,
                "system": SYSTEM_PROMPT,
                "tools": TOOLS,
                "messages": current_messages,
                "stream": True
            }
            resp = requests.post(api_url, headers=headers, json=payload,
                                 timeout=600, stream=True)
            if not resp.ok:
                return jsonify({"error": f"API error {resp.status_code}: {resp.text[:200]}"}), 502

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
                        if idx < len(assistant_content):
                            assistant_content[idx]["text"] += chunk
                    elif delta.get("type") == "input_json_delta":
                        if idx < len(assistant_content):
                            assistant_content[idx]["input"] += delta.get("partial_json", "")

                elif etype == "message_delta":
                    stop_reason = event.get("delta", {}).get("stop_reason")

            tool_uses = [b for b in assistant_content if b.get("type") == "tool_use"]
            if not tool_uses or stop_reason == "end_turn":
                break

            # Parse tool inputs and execute
            for tu in assistant_content:
                if tu.get("type") == "tool_use":
                    try:
                        tu["input"] = json.loads(tu["input"]) if isinstance(tu["input"], str) else tu["input"]
                    except Exception:
                        tu["input"] = {}

            current_messages.append({"role": "assistant", "content": assistant_content})

            tool_results = []
            for tu in tool_uses:
                result_text = run_tool(tu["name"], tu.get("input", {}))
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tu["id"],
                    "content": result_text
                })
            current_messages.append({"role": "user", "content": tool_results})

        # Extract edi_excel JSON block from the final reply
        m = re.search(r'```(?:json)?\s*(\{"edi_excel"\s*:)', full_reply)
        json_start = m.start(1) if m else None
        if json_start is None:
            m = re.search(r'(\{"edi_excel"\s*:)', full_reply)
            json_start = m.start(1) if m else None

        if json_start is None:
            # Fallback: try edi_segments key (generator format)
            m = re.search(r'```(?:json)?\s*(\{"edi_segments"\s*:)', full_reply)
            json_start = m.start(1) if m else None
            if json_start is None:
                m = re.search(r'(\{"edi_segments"\s*:)', full_reply)
                json_start = m.start(1) if m else None
            if json_start is not None:
                decoder = json.JSONDecoder()
                parsed, _ = decoder.raw_decode(full_reply, json_start)
                segments = parsed.get("edi_segments", [])
                print(f"[chat_edi] {_req_id} SUCCESS(edi_segments) segments={len(segments)}", flush=True)
                return jsonify({"segments": segments})

        if json_start is not None:
            decoder = json.JSONDecoder()
            parsed, _ = decoder.raw_decode(full_reply, json_start)
            rows = parsed.get("edi_excel", [])
            print(f"[chat_edi] {_req_id} SUCCESS segments={len(rows)}", flush=True)
            return jsonify({"segments": rows})

        print(f"[chat_edi] {_req_id} FAILED no structured result, stop_reason={stop_reason!r}, raw_len={len(full_reply)}, raw[:500]={full_reply[:500]!r}", flush=True)
        return jsonify({"error": "EDI conversion did not return a structured result", "raw": full_reply[:2000]}), 500

    except requests.exceptions.Timeout:
        return jsonify({"error": "EDI conversion timed out"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/chat_edi_check", methods=["POST"])
def chat_edi_check():
    """
    EDI strict verification endpoint for Guideline Generator.
    Accepts:
      {
        api_key:   str,
        base_url:  str,
        segments:  [{ segment: str, description: str }, ...],
        doc_type:  str   -- 'PO' | 'OC' | 'ASN' | 'Invoice' | 'GR'
        format:    str   -- 'X12' | 'EDIFACT'
      }
    Runs MODE:CHECK logic against the EDI segments using the pre-loaded spec.
    Returns:
      {
        issues:          [str],          -- list of confirmed issue descriptions
        issue_count:     int,
        corrected:       [{ segment, description }],  -- full corrected segment list
        check_summary:   str             -- final summary line from AI
      }
    """
    data = request.json
    api_key  = (data.get("api_key") or "").strip()
    base_url = (data.get("base_url") or "").strip().rstrip("/")
    segments = data.get("segments") or []
    doc_type = (data.get("doc_type") or "").strip()
    edi_format = (data.get("format") or "X12").strip()

    if not api_key:
        return jsonify({"error": "api_key is required"}), 400
    if not base_url:
        return jsonify({"error": "base_url is required"}), 400
    if not segments:
        return jsonify({"error": "segments is required"}), 400

    # Determine transaction set
    tx_set = None
    if edi_format == "X12":
        tx_map = {"OC": "855", "ASN": "856", "Invoice": "810", "PO": "850", "GR": "861"}
        tx_set = tx_map.get(doc_type)
        # Detect 860 from BCH segment presence
        if tx_set == "850":
            # segments may be list of str or list of {segment:...} objects
            seg_strings = [s if isinstance(s, str) else s.get("segment", "") for s in segments]
            if any(s.startswith("BCH") for s in seg_strings):
                tx_set = "860"

    # Pre-load spec
    spec_injection = ""
    if tx_set and tx_set in _SPEC_DOC_MAP:
        spec_text = get_spec_text(tx_set)
        if spec_text:
            doc_name = _SPEC_DOC_MAP[tx_set][0]
            spec_injection = (
                f"\n\n---\n**EDI SPEC PRE-LOADED (do NOT call get_sap_page for this spec):**\n"
                f"Spec: {doc_name}, all parts\n\n{spec_text}\n---\n"
            )

    # Rebuild EDI text with description column for the AI to check
    # Format: two-column — left: segment string, right: description (if any)
    edi_lines = []
    for s in segments:
        if isinstance(s, str):
            seg_str, desc = s, ""
        else:
            seg_str = s.get("segment", "")
            desc    = s.get("description", "")
        if desc:
            edi_lines.append(f"{seg_str}\t[DESC: {desc}]")
        else:
            edi_lines.append(seg_str)
    edi_text = "\n".join(edi_lines)

    user_message = (
        f"Please perform a strict EDI check on the following {edi_format} message.\n"
        f"Document type: {doc_type}\n\n"
        f"Apply the full MODE:CHECK checklist (structure, syntax, mandatory fields, "
        f"enumerated values, Not Used fields, conditional fields, segment counts, "
        f"description accuracy). Every finding must cite the spec.\n\n"
        f"OUTPUT RULES:\n"
        f"- Report ONLY segments that have actual issues. For each issue: state the segment, "
        f"the problem, the spec reference, and the corrected value.\n"
        f"- Do NOT list segments that are correct. If a segment passes all checks, skip it entirely.\n"
        f"- End your findings with exactly one summary line: '❌ N issue(s) found' or '✅ No issues found'.\n"
        f"- Then output ONLY the corrected segments (those you changed) as a JSON block — "
        f"do NOT include unchanged segments:\n"
        f'{{"edi_corrections": [{{"segment": "corrected segment string", "original": "original segment string", "description": "..."}}, ...]}}\n'
        f"If there are no corrections, output: {{\"edi_corrections\": []}}\n"
        f"CORRECTION RULES:\n"
        f"- Do NOT rewrite or regenerate any segment beyond the specific field being fixed.\n"
        f"- The \"original\" field must be copied verbatim from the input — character for character.\n"
        f"- Only change the exact element/field that has the confirmed issue. All other fields in the segment stay identical.\n\n"
    )
    if spec_injection:
        user_message += f"EDI spec (pre-loaded):\n{spec_injection}\n\n"
    user_message += f"EDI message to check:\n{edi_text}"

    messages = [{"role": "user", "content": user_message}]
    api_url  = base_url + "/anthropic/v1/messages"
    headers  = {
        "Authorization": f"Bearer {api_key}",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }

    try:
        current_messages = list(messages)
        full_reply = ""

        while True:
            payload = {
                "model": "anthropic--claude-sonnet-latest",
                "max_tokens": 32000,
                "system": SYSTEM_PROMPT,
                "tools": TOOLS,
                "messages": current_messages,
                "stream": True
            }

            tool_uses = [b for b in assistant_content if b.get("type") == "tool_use"]
            if not tool_uses or stop_reason == "end_turn":
                break

            for tu in assistant_content:
                if tu.get("type") == "tool_use":
                    try:
                        tu["input"] = json.loads(tu["input"]) if isinstance(tu["input"], str) else tu["input"]
                    except Exception:
                        tu["input"] = {}

            current_messages.append({"role": "assistant", "content": assistant_content})
            tool_results = []
            for tu in tool_uses:
                result_text = run_tool(tu["name"], tu.get("input", {}))
                tool_results.append({"type": "tool_result", "tool_use_id": tu["id"], "content": result_text})
            current_messages.append({"role": "user", "content": tool_results})

        # Extract issues: only lines that start with ❌
        issues = []
        check_summary = ""
        for line in full_reply.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith("✅ No issues") or re.match(r"[❌✅]\s*\d+\s*issue", stripped):
                check_summary = stripped
            elif stripped.startswith("❌"):
                issues.append(stripped)

        # Extract corrected segments (patch list — only changed segments)
        corrected_patches = []
        corrected_failed  = False
        m = re.search(r'```(?:json)?\s*(\{"edi_corrections"\s*:)', full_reply)
        json_start = m.start(1) if m else None
        if json_start is None:
            m = re.search(r'(\{"edi_corrections"\s*:)', full_reply)
            json_start = m.start(1) if m else None
        if json_start is not None:
            try:
                decoder = json.JSONDecoder()
                parsed, _ = decoder.raw_decode(full_reply, json_start)
                corrected_patches = parsed.get("edi_corrections", [])
            except Exception:
                corrected_failed = True
        elif issues:
            # AI reported issues but no corrections JSON found — likely truncated
            corrected_failed = True

        # Apply patches to original segment list
        if corrected_patches:
            # Build lookup: original segment string → corrected entry
            patch_map = {}
            for p in corrected_patches:
                orig = p.get("original", "").strip()
                if orig:
                    patch_map[orig] = p
            corrected_segments = []
            for s in segments:
                seg_str = s if isinstance(s, str) else s.get("segment", "")
                desc    = "" if isinstance(s, str) else s.get("description", "")
                if seg_str.strip() in patch_map:
                    p = patch_map[seg_str.strip()]
                    corrected_segments.append({
                        "segment":     p.get("segment", seg_str),
                        "description": p.get("description", desc),
                    })
                else:
                    corrected_segments.append({
                        "segment":     seg_str,
                        "description": desc,
                    })
        else:
            corrected_segments = [
                {"segment": (s if isinstance(s, str) else s.get("segment", "")),
                 "description": ("" if isinstance(s, str) else s.get("description", ""))}
                for s in segments
            ]

        return jsonify({
            "issues":           issues,
            "issue_count":      len(issues),
            "corrected":        corrected_segments,
            "corrected_failed": corrected_failed,
            "check_summary":    check_summary,
            "raw_reply":        full_reply[:3000]
        })

    except requests.exceptions.Timeout:
        return jsonify({"error": "EDI check timed out"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500




@app.route("/chat_edi_correct", methods=["POST"])
def chat_edi_correct():
    """
    EDI correction-only endpoint — called when chat_edi_check's JSON extraction failed.
    Accepts:
      {
        api_key:   str,
        base_url:  str,
        segments:  [{ segment: str, description: str }, ...],
        issues:    [str],   -- issue descriptions from the prior check
        doc_type:  str,
        format:    str
      }
    Returns: { corrected: [{ segment, description }], corrected_failed: bool }
    """
    data = request.json
    api_key    = (data.get("api_key") or "").strip()
    base_url   = (data.get("base_url") or "").strip().rstrip("/")
    segments   = data.get("segments") or []
    issues     = data.get("issues") or []
    doc_type   = (data.get("doc_type") or "").strip()
    edi_format = (data.get("format") or "X12").strip()

    if not api_key or not base_url or not segments:
        return jsonify({"error": "api_key, base_url and segments are required"}), 400

    edi_lines = []
    for s in segments:
        seg_str = s if isinstance(s, str) else s.get("segment", "")
        desc    = "" if isinstance(s, str) else s.get("description", "")
        edi_lines.append(f"{seg_str}\t[DESC: {desc}]" if desc else seg_str)
    edi_text = "\n".join(edi_lines)

    issues_text = "\n".join(f"- {i}" for i in issues) if issues else "(see EDI above)"

    user_message = (
        f"The following {edi_format} {doc_type} EDI message has already been checked. "
        f"These confirmed issues were found:\n{issues_text}\n\n"
        f"Apply ONLY these corrections to the EDI below. Rules:\n"
        f"- Do NOT rewrite or regenerate any segment beyond the specific field being fixed.\n"
        f"- The \"original\" field must be copied verbatim from the input.\n"
        f"- Only change the exact element/field that has the confirmed issue.\n"
        f"- Output ONLY the JSON block, no explanation:\n"
        f'{{"edi_corrections": [{{"segment": "corrected string", "original": "original string", "description": "..."}}, ...]}}\n'
        f"If nothing needs changing: {{\"edi_corrections\": []}}\n\n"
        f"EDI:\n{edi_text}"
    )

    messages = [{"role": "user", "content": user_message}]
    api_url  = base_url + "/anthropic/v1/messages"
    headers  = {
        "Authorization": f"Bearer {api_key}",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }

    try:
        payload = {
            "model": "anthropic--claude-sonnet-latest",
            "max_tokens": 16000,
            "system": SYSTEM_PROMPT,
            "tools": TOOLS,
            "messages": messages,
            "stream": True
        }
        resp = requests.post(api_url, headers=headers, json=payload, timeout=300, stream=True)
        if not resp.ok:
            return jsonify({"error": f"API error {resp.status_code}"}), 502

        full_reply = ""
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
            if event.get("type") == "content_block_delta":
                delta = event.get("delta", {})
                if delta.get("type") == "text_delta":
                    full_reply += delta.get("text", "")

        # Extract edi_corrections JSON
        corrected_patches = []
        corrected_failed  = False
        m = re.search(r'```(?:json)?\s*(\{"edi_corrections"\s*:)', full_reply)
        json_start = m.start(1) if m else None
        if json_start is None:
            m = re.search(r'(\{"edi_corrections"\s*:)', full_reply)
            json_start = m.start(1) if m else None
        if json_start is not None:
            try:
                decoder = json.JSONDecoder()
                parsed, _ = decoder.raw_decode(full_reply, json_start)
                corrected_patches = parsed.get("edi_corrections", [])
            except Exception:
                corrected_failed = True
        else:
            corrected_failed = True

        # Apply patches
        if corrected_patches:
            patch_map = {p.get("original", "").strip(): p for p in corrected_patches}
            corrected_segments = []
            for s in segments:
                seg_str = s if isinstance(s, str) else s.get("segment", "")
                desc    = "" if isinstance(s, str) else s.get("description", "")
                if seg_str.strip() in patch_map:
                    p = patch_map[seg_str.strip()]
                    corrected_segments.append({
                        "segment":     p.get("segment", seg_str),
                        "description": p.get("description", desc),
                    })
                else:
                    corrected_segments.append({
                        "segment":     seg_str,
                        "description": desc,
                    })
        else:
            corrected_segments = [
                {"segment": (s if isinstance(s, str) else s.get("segment", "")),
                 "description": ("" if isinstance(s, str) else s.get("description", ""))}
                for s in segments
            ]

        return jsonify({"corrected": corrected_segments, "corrected_failed": corrected_failed})

    except requests.exceptions.Timeout:
        return jsonify({"error": "Correction timed out"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def chat_hints():
    """
    cXML hint resolver endpoint for Guideline Generator.
    Accepts:
      {
        subtype_info:    { docType, subType, chapters, notes },
        triggered_rules: [{ rule_id, rule_text }, ...],
        cxml_content:    "<cXML>...",
        language:        "en" | "zh" | "ja"
      }
    Uses SAP Help MCP (get_sap_page) to look up the exact cXML element/attribute
    for each triggered rule, matched against the actual uploaded cXML structure.
    Returns:
      { hints: { ruleId: "cxmlHintString", ... } }
    """
    data = request.json
    subtype_info    = data.get("subtype_info", {})
    triggered_rules = data.get("triggered_rules", [])
    cxml_content    = (data.get("cxml_content") or "").strip()
    language        = (data.get("language") or "en").strip()

    if not triggered_rules:
        return jsonify({"hints": {}})
    if not cxml_content:
        return jsonify({"error": "cxml_content is required"}), 400

    # API credentials: prefer request body (passed by Generator), fall back to env
    api_key  = (data.get("api_key") or os.environ.get("EDI_API_KEY", "")).strip()
    base_url = (data.get("base_url") or os.environ.get("EDI_BASE_URL", "http://localhost:6655")).strip().rstrip("/")

    if not api_key:
        return jsonify({"error": "api_key is required (pass in request body or set EDI_API_KEY env)"}), 400

    # Build prompt
    doc_type  = subtype_info.get("docType", "")
    sub_type  = subtype_info.get("subType", "")
    chapters  = subtype_info.get("chapters", [])
    notes     = subtype_info.get("notes", "")

    rules_text = "\n".join(
        f"- {r['rule_id']}: {r['rule_text']}" for r in triggered_rules
    )
    chapters_text = "\n".join(f"  * {c}" for c in chapters)

    user_message = f"""You are helping build an SAP Business Network Integration Guideline.

Document type: {sub_type} ({doc_type})
Structural notes: {notes}

Relevant SAP Help documentation chapters to consult:
{chapters_text}

The following transaction rules have been set to YES by the buyer.
For each rule, find the exact cXML element or attribute where this requirement applies,
based on the SAP cXML Solutions Guide and cXML Reference Guide.

Then cross-reference with the actual cXML sample below to confirm the element exists
and identify its exact path/attribute in this specific document.

Rules to resolve:
{rules_text}

Actual cXML sample:
```xml
{cxml_content[:8000]}
```

Return ONLY a JSON object in this exact format (no explanation, no markdown, just JSON):
{{"hints": {{
  "RULE_ID_1": "ExactElement@attribute=value or ElementPath",
  "RULE_ID_2": "ExactElement@attribute=value or ElementPath",
  ...
}}}}

Use the shortest unambiguous path. Examples:
- "TaxDetail@category" (not full path if element name is unique)
- "InvoicePartner/Contact@role=remitTo" (when role distinguishes InvoicePartner instances)
- "ConfirmationStatus@deliveryDate" (attribute on element)
- "ShipNoticeHeader@packingSlipID" (attribute match)

If a rule applies to multiple elements in the document (e.g. both header and line level),
return the most specific path. If the element is not found in the sample cXML,
still return the canonical path from the SAP documentation.
"""

    messages = [{"role": "user", "content": user_message}]
    api_url  = base_url + "/anthropic/v1/messages"
    headers  = {
        "Authorization": f"Bearer {api_key}",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }

    try:
        current_messages = list(messages)
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
            resp = requests.post(api_url, headers=headers, json=payload,
                                 timeout=300, stream=True)
            if not resp.ok:
                return jsonify({"error": f"API error {resp.status_code}: {resp.text[:200]}"}), 502

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
                        if idx < len(assistant_content):
                            assistant_content[idx]["text"] += chunk
                    elif delta.get("type") == "input_json_delta":
                        if idx < len(assistant_content):
                            assistant_content[idx]["input"] += delta.get("partial_json", "")

                elif etype == "message_delta":
                    stop_reason = event.get("delta", {}).get("stop_reason")

            tool_uses = [b for b in assistant_content if b.get("type") == "tool_use"]
            if not tool_uses or stop_reason == "end_turn":
                break

            for tu in assistant_content:
                if tu.get("type") == "tool_use":
                    try:
                        tu["input"] = json.loads(tu["input"]) if isinstance(tu["input"], str) else tu["input"]
                    except Exception:
                        tu["input"] = {}

            current_messages.append({"role": "assistant", "content": assistant_content})

            tool_results = []
            for tu in tool_uses:
                result_text = run_tool(tu["name"], tu.get("input", {}))
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tu["id"],
                    "content": result_text
                })
            current_messages.append({"role": "user", "content": tool_results})

        # Extract { "hints": { ... } } from reply
        m = re.search(r'\{[\s\S]*"hints"[\s\S]*\}', full_reply)
        if m:
            try:
                parsed = json.loads(m.group(0))
                return jsonify({"hints": parsed.get("hints", {})})
            except Exception:
                pass

        # Fallback: try raw_decode from first {
        brace = full_reply.find('{"hints"')
        if brace >= 0:
            try:
                decoder = json.JSONDecoder()
                parsed, _ = decoder.raw_decode(full_reply, brace)
                return jsonify({"hints": parsed.get("hints", {})})
            except Exception:
                pass

        return jsonify({"error": "hint resolver did not return structured JSON", "raw": full_reply[:2000]}), 500

    except requests.exceptions.Timeout:
        return jsonify({"error": "hint resolver timed out"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500


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

            # ── Spec cache injection for check/verify requests ────────────
            # Extract all text from the latest user message to detect tx_set
            _last_user_text = ""
            for _msg in reversed(current_messages):
                if _msg.get("role") == "user":
                    _content = _msg.get("content", "")
                    if isinstance(_content, list):
                        _last_user_text = " ".join(
                            c.get("text", "") for c in _content if isinstance(c, dict) and c.get("type") == "text"
                        )
                    elif isinstance(_content, str):
                        _last_user_text = _content
                    break
            _tx_set = detect_tx_set(_last_user_text)
            if _tx_set:
                _spec_text = get_spec_text(_tx_set)
                if _spec_text:
                    _doc_name = _SPEC_DOC_MAP[_tx_set][0]
                    _injection = (
                        f"\n\n---\n**EDI SPEC PRE-LOADED (do NOT call get_sap_page for this spec — it is already below):**\n"
                        f"Spec: {_doc_name}\n\n{_spec_text}\n---\n"
                    )
                    # Append injection to the last user message
                    _last = current_messages[-1]
                    if isinstance(_last.get("content"), list):
                        _last["content"].append({"type": "text", "text": _injection})
                    elif isinstance(_last.get("content"), str):
                        _last["content"] += _injection
                    print(f"[spec_cache] Injected spec for tx_set={_tx_set} into /chat request")

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
                    excel_url = None
                    display_reply = full_reply
                    is_edi_reply = bool(re.search(r'\bISA\*', full_reply))

                    # Detect mode tag — only run verify/fix pipeline for CONVERT mode
                    _first_line = full_reply.strip().split("\n")[0].strip()
                    _is_convert_mode = _first_line == "[MODE:CONVERT]"
                    _is_check_mode = _first_line == "[MODE:CHECK]"
                    # If no mode tag but reply has ISA* segments, only treat as convert if it
                    # looks like the AI generated a full EDI (not just quoted a segment in analysis)
                    if not _is_convert_mode and not _is_check_mode:
                        edi_segment_count = len([l for l in full_reply.splitlines()
                                                  if re.match(r'^[A-Z][A-Z0-9]{1,2}\*', l.strip())])
                        _is_convert_mode = edi_segment_count >= 5  # arbitrary threshold: full EDI has many segments

                    # ── EDI post-processing pipeline ──────────────────────────
                    if is_edi_reply and _is_convert_mode:
                        # current_messages already contains the full spec context
                        # (all get_sap_page results from Phase 1 are in the message history)
                        edi_context = current_messages + [
                            {"role": "assistant", "content": [{"type": "text", "text": full_reply}]}
                        ]

                        # Extract the raw EDI text (segments only) for passing to verify/fix
                        edi_lines = [l.strip() for l in full_reply.splitlines()
                                     if re.match(r'^[A-Z][A-Z0-9]{1,2}\*', l.strip())]
                        edi_text = '\n'.join(edi_lines)

                        current_edi = edi_text  # tracks the latest EDI through fix cycles

                        # Detect transaction set and load Extension mapping rules
                        tx_set = detect_tx_set(current_edi)
                        ext_rules = load_edi_rules(tx_set) if tx_set else None
                        rules_summary = build_rules_summary(ext_rules) if ext_rules else ""

                        # ── Log record: initialise ────────────────────────────
                        _log = {
                            "session_id": uuid.uuid4().hex[:8],
                            "tx_set": tx_set or "unknown",
                            "generation_raw": full_reply,        # full AI output incl Phase 1/2/3 text
                            "edi_initial": edi_text,             # segments extracted from generation
                            "verify_round_0": None,              # first verify result
                            "fix_rounds": [],                    # [{fix_prompt, fix_reply, verify_reply, passed}]
                            "edi_final": None,                   # EDI after all fixes
                            "final_passed": None,
                            "excel_generated": False,
                        }

                        def call_nonstream(msgs, prompt_text, max_tokens=2048):
                            """Non-streaming API call in background thread; returns reply text or ''."""
                            result = [None]
                            def _run():
                                try:
                                    p = {
                                        "model": "anthropic--claude-sonnet-latest",
                                        "max_tokens": max_tokens,
                                        "system": SYSTEM_PROMPT,
                                        "messages": msgs + [{"role": "user", "content": [{"type": "text", "text": prompt_text}]}],
                                        "stream": False
                                    }
                                    r = requests.post(api_url, headers=headers, json=p, timeout=300)
                                    if r.ok:
                                        result[0] = "".join(
                                            b.get("text", "") for b in r.json().get("content", [])
                                            if b.get("type") == "text"
                                        )
                                    else:
                                        result[0] = ""
                                except Exception:
                                    result[0] = ""
                            t = threading.Thread(target=_run)
                            t.start()
                            return result, t

                        def wait_with_heartbeat(result, t):
                            """Wait for background API call, yielding SSE heartbeats every 5s."""
                            import time
                            while t.is_alive():
                                t.join(timeout=5)
                                if t.is_alive():
                                    yield ": heartbeat\n\n"
                            return result[0] or ""

                        # ── Step: Verify ──────────────────────────────────────
                        _v_label = "spec"
                        if ext_rules:
                            _v_label = f"spec + Extension rules ({ext_rules.get('transaction','?')})"
                        _v_chunk = json.dumps({"chunk": f"\n\n---\n**⏳ Verifying EDI against {_v_label}…**\n"})
                        yield f"data: {_v_chunk}\n\n"

                        rules_block = (
                            f"\n\n---\n{rules_summary}\n---\n\n"
                            "**Extension cross-check (check #7 — mapping paths only)**: "
                            "The table above shows which cXML element the Extension maps to each EDI segment/position. "
                            "For each segment in the generated EDI, verify: is the source cXML data in the correct EDI segment and position per the Extension mapping?\n"
                            "- If a cXML element ended up in the wrong EDI segment or position vs. Extension: treat as a real issue, include in the fix list.\n"
                            "- If the current mapping matches Extension: note as `[EXT-OK] SegID: mapping matches Extension.`\n"
                            "- Do NOT use the Extension table for enumerated value checks — use only the SAP spec Permitted Codes for that.\n"
                            "- 'The Extension mapped it this way' is not by itself a reason to adopt — verify against the SAP spec first.\n"
                        ) if rules_summary else ""

                        verify_prompt = (
                            "You have already read the EDI spec above in this conversation. "
                            "Using that spec knowledge, verify the EDI segments below for:\n"
                            "1. Every mapped cXML element is present (cross-check against the Excluded Elements list above)\n"
                            "2. Segment syntax: correct element count, M fields all filled, correct delimiters\n"
                            "3. Enumerated values match spec Permitted Codes\n"
                            "4. Loop structure: header segments not repeated inside detail loops, loop counts correct\n"
                            "5. ISA fixed-length padding correct\n"
                            "6. Amount N2 format, UoM codes, timezone codes correct\n"
                            + rules_block +
                            f"\nEDI to verify:\n{current_edi}\n\n"
                            "**CRITICAL output format — your very first line must be one of these two, no preamble, no 'Reading spec', no intro text:**\n"
                            "- If all checks pass (including Extension cross-check): your response must start with exactly "
                            "`✅ Verification passed — no issues found.` on the first line.\n"
                            "- If issues found: your response must start with exactly `❌ Issues found:` on the first line, "
                            "followed by a numbered list. Each item: segment identifier + specific problem + correct value.\n"
                            "Do NOT write any explanation, status update, or 'Running checks' text before the verdict line."
                        )
                        result, t = call_nonstream(edi_context, verify_prompt, max_tokens=2048)
                        yield from wait_with_heartbeat(result, t)
                        verify_reply = result[0] or ""
                        _log["verify_round_0"] = verify_reply

                        # [EXT-OK] items are purely advisory (Extension agrees current value is fine) — not blocking.
                        # All other issues (including Extension-confirmed corrections) are treated as spec failures → fix loop.
                        def _is_spec_failure(reply: str) -> bool:
                            first = reply.strip().split("\n")[0].strip()
                            if first.startswith("✅"):
                                return False
                            if first.startswith("❌"):
                                return True
                            # Neither tag — treat as failure only if reply contains ❌
                            return "❌" in reply

                        passed = not _is_spec_failure(verify_reply)

                        _vr_chunk = json.dumps({"verify_result": verify_reply, "passed": passed})
                        yield f"data: {_vr_chunk}\n\n"

                        # ── Step: Fix loop (max 2 attempts) ──────────────────
                        fix_context = edi_context
                        for fix_round in range(2):
                            if passed:
                                break

                            _f_chunk = json.dumps({"chunk": f"\n\n**⏳ Fixing issues (attempt {fix_round + 1})…**\n"})
                            yield f"data: {_f_chunk}\n\n"

                            fix_prompt = (
                                f"The following issues were found in the EDI:\n{verify_reply}\n\n"
                                f"Current EDI:\n{current_edi}\n\n"
                                "Fix ALL issues listed above. Output the complete corrected EDI only — "
                                "all segments in order, no explanation before or after the EDI. "
                                "Do not change any correctly-mapped segments."
                            )
                            result, t = call_nonstream(fix_context, fix_prompt, max_tokens=8192)
                            yield from wait_with_heartbeat(result, t)
                            fix_reply = result[0] or ""

                            # Extract corrected EDI segments from fix reply
                            fixed_lines = [l.strip() for l in fix_reply.splitlines()
                                           if re.match(r'^[A-Z][A-Z0-9]{1,2}\*', l.strip())]
                            if fixed_lines:
                                current_edi = '\n'.join(fixed_lines)

                            # Re-verify the fixed EDI
                            reverify_prompt = (
                                "Using the spec knowledge already in this conversation, "
                                "re-verify the corrected EDI below against the same checklist "
                                "(checks 1–6 from the spec"
                                + (", plus the Extension cross-check [EXT]" if rules_block else "")
                                + ").\n\n"
                                + (rules_block if rules_block else "")
                                + f"\nCorrected EDI:\n{current_edi}\n\n"
                                "**CRITICAL output format — your very first line must be one of these two, no preamble:**\n"
                                "- If all spec checks pass: `✅ Verification passed — no issues found.`\n"
                                "- If spec issues remain: `❌ Issues found:` followed by numbered list. "
                                "Prefix Extension-only items with [EXT].\n"
                                "Do NOT write any explanation or intro text before the verdict line."
                            )
                            fix_context = fix_context + [
                                {"role": "user", "content": [{"type": "text", "text": fix_prompt}]},
                                {"role": "assistant", "content": [{"type": "text", "text": fix_reply}]}
                            ]
                            result, t = call_nonstream(fix_context, reverify_prompt)
                            yield from wait_with_heartbeat(result, t)
                            verify_reply = result[0] or ""
                            passed = not _is_spec_failure(verify_reply)

                            _log["fix_rounds"].append({
                                "round": fix_round + 1,
                                "issues_going_in": _log["verify_round_0"] if fix_round == 0 else _log["fix_rounds"][-2]["verify_after"] if len(_log["fix_rounds"]) >= 2 else verify_reply,
                                "fix_reply": fix_reply,
                                "verify_after": verify_reply,
                                "passed": passed,
                            })

                            _fr_chunk = json.dumps({
                                "fix_result": fix_reply,
                                "verify_result": verify_reply,
                                "passed": passed,
                                "round": fix_round + 1
                            })
                            yield f"data: {_fr_chunk}\n\n"

                        _log["edi_final"] = current_edi
                        _log["final_passed"] = passed
                        if not passed:
                            _warn = json.dumps({"chunk": "\n\n⚠️ **Verification could not fully pass after 2 fix attempts — please review manually.**\n"})
                            yield f"data: {_warn}\n\n"

                        # ── Step: Generate Excel from final EDI ───────────────
                        _ex_chunk = json.dumps({"chunk": "\n\n**⏳ Generating Excel…**\n"})
                        yield f"data: {_ex_chunk}\n\n"

                        excel_prompt = (
                            "Output ONLY the edi_excel JSON block for the following EDI. "
                            "No explanation, no other text.\n\n"
                            f"EDI:\n{current_edi}\n\n"
                            "Format:\n"
                            "```json\n"
                            '{"edi_excel": [{"segment": "...", "description": ""}, ...]}\n'
                            "```\n"
                            "For segments that had a `<!-- B: ... -->` description in the original cXML, "
                            "include the description. All others use empty string."
                        )
                        # Use edi_context directly (spec content already present)
                        result, t = call_nonstream(edi_context, excel_prompt, max_tokens=8192)
                        yield from wait_with_heartbeat(result, t)
                        excel_reply = result[0] or ""

                        m_ex = re.search(r'```(?:json)?\s*(\{"edi_excel"\s*:)', excel_reply)
                        ex_start = m_ex.start(1) if m_ex else None
                        if ex_start is None:
                            m_ex = re.search(r'(\{"edi_excel"\s*:)', excel_reply)
                            ex_start = m_ex.start(1) if m_ex else None
                        if ex_start is not None:
                            try:
                                ex_data, _ = json.JSONDecoder().raw_decode(excel_reply, ex_start)
                                ex_rows = ex_data.get("edi_excel", [])
                                if ex_rows:
                                    filename = build_excel(fix_se_count(ex_rows))
                                    excel_url = f"/download_excel/{filename}"
                                    _log["excel_generated"] = True
                            except Exception:
                                pass

                        # ── Write log record ──────────────────────────────────
                        _write_edi_log(_log)

                    # ── Non-EDI reply: strip any stray edi_excel block ────────
                    else:
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
                                    filename = build_excel(fix_se_count(rows))
                                    excel_url = f"/download_excel/{filename}"
                            except Exception:
                                pass
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
    # Start Joule SSE connector in background
    if sys.platform == "win32":
        _start_script = BASE_DIR / "start-joule-connector.bat"
        if _start_script.exists():
            subprocess.Popen(["cmd", "/c", str(_start_script)],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        _start_script = BASE_DIR / "start-joule-connector.sh"
        if _start_script.exists():
            subprocess.Popen(["bash", str(_start_script)],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    app.run(host="0.0.0.0", port=5001, debug=False)
