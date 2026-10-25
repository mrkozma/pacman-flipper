/* 05_strings_hu.js: every Hungarian string shown on screen. DOM-free.
   Rules: informal address (tegezes), simple words, short sentences, no em dashes or en dashes.
   Spoken lines live in tools/voice_script.json (not here). */
(function (g) {
  'use strict';
  const PM = g.PM = g.PM || {};
  PM.T = {
    title: 'Pacman Flipper',
    subtitle: 'Pacman és a vidám szellemek',
    press_start: 'Nyomd meg a SZÓKÖZT!',
    press_start_touch: 'Érintsd meg a képernyőt!',
    hint_launch: 'Nyomd meg a SZÓKÖZT!',
    hint_launch_touch: 'Nyomd meg az indítás gombot!',
    hint_flippers: 'Nyilak vagy Ctrl: ütők',
    key_left: 'Bal ütő',
    key_right: 'Jobb ütő',
    key_launch: 'Indítás',
    paused: 'Szünet',
    paused_hint: 'Folytatás: SZÓKÖZ',
    score: 'Pontok',
    best: 'Rekord',
    ball: 'Labda',
    balls_left: 'Labdák',
    level: 'Szint',
    game_over: 'Vége a játéknak!',
    great_job: 'Nagyon ügyes voltál!',
    new_record: 'Új rekord!',
    play_again: 'Még egyet? Nyomd meg a SZÓKÖZT!',
    play_again_touch: 'Még egyet? Érintsd meg a képernyőt!',
    stars_word: 'csillag',
    sound: 'Hang',
    music: 'Zene',
    fullscreen: 'Teljes képernyő',
    // banners: text is the big line, sub is the small line
    power: { text: 'Kék szellemek!', sub: 'Kapd el őket!' },
    power_end: { text: 'Felébredtek!', sub: 'A szellemek újra vidámak' },
    multiball: { text: 'Két labda!', sub: 'Figyelj mindkettőre' },
    multiball_end: { text: 'Egy labda maradt', sub: '' },
    house: { text: 'Szellemház!', sub: '' },
    lock: { text: 'A labda a házban!', sub: 'Jön a következő' },
    tunnel: { text: 'Alagút!', sub: '' },
    mult: { text: 'Szorzó ×{n}!', sub: 'Minden pont többet ér' },
    level_clear: { text: 'Minden pötty elfogyott!', sub: 'Jön a gyümölcs' },
    ballsave: { text: 'Pacman elkapta!', sub: 'Indítsd újra a labdát' },
    drain: { text: 'Semmi baj!', sub: 'Jön a következő labda' },
    last_ball: { text: 'Utolsó labda!', sub: 'Hajrá!' },
    nudge: { text: 'Segítünk egy kicsit', sub: '' },
    mystery: { text: 'Meglepetés!', sub: '' },
    surprise: {
      bigflip: { text: 'Nagy ütők!', sub: 'Az ütők megnőttek' },
      slow: { text: 'Lassú labda!', sub: 'Lebeg, mint egy felhő' },
      balloons: { text: 'Lufieső!', sub: 'Pukkaszd ki a lufikat!' },
      fruits: { text: 'Gyümölcsvásár!', sub: 'Szedd össze mindet!' },
      dance: { text: 'Szellemtánc!', sub: 'Dupla pont a szellemekre' },
      shield: { text: 'Pacman vigyáz rád!', sub: 'Nem veszhet el a labda' },
      extraball: { text: 'Ajándék labda!', sub: 'Még egy labdát kaptál' }
    },
    fruit: {
      cherry: 'Cseresznye', strawberry: 'Eper', orange: 'Narancs',
      apple: 'Alma', pear: 'Körte', grapes: 'Szőlő'
    },
    ghost: { piri: 'Piri', rozi: 'Rozi', kiki: 'Kiki', nori: 'Nóri' }
  };
  // ---- appended by the game agent (G): banner texts used by 40_game.js. {n} is replaced by the game.
  Object.assign(PM.T, {
    ready: { text: 'Jöhet a labda!', sub: 'Nyomd meg a SZÓKÖZT!' },
    ready_touch: { text: 'Jöhet a labda!', sub: 'Nyomd meg az indítás gombot!' },
    ball_n: { text: '{n}. labda', sub: 'Hajrá!' },
    combo: { text: '{n} találat!', sub: '' },
    praise: { text: 'Ügyes vagy!', sub: '' },
    praise_list: ['Ügyes vagy!', 'Szuper!', 'Nagyszerű!', 'Jól csinálod!'],
    lanes_done: { text: 'Mind világít!', sub: 'Extra pontok' },
    record: { text: 'Új rekord!', sub: 'Nagyszerű vagy!' }
  });
  // ---- appended by the goodbye feature (G2, SPEC 9.2): after about ten minutes of play Pacman says goodbye.
  // limit_notice is the banner text of the notice phase, limit_last the small badge of the last ball, goodbye the final screen.
  Object.assign(PM.T, {
    limit_notice: { text: 'Sokat játszottunk!', sub: 'Ez lesz az utolsó labda' },
    limit_last: { text: 'Utolsó labda', sub: 'Aztán pihenünk' },
    goodbye: {
      title: 'Pá-pá!',
      line1: 'Később folytatjuk.',
      line2: 'Addig segíts a szüleidnek!',
      parents: 'Szülőknek: új játékhoz töltsd újra az oldalt (F5).'
    }
  });
  // ---- appended by the English version (lang, SPEC 6b): keys that every language has (English: 07_strings_en.js).
  // aria_label is the canvas label (90_main.js sets it in boot(), so it is the aria-label of index.template.html letter for letter),
  // fatal_missing the first line of the missing module screen (90_main.js), num_sep groups the thousands of a score (fmtNum in
  // 70_render.js): a no-break space, so the text wrapping of 70_render.js never splits 12 500.
  Object.assign(PM.T, {
    aria_label: 'Pacman flipper játék',
    fatal_missing: 'Pacman Flipper: hiányzó modul',
    num_sep: '\u00a0'
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
