'use strict';
// Tests for the ten minute goodbye (SPEC 9.2, state.limit in src/40_game.js) in plain Node, with a recording PM.Audio stub.
//   node tests/limit_test.js [--seeds N] [--only a,b] [--verbose]
// Sections: defaults and strings, timing (play time only, pause, title and game over do not count), the notice at a calm moment,
// the last ball (lane, between balls, ending, two-ball play, locked ball, extraball, shield, ball saver), the goodbye screen
// (Space only pokes, voice, pause), the kid bot, debug hooks, determinism and N seeded games that must all end in the goodbye.
// Exit code 1 if anything FAILS.
const fs = require('fs');
const path = require('path');
const { loadPM } = require('./load');

const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf('--' + name); return i < 0 ? def : (args[i + 1] === undefined || args[i + 1].startsWith('--') ? true : args[i + 1]); }
const SEEDS = parseInt(arg('seeds', 40), 10);
const ONLY = arg('only', '') ? String(arg('only', '')).split(',') : null;
const VERBOSE = !!arg('verbose', false);

let failures = 0;
const log = (s) => console.log(s);
function check(name, ok, detail) {
  if (!ok) failures++;
  log((ok ? '  PASS ' : '  FAIL ') + name + (detail !== undefined && detail !== '' ? '  (' + detail + ')' : ''));
  return ok;
}
const want = (name) => !ONLY || ONLY.indexOf(name) >= 0;
const section = (name) => log('\n== ' + name + ' ==');
const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d === undefined ? 1 : d) : 'n/a');

const PM = loadPM();
const CFG = PM.CFG;
const DT = 1 / 60;
const NOTICE = CFG.LIMIT_NOTICE_SECONDS;
const TUNE = PM.Game.TUNE;

// ---------------------------------------------------------------------------------------------------------------
// harness (the same small toolbox as tests/game_test.js, plus limit event logs)
function makeRecorder(getTime) {
  const rec = { sfx: [], voice: [], musics: [], stopVoice: 0, busy: false };
  rec.A = {
    isNull: false,
    unlock() { return Promise.resolve(); }, loadVoices() { return Promise.resolve(); },
    sfx(name, o) { rec.sfx.push({ t: getTime(), name: name, o: o }); },
    voice(cat, o) { rec.voice.push({ t: getTime(), cat: cat, pri: o && o.priority, force: !!(o && o.force) }); return true; },
    voiceBusy() { return rec.busy; }, stopVoice() { rec.stopVoice++; },
    setMusic(m) { rec.musics.push(m); }, setVolumes() {}, getVolumes() { return { master: 1, music: 1, sfx: 1, voice: 1 }; },
    setMuted() {}, isMuted() { return false; }, setMusicOn() {}, isMusicOn() { return true; }, suspend() {}, resume() {}, update() {}
  };
  rec.count = (cat) => rec.voice.filter((v) => v.cat === cat).length;
  rec.has = (cat) => rec.count(cat) > 0;
  rec.at = (cat) => { const v = rec.voice.find((x) => x.cat === cat); return v ? v.t : -1; };
  rec.sfxCount = (n) => rec.sfx.filter((v) => v.name === n).length;
  return rec;
}
function mk(seed, o) {
  let game = null;
  const rec = makeRecorder(() => (game ? game.state.time : 0));
  PM.Audio = rec.A;
  game = PM.Game.create(Object.assign({ seed: seed }, o || {}));
  const t = { game: game, rec: rec, S: game.state, W: game.world, L: game.state.limit, events: [], gameovers: [], screens: [],
    use() { PM.Audio = rec.A; } };
  game.on('limit', (p) => t.events.push({ phase: p, t: game.state.time, playSec: game.state.limit.playSec, ballNo: game.state.ballNo, screen: game.state.screen }));
  game.on('gameover', (e) => t.gameovers.push(e));
  game.on('screen', (n, old) => t.screens.push(old + '>' + n));
  t.phases = () => t.events.map((e) => e.phase).join(',');
  return t;
}
function run(game, seconds, dt) { dt = dt || DT; const n = Math.round(seconds / dt); for (let i = 0; i < n; i++) game.update(dt); }
function runUntil(game, pred, maxSeconds, dt) {
  dt = dt || DT;
  const n = Math.round(maxSeconds / dt);
  for (let i = 0; i < n; i++) { if (pred()) return true; game.update(dt); }
  return pred();
}
function startGame(t) { t.use(); t.game.start(); run(t.game, 0.1); return t.W.balls[0]; }
function startQuiet(t) {
  const b = startGame(t);
  runUntil(t.game, () => !t.S.banner && t.game.debug.info().bannerQueue === 0, 6);
  return b;
}
function parkBall(t) {                 // a ball that sits still in play until the test drains it (state 'held' counts as in play)
  const G = t.game;
  G.launchDown(); G.launchUp();
  run(G, 0.05);
  const b = t.W.balls.find((x) => x.state !== 'drained');
  t.W.lockBall(b.id);
  run(G, 0.05);
  return b;
}
function flyBall(t) {
  const G = t.game;
  G.launchDown(); G.launchUp();
  runUntil(G, () => t.W.balls.some((b) => b.state === 'play'), 3);
  return t.W.balls.find((b) => b.state === 'play') || null;
}
const inject = (t, e) => t.game.debug.inject(e);
const alive = (t) => t.W.balls.filter((b) => b.state !== 'drained');
// a plain lost ball: no saver, every ball drains
function loseBall(t) { t.game.debug.setBallSave(0); t.game.debug.drain(); run(t.game, 0.06); }
function snap(t) {                     // the whole game except what may differ between a paused and a running frame
  const S = t.S, W = t.W;
  const o = {};
  for (const k of Object.keys(S)) if (k !== 'time' && k !== 'screen' && k !== 'pausedFrom' && k !== 'keys') o[k] = S[k];
  o.balls = W.balls.map((b) => [b.id, b.state, +b.x.toFixed(3), +b.y.toFixed(3), +b.vx.toFixed(3), +b.vy.toFixed(3)]);
  o.fl = W.flippers.map((f) => +f.angle.toFixed(4));
  return JSON.stringify(o);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------------------------------------------------------
if (want('config')) {
  section('defaults, options, strings');
  const mkLimit = (o) => { const t = mk(1, o); return t.L; };
  let L = mkLimit({});
  check('config: 600 s of play, notice lasts 9 s', CFG.PLAY_LIMIT_SECONDS === 600 && NOTICE === 9);
  check('default game: limit on, 600 s, phase none, counters at 0', L.enabled === true && L.limitSec === 600 && L.phase === 'none' && L.playSec === 0 && L.t === 0 && L.poke === 0);
  L = mkLimit({ autoplay: true });
  check('autoplay defaults to OFF (tests and demos run for long)', L.enabled === false && L.limitSec === 0);
  L = mkLimit({ autoplay: true, playLimitSeconds: 20 });
  check('autoplay with an explicit limit: ON (20 s)', L.enabled === true && L.limitSec === 20);
  L = mkLimit({ playLimitSeconds: 0 });
  check('playLimitSeconds 0 = off', L.enabled === false);
  L = mkLimit({ playLimitSeconds: 45 });
  check('playLimitSeconds 45 = on, 45 s', L.enabled === true && L.limitSec === 45);
  check('negative and NaN limits mean off', mkLimit({ playLimitSeconds: -5 }).enabled === false && mkLimit({ playLimitSeconds: NaN }).enabled === false);
  check('state.limit has exactly the documented fields', Object.keys(L).sort().join(',') === 'enabled,limitSec,phase,playSec,poke,score,stars,t', Object.keys(L).join(','));
  const T = PM.T, dashRe = new RegExp('[' + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015) + ']');
  const strs = [T.limit_notice.text, T.limit_notice.sub, T.limit_last.text, T.limit_last.sub, T.goodbye.title, T.goodbye.line1, T.goodbye.line2, T.goodbye.parents];
  check('PM.T.limit_notice {text, sub}, limit_last {text, sub}, goodbye {title, line1, line2, parents} exist and are non-empty',
    strs.every((s) => typeof s === 'string' && s.length > 0) && Object.keys(T.goodbye).sort().join(',') === 'line1,line2,parents,title' &&
    Object.keys(T.limit_notice).sort().join(',') === 'sub,text' && Object.keys(T.limit_last).sort().join(',') === 'sub,text');
  check('the strings have no em or en dashes', strs.every((s) => !dashRe.test(s)));
  check('the goodbye title is short enough for a big headline (under 14 characters)', T.goodbye.title.length < 14, T.goodbye.title);
  // a game with the limit off never says goodbye, however long it runs (a bot plays 11 minutes)
  {
    const t = mk(3, { autoplay: true, skill: 0.8 });
    t.use();
    const over = runUntil(t.game, () => false, 660);
    check('autoplay without a limit plays 11 minutes: no limit event, phase none, never a goodbye', t.events.length === 0 && t.L.phase === 'none' && t.S.screen !== 'goodbye' && !t.rec.has('limit_notice') && over === false,
      'playSec ' + fmt(t.L.playSec, 0) + ', screen ' + t.S.screen);
  }
}

// ---------------------------------------------------------------------------------------------------------------
if (want('timing')) {
  section('play time: only screen "play" counts, and it survives game over');
  {
    const t = mk(11, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    t.use();
    run(G, 100);
    check('the title screen does not count', L.playSec === 0 && S.screen === 'title');
    startGame(t);
    run(G, 5);
    const p0 = L.playSec;
    check('play counts real seconds (5.1 s after 5.1 s)', near(p0, 5.1, 0.1), fmt(p0, 2));
    G.pause();
    run(G, 100);
    check('pause does not count', L.playSec === p0 && L.phase === 'none' && S.screen === 'paused');
    G.resume(); run(G, 5);
    check('counting goes on after the pause', near(L.playSec, p0 + 5, 0.1), fmt(L.playSec, 2));
    const p1 = L.playSec;
    G.debug.forceScreen('over'); run(G, 100);
    check('the game over screen does not count and nothing happens on it', L.playSec === p1 && S.screen === 'over' && L.phase === 'none' && t.events.length === 0);
    run(G, 5);
    G.launchDown(); G.launchUp(); run(G, 0.6);
    check('a new game after game over keeps the play-time counter', S.screen === 'play' && L.playSec >= p1 && L.playSec < p1 + 1, fmt(p1, 2) + ' -> ' + fmt(L.playSec, 2));
    run(G, 5);
    check('and keeps counting in the new game', L.playSec > p1 + 4.5);
  }
  {
    const t = mk(12, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startGame(t);
    G.debug.setPlaySeconds(28);
    run(G, 1.5);
    check('no notice before the limit (29.6 s of 30)', L.phase === 'none' && t.events.length === 0 && !t.rec.has('limit_notice'), fmt(L.playSec, 2));
    run(G, 0.6);
    check('the notice starts when playSec reaches 30: phase, banner "limit", voice limit_notice at priority 3, event',
      L.phase === 'notice' && S.banner && S.banner.kind === 'limit' && t.rec.voice.some((v) => v.cat === 'limit_notice' && v.pri === 3) && t.phases() === 'notice',
      'phase ' + L.phase + ' at ' + fmt(L.playSec, 2));
    check('the notice banner carries PM.T.limit_notice and lasts exactly the notice time', S.banner.text === PM.T.limit_notice.text && S.banner.sub === PM.T.limit_notice.sub && S.banner.dur === NOTICE && S.banner.min === NOTICE && S.banner.pri === 3, JSON.stringify({ text: S.banner.text, dur: S.banner.dur, pri: S.banner.pri }));
    check('the event carries the play time and the notice t counts up', t.events[0].playSec >= 30 && t.events[0].playSec < 30.1 && L.t > 0 && L.t < 0.7, fmt(t.events[0].playSec, 2));
    run(G, NOTICE - L.t - 0.3);
    check('still notice just before 9 s', L.phase === 'notice' && S.banner && S.banner.kind === 'limit');
    run(G, 0.5);
    check('after 9 s the notice becomes phase "last" (t restarts, the notice banner is gone)', L.phase === 'last' && L.t < 0.5 && (!S.banner || S.banner.kind !== 'limit') && t.phases() === 'notice,last', 'phase ' + L.phase + ' t ' + fmt(L.t, 2));
    check('the notice was spoken exactly once', t.rec.count('limit_notice') === 1);
    run(G, 60);
    check('the last phase lasts as long as the ball waits (a ball is still in the lane)', L.phase === 'last' && S.screen === 'play' && S.launch.waiting);
  }
}

// ---------------------------------------------------------------------------------------------------------------
if (want('calm')) {
  section('the notice comes at a calm moment');
  {
    const t = mk(21, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startGame(t);
    G.debug.setPlaySeconds(29.98);
    G.launchDown(); run(G, 0.5);
    check('never in the middle of a plunger charge: time is up, the charge goes on, no notice', L.playSec > 30 && S.launch.charge > 0.3 && L.phase === 'none' && t.events.length === 0, 'charge ' + fmt(S.launch.charge, 2) + ' phase ' + L.phase);
    G.launchUp(); run(G, 0.1);
    check('as soon as the charge is released (ball fired) the notice starts', L.phase === 'notice' && t.rec.has('limit_notice'), 'phase ' + L.phase);
  }
  {
    const t = mk(22, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startGame(t);
    G.debug.setPlaySeconds(29.9);
    G.launchDown(); run(G, 1.0);
    check('Space held: still charging, still no notice', S.launch.charge > 0.8 && L.phase === 'none');
    run(G, 1.0);
    check('a plunger held for good fires by itself and then the notice comes', !S.launch.waiting && L.phase === 'notice', 'phase ' + L.phase);
    G.launchUp(); run(G, 0.1);
  }
  {
    const t = mk(23, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startGame(t);                                   // the "ready" banner (priority 2) is showing
    check('a banner of priority 2 is running', S.banner && S.banner.kind === 'ready' && S.banner.pri === 2);
    G.debug.setPlaySeconds(30); run(G, 0.1);
    check('a lower priority banner yields at once: the notice takes over the banner slot', L.phase === 'notice' && S.banner && S.banner.kind === 'limit');
  }
  {
    const t = mk(24, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); parkBall(t);
    G.debug.triggerSurprise('dance'); run(G, 0.3);
    check('a surprise banner (priority 3) is running', S.banner && S.banner.kind === 'surprise' && S.banner.pri === 3);
    G.debug.setPlaySeconds(30); run(G, 0.5);
    check('a banner of priority 3 is let finish: the notice waits', L.phase === 'none' && S.banner && S.banner.kind === 'surprise');
    check('the notice starts when that banner is over, in a free banner slot', runUntil(G, () => L.phase === 'notice', 4) && S.banner && S.banner.kind === 'limit', 'phase ' + L.phase);
  }
  {
    const t = mk(25, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); parkBall(t);
    G.debug.triggerSurprise('dance'); G.debug.setPlaySeconds(30);
    let started = -1;
    for (let i = 0; i < 60 * 12; i++) {
      if (i % 90 === 0) G.debug.triggerSurprise('dance');       // a stream of important banners: the notice must not wait for ever
      G.update(DT);
      if (L.phase === 'notice') { started = i * DT; break; }
    }
    check('waits at most about 5 s for a calm moment, then takes over anyway', started >= 4.9 && started <= 5.3 && S.banner && S.banner.kind === 'limit', fmt(started, 2) + ' s');
  }
  {
    const t = mk(26, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); parkBall(t);
    inject(t, { t: 'target', id: 'mystery', ballId: 1, speed: 500 }); run(G, 0.2);
    G.debug.setPlaySeconds(30); run(G, 0.5);
    check('a surprise that is about to start (banner "Meglepetes") goes first', L.phase === 'none' && !S.surprise);
    check('then the notice follows', runUntil(G, () => L.phase === 'notice', 8) && !!S.surprise !== undefined, 'phase ' + L.phase);
  }
  {
    const t = mk(27, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); flyBall(t);
    G.debug.setBallSave(0); G.debug.drain(); run(G, 0.06);
    check('setup: the ball is lost, the pause between balls runs', G.debug.info().mode === 'between');
    G.debug.setPlaySeconds(30); run(G, 0.5);
    check('time up between balls: no notice (there is no ball to wait for)', L.phase === 'none' && t.events.length === 0 && !t.rec.has('limit_notice'));
  }
  {
    const t = mk(28, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); flyBall(t);
    G.debug.setBallSave(15); G.debug.drain(); run(G, 0.3);
    check('setup: a Pacman rescue is running', G.debug.info().mode === 'rescue' && S.pacmanHelper.phase === 'chomp');
    G.debug.setPlaySeconds(30); run(G, 0.3);
    check('time up during the rescue: the notice waits for the rescue to end', L.phase === 'none' && S.pacmanHelper.phase !== 'none');
    check('after the rescue the ball waits in the lane and the notice starts', runUntil(G, () => L.phase === 'notice', 3) && S.launch.waiting && G.debug.info().mode === 'live');
  }
}

// ---------------------------------------------------------------------------------------------------------------
if (want('last')) {
  section('the last ball');
  {
    const t = mk(31, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L, W = t.W;
    startQuiet(t);
    G.debug.setPlaySeconds(30); run(G, 0.3);
    check('time up while the ball waits in the lane: notice', L.phase === 'notice' && S.launch.waiting);
    run(G, NOTICE + 0.2);
    check('that ball is the last ball: phase last, the ball still waits, the child can launch it', L.phase === 'last' && S.launch.waiting && S.screen === 'play');
    G.launchDown(); G.launchUp(); run(G, 0.2);
    check('launching still works in the last phase', !S.launch.waiting && alive(t).length === 1);
    G.debug.setBallSave(0);
    const ballNo = S.ballNo, left = S.ballsLeft;
    G.debug.drain(); run(G, 0.06);
    check('the last ball is lost: a short pause, no new ball, no banner about a next ball', S.screen === 'play' && G.debug.info().mode === 'ending' && !S.banner);
    run(G, TUNE.endingPause - 0.1);
    check('just before the ending pause is over: still playing', S.screen === 'play');
    run(G, 0.3);
    check('then the goodbye (not the normal game over)', S.screen === 'goodbye' && L.phase === 'goodbye' && t.phases() === 'notice,last,goodbye' && t.screens.join(' ').indexOf('play>goodbye') >= 0 && t.screens.indexOf('play>over') < 0, t.phases() + ' / ' + t.screens.join(' '));
    check('no ball was served afterwards (ball number, balls left, balls in the world)', S.ballNo === ballNo && S.ballsLeft === left && W.balls.length === 0 && !t.rec.has('ball_2') && !t.rec.has('ball_ready'));
    run(G, 20);
    check('and none appears later', W.balls.length === 0 && S.ballNo === ballNo && S.screen === 'goodbye');
  }
  {
    // between the balls: the pause runs, then the goodbye instead of ball 2
    const t = mk(32, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L, W = t.W;
    startQuiet(t); flyBall(t);
    loseBall(t);
    check('setup: pause between balls', G.debug.info().mode === 'between' && S.ballsLeft === 4);
    G.debug.setPlaySeconds(30);
    run(G, 1.5);
    check('during the pause: still play, no notice, no new ball yet', S.screen === 'play' && L.phase === 'none');
    run(G, 0.6);
    check('after the normal short pause (2 s) the goodbye comes and no new ball is served', S.screen === 'goodbye' && L.phase === 'goodbye' && S.ballNo === 1 && W.balls.length === 0 && t.phases() === 'goodbye' && !t.rec.has('ball_2'), t.phases());
  }
  {
    // the last ball of the normal five is lost while the time is up but the notice never showed
    const t = mk(33, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); G.debug.setBallsLeft(0); flyBall(t);
    loseBall(t);
    check('setup: the ending pause after the fifth ball', G.debug.info().mode === 'ending');
    G.debug.setPlaySeconds(30); run(G, 1.7);
    check('time up during the ending pause: goodbye instead of the normal game over', S.screen === 'goodbye' && t.screens.indexOf('play>over') < 0 && t.gameovers.length === 1 && t.gameovers[0].limit === true);
    const c = mk(34, { playLimitSeconds: 30 });
    startQuiet(c); c.game.debug.setBallsLeft(0); flyBall(c); loseBall(c); run(c.game, 1.7);
    check('control: without the time limit reached the same situation ends in the normal game over', c.S.screen === 'over' && c.gameovers.length === 1 && !c.gameovers[0].limit);
  }
  {
    // the child's normal five balls end while "last" is active
    const t = mk(35, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); G.debug.setBallsLeft(0); parkBall(t);
    G.debug.setPlaySeconds(30); run(G, NOTICE + 0.5);
    check('ball 5 in play, notice and last shown', L.phase === 'last' && S.ballsLeft === 0);
    loseBall(t); run(G, 1.7);
    check('the fifth ball ends while last is active: goodbye replaces the game over', S.screen === 'goodbye' && t.gameovers.length === 1 && t.gameovers[0].limit === true && !t.rec.has('over') && !t.rec.has('play_again'));
  }
  {
    // ball saver and Pacman rescue on the last ball
    const t = mk(36, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L, W = t.W;
    startQuiet(t); flyBall(t);
    check('setup: the launch armed the 15 s saver', S.ballSave > 14);
    G.debug.setPlaySeconds(30); run(G, 0.3);
    check('notice while the ball flies', L.phase === 'notice');
    G.debug.drain(); run(G, 0.3);
    check('a ball lost during the saver is rescued by Pacman: no goodbye yet', S.pacmanHelper.phase === 'chomp' && S.screen === 'play' && L.phase === 'notice');
    run(G, 2);
    check('the rescued ball waits in the lane (the last ball goes on)', S.launch.waiting && S.screen === 'play' && S.ballNo === 1 && S.ballsLeft === 4);
    run(G, NOTICE);
    check('phase last after the notice time (also after the rescue)', L.phase === 'last');
    flyBall(t);
    G.debug.drain(); run(G, 0.06);
    check('one rescue per ball: the second loss is final, the ending pause runs', G.debug.info().mode === 'ending' && S.pacmanHelper.phase === 'none');
    run(G, 1.7);
    check('then the goodbye', S.screen === 'goodbye' && S.ballNo === 1 && W.balls.length === 0);
  }
  {
    // two-ball play running at the moment the limit hits: wait for every ball
    const t = mk(37, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); flyBall(t);
    G.debug.forceMultiball(); run(G, 0.1);
    G.launchDown(); G.launchUp(); run(G, 0.3);
    G.debug.setBallSave(0);
    check('setup: two-ball play', S.multiball && alive(t).length === 2);
    G.debug.setPlaySeconds(30);
    check('notice in the middle of two-ball play (it waits for the "two balls" banner to finish, then comes)', runUntil(G, () => L.phase === 'notice', 5) && S.multiball, 'phase ' + L.phase);
    const other = alive(t);
    other[0].state = 'drained'; inject(t, { t: 'drain', ballId: other[0].id }); run(G, 0.1);
    t.W.lockBall(other[1].id);                     // the other ball sits still for as long as the test wants
    run(G, 3);
    check('one ball lost: nothing ends, still play, two-ball play is over', S.screen === 'play' && !S.multiball && alive(t).length === 1 && L.phase !== 'goodbye');
    run(G, NOTICE);
    check('the game waits for the other ball (phase last, still play)', L.phase === 'last' && S.screen === 'play');
    other[1].state = 'drained'; inject(t, { t: 'drain', ballId: other[1].id }); run(G, 0.1);
    check('the second ball is lost: the ending pause starts', G.debug.info().mode === 'ending' && S.screen === 'play');
    run(G, 1.7);
    check('goodbye after both balls', S.screen === 'goodbye' && S.ballNo === 1 && t.W.balls.length === 0);
  }
  {
    // both balls of a two-ball play lost at the same moment
    const t = mk(38, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); flyBall(t);
    G.debug.forceMultiball(); run(G, 0.1);
    G.launchDown(); G.launchUp(); run(G, 0.3);
    G.debug.setBallSave(0); G.debug.setPlaySeconds(30);
    runUntil(G, () => L.phase === 'notice', 5);
    G.debug.drain(); run(G, 0.06);
    run(G, 1.7);
    check('both balls lost at once: one goodbye', S.screen === 'goodbye' && t.phases() === 'notice,goodbye' && t.gameovers.length === 1, t.phases());
  }
  {
    // a locked ball in the ghost house and a ball waiting in the lane
    const t = mk(39, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L, W = t.W;
    startQuiet(t);
    const b = flyBall(t);
    const enter = () => { inject(t, { t: 'hole', id: 'house', ballId: b.id }); run(G, 0.05); };
    enter(); run(G, 2.5); enter(); run(G, 2.5); enter();
    check('setup: the third house entry locked the ball and served a new one', !!S.locked && S.launch.waiting && b.state === 'held');
    G.debug.setPlaySeconds(30); run(G, 0.3);
    check('notice with a locked ball and a waiting ball', L.phase === 'notice' && !!S.locked && S.launch.waiting);
    run(G, NOTICE);
    G.launchDown(); G.launchUp(); run(G, 0.3);
    check('launching the waiting ball frees the locked one (two-ball play from before the notice)', S.multiball && !S.locked && alive(t).length === 2);
    G.debug.setBallSave(0);
    const two = alive(t);
    two[0].state = 'drained'; inject(t, { t: 'drain', ballId: two[0].id }); t.W.lockBall(two[1].id); run(G, 3);
    check('one of the two lost: play goes on, no goodbye yet', S.screen === 'play' && L.phase === 'last');
    two[1].state = 'drained'; inject(t, { t: 'drain', ballId: two[1].id }); run(G, 1.8);
    check('the other one lost: goodbye, exactly one', S.screen === 'goodbye' && t.phases() === 'notice,last,goodbye' && S.ballNo === 1, t.phases());
  }
  {
    // a locked ball that the child never frees: the game frees it by itself after 30 s (no hang in the last phase)
    const t = mk(40, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t);
    const b = flyBall(t);
    for (let i = 0; i < 3; i++) { inject(t, { t: 'hole', id: 'house', ballId: b.id }); run(G, 2.5); }
    G.debug.setPlaySeconds(30);
    run(G, NOTICE + 5);
    check('locked ball still waiting during the last phase (30 s timeout not over)', !!S.locked && L.phase === 'last' && G.debug.info().mode === 'live');
    const freed = runUntil(G, () => !S.locked, 30);
    check('the lock timeout still frees it in the last phase (two-ball play from before the notice)', freed && S.multiball && L.phase === 'last' && S.screen === 'play');
  }
  {
    // no new two-ball lock once the time is up
    const t = mk(41, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t);
    const b = flyBall(t);
    G.debug.setPlaySeconds(30); run(G, 0.3);
    const enter = () => { inject(t, { t: 'hole', id: 'house', ballId: b.id }); run(G, 0.05); };
    const n0 = alive(t).length;
    enter(); run(G, 2.5); enter(); run(G, 2.5); enter(); run(G, 0.5);
    check('the third house entry after the notice does NOT lock a ball and serves no new ball', !S.locked && !S.multiball && alive(t).length === n0 && b.state !== 'held' && !t.rec.has('lock_ball'));
    check('the house still gives its points', S.score >= 1500);
  }
  {
    // the same in the short window where the time is up but the notice waits for a running important banner
    const t = mk(42, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t);
    const b = flyBall(t);
    G.debug.triggerSurprise('dance'); G.debug.setPlaySeconds(30); run(G, 0.3);
    check('setup: time is up, the notice is waiting', L.phase === 'none' && L.playSec >= 30);
    const enter = () => { inject(t, { t: 'hole', id: 'house', ballId: b.id }); run(G, 0.05); };
    enter(); run(G, 0.3); enter(); run(G, 0.3); enter();
    check('no lock while the notice is only waiting either', !S.locked && !S.multiball && !t.rec.has('lock_ball'));
  }
}

// ---------------------------------------------------------------------------------------------------------------
if (want('surprises')) {
  section('no extra ball once the time is up; the shield still works');
  {
    const t = mk(51, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); parkBall(t);
    G.debug.setPlaySeconds(30); run(G, 0.3);
    const total = S.ballsTotal, left = S.ballsLeft;
    G.debug.triggerSurprise('extraball'); run(G, 0.2);
    check('asking for the extraball surprise after the notice gives another surprise', !!S.surprise && S.surprise.id !== 'extraball' && S.ballsTotal === total && S.ballsLeft === left && !t.rec.has('surprise_extraball'), S.surprise && S.surprise.id);
    check('and no extra_ball sound', t.rec.sfxCount('extra_ball') === 0);
  }
  {
    const t = mk(52, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); parkBall(t);
    G.debug.setPlaySeconds(30);                    // time up, notice not shown yet
    G.debug.triggerSurprise('dance'); run(G, 0.1);
    G.debug.triggerSurprise('extraball'); run(G, 0.1);
    check('also while the notice only waits (time up, phase none): no extraball', !(S.surprise && S.surprise.id === 'extraball') && S.ballsTotal === 5);
  }
  {
    // every mystery target surprise for a long while in the last phase: never an extra ball (the bag holds it among the first seven)
    const t = mk(53, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); parkBall(t);
    G.debug.setPlaySeconds(30); run(G, 0.3);
    const ids = [];
    G.on('surprise', (id, started) => { if (started) ids.push(id); });
    for (let i = 0; i < 9; i++) {
      runUntil(G, () => S.mystery.ready && !S.banner, 40);
      inject(t, { t: 'target', id: 'mystery', ballId: 1, speed: 500 });
      run(G, 2.0);
      runUntil(G, () => !S.surprise, 30);
    }
    check('nine mystery surprises in the last phase: at least 8 happened, none was the extra ball, ballsTotal still 5', ids.length >= 8 && ids.indexOf('extraball') < 0 && S.ballsTotal === 5 && S.screen === 'play' && L.phase === 'last', ids.join(','));
    const c = mk(53, {}); const cs = [];
    startQuiet(c); parkBall(c);
    c.game.on('surprise', (id, started) => { if (started) cs.push(id); });
    for (let i = 0; i < 8; i++) {
      runUntil(c.game, () => c.S.mystery.ready && !c.S.banner, 40);
      inject(c, { t: 'target', id: 'mystery', ballId: 1, speed: 500 });
      run(c.game, 2.0);
      runUntil(c.game, () => !c.S.surprise, 30);
    }
    check('control: the same game without a limit does get the extra ball among its first seven surprises', cs.slice(0, 7).indexOf('extraball') >= 0, cs.join(','));
  }
  {
    // an extra ball given BEFORE the notice is no problem
    const t = mk(54, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); parkBall(t);
    G.debug.triggerSurprise('extraball'); run(G, 0.2);
    check('setup: extraball surprise before the time is up', S.ballsTotal === 6 && S.ballsLeft === 5);
    G.debug.setPlaySeconds(30); run(G, NOTICE + 0.5);
    loseBall(t); run(G, 1.8);
    check('the gift ball is never served: the goodbye comes, ball number stays 1', S.screen === 'goodbye' && S.ballNo === 1 && t.W.balls.length === 0);
  }
  {
    // shield: unlimited rescues while it lasts, then the last ball is really lost
    const t = mk(55, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); flyBall(t);
    G.debug.setPlaySeconds(30); run(G, 0.3);
    G.debug.triggerSurprise('shield'); run(G, 0.3);
    check('shield in the last phase: saver for about 20 s', S.surprise && S.surprise.id === 'shield' && S.ballSave > 19 && L.phase === 'notice');
    G.debug.drain(); run(G, 0.3);
    check('a lost ball is rescued (shield)', S.pacmanHelper.phase === 'chomp' && S.screen === 'play');
    run(G, 2);
    flyBall(t); G.debug.drain(); run(G, 0.3);
    check('and again (the shield allows more than one rescue)', S.pacmanHelper.phase === 'chomp' && S.screen === 'play' && L.phase !== 'goodbye');
    run(G, 2);
    parkBall(t);
    check('the shield ends after its time (only counts while a ball is in play)', runUntil(G, () => !S.surprise, 30) && S.ballSave < 0.5, 'ballSave ' + fmt(S.ballSave, 1));
    G.debug.setBallSave(0);
    G.debug.drain(); run(G, 0.06);
    run(G, 1.7);
    check('then losing the ball ends the game with the goodbye', S.screen === 'goodbye' && t.phases() === 'notice,last,goodbye', t.phases());
  }
}

// ---------------------------------------------------------------------------------------------------------------
if (want('goodbye')) {
  section('the goodbye screen');
  {
    let saved = [];
    const t = mk(61, { playLimitSeconds: 30, hiScore: 500, onHiScore: (s) => saved.push(s) }); const G = t.game, S = t.S, L = t.L, W = t.W;
    startQuiet(t); parkBall(t);
    G.debug.setScore(4321);
    G.debug.setPlaySeconds(30); run(G, NOTICE + 0.5);
    loseBall(t);
    run(G, TUNE.endingPause + 0.2);
    check('goodbye: screen, phase, score, stars', S.screen === 'goodbye' && L.phase === 'goodbye' && L.score === 4321 && L.stars === S.stars && S.stars >= 1 && S.stars <= 3, JSON.stringify({ screen: S.screen, score: L.score, stars: L.stars }));
    check('score and hi-score were saved exactly once through onHiScore (like a game over)', saved.length === 1 && saved[0] === 4321 && S.hiScore === 4321 && S.newRecord === true, JSON.stringify(saved));
    check('game.on("gameover") fired once with limit:true, score and stars', t.gameovers.length === 1 && t.gameovers[0].limit === true && t.gameovers[0].score === 4321 && t.gameovers[0].stars === S.stars && t.gameovers[0].newRecord === true);
    check('the screen event went play > goodbye, the limit event ended with goodbye', t.screens[t.screens.length - 1] === 'play>goodbye' && t.events[t.events.length - 1].phase === 'goodbye');
    check('banner, popups and roaming delights are cleared, no ball is left', S.banner === null && S.popups.length === 0 && S.delights.length === 0 && W.balls.length === 0 && !S.launch.waiting && S.pacmanHelper.phase === 'none');
    run(G, 60);
    check('60 s later: no roaming delights, still the goodbye, nothing else started', S.screen === 'goodbye' && S.delights.length === 0 && t.gameovers.length === 1 && saved.length === 1 && G.stats.games === 1);
    check('t keeps running in the goodbye (about 60 s)', L.t > 59 && L.t < 62, fmt(L.t, 1));
    check('overT counts too (the stars time)', S.overT > 59, fmt(S.overT, 1));
    check('voice: limit_goodbye at priority 3 exactly once, no over / over_stars / newrecord / play_again lines', t.rec.count('limit_goodbye') === 1 && t.rec.voice.find((v) => v.cat === 'limit_goodbye').pri === 3 && !t.rec.has('over') && !t.rec.has('over_stars_1') && !t.rec.has('over_stars_2') && !t.rec.has('newrecord') && !t.rec.has('play_again'));
    check('the goodbye is spoken shortly after the screen appears (0.6 s)', near(t.rec.at('limit_goodbye') - t.events[t.events.length - 1].t, TUNE.goodbyeVoiceAt, 0.1), fmt(t.rec.at('limit_goodbye') - t.events[t.events.length - 1].t, 2));
    check('the game over jingle plays once, no star chimes', t.rec.sfxCount('game_over') === 1 && t.rec.sfxCount('star_collect') === 0);
    check('start() refuses on the goodbye screen', G.start() === false && S.screen === 'goodbye');
    check('pointer buttons: sound and music still reach the ui event', (() => { const k = []; G.on('ui', (x) => k.push(x)); G.pointer('sound'); G.pointer('music'); G.pointer('fullscreen'); return k.join(',') === 'sound,music,fullscreen'; })());
    check('no exception when the flipper keys are pressed on the goodbye screen', (() => { try { G.setKeys({ left: true, right: true }); run(G, 1); G.setKeys({ left: false, right: false }); run(G, 0.2); return S.screen === 'goodbye'; } catch (e) { return false; } })());
  }
  {
    // Space and taps only poke
    const t = mk(62, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); parkBall(t);
    G.debug.setScore(20000);
    G.debug.setPlaySeconds(30); run(G, NOTICE + 0.5);
    loseBall(t); run(G, TUNE.endingPause + 0.2);
    check('setup: goodbye, 3 stars? (2 from 12000)', S.screen === 'goodbye');
    run(G, 1);
    const games = G.stats.games;
    G.launchDown(); run(G, 0.05); G.launchUp(); run(G, 0.3);
    check('Space on the goodbye: does not restart, pokes once', S.screen === 'goodbye' && L.poke === 1 && G.stats.games === games && t.W.balls.length === 0 && L.phase === 'goodbye');
    check('a poke right after the goodbye line does not talk (the goodbye is still being said)', t.rec.count('limit_rest') === 0 && t.rec.sfxCount('ui_click') === 1);
    G.launchDown(); G.launchUp();
    for (let i = 0; i < 20; i++) { G.launchDown(); G.launchUp(); run(G, 0.05); }
    check('a child mashing Space: every press pokes, nothing restarts, no rest line yet (cooldown)', L.poke === 22 && S.screen === 'goodbye' && t.rec.count('limit_rest') === 0 && G.stats.games === games, 'poke ' + L.poke);
    run(G, 6);
    G.launchDown(); G.launchUp(); run(G, 0.1);
    check('after 6 s a poke asks for limit_rest (priority 3)', t.rec.count('limit_rest') === 1 && t.rec.voice.find((v) => v.cat === 'limit_rest').pri === 3, 'count ' + t.rec.count('limit_rest'));
    G.launchDown(); G.launchUp(); run(G, 3);
    G.launchDown(); G.launchUp(); run(G, 0.1);
    check('limit_rest has a cooldown of about 6 s', t.rec.count('limit_rest') === 1);
    run(G, 4);
    G.launchDown(); G.launchUp(); run(G, 0.1);
    check('and comes again later', t.rec.count('limit_rest') === 2);
    t.rec.busy = true; run(G, 7);
    G.launchDown(); G.launchUp(); run(G, 0.1);
    check('a poke while another voice line is speaking does not queue a rest line', t.rec.count('limit_rest') === 2);
    t.rec.busy = false;
    check('Space held down (no release) pokes only once, a held key never restarts', (() => { const p = L.poke; G.launchDown(); G.launchDown(); G.launchDown(); run(G, 2); const r = L.poke === p + 1; G.launchUp(); return r && S.screen === 'goodbye'; })());
    check('after all that: still the goodbye, one game only', S.screen === 'goodbye' && G.stats.games === games && t.gameovers.length === 1);
  }
  {
    // the goodbye waits for a voice line that is still speaking
    const t = mk(63, { playLimitSeconds: 30 }); const G = t.game, S = t.S;
    startQuiet(t);
    t.rec.busy = true;
    G.debug.finishLimit();
    run(G, 5);
    check('another line is speaking: the goodbye waits', S.screen === 'goodbye' && t.rec.count('limit_goodbye') === 0);
    t.rec.busy = false; run(G, 0.5);
    check('it is spoken as soon as the voice is free, once', t.rec.count('limit_goodbye') === 1);
    const u = mk(64, { playLimitSeconds: 30 }); startQuiet(u); u.rec.busy = true; u.game.debug.finishLimit(); run(u.game, TUNE.goodbyeVoiceWait + 2);
    const gb = u.events[u.events.length - 1].t, said = u.rec.at('limit_goodbye') - gb;
    check('a voice that never gets free does not block it for ever (about 12.6 s)', u.rec.count('limit_goodbye') === 1 && said > TUNE.goodbyeVoiceWait && said < TUNE.goodbyeVoiceWait + 1.5, fmt(said, 2) + ' s');
  }
  {
    // pause on the goodbye
    const t = mk(65, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); G.debug.finishLimit(); run(G, 3);
    const before = snap(t), tt = L.t;
    check('pause works on the goodbye screen', G.pause() === true && S.screen === 'paused' && S.pausedFrom === 'goodbye');
    run(G, 30);
    check('nothing ticks while paused (t and state frozen, nothing said)', L.t === tt && snap(t) === before && t.rec.count('limit_rest') === 0 && t.rec.count('pause') === 0);
    G.launchDown(); G.launchUp(); run(G, 0.1);
    check('Space resumes to the goodbye (not to play), without a poke', S.screen === 'goodbye' && L.phase === 'goodbye' && L.poke === 0 && S.pausedFrom === '' && snap(t) !== undefined);
    G.pointer('pause'); run(G, 1); G.pointer('pause'); run(G, 1);
    check('pointer("pause") toggles pause and back on the goodbye', S.screen === 'goodbye' && L.t > tt);
    check('the goodbye does not talk on pause / resume (no pause and resume lines)', t.rec.count('pause') === 0 && t.rec.count('resume') === 0);
    check('a silent pause (window blur) also returns to the goodbye', (() => { G.pause({ silent: true }); const a = S.screen === 'paused'; G.resume({ silent: true }); return a && S.screen === 'goodbye'; })());
    check('debug.forceScreen("paused") and back work from the goodbye', (() => { G.debug.forceScreen('paused'); const a = S.screen; G.resume({ silent: true }); return a === 'paused' && S.screen === 'goodbye'; })());
  }
  {
    // hi-score not beaten: nothing saved
    let saved = [];
    const t = mk(66, { playLimitSeconds: 30, hiScore: 99999, onHiScore: (s) => saved.push(s) });
    startQuiet(t); t.game.debug.setScore(500); t.game.debug.finishLimit(); run(t.game, 2);
    check('a score below the hi-score is not saved and is no record', saved.length === 0 && !t.S.newRecord && t.S.screen === 'goodbye' && t.S.hiScore === 99999);
  }
  {
    // stars follow the game over rule
    const st = [];
    for (const sc of [0, 11999, 12000, 69999, 70000]) { const x = mk(67, { playLimitSeconds: 30 }); startGame(x); x.game.debug.setScore(sc); x.game.debug.finishLimit(); run(x.game, 0.1); st.push(x.S.stars + '/' + x.L.stars); }
    check('stars on the goodbye: 1 always, 2 from 12000, 3 from 70000 (also in limit.stars)', st.join(',') === '1/1,1/1,2/2,2/2,3/3', st.join(','));
  }
}

// ---------------------------------------------------------------------------------------------------------------
if (want('pause')) {
  section('pausing in every phase: safe, nothing counts, resume restores everything');
  const cases = {
    'time almost up (phase none)': (t) => { startQuiet(t); flyBall(t); t.game.debug.setPlaySeconds(29.5); run(t.game, 0.3); },
    'notice, just started': (t) => { startQuiet(t); flyBall(t); t.game.debug.setPlaySeconds(30); run(t.game, 0.3); },
    'notice, middle': (t) => { startQuiet(t); parkBall(t); t.game.debug.setPlaySeconds(30); run(t.game, 4.5); },
    'notice, 0.1 s before the badge': (t) => { startQuiet(t); parkBall(t); t.game.debug.setPlaySeconds(30); run(t.game, NOTICE - 0.05); },
    'last, ball waiting in the lane': (t) => { startQuiet(t); t.game.debug.setPlaySeconds(30); run(t.game, NOTICE + 1); },
    'last, ball flying': (t) => { startQuiet(t); flyBall(t); t.game.debug.setPlaySeconds(30); run(t.game, NOTICE + 1); },
    'last, ending pause': (t) => { startQuiet(t); parkBall(t); t.game.debug.setPlaySeconds(30); run(t.game, NOTICE + 1); loseBall(t); run(t.game, 0.5); },
    'time up between balls': (t) => { startQuiet(t); flyBall(t); loseBall(t); t.game.debug.setPlaySeconds(30); run(t.game, 0.5); },
    'notice during a rescue wait': (t) => { startQuiet(t); flyBall(t); t.game.debug.setBallSave(15); t.game.debug.drain(); run(t.game, 0.3); t.game.debug.setPlaySeconds(30); run(t.game, 0.3); }
  };
  for (const name of Object.keys(cases)) {
    const t = mk(70, { playLimitSeconds: 30 });
    cases[name](t);
    const G = t.game, S = t.S, L = t.L;
    const a = snap(t), ph = L.phase, ps = L.playSec, lt = L.t, ev = t.events.length;
    const did = G.pause();
    run(G, 40);
    G.setKeys({ left: true, right: true }); run(G, 0.3); G.setKeys({ left: false, right: false });
    const b = snap(t);
    const ok1 = did === true && S.screen === 'paused' && a === b && L.phase === ph && L.playSec === ps && L.t === lt && t.events.length === ev;
    G.launchDown(); const resumed = S.screen === 'play'; G.launchUp();
    run(G, 0.02);
    check('pause at "' + name + '"', ok1 && resumed, 'frozen ' + (a === b) + ', phase ' + ph + ' -> ' + L.phase + ', playSec ' + fmt(ps, 2) + ' -> ' + fmt(L.playSec, 2));
    // and the rest of the sequence still works after the resume
    G.debug.setBallSave(0);
    const ok2 = runUntil(G, () => S.screen === 'goodbye' || (S.launch.waiting && L.phase === 'last' && false), 0.01) || true;
    check('after the pause at "' + name + '" the phases go on: limit ends in the goodbye once the ball is lost',
      (() => {
        if (L.phase === 'none') { G.debug.setPlaySeconds(31); }
        run(G, 0.5);
        if (alive(t).length === 0 && S.launch.waiting) { G.launchDown(); G.launchUp(); run(G, 0.5); }
        let guard = 0;
        while (S.screen !== 'goodbye' && guard++ < 12) {
          if (S.launch.waiting) { G.launchDown(); G.launchUp(); run(G, 0.5); }
          loseBall(t); run(G, 2.6);
        }
        return S.screen === 'goodbye' && t.events.filter((e) => e.phase === 'goodbye').length === 1;
      })(), t.phases());
  }
  {
    // the notice timer really does not run in a pause: total notice time in real steps
    const t = mk(71, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); parkBall(t); G.debug.setPlaySeconds(30); run(G, 4);
    G.pause(); run(G, 20); G.resume(); run(G, 4.5);
    check('4 s + pause + 4.5 s of notice is still notice (8.5 of 9 s)', L.phase === 'notice' && near(L.t, 8.5, 0.15), fmt(L.t, 2));
    run(G, 0.6);
    check('and phase last after 9 s of real notice time', L.phase === 'last');
    G.pause(); run(G, 5); G.resume(); run(G, 0.1);
    check('pausing in the last phase changes nothing', L.phase === 'last' && S.screen === 'play');
  }
  {
    const t = mk(72, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startGame(t); G.debug.setPlaySeconds(29.98); G.launchDown(); run(G, 0.4);
    G.pause(); run(G, 5); G.resume(); run(G, 0.05);
    check('pause while the plunger is charged (time up): the charge is cancelled, the notice comes at the next calm frame', S.launch.charge === 0 && (L.phase === 'notice' || L.phase === 'none'));
    G.launchUp(); run(G, 0.3);
    check('and no exception, the game goes on', S.screen === 'play');
  }
}

// ---------------------------------------------------------------------------------------------------------------
if (want('bot')) {
  section('the kid bot plays through notice, last and goodbye (limit 20 s of play, one pause of 30 s on the way)');
  {
    const seeds = [1, 2, 3, 4, 5, 6];
    for (const seed of seeds) {
      const t = mk(seed, { autoplay: true, skill: 0.8, playLimitSeconds: 20 }); const G = t.game, S = t.S, L = t.L;
      t.use();
      let playT = 0, paused = false, pausedAt = -1, ex = null, frames = 0;
      let notice = null, ballAtNotice = -1, lastCounted = 0;
      G.on('limit', (p) => { if (p === 'notice') { notice = { playT: playT, time: S.time, playSec: L.playSec }; ballAtNotice = S.ballNo; } });
      try {
        for (; frames < 60 * 60 * 12 && S.screen !== 'goodbye'; frames++) {
          if (!paused && S.screen === 'play' && playT > 10 && pausedAt < 0) { G.pause({ silent: true }); paused = true; pausedAt = frames; }
          if (paused && frames - pausedAt >= 60 * 30) { G.resume({ silent: true }); paused = false; }
          if (S.screen === 'play') playT += DT;
          G.update(DT);
        }
      } catch (err) { ex = err; }
      const ok = !ex && S.screen === 'goodbye';
      check('bot seed ' + seed + ': reaches the goodbye', ok, ex ? String(ex.stack) : 'play time ' + fmt(playT, 1) + ' s, phases ' + t.phases());
      if (!ok) continue;
      check('bot seed ' + seed + ': the notice came at 20 s of PLAY time, not before, and the 30 s pause did not count',
        !!notice && notice.playSec >= 20 && notice.playSec < 26.5 && near(notice.playSec, notice.playT, 0.1) && notice.time > notice.playSec + 29,
        notice ? 'playSec ' + fmt(notice.playSec, 2) + ', counted ' + fmt(notice.playT, 2) + ', clock ' + fmt(notice.time, 1) : 'no notice: ' + t.phases());
      const games = G.stats.games;
      run(G, 90);
      check('bot seed ' + seed + ': then last, then goodbye, once each; no ball served after the notice; one goodbye',
        t.phases() === 'notice,last,goodbye' && S.ballNo === ballAtNotice && t.gameovers.length === 1 && t.gameovers[0].limit === true && t.rec.count('limit_goodbye') === 1 && t.rec.count('limit_notice') === 1, t.phases() + ' ball ' + ballAtNotice + '->' + S.ballNo + ', goodbye lines ' + t.rec.count('limit_goodbye'));
      check('bot seed ' + seed + ': idles on the goodbye screen (no restart, no poke, no ball)', S.screen === 'goodbye' && G.stats.games === games && L.poke === 0 && t.W.balls.length === 0 && t.events.length === 3, 'poke ' + L.poke);
    }
  }
  {
    const t = mk(9, { autoplay: true, skill: 1, playLimitSeconds: 90 }); const G = t.game, S = t.S, L = t.L;
    runUntil(G, () => S.screen === 'goodbye', 60 * 30);
    check('a skill 1 bot with a 90 s limit also ends in the goodbye', S.screen === 'goodbye' && L.playSec >= 90 && t.gameovers.length === 1, t.phases());
  }
}

// ---------------------------------------------------------------------------------------------------------------
if (want('debug')) {
  section('debug hooks');
  {
    const t = mk(81, { autoplay: true }); const G = t.game, S = t.S, L = t.L;
    t.use();
    check('setup: autoplay game has no limit', !L.enabled);
    check('startLimit() from the title starts a game and jumps to the notice (enables the limit)', G.debug.startLimit() === true && S.screen === 'play' && L.enabled && L.phase === 'notice' && t.rec.has('limit_notice') && S.banner && S.banner.kind === 'limit', L.phase);
    run(G, 0.1);
    check('startLimit() twice does not repeat the notice', (G.debug.startLimit(), t.rec.count('limit_notice') === 1 && t.phases() === 'notice'));
    check('forceScreen("last") jumps to the last phase and the notice banner is gone', (G.debug.forceScreen('last'), L.phase === 'last' && t.phases() === 'notice,last' && (!S.banner || S.banner.kind !== 'limit')));
    check('setPlaySeconds(n) sets the counter', (G.debug.setPlaySeconds(123), L.playSec === 123) && (G.debug.setPlaySeconds(-4), L.playSec === 0));
  }
  {
    const t = mk(82, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t);
    G.debug.setScore(15000);
    check('finishLimit() jumps to the goodbye', G.debug.finishLimit() === true && S.screen === 'goodbye' && L.phase === 'goodbye' && L.score === 15000 && L.stars === 2);
    check('finishLimit() again does nothing', G.debug.finishLimit() === true && t.events.length === 1 && t.gameovers.length === 1);
    G.debug.forceScreen('play'); run(G, 0.3);
    check('forceScreen("play") backs out of the goodbye (debug only): a fresh game, the limit is counting again', S.screen === 'play' && L.phase === 'none' && L.playSec < 1);
    G.debug.forceScreen('goodbye'); run(G, 0.3);
    check('forceScreen("goodbye") lands on the goodbye', S.screen === 'goodbye');
    G.debug.forceScreen('title'); run(G, 0.3);
    check('forceScreen("title") backs out too', S.screen === 'title' && L.phase === 'none');
    G.debug.forceScreen('notice'); run(G, 0.3);
    check('forceScreen("notice") from the title starts a game with the notice', S.screen === 'play' && L.phase === 'notice');
  }
  {
    const t = mk(83, { autoplay: true }); const G = t.game, S = t.S, L = t.L;
    check('finishLimit() works on a game with no limit and from the title', G.debug.finishLimit() === true && S.screen === 'goodbye' && L.enabled);
  }
  {
    const t = mk(84, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); G.debug.forceScreen('over'); run(G, 2);
    check('finishLimit() from the game over screen gives the goodbye', G.debug.finishLimit() === true && S.screen === 'goodbye');
  }
  {
    const t = mk(85, { playLimitSeconds: 30 }); const G = t.game, S = t.S, L = t.L;
    startQuiet(t); flyBall(t); G.debug.drain(); run(G, 0.3);
    check('finishLimit() during a Pacman rescue: clean goodbye', G.debug.finishLimit() === true && S.screen === 'goodbye' && S.pacmanHelper.phase === 'none');
    run(G, 3);
    check('and it stays clean afterwards (no ball, no helper)', t.W.balls.length === 0 && S.pacmanHelper.phase === 'none' && S.screen === 'goodbye');
  }
}

// ---------------------------------------------------------------------------------------------------------------
if (want('determinism')) {
  section('determinism');
  const finalOf = (seed, kind, varDt) => {
    const t = mk(seed, kind === 'mash' ? { playLimitSeconds: 25 } : { autoplay: true, skill: kind, playLimitSeconds: 25 });
    const G = t.game, S = t.S;
    t.use();
    const r = PM.util.rng(seed * 13 + 1);
    let hold = 0, mst = 0;
    for (let f = 0; f < 60 * 60 * 8 && S.screen !== 'goodbye'; f++) {
      const dt = varDt ? 1 / 144 + r() * (1 / 30 - 1 / 144) : DT;
      if (kind === 'mash') {
        if (S.screen === 'title' || S.screen === 'over') { mst += dt; if (mst > 1.5) { mst = 0; G.launchDown(); G.launchUp(); } }
        else {
          if (r() < 0.10) G.setKeys({ left: !S.keys.left, right: S.keys.right });
          if (r() < 0.10) G.setKeys({ left: S.keys.left, right: !S.keys.right });
          if (hold > 0) { hold -= dt; if (hold <= 0) G.launchUp(); } else if (r() < 0.04) { G.launchDown(); hold = r() < 0.3 ? 0.03 : 0.1 + r() * 1.2; }
        }
      }
      G.update(dt);
    }
    for (let i = 0; i < 300; i++) { if (i % 20 === 0) { G.launchDown(); G.launchUp(); } G.update(DT); }
    return JSON.stringify({ s: snap(t), t: +S.time.toFixed(6), ev: t.events, voice: G.stats.voice.byCat, log: G.stats.limitLog, screens: t.screens });
  };
  for (const [seed, kind, varDt] of [[5, 0.8, false], [6, 'mash', true], [7, 1, true]]) {
    const a = finalOf(seed, kind, varDt), b = finalOf(seed, kind, varDt);
    check('same seed, same inputs: identical goodbye run (seed ' + seed + ', ' + (kind === 'mash' ? 'masher' : 'skill ' + kind) + (varDt ? ', variable dt' : '') + ')', a === b && a.indexOf('"goodbye"') > 0);
  }
  check('different seeds give different runs', finalOf(8, 0.8, false) !== finalOf(9, 0.8, false));
}

// ---------------------------------------------------------------------------------------------------------------
if (want('seeds')) {
  section(SEEDS + ' seeded games (bots at several skills and a key masher): no exception, every run ends in the goodbye');
  const kinds = [0.4, 0.8, 1, 'mash', 0, 0.8];
  let bad = 0, withNotice = 0, viaBetween = 0, worstWait = 0;
  const counts = { notice: 0, last: 0, goodbye: 0 };
  for (let i = 0; i < SEEDS; i++) {
    const kind = kinds[i % kinds.length], seed = 100 + i, limit = 8 + ((i * 7) % 33);
    const saved = [];
    const t = mk(seed, Object.assign({ playLimitSeconds: limit, hiScore: i % 3 === 0 ? 800 : 0, onHiScore: (s) => saved.push(s) }, kind === 'mash' ? {} : { autoplay: true, skill: kind }));
    const G = t.game, S = t.S, L = t.L;
    t.use();
    const r = PM.util.rng(seed * 31 + 7);
    let hold = 0, mst = 0, ex = null, ended = false, ballAtNotice = -1, ballDrift = false, overAfter = false, playT = 0, spawnedAfter = 0;
    G.on('limit', (p) => { if (p === 'notice') ballAtNotice = S.ballNo; });
    try {
      for (let f = 0; f < 60 * 60 * 20; f++) {
        const dt = i % 2 ? 1 / 144 + r() * (1 / 30 - 1 / 144) : DT;
        if (kind === 'mash') {
          if (S.screen === 'title' || S.screen === 'over') { mst += dt; if (mst > 1.5) { mst = 0; G.launchDown(); G.launchUp(); } }
          else if (S.screen === 'play') {
            if (r() < 0.10) G.setKeys({ left: !S.keys.left, right: S.keys.right });
            if (r() < 0.10) G.setKeys({ left: S.keys.left, right: !S.keys.right });
            if (hold > 0) { hold -= dt; if (hold <= 0) G.launchUp(); } else if (r() < 0.04) { G.launchDown(); hold = r() < 0.3 ? 0.03 : 0.1 + r() * 1.2; if (r() < 0.02) hold = 6; }
          }
        }
        if (S.screen === 'play') playT += Math.min(dt, 0.05);
        G.update(dt);
        if (L.phase !== 'none' && L.phase !== 'goodbye' && ballAtNotice >= 0 && S.ballNo !== ballAtNotice) ballDrift = true;
        if (ballAtNotice >= 0 && S.screen === 'over') overAfter = true;
        if (S.screen === 'goodbye') { ended = true; break; }
      }
      // twenty more seconds: mash Space like a child, still the goodbye
      for (let f = 0; f < 60 * 20 && ended; f++) { if (f % 15 === 0) { G.launchDown(); G.launchUp(); } if (f % 7 === 0) G.setKeys({ left: f % 14 === 0, right: f % 21 === 0 }); G.update(DT); }
    } catch (err) { ex = err; }
    const notice = t.events.find((e) => e.phase === 'notice');
    if (notice) withNotice++; else viaBetween++;
    for (const e of t.events) counts[e.phase]++;
    if (notice) worstWait = Math.max(worstWait, notice.playSec - limit);
    const order = t.phases();
    const orderOk = order === 'notice,last,goodbye' || order === 'notice,goodbye' || order === 'goodbye';      // a quick ball may be lost before the badge phase
    const okAll = !ex && ended && orderOk && !ballDrift && !overAfter && S.screen === 'goodbye' && t.W.balls.length === 0 && t.gameovers.filter((g) => g.limit).length === 1 &&
      t.rec.count('limit_goodbye') === 1 && t.rec.count('limit_notice') <= 1 && saved.length <= 1 && L.playSec >= limit && L.poke > 0 && G.stats.games >= 1 && Number.isFinite(S.score) && S.stars >= 1 && S.stars <= 3;
    if (!okAll) bad++;
    if (!okAll || VERBOSE) check('seed ' + seed + ' ' + (kind === 'mash' ? 'masher' : 'skill ' + kind).padEnd(11) + ' limit ' + String(limit).padStart(2) + ' s', okAll,
      (ex ? 'EXCEPTION ' + ex.stack + ' ' : '') + 'ended ' + ended + ', phases ' + order + ', ball drift ' + ballDrift + ', over after notice ' + overAfter + ', gameovers ' + t.gameovers.length + ', goodbye lines ' + t.rec.count('limit_goodbye') + ', saved ' + saved.length + ', play ' + fmt(playT, 1) + ' s, score ' + S.score);
  }
  check(SEEDS + ' seeded games: none broke and every one ended in the goodbye', bad === 0, bad + ' bad');
  log('  ' + withNotice + ' runs had a notice (' + counts.last + ' of them also reached the badge phase before the ball was lost), ' + viaBetween + ' went straight to the goodbye from a pause between balls; events ' + JSON.stringify(counts) + '; the longest wait for a calm moment was ' + fmt(worstWait, 2) + ' s');
  check('most runs show the notice first', withNotice >= SEEDS * 0.6, withNotice + ' of ' + SEEDS);
  check('the notice never waits longer than about 7 s past the limit (5 s of banners, a plunger charge)', worstWait < 7, fmt(worstWait, 2));
}

// ---------------------------------------------------------------------------------------------------------------
if (want('fuzz')) {
  section('fuzz: random keys, pauses (silent and not), pointer taps and lost balls across every phase');
  let bad = 0;
  const FUZZ = Math.max(10, Math.round(SEEDS * 0.75));
  for (let i = 0; i < FUZZ; i++) {
    const seed = 900 + i;
    const t = mk(seed, { playLimitSeconds: 6 + (i % 5) * 4, autoplay: i % 3 === 0, skill: 0.6 });
    const G = t.game, S = t.S, L = t.L;
    t.use();
    const r = PM.util.rng(seed * 17 + 3);
    let ex = null, resumeAt = -1, problems = [], sawPaused = { none: 0, notice: 0, last: 0, goodbye: 0 };
    try {
      for (let f = 0; f < 60 * 60 * 15; f++) {
        const dt = 1 / 144 + r() * (1 / 30 - 1 / 144);
        if (S.screen === 'paused') { if (f >= resumeAt) { if (r() < 0.5) G.resume({ silent: r() < 0.5 }); else { G.launchDown(); G.launchUp(); } } }
        else {
          if (r() < 0.004) { if (r() < 0.5) G.pause({ silent: r() < 0.5 }); else G.pointer('pause'); resumeAt = f + Math.floor(r() * 600); sawPaused[L.phase]++; }
          if (S.screen === 'title' || S.screen === 'over') { if (r() < 0.02) { G.launchDown(); G.launchUp(); } }
          else {
            if (r() < 0.05) G.setKeys({ left: r() < 0.5, right: r() < 0.5 });
            if (r() < 0.02) { G.launchDown(); if (r() < 0.6) G.launchUp(); }
            if (r() < 0.02) G.launchUp();
            if (r() < 0.0008) { G.debug.setBallSave(0); G.debug.drain(); }
            if (r() < 0.001) G.pointer('sound');
            if (r() < 0.0015 && S.screen === 'play') inject(t, { t: 'hole', id: 'house', ballId: 1 });
            if (r() < 0.0006 && S.screen === 'play') inject(t, { t: 'target', id: 'mystery', ballId: 1, speed: 500 });
          }
        }
        G.update(dt);
        if (S.screen === 'paused' && S.pausedFrom !== 'play' && S.pausedFrom !== 'goodbye') { problems.push('pausedFrom ' + S.pausedFrom); break; }
        if (S.screen !== 'paused' && S.pausedFrom !== '') { problems.push('pausedFrom left over ' + S.pausedFrom); break; }
        if (!Number.isFinite(L.t) || !Number.isFinite(L.playSec) || L.t < 0) { problems.push('limit numbers'); break; }
        if (S.screen === 'goodbye' && L.phase !== 'goodbye') { problems.push('goodbye screen with phase ' + L.phase); break; }
        if (L.phase === 'goodbye' && S.screen !== 'goodbye' && S.screen !== 'paused') { problems.push('goodbye phase on screen ' + S.screen); break; }
        if (S.screen === 'goodbye' && t.W.balls.length) { problems.push('balls on the goodbye'); break; }
        if (L.phase === 'goodbye' && t.events.length && S.time - t.events[t.events.length - 1].t > 25) break;
      }
      if (S.screen === 'paused') G.resume({ silent: true });
    } catch (err) { ex = err; }
    const order = t.phases();
    const okAll = !ex && !problems.length && S.screen === 'goodbye' && (order === 'notice,last,goodbye' || order === 'notice,goodbye' || order === 'goodbye') && t.gameovers.filter((g) => g.limit).length === 1;
    if (!okAll) bad++;
    if (!okAll || VERBOSE) check('fuzz seed ' + seed, okAll, (ex ? 'EXCEPTION ' + ex.stack + ' ' : '') + problems.join('; ') + ' screen ' + S.screen + ' phases ' + order + ' paused in ' + JSON.stringify(sawPaused));
  }
  check(FUZZ + ' fuzzed games: no exception, consistent state every frame, every one ends in exactly one goodbye', bad === 0, bad + ' bad');
}

log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL PASS'));
process.exit(failures ? 1 : 0);
