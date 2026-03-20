#!/usr/bin/env bash
# Publish a single-file index.html (inlined CSS + JS) for static hosts that
# mis-serve .js MIME types (e.g. GitLab Pages + nosniff).
# Usage: ./scripts/publish-static.sh /absolute/path/to/site/subfolder
set -euo pipefail
DEST="${1:?Usage: $0 /path/to/static/site/subfolder}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 "$ROOT/scripts/bundle-for-pages.py" "$DEST"
echo "Wrote bundled index.html -> $DEST (removed stale app.js/styles.css if present)"
