'use strict';
// Keyboard test WITHOUT a browser. It loads the real game (src files below 60) and the real 90_main.js into a Node vm context
// with a small fake window/document/canvas, then sends fake key events. Nothing is launched, no network, no credentials.
//   node tests/keys_test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { listFiles, SRC } = require('./load');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail !== undefined ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

async function makeEnv(search) {
  const winListeners = {}, canvasListeners = {};
  const calls = { unlock: 0, loadVoices: 0 };
  const rafQueue = [];
  const canvas = {
    width: 0, height: 0, clientWidth: 1280, clientHeight: 720,
    addEventListener(t, f) { (canvasListeners[t] = canvasListeners[t] || []).push(f); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; },
    focus() {}, setPointerCapture() {}, getContext() { return null; }
  };
  const doc = {
    readyState: 'complete', hidden: false, documentElement: {}, body: { appendChild() {} },
    getElementById(id) { return id === 'game' ? canvas : null; },
    addEventListener() {}, createElement() { return { style: {} }; }
  };
  const sandbox = {
    console, Math, JSON, Promise, Date, URLSearchParams, setTimeout, clearTimeout,
    document: doc, location: { search: search || '' }, performance: { now: () => Date.now() },
    localStorage: { getItem() { return null; }, setItem() {} },
    matchMedia() { return { matches: false }; },
    innerWidth: 1280, innerHeight: 720,
    requestAnimationFrame(f) { rafQueue.push(f); return rafQueue.length; },
    addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); }
  };
  const ctx = vm.createContext(sandbox);
  ctx.window = ctx;
  for (const f of listFiles(60)) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  const PM = ctx.PM;
  // browser only pieces: tiny stand-ins (the renderer and the sprites are not under test)
  PM.Theme = { fontsReady: Promise.resolve() };
  PM.Sprites = {};
  PM.Render = { create() { return { layout: { buttons: [], table: null, scale: 1 }, resize() {}, draw() {}, stats: {} }; } };
  PM.Audio = Object.assign({}, PM.Audio, {
    isNull: false,
    unlock() { calls.unlock++; return Promise.resolve(); },
    loadVoices() { calls.loadVoices++; return Promise.resolve(); }
  });
  vm.runInContext(fs.readFileSync(path.join(SRC, '90_main.js'), 'utf8'), ctx, { filename: '90_main.js' });
  await new Promise((r) => setTimeout(r, 30));          // fonts promise, then run()
  if (!ctx.PM_DEBUG) throw new Error('main did not boot (PM_DEBUG missing)');
  const game = ctx.PM_DEBUG.game;
  let ts = 1000;
  const env = {
    game, calls, PM,
    frames(n) { for (let i = 0; i < n; i++) { ts += 16.7; const q = rafQueue.splice(0); q.forEach((f) => f(ts)); } },
    fire(type, e) {
      const ev = Object.assign({ key: '', code: '', location: 0, ctrlKey: false, altKey: false, metaKey: false, repeat: false, timeStamp: ts,
        defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }, e || {});
      (winListeners[type] || []).forEach((f) => f(ev));
      return ev;
    },
    down(code, extra) { return env.fire('keydown', Object.assign({ code, key: code }, extra)); },
    up(code, extra) { return env.fire('keyup', Object.assign({ code, key: code }, extra)); },
    flipper(id) { return game.world.flippers.find((f) => f.id === id); }
  };
  return env;
}

(async () => {
  console.log('== flipper keys: arrows still work, both Ctrl keys work too ==');
  {
    const E = await makeEnv();
    const K = () => E.game.state.keys;
    E.down('ArrowLeft'); check('ArrowLeft raises the left flipper only', K().left && !K().right);
    E.up('ArrowLeft'); check('ArrowLeft released', !K().left && !K().right);
    E.down('ArrowRight'); check('ArrowRight raises the right flipper only', !K().left && K().right);
    E.up('ArrowRight');
    E.down('ControlLeft', { ctrlKey: true }); check('left Ctrl raises the LEFT flipper only', K().left && !K().right);
    E.up('ControlLeft'); check('left Ctrl released', !K().left && !K().right);
    E.down('ControlRight', { ctrlKey: true }); check('right Ctrl raises the RIGHT flipper only', !K().left && K().right);
    E.up('ControlRight'); check('right Ctrl released', !K().left && !K().right);
    E.down('ControlLeft', { ctrlKey: true }); E.down('ControlRight', { ctrlKey: true });
    check('both Ctrl keys together raise both flippers', K().left && K().right);
    E.up('ControlLeft'); E.up('ControlRight');
    E.down('ArrowLeft'); E.down('ControlLeft', { ctrlKey: true });
    E.up('ArrowLeft'); check('arrow released but left Ctrl still held: left flipper stays up', K().left);
    E.up('ControlLeft'); check('then left Ctrl released: down', !K().left);
    E.down('ControlRight', { ctrlKey: true }); E.down('ArrowRight', { ctrlKey: true });
    E.up('ControlRight'); check('right Ctrl released but the right arrow (pressed while Ctrl was held) still holds it', K().right);
    E.up('ArrowRight'); check('all up again', !K().left && !K().right);
    const r1 = E.down('ControlLeft', { ctrlKey: true }); const r2 = E.down('ControlLeft', { ctrlKey: true, repeat: true });
    check('auto-repeat of a held Ctrl changes nothing', K().left && r1.defaultPrevented && r2.defaultPrevented);
    E.up('ControlLeft'); check('and one release lets go', !K().left);
    const o = E.down('Unidentified', { code: '', key: 'Control', location: 2, ctrlKey: true });
    check('old browser without e.code: key Control + location 2 is the right Ctrl', K().right && !K().left && o.defaultPrevented);
    E.up('Unidentified', { code: '', key: 'Control', location: 2 });
    check('...and its release', !K().right);
    E.down('ControlLeft', { ctrlKey: true, metaKey: true });
    check('a Windows/Command key combination is left alone', !K().left);
  }

  console.log('\n== Windows quirk: the second Ctrl key is reported as an auto-repeat while the first one is held ==');
  {
    const E = await makeEnv();
    const K = () => E.game.state.keys;
    E.down('ControlLeft', { ctrlKey: true });
    E.down('ControlRight', { ctrlKey: true, repeat: true });                 // what Windows sends: repeat is true although it is a new press
    check('left Ctrl held, then right Ctrl (flagged repeat): BOTH flippers are up', K().left && K().right);
    E.up('ControlLeft', { ctrlKey: true });
    check('left Ctrl released while right is still held: only the right flipper stays up', !K().left && K().right);
    E.up('ControlRight', { ctrlKey: false });
    check('right Ctrl released: both down', !K().left && !K().right);
    E.down('ControlRight', { ctrlKey: true });
    E.down('ControlLeft', { ctrlKey: true, repeat: true });
    check('the other order (right first, then left flagged repeat): both up', K().left && K().right);
    E.up('ControlRight', { ctrlKey: true }); E.up('ControlLeft', { ctrlKey: false });
    check('and both released', !K().left && !K().right);
    // Windows can swallow the release of the first Ctrl while the second is held: the last release must let go of everything
    E.down('ControlLeft', { ctrlKey: true }); E.down('ControlRight', { ctrlKey: true, repeat: true });
    E.up('ControlRight', { ctrlKey: false });
    check('a lost left-Ctrl release does not leave the left flipper stuck up', !K().left && !K().right);
    // held keys keep repeating: still just "up"
    E.down('ControlRight', { ctrlKey: true }); E.down('ControlRight', { ctrlKey: true, repeat: true }); E.down('ControlRight', { ctrlKey: true, repeat: true });
    check('auto-repeat of a held key keeps it up and does nothing else', K().right && !K().left);
    E.up('ControlRight', { ctrlKey: false });
    E.down('ArrowLeft'); E.down('ArrowLeft', { repeat: true }); E.up('ArrowLeft');
    check('arrow repeats are harmless too', !K().left);
    // repeats of non-flipper keys are still ignored (a held M must not toggle the mute again and again)
    E.down('KeyM', { key: 'm' }); const muted1 = E.game.state.ui.muted;
    E.down('KeyM', { key: 'm', repeat: true }); E.down('KeyM', { key: 'm', repeat: true });
    check('a held M toggles the mute once, not on every repeat', E.game.state.ui.muted === muted1);
    E.up('KeyM');
  }

  console.log('\n== Ctrl held: Space and the arrows still work, browser shortcuts stay browser shortcuts ==');
  {
    const E = await makeEnv();
    const K = () => E.game.state.keys;
    E.down('ControlLeft', { ctrlKey: true });
    const sp = E.down('Space', { ctrlKey: true, key: ' ' });
    check('Space while Ctrl is held is the plunger', K().space && sp.defaultPrevented);
    E.up('Space', { ctrlKey: true, key: ' ' }); check('and its release', !K().space);
    E.down('ArrowRight', { ctrlKey: true }); check('right arrow while left Ctrl is held raises the right flipper', K().right && K().left);
    E.up('ArrowRight', { ctrlKey: true }); E.up('ControlLeft');
    const p = E.down('KeyP', { ctrlKey: true, key: 'p' });
    check('Ctrl+P is not taken (print dialog stays the browser\'s)', !p.defaultPrevented && E.game.state.screen !== 'paused');
    const f = E.down('KeyF', { ctrlKey: true, key: 'f' });
    check('Ctrl+F is not taken', !f.defaultPrevented);
    const m = E.down('KeyM', { ctrlKey: true, key: 'm' });
    check('Ctrl+M does not mute', !m.defaultPrevented && !E.game.state.ui.muted);
    const w = E.down('KeyW', { ctrlKey: true, key: 'w' });
    check('Ctrl+W is not taken', !w.defaultPrevented);
    const alt = E.down('ArrowLeft', { altKey: true });
    check('Alt+Left (browser back) is left alone', !alt.defaultPrevented && !K().left);
    const plainM = E.down('KeyM', { key: 'm' });
    check('a plain M still mutes', E.game.state.ui.muted && plainM.defaultPrevented);
  }

  console.log('\n== AltGr on a Hungarian keyboard (fake left Ctrl + AltRight in the same instant) ==');
  {
    const E = await makeEnv();
    const K = () => E.game.state.keys;
    E.down('ControlLeft', { ctrlKey: true, timeStamp: 5000 });
    E.down('AltRight', { ctrlKey: true, altKey: true, key: 'AltGraph', timeStamp: 5000.2 });
    check('AltGr does not leave the left flipper up', !K().left);
    E.up('ControlLeft', { timeStamp: 5200 }); E.up('AltRight', { timeStamp: 5200.1, key: 'AltGraph' });
    check('and its release is harmless', !K().left && !K().right);
    E.down('ControlLeft', { ctrlKey: true, timeStamp: 8000 });
    E.down('AltRight', { ctrlKey: true, altKey: true, key: 'AltGraph', timeStamp: 8400 });
    check('a real left Ctrl held for a while, then Alt pressed 400 ms later: the flipper stays up', K().left);
    E.up('ControlLeft', { timeStamp: 8600 }); E.up('AltRight', { key: 'AltGraph' });
  }

  console.log('\n== audio unlock: a Ctrl press must not use up the one unlock try ==');
  {
    const E = await makeEnv();
    E.down('ControlLeft', { ctrlKey: true }); E.up('ControlLeft');
    E.down('ControlRight', { ctrlKey: true }); E.up('ControlRight');
    check('Ctrl keys alone do not call PM.Audio.unlock()', E.calls.unlock === 0, 'unlock calls ' + E.calls.unlock);
    E.down('ArrowLeft'); E.up('ArrowLeft');
    check('the first arrow press does', E.calls.unlock === 1);
    E.down('Space', { key: ' ' }); E.up('Space', { key: ' ' });
    check('and it is still only one try in total', E.calls.unlock === 1);
    const F = await makeEnv();
    F.down('Space', { key: ' ' }); F.up('Space', { key: ' ' });
    check('Space as the very first key also unlocks', F.calls.unlock === 1);
  }

  console.log('\n== the real game: Ctrl moves the real flippers, blur lets go ==');
  {
    const E = await makeEnv();
    E.down('Space', { key: ' ' }); E.up('Space', { key: ' ' });              // title -> play
    E.frames(30);
    check('Space started the game', E.game.state.screen === 'play', E.game.state.screen);
    const L = E.flipper('L'), R = E.flipper('R');
    E.down('ControlLeft', { ctrlKey: true }); E.frames(20);
    check('left Ctrl: the left flipper swings up, the right one stays down', L.up === true && R.up === false, 'L.up ' + L.up + ' R.up ' + R.up);
    E.up('ControlLeft'); E.frames(30);
    check('released: the left flipper drops again', L.up === false);
    E.down('ControlRight', { ctrlKey: true }); E.frames(20);
    check('right Ctrl: the right flipper swings up, the left one stays down', R.up === true && L.up === false);
    E.fire('blur');
    check('the window loses focus while Ctrl is held: everything is let go', !E.game.state.keys.right && !E.game.state.keys.left);
    E.frames(5);
    check('losing focus paused the game (as designed)', E.game.state.screen === 'paused', E.game.state.screen);
    E.down('Space', { key: ' ' }); E.up('Space', { key: ' ' }); E.frames(10);
    check('Space resumes it', E.game.state.screen === 'play', E.game.state.screen);
    E.down('ArrowLeft'); E.frames(20);
    check('arrows drive the real flipper too', L.up === true);
    E.up('ArrowLeft'); E.frames(30);
    check('and let it drop again', L.up === false);
  }

  console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('test crashed:', e && e.stack || e); process.exit(2); });
