"""
SAP Help Semantic Search
Called by index.js (MCP) and web-app/app.py with a query string.
Returns top-N matching document URLs and excerpts as JSON.

Usage:
    python3 semantic_search.py "your query here" [--n 5] [--scope SBN|BNL]
"""

import sys
import json
import os
import argparse

import re
import chromadb
from sentence_transformers import SentenceTransformer

DB_DIR = os.path.join(os.path.dirname(__file__), "chroma_db")
COLLECTION_NAME = "sap_docs"
MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"

_model = None
_collection = None


def _load():
    global _model, _collection
    if _model is None:
        _model = SentenceTransformer(MODEL_NAME, local_files_only=True)
    if _collection is None:
        client = chromadb.PersistentClient(path=DB_DIR)
        _collection = client.get_collection(COLLECTION_NAME)


def _normalize_url(url: str) -> str:
    """Strip version timestamps like ' 16.26.00' or ' 16.25.59' from URLs."""
    return re.sub(r'\s+\d{2}\.\d{2}\.\d{2}(?=\.pdf)', '', url)


def search(query: str, n: int = 5, scope: str = None) -> list[dict]:
    """
    Search for documents semantically similar to query.
    Returns list of {url, title, excerpt, score}.
    """
    _load()

    embedding = _model.encode(query).tolist()

    where = None
    if scope == "SBN":
        where = {"url": {"$contains": "file://SBN/"}}
    elif scope == "BNL":
        where = {"url": {"$contains": "file://api-specs/"}}

    query_kwargs = {
        "query_embeddings": [embedding],
        "n_results": n * 3,  # fetch more, then deduplicate by URL
        "include": ["metadatas", "documents", "distances"],
    }
    if where:
        query_kwargs["where"] = where

    results = _collection.query(**query_kwargs)

    # Deduplicate: keep best-scoring chunk per normalized URL
    seen_urls = {}
    for i, meta in enumerate(results["metadatas"][0]):
        url = _normalize_url(meta["url"])
        distance = results["distances"][0][i]
        score = 1 - distance  # cosine: higher = more similar
        doc_text = results["documents"][0][i]

        if url not in seen_urls or score > seen_urls[url]["score"]:
            seen_urls[url] = {
                "url": url,
                "title": meta.get("title", ""),
                "excerpt": doc_text[:400].replace("\n", " ").strip(),
                "score": round(score, 4),
            }

    # Sort by score descending, return top n
    top = sorted(seen_urls.values(), key=lambda x: x["score"], reverse=True)[:n]
    return top


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("query", help="Search query")
    parser.add_argument("--n", type=int, default=5, help="Number of results")
    parser.add_argument("--scope", default=None, help="SBN or BNL")
    args = parser.parse_args()

    results = search(args.query, n=args.n, scope=args.scope)
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
