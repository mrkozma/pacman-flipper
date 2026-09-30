/* 06_strings_hu_render.js: extra Hungarian strings that only the renderer (70_render.js) needs. DOM-free.
   Kept in its own file so 05_strings_hu.js stays untouched. Everything lives under PM.T.r.
   Rules as in 05: informal address, simple words, no em dashes or en dashes. */
(function (g) {
  'use strict';
  const PM = g.PM = g.PM || {};
  PM.T = PM.T || {};
  PM.T.r = {
    resume_touch: 'Folytatás: érintsd meg a képernyőt',
    stars: ['1 csillag', '2 csillag', '3 csillag'],
    ball_of: 'Labda',
    tiny_pause_hint: 'Szünet: P',
    guard: 'Pacman vigyáz',
    // shown small under the flipper keys on wide screens
    key_pause: 'Szünet',
    // title screen on a touch device (the on-screen buttons at the bottom are the flippers)
    hint_flippers_touch: 'Bal és jobb gomb: ütők',
    // ten minute goodbye (SPEC 9.2). The renderer reads PM.T.limit_notice, PM.T.limit_last and PM.T.goodbye first (owned by the game
    // agent and the Hungarian editor) and falls back to these when they are missing.
    limit_notice: { text: 'Sokat játszottunk!', sub: 'Ez lesz az utolsó labda' },
    limit_last: { text: 'Utolsó labda', sub: 'Aztán pihenünk' },
    goodbye: {
      title: 'Pá-pá!',
      line1: 'Később folytatjuk.',
      line2: 'Addig segíts a szüleidnek!',
      parents: 'Szülőknek: új játékhoz töltsd újra az oldalt (F5).'
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
