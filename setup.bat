@echo off
:: SAP Help Assistant - One-time setup script (Windows)
:: Run this once after cloning the repository.
:: Takes ~15 minutes on first run (downloads AI model and builds search index).

cd /d "%~dp0"

echo ============================================
echo   SAP Help Assistant - Setup
echo ============================================
echo.

:: ── Check Node.js ─────────────────────────────────────────────────────────────

echo [1/4] Checking prerequisites...

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo   ERROR: Node.js not found.
    echo   Please install Node.js v18+ from https://nodejs.org and re-run this script.
    pause
    exit /b 1
)

:: Check Node version >= 18
for /f "tokens=2 delims=v." %%a in ('node --version') do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 18 (
    echo.
    echo   ERROR: Node.js version is too old. v18 or higher is required.
    echo   Please update Node.js from https://nodejs.org and re-run this script.
    pause
    exit /b 1
)

:: Detect python command (python3 or python)
set PYTHON_CMD=
where python3 >nul 2>&1
if not errorlevel 1 (
    set PYTHON_CMD=python3
) else (
    where python >nul 2>&1
    if not errorlevel 1 (
        :: Check it's not the Windows Store stub (stub returns empty version output)
        for /f "tokens=*" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
        echo %PY_VER% | findstr /i "Python 3" >nul 2>&1
        if not errorlevel 1 set PYTHON_CMD=python
    )
)

if "%PYTHON_CMD%"=="" (
    echo.
    echo   ERROR: Python 3 not found.
    echo   Please install Python 3.8+ from https://www.python.org and re-run this script.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do echo   Node.js %%v - OK
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
echo   This downloads the AI model (~90 MB) and indexes all documents.
echo   This step takes the longest - usually 10-15 minutes on first run.
echo   Subsequent runs after 'git pull' take about 1-2 minutes.
echo.
%PYTHON_CMD% build_index.py
if errorlevel 1 (
    echo   ERROR: build_index.py failed.
    pause
    exit /b 1
)
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
