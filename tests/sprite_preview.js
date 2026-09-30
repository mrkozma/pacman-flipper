'use strict';
// Renders a contact sheet of every sprite (all moods, sizes 24/48/96/200) plus an animation strip and a draw-cost check.
//   node tests/sprite_preview.js            -> tests/out/s_sprites.png (1x, judge small sizes) and s_sprites_2x.png
// Exit code 1 when the page reports errors or the draw cost is over budget.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { openGame, OUT } = require('./browser_helper');

const ROOT = path.join(__dirname, '..');
const DEV = (() => { const i = process.argv.indexOf('--dev'); return i < 0 ? 'dist/_dev_s.html' : process.argv[i + 1]; })();

function build() {
  execFileSync('python', ['tools/build.py', '--only', '00,05,10,60', '--no-voice', '--out', DEV], { cwd: ROOT, stdio: 'inherit' });
}

// Runs inside the page. Returns {png1, png2, cost}. `scale` is the pixel ratio of the sheet.
function drawSheet(scale) {
  const S = PM.Sprites, T = PM.Theme, C = T.colors;
  const W = 1800;
  const cv = document.createElement('canvas');
  const H = 2400;
  cv.width = W * scale; cv.height = H * scale;
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, C.bg0); bg.addColorStop(0.5, C.bg1); bg.addColorStop(1, C.bg2);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  const label = (s, x, y, size, col) => {
    ctx.font = T.font(size || 14, 500); ctx.fillStyle = col || C.textMuted; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
  };
  const band = (title, y) => { label(title, 16, y, 20, C.text); };
  const sizes = [24, 48, 96, 200];
  // draws fn at the four sizes on a row starting at x; returns the next x
  const fourSizes = (x, yMid, fn) => {
    let cx = x;
    sizes.forEach((d) => { fn(cx + d / 2, yMid, d / 2); cx += d + 14; });
    return cx;
  };

  let y = 26;
  band('Pacman: happy, chomp, surprised, sleepy at 24 / 48 / 96 / 200 px (mouth 0.6)', y); y += 14;
  let x = 16;
  ['happy', 'chomp', 'surprised', 'sleepy'].forEach((m) => {
    const x2 = fourSizes(x, y + 105, (cx, cy, r) => S.pacman(ctx, cx, cy, r, { mood: m, mouth: 0.6, t: 1.3 }));
    label(m, x, y + 224, 14);
    x = x2 + 16;
  });
  y += 268;

  band('Ghosts: four colours, normal, look right-down', y); y += 14;
  x = 16;
  ['red', 'pink', 'cyan', 'orange'].forEach((c) => {
    const x2 = fourSizes(x, y + 105, (cx, cy, r) => S.ghost(ctx, cx, cy, r, { color: c, look: { x: 0.7, y: 0.5 }, t: 0.8 }));
    label(c, x, y + 224, 14);
    x = x2 + 16;
  });
  y += 268;

  band('Ghost moods (red 96 px, cyan 48 px, orange 24 px)', y); y += 14;
  x = 16;
  ['normal', 'blue', 'dizzy', 'happy', 'giggle', 'dance'].forEach((m) => {
    S.ghost(ctx, x + 60, y + 78, 48, { color: 'red', mood: m, t: 0.9, look: { x: -0.6, y: 0.3 } });
    S.ghost(ctx, x + 150, y + 90, 24, { color: 'cyan', mood: m, t: 0.9, look: { x: 0.6, y: 0.3 } });
    S.ghost(ctx, x + 205, y + 96, 12, { color: 'orange', mood: m, t: 0.9 });
    label(m, x, y + 172, 14);
    x += 290;
  });
  y += 208;

  band('Ghost squash (hit reaction), skirt wave frames', y); y += 14;
  x = 16;
  [[1, 1], [1.12, 0.88], [0.88, 1.12], [1.2, 0.8]].forEach((sq, i) => {
    S.ghost(ctx, x + 50, y + 55, 40, { color: 'pink', squash: { x: sq[0], y: sq[1] }, t: 0.4 });
    x += 120;
  });
  x += 40;
  for (let i = 0; i < 8; i++) { S.ghost(ctx, x + 40, y + 55, 34, { color: 'cyan', t: i * 0.11 }); x += 90; }
  y += 132;

  band('Fruit at 24 / 48 / 96 / 200 px (t = 0.5)', y); y += 14;
  x = 16;
  S.FRUITS.forEach((f) => {
    const cx0 = x;
    S.fruit(ctx, f, cx0 + 12, y + 100, 12, { t: 0.5 });
    S.fruit(ctx, f, cx0 + 24 + 12 + 24, y + 100, 24, { t: 0.5 });
    S.fruit(ctx, f, cx0 + 24 + 60 + 48, y + 100, 48, { t: 0.5 });
    label(f, cx0, y + 172, 14);
    x += 290;
  });
  y += 208;

  band('Pickups, decor, ball (each at 12 / 24 / 48 px radius where it makes sense)', y); y += 14;
  const row = (items, y0, step) => {
    let px = 16;
    items.forEach((it) => { it.draw(px + step / 2, y0 + 50, it.r || 24); label(it.name, px + 4, y0 + 112, 13); px += step; });
  };
  row([
    { name: 'dot', r: 5, draw: (a, b, r) => S.dot(ctx, a - 20, b, r) },
    { name: 'dot 2x', r: 10, draw: (a, b, r) => S.dot(ctx, a - 10, b, r) },
    { name: 'pellet', r: 12, draw: (a, b, r) => S.pellet(ctx, a, b, r, { t: 0.4 }) },
    { name: 'pellet big', r: 24, draw: (a, b, r) => S.pellet(ctx, a, b, r, { t: 1.2 }) },
    { name: 'star', r: 24, draw: (a, b, r) => S.star(ctx, a, b, r) },
    { name: 'star face', r: 34, draw: (a, b, r) => S.star(ctx, a, b, r, { face: true }) },
    { name: 'star 12', r: 12, draw: (a, b, r) => S.star(ctx, a, b, r, { glow: true }) },
    { name: 'heart', r: 26, draw: (a, b, r) => S.heart(ctx, a, b, r) },
    { name: 'sparkle', r: 22, draw: (a, b, r) => S.sparkle(ctx, a, b, r, { glow: true }) },
    { name: 'crown', r: 30, draw: (a, b, r) => S.crown(ctx, a, b, r) },
    { name: 'trophy', r: 34, draw: (a, b, r) => S.trophy(ctx, a, b, r) },
    { name: 'question', r: 30, draw: (a, b, r) => S.questionBlock(ctx, a, b, r, { t: 0.3 }) },
    { name: 'ball 10/20/40', r: 10, draw: (a, b) => { S.ball(ctx, a - 55, b, 10, { spin: 0.5 }); S.ball(ctx, a - 10, b, 20, { spin: 1.2 }); S.ball(ctx, a + 55, b, 36); } }
  ], y, 132);
  y += 140;
  // confetti and balloons
  x = 16;
  const cols = C.balloons;
  ['rect', 'circle', 'tri', 'ribbon'].forEach((sh, i) => {
    for (let k = 0; k < 4; k++) S.confetti(ctx, x + 14 + k * 28, y + 30 + (k % 2) * 16, 9, { color: cols[(i + k) % cols.length], shape: sh, rot: k * 0.9 + i, flip: k * 0.27 });
    label(sh, x, y + 78, 13);
    x += 130;
  });
  x += 10;
  cols.forEach((c, i) => { S.balloon(ctx, x + 30, y + 30, 22, { color: c, t: 0.3 + i * 0.4 }); x += 74; });
  S.balloon(ctx, x + 40, y + 30, 12, { color: 'mint', t: 1 });
  S.balloon(ctx, x + 80, y + 30, 8, { color: 'lilac', t: 2 });
  y += 150;

  band('Speech bubbles, keycaps, icons', y); y += 14;
  S.speech(ctx, 130, y + 50, 200, 70, { tail: 'down', text: 'Kuku!' });
  S.speech(ctx, 400, y + 50, 240, 70, { tail: 'left', text: 'Semmi baj!', tailPos: 0 });
  S.speech(ctx, 660, y + 50, 180, 70, { tail: 'right', text: 'Nyam!', color: '#FFE58A' });
  x = 800;
  [['left', false], ['left', true], ['right', false], ['right', true], ['space', false], ['space', true]].forEach((k) => {
    const w = k[0] === 'space' ? 190 : 78;
    S.keycap(ctx, x + w / 2, y + 48, w, 70, k[0], { pressed: k[1] });
    x += w + 18;
  });
  S.keycap(ctx, 1650, y + 48, 60, 56, 'P'); S.keycap(ctx, 1725, y + 48, 60, 56, 'M', { pressed: true });
  y += 130;
  x = 36;
  S.ICONS.forEach((n) => {
    S.icon(ctx, n, x + 24, y + 26, 48);
    S.icon(ctx, n, x + 62, y + 32, 24, { color: C.accent });
    label(n, x - 6, y + 70, 12);
    x += 110;
  });
  y += 104;

  band('Animation strips: mouth 0..1..0 (happy / chomp), Pacman facing 4 ways, ghost moods over time, big saver Pacman', y); y += 14;
  x = 16;
  for (let i = 0; i < 10; i++) {
    const m = Math.abs(Math.sin(i / 10 * Math.PI));
    S.pacman(ctx, x + 32, y + 40, 30, { mouth: m, mood: i % 2 ? 'happy' : 'chomp' }); x += 72;
  }
  x += 20;
  [0, Math.PI / 2, Math.PI, -Math.PI / 2].forEach((d) => { S.pacman(ctx, x + 32, y + 40, 30, { dir: d, mouth: 0.6, bow: d === Math.PI }); x += 72; });
  x += 20;
  [0, 0.4, 0.8, 1].forEach((o) => { S.pacmanBig(ctx, x + 45, y + 45, 42, { open: o, t: 0 }); x += 100; });
  y += 106;
  x = 16;
  for (let i = 0; i < 9; i++) { S.ghost(ctx, x + 30, y + 40, 28, { color: ['red', 'pink', 'cyan', 'orange'][i % 4], mood: ['giggle', 'dance', 'dizzy', 'blue', 'happy'][i % 5], t: i * 0.12 }); x += 76; }
  x += 20;
  S.pacman(ctx, x + 30, y + 40, 28, { mood: 'sleepy', t: 0.2 }); x += 90;
  S.pacman(ctx, x + 30, y + 40, 28, { blink: 1 }); x += 70;
  S.pacman(ctx, x + 30, y + 40, 28, { blink: 0.5 }); x += 70;
  y += 90;

  // ---------- draw cost: 40 ghosts + 40 fruits per frame ----------
  const off = document.createElement('canvas');
  off.width = 1000; off.height = 700;
  const c2 = off.getContext('2d');
  const moods = S.GHOST_MOODS, colors = S.GHOST_COLORS, fr = S.FRUITS;
  const frame = (t) => {
    c2.clearRect(0, 0, 1000, 700);
    for (let i = 0; i < 40; i++) {
      S.ghost(c2, 30 + (i % 10) * 95, 50 + Math.floor(i / 10) * 60, 22, { color: colors[i % 4], mood: moods[i % 6], t: t, look: { x: Math.sin(t + i), y: 0.4 } });
      S.fruit(c2, fr[i % 6], 30 + (i % 10) * 95, 360 + Math.floor(i / 10) * 70, 22, { t: t + i });
    }
  };
  for (let i = 0; i < 20; i++) frame(i * 0.016);
  c2.getImageData(0, 0, 1, 1);
  const N = 200;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) frame(i * 0.016);
  const tCall = (performance.now() - t0) / N;
  c2.getImageData(0, 0, 1, 1);      // force the queue to finish
  const tFull = (performance.now() - t0) / N;
  const crop = document.createElement('canvas');
  crop.width = W * scale; crop.height = Math.min(H, Math.ceil(y + 12)) * scale;
  crop.getContext('2d').drawImage(cv, 0, 0);
  return { png: crop.toDataURL('image/png'), cost: { callMs: tCall, withFlushMs: tFull } };
}

// A big, close-up sheet of the sprites that need a second look. Runs inside the page.
function drawDetail() {
  const S = PM.Sprites, T = PM.Theme, C = T.colors;
  const W = 1500, H = 1180;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, C.bg0); bg.addColorStop(0.5, C.bg1); bg.addColorStop(1, C.bg2);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const label = (s, x, y) => { ctx.font = T.font(14, 500); ctx.fillStyle = C.textMuted; ctx.textAlign = 'left'; ctx.fillText(s, x, y); };
  let x = 20;
  [0, 0.35, 0.7, 1].forEach((o) => { S.pacmanBig(ctx, x + 100, 120, 90, { open: o, t: 0 }); label('pacmanBig open ' + o, x + 20, 236); x += 210; });
  S.pacmanBig(ctx, x + 100, 120, 90, { open: 0.7, mood: 'chomp', bow: true }); label('chomp + bow', x + 20, 236); x += 210;
  x = 20;
  ['blue', 'dizzy', 'giggle', 'dance', 'happy'].forEach((m) => { S.ghost(ctx, x + 100, 370, 90, { color: m === 'blue' ? 'red' : 'cyan', mood: m, t: 0.5, look: { x: 0.5, y: 0.4 } }); label(m, x + 20, 486); x += 250; });
  // real game sizes: ball r=10 magnified 6x next to the true size, HUD-size pacmans, dots
  x = 20;
  S.ball(ctx, 90, 600, 60, { spin: 0.6 }); label('ball r=60 (magnified look)', 20, 690);
  S.ball(ctx, 240, 600, 10); S.ball(ctx, 280, 600, 10, { spin: 1 }); label('ball r=10 real size', 200, 690);
  S.ball(ctx, 420, 600, 14);
  // ball on the table colours
  ctx.fillStyle = C.tableFill; ctx.fillRect(500, 560, 260, 80);
  S.ball(ctx, 540, 600, 10); S.ball(ctx, 600, 600, 10, { spin: 2 }); S.dot(ctx, 650, 600, 5); S.pellet(ctx, 700, 600, 9, { t: 0.7 });
  [10, 12, 14, 18].forEach((r, i) => S.pacman(ctx, 820 + i * 50, 600, r, { mouth: 0.5 - i * 0.05 }));
  [10, 14, 18].forEach((r, i) => S.ghost(ctx, 1040 + i * 50, 600, r, { color: 'pink', look: { x: 1, y: 0 } }));
  label('HUD scale: pacman r=10/12/14/18 and ghosts r=10/14/18, table-colour swatch with balls, dot, pellet', 500, 690);
  // speech bubble, keycaps at real size
  S.keycap(ctx, 90, 800, 80, 70, 'left'); S.keycap(ctx, 190, 800, 80, 70, 'right', { pressed: true }); S.keycap(ctx, 340, 800, 190, 70, 'space');
  S.keycap(ctx, 540, 800, 190, 70, 'space', { pressed: true });
  S.fruit(ctx, 'cherry', 700, 800, 40); S.fruit(ctx, 'strawberry', 790, 800, 40); S.fruit(ctx, 'orange', 880, 800, 40);
  S.fruit(ctx, 'apple', 970, 800, 40); S.fruit(ctx, 'pear', 1060, 800, 40); S.fruit(ctx, 'grapes', 1150, 800, 40);
  label('keycaps (unpressed / pressed) and fruit at r=40', 20, 870);
  S.pacman(ctx, 100, 1010, 90, { mood: 'sleepy', t: 0.4 }); S.pacman(ctx, 320, 1010, 90, { mood: 'surprised', mouth: 0.9 });
  S.pacman(ctx, 540, 1010, 90, { mood: 'happy', mouth: 0 }); S.pacman(ctx, 760, 1010, 90, { mood: 'happy', dir: Math.PI, mouth: 0.6 });
  S.pacman(ctx, 980, 1010, 90, { mood: 'chomp', dir: -Math.PI / 2, mouth: 0.5 });
  S.questionBlock(ctx, 1200, 1010, 70, { t: 0 }); S.questionBlock(ctx, 1360, 1010, 60, { pressed: true });
  return cv.toDataURL('image/png');
}


// Round 2 sprites (SPEC 9): the Pacman ball at real and magnified size in every direction, on the busy table colours, and the big
// waving Pacman with the glove. Runs inside the page. Returns a PNG data URL.
function drawRound2(scale) {
  const S = PM.Sprites, T = PM.Theme, C = T.colors;
  const W = 1500, H = 1180;
  const cv = document.createElement('canvas');
  cv.width = W * scale; cv.height = H * scale;
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, C.bg0); bg.addColorStop(0.5, C.bg1); bg.addColorStop(1, C.bg2);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const label = (s, x, y) => { ctx.font = T.font(13, 500); ctx.fillStyle = C.textMuted; ctx.textAlign = 'left'; ctx.fillText(s, x, y); };
  const PI = Math.PI;
  // row 1: the ball, magnified 4x (r = 54), eight directions, mouth 0.6
  const dirs = [0, PI / 4, PI / 2, 3 * PI / 4, PI, -3 * PI / 4, -PI / 2, -PI / 4];
  dirs.forEach((d, i) => S.pacmanBall(ctx, 70 + i * 130, 70, 54, { dir: d, mouth: 0.6 }));
  label('pacmanBall r=54, mouth 0.6, eight directions', 16, 150);
  // row 2: mouth 0, 0.2, 0.4, 0.6, 0.8, 1 and the bow, magnified
  [0, 0.2, 0.4, 0.6, 0.8, 1].forEach((m, i) => S.pacmanBall(ctx, 70 + i * 130, 240, 54, { dir: 0, mouth: m }));
  S.pacmanBall(ctx, 70 + 6 * 130, 240, 54, { dir: 0, mouth: 0.5, bow: true });
  S.pacmanBall(ctx, 70 + 7 * 130, 240, 54, { dir: PI, mouth: 0.5, bow: true });
  label('mouth 0 / 0.2 / 0.4 / 0.6 / 0.8 / 1 and with the bow (right, left)', 16, 320);
  // row 3: true size (r = 13.5) on the table colour, over dots, a pellet, a lane light, all eight directions, at scale x1 and magnified x2
  ctx.fillStyle = C.tableFill; ctx.fillRect(16, 340, 1100, 130);
  for (let i = 0; i < 8; i++) {
    const cx = 50 + i * 64, cy = 372;
    S.dot(ctx, cx + 18, cy, 3.5, { color: C.dot });
    S.pacmanBall(ctx, cx, cy, 13.5, { dir: dirs[i], mouth: 0.55 });
  }
  for (let i = 0; i < 8; i++) {
    const cx = 50 + i * 64, cy = 432;
    ctx.beginPath(); ctx.arc(cx + 6, cy, 12.5, 0, PI * 2); ctx.fillStyle = '#FFD84A'; ctx.fill();
    S.pacmanBall(ctx, cx, cy, 13.5, { dir: dirs[i], mouth: i % 2 ? 0.1 : 0.7 });
  }
  S.pellet(ctx, 600, 372, 8, { t: 0.4 }); S.pacmanBall(ctx, 622, 372, 13.5, { dir: 0, mouth: 0.6 });
  S.ball(ctx, 700, 372, 10, {}); label('old ball r=10', 672, 400);
  S.pacmanBall(ctx, 760, 372, 10, { dir: 0, mouth: 0.6 }); label('r=10', 744, 400);
  S.pacmanBall(ctx, 820, 372, 13.5, { dir: 0, mouth: 0.6, bow: true }); label('bow', 806, 400);
  S.pacmanBall(ctx, 880, 372, 13.5, { dir: -PI / 2, mouth: 0.05 }); label('lane', 866, 400);
  label('true size r=13.5: over a dot (top row), over a lane light (bottom row), a pellet, old ball, r=10, bow', 16, 490);
  // row 4: pacmanWave at r = 90, three mouth openings and wave phases, then a tiny one (badge) and the arm on the left
  [[0, 0.15, 0], [0.5, 0.4, 0.25], [1, 0.9, 0.5]].forEach((k, i) => S.pacmanWave(ctx, 130 + i * 330, 640, 90, { wave: k[0], open: k[1], phase: k[2], blink: 0 }));
  S.pacmanWave(ctx, 1150, 640, 90, { wave: 1, open: 0.5, phase: 0.75, side: -1, blink: 1 });
  S.pacmanWave(ctx, 1340, 620, 26, { wave: 1, open: 0.4, phase: 0.1 });
  S.pacmanWave(ctx, 1400, 620, 16, { wave: 1, open: 0.4, phase: 0.6 });
  label('pacmanWave r=90: wave 0 open .15, wave .5 open .4, wave 1 open .9, arm left blink; r=26 and r=16 (badge sizes)', 16, 770);
  // row 5: clock at three sizes, and a speech bubble with a clock like the notice
  S.clock(ctx, 60, 850, 40, { t: 0 }); S.clock(ctx, 150, 850, 24, { t: 3 }); S.clock(ctx, 210, 850, 14, { t: 6 });
  S.speech(ctx, 520, 850, 380, 110, { tail: 'left', tailPos: 0, color: '#FFF8E7' });
  S.clock(ctx, 380, 850, 34, { t: 1 });
  ctx.fillStyle = C.ink; ctx.font = T.font(30, 700); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('Sokat játszottál!', 430, 838);
  ctx.font = T.font(19, 500); ctx.fillText('Ez lesz az utolsó labda.', 430, 872);
  label('clock r=40 / 24 / 14, and a bubble like the notice', 16, 940);
  // row 6: the notice size (r = 54) at three wave phases and the badge size (r = 28) beside it
  [0, 0.25, 0.5].forEach((ph, i) => S.pacmanWave(ctx, 90 + i * 170, 1040, 54, { wave: 1, open: 0.45, phase: ph }));
  S.pacmanWave(ctx, 640, 1040, 28, { wave: 1, open: 0.36, phase: 0.1 }); S.pacmanWave(ctx, 760, 1040, 28, { wave: 1, open: 0.36, phase: 0.4 });
  S.pacmanWave(ctx, 900, 1040, 38, { wave: 1, open: 0.5, phase: 0.25, side: -1 });
  label('notice size r=54 (three wave phases), badge size r=28, r=38 mirrored', 16, 1130);
  return cv.toDataURL('image/png');
}

(async () => {
  build();
  const g = await openGame({ file: DEV, viewport: { width: 800, height: 600 } });
  const res = { ok: true };
  try {
    await g.page.waitForFunction(() => window.PM && window.PM.Sprites);
    await g.page.evaluate(() => PM.Theme.fontsReady);
    fs.writeFileSync(path.join(OUT, 's_detail.png'), Buffer.from((await g.page.evaluate(drawDetail)).split(',')[1], 'base64'));
    console.log('wrote', path.join(OUT, 's_detail.png'));
    for (const sc of [1, 2]) {
      fs.writeFileSync(path.join(OUT, sc === 1 ? 's_round2.png' : 's_round2_2x.png'), Buffer.from((await g.page.evaluate(drawRound2, sc)).split(',')[1], 'base64'));
      console.log('wrote', path.join(OUT, sc === 1 ? 's_round2.png' : 's_round2_2x.png'));
    }
    if (process.argv.includes('--r2')) return;   // only the round 2 sheets (fast iteration)
    for (const scale of [1, 2]) {
      const r = await g.page.evaluate(drawSheet, scale);
      const file = path.join(OUT, scale === 1 ? 's_sprites.png' : 's_sprites_2x.png');
      fs.writeFileSync(file, Buffer.from(r.png.split(',')[1], 'base64'));
      console.log('wrote', file);
      console.log('draw cost, 40 ghosts + 40 fruits per frame (scale ' + scale + '): ' + r.cost.callMs.toFixed(2) + ' ms issuing, ' + r.cost.withFlushMs.toFixed(2) + ' ms incl. flush');
      if (r.cost.withFlushMs > 4) { res.ok = false; console.log('OVER BUDGET'); }
    }
  } finally {
    if (g.errors.length) { res.ok = false; console.log('ERRORS:\n' + g.errors.join('\n')); }
    await g.close();
  }
  process.exit(res.ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
