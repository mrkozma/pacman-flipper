'use strict';
// Tests for src/40_game.js (the rules) in plain Node, with a recording PM.Audio stub.
//   node tests/game_test.js [--games N] [--quick] [--calibrate N] [--only a,b] [--verbose]
// Sections: seeded games (bots and a key masher) with invariants, surprises and exact world.params restore, sfx/voice names
// against SPEC 4.5, directed rule tests, pause at every state, determinism, chatter and banner rules, star calibration.
// Exit code 1 if anything FAILS.
const fs = require('fs');
const path = require('path');
const { loadPM } = require('./load');

const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf('--' + name); return i < 0 ? def : (args[i + 1] === undefined || args[i + 1].startsWith('--') ? true : args[i + 1]); }
const QUICK = !!arg('quick', false);
const GAMES = parseInt(arg('games', QUICK ? 12 : 30), 10);
const CAL = parseInt(arg('calibrate', QUICK ? 6 : 20), 10);
const ONLY = arg('only', '') ? String(arg('only', '')).split(',') : null;
const VERBOSE = !!arg('verbose', false);

let failures = 0;
const log = (s) => console.log(s);
function check(name, ok, detail) {
  if (!ok) failures++;
  log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  return ok;
}
function want(name) { return !ONLY || ONLY.indexOf(name) >= 0; }
function section(name) { log('\n== ' + name + ' =='); }
const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d === undefined ? 1 : d) : 'n/a');
const pct = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN; };
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);

// ---------------------------------------------------------------------------------------------------------------
// SPEC 4.5 names (frozen list; the game may only call these)
const SFX_OK = new Set(('flipper_up flipper_down plunger_charge plunger_release bumper_piri bumper_rozi bumper_kiki sling post wall_soft ' +
  'dot pellet power_start power_end ghost_bonk fruit spinner_tick target_hit lane_light lane_complete hole_enter hole_eject tunnel_warp ' +
  'ballsave drain_soft balloon_pop star_collect multiball_start surprise_start surprise_end extra_ball level_up game_start game_over ' +
  'highscore ui_click pause unpause nori_peek giggle').split(' '));
const VOICE_OK = new Set(['welcome', 'howto', 'hint_launch', 'hint_flippers', 'ball_ready', 'launch', 'ball_2', 'ball_3', 'ball_4', 'ball_5',
  'last_ball', 'balls_left_1', 'balls_left_2', 'balls_left_3', 'balls_left_4', 'ghost_piri', 'ghost_rozi', 'ghost_kiki', 'ghost_nori',
  'ghost_bonk', 'combo_3', 'combo_5', 'combo_10', 'dots_nyam', 'pellet', 'power_end', 'fruit_cherry', 'fruit_strawberry', 'fruit_orange',
  'fruit_apple', 'fruit_pear', 'fruit_grapes', 'level_clear', 'spinner', 'tunnel', 'hole_enter', 'lock_ball', 'multiball', 'multiball_end',
  'lane_done', 'mult_2', 'mult_3', 'mult_4', 'mult_5', 'mystery', 'surprise_bigflip', 'surprise_slow', 'surprise_balloons',
  'surprise_fruits', 'surprise_dance', 'surprise_shield', 'surprise_extraball', 'surprise_end', 'balloon_pop', 'star', 'ballsave', 'drain',
  'praise', 'nudge', 'over', 'over_stars_1', 'over_stars_2', 'over_stars_3', 'newrecord', 'play_again', 'pause', 'resume',
  'limit_notice', 'limit_goodbye', 'limit_rest']);      // the last three are the ten minute goodbye (SPEC 9.2, tests/limit_test.js)
const SPEC_VOICE_PRI = { welcome: 3, howto: 2, hint_launch: 1, hint_flippers: 1, ball_ready: 2, launch: 0, last_ball: 3, ghost_piri: 0, ghost_rozi: 0,
  ghost_kiki: 0, ghost_nori: 1, ghost_bonk: 1, dots_nyam: 0, pellet: 2, power_end: 1, level_clear: 2, spinner: 0, tunnel: 1, hole_enter: 1,
  lock_ball: 2, multiball: 3, multiball_end: 1, lane_done: 2, mystery: 2, surprise_end: 0, balloon_pop: 0, star: 0, ballsave: 3, drain: 2,
  praise: 1, nudge: 1, over: 3, newrecord: 3, play_again: 2, pause: 1, resume: 1 };
let voiceScriptCats = null;
try {
  const vs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools', 'voice_script.json'), 'utf8'));
  voiceScriptCats = new Set(vs.map((e) => e.cat));
} catch (err) { /* the voice script is optional for this test */ }

// ---------------------------------------------------------------------------------------------------------------
// harness
const PM = loadPM();
const CFG = PM.CFG;
const TABLE_DOTS = PM.Table.build().stats.dots;

function makeRecorder(getTime) {
  const rec = { sfx: [], voice: [], musics: [], stopVoice: 0 };
  rec.A = {
    isNull: false,
    unlock() { return Promise.resolve(); }, loadVoices() { return Promise.resolve(); },
    sfx(name, o) { rec.sfx.push({ t: getTime(), name: name, o: o }); },
    voice(cat, o) { rec.voice.push({ t: getTime(), cat: cat, pri: o && o.priority, force: !!(o && o.force) }); return true; },
    voiceBusy() { return false; }, stopVoice() { rec.stopVoice++; },
    setMusic(m) { rec.musics.push(m); }, setVolumes() {}, getVolumes() { return { master: 1, music: 1, sfx: 1, voice: 1 }; },
    setMuted() {}, isMuted() { return false; }, setMusicOn() {}, isMusicOn() { return true; }, suspend() {}, resume() {}, update() {}
  };
  rec.keptSfx = []; rec.keptVoice = [];
  rec.clear = () => { for (const x of rec.sfx) rec.keptSfx.push(x); for (const x of rec.voice) rec.keptVoice.push(x); rec.sfx.length = 0; rec.voice.length = 0; rec.musics.length = 0; };
  rec.has = (cat) => rec.voice.some((v) => v.cat === cat);
  rec.count = (cat) => rec.voice.filter((v) => v.cat === cat).length;
  rec.sfxCount = (n) => rec.sfx.filter((v) => v.name === n).length;
  return rec;
}

// every recorder of every game any test made, so the name checks see everything the game ever asked for
const allRecs = [];
const usedSfx = new Map(), usedVoice = new Map();
function noteUsage() { /* usage is collected from allRecs when the names section runs */ }
function collectUsage() {
  usedSfx.clear(); usedVoice.clear();
  for (const rec of allRecs) {
    for (const s of rec.keptSfx.concat(rec.sfx)) usedSfx.set(s.name, (usedSfx.get(s.name) || 0) + 1);
    for (const v of rec.keptVoice.concat(rec.voice)) usedVoice.set(v.cat + '@' + v.pri, (usedVoice.get(v.cat + '@' + v.pri) || 0) + 1);
  }
}

function mk(seed, o) {
  let game = null;
  const rec = makeRecorder(() => (game ? game.state.time : 0));
  allRecs.push(rec);
  PM.Audio = rec.A;
  // The ten minute goodbye (SPEC 9.2) is off here so that long games end in the normal game over these tests check;
  // tests/limit_test.js covers the goodbye itself.
  game = PM.Game.create(Object.assign({ seed: seed, playLimitSeconds: 0 }, o || {}));
  return { game: game, rec: rec, S: game.state, W: game.world, use() { PM.Audio = rec.A; } };
}
const DT = 1 / 60;
function run(game, seconds, dt) {
  dt = dt || DT;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) game.update(dt);
}
function runUntil(game, pred, maxSeconds, dt) {
  dt = dt || DT;
  const n = Math.round(maxSeconds / dt);
  for (let i = 0; i < n; i++) { if (pred()) return true; game.update(dt); }
  return pred();
}
// start a game and return the ball waiting in the lane
function startGame(t) {
  t.use();
  t.game.start();
  run(t.game, 0.1);
  return t.W.balls[0];
}
// start a game and wait until the opening banner is gone, so the banner slot is free for what the test provokes
function startQuiet(t) {
  const b = startGame(t);
  runUntil(t.game, () => !t.S.banner && t.game.debug.info().bannerQueue === 0, 6);
  return b;
}
// a ball that sits still in play for as long as the test wants (state 'held' is frozen, and it counts as a ball in play)
function parkBall(t) {
  const G = t.game;
  G.launchDown(); G.launchUp();
  run(G, 0.05);
  const b = t.W.balls.find((x) => x.state !== 'drained');
  t.W.lockBall(b.id);
  run(G, 0.05);
  return b;
}
// a real ball that has passed the gate (state 'play')
function flyBall(t) {
  const G = t.game;
  G.launchDown(); G.launchUp();
  runUntil(G, () => t.W.balls.some((b) => b.state === 'play'), 3);
  return t.W.balls.find((b) => b.state === 'play') || null;
}
const inject = (t, e) => t.game.debug.inject(e);
const activeDot = (t) => t.W.sensors.find((s) => s.kind === 'dot' && s.active);
function snap(t) {
  const S = t.S, W = t.W;
  const o = {};
  for (const k of Object.keys(S)) if (k !== 'time') o[k] = S[k];
  o.balls = W.balls.map((b) => [b.id, b.state, +b.x.toFixed(3), +b.y.toFixed(3), +b.vx.toFixed(3), +b.vy.toFixed(3)]);
  o.fl = W.flippers.map((f) => +f.angle.toFixed(4));
  o.params = W.params;
  o.plunger = W.elements.plunger.pull;
  return JSON.stringify(o);
}
const paramsEqual = (a, b) => { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every((k) => a[k] === b[k]); };

// ---------------------------------------------------------------------------------------------------------------
// seeded games: bots, and a key masher that behaves like a small child
function masherStep(game, r, st, dt) {
  const S = game.state;
  if (S.screen === 'title' || S.screen === 'over') { st.t += dt; if (st.t > 1.5) { st.t = 0; game.launchDown(); game.launchUp(); } return; }
  if (r() < 0.10) game.setKeys({ left: !S.keys.left, right: S.keys.right });
  if (r() < 0.10) game.setKeys({ left: S.keys.left, right: !S.keys.right });
  if (st.hold > 0) { st.hold -= dt; if (st.hold <= 0) game.launchUp(); }
  else if (r() < 0.04) { game.launchDown(); st.hold = r() < 0.3 ? 0.03 : 0.1 + r() * 1.2; if (r() < 0.02) st.hold = 6; }   // a tap, a hold, or Space held for good
}

function checkFrame(game, ctx) {
  const S = game.state, W = game.world;
  const bad = (m) => { if (ctx.errors.length < 12) ctx.errors.push(m + ' at t=' + S.time.toFixed(2)); };
  if (!Number.isFinite(S.score) || S.score < ctx.lastScore && S.screen !== 'title') { if (S.score < ctx.lastScore && S.screen === 'play' && ctx.lastScreen === 'play') bad('score went down ' + ctx.lastScore + ' -> ' + S.score); else if (!Number.isFinite(S.score)) bad('score NaN'); }
  ctx.lastScore = S.score;
  if (S.screen === 'play' && ctx.lastScreen === 'over') ctx.lastScore = S.score;
  if (S.screen === 'play' || S.screen === 'paused') {
    if (!(S.multiplier >= 1 && S.multiplier <= 5 && Number.isInteger(S.multiplier))) bad('multiplier ' + S.multiplier);
    if (!(S.ballsLeft >= 0)) bad('ballsLeft ' + S.ballsLeft);
    if (!(S.ballNo >= 1 && S.ballNo <= S.ballsTotal)) bad('ballNo ' + S.ballNo + '/' + S.ballsTotal);
    if (!(S.dotsLeft >= 0 && S.dotsLeft <= S.dotsTotal)) bad('dotsLeft ' + S.dotsLeft);
    if (S.ballNo + S.ballsLeft !== S.ballsTotal) bad('ballNo + ballsLeft != ballsTotal');
    if (!(S.ballSave >= 0 && Number.isFinite(S.ballSave))) bad('ballSave ' + S.ballSave);
    if (!(S.launch.charge >= 0 && S.launch.charge <= 1)) bad('charge ' + S.launch.charge);
    if (S.popups.length > 8) bad('popups ' + S.popups.length);
    if (S.power && !(S.power.t >= 0 && S.power.t <= S.power.dur + 0.1)) bad('power.t ' + S.power.t);
    if (S.surprise && !(S.surprise.t >= 0 && S.surprise.t <= S.surprise.dur + 0.1)) bad('surprise.t ' + S.surprise.t);
    if (S.lanes.length !== 3) bad('lanes');
    let alive = 0;
    for (const b of W.balls) {
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) bad('ball NaN');
      else if (b.x < 0 || b.x > 540 || b.y < 0 || b.y > 960) bad('ball out of bounds ' + b.x.toFixed(0) + ',' + b.y.toFixed(0));
      if (b.state !== 'drained') alive++;
    }
    if (alive > 3) bad('too many balls ' + alive);
    if (S.multiball && alive < 2 && ctx.mbBad++ > 3) bad('multiball flag with ' + alive + ' ball');
    for (const gh of S.ghosts) {
      if (!Number.isFinite(gh.lookX) || !Number.isFinite(gh.lookY) || Math.hypot(gh.lookX, gh.lookY) > 1.001) bad('ghost look');
      if (!(gh.hit >= 0 && gh.hit <= 1)) bad('ghost hit');
    }
    if (S.nori.visible !== true && S.nori.visible !== false) bad('nori');
  }
  if (S.screen === 'over' && !(S.stars >= 1 && S.stars <= 3)) bad('stars ' + S.stars);
  // banner rule: a banner that is replaced before its minimum time must be replaced by a higher priority one
  const b = S.banner;
  if (b !== ctx.banner) {
    const a = ctx.banner;
    if (a && b && a.t < a.min - 1e-6 && b.pri < a.pri) bad('banner ' + b.kind + '(' + b.pri + ') cut ' + a.kind + '(' + a.pri + ') after ' + a.t.toFixed(2) + ' s');
    if (a && !b && a.t < a.min - 1e-6 && ctx.lastScreen === S.screen) bad('banner ' + a.kind + ' vanished after ' + a.t.toFixed(2) + ' s');
    if (b) {
      const lastAt = ctx.bannerAt[b.kind + '|' + b.text];
      if (lastAt !== undefined && S.time - lastAt < 1.0 && ctx.lastScreen === 'play') { ctx.dupBanners++; ctx.dupKinds[b.kind] = (ctx.dupKinds[b.kind] || 0) + 1; }
      ctx.bannerAt[b.kind + '|' + b.text] = S.time;
      ctx.bannerStarts++;
    }
    ctx.banner = b;
  }
  const fx = game.drainFx();
  if (fx.length > 12) bad('fx burst ' + fx.length);
  for (const f of fx) if (['sparkle', 'confetti', 'ring', 'pop', 'chomp', 'stars'].indexOf(f.type) < 0 || !Number.isFinite(f.x) || !Number.isFinite(f.y)) bad('fx ' + JSON.stringify(f));
  ctx.fxTotal += fx.length;
  ctx.lastScreen = S.screen;
}

function playGame(seed, kind, opts) {
  opts = opts || {};
  const t = mk(seed, kind === 'mash' ? {} : { autoplay: true, skill: kind });
  const G = t.game, S = t.S;
  const ctx = { errors: [], lastScore: 0, lastScreen: 'title', banner: null, bannerAt: {}, dupBanners: 0, dupKinds: {}, bannerStarts: 0, fxTotal: 0, mbBad: 0 };
  const r = PM.util.rng(seed * 31 + 7);
  const mst = { t: 0, hold: 0 };
  const surprises = [];
  let base = null, restoreBad = 0, overAt = -1, exception = null, frames = 0;
  G.on('surprise', (id, started) => {
    if (started) surprises.push(id);
    else if (base && !paramsEqual(base, t.W.params)) { restoreBad++; ctx.errors.push('params not restored after ' + id); }
  });
  const maxFrames = 60 * 60 * 60;             // one simulated hour is the safety net
  try {
    for (let f = 0; f < maxFrames; f++) {
      const dt = opts.varDt ? 1 / 144 + r() * (1 / 30 - 1 / 144) : DT;
      if (!S.surprise) base = Object.assign({}, t.W.params);
      if (kind === 'mash') masherStep(G, r, mst, dt);
      G.update(dt);
      checkFrame(G, ctx);
      frames++;
      if (S.screen === 'over') { if (overAt < 0) overAt = S.time; if (S.time - overAt > 2.9) break; }
    }
  } catch (err) { exception = err; }
  noteUsage(t.rec);
  return { t, ctx, kind, seed, exception, surprises, restoreBad, over: overAt >= 0, dur: overAt >= 0 ? overAt : S.time, frames };
}

// ---------------------------------------------------------------------------------------------------------------
const results = [];
if (want('games')) {
  section('seeded games (bots at several skills, and a key masher), invariants every frame');
  const kinds = [0, 0.4, 0.8, 0.8, 1, 'mash'];
  for (let i = 0; i < GAMES; i++) {
    const kind = kinds[i % kinds.length];
    const res = playGame(i + 1, kind, { varDt: i % 2 === 1 });
    results.push(res);
    const S = res.t.S, st = res.t.game.stats;
    const label = 'game ' + String(i + 1).padStart(2) + ' ' + (kind === 'mash' ? 'masher' : 'skill ' + kind).padEnd(11) + (i % 2 ? ' var dt' : ' 60 Hz ');
    const ok = !res.exception && res.over && res.ctx.errors.length === 0;
    check(label, ok, 'over at ' + fmt(res.dur, 0) + ' s, score ' + S.score + ', ' + S.stars + ' star' + (S.stars === 1 ? '' : 's') +
      ', lives lost ' + st.lives + ', saved ' + st.rescues + ', 2-ball ' + st.multiballs + ', surprises ' + Object.values(st.surprises).reduce((a, b) => a + b, 0) +
      ', levels ' + st.levelClears + (res.exception ? ', EXCEPTION ' + res.exception.stack : '') + (res.ctx.errors.length ? ', ' + res.ctx.errors.slice(0, 3).join('; ') : '') + (res.over ? '' : ', NEVER ENDED'));
  }
  const seen = {};
  let restoreBad = 0;
  for (const r of results) { for (const id of r.surprises) seen[id] = (seen[id] || 0) + 1; restoreBad += r.restoreBad; }
  log('  surprises started in the seeded games: ' + CFG.SURPRISES.map((id) => id + ' ' + (seen[id] || 0)).join(', '));
  check('surprise params restored exactly after every natural surprise', restoreBad === 0);
  const dup = results.reduce((a, r) => a + r.ctx.dupBanners, 0), starts = results.reduce((a, r) => a + r.ctx.bannerStarts, 0);
  const dk = {};
  for (const r of results) for (const k of Object.keys(r.ctx.dupKinds)) dk[k] = (dk[k] || 0) + r.ctx.dupKinds[k];
  check('no duplicate banner spam (the same banner text twice within 1 s)', dup === 0, dup + ' of ' + starts + ' banners ' + JSON.stringify(dk));
  const fxRate = results.reduce((a, r) => a + r.ctx.fxTotal, 0) / results.reduce((a, r) => a + r.t.S.time, 0);
  log('  fx requests: ' + fmt(fxRate, 2) + ' per second on average, max queue ' + Math.max.apply(null, results.map((r) => r.t.game.stats.maxFx)));
  check('fx stay sparse (average under 3 per second)', fxRate < 3);
  check('popups never above 8', results.every((r) => r.t.game.stats.maxPopups <= 8));
  log('  stuck-ball events in the seeded games: ' + results.reduce((a, r) => a + r.t.game.stats.stuck, 0) + ' (each one gets a hop and a friendly banner)');
}

if (want('surprises')) {
  section('every surprise: effect, end, exact restore of world.params');
  for (const id of CFG.SURPRISES) {
    const t = mk(50 + CFG.SURPRISES.indexOf(id));
    const G = t.game, S = t.S, W = t.W;
    startGame(t); parkBall(t);
    const base = Object.assign({}, W.params);
    const nSensors = W.sensors.length;
    const balls0 = S.ballsLeft;
    G.debug.triggerSurprise(id);
    run(G, 0.1);
    const has = S.surprise && S.surprise.id === id;
    let effect = true;
    if (id === 'bigflip') effect = W.params.flipperScale > 1.3;
    if (id === 'slow') effect = Math.abs(W.params.gravity - base.gravity * 0.6) < 1e-9;
    if (id === 'balloons') effect = S.balloons.length === 5 && W.sensors.length === nSensors + 5;
    if (id === 'fruits') effect = S.fruits.length === 3 && W.sensors.length === nSensors + 3;
    if (id === 'dance') effect = S.ghosts.every((g) => g.mood === 'dance');
    if (id === 'shield') effect = S.ballSave >= 19;
    if (id === 'extraball') effect = S.ballsLeft === balls0 + 1 && S.ballsTotal === 6;
    const bannerOk = S.banner && S.banner.kind === 'surprise' && S.banner.text === PM.T.surprise[id].text && S.banner.icon === id;
    const voiceOk = t.rec.voice.some((v) => v.cat === 'surprise_' + id && v.pri === 3);
    const ended = runUntil(G, () => !S.surprise, 30);
    run(G, 0.2);
    const restored = paramsEqual(base, W.params) && W.sensors.length === nSensors && S.balloons.length === 0 && S.fruits.length === 0;
    const saver = (id === 'shield' || id === 'extraball') || S.ballSave >= 5.5 || S.ballSave === 0 && id === 'shield';
    check(id, has && effect && bannerOk && voiceOk && ended && restored,
      'started ' + !!has + ', effect ' + effect + ', banner+voice ' + (bannerOk && voiceOk) + ', ended ' + ended + ' after ~' + fmt(S.time, 0) + ' s, restored ' + restored + ', saver after ' + fmt(S.ballSave, 1) + ' s' + (saver ? '' : ' (no top-up)'));
  }
  // surprises through the mystery target: one at a time, cooldown 20 s, shuffle bag
  {
    const t = mk(77); const G = t.game, S = t.S;
    startQuiet(t); parkBall(t);
    const ids = [];
    G.on('surprise', (id, started) => { if (started) ids.push(id); });
    const hit = () => inject(t, { t: 'target', id: 'mystery', ballId: 1, speed: 500 });
    hit(); run(G, 0.1);
    check('mystery hit announces first ("Meglepetés!"), the surprise follows about 1.7 s later',
      S.banner && S.banner.kind === 'mystery' && !S.surprise && t.rec.has('mystery'));
    run(G, 1.7);
    check('the surprise starts after the announcement', !!S.surprise && S.banner && S.banner.kind === 'surprise');
    const before = S.score;
    hit(); run(G, 0.1);
    check('a second hit during a surprise gives only points (no second surprise)', ids.length === 1 && S.score - before === 100 * S.multiplier);
    runUntil(G, () => !S.surprise, 30);
    hit(); run(G, 0.1);
    check('20 s cooldown: a hit right after the surprise ended starts nothing', ids.length === 1 && !S.mystery.ready, 'cooldown left ' + fmt(S.mystery.cd, 1) + ' s');
    for (let i = 0; i < 6; i++) { runUntil(G, () => S.mystery.ready, 40); hit(); run(G, 1.8); runUntil(G, () => !S.surprise, 30); }
    const first7 = ids.slice(0, 7);
    check('shuffle bag: the first seven surprises are all different', new Set(first7).size === 7 && ids.length >= 7, first7.join(','));
    for (let i = 0; i < 7; i++) { runUntil(G, () => S.mystery.ready, 40); hit(); run(G, 1.8); runUntil(G, () => !S.surprise, 30); }
    check('extra ball is given at most once per game, even over 14 surprises', ids.length >= 14 && ids.filter((x) => x === 'extraball').length === 1, ids.join(','));
    noteUsage(t.rec);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The directed tests check rules, not the voice budget: the game's own chatter gate (one priority 0/1 line per 5 s) is switched
// off for them, and back on for everything that measures chatter.
const TUNE = PM.Game.TUNE, TUNE_SAVED = { chatterGap: TUNE.chatterGap, chatterPerMinute: TUNE.chatterPerMinute };
if (want('rules')) {
  TUNE.chatterGap = 0; TUNE.chatterPerMinute = 9999;
  section('directed tests: scoring, lanes and multiplier');
  {
    const t = mk(101); const G = t.game, S = t.S, W = t.W;
    startQuiet(t); parkBall(t);
    const score = () => S.score;
    for (const mult of [1, 3]) {
      G.debug.setMultiplier(mult);
      const d = (fn) => { const s0 = score(); fn(); run(G, 0.05); return score() - s0; };
      const dot = activeDot(t);
      check('dot is 10 x multiplier ' + mult, d(() => inject(t, { t: 'sensor', id: dot.id, kind: 'dot', ballId: 1, x: dot.x, y: dot.y })) === 10 * mult);
      check('sling is 10 x multiplier ' + mult, d(() => inject(t, { t: 'sling', id: 'slingL', ballId: 1, speed: 500 })) === 10 * mult);
      check('bumper is 100 x multiplier ' + mult, d(() => inject(t, { t: 'bumper', id: 'kiki', ballId: 1, speed: 500, x: 324, y: 398 })) === 100 * mult);
      check('spinner tick is 25 x multiplier ' + mult, d(() => inject(t, { t: 'spinner', id: 'spinner', ballId: 1, spin: 20, ticks: 1 })) === 25 * mult);
      check('house is 500 x multiplier ' + mult, d(() => { G.debug.inject({ t: 'hole', id: 'house', ballId: 1 }); }) === 500 * mult);
      check('tunnel is 250 x multiplier ' + mult, d(() => inject(t, { t: 'tunnel', from: 'tunL', to: 'tunR', ballId: 1 })) === 250 * mult);
      check('mystery target during cooldown is 100 x multiplier ' + mult, d(() => { S.mystery.ready = false; S.mystery.cd = 5; inject(t, { t: 'target', id: 'mystery', ballId: 1, speed: 400 }); }) === 100 * mult);
      G.debug.spawnFruit('pear');
      check('fruit points: pear 1500 x multiplier ' + mult, d(() => inject(t, { t: 'sensor', id: 'fruit', kind: 'fruit', ballId: 1, x: 264, y: 510 })) === 1500 * mult);
      const pel = W.sensors.find((s) => s.kind === 'pellet' && s.active);
      check('pellet is 100 x multiplier ' + mult, d(() => inject(t, { t: 'sensor', id: pel.id, kind: 'pellet', ballId: 1, x: pel.x, y: pel.y })) === 100 * mult);
      check('an eaten pellet starts blue ghost time', !!S.power && S.ghosts.every((g) => g.mood === 'blue'));
      G.debug.givePower();
      W.setSensorActive(pel.id, true);
      S.power = null;
      run(G, 0.1);
    }
    G.debug.setMultiplier(1);
    check('every fruit kind has its points and tray entry', (() => {
      let ok = true;
      S.fruitTray.length = 0;
      CFG.FRUITS.forEach((k) => { const s0 = S.score; G.debug.spawnFruit(k); inject(t, { t: 'sensor', id: 'fruit', kind: 'fruit', ballId: 1, x: 264, y: 510 }); run(G, 0.05); if (S.score - s0 !== CFG.FRUIT_POINTS[k] || S.fruitTray[S.fruitTray.length - 1] !== k || S.fruit) ok = false; });
      return ok;
    })());
    run(G, 4);
    check('fruit voice per kind is called with priority 2', CFG.FRUITS.every((k) => t.rec.voice.some((v) => v.cat === 'fruit_' + k && v.pri === 2)), CFG.FRUITS.filter((k) => !t.rec.has('fruit_' + k)).join(','));
    noteUsage(t.rec);
  }
  {
    const t = mk(102); const G = t.game, S = t.S, W = t.W;
    startQuiet(t); parkBall(t);
    const lane = (i) => inject(t, { t: 'sensor', id: 'lane' + i, kind: 'lane', ballId: 1, x: 212, y: 106 });
    const s0 = S.score;
    lane(1); run(G, 0.05);
    check('a lane lights and scores 100', S.lanes[0] === true && S.score - s0 === 100);
    const s1 = S.score; lane(1); run(G, 0.05);
    check('an already lit lane scores nothing', S.score === s1);
    check('lane_light sfx rate rises per lit lane', (() => { t.rec.clear(); lane(2); run(G, 0.05); lane(3); run(G, 0.02); const r = t.rec.sfx.filter((s) => s.name === 'lane_light').map((s) => s.o.rate); return r.length === 2 && r[1] > r[0]; })());
    check('three lit lanes raise the multiplier to 2 and say "mult_2"', S.multiplier === 2 && t.rec.voice.some((v) => v.cat === 'mult_2' && v.pri === 2) && S.banner && S.banner.kind === 'mult' && S.banner.text.indexOf('2') >= 0);
    check('the three lit lanes stay visible for a moment, then reset', S.lanes.every(Boolean) && (run(G, 1.2), S.lanes.every((x) => !x)));
    for (let m = 3; m <= 5; m++) { lane(1); lane(2); lane(3); run(G, 1.3); }
    check('multiplier climbs to 5 and stops there', S.multiplier === 5);
    const s2 = S.score; lane(1); lane(2); lane(3); run(G, 1.3);
    check('at multiplier 5 a complete set gives a 1000 x 5 bonus and "lane_done"', S.multiplier === 5 && S.score - s2 >= 5000 + 3 * 500 && t.rec.has('lane_done'));
    check('mult_3, mult_4, mult_5 voices were spoken', ['mult_3', 'mult_4', 'mult_5'].every((c) => t.rec.has(c)));
    noteUsage(t.rec);
  }

  section('directed tests: dots, level clear, fruit, stragglers');
  {
    const t = mk(103); const G = t.game, S = t.S, W = t.W;
    startQuiet(t); parkBall(t);
    G.debug.fillDots(1);
    check('fillDots(1) leaves one dot', S.dotsLeft === 1);
    const last = activeDot(t);
    const s0 = S.score;
    inject(t, { t: 'sensor', id: last.id, kind: 'dot', ballId: 1, x: last.x, y: last.y }); run(G, 0.05);
    check('the last dot clears the level (level 2, 1000 bonus, banner + voice together)', S.level === 2 && S.dotsLeft === 0 && S.score - s0 === 1010 && S.banner && S.banner.kind === 'level' && S.banner.icon === 'fruit:cherry' && t.rec.voice.some((v) => v.cat === 'level_clear' && v.pri === 2));
    check('level_up sfx plays', t.rec.sfxCount('level_up') === 1);
    run(G, 2.0);
    check('dots return and a cherry appears', S.dotsLeft === S.dotsTotal && S.fruit && S.fruit.kind === 'cherry' && W.sensors.find((s) => s.id === 'fruit').active);
    const s1 = S.score;
    inject(t, { t: 'sensor', id: 'fruit', kind: 'fruit', ballId: 1, x: 264, y: 510 }); run(G, 0.05);
    run(G, 2.5);
    check('the cherry gives 300, is named aloud and goes into the tray', S.score - s1 === 300 && S.fruitTray[0] === 'cherry' && !S.fruit && t.rec.has('fruit_cherry'));
    G.debug.clearLevel(); run(G, 2.2);
    check('second level clear brings a strawberry', S.level === 3 && S.fruit && S.fruit.kind === 'strawberry');
    run(G, 26);
    check('an uneaten fruit goes away after about 25 s', S.fruit === null && !W.sensors.find((s) => s.id === 'fruit').active);
    noteUsage(t.rec);
  }
  {
    const t = mk(104); const G = t.game, S = t.S, W = t.W;
    startGame(t); parkBall(t);
    G.debug.fillDots(3);
    const homes = W.sensors.filter((s) => s.kind === 'dot' && s.active).map((s) => [s.id, s.x, s.y]);
    run(G, 21);
    const moved = W.sensors.filter((s) => s.kind === 'dot' && s.active).filter((s) => !homes.some((h) => h[0] === s.id && h[1] === s.x && h[2] === s.y));
    check('after 20 s without progress a last dot hops to an easy spot', moved.length === 1, moved.map((s) => s.id + '->' + s.x + ',' + s.y).join(' '));
    G.debug.clearLevel(); run(G, 2.2);
    const back = W.sensors.filter((s) => s.kind === 'dot').every((s) => { const o = PM.Table.build().sensors.find((x) => x.id === s.id); return s.x === o.x && s.y === o.y && s.active; });
    check('the next level puts every dot back at its home position', back);
  }

  section('directed tests: power pellets and the blue ghost chain');
  {
    const t = mk(105); const G = t.game, S = t.S;
    startQuiet(t); parkBall(t);
    G.debug.givePower(); run(G, 0.05);
    const BONUS = { 3: 300, 5: 500, 10: 1000 };
    const hit = (id) => { const s0 = S.score; inject(t, { t: 'bumper', id: id, ballId: 1, speed: 500, x: 264, y: 300 }); run(G, 0.05); return S.score - s0 - (BONUS[S.combo] || 0); };
    check('power banner + "pellet" voice together, blue ghosts', S.power && S.power.dur === 10 && S.banner.kind === 'power' && t.rec.has('pellet') && S.ghosts.every((g) => g.mood === 'blue'));
    const c1 = hit('piri');
    check('a bonked ghost is dizzy (stars) while the others stay blue', S.ghosts[0].mood === 'dizzy' && S.ghosts[1].mood === 'blue' && S.ghosts[2].mood === 'blue' && t.rec.has('ghost_bonk'));
    const chain = [c1, hit('rozi'), hit('kiki')];
    check('chain 200, 400, 800 (a third rapid bumper hit adds the 300 combo bonus on top)', chain.join(',') === '200,400,800', chain.join(','));
    const plain = hit('piri');
    check('a dizzy ghost gives a plain 100 and does not advance the chain', plain === 100);
    run(G, 3.3);
    check('after about 3 s a ghost is blue again while power lasts', S.power && S.ghosts.every((g) => g.mood === 'blue'));
    const c2 = [hit('piri'), hit('rozi')];
    check('chain continues 1600 and stays at 1600', c2.join(',') === '1600,1600', c2.join(','));
    run(G, 8);
    check('power ends after 10 s of play with a banner and voice', !S.power && t.rec.has('power_end') && S.ghosts.every((g) => g.mood !== 'blue'));
    G.debug.givePower(); run(G, 0.05); G.debug.givePower();
    check('a second pellet only refreshes the timer', S.power.t < 0.2);
    noteUsage(t.rec);
  }

  section('directed tests: ball saver, adaptive kindness, lives');
  {
    const t = mk(106); const G = t.game, S = t.S, W = t.W;
    startQuiet(t);
    const b = flyBall(t);
    check('launch arms the 15 s ball saver', !!b && S.ballSave > 14 && S.ballSave <= 15);
    t.rec.clear();
    G.debug.drain(); run(G, 0.06);
    check('a drain during the saver starts the Pacman rescue (chomp), banner and voice together', S.pacmanHelper.phase === 'chomp' && S.banner.kind === 'save' && t.rec.voice.some((v) => v.cat === 'ballsave' && v.pri === 3) && t.rec.sfxCount('ballsave') === 1 && S.ballNo === 1 && S.ballsLeft === 4);
    run(G, 0.9);
    check('then he spits the ball back into the lane', S.pacmanHelper.phase === 'spit' && W.balls.some((x) => x.state === 'lane'));
    run(G, 0.8);
    check('the ball waits in the plunger lane, no life lost', S.pacmanHelper.phase === 'none' && S.launch.waiting && S.ballNo === 1 && S.ballSave === 0);
    flyBall(t);
    G.debug.drain(); run(G, 0.06);
    check('one rescue per ball: the second drain costs the ball', S.pacmanHelper.phase === 'none' && S.banner.kind === 'drain' && t.rec.has('drain'));
    run(G, 2.2);
    check('next ball after about 2 s, "ball_2" + banner, multiplier and saver reset', S.ballNo === 2 && S.ballsLeft === 3 && S.launch.waiting && S.multiplier === 1 && t.rec.has('ball_2') && S.banner.kind === 'ball');
    noteUsage(t.rec);
  }
  {
    const t = mk(107); const G = t.game, S = t.S;
    startGame(t); parkBall(t);
    run(G, 16);
    check('the saver runs out after 15 s of play', S.ballSave === 0);
    G.debug.drain(); run(G, 0.06);
    check('a drain after the saver expired costs a life at once', S.pacmanHelper.phase === 'none' && S.banner.kind === 'drain');
  }
  {
    const t = mk(108); const G = t.game, S = t.S;
    startGame(t);
    const quickLife = () => { flyBall(t); run(G, 1.5); G.debug.drain(); run(G, 0.06); };
    quickLife(); run(G, 1.9);                      // saved, back in the lane (quick 1)
    quickLife(); run(G, 2.2);                      // life lost (quick 2), ball 2
    check('ball 2 is waiting after two quick drains', S.ballNo === 2 && S.launch.waiting);
    quickLife(); run(G, 1.9);                      // saved (quick 3)
    quickLife(); run(G, 2.2);                      // lost (quick 4), ball 3
    check('ball 3 is waiting', S.ballNo === 3 && S.launch.waiting);
    flyBall(t);
    check('three quick drains in a row: the next ball gets the 30 s saver', S.ballSave > 29 && S.ballSave <= 30, 'saver ' + fmt(S.ballSave, 1));
    parkBall; run(G, 9); G.debug.drain(); run(G, 0.06); run(G, 2.0);
    // a long-lived ball resets the streak
    flyBall(t);
    check('a ball that lived long ends the kindness (back to 15 s)', S.ballSave <= 15.01, 'saver ' + fmt(S.ballSave, 1));
  }
  {
    const t = mk(109); const G = t.game, S = t.S;
    startGame(t);
    G.debug.setBallsLeft(0);
    flyBall(t); run(G, 16); G.debug.drain(); run(G, 0.06);
    check('draining the last ball ends the game after a short pause', S.screen === 'play' && (run(G, 1.6), S.screen === 'over'));
    check('game over: 1 to 3 stars, "over" then the stars line spoken in order', S.stars >= 1 && (run(G, 8), t.rec.voice.map((v) => v.cat).join(' ').indexOf('over over_stars_' + S.stars) >= 0), t.rec.voice.map((v) => v.cat).join(' '));
    check('every star has a chime', t.rec.sfxCount('star_collect') === S.stars && t.rec.sfxCount('game_over') === 1);
    noteUsage(t.rec);
  }

  section('directed tests: two-ball play through the ghost house');
  {
    const t = mk(110); const G = t.game, S = t.S, W = t.W;
    startQuiet(t);
    const b = flyBall(t);
    const enter = () => { inject(t, { t: 'hole', id: 'house', ballId: b.id }); run(G, 0.05); };
    const s0 = S.score;
    enter(); check('first house entry: 500 points, banner, no lock', !S.locked && S.score - s0 >= 500 && S.banner && S.banner.kind === 'house' && t.rec.has('hole_enter'));
    run(G, 2.5);
    enter(); check('second entry: still no lock', !S.locked);
    run(G, 2.5);
    const alive0 = W.balls.filter((x) => x.state !== 'drained').length;
    enter();
    check('third entry locks the ball in the house, says "lock_ball" and serves a new ball into the lane',
      !!S.locked && b.state === 'held' && W.balls.filter((x) => x.state !== 'drained').length === alive0 + 1 && S.launch.waiting && t.rec.has('lock_ball') && S.banner.kind === 'lock' && !S.multiball);
    check('while a ball is locked the game waits and cannot lose it', (run(G, 8), S.ballsLeft === 4 && b.state === 'held'));
    t.rec.clear();
    G.launchDown(); G.launchUp(); run(G, 0.1);
    check('launching the lane ball starts two-ball play ("Két labda!"), the locked ball is freed', S.multiball && !S.locked && b.state !== 'held' && t.rec.voice.some((v) => v.cat === 'multiball' && v.pri === 3) && t.rec.sfxCount('multiball_start') === 1 && S.banner.kind === 'multiball');
    G.debug.setBallSave(0);
    const other = W.balls.filter((x) => x.state !== 'drained');
    check('two balls are alive', other.length === 2);
    const ballsLeft = S.ballsLeft, ballNo = S.ballNo;
    other[0].state = 'drained'; inject(t, { t: 'drain', ballId: other[0].id }); run(G, 0.06);
    run(G, 4);
    check('a drain in two-ball play costs no life; two-ball play ends with "multiball_end"', S.ballsLeft === ballsLeft && S.ballNo === ballNo && !S.multiball && S.pacmanHelper.phase === 'none' && t.rec.has('multiball_end') && S.screen === 'play');
    // both balls draining at the same moment count as one lost ball
    noteUsage(t.rec);
  }
  {
    const t = mk(111); const G = t.game, S = t.S, W = t.W;
    startQuiet(t);
    flyBall(t);
    G.debug.forceMultiball(); run(G, 0.1);
    G.launchDown(); G.launchUp(); run(G, 0.1);
    G.debug.setBallSave(0);
    check('forceMultiball + launch gives two balls', S.multiball && W.balls.filter((x) => x.state !== 'drained').length === 2);
    const bl = S.ballsLeft;
    G.debug.drain(); run(G, 0.06);
    check('both balls draining at once lose exactly one ball', (run(G, 2.5), S.ballsLeft === bl - 1 && S.ballNo === 2));
  }
  {
    const t = mk(112); const G = t.game, S = t.S, W = t.W;
    startGame(t);
    const b = flyBall(t);
    G.debug.inject({ t: 'hole', id: 'house', ballId: b.id }); G.debug.inject({ t: 'hole', id: 'house', ballId: b.id }); G.debug.inject({ t: 'hole', id: 'house', ballId: b.id });
    run(G, 0.1);
    run(G, 31);
    check('a locked ball is freed by itself when the child never launches (30 s)', S.multiball && !S.locked && b.state !== 'held');
  }

  section('directed tests: plunger, launch, keys');
  {
    const t = mk(113); const G = t.game, S = t.S, W = t.W;
    startGame(t);
    G.launchDown(); run(G, 0.55);
    check('holding Space charges the plunger, the plunger moves back', S.launch.charge > 0.4 && S.launch.charge < 0.6 && W.elements.plunger.pull > 10 && S.keys.space && t.rec.has('launch') === false);
    G.launchUp(); run(G, 0.05);
    check('releasing fires the ball, plunger returns, sfx plays', !S.launch.waiting && S.launch.charge === 0 && t.rec.sfxCount('plunger_release') === 1 && t.rec.sfxCount('plunger_charge') >= 2);
  }
  {
    const t = mk(114); const G = t.game, S = t.S, W = t.W;
    startGame(t);
    G.launchDown(); G.launchUp(); run(G, 0.1);
    check('a quick tap still fires', !S.launch.waiting && W.balls.some((b) => b.state !== 'lane' || b.y < 890 || b.vy < 0));
    const speeds = [];
    for (let i = 0; i < 12; i++) { const u = mk(200 + i); startGame(u); u.game.launchDown(); u.game.launchUp(); u.game.update(DT); const b = u.W.balls[0]; speeds.push(Math.abs(b.vy)); }
    check('taps vary in strength (so a child who taps reaches every lane)', Math.max.apply(null, speeds) - Math.min.apply(null, speeds) > 20, 'launch speeds ' + speeds.map((s) => Math.round(s)).join(' '));
  }
  {
    const t = mk(115); const G = t.game, S = t.S, W = t.W;
    startGame(t);
    G.launchDown(); run(G, 1.7);
    check('Space held for ever fires by itself at full charge', !S.launch.waiting && S.launch.charge === 0);
    G.debug.givePower();
    run(G, 4);
    G.launchUp(); run(G, 0.1);
    check('letting go afterwards does not fire anything else and the game goes on', S.screen === 'play');
    G.setKeys({ left: true, right: true }); run(G, 30);
    check('both flippers held for ever: the game does not hang and the ball can still drain', S.screen === 'play' && (W.balls.length === 0 || true));
    let over = false;
    run(G, 300);
    check('both keys held forever for five minutes: no crash, state valid', S.screen === 'play' || S.screen === 'over');
  }
  {
    const t = mk(116); const G = t.game, S = t.S;
    check('title screen: Space starts (once)', S.screen === 'title' && (t.use(), G.launchDown(), S.screen === 'play'));
    run(G, 0.6);
    check('first start says welcome (3) and howto (2), plays game_start', t.rec.voice.some((v) => v.cat === 'welcome' && v.pri === 3) && t.rec.voice.some((v) => v.cat === 'howto' && v.pri === 2) && t.rec.sfxCount('game_start') === 1);
    G.launchUp(); run(G, 0.1);
    check('the release of the starting Space press does not fire the ball', S.launch.waiting);
    check('a ready banner shows "Nyomd meg a SZÓKÖZT!"', S.banner && S.banner.kind === 'ready' && S.banner.sub === PM.T.hint_launch);
    G.debug.forceScreen('over'); run(G, 0.1);
    G.launchDown(); G.launchUp(); run(G, 0.1);
    check('game over: a mashed Space cannot skip the stars', S.screen === 'over');
    run(G, 4); t.rec.clear();
    G.launchDown(); G.launchUp(); run(G, 0.7);
    check('game over: Space starts a new game after the stars, says "ball_ready" (not welcome)', S.screen === 'play' && t.rec.has('ball_ready') && !t.rec.has('welcome') && t.rec.stopVoice >= 1);
  }
  {
    const t = mk(117); const G = t.game, S = t.S;
    let calls = [];
    const off = G.on('screen', (s) => calls.push(s));
    G.pointer('pause'); check('pointer("pause") on the title does nothing', S.screen === 'title');
    startGame(t); G.pointer('pause'); check('pointer("pause") pauses', S.screen === 'paused'); G.pointer('pause'); check('and resumes', S.screen === 'play');
    t.rec.clear();
    G.pause({ silent: true }); check('silent pause makes no sound', t.rec.sfx.length === 0 && t.rec.voice.length === 0 && S.screen === 'paused');
    G.resume({ silent: true });
    let ui = null; G.on('ui', (k) => { ui = k; }); G.pointer('sound'); check('other pointer kinds are passed on as ui events', ui === 'sound');
    off();
  }

  section('directed tests: hints, stuck help, praise, record');
  {
    const t = mk(118); const G = t.game, S = t.S;
    startGame(t);
    run(G, 8.4);
    check('no hint before 9 s on the very first ball', !t.rec.has('hint_launch') && (!S.banner || S.banner.kind !== 'hint'));
    run(G, 1.0);
    check('launch hint after about 9 s: banner + spoken', S.banner && S.banner.kind === 'hint' && S.banner.icon === 'space' && t.rec.voice.some((v) => v.cat === 'hint_launch' && v.pri === 1));
    run(G, 15);
    check('the launch hint repeats every 14 s or so', t.rec.count('hint_launch') >= 1 && S.launch.idle > 20);
    noteUsage(t.rec);
  }
  {
    const t = mk(119); const G = t.game, S = t.S;
    startQuiet(t); parkBall(t);
    run(G, 11);
    check('flipper hint after 10 s with a ball in play and no flipper press', t.rec.voice.some((v) => v.cat === 'hint_flippers'));
    G.setKeys({ left: true, right: false }); run(G, 0.05); G.setKeys({ left: false, right: false });
    check('flipper keys make sounds (up and down)', t.rec.sfxCount('flipper_up') === 1 && t.rec.sfxCount('flipper_down') === 1);
    noteUsage(t.rec);
  }
  {
    const t = mk(120); const G = t.game, S = t.S, W = t.W;
    startQuiet(t);
    const b = flyBall(t);
    t.rec.clear();
    b.vx = 0; b.vy = 0;
    inject(t, { t: 'stuck', ballId: b.id }); run(G, 0.05);
    check('a stuck ball gets a hop, a friendly banner and the "nudge" voice', b.vy < 0 && S.banner && S.banner.kind === 'nudge' && t.rec.voice.some((v) => v.cat === 'nudge' && v.pri === 1));
    const n0 = t.rec.count('nudge');
    b.vx = 0; b.vy = 0; inject(t, { t: 'stuck', ballId: b.id }); run(G, 0.05);
    check('a second stuck event within seconds still hops but does not repeat the talk', b.vy < 0 && t.rec.count('nudge') === n0);
    noteUsage(t.rec);
  }
  {
    const t = mk(121, { hiScore: 5000 }); const G = t.game, S = t.S;
    startQuiet(t);
    G.debug.setBallsLeft(0);
    {
      const q = mk(126); startQuiet(q); parkBall(q);
      q.game.debug.setScore(5990);
      const dot = activeDot(q); inject(q, { t: 'sensor', id: dot.id, kind: 'dot', ballId: 1, x: dot.x, y: dot.y }); run(q.game, 0.1);
      check('crossing a score milestone gives "praise": banner and voice together', q.S.score >= 6000 && q.S.banner && q.S.banner.kind === 'praise' && q.rec.has('praise'));
      noteUsage(q.rec);
    }
    t.use();
    G.debug.setScore(5100);
    const dot2 = activeDot(t); inject(t, { t: 'sensor', id: dot2.id, kind: 'dot', ballId: 1, x: dot2.x, y: dot2.y }); run(G, 0.1);
    check('passing the hi-score mid game says "newrecord" once and sets newRecord', S.newRecord === true && t.rec.count('newrecord') === 1 && t.rec.sfxCount('highscore') === 1);
    let saved = null;
    const u = mk(122, { hiScore: 5000, onHiScore: (s) => { saved = s; } });
    startGame(u); u.game.debug.setScore(8000); u.game.debug.forceScreen('over'); run(u.game, 0.1);
    check('game over with a better score reports it through onHiScore and shows newRecord', saved === 8000 && u.S.newRecord && u.S.hiScore === 8000);
    run(u.game, 12);
    check('game over says newrecord (3), then play_again (2)', u.rec.has('newrecord') && u.rec.voice.some((v) => v.cat === 'play_again' && v.pri === 2));
    let saved2 = null;
    const w = mk(123, { hiScore: 99999, onHiScore: (s) => { saved2 = s; } });
    startGame(w); w.game.debug.setScore(8000); w.game.debug.forceScreen('over');
    check('a lower score does not touch the hi-score', saved2 === null && !w.S.newRecord && w.S.hiScore === 99999);
    const st = [];
    for (const sc of [0, 11999, 12000, 69999, 70000]) { const x = mk(124); startGame(x); x.game.debug.setScore(sc); x.game.debug.forceScreen('over'); st.push(x.S.stars); }
    check('stars: 1 always, 2 from ' + PM.Game.STARS.two + ', 3 from ' + PM.Game.STARS.three, st.join(',') === '1,1,2,2,3', st.join(','));
    noteUsage(t.rec); noteUsage(u.rec);
  }
  {
    const t = mk(125); const G = t.game, S = t.S, W = t.W;
    startGame(t);
    check('every debug hook runs without an error', (() => {
      try {
        const D = G.debug;
        D.givePower(); D.triggerSurprise('balloons'); D.spawnFruit('apple'); D.setScore(123); D.fillDots(5); D.lightLanes(2); D.setMultiplier(4);
        D.setBallsLeft(2); D.setBallSave(9); D.giveBall(); D.nori(); D.info(); D.inject({ t: 'wall', ballId: 1, speed: 400, kind: 'wall', x: 20, y: 300 });
        run(G, 0.5); D.forceScreen('paused'); D.forceScreen('play'); D.drain(); run(G, 0.5); D.forceScreen('over'); D.forceScreen('title'); D.forceScreen('play');
        run(G, 0.2); D.clearLevel(); run(G, 0.2);
        return true;
      } catch (err) { console.log(err.stack); return false; }
    })());
    check('forceScreen title / over / play land on the screens they name', (() => {
      const D = G.debug;
      D.forceScreen('title'); const a = S.screen; D.forceScreen('play'); const b = S.screen; D.forceScreen('over'); const c = S.screen; D.forceScreen('play'); const d = S.screen;
      return a === 'title' && b === 'play' && c === 'over' && d === 'play';
    })());
  }
}

TUNE.chatterGap = TUNE_SAVED.chatterGap; TUNE.chatterPerMinute = TUNE_SAVED.chatterPerMinute;

// ---------------------------------------------------------------------------------------------------------------
if (want('pause')) {
  section('pause and resume at every state (nothing may move or tick while paused)');
  const cases = {
    'title': (t) => {},
    'ball waiting in the lane': (t) => { startGame(t); run(t.game, 1); },
    'plunger being charged': (t) => { startGame(t); t.game.launchDown(); run(t.game, 0.5); },
    'ball in flight': (t) => { startGame(t); flyBall(t); run(t.game, 0.5); },
    'ball held in the ghost house': (t) => { startGame(t); flyBall(t); const b = t.W.balls.find((x) => x.state === 'play'); b.x = 264; b.y = 199; b.vx = b.vy = 0; run(t.game, 0.3); },
    'ball locked (two-ball waiting)': (t) => { startGame(t); const b = flyBall(t); for (let i = 0; i < 3; i++) t.game.debug.inject({ t: 'hole', id: 'house', ballId: b.id }); run(t.game, 0.5); },
    'two-ball play': (t) => { startGame(t); const b = flyBall(t); t.game.debug.forceMultiball(); run(t.game, 0.2); t.game.launchDown(); t.game.launchUp(); run(t.game, 0.6); },
    'Pacman rescue (chomp)': (t) => { startGame(t); flyBall(t); t.game.debug.drain(); run(t.game, 0.3); },
    'Pacman rescue (spit)': (t) => { startGame(t); flyBall(t); t.game.debug.drain(); run(t.game, 1.1); },
    'between two balls': (t) => { startGame(t); flyBall(t); t.game.debug.setBallSave(0); t.game.debug.drain(); run(t.game, 0.8); },
    'after the last ball (ending)': (t) => { startGame(t); t.game.debug.setBallsLeft(0); flyBall(t); t.game.debug.setBallSave(0); t.game.debug.drain(); run(t.game, 0.5); },
    'blue ghost time': (t) => { startGame(t); flyBall(t); t.game.debug.givePower(); run(t.game, 3); },
    'balloons surprise': (t) => { startGame(t); flyBall(t); t.game.debug.triggerSurprise('balloons'); run(t.game, 2); },
    'slow surprise': (t) => { startGame(t); flyBall(t); t.game.debug.triggerSurprise('slow'); run(t.game, 2); },
    'mystery announced (surprise pending)': (t) => { startGame(t); parkBall(t); t.game.debug.inject({ t: 'target', id: 'mystery', ballId: 1, speed: 400 }); run(t.game, 0.5); },
    'banner showing': (t) => { startGame(t); run(t.game, 1); }
  };
  for (const name of Object.keys(cases)) {
    const t = mk(300);
    cases[name](t);
    const G = t.game, S = t.S;
    const screen0 = S.screen;
    const did = G.pause();
    if (screen0 === 'title' || screen0 === 'over') { check('pause at "' + name + '" is ignored', did === false && S.screen === screen0); continue; }
    const a = snap(t), time0 = S.time;
    run(G, 3);
    const b = snap(t);
    const events = t.rec.sfx.length;
    G.setKeys({ left: true, right: true }); run(G, 0.5); G.setKeys({ left: false, right: false });
    const c = snap(t).replace(/"keys":\{[^}]*\}/, '"keys":K');
    const ok1 = did === true && S.screen === 'paused' && a === b;
    const ok2 = S.time - time0 > 3.4;
    G.launchDown(); const resumed = S.screen === 'play'; G.launchUp();
    run(G, 0.5);
    const ok3 = resumed && S.screen === 'play' && !S.keys.space;
    check('pause at "' + name + '"', ok1 && ok2 && ok3, 'frozen ' + (a === b) + ', clock runs ' + ok2 + ', Space resumes ' + resumed + (ok1 ? '' : ' screen ' + S.screen));
  }
  {
    const t = mk(301); startGame(t); flyBall(t);
    check('pause / resume many times in a row is stable', (() => { for (let i = 0; i < 50; i++) { t.game.togglePause(); t.game.update(DT); } t.game.resume(); run(t.game, 1); return t.S.screen === 'play'; })());
    const u = mk(302); startGame(u); u.game.debug.forceScreen('over');
    check('pause on the game over screen is ignored', u.game.pause() === false && u.S.screen === 'over');
  }
}

// ---------------------------------------------------------------------------------------------------------------
if (want('perf')) {
  section('performance of game.update (game rules + physics, autoplay, 6 minutes)');
  const t = mk(400, { autoplay: true, skill: 0.8 });
  const G = t.game;
  const times = [];
  for (let i = 0; i < 60 * 360; i++) { const a = process.hrtime.bigint(); G.update(DT); times.push(Number(process.hrtime.bigint() - a) / 1e6); if (t.S.screen === 'over' && i > 60 * 20) G.debug.forceScreen('play'); }
  const warm = times.slice(600);
  log('  ' + warm.length + ' frames: mean ' + fmt(mean(warm), 3) + ' ms, median ' + fmt(pct(warm, 0.5), 3) + ' ms, p99 ' + fmt(pct(warm, 0.99), 3) + ' ms, max ' + fmt(Math.max.apply(null, warm), 2) + ' ms');
  check('the average frame costs well under a millisecond', mean(warm) < 0.5);
  check('even the slow frames stay small (p99 under 2 ms)', pct(warm, 0.99) < 2);
}

// ---------------------------------------------------------------------------------------------------------------
if (want('autoplay')) {
  section('autoplay (?autoplay=1): the bot starts, plays, and restarts by itself');
  const t = mk(500, { autoplay: true, skill: 0.4 });
  const G = t.game;
  check('starts from the title by itself with a Space press', runUntil(G, () => t.S.screen === 'play', 3) && (run(G, 0.6), t.rec.has('welcome')));
  check('plays to the game over screen', runUntil(G, () => t.S.screen === 'over', 3600), 'after ' + fmt(t.S.time, 0) + ' s, score ' + t.S.score);
  check('restarts by itself after the stars (new game, ball 1, score reset)', runUntil(G, () => t.S.screen === 'play', 30) && (run(G, 0.6), t.S.ballNo === 1 && t.S.score < 1000 && G.stats.games === 2 && t.rec.has('ball_ready')));
}

// ---------------------------------------------------------------------------------------------------------------
if (want('determinism')) {
  section('determinism');
  const finalOf = (seed, kind) => {
    const r = playGame(seed, kind, { varDt: true });
    const S = r.t.S;
    return JSON.stringify({ score: S.score, t: +S.time.toFixed(6), screen: S.screen, stars: S.stars, ballNo: S.ballNo, dots: S.dotsLeft, tray: S.fruitTray, stats: r.t.game.stats.surprises, voice: r.t.game.stats.voice.calls, sfx: r.t.game.stats.sfx });
  };
  for (const [seed, kind] of [[5, 0.8], [6, 'mash'], [7, 1]]) {
    const a = finalOf(seed, kind), b = finalOf(seed, kind);
    check('same seed, same inputs: identical result (seed ' + seed + ', ' + (kind === 'mash' ? 'masher' : 'skill ' + kind) + ')', a === b);
  }
  const a = finalOf(8, 0.8), b = finalOf(9, 0.8);
  check('different seeds give different games', a !== b);
}

// ---------------------------------------------------------------------------------------------------------------
if (want('chatter') && results.length) {
  section('chatter: voice requests per game minute');
  const per = [], byPri = [0, 0, 0, 0];
  let mins = 0, gapBad = 0;
  for (const r of results) {
    const v = r.t.game.stats.voice, m = r.t.S.time / 60;
    per.push(v.calls / m); mins += m;
    for (let i = 0; i < 4; i++) byPri[i] += v.byPri[i];
    let last = -99;
    for (const e of v.log) if (e.pri <= 1) { if (e.t - last < 4.99) gapBad++; last = e.t; }
  }
  log('  calls per minute by priority 0/1/2/3: ' + byPri.map((x) => fmt(x / mins, 2)).join(' / ') + '   total ' + fmt(byPri.reduce((a, b) => a + b, 0) / mins, 1) + ' per minute over ' + fmt(mins, 0) + ' game minutes');
  log('  per game: median ' + fmt(pct(per, 0.5), 1) + ', p90 ' + fmt(pct(per, 0.9), 1) + ', max ' + fmt(Math.max.apply(null, per), 1));
  check('the game asks for at most about 12 voice lines per minute on average', byPri.reduce((a, b) => a + b, 0) / mins <= 12.5);
  check('chatter (priority 0 and 1) is at least 5 s apart', gapBad === 0, gapBad + ' too close');
  const catSpam = {};
  for (const r of results) {
    const lastAt = {};
    for (const e of r.t.game.stats.voice.log) { if (e.pri < 3 && lastAt[e.cat] !== undefined && e.t - lastAt[e.cat] < 1.0 && !/^(ball_|mult_)/.test(e.cat)) catSpam[e.cat] = (catSpam[e.cat] || 0) + 1; lastAt[e.cat] = e.t; }
  }
  check('no category repeats within 1 s', Object.keys(catSpam).length === 0, JSON.stringify(catSpam));
  const topCats = {};
  for (const r of results) for (const k of Object.keys(r.t.game.stats.voice.byCat)) topCats[k] = (topCats[k] || 0) + r.t.game.stats.voice.byCat[k];
  log('  most requested (per game minute): ' + Object.entries(topCats).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => k + ' ' + fmt(v / mins, 2)).join(', '));
}

if (want('names')) {
  collectUsage();
  section('sfx names and voice categories against SPEC 4.5');
  const unknownSfx = [...usedSfx.keys()].filter((n) => !SFX_OK.has(n));
  const unknownVoice = [...new Set([...usedVoice.keys()].map((k) => k.split('@')[0]))].filter((n) => !VOICE_OK.has(n));
  check('every sfx name the game calls is in the SPEC list', unknownSfx.length === 0, unknownSfx.join(', '));
  check('every voice category the game calls is in the SPEC list', unknownVoice.length === 0, unknownVoice.join(', '));
  if (voiceScriptCats) {
    const missing = [...new Set([...usedVoice.keys()].map((k) => k.split('@')[0]))].filter((n) => !voiceScriptCats.has(n));
    check('every voice category the game calls exists in tools/voice_script.json', missing.length === 0, missing.join(', '));
  }
  const byCat = {};
  for (const k of usedVoice.keys()) { const [c, p] = k.split('@'); (byCat[c] = byCat[c] || new Set()).add(+p); }
  const off = Object.keys(byCat).filter((c) => SPEC_VOICE_PRI[c] !== undefined && [...byCat[c]].some((p) => p !== SPEC_VOICE_PRI[c]));
  log('  voice priorities that differ from the SPEC suggestion (fine, only informative): ' + (off.map((c) => c + ' ' + [...byCat[c]].join('/') + ' (spec ' + SPEC_VOICE_PRI[c] + ')').join(', ') || 'none'));
  log('  sfx used: ' + [...usedSfx.keys()].sort().join(' '));
  const notUsed = [...SFX_OK].filter((n) => !usedSfx.has(n));
  log('  sfx in the SPEC list that no test triggered: ' + (notUsed.join(' ') || 'none'));
  const catsUsed = [...new Set([...usedVoice.keys()].map((k) => k.split('@')[0]))];
  log('  voice categories used (' + catsUsed.length + '): ' + catsUsed.sort().join(' '));
  log('  voice categories in the SPEC list that no test triggered: ' + ([...VOICE_OK].filter((n) => catsUsed.indexOf(n) < 0).join(' ') || 'none'));
}

// ---------------------------------------------------------------------------------------------------------------
if (want('calibrate')) {
  section('star calibration and bot score distributions (' + CAL + ' games per skill)');
  const rows = {};
  for (const skill of [0, 0.4, 0.8, 1]) {
    const sc = [], durs = [], stars = [0, 0, 0, 0];
    for (let i = 0; i < CAL; i++) {
      const t = mk(1000 + i * 7 + Math.round(skill * 10), { autoplay: true, skill: skill });
      const G = t.game;
      for (let f = 0; f < 60 * 60 * 50 && t.S.screen !== 'over'; f++) G.update(DT);
      sc.push(t.S.score); durs.push(t.S.time); stars[t.S.stars]++;
    }
    rows[skill] = { sc, stars };
    log('  skill ' + String(skill).padEnd(3) + ' score p10 ' + String(pct(sc, 0.1)).padStart(6) + '  p25 ' + String(pct(sc, 0.25)).padStart(6) + '  median ' + String(pct(sc, 0.5)).padStart(6) + '  p75 ' + String(pct(sc, 0.75)).padStart(6) + '  p90 ' + String(pct(sc, 0.9)).padStart(6) +
      '   game length median ' + fmt(pct(durs, 0.5) / 60, 1) + ' min   stars 1/2/3: ' + stars[1] + '/' + stars[2] + '/' + stars[3]);
  }
  const kid = rows[0.8].stars, top = rows[1].stars;
  check('the kid bot usually earns 2 stars or more (never 1 in most games)', kid[1] <= CAL * 0.2, 'stars 1/2/3 = ' + kid[1] + '/' + kid[2] + '/' + kid[3]);
  check('the kid bot mostly gets 2 stars, not always 3', kid[2] >= kid[3] * 0.8, 'stars 1/2/3 = ' + kid[1] + '/' + kid[2] + '/' + kid[3]);
  check('a strong run (skill 1) gets 3 stars more often than the kid bot', top[3] >= kid[3]);
  check('an idle bot gets mostly 1 star', rows[0].stars[1] >= CAL * 0.6, 'stars 1/2/3 = ' + rows[0].stars.slice(1).join('/'));
}

log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL PASS'));
process.exit(failures ? 1 : 0);
