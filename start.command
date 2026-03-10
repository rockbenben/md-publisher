#!/bin/bash
# md-publisher GUI Launcher (macOS - double-click to run)
# The server runs in background; browser opens automatically.
# This terminal window will close after launch.

cd "$(dirname "$0")"
if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found! Please install Node.js: https://nodejs.org/"
  read -p "Press Enter to close..."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "📦 Installing dependencies..."
  npm install --no-fund --no-audit || { echo "❌ Failed to install dependencies."; read -p "Press Enter to close..."; exit 1; }
  echo "🌐 Installing browser..."
  npx playwright install chromium || { echo "❌ Failed to install browser."; read -p "Press Enter to close..."; exit 1; }
fi
nohup node src/gui.js >> md-publisher.log 2>&1 &
sleep 1
osascript -e 'tell application "Terminal" to close front window' 2>/dev/null &
