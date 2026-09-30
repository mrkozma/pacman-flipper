'use strict';
// Round 2 integration flows on the BUILT page (dist/pacman-flipper.html) in headless Edge, real key events, real audio engine.
//   node tests/i2_flow.js ball [--file f]          part A: normal play, the ball is a Pacman (facing, chomp, lane), keys, pause, mute, pictures
//   node tests/i2_flow.js still [--file f]         part A2: pictures on a manual clock (flipper contact, a busy moment, two balls with the bow)
//   node tests/i2_flow.js goodbye [--w 1280 --h 720] [--file f]   part B: ?perc=0.3 with real keys: notice, badge, last ball, goodbye, poke, F5
//   node tests/i2_flow.js off                      ?perc=0 and ?autoplay=1 without perc never show the notice; the default limit is 600 s
//   node tests/i2_flow.js auto3                    ?autoplay=1 for 3 real minutes: no notice, no goodbye
// PM.Audio is wrapped before any game code runs (same recorder as tests/integration_browser.js) so every voice, music and sfx call is logged.
const fs = require('fs');
const path = require('path');
const { openGame, OUT } = require('./browser_helper');

const args = process.argv.slice(2);
const MODE = args[0] || 'ball';
const argVal = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const FILE = argVal('--file', 'dist/pacman-flipper.html');
const W = parseInt(argVal('--w', '1280'), 10), H = parseInt(argVal('--h', '720'), 10);
const AUTO = args.includes('--auto');
const TAG = argVal('--tag', W + 'x' + H) + (AUTO ? 'a' : '');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'voice', 'manifest.json'), 'utf8'));

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail !== undefined && detail !== '' ? '  (' + detail + ')' : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// runs before any page script: emulated autoplay policy plus a recording wrapper around PM.Audio
const RECORDER = () => {
  const AC = window.AudioContext;
  if (AC) {
    class StrictAudioContext extends AC {
      constructor(o) { super(o); try { super.suspend(); } catch (e) { /* ignore */ } }
      resume() {
        if (navigator.userActivation && navigator.userActivation.isActive) return super.resume();
        return new Promise(() => {});
      }
    }
    window.AudioContext = StrictAudioContext;
    window.webkitAudioContext = StrictAudioContext;
  }
  const log = window.__audioLog = [];
  window.__t0 = performance.now();
  let wrapped = null;
  const wrap = (obj) => {
    const w = {};
    Object.keys(obj).forEach((k) => {
      const v = obj[k];
      if (typeof v !== 'function' || k === 'update') { w[k] = v; return; }
      w[k] = function () {
        const a = Array.prototype.slice.call(arguments);
        let ret, err = null;
        try { ret = v.apply(obj, a); } catch (e) { err = String(e && e.stack || e); }
        let rj = ret;
        if (ret && typeof ret.then === 'function') rj = 'promise';
        if (log.length < 30000 && k !== 'sfx') log.push({ fn: k, args: a.map((x) => { try { return JSON.parse(JSON.stringify(x === undefined ? null : x)); } catch (e) { return String(x); } }), ret: rj, err: err, t: (performance.now() - window.__t0) / 1000 });
        if (err) throw new Error(err);
        return ret;
      };
    });
    return w;
  };
  window.PM = window.PM || {};
  Object.defineProperty(window.PM, 'Audio', { configurable: true, enumerable: true, get() { return wrapped; }, set(v) { wrapped = wrap(v); } });
};

async function boot(query, opts) {
  opts = opts || {};
  const g = await openGame({ file: FILE, viewport: { width: opts.w || W, height: opts.h || H }, query: query, deviceScaleFactor: opts.dpr || 1 });
  const page = g.page;
  await page.addInitScript(RECORDER);
  if (opts.init) await page.addInitScript(opts.init);
  await page.reload();
  await page.waitForFunction(() => window.PM_DEBUG, null, { timeout: 20000 });
  await sleep(1200);
  return g;
}

const gs = (page) => page.evaluate(() => {
  const G = window.PM_DEBUG.game, s = G.state, w = G.world, l = s.limit;
  return {
    screen: s.screen, time: s.time, score: s.score, ballNo: s.ballNo, ballsLeft: s.ballsLeft, waiting: s.launch.waiting, banner: s.banner && s.banner.kind, stars: s.stars,
    limit: l ? { enabled: l.enabled, phase: l.phase, t: +l.t.toFixed(2), playSec: +l.playSec.toFixed(1), limitSec: l.limitSec, poke: l.poke } : null,
    balls: w.balls.map((b) => ({ id: b.id, state: b.state, x: Math.round(b.x), y: Math.round(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy) })),
    saver: s.ballSave, surprise: s.surprise && s.surprise.id, power: !!s.power, over: s.overT
  };
});
const log = (page) => page.evaluate(() => window.__audioLog.slice());
async function mashFor(page, ms, until) {
  const t0 = Date.now();
  let n = 0;
  while (Date.now() - t0 < ms) {
    if (until && await page.evaluate(until)) return true;
    const waiting = await page.evaluate(() => { const s = window.PM_DEBUG.game.state; return s.screen === 'play' && s.launch.waiting && !s.limit.phase.match(/goodbye/); });
    if (waiting) { await page.keyboard.down('Space'); await sleep(80); await page.keyboard.up('Space'); await sleep(400); continue; }
    const k = (n++ % 2) ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(k); await sleep(130); await page.keyboard.up(k); await sleep(170);
  }
  return until ? page.evaluate(until) : true;
}
async function shotCss(g, name) {
  const p = path.join(OUT, name + '.png');
  await g.page.screenshot({ path: p, scale: 'css' });
  return p;
}
async function clipAround(g, name, cx, cy, half, scale) {
  const vp = g.page.viewportSize();
  const x = Math.max(0, Math.min(vp.width - 2 * half, cx - half)), y = Math.max(0, Math.min(vp.height - 2 * half, cy - half));
  const p = path.join(OUT, name + '.png');
  await g.page.screenshot({ path: p, clip: { x, y, width: 2 * half, height: 2 * half }, scale: scale || 'device' });
  return p;
}
const screenPos = (page) => page.evaluate(() => {
  const L = window.PM_DEBUG.render.layout, w = window.PM_DEBUG.game.world;
  return w.balls.filter((b) => b.state !== 'drained').map((b) => ({ id: b.id, state: b.state, x: L.table.x + b.x * L.scale, y: L.table.y + b.y * L.scale, r: b.r * L.scale * PM_DEBUG.PM.CFG.BALL_DRAW_SCALE, vx: b.vx, vy: b.vy }));
});

// ------------------------------------------------------------------------------------------------------------------
async function partBall() {
  console.log('== part A: normal play, real keys, ' + W + 'x' + H + ', dpr 2');
  const g = await boot('?seed=5', { dpr: 2 });
  const page = g.page;
  await page.evaluate(() => {         // per frame sampler of the ball and the render's facing info
    window.__samples = [];
    const tick = () => {
      const D = window.PM_DEBUG, G = D.game;
      if (G.state.screen === 'play') for (const b of G.world.balls) { const i = D.render.ballInfo(b.id); if (i) window.__samples.push({ t: performance.now() / 1000, id: b.id, st: b.state, vx: b.vx, vy: b.vy, dir: i.dir, mouth: i.mouth, calm: i.calm }); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.keyboard.down('Space'); await sleep(90); await page.keyboard.up('Space');
  await sleep(1500);
  let s = await gs(page);
  check('Space starts the game, the ball waits in the lane', s.screen === 'play' && s.waiting, s.screen);
  // lane ball: faces up
  const lane = await page.evaluate(() => { const D = window.PM_DEBUG, b = D.game.world.balls.find((x) => x.state === 'lane'); const i = b && D.render.ballInfo(b.id); return i ? { dir: i.dir, calm: i.calm, mouth: i.mouth } : null; });
  check('in the plunger lane the Pacman faces up', !!lane && Math.abs(lane.dir + Math.PI / 2) < 0.15, lane ? 'dir ' + lane.dir.toFixed(2) + ' rad, calm ' + lane.calm : 'no info');
  let sp = await screenPos(page);
  await clipAround(g, 'i2_ball_lane_' + TAG, sp[0].x, sp[0].y, 50);
  await shotCss(g, 'i2_lane_' + TAG);
  await page.keyboard.down('Space'); await sleep(700);
  s = await gs(page);
  check('holding Space charges the plunger', s.balls.length >= 1);
  await page.keyboard.up('Space'); await sleep(300);
  s = await gs(page);
  check('releasing Space launches the ball (no longer waiting, moving up the lane or already in play)', !s.waiting && s.balls.some((b) => b.state === 'play' || Math.hypot(b.vx, b.vy) > 100), JSON.stringify(s.balls));
  // play for a while with mashing
  let shots = 0;
  for (let round = 0; round < 8; round++) {
    await mashFor(page, 3000);
    if (round === 1 || round === 4) {
      const p2 = await screenPos(page);
      const b = p2.find((x) => x.state === 'play');
      if (b) { await shotCss(g, 'i2_play' + (++shots) + '_' + TAG); await clipAround(g, 'i2_ball_play' + shots + '_' + TAG, b.x, b.y, 60); }
    }
  }
  s = await gs(page);
  const smp = await page.evaluate(() => window.__samples.slice());
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const fast = smp.filter((x) => x.st === 'play' && Math.hypot(x.vx, x.vy) > 200);
  const diffs = fast.map((x) => Math.abs(wrap(x.dir - Math.atan2(x.vy, x.vx)))).sort((a, b) => a - b);
  const med = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 9, p75 = diffs.length ? diffs[Math.floor(diffs.length * 0.75)] : 9;
  check('the Pacman faces his direction of travel while moving (median error under 0.35 rad)', fast.length > 100 && med < 0.35, fast.length + ' samples, median ' + med.toFixed(2) + ', p75 ' + p75.toFixed(2));
  // chomp: mouth range and frequency over the whole run (play state)
  const mv = smp.filter((x) => x.st === 'play').map((x) => x.mouth);
  const lo = Math.min.apply(null, mv), hi = Math.max.apply(null, mv);
  check('the mouth opens and closes (range at least 0.4)', hi - lo > 0.4, 'mouth ' + lo.toFixed(2) + ' to ' + hi.toFixed(2));
  // chomp Hz in the fastest 3 s stretch
  const play = smp.filter((x) => x.st === 'play');
  let maxHz = 0, sumHz = 0, nWin = 0;
  for (let i = 0; i + 1 < play.length;) {
    const t0 = play[i].t; let j = i; while (j < play.length && play[j].t - t0 < 3) j++;
    const win = play.slice(i, j); if (win.length > 60 && win[win.length - 1].t - t0 > 2.5) {
      const m = (Math.min.apply(null, win.map((x) => x.mouth)) + Math.max.apply(null, win.map((x) => x.mouth))) / 2; let c = 0;
      for (let k = 1; k < win.length; k++) if ((win[k - 1].mouth < m) !== (win[k].mouth < m)) c++;
      const hz = c / 2 / (win[win.length - 1].t - t0); maxHz = Math.max(maxHz, hz); sumHz += hz; nWin++;
    }
    i = j;
  }
  check('the chomp is gentle: never faster than 2.6 Hz in any 3 s window', nWin > 0 && maxHz <= 2.6, nWin + ' windows, max ' + maxHz.toFixed(2) + ' Hz, mean ' + (sumHz / Math.max(1, nWin)).toFixed(2) + ' Hz');
  // pause and mute still work
  await page.keyboard.press('KeyP'); await sleep(300);
  s = await gs(page);
  check('P pauses', s.screen === 'paused', s.screen);
  await shotCss(g, 'i2_paused_' + TAG);
  await page.keyboard.press('KeyP'); await sleep(300);
  s = await gs(page);
  check('P resumes', s.screen === 'play', s.screen);
  await page.keyboard.press('KeyM'); await sleep(200);
  const mu = await page.evaluate(() => ({ eng: window.PM.Audio.isMuted(), ui: window.PM_DEBUG.game.state.ui.muted }));
  check('M mutes', mu.eng && mu.ui);
  await page.keyboard.press('KeyM'); await sleep(200);
  const mu2 = await page.evaluate(() => window.PM.Audio.isMuted());
  check('M unmutes', mu2 === false);
  const flip = async (k) => { await page.keyboard.down(k); await sleep(250); const f = await page.evaluate(() => window.PM_DEBUG.game.world.flippers.map((x) => ({ id: x.id, up: x.up }))); await page.keyboard.up(k); await sleep(250); return f; };
  const fl = await flip('ArrowLeft'), fr = await flip('ArrowRight');
  check('each arrow key raises its own flipper', fl.find((x) => x.id === 'L').up && !fl.find((x) => x.id === 'R').up && fr.find((x) => x.id === 'R').up && !fr.find((x) => x.id === 'L').up);
  s = await gs(page);
  check('the game is still running (screen play or ball serve)', s.screen === 'play', s.screen + ' ball ' + s.ballNo);
  check('no console or page errors', g.errors.length === 0, g.errors.slice(0, 2).join(' | '));
  await g.close();
}

// ------------------------------------------------------------------------------------------------------------------
async function partStill() {
  console.log('== part A2: pictures on a manual clock (deterministic), ' + W + 'x' + H + ', dpr 2');
  const g = await openGame({ file: FILE, viewport: { width: W, height: H }, deviceScaleFactor: 2, query: '?mute=1&autoplay=1&seed=11&skill=1' });
  const page = g.page;
  await page.addInitScript(() => {
    window.__cbs = []; window.__ts = 0;
    window.requestAnimationFrame = (cb) => { window.__cbs.push(cb); return 1; };
    window.__step = (n) => { for (let i = 0; i < n; i++) { const c = window.__cbs; window.__cbs = []; window.__ts += 1000 / 60; for (const f of c) f(window.__ts); } };
  });
  await page.reload();
  for (let i = 0; i < 100 && !(await page.evaluate(() => !!window.PM_DEBUG)); i++) await sleep(50);
  await sleep(500);
  // find natural flipper contacts (slow ball touching a moving flipper), then a fast ball near the flippers, then a busy moment
  const found = { contact: [], fast: [], busy: [] };
  for (let f = 0; f < 60 * 120 && (found.contact.length < 3 || found.fast.length < 2); f++) {
    const hit = await page.evaluate(() => {
      window.__step(1);
      const G = PM_DEBUG.game;
      for (const b of G.world.balls) {
        if (b.state !== 'play') continue;
        for (const fl of G.world.flippers) {
          const ex = fl.px + Math.cos(fl.angle) * fl.len, ey = fl.py + Math.sin(fl.angle) * fl.len;
          const vx = ex - fl.px, vy = ey - fl.py, L2 = vx * vx + vy * vy;
          let u = ((b.x - fl.px) * vx + (b.y - fl.py) * vy) / L2; u = Math.max(0, Math.min(1, u));
          const d = Math.hypot(b.x - (fl.px + vx * u), b.y - (fl.py + vy * u));
          const gap = d - (fl.r0 + (fl.r1 - fl.r0) * u) - b.r;
          const sp = Math.hypot(b.vx, b.vy);
          if (gap < 2 && Math.abs(fl.angVel || 0) > 1) return { kind: 'moving', id: fl.id, sp: sp };
          if (gap < 1.5 && sp < 200) return { kind: 'rest', id: fl.id, sp: sp };
          if (b.y > 780 && sp > 450) return { kind: 'fast', sp: sp };
        }
      }
      return null;
    });
    if (hit && hit.kind !== 'fast' && found.contact.length < 3 && (found.contact.length === 0 || f - found.contact[found.contact.length - 1].f > 240)) {
      const p = (await screenPos(page)).find((x) => x.state === 'play');
      if (p) { const n = 'i2_flipper_' + hit.kind + '_' + found.contact.length + '_' + TAG; await clipAround(g, n, p.x, p.y, 70); found.contact.push({ f: f, kind: hit.kind, name: n }); }
    } else if (hit && hit.kind === 'fast' && found.fast.length < 2 && (found.fast.length === 0 || f - found.fast[found.fast.length - 1].f > 300)) {
      const p = (await screenPos(page)).find((x) => x.state === 'play');
      if (p) { const n = 'i2_fast_' + found.fast.length + '_' + TAG; await clipAround(g, n, p.x, p.y, 70); found.fast.push({ f: f, name: n }); }
    }
  }
  console.log('  natural captures: ' + JSON.stringify(found));
  check('found natural flipper contact moments', found.contact.length >= 1, found.contact.length + ' captures');
  // busy moment: power, a surprise and two balls together
  await page.evaluate(() => { const D = PM_DEBUG.game.debug; D.givePower(); D.triggerSurprise('balloons'); D.forceMultiball(); window.__step(120); });
  await page.evaluate(() => window.__step(240));
  await shotCss(g, 'i2_busy_' + TAG);
  const st = await gs(page);
  console.log('  busy state: power ' + st.power + ', surprise ' + st.surprise + ', balls ' + st.balls.map((b) => b.state).join(','));
  const ps = await screenPos(page);
  const info = await page.evaluate(() => PM_DEBUG.game.world.balls.map((b) => ({ id: b.id, bow: PM_DEBUG.render.ballInfo(b.id) })));
  console.log('  ball infos: ' + JSON.stringify(info));
  for (let i = 0; i < ps.length; i++) await clipAround(g, 'i2_busy_ball' + i + '_' + TAG, ps[i].x, ps[i].y, 70);
  check('no console or page errors', g.errors.length === 0, g.errors.slice(0, 2).join(' | '));
  await g.close();
}

// ------------------------------------------------------------------------------------------------------------------
async function partGoodbye() {
  console.log('== part B: goodbye flow with ?perc=0.3 (18 s), ' + (AUTO ? 'autoplay bot' : 'real keys') + ', ' + W + 'x' + H);
  const g = await boot(AUTO ? '?autoplay=1&perc=0.3&seed=4' : '?perc=0.3&seed=3');
  const page = g.page;
  const t00 = Date.now();
  let s = await gs(page);
  check('boots with the limit enabled at 18 s', (AUTO || s.screen === 'title') && s.limit.enabled && s.limit.limitSec === 18, JSON.stringify(s.limit) + ' ' + s.screen);
  if (AUTO) { await page.keyboard.press('ArrowLeft'); }        // a real gesture so the audio context may start; the bot does the playing
  else { await page.keyboard.down('Space'); await sleep(90); await page.keyboard.up('Space'); }
  await sleep(1500);
  const seenPhases = [];
  const track = async () => { const x = await gs(page); const last = seenPhases[seenPhases.length - 1]; if (!last || last.p !== x.limit.phase || last.sc !== x.screen) seenPhases.push({ p: x.limit.phase, sc: x.screen, real: ((Date.now() - t00) / 1000).toFixed(1), play: x.limit.playSec, ball: x.ballNo, banner: x.banner }); return x; };
  // play until the notice starts
  if (AUTO) { for (let i = 0; i < 400 && (await gs(page)).limit.phase === 'none'; i++) await sleep(100); }
  else await mashFor(page, 60000, () => window.PM_DEBUG.game.state.limit.phase !== 'none');
  s = await track();
  check('the notice starts after about 18 s of play', s.limit.phase === 'notice' && s.limit.playSec >= 17.9 && s.limit.playSec < 26, JSON.stringify(s.limit));
  const ballNoAtNotice = s.ballNo;
  // three pictures of the notice
  const noticeAt = async (targetT, name) => {
    for (let i = 0; i < 80; i++) { const x = await gs(page); if (x.limit.phase !== 'notice' || x.limit.t >= targetT) break; await sleep(60); }
    const x = await gs(page);
    await shotCss(g, name + '_' + TAG);
    return x.limit;
  };
  const n1 = await noticeAt(0.25, 'i2_notice1'), n2 = await noticeAt(2.0, 'i2_notice2');
  console.log('  notice pictures at t=' + n1.t + ' (' + n1.phase + ') and t=' + n2.t + ' (' + n2.phase + ')');
  if (AUTO) await sleep(1000); else await mashFor(page, 4000, () => window.PM_DEBUG.game.state.limit.phase !== 'notice');
  const n3 = await noticeAt(7.0, 'i2_notice3');
  console.log('  notice picture 3 at t=' + n3.t + ' (' + n3.phase + ')');
  let voice = (await log(page)).filter((e) => e.fn === 'voice').map((e) => ({ c: e.args[0], ret: e.ret, t: e.t }));
  const ln = voice.filter((v) => v.c === 'limit_notice');
  check('the voice call limit_notice was made and accepted (returned true)', ln.length >= 1 && ln[0].ret === true, JSON.stringify(ln));
  // wait for last
  const untilLast = () => window.PM_DEBUG.game.state.limit.phase === 'last' || window.PM_DEBUG.game.state.screen === 'goodbye';
  if (AUTO) { for (let i = 0; i < 300 && !(await page.evaluate(untilLast)); i++) await sleep(100); } else await mashFor(page, 20000, untilLast);
  s = await track();
  if (s.limit.phase === 'last') {
    check('after the notice the phase is last (badge), the ball is still in play', s.screen === 'play', JSON.stringify(s.limit) + ' ' + s.screen);
    await sleep(300);
    await shotCss(g, 'i2_badge_' + TAG);
    await sleep(3000);
    await shotCss(g, 'i2_badge2_' + TAG);
  } else {
    console.log('  note: the last ball drained during the notice, so the goodbye came before the badge (allowed by SPEC 9.2); no badge in this run');
    check('the goodbye followed the notice directly (ball drained during the notice)', s.screen === 'goodbye', s.screen);
    if (AUTO) failures++;         // the bot run is meant to show the badge
  }
  // keep playing a bit, then let the last ball finish; never serve a new one
  if (!AUTO) await mashFor(page, 6000, () => window.PM_DEBUG.game.state.screen === 'goodbye');
  s = await track();
  const extraBallSeen = { max: 0 };
  // let the ball drain by itself: no more keys; watch ballNo and the number of live balls every 200 ms
  const tEnd = Date.now() + 150000;
  while (Date.now() < tEnd) {
    s = await track();
    extraBallSeen.max = Math.max(extraBallSeen.max, s.ballNo);
    if (s.screen === 'goodbye') break;
    // if the child never launches, the game waits: launch with Space, then leave the flippers alone
    if (!AUTO && s.limit.phase === 'last' && s.waiting) { await page.keyboard.down('Space'); await sleep(80); await page.keyboard.up('Space'); }
    // the drain of the last ball can take a while (saver, rescue); mash lightly at half speed to keep it interesting but end soon
    await sleep(250);
  }
  s = await track();
  check('the game ends in the goodbye screen', s.screen === 'goodbye' && s.limit.phase === 'goodbye', JSON.stringify(s.limit) + ' ' + s.screen);
  check('no new ball was served after the notice (ball number never grew)', extraBallSeen.max === ballNoAtNotice, 'ball at notice ' + ballNoAtNotice + ', max seen ' + extraBallSeen.max);
  await sleep(400);
  await shotCss(g, 'i2_goodbye1_' + TAG);
  await sleep(6500);
  voice = (await log(page)).filter((e) => e.fn === 'voice').map((e) => ({ c: e.args[0], ret: e.ret, t: +e.t.toFixed(1) }));
  const lg = voice.filter((v) => v.c === 'limit_goodbye');
  check('the voice call limit_goodbye was made and accepted', lg.length >= 1 && lg[0].ret === true, JSON.stringify(lg));
  const okOrder = ln.length && lg.length && lg[0].t > ln[0].t;
  check('the goodbye line comes after the notice line', !!okOrder);
  await shotCss(g, 'i2_goodbye2_' + TAG);
  // Space does not restart and asks for limit_rest
  const before = await gs(page);
  const restBefore = voice.filter((v) => v.c === 'limit_rest').length;
  await sleep(9000);        // let the goodbye line finish and the rest cooldown pass
  await page.keyboard.down('Space'); await sleep(80); await page.keyboard.up('Space'); await sleep(500);
  let after = await gs(page);
  check('Space on the goodbye does not restart the game', after.screen === 'goodbye' && after.limit.phase === 'goodbye', after.screen);
  check('Space pokes (poke counter grows)', after.limit.poke === before.limit.poke + 1, before.limit.poke + ' -> ' + after.limit.poke);
  voice = (await log(page)).filter((e) => e.fn === 'voice').map((e) => ({ c: e.args[0], ret: e.ret, t: +e.t.toFixed(1) }));
  const rest = voice.filter((v) => v.c === 'limit_rest');
  check('Space calls limit_rest (accepted)', rest.length > restBefore && rest[rest.length - 1].ret === true, JSON.stringify(rest));
  await sleep(200);
  await shotCss(g, 'i2_goodbye_poke_' + TAG);
  // more presses: still goodbye, never a new game
  for (let i = 0; i < 5; i++) { await page.keyboard.down('Space'); await sleep(60); await page.keyboard.up('Space'); await sleep(250); }
  await page.mouse.click(Math.round(W / 2), Math.round(H / 2)); await sleep(300);
  after = await gs(page);
  check('five more Space presses and a click never leave the goodbye', after.screen === 'goodbye' && after.limit.phase === 'goodbye', after.screen);
  const storedHi = await page.evaluate(() => { try { return localStorage.getItem((PM_DEBUG.PM.CFG.LOG_KEY || 'pacmanFlipper.v1')); } catch (e) { return 'blocked'; } });
  console.log('  saved settings: ' + storedHi + ', score ' + after.score);
  const mus = (await log(page)).filter((e) => e.fn === 'setMusic').map((e) => e.args[0]);
  const collapsed = mus.filter((m, i) => i === 0 || m !== mus[i - 1]);
  console.log('  setMusic sequence: ' + collapsed.join(' > '));
  check('music order is menu, play, then gameover (no play after gameover)', collapsed.indexOf('gameover') > collapsed.indexOf('play') && collapsed[collapsed.length - 1] === 'gameover' && collapsed.lastIndexOf('play') < collapsed.indexOf('gameover'), collapsed.join(','));
  const bad = (await log(page)).filter((e) => e.err);
  check('no audio call threw', bad.length === 0, bad.slice(0, 2).map((e) => e.fn + ' ' + e.err).join(' | '));
  console.log('  phases: ' + JSON.stringify(seenPhases));
  console.log('  voice log: ' + voice.filter((v) => /limit|over|last_ball|drain|ballsave/.test(v.c)).map((v) => v.c + '@' + v.t + (v.ret === true ? '' : '(' + v.ret + ')')).join(' '));
  // pause on the goodbye
  await page.keyboard.press('KeyP'); await sleep(300);
  let ps = await gs(page);
  const pausedOn = ps.screen;
  await page.keyboard.press('KeyP'); await sleep(300);
  ps = await gs(page);
  check('pause works on the goodbye and resumes back to it', pausedOn === 'paused' && ps.screen === 'goodbye', pausedOn + ' -> ' + ps.screen);
  // a reload starts a fresh game
  await page.reload();
  await page.waitForFunction(() => window.PM_DEBUG, null, { timeout: 20000 });
  await sleep(800);
  const fresh = await gs(page);
  check('reload (like F5) gives a fresh game on the title with play time 0', fresh.screen === 'title' && fresh.limit.phase === 'none' && fresh.limit.playSec === 0 && fresh.score === 0, JSON.stringify(fresh.limit) + ' ' + fresh.screen);
  check('no console or page errors', g.errors.length === 0, g.errors.slice(0, 3).join(' | '));
  await g.close();
}

// ------------------------------------------------------------------------------------------------------------------
async function partOff() {
  console.log('== off and default limits');
  const cfg = fs.readFileSync(FILE, 'utf8');
  check('the built file has PLAY_LIMIT_SECONDS: 600', /PLAY_LIMIT_SECONDS:\s*600\b/.test(cfg));
  let g = await boot('?seed=3');
  let v = await g.page.evaluate(() => ({ cfg: PM_DEBUG.PM.CFG.PLAY_LIMIT_SECONDS, l: PM_DEBUG.game.state.limit }));
  check('runtime default: PM.CFG.PLAY_LIMIT_SECONDS is 600 and the limit is enabled at 600 s', v.cfg === 600 && v.l.enabled && v.l.limitSec === 600, JSON.stringify(v));
  await g.close();
  g = await boot('?perc=0&seed=3');
  await g.page.keyboard.down('Space'); await sleep(90); await g.page.keyboard.up('Space'); await sleep(1200);
  await g.page.evaluate(() => PM_DEBUG.game.debug.setPlaySeconds(100000));
  await mashFor(g.page, 8000);
  let s = await gs(g.page);
  check('?perc=0: limit disabled, no notice after 100000 s of play time', !s.limit.enabled && s.limit.phase === 'none' && s.screen === 'play', JSON.stringify(s.limit) + ' ' + s.screen);
  await g.close();
  g = await boot('?autoplay=1&seed=3');
  await sleep(2000);
  await g.page.evaluate(() => PM_DEBUG.game.debug.setPlaySeconds(100000));
  await sleep(6000);
  s = await gs(g.page);
  check('?autoplay=1 without perc: limit off even at 100000 s of play time', !s.limit.enabled && s.limit.phase === 'none', JSON.stringify(s.limit) + ' ' + s.screen);
  await g.close();
  g = await boot('?perc=abc&seed=3');
  v = await g.page.evaluate(() => PM_DEBUG.game.state.limit);
  check('?perc=abc is ignored (default 600 s)', v.enabled && v.limitSec === 600, JSON.stringify(v));
  await g.close();
  g = await boot('?perc=0.25&autoplay=1&seed=3');
  await sleep(1500);
  await mashFor(g.page, 45000, () => PM_DEBUG.game.state.limit.phase !== 'none');
  s = await gs(g.page);
  check('?autoplay=1&perc=0.25 does show the notice (15 s limit honoured with autoplay)', s.limit.enabled && s.limit.limitSec === 15 && s.limit.phase !== 'none', JSON.stringify(s.limit));
  await g.close();
  console.log('  errors: ' + failures);
}

async function partAuto3() {
  console.log('== ?autoplay=1 for 3 real minutes without perc');
  const g = await boot('?autoplay=1&seed=9&mute=1');
  const t0 = Date.now();
  let worst = 'none', phases = new Set(), max = 0, screens = new Set();
  while (Date.now() - t0 < 185000) {
    const s = await gs(g.page);
    phases.add(s.limit.phase); screens.add(s.screen); max = Math.max(max, s.time);
    await sleep(1000);
  }
  const s = await gs(g.page);
  check('3 minutes of autoplay: the game really ran (game time reached)', max >= 150, 'state.time ' + max.toFixed(0) + ' s');
  check('3 minutes of autoplay: phases seen ' + Array.from(phases).join(','), phases.size === 1 && phases.has('none'));
  check('3 minutes of autoplay: never a goodbye screen (screens ' + Array.from(screens).join(',') + ')', !screens.has('goodbye'));
  check('no console or page errors', g.errors.length === 0, g.errors.slice(0, 2).join(' | '));
  await g.close();
}

// ------------------------------------------------------------------------------------------------------------------
// static list of every voice category the game code can ask for (same rules as tests/wiring_check.js)
function usedVoiceNames() {
  const FRUITS = ['cherry', 'strawberry', 'orange', 'apple', 'pear', 'grapes'], GH = ['piri', 'rozi', 'kiki'];
  const SURP = ['bigflip', 'slow', 'balloons', 'fruits', 'dance', 'shield', 'extraball'];
  const TEMPLATES = { 'ghost_': GH.concat(['nori']), 'ball_': ['2', '3', '4', '5'], 'fruit_': FRUITS, 'mult_': ['2', '3', '4', '5'], 'combo_': ['3', '5', '10'], 'surprise_': SURP.concat(['end']), 'over_stars_': ['1', '2', '3'], 'balls_left_': ['1', '2', '3', '4'] };
  const names = new Set();
  for (const f of ['src/40_game.js', 'src/90_main.js', 'src/70_render.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    let m;
    const reV = /\bsay\(\s*'([a-z_0-9]+)'\s*[,)]|\bvoice:\s*'([a-z_0-9]+)'(?!\s*\+)|Audio\.voice\(\s*'([a-z_0-9]+)'/g;
    while ((m = reV.exec(src))) names.add(m[1] || m[2] || m[3]);
    const reT = /\b(say|voice:?)\(?\s*'([a-z_]+_)'\s*\+/g;
    while ((m = reT.exec(src))) (TEMPLATES[m[2]] || []).forEach((x) => names.add(m[2] + x));
  }
  return Array.from(names).sort();
}

async function partVoice() {
  console.log('== voice: the built page embeds the manifest and the engine can play the limit lines');
  const g = await boot('?seed=3&perc=0.3');
  const page = g.page;
  const emb = await page.evaluate(() => ({ cats: window.PM_VOICE.manifest.cats, files: Object.keys(window.PM_VOICE.files), sizes: Object.keys(window.PM_VOICE.files).map((k) => window.PM_VOICE.files[k].length) }));
  const diskCats = Object.keys(MANIFEST.cats), embCats = Object.keys(emb.cats);
  check('the embedded manifest has the same categories as assets/voice/manifest.json', diskCats.length === embCats.length && diskCats.every((c) => emb.cats[c] && emb.cats[c].clips.length === MANIFEST.cats[c].clips.length && emb.cats[c].clips.every((k, i) => k.f === MANIFEST.cats[c].clips[i].f)), embCats.length + ' vs ' + diskCats.length);
  const embFiles = new Set(emb.files);
  const missingFiles = [].concat(...embCats.map((c) => emb.cats[c].clips.map((k) => k.f))).filter((f) => !embFiles.has(f));
  check('every clip in the embedded manifest has its mp3 embedded', missingFiles.length === 0, missingFiles.slice(0, 3).join(','));
  check('no embedded mp3 is empty', emb.sizes.every((n) => n > 1000), 'smallest ' + Math.min.apply(null, emb.sizes) + ' chars');
  const used = usedVoiceNames();
  const miss = used.filter((c) => !emb.cats[c] || !emb.cats[c].clips.length);
  check('every voice category the game code calls exists in the embedded manifest', miss.length === 0, used.length + ' names, missing: ' + miss.join(','));
  const lim = ['limit_notice', 'limit_goodbye', 'limit_rest'];
  console.log('  ' + lim.map((c) => c + ': ' + emb.cats[c].clips.map((k) => k.dur.toFixed(1) + ' s').join(' ') + ' prio ' + emb.cats[c].priority).join(' | '));
  // a real gesture unlocks the audio; the voices decode
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction((n) => Object.keys(PM_DEBUG.PM.Audio._debug.voiceCats()).length >= n, diskCats.length, { timeout: 40000 }).catch(() => {});
  await sleep(500);
  const dec = await page.evaluate(() => PM_DEBUG.PM.Audio._debug.voiceCats());
  check('after decode PM.Audio indexes every category (' + Object.keys(dec).length + ')', Object.keys(dec).length === diskCats.length);
  check('the three limit categories are decoded with all their clips', lim.every((c) => dec[c] && dec[c].clips === MANIFEST.cats[c].clips.length), lim.map((c) => c + '=' + (dec[c] && dec[c].clips)).join(' '));
  const st0 = await page.evaluate(() => PM_DEBUG.PM.Audio._debug.state());
  check('the audio context is running after the gesture', st0.state === 'running', st0.state);
  for (const c of lim) {
    await page.waitForFunction(() => !PM_DEBUG.PM.Audio.voiceBusy(), null, { timeout: 15000 }).catch(() => {});
    const t0 = Date.now();
    const r = await page.evaluate((cat) => { const A = PM_DEBUG.PM.Audio; const ok = A.voice(cat, { priority: 3, force: true }); return { ok: ok, cur: A._debug.state().cur, busy: A.voiceBusy(), file: A._debug.lastVoiceFile(cat) }; }, c);
    check('PM.Audio.voice(' + c + ') is accepted and starts playing', r.ok === true && r.cur === c && r.busy === true, JSON.stringify(r));
    await page.waitForFunction(() => !PM_DEBUG.PM.Audio.voiceBusy(), null, { timeout: 15000, polling: 100 }).catch(() => {});
    const el = (Date.now() - t0) / 1000;
    const clip = MANIFEST.cats[c].clips.find((k) => k.f === r.file);
    check('the ' + c + ' clip (' + r.file + ') plays for about its length', !!clip && Math.abs(el - clip.dur) < 1.0, 'played ' + el.toFixed(1) + ' s, clip ' + (clip ? clip.dur : '?') + ' s');
    console.log('    ' + c + ' text: ' + (clip ? clip.text : '?'));
  }
  check('no console or page errors', g.errors.length === 0, g.errors.slice(0, 2).join(' | '));
  await g.close();
}

// touch: the poke on the goodbye screen and the blur rules (phone sized page with touch, ?perc=0.3)
async function partTap() {
  console.log('== touch tap and blur on the goodbye screen (390x844, touch)');
  const g = await openGame({ file: FILE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, query: '?perc=0.3&seed=3' });
  const page = g.page;
  await page.addInitScript(RECORDER);
  await page.reload();
  await page.waitForFunction(() => window.PM_DEBUG, null, { timeout: 20000 });
  await sleep(1200);
  await page.touchscreen.tap(195, 500);       // a tap on the title starts the game and unlocks the audio
  await sleep(1500);
  let s = await gs(page);
  check('a tap starts the game on the phone', s.screen === 'play', s.screen);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(300);
  s = await gs(page);
  check('a window blur pauses during play', s.screen === 'paused', s.screen);
  await page.evaluate(() => PM_DEBUG.game.resume());
  await sleep(300);
  await page.evaluate(() => PM_DEBUG.game.debug.finishLimit());
  await sleep(1500);
  s = await gs(page);
  check('finishLimit shows the goodbye', s.screen === 'goodbye', s.screen);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(300);
  s = await gs(page);
  check('a window blur does not pause the goodbye', s.screen === 'goodbye', s.screen);
  await sleep(6500);       // the goodbye voice starts about 0.6 s in and needs to finish before a rest line may play
  const p0 = s.limit.poke;
  await page.touchscreen.tap(195, 420);
  await sleep(500);
  s = await gs(page);
  check('a tap on the goodbye pokes and does not restart', s.screen === 'goodbye' && s.limit.poke === p0 + 1, 'poke ' + p0 + ' -> ' + s.limit.poke + ' ' + s.screen);
  await page.touchscreen.tap(60, 800);      // where the left flipper button would be in play
  await page.touchscreen.tap(330, 800);
  await sleep(400);
  s = await gs(page);
  check('taps where the play buttons were only poke', s.screen === 'goodbye' && s.limit.poke >= p0 + 2, 'poke ' + s.limit.poke);
  const v = (await log(page)).filter((e) => e.fn === 'voice').map((e) => e.args[0] + '=' + e.ret);
  console.log('  voice calls: ' + v.join(' '));
  await shotCss(g, 'i2_goodbye_tap_390');
  await page.keyboard.press('KeyM'); await sleep(200);
  check('M still mutes on the goodbye', await page.evaluate(() => PM.Audio.isMuted() === true));
  check('no console or page errors', g.errors.length === 0, g.errors.slice(0, 2).join(' | '));
  await g.close();
}

// network: every request the page makes during a session (title, play, notice, goodbye) must be the file itself, data: or blob:
async function partNet() {
  console.log('== network: no request leaves the page');
  const { chromium } = require('playwright-core');
  const { EDGE } = require('./browser_helper');
  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const reqs = [];
  context.on('request', (r) => reqs.push(r.url().slice(0, 60)));
  const page = await context.newPage();
  const socks = [];
  page.on('websocket', (w) => socks.push(w.url()));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const file = 'file:///' + path.resolve(__dirname, '..', FILE).split(path.sep).join('/');
  await page.goto(file + '?autoplay=1&perc=0.25&seed=2');
  await page.waitForFunction(() => window.PM_DEBUG, null, { timeout: 20000 });
  await page.keyboard.press('ArrowLeft');
  await sleep(24000);
  await page.evaluate(() => PM_DEBUG.game.debug.finishLimit());
  await sleep(3000);
  const ph = await page.evaluate(() => PM_DEBUG.game.state.limit.phase);
  const kinds = {};
  reqs.forEach((u) => { const k = u.split(':')[0]; kinds[k] = (kinds[k] || 0) + 1; });
  console.log('  requests by scheme: ' + JSON.stringify(kinds) + ', web sockets ' + socks.length + ', phase reached ' + ph);
  check('the session reached the goodbye', ph === 'goodbye', ph);
  check('every request is file:, data: or blob: (nothing goes to the network)', reqs.every((u) => /^(file|data|blob):/.test(u)), reqs.filter((u) => !/^(file|data|blob):/.test(u)).slice(0, 3).join(' '));
  check('no web socket', socks.length === 0);
  check('no console or page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
}

(async () => {
  if (MODE === 'net') await partNet();
  else if (MODE === 'tap') await partTap();
  else if (MODE === 'voice') await partVoice();
  else if (MODE === 'ball') await partBall();
  else if (MODE === 'still') await partStill();
  else if (MODE === 'goodbye') await partGoodbye();
  else if (MODE === 'off') await partOff();
  else if (MODE === 'auto3') await partAuto3();
  else { console.log('unknown mode ' + MODE); process.exit(2); }
  console.log(failures ? failures + ' FAILURE(S)' : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
