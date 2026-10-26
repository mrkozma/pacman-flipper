'use strict';
// Screenshots of the English build (?language=en) in headless Microsoft Edge on macOS, the Hungarian controls and the language checks.
// Tool of ENGLISH-PLAN.md phases 1 to 3 (not in run_all.js); PM_EDGE=<path> overrides the Edge binary.
//   node tests/shots_mac.js                       every shot and every check
//   node tests/shots_mac.js --only en_goodbye,hu_title      only the shots whose name starts with one of these (add --checks for the voice checks)
//   node tests/shots_mac.js --vp 1280x720,390x844           only some viewports
//   node tests/shots_mac.js --out DIR             output folder (default: tests/out/shots, gitignored)
//   node tests/shots_mac.js --file PATH                     the game file (default: dist/_en_preview.html of the repo)
//   node tests/shots_mac.js --wait 1500                     ms to wait after window.PM_DEBUG (fonts, animations) before a shot
//   node tests/shots_mac.js --auto-sec 33 --auto-every 3    length of the autoplay runs and the time between their shots
//   node tests/shots_mac.js --voices hu                     the voice packs the build has (default hu,en); English without 'en' must stay silent
// Names: en_<scene>_<WxH>.png, en_auto<NN>_<WxH>.png (NN = shot index, taken at NN * every seconds), hu_<scene>_1280x720.png,
// xx_title_1280x720.png. Writes <out>/report.json ({shots, checks, console_errors, banners}). Exit code 1 when a check fails.
// The page is never changed: every shot is a fresh context (own localStorage) that loads the URL and waits.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const EDGE = process.env.PM_EDGE || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const FILE = path.resolve(String(opt('file', path.join(ROOT, 'dist', '_en_preview.html'))));
const OUT = path.resolve(String(opt('out', path.join(ROOT, 'tests', 'out', 'shots'))));
const ONLY = opt('only', '') ? String(opt('only')).split(',').map((s) => s.trim()).filter(Boolean) : null;
const WANT_VP = opt('vp', '') ? String(opt('vp')).split(',') : null;
const WAIT = Number(opt('wait', 1500)) || 1500;
const AUTO_SEC = Number(opt('auto-sec', 33)) || 33;
const AUTO_EVERY = Number(opt('auto-every', 3)) || 3;
const CHECKS = !ONLY || argv.includes('--checks');
const VOICES = String(opt('voices', 'hu,en')).split(',').map((s) => s.trim()).filter(Boolean).sort();
// Categories whose every clip differs by more than 0.8 s between the Hungarian and the English pack (same file names in both):
// the voice probe plays them and the measured length tells which pack was decoded.
const PROBE_CATS = ['over_stars_1', 'surprise_balloons', 'surprise_fruits'];

const VPS = [
  { name: '1280x720', w: 1280, h: 720 },
  { name: '1920x1080', w: 1920, h: 1080 },
  { name: '800x1000', w: 800, h: 1000 },
  { name: '390x844', w: 390, h: 844, touch: true }
];
const VP = (n) => VPS.find((v) => v.name === n);
const SCENES = ['title', 'play', 'paused', 'over', 'notice', 'last', 'goodbye'];
// what state.screen / state.limit.phase should be after ?screen=X (40_game.js debug.forceScreen)
const EXPECT = { title: ['title'], play: ['play'], paused: ['paused'], over: ['over'], notice: ['play', 'notice'], last: ['play', 'last'], goodbye: ['goodbye', 'goodbye'] };
const HU_LETTERS = /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/;

const vpOk = (n) => !WANT_VP || WANT_VP.includes(n);
const want = (name) => !ONLY || ONLY.some((p) => name.startsWith(p));

// ---- the jobs ---------------------------------------------------------------------------------------------------
const jobs = [];
for (const vp of VPS) for (const sc of SCENES) {
  jobs.push({ kind: 'shot', name: 'en_' + sc + '_' + vp.name, lang: 'en', scene: sc, vp, query: '?language=en&mute=1&seed=7&screen=' + sc });
}
for (const n of ['1280x720', '390x844']) {
  jobs.push({ kind: 'auto', name: 'en_auto', lang: 'en', scene: 'autoplay', vp: VP(n), query: '?language=en&autoplay=1&mute=1&seed=7' });
}
jobs.push({ kind: 'shot', name: 'hu_title_1280x720', lang: 'hu', scene: 'title', vp: VP('1280x720'), query: '?mute=1&seed=7&screen=title' });
jobs.push({ kind: 'shot', name: 'hu_goodbye_1280x720', lang: 'hu', scene: 'goodbye', vp: VP('1280x720'), query: '?mute=1&seed=7&screen=goodbye' });
jobs.push({ kind: 'shot', name: 'xx_title_1280x720', lang: 'xx', scene: 'title', vp: VP('1280x720'), query: '?language=xx&mute=1&seed=7&screen=title' });
// the voice jobs are not muted: PM.Audio.voice() returns false while muted (headless Edge plays to no device)
jobs.push({ kind: 'voice', name: 'voice_en', lang: 'en', scene: 'title', vp: VP('1280x720'), query: '?language=en&seed=7&screen=title' });
jobs.push({ kind: 'voice', name: 'voice_hu', lang: 'hu', scene: 'title', vp: VP('1280x720'), query: '?seed=7&screen=title' });

function selected(j) {
  if (!vpOk(j.vp.name)) return false;
  if (j.kind === 'voice') return CHECKS;
  if (j.kind === 'auto') return !ONLY || ONLY.some((p) => p.startsWith('en_auto') || 'en_auto'.startsWith(p));
  return want(j.name);
}

// ---- in-page probes ---------------------------------------------------------------------------------------------
function pageInfo() {
  const D = window.PM_DEBUG, PM = D.PM, S = D.game.state, c = document.getElementById('game');
  return {
    htmlLang: document.documentElement.lang, LANG: PM.LANG, paramLang: D.params.language,
    tIsEn: !!(PM.STRINGS && PM.T === PM.STRINGS.en), tIsHu: !!(PM.STRINGS && PM.T === PM.STRINGS.hu),
    aria: c ? c.getAttribute('aria-label') : null, title: document.title,
    voices: window.PM_VOICES ? Object.keys(window.PM_VOICES) : null,
    screen: S.screen, limitPhase: S.limit ? S.limit.phase : null, touch: !!(S.ui && S.ui.touch),
    banner: S.banner ? { kind: S.banner.kind, text: S.banner.text, sub: S.banner.sub } : null,
    inner: window.innerWidth + 'x' + window.innerHeight
  };
}
function startBannerLog() {
  const D = window.PM_DEBUG, t0 = performance.now();
  window.__banners = []; window.__screens = [];
  let lastB = '', lastS = '';
  setInterval(() => {
    const S = D.game.state, b = S.banner, k = b ? b.kind + '|' + b.text + '|' + (b.sub || '') : '';
    const t = Math.round((performance.now() - t0) / 100) / 10;
    if (k && k !== lastB) window.__banners.push({ t, kind: b.kind, text: b.text, sub: b.sub || '' });
    lastB = k;
    if (S.screen !== lastS) window.__screens.push({ t, screen: S.screen });
    lastS = S.screen;
  }, 50);
}
async function voiceProbe(cats) {
  const D = window.PM_DEBUG, A = D.PM.Audio;
  await A.unlock();
  await A.loadVoices();
  const asked = Object.keys(A.voiceCats ? A.voiceCats() : {}).length;               // the expression the task names
  const dbg = A._debug && A._debug.voiceCats ? A._debug.voiceCats() : null;         // where 80_audio.js really exposes it
  const ctx = A._debug && A._debug.state ? A._debug.state() : null;
  // Play each probe category once and measure how long the voice stays busy; compare with that file's dur in every embedded pack.
  const packs = window.PM_VOICES || {};
  const durIn = (lang, cat, f) => { const c = packs[lang] && packs[lang].manifest.cats[cat]; const x = c && c.clips.find((k) => k.f === f); return x ? x.dur : null; };
  const plays = [];
  for (const cat of cats) {
    if (!A.voice(cat, { priority: 3, force: true })) { plays.push({ cat, played: false }); continue; }
    const f = A._debug.lastVoiceFile(cat), t0 = A._debug.state().currentTime, w0 = performance.now();
    while (A.voiceBusy() && performance.now() - w0 < 10000) await new Promise((r) => setTimeout(r, 20));
    const len = A._debug.state().currentTime - t0, dur = {};
    for (const lang of Object.keys(packs)) dur[lang] = durIn(lang, cat, f);
    const near = Object.keys(dur).filter((l) => dur[l] != null).sort((a, b) => Math.abs(dur[a] - len) - Math.abs(dur[b] - len))[0] || null;
    plays.push({ cat, played: true, f, len: Math.round(len * 100) / 100, dur, pack: near });
  }
  return { LANG: D.PM.LANG, asked, hasTopLevel: typeof A.voiceCats === 'function', debugCats: dbg ? Object.keys(dbg).length : null,
    debugClips: dbg ? Object.keys(dbg).reduce((n, k) => n + dbg[k].clips, 0) : null, ctxState: ctx ? ctx.state : null, isNull: !!A.isNull, plays };
}
function enHungarianLetters() {
  const out = [];
  (function walk(o, p) {
    if (typeof o === 'string') { if (/[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/.test(o)) out.push(p + ' = ' + JSON.stringify(o)); return; }
    if (o && typeof o === 'object') Object.keys(o).forEach((k) => walk(o[k], p ? p + '.' + k : k));
  })(window.PM_DEBUG.PM.STRINGS.en, '');
  return out;
}

// ---- runner -----------------------------------------------------------------------------------------------------
async function openPage(browser, j) {
  const context = await browser.newContext({
    viewport: { width: j.vp.w, height: j.vp.h }, deviceScaleFactor: 1,
    isMobile: !!j.vp.touch, hasTouch: !!j.vp.touch, reducedMotion: 'no-preference'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console.error] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + (e && e.stack ? e.stack : e)));
  const url = 'file://' + FILE + j.query;
  await page.goto(url);
  await page.waitForFunction(() => window.PM_DEBUG && window.PM_DEBUG.game, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForTimeout(WAIT);
  return { context, page, errors, url };
}

async function main() {
  if (!fs.existsSync(FILE)) throw new Error('game file not found: ' + FILE + ' (python3 tools/build.py --src verified-src --out dist/_en_preview.html)');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const shots = [], pages = [], voice = {}, banners = {}, problems = [];
  let enLetters = null;
  try {
    for (const j of jobs.filter(selected)) {
      const label = j.kind === 'auto' ? 'en_auto_' + j.vp.name : j.name;
      process.stdout.write(label + ' ... ');
      let P = null;
      try {
        P = await openPage(browser, j);
        const info = await P.page.evaluate(pageInfo);
        if (j.kind === 'shot') {
          const file = path.join(OUT, j.name + '.png');
          await P.page.screenshot({ path: file });
          shots.push({ file, viewport: j.vp.name, scene: j.scene, lang: j.lang, url: P.url, info });
          if (j.lang === 'en' && enLetters === null) enLetters = await P.page.evaluate(enHungarianLetters);
        } else if (j.kind === 'auto') {
          await P.page.evaluate(startBannerLog);
          const t0 = Date.now(), n = Math.floor(AUTO_SEC / AUTO_EVERY + 1e-9);
          for (let i = 0; i <= n; i++) {
            const wait = t0 + i * AUTO_EVERY * 1000 - Date.now();
            if (wait > 0) await P.page.waitForTimeout(wait);
            const nn = String(i).padStart(2, '0'), name = 'en_auto' + nn + '_' + j.vp.name;
            const at = await P.page.evaluate(pageInfo);
            if (want(name)) {
              const file = path.join(OUT, name + '.png');
              await P.page.screenshot({ path: file });
              shots.push({ file, viewport: j.vp.name, scene: 'autoplay t=' + (i * AUTO_EVERY) + 's' + (at.banner ? ' banner: ' + at.banner.text + (at.banner.sub ? ' / ' + at.banner.sub : '') : ''), lang: 'en', url: P.url, info: at });
            }
          }
          banners[j.vp.name] = await P.page.evaluate(() => ({ banners: window.__banners, screens: window.__screens }));
        } else if (j.kind === 'voice') {
          voice[j.lang] = await P.page.evaluate(voiceProbe, PROBE_CATS);
        }
        pages.push({ name: label, lang: j.lang, kind: j.kind, scene: j.scene, viewport: j.vp.name, url: P.url, info, errors: P.errors.slice() });
        console.log('ok' + (P.errors.length ? ' (' + P.errors.length + ' errors)' : ''));
      } catch (e) {
        problems.push(label + ': ' + e.message.split('\n')[0]);
        pages.push({ name: label, lang: j.lang, kind: j.kind, scene: j.scene, viewport: j.vp.name, url: P && P.url, info: null, errors: (P ? P.errors : []).concat(['[script] ' + e.message.split('\n')[0]]) });
        console.log('FAILED ' + e.message.split('\n')[0]);
      } finally { if (P) await P.context.close(); }
    }
  } finally { await browser.close(); }

  // ---- checks ---------------------------------------------------------------------------------------------------
  const checks = [];
  const add = (what, ok, detail) => checks.push({ what, ok: !!ok, detail });
  const withInfo = pages.filter((p) => p.info);
  const group = (lang) => withInfo.filter((p) => p.lang === lang);
  const bad = (list, fn) => list.filter((p) => !fn(p.info)).map((p) => p.name + ' ' + JSON.stringify(p.info));
  const one = (list, key) => Array.from(new Set(list.map((p) => JSON.stringify(p.info[key])))).join(', ');
  const cases = [
    { lang: 'en', label: 'English (?language=en)', html: 'en', LANG: 'en', param: 'en', aria: 'Pacman Flipper game' },
    { lang: 'hu', label: 'Hungarian (no language parameter)', html: 'hu', LANG: 'hu', param: 'hu', aria: 'Pacman flipper játék' },
    { lang: 'xx', label: 'unknown (?language=xx)', html: 'hu', LANG: 'hu', param: 'hu', aria: 'Pacman flipper játék' }
  ];
  for (const c of cases) {
    const L = group(c.lang);
    if (!L.length) continue;
    let b = bad(L, (i) => i.htmlLang === c.html);
    add(c.label + ": document.documentElement.lang is '" + c.html + "'", !b.length, L.length + ' pages, seen ' + one(L, 'htmlLang') + (b.length ? '; wrong: ' + b.join(' | ') : ''));
    b = bad(L, (i) => i.LANG === c.LANG && i.paramLang === c.param);
    add(c.label + ": PM_DEBUG.PM.LANG is '" + c.LANG + "' and PM_DEBUG.params.language is '" + c.param + "'", !b.length,
      L.length + ' pages, PM.LANG ' + one(L, 'LANG') + ', params.language ' + one(L, 'paramLang') + (b.length ? '; wrong: ' + b.join(' | ') : ''));
    if (c.lang === 'en') {
      b = bad(L, (i) => i.tIsEn);
      add(c.label + ': PM_DEBUG.PM.T === PM_DEBUG.PM.STRINGS.en', !b.length, L.length + ' pages' + (b.length ? '; wrong: ' + b.join(' | ') : ''));
    } else {
      b = bad(L, (i) => i.tIsHu);
      add(c.label + ': PM_DEBUG.PM.T === PM_DEBUG.PM.STRINGS.hu', !b.length, L.length + ' pages' + (b.length ? '; wrong: ' + b.join(' | ') : ''));
    }
    b = bad(L, (i) => i.aria === c.aria);
    add(c.label + ': canvas aria-label', !b.length, 'seen ' + one(L, 'aria') + ' (expected ' + JSON.stringify(c.aria) + ')' + (b.length ? '; wrong: ' + b.join(' | ') : ''));
  }
  if (withInfo.length) {
    const b = bad(withInfo, (i) => JSON.stringify((i.voices || []).slice().sort()) === JSON.stringify(VOICES));
    add('window.PM_VOICES has exactly ' + VOICES.join(', ') + ' in this build', !b.length, withInfo.length + ' pages, keys seen ' + one(withInfo, 'voices') + (b.length ? '; wrong: ' + b.join(' | ') : ''));
    const sc = withInfo.filter((p) => p.kind === 'shot');
    const bs = sc.filter((p) => { const e = EXPECT[p.scene]; return p.info.screen !== e[0] || (e[1] && p.info.limitPhase !== e[1]); })
      .map((p) => p.name + ' screen=' + p.info.screen + ' limit=' + p.info.limitPhase);
    if (sc.length) add('?screen=X reached the asked screen (state.screen, state.limit.phase)', !bs.length, sc.length + ' pages' + (bs.length ? '; differs: ' + bs.join(', ') : ''));
    const bt = withInfo.filter((p) => p.info.touch !== (p.viewport === '390x844')).map((p) => p.name + ' touch=' + p.info.touch);
    add('touch texts: state.ui.touch is on exactly on the 390x844 phone pages (isMobile + hasTouch)', !bt.length, (bt.length ? 'differs: ' + bt.join(', ') : 'ok on ' + withInfo.length + ' pages'));
  }
  const playText = (v) => v.plays.map((x) => x.played ? x.cat + ' ' + x.f + ' played ' + x.len + ' s (' + Object.keys(x.dur).map((l) => l + ' ' + x.dur[l]).join(', ') + ') = ' + x.pack : x.cat + ' did not play').join('; ');
  if (voice.en && !VOICES.includes('en')) add('voice in English stays silent (no English pack): unlock() + loadVoices() then the category count (expected 0)',
    voice.en.debugCats === 0 && voice.en.plays.every((x) => !x.played),
    'PM.Audio._debug.voiceCats(): ' + voice.en.debugCats + ' categories, ' + voice.en.debugClips + ' clips; AudioContext ' + voice.en.ctxState);
  if (voice.en && VOICES.includes('en')) add('voice in English loads the English pack: about 70 categories, and each probe clip lasts as long as its English file',
    voice.en.debugCats >= 50 && voice.en.plays.length && voice.en.plays.every((x) => x.played && x.pack === 'en'),
    'PM.Audio._debug.voiceCats(): ' + voice.en.debugCats + ' categories, ' + voice.en.debugClips + ' clips; AudioContext ' + voice.en.ctxState + '; ' + playText(voice.en));
  if (voice.hu) add('voice in Hungarian loads the Hungarian pack: about 70 categories, and each probe clip lasts as long as its Hungarian file',
    voice.hu.debugCats >= 50 && voice.hu.plays.length && voice.hu.plays.every((x) => x.played && x.pack === 'hu'),
    'PM.Audio._debug.voiceCats(): ' + voice.hu.debugCats + ' categories, ' + voice.hu.debugClips + ' clips; AudioContext ' + voice.hu.ctxState + '; ' + playText(voice.hu));
  const errPages = pages.filter((p) => p.errors.length);
  add('zero console errors and zero page errors on every page', !errPages.length, pages.length + ' pages' + (errPages.length ? '; errors on ' + errPages.map((p) => p.name).join(', ') : ''));
  for (const vp of Object.keys(banners)) {
    const list = banners[vp].banners, hu = list.filter((b) => HU_LETTERS.test(b.text + b.sub));
    add('autoplay ' + vp + ': every banner seen in 33 s is English (no Hungarian letters)', !hu.length,
      list.length + ' banners: ' + list.map((b) => 't=' + b.t + 's ' + b.kind + ' "' + b.text + '"' + (b.sub ? ' / "' + b.sub + '"' : '')).join('; ') + (hu.length ? '; HUNGARIAN: ' + hu.map((b) => b.text).join(', ') : '') +
      '; screens: ' + banners[vp].screens.map((s) => 't=' + s.t + ' ' + s.screen).join(', '));
  }
  if (enLetters) add('informational: PM.STRINGS.en strings with Hungarian letters (a missing English key falls back to Hungarian)', !enLetters.length, enLetters.length ? enLetters.slice(0, 30).join('; ') : 'none');
  for (const p of problems) add('script step', false, p);

  const consoleErrors = [];
  for (const p of pages) for (const e of p.errors) consoleErrors.push(p.name + ': ' + e);
  const report = { file: FILE, out: OUT, shots: shots.map(({ file, viewport, scene, lang, url }) => ({ file, viewport, scene, lang, url })), checks, console_errors: consoleErrors, banners, voice, pages };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\n' + shots.length + ' shots in ' + OUT);
  for (const c of checks) console.log((c.ok ? 'PASS ' : 'FAIL ') + c.what + '\n     ' + c.detail);
  console.log(consoleErrors.length ? 'CONSOLE ERRORS:\n' + consoleErrors.join('\n') : 'no console errors');
  process.exit(checks.every((c) => c.ok || c.what.startsWith('informational')) ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
