@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   Self-Static-Blog Local Preview Server
echo ============================================
echo.

REM ---- Check if port 4321 is already in use ----
netstat -ano 2>nul | findstr /R /C:":4321 .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [WARN] Port 4321 is already in use.
    echo        If the blog page loads in the browser, a server is already running.
    echo        Otherwise close the app using port 4321 and try again.
    echo.
    start "" http://localhost:4321/
    pause
    exit /b 0
)

REM ---- Prefer Node.js (project's own zero-dep server) ----
where node >nul 2>&1
if %errorlevel%==0 (
    echo [INFO] Node.js detected. Starting Node server...
    echo.
    start "" http://localhost:4321/
    echo   Frontend : http://localhost:4321/
    echo   Admin    : http://localhost:4321/admin/
    echo.
    echo   Press Ctrl+C to stop.
    echo.
    node scripts\serve.mjs
    goto :end
)

REM ---- Fallback: PowerShell HttpListener (no Node needed) ----
echo [INFO] Node.js not found. Using PowerShell fallback server...
echo.
start "" http://localhost:4321/
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\serve.ps1"

:end
echo.
echo Server stopped.
pause
