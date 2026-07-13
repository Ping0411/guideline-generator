#!/bin/bash
# SAP Help Assistant — One-time setup script (macOS / Linux)
# Run this once after cloning the repository.
# Takes ~15 minutes on first run (downloads AI model and builds search index).

set -e
cd "$(dirname "$0")"

echo "============================================"
echo "  SAP Help Assistant — Setup"
echo "============================================"
echo ""

# ── Check prerequisites ───────────────────────────────────────────────────────

echo "[1/4] Checking prerequisites..."

if ! command -v node &>/dev/null; then
  echo ""
  echo "  ERROR: Node.js not found."
  echo "  Please install Node.js v18+ from https://nodejs.org and re-run this script."
  exit 1
fi

NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo ""
  echo "  ERROR: Node.js v${NODE_VERSION} is too old. v18 or higher is required."
  echo "  Please update Node.js from https://nodejs.org and re-run this script."
  exit 1
fi

if ! command -v python3 &>/dev/null; then
  echo ""
  echo "  ERROR: Python 3 not found."
  echo "  Please install Python 3.8+ from https://www.python.org and re-run this script."
  exit 1
fi

echo "  Node.js $(node --version) — OK"
echo "  Python $(python3 --version) — OK"
echo ""

# ── Node.js dependencies ──────────────────────────────────────────────────────

echo "[2/4] Installing Node.js dependencies..."
npm install --loglevel=error
echo "  Done."
echo ""

# ── Python dependencies ───────────────────────────────────────────────────────

echo "[3/4] Installing Python dependencies (flask, chromadb, sentence-transformers)..."
echo "  This may take a few minutes..."
python3 -m pip install --quiet flask requests chromadb sentence-transformers
echo "  Done."
echo ""

# ── Build semantic search index ───────────────────────────────────────────────

echo "[4/4] Building semantic search index..."
echo "  This downloads the AI model (~90 MB) and indexes all documents."
echo "  This step takes the longest — usually 10-15 minutes on first run."
echo "  Subsequent runs after 'git pull' take about 1-2 minutes."
echo ""
python3 build_index.py
echo ""
echo "  Index built."
echo ""

# ── Make launch scripts executable ───────────────────────────────────────────

chmod +x Launch.command 2>/dev/null || true

# ── Done ──────────────────────────────────────────────────────────────────────

echo "============================================"
echo "  Setup complete!"
echo ""
echo "  To start SAP Help Assistant:"
echo "  - Open this folder in Finder"
echo "  - Double-click 'Launch SAP Help Assistant.app'"
echo "    (or run: ./Launch.command in this terminal)"
echo ""
echo "  After launch, the web interface opens at:"
echo "  http://localhost:5001"
echo ""
echo "  You can bookmark that URL for quick access."
echo "  Always launch the app first before using the bookmark."
echo "============================================"
