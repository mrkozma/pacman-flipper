'use strict';
// One command for everything: builds dist/pacman-flipper.html, runs every automated test and prints a PASS/FAIL table.
//
//   node tests/run_all.js            full run (about 25 minutes: the audio analysis alone needs about 7)
//   node tests/run_all.js --quick    about 18 minutes: audio analysis --quick, 30 s autoplay, no flipper contact test
//   node tests/run_all.js --only wiring,sim      run only the named steps (names are in the table)
//   node tests/run_all.js --no-build             reuse the existing dist/pacman-flipper.html
//
// Order: build and static checks; then the tests that need no timing (sim, game rules, ten minute goodbye, audio, voice, wiring) in parallel;
// then the browser tests one after the other (they measure frame times, so nothing else may compete for the CPU).
// Every step writes its full output to tests/out/run_all/<name>.txt. The exit code is 1 when any step fails.
// The dev builds that some tests make (dist/_dev_*.html) are deleted at the end, only dist/pacman-flipper.html stays.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUTDIR = path.join(__dirname, 'out', 'run_all');
const DIST = path.join(ROOT, 'dist', 'pacman-flipper.html');
const argv = process.argv.slice(2);
const QUICK = argv.includes('--quick');
const NO_BUILD = argv.includes('--no-build');
const onlyIdx = argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? new Set(String(argv[onlyIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean)) : null;
const wanted = (name) => !ONLY || ONLY.has(name);

fs.mkdirSync(OUTDIR, { recursive: true });

// ---- running a command -----------------------------------------------------------------------------------------
function run(name, cmd, args, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const t0 = Date.now();
    const file = path.join(OUTDIR, name + '.txt');
    const out = fs.createWriteStream(file);
    let text = '';
    const child = spawn(cmd, args, { cwd: ROOT, env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', FORCE_COLOR: '0' }), windowsHide: true });
    const timer = setTimeout(() => { text += '\nTIMEOUT after ' + (opts.timeout || 900) + ' s\n'; try { child.kill(); } catch (e) { /* gone */ } }, (opts.timeout || 900) * 1000);
    const take = (d) => { const s = d.toString('utf8'); text += s; out.write(s); };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (err) => { text += '\nspawn error: ' + err.message + '\n'; });
    child.on('close', (code) => {
      clearTimeout(timer);
      out.end();
      const timedOut = /\nTIMEOUT after/.test(text);
      resolve({ name, code: timedOut ? 124 : code, secs: (Date.now() - t0) / 1000, text, file });
    });
  });
}

function lastLines(text, re) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (re) { for (let i = lines.length - 1; i >= 0; i--) if (re.test(lines[i])) return lines[i]; }
  return lines.length ? lines[lines.length - 1] : '';
}
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '~' : s);

const results = [];
function record(name, ok, secs, detail) { results.push({ name, ok, secs, detail }); }
function fromRun(r, okDetailRe, extraOk) {
  const ok = r.code === 0 && (extraOk ? extraOk(r.text) : true);
  const detail = ok ? lastLines(r.text, okDetailRe) : (r.code === 124 ? 'timed out' : 'exit ' + r.code + '; see ' + path.relative(ROOT, r.file) + ' :: ' + lastLines(r.text, /FAIL|Error|error/));
  record(r.name, ok, r.secs, detail);
  return ok;
}

// ---- static checks (in process) -------------------------------------------------------------------------------
function staticChecks() {
  const t0 = Date.now();
  const problems = [];
  const info = [];
  // 1. no em or en dashes in code, comments, strings, voice script, manifest and SPEC
  const dash = new RegExp('[' + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015) + ']');
  const files = [];
  const walk = (dir, exts) => { for (const f of fs.readdirSync(path.join(ROOT, dir))) { const p = path.join(dir, f); if (fs.statSync(path.join(ROOT, p)).isFile() && exts.some((e) => f.endsWith(e))) files.push(p); } };
  walk('src', ['.js', '.css', '.html']); walk('tools', ['.py', '.json']); walk('tests', ['.js']);
  files.push('assets/voice/manifest.json', 'SPEC.md');
  for (const p of files) {
    if (!fs.existsSync(path.join(ROOT, p))) continue;
    fs.readFileSync(path.join(ROOT, p), 'utf8').split(/\r?\n/).forEach((l, i) => { if (dash.test(l)) problems.push('dash in ' + p + ':' + (i + 1)); });
  }
  // 2. the built page: exists, under 16 MB, self contained, has the parts
  if (!fs.existsSync(DIST)) problems.push('dist/pacman-flipper.html is missing');
  else {
    const html = fs.readFileSync(DIST, 'utf8');
    const mb = fs.statSync(DIST).size / 1048576;
    info.push(mb.toFixed(2) + ' MB');
    if (mb > 16) problems.push('built page is over 16 MB');
    const ext = html.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+|url\(\s*["']?https?:\/\/[^)]+|@import[^;]+https?:/g);
    if (ext) problems.push('external reference in the built page: ' + ext[0].slice(0, 60));
    if (/\bfetch\(\s*['"]https?:|XMLHttpRequest/.test(html)) problems.push('the built page does network requests');
    for (const marker of ['PM.Physics', 'PM.Game', 'PM.Render', 'PM.Audio', 'PM.Sprites', 'window.PM_VOICE', '@font-face', 'Fredoka']) if (html.indexOf(marker) < 0) problems.push('built page lacks ' + marker);
    if (/Math\.random|Date\.now\(\)/.test(fs.readFileSync(path.join(ROOT, 'src/40_game.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''))) problems.push('40_game.js uses Math.random or Date.now');
  }
  // 3. the Hungarian letters survive (strings file, voice script, built page)
  const hu = fs.readFileSync(path.join(ROOT, 'src/05_strings_hu.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'tools/voice_script.json'), 'utf8');
  for (const ch of ['á', 'é', 'í', 'ó', 'ö', 'ő', 'ú', 'ü', 'ű']) if (hu.indexOf(ch) < 0) problems.push('no "' + ch + '" in the Hungarian texts (encoding damaged?)');
  if (fs.existsSync(DIST) && fs.readFileSync(DIST, 'utf8').indexOf('Nyomd meg a SZÓKÖZT!') < 0) problems.push('built page lacks the Hungarian start text');
  record('static', problems.length === 0, (Date.now() - t0) / 1000, problems.length ? problems.slice(0, 3).join('; ') : 'no dashes, self contained, ' + info.join(', '));
  return problems.length === 0;
}

function table() {
  const w = Math.max(...results.map((r) => r.name.length), 8);
  const lines = [];
  lines.push('');
  lines.push('RESULT  ' + 'STEP'.padEnd(w) + '  TIME    DETAIL');
  lines.push('------  ' + '-'.repeat(w) + '  ------  ' + '-'.repeat(60));
  for (const r of results) lines.push((r.ok ? 'PASS' : 'FAIL').padEnd(6) + '  ' + r.name.padEnd(w) + '  ' + (r.secs.toFixed(0) + 's').padStart(6) + '  ' + clip(r.detail || '', 100));
  const bad = results.filter((r) => !r.ok).length;
  lines.push('');
  lines.push(bad ? bad + ' of ' + results.length + ' steps FAILED' : 'ALL ' + results.length + ' STEPS PASSED');
  return lines.join('\n');
}

function cleanDevBuilds() {
  const dir = path.join(ROOT, 'dist');
  for (const f of fs.readdirSync(dir)) if (/^_dev_.*\.html$/.test(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* in use */ } }
}

(async () => {
  const T0 = Date.now();
  console.log('run_all: ' + (QUICK ? 'QUICK' : 'FULL') + ' run, logs in tests/out/run_all/');

  // ---- phase 1: build and static checks
  if (!NO_BUILD && wanted('build')) {
    process.stdout.write('  building ... ');
    const r = await run('build', 'python', ['tools/build.py']);
    const ok = r.code === 0 && fs.existsSync(DIST);
    record('build', ok, r.secs, ok ? lastLines(r.text) : 'build failed: ' + lastLines(r.text));
    console.log(ok ? 'ok' : 'FAILED');
    if (!ok) { console.log(table()); process.exit(1); }
  }
  if (wanted('static')) staticChecks();

  // ---- phase 2: tests without timing sensitivity, in parallel
  const parallel = [];
  if (wanted('wiring')) parallel.push(run('wiring', 'node', ['tests/wiring_check.js'], { timeout: 120 }).then((r) => fromRun(r, /wiring OK|wiring problem/)));
  if (wanted('voice')) parallel.push(run('voice', 'python', ['tests/voice_check.py'], { timeout: 300 }).then((r) => fromRun(r, /RESULT/)));
  if (wanted('sim')) parallel.push(run('sim', 'node', ['tests/sim.js'], { timeout: 600 }).then((r) => fromRun(r, /ALL CHECKS PASSED|FAIL/)));
  if (wanted('game')) parallel.push(run('game', 'node', ['tests/game_test.js'], { timeout: 900 }).then((r) => fromRun(r, /ALL PASS|FAIL/, (t) => !/^\s*FAIL/m.test(t))));
  if (wanted('keys')) parallel.push(run('keys', 'node', ['tests/keys_test.js'], { timeout: 120 }).then((r) => fromRun(r, /ALL PASS|FAIL/, (t) => !/^\s*FAIL/m.test(t))));
  if (wanted('limit')) parallel.push(run('limit', 'node', ['tests/limit_test.js'], { timeout: 300 }).then((r) => fromRun(r, /ALL PASS|FAIL/, (t) => !/^\s*FAIL/m.test(t))));
  if (wanted('audio')) parallel.push(run('audio', 'node', ['tests/audio_analysis.js'].concat(QUICK ? ['--quick'] : []), { timeout: 1500 }).then((r) => fromRun(r, /all checks passed|FAIL/i, (t) => /all checks passed/i.test(t))));
  if (parallel.length) {
    console.log('  running ' + parallel.length + ' non-browser tests in parallel ...');
    await Promise.all(parallel);
  }

  // ---- phase 3: browser tests, one at a time
  const seconds = QUICK ? 30 : 90;
  const browser = [
    ['integration', ['tests/integration_browser.js', '--seconds', String(seconds), '--shot-every', '15'], /ALL PASS|FAILURE/, 600],
    ['keys+screens', ['tests/game_browser.js', 'dist/pacman-flipper.html'], /ALL PASS|FAILURE/, 300],
    ['touch', ['tests/render_touch.js', 'dist/pacman-flipper.html'], /ALL PASS|FAILURE/, 300],
    ['adaptive-quality', ['tests/render_quality.js', 'dist/pacman-flipper.html'], /passed|failed/i, 200],
    ['main-smoke', ['tests/render_main_smoke.js'], /errors \d+/, 200],
    ['render-robust', ['tests/render_robust.js'], /console\/page errors/, 400],
    ['sprites', ['tests/sprite_preview.js'], /draw cost|wrote/, 200],
    ['ball-face', ['tests/render_ball_face.js'], /ALL PASS|FAILURE/, 300],
    ['render-limit', ['tests/render_limit.js'], /ALL PASS|FAILURE/, 600],
    ['voice-embed', ['tests/i2_flow.js', 'voice'], /ALL PASS|FAILURE/, 200],
    ['ball-keys', ['tests/i2_flow.js', 'ball'], /ALL PASS|FAILURE/, 200],
    ['limit-off', ['tests/i2_flow.js', 'off'], /ALL PASS|FAILURE/, 300],
    ['no-network', ['tests/i2_flow.js', 'net'], /ALL PASS|FAILURE/, 120],
    ['goodbye-tap', ['tests/i2_flow.js', 'tap'], /ALL PASS|FAILURE/, 120],
    ['goodbye-keys', ['tests/i2_flow.js', 'goodbye'], /ALL PASS|FAILURE/, 300],
    ['goodbye-bot', ['tests/i2_flow.js', 'goodbye', '--auto'], /ALL PASS|FAILURE/, 500]
  ];
  if (!QUICK) browser.push(['flipper-contact', ['tests/render_flipper_contact.js', 'dist/pacman-flipper.html'], /contacts/, 400]);
  for (const [name, a, re, to] of browser) {
    if (!wanted(name)) continue;
    process.stdout.write('  ' + name + ' ... ');
    const r = await run(name, 'node', a, { timeout: to });
    const ok = fromRun(r, re, name === 'main-smoke' ? (t) => /errors 0/.test(t) : name === 'render-robust' ? (t) => /console\/page errors: 0/.test(t) : name === 'adaptive-quality' ? (t) => /passed/.test(t) : null);
    console.log(ok ? 'ok' : 'FAILED');
  }

  cleanDevBuilds();
  console.log(table());
  console.log('total time ' + ((Date.now() - T0) / 60000).toFixed(1) + ' min; dist: ' + fs.readdirSync(path.join(ROOT, 'dist')).join(', '));
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
