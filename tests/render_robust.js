'use strict';
// Robustness of PM.Render: it must never throw and never log an error, whatever it is given.
//   node tests/render_robust.js [--no-build] [--dev dist/_dev_x.html]
// Cases: missing PM.Sprites functions, missing PM.Theme, every game.state key removed or set to junk, odd window sizes,
// a game without a world, reduced motion, huge particle bursts. Exit code 1 on any console error, page error or non finite layout.
const path = require('path');
const { execFileSync } = require('child_process');
const { openGame } = require('./browser_helper');
const ROOT = path.join(__dirname, '..');
const DEV = (() => { const i = process.argv.indexOf('--dev'); return i < 0 ? 'dist/_dev_r.html' : process.argv[i + 1]; })();   // --dev dist/_dev_x.html to keep clear of other builds

function inPage() {
  const out = { cases: 0, layoutBad: [], notes: [] };
  const canvas = document.getElementById('game');
  const finite = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' && !isFinite(v) ? '@@BAD' : v)).indexOf('@@BAD') < 0;
  const screens = ['title', 'play', 'paused', 'over', 'notice', 'last', 'goodbye'];   // the three last ones are the ten minute goodbye (SPEC 9.2); goodbye ends a game, so it stays last
  function drawAll(game, render, frames) {
    let t = 0;
    for (const sc of screens) {
      game.debug.forceScreen(sc);
      for (let i = 0; i < frames; i++) { game.update(1 / 60); t += 1 / 60; render.draw(t + out.cases); }
    }
    out.cases++;
    if (!finite(render.layout)) out.layoutBad.push(JSON.stringify(render.layout).slice(0, 200));
  }
  const mk = (o) => PM.Game.create(Object.assign({ seed: 5, autoplay: true, hiScore: 1000 }, o || {}));

  // 1. normal
  { const g = mk(); const r = PM.Render.create(canvas, g); g.start(); drawAll(g, r, 20); }

  // 2. sprites missing, one function at a time and all at once
  const realSprites = PM.Sprites;
  for (const name of Object.keys(realSprites).concat(['@all'])) {
    PM.Sprites = name === '@all' ? {} : Object.assign({}, realSprites);
    if (name !== '@all') delete PM.Sprites[name];
    const g = mk(); const r = PM.Render.create(canvas, g); g.start(); g.debug.triggerSurprise('balloons'); drawAll(g, r, 6);
  }
  PM.Sprites = realSprites;

  // 3. no theme at all
  { const th = PM.Theme; PM.Theme = undefined; const g = mk(); const r = PM.Render.create(canvas, g); g.start(); drawAll(g, r, 6); PM.Theme = th; }

  // 4. state keys removed / junk
  const junk = [undefined, null, NaN, -5, 1e12, 'abc', {}, [], [1, 2, 3], true];
  { const g = mk(); const r = PM.Render.create(canvas, g); g.start(); g.debug.triggerSurprise('fruits'); g.debug.givePower();
    for (let i = 0; i < 90; i++) { g.update(1 / 60); r.draw(i / 60); }
    for (const key of Object.keys(g.state)) {
      const keep = g.state[key];
      for (const j of junk) {
        g.state[key] = j;
        try { for (const sc of screens) { const keepScr = g.state.screen; if (key !== 'screen') g.state.screen = sc; r.draw(100 + out.cases * 0.01); g.state.screen = keepScr; } } catch (e) { out.notes.push('throw with state.' + key + '=' + String(j) + ': ' + e.message); }
        out.cases++;
      }
      g.state[key] = keep;
    }
    // nested pieces
    for (const key of ['launch', 'keys', 'ui', 'nori', 'pacmanHelper', 'mystery']) {
      const keep = g.state[key];
      for (const inner of Object.keys(keep || {})) {
        const k2 = keep[inner];
        for (const j of junk) { keep[inner] = j; r.draw(200 + out.cases * 0.01); out.cases++; }
        keep[inner] = k2;
      }
    }
  }

  // 5. a game without a world, and with a world with no balls array entries
  { const g = mk(); const r = PM.Render.create(canvas, { state: g.state, table: g.table, world: null, drainFx() { return []; } });
    for (const sc of screens) { g.state.screen = sc; for (let i = 0; i < 5; i++) r.draw(300 + i / 60); } out.cases++; }

  // 6. reduced motion and particle floods
  { const g = mk(); const r = PM.Render.create(canvas, g); g.start();
    const flood = []; for (let i = 0; i < 400; i++) flood.push({ type: ['sparkle', 'confetti', 'ring', 'pop', 'chomp', 'stars', 'heart', 'nope'][i % 8], x: (i * 37) % 540, y: (i * 91) % 960, color: i % 3 ? '#FF6B6B' : 'mint', n: 30 });
    g.drainFx = () => flood.splice(0, 100);
    for (let i = 0; i < 40; i++) { g.update(1 / 60); r.draw(400 + i / 60); }
    if (r.stats.particles > 60) out.notes.push('particles over budget: ' + r.stats.particles);
    out.particles = r.stats.particles; out.cases++; }
  // 7. the ten minute goodbye (SPEC 9.2): every phase with junk in state.limit (whole object and each field), in state.screen, in the
  //    strings it reads (PM.T.limit_notice, limit_last, goodbye and their PM.T.r fallbacks), in the balls and in the layout rectangles
  {
    for (const ph of ['notice', 'last', 'goodbye']) {
      const g = mk(); const r = PM.Render.create(canvas, g); g.start();
      g.debug.forceScreen(ph);
      for (let i = 0; i < 20; i++) { g.update(1 / 60); r.draw(500 + i / 60); }
      const L = g.state.limit;
      if (!L || L.phase !== ph) out.notes.push('debug.forceScreen(' + ph + ') left state.limit.phase = ' + (L && L.phase));
      for (const key of Object.keys(L || {})) { const keep = L[key]; for (const j of junk) { L[key] = j; r.draw(600 + out.cases * 0.01); out.cases++; } L[key] = keep; }
      for (const j of junk) { g.state.limit = j; r.draw(700 + out.cases * 0.01); out.cases++; }
      g.state.limit = { phase: ph, t: -3, poke: 1e15, stars: 'x', score: 'y' }; r.draw(800); out.cases++;
      g.state.limit = { phase: ph, t: 1e15, poke: -4 }; r.draw(801); out.cases++;
      g.state.limit = L;
      const keepT = { a: PM.T.limit_notice, b: PM.T.limit_last, c: PM.T.goodbye }, keepR = { a: PM.T.r.limit_notice, b: PM.T.r.limit_last, c: PM.T.r.goodbye };
      for (const j of junk.concat([{ text: 5, sub: {} }, { title: [], line1: 7, line2: null, parents: NaN }, { text: 'x'.repeat(400), sub: 'y '.repeat(300), title: 'z'.repeat(200), line1: 'w '.repeat(150), line2: '', parents: 'p '.repeat(200) }])) {
        PM.T.limit_notice = j; PM.T.limit_last = j; PM.T.goodbye = j; PM.T.r.limit_notice = j; PM.T.r.limit_last = j; PM.T.r.goodbye = j;
        for (let i = 0; i < 3; i++) r.draw(900 + out.cases * 0.01 + i / 60);
        out.cases++;
      }
      PM.T.limit_notice = keepT.a; PM.T.limit_last = keepT.b; PM.T.goodbye = keepT.c; PM.T.r.limit_notice = keepR.a; PM.T.r.limit_last = keepR.b; PM.T.r.goodbye = keepR.c;
      // balls with junk numbers and states while the notice is up (the Pacman ball reads x, y, vx, vy, r, state, id)
      if (ph !== 'goodbye') for (const key of ['x', 'y', 'vx', 'vy', 'r', 'state', 'id']) {
        const b = g.world.balls[0]; if (!b) continue; const keep = b[key];
        for (const j of junk) { b[key] = j; r.draw(1000 + out.cases * 0.01); out.cases++; }
        b[key] = keep;
      }
      if (!finite(r.layout)) out.layoutBad.push('goodbye layout ' + ph);
      out.cases++;
    }
  }
  return out;
}

async function main() {
  if (!process.argv.includes('--no-build')) execFileSync('python', ['tools/build.py', '--only', '00,05,06,10,20,30,40,50,60,70', '--no-voice', '--out', DEV], { cwd: ROOT, stdio: 'inherit' });
  const g = await openGame({ file: DEV, viewport: { width: 1280, height: 720 } });
  await g.page.evaluate(() => PM.Theme.fontsReady);
  const results = [];
  const sizes = [[1280, 720], [390, 844], [844, 390], [2000, 300], [300, 2000], [120, 120], [3840, 2160]];
  for (const [w, h] of sizes) {
    await g.page.setViewportSize({ width: w, height: h });
    results.push([w + 'x' + h, await g.page.evaluate(inPage)]);
  }
  // reduced motion
  await g.page.emulateMedia({ reducedMotion: 'reduce' });
  await g.page.setViewportSize({ width: 1280, height: 720 });
  results.push(['reduced-motion', await g.page.evaluate(inPage)]);
  let bad = 0;
  for (const [name, r] of results) {
    console.log(name, 'cases', r.cases, 'particles', r.particles, r.layoutBad.length ? 'LAYOUT BAD' : '', r.notes.length ? r.notes.slice(0, 5) : '');
    bad += r.layoutBad.length + r.notes.length;
  }
  console.log('console/page errors:', g.errors.length);
  for (const e of g.errors.slice(0, 20)) console.log('  ', e.split('\n')[0]);
  await g.close();
  process.exit(bad || g.errors.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
