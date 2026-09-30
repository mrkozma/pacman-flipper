'use strict';
// Smoke test with the real boot file (90_main.js): title, a few seconds of autoplay, a touch tap, resize.
//   node tests/render_main_smoke.js   -> tests/out/r_main_*.png, exit 1 on console errors
const path = require('path');
const { execFileSync } = require('child_process');
const { openGame } = require('./browser_helper');
const ROOT = path.join(__dirname, '..');
(async () => {
  if (!process.argv.includes('--no-build')) execFileSync('python', ['tools/build.py', '--only', '00,05,06,10,20,30,40,50,60,70,80,90', '--no-voice', '--out', 'dist/_dev_r_main.html'], { cwd: ROOT, stdio: 'inherit' });
  const g = await openGame({ file: 'dist/_dev_r_main.html', viewport: { width: 1280, height: 720 }, query: '?autoplay=1&seed=3&mute=1' });
  await g.page.waitForFunction(() => window.PM_DEBUG);
  await g.page.waitForTimeout(6000);
  await g.shot('r_main_play_1280x720');
  const info = await g.page.evaluate(() => { const r = window.PM_DEBUG.render; return { q: r.quality, fps: Math.round(r.stats.fps), ms: +r.stats.ms.toFixed(2), screen: window.PM_DEBUG.game.state.screen }; });
  console.log(JSON.stringify(info));
  await g.page.setViewportSize({ width: 800, height: 1000 });
  await g.page.waitForTimeout(800);
  await g.shot('r_main_play_800x1000');
  await g.page.setViewportSize({ width: 390, height: 844 });
  await g.page.waitForTimeout(800);
  await g.shot('r_main_play_390x844');
  console.log('errors', g.errors.length); g.errors.slice(0, 10).forEach((e) => console.log('  ', e.split('\n')[0]));
  await g.close();
  process.exit(g.errors.length ? 1 : 0);
})();
