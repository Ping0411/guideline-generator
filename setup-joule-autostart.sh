#!/bin/bash
# SAP Help Assistant — Joule SSE Connector autostart setup (macOS)
# Run once to register the Joule SSE connector as a login item.
# Safe to re-run. Does nothing if Joule Desktop is not installed.

cd "$(dirname "$0")"
REPO_DIR="$(pwd)"
PLIST_LABEL="com.sap.help.joule-connector"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

echo "============================================"
echo "  SAP Help Assistant — Joule Autostart Setup"
echo "============================================"
echo ""

# ── Check Joule Desktop ───────────────────────────────────────────────────────

echo "[1/3] Checking for Joule Desktop..."
if ! find /Applications -maxdepth 1 -name "*Joule*" -type d | grep -q .; then
  echo ""
  echo "  Joule Desktop is not installed on this machine."
  echo "  Skipping autostart setup — nothing to do."
  echo ""
  exit 0
fi
echo "  Joule Desktop found."
echo ""

# ── Find node ─────────────────────────────────────────────────────────────────

echo "[2/3] Locating Node.js..."
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" --no-use 2>/dev/null
NODE_BIN=$(which node 2>/dev/null || ls "$HOME/.nvm/versions/node"/*/bin/node 2>/dev/null | tail -1)

if [ -z "$NODE_BIN" ]; then
  echo "  ERROR: node not found. Please install Node.js first (run setup-mcp.sh)."
  exit 1
fi
echo "  Node.js found at: $NODE_BIN"
echo ""

# ── Write LaunchAgent plist ───────────────────────────────────────────────────

echo "[3/3] Registering autostart..."

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>${REPO_DIR}/index.js</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>MCP_HTTP_PORT</key>
        <string>3456</string>
    </dict>
    <key>WorkingDirectory</key>
    <string>${REPO_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/sap_help_mcp_sse.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/sap_help_mcp_sse.log</string>
</dict>
</plist>
EOF

# Unload first in case it was already registered (re-run safe)
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo "  Autostart registered."
echo ""
echo "============================================"
echo "  Done!"
echo ""
echo "  The Joule SSE connector will now start"
echo "  automatically at login on port 3456."
echo ""
echo "  Joule MCP URL: http://127.0.0.1:3456/sse"
echo ""
echo "============================================"
echo ""
