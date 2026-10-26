#!/usr/bin/env python3
"""Generate the voice clips and the manifest of one language (Hungarian by default, English with --lang en).

FROZEN (SPEC 4.6): assets/voice/ holds the published Hungarian clips, checked by assets/voice/FROZEN.sha256. Re-recording
cannot reproduce them (the online voices change), so for Hungarian this tool refuses to run unless it gets --unfreeze-hungarian,
which is only for a change the owner explicitly asked for (FROZEN.sha256 then has to be rewritten too, or tests/voice_check.py fails).
--lang en reads tools/en/ and writes only assets/voice_en/; it never reads or writes assets/voice/.

Usage:
  python tools/gen_voice.py --lang en ...              English: any of the lines below, on assets/voice_en/
  python tools/gen_voice.py --unfreeze-hungarian ...   Hungarian: required before any of the lines below does anything
  python tools/gen_voice.py            synthesize what changed, post-process, delete orphans, write the manifest
  python tools/gen_voice.py --force    redo everything (synthesis and post-processing)
  python tools/gen_voice.py --post     redo only the post-processing (trim, loudness, encode) from the cached raw audio
  python tools/gen_voice.py --only ghost_,fruit_   restrict synthesis and post-processing to categories with these prefixes
                                                   (the manifest still lists every clip that exists)

Pipeline per clip:
  1. edge-tts renders the "tts" text with the speaker's neural voice, rate and pitch -> <voice folder>/.raw/<file>
     (the Azure voices add about 1.5 s of silence around every line, so the raw files are never shipped)
  2. post-processing (PyAV + numpy): trim the silence, short fades, soft-knee peak compression, encode mono mp3
     (peak about -3 dBFS) -> <voice folder>/<cat>_<n>.mp3, then measure the BS.1770 loudness of the encoded clip
  3. manifest.json (SPEC 4.6) with durations measured by mutagen and, per clip, play_gain_db: the gain in dB that
     src/80_audio.js applies when it plays the clip, so every line reaches -20 LUFS plus its speaker offset
     (speaker gain_db in voice_profiles.json, entry "vol" in the script) with the played peak at most -4 dBFS.

Reads every voice_script*.json of the language's script folder (voice_script.json first, then the others in name order) and
its voice_profiles.json: tools/ and assets/voice/ for Hungarian, tools/en/ and assets/voice_en/ for English. The script glob
does not look into subfolders, so the two languages never mix and the orphan sweep only touches the language's own folder.
All files are read and written as UTF-8. Hungarian text never goes through a command line.
"""
import argparse
import asyncio
import glob
import hashlib
import json
import os
import sys
import time

import numpy as np
import av
import edge_tts
from mutagen.mp3 import MP3

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, 'tools')
# Per language: the folder with voice_script*.json and voice_profiles.json, and the output folder (SPEC 4.6).
LANGS = {
    'hu': {'scripts': TOOLS, 'voice': os.path.join(ROOT, 'assets', 'voice')},
    'en': {'scripts': os.path.join(TOOLS, 'en'), 'voice': os.path.join(ROOT, 'assets', 'voice_en')},
}
# Set by use_lang(); every function below reads these.
SCRIPT_DIR = VOICE_DIR = RAW_DIR = CACHE_PATH = MANIFEST_PATH = None

CONCURRENCY = 3
RETRIES = 5
SYNTH_VERSION = 1   # bump when synthesis changes in a way the hash does not see

# Post-processing settings. They are part of the final hash, so editing them re-runs the post stage only.
POST = {
    'version': 5,
    'max_gap_s': 0.36,       # the voices leave about 1 s between sentences; shorten any silence longer than this
    'keep_gap_s': 0.28,      # ... down to this
    'silence_db': -42.0,     # trim below this level, relative to the loudest 10 ms window
    'lead_pad_s': 0.030,     # keep a little air before the first word
    'tail_pad_s': 0.110,     # and let the last sound decay naturally
    'fade_in_s': 0.008,
    'fade_out_s': 0.090,
    'knee': 0.5,             # soft-knee peak compression: identity below 0.5 of the peak, tanh curve above
    'store_peak_db': -3.0,   # the mp3 holds the compressed clip with its peak at this level (room for the encoder)
    'hard_ceiling': 0.89,    # never exceed this in the file
    'target_lufs': -20.0,    # BS.1770 loudness that the game plays a clip at (plus the speaker / entry offset)
    'play_ceiling_db': -4.0, # ... unless its played peak would go above this
    'bitrate': 56000,
    'rate': 24000,
}

def read_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def write_json(path, data):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')


def use_lang(lang):
    """Point every path at one language's folders."""
    global SCRIPT_DIR, VOICE_DIR, RAW_DIR, CACHE_PATH, MANIFEST_PATH
    SCRIPT_DIR = LANGS[lang]['scripts']
    VOICE_DIR = LANGS[lang]['voice']
    if lang != 'hu' and os.path.realpath(VOICE_DIR) == os.path.realpath(LANGS['hu']['voice']):
        raise SystemExit('refusing to write %s into the frozen Hungarian folder' % lang)
    RAW_DIR = os.path.join(VOICE_DIR, '.raw')
    CACHE_PATH = os.path.join(VOICE_DIR, '.cache.json')
    MANIFEST_PATH = os.path.join(VOICE_DIR, 'manifest.json')


def script_files():
    files = sorted(glob.glob(os.path.join(SCRIPT_DIR, 'voice_script*.json')))
    main = os.path.join(SCRIPT_DIR, 'voice_script.json')
    if main in files:
        files.remove(main)
        files.insert(0, main)
    return files


def num(v, what):
    """Accept 5, -3, '+5', '-3%', '+12Hz', 1.5 and return a float."""
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().lower().replace('%', '').replace('hz', '').replace('db', '')
    try:
        return float(s)
    except ValueError:
        raise SystemExit('bad %s value: %r' % (what, v))


def sha(obj):
    return hashlib.sha1(json.dumps(obj, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()[:16]


def build_clips(profiles):
    """Return the clips in stable order; variants are numbered per category across all script files."""
    speakers = profiles['speakers']
    clips = []
    counts = {}
    for path in script_files():
        entries = read_json(path, [])
        for i, e in enumerate(entries):
            where = '%s[%d]' % (os.path.basename(path), i)
            for key in ('cat', 'who', 'text', 'tts'):
                if not e.get(key):
                    raise SystemExit('%s: missing "%s"' % (where, key))
            if e['who'] not in speakers:
                raise SystemExit('%s: unknown speaker "%s"' % (where, e['who']))
            sp = speakers[e['who']]
            cat = e['cat']
            counts[cat] = counts.get(cat, 0) + 1
            rate = int(round(num(sp.get('rate'), 'rate') + num(e.get('rate'), 'rate')))
            pitch = int(round(num(sp.get('pitch'), 'pitch') + num(e.get('pitch'), 'pitch')))
            gain = num(sp.get('gain_db'), 'gain_db') + num(e.get('vol'), 'vol')
            clip = {
                'cat': cat, 'who': e['who'], 'text': e['text'], 'tts': e['tts'],
                'voice': sp['voice'],
                'rate': '%+d%%' % rate,
                'pitch': '%+dHz' % pitch,
                'gain_db': gain,
                'file': '%s_%d.mp3' % (cat, counts[cat]),
            }
            clip['raw_hash'] = sha([SYNTH_VERSION, clip['voice'], clip['rate'], clip['pitch'], clip['tts']])
            clip['final_hash'] = sha([clip['raw_hash'], POST, gain])
            clips.append(clip)
    return clips


# ---------------------------------------------------------------- synthesis

async def synth(clip, sem, log):
    path = os.path.join(RAW_DIR, clip['file'])
    tmp = path + '.part'
    delay = 1.5
    last = None
    for attempt in range(1, RETRIES + 1):
        async with sem:
            try:
                com = edge_tts.Communicate(clip['tts'], clip['voice'], rate=clip['rate'], pitch=clip['pitch'])
                await com.save(tmp)
                if os.path.getsize(tmp) < 200:
                    raise RuntimeError('empty audio')
                MP3(tmp)  # raises if it is not a valid mp3
                os.replace(tmp, path)
                return True, None
            except Exception as ex:  # network hiccups, throttling, bad audio
                last = '%s: %s' % (type(ex).__name__, ex)
                log.append((clip['file'], attempt, last))
                if os.path.exists(tmp):
                    os.remove(tmp)
        await asyncio.sleep(delay)
        delay *= 2
    return False, last


async def synth_all(todo):
    sem = asyncio.Semaphore(CONCURRENCY)
    log = []
    results = await asyncio.gather(*(synth(c, sem, log) for c in todo))
    return results, log


# ---------------------------------------------------------------- post-processing

def decode_mono(path):
    c = av.open(path)
    s = c.streams.audio[0]
    rate = s.rate
    parts = []
    for fr in c.decode(s):
        a = fr.to_ndarray().astype(np.float32)
        parts.append(a.reshape(-1) if a.ndim == 1 else a.mean(axis=0))
    c.close()
    return np.concatenate(parts), rate


def encode_mp3(x, rate, path):
    """x: float32 mono in [-1, 1]."""
    pcm = np.clip(x, -1.0, 1.0)
    out = av.open(path, 'w', format='mp3')
    st = out.add_stream('libmp3lame', rate=rate)
    st.bit_rate = POST['bitrate']
    st.layout = 'mono'
    st.format = 'fltp'
    n = 1152  # the lame frame size
    for i in range(0, len(pcm), n):
        chunk = pcm[i:i + n].astype(np.float32)[None, :]
        fr = av.AudioFrame.from_ndarray(chunk, format='fltp', layout='mono')
        fr.sample_rate = rate
        for pkt in st.encode(fr):
            out.mux(pkt)
    for pkt in st.encode(None):
        out.mux(pkt)
    out.close()


def shorten_gaps(seg, senv, rate, thr):
    """Cut the middle out of silences longer than max_gap_s so sentences follow each other at a natural pace."""
    quiet = senv <= thr
    max_gap = int(POST['max_gap_s'] * rate)
    keep = int(POST['keep_gap_s'] * rate)
    pieces, penv = [], []
    pos = 0
    i, n = 0, len(seg)
    while i < n:
        if quiet[i]:
            j = i
            while j < n and quiet[j]:
                j += 1
            if j - i > max_gap:
                half = keep // 2
                pieces.append(seg[pos:i + half]); penv.append(senv[pos:i + half])
                pos = j - half
            i = j
        else:
            i += 1
    pieces.append(seg[pos:]); penv.append(senv[pos:])
    return np.concatenate(pieces), np.concatenate(penv)


def soft_knee(seg, knee):
    """Soft-knee peak compression: samples below `knee` (of the peak) pass unchanged, the part above bends smoothly
    with y = k + (1 - k) * tanh((|x| - k) / (1 - k)). The result keeps the peak of the input."""
    pk = float(np.abs(seg).max())
    a = np.abs(seg) / pk
    over = a > knee
    z = a.copy()
    z[over] = knee + (1 - knee) * np.tanh((a[over] - knee) / (1 - knee))
    return np.sign(seg) * z / float(z.max()) * pk


_KW = {}


def _kweight_power(n, fs):
    """|H(f)|^2 of the BS.1770 K-weighting filter (high shelf + high pass) at the rfft bins of an n sample block,
    already multiplied by the Parseval weights, so sum(|rfft(x)|^2 * result) is the K-weighted mean square of x."""
    key = (n, fs)
    if key in _KW:
        return _KW[key]

    def shelf(G, Q, fc):
        A = 10 ** (G / 40.0)
        w0 = 2 * np.pi * fc / fs
        alpha = np.sin(w0) / (2 * Q)
        cw = np.cos(w0)
        b0 = A * ((A + 1) + (A - 1) * cw + 2 * np.sqrt(A) * alpha)
        b1 = -2 * A * ((A - 1) + (A + 1) * cw)
        b2 = A * ((A + 1) + (A - 1) * cw - 2 * np.sqrt(A) * alpha)
        a0 = (A + 1) - (A - 1) * cw + 2 * np.sqrt(A) * alpha
        a1 = 2 * ((A - 1) - (A + 1) * cw)
        a2 = (A + 1) - (A - 1) * cw - 2 * np.sqrt(A) * alpha
        return np.array([b0, b1, b2]) / a0, np.array([1, a1 / a0, a2 / a0])

    def hp(Q, fc):
        w0 = 2 * np.pi * fc / fs
        alpha = np.sin(w0) / (2 * Q)
        cw = np.cos(w0)
        b = np.array([(1 + cw) / 2, -(1 + cw), (1 + cw) / 2])
        a = np.array([1 + alpha, -2 * cw, 1 - alpha])
        return b / a[0], a / a[0]

    f = np.fft.rfftfreq(n, 1.0 / fs)
    z = np.exp(-1j * 2 * np.pi * f / fs)
    H = np.ones_like(f, dtype=complex)
    for b, a in (shelf(3.999843853973347, 0.7071752369554196, 1681.9744509555319), hp(0.5003270373253953, 38.13547087613982)):
        H = H * (b[0] + b[1] * z + b[2] * z * z) / (a[0] + a[1] * z + a[2] * z * z)
    w = np.full(len(f), 2.0)
    w[0] = 1.0
    if n % 2 == 0:
        w[-1] = 1.0
    _KW[key] = np.abs(H) ** 2 * w / (n * n)
    return _KW[key]


def lufs(x, fs):
    """BS.1770 integrated loudness (400 ms blocks, 100 ms hop, -70 LUFS absolute gate, -10 LU relative gate), mono.
    Same algorithm as tests/qa_audio_lufs.py."""
    x = x.astype(np.float64)
    blk, hop = int(0.4 * fs), int(0.1 * fs)
    wt = _kweight_power(blk, fs)
    if len(x) < blk:
        z = float(np.sum(np.abs(np.fft.rfft(np.pad(x, (0, blk - len(x))))) ** 2 * wt)) * blk / len(x)
        return -0.691 + 10 * np.log10(max(z, 1e-12))
    zs = np.array([float(np.sum(np.abs(np.fft.rfft(x[s0:s0 + blk])) ** 2 * wt)) for s0 in range(0, len(x) - blk + 1, hop)])
    lk = -0.691 + 10 * np.log10(np.maximum(zs, 1e-12))
    keep = lk > -70
    if not keep.any():
        return -70.0
    rel = -0.691 + 10 * np.log10(zs[keep].mean()) - 10
    keep = lk > rel
    if not keep.any():
        keep = lk > -70
    return float(-0.691 + 10 * np.log10(zs[keep].mean()))


def process(clip):
    x, rate = decode_mono(os.path.join(RAW_DIR, clip['file']))
    win = max(1, int(0.010 * rate))
    env = np.sqrt(np.convolve(x * x, np.ones(win, dtype=np.float32) / win, mode='same'))
    top = float(env.max())
    if top < 1e-4:
        raise RuntimeError('raw clip is silent: ' + clip['file'])
    thr = top * 10 ** (POST['silence_db'] / 20.0)
    idx = np.where(env > thr)[0]
    a = max(0, int(idx[0]) - int(POST['lead_pad_s'] * rate))
    b = min(len(x), int(idx[-1]) + int(POST['tail_pad_s'] * rate))
    seg = x[a:b]
    senv = env[a:b]
    seg, senv = shorten_gaps(seg, senv, rate, thr)
    seg = seg.copy()

    fi = min(len(seg) // 4, int(POST['fade_in_s'] * rate))
    fo = min(len(seg) // 2, int(POST['fade_out_s'] * rate))
    if fi > 0:
        seg[:fi] *= np.sin(np.linspace(0, np.pi / 2, fi)) ** 2
    if fo > 0:
        seg[-fo:] *= np.cos(np.linspace(0, np.pi / 2, fo)) ** 2

    # Level: soft-knee compression (the crest factor decides how loud a clip feels, so the peaks are flattened a little),
    # then the file gets a fixed peak. The loudness that the game plays is not baked in: it goes to the manifest as play_gain_db.
    seg = soft_knee(seg, POST['knee'])
    seg *= min(10 ** (POST['store_peak_db'] / 20.0), POST['hard_ceiling']) / float(np.abs(seg).max())

    tmp = os.path.join(VOICE_DIR, clip['file'] + '.part')
    encode_mp3(seg, POST['rate'] if rate != POST['rate'] else rate, tmp)
    # Measure the encoded clip (what the browser decodes), then choose the playback gain.
    y, ysr = decode_mono(tmp)
    loud = lufs(y, ysr)
    peak_db = 20 * np.log10(max(float(np.abs(y).max()), 1e-6))
    want = POST['target_lufs'] + clip['gain_db'] - loud
    play = min(want, POST['play_ceiling_db'] - peak_db)
    os.replace(tmp, os.path.join(VOICE_DIR, clip['file']))
    return {'raw_s': len(x) / rate, 'kept_s': len(seg) / rate, 'play_gain_db': round(float(play), 2),
            'lufs': round(float(loud), 2), 'peak_db': round(float(peak_db), 2), 'limited': bool(play < want - 0.005)}


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true', help='redo synthesis and post-processing of every clip')
    ap.add_argument('--post', action='store_true', help='redo only the post-processing')
    ap.add_argument('--only', default='', help='comma separated category prefixes to restrict work to')
    ap.add_argument('--lang', choices=sorted(LANGS), default='hu', help='which language to generate (default hu, the frozen voice)')
    ap.add_argument('--unfreeze-hungarian', action='store_true', help='allow changing the frozen Hungarian voice (only with the owner\'s explicit OK)')
    args = ap.parse_args()
    if args.lang == 'hu' and not args.unfreeze_hungarian:
        raise SystemExit('The Hungarian voice is frozen: assets/voice/ holds the published clips (assets/voice/FROZEN.sha256, SPEC 4.6).\n'
                         'Nothing was changed. Use --unfreeze-hungarian only when the owner explicitly asked for new Hungarian clips.')

    use_lang(args.lang)
    profiles = read_json(os.path.join(SCRIPT_DIR, 'voice_profiles.json'))
    if not profiles or not script_files():
        raise SystemExit('%s needs voice_profiles.json and voice_script.json' % os.path.relpath(SCRIPT_DIR, ROOT))
    os.makedirs(RAW_DIR, exist_ok=True)
    clips = build_clips(profiles)
    cache = read_json(CACHE_PATH, {}) or {}
    prefixes = [p.strip() for p in args.only.split(',') if p.strip()]

    def selected(c):
        return not prefixes or any(c['cat'].startswith(p) for p in prefixes)

    def ok_file(p):
        return os.path.exists(p) and os.path.getsize(p) > 200

    # Stage 1: synthesis
    todo = []
    for c in clips:
        if not selected(c):
            continue
        entry = cache.get(c['file'], {})
        fresh = entry.get('raw') == c['raw_hash'] and ok_file(os.path.join(RAW_DIR, c['file']))
        if (args.force and not args.post) or (not fresh and not args.post):
            todo.append(c)
    failed = []
    if todo:
        t0 = time.time()
        print('synthesizing %d clip(s), %d cached ...' % (len(todo), len(clips) - len(todo)))
        results, log = asyncio.run(synth_all(todo))
        for c, (ok, err) in zip(todo, results):
            if ok:
                cache.setdefault(c['file'], {})['raw'] = c['raw_hash']
                cache[c['file']].pop('final', None)
            else:
                failed.append((c['file'], err))
                cache.pop(c['file'], None)
        if log:
            print('%d retry event(s) (transient errors are normal)' % len(log))
        print('synthesis done in %.1f s' % (time.time() - t0))
        write_json(CACHE_PATH, cache)
    else:
        print('synthesis: nothing to do')

    # Stage 2: post-processing
    post_todo = []
    for c in clips:
        if not selected(c):
            continue
        entry = cache.get(c['file'])
        if not entry or entry.get('raw') != c['raw_hash'] or not ok_file(os.path.join(RAW_DIR, c['file'])):
            continue  # synthesis failed for it
        fresh = entry.get('final') == c['final_hash'] and ok_file(os.path.join(VOICE_DIR, c['file']))
        if args.force or args.post or not fresh:
            post_todo.append(c)
    stats = []
    if post_todo:
        print('post-processing %d clip(s) ...' % len(post_todo))
        for c in post_todo:
            try:
                st = process(c)
                stats.append(st)
                cache[c['file']]['final'] = c['final_hash']
                cache[c['file']]['play_gain_db'] = st['play_gain_db']
            except Exception as ex:
                failed.append((c['file'], 'post: %s: %s' % (type(ex).__name__, ex)))
                cache[c['file']].pop('final', None)
        if stats:
            played = np.array([s['lufs'] + s['play_gain_db'] for s in stats])
            print('trimmed %.0f s of raw audio down to %.0f s; play gain %.1f to %.1f dB, played loudness mean %.1f sd %.2f LUFS, %d of %d clips peak-limited' % (
                sum(s['raw_s'] for s in stats), sum(s['kept_s'] for s in stats),
                min(s['play_gain_db'] for s in stats), max(s['play_gain_db'] for s in stats),
                played.mean(), played.std(), sum(1 for s in stats if s['limited']), len(stats)))
    else:
        print('post-processing: nothing to do')

    # Orphans: mp3 files that no script entry points at any more, and stray temp files.
    wanted = {c['file'] for c in clips}
    removed = []
    for folder in (VOICE_DIR, RAW_DIR):
        for name in os.listdir(folder):
            if (name.endswith('.mp3') and name not in wanted) or name.endswith('.part'):
                os.remove(os.path.join(folder, name))
                removed.append(name)
    for name in list(cache):
        if name not in wanted:
            cache.pop(name)
    write_json(CACHE_PATH, cache)

    # Manifest (SPEC 4.6). Only clips whose final file exists are listed.
    cats_cfg = profiles.get('categories', {})
    defaults = profiles.get('defaults', {'priority': 1, 'cooldown': 6})
    cats = {}
    sizes = []
    for c in clips:
        path = os.path.join(VOICE_DIR, c['file'])
        if not ok_file(path):
            continue
        dur = round(MP3(path).info.length, 2)
        sizes.append((c['file'], os.path.getsize(path), dur))
        cfg = cats_cfg.get(c['cat'], defaults)
        entry = cats.setdefault(c['cat'], {
            'priority': int(cfg.get('priority', defaults['priority'])),
            'cooldown': cfg.get('cooldown', defaults['cooldown']),
            'clips': []})
        clip_entry = {'f': c['file'], 'who': c['who'], 'text': c['text'], 'dur': dur}
        pg = cache.get(c['file'], {}).get('play_gain_db')
        if pg is not None and cache.get(c['file'], {}).get('final') == c['final_hash']:
            clip_entry['play_gain_db'] = pg
        entry['clips'].append(clip_entry)
    write_json(MANIFEST_PATH, {'cats': cats})

    total = sum(s for _, s, _ in sizes)
    missing = sorted(set(profiles.get('required_categories', [])) - set(cats))
    print('--- summary ---')
    print('clips: %d in %d categories' % (len(sizes), len(cats)))
    print('total mp3: %.2f MB' % (total / 1048576.0))
    if sizes:
        longest = max(sizes, key=lambda x: x[2])
        durs = [d for _, _, d in sizes]
        print('longest clip: %s (%.2f s)' % (longest[0], longest[2]))
        print('total audio: %.1f s, mean %.2f s' % (sum(durs), sum(durs) / len(durs)))
    if removed:
        print('removed orphans/temp files: %d' % len(removed))
    print('missing categories: %s' % (', '.join(missing) if missing else 'none'))
    if failed:
        print('FAILED clips:')
        for f, err in failed:
            print('  %s: %s' % (f, err))
        sys.exit(1)


if __name__ == '__main__':
    main()
