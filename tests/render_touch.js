'use strict';
// Touch test of the real game (renderer layout.buttons + 90_main.js pointer code) in emulated phone and tablet contexts.
//   node tests/render_touch.js [file]        default dist/pacman-flipper.html
// Uses real touch events through the DevTools protocol (a finger can be held, which page.touchscreen.tap cannot do).
const path = require('path');
const { chromium } = require('playwright-core');
const { EDGE, OUT } = require('./browser_helper');
const ROOT = path.join(__dirname, '..');
const FILE = path.resolve(ROOT, process.argv[2] || 'dist/pacman-flipper.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, detail) { if (!ok) failures++; console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? '  (' + detail + ')' : '')); }

async function run(label, vp) {
  console.log('== ' + label + ' ' + vp.w + 'x' + vp.h);
  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e && e.stack || e)));
  const cdp = await context.newCDPSession(page);
  const touch = async (type, x, y, id) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: id || 1 }] });
  const tap = async (x, y) => { await touch('touchStart', x, y); await sleep(60); await touch('touchEnd'); await sleep(120); };
  await page.goto('file:///' + FILE.split(path.sep).join('/') + '?mute=1&seed=4');
  await page.waitForFunction(() => window.PM_DEBUG, null, { timeout: 15000 });
  await sleep(600);
  const S = () => page.evaluate(() => { const s = PM_DEBUG.game.state; return { screen: s.screen, touch: s.ui.touch, waiting: s.launch.waiting, keys: Object.assign({}, s.keys), score: s.score }; });
  const L = await page.evaluate(() => JSON.parse(JSON.stringify(PM_DEBUG.render.layout)));
  let s = await S();
  check('starts in touch mode on a touch device (before any touch)', s.touch === true);
  await page.screenshot({ path: path.join(OUT, 'r2_touch_title_' + vp.w + 'x' + vp.h + '.png') });
  await tap(vp.w / 2, vp.h / 2);
  s = await S();
  check('a tap on the title starts the game', s.screen === 'play');
  const L2 = await page.evaluate(() => JSON.parse(JSON.stringify(PM_DEBUG.render.layout)));
  const ids = L2.buttons.map((b) => b.id);
  check('layout has the touch buttons', ['sound', 'music', 'pause', 'fullscreen', 'left', 'launch', 'right'].every((i) => ids.includes(i)), ids.join(','));
  const inside = L2.buttons.every((b) => b.x >= -1 && b.y >= -1 && b.x + b.w <= vp.w + 1 && b.y + b.h <= vp.h + 1);
  check('all buttons are inside the window', inside);
  // the big three tile without overlap
  const big = L2.buttons.filter((b) => ['left', 'launch', 'right'].includes(b.id));
  let overlap = false;
  for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) {
    const a = big[i], b = big[j];
    if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) overlap = true;
  }
  check('left, launch and right zones do not overlap', !overlap);
  const btn = (id) => L2.buttons.find((b) => b.id === id);
  const c = (b) => [b.x + b.w / 2, b.y + b.h / 2];
  // hold the left zone with one finger, the right zone with another
  let [x, y] = c(btn('left'));
  await touch('touchStart', x, y, 1); await sleep(100);
  s = await S(); check('a finger on the left zone lifts the left flipper', s.keys.left && !s.keys.right);
  [x, y] = c(btn('right'));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c(btn('left'))[0], y: c(btn('left'))[1], id: 1 }, { x, y, id: 2 }] });
  await sleep(100);
  s = await S(); check('two fingers: both flippers', s.keys.left && s.keys.right);
  await touch('touchEnd'); await sleep(100);
  s = await S(); check('lifting the fingers lowers the flippers', !s.keys.left && !s.keys.right);
  // the launch zone fires the ball
  [x, y] = c(btn('launch'));
  s = await S(); check('a ball waits in the lane', s.waiting);
  await touch('touchStart', x, y, 1); await sleep(500);
  const chg = await page.evaluate(() => PM_DEBUG.game.state.launch.charge);
  check('holding the launch zone charges the plunger', chg > 0.2, 'charge ' + chg.toFixed(2));
  await page.screenshot({ path: path.join(OUT, 'r2_touch_charge_' + vp.w + 'x' + vp.h + '.png') });
  await touch('touchEnd'); await sleep(400);
  s = await S(); check('releasing fires the ball', !s.waiting);
  // small buttons
  [x, y] = c(btn('pause')); await tap(x, y);
  s = await S(); check('the pause button pauses', s.screen === 'paused');
  await page.screenshot({ path: path.join(OUT, 'r2_touch_pause_' + vp.w + 'x' + vp.h + '.png') });
  await tap(vp.w / 2, vp.h / 2);
  s = await S(); check('a tap resumes', s.screen === 'play');
  const m0 = await page.evaluate(() => PM_DEBUG.game.state.ui.muted);
  [x, y] = c(btn('sound')); await tap(x, y);
  const m1 = await page.evaluate(() => PM_DEBUG.game.state.ui.muted);
  check('the sound button toggles mute', m0 !== m1);
  // a keyboard press switches back to the keyboard layout (a tablet with a keyboard)
  await page.keyboard.press('ArrowLeft'); await sleep(100);
  const t2 = await S(); check('a key press leaves touch mode', t2.touch === false);
  // rotate: resize keeps everything valid
  await page.setViewportSize({ width: vp.h, height: vp.w }); await sleep(300);
  const L3 = await page.evaluate(() => PM_DEBUG.render.layout);
  check('rotating gives a valid layout', L3.scale > 0.05 && isFinite(L3.table.x) && isFinite(L3.table.y), 'mode ' + L3.mode + ' scale ' + L3.scale.toFixed(3));
  await page.screenshot({ path: path.join(OUT, 'r2_touch_rotated_' + vp.w + 'x' + vp.h + '.png') });
  check('no console or page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close();
}

(async () => {
  await run('phone', { w: 390, h: 844 });
  await run('tablet', { w: 1024, h: 768 });
  console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL PASS'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
