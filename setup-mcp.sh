#!/bin/bash
# SAP Help Assistant — MCP version setup (macOS / Linux)
# Run once after cloning. Installs all dependencies and builds the search index.

set -e
cd "$(dirname "$0")"

echo "============================================"
echo "  SAP Help Assistant — MCP Setup"
echo "============================================"
echo ""

# ── Homebrew ──────────────────────────────────────────────────────────────────

echo "[1/5] Checking prerequisites..."
echo ""

if ! command -v brew &>/dev/null; then
  echo "  Homebrew not found. Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [ -f "/opt/homebrew/bin/brew" ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -f "/usr/local/bin/brew" ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  echo "  Homebrew installed."
else
  echo "  Homebrew $(brew --version | head -1) — OK"
fi

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

# ── Python ────────────────────────────────────────────────────────────────────

PYTHON_OK=false
if command -v python3 &>/dev/null; then
  PY_MAJOR=$(python3 --version 2>&1 | sed 's/Python //' | cut -d. -f1)
  PY_MINOR=$(python3 --version 2>&1 | sed 's/Python //' | cut -d. -f2)
  if [ "$PY_MAJOR" -ge 3 ] && [ "$PY_MINOR" -ge 8 ]; then
    echo "  $(python3 --version) — OK"
    PYTHON_OK=true
  else
    echo "  $(python3 --version) is too old (3.8+ required). Upgrading..."
  fi
else
  echo "  Python not found. Installing..."
fi

if [ "$PYTHON_OK" = false ]; then
  brew install python
  echo "  $(python3 --version) — installed."
fi
echo ""

# ── Node.js dependencies ──────────────────────────────────────────────────────

echo "[2/5] Installing Node.js dependencies..."
export PUPPETEER_SKIP_DOWNLOAD=true
npm install --loglevel=error
echo "  Done."
echo ""

# ── Python dependencies ───────────────────────────────────────────────────────

echo "[3/5] Installing Python dependencies..."
python3 -m pip install --quiet chromadb sentence-transformers
echo "  Done."
echo ""

# ── Build semantic search index ───────────────────────────────────────────────

echo "[4/5] Building semantic search index..."
echo "  This downloads the AI model (~250 MB) and indexes all documents."
echo "  Usually takes 10-15 minutes on first run."
echo ""
python3 build_index.py

CURRENT_HASH=$(md5 -q cache.json 2>/dev/null || md5sum cache.json 2>/dev/null | cut -d' ' -f1)
echo "$CURRENT_HASH" > .cache_hash

echo ""
echo "  Index built."
echo ""

# ── Make launch scripts executable ───────────────────────────────────────────

chmod +x Launch.command 2>/dev/null || true

# ── Show MCP registration command ────────────────────────────────────────────

REPO_DIR="$(pwd)"

echo "[5/5] Almost done — one manual step required."
echo ""
echo "  Run the following command to register the MCP server with Claude Code:"
echo ""
echo "  claude mcp add sap-help node \"${REPO_DIR}/index.js\""
echo ""
echo "  (Copy and paste the line above into your terminal)"
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────

echo "============================================"
echo "  Setup complete!"
echo ""
echo "  After running the claude mcp add command,"
echo "  start Claude Code with: claude"
echo "============================================"
