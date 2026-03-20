#!/usr/bin/env bash
# Copy static app files to a folder that backs your GitLab/GitHub Pages (or any static host).
# Usage: ./scripts/publish-static.sh /absolute/path/to/site/root
set -euo pipefail
DEST="${1:?Usage: $0 /path/to/static/site/root}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for f in index.html styles.css app.js; do
  cp "$ROOT/$f" "$DEST/"
done
echo "Copied index.html, styles.css, app.js -> $DEST"
