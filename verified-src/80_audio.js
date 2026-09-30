/* 80_audio.js: sound engine, synthesized SFX, original music, Hungarian voice player. Browser only.
   Replaces the silent PM.Audio stand-in from 00_ns.js (API: SPEC 4.5).

   Layout of this file:
     1. pitch helpers and the C major pentatonic scale
     2. SONG DATA: key, tempo, chords, melodies (readable tables, description of every mode)
     3. synthesis primitives (envelope, tone, noise) and music instruments
     4. SFX definitions (every name the game calls)
     5. audio graph (buses, gentle compressor, soft limiter, small reverb for the music)
     6. music sequencer (lookahead scheduler, works live and offline)
     7. voice player (decode, index, priority, cooldown, queue, ducking)
     8. engine and public API, offline debug renderers

   Everything is built from oscillators, envelopes, filters and short noise bursts. Nothing is sampled.
   Every public method fails silently: the game must keep working with no sound at all. */
(function (g) {
  'use strict';
  const PM = g.PM = g.PM || {};
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ============================================================================================
  // 1. Pitch helpers
  // ============================================================================================
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const PENT_PC = [0, 2, 4, 7, 9];                     // C D E G A
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midi = (name) => {
    const m = /^([A-G])(\d)$/.exec(name);
    if (!m) throw new Error('bad note name ' + name);
    return PC[m[1]] + 12 * (parseInt(m[2], 10) + 1);   // C4 = 60
  };
  // Nearest pentatonic frequency (used when the game bends a chime with `rate`).
  function snapPent(f) {
    const m = 69 + 12 * Math.log2(f / 440);
    let best = Math.round(m), bd = 99;
    for (let k = Math.floor(m) - 3; k <= Math.ceil(m) + 3; k++) {
      if (PENT_PC.indexOf(((k % 12) + 12) % 12) < 0) continue;
      const d = Math.abs(k - m);
      if (d < bd) { bd = d; best = k; }
    }
    return mtof(best);
  }

  // ============================================================================================
  // 2. SONG DATA (edit here to change the music)
  // ============================================================================================
  // Key: C major pentatonic (C D E G A). All lead and bell notes stay inside it, so nothing can clash.
  // Time: 4/4, 16 steps (sixteenth notes) per bar. Melody strings are "NOTE:steps" tokens ("R" = rest);
  // every bar must add up to 16 steps (validateSong() checks it). A dotted quarter is 6 steps, then an
  // eighth of 2 steps: that is the little dotted lilt.
  //
  // Modes:
  //   menu      8-bar music box, sparse melody, one soft bass note per bar. Loops.       96 BPM
  //   play      A (8 bars) + B (8 bars) = 16-bar loop. Four passes alternate the variants:
  //             pass 0 = A B, pass 1 = A2 B, pass 2 = A B2, pass 3 = A2 B2 (64 bars, about 2.7 min).
  //             Lead = soft sine/triangle pluck, bass = triangle root/fifth, bell arpeggio on odd
  //             passes (a single chime on even ones), light kick and shaker.               96 BPM
  //   power     same harmony and same bar position as play, lead one octave higher and brighter,
  //             marimba layer under it, steady quarter-note bass, shaker on every eighth. 106 BPM (10% faster)
  //   surprise  same harmony, bouncy: staccato marimba lead, oom-pah bass, shuffled offbeats, snaps. 100 BPM
  //   gameover  4-bar warm lullaby (about 10 s) that resolves on a long C chord and then stops.  96 BPM
  // play, power and surprise share the bar counter, so switching between them keeps the song going.
  const SONG = {
    key: 'C major pentatonic',
    stepsPerBar: 16,
    bpm: { menu: 96, play: 96, power: 106, surprise: 100, gameover: 96 },
    // root and fifth are the bass notes (MIDI); arp is the bell arpeggio (all pentatonic)
    chords: {
      C:  { root: 48, fifth: 55, arp: [72, 76, 79, 76], tones: [0, 4, 7] },
      Am: { root: 45, fifth: 52, arp: [69, 72, 76, 72], tones: [9, 0, 4] },
      F:  { root: 41, fifth: 48, arp: [69, 72, 76, 72], tones: [5, 9, 0] },
      G:  { root: 43, fifth: 50, arp: [67, 74, 79, 74], tones: [7, 11, 2] },
      Dm: { root: 50, fifth: 45, arp: [69, 74, 72, 74], tones: [2, 5, 9] }
    },
    // chord per bar; two names in one bar = first half, second half
    harmony: {
      A:    [['C'], ['Am'], ['F'], ['G'], ['C'], ['Am'], ['F', 'G'], ['C']],
      B:    [['Dm'], ['G'], ['C'], ['Am'], ['Dm'], ['G'], ['F', 'G'], ['C']],
      menu: [['C'], ['Am'], ['F'], ['G'], ['C'], ['Am'], ['F'], ['G']],
      over: [['C'], ['Am'], ['F', 'G'], ['C']]
    },
    melody: {
      // A: question (bars 1-4) and answer (bars 5-8), ends on the tonic
      A: [
        'E5:6 D5:2 C5:4 G4:4',
        'A4:6 C5:2 E5:4 D5:2 C5:2',
        'A4:6 G4:2 A4:4 C5:4',
        'D5:6 E5:2 D5:4 G4:4',
        'E5:6 G5:2 A5:4 G5:4',
        'E5:6 D5:2 C5:4 A4:4',
        'A4:4 C5:4 D5:6 G4:2',
        'C5:12 R:4'
      ],
      // A2: same skeleton, busier eighth notes
      A2: [
        'E5:4 D5:2 C5:2 D5:2 E5:2 G4:4',
        'A4:4 C5:2 E5:2 D5:4 C5:4',
        'A4:4 G4:2 A4:2 C5:4 A4:4',
        'D5:4 E5:2 D5:2 C5:2 D5:2 G4:4',
        'E5:4 G5:2 E5:2 G5:4 A5:4',
        'E5:4 G5:2 E5:2 D5:4 C5:4',
        'A4:2 C5:2 A4:2 C5:2 D5:4 E5:2 D5:2',
        'C5:8 G4:4 C5:4'
      ],
      // B: contrast section (ii V I vi), ends with the classic E D C
      B: [
        'D5:6 A4:2 D5:4 E5:4',
        'D5:6 G4:2 A4:4 D5:4',
        'E5:6 G5:2 E5:4 D5:4',
        'C5:6 E5:2 A5:4 G5:4',
        'A5:6 G5:2 E5:4 D5:4',
        'D5:4 G5:4 D5:4 G4:4',
        'A4:4 C5:4 D5:4 G4:4',
        'E5:6 D5:2 C5:8'
      ],
      // B2: more drive, rising and falling arpeggios
      B2: [
        'A4:4 D5:4 E5:4 D5:4',
        'D5:2 D5:2 G4:4 A4:4 D5:4',
        'G4:4 C5:4 E5:4 G5:4',
        'A5:4 G5:4 E5:4 C5:4',
        'D5:6 E5:2 D5:4 A4:4',
        'D5:6 G5:2 D5:4 E5:4',
        'C5:4 A4:4 D5:2 E5:2 D5:4',
        'G4:4 E5:4 C5:8'
      ],
      menu: [
        'E5:8 G5:4 E5:4',
        'C5:8 E5:4 D5:4',
        'A4:8 C5:4 A4:4',
        'D5:6 E5:2 D5:8',
        'E5:8 G5:4 A5:4',
        'E5:6 G5:2 C5:8',
        'A4:4 C5:4 D5:4 C5:4',
        'D5:6 C5:2 G4:8'
      ],
      // gameover: bar 4 holds C5, the final chord rings under it
      over: [
        'G4:4 C5:4 E5:8',
        'E5:6 C5:2 A4:8',
        'A4:4 C5:4 D5:4 G4:4',
        'E5:4 D5:4 C5:8'
      ]
    },
    // which harmony each melody belongs to
    melodyHarmony: { A: 'A', A2: 'A', B: 'B', B2: 'B', menu: 'menu', over: 'over' },
    // bass rhythm per mode: [step, 'r' root | 'f' fifth, length in steps]; half-bar patterns for two-chord bars
    bass: {
      play:     { full: [[0, 'r', 6], [6, 'f', 2], [8, 'r', 4], [12, 'f', 4]], half: [[0, 'r', 4], [4, 'f', 4]] },
      power:    { full: [[0, 'r', 4], [4, 'f', 4], [8, 'r', 4], [12, 'f', 4]], half: [[0, 'r', 4], [4, 'f', 4]] },
      surprise: { full: [[0, 'r', 2], [4, 'f', 2], [8, 'r', 2], [12, 'f', 2]], half: [[0, 'r', 2], [4, 'f', 2]] }
    }
  };

  // gain: per-mode loudness match, measured so that every mode sits at about -22 dBFS RMS (tests/audio_analysis.js)
  const MODES = {
    menu:     { bpm: SONG.bpm.menu,     song: false, bars: 8, loop: true,  gain: 1.19 },
    play:     { bpm: SONG.bpm.play,     song: true,  gain: 0.93 },
    power:    { bpm: SONG.bpm.power,    song: true,  gain: 1.26 },
    surprise: { bpm: SONG.bpm.surprise, song: true,  gain: 1.32 },
    gameover: { bpm: SONG.bpm.gameover, song: false, bars: 4, loop: false, gain: 1.00 }
  };
  const SONG_BARS = 64;

  // Parse the melody strings once into 16-slot bars.
  const LEAD = {};
  function parseBar(str) {
    const slots = new Array(16).fill(null);
    let pos = 0;
    str.split(/\s+/).forEach((tok) => {
      const p = tok.split(':');
      const len = parseInt(p[1], 10);
      if (p[0] !== 'R' && pos < 16) slots[pos] = { m: midi(p[0]), len: len };
      pos += len;
    });
    return { slots: slots, total: pos };
  }
  Object.keys(SONG.melody).forEach((name) => {
    LEAD[name] = SONG.melody[name].map((s) => parseBar(s));
  });

  // Returns a list of problems (empty = fine). Used by tests/audio_analysis.js.
  function validateSong() {
    const bad = [];
    Object.keys(SONG.melody).forEach((name) => {
      const hName = SONG.melodyHarmony[name];
      const harm = SONG.harmony[hName];
      if (harm.length !== SONG.melody[name].length) bad.push(name + ': bar count differs from harmony ' + hName);
      let down = 0, downOk = 0;
      SONG.melody[name].forEach((str, b) => {
        const bar = LEAD[name][b];
        if (bar.total !== 16) bad.push(name + ' bar ' + (b + 1) + ' adds up to ' + bar.total + ' steps');
        bar.slots.forEach((n) => {
          if (n && PENT_PC.indexOf(n.m % 12) < 0) bad.push(name + ' bar ' + (b + 1) + ' has a note outside the pentatonic scale: ' + n.m);
        });
        const first = bar.slots[0];
        if (first && harm[b]) {
          down++;
          if (SONG.chords[harm[b][0]].tones.indexOf(first.m % 12) >= 0) downOk++;
        }
      });
      if (down && downOk / down < 0.85) bad.push(name + ': only ' + downOk + ' of ' + down + ' bar starts are chord tones');
    });
    Object.keys(SONG.harmony).forEach((k) => {
      SONG.harmony[k].forEach((bar) => bar.forEach((c) => { if (!SONG.chords[c]) bad.push('unknown chord ' + c); }));
    });
    Object.keys(SONG.chords).forEach((c) => {
      SONG.chords[c].arp.forEach((m) => { if (PENT_PC.indexOf(m % 12) < 0) bad.push('arp of ' + c + ' has ' + m); });
    });
    Object.keys(MODES).forEach((k) => { if (MODES[k].bpm < 96 || MODES[k].bpm > 108) bad.push('tempo of ' + k + ' out of 96..108'); });
    return bad;
  }

  // ============================================================================================
  // 3. Synthesis primitives
  // ============================================================================================
  // Soft attack, exponential decay (time constant tau) until `hold`, then a short linear release to zero.
  function envelope(p, t, a, peak, hold, tau, rel) {
    p.value = 0;                      // a gain node starts at 1: without this a start that falls between two samples leaks one loud sample
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    if (hold > a + 0.001) {
      const end = Math.max(peak * Math.exp(-(hold - a) / tau), 1e-4);
      p.exponentialRampToValueAtTime(end, t + hold);
    }
    p.linearRampToValueAtTime(0, t + Math.max(hold, a + 0.001) + rel);
  }

  const ONE = [[1, 1, 1]];                                  // partial: [ratio, amplitude, decay scale]
  const BELL = [[1, 1, 1], [2, 0.28, 0.45], [3, 0.10, 0.25]];
  const MARIMBA = [[1, 1, 1], [4, 0.22, 0.15]];
  const SOFT = [[1, 1, 1], [2, 0.18, 0.5]];

  // One note: oscillator(s) -> envelope -> optional low-pass -> e.out.
  // o: {t, f | path:[[dt,f],...], type, peak, a, hold, tau, rel, lp, q, det, partials, dest, tag}
  // tag only labels the note for the scheduler test (env.rec collects {tag, t, f}).
  function tone(e, o) {
    const ctx = e.ctx, t = o.t;
    if (e.rec) e.rec.push({ tag: o.tag || '', t: t, f: o.path ? o.path[0][1] : o.f, peak: o.peak, hold: o.hold });
    const a = Math.max(o.a == null ? 0.004 : o.a, 0.003);
    const hold = Math.max(o.hold, a + 0.002);
    const rel = o.rel == null ? 0.03 : o.rel;
    const tau = o.tau || hold * 0.4;
    let dest = o.dest || e.out;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = o.q || 0.6;
      f.connect(dest); dest = f;
    }
    const parts = o.partials || ONE;
    const path = o.path || [[0, o.f]];
    const stopT = t + hold + rel + 0.02;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const osc = ctx.createOscillator();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(path[0][1] * p[0], t);
      for (let k = 1; k < path.length; k++) osc.frequency.exponentialRampToValueAtTime(path[k][1] * p[0], t + path[k][0]);
      if (o.det) osc.detune.value = o.det;
      const gn = ctx.createGain();
      envelope(gn.gain, t, a, o.peak * p[1], hold, tau * (p[2] || 1), rel);
      osc.connect(gn); gn.connect(dest);
      osc.start(t); osc.stop(stopT);
    }
  }

  // Short filtered noise burst (clicks, pops, shakers, wood ticks).
  function noise(e, o) {
    const ctx = e.ctx, t = o.t;
    if (e.rec) e.rec.push({ tag: o.tag || 'noise', t: t, f: o.f, peak: o.peak, hold: o.hold });
    const a = Math.max(o.a == null ? 0.002 : o.a, 0.002);
    const hold = Math.max(o.hold, a + 0.002);
    const rel = o.rel == null ? 0.01 : o.rel;
    const src = ctx.createBufferSource();
    src.buffer = e.noise; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass'; f.frequency.value = o.f || 1000; f.Q.value = o.q || 0.8;
    const gn = ctx.createGain();
    envelope(gn.gain, t, a, o.peak, hold, o.tau || hold * 0.4, rel);
    src.connect(f); f.connect(gn); gn.connect(o.dest || e.out);
    src.start(t, o.off || 0); src.stop(t + hold + rel + 0.02);
  }

  // ---- music instruments (levels are relative; the music bus trim sets the final loudness)
  function instLead(e, t, m, dur, mode, vel) {
    if (mode === 'surprise') {
      tone(e, { tag: 'lead', t: t, f: mtof(m), partials: MARIMBA, peak: 0.18 * vel, a: 0.004, hold: 0.30, tau: 0.11, rel: 0.04, lp: 3400 });
      return;
    }
    if (mode === 'power') {
      const f = mtof(m + 12);
      tone(e, { tag: 'lead', t: t, f: f, peak: 0.115 * vel, a: 0.006, hold: dur * 0.9, tau: 0.30, rel: 0.08, lp: 4200 });
      tone(e, { t: t, f: f, type: 'triangle', det: 5, peak: 0.045 * vel, a: 0.006, hold: dur * 0.9, tau: 0.24, rel: 0.08, lp: 4200 });
      tone(e, { t: t, f: f * 2, peak: 0.022 * vel, a: 0.004, hold: 0.35, tau: 0.10, rel: 0.05, lp: 5000 });
      return;
    }
    const f = mtof(m);
    tone(e, { tag: 'lead', t: t, f: f, peak: 0.17 * vel, a: 0.006, hold: dur * 0.95, tau: 0.32, rel: 0.09, lp: 2600 });
    tone(e, { t: t, f: f, type: 'triangle', det: 5, peak: 0.06 * vel, a: 0.006, hold: dur * 0.95, tau: 0.25, rel: 0.09, lp: 2600 });
  }
  function instBass(e, t, m, dur, mode) {
    const bouncy = mode === 'surprise';
    tone(e, { tag: 'bass', t: t, f: mtof(m), type: 'triangle', peak: mode === 'power' ? 0.10 : 0.13, a: 0.01, hold: Math.max(dur * (bouncy ? 0.8 : 0.92), 0.05), tau: bouncy ? 0.12 : 0.35, rel: 0.06, lp: 700 });
  }
  function instBell(e, t, m, vel, tau, peak, tag) {
    tone(e, { tag: tag || 'bell', t: t, f: mtof(m), partials: BELL, peak: (peak || 0.10) * vel, a: 0.004, hold: tau * 4, tau: tau, rel: 0.05, lp: 5000 });
  }
  function instMarimba(e, t, m, vel) {
    tone(e, { tag: 'marim', t: t, f: mtof(m), partials: MARIMBA, peak: 0.10 * vel, a: 0.004, hold: 0.32, tau: 0.12, rel: 0.04, lp: 3400 });
  }
  function instKick(e, t, vel) {
    tone(e, { tag: 'kick', t: t, path: [[0, 110], [0.10, 48]], peak: 0.16 * vel, a: 0.004, hold: 0.18, tau: 0.06, rel: 0.02, lp: 400 });
  }
  function instShaker(e, t, vel) {
    noise(e, { tag: 'shaker', t: t, type: 'bandpass', f: 6500, q: 0.9, peak: 0.06 * vel, a: 0.005, hold: 0.06, tau: 0.02 });
  }
  function instTick(e, t, vel) {
    tone(e, { tag: 'tick', t: t, f: mtof(88), peak: 0.05 * vel, a: 0.003, hold: 0.05, tau: 0.012, rel: 0.01 });
  }
  function instSnap(e, t, vel) {
    noise(e, { tag: 'snap', t: t, type: 'bandpass', f: 1800, q: 1.2, peak: 0.05 * vel, a: 0.003, hold: 0.09, tau: 0.03 });
  }

  // ============================================================================================
  // 4. SFX (all tuned to C major pentatonic, soft attacks, mostly under 400 ms)
  // ============================================================================================
  // def(name, {gap: min seconds between two starts, cap: max simultaneous, dur: rough length, g: level trim,
  //            notes: declared pitches (MIDI) for the scale test, important: never dropped by the global cap}, fn(e, t))
  // e: {ctx, out, noise, rate, state}. e.rate is the game's pitch multiplier.
  const SFX = {};
  function def(name, o, fn) {
    SFX[name] = Object.assign({ gap: 0.03, cap: 4, dur: 0.4, g: 1, notes: null, important: false }, o, { fn: fn });
  }
  const F = (e, m) => mtof(m) * e.rate;

  def('flipper_up', { gap: 0.05, cap: 2, dur: 0.12, notes: [57, 45] }, (e, t) => {
    tone(e, { t: t, path: [[0, 220 * e.rate], [0.06, 110 * e.rate]], peak: 0.30, a: 0.003, hold: 0.10, tau: 0.03, rel: 0.02, lp: 1400 });
    noise(e, { t: t, type: 'bandpass', f: 1100, q: 1.2, peak: 0.05, a: 0.002, hold: 0.02, tau: 0.008 });
  });
  def('flipper_down', { gap: 0.05, cap: 2, dur: 0.10, notes: [52, 45] }, (e, t) => {
    tone(e, { t: t, path: [[0, F(e, 52)], [0.05, F(e, 45)]], peak: 0.14, a: 0.004, hold: 0.07, tau: 0.025, rel: 0.02, lp: 1200 });
  });
  def('plunger_charge', { gap: 0.045, cap: 3, dur: 0.06 }, (e, t) => {
    const r = clamp(e.rate, 0.5, 3);
    noise(e, { t: t, type: 'bandpass', f: 1500 * r, q: 3, peak: 0.07, a: 0.002, hold: 0.02, tau: 0.008 });
    tone(e, { t: t, f: 250 * r, type: 'triangle', peak: 0.06, a: 0.003, hold: 0.035, tau: 0.012, rel: 0.01, lp: 1600 });
  });
  def('plunger_release', { gap: 0.2, cap: 1, dur: 0.3, notes: [55, 67, 64] }, (e, t) => {
    tone(e, { t: t, path: [[0, F(e, 55)], [0.13, F(e, 67)], [0.24, F(e, 64)]], peak: 0.30, a: 0.01, hold: 0.26, tau: 0.12, rel: 0.04, lp: 1800 });
    noise(e, { t: t, type: 'lowpass', f: 1400, q: 0.7, peak: 0.06, a: 0.02, hold: 0.2, tau: 0.08, rel: 0.03 });
  });
  [['bumper_piri', 67], ['bumper_rozi', 69], ['bumper_kiki', 72]].forEach((b) => {
    def(b[0], { gap: 0.045, cap: 3, dur: 0.35, notes: [b[1]] }, (e, t) => {
      const f = F(e, b[1]);
      tone(e, { t: t, path: [[0, f * 0.94], [0.035, f]], partials: MARIMBA, peak: 0.32, a: 0.004, hold: 0.32, tau: 0.11, lp: 3200 });
      noise(e, { t: t, type: 'bandpass', f: 2000, q: 1, peak: 0.03, a: 0.002, hold: 0.012, tau: 0.005 });
    });
  });
  def('sling', { gap: 0.06, cap: 2, dur: 0.13, notes: [84] }, (e, t) => {
    [0, 0.05].forEach((d) => {
      tone(e, { t: t + d, path: [[0, F(e, 84)], [0.03, F(e, 84) * 0.97]], peak: 0.16, a: 0.003, hold: 0.035, tau: 0.01, rel: 0.01 });
      noise(e, { t: t + d, type: 'bandpass', f: 2500, q: 1.5, peak: 0.03, a: 0.002, hold: 0.01, tau: 0.004 });
    });
  });
  def('post', { gap: 0.04, cap: 2, dur: 0.06, notes: [79] }, (e, t) => {
    tone(e, { t: t, f: F(e, 79), peak: 0.10, a: 0.003, hold: 0.04, tau: 0.012, rel: 0.01 });
  });
  def('wall_soft', { gap: 0.08, cap: 2, dur: 0.1, notes: [45, 36] }, (e, t) => {
    tone(e, { t: t, path: [[0, 110 * e.rate], [0.07, 65.4 * e.rate]], peak: 0.14, a: 0.004, hold: 0.09, tau: 0.03, rel: 0.02, lp: 300 });
  });
  def('dot', { gap: 0.035, cap: 2, dur: 0.06, notes: [76, 72] }, (e, t) => {
    const m = (e.state.waka++ & 1) ? 72 : 76;             // E5, C5, E5, C5 ...
    tone(e, { t: t, f: F(e, m), type: 'triangle', peak: 0.20, a: 0.004, hold: 0.04, tau: 0.02, rel: 0.01, lp: 3000 });
  });
  def('pellet', { gap: 0.15, cap: 2, dur: 0.45, notes: [76, 79, 84] }, (e, t) => {
    [76, 79, 84].forEach((m, i) => {
      tone(e, { t: t + i * 0.06, f: F(e, m), partials: BELL, peak: 0.22, a: 0.004, hold: 0.32, tau: 0.12, lp: 5000 });
    });
  });
  def('power_start', { gap: 0.3, cap: 1, dur: 0.5, notes: [72, 76, 79, 84], important: true }, (e, t) => {
    [72, 76, 79, 84].forEach((m, i) => {
      tone(e, { t: t + i * 0.07, f: F(e, m), type: 'triangle', partials: SOFT, peak: 0.26, a: 0.005, hold: 0.16 + (i === 3 ? 0.1 : 0), tau: 0.07, lp: 3500 });
    });
  });
  def('power_end', { gap: 0.3, cap: 1, dur: 0.55, notes: [79, 76, 72] }, (e, t) => {
    [79, 76, 72].forEach((m, i) => {
      tone(e, { t: t + i * 0.11, f: F(e, m), partials: SOFT, peak: 0.20, a: 0.006, hold: 0.30, tau: 0.12, lp: 3000 });
    });
  });
  def('ghost_bonk', { gap: 0.1, cap: 2, dur: 0.3, notes: [64, 76, 69] }, (e, t) => {
    noise(e, { t: t, type: 'lowpass', f: 1000, q: 0.7, peak: 0.16, a: 0.003, hold: 0.03, tau: 0.012 });
    tone(e, { t: t, path: [[0, 500], [0.03, 150]], peak: 0.18, a: 0.003, hold: 0.04, tau: 0.015, lp: 1200 });
    tone(e, { t: t + 0.02, path: [[0, F(e, 64)], [0.08, F(e, 76)], [0.22, F(e, 69)]], partials: SOFT, peak: 0.26, a: 0.005, hold: 0.26, tau: 0.14, lp: 2800 });
  });
  def('fruit', { gap: 0.2, cap: 2, dur: 0.6, notes: [79, 84] }, (e, t) => {
    [79, 84].forEach((m, i) => {
      tone(e, { t: t + i * 0.1, f: F(e, m), partials: BELL, peak: 0.24, a: 0.004, hold: 0.45, tau: 0.18, lp: 5000 });
    });
  });
  def('spinner_tick', { gap: 0.03, cap: 3, dur: 0.03 }, (e, t) => {
    const r = clamp(e.rate, 0.5, 2.5);
    noise(e, { t: t, type: 'bandpass', f: 2600 * r, q: 4, peak: 0.09, a: 0.002, hold: 0.012, tau: 0.005 });
    tone(e, { t: t, f: 1800 * r, peak: 0.05, a: 0.003, hold: 0.015, tau: 0.006, rel: 0.008 });
  });
  def('target_hit', { gap: 0.06, cap: 2, dur: 0.14, notes: [81] }, (e, t) => {
    tone(e, { t: t, path: [[0, F(e, 81)], [0.03, F(e, 81) * 0.985]], partials: [[1, 1, 1], [2, 0.3, 0.4]], peak: 0.30, a: 0.003, hold: 0.09, tau: 0.03, rel: 0.02, lp: 3000 });
    noise(e, { t: t, type: 'bandpass', f: 1500, q: 2, peak: 0.12, a: 0.002, hold: 0.02, tau: 0.008 });
  });
  def('lane_light', { gap: 0.08, cap: 3, dur: 0.5, notes: [84] }, (e, t) => {
    tone(e, { t: t, f: snapPent(mtof(84) * e.rate), partials: BELL, peak: 0.22, a: 0.004, hold: 0.4, tau: 0.16, lp: 5000 });
  });
  def('lane_complete', { gap: 0.2, cap: 1, dur: 0.6, notes: [79, 84, 88], important: true }, (e, t) => {
    [79, 84, 88].forEach((m, i) => {
      tone(e, { t: t + i * 0.09, f: F(e, m), partials: BELL, peak: 0.22, a: 0.004, hold: 0.35, tau: 0.14, lp: 5000 });
    });
  });
  def('hole_enter', { gap: 0.2, cap: 1, dur: 0.3, notes: [79, 72, 67] }, (e, t) => {
    tone(e, { t: t, path: [[0, F(e, 79)], [0.05, F(e, 72)], [0.2, F(e, 67)]], partials: SOFT, peak: 0.30, a: 0.008, hold: 0.24, tau: 0.12, lp: 2500 });
  });
  def('hole_eject', { gap: 0.2, cap: 1, dur: 0.15, notes: [50, 74] }, (e, t) => {
    noise(e, { t: t, type: 'bandpass', f: 700, q: 2, peak: 0.20, a: 0.002, hold: 0.02, tau: 0.008 });
    tone(e, { t: t, path: [[0, F(e, 50)], [0.05, F(e, 74)]], peak: 0.28, a: 0.003, hold: 0.09, tau: 0.03, lp: 2500 });
  });
  def('tunnel_warp', { gap: 0.3, cap: 1, dur: 0.5, notes: [60, 84] }, (e, t) => {
    const trem = e.ctx.createGain();
    trem.gain.value = 0.8;
    const lfo = e.ctx.createOscillator(), lg = e.ctx.createGain();
    lfo.frequency.value = 14; lg.gain.value = 0.2;
    lfo.connect(lg); lg.connect(trem.gain);
    trem.connect(e.out);
    lfo.start(t); lfo.stop(t + 0.5);
    tone(e, { t: t, path: [[0, F(e, 60)], [0.4, F(e, 84)]], peak: 0.26, a: 0.08, hold: 0.40, tau: 0.25, rel: 0.05, lp: 3000, dest: trem });
    tone(e, { t: t, path: [[0, F(e, 60) * 1.007], [0.4, F(e, 84) * 1.007]], peak: 0.12, a: 0.08, hold: 0.40, tau: 0.25, rel: 0.05, lp: 3000, dest: trem });
  });
  def('ballsave', { gap: 0.4, cap: 1, dur: 0.6, notes: [64, 60, 81, 79], important: true }, (e, t) => {
    [0, 0.11].forEach((d) => {
      tone(e, { t: t + d, path: [[0, F(e, 64)], [0.06, F(e, 60)]], type: 'triangle', peak: 0.26, a: 0.004, hold: 0.07, tau: 0.03, rel: 0.02, lp: 2500 });
    });
    tone(e, { t: t + 0.26, path: [[0, F(e, 60)], [0.14, F(e, 81)], [0.22, F(e, 79)]], partials: SOFT, peak: 0.26, a: 0.006, hold: 0.26, tau: 0.13, lp: 3000 });
  });
  def('drain_soft', { gap: 0.3, cap: 1, dur: 0.6, notes: [76, 72], important: true }, (e, t) => {
    [76, 72].forEach((m, i) => {
      tone(e, { t: t + i * 0.17, f: F(e, m), partials: SOFT, peak: 0.24, a: 0.008, hold: 0.40, tau: 0.16, lp: 2500 });
    });
  });
  def('balloon_pop', { gap: 0.05, cap: 3, dur: 0.1 }, (e, t) => {
    noise(e, { t: t, type: 'lowpass', f: 2200 * e.rate, q: 0.7, peak: 0.28, a: 0.002, hold: 0.03, tau: 0.01 });
    tone(e, { t: t, path: [[0, 420 * e.rate], [0.04, 140 * e.rate]], peak: 0.15, a: 0.003, hold: 0.05, tau: 0.02, lp: 1500 });
  });
  def('star_collect', { gap: 0.08, cap: 3, dur: 0.6, notes: [88] }, (e, t) => {
    tone(e, { t: t, f: F(e, 88), partials: BELL, peak: 0.20, a: 0.004, hold: 0.45, tau: 0.2, lp: 5000 });
  });
  def('multiball_start', { gap: 0.5, cap: 1, dur: 0.9, notes: [72, 76, 79, 84], important: true }, (e, t) => {
    [[72, 0], [72, 0.09], [76, 0.18], [79, 0.29], [84, 0.42]].forEach((n, i) => {
      tone(e, { t: t + n[1], f: F(e, n[0]), type: 'triangle', partials: SOFT, peak: 0.24, a: 0.005, hold: i === 4 ? 0.45 : 0.14, tau: i === 4 ? 0.2 : 0.07, lp: 3500 });
    });
  });
  def('surprise_start', { gap: 0.5, cap: 1, dur: 1.0, notes: [72, 74, 76, 79, 81, 84, 86, 88, 91], important: true }, (e, t) => {
    [72, 74, 76, 79, 81, 84, 86, 88, 91].forEach((m, i) => {
      tone(e, { t: t + i * 0.045, f: F(e, m), partials: BELL, peak: 0.09 + i * 0.006, a: 0.004, hold: 0.36, tau: 0.12, lp: 5000 });
    });
  });
  def('surprise_end', { gap: 0.5, cap: 1, dur: 0.8, notes: [84, 79, 76] }, (e, t) => {
    [84, 79, 76].forEach((m, i) => {
      tone(e, { t: t + i * 0.11, f: F(e, m), partials: BELL, peak: 0.16, a: 0.005, hold: 0.5, tau: 0.2, lp: 5000 });
    });
  });
  def('extra_ball', { gap: 0.6, cap: 1, dur: 1.4, notes: [79, 81, 84, 88, 91], important: true }, (e, t) => {
    [79, 81, 84, 88].forEach((m, i) => {
      tone(e, { t: t + i * 0.09, f: F(e, m), type: 'triangle', partials: SOFT, peak: 0.22, a: 0.005, hold: 0.18, tau: 0.08, lp: 3800 });
    });
    [84, 88, 91].forEach((m) => {
      tone(e, { t: t + 0.38, f: F(e, m), partials: BELL, peak: 0.12, a: 0.006, hold: 0.9, tau: 0.4, lp: 5000 });
    });
  });
  def('level_up', { gap: 0.6, cap: 1, dur: 0.7, notes: [76, 79, 81, 84], important: true }, (e, t) => {
    [[76, 0], [79, 0.1], [81, 0.2], [84, 0.3]].forEach((n, i) => {
      tone(e, { t: t + n[1], f: F(e, n[0]), type: 'triangle', partials: SOFT, peak: 0.24, a: 0.005, hold: i === 3 ? 0.4 : 0.13, tau: i === 3 ? 0.18 : 0.07, lp: 3500 });
    });
  });
  def('game_start', { gap: 0.6, cap: 1, dur: 0.6, notes: [72, 76, 79], important: true }, (e, t) => {
    [72, 76, 79].forEach((m, i) => {
      tone(e, { t: t + i * 0.13, f: F(e, m), partials: SOFT, peak: 0.22, a: 0.006, hold: i === 2 ? 0.32 : 0.16, tau: i === 2 ? 0.14 : 0.08, lp: 3000 });
    });
  });
  def('game_over', { gap: 1, cap: 1, dur: 2.2, notes: [76, 74, 72, 60, 67, 48], important: true }, (e, t) => {
    [76, 74, 72].forEach((m, i) => {
      tone(e, { t: t + i * 0.24, f: F(e, m), partials: SOFT, peak: 0.22, a: 0.008, hold: 0.40, tau: 0.2, lp: 2800 });
    });
    [60, 67, 76].forEach((m) => {
      tone(e, { t: t + 0.74, f: F(e, m), partials: BELL, peak: 0.10, a: 0.01, hold: 1.2, tau: 0.6, lp: 4000 });
    });
    tone(e, { t: t + 0.74, f: F(e, 48), type: 'triangle', peak: 0.14, a: 0.02, hold: 1.2, tau: 0.7, lp: 400 });
  });
  def('highscore', { gap: 1, cap: 1, dur: 1.7, notes: [79, 84, 88, 91], important: true }, (e, t) => {
    [79, 84, 88, 91].forEach((m, i) => {
      tone(e, { t: t + i * 0.1, f: F(e, m), partials: BELL, peak: 0.18, a: 0.004, hold: 0.4, tau: 0.16, lp: 5000 });
    });
    [84, 88, 91].forEach((m) => {
      tone(e, { t: t + 0.45, f: F(e, m), partials: BELL, peak: 0.10, a: 0.006, hold: 1.0, tau: 0.45, lp: 5000 });
    });
  });
  def('ui_click', { gap: 0.05, cap: 2, dur: 0.06, notes: [84] }, (e, t) => {
    tone(e, { t: t, f: F(e, 84), type: 'triangle', peak: 0.15, a: 0.003, hold: 0.03, tau: 0.01, rel: 0.01, lp: 3500 });
    noise(e, { t: t, type: 'bandpass', f: 3000, q: 2, peak: 0.02, a: 0.002, hold: 0.008, tau: 0.003 });
  });
  def('pause', { gap: 0.2, cap: 1, dur: 0.25, notes: [79, 74] }, (e, t) => {
    [79, 74].forEach((m, i) => {
      tone(e, { t: t + i * 0.08, f: F(e, m), peak: 0.16, a: 0.005, hold: 0.12, tau: 0.05, lp: 2500 });
    });
  });
  def('unpause', { gap: 0.2, cap: 1, dur: 0.25, notes: [74, 79] }, (e, t) => {
    [74, 79].forEach((m, i) => {
      tone(e, { t: t + i * 0.08, f: F(e, m), peak: 0.16, a: 0.005, hold: 0.12, tau: 0.05, lp: 2500 });
    });
  });
  def('nori_peek', { gap: 0.5, cap: 1, dur: 0.4, notes: [79, 76] }, (e, t) => {
    tone(e, { t: t, f: F(e, 79), partials: [[1, 1, 1], [2, 0.08, 0.5]], peak: 0.24, a: 0.01, hold: 0.10, tau: 0.06, lp: 2500 });
    tone(e, { t: t + 0.12, f: F(e, 76), partials: [[1, 1, 1], [2, 0.08, 0.5]], peak: 0.24, a: 0.01, hold: 0.20, tau: 0.1, lp: 2500 });
  });
  def('giggle', { gap: 0.4, cap: 1, dur: 0.4, notes: [81, 84, 88] }, (e, t) => {
    [[81, 0], [81, 0.05], [84, 0.11], [84, 0.16], [88, 0.22], [88, 0.27]].forEach((n) => {
      const f = F(e, n[0]);
      tone(e, { t: t + n[1], path: [[0, f * 0.97], [0.03, f * 1.02]], type: 'triangle', peak: 0.14, a: 0.004, hold: 0.04, tau: 0.02, rel: 0.01, lp: 4000 });
    });
  });

  // Level trims (multiplier on top of the natural peaks above). Measured with tests/audio_analysis.js so that
  // every sound peaks where its role wants it: frequent sounds far below the events, all at or under -8 dBFS.
  const SFX_TRIM = {
    flipper_up: 0.62, flipper_down: 0.909, plunger_charge: 1.615, plunger_release: 0.743,
    bumper_piri: 0.68, bumper_rozi: 0.671, bumper_kiki: 0.659, sling: 0.965,
    post: 1.008, wall_soft: 0.424, dot: 0.735, pellet: 0.661,
    power_start: 0.877, power_end: 0.894, ghost_bonk: 0.878, fruit: 0.73,
    spinner_tick: 1.21, target_hit: 0.633, lane_light: 0.794, lane_complete: 0.681,
    hole_enter: 0.755, hole_eject: 0.817, tunnel_warp: 0.875, ballsave: 1.042,
    drain_soft: 0.775, balloon_pop: 0.884, star_collect: 0.765, multiball_start: 1.071,
    surprise_start: 0.806, surprise_end: 0.771, extra_ball: 0.673, level_up: 1.042,
    game_start: 0.91, game_over: 0.586, highscore: 0.73, ui_click: 0.869,
    pause: 0.927, unpause: 0.895, nori_peek: 0.923, giggle: 1.16
  };
  Object.keys(SFX_TRIM).forEach((k) => { if (SFX[k]) SFX[k].g = SFX_TRIM[k]; });

  // ============================================================================================
  // 5. Audio graph
  // ============================================================================================
  const SR = 44100;                 // sample rate for the offline debug renders
  const COMP_TRIM = 0.872;           // undoes the automatic makeup gain of Chromium's compressor (measured, see tests)
  const MUSIC_TRIM = 1.0;           // sets the music bed to about -22 dBFS RMS
  const DUCK_LEVEL = 0.5;           // -6 dB while a voice line plays
  const VOICE_PEAK = 0.5;           // decoded voice clips are scaled to peak at about -6 dBFS

  // Soft limiter: identity up to 0.7, then a smooth knee that tops out below 1.0.
  const LIMIT_CURVE = (() => {
    const n = 2049, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1, ax = Math.abs(x);
      const y = ax <= 0.7 ? ax : 0.7 + 0.28 * Math.tanh((ax - 0.7) / 0.28);
      c[i] = x < 0 ? -y : y;
    }
    return c;
  })();

  function makeNoise(ctx) {
    const n = Math.floor(ctx.sampleRate * 1.0);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0), r = PM.util.rng(7);
    for (let i = 0; i < n; i++) d[i] = (r() * 2 - 1) * 0.9;
    return buf;
  }
  function makeIR(ctx, seconds) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    const r = PM.util.rng(99), pre = Math.floor(ctx.sampleRate * 0.012);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < n; i++) {
        lp += ((r() * 2 - 1) - lp) * 0.3;                   // darker tail
        d[i] = lp * Math.exp(-(i - pre) / (n * 0.2));
      }
    }
    return buf;
  }

  // master -> compressor -> trim -> soft limiter -> destination
  // music: musicIn -> (dry + reverb) -> duck -> musicBus -> master;  sfx, voice: bus -> master
  function buildGraph(ctx, bypass) {
    bypass = bypass || '';
    const G = {};
    G.master = ctx.createGain();
    G.comp = ctx.createDynamicsCompressor();
    G.comp.threshold.value = -6; G.comp.knee.value = 8; G.comp.ratio.value = 4;
    G.comp.attack.value = 0.004; G.comp.release.value = 0.2;
    G.trim = ctx.createGain(); G.trim.gain.value = COMP_TRIM;
    G.limit = ctx.createWaveShaper(); G.limit.curve = LIMIT_CURVE;
    try { G.limit.oversample = '2x'; } catch (err) { /* older engines */ }
    // bypass is for debugging only: any of 'comp', 'limit', 'reverb'
    let head = G.master;
    if (bypass.indexOf('comp') < 0) { head.connect(G.comp); head = G.comp; }
    head.connect(G.trim); head = G.trim;
    if (bypass.indexOf('limit') < 0) { head.connect(G.limit); head = G.limit; }
    head.connect(ctx.destination);
    G.sfx = ctx.createGain(); G.sfx.connect(G.master);
    G.voice = ctx.createGain(); G.voice.connect(G.master);
    G.musicBus = ctx.createGain(); G.musicBus.connect(G.master);
    G.duck = ctx.createGain(); G.duck.connect(G.musicBus);
    G.musicIn = ctx.createGain(); G.musicIn.gain.value = MUSIC_TRIM; G.musicIn.connect(G.duck);
    G.rvSend = ctx.createGain(); G.rvSend.gain.value = 0.30;
    G.conv = ctx.createConvolver(); G.conv.buffer = makeIR(ctx, 1.1);
    if (bypass.indexOf('reverb') < 0) { G.musicIn.connect(G.rvSend); G.rvSend.connect(G.conv); G.conv.connect(G.duck); }
    return G;
  }

  // Start one SFX on any context (live or offline). Returns its rough duration, 0 if unknown.
  function playSfx(ctx, G, noiseBuf, state, name, t0, o) {
    const d = SFX[name];
    if (!d) return 0;
    o = o || {};
    const call = ctx.createGain();
    call.gain.value = clamp(o.vol == null ? 1 : o.vol, 0, 2) * d.g;
    let pan = o.pan;
    if (pan == null && o.x != null) pan = clamp((o.x - 270) / 270, -1, 1) * 0.6;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      call.connect(p); p.connect(G.sfx);
    } else {
      call.connect(G.sfx);
    }
    d.fn({ ctx: ctx, out: call, noise: noiseBuf, rate: clamp(o.rate || 1, 0.25, 4), state: state }, t0);
    return d.dur;
  }

  // ============================================================================================
  // 6. Music sequencer
  // ============================================================================================
  const LOOKAHEAD = 0.12;           // seconds scheduled ahead
  const TICK_MS = 25;

  function newSeq() { return { mode: 'off', pending: null, pendingUnit: 'bar', t: 0, step: 0, bar: 0, layer: null, e: null }; }
  const stepDur = (S) => 60 / MODES[S.mode].bpm / 4;

  function harmonyAt(key, bar, step) {
    const h = SONG.harmony[key][bar];
    return SONG.chords[h.length === 1 ? h[0] : (step < 8 ? h[0] : h[1])];
  }

  // Fade the old layer out and open a fresh one for the new mode (short crossfade at the bar line).
  function enterMode(S, env, mode, when) {
    const prevSong = S.mode !== 'off' && MODES[S.mode].song;
    if (S.layer) {
      const old = S.layer;
      old.gain.cancelScheduledValues(when);
      old.gain.setValueAtTime(old.gain.value || 1, when);
      old.gain.linearRampToValueAtTime(0, when + 0.2);
      if (env.live) setTimeout(() => { try { old.disconnect(); } catch (err) { /* already gone */ } }, 4000);
    }
    S.layer = env.ctx.createGain();
    S.layer.gain.value = MODES[mode].gain;                 // per-mode loudness match
    S.layer.connect(env.G.musicIn);
    S.e = { ctx: env.ctx, noise: env.noise, out: S.layer, rec: env.rec };
    if (!(prevSong && MODES[mode].song)) S.bar = 0;      // song modes share the bar counter
    S.mode = mode; S.step = 0; S.pending = null;
  }

  function emitMenu(S, e, t, sd) {
    const b = S.bar % 8, s = S.step;
    const n = LEAD.menu[b].slots[s];
    if (n) instBell(e, t, n.m, 0.9, 0.7, 0.13, 'lead');
    const ch = harmonyAt('menu', b, s);
    if (s === 0) tone(e, { tag: 'bass', t: t, f: mtof(ch.root + 12), peak: 0.10, a: 0.02, hold: sd * 10, tau: 0.6, rel: 0.1, lp: 900 });
    if (s === 8) instBell(e, t, ch.arp[1], 0.35, 0.5, 0.10);
  }

  function emitOver(S, e, t, sd) {
    const b = S.bar, s = S.step;
    const n = LEAD.over[b].slots[s];
    if (n) instBell(e, t, n.m, 1, n.len >= 8 ? 1.0 : 0.6, 0.13, 'lead');
    const ch = harmonyAt('over', b, s);
    if (s === 0 || s === 8) tone(e, { tag: 'bass', t: t, f: mtof(ch.root + 12), type: 'triangle', peak: 0.10, a: 0.03, hold: sd * 8, tau: 0.6, rel: 0.1, lp: 700 });
    if (b < 3 && (s === 4 || s === 12)) instBell(e, t, ch.arp[s === 4 ? 0 : 2], 0.28, 0.5, 0.10);
    if (b === 3 && s === 8) {                              // the resolution: a long C major chord, then silence
      [60, 64, 67].forEach((m, i) => instBell(e, t + i * 0.035, m, 0.9, 1.1, 0.06));   // gently rolled chord
      tone(e, { tag: 'bass', t: t, f: mtof(48), type: 'triangle', peak: 0.12, a: 0.03, hold: 3.0, tau: 1.2, rel: 0.3, lp: 500 });
    }
  }

  function emitSong(S, e, t0, sd, mode) {
    const bar = S.bar % SONG_BARS, s = S.step, pass = bar >> 4;
    const sec = (bar & 15) < 8 ? 'A' : 'B', b8 = bar & 7;
    const mel = sec === 'A' ? ((pass & 1) ? 'A2' : 'A') : ((pass & 2) ? 'B2' : 'B');
    const H = SONG.harmony[sec][b8];
    const t = t0 + (mode === 'surprise' && (s & 3) === 2 ? sd * 0.5 : 0);   // shuffled offbeats
    const odd = (pass & 1) === 1;

    const n = LEAD[mel][b8].slots[s];
    if (n) instLead(e, t, n.m, n.len * sd, mode, (s & 3) === 0 ? 1 : 0.88);

    // bass
    const pat = SONG.bass[mode];
    const two = H.length === 2;
    const list = two ? pat.half : pat.full;
    const local = two ? (s & 7) : s;
    const ch = SONG.chords[two ? H[s < 8 ? 0 : 1] : H[0]];
    for (let i = 0; i < list.length; i++) {
      if (list[i][0] === local) instBass(e, t0, list[i][1] === 'r' ? ch.root : ch.fifth, list[i][2] * sd, mode);
    }

    // bell / marimba layer
    const arpSteps = (odd || mode !== 'play') ? [2, 6, 10, 14] : [12];
    const idx = arpSteps.indexOf(s);
    if (idx >= 0) {
      let c, k;
      if (arpSteps.length === 4) { c = two ? SONG.chords[H[idx < 2 ? 0 : 1]] : SONG.chords[H[0]]; k = two ? idx % 2 : idx; }
      else { c = SONG.chords[H[two ? 1 : 0]]; k = 2; }
      if (mode === 'surprise') instMarimba(e, t, c.arp[k], 0.9);
      else if (mode === 'power') instMarimba(e, t, c.arp[k], 0.8);
      else instBell(e, t, c.arp[k] + 12, arpSteps.length === 4 ? 0.7 : 0.9, arpSteps.length === 4 ? 0.36 : 0.5, 0.085);
    }

    // light hand percussion
    const kv = mode === 'surprise' ? 0.75 : 1;
    if (s === 0) instKick(e, t0, kv);
    if (s === 8) instKick(e, t0, kv * 0.8);
    if (mode === 'power') {
      if ((s & 1) === 0) instShaker(e, t0, (s & 3) === 2 ? 0.9 : 0.55);
    } else if (mode === 'surprise') {
      if (s === 4 || s === 12) instSnap(e, t0, 1);
      if ((s & 3) === 2) instShaker(e, t, 0.5);
    } else {
      if ((s & 3) === 2) instShaker(e, t0, 0.45);
      if (odd && (s === 4 || s === 12)) instTick(e, t0, 1);
    }
  }

  // Schedules every step that starts before `until`. Used live (small window) and offline (whole render at once).
  function advance(S, env, until) {
    while (S.mode !== 'off' && S.t < until) {
      if (S.pending && (S.step === 0 || (S.pendingUnit === 'beat' && S.step % 4 === 0))) {
        enterMode(S, env, S.pending, S.t);
      }
      const M = MODES[S.mode], sd = stepDur(S);
      if (!env.silent()) {
        if (S.mode === 'menu') emitMenu(S, S.e, S.t, sd);
        else if (S.mode === 'gameover') emitOver(S, S.e, S.t, sd);
        else emitSong(S, S.e, S.t, sd, S.mode);
      }
      S.t += sd;
      S.step++;
      if (S.step === 16) {
        S.step = 0; S.bar++;
        if (!M.song && !M.loop && S.bar >= M.bars) {       // the lullaby is over: let the tail ring, then stop
          S.mode = 'off'; S.pending = null;
          if (env.onEnd) env.onEnd(S);
        } else if (!M.song && S.bar >= M.bars) {
          S.bar = 0;
        }
      }
    }
  }

  // ============================================================================================
  // 7. Voice player
  // ============================================================================================
  const CHATTER_GAP = 5;            // one priority 0/1 line per 5 s
  const QUEUE_WAIT = 4;             // a priority 2 line waits at most this long
  const QUEUE_MAX = 3;

  const b64ToBuf = (s) => {
    const bin = atob(s), n = bin.length, u = new Uint8Array(n);
    for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  };
  const decode = (ctx, buf) => new Promise((res, rej) => {
    const p = ctx.decodeAudioData(buf, res, rej);
    if (p && p.then) p.then(res, rej);
  });
  const peakOf = (ab) => {
    let pk = 0;
    for (let c = 0; c < ab.numberOfChannels; c++) {
      const d = ab.getChannelData(c);
      for (let i = 0; i < d.length; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > pk) pk = v; }
    }
    return pk;
  };

  // ============================================================================================
  // 8. Engine and public API
  // ============================================================================================
  let ctx = null, G = null, noiseBuf = null;
  let vol = { master: 1, music: 1, sfx: 1, voice: 1 };
  let muted = false, musicOn = true, paused = false, everRunning = false;
  let want = 'off';
  let timer = 0, suspendTimer = 0;
  const S = newSeq();
  const sfxState = { waka: 0 };
  const lastSfx = {}, activeSfx = {};
  let activeAll = [];
  const rnd = PM.util.rng((Date.now() & 0xffff) || 1);
  const V = { cats: {}, loaded: false, promise: null, cur: null, queue: [], lastChatter: -99 };
  const menv = { live: true, ctx: null, G: null, noise: null, silent: () => muted || !musicOn || paused, onEnd: null };

  const safe = (fn, fallback) => function () {
    try { return fn.apply(null, arguments); } catch (err) { return fallback; }
  };
  const rampTo = (p, target, tc) => {
    const now = ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.setTargetAtTime(target, now, tc);
  };

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = g.AudioContext || g.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (err) { ctx = new AC(); }
    everRunning = ctx.state === 'running';
    ctx.onstatechange = () => { if (ctx.state === 'running') everRunning = true; };
    G = buildGraph(ctx);
    noiseBuf = makeNoise(ctx);
    menv.ctx = ctx; menv.G = G; menv.noise = noiseBuf;
    menv.onEnd = (seq) => { if (seq.layer) { const l = seq.layer; setTimeout(() => { try { l.disconnect(); } catch (err) { /* gone */ } }, 6000); } stopTimer(); };
    applyLevels(true);
    return ctx;
  }
  function applyLevels(instant) {
    if (!ctx) return;
    const set = (p, v, tc) => { if (instant) p.value = v; else rampTo(p, v, tc); };
    set(G.master.gain, muted ? 0 : clamp(vol.master, 0, 1), 0.03);
    set(G.musicBus.gain, (musicOn && !paused) ? clamp(vol.music, 0, 1) : 0, 0.05);
    set(G.sfx.gain, clamp(vol.sfx, 0, 1), 0.03);
    set(G.voice.gain, clamp(vol.voice, 0, 1), 0.03);
  }

  // ---- music control
  function tick() {
    if (!ctx || paused || S.mode === 'off') return;
    const now = ctx.currentTime;
    if (S.t < now - 0.03) S.t = now + 0.03;              // fell behind (tab was busy): resync, keep the step
    advance(S, menv, now + LOOKAHEAD);
  }
  function startTimer() { if (!timer) timer = setInterval(safe(tick), TICK_MS); }
  function stopTimer() { if (timer) { clearInterval(timer); timer = 0; } }

  function requestMode(mode) {
    if (!ctx) return;
    if (mode === 'off') {
      if (S.layer) {
        const l = S.layer, now = ctx.currentTime;
        l.gain.cancelScheduledValues(now); l.gain.setValueAtTime(1, now); l.gain.linearRampToValueAtTime(0, now + 0.4);
        setTimeout(() => { try { l.disconnect(); } catch (err) { /* gone */ } }, 1500);
        S.layer = null;
      }
      S.mode = 'off'; S.pending = null; stopTimer();
      return;
    }
    if (S.mode === mode) { S.pending = null; return; }
    if (S.pending === mode) return;
    if (S.mode === 'off') {
      S.bar = 0; S.step = 0;
      enterMode(S, menv, mode, ctx.currentTime + 0.05);
      S.t = ctx.currentTime + 0.05;
      startTimer(); tick();
      return;
    }
    S.pending = mode;
    S.pendingUnit = mode === 'gameover' ? 'beat' : 'bar';
    startTimer();
  }

  // ---- unlock / suspend / resume
  function unlock() {
    try {
      if (!ensureCtx()) return Promise.resolve();
      let p = null;
      if (ctx.state === 'suspended' && !paused) p = ctx.resume();     // must happen inside the key or click handler
      try {                                              // iOS Safari wants a sound started inside the gesture
        const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource();
        s.buffer = b; s.connect(ctx.destination); s.start(0);
      } catch (err) { /* not needed elsewhere */ }
      requestMode(want);
      return Promise.resolve(p).then(() => { requestMode(want); }, () => {}).then(() => {});
    } catch (err) {
      return Promise.resolve();
    }
  }
  function suspend() {
    if (!ctx || paused) return;
    paused = true;
    applyLevels(false);
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(hardSuspend, 450);
  }
  function hardSuspend() {
    try { if (paused && ctx && ctx.state === 'running' && !voiceBusy()) ctx.suspend(); } catch (err) { /* ignore */ }
  }
  function resume() {
    if (!ctx) return;
    paused = false;
    clearTimeout(suspendTimer);
    if (ctx.state === 'suspended') { try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* ignore */ } }
    applyLevels(false);
    if (S.t < ctx.currentTime + 0.05) S.t = ctx.currentTime + 0.05;
  }

  // ---- SFX
  let lastResume = -9;
  function tryResume() {                               // at most twice a second, a rejected resume must not pile up
    const t = Date.now();
    if (t - lastResume < 500) return;
    lastResume = t;
    try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* ignore */ }
  }
  function sfx(name, o) {
    if (!ctx || muted) return;
    const d = SFX[name];
    if (!d) return;
    if (paused && name !== 'pause' && name !== 'unpause' && name !== 'ui_click') return;
    if (!everRunning && ctx.state !== 'running') { tryResume(); return; }   // still locked by autoplay rules: a key press may unlock it
    const now = ctx.currentTime;
    if (lastSfx[name] != null && now - lastSfx[name] < d.gap) return;
    const act = activeSfx[name] || (activeSfx[name] = []);
    while (act.length && act[0] <= now) act.shift();
    if (act.length >= d.cap) return;
    activeAll = activeAll.filter((x) => x > now);
    if (!d.important && activeAll.length >= 16) return;
    lastSfx[name] = now;
    const t0 = now + 0.004;
    const dur = playSfx(ctx, G, noiseBuf, sfxState, name, t0, o);
    act.push(now + dur); activeAll.push(now + dur);
  }

  // ---- voice
  function loadVoices() {
    if (V.promise) return V.promise;
    V.promise = (async () => {
      const data = g.PM_VOICE;
      if (!data || !data.manifest || !data.files || !ensureCtx()) return;
      const cats = data.manifest.cats || {};
      const decoded = {};
      const jobs = [];
      Object.keys(cats).forEach((cat) => (cats[cat].clips || []).forEach((cl) => {
        if (data.files[cl.f] && !(cl.f in decoded)) { decoded[cl.f] = null; jobs.push(cl.f); }
      }));
      for (let i = 0; i < jobs.length; i += 6) {
        await Promise.all(jobs.slice(i, i + 6).map(async (f) => {
          try {
            const ab = await decode(ctx, b64ToBuf(data.files[f]));
            const pk = peakOf(ab);
            if (pk > 0.0005) decoded[f] = { buf: ab, gain: clamp(VOICE_PEAK / pk, 0.25, 4) };
          } catch (err) { /* one bad clip must not stop the others */ }
        }));
        await new Promise((r) => setTimeout(r, 0));      // keep the page responsive
      }
      Object.keys(cats).forEach((cat) => {
        const clips = (cats[cat].clips || []).filter((cl) => decoded[cl.f]).map((cl) => ({ f: cl.f, who: cl.who, text: cl.text, buf: decoded[cl.f].buf, gain: decoded[cl.f].gain }));
        if (clips.length) {
          V.cats[cat] = { priority: cats[cat].priority == null ? 1 : cats[cat].priority, cooldown: cats[cat].cooldown || 0, clips: clips, last: -1, lastPlay: -99 };
        }
      });
      V.loaded = true;
    })().catch(() => {});
    return V.promise;
  }

  const voiceBusy = () => !!(ctx && V.cur && ctx.currentTime < V.cur.end);
  function duck(on) {
    if (!ctx) return;
    rampTo(G.duck.gain, on ? DUCK_LEVEL : 1, on ? 0.06 : 0.25);
  }
  function stopCurrent(fade) {
    const c = V.cur;
    if (!c) return;
    V.cur = null;
    try {
      const now = ctx.currentTime;
      c.gn.gain.cancelScheduledValues(now);
      c.gn.gain.setValueAtTime(c.gn.gain.value, now);
      c.gn.gain.linearRampToValueAtTime(0, now + fade);
      c.src.stop(now + fade + 0.01);
    } catch (err) { /* already stopped */ }
  }
  function startClip(cat, pri) {
    const c = V.cats[cat];
    const n = c.clips.length;
    let i = rnd.int(n);
    if (n > 1 && i === c.last) i = (i + 1 + rnd.int(n - 1)) % n;
    c.last = i;
    const clip = c.clips[i];
    const now = ctx.currentTime, t = now + 0.01;
    const src = ctx.createBufferSource();
    src.buffer = clip.buf;
    const gn = ctx.createGain();
    const end = t + clip.buf.duration;
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(clip.gain, t + 0.008);
    gn.gain.setValueAtTime(clip.gain, Math.max(t + 0.009, end - 0.02));
    gn.gain.linearRampToValueAtTime(0, end);
    src.connect(gn); gn.connect(G.voice);
    src.start(t);
    const cur = { src: src, gn: gn, end: end + 0.02, pri: pri, cat: cat };
    V.cur = cur;
    c.lastPlay = now;
    if (pri <= 1) V.lastChatter = now;
    duck(true);
    src.onended = () => {
      if (V.cur === cur) V.cur = null;
      if (!V.cur) { try { duck(false); } catch (err) { /* ignore */ } pumpQueue(); if (paused) { clearTimeout(suspendTimer); suspendTimer = setTimeout(hardSuspend, 600); } }
    };
  }
  function pumpQueue() {
    if (!ctx) return;
    const now = ctx.currentTime;
    V.queue = V.queue.filter((q) => q.deadline > now);
    if (voiceBusy() || !V.queue.length) return;
    let bi = 0;
    for (let i = 1; i < V.queue.length; i++) if (V.queue[i].pri > V.queue[bi].pri) bi = i;
    const q = V.queue.splice(bi, 1)[0];
    startClip(q.cat, q.pri);
  }
  function voice(cat, o) {
    if (!ctx || muted || !(everRunning || ctx.state === 'running')) return false;
    const c = V.cats[cat];
    if (!c) return false;
    o = o || {};
    const force = !!o.force;
    const pri = o.priority != null ? clamp(o.priority | 0, 0, 3) : c.priority;
    const now = ctx.currentTime;
    pumpQueue();
    if (!force && now - c.lastPlay < c.cooldown) return false;
    if (!force && pri <= 1 && now - V.lastChatter < CHATTER_GAP) return false;
    if (!voiceBusy()) { startClip(cat, pri); return true; }
    if (force || (pri === 3 && V.cur.pri < 3)) { stopCurrent(0.03); startClip(cat, pri); return true; }
    if (pri >= 2) {
      if (V.queue.some((q) => q.cat === cat)) return true;
      if (pri === 3) V.queue = V.queue.filter((q) => q.pri < 3);            // queue of one for priority 3: newest wins
      V.queue.push({ cat: cat, pri: pri, deadline: now + QUEUE_WAIT });
      while (V.queue.length > QUEUE_MAX) {                                  // drop the oldest of the lowest priority
        let li = 0;
        for (let i = 1; i < V.queue.length; i++) if (V.queue[i].pri < V.queue[li].pri) li = i;
        V.queue.splice(li, 1);
      }
      return true;
    }
    return false;                                        // priority 0 and 1 are dropped when busy
  }
  function stopVoice() { V.queue = []; if (ctx) { stopCurrent(0.04); duck(false); } }

  // ---- per-frame tick
  function update() {
    if (!ctx) return;
    tick();
    if (V.cur && ctx.currentTime > V.cur.end + 0.1) { V.cur = null; duck(false); }
    pumpQueue();
  }

  // ---- offline debug renders (tests only; the game never calls these)
  // Chromium's compressor is not settled during the first ~0.3 s of a context and would make early sounds too quiet,
  // so every render starts after a 1 s pre-roll of silence that is cut off again. `offset` shifts the start (seconds)
  // because oscillator sums peak a little differently for different start times.
  const PREROLL = 1.0;
  function offline(seconds) {
    const OAC = g.OfflineAudioContext || g.webkitOfflineAudioContext;
    return new OAC(2, Math.ceil((seconds + PREROLL) * SR), SR);
  }
  function mixDown(buf) {
    const a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a;
    const from = Math.round((PREROLL - 0.01) * SR);          // keep 10 ms of silence before the sound for the start-click test
    const out = new Float32Array(a.length - from);
    for (let i = 0; i < out.length; i++) out[i] = (a[from + i] + b[from + i]) * 0.5;
    return out;
  }
  function renderSfx(name, seconds, offset, bypass) {
    const oc = offline(seconds || 2);
    const OG = buildGraph(oc, bypass);
    playSfx(oc, OG, makeNoise(oc), { waka: 0 }, name, PREROLL + (offset || 0), {});
    return oc.startRendering().then(mixDown);
  }
  // switches (optional): [[seconds, mode], ...] requests a mode change at that time, like setMusic() does live.
  function renderMusic(mode, seconds, switches, bypass, offset) {
    const oc = offline(seconds);
    const OG = buildGraph(oc, bypass);
    const env = { live: false, ctx: oc, G: OG, noise: makeNoise(oc), silent: () => false, onEnd: null };
    const OS = newSeq();
    const t0 = PREROLL + (offset || 0);
    enterMode(OS, env, mode, t0);
    OS.t = t0;
    (switches || []).forEach((sw) => {
      advance(OS, env, PREROLL + sw[0]);
      OS.pending = sw[1]; OS.pendingUnit = sw[1] === 'gameover' ? 'beat' : 'bar';
    });
    advance(OS, env, PREROLL + seconds + 0.1);
    const end = PREROLL + seconds;
    OG.musicBus.gain.setValueAtTime(1, end - 0.2);                            // clean end for the click test
    OG.musicBus.gain.linearRampToValueAtTime(0, end - 0.01);
    return oc.startRendering().then(mixDown);
  }
  // Runs the scheduler without rendering and returns every note it would play (for the scheduler test).
  function musicEvents(mode, seconds, switches) {
    const oc = new (g.OfflineAudioContext || g.webkitOfflineAudioContext)(1, 1, SR);
    const rec = [];
    const env = { live: false, ctx: oc, G: buildGraph(oc), noise: makeNoise(oc), silent: () => false, onEnd: null, rec: rec };
    const OS = newSeq();
    enterMode(OS, env, mode, 0);
    OS.t = 0;
    (switches || []).forEach((sw) => {
      advance(OS, env, sw[0]);
      OS.pending = sw[1]; OS.pendingUnit = sw[1] === 'gameover' ? 'beat' : 'bar';
    });
    advance(OS, env, seconds);
    return { events: rec, stepSec: 60 / MODES[mode].bpm / 4 };
  }
  function renderProbe(amp, seconds) {                     // sine through the sfx bus: measures the chain gain
    const oc = offline(seconds || 0.5);
    const OG = buildGraph(oc);
    const o = oc.createOscillator(), gn = oc.createGain();
    o.frequency.value = 440; gn.gain.value = amp;
    o.connect(gn); gn.connect(OG.sfx); o.start(0);
    return oc.startRendering().then(mixDown);
  }

  PM.Audio = {
    isNull: false,
    unlock: unlock,
    loadVoices: loadVoices,
    sfx: safe(sfx),
    voice: safe(voice, false),
    voiceBusy: safe(voiceBusy, false),
    stopVoice: safe(stopVoice),
    setMusic: safe((mode) => {
      if (mode !== 'off' && !MODES[mode]) return;
      if (mode === want) return;
      want = mode;
      requestMode(mode);
    }),
    setVolumes: safe((v) => {
      if (!v) return;
      ['master', 'music', 'sfx', 'voice'].forEach((k) => { if (typeof v[k] === 'number' && v[k] === v[k]) vol[k] = clamp(v[k], 0, 1); });
      applyLevels(false);
    }),
    getVolumes: () => ({ master: vol.master, music: vol.music, sfx: vol.sfx, voice: vol.voice }),
    setMuted: safe((b) => { muted = !!b; if (muted) V.queue = []; applyLevels(false); }),
    isMuted: () => muted,
    setMusicOn: safe((b) => { musicOn = !!b; applyLevels(false); }),
    isMusicOn: () => musicOn,
    suspend: safe(suspend),
    resume: safe(resume),
    update: safe(update)
  };

  PM.Audio._debug = {
    sampleRate: SR,
    sfxNames: Object.keys(SFX),
    sfxNotes: Object.keys(SFX).reduce((o, k) => { o[k] = SFX[k].notes; return o; }, {}),
    song: SONG,
    modes: Object.keys(MODES),
    validateSong: validateSong,
    renderSfx: renderSfx,
    renderMusic: renderMusic,
    renderProbe: renderProbe,
    musicEvents: musicEvents,
    duckGain: () => (G ? G.duck.gain.value : 1),
    // live level meter on the final output (tests only): call meter() once to attach it, again to read {rms, peak}
    meter: () => {
      if (!ctx) return null;
      if (!G.meter) { G.meter = ctx.createAnalyser(); G.meter.fftSize = 2048; G.limit.connect(G.meter); G.meterBuf = new Float32Array(2048); return null; }
      G.meter.getFloatTimeDomainData(G.meterBuf);
      let sq = 0, pk = 0;
      for (let i = 0; i < G.meterBuf.length; i++) { const v = G.meterBuf[i]; sq += v * v; if (Math.abs(v) > pk) pk = Math.abs(v); }
      return { rms: Math.sqrt(sq / G.meterBuf.length), peak: pk };
    },
    state: () => ({ ctx: !!ctx, state: ctx && ctx.state, mode: S.mode, pending: S.pending, bar: S.bar, step: S.step, paused: paused, timer: !!timer, queue: V.queue.map((q) => q.cat), cur: V.cur && V.cur.cat, currentTime: ctx && ctx.currentTime }),
    voiceCats: () => Object.keys(V.cats).reduce((o, k) => { o[k] = { clips: V.cats[k].clips.length, priority: V.cats[k].priority, cooldown: V.cats[k].cooldown }; return o; }, {}),
    lastVoiceFile: (cat) => { const c = V.cats[cat]; return c && c.last >= 0 ? c.clips[c.last].f : null; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
