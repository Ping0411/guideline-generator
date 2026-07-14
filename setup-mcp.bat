@echo off
setlocal enabledelayedexpansion
:: SAP Help Assistant - MCP version setup (Windows)
:: Run once after cloning. Installs all dependencies and builds the search index.

cd /d "%~dp0"

echo ============================================
echo   SAP Help Assistant - MCP Setup
echo ============================================
echo.

:: ── Check winget ─────────────────────────────────────────────────────────────

echo [1/5] Checking and installing prerequisites...
echo.

where winget >nul 2>&1
if errorlevel 1 (
    echo   ERROR: winget not found.
    echo   Please update Windows to version 1709 or later, then re-run this script.
    pause
    exit /b 1
)

:: ── Node.js ───────────────────────────────────────────────────────────────────

set NODE_OK=0
where node >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=2 delims=v." %%a in ('node --version') do set NODE_MAJOR=%%a
    if !NODE_MAJOR! GEQ 18 (
        for /f "tokens=*" %%v in ('node --version') do echo   Node.js %%v - OK
        set NODE_OK=1
    ) else (
        echo   Node.js is too old ^(v18+ required^). Installing latest...
    )
) else (
    echo   Node.js not found. Installing...
)

if %NODE_OK%==0 (
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo   ERROR: Failed to install Node.js.
        pause
        exit /b 1
    )
    echo   Node.js installed.
    echo   Please close and reopen this window, then re-run setup-mcp.bat.
    pause
    exit /b 0
)

:: ── Python ────────────────────────────────────────────────────────────────────

set PYTHON_CMD=
set PYTHON_OK=0

:: Try py launcher first (most reliable on Windows, not affected by Store aliases)
where py >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%v in ('py --version 2^>^&1') do set PY_VER=%%v
    echo !PY_VER! | findstr /i "Python 3" >nul 2>&1
    if not errorlevel 1 (
        set PYTHON_CMD=py
        set PYTHON_OK=1
    )
)

if %PYTHON_OK%==0 (
    where python3 >nul 2>&1
    if not errorlevel 1 (
        for /f "tokens=*" %%v in ('python3 --version 2^>^&1') do set PY_VER=%%v
        echo !PY_VER! | findstr /i "Python 3" >nul 2>&1
        if not errorlevel 1 (
            set PYTHON_CMD=python3
            set PYTHON_OK=1
        )
    )
)

if %PYTHON_OK%==0 (
    where python >nul 2>&1
    if not errorlevel 1 (
        for /f "tokens=*" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
        echo !PY_VER! | findstr /i "Python 3" >nul 2>&1
        if not errorlevel 1 (
            set PYTHON_CMD=python
            set PYTHON_OK=1
        )
    )
)

if %PYTHON_OK%==0 (
    echo   Python not found. Installing...
    winget install Python.Python.3.13 --silent --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        winget install Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
    )
    if errorlevel 1 (
        echo   ERROR: Failed to install Python.
        pause
        exit /b 1
    )
    echo   Python installed.
    echo   Please close and reopen this window, then re-run setup-mcp.bat.
    pause
    exit /b 0
)

for /f "tokens=*" %%v in ('!PYTHON_CMD! --version') do echo   %%v - OK
echo.

:: ── Node.js dependencies ──────────────────────────────────────────────────────

echo [2/5] Installing Node.js dependencies...
set PUPPETEER_SKIP_DOWNLOAD=true
call npm install --loglevel=error
if errorlevel 1 (
    echo   ERROR: npm install failed.
    pause
    exit /b 1
)
echo   Done.
echo.

:: ── Python dependencies ───────────────────────────────────────────────────────

echo [3/5] Installing Python dependencies...
%PYTHON_CMD% -m pip install --quiet chromadb sentence-transformers
if errorlevel 1 (
    echo   ERROR: pip install failed.
    pause
    exit /b 1
)
echo   Done.
echo.

:: ── Build semantic search index ───────────────────────────────────────────────

echo [4/5] Building semantic search index...
echo   This downloads the AI model ^(~470 MB^) and indexes all documents.
echo   Usually takes 10-15 minutes on first run.
echo.
%PYTHON_CMD% build_index.py
if errorlevel 1 (
    echo   ERROR: build_index.py failed.
    pause
    exit /b 1
)

:: Save cache hash
set HASH_FILE=.cache_hash
for /f "skip=1 tokens=*" %%h in ('certutil -hashfile cache.json MD5 2^>nul') do (
    if not defined SETUP_HASH set SETUP_HASH=%%h
)
set SETUP_HASH=%SETUP_HASH: =%
echo %SETUP_HASH%> "%HASH_FILE%"

echo.
echo   Index built.
echo.

:: ── Show MCP registration command ────────────────────────────────────────────

echo [5/5] Almost done - one manual step required.
echo.
echo   Run the following command to register the MCP server with Claude Code:
echo.
echo   claude mcp add sap-help node "%CD%\index.js"
echo.
echo   (Copy and paste the line above into your terminal)
echo.

:: ── Done ──────────────────────────────────────────────────────────────────────

echo ============================================
echo   Setup complete!
echo.
echo   After running the claude mcp add command,
echo   start Claude Code with: claude
echo ============================================
echo.
pause
