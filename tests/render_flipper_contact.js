'use strict';
// Checks that the drawn flippers are the physics flippers: while the real game (autoplay) runs on a manual clock, every time a
// slow ball touches a flipper, the gap between the ball and the capsule the renderer draws (pivot circle r0, tip circle r1,
// same as 70_render.js capsulePath) is measured. A gap of 0 means the ball rests exactly on the drawn surface.
//   node tests/render_flipper_contact.js [file]
const path = require('path');
const { chromium } = require('playwright-core');
const { EDGE, OUT } = require('./browser_helper');
const FILE = path.resolve(__dirname, '..', process.argv[2] || 'dist/pacman-flipper.html');
(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await context.addInitScript(() => {
    window.__cbs = []; window.__ts = 0;
    window.requestAnimationFrame = (cb) => { window.__cbs.push(cb); return 1; };
    window.__step = (n) => { for (let i = 0; i < n; i++) { const c = window.__cbs; window.__cbs = []; window.__ts += 1000 / 60; for (const f of c) f(window.__ts); } };
  });
  await page.goto('file:///' + FILE.split(path.sep).join('/') + '?mute=1&autoplay=1&seed=11&skill=1');
  for (let i = 0; i < 60 && !(await page.evaluate(() => !!window.PM_DEBUG)); i++) await page.waitForTimeout(50);
    const stats = await page.evaluate(() => {
    const G = PM_DEBUG.game, out = { contacts: 0, worst: 0, sum: 0, samples: [] };
    for (let f = 0; f < 60 * 240; f++) {
      window.__step(1);
      for (const b of G.world.balls) {
        if (b.state !== 'play') continue;
        for (const fl of G.world.flippers) {
          const ex = fl.px + Math.cos(fl.angle) * fl.len, ey = fl.py + Math.sin(fl.angle) * fl.len;
          const vx = ex - fl.px, vy = ey - fl.py, L2 = vx * vx + vy * vy;
          let u = ((b.x - fl.px) * vx + (b.y - fl.py) * vy) / L2; u = Math.max(0, Math.min(1, u));
          const cx = fl.px + vx * u, cy = fl.py + vy * u;
          const d = Math.hypot(b.x - cx, b.y - cy);
          const rad = fl.r0 + (fl.r1 - fl.r0) * u;      // the drawn capsule radius at that point
          const gap = d - rad - b.r;                     // 0 = the ball touches the drawn surface
          if (gap < 1.5 && gap > -6 && Math.hypot(b.vx, b.vy) < 250) {
            out.contacts++; out.sum += Math.abs(gap); out.worst = Math.max(out.worst, Math.abs(gap));
            if (out.samples.length < 6 && f % 40 === 0) out.samples.push({ f: f, x: fl.px, y: fl.py, bx: b.x, by: b.y, gap: +gap.toFixed(2) });
          }
        }
      }
    }
    return out;
  });
  console.log('note: the ball is drawn as a Pacman that is BALL_DRAW_SCALE times the physics ball (see 70_render.js), so on screen it overlaps the flipper by about (scale - 1) * BALL_R = ' + ((await page.evaluate(() => PM.CFG.BALL_DRAW_SCALE)) - 1) * 10 + ' units at each contact; that is intended (the ball sits in front of the flipper)');
  console.log('contacts (slow ball touching a flipper): ' + stats.contacts + ', mean |gap| ' + (stats.contacts ? (stats.sum / stats.contacts).toFixed(2) : 'n/a') + ' units, worst ' + stats.worst.toFixed(2) + ' units');
  await browser.close();
  process.exit(stats.contacts > 0 && stats.worst < 4 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
