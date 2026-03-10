#!/bin/bash
# md-publisher GUI Launcher (macOS / Linux)
# Run: chmod +x start.sh && ./start.sh
# The server runs in background; browser opens automatically.

cd "$(dirname "$0")"
if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found! Please install Node.js: https://nodejs.org/"
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "📦 Installing dependencies..."
  npm install --no-fund --no-audit || { echo "❌ Failed to install dependencies."; exit 1; }
  echo "🌐 Installing browser..."
  npx playwright install chromium || { echo "❌ Failed to install browser."; exit 1; }
fi
nohup node src/gui.js >> md-publisher.log 2>&1 &
echo "📮 md-publisher GUI started (PID: $!)"
echo "   Logs: md-publisher.log"
echo "   Press Ctrl+C or kill $! to stop"
