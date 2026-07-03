"""
SAP Help Search Index Builder
Builds a semantic search index from cache.json for faster and more accurate
multilingual document retrieval (English, Chinese, Japanese).

Run this once after installation, and again after any git pull that updates documents.
"""

import json
import hashlib
import os
import sys
import time
import re

import chromadb
from sentence_transformers import SentenceTransformer

CACHE_FILE = os.path.join(os.path.dirname(__file__), "cache.json")
DB_DIR = os.path.join(os.path.dirname(__file__), "chroma_db")
COLLECTION_NAME = "sap_docs"
MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"

CHUNK_SIZE = 400      # target characters per chunk
CHUNK_OVERLAP = 50    # overlap between chunks to avoid cutting mid-sentence
BATCH_SIZE = 64       # number of chunks to embed at once


def split_into_chunks(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    """Split text into overlapping chunks, preferring paragraph boundaries."""
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]

    chunks = []
    current = ""

    for para in paragraphs:
        if len(current) + len(para) + 2 <= chunk_size:
            current = (current + "\n\n" + para).strip()
        else:
            if current:
                chunks.append(current)
            # If a single paragraph is too long, split it further by sentences
            if len(para) > chunk_size:
                sentences = re.split(r"(?<=[.!?])\s+", para)
                sub = ""
                for sent in sentences:
                    if len(sub) + len(sent) + 1 <= chunk_size:
                        sub = (sub + " " + sent).strip()
                    else:
                        if sub:
                            chunks.append(sub)
                        sub = sent
                if sub:
                    # carry overlap from last sub-chunk into next paragraph
                    current = sub[-overlap:].strip() if len(sub) > overlap else sub
                else:
                    current = ""
            else:
                # carry overlap from last chunk
                tail = current[-overlap:].strip() if len(current) > overlap else current
                current = (tail + "\n\n" + para).strip() if tail else para

    if current:
        chunks.append(current)

    return chunks if chunks else [text[:chunk_size]]


def content_hash(text):
    return hashlib.md5(text.encode()).hexdigest()


def is_json_content(text):
    return text.strip().startswith("{") or text.strip().startswith("[")


def split_json_into_chunks(title, content, chunk_size=CHUNK_SIZE):
    """Split JSON API spec into chunks by top-level sections (paths + definitions)."""
    chunks = []
    try:
        data = json.loads(content)
    except Exception:
        # Not valid JSON — fall back to text chunking
        return split_into_chunks(f"{title}\n\n{content}")

    # Chunk 1: overview (info + description)
    info = data.get("info", {})
    overview_parts = [title]
    if info.get("description"):
        overview_parts.append(info["description"])
    chunks.append("\n\n".join(overview_parts))

    # Chunk per endpoint (path + method)
    paths = data.get("paths", {})
    for path, methods in paths.items():
        for method, spec in methods.items():
            if not isinstance(spec, dict):
                continue
            parts = [f"{title}", f"Endpoint: {method.upper()} {path}"]
            if spec.get("summary"):
                parts.append(f"Summary: {spec['summary']}")
            if spec.get("description"):
                parts.append(f"Description: {spec['description']}")
            # Parameters
            params = spec.get("parameters", [])
            if params:
                param_lines = ["Parameters:"]
                for p in params:
                    if isinstance(p, dict):
                        pname = p.get("name", "")
                        pdesc = p.get("description", "")
                        prequired = "required" if p.get("required") else "optional"
                        param_lines.append(f"  - {pname} ({prequired}): {pdesc[:200]}")
                parts.append("\n".join(param_lines))
            chunks.append("\n\n".join(parts))

    # Chunk per definition/schema (split large ones further)
    definitions = data.get("definitions", data.get("components", {}).get("schemas", {}))
    for def_name, def_spec in definitions.items():
        if not isinstance(def_spec, dict):
            continue
        parts = [f"{title}", f"Schema: {def_name}"]
        if def_spec.get("description"):
            parts.append(f"Description: {def_spec['description']}")
        props = def_spec.get("properties", {})
        if props:
            prop_lines = ["Fields:"]
            for prop_name, prop_spec in props.items():
                if isinstance(prop_spec, dict):
                    desc = prop_spec.get("description", "")[:300]
                    prop_type = prop_spec.get("type", "")
                    enum_vals = prop_spec.get("enum", [])
                    line = f"  - {prop_name}"
                    if prop_type:
                        line += f" ({prop_type})"
                    if desc:
                        line += f": {desc}"
                    if enum_vals:
                        line += f" [values: {', '.join(str(v) for v in enum_vals[:10])}]"
                    prop_lines.append(line)
            chunk_text = "\n\n".join(parts) + "\n" + "\n".join(prop_lines)
            # If still too long, split property list
            if len(chunk_text) <= chunk_size * 3:
                chunks.append(chunk_text)
            else:
                # Split into sub-chunks of ~20 properties each
                for i in range(0, len(prop_lines), 20):
                    sub = "\n\n".join(parts) + "\n" + "\n".join(prop_lines[i:i+20])
                    chunks.append(sub)
        else:
            chunks.append("\n\n".join(parts))

    return chunks if chunks else [f"{title}\n\n{content[:chunk_size]}"]


def main():
    print("SAP Help — Building search index")
    print("=" * 50)

    # Load cache
    print(f"\n[1/4] Loading documents from cache.json...")
    with open(CACHE_FILE, encoding="utf-8") as f:
        cache = json.load(f)
    print(f"      {len(cache)} documents loaded.")

    # Load model
    print(f"\n[2/4] Loading language model ({MODEL_NAME})...")
    print("      (First run will download ~250MB — this is a one-time download)")
    model = SentenceTransformer(MODEL_NAME, local_files_only=True)
    print("      Model ready.")

    # Connect to ChromaDB
    print(f"\n[3/4] Connecting to local search database...")
    client = chromadb.PersistentClient(path=DB_DIR)
    collection = client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"}
    )

    # Get existing hashes to support incremental updates
    existing = {}
    try:
        all_existing = collection.get(include=["metadatas"])
        for meta in all_existing["metadatas"]:
            url = meta.get("url")
            h = meta.get("doc_hash")
            if url and h:
                existing[url] = h
    except Exception:
        pass

    unique_urls_existing = set(existing.keys())

    # Process documents
    print(f"\n[4/4] Indexing documents...")

    urls_in_cache = set(cache.keys())
    urls_to_add = []
    urls_to_update = []
    urls_to_delete = unique_urls_existing - urls_in_cache

    for url, doc in cache.items():
        content = doc.get("content", "")
        h = content_hash(content)
        if url not in existing:
            urls_to_add.append(url)
        elif existing[url] != h:
            urls_to_update.append(url)

    print(f"      New documents:     {len(urls_to_add)}")
    print(f"      Updated documents: {len(urls_to_update)}")
    print(f"      Removed documents: {len(urls_to_delete)}")
    print(f"      Unchanged:         {len(cache) - len(urls_to_add) - len(urls_to_update)}")

    # Delete removed/updated documents
    urls_to_remove = list(urls_to_delete) + urls_to_update
    if urls_to_remove:
        # Delete all chunks belonging to these URLs
        for url in urls_to_remove:
            try:
                results = collection.get(where={"url": url}, include=["metadatas"])
                ids_to_delete = results["ids"]
                if ids_to_delete:
                    collection.delete(ids=ids_to_delete)
            except Exception:
                pass

    # Build chunks for new/updated documents
    urls_to_process = urls_to_add + urls_to_update
    if not urls_to_process:
        print("\n      Nothing to update — index is already up to date.")
        _print_summary(collection)
        return

    all_ids = []
    all_texts = []
    all_metas = []

    for url in urls_to_process:
        doc = cache[url]
        content = doc.get("content", "")
        title = doc.get("title", "")
        h = content_hash(content)

        if is_json_content(content):
            # JSON API specs: split by endpoint and schema definition
            chunks = split_json_into_chunks(title, content)
            for i, chunk in enumerate(chunks):
                chunk_id = hashlib.md5(f"{url}:{i}".encode()).hexdigest()
                all_ids.append(chunk_id)
                all_texts.append(chunk)
                all_metas.append({"url": url, "title": title, "doc_hash": h, "chunk": i})
        else:
            # PDF content: split into chunks
            full_text = f"{title}\n\n{content}" if title else content
            chunks = split_into_chunks(full_text)
            for i, chunk in enumerate(chunks):
                chunk_id = hashlib.md5(f"{url}:{i}".encode()).hexdigest()
                all_ids.append(chunk_id)
                all_texts.append(chunk)
                all_metas.append({"url": url, "title": title, "doc_hash": h, "chunk": i})

    total_chunks = len(all_ids)
    print(f"\n      Processing {len(urls_to_process)} documents → {total_chunks} chunks")
    print(f"      Estimated time: 3 – 10 minutes (depends on your machine)\n")

    # Embed and insert in batches
    start = time.time()
    for i in range(0, total_chunks, BATCH_SIZE):
        batch_ids = all_ids[i:i + BATCH_SIZE]
        batch_texts = all_texts[i:i + BATCH_SIZE]
        batch_metas = all_metas[i:i + BATCH_SIZE]

        embeddings = model.encode(batch_texts, show_progress_bar=False).tolist()
        collection.add(ids=batch_ids, embeddings=embeddings, documents=batch_texts, metadatas=batch_metas)

        done = min(i + BATCH_SIZE, total_chunks)
        pct = done / total_chunks * 100
        elapsed = time.time() - start
        eta = (elapsed / done * (total_chunks - done)) if done > 0 else 0
        bar = "#" * int(pct / 2) + "-" * (50 - int(pct / 2))
        sys.stdout.write(f"\r      [{bar}] {pct:.0f}%  ETA {eta:.0f}s  ")
        sys.stdout.flush()

    print(f"\n\n      Done in {time.time() - start:.0f} seconds.")
    _print_summary(collection)


def _print_summary(collection):
    count = collection.count()
    print(f"\n{'=' * 50}")
    print(f"Index ready — {count} chunks indexed.")
    print(f"Location: {DB_DIR}")
    print(f"{'=' * 50}\n")


if __name__ == "__main__":
    main()
