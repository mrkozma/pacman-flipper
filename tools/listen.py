#!/usr/bin/env python3
"""Write a listening page for the voice packs: dist/listen.html (dist/ is gitignored).

Usage: python3 tools/listen.py [--out dist/listen.html]

One row per clip, category by category: the English clip (assets/voice_en/) next to the Hungarian clip with the same
file name (assets/voice/), each with its speaker, text, length and a player. The page links the mp3 files where they are
(nothing is copied or embedded), so open it from the repo: open dist/listen.html. It only reads the voice folders.
"""
import argparse
import html
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKS = [('en', 'English', os.path.join(ROOT, 'assets', 'voice_en')), ('hu', 'Magyar', os.path.join(ROOT, 'assets', 'voice'))]


def load(folder):
    path = os.path.join(folder, 'manifest.json')
    if not os.path.exists(path):
        return {}
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)['cats']


def cell(folder, out_dir, clip):
    if not clip:
        return '<td class="none">(none)</td>'
    src = os.path.relpath(os.path.join(folder, clip['f']), out_dir).replace(os.sep, '/')
    return ('<td><div class="t">%s</div><div class="m">%s, %.2f s</div><audio controls preload="none" src="%s"></audio></td>'
            % (html.escape(clip['text']), html.escape(clip['who']), clip['dur'], html.escape(src)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'dist', 'listen.html'))
    args = ap.parse_args()
    out = os.path.abspath(args.out)
    out_dir = os.path.dirname(out)
    os.makedirs(out_dir, exist_ok=True)
    packs = [(code, name, folder, load(folder)) for code, name, folder in PACKS]
    order = []
    for _, _, _, cats in packs:
        order += [c for c in cats if c not in order]
    rows = []
    for cat in order:
        files = []
        for _, _, _, cats in packs:
            files += [k['f'] for k in cats.get(cat, {}).get('clips', []) if k['f'] not in files]
        for i, f in enumerate(files):
            tds = []
            for _, _, folder, cats in packs:
                clip = next((k for k in cats.get(cat, {}).get('clips', []) if k['f'] == f), None)
                tds.append(cell(folder, out_dir, clip))
            head = '<th rowspan="%d">%s</th>' % (len(files), html.escape(cat)) if i == 0 else ''
            rows.append('<tr>%s%s</tr>' % (head, ''.join(tds)))
    totals = ', '.join('%s: %d clips' % (name, sum(len(v['clips']) for v in cats.values())) for _, name, _, cats in packs)
    page = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Voice listening page</title>
<style>
body { font: 15px/1.4 system-ui, sans-serif; margin: 16px; color: #222; background: #fff; }
table { border-collapse: collapse; width: 100%%; }
th, td { border-top: 1px solid #ddd; padding: 6px 8px; vertical-align: top; text-align: left; }
th { font-weight: 600; white-space: nowrap; }
.t { font-size: 16px; } .m { color: #666; font-size: 13px; margin: 2px 0 4px; } .none { color: #999; }
audio { height: 32px; width: 100%%; max-width: 320px; }
</style></head><body>
<h1>Voice listening page</h1>
<p>%s. Same file name = the same moment in the game. Made by tools/listen.py.</p>
<table><thead><tr><th>Category</th>%s</tr></thead><tbody>
%s
</tbody></table></body></html>
''' % (html.escape(totals), ''.join('<th>%s</th>' % name for _, name, _, _ in packs), '\n'.join(rows))
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(page)
    print('wrote %s (%s)' % (os.path.relpath(out, ROOT), totals))


if __name__ == '__main__':
    main()
