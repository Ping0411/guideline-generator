@echo off
setlocal enabledelayedexpansion
:: SAP Help Assistant - One-time setup script (Windows)
:: Run this once after cloning the repository.
:: Takes ~15 minutes on first run (downloads AI model and builds search index).

cd /d "%~dp0"

echo ============================================
echo   SAP Help Assistant - Setup
echo ============================================
echo.

:: ── Check winget is available ─────────────────────────────────────────────────

echo [1/4] Checking and installing prerequisites...
echo.

where winget >nul 2>&1
if errorlevel 1 (
    echo   winget not found. Please update Windows to version 1709 or later,
    echo   then re-run this script.
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
    echo   Node.js installed. Please close and reopen this window, then re-run setup.bat.
    pause
    exit /b 0
)
echo.

:: ── Python ────────────────────────────────────────────────────────────────────

set PYTHON_CMD=
set PYTHON_OK=0

where python3 >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%v in ('python3 --version 2^>^&1') do set PY_VER=%%v
    echo %PY_VER% | findstr /i "Python 3" >nul 2>&1
    if not errorlevel 1 (
        set PYTHON_CMD=python3
        set PYTHON_OK=1
    )
)

if %PYTHON_OK%==0 (
    where python >nul 2>&1
    if not errorlevel 1 (
        for /f "tokens=*" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
        echo %PY_VER% | findstr /i "Python 3" >nul 2>&1
        if not errorlevel 1 (
            set PYTHON_CMD=python
            set PYTHON_OK=1
        )
    )
)

if %PYTHON_OK%==0 (
    echo   Python not found. Installing...
    winget install Python.Python.3 --silent --accept-package-agreements --accept-source-agreements
    echo   Python installed. Please close and reopen this window, then re-run setup.bat.
    pause
    exit /b 0
)

for /f "tokens=*" %%v in ('%PYTHON_CMD% --version') do echo   %%v - OK
echo.

:: ── Node.js dependencies ──────────────────────────────────────────────────────

echo [2/4] Installing Node.js dependencies...
call npm install --loglevel=error
if errorlevel 1 (
    echo   ERROR: npm install failed.
    pause
    exit /b 1
)
echo   Done.
echo.

:: ── Python dependencies ───────────────────────────────────────────────────────

echo [3/4] Installing Python dependencies (flask, chromadb, sentence-transformers)...
echo   This may take a few minutes...
%PYTHON_CMD% -m pip install --quiet flask requests chromadb sentence-transformers
if errorlevel 1 (
    echo   ERROR: pip install failed.
    pause
    exit /b 1
)
echo   Done.
echo.

:: ── Build semantic search index ───────────────────────────────────────────────

echo [4/4] Building semantic search index...
echo   This downloads the AI model (~250 MB) and indexes all documents.
echo   This step takes the longest - usually 10-15 minutes on first run.
echo.
%PYTHON_CMD% build_index.py
if errorlevel 1 (
    echo   ERROR: build_index.py failed.
    pause
    exit /b 1
)

:: Save cache hash so update.bat can skip rebuild if cache hasn't changed
set HASH_FILE=.cache_hash
for /f "skip=1 tokens=*" %%h in ('certutil -hashfile cache.json MD5 2^>nul') do (
    if not defined SETUP_HASH set SETUP_HASH=%%h
)
set SETUP_HASH=%SETUP_HASH: =%
echo %SETUP_HASH%> "%HASH_FILE%"

echo.
echo   Index built.
echo.

:: ── Done ──────────────────────────────────────────────────────────────────────

echo ============================================
echo   Setup complete!
echo.
echo   To start SAP Help Assistant:
echo   - Open this folder in Explorer
echo   - Double-click 'Launch SAP Help Assistant.vbs'
echo.
echo   After launch, the web interface opens at:
echo   http://localhost:5001
echo.
echo   You can bookmark that URL for quick access.
echo   Always launch the app first before using the bookmark.
echo ============================================
echo.
pause
