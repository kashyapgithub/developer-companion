#!/bin/bash
# Double-click installer (macOS & Linux) for Developer Companion
cd "$(dirname "$0")/server" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js (v18+) is required: https://nodejs.org"
  read -n 1 -s -r -p "Press any key to close"; exit 1
fi

npm install --no-audit --no-fund && node setup.js
echo
echo "✓ Developer Companion backend & MCP server is installed and ready."
echo "Next: Open chrome://extensions -> enable 'Developer mode' -> click 'Load unpacked' and select this project directory."
read -n 1 -s -r -p "Press any key to close"
