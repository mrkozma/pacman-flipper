'use strict';
// Frame times and robustness of the REAL game (game + renderer + main, real requestAnimationFrame) in headless Edge.
//   node tests/render_real_perf.js [--file dist/pacman-flipper.html] [--seconds 60] [--vp 1280x720] [--dpr 1] [--skill 0.8] [--seed 5]
//                                  [--no-robust]
// Prints mean / p95 / p99 / max for game.update, render.draw and the frame gap. Then checks that resizing, tab switches
// (visibilitychange), blur, rotation and a canvas of tiny size never leave a blank canvas or a NaN layout scale.
// Headless Edge draws in software, so a real GPU laptop should do better than these numbers.
const path = require('path');
const { openGame } = require('./browser_helper');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const FILE = opt('file', 'dist/pacman-flipper.html');
const SECONDS = Number(opt('seconds', 60));
const [W, H] = String(opt('vp', '1280x720')).split('x').map(Number);
const DPR = Number(opt('dpr', 1));
const SKILL = opt('skill', '0.8'), SEED = opt('seed', '5');
let failures = 0;
function check(name, ok, detail) { if (!ok) failures++; console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? '  (' + detail + ')' : '')); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// how many pixels of a screenshot-sized sample differ from the first one: a blank canvas is one flat colour
function sampleScript() {
  const c = document.getElementById('game');
  const t = document.createElement('canvas'); t.width = 48; t.height = 48;
  const x = t.getContext('2d'); x.drawImage(c, 0, 0, 48, 48);
  const d = x.getImageData(0, 0, 48, 48).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4) seen.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
  return seen.size;
}

(async () => {
  console.log('== real game perf: ' + FILE + ' ' + W + 'x' + H + ' dpr' + DPR + ' ' + SECONDS + ' s autoplay skill ' + SKILL);
  const g = await openGame({ file: FILE, viewport: { width: W, height: H }, deviceScaleFactor: DPR, query: '?autoplay=1&mute=1&seed=' + SEED + '&skill=' + SKILL });
  await g.page.waitForFunction(() => window.PM_DEBUG, null, { timeout: 15000 });
  await g.page.evaluate(() => {
    const D = window.PM_DEBUG, T = { upd: [], draw: [], gap: [] };
    window.__perf = T;
    const ru = D.game.update, rd = D.render.draw;
    D.game.update = function (dt) { const a = performance.now(); ru.call(D.game, dt); T.upd.push(performance.now() - a); };
    D.render.draw = function (t) { const a = performance.now(); rd.call(D.render, t); T.draw.push(performance.now() - a); };
    let last = 0;
    const tick = (ts) => { if (last) T.gap.push(ts - last); last = ts; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    T.screens = {}; T.maxScore = 0; T.q = [];
    setInterval(() => { const s = D.game.state; T.screens[s.screen] = (T.screens[s.screen] || 0) + 1; T.maxScore = Math.max(T.maxScore, s.score); T.q.push(D.render.quality); }, 500);
  });
  await sleep(SECONDS * 1000);
  const res = await g.page.evaluate(() => {
    const T = window.__perf, D = window.PM_DEBUG;
    const stat = (arr) => { const a = arr.slice(30).sort((x, y) => x - y); if (!a.length) return null; const m = a.reduce((x, y) => x + y, 0) / a.length; const q = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))]; return { n: a.length, mean: +m.toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +a[a.length - 1].toFixed(2) }; };
    const over33 = T.gap.filter((x) => x > 33.5).length, over50 = T.gap.filter((x) => x > 50).length;
    return { update: stat(T.upd), draw: stat(T.draw), gap: stat(T.gap), gapsOver33: over33, gapsOver50: over50, frames: T.gap.length, screens: T.screens, maxScore: T.maxScore,
      qualityMin: Math.min.apply(null, T.q), stats: D.render.stats, score: D.game.state.score, ball: D.game.state.ballNo, level: D.game.state.level };
  });
  console.log(JSON.stringify(res, null, 1));
  check('render.draw mean under 4 ms', res.draw.mean < 4, res.draw.mean + ' ms');
  check('render.draw p99 under 10 ms', res.draw.p99 < 10, res.draw.p99 + ' ms');
  check('frame gap mean close to 16.7 ms', res.gap.mean < 18.5, res.gap.mean + ' ms');
  check('the adaptive quality never dropped', res.qualityMin === 2, 'min quality ' + res.qualityMin);
  check('no console errors or page errors during the run', g.errors.length === 0, g.errors.slice(0, 3).join(' | '));

  if (!argv.includes('--no-robust')) {
    console.log('-- robustness');
    const P = g.page;
    const info = () => P.evaluate(() => { const L = PM_DEBUG.render.layout; return { scale: L.scale, ok: isFinite(L.scale) && L.scale > 0 && isFinite(L.table.x) && isFinite(L.table.y) && isFinite(L.table.w) && L.table.w > 0, mode: L.mode, screen: PM_DEBUG.game.state.screen }; });
    const colors = () => P.evaluate(sampleScript);
    for (const vp of [{ width: 1920, height: 1080 }, { width: 800, height: 1000 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 480 }, { width: 200, height: 120 }, { width: 1280, height: 720 }]) {
      await P.setViewportSize(vp); await sleep(500);
      const i = await info(), c = await colors();
      check('resize to ' + vp.width + 'x' + vp.height + ': valid layout and a painted canvas', i.ok && c > 6, i.mode + ' scale ' + i.scale.toFixed(3) + ' colours ' + c);
    }
    // quick resize storm
    for (let k = 0; k < 20; k++) await P.setViewportSize({ width: 600 + k * 37, height: 500 + (k % 5) * 90 });
    await sleep(400);
    let i = await info(); check('a storm of 20 resizes leaves a valid layout', i.ok);
    await P.setViewportSize({ width: 1280, height: 720 }); await sleep(300);
    // tab switch: the game pauses (autoplay keeps going) and nothing breaks when it comes back
    await P.evaluate(() => { Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(1500);
    await P.evaluate(() => { Object.defineProperty(document, 'hidden', { get: () => false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(800);
    i = await info(); const c = await colors();
    check('a tab switch away and back keeps a valid layout and a painted canvas', i.ok && c > 6, 'screen ' + i.screen + ' colours ' + c);
    // a 3 second stall (dt clamp): the ball must not fly through the world
    const before = await P.evaluate(() => PM_DEBUG.game.state.time);
    await P.evaluate(() => { const t = performance.now(); while (performance.now() - t < 1500); });
    await sleep(600);
    const after = await P.evaluate(() => PM_DEBUG.game.state.time);
    check('a 1.5 s main thread stall does not fast forward the game', after - before < 1.5, 'game time moved ' + (after - before).toFixed(2) + ' s');
    check('still no console errors after the robustness checks', g.errors.length === 0, g.errors.slice(0, 3).join(' | '));
  }
  await g.close();
  console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL PASS'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
