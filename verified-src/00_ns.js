/* 00_ns.js: PM namespace, shared utilities, and a silent stand-in for PM.Audio.
   DOM-free. Runs in Node and in the browser. Frozen: change only with a SPEC.md change-log entry. */
(function (g) {
  'use strict';
  const PM = g.PM = g.PM || {};
  PM.VERSION = '1.0.0';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const easeOutBack = (t) => { t = clamp(t, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const easeOutCubic = (t) => { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); };
  const wrapAngle = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; };

  // Seeded PRNG (mulberry32). rng() -> [0,1). Helpers hang off the function.
  function rng(seed) {
    let s = (seed >>> 0) || 0x9E3779B9;
    const f = function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (a, b) => a + (b - a) * f();
    f.int = (n) => Math.floor(f() * n);
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.chance = (p) => f() < p;
    return f;
  }

  // Fisher-Yates using a given rng; returns a new array.
  function shuffle(arr, r) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Shuffle bag: draws every item once before repeating (never the same item twice in a row across refills).
  function bag(items, r) {
    let queue = [];
    let last = null;
    return {
      next() {
        if (!queue.length) {
          queue = shuffle(items, r);
          if (queue.length > 1 && queue[queue.length - 1] === last) { const t = queue[0]; queue[0] = queue[queue.length - 1]; queue[queue.length - 1] = t; }
        }
        last = queue.pop();
        return last;
      }
    };
  }

  PM.util = { TAU, clamp, lerp, smooth, easeOutBack, easeOutCubic, wrapAngle, rng, shuffle, bag };

  // Silent stand-in so DOM-free code (game logic, tests) can always call PM.Audio.*.
  // 80_audio.js REPLACES this object by assigning PM.Audio at load time. Game code must read PM.Audio at call time.
  PM.Audio = {
    isNull: true,
    unlock() { return Promise.resolve(); },
    loadVoices() { return Promise.resolve(); },
    sfx() {},
    voice() { return false; },
    voiceBusy() { return false; },
    stopVoice() {},
    setMusic() {},
    setVolumes() {},
    getVolumes() { return { master: 1, music: 1, sfx: 1, voice: 1 }; },
    setMuted() {},
    isMuted() { return false; },
    setMusicOn() {},
    isMusicOn() { return true; },
    suspend() {},
    resume() {},
    update() {}
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
