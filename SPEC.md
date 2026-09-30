# Pacman Flipper: build specification (source of truth)

This file is the contract between everyone building the game. Read all of it before you write code.
If you must change an interface, edit this file in the same change and add a line to the change log at the end.

## 1. What we are building

A pinball game with a Pac-Man theme for Hungarian children (the target player is a 5-year-old).
It is delivered as ONE self-contained HTML file: `dist/pacman-flipper.html` (double-click to play in Edge or Chrome,
no install, no internet needed while playing). All text and all speech are Hungarian.

User requirements (verbatim intent, do not drop any):
- Right and left arrow keys control the right and left flippers. Space bar launches the ball.
- Many surprising elements a 5-year-old will enjoy.
- Nice sound, effects and music. Hungarian text, Hungarian voice (pre-generated Noémi + Tamás neural voices via edge-tts).
- Pretty, but NOT overwhelming: cute and friendly, not too glittery, not too fast, not too noisy.
- Exciting pinball, but not "crazy". A calm, warm, friendly feeling wins over spectacle.

## 2. Design principles (these decide every judgment call)

1. Calm and cute. Soft rounded shapes, warm friendly colors, gentle motion. Nothing flashes, nothing strobes.
   No full-screen flashes. No more than about 2 pulses per second on any element. Particle budget: at most 60 live at once.
2. Never scary, never punishing. Ghosts are silly and friendly: big eyes that follow the ball, blush, giggles.
   "Blue" ghosts are dizzy and sleepy (stars or swirl around the head), not terrified. Losing a ball is met with "Semmi baj!" (No worries).
   There is no dread game-over: a warm little tune, stars for everyone (at least 1 star always).
3. The child cannot read yet. Everything important is spoken AND shown with a big icon or picture.
   Text is large, short, high contrast, rounded font.
4. Forgiving physics. Big flippers, moderate ball speed, generous ball save, no outlane traps, no ball can ever get permanently stuck.
5. One thing at a time. Announcements queue; a banner and a spoken line never fight each other. Voice never overlaps voice.
6. Quiet by default. Music is a soft bed. SFX are soft and short. Voice is the loudest layer but still gentle.
7. Discoverable. A child mashing keys must still have fun. Hints appear after idle time, with a spoken hint.

Numeric guardrails:
- Ball max speed 950 table-units/s. Typical fall from top to bottom takes about 2 s.
- Music tempo 96 to 108 BPM. Music RMS around -22 dBFS, SFX peaks at most -8 dBFS, voice peaks around -6 dBFS.
- Chatter limit: at most one non-essential voice line per ~5 s; each category has its own cooldown.
- SFX: soft attack (at least 3 ms), sine/triangle based, filtered, mostly under 400 ms, tuned to the music key (C major pentatonic:
  C D E G A) so everything sounds harmonious. No harsh square waves at full level. Master soft limiter/compressor.

## 3. Architecture

Plain JavaScript (ES2019), no libraries, no bundler, no network at runtime. Every source file is an IIFE that attaches to
the global `PM` namespace. The build script concatenates files in filename order.

```
src/
  00_ns.js            PM namespace, PM.util (rng, clamp, lerp...), null PM.Audio   [frozen, DOM-free]
  05_strings_hu.js    PM.T Hungarian display strings                                [DOM-free]
  10_config.js        PM.CFG constants                                              [DOM-free]
  20_physics.js       PM.Physics.World                                              [DOM-free]  owner P
  30_table.js         PM.Table.build()                                              [DOM-free]  owner P
  40_game.js          PM.Game.create()                                              [DOM-free]  owner G
  50_bot.js           PM.Bot                                                        [DOM-free]  owner P
  60_sprites.js       PM.Sprites, PM.Theme                                          [browser]   owner S
  70_render.js        PM.Render.create()                                            [browser]   owner R
  80_audio.js         PM.Audio (replaces the null one)                              [browser]   owner A
  90_main.js          boot, loop, input, resize, pause                              [browser]   owner G
  index.template.html, style.css
assets/
  voice/              generated mp3 + manifest.json                                              owner V
  fonts/              Family_Weight.woff2 files (e.g. Fredoka_600.woff2)                          owner S
tools/
  build.py            python tools/build.py [--out path] [--no-voice]
  gen_voice.py, voice_script*.json                                                               owner V
tests/
  load.js             loads DOM-free modules (prefix < 60) into a Node vm context: loadPM()
  browser_helper.js   openGame({file, viewport, query}) using Playwright + system Edge
dist/                 build output. While developing, build to your own file: --out dist/_dev_<yourname>.html
```

Rules:
- Files with numeric prefix < 60 must run in plain Node (no window, no document, no Audio). Test them with `tests/load.js`.
- The game logic must call audio only through `PM.Audio.*` read at call time (never cache the object at load time), because
  `80_audio.js` replaces the null implementation from `00_ns.js`.
- UTF-8 everywhere. Hungarian letters (á é í ó ö ő ú ü ű) must survive. Read/write JSON with encoding utf-8 in Python.
- In all Hungarian strings that a person sees or hears: NO em dashes and NO en dashes as punctuation. Use commas, periods, exclamation marks.
- Table space: 540 x 960 units, origin top-left, y grows downward. Angles in radians, 0 = pointing right (+x), positive = clockwise (toward +y).
- All randomness goes through a seeded `PM.util.rng(seed)` so tests are deterministic.
- Do not use `Math.random`, `Date.now` in DOM-free modules for game logic (time comes from `dt`).
- Do not write outside this project folder except the scratchpad you are given for temp files.
- Every agent runs from `C:\CodeRepo\Codex\Pac-Man_flipper`. Windows + Git Bash. Node 24, Python 3.13, Edge at
  `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`, playwright-core installed (see tests/browser_helper.js).

## 4. Contracts

### 4.1 Table and physics (owner P)

`PM.Table.build()` returns pure data (see `30_table.js` header for the exact schema P documents). Required contents:
`W,H, walls[] (polylines, arcs pre-tessellated), posts[], bumpers[], slings[], flippers[], spinners[], holes[], tunnels[], gates[],
targets[], sensors[] (dots, pellets, lanes, fruit spot), plunger, drainY, decor{}`.
Ball radius `PM.CFG.BALL_R` = 10. Bumper ids are `piri`, `rozi`, `kiki` (ghost colors red, pink, cyan). Ghost house hole id is `house`.
Tunnels `tunL`, `tunR`. Mystery target id `mystery`. Rollover lanes `lane1..lane3`. Dots `dot_<n>`, pellets `pellet_<n>`, fruit spot `fruit`.

`new PM.Physics.World(table, {rng})`:
```
world.balls[]        {id,x,y,vx,vy,r,state:'lane'|'play'|'held'|'drained', spin?}
world.flippers[]     {id:'L'|'R', px,py, len, r0,r1, angle, angVel, up:bool}
world.spinners[]     {id, x,y, angle, angVel}
world.sensors        Map/array of {id,kind,x,y,r,active,...} (dynamic; game may add/move/remove)
world.params         {gravity, timeScale, flipperScale, bumperKick, slingKick, maxSpeed, restitution...}  // game mutates for surprises
world.setInput({left,right})             // held state of the two flipper keys
world.spawnBall() -> ball                // place a ball at rest in the plunger lane
world.setPlunger(charge01)               // visual/mechanical pull-back while Space is held
world.launch(power01) -> ball|null       // fire the ball resting in the lane; power is clamped to a kid-safe minimum that always clears the lane
world.step(dt)                           // real frame dt; internally fixed substeps (default 480 Hz), capped for tab-switch spikes
world.drainEvents() -> Event[]           // returns and clears
world.addSensor(s) / removeSensor(id) / setSensorActive(id,bool) / moveSensor(id,x,y)
world.lockBall(ballId) / releaseBall(ballId,vx,vy) / removeBall(ballId) / nudgeBall(ballId)
world.reset()
```
Events (`t` is the type): `bumper{id,ballId,speed,x,y}`, `sling{id,ballId,speed}`, `flipper{id,ballId,speed}`, `wall{ballId,speed}` (only when speed > 250),
`sensor{id,kind,ballId,x,y}` (begin-overlap only, re-arms when the ball leaves), `target{id,ballId,speed}`, `spinner{id,ballId,spin,ticks}`,
`hole{id,ballId}` (ball captured), `holeEject{id,ballId}`, `tunnel{from,to,ballId}`, `gate{id,ballId}`, `drain{ballId}`, `launch{ballId,power}`,
`ballBall{a,b,speed}`, `stuck{ballId}`.
Guarantees P must prove with `tests/sim.js` (Node soak test, seeded): no tunneling out of bounds, no NaN, no ball stuck longer than 5 s
(a `stuck` event fires and `nudgeBall` frees it), every element is reachable and hit at least once across the soak, no energy runaway,
an unattended ball drains eventually, typical ball life with the simple bot is 25 to 90 s.

`PM.Bot.create(world, {skill})` -> `{update(dt) -> {left,right,launch}}`: simple predictive flipper bot used by tests and `?autoplay=1`.

### 4.2 Game (owner G)

`PM.Game.create({seed, hiScore, autoplay})` returns `game`:
```
game.update(dt)                      // real frame dt; runs physics steps, rules, timers, state machine
game.world, game.table
game.setKeys({left,right})           // held state of the arrow keys
game.launchDown() / game.launchUp()  // Space pressed / released (charge while held)
game.start()                         // title -> play (first Space press)
game.togglePause() / game.pause() / game.resume()
game.pointer(kind, id)               // optional: touch/mouse actions from render buttons: 'sound','music','pause','fullscreen'
game.drainFx() -> Fx[]               // visual effect requests: {type:'sparkle'|'confetti'|'ring'|'pop'|'chomp'|'stars', x,y,color,n}
game.debug                           // {givePower(), triggerSurprise(id), spawnFruit(kind), setScore(n), forceScreen(name), fillDots(), drain()}
game.state                           // plain object, mutated in place, read by render
game.on(name, fn)                    // 'sfx' and 'voice' are NOT routed through this; game calls PM.Audio directly
```
`game.state` (read-only for render):
```
screen: 'title'|'play'|'paused'|'over'
time, score, hiScore, newRecord
ballNo (1..ballsTotal), ballsTotal, ballsLeft (after the current one)
multiplier (1..5), lanes:[bool,bool,bool], level, dotsLeft, dotsTotal
power: {t, dur} | null            // blue-ghost time
surprise: {id, t, dur} | null     // id in bigflip|slow|balloons|fruits|dance|shield|extraball
ballSave: seconds left (0 = off), multiball: bool
launch: {waiting, charge, idle}   // ball waiting in the lane, Space charge 0..1, seconds idle
keys: {left,right,space}          // currently held (for the on-screen key icons)
ghosts: [{id,bumperId,color,x,y,r,mood:'normal'|'blue'|'dizzy'|'happy'|'giggle'|'dance',hit(0..1),lookX,lookY}]
nori: {x,y,mood,visible}          // orange ghost that lives in the ghost house and peeks out now and then
pacmanHelper: {phase:'none'|'chomp'|'spit', t}   // ball save animation at the bottom
banner: {kind,text,sub,icon,t,dur} | null
popups: [{x,y,text,t,dur,color}]
fruitTray: ['cherry',...]         // collected this game
fruit: {kind,x,y} | null
balloons: [{id,x,y,r,color}]
stars: n (game over, 1..3)
ui: {muted, musicOn, touch}       // maintained by main
```
Fruit kinds in order: `cherry, strawberry, orange, apple, pear, grapes`. Ghost colors: `red, pink, cyan, orange`.
Ghost ids: `piri` (red), `rozi` (pink), `kiki` (cyan), `nori` (orange, ghost house).

`90_main.js` boots everything: waits for the font, creates game + render, runs a requestAnimationFrame loop (dt clamped to 1/20 s),
maps ArrowLeft/ArrowRight/Space (preventDefault, ignore auto-repeat), also touch/mouse (left half = left flipper, right half = right flipper,
launch button), P/Esc = pause, M = mute, F = fullscreen. Pauses on `visibilitychange`/blur. First user gesture calls `PM.Audio.unlock()` then `loadVoices()`.
It exposes `window.PM_DEBUG = {PM, game, render}`. URL params: `autoplay=1`, `seed=N`, `debug=1`, `mute=1`, `screen=title|play|over`.

### 4.3 Render (owner R)

```
const render = PM.Render.create(canvas, game)
render.resize()                    // handles devicePixelRatio, letterboxing (table centered, HUD on the sides or overlaid on narrow screens)
render.draw(nowSec)                // one frame; caches the static table layer in an offscreen canvas
render.layout = {scale, table:{x,y,w,h}, buttons:[{id:'sound'|'music'|'pause'|'fullscreen'|'left'|'right'|'launch', x,y,w,h}]}   // CSS px, for pointer hit tests
```
Render draws everything the player sees: backdrop, table, dots/pellets/fruit/balloons (from `world.sensors` + `state`), ghosts (with eyes following the ball),
Pacman art, flippers, ball, plunger, HUD (score, Pacman-icon balls left, multiplier, fruit tray, surprise timer), banners, popups, key hints
(big arrow and space key icons that light up when held), title / pause / game-over screens, and the light effect system (`game.drainFx()`).
It uses `PM.Sprites` and `PM.Theme` for art and `PM.T` for strings. It must degrade gracefully if `PM.Sprites` lacks something.
Respect `prefers-reduced-motion` by halving particle counts and disabling wobble.

### 4.4 Sprites and theme (owner S)

```
PM.Theme = {colors:{...}, font(sizePx, weight) -> css font string (Fredoka with fallbacks), fontsReady: Promise}
PM.Sprites.pacman(ctx,x,y,r,{mouth:0..1, dir, mood:'happy'|'chomp'|'surprised'|'sleepy', blink})
PM.Sprites.ghost(ctx,x,y,r,{color:'red'|'pink'|'cyan'|'orange', mood:'normal'|'blue'|'dizzy'|'happy'|'giggle'|'dance', look:{x,y}, t, squash:{x,y}})
PM.Sprites.fruit(ctx,kind,x,y,r,{t})       // cherry strawberry orange apple pear grapes
PM.Sprites.dot / pellet(ctx,x,y,r,{t}) / star / balloon(ctx,x,y,r,{color,t}) / heart / sparkle / confetti / speech bubble / crown / trophy
PM.Sprites.keycap(ctx,x,y,w,h,label|'left'|'right'|'space',{pressed})
PM.Sprites.icon(ctx,name,x,y,size,{color})  // speaker, speakerOff, music, musicOff, pause, play, fullscreen, question, tunnel, house
PM.Sprites.ball(ctx,x,y,r,{spin})           // the pinball: pearly, soft highlight, clearly visible on navy
```
All sprite functions are pure drawing (state comes in through the options). Center origin, radius `r`. Cheap enough to draw 30 per frame.
Palette direction: deep navy to indigo backdrop, soft periwinkle maze walls with a very subtle glow, warm cream dots,
butter-yellow Pacman (#FFD84A family), slightly pastel ghosts (red #FF6B6B, pink #FF9ECB, cyan #6FDCF0, orange #FFB45C).
Contrast must stay good (WCAG AA for text on its background).

### 4.5 Audio (owner A)

`PM.Audio` (replaces the null object in `00_ns.js`):
```
unlock() -> Promise         // create/resume AudioContext on first gesture
loadVoices() -> Promise     // decode window.PM_VOICE files (base64 mp3), build the category index from the manifest
sfx(name, {vol, rate, pan, x}) // synthesized; `rate` = pitch multiplier, `x` = table x for auto pan; unknown names are ignored
voice(cat, {priority:0..3, force}) -> bool   // plays a random variant of the category; never overlaps another voice; obeys cooldowns
voiceBusy(), stopVoice()
setMusic(mode)              // 'off'|'menu'|'play'|'power'|'surprise'|'gameover'; crossfades on the beat
setVolumes({master,music,sfx,voice}) / getVolumes()
setMuted(b) / isMuted() / setMusicOn(b) / isMusicOn()
suspend() / resume()        // pause and visibility
update(dt)                  // per-frame tick (schedulers, ducking); safe to call every frame
```
Voice priority: 3 = always plays (interrupts lower priority, queue of 1), 2 = important (waits in a short queue), 1 = normal chatter (dropped when busy),
0 = ambient (dropped when busy or within the chatter limit). Music ducks by about 6 dB while a voice line plays.
Everything that can fail (no WebAudio, decode error, autoplay block) must fail silently: the game keeps working without sound.

SFX names that the game will call (A must implement all; each rate-limited internally so rapid repeats stay pleasant):
`flipper_up, flipper_down, plunger_charge, plunger_release, bumper_piri, bumper_rozi, bumper_kiki, sling, post, wall_soft,
dot, pellet, power_start, power_end, ghost_bonk, fruit, spinner_tick, target_hit, lane_light, lane_complete, hole_enter, hole_eject,
tunnel_warp, ballsave, drain_soft, balloon_pop, star_collect, multiball_start, surprise_start, surprise_end, extra_ball, level_up,
game_start, game_over, highscore, ui_click, pause, unpause, nori_peek, giggle`.
`dot` alternates two pitches automatically (waka). `spinner_tick` takes `rate` from spin speed.

Music: original compositions only (do not quote the Namco tunes or any copyrighted song). Warm, pentatonic, folk-flavoured chiptune-meets-music-box.
Instruments built from oscillators + envelopes + filters: soft triangle bass, sine/triangle lead with quick decay, gentle bell/marimba layer, light hand-percussion
(filtered noise, low thump). 16 to 32 bar loops with an A and a B section so it does not repeat too obviously. Lookahead scheduler (about 100 ms).

Voice categories the game will call (`PM.Audio.voice(cat, {priority})`). The category ids are frozen; V writes several natural Hungarian variants
for each (2 to 5). `who` names a speaker profile (see 4.6). Suggested priority in brackets.
```
welcome [3, noemi]            first Space press on the title screen
howto [2, noemi]              controls explanation (arrows for flippers, space to launch)
hint_launch [1, noemi]        ball waiting in the lane too long
hint_flippers [1, noemi]      ball drained quickly a few times / long inactivity of the flippers
ball_ready [2, noemi]         new ball placed in the lane ("Jöhet a labda!")
launch [0, tamas]             short cheer at launch
ball_2..ball_5 [2, noemi]     "Második labda!" etc.
last_ball [3, noemi]
balls_left_1..balls_left_4 [1, noemi]   "Még két labdád van."
ghost_piri, ghost_rozi, ghost_kiki [0, piri/rozi/kiki]   short giggles and exclamations when their bumper is hit
ghost_nori [1, nori]          when Nori peeks out ("Kuku!")
ghost_bonk [1, piri/rozi/kiki]  a blue ghost is bonked ("Jaj, elkaptál!")
combo_3, combo_5, combo_10 [1, noemi]   counting rapid bumper hits
dots_nyam [0, pekmen]         "Nyam, nyam!" every so often while eating dots
pellet [2, noemi]             "Kék lettek a szellemek! Kapd el őket!"
power_end [1, noemi]
fruit_cherry, fruit_strawberry, fruit_orange, fruit_apple, fruit_pear, fruit_grapes [2, noemi]  name of the fruit + short cheer
level_clear [2, noemi]        all dots eaten
spinner [0, tamas]            "Forog, forog!"
tunnel [1, tamas]             warp
hole_enter [1, tamas]         ghost house
lock_ball [2, noemi]          first ball waits in the house
multiball [3, noemi]          two balls
multiball_end [1, noemi]
lane_done [2, noemi]          all three lanes lit, multiplier goes up ("Duplázó!"), variants per multiplier: mult_2..mult_5
mult_2..mult_5 [2, noemi]
mystery [2, tamas]            mystery target hit ("Meglepetés!")
surprise_bigflip, surprise_slow, surprise_balloons, surprise_fruits, surprise_dance, surprise_shield, surprise_extraball [3, noemi]
surprise_end [0, noemi]
balloon_pop [0, tamas]        "Puk!"
star [0, tamas]
ballsave [3, pekmen/noemi]    "Semmi baj! Pekmen megmentett!"
drain [2, noemi]              "Ó, elgurult! Semmi baj!"
praise [1, noemi]             general encouragement at score milestones ("Ügyes vagy!", "Szuper!")
nudge [1, noemi]              friendly help when a ball was stuck
over [3, noemi]               game over, warm
over_stars_1, over_stars_2, over_stars_3 [3, noemi]
newrecord [3, noemi]
play_again [2, noemi]
pause [1, noemi], resume [1, noemi]
```
The game may also call categories that do not exist; `PM.Audio.voice` must just return false.

### 4.6 Voice assets (owner V)

`tools/voice_script.json`: array of `{cat, who, text, tts, rate?, pitch?, vol?}` where `text` is what a person could read and `tts` is the
spelling that makes the neural voice pronounce correctly (for example the game name is written "Pacman" on screen but "Pekmen" in `tts`).
Speaker profiles (V tunes them and records the settings in `tools/voice_profiles.json`):
`noemi` = hu-HU-NoemiNeural, warm, slightly slow, happy narrator. `tamas` = hu-HU-TamasNeural, playful.
`piri`, `rozi`, `kiki`, `nori`, `pekmen` are the character voices made from the two neural voices with modest pitch/rate differences.
`tools/gen_voice.py` reads every `tools/voice_script*.json`, generates `assets/voice/<cat>_<n>.mp3` (skips unchanged clips using a hash cache),
and writes `assets/voice/manifest.json`:
`{"cats": {"<cat>": {"priority":n, "cooldown":seconds, "clips":[{"f":"<file>.mp3","who":"noemi","text":"...","dur":1.8}]}}}`.
Total embedded size target: at most 6 MB of mp3. Clip length: ideally 0.4 to 3.5 s, never more than 8 s.
`tools/build.py` embeds the files as `window.PM_VOICE = {manifest, files:{"<file>.mp3":"<base64>"}}`.

### 4.7 Input and controls (summary)

ArrowLeft or the LEFT Ctrl key = left flipper, ArrowRight or the RIGHT Ctrl key = right flipper (hold to keep the flipper up; the arrows and the Ctrl keys work at the same time and a flipper stays up while either of its two keys is down). Space also works while a Ctrl key is held; other Ctrl combinations (Ctrl+P, Ctrl+F, Ctrl+W) stay browser shortcuts. A Ctrl press never calls the audio unlock (it is not a browser user activation). AltGr on a Hungarian keyboard sends a fake left Ctrl that is cancelled. Space = launch: press pulls the plunger back, release fires;
a quick tap still fires at a kid-safe minimum power. P or Esc = pause, M = mute, F = fullscreen. Space also starts from the title and the game-over screen
and resumes from pause. Touch: left half of the table = left flipper, right half = right flipper, launch button.

## 5. Gameplay design

Balls per game: 5. Ball saver: 15 s from each launch (and again longer after a surprise); when it triggers, a big friendly Pacman rises at the bottom,
chomps the ball, and spits it back into the plunger lane (`pacmanHelper`). Adaptive kindness: if a ball drains within 8 s three times in a row,
the next ball gets a 30 s saver. No tilt, no nudge by the player.

Table elements (P decides exact coordinates; keep this feel):
- Three ghost bumpers (Piri red, Rozi pink, Kiki cyan) in a triangle in the upper middle. Eyes follow the ball, they wobble and giggle when hit.
- Ghost house (`house`): a saucer hole in the top middle. Nori lives there and peeks out sometimes. Ball inside is held about 1.4 s, then popped out gently.
  Every third entry starts two-ball play ("Két labda!"), the extra ball is served into the plunger lane. Two-ball play ends when one ball is left. Draining in two-ball play never costs a life.
- Two pop-lane slingshots above the flippers, moderate kick.
- Big flippers (length about 80, tapered), flipper speed fast but not violent, no outlanes (inlane guides run straight from the walls to the flippers).
- A spinner in an upper lane (fascinating for kids, soft ticks).
- Three rollover lanes at the top: light them by rolling over; all three lit = multiplier +1 (max 5) for the rest of the ball and lanes reset.
- Two tunnels on the left and right walls (Pac-Man side tunnel). The ball goes in on one side and comes out of the other with a soft whoosh.
- Dots (about 40 to 60 in several groups: along the top arch, beside the bumpers, near the inlanes). Rolling over eats them (`dot` sensor, 10 points, waka sound).
  All dots eaten = level up: dots return, a fruit appears in the fruit spot, spoken "Minden pötty elfogyott!". Hitting the fruit gives its points and its Hungarian name is spoken.
- Power pellets (4): eating one turns the ghosts blue and dizzy for 10 s. Bonking a blue ghost bumper scores 200, 400, 800, 1600 in a row (like the arcade)
  and the ghost shows stars, then is fine again after 3 s. Pellets respawn after 15 s.
- One mystery target (`mystery`, a big "?" on the right side). Hitting it starts a random gentle surprise for 8 to 12 s from a shuffle bag (no repeats until all were used),
  and it has a 20 s cooldown. Surprises:
  `bigflip` flippers grow to 1.35x. `slow` gravity 0.6x, floaty ("Lassú labda"). `balloons` five balloons drift in the middle, touching pops them (+points).
  `fruits` three fruits appear, each named aloud when hit. `dance` ghosts dance, bumpers give double points. `shield` Pacman shield: ball saver for 20 s.
  `extraball` (rare) one extra ball. Only one surprise at a time, announced by banner + voice + a soft sparkle.
- Roaming delights (no gameplay effect, calm): a small Pacman chomps across the backdrop now and then, a ghost waves from the side, Nori peeks from the house,
  bumper eyes follow the ball. Backdrop is a very soft moving maze pattern.
- Combos: rapid bumper hits within 2 s are counted aloud at 3, 5 and 10.
- Score thresholds and stars: 1 star always, 2 stars and 3 stars at thresholds that the G agent calibrates with the bot so that a bot at "kid" skill earns 2 stars
  and a good run earns 3. Hi-score in localStorage (wrapped in try/catch).

Scoring: dot 10, pellet 100, bumper 100 (blue ghost 200/400/800/1600), sling 10, spinner 25 per tick, lane 100, house 500, tunnel 250,
fruit 300, 500, 700, 1000, 1500, 2000 by kind, balloon 200. Multiplier applies to everything.

Screens:
- Title: big soft logo "Pacman Flipper", Pacman + ghosts, the SPACE key icon pulsing gently, "Nyomd meg a SZÓKÖZT!". Music `menu`.
  First press unlocks audio, says `welcome` then `howto`, starts the game with the ball waiting in the lane.
- Play: table centered, HUD large and clear, key icons at the bottom that light when pressed, hint banner when idle.
- Pause: dimmed table, "Szünet", Pacman sleeping.
- Game over: stars (1 to 3) pop in one by one with soft chimes, "Nagyon ügyes voltál!", best score, "Még egyet? Nyomd meg a SZÓKÖZT!".

## 6. Hungarian language rules

Address the child informally (tegezés), simple words, short sentences, warm tone, at most one exclamation mark per sentence. Hungarian has no grammatical
gender for "te", so lines fit any child. Say "Pekmen" in `tts`, "Pacman" on screen. No English words except the game name.
Spoken numbers as words. Keep lines varied so repetition does not become annoying. All strings displayed on screen live in `PM.T` (`src/05_strings_hu.js`).

## 7. Quality bar and test plan

- `python tools/build.py` succeeds; the built file opens in headless Edge with zero console errors and zero page errors.
- `node tests/sim.js` (soak) passes all guarantees in 4.1.
- Audio analysis test renders every SFX and 60 s of each music mode with OfflineAudioContext and checks levels (peak, RMS, clipping, silence, spectral centroid).
- Screenshots of title, play, power, surprise, game over at 1280x720, 1920x1080, 800x1000 and a phone portrait size look right (no overlap, no clipped text).
- 60 fps on an ordinary laptop: physics substeps are cheap, the static table layer is cached, no per-frame allocations in hot loops.
- No unhandled state: pausing during any state, tab blur, resize, key mashing, both flippers held forever, Space held forever, running 10 minutes on autoplay.

## 8. Change log

(append one line per interface change: date, who, what)
- 2026-09-29 S: PM.Sprites adds pacmanBig, glow, shadow, zzz, questionBlock (alias mystery), speech(ctx,x,y,w,h,opts); Fredoka lacks o/u with double acute, so the subset font gets synthesized glyphs (assets/fonts/_src/make_font.py)
- 2026-09-29 P: 20_physics.js, 30_table.js and 50_bot.js are in; additions to 4.1 (all documented in the file headers): world.elements (hit/glow timers, holes, plunger pull), world.getBall, params plungerMin/Mid/Max, flipperKick, launch power map, wall event has kind,x,y and only kinds wall/guide/rubber/arch/post, sensor r = trigger radius to the ball centre, table.upperX plus decor and spots schema, Bot.update returns {left,right,launch,power,hold}
- 2026-09-29 audio: PM.Audio.voice() returns true when the line was queued (not only when it started); suspend() fades music/sfx at once but lets a voice line finish, then suspends the context; added PM.Audio._debug (renderSfx, renderMusic, renderProbe, musicEvents, meter, state; tests only, the game must not call it)
- 2026-09-29 G: 40_game.js and 90_main.js are in. game.state extensions (full list in the 40_game.js header): power, surprise, banner and popups count `t` UP with `dur`; pacmanHelper has `dur` and a phase relative `t`; banner has pri and min; state.fruits (the three surprise fruits), combo, mystery {ready,cd}, locked, overT, delights (backdrop friends, x,y as 0..1 of the screen); banner icon names include the surprise ids, 'power', 'multiball', 'space', 'arrows', 'fruit:<kind>', 'ghost:<color>'. game.pause({silent}), game.on('screen'|'gameover'|'power'|'surprise'|'multiball'|'ui'), game.stats, PM.Game.TUNE and STARS are exported.
- 2026-09-29 G: rules that refine section 5: two-ball play LOCKS the ball on every third house entry and serves a new ball in the lane, launching it frees the locked ball and starts two-ball play; a Space tap launches with a soft random power (lane 3, 2 or 1), a hold maps to 0.2 to 1 and fires by itself after 1.55 s; one Pacman rescue per ball (15 s saver, 30 s after three quick drains) and unlimited during the shield; the mystery cooldown counts from the start of a surprise; the last few dots hop to easy spots when a level cannot be finished; stars at 12000 and 70000 points.
- 2026-09-29 R: PM.Render adds render.layout.{mode,ui,uu,panels,hud,dpr} beside scale/table/buttons, render.quality (2..0, adaptive), render.stats {ms,fps,particles,quality}, render.invalidate(); extra strings in src/06_strings_hu_render.js (PM.T.r); it reads state.overT, state.delights and pacmanHelper.dur as documented in 40_game.js and accepts t counting up or down
- 2026-09-29 R2: 70_render.js now reads the t of power, surprise, banner and popups as elapsed seconds only (the up or down guess flickered for one frame when the game reset a running timer); it also draws state.locked (golden ring on the ghost house) and adds PM.T.r.hint_flippers_touch. Two small integration fixes outside my files: 40_game.js debug.forceScreen('over') keeps a score set before it (so ?screen=over shows the score), 90_main.js starts in touch mode when matchMedia('(pointer: coarse)') matches (touch texts and buttons before the first touch).
- 2026-09-29 R2: src/style.css canvas height also 100dvh (a phone browser bar no longer hides the bottom touch buttons)
- 2026-09-29 I: integration only, no interface change. New tests/run_all.js (one command: build, static checks, every test, PASS/FAIL table), tests/integration_browser.js (real keys, audio unlock, music modes, autoplay) and tests/wiring_check.js (sfx and voice names against 80_audio.js and the manifest); render_touch, render_flipper_contact, render_real_perf, render_quality and game_browser now default to dist/pacman-flipper.html instead of dev builds

## 9. Round 2 additions (2026-09-29, requested by the user after playing the first build)

### 9.1 The ball is a Pacman (render only, physics unchanged)
The user asked: "change the ball into a Pac-Man figure so the game feels even more Pac-Man". The pinball is drawn as a small Pacman.
- Physics radius stays `PM.CFG.BALL_R` (10). The drawn radius is `BALL_R * PM.CFG.BALL_DRAW_SCALE` (1.35) so the character reads at 1280x720 (about 20 px across).
- Butter-yellow disc with the wedge mouth, a tiny eye, a very thin darker rim so it never merges with the golden dots and lane lights, the soft halo stays.
- It faces its direction of travel. The facing angle is smoothed (turn rate limited, about 0.1 s time constant) and keeps its last direction below about 60 units/s so a bouncing ball does not flicker. The mouth chomps gently: 1 to 2.2 Hz depending on speed, never faster; slow and mostly closed (a content smile) in the plunger lane, in the ghost house and when the ball is almost still. With `prefers-reduced-motion` the mouth stays half open and does not animate.
- Two-ball play: the second ball wears a small pink bow so the child can tell them apart.
- The ball stays the easiest thing on the screen to follow. `PM.Sprites.ball` remains as the fallback.

### 9.2 Ten minute goodbye ("Pacman elkoszon")
The user asked (dictated text, some words were garbled by speech recognition; this is the intended meaning): after about ten minutes of play a Pacman comes out and tells
the child that they have played a lot already; he says that after the next ball he will say goodbye so the child does not spend so much time in front of the screen;
the ball in play is allowed to finish, and then Pacman says goodbye and tells the child that they will continue later, and that meanwhile they should go and help their parents.

Rules (owner G, in 40_game.js):
- `PM.CFG.PLAY_LIMIT_SECONDS` = 600 of ACTIVE play: seconds where `state.screen === 'play'` and not paused. Title, pause and game over do not count. The counter keeps running across games in the same page session.
- `PM.Game.create({..., playLimitSeconds})`: a number of seconds, 0 = off, undefined = `CFG.PLAY_LIMIT_SECONDS`, except with `autoplay` where the default is OFF (tests and demos run for long). `90_main.js` reads the URL parameter `?perc=N` (minutes, decimals allowed, 0 = off) and passes it on; `?perc=0.25` gives a 15 second limit for testing.
- `state.limit = {enabled, phase:'none'|'notice'|'last'|'goodbye', t, playSec, limitSec, poke, score, stars}`. `t` counts UP in the current phase and also runs while in 'goodbye'. `poke` increments each time the child presses Space (or taps) on the goodbye screen.
- Phase 'notice' starts when playSec reaches limitSec (at a calm moment: never in the middle of a plunger charge; a running banner of lower priority yields). It lasts `PM.CFG.LIMIT_NOTICE_SECONDS`. Pacman speaks `limit_notice` (priority 3). Banner kind 'limit' with `PM.T.limit_notice`. Then phase 'last'.
- Phase 'last' (until the ball is done): the ball in play (or the one waiting in the lane, which is then the last ball) is allowed to finish. No new ball is served afterwards. Suppress the `extraball` surprise and new two-ball locks while 'last' is active (if two-ball play is running, wait until every ball is gone). The normal ball saver still works (it is time limited), so the child is not robbed of the last ball, but no further balls or extra lives can appear. The small persistent badge `PM.T.limit_last` shows; the banner queue is not spammed.
- When the last ball drains (or the normal game would end while 'last' is active) the phase becomes 'goodbye' and `state.screen = 'goodbye'`. Score and hi-score are saved as in a normal game over (`onHiScore`, `game.on('gameover')` fires with `limit:true`). `stars` as for game over. Pacman speaks `limit_goodbye` (priority 3); the game over jingle and the `gameover` lullaby play (main sets the music).
- On 'goodbye' Space or a tap does NOT start a game. It increments `poke` and asks for the voice line `limit_rest` (cooldown about 6 s). The way for a parent to play again is to reload the page (F5) or open it with `?perc=0`; the goodbye screen shows that in small type (`PM.T.goodbye.parents`).
- `game.debug`: `startLimit()` (jump to notice now), `setPlaySeconds(n)`, `finishLimit()` (jump to goodbye). Deterministic like the rest. Pausing during any phase is safe and the notice timer does not run while paused. Restarting after a normal game over must not lose the play-time counter. `game.on('limit', (phase) => ...)`.
- New voice categories (priority 3, speaker `pekmen`, warm, unhurried, never guilt-inducing): `limit_notice`, `limit_goodbye`, `limit_rest`. 2 to 3 variants each. Suggested content: notice = "Már nagyon sokat játszottál. A következő labda után elköszönök, hogy ne legyél annyit a képernyő előtt."; goodbye = "Nagyon jó volt veled játszani! Most elköszönök. Később folytatjuk. Addig menj, és segíts a szüleidnek! Szia!"; rest = "Most pihenünk. Később folytatjuk! Menj, segíts a szüleidnek!". The Hungarian editor role polishes them. `PM.T` gets `limit_notice {text,sub}`, `limit_last {text,sub}` and `goodbye {title, line1, line2, parents}`.

Rendering (owner R, in 70_render.js, 60_sprites.js, 06_strings_hu_render.js):
- 'notice': a big friendly Pacman "comes out" (slides and pops in from the side of the table with an ease-out-back, waves a white cartoon glove) with a speech bubble containing a clock or hourglass icon and the short text from `PM.T.limit_notice`. It must not cover the flippers or the ball's playing area: on wide windows use the side panel space; on narrow windows a compact card at the top. After LIMIT_NOTICE_SECONDS it shrinks into a small badge (`phase === 'last'`) with a tiny waving Pacman and "Utolsó labda".
- 'goodbye': the table is dimmed, a big Pacman waves goodbye slowly (about 1 Hz, gentle), the big text lines from `PM.T.goodbye`, the final score and stars small, hearts or stars floating very sparsely (no flashing), the parent line in small type at the bottom. A `poke` makes Pacman bounce once.
- Everything stays calm and cute; nothing pulses faster than 2 Hz.
- 2026-09-29 G2: ten minute goodbye (9.2) is in 40_game.js, 90_main.js and 05_strings_hu.js. Extras: state.pausedFrom ('play' or 'goodbye' while state.screen is 'paused'; pause works on the goodbye and resumes back to it), state.delights stays empty and state.overT counts on the goodbye, game.stats.limitLog, debug.forceScreen and ?screen= accept notice, last and goodbye, the notice banner has priority 3 (4 after waiting 5 s for a calm moment) and lasts exactly LIMIT_NOTICE_SECONDS, the manifest priorities of limit_notice, limit_goodbye and limit_rest come from tools/voice_profiles.json (entries added there), the 6 s rest cooldown is kept by the game because voice_check demands cooldown 0 for priority 3
- 2026-09-29 R3: round 2 rendering (SPEC 9), no deviation from 9.1 and 9.2. PM.Sprites adds pacmanBall, pacmanWave and clock (ball stays as the fallback); 70_render.js draws every ball as a Pacman (radius = world ball r * PM.CFG.BALL_DRAW_SCALE, read each frame) and draws the notice, the last ball badge and the goodbye screen from state.limit {phase, t, poke} and state.screen 'goodbye'; render.layout.hud gets notice and badge rectangles; render.ballInfo(id) and render.limitInfo() are for tests; PM.T.limit_notice, limit_last and goodbye win over the fallbacks of the same names in PM.T.r; a banner of kind 'limit' is not drawn while state.limit.phase is notice or last (the notice says the same words); roaming backdrop friends are hidden during the notice
- 2026-09-29 I2: integration only, no interface change. New tests/i2_flow.js (real-key flows on the built page: ball facing and chomp, ?perc=0.3 goodbye with keys and with the bot, ?perc=0 and default limits, embedded voice manifest and real playback of the three limit lines, touch poke and blur, no network requests, 3 minute autoplay); run_all.js gets steps ball-face, render-limit, voice-embed, ball-keys, limit-off, no-network, goodbye-tap, goodbye-keys and goodbye-bot; 06_strings_hu_render.js fallback strings now match PM.T
- 2026-09-29 lead: controls: the left and right Ctrl keys also drive the left and right flipper (arrows unchanged). 90_main.js keeps a flip state per key (arrow and Ctrl), Space and the flipper keys work while Ctrl is held, other Ctrl combinations are left to the browser, a Ctrl press does not call PM.Audio.unlock(), the AltGr fake ControlLeft is cancelled. PM.T.hint_flippers now reads "Nyilak vagy Ctrl: ütők". New DOM-free test tests/keys_test.js (real game + real 90_main.js in a fake browser).
