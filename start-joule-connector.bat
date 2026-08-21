@echo off
FOR /F "tokens=5" %%a IN ('netstat -aon ^| findstr :3456 ^| findstr LISTENING') DO taskkill /F /PID %%a 2>/dev/null
set MCP_HTTP_PORT=3456
start "" /MIN cmd /c "set MCP_HTTP_PORT=3456 && node "%~dp0index.js" > "%TEMP%\sap_help_mcp_sse.log" 2>&1"
