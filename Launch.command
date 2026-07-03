#!/bin/bash
cd "$(dirname "$0")"

# Show startup dialog
osascript -e 'display dialog "SAP Help Assistant is starting, please wait..." with title "SAP Help Assistant" buttons {"OK"} default button "OK" giving up after 3' &

# Check python3
if ! command -v python3 &>/dev/null; then
  osascript -e 'display alert "Launch Failed" message "Python 3 not found. Please install Python 3 and try again."'
  exit 1
fi

# Kill any existing instance on port 5001
lsof -ti:5001 | xargs kill -9 2>/dev/null

# Start Flask in background
cd web-app
python3 app.py > /tmp/sap_help_assistant.log 2>&1 &
FLASK_PID=$!
cd ..

# Wait for server to be ready (up to 30 seconds)
for i in {1..30}; do
  sleep 1
  if curl -s http://localhost:5001 >/dev/null 2>&1; then
    open http://localhost:5001
    exit 0
  fi
done

# Server failed to start
kill $FLASK_PID 2>/dev/null
ERROR=$(tail -5 /tmp/sap_help_assistant.log)
osascript -e "display alert \"Launch Failed\" message \"Service failed to start. Please try again.\n\nError:\n${ERROR}\""
exit 1
