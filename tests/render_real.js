'use strict';
// Photographs the REAL game (40_game.js + 70_render.js + 90_main.js) in headless Edge, driven through the real main loop.
//   node tests/render_real.js                      all scenes at all four viewports  -> tests/out/r2_<scene>_<viewport>.png
//   node tests/render_real.js --vp 1280x720        only some viewports (comma list)
//   node tests/render_real.js --scenes title,mid   only some scenes (comma list)
//   node tests/render_real.js --file dist/x.html   another build (default dist/_dev_r2.html)
//   node tests/render_real.js --no-build           reuse the build
//   node tests/render_real.js --dpr 2              device pixel ratio 2
//   node tests/render_real.js --clip table         crop every picture to the table
//   node tests/render_real.js --sheet              also write one montage per viewport (tests/out/r2_sheet_<viewport>.png)
// requestAnimationFrame is replaced by a manual clock (window.__step(n) runs n frames of exactly 1/60 s), so every picture
// is deterministic. Real key presses go through page.keyboard, so 90_main.js input handling is part of the test.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { openGame, OUT, EDGE } = require('./browser_helper');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const FILE = String(opt('file', 'dist/_dev_r2.html'));
const DPR = Number(opt('dpr', 1)) || 1;
const CLIP = opt('clip', '');
const wantVp = opt('vp', '') ? String(opt('vp')).split(',') : null;
const wantScenes = opt('scenes', '') ? String(opt('scenes')).split(',') : null;
const VIEWPORTS = [
  { name: '1280x720', w: 1280, h: 720 },
  { name: '1920x1080', w: 1920, h: 1080 },
  { name: '800x1000', w: 800, h: 1000 },
  { name: '390x844', w: 390, h: 844, touch: true }
];

function build() {
  execFileSync('python', ['tools/build.py', '--only', '00,05,06,10,20,30,40,50,60,70,90', '--no-voice', '--out', FILE], { cwd: ROOT, stdio: 'inherit' });
}

// Manual clock, installed before the page scripts run.
function clockScript() {
  window.__cbs = []; window.__ts = 0;
  window.requestAnimationFrame = (cb) => { window.__cbs.push(cb); return window.__cbs.length; };
  window.__step = (n) => {
    for (let i = 0; i < (n || 1); i++) {
      const cbs = window.__cbs; window.__cbs = []; window.__ts += 1000 / 60;
      for (const cb of cbs) cb(window.__ts);
    }
  };
}

// ---- scenes: each is an async function (page, helpers) ---------------------------------------------------------------
// h.step(frames)  h.sec(seconds)  h.eval(fn, arg)  h.key(type, code)  h.until(fnString, maxSeconds)
const SCENES = {};
const scene = (name, fn) => { SCENES[name] = fn; };

scene('title', async (h) => { await h.sec(3.2); });
scene('ready', async (h) => { await h.tap('Space'); await h.sec(2.0); });
scene('hint', async (h) => { await h.tap('Space'); await h.sec(1); await h.eval(() => { PM_DEBUG.game.state.launch.idle = 9; }); await h.sec(1.4); });
scene('charge', async (h) => { await h.tap('Space'); await h.sec(4); await h.down('Space'); await h.sec(0.75); });
scene('flipUp', async (h) => { await h.tap('Space'); await h.sec(2); await h.down('ArrowLeft'); await h.down('ArrowRight'); await h.sec(0.5); });
scene('launched', async (h) => {
  await h.tap('Space'); await h.sec(4); await h.down('Space'); await h.sec(0.8); await h.up('Space'); await h.sec(0.5);
});
scene('mid', async (h) => {
  await h.until(() => PM_DEBUG.game.state.screen === 'play', 5); await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(12340); G.debug.fillDots(30); G.state.fruitTray = ['cherry', 'strawberry']; });
  await h.sec(0.2);
  await h.until(() => { const G = PM_DEBUG.game; if (G.state.screen !== 'play') return false; for (const b of G.world.balls) if (b.state === 'play' && Math.hypot(b.vx, b.vy) > 420 && b.y > 250 && b.y < 700) return true; return false; }, 60);
});
scene('dots', async (h) => {
  await h.until(() => PM_DEBUG.game.state.screen === 'play', 5); await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(3200); G.debug.lightLanes(2); });
  await h.sec(0.2);
  await h.until(() => { const G = PM_DEBUG.game; return G.state.screen === 'play' && G.state.dotsLeft < G.state.dotsTotal - 6 && G.world.balls.some((b) => b.state === 'play' && b.y > 300 && b.y < 720); }, 60);
});
scene('power', async (h) => {
  await h.tap('Space'); await h.sec(0.3); await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(5400); G.debug.givePower(); });
  await h.until(() => PM_DEBUG.game.state.power && PM_DEBUG.game.state.power.t > 1.3 && PM_DEBUG.game.world.balls.some((b) => b.state === 'play'), 40);
});
scene('bonk', async (h) => {
  await h.tap('Space'); await h.sec(0.3); await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(5400); G.debug.givePower(); });
  await h.sec(1.2);
  await h.eval(() => { const G = PM_DEBUG.game; const b = G.world.balls[0]; const gh = G.state.ghosts[0]; G.debug.inject({ t: 'bumper', id: 'piri', ballId: b.id, speed: 500, x: gh.x, y: gh.y }); });
  await h.sec(0.35);
});
scene('bonk2', async (h) => {
  await h.tap('Space'); await h.sec(0.3); await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(5400); G.debug.givePower(); });
  await h.sec(1.2);
  await h.eval(() => { const G = PM_DEBUG.game; const b = G.world.balls[0]; for (const gh of G.state.ghosts.slice(0, 2)) G.debug.inject({ t: 'bumper', id: gh.id, ballId: b.id, speed: 500, x: gh.x, y: gh.y }); });
  await h.sec(1.0);
});
scene('bump', async (h) => {
  await h.tap('Space'); await h.sec(0.3);
  await h.eval(() => { const G = PM_DEBUG.game; const b = G.world.balls[0]; const gh = G.state.ghosts[1]; G.debug.inject({ t: 'bumper', id: gh.id, ballId: b.id, speed: 500, x: gh.x, y: gh.y }); });
  await h.sec(0.2);
});
for (const id of ['bigflip', 'slow', 'balloons', 'fruits', 'dance', 'shield', 'extraball']) {
  scene('sur_' + id, async (h) => {
    await h.tap('Space'); await h.sec(0.3); await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(4500); G.debug.fillDots(30); });
    await h.sec(0.6); await h.eval((sid) => PM_DEBUG.game.debug.triggerSurprise(sid), id); await h.sec(1.7);
  });
  scene('surL_' + id, async (h) => {
    await h.tap('Space'); await h.sec(0.3); await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(4500); G.debug.fillDots(30); });
    await h.sec(0.6); await h.eval((sid) => PM_DEBUG.game.debug.triggerSurprise(sid), id); await h.sec(6);
  });
}
scene('mystery', async (h) => {
  await h.tap('Space'); await h.sec(0.3); await h.eval(() => { const G = PM_DEBUG.game; const b = G.world.balls[0]; G.debug.inject({ t: 'target', id: 'mystery', ballId: b.id, speed: 500 }); });
  await h.sec(0.7);
});
scene('fruit', async (h) => {
  await h.tap('Space'); await h.sec(0.3); await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(2500); G.debug.fillDots(30); G.debug.spawnFruit('strawberry'); });
  await h.sec(1.0);
});
scene('fruitGot', async (h) => {
  await h.tap('Space'); await h.sec(0.3); await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(2500); G.debug.fillDots(30); G.debug.spawnFruit('apple'); const b = G.world.balls[0]; G.debug.inject({ t: 'sensor', id: 'fruit', kind: 'fruit', ballId: b.id, x: G.state.fruit.x, y: G.state.fruit.y }); });
  await h.sec(0.5);
});
scene('levelClear', async (h) => {
  await h.tap('Space'); await h.sec(0.3); await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(2500); G.debug.fillDots(0); });
  await h.sec(1.0);
});
scene('level2', async (h) => {
  await h.tap('Space'); await h.sec(0.3); await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(2500); G.debug.fillDots(0); });
  await h.sec(4.0);
});
scene('lanes', async (h) => {
  await h.tap('Space'); await h.sec(0.3);
  await h.eval(() => { const G = PM_DEBUG.game; G.debug.lightLanes(2); const b = G.world.balls[0]; G.debug.inject({ t: 'sensor', id: 'lane3', kind: 'lane', ballId: b.id, x: 300, y: 100 }); });
  await h.sec(0.6);
});
scene('save', async (h) => {
  await h.tap('Space'); await h.sec(0.3); await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(9100); });
  await h.down('Space'); await h.sec(0.6); await h.up('Space'); await h.sec(0.6);
  await h.eval(() => { PM_DEBUG.game.debug.drain(); }); await h.sec(0.55);
});
scene('spit', async (h) => {
  await h.tap('Space'); await h.sec(0.3); await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(9100); });
  await h.down('Space'); await h.sec(0.6); await h.up('Space'); await h.sec(0.6);
  await h.eval(() => { PM_DEBUG.game.debug.drain(); }); await h.sec(1.25);
});
scene('drain', async (h) => {
  await h.tap('Space'); await h.sec(0.3); await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(3100); G.debug.setBallSave(0); G.debug.launchNow(0.4); });
  await h.sec(0.5); await h.eval(() => { const G = PM_DEBUG.game; G.state.ballSave = 0; G.debug.drain(); }); await h.sec(0.9);
});
scene('lock', async (h) => {
  await h.tap('Space'); await h.sec(0.3); await h.eval(() => { const G = PM_DEBUG.game; G.debug.launchNow(0.4); }); await h.sec(1.2);
  await h.eval(() => PM_DEBUG.game.debug.forceMultiball()); await h.sec(1.0);
});
scene('multiball', async (h) => {
  await h.tap('Space'); await h.sec(0.3); await h.eval(() => { const G = PM_DEBUG.game; G.debug.launchNow(0.4); }); await h.sec(1.2);
  await h.eval(() => PM_DEBUG.game.debug.forceMultiball()); await h.sec(0.8);
  await h.tap('Space'); await h.sec(1.0);
});
scene('nori', async (h) => { await h.tap('Space'); await h.sec(0.3); await h.eval(() => PM_DEBUG.game.debug.nori()); await h.sec(0.9); });
scene('mult', async (h) => {
  await h.tap('Space'); await h.sec(0.3);
  await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(60500); G.debug.setMultiplier(4); G.state.ballNo = 3; G.state.ballsLeft = 2; G.state.level = 3; G.state.fruitTray = ['cherry', 'strawberry', 'orange', 'apple', 'pear']; });
  await h.sec(1.2);
});
scene('paused', async (h) => {
  await h.tap('Space'); await h.sec(0.5); await h.eval(() => PM_DEBUG.game.debug.setScore(3300)); await h.sec(0.3); await h.tap('KeyP'); await h.sec(1.4);
});
scene('over1', async (h) => {
  await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(4200); G.debug.forceScreen('over'); }); await h.sec(3.6);
});
scene('over2', async (h) => {
  await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(21000); G.debug.forceScreen('over'); }); await h.sec(4.4);
});
scene('over3', async (h) => {
  await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(81200); G.debug.forceScreen('over'); }); await h.sec(5.6);
});
scene('overStar1', async (h) => {
  await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(81200); G.debug.forceScreen('over'); }); await h.sec(1.6);
});
scene('record', async (h) => {
  await h.tap('Space'); await h.sec(0.3);
  await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(0); });
  await h.eval(() => { const G = PM_DEBUG.game; G.debug.setScore(2000); G.debug.forceScreen('over'); }); await h.sec(4);
});
scene('delight', async (h) => {
  await h.tap('Space'); await h.sec(0.3); await h.eval(() => { const G = PM_DEBUG.game; G.state.delights.push({ id: 900, kind: 'pacman', x: 0.2, y: 0.45, dir: 1, size: 0.05, t: 2, dur: 9, color: '#FFD84A', side: '' }); G.state.delights.push({ id: 901, kind: 'ghost', x: 0.97, y: 0.7, dir: -1, size: 0.055, t: 3, dur: 6.5, color: 'pink', side: 'right' }); });
  await h.sec(0.3);
});
scene('clutter', async (h) => {
  await h.tap('Space'); await h.sec(0.3); await h.eval(() => { const G = PM_DEBUG.game; G.debug.launchNow(0.4); G.debug.setScore(70200); G.debug.setMultiplier(3); }); await h.sec(1.2);
  await h.eval(() => {
    const G = PM_DEBUG.game, D = G.debug; D.forceMultiball(); D.givePower(); D.triggerSurprise('balloons'); D.spawnFruit('pear'); D.setBallSave(9);
    const b = G.world.balls[0];
    for (const gh of G.state.ghosts) D.inject({ t: 'bumper', id: gh.id, ballId: b.id, speed: 500, x: gh.x, y: gh.y });
    D.inject({ t: 'target', id: 'mystery', ballId: b.id, speed: 500 });
  });
  await h.sec(1.4);
});
scene('auto1', async (h) => { await h.sec(45); });
scene('auto2', async (h) => { await h.sec(120); });

// --strip N --total S: one autoplay session (skill 0.8), a picture every N simulated seconds, then contact sheets
async function strip() {
  const { chromium } = require('playwright-core');
  const every = Number(opt('strip', 5)), total = Number(opt('total', 180)), seed = Number(opt('seed', 21)), skill = String(opt('skill', '0.8'));
  for (const vp of VIEWPORTS) {
    if (wantVp && !wantVp.includes(vp.name)) continue;
    const browser = await chromium.launch({ executablePath: EDGE, headless: true });
    const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: DPR, hasTouch: !!vp.touch });
    const page = await context.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
    page.on('pageerror', (e) => errs.push('[pageerror] ' + (e && e.stack ? e.stack : e)));
    await context.addInitScript(clockScript);
    await page.goto('file:///' + path.resolve(ROOT, FILE).split(path.sep).join('/') + '?mute=1&autoplay=1&skill=' + skill + '&seed=' + seed);
    for (let i = 0; i < 60 && !(await page.evaluate(() => !!window.PM_DEBUG)); i++) await page.waitForTimeout(50);
    const names = [];
    for (let k = 0; k * every < total; k++) {
      await page.evaluate((n) => window.__step(n), Math.round(every * 60));
      const name = 'r2_strip_' + vp.name + '_' + String(k).padStart(3, '0');
      await page.screenshot({ path: path.join(OUT, name + '.png') });
      names.push(name);
    }
    const info = await page.evaluate(() => { const s = PM_DEBUG.game.state; return { score: s.score, ball: s.ballNo, level: s.level, screen: s.screen, stats: { banners: PM_DEBUG.game.stats.banners, surprises: PM_DEBUG.game.stats.surprises } }; });
    console.log(vp.name + ' ' + JSON.stringify(info) + (errs.length ? ' ERRORS ' + errs.slice(0, 3).join(' | ') : ' no errors'));
    await browser.close();
    const per = 12;
    for (let i = 0; i * per < names.length; i++) await montage(names.slice(i * per, (i + 1) * per), 'r2_stripsheet_' + vp.name + '_' + i + '.png', vp.w > 700 ? 4 : 6);
  }
}

async function main() {
  if (!argv.includes('--no-build')) build();
  if (opt('strip', false)) { await strip(); return; }
  const { chromium } = require('playwright-core');
  const errors = [], made = [];
  for (const vp of VIEWPORTS) {
    if (wantVp && !wantVp.includes(vp.name)) continue;
    const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    for (const name of Object.keys(SCENES)) {
      if (wantScenes && !wantScenes.includes(name)) continue;
      const auto = name.startsWith('auto') || name === 'mid' || name === 'dots';
      const query = '?mute=1&seed=' + (name.startsWith('auto') ? 21 : 7) + (auto ? '&autoplay=1&skill=0.8' : '');
      // a fresh context per picture: the clock script must be installed before the page scripts run
      const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: DPR, hasTouch: !!vp.touch });
      const page = await context.newPage();
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
      page.on('pageerror', (e) => errs.push('[pageerror] ' + (e && e.stack ? e.stack : e)));
      await context.addInitScript(clockScript);
      await page.goto('file:///' + path.resolve(ROOT, FILE).split(path.sep).join('/') + query);
      for (let i = 0; i < 60 && !(await page.evaluate(() => !!window.PM_DEBUG)); i++) await page.waitForTimeout(50);
      if (vp.touch) await page.evaluate(() => { PM_DEBUG.game.state.ui.touch = true; });
      const h = {
        async step(n) { await page.evaluate((k) => window.__step(k), n); },
        async sec(s) { await page.evaluate((k) => window.__step(Math.round(k * 60)), s); },
        async eval(fn, arg) { return page.evaluate(fn, arg); },
        async down(code) { await page.keyboard.down(code); await page.evaluate(() => window.__step(1)); },
        async up(code) { await page.keyboard.up(code); await page.evaluate(() => window.__step(1)); },
        async tap(code) { await page.keyboard.down(code); await page.evaluate(() => window.__step(3)); await page.keyboard.up(code); await page.evaluate(() => window.__step(2)); },
        async until(fn, maxSec) {
          const src = fn.toString();
          return page.evaluate(({ src, maxSec }) => { const f = eval('(' + src + ')'); for (let i = 0; i < maxSec * 60; i++) { window.__step(1); if (f()) return i / 60; } return -1; }, { src, maxSec });
        }
      };
      try {
        await h.sec(0.5);
        await SCENES[name](h);
        await page.waitForTimeout(40);
        const file = 'r2_' + name + '_' + vp.name + (CLIP ? '_clip' : '');
        if (CLIP) {
          const clip = await page.evaluate((mode) => {
            const L = PM_DEBUG.render.layout, t = L.table;
            if (mode === 'table') return { x: t.x, y: t.y, width: t.w, height: t.h };
            const a = String(mode).split(',').map(Number);
            return { x: a[0], y: a[1], width: a[2], height: a[3] };
          }, String(CLIP));
          await page.screenshot({ path: path.join(OUT, file + '.png'), clip: clip });
        } else await page.screenshot({ path: path.join(OUT, file + '.png') });
        made.push(file);
      } catch (e) { errs.push(name + ': ' + String(e.message).split('\n')[0]); }
      for (const e of errs) errors.push(name + ' @' + vp.name + ': ' + e);
      await context.close();
    }
    await browser.close();
  }
  if (argv.includes('--sheet')) {
    for (const vp of VIEWPORTS) {
      if (wantVp && !wantVp.includes(vp.name)) continue;
      const names = Object.keys(SCENES).filter((n) => !wantScenes || wantScenes.includes(n)).map((n) => 'r2_' + n + '_' + vp.name + (CLIP ? '_clip' : ''));
      await montage(names, 'r2_sheet_' + vp.name + '.png', vp.w > 700 && !CLIP ? 3 : 5);
    }
  }
  console.log('wrote ' + made.length + ' pictures to tests/out');
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
}

async function montage(names, outName, cols) {
  const { chromium } = require('playwright-core');
  const files = names.map((n) => path.join(OUT, n + '.png')).filter((f) => fs.existsSync(f));
  if (!files.length) return;
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const imgs = files.map((f) => '<img style="width:' + Math.floor(1600 / cols - 4) + 'px" src="data:image/png;base64,' + fs.readFileSync(f).toString('base64') + '">').join('');
  await page.setContent('<body style="margin:0;background:#000"><div style="display:grid;grid-template-columns:repeat(' + cols + ',max-content);gap:4px;width:max-content">' + imgs + '</div></body>');
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => { const d = document.querySelector('div').getBoundingClientRect(); return { w: Math.ceil(d.width), h: Math.ceil(d.height) }; });
  await page.setViewportSize({ width: box.w, height: box.h });
  await page.screenshot({ path: path.join(OUT, outName) });
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
