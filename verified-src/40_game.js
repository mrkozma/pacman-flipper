/* 40_game.js: PM.Game.create(opts) -> game. The rules, the state machine and every gameplay feature of SPEC section 5.
   DOM-free and deterministic: the same seed plus the same update(dt) and input sequence gives the same game.
   Audio is called through PM.Audio at call time (never cached). No Math.random, no Date.now.

   const game = PM.Game.create({ seed, hiScore, autoplay, skill, onHiScore })
     autoplay   true = PM.Bot plays everything (starts the game, launches, flips, restarts after game over)
     skill      bot skill 0..1, default 0.8 ("kid")
     onHiScore  fn(score) called at game over when the score beats hiScore (main stores it)
   game.update(dt)  game.setKeys({left,right})  game.launchDown() / launchUp()  game.start()
   game.pause({silent}) / resume() / togglePause()   game.pointer(kind)   game.drainFx()   game.on(name, fn) -> off()
   game.world  game.table  game.state  game.debug  game.stats  game.bot

   Ten minute goodbye (SPEC 9.2): PM.Game.create({..., playLimitSeconds}) and game.state.limit
     playLimitSeconds  seconds of ACTIVE play (screen 'play', not paused) after which Pacman says goodbye. 0 = off, undefined =
                       CFG.PLAY_LIMIT_SECONDS (600), except with autoplay, where undefined means off (an explicit number is honoured)
     state.limit = {enabled, phase:'none'|'notice'|'last'|'goodbye', t, playSec, limitSec, poke, score, stars}
       phase 'none'     counting. playSec runs only while state.screen is 'play'; it survives game over and a new game
       phase 'notice'   playSec reached limitSec at a calm moment (mode 'live', no plunger charge, no running banner of priority 3 or
                        higher, no surprise about to start; after 5 s of waiting it starts anyway). Banner kind 'limit' (priority 3, or
                        4 when it had to wait; it lives exactly CFG.LIMIT_NOTICE_SECONDS, the badge phase removes it) and the voice
                        line limit_notice (priority 3). Then phase 'last'.
       phase 'last'     the ball in play (or the one waiting in the lane) is the last ball. No new ball is served, no extraball
                        surprise (another one takes its place), no new two-ball lock; two-ball play ends when every ball is gone;
                        the normal ball saver and the Pacman rescue still work. When the last ball is gone (or the normal five
                        balls end) the phase becomes 'goodbye' instead of a normal game over.
       phase 'goodbye'  state.screen === 'goodbye'. Score and hi-score are saved (onHiScore) exactly like a game over, stars 1..3
                        (also in limit.stars), banner and popups are cleared, no roaming delights. Voice: limit_goodbye (priority 3)
                        once no other voice line is speaking. Space or a tap does NOT start a game: limit.poke++ and a soft click;
                        the voice line limit_rest is asked for when at least 6 s passed since the last goodbye or rest line.
                        A parent reloads the page (F5) or opens it with ?perc=0 to play again.
       t counts UP seconds in the current phase (and keeps running in 'goodbye', paused time excluded); state.overT also counts in it.
       game.stats.limitLog collects {phase, t, playSec} for the tests.
       The limit is reached in the between-balls pause or the ending pause: no notice, no new ball, straight to goodbye after the
       normal short pause. Reached while a ball is waiting in the lane: that ball is the last ball.
     Pausing works in every phase including 'goodbye' (state.pausedFrom is 'play' or 'goodbye' while state.screen is 'paused'; resume
     goes back to it). game.on('limit', fn(phase)) fires on 'notice', 'last' and 'goodbye'; game.on('gameover') gets limit:true
     for the goodbye. game.debug: startLimit() (notice now), setPlaySeconds(n), finishLimit() (goodbye now),
     forceScreen('notice'|'last'|'goodbye').

   game.state: SPEC 4.2 plus these extensions (all optional for a renderer):
     time          seconds since create(); keeps running while paused (drive animations with it). Timers of the rules do not.
     power / surprise / banner / popups[i] / pacmanHelper: `t` counts UP (elapsed seconds) and `dur` is the total.
                   pacmanHelper {phase:'none'|'chomp'|'spit', t (seconds since the phase started), dur (length of the phase)}
     ballSave      seconds left (0 = off). launch {waiting, charge 0..1, idle}
     fruits        [{kind,x,y}] the three fruits of the fruits surprise (the game also adds them as sensors of kind 'fruit')
     combo         rapid bumper hit counter (0 when it timed out)
     mystery       {ready, cd}  the "?" target is ready when no surprise runs and the 20 s cooldown is over
     locked        null | {ballId,x,y}  a ball is locked in the ghost house waiting for the next launch (two-ball play)
     overT         seconds since the game over screen appeared. Star k (1-based) pops in at overT = OVER_STAR_T0 + (k-1)*OVER_STAR_DT
     delights      [{id,kind:'pacman'|'ghost',x,y,dir,size,t,dur,color,side}] roaming backdrop friends, x and y are 0..1 of the
                   whole screen (they may start outside, x from about -0.08 to 1.08), size = fraction of the screen height
     banner.icon   'space' 'arrows' 'pacman' 'star' 'heart' 'house' 'tunnel' 'question' 'power' 'multiball' 'crown', a surprise
                   id ('bigflip' ... 'extraball'), 'fruit:<kind>' or 'ghost:<color>'; banner.pri / banner.min are the priority
                   and the minimum seconds on screen (a banner is never cut earlier by one of equal or lower priority)
     ghosts[i]     also has dizzyT / giggleT / happyT (private timers, ignore them)
   Banner kinds: ready ball last_ball drain save (Pacman rescue) power mystery surprise multiball multiball_end lock
   house tunnel mult lanes level fruit combo praise record hint nudge. Voice categories and sfx names are exactly the ones in
   SPEC 4.5. game.stats collects counters for the tests (voice calls by category and priority, sfx counts, banners, surprises).
   game.on(name, fn): 'screen'(new, old) 'gameover'({score,stars,newRecord}) 'power'(bool) 'surprise'(id, started) 'multiball'(bool)
   'ui'(kind: sound|music|fullscreen, from pointer()). */
(function (g) {
  'use strict';
  const PM = g.PM = g.PM || {};
  const CFG = PM.CFG;
  const U = PM.util;
  const clamp = U.clamp;
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------------------------------------------------
  // tuning (everything a designer might want to change lives here)
  const TUNE = {
    chargeSeconds: 1.1,      // Space held this long = full plunger pull
    fullHold: 0.45,          // a plunger held at full pull fires by itself after this long (a child may never let go)
    tapCharge: 0.1,          // a press shorter than this (about 0.11 s) is a tap: a soft launch that varies from lane to lane
    stragglerAfter: 20,      // seconds of play without eating a dot before a last dot hops to an easy spot
    stragglerDots: 6,        // ... when this few dots are left
    firstHintAfter: 9,       // seconds a waiting ball may idle before the launch hint (first ball: welcome + howto talk first)
    hintAfter: 6,
    hintEvery: 14,
    flipperIdleHint: 10,     // seconds with a ball in play and no flipper key pressed
    quickDrain: 8,           // a ball that drains this soon after its launch counts as a quick drain
    quickStreak: 3,          // this many in a row: the next ball gets the long saver
    betweenBalls: 2.0,       // pause between a lost ball and the next one
    endingPause: 1.5,        // pause between the last lost ball and the game over screen
    chompSeconds: 0.85,      // Pacman rescue: chomp, then spit
    spitSeconds: 0.65,
    lockTimeout: 30,         // a locked ball is freed anyway after this long without a launch
    fruitStay: 25,
    dizzySeconds: 3,
    comboWindow: 2,
    surpriseDelay: 1.7,      // "Meglepetes!" first (a banner needs 1.6 s), then the surprise itself
    bigflipScale: 1.35,
    slowGravity: 0.6,
    afterSurpriseSave: 6,    // ball saver top-up when a surprise ends (the toy going away must not cost a ball)
    bannerMin: 1.6,
    chatterGap: 5,           // priority 0 and 1 voice lines: one per 5 s at most
    chatterPerMinute: 6,
    overLock: 1.0,           // over screen: Space restarts after overLock + 0.65 per star (so mashing cannot skip the stars)
    limitWaitMax: 5,         // the "you played a lot" notice waits at most this long for a calm moment
    goodbyeVoiceAt: 0.6,     // goodbye screen: the spoken goodbye starts this long after the screen appeared
    goodbyeVoiceWait: 12,    // ... and waits at most this long for a voice line that is still speaking
    limitRestGap: 6          // goodbye screen: a poke asks for "limit_rest" at most this often (seconds)
  };
  const OVER_STAR_T0 = 0.6, OVER_STAR_DT = 0.65;      // the renderer pops the stars in on the same schedule

  // Star thresholds (calibrated with tests/game_test.js: bot skill 0.8 "kid" usually gets 2 stars, a strong run 3).
  const STARS = { two: 12000, three: 70000 };
  const PRAISE_AT = [6000, 20000, 40000, 70000, 100000, 150000];

  const PTS = { dot: 10, pellet: 100, bumper: 100, sling: 10, spinner: 25, lane: 100, house: 500, tunnel: 250, balloon: 200,
    mystery: 100, levelClear: 1000, lanesMax: 1000 };
  const CHAIN = [200, 400, 800, 1600];
  const COMBO_BONUS = { 3: 300, 5: 500, 10: 1000 };

  const COL = { gold: '#FFD84A', cream: '#FFF6E0', red: '#FF6B6B', pink: '#FF9ECB', cyan: '#6FDCF0', orange: '#FFB45C',
    mint: '#8EE3A9', lilac: '#B79BFF' };
  const BALLOON_COLORS = ['#FF6B6B', '#FF9ECB', '#6FDCF0', '#FFB45C', '#FFD84A', '#8EE3A9', '#B79BFF'];
  // banner icons: the renderer knows the surprise ids and draws its own art for them
  const SURPRISE_ICON = { bigflip: 'bigflip', slow: 'slow', balloons: 'balloons', fruits: 'fruits', dance: 'dance', shield: 'shield',
    extraball: 'extraball' };
  const SURPRISE_DUR = { shield: 20, extraball: 3.5 };
  const BANNER_PRI = {
    surprise: 3, save: 3, last_ball: 3, multiball: 3, limit: 3,
    mystery: 3, power: 2, level: 2, mult: 2, lanes: 2, lock: 2, fruit: 2, ball: 2, drain: 2, record: 2, ready: 2,
    combo: 1, tunnel: 1, house: 1, nudge: 1, power_end: 1, multiball_end: 1, hint: 1, praise: 1, balloons: 1
  };
  // Game side mirror of the audio cooldowns (seconds), so the game itself never asks for more than the engine would play.
  const COOL = { dots_nyam: 25, spinner: 15, ghost_piri: 8, ghost_rozi: 8, ghost_kiki: 8, ghost_nori: 12, ghost_bonk: 20, launch: 20,
    praise: 30, hint_launch: 12, hint_flippers: 20, tunnel: 30, hole_enter: 20, combo: 10, nudge: 15, pellet: 45, power_end: 30,
    balloon_pop: 8, surprise_end: 30, star: 6, drain: 4, pause: 2, resume: 2, mystery: 8, lock_ball: 8, multiball_end: 8,
    lane_done: 6, mult: 6, fruit: 4, level_clear: 4, play_again: 10, ball_ready: 4 };
  const cooldownOf = (cat) => {
    if (COOL[cat] !== undefined) return COOL[cat];
    const k = cat.replace(/_[a-z0-9]+$/, '');
    return COOL[k] !== undefined ? COOL[k] : 0;
  };

  // Launch power map (see 20_physics.js): taps land softly in lane 3, 2 or 1 (r is a random draw 0..1, so a child who taps
  // lights every lane in time), holds ride further: 0.2 (house) up to 1 (all the way round the arch).
  const powerFor = (c, r) => (c < TUNE.tapCharge ? 0.02 + (r === undefined ? 0.5 : r) * 0.36 : 0.2 + 0.8 * (clamp(c, 0, 1) - TUNE.tapCharge) / (1 - TUNE.tapCharge));
  // Where a straggler dot may hop to: open floor on the busy central fall line, clear of every other feature.
  const EASY_SPOTS = [[264, 610], [230, 636], [298, 636], [264, 664], [200, 656], [328, 656], [232, 590], [296, 590]];
  const fmt = (s, n) => String(s).replace('{n}', n);

  function create(opts) {
    opts = opts || {};
    const seed = (Number(opts.seed) >>> 0) || 1;
    const rng = U.rng((seed ^ 0x9E3779B1) >>> 0);
    const table = PM.Table.build();
    const world = new PM.Physics.World(table, { rng: U.rng(seed) });
    const REST_Y = table.plunger.restY;
    const HOUSE = table.holes[0];
    const listeners = {};
    // seconds of active play until the goodbye: an explicit number wins (0 = off), otherwise the config, but a bot plays for long
    const limitSec = (() => {
      const v = opts.playLimitSeconds;
      const n = v === undefined || v === null ? (opts.autoplay ? 0 : CFG.PLAY_LIMIT_SECONDS) : Number(v);
      return n > 0 && isFinite(n) ? n : 0;
    })();

    // ------------------------------------------------------------------------------------------------------
    // public state
    const S = {
      screen: 'title', time: 0, score: 0, hiScore: Math.max(0, Number(opts.hiScore) || 0), newRecord: false,
      ballNo: 1, ballsTotal: CFG.BALLS_PER_GAME, ballsLeft: CFG.BALLS_PER_GAME - 1,
      multiplier: 1, lanes: [false, false, false], level: 1, dotsLeft: table.stats.dots, dotsTotal: table.stats.dots,
      power: null, surprise: null, ballSave: 0, multiball: false,
      launch: { waiting: false, charge: 0, idle: 0 },
      keys: { left: false, right: false, space: false },
      ghosts: table.bumpers.map((b) => ({ id: b.id, bumperId: b.id, color: b.color, x: b.x, y: b.y, r: b.r, mood: 'normal', hit: 0,
        lookX: 0, lookY: 0.3 })),
      nori: { x: table.spots.noriPeek.x, y: table.spots.noriPeek.y, mood: 'normal', visible: false },
      pacmanHelper: { phase: 'none', t: 0, dur: 0 },
      banner: null, popups: [], fruitTray: [], fruit: null, balloons: [], stars: 0,
      ui: { muted: false, musicOn: true, touch: false },
      // extensions
      fruits: [], combo: 0, mystery: { ready: true, cd: 0 }, locked: null, overT: 0, delights: [],
      // ten minute goodbye (SPEC 9.2)
      limit: { enabled: limitSec > 0, phase: 'none', t: 0, playSec: 0, limitSec: limitSec, poke: 0, score: 0, stars: 0 },
      pausedFrom: ''
    };
    const L = S.limit;
    const ghostById = {};
    for (const gh of S.ghosts) ghostById[gh.id] = gh;

    // private game data
    const G = {
      clock: 0,                 // game clock: runs only while the game is not paused (rules use this, not S.time)
      timers: [], mode: 'idle', // mode: idle | live | rescue | between | ending | over
      modeT: 0,
      charging: false, spaceConsumed: false, autoFire: -1, chargeTick: 0, fullT: 0,
      gen: 0,
      hiBase: S.hiScore, houseEntries: 0, dotsEaten: 0, dotOn: new Map(),
      lastLaunchAt: 0, rescuesThisBall: 0, quickStreak: 0, nextSaver: CFG.BALL_SAVE_SECONDS,
      chain: 0, lastBumpAt: -99, lanesLocked: false,
      locked: null, pendingSurprise: null, savedParams: null, bag: null, extraGiven: false,
      dotHome: new Map(), straggleT: 0, spotIdx: 0,
      fruitLeft: 0, balloonPops: 0, spinAcc: 0, spinQuiet: 0, spinTicks: 0, spinX: 0, spinY: 0,
      hintNext: 0, flipIdle: 0, flipHintAt: -99,
      noriIn: 10, noriHide: 0, noriTalk: false, delightIn: 6, delightId: 1, praiseIdx: 0, recordShown: false,
      bq: [], bannerLast: {}, lastSay: {}, lastChatter: -99, chatterLog: [], fx: [],
      laneSlow: new Map(), lostT: 0, firstGame: true,
      bot: null, autoT: 0, overLock: 0,
      limitWait: 0, restAt: -99, pausedFrom: ''
    };
    const stats = {
      voice: { calls: 0, byCat: {}, byPri: [0, 0, 0, 0], log: [] }, sfx: {}, banners: {}, surprises: {}, rescues: 0, multiballs: 0,
      levelClears: 0, stuck: 0, lives: 0, games: 0, maxPopups: 0, maxFx: 0, records: 0, lifeLog: [], limitLog: []
    };
    const inp = { left: false, right: false };
    const NONE = { left: false, right: false };

    if (opts.autoplay) G.bot = PM.Bot.create(world, { skill: opts.skill === undefined ? 0.8 : opts.skill, seed: (seed * 7 + 3) >>> 0 });

    // ------------------------------------------------------------------------------------------------------
    // small services: audio (read at call time), events, timers, fx, popups, banners
    function sfx(name, o) {
      stats.sfx[name] = (stats.sfx[name] || 0) + 1;
      const A = PM.Audio;
      if (A && A.sfx) A.sfx(name, o);
    }

    // One place where the game asks for a voice line. Lines with priority 0 and 1 are chatter: they get a gap, a per minute
    // budget and a per category cooldown here, so the game itself never nags (the audio engine has its own limits too).
    function say(cat, pri, force) {
      if (pri === undefined) pri = 1;
      const now = S.time;
      if (!force && pri < 3) {
        const cd = cooldownOf(cat);
        if (cd > 0 && now - (G.lastSay[cat] === undefined ? -99 : G.lastSay[cat]) < cd) return false;
        if (pri <= 1) {
          if (now - G.lastChatter < TUNE.chatterGap) return false;
          const w = G.chatterLog;
          while (w.length && now - w[0] > 60) w.shift();
          if (w.length >= TUNE.chatterPerMinute) return false;
        }
      }
      G.lastSay[cat] = now;
      if (pri <= 1) { G.lastChatter = now; G.chatterLog.push(now); }
      const v = stats.voice;
      v.calls++; v.byCat[cat] = (v.byCat[cat] || 0) + 1; v.byPri[pri]++;
      if (v.log.length < 4000) v.log.push({ t: S.time, cat: cat, pri: pri });
      const A = PM.Audio;
      return !!(A && A.voice && A.voice(cat, { priority: pri, force: !!force }));
    }

    function emit(name, a, b) {
      const l = listeners[name];
      if (!l) return;
      for (const fn of l.slice()) {
        try { fn(a, b); } catch (err) { if (typeof console !== 'undefined') console.error('[PM.Game] listener error', err); }
      }
    }

    function later(delay, fn) { G.timers.push({ at: G.clock + delay, fn: fn, gen: G.gen }); }
    function runTimers() {
      const ts = G.timers;
      for (let i = 0; i < ts.length;) {
        if (ts[i].at <= G.clock) { const t = ts.splice(i, 1)[0]; if (t.gen === G.gen) t.fn(); } else i++;
      }
    }

    function fx(type, x, y, color, n) {
      if (G.fx.length >= 24) return;
      G.fx.push({ type: type, x: x, y: y, color: color || COL.gold, n: n || 6 });
      if (G.fx.length > stats.maxFx) stats.maxFx = G.fx.length;
    }
    function drainFx() { const o = G.fx; G.fx = []; return o; }

    function popup(x, y, text, color, dur) {
      if (S.popups.length >= 8) S.popups.shift();
      S.popups.push({ x: x, y: y, text: String(text), t: 0, dur: dur || 1.2, color: color || COL.cream });
      if (S.popups.length > stats.maxPopups) stats.maxPopups = S.popups.length;
    }

    // Banner queue: one banner at a time, at least `min` seconds on screen, a higher priority one may take over at once,
    // an equal or lower one waits its turn (and is dropped when it waited too long). Voice and banner start together.
    function announce(kind, text, sub, icon, o) {
      o = o || {};
      const pri = o.pri === undefined ? (BANNER_PRI[kind] || 1) : o.pri;
      if (o.gap && S.time - (G.bannerLast[kind] === undefined ? -99 : G.bannerLast[kind]) < o.gap) return false;
      const e = { kind: kind, text: text, sub: sub || '', icon: icon || '', pri: pri, dur: o.dur || 2.2, min: o.min || TUNE.bannerMin,
        voice: o.voice || null, vpri: o.vpri, born: G.clock, ttl: o.ttl || 3.5, sfx: o.sfx || null };
      const cur = S.banner;
      for (let i = 0; i < G.bq.length; i++) if (G.bq[i].kind === kind) { G.bq[i] = e; return true; }
      if (!cur) { startBanner(e); return true; }
      if (cur.kind === kind) { if (pri >= cur.pri) startBanner(e); return true; }
      if (pri > cur.pri) { startBanner(e); return true; }
      G.bq.push(e);
      G.bq.sort((a, b) => b.pri - a.pri || a.born - b.born);
      if (G.bq.length > 3) G.bq.pop();
      return true;
    }
    function startBanner(e) {
      S.banner = { kind: e.kind, text: e.text, sub: e.sub, icon: e.icon, t: 0, dur: e.dur, pri: e.pri, min: e.min };
      G.bannerLast[e.kind] = S.time;
      stats.banners[e.kind] = (stats.banners[e.kind] || 0) + 1;
      if (e.voice) say(e.voice, e.vpri === undefined ? 2 : e.vpri);
      if (e.sfx) sfx(e.sfx);
    }
    function updateBanner(dt) {
      const b = S.banner;
      if (b) b.t += dt;
      if (b && !(b.t >= b.dur || (G.bq.length && b.t >= b.min))) return;
      S.banner = null;
      while (G.bq.length) {
        const e = G.bq.shift();
        if (G.clock - e.born <= e.ttl) { startBanner(e); return; }
      }
    }

    // ------------------------------------------------------------------------------------------------------
    // scoring
    function addScore(base, o) {
      o = o || {};
      const pts = Math.round(base * (o.noMult ? 1 : S.multiplier));
      if (pts <= 0) return 0;
      S.score += pts;
      S.hiScore = Math.max(G.hiBase, S.score);
      S.newRecord = G.hiBase > 0 && S.score > G.hiBase;
      if (o.popup !== false && o.x !== undefined) popup(o.x, o.y, o.text || '+' + pts, o.color, o.dur);
      if (S.newRecord && !G.recordShown) {
        G.recordShown = true; stats.records++;
        announce('record', PM.T.record.text, PM.T.record.sub, 'crown', { voice: 'newrecord', vpri: 2, sfx: 'highscore' });
      }
      while (G.praiseIdx < PRAISE_AT.length && S.score >= PRAISE_AT[G.praiseIdx]) {
        G.praiseIdx++;
        const list = PM.T.praise_list || [PM.T.praise.text];
        announce('praise', list[rng.int(list.length)], '', 'star', { voice: 'praise', vpri: 1 });
      }
      return pts;
    }

    // ------------------------------------------------------------------------------------------------------
    // ball helpers
    const isResting = (b) => b.state === 'lane' && b.y >= REST_Y - 2 && Math.abs(b.vy) < 25;
    function waitingBall() {
      for (const b of world.balls) if (isResting(b)) return b;
      return null;
    }
    function aliveBalls() {
      let n = 0;
      for (const b of world.balls) if (b.state !== 'drained') n++;
      return n;
    }
    function activeBalls() {
      let n = 0;
      for (const b of world.balls) {
        if (b.state === 'play' || b.state === 'held') n++;
        else if (b.state === 'lane' && !isResting(b)) n++;
      }
      return n;
    }
    function ghostColorHex(gh) { return COL[gh.color] || COL.cream; }

    function spawnLaneBall() {
      const b = world.spawnBall();
      S.launch.idle = 0;
      G.hintNext = TUNE.hintAfter;
      G.flipIdle = 0;
      return b;
    }

    // ------------------------------------------------------------------------------------------------------
    // new game / new ball
    function resetGhosts() {
      for (const gh of S.ghosts) { gh.mood = 'normal'; gh.hit = 0; gh.dizzyT = 0; gh.giggleT = 0; gh.happyT = 0; }
    }

    function newGame() {
      G.gen++;
      G.timers.length = 0;
      world.reset();
      stats.games++;
      G.clock = 0; G.mode = 'live'; G.modeT = 0;
      S.screen = 'play'; S.score = 0; S.newRecord = false; S.hiScore = G.hiBase;
      S.ballNo = 1; S.ballsTotal = CFG.BALLS_PER_GAME; S.ballsLeft = S.ballsTotal - 1;
      S.multiplier = 1; S.lanes[0] = S.lanes[1] = S.lanes[2] = false;
      S.level = 1; S.dotsTotal = table.stats.dots; S.dotsLeft = S.dotsTotal;
      S.power = null; S.surprise = null; S.ballSave = 0; S.multiball = false;
      S.launch.waiting = false; S.launch.charge = 0; S.launch.idle = 0;
      S.nori.visible = false; S.nori.mood = 'normal';
      S.pacmanHelper.phase = 'none'; S.pacmanHelper.t = 0; S.pacmanHelper.dur = 0;
      S.banner = null; S.popups.length = 0; S.fruitTray.length = 0; S.fruit = null; S.balloons.length = 0; S.fruits.length = 0;
      S.stars = 0; S.combo = 0; S.mystery.ready = true; S.mystery.cd = 0; S.locked = null; S.overT = 0;
      resetGhosts();
      G.dotOn.clear(); G.dotHome.clear(); G.straggleT = 0;
      for (const s of world.sensors) if (s.kind === 'dot') { G.dotOn.set(s.id, true); G.dotHome.set(s.id, { x: s.x, y: s.y }); }
      G.houseEntries = 0; G.dotsEaten = 0; G.rescuesThisBall = 0; G.quickStreak = 0; G.nextSaver = CFG.BALL_SAVE_SECONDS;
      G.chain = 0; G.lastBumpAt = -99; G.lanesLocked = false; G.locked = null; G.pendingSurprise = null; G.savedParams = null;
      G.bag = U.bag(CFG.SURPRISES, rng);
      G.extraGiven = false; G.fruitLeft = 0; G.balloonPops = 0;
      G.bq.length = 0; G.chatterLog.length = 0; G.fx.length = 0; G.laneSlow.clear();
      G.praiseIdx = 0; G.recordShown = false; G.charging = false; G.spaceConsumed = S.keys.space; G.autoFire = -1;
      G.noriIn = 8 + rng() * 6; G.noriHide = 0; G.flipHintAt = -99; G.lostT = 0; G.spinAcc = 0; G.spinTicks = 0;
      G.lastLaunchAt = 0; G.limitWait = 0;
      applyInput();
      spawnLaneBall();
      S.launch.waiting = true;
    }

    function start() {
      if (S.screen !== 'title' && S.screen !== 'over') return false;
      const fromOver = S.screen === 'over';
      if (fromOver && G.clock < G.overLock) return false;
      if (fromOver) { const A = PM.Audio; if (A && A.stopVoice) A.stopVoice(); }
      newGame();
      if (!fromOver && G.firstGame) G.hintNext = TUNE.firstHintAfter;      // the welcome and howto lines talk first
      G.firstGame = false;
      emit('screen', 'play', fromOver ? 'over' : 'title');
      // Audio may still be waking up in the very first key press, so the first lines follow a moment later.
      later(0.3, () => sfx('game_start'));
      later(0.5, () => {
        if (fromOver) say('ball_ready', 2);
        else { say('welcome', 3); say('howto', 2); }
      });
      const rd = S.ui.touch ? PM.T.ready_touch : PM.T.ready;
      announce('ready', rd.text, rd.sub, 'space', { dur: 3.6 });
      return true;
    }

    function nextBall() {
      if (limitStop()) { gameOver(); return; }               // the time is up: no new ball, Pacman says goodbye
      S.ballNo++; S.ballsLeft = Math.max(0, S.ballsLeft - 1);
      G.mode = 'live'; G.modeT = 0;
      G.rescuesThisBall = 0;
      if (G.quickStreak >= TUNE.quickStreak) { G.nextSaver = CFG.KIND_BALL_SAVE_SECONDS; G.quickStreak = 0; } else G.nextSaver = CFG.BALL_SAVE_SECONDS;
      spawnLaneBall();
      S.launch.waiting = true;
      if (S.ballsLeft === 0) announce('last_ball', PM.T.last_ball.text, PM.T.last_ball.sub, 'heart', { voice: 'last_ball', vpri: 3 });
      else announce('ball', fmt(PM.T.ball_n.text, S.ballNo), PM.T.ball_n.sub, 'pacman', { voice: 'ball_' + S.ballNo, vpri: 2 });
    }

    // ------------------------------------------------------------------------------------------------------
    // plunger and launch
    function applyInput() {
      const p = S.screen === 'paused' ? NONE : S.keys;
      inp.left = p.left; inp.right = p.right;
      world.setInput(inp);
    }

    function setFlipKeys(l, r) {
      let press = false;
      if (l !== S.keys.left) {
        S.keys.left = l;
        if (S.screen === 'play') sfx(l ? 'flipper_up' : 'flipper_down', { pan: -0.45, x: 150 });
        if (l) press = true;
      }
      if (r !== S.keys.right) {
        S.keys.right = r;
        if (S.screen === 'play') sfx(r ? 'flipper_up' : 'flipper_down', { pan: 0.45, x: 350 });
        if (r) press = true;
      }
      if (press) G.flipIdle = 0;
      applyInput();
    }
    function setKeys(k) { setFlipKeys(!!(k && k.left), !!(k && k.right)); }

    function cancelCharge() {
      G.charging = false; G.autoFire = -1; G.fullT = 0;
      S.launch.charge = 0;
      world.setPlunger(0);
    }

    function launchDown() {
      if (S.screen === 'goodbye') {                              // the goodbye is final: Space (or a tap) only pokes Pacman
        if (!S.keys.space) poke();
        S.keys.space = true; G.spaceConsumed = true;
        return;
      }
      if (S.screen === 'title' || S.screen === 'over') { S.keys.space = true; G.spaceConsumed = true; start(); return; }
      if (S.screen === 'paused') { S.keys.space = true; G.spaceConsumed = true; resume(); return; }
      if (S.screen !== 'play' || S.keys.space) return;
      S.keys.space = true;
      G.spaceConsumed = false;
      if (S.launch.waiting && !G.charging) {
        G.charging = true; G.fullT = 0; G.chargeTick = 0;
        S.launch.charge = 0; S.launch.idle = 0;
        sfx('plunger_charge', { rate: 0.85 });
      }
    }

    function launchUp() {
      S.keys.space = false;
      if (G.spaceConsumed) { G.spaceConsumed = false; return; }
      if (S.screen === 'play' && G.charging) fire();
    }

    function fire() {
      const c = S.launch.charge;
      G.charging = false; G.autoFire = -1; G.fullT = 0;
      const b = world.launch(powerFor(c, rng()));
      S.launch.charge = 0;
      if (b) sfx('plunger_release', { rate: 0.9 + c * 0.25 });
      // The rest of a long press after an automatic launch must not fire the next ball.
      G.spaceConsumed = S.keys.space;
    }

    function updateCharge(dt) {
      if (G.charging && !S.launch.waiting) cancelCharge();
      if (G.charging) {
        S.launch.charge = Math.min(1, S.launch.charge + dt / TUNE.chargeSeconds);
        world.setPlunger(S.launch.charge);
        G.chargeTick += dt;
        if (G.chargeTick >= 0.22 && S.launch.charge < 1) { G.chargeTick = 0; sfx('plunger_charge', { rate: 0.85 + 0.5 * S.launch.charge }); }
        if (G.autoFire >= 0 && S.launch.charge >= G.autoFire) { G.autoFire = -1; launchUp(); return; }
        if (S.launch.charge >= 1) { G.fullT += dt; if (G.fullT >= TUNE.fullHold) fire(); }
      }
    }

    // ------------------------------------------------------------------------------------------------------
    // pause
    // Pause works in play and on the goodbye screen (nothing is lost: resume goes back to where it came from).
    function pause(o) {
      if (S.screen !== 'play' && S.screen !== 'goodbye') return false;
      const from = S.screen;
      if (G.charging) cancelCharge();
      if (S.keys.space) G.spaceConsumed = true;
      G.pausedFrom = S.pausedFrom = from;
      S.screen = 'paused';
      applyInput();
      emit('screen', 'paused', from);
      if (!(o && o.silent)) { sfx('pause'); if (from === 'play') say('pause', 1); }      // the goodbye stays quiet
      return true;
    }
    function resume(o) {
      if (S.screen !== 'paused') return false;
      const to = G.pausedFrom === 'goodbye' ? 'goodbye' : 'play';
      G.pausedFrom = S.pausedFrom = '';
      S.screen = to;
      applyInput();
      emit('screen', to, 'paused');
      if (!(o && o.silent)) { sfx('unpause'); if (to === 'play') say('resume', 1); }
      return true;
    }
    function togglePause() { return S.screen === 'paused' ? resume() : pause(); }

    function pointer(kind) {
      if (kind === 'pause') togglePause();
      else emit('ui', kind);
    }

    // ------------------------------------------------------------------------------------------------------
    // physics events
    function handleEvents(evs) {
      let drains = 0;
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        switch (e.t) {
          case 'sensor': onSensor(e); break;
          case 'bumper': onBumper(e); break;
          case 'sling': onSling(e); break;
          case 'spinner': onSpinner(e); break;
          case 'target': onTarget(e); break;
          case 'hole': onHole(e); break;
          case 'holeEject': sfx('hole_eject', { x: HOUSE.x }); break;
          case 'tunnel': onTunnel(e); break;
          case 'launch': onLaunch(e); break;
          case 'wall': onWall(e); break;
          case 'ballBall': sfx('post', { vol: 0.4 }); break;
          case 'stuck': onStuck(e); break;
          case 'drain': drains++; break;
          default: break;
        }
      }
      if (drains) onDrains();
    }

    function onWall(e) {
      const vol = clamp((e.speed - 200) / 800, 0.15, 0.7);
      if (e.kind === 'post' || e.kind === 'rubber') sfx('post', { x: e.x, vol: vol });
      else sfx('wall_soft', { x: e.x, vol: vol });
    }

    function onSensor(e) {
      switch (e.kind) {
        case 'dot': onDot(e); break;
        case 'pellet': onPellet(e); break;
        case 'lane': onLane(e); break;
        case 'fruit': onFruit(e); break;
        case 'balloon': onBalloon(e); break;
        default: break;
      }
    }

    function onDot(e) {
      if (!G.dotOn.get(e.id)) return;
      G.dotOn.set(e.id, false);
      world.setSensorActive(e.id, false);
      S.dotsLeft = Math.max(0, S.dotsLeft - 1);
      G.dotsEaten++; G.straggleT = 0;
      addScore(PTS.dot, { popup: false });
      sfx('dot', { x: e.x });
      if (G.dotsEaten % 9 === 0) say('dots_nyam', 0);
      if (S.dotsLeft === 0) levelClear();
    }

    function levelClear() {
      S.level++;
      stats.levelClears++;
      const kind = CFG.FRUITS[(S.level - 2 + 60) % CFG.FRUITS.length];
      addScore(PTS.levelClear, { x: table.W / 2, y: 470, color: COL.gold });
      announce('level', PM.T.level_clear.text, PM.T.level_clear.sub, 'fruit:' + kind, { voice: 'level_clear', vpri: 2, dur: 2.8 });
      sfx('level_up');
      fx('confetti', table.W / 2, 300, COL.gold, 16);
      happyGhosts(2.0);
      later(1.8, () => {
        for (const s of world.sensors) {
          if (s.kind !== 'dot') continue;
          const home = G.dotHome.get(s.id);
          if (home) world.moveSensor(s.id, home.x, home.y);
          world.setSensorActive(s.id, true); G.dotOn.set(s.id, true);
        }
        S.dotsLeft = S.dotsTotal; G.straggleT = 0;
        spawnFruit(kind);
      });
    }

    function spawnFruit(kind) {
      kind = kind || CFG.FRUITS[(S.level - 2 + 60) % CFG.FRUITS.length];
      S.fruit = { kind: kind, x: table.spots.fruit.x, y: table.spots.fruit.y };
      world.setSensorActive('fruit', true);
      G.fruitLeft = TUNE.fruitStay;
      fx('sparkle', S.fruit.x, S.fruit.y, COL.gold, 6);
    }
    function clearFruit() {
      S.fruit = null;
      world.setSensorActive('fruit', false);
      G.fruitLeft = 0;
    }

    function collectFruit(kind, x, y) {
      const pts = addScore(CFG.FRUIT_POINTS[kind] || 300, { x: x, y: y - 24, color: COL.gold, dur: 1.5 });
      S.fruitTray.push(kind);
      if (S.fruitTray.length > 10) S.fruitTray.shift();
      sfx('fruit', { x: x });
      announce('fruit', (PM.T.fruit[kind] || kind) + '!', '+' + pts, 'fruit:' + kind, { voice: 'fruit_' + kind, vpri: 2 });
      fx('sparkle', x, y, COL.gold, 8);
      happyGhosts(1.4);
    }

    function onFruit(e) {
      if (e.id === 'fruit') {
        if (!S.fruit) return;
        const kind = S.fruit.kind;
        collectFruit(kind, S.fruit.x, S.fruit.y);
        clearFruit();
        return;
      }
      // fruits surprise: three sensors of kind 'fruit'
      const i = S.fruits.findIndex((f) => f.id === e.id);
      if (i < 0) return;
      const f = S.fruits[i];
      collectFruit(f.kind, f.x, f.y);
      S.fruits.splice(i, 1);
      world.removeSensor(e.id);
      if (S.surprise && S.surprise.id === 'fruits' && S.fruits.length === 0) finishSurpriseSoon();
    }

    function onPellet(e) {
      world.setSensorActive(e.id, false);
      addScore(PTS.pellet, { x: e.x, y: e.y - 18 });
      sfx('pellet', { x: e.x });
      startPower(e.x, e.y);
      const id = e.id;
      later(CFG.PELLET_RESPAWN, () => world.setSensorActive(id, true));
    }

    function startPower(x, y) {
      G.chain = 0;
      if (S.power) { S.power.t = 0; return; }
      S.power = { t: 0, dur: CFG.POWER_SECONDS };
      sfx('power_start');
      announce('power', PM.T.power.text, PM.T.power.sub, 'power', { voice: 'pellet', vpri: 2, gap: 25 });
      fx('ring', x === undefined ? table.W / 2 : x, y === undefined ? 400 : y, COL.cyan, 1);
      emit('power', true);
    }
    function endPower(silent) {
      if (!S.power) return;
      S.power = null; G.chain = 0;
      emit('power', false);
      if (silent) return;
      sfx('power_end');
      say('power_end', 1);                       // no banner: the timer chip going away says it already
    }

    function onLane(e) {
      const i = parseInt(e.id.slice(4), 10) - 1;
      if (!(i >= 0 && i < 3) || S.lanes[i] || G.lanesLocked) return;
      S.lanes[i] = true;
      addScore(PTS.lane, { x: e.x, y: e.y + 26 });
      const lit = S.lanes[0] + S.lanes[1] + S.lanes[2];
      sfx('lane_light', { rate: [1, 1.125, 1.25][lit - 1] || 1, x: e.x });
      fx('sparkle', e.x, e.y, COL.gold, 3);
      if (lit === 3) lanesComplete();
    }

    function lanesComplete() {
      G.lanesLocked = true;
      sfx('lane_complete');
      fx('confetti', table.upperX, 110, COL.gold, 12);
      if (S.multiplier < 5) {
        S.multiplier++;
        announce('mult', fmt(PM.T.mult.text, S.multiplier), PM.T.mult.sub, 'star', { voice: 'mult_' + S.multiplier, vpri: 2 });
      } else {
        addScore(PTS.lanesMax, { x: table.upperX, y: 150, color: COL.gold });
        announce('lanes', PM.T.lanes_done.text, PM.T.lanes_done.sub, 'star', { voice: 'lane_done', vpri: 2 });
      }
      happyGhosts(1.6);
      later(1.0, () => { S.lanes[0] = S.lanes[1] = S.lanes[2] = false; G.lanesLocked = false; });
    }

    function onBumper(e) {
      const gh = ghostById[e.id];
      if (!gh) return;
      gh.hit = 1;
      if (G.clock - G.lastBumpAt <= TUNE.comboWindow) S.combo++; else S.combo = 1;
      G.lastBumpAt = G.clock;
      const dance = S.surprise && S.surprise.id === 'dance' ? 2 : 1;
      if (gh.mood === 'blue') {
        const pts = CHAIN[Math.min(G.chain, CHAIN.length - 1)] * dance;
        G.chain++;
        gh.dizzyT = TUNE.dizzySeconds;
        gh.mood = 'dizzy';
        addScore(pts, { x: gh.x, y: gh.y - gh.r - 8, color: COL.gold, dur: 1.5 });
        sfx('ghost_bonk', { x: gh.x });
        say('ghost_bonk', 1);
        fx('stars', gh.x, gh.y - gh.r * 0.6, ghostColorHex(gh), 5);
      } else {
        addScore(PTS.bumper * dance, { x: gh.x, y: gh.y - gh.r - 6, color: ghostColorHex(gh) });
        sfx('bumper_' + gh.id, { x: gh.x, rate: 1 + Math.min(0.24, 0.03 * (S.combo - 1)) });
        gh.giggleT = 0.7;
        say('ghost_' + gh.id, 0);
        fx('pop', e.x, e.y, ghostColorHex(gh), 4);
      }
      if (COMBO_BONUS[S.combo]) {
        addScore(COMBO_BONUS[S.combo], { x: gh.x, y: gh.y + gh.r + 10, color: COL.gold, dur: 1.4 });
        announce('combo', fmt(PM.T.combo.text, S.combo), '', 'star', { voice: 'combo_' + S.combo, vpri: 1, dur: 1.9 });
      }
    }

    function onSling(e) {
      addScore(PTS.sling, { popup: false });
      const b = world.getBall(e.ballId);
      sfx('sling', { x: b ? b.x : (e.id === 'slingL' ? 100 : 400) });
    }

    function onSpinner(e) {
      const ticks = e.ticks || 1;
      const pts = addScore(PTS.spinner * ticks, { popup: false });
      G.spinAcc += pts; G.spinTicks += ticks; G.spinQuiet = 0;
      G.spinX = table.spots.spinner.x + 34; G.spinY = table.spots.spinner.y;
      sfx('spinner_tick', { rate: clamp(0.8 + (e.spin || 10) / 40, 0.8, 1.6), x: table.spots.spinner.x });
      if (G.spinTicks >= 8) say('spinner', 0);
    }

    function onTarget(e) {
      if (e.id !== 'mystery') return;
      sfx('target_hit', { x: table.spots.mystery.x });
      if (S.mystery.ready && !G.pendingSurprise) {
        let id = G.bag.next();
        if (id === 'extraball' && (G.extraGiven || limitStop())) id = G.bag.next();     // one gift ball per game, none once the time is up
        G.pendingSurprise = id;
        const gen = G.gen;
        announce('mystery', PM.T.mystery.text, PM.T.mystery.sub, 'question', { voice: 'mystery', vpri: 2, dur: 1.9, ttl: 1.0 });
        fx('sparkle', table.spots.mystery.x, table.spots.mystery.y, COL.lilac, 8);
        S.mystery.ready = false;
        later(TUNE.surpriseDelay, () => { if (gen === G.gen && G.pendingSurprise === id) beginSurprise(id); });
      } else {
        addScore(PTS.mystery, { x: table.spots.mystery.x - 40, y: table.spots.mystery.y, color: COL.lilac });
      }
    }

    function onHole(e) {
      G.houseEntries++;
      addScore(PTS.house, { x: HOUSE.x, y: HOUSE.y - 34, color: COL.gold });
      fx('ring', HOUSE.x, HOUSE.y, COL.cream, 1);
      const canLock = G.mode === 'live' && !S.multiball && !G.locked && G.houseEntries % 3 === 0 && aliveBalls() === 1 && !limitStop();
      if (canLock && world.lockBall(e.ballId)) {
        if (spawnLaneBall()) {
          G.locked = { ballId: e.ballId, t: 0 };
          S.locked = { ballId: e.ballId, x: HOUSE.x, y: HOUSE.y };
          S.launch.waiting = true;
          sfx('hole_enter', { x: HOUSE.x });
          sfx('giggle', { x: HOUSE.x });
          announce('lock', PM.T.lock.text, PM.T.lock.sub, 'house', { voice: 'lock_ball', vpri: 2, dur: 3.0 });
          noriPeek(2.4, true);
          return;
        }
        world.releaseBall(e.ballId);
      }
      sfx('hole_enter', { x: HOUSE.x });
      announce('house', PM.T.house.text, PM.T.house.sub, 'house', { voice: 'hole_enter', vpri: 1, gap: 15, dur: 1.9 });
    }

    function startMultiball() {
      if (!G.locked) return;
      const id = G.locked.ballId;
      G.locked = null; S.locked = null;
      world.releaseBall(id);
      S.multiball = true;
      stats.multiballs++;
      sfx('multiball_start');
      announce('multiball', PM.T.multiball.text, PM.T.multiball.sub, 'multiball', { voice: 'multiball', vpri: 3, dur: 2.8 });
      fx('confetti', HOUSE.x, HOUSE.y + 30, COL.gold, 10);
      happyGhosts(1.6);
      emit('multiball', true);
    }
    function endMultiball() {
      S.multiball = false;
      announce('multiball_end', PM.T.multiball_end.text, PM.T.multiball_end.sub, 'pacman', { voice: 'multiball_end', vpri: 1 });
      emit('multiball', false);
    }

    function onTunnel(e) {
      const to = table.spots.tunnelMouths[e.to];
      const from = table.spots.tunnelMouths[e.from];
      addScore(PTS.tunnel, { x: to.x + to.nx * 42, y: to.y - 22, color: COL.gold });
      sfx('tunnel_warp', { x: from.x });
      fx('ring', from.x, from.y, COL.cyan, 1);
      fx('ring', to.x, to.y, COL.cyan, 1);
      announce('tunnel', PM.T.tunnel.text, PM.T.tunnel.sub, 'tunnel', { voice: 'tunnel', vpri: 1, gap: 30, dur: 1.9 });
    }

    function onLaunch() {
      G.lastLaunchAt = G.clock;
      S.launch.idle = 0;
      say('launch', 0);
      if (G.locked) { startMultiball(); return; }
      const alone = aliveBalls() <= 1;
      if (alone && G.rescuesThisBall === 0 && S.ballSave < G.nextSaver) S.ballSave = G.nextSaver;
    }

    function onStuck(e) {
      const b = world.getBall(e.ballId);
      if (!b || b.state !== 'play') return;
      world.nudgeBall(e.ballId);
      stats.stuck++;
      announce('nudge', PM.T.nudge.text, PM.T.nudge.sub, 'sparkle', { voice: 'nudge', vpri: 1, gap: 12 });
    }

    // ------------------------------------------------------------------------------------------------------
    // drains, the Pacman rescue, lives
    function onDrains() {
      if (G.mode !== 'live') return;
      sfx('drain_soft');
      const alive = aliveBalls();
      if (alive > 0) {                                     // two-ball play: a drain costs nothing
        if (S.multiball && alive === 1) endMultiball();
        return;
      }
      lastBallGone();
    }

    const shieldOn = () => !!(S.surprise && S.surprise.id === 'shield');

    function lastBallGone() {
      stats.lifeLog.push(G.clock - G.lastLaunchAt);
      const quick = G.clock - G.lastLaunchAt < TUNE.quickDrain;
      G.quickStreak = quick ? G.quickStreak + 1 : 0;
      if (S.ballSave > 0 && (shieldOn() || G.rescuesThisBall < 1)) { startRescue(); return; }
      stats.lives++;
      resetBallEffects();
      if (S.ballsLeft > 0 && !limitStop()) {
        G.mode = 'between'; G.modeT = 0;
        announce('drain', PM.T.drain.text, PM.T.drain.sub, 'heart', { voice: 'drain', vpri: 2 });
      } else {
        G.mode = 'ending'; G.modeT = 0;
      }
    }

    function startRescue() {
      G.mode = 'rescue'; G.modeT = 0;
      if (!shieldOn()) { G.rescuesThisBall++; S.ballSave = 0; }
      stats.rescues++;
      const h = S.pacmanHelper;
      h.phase = 'chomp'; h.t = 0; h.dur = TUNE.chompSeconds;
      sfx('ballsave', { x: table.spots.pacmanHelper.x });
      announce('save', PM.T.ballsave.text, PM.T.ballsave.sub, 'pacman', { voice: 'ballsave', vpri: 3, dur: 2.8 });
      fx('chomp', table.spots.pacmanHelper.x, table.spots.pacmanHelper.y - 30, COL.gold, 6);
    }

    function updateRescue(dt) {
      const h = S.pacmanHelper;
      h.t += dt;
      if (h.phase === 'chomp' && h.t >= h.dur) {
        h.phase = 'spit'; h.t = 0; h.dur = TUNE.spitSeconds;
        spawnLaneBall();
        sfx('hole_eject', { x: table.plunger.x, vol: 0.7 });
      } else if (h.phase === 'spit' && h.t >= h.dur) {
        h.phase = 'none'; h.t = 0; h.dur = 0;
        G.mode = 'live';
        S.launch.idle = 0;
      }
    }

    // Everything that belongs to one ball ends with the ball.
    function resetBallEffects() {
      endPower(true);
      G.pendingSurprise = null;
      endSurprise(true);
      S.multiplier = 1; S.combo = 0; S.multiball = false; S.ballSave = 0;
      G.locked = null; S.locked = null; G.chain = 0;
      S.mystery.cd = 0; S.mystery.ready = true;
    }

    function gameOver() {
      const bye = limitStop();                     // the time is up: a warm goodbye instead of the normal game over
      G.mode = 'over';
      G.clock = 0; G.timers.length = 0;
      S.screen = bye ? 'goodbye' : 'over'; S.overT = 0;
      S.stars = S.score >= STARS.three ? 3 : (S.score >= STARS.two ? 2 : 1);
      S.newRecord = S.score > 0 && S.score > G.hiBase;
      if (S.newRecord) {
        G.hiBase = S.score; S.hiScore = S.score;
        if (typeof opts.onHiScore === 'function') { try { opts.onHiScore(S.score); } catch (err) { /* storage problems must not stop the game */ } }
      }
      G.overLock = TUNE.overLock + OVER_STAR_DT * S.stars;
      G.autoT = 0;
      cancelCharge();
      S.launch.waiting = false;
      for (const b of world.balls.slice()) world.removeBall(b.id);
      if (bye) { enterGoodbye(); return; }
      emit('screen', 'over', 'play');
      emit('gameover', { score: S.score, stars: S.stars, newRecord: S.newRecord });
      sfx('game_over');
      later(0.3, () => say('over', 3));
      for (let i = 0; i < S.stars; i++) later(OVER_STAR_T0 + OVER_STAR_DT * i, () => sfx('star_collect', { rate: 1 + 0.12 * i }));
      const tEnd = OVER_STAR_T0 + OVER_STAR_DT * S.stars + 1.2;
      later(tEnd, () => say('over_stars_' + S.stars, 3));
      let t2 = tEnd + 2.4;
      if (S.newRecord) { later(t2, () => { sfx('highscore'); say('newrecord', 3); }); t2 += 2.6; }
      later(t2, () => say('play_again', 2));
    }

    // ------------------------------------------------------------------------------------------------------
    // ten minute goodbye (SPEC 9.2). The counter runs in updatePlay only, so title, pause and game over never count.
    function limitEngaged() { return L.enabled && (L.phase === 'notice' || L.phase === 'last'); }
    function limitDue() { return L.enabled && L.phase === 'none' && L.playSec >= L.limitSec; }
    // From the moment the time is up (even before the notice could be shown): no new ball, no extra ball, no new two-ball lock.
    function limitStop() { return limitEngaged() || limitDue(); }

    function setLimitPhase(p) {
      L.phase = p; L.t = 0; G.limitWait = 0;
      if (p !== 'notice' && S.banner && S.banner.kind === 'limit') S.banner = null;        // the notice banner lives exactly as long as the notice
      stats.limitLog.push({ phase: p, t: S.time, playSec: L.playSec });
      emit('limit', p);
    }

    function beginNotice(pri) {
      setLimitPhase('notice');
      const tx = PM.T.limit_notice;
      announce('limit', tx.text, tx.sub, 'pacman', { pri: pri, dur: CFG.LIMIT_NOTICE_SECONDS, min: CFG.LIMIT_NOTICE_SECONDS,
        voice: 'limit_notice', vpri: 3, ttl: 1, sfx: 'nori_peek' });
    }

    function updateLimit(dt) {
      if (!L.enabled) return;
      L.playSec += dt;
      if (L.phase === 'none') {
        if (L.playSec < L.limitSec) return;
        // Only a ball in play (or waiting) gets the notice. After a rescue the ball is back in the lane and mode is 'live' again;
        // in the pauses between balls and before the ending nextBall() / gameOver() go straight to the goodbye.
        if (G.mode !== 'live') return;
        if (G.charging || S.launch.charge > 0) return;               // never in the middle of a plunger charge
        G.limitWait += dt;
        const cur = S.banner;
        const busy = (cur && cur.pri >= 3) || !!G.pendingSurprise;     // a lower priority banner yields, an important one is let finish
        if (busy && G.limitWait < TUNE.limitWaitMax) return;
        beginNotice(busy ? 4 : 3);
      } else if (L.phase === 'notice') {
        L.t += dt;
        if (L.t >= CFG.LIMIT_NOTICE_SECONDS) setLimitPhase('last');
      } else if (L.phase === 'last') L.t += dt;
    }

    function enterGoodbye() {
      S.banner = null; G.bq.length = 0; S.popups.length = 0; S.delights.length = 0;
      S.pacmanHelper.phase = 'none'; S.pacmanHelper.t = 0; S.pacmanHelper.dur = 0;
      L.score = S.score; L.stars = S.stars;
      G.restAt = S.time;
      setLimitPhase('goodbye');
      emit('screen', 'goodbye', 'play');
      emit('gameover', { score: S.score, stars: S.stars, newRecord: S.newRecord, limit: true });
      sfx('game_over');
      later(TUNE.goodbyeVoiceAt, () => sayGoodbye(G.clock));
    }

    // The goodbye waits for a voice line that is still speaking (for instance the notice, when the last ball was quick).
    function sayGoodbye(since) {
      const A = PM.Audio;
      if (A && A.voiceBusy && A.voiceBusy() && G.clock - since < TUNE.goodbyeVoiceWait) { later(0.3, () => sayGoodbye(since)); return; }
      G.restAt = S.time;
      say('limit_goodbye', 3);
    }

    // Space or a tap on the goodbye screen: Pacman bounces (the renderer watches limit.poke) and now and then says a short rest line.
    function poke() {
      L.poke++;
      sfx('ui_click');
      const A = PM.Audio;
      if (A && A.voiceBusy && A.voiceBusy()) return;
      if (S.time - G.restAt < TUNE.limitRestGap) return;
      G.restAt = S.time;
      say('limit_rest', 3);
    }

    // ------------------------------------------------------------------------------------------------------
    // surprises
    function beginSurprise(id) {
      if (id === 'extraball' && limitStop()) {                    // no gift ball once the time is up: another toy takes its place
        id = G.bag.next();
        if (id === 'extraball') id = 'balloons';
      }
      if (S.surprise) endSurprise(false, true);
      G.pendingSurprise = null;
      G.bq = G.bq.filter((e) => e.kind !== 'mystery');          // a late "Meglepetes!" would come after the surprise itself
      const P = world.params;
      G.savedParams = { gravity: P.gravity, flipperScale: P.flipperScale };
      const dur = SURPRISE_DUR[id] || (CFG.SURPRISE_MIN_SECONDS + rng() * (CFG.SURPRISE_MAX_SECONDS - CFG.SURPRISE_MIN_SECONDS));
      S.surprise = { id: id, t: 0, dur: dur };
      stats.surprises[id] = (stats.surprises[id] || 0) + 1;
      S.mystery.cd = CFG.SURPRISE_COOLDOWN; S.mystery.ready = false;
      switch (id) {
        case 'bigflip': P.flipperScale = TUNE.bigflipScale; break;
        case 'slow': P.gravity = G.savedParams.gravity * TUNE.slowGravity; break;
        case 'balloons': spawnBalloons(); break;
        case 'fruits': spawnSurpriseFruits(); break;
        case 'dance': break;
        case 'shield': S.ballSave = Math.max(S.ballSave, dur); break;
        case 'extraball': G.extraGiven = true; S.ballsTotal++; S.ballsLeft++; sfx('extra_ball'); fx('confetti', table.W / 2, 420, COL.gold, 14); break;
        default: break;
      }
      const tx = PM.T.surprise[id];
      announce('surprise', tx.text, tx.sub, SURPRISE_ICON[id], { voice: 'surprise_' + id, vpri: 3, dur: 3.0, ttl: 6 });
      sfx('surprise_start');
      fx('sparkle', table.W / 2, 440, COL.lilac, 8);
      happyGhosts(1.6);
      emit('surprise', id, true);
    }

    function finishSurpriseSoon() {
      if (S.surprise && S.surprise.dur - S.surprise.t > 1.5) S.surprise.dur = S.surprise.t + 1.5;
    }

    function endSurprise(silent, replacing) {
      const s = S.surprise;
      if (!s) return;
      const P = world.params;
      if (G.savedParams) { P.gravity = G.savedParams.gravity; P.flipperScale = G.savedParams.flipperScale; G.savedParams = null; }
      for (const b of S.balloons) world.removeSensor(b.id);
      S.balloons.length = 0;
      for (const f of S.fruits) world.removeSensor(f.id);
      S.fruits.length = 0;
      S.surprise = null;
      emit('surprise', s.id, false);
      if (silent) return;
      sfx('surprise_end');
      if (!replacing) say('surprise_end', 0);
      if (s.id !== 'shield' && s.id !== 'extraball') S.ballSave = Math.max(S.ballSave, TUNE.afterSurpriseSave);
      fx('sparkle', table.W / 2, 440, COL.lilac, 6);
    }

    function spawnBalloons() {
      const a = table.spots.balloonArea;
      S.balloons.length = 0;
      G.balloonPops = 0;
      const order = U.shuffle(BALLOON_COLORS, rng);
      for (let i = 0; i < 5; i++) {
        const id = 'balloon_' + (i + 1);
        const bx = a.x + 24 + i * (a.w - 48) / 4, by = a.y + 34 + (i % 2) * 64 + rng() * 26;
        const b = { id: id, x: bx, y: by, r: 17, color: order[i], bx: bx, by: by, ph: rng() * TAU };
        S.balloons.push(b);
        world.addSensor({ id: id, kind: 'balloon', x: bx, y: by, r: 27, active: true, group: 'surprise' });
      }
    }

    function updateBalloons() {
      if (!S.balloons.length) return;
      const t = G.clock;
      for (const b of S.balloons) {
        b.x = b.bx + Math.sin(t * 0.7 + b.ph) * 20;
        b.y = b.by + Math.sin(t * 0.5 + b.ph * 1.7) * 14;
        world.moveSensor(b.id, b.x, b.y);
      }
    }

    function onBalloon(e) {
      const i = S.balloons.findIndex((b) => b.id === e.id);
      if (i < 0) return;
      const b = S.balloons[i];
      S.balloons.splice(i, 1);
      world.removeSensor(e.id);
      G.balloonPops++;
      addScore(PTS.balloon, { x: b.x, y: b.y - 20, color: b.color });
      sfx('balloon_pop', { x: b.x, rate: 1 + 0.06 * G.balloonPops });
      say('balloon_pop', 0);
      fx('confetti', b.x, b.y, b.color, 6);
      if (S.balloons.length === 0 && S.surprise && S.surprise.id === 'balloons') {
        addScore(500, { x: table.W / 2, y: b.y - 40, color: COL.gold });
        finishSurpriseSoon();
      }
    }

    function spawnSurpriseFruits() {
      const spots = table.spots.fruits3;
      const kinds = U.shuffle(CFG.FRUITS, rng);
      S.fruits.length = 0;
      for (let i = 0; i < 3; i++) {
        const id = 'fruit3_' + (i + 1);
        S.fruits.push({ id: id, kind: kinds[i], x: spots[i].x, y: spots[i].y });
        const s = world.addSensor({ id: id, kind: 'fruit', x: spots[i].x, y: spots[i].y, r: 26, active: true, group: 'surprise' });
        s.fruitKind = kinds[i];
      }
    }

    // ------------------------------------------------------------------------------------------------------
    // per frame updates
    function happyGhosts(sec) { for (const gh of S.ghosts) gh.happyT = Math.max(gh.happyT || 0, sec); }

    function updateGhosts(dt) {
      const dance = S.surprise && S.surprise.id === 'dance';
      const k = 1 - Math.exp(-dt / 0.07);
      for (let i = 0; i < S.ghosts.length; i++) {
        const gh = S.ghosts[i];
        if (gh.hit > 0) gh.hit = Math.max(0, gh.hit - dt / 0.5);
        if (gh.dizzyT > 0) gh.dizzyT -= dt;
        if (gh.giggleT > 0) gh.giggleT -= dt;
        if (gh.happyT > 0) gh.happyT -= dt;
        gh.mood = gh.dizzyT > 0 ? 'dizzy' : S.power ? 'blue' : dance ? 'dance' : gh.giggleT > 0 ? 'giggle' : gh.happyT > 0 ? 'happy' : 'normal';
        // eyes follow the nearest ball, or wander a little when there is none
        let tx, ty, best = 1e9;
        for (const b of world.balls) {
          if (b.state === 'drained') continue;
          const dx = b.x - gh.x, dy = b.y - gh.y, d = Math.hypot(dx, dy);
          if (d < best) { best = d; tx = dx; ty = dy; }
        }
        if (best < 1e9 && best > 1e-3) { const m = clamp(best / 110, 0.35, 1) / best; tx *= m; ty *= m; }
        else { tx = Math.sin(S.time * 0.5 + i * 2.1) * 0.6; ty = 0.3 + Math.cos(S.time * 0.37 + i) * 0.2; }
        gh.lookX += (tx - gh.lookX) * k;
        gh.lookY += (ty - gh.lookY) * k;
      }
    }

    function noriPeek(sec, withVoice) {
      if (world.elements.holes.house.occupied && !G.locked) return;
      const n = S.nori;
      n.visible = true; n.mood = 'giggle';
      G.noriHide = sec;
      sfx('nori_peek', { x: n.x });
      if (withVoice) say('ghost_nori', 1);
    }
    function updateNori(dt) {
      const n = S.nori;
      if (n.visible) {
        G.noriHide -= dt;
        if (G.noriHide <= 0) { n.visible = false; n.mood = 'normal'; G.noriIn = 18 + rng() * 14; }
      } else {
        G.noriIn -= dt;
        if (G.noriIn <= 0) { G.noriTalk = !G.noriTalk; noriPeek(2.4, G.noriTalk); }      // Kuku! on every second peek only
      }
    }

    function updateDelights(dt) {
      const ds = S.delights;
      for (let i = ds.length - 1; i >= 0; i--) {
        const d = ds[i];
        d.t += dt;
        const p = d.t / d.dur;
        if (p >= 1) { ds.splice(i, 1); continue; }
        if (d.kind === 'pacman') d.x = d.dir > 0 ? -0.08 + 1.16 * p : 1.08 - 1.16 * p;
        else {
          const slide = Math.min(1, d.t / 1.2, (d.dur - d.t) / 1.2);
          const edge = -0.05 + 0.1 * U.smooth(slide);
          d.x = d.side === 'left' ? edge : 1 - edge;
        }
      }
      G.delightIn -= dt;
      if (G.delightIn <= 0 && ds.length === 0) {
        G.delightIn = 12 + rng() * 10;
        if (rng() < 0.6) {
          const dir = rng() < 0.5 ? 1 : -1;
          ds.push({ id: G.delightId++, kind: 'pacman', x: dir > 0 ? -0.08 : 1.08, y: 0.12 + rng() * 0.76, dir: dir, size: 0.05, t: 0, dur: 9, color: COL.gold, side: '' });
        } else {
          const side = rng() < 0.5 ? 'left' : 'right';
          const cols = ['red', 'pink', 'cyan', 'orange'];
          ds.push({ id: G.delightId++, kind: 'ghost', x: side === 'left' ? -0.05 : 1.05, y: 0.2 + rng() * 0.6, dir: side === 'left' ? 1 : -1, size: 0.055, t: 0, dur: 6.5, color: cols[rng.int(4)], side: side });
        }
      }
    }

    function updatePopups(dt) {
      for (let i = S.popups.length - 1; i >= 0; i--) { S.popups[i].t += dt; if (S.popups[i].t >= S.popups[i].dur) S.popups.splice(i, 1); }
      if (S.combo > 0 && G.clock - G.lastBumpAt > TUNE.comboWindow) S.combo = 0;
      if (G.spinAcc > 0) {
        G.spinQuiet += dt;
        if (G.spinQuiet > 0.7) {
          if (G.spinAcc >= 100) popup(G.spinX, G.spinY, '+' + G.spinAcc, COL.cream, 1.3);
          G.spinAcc = 0; G.spinTicks = 0;
        }
      }
    }

    // The last dots may sit where a ball hardly ever goes. When the child cannot finish the level for a while, one of them
    // hops to an easy spot (a friendly sparkle shows where).
    function updateStragglers(dt) {
      if (S.dotsLeft <= 0 || S.dotsLeft > TUNE.stragglerDots || activeBalls() === 0) return;
      G.straggleT += dt;
      if (G.straggleT < TUNE.stragglerAfter) return;
      G.straggleT = 0;
      let pick = null, far = -1;
      for (const s of world.sensors) {
        if (s.kind !== 'dot' || !G.dotOn.get(s.id)) continue;
        const d = Math.hypot(s.x - 264, s.y - 620);
        if (d > far) { far = d; pick = s; }
      }
      if (!pick) return;
      for (let k = 0; k < EASY_SPOTS.length; k++) {
        const sp = EASY_SPOTS[(G.spotIdx + k) % EASY_SPOTS.length];
        let free = true;
        for (const s of world.sensors) if (s.kind === 'dot' && G.dotOn.get(s.id) && Math.hypot(s.x - sp[0], s.y - sp[1]) < 26) free = false;
        if (!free) continue;
        G.spotIdx = (G.spotIdx + k + 1) % EASY_SPOTS.length;
        world.moveSensor(pick.id, sp[0], sp[1]);
        fx('sparkle', sp[0], sp[1], COL.cream, 4);
        return;
      }
    }

    function updateEffects(dt) {
      if (activeBalls() > 0) {
        if (S.power) { S.power.t += dt; if (S.power.t >= S.power.dur) endPower(false); }
        if (S.surprise) { S.surprise.t += dt; if (S.surprise.t >= S.surprise.dur) endSurprise(false); }
        if (S.ballSave > 0) { S.ballSave -= dt; if (S.ballSave < 0) S.ballSave = 0; }
        if (S.mystery.cd > 0) S.mystery.cd = Math.max(0, S.mystery.cd - dt);
        if (S.fruit) { G.fruitLeft -= dt; if (G.fruitLeft <= 0) clearFruit(); }
      }
      S.mystery.ready = S.mystery.cd <= 0 && !S.surprise && !G.pendingSurprise;
      if (G.locked) { G.locked.t += dt; if (G.locked.t >= TUNE.lockTimeout) startMultiball(); }
    }

    function showHint(kind) {
      if (kind === 'launch') {
        announce('hint', S.ui.touch ? PM.T.hint_launch_touch : PM.T.hint_launch, '', 'space', { voice: 'hint_launch', vpri: 1, dur: 3.4 });
      } else {
        G.flipHintAt = S.time;
        announce('hint', PM.T.hint_flippers, '', 'arrows', { voice: 'hint_flippers', vpri: 1, dur: 3.4 });
      }
    }

    function updateHints(dt) {
      if (G.mode === 'live' && S.launch.waiting && !G.charging) {
        S.launch.idle += dt;
        if (S.launch.idle >= G.hintNext) { showHint('launch'); G.hintNext = S.launch.idle + TUNE.hintEvery; }
      } else if (!S.launch.waiting) S.launch.idle = 0;
      if (G.mode === 'live' && !S.launch.waiting && activeBalls() > 0) {
        G.flipIdle = S.keys.left || S.keys.right ? 0 : G.flipIdle + dt;
        const limit = G.quickStreak >= 2 ? 6 : TUNE.flipperIdleHint;
        if (G.flipIdle >= limit && S.time - G.flipHintAt > 25) { G.flipIdle = 0; showHint('flippers'); }
      }
    }

    function updateWatchdogs(dt) {
      // A ball in the shooter lane that is neither resting nor moving gets a friendly hop.
      for (const b of world.balls) {
        if (b.state !== 'lane' || isResting(b)) { G.laneSlow.delete(b.id); continue; }
        if (b.vx * b.vx + b.vy * b.vy < 144) {
          const t = (G.laneSlow.get(b.id) || 0) + dt;
          G.laneSlow.set(b.id, t);
          if (t > 3) { G.laneSlow.set(b.id, 0); world.nudgeBall(b.id); }
        } else G.laneSlow.set(b.id, 0);
      }
      // A ball held in the ghost house longer than it should (and not locked) is popped out.
      const h = world.elements.holes.house;
      if (h.occupied && !G.locked && h.t > h.hold + 3) world.releaseBall(h.ballId);
      // Never a game without a ball.
      if (G.mode === 'live' && aliveBalls() === 0) {
        G.lostT += dt;
        if (G.lostT > 1.5) { G.lostT = 0; spawnLaneBall(); }
      } else G.lostT = 0;
    }

    function updateMode(dt) {
      G.modeT += dt;
      if (G.mode === 'rescue') updateRescue(dt);
      else if (G.mode === 'between') { if (G.modeT >= TUNE.betweenBalls) nextBall(); }
      else if (G.mode === 'ending') { if (G.modeT >= TUNE.endingPause) gameOver(); }
    }

    function driveBot(dt) {
      const o = G.bot.update(dt);
      setFlipKeys(!!o.left, !!o.right);
      if (o.launch && S.launch.waiting && !G.charging) {
        // the bot presses Space like a child: a quick tap for a weak shot, else a hold of the suggested length
        G.autoFire = o.power < 0.12 ? 0 : clamp(o.hold / TUNE.chargeSeconds, 0, 1);
        launchDown();
        if (G.autoFire <= 0.001) { G.autoFire = -1; launchUp(); }
      }
    }

    function updatePlay(dt) {
      G.clock += dt;
      S.launch.waiting = G.mode === 'live' && !!waitingBall();
      if (G.bot) driveBot(dt);
      updateCharge(dt);
      world.step(dt);
      handleEvents(world.drainEvents());
      S.launch.waiting = G.mode === 'live' && !!waitingBall();
      if (S.screen !== 'play') return;
      updateLimit(dt);
      updateMode(dt);
      runTimers();
      updateEffects(dt);
      updateStragglers(dt);
      updateBalloons();
      updateGhosts(dt);
      updateNori(dt);
      updatePopups(dt);
      updateBanner(dt);
      updateHints(dt);
      updateDelights(dt);
      updateWatchdogs(dt);
    }

    function updateQuiet(dt) {              // title and game over: the world still runs so the flippers move
      G.clock += dt;
      world.step(dt);
      world.drainEvents();
      runTimers();
      updateGhosts(dt);
      updatePopups(dt);
      updateBanner(dt);
      if (S.screen !== 'goodbye') updateDelights(dt);       // the goodbye belongs to the one big Pacman
      if (S.screen === 'over') S.overT += dt;
      else if (S.screen === 'goodbye') { S.overT += dt; L.t += dt; }
    }

    function update(dt) {
      dt = dt > 0 ? Math.min(dt, CFG.MAX_FRAME_DT) : 0;
      S.time += dt;
      if (S.screen === 'play') updatePlay(dt);
      else if (S.screen === 'title') {
        updateQuiet(dt);
        if (G.bot) { G.autoT += dt; if (G.autoT > 1.0) { G.autoT = 0; launchDown(); launchUp(); } }
      } else if (S.screen === 'over') {
        updateQuiet(dt);
        if (G.bot) { G.autoT += dt; if (G.autoT > G.overLock + 1.5) { G.autoT = 0; launchDown(); launchUp(); } }
      } else if (S.screen === 'goodbye') updateQuiet(dt);       // the bot idles here too
    }

    // ------------------------------------------------------------------------------------------------------
    // debug hooks (for QA and tests; never used by the game itself)
    function debugToPlay() {
      if (S.screen === 'paused') resume({ silent: true });
      else if (S.screen === 'title') start();
      else if (S.screen === 'over') { G.clock = 99; start(); }
      return S.screen === 'play';
    }
    function debugLimitOn() {              // a game without a limit (autoplay, ?perc=0) gets one that has just run out
      if (!L.enabled) { L.enabled = true; L.limitSec = Math.max(L.playSec, 1); }
      L.playSec = Math.max(L.playSec, L.limitSec);
    }
    const debug = {
      givePower() { startPower(); },
      triggerSurprise(id) {
        if (S.screen !== 'play') start();
        if (!id) id = G.bag.next();
        beginSurprise(id);
      },
      spawnFruit(kind) { spawnFruit(kind); },
      setScore(n) { S.score = Math.max(0, +n || 0); S.hiScore = Math.max(G.hiBase, S.score); },
      // ---- ten minute goodbye (SPEC 9.2)
      setPlaySeconds(n) { L.playSec = Math.max(0, +n || 0); },
      startLimit() {                       // jump to the notice now (starts a game first when needed)
        if (!debugToPlay()) return false;
        debugLimitOn();
        if (L.phase === 'none') beginNotice(4);
        return true;
      },
      finishLimit() {                      // jump to the goodbye now
        if (S.screen === 'paused') resume({ silent: true });
        if (S.screen === 'goodbye') return true;
        if (!debugToPlay()) return false;
        debugLimitOn();
        resetBallEffects();
        gameOver();
        return true;
      },
      forceScreen(name) {
        if (S.screen === 'goodbye' && (name === 'title' || name === 'play')) {        // debug only: back out of the goodbye
          L.phase = 'none'; L.t = 0; L.playSec = 0; L.poke = 0; G.pausedFrom = S.pausedFrom = ''; S.screen = 'over'; G.overLock = 0;
        }
        if (name === 'notice' || name === 'last') {
          debug.startLimit();
          if (name === 'last' && L.phase === 'notice') setLimitPhase('last');
        } else if (name === 'goodbye') debug.finishLimit();
        else if (name === 'title') {
          G.gen++; G.timers.length = 0; world.reset(); S.screen = 'title'; S.banner = null; G.bq.length = 0; G.pausedFrom = S.pausedFrom = '';
          S.launch.waiting = false; G.mode = 'idle'; resetBallEffects(); emit('screen', 'title');
        } else if (name === 'play') {
          if (S.screen === 'paused') resume({ silent: true });
          else if (S.screen === 'title') start();
          else if (S.screen === 'over') { G.clock = 99; start(); }
        } else if (name === 'paused') {
          if (S.screen !== 'play') start();
          pause({ silent: true });
        } else if (name === 'over') {
          if (S.screen === 'title') { const keep = S.score; start(); S.score = keep; S.hiScore = Math.max(G.hiBase, keep); }    // R2: keep a score set before (screen=over)
          if (S.screen === 'paused') resume({ silent: true });
          if (S.screen === 'play') { resetBallEffects(); gameOver(); }
        }
      },
      fillDots(leave) {
        let keep = leave === undefined ? 1 : leave;
        for (const s of world.sensors) {
          if (s.kind !== 'dot' || !G.dotOn.get(s.id)) continue;
          if (keep > 0) { keep--; continue; }
          G.dotOn.set(s.id, false); world.setSensorActive(s.id, false); S.dotsLeft--;
        }
        if (S.dotsLeft === 0) levelClear();
      },
      clearLevel() { debug.fillDots(0); },
      drain() {
        for (const b of world.balls) if (b.state !== 'drained') { b.state = 'drained'; world._events.push({ t: 'drain', ballId: b.id }); }
      },
      forceMultiball() {
        if (S.screen !== 'play') start();
        let b = null;
        for (const x of world.balls) if (x.state === 'play') b = x;
        if (!b) return false;
        G.houseEntries = 2;
        b.x = HOUSE.x; b.y = HOUSE.y; b.vx = b.vy = 0;
        world._events.push({ t: 'hole', id: 'house', ballId: b.id });
        return true;
      },
      lightLanes(n) { const c = n === undefined ? 2 : n; for (let i = 0; i < 3; i++) S.lanes[i] = i < c; },
      setMultiplier(n) { S.multiplier = clamp(Math.round(n), 1, 5); },
      setBallsLeft(n) { S.ballsLeft = Math.max(0, Math.round(n)); },
      setBallSave(sec) { S.ballSave = Math.max(0, +sec || 0); },
      giveBall() { return spawnLaneBall(); },
      launchNow(power) { const b = world.launch(power === undefined ? 0.5 : power); return b; },
      nori() { noriPeek(2.4, false); },
      inject(evt) { world._events.push(evt); },
      quickDrains(n) { G.quickStreak = n; },
      info() {
        return { mode: G.mode, locked: !!G.locked, quickStreak: G.quickStreak, rescuesThisBall: G.rescuesThisBall, nextSaver: G.nextSaver,
          houseEntries: G.houseEntries, pending: G.pendingSurprise, chain: G.chain, timers: G.timers.length, clock: G.clock,
          bannerQueue: G.bq.length, dotsEaten: G.dotsEaten, lanesLocked: G.lanesLocked, overLock: G.overLock };
      }
    };

    // ------------------------------------------------------------------------------------------------------
    const game = {
      state: S, world: world, table: table, debug: debug, stats: stats, bot: G.bot,
      update: update, setKeys: setKeys, launchDown: launchDown, launchUp: launchUp, start: start,
      pause: pause, resume: resume, togglePause: togglePause, pointer: pointer, drainFx: drainFx,
      on(name, fn) {
        (listeners[name] || (listeners[name] = [])).push(fn);
        return () => { const l = listeners[name]; const i = l ? l.indexOf(fn) : -1; if (i >= 0) l.splice(i, 1); };
      },
      off(name, fn) { const l = listeners[name]; const i = l ? l.indexOf(fn) : -1; if (i >= 0) l.splice(i, 1); }
    };
    resetGhosts();
    return game;
  }

  PM.Game = { create: create, TUNE: TUNE, STARS: STARS, PTS: PTS, OVER_STAR_T0: OVER_STAR_T0, OVER_STAR_DT: OVER_STAR_DT,
    powerFor: powerFor };
})(typeof globalThis !== 'undefined' ? globalThis : window);
