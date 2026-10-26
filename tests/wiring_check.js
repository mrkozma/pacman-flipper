'use strict';
// Static cross-check of the wiring between game code, the audio module and the voice manifest.
//   - every sfx name that 40_game.js, 90_main.js or 70_render.js calls exists in 80_audio.js (its exported sfx list)
//   - every voice category the game calls exists in assets/voice/manifest.json and every clip file exists
//   - the English pack (assets/voice_en/, when it exists) has the same categories, priorities and cooldowns, and every clip file exists
//   - every sfx name and voice category in SPEC 4.5 exists
// Names built from a template ('bumper_' + id) are expanded by hand in TEMPLATES below.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let fails = 0;
function check(ok, msg) { if (!ok) { fails++; console.log('FAIL ' + msg); } }

const manifest = JSON.parse(read('assets/voice/manifest.json'));
const cats = manifest.cats;
const EN_MANIFEST = 'assets/voice_en/manifest.json';
const enCats = fs.existsSync(path.join(ROOT, EN_MANIFEST)) ? JSON.parse(read(EN_MANIFEST)).cats : null;

function loadAudioNames() {
  const sandbox = { console, Math, JSON, Promise, setTimeout, clearTimeout, Float32Array, Uint8Array, Float64Array, Int16Array, Uint32Array, ArrayBuffer, Map, Set, Array, Object, Number, String, Date, isFinite, isNaN, parseInt, parseFloat };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('src/00_ns.js'), sandbox);
  vm.runInContext(read('src/80_audio.js'), sandbox, { filename: '80_audio.js' });
  const A = sandbox.PM.Audio;
  return (A && A._debug && A._debug.sfxNames) ? Array.from(A._debug.sfxNames) : [];
}
const sfxNames = loadAudioNames();
check(sfxNames.length >= 40, 'audio module exports its sfx list (got ' + sfxNames.length + ')');
const sfxSet = new Set(sfxNames);

const FRUITS = ['cherry', 'strawberry', 'orange', 'apple', 'pear', 'grapes'];
const GH = ['piri', 'rozi', 'kiki'];
const SURP = ['bigflip', 'slow', 'balloons', 'fruits', 'dance', 'shield', 'extraball'];
const TEMPLATES = {
  sfx: { 'bumper_': GH },
  voice: {
    'ghost_': GH.concat(['nori']), 'ball_': ['2', '3', '4', '5'], 'fruit_': FRUITS, 'mult_': ['2', '3', '4', '5'],
    'combo_': ['3', '5', '10'], 'surprise_': SURP.concat(['end']), 'over_stars_': ['1', '2', '3']
  }
};

const usedSfx = new Map(), usedVoice = new Map();
function add(map, name, file) { if (!map.has(name)) map.set(name, file); }
function scan(file) {
  const s = read(file);
  let m;
  const reS = /\bsfx\(\s*'([a-z_0-9]+)'\s*[,)]|\bsfx:\s*'([a-z_0-9]+)'(?!\s*\+)|A\('sfx',\s*'([a-z_0-9]+)'|Audio\.sfx\(\s*'([a-z_0-9]+)'/g;
  while ((m = reS.exec(s))) add(usedSfx, m[1] || m[2] || m[3] || m[4], file);
  const reV = /\bsay\(\s*'([a-z_0-9]+)'\s*[,)]|\bvoice:\s*'([a-z_0-9]+)'(?!\s*\+)|Audio\.voice\(\s*'([a-z_0-9]+)'/g;
  while ((m = reV.exec(s))) add(usedVoice, m[1] || m[2] || m[3], file);
  // templates: 'prefix_' + something
  const reT = /\b(sfx|say|voice:?)\(?\s*'([a-z_]+_)'\s*\+/g;
  while ((m = reT.exec(s))) {
    const kind = m[1].startsWith('sfx') ? 'sfx' : 'voice';
    const list = TEMPLATES[kind][m[2]];
    check(!!list, 'unknown name template ' + kind + ' "' + m[2] + '" + ... in ' + file + ' (add it to TEMPLATES in tests/wiring_check.js)');
    (list || []).forEach((x) => add(kind === 'sfx' ? usedSfx : usedVoice, m[2] + x, file));
  }
}
['src/40_game.js', 'src/90_main.js', 'src/70_render.js'].forEach(scan);

for (const [n, f] of usedSfx) check(sfxSet.has(n), 'sfx "' + n + '" (called in ' + f + ') is not implemented in 80_audio.js');
for (const [n, f] of usedVoice) check(!!cats[n], 'voice category "' + n + '" (called in ' + f + ') is missing in the manifest');

const spec = read('SPEC.md');
const sfxBlock = spec.match(/SFX names that the game will call[^\n]*\n`([^`]+)`/);
check(!!sfxBlock, 'SPEC sfx list found');
if (sfxBlock) {
  const names = sfxBlock[1].replace(/\s+/g, ' ').split(',').map((x) => x.trim()).filter(Boolean);
  names.forEach((n) => check(sfxSet.has(n), 'SPEC sfx "' + n + '" missing in 80_audio.js'));
}
const voiceBlock = spec.match(/```\nwelcome \[3[\s\S]*?```/);
let specCats = 0;
if (voiceBlock) {
  for (const line of voiceBlock[0].split('\n')) {
    const m = line.match(/^([a-z_0-9.,\s]+?)\s+\[\d/);
    if (!m) continue;
    for (const part of m[1].split(',')) {
      const p = part.trim();
      const r = p.match(/^([a-z_]+?)(\d)\.\.(\d)$/) || p.match(/^([a-z_]+?)(\d)\.\.[a-z_]*(\d)$/);
      const names = r ? Array.from({ length: +r[3] - +r[2] + 1 }, (_, i) => r[1] + (+r[2] + i)) : (p ? [p] : []);
      names.forEach((c) => { specCats++; check(cats[c] && cats[c].clips && cats[c].clips.length > 0, 'SPEC voice category "' + c + '" has no clips'); });
    }
  }
}
check(specCats >= 60, 'SPEC voice list parsed (' + specCats + ' categories)');
for (const [c, v] of Object.entries(cats)) for (const clip of v.clips) check(fs.existsSync(path.join(ROOT, 'assets/voice', clip.f)), 'missing mp3 ' + clip.f);
if (enCats) {
  // same category set as the Hungarian pack, so every category the game or SPEC names (checked above) exists in English too
  check(JSON.stringify(Object.keys(enCats).sort()) === JSON.stringify(Object.keys(cats).sort()), 'English manifest has the same categories as the Hungarian one');
  for (const [c, e] of Object.entries(enCats)) {
    const h = cats[c] || {};
    check(e.priority === h.priority && e.cooldown === h.cooldown, 'English ' + c + ': priority/cooldown ' + e.priority + '/' + e.cooldown + ' differ from the Hungarian ' + h.priority + '/' + h.cooldown);
    check(e.clips && e.clips.length > 0, 'English voice category "' + c + '" has no clips');
    for (const clip of e.clips || []) check(fs.existsSync(path.join(ROOT, 'assets/voice_en', clip.f)), 'missing English mp3 ' + clip.f);
  }
}

// ---- ten minute goodbye (SPEC 9.2): voice categories, strings, and the places in 90_main.js that must know the 'goodbye' screen
{
  const { loadPM } = require('./load');
  const PM = loadPM();
  const dashRe = new RegExp('[' + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015) + ']');
  for (const [lbl, pc] of [['', cats]].concat(enCats ? [['English ', enCats]] : [])) {
    for (const c of ['limit_notice', 'limit_goodbye', 'limit_rest']) {
      const e = pc[c];
      check(!!e, lbl + 'voice category ' + c + ' is in the manifest');
      if (!e) continue;
      check(e.priority === 3, lbl + c + ' has priority 3 in the manifest (got ' + e.priority + ')');
      check(e.clips.length >= 2 && e.clips.length <= 4, lbl + c + ' has 2 to 4 variants (got ' + e.clips.length + ')');
      check(e.clips.every((k) => k.who === 'pekmen'), lbl + c + ' is spoken by pekmen');
      check(e.clips.every((k) => !dashRe.test(k.text) && k.dur <= 8), lbl + c + ': no dashes, no clip over 8 s');
    }
    check(pc.limit_notice && pc.limit_notice.clips.every((k) => k.dur <= PM.CFG.LIMIT_NOTICE_SECONDS - 1), 'every ' + lbl + 'limit_notice clip ends before the notice phase does (' + PM.CFG.LIMIT_NOTICE_SECONDS + ' s)');
  }
  const T = PM.T;
  check(T.limit_notice && T.limit_notice.text && T.limit_notice.sub, 'PM.T.limit_notice {text, sub}');
  check(T.limit_last && T.limit_last.text && T.limit_last.sub, 'PM.T.limit_last {text, sub}');
  check(T.goodbye && T.goodbye.title && T.goodbye.line1 && T.goodbye.line2 && T.goodbye.parents, 'PM.T.goodbye {title, line1, line2, parents}');
  const main = read('src/90_main.js'), game = read('src/40_game.js');
  check(/'goodbye'/.test(main) && /perc/.test(main) && /playLimitSeconds/.test(main), "90_main.js knows the 'goodbye' screen, ?perc and playLimitSeconds");
  check(/S\.screen === 'goodbye'\)? return 'gameover'|S\.screen === 'goodbye'\) return 'gameover'/.test(main.replace(/\s+/g, ' ')), "90_main.js plays the 'gameover' lullaby on the goodbye screen");
  check(/emit\('limit'/.test(game) && /limit: true/.test(game), "40_game.js emits the 'limit' event and marks the goodbye gameover with limit:true");
}

console.log('audio sfx: ' + sfxNames.length + ' implemented, ' + usedSfx.size + ' names used by code; voice: ' + Object.keys(cats).length + ' manifest categories' + (enCats ? ' (English ' + Object.keys(enCats).length + ')' : '') + ', ' + usedVoice.size + ' names used by code, ' + specCats + ' in SPEC');
console.log(fails ? fails + ' wiring problem(s)' : 'wiring OK');
process.exit(fails ? 1 : 0);
