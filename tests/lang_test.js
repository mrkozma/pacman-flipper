'use strict';
// Language tests (?language=en, SPEC 6b) WITHOUT a browser: plain Node vm contexts, nothing is launched, no network.
//   node tests/lang_test.js                    (PM_SRC=verified-src node tests/lang_test.js tests another source folder)
// Sections: (a) PM.normLang, (b) PM.setLanguage, the Hungarian fallback of the English table, no module from 10 to 80 reads PM.T
// while it loads, the real game in English, (c) deep parity between the Hungarian table and the RAW PM.STRINGS_EN (and every leaf
// translated), (d) the real 90_main.js in a fake browser (?language=, <html lang>, canvas aria-label, PM_DEBUG.params, the table the
// renderer gets, the missing module screen), (e) 80_audio.js loadVoices picks window.PM_VOICES[PM.LANG] (fake AudioContext),
// (f) fmtNum of 70_render.js uses PM.T.num_sep, (g) the real 60_sprites.js + 70_render.js draw every screen in English.
// Exit code 1 if anything FAILS.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadPM, listFiles, SRC } = require('./load');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail !== undefined && detail !== '' ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
  return ok;
}
const section = (name) => console.log('\n== ' + name + ' ==');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const run = (ctx, f) => vm.runInContext(read(f), ctx, { filename: f });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const DASH = new RegExp('[' + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015) + ']');
const NBSP = String.fromCharCode(0xa0);
const show = (v) => (v === undefined ? 'undefined' : JSON.stringify(v));
const HU_LETTER = new RegExp('[' + [0xe1, 0xe9, 0xed, 0xf3, 0xf6, 0x151, 0xfa, 0xfc, 0x171].map((c) => String.fromCharCode(c)).join('') + ']', 'i');
// The Hungarian leaves that English replaces, as regexes over one drawn line ({n} is a number; the fruit banner adds a '!')
function huOnly(hu, en) {
  const out = [];
  (function walk(h, e) {
    if (typeof h === 'string') {
      if (h.trim() && h !== e) out.push(new RegExp('^' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{n\\\}/g, '\\d+') + '!?$'));
      return;
    }
    if (h && typeof h === 'object') Object.keys(h).forEach((k) => walk(h[k], e && e[k]));
  })(hu, en);
  return out;
}
// the lines shown in English that are Hungarian: a Hungarian letter, or a whole Hungarian string
function huLeaks(lines, hu, en) {
  const bad = huOnly(hu, en);
  return Array.from(new Set(lines)).filter((s) => HU_LETTER.test(s) || bad.some((re) => re.test(s.trim())));
}

const lacking = ['07_strings_en.js', '08_lang.js'].filter((f) => !fs.existsSync(path.join(SRC, f)));
if (lacking.length) {
  console.log('  FAIL ' + SRC + ' has no ' + lacking.join(' and ') + ' (the language files); try PM_SRC=verified-src\n\n1 FAILURE(S)');
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------------------------
section('(a) PM.normLang: trimmed, case-insensitive, first two letters, anything unknown is Hungarian');
{
  const PM = loadPM();
  if (check('PM.normLang exists (08_lang.js is loaded)', typeof PM.normLang === 'function')) {
    const cases = [['en', 'en'], ['EN', 'en'], [' en ', 'en'], ['en-GB', 'en'], ['en_US', 'en'], ['En-us', 'en'], ['english', 'en'],
      ['hu', 'hu'], ['HU', 'hu'], ['xx', 'hu'], ['de', 'hu'], ['e', 'hu'], ['', 'hu'], ['   ', 'hu'], [null, 'hu'], [undefined, 'hu'],
      [0, 'hu'], ['constructor', 'hu'], ['__proto__', 'hu']];
    for (const [v, want] of cases) {
      const got = PM.normLang(v);
      check('normLang(' + show(v) + ') = ' + want, got === want, got === want ? '' : 'got ' + show(got));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
section('(b) PM.setLanguage: switches PM.T and PM.LANG, comes back to Hungarian, unknown codes are Hungarian');
{
  const PM = loadPM();
  const hu = PM.STRINGS && PM.STRINGS.hu, en = PM.STRINGS && PM.STRINGS.en;
  check('after load: PM.LANG is hu and PM.T === PM.STRINGS.hu', PM.LANG === 'hu' && !!hu && PM.T === hu);
  check('PM.STRINGS holds hu and en', !!PM.STRINGS && Object.keys(PM.STRINGS).join(',') === 'hu,en', PM.STRINGS && Object.keys(PM.STRINGS).join(','));
  check('the default table is Hungarian', hu && hu.press_start === 'Nyomd meg a SZÓKÖZT!');
  let r = PM.setLanguage('en');
  check("setLanguage('en') returns 'en', PM.LANG is en, PM.T === PM.STRINGS.en", r === 'en' && PM.LANG === 'en' && PM.T === en);
  check('PM.T is English now (top level and .r)', PM.T.press_start === PM.STRINGS_EN.press_start && PM.T.r.stars[2] === PM.STRINGS_EN.r.stars[2]);
  r = PM.setLanguage('hu');
  check("setLanguage('hu') restores the very same Hungarian table", r === 'hu' && PM.LANG === 'hu' && PM.T === hu);
  PM.setLanguage('en'); r = PM.setLanguage('xx');
  check("setLanguage('xx') falls back to Hungarian", r === 'hu' && PM.LANG === 'hu' && PM.T === hu);
  PM.setLanguage('en'); r = PM.setLanguage();
  check('setLanguage() without a code is Hungarian', r === 'hu' && PM.T === hu);
  r = PM.setLanguage(' EN-us ');
  check("setLanguage(' EN-us ') is English", r === 'en' && PM.LANG === 'en' && PM.T === en);
  PM.setLanguage('hu');
  const huRefs = new Set();
  (function collect(o) { if (o && typeof o === 'object') { huRefs.add(o); Object.keys(o).forEach((k) => collect(o[k])); } })(hu);
  let shared = 0;
  (function walk(o) { if (o && typeof o === 'object') { if (huRefs.has(o)) shared++; Object.keys(o).forEach((k) => walk(o[k])); } })(en);
  check('the English table is a deep copy: no object or array is shared with the Hungarian one', shared === 0, shared ? shared + ' shared' : '');
  check('building the English table left the Hungarian one untouched (same as 05 + 06 alone)', same(hu, loadPM({ maxPrefix: 7 }).T));
}

section('(b) a key missing in English shows the Hungarian text; an English array replaces the whole array');
{
  const ctx = vm.createContext({ console });
  for (const f of listFiles(8)) run(ctx, f);                        // 00, 05, 06, 07: then knock holes into the English table
  const EN = ctx.PM.STRINGS_EN;
  delete EN.tunnel; delete EN.surprise.slow.sub; delete EN.r.guard; delete EN.fruit; EN.praise_list = ['Yay!'];
  run(ctx, '08_lang.js');
  const PM = ctx.PM, hu = PM.STRINGS.hu, en = PM.STRINGS.en;
  check('a missing banner falls back to the Hungarian one (as a copy)', same(en.tunnel, hu.tunnel) && en.tunnel !== hu.tunnel);
  check('a missing nested string falls back, its English sibling stays English',
    en.surprise.slow.sub === hu.surprise.slow.sub && en.surprise.slow.text === EN.surprise.slow.text);
  check('a missing renderer string falls back, the other .r strings stay English', en.r.guard === hu.r.guard && en.r.ball_of === EN.r.ball_of);
  check('a missing group falls back', same(en.fruit, hu.fruit));
  check('an English array replaces the whole Hungarian array (no Hungarian items mixed in)', same(en.praise_list, ['Yay!']));
  check('the merged table keeps the Hungarian key order', Object.keys(en).join() === Object.keys(hu).join());
  PM.setLanguage('en');
  check('with the gaps PM.setLanguage still gives English text', PM.T.press_start === EN.press_start && PM.T.tunnel.text === hu.tunnel.text);
}

section('(b) a build without 07_strings_en.js stays Hungarian (never a half English page)');
{
  const ctx = vm.createContext({ console });
  for (const f of listFiles(7)) run(ctx, f);                        // 00, 05, 06 only
  run(ctx, '08_lang.js');
  const PM = ctx.PM;
  check('PM.STRINGS has only hu', Object.keys(PM.STRINGS).join(',') === 'hu');
  check("normLang('en') and setLanguage('en') give hu", PM.normLang('en') === 'hu' && PM.setLanguage('en') === 'hu' && PM.T === PM.STRINGS.hu);
}

section('(b) 07_strings_en.js only defines PM.STRINGS_EN, it never touches PM.T');
{
  const ctx = vm.createContext({ console });
  run(ctx, '00_ns.js'); run(ctx, '07_strings_en.js');
  check('00 + 07 alone: PM.T stays undefined, PM.STRINGS_EN exists', ctx.PM.T === undefined && !!ctx.PM.STRINGS_EN);
  const ctx2 = vm.createContext({ console });
  for (const f of listFiles(8)) run(ctx2, f);
  check('00 + 05 + 06 + 07: PM.T is still the Hungarian table', same(ctx2.PM.T, loadPM({ maxPrefix: 7 }).T));
}

section('(b) no module from 10 to 80 reads PM.T while it loads (boot() swaps PM.T later: a copy taken at load stays Hungarian)');
{
  const ctx = vm.createContext({ console, Math, JSON, Promise, setTimeout, clearTimeout });
  for (const f of listFiles(10)) run(ctx, f);                       // 00 .. 08 build and register the tables
  const T = ctx.PM.T, late = listFiles(90).filter((f) => parseInt(f, 10) >= 10), reads = [];
  let cur = '';
  Object.defineProperty(ctx.PM, 'T', { configurable: true, get() { reads.push(cur); return T; }, set() { reads.push(cur + ' (sets it)'); } });
  for (const f of late) { cur = f; run(ctx, f); }
  check('loaded ' + late.join(', '), late.indexOf('40_game.js') >= 0 && late.indexOf('70_render.js') >= 0);
  check('none of them touches PM.T at load time', !reads.length, Array.from(new Set(reads)).join(', '));
}

section('(b) the real game reads the English table at call time');
{
  const PM = loadPM();
  PM.setLanguage('en');
  const G = PM.Game.create({ seed: 116, playLimitSeconds: 0 });
  const S = G.state, seen = [];
  const step = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) { G.update(1 / 60); if (S.banner && seen.indexOf(S.banner.text + ' / ' + S.banner.sub) < 0) seen.push(S.banner.text + ' / ' + S.banner.sub); } };
  G.launchDown(); step(0.6); G.launchUp(); step(0.2);
  const rd = PM.STRINGS.en.ready;
  check('the ready banner is English', S.banner && S.banner.kind === 'ready' && S.banner.text === rd.text && S.banner.sub === rd.sub,
    S.banner ? S.banner.text + ' / ' + S.banner.sub : 'no banner');
  G.debug.triggerSurprise('balloons'); step(4);
  const sb = PM.STRINGS.en.surprise.balloons;
  check('a surprise banner is English', seen.indexOf(sb.text + ' / ' + sb.sub) >= 0, seen.join(' | '));
  PM.setLanguage('hu');
}

section('(b) the banners a scripted English game reaches are English (debug hooks, then a bot game with the limit)');
{
  const PM = loadPM();
  PM.setLanguage('en');
  const G = PM.Game.create({ seed: 116, autoplay: true, skill: 0.9, playLimitSeconds: 90 });
  const S = G.state, lines = new Set(), kinds = new Set();
  const step = (sec) => {
    for (let i = 0; i < Math.round(sec * 60); i++) {
      G.update(1 / 60);
      const b = S.banner;
      if (b) { kinds.add(b.kind); lines.add(b.text); if (b.sub) lines.add(b.sub); }
    }
  };
  G.start(); step(1);
  G.debug.givePower(); step(3);
  for (const id of Object.keys(PM.T.surprise)) { G.debug.triggerSurprise(id); step(4); }
  for (const kind of Object.keys(PM.T.fruit)) { G.debug.spawnFruit(kind); step(1); }
  G.debug.clearLevel(); step(4);
  step(120);                                                        // the bot plays on until the limit notice at 90 s
  G.debug.startLimit(); step(2);
  const en = PM.STRINGS.en, leaks = huLeaks(Array.from(lines), PM.STRINGS.hu, en), k = Array.from(kinds).sort();
  check(lines.size + ' banner lines of ' + k.length + ' kinds (' + k.join(', ') + '; sanity: at least 25 lines, 10 kinds)',
    lines.size >= 25 && k.length >= 10, Array.from(lines).join(' | '));
  check('no Hungarian banner line', !leaks.length, leaks.join(' | '));
  check('the limit notice is English', lines.has(en.limit_notice.text) && lines.has(en.limit_notice.sub));
  PM.setLanguage('hu');
}

// ---------------------------------------------------------------------------------------------------------------
section('(c) the raw PM.STRINGS_EN has exactly the shape of the Hungarian table');
{
  const PM = loadPM();
  const hu = PM.STRINGS.hu, EN = PM.STRINGS_EN;
  const P = { keys: [], order: [], type: [], len: [], empty: [], ph: [], dash: [], same: [], huch: [] };
  const SAME_OK = /^(title|ghost\.\w+)$/;                           // names, the same in both languages
  let strings = 0;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const at = (p, k) => (p ? p + '.' + k : k);
  const holders = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  (function walk(h, e, p) {
    if (Array.isArray(h)) {
      if (!Array.isArray(e)) { P.type.push(p + ' (array/' + typeof e + ')'); return; }
      if (h.length !== e.length) P.len.push(p + ' ' + h.length + '/' + e.length);
      for (let i = 0; i < Math.min(h.length, e.length); i++) walk(h[i], e[i], p + '[' + i + ']');
      return;
    }
    if (h !== null && typeof h === 'object') {
      if (e === null || typeof e !== 'object' || Array.isArray(e)) { P.type.push(p + ' (object/' + typeof e + ')'); return; }
      const hk = Object.keys(h), ek = Object.keys(e);
      hk.filter((k) => !own(e, k)).forEach((k) => P.keys.push('missing in English: ' + at(p, k)));
      ek.filter((k) => !own(h, k)).forEach((k) => P.keys.push('extra in English: ' + at(p, k)));
      if (hk.filter((k) => own(e, k)).join() !== ek.filter((k) => own(h, k)).join()) P.order.push(p || '(top level)');
      hk.forEach((k) => { if (own(e, k)) walk(h[k], e[k], at(p, k)); });
      return;
    }
    if (typeof h !== 'string' || typeof e !== 'string') { P.type.push(p + ' (' + typeof h + '/' + typeof e + ')'); return; }
    strings++;
    if ((h === '') !== (e === '')) P.empty.push(p + ' ' + show(h) + ' / ' + show(e));
    if (holders(h) !== holders(e)) P.ph.push(p + ' ' + holders(h) + ' / ' + holders(e));
    if (DASH.test(e)) P.dash.push(p + ' ' + show(e));
    if (e === h && e !== '' && !SAME_OK.test(p)) P.same.push(p + ' ' + show(e));
    if (HU_LETTER.test(e)) P.huch.push(p + ' ' + show(e));
  })(hu, EN, '');
  check('same key paths at every level (nothing missing, nothing extra)', !P.keys.length, P.keys.join('; '));
  check('same key order at every level (the two files stay easy to compare)', !P.order.length, P.order.join('; '));
  check('same types: objects, arrays and string leaves', !P.type.length, P.type.join('; '));
  check('arrays of the same length', !P.len.length, P.len.join('; '));
  check("'' exactly where the Hungarian has ''", !P.empty.length, P.empty.join('; '));
  check('identical {n} placeholders', !P.ph.length, P.ph.join('; '));
  check('no em or en dashes (U+2012 to U+2015) in English', !P.dash.length, P.dash.join('; '));
  check('every English string is translated (only title and the ghost names may equal the Hungarian)', !P.same.length, P.same.join('; '));
  check('no Hungarian letters in English', !P.huch.length, P.huch.join('; '));
  check(strings + ' strings compared (sanity: at least 120)', strings >= 120);
  for (const [name, T] of [['Hungarian', hu], ['English', EN]]) {
    check(name + ': r.limit_notice, r.limit_last and r.goodbye equal the top level ones',
      !!T.r && same(T.r.limit_notice, T.limit_notice) && same(T.r.limit_last, T.limit_last) && same(T.r.goodbye, T.goodbye));
  }
  check('Hungarian aria_label (the published spelling), fatal_missing, num_sep (a no-break space, as fmtNum always used)',
    hu.aria_label === 'Pacman flipper játék' && hu.fatal_missing === 'Pacman Flipper: hiányzó modul' && hu.num_sep === NBSP,
    show(hu.aria_label) + ' ' + show(hu.fatal_missing) + ' ' + show(hu.num_sep));
  check('English aria_label and fatal_missing name the game, num_sep is a comma',
    /Pacman Flipper/.test(EN.aria_label) && /Pacman Flipper/.test(EN.fatal_missing) && EN.num_sep === ',', show(EN.aria_label) + ' ' + show(EN.fatal_missing));
}

// ---------------------------------------------------------------------------------------------------------------
// (d) the real 90_main.js with a small fake window/document/canvas (the approach of tests/keys_test.js)
async function bootMain(search, opts) {
  opts = opts || {};
  const attrs = {}, texts = [], rendered = [], errors = [];
  const canvas = {
    width: 0, height: 0, clientWidth: 1280, clientHeight: 720,
    addEventListener() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; },
    focus() {}, setPointerCapture() {},
    getContext() { return { fillRect() {}, fillText(t) { texts.push(t); } }; }
  };
  if (!opts.noSetAttribute) canvas.setAttribute = (k, v) => { attrs[k] = String(v); };
  const html = { lang: 'hu' };                                       // what index.template.html says
  const doc = {
    readyState: 'complete', hidden: false, documentElement: html, body: { appendChild() {} },
    getElementById(id) { return id === 'game' ? canvas : null; },
    addEventListener() {}, createElement() { return { style: {} }; }
  };
  const sandbox = {
    console: { log() {}, warn() {}, error(m) { errors.push(String(m)); } },
    Math, JSON, Promise, Date, URLSearchParams, setTimeout, clearTimeout,
    document: doc, location: { search: search || '' }, performance: { now: () => Date.now() },
    localStorage: { getItem() { return null; }, setItem() {} },
    matchMedia() { return { matches: false }; },
    innerWidth: 1280, innerHeight: 720,
    requestAnimationFrame() { return 1; },
    addEventListener() {}
  };
  const ctx = vm.createContext(sandbox);
  ctx.window = ctx;
  for (const f of listFiles(60)) run(ctx, f);
  const PM = ctx.PM;
  PM.Theme = { fontsReady: Promise.resolve() };
  PM.Sprites = {};
  PM.Render = { create() { rendered.push({ T: PM.T, lang: PM.LANG }); return { layout: { buttons: [], table: null, scale: 1 }, resize() {}, draw() {}, stats: {} }; } };
  PM.Audio = Object.assign({}, PM.Audio, { isNull: false });
  if (opts.before) opts.before(PM);
  run(ctx, '90_main.js');
  await new Promise((r) => setTimeout(r, 30));                      // fonts promise, then run()
  return { PM, attrs, texts, rendered, errors, html, dbg: ctx.PM_DEBUG };
}

async function mainSection() {
  section('(d) the real 90_main.js in a fake browser');
  {
    const tpl = read('index.template.html'), hu = loadPM().STRINGS.hu;
    const m = tpl.match(/<canvas\b[^>]*\saria-label="([^"]*)"/);
    check('index.template.html: the canvas aria-label is the Hungarian aria_label (boot() keeps the published name)',
      !!m && m[1] === hu.aria_label, (m ? show(m[1]) : 'no aria-label') + ' / ' + show(hu.aria_label));
    check('index.template.html: <html lang="hu"> (what the fake document starts with)', /<html\b[^>]*\slang="hu"/.test(tpl));
  }
  {
    const E = await bootMain('?language=en');
    const en = E.PM.STRINGS.en;
    check('?language=en boots (PM_DEBUG exists)', !!E.dbg);
    check('PM.LANG is en and PM.T === PM.STRINGS.en', E.PM.LANG === 'en' && E.PM.T === en);
    check('<html lang> is en', E.html.lang === 'en', E.html.lang);
    check('the canvas aria-label is the English one', E.attrs['aria-label'] === en.aria_label, E.attrs['aria-label']);
    check('PM_DEBUG.params.language is en', E.dbg && E.dbg.params.language === 'en');
    check('PM.Render.create() got the English table (the swap happens before the renderer copies PM.T)',
      E.rendered.length === 1 && E.rendered[0].T === en && E.rendered[0].lang === 'en');
  }
  {
    const E = await bootMain('?language=en&perc=0.5');
    check('?language=en&perc=0.5: English and perc 0.5', E.PM.LANG === 'en' && E.dbg && E.dbg.params.perc === 0.5, E.dbg && E.dbg.params.perc);
    const C = await bootMain('?language=en&perc=0,5'), alone = await bootMain('?perc=0,5');
    const pc = C.dbg && C.dbg.params.perc, pa = alone.dbg && alone.dbg.params.perc;
    check('?language=en&perc=0,5: English, and perc is read exactly as without language', C.PM.LANG === 'en' && pc === pa,
      'perc ' + show(pc) + (pc === 0.5 ? '' : ': this tree reads no comma decimals in perc, so 0,5 keeps the default'));
    const D = await bootMain('?screen=title&language=EN-gb&autoplay=0&seed=7');
    check('?screen=title&language=EN-gb&autoplay=0&seed=7: English, the other parameters still read',
      D.PM.LANG === 'en' && D.dbg && D.dbg.params.screen === 'title' && D.dbg.params.seed === 7 && !D.dbg.params.autoplay);
  }
  for (const q of ['', '?language=de', '?language=', '?language=hu', '?perc=3']) {
    const E = await bootMain(q);
    const hu = E.PM.STRINGS.hu;
    check((q || 'no query') + ': Hungarian everywhere', E.PM.LANG === 'hu' && E.PM.T === hu && E.html.lang === 'hu' &&
      E.attrs['aria-label'] === hu.aria_label && E.dbg && E.dbg.params.language === 'hu' && E.rendered.length === 1 && E.rendered[0].T === hu,
      E.PM.LANG + ' ' + E.html.lang + ' ' + show(E.attrs['aria-label']));
  }
  {
    const E = await bootMain('?language=en', { noSetAttribute: true });
    check('a canvas without setAttribute (the keys_test stand-in) still boots in English', !!E.dbg && E.PM.LANG === 'en' && E.html.lang === 'en');
    const F = await bootMain('?language=en', { before(PM) { delete PM.setLanguage; delete PM.normLang; } });
    check('a build without 08_lang.js boots in Hungarian', !!F.dbg && F.dbg.params.language === 'hu' && F.PM.T === F.PM.STRINGS.hu && F.html.lang === 'hu');
  }
  {
    const E = await bootMain('?language=en', { before(PM) { delete PM.Bot; } });
    check('missing module screen in English', !E.dbg && E.texts[0] === 'Pacman Flipper: missing module' && /PM\.Bot/.test(E.texts[1] || '') && E.html.lang === 'en',
      show(E.texts));
    const H = await bootMain('', { before(PM) { delete PM.Bot; } });
    check('missing module screen in Hungarian', !H.dbg && H.texts[0] === 'Pacman Flipper: hiányzó modul', show(H.texts));
    const N = await bootMain('?language=en', { before(PM) { delete PM.T; delete PM.STRINGS; delete PM.setLanguage; delete PM.normLang; } });
    check('no PM.T at all: the fallback line, and PM.T is named as missing', !N.dbg && N.texts[0] === 'Pacman Flipper: missing module' && /PM\.T\b/.test(N.texts[1] || ''),
      show(N.texts));
    check('the console names the missing modules', E.errors.some((m) => /missing: PM\.Bot/.test(m)));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// (e) 80_audio.js loadVoices with a fake AudioContext (just enough nodes for ensureCtx and the decoder)
function fakeAudio() {
  const calls = { decode: 0 };
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = () => new Proxy({ connect() {}, disconnect() {}, start() {}, stop() {} }, {
    get(t, k) { if (typeof k === 'string' && !(k in t)) t[k] = param(); return t[k]; }      // any AudioParam (gain, threshold, ...)
  });
  const buffer = (ch, n, sr) => {
    const d = [];
    for (let i = 0; i < ch; i++) d.push(new Float32Array(n));
    return { numberOfChannels: ch, length: n, sampleRate: sr, duration: n / sr, getChannelData: (c) => d[c] };
  };
  function AudioContext() {
    return {
      sampleRate: 8000, currentTime: 0, state: 'running', destination: node(),
      createGain: node, createDynamicsCompressor: node, createWaveShaper: node, createConvolver: node, createBufferSource: node,
      createBiquadFilter: node, createOscillator: node, createStereoPanner: node, createAnalyser: node,
      createBuffer: buffer,
      decodeAudioData(buf, ok) { calls.decode++; const b = buffer(1, 800, 8000); b.getChannelData(0).fill(0.4); ok(b); },
      resume() { return Promise.resolve(); }, suspend() { return Promise.resolve(); }, close() { return Promise.resolve(); }
    };
  }
  return { calls, AudioContext };
}
const pack = (cat) => ({ manifest: { cats: { [cat]: { priority: 1, cooldown: 0, clips: [{ f: cat + '_1.mp3', who: 'noemi', text: cat, dur: 0.1 }] } } },
  files: { [cat + '_1.mp3']: 'AAAA' } });
async function voicesFor(globals, lang) {
  const A = fakeAudio();
  const ctx = vm.createContext(Object.assign({ console, Math, JSON, Promise, Date, setTimeout, clearTimeout, atob, AudioContext: A.AudioContext }, globals));
  ctx.window = ctx;
  run(ctx, '00_ns.js'); run(ctx, '80_audio.js');
  if (lang !== undefined) ctx.PM.LANG = lang;
  await ctx.PM.Audio.loadVoices();
  return { cats: Object.keys(ctx.PM.Audio._debug.voiceCats()).sort().join(','), decode: A.calls.decode };
}

async function audioSection() {
  section('(e) 80_audio.js loadVoices plays the pack of PM.LANG (fake AudioContext)');
  const control = await voicesFor({ PM_VOICES: { hu: pack('hu_cat') } }, 'hu');
  if (!check('control: a PM_VOICES {hu} build with PM.LANG hu decodes its one clip (else fix fakeAudio(), never skip)',
    control.cats === 'hu_cat' && control.decode === 1, show(control))) return;
  const old = await voicesFor({ PM_VOICE: pack('old_hu') }, 'hu');
  check('an older single-pack build (only window.PM_VOICE) still speaks Hungarian', old.cats === 'old_hu', show(old));
  const both = { PM_VOICES: { hu: pack('hu_cat'), en: pack('en_cat') } };
  let r = await voicesFor(both, 'en');
  check('PM_VOICES {hu, en} with PM.LANG en: only the English pack is decoded', r.cats === 'en_cat' && r.decode === 1, show(r));
  r = await voicesFor(both, 'hu');
  check('PM_VOICES {hu, en} with PM.LANG hu: only the Hungarian pack is decoded', r.cats === 'hu_cat' && r.decode === 1, show(r));
  const p = pack('hu_cat');
  r = await voicesFor({ PM_VOICES: { hu: p, en: pack('en_cat') }, PM_VOICE: p }, 'en');
  check('the PM_VOICE alias that build.py writes is ignored when PM_VOICES exists', r.cats === 'en_cat', show(r));
  r = await voicesFor({ PM_VOICES: { hu: pack('hu_cat') }, PM_VOICE: p }, 'en');
  check('English without an English pack stays SILENT (never Hungarian speech under English text)', r.cats === '' && r.decode === 0, show(r));
  r = await voicesFor({ PM_VOICE: pack('old_hu') }, 'en');
  check('English on an older single-pack build stays silent too', r.cats === '' && r.decode === 0, show(r));
  r = await voicesFor({ PM_VOICES: null, PM_VOICE: null }, 'en');
  const r2 = await voicesFor({ PM_VOICES: null, PM_VOICE: null }, 'hu');
  check('a --no-voice build (both null): no voice, no crash, in both languages', r.cats === '' && r2.cats === '', show([r, r2]));
  r = await voicesFor(both, undefined);
  check('no PM.LANG (a build without 08_lang.js): the Hungarian pack', r.cats === 'hu_cat', show(r));
}

// ---------------------------------------------------------------------------------------------------------------
function fmtSection() {
  section('(f) fmtNum of 70_render.js groups thousands with PM.T.num_sep (read at call time)');
  const m = read('70_render.js').match(/\r?\n {2}function fmtNum\(n\) \{[\s\S]*?\r?\n {2}\}\r?\n/);   // src/70_render.js has CRLF line ends
  if (!check('fmtNum found in 70_render.js', !!m)) return;
  const ctx = vm.createContext({ PM: {} });
  const fmtNum = vm.runInContext('(function () {' + m[0] + 'return fmtNum; })()', ctx);
  const PM = loadPM();
  const cases = [
    ['Hungarian', PM.STRINGS.hu, [[12500, '12' + NBSP + '500'], [1234567, '1' + NBSP + '234' + NBSP + '567'], [999, '999'], [0, '0']]],
    ['English', PM.STRINGS.en, [[12500, '12,500'], [1234567, '1,234,567'], [1000, '1,000'], [999, '999']]],
    ['no PM.T', undefined, [[12500, '12' + NBSP + '500']]],
    ['num_sep not a string', { num_sep: 5 }, [[12500, '12' + NBSP + '500']]],
    ["num_sep ''", { num_sep: '' }, [[12500, '12500']]]
  ];
  for (const [name, T, list] of cases) {
    ctx.PM.T = T;
    const bad = list.filter(([n, want]) => fmtNum(n) !== want).map(([n]) => n + ' -> ' + show(fmtNum(n)));
    check(name + ': ' + list.map(([n, w]) => n + ' -> ' + show(w)).join(', '), !bad.length, bad.join('; '));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// (g) the REAL 60_sprites.js + 70_render.js in a recording fake 2D context: loaded in Hungarian, then PM.setLanguage('en') and
// PM.Render.create(), the order of boot(). Catches a renderer that copies PM.T at load time and Hungarian literals it falls back to.
function fake2d(texts) {
  const grad = { addColorStop() {} };
  const t = {
    measureText: (s) => ({ width: String(s).length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    fillText(s) { texts.push(String(s)); }, strokeText(s) { texts.push(String(s)); },
    createLinearGradient: () => grad, createRadialGradient: () => grad, createConicGradient: () => grad, createPattern: () => grad,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false, getLineDash: () => []
  };
  return new Proxy(t, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });   // other calls: no-ops
}
function renderSection() {
  section('(g) the real 70_render.js draws every screen in English (loaded before the swap, as in the page)');
  const texts = [], errors = [];
  const mkCanvas = () => {
    const c = { width: 1280, height: 720, clientWidth: 1280, clientHeight: 720, style: {}, addEventListener() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
    const c2 = fake2d(texts);
    c.getContext = () => c2;
    return c;
  };
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error(m) { errors.push(String(m)); } }, Math, JSON, Promise, Date,
    setTimeout, clearTimeout, performance: { now: () => 0 }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, Path2D: function () { return new Proxy({}, { get: () => () => {} }); },
    document: { createElement: mkCanvas, fonts: { ready: Promise.resolve(), load: () => Promise.resolve([]) } } });
  ctx.window = ctx;
  let game, render;
  try {
    for (const f of listFiles(80)) run(ctx, f);                     // 00 .. 70: PM.T is Hungarian while 70_render.js loads
    ctx.PM.setLanguage('en');
    game = ctx.PM.Game.create({ seed: 3, hiScore: 1000, playLimitSeconds: 0 });
    render = ctx.PM.Render.create(mkCanvas(), game);
  } catch (e) { check('the real renderer starts in a fake 2D context', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e); return; }
  let t = 0;
  const draw = (sc) => {
    game.debug.forceScreen(sc);
    if (sc === 'play') { game.debug.triggerSurprise('shield'); game.debug.setScore(12500); }
    for (let i = 0; i < 90; i++) { game.update(1 / 60); render.draw(t += 1 / 60); }
  };
  const screens = ['title', 'play', 'paused', 'over', 'notice', 'last', 'goodbye'];
  screens.forEach(draw);
  game.state.ui.touch = true;                                       // the touch texts (the renderer lays out again)
  ['title', 'paused', 'goodbye'].forEach(draw);
  const PM = ctx.PM, en = PM.STRINGS.en, all = texts.join(' ');     // long text is wrapped: join the pieces
  const leaks = huLeaks(texts, PM.STRINGS.hu, en);
  check(screens.join(', ') + ' (desktop, then title, paused and goodbye on touch): ' + new Set(texts).size + ' distinct strings drawn',
    new Set(texts).size > 50 && !errors.length, errors.slice(0, 3).join(' | '));
  check('no Hungarian text on any English screen', !leaks.length, leaks.join(' | '));
  for (const s of [en.subtitle, en.score, en.paused, en.paused_hint, en.goodbye.title, en.limit_notice.text, en.limit_last.sub,
    en.r.resume_touch, en.r.hint_flippers_touch, '12,500']) check('drawn: ' + show(s), all.indexOf(s) >= 0);
}

(async () => {
  await mainSection();
  await audioSection();
  fmtSection();
  renderSection();
  console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('test crashed:', e && e.stack || e); process.exit(2); });
