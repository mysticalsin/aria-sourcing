@echo off
setlocal EnableExtensions
REM Best-effort stop for supervisors bound to the default port.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":18765" ^| findstr "LISTENING"') do (
  echo Stopping PID %%p on :18765
  taskkill /PID %%p /F >nul 2>&1
)
echo Done. If you used a custom OPENBOT_SUPERVISOR_PORT, close that console instead.
exit /b 0
