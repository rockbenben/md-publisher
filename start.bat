@echo off
:: md-publisher GUI Launcher (Windows)
:: Double-click to start — terminal window minimizes, GUI opens in browser.
:: Logs are written to md-publisher.log
cd /d "%~dp0"
where node >nul 2>&1 || (echo Node.js not found! Please install Node.js. && pause && exit /b 1)
if not exist node_modules (
  echo Installing dependencies...
  call npm install --no-fund --no-audit
  if errorlevel 1 (echo Failed to install dependencies. && pause && exit /b 1)
  echo Installing browser...
  call npx playwright install chromium
  if errorlevel 1 (echo Failed to install browser. && pause && exit /b 1)
)
start "md-publisher" /min cmd /c "node src/gui.js >> md-publisher.log 2>&1"
