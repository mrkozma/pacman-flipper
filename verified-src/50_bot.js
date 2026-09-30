/* 50_bot.js: PM.Bot.create(world, {skill, seed}) -> {skill, update(dt) -> {left, right, launch, power, hold}}.
   DOM-free. A simple predictive flipper bot for tests and ?autoplay=1.

   skill 0..1:  0 = idle (only launches, never flips), 0.8 = "kid" (default: reacts a little late, sometimes misses; ball
   life about 35 s median), 1 = perfect (no delay, no misses; ball life about 50 s median, with a long tail).
   update(dt) returns the keys to hold this frame: left, right (flipper keys) and launch = true for exactly one call when
   the bot wants to fire the plunger. power 0..1 is how strong it pulls (call world.launch(power), or hold Space for
   'hold' seconds through the game), hold = suggested Space hold time in seconds.
   The returned object is reused between calls (copy it if you keep it). The bot only reads world.balls / world.flippers
   and never changes the world. Its randomness comes from its own seeded rng, so a run is reproducible.

   How it plays: for each flipper it watches every ball in play in the flipper's own frame (distance along the
   resting flipper and height above it). A fast ball that will touch the flipper within the swing time gets flipped at
   once; a slow ball rolling on the flipper is flipped when it reaches a random spot along it (so shots vary). The skill
   sets a random reaction delay (up to 0.32 s times 1 - skill) and a miss chance (the flipper ignores that ball). */
(function (g) {
  'use strict';
  const PM = g.PM = g.PM || {};
  const U = PM.util;

  function create(world, opts) {
    opts = opts || {};
    const skill = opts.skill === undefined ? 0.8 : opts.skill;
    const rng = U.rng(opts.seed === undefined ? 777 : opts.seed);
    const st = {
      time: 0,
      launchAt: -1,
      // per flipper state
      side: [
        { pressAt: -1, releaseAt: -1, down: false, ignoreUntil: 0, cooldownUntil: 0, aim: 0.5 },
        { pressAt: -1, releaseAt: -1, down: false, ignoreUntil: 0, cooldownUntil: 0, aim: 0.5 }
      ]
    };
    const out = { left: false, right: false, launch: false, power: 0, hold: 0 };

    const reactMax = 0.32 * (1 - skill);          // reaction delay upper bound (s)
    const missChance = 0.30 * (1 - skill) * (1 - skill) + (skill < 1 ? 0.04 * (1 - skill) : 0);
    const G = () => world.params.gravity;
    const LEAD = 0.045;                            // how far ahead (s) to look: the swing needs about 50 ms

    function launchLogic() {
      let waiting = null;
      const rest = world.table.plunger.restY;
      for (const b of world.balls) if (b.state === 'lane' && b.y >= rest - 2 && Math.abs(b.vy) < 25) waiting = b;   // resting on the plunger
      if (!waiting) { st.launchAt = -1; return; }
      if (st.launchAt < 0) st.launchAt = st.time + 0.5 + rng() * (skill >= 0.9 ? 0.4 : 1.1);
      if (st.time >= st.launchAt) {
        out.launch = true;
        out.power = skill >= 0.9 ? 0.2 + rng() * 0.8 : rng() * rng() * 1.6;
        if (out.power > 1) out.power = 1;
        out.hold = 0.15 + out.power * 0.6;
        st.launchAt = -1;
      }
    }

    function sideLogic(idx) {
      const f = world.flippers[idx];
      const s = st.side[idx];
      if (!f) return false;
      // scheduled press / release
      if (s.pressAt >= 0 && st.time >= s.pressAt) { s.down = true; s.pressAt = -1; s.releaseAt = st.time + 0.14 + rng() * 0.16; }
      if (s.down && st.time >= s.releaseAt) { s.down = false; s.cooldownUntil = st.time + 0.12; }
      if (s.down || s.pressAt >= 0 || st.time < s.cooldownUntil) return s.down;
      if (skill <= 0) return false;

      const ex = Math.cos(f.restAngle), ey = Math.sin(f.restAngle);
      let ux = ey, uy = -ex;                       // unit normal on the top side of the resting flipper
      if (uy > 0) { ux = -ux; uy = -uy; }
      const g = G();
      for (const b of world.balls) {
        if (b.state !== 'play') continue;
        const px = b.x + b.vx * LEAD, py = b.y + b.vy * LEAD + 0.5 * g * LEAD * LEAD;
        const rx = px - f.px, ry = py - f.py;
        const along = rx * ex + ry * ey;
        const hgt = rx * ux + ry * uy;
        const approach = -(b.vx * ux + b.vy * uy);
        const a0 = (b.x - f.px) * ex + (b.y - f.py) * ey;
        const h0 = (b.x - f.px) * ux + (b.y - f.py) * uy;
        if (approach > 120) {
          // fast ball: it will touch the flipper within the swing time, react wherever it lands
          if (along < -10 || along > f.len + 12 || hgt > 26 || h0 > 90 || hgt < -4) continue;
        } else {
          // slow or rolling ball: wait until it has rolled to the chosen spot, then flip
          if (a0 < s.aim * f.len || a0 > f.len + 12 || h0 > 34 || h0 < 2 || approach < -90) continue;
        }
        // a trigger: maybe miss it, maybe react late
        if (st.time < s.ignoreUntil) return false;
        if (rng() < missChance) { s.ignoreUntil = st.time + 0.7; s.aim = 0.15 + rng() * 0.8; return false; }
        s.pressAt = st.time + rng() * reactMax;
        s.aim = 0.15 + rng() * 0.8;
        return false;
      }
      return false;
    }

    return {
      skill: skill,
      update(dt) {
        st.time += dt;
        out.launch = false;
        launchLogic();
        out.left = sideLogic(0);
        out.right = sideLogic(1);
        return out;
      }
    };
  }

  PM.Bot = { create: create };
})(typeof globalThis !== 'undefined' ? globalThis : window);
