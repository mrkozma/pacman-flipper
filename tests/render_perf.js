'use strict';
// Measures the cost of PM.Render draw() in headless Edge (software rendering, so real GPUs do better).
//   node tests/render_perf.js [--vp 1280x720] [--frames 900] [--dpr 1] [--no-build] [--dev dist/_dev_x.html]
// Prints mean, p95, p99 and max milliseconds per draw() while the bot plays a real game (or the fake game with --fake).
const path = require('path');
const { execFileSync } = require('child_process');
const { openGame } = require('./browser_helper');
const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const DEV = opt('dev', 'dist/_dev_r.html');   // --dev dist/_dev_x.html to keep clear of other builds
const [W, H] = String(opt('vp', '1280x720')).split('x').map(Number);
const FRAMES = Number(opt('frames', 900)), DPR = Number(opt('dpr', 1));

async function main() {
  if (!argv.includes('--no-build')) execFileSync('python', ['tools/build.py', '--only', '00,05,06,10,20,30,40,50,60,70', '--no-voice', '--out', DEV], { cwd: ROOT, stdio: 'inherit' });
  const g = await openGame({ file: DEV, viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  await g.page.addScriptTag({ path: path.join(__dirname, 'fake_state.js') });
  await g.page.evaluate(() => PM.Theme.fontsReady);
  // a real requestAnimationFrame loop: the browser presents every frame, like a player would see it
  const res = await g.page.evaluate((frames) => new Promise((resolve) => {
    const canvas = document.getElementById('game');
    const useReal = !!(PM.Game && PM.Game.create);
    const game = (useReal ? PM.Game.create : PM.FakeGame.create)({ seed: 3, autoplay: true, hiScore: 48250 });
    const render = PM.Render.create(canvas, game);
    game.start();
    const draws = [], gaps = [];
    let n = 0, last = null;
    function frame(ts) {
      const t = ts / 1000;
      const dt = last == null ? 1 / 60 : Math.min(0.05, t - last);
      if (last != null) gaps.push((t - last) * 1000);
      last = t;
      game.update(dt);
      const a = performance.now(); render.draw(t); draws.push(performance.now() - a);
      n++;
      if (n === 300 && game.debug.triggerSurprise) game.debug.triggerSurprise('balloons');
      if (n === 450 && game.debug.givePower) game.debug.givePower();
      if (n < frames) requestAnimationFrame(frame);
      else {
        const stat = (arr) => { const s = arr.slice().sort((x, y) => x - y); const m = arr.reduce((x, y) => x + y, 0) / arr.length; return { mean: +m.toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), p99: +s[Math.floor(s.length * 0.99)].toFixed(2), max: +s[s.length - 1].toFixed(2) }; };
        resolve({ real: useReal, drawMs: stat(draws.slice(5)), frameGapMs: stat(gaps.slice(5)), quality: render.quality, particles: render.stats.particles });
      }
    }
    requestAnimationFrame(frame);
  }), FRAMES);
  console.log(W + 'x' + H + ' dpr' + DPR, JSON.stringify(res));
  if (g.errors.length) { console.log('ERRORS', g.errors); process.exitCode = 1; }
  await g.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
