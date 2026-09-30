'use strict';
// Browser smoke test for the whole game (game + renderer + main) in headless Edge.
//   node tests/game_browser.js [file] [--shots] [--minutes N]
// Drives real keyboard events (ArrowLeft, ArrowRight, Space, P, M), checks that there are zero console and page errors,
// that every screen renders, that pause / blur / resize are stable, and (with --minutes) that autoplay survives a long run.
// Screenshots go to tests/out/g_*.png.
const path = require('path');
const { openGame, OUT } = require('./browser_helper');

const args = process.argv.slice(2);
const minutesAt = args.indexOf('--minutes');
const FILE = args.find((a, i) => !a.startsWith('--') && (minutesAt < 0 || i !== minutesAt + 1)) || 'dist/pacman-flipper.html';
const SHOTS = args.indexOf('--shots') >= 0;
const MINUTES = minutesAt >= 0 ? parseFloat(args[minutesAt + 1]) : 0;

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function state(page) {
  return page.evaluate(() => {
    const s = window.PM_DEBUG.game.state;
    return { screen: s.screen, score: s.score, ballNo: s.ballNo, ballsLeft: s.ballsLeft, multiplier: s.multiplier, banner: s.banner && s.banner.kind, power: !!s.power,
      surprise: s.surprise && s.surprise.id, launchWaiting: s.launch.waiting, keys: s.keys, stars: s.stars, level: s.level, dotsLeft: s.dotsLeft, time: s.time };
  });
}

(async () => {
  console.log('== browser smoke test: ' + FILE);
  // ---------------------------------------------------------------------------------------------------------
  let g = await openGame({ file: FILE, viewport: { width: 1280, height: 720 }, query: '?mute=1&seed=5' });
  await g.page.waitForFunction(() => window.PM_DEBUG, null, { timeout: 15000 });
  await sleep(600);
  let s = await state(g.page);
  check('boots to the title screen', s.screen === 'title');
  if (SHOTS) await g.shot('g_title');
  // Space starts
  await g.page.keyboard.down('Space'); await sleep(80); await g.page.keyboard.up('Space');
  await sleep(400);
  s = await state(g.page);
  check('Space starts the game with the ball waiting in the lane', s.screen === 'play' && s.launchWaiting && s.ballNo === 1);
  if (SHOTS) await g.shot('g_play_ready');
  // plunger: hold Space, look at the charge, release
  await g.page.keyboard.down('Space'); await sleep(600);
  const mid = await g.page.evaluate(() => window.PM_DEBUG.game.state.launch.charge);
  check('holding Space charges the plunger', mid > 0.3 && mid < 0.9, 'charge ' + mid.toFixed(2));
  if (SHOTS) await g.shot('g_play_charge');
  await g.page.keyboard.up('Space'); await sleep(900);
  s = await state(g.page);
  check('releasing Space fires the ball', !s.launchWaiting);
  // flippers with real keys
  await g.page.keyboard.down('ArrowLeft'); await g.page.keyboard.down('ArrowRight'); await sleep(200);
  s = await state(g.page);
  check('arrow keys move both flippers', s.keys.left && s.keys.right);
  const ang = await g.page.evaluate(() => window.PM_DEBUG.game.world.flippers.map((f) => f.angle));
  check('the flippers really are raised', ang[0] < 0.2 && ang[1] > Math.PI - 0.2, ang.map((a) => a.toFixed(2)).join(' '));
  if (SHOTS) await g.shot('g_play_flippers');
  await g.page.keyboard.up('ArrowLeft'); await g.page.keyboard.up('ArrowRight'); await sleep(200);
  s = await state(g.page);
  check('releasing the keys lowers the flippers', !s.keys.left && !s.keys.right);
  // let the game run with random key mashing for 20 s
  for (let i = 0; i < 40; i++) {
    const k = i % 2 ? 'ArrowLeft' : 'ArrowRight';
    await g.page.keyboard.down(k); await sleep(120); await g.page.keyboard.up(k); await sleep(200);
    if (i % 9 === 0) { await g.page.keyboard.down('Space'); await sleep(90); await g.page.keyboard.up('Space'); }
  }
  s = await state(g.page);
  check('20 s of key mashing keeps the game valid', (s.screen === 'play' || s.screen === 'over') && Number.isFinite(s.score), 'score ' + s.score + ', ball ' + s.ballNo);
  if (SHOTS) await g.shot('g_play_mash');
  // pause
  const before = await state(g.page);
  await g.page.keyboard.press('KeyP'); await sleep(300);
  s = await state(g.page);
  check('P pauses', s.screen === 'paused');
  if (SHOTS) await g.shot('g_paused');
  const t0 = (await state(g.page)).score; await sleep(1200);
  check('nothing changes while paused', (await state(g.page)).score === t0);
  await g.page.keyboard.down('Space'); await sleep(60); await g.page.keyboard.up('Space'); await sleep(200);
  s = await state(g.page);
  check('Space resumes from pause (and does not fire)', s.screen === 'play');
  // blur pauses and releases keys
  await g.page.keyboard.down('ArrowLeft');
  await g.page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(150);
  s = await state(g.page);
  check('losing focus pauses the game and releases held keys', s.screen === 'paused' && !s.keys.left);
  await g.page.keyboard.up('ArrowLeft');
  await g.page.keyboard.press('Escape'); await sleep(150);
  s = await state(g.page);
  check('Esc resumes', s.screen === 'play');
  // resize
  for (const vp of [{ width: 800, height: 1000 }, { width: 390, height: 780 }, { width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    await g.page.setViewportSize(vp); await sleep(250);
    if (SHOTS) await g.shot('g_play_' + vp.width + 'x' + vp.height);
  }
  check('resizing keeps the game running', (await state(g.page)).screen === 'play');
  // debug screens
  await g.page.evaluate(() => { const d = window.PM_DEBUG.game.debug; d.setScore(24680); d.forceScreen('over'); });
  await sleep(2600);
  s = await state(g.page);
  check('game over screen', s.screen === 'over' && s.stars >= 1);
  if (SHOTS) await g.shot('g_over');
  await g.page.keyboard.down('Space'); await sleep(50); await g.page.keyboard.up('Space'); await sleep(300);
  s = await state(g.page);
  check('a Space press after the stars starts a new game', s.screen === 'play' && s.ballNo === 1);
  check('no console errors or page errors so far', g.errors.length === 0, g.errors.slice(0, 3).join(' | '));
  await g.close();

  // ---------------------------------------------------------------------------------------------------------
  // surprises, power, banners: screenshots of the special moments
  if (SHOTS) {
    g = await openGame({ file: FILE, viewport: { width: 1280, height: 720 }, query: '?mute=1&seed=9' });
    await g.page.waitForFunction(() => window.PM_DEBUG, null, { timeout: 15000 });
    await sleep(400);
    await g.page.keyboard.press('Space'); await sleep(400);
    await g.page.evaluate(() => { const G = window.PM_DEBUG.game; G.launchDown(); G.launchUp(); });
    await sleep(2500);
    await g.page.evaluate(() => window.PM_DEBUG.game.debug.givePower());
    await sleep(1200); await g.shot('g_power');
    for (const id of ['bigflip', 'balloons', 'fruits', 'dance', 'shield', 'slow', 'extraball']) {
      await g.page.evaluate((i) => window.PM_DEBUG.game.debug.triggerSurprise(i), id);
      await sleep(1500); await g.shot('g_surprise_' + id);
    }
    await g.page.evaluate(() => { const D = window.PM_DEBUG.game.debug; D.fillDots(1); D.spawnFruit('strawberry'); });
    await sleep(600); await g.shot('g_fruit');
    await g.page.evaluate(() => { const G = window.PM_DEBUG.game; G.debug.setBallSave(15); G.debug.drain(); });
    await sleep(500); await g.shot('g_rescue_chomp');
    await sleep(700); await g.shot('g_rescue_spit');
    await g.page.evaluate(() => { const G = window.PM_DEBUG.game; G.debug.forceMultiball(); });
    await sleep(700); await g.shot('g_lock');
    console.log('  errors in the screenshot session: ' + g.errors.length + (g.errors.length ? ' ' + g.errors.slice(0, 3).join(' | ') : ''));
    check('no console errors during the screenshot session', g.errors.length === 0);
    await g.close();
  }

  // ---------------------------------------------------------------------------------------------------------
  // autoplay: the bot plays whole games in the real page, with the real renderer
  if (MINUTES > 0) {
    g = await openGame({ file: FILE, viewport: { width: 1280, height: 720 }, query: '?autoplay=1&mute=1&seed=3&skill=0.8' });
    await g.page.waitForFunction(() => window.PM_DEBUG, null, { timeout: 15000 });
    const t0 = Date.now();
    let games = 0, lastScreen = '';
    while (Date.now() - t0 < MINUTES * 60000) {
      await sleep(2000);
      const st = await state(g.page);
      if (st.screen === 'over' && lastScreen !== 'over') games++;
      lastScreen = st.screen;
    }
    const fin = await state(g.page);
    const perf = await g.page.evaluate(() => window.PM_DEBUG.render.stats);
    console.log('  autoplay ran ' + MINUTES + ' min: games finished ' + games + ', last state ' + JSON.stringify(fin) + ', render ' + JSON.stringify(perf));
    check('autoplay runs for ' + MINUTES + ' minutes without errors', g.errors.length === 0, g.errors.slice(0, 3).join(' | '));
    await g.close();
  }

  console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL PASS'));
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
