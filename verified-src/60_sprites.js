/* 60_sprites.js: PM.Theme (palette, font) and PM.Sprites (all vector art). Browser only (needs a 2D canvas context).
   Everything is drawn with paths and gradients, no images. Every function is pure drawing: state comes in through the
   options, nothing is remembered between calls. Origin is the CENTER of the thing, r is its radius (or half size).
   All functions tolerate missing options. `t` is animation time in seconds (from the renderer, not Date.now).
   Every sprite also accepts {alpha:0..1} (multiplies ctx.globalAlpha for that sprite only).

   PM.Theme
     colors            palette, see the keys below
     font(px, weight=600) -> css font string (Fredoka with fallbacks)
     fontsReady        Promise, resolves when the font is usable or after 1.2 s at the latest (never rejects, never blocks)
   PM.Theme.colors keys
     backdrop: bg0 (deep navy) bg1 bg2 (indigo), bgDot (very soft pattern), tableFill, tableFill2
     maze: wall, wallDark, wallFill, wallGlow (rgba)
     pickups: dot, pellet
     pacman: pacman, pacmanLight, pacmanDark, cheek
     ghosts: ghost {red,pink,cyan,orange}, ghostBlue
     ball: ball, ballDark
     parts: flipper, flipperLight, flipperDark, post, sling, bumperRing, balloons[7]
     ui: text, textMuted, panel (rgba), panelSolid, panelEdge (rgba), accent (butter), accent2 (pink), good, ink (dark text for use on accent)
     ink2 (dark eye/mouth color used by all faces)

   PM.Sprites (all draw at x,y with radius r unless noted)
     pacman(ctx,x,y,r,{mouth:0..1=.5, dir:rad=0, mood:'happy'|'chomp'|'surprised'|'sleepy'='happy', blink:0..1=0, bow:false, interior:false, t})
        dir turns the whole body; the eye stays on the upper side when facing left. mouth 0 = closed (smile line).
        interior:true fills the open mouth with a dark cavity and tongue (used by pacmanBig). sleepy draws floating zzz using t.
     pacmanBig(ctx,x,y,r,{open:0..1=.7, mood, t, bow, blink})  the ball-saver: faces UP with the mouth open upwards and a dark cavity.
        Same size rules as pacman (r = body radius). Bounding box is the full circle.
     ghost(ctx,x,y,r,{color:'red'|'pink'|'cyan'|'orange'='red', mood:'normal'|'blue'|'dizzy'|'happy'|'giggle'|'dance'='normal',
                      look:{x,y} (direction to look at, length 0..1 is amount; longer vectors are normalised), t, squash:{x:1,y:1}})
        squash pivots on the bottom of the skirt. Body spans x in [-r,r], y in [-r,r]; blue/dizzy orbiters reach about 1.35r above.
     fruit(ctx,kind,x,y,r,{t})  kind: cherry strawberry orange apple pear grapes. Fits inside radius r (bobs by about 0.05r with t).
     dot(ctx,x,y,r,{color})     small cream dot with a very faint halo
     pellet(ctx,x,y,r,{t})      power pellet, soft glow that breathes about 0.7 times per second (halo reaches 2.6r)
     star(ctx,x,y,r,{color, rot, face:false, glow:false})  rounded five point star; face:true adds a smiling face (game over stars)
     balloon(ctx,x,y,r,{color, t})  r = half width of the balloon body; the string hangs about 3.2r below the center.
        color = css color or a ghost color name or 'yellow','mint','lilac'
     heart(ctx,x,y,r,{color, t})
     sparkle(ctx,x,y,r,{color, rot, glow:false})   soft four point twinkle
     confetti(ctx,x,y,r,{color, rot, shape:'rect'|'circle'|'tri'|'ribbon', flip:0..1})   flip spins it around its long axis
     speech(ctx,x,y,w,h,{tail:'down'|'up'|'left'|'right'|'none', tailPos:-1..1, color, edge, text, size, textColor})   x,y = center of the box
     crown(ctx,x,y,r,{color})   trophy(ctx,x,y,r,{color})
     questionBlock(ctx,x,y,r,{t, pressed:false})   the mystery target look (also PM.Sprites.mystery); r = half side
     keycap(ctx,x,y,w,h,label,{pressed})   label: 'left' | 'right' | 'space' | any short text. x,y = center of the whole key
     icon(ctx,name,x,y,size,{color})   speaker speakerOff music musicOff pause play fullscreen question tunnel house. size = box side
     ball(ctx,x,y,r,{spin:rad})        pearly steel pinball (the fallback; the game draws pacmanBall)
     pacmanBall(ctx,x,y,r,{dir:rad, mouth:0..1, bow})   the ball as a small Pacman (SPEC 9.1): flat butter body with a thin amber rim, a dark
        separation ring just outside it, a tiny upright eye; mouth 0 = closed content smile, 0.2 to 0.85 is the chomp range; bow = pink bow
     pacmanWave(ctx,x,y,r,{wave:0..1, phase:cycles, open:0..1, blink, side:1|-1, hand:true, bow})   the big friendly Pacman with the white
        cartoon glove (goodbye notice, badge and screen). The caller owns the clock: phase is the wave phase in cycles, wave the swing (0 = still).
     clock(ctx,x,y,r,{t})              little pink alarm clock, the minute hand crawls with t
     glow(ctx,x,y,r,color,alpha=.3)    soft round glow (radial gradient), handy behind things
     shadow(ctx,x,y,rx,ry,alpha=.25)   soft ellipse shadow
     zzz(ctx,x,y,size,{t,color})       three floating Z letters
   Lists for tests and menus: PM.Sprites.FRUITS, GHOST_COLORS, GHOST_MOODS, PACMAN_MOODS, ICONS.
*/
(function (g) {
  'use strict';
  const PM = g.PM = g.PM || {};
  const U = PM.util;
  const PI = Math.PI, TAU = Math.PI * 2;
  const sin = Math.sin, cos = Math.cos, abs = Math.abs;
  const clamp = U.clamp;

  // ---------- colour helpers (cached, so per-frame calls do no string building for hex colours) ----------
  const cache = new Map();
  function parseHex(h) {
    if (typeof h !== 'string' || h.charAt(0) !== '#') return null;
    if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    if (h.length !== 7) return null;
    return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
  }
  // amt > 0 mixes toward white, amt < 0 toward black
  function shade(hex, amt) {
    const key = hex + '|' + amt;
    let v = cache.get(key);
    if (v) return v;
    const c = parseHex(hex);
    if (!c) return hex;
    const tgt = amt >= 0 ? 255 : 0, k = abs(amt);
    v = 'rgb(' + Math.round(c[0] + (tgt - c[0]) * k) + ',' + Math.round(c[1] + (tgt - c[1]) * k) + ',' + Math.round(c[2] + (tgt - c[2]) * k) + ')';
    cache.set(key, v);
    return v;
  }
  function withAlpha(hex, a) {
    const key = hex + '@' + a;
    let v = cache.get(key);
    if (v) return v;
    const c = parseHex(hex);
    if (!c) return hex;
    v = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
    cache.set(key, v);
    return v;
  }

  // ---------- Theme ----------
  const COL = {
    bg0: '#0B1030', bg1: '#161B45', bg2: '#27236B', bgDot: '#2E3585',
    tableFill: '#0F1543', tableFill2: '#1A2058',
    wall: '#9AA6F7', wallDark: '#5560BF', wallFill: '#1F2668', wallGlow: 'rgba(154,166,247,0.30)',
    dot: '#FFF0CF', pellet: '#FFF6DC',
    pacman: '#FFD84A', pacmanLight: '#FFF0A0', pacmanDark: '#F2B12C', cheek: '#FF8FA3',
    ghost: { red: '#FF6B6B', pink: '#FF9ECB', cyan: '#6FDCF0', orange: '#FFB45C' },
    ghostBlue: '#8F9CFF',
    ball: '#E9EEFB', ballDark: '#6B78AD',
    flipper: '#FF8DB5', flipperLight: '#FFC4DC', flipperDark: '#D45F8D',
    post: '#C3CBFF', sling: '#7C89F0', bumperRing: '#B9C2FF',
    balloons: ['#FF6B6B', '#FF9ECB', '#6FDCF0', '#FFB45C', '#FFD84A', '#8EE3A9', '#B79BFF'],
    text: '#FFF8E7', textMuted: '#B9C1F2',
    panel: 'rgba(20,26,72,0.84)', panelSolid: '#181E52', panelEdge: 'rgba(170,182,255,0.38)',
    accent: '#FFD84A', accent2: '#FF9ECB', good: '#8EE3A9', ink: '#241D52',
    ink2: '#2A2352'
  };
  const NAMED = { yellow: '#FFD84A', mint: '#8EE3A9', lilac: '#B79BFF', red: COL.ghost.red, pink: COL.ghost.pink, cyan: COL.ghost.cyan, orange: COL.ghost.orange };

  const FONT_STACK = "'Fredoka', 'Nunito', 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
  function font(px, weight) {
    return (weight || 600) + ' ' + (Math.round(px * 100) / 100) + 'px ' + FONT_STACK;
  }

  // Resolves when Fredoka is ready, but never blocks the game for long (the font is embedded, so this is normally instant).
  const fontsReady = (function () {
    const timeout = new Promise(function (res) { setTimeout(res, 1200); });
    if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return Promise.resolve();
    const loads = [400, 600, 700].map(function (w) {
      return document.fonts.load(w + " 32px 'Fredoka'", 'Aáőű').catch(function () { });
    });
    return Promise.race([Promise.all(loads), timeout]).then(function () { }, function () { });
  })();

  PM.Theme = { colors: COL, font: font, fontsReady: fontsReady };

  // ---------- small drawing helpers ----------
  function begin(ctx, o) {
    ctx.save();
    if (o && o.alpha != null) ctx.globalAlpha *= o.alpha;
  }
  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }
  function fillCircle(ctx, color, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = color; ctx.fill(); }
  function fillEll(ctx, color, x, y, rx, ry, rot) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU); ctx.fillStyle = color; ctx.fill();
  }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function radial(ctx, x0, y0, r0, x1, y1, r1, stops) {
    const gr = ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
    for (let i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
    return gr;
  }
  function linear(ctx, x0, y0, x1, y1, stops) {
    const gr = ctx.createLinearGradient(x0, y0, x1, y1);
    for (let i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
    return gr;
  }
  function line(ctx, color, w, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();
  }
  function ballGlint(ctx, x, y, r, a) {
    fillEll(ctx, 'rgba(255,255,255,' + a + ')', x, y, r, r * 0.62, -0.7);
  }
  function leaf(ctx, x, y, len, wid, rot, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(len * 0.25, -wid, len * 0.75, -wid, len, 0);
    ctx.bezierCurveTo(len * 0.75, wid * 0.9, len * 0.25, wid * 0.9, 0, 0);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  // ---------- Pacman ----------
  // Body disc with the wedge cut out, drawn in a frame where the mouth points along +x.
  // (hx,hy) is the light position in that frame; interior:true fills the wedge with a dark cavity and a tongue.
  function pacBody(ctx, r, a, open, interior, hx, hy) {
    if (interior && open) {
      ctx.beginPath();
      ctx.moveTo(r * 0.05, 0);
      ctx.arc(0, 0, r * 0.97, -a, a);
      ctx.closePath();
      ctx.fillStyle = radial(ctx, r * 0.1, 0, 0, r * 0.1, 0, r, [[0, '#A93C74'], [1, '#6A2755']]);
      ctx.fill();
      ctx.save();
      ctx.clip();
      fillEll(ctx, '#FF9DBB', r * 0.32, 0, r * 0.26, Math.min(r * 0.2, r * 0.32 * Math.tan(a)), 0);
      ctx.restore();
    }
    ctx.beginPath();
    if (open) {
      ctx.moveTo(r * 0.06, 0);
      ctx.arc(0, 0, r, a, TAU - a);
      ctx.closePath();
    } else {
      ctx.arc(0, 0, r, 0, TAU);
    }
    ctx.fillStyle = radial(ctx, hx, hy, r * 0.05, hx, hy, r * 1.55, [[0, COL.pacmanLight], [0.42, COL.pacman], [1, COL.pacmanDark]]);
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, r * 0.075);
    ctx.strokeStyle = 'rgba(214,138,20,0.55)';
    ctx.stroke();
  }

  // One eye, drawn upright at the origin. Moods: happy (round eye with a glint), surprised (bigger, with a brow),
  // chomp (happy closed arc), sleepy (closed, curving down).
  function pacEye(ctx, r, mood, blink, small) {
    const ink = COL.ink2;
    if (mood === 'chomp' || mood === 'sleepy') {
      ctx.beginPath();
      if (mood === 'chomp') ctx.arc(0, r * 0.09, r * 0.15, PI * 1.05, PI * 1.95);
      else ctx.arc(0, -r * 0.05, r * 0.15, 0.05 * PI, 0.95 * PI);
      ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1.4, r * 0.1); ctx.lineCap = 'round';
      ctx.stroke();
      return;
    }
    const big = mood === 'surprised' ? 1.25 : 1;
    const rx = r * 0.13 * big, ry = r * 0.185 * big * (1 - blink * 0.92);
    fillEll(ctx, ink, 0, 0, Math.max(1.2, rx), Math.max(0.5, ry), 0);
    if (!small && blink < 0.5) fillCircle(ctx, '#FFFFFF', -rx * 0.28, -ry * 0.32, r * 0.05 * big);
    if (mood === 'surprised') {
      ctx.beginPath();
      ctx.arc(0, -r * 0.3, r * 0.16, PI * 1.15, PI * 1.85);
      ctx.strokeStyle = 'rgba(160,96,10,0.7)'; ctx.lineWidth = Math.max(1, r * 0.055); ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  function bowAt(ctx, x, y, r, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const w = r * 0.3, h = r * 0.2;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(-w, -h); ctx.lineTo(-w, h); ctx.closePath();
    ctx.moveTo(0, 0); ctx.lineTo(w, -h); ctx.lineTo(w, h); ctx.closePath();
    ctx.fillStyle = '#FF7FAE'; ctx.fill();
    fillCircle(ctx, '#FF5E97', 0, 0, r * 0.1);
    ctx.restore();
  }

  function pacman(ctx, x, y, r, o) {
    o = o || {};
    const mood = o.mood || 'happy';
    let mouth = o.mouth == null ? 0.5 : clamp(o.mouth, 0, 1);
    if (mood === 'surprised') mouth = Math.max(mouth, 0.8);
    else if (mood === 'sleepy') mouth = 0;
    const dir = o.dir || 0;
    const a = mouth * 0.3 * PI;
    const open = a > 0.07;   // below this the mouth is drawn as a closed smile, never as a thin slit
    const blink = clamp(o.blink || 0, 0, 1);
    const small = r < 9;
    const cs = cos(dir), sn = sin(dir);
    const flip = cs < -0.2;   // facing left: mirror so the eye stays on the upper side

    begin(ctx, o);
    ctx.translate(x, y);
    ctx.rotate(dir);
    if (flip) ctx.scale(1, -1);

    // light comes from the upper left of the screen, whatever way Pacman faces
    let hx = cs * -0.3 * r + sn * -0.38 * r, hy = -sn * -0.3 * r + cs * -0.38 * r;
    if (flip) hy = -hy;
    pacBody(ctx, r, a, open, o.interior, hx, hy);

    // closed mouth: a small smile
    if (!open) {
      ctx.beginPath();
      ctx.moveTo(r * 0.42, r * 0.06);
      ctx.quadraticCurveTo(r * 0.68, r * 0.24, r * 0.9, r * 0.02);
      ctx.strokeStyle = 'rgba(160,96,10,0.75)';
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    if (o.bow) bowAt(ctx, -r * 0.5, -r * 0.82, r, -0.5);
    ctx.restore();

    // Cheek and eye are placed in the body frame but drawn upright in screen space, so the eye never lies on its side
    // when Pacman faces up or down, and the cheek always sits below and behind the eye.
    const ly = flip ? r * 0.5 : -r * 0.5;
    const ex = x + cs * r * 0.1 - sn * ly, ey = y + sn * r * 0.1 + cs * ly;
    if (r >= 6) {
      ctx.save();
      if (o.alpha != null) ctx.globalAlpha *= o.alpha;
      fillEll(ctx, 'rgba(255,120,150,0.55)', ex - cs * r * 0.4, ey + r * 0.4, r * 0.19, r * 0.13, 0);
      ctx.restore();
    }
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.translate(ex, ey);
    pacEye(ctx, r, mood, blink, small);
    ctx.restore();
    if (mood === 'sleepy') zzz(ctx, x + r * 0.95, y - r * 0.75, r * 0.5, { t: o.t || 0, alpha: o.alpha });
  }

  // The ball saver: front view, mouth wide open upwards like a hungry cup, big eyes watching the ball, rosy cheeks.
  function pacmanBig(ctx, x, y, r, o) {
    o = o || {};
    const mood = o.mood || 'happy';
    const open = clamp(o.open == null ? 0.7 : o.open, 0, 1);
    const a = open * 0.3 * PI;
    const isOpen = a > 0.07;
    const blink = clamp(o.blink || 0, 0, 1);
    begin(ctx, o);
    ctx.translate(x, y);
    ctx.save();
    ctx.rotate(-PI / 2);
    pacBody(ctx, r, a, isOpen, true, 0.38 * r, -0.3 * r);
    ctx.restore();
    // face on the lower half, below the mouth wedge
    const ink = COL.ink2;
    fillEll(ctx, 'rgba(255,120,150,0.55)', -r * 0.6, r * 0.5, r * 0.15, r * 0.1, 0);
    fillEll(ctx, 'rgba(255,120,150,0.55)', r * 0.6, r * 0.5, r * 0.15, r * 0.1, 0);
    for (let s = -1; s <= 1; s += 2) {
      const ex = s * 0.34 * r, ey = r * 0.24;
      if (mood === 'chomp' || mood === 'sleepy') {
        ctx.beginPath();
        if (mood === 'chomp') ctx.arc(ex, ey + r * 0.08, r * 0.16, PI * 1.08, PI * 1.92); else ctx.arc(ex, ey - r * 0.04, r * 0.16, 0.08 * PI, 0.92 * PI);
        ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1.5, r * 0.08); ctx.lineCap = 'round'; ctx.stroke();
      } else {
        const rx = r * 0.17, ry = r * 0.21 * (1 - blink * 0.9);
        fillEll(ctx, '#FFFFFF', ex, ey, rx, Math.max(0.5, ry), 0);
        fillCircle(ctx, ink, ex - s * rx * 0.05, ey - ry * 0.12, r * 0.095 * (mood === 'surprised' ? 1.2 : 1));
        fillCircle(ctx, '#FFFFFF', ex - s * rx * 0.05 - r * 0.03, ey - ry * 0.12 - r * 0.035, r * 0.03);
      }
    }
    ctx.beginPath();
    ctx.arc(0, r * 0.46, r * 0.17, 0.15 * PI, 0.85 * PI);
    ctx.strokeStyle = 'rgba(160,96,10,0.8)'; ctx.lineWidth = Math.max(1.5, r * 0.055); ctx.lineCap = 'round'; ctx.stroke();
    if (o.bow) bowAt(ctx, -r * 0.7, -r * 0.05, r, -1.2);
    ctx.restore();
  }

  function zzz(ctx, x, y, size, o) {
    o = o || {};
    const t = o.t || 0;
    begin(ctx, o);
    ctx.strokeStyle = o.color || COL.textMuted;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const base = ctx.globalAlpha;
    for (let i = 0; i < 3; i++) {
      const ph = ((t * 0.5 + i / 3) % 1);
      const s = size * (0.35 + 0.35 * ph);
      const px = x + ph * size * 0.7 + i * 0.02 * size, py = y - ph * size * 1.4;
      ctx.globalAlpha = base * Math.min(1, ph * 4) * (1 - ph * 0.85);
      ctx.lineWidth = Math.max(1, s * 0.22);
      ctx.beginPath();
      ctx.moveTo(px - s * 0.5, py - s * 0.5); ctx.lineTo(px + s * 0.5, py - s * 0.5);
      ctx.lineTo(px - s * 0.5, py + s * 0.5); ctx.lineTo(px + s * 0.5, py + s * 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Ghosts ----------
  const GHOST_COLORS = ['red', 'pink', 'cyan', 'orange'];
  // blush is picked per body colour so it stays pink-ish and never turns grey on the cyan ghost
  const BLUSH = { red: 'rgba(255,175,170,0.55)', pink: 'rgba(255,92,146,0.5)', cyan: 'rgba(255,145,185,0.62)', orange: 'rgba(255,120,120,0.5)', blue: 'rgba(255,165,205,0.55)' };
  const GHOST_MOODS = ['normal', 'blue', 'dizzy', 'happy', 'giggle', 'dance'];

  function ghost(ctx, x, y, r, o) {
    o = o || {};
    const mood = o.mood || 'normal';
    const t = o.t || 0;
    const body = mood === 'blue' ? COL.ghostBlue : (COL.ghost[o.color] || COL.ghost.red);
    const small = r < 9;
    let sx = 1, sy = 1, rot = 0, dx = 0, dy = 0, wave = 0.3, wspeed = 5;
    if (o.squash) {
      if (o.squash.x != null) sx = o.squash.x;
      if (o.squash.y != null) sy = o.squash.y;
    }
    if (mood === 'giggle') {
      const k = sin(t * 15);
      sx *= 1 + 0.035 * k; sy *= 1 - 0.05 * k; dx = sin(t * 22) * 0.02 * r; wave = 0.45; wspeed = 8;
    } else if (mood === 'dance') {
      const k = sin(t * 6);
      rot = k * 0.13; dy = -abs(cos(t * 6)) * 0.13 * r; wave = 0.5; wspeed = 8;
    } else if (mood === 'dizzy') {
      rot = sin(t * 5) * 0.09; wave = 0.25; wspeed = 4;
    } else if (mood === 'blue') {
      rot = sin(t * 2.2) * 0.05; dy = sin(t * 2) * 0.02 * r; wave = 0.2; wspeed = 2.6;
    } else {
      dy = sin(t * 2.4) * 0.02 * r;
    }

    begin(ctx, o);
    ctx.translate(x + dx, y + dy + r);   // pivot on the bottom of the skirt
    if (rot) ctx.rotate(rot);
    ctx.scale(sx, sy);
    ctx.translate(0, -r);

    // body silhouette: dome, straight sides, three scalloped feet that wave
    const base = 0.66 * r, w = 2 * r / 3;
    ctx.beginPath();
    ctx.moveTo(-r, base);
    ctx.lineTo(-r, 0);
    ctx.arc(0, 0, r, PI, TAU);
    ctx.lineTo(r, base);
    for (let i = 0; i < 3; i++) {
      const xa = r - i * w, xb = xa - w;
      const h = r * 0.34 * (1 + wave * sin(t * wspeed + i * 2.1));
      ctx.bezierCurveTo(xa - w * 0.1, base + h * 1.27, xb + w * 0.1, base + h * 1.27, xb, base);
    }
    ctx.closePath();
    ctx.fillStyle = linear(ctx, 0, -r, 0, r, [[0, shade(body, 0.2)], [0.55, body], [1, shade(body, -0.1)]]);
    ctx.fill();

    // soft shine on the dome
    if (!small) {
      ctx.save();
      ctx.translate(-r * 0.45, -r * 0.62);
      ctx.rotate(-0.7);
      fillEll(ctx, 'rgba(255,255,255,0.32)', 0, 0, r * 0.2, r * 0.1, 0);
      ctx.restore();
    }

    const ink = COL.ink2;
    const lw = Math.max(1.2, r * 0.07);
    let lx = 0, ly = 0;
    if (o.look) {
      lx = o.look.x || 0; ly = o.look.y || 0;
      const len = Math.sqrt(lx * lx + ly * ly);
      if (len > 1) { lx /= len; ly /= len; }
    }
    const ey = -0.14 * r, eRx = 0.245 * r, eRy = 0.3 * r;

    // blush first, so eyes and mouth sit on top of it
    if (!small) {
      const bc = mood === 'blue' ? BLUSH.blue : (BLUSH[o.color] || BLUSH.red);
      fillEll(ctx, bc, -0.6 * r, 0.2 * r, 0.13 * r, 0.075 * r, 0);
      fillEll(ctx, bc, 0.6 * r, 0.2 * r, 0.13 * r, 0.075 * r, 0);
    }

    if (mood === 'happy' || mood === 'giggle') {
      // closed, smiling eyes
      ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1.5, r * 0.09); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let s = -1; s <= 1; s += 2) {
        const ex = s * 0.36 * r;
        ctx.beginPath();
        if (mood === 'giggle') {
          ctx.moveTo(ex - s * 0.13 * r, ey - 0.13 * r);
          ctx.lineTo(ex + s * 0.11 * r, ey + 0.01 * r);
          ctx.lineTo(ex - s * 0.13 * r, ey + 0.13 * r);
        } else {
          ctx.arc(ex, ey + 0.1 * r, 0.17 * r, PI * 1.08, PI * 1.92);
        }
        ctx.stroke();
      }
    } else if (mood === 'dizzy') {
      for (let s = -1; s <= 1; s += 2) {
        const ex = s * 0.36 * r;
        fillEll(ctx, '#FFFFFF', ex, ey, eRx * 1.04, eRx * 1.04, 0);
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(t * 5 * s);
        ctx.beginPath();
        const turns = 2.2, steps = small ? 14 : 26;
        for (let i = 0; i <= steps; i++) {
          const th = (i / steps) * turns * TAU, rad = eRx * 0.9 * (i / steps);
          if (i === 0) ctx.moveTo(0, 0); else ctx.lineTo(cos(th) * rad, sin(th) * rad);
        }
        ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1, r * 0.055); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
      }
    } else if (mood === 'blue') {
      // sleepy, half closed eyes: a heavy lid whose edge sags in the middle (a flat lid reads as grumpy)
      for (let s = -1; s <= 1; s += 2) {
        const ex = s * 0.36 * r;
        const lidY = ey + eRy * 0.02, sag = eRy * 0.1;
        ctx.save();
        ctx.beginPath(); ctx.ellipse(ex, ey, eRx, eRy * 0.85, 0, 0, TAU); ctx.clip();
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(ex - eRx, ey - eRy, eRx * 2, eRy * 2);
        fillCircle(ctx, ink, ex + lx * eRx * 0.35, ey + eRy * 0.42 + ly * eRy * 0.08, r * 0.13);
        ctx.beginPath();
        ctx.moveTo(ex - eRx * 1.1, ey - eRy);
        ctx.lineTo(ex - eRx * 1.1, lidY);
        ctx.quadraticCurveTo(ex, lidY + sag * 2, ex + eRx * 1.1, lidY);
        ctx.lineTo(ex + eRx * 1.1, ey - eRy);
        ctx.closePath();
        ctx.fillStyle = shade(body, 0.02);
        ctx.fill();
        ctx.restore();
        // a soft, lighter edge on the lid instead of a hard dark line
        ctx.beginPath();
        ctx.moveTo(ex - eRx * 0.92, lidY);
        ctx.quadraticCurveTo(ex, lidY + sag * 2, ex + eRx * 0.92, lidY);
        ctx.strokeStyle = shade(body, -0.22); ctx.lineWidth = Math.max(1, r * 0.035); ctx.lineCap = 'round';
        ctx.stroke();
      }
    } else {
      // open eyes that follow the look vector
      const pr = 0.135 * r;
      for (let s = -1; s <= 1; s += 2) {
        const ex = s * 0.36 * r;
        fillEll(ctx, '#FFFFFF', ex, ey, eRx, eRy, 0);
        let plx = lx, ply = ly;
        if (mood === 'dance') { plx = sin(t * 3.2); ply = 0.2; }
        const px = ex + plx * (eRx - pr) * 0.85, py = ey + ply * (eRy - pr) * 0.85;
        fillCircle(ctx, ink, px, py, pr);
        if (!small) fillCircle(ctx, '#FFFFFF', px - pr * 0.32, py - pr * 0.38, pr * 0.32);
      }
    }

    // mouth
    ctx.strokeStyle = ink; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (mood === 'giggle' || mood === 'dance') {
      const mw = mood === 'giggle' ? 0.27 : 0.22, mh = mood === 'giggle' ? 0.3 : 0.24;
      ctx.beginPath();
      ctx.moveTo(-mw * r, 0.16 * r);
      ctx.lineTo(mw * r, 0.16 * r);
      ctx.bezierCurveTo(mw * r, (0.16 + mh * 1.3) * r, -mw * r, (0.16 + mh * 1.3) * r, -mw * r, 0.16 * r);
      ctx.closePath();
      ctx.fillStyle = '#4A2B5E';
      ctx.fill();
      if (!small) {
        ctx.save(); ctx.clip();
        fillEll(ctx, '#FF8FB0', 0, (0.16 + mh * 0.95) * r, mw * 0.6 * r, mh * 0.35 * r, 0);
        ctx.restore();
      }
    } else if (mood === 'happy') {
      ctx.beginPath();
      ctx.arc(0, 0.1 * r, 0.26 * r, 0.1 * PI, 0.9 * PI);
      ctx.stroke();
    } else if (mood === 'blue') {
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const u = -1 + i / 6, px = u * 0.24 * r;
        const py = (0.34 + 0.07 * (1 - u * u)) * r + sin(i * 1.4 + t * 5) * 0.02 * r;   // small smile with a wobble
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    } else if (mood === 'dizzy') {
      ctx.beginPath();
      ctx.ellipse(0, 0.36 * r, 0.09 * r, 0.075 * r, 0, 0, TAU);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0.12 * r, 0.2 * r, 0.16 * PI, 0.84 * PI);
      ctx.stroke();
    }

    // a little bobbing music note for the dancer
    if (mood === 'dance') {
      const nx = 0.95 * r, ny = -0.78 * r + sin(t * 6 + 1) * 0.06 * r, ns = 0.28 * r;
      ctx.fillStyle = '#FFF6C8'; ctx.strokeStyle = '#FFF6C8'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.2, ns * 0.22);
      ctx.beginPath(); ctx.ellipse(nx, ny + ns * 0.7, ns * 0.42, ns * 0.32, -0.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(nx + ns * 0.33, ny + ns * 0.55); ctx.lineTo(nx + ns * 0.33, ny - ns * 0.7); ctx.quadraticCurveTo(nx + ns * 0.8, ny - ns * 0.5, nx + ns * 0.7, ny - ns * 0.05); ctx.stroke();
    }
    // orbiting stars: gentle for blue, busier for dizzy
    if (mood === 'blue' || mood === 'dizzy') {
      const n = mood === 'dizzy' ? 3 : 2;
      const sp = mood === 'dizzy' ? 3.2 : 1.6;
      const sz = (mood === 'dizzy' ? 0.2 : 0.16) * r;
      for (let i = 0; i < n; i++) {
        const an = t * sp + i * TAU / n;
        const px = cos(an) * 0.72 * r, py = -1.02 * r + sin(an) * 0.2 * r;
        if (mood === 'dizzy') star(ctx, px, py, sz, { color: '#FFE066', rot: an });
        else sparkle(ctx, px, py, sz * 1.25, { color: '#FFF6C8', rot: an * 0.5 });
      }
    }
    ctx.restore();
  }

  // ---------- Fruit ----------
  const FRUITS = ['cherry', 'strawberry', 'orange', 'apple', 'pear', 'grapes'];

  function fruit(ctx, kind, x, y, r, o) {
    o = o || {};
    const t = o.t || 0;
    begin(ctx, o);
    ctx.translate(x, y + (o.t == null ? 0 : sin(t * 2.2) * r * 0.05));
    if (o.t != null) ctx.rotate(sin(t * 1.7) * 0.05);
    const small = r < 9;
    switch (kind) {
      case 'cherry': {
        const balls = [[-0.4, 0.44, 0.38], [0.4, 0.52, 0.36]];
        const jx = 0.1 * r, jy = -0.72 * r;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#5C9A3E'; ctx.lineWidth = Math.max(1.3, r * 0.08);
        for (let i = 0; i < 2; i++) {
          const b = balls[i];
          ctx.beginPath();
          ctx.moveTo(b[0] * r, (b[1] - b[2] * 0.85) * r);
          ctx.quadraticCurveTo((b[0] + jx / r) * 0.5 * r + (i ? 0.25 : -0.25) * r, (b[1] * 0.2) * r, jx, jy);
          ctx.stroke();
        }
        leaf(ctx, jx, jy, r * 0.65, r * 0.22, -0.35, '#79C654');
        for (let i = 0; i < 2; i++) {
          const b = balls[i];
          ctx.beginPath(); ctx.arc(b[0] * r, b[1] * r, b[2] * r, 0, TAU);
          ctx.fillStyle = small ? '#E63E5C' : radial(ctx, (b[0] - 0.12) * r, (b[1] - 0.14) * r, r * 0.03, b[0] * r, b[1] * r, b[2] * r * 1.15, [[0, '#FF8A9B'], [0.55, '#E63E5C'], [1, '#B3203F']]);
          ctx.fill();
          ballGlint(ctx, (b[0] - 0.13) * r, (b[1] - 0.15) * r, r * 0.12, 0.8);
        }
        break;
      }
      case 'strawberry': {
        ctx.beginPath();
        ctx.moveTo(0, 0.92 * r);
        ctx.bezierCurveTo(-0.35 * r, 0.86 * r, -0.9 * r, 0.28 * r, -0.82 * r, -0.2 * r);
        ctx.bezierCurveTo(-0.76 * r, -0.6 * r, -0.36 * r, -0.66 * r, 0, -0.5 * r);
        ctx.bezierCurveTo(0.36 * r, -0.66 * r, 0.76 * r, -0.6 * r, 0.82 * r, -0.2 * r);
        ctx.bezierCurveTo(0.9 * r, 0.28 * r, 0.35 * r, 0.86 * r, 0, 0.92 * r);
        ctx.closePath();
        ctx.fillStyle = small ? '#FF5C7C' : radial(ctx, -0.28 * r, -0.2 * r, r * 0.05, 0, 0.1 * r, r * 1.1, [[0, '#FF8FA6'], [0.5, '#FF5C7C'], [1, '#D93A62']]);
        ctx.fill();
        if (!small || r >= 6) {
          const seeds = [[-0.42, -0.12], [0, -0.22], [0.42, -0.12], [-0.22, 0.14], [0.22, 0.14], [-0.5, 0.2], [0.5, 0.2], [0, 0.42], [-0.22, 0.5], [0.22, 0.5]];
          ctx.fillStyle = '#FFE9A6';
          const n = small ? 5 : seeds.length;
          for (let i = 0; i < n; i++) {
            const s = seeds[i];
            ctx.beginPath(); ctx.ellipse(s[0] * r, s[1] * r, r * 0.05, r * 0.075, 0, 0, TAU); ctx.fill();
          }
        }
        // leafy top
        for (let i = -2; i <= 2; i++) {
          leaf(ctx, 0, -0.5 * r, r * 0.5, r * 0.13, -PI / 2 + i * 0.5, '#6DBF4B');
        }
        ctx.beginPath(); ctx.moveTo(0, -0.5 * r); ctx.lineTo(0.03 * r, -0.86 * r);
        ctx.strokeStyle = '#5C9A3E'; ctx.lineWidth = Math.max(1.3, r * 0.09); ctx.lineCap = 'round'; ctx.stroke();
        break;
      }
      case 'orange': {
        const cy = 0.1 * r, rr = 0.82 * r;
        ctx.beginPath(); ctx.arc(0, cy, rr, 0, TAU);
        ctx.fillStyle = small ? '#FF9A2E' : radial(ctx, -0.3 * r, -0.2 * r, r * 0.05, 0, cy, rr * 1.15, [[0, '#FFCB74'], [0.5, '#FF9A2E'], [1, '#F0731A']]);
        ctx.fill();
        if (!small) {
          ctx.fillStyle = 'rgba(210,100,10,0.28)';
          const dots = [[-0.35, 0.3], [0.3, 0.42], [0.5, -0.08], [-0.05, 0.05], [-0.5, -0.1], [0.12, 0.62]];
          for (let i = 0; i < dots.length; i++) { ctx.beginPath(); ctx.arc(dots[i][0] * r, dots[i][1] * r + cy * 0.4, r * 0.035, 0, TAU); ctx.fill(); }
        }
        ballGlint(ctx, -0.34 * r, -0.28 * r + cy * 0.4, r * 0.18, 0.55);
        leaf(ctx, 0.02 * r, cy - rr * 0.98, r * 0.6, r * 0.2, -0.3, '#6DBF4B');
        fillCircle(ctx, '#5C9A3E', 0, cy - rr * 0.97, r * 0.07);
        break;
      }
      case 'apple': {
        ctx.beginPath();
        ctx.moveTo(0, -0.5 * r);
        ctx.bezierCurveTo(0.26 * r, -0.8 * r, 0.94 * r, -0.6 * r, 0.9 * r, 0.06 * r);
        ctx.bezierCurveTo(0.88 * r, 0.62 * r, 0.5 * r, 0.94 * r, 0.24 * r, 0.9 * r);
        ctx.bezierCurveTo(0.1 * r, 0.86 * r, -0.1 * r, 0.86 * r, -0.24 * r, 0.9 * r);
        ctx.bezierCurveTo(-0.5 * r, 0.94 * r, -0.88 * r, 0.62 * r, -0.9 * r, 0.06 * r);
        ctx.bezierCurveTo(-0.94 * r, -0.6 * r, -0.26 * r, -0.8 * r, 0, -0.5 * r);
        ctx.closePath();
        ctx.fillStyle = small ? '#F0483F' : radial(ctx, -0.32 * r, -0.2 * r, r * 0.05, 0, 0.1 * r, r * 1.2, [[0, '#FF8F7A'], [0.45, '#F0483F'], [1, '#C42B3A']]);
        ctx.fill();
        ballGlint(ctx, -0.5 * r, -0.16 * r, r * 0.16, 0.6);
        ctx.beginPath(); ctx.moveTo(0, -0.5 * r); ctx.quadraticCurveTo(0.02 * r, -0.75 * r, 0.12 * r, -0.92 * r);
        ctx.strokeStyle = '#7A4A2A'; ctx.lineWidth = Math.max(1.4, r * 0.1); ctx.lineCap = 'round'; ctx.stroke();
        leaf(ctx, 0.08 * r, -0.66 * r, r * 0.6, r * 0.2, -0.45, '#6DBF4B');
        break;
      }
      case 'pear': {
        ctx.beginPath();
        ctx.moveTo(0, -0.78 * r);
        ctx.bezierCurveTo(0.3 * r, -0.78 * r, 0.36 * r, -0.4 * r, 0.5 * r, -0.12 * r);
        ctx.bezierCurveTo(0.98 * r, 0.3 * r, 0.8 * r, 0.92 * r, 0, 0.92 * r);
        ctx.bezierCurveTo(-0.8 * r, 0.92 * r, -0.98 * r, 0.3 * r, -0.5 * r, -0.12 * r);
        ctx.bezierCurveTo(-0.36 * r, -0.4 * r, -0.3 * r, -0.78 * r, 0, -0.78 * r);
        ctx.closePath();
        ctx.fillStyle = small ? '#C8DE55' : radial(ctx, -0.3 * r, 0.1 * r, r * 0.05, 0, 0.25 * r, r * 1.1, [[0, '#E6F088'], [0.5, '#C8DE55'], [1, '#8FBA3A']]);
        ctx.fill();
        ballGlint(ctx, -0.36 * r, 0.3 * r, r * 0.16, 0.5);
        if (!small) {
          ctx.fillStyle = 'rgba(110,140,30,0.3)';
          const fr = [[0.3, 0.5], [0.05, 0.7], [0.45, 0.25], [-0.1, 0.35]];
          for (let i = 0; i < fr.length; i++) { ctx.beginPath(); ctx.arc(fr[i][0] * r, fr[i][1] * r, r * 0.03, 0, TAU); ctx.fill(); }
        }
        ctx.beginPath(); ctx.moveTo(0, -0.76 * r); ctx.quadraticCurveTo(0.03 * r, -0.92 * r, 0.14 * r, -1.0 * r);
        ctx.strokeStyle = '#7A4A2A'; ctx.lineWidth = Math.max(1.4, r * 0.1); ctx.lineCap = 'round'; ctx.stroke();
        leaf(ctx, 0.08 * r, -0.86 * r, r * 0.55, r * 0.18, -0.35, '#5FB44A');
        break;
      }
      case 'grapes': {
        const gr = 0.28 * r;
        const pos = [[-0.5, -0.24], [0, -0.28], [0.5, -0.24], [-0.25, 0.14], [0.25, 0.14], [0, 0.52]];
        ctx.beginPath(); ctx.moveTo(0, -0.5 * r); ctx.quadraticCurveTo(0.02 * r, -0.72 * r, 0.14 * r, -0.86 * r);
        ctx.strokeStyle = '#7A4A2A'; ctx.lineWidth = Math.max(1.4, r * 0.09); ctx.lineCap = 'round'; ctx.stroke();
        leaf(ctx, 0.1 * r, -0.72 * r, r * 0.6, r * 0.2, -0.5, '#6DBF4B');
        for (let i = 5; i >= 0; i--) {
          const p = pos[i];
          const cx = p[0] * r, cy = p[1] * r;
          ctx.beginPath(); ctx.arc(cx, cy, gr, 0, TAU);
          ctx.fillStyle = small ? '#9A67E8' : radial(ctx, cx - gr * 0.3, cy - gr * 0.35, gr * 0.05, cx, cy, gr * 1.2, [[0, '#C9A6FF'], [0.55, '#9A67E8'], [1, '#6E3FC0']]);
          ctx.fill();
          if (!small) fillCircle(ctx, 'rgba(255,255,255,0.75)', cx - gr * 0.36, cy - gr * 0.4, gr * 0.2);
        }
        break;
      }
      default:
        fillCircle(ctx, '#FFD84A', 0, 0, r * 0.8);
    }
    ctx.restore();
  }

  // ---------- pickups ----------
  function dot(ctx, x, y, r, o) {
    const c = (o && o.color) || COL.dot;
    ctx.beginPath(); ctx.arc(x, y, r * 1.9, 0, TAU);
    ctx.fillStyle = 'rgba(255,240,207,0.13)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = c; ctx.fill();
  }

  function pellet(ctx, x, y, r, o) {
    const t = (o && o.t) || 0;
    const k = 1 + 0.09 * sin(t * 4.4);
    const rr = r * k;
    begin(ctx, o);
    ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, TAU);
    ctx.fillStyle = radial(ctx, x, y, rr * 0.6, x, y, r * 2.6, [[0, 'rgba(255,238,190,0.38)'], [1, 'rgba(255,238,190,0)']]);
    ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU);
    ctx.fillStyle = radial(ctx, x - rr * 0.3, y - rr * 0.32, rr * 0.05, x, y, rr * 1.05, [[0, '#FFFFFF'], [0.5, COL.pellet], [1, '#FFDFA0']]);
    ctx.fill();
    ctx.restore();
  }

  // ---------- star, heart, sparkle, confetti ----------
  function star(ctx, x, y, r, o) {
    o = o || {};
    const color = o.color || COL.accent;
    begin(ctx, o);
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    if (o.glow) {
      ctx.beginPath(); ctx.arc(0, 0, r * 1.8, 0, TAU);
      ctx.fillStyle = radial(ctx, 0, 0, r * 0.5, 0, 0, r * 1.8, [[0, withAlpha(parseHex(color) ? color : COL.accent, 0.35)], [1, withAlpha(parseHex(color) ? color : COL.accent, 0)]]);
      ctx.fill();
    }
    // outer points are pulled in a little; the round stroke gives back the size and rounds the tips
    const pad = r * 0.13, ro = r - pad * 1.2, ri = ro * 0.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? ri : ro, an = -PI / 2 + i * PI / 5;
      if (i === 0) ctx.moveTo(cos(an) * rad, sin(an) * rad); else ctx.lineTo(cos(an) * rad, sin(an) * rad);
    }
    ctx.closePath();
    ctx.fillStyle = r < 8 ? color : radial(ctx, -r * 0.25, -r * 0.3, r * 0.05, 0, 0, r * 1.1, [[0, shade(color, 0.45)], [0.6, color], [1, shade(color, -0.08)]]);
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = pad * 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    if (o.face) {
      const e = COL.ink2;
      fillEll(ctx, e, -r * 0.2, -r * 0.02, r * 0.065, r * 0.09, 0);
      fillEll(ctx, e, r * 0.2, -r * 0.02, r * 0.065, r * 0.09, 0);
      ctx.beginPath(); ctx.arc(0, r * 0.06, r * 0.16, 0.15 * PI, 0.85 * PI);
      ctx.strokeStyle = e; ctx.lineWidth = Math.max(1.2, r * 0.06); ctx.lineCap = 'round'; ctx.stroke();
      fillEll(ctx, 'rgba(255,110,140,0.4)', -r * 0.36, r * 0.13, r * 0.09, r * 0.055, 0);
      fillEll(ctx, 'rgba(255,110,140,0.4)', r * 0.36, r * 0.13, r * 0.09, r * 0.055, 0);
    }
    ctx.restore();
  }

  function heart(ctx, x, y, r, o) {
    o = o || {};
    const color = o.color || '#FF7FA8';
    const k = o.t == null ? 1 : 1 + 0.06 * sin(o.t * 4);
    begin(ctx, o);
    ctx.translate(x, y + r * 0.05);
    ctx.scale(k, k);
    ctx.beginPath();
    ctx.moveTo(0, 0.85 * r);
    ctx.bezierCurveTo(-0.3 * r, 0.62 * r, -1.0 * r, 0.2 * r, -0.98 * r, -0.28 * r);
    ctx.bezierCurveTo(-0.96 * r, -0.72 * r, -0.28 * r, -0.86 * r, 0, -0.4 * r);
    ctx.bezierCurveTo(0.28 * r, -0.86 * r, 0.96 * r, -0.72 * r, 0.98 * r, -0.28 * r);
    ctx.bezierCurveTo(1.0 * r, 0.2 * r, 0.3 * r, 0.62 * r, 0, 0.85 * r);
    ctx.closePath();
    ctx.fillStyle = r < 8 ? color : radial(ctx, -0.35 * r, -0.35 * r, r * 0.05, 0, 0, r * 1.2, [[0, shade(color, 0.4)], [0.55, color], [1, shade(color, -0.15)]]);
    ctx.fill();
    ballGlint(ctx, -0.5 * r, -0.4 * r, r * 0.16, 0.55);
    ctx.restore();
  }

  function sparkle(ctx, x, y, r, o) {
    o = o || {};
    const color = o.color || '#FFF6D0';
    begin(ctx, o);
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    if (o.glow) {
      ctx.beginPath(); ctx.arc(0, 0, r * 1.5, 0, TAU);
      ctx.fillStyle = radial(ctx, 0, 0, 0, 0, 0, r * 1.5, [[0, 'rgba(255,246,208,0.35)'], [1, 'rgba(255,246,208,0)']]);
      ctx.fill();
    }
    const k = 0.14 * r;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(k, -k, r, 0);
    ctx.quadraticCurveTo(k, k, 0, r);
    ctx.quadraticCurveTo(-k, k, -r, 0);
    ctx.quadraticCurveTo(-k, -k, 0, -r);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function confetti(ctx, x, y, r, o) {
    o = o || {};
    const color = o.color || COL.accent2;
    begin(ctx, o);
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    if (o.flip != null) ctx.scale(1, Math.max(0.12, abs(cos(o.flip * PI))));
    ctx.fillStyle = color;
    const shape = o.shape || 'rect';
    if (shape === 'circle') {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, TAU); ctx.fill();
    } else if (shape === 'tri') {
      ctx.beginPath(); ctx.moveTo(0, -r * 0.85); ctx.lineTo(r * 0.8, r * 0.6); ctx.lineTo(-r * 0.8, r * 0.6); ctx.closePath();
      ctx.fill();
    } else if (shape === 'ribbon') {
      ctx.beginPath(); ctx.moveTo(-r, 0); ctx.bezierCurveTo(-r * 0.4, -r * 0.7, r * 0.4, r * 0.7, r, 0);
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, r * 0.4); ctx.lineCap = 'round'; ctx.stroke();
    } else {
      rrect(ctx, -r * 0.8, -r * 0.42, r * 1.6, r * 0.84, r * 0.2); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- balloon ----------
  function balloon(ctx, x, y, r, o) {
    o = o || {};
    let color = o.color || COL.balloons[0];
    if (NAMED[color]) color = NAMED[color];
    const t = o.t || 0;
    begin(ctx, o);
    ctx.translate(x, y);
    ctx.rotate(sin(t * 1.6 + x * 0.013) * 0.06);
    // string first, so the balloon covers its top end
    const sw = sin(t * 2.1 + x * 0.02) * r * 0.35;
    ctx.beginPath();
    ctx.moveTo(0, r * 1.3);
    ctx.bezierCurveTo(-r * 0.3 + sw, r * 1.9, r * 0.3 + sw, r * 2.5, sw * 0.6, r * 3.2);
    ctx.strokeStyle = 'rgba(230,236,255,0.65)'; ctx.lineWidth = Math.max(1, r * 0.055); ctx.lineCap = 'round';
    ctx.stroke();
    // body: slightly egg shaped, pointed a bit at the tie
    ctx.beginPath();
    ctx.moveTo(0, 1.12 * r);
    ctx.bezierCurveTo(-0.35 * r, 1.0 * r, -1.0 * r, 0.5 * r, -1.0 * r, -0.15 * r);
    ctx.bezierCurveTo(-1.0 * r, -0.85 * r, -0.5 * r, -1.2 * r, 0, -1.2 * r);
    ctx.bezierCurveTo(0.5 * r, -1.2 * r, 1.0 * r, -0.85 * r, 1.0 * r, -0.15 * r);
    ctx.bezierCurveTo(1.0 * r, 0.5 * r, 0.35 * r, 1.0 * r, 0, 1.12 * r);
    ctx.closePath();
    ctx.fillStyle = r < 8 ? color : radial(ctx, -0.35 * r, -0.5 * r, r * 0.05, 0, -0.05 * r, r * 1.4, [[0, shade(color, 0.45)], [0.55, color], [1, shade(color, -0.14)]]);
    ctx.fill();
    // knot
    ctx.beginPath(); ctx.moveTo(0, 1.08 * r); ctx.lineTo(-0.16 * r, 1.3 * r); ctx.lineTo(0.16 * r, 1.3 * r); ctx.closePath();
    ctx.fillStyle = shade(color, -0.2); ctx.fill();
    ballGlint(ctx, -0.42 * r, -0.62 * r, r * 0.2, 0.5);
    ctx.restore();
  }

  // ---------- speech bubble, crown, trophy, question block ----------
  function speech(ctx, x, y, w, h, o) {
    o = o || {};
    const tail = o.tail || 'down';
    const color = o.color || '#FFF8E7', edge = o.edge || 'rgba(70,80,170,0.45)';
    const rad = Math.min(h * 0.42, 26);
    const tp = clamp(o.tailPos == null ? -0.5 : o.tailPos, -1, 1);
    begin(ctx, o);
    ctx.translate(x - w / 2, y - h / 2);
    ctx.beginPath();
    // rounded rectangle path with the tail spliced into one side
    const tl = Math.min(w, h) * 0.22;   // half width of the tail base
    const tv = Math.min(w, h) * 0.3;    // tail length
    const cx = w / 2 + tp * (w / 2 - rad - tl), cy = h / 2 + tp * (h / 2 - rad - tl);
    const tipx = (tp < 0 ? -1 : 1) * tl * 0.5;   // the tip leans outward
    ctx.moveTo(rad, 0);
    if (tail === 'up') { ctx.lineTo(cx - tl, 0); ctx.lineTo(cx + tipx, -tv); ctx.lineTo(cx + tl, 0); }
    ctx.lineTo(w - rad, 0);
    ctx.arcTo(w, 0, w, rad, rad);
    if (tail === 'right') { ctx.lineTo(w, cy - tl); ctx.lineTo(w + tv, cy); ctx.lineTo(w, cy + tl); }
    ctx.lineTo(w, h - rad);
    ctx.arcTo(w, h, w - rad, h, rad);
    if (tail === 'down') { ctx.lineTo(cx + tl, h); ctx.lineTo(cx + tipx, h + tv); ctx.lineTo(cx - tl, h); }
    ctx.lineTo(rad, h);
    ctx.arcTo(0, h, 0, h - rad, rad);
    if (tail === 'left') { ctx.lineTo(0, cy + tl); ctx.lineTo(-tv, cy); ctx.lineTo(0, cy - tl); }
    ctx.lineTo(0, rad);
    ctx.arcTo(0, 0, rad, 0, rad);
    ctx.closePath();
    ctx.shadowColor = 'rgba(5,8,40,0.35)'; ctx.shadowBlur = h * 0.18; ctx.shadowOffsetY = h * 0.05;
    ctx.fillStyle = color; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1.5, h * 0.035); ctx.strokeStyle = edge; ctx.stroke();
    if (o.text) {
      ctx.fillStyle = o.textColor || COL.ink;
      ctx.font = font(o.size || h * 0.5, 600);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(o.text, w / 2, h / 2 + (o.size || h * 0.5) * 0.04, w - rad);
    }
    ctx.restore();
  }

  function crown(ctx, x, y, r, o) {
    o = o || {};
    const c = o.color || '#FFCF3F';
    begin(ctx, o);
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(-0.8 * r, 0.55 * r);
    ctx.lineTo(-0.92 * r, -0.5 * r);
    ctx.lineTo(-0.42 * r, -0.08 * r);
    ctx.lineTo(0, -0.72 * r);
    ctx.lineTo(0.42 * r, -0.08 * r);
    ctx.lineTo(0.92 * r, -0.5 * r);
    ctx.lineTo(0.8 * r, 0.55 * r);
    ctx.closePath();
    ctx.fillStyle = linear(ctx, 0, -0.7 * r, 0, 0.6 * r, [[0, shade(c, 0.4)], [0.5, c], [1, shade(c, -0.15)]]);
    ctx.fill();
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1.5, r * 0.16); ctx.strokeStyle = c; ctx.stroke();
    rrect(ctx, -0.84 * r, 0.32 * r, 1.68 * r, 0.32 * r, r * 0.12);
    ctx.fillStyle = shade(c, -0.12); ctx.fill();
    fillCircle(ctx, '#FF6B8E', 0, 0.06 * r, r * 0.13);
    fillCircle(ctx, '#6FDCF0', -0.5 * r, 0.14 * r, r * 0.1);
    fillCircle(ctx, '#8EE3A9', 0.5 * r, 0.14 * r, r * 0.1);
    fillCircle(ctx, '#FFFFFF', 0, -0.82 * r, r * 0.1);
    fillCircle(ctx, '#FFFFFF', -0.92 * r, -0.58 * r, r * 0.09);
    fillCircle(ctx, '#FFFFFF', 0.92 * r, -0.58 * r, r * 0.09);
    ctx.restore();
  }

  function trophy(ctx, x, y, r, o) {
    o = o || {};
    const c = o.color || '#FFCF3F';
    begin(ctx, o);
    ctx.translate(x, y);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // handles
    ctx.strokeStyle = shade(c, -0.1); ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.beginPath(); ctx.moveTo(-0.55 * r, -0.55 * r); ctx.bezierCurveTo(-1.15 * r, -0.6 * r, -1.0 * r, 0.1 * r, -0.4 * r, 0.14 * r); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.55 * r, -0.55 * r); ctx.bezierCurveTo(1.15 * r, -0.6 * r, 1.0 * r, 0.1 * r, 0.4 * r, 0.14 * r); ctx.stroke();
    // stem and base
    rrect(ctx, -0.14 * r, 0.2 * r, 0.28 * r, 0.42 * r, r * 0.05);
    ctx.fillStyle = shade(c, -0.12); ctx.fill();
    rrect(ctx, -0.5 * r, 0.58 * r, r, 0.3 * r, r * 0.1);
    ctx.fillStyle = shade(c, -0.2); ctx.fill();
    // cup
    ctx.beginPath();
    ctx.moveTo(-0.62 * r, -0.8 * r);
    ctx.lineTo(0.62 * r, -0.8 * r);
    ctx.bezierCurveTo(0.62 * r, -0.1 * r, 0.4 * r, 0.3 * r, 0, 0.3 * r);
    ctx.bezierCurveTo(-0.4 * r, 0.3 * r, -0.62 * r, -0.1 * r, -0.62 * r, -0.8 * r);
    ctx.closePath();
    ctx.fillStyle = linear(ctx, -0.6 * r, 0, 0.6 * r, 0, [[0, shade(c, 0.35)], [0.45, c], [1, shade(c, -0.15)]]);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.1); ctx.strokeStyle = c; ctx.stroke();
    star(ctx, 0, -0.32 * r, r * 0.26, { color: '#FFFFFF', alpha: 0.85 });
    ctx.restore();
  }

  function questionBlock(ctx, x, y, r, o) {
    o = o || {};
    const t = o.t || 0;
    begin(ctx, o);
    ctx.translate(x, y);
    const pressed = !!o.pressed;
    if (!pressed) {
      const k = 1 + 0.035 * sin(t * 3.4);
      ctx.scale(k, k);
    }
    // soft glow
    if (!pressed) {
      ctx.beginPath(); ctx.arc(0, 0, r * 1.7, 0, TAU);
      ctx.fillStyle = radial(ctx, 0, 0, r * 0.8, 0, 0, r * 1.7, [[0, 'rgba(255,216,74,0.30)'], [1, 'rgba(255,216,74,0)']]);
      ctx.fill();
    }
    const lip = pressed ? r * 0.03 : r * 0.1;
    rrect(ctx, -r, -r + lip, 2 * r, 2 * r, r * 0.3);
    ctx.fillStyle = '#C98713'; ctx.fill();
    rrect(ctx, -r, -r, 2 * r, 2 * r - lip, r * 0.3);
    ctx.fillStyle = linear(ctx, 0, -r, 0, r, [[0, '#FFE58A'], [1, '#FFC93A']]);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.07); ctx.strokeStyle = '#F0A420'; ctx.stroke();
    // corner rivets
    const rv = r * 0.72;
    for (let sx = -1; sx <= 1; sx += 2) for (let sy = -1; sy <= 1; sy += 2) fillCircle(ctx, '#E7A02A', sx * rv, sy * rv - lip * 0.5, r * 0.06);
    ctx.fillStyle = '#7A4300';
    ctx.font = font(r * 1.35, 700);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, -lip * 0.5 + r * 0.06);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    rrect(ctx, -r * 0.75, -r * 0.86, r * 0.9, r * 0.1, r * 0.05); ctx.fill();
    ctx.restore();
  }

  // ---------- keycaps ----------
  function keycap(ctx, x, y, w, h, label, o) {
    o = o || {};
    const pressed = !!o.pressed;
    const rad = Math.min(w, h) * 0.24;
    const lip = h * (pressed ? 0.04 : 0.13);
    const top = pressed ? COL.accent : '#FFF8E7';
    const side = pressed ? '#D9A62A' : '#A9B1E8';
    const ink = pressed ? '#5B3B00' : '#3A4090';
    begin(ctx, o);
    ctx.translate(x, y);
    if (pressed) {
      ctx.beginPath(); ctx.arc(0, 0, Math.max(w, h) * 0.7, 0, TAU);
      ctx.fillStyle = radial(ctx, 0, 0, Math.min(w, h) * 0.3, 0, 0, Math.max(w, h) * 0.7, [[0, 'rgba(255,216,74,0.38)'], [1, 'rgba(255,216,74,0)']]);
      ctx.fill();
    }
    const capH = h - h * 0.13;   // the cap keeps its size; the base peeks out below it
    const cy = -h / 2 + (pressed ? h * 0.09 : 0);
    rrect(ctx, -w / 2, cy + lip, w, capH, rad);
    ctx.fillStyle = side; ctx.fill();
    rrect(ctx, -w / 2, cy, w, capH, rad);
    ctx.fillStyle = linear(ctx, 0, cy, 0, cy + capH, [[0, shade(top, 0.12)], [1, top]]);
    ctx.fill();
    ctx.lineWidth = Math.max(1, h * 0.03); ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    rrect(ctx, -w / 2 + 1, cy + 1, w - 2, capH - 2, rad); ctx.stroke();
    const mx = 0, my = cy + capH / 2;
    const s = Math.min(w, capH) * 0.5;
    ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (label === 'left' || label === 'right') {
      const d = label === 'left' ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(mx + d * s * 0.55, my); ctx.lineTo(mx - d * s * 0.4, my - s * 0.5); ctx.lineTo(mx - d * s * 0.4, my + s * 0.5); ctx.closePath();
      ctx.lineWidth = s * 0.28; ctx.fill(); ctx.stroke();
    } else if (label === 'space') {
      ctx.beginPath();
      ctx.moveTo(mx - w * 0.28, my - s * 0.1); ctx.lineTo(mx - w * 0.28, my + s * 0.22); ctx.lineTo(mx + w * 0.28, my + s * 0.22); ctx.lineTo(mx + w * 0.28, my - s * 0.1);
      ctx.lineWidth = Math.max(2, capH * 0.12);
      ctx.stroke();
    } else if (label) {
      ctx.font = font(capH * 0.52, 700);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(label), mx, my + capH * 0.03, w * 0.86);
    }
    ctx.restore();
  }

  // ---------- icons ----------
  const ICONS = ['speaker', 'speakerOff', 'music', 'musicOff', 'pause', 'play', 'fullscreen', 'question', 'tunnel', 'house'];

  function icon(ctx, name, x, y, size, o) {
    o = o || {};
    const c = o.color || COL.text;
    const u = size / 2;
    begin(ctx, o);
    ctx.translate(x, y);
    ctx.strokeStyle = c; ctx.fillStyle = c;
    ctx.lineWidth = Math.max(1.5, size * 0.11); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const cone = function () {
      ctx.beginPath();
      ctx.moveTo(-0.78 * u, -0.28 * u); ctx.lineTo(-0.4 * u, -0.28 * u); ctx.lineTo(0.02 * u, -0.66 * u);
      ctx.lineTo(0.02 * u, 0.66 * u); ctx.lineTo(-0.4 * u, 0.28 * u); ctx.lineTo(-0.78 * u, 0.28 * u);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    };
    const note = function () {
      ctx.beginPath(); ctx.ellipse(-0.42 * u, 0.5 * u, 0.3 * u, 0.24 * u, -0.35, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0.38 * u, 0.36 * u, 0.3 * u, 0.24 * u, -0.35, 0, TAU); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-0.17 * u, 0.44 * u); ctx.lineTo(-0.17 * u, -0.6 * u); ctx.lineTo(0.63 * u, -0.78 * u); ctx.lineTo(0.63 * u, 0.3 * u);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.17 * u, -0.28 * u); ctx.lineTo(0.63 * u, -0.46 * u); ctx.stroke();
    };
    switch (name) {
      case 'speaker':
        cone();
        ctx.beginPath(); ctx.arc(0.02 * u, 0, 0.46 * u, -0.6, 0.6); ctx.stroke();
        ctx.beginPath(); ctx.arc(0.02 * u, 0, 0.82 * u, -0.55, 0.55); ctx.stroke();
        break;
      case 'speakerOff':
        cone();
        line(ctx, c, ctx.lineWidth, [0.32 * u, -0.34 * u, 0.86 * u, 0.34 * u]);
        line(ctx, c, ctx.lineWidth, [0.86 * u, -0.34 * u, 0.32 * u, 0.34 * u]);
        break;
      case 'music':
        note();
        break;
      case 'musicOff':
        ctx.globalAlpha *= 0.55;
        note();
        ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
        line(ctx, c, ctx.lineWidth * 1.15, [-0.85 * u, -0.85 * u, 0.85 * u, 0.85 * u]);
        break;
      case 'pause':
        rrect(ctx, -0.55 * u, -0.62 * u, 0.42 * u, 1.24 * u, 0.12 * u); ctx.fill();
        rrect(ctx, 0.13 * u, -0.62 * u, 0.42 * u, 1.24 * u, 0.12 * u); ctx.fill();
        break;
      case 'play':
        ctx.beginPath(); ctx.moveTo(-0.42 * u, -0.66 * u); ctx.lineTo(0.66 * u, 0); ctx.lineTo(-0.42 * u, 0.66 * u); ctx.closePath();
        ctx.fill(); ctx.stroke();
        break;
      case 'fullscreen': {
        const a = 0.78 * u, b = 0.36 * u;
        ctx.beginPath();
        ctx.moveTo(-a, -a + b); ctx.lineTo(-a, -a); ctx.lineTo(-a + b, -a);
        ctx.moveTo(a - b, -a); ctx.lineTo(a, -a); ctx.lineTo(a, -a + b);
        ctx.moveTo(a, a - b); ctx.lineTo(a, a); ctx.lineTo(a - b, a);
        ctx.moveTo(-a + b, a); ctx.lineTo(-a, a); ctx.lineTo(-a, a - b);
        ctx.stroke();
        break;
      }
      case 'question':
        ctx.beginPath(); ctx.arc(0, 0, 0.86 * u, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -0.2 * u, 0.27 * u, -PI * 0.95, PI * 0.5);
        ctx.lineTo(0, 0.22 * u); ctx.stroke();
        fillCircle(ctx, c, 0, 0.46 * u, ctx.lineWidth * 0.62);
        break;
      case 'tunnel':
        ctx.beginPath();
        ctx.moveTo(-0.7 * u, 0.72 * u); ctx.lineTo(-0.7 * u, -0.05 * u); ctx.arc(0, -0.05 * u, 0.7 * u, PI, TAU); ctx.lineTo(0.7 * u, 0.72 * u);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-0.32 * u, 0.32 * u); ctx.lineTo(0.3 * u, 0.32 * u);
        ctx.moveTo(0.06 * u, 0.06 * u); ctx.lineTo(0.32 * u, 0.32 * u); ctx.lineTo(0.06 * u, 0.58 * u);
        ctx.stroke();
        break;
      case 'house':
        ctx.beginPath();
        ctx.moveTo(-0.86 * u, -0.06 * u); ctx.lineTo(0, -0.8 * u); ctx.lineTo(0.86 * u, -0.06 * u);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-0.6 * u, -0.1 * u); ctx.lineTo(-0.6 * u, 0.72 * u); ctx.lineTo(0.6 * u, 0.72 * u); ctx.lineTo(0.6 * u, -0.1 * u);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-0.2 * u, 0.72 * u); ctx.lineTo(-0.2 * u, 0.3 * u); ctx.arc(0, 0.3 * u, 0.2 * u, PI, TAU); ctx.lineTo(0.2 * u, 0.72 * u);
        ctx.stroke();
        break;
      default:
        break;
    }
    ctx.restore();
  }

  // ---------- pinball ----------
  function ball(ctx, x, y, r, o) {
    o = o || {};
    begin(ctx, o);
    ctx.translate(x, y);
    // faint halo so the ball never gets lost on the navy table
    ctx.beginPath(); ctx.arc(0, 0, r + Math.max(1, r * 0.16), 0, TAU);
    ctx.fillStyle = 'rgba(190,205,255,0.20)'; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = radial(ctx, -0.35 * r, -0.4 * r, r * 0.05, 0, 0, r * 1.08, [[0, '#FFFFFF'], [0.3, COL.ball], [0.75, '#A9B5DC'], [1, COL.ballDark]]);
    ctx.fill();
    if (o.spin != null) {
      ctx.save();
      ctx.rotate(o.spin);
      ctx.beginPath(); ctx.arc(0, 0, r * 0.66, 0.15, 1.25);
      ctx.strokeStyle = 'rgba(70,84,150,0.42)'; ctx.lineWidth = r * 0.17; ctx.lineCap = 'round'; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.66, 0.15 + PI, 1.25 + PI);
      ctx.stroke();
      ctx.restore();
    }
    // bounce light from below, then the glint
    fillEll(ctx, 'rgba(160,180,255,0.30)', 0, 0.62 * r, 0.5 * r, 0.15 * r, 0);
    fillEll(ctx, 'rgba(255,255,255,0.9)', -0.32 * r, -0.4 * r, 0.26 * r, 0.16 * r, -0.7);
    ctx.restore();
  }

  // ---------- the Pacman ball (SPEC 9.1) ----------
  // Side view like pacman(), but tuned for r of about 13 units on a busy table: a flat body with one soft gradient, a thin amber rim,
  // a dark separation ring outside the rim (so cream dots and golden lane lights never merge with the yellow), a tiny upright eye.
  // o: {dir: facing angle in rad, mouth: 0..1 (0 = closed content smile, 1 = 54 degrees half opening), bow: pink bow, alpha}
  function pacmanBall(ctx, x, y, r, o) {
    o = o || {};
    const mouth = clamp(o.mouth == null ? 0.5 : o.mouth, 0, 1);
    const dir = o.dir || 0;
    const a = mouth * 0.3 * PI;
    const open = a > 0.05;                   // below this the mouth is a smile line, never a thin slit
    const cs = cos(dir), sn = sin(dir);
    const flip = cs < -0.2;                  // facing left: mirror so the eye stays on the upper side
    begin(ctx, o);
    ctx.translate(x, y);
    // separation ring, drawn first and a little bigger than the body
    ctx.beginPath(); ctx.arc(0, 0, r + Math.max(0.9, r * 0.12), 0, TAU);
    ctx.fillStyle = 'rgba(10,12,54,0.7)'; ctx.fill();
    ctx.rotate(dir);
    if (flip) ctx.scale(1, -1);
    // light comes from the upper left of the screen whatever way he faces
    let hx = cs * -0.3 * r + sn * -0.38 * r, hy = -sn * -0.3 * r + cs * -0.38 * r;
    if (flip) hy = -hy;
    ctx.beginPath();
    if (open) { ctx.moveTo(r * 0.08, 0); ctx.arc(0, 0, r, a, TAU - a); ctx.closePath(); } else ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = radial(ctx, hx, hy, r * 0.05, hx, hy, r * 1.6, [[0, '#FFF3A8'], [0.4, COL.pacman], [1, '#F0AA22']]);
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.9, r * 0.1);
    ctx.strokeStyle = '#C98110';
    ctx.stroke();
    if (!open) {   // content smile at the front
      ctx.beginPath();
      ctx.moveTo(r * 0.36, r * 0.1);
      ctx.quadraticCurveTo(r * 0.62, r * 0.32, r * 0.86, r * 0.04);
      ctx.strokeStyle = 'rgba(120,64,4,0.85)';
      ctx.lineWidth = Math.max(1, r * 0.09);
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    if (o.bow) bowAt(ctx, -r * 0.42, -r * 0.86, r * 1.45, -0.55);
    ctx.restore();
    // the eye: placed in the body frame but drawn upright in screen space, so it never lies on its side
    const ly = flip ? r * 0.46 : -r * 0.46;
    const ex = x + cs * r * 0.14 - sn * ly, ey = y + sn * r * 0.14 + cs * ly;
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    fillEll(ctx, COL.ink2, ex, ey, r * 0.125, r * 0.175, 0);
    ctx.restore();
  }

  // ---------- the friendly big Pacman with the waving white glove (goodbye notice, badge and screen) ----------
  // The classic wedge Pacman turned a little toward the viewer: two eyes, a rosy cheek, a wide open friendly mouth with a tongue, and one
  // arm that grows out under the mouth and ends in a white cartoon glove (three fingers and a thumb) that waves. r = body radius; the glove
  // reaches out to about 1.9 r on the arm side and 1.2 r above the centre.
  // o: {wave: 0..1 (how far the hand swings, 0 = raised and still), phase: wave phase in cycles (the caller owns the clock and the speed,
  //     so the hand never jumps), open: 0..1 mouth opening (0.35 is a happy open smile), blink 0..1, hand: false hides arm and glove,
  //     side: 1 (mouth and arm on the right of the picture) or -1 (mirrored), bow, alpha}
  function gloveAt(ctx, r, ang, sd) {
    const P = r * 1.08;
    ctx.save();
    ctx.rotate(ang);
    ctx.scale(sd, 1);
    const line = '#8E98CE', fill = '#FFFFFF', shadeC = '#D9DFF6';
    const seg = function (x0, y0, x1, y1, w) { ctx.beginPath(); ctx.moveTo(x0 * P, y0 * P); ctx.lineTo(x1 * P, y1 * P); ctx.lineWidth = w * P; ctx.stroke(); };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // outlines first (a wider stroke of every part), then the white fills: one clean silhouette with a single outline
    ctx.strokeStyle = line;
    rrect(ctx, -0.23 * P, 0.2 * P, 0.46 * P, 0.16 * P, 0.06 * P); ctx.lineWidth = 0.07 * P; ctx.stroke();
    seg(-0.12, -0.15, -0.17, -0.42, 0.22); seg(0, -0.19, 0, -0.5, 0.22); seg(0.12, -0.15, 0.17, -0.42, 0.22);
    seg(-0.21, 0.05, -0.43, -0.09, 0.21);
    ctx.beginPath(); ctx.ellipse(0, 0, 0.32 * P, 0.29 * P, 0, 0, TAU); ctx.lineWidth = 0.07 * P; ctx.stroke();
    ctx.fillStyle = fill; ctx.strokeStyle = fill;
    rrect(ctx, -0.23 * P, 0.2 * P, 0.46 * P, 0.16 * P, 0.06 * P); ctx.fill();
    seg(-0.12, -0.15, -0.17, -0.42, 0.155); seg(0, -0.19, 0, -0.5, 0.155); seg(0.12, -0.15, 0.17, -0.42, 0.155);
    seg(-0.21, 0.05, -0.43, -0.09, 0.145);
    ctx.beginPath(); ctx.ellipse(0, 0, 0.32 * P, 0.29 * P, 0, 0, TAU);
    ctx.fillStyle = linear(ctx, 0, -0.29 * P, 0, 0.29 * P, [[0, '#FFFFFF'], [1, shadeC]]);
    ctx.fill();
    // two soft creases between the fingers and the cuff line
    ctx.strokeStyle = 'rgba(120,130,190,0.6)';
    seg(-0.06, -0.2, -0.06, -0.03, 0.03); seg(0.06, -0.2, 0.06, -0.03, 0.03);
    seg(-0.21, 0.2, 0.21, 0.2, 0.03);
    ctx.restore();
  }

  function pacmanWave(ctx, x, y, r, o) {
    o = o || {};
    const wave = clamp(o.wave == null ? 1 : o.wave, 0, 1);
    const ph = o.phase == null ? 0 : o.phase;
    const open = clamp(o.open == null ? 0.4 : o.open, 0, 1);
    const blink = clamp(o.blink || 0, 0, 1);
    const sd = o.side === -1 ? -1 : 1;
    const tilt = 0.25;
    begin(ctx, o);
    ctx.translate(x, y);
    if (sd < 0) ctx.scale(-1, 1);            // everything below is drawn for the arm on the right
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // arm and glove first: the body covers the root of the arm, which grows out of the lower rim under the mouth
    if (o.hand !== false) {
      const phi = 0.3 + 0.5 * wave * sin(ph * TAU);          // forearm angle from vertical, leaning outward
      const sx = 0.72 * r, sy = 0.66 * r, ex = 1.22 * r, ey = 0.7 * r, wl = 0.5 * r;
      const dx = sin(phi), dy = -cos(phi);
      const wx = ex + dx * wl, wy = ey + dy * wl;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(wx, wy);
      ctx.strokeStyle = '#D6941A'; ctx.lineWidth = r * 0.26; ctx.stroke();
      ctx.strokeStyle = COL.pacman; ctx.lineWidth = r * 0.19; ctx.stroke();
      ctx.save();
      ctx.translate(wx + dx * r * 0.24, wy + dy * r * 0.24);
      gloveAt(ctx, r, phi, 1);
      ctx.restore();
    }

    // body: the classic wedge, turned a little toward the viewer; the light stays at the upper left of the picture
    const a = 0.12 + 0.5 * open;                                    // half angle of the mouth in rad
    const hxs = -0.3 * r * sd, hys = -0.4 * r, ct = cos(tilt), st = sin(tilt);
    ctx.save();
    ctx.rotate(tilt);
    pacBody(ctx, r, a, a > 0.14, true, ct * hxs + st * hys, -st * hxs + ct * hys);
    ctx.restore();

    // two eyes on the upper half (upright), a rosy cheek
    fillEll(ctx, 'rgba(255,120,150,0.5)', -0.5 * r, -0.03 * r, r * 0.15, r * 0.1, 0);
    for (let i = 0; i < 2; i++) {
      const ex = (i ? 0.3 : -0.12) * r, ey = (i ? -0.48 : -0.5) * r;
      if (blink < 0.6) {
        fillEll(ctx, COL.ink2, ex, ey, r * 0.12, Math.max(0.5, r * 0.17 * (1 - blink * 0.9)), 0);
        fillCircle(ctx, '#FFFFFF', ex - r * 0.035, ey - r * 0.06, r * 0.04);
      } else {
        ctx.beginPath(); ctx.moveTo(ex - r * 0.11, ey); ctx.lineTo(ex + r * 0.11, ey);
        ctx.strokeStyle = COL.ink2; ctx.lineWidth = Math.max(1.2, r * 0.05); ctx.stroke();
      }
    }
    if (o.bow) bowAt(ctx, -0.5 * r, -0.86 * r, r * 1.5, -0.55);
    ctx.restore();
  }

  // ---------- a little alarm clock (the "you have played a lot" bubble) ----------
  // o: {t: seconds (the minute hand turns very slowly), alpha}
  function clock(ctx, x, y, r, o) {
    o = o || {};
    const t = o.t || 0;
    begin(ctx, o);
    ctx.translate(x, y + r * 0.06);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // bells and feet
    for (let s = -1; s <= 1; s += 2) {
      ctx.save();
      ctx.rotate(s * 0.72);
      ctx.beginPath(); ctx.arc(0, -r * 1.02, r * 0.3, PI, TAU); ctx.closePath();
      ctx.fillStyle = '#FF8DB5'; ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.06); ctx.strokeStyle = '#D45F8D'; ctx.stroke();
      ctx.restore();
      ctx.beginPath(); ctx.moveTo(s * r * 0.55, r * 0.78); ctx.lineTo(s * r * 0.72, r * 1.06);
      ctx.strokeStyle = '#D45F8D'; ctx.lineWidth = Math.max(1.4, r * 0.14); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, -r * 1.18); ctx.lineTo(0, -r * 0.92);
    ctx.strokeStyle = '#D45F8D'; ctx.lineWidth = Math.max(1.4, r * 0.12); ctx.stroke();
    // body and face
    ctx.beginPath(); ctx.arc(0, 0, r * 0.92, 0, TAU);
    ctx.fillStyle = radial(ctx, -r * 0.3, -r * 0.35, r * 0.05, 0, 0, r * 1.1, [[0, '#FFC4DC'], [0.6, '#FF8DB5'], [1, '#E6709F']]);
    ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.72, 0, TAU);
    ctx.fillStyle = '#FFF8E7'; ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.04); ctx.strokeStyle = 'rgba(160,80,120,0.35)'; ctx.stroke();
    // twelve, three, six and nine
    ctx.fillStyle = COL.ink;
    for (let i = 0; i < 4; i++) {
      const an = i * PI / 2;
      fillCircle(ctx, COL.ink, cos(an) * r * 0.56, sin(an) * r * 0.56, Math.max(0.9, r * (i === 0 ? 0.075 : 0.058)));
    }
    // hands: the hour hand rests, the minute hand crawls
    const mAng = -PI / 2 + t * 0.5;
    ctx.strokeStyle = COL.ink; ctx.lineWidth = Math.max(1.4, r * 0.1);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(cos(-PI / 2 + 1.05) * r * 0.32, sin(-PI / 2 + 1.05) * r * 0.32); ctx.stroke();
    ctx.lineWidth = Math.max(1.2, r * 0.07);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(cos(mAng) * r * 0.5, sin(mAng) * r * 0.5); ctx.stroke();
    fillCircle(ctx, '#D45F8D', 0, 0, Math.max(1.2, r * 0.08));
    ctx.restore();
  }

  // ---------- generic helpers ----------
  function glow(ctx, x, y, r, color, alpha) {
    const a = alpha == null ? 0.3 : alpha;
    const c = color && parseHex(color) ? color : '#FFF0CF';
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = radial(ctx, x, y, 0, x, y, r, [[0, withAlpha(c, a)], [1, withAlpha(c, 0)]]);
    ctx.fill();
  }
  function shadow(ctx, x, y, rx, ry, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU);
    ctx.fillStyle = radial(ctx, 0, 0, 0, 0, 0, rx, [[0, 'rgba(4,6,30,' + (alpha == null ? 0.25 : alpha) + ')'], [1, 'rgba(4,6,30,0)']]);
    ctx.fill();
    ctx.restore();
  }

  PM.Sprites = {
    pacman: pacman, pacmanBig: pacmanBig, ghost: ghost, fruit: fruit,
    dot: dot, pellet: pellet, star: star, balloon: balloon, heart: heart, sparkle: sparkle, confetti: confetti,
    speech: speech, crown: crown, trophy: trophy, questionBlock: questionBlock, mystery: questionBlock,
    keycap: keycap, icon: icon, ball: ball, pacmanBall: pacmanBall, pacmanWave: pacmanWave, clock: clock, glow: glow, shadow: shadow, zzz: zzz,
    FRUITS: FRUITS, GHOST_COLORS: GHOST_COLORS, GHOST_MOODS: GHOST_MOODS,
    PACMAN_MOODS: ['happy', 'chomp', 'surprised', 'sleepy'], ICONS: ICONS
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
