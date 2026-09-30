'use strict';
// Opens a built game file in headless Edge via playwright-core.
//   const { openGame } = require('./browser_helper');
//   const g = await openGame({ file: 'dist/_dev_x.html', viewport: { width: 1280, height: 720 }, query: '?autoplay=1&seed=7' });
//   await g.page.waitForFunction(() => window.PM_DEBUG);
//   await g.shot('title');            // -> tests/out/title.png
//   console.log(g.errors);            // console errors + page errors
//   await g.close();
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');

async function openGame(opts) {
  opts = opts || {};
  const file = path.resolve(ROOT, opts.file || 'dist/pacman-flipper.html');
  if (!fs.existsSync(file)) throw new Error('game file not found: ' + file + ' (run: python tools/build.py)');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: opts.headless !== false,
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-features=CalculateNativeWinOcclusion'].concat(opts.args || [])
  });
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 1280, height: 720 },
    deviceScaleFactor: opts.deviceScaleFactor || 1,
    hasTouch: !!opts.hasTouch,
    isMobile: !!opts.isMobile,
    reducedMotion: opts.reducedMotion || 'no-preference'
  });
  const page = await context.newPage();
  const errors = [];
  const logs = [];
  page.on('console', (m) => { const t = m.type(); (t === 'error' ? errors : logs).push('[' + t + '] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + (e && e.stack ? e.stack : e)));
  await page.goto('file:///' + file.replace(/\\/g, '/') + (opts.query || ''));
  return {
    browser, context, page, errors, logs,
    async shot(name) {
      const p = path.join(OUT, name.endsWith('.png') ? name : name + '.png');
      await page.screenshot({ path: p });
      return p;
    },
    async close() { await browser.close(); }
  };
}

module.exports = { openGame, EDGE, OUT };
