#!/bin/bash
# SAP Help Assistant — Update script (macOS / Linux)
# Run this after the maintainer announces an update.
# Automatically detects whether the search index needs to be rebuilt.

set -e
cd "$(dirname "$0")"

echo "============================================"
echo "  SAP Help Assistant — Update"
echo "============================================"
echo ""

# ── Pull latest changes ───────────────────────────────────────────────────────

echo "[1/4] Pulling latest changes from GitHub..."
git pull
echo ""

# ── Remove macOS quarantine flags ─────────────────────────────────────────────

xattr -cr "Update SAP Help Assistant.command" 2>/dev/null || true
xattr -cr "Launch SAP Help Assistant.app" 2>/dev/null || true

# ── Install / update dependencies ────────────────────────────────────────────

echo "[2/4] Installing / updating dependencies..."
pip3 install -r web-app/requirements.txt --quiet || pip install -r web-app/requirements.txt --quiet || true
echo ""

# ── Check if cache.json changed ───────────────────────────────────────────────

echo "[3/4] Checking if search index needs to be rebuilt..."

HASH_FILE=".cache_hash"
CURRENT_HASH=$(md5 -q cache.json 2>/dev/null || md5sum cache.json 2>/dev/null | cut -d' ' -f1)

if [ -f "$HASH_FILE" ] && [ "$(cat "$HASH_FILE")" = "$CURRENT_HASH" ]; then
  echo "  Documentation cache unchanged — skipping index rebuild."
  echo ""
  echo "============================================"
  echo "  Update complete! No index rebuild needed."
  echo "  Launch the app to use the latest version."
  echo "============================================"
  exit 0
fi

# ── Rebuild index ─────────────────────────────────────────────────────────────

echo "  Documentation cache has changed — rebuilding search index..."
echo "  This takes about 1-2 minutes."
echo ""

echo "[4/4] Building semantic search index..."
python3 build_index.py

# Save new hash only after successful build
echo "$CURRENT_HASH" > "$HASH_FILE"

echo ""
echo "============================================"
echo "  Update complete!"
echo "  Launch the app to use the latest version."
echo "============================================"
