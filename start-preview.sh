#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "============================================"
echo "  KKR Restaurant - Local Preview Server"
echo "============================================"
echo ""
echo "Site will open at http://localhost:8080/"
echo "Press CTRL+C to stop the server."
echo ""

open_browser() {
  URL="http://localhost:8080/"
  if command -v open >/dev/null 2>&1; then open "$URL";
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL";
  fi
}

if command -v python3 >/dev/null 2>&1; then
  ( sleep 1; open_browser ) &
  python3 -m http.server 8080
elif command -v python >/dev/null 2>&1; then
  ( sleep 1; open_browser ) &
  python -m http.server 8080
elif command -v npx >/dev/null 2>&1; then
  ( sleep 1; open_browser ) &
  npx --yes serve -l 8080 .
else
  echo "No Python or Node.js found. Install Python from https://python.org/downloads/"
fi
