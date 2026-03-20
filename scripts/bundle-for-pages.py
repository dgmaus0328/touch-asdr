#!/usr/bin/env python3
"""
Emit a single index.html with inlined CSS + JS for hosts that serve .js with a
wrong Content-Type (GitLab Pages + X-Content-Type-Options: nosniff blocks it).

Body markup comes from project index.html. Inlines styles.css and a single
module script: envelope.js + app.js (import stripped, exports stripped).
"""
from __future__ import annotations

import pathlib
import re
import sys


def strip_exports(js: str) -> str:
    return re.sub(r"^export\s+", "", js, flags=re.MULTILINE)


def strip_envelope_import(app_js: str) -> str:
    return re.sub(
        r"^import\s+\{[\s\S]*?\}\s+from\s+['\"]\.\/envelope\.js['\"]\s*;\s*\n?",
        "",
        app_js,
        count=1,
    )


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: bundle-for-pages.py /path/to/output/dir", file=sys.stderr)
        sys.exit(1)
    dest = pathlib.Path(sys.argv[1]).resolve()
    root = pathlib.Path(__file__).resolve().parent.parent
    css = (root / "styles.css").read_text(encoding="utf-8")
    env_js = strip_exports((root / "envelope.js").read_text(encoding="utf-8"))
    app_js = strip_envelope_import((root / "app.js").read_text(encoding="utf-8"))
    module_src = env_js.rstrip() + "\n\n" + app_js
    module_src = module_src.replace("</script>", "<\\/script>")
    html = (root / "index.html").read_text(encoding="utf-8")
    html = re.sub(
        r'<link\s+rel="stylesheet"\s+href="styles\.css"\s*/>',
        f"<style>\n{css}\n  </style>",
        html,
        count=1,
    )
    html = re.sub(
        r'<script\s+type="module"\s+src="app\.js"\s*>\s*</script>',
        f"<script type=\"module\">\n{module_src}\n  </script>",
        html,
        count=1,
    )
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "index.html").write_text(html, encoding="utf-8")
    for name in ("app.js", "envelope.js", "styles.css"):
        p = dest / name
        if p.exists():
            p.unlink()


if __name__ == "__main__":
    main()
