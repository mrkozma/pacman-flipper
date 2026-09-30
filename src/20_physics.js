/* 20_physics.js: PM.Physics.World, the ball, flipper and table simulation. DOM-free and deterministic
   (same table + same rng seed + same input/step sequence gives the same result; no Math.random, no Date.now).

   new PM.Physics.World(table, {rng})  table = PM.Table.build(); rng = PM.util.rng(seed) (optional)

   FIXED SUBSTEPS: step(dt) clamps dt to PM.CFG.MAX_FRAME_DT, multiplies by params.timeScale and runs substeps of
   1/PM.CFG.PHYS_HZ (480 Hz) using an accumulator. Nothing is allocated in the substep hot loop except event objects.
   Cost: about 0.015 ms per frame with two balls (measured by tests/sim.js).

   PUBLIC STATE (the renderer and the game read these)
     world.balls[]      {id, x, y, vx, vy, r, state:'lane'|'play'|'held'|'drained', spin}
                        spin = accumulated roll angle in radians (visual only). A drained ball stays in the array until
                        the start of the next step() (or removeBall), so the frame that drained it can still see it.
     world.flippers[]   {id:'L'|'R', px, py, len, r0, r1, angle, angVel, up, scale, restAngle, upAngle}
                        len/r0/r1 are the CURRENT sizes (already multiplied by scale). angle in radians (0 = +x, clockwise).
                        up = the key is held (the flipper swings up at params.flipperRaise, down at flipperLower).
     world.spinners[]   {id, x, y, w, angle, angVel}   angle grows without bound (use it modulo 2 PI)
     world.sensors[]    {id, kind, x, y, r, active, group}   dynamic (see addSensor). r = trigger radius to the ball CENTRE.
     world.elements     runtime visual state (timers are 0..1 and decay by themselves):
        bumpers[id]  {hit}           1 at impact, 0 after 0.4 s          (ids piri, rozi, kiki)
        slings[id]   {hit}           same                                (slingL, slingR)
        targets[id]  {hit}           same                                (mystery)
        holes[id]    {occupied, ballId, t, hold}   t = seconds held so far, hold = seconds it will be held (house)
        tunnels[id]  {glow}          1 when a ball just went in or came out, fades over 0.6 s   (tunL, tunR)
        gates[id]    {open}          1 when a ball just passed, fades over 0.3 s                (gate)
        plunger      {pull, charge, travel}   pull = units the plunger is pulled back (0..travel), charge = last setPlunger
     world.params       tunable at any time by the game; every key below is honored (defaults in brackets):
        gravity [430] units/s2 down the table, timeScale [1] slow motion (0.5 = half speed), flipperScale [1] grows the
        flippers about their pivots (animated at 1.6 per second; 1.35 makes the tips touch), bumperKick [430],
        slingKick [390], maxSpeed [950] cap in play, laneMaxSpeed [1100] cap in the shooter lane, restitution [0.45] walls,
        rubberRestitution [0.6], flipperRestitution [0.3], friction [0.035], airDrag [0.04], flipperRaise [19 rad/s],
        flipperLower [11 rad/s], flipperKick [0.46] share of the flipper surface speed handed to the ball,
        plungerMin [896] / plungerMid [948] / plungerMax [1010] launch speeds, holdTime [PM.CFG.HOLD_SECONDS] saucer,
        stuckSpeed [12], stuckSeconds [2.5], spinnerGain [0.05]
     world.stats        {substeps, rescues}   rescues counts emergency position clamps (stays 0 in every test)

   METHODS  (as in SPEC 4.1)
     setInput({left,right}), spawnBall() -> ball|null (max 3 alive; the ball rests on the plunger in state 'lane'),
     setPlunger(charge01) (the resting ball moves down with the plunger), launch(power01) -> ball|null,
     step(dt), drainEvents() -> Event[], addSensor(s), removeSensor(id), setSensorActive(id,bool), moveSensor(id,x,y),
     lockBall(id), releaseBall(id,vx,vy), removeBall(id), nudgeBall(id), reset() (also restores the default params),
     getBall(id).

   LAUNCH POWER MAP (no flipper input, gravity 430): power 0 to 0.1 drops the ball into lane3 (right), 0.15 to 0.2 lane2 and
   into the house, 0.25 to 0.4 lane1 and the house, 0.5 to 1 rides the whole arch: spinner, then down the left wall into
   the left tunnel. Every power clears the lane. The game may remap charge to power any way it likes.

   EVENTS  (drainEvents returns and clears them; 't' is the type)
     bumper{id,ballId,speed,x,y}  sling{id,ballId,speed}  flipper{id,ballId,speed}   (flipper: only real hits, not rolling)
     wall{ballId,speed,kind:'wall'|'guide'|'rubber'|'arch'|'post',x,y}   only when the impact speed is above 250
                        (the table style 'dead', the plunger floor, is reported as kind 'wall')
     sensor{id,kind,ballId,x,y}   begin-overlap only; re-arms when the ball leaves the trigger radius
     target{id,ballId,speed}  spinner{id,ballId,spin,ticks}  (one event per half turn, ticks = 1, spin = rad/s)
     hole{id,ballId}  holeEject{id,ballId}  tunnel{from,to,ballId}  gate{id,ballId}  drain{ballId}
     launch{ballId,power}  ballBall{a,b,speed}  stuck{ballId}

   HOLE / LOCK: a ball entering the saucer is 'held' at its centre for params.holdTime, then popped out gently (down and to
   one side, 26 to 40 degrees off vertical, the side alternating on every eject, so it does not land on the bumper Piri that
   sits right below and bounce straight back in).
   The game may lockBall(id) that ball (auto eject is suspended) and later releaseBall(id, vx, vy) (no velocity given = the
   default gentle pop). A ball locked in the shooter lane is released as a 'lane' ball. Balls that arrive while the saucer
   is busy simply fall through the gap.
   TUNNELS: entering one mouth puts the ball at the partner mouth, leaving the wall at 300..520 units/s (about 25 units off
   the wall, random angle within 15 degrees). 0.7 s cooldown, so it cannot ping-pong.
   BALL STATE 'lane': from spawn until the ball crosses the one way gate at the top of the shooter lane; then 'play'.
   A weak launch that falls back lands on the plunger again and can be launched again. A 'play' ball that ends up inside the
   lane (x right of the lane inner wall, below the gate flap), for example knocked back through the flap by a second ball,
   becomes a 'lane' ball again at the end of _post, so it re-attaches to the plunger and can never be trapped there.
   The plunger floor is a 'dead' wall (restitution 0.05): a ball that falls back down the lane settles in about 2 s, not 4.
   ANTI LOOP: after 4 bumper/sling kicks in a row without a flipper touch the kicks fade (down to 30 percent), so a ball
   cannot bounce between the slings or ghosts for ever. A flipper hit, a tunnel or 5 quiet seconds reset that.
   ANTI STUCK: a 'play' ball slower than params.stuckSpeed for params.stuckSeconds emits stuck{ballId} (again every
   stuckSeconds). nudgeBall hops it toward the middle of the table (over the flipper gap when it is low); repeated nudges
   on the same ball hop higher. With both keys held for ever every ball still drains (tests/sim.js proves it). */
(function (g) {
  'use strict';
  const PM = g.PM = g.PM || {};
  const CFG = PM.CFG;
  const U = PM.util;

  const DEFAULTS = {
    gravity: 430,
    timeScale: 1,
    flipperScale: 1,
    bumperKick: 430,
    slingKick: 390,
    maxSpeed: CFG.MAX_BALL_SPEED,
    laneMaxSpeed: 1100,
    restitution: 0.45,
    rubberRestitution: 0.6,
    flipperRestitution: 0.3,
    friction: 0.035,
    airDrag: 0.04,
    flipperRaise: 19,
    flipperLower: 11,
    flipperKick: 0.46,
    plungerMin: 896,
    plungerMid: 948,
    plungerMax: 1010,
    holdTime: CFG.HOLD_SECONDS,
    stuckSpeed: 12,
    stuckSeconds: 2.5,
    spinnerGain: 0.05
  };
  const REST_V = 45;          // closing speed below this does not bounce (kills resting jitter)
  const MAX_BALLS = 3;
  const BALL_R = CFG.BALL_R;
  const T_SEG = 1, T_POST = 2, T_BUMP = 3, T_FLIP = 4;
  const ROLE_PLAIN = 0, ROLE_SLING = 1, ROLE_TARGET = 2, ROLE_GATE = 3;
  const KIND_NAMES = ['wall', 'guide', 'rubber', 'arch', 'wall'];      // event kind by code; 'dead' reports as 'wall'
  const KIND_CODE = { wall: 0, guide: 1, rubber: 2, arch: 3, dead: 4 };
  const DEAD_RESTITUTION = 0.05;   // the plunger floor: a ball falling back down the shooter lane hardly bounces

  // Scratch contact result, module level so the hot loop allocates nothing.
  let cnx = 0, cny = 0;       // contact normal (from the surface toward the ball)
  let csx = 0, csy = 0;       // velocity of the surface at the contact point

  // Ball against a thick segment A + u*(dx,dy), th = half thickness. Returns penetration (0 = none).
  function segPen(bx, by, br, ax, ay, dx, dy, inv2, th) {
    const px = bx - ax, py = by - ay;
    let u = (px * dx + py * dy) * inv2;
    if (u < 0) u = 0; else if (u > 1) u = 1;
    const qx = px - u * dx, qy = py - u * dy;
    const R = br + th;
    const d2 = qx * qx + qy * qy;
    if (d2 >= R * R) return 0;
    const d = Math.sqrt(d2);
    if (d < 1e-6) { const l = Math.sqrt(dx * dx + dy * dy) || 1; cnx = -dy / l; cny = dx / l; return R; }
    cnx = qx / d; cny = qy / d;
    return R - d;
  }

  // Ball against a tapered flipper capsule (exact: two end circles plus the two tangent lines).
  function flipPen(f, bx, by, br) {
    const rx = bx - f.px, ry = by - f.py;
    const s = (-rx * f.ey + ry * f.ex) >= 0 ? 1 : -1;
    const nx = -s * f.ey * f.cphi + f.ex * f.k;
    const ny = s * f.ex * f.cphi + f.ey * f.k;
    const dtx = f.ex * f.cphi + s * f.ey * f.k;
    const dty = f.ey * f.cphi - s * f.ex * f.k;
    const u = rx * dtx + ry * dty;
    let qx, qy, pen;
    if (u < 0) {
      const R = br + f.r0, d2 = rx * rx + ry * ry;
      if (d2 >= R * R) return 0;
      const d = Math.sqrt(d2);
      if (d < 1e-6) { cnx = nx; cny = ny; } else { cnx = rx / d; cny = ry / d; }
      pen = R - d; qx = f.px + f.r0 * cnx; qy = f.py + f.r0 * cny;
    } else if (u > f.lt) {
      const ox = bx - f.tx, oy = by - f.ty, R = br + f.r1, d2 = ox * ox + oy * oy;
      if (d2 >= R * R) return 0;
      const d = Math.sqrt(d2);
      if (d < 1e-6) { cnx = nx; cny = ny; } else { cnx = ox / d; cny = oy / d; }
      pen = R - d; qx = f.tx + f.r1 * cnx; qy = f.ty + f.r1 * cny;
    } else {
      pen = br - (rx * nx + ry * ny - f.r0);
      if (pen <= 0) return 0;
      cnx = nx; cny = ny;
      qx = f.px + f.r0 * nx + u * dtx; qy = f.py + f.r0 * ny + u * dty;
    }
    csx = -f.angVel * (qy - f.py) * f.kick;
    csy = f.angVel * (qx - f.px) * f.kick;
    return pen;
  }

  // Impulse response of a ball against a surface moving at (sx,sy). Returns the approach speed (0 if separating).
  function bounce(b, nx, ny, e, mu, sx, sy) {
    const rvx = b.vx - sx, rvy = b.vy - sy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return 0;
    const jn = -(1 + (-vn > REST_V ? e : 0)) * vn;
    b.vx += jn * nx; b.vy += jn * ny;
    if (mu > 0) {
      const tx = -ny, ty = nx;
      const vt = rvx * tx + rvy * ty;
      const lim = mu * jn;
      const jt = vt > lim ? lim : (vt < -lim ? -lim : vt);
      b.vx -= jt * tx; b.vy -= jt * ty;
    }
    return -vn;
  }

  function World(table, opts) {
    opts = opts || {};
    this.table = table;
    this.rng = opts.rng || U.rng(opts.seed || 20240929);
    this.params = Object.assign({}, DEFAULTS);
    this.balls = [];
    this.flippers = [];
    this.spinners = [];
    this.sensors = [];
    this.elements = null;
    this.time = 0;
    this.stats = { substeps: 0, rescues: 0 };
    this._sensorMap = new Map();
    this._events = [];
    this._acc = 0;
    this._nextId = 1;
    this._plungerTarget = 0;
    this._holes = [];
    this._hitEls = [];
    this._buildStatic();
    this.reset();
  }

  // ------------------------------------------------------------------------------------------------------
  // static geometry
  World.prototype._buildStatic = function () {
    const t = this.table;
    const segs = [];
    const add = (ax, ay, bx, by, th, kind, role, ri) => segs.push({ ax: ax, ay: ay, bx: bx, by: by, th: th, kind: kind, role: role, ri: ri });
    for (const w of t.walls) {
      const kind = KIND_CODE[w.style] || 0;
      for (let i = 0; i + 1 < w.pts.length; i++) add(w.pts[i].x, w.pts[i].y, w.pts[i + 1].x, w.pts[i + 1].y, w.t, kind, ROLE_PLAIN, -1);
    }
    this._slings = t.slings.map((s) => ({ id: s.id }));
    t.slings.forEach((s, si) => {
      add(s.pts[0].x, s.pts[0].y, s.pts[2].x, s.pts[2].y, s.t, 2, ROLE_SLING, si);   // active edge p1->p3
      add(s.pts[0].x, s.pts[0].y, s.pts[1].x, s.pts[1].y, s.t, 2, ROLE_PLAIN, -1);   // outer edge p1->p2
      add(s.pts[1].x, s.pts[1].y, s.pts[2].x, s.pts[2].y, s.t, 1, ROLE_PLAIN, -1);   // bottom edge p2->p3
    });
    this._targets = t.targets.map((tg) => ({ id: tg.id }));
    t.targets.forEach((tg, ti) => add(tg.a.x, tg.a.y, tg.b.x, tg.b.y, tg.t, 2, ROLE_TARGET, ti));
    this._gates = t.gates.map((gt) => ({ id: gt.id, ax: gt.a.x, ay: gt.a.y, nx: gt.nx, ny: gt.ny }));
    t.gates.forEach((gt, gi) => add(gt.a.x, gt.a.y, gt.b.x, gt.b.y, 1.5, 0, ROLE_GATE, gi));

    const n = segs.length;
    this._sn = n;
    const mk = () => new Float64Array(n);
    this._sax = mk(); this._say = mk(); this._sdx = mk(); this._sdy = mk(); this._sinv = mk(); this._sth = mk();
    this._sx0 = mk(); this._sx1 = mk(); this._sy0 = mk(); this._sy1 = mk();
    this._skind = new Uint8Array(n); this._srole = new Uint8Array(n); this._sri = new Int16Array(n);
    segs.forEach((s, i) => {
      const dx = s.bx - s.ax, dy = s.by - s.ay;
      this._sax[i] = s.ax; this._say[i] = s.ay; this._sdx[i] = dx; this._sdy[i] = dy;
      this._sinv[i] = 1 / Math.max(dx * dx + dy * dy, 1e-9);
      this._sth[i] = s.th;
      this._sx0[i] = Math.min(s.ax, s.bx) - s.th; this._sx1[i] = Math.max(s.ax, s.bx) + s.th;
      this._sy0[i] = Math.min(s.ay, s.by) - s.th; this._sy1[i] = Math.max(s.ay, s.by) + s.th;
      this._skind[i] = s.kind; this._srole[i] = s.role; this._sri[i] = s.ri;
    });

    const np = t.posts.length;
    this._pn = np;
    this._px = new Float64Array(np); this._py = new Float64Array(np); this._pr = new Float64Array(np);
    this._pkind = new Uint8Array(np);
    t.posts.forEach((p, i) => { this._px[i] = p.x; this._py[i] = p.y; this._pr[i] = p.r; this._pkind[i] = p.style === 'rubber' ? 2 : 0; });

    const nb = t.bumpers.length;
    this._bn = nb;
    this._bx = new Float64Array(nb); this._by = new Float64Array(nb); this._br = new Float64Array(nb);
    t.bumpers.forEach((b, i) => { this._bx[i] = b.x; this._by[i] = b.y; this._br[i] = b.r; });
  };

  // ------------------------------------------------------------------------------------------------------
  // (re)initialisation
  World.prototype.reset = function () {
    const t = this.table;
    // keep the identity of params, balls, flippers, spinners, sensors and elements: callers may hold references
    for (const k of Object.keys(this.params)) delete this.params[k];
    Object.assign(this.params, DEFAULTS);
    this.balls.length = 0;
    this._events = [];
    this._acc = 0;
    this._nextId = 1;
    this._plungerTarget = 0;
    this.time = 0;
    this.stats.substeps = 0; this.stats.rescues = 0;

    this.flippers.length = 0;
    t.flippers.forEach((f) => {
      const o = {
        id: f.id, px: f.px, py: f.py, len: f.len, r0: f.r0, r1: f.r1, angle: f.rest, angVel: 0, up: false, scale: 1,
        restAngle: f.rest, upAngle: f.up,
        baseLen: f.len, baseR0: f.r0, baseR1: f.r1,
        k: (f.r0 - f.r1) / f.len, cphi: 0, ex: 0, ey: 0, tx: 0, ty: 0, lt: 0, kick: DEFAULTS.flipperKick
      };
      o.cphi = Math.sqrt(1 - o.k * o.k);
      this._poseFlipper(o);
      this.flippers.push(o);
    });
    this.spinners.length = 0;
    t.spinners.forEach((s) => this.spinners.push({ id: s.id, x: s.x, y: s.y, w: s.w, angle: 0, angVel: 0, lastBall: 0, acc: 0 }));

    this.sensors.length = 0;
    this._sensorMap.clear();
    for (const s of t.sensors) this.addSensor(s);

    const el = this.elements || (this.elements = {});
    el.bumpers = {}; el.slings = {}; el.targets = {}; el.holes = {}; el.tunnels = {}; el.gates = {}; el.plunger = null;
    this._hitEls = [];
    const hit = (map, id) => { const o = { hit: 0 }; map[id] = o; this._hitEls.push(o); };
    for (const b of t.bumpers) hit(el.bumpers, b.id);
    for (const s of t.slings) hit(el.slings, s.id);
    for (const s of t.targets) hit(el.targets, s.id);
    this._glowEls = [];
    for (const tn of t.tunnels) { const o = { glow: 0 }; el.tunnels[tn.id] = o; this._glowEls.push(o); }
    this._openEls = [];
    for (const gt of t.gates) { const o = { open: 0 }; el.gates[gt.id] = o; this._openEls.push(o); }
    this._holes = t.holes.map((h) => {
      const e = { occupied: false, ballId: 0, t: 0, hold: this.params.holdTime };
      el.holes[h.id] = e;
      return { id: h.id, x: h.x, y: h.y, r: h.r, ballId: 0, t: 0, cd: 0, ejects: 0, el: e };
    });
    el.plunger = { pull: 0, charge: 0, travel: t.plunger.travel };
  };

  World.prototype._poseFlipper = function (f) {
    f.ex = Math.cos(f.angle); f.ey = Math.sin(f.angle);
    f.tx = f.px + f.len * f.ex; f.ty = f.py + f.len * f.ey;
    f.lt = f.len * f.cphi;
  };

  // ------------------------------------------------------------------------------------------------------
  // public API
  World.prototype.setInput = function (inp) {
    inp = inp || {};
    for (const f of this.flippers) f.up = f.id === 'L' ? !!inp.left : !!inp.right;
  };

  World.prototype.getBall = function (id) {
    for (const b of this.balls) if (b.id === id) return b;
    return null;
  };

  World.prototype.spawnBall = function () {
    let alive = 0;
    for (const b of this.balls) if (b.state !== 'drained') alive++;
    if (alive >= MAX_BALLS) return null;
    const pl = this.table.plunger;
    let slot = 0;
    for (; slot < MAX_BALLS + 1; slot++) { let used = false; for (const b of this.balls) if (b.slot === slot) used = true; if (!used) break; }
    let y = pl.restY;
    for (const b of this.balls) if (b.state === 'lane' && Math.abs(b.x - pl.x) < 6 && b.y > y - 2 * BALL_R - 1) y = b.y - 2 * BALL_R - 1;
    const attached = y === pl.restY;
    const ball = {
      id: this._nextId++, x: pl.x, y: y, vx: 0, vy: 0, r: BALL_R, state: 'lane', spin: 0,
      px: pl.x, py: y, slot: slot, attached: attached, locked: false, holeIdx: -1,
      slowT: 0, fastT: 0, nudges: 0, tunnelCd: 0, wallCd: 0, flipCd: 0, kickCd: 0, bbCd: 0, kicks: 0, kickIdle: 0, jiggleAt: 0.35
    };
    this.balls.push(ball);
    return ball;
  };

  World.prototype.setPlunger = function (c) {
    c = c < 0 ? 0 : (c > 1 ? 1 : (+c || 0));
    this._plungerTarget = c;
    this.elements.plunger.charge = c;
  };

  // Fire the ball that rests near the plunger. power01 0..1 maps to plungerMin..plungerMid..plungerMax; even 0 clears the lane.
  World.prototype.launch = function (power) {
    const pl = this.table.plunger;
    let ball = null;
    for (const b of this.balls) {
      if (b.state === 'lane' && b.y > pl.restY - 60 && (b.attached || Math.abs(b.vy) < 60)) { if (!ball || b.y > ball.y) ball = b; }
    }
    if (!ball) return null;
    const P = this.params;
    const p = power < 0 ? 0 : (power > 1 ? 1 : (+power || 0));
    // The lower half of the power range spreads over the top lanes, the upper half rides the arch (orbit).
    let v = p < 0.5 ? P.plungerMin + (P.plungerMid - P.plungerMin) * (p / 0.5)
                    : P.plungerMid + (P.plungerMax - P.plungerMid) * ((p - 0.5) / 0.5);
    v *= Math.min(1.3, Math.max(0.85, Math.sqrt(P.gravity / DEFAULTS.gravity)));
    ball.attached = false;
    ball.x = pl.x; ball.y = pl.restY;        // the plunger releases the ball at its rest position, pulled back or not
    ball.vx = 0; ball.vy = -v;
    this._plungerTarget = 0;
    this.elements.plunger.charge = 0;
    this._events.push({ t: 'launch', ballId: ball.id, power: p });
    return ball;
  };

  World.prototype.drainEvents = function () {
    const e = this._events;
    this._events = [];
    return e;
  };

  World.prototype.addSensor = function (s) {
    const o = { id: s.id, kind: s.kind || 'dot', x: s.x, y: s.y, r: s.r === undefined ? 12 : s.r, active: s.active !== false, group: s.group || '', inMask: 0 };
    const old = this._sensorMap.get(o.id);
    if (old) this.removeSensor(o.id);
    this.sensors.push(o);
    this._sensorMap.set(o.id, o);
    return o;
  };

  World.prototype.removeSensor = function (id) {
    const s = this._sensorMap.get(id);
    if (!s) return false;
    this._sensorMap.delete(id);
    const i = this.sensors.indexOf(s);
    if (i >= 0) this.sensors.splice(i, 1);
    return true;
  };

  World.prototype.setSensorActive = function (id, on) {
    const s = this._sensorMap.get(id);
    if (!s) return;
    s.active = !!on;
    s.inMask = 0;
  };

  World.prototype.moveSensor = function (id, x, y) {
    const s = this._sensorMap.get(id);
    if (!s) return;
    s.x = x; s.y = y; s.inMask = 0;
  };

  World.prototype.lockBall = function (id) {
    const b = this.getBall(id);
    if (!b || b.state === 'drained') return false;
    b.state = 'held'; b.locked = true; b.vx = 0; b.vy = 0; b.attached = false;
    return true;
  };

  World.prototype.releaseBall = function (id, vx, vy) {
    const b = this.getBall(id);
    if (!b || b.state !== 'held') return false;
    b.locked = false;
    b.state = (b.x > this.table.plunger.x0 && b.y > 256) ? 'lane' : 'play';   // a ball locked in the lane stays a lane ball
    b.slowT = 0;
    if (b.holeIdx >= 0) {
      const h = this._holes[b.holeIdx];
      h.ballId = 0; h.t = 0; h.cd = 0.9; h.el.occupied = false; h.el.ballId = 0; h.el.t = 0;
      b.holeIdx = -1;
      this._events.push({ t: 'holeEject', id: h.id, ballId: b.id });
      if (vx === undefined || vy === undefined) {
        // Piri sits 80 units straight below the saucer, so a straight down pop lands on it and is kicked back in (one entry
        // in five). Pop down and to one side instead (0.45 to 0.70 rad off vertical, vy stays above 180), alternating sides.
        h.ejects++;
        const side = (h.ejects & 1) ? 1 : -1;
        const a = Math.PI / 2 + side * (0.45 + this.rng() * 0.25);
        vx = Math.cos(a) * 240; vy = Math.sin(a) * 240;
      }
    }
    b.vx = vx || 0; b.vy = vy || 0;
    return true;
  };

  World.prototype.removeBall = function (id) {
    const i = this.balls.findIndex((b) => b.id === id);
    if (i < 0) return false;
    const b = this.balls[i];
    if (b.holeIdx >= 0) { const h = this._holes[b.holeIdx]; h.ballId = 0; h.t = 0; h.el.occupied = false; h.el.ballId = 0; h.el.t = 0; }
    this.balls.splice(i, 1);
    return true;
  };

  // A small helpful hop that lands near the middle of the table (over the gap between the flippers when the ball is
  // low). Repeated nudges on the same ball hop a little higher each time (up to 3 steps stronger).
  World.prototype.nudgeBall = function (id) {
    const b = this.getBall(id);
    if (!b || b.state === 'drained' || b.state === 'held') return false;
    const s = 210 + 90 * Math.min(b.nudges, 3);
    const g = Math.max(this.params.gravity, 50);
    const flight = 2 * s / g;
    const dx = this.table.axisX - b.x;
    let vx;
    if (Math.abs(dx) < 25) vx = (this.rng() < 0.5 ? -1 : 1) * (55 + this.rng() * 45);
    else vx = Math.max(-260, Math.min(260, dx / flight)) * (0.9 + this.rng() * 0.2);
    b.vx = vx;
    b.vy = Math.min(b.vy, 0) - s;
    b.nudges++;
    b.slowT = 0;
    if (b.attached) b.attached = false;
    return true;
  };

  // ------------------------------------------------------------------------------------------------------
  // stepping
  World.prototype.step = function (dt) {
    const balls = this.balls;
    for (let i = balls.length - 1; i >= 0; i--) if (balls[i].state === 'drained') balls.splice(i, 1);
    dt = (dt > CFG.MAX_FRAME_DT ? CFG.MAX_FRAME_DT : (dt > 0 ? dt : 0)) * Math.max(0, this.params.timeScale);
    this._acc += dt;
    const h = 1 / CFG.PHYS_HZ;
    let n = 0;
    while (this._acc >= h && n < 64) { this._sub(h); this._acc -= h; n++; }
    if (n >= 64) this._acc = 0;
  };

  World.prototype._sub = function (h) {
    const P = this.params, balls = this.balls;
    this.time += h;
    this.stats.substeps++;
    this._updateFlippers(h);
    this._updateElements(h);
    const grav = P.gravity, drag = 1 - P.airDrag * h;
    const nb = balls.length;
    for (let i = 0; i < nb; i++) {
      const b = balls[i];
      if (b.state !== 'play' && b.state !== 'lane') continue;
      b.px = b.x; b.py = b.y;
      b.tunnelCd -= h; b.wallCd -= h; b.flipCd -= h; b.kickCd -= h; b.bbCd -= h;
      b.kickIdle += h;
      if (b.kickIdle > 5 && b.kicks > 0) b.kicks = 0;
      if (b.attached) { this._holdPlunger(b); continue; }
      b.vy += grav * h;
      b.vx *= drag; b.vy *= drag;
      b.x += b.vx * h; b.y += b.vy * h;
    }
    for (let i = 0; i < nb; i++) {
      const b = balls[i];
      if ((b.state === 'play' || b.state === 'lane') && !b.attached) this._collide(b);
    }
    if (nb > 1) this._ballBall();
    for (let i = 0; i < nb; i++) this._post(balls[i], h);
    this._updateHoles(h);
    this._updateSpinners(h);
  };

  World.prototype._holdPlunger = function (b) {
    const pl = this.table.plunger;
    b.x = pl.x; b.y = pl.restY + this.elements.plunger.pull;
    b.vx = 0; b.vy = 0;
  };

  World.prototype._updateFlippers = function (h) {
    const P = this.params, fl = this.flippers;
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i];
      const ts = P.flipperScale;
      if (f.scale !== ts) {
        const st = 1.6 * h, d = ts - f.scale;
        f.scale = Math.abs(d) <= st ? ts : f.scale + (d > 0 ? st : -st);
        f.len = f.baseLen * f.scale; f.r0 = f.baseR0 * f.scale; f.r1 = f.baseR1 * f.scale;
      }
      const target = f.up ? f.upAngle : f.restAngle;
      const diff = target - f.angle;
      const step = (f.up ? P.flipperRaise : P.flipperLower) * h;
      if (Math.abs(diff) <= step) { f.angVel = diff / h; f.angle = target; }
      else if (diff > 0) { f.angVel = step / h; f.angle += step; }
      else { f.angVel = -step / h; f.angle -= step; }
      f.kick = P.flipperKick;
      this._poseFlipper(f);
    }
    // plunger pull follows the charge; it snaps back quickly
    const pl = this.elements.plunger, want = this._plungerTarget * pl.travel;
    if (want >= pl.pull) pl.pull = want;
    else pl.pull = Math.max(want, pl.pull - 1400 * h);
  };

  World.prototype._updateElements = function (h) {
    const d = h / 0.4;
    const he = this._hitEls;
    for (let i = 0; i < he.length; i++) { const o = he[i]; if (o.hit > 0) { o.hit -= d; if (o.hit < 0) o.hit = 0; } }
    const ge = this._glowEls, dg = h / 0.6;
    for (let i = 0; i < ge.length; i++) { const o = ge[i]; if (o.glow > 0) { o.glow -= dg; if (o.glow < 0) o.glow = 0; } }
    const oe = this._openEls, dop = h / 0.3;
    for (let i = 0; i < oe.length; i++) { const o = oe[i]; if (o.open > 0) { o.open -= dop; if (o.open < 0) o.open = 0; } }
  };

  // Static collisions for one ball: repeat up to 3 times, always resolving the deepest overlap first.
  World.prototype._collide = function (b) {
    const br = b.r;
    const sax = this._sax, say = this._say, sdx = this._sdx, sdy = this._sdy, sinv = this._sinv, sth = this._sth;
    const sx0 = this._sx0, sx1 = this._sx1, sy0 = this._sy0, sy1 = this._sy1, srole = this._srole;
    const fl = this.flippers;
    for (let iter = 0; iter < 3; iter++) {
      const bx = b.x, by = b.y;
      let best = 0.0005, type = 0, idx = -1, bnx = 0, bny = 0, bsx = 0, bsy = 0;
      for (let i = 0, n = this._sn; i < n; i++) {
        if (bx + br < sx0[i] || bx - br > sx1[i] || by + br < sy0[i] || by - br > sy1[i]) continue;
        if (srole[i] === ROLE_GATE) {
          // one way flap: only blocks a ball that is on the playfield side and moving against the pass direction
          const gt = this._gates[this._sri[i]];
          if ((bx - gt.ax) * gt.nx + (by - gt.ay) * gt.ny <= 0 || b.vx * gt.nx + b.vy * gt.ny >= 0) continue;
        }
        const pen = segPen(bx, by, br, sax[i], say[i], sdx[i], sdy[i], sinv[i], sth[i]);
        if (pen > best) { best = pen; type = T_SEG; idx = i; bnx = cnx; bny = cny; }
      }
      for (let i = 0, n = this._pn; i < n; i++) {
        const dx = bx - this._px[i], dy = by - this._py[i], R = br + this._pr[i], d2 = dx * dx + dy * dy;
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2), pen = R - d;
        if (pen > best) { best = pen; type = T_POST; idx = i; if (d < 1e-6) { bnx = 0; bny = -1; } else { bnx = dx / d; bny = dy / d; } }
      }
      for (let i = 0, n = this._bn; i < n; i++) {
        const dx = bx - this._bx[i], dy = by - this._by[i], R = br + this._br[i], d2 = dx * dx + dy * dy;
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2), pen = R - d;
        if (pen > best) { best = pen; type = T_BUMP; idx = i; if (d < 1e-6) { bnx = 0; bny = -1; } else { bnx = dx / d; bny = dy / d; } }
      }
      for (let i = 0; i < fl.length; i++) {
        const pen = flipPen(fl[i], bx, by, br);
        if (pen > best) { best = pen; type = T_FLIP; idx = i; bnx = cnx; bny = cny; bsx = csx; bsy = csy; }
      }
      if (idx < 0) break;
      this._resolve(b, type, idx, best, bnx, bny, bsx, bsy);
    }
  };

  // Anti loop: after 4 bumper/sling kicks in a row without a flipper touch the kicks fade (down to 30 percent), so a ball
  // can never bounce between the two slings or the ghosts forever. A flipper hit, a warp or 5 quiet seconds reset it.
  World.prototype._kickFactor = function (b) {
    const n = b.kicks++;
    b.kickIdle = 0;
    return n < 4 ? 1 : Math.max(0.3, 1 - 0.07 * (n - 3));
  };

  World.prototype._jitter = function (nx, ny, amount) {
    const a = (this.rng() - 0.5) * 2 * amount, c = Math.cos(a), s = Math.sin(a);
    cnx = nx * c - ny * s; cny = nx * s + ny * c;
  };

  World.prototype._resolve = function (b, type, idx, pen, nx, ny, sx, sy) {
    const P = this.params, ev = this._events;
    b.x += nx * (pen + 0.0005); b.y += ny * (pen + 0.0005);
    if (type === T_SEG) {
      const role = this._srole[idx], kind = this._skind[idx];
      const e = kind === 2 ? P.rubberRestitution : (kind === 4 ? DEAD_RESTITUTION : P.restitution);
      if (role === ROLE_SLING) {
        const vn = b.vx * nx + b.vy * ny;
        if (vn < -90) {
          const s = this._slings[this._sri[idx]];
          this._jitter(nx, ny, 0.14);
          const jx = cnx, jy = cny;
          const out = P.slingKick * this._kickFactor(b) + 0.15 * -vn;
          const tx = b.vx - vn * nx, ty = b.vy - vn * ny;
          b.vx = tx * 0.85 + jx * out; b.vy = ty * 0.85 + jy * out;
          this.elements.slings[s.id].hit = 1;
          if (b.kickCd <= 0) { ev.push({ t: 'sling', id: s.id, ballId: b.id, speed: Math.hypot(b.vx, b.vy) }); b.kickCd = 0.06; }
          return;
        }
      } else if (role === ROLE_TARGET) {
        const ap = bounce(b, nx, ny, 0.5, P.friction, 0, 0);
        const tg = this._targets[this._sri[idx]];
        if (ap > 40) {
          this.elements.targets[tg.id].hit = 1;
          if (b.kickCd <= 0) { ev.push({ t: 'target', id: tg.id, ballId: b.id, speed: ap }); b.kickCd = 0.06; }
        }
        return;
      } else if (role === ROLE_GATE) {
        bounce(b, nx, ny, 0.3, 0, 0, 0);
        return;
      }
      const ap = bounce(b, nx, ny, e, P.friction, 0, 0);
      if (ap > 250 && b.wallCd <= 0) { ev.push({ t: 'wall', ballId: b.id, speed: ap, kind: KIND_NAMES[kind], x: b.x, y: b.y }); b.wallCd = 0.05; }
    } else if (type === T_POST) {
      const rub = this._pkind[idx] === 2;
      const ap = bounce(b, nx, ny, rub ? P.rubberRestitution : P.restitution, P.friction, 0, 0);
      if (ap > 250 && b.wallCd <= 0) { ev.push({ t: 'wall', ballId: b.id, speed: ap, kind: 'post', x: b.x, y: b.y }); b.wallCd = 0.05; }
    } else if (type === T_BUMP) {
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 2) {
        this._jitter(nx, ny, 0.12);
        const jx = cnx, jy = cny;
        const out = P.bumperKick * this._kickFactor(b) + 0.18 * Math.max(0, -vn);
        const tx = b.vx - vn * nx, ty = b.vy - vn * ny;
        b.vx = tx * 0.7 + jx * out; b.vy = ty * 0.7 + jy * out;
        const bid = this.table.bumpers[idx].id;
        this.elements.bumpers[bid].hit = 1;
        if (b.kickCd <= 0) { ev.push({ t: 'bumper', id: bid, ballId: b.id, speed: Math.hypot(b.vx, b.vy), x: b.x, y: b.y }); b.kickCd = 0.06; }
      }
    } else {
      const f = this.flippers[idx];
      const e = P.flipperRestitution;
      const vn0 = (b.vx - sx) * nx + (b.vy - sy) * ny;
      bounce(b, nx, ny, e, P.friction * 2, sx, sy);
      if (vn0 < -110) { b.kicks = 0; b.kickIdle = 0; }
      if (vn0 < -110 && b.flipCd <= 0) { ev.push({ t: 'flipper', id: f.id, ballId: b.id, speed: Math.hypot(b.vx, b.vy) }); b.flipCd = 0.08; }
    }
  };

  World.prototype._ballBall = function () {
    const balls = this.balls;
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if ((a.state !== 'play' && a.state !== 'lane') || a.attached) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if ((b.state !== 'play' && b.state !== 'lane') || b.attached) continue;
        const dx = b.x - a.x, dy = b.y - a.y, R = a.r + b.r, d2 = dx * dx + dy * dy;
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2);
        const nx = d < 1e-6 ? 1 : dx / d, ny = d < 1e-6 ? 0 : dy / d;
        const pen = (R - d) * 0.5 + 0.0005;
        a.x -= nx * pen; a.y -= ny * pen; b.x += nx * pen; b.y += ny * pen;
        const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rvn < 0) {
          const jn = -(1 + 0.85) * rvn * 0.5;
          a.vx -= jn * nx; a.vy -= jn * ny; b.vx += jn * nx; b.vy += jn * ny;
          if (-rvn > 60 && a.bbCd <= 0) { this._events.push({ t: 'ballBall', a: a.id, b: b.id, speed: -rvn }); a.bbCd = 0.1; b.bbCd = 0.1; }
        }
      }
    }
  };

  // Everything that happens after a ball has moved and been pushed out of walls.
  World.prototype._post = function (b, h) {
    const P = this.params, t = this.table, ev = this._events;
    if (b.state !== 'play' && b.state !== 'lane') return;
    if (b.attached) return;

    const cap = b.state === 'lane' ? P.laneMaxSpeed : P.maxSpeed;
    let sp2 = b.vx * b.vx + b.vy * b.vy;
    if (sp2 > cap * cap) { const k = cap / Math.sqrt(sp2); b.vx *= k; b.vy *= k; sp2 = cap * cap; }
    b.spin += (b.vx / b.r) * h * 0.5;

    // emergency clamp (should never trigger; counted so the soak test can prove it)
    if (b.x < 1 || b.x > t.W - 1 || b.y < 1) {
      b.x = b.x < 1 ? 1 : (b.x > t.W - 1 ? t.W - 1 : b.x); if (b.y < 1) b.y = 1;
      this.stats.rescues++;
    }

    // gate crossing (lane -> playfield)
    for (let i = 0; i < this._gates.length; i++) {
      const gt = this._gates[i], gd = t.gates[i];
      const s0 = (b.px - gt.ax) * gt.nx + (b.py - gt.ay) * gt.ny;
      const s1 = (b.x - gt.ax) * gt.nx + (b.y - gt.ay) * gt.ny;
      if (s0 < 0 && s1 >= 0) {
        const gx = gd.b.x - gd.a.x, gy = gd.b.y - gd.a.y;
        const u = ((b.x - gt.ax) * gx + (b.y - gt.ay) * gy) / (gx * gx + gy * gy);
        if (u > -0.15 && u < 1.15) {
          this.elements.gates[gt.id].open = 1;
          ev.push({ t: 'gate', id: gt.id, ballId: b.id });
          if (b.state === 'lane') b.state = 'play';
        }
      }
    }

    // resting back on the plunger
    if (b.state === 'lane' && b.x > t.plunger.x0 && b.y >= t.plunger.restY - 1.5 && Math.abs(b.vy) < 25 && Math.abs(b.vx) < 25) {
      b.attached = true; this._holdPlunger(b);
      return;
    }

    // spinner
    for (let i = 0; i < this.spinners.length; i++) {
      const sp = this.spinners[i];
      if ((b.py - sp.y) * (b.y - sp.y) <= 0 && b.py !== b.y && Math.abs(b.x - sp.x) < sp.w * 0.5 + 4) {
        const add = b.vy * P.spinnerGain;
        sp.angVel += add;
        if (sp.angVel > 45) sp.angVel = 45; else if (sp.angVel < -45) sp.angVel = -45;
        sp.lastBall = b.id;
      }
    }

    // sensors
    const bit = 1 << b.slot;
    const ss = this.sensors;
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i];
      if (!s.active) continue;
      const dx = b.x - s.x, dy = b.y - s.y, d2 = dx * dx + dy * dy;
      if (d2 < s.r * s.r) {
        if (!(s.inMask & bit)) { s.inMask |= bit; ev.push({ t: 'sensor', id: s.id, kind: s.kind, ballId: b.id, x: s.x, y: s.y }); }
      } else if ((s.inMask & bit) && d2 > (s.r + 3) * (s.r + 3)) s.inMask &= ~bit;
    }

    if (b.state === 'play') {
      // tunnels
      if (b.tunnelCd <= 0) {
        const tn = t.tunnels;
        for (let i = 0; i < tn.length; i++) {
          const m = tn[i], dx = b.x - m.x, dy = b.y - m.y;
          if (dx * dx + dy * dy < m.r * m.r) { this._warp(b, m, Math.sqrt(sp2)); break; }
        }
      }
      // holes
      for (let i = 0; i < this._holes.length; i++) {
        const hl = this._holes[i];
        if (hl.ballId || hl.cd > 0 || b.locked) continue;
        const dx = b.x - hl.x, dy = b.y - hl.y;
        if (dx * dx + dy * dy < hl.r * hl.r) {
          hl.ballId = b.id; hl.t = 0; hl.el.occupied = true; hl.el.ballId = b.id; hl.el.t = 0; hl.el.hold = P.holdTime;
          b.state = 'held'; b.holeIdx = i; b.x = hl.x; b.y = hl.y; b.vx = 0; b.vy = 0;
          ev.push({ t: 'hole', id: hl.id, ballId: b.id });
          return;
        }
      }
      // stuck detection
      if (sp2 < P.stuckSpeed * P.stuckSpeed) {
        b.fastT = 0;
        b.slowT += h;
        // Invisible tiny shake (moves the ball under 1 unit) every 0.35 s of almost no movement: a stable rest stays
        // put, but a ball balanced on a post or a wall end (static friction holds it there) falls off.
        if (b.slowT >= b.jiggleAt) { b.jiggleAt = b.slowT + 0.35; b.vx += (this.rng() < 0.5 ? -1 : 1) * (3 + this.rng() * 5); }
        if (b.slowT >= P.stuckSeconds) { b.slowT = 0; b.jiggleAt = 0.35; ev.push({ t: 'stuck', ballId: b.id }); }
      } else {
        b.slowT = 0; b.jiggleAt = 0.35;
        if (sp2 > 150 * 150) { b.fastT += h; if (b.fastT > 1.5) b.nudges = 0; } else b.fastT = 0;
      }
      // drain
      if (b.y > t.drainY) { b.state = 'drained'; ev.push({ t: 'drain', ballId: b.id }); }
    }

    // A 'play' ball inside the shooter lane (right of the lane inner wall, below the gate flap) can only be a ball that was
    // knocked back through the flap (ball-ball position correction at the gate). Only 'lane' balls re-attach to the plunger,
    // the lane floor stops it before drainY and a nudge cannot hop it over the flap, so it would stay there for good.
    // Make it a lane ball again. Legit play balls are never there (centre x <= 467 on the playfield side, y <= 250 at the flap).
    if (b.state === 'play' && b.x > t.plunger.x0 + 3 && b.y > 256) b.state = 'lane';
  };

  World.prototype._warp = function (b, from, speed) {
    const t = this.table;
    let to = null;
    for (const m of t.tunnels) if (m.id === from.partner) to = m;
    if (!to) return;
    const ang = (this.rng() - 0.5) * 0.5;
    const c = Math.cos(ang), s = Math.sin(ang);
    const dx = to.nx * c - to.ny * s, dy = to.nx * s + to.ny * c;
    const out = Math.min(520, Math.max(300, speed * 0.8));
    b.x = to.x + to.nx * (to.r + 3); b.y = to.y + to.ny * (to.r + 3);
    b.px = b.x; b.py = b.y;
    b.vx = dx * out; b.vy = dy * out;
    b.tunnelCd = 0.7;
    b.kicks = 0;
    this.elements.tunnels[from.id].glow = 1;
    this.elements.tunnels[to.id].glow = 1;
    this._events.push({ t: 'tunnel', from: from.id, to: to.id, ballId: b.id });
  };

  World.prototype._updateHoles = function (h) {
    for (let i = 0; i < this._holes.length; i++) {
      const hl = this._holes[i];
      if (hl.cd > 0) hl.cd -= h;
      if (!hl.ballId) continue;
      const b = this.getBall(hl.ballId);
      if (!b) { hl.ballId = 0; hl.el.occupied = false; continue; }
      if (b.locked) continue;
      hl.t += h; hl.el.t = hl.t; hl.el.hold = this.params.holdTime;
      if (hl.t >= this.params.holdTime) this.releaseBall(b.id);   // gentle pop out (default velocity)
    }
  };

  World.prototype._updateSpinners = function (h) {
    for (let i = 0; i < this.spinners.length; i++) {
      const sp = this.spinners[i];
      if (sp.angVel === 0) continue;
      sp.angle += sp.angVel * h;
      sp.angVel -= sp.angVel * 1.1 * h;
      const a = Math.abs(sp.angVel);
      if (a < 0.8) { sp.angVel = 0; sp.acc = 0; continue; }
      sp.acc += a * h;
      while (sp.acc >= Math.PI) {
        sp.acc -= Math.PI;
        this._events.push({ t: 'spinner', id: sp.id, ballId: sp.lastBall, spin: a, ticks: 1 });
      }
    }
  };

  PM.Physics = { World: World, DEFAULTS: DEFAULTS };
})(typeof globalThis !== 'undefined' ? globalThis : window);
