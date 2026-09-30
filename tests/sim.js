'use strict';
// Seeded soak and guarantee tests for the DOM-free physics, table and bot.
//   node tests/sim.js [--games N] [--seconds S] [--seed X] [--quick] [--only name,name] [--traps]
// Sections: nan/bounds, launch, flipper tunneling, flipper feel, idle drain, determinism, performance,
// ball life per bot skill, trap scan, soak with COVERAGE table. Exit code 1 if anything FAILS.
const { loadPM } = require('./load');
const PM = loadPM();

const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf('--' + name); return i < 0 ? def : (args[i + 1] === undefined || args[i + 1].startsWith('--') ? true : args[i + 1]); }
const QUICK = !!arg('quick', false);
const GAMES = parseInt(arg('games', QUICK ? 20 : 200), 10);
const SECONDS = parseFloat(arg('seconds', QUICK ? 40 : 60));
const SEED = parseInt(arg('seed', 1), 10);
const ONLY = arg('only', '') ? String(arg('only', '')).split(',') : null;
const TRAPS = !!arg('traps', false) || !QUICK;
const DT = 1 / 60;

let failures = 0;
const log = (s) => console.log(s);
function check(name, ok, detail) {
  if (!ok) failures++;
  log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
}
function want(name) { return !ONLY || ONLY.indexOf(name) >= 0; }
function section(name) { log('\n== ' + name + ' =='); }
const pct = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN; };
const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d === undefined ? 1 : d) : 'n/a');

const TABLE = PM.Table.build();
function newWorld(seed) { return new PM.Physics.World(TABLE, { rng: PM.util.rng(seed) }); }

// ---------------------------------------------------------------------------------------------------------
// A tiny stand-in for the game rules: eats dots, nudges stuck balls, serves balls, records coverage.
function makeCoverage() {
  const c = {};
  return { hit(k) { c[k] = (c[k] || 0) + 1; }, get: c };
}

function runGame(seed, skill, opt) {
  opt = opt || {};
  const world = newWorld(seed);
  const bot = PM.Bot.create(world, { skill: skill, seed: seed * 7 + 3 });
  const cov = opt.cov || makeCoverage();
  const res = { seed, skill, lives: [], drains: 0, bad: [], maxSlow: 0, hash: 0, frames: 0, maxSpeed: 0, events: 0, stuckEvents: 0 };
  const respawn = [];
  const ballsTotal = opt.balls || 5;
  let ballsLeft = ballsTotal, serveAt = 0.5, t = 0;
  const launchT = {};
  const slowT = {};
  const houseHits = { n: 0 };
  world.setSensorActive('fruit', true);
  const seconds = opt.seconds || SECONDS;
  const traces = opt.trace ? [] : null;
  const heat = opt.heat || null;
  let hash = 2166136261 >>> 0;
  const mix = (v) => { hash = Math.imul(hash ^ (v | 0), 16777619) >>> 0; };

  for (let f = 0; f * DT < seconds; f++) {
    t = f * DT;
    if (ballsLeft > 0 && world.balls.length === 0 && t >= serveAt) { world.spawnBall(); ballsLeft--; }
    const out = bot.update(DT);
    world.setInput(out);
    if (out.launch) { world.setPlunger(out.power); world.launch(out.power); }
    world.step(DT);
    for (const e of world.drainEvents()) {
      res.events++;
      switch (e.t) {
        case 'sensor': {
          cov.hit(e.id.startsWith('dot_') ? 'dot:' + world.sensors.find((s) => s.id === e.id).group : e.id);
          if (e.id.startsWith('dot_')) cov.hit('id:' + e.id);
          const kind = e.kind;
          if (kind === 'dot' || kind === 'pellet' || kind === 'fruit') {
            world.setSensorActive(e.id, false);
            respawn.push({ id: e.id, at: t + (kind === 'dot' ? 10 : kind === 'pellet' ? 15 : 6) });
          }
          break;
        }
        case 'bumper': cov.hit('bumper:' + e.id); break;
        case 'sling': cov.hit('sling:' + e.id); break;
        case 'flipper': cov.hit('flipper:' + e.id); break;
        case 'spinner': cov.hit('spinner'); break;
        case 'hole': cov.hit('hole:house'); houseHits.n++; break;
        case 'holeEject': cov.hit('holeEject'); break;
        case 'tunnel': cov.hit('tunnel:' + e.from); break;
        case 'gate': cov.hit('gate'); break;
        case 'target': cov.hit('target:' + e.id); break;
        case 'launch': launchT[e.ballId] = t; cov.hit('launch'); break;
        case 'wall': cov.hit('wall:' + e.kind); break;
        case 'ballBall': cov.hit('ballBall'); break;
        case 'stuck': res.stuckEvents++; world.nudgeBall(e.ballId); cov.hit('stuck'); break;
        case 'drain':
          res.drains++;
          res.lives.push(t - (launchT[e.ballId] === undefined ? t : launchT[e.ballId]));
          serveAt = t + 1.0;
          break;
        default: break;
      }
    }
    for (let i = respawn.length - 1; i >= 0; i--) if (respawn[i].at <= t) { world.setSensorActive(respawn[i].id, true); respawn.splice(i, 1); }

    // invariants
    for (const b of world.balls) {
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) res.bad.push('NaN at t=' + t.toFixed(2));
      else if (b.x < 0 || b.x > TABLE.W || b.y < 0 || b.y > TABLE.H) res.bad.push('out of bounds ' + b.x.toFixed(1) + ',' + b.y.toFixed(1) + ' t=' + t.toFixed(2));
      if (b.state === 'play') {
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > res.maxSpeed) res.maxSpeed = sp;
        if (sp < 12) { slowT[b.id] = (slowT[b.id] || 0) + DT; if (slowT[b.id] > res.maxSlow) res.maxSlow = slowT[b.id]; } else slowT[b.id] = 0;
        if (b.x > 483 && b.y > 256) res.bad.push('ball in lane while playing t=' + t.toFixed(2));
      }
      if (traces && f % 2 === 0 && b.state !== 'held') traces.push([b.id, +b.x.toFixed(1), +b.y.toFixed(1)]);
      if (heat && b.state === 'play') heat[Math.floor(b.y / 10) * 54 + Math.floor(b.x / 10)]++;
      if (f % 6 === 0) { mix(b.x * 100); mix(b.y * 100); }
    }
    mix(world.balls.length);
    res.frames++;
    if (ballsLeft === 0 && world.balls.length === 0) break;
    if (opt.stopAfterDrains && res.drains >= opt.stopAfterDrains) break;
  }
  res.hash = hash;
  res.rescues = world.stats.rescues;
  res.time = res.frames * DT;
  res.traces = traces;
  return res;
}


// True if a ball centre at (x,y) would start inside or touching solid geometry (test artifact, not a trap).
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy || 1e-9;
  let u = ((px - ax) * dx + (py - ay) * dy) / l2; u = Math.max(0, Math.min(1, u));
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
}
function inTri(px, py, p1, p2, p3) {
  const s = (a, b, c) => (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y);
  const q = { x: px, y: py };
  const d1 = s(q, p1, p2), d2 = s(q, p2, p3), d3 = s(q, p3, p1);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
function insideSolid(x, y) {
  const R = 10.5;
  for (const w of TABLE.walls) for (let i = 0; i + 1 < w.pts.length; i++) if (distSeg(x, y, w.pts[i].x, w.pts[i].y, w.pts[i + 1].x, w.pts[i + 1].y) < R + w.t) return true;
  for (const p of TABLE.posts) if (Math.hypot(x - p.x, y - p.y) < R + p.r) return true;
  for (const b of TABLE.bumpers) if (Math.hypot(x - b.x, y - b.y) < R + b.r) return true;
  for (const s of TABLE.slings) {
    if (inTri(x, y, s.pts[0], s.pts[1], s.pts[2])) return true;
    for (let i = 0; i < 3; i++) { const a = s.pts[i], b = s.pts[(i + 1) % 3]; if (distSeg(x, y, a.x, a.y, b.x, b.y) < R + s.t) return true; }
  }
  for (const t of TABLE.targets) if (distSeg(x, y, t.a.x, t.a.y, t.b.x, t.b.y) < R + t.t) return true;
  for (const f of TABLE.flippers) if (distSeg(x, y, f.px, f.py, f.px + f.len * Math.cos(f.rest), f.py + f.len * Math.sin(f.rest)) < R + f.r0 + 2) return true;
  if (x > 478 && y > 200) return true;              // shooter lane
  if (!inField(x, y)) return true;                  // outside the arch / walls
  return false;
}
function inField(x, y) {
  const poly = TABLE.decor.field;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------------------------------------
if (want('clearance')) {
  section('clearance (free gap between any two separate solid features must be 34 or more)');
  // Every solid feature as a set of capsules (segment + half thickness) or circles.
  const feats = [];
  const segF = (name, pts, th, closed) => { const segs = []; for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, th]); if (closed) segs.push([pts[pts.length - 1].x, pts[pts.length - 1].y, pts[0].x, pts[0].y, th]); return { name: name, segs: segs }; };
  for (const w of TABLE.walls) feats.push(segF(w.id, w.pts, w.t, false));
  for (const p of TABLE.posts) feats.push({ name: p.id, segs: [[p.x, p.y, p.x, p.y, p.r]] });
  for (const b of TABLE.bumpers) feats.push({ name: b.id, segs: [[b.x, b.y, b.x, b.y, b.r]] });
  for (const sl of TABLE.slings) feats.push(segF(sl.id, sl.pts, sl.t, true));
  for (const tg of TABLE.targets) feats.push({ name: tg.id, segs: [[tg.a.x, tg.a.y, tg.b.x, tg.b.y, tg.t]] });
  for (const f of TABLE.flippers) {
    feats.push({ name: 'flip' + f.id + '@rest', segs: [[f.px, f.py, f.px + f.len * Math.cos(f.rest), f.py + f.len * Math.sin(f.rest), (f.r0 + f.r1) / 2]] });
    feats.push({ name: 'flip' + f.id + '@up', segs: [[f.px, f.py, f.px + f.len * Math.cos(f.up), f.py + f.len * Math.sin(f.up), (f.r0 + f.r1) / 2]] });
  }
  function segSegDist(a, b) {
    // min distance between two segments (sampled on a; exact enough at 1 unit resolution)
    let best = 1e9;
    const n = Math.max(1, Math.ceil(Math.hypot(a[2] - a[0], a[3] - a[1]) / 1.5));
    for (let i = 0; i <= n; i++) {
      const x = a[0] + (a[2] - a[0]) * i / n, y = a[1] + (a[3] - a[1]) * i / n;
      const d = distSeg(x, y, b[0], b[1], b[2], b[3]);
      if (d < best) best = d;
    }
    return best;
  }
  const gaps = [];
  for (let i = 0; i < feats.length; i++) for (let j = i + 1; j < feats.length; j++) {
    const A = feats[i], B = feats[j];
    if ((A.name.startsWith('flip') && B.name.startsWith('flip') && A.name[4] === B.name[4]) ) continue;   // same flipper rest vs up
    let best = 1e9;
    for (const sa of A.segs) for (const sb of B.segs) {
      const d = Math.min(segSegDist(sa, sb), segSegDist(sb, sa)) - sa[4] - sb[4];
      if (d < best) best = d;
    }
    if (best > 1.5 && best < 34) gaps.push({ a: A.name, b: B.name, gap: best });
  }
  gaps.sort((x, y) => x.gap - y.gap);
  // the flipper tips at rest are 2.2 ball diameters apart by design; guide/flipper joins are touching by design
  // guide/drain pairs are just the dead space around a flipper pivot (the pivot circle sits between them)
  const bad = gaps.filter((g) => !(/^flip[LR]@up$/.test(g.a) && /^flip[LR]@up$/.test(g.b)) && !(/^guide[LR]$/.test(g.a) && /^drain[LR]$/.test(g.b)));
  bad.forEach((g) => log('  gap ' + g.gap.toFixed(1).padStart(5) + '  ' + g.a + '  <->  ' + g.b));
  check('no separate solid features closer than 34 units (ignoring touching ones)', bad.length === 0, bad.length + ' narrow gaps');
}

// ---------------------------------------------------------------------------------------------------------
if (want('api')) {
  section('API semantics (what the game relies on)');
  const HX = TABLE.holes[0].x, PX = TABLE.bumpers[0].x;
  const bare = (seed) => { const w = newWorld(seed || 1); w.sensors.length = 0; w._sensorMap.clear(); return w; };
  const place = (w, x, y, vx, vy) => { const b = w.spawnBall(); b.attached = false; b.state = 'play'; b.x = x; b.y = y; b.vx = vx || 0; b.vy = vy || 0; return b; };
  const run = (w, sec) => { const out = []; for (let i = 0; i < sec * 60; i++) { w.step(DT); for (const e of w.drainEvents()) out.push(e); } return out; };

  // spawn / max balls / plunger
  {
    const w = newWorld(1);
    const a = w.spawnBall(), b = w.spawnBall(), c = w.spawnBall(), d = w.spawnBall();
    check('spawnBall: three balls fit, the fourth is refused', !!a && !!b && !!c && d === null);
    check('spawnBall: first ball rests on the plunger in state lane', a.state === 'lane' && a.attached && Math.abs(a.y - TABLE.plunger.restY) < 0.01);
    const w2 = newWorld(2); const p = w2.spawnBall();
    w2.setPlunger(1); run(w2, 0.2);
    check('setPlunger: the resting ball follows the pull-back', Math.abs(p.y - (TABLE.plunger.restY + TABLE.plunger.travel)) < 0.5 && w2.elements.plunger.pull > 39, 'ball y ' + p.y.toFixed(1) + ' pull ' + w2.elements.plunger.pull.toFixed(1));
    const lb = w2.launch(0);
    const ev = w2.drainEvents();
    check('launch: fires from the rest position, emits launch, ball stays in state lane until the gate', lb === p && Math.abs(p.y - TABLE.plunger.restY) < 0.5 && p.vy < -880 && ev.some((e) => e.t === 'launch') && p.state === 'lane', 'vy ' + p.vy.toFixed(0));
    check('launch with no ball waiting returns null', newWorld(3).launch(1) === null);
  }
  // gate: a ball coming from the playfield side must not get into the lane
  {
    let inLane = 0, n = 0;
    for (let i = 0; i < 40; i++) {
      const w = newWorld(10 + i);
      const b = place(w, 455 + (i % 5) * 4, 200 + (i % 7) * 8, 100 + i * 4, -200 + (i % 3) * 100);
      run(w, 8);
      n++;
      if (b.x > 484 && b.y > 256 && b.state !== 'drained') inLane++;
    }
    check('gate: balls thrown at the lane top from the playfield never enter the lane', inLane === 0, inLane + '/' + n);
  }
  // sensors
  {
    const w = bare(4);
    w.addSensor({ id: 's1', kind: 'dot', x: 250, y: 500, r: 14 });
    place(w, 250, 400, 0, 200);
    let ev = run(w, 1.2).filter((e) => e.t === 'sensor');
    check('sensor: begin-overlap event fires once when the ball rolls through', ev.length === 1 && ev[0].id === 's1' && ev[0].kind === 'dot', ev.length + ' events');
    w.balls.length = 0; place(w, 250, 400, 0, 200);
    ev = run(w, 1.2).filter((e) => e.t === 'sensor');
    check('sensor: re-arms after the ball has left', ev.length === 1, ev.length + ' events');
    w.setSensorActive('s1', false); w.balls.length = 0; place(w, 250, 400, 0, 200);
    check('sensor: inactive sensors are silent', run(w, 1.2).filter((e) => e.t === 'sensor').length === 0);
    w.setSensorActive('s1', true); w.moveSensor('s1', 400, 500); w.balls.length = 0; place(w, 400, 400, 0, 200);
    check('sensor: moveSensor works', run(w, 1.2).filter((e) => e.t === 'sensor').length === 1);
    w.removeSensor('s1'); w.balls.length = 0; place(w, 400, 400, 0, 200);
    check('sensor: removeSensor works', run(w, 1.2).filter((e) => e.t === 'sensor').length === 0 && w.sensors.length === 0);
    w.addSensor({ id: 's2', kind: 'balloon', x: 400, y: 300, r: 30 });
    w.balls.length = 0; place(w, 400, 300, 0, 0); w.params.gravity = 0;
    check('sensor: a ball resting inside does not re-fire', run(w, 2).filter((e) => e.t === 'sensor').length === 1);
  }
  // bumper, sling, target events and hit timers
  {
    const w = bare(5);
    place(w, PX, 240, 0, 300);
    let bu = null, hitAtEvent = 0;
    for (let i = 0; i < 60 && !bu; i++) { w.step(DT); bu = w.drainEvents().find((e) => e.t === 'bumper') || null; if (bu) hitAtEvent = w.elements.bumpers.piri.hit; }
    check('bumper: event with id, speed near the kick, hit timer set', !!bu && bu.id === 'piri' && bu.speed > 380 && bu.speed < 560 && hitAtEvent > 0.5, bu ? bu.id + ' ' + bu.speed.toFixed(0) + ' hit ' + hitAtEvent.toFixed(2) : 'none');
    let ev = [];
    const w2 = bare(6);
    place(w2, 150, 700, -220, 60);
    ev = run(w2, 0.5);
    check('sling: kicks a ball that hits the active edge', ev.some((e) => e.t === 'sling' && e.id === 'slingL'), ev.map((e) => e.t).join(','));
    const w3 = bare(7);
    place(w3, 440, 454, 300, 0);
    ev = run(w3, 0.4);
    check('target: mystery target event', ev.some((e) => e.t === 'target' && e.id === 'mystery'));
  }
  // hole: capture, hold, eject, lock, release
  {
    const w = bare(8);
    const b = place(w, HX, 150, 0, 150);
    let ev = run(w, 1.0);
    check('hole: a ball dropped into the funnel is captured (state held, at the centre)', ev.some((e) => e.t === 'hole') && b.state === 'held' && Math.abs(b.x - HX) < 0.1 && w.elements.holes.house.occupied);
    run(w, 0.5);
    check('hole: still held before holdTime', b.state === 'held');
    // read the velocity in the frame of the eject (later the ball may already have hit Piri below)
    ev = [];
    let ejV = null;
    for (let i = 0; i < 1.2 * 60 && !ejV; i++) { w.step(DT); const es = w.drainEvents(); for (const e of es) ev.push(e); if (es.some((e) => e.t === 'holeEject')) ejV = { vx: b.vx, vy: b.vy }; }
    check('hole: popped out after holdTime with a downward velocity', !!ejV && b.state === 'play' && ejV.vy > 100, ejV ? 'vy ' + ejV.vy.toFixed(0) : 'no eject');
    check('hole: the pop goes down and to one side (not straight onto Piri), speed about 240', !!ejV && Math.abs(ejV.vx) > 90 && Math.abs(ejV.vx) < 170 && ejV.vy > 175 && Math.abs(Math.hypot(ejV.vx, ejV.vy) - 240) < 12, ejV ? 'vx ' + ejV.vx.toFixed(0) + ' vy ' + ejV.vy.toFixed(0) : 'no eject');
    const w2 = bare(9); const b2 = place(w2, HX, 150, 0, 150); run(w2, 0.6);
    w2.lockBall(b2.id); run(w2, 4);
    check('lockBall: a locked ball stays in the saucer past holdTime', b2.state === 'held' && w2.elements.holes.house.occupied);
    w2.releaseBall(b2.id, 60, 200);
    const ev2 = w2.drainEvents();
    check('releaseBall: sets state play, the given velocity and emits holeEject', b2.state === 'play' && b2.vx === 60 && b2.vy === 200 && ev2.some((e) => e.t === 'holeEject'));
    const w3 = bare(11); place(w3, HX, 150, 0, 150); run(w3, 0.6);
    const c2 = place(w3, HX, 120, 0, 150); run(w3, 8);
    check('hole: a second ball arriving while the hole is busy falls through and drains', c2.state !== 'held' && (c2.state === 'drained' || w3.balls.indexOf(c2) < 0 || Math.hypot(c2.vx, c2.vy) > 12), c2.state);
  }
  // tunnels
  {
    const w = bare(12);
    const b = place(w, 60, 570, -300, 0);
    const ev = run(w, 0.5);
    const tn = ev.find((e) => e.t === 'tunnel');
    check('tunnel: entering tunL warps to tunR, leaving the wall to the left', !!tn && tn.from === 'tunL' && tn.to === 'tunR' && b.x < 470 && b.x > 300 && b.vx < -250, tn ? ('exit x ' + b.x.toFixed(0) + ' vx ' + b.vx.toFixed(0)) : 'no event');
    check('tunnel: exactly one warp (no ping pong)', ev.filter((e) => e.t === 'tunnel').length === 1);
  }
  // spinner
  {
    const w = bare(13);
    place(w, 43, 280, 0, 350);
    const ticks = run(w, 3).filter((e) => e.t === 'spinner');
    check('spinner: a ball passing through the orbit lane gives several ticks', ticks.length >= 3 && ticks[0].spin > 5, ticks.length + ' ticks');
  }
  // stuck + nudge
  {
    const w = newWorld(14); w.sensors.length = 0;
    w.setInput({ left: true, right: true });
    run(w, 1);
    const b = place(w, 158, 800, 0, 0);
    const ev = run(w, 4);
    check('stuck: a ball resting in a flipper valley reports stuck after about 2.5 s', ev.some((e) => e.t === 'stuck' && e.ballId === b.id));
    w.nudgeBall(b.id);
    check('nudgeBall: gives an upward hop toward the middle', b.vy < -150 && b.vx > 0, 'v ' + b.vx.toFixed(0) + ',' + b.vy.toFixed(0));
  }
  // drain
  {
    const w = bare(15);
    const b = place(w, 250, 900, 0, 200);
    const ev = run(w, 1);
    check('drain: event once, ball state drained', ev.filter((e) => e.t === 'drain').length === 1 && b.state === 'drained');
    w.step(DT);
    check('drain: drained ball is removed by the next step', w.balls.length === 0);
    const w2 = bare(16); const b2 = place(w2, 250, 400, 0, 0);
    check('removeBall removes', w2.removeBall(b2.id) && w2.balls.length === 0);
  }
  // ball vs ball
  {
    const w = bare(17); w.params.gravity = 0;
    place(w, 200, 470, 200, 0); place(w, 300, 470, -200, 0);
    check('two balls collide and bounce apart (event ballBall)', run(w, 1).some((e) => e.t === 'ballBall'));
  }
  // params
  {
    const a = bare(18), b = bare(18); b.params.gravity = 215;
    const pa = place(a, 250, 100, 0, 0), pb = place(b, 250, 100, 0, 0);
    run(a, 0.5); run(b, 0.5);
    check('params.gravity: half gravity falls about half as far', Math.abs((pb.y - 100) / (pa.y - 100) - 0.5) < 0.08, ((pb.y - 100) / (pa.y - 100)).toFixed(2));
    const c = bare(19); c.params.timeScale = 0.5; const pc = place(c, 250, 100, 0, 0); run(c, 0.5);
    check('params.timeScale: half time scale gives a quarter of the fall', Math.abs((pc.y - 100) / (pa.y - 100) - 0.25) < 0.06, ((pc.y - 100) / (pa.y - 100)).toFixed(2));
    const d = bare(20); d.params.flipperScale = 1.35; run(d, 1);
    check('params.flipperScale: flippers grow to 1.35 of their length', Math.abs(d.flippers[0].len - 108) < 0.5 && Math.abs(d.flippers[0].r0 - 16.2) < 0.2, 'len ' + d.flippers[0].len.toFixed(1));
    const e = bare(21); e.step(1.0);
    check('step: a 1 s frame is clamped (no more than 0.05 s simulated)', e.time <= 0.0501 && e.time > 0.045, e.time.toFixed(4));
    const f = bare(22); const pRef = f.params, flRef = f.flippers, elRef = f.elements, sRef = f.sensors;
    f.params.gravity = 999; f.spawnBall(); f.reset();
    check('reset: clears balls and restores the default params', f.balls.length === 0 && f.params.gravity === 430);
    check('reset: keeps the identity of params, flippers, sensors and elements (safe to cache)', f.params === pRef && f.flippers === flRef && f.elements === elRef && f.sensors === sRef && f.sensors.length === TABLE.sensors.length);
  }
}

// ---------------------------------------------------------------------------------------------------------
if (want('fuzz')) {
  section('fuzz (random API calls and random param changes, like a very silly game)');
  let sessions = 0, exceptions = 0, badState = 0, firstProblem = '';
  const rng = PM.util.rng(SEED + 909);
  const N = QUICK ? 40 : 150;
  for (let s = 0; s < N; s++) {
    const w = newWorld(900 + s);
    sessions++;
    try {
      const idsToLock = [];
      for (let f = 0; f < 60 * 45; f++) {
        // random game-like actions
        const r = rng();
        if (r < 0.02) w.spawnBall();
        else if (r < 0.04) { w.setPlunger(rng()); }
        else if (r < 0.06) w.launch(rng());
        else if (r < 0.065 && w.balls.length) w.lockBall(w.balls[Math.floor(rng() * w.balls.length)].id);
        else if (r < 0.075 && w.balls.length) { const b = w.balls[Math.floor(rng() * w.balls.length)]; w.releaseBall(b.id, (rng() - 0.5) * 600, (rng() - 0.5) * 600); }
        else if (r < 0.078 && w.balls.length) w.removeBall(w.balls[Math.floor(rng() * w.balls.length)].id);
        else if (r < 0.085 && w.balls.length) w.nudgeBall(w.balls[Math.floor(rng() * w.balls.length)].id);
        else if (r < 0.09) w.addSensor({ id: 'x' + Math.floor(rng() * 6), kind: 'balloon', x: 100 + rng() * 300, y: 300 + rng() * 300, r: 8 + rng() * 25 });
        else if (r < 0.095) w.removeSensor('x' + Math.floor(rng() * 6));
        else if (r < 0.1) w.moveSensor('x' + Math.floor(rng() * 6), 100 + rng() * 300, 300 + rng() * 300);
        else if (r < 0.105) w.setSensorActive('dot_' + (1 + Math.floor(rng() * 47)), rng() < 0.5);
        else if (r < 0.115) {
          w.params.gravity = 430 * (0.5 + rng() * 1.2);
          w.params.timeScale = 0.3 + rng() * 1.3;
          w.params.flipperScale = 0.8 + rng() * 0.6;
          w.params.bumperKick = 300 + rng() * 300;
          w.params.slingKick = 250 + rng() * 300;
          w.params.maxSpeed = 700 + rng() * 300;
        }
        else if (r < 0.116) w.reset();
        w.setInput({ left: rng() < 0.4, right: rng() < 0.4 });
        w.step(f % 97 === 0 ? 0.2 : DT * (0.5 + rng() * 2));
        for (const e of w.drainEvents()) if (e.t === 'stuck' && rng() < 0.7) w.nudgeBall(e.ballId);
        if (w.balls.length > 3) { badState++; firstProblem = firstProblem || 'more than 3 balls'; }
        for (const b of w.balls) {
          if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) { badState++; firstProblem = firstProblem || 'NaN in session ' + s; }
          else if ((b.state === 'play' || b.state === 'lane') && (b.x < 0 || b.x > TABLE.W || b.y < -5 || b.y > TABLE.H + 5)) { badState++; firstProblem = firstProblem || 'ball out of bounds ' + b.x.toFixed(0) + ',' + b.y.toFixed(0) + ' state ' + b.state; }
        }
        for (const fl of w.flippers) if (!Number.isFinite(fl.angle) || !Number.isFinite(fl.len)) { badState++; firstProblem = firstProblem || 'flipper NaN'; }
      }
    } catch (e) { exceptions++; firstProblem = firstProblem || String(e && e.stack || e).split('\n').slice(0, 2).join(' | '); }
  }
  check('fuzz: no exception, no NaN, no ball outside the table, never more than 3 balls', exceptions === 0 && badState === 0, sessions + ' sessions of 45 s' + (firstProblem ? '; first problem: ' + firstProblem : ''));
}

// ---------------------------------------------------------------------------------------------------------
if (want('stress')) {
  section('wall stress (perfectly elastic, no gravity, balls keep max speed; walls, posts, bumpers, slings, flippers swinging)');
  for (const [label, cap] of [['play cap 950', 950], ['3 x over-cap 1500', 1500]]) {
    let bad = 0, worst = '', rescues = 0, minD = 1e9, total = 0;
    const rng = PM.util.rng(SEED + 4242);
    for (let i = 0; i < (QUICK ? 30 : 120); i++) {
      const w = newWorld(700 + i);
      w.sensors.length = 0; w._sensorMap.clear();
      Object.assign(w.params, { restitution: 1, rubberRestitution: 1, flipperRestitution: 1, friction: 0, airDrag: 0, gravity: 0, maxSpeed: cap, bumperKick: 380, slingKick: 340 });
      const b = w.spawnBall(); b.attached = false; b.state = 'play';
      // start in free space
      let x, y, tries = 0;
      do { x = 40 + rng() * 420; y = 40 + rng() * 760; tries++; } while (insideSolid(x, y) && tries < 200);
      const ang = rng() * Math.PI * 2;
      b.x = x; b.y = y; b.vx = Math.cos(ang) * cap; b.vy = Math.sin(ang) * cap;
      w.balls.length = 0; w.balls.push(b);
      for (let f = 0; f < 60 * 12 && b.state !== 'drained' && b.state !== 'held'; f++) {
        // wave the flippers around
        if (f % 20 === 0) w.setInput({ left: rng() < 0.5, right: rng() < 0.5 });
        w.step(DT);
        w.drainEvents();
        total++;
        if (b.state === 'held') break;
        if (b.x < 0 || b.x > TABLE.W || b.y < 0 || b.y > TABLE.H) { bad++; worst = 'escaped to ' + b.x.toFixed(0) + ',' + b.y.toFixed(0) + ' game ' + i; break; }
        // deep penetration: ball centre inside a wall body
        for (const wl of TABLE.walls) for (let k = 0; k + 1 < wl.pts.length; k++) {
          const d = distSeg(b.x, b.y, wl.pts[k].x, wl.pts[k].y, wl.pts[k + 1].x, wl.pts[k + 1].y) - wl.t;
          if (d < minD) minD = d;
        }
      }
      rescues += w.stats.rescues;
    }
    check(label + ': no ball ever leaves the table, no rescues', bad === 0 && rescues === 0, (bad ? worst : total + ' frames') + ', rescues ' + rescues);
    check(label + ': ball centre never inside a wall body', minD > 0, 'closest the centre ever got to a wall surface: ' + minD.toFixed(1) + ' (ball radius is 10)');
  }
}

// ---------------------------------------------------------------------------------------------------------
if (want('launch')) {
  section('launch (min, middle, max power; also slow gravity and heavy gravity)');
  const stats = { total: 0, entered: 0, backInLane: 0, minY: 1e9 };
  const failures0 = [];
  for (const gScale of [1, 0.6, 1.2]) {
    for (let i = 0; i <= 100; i++) {
      const power = i / 100;
      const w = newWorld(100 + i);
      w.params.gravity = 430 * gScale;
      const b = w.spawnBall();
      for (let k = 0; k < 30; k++) w.step(DT);
      w.setPlunger(power);
      w.launch(power);
      let entered = -1, bad = false;
      for (let f = 0; f < 60 * 8 && b.state !== 'drained'; f++) {
        w.step(DT);
        if (b.state === 'play' && entered < 0) entered = f * DT;
        if (b.state === 'lane' && entered >= 0) bad = true;
        if (b.state === 'play' && b.x > 483 && b.y > 256) bad = true;
        if (b.y < stats.minY) stats.minY = b.y;
      }
      stats.total++;
      if (entered >= 0 && entered < 4 && !bad) stats.entered++; else failures0.push('g' + gScale + ' power ' + power + ' entered ' + entered + ' bad ' + bad);
    }
  }
  check('every launch power enters the playfield and never returns to the lane', stats.entered === stats.total, stats.entered + '/' + stats.total + (failures0.length ? ' first fail: ' + failures0[0] : ''));
  // what each power level does (documentation for the game: which lane a launch lights)
  const zones = [];
  for (let i = 0; i <= 20; i++) {
    const p = i / 20;
    const w = newWorld(3); const b = w.spawnBall(); for (let k = 0; k < 30; k++) w.step(DT);
    w.launch(p);
    const seen = [];
    for (let f = 0; f < 60 * 5; f++) {
      w.step(DT);
      for (const e of w.drainEvents()) {
        const tag = e.t === 'sensor' && e.kind === 'lane' ? e.id : e.t === 'hole' ? 'house' : e.t === 'spinner' ? 'spinner' : e.t === 'tunnel' ? 'tunnel' : null;
        if (tag && seen.indexOf(tag) < 0) seen.push(tag);
      }
    }
    zones.push(p.toFixed(2) + ':' + (seen.join('+') || '-'));
  }
  log('  info: launch power map (first events of a launch, no flipper input): ' + zones.join('  '));
}

// ---------------------------------------------------------------------------------------------------------
if (want('tunnel')) {
  section('flipper tunneling (balls dropped onto resting and swinging flippers)');
  let n = 0, through = 0, worstDepth = 0;
  const rng = PM.util.rng(SEED + 55);
  for (let i = 0; i < 400; i++) {
    const w = newWorld(200 + i);
    const side = i % 2;
    const f = w.flippers[side];
    const swing = i % 4 >= 2;
    // drop above the flipper body (not beyond the tip, where a ball may legitimately fall between the tips)
    const alongFrac = 0.05 + 0.85 * rng();
    const ex = Math.cos(f.restAngle), ey = Math.sin(f.restAngle);
    const bx = f.px + ex * f.len * alongFrac, by = f.py + ey * f.len * alongFrac;
    const speed = rng() * 900;
    const ang = (rng() - 0.5) * 1.0;
    const startH = 25 + rng() * 120;
    const b = w.spawnBall();
    b.attached = false; b.state = 'play';
    b.x = bx; b.y = by - startH; b.vx = Math.sin(ang) * speed * 0.4; b.vy = Math.cos(ang) * speed;
    w.balls.length = 0; w.balls.push(b);
    const delay = rng() * 0.5;
    n++;
    let hit = false;
    for (let fr = 0; fr < 180; fr++) {
      const tt = fr * DT;
      if (swing) w.setInput({ left: side === 0 && tt >= delay && tt < delay + 0.25, right: side === 1 && tt >= delay && tt < delay + 0.25 });
      w.step(DT);
      if (b.state === 'drained') break;
      // the ball CENTRE must never be inside the flipper capsule (distance to the axis < tapered radius)
      const rx = b.x - f.px, ry = b.y - f.py;
      let u = (rx * f.ex + ry * f.ey) / f.len; u = Math.max(0, Math.min(1, u));
      const dist = Math.hypot(rx - u * f.len * f.ex, ry - u * f.len * f.ey);
      const rad = f.r0 + (f.r1 - f.r0) * u;
      if (dist < rad - 1) { hit = true; if (rad - dist > worstDepth) worstDepth = rad - dist; }
    }
    if (hit) through++;
  }
  check('no ball passes through a flipper body', through === 0, through + ' of ' + n + ' passed, worst depth ' + fmt(worstDepth));
}

// ---------------------------------------------------------------------------------------------------------
if (want('feel')) {
  section('flipper feel (ball resting on the flipper, then flipped)');
  const rows = [];
  const peaks = [];
  for (const frac of [0.15, 0.3, 0.5, 0.7, 0.9, 1.0]) {
    const w = newWorld(9);
    w.params.gravity = 0;                                // freeze the ball in place until the flipper reaches it
    const f = w.flippers[0];
    const ex = Math.cos(f.restAngle), ey = Math.sin(f.restAngle);
    const nx = ey, ny = -ex;
    const b = w.spawnBall(); b.attached = false; b.state = 'play';
    const rad = f.r0 + (f.r1 - f.r0) * frac + b.r + 0.05;
    b.x = f.px + ex * f.len * frac + nx * rad; b.y = f.py + ey * f.len * frac + ny * rad; b.vx = 0; b.vy = 0;
    w.balls.length = 0; w.balls.push(b);
    w.setInput({ left: true });
    let peak = 0, vAt = [0, 0];
    for (let k = 0; k < 30; k++) { w._sub(1 / PM.CFG.PHYS_HZ); const sp = Math.hypot(b.vx, b.vy); if (sp > peak) { peak = sp; vAt = [b.vx, b.vy]; } }
    peaks.push(peak);
    rows.push('  ball touching the flipper at ' + String(Math.round(frac * 100)).padStart(3) + '% of its length, flipped: launch speed ' + fmt(peak, 0).padStart(4) + ' units/s, ' + (Math.atan2(-vAt[1], vAt[0]) * 180 / Math.PI).toFixed(0) + ' deg above +x');
  }
  rows.forEach(log);
  check('flipper feel: near the pivot gentle, mid 600 to 900, tip capped at the speed limit', peaks[0] < 600 && peaks[2] >= 600 && peaks[2] <= 900 && peaks[5] <= 950.5, 'pivot ' + fmt(peaks[0], 0) + ', mid ' + fmt(peaks[2], 0) + ', tip ' + fmt(peaks[5], 0));
  // a ball resting on a raised flipper must be still (no jitter)
  const w = newWorld(11); const f = w.flippers[0];
  w.setInput({ left: true });
  for (let k = 0; k < 30; k++) w.step(DT);
  const b = w.spawnBall(); b.attached = false; b.state = 'play'; b.x = f.px + 30; b.y = f.py - 30; b.vx = 0; b.vy = 0;
  w.balls.length = 0; w.balls.push(b);
  for (let k = 0; k < 240; k++) w.step(DT);
  let jit = 0, prev = { x: b.x, y: b.y };
  for (let k = 0; k < 60; k++) { w.step(DT); jit += Math.hypot(b.x - prev.x, b.y - prev.y); prev = { x: b.x, y: b.y }; }
  check('ball cradled on a raised flipper is still', jit < 2, 'moved ' + fmt(jit, 2) + ' units in 1 s; sitting at ' + fmt(b.x, 0) + ',' + fmt(b.y, 0));
  // resting on a lowered flipper: rolls off (not stuck on the flipper)
  const w2 = newWorld(12); const f2 = w2.flippers[0];
  const b2 = w2.spawnBall(); b2.attached = false; b2.state = 'play'; b2.x = f2.px + 40; b2.y = f2.py + 4; b2.vx = 0; b2.vy = 0;
  w2.balls.length = 0; w2.balls.push(b2);
  let drained = false; for (let k = 0; k < 60 * 6; k++) { w2.step(DT); if (b2.state === 'drained') { drained = true; break; } }
  check('ball on a lowered flipper rolls off and drains', drained);
}

// ---------------------------------------------------------------------------------------------------------
if (want('idle')) {
  section('idle player (no flipper input): ball must drain');
  const lives = [];
  let notDrained = 0;
  const n = QUICK ? 12 : 40;
  for (let i = 0; i < n; i++) {
    const r = runGame(SEED * 1000 + i, 0, { balls: 1, seconds: 180 });
    if (r.lives.length) lives.push(r.lives[0]); else notDrained++;
    if (r.bad.length) { check('idle game ' + i + ' invariants', false, r.bad[0]); }
  }
  check('unattended balls all drain', notDrained === 0, 'life median ' + fmt(pct(lives, 0.5)) + ' s, p90 ' + fmt(pct(lives, 0.9)) + ' s, max ' + fmt(Math.max.apply(null, lives)) + ' s, not drained ' + notDrained + '/' + n);
}

// ---------------------------------------------------------------------------------------------------------
if (want('determinism')) {
  section('determinism');
  const a = runGame(4242, 0.5, { seconds: 90 });
  const b = runGame(4242, 0.5, { seconds: 90 });
  const c = runGame(4243, 0.5, { seconds: 90 });
  check('same seed gives identical run', a.hash === b.hash && a.events === b.events && a.drains === b.drains, 'hash ' + a.hash + ' events ' + a.events);
  check('different seed gives a different run', a.hash !== c.hash);
}

// ---------------------------------------------------------------------------------------------------------
if (want('perf')) {
  section('performance (2 balls, 480 Hz substeps)');
  const w = newWorld(77);
  const bot = PM.Bot.create(w, { skill: 0.7, seed: 5 });
  w.spawnBall(); w.spawnBall();
  const ms = [];
  let frames = 0;
  for (let f = 0; f < 60 * (QUICK ? 30 : 90); f++) {
    if (w.balls.filter((b) => b.state !== 'drained').length < 2 && w.balls.length < 3) { const nb = w.spawnBall(); if (!nb) { /* full */ } }
    const out = bot.update(DT);
    w.setInput(out);
    if (out.launch) w.launch(out.power);
    const t0 = process.hrtime.bigint();
    w.step(DT);
    const t1 = process.hrtime.bigint();
    ms.push(Number(t1 - t0) / 1e6);
    for (const e of w.drainEvents()) if (e.t === 'stuck') w.nudgeBall(e.ballId);
    frames++;
  }
  ms.sort((x, y) => x - y);
  const mean = ms.reduce((s, v) => s + v, 0) / ms.length;
  log('  frames ' + frames + ', mean ' + mean.toFixed(3) + ' ms, median ' + pct(ms, 0.5).toFixed(3) + ' ms, p99 ' + pct(ms, 0.99).toFixed(3) + ' ms, max ' + ms[ms.length - 1].toFixed(3) + ' ms per frame');
  check('physics well under 1 ms per frame (mean)', mean < 0.5, mean.toFixed(3) + ' ms');
  check('p99 under 1 ms', pct(ms, 0.99) < 1.0, pct(ms, 0.99).toFixed(3) + ' ms');
}

// ---------------------------------------------------------------------------------------------------------
if (want('life')) {
  section('ball life per bot skill (seconds from launch to drain)');
  const N = QUICK ? 10 : 30;
  const out = {};
  for (const [name, skill] of [['perfect', 1], ['kid', 0.8], ['idle', 0]]) {
    const lives = [];
    for (let i = 0; i < N; i++) {
      const r = runGame(SEED * 5000 + i * 3 + 1, skill, { balls: 1, seconds: 240 });
      if (r.bad.length) check(name + ' game ' + i + ' invariants', false, r.bad[0]);
      lives.push(r.lives.length ? r.lives[0] : 240);
    }
    out[name] = lives;
    log('  ' + name.padEnd(8) + ' n=' + N + '  p10 ' + fmt(pct(lives, 0.1)) + '  median ' + fmt(pct(lives, 0.5)) + '  mean ' + fmt(lives.reduce((s, v) => s + v, 0) / N) + '  p90 ' + fmt(pct(lives, 0.9)) + '  max ' + fmt(Math.max.apply(null, lives)));
  }
  const kidMed = pct(out.kid, 0.5);
  check('kid bot median ball life within 25 to 90 s', kidMed >= 25 && kidMed <= 90, fmt(kidMed) + ' s');
  check('perfect bot lives longer than kid bot', pct(out.perfect, 0.5) > kidMed, fmt(pct(out.perfect, 0.5)) + ' vs ' + fmt(kidMed));
  check('idle balls die much sooner than kid balls', pct(out.idle, 0.5) < kidMed * 0.7, fmt(pct(out.idle, 0.5)) + ' vs ' + fmt(kidMed));
}

// ---------------------------------------------------------------------------------------------------------
if (want('traps')) {
  section('trap scan (ball dropped at rest on a grid, nudged when stuck, up to 40 s)');
  const STEP = TRAPS ? 14 : 30;
  for (const mode of ['flippers down', 'both flippers held up']) {
    const traps = [], nudged = [];
    let n = 0, drainedN = 0;
    const prng = PM.util.rng(99);
    for (let y = 30; y <= 880; y += STEP) {
      for (let x = 30; x <= 474; x += STEP) {
        if (insideSolid(x, y)) continue;
        const w = newWorld(31 + n);
        const b = w.spawnBall(); b.attached = false; b.state = 'play';
        b.x = x; b.y = y; b.vx = (prng() - 0.5) * 8; b.vy = 0;   // a hair of sideways speed: no exact knife edge
        w.balls.length = 0; w.balls.push(b);
        n++;
        if (mode !== 'flippers down') w.setInput({ left: true, right: true });
        let ok = false, nudges = 0, lastMove = 0, held = false;
        let px = b.x, py = b.y;
        for (let f = 0; f < 60 * 40; f++) {
          w.step(DT);
          for (const e of w.drainEvents()) { if (e.t === 'stuck') { nudges++; w.nudgeBall(e.ballId); } }
          if (b.state === 'drained') { ok = true; break; }
          if (b.state === 'held') held = true;
          if (f % 60 === 59) { if (Math.hypot(b.x - px, b.y - py) > 4) lastMove = f; px = b.x; py = b.y; }
        }
        if (ok) drainedN++;
        else if (!held && mode === 'flippers down') traps.push({ x: Math.round(b.x), y: Math.round(b.y), nudges: nudges });
        else if (!ok) traps.push({ x: Math.round(b.x), y: Math.round(b.y), nudges: nudges });
        if (nudges > 0) nudged.push({ x: x, y: y, n: nudges });
      }
    }
    const uniq = [];
    for (const r of traps) if (!uniq.some((u) => Math.hypot(u.x - r.x, u.y - r.y) < 12)) uniq.push(r);
    const nu = [];
    for (const r of nudged) if (!nu.some((u) => Math.hypot(u.x - r.x, u.y - r.y) < 40)) nu.push(r);
    if (mode === 'flippers down') {
      check('every dropped ball drains within 40 s (nudges allowed), nothing rests forever', traps.length === 0, n + ' drops, ' + drainedN + ' drained' + (uniq.length ? '; still on table: ' + uniq.slice(0, 8).map((u) => u.x + ',' + u.y + ' (nudges ' + u.nudges + ')').join(' | ') : ''));
      log('  info: ' + nudged.length + ' of ' + n + ' drops needed at least one nudge' + (nu.length ? ' (start areas: ' + nu.slice(0, 6).map((u) => u.x + ',' + u.y).join(' | ') + ')' : ''));
    } else {
      log('  ' + mode + ': ' + drainedN + '/' + n + ' drained within 40 s even with the player holding both keys; ' + traps.length + ' still on the table' + (uniq.length ? ' at ' + uniq.slice(0, 5).map((u) => u.x + ',' + u.y).join(' | ') : ''));
    }
  }
  // nudge must free a ball that sits in a valley between raised flippers, and a released key drains it
  let freed = 0, tried = 0;
  for (let i = 0; i < 12; i++) {
    const w = newWorld(500 + i);
    const b = w.spawnBall(); b.attached = false; b.state = 'play'; b.x = 190 + i * 10; b.y = 780; b.vx = 0; b.vy = 0;
    w.balls.length = 0; w.balls.push(b);
    w.setInput({ left: true, right: true });
    tried++;
    let drained = false;
    for (let f = 0; f < 60 * 60 && !drained; f++) {
      w.step(DT);
      for (const e of w.drainEvents()) { if (e.t === 'stuck') w.nudgeBall(e.ballId); if (e.t === 'drain') drained = true; }
      if (f === 60 * 25) w.setInput({ left: false, right: false });   // a child eventually lifts the fingers
    }
    if (drained) freed++;
  }
  check('balls held between two raised flippers get out once a key is released', freed === tried, freed + '/' + tried);
}

// ---------------------------------------------------------------------------------------------------------
if (want('soak')) {
  section('soak: ' + GAMES + ' games, up to ' + SECONDS + ' s each, 5 balls, mixed bot skills');
  const cov = makeCoverage();
  const skills = [0.45, 1, 0.8, 0.3];
  let bad = 0, maxSlow = 0, maxSpeed = 0, totalT = 0, rescues = 0, stuckEv = 0, balls = 0;
  const lives = [];
  const t0 = Date.now();
  let firstBad = '';
  for (let g = 0; g < GAMES; g++) {
    const r = runGame(SEED * 100000 + g * 17 + 5, skills[g % skills.length], { cov: cov, seconds: SECONDS });
    if (r.bad.length) { bad += r.bad.length; if (!firstBad) firstBad = 'game ' + g + ': ' + r.bad[0]; }
    maxSlow = Math.max(maxSlow, r.maxSlow); maxSpeed = Math.max(maxSpeed, r.maxSpeed); totalT += r.time; rescues += r.rescues; stuckEv += r.stuckEvents;
    balls += r.drains;
    for (const l of r.lives) lives.push(l);
  }
  log('  simulated ' + fmt(totalT / 60, 0) + ' minutes of play in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s wall clock; ' + balls + ' balls drained');
  check('no NaN, no ball outside the table, no ball in the lane while playing', bad === 0, bad ? firstBad : '');
  check('no emergency position rescues', rescues === 0, String(rescues));
  check('no ball stuck longer than 5 s without recovery', maxSlow <= 5, 'longest slow stretch ' + fmt(maxSlow, 2) + ' s, stuck events ' + stuckEv);
  check('ball speed never above the cap', maxSpeed <= 950.5, 'max ' + fmt(maxSpeed, 0));
  log('  ball life over the soak: p10 ' + fmt(pct(lives, 0.1)) + ' s, median ' + fmt(pct(lives, 0.5)) + ' s, p90 ' + fmt(pct(lives, 0.9)) + ' s');

  // coverage table
  const ids = [];
  TABLE.bumpers.forEach((b) => ids.push('bumper:' + b.id));
  TABLE.slings.forEach((s) => ids.push('sling:' + s.id));
  ids.push('spinner', 'hole:house', 'holeEject');
  TABLE.tunnels.forEach((t) => ids.push('tunnel:' + t.id));
  ids.push('gate', 'target:mystery', 'flipper:L', 'flipper:R', 'launch');
  TABLE.sensors.filter((s) => s.kind === 'lane' || s.kind === 'pellet' || s.kind === 'fruit').forEach((s) => ids.push(s.id));
  TABLE.dotGroups.forEach((d) => ids.push('dot:' + d.id));
  ['wall:wall', 'wall:guide', 'wall:rubber', 'wall:arch', 'wall:post', 'stuck'].forEach((k) => ids.push(k));
  log('  COVERAGE (hits in total, per game)');
  let starved = [];
  let line = '';
  ids.forEach((id, i) => {
    const n = cov.get[id] || 0;
    const opt = id.startsWith('wall:') || id === 'stuck';
    if (n === 0 && !opt) starved.push(id);
    line += ('  ' + id).padEnd(24) + String(n).padStart(6) + ' (' + (n / GAMES).toFixed(2) + ')';
    if (i % 2 === 1) { log(line); line = ''; }
  });
  if (line) log(line);
  // individual dots
  const starvedDots = TABLE.sensors.filter((s) => s.kind === 'dot' && !cov.get['id:' + s.id]).map((s) => s.id);
  check('every single dot is eaten at least once', starvedDots.length === 0, starvedDots.length ? 'never eaten: ' + starvedDots.join(', ') : TABLE.stats.dots + ' dots');
  check('every element is hit at least once', starved.length === 0, starved.length ? 'starved: ' + starved.join(', ') : 'all ' + ids.length + ' listed elements hit');
}

log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL CHECKS PASSED'));
process.exit(failures ? 1 : 0);
