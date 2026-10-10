@echo off
cd /d "%~dp0\server"
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js is required: https://nodejs.org
  pause
  exit /b 1
)

call npm install --no-audit --no-fund
call node setup.js
echo.
echo Developer Companion server is installed and ready.
echo Next: Open chrome://extensions -> enable "Developer mode" -> click "Load unpacked" and select this folder.
pause
