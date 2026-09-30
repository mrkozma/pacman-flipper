'use strict';
// The Pacman ball (SPEC 9.1): facing, turning and chomping, measured in the real page through render.ballInfo(id).
//   node tests/render_ball_face.js [--no-build] [--dev dist/_dev_x.html]
// Checks: it faces its direction of travel; a slow or resting ball keeps its last direction; a ball that ping-pongs between two posts never
// snaps (the turn rate is capped and the direction settles instead of flipping every bounce); the plunger lane ball looks up and smiles
// (calm); the chomp runs at 1 Hz when calm and about 2.2 Hz at speed and never faster; it stands still while the game is paused; with
// prefers-reduced-motion the mouth stays half open. Exit code 1 on any failure.
const path = require('path');
const { execFileSync } = require('child_process');
const { openGame } = require('./browser_helper');
const ROOT = path.join(__dirname, '..');
const DEV = (() => { const i = process.argv.indexOf('--dev'); return i < 0 ? 'dist/_dev_r.html' : process.argv[i + 1]; })();
let failures = 0;
const check = (name, ok, detail) => { if (!ok) failures++; console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? '  (' + detail + ')' : '')); };

function inPage(reduced) {
  const out = {};
  const canvas = document.getElementById('game');
  const game = PM.Game.create({ seed: 3, autoplay: false, playLimitSeconds: 0 });
  const render = PM.Render.create(canvas, game);
  game.start();
  let t = 0;
  for (let i = 0; i < 60; i++) { game.update(1 / 60); t += 1 / 60; render.draw(t); }
  const b = game.world.balls[0];
  const step = (n, fn) => { for (let i = 0; i < n; i++) { if (fn) fn(i); t += 1 / 60; render.draw(t); } };
  const info = () => render.ballInfo(b.id);
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const face = (vx, vy, n) => { b.state = 'play'; b.x = 250; b.y = 500; b.vx = vx; b.vy = vy; step(n || 30); return info().dir; };

  out.reduced = !!reduced;
  // 1. faces the direction of travel
  out.right = face(300, 0); out.down = face(0, 300); out.left = face(-300, 0); out.up = face(0, -300);
  // 2. turn rate cap: from up to right, record the biggest change of angle per frame
  face(0, -300); { let prev = info().dir, worst = 0; b.vx = 300; b.vy = 0; step(30, () => { }); }
  { face(0, -300); let prev = info().dir, worst = 0; b.vx = 300; b.vy = 0; for (let i = 0; i < 30; i++) { step(1); const d = info().dir; worst = Math.max(worst, Math.abs(wrap(d - prev))); prev = d; } out.turnWorst = worst; out.turnEnd = info().dir; }
  // 3. a slow ball (50 units/s) keeps its last direction while its velocity swings around
  face(300, 0); { const keep = info().dir; let dev = 0; for (let i = 0; i < 90; i++) { const a = i * 0.3; b.vx = Math.cos(a) * 50; b.vy = Math.sin(a) * 50; step(1); dev = Math.max(dev, Math.abs(wrap(info().dir - keep))); } out.slowDev = dev; }
  // 4. ping-pong: reverse the velocity every 0.12 s for 4 s at 450 units/s; measure the angle path per second and the largest step
  face(450, 0); { let prev = info().dir, path = 0, worst = 0, flips = 0, lastSign = 0; for (let i = 0; i < 240; i++) { if (i % 7 === 0) b.vx = -b.vx; step(1); const d = info().dir, dd = wrap(d - prev); path += Math.abs(dd); worst = Math.max(worst, Math.abs(dd)); const sg = Math.sign(dd); if (sg && lastSign && sg !== lastSign) flips++; if (sg) lastSign = sg; prev = d; } out.pingPath = path / 4; out.pingWorst = worst; out.pingFlips = flips; }
  // 4b. a real reversal (the ball hits a wall and travels back) turns him round within half a second
  face(300, 0); b.vx = -300; step(30); out.reverse = info().dir;
  // 5. lane ball: looks up, calm
  b.state = 'lane'; b.vx = 0; b.vy = 0; step(60); out.laneDir = info().dir; out.laneCalm = info().calm;
  // 6. chomp frequency: count mouth cycles (crossings of the middle value) over 6 s
  const freq = (vx, vy, state) => { b.state = state || 'play'; b.vx = vx; b.vy = vy; step(60); let cross = 0, prev = info().mouth, mid = 0, lo = 9, hi = -9; const vals = []; for (let i = 0; i < 360; i++) { step(1); vals.push(info().mouth); } lo = Math.min.apply(null, vals); hi = Math.max.apply(null, vals); mid = (lo + hi) / 2; for (let i = 1; i < vals.length; i++) if ((vals[i - 1] < mid) !== (vals[i] < mid)) cross++; return { hz: cross / 2 / 6, lo: lo, hi: hi }; };
  out.chompFast = freq(800, 0); out.chompMid = freq(300, 0); out.chompSlow = freq(20, 0); out.chompLane = freq(0, 0, 'lane');
  // 7. paused: the mouth phase does not move
  game.debug.forceScreen('paused'); step(2); { const a = info().phase; step(60); out.pausedMoved = Math.abs(info().phase - a); }
  return out;
}

async function run(reduced) {
  const g = await openGame({ file: DEV, viewport: { width: 1280, height: 720 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await g.page.evaluate(() => PM.Theme.fontsReady);
  const o = await g.page.evaluate(inPage, reduced);
  const errs = g.errors.slice();
  await g.close();
  return { o, errs };
}

(async () => {
  if (!process.argv.includes('--no-build')) execFileSync('python', ['tools/build.py', '--only', '00,05,06,10,20,30,40,50,60,70', '--no-voice', '--out', DEV], { cwd: ROOT, stdio: 'inherit' });
  const near = (a, b, tol) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < tol;
  console.log('== normal motion');
  const { o, errs } = await run(false);
  check('faces right / down / left / up', near(o.right, 0, 0.12) && near(o.down, Math.PI / 2, 0.12) && near(o.left, Math.PI, 0.12) && near(o.up, -Math.PI / 2, 0.12), [o.right, o.down, o.left, o.up].map((v) => v.toFixed(2)).join(' '));
  check('a turn from up to right ends facing right', near(o.turnEnd, 0, 0.12), o.turnEnd.toFixed(2));
  check('turn rate is capped (at most 14 rad/s = 0.24 rad per frame)', o.turnWorst <= 0.245, 'worst ' + o.turnWorst.toFixed(3) + ' rad in one frame');
  check('a slow ball (50 units/s) keeps its last direction', o.slowDev < 0.05, 'moved ' + o.slowDev.toFixed(3) + ' rad');
  check('ping-pong every 0.12 s: no step bigger than the turn cap', o.pingWorst <= 0.245, 'worst step ' + o.pingWorst.toFixed(3) + ' rad');
  check('ping-pong: the face does not spin (under 8 rad of turning per second)', o.pingPath < 8, o.pingPath.toFixed(2) + ' rad/s, ' + o.pingFlips + ' reversals of the turn');
  check('a real reversal turns him round within 0.5 s', near(o.reverse, Math.PI, 0.15), o.reverse.toFixed(2))
  check('the plunger lane ball looks up and is calm', near(o.laneDir, -Math.PI / 2, 0.1) && o.laneCalm > 0.9, o.laneDir.toFixed(2) + ' calm ' + o.laneCalm.toFixed(2));
  check('chomp at speed is at most 2.2 Hz and above 1.8 Hz', o.chompFast.hz <= 2.3 && o.chompFast.hz >= 1.8, o.chompFast.hz.toFixed(2) + ' Hz');
  check('chomp at medium speed is between 1 and 2.2 Hz', o.chompMid.hz >= 1.2 && o.chompMid.hz <= 2.3, o.chompMid.hz.toFixed(2) + ' Hz');
  check('chomp when almost still is about 1 Hz', o.chompSlow.hz >= 0.8 && o.chompSlow.hz <= 1.3, o.chompSlow.hz.toFixed(2) + ' Hz');
  check('chomp in the lane is about 1 Hz and mostly closed (largest opening under 0.45)', o.chompLane.hz >= 0.8 && o.chompLane.hz <= 1.3 && o.chompLane.hi < 0.45, o.chompLane.hz.toFixed(2) + ' Hz, opening ' + o.chompLane.lo.toFixed(2) + ' to ' + o.chompLane.hi.toFixed(2));
  check('at speed the mouth opens wide but never fully closes into a slit', o.chompFast.hi > 0.7 && o.chompFast.lo >= 0.15, o.chompFast.lo.toFixed(2) + ' to ' + o.chompFast.hi.toFixed(2));
  check('the mouth does not move while the game is paused', o.pausedMoved < 0.001, 'phase moved ' + o.pausedMoved.toFixed(4));
  check('no console or page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('== reduced motion');
  const r = await run(true);
  check('mouth stays half open and still', r.o.chompFast.lo === 0.5 && r.o.chompFast.hi === 0.5 && r.o.chompLane.lo === 0.5 && r.o.chompLane.hi === 0.5, 'fast ' + r.o.chompFast.lo + '..' + r.o.chompFast.hi + ', lane ' + r.o.chompLane.lo + '..' + r.o.chompLane.hi);
  check('it still faces its direction of travel', near(r.o.right, 0, 0.12) && near(r.o.up, -Math.PI / 2, 0.12), r.o.right.toFixed(2) + ' ' + r.o.up.toFixed(2));
  check('no console or page errors', r.errs.length === 0, r.errs.slice(0, 2).join(' | '));
  console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL PASS'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
