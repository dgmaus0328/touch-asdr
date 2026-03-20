#!/usr/bin/env python3
"""
Emit a single index.html with inlined CSS + JS for hosts that serve .js with a
wrong Content-Type (GitLab Pages + X-Content-Type-Options: nosniff blocks it).

Body markup comes from project index.html (single source of truth) — only the
stylesheet and script are inlined.
"""
from __future__ import annotations

import pathlib
import re
import sys


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: bundle-for-pages.py /path/to/output/dir", file=sys.stderr)
        sys.exit(1)
    dest = pathlib.Path(sys.argv[1]).resolve()
    root = pathlib.Path(__file__).resolve().parent.parent
    css = (root / "styles.css").read_text(encoding="utf-8")
    js = (root / "app.js").read_text(encoding="utf-8")
    js = js.replace("</script>", "<\\/script>")
    html = (root / "index.html").read_text(encoding="utf-8")
    html = re.sub(
        r'<link\s+rel="stylesheet"\s+href="styles\.css"\s*/>',
        f"<style>\n{css}\n  </style>",
        html,
        count=1,
    )
    html = re.sub(
        r'<script\s+src="app\.js"\s*>\s*</script>',
        f"<script>\n{js}\n  </script>",
        html,
        count=1,
    )
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "index.html").write_text(html, encoding="utf-8")
    for name in ("app.js", "styles.css"):
        p = dest / name
        if p.exists():
            p.unlink()


if __name__ == "__main__":
    main()
