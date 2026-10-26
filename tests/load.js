'use strict';
// Loads the DOM-free modules (numeric prefix < 60, plus any extra files you pass) into an isolated Node vm context.
// Usage: const { loadPM } = require('./load'); const PM = loadPM();
// PM_LANG=en: loadPM() switches PM.T to that language after loading (PM.setLanguage, 08_lang.js) and fails if it cannot.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = process.env.PM_SRC ? path.resolve(process.env.PM_SRC) : path.join(__dirname, '..', 'src');   // PM_SRC: test another source folder
const LANG = process.env.PM_LANG || '';                                                                    // PM_LANG: run the test in this language

function listFiles(maxPrefix) {
  return fs.readdirSync(SRC)
    .filter((f) => /^\d\d_.*\.js$/.test(f) && !f.endsWith('.test.js'))
    .filter((f) => parseInt(f.slice(0, 2), 10) < maxPrefix)
    .sort();
}

function loadPM(opts) {
  opts = opts || {};
  const maxPrefix = opts.maxPrefix || 60;
  const sandbox = Object.assign({ console, Math, JSON, Promise, setTimeout, clearTimeout }, opts.sandbox || {});
  const ctx = vm.createContext(sandbox);
  for (const f of listFiles(maxPrefix)) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }
  if (LANG && maxPrefix > 8) useLang(ctx.PM);
  return ctx.PM;
}

// Switch a loaded PM to PM_LANG; throws when the tree has no language registry or does not know the language,
// so a typo never runs the Hungarian test under an English name.
function useLang(PM) {
  if (!PM.setLanguage) throw new Error('PM_LANG=' + LANG + ' but ' + SRC + ' has no 08_lang.js (PM.setLanguage)');
  if (PM.setLanguage(LANG) !== LANG) throw new Error('PM_LANG=' + LANG + ' is not a language of ' + SRC + ' (PM.STRINGS has ' + Object.keys(PM.STRINGS).join(', ') + ')');
}

module.exports = { loadPM, listFiles, SRC, LANG, useLang };
