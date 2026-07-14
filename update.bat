@echo off
setlocal enabledelayedexpansion
:: SAP Help Assistant - Update script (Windows)
:: Run this after the maintainer announces an update.
:: Automatically detects whether the search index needs to be rebuilt.

cd /d "%~dp0"

echo ============================================
echo   SAP Help Assistant - Update
echo ============================================
echo.

:: ── Pull latest changes ───────────────────────────────────────────────────────

echo [1/3] Pulling latest changes from GitHub...
git pull
if errorlevel 1 (
    echo   ERROR: git pull failed. Check your network connection.
    pause
    exit /b 1
)
echo.

:: ── Detect python command ─────────────────────────────────────────────────────

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
    echo   ERROR: Python 3 not found. Please run setup.bat first.
    pause
    exit /b 1
)

echo [2/3] Installing / updating dependencies...
set PIP_FLAGS=--quiet
if defined PUPPETEER_SKIP_DOWNLOAD set PUPPETEER_SKIP_DOWNLOAD=true
%PYTHON_CMD% -m pip install -r web-app/requirements.txt %PIP_FLAGS%
if errorlevel 1 (
    echo   WARNING: pip install failed. Some features may not work.
)
echo.

:: ── Check if cache.json changed ───────────────────────────────────────────────

echo [3/4] Checking if search index needs to be rebuilt...

set HASH_FILE=.cache_hash

:: Compute MD5 of cache.json using certutil
for /f "skip=1 tokens=*" %%h in ('certutil -hashfile cache.json MD5 2^>nul') do (
    if not defined CURRENT_HASH set CURRENT_HASH=%%h
)
:: Remove spaces from hash
set CURRENT_HASH=%CURRENT_HASH: =%

:: Compare with stored hash
set STORED_HASH=
if exist "%HASH_FILE%" set /p STORED_HASH=<"%HASH_FILE%"
set STORED_HASH=%STORED_HASH: =%

if "%CURRENT_HASH%"=="%STORED_HASH%" (
    echo   Documentation cache unchanged - skipping index rebuild.
    echo.
    echo ============================================
    echo   Update complete! No index rebuild needed.
    echo   Launch the app to use the latest version.
    echo ============================================
    echo.
    pause
    exit /b 0
)

:: ── Rebuild index ─────────────────────────────────────────────────────────────

echo   Documentation cache has changed - rebuilding search index...
echo   This takes about 1-2 minutes.
echo.

echo [4/4] Building semantic search index...
%PYTHON_CMD% build_index.py
if errorlevel 1 (
    echo   ERROR: build_index.py failed.
    pause
    exit /b 1
)

:: Save new hash after successful build
echo %CURRENT_HASH%> "%HASH_FILE%"

echo.
echo ============================================
echo   Update complete!
echo   Launch the app to use the latest version.
echo ============================================
echo.
pause
