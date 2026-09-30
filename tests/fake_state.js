'use strict';
// A stand-in for PM.Game (owner G) so the renderer can be built and photographed before, or without, the real game.
// It follows SPEC 4.2: a real PM.Physics.World from PM.Table.build(), a plain game.state, drainFx(), debug hooks.
// It plays a little (bot in autoplay) but does not try to be the game: only enough rules to make every state visible.
//
// In the page:   PM.FakeGame.create({seed:1, touch:false, autoplay:false})   (this file must load after 00..50)
// In Node:       const create = require('./fake_state')(PM)  where PM comes from tests/load.js
//
// Extra (not in SPEC): game.advance(seconds) runs update() in 1/60 s steps; game.state.fruits is filled by the
// 'fruits' surprise; timer objects count UP (t = elapsed), which the renderer must also accept counting down.
(function (root) {
  function install(PM) {
    const U = PM.util, CFG = PM.CFG;

    function create(opts) {
      opts = opts || {};
      const seed = opts.seed || 1;
      const rng = U.rng(seed);
      const table = PM.Table.build();
      const world = new PM.Physics.World(table, { rng: U.rng(seed + 7) });
      const bot = PM.Bot ? PM.Bot.create(world, { skill: 0.8, seed: seed }) : null;
      const fxQueue = [];
      const listeners = {};

      const state = {
        screen: 'title', time: 0, score: 0, hiScore: opts.hiScore == null ? 48250 : opts.hiScore, newRecord: false,
        ballNo: 1, ballsTotal: CFG.BALLS_PER_GAME, ballsLeft: CFG.BALLS_PER_GAME - 1,
        multiplier: 1, lanes: [false, false, false], level: 1,
        dotsLeft: table.stats.dots, dotsTotal: table.stats.dots,
        power: null, surprise: null, ballSave: 0, multiball: false,
        launch: { waiting: false, charge: 0, idle: 0 },
        keys: { left: false, right: false, space: false },
        ghosts: table.bumpers.map((b) => ({ id: b.id, bumperId: b.id, color: b.color, x: b.x, y: b.y, r: b.r, mood: 'normal', hit: 0, lookX: 0, lookY: 0 })),
        nori: { x: table.spots.noriPeek.x, y: table.spots.noriPeek.y, mood: 'normal', visible: false },
        pacmanHelper: { phase: 'none', t: 0 },
        banner: null, popups: [], fruitTray: [], fruit: null, fruits: null, balloons: [], stars: 1,
        ui: { muted: false, musicOn: true, touch: !!opts.touch },
        // SPEC 9.2: the ten minute goodbye. The fake plays the same phases so the renderer can be photographed without the real game.
        limit: { enabled: opts.playLimitSeconds !== 0, phase: 'none', t: 0, playSec: 0, limitSec: opts.playLimitSeconds || CFG.PLAY_LIMIT_SECONDS || 600, poke: 0, score: 0, stars: 0 }
      };
      let surpriseBag = 0;
      let charging = false;

      const fx = (type, x, y, color, n) => fxQueue.push({ type: type, x: x, y: y, color: color, n: n });
      const banner = (kind, text, sub, icon, dur) => { state.banner = { kind: kind, text: text, sub: sub || '', icon: icon || '', t: 0, dur: dur || 2.4 }; };
      const popup = (x, y, text, color) => { state.popups.push({ x: x, y: y, text: String(text), t: 0, dur: 1.1, color: color || '#FFF8E7' }); if (state.popups.length > 6) state.popups.shift(); };
      const ghostById = (id) => state.ghosts.find((g) => g.id === id);
      const setMoods = (mood) => { for (const g of state.ghosts) g.mood = mood; };

      function serveBall() {
        const b = world.spawnBall();
        state.launch.waiting = !!b; state.launch.idle = 0; state.launch.charge = 0;
        return b;
      }
      function newGame() {
        world.reset();
        state.score = 0; state.newRecord = false; state.ballNo = 1; state.ballsLeft = state.ballsTotal - 1;
        state.multiplier = 1; state.lanes = [false, false, false]; state.level = 1;
        state.power = null; state.surprise = null; state.ballSave = 0; state.fruitTray = []; state.fruit = null; state.fruits = null; state.balloons = [];
        state.banner = null; state.popups = [];
        for (const s of world.sensors) if (s.kind === 'dot' || s.kind === 'pellet') world.setSensorActive(s.id, true);
        state.dotsLeft = state.dotsTotal;
        setMoods('normal');
        serveBall();
      }
      function startLimit() {
        if (state.limit.phase !== 'none') return;
        state.limit.phase = 'notice'; state.limit.t = 0;
        state.banner = { kind: 'limit', text: (PM.T.limit_notice || (PM.T.r && PM.T.r.limit_notice) || { text: 'Sokat játszottál!' }).text, sub: '', icon: 'pacman', t: 0, dur: 3 };
      }
      function finishLimit() {
        state.limit.phase = 'goodbye'; state.limit.t = 0; state.limit.score = state.score;
        state.stars = state.score > 30000 ? 3 : state.score > 9000 ? 2 : 1; state.limit.stars = state.stars;
        state.screen = 'goodbye'; state.banner = null;
      }
      function endGame() {
        state.screen = 'over';
        state.stars = state.score > 30000 ? 3 : state.score > 9000 ? 2 : 1;
        if (state.score > state.hiScore) { state.hiScore = state.score; state.newRecord = true; }
      }

      function handle(e) {
        switch (e.t) {
          case 'sensor': {
            if (e.kind === 'dot') { world.setSensorActive(e.id, false); state.score += 10 * state.multiplier; state.dotsLeft--; fx('chomp', e.x, e.y); }
            else if (e.kind === 'pellet') { world.setSensorActive(e.id, false); state.score += 100; api.debug.givePower(); fx('sparkle', e.x, e.y, '#FFF6DC', 8); }
            else if (e.kind === 'lane') {
              const i = parseInt(e.id.slice(4), 10) - 1;
              state.lanes[i] = true; fx('sparkle', e.x, e.y, '#FFD84A', 5);
              if (state.lanes.every(Boolean)) { state.lanes = [false, false, false]; state.multiplier = Math.min(5, state.multiplier + 1); banner('good', PM.T.mult.text.replace('{n}', state.multiplier), PM.T.mult.sub, 'star', 2.2); }
            }
            break;
          }
          case 'bumper': {
            const g = ghostById(e.id);
            if (g) { g.hit = 1; }
            state.score += state.power ? 200 : 100;
            popup(e.x, e.y - 30, state.power ? '200' : '100', state.power ? '#8F9CFF' : '#FFF8E7');
            fx('ring', e.x, e.y, g ? PM.Theme.colors.ghost[g.color] : '#fff');
            break;
          }
          case 'sling': state.score += 10; break;
          case 'target': state.score += 250; fx('stars', 470, 440, '#FFD84A', 5); if (!state.surprise) api.debug.triggerSurprise(CFG.SURPRISES[surpriseBag++ % CFG.SURPRISES.length]); break;
          case 'hole': state.score += 500; state.nori.visible = false; banner('good', PM.T.house.text, '', 'house', 1.8); fx('sparkle', 264, 199, '#FFF3C4', 8); break;
          case 'tunnel': state.score += 250; fx('sparkle', world.getBall(e.ballId) ? world.getBall(e.ballId).x : 250, 570, '#B79BFF', 6); break;
          case 'launch': state.launch.waiting = false; break;
          case 'drain': {
            if (state.limit.phase === 'last' && state.ballSave <= 0) { finishLimit(); break; }
            if (state.ballSave > 0) { state.pacmanHelper = { phase: 'chomp', t: 0 }; state.ballSave = 0; banner('save', PM.T.ballsave.text, PM.T.ballsave.sub, 'pacman', 2.2); }
            else {
              banner('info', PM.T.drain.text, PM.T.drain.sub, 'heart', 2.2);
              if (state.ballsLeft <= 0) endGame();
              else { state.ballsLeft--; state.ballNo++; }
            }
            if (state.screen === 'play') serveBall();
            break;
          }
          default: break;
        }
      }

      function tick(dt) {
        state.time += dt;
        const L = state.limit;
        if (L.enabled && state.screen !== 'title') {
          if (state.screen === 'play') L.playSec += dt;
          if (L.phase === 'none' && state.screen === 'play' && L.playSec >= L.limitSec) startLimit();
        }
        if (L.phase !== 'none' && state.screen !== 'paused') {
          L.t += dt;
          if (L.phase === 'notice' && L.t >= (CFG.LIMIT_NOTICE_SECONDS || 9)) { L.phase = 'last'; L.t = 0; }
        }
        // timers count UP (elapsed)
        for (const k of ['power', 'surprise']) {
          if (state[k]) { state[k].t += dt; if (state[k].t >= state[k].dur) { if (k === 'surprise') endSurprise(); else { state.power = null; setMoods('normal'); } } }
        }
        if (state.banner) { state.banner.t += dt; if (state.banner.t >= state.banner.dur) state.banner = null; }
        for (let i = state.popups.length - 1; i >= 0; i--) { state.popups[i].t += dt; if (state.popups[i].t >= state.popups[i].dur) state.popups.splice(i, 1); }
        if (state.pacmanHelper.phase !== 'none') {
          state.pacmanHelper.t += dt;
          if (state.pacmanHelper.phase === 'chomp' && state.pacmanHelper.t > 1.1) { state.pacmanHelper = { phase: 'spit', t: 0 }; serveBall(); }
          else if (state.pacmanHelper.phase === 'spit' && state.pacmanHelper.t > 1.4) state.pacmanHelper = { phase: 'none', t: 0 };
        }
        for (const g of state.ghosts) {
          g.hit = Math.max(0, g.hit - dt * 2.5);
          let best = null, bd = 1e9;
          for (const b of world.balls) { const d = Math.hypot(b.x - g.x, b.y - g.y); if (d < bd) { bd = d; best = b; } }
          if (best) { const d = Math.max(1, bd), k = Math.min(1, d / 140); g.lookX = (best.x - g.x) / d * k; g.lookY = (best.y - g.y) / d * k; } else { g.lookX = 0; g.lookY = 0.2; }
        }
        // Nori peeks now and then
        state.nori.visible = (state.time % 11) > 8.6 && !world.elements.holes.house.occupied;
        for (const b of world.balls) void b;
        if (state.ballSave > 0) state.ballSave = Math.max(0, state.ballSave - dt);
      }

      function endSurprise() {
        const id = state.surprise && state.surprise.id;
        state.surprise = null;
        world.params.flipperScale = 1; world.params.gravity = 430; world.params.timeScale = 1;
        state.balloons = []; state.fruits = null; setMoods(state.power ? 'blue' : 'normal');
        if (id === 'shield') state.ballSave = 0;
      }

      const api = {
        table: table, world: world, state: state,
        update(dt) {
          if (state.screen === 'paused') return;
          if (state.screen === 'goodbye') { dt = Math.min(dt, CFG.MAX_FRAME_DT); tick(dt); return; }
          dt = Math.min(dt, CFG.MAX_FRAME_DT);
          if (state.screen === 'play') {
            if (opts.autoplay && bot) {
              const a = bot.update(dt);
              world.setInput({ left: a.left, right: a.right });
              state.keys.left = a.left; state.keys.right = a.right;
              if (a.launch) { world.launch(a.power || 0.6); }
            } else world.setInput({ left: state.keys.left, right: state.keys.right });
            if (charging) { state.launch.charge = Math.min(1, state.launch.charge + dt * 0.8); world.setPlunger(state.launch.charge); }
            world.step(dt);
            for (const e of world.drainEvents()) handle(e);
            if (state.launch.waiting) state.launch.idle += dt;
            // balloons drift and pop on touch
            for (let i = state.balloons.length - 1; i >= 0; i--) {
              const bl = state.balloons[i];
              bl.y -= 6 * dt; bl.x += Math.sin(state.time * 0.8 + bl.id) * 6 * dt;
              for (const b of world.balls) if (Math.hypot(b.x - bl.x, b.y - bl.y) < bl.r + b.r) { fx('pop', bl.x, bl.y, bl.color, 8); state.score += 200; state.balloons.splice(i, 1); break; }
            }
          }
          tick(dt);
        },
        setKeys(k) { state.keys.left = !!k.left; state.keys.right = !!k.right; },
        launchDown() { if (state.screen === 'goodbye') { state.limit.poke++; return; } if (state.screen === 'title') { api.start(); return; } if (state.screen === 'over') { api.start(); return; } state.keys.space = true; if (state.launch.waiting) charging = true; },
        launchUp() {
          state.keys.space = false;
          if (charging) { charging = false; const p = state.launch.charge; state.launch.charge = 0; world.setPlunger(0); world.launch(0.2 + 0.8 * p); }
        },
        start() { newGame(); state.screen = 'play'; },
        togglePause() { state.screen = state.screen === 'paused' ? 'play' : (state.screen === 'play' ? 'paused' : state.screen); },
        pause() { if (state.screen === 'play') state.screen = 'paused'; },
        resume() { if (state.screen === 'paused') state.screen = 'play'; },
        pointer(kind) { if (kind === 'sound') state.ui.muted = !state.ui.muted; else if (kind === 'music') state.ui.musicOn = !state.ui.musicOn; else if (kind === 'pause') api.togglePause(); },
        drainFx() { const l = fxQueue.slice(); fxQueue.length = 0; return l; },
        on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
        setAutoplay(on) { opts.autoplay = !!on; },
        advance(sec) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) api.update(1 / 60); },
        debug: {
          givePower() { state.power = { t: 0, dur: CFG.POWER_SECONDS }; setMoods('blue'); banner('power', PM.T.power.text, PM.T.power.sub, 'power', 2.4); },
          triggerSurprise(id) {
            state.surprise = { id: id, t: 0, dur: 10 };
            const sr = PM.T.surprise[id];
            banner('surprise', sr.text, sr.sub, id, 2.6);
            fx('sparkle', 264, 640, '#FFF3C4', 8);
            if (id === 'bigflip') world.params.flipperScale = 1.35;
            else if (id === 'slow') { world.params.gravity = 430 * 0.6; }
            else if (id === 'balloons') state.balloons = [0, 1, 2, 3, 4].map((i) => ({ id: i + 1, x: 170 + i * 48, y: 470 + (i % 2) * 60 + i * 8, r: 20, color: PM.Theme.colors.balloons[i] }));
            else if (id === 'fruits') state.fruits = table.spots.fruits3.map((p, i) => ({ kind: CFG.FRUITS[(i * 2) % 6], x: p.x, y: p.y }));
            else if (id === 'dance') setMoods('dance');
            else if (id === 'shield') state.ballSave = 20;
            else if (id === 'extraball') state.ballsLeft++;
          },
          spawnFruit(kind) { kind = kind || 'cherry'; state.fruit = { kind: kind, x: table.spots.fruit.x, y: table.spots.fruit.y }; world.setSensorActive('fruit', true); },
          setScore(n) { state.score = n; },
          startLimit() { startLimit(); },
          setPlaySeconds(n) { state.limit.playSec = n; },
          finishLimit() { finishLimit(); },
          forceScreen(name) {
            if (name === 'play' && state.screen !== 'play' && state.screen !== 'paused') api.start();
            state.screen = name;
          },
          fillDots() {
            let n = 0;
            for (const s of world.sensors) if (s.kind === 'dot' && s.active && rng() < 0.55) { world.setSensorActive(s.id, false); n++; }
            state.dotsLeft -= n;
          },
          drain() { const b = world.balls.find((x) => x.state !== 'drained'); if (b) { b.x = 250; b.y = 960; b.vy = 100; } }
        }
      };
      return api;
    }
    PM.FakeGame = { create: create };
    return create;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = install;
  else if (root.PM) install(root.PM);
})(typeof globalThis !== 'undefined' ? globalThis : window);
