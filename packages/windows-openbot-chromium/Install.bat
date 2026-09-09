@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js 20+ is required. Install from https://nodejs.org/ and re-run Install.bat
  exit /b 1
)

echo === Aria OpenBot Chromium — Windows install ===
echo Installing npm dependencies...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo [ERROR] npm install failed
  exit /b 1
)

echo Installing Playwright Chromium browser...
call npx playwright install chromium
if errorlevel 1 (
  echo [ERROR] playwright install chromium failed
  exit /b 1
)

if not exist ".env.cmd" (
  copy /Y "env.example" ".env.cmd" >nul
  echo Created .env.cmd from env.example — edit tokens before production use.
)

echo.
echo Install complete. Run Start-OpenBot.bat next.
exit /b 0
