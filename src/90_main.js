/* 90_main.js: boot, animation loop, input, resize, pause, audio flow and settings. Browser only.
   Creates the game (40_game.js) and the renderer (70_render.js), then runs requestAnimationFrame.

   Keys: ArrowLeft / ArrowRight OR the left Ctrl / right Ctrl key = the two flippers (hold; both pairs work at the same time),
   Space = plunger (hold to pull, release to fire; also starts the game and resumes from pause), P or Esc = pause, M = mute,
   F = fullscreen. Space and the flipper keys also work while a Ctrl key is held; other Ctrl combinations (Ctrl+P, Ctrl+F, Ctrl+W)
   stay browser shortcuts. A Ctrl press is not a user activation for the browser, so it never calls the audio unlock.
   AltGr (Right Alt on a Hungarian keyboard) sends a fake left Ctrl right before AltRight: it is cancelled again at once.
   Pointer and touch: the left half and the right half of the table area are the two flippers (any number of fingers), the
   launch button (touch) or a press on the shooter lane fires the plunger, the small buttons come from render.layout.buttons.
   Audio: the first key press or touch calls PM.Audio.unlock() and then loadVoices(); the music mode follows the game state
   (menu on the title, play, power, surprise, gameover); the audio is suspended while paused or when the tab is hidden.
   Settings (hi-score, music) live in localStorage under PM.CFG.LOG_KEY; everything works when storage is blocked.
   The mute is NOT saved: every start is unmuted (unless ?mute=1), so one stray M press can never leave the next launch silent
   for a child who cannot read (an old saved "muted" key from an earlier build is dropped at boot and never read).
   Tab is swallowed (Shift+Tab too): it would hand the keyboard to the browser toolbar, the window would lose focus and the
   game would pause while Space went to the toolbar. Ctrl, Alt and Meta shortcuts and F5 stay untouched.
   URL parameters: autoplay=1 (a bot plays), skill=0..1 (bot skill), seed=N, debug=1 (small overlay), mute=1,
   screen=title|play|paused|over|notice|last|goodbye (jump straight to a screen, for screenshots),
   perc=N (minutes of play until Pacman says goodbye, decimals allowed with a dot or a comma, default 10, 0 = never, a negative or
   unreadable value is ignored; perc=0.25 is 15 seconds for a test; with autoplay=1 the limit is off unless perc is given),
   language=en (English text; anything else or missing = Hungarian). boot() calls PM.setLanguage (08_lang.js) before anything reads
   PM.T, then sets <html lang> and the canvas aria-label from it.
   The loop passes the real frame time (capped at 1 s) as the second argument of game.update, so a slow computer still gets the
   ten minutes of the clock on the wall, while the physics keep the clamped step.
   The goodbye screen (SPEC 9.2) is final: Space and taps only poke Pacman (game.launchDown does that, main never starts a game
   from it), the sound, music and pause buttons and the M, P and F keys keep working, the music is the lullaby ('gameover').
   A parent plays again by reloading the page (F5) or with ?perc=0.
   window.PM_DEBUG = {PM, game, render, params, seed}. */
(function (g) {
  'use strict';
  const PM = g.PM = g.PM || {};
  const doc = g.document;
  const CFG = PM.CFG || {};

  // ------------------------------------------------------------------------------------------------------------
  // small helpers
  const LOG = '[Pacman Flipper] ';
  function warn(msg, err) { if (g.console) g.console.error(LOG + msg + (err ? ' ' + (err.stack || err) : '')); }
  const seenErrors = {};
  function once(where, err) {
    const key = where + ':' + (err && err.message);
    if (seenErrors[key]) return;
    if (Object.keys(seenErrors).length > 8) return;
    seenErrors[key] = true;
    warn('error in ' + where + ':', err);
  }

  function readParams() {
    const p = { autoplay: false, skill: 0.8, seed: null, debug: false, mute: false, screen: '', perc: null, language: 'hu' };
    try {
      const q = new URLSearchParams(g.location.search);
      const on = (k) => q.has(k) && q.get(k) !== '0' && q.get(k) !== 'false';
      p.autoplay = on('autoplay'); p.debug = on('debug'); p.mute = on('mute');
      if (q.has('seed') && isFinite(+q.get('seed'))) p.seed = (+q.get('seed')) >>> 0;
      if (q.has('skill') && isFinite(+q.get('skill'))) p.skill = Math.max(0, Math.min(1, +q.get('skill')));
      const sc = q.get('screen');
      if (sc === 'title' || sc === 'play' || sc === 'paused' || sc === 'over' || sc === 'notice' || sc === 'last' || sc === 'goodbye') p.screen = sc;
      const pc = (q.get('perc') || '').trim().replace(',', '.');                      // a Hungarian keyboard types 0,5
      if (pc !== '' && isFinite(+pc) && +pc >= 0) p.perc = +pc;                        // minutes; 0 = no limit; negative: keep the default
      p.language = PM.normLang ? PM.normLang(q.get('language')) : 'hu';                    // unknown or missing: Hungarian
    } catch (err) { /* old browser: defaults */ }
    return p;
  }

  // settings in localStorage, wrapped so that blocked storage never breaks anything
  const memory = {};
  function storageGet() {
    try {
      const raw = g.localStorage.getItem(CFG.LOG_KEY || 'pacmanFlipper.v1');
      if (raw) { const o = JSON.parse(raw); if (o && typeof o === 'object') return o; }
    } catch (err) { /* blocked or corrupt: fall through */ }
    return memory;
  }
  function storageSet(patch) {
    const cur = Object.assign({}, storageGet(), patch);
    Object.assign(memory, cur);
    try { g.localStorage.setItem(CFG.LOG_KEY || 'pacmanFlipper.v1', JSON.stringify(cur)); } catch (err) { /* blocked: memory only */ }
  }

  // ------------------------------------------------------------------------------------------------------------
  // missing pieces: say so clearly instead of failing mysteriously
  function missingModules() {
    const need = [['PM.util', PM.util], ['PM.CFG', PM.CFG], ['PM.T', PM.T], ['PM.Table', PM.Table], ['PM.Physics', PM.Physics],
      ['PM.Game', PM.Game], ['PM.Bot', PM.Bot], ['PM.Theme', PM.Theme], ['PM.Sprites', PM.Sprites], ['PM.Render', PM.Render]];
    return need.filter((n) => !n[1]).map((n) => n[0]);
  }
  function showFatal(canvas, lines) {
    try {
      canvas.width = g.innerWidth || 640; canvas.height = g.innerHeight || 360;
      const c = canvas.getContext('2d');
      c.fillStyle = '#0d1533'; c.fillRect(0, 0, canvas.width, canvas.height);
      c.fillStyle = '#fff8e7'; c.font = '20px sans-serif';
      lines.forEach((l, i) => c.fillText(l, 24, 48 + i * 30));
    } catch (err) { /* nothing more to do */ }
  }

  // ------------------------------------------------------------------------------------------------------------
  function boot() {
    const canvas = doc.getElementById('game');
    const params = readParams();
    // The language first: the missing module screen below and PM.Render.create() in run() read PM.T.
    if (PM.setLanguage) PM.setLanguage(params.language);
    try {
      doc.documentElement.lang = PM.LANG || 'hu';
      if (canvas && PM.T && PM.T.aria_label) canvas.setAttribute('aria-label', PM.T.aria_label);
    } catch (err) { /* only labels: the game does not need them */ }
    const missing = missingModules();
    if (!canvas || missing.length) {
      warn('cannot start, missing: ' + (canvas ? '' : 'canvas#game ') + missing.join(', ') + '. Rebuild with python tools/build.py (all src files).');
      if (canvas) showFatal(canvas, [(PM.T && PM.T.fatal_missing) || 'Pacman Flipper: missing module', missing.join(', ')]);
      return;
    }
    // PM.Audio may be the silent stand-in from 00_ns.js: that is fine, the game just stays quiet.
    const settings = storageGet();
    // R2: a phone or tablet whose main pointer is a finger starts in touch mode (touch text and buttons), not only after the first touch
    let coarse = false;
    try { coarse = !!(g.matchMedia && g.matchMedia('(pointer: coarse)').matches); } catch (err) { /* keyboard layout */ }
    // The mute is never restored from storage (F17): always unmuted unless ?mute=1. Music on/off is a small button, so it is kept.
    if (settings.muted !== undefined) storageSet({ muted: undefined });      // forget the "muted" that an earlier build saved
    const ui = { muted: !!params.mute, musicOn: settings.musicOn !== false, touch: coarse };
    const fonts = Promise.race([
      Promise.resolve(PM.Theme.fontsReady).catch(() => {}),
      new Promise((res) => g.setTimeout(res, 1500))
    ]);
    fonts.then(() => run(canvas, params, settings, ui)).catch((err) => warn('start failed:', err));
  }

  function run(canvas, params, settings, ui) {
    const seed = params.seed !== null ? params.seed : (((Date.now() & 0x7fffffff) ^ (Math.floor(g.performance ? g.performance.now() : 0) * 7919)) >>> 0) || 1;
    const game = PM.Game.create({
      seed: seed, hiScore: Math.max(0, +settings.hi || 0), autoplay: params.autoplay, skill: params.skill,
      playLimitSeconds: params.perc === null ? undefined : params.perc * 60,        // undefined: 10 minutes, but off with autoplay
      onHiScore: (score) => storageSet({ hi: score })
    });
    const S = game.state;
    S.ui.muted = ui.muted; S.ui.musicOn = ui.musicOn; S.ui.touch = ui.touch;
    const render = PM.Render.create(canvas, game);
    g.PM_DEBUG = { PM: PM, game: game, render: render, params: params, seed: seed };

    const audio = () => PM.Audio;            // read at call time: 80_audio.js replaced the stand-in at load time
    const A = (fn, a, b) => { try { const o = audio(); if (o && o[fn]) return o[fn](a, b); } catch (err) { once('audio.' + fn, err); } return undefined; };

    // ---- audio flow -------------------------------------------------------------------------------------------
    let unlocked = false, voicesAsked = false;
    function askVoices() {
      if (voicesAsked) return;
      voicesAsked = true;
      try { Promise.resolve(A('loadVoices')).catch(() => {}); } catch (err) { /* stays quiet */ }
    }
    function unlockAudio() {
      if (unlocked) return;
      unlocked = true;
      try { Promise.resolve(A('unlock')).then(askVoices, askVoices); } catch (err) { askVoices(); }
    }
    A('setMuted', ui.muted);
    A('setMusicOn', ui.musicOn);
    // Decode the voice clips while the title is on screen, so the very first Space press already has a voice.
    g.setTimeout(askVoices, 400);
    if (params.autoplay) g.setTimeout(unlockAudio, 100);

    let musicMode = '', suspended = false;
    function wantedMusic() {
      if (S.screen === 'title') return 'menu';
      if (S.screen === 'over' || S.screen === 'goodbye') return 'gameover';
      if (S.screen === 'paused') return musicMode || 'play';
      if (S.surprise) return 'surprise';
      if (S.power) return 'power';
      return 'play';
    }
    function syncAudio() {
      const mode = wantedMusic();
      if (mode !== musicMode) { musicMode = mode; A('setMusic', mode); }
      const wantSuspend = !!doc.hidden || S.screen === 'paused';
      if (wantSuspend !== suspended) { suspended = wantSuspend; A(wantSuspend ? 'suspend' : 'resume'); }
    }

    function toggleMute() {
      ui.muted = !ui.muted; S.ui.muted = ui.muted;
      A('setMuted', ui.muted);                                 // not saved on purpose (F17)
      if (!ui.muted) A('sfx', 'ui_click');
    }
    function toggleMusic() {
      ui.musicOn = !ui.musicOn; S.ui.musicOn = ui.musicOn;
      A('setMusicOn', ui.musicOn);
      storageSet({ musicOn: ui.musicOn });
      A('sfx', 'ui_click');
    }
    function toggleFullscreen() {
      try {
        const el = doc.documentElement;
        if (doc.fullscreenElement || doc.webkitFullscreenElement) { (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc); }
        else { const f = el.requestFullscreen || el.webkitRequestFullscreen; if (f) { const p = f.call(el); if (p && p.catch) p.catch(() => {}); } }
      } catch (err) { /* fullscreen is optional */ }
    }
    game.on('ui', (kind) => {
      if (kind === 'sound') toggleMute();
      else if (kind === 'music') toggleMusic();
      else if (kind === 'fullscreen') toggleFullscreen();
    });

    // ---- keyboard ---------------------------------------------------------------------------------------------
    const held = { left: false, right: false, space: false };
    // Each flipper has two keys (arrow and Ctrl); it stays up while either one is down.
    const flip = { ArrowLeft: false, ArrowRight: false, ControlLeft: false, ControlRight: false };
    const touch = { left: 0, right: 0, launch: 0 };
    function pushKeys() { game.setKeys({ left: held.left || touch.left > 0, right: held.right || touch.right > 0 }); }
    function setFlip(code, down) {
      flip[code] = down;
      held.left = flip.ArrowLeft || flip.ControlLeft;
      held.right = flip.ArrowRight || flip.ControlRight;
      pushKeys();
    }
    function releaseAll() {
      const wasSpace = held.space || touch.launch > 0;
      flip.ArrowLeft = flip.ArrowRight = flip.ControlLeft = flip.ControlRight = false;
      held.left = held.right = held.space = false;
      touch.left = touch.right = touch.launch = 0;
      pointers.clear();
      pushKeys();
      if (wasSpace) game.launchUp();
    }

    function keyOf(e) {
      const c = e.code;
      if (c === 'ArrowLeft' || c === 'ArrowRight' || c === 'ControlLeft' || c === 'ControlRight' || c === 'Space' || c === 'KeyP' ||
          c === 'Escape' || c === 'KeyM' || c === 'KeyF') return c;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') return k;
      if (k === 'Control') return e.location === 2 ? 'ControlRight' : 'ControlLeft';      // an old browser without e.code
      if (k === ' ' || k === 'Spacebar') return 'Space';
      if (k === 'Escape' || k === 'Esc') return 'Escape';
      return '';
    }
    let ctrlLeftAt = -1e9;                                            // when the last ControlLeft press arrived (AltGr check below)
    g.addEventListener('keydown', (e) => {
      if (e.metaKey) return;                                          // the Windows or Command key: leave those shortcuts alone
      // Tab (and Shift+Tab) would move the keyboard focus to the browser toolbar: the window blurs, the game pauses and Space no longer
      // reaches the page (F16). Swallow it; the keyup is left alone. F5 is never blocked: the parent reloads with it on the goodbye.
      if (e.key === 'Tab' || e.code === 'Tab') { e.preventDefault(); return; }
      // AltGr (Right Alt on a Hungarian keyboard) arrives as ControlLeft and then AltRight within the same instant. That ControlLeft
      // is not the child's finger: put the left flipper down again.
      if (e.code === 'AltRight' || e.key === 'AltGraph') {
        if (flip.ControlLeft && (+e.timeStamp || 0) - ctrlLeftAt < 30) setFlip('ControlLeft', false);
        return;
      }
      const k = keyOf(e);
      if (!k) return;
      const play = k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ControlLeft' || k === 'ControlRight' || k === 'Space';
      if (e.altKey && !e.ctrlKey) return;                             // a plain Alt shortcut (Alt+Left is "back"): leave it alone
      if (e.ctrlKey && !play) return;                                 // Ctrl+P, Ctrl+F, Ctrl+M: browser shortcuts stay browser shortcuts
      e.preventDefault();
      // Key auto-repeat is ignored, except for the flipper keys. Windows marks the SECOND Ctrl key as a repeat when the other Ctrl key
      // is already down (both are the same virtual key), so filtering repeats would drop it and that side's flipper would never move.
      // Raising a flipper that is already up is harmless.
      if (e.repeat && k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ControlLeft' && k !== 'ControlRight') return;
      if (k === 'ControlLeft' && !flip.ControlLeft) ctrlLeftAt = +e.timeStamp || 0;       // a new press only, not an auto-repeat
      // A Ctrl press is not a user activation for the browser: calling the unlock now would use up its single try while the audio
      // is still blocked. The first arrow or Space press does it.
      if (k !== 'ControlLeft' && k !== 'ControlRight') unlockAudio();
      S.ui.touch = false;
      switch (k) {
        case 'ArrowLeft': case 'ArrowRight': case 'ControlLeft': case 'ControlRight': setFlip(k, true); break;
        case 'Space': if (!held.space) { held.space = true; game.launchDown(); } break;
        case 'KeyP': case 'Escape': game.togglePause(); break;
        case 'KeyM': toggleMute(); break;
        case 'KeyF': toggleFullscreen(); break;
        default: break;
      }
    }, { passive: false });
    g.addEventListener('keyup', (e) => {
      const k = keyOf(e);
      if (!k) return;
      e.preventDefault();
      switch (k) {
        case 'ArrowLeft': case 'ArrowRight': setFlip(k, false); break;
        case 'ControlLeft': case 'ControlRight':
          // The browser says no Ctrl key is down any more: forget both, even if the release of the other one was swallowed
          // (Windows does that for the first Ctrl release while the second one is still held).
          if (e.ctrlKey === false) { flip.ControlLeft = flip.ControlRight = false; }
          setFlip(k, false);
          break;
        case 'Space': if (held.space) { held.space = false; game.launchUp(); } break;
        default: break;
      }
    }, { passive: false });

    // A window that loses focus never sees the key releases: let go of everything and pause a game that is running.
    // Pause FIRST: pause() cancels a plunger charge, so the releaseAll() below cannot fire a half charged ball (F36).
    function goAway() {
      if (!params.autoplay && S.screen !== 'goodbye') game.pause({ silent: true });      // the goodbye has nothing to pause: it just waits
      releaseAll();
    }
    g.addEventListener('blur', goAway);
    g.addEventListener('pagehide', goAway);
    g.addEventListener('focus', () => { try { canvas.focus(); } catch (err) { /* not needed */ } });      // the keys come back to the page (F16)
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) goAway();
      syncAudio();
    });

    // ---- pointer and touch ------------------------------------------------------------------------------------
    const pointers = new Map();          // pointerId -> {role}
    function localXY(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function hitButton(p) {
      const list = render.layout && render.layout.buttons;
      if (!list) return null;
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        const cx = b.x !== undefined ? b.x : b.cx - b.r, cy = b.y !== undefined ? b.y : b.cy - b.r;
        const w = b.w !== undefined ? b.w : b.r * 2, h = b.h !== undefined ? b.h : b.r * 2;
        if (p.x >= cx && p.x <= cx + w && p.y >= cy && p.y <= cy + h) return b.id;
      }
      return null;
    }
    function roleAt(p) {
      const id = hitButton(p);
      if (id) return id;
      const L = render.layout, t = L && L.table;
      if (!t) return p.x < canvas.clientWidth / 2 ? 'left' : 'right';
      if (p.x < t.x || p.x > t.x + t.w || p.y < t.y || p.y > t.y + t.h) return '';
      const scale = L.scale || (t.w / 540);
      const tx = (p.x - t.x) / scale, ty = (p.y - t.y) / scale;
      if (tx > 470 && ty > 560) return 'launch';                       // the shooter lane: a press there is Space
      return tx < 270 ? 'left' : 'right';
    }
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (pointers.has(e.pointerId)) pointerEnd(e);          // a second down for the same pointer must not leave a flipper stuck (pointerEnd is idempotent)
      unlockAudio();
      if (e.pointerType === 'touch' || e.pointerType === 'pen') S.ui.touch = true;
      try { canvas.focus(); canvas.setPointerCapture(e.pointerId); } catch (err) { /* not needed */ }
      const role = roleAt(localXY(e));
      switch (role) {
        case 'sound': toggleMute(); return;
        case 'music': toggleMusic(); return;
        case 'fullscreen': toggleFullscreen(); return;
        case 'pause': game.pointer('pause'); return;
        default: break;
      }
      if (S.screen === 'title' || S.screen === 'over' || S.screen === 'goodbye') { game.launchDown(); game.launchUp(); return; }      // goodbye: a poke only
      if (S.screen === 'paused') { game.resume(); return; }
      if (role === 'left') { touch.left++; pointers.set(e.pointerId, 'left'); pushKeys(); }
      else if (role === 'right') { touch.right++; pointers.set(e.pointerId, 'right'); pushKeys(); }
      else if (role === 'launch') { touch.launch++; pointers.set(e.pointerId, 'launch'); if (touch.launch === 1) game.launchDown(); }
    });
    function pointerEnd(e) {
      const role = pointers.get(e.pointerId);
      if (!role) return;
      pointers.delete(e.pointerId);
      if (role === 'left') touch.left = Math.max(0, touch.left - 1);
      else if (role === 'right') touch.right = Math.max(0, touch.right - 1);
      else if (role === 'launch') { touch.launch = Math.max(0, touch.launch - 1); if (touch.launch === 0) game.launchUp(); }
      pushKeys();
    }
    canvas.addEventListener('pointerup', pointerEnd);
    canvas.addEventListener('pointercancel', pointerEnd);
    canvas.addEventListener('lostpointercapture', pointerEnd);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // ---- size -------------------------------------------------------------------------------------------------
    function resize() { try { render.resize(); } catch (err) { once('resize', err); } }
    g.addEventListener('resize', resize);
    g.addEventListener('orientationchange', resize);
    doc.addEventListener('fullscreenchange', resize);
    resize();
    try { canvas.focus(); } catch (err) { /* ignore */ }

    // ---- debug overlay (debug=1) ------------------------------------------------------------------------------
    let dbg = null, dbgAt = 0;
    if (params.debug) {
      dbg = doc.createElement('pre');
      dbg.style.cssText = 'position:fixed;left:6px;top:6px;margin:0;padding:4px 8px;font:12px/1.35 monospace;color:#cfe;background:rgba(0,0,20,.55);pointer-events:none;border-radius:6px;z-index:9';
      doc.body.appendChild(dbg);
    }
    function updateDebug(now) {
      if (!dbg || now - dbgAt < 0.25) return;
      dbgAt = now;
      const rs = render.stats || {};
      const lm = S.limit;
      dbg.textContent = 'screen ' + S.screen + '  ball ' + S.ballNo + '/' + S.ballsTotal + '  score ' + S.score + '  x' + S.multiplier +
        (lm && lm.enabled ? '  limit ' + lm.phase + ' ' + Math.round(lm.playSec) + '/' + Math.round(lm.limitSec) + ' s' : '  limit off') +
        '\nfps ' + (rs.fps !== undefined ? Math.round(rs.fps) : '?') + '  frame ' + (rs.ms !== undefined ? (+rs.ms).toFixed(1) : '?') + ' ms  q ' + rs.quality +
        '  particles ' + (rs.particles || 0) + '\nmusic ' + musicMode + '  seed ' + seed + (params.autoplay ? '  AUTOPLAY ' + params.skill : '');
    }

    // ---- the loop ---------------------------------------------------------------------------------------------
    let last = 0;
    const maxDt = CFG.MAX_FRAME_DT || 1 / 20;
    function frame(ts) {
      g.requestAnimationFrame(frame);
      const now = ts / 1000;
      let dt = last ? now - last : 0;
      last = now;
      if (!(dt > 0)) dt = 0;
      const wallDt = Math.min(1, dt);                                   // the real time of this frame, for the play time clock only
      if (dt > maxDt) dt = maxDt;                                       // a hidden tab or a long stall must not fast forward the game
      try { game.update(dt, wallDt); } catch (err) { once('game.update', err); }
      A('update', dt);
      try { syncAudio(); } catch (err) { once('audio', err); }
      try { render.draw(now); } catch (err) { once('render.draw', err); }
      updateDebug(now);
    }
    g.requestAnimationFrame(frame);

    if (params.mute) { ui.muted = true; S.ui.muted = true; A('setMuted', true); }
    if (params.screen) {
      if ((params.screen === 'over' || params.screen === 'goodbye') && S.score === 0) game.debug.setScore(18500);
      game.debug.forceScreen(params.screen);
    }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : window);
