#!/usr/bin/env python3
"""Build the single-file game.

Usage:
  python tools/build.py                      -> dist/pacman-flipper.html (from src/)
  python tools/build.py --src verified-src   -> build from another source folder (relative to the repo root), e.g. the published tree
  python tools/build.py --out dist/_dev_x.html
  python tools/build.py --no-voice           -> skip the (large) embedded voice clips
  python tools/build.py --voice-langs hu     -> embed only these voice packs (default: every language whose manifest.json exists)
  python tools/build.py --only 00,05,10,60   -> include only files with these two-digit prefixes

Concatenates <src>/*.js in filename order, inlines <src>/style.css into <src>/index.template.html, embeds fonts from
assets/fonts/*.woff2 (file name convention Family_Weight.woff2 or Family_Min-Max.woff2 for a variable font, e.g. Fredoka_600.woff2
or Fredoka_300-700.woff2) and one voice pack per language from VOICE_DIRS (<folder>/manifest.json plus its mp3 files):
  window.PM_VOICES = {"hu": {manifest, files: {"<file>.mp3": "<base64>"}}, "en": {...}};
  window.PM_VOICE = window.PM_VOICES.hu || null;      (the old single-pack name: src/80_audio.js and older tests read it)
--no-voice gives window.PM_VOICES = null; window.PM_VOICE = null;
"""
import argparse, base64, json, os, re, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# language code -> voice folder (relative to ROOT); 80_audio.js plays the pack of PM.LANG, a language without a pack stays silent
VOICE_DIRS = {'hu': os.path.join('assets', 'voice'), 'en': os.path.join('assets', 'voice_en')}


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


def voice_manifest(lang):
    return os.path.join(ROOT, VOICE_DIRS[lang], 'manifest.json')


def build_pack(lang):
    folder = os.path.join(ROOT, VOICE_DIRS[lang])
    manifest = json.loads(read(voice_manifest(lang)))
    files = {}
    for cat in manifest.get('cats', {}).values():
        for clip in cat.get('clips', []):
            fp = os.path.join(folder, clip['f'])
            if clip['f'] not in files and os.path.exists(fp):
                files[clip['f']] = b64(fp)
    return {'manifest': manifest, 'files': files}


def build_voice(langs):
    packs = {}
    for lang in langs:
        packs[lang] = build_pack(lang)
    payload = json.dumps(packs, ensure_ascii=False, separators=(',', ':'))
    payload = payload.replace('</', '<\\/')
    return 'window.PM_VOICES = %s;\nwindow.PM_VOICE = window.PM_VOICES.hu || null;' % payload


def voice_langs(arg):
    """The languages to embed: the --voice-langs list (each must be known and have a manifest), or every language with a manifest."""
    if not arg:
        return [lang for lang in VOICE_DIRS if os.path.exists(voice_manifest(lang))]
    langs = []
    for lang in (x.strip().lower() for x in arg.split(',')):
        if not lang or lang in langs:
            continue
        if lang not in VOICE_DIRS:
            sys.exit('error: unknown voice language "%s" (known: %s)' % (lang, ', '.join(VOICE_DIRS)))
        if not os.path.exists(voice_manifest(lang)):
            sys.exit('error: no voice pack for "%s": %s is missing' % (lang, os.path.relpath(voice_manifest(lang), ROOT)))
        langs.append(lang)
    return langs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default='src', help='source folder with the NN_*.js files, style.css and index.template.html (relative to the repo root), e.g. verified-src')
    ap.add_argument('--out', default=os.path.join('dist', 'pacman-flipper.html'))
    ap.add_argument('--no-voice', action='store_true')
    ap.add_argument('--voice-langs', default='', help='comma separated voice languages to embed, e.g. hu,en (default: every language whose manifest.json exists; known: %s)' % ', '.join(VOICE_DIRS))
    ap.add_argument('--only', default='', help='comma separated two-digit file prefixes to include, e.g. 00,05,10,60 (use while other agents have half-written files)')
    args = ap.parse_args()

    src = args.src if os.path.isabs(args.src) else os.path.join(ROOT, args.src)
    js_files = sorted(p for p in glob.glob(os.path.join(src, '*.js')) if not p.endswith('.test.js'))
    if not js_files:
        sys.exit('error: no .js files in %s (--src %s)' % (src, args.src))
    if args.only:
        wanted = set(x.strip() for x in args.only.split(',') if x.strip())
        js_files = [p for p in js_files if os.path.basename(p)[:2] in wanted]
    script = '\n'.join('/* ==== %s ==== */\n%s' % (os.path.basename(p), read(p)) for p in js_files)
    script = script.replace('</script', '<\\/script')

    style = build_fonts() + '\n' + read(os.path.join(src, 'style.css'))
    if args.no_voice:
        langs = []
        voice = 'window.PM_VOICES = null;\nwindow.PM_VOICE = null;'
    else:
        langs = voice_langs(args.voice_langs)
        if not langs:
            print('note: no voice manifest found, the page has no voice', file=sys.stderr)
        voice = build_voice(langs)

    html = read(os.path.join(src, 'index.template.html'))
    html = html.replace('<!--@STYLE@-->', style)
    html = html.replace('<!--@VOICE@-->', voice)
    html = html.replace('<!--@SCRIPT@-->', script)

    out = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    print('built %s (%.1f KB, %d js files from %s, voice: %s)' % (os.path.relpath(out, ROOT), os.path.getsize(out) / 1024.0, len(js_files),
                                                                 os.path.relpath(src, ROOT), ', '.join(langs) or 'none'))


if __name__ == '__main__':
    main()
