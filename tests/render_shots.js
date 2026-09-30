'use strict';
// Photographs the renderer in headless Edge. Output: tests/out/r_<scene>_<viewport>.png
//   node tests/render_shots.js                          all scenes at all four viewports
//   node tests/render_shots.js --vp 1280x720,390x844    only some viewports
//   node tests/render_shots.js --scenes title,mid       only some scenes
//   node tests/render_shots.js --fake                   use tests/fake_state.js instead of PM.Game (src/40_game.js)
//   node tests/render_shots.js --dpr 2                  device pixel ratio 2 (checks crispness)
//   node tests/render_shots.js --no-build               reuse dist/_dev_r.html
//   node tests/render_shots.js --clip table             crop every picture to the table (use with --dpr 2 to inspect details); also: hud, x,y,w,h
//   node tests/render_shots.js --reduced                emulate prefers-reduced-motion: reduce
//   node tests/render_shots.js --sheet                  also write montage sheets (tests/out/r_sheet_*.png)
//   node tests/render_shots.js --dev dist/_dev_x.html --prefix x_   build to and read another dev file, name the pictures x_<scene>_<viewport>.png
//   Round 2 scenes (SPEC 9): ballLane, ballDirs, ballFlipper, twoBall (the Pacman ball); noticeStart, noticeMid, noticeHold, noticeEnd,
//   lastMorph, last, goodbye, goodbyePoke (the ten minute goodbye). A scene may set R.clip = {x,y,w,h} in table units to crop its picture.
// Exit code 1 when the page logged an error. The page gets a tiny bootstrap (no requestAnimationFrame loop) so every
// picture is deterministic: frames are stepped by hand with a fixed 1/60 s.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { openGame, OUT } = require('./browser_helper');

const ROOT = path.join(__dirname, '..');
const DEV = (() => { const i = process.argv.indexOf('--dev'); return i < 0 ? 'dist/_dev_r.html' : process.argv[i + 1]; })();
const PFX = (() => { const i = process.argv.indexOf('--prefix'); return i < 0 ? 'r_' : process.argv[i + 1]; })();
const VIEWPORTS = [
  { name: '1280x720', w: 1280, h: 720 },
  { name: '1920x1080', w: 1920, h: 1080 },
  { name: '800x1000', w: 800, h: 1000 },
  { name: '390x844', w: 390, h: 844, touch: true },
  { name: '844x390', w: 844, h: 390, touch: true }
];

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const wantVp = opt('vp', '') ? String(opt('vp')).split(',') : null;
const wantScenes = opt('scenes', '') ? String(opt('scenes')).split(',') : null;
const REAL = !opt('fake', false);   // the real game unless --fake
const DPR = Number(opt('dpr', 1)) || 1;
const CLIP = opt('clip', '');

function build() {
  const only = '00,05,06,10,20,30,40,50,60,70';
  execFileSync('python', ['tools/build.py', '--only', only, '--no-voice', '--out', DEV], { cwd: ROOT, stdio: 'inherit' });
}

// ---- scenes: functions that run inside the page. R = window.__R ({game, render, t, step(), run(sec), fresh(opts)}) ------
// They only use SPEC 4.2 (state fields, game.debug hooks), so they work with the real game and with tests/fake_state.js.
const SCENES = {
  title: (R) => { R.fresh(); R.run(3.2); },
  lane: (R) => { R.fresh(); R.game.start(); R.run(0.5); R.game.state.launch.idle = 8; R.run(1.6); },
  laneCharge: (R) => { R.fresh(); R.game.start(); R.run(3.5); R.game.launchDown(); R.run(0.7); },
  mid: (R) => {
    R.fresh({ autoplay: true }); R.game.start(); R.game.debug.setScore(12340); R.game.debug.fillDots(30);
    R.game.state.lanes = [true, false, true]; R.game.state.fruitTray = ['cherry', 'strawberry'];
    // wait for a moment when a ball is out on the playfield and moving
    let got = false;
    for (let i = 0; i < 1500 && !got; i++) {
      R.step();
      for (const b of R.game.world.balls) if (b.state === 'play' && Math.hypot(b.vx, b.vy) > 420 && b.y > 250 && b.y < 700 && R.t > 6) got = true;
    }
  },
  mid2: (R) => {
    R.fresh({ autoplay: true }); R.game.start(); R.game.debug.setScore(87650); R.game.debug.fillDots(20); R.game.debug.spawnFruit('strawberry');
    R.game.state.multiplier = 3; R.game.state.lanes = [true, true, false]; R.game.state.fruitTray = ['cherry', 'strawberry', 'orange', 'apple'];
    R.game.state.ballNo = 3; R.game.state.ballsLeft = 2; R.game.state.level = 2; R.game.state.ballSave = 9;
    for (let i = 0; i < 600; i++) R.step();
  },
  fruit: (R) => { R.fresh(); R.game.start(); R.game.debug.setScore(2500); R.game.debug.fillDots(30); R.game.debug.spawnFruit('strawberry'); R.run(1.2); },
  levelClear: (R) => { R.fresh(); R.game.start(); R.game.debug.setScore(2500); R.game.debug.fillDots(0); R.run(1.0); },
  fx: (R) => {
    R.fresh(); R.game.start(); R.game.debug.setScore(2500); R.run(2.4);
    const list = [
      { type: 'confetti', x: 264, y: 300, color: '#FFD84A', n: 14 }, { type: 'sparkle', x: 150, y: 420, color: '#FFD84A', n: 8 },
      { type: 'ring', x: 330, y: 400, color: '#6FDCF0', n: 1 }, { type: 'stars', x: 264, y: 250, color: '#FF6B6B', n: 6 },
      { type: 'pop', x: 200, y: 560, color: '#FF9ECB', n: 8 }, { type: 'chomp', x: 330, y: 560, color: '#FFF6E0', n: 6 }
    ];
    R.game.drainFx = () => { const l = list.splice(0); return l; };
    R.run(0.35);
  },
  house: (R) => {
    R.fresh(); R.game.start(); R.game.debug.setScore(2500); R.run(3.5); R.game.debug.launchNow(0.2);
    for (let i = 0; i < 900; i++) { R.step(); const h = R.game.world.elements.holes.house; if (h.occupied && h.t > 0.6) break; }
    R.clip = { x: 170, y: 120, w: 190, h: 150 };
  },
  orbit: (R) => {
    R.fresh(); R.game.start(); R.game.debug.setScore(2500); R.run(3.5); R.game.debug.launchNow(0.7);
    for (let i = 0; i < 900; i++) { R.step(); const sp = R.game.world.spinners[0]; if (Math.abs(sp.angVel) > 8) break; }
  },
  flippersUp: (R) => { R.fresh(); R.game.start(); R.game.debug.setScore(2500); R.run(3.5); R.game.setKeys({ left: true, right: true }); R.game.launchDown(); R.run(0.7); },
  nori: (R) => { R.fresh(); R.game.start(); R.game.debug.setScore(123456789); R.run(3); R.game.debug.nori && R.game.debug.nori(); R.run(0.9); },
  power: (R) => { R.fresh({ autoplay: true }); R.game.start(); R.game.debug.setScore(5400); R.game.debug.givePower(); R.run(1.0); },
  powerLater: (R) => { R.fresh({ autoplay: true }); R.game.start(); R.game.debug.setScore(5400); R.game.debug.givePower(); R.run(4.6); },
  save: (R) => {
    R.fresh(); R.game.start(); R.game.debug.setScore(9100); R.run(3);
    R.game.debug.setBallSave && R.game.debug.setBallSave(15);
    R.game.debug.launchNow && R.game.debug.launchNow(0.4); R.run(0.4); R.game.debug.drain(); R.run(0.55);
  },
  spit: (R) => { R.fresh(); R.game.start(); R.game.debug.setScore(9100); R.run(3); R.game.debug.setBallSave && R.game.debug.setBallSave(15); R.game.debug.launchNow && R.game.debug.launchNow(0.4); R.run(0.4); R.game.debug.drain(); R.run(1.2); },
  over1: (R) => { R.fresh(); R.game.start(); R.game.debug.setScore(4200); R.game.debug.forceScreen('over'); R.run(3.6); },
  over3: (R) => { R.fresh({ hiScore: 30000 }); R.game.start(); R.game.debug.setScore(81200); R.game.debug.forceScreen('over'); R.run(4.6); },
  pause: (R) => { R.fresh(); R.game.start(); R.game.debug.setScore(3300); R.run(0.6); R.game.debug.forceScreen('paused'); R.run(1.4); },
  // ---- round 2: the Pacman ball (SPEC 9.1). These scenes only draw: the physics is not stepped, so balls stay where they are put.
  ballLane: (R) => { R.fresh(); R.game.start(); R.run(3.5); R.clip = { x: 380, y: 640, w: 150, h: 320 }; },
  ballDirs: (R) => {
    R.fresh(); R.game.start(); R.run(0.5); R.game.state.banner = null;
    const w = R.game.world, list = [w.balls[0]];
    for (let i = 1; i < 8; i++) { const c = Object.assign({}, w.balls[0]); c.id = 100 + i; list.push(c); w.balls.push(c); }
    list.forEach((b, k) => { const a = k * Math.PI / 4; b.state = 'play'; b.x = 96 + k * 48; b.y = 640; b.vx = Math.cos(a) * 320; b.vy = Math.sin(a) * 320; });
    R.draw(40); R.clip = { x: 60, y: 596, w: 400, h: 90 };
  },
  ballFlipper: (R) => {
    R.fresh(); R.game.start(); R.run(0.5);
    const w = R.game.world, b = w.balls[0], f = w.flippers[0], u = 0.62;
    const d = [Math.cos(f.angle), Math.sin(f.angle)];
    let n = [d[1], -d[0]]; if (n[1] > 0) n = [-n[0], -n[1]];
    const rad = f.r0 + (f.r1 - f.r0) * u;
    b.state = 'play'; b.vx = 0; b.vy = 0; b.x = f.px + d[0] * f.len * u + n[0] * (rad + b.r); b.y = f.py + d[1] * f.len * u + n[1] * (rad + b.r);
    R.draw(30); R.clip = { x: f.px - 30, y: f.py - 70, w: 150, h: 110 };
  },
  twoBall: (R) => {
    R.fresh({ autoplay: true }); R.game.start(); R.game.debug.setScore(6400); R.run(0.5);
    const w = R.game.world, a = w.balls[0], c = Object.assign({}, a);
    c.id = a.id + 1; w.balls.push(c);
    a.state = 'play'; a.x = 200; a.y = 470; a.vx = 260; a.vy = 300; c.state = 'play'; c.x = 340; c.y = 560; c.vx = -240; c.vy = -260;
    R.draw(40);
  },

  // balls parked on top of the things that could hide them: the golden lane lights, a power pellet, cream dots, a fruit (check with --dpr 2)
  ballOverLamps: (R) => {
    R.fresh(); R.game.start(); R.run(0.5); R.game.state.lanes = [true, false, true];
    const w = R.game.world, ls = R.game.table.decor.laneLights, list = [w.balls[0]];
    for (let i = 1; i < ls.length; i++) { const c = Object.assign({}, w.balls[0]); c.id = 100 + i; list.push(c); w.balls.push(c); }
    list.forEach((b, i) => { b.state = 'play'; b.x = ls[i].x + 5; b.y = ls[i].y + 3; b.vx = 200; b.vy = 100; });
    R.draw(30); R.clip = { x: ls[0].x - 60, y: ls[0].y - 40, w: ls[ls.length - 1].x - ls[0].x + 120, h: 80 };
  },
  ballOverPickups: (R) => {
    R.fresh(); R.game.start(); R.run(0.5); R.game.debug.spawnFruit('strawberry');
    const w = R.game.world, act = (k) => w.sensors.filter((s) => s.kind === k && s.active);
    const pel = act('pellet')[0], dots = act('dot'), fr = w.sensors.find((s) => s.kind === 'fruit' && s.active) || { x: 264, y: 640 };
    const spots = [[pel.x + 4, pel.y + 3], [dots[10].x + 5, dots[10].y], [dots[11].x - 3, dots[11].y + 4], [fr.x + 8, fr.y + 4]];
    const list = [w.balls[0]];
    for (let i = 1; i < spots.length; i++) { const c = Object.assign({}, w.balls[0]); c.id = 100 + i; list.push(c); w.balls.push(c); }
    list.forEach((b, i) => { b.state = 'play'; b.x = spots[i][0]; b.y = spots[i][1]; b.vx = 150; b.vy = 150; });
    R.draw(30);
    const xs = spots.map((p) => p[0]), ys = spots.map((p) => p[1]);
    R.clip = { x: Math.min.apply(null, xs) - 40, y: Math.min.apply(null, ys) - 40, w: Math.max.apply(null, xs) - Math.min.apply(null, xs) + 80, h: Math.max.apply(null, ys) - Math.min.apply(null, ys) + 80 };
  },

  // ---- round 2: the ten minute goodbye (SPEC 9.2). Only drawn, never stepped, with state.limit set by hand.
  noticeStart: (R) => { R.fresh(); R.game.start(); R.run(3.5); R.game.debug.setScore(8400); R.limit('notice', 0.12); R.draw(3); },
  noticeMid: (R) => { R.fresh(); R.game.start(); R.run(3.5); R.game.debug.setScore(8400); R.limit('notice', 0.12); R.draw(1); R.limit('notice', 0.42); R.draw(2); },
  noticeHold: (R) => { R.fresh(); R.game.start(); R.run(3.5); R.game.debug.setScore(8400); R.limit('notice', 0.12); R.draw(1); R.limit('notice', 3.4); R.draw(25); },
  noticeEnd: (R) => { R.fresh(); R.game.start(); R.run(3.5); R.game.debug.setScore(8400); R.limit('notice', 0.12); R.draw(1); R.limit('notice', 8.9); R.draw(10); },
  lastMorph: (R) => { R.fresh(); R.game.start(); R.run(3.5); R.game.debug.setScore(8400); R.limit('notice', 8.9); R.draw(2); R.limit('last', 0.2); R.draw(2); },
  lastMorph2: (R) => { R.fresh(); R.game.start(); R.run(3.5); R.game.debug.setScore(8400); R.limit('notice', 8.9); R.draw(2); R.limit('last', 0.4); R.draw(2); },
  last: (R) => { R.fresh(); R.game.start(); R.run(3.5); R.game.debug.setScore(8400); R.limit('notice', 8.9); R.draw(2); R.limit('last', 1.4); R.draw(30); R.game.state.banner = null; },
  goodbye: (R) => { R.fresh(); R.game.start(); R.run(3.5); R.game.debug.setScore(18400); R.limit('goodbye', 0.2, { stars: 2 }); R.draw(300); },
  goodbyePoke: (R) => { R.fresh(); R.game.start(); R.run(3.5); R.game.debug.setScore(18400); R.limit('goodbye', 0.2, { stars: 2 }); R.draw(300); R.game.state.limit.poke++; R.draw(9); },
};
for (const id of ['bigflip', 'slow', 'balloons', 'fruits', 'dance', 'shield', 'extraball']) {
  SCENES['sur_' + id] = (R, sid) => { R.fresh({ autoplay: true }); R.game.start(); R.game.debug.setScore(2500); R.game.debug.fillDots(30); R.run(0.4); R.game.debug.triggerSurprise(sid); R.run(2.1); };
  SCENES['sur_' + id].arg = id;
  SCENES['surLater_' + id] = (R, sid) => { R.fresh({ autoplay: true }); R.game.start(); R.game.debug.setScore(2500); R.game.debug.fillDots(30); R.run(0.4); R.game.debug.triggerSurprise(sid); R.run(5.6); };
  SCENES['surLater_' + id].arg = id;
}

// ---- in-page bootstrap -------------------------------------------------------------------------------------------
function bootstrap(arg) {
  const useReal = arg.real, touch = arg.touch;
  const canvas = document.getElementById('game');
  const R = { t: 0, game: null, render: null };
  R.step = function () { R.game.update(1 / 60); R.t += 1 / 60; R.render.draw(R.t); };
  R.run = function (sec) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) R.step(); };
  R.clip = null;
  R.draw = function (n) { for (let i = 0; i < n; i++) { R.t += 1 / 60; R.render.draw(R.t); } };
  // sets state.limit by hand (SPEC 9.2) and the screen that goes with it; scenes then only draw, so nothing overwrites it
  R.limit = function (phase, t, extra) {
    const st = R.game.state;
    st.limit = Object.assign({ enabled: true, phase: phase, t: t, playSec: 600, limitSec: 600, poke: st.limit && st.limit.poke || 0, score: st.score, stars: 2 }, extra || {});
    if (phase === 'goodbye') { st.screen = 'goodbye'; st.stars = st.limit.stars; }
    if (phase === 'notice') st.banner = { kind: 'limit', text: 'Sokat', sub: '', icon: 'pacman', t: 0.5, dur: 3 };
  };
  R.fresh = function (o) {
    R.clip = null;
    o = o || {};
    const make = (useReal && PM.Game && PM.Game.create) ? PM.Game.create : PM.FakeGame.create;
    R.game = make({ seed: 1, hiScore: o.hiScore == null ? 48250 : o.hiScore, autoplay: !!o.autoplay });
    if (touch) R.game.state.ui.touch = true;
    R.render = PM.Render.create(canvas, R.game);
    R.t = 0;
    R.render.draw(0);
  };
  window.__R = R;
  return true;
}

function runScene(a) {
  const R = window.__R;
  const f = eval('(' + a.src + ')');
  f(R, a.arg);
}

async function montage(names, outName, cols) {
  const { chromium } = require('playwright-core');
  const { EDGE } = require('./browser_helper');
  const files = names.map((n) => path.join(OUT, n + '.png')).filter((f) => fs.existsSync(f));
  if (!files.length) return;
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const imgs = files.map((f) => '<img src="data:image/png;base64,' + fs.readFileSync(f).toString('base64') + '">').join('');
  await page.setContent('<body style="margin:0;background:#000"><div style="display:grid;grid-template-columns:repeat(' + cols + ',max-content);gap:4px;width:max-content">' + imgs + '</div></body>');
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => { const d = document.querySelector('div').getBoundingClientRect(); return { w: Math.ceil(d.width), h: Math.ceil(d.height) }; });
  await page.setViewportSize({ width: box.w, height: box.h });
  await page.screenshot({ path: path.join(OUT, outName) });
  await browser.close();
}

async function main() {
  if (!argv.includes('--no-build')) build();
  const errors = [];
  const made = [];
  for (const vp of VIEWPORTS) {
    if (wantVp && !wantVp.includes(vp.name)) continue;
    const g = await openGame({ file: DEV, viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: DPR, hasTouch: !!vp.touch, isMobile: false, reducedMotion: argv.includes('--reduced') ? 'reduce' : 'no-preference' });
    try {
      await g.page.addScriptTag({ path: path.join(__dirname, 'fake_state.js') });
      await g.page.evaluate(() => window.PM.Theme.fontsReady);
      await g.page.evaluate(() => document.fonts.ready);
      await g.page.evaluate(bootstrap, { real: REAL, touch: !!vp.touch });
    } catch (e) { errors.push('setup ' + vp.name + ': ' + e.message); await g.close(); continue; }
    for (const name of Object.keys(SCENES)) {
      if (wantScenes && !wantScenes.includes(name)) continue;
      const fn = SCENES[name];
      try {
        await g.page.evaluate(runScene, { src: fn.toString(), arg: fn.arg || null });
        await g.page.waitForTimeout(30);
        const file = PFX + name + '_' + vp.name + (CLIP ? '_clip' : '');
        const sceneClip = await g.page.evaluate(() => { const c = window.__R.clip, L = window.__R.render.layout; return c ? { x: L.table.x + c.x * L.scale, y: L.table.y + c.y * L.scale, width: c.w * L.scale, height: c.h * L.scale } : null; });
        if (sceneClip) await g.page.screenshot({ path: path.join(OUT, file + '_clip.png'), clip: sceneClip });
        if (CLIP) {
          const clip = await g.page.evaluate((mode) => {
            const L = window.__R.render.layout, t = L.table;
            if (mode === 'table') return { x: t.x, y: t.y, width: t.w, height: t.h };
            if (mode === 'hud') return { x: 0, y: 0, width: L.w, height: Math.max(80, L.mode === 'tall' ? L.panels.top.h : t.y + 260) };
            const a = String(mode).split(',').map(Number);
            return { x: a[0], y: a[1], width: a[2], height: a[3] };
          }, String(CLIP));
          await g.page.screenshot({ path: path.join(OUT, file + '.png'), clip: clip });
        } else await g.shot(file);
        if (argv.includes('--sheet') && (name.startsWith('sur_') || name.startsWith('surLater_'))) {
          const c = await g.page.evaluate(() => { const t = window.__R.render.layout.table; return { x: t.x, y: t.y, width: t.w, height: t.h }; });
          await g.page.screenshot({ path: path.join(OUT, file + '_tbl.png'), clip: c });
        }
        made.push(file);
      } catch (e) { errors.push(name + ' @' + vp.name + ': ' + e.message.split('\n')[0]); }
    }
    for (const e of g.errors) errors.push('page @' + vp.name + ': ' + e);
    const lay = await g.page.evaluate(() => JSON.stringify(window.__R.render.layout, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));
    fs.writeFileSync(path.join(OUT, PFX + 'layout_' + vp.name + '.json'), lay);
    await g.close();
  }
  if (argv.includes('--sheet')) {
    for (const vp of VIEWPORTS) {
      if (wantVp && !wantVp.includes(vp.name)) continue;
      const ids = ['bigflip', 'slow', 'balloons', 'fruits', 'dance', 'shield', 'extraball'];
      await montage(ids.map((id) => 'r_sur_' + id + '_' + vp.name + '_tbl'), 'r_sheet_surprises_' + vp.name + '.png', 4);
      await montage(ids.map((id) => 'r_surLater_' + id + '_' + vp.name + '_tbl'), 'r_sheet_surprisesLater_' + vp.name + '.png', 4);
    }
  }
  console.log('wrote ' + made.length + ' pictures to tests/out');
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
