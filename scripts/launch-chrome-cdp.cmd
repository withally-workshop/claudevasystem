@echo off
REM Launch Chrome with remote debugging on port 9222 so Playwright MCP (playwright-cdp)
REM can attach to your already-logged-in browser session.
REM
REM Usage: double-click this file, or run from a terminal.
REM
REM Notes:
REM   - Uses your default Chrome profile (so Insense stays logged in).
REM   - If Chrome is already running with that profile, this WILL silently no-op
REM     because Chrome reuses the existing process without the debug flag.
REM     Close ALL Chrome windows first if attach fails.

set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
set "PROFILE=%LOCALAPPDATA%\Google\Chrome\User Data"

if not exist "%CHROME%" (
  echo ERROR: Chrome not found at "%CHROME%"
  pause
  exit /b 1
)

tasklist /fi "imagename eq chrome.exe" /nh | find /i "chrome.exe" >nul
if not errorlevel 1 (
  echo WARNING: Chrome is already running. Close ALL Chrome windows first,
  echo then run this script again. Otherwise the debug port will not bind.
  pause
  exit /b 1
)

start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%PROFILE%"

echo Chrome launched with debug port 9222.
timeout /t 3 /nobreak >nul
