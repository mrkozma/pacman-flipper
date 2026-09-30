'use strict';
// Debug picture of the table geometry (walls by style, posts, bumpers, slings, flippers at rest and raised,
// sensors by kind with ids, holes, tunnels, gate, spinner, targets) with an optional heat map / trajectory traces
// from a bot soak. Renders with headless Edge into tests/out/<out>.png
//   node tests/table_view.js [--out p_table] [--sim N] [--skill 0.6] [--traces K] [--seed X] [--heat]
//                            [--region x,y,w,h] [--scale 1.5] [--seconds 60] [--noids]
const fs = require('fs');
const path = require('path');
const { loadPM } = require('./load');
const { chromium } = require('playwright-core');
const { EDGE, OUT } = require('./browser_helper');

const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf('--' + name); return i < 0 ? def : (args[i + 1] === undefined || args[i + 1].startsWith('--') ? true : args[i + 1]); }
const outName = String(arg('out', 'p_table'));
const SIM = parseInt(arg('sim', 0), 10);
const SKILL = parseFloat(arg('skill', 0.6));
const TRACES = parseInt(arg('traces', 0), 10);
const SEED = parseInt(arg('seed', 3), 10);
const HEAT = !!arg('heat', false) || (SIM > 0 && TRACES === 0);
const SECONDS = parseFloat(arg('seconds', 60));
const SCALE = parseFloat(arg('scale', 1.5));
const NOIDS = !!arg('noids', false);
const LAUNCHES = !!arg('launches', false);
const region = arg('region', '') ? String(arg('region', '')).split(',').map(Number) : null;

const PM = loadPM();
const table = PM.Table.build();

// ---- optional simulation for heat and traces -----------------------------------------------------------
const heat = new Float64Array(54 * 96);
const traces = [];
if (SIM > 0) {
  const DT = 1 / 60;
  for (let g = 0; g < SIM; g++) {
    const w = new PM.Physics.World(table, { rng: PM.util.rng(SEED * 1000 + g) });
    const bot = PM.Bot.create(w, { skill: SKILL, seed: SEED * 77 + g });
    const respawn = [];
    let ballsLeft = 5, serveAt = 0.5, launched = false;
    let tr = null;
    for (let f = 0; f * DT < SECONDS; f++) {
      const t = f * DT;
      if (ballsLeft > 0 && w.balls.length === 0 && t >= serveAt) { w.spawnBall(); ballsLeft--; tr = (traces.length < TRACES && g % Math.max(1, Math.floor(SIM / Math.max(1, TRACES))) === 0) ? [] : null; }
      const out = bot.update(DT);
      w.setInput(out);
      if (out.launch) w.launch(out.power);
      w.step(DT);
      for (const e of w.drainEvents()) {
        if (e.t === 'sensor' && (e.kind === 'dot' || e.kind === 'pellet' || e.kind === 'fruit')) { w.setSensorActive(e.id, false); respawn.push({ id: e.id, at: t + 10 }); }
        if (e.t === 'stuck') w.nudgeBall(e.ballId);
        if (e.t === 'drain') { serveAt = t + 1; if (tr) { traces.push(tr); tr = null; } }
      }
      for (let i = respawn.length - 1; i >= 0; i--) if (respawn[i].at <= t) { w.setSensorActive(respawn[i].id, true); respawn.splice(i, 1); }
      for (const b of w.balls) {
        if (b.state === 'play') heat[Math.floor(b.y / 10) * 54 + Math.floor(b.x / 10)]++;
        if (tr && f % 2 === 0 && b.state !== 'held') tr.push([+b.x.toFixed(1), +b.y.toFixed(1)]);
      }
      if (ballsLeft === 0 && w.balls.length === 0) break;
    }
    if (tr && tr.length) traces.push(tr);
  }
}

if (LAUNCHES) {
  // one launch per power level, idle flippers, first 4.5 seconds
  const DT = 1 / 60;
  for (let i = 0; i <= 10; i++) {
    const power = i / 20;
    const w = new PM.Physics.World(table, { rng: PM.util.rng(5) });
    const b = w.spawnBall();
    for (let k = 0; k < 20; k++) w.step(DT);
    w.launch(power);
    const tr = [];
    for (let f = 0; f < 60 * 4.5; f++) { w.step(DT); if (f % 2 === 0) tr.push([+b.x.toFixed(1), +b.y.toFixed(1)]); w.drainEvents(); if (b.state === 'drained' || b.state === 'held') break; }
    traces.push(tr);
  }
}
const data = { table: table, heat: Array.from(heat), showHeat: HEAT, traces: traces, scale: SCALE, region: region, noids: NOIDS, title: 'p_table  sim=' + SIM + ' skill=' + SKILL };

const drawScript = `
(function () {
  const D = window.DATA, T = D.table;
  const S = D.scale;
  const reg = D.region || [0, 0, T.W, T.H];
  const M = 30;
  const cv = document.getElementById('c');
  cv.width = Math.round(reg[2] * S + M * 2); cv.height = Math.round(reg[3] * S + M * 2 + 26);
  const c = cv.getContext('2d');
  const X = (x) => (x - reg[0]) * S + M, Y = (y) => (y - reg[1]) * S + M + 22;
  c.fillStyle = '#0a1028'; c.fillRect(0, 0, cv.width, cv.height);
  c.font = '13px sans-serif'; c.fillStyle = '#9fb0ff'; c.fillText(D.title, 8, 16);
  c.save();
  c.beginPath(); c.rect(X(reg[0]) , Y(reg[1]), reg[2] * S, reg[3] * S); c.clip();
  // field
  c.beginPath();
  T.decor.field.forEach((p, i) => (i ? c.lineTo(X(p.x), Y(p.y)) : c.moveTo(X(p.x), Y(p.y))));
  c.closePath(); c.fillStyle = '#141d44'; c.fill();
  // grid
  c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 1; c.font = '10px sans-serif'; c.fillStyle = 'rgba(255,255,255,0.35)';
  for (let x = 0; x <= T.W; x += 50) { c.beginPath(); c.moveTo(X(x), Y(0)); c.lineTo(X(x), Y(T.H)); c.stroke(); if (x % 100 === 0) c.fillText(x, X(x) + 2, Y(reg[1]) + 10); }
  for (let y = 0; y <= T.H; y += 50) { c.beginPath(); c.moveTo(X(0), Y(y)); c.lineTo(X(T.W), Y(y)); c.stroke(); if (y % 100 === 0) c.fillText(y, X(reg[0]) + 2, Y(y) - 2); }
  // heat
  if (D.showHeat) {
    let mx = 0; D.heat.forEach((v) => { if (v > mx) mx = v; });
    for (let j = 0; j < 96; j++) for (let i = 0; i < 54; i++) {
      const v = D.heat[j * 54 + i]; if (!v) continue;
      const a = Math.pow(v / mx, 0.45);
      c.fillStyle = 'rgba(255,' + Math.round(200 - 140 * a) + ',60,' + (0.08 + 0.6 * a) + ')';
      c.fillRect(X(i * 10), Y(j * 10), 10 * S, 10 * S);
    }
  }
  // traces
  const cols = ['#ffd84a', '#6fdcf0', '#ff9ecb', '#9dff9d', '#ffb45c', '#c9a0ff'];
  D.traces.forEach((tr, k) => {
    c.beginPath(); tr.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))));
    c.strokeStyle = cols[k % cols.length]; c.globalAlpha = 0.55; c.lineWidth = 1.5; c.stroke(); c.globalAlpha = 1;
  });
  const styleCol = { wall: '#8aa0ff', guide: '#5fd4c4', rubber: '#ff8fb1', arch: '#a9b8ff' };
  // walls
  T.walls.forEach((w) => {
    c.beginPath(); w.pts.forEach((p, i) => (i ? c.lineTo(X(p.x), Y(p.y)) : c.moveTo(X(p.x), Y(p.y))));
    c.strokeStyle = styleCol[w.style] || '#fff'; c.lineWidth = Math.max(1, 2 * w.t * S); c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
  });
  // slings
  T.slings.forEach((s) => {
    c.beginPath(); s.pts.forEach((p, i) => (i ? c.lineTo(X(p.x), Y(p.y)) : c.moveTo(X(p.x), Y(p.y)))); c.closePath();
    c.strokeStyle = '#ff8fb1'; c.lineWidth = 2 * s.t * S; c.lineJoin = 'round'; c.stroke();
    c.fillStyle = 'rgba(255,143,177,0.18)'; c.fill();
    c.beginPath(); c.moveTo(X(s.a.x), Y(s.a.y)); c.lineTo(X(s.b.x), Y(s.b.y)); c.strokeStyle = '#ffe36a'; c.lineWidth = 2; c.stroke();
    const mx = (s.a.x + s.b.x) / 2, my = (s.a.y + s.b.y) / 2;
    arrow(mx, my, mx + s.nx * 40, my + s.ny * 40, '#ffe36a');
    label(s.id, mx + s.nx * 46 - 10, my + s.ny * 46, '#ffe36a');
  });
  // posts
  T.posts.forEach((p) => { c.beginPath(); c.arc(X(p.x), Y(p.y), p.r * S, 0, 7); c.fillStyle = p.style === 'rubber' ? '#ff8fb1' : '#8aa0ff'; c.fill(); });
  // bumpers
  const bc = { red: '#ff6b6b', pink: '#ff9ecb', cyan: '#6fdcf0' };
  T.bumpers.forEach((b) => {
    c.beginPath(); c.arc(X(b.x), Y(b.y), b.r * S, 0, 7); c.fillStyle = bc[b.color]; c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1;
    label(b.id, b.x - 12, b.y + 4, '#000');
  });
  // house
  T.holes.forEach((h) => {
    c.beginPath(); c.arc(X(h.x), Y(h.y), h.r * S, 0, 7); c.strokeStyle = '#ffb45c'; c.lineWidth = 2; c.setLineDash([4, 3]); c.stroke(); c.setLineDash([]);
    label(h.id + ' (hole)', h.x - 30, h.y + 4, '#ffb45c');
  });
  // tunnels
  T.tunnels.forEach((t) => {
    c.beginPath(); c.arc(X(t.x), Y(t.y), t.r * S, 0, 7); c.strokeStyle = '#b28cff'; c.lineWidth = 2; c.setLineDash([4, 3]); c.stroke(); c.setLineDash([]);
    arrow(t.x, t.y, t.x + t.nx * 60, t.y + t.ny * 60, '#b28cff');
    label(t.id, t.x + t.nx * 30 - 12, t.y - 26, '#b28cff');
  });
  // gate
  T.gates.forEach((g) => {
    c.beginPath(); c.moveTo(X(g.a.x), Y(g.a.y)); c.lineTo(X(g.b.x), Y(g.b.y)); c.strokeStyle = '#7dffb0'; c.lineWidth = 3; c.stroke();
    const mx = (g.a.x + g.b.x) / 2, my = (g.a.y + g.b.y) / 2;
    arrow(mx, my, mx + g.nx * 40, my + g.ny * 40, '#7dffb0');
    label('gate', mx - 40, my - 20, '#7dffb0');
  });
  // targets
  T.targets.forEach((t) => {
    c.beginPath(); c.moveTo(X(t.a.x), Y(t.a.y)); c.lineTo(X(t.b.x), Y(t.b.y)); c.strokeStyle = '#ffd84a'; c.lineWidth = 2 * t.t * S; c.lineCap = 'round'; c.stroke();
    label(t.id, t.x - 62, t.y + 4, '#ffd84a');
  });
  // spinner
  T.spinners.forEach((s) => {
    c.beginPath(); c.moveTo(X(s.x - s.w / 2), Y(s.y)); c.lineTo(X(s.x + s.w / 2), Y(s.y)); c.strokeStyle = '#7dffb0'; c.lineWidth = 4; c.stroke();
    label('spinner', s.x + 22, s.y + 4, '#7dffb0');
  });
  // sensors
  const grpCol = { arch: '#ffe9a8', orbit: '#a8ffd9', bumpL: '#ffc4a8', bumpR: '#ffc4a8', top: '#d5c4ff', mid: '#a8e4ff', inL: '#ffa8d9', inR: '#ffa8d9', low: '#e0ffa8' };
  T.sensors.forEach((s) => {
    c.beginPath();
    if (s.kind === 'dot') { c.arc(X(s.x), Y(s.y), 3.2 * S / 1.5, 0, 7); c.fillStyle = grpCol[s.group] || '#fff'; c.fill(); }
    else { c.arc(X(s.x), Y(s.y), s.r * S, 0, 7); c.strokeStyle = s.kind === 'pellet' ? '#ffffff' : s.kind === 'lane' ? '#7dffb0' : '#ff6b6b'; c.lineWidth = 2; c.stroke(); label(s.id, s.x - 16, s.y - s.r - 4, c.strokeStyle); }
    if (!D.noids && s.kind === 'dot' && D.region) label(s.id.replace('dot_', ''), s.x + 4, s.y - 4, '#ccc');
  });
  // flippers
  T.flippers.forEach((f) => {
    flipper(f, f.rest, '#ffd84a', 0.95, false);
    flipper(f, f.up, '#ffffff', 0.9, true);
  });
  // plunger + drain
  const pl = T.plunger;
  c.fillStyle = '#ffd84a'; c.fillRect(X(pl.x - 8), Y(pl.y), 16 * S, 14 * S);
  c.setLineDash([6, 4]); c.strokeStyle = '#ff6b6b'; c.beginPath(); c.moveTo(X(0), Y(T.drainY)); c.lineTo(X(T.W), Y(T.drainY)); c.stroke(); c.setLineDash([]);
  label('drainY ' + T.drainY, 8, T.drainY - 4, '#ff6b6b');
  c.restore();

  function arrow(x0, y0, x1, y1, col) {
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(X(x0), Y(y0)); c.lineTo(X(x1), Y(y1)); c.stroke();
    const a = Math.atan2(Y(y1) - Y(y0), X(x1) - X(x0));
    c.beginPath(); c.moveTo(X(x1), Y(y1)); c.lineTo(X(x1) - 8 * Math.cos(a - 0.4), Y(y1) - 8 * Math.sin(a - 0.4)); c.lineTo(X(x1) - 8 * Math.cos(a + 0.4), Y(y1) - 8 * Math.sin(a + 0.4)); c.closePath(); c.fill();
  }
  function label(t, x, y, col) { c.font = '10px sans-serif'; c.fillStyle = col; c.fillText(t, X(x), Y(y)); }
  function flipper(f, ang, col, alpha, dashed) {
    const ex = Math.cos(ang), ey = Math.sin(ang), k = (f.r0 - f.r1) / f.len, cp = Math.sqrt(1 - k * k);
    const tx = f.px + f.len * ex, ty = f.py + f.len * ey;
    c.globalAlpha = alpha;
    const pts = [];
    for (const s of [-1, 1]) {
      const nx = -s * ey * cp + ex * k, ny = s * ex * cp + ey * k;
      pts.push([f.px + f.r0 * nx, f.py + f.r0 * ny, tx + f.r1 * nx, ty + f.r1 * ny]);
    }
    c.beginPath();
    c.moveTo(X(pts[0][0]), Y(pts[0][1])); c.lineTo(X(pts[0][2]), Y(pts[0][3]));
    c.arc(X(tx), Y(ty), f.r1 * S, Math.atan2(pts[0][3] - ty, pts[0][2] - tx), Math.atan2(pts[1][3] - ty, pts[1][2] - tx), false);
    c.lineTo(X(pts[1][0]), Y(pts[1][1]));
    c.arc(X(f.px), Y(f.py), f.r0 * S, Math.atan2(pts[1][1] - f.py, pts[1][0] - f.px), Math.atan2(pts[0][1] - f.py, pts[0][0] - f.px), false);
    c.closePath();
    if (dashed) { c.strokeStyle = col; c.lineWidth = 1.5; c.setLineDash([4, 3]); c.stroke(); c.setLineDash([]); }
    else { c.fillStyle = col; c.fill(); }
    c.globalAlpha = 1;
  }
})();
`;

const html = '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0a1028"><canvas id="c"></canvas><script>window.DATA=' +
  JSON.stringify(data) + ';</script><script>' + drawScript + '</script></body>';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const htmlPath = path.join(OUT, outName + '.html');
  fs.writeFileSync(htmlPath, html);
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));
  const el = await page.$('#c');
  await el.screenshot({ path: path.join(OUT, outName + '.png') });
  await browser.close();
  if (errors.length) { console.log('page errors:', errors); process.exit(1); }
  console.log('wrote tests/out/' + outName + '.png' + (SIM ? ' (sim ' + SIM + ' games, skill ' + SKILL + ')' : ''));
})();
