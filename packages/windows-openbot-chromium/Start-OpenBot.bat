@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js 20+ is required. Install from https://nodejs.org/
  exit /b 1
)

if not exist "node_modules\playwright" (
  echo Dependencies missing. Running Install.bat first...
  call "%~dp0Install.bat"
  if errorlevel 1 exit /b 1
)

if exist ".env.cmd" (
  call "%~dp0.env.cmd"
) else (
  echo No .env.cmd found — using built-in dev tokens. Copy env.example to .env.cmd for production.
  set SUPERVISOR_TOKEN=aria-supervisor-dev
  set COMPUTER_TOKEN=aria-computer-dev
  set OPENBOT_SUPERVISOR_PORT=18765
  set OPENBOT_PUBLIC_BASE=http://127.0.0.1:18765
  set OPENBOT_HEADED=1
  set OPENBOT_MAX_COMPUTERS=5
)

if "%OPENBOT_HEADED%"=="" set OPENBOT_HEADED=1
if "%OPENBOT_SUPERVISOR_PORT%"=="" set OPENBOT_SUPERVISOR_PORT=18765
if "%OPENBOT_PUBLIC_BASE%"=="" set OPENBOT_PUBLIC_BASE=http://127.0.0.1:%OPENBOT_SUPERVISOR_PORT%

echo.
echo Aria OpenBot Chromium supervisor ^(Windows^)
echo   Port:     %OPENBOT_SUPERVISOR_PORT%
echo   Headed:   %OPENBOT_HEADED%
echo   Health:   %OPENBOT_PUBLIC_BASE%/health
echo   View:     %OPENBOT_PUBLIC_BASE%/view/^<botId^>?fs=1
echo.
echo Point Aria at this machine:
echo   COMPUTER_SUPERVISOR_URL=%OPENBOT_PUBLIC_BASE%
echo   COMPUTER_SUPERVISOR_TOKEN=^(same as SUPERVISOR_TOKEN^)
echo   COMPUTER_TOKEN=^(same as COMPUTER_TOKEN^)
echo.
echo Press Ctrl+C to stop.
echo.

node scripts\openbot-chromium-supervisor.mjs
exit /b %ERRORLEVEL%
