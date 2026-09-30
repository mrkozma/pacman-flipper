'use strict';
// Integration test of the REAL built game (dist/pacman-flipper.html) in headless Edge, with real keyboard events and the
// real audio engine (sound on, browser autoplay policy ON so the first key press really has to unlock the audio).
//
//   node tests/integration_browser.js [--seconds N] [--shot-every S] [--file path]
//
// Part 1 (keyboard): boots, Space starts, the ball launches, each arrow key moves only its own flipper, P pauses and resumes,
//   M mutes, the audio unlock path works and the music mode follows the game state. PM.Audio is wrapped before any game code
//   runs, so every setMusic / sfx / voice call is recorded.
// Part 2 (autoplay): ?autoplay=1 for N real seconds (default 90) with a screenshot every 15 s (tests/out/i_auto_NN.png).
// Both parts require zero console errors and zero page errors.
const fs = require('fs');
const path = require('path');
const { openGame, OUT } = require('./browser_helper');

const args = process.argv.slice(2);
const argVal = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const FILE = argVal('--file', 'dist/pacman-flipper.html');
const AUTO_SECONDS = parseFloat(argVal('--seconds', '90'));
const SHOT_EVERY = parseFloat(argVal('--shot-every', '15'));
// the expected voice counts come from the manifest on disk (they used to be hard coded and broke when categories were added)
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'voice', 'manifest.json'), 'utf8'));
const N_CATS = Object.keys(MANIFEST.cats).length;
const N_FILES = new Set([].concat(...Object.values(MANIFEST.cats).map((c) => c.clips.map((k) => k.f)))).size;

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail !== undefined && detail !== '' ? '  (' + detail + ')' : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs before any page script. (a) Headless Edge ignores --autoplay-policy, so a real browser's rule is emulated: a new
// AudioContext starts suspended and resume() only works while the page has user activation (inside a key or click handler).
// (b) PM.Audio is replaced by a recording wrapper the moment 00_ns.js / 80_audio.js assign it.
const RECORDER = () => {
  window.__blockedResumes = 0;
  const AC = window.AudioContext;
  if (AC) {
    class StrictAudioContext extends AC {
      constructor(o) { super(o); try { super.suspend(); } catch (e) { /* ignore */ } }
      resume() {
        if (navigator.userActivation && navigator.userActivation.isActive) return super.resume();
        window.__blockedResumes++;
        return new Promise(() => {});          // like Chrome: stays pending until a gesture allows the context to start
      }
    }
    window.AudioContext = StrictAudioContext;
    window.webkitAudioContext = StrictAudioContext;
  }
  const log = window.__audioLog = [];
  let real = null, wrapped = null;
  const holder = {};
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
        if (ret && typeof ret.then === 'function') {
          rj = 'promise';
          ret.then(() => log.push({ fn: k + ':resolved', t: performance.now() }), (e) => log.push({ fn: k + ':rejected', err: String(e), t: performance.now() }));
        }
        if (log.length < 20000) log.push({ fn: k, args: a.map((x) => { try { return JSON.parse(JSON.stringify(x === undefined ? null : x)); } catch (e) { return String(x); } }), ret: rj, err: err, t: performance.now() });
        if (err) throw new Error(err);
        return ret;
      };
    });
    return w;
  };
  let installed = false;
  const install = () => {
    if (installed || !window.PM) return;
    installed = true;
    Object.defineProperty(window.PM, 'Audio', {
      configurable: true, enumerable: true,
      get() { return wrapped; },
      set(v) { real = v; wrapped = wrap(v); }
    });
  };
  // PM is created by 00_ns.js (g.PM = g.PM || {}); predefine it so the accessor exists before that file runs
  window.PM = window.PM || {};
  install();
};

async function audioState(page) {
  return page.evaluate(() => {
    const A = window.PM.Audio;
    const s = A._debug.state();
    return { ctxState: s.state, mode: s.mode, pending: s.pending, paused: s.paused, cur: s.cur, queue: s.queue, muted: A.isMuted(), musicOn: A.isMusicOn(),
      voiceCats: Object.keys(A._debug.voiceCats()).length, isNull: !!A.isNull };
  });
}
async function gameState(page) {
  return page.evaluate(() => {
    const G = window.PM_DEBUG.game, s = G.state, w = G.world;
    return {
      screen: s.screen, score: s.score, ballNo: s.ballNo, ballsLeft: s.ballsLeft, power: !!s.power, surprise: s.surprise && s.surprise.id,
      waiting: s.launch.waiting, charge: s.launch.charge, keys: Object.assign({}, s.keys), stars: s.stars, dotsLeft: s.dotsLeft, time: s.time,
      muted: s.ui.muted, level: s.level, banner: s.banner && s.banner.kind,
      balls: w.balls.map((b) => ({ state: b.state, x: Math.round(b.x), y: Math.round(b.y) })),
      flippers: w.flippers.map((f) => ({ id: f.id, angle: f.angle, up: f.up, rest: f.restAngle, upAngle: f.upAngle }))
    };
  });
}
const logOf = (page, fn) => page.evaluate((f) => window.__audioLog.filter((e) => e.fn === f), fn);
const logAll = (page) => page.evaluate(() => window.__audioLog.slice());

// Plays like a child who mashes keys: taps Space when a ball waits in the lane, otherwise flicks a random arrow. Runs until `done()`.
async function mash(page, done, maxMs) {
  const t0 = Date.now();
  let n = 0;
  while (Date.now() - t0 < maxMs) {
    if (await page.evaluate(done)) return true;
    const waiting = await page.evaluate(() => { const s = window.PM_DEBUG.game.state; return s.screen === 'play' && s.launch.waiting; });
    if (waiting) { await page.keyboard.down('Space'); await sleep(80); await page.keyboard.up('Space'); await sleep(400); continue; }
    const k = (n++ % 2) ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(k); await sleep(130); await page.keyboard.up(k); await sleep(170);
  }
  return page.evaluate(done);
}

async function part1() {
  console.log('== part 1: keyboard, audio unlock and music modes (autoplay policy emulated, sound ON)');
  const g = await openGame({
    file: FILE, viewport: { width: 1280, height: 720 }, query: '?seed=11'
  });
  const page = g.page;
  // openGame already navigated; reload with the recorder installed before any script runs
  await page.addInitScript(RECORDER);
  await page.reload();
  await page.waitForFunction(() => window.PM_DEBUG, null, { timeout: 20000 });
  await sleep(1200);

  let gs = await gameState(page);
  let as = await audioState(page);
  check('boots to the title screen', gs.screen === 'title', gs.screen);
  check('the real audio engine is loaded (not the null stand-in)', as.isNull === false);
  const manifestCats = await page.evaluate(() => Object.keys(window.PM_VOICE.manifest.cats).length);
  check('the built page embeds the voice manifest', manifestCats === N_CATS, manifestCats + ' categories');
  const clipFiles = await page.evaluate(() => Object.keys(window.PM_VOICE.files).length);
  check('all voice clips are embedded', clipFiles === N_FILES, clipFiles + ' files');
  const rec0 = await logOf(page, 'setMusic');
  check('the game asks for the menu music on the title screen (setMusic menu)', rec0.length > 0 && rec0[0].args[0] === 'menu', JSON.stringify(rec0.map((r) => r.args[0])));
  console.log('  before any key: audio context ' + as.ctxState + ', music engine mode ' + as.mode + ', voice categories decoded ' + as.voiceCats);
  check('before the first key the (emulated) autoplay policy keeps the audio context suspended', as.ctxState === 'suspended', as.ctxState);

  // voices decode while the title is showing (main asks 400 ms after boot)
  await page.waitForFunction((n) => Object.keys(window.PM.Audio._debug.voiceCats()).length >= n, N_CATS, { timeout: 30000 }).catch(() => {});
  as = await audioState(page);
  check('loadVoices decoded and indexed every manifest category before the first key', as.voiceCats === N_CATS, as.voiceCats + ' of ' + N_CATS);

  // ---- Space starts the game (this is the first user gesture: it must unlock the audio)
  await page.keyboard.down('Space'); await sleep(90); await page.keyboard.up('Space');
  await sleep(900);
  gs = await gameState(page);
  as = await audioState(page);
  check('Space starts the game with the ball waiting in the lane', gs.screen === 'play' && gs.waiting && gs.ballNo === 1, gs.screen);
  check('no flipper moved when only Space was pressed', gs.flippers.every((f) => !f.up));
  const unl = await logAll(page);
  check('PM.Audio.unlock() was called by the first key press and resolved', unl.some((e) => e.fn === 'unlock') && unl.some((e) => e.fn === 'unlock:resolved'));
  check('loadVoices was called and resolved', unl.some((e) => e.fn === 'loadVoices') && unl.some((e) => e.fn === 'loadVoices:resolved'));
  const lv = unl.find((e) => e.fn === 'loadVoices'), lvr = unl.find((e) => e.fn === 'loadVoices:resolved');
  check('decoding the 232 voice clips takes under 6 s (a child may press Space early)', !!(lv && lvr) && lvr.t - lv.t < 6000, lv && lvr ? Math.round(lvr.t - lv.t) + ' ms' : 'no timing');
  check('no audio call threw', unl.every((e) => !e.err), unl.filter((e) => e.err).map((e) => e.fn + ' ' + e.err).slice(0, 2).join(' | '));
  check('the audio context is running after the first key', as.ctxState === 'running', as.ctxState);
  const voices1 = unl.filter((e) => e.fn === 'voice');
  check('welcome and howto were requested', voices1.some((e) => e.args[0] === 'welcome') && voices1.some((e) => e.args[0] === 'howto'), voices1.map((e) => e.args[0] + '=' + e.ret).join(' '));
  check('welcome was accepted by the audio engine (returned true)', voices1.some((e) => e.args[0] === 'welcome' && e.ret === true));
  // the game music: mode follows the state, switched on a bar line (about 2.5 s at 96 BPM)
  await page.waitForFunction(() => window.PM.Audio._debug.state().mode === 'play', null, { timeout: 12000 }).then(() => check('music engine switched to play mode', true)).catch(async () => check('music engine switched to play mode', false, JSON.stringify(await audioState(page))));
  const mus = (await logOf(page, 'setMusic')).map((e) => e.args[0]);
  check('setMusic sequence so far is menu then play', mus.join(',') === 'menu,play', mus.join(','));

  // ---- launch: hold Space, charge, release
  await page.keyboard.down('Space'); await sleep(600);
  gs = await gameState(page);
  check('holding Space charges the plunger', gs.charge > 0.25 && gs.charge < 0.95, 'charge ' + gs.charge.toFixed(2));
  await page.keyboard.up('Space'); await sleep(700);
  gs = await gameState(page);
  check('releasing Space launches the ball', !gs.waiting && gs.balls.length >= 1 && gs.balls.some((b) => b.state === 'play' || b.state === 'lane'), JSON.stringify(gs.balls));
  await sleep(2500);
  gs = await gameState(page);
  check('the ball is in play a few seconds later', gs.balls.some((b) => b.state === 'play') || gs.ballNo > 1, JSON.stringify(gs.balls));
  const sfxNames = new Set((await logOf(page, 'sfx')).map((e) => e.args[0]));
  check('plunger sounds were requested', sfxNames.has('plunger_charge') && sfxNames.has('plunger_release'));

  // ---- flippers: each arrow key moves its own flipper only
  const flip = async (keys) => { for (const k of keys) await page.keyboard.down(k); await sleep(260); const s = await gameState(page); for (const k of keys) await page.keyboard.up(k); await sleep(260); return s; };
  let f = await flip(['ArrowLeft']);
  const L = (s) => s.flippers.find((x) => x.id === 'L'), R = (s) => s.flippers.find((x) => x.id === 'R');
  check('ArrowLeft raises only the left flipper', L(f).up && !R(f).up && Math.abs(L(f).angle - L(f).upAngle) < 0.05 && Math.abs(R(f).angle - R(f).rest) < 0.05, 'L ' + L(f).angle.toFixed(2) + ' R ' + R(f).angle.toFixed(2));
  f = await flip(['ArrowRight']);
  check('ArrowRight raises only the right flipper', R(f).up && !L(f).up && Math.abs(R(f).angle - R(f).upAngle) < 0.05 && Math.abs(L(f).angle - L(f).rest) < 0.05, 'L ' + L(f).angle.toFixed(2) + ' R ' + R(f).angle.toFixed(2));
  f = await flip(['ArrowLeft', 'ArrowRight']);
  check('both arrows raise both flippers', L(f).up && R(f).up);
  gs = await gameState(page);
  check('the flippers come back down when the keys are released', !L(gs).up && !R(gs).up && Math.abs(L(gs).angle - L(gs).rest) < 0.05, 'L ' + L(gs).angle.toFixed(2));
  const flipSfx = (await logOf(page, 'sfx')).filter((e) => e.args[0] === 'flipper_up' || e.args[0] === 'flipper_down').length;
  check('flipper sounds were requested', flipSfx >= 4, flipSfx + ' calls');

  // ---- pause and resume with real keys
  await page.keyboard.press('KeyP'); await sleep(250);
  gs = await gameState(page);
  check('P pauses', gs.screen === 'paused');
  const t0 = gs.score, tm0 = (await page.evaluate(() => window.PM_DEBUG.game.world.balls.map((b) => [b.x, b.y]).join('|')));
  await sleep(900);
  const tm1 = (await page.evaluate(() => window.PM_DEBUG.game.world.balls.map((b) => [b.x, b.y]).join('|')));
  check('the ball does not move while paused', tm0 === tm1);
  as = await audioState(page);
  check('the audio is suspended while paused', as.paused === true && (as.ctxState === 'suspended' || as.ctxState === 'running'), as.ctxState + ' paused=' + as.paused);
  await page.keyboard.press('KeyP'); await sleep(250);
  gs = await gameState(page);
  check('P again resumes', gs.screen === 'play');
  as = await audioState(page);
  check('the audio is running again after resume', as.paused === false && as.ctxState === 'running', as.ctxState);
  const lg = await logAll(page);
  check('pause called suspend and resume called resume on the audio engine', lg.some((e) => e.fn === 'suspend') && lg.some((e) => e.fn === 'resume'));
  await page.keyboard.press('Escape'); await sleep(200);
  check('Esc also pauses', (await gameState(page)).screen === 'paused');
  await page.keyboard.down('Space'); await sleep(60); await page.keyboard.up('Space'); await sleep(200);
  check('Space resumes from pause', (await gameState(page)).screen === 'play');

  // ---- mute
  await page.keyboard.press('KeyM'); await sleep(200);
  as = await audioState(page); gs = await gameState(page);
  check('M mutes (engine and UI state)', as.muted === true && gs.muted === true);
  const sv = await page.evaluate(() => { const A = window.PM.Audio; return A.voice('welcome', { priority: 3, force: true }); });
  check('a muted engine refuses a voice line', sv === false);
  await page.keyboard.press('KeyM'); await sleep(200);
  as = await audioState(page); gs = await gameState(page);
  check('M again unmutes', as.muted === false && gs.muted === false);

  // ---- music modes follow the state: play -> power -> surprise -> gameover
  const modeAfter = async (fn, wanted, label) => {
    await page.evaluate(fn);
    const ok = await page.waitForFunction((w) => window.PM.Audio._debug.state().mode === w, wanted, { timeout: 14000 }).then(() => true).catch(() => false);
    check('music follows the state: ' + label, ok, JSON.stringify(await audioState(page)));
  };
  await page.evaluate(() => window.PM_DEBUG.game.debug.givePower());
  await sleep(300);
  await modeAfter(() => {}, 'power', 'power (blue ghosts) -> power');
  await page.evaluate(() => window.PM_DEBUG.game.debug.triggerSurprise('slow'));
  await modeAfter(() => {}, 'surprise', 'surprise -> surprise');
  await page.evaluate(() => window.PM_DEBUG.game.debug.setBallSave(60));           // keep the ball alive while the effects run out
  const ended = await mash(page, () => { const s = window.PM_DEBUG.game.state; return !s.surprise && !s.power; }, 60000);
  check('power and surprise run out by themselves', ended, JSON.stringify(await gameState(page)));
  await modeAfter(() => {}, 'play', 'back to play when both ended');
  await page.evaluate(() => { const D = window.PM_DEBUG.game.debug; D.setBallsLeft(0); D.setBallSave(0); D.drain(); });
  await page.waitForFunction(() => window.PM_DEBUG.game.state.screen === 'over', null, { timeout: 20000 }).then(() => check('draining the last ball ends the game', true)).catch(async () => check('draining the last ball ends the game', false, JSON.stringify(await gameState(page))));
  await modeAfter(() => {}, 'gameover', 'game over -> gameover');
  await sleep(2800);
  gs = await gameState(page);
  check('the game over screen gives at least one star', gs.stars >= 1, gs.stars + ' stars');
  const said = (await logOf(page, 'voice')).map((e) => e.args[0]);
  check('the game over voice lines were requested', said.includes('over') && said.some((c) => /^over_stars_/.test(c)), said.slice(-6).join(','));
  // the lullaby stops by itself (about 10 s plus the ring out); the next game must still get its music back
  await page.waitForFunction(() => window.PM.Audio._debug.state().mode === 'off', null, { timeout: 25000 })
    .then(() => check('the game over lullaby ends by itself and the music engine goes quiet', true))
    .catch(async () => check('the game over lullaby ends by itself and the music engine goes quiet', false, JSON.stringify(await audioState(page))));
  await page.keyboard.down('Space'); await sleep(60); await page.keyboard.up('Space'); await sleep(500);
  gs = await gameState(page);
  check('Space after the game over screen starts a new game', gs.screen === 'play' && gs.ballNo === 1, gs.screen);
  await page.waitForFunction(() => window.PM.Audio._debug.state().mode === 'play', null, { timeout: 8000 })
    .then(() => check('the music comes back for the new game (play mode)', true))
    .catch(async () => check('the music comes back for the new game (play mode)', false, JSON.stringify(await audioState(page))));

  // ---- everything the game asked from the audio engine was valid
  const all = await logAll(page);
  const sfxCalls = all.filter((e) => e.fn === 'sfx');
  const known = await page.evaluate(() => window.PM.Audio._debug.sfxNames);
  const unknown = [...new Set(sfxCalls.map((e) => e.args[0]).filter((n) => known.indexOf(n) < 0))];
  check('every sfx name the running game used exists in the audio engine', unknown.length === 0, unknown.join(','));
  const cats = await page.evaluate(() => Object.keys(window.PM.Audio._debug.voiceCats()));
  const voiceCalls = all.filter((e) => e.fn === 'voice');
  const badVoice = [...new Set(voiceCalls.map((e) => e.args[0]).filter((c) => cats.indexOf(c) < 0))];
  check('every voice category the running game used is indexed by the audio engine', badVoice.length === 0, badVoice.join(','));
  const accepted = voiceCalls.filter((e) => e.ret === true).length;
  console.log('  audio calls recorded: ' + sfxCalls.length + ' sfx (' + new Set(sfxCalls.map((e) => e.args[0])).size + ' names), ' + voiceCalls.length + ' voice requests (' + accepted + ' accepted)');
  console.log('  music sequence: ' + all.filter((e) => e.fn === 'setMusic').map((e) => e.args[0]).join(' > '));
  await g.shot('i_part1_end');
  check('part 1: zero console errors and zero page errors', g.errors.length === 0, g.errors.slice(0, 3).join(' | '));
  await g.close();
}

async function part2() {
  console.log('== part 2: autoplay for ' + AUTO_SECONDS + ' s of real time, screenshot every ' + SHOT_EVERY + ' s');
  const g = await openGame({ file: FILE, viewport: { width: 1280, height: 720 }, query: '?autoplay=1&seed=21&skill=0.8' });
  await g.page.addInitScript(RECORDER);
  await g.page.reload();
  await g.page.waitForFunction(() => window.PM_DEBUG, null, { timeout: 20000 });
  const t0 = Date.now();
  let shot = 0, maxParticles = 0, worst = 0, minFps = 999;
  const samples = [];
  let nextShot = 0;
  while ((Date.now() - t0) / 1000 < AUTO_SECONDS) {
    const el = (Date.now() - t0) / 1000;
    if (el >= nextShot) {
      const name = 'i_auto_' + String(shot).padStart(2, '0');
      await g.shot(name);
      const gs = await gameState(g.page);
      samples.push({ el: Math.round(el), screen: gs.screen, score: gs.score, ballNo: gs.ballNo, power: gs.power, surprise: gs.surprise, banner: gs.banner });
      shot++; nextShot += SHOT_EVERY;
    }
    const rs = await g.page.evaluate(() => window.PM_DEBUG.render.stats);
    maxParticles = Math.max(maxParticles, rs.particles || 0); worst = Math.max(worst, rs.ms || 0); if (rs.fps) minFps = Math.min(minFps, rs.fps);
    await sleep(1000);
  }
  const gs = await gameState(g.page);
  const all = await logAll(g.page);
  console.log('  samples: ' + samples.map((s) => s.el + 's ' + s.screen + ' ball' + s.ballNo + ' ' + s.score + (s.power ? ' P' : '') + (s.surprise ? ' S:' + s.surprise : '')).join(' | '));
  check('autoplay reached a score', gs.score > 500, 'score ' + gs.score);
  check('autoplay is playing (screen play or over, never stuck on title)', gs.screen === 'play' || gs.screen === 'over', gs.screen);
  check('the score never went backwards between samples', samples.every((s, i) => i === 0 || s.score >= samples[i - 1].score || s.ballNo < samples[i - 1].ballNo || s.screen === 'title'));
  check('render particles stay within the budget of 60', maxParticles <= 60, 'max ' + maxParticles);
  check('the render stays fast (worst reported frame under 12 ms)', worst < 12, 'worst ' + worst.toFixed(1) + ' ms, lowest fps ' + minFps.toFixed(0));
  const mus = all.filter((e) => e.fn === 'setMusic').map((e) => e.args[0]);
  check('autoplay also unlocks audio (bot mode) and music modes were requested', mus.length >= 2, mus.join(' > '));
  const st = await g.page.evaluate(() => window.PM.Audio._debug.state());
  check('the music scheduler is running during autoplay', st.timer && st.mode !== 'off', JSON.stringify({ mode: st.mode, state: st.state, timer: st.timer }));
  check('no audio call threw during autoplay', all.every((e) => !e.err));
  check('part 2: zero console errors and zero page errors', g.errors.length === 0, g.errors.slice(0, 3).join(' | '));
  await g.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await part1();
  if (AUTO_SECONDS > 0) await part2();
  console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL PASS'));
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
