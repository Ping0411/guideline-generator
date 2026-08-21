#!/bin/bash
cd "$(dirname "$0")"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" --no-use 2>/dev/null
lsof -ti:3456 | xargs kill -9 2>/dev/null
NODE_BIN=$(which node 2>/dev/null || ls "$HOME/.nvm/versions/node"/*/bin/node 2>/dev/null | tail -1)
if [ -n "$NODE_BIN" ]; then
  MCP_HTTP_PORT=3456 "$NODE_BIN" index.js > /tmp/sap_help_mcp_sse.log 2>&1 &
  echo "Joule SSE connector started on port 3456"
else
  echo "node not found" >> /tmp/sap_help_mcp_sse.log
fi
