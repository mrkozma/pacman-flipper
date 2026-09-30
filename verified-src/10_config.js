/* 10_config.js: shared constants. DOM-free. Add keys as needed; do not rename existing ones. */
(function (g) {
  'use strict';
  const PM = g.PM = g.PM || {};
  PM.CFG = {
    W: 540,                 // table width in table units
    H: 960,                 // table height in table units
    BALL_R: 10,             // ball radius
    PHYS_HZ: 480,           // fixed physics substep rate
    MAX_FRAME_DT: 1 / 20,   // longest frame the loop will simulate (tab switches etc.)
    BALLS_PER_GAME: 5,
    BALL_SAVE_SECONDS: 15,
    KIND_BALL_SAVE_SECONDS: 30,
    MAX_BALL_SPEED: 950,
    POWER_SECONDS: 10,
    SURPRISE_MIN_SECONDS: 8,
    SURPRISE_MAX_SECONDS: 12,
    SURPRISE_COOLDOWN: 20,
    PELLET_RESPAWN: 15,
    HOLD_SECONDS: 1.4,
    MAX_PARTICLES: 60,
    FRUITS: ['cherry', 'strawberry', 'orange', 'apple', 'pear', 'grapes'],
    FRUIT_POINTS: { cherry: 300, strawberry: 500, orange: 700, apple: 1000, pear: 1500, grapes: 2000 },
    GHOSTS: {
      piri: { color: 'red' }, rozi: { color: 'pink' }, kiki: { color: 'cyan' }, nori: { color: 'orange' }
    },
    SURPRISES: ['bigflip', 'slow', 'balloons', 'fruits', 'dance', 'shield', 'extraball'],
    BALL_DRAW_SCALE: 1.35,        // the Pacman ball is drawn this much larger than its physics radius so it reads as a character
    PLAY_LIMIT_SECONDS: 600,      // about ten minutes of active play, then Pacman says goodbye after the last ball (0 = off, ?perc=N overrides in minutes)
    LIMIT_NOTICE_SECONDS: 9,      // how long the "Pacman comes out" notice stays before it becomes a small badge
    LOG_KEY: 'pacmanFlipper.v1'   // localStorage key for hi-score and settings
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
