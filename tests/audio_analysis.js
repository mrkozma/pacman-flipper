'use strict';
// Audio analysis and API contract test for src/80_audio.js (role A).
//   node tests/audio_analysis.js            full run (renders every SFX, 60 s of every music mode, full song cycles, API and voice tests)
//   node tests/audio_analysis.js --quick    skips the long full-cycle renders and the slow real-time checks
//   node tests/audio_analysis.js --only=sfx|music|api|voice
// Everything is rendered offline (OfflineAudioContext) through the same graph the game uses.
// Each rendered sound is written as 16-bit mono WAV to tests/out/audio/<name>.wav so a person can listen later.
// Verified by measurement and music theory, not by ear.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { openGame } = require('./browser_helper');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out', 'audio');
const BUILD = 'dist/_dev_audio.html';
const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7);
const want = (k) => !ONLY || ONLY === k;

const SR = 44100;
const PENT = [0, 2, 4, 7, 9];
let failures = 0, warnings = 0;
const fail = (m) => { failures++; console.log('  FAIL ' + m); };
const warn = (m) => { warnings++; console.log('  warn ' + m); };
const check = (cond, m) => { if (cond) console.log('  ok   ' + m); else fail(m); };
const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);

// ---------------------------------------------------------------- DSP helpers
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
const hann = (n) => { const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)); return w; };

function spectrum(x, N, hop) {
  const w = hann(N), re = new Float64Array(N), im = new Float64Array(N);
  const P = new Float64Array(N / 2);
  let frames = 0;
  for (let s = 0; s + N <= x.length + N / 2; s += hop) {
    let e = 0;
    for (let i = 0; i < N; i++) { const v = (s + i < x.length ? x[s + i] : 0) * w[i]; re[i] = v; im[i] = 0; e += v * v; }
    if (e < 1e-9) continue;
    fft(re, im);
    for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  return { P: P, frames: frames, binHz: SR / N };
}

function pitchTrack(x) {
  const N = 4096, hop = 512, w = hann(N), re = new Float64Array(N), im = new Float64Array(N);
  const frames = [];
  let maxE = 0;
  for (let s = 0; s + N <= x.length; s += hop) {
    let e = 0;
    for (let i = 0; i < N; i++) { const v = x[s + i] * w[i]; re[i] = v; im[i] = 0; e += v * v; }
    frames.push({ s: s, e: e });
    if (e > maxE) maxE = e;
  }
  const out = [];
  frames.forEach((fr) => {
    if (fr.e < maxE * 0.05) return;
    for (let i = 0; i < N; i++) { re[i] = x[fr.s + i] * w[i]; im[i] = 0; }
    fft(re, im);
    let best = 0, bk = 0;
    const lo = Math.floor(50 / (SR / N)), hi = Math.floor(4200 / (SR / N));
    const mag = (k) => Math.hypot(re[k], im[k]);
    for (let k = lo; k < hi; k++) { const m = mag(k); if (m > best) { best = m; bk = k; } }
    if (bk < 2) return;
    const a = Math.log(mag(bk - 1) + 1e-12), b = Math.log(best + 1e-12), c = Math.log(mag(bk + 1) + 1e-12);
    const d = (a - 2 * b + c) === 0 ? 0 : 0.5 * (a - c) / (a - 2 * b + c);
    const f = (bk + d) * SR / N;
    out.push({ t: fr.s / SR, midi: 69 + 12 * Math.log2(f / 440) });
  });
  return out;
}

function analyse(x) {
  let peak = 0, sum = 0, sq = 0, nan = false, jump = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (v !== v || !isFinite(v)) { nan = true; continue; }
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v; sq += v * v;
    if (i > 0) { const j = Math.abs(v - x[i - 1]); if (j > jump) jump = j; }
  }
  const n2 = Math.floor(0.002 * SR);
  let head = 0, tail = 0;
  for (let i = 0; i < n2; i++) { head = Math.max(head, Math.abs(x[i])); tail = Math.max(tail, Math.abs(x[x.length - 1 - i])); }
  const sp = spectrum(x, 4096, 2048);
  let tot = 0, lowE = 0, cen = 0;
  for (let k = 1; k < sp.P.length; k++) { const f = k * sp.binHz; tot += sp.P[k]; cen += f * sp.P[k]; if (f < 4000) lowE += sp.P[k]; }
  return {
    nan: nan, peak: peak, rms: Math.sqrt(sq / x.length), dc: sum / x.length, head: head, tail: tail, jump: jump,
    centroid: tot > 0 ? cen / tot : 0, low4k: tot > 0 ? lowE / tot : 0
  };
}

function writeWav(file, x) {
  const n = x.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
}
function wavBase64(freq, seconds, rate) {              // synthetic clip for the voice tests (22.05 kHz mono)
  const n = Math.floor(rate * seconds), buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / rate) * 20000 * Math.min(1, i / 200, (n - i) / 200)), 44 + i * 2);
  return buf.toString('base64');
}

// ---------------------------------------------------------------- browser side
async function render(page, kind, name, sec, extra, extra2) {   // extra: music switches, or the sfx start time
  const b64 = await page.evaluate(async (a) => {
    const D = PM.Audio._debug;
    const f = a[0] === 'sfx' ? await D.renderSfx(a[1], a[2], a[3]) : a[0] === 'music' ? await D.renderMusic(a[1], a[2], a[3], null, a[4]) : await D.renderProbe(a[1], a[2]);
    const u8 = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }, [kind, name, sec, extra, extra2]);
  const b = Buffer.from(b64, 'base64');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
}

const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n);
const fx = (v, d) => (typeof v === 'number' ? v.toFixed(d) : v);

async function testSfx(page) {
  console.log('\n== SFX (offline render through the game graph) ==');
  const D = await page.evaluate(() => ({ names: PM.Audio._debug.sfxNames, notes: PM.Audio._debug.sfxNotes }));
  const spec = ('flipper_up, flipper_down, plunger_charge, plunger_release, bumper_piri, bumper_rozi, bumper_kiki, sling, post, wall_soft, ' +
    'dot, pellet, power_start, power_end, ghost_bonk, fruit, spinner_tick, target_hit, lane_light, lane_complete, hole_enter, hole_eject, ' +
    'tunnel_warp, ballsave, drain_soft, balloon_pop, star_collect, multiball_start, surprise_start, surprise_end, extra_ball, level_up, ' +
    'game_start, game_over, highscore, ui_click, pause, unpause, nori_peek, giggle').split(/,\s*/);
  check(spec.every((n) => D.names.includes(n)), 'all ' + spec.length + ' SPEC 4.5 sfx names are implemented');

  // chain gain for small signals must be about unity (guards the compressor makeup trim)
  const probe = await render(page, 'probe', 0.05, 0.5);
  let sq = 0, cnt = 0;
  for (let i = Math.floor(SR * 0.2); i < probe.length; i++) { sq += probe[i] * probe[i]; cnt++; }
  const gainDb = db(Math.sqrt(sq / cnt) / (0.05 / Math.SQRT2));
  console.log('  chain gain for a small signal: ' + gainDb.toFixed(2) + ' dB');
  check(Math.abs(gainDb) < 1.0, 'small-signal chain gain within 1 dB of unity');

  // transfer curve: voice clips are scaled to 0.5 (-6 dBFS); the compressor must leave that alone
  const curve = [];
  for (const amp of [0.05, 0.25, 0.5, 0.7, 1.0]) {
    const pr = await render(page, 'probe', amp, 0.5);
    let pk = 0;
    for (let i = Math.floor(SR * 0.25); i < pr.length; i++) pk = Math.max(pk, Math.abs(pr[i]));
    curve.push([amp, pk]);
  }
  console.log('  chain transfer (input peak -> output peak): ' + curve.map((c) => fx(db(c[0]), 1) + ' dB -> ' + fx(db(c[1]), 1) + ' dB').join('; '));
  check(Math.abs(db(curve[2][1]) - db(0.5)) < 1.0, 'a voice-level signal (-6 dBFS) leaves the chain within 1 dB (' + fx(db(curve[2][1]), 1) + ' dBFS)');
  check(curve[4][1] < 0.98, 'a full-scale input is soft limited below 0.98 (' + fx(curve[4][1], 3) + ')');
  console.log('  ' + pad('name', 17) + pad('peak dB', 9) + pad('rms dB', 8) + pad('centroid', 9) + pad('<4k %', 7) + pad('dc', 9) + pad('head', 9) + pad('tail', 9) + pad('jump', 7) + 'in-scale % (steady / all)');
  for (const name of D.names) {
    const x = await render(page, 'sfx', name, 2.6, 0);
    let worst = 0;                                              // oscillator sums peak a little differently for different start times
    for (const off of [0.4372, 1.2181]) { const xo2 = await render(page, 'sfx', name, 2.6, off); worst = Math.max(worst, analyse(xo2).peak); }
    const xo = await render(page, 'sfx', name, 2.6, 0.0207137);   // starts between two samples: must not leak a click either
    const mo = analyse(xo);
    if (mo.jump > 0.3 || mo.head > 0.004) fail(name + ': click when the start falls between samples (jump ' + mo.jump.toFixed(2) + ')');
    writeWav(path.join(OUT, name + '.wav'), x);
    const m = analyse(x);
    m.peak = Math.max(m.peak, worst);
    let pitchTxt = '-';
    if (D.notes[name]) {
      const tr = pitchTrack(x);
      const inScale = (p) => { const r = Math.round(p); const pc = ((r % 12) + 12) % 12; return PENT.includes(pc) && Math.abs(p - r) <= 0.5; };
      const nearest = (p) => { let best = 99; for (let k = Math.floor(p) - 2; k <= Math.ceil(p) + 2; k++) if (PENT.includes(((k % 12) + 12) % 12)) best = Math.min(best, Math.abs(p - k)); return best; };
      const steady = tr.filter((f, i) => i > 0 && i < tr.length - 1 && Math.abs(f.midi - tr[i - 1].midi) < 0.3 && Math.abs(f.midi - tr[i + 1].midi) < 0.3);
      const ok = (arr) => (arr.length ? Math.round(100 * arr.filter((f) => nearest(f.midi) <= 0.5).length / arr.length) : 100);
      pitchTxt = ok(steady) + ' / ' + ok(tr) + ' (' + steady.length + ' steady frames)';
      if (steady.length >= 8 && ok(steady) < 90) warn(name + ': only ' + ok(steady) + '% of steady frames are inside C pentatonic');
      void inScale;
    }
    console.log('  ' + pad(name, 17) + pad(fx(db(m.peak), 1), 9) + pad(fx(db(m.rms), 1), 8) + pad(Math.round(m.centroid), 9) + pad(fx(m.low4k * 100, 1), 7) + pad(m.dc.toExponential(1), 9) + pad(m.head.toExponential(1), 9) + pad(m.tail.toExponential(1), 9) + pad(fx(m.jump, 2), 7) + pitchTxt);
    if (m.nan) fail(name + ': NaN or Infinity in output');
    if (m.peak >= 0.9) fail(name + ': clipping risk, peak ' + m.peak.toFixed(3));
    if (m.peak > 0.42) fail(name + ': peak ' + fx(db(m.peak), 1) + ' dBFS is above about -8 dBFS');
    if (m.peak < 0.02) fail(name + ': silent or nearly silent');
    else if (m.peak < 0.03) warn(name + ': very quiet (peak ' + fx(db(m.peak), 1) + ' dBFS)');
    if (Math.abs(m.dc) > 0.003) fail(name + ': DC offset ' + m.dc);
    if (m.head > 0.004) fail(name + ': click at start (' + m.head + ')');
    if (m.tail > 0.004) fail(name + ': click at end (' + m.tail + ')');
    if (m.jump > 0.3) fail(name + ': abrupt sample jump ' + m.jump.toFixed(2) + ' (click)');
    if (m.low4k < 0.85) warn(name + ': only ' + fx(m.low4k * 100, 0) + '% of the energy is below 4 kHz (harsh?)');
    if (m.centroid > 3000) warn(name + ': spectral centroid ' + Math.round(m.centroid) + ' Hz is high');
  }
}

async function testMusic(page) {
  console.log('\n== Music (offline render) ==');
  const problems = await page.evaluate(() => PM.Audio._debug.validateSong());
  check(problems.length === 0, 'song tables valid (16 steps per bar, pentatonic notes, chord tones on bar starts, tempo 96..108)' + (problems.length ? ': ' + problems.join('; ') : ''));
  const modes = await page.evaluate(() => PM.Audio._debug.modes);
  console.log('  ' + pad('mode', 10) + pad('sec', 5) + pad('peak dB', 9) + pad('rms dB', 8) + pad('centroid', 9) + pad('<4k %', 7) + pad('dc', 9) + pad('head', 9) + pad('tail', 9));
  for (const mode of modes) {
    const sec = mode === 'gameover' ? 18 : 60;
    const x = await render(page, 'music', mode, sec);
    writeWav(path.join(OUT, 'music_' + mode + '.wav'), x);
    const m = analyse(x);
    const m2 = analyse(await render(page, 'music', mode, sec, null, 0.3719));   // other start alignment: peaks differ slightly
    m.peak = Math.max(m.peak, m2.peak);
    console.log('  ' + pad(mode, 10) + pad(sec, 5) + pad(fx(db(m.peak), 1), 9) + pad(fx(db(m.rms), 1), 8) + pad(Math.round(m.centroid), 9) + pad(fx(m.low4k * 100, 1), 7) + pad(m.dc.toExponential(1), 9) + pad(m.head.toExponential(1), 9) + pad(m.tail.toExponential(1), 9));
    if (m.nan) fail(mode + ': NaN');
    if (m.peak >= 0.6) fail(mode + ': peak ' + m.peak.toFixed(3) + ' is not below 0.6');
    if (m.peak < 0.02) fail(mode + ': silent');
    if (Math.abs(m.dc) > 0.003) fail(mode + ': DC offset ' + m.dc);
    if (m.head > 0.004) fail(mode + ': click at start');
    if (m.tail > 0.004) fail(mode + ': click at end');
    if (m.jump > 0.3) fail(mode + ': abrupt sample jump ' + m.jump.toFixed(2));
    if (m.low4k < 0.9) warn(mode + ': only ' + fx(m.low4k * 100, 0) + '% of the energy is below 4 kHz');
    if (mode === 'gameover') {
      // RMS over the part that sounds (first 12 s), and it must be silent at the end (the tune stops)
      const act = analyse(x.subarray(0, 12 * SR));
      console.log('           active part rms ' + fx(db(act.rms), 1) + ' dB');
      check(db(act.rms) > -27 && db(act.rms) < -17, 'gameover level about right while it sounds (' + fx(db(act.rms), 1) + ' dB)');
      let last = 0;
      for (let i = Math.floor(16.5 * SR); i < x.length; i++) last = Math.max(last, Math.abs(x[i]));
      check(db(last) < -60, 'gameover is silent again after about 16 s (tail peak ' + fx(db(last), 1) + ' dB): the lullaby stops');
      let lastSound = 0;
      for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) > 0.003) { lastSound = i / SR; break; }
      check(lastSound > 9 && lastSound < 17, 'gameover lasts about ' + fx(lastSound, 1) + ' s including the ring-out');
    } else {
      check(db(m.rms) >= -26 && db(m.rms) <= -19, mode + ' RMS ' + fx(db(m.rms), 1) + ' dBFS is within -26..-19');
    }
  }
  // mode changes: bar-line crossfades must not click or jump in level
  const sw = [[7.3, 'play'], [22.1, 'power'], [40.2, 'surprise'], [58.4, 'play'], [70.3, 'gameover']];
  const xs = await render(page, 'music', 'menu', 90, sw);
  writeWav(path.join(OUT, 'music_transitions.wav'), xs);
  const am = analyse(xs);
  check(!am.nan && am.jump < 0.3 && am.peak < 0.6, 'mode changes menu>play>power>surprise>play>gameover: no NaN, no click (max jump ' + fx(am.jump, 3) + '), peak ' + fx(db(am.peak), 1) + ' dBFS');
  const win = (t0, t1) => db(analyse(xs.subarray(Math.floor(t0 * SR), Math.floor(t1 * SR))).rms);
  const around = [[7.3, 'menu>play'], [22.1, 'play>power'], [40.2, 'power>surprise'], [58.4, 'surprise>play']];
  const steps = around.map((a) => { const t = Math.ceil(a[0] / 2.5) * 2.5; return Math.abs(win(t, t + 2) - win(t - 2, t)); });
  console.log('    level change across each switch (2 s windows, dB): ' + steps.map((v) => fx(v, 1)).join('  '));
  check(steps.every((v) => v < 4), 'level stays within 4 dB across every switch');
  if (!QUICK) {
    console.log('  full song cycle (64 bars = 4 passes with different variants), RMS per pass:');
    for (const mode of ['play', 'power', 'surprise']) {
      const bpm = mode === 'power' ? 106 : mode === 'surprise' ? 100 : 96;
      const passSec = 16 * 4 * 60 / bpm;
      const total = Math.ceil(passSec * 4) + 1;
      const x = await render(page, 'music', mode, total);
      const rmsDb = [];
      for (let p = 0; p < 4; p++) {
        const seg = x.subarray(Math.floor((p * passSec + 1) * SR), Math.floor(((p + 1) * passSec - 1) * SR));
        const a = analyse(seg);
        rmsDb.push(db(a.rms));
        if (a.peak >= 0.6) fail(mode + ' pass ' + p + ': peak ' + a.peak.toFixed(3));
        if (a.nan) fail(mode + ' pass ' + p + ': NaN');
      }
      console.log('    ' + pad(mode, 9) + rmsDb.map((v) => fx(v, 1)).join('  ') + ' dB  (loop length ' + fx(passSec * 4, 0) + ' s)');
      check(rmsDb.every((v) => v >= -26 && v <= -19), mode + ' every pass is within -26..-19 dBFS');
    }
  }
}


// ---------------------------------------------------------------- scheduler (what would be played, when)
const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const noteMidi = (n) => NOTE_PC[n[0]] + 12 * (parseInt(n[1], 10) + 1);
function parseMelody(bars) {
  return bars.map((str) => {
    const out = []; let pos = 0;
    str.split(/\s+/).forEach((tok) => { const [n, l] = tok.split(':'); if (n !== 'R') out.push({ step: pos, midi: noteMidi(n) }); pos += parseInt(l, 10); });
    return out;
  });
}
const m2f = (m) => 440 * Math.pow(2, (m - 69) / 12);

async function testScheduler(page) {
  console.log('\n== Scheduler: notes and times (no rendering, independent expectation from the melody strings) ==');
  const song = await page.evaluate(() => PM.Audio._debug.song);
  const mel = {};
  Object.keys(song.melody).forEach((k) => { mel[k] = parseMelody(song.melody[k]); });
  const feq = (a, b) => Math.abs(a - b) < 1e-6 * b;
  for (const mode of ['play', 'power', 'surprise']) {
    const secs = 64 * 16 * 60 / song.bpm[mode] / 4 - 0.01;
    const r = await page.evaluate((a) => PM.Audio._debug.musicEvents(a[0], a[1]), [mode, secs]);
    const sd = r.stepSec, barSec = 16 * sd, up = mode === 'power' ? 12 : 0;
    const lead = r.events.filter((e) => e.tag === 'lead');
    let missing = 0, extra = 0, badTime = 0;
    const expected = [];
    for (let b = 0; b < 64; b++) {
      const pass = b >> 4, sec = (b & 15) < 8 ? 'A' : 'B', b8 = b & 7;
      const name = sec === 'A' ? ((pass & 1) ? 'A2' : 'A') : ((pass & 2) ? 'B2' : 'B');
      mel[name][b8].forEach((n) => {
        const swing = mode === 'surprise' && (n.step & 3) === 2 ? sd * 0.5 : 0;
        expected.push({ t: b * barSec + n.step * sd + swing, f: m2f(n.midi + up) });
      });
    }
    expected.forEach((x) => { if (!lead.some((e) => Math.abs(e.t - x.t) < 1e-6 && feq(e.f, x.f))) missing++; });
    lead.forEach((e) => { if (!expected.some((x) => Math.abs(e.t - x.t) < 1e-6 && feq(e.f, x.f))) extra++; });
    check(missing === 0 && extra === 0 && expected.length === lead.length, mode + ': all ' + expected.length + ' lead notes of 64 bars are scheduled at the right time and pitch (missing ' + missing + ', extra ' + extra + ')');
    const pcOk = r.events.filter((e) => e.tag === 'lead' || e.tag === 'bell' || e.tag === 'marim').every((e) => PENT.includes(((Math.round(69 + 12 * Math.log2(e.f / 440)) % 12) + 12) % 12) && Math.abs(69 + 12 * Math.log2(e.f / 440) - Math.round(69 + 12 * Math.log2(e.f / 440))) < 1e-6);
    check(pcOk, mode + ': every lead, bell and marimba note is a C pentatonic pitch');
    const bassOk = r.events.filter((e) => e.tag === 'bass').every((e) => [0, 2, 4, 5, 7, 9].includes(((Math.round(69 + 12 * Math.log2(e.f / 440)) % 12) + 12) % 12));
    check(bassOk, mode + ': every bass note is a chord root or fifth (C D E F G A)');
    const kicks = r.events.filter((e) => e.tag === 'kick').map((e) => e.t);
    check(Math.abs(kicks[1] - kicks[0] - 8 * sd) < 1e-6 && Math.abs(kicks[2] - kicks[0] - 16 * sd) < 1e-6, mode + ': tempo grid is exact (beat 3 at 8 steps, next bar at 16 steps; ' + fx(60 / (sd * 4), 1) + ' BPM)');
    const chatter = r.events.length / secs;
    console.log('    ' + mode + ': ' + r.events.length + ' notes in ' + fx(secs, 0) + ' s (' + fx(chatter, 1) + ' per second)');
  }
  for (const mode of ['menu', 'gameover']) {
    const secs = mode === 'menu' ? 8 * 2 * 2.5 - 0.01 : 30;
    const r = await page.evaluate((a) => PM.Audio._debug.musicEvents(a[0], a[1]), [mode, secs]);
    const lead = r.events.filter((e) => e.tag === 'lead');
    const per = mode === 'menu' ? mel.menu.reduce((n, b) => n + b.length, 0) : mel.over.reduce((n, b) => n + b.length, 0);
    check(lead.length === per * (mode === 'menu' ? 2 : 1), mode + ': melody notes scheduled ' + lead.length + ' (expected ' + per * (mode === 'menu' ? 2 : 1) + (mode === 'menu' ? ', two loops' : ', once') + ')');
    if (mode === 'gameover') {
      const last = Math.max.apply(null, r.events.map((e) => e.t));
      check(last < 4 * 16 * r.stepSec, 'gameover schedules nothing after its 4 bars (last note at ' + fx(last, 2) + ' s of ' + fx(4 * 16 * r.stepSec, 2) + ' s)');
    }
  }
}

// ---------------------------------------------------------------- API contract
async function freshPage(initScript) {
  const g = await openGame({ file: BUILD, query: '' });
  if (initScript) { await g.page.addInitScript(initScript); await g.page.reload(); }
  await g.page.waitForFunction(() => window.PM && PM.Audio && PM.Audio._debug);
  return g;
}

async function testApi() {
  console.log('\n== API contract ==');
  let g = await freshPage(() => {
    window.__ints = new Set();
    const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
    window.setInterval = (f, ms) => { const id = si(f, ms); window.__ints.add(id); return id; };
    window.clearInterval = (id) => { window.__ints.delete(id); return ci(id); };
  });
  const p = g.page;
  const ev = (fn, arg) => p.evaluate(fn, arg);
  check(await ev(() => PM.Audio.isNull === false), 'PM.Audio replaced the null stand-in');
  const names = ['unlock', 'loadVoices', 'sfx', 'voice', 'voiceBusy', 'stopVoice', 'setMusic', 'setVolumes', 'getVolumes', 'setMuted', 'isMuted', 'setMusicOn', 'isMusicOn', 'suspend', 'resume', 'update'];
  check(await ev((n) => n.every((k) => typeof PM.Audio[k] === 'function'), names), 'all SPEC 4.5 methods exist');
  check(await ev(() => { try { PM.Audio.sfx('no_such_sound'); PM.Audio.sfx('dot'); PM.Audio.sfx(); PM.Audio.sfx(null, 5); PM.Audio.update(0.016); PM.Audio.setMusic('bogus'); PM.Audio.suspend(); PM.Audio.resume(); return true; } catch (e) { return false; } }), 'calls before unlock never throw');
  check(await ev(() => PM.Audio.voice('welcome') === false && PM.Audio.voice('nope', { priority: 3 }) === false), 'voice() without PM_VOICE returns false');
  check(await ev(() => { const v = PM.Audio.getVolumes(); return v.master === 1 && v.music === 1 && v.sfx === 1 && v.voice === 1; }), 'default volumes are all 1');
  await ev(() => PM.Audio.setVolumes({ music: 0.4, sfx: 7, voice: -3, master: NaN }));
  check(await ev(() => { const v = PM.Audio.getVolumes(); return v.music === 0.4 && v.sfx === 1 && v.voice === 0 && v.master === 1; }), 'setVolumes clamps to 0..1 and ignores NaN');
  await ev(() => PM.Audio.setVolumes({ music: 1, sfx: 1, voice: 1, master: 1 }));
  await ev(() => { PM.Audio.setMuted(true); });
  check(await ev(() => PM.Audio.isMuted() === true), 'setMuted / isMuted');
  await ev(() => { PM.Audio.setMuted(false); PM.Audio.setMusicOn(false); });
  check(await ev(() => PM.Audio.isMusicOn() === false), 'setMusicOn / isMusicOn');
  await ev(() => PM.Audio.setMusicOn(true));

  await ev(() => PM.Audio.setMusic('menu'));                      // requested before unlock: must start after unlock
  const u = await ev(async () => { const a = PM.Audio.unlock(), b = PM.Audio.unlock(); await Promise.all([a, b]); return PM.Audio._debug.state(); });
  check(u.ctx, 'unlock() twice is fine and creates the context (state ' + u.state + ')');
  check(u.mode === 'menu', 'music requested before unlock starts after unlock (mode ' + u.mode + ')');
  await p.waitForFunction(() => PM.Audio._debug.state().currentTime > 0.3, null, { timeout: 5000 }).catch(() => {});
  const clockRuns = await ev(() => PM.Audio._debug.state().currentTime);
  check(clockRuns > 0.1, 'audio clock runs in headless Edge (' + clockRuns.toFixed(2) + ' s)');
  if (clockRuns > 0.1) {
    // scheduler follows the clock, one timer only, never more than about 0.3 s ahead
    await ev(() => { for (let i = 0; i < 5; i++) { PM.Audio.setMusic('play'); PM.Audio.setMusic('menu'); } });
    const ints = await ev(() => window.__ints.size);
    check(ints === 1, 'exactly one scheduler timer after mode spam (' + ints + ')');
    // bar-line switching: menu -> play must wait for the next bar line
    const t0 = Date.now();
    await ev(() => PM.Audio.setMusic('play'));
    const st = await ev(() => PM.Audio._debug.state());
    console.log('  after request: mode=' + st.mode + ' pending=' + st.pending);
    let switchedAfter = -1;
    for (let i = 0; i < 40; i++) {
      await p.waitForTimeout(100);
      const s2 = await ev(() => PM.Audio._debug.state());
      if (s2.mode === 'play') { switchedAfter = (Date.now() - t0) / 1000; check(s2.bar <= 1, 'switch lands on a bar line (bar ' + s2.bar + ', step ' + s2.step + ')'); break; }
    }
    check(switchedAfter >= 0 && switchedAfter < 2.9, 'menu -> play switched at the next bar line after ' + switchedAfter.toFixed(2) + ' s (bar is 2.5 s)');
    // song modes share the bar counter
    await p.waitForTimeout(2600);
    const before = await ev(() => PM.Audio._debug.state());
    await ev(() => PM.Audio.setMusic('power'));
    await p.waitForTimeout(2400);
    const after = await ev(() => PM.Audio._debug.state());
    check(after.mode === 'power' && after.bar >= before.bar, 'play -> power keeps the song position (bar ' + before.bar + ' -> ' + after.bar + ')');
    const ahead = await ev(() => { const s = PM.Audio._debug.state(); return s; });
    check(ahead.timer, 'scheduler timer is running while music plays');
    // live output level: the music is really audible, and mute / music-off really silence it
    await ev(() => PM.Audio.setMusic('play'));
    await ev(() => PM.Audio._debug.meter());
    await p.waitForTimeout(1500);
    const peakOf = async (ms) => { let pk = 0; for (let i = 0; i < ms / 50; i++) { const m = await ev(() => PM.Audio._debug.meter()); if (m) pk = Math.max(pk, m.peak); await p.waitForTimeout(50); } return pk; };
    const live1 = await peakOf(1500);
    check(live1 > 0.03 && live1 < 0.7, 'live music output is audible and not hot (peak ' + fx(db(live1), 1) + ' dBFS)');
    await ev(() => PM.Audio.setMuted(true)); await p.waitForTimeout(400);
    const live2 = await peakOf(600);
    check(live2 < 0.001, 'muted: output is silent (peak ' + fx(db(live2), 1) + ' dBFS)');
    await ev(() => { PM.Audio.setMuted(false); PM.Audio.setMusicOn(false); }); await p.waitForTimeout(500);
    const live3 = await peakOf(600);
    check(live3 < 0.001, 'music off: output is silent (peak ' + fx(db(live3), 1) + ' dBFS)');
    await ev(() => { PM.Audio.setMusicOn(true); PM.Audio.sfx('game_start'); });
    const live4 = await peakOf(1200);
    check(live4 > 0.03, 'music back on and an sfx play (peak ' + fx(db(live4), 1) + ' dBFS)');
    await ev(() => PM.Audio.setVolumes({ music: 0.5 })); await p.waitForTimeout(400);
    await ev(() => PM.Audio.setVolumes({ music: 1 }));
    // pause / resume
    await ev(() => PM.Audio.suspend());
    await p.waitForTimeout(900);
    const susp = await ev(() => PM.Audio._debug.state());
    check(susp.paused && susp.state === 'suspended', 'suspend() pauses the context when nothing is speaking (' + susp.state + ')');
    await ev(() => { PM.Audio.sfx('unpause'); PM.Audio.resume(); });
    await p.waitForTimeout(400);
    const res = await ev(() => PM.Audio._debug.state());
    check(!res.paused && res.state === 'running', 'resume() runs again (' + res.state + ')');
    // off
    await ev(() => PM.Audio.setMusic('off'));
    await p.waitForTimeout(100);
    const off = await ev(() => ({ s: PM.Audio._debug.state(), n: window.__ints.size }));
    check(off.s.mode === 'off' && off.n === 0, 'setMusic(off) stops music and clears the timer');
    // gameover plays once and ends by itself
    if (!QUICK) {
      await ev(() => PM.Audio.setMusic('gameover'));
      await p.waitForTimeout(500);
      const go1 = await ev(() => PM.Audio._debug.state());
      check(go1.mode === 'gameover', 'gameover starts');
      await p.waitForTimeout(11000);
      const go2 = await ev(() => ({ s: PM.Audio._debug.state(), n: window.__ints.size }));
      check(go2.s.mode === 'off' && go2.n === 0, 'gameover ends by itself after about 10 s and the timer is cleared (mode ' + go2.s.mode + ')');
    }
    // sfx rate limiting must not throw when hammered
    check(await ev(() => { try { for (let i = 0; i < 400; i++) PM.Audio.sfx(['bumper_piri', 'dot', 'spinner_tick', 'giggle', 'sling'][i % 5], { rate: 1 + (i % 7) / 10, x: i % 540 }); return true; } catch (e) { return false; } }), 'hammering sfx() never throws');
  }
  check(g.errors.length === 0, 'no console or page errors' + (g.errors.length ? ': ' + g.errors.join(' | ') : ''));
  await g.close();

  // autoplay policy on (like a normal browser): nothing may throw or log errors before the first key press,
  // and unlock() inside the key handler must start the music
  g = await openGame({ file: BUILD, query: '', args: ['--autoplay-policy=document-user-activation-required'] });
  await g.page.waitForFunction(() => window.PM && PM.Audio);
  await g.page.evaluate(() => {
    window.addEventListener('keydown', () => { PM.Audio.unlock(); }, { once: true });
    PM.Audio.setMusic('menu'); PM.Audio.sfx('dot'); PM.Audio.update(0.016);
  });
  const pre = await g.page.evaluate(() => PM.Audio._debug.state());
  check(!pre.ctx, 'before the first key press no AudioContext exists (nothing is created without a gesture)');
  await g.page.keyboard.press('Space');
  await g.page.waitForFunction(() => PM.Audio._debug.state().state === 'running', null, { timeout: 5000 }).catch(() => {});
  await g.page.evaluate(() => PM.Audio._debug.meter());
  await g.page.waitForTimeout(1500);
  const post = await g.page.evaluate(() => ({ st: PM.Audio._debug.state(), m: PM.Audio._debug.meter() }));
  check(post.st.state === 'running' && post.st.mode === 'menu' && post.m && post.m.peak > 0.01, 'unlock() inside the key handler starts the queued menu music (state ' + post.st.state + ', peak ' + (post.m ? fx(db(post.m.peak), 1) : 'n/a') + ' dBFS)');
  check(g.errors.length === 0, 'no console errors with the autoplay policy on' + (g.errors.length ? ': ' + g.errors.join(' | ') : ''));
  await g.close();

  // mocked: no WebAudio at all
  g = await freshPage(() => { window.AudioContext = undefined; window.webkitAudioContext = undefined; window.OfflineAudioContext = undefined; window.webkitOfflineAudioContext = undefined; });
  const r = await g.page.evaluate(async () => {
    const out = [];
    try {
      await PM.Audio.unlock(); await PM.Audio.unlock(); await PM.Audio.loadVoices();
      PM.Audio.sfx('dot'); out.push(PM.Audio.voice('welcome')); PM.Audio.setMusic('menu'); PM.Audio.setMusic('play');
      PM.Audio.setVolumes({ music: 0.5 }); PM.Audio.setMuted(true); PM.Audio.setMuted(false); PM.Audio.suspend(); PM.Audio.resume();
      PM.Audio.update(0.016); PM.Audio.stopVoice(); out.push(PM.Audio.voiceBusy());
      return { ok: true, out: out };
    } catch (e) { return { ok: false, msg: String(e) }; }
  });
  check(r.ok && r.out[0] === false && r.out[1] === false, 'no exceptions with AudioContext missing (unlock resolves, voice false)' + (r.ok ? '' : ' ' + r.msg));
  await g.close();
  // mocked: AudioContext constructor throws
  g = await freshPage(() => { window.AudioContext = function () { throw new Error('boom'); }; window.webkitAudioContext = undefined; });
  const r2 = await g.page.evaluate(async () => {
    try { await PM.Audio.unlock(); PM.Audio.sfx('dot'); PM.Audio.setMusic('menu'); PM.Audio.update(0.02); return PM.Audio.voice('x') === false; } catch (e) { return false; }
  });
  check(r2, 'no exceptions when the AudioContext constructor throws');
  await g.close();
}

// ---------------------------------------------------------------- voice player with synthetic clips
async function testVoice() {
  console.log('\n== Voice player (synthetic clips) ==');
  const clip = (f, fq, dur) => ({ f: f, who: 'noemi', text: f, dur: dur });
  const files = {
    'a_1.wav': wavBase64(300, 0.4, 22050), 'a_2.wav': wavBase64(330, 0.4, 22050), 'a_3.wav': wavBase64(360, 0.4, 22050),
    'b_1.wav': wavBase64(400, 0.5, 22050), 'x_1.wav': wavBase64(440, 0.3, 22050), 'x_2.wav': wavBase64(480, 0.3, 22050),
    'long_1.wav': wavBase64(500, 1.6, 22050), 'p3_1.wav': wavBase64(520, 0.6, 22050), 'huge_1.wav': wavBase64(540, 5.5, 22050),
    'z_1.wav': wavBase64(560, 0.3, 22050), 'bad_1.wav': 'AAAA-not-audio', 'quiet_1.wav': wavBase64(600, 0.3, 22050)
  };
  const manifest = { cats: {
    a: { priority: 1, cooldown: 1, clips: [clip('a_1.wav'), clip('a_2.wav'), clip('a_3.wav')] },
    b: { priority: 2, cooldown: 0, clips: [clip('b_1.wav')] },
    x: { priority: 2, cooldown: 0, clips: [clip('x_1.wav'), clip('x_2.wav')] },
    long: { priority: 2, cooldown: 0, clips: [clip('long_1.wav')] },
    p3: { priority: 3, cooldown: 0, clips: [clip('p3_1.wav')] },
    huge: { priority: 3, cooldown: 0, clips: [clip('huge_1.wav')] },
    c0: { priority: 0, cooldown: 0, clips: [clip('z_1.wav')] },
    bad: { priority: 1, cooldown: 0, clips: [clip('bad_1.wav')] },
    missing: { priority: 1, cooldown: 0, clips: [clip('nothere.wav')] }
  } };
  const g = await freshPage(null);
  await g.page.evaluate((v) => { window.PM_VOICE = v; }, { manifest: manifest, files: files });
  const p = g.page, ev = (fn, a) => p.evaluate(fn, a);
  await ev(async () => { await PM.Audio.unlock(); await PM.Audio.loadVoices(); });
  await p.waitForFunction(() => PM.Audio._debug.state().currentTime > 0.3, null, { timeout: 5000 }).catch(() => {});
  const clock = await ev(() => PM.Audio._debug.state().currentTime);
  if (!(clock > 0.1)) { fail('audio clock does not run, cannot test the voice player in real time'); await g.close(); return; }
  const cats = await ev(() => PM.Audio._debug.voiceCats());
  check(cats.a && cats.a.clips === 3 && cats.b && cats.long && !cats.bad && !cats.missing, 'loadVoices decodes and indexes by category, tolerates a corrupt and a missing clip (' + Object.keys(cats).join(',') + ')');
  check(await ev(() => PM.Audio.voice('unknown_cat') === false), 'unknown category returns false');
  await ev(async () => { await PM.Audio.loadVoices(); });
  check(Object.keys(await ev(() => PM.Audio._debug.voiceCats())).length === Object.keys(cats).length, 'loadVoices is idempotent');

  // ducking and cooldown
  await ev(() => PM.Audio._debug.meter());
  check(await ev(() => PM.Audio.voice('a') === true), 'voice(a) plays');
  await p.waitForTimeout(150);
  let vpk = 0;
  for (let i = 0; i < 4; i++) { const m = await ev(() => PM.Audio._debug.meter()); if (m) vpk = Math.max(vpk, m.peak); await p.waitForTimeout(40); }
  check(Math.abs(db(vpk) - db(0.5)) < 1.5, 'a voice line peaks at about -6 dBFS at the output (' + fx(db(vpk), 1) + ' dBFS, clips are normalized on load)');
  check(await ev(() => PM.Audio.voiceBusy()), 'voiceBusy() is true while it plays');
  const dg = await ev(() => PM.Audio._debug.duckGain());
  check(dg < 0.7, 'music is ducked while the voice plays (gain ' + dg.toFixed(2) + ', target 0.5)');
  check(await ev(() => PM.Audio.voice('a') === false), 'same category again is refused (busy, cooldown, chatter)');
  await p.waitForTimeout(900);
  check(!(await ev(() => PM.Audio.voiceBusy())), 'voiceBusy() is false after the clip ends');
  const dg2 = await ev(() => PM.Audio._debug.duckGain());
  check(dg2 > 0.9, 'ducking is released after the line (gain ' + dg2.toFixed(2) + ')');
  // chatter limit: priority 1 line right after a priority 0/1 line is refused for about 5 s
  await p.waitForTimeout(300);
  check(await ev(() => PM.Audio.voice('a') === false), 'chatter limit blocks a priority 1 line within 5 s of the last one');
  await p.waitForTimeout(4200);
  check(await ev(() => PM.Audio.voice('a') === true), 'priority 1 line plays again after the chatter gap');
  await p.waitForTimeout(700);

  // variants never repeat back to back
  const seq = [];
  for (let i = 0; i < 8; i++) {
    await ev(() => PM.Audio.voice('x'));
    seq.push(await ev(() => PM.Audio._debug.lastVoiceFile('x')));
    await p.waitForTimeout(420);
  }
  check(seq.every((f, i) => i === 0 || f !== seq[i - 1]) && new Set(seq).size === 2, 'variants never repeat back to back: ' + seq.join(' '));

  // priorities while a 1.6 s line plays
  await ev(() => PM.Audio.stopVoice());
  await ev(() => PM.Audio.voice('long'));
  await p.waitForTimeout(100);
  check(await ev(() => PM.Audio.voice('c0') === false), 'priority 0 is dropped when busy');
  check(await ev(() => PM.Audio.voice('a', { priority: 1 }) === false), 'priority 1 is dropped when busy');
  check(await ev(() => PM.Audio.voice('b') === true), 'priority 2 is accepted into the queue when busy');
  check((await ev(() => PM.Audio._debug.state())).queue.join() === 'b', 'queue holds b');
  await p.waitForTimeout(1900);
  const stB = await ev(() => PM.Audio._debug.state());
  check(stB.cur === 'b' || stB.queue.length === 0, 'the queued line plays when the current one ends (cur ' + stB.cur + ')');
  await p.waitForTimeout(700);
  await ev(() => PM.Audio.voice('long'));
  await p.waitForTimeout(100);
  check(await ev(() => PM.Audio.voice('p3') === true), 'priority 3 interrupts and plays');
  check((await ev(() => PM.Audio._debug.state())).cur === 'p3', 'priority 3 is the current line right away');
  await p.waitForTimeout(800);
  // queue wait limit of about 4 s
  await ev(() => PM.Audio.voice('huge'));
  await p.waitForTimeout(100);
  await ev(() => PM.Audio.voice('b'));
  check((await ev(() => PM.Audio._debug.state())).queue.join() === 'b', 'priority 2 waits behind a priority 3 line');
  await p.waitForTimeout(4400);
  await ev(() => PM.Audio.update(0.016));                          // the game calls update() every frame
  const stQ = await ev(() => PM.Audio._debug.state());
  check(stQ.queue.length === 0 && stQ.cur === 'huge', 'a queued line expires after about 4 s (queue ' + stQ.queue.length + ', cur ' + stQ.cur + ')');
  await ev(() => PM.Audio.stopVoice());
  check(!(await ev(() => PM.Audio.voiceBusy())), 'stopVoice() silences the current line');
  await ev(() => PM.Audio.setMuted(true));
  check(await ev(() => PM.Audio.voice('b') === false), 'muted: voice returns false');
  await ev(() => PM.Audio.setMuted(false));
  check(g.errors.length === 0, 'no console or page errors' + (g.errors.length ? ': ' + g.errors.join(' | ') : ''));
  await g.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync('python', ['tools/build.py', '--out', BUILD, '--only', '00,10,80', '--no-voice'], { cwd: ROOT, stdio: 'inherit' });
  if (want('sfx') || want('music')) {
    const g = await openGame({ file: BUILD });
    g.page.setDefaultTimeout(600000);
    await g.page.waitForFunction(() => window.PM && PM.Audio && PM.Audio._debug);
    if (want('sfx')) await testSfx(g.page);
    if (want('music')) { await testMusic(g.page); await testScheduler(g.page); }
    check(g.errors.length === 0, 'no console or page errors in the render page' + (g.errors.length ? ': ' + g.errors.join(' | ') : ''));
    await g.close();
  }
  if (want('api')) await testApi();
  if (want('voice')) await testVoice();
  console.log('\n' + (failures ? failures + ' FAILED' : 'all checks passed') + ', ' + warnings + ' warning(s). WAV files: tests/out/audio/');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
