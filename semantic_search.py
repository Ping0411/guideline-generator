"""
SAP Help Semantic Search
Runs as a persistent HTTP service (--serve) or one-shot CLI.

HTTP mode (used by index.js MCP):
    python3 semantic_search.py --serve [--port 7655]
    POST /search  {"query": "...", "n": 5, "scope": "SBN|BNL"}
    Returns: JSON array of {url, title, excerpt, score}

CLI mode:
    python3 semantic_search.py "your query here" [--n 5] [--scope SBN|BNL]
"""

import sys
import json
import os
import re
import argparse

import chromadb
from sentence_transformers import SentenceTransformer

BASE_DIR = os.path.dirname(__file__)
DB_DIR = os.path.join(BASE_DIR, "chroma_db")
TAGS_FILE = os.path.join(BASE_DIR, "tags.json")
COLLECTION_NAME = "sap_docs"
MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"

_model = None
_collection = None
_tags = None


def _load():
    global _model, _collection, _tags
    if _model is None:
        try:
            _model = SentenceTransformer(MODEL_NAME, local_files_only=True)
        except TypeError:
            # Newer sentence-transformers dropped local_files_only — use cache_folder instead
            import glob as _glob
            _snap = _glob.glob(os.path.expanduser(
                f'~/.cache/huggingface/hub/models--sentence-transformers--{MODEL_NAME}/snapshots/*/config.json'
            ))
            if _snap:
                _local_path = os.path.dirname(_snap[0])
                _model = SentenceTransformer(_local_path)
            else:
                _model = SentenceTransformer(MODEL_NAME)
    if _collection is None:
        client = chromadb.PersistentClient(path=DB_DIR)
        _collection = client.get_collection(COLLECTION_NAME)
    if _tags is None:
        if os.path.exists(TAGS_FILE):
            with open(TAGS_FILE, encoding="utf-8") as f:
                _tags = json.load(f)
        else:
            _tags = {}


def _normalize_url(url: str) -> str:
    return re.sub(r'\s+\d{2}\.\d{2}\.\d{2}(?=\.pdf)', '', url)


def _get_document_key(url: str) -> str:
    return re.sub(r'_Part\d+.*\.pdf$', '', url, flags=re.IGNORECASE)


SCOPE_PREFIXES = {
    "SBN": "file://SBN/",
    "BNL": "file://api-specs/",
}


def search(query: str, n: int = 5, scope: str = None) -> list:
    _load()

    embedding = _model.encode(query).tolist()
    scope_prefix = SCOPE_PREFIXES.get(scope.upper(), None) if scope else None

    # Fetch more candidates to account for post-filter scope reduction
    fetch_n = (n * 4) if scope_prefix else (n * 2)

    results = _collection.query(
        query_embeddings=[embedding],
        n_results=fetch_n,
        include=["metadatas", "documents", "distances"],
    )

    # Deduplicate: keep best-scoring chunk per normalized URL, apply scope filter
    seen_urls = {}
    for i, meta in enumerate(results["metadatas"][0]):
        url = _normalize_url(meta["url"])
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
    keywords = [w for w in query.lower().split() if len(w) > 2]
    for url, item in seen_urls.items():
        doc_key = _get_document_key(url)
        doc_tags = _tags.get(doc_key, {}).get("tags", [])
        tag_hits = sum(1 for k in keywords for t in doc_tags if k in t)
        if tag_hits:
            item["score"] += tag_hits * 0.05

    top = sorted(seen_urls.values(), key=lambda x: x["score"], reverse=True)[:n]
    for item in top:
        item["score"] = round(item["score"], 4)
    return top


def match_rules(candidates: list, targets: list, threshold: float = 0.65) -> list:
    """
    Semantic rule matching for Guideline Generator.

    candidates: list of strings (parsed rule texts from uploaded file, any language)
    targets:    list of {"id": str, "text": str} (ruleRegistry englishText entries)
    threshold:  minimum cosine similarity to count as a match

    Returns: list of {"candidateIndex": int, "targetId": str, "score": float}
             One entry per candidate that matched at least one target.
             Each candidate is matched to its highest-scoring target only.
    """
    _load()
    import numpy as np

    if not candidates or not targets:
        return []

    cand_embeddings = _model.encode(candidates)
    tgt_texts = [t["text"] for t in targets]
    tgt_embeddings = _model.encode(tgt_texts)

    # Cosine similarity matrix: (len(candidates), len(targets))
    cand_norm = cand_embeddings / (np.linalg.norm(cand_embeddings, axis=1, keepdims=True) + 1e-9)
    tgt_norm  = tgt_embeddings  / (np.linalg.norm(tgt_embeddings,  axis=1, keepdims=True) + 1e-9)
    sim_matrix = cand_norm @ tgt_norm.T  # shape: (C, T)

    results = []
    for ci, row in enumerate(sim_matrix):
        best_ti = int(np.argmax(row))
        best_score = float(row[best_ti])
        if best_score >= threshold:
            results.append({
                "candidateIndex": ci,
                "targetId": targets[best_ti]["id"],
                "score": round(best_score, 4),
            })

    return results


def serve(port: int = 7655):
    """Run as a persistent HTTP service."""
    from http.server import BaseHTTPRequestHandler, HTTPServer

    _load()
    print(f"Semantic search service ready on port {port}", flush=True)

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                req = json.loads(body)

                if self.path == "/search":
                    results = search(
                        req.get("query", ""),
                        n=req.get("n", 5),
                        scope=req.get("scope")
                    )
                elif self.path == "/match":
                    results = match_rules(
                        req.get("candidates", []),
                        req.get("targets", []),
                        req.get("threshold", 0.65),
                    )
                else:
                    self.send_response(404)
                    self.end_headers()
                    return

                resp = json.dumps(results, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                err = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(err)

        def log_message(self, format, *args):
            pass  # suppress per-request logs

    HTTPServer(("127.0.0.1", port), Handler).serve_forever()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("query", nargs="?", help="Search query (CLI mode)")
    parser.add_argument("--n", type=int, default=5)
    parser.add_argument("--scope", default=None)
    parser.add_argument("--serve", action="store_true", help="Run as HTTP service")
    parser.add_argument("--port", type=int, default=7655)
    args = parser.parse_args()

    if args.serve:
        serve(args.port)
    else:
        if not args.query:
            parser.error("query is required in CLI mode")
        results = search(args.query, n=args.n, scope=args.scope)
        print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
