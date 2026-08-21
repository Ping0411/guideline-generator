@echo off
setlocal enabledelayedexpansion
:: SAP Help Assistant - Joule SSE Connector autostart setup (Windows)
:: Run once to register the Joule SSE connector as a startup task.
:: Safe to re-run. Does nothing if Joule Desktop is not installed.

cd /d "%~dp0"

echo ============================================
echo   SAP Help Assistant - Joule Autostart Setup
echo ============================================
echo.

:: ── Check Joule Desktop ───────────────────────────────────────────────────────

echo [1/3] Checking for Joule Desktop...
set JOULE_FOUND=0

reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall" /s /f "Joule" >nul 2>&1
if not errorlevel 1 set JOULE_FOUND=1

if %JOULE_FOUND%==0 (
  reg query "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall" /s /f "Joule" >nul 2>&1
  if not errorlevel 1 set JOULE_FOUND=1
)

if %JOULE_FOUND%==0 (
  reg query "HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" /s /f "Joule" >nul 2>&1
  if not errorlevel 1 set JOULE_FOUND=1
)

if %JOULE_FOUND%==0 (
  echo.
  echo   Joule Desktop is not installed on this machine.
  echo   Skipping autostart setup - nothing to do.
  echo.
  goto :end
)
echo   Joule Desktop found.
echo.

:: ── Find node ─────────────────────────────────────────────────────────────────

echo [2/3] Locating Node.js...
where node >nul 2>&1
if errorlevel 1 (
  echo   ERROR: node not found. Please install Node.js first ^(run setup-mcp.bat^).
  pause
  exit /b 1
)
for /f "tokens=*" %%p in ('where node') do set NODE_BIN=%%p
echo   Node.js found at: %NODE_BIN%
echo.

:: ── Register scheduled task ───────────────────────────────────────────────────

echo [3/3] Registering autostart...

:: Delete existing task if present (re-run safe)
schtasks /delete /tn "SAP Help Joule Connector" /f >nul 2>&1

:: Create task: runs at login for current user, hidden window
schtasks /create ^
  /tn "SAP Help Joule Connector" ^
  /tr "\"%~dp0start-joule-connector.bat\"" ^
  /sc onlogon ^
  /ru "%USERNAME%" ^
  /rl limited ^
  /f >nul

if errorlevel 1 (
  echo   ERROR: Failed to register scheduled task.
  pause
  exit /b 1
)

echo   Autostart registered.
echo.
echo ============================================
echo   Done!
echo.
echo   The Joule SSE connector will now start
echo   automatically at login on port 3456.
echo.
echo   Joule MCP URL: http://127.0.0.1:3456/sse
echo.
echo ============================================
echo.

:end
pause
