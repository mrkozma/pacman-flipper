'use strict';
// The ten minute goodbye (SPEC 9.2), rendering side, with the real game:
//   node tests/render_limit.js [--no-build] [--dev dist/_dev_x.html] [--shots]
// 1 layout   at five window sizes the notice and the badge rectangles lie inside the window and do not touch the table
// 2 flow     a real game with a short play limit goes none -> notice -> last -> goodbye; the notice lasts LIMIT_NOTICE_SECONDS; --shots
//            writes tests/out/rl_<phase>_<viewport>.png for each phase
// 3 calm     the mean brightness of the picture never jumps between two frames (nothing flashes) while the notice pops in, shrinks into the
//            badge and the goodbye fades in
// 4 poke     a poke on the goodbye screen makes Pacman hop (limitInfo().pokeT) and blow hearts, then it settles
// 5 reduced  with prefers-reduced-motion the goodbye screen around Pacman is completely still, with normal motion it is not
// Exit code 1 on any failure or console error.
const path = require('path');
const { execFileSync } = require('child_process');
const { openGame, OUT } = require('./browser_helper');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const DEV = (() => { const i = argv.indexOf('--dev'); return i < 0 ? 'dist/_dev_r.html' : argv[i + 1]; })();
const SHOTS = argv.includes('--shots');
const VPS = [{ w: 1280, h: 720 }, { w: 1920, h: 1080 }, { w: 800, h: 1000 }, { w: 390, h: 844, touch: true }, { w: 844, h: 390, touch: true }];
let failures = 0;
const check = (name, ok, detail) => { if (!ok) failures++; console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? '  (' + detail + ')' : '')); };

// ---- in the page ------------------------------------------------------------------------------------------------------
function setup(o) {
  const canvas = document.getElementById('game');
  const game = PM.Game.create({ seed: 5, playLimitSeconds: o.limit, hiScore: 1000 });
  if (o.touch) game.state.ui.touch = true;
  const render = PM.Render.create(canvas, game);
  const T = { game: game, render: render, t: 0, canvas: canvas, phaseLog: [], lum: [] };
  const probe = document.createElement('canvas'); probe.width = 48; probe.height = 27;
  const pc = probe.getContext('2d');
  T.meanLum = () => { pc.drawImage(canvas, 0, 0, 48, 27); const d = pc.getImageData(0, 0, 48, 27).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; return s / (d.length / 4); };
  T.step = (n) => { for (let i = 0; i < n; i++) { game.update(1 / 60); T.t += 1 / 60; render.draw(T.t); const ph = game.state.limit && game.state.limit.phase; if (!T.phaseLog.length || T.phaseLog[T.phaseLog.length - 1].phase !== ph) T.phaseLog.push({ phase: ph, screen: game.state.screen, at: T.t, prevT: T.lastT }); T.lastT = game.state.limit ? game.state.limit.t : 0; } };
  window.__T = T;
  game.start();
  return { limitSec: game.state.limit.limitSec, noticeSec: PM.CFG.LIMIT_NOTICE_SECONDS };
}
function until(o) {   // step frames until the limit phase is o.phase (max o.max frames); records mean brightness while o.lum
  const T = window.__T, g = T.game;
  const lum = [];
  let i = 0;
  for (; i < o.max; i++) {
    if (g.state.limit.phase === o.phase && (o.after == null || g.state.limit.t >= o.after)) break;
    if (o.launch && g.state.launch.waiting && i % 40 === 0) { g.launchDown(); T.step(6); g.launchUp(); }   // a tap launches the ball waiting in the lane (the ball saver puts a drained ball back once)
    T.step(1);
    if (o.lum) lum.push(T.meanLum());
  }
  return { frames: i, phase: g.state.limit.phase, t: g.state.limit.t, screen: g.state.screen, lum: lum };
}
function frames(a) { const n = typeof a === 'number' ? a : a.n, withLum = typeof a === 'object' && a.lum, T = window.__T, lum = []; for (let i = 0; i < n; i++) { T.step(1); if (withLum) lum.push(T.meanLum()); } return { lum: lum, phase: T.game.state.limit.phase }; }
function maxJump(a) { let m = 0; for (let i = 1; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - a[i - 1])); return m; }

async function main() {
  if (!argv.includes('--no-build')) execFileSync('python', ['tools/build.py', '--only', '00,05,06,10,20,30,40,50,60,70', '--no-voice', '--out', DEV], { cwd: ROOT, stdio: 'inherit' });

  // ---- 1 layout
  console.log('== layout: notice and badge rectangles');
  for (const vp of VPS) {
    const g = await openGame({ file: DEV, viewport: { width: vp.w, height: vp.h }, hasTouch: !!vp.touch });
    await g.page.evaluate(() => PM.Theme.fontsReady);
    const L = await g.page.evaluate((touch) => {
      const canvas = document.getElementById('game'), game = PM.Game.create({ seed: 5, playLimitSeconds: 0 });
      if (touch) game.state.ui.touch = true;
      const r = PM.Render.create(canvas, game); r.draw(0);
      const l = r.layout;
      return { mode: l.mode, w: l.w, h: l.h, table: l.table, notice: l.hud.notice, badge: l.hud.badge };
    }, !!vp.touch);
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const inside = (a) => a.x >= 0 && a.y >= 0 && a.x + a.w <= L.w + 0.5 && a.y + a.h <= L.h + 0.5 && a.w > 0 && a.h > 0;
    const f = (a) => [a.x, a.y, a.w, a.h].map((v) => Math.round(v)).join(',');
    check(vp.w + 'x' + vp.h + ' (' + L.mode + '): notice ' + f(L.notice) + ' and badge ' + f(L.badge) + ' are in the window and clear of the table ' + f(L.table), inside(L.notice) && inside(L.badge) && !hit(L.notice, L.table) && !hit(L.badge, L.table));
    await g.close();
  }

  // ---- 2 flow, 3 calm, 4 poke (1280x720, and the phone for the shots)
  for (const vp of [VPS[0], VPS[3]]) {
    console.log('== flow at ' + vp.w + 'x' + vp.h);
    const g = await openGame({ file: DEV, viewport: { width: vp.w, height: vp.h }, hasTouch: !!vp.touch });
    await g.page.evaluate(() => PM.Theme.fontsReady);
    const info = await g.page.evaluate(setup, { limit: 6, touch: !!vp.touch });
    const shot = async (name) => { if (SHOTS) await g.page.screenshot({ path: path.join(OUT, 'rl_' + name + '_' + vp.w + 'x' + vp.h + '.png') }); };
    const n = await g.page.evaluate(until, { phase: 'notice', max: 60 * 30, lum: true });
    check('the notice starts after the play limit (' + info.limitSec + ' s)', n.phase === 'notice' && n.frames / 60 >= info.limitSec - 0.2 && n.frames / 60 < info.limitSec + 7, 'after ' + (n.frames / 60).toFixed(1) + ' s');
    await g.page.evaluate(frames, 20); await shot('notice_start');
    await g.page.evaluate(frames, 60); await shot('notice_hold');
    const nl = await g.page.evaluate(until, { phase: 'last', max: 60 * 20, lum: true });
    check('phase last follows the notice', nl.phase === 'last', 'reached after ' + (nl.frames / 60).toFixed(1) + ' more seconds');
    const lum2 = await g.page.evaluate(frames, { n: 45, lum: true });   // the shrink into the badge
    await shot('last');
    check('nothing flashes while the notice shrinks into the badge (brightness step per frame)', maxJump(lum2.lum) < 3.5, 'max ' + maxJump(lum2.lum).toFixed(2) + ' of 255');
    check('nothing flashes while the notice pops in and holds', maxJump(n.lum.slice(-140)) < 3.5, 'max ' + maxJump(n.lum.slice(-140)).toFixed(2) + ' of 255');
    const dur = await g.page.evaluate(() => { const T = window.__T, l = T.phaseLog.filter((p) => p.phase === 'last')[0]; return l ? l.prevT : -1; });
    check('the notice lasted LIMIT_NOTICE_SECONDS (' + info.noticeSec + ' s)', Math.abs(dur - info.noticeSec) < 0.3, 'last frame of the notice had t = ' + dur.toFixed(2));
    // launch the last ball and let it drain (no flippers)
    const gb = await g.page.evaluate(until, { phase: 'goodbye', max: 60 * 240, lum: true, launch: true });
    check('phase goodbye follows the last ball, screen is goodbye', gb.phase === 'goodbye' && gb.screen === 'goodbye', 'after ' + (gb.frames / 60).toFixed(1) + ' s of last ball play');
    const fade = await g.page.evaluate(frames, { n: 150, lum: true });
    check('nothing flashes while the goodbye fades in (brightness step per frame)', maxJump(fade.lum) < 3.5, 'max ' + maxJump(fade.lum).toFixed(2) + ' of 255');
    await shot('goodbye');
    const p0 = await g.page.evaluate(() => { const T = window.__T; return { li: T.render.limitInfo(), poke: T.game.state.limit.poke, particles: T.render.stats.particles }; });
    await g.page.evaluate(() => { const T = window.__T; T.game.launchDown(); T.game.launchUp(); });
    const p1 = await g.page.evaluate(() => { const T = window.__T; T.step(2); return { li: T.render.limitInfo(), poke: T.game.state.limit.poke, particles: T.render.stats.particles }; });
    await shot('goodbye_poke');
    const p2 = await g.page.evaluate(() => { const T = window.__T; T.step(70); return { li: T.render.limitInfo(), particles: T.render.stats.particles }; });
    check('a poke is counted by the game', p1.poke === p0.poke + 1, p0.poke + ' -> ' + p1.poke);
    check('the poke makes Pacman hop and blow hearts, then he settles', p0.li.pokeT === 0 && p1.li.pokeT > 0.8 && p1.particles > p0.particles && p2.li.pokeT === 0, 'hop ' + p0.li.pokeT.toFixed(2) + ' -> ' + p1.li.pokeT.toFixed(2) + ' -> ' + p2.li.pokeT.toFixed(2) + ', particles ' + p0.particles + ' -> ' + p1.particles);
    const order = await g.page.evaluate(() => window.__T.phaseLog.map((p) => p.phase).join(','));
    check('phases went none, notice, last, goodbye in that order', order === 'none,notice,last,goodbye', order);
    check('no console or page errors', g.errors.length === 0, g.errors.slice(0, 2).join(' | '));
    await g.close();
  }

  // ---- 5 reduced motion
  console.log('== reduced motion and normal motion on the goodbye screen');
  const still = {};
  for (const mode of ['reduce', 'no-preference']) {
    const g = await openGame({ file: DEV, viewport: { width: 1280, height: 720 }, reducedMotion: mode });
    await g.page.evaluate(() => PM.Theme.fontsReady);
    await g.page.evaluate(setup, { limit: 0 });
    await g.page.evaluate(() => { const T = window.__T; T.game.debug.setScore(9000); T.game.debug.forceScreen('goodbye'); T.step(60 * 5); });
    still[mode] = await g.page.evaluate(() => {
      const T = window.__T, li = T.render.limitInfo(), c = T.canvas, dpr = c.width / T.render.layout.w;
      const grab = () => { const x = Math.max(0, Math.round((li.x - li.r * 1.2) * dpr)), y = Math.max(0, Math.round((li.y - li.r * 1.2) * dpr)), w = Math.round(li.r * 3.4 * dpr), h = Math.round(li.r * 2.4 * dpr); return c.getContext('2d').getImageData(x, y, Math.min(w, c.width - x), Math.min(h, c.height - y)).data; };
      const a = Array.from(grab()); T.step(30); const b = Array.from(grab());
      let diff = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 4) diff++;
      return { diff: diff, n: a.length };
    });
    if (g.errors.length) { failures++; console.log('  FAIL console errors in ' + mode + ': ' + g.errors.slice(0, 2).join(' | ')); }
    await g.close();
  }
  // the box around Pacman also holds a corner of the dimmed table (its ghosts still breathe under the 85 percent dim), so "still" means
  // almost nothing changes, against a picture where the whole hand and mouth move
  check('reduced motion: Pacman on the goodbye screen is still (under 0.1 percent of the values change)', still.reduce.diff < still.reduce.n * 0.001, still.reduce.diff + ' of ' + still.reduce.n + ' values changed in 0.5 s');
  check('normal motion: Pacman waves (over 1 percent of the values change)', still['no-preference'].diff > still['no-preference'].n * 0.01, still['no-preference'].diff + ' of ' + still['no-preference'].n + ' values changed in 0.5 s');

  console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL PASS'));
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
