#!/usr/bin/env python3
"""Verify assets/voice/manifest.json against SPEC 4.5 / 4.6.

Usage: python tests/voice_check.py [--verbose]
Exit code 1 when any check fails. Warnings never fail the run.
All files are read as UTF-8; the report is printed with a safe fallback for consoles that cannot show Hungarian letters.
The Hungarian voice is frozen (SPEC 4.6): the manifest and every mp3 must match assets/voice/FROZEN.sha256 (the published clips).
"""
import argparse
import hashlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOICE = os.path.join(ROOT, 'assets', 'voice')

# SPEC 4.5, frozen ids.
REQUIRED = (
    'welcome howto hint_launch hint_flippers ball_ready launch '
    'ball_2 ball_3 ball_4 ball_5 last_ball balls_left_1 balls_left_2 balls_left_3 balls_left_4 '
    'ghost_piri ghost_rozi ghost_kiki ghost_nori ghost_bonk combo_3 combo_5 combo_10 dots_nyam pellet power_end '
    'fruit_cherry fruit_strawberry fruit_orange fruit_apple fruit_pear fruit_grapes level_clear '
    'spinner tunnel hole_enter lock_ball multiball multiball_end lane_done mult_2 mult_3 mult_4 mult_5 mystery '
    'surprise_bigflip surprise_slow surprise_balloons surprise_fruits surprise_dance surprise_shield surprise_extraball surprise_end '
    'balloon_pop star ballsave drain praise nudge over over_stars_1 over_stars_2 over_stars_3 newrecord play_again pause resume'
).split()
# Categories that may have a single variant (one-off moments).
ONE_OFFS = {'welcome', 'last_ball', 'level_clear', 'newrecord', 'multiball_end'}
# Suggested priorities from SPEC 4.5 (a category may be raised or lowered, but a change is reported as a warning).
SUGGESTED_PRIORITY = {
    'welcome': 3, 'howto': 2, 'hint_launch': 1, 'hint_flippers': 1, 'ball_ready': 2, 'launch': 0, 'last_ball': 3,
    'ghost_piri': 0, 'ghost_rozi': 0, 'ghost_kiki': 0, 'ghost_nori': 1, 'ghost_bonk': 1,
    'combo_3': 1, 'combo_5': 1, 'combo_10': 1, 'dots_nyam': 0, 'pellet': 2, 'power_end': 1, 'level_clear': 2,
    'spinner': 0, 'tunnel': 1, 'hole_enter': 1, 'lock_ball': 2, 'multiball': 3, 'multiball_end': 1,
    'lane_done': 2, 'mystery': 2, 'surprise_end': 0, 'balloon_pop': 0, 'star': 0, 'ballsave': 3, 'drain': 2,
    'praise': 1, 'nudge': 1, 'over': 3, 'newrecord': 3, 'play_again': 2, 'pause': 1, 'resume': 1,
}
for n in range(2, 6):
    SUGGESTED_PRIORITY['ball_%d' % n] = 2
    SUGGESTED_PRIORITY['mult_%d' % n] = 2
for n in range(1, 5):
    SUGGESTED_PRIORITY['balls_left_%d' % n] = 1
for k in 'cherry strawberry orange apple pear grapes'.split():
    SUGGESTED_PRIORITY['fruit_' + k] = 2
for k in 'bigflip slow balloons fruits dance shield extraball'.split():
    SUGGESTED_PRIORITY['surprise_' + k] = 3
for n in range(1, 4):
    SUGGESTED_PRIORITY['over_stars_%d' % n] = 3

MAX_TOTAL_BYTES = 6 * 1024 * 1024
MIN_DUR, MAX_DUR = 0.3, 8.0
MAX_TEXT = 90
DASHES = ('—', '–', '‒', '―')
SPEAKERS = {'noemi', 'tamas', 'piri', 'rozi', 'kiki', 'nori', 'pekmen'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--verbose', action='store_true', help='print every clip')
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

    errors, warns = [], []

    def err(msg):
        errors.append(msg)

    def warn(msg):
        warns.append(msg)

    mpath = os.path.join(VOICE, 'manifest.json')
    if not os.path.exists(mpath):
        print('FAIL: %s does not exist (run python tools/gen_voice.py)' % mpath)
        return 1
    with open(mpath, 'r', encoding='utf-8') as f:
        manifest = json.load(f)
    cats = manifest.get('cats')
    if not isinstance(cats, dict) or not cats:
        print('FAIL: manifest has no "cats" object')
        return 1

    try:
        from mutagen.mp3 import MP3
    except ImportError:
        MP3 = None
        warn('mutagen missing: durations are not cross-checked')
    try:
        import numpy as np
        import av
    except ImportError:
        np = av = None
        warn('numpy/av missing: level and silence checks skipped')

    def decode(path):
        c = av.open(path)
        s = c.streams.audio[0]
        parts = []
        for fr in c.decode(s):
            a = fr.to_ndarray().astype(np.float32)
            parts.append(a.reshape(-1) if a.ndim == 1 else a.mean(axis=0))
        c.close()
        return np.concatenate(parts), s.rate

    for cat in REQUIRED:
        if cat not in cats:
            err('missing category: %s' % cat)

    listed = set()
    total = 0
    n_clips = 0
    durs = []
    by_who = {}
    rows = []
    for cat, entry in sorted(cats.items()):
        if cat not in REQUIRED:
            warn('%s: not a SPEC 4.5 category (fine if a script_extra added it)' % cat)
        clips = entry.get('clips') or []
        pr, cd = entry.get('priority'), entry.get('cooldown')
        if not isinstance(pr, int) or not 0 <= pr <= 3:
            err('%s: priority must be an integer 0..3, got %r' % (cat, pr))
        if not isinstance(cd, (int, float)) or cd < 0:
            err('%s: cooldown must be a number >= 0, got %r' % (cat, cd))
        if isinstance(pr, int) and pr == 3 and cd != 0:
            err('%s: priority 3 must have cooldown 0, got %r' % (cat, cd))
        if cat in SUGGESTED_PRIORITY and pr != SUGGESTED_PRIORITY[cat]:
            warn('%s: priority %r differs from the SPEC suggestion %d' % (cat, pr, SUGGESTED_PRIORITY[cat]))
        if len(clips) < 1:
            err('%s: no clips' % cat)
        elif len(clips) < 2 and cat not in ONE_OFFS:
            err('%s: only %d variant (need at least 2)' % (cat, len(clips)))
        if len(clips) > 8:
            warn('%s: %d variants (a lot; fine for chatter)' % (cat, len(clips)))
        cat_durs = []
        for clip in clips:
            f = clip.get('f')
            text, who, dur = clip.get('text', ''), clip.get('who'), clip.get('dur')
            where = '%s/%s' % (cat, f)
            n_clips += 1
            if who not in SPEAKERS:
                err('%s: unknown speaker %r' % (where, who))
            by_who.setdefault(who, []).append(dur if isinstance(dur, (int, float)) else 0)
            if not text:
                err('%s: empty text' % where)
            if len(text) > MAX_TEXT:
                err('%s: text longer than %d characters (%d)' % (where, MAX_TEXT, len(text)))
            if any(d in text for d in DASHES):
                err('%s: dash character in text' % where)
            if re.search(r'!!|\?\?', text):
                err('%s: doubled exclamation or question mark' % where)
            if re.search(r'\d', text):
                warn('%s: digits in text' % where)
            if not isinstance(dur, (int, float)):
                err('%s: dur missing' % where)
                continue
            if f in listed:
                err('%s: file listed twice' % where)
            listed.add(f)
            path = os.path.join(VOICE, f or '')
            if not f or not os.path.isfile(path):
                err('%s: mp3 file missing' % where)
                continue
            size = os.path.getsize(path)
            total += size
            if size < 500:
                err('%s: mp3 is empty or tiny (%d bytes)' % (where, size))
                continue
            if not MIN_DUR <= dur <= MAX_DUR:
                err('%s: duration %.2f s outside %.1f..%.1f' % (where, dur, MIN_DUR, MAX_DUR))
            durs.append(dur)
            cat_durs.append(dur)
            words = len(text.split())
            syl = len(re.findall(r'[aáeéiíoóöőuúüű]', text.lower()))
            limit = 0.8 + 0.45 * syl  # generous: about 2.2 syllables per second including pauses
            if dur > limit:
                err('%s: %d words / %d syllables but %.2f s long, limit %.2f (silence not trimmed?)' % (where, words, syl, dur, limit))
            elif dur > 0.6 + 0.36 * syl:
                warn('%s: slow line, %d syllables in %.2f s' % (where, syl, dur))
            if cat.startswith('ghost_') and cat != 'ghost_nori' and words > 4:
                warn('%s: ghost line with %d words (aim for 1 to 4)' % (where, words))
            if MP3 is not None:
                try:
                    real = MP3(path).info.length
                    if abs(real - dur) > 0.06:
                        err('%s: manifest dur %.2f but file is %.2f s' % (where, dur, real))
                except Exception as ex:
                    err('%s: not a valid mp3 (%s)' % (where, ex))
                    continue
            if np is not None:
                try:
                    x, sr = decode(path)
                except Exception as ex:
                    err('%s: cannot decode (%s)' % (where, ex))
                    continue
                pk = float(np.abs(x).max())
                if pk < 0.05:
                    err('%s: nearly silent (peak %.3f)' % (where, pk))
                if pk > 0.95:
                    err('%s: peak %.2f is clipping' % (where, pk))
                head = np.where(np.abs(x) > 0.02 * pk)[0]
                if len(head) and head[0] / sr > 0.2:
                    err('%s: %.2f s of silence before the voice starts' % (where, head[0] / sr))
                if len(head) and (len(x) - head[-1]) / sr > 0.4:
                    warn('%s: %.2f s of silence at the end' % (where, (len(x) - head[-1]) / sr))
            if args.verbose:
                print('  %-26s %-7s %5.2f s  %s' % (f, who, dur, text))
        rows.append((cat, len(clips), pr, cd, min(cat_durs) if cat_durs else 0, max(cat_durs) if cat_durs else 0))

    # Files on disk that the manifest does not know.
    for name in sorted(os.listdir(VOICE)):
        if name.endswith('.mp3') and name not in listed:
            err('orphan mp3 not in the manifest: %s' % name)

    # The frozen Hungarian voice: the manifest and every mp3 byte for byte as listed in FROZEN.sha256 (shasum -a 256 format).
    frozen = os.path.join(VOICE, 'FROZEN.sha256')
    if not os.path.exists(frozen):
        err('assets/voice/FROZEN.sha256 is missing (the Hungarian voice is frozen)')
    else:
        want = {}
        with open(frozen, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    h, name = line.rstrip('\n').split('  ', 1)
                    want[name] = h
        have = set(n for n in os.listdir(VOICE) if n.endswith('.mp3') or n == 'manifest.json')
        for name in sorted(have | set(want)):
            p = os.path.join(VOICE, name)
            if name not in want:
                err('frozen voice: %s is not in FROZEN.sha256' % name)
            elif name not in have:
                err('frozen voice: %s is missing' % name)
            else:
                with open(p, 'rb') as f:
                    if hashlib.sha256(f.read()).hexdigest() != want[name]:
                        err('frozen voice: %s differs from FROZEN.sha256' % name)

    if total > MAX_TOTAL_BYTES:
        err('total mp3 size %.2f MB is over the %.0f MB budget' % (total / 1048576.0, MAX_TOTAL_BYTES / 1048576.0))

    # Report
    print('%-20s %4s %3s %5s   %s' % ('category', 'n', 'pri', 'cool', 'duration range'))
    for cat, n, pr, cd, lo, hi in rows:
        print('%-20s %4d %3s %5s   %.2f to %.2f s' % (cat, n, pr, cd, lo, hi))
    print()
    print('categories: %d (required %d), clips: %d, total %.2f MB' % (len(cats), len(REQUIRED), n_clips, total / 1048576.0))
    if durs:
        durs_sorted = sorted(durs)
        print('duration: min %.2f, median %.2f, mean %.2f, max %.2f s, total %.0f s' % (
            durs_sorted[0], durs_sorted[len(durs_sorted) // 2], sum(durs) / len(durs), durs_sorted[-1], sum(durs)))
    print('by speaker: ' + ', '.join('%s %d clips (mean %.2f s)' % (w, len(v), sum(v) / len(v)) for w, v in sorted(by_who.items())))
    for w in warns:
        print('warning: ' + w)
    for e in errors:
        print('FAIL: ' + e)
    print()
    print('RESULT: %s (%d error(s), %d warning(s))' % ('FAIL' if errors else 'OK', len(errors), len(warns)))
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
