'use strict';
// Adaptive quality: fake slow frames (draw() "costs" 8 ms at 30 fps) and check that render.quality drops, then fake fast
// frames and check that it climbs back. Exit code 1 when it does not.   node tests/render_quality.js
const { openGame } = require('./browser_helper');
(async () => {
  const g = await openGame({ file: process.argv[2] || 'dist/pacman-flipper.html', viewport: { width: 1280, height: 720 } });
  await g.page.evaluate(() => PM.Theme.fontsReady);
  const r = await g.page.evaluate(() => {
    const realNow = performance.now.bind(performance);
    let fake = 0; performance.now = () => (fake += 8);         // every draw() now "costs" 8 ms
    const game = PM.Game.create({ seed: 2, autoplay: true }); const render = PM.Render.create(document.getElementById('game'), game);
    game.start(); const log = []; let t = 0;
    for (let i = 0; i < 60 * 12; i++) { t += 0.03; game.update(0.03); render.draw(t); if (i % 30 === 0) log.push([+t.toFixed(1), render.quality, +render.stats.ms.toFixed(1), +render.stats.fps.toFixed(0)]); }
    const afterSlow = render.quality;
    fake = 0; performance.now = () => (fake += 0.5);           // fast again, at 60 fps
    for (let i = 0; i < 60 * 40; i++) { t += 1 / 60; game.update(1 / 60); render.draw(t); }
    return { log: log.slice(0, 14), afterSlow, afterRecovery: render.quality };
  });
  console.log(JSON.stringify(r));
  console.log('errors', g.errors.length);
  const ok = r.afterSlow < 2 && r.afterRecovery > r.afterSlow && !g.errors.length;
  console.log(ok ? 'quality test passed' : 'quality test FAILED');
  await g.close();
  process.exit(ok ? 0 : 1);
})();
