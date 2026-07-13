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

# ── Auto-install Node.js and Python if missing ────────────────────────────────

echo "[1/4] Checking and installing prerequisites..."
echo ""

# ── Homebrew ──────────────────────────────────────────────────────────────────

if ! command -v brew &>/dev/null; then
  echo "  Homebrew not found. Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for Apple Silicon Macs
  if [ -f "/opt/homebrew/bin/brew" ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
  echo "  Homebrew installed."
else
  echo "  Homebrew $(brew --version | head -1) — OK"
fi
echo ""

# ── Node.js ───────────────────────────────────────────────────────────────────

NODE_OK=false
if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -ge 18 ]; then
    echo "  Node.js $(node --version) — OK"
    NODE_OK=true
  else
    echo "  Node.js $(node --version) is too old (v18+ required). Upgrading..."
  fi
else
  echo "  Node.js not found. Installing..."
fi

if [ "$NODE_OK" = false ]; then
  brew install node@20
  brew link node@20 --force --overwrite 2>/dev/null || true
  echo "  Node.js $(node --version) — installed."
fi
echo ""

# ── Python ────────────────────────────────────────────────────────────────────

PYTHON_OK=false
if command -v python3 &>/dev/null; then
  PY_VERSION=$(python3 --version 2>&1 | sed 's/Python //' | cut -d. -f1,2)
  PY_MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
  PY_MINOR=$(echo "$PY_VERSION" | cut -d. -f2)
  if [ "$PY_MAJOR" -ge 3 ] && [ "$PY_MINOR" -ge 8 ]; then
    echo "  Python $(python3 --version) — OK"
    PYTHON_OK=true
  else
    echo "  Python $(python3 --version) is too old (3.8+ required). Upgrading..."
  fi
else
  echo "  Python not found. Installing..."
fi

if [ "$PYTHON_OK" = false ]; then
  brew install python
  echo "  Python $(python3 --version) — installed."
fi
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
echo ""
python3 build_index.py

# Save cache hash so update.sh can skip rebuild if cache hasn't changed
CURRENT_HASH=$(md5 -q cache.json 2>/dev/null || md5sum cache.json 2>/dev/null | cut -d' ' -f1)
echo "$CURRENT_HASH" > .cache_hash

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
