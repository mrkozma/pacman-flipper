/* 70_render.js: PM.Render.create(canvas, game). Browser only. Draws everything the player sees; reads game.state,
   game.world and PM.Table data, never writes them. Art comes from PM.Sprites / PM.Theme, strings from PM.T (and PM.T.r).

   const render = PM.Render.create(canvas, game)
   render.resize()          call on window resize; reads the canvas CSS size and devicePixelRatio (capped at 2x)
   render.draw(nowSec)      one frame, never throws; nowSec is any monotonic clock in seconds (only differences matter)
   render.layout            {mode:'side'|'tall', w, h, dpr, scale, ui, table:{x,y,w,h}, panels, hud, buttons:[{id,x,y,w,h}]}
                            all CSS px. Buttons ids: sound, music, pause, fullscreen (always), left, right, launch (touch only).
   render.invalidate()      rebuild the cached table layer on the next frame (call when decor changes)
   render.quality           2 full, 1 no ambient extras, 0 minimal (adaptive, drops itself when frames are slow)
   render.stats             {ms, fps, particles, quality}

   LAYERS, back to front: backdrop (cached gradient + slow dot/maze pattern) > roaming delights > table layer
   (cached: floor, painted decor, double line maze walls, slings, posts, ghost house, tunnels, lane sockets) > dynamic
   table objects (dots, pellets, fruit, lamps, spinner, target, slings bands, balloons, ghost bumpers, flippers, plunger,
   balls with a soft trail, Pacman helper, particles, popups) > HUD (score, balls, fruit tray, chips, key caps, buttons,
   banner) > screens (title, pause, game over).

   Everything the renderer needs from game.state is listed in SPEC 4.2. Optional extras it also understands:
     state.fruits   [{id,kind,x,y}] the three fruits of the fruits surprise (the game also adds them as 'fruit' sensors: drawn once)
     sensor.fruitKind              fruit kind of a dynamic fruit sensor
   `t` of power/surprise/banner/popups counts UP (elapsed seconds) with `dur`, as 40_game.js documents.

   ROUND 2 (SPEC 9):
     The balls are little Pacmen (9.1). Drawn radius = world ball r * PM.CFG.BALL_DRAW_SCALE (read every frame). He faces his direction of
     travel (low passed velocity, turn rate capped at 14 rad/s, a turn of more than 115 degrees waits 0.13 s, below 60 units/s he keeps his
     last direction, the plunger lane ball looks up), chomps at 1 Hz when calm (lane, ghost house, almost still) up to 2.2 Hz at speed, the
     chomp only runs while screen is 'play', reduced motion = mouth half open and still. In two ball play the ball with the higher id wears a
     pink bow. render.ballInfo(id) -> {dir, phase, calm, mouth} is for tests.
     The ten minute goodbye (9.2) reads state.limit = {phase:'none'|'notice'|'last'|'goodbye', t (seconds in the phase), poke} and
     state.screen 'goodbye'; any junk reads as phase 'none'. Strings: PM.T.limit_notice {text,sub}, PM.T.limit_last {text,sub},
     PM.T.goodbye {title,line1,line2,parents}, each with a fallback in PM.T.r (06_strings_hu_render.js).
       notice   a card in free space next to the table: layout.hud.notice (side layout: the quiet left corner under the level pill plus the
                window margin; tall layout: a card over the score and balls row, the four buttons stay visible). Pacman slides in from the
                left (ease-out-cubic) and pops (ease-out-back), waves a white glove at 1.45 Hz, his bubble with the clock pops after 0.3 s.
                A banner of kind 'limit' is not drawn while the notice or the last phase shows (the notice says the same words itself).
       last     layout.hud.badge: a small card (side: the left column under the level pill; tall: it replaces the balls card) with a tiny
                waving Pacman and PM.T.limit_last. When the notice was seen it first shrinks into the badge (0.55 s, opaque until small).
       goodbye  the table is dimmed (0.85), a big Pacman (r about 100 to 118 design units, scaled to fit) waves at 1 Hz, big soft lines,
                small stars and score, a few hearts and stars drifting up (9 shapes, 0.5 alpha at most, none with reduced motion), the parent line pinned to the
                bottom of the window, and a hop plus a few hearts for every state.limit.poke. Portrait windows stack, landscape ones
                put Pacman left of the text (aspect 1.3 and up). */
(function (g) {
  'use strict';
  const PM = g.PM = g.PM || {};
  const U = PM.util;
  const CFG = PM.CFG;
  const PI = Math.PI, TAU = Math.PI * 2;
  const sin = Math.sin, cos = Math.cos, abs = Math.abs, min = Math.min, max = Math.max, sqrt = Math.sqrt;
  const clamp = U.clamp, lerp = U.lerp, smooth = U.smooth, easeOutBack = U.easeOutBack, easeOutCubic = U.easeOutCubic;

  // ------------------------------------------------------------------------------------------------------------
  // palette (PM.Theme.colors wins; this is only a safety net so a missing theme never breaks drawing)
  const FALLBACK = {
    bg0: '#0B1030', bg1: '#161B45', bg2: '#27236B', bgDot: '#2E3585', tableFill: '#0F1543', tableFill2: '#1A2058',
    wall: '#9AA6F7', wallDark: '#5560BF', wallFill: '#1F2668', wallGlow: 'rgba(154,166,247,0.30)',
    dot: '#FFF0CF', pellet: '#FFF6DC', pacman: '#FFD84A', pacmanLight: '#FFF0A0', pacmanDark: '#F2B12C', cheek: '#FF8FA3',
    ghost: { red: '#FF6B6B', pink: '#FF9ECB', cyan: '#6FDCF0', orange: '#FFB45C' }, ghostBlue: '#8F9CFF',
    ball: '#E9EEFB', ballDark: '#6B78AD', flipper: '#FF8DB5', flipperLight: '#FFC4DC', flipperDark: '#D45F8D',
    post: '#C3CBFF', sling: '#7C89F0', bumperRing: '#B9C2FF',
    balloons: ['#FF6B6B', '#FF9ECB', '#6FDCF0', '#FFB45C', '#8EE3A9', '#B79BFF'],
    text: '#FFF8E7', textMuted: '#B9C1F2', panel: 'rgba(20,26,72,0.84)', panelSolid: '#181E52',
    panelEdge: 'rgba(170,182,255,0.38)', accent: '#FFD84A', accent2: '#FF9ECB', good: '#8EE3A9', ink: '#241D52', ink2: '#2A2352'
  };
  function palette() {
    const c = PM.Theme && PM.Theme.colors;
    if (!c) return FALLBACK;
    const o = {};
    for (const k of Object.keys(FALLBACK)) o[k] = c[k] !== undefined ? c[k] : FALLBACK[k];
    return o;
  }
  function fontOf(px, w) {
    if (PM.Theme && PM.Theme.font) return PM.Theme.font(px, w);
    return (w || 600) + ' ' + Math.round(px * 100) / 100 + 'px sans-serif';
  }

  // ------------------------------------------------------------------------------------------------------------
  // small helpers
  function mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (!(w > 0) || !(h > 0)) return;
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  const rgbaCache = new Map();
  function hexRgb(h) {
    if (typeof h !== 'string' || h.charAt(0) !== '#') return null;
    if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    if (h.length !== 7) return null;
    return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
  }
  // '#RRGGBB' + alpha -> 'rgba(...)' (cached, so per frame calls build no strings)
  function rgba(hex, a) {
    const key = hex + '@' + a;
    let v = rgbaCache.get(key);
    if (v) return v;
    const c = hexRgb(hex);
    v = c ? 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')' : hex;
    rgbaCache.set(key, v);
    return v;
  }
  function fmtNum(n) {
    n = Math.max(0, Math.round(+n || 0));
    let s = String(n), out = '';
    while (s.length > 3) { out = ' ' + s.slice(-3) + out; s = s.slice(0, -3); }
    return s + out;
  }
  const isObj = (o) => o !== null && typeof o === 'object';
  const fin = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const str = (v, d) => (typeof v === 'string' ? v : d);

  // ------------------------------------------------------------------------------------------------------------
  // STATIC TABLE ART (painted once into the cached layer; units are table units, 1 unit = `scale` CSS px)
  const CACHE_M = 22;   // extra margin around the table inside the cache canvas, in table units (halo, shadow)

  function fieldPath(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  // Wall polylines grouped by (class, half thickness) into Path2D objects, so a whole group is stroked in one call.
  function buildWallPaths(table) {
    const out = [], idx = new Map();
    for (const w of table.walls) {
      if (w.id === 'plungerFloor' || !w.pts || w.pts.length < 2) continue;
      const cls = w.style === 'guide' ? 'guide' : 'wall';
      const key = cls + '|' + w.t;
      let e = idx.get(key);
      if (!e) { e = { cls: cls, t: w.t, path: new Path2D() }; idx.set(key, e); out.push(e); }
      e.path.moveTo(w.pts[0].x, w.pts[0].y);
      for (let i = 1; i < w.pts.length; i++) e.path.lineTo(w.pts[i].x, w.pts[i].y);
    }
    return out;
  }

  // Maze style wall: a thin light outline around a dark indigo core (outer stroke, then a narrower core stroke).
  function tubeStroke(ctx, path, t, thin, outer, core) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = outer; ctx.lineWidth = 2 * t; ctx.stroke(path);
    ctx.strokeStyle = core; ctx.lineWidth = Math.max(0.6, 2 * t - 2 * thin); ctx.stroke(path);
  }

  function paintTable(ctx, table, C, scale, dpr) {
    const W = table.W, H = table.H, dec = table.decor;
    const thin = clamp(1.25 / scale, 0.9, 1.9);
    const GUIDE = '#B7A8F5';

    // soft drop shadow so the table floats above the backdrop
    ctx.save();
    ctx.shadowColor = 'rgba(2,4,22,0.55)'; ctx.shadowBlur = 26 * dpr * min(1.5, max(0.6, scale)); ctx.shadowOffsetY = 5 * dpr;
    fieldPath(ctx, dec.field);
    ctx.fillStyle = '#0B0F35'; ctx.fill();
    ctx.restore();

    // floor
    ctx.save();
    fieldPath(ctx, dec.field);
    const fg = ctx.createLinearGradient(0, 0, 0, H);
    fg.addColorStop(0, '#151B52'); fg.addColorStop(0.45, C.tableFill); fg.addColorStop(1, '#0D1238');
    ctx.fillStyle = fg; ctx.fill();
    ctx.clip();

    // vignette: the edges sit a little deeper so the middle glows
    const vg = ctx.createRadialGradient(W * 0.5, H * 0.46, 40, W * 0.5, H * 0.46, H * 0.62);
    vg.addColorStop(0, 'rgba(60,70,190,0.10)'); vg.addColorStop(0.55, 'rgba(60,70,190,0)'); vg.addColorStop(1, 'rgba(3,5,25,0.34)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    // painted decoration on the lower playfield: a big, very quiet Pacman face (the dots row leads into his mouth)
    {
      const cx = 250, cy = 706, r = 104, a = 0.52;
      ctx.beginPath(); ctx.moveTo(cx + 4, cy); ctx.arc(cx, cy, r, a, TAU - a); ctx.closePath();
      ctx.fillStyle = 'rgba(255,216,74,0.05)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,216,74,0.06)'; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx - 6, cy - 52, 7, 10, 0, 0, TAU); ctx.fillStyle = 'rgba(6,8,40,0.22)'; ctx.fill();
    }
    // faint maze corridors around the ghost triangle (rounded outlines, like the arcade maze)
    {
      ctx.strokeStyle = 'rgba(154,166,247,0.075)'; ctx.lineWidth = 2;
      rr(ctx, 92, 236, 344, 274, 46); ctx.stroke();
      rr(ctx, 118, 262, 292, 222, 34); ctx.stroke();
    }
    // orbit channel (spinner lane): slightly lighter track with soft downward chevrons
    {
      const o = dec.orbit;
      rr(ctx, o.x0, o.top, o.x1 - o.x0, o.bottom - o.top, 8);
      ctx.fillStyle = 'rgba(120,132,240,0.06)'; ctx.fill();
      ctx.strokeStyle = 'rgba(183,195,255,0.15)'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const cx = (o.x0 + o.x1) / 2;
      for (const y of [284, 304, 372, 394, 414]) {
        ctx.beginPath(); ctx.moveTo(cx - 7, y - 4); ctx.lineTo(cx, y + 3); ctx.lineTo(cx + 7, y - 4); ctx.stroke();
      }
    }
    // shooter lane and drain pocket sit a little deeper than the playfield
    ctx.fillStyle = 'rgba(3,5,25,0.34)';
    ctx.fillRect(dec.lane.x0, dec.lane.top, dec.lane.x1 - dec.lane.x0, dec.lane.bottom - dec.lane.top);
    {
      const fl = dec.playfieldFloor;
      const dg = ctx.createLinearGradient(0, fl.left.y, 0, H);
      dg.addColorStop(0, 'rgba(3,5,25,0)'); dg.addColorStop(1, 'rgba(3,5,25,0.35)');
      ctx.fillStyle = dg; ctx.fillRect(fl.left.x - 14, fl.left.y, fl.right.x - fl.left.x + 28, H - fl.left.y);
    }
    ctx.restore();

    // ghost house: a little building behind the funnel, with a dark room inside and a pink door
    {
      const hp = dec.housePen, b = hp.body;
      ctx.save();
      rr(ctx, b.x - b.w / 2, b.y - b.h / 2 + 6, b.w, b.h - 6, 20);
      const bg = ctx.createLinearGradient(0, b.y - b.h / 2, 0, b.y + b.h / 2);
      bg.addColorStop(0, 'rgba(60,68,170,0.35)'); bg.addColorStop(1, 'rgba(38,44,120,0.25)');
      ctx.fillStyle = bg; ctx.fill();
      ctx.strokeStyle = 'rgba(154,166,247,0.30)'; ctx.lineWidth = 1.5; ctx.stroke();
      const f = hp.funnel;
      ctx.beginPath();
      ctx.moveTo(f[0][0].x, f[0][0].y); ctx.lineTo(f[1][0].x, f[1][0].y); ctx.lineTo(f[1][1].x, f[1][1].y); ctx.lineTo(f[0][1].x, f[0][1].y);
      ctx.closePath();
      const rg = ctx.createRadialGradient(hp.x, hp.hole.y - 6, 2, hp.x, hp.hole.y - 6, 60);
      rg.addColorStop(0, '#2A1F57'); rg.addColorStop(1, '#070A2A');
      ctx.fillStyle = rg; ctx.fill();
      ctx.restore();
    }

    // walls: soft glow first, then the double lines
    const wp = buildWallPaths(table);
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const e of wp) {
      ctx.strokeStyle = e.cls === 'guide' ? 'rgba(183,168,245,0.06)' : 'rgba(154,166,247,0.065)'; ctx.lineWidth = 2 * e.t + 14; ctx.stroke(e.path);
      ctx.strokeStyle = e.cls === 'guide' ? 'rgba(183,168,245,0.09)' : 'rgba(154,166,247,0.10)'; ctx.lineWidth = 2 * e.t + 6.5; ctx.stroke(e.path);
    }
    for (const e of wp) tubeStroke(ctx, e.path, e.t, thin, e.cls === 'guide' ? GUIDE : C.wall, '#1B2260');
    ctx.restore();

    // slingshots: a soft body, a maze style outline and two little arrows that show the kick direction
    for (const s of table.slings) {
      const p = s.pts;
      ctx.save();
      ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); ctx.lineTo(p[1].x, p[1].y); ctx.lineTo(p[2].x, p[2].y); ctx.closePath();
      const gx = (p[0].x + p[2].x) / 2, gy = (p[0].y + p[2].y) / 2;
      const sg = ctx.createLinearGradient(p[1].x, p[1].y, gx, gy);
      sg.addColorStop(0, 'rgba(70,80,190,0.55)'); sg.addColorStop(1, 'rgba(124,137,240,0.22)');
      ctx.fillStyle = sg; ctx.fill();
      const path = new Path2D();
      path.moveTo(p[0].x, p[0].y); path.lineTo(p[1].x, p[1].y); path.lineTo(p[2].x, p[2].y); path.closePath();
      tubeStroke(ctx, path, s.t, thin, C.wall, '#1B2260');
      const cx = (p[0].x + p[1].x + p[2].x) / 3, cy = (p[0].y + p[1].y + p[2].y) / 3;
      const nx = s.nx, ny = s.ny, px = -ny, py = nx;
      ctx.strokeStyle = 'rgba(255,240,207,0.35)'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 0; i < 2; i++) {
        const ox = cx - nx * 7 + nx * i * 10, oy = cy - ny * 7 + ny * i * 10;
        ctx.beginPath();
        ctx.moveTo(ox - nx * 4 + px * 7, oy - ny * 4 + py * 7); ctx.lineTo(ox + nx * 4, oy + ny * 4); ctx.lineTo(ox - nx * 4 - px * 7, oy - ny * 4 - py * 7);
        ctx.stroke();
      }
      ctx.restore();
    }

    // rubber posts
    for (const p of table.posts) {
      ctx.save();
      const rg = ctx.createRadialGradient(p.x - p.r * 0.35, p.y - p.r * 0.4, p.r * 0.1, p.x, p.y, p.r * 1.1);
      if (p.style === 'rubber') { rg.addColorStop(0, '#FFC9DF'); rg.addColorStop(0.55, '#FF9ECB'); rg.addColorStop(1, '#C8649A'); }
      else { rg.addColorStop(0, '#E4E8FF'); rg.addColorStop(0.55, C.post); rg.addColorStop(1, '#6F7CD0'); }
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fillStyle = rg; ctx.fill();
      ctx.lineWidth = thin * 1.1; ctx.strokeStyle = 'rgba(255,248,231,0.75)'; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(p.x - p.r * 0.32, p.y - p.r * 0.38, p.r * 0.28, p.r * 0.16, -0.7, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
      ctx.restore();
    }

    // tunnel doorways cut into the side walls: dark alcove, dotted trim, two arrows that point into the wall
    for (const m of dec.tunnelMouths) {
      const sx = m.nx > 0 ? 1 : -1;
      ctx.save();
      ctx.beginPath();
      if (sx > 0) ctx.rect(m.x - 3.6, m.y - 32, 40, 64); else ctx.rect(m.x - 36.4, m.y - 32, 40, 64);
      ctx.clip();
      ctx.beginPath(); ctx.ellipse(m.x, m.y, m.h - 1, m.w / 2, 0, 0, TAU);
      const gr = ctx.createRadialGradient(m.x + sx * 2, m.y, 2, m.x + sx * 2, m.y, m.h + 6);
      gr.addColorStop(0, '#04051C'); gr.addColorStop(0.65, '#12173F'); gr.addColorStop(1, '#262E86');
      ctx.fillStyle = gr; ctx.fill();
      ctx.lineWidth = thin * 1.3; ctx.strokeStyle = 'rgba(200,210,255,0.85)'; ctx.stroke();
      // dotted trim, like a row of tiny arcade dots
      ctx.fillStyle = 'rgba(255,240,207,0.85)';
      for (let i = 0; i < 7; i++) {
        const a = -PI * 0.42 + i * (PI * 0.84 / 6);
        ctx.beginPath(); ctx.arc(m.x + sx * cos(a) * (m.h - 7), m.y + sin(a) * (m.w / 2 - 6), 1.35, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(183,168,245,0.75)'; ctx.lineWidth = 2.3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 0; i < 2; i++) {
        const cx = m.x + sx * (7 + i * 8);
        ctx.beginPath(); ctx.moveTo(cx + sx * 3, m.y - 6); ctx.lineTo(cx - sx * 3, m.y); ctx.lineTo(cx + sx * 3, m.y + 6); ctx.stroke();
      }
      ctx.restore();
    }

    // rollover lane sockets
    for (const l of dec.laneLights) {
      ctx.beginPath(); ctx.arc(l.x, l.y, l.r + 3, 0, TAU);
      ctx.fillStyle = '#080B2E'; ctx.fill();
      ctx.lineWidth = thin * 1.2; ctx.strokeStyle = 'rgba(154,166,247,0.55)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(l.x, l.y, l.r - 1, 0, TAU);
      ctx.fillStyle = '#141A55'; ctx.fill();
    }

    // spinner axle
    {
      const sp = dec.spinner, hw = sp.w / 2 + 4;
      ctx.strokeStyle = '#8792E0'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sp.x - hw, sp.y); ctx.lineTo(sp.x + hw, sp.y); ctx.stroke();
      ctx.fillStyle = '#B7C3FF';
      ctx.beginPath(); ctx.arc(sp.x - hw, sp.y, 3.2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(sp.x + hw, sp.y, 3.2, 0, TAU); ctx.fill();
    }

    // flipper pivots get a soft socket
    for (const p of dec.flipperPivots) {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 4, 0, TAU); ctx.fillStyle = 'rgba(4,6,30,0.5)'; ctx.fill();
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // LAYOUT. All numbers are CSS px. Two modes:
  //   'side'  the window is wide enough for two HUD panels next to the table (score and stats left, balls, fruit,
  //           chips and mascots right, key caps at the bottom of each panel)
  //   'tall'  portrait or squarish windows: a slim HUD band on top, the key caps (or touch buttons) below, the table
  //           in between. If the bands would shrink the table by more than 18 percent they overlap it instead.
  function computeLayout(cw, ch, touch) {
    const TW = 540, TH = 960;
    const m = Math.round(clamp(Math.min(cw, ch) * 0.02, 6, 20));
    const sFull = Math.max(0.05, Math.min((cw - 2 * m) / TW, (ch - 2 * m) / TH));
    const fullW = TW * sFull, fullH = TH * sFull;
    const sideRoom = (cw - fullW) / 2;
    const wide = sideRoom >= Math.max(190, fullH * 0.27) && cw >= ch * 0.9;
    const L = { mode: wide ? 'side' : 'tall', w: cw, h: ch, m: m, touch: !!touch, buttons: [] };
    const hud = L.hud = { chipsOverlay: false, best: null, level: null, fruit: null, mascotL: null, mascotR: null, chips: null };
    const btnIds = ['sound', 'music', 'pause', 'fullscreen'];
    const pushBtn = (id, x, y, w, h) => {
      const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));   // a grown touch area never leaves the window
      L.buttons.push({ id: id, x: x0, y: y0, w: Math.min(cw - x0, Math.round(x + w) - x0), h: Math.min(ch - y0, Math.round(y + h) - y0) });
    };

    if (wide) {
      const ui = clamp(fullH / 720, 0.5, 1.75);
      const gap = Math.round(20 * ui);
      const pw = Math.floor(Math.min(sideRoom - gap - m * 0.5, 330 * ui));
      const uu = Math.min(ui, pw / 310);
      const tx = (cw - fullW) / 2, ty = (ch - fullH) / 2;
      L.scale = sFull; L.ui = ui; L.uu = uu;
      L.table = { x: tx, y: ty, w: fullW, h: fullH };
      const lp = { x: tx - gap - pw, y: ty, w: pw, h: fullH };
      const rp = { x: tx + fullW + gap, y: ty, w: pw, h: fullH };
      L.panels = { left: lp, right: rp };
      const keysH = 134 * uu;
      hud.uu = uu;
      hud.score = { x: lp.x, y: lp.y, w: pw, h: 150 * uu };
      hud.best = { x: lp.x, y: lp.y + 162 * uu, w: pw, h: 72 * uu };
      hud.level = { x: lp.x, y: lp.y + 246 * uu, w: pw * 0.56, h: 66 * uu };
      hud.mult = { cx: lp.x + pw - 40 * uu, cy: lp.y + 246 * uu + 33 * uu, r: 38 * uu };
      const mt = lp.y + 326 * uu;
      hud.mascotL = { x: lp.x, y: mt, w: pw, h: Math.max(0, lp.y + lp.h - keysH - 8 * uu - mt) };
      // the ten minute goodbye (SPEC 9.2): the notice stage is the free space left of the table (the quiet mascot zone of the left panel
      // plus the window margin next to it); the 'last ball' badge is one more card in the left column, right under the level pill
      const nx0 = Math.max(4, Math.round(m * 0.5)), nTop = mt - 6 * uu, nBot = lp.y + lp.h - keysH - 8 * uu;
      hud.notice = { x: nx0, y: nTop, w: Math.max(40, lp.x + pw - nx0), h: Math.max(40, nBot - nTop) };
      hud.badge = { x: lp.x, y: mt, w: pw, h: Math.min(Math.max(92 * uu, 56), Math.max(30, nBot - mt)) };
      const bs = 46 * uu, bg = 10 * uu, bw = 4 * bs + 3 * bg, bx0 = rp.x + (pw - bw) / 2;
      hud.buttons = btnIds.map((id, i) => ({ id: id, cx: bx0 + bs / 2 + i * (bs + bg), cy: rp.y + bs / 2, r: bs / 2 }));
      hud.balls = { x: rp.x, y: rp.y + 60 * uu, w: pw, h: 96 * uu };
      hud.fruit = { x: rp.x, y: rp.y + 168 * uu, w: pw, h: 74 * uu };
      hud.chips = [
        { x: rp.x, y: rp.y + 254 * uu, w: pw, h: 60 * uu },
        { x: rp.x, y: rp.y + 322 * uu, w: pw, h: 60 * uu }
      ];
      const rt = rp.y + 396 * uu;
      hud.mascotR = { x: rp.x, y: rt, w: pw, h: Math.max(0, rp.y + rp.h - keysH - 8 * uu - rt) };
      const kh = 84 * uu, kcy = lp.y + lp.h - 84 * uu;
      hud.keys = {
        left: { cx: lp.x + pw / 2, cy: kcy, w: 116 * uu, h: kh },
        space: { cx: rp.x + (pw - 294 * uu) / 2 + 88 * uu, cy: kcy, w: 176 * uu, h: kh },
        right: { cx: rp.x + (pw - 294 * uu) / 2 + 176 * uu + 14 * uu + 52 * uu, cy: kcy, w: 104 * uu, h: kh }
      };
      hud.keyLabelY = lp.y + lp.h - 12 * uu;
      hud.keyLabelSize = 16 * uu;
    } else {
      const ui = clamp(Math.min(cw / 420, ch / 860), 0.7, 1.45);
      const bt = Math.round(76 * ui), bb = Math.round((touch ? 116 : 96) * ui);
      const avail = ch - bt - bb - m;
      let s = Math.min((cw - 2 * m) / TW, avail / TH);
      s = Math.max(s, sFull * 0.74);
      const tw = TW * s, th = TH * s;
      const tx = (cw - tw) / 2;
      const ty = th <= avail ? bt + (avail - th) / 2 + m / 2 : clamp((ch - th) / 2, 0, Math.max(0, ch - th));
      L.scale = s; L.ui = ui; L.uu = ui;
      L.table = { x: tx, y: ty, w: tw, h: th };
      L.panels = { top: { x: 0, y: 0, w: cw, h: bt }, bottom: { x: 0, y: ch - bb, w: cw, h: bb } };
      hud.uu = ui;
      const bs = Math.min(clamp(Math.round(bt * 0.46), 30, 46), Math.floor((bt - 14) / 2)), gridW = 2 * bs + 6;   // the grid lines up with the score card
      const bx = cw - m - gridW, by = (bt - (2 * bs + 6)) / 2;
      hud.buttons = btnIds.map((id, i) => ({ id: id, cx: bx + bs / 2 + (i % 2) * (bs + 6), cy: by + bs / 2 + Math.floor(i / 2) * (bs + 6), r: bs / 2 }));
      const rowW = cw - 2 * m - gridW - 12;
      const sw = Math.round(rowW * 0.5);
      hud.score = { x: m, y: 4, w: sw, h: bt - 8 };
      hud.balls = { x: m + sw + 6, y: 4, w: rowW - sw - 6, h: bt - 8 };
      hud.level = { x: hud.balls.x + hud.balls.w * 0.5, y: 4 + (bt - 8) * 0.56, w: hud.balls.w * 0.5, h: (bt - 8) * 0.4 };
      // goodbye notice: a card over the score and balls row (the four small buttons stay visible); the badge replaces the balls card
      hud.notice = { x: m, y: 4, w: rowW, h: bt - 8 };
      hud.badge = hud.balls;
      const mr = (bt - 8) * 0.3;
      hud.mult = { cx: hud.score.x + hud.score.w - mr * 0.8, cy: hud.score.y + hud.score.h - mr * 0.45, r: mr };
      hud.chipsOverlay = true;
      hud.chips = [
        { x: tx + tw * 0.1, y: ty + 4, w: tw * 0.8, h: 40 * ui },
        { x: tx + tw * 0.1, y: ty + 4 + 46 * ui, w: tw * 0.8, h: 40 * ui }
      ];
      // two timers at once sit side by side, so the row stays above the rollover lanes
      hud.chipsPair = [
        { x: tx + tw * 0.03, y: ty + 4, w: tw * 0.465, h: 40 * ui },
        { x: tx + tw * 0.505, y: ty + 4, w: tw * 0.465, h: 40 * ui }
      ];
      const kcy = ch - bb * 0.5 - 8 * ui;
      if (touch) {
        const kh = Math.round(bb * 0.56), sideW = Math.round(cw * 0.27), midW = Math.round(cw * 0.34);
        hud.keys = {
          left: { cx: m + sideW / 2, cy: kcy, w: sideW, h: kh },
          space: { cx: cw / 2, cy: kcy, w: midW, h: kh },
          right: { cx: cw - m - sideW / 2, cy: kcy, w: sideW, h: kh }
        };
      } else {
        const kh = Math.round(64 * ui), aw = Math.round(clamp(88 * ui, 50, cw * 0.22)), spw = Math.round(clamp(190 * ui, 100, cw * 0.4)), kg = Math.round(14 * ui);
        const total = aw + kg + spw + kg + aw, x0 = (cw - total) / 2;
        hud.keys = {
          left: { cx: x0 + aw / 2, cy: kcy, w: aw, h: kh },
          space: { cx: x0 + aw + kg + spw / 2, cy: kcy, w: spw, h: kh },
          right: { cx: x0 + aw + kg + spw + kg + aw / 2, cy: kcy, w: aw, h: kh }
        };
      }
      hud.keyLabelY = ch - 8 * ui;
      hud.keyLabelSize = 13 * ui;
    }

    // small round buttons first (a press on them must win), a little bigger than they look when fingers are used
    const grow = touch ? 4 : 0;
    for (const b of hud.buttons) pushBtn(b.id, b.cx - b.r - grow, b.cy - b.r - grow, b.r * 2 + 2 * grow, b.r * 2 + 2 * grow);
    // touch zones for the two flippers and the launch key: they tile, so no press is ever in two of them
    if (touch) {
      const k = hud.keys;
      if (wide) {
        const lp = L.panels.left, rp = L.panels.right;
        const kt = Math.min(k.left.cy, k.space.cy) - k.left.h * 1.15, split = (k.space.cx + k.space.w / 2 + k.right.cx - k.right.w / 2) / 2;
        pushBtn('left', lp.x, kt, lp.w, ch - kt);
        pushBtn('launch', rp.x, kt, split - rp.x, ch - kt);
        pushBtn('right', split, kt, rp.x + rp.w - split, ch - kt);
      } else {
        const y0 = k.left.cy - k.left.h * 0.9 - 8, h0 = ch - y0;
        pushBtn('left', 0, y0, cw * 0.33, h0);
        pushBtn('launch', cw * 0.33, y0, cw * 0.34, h0);
        pushBtn('right', cw * 0.67, y0, cw * 0.33, h0);
      }
    }
    return L;
  }

  // ------------------------------------------------------------------------------------------------------------
  // PARTICLES: a fixed pool (struct of arrays, no allocation while playing). Kinds:
  const K_SPARKLE = 0, K_CONFETTI = 1, K_RING = 2, K_STAR = 3, K_CRUMB = 4, K_NOTE = 5, K_BUBBLE = 6, K_HEART = 7;
  const POOL = Math.max(64, (CFG && CFG.MAX_PARTICLES) || 60);
  function makePool() {
    return {
      n: 0,
      kind: new Uint8Array(POOL), sp: new Uint8Array(POOL), shape: new Uint8Array(POOL),
      x: new Float32Array(POOL), y: new Float32Array(POOL), vx: new Float32Array(POOL), vy: new Float32Array(POOL),
      age: new Float32Array(POOL), life: new Float32Array(POOL), size: new Float32Array(POOL),
      rot: new Float32Array(POOL), vr: new Float32Array(POOL), ph: new Float32Array(POOL),
      color: new Array(POOL).fill('#FFFFFF')
    };
  }

  // Text helper: one place for font, fill, optional soft outline. o: {weight,color,align,base,outline,outlineW,alpha,maxW}
  function drawText(ctx, s, x, y, size, o) {
    o = o || {};
    if (o.alpha != null && o.alpha <= 0.003) return;
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.font = fontOf(size, o.weight || 600);
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.base || 'alphabetic';
    let sz = size;
    if (o.maxW) {
      const w = ctx.measureText(s).width;
      if (w > o.maxW) { sz = size * o.maxW / w; ctx.font = fontOf(sz, o.weight || 600); }
    }
    if (o.outline) {
      ctx.lineJoin = 'round'; ctx.lineWidth = o.outlineW || sz * 0.18; ctx.strokeStyle = o.outline;
      ctx.strokeText(s, x, y);
    }
    ctx.fillStyle = o.color || '#FFF8E7';
    ctx.fillText(s, x, y);
    ctx.restore();
    return sz;
  }

  // ------------------------------------------------------------------------------------------------------------
  // THE RENDERER
  function create(canvas, game) {
    const ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
    const SPR = PM.Sprites || {};
    const C = palette();
    const T = PM.T || {};
    const TR = T.r || {};
    const table = game.table || (game.world && game.world.table) || PM.Table.build();
    const TW = table.W, TH = table.H;
    const rng = U.rng(4242);
    const perf = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => 0;

    let reduced = false;
    const rmq = g.matchMedia ? g.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (rmq) {
      reduced = !!rmq.matches;
      const onChange = (e) => { reduced = !!e.matches; };
      if (rmq.addEventListener) rmq.addEventListener('change', onChange); else if (rmq.addListener) rmq.addListener(onChange);
    }

    // ---------------------------------------------------------------------------------------------------------
    // art wrappers: use PM.Sprites when it has the function, else a plain shape (so a missing sprite never throws)
    const disc = (x, y, r, col) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = col; ctx.fill(); };
    const ghostOpts = { color: undefined, mood: undefined, look: undefined, squash: undefined, alpha: undefined, t: 0 };   // scratch options for A.ghost under reduced motion
    const A = {
      ball(x, y, r, o) { if (SPR.ball) SPR.ball(ctx, x, y, r, o); else disc(x, y, r, C.ball); },
      pacman(x, y, r, o) {
        if (SPR.pacman) { SPR.pacman(ctx, x, y, r, o); return; }
        const a = ((o && o.mouth != null ? o.mouth : 0.5) * 0.3) * PI, d = (o && o.dir) || 0;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, d + a, d + TAU - a); ctx.closePath(); ctx.fillStyle = C.pacman; ctx.fill();
      },
      pacmanBig(x, y, r, o) { if (SPR.pacmanBig) SPR.pacmanBig(ctx, x, y, r, o); else A.pacman(x, y, r, { mouth: 0.6, dir: -PI / 2 }); },
      ghost(x, y, r, o) {
        if (SPR.ghost) {
          if (reduced && o) {   // reduced motion: freeze the ghost clock (skirt waves, bob, sway, orbiting stars); faces and the eye look stay
            const q = ghostOpts;
            q.color = o.color; q.mood = o.mood; q.look = o.look; q.squash = o.squash; q.alpha = o.alpha; q.t = 0;
            SPR.ghost(ctx, x, y, r, q); return;
          }
          SPR.ghost(ctx, x, y, r, o); return;
        }
        const col = (o && o.mood === 'blue') ? C.ghostBlue : (C.ghost[(o && o.color) || 'red'] || C.ghost.red);
        ctx.beginPath(); ctx.arc(x, y, r, PI, TAU); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
        disc(x - r * 0.35, y - r * 0.1, r * 0.2, '#fff'); disc(x + r * 0.35, y - r * 0.1, r * 0.2, '#fff');
      },
      fruit(kind, x, y, r, o) { if (SPR.fruit) SPR.fruit(ctx, kind, x, y, r, o); else disc(x, y, r * 0.8, '#FF6B6B'); },
      dot(x, y, r, o) { if (SPR.dot) SPR.dot(ctx, x, y, r, o); else disc(x, y, r, C.dot); },
      pellet(x, y, r, o) { if (SPR.pellet) SPR.pellet(ctx, x, y, r, o); else disc(x, y, r, C.pellet); },
      star(x, y, r, o) { if (SPR.star) SPR.star(ctx, x, y, r, o); else disc(x, y, r * 0.8, (o && o.color) || C.accent); },
      heart(x, y, r, o) { if (SPR.heart) SPR.heart(ctx, x, y, r, o); else disc(x, y, r * 0.8, '#FF7FA8'); },
      sparkle(x, y, r, o) { if (SPR.sparkle) SPR.sparkle(ctx, x, y, r, o); else disc(x, y, r * 0.4, '#FFF6D0'); },
      confetti(x, y, r, o) { if (SPR.confetti) SPR.confetti(ctx, x, y, r, o); else disc(x, y, r * 0.5, (o && o.color) || C.accent2); },
      balloon(x, y, r, o) { if (SPR.balloon) SPR.balloon(ctx, x, y, r, o); else disc(x, y, r, (o && o.color) || C.accent2); },
      crown(x, y, r, o) { if (SPR.crown) SPR.crown(ctx, x, y, r, o); else disc(x, y, r * 0.7, '#FFCF3F'); },
      trophy(x, y, r, o) { if (SPR.trophy) SPR.trophy(ctx, x, y, r, o); else disc(x, y, r * 0.7, '#FFCF3F'); },
      question(x, y, r, o) {
        if (SPR.questionBlock) { SPR.questionBlock(ctx, x, y, r, o); return; }
        rr(ctx, x - r, y - r, 2 * r, 2 * r, r * 0.3); ctx.fillStyle = '#FFD84A'; ctx.fill();
        drawText(ctx, '?', x, y, r * 1.3, { align: 'center', base: 'middle', color: '#7A4300', weight: 700 });
      },
      keycap(x, y, w, h, label, o) {
        if (SPR.keycap) { SPR.keycap(ctx, x, y, w, h, label, o); return; }
        rr(ctx, x - w / 2, y - h / 2, w, h, h * 0.24); ctx.fillStyle = (o && o.pressed) ? C.accent : '#FFF8E7'; ctx.fill();
        drawText(ctx, String(label), x, y, h * 0.4, { align: 'center', base: 'middle', color: C.ink, weight: 700 });
      },
      icon(name, x, y, size, o) {
        if (SPR.icon) { SPR.icon(ctx, name, x, y, size, o); return; }
        ctx.beginPath(); ctx.arc(x, y, size * 0.35, 0, TAU); ctx.strokeStyle = (o && o.color) || C.text; ctx.lineWidth = 2; ctx.stroke();
      },
      // the Pacman ball (SPEC 9.1); PM.Sprites.ball stays as the fallback
      ballPac(x, y, r, o) { if (SPR.pacmanBall) SPR.pacmanBall(ctx, x, y, r, o); else if (SPR.ball) SPR.ball(ctx, x, y, r, o); else disc(x, y, r, C.pacman); },
      wave(x, y, r, o) {
        if (SPR.pacmanWave) { SPR.pacmanWave(ctx, x, y, r, o); return; }
        A.pacman(x, y, r, { mouth: 0.5, dir: 0, mood: 'happy' });
      },
      clock(x, y, r, o) { if (SPR.clock) SPR.clock(ctx, x, y, r, o); else { disc(x, y, r * 0.85, '#FF8DB5'); disc(x, y, r * 0.65, '#FFF8E7'); } },
      speech(x, y, w, h, o) { if (SPR.speech) SPR.speech(ctx, x, y, w, h, o); else { rr(ctx, x - w / 2, y - h / 2, w, h, h * 0.3); ctx.fillStyle = '#FFF8E7'; ctx.fill(); } },
      shadow(x, y, rx, ry, a) { if (SPR.shadow) SPR.shadow(ctx, x, y, rx, ry, a); },
      zzz(x, y, size, o) { if (SPR.zzz) SPR.zzz(ctx, x, y, size, o); }
    };

    // ---------------------------------------------------------------------------------------------------------
    // view state
    let cw = 0, ch = 0, dpr = 1;
    let layout = null;
    let touchMode = false;
    let lastNow = null, now = 0, dt = 0.016;
    let st = null, world = null;
    let quality = 2;
    let cacheKey = '';
    let tableCache = null, bgCanvas = null, tileCanvas = null, tilePattern = null, tileKey = '';
    let logoCanvas = null, logoKey = '';
    let sprPx = 0;                    // device pixels per table unit the sprite caches were built for
    let dotImg = null, dotHalf = 0;
    const glowCache = new Map();
    const errCount = {};
    const stats = { ms: 0, fps: 60, particles: 0, quality: 2 };

    // animation state
    let dispScore = 0, lastScore = 0, scorePop = 0, multPop = 0, lastMult = 1;
    let lastScreen = '', screenT0 = 0, lastDots = -1, chompT = 0, hopT = 0, lastLevel = 1, levelPop = 0;
    const lampLit = [0, 0, 0], lampPop = [0, 0, 0], lampWas = [false, false, false];
    const chipAnim = { power: 0, surprise: 0 };
    const chipLast = { power: null, surprise: null };
    let noriShow = 0, mysteryK = 1;
    let hintShow = 0;
    let guardShow = 0;
    let starPingDone = 0;
    let overSpawn = 0;
    // ten minute goodbye (SPEC 9.2): renderer side animation state
    const lim = { phase: 'none', t0: 0, noticeSeen: false, lastPoke: -1, pokeT: 0, ph: 0, blinkT: 0, gbX: 0, gbY: 0, gbR: 0, gbOn: false };
    const fitCache = new Map();
    let ambientT = 0;
    const trails = new Map();
    let trailPrune = 0;
    const pickState = new Map();
    const fx = makePool();
    const fruitList = [];
    const roam = { nextAt: 12, active: null, ghostNext: 30, ghost: null };
    let perfEma = 16, cpuEma = 4, perfBad = 0, perfGood = 0;

    const render = {
      layout: null, quality: 2, stats: stats,
      resize: resize, draw: draw,
      invalidate() { cacheKey = ''; logoKey = ''; fitCache.clear(); },
      // facing, chomp phase and calm level of a ball as drawn (for tests); null when unknown
      // the goodbye animation state (for tests): phase as read, hop timer, Pacman's place on the goodbye screen in window px
      limitInfo() { return { phase: lim.phase, pokeT: lim.pokeT, noticeSeen: lim.noticeSeen, gbOn: lim.gbOn, x: lim.gbX, y: lim.gbY, r: lim.gbR }; },
      ballInfo(id) { const t = trails.get(id); return t ? { dir: t.fa, phase: t.ph, calm: t.calm, mouth: t.mouth } : null; },
      get reducedMotion() { return reduced; }
    };

    // ---------------------------------------------------------------------------------------------------------
    // caches that depend on the pixel size
    function glowImg(color, r, ppu) {
      const key = color + '|' + r + '|' + ppu;
      let im = glowCache.get(key);
      if (im) return im;
      const px = Math.max(4, Math.ceil(2 * r * ppu));
      im = mkCanvas(px, px);
      const c = im.getContext('2d');
      const rgb = hexRgb(color) || [255, 240, 207];
      const gr = c.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
      const base = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',';
      gr.addColorStop(0, base + '1)'); gr.addColorStop(0.35, base + '0.55)'); gr.addColorStop(0.7, base + '0.16)'); gr.addColorStop(1, base + '0)');
      c.fillStyle = gr; c.fillRect(0, 0, px, px);
      glowCache.set(key, im);
      return im;
    }
    // draws a cached soft glow centred on x,y (table units when ppu = sprPx, CSS px when ppu = dpr)
    function glow(color, x, y, r, alpha, ppu) {
      if (alpha <= 0.004) return;
      const im = glowImg(color, r, ppu || sprPx);
      const ga = ctx.globalAlpha;
      ctx.globalAlpha = ga * Math.min(1, alpha);
      ctx.drawImage(im, x - r, y - r, 2 * r, 2 * r);
      ctx.globalAlpha = ga;
    }
    function buildSpriteCaches(k) {
      sprPx = k;
      glowCache.clear();
      // the dots: drawn 50 times a frame, so they come from a pre-rendered image
      const halo = 6.6;
      dotHalf = halo;
      const px = Math.ceil(2 * halo * k) + 2;
      dotImg = mkCanvas(px, px);
      const c = dotImg.getContext('2d');
      c.translate(px / 2, px / 2); c.scale(k, k);
      if (SPR.dot) SPR.dot(c, 0, 0, 3.5, { color: C.dot });
      else { c.beginPath(); c.arc(0, 0, 3.5, 0, TAU); c.fillStyle = C.dot; c.fill(); }
      dotImg._units = px / k;
    }

    // ---------------------------------------------------------------------------------------------------------
    // size and layout
    function resize() {
      const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      const w = (rect && rect.width) || g.innerWidth || 800;
      const h = (rect && rect.height) || g.innerHeight || 600;
      const d = clamp(g.devicePixelRatio || 1, 1, 2);
      const W = Math.max(2, Math.round(w)), H = Math.max(2, Math.round(h));
      const bw = Math.round(W * d), bh = Math.round(H * d);
      const changed = canvas.width !== bw || canvas.height !== bh;
      if (changed) { canvas.width = bw; canvas.height = bh; }
      cw = W; ch = H; dpr = d;
      relayout();
      if (changed && lastNow != null) draw(lastNow);   // the canvas was cleared: repaint at once so nothing flickers
    }
    function relayout() {
      const s = game.state;
      touchMode = !!(isObj(s) && isObj(s.ui) && s.ui.touch);
      layout = computeLayout(cw, ch, touchMode);
      layout.dpr = dpr;
      render.layout = layout;
      cacheKey = '';
    }
    function ensureCaches() {
      const key = [layout.scale.toFixed(4), dpr, cw, ch].join('|');
      if (key === cacheKey && tableCache) return;
      cacheKey = key;
      const k = layout.scale * dpr;
      tableCache = mkCanvas((TW + 2 * CACHE_M) * k, (TH + 2 * CACHE_M) * k);
      const c = tableCache.getContext('2d');
      c.setTransform(k, 0, 0, k, CACHE_M * k, CACHE_M * k);
      try { paintTable(c, table, C, layout.scale, dpr); } catch (e) { if (console) console.error('[render] table art:', e); }
      buildSpriteCaches(k);
      buildBackdrop();
    }

    // ---------------------------------------------------------------------------------------------------------
    // backdrop: cached gradient, a very quiet moving dot and maze pattern, roaming delights
    const TILE = 168;
    function buildBackdrop() {
      bgCanvas = mkCanvas(cw * dpr, ch * dpr);
      const c = bgCanvas.getContext('2d');
      c.scale(dpr, dpr);
      const g1 = c.createLinearGradient(0, 0, 0, ch);
      g1.addColorStop(0, C.bg0); g1.addColorStop(0.55, C.bg1); g1.addColorStop(1, '#1D1D5A');
      c.fillStyle = g1; c.fillRect(0, 0, cw, ch);
      const rad = Math.max(cw, ch) * 0.62;
      const g2 = c.createRadialGradient(cw / 2, ch * 0.5, 0, cw / 2, ch * 0.5, rad);
      g2.addColorStop(0, 'rgba(98,86,232,0.30)'); g2.addColorStop(0.55, 'rgba(70,64,190,0.09)'); g2.addColorStop(1, 'rgba(70,64,190,0)');
      c.fillStyle = g2; c.fillRect(0, 0, cw, ch);
      const g3 = c.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
      g3.addColorStop(0, 'rgba(4,6,26,0)'); g3.addColorStop(1, 'rgba(4,6,26,0.45)');
      c.fillStyle = g3; c.fillRect(0, 0, cw, ch);

      tileCanvas = mkCanvas(TILE * dpr, TILE * dpr);
      const t = tileCanvas.getContext('2d');
      t.scale(dpr, dpr);
      t.fillStyle = 'rgba(255,240,207,0.06)';
      for (let y = 14; y < TILE; y += 28) for (let x = 14; x < TILE; x += 28) { t.beginPath(); t.arc(x, y, 1.7, 0, TAU); t.fill(); }
      t.strokeStyle = 'rgba(154,166,247,0.05)'; t.lineWidth = 2.2; t.lineCap = 'round'; t.lineJoin = 'round';
      rr(t, 28, 28, 56, 28, 12); t.stroke();
      rr(t, 98, 70, 44, 56, 14); t.stroke();
      t.beginPath(); t.moveTo(28, 98); t.lineTo(28, 140); t.lineTo(70, 140); t.stroke();
      t.beginPath(); t.moveTo(112, 28); t.lineTo(140, 28); t.stroke();
      tilePattern = ctx.createPattern(tileCanvas, 'repeat');
    }

    function spawnRoam() {
      if (!layout) return;
      const side = layout.mode === 'side';
      if (roam.active || quality < 1 || reduced) return;
      if (side && now >= roam.nextAt) {
        roam.active = { t0: now, dur: 17, y: ch * (0.2 + 0.62 * rng()), dir: rng() < 0.5 ? 1 : -1, r: 19 * layout.ui };
        roam.nextAt = now + 55 + rng() * 30;
      }
      if (side && !roam.ghost && now >= roam.ghostNext) {
        const t = layout.table, pw = layout.panels.left.w;
        const margin = layout.panels.left.x - 4;
        if (margin >= 46 * layout.ui) {
          const left = rng() < 0.5;
          roam.ghost = { t0: now, dur: 8.5, left: left, x: left ? margin * 0.5 : cw - margin * 0.5, y: t.y + t.h * (0.55 + 0.3 * rng()), r: Math.min(margin * 0.36, 30 * layout.ui), color: rng.pick(['red', 'pink', 'cyan', 'orange']) };
        }
        roam.ghostNext = now + 48 + rng() * 30;
      }
    }

    function drawBackdrop() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.drawImage(bgCanvas, 0, 0);
      if (tilePattern) {
        const anim = quality >= 2 && !reduced && st.screen !== 'paused';
        const ox = anim ? (now * 4.5 * dpr) % (TILE * dpr) : 0;
        const oy = anim ? (now * 2.7 * dpr) % (TILE * dpr) : 0;
        ctx.save();
        ctx.translate(ox, oy);
        ctx.fillStyle = tilePattern;
        ctx.fillRect(-ox, -oy, canvas.width, canvas.height);
        ctx.restore();
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (st.limPhase === 'notice') return;   // the notice has its own Pacman: no second one running across the same corner
      if (Array.isArray(st.delights)) drawDelights(); else drawRoam();
    }

    // roaming friends that the game schedules: x,y are fractions of the window, size is a fraction of its height
    function drawDelights() {
      const list = st.delights;
      if (quality < 1 || reduced || !list.length) return;
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        if (!isObj(d) || !isFinite(d.x) || !isFinite(d.y)) continue;
        const x = d.x * cw, y = d.y * ch, r = clamp(fin(d.size, 0.05) * ch * (layout.mode === 'tall' ? 0.7 : 1), 10, (layout.mode === 'tall' ? 30 : 46) * layout.ui);
        if (d.kind === 'pacman') {
          const dir = d.dir > 0 ? 1 : -1, step = 38 * layout.ui;
          ctx.globalAlpha = 0.85;
          for (let k = 1; k < 30; k++) {
            const dx = x + dir * (r + k * step - ((dir > 0 ? x : -x) % step));
            if (dx < -10 || dx > cw + 10) continue;
            disc(dx, y, 2.6 * layout.ui, 'rgba(255,240,207,0.5)');
          }
          A.pacman(x, y, r, { mouth: reduced ? 0.5 : 0.5 + 0.5 * sin(now * 8.5), dir: dir > 0 ? 0 : PI, mood: 'happy' });
          ctx.globalAlpha = 1;
        } else {
          const left = d.side === 'left';
          ctx.save();
          ctx.globalAlpha = 0.9;
          ctx.translate(x, y + r); ctx.rotate(reduced ? 0 : sin(now * 5.2) * 0.13); ctx.translate(-x, -(y + r));
          A.ghost(x, y, r, { color: d.color || 'pink', mood: 'happy', look: { x: left ? 1 : -1, y: 0.2 }, t: now });
          ctx.restore();
        }
      }
    }

    function drawRoam() {
      const a = roam.active;
      if (a) {
        const u = (now - a.t0) / a.dur;
        if (u >= 1) roam.active = null;
        else {
          const x = a.dir > 0 ? lerp(-40, cw + 40, u) : lerp(cw + 40, -40, u);
          ctx.globalAlpha = 0.85;
          // a trail of little dots that he eats on the way
          const step = 38 * layout.ui;
          for (let i = 1; i < 30; i++) {
            const dx = x + a.dir * (a.r + i * step - ((a.dir > 0 ? x : -x) % step));
            if (dx < -10 || dx > cw + 10) continue;
            disc(dx, a.y, 2.6 * layout.ui, 'rgba(255,240,207,0.5)');
          }
          A.pacman(x, a.y, a.r, { mouth: reduced ? 0.5 : 0.5 + 0.5 * sin(now * 8.5), dir: a.dir > 0 ? 0 : PI, mood: 'happy' });
          ctx.globalAlpha = 1;
        }
      }
      const gh = roam.ghost;
      if (gh) {
        const e = now - gh.t0;
        if (e >= gh.dur) roam.ghost = null;
        else {
          const inn = smooth(e / 1.2), out = smooth((gh.dur - e) / 1.2);
          const k = min(inn, out);
          const off = (1 - k) * (gh.r * 2.6) * (gh.left ? -1 : 1);
          ctx.save();
          ctx.globalAlpha = 0.9 * min(1, k * 2);
          const gx = gh.x + off, gy = gh.y;
          ctx.translate(gx, gy + gh.r);
          ctx.rotate(reduced ? 0 : sin(now * 5.2) * 0.13);
          ctx.translate(-gx, -(gy + gh.r));
          A.ghost(gx, gy, gh.r, { color: gh.color, mood: 'happy', look: { x: gh.left ? 1 : -1, y: 0.2 }, t: now });
          ctx.restore();
        }
      }
    }

    // ---------------------------------------------------------------------------------------------------------
    // particles
    function fxColor(c, def) {
      if (typeof c === 'string') {
        if (c.charAt(0) === '#' || c.indexOf('rgb') === 0) return c;
        if (C.ghost[c]) return C.ghost[c];
        const nm = { yellow: '#FFD84A', gold: '#FFD84A', mint: '#8EE3A9', lilac: '#B79BFF', cream: '#FFF0CF', blue: C.ghostBlue };
        if (nm[c]) return nm[c];
      }
      return def;
    }
    function fxLimit() {
      const base = reduced ? POOL * 0.5 : Math.min(POOL, (CFG && CFG.MAX_PARTICLES) || 60);
      return Math.floor(quality >= 2 ? base : (quality === 1 ? base * 0.66 : base * 0.33));
    }
    function padd(kind, sp, x, y, vx, vy, life, size, color, shape, rot, vr) {
      if (fx.n >= fxLimit()) return -1;
      const i = fx.n++;
      fx.kind[i] = kind; fx.sp[i] = sp; fx.shape[i] = shape | 0;
      fx.x[i] = x; fx.y[i] = y; fx.vx[i] = vx; fx.vy[i] = vy;
      fx.age[i] = 0; fx.life[i] = life; fx.size[i] = size;
      fx.rot[i] = reduced ? 0 : rot; fx.vr[i] = reduced ? 0 : vr; fx.ph[i] = rng() * TAU;
      fx.color[i] = color;
      return i;
    }
    function premove(i) {
      const l = --fx.n;
      if (i === l) return;
      fx.kind[i] = fx.kind[l]; fx.sp[i] = fx.sp[l]; fx.shape[i] = fx.shape[l];
      fx.x[i] = fx.x[l]; fx.y[i] = fx.y[l]; fx.vx[i] = fx.vx[l]; fx.vy[i] = fx.vy[l];
      fx.age[i] = fx.age[l]; fx.life[i] = fx.life[l]; fx.size[i] = fx.size[l];
      fx.rot[i] = fx.rot[l]; fx.vr[i] = fx.vr[l]; fx.ph[i] = fx.ph[l]; fx.color[i] = fx.color[l];
    }
    // sp = 0 table units, 1 window (CSS px)
    function emit(f, sp) {
      if (!f) return;
      const x = +f.x || 0, y = +f.y || 0, rm = reduced ? 0.5 : 1;
      const n = Math.min(14, Math.max(1, Math.round((f.n == null ? 6 : f.n) * rm)));
      const sc = sp ? layout.ui * 1.9 : 1;
      switch (f.type) {
        case 'confetti': {
          const fc = fxColor(f.color, null), cols = (fc && fc.toUpperCase() !== '#FFD84A') ? [fc] : C.balloons;
          for (let i = 0; i < n; i++) {
            const a = -PI / 2 + (rng() - 0.5) * 2.2, s = (70 + rng() * 110) * sc;
            padd(K_CONFETTI, sp, x, y, cos(a) * s, sin(a) * s, 1.5 + rng() * 0.9, (3.6 + rng() * 2.2) * sc, cols[rng.int(cols.length)], rng.int(4), rng() * TAU, (rng() - 0.5) * 6);
          }
          break;
        }
        case 'ring':
          padd(K_RING, sp, x, y, 0, 0, 0.75, (f.r || 30) * sc, fxColor(f.color, '#FFF3C4'), 0, 0, 0);
          break;
        case 'pop': {
          const col = fxColor(f.color, C.accent2);
          padd(K_RING, sp, x, y, 0, 0, 0.5, 26 * sc, col, 0, 0, 0);
          for (let i = 0; i < n; i++) {
            const a = rng() * TAU, s = (70 + rng() * 80) * sc;
            padd(K_CRUMB, sp, x, y, cos(a) * s, sin(a) * s, 0.42 + rng() * 0.2, (2.4 + rng() * 1.6) * sc, col, 0, 0, 0);
          }
          break;
        }
        case 'chomp': {
          padd(K_RING, sp, x, y, 0, 0, 0.42, 20 * sc, fxColor(f.color, '#FFF0CF'), 0, 0, 0);
          for (let i = 0; i < Math.min(n, 5); i++) {
            const a = rng() * TAU, s = (35 + rng() * 45) * sc;
            padd(K_CRUMB, sp, x, y, cos(a) * s, sin(a) * s, 0.36, (1.8 + rng() * 1.2) * sc, '#FFF0CF', 0, 0, 0);
          }
          break;
        }
        case 'stars': {
          const col = fxColor(f.color, C.accent);
          for (let i = 0; i < n; i++) padd(K_STAR, sp, x + (rng() - 0.5) * 26 * sc, y + (rng() - 0.5) * 10 * sc, (rng() - 0.5) * 26 * sc, (-30 - rng() * 30) * sc, 1.2 + rng() * 0.6, (7 + rng() * 4) * sc, col, 0, (rng() - 0.5) * 0.6, (rng() - 0.5) * 1.2);
          break;
        }
        case 'heart': {
          const col = fxColor(f.color, '#FF7FA8');
          for (let i = 0; i < Math.min(n, 6); i++) padd(K_HEART, sp, x + (rng() - 0.5) * 20 * sc, y, (rng() - 0.5) * 24 * sc, (-34 - rng() * 26) * sc, 1.3 + rng() * 0.5, (6 + rng() * 3) * sc, col, 0, 0, 0);
          break;
        }
        default: {   // 'sparkle' and anything unknown
          const col = fxColor(f.color, '#FFF3C4');
          for (let i = 0; i < n; i++) {
            const a = rng() * TAU, s = (16 + rng() * 40) * sc;
            padd(K_SPARKLE, sp, x + cos(a) * 4 * sc, y + sin(a) * 4 * sc, cos(a) * s, sin(a) * s - 8 * sc, 0.6 + rng() * 0.5, (4 + rng() * 4.5) * sc, col, 0, rng() * PI, 0);
          }
        }
      }
    }
    function updateFx() {
      for (let i = fx.n - 1; i >= 0; i--) {
        fx.age[i] += dt;
        if (fx.age[i] >= fx.life[i]) { premove(i); continue; }
        const k = fx.kind[i];
        if (k === K_CONFETTI) {
          const sc = fx.sp[i] ? layout.ui * 1.9 : 1;
          fx.vy[i] += 150 * sc * dt; fx.vx[i] *= 1 - min(1, 1.4 * dt);
          if (fx.vy[i] > 90 * sc) fx.vy[i] = 90 * sc;   // flutters down slowly
        } else if (k === K_SPARKLE || k === K_CRUMB) {
          const d = 1 - min(1, 2.2 * dt); fx.vx[i] *= d; fx.vy[i] *= d;
        } else if (k === K_BUBBLE) {
          fx.vx[i] = reduced ? 0 : sin(now * 1.3 + fx.ph[i]) * 8;
        }
        fx.x[i] += fx.vx[i] * dt; fx.y[i] += fx.vy[i] * dt; fx.rot[i] += fx.vr[i] * dt;
      }
      stats.particles = fx.n;
    }
    function drawFx(space) {
      for (let i = 0; i < fx.n; i++) {
        if (fx.sp[i] !== space) continue;
        const u = fx.age[i] / fx.life[i], x = fx.x[i], y = fx.y[i], s = fx.size[i], col = fx.color[i];
        switch (fx.kind[i]) {
          case K_SPARKLE: {
            const k = sin(clamp(u, 0, 1) * PI);
            ctx.globalAlpha = 0.9 * k;
            A.sparkle(x, y, s * (0.5 + 0.7 * k), { color: col, rot: fx.rot[i] });
            break;
          }
          case K_CONFETTI: {
            ctx.globalAlpha = u > 0.7 ? (1 - u) / 0.3 : 1;
            const shapes = ['rect', 'circle', 'tri', 'ribbon'];
            A.confetti(x, y, s, { color: col, rot: fx.rot[i], shape: shapes[fx.shape[i] & 3], flip: reduced ? 0 : (fx.age[i] * 1.6 + fx.ph[i]) % 1 });
            break;
          }
          case K_RING: {
            const e = easeOutCubic(u);
            ctx.globalAlpha = 0.7 * (1 - u);
            ctx.beginPath(); ctx.arc(x, y, s * (0.25 + 0.75 * e), 0, TAU);
            ctx.strokeStyle = col; ctx.lineWidth = (fx.sp[i] ? 3.4 : 2.8) * (1 - u * 0.6); ctx.stroke();
            break;
          }
          case K_STAR:
            ctx.globalAlpha = u < 0.15 ? u / 0.15 : (u > 0.65 ? (1 - u) / 0.35 : 1);
            A.star(x, y, s, { color: col, rot: fx.rot[i], glow: false });
            break;
          case K_CRUMB:
            ctx.globalAlpha = 0.9 * (1 - u);
            disc(x, y, s * (1 - u * 0.4), col);
            break;
          case K_NOTE:
            ctx.globalAlpha = u < 0.2 ? u / 0.2 : (u > 0.6 ? (1 - u) / 0.4 : 1);
            A.icon('music', x, y, s, { color: col });
            break;
          case K_BUBBLE: {
            ctx.globalAlpha = 0.5 * (u < 0.2 ? u / 0.2 : (u > 0.7 ? (1 - u) / 0.3 : 1));
            ctx.beginPath(); ctx.arc(x, y, s, 0, TAU);
            ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill();
            disc(x - s * 0.38, y - s * 0.4, s * 0.16, 'rgba(255,255,255,0.7)');
            break;
          }
          case K_HEART:
            ctx.globalAlpha = u < 0.15 ? u / 0.15 : (u > 0.6 ? (1 - u) / 0.4 : 1);
            A.heart(x, y, s, { color: col });
            break;
        }
      }
      ctx.globalAlpha = 1;
    }

    // ---------------------------------------------------------------------------------------------------------
    // timers: power, surprise, banner and popups carry {t, dur}; t counts UP (elapsed seconds), as 40_game.js documents.
    // (An earlier version guessed whether t counted up or down. That guess flickered for one frame whenever the game reset
    // a running timer, so the contract is now fixed to "up".)
    function timerInfo(o) {
      const dur = +o.dur > 0 ? +o.dur : 1;
      const el = clamp(+o.t || 0, 0, dur);
      tInfo.el = el; tInfo.rem = dur - el; tInfo.dur = dur; tInfo.u = el / dur;
      return tInfo;
    }
    const tInfo = { el: 0, rem: 0, dur: 1, u: 0 };
    const LOOK = { x: 0, y: 0 }, SQ = { x: 1, y: 1 };
    let frameNo = 0;

    function nearestBall(x, y) {
      let best = null, bd = 1e12;
      if (!world) return null;
      for (let i = 0; i < world.balls.length; i++) {
        const b = world.balls[i];
        if (b.state === 'drained') continue;
        const d = (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y);
        if (d < bd) { bd = d; best = b; }
      }
      return best;
    }
    // direction the eyes should look (length 0..1); mutates and returns LOOK
    function lookAt(x, y, seed) {
      const b = st.screen === 'title' ? null : nearestBall(x, y);
      if (b) {
        const dx = b.x - x, dy = b.y - y, d = Math.sqrt(dx * dx + dy * dy) || 1, k = Math.min(1, d / 140);
        LOOK.x = dx / d * k; LOOK.y = dy / d * k;
      } else {   // nothing to watch: look around slowly
        LOOK.x = sin(now * 0.7 + seed * 2.1) * 0.7; LOOK.y = cos(now * 0.9 + seed * 1.3) * 0.4 + 0.15;
      }
      return LOOK;
    }
    function findGhost(id) {
      const gl = st.ghosts;
      if (!gl) return null;
      for (let i = 0; i < gl.length; i++) { const e = gl[i]; if (isObj(e) && (e.id === id || e.bumperId === id)) return e; }
      return null;
    }

    // ---------------------------------------------------------------------------------------------------------
    // The Pacman ball (SPEC 9.1): which way he faces and how his mouth moves. Called once per frame per ball.
    //  facing  follows a low passed copy of the velocity; below 60 units/s (or while the velocity is near zero on a bounce) the last direction
    //          stays, the turn itself is smoothed and capped (14 rad/s), and a turn of more than about 115 degrees waits 0.13 s to prove it is
    //          real, so a ball that ping-pongs between two posts does not make him rock
    //  chomp   1 Hz when calm (plunger lane, ghost house, almost still) rising to 2.2 Hz at speed; only advances while the game is running
    function updateFace(tr, b) {
      const vx = fin(b.vx, 0), vy = fin(b.vy, 0), sp = sqrt(vx * vx + vy * vy);
      const calmT = (b.state === 'lane' || b.state === 'held' || sp < 60) ? 1 : 0;
      tr.fx += (vx - tr.fx) * (1 - Math.exp(-dt / 0.07)); tr.fy += (vy - tr.fy) * (1 - Math.exp(-dt / 0.07));
      let target = null;
      if (b.state === 'lane') target = -PI / 2;
      else if (b.state === 'play' && sp >= 60 && tr.fx * tr.fx + tr.fy * tr.fy > 1600) target = Math.atan2(tr.fy, tr.fx);
      if (target !== null) {
        let d = U.wrapAngle(target - tr.fa);
        if (abs(d) > 2) {   // a near reversal has to last a moment before he turns round: a ball ping-ponging between two posts must not make him rock
          if (abs(U.wrapAngle(target - tr.cand)) > 0.7) { tr.cand = target; tr.candT = 0; }
          tr.candT += dt;
          if (tr.candT < 0.13) d = 0;
        } else tr.candT = 0;
        const cap = 14 * dt;
        tr.fa = U.wrapAngle(tr.fa + clamp(d * (1 - Math.exp(-dt / 0.06)), -cap, cap));
      }
      tr.calm += (calmT - tr.calm) * (1 - Math.exp(-dt / 0.25));
      if (st.screen === 'play') tr.ph = (tr.ph + dt * lerp(2.2, 1, clamp(1 - (sp - 60) / 600, 0, 1))) % 1;
    }

    // ---------------------------------------------------------------------------------------------------------
    // per frame animation state (nothing here draws)
    function update() {
      const s = st;
      frameNo++;
      if (s.screen !== lastScreen) { lastScreen = s.screen; screenT0 = now; starPingDone = 0; overSpawn = 0; }

      const sc = +s.score || 0;
      if (sc < lastScore - 1) dispScore = sc;                    // a new game
      if (sc > lastScore) { scorePop = 1; hopT = 1; }
      lastScore = sc;
      dispScore += (sc - dispScore) * Math.min(1, dt * 7);
      if (abs(sc - dispScore) < 0.6) dispScore = sc;
      scorePop = Math.max(0, scorePop - dt * 3.2); hopT = Math.max(0, hopT - dt * 2.2);
      const mult = s.multiplier || 1;
      if (mult !== lastMult) { multPop = 1; lastMult = mult; }
      multPop = Math.max(0, multPop - dt * 1.8);
      if ((s.level || 1) !== lastLevel) { levelPop = 1; lastLevel = s.level || 1; }
      levelPop = Math.max(0, levelPop - dt * 1.6);
      if (s.dotsLeft != null) { if (lastDots >= 0 && s.dotsLeft < lastDots) chompT = 0.9; lastDots = s.dotsLeft; }
      chompT = Math.max(0, chompT - dt);

      for (let i = 0; i < 3; i++) {
        const lit = !!(s.lanes && s.lanes[i]);
        if (lit && !lampWas[i]) lampPop[i] = 1;
        lampWas[i] = lit;
        lampLit[i] += ((lit ? 1 : 0) - lampLit[i]) * Math.min(1, dt * 9);
        lampPop[i] = Math.max(0, lampPop[i] - dt * 2.4);
      }

      // chips (power timer, surprise timer): keep the last content so they can fade out
      if (s.power) {
        const ti = timerInfo(s.power);
        chipLast.power = chipLast.power || { rem: 0, dur: 1 };
        chipLast.power.rem = ti.rem; chipLast.power.dur = ti.dur;
      }
      if (s.surprise) {
        const ti = timerInfo(s.surprise);
        chipLast.surprise = chipLast.surprise || { rem: 0, dur: 1, id: '' };
        chipLast.surprise.rem = ti.rem; chipLast.surprise.dur = ti.dur; chipLast.surprise.id = s.surprise.id;
      }
      chipAnim.power += ((s.power ? 1 : 0) - chipAnim.power) * Math.min(1, dt * 8);
      chipAnim.surprise += ((s.surprise ? 1 : 0) - chipAnim.surprise) * Math.min(1, dt * 8);

      noriShow += ((s.nori && s.nori.visible ? 1 : 0) - noriShow) * Math.min(1, dt * 7);
      mysteryK += ((s.mystery && s.mystery.ready === false ? 0 : 1) - mysteryK) * Math.min(1, dt * 5);   // the ? sleeps while it cools down
      const wantHint = s.screen === 'play' && s.launch.waiting && fin(s.launch.idle, 0) > 5.5 && !(fin(s.launch.charge, 0) > 0.02);
      hintShow += ((wantHint ? 1 : 0) - hintShow) * Math.min(1, dt * 6);
      const save = +s.ballSave || 0;
      const wantGuard = save > 0 || (s.surprise && s.surprise.id === 'shield');
      guardShow += ((wantGuard ? 1 : 0) - guardShow) * Math.min(1, dt * 4);

      // balls: trail samples
      if (world) {
        for (let i = 0; i < world.balls.length; i++) {
          const b = world.balls[i];
          if (b.state === 'drained') continue;
          let tr = trails.get(b.id);
          if (!tr) {
            tr = { x: new Float32Array(10), y: new Float32Array(10), n: 0, h: 0, seen: 0,
              fa: -PI / 2, fx: 0, fy: 0, ph: ((+b.id || 0) * 0.37) % 1, calm: 1, mouth: 0.5, cand: 0, candT: 0 };   // face: angle, smoothed velocity, chomp phase, calm level
            trails.set(b.id, tr);
          }
          if (dt > 0) { tr.x[tr.h] = b.x; tr.y[tr.h] = b.y; tr.h = (tr.h + 1) % 10; if (tr.n < 10) tr.n++; updateFace(tr, b); }
          tr.seen = frameNo;
        }
        if (frameNo % 90 === 0) for (const [id, tr] of trails) if (tr.seen < frameNo - 5) trails.delete(id);
      }

      // light effects requested by the game
      if (game.drainFx) {
        const list = game.drainFx();
        if (list && list.length) for (let i = 0; i < list.length; i++) emit(list[i], 0);
      }
      // calm ambient extras for two of the surprises
      ambientT += dt;
      if (s.screen === 'play' && s.surprise && !reduced && quality >= 1 && ambientT > 0.55) {
        ambientT = 0;
        if (s.surprise.id === 'slow') padd(K_BUBBLE, 0, 50 + rng() * 380, 640 + rng() * 260, 0, -20 - rng() * 14, 3.4, 6 + rng() * 7, '#B9C2FF', 0, 0, 0);
        else if (s.surprise.id === 'dance' && s.ghosts && s.ghosts.length) {
          const gg = s.ghosts[rng.int(s.ghosts.length)];
          if (isObj(gg) && isFinite(gg.x) && isFinite(gg.y)) padd(K_NOTE, 0, gg.x + (rng() - 0.5) * 30, gg.y - 36, (rng() - 0.5) * 16, -30, 1.4, 15, rng.pick(C.balloons), 0, 0, 0);
        }
      }
      updateLimit();
      updateFx();
      if (!Array.isArray(s.delights)) spawnRoam();
    }
    function updateLimit() {
      const s = st;
      if (s.limPhase !== lim.phase) {
        lim.phase = s.limPhase; lim.t0 = now;
        if (s.limPhase === 'notice') lim.noticeSeen = true; else if (s.limPhase === 'none') lim.noticeSeen = false;
      }
      if ((s.screen === 'goodbye' || lim.phase !== 'none') && s.screen !== 'paused' && !reduced) lim.ph = (lim.ph + dt * (s.screen === 'goodbye' ? 1 : 1.45)) % 1;   // the hand waves at 1 to 1.5 Hz
      if (s.screen === 'goodbye') {
        if (lim.lastPoke < 0) lim.lastPoke = s.limPoke;
        else if (s.limPoke > lim.lastPoke) {   // a tap or a Space press on the goodbye screen: Pacman hops once and blows a few hearts
          lim.lastPoke = s.limPoke;
          if (lim.pokeT <= 0.05) {   // only when the last hop is over: mashing Space must not make Pacman twitch at the tap rate (at most about 1.7 hops a second)
            lim.pokeT = 1;
            if (lim.gbOn) emit({ type: 'heart', x: lim.gbX + lim.gbR * 1.35, y: lim.gbY - lim.gbR * 0.7, n: 5 }, 1);   // they rise from beside the waving hand
          }
        }
      } else { lim.lastPoke = -1; lim.gbOn = false; }
      lim.pokeT = Math.max(0, lim.pokeT - dt * 1.7);
    }

    // ---------------------------------------------------------------------------------------------------------
    // TABLE LAYER (dynamic objects, in table units)
    function setTableTransform() {
      const k = layout.scale * dpr;
      let ox = layout.table.x * dpr, oy = layout.table.y * dpr, kk = k;
      if (st.screen === 'title' && !reduced) {   // behind the title the table drifts a little
        const sk = 1 + 0.012 * sin(now * 0.19);
        ox += sin(now * 0.3) * 8 * dpr + TW * k * (1 - sk) / 2;
        oy += cos(now * 0.23) * 6 * dpr + TH * k * (1 - sk) / 2;
        kk = k * sk;
      }
      ctx.setTransform(kk, 0, 0, kk, Math.round(ox), Math.round(oy));
    }

    function drawLaneChevrons() {
      const pl = table.plunger, l = st.launch || {};
      const chg = fin(l.charge, 0);
      const active = chg > 0.02;
      ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 0; i < 9; i++) {
        const y = 862 - i * 66;
        let a = 0.09, col = '#B9C2FF';
        if (active) {
          const lit = chg >= (i + 0.35) / 9;
          a = lit ? 0.95 : 0.1; col = lit ? (i < 5 ? '#FFD84A' : '#FF9ECB') : '#B9C2FF';
        } else if (l.waiting) {
          const w = Math.max(0, sin(now * 3.6 - i * 0.75));
          a = 0.09 + 0.36 * w * w; col = '#FFF0CF';
        }
        ctx.globalAlpha = a; ctx.strokeStyle = col;
        ctx.beginPath(); ctx.moveTo(pl.x - 9, y + 5); ctx.lineTo(pl.x, y - 4); ctx.lineTo(pl.x + 9, y + 5); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    function drawPickups() {
      const sensors = world.sensors;
      fruitList.length = 0;
      for (let i = 0; i < sensors.length; i++) {
        const s = sensors[i];
        let ps = pickState.get(s.id);
        if (!ps) { ps = { a: s.active, t: -10 }; pickState.set(s.id, ps); }
        if (s.active && !ps.a) ps.t = now + (i % 64) * 0.014;   // a returning dot pops in, in a soft ripple
        ps.a = s.active;
        if (!s.active) continue;
        const age = now - ps.t;
        if (age < 0) continue;
        const pop = age < 0.4 ? easeOutBack(age / 0.4) : 1;
        if (s.kind === 'dot') {
          if (dotImg) { const w = dotImg._units * pop; ctx.drawImage(dotImg, s.x - w / 2, s.y - w / 2, w, w); }
          else disc(s.x, s.y, 3.5 * pop, C.dot);
        } else if (s.kind === 'pellet') {
          A.pellet(s.x, s.y, 8 * pop, { t: reduced ? 0 : now });
        } else if (s.kind === 'lane') {
          drawLamp(s.x, s.y, (parseInt(s.id.slice(4), 10) || 1) - 1);
        } else if (s.kind === 'fruit') {
          fruitList.push(s);
        }
      }
      // fruits: the fruit spot, or the three fruits of the fruits surprise
      // (the game lists the three surprise fruits as sensors AND in state.fruits: each one is drawn once)
      let main = false;
      for (let i = 0; i < fruitList.length; i++) {
        const s = fruitList[i];
        const kind = str(s.fruitKind, null) || (st.fruit && s.id === 'fruit' ? st.fruit.kind : 'cherry');
        if (s.id === 'fruit') main = true;
        drawFruitAt(kind, s.x, s.y);
      }
      if (!main && st.fruit && isFinite(st.fruit.x) && isFinite(st.fruit.y)) drawFruitAt(st.fruit.kind, st.fruit.x, st.fruit.y);
      if (st.fruits) {
        for (let i = 0; i < st.fruits.length; i++) {
          const f = st.fruits[i];
          if (!isObj(f) || !isFinite(f.x) || !isFinite(f.y)) continue;
          let dup = false;
          for (let j = 0; j < fruitList.length; j++) if (fruitList[j].id === f.id || (abs(fruitList[j].x - f.x) < 4 && abs(fruitList[j].y - f.y) < 4)) dup = true;
          if (!dup) drawFruitAt(f.kind, f.x, f.y);
        }
      }
    }
    function drawFruitAt(kind, x, y) {
      glow('#FFF0CF', x, y, 34, 0.24 + 0.06 * sin(now * 2.4));
      ctx.beginPath(); ctx.arc(x, y, 22, 0, TAU); ctx.strokeStyle = 'rgba(255,240,207,0.28)'; ctx.lineWidth = 1.6; ctx.stroke();
      A.fruit(kind, x, y, 19, { t: reduced ? 0 : now });
    }
    function drawLamp(x, y, idx) {
      const lit = lampLit[idx] || 0, pop = lampPop[idx] || 0;
      ctx.beginPath(); ctx.arc(x, y, 12.5, 0, TAU); ctx.fillStyle = '#1D2568'; ctx.fill();
      if (lit < 0.98) {   // unlit: a soft down chevron says "roll here"
        ctx.globalAlpha = 0.3 * (1 - lit);
        ctx.strokeStyle = '#FFF0CF'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(x - 5, y - 3); ctx.lineTo(x, y + 3); ctx.lineTo(x + 5, y - 3); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (lit > 0.02) {
        glow('#FFD84A', x, y, 30, 0.6 * lit);
        const r = 12.5 * (1 + 0.16 * sin(pop * PI));
        const rg = ctx.createRadialGradient(x - 3, y - 4, 1, x, y, r);
        rg.addColorStop(0, '#FFFBE0'); rg.addColorStop(0.5, '#FFD84A'); rg.addColorStop(1, '#F2B12C');
        ctx.globalAlpha = lit;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = rg; ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.ellipse(x - 4, y - 5, 3.4, 2, -0.7, 0, TAU); ctx.fill();
      }
    }

    function drawFixtures() {
      const el = world.elements || {};
      const dec = table.decor;
      // tunnels: a soft ring and glow when a ball goes through
      if (el.tunnels) {
        for (const m of dec.tunnelMouths) {
          const tg = el.tunnels[m.id] ? el.tunnels[m.id].glow : 0;
          const sx = m.nx > 0 ? 1 : -1;
          if (tg > 0.02) {
            glow('#B79BFF', m.x + sx * 10, m.y, 40, 0.75 * tg);
            ctx.globalAlpha = 0.7 * tg; ctx.strokeStyle = '#D9CCFF'; ctx.lineWidth = 2.4;
            ctx.beginPath(); ctx.ellipse(m.x, m.y, 12 + (1 - tg) * 16, 18 + (1 - tg) * 8, 0, -PI / 2, PI / 2, sx < 0); ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      }
      // gate flap at the top of the shooter lane
      if (table.gates && table.gates[0]) {
        const gt = table.gates[0], op = el.gates && el.gates.gate ? el.gates.gate.open : 0;
        const dx = gt.b.x - gt.a.x, dy = gt.b.y - gt.a.y, a = Math.atan2(dy, dx) - op * 0.7, len = Math.sqrt(dx * dx + dy * dy);
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#FFF0CF'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(gt.a.x, gt.a.y); ctx.lineTo(gt.a.x + cos(a) * len, gt.a.y + sin(a) * len); ctx.stroke();
        disc(gt.a.x, gt.a.y, 3.4, '#FF9ECB');
      }
      drawHouse(el);
      // spinner: a flat plate that turns; its two faces have two colours so the turning is easy to see
      if (world.spinners && world.spinners[0]) {
        const sp = world.spinners[0], c = cos(sp.angle), hw = sp.w / 2 - 1;
        const th = 3 + 12 * abs(c);
        rr(ctx, sp.x - hw + 1, sp.y - th / 2 + 2, hw * 2, th, min(6, th / 2));
        ctx.fillStyle = 'rgba(3,5,28,0.35)'; ctx.fill();
        rr(ctx, sp.x - hw, sp.y - th / 2, hw * 2, th, min(6, th / 2));
        ctx.fillStyle = sin(sp.angle) > 0 ? '#FF9ECB' : '#8EE3A9'; ctx.fill();
        ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(255,248,231,0.7)'; ctx.stroke();
        if (th > 8) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; rr(ctx, sp.x - hw + 3, sp.y - th / 2 + 1.5, hw * 2 - 6, 2.2, 1.1); ctx.fill(); }
        disc(sp.x, sp.y, 3, '#FFF8E7');
      }
      // mystery target: a golden bar on the wall, and a question block sign above it
      if (table.targets && table.targets[0]) {
        const tg = table.targets[0], hit = el.targets && el.targets[tg.id] ? fin(el.targets[tg.id].hit, 0) : 0, rk = mysteryK;
        glow('#FFD84A', tg.x, tg.y, 44, (0.16 + 0.5 * hit) * rk);
        ctx.lineCap = 'round';
        ctx.strokeStyle = rk > 0.5 ? '#D9921C' : '#7C6A3A'; ctx.lineWidth = tg.t * 2 + 1;
        ctx.beginPath(); ctx.moveTo(tg.a.x, tg.a.y); ctx.lineTo(tg.b.x, tg.b.y); ctx.stroke();
        ctx.strokeStyle = hit > 0.05 ? '#FFF3B0' : (rk > 0.5 ? '#FFD84A' : '#B39A55'); ctx.lineWidth = tg.t * 2 - 2;
        ctx.beginPath(); ctx.moveTo(tg.a.x, tg.a.y); ctx.lineTo(tg.b.x, tg.b.y); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(tg.a.x - 1.5, tg.a.y + 4); ctx.lineTo(tg.b.x - 1.5, tg.b.y - 4); ctx.stroke();
        // the sign and the arrow follow the top of the bar (a longer bar must not run into them)
        const top = Math.min(tg.a.y, tg.b.y), sgy = top - 31;
        ctx.globalAlpha = 0.42 + 0.58 * rk;
        A.question(459, sgy, 15 * (1 + 0.12 * hit), { t: reduced || rk < 0.5 ? 0 : now, pressed: hit > 0.4 || rk < 0.5 });
        ctx.globalAlpha = 1;
        // a small arrow from the sign down to the bar
        ctx.fillStyle = 'rgba(255,216,74,' + (0.25 + 0.45 * rk) + ')';
        ctx.beginPath(); ctx.moveTo(468, top - 14); ctx.lineTo(478, top - 14); ctx.lineTo(473, top - 6); ctx.closePath(); ctx.fill();
        // asleep (cooling down): a few small pale Zs float up beside the sign, so a hit that only gives +100 reads as a nap, not a broken target
        if (rk < 0.5) A.zzz(466, sgy - 6, 17, { t: reduced ? 0.35 : now, color: '#D9D2FF', alpha: 0.9 });
      }
      // slingshots: the rubber band on the kicking edge bulges when hit
      for (const s of table.slings) {
        const hit = el.slings && el.slings[s.id] ? el.slings[s.id].hit : 0;
        const a = s.a, b = s.b, bulge = 8 * hit;
        const mx = (a.x + b.x) / 2 + s.nx * bulge * 1.6, my = (a.y + b.y) / 2 + s.ny * bulge * 1.6;
        if (hit > 0.02) glow('#FFB3D1', (a.x + b.x) / 2, (a.y + b.y) / 2, 44, 0.5 * hit);
        ctx.lineCap = 'round';
        ctx.strokeStyle = hit > 0.05 ? '#FFF0CF' : '#FF9ECB'; ctx.lineWidth = 3 + 1.6 * hit;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y); ctx.stroke();
      }
    }

    function drawHouse(el) {
      const hp = table.decor.housePen, e = el.holes && el.holes.house;
      const occ = !!(e && e.occupied), t = e ? e.t : 0, hold = e && e.hold ? e.hold : 1.4;
      // Nori peeks out from behind the door
      if (noriShow > 0.02 && st.nori && isFinite(st.nori.x) && isFinite(st.nori.y)) {
        const n = st.nori, k = clamp(noriShow, 0, 1);
        ctx.save();
        ctx.beginPath(); ctx.rect(hp.x - 70, 110, 140, hp.doorY - 110 + 1); ctx.clip();
        lookAt(n.x, n.y, 3);
        A.ghost(n.x, n.y + (1 - k) * 14, 14.5 * (0.6 + 0.4 * easeOutBack(k)), { color: 'orange', mood: str(n.mood, 'normal'), look: LOOK, t: now, alpha: k });
        ctx.restore();
      }
      if (occ) glow('#FFF0CF', hp.hole.x, hp.hole.y, 34, 0.26 + 0.08 * sin(now * 4));
      if (st.locked) {   // a locked ball waits in the house for the next launch: a slow golden ring around it (under 1 Hz)
        const pz = reduced ? 0.5 : 0.5 + 0.5 * sin(now * 3);
        ctx.globalAlpha = 0.4 + 0.3 * pz;
        ctx.beginPath(); ctx.arc(hp.hole.x, hp.hole.y, 17 + 3 * pz, 0, TAU); ctx.strokeStyle = '#FFD84A'; ctx.lineWidth = 2.4; ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // the door lifts a little just before the ball is popped out
      const open = occ ? smooth((t - (hold - 0.5)) / 0.4) : 0;
      const dw = hp.doorW / 2;
      ctx.globalAlpha = 1 - 0.65 * open;
      ctx.lineCap = 'round';
      ctx.strokeStyle = occ ? '#FFC2DE' : '#FF9ECB'; ctx.lineWidth = 3.6;
      ctx.beginPath(); ctx.moveTo(hp.doorX - dw, hp.doorY - open * 7); ctx.lineTo(hp.doorX + dw, hp.doorY - open * 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function drawBalloons() {
      const bl = st.balloons;
      if (!bl || !bl.length) return;
      for (let i = 0; i < bl.length; i++) {
        const b = bl[i];
        if (!isObj(b) || !isFinite(b.x) || !isFinite(b.y) || !(b.r > 0)) continue;
        A.shadow(b.x + 4, b.y + b.r * 1.9, b.r * 0.9, b.r * 0.22, 0.18);
        A.balloon(b.x, b.y, b.r, { color: b.color, t: reduced ? 0 : now });
      }
    }

    function drawBumpers() {
      const bumpers = table.bumpers;
      for (let i = 0; i < bumpers.length; i++) {
        const b = bumpers[i];
        const gs = findGhost(b.id);
        const el = world.elements && world.elements.bumpers && world.elements.bumpers[b.id];
        const hit = clamp(Math.max(gs ? fin(gs.hit, 0) : 0, el ? fin(el.hit, 0) : 0), 0, 1);
        const color = C.ghost[gs && gs.color] ? gs.color : b.color;
        const hex = C.ghost[color] || C.ghost.red;
        const mood = gs ? str(gs.mood, 'normal') : 'normal';
        const h4 = Math.round(hit * 20) / 20;
        // the round pod the ghost sits in: this is exactly what the ball bounces off
        glow(hex, b.x, b.y, b.r * 1.75, 0.15 + 0.32 * hit);
        const pr = b.r * (1 + 0.045 * hit);
        const rg = ctx.createRadialGradient(b.x, b.y - 4, 3, b.x, b.y, pr);
        rg.addColorStop(0, rgba(hex, Math.round((0.3 + 0.18 * hit) * 20) / 20)); rg.addColorStop(1, 'rgba(12,16,58,0.9)');
        ctx.beginPath(); ctx.arc(b.x, b.y, pr, 0, TAU); ctx.fillStyle = rg; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = rgba(hex, 0.9); ctx.stroke();
        ctx.beginPath(); ctx.arc(b.x, b.y, pr - 3.6, 0, TAU); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.stroke();
        if (hit > 0.05) {
          ctx.globalAlpha = 0.45 * h4; ctx.beginPath(); ctx.arc(b.x, b.y, b.r + (1 - h4) * 15, 0, TAU);
          ctx.strokeStyle = hex; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
        }
        const gr = b.r * 0.86;
        A.shadow(b.x, b.y + gr * 0.78, gr * 0.85, gr * 0.2, 0.32);
        if (gs && isFinite(gs.lookX) && isFinite(gs.lookY) && st.screen !== 'title') { LOOK.x = +gs.lookX; LOOK.y = +gs.lookY; } else lookAt(b.x, b.y, i);
        SQ.x = 1 + 0.14 * hit; SQ.y = 1 - 0.14 * hit;
        A.ghost(b.x, b.y - hit * 2.5, gr, { color: color, mood: mood, look: LOOK, t: now + i * 0.9, squash: SQ });
      }
    }

    // a flipper is drawn as exactly the capsule the physics uses: circle r0 at the pivot, circle r1 at the tip
    function capsulePath(len, r0, r1) {
      const k = clamp((r0 - r1) / len, -0.99, 0.99), ph = Math.acos(k);
      ctx.beginPath();
      ctx.arc(0, 0, r0, ph, TAU - ph, false);
      ctx.arc(len, 0, r1, -ph, ph, false);
      ctx.closePath();
    }
    function drawFlippers() {
      const demo = st.screen === 'title';
      for (let i = 0; i < world.flippers.length; i++) {
        const f = world.flippers[i];
        let ang = f.angle;
        if (demo) {
          const w = 0.5 + 0.5 * sin(now * 1.4 + (f.id === 'R' ? 1.9 : 0));
          ang = lerp(f.restAngle, f.upAngle, Math.pow(w, 5));
        }
        const flip = cos(ang) < 0;
        // soft shadow
        ctx.save(); ctx.translate(f.px + 2, f.py + 5); ctx.rotate(ang);
        capsulePath(f.len, f.r0, f.r1); ctx.fillStyle = 'rgba(2,3,20,0.34)'; ctx.fill();
        ctx.restore();
        ctx.save(); ctx.translate(f.px, f.py); ctx.rotate(ang);
        if (flip) ctx.scale(1, -1);
        capsulePath(f.len, f.r0, f.r1);
        const gr = ctx.createLinearGradient(0, -f.r0, 0, f.r0);
        gr.addColorStop(0, C.flipperLight); gr.addColorStop(0.42, C.flipper); gr.addColorStop(1, C.flipperDark);
        ctx.fillStyle = gr; ctx.fill();
        ctx.save(); ctx.clip();
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(160,50,100,0.55)'; capsulePath(f.len, f.r0, f.r1); ctx.stroke();
        ctx.restore();
        ctx.beginPath(); ctx.moveTo(f.r0 * 0.5, -f.r0 * 0.55); ctx.lineTo(f.len * 0.88, -f.r1 * 0.5);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.stroke();
        // pivot cap, butter yellow like Pacman
        const cr = f.r0 * 0.6;
        const cg = ctx.createRadialGradient(-cr * 0.3, -cr * 0.35, 1, 0, 0, cr);
        cg.addColorStop(0, '#FFF0A0'); cg.addColorStop(0.6, '#FFD84A'); cg.addColorStop(1, '#F2B12C');
        ctx.beginPath(); ctx.arc(0, 0, cr, 0, TAU); ctx.fillStyle = cg; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(214,138,20,0.6)'; ctx.stroke();
        ctx.restore();
      }
    }

    function drawPlunger() {
      const pl = table.plunger, e = world.elements && world.elements.plunger;
      const pull = e ? fin(e.pull, 0) : 0, chg = fin(st.launch.charge, 0);
      const headY = pl.y + pull;
      // spring
      const yTop = headY + 9, yBot = 953, n = 8;
      ctx.beginPath(); ctx.moveTo(pl.x, yTop);
      for (let i = 1; i <= n; i++) ctx.lineTo(pl.x + (i % 2 ? 10 : -10), yTop + (yBot - yTop) * i / n);
      ctx.strokeStyle = '#AAB4F5'; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.stroke();
      if (chg > 0.02) glow('#FFD84A', pl.x, headY, 32, 0.5 * chg);
      rr(ctx, pl.x - 16, headY, 32, 9, 4);
      const g2 = ctx.createLinearGradient(0, headY, 0, headY + 9);
      g2.addColorStop(0, '#FFF0A0'); g2.addColorStop(1, '#F2B12C');
      ctx.fillStyle = g2; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(214,138,20,0.7)'; ctx.stroke();
    }

    // The balls are little Pacmen (SPEC 9.1). The drawn radius is BALL_R * PM.CFG.BALL_DRAW_SCALE (read every frame, so it can be tuned in
    // one place), a little more than the physics radius: flippers and walls overlap the drawing by a couple of units, which reads as
    // "the ball sits on the flipper". In two ball play the ball with the higher id wears a small pink bow.
    function drawBalls() {
      const ds = CFG && +CFG.BALL_DRAW_SCALE > 0 ? +CFG.BALL_DRAW_SCALE : 1.35;
      let nLive = 0, maxId = -1;
      for (let i = 0; i < world.balls.length; i++) { const b = world.balls[i]; if (b.state !== 'drained') { nLive++; if (b.id > maxId) maxId = b.id; } }
      for (let i = 0; i < world.balls.length; i++) {
        const b = world.balls[i];
        if (b.state === 'drained') continue;
        const br = clamp(fin(b.r, 10), 2, 40) * ds;
        const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        const tr = trails.get(b.id);
        if (quality >= 2 && !reduced && tr && sp > 380 && tr.n > 2) {
          const a0 = Math.min(1, (sp - 380) / 420) * 0.26;
          ctx.fillStyle = '#CFD9FF';
          for (let j = 0; j < tr.n - 1; j++) {
            const idx = (tr.h - tr.n + j + 20) % 10, f = (j + 1) / tr.n;
            ctx.globalAlpha = a0 * f;
            ctx.beginPath(); ctx.arc(tr.x[idx], tr.y[idx], br * (0.25 + 0.6 * f), 0, TAU); ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
        glow('#DDE6FF', b.x, b.y, br * 2.5, 0.32);
        A.shadow(b.x + 1.5, b.y + 4.5, br * 1.05, br * 0.42, 0.3);
        let mouth = 0.5, dir = -PI / 2;
        if (tr) {
          dir = tr.fa;
          if (!reduced) {   // reduced motion: half open and still
            const m = 0.5 - 0.5 * cos(tr.ph * TAU), c = tr.calm;
            mouth = lerp(0.2, 0.15, c) + (lerp(0.85, 0.38, c) - lerp(0.2, 0.15, c)) * m;
          }
        }
        if (tr) tr.mouth = mouth;
        A.ballPac(b.x, b.y, br, { dir: dir, mouth: mouth, bow: nLive >= 2 && b.id === maxId });
      }
    }

    // The friendly Pacman under the flippers. Ball save: he rises, chomps the ball, spits it back. Shield: he waits.
    function drawHelper() {
      const h = st.pacmanHelper, sp = table.spots.pacmanHelper, R = 52;
      let y = sp.y - 2, open = 0.5, alpha = 0, mood = 'happy';
      if (h && typeof h.phase === 'string' && h.phase !== 'none') {
        const dur = +h.dur > 0 ? +h.dur : (h.phase === 'chomp' ? 0.85 : 0.65), u = clamp((+h.t || 0) / dur, 0, 1);
        alpha = 1;
        if (h.phase === 'chomp') {           // rises, waits with an open mouth, then chomps shut
          y += 78 * (1 - easeOutCubic(min(1, u / 0.4)));
          open = u < 0.5 ? 0.95 : lerp(0.95, 0.04, smooth((u - 0.5) / 0.28));
          mood = u < 0.6 ? 'happy' : 'chomp';
        } else {                              // spits the ball out, then sinks away
          open = u < 0.2 ? lerp(0.05, 0.95, smooth(u / 0.2)) : 0.9;
          y += 90 * smooth((u - 0.55) / 0.45);
          alpha = 1 - smooth((u - 0.8) / 0.2);
        }
      } else if (guardShow > 0.02) {
        const shield = st.surprise && st.surprise.id === 'shield';
        if (!shield) {   // ordinary ball saver: only a faint smile of warm light under the flippers
          ctx.save();
          ctx.globalAlpha = 0.5 * guardShow;
          ctx.beginPath(); ctx.arc(sp.x, 968, 78, PI * 1.12, PI * 1.88);
          ctx.strokeStyle = 'rgba(255,216,74,0.55)'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
          ctx.restore();
          return;
        }
        alpha = 0.6 * guardShow;
        y += 56 - 12 * guardShow + (reduced ? 0 : sin(now * 1.6) * 2);
        open = reduced ? 0.3 : 0.28 + 0.06 * sin(now * 2.2);
      }
      if (alpha <= 0.01) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(110, 0, 280, TH + 2); ctx.clip();
      glow('#FFD84A', sp.x, y, 90, 0.18 * alpha);
      ctx.globalAlpha = alpha;
      A.pacmanBig(sp.x, y, R, { open: open, mood: mood, t: reduced ? 0 : now, blink: (now % 4.2) < 0.13 ? 1 : 0 });
      ctx.restore();
    }

    function drawPopups() {
      const pl = st.popups;
      if (!pl || !pl.length) return;
      for (let i = 0; i < pl.length; i++) {
        const p = pl[i];
        if (!isObj(p) || p.text == null) continue;
        const ti = timerInfo(p.dur ? p : { t: p.t, dur: 1.2 }), u = ti.u;
        const a = u < 0.08 ? u / 0.08 : (u > 0.65 ? (1 - u) / 0.35 : 1);
        const k = 1 + 0.3 * (1 - Math.min(1, u / 0.14));
        const x = clamp(fin(+p.x, 0), 44, TW - 44), y = fin(+p.y, 0) - 30 * easeOutCubic(u);
        ctx.save();
        ctx.translate(x, y); ctx.scale(k, k);
        drawText(ctx, String(p.text), 0, 0, 24, { align: 'center', base: 'middle', weight: 700, color: fxColor(p.color, '#FFF8E7'), outline: 'rgba(14,18,74,0.9)', outlineW: 5, alpha: a });
        ctx.restore();
      }
    }

    function wrapLines(s, size, maxW, weight) {
      ctx.font = fontOf(size, weight || 600);
      const words = String(s).split(' '), lines = [];
      let cur = '';
      for (let i = 0; i < words.length; i++) {
        const t = cur ? cur + ' ' + words[i] : words[i];
        if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = words[i]; } else cur = t;
      }
      if (cur) lines.push(cur);
      return lines;
    }

    // little helper bubble beside the plunger for a child who does not know what to press yet: a picture, no words
    // (the banner above says the words). The key cap dips like it is being pressed.
    function drawHint() {
      if (hintShow < 0.02) return;
      const k = easeOutBack(clamp(hintShow, 0, 1)), bob = reduced ? 0 : sin(now * 3.4) * 2.5;
      const w = 108, h = 66, cx = 414, cy = 876 + bob;
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(k, k); ctx.globalAlpha = clamp(hintShow * 1.4, 0, 1);
      A.speech(0, 0, w, h, { tail: 'right', tailPos: 0.1, color: '#FFF8E7', edge: 'rgba(90,100,200,0.55)' });
      const press = reduced ? 0 : Math.max(0, sin(now * 3.4 - 0.6));
      A.keycap(-2, -1 + press * 2, 84, 40, 'space', { pressed: press > 0.6 });
      ctx.restore();
    }

    function drawTableDynamic() {
      if (!world) return;
      drawLaneChevrons();
      drawPickups();
      drawFixtures();
      drawBalloons();
      drawBumpers();
    }
    function drawTableFront() {
      if (!world) return;
      drawHelper();
      drawFlippers();
      drawPlunger();
      drawBalls();
      drawFx(0);
      drawPopups();
      if (st.screen !== 'paused') drawHint();
    }

    // ---------------------------------------------------------------------------------------------------------
    // ICONS for banners and chips (surprises, pickups, ...)
    const SURPRISE_IDS = CFG && CFG.SURPRISES ? CFG.SURPRISES : ['bigflip', 'slow', 'balloons', 'fruits', 'dance', 'shield', 'extraball'];
    function miniFlipper(x, y, len, r0, r1, ang) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      capsulePath(len, r0, r1);
      ctx.fillStyle = C.flipper; ctx.fill();
      ctx.beginPath(); ctx.moveTo(r0 * 0.4, -r0 * 0.5); ctx.lineTo(len * 0.8, -r1 * 0.45);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = Math.max(1, r0 * 0.25); ctx.lineCap = 'round'; ctx.stroke();
      disc(0, 0, r0 * 0.55, C.pacman);
      ctx.restore();
    }
    function iconByName(name, x, y, r) {
      const n = String(name || 'star');
      const base = n.indexOf(':') > 0 ? n.split(':')[0] : n, arg = n.indexOf(':') > 0 ? n.split(':')[1] : '';
      if (SURPRISE_IDS.indexOf(n) >= 0 || (base === 'surprise' && arg)) { drawSurpriseIcon(arg || n, x, y, r); return; }
      if (CFG && CFG.FRUITS && CFG.FRUITS.indexOf(base === 'fruit' && arg ? arg : n) >= 0) { A.fruit(base === 'fruit' && arg ? arg : n, x, y, r * 0.9, { t: 0 }); return; }
      switch (base) {
        case 'ghost': A.ghost(x, y - r * 0.05, r * 0.85, { color: arg || 'red', mood: 'happy', look: { x: 0, y: 0.1 }, t: now }); break;
        case 'power': case 'pellet': A.ghost(x, y - r * 0.05, r * 0.85, { color: 'red', mood: 'blue', t: now }); break;
        case 'pacman': case 'ballsave': A.pacman(x, y, r * 0.9, { mouth: reduced ? 0.5 : 0.5 + 0.4 * sin(now * 6), mood: 'happy' }); break;
        case 'heart': A.heart(x, y, r * 0.85, { t: reduced ? 0 : now }); break;
        case 'sparkle': A.sparkle(x, y, r * 0.95, { color: '#FFF3C4', glow: true }); break;
        case 'space': A.keycap(x, y + r * 0.1, r * 1.9, r * 0.95, 'space', {}); break;
        case 'arrows': A.keycap(x - r * 0.5, y + r * 0.1, r * 0.9, r * 0.8, 'left', {}); A.keycap(x + r * 0.55, y + r * 0.1, r * 0.9, r * 0.8, 'right', {}); break;
        case 'balloon': A.balloon(x, y - r * 0.2, r * 0.55, { color: '#FF9ECB', t: reduced ? 0 : now }); break;
        case 'multiball': case 'ball':   // the two Pacman balls (a fixed half-closed mouth: an icon stays calm); the second one wears the bow
          A.ballPac(x - r * 0.38, y + r * 0.1, r * 0.46, { dir: 0, mouth: 0.4 }); A.ballPac(x + r * 0.42, y - r * 0.15, r * 0.46, { dir: 0, mouth: 0.4, bow: true }); break;
        case 'crown': A.crown(x, y, r * 0.95, {}); break;
        case 'trophy': A.trophy(x, y, r * 0.95, {}); break;
        case 'question': case 'mystery': A.question(x, y, r * 0.72, { t: reduced ? 0 : now }); break;
        case 'tunnel': case 'house': case 'music': case 'speaker': case 'pause': case 'play': A.icon(base, x, y, r * 1.5, { color: C.accent }); break;
        default: A.star(x, y, r * 0.95, { color: C.accent, glow: false });
      }
    }
    function drawSurpriseIcon(id, x, y, r) {
      switch (id) {
        case 'bigflip':
          miniFlipper(x - r * 0.72, y - r * 0.3, r * 0.95, r * 0.24, r * 0.14, 0.5);
          miniFlipper(x + r * 0.72, y - r * 0.3, r * 0.95, r * 0.24, r * 0.14, PI - 0.5);
          break;
        case 'slow': {
          ctx.fillStyle = '#DCE2FF';
          ctx.beginPath(); ctx.arc(x - r * 0.4, y + r * 0.1, r * 0.4, 0, TAU); ctx.arc(x + r * 0.1, y - r * 0.15, r * 0.5, 0, TAU); ctx.arc(x + r * 0.55, y + r * 0.15, r * 0.36, 0, TAU); ctx.fill();
          rr(ctx, x - r * 0.85, y + r * 0.1, r * 1.75, r * 0.4, r * 0.2); ctx.fill();
          break;
        }
        case 'balloons': A.balloon(x, y - r * 0.25, r * 0.6, { color: '#FF9ECB', t: reduced ? 0 : now }); break;
        case 'fruits': A.fruit('cherry', x, y, r * 0.95, { t: 0 }); break;
        case 'dance': A.ghost(x, y - r * 0.1, r * 0.82, { color: 'cyan', mood: 'dance', t: now }); break;
        case 'shield':
          ctx.beginPath(); ctx.arc(x, y, r * 0.98, 0, TAU); ctx.strokeStyle = 'rgba(255,216,74,0.65)'; ctx.lineWidth = Math.max(1.5, r * 0.12); ctx.stroke();
          A.pacman(x, y, r * 0.72, { mouth: 0.35, mood: 'happy' });
          break;
        case 'extraball':
          A.ballPac(x - r * 0.1, y + r * 0.12, r * 0.55, { dir: 0, mouth: 0.4 });
          A.heart(x + r * 0.55, y - r * 0.5, r * 0.36, {});
          break;
        default: A.star(x, y, r * 0.95, { color: C.accent, glow: false });
      }
    }

    // ---------------------------------------------------------------------------------------------------------
    // HUD (CSS px)
    function panel(x, y, w, h, o) {
      o = o || {};
      const r = o.r != null ? o.r : Math.min(h * 0.28, 24 * layout.hud.uu);
      ctx.save();
      rr(ctx, x + 1, y + 3, w, h, r); ctx.fillStyle = 'rgba(3,5,28,0.30)'; ctx.fill();
      rr(ctx, x, y, w, h, r);
      ctx.fillStyle = o.fill || C.panel; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = o.edge || C.panelEdge; ctx.stroke();
      ctx.restore();
    }

    function drawScoreCard(R) {
      panel(R.x, R.y, R.w, R.h);
      const pad = R.h * 0.13 + 6;
      const lsz = Math.min(24 * layout.hud.uu, R.h * 0.19);
      drawText(ctx, T.score || 'Pontok', R.x + pad, R.y + R.h * 0.3, lsz, { color: C.textMuted, weight: 600 });
      const nsz = R.h * 0.44, maxW = R.w - pad * 2 - (layout.mode === 'tall' ? R.h * 0.2 : 0);
      ctx.save();
      const k = 1 + 0.09 * Math.sin(scorePop * PI);
      ctx.translate(R.x + pad, R.y + R.h * 0.82); ctx.scale(k, k);
      drawText(ctx, fmtNum(dispScore), 0, 0, nsz, { color: C.text, weight: 700, maxW: maxW / k });
      ctx.restore();
      if (layout.mode === 'side') A.star(R.x + R.w - pad - lsz * 0.5, R.y + R.h * 0.24, lsz * 0.85, { color: C.accent });
    }
    function drawBestCard(R) {
      panel(R.x, R.y, R.w, R.h);
      // while the score is still counting up to a new record, the record counts with it (never "record 100, score 99")
      const best = (+st.score || 0) >= (+st.hiScore || 0) ? Math.round(dispScore) : (+st.hiScore || 0);
      A.crown(R.x + R.h * 0.62, R.y + R.h * 0.52, R.h * 0.3, {});
      const x0 = R.x + R.h * 1.08;
      drawText(ctx, T.best || 'Rekord', x0, R.y + R.h * 0.4, R.h * 0.25, { color: C.textMuted });
      drawText(ctx, fmtNum(best), x0, R.y + R.h * 0.82, R.h * 0.4, { color: C.text, weight: 700, maxW: R.w - (x0 - R.x) - 16 });
    }
    function drawLevelPill(R) {
      panel(R.x, R.y, R.w, R.h);
      const cr = R.h * 0.34, cx = R.x + R.w - cr - R.h * 0.2, cy = R.y + R.h / 2;
      drawText(ctx, T.level || 'Szint', R.x + R.h * 0.3, cy, R.h * 0.3, { color: C.textMuted, base: 'middle' });
      const k = 1 + 0.25 * Math.sin(levelPop * PI);
      ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k);
      disc(0, 0, cr, C.accent);
      drawText(ctx, String(st.level || 1), 0, 0, cr * 1.2, { align: 'center', base: 'middle', color: C.ink, weight: 700 });
      ctx.restore();
    }
    function drawMult(M) {
      const m = st.multiplier || 1;
      if (m <= 1) {
        if (layout.mode !== 'side') return;
        ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.arc(M.cx, M.cy, M.r * 0.86, 0, TAU); ctx.strokeStyle = C.panelEdge; ctx.lineWidth = 2; ctx.stroke();
        drawText(ctx, '×1', M.cx, M.cy, M.r * 0.9, { align: 'center', base: 'middle', color: C.textMuted, weight: 700 });
        ctx.globalAlpha = 1;
        return;
      }
      const k = (1 + 0.28 * Math.sin(multPop * PI)) * (multPop > 0.7 ? easeOutBack((1 - multPop) / 0.3) : 1);
      ctx.save();
      ctx.translate(M.cx, M.cy); ctx.rotate(-0.1); ctx.scale(Math.max(0.05, k), Math.max(0.05, k));
      glow('#FFD84A', 0, 0, M.r * 1.7, 0.25, dpr);
      const rg = ctx.createRadialGradient(-M.r * 0.3, -M.r * 0.35, 1, 0, 0, M.r);
      rg.addColorStop(0, '#FFF3B0'); rg.addColorStop(0.55, '#FFD84A'); rg.addColorStop(1, '#F2B12C');
      ctx.beginPath(); ctx.arc(0, 0, M.r, 0, TAU); ctx.fillStyle = rg; ctx.fill();
      ctx.lineWidth = 2.4; ctx.strokeStyle = '#FFF8E7'; ctx.stroke();
      drawText(ctx, '×' + m, 0, M.r * 0.04, M.r * 1.0, { align: 'center', base: 'middle', color: C.ink, weight: 700 });
      ctx.restore();
    }
    function drawBallsCard(R) {
      panel(R.x, R.y, R.w, R.h);
      const compact = layout.mode === 'tall';
      const total = Math.max(1, Math.min(8, st.ballsTotal || CFG.BALLS_PER_GAME || 5)), cur = (st.ballNo || 1) - 1;
      const spent = st.limPhase === 'notice' || st.limPhase === 'last';   // the last ball: no lit spare Pacmans, the card must not promise more balls
      const padX = R.h * 0.24;
      const slot = Math.max(4, (R.w - 2 * padX) / total);
      const rr0 = Math.max(1, Math.min(compact ? R.h * 0.2 : R.h * 0.21, slot * 0.42));
      const cy = R.y + R.h * (compact ? 0.4 : 0.64);
      if (!compact) drawText(ctx, T.balls_left || 'Labdák', R.x + padX, R.y + R.h * 0.3, R.h * 0.2, { color: C.textMuted });
      else drawText(ctx, (T.level || 'Szint') + ' ' + (st.level || 1), R.x + R.w / 2, R.y + R.h * 0.86, R.h * 0.2, { color: C.textMuted, align: 'center' });
      for (let i = 0; i < total; i++) {
        const cx = R.x + padX + slot * (i + 0.5);
        if (i < cur || (spent && i > cur)) {
          ctx.globalAlpha = 0.28;
          ctx.beginPath(); ctx.arc(cx, cy, rr0 * 0.72, 0, TAU); ctx.strokeStyle = '#FFF0CF'; ctx.lineWidth = 1.6; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        } else if (i === cur) {
          glow('#FFD84A', cx, cy, rr0 * 2.3, 0.4, dpr);
          A.pacman(cx, cy, rr0 * 1.22, { mouth: reduced ? 0.5 : 0.25 + 0.3 * (0.5 + 0.5 * sin(now * 6.5)), mood: 'happy' });
        } else {
          A.pacman(cx, cy, rr0 * 0.95, { mouth: 0.32, mood: 'happy' });
        }
      }
    }
    function drawFruitTray(R) {
      panel(R.x, R.y, R.w, R.h);
      const slots = 6, tray = st.fruitTray || [];
      const step = Math.max(4, (R.w - R.h * 0.5) / slots), r0 = Math.max(1, Math.min(R.h * 0.32, step * 0.42));
      const x0 = R.x + R.h * 0.25 + step / 2, cy = R.y + R.h / 2;
      const first = Math.max(0, tray.length - slots);
      for (let i = 0; i < slots; i++) {
        const cx = x0 + i * step, kind = tray[first + i];
        if (typeof kind === 'string') A.fruit(kind, cx, cy, r0, { t: 0 });
        else A.fruit(CFG.FRUITS[i % CFG.FRUITS.length], cx, cy, r0 * 0.92, { t: 0, alpha: 0.16 });   // a pale hint of what can be collected
      }
    }

    // a timer chip: icon, big words and a bar that shrinks as time runs out
    function drawChip(R, anim, kind) {
      const k = easeOutCubic(clamp(anim, 0, 1));
      if (k < 0.02) return;
      const data = chipLast[kind];
      if (!data) return;
      const uu = layout.hud.uu, frac = clamp(data.rem / (data.dur || 1), 0, 1);
      let text, accent, sub = '';
      if (kind === 'power') { text = T.power ? T.power.text : ''; accent = C.ghostBlue; }
      else {
        const sr = T.surprise && T.surprise[data.id];
        text = sr ? sr.text : ''; accent = C.accent2;
      }
      ctx.save();
      ctx.globalAlpha = k;
      const slide = layout.mode === 'side' ? (1 - k) * 34 * uu : 0;
      ctx.translate(slide, layout.mode === 'tall' ? -(1 - k) * 16 : 0);
      panel(R.x, R.y, R.w, R.h, { edge: accent });
      const icx = R.x + R.h * 0.56, icy = R.y + R.h * 0.5, ir = R.h * 0.3;
      if (kind === 'power') {
        A.ghost(icx, icy - ir * 0.05, ir * 0.85, { color: 'red', mood: 'blue', t: now });
        ctx.beginPath(); ctx.arc(icx, icy, ir * 1.28, -PI / 2, -PI / 2 + TAU * frac);
        ctx.strokeStyle = accent; ctx.lineWidth = Math.max(2.4, R.h * 0.06); ctx.lineCap = 'round'; ctx.stroke();
      } else {
        drawSurpriseIcon(data.id, icx, icy, ir * 1.1);
      }
      const tx = R.x + R.h * 1.08, tw = R.w - R.h * 1.08 - 14 * uu;
      drawText(ctx, text, tx, R.y + R.h * 0.5, R.h * 0.31, { weight: 700, color: C.text, maxW: tw });
      // shrinking bar
      const by = R.y + R.h * 0.68, bh = Math.max(4, R.h * 0.13);
      rr(ctx, tx, by, tw, bh, bh / 2); ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fill();
      if (frac > 0.01) { rr(ctx, tx, by, Math.max(bh, tw * frac), bh, bh / 2); ctx.fillStyle = accent; ctx.fill(); }
      ctx.restore();
    }
    function drawChips() {
      const ch0 = layout.hud.chips;
      if (!ch0) return;
      if (layout.hud.chipsOverlay) {
        // narrow layout: chips sit at the top of the table; one active = wide, two active = side by side
        const act = [];
        for (const kind of ['surprise', 'power']) if (chipAnim[kind] >= 0.02) act.push(kind);
        for (let i = 0; i < act.length; i++) drawChip(act.length === 2 && layout.hud.chipsPair ? layout.hud.chipsPair[i] : ch0[0], chipAnim[act[i]], act[i]);
      } else {
        drawChip(ch0[0], chipAnim.surprise, 'surprise');
        drawChip(ch0[1], chipAnim.power, 'power');
      }
    }

    function lookAtWin(px, py) {
      const t = layout.table, b = nearestBall(0, 0);
      if (!b) { LOOK.x = 0; LOOK.y = 0.15; return LOOK; }
      const dx = t.x + b.x * layout.scale - px, dy = t.y + b.y * layout.scale - py, d = Math.sqrt(dx * dx + dy * dy) || 1, k = Math.min(1, d / (160 * layout.ui));
      LOOK.x = dx / d * k; LOOK.y = dy / d * k;
      return LOOK;
    }
    // friendly mascots in the wide layout: Pacman (chomps when dots are eaten) and the three ghost friends
    function drawMascots() {
      const H = layout.hud, ui = H.uu;
      if (H.mascotL && H.mascotL.h > 90 * ui && st.limPhase !== 'notice' && st.limPhase !== 'last') {   // the goodbye notice and badge use this corner
        const R = H.mascotL, r = Math.min(R.h * 0.19, R.w * 0.13, 64 * ui), cx = R.x + R.w * 0.44, cy = R.y + R.h * 0.58;
        const hop = hopT > 0 && !reduced ? -sin((1 - hopT) * PI) * r * 0.2 : 0;
        A.shadow(cx, cy + r * 1.02, r * 0.85, r * 0.2, 0.3);
        const mouth = reduced ? 0.5 : (chompT > 0 ? 0.5 + 0.5 * sin(now * 11) : 0.14 + 0.12 * (0.5 + 0.5 * sin(now * 1.7)));
        A.pacman(cx, cy + hop, r, { mouth: mouth, dir: 0, mood: 'happy', blink: (now % 4.6) < 0.14 ? 1 : 0, t: reduced ? 0 : now });
        for (let i = 0; i < 3; i++) disc(cx + r * 1.4 + i * r * 0.55, cy, r * 0.1, 'rgba(255,240,207,' + (0.5 - i * 0.14) + ')');
      }
      if (H.mascotR && H.mascotR.h > 90 * ui) {
        const R = H.mascotR, gr = Math.min(R.h * 0.15, R.w * 0.075, 46 * ui), cy = R.y + R.h * 0.58;
        const ids = ['piri', 'rozi', 'kiki'], cols = ['red', 'pink', 'cyan'];
        for (let i = 0; i < 3; i++) {
          const cx = R.x + R.w * (0.22 + i * 0.28), gs = findGhost(ids[i]);
          const y = cy + (reduced ? 0 : sin(now * 1.9 + i * 1.3) * gr * 0.05);
          A.shadow(cx, y + gr * 0.98, gr * 0.85, gr * 0.2, 0.3);
          lookAtWin(cx, y);
          A.ghost(cx, y, gr, { color: cols[i], mood: gs ? str(gs.mood, 'normal') : 'normal', look: LOOK, t: now + i * 0.7 });
        }
      }
    }

    function drawKeys() {
      const K = layout.hud.keys, keys = st.keys || {}, lab = layout.hud, waiting = !!(st.launch && st.launch.waiting);
      drawKey(K.left, 'left', !!keys.left, T.key_left, false, lab);
      drawKey(K.right, 'right', !!keys.right, T.key_right, false, lab);
      drawKey(K.space, 'space', !!keys.space, T.key_launch, waiting, lab);
    }
    function drawKey(r, id, pressed, label, pulse, hud) {
      const sc = (pulse && !pressed && !reduced) ? 1 + 0.035 * sin(now * 5.6) : 1;
      ctx.save(); ctx.translate(r.cx, r.cy); ctx.scale(sc, sc);
      A.keycap(0, 0, r.w, r.h, id, { pressed: pressed });
      ctx.restore();
      const ly = layout.mode === 'side' ? r.cy + r.h / 2 + hud.keyLabelSize * 1.15 : hud.keyLabelY;
      drawText(ctx, label || '', r.cx, ly, hud.keyLabelSize, { align: 'center', color: pressed ? C.accent : C.textMuted, weight: 600, maxW: r.w * 1.25 });
    }

    function drawButtons() {
      const bl = layout.hud.buttons, ui = st.ui || {};
      for (let i = 0; i < bl.length; i++) {
        const b = bl[i];
        ctx.beginPath(); ctx.arc(b.cx, b.cy, b.r, 0, TAU); ctx.fillStyle = C.panel; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = C.panelEdge; ctx.stroke();
        let name = 'question', off = false;
        switch (b.id) {
          case 'sound': off = !!ui.muted; name = off ? 'speakerOff' : 'speaker'; break;
          case 'music': off = ui.musicOn === false; name = off ? 'musicOff' : 'music'; break;
          case 'pause': name = st.screen === 'paused' ? 'play' : 'pause'; break;
          case 'fullscreen': name = 'fullscreen'; break;
        }
        A.icon(name, b.cx, b.cy, b.r * 1.08, { color: off ? C.textMuted : C.text });
      }
    }

    function drawHud() {
      const H = layout.hud, scr = st.screen;
      if (scr === 'title' || scr === 'over' || scr === 'goodbye') { drawButtons(); return; }
      drawScoreCard(H.score);
      if (H.best) drawBestCard(H.best);
      if (H.level && layout.mode === 'side') drawLevelPill(H.level);
      drawMult(H.mult);
      if (!(st.limPhase === 'last' && layout.mode === 'tall')) drawBallsCard(H.balls);   // in the last phase the badge takes the place of the balls card
      if (H.fruit) drawFruitTray(H.fruit);
      drawChips();
      drawMascots();
      drawKeys();
      drawButtons();
      drawLimit();
    }

    // The banner sits over the lower middle of the table, under the balls and flippers so play stays visible.
    function drawBanner() {
      const b = st.banner;
      if (!b || (!b.text && !b.sub)) return;
      const ti = timerInfo(b), e = ti.el, rem = ti.rem;
      const inK = easeOutBack(clamp(e / 0.28, 0, 1)), outK = smooth(clamp(rem / 0.3, 0, 1));
      const k = Math.max(0.05, inK * (0.75 + 0.25 * outK)), alpha = Math.min(1, e / 0.12) * outK;
      if (alpha <= 0.01) return;
      const cx = TW / 2, cy = 648;
      const sub = b.sub || '', kind = b.kind || '';
      const accent = kind === 'good' || kind === 'level' ? C.good : kind === 'power' ? C.ghostBlue : kind === 'surprise' ? C.accent : kind === 'save' ? C.accent : C.accent2;
      ctx.font = fontOf(28, 700);
      const tw = Math.min(360, ctx.measureText(b.text || '').width);
      ctx.font = fontOf(17, 600);
      const sw = sub ? Math.min(360, ctx.measureText(sub).width) : 0;
      const hasIcon = !!b.icon;
      const bw = Math.min(TW - 40, Math.max(tw, sw) + (hasIcon ? 72 : 0) + 40), bh = sub ? 84 : 66;
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(k, k); ctx.globalAlpha = alpha;
      rr(ctx, -bw / 2 + 1.5, -bh / 2 + 5, bw, bh, 24); ctx.fillStyle = 'rgba(3,5,28,0.34)'; ctx.fill();
      rr(ctx, -bw / 2, -bh / 2, bw, bh, 24); ctx.fillStyle = 'rgba(24,30,88,0.94)'; ctx.fill();
      ctx.lineWidth = 2.6; ctx.strokeStyle = accent; ctx.stroke();
      if (hasIcon) {
        disc(-bw / 2 + 42, 0, 27, 'rgba(255,255,255,0.08)');
        iconByName(b.icon, -bw / 2 + 42, 0, 23);
      }
      const tx = hasIcon ? 28 : 0;
      drawText(ctx, b.text || '', tx, sub ? -12 : 0, 28, { align: 'center', base: 'middle', weight: 700, color: C.text, maxW: bw - (hasIcon ? 88 : 36) });
      if (sub) drawText(ctx, sub, tx, 20, 17, { align: 'center', base: 'middle', weight: 600, color: C.textMuted, maxW: bw - (hasIcon ? 88 : 36) });
      ctx.restore();
    }

    // ---------------------------------------------------------------------------------------------------------
    // SCREENS: title, pause, game over (all drawn over a dimmed table)
    const LOGO_PAL = {
      yellow: { top: '#FFF6B8', mid: '#FFD84A', bot: '#F2A927', dark: '#C77E12', edge: '#FFF0A0', glow: 'rgba(255,216,74,0.55)' },
      pink: { top: '#FFE0EE', mid: '#FF9ECB', bot: '#EA6FA6', dark: '#A8467C', edge: '#FFD1E6', glow: 'rgba(255,158,203,0.5)' }
    };
    function logoLine(c, s, x, y, size, pal) {
      c.font = fontOf(size, 700); c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
      c.save(); c.shadowColor = pal.glow; c.shadowBlur = size * 0.32 * dpr; c.fillStyle = pal.mid; c.fillText(s, x, y); c.restore();
      for (let i = 6; i >= 1; i--) { c.fillStyle = pal.dark; c.fillText(s, x, y + i * size * 0.012); }
      c.lineWidth = size * 0.07; c.strokeStyle = pal.dark; c.strokeText(s, x, y + size * 0.03);
      const gr = c.createLinearGradient(0, y - size * 0.45, 0, y + size * 0.5);
      gr.addColorStop(0, pal.top); gr.addColorStop(0.45, pal.mid); gr.addColorStop(1, pal.bot);
      c.fillStyle = gr; c.fillText(s, x, y);
      c.lineWidth = size * 0.02; c.strokeStyle = 'rgba(255,255,255,0.55)'; c.strokeText(s, x, y - size * 0.006);
    }
    function ensureLogo(tu) {
      const key = tu.toFixed(2) + '|' + dpr;
      if (logoCanvas && logoKey === key) return;
      logoKey = key;
      const w = Math.ceil(680 * tu), h = Math.ceil(290 * tu);
      logoCanvas = mkCanvas(w * dpr, h * dpr);
      logoCanvas._w = w; logoCanvas._h = h;
      const c = logoCanvas.getContext('2d');
      c.scale(dpr, dpr);
      const words = String(T.title || 'Pacman Flipper').split(' ');
      logoLine(c, words[0], w / 2, h * 0.32, 126 * tu, LOGO_PAL.yellow);
      logoLine(c, words.slice(1).join(' '), w / 2, h * 0.76, 96 * tu, LOGO_PAL.pink);
    }
    function screenUnit() { return clamp(Math.min(cw / 620, ch / 730), 0.5, 1.5); }

    function drawTitle() {
      const tu = screenUnit(), cx = cw / 2, y0 = (ch - 700 * tu) / 2;
      ctx.fillStyle = 'rgba(6,9,38,0.7)'; ctx.fillRect(0, 0, cw, ch);
      glow('#0A0C34', cx, y0 + 330 * tu, 470 * tu, 0.55, dpr);
      glow('#7B6BFF', cx, y0 + 300 * tu, 430 * tu, 0.16, dpr);
      ensureLogo(tu);
      const bob = reduced ? 0 : sin(now * 1.3) * 4 * tu;
      ctx.drawImage(logoCanvas, cx - logoCanvas._w / 2, y0 + 130 * tu - logoCanvas._h / 2 + bob, logoCanvas._w, logoCanvas._h);
      if (!reduced) {   // two slow twinkles near the logo
        const s1 = sin(now * 1.7) * 0.5 + 0.5, s2 = sin(now * 1.7 + 2.4) * 0.5 + 0.5;
        ctx.globalAlpha = 0.9 * s1; A.sparkle(cx - 250 * tu, y0 + 58 * tu, 15 * tu * (0.6 + 0.4 * s1), { color: '#FFF3C4', glow: true });
        ctx.globalAlpha = 0.9 * s2; A.sparkle(cx + 262 * tu, y0 + 176 * tu, 13 * tu * (0.6 + 0.4 * s2), { color: '#FFD1E6', glow: true });
        ctx.globalAlpha = 1;
      }
      drawText(ctx, T.subtitle || '', cx, y0 + 296 * tu, 30 * tu, { align: 'center', base: 'middle', color: C.textMuted, weight: 500, maxW: cw * 0.92 });
      // a little parade: the four ghosts follow Pacman
      const gy = y0 + 385 * tu, sp = 108 * tu, gx0 = cx - 2 * sp;
      const cols = ['red', 'pink', 'cyan', 'orange'];
      for (let i = 0; i < 4; i++) {
        const gx = gx0 + i * sp, yy = gy + (reduced ? 0 : sin(now * 3 + i * 0.9) * 4 * tu);
        A.shadow(gx, gy + 32 * tu, 30 * tu, 7 * tu, 0.3);
        A.ghost(gx, yy, 33 * tu, { color: cols[i], mood: 'happy', look: { x: 1, y: 0.1 }, t: now + i * 0.6 });
      }
      const px = gx0 + 4 * sp;
      A.shadow(px, gy + 34 * tu, 32 * tu, 7 * tu, 0.3);
      A.pacman(px, gy + (reduced ? 0 : sin(now * 3 + 3.6) * 4 * tu), 37 * tu, { mouth: reduced ? 0.5 : 0.5 + 0.5 * sin(now * 8), dir: 0, mood: 'happy', t: reduced ? 0 : now });
      // start prompt
      const kp = st.keys && st.keys.space, ky = y0 + 505 * tu;
      const pulse = reduced || kp ? 1 : 1 + 0.04 * sin(now * 5.4);
      ctx.save(); ctx.translate(cx, ky); ctx.scale(pulse, pulse);
      A.keycap(0, 0, 250 * tu, 78 * tu, 'space', { pressed: !!kp });
      ctx.restore();
      const msg = touchMode ? T.press_start_touch : T.press_start;
      drawText(ctx, msg || '', cx, y0 + 590 * tu, 40 * tu, { align: 'center', base: 'middle', color: C.text, weight: 700, outline: 'rgba(14,18,74,0.85)', outlineW: 6 * tu, maxW: cw * 0.94 });
      // controls reminder for parents and children
      const hy = y0 + 655 * tu, kw = 54 * tu, kh = 44 * tu;
      const hint = (touchMode ? TR.hint_flippers_touch : null) || T.hint_flippers || '';
      ctx.font = fontOf(24 * tu, 600);
      const hw = ctx.measureText(hint).width, total = kw * 2 + 12 * tu + 22 * tu + hw, hx0 = cx - total / 2;
      A.keycap(hx0 + kw / 2, hy, kw, kh, 'left', { pressed: !!(st.keys && st.keys.left) });
      A.keycap(hx0 + kw * 1.5 + 12 * tu, hy, kw, kh, 'right', { pressed: !!(st.keys && st.keys.right) });
      drawText(ctx, hint, hx0 + kw * 2 + 34 * tu, hy, 24 * tu, { base: 'middle', color: C.textMuted, weight: 600 });
    }

    function drawPause() {
      const tu = screenUnit(), cx = cw / 2, cy = ch / 2;
      ctx.fillStyle = 'rgba(6,9,38,0.64)'; ctx.fillRect(0, 0, cw, ch);
      glow('#7B6BFF', cx, cy - 20 * tu, 360 * tu, 0.2, dpr);
      const breathe = reduced ? 1 : 1 + 0.025 * sin(now * 1.5);
      const r = 92 * tu;
      A.shadow(cx, cy - 30 * tu + r * 1.02, r * 0.95, r * 0.2, 0.3);
      ctx.save(); ctx.translate(cx, cy - 30 * tu + r); ctx.scale(breathe, breathe); ctx.translate(-cx, -(cy - 30 * tu + r));
      A.pacman(cx, cy - 30 * tu, r, { mood: 'sleepy', mouth: 0, dir: 0, t: reduced ? 0.35 : now });
      ctx.restore();
      drawText(ctx, T.paused || 'Szünet', cx, cy + 150 * tu, 84 * tu, { align: 'center', base: 'middle', color: C.text, weight: 700, outline: 'rgba(14,18,74,0.85)', outlineW: 8 * tu, maxW: cw * 0.9 });
      drawText(ctx, touchMode ? (TR.resume_touch || T.paused_hint) : (T.paused_hint || ''), cx, cy + 216 * tu, 30 * tu, { align: 'center', base: 'middle', color: C.textMuted, weight: 600, maxW: cw * 0.92 });
    }

    function drawOver() {
      const tu = screenUnit(), e = st.overT != null ? st.overT : now - screenT0, cx = cw / 2, cy = ch / 2;
      const s0 = (PM.Game && PM.Game.OVER_STAR_T0) || 0.9, sd = (PM.Game && PM.Game.OVER_STAR_DT) || 0.8;
      ctx.fillStyle = 'rgba(6,9,38,0.66)'; ctx.fillRect(0, 0, cw, ch);
      const w = Math.min(cw - 14, 560 * tu), h = Math.min(ch * 0.94, 660 * tu), x = cx - w / 2, y = cy - h / 2;
      const u = h / 660;   // content is laid out on a 660 tall card and scaled to fit
      const pop = Math.max(0.05, easeOutBack(clamp(e / 0.4, 0, 1)));
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(pop, pop); ctx.translate(-cx, -cy);
      panel(x, y, w, h, { fill: 'rgba(22,28,84,0.96)', r: 36 * u, edge: 'rgba(200,210,255,0.5)' });
      const stars = clamp(Math.round(+st.stars || 1), 1, 3);
      // top: a trophy for a new record, else a happy Pacman
      if (st.newRecord) {
        const b = reduced ? 0 : Math.abs(sin(now * 2.2)) * 6 * u;
        A.trophy(cx, y + 78 * u - b, 50 * u, {});
      } else {
        A.pacman(cx, y + 74 * u, 44 * u, { mouth: reduced ? 0.5 : 0.4 + 0.4 * sin(now * 5), dir: 0, mood: 'happy', t: reduced ? 0 : now });
      }
      drawText(ctx, T.great_job || '', cx, y + 152 * u, 44 * u, { align: 'center', base: 'middle', color: C.text, weight: 700, maxW: w * 0.9 });
      // stars pop in one by one
      for (let i = 0; i < 3; i++) {
        const sx = cx + (i - 1) * 142 * u, sy = y + 262 * u, r = 58 * u;
        const ee = e - (s0 + sd * i);
        A.star(sx, sy, r * 0.92, { color: '#59629F', alpha: 0.35 });   // an empty place; an earned star pops in on top of it
        if (i < stars && ee >= 0) {
          if (starPingDone <= i) {
            starPingDone = i + 1;
            emit({ type: 'sparkle', x: sx, y: sy, n: 7, color: '#FFF3C4' }, 1);
            emit({ type: 'ring', x: sx, y: sy, r: 34, color: '#FFD84A' }, 1);
          }
          const k = Math.max(0.02, easeOutBack(clamp(ee / 0.5, 0, 1)));
          const sway = reduced || ee < 0.6 ? 0 : sin(now * 1.6 + i) * 0.06;
          A.star(sx, sy, r * k, { color: '#FFD84A', face: true, glow: true, rot: sway + (1 - k) * 0.6 });
        }
      }
      // score counts up
      const shown = (+st.score || 0) * easeOutCubic(clamp((e - 0.3) / 1.4, 0, 1));
      drawText(ctx, T.score || 'Pontok', cx, y + 352 * u, 24 * u, { align: 'center', base: 'middle', color: C.textMuted });
      drawText(ctx, fmtNum(shown), cx, y + 410 * u, 78 * u, { align: 'center', base: 'middle', color: C.accent, weight: 700, maxW: w * 0.86 });
      if (st.newRecord) {
        drawText(ctx, T.new_record || '', cx, y + 474 * u, 38 * u, { align: 'center', base: 'middle', color: C.accent2, weight: 700, maxW: w * 0.86 });
      } else {
        A.crown(cx - 96 * u, y + 474 * u, 17 * u, {});
        drawText(ctx, (T.best || 'Rekord') + ': ' + fmtNum(Math.max(+st.hiScore || 0, +st.score || 0)), cx - 66 * u, y + 474 * u, 28 * u, { base: 'middle', color: C.text, weight: 600, maxW: w * 0.6 });
      }
      // play again
      // Space is ignored until the stars are done (the game's overLock): keycap and prompt stay dim and still until then, so a
      // child who presses early does not think the game is stuck, and the key visibly wakes up when Space starts to work
      const unlockAt = ((PM.Game && PM.Game.TUNE && PM.Game.TUNE.overLock) || 1.0) + sd * stars;
      const ready = clamp((e - unlockAt) / 0.25 + 1, 0, 1), ra = 0.4 + 0.6 * ready;
      const kp = st.keys && st.keys.space && ready >= 1, pulse = reduced || kp || ready < 1 ? 1 : 1 + 0.04 * sin(now * 5.4);
      ctx.save(); ctx.translate(cx, y + 540 * u); ctx.scale(pulse, pulse); ctx.globalAlpha *= ra;
      A.keycap(0, 0, 210 * u, 64 * u, 'space', { pressed: !!kp });
      ctx.restore();
      const lines = wrapLines(touchMode ? (T.play_again_touch || T.play_again) : T.play_again, 27 * u, w * 0.88, 600);
      for (let i = 0; i < lines.length; i++) drawText(ctx, lines[i], cx, y + 600 * u + i * 30 * u, 27 * u, { align: 'center', base: 'middle', color: C.text, weight: 600, alpha: ra });
      ctx.restore();
      // gentle confetti for a great game (window space, at most the particle budget)
      if (e > 1.2 && !reduced && stars >= 2) {
        overSpawn -= dt;
        if (overSpawn <= 0) {
          overSpawn = stars === 3 ? 0.16 : 0.5;
          emit({ type: 'confetti', x: x + w * (0.1 + 0.8 * rng()), y: y + 6 * u, n: stars === 3 ? 3 : 2 }, 1);
        }
      }
    }

    // ---------------------------------------------------------------------------------------------------------
    // TEN MINUTE GOODBYE (SPEC 9.2): the notice (a big friendly Pacman with a speech bubble), the small persistent 'last ball' badge and the
    // goodbye screen. Timing comes from state.limit.t (seconds inside the current phase); junk in state.limit reads as phase 'none'.
    function limText(key) {
      const t = PM.T || {}, a = isObj(t[key]) ? t[key] : null, r = isObj(t.r) && isObj(t.r[key]) ? t.r[key] : null;
      return { text: (a && typeof a.text === 'string' && a.text) ? a.text : str(r && r.text, ''), sub: (a && typeof a.sub === 'string') ? a.sub : str(r && r.sub, '') };
    }
    function goodbyeText() {
      const t = PM.T || {}, a = isObj(t.goodbye) ? t.goodbye : {}, r = isObj(t.r) && isObj(t.r.goodbye) ? t.r.goodbye : {};
      const pick = (k) => (typeof a[k] === 'string' && a[k]) ? a[k] : str(r[k], '');
      return { title: pick('title'), line1: pick('line1'), line2: pick('line2'), parents: pick('parents') };
    }
    function phaseT() { return st.limT != null ? Math.max(0, st.limT) : Math.max(0, now - lim.t0); }

    // Biggest font size (from maxSize down to minSize) at which the text wraps into at most maxLines lines of width w. Cached.
    function fitLines(text, w, maxSize, minSize, weight, maxLines) {
      const key = 'F|' + text + '|' + Math.round(w) + '|' + Math.round(maxSize * 10) + '|' + Math.round(minSize) + '|' + weight + '|' + maxLines;
      let v = fitCache.get(key);
      if (v) return v;
      let size = Math.max(minSize, maxSize), lines = [];
      for (let k = 0; k < 40; k++) {
        lines = wrapLines(text, size, w, weight);
        let ok = lines.length <= maxLines;
        if (ok) { ctx.font = fontOf(size, weight); for (let i = 0; i < lines.length; i++) if (ctx.measureText(lines[i]).width > w + 0.5) ok = false; }
        if (ok || size <= minSize) break;
        size = Math.max(minSize, size * 0.94);
      }
      v = { size: size, lines: lines };
      if (fitCache.size > 120) fitCache.clear();
      fitCache.set(key, v);
      return v;
    }
    // A title (up to 2 lines) with an optional smaller sub text (up to 3 lines) that fits in tw x th. Cached.
    function blockLayout(title, sub, tw, th, maxSize) {
      const key = 'B|' + title + '|' + sub + '|' + Math.round(tw) + '|' + Math.round(th) + '|' + Math.round(maxSize * 10);
      let v = fitCache.get(key);
      if (v) return v;
      let s = maxSize, T = null, S = null, h = 0;
      for (let k = 0; k < 14; k++) {
        T = fitLines(title, tw, s, 8, 700, 2);
        S = sub ? fitLines(sub, tw, Math.max(8, T.size * 0.66), 8, 600, 3) : null;
        h = T.lines.length * T.size * 1.16 + (S ? T.size * 0.2 + S.lines.length * S.size * 1.2 : 0);
        if (h <= th) break;
        s *= 0.9;
      }
      v = { T: T, S: S, h: h };
      if (fitCache.size > 120) fitCache.clear();
      fitCache.set(key, v);
      return v;
    }
    function textBlock(B, x, y, th, ink, inkSub, tw) {   // draws a blockLayout result, vertically centred in [y, y+th]
      let cy = y + (th - B.h) / 2;
      for (let i = 0; i < B.T.lines.length; i++) {
        drawText(ctx, B.T.lines[i], x, cy + B.T.size * 0.58, B.T.size, { base: 'middle', weight: 700, color: ink, maxW: tw });
        cy += B.T.size * 1.16;
      }
      if (B.S) {
        cy += B.T.size * 0.2;
        for (let i = 0; i < B.S.lines.length; i++) {
          drawText(ctx, B.S.lines[i], x, cy + B.S.size * 0.6, B.S.size, { base: 'middle', weight: 600, color: inkSub, maxW: tw });
          cy += B.S.size * 1.2;
        }
      }
    }

    // where everything of the notice goes inside its stage rectangle R
    function noticeGeom(R) {
      const uu = layout.hud.uu, tall = layout.mode === 'tall';
      const pad = tall ? 6 * uu : 12 * uu;
      const pr = Math.max(8, Math.min(R.h * (tall ? 0.4 : 0.26), R.w * (tall ? 0.15 : 0.145), 96 * uu));
      const gap = 9 * uu;
      let px = R.x + pad + pr, bx = px + 1.95 * pr + gap, bw = R.x + R.w - pad - bx, shift = 0;
      const maxW = 470 * uu;
      if (bw > maxW) { shift = (bw - maxW) / 2; bw = maxW; }   // a wide band: the whole group is centred
      const bh = tall ? R.h - 4 : Math.min(R.h * 0.88, 210 * uu), by = R.y + (R.h - bh) / 2;
      const py = R.y + R.h * (tall ? 0.5 : 0.52);
      return { tall: tall, uu: uu, pr: pr, px: px + shift, py: py, bx: bx + shift, bw: Math.max(20, bw), by: by, bh: bh, pad: pad };
    }

    // the speech bubble: a rounded box with a tail on its left side that points at Pacman's mouth
    function bubblePath(x, y, w, h, r, tailY, tl, tv) {
      r = Math.min(r, w / 2, h / 2);
      tailY = clamp(tailY, y + r + tl, y + h - r - tl);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.lineTo(x, tailY + tl); ctx.lineTo(x - tv, tailY); ctx.lineTo(x, tailY - tl);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    // Notice: Pacman slides in from the left edge and pops (ease-out-back), the bubble pops out of his mouth a moment later.
    // tn = seconds since the phase began; mul = extra alpha (the shrink into the badge fades it out)
    function drawNoticeBlock(R, tn, mul) {
      const G = noticeGeom(R), uu = G.uu, pr = G.pr, px = G.px, py = G.py;
      const k1 = easeOutCubic(clamp(tn / 0.55, 0, 1));
      const k2 = Math.max(0.05, easeOutBack(clamp(tn / 0.6, 0, 1)));
      const k3 = Math.max(0.05, easeOutBack(clamp((tn - 0.3) / 0.5, 0, 1)));
      const T0 = limText('limit_notice');
      ctx.save();
      ctx.globalAlpha = clamp(mul * k1 * 1.6, 0, 1);
      ctx.translate(-(1 - k1) * (px + 2.4 * pr + 30), 0);
      if (G.tall) panel(R.x, R.y, R.w, R.h, { fill: 'rgba(24,30,88,0.98)', edge: 'rgba(255,216,74,0.7)', r: Math.min(R.h * 0.3, 20) });
      else glow('#FFD84A', px + pr * 0.5, py, pr * 2.7, 0.15, dpr);
      // Pacman
      const talk = reduced ? 0.45 : 0.5 + 0.24 * sin(now * TAU * 1.2);
      const blink = (now % 4.3) < 0.13 && !reduced ? 1 : 0;
      A.shadow(px + pr * 0.35, py + pr * 1.08, pr * 1.15, pr * 0.2, 0.3);
      ctx.save();
      ctx.translate(px, py + pr); ctx.scale(0.55 + 0.45 * k2, 0.55 + 0.45 * k2); ctx.translate(-px, -(py + pr));
      A.wave(px, py, pr, { wave: reduced ? 0 : 1, phase: lim.ph, open: talk, blink: blink });
      ctx.restore();
      // bubble: sizes come from the largest possible box; on a wide layout the box then shrinks to the height its text needs
      const bx = G.bx, bw = G.bw, bhMax = G.bh, ox = bx - 6 * uu, oy = py + pr * 0.1;
      const cr = Math.min(bhMax * (G.tall ? 0.3 : 0.2), 30 * uu), ip = Math.max(5, bhMax * 0.1), pv = Math.max(4, bhMax * 0.08);
      const tx = bx + ip + 2 * cr + Math.max(5, bhMax * 0.07), tw = bx + bw - ip - tx;
      const B = blockLayout(T0.text, T0.sub, tw, bhMax - 2 * pv, Math.min(34 * uu, bhMax * 0.3));
      const bh = G.tall ? bhMax : Math.min(bhMax, Math.max(B.h + 2 * pv + 4 * uu, 2 * cr + 2 * pv)), by = R.y + (R.h - bh) / 2;
      ctx.save();
      ctx.globalAlpha *= clamp(k3 * 1.5, 0, 1);
      ctx.translate(ox, oy); ctx.scale(k3, k3); ctx.translate(-ox, -oy);
      const rad = Math.min(bh * 0.3, 26 * uu), tl = Math.min(bh * 0.14, 9 * uu), tv = 11 * uu;
      ctx.save(); ctx.translate(1.5, 4); bubblePath(bx, by, bw, bh, rad, oy, tl, tv); ctx.fillStyle = 'rgba(3,5,28,0.34)'; ctx.fill(); ctx.restore();
      bubblePath(bx, by, bw, bh, rad, oy, tl, tv);
      ctx.fillStyle = '#FFF8E7'; ctx.fill();
      ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1.5, bh * 0.03); ctx.strokeStyle = 'rgba(90,100,200,0.55)'; ctx.stroke();
      A.clock(bx + ip + cr, by + bh / 2, cr, { t: reduced ? 0 : now });
      textBlock(B, tx, by + pv, bh - 2 * pv, '#241D52', '#4C477F', tw);
      ctx.restore();
      ctx.restore();
    }

    // The small persistent badge for the last ball: a tiny waving Pacman and "Utolso labda"
    function drawBadge(B, tl) {
      if (B.w < 30 || B.h < 24 || tl < 0) return;
      const uu = layout.hud.uu, k = Math.max(0.05, easeOutBack(clamp(tl / 0.45, 0, 1)));
      const T0 = limText('limit_last');
      const cx = B.x + B.w / 2, cy = B.y + B.h / 2;
      ctx.save();
      ctx.globalAlpha = clamp(k * 1.6, 0, 1);
      ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
      panel(B.x, B.y, B.w, B.h, { edge: 'rgba(255,216,74,0.75)' });
      const pr = Math.min(B.h * 0.3, 40 * uu), px = B.x + B.h * 0.14 + pr * 1.05, py = B.y + B.h * 0.56;
      A.wave(px, py, pr, { wave: reduced ? 0 : 1, phase: lim.ph, open: 0.36, blink: (now % 4.3) < 0.13 && !reduced ? 1 : 0 });
      const tx = px + 1.95 * pr + 7 * uu, tw = B.x + B.w - B.h * 0.12 - tx, th = B.h * 0.8;
      if (tw > 16) textBlock(blockLayout(T0.text, T0.sub, tw, th, B.h * 0.34), tx, B.y + B.h * 0.1, th, C.text, C.textMuted, tw);
      ctx.restore();
    }

    function drawLimit() {
      const ph = st.limPhase;
      if (ph !== 'notice' && ph !== 'last') return;
      if (st.screen !== 'play' && st.screen !== 'paused') return;
      const H = layout.hud;
      if (!H.notice || !H.badge) return;
      const tl = phaseT();
      if (ph === 'notice') { drawNoticeBlock(H.notice, tl, 1); return; }
      if (lim.noticeSeen && tl < 0.55) {   // the notice shrinks toward the badge (opaque until it is small), then fades while the badge grows
        const R = H.notice, B = H.badge, e = smooth(tl / 0.55);
        const cxR = R.x + R.w / 2, cyR = R.y + R.h / 2, cxB = B.x + B.w / 2, cyB = B.y + B.h / 2;
        ctx.save();
        ctx.translate(cxR + (cxB - cxR) * e, cyR + (cyB - cyR) * e);
        const s = lerp(1, Math.min(B.w / R.w, B.h / R.h) * 0.9, e); ctx.scale(s, s);
        ctx.translate(-cxR, -cyR);
        drawNoticeBlock(R, 99, 1 - smooth((e - 0.3) / 0.4));
        ctx.restore();
      }
      drawBadge(H.badge, lim.noticeSeen ? tl - 0.3 : tl);
    }

    // sparse hearts and stars that drift up on the goodbye screen: nothing flashes, at most a dozen slow shapes
    function drawFloaters(u) {
      if (reduced) return;   // reduced motion: a calm screen without drifting shapes
      const N = 9, t = now;
      for (let i = 0; i < N; i++) {
        const per = 15 + (i * 7) % 8, ph = ((t / per) + (i * 0.6180339) % 1) % 1;
        const fx = ((i * 0.7548776 + 0.13) % 1), size = (9 + (i * 5) % 7) * u;
        const x = fx * cw + sin(ph * TAU * 1.3 + i * 1.7) * 14 * u, y = ch * (1.05 - 1.1 * ph);
        const a = 0.5 * Math.pow(sin(ph * PI), 1.2);
        if (a < 0.02) continue;
        ctx.globalAlpha = a;
        if (i % 2) A.heart(x, y, size, { color: i % 4 === 1 ? '#FF9ECB' : '#FFB3D1' });
        else A.star(x, y, size, { color: i % 4 === 0 ? '#FFD84A' : '#B9C2FF', glow: false, rot: sin(ph * TAU + i) * 0.3 });
      }
      ctx.globalAlpha = 1;
    }

    // The goodbye screen. Laid out on a design stage (560 wide for portrait windows, 920 wide for landscape ones) that is scaled to fit.
    const gb = { key: '', land: false, Wd: 560, Hd: 700, r: 100, pcx: 0, pcy: 0, txt: [], starsY: 0, scoreY: 0, colX: 0 };
    function goodbyeLayout(Tg) {
      const key = cw + 'x' + ch + '|' + Tg.title + '|' + Tg.line1 + '|' + Tg.line2;
      if (gb.key === key) return gb;
      gb.key = key; gb.txt.length = 0;
      const land = gb.land = cw / ch >= 1.3;
      const Wd = gb.Wd = land ? 920 : 560, colW = land ? 480 : 520, colX = gb.colX = land ? 660 : 280;
      const r = gb.r = land ? 118 : 100;
      let y = 0;
      if (!land) { gb.pcx = 280 - 0.475 * r; gb.pcy = 24 + 1.1 * r; y = gb.pcy + 1.3 * r + 8; } else y = 10;
      const put = (text, size, weight, color, lh, at) => {
        if (!text) return;
        const lines = wrapLines(text, size, colW, weight);
        for (let i = 0; i < lines.length; i++) gb.txt.push({ s: lines[i], size: size, weight: weight, color: color, y: y + lh * (i + 0.5), at: at, outline: size > 60 });
        y += lines.length * lh;
      };
      put(Tg.title, 96, 700, C.accent, 100, 0.5); y += 8;
      put(Tg.line1, 38, 700, C.text, 47, 0.9); y += 10;
      put(Tg.line2, 32, 600, '#E6EAFF', 41, 1.3); y += 22;
      gb.starsY = y + 26; y += 62;
      gb.scoreY = y + 18; y += 46;
      const bodyBottom = land ? Math.max(y, 2 * 1.3 * r + 24) : y;
      if (land) { gb.pcx = 205 - 0.475 * r; gb.pcy = bodyBottom / 2 - 8; }
      gb.Hd = bodyBottom + 6;
      return gb;
    }

    function drawGoodbye() {
      const e = now - screenT0, Tg = goodbyeText();
      ctx.globalAlpha = 0.85 * smooth(e / 0.9); ctx.fillStyle = '#060926'; ctx.fillRect(0, 0, cw, ch); ctx.globalAlpha = 1;
      const L = goodbyeLayout(Tg);
      const pu = clamp(Math.min(cw / 560, ch / 700), 0.7, 1.6), strip = Tg.parents ? 44 * pu : 0;   // the bottom strip is for the parent line
      const u = Math.min(cw * 0.95 / L.Wd, (ch - strip) * 0.94 / L.Hd, L.land ? 2.2 : 1.9), x0 = (cw - L.Wd * u) / 2, y0 = (ch - strip - L.Hd * u) / 2;
      drawFloaters(u);
      ctx.save();
      ctx.translate(x0, y0); ctx.scale(u, u);
      const r = L.r, pcx = L.pcx, pcy = L.pcy;
      // Pacman: pops in, waves slowly (about 1 Hz), hops once for every poke
      const k = Math.max(0.05, easeOutBack(clamp((e - 0.15) / 0.7, 0, 1)));
      const pk = lim.pokeT, pj = 1 - pk;
      const hop = reduced || pk <= 0 ? 0 : -sin(pj * PI) * 0.22 * r, sq = reduced || pk <= 0 ? 0 : 0.05 * sin(pj * TAU);
      glow('#FFD84A', pcx + r * 0.5, pcy, r * 2.7, 0.14 * clamp(k, 0, 1), dpr * u);
      ctx.globalAlpha = clamp(k * 1.5, 0, 1);
      A.shadow(pcx + r * 0.35, pcy + r * 1.16, r * 1.2 * (1 + hop / r * 0.3), r * 0.2, 0.3);
      ctx.save();
      const sc = k * (1 - sq), sy = k * (1 + sq);
      ctx.translate(pcx, pcy + r + hop); ctx.scale(sc, sy); ctx.translate(-pcx, -(pcy + r));
      const open = reduced ? 0.4 : Math.max(0.36 + 0.14 * sin(now * TAU * 0.8), pk * 0.95);
      A.wave(pcx, pcy, r, { wave: reduced ? 0 : 1, phase: lim.ph, open: open, blink: (now % 4.6) < 0.13 && !reduced ? 1 : 0 });
      ctx.restore();
      ctx.globalAlpha = 1;
      lim.gbX = x0 + pcx * u; lim.gbY = y0 + pcy * u; lim.gbR = r * u; lim.gbOn = true;
      // the big soft lines
      for (let i = 0; i < L.txt.length; i++) {
        const t = L.txt[i], a = smooth((e - t.at) / 0.6);
        if (a <= 0.01) continue;
        drawText(ctx, t.s, L.colX, t.y, t.size, { align: 'center', base: 'middle', weight: t.weight, color: t.color, alpha: a, outline: 'rgba(14,18,74,0.85)', outlineW: t.size * (t.outline ? 0.12 : 0.1), maxW: L.land ? 490 : 530 });
      }
      // stars and score, small
      const sa = smooth((e - 1.8) / 0.6);
      if (sa > 0.01) {
        const stars = clamp(Math.round(st.stars), 1, 3);
        ctx.globalAlpha = sa;
        for (let i = 0; i < stars; i++) {   // only the earned stars, centred: one gold star beside two dim ones read as a poor result
          const sx = L.colX + (i - (stars - 1) / 2) * 62;
          A.star(sx, L.starsY, 24, { color: '#FFD84A', glow: false });
        }
        ctx.globalAlpha = 1;
        drawText(ctx, (T.score || 'Pontok') + ': ' + fmtNum(st.score) + (st.newRecord ? '  ' + (T.new_record || '') : ''), L.colX, L.scoreY, 30, { align: 'center', base: 'middle', color: C.accent, weight: 700, alpha: sa, maxW: 500 });
      }
      ctx.restore();
      // the small line for the parents, pinned to the bottom of the window
      if (Tg.parents) {
        const F = fitLines(Tg.parents, cw * 0.92, 17 * pu, 10, 500, 2), pa = smooth((e - 2.6) / 0.8) * 0.9, lh = F.size * 1.3;
        for (let i = 0; i < F.lines.length; i++) drawText(ctx, F.lines[i], cw / 2, ch - 12 * pu - (F.lines.length - i - 0.5) * lh, F.size, { align: 'center', base: 'middle', color: C.textMuted, weight: 500, alpha: pa });
      }
    }

    function drawScreens() {
      switch (st.screen) {
        case 'title': drawTitle(); break;
        case 'paused': drawPause(); break;
        case 'over': drawOver(); break;
        case 'goodbye': drawGoodbye(); break;
      }
      drawFx(1);
    }

    // ---------------------------------------------------------------------------------------------------------
    // THE FRAME
    // The game state is copied field by field into V every frame, with wrong types replaced by harmless defaults, so a
    // strange value can never poison a whole drawing section. Objects inside lists are still checked where they are used.
    const EMPTY = {}, EARR = [];
    const V = {
      screen: 'play', score: 0, hiScore: 0, newRecord: false, ballNo: 1, ballsTotal: 5, ballsLeft: 0, multiplier: 1, level: 1,
      dotsLeft: null, ballSave: 0, stars: 0, overT: null, multiball: false,
      lanes: EARR, power: null, surprise: null, banner: null, popups: EARR, ghosts: EARR, balloons: EARR, fruit: null, fruits: null,
      fruitTray: EARR, mystery: null, delights: undefined, launch: EMPTY, keys: EMPTY, ui: EMPTY, nori: null, pacmanHelper: null, locked: null,
      limPhase: 'none', limT: null, limPoke: 0
    };
    function readState() {
      const s = isObj(game.state) ? game.state : EMPTY;
      V.screen = str(s.screen, 'play');
      V.score = fin(s.score, 0); V.hiScore = fin(s.hiScore, 0); V.newRecord = !!s.newRecord;
      V.ballNo = fin(s.ballNo, 1); V.ballsTotal = fin(s.ballsTotal, (CFG && CFG.BALLS_PER_GAME) || 5); V.ballsLeft = fin(s.ballsLeft, 0);
      V.multiplier = fin(s.multiplier, 1); V.level = fin(s.level, 1);
      V.dotsLeft = fin(s.dotsLeft, null); V.ballSave = fin(s.ballSave, 0); V.stars = fin(s.stars, 0); V.overT = fin(s.overT, null);
      V.multiball = !!s.multiball;
      V.lanes = Array.isArray(s.lanes) ? s.lanes : EARR;
      V.power = isObj(s.power) ? s.power : null;
      V.surprise = isObj(s.surprise) ? s.surprise : null;
      V.banner = isObj(s.banner) ? s.banner : null;
      V.popups = Array.isArray(s.popups) ? s.popups : EARR;
      V.ghosts = Array.isArray(s.ghosts) ? s.ghosts : EARR;
      V.balloons = Array.isArray(s.balloons) ? s.balloons : EARR;
      V.fruit = isObj(s.fruit) ? s.fruit : null;
      V.fruits = Array.isArray(s.fruits) ? s.fruits : null;
      V.fruitTray = Array.isArray(s.fruitTray) ? s.fruitTray : EARR;
      V.mystery = isObj(s.mystery) ? s.mystery : null;
      V.delights = Array.isArray(s.delights) ? s.delights : undefined;
      V.launch = isObj(s.launch) ? s.launch : EMPTY;
      V.keys = isObj(s.keys) ? s.keys : EMPTY;
      V.ui = isObj(s.ui) ? s.ui : EMPTY;
      V.nori = isObj(s.nori) ? s.nori : null;
      V.pacmanHelper = isObj(s.pacmanHelper) ? s.pacmanHelper : null;
      V.locked = isObj(s.locked) ? s.locked : null;
      const L = isObj(s.limit) ? s.limit : null;   // SPEC 9.2: {phase:'none'|'notice'|'last'|'goodbye', t, poke, ...}; junk is ignored
      const ph = L ? L.phase : null;
      V.limPhase = ph === 'notice' || ph === 'last' || ph === 'goodbye' ? ph : 'none';
      V.limT = L ? fin(L.t, null) : null;
      V.limPoke = L ? Math.max(0, Math.min(1e9, Math.floor(fin(L.poke, 0)))) : 0;
      return V;
    }
    // ctx.save/restore are counted so that a section that throws half way cannot leave the canvas state stacked up
    let saveDepth = 0;
    const rawSave = ctx.save, rawRestore = ctx.restore;
    ctx.save = function () { saveDepth++; rawSave.call(ctx); };
    ctx.restore = function () { if (saveDepth > 0) saveDepth--; rawRestore.call(ctx); };
    const lastLog = {};
    function guard(name, fn) {
      const d0 = saveDepth;
      try { fn(); }
      catch (e) {
        while (saveDepth > d0) ctx.restore();
        errCount[name] = (errCount[name] || 0) + 1;
        // report each section at most once every 20 seconds, but keep drawing: one bad frame must not blank the game
        if (typeof console !== 'undefined' && (lastLog[name] == null || now - lastLog[name] > 20)) { lastLog[name] = now; console.error('[render] ' + name + ':', e); }
      }
      ctx.globalAlpha = 1;
    }
    function drawTableBase() {
      setTableTransform();
      ctx.globalAlpha = 1;
      ctx.drawImage(tableCache, -CACHE_M, -CACHE_M, tableCache.width / sprPx, tableCache.height / sprPx);
    }
    function secDynamic() { setTableTransform(); drawTableDynamic(); }
    function secBanner() {
      if (st.screen === 'paused' || st.screen === 'over' || st.screen === 'goodbye') return;
      if ((st.limPhase === 'notice' || st.limPhase === 'last') && isObj(st.banner) && st.banner.kind === 'limit') return;   // the notice draws the same words itself
      setTableTransform(); drawBanner();
    }
    function secFront() { setTableTransform(); drawTableFront(); }
    function secHud() { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawHud(); }
    function secScreens() { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawScreens(); }

    function drawFrame(nowSec) {
      if (!layout) resize();
      const first = lastNow == null;
      dt = first ? 0.016 : clamp(nowSec - lastNow, 0, 0.1);
      lastNow = nowSec; now = nowSec;
      st = readState(); world = isObj(game.world) && Array.isArray(game.world.balls) ? game.world : null;
      if (!!st.ui.touch !== touchMode) relayout();
      ensureCaches();
      if (first) { dispScore = +st.score || 0; lastScore = dispScore; screenT0 = now; }
      guard('update', update);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      guard('backdrop', drawBackdrop);
      guard('tableBase', drawTableBase);
      guard('dynamic', secDynamic);
      guard('banner', secBanner);
      guard('front', secFront);
      guard('hud', secHud);
      guard('screens', secScreens);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function draw(nowSec) {
      const t0 = perf();
      try { drawFrame(+nowSec || 0); }
      catch (e) { if (!errCount._frame) { errCount._frame = 1; if (typeof console !== 'undefined') console.error('[render] frame:', e); } }
      // adaptive quality: if frames stay slow, drop the ambient extras first
      const cpu = perf() - t0;
      cpuEma += (cpu - cpuEma) * 0.05;
      if (dt > 0) perfEma += (dt * 1000 - perfEma) * 0.05;
      stats.ms = cpuEma; stats.fps = 1000 / Math.max(1, perfEma);
      if (perfEma > 20 && cpuEma > 6) { perfBad += dt; perfGood = 0; }
      else if (perfEma < 18 && cpuEma < 4) { perfGood += dt; perfBad = Math.max(0, perfBad - dt); }
      else perfBad = Math.max(0, perfBad - dt * 0.5);
      if (perfBad > 2.5 && quality > 0) { quality--; perfBad = 0; render.quality = stats.quality = quality; if (fx.n > fxLimit()) fx.n = fxLimit(); }
      else if (perfGood > 30 && quality < 2) { quality++; perfGood = 0; render.quality = stats.quality = quality; }
    }

    resize();
    if (PM.Theme && PM.Theme.fontsReady && PM.Theme.fontsReady.then) PM.Theme.fontsReady.then(() => { logoKey = ''; cacheKey = ''; fitCache.clear(); gb.key = ''; });
    return render;
  }

  PM.Render = { create: create };
})(typeof globalThis !== 'undefined' ? globalThis : window);
