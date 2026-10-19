"""Builds dist/cobra.html for publishing as a hosted page.

The host wraps the page in its own <!doctype>/<html>/<head>/<body> skeleton, so this strips
those tags from index.html and keeps everything else (title, importmap, fonts, styles, markup,
module script). It also prints the JSON `files` map of every runtime module so the page can be
published together with its sources.
"""
import json
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / "index.html").read_text(encoding="utf-8")

head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
# the host provides charset/viewport metas
head = re.sub(r'\s*<meta charset="utf-8">', "", head)
head = re.sub(r'\s*<meta name="viewport"[^>]*>', "", head)
page = head.strip() + "\n" + body.strip() + "\n"
dist = root / "dist"
dist.mkdir(exist_ok=True)
(dist / "cobra.html").write_text(page, encoding="utf-8")

files = {}
for p in sorted((root / "src").rglob("*.js")):
    rel = p.relative_to(root).as_posix()
    files[rel] = rel
(dist / "files.json").write_text(json.dumps(files, indent=1), encoding="utf-8")
print(f"wrote {dist / 'cobra.html'} ({len(page)} bytes) and {len(files)} module files")
