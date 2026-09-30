'use strict';
// Regression test for the shooter lane trap (QA finding F18, fixed in 20_physics.js World.prototype._post).
// A launched ball L crosses the gate flap (state lane -> play). A second ball hits it right at the gate and knocks it back down through
// the flap into the shooter lane. Before the fix the ball kept state 'play' inside the lane: it never re-attached to the plunger, could not
// drain (the lane floor stops it before drainY) and nudges could not hop it over the flap, so it was stuck for good.
// The fix: at the end of _post a 'play' ball with x > plunger.x0 + 3 and y > 256 becomes a 'lane' ball again.
//   node tests/physics_lane_trap_test.js [trials]     (exit 1 on failure; the stress part takes about 10 s for 2000 trials)
const { loadPM } = require('./load');
const PM = loadPM();
const TABLE = PM.Table.build();
const DT = 1 / 60;
let fails = 0;
const check = (name, ok, info) => { console.log((ok ? '  PASS ' : '  FAIL ') + name + (info ? '  (' + info + ')' : '')); if (!ok) fails++; };
const newWorld = (seed) => { const w = new PM.Physics.World(TABLE, { rng: PM.util.rng(seed) }); w.sensors.length = 0; w._sensorMap.clear(); return w; };
const place = (w, x, y, vx, vy) => {
  const b = w.spawnBall(); if (!b) return null;
  b.attached = false; b.state = 'play'; b.x = x; b.y = y; b.px = x; b.py = y; b.vx = vx || 0; b.vy = vy || 0;
  return b;
};
const inLane = (b) => b.x > TABLE.plunger.x0 && b.y > 256;

// 1. the exact reproduction from tests/qa_physics_lane_trap.js (it ended TRAPPED, state play at 494.9,899.0 after 120 s, before the fix)
{
  const w = newWorld(13251);
  const L = w.spawnBall();
  for (let k = 0; k < 20; k++) w.step(DT);
  w.launch(0.24855664786882697);
  for (let f = 0; f < 60; f++) {
    if (f === 53) place(w, 489.21261766971793, 213.55302717420273, 116.17099575698376, 174.0226205671206);
    w.step(DT);
    w.drainEvents();
  }
  let nudges = 0, drained = false;
  for (let f = 0; f < 60 * 120; f++) {
    w.step(DT);
    for (const e of w.drainEvents()) { if (e.t === 'stuck') { nudges++; w.nudgeBall(e.ballId); } if (e.t === 'drain' && e.ballId === L.id) drained = true; }
  }
  check('knocked back ball ends as a lane ball again, resting on the plunger', L.state === 'lane' && L.attached && inLane(L) && Math.abs(L.y - TABLE.plunger.restY) < 1.5, 'state ' + L.state + ' at ' + L.x.toFixed(1) + ',' + L.y.toFixed(1) + ', attached ' + L.attached);
  check('it needs no anti stuck nudge and does not drain', nudges === 0 && !drained, 'nudges ' + nudges);
  const back = w.launch(0.5);
  check('and it can be launched again', back === L && L.vy < -900);
}

// 2. stress: a second ball dropped into the top right corner at a random moment while a launched ball crosses the gate
{
  const N = parseInt(process.argv[2] || '2000', 10);
  const rng = PM.util.rng(99);
  let trapped = 0, laneOnField = 0, sample = '';
  for (let i = 0; i < N; i++) {
    const w = newWorld(9000 + i);
    w.spawnBall();
    for (let k = 0; k < 20; k++) w.step(DT);
    w.launch(0.05 + rng() * 0.95);
    const tDrop = 0.55 + rng() * 0.5;
    let P = null, done = false;
    for (let f = 0; f < 60 * 14 && !done; f++) {
      const t = f * DT;
      if (!P && t >= tDrop) {
        const sy = 130 + rng() * 105, archX = 271 + Math.sqrt(248 * 248 - (sy - 271) * (sy - 271));
        P = place(w, 440 + rng() * (archX - 14 - 440), sy, (rng() - 0.3) * 600, (rng() - 0.3) * 500);
        if (!P) break;
      }
      w.step(DT);
      for (const e of w.drainEvents()) if (e.t === 'stuck') w.nudgeBall(e.ballId);
      for (const b of w.balls) {
        if (b.state === 'play' && b.x > 483 && b.y > 256) { trapped++; done = true; if (!sample) sample = 'trial ' + i + ' at ' + b.x.toFixed(0) + ',' + b.y.toFixed(0); }
        // the new rule must not turn a ball on the playfield into a lane ball
        if (b.state === 'lane' && (b.x < 483 || b.y < 240) && t > 2) { laneOnField++; done = true; if (!sample) sample = 'lane ball on the field, trial ' + i + ' at ' + b.x.toFixed(0) + ',' + b.y.toFixed(0); }
      }
    }
  }
  check('no play-state ball is ever left inside the shooter lane', trapped === 0, N + ' forced gate encounters, trapped ' + trapped + (sample ? ', ' + sample : ''));
  check('no lane-state ball is ever found out on the playfield', laneOnField === 0, 'found ' + laneOnField);
}

console.log(fails ? fails + ' FAILURE(S)' : 'ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
