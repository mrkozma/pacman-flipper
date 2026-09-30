#!/usr/bin/env python3
"""Build the single-file game.

Usage:
  python tools/build.py                      -> dist/pacman-flipper.html
  python tools/build.py --out dist/_dev_x.html
  python tools/build.py --no-voice           -> skip the (large) embedded voice clips
  python tools/build.py --only 00,05,10,60   -> include only files with these two-digit prefixes

Concatenates src/*.js in filename order, inlines src/style.css, embeds fonts from assets/fonts/*.woff2
(file name convention Family_Weight.woff2 or Family_Min-Max.woff2 for a variable font, e.g. Fredoka_600.woff2 or Fredoka_300-700.woff2) and voice clips from assets/voice/manifest.json.
"""
import argparse, base64, json, os, re, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def b64(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')


def build_fonts():
    css = []
    for p in sorted(glob.glob(os.path.join(ROOT, 'assets', 'fonts', '*.woff2'))):
        name = os.path.splitext(os.path.basename(p))[0]
        m = re.match(r'^(.+?)_(\d+)(?:-(\d+))?$', name)
        if not m:
            print('warning: font file name not Family_Weight[-MaxWeight]:', name, file=sys.stderr)
            continue
        family = m.group(1)
        weight = m.group(2) if not m.group(3) else '%s %s' % (m.group(2), m.group(3))
        css.append(
            "@font-face{font-family:'%s';font-weight:%s;font-style:normal;font-display:block;"
            "src:url(data:font/woff2;base64,%s) format('woff2');}" % (family, weight, b64(p)))
    return '\n'.join(css)


def build_voice():
    mpath = os.path.join(ROOT, 'assets', 'voice', 'manifest.json')
    if not os.path.exists(mpath):
        return 'window.PM_VOICE = null;'
    manifest = json.loads(read(mpath))
    files = {}
    for cat in manifest.get('cats', {}).values():
        for clip in cat.get('clips', []):
            fp = os.path.join(ROOT, 'assets', 'voice', clip['f'])
            if clip['f'] not in files and os.path.exists(fp):
                files[clip['f']] = b64(fp)
    payload = json.dumps({'manifest': manifest, 'files': files}, ensure_ascii=False, separators=(',', ':'))
    payload = payload.replace('</', '<\\/')
    return 'window.PM_VOICE = %s;' % payload


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join('dist', 'pacman-flipper.html'))
    ap.add_argument('--no-voice', action='store_true')
    ap.add_argument('--only', default='', help='comma separated two-digit file prefixes to include, e.g. 00,05,10,60 (use while other agents have half-written files)')
    args = ap.parse_args()

    src = os.path.join(ROOT, 'src')
    js_files = sorted(p for p in glob.glob(os.path.join(src, '*.js')) if not p.endswith('.test.js'))
    if args.only:
        wanted = set(x.strip() for x in args.only.split(',') if x.strip())
        js_files = [p for p in js_files if os.path.basename(p)[:2] in wanted]
    script = '\n'.join('/* ==== %s ==== */\n%s' % (os.path.basename(p), read(p)) for p in js_files)
    script = script.replace('</script', '<\\/script')

    style = build_fonts() + '\n' + read(os.path.join(src, 'style.css'))
    voice = 'window.PM_VOICE = null;' if args.no_voice else build_voice()

    html = read(os.path.join(src, 'index.template.html'))
    html = html.replace('<!--@STYLE@-->', style)
    html = html.replace('<!--@VOICE@-->', voice)
    html = html.replace('<!--@SCRIPT@-->', script)

    out = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    print('built %s (%.1f KB, %d js files)' % (os.path.relpath(out, ROOT), os.path.getsize(out) / 1024.0, len(js_files)))


if __name__ == '__main__':
    main()
