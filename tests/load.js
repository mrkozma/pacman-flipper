'use strict';
// Loads the DOM-free modules (numeric prefix < 60, plus any extra files you pass) into an isolated Node vm context.
// Usage: const { loadPM } = require('./load'); const PM = loadPM();
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = process.env.PM_SRC ? path.resolve(process.env.PM_SRC) : path.join(__dirname, '..', 'src');   // PM_SRC: test another source folder

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
  return ctx.PM;
}

module.exports = { loadPM, listFiles, SRC };
