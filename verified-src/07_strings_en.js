/* 07_strings_en.js: every English (US) string shown on screen. DOM-free.
   PM.STRINGS_EN has exactly the keys of the Hungarian PM.T built by 05 + 06 (including .r), in the same order.
   This file never touches PM.T: 08_lang.js registers the table and PM.setLanguage('en') makes it PM.T.
   Rules (SPEC 6b): informal "you", simple words, short sentences, at most one exclamation mark per sentence,
   no em dashes or en dashes, US English. {n} is replaced by the game. Spoken lines are not here. */
(function (g) {
  'use strict';
  const PM = g.PM = g.PM || {};
  PM.STRINGS_EN = {
    title: 'Pacman Flipper',
    subtitle: 'Pacman and the happy ghosts',
    press_start: 'Press SPACE!',
    press_start_touch: 'Tap the screen!',
    hint_launch: 'Press SPACE!',
    hint_launch_touch: 'Press the launch button!',
    hint_flippers: 'Arrows or Ctrl: flippers',
    key_left: 'Left flipper',
    key_right: 'Right flipper',
    key_launch: 'Launch',
    paused: 'Paused',
    paused_hint: 'Press SPACE to continue',
    score: 'Points',
    best: 'Best',
    ball: 'Ball',
    balls_left: 'Balls',
    level: 'Level',
    game_over: 'Game over!',
    great_job: 'You did great!',
    new_record: 'New best!',
    play_again: 'Play again? Press SPACE!',
    play_again_touch: 'Play again? Tap the screen!',
    stars_word: 'stars',
    sound: 'Sound',
    music: 'Music',
    fullscreen: 'Full screen',
    // banners: text is the big line, sub is the small line
    power: { text: 'Blue ghosts!', sub: 'Catch them!' },
    power_end: { text: 'They woke up!', sub: 'The ghosts are happy again' },
    multiball: { text: 'Two balls!', sub: 'Watch them both' },
    multiball_end: { text: 'Back to one ball', sub: '' },
    house: { text: 'Ghost house!', sub: '' },
    lock: { text: 'Ball in the house!', sub: 'Here comes the next one' },
    tunnel: { text: 'Tunnel!', sub: '' },
    mult: { text: 'Points ×{n}!', sub: 'Every point is worth more' },
    level_clear: { text: 'All the dots are gone!', sub: 'Here comes the fruit' },
    ballsave: { text: 'Pacman caught it!', sub: 'Launch the ball again' },
    drain: { text: "That's okay!", sub: 'Here comes the next ball' },
    last_ball: { text: 'Last ball!', sub: 'You can do it!' },
    nudge: { text: "Here's a little help", sub: '' },
    mystery: { text: 'Surprise!', sub: '' },
    surprise: {
      bigflip: { text: 'Big flippers!', sub: 'The flippers got bigger' },
      slow: { text: 'Slow ball!', sub: 'It floats like a cloud' },
      balloons: { text: 'Balloon rain!', sub: 'Pop the balloons!' },
      fruits: { text: 'Fruit party!', sub: 'Grab them all!' },
      dance: { text: 'Ghost dance!', sub: 'Ghosts give double points' },
      shield: { text: 'Pacman keeps you safe!', sub: "You can't lose the ball" },
      extraball: { text: 'Extra ball!', sub: 'You got one more ball' }
    },
    fruit: {
      cherry: 'Cherry', strawberry: 'Strawberry', orange: 'Orange',
      apple: 'Apple', pear: 'Pear', grapes: 'Grapes'
    },
    ghost: { piri: 'Piri', rozi: 'Rozi', kiki: 'Kiki', nori: 'Nori' },
    // game banners (the "appended by the game agent" block of 05)
    ready: { text: 'Your ball is ready!', sub: 'Press SPACE!' },
    ready_touch: { text: 'Your ball is ready!', sub: 'Press the launch button!' },
    ball_n: { text: 'Ball {n}', sub: "Let's go!" },
    combo: { text: '{n} in a row!', sub: '' },
    praise: { text: 'Good job!', sub: '' },
    praise_list: ['Good job!', 'Super!', 'Awesome!', "You're doing great!"],
    lanes_done: { text: 'All lit up!', sub: 'Extra points' },
    record: { text: 'New best!', sub: "You're amazing!" },
    // ten minute goodbye (SPEC 9.2)
    limit_notice: { text: "We've played a lot!", sub: 'This is the last ball' },
    limit_last: { text: 'Last ball', sub: 'Then we rest' },
    goodbye: {
      title: 'Bye-bye!',
      line1: "Let's play again later.",
      line2: 'Now go help your parents!',
      parents: 'Parents: reload the page (F5) for a new game.'
    },
    // page strings outside the canvas text (90_main.js) and the thousands separator of the score (fmtNum in 70_render.js)
    aria_label: 'Pacman Flipper game',
    fatal_missing: 'Pacman Flipper: missing module',
    num_sep: ',',
    // renderer only (06_strings_hu_render.js)
    r: {
      resume_touch: 'Tap the screen to continue',
      stars: ['1 star', '2 stars', '3 stars'],
      ball_of: 'Ball',
      tiny_pause_hint: 'Pause: P',
      guard: 'Pacman on guard',
      key_pause: 'Pause',
      hint_flippers_touch: 'Left and right buttons: flippers',
      limit_notice: { text: "We've played a lot!", sub: 'This is the last ball' },
      limit_last: { text: 'Last ball', sub: 'Then we rest' },
      goodbye: {
        title: 'Bye-bye!',
        line1: "Let's play again later.",
        line2: 'Now go help your parents!',
        parents: 'Parents: reload the page (F5) for a new game.'
      }
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
