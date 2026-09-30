/* 30_table.js: PM.Table.build() returns the whole table as plain data. DOM-free, deterministic.

   COORDINATES: table units, 540 x 960, origin top-left, y grows downward. Ball radius = PM.CFG.BALL_R = 10.
   Angles in radians, 0 = +x, positive = clockwise on screen (toward +y).
   From the slings down the playfield is mirror-symmetric about x = 250 (table.axisX). The upper group (rollover lanes,
   ghost house, ghost triangle, fruit ring) is centred on x = 264 (table.upperX), a little toward the arch apex, so that the
   shooter lane's sweep over the top reaches all three lanes. The big top arch is a circle centred at (271, 271), r 251,
   so it also covers the shooter lane on the right.

   LAYOUT (top to bottom): arch (top y 20) | three rollover lanes (y 86-128, x 212 / 264 / 316) | ghost house funnel and
   saucer (y 170-206, x 264) | ghost triangle: piri (264,315), rozi (204,398), kiki (324,398), radius 34 | mid area with
   fruit spot (264,510) and the two tunnels (y 570) | slings (y 655-760) | inlane guides | flippers (pivots y 838) |
   drain (y 950). The spinner orbit lane runs down the far left wall (x 23-63, y 262-435). The mystery target sits on the
   right wall (y 430-478). Shooter lane: x 483-519, plunger surface y 909 (pulls back 40 units), lane floor y 956, the
   lane inner wall ends at y 250 and the one way gate flap closes the exit above it.

   ---------------------------------------------------------------------------------------------------------
   SCHEMA of the object returned by PM.Table.build()   (all points are {x,y})
   ---------------------------------------------------------------------------------------------------------
   W, H, ballR, axisX, upperX, drainY   table size, ball radius, symmetry axis (lower), axis of the upper group,
                                        y below which a ball is drained

   walls[]      {id, style, t, pts:[{x,y}...]}  solid polylines. style: 'wall' | 'guide' | 'rubber' | 'arch'.
                t = collision half thickness, so a renderer strokes them with lineWidth 2*t (round caps/joins)
                and what you see is exactly what the ball hits. 'rubber' is livelier (restitution 0.6).
   posts[]      {id, x, y, r, style}           round solid posts ('rubber' or 'wall')
   bumpers[]    {id:'piri'|'rozi'|'kiki', x, y, r, color:'red'|'pink'|'cyan'}   pop bumpers (ghosts)
   slings[]     {id:'slingL'|'slingR', side, pts:[p1,p2,p3], t, a, b, nx, ny}
                Triangle p1-p2-p3 (stroke it with lineWidth 2*t). The active kicking edge is a->b (= p1->p3),
                (nx,ny) is the unit kick direction (points into the playfield, a bit upward).
   flippers[]   {id:'L'|'R', px, py, len, r0, r1, rest, up}
                Tapered capsule: circle r0 at the pivot, circle r1 at the tip (tip = pivot + len*(cos a, sin a)).
                rest = resting angle, up = raised angle (radians). Runtime angle is in world.flippers[i].angle.
   spinners[]   {id:'spinner', x, y, w}        a plate across the orbit lane, w = width (the lane width it spans)
   holes[]      {id:'house', x, y, r, holdTime} saucer: a ball whose centre is within r is captured
   tunnels[]    {id:'tunL'|'tunR', x, y, r, nx, ny, partner}   mouth circle centre (on the wall), (nx,ny) = unit
                direction of leaving the mouth (into the playfield), r = capture radius (ball centre)
   gates[]      {id:'gate', a, b, nx, ny}      one way flap a->b at the top of the shooter lane; (nx,ny) is the
                pass direction (lane -> playfield). Balls coming the other way are blocked.
   targets[]    {id:'mystery', a, b, t, x, y}  solid standup target: capsule a->b half thickness t, centre x,y
   sensors[]    {id, kind:'dot'|'pellet'|'lane'|'fruit', x, y, r, active, group}
                r = trigger radius measured to the BALL CENTRE. Ids: dot_1.., pellet_1..4, lane1..3, fruit.
                'fruit' starts inactive. All others start active. group = dot group id (dots only).
   dotGroups[]  {id, ids:[sensor ids]}          arch, orbit, bumpL, bumpR, top, mid, inL, inR, low
   plunger      {x, y, x0, x1, travel, restY}   x = lane centre, y = top surface of the resting plunger,
                x0..x1 = lane inner edges (between the wall centre lines), travel = max pull back in units,
                restY = ball centre y when resting on the plunger
   spots        {plungerRest, fruit, fruits3:[3 x {x,y}], balloonArea:{x,y,w,h}, pacmanHelper, houseDoor,
                 noriPeek, tunnelMouths:{tunL:{x,y,nx,ny}, tunR:{...}}, spinner:{x,y}, mystery:{x,y}}
   decor        everything a renderer needs that is not physics:
     field         closed polygon [{x,y}] = whole playable interior incl. the shooter lane (fill it; it has a
                   zero width slit along the lane inner wall, use the nonzero rule)
     arch          {cx, cy, r, a0, a1, pts}  top arch circle and its tessellated points
     lane          {x0, x1, xc, top, bottom, gateY}  shooter lane box (x0..x1 wall centre lines), gateY = flap height
     playfieldFloor {left:{x,y}, right:{x,y}}  where the two flipper pivot circles sit (for the drain funnel art)
     housePen      {x, y, w, h, funnel:[[p,p],[p,p]], body:{x,y,w,h}, doorX, doorY, doorW, hole:{x,y,r}}
                   funnel = the two solid slopes (left, right), body = suggested building drawn behind them
     tunnelMouths  [{id, side:'L'|'R', x, y, nx, ny, w, h}]  w = opening height along the wall, h = depth into table
     spinner       {id, x, y, w}
     targets       [{id, x, y, w, h, a, b}]  (the "?" plate)
     laneLights    [{id, x, y, r}]  rollover light positions (centres of the lane sensors, r = suggested light size)
     orbit         {x0, x1, top, bottom}      spinner orbit channel box
     bumperHalos   [{id, x, y, r}]            suggested light disc radius for ghost art (r + 12)
     flipperPivots [{id, x, y, r}]
     guides        [{id, side, p0, p1}]       inlane guide lines (also in walls[] with style 'guide')
   stats        {dots, pellets}

   RUNTIME: PM.Physics.World copies sensors, flippers and spinners, so the table object stays read only.
   Nothing in here changes after build(). Call build() again for a fresh copy.
   --------------------------------------------------------------------------------------------------------- */
(function (g) {
  'use strict';
  const PM = g.PM = g.PM || {};
  const CFG = PM.CFG;

  const W = CFG.W, H = CFG.H;
  const P = (x, y) => ({ x: x, y: y });
  const r1 = (v) => Math.round(v * 10) / 10;
  const PI = Math.PI;

  // ---- layout constants ------------------------------------------------------------------------------
  const AXIS = 250;              // symmetry axis of the playfield (between left wall and lane inner wall)
  const UPX = 264;               // axis of the upper group (lanes, house, ghosts, fruit): a bit toward the arch apex (271)
                                 // so balls that come round the arch from the shooter lane reach all three lanes
  const WL = 20;                 // left wall centre line
  const LI = 480;                // lane inner wall centre line (right wall of the playfield)
  const WR = 522;                // lane outer wall centre line
  const LANE_X = (LI + WR) / 2;  // 501
  const WT = 3;                  // wall half thickness (drawn 6 wide)
  const ARCH = { cx: 271, cy: 271, r: 251 };
  const DRAIN_Y = 950;
  const LANE_TOP = 250;          // top end of the lane inner wall (34+ units below the arch, so the lane exit is wide)
  const mirror = (x) => 2 * AXIS - x;

  function arcPoints(cx, cy, r, a0, a1, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      pts.push(P(r1(cx + r * Math.cos(a)), r1(cy + r * Math.sin(a))));
    }
    return pts;
  }

  function build() {
    const t = { W: W, H: H, ballR: CFG.BALL_R, axisX: AXIS, upperX: UPX, drainY: DRAIN_Y };
    const walls = [], posts = [], sensors = [], dotGroups = [];

    const wall = (id, style, pts, th) => walls.push({ id: id, style: style, t: th === undefined ? WT : th, pts: pts });

    // ---- flippers ------------------------------------------------------------------------------------
    const FL = { len: 80, r0: 12, r1: 7, rest: 0.55, up: -0.44, py: 838 };
    // Gap between the resting tips is about 2.14 ball diameters (tip centres 56.8 apart minus both tip radii).
    const tipDx = FL.len * Math.cos(FL.rest);
    const pxL = AXIS - 28.4 - tipDx;
    const pxR = AXIS + 28.4 + tipDx;
    t.flippers = [
      { id: 'L', px: r1(pxL), py: FL.py, len: FL.len, r0: FL.r0, r1: FL.r1, rest: FL.rest, up: FL.up },
      { id: 'R', px: r1(pxR), py: FL.py, len: FL.len, r0: FL.r0, r1: FL.r1, rest: PI - FL.rest, up: PI - FL.up }
    ];

    // Top tangent line of the resting left flipper: the inlane guide continues that line up to the wall,
    // so a ball rolls off the guide onto the flipper without a bump.
    const ex = Math.cos(FL.rest), ey = Math.sin(FL.rest);
    const k = (FL.r0 - FL.r1) / FL.len, cphi = Math.sqrt(1 - k * k);
    const nTopX = ey * cphi + ex * k, nTopY = -ex * cphi + ey * k;        // outward normal of the top tangent line
    const dtx = ex * cphi - ey * k, dty = ey * cphi + ex * k;             // unit direction along that line
    const taX = pxL + FL.r0 * nTopX, taY = FL.py + FL.r0 * nTopY;         // tangent point on the pivot circle
    const guideSlope = dty / dtx;
    const guideY = (x) => taY - (taX - x) * guideSlope;                   // left guide line height at x
    const guideCos = dtx;

    // ---- outer walls -----------------------------------------------------------------------------------
    const archPts = arcPoints(ARCH.cx, ARCH.cy, ARCH.r, 0, -PI, 72);     // right end -> over the top -> left end
    wall('arch', 'arch', archPts);
    wall('wallL', 'wall', [P(WL, ARCH.cy), P(WL, r1(guideY(WL)))]);
    wall('guideL', 'guide', [P(WL, r1(guideY(WL))), P(r1(taX), r1(taY))]);
    wall('guideR', 'guide', [P(mirror(WL), r1(guideY(WL))), P(r1(mirror(taX)), r1(taY))]);
    // lane outer wall (arch meets it at y = 271) and inner wall
    wall('laneOuter', 'wall', [P(WR, ARCH.cy), P(WR, 956), P(LI, 956)]);
    wall('laneInner', 'wall', [P(LI, LANE_TOP), P(LI, r1(guideY(WL))), P(LI, 956)]);
    // plunger surface (a static floor at the rest position of the plunger)
    wall('plungerFloor', 'wall', [P(LI, 912), P(WR, 912)]);
    // drain side walls under the flippers (keep an escaping ball inside the table for the last few units)
    wall('drainL', 'wall', [P(r1(pxL - FL.r0), FL.py), P(r1(pxL - FL.r0), H)]);
    wall('drainR', 'wall', [P(r1(pxR + FL.r0), FL.py), P(r1(pxR + FL.r0), H)]);

    // ---- slingshots ------------------------------------------------------------------------------------
    const slingOffV = 44 / guideCos;                                      // 44 units (perpendicular) above the guide
    const yb = (x) => guideY(x) - slingOffV;
    const sp1 = P(62, 655), sp2 = P(62, r1(yb(62))), sp3 = P(126, r1(yb(126)));
    function sling(id, side, p1, p2, p3) {
      const ddx = p3.x - p1.x, ddy = p3.y - p1.y, len = Math.hypot(ddx, ddy);
      let nx = ddy / len, ny = -ddx / len;                               // perpendicular; pick the one facing the centre
      if (side === 'L' ? nx < 0 : nx > 0) { nx = -nx; ny = -ny; }
      return { id: id, side: side, pts: [p1, p2, p3], t: 3, a: p1, b: p3, nx: r1(nx * 1000) / 1000, ny: r1(ny * 1000) / 1000 };
    }
    t.slings = [
      sling('slingL', 'L', sp1, sp2, sp3),
      sling('slingR', 'R', P(mirror(sp1.x), sp1.y), P(mirror(sp2.x), sp2.y), P(mirror(sp3.x), sp3.y))
    ];

    // ---- orbit lane on the far left (spinner) ----------------------------------------------------------
    wall('orbitInner', 'guide', [P(66, 262), P(66, 435)]);

    // ---- rollover lane dividers at the top ---------------------------------------------------------------
    // Short rails so that a ball riding the arch still passes above them, and a ball dropping in is guided.
    for (const dx of [-78, -26, 26, 78]) wall('div' + (dx < 0 ? 'L' : 'R') + Math.abs(dx), 'guide', [P(UPX + dx, 86), P(UPX + dx, 128)]);

    // ---- ghost house: a funnel (like a martini glass) under the rollover lanes -------------------------------
    // A ball that drops out of a lane lands on a slope, rolls to the middle and is captured by the saucer at the
    // vertex. It is popped out downward through the gap toward the bumpers. From below, a ball that flies straight up
    // through the gap is captured too.
    const HOUSE = { topY: 170, botY: 206, topHalf: 52, botHalf: 24, holeY: 199 };
    wall('houseL', 'wall', [P(UPX - HOUSE.topHalf, HOUSE.topY), P(UPX - HOUSE.botHalf, HOUSE.botY)]);
    wall('houseR', 'wall', [P(UPX + HOUSE.topHalf, HOUSE.topY), P(UPX + HOUSE.botHalf, HOUSE.botY)]);
    t.holes = [{ id: 'house', x: UPX, y: HOUSE.holeY, r: 22, holdTime: CFG.HOLD_SECONDS }];

    // ---- bumpers -----------------------------------------------------------------------------------------
    t.bumpers = [
      { id: 'piri', x: UPX, y: 315, r: 34, color: 'red' },
      { id: 'rozi', x: UPX - 60, y: 398, r: 34, color: 'pink' },
      { id: 'kiki', x: UPX + 60, y: 398, r: 34, color: 'cyan' }
    ];

    // ---- posts ---------------------------------------------------------------------------------------------
    posts.push({ id: 'postL', x: 150, y: 520, r: 8, style: 'rubber' });
    posts.push({ id: 'postR', x: mirror(150), y: 520, r: 8, style: 'rubber' });

    // ---- spinner, tunnels, gate, target -----------------------------------------------------------------
    t.spinners = [{ id: 'spinner', x: 43, y: 340, w: 36 }];
    const TUN_Y = 570;
    t.tunnels = [
      { id: 'tunL', x: WL, y: TUN_Y, r: 22, nx: 1, ny: 0, partner: 'tunR' },
      { id: 'tunR', x: LI, y: TUN_Y, r: 22, nx: -1, ny: 0, partner: 'tunL' }
    ];
    // Flap from the top of the lane inner wall up to the arch. Pass direction: up and a bit to the left.
    {
      const archX = (y) => ARCH.cx + Math.sqrt(Math.pow(ARCH.r - WT, 2) - Math.pow(y - ARCH.cy, 2));
      const a = P(LI, LANE_TOP), b = P(r1(archX(LANE_TOP - 14) - 2), LANE_TOP - 14);
      const gx = b.x - a.x, gy = b.y - a.y, gl = Math.hypot(gx, gy);
      let nx = gy / gl, ny = -gx / gl;
      if (ny > 0) { nx = -nx; ny = -ny; }                                   // pass direction points up
      t.gates = [{ id: 'gate', a: a, b: b, nx: r1(nx * 1000) / 1000, ny: r1(ny * 1000) / 1000 }];
    }
    t.targets = [{ id: 'mystery', a: P(473, 430), b: P(473, 478), t: 5, x: 473, y: 454 }];

    // ---- plunger ------------------------------------------------------------------------------------------
    t.plunger = { x: LANE_X, y: 909, x0: LI, x1: WR, travel: 40, restY: 909 - CFG.BALL_R };

    // ---- sensors ------------------------------------------------------------------------------------------
    let dotN = 0;
    function dotGroup(id, pts) {
      const ids = [];
      for (const p of pts) {
        dotN++;
        const sid = 'dot_' + dotN;
        sensors.push({ id: sid, kind: 'dot', x: r1(p.x), y: r1(p.y), r: 13, active: true, group: id });
        ids.push(sid);
      }
      dotGroups.push({ id: id, ids: ids });
    }
    // arch: dots just inside the arch, where a fast launched ball rides
    {
      const pts = [];
      for (let i = 0; i < 11; i++) {
        const a = (-155 + i * 13) * PI / 180;
        pts.push(P(ARCH.cx + 230 * Math.cos(a), ARCH.cy + 230 * Math.sin(a)));
      }
      dotGroup('arch', pts);
    }
    dotGroup('orbit', [P(42, 285), P(42, 310), P(42, 372), P(42, 398)]);
    dotGroup('bumpL', [P(112, 340), P(100, 385), P(106, 430), P(128, 472)]);
    dotGroup('bumpR', [P(mirror(112) + 14, 340), P(mirror(100) + 14, 385), P(mirror(106) + 14, 430), P(mirror(128) + 14, 472)]);
    dotGroup('top', [-60, -30, 0, 30, 60].map((dx) => P(UPX + dx, 262)));
    {
      const pts = [];
      for (let i = 0; i < 6; i++) { const a = i * PI / 3; pts.push(P(UPX + 52 * Math.cos(a), 510 + 52 * Math.sin(a))); }
      dotGroup('mid', pts);
    }
    const inX = [40, 70, 100, 130];
    dotGroup('inL', inX.map((x) => P(x, guideY(x) - 22)));
    dotGroup('inR', inX.map((x) => P(mirror(x), guideY(x) - 22)));
    dotGroup('low', [P(190, 705), P(220, 705), P(250, 705), P(280, 705), P(310, 705)]);

    const pellets = [P(98, 292), P(mirror(98), 292), P(62, 520), P(mirror(62), 520)];
    pellets.forEach((p, i) => sensors.push({ id: 'pellet_' + (i + 1), kind: 'pellet', x: r1(p.x), y: r1(p.y), r: 18, active: true, group: 'pellet' }));

    const laneY = 106;
    [-52, 0, 52].forEach((dx, i) => sensors.push({ id: 'lane' + (i + 1), kind: 'lane', x: UPX + dx, y: laneY, r: 24, active: true, group: 'lane' }));
    sensors.push({ id: 'fruit', kind: 'fruit', x: UPX, y: 510, r: 24, active: false, group: 'fruit' });

    // ---- spots for the game ------------------------------------------------------------------------------
    t.spots = {
      plungerRest: P(LANE_X, t.plunger.restY),
      fruit: P(UPX, 510),
      fruits3: [P(UPX - 80, 470), P(UPX + 80, 470), P(UPX, 590)],
      balloonArea: { x: UPX - 120, y: 440, w: 240, h: 170 },
      pacmanHelper: P(AXIS, 930),
      houseDoor: P(UPX, HOUSE.botY + 6),
      noriPeek: P(UPX, HOUSE.holeY - 8),
      tunnelMouths: {
        tunL: { x: WL, y: TUN_Y, nx: 1, ny: 0 },
        tunR: { x: LI, y: TUN_Y, nx: -1, ny: 0 }
      },
      spinner: P(43, 340),
      mystery: P(473, 454)
    };

    // ---- decor -------------------------------------------------------------------------------------------
    const guideStartY = r1(guideY(WL));
    const field = archPts.slice();                                        // right end -> left end over the top
    field.push(P(WL, guideStartY));                                       // down the left wall
    field.push(P(r1(taX), r1(taY)), P(r1(taX), H), P(r1(mirror(taX)), H)); // left guide, drain box
    field.push(P(r1(mirror(taX)), r1(taY)), P(LI, guideStartY));           // right guide
    field.push(P(LI, LANE_TOP), P(LI, 956), P(WR, 956));                        // slit along the lane inner wall
    t.decor = {
      field: field,
      arch: { cx: ARCH.cx, cy: ARCH.cy, r: ARCH.r, a0: 0, a1: -PI, pts: archPts },
      lane: { x0: LI, x1: WR, xc: LANE_X, top: LANE_TOP - 14, bottom: 956, gateY: LANE_TOP - 7 },
      playfieldFloor: { left: P(r1(pxL), FL.py), right: P(r1(pxR), FL.py) },
      housePen: {
        x: UPX, y: (HOUSE.topY + HOUSE.botY) / 2, w: HOUSE.topHalf * 2, h: HOUSE.botY - HOUSE.topY,
        funnel: [
          [P(UPX - HOUSE.topHalf, HOUSE.topY), P(UPX - HOUSE.botHalf, HOUSE.botY)],
          [P(UPX + HOUSE.topHalf, HOUSE.topY), P(UPX + HOUSE.botHalf, HOUSE.botY)]
        ],
        body: { x: UPX, y: HOUSE.topY + 22, w: HOUSE.topHalf * 2 + 36, h: 84 },   // suggested house building behind the funnel
        doorX: UPX, doorY: HOUSE.botY, doorW: (HOUSE.botHalf - 3) * 2,
        hole: { x: UPX, y: HOUSE.holeY, r: 22 }
      },
      tunnelMouths: [
        { id: 'tunL', side: 'L', x: WL, y: TUN_Y, nx: 1, ny: 0, w: 44, h: 26 },
        { id: 'tunR', side: 'R', x: LI, y: TUN_Y, nx: -1, ny: 0, w: 44, h: 26 }
      ],
      spinner: { id: 'spinner', x: 43, y: 340, w: 36 },
      targets: [{ id: 'mystery', x: 473, y: 454, w: 12, h: 58, a: t.targets[0].a, b: t.targets[0].b }],
      laneLights: [-52, 0, 52].map((dx, i) => ({ id: 'lane' + (i + 1), x: UPX + dx, y: laneY, r: 16 })),
      orbit: { x0: WL, x1: 66, top: 262, bottom: 435 },
      bumperHalos: t.bumpers.map((b) => ({ id: b.id, x: b.x, y: b.y, r: b.r + 12 })),
      flipperPivots: t.flippers.map((f) => ({ id: f.id, x: f.px, y: f.py, r: f.r0 })),
      guides: [
        { id: 'guideL', side: 'L', p0: P(WL, guideStartY), p1: P(r1(taX), r1(taY)) },
        { id: 'guideR', side: 'R', p0: P(mirror(WL), guideStartY), p1: P(r1(mirror(taX)), r1(taY)) }
      ]
    };

    t.walls = walls;
    t.posts = posts;
    t.sensors = sensors;
    t.dotGroups = dotGroups;
    t.stats = { dots: dotN, pellets: pellets.length };
    return t;
  }

  PM.Table = { build: build };
})(typeof globalThis !== 'undefined' ? globalThis : window);
