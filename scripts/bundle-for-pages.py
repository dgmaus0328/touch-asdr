#!/usr/bin/env python3
"""
Emit a single index.html with inlined CSS + JS for hosts that serve .js with a
wrong Content-Type (GitLab Pages + X-Content-Type-Options: nosniff blocks it).
"""
from __future__ import annotations

import pathlib
import sys


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: bundle-for-pages.py /path/to/output/dir", file=sys.stderr)
        sys.exit(1)
    dest = pathlib.Path(sys.argv[1]).resolve()
    root = pathlib.Path(__file__).resolve().parent.parent
    css = (root / "styles.css").read_text(encoding="utf-8")
    js = (root / "app.js").read_text(encoding="utf-8")
    # Break out of HTML parser if this sequence appears in source.
    js = js.replace("</script>", "<\\/script>")
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
  <title>Touch Envelope</title>
  <style>
{css}
  </style>
</head>
<body>
  <canvas id="c"></canvas>
  <script>
{js}
  </script>
</body>
</html>
"""
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "index.html").write_text(html, encoding="utf-8")
    # Remove stale split assets from older deploys.
    for name in ("app.js", "styles.css"):
        p = dest / name
        if p.exists():
            p.unlink()


if __name__ == "__main__":
    main()
