#!/usr/bin/env python3
"""
Bumps the ?v= cache-busting query string on every /scripts/*.js and
/styles/*.css reference across all HTML files, to a new shared version tag.

Why this exists: scripts/styles are cached by the browser (see _headers),
so editing a file without also bumping its reference here means visitors
keep seeing the old cached version until the cache naturally expires. This
has been a repeated, real source of bugs in this project — run this any
time ANY .js or .css file changes, as a matter of course, not just when
you remember to.

Usage: python3 bump-versions.py
"""
import re
import glob
import datetime

NEWVER = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S")

script_pattern = re.compile(r'(src="[^"]*?/scripts/[^"?]+\.js)(\?v=[a-zA-Z0-9]*)?(")')
style_pattern = re.compile(r'(href="[^"]*?/styles/[^"?]+\.css)(\?v=[a-zA-Z0-9]*)?(")')

files = glob.glob('**/*.html', recursive=True)
changed = 0
for f in files:
    with open(f, encoding='utf-8') as fh:
        html = fh.read()
    new_html = script_pattern.sub(rf'\1?v={NEWVER}\3', html)
    new_html = style_pattern.sub(rf'\1?v={NEWVER}\3', new_html)
    if new_html != html:
        with open(f, 'w', encoding='utf-8') as fh:
            fh.write(new_html)
        changed += 1

print(f"Updated {changed} files to v={NEWVER}")
