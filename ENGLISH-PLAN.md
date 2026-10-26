# Plan: English version with `?language=en`

Status: phase 1 done in `verified-src/` on 2026-10-25 (section 6, PR #1, merged). Phase 2 (the English voice) done on 2026-10-25
(section 7); nobody has listened to it yet, that is phase 3. Nothing is published yet (`docs/index.html` is unchanged) and `src/` is not
ported yet. Phases 3 to 5 are open. The owner took decisions 1 to 4 (section 3).
The Hungarian voice is frozen (the owner's decision, PR #2, merged 2026-10-25): `assets/voice/` holds the published 241 clips byte for byte
and must not change (SPEC 4.6). Nothing in this plan records, replaces or regenerates a Hungarian clip.
Branches: `english-version` (phase 1, merged), `english-voice` (phase 2).

## 1. What the player gets

| URL | Result |
|---|---|
| `https://mrkozma.github.io/pacman-flipper/` | Hungarian, exactly as today (the default does not change) |
| `…/?language=en` | English on-screen text and English voice |
| `…/?language=en&perc=15` | English, 15 minute limit (works together with every other parameter) |
| `…/?language=hu`, `?language=xx`, `?language=` | Hungarian (anything that is not English falls back to Hungarian) |

- The value is read like `perc`: trimmed, case-insensitive, and only the first two letters count (`EN`, `en-GB`, `en_US` mean English).
- Like `perc`, it is not saved anywhere. F5 keeps the query string, so a reload stays in English. Bookmark the English link for an English-speaking child.
- It is one file (`docs/index.html`) that holds both languages, so the game still works offline and the Content-Security-Policy ("nothing leaves this file") stays as it is.

## 2. What I found in the code

**Already well separated (good news):**

- Every on-screen string is in `PM.T` (`src/05_strings_hu.js`, about 105 strings counting nested and list entries) and `PM.T.r` (`src/06_strings_hu_render.js`, 17 strings). The two files are identical in `src/` and `verified-src/`.
- `40_game.js` reads `PM.T.*` at call time, and `70_render.js` copies `PM.T` inside `PM.Render.create()`, which runs after boot. Swapping `PM.T` in `boot()` before `run()` therefore switches all text. No module caches `PM.T` at load time.
- `?perc=` is parsed in `readParams()` in `90_main.js` with `URLSearchParams`, so `language` sits right next to it.
- The audio module decodes only the clips listed in the one manifest it is given (`loadVoices()` in `80_audio.js`). `80_audio.js` is identical in both source trees.
- The table art, sprites, keycaps (the space key is drawn as a bar, not a word), music, sound effects, physics and rules contain no words. Long text already shrinks to fit (`drawText(..., {maxW})`, 26 uses).
- The voice category ids (`welcome`, `dots_nyam`, `ghost_piri`, …) are just ids. They stay the same for every language.
- The ghost names (Piri, Rozi, Kiki, Nóri) are never drawn on screen and only "Nóri" is spoken once, so they can stay.

**Hungarian that sits outside the string files (small):**

- `src/index.template.html`: `<html lang="hu">`, `aria-label="Pacman Flipper játék"`, `<noscript>Ehhez a játékhoz JavaScript kell.</noscript>`.
  `verified-src/index.template.html` (and the published page) spells the label `Pacman flipper játék`, and the Hungarian `aria_label`
  keeps that spelling, because `boot()` sets the label again (phase 5 must not copy the capital F from `src/`).
- `90_main.js` `showFatal(…, ['Pacman Flipper: hiányzó modul', …])`.
- Fallbacks in `70_render.js`: `T.balls_left || 'Labdák'`, `T.paused || 'Szünet'`, `T.level || 'Szint'` (harmless once the English table is complete).
- `fmtNum()` in `70_render.js` groups thousands with a space (`12 500`, the Hungarian style). English would normally use `12,500`.

**Voice (the big part):**

- 238 Hungarian clips in 70 categories, about 529 s of speech, 4.1 MB of mp3 (56 kbps mono). They make up almost all of the 5.5 MB `docs/index.html`.
- `tools/voice_script.json` holds `{cat, who, text, tts}`. `tts` is the phonetic spelling ("Pekmen" so the Hungarian voice says "Pacman").
- `tools/gen_voice.py` is hard-wired to Hungarian. Two traps: (1) it merges **every** `tools/voice_script*.json`, so a `voice_script_en.json` next to it would be mixed into the Hungarian set as extra variants; (2) it deletes every mp3 in `assets/voice/` that its manifest does not list. English needs its own script folder and output folder.
- `tests/voice_check.py` counts syllables with Hungarian vowels (`a á e é …`) and has a fixed 6 MB budget. SPEC 4.6 sets the same "at most 6 MB of mp3" target.

**The two source trees (important for where we start):**

- `docs/index.html` (published) = `verified-src/` JavaScript byte for byte (I rebuilt it in a scratch copy and compared: the script part is identical) **plus an older Hungarian voice set** (241 clips). The `assets/voice/` in the repo is the newer 238-clip set from the unfinished `src/` round. With it, `voice_check.py` currently fails (4 clips "silence not trimmed"). **Resolved 2026-10-25 (PR #2):** `assets/voice/` is again the published 241-clip set (3.6 MB), locked by `assets/voice/FROZEN.sha256`, `voice_check.py` and a guard in `gen_voice.py`; the draft is kept at the git tag `hu-voice-draft-2026-09-30`.
- `tools/build.py` only built from `src/`: to rebuild the published page you had to copy `verified-src/` over `src/` by hand. Phase 1
  added `--src`, so `python3 tools/build.py --src verified-src` builds the published tree.
- `src/` is the newer working copy with unfinished fixes and some failing tests (README, "Állapot").

## 3. Decisions (taken by the owner, 2026-10-25)

1. **Which tree gets English first?** Decided: **`verified-src/`** (what players have now); `src/` is not touched until phase 5, which ports the same small diffs to it. The new files are the same in both trees, and `80_audio.js` is identical in both. Only `90_main.js` and the template differ a little. The alternative was to finish the `src/` round first and add English on top, which is cleaner but delays English behind the open fixes.
2. **Voice size budget.** Two full voice packs make the page about 10 to 11 MB (about 8 MB over the wire, because base64 mp3 gzips back to roughly mp3 size). Decided: **change the SPEC/`voice_check` budget to "at most 6 MB of mp3 per language"** and keep 56 kbps. If loading on the target tablet or phone feels slow, re-encode both packs at 40 kbps (about 3 MB each, speech still clear at 24 kHz mono). That is one setting in `POST` in `gen_voice.py`.
3. **US or UK English voices?** Decided: **US** (`en-US-*` edge-tts voices have a child voice, Ana, which suits the ghosts). UK has Maisie as its child voice. See Appendix B.
4. **Game name in English.** Decided: keep **"Pacman Flipper"** (it is the name and the URL); the subtitle explains it ("Pacman and the happy ghosts").

## 4. Design

### 4.1 Choosing the language (mirrors `perc`)

`90_main.js`, `readParams()`:

```js
const p = { …, perc: null, language: 'hu' };
…
p.language = PM.normLang ? PM.normLang(q.get('language')) : 'hu';   // 08_lang.js: anything unknown is Hungarian
```

`boot()`, before `missingModules()` and `run()`:

```js
if (PM.setLanguage) PM.setLanguage(params.language);   // swaps PM.T, sets PM.LANG
doc.documentElement.lang = PM.LANG || 'hu';
canvas.setAttribute('aria-label', PM.T.aria_label || 'Pacman Flipper');
```

The parsing stays in the one place that already reads URL parameters, and DOM-free files never touch `location` (Node tests have no `location`).

### 4.2 Strings

Phase 1 put the new files in `verified-src/`; phase 5 copies them to `src/`.

- **`src/07_strings_en.js`** (new, DOM-free): the English table, with the same shape as the Hungarian one, including `.r`. Draft in Appendix A.
- **`src/08_lang.js`** (new, DOM-free, about 25 lines): the registry.
  - `PM.STRINGS = { hu: <the PM.T built by 05+06>, en: PM.STRINGS_EN }`.
  - `PM.LANG = 'hu'`.
  - `PM.setLanguage(code)`: picks the table, sets `PM.T` and `PM.LANG`, returns the chosen code, and falls back to `hu` for an unknown code. A key missing from English falls back to the Hungarian value, so a gap shows Hungarian text instead of crashing or showing blank. The parity test in §4.6 stops gaps from shipping.
  - Adding a third language later = one more `0x_strings_xx.js` plus one line here.
- `05_strings_hu.js` and `06_strings_hu_render.js` stay unchanged, apart from three new keys (both languages get them): `aria_label`, `fatal_missing`, `num_sep` (a no-break space, U+00A0, for Hungarian, as `fmtNum` already used; `','` for English).
- `70_render.js` `fmtNum()`: use `PM.T.num_sep`. Optional, but `12,500` reads naturally to an English parent.
- `90_main.js` `showFatal`: use `PM.T.fatal_missing`, with a fallback of `'Pacman Flipper: missing module'` (PM.T itself may be the missing module).
- `index.template.html`: `<noscript>` becomes bilingual ("Ehhez a játékhoz JavaScript kell. / This game needs JavaScript."). It cannot depend on the URL.
- `00_ns.js` stays untouched (SPEC: frozen).

### 4.3 English voice: assets and generation

```
tools/voice_script.json          Hungarian (unchanged)
tools/voice_profiles.json        Hungarian (unchanged)
tools/en/voice_script.json       English lines, same {cat, who, text, tts} format
tools/en/voice_profiles.json     same categories/priorities/cooldowns, English neural voices
assets/voice/                    Hungarian clips + manifest.json (unchanged)
assets/voice_en/                 English clips + manifest.json (+ .raw/, .cache.json, ignored like the Hungarian ones)
```

- **`gen_voice.py --lang en`**: one flag that switches the script folder (`tools/en/`), the profile file, `VOICE_DIR`, `RAW_DIR`, `CACHE_PATH` and `MANIFEST_PATH`. Without the flag it stays the frozen Hungarian path, which refuses to run without `--unfreeze-hungarian` (SPEC 4.6); `--lang en` must never read or write `assets/voice/` or `FROZEN.sha256`. The script glob stays per folder, so the two languages never mix and the orphan sweep only touches its own folder.
- **Speaker ids stay as role names** (`noemi` = narrator, `tamas` = announcer, `piri` `rozi` `kiki` `nori` = ghosts, `pekmen` = Pacman). The English profile file maps them to English voices. The manifest format, the `who` field and `voice_check.py`'s speaker list stay valid. Suggested mapping in Appendix B. Tune pitch and rate by ear.
- **English lines**: about 200 to 240 lines over the same 70 categories (2 to 5 variants each, the one-off categories may have one). They follow the Hungarian intent of each category (SPEC 4.5 table), not a word-for-word translation. `tts` = `text` almost everywhere ("Pacman" is pronounced right by English voices). Tone and examples in Appendix B.
- `.gitignore`: add `assets/voice_en/.raw/`.

### 4.4 Build: embedding both packs

`tools/build.py` (both flags done in phase 1):

- `--src DIR` (default `src`): build from `verified-src/` without copying folders around.
- `--voice-langs hu,en` (default: every language whose manifest exists): output becomes
  `window.PM_VOICES = {"hu": {manifest, files}, "en": {manifest, files}};`
  `--voice-langs hu` gives a light Hungarian-only file. `--no-voice` stays.

### 4.5 Audio: picking the pack

`80_audio.js` `loadVoices()` (done in phase 1: without it `?language=en` would play the Hungarian voice under English text):

```js
const all = g.PM_VOICES;
const lang = (PM && PM.LANG) || 'hu';
const data = all ? all[lang] : (lang === 'hu' ? g.PM_VOICE : null);   // an older single-pack build is Hungarian only
```

- Only the chosen language is decoded, so the second pack costs download size and a base64 string in memory, not decoding time or audio memory.
- If English is chosen but the page has no English pack (built with `--voice-langs hu` or `--no-voice`), the voice stays **silent**. It does not fall back to Hungarian, because Hungarian speech under English text would confuse the child. Music and sound effects still play.

### 4.6 Tests

- **`tests/lang_test.js`** (new, Node):
  - `readParams`-style parsing cases: `en`, `EN`, `en-GB`, `hu`, `xx`, empty, missing, `?language=en&perc=0,5`.
  - `PM.setLanguage` switches and falls back.
  - **Key parity** between `PM.STRINGS.hu` and `.en`, deep, including `.r`: same keys, arrays of the same length, the same `{n}` placeholders.
  - No em or en dashes in English.
  - The default is still Hungarian with no parameter.
- **`tests/load.js`**: already supports `opts.sandbox`, so the DOM-free tests can be rerun with English loaded (`game_test`, `limit_test` and `keys_test` once more after `PM.setLanguage('en')`).
- **`tests/voice_check.py --lang en`**: checks `assets/voice_en/manifest.json` against the same required categories. It uses an English syllable estimate (vowel groups `aeiouy`, minus a silent final `e`) instead of the Hungarian vowels, and checks the per-language budget from decision 2. The `FROZEN.sha256` check stays Hungarian only; without `--lang` the script checks the frozen Hungarian folder exactly as now.
- **Screenshots**: `?language=en&screen=title|play|paused|over|notice|last|goodbye` at the SPEC 7 sizes (1280x720, 1920x1080, 800x1000, phone portrait). Look for clipped or overlapping text, especially on the goodbye screen and the notice speech bubble. The browser tests were turned off because headless Edge caused bad Windows logins. On this Mac that reason may not apply, but read the project notes first, as the README asks.
- **Listen**: unlike the Hungarian clips (README: "nobody could listen to them"), the English ones can be checked by ear. Plan one listening pass over all clips before publishing.

### 4.7 Documentation

- `README.md`: add `?language=en` under "Játékidő" (or a new "Nyelv / Language" section) and to the English summary.
- `SPEC.md`:
  - §1 (languages)
  - §3 file table: `07_strings_en.js`, `08_lang.js`
  - §4.2 URL params: add `language`
  - §4.6 per-language voice folders, `PM_VOICES`, budget
  - new §6b "English language rules": informal "you", simple words, short sentences, at most one exclamation mark per sentence, no em/en dashes, numbers spoken as words
  - §8 change-log line

## 5. Steps in order

| Phase | What | Files | Shippable on its own? |
|---|---|---|---|
| 0 | Settle decisions 1 to 4 (done 2026-10-25) | (none) | |
| 1 | Language switch + English text (done in `verified-src/`, 2026-10-25) | `90_main.js`, new `07_strings_en.js`, new `08_lang.js`, three keys in `05`/`06`, `fmtNum` in `70_render.js`, template, `80_audio.js` pack selection (§4.5), `build.py --src` and `--voice-langs`, `tests/lang_test.js` | Yes: English text with silent voice |
| 2 | English voice (done 2026-10-25, not listened to yet) | `tools/en/*.json`, `gen_voice.py --lang`, `assets/voice_en/`, `voice_check.py --lang`, `.gitignore` | Yes |
| 3 | Check | screenshots in English at four sizes, listening pass, all Node tests in both languages | |
| 4 | Publish | rebuild `docs/index.html` (from the tree chosen in decision 1), README, SPEC, commit, push | |
| 5 | Port | apply phases 1 and 2 to the other tree (`src/` if we started on `verified-src/`) | |

Phase 1 is small (about a day of careful work, most of it the strings). Phase 2 is most of the effort: writing and tuning about 240 English lines and listening to them. Generating them needs internet (edge-tts) and the Python packages that `gen_voice.py` imports (`edge-tts`, `av`, `numpy`, `mutagen`).

Resolved (PR #2, merged 2026-10-25): the owner decided that the published Hungarian voice must not change. `assets/voice/` now holds the 241 published clips byte for byte (unpacked from `docs/index.html`), so a rebuild from `verified-src/` embeds the same Hungarian voice as the live page. Phase 4 checks that again before publishing.

## 6. Phase 1 result (2026-10-25)

**Built** (all in `verified-src/`; `src/`, `docs/`, `assets/` and `README.md` are untouched):

- `07_strings_en.js` (new): `PM.STRINGS_EN`, US English, the 157 key paths of the Hungarian `PM.T` (including `.r`) in the same order.
- `08_lang.js` (new): `PM.STRINGS {hu, en}` (English = a deep copy of the Hungarian table with the English on top), `PM.LANG`, `PM.normLang`, `PM.setLanguage`.
- `05_strings_hu.js`: the three new keys `aria_label` (the published `Pacman flipper játék`), `fatal_missing`, `num_sep` (U+00A0).
- `90_main.js`: `readParams()` reads `language`; `boot()` calls `PM.setLanguage` before `missingModules()` and `run()`, then sets `<html lang>` and the canvas aria-label; `showFatal` uses `PM.T.fatal_missing`; `PM_DEBUG.params.language` shows the choice.
- `70_render.js`: `fmtNum()` uses `PM.T.num_sep` (`12,500` in English, `12 500` in Hungarian as before).
- `80_audio.js`: `loadVoices()` decodes `window.PM_VOICES[PM.LANG]`; English without a pack is silent.
- `index.template.html`: the bilingual `<noscript>`.
- `tools/build.py`: `--src DIR`, `--voice-langs`, writes `window.PM_VOICES` plus the `window.PM_VOICE` alias.
- `tests/lang_test.js` (new): (a) `PM.normLang`, (b) `PM.setLanguage`, the Hungarian fallback, no module from 10 to 80 reads `PM.T` while it loads, a scripted English game whose banners are all English, (c) deep parity and "every string translated", no Hungarian letters and no em/en dashes in English, (d) the real `90_main.js` in a fake browser (`?language=` cases, `<html lang>`, aria-label equal to the template's, the missing module screen), (e) `loadVoices` picks the pack of `PM.LANG`, (f) `fmtNum`, (g) the real renderer draws every screen in English.
- `SPEC.md`: §1, §3, §4.2, §4.6, the new §6b, §8. `verified-src/README.txt` says what the folder holds now.

**Moved forward from 4.4 and 4.5 into phase 1, and why:**

- `80_audio.js` pack selection with a silent English voice (4.5). Every build had one Hungarian pack, so without it `?language=en` would speak Hungarian under English text, which 4.5 rules out. With it, phase 1 ships on its own as "English text with silent voice".
- `window.PM_VOICES` with the `window.PM_VOICE` alias (4.4). The new loader needs one pack per language. The alias keeps the readers of the old name working: `src/80_audio.js` (untouched until phase 5, and `build.py` without `--src` still builds `src/`), `tests/i2_flow.js` and `tests/integration_browser.js` (they read `window.PM_VOICE.manifest`) and the `window.PM_VOICE` marker in `tests/run_all.js`. The new loader also reads a lone `PM_VOICE` as Hungarian (an older page, or `tests/audio_analysis.js`, which injects one into a `--no-voice` build).
- `--src DIR` (4.4). Decision 1 puts the work in `verified-src/`, and `build.py` could only build `src/`.
- `--voice-langs` (4.4). It is the other half of the `PM_VOICES` format and small. Today `--voice-langs hu` equals the default, and `--voice-langs en` stops with `no voice pack for "en"` until phase 2.

**Build and test:**

```
python3 tools/build.py --src verified-src --out dist/_en_preview.html             # the published tree, Hungarian voice only
python3 tools/build.py --src verified-src --no-voice --out dist/_en_light.html     # no voice, about 470 KB
PM_SRC=verified-src node tests/lang_test.js
PM_SRC=verified-src node tests/game_test.js                                       # and limit_test.js, keys_test.js, sim.js
```

Open `dist/_en_preview.html?language=en` (no query = Hungarian; `?language=en&perc=15` also works).

Results on 2026-10-25: `lang_test`, `game_test`, `limit_test` and `keys_test` print ALL PASS; `sim.js` has only the known failure "hole: the pop goes down and to one side" (also on the baseline, not about language). The default build from `src/` still builds and gets `PM_VOICE` through the alias. A scratch screenshot script in headless Edge on this Mac (not in `tests/`) shot the seven `?screen=` scenes at the four SPEC 7 sizes, two 33 s English autoplay runs and the Hungarian and `?language=xx` controls, and probed the voice (English: nothing decoded; Hungarian: 70 categories, 238 clips, the pre-PR #2 folder; since PR #2 it is the published 241). Zero console errors on 35 pages, the English text fits, scores read `18,458`, the Hungarian pages look as before. This is a pre-check: phase 3 repeats it with the English voice in place.

**Known gaps and notes:**

- `?perc=0,5`: the comma decimal is an unfinished `src/` fix. `verified-src/` reads `0,5` as no value (the 10 minute default), with or without `language`; `lang_test` checks only that `language` does not change how `perc` is read.
- `node tests/lang_test.js` without `PM_SRC` fails on purpose ("src has no 07_strings_en.js and 08_lang.js") until phase 5. `tests/run_all.js` does not run `lang_test.js` yet, and `tests/wiring_check.js` reads only `src/`.
- `05_strings_hu.js`, `80_audio.js`, `90_main.js` and the template now differ between the two trees (sections 2 and 3 describe the state before phase 1).
- Appendix A is the draft; the shipped strings are in `verified-src/07_strings_en.js` (for example "Press SPACE!", "Points", "New best!").

**Left for phases 2 to 5:**

- Phase 2: `tools/en/voice_script.json` and `tools/en/voice_profiles.json`, `gen_voice.py --lang en`, `assets/voice_en/`, `voice_check.py --lang en` (English syllable estimate, 6 MB per language), `.gitignore` for `assets/voice_en/.raw/`. No page code changes: once `assets/voice_en/manifest.json` exists, the default build embeds it and `?language=en` speaks English.
- Phase 3: screenshots with the English voice, the listening pass, `game_test`, `limit_test` and `keys_test` once more with English loaded, `lang_test.js` in `run_all.js`.
- Phase 4: rebuild `docs/index.html` with `--src verified-src`; before committing, check that its Hungarian pack (`PM_VOICES.hu`) is identical to the voice of the live page and that `voice_check.py` passes (the frozen voice, SPEC 4.6); README (`?language=en`), commit, push.
- Phase 5: port to `src/`: copy `07` and `08`, the three keys in `05` (keep the published `Pacman flipper játék` and change the capital F in the `src/` template; `lang_test` (d) checks that the two match), the diffs of `70`, `80`, `90` and the template, then run `node tests/lang_test.js` without `PM_SRC`.

## 7. Phase 2 result (2026-10-25)

**Built** (the Hungarian voice is untouched: `assets/voice/` has no change in git, its 242 checksums match `FROZEN.sha256`):

- `tools/en/voice_script.json` (new): 241 English lines, one for each Hungarian line, with the same category, speaker and `vol` in the
  same order. So `welcome_2.mp3` is the same moment of the game in both packs, and both have 70 categories. The lines follow the intent of
  their category (SPEC 4.5) and the rules of SPEC 6b. `tts` equals `text` except "Woo hoo", "Uh oh" and "Bye bye" (written with a
  hyphen on the page, said without it).
- `tools/en/voice_profiles.json` (new): the Hungarian categories, priorities, cooldowns and required list unchanged; the seven speaker
  ids mapped to US voices (Appendix B has the starting values).
- `tools/gen_voice.py --lang en`: reads `tools/en/`, writes only `assets/voice_en/` (`.raw/`, `.cache.json`, the mp3 files,
  `manifest.json`). Without `--lang` it is the frozen Hungarian path as before (it still refuses to run without
  `--unfreeze-hungarian`), and a guard stops any other language from writing into `assets/voice/`.
- `assets/voice_en/` (new): 241 clips in 70 categories, 3.08 MB of mp3, 453 s of speech (Hungarian: 3.6 MB, 530 s), mean 1.88 s,
  longest 6.46 s (`limit_goodbye_3`), played loudness -20.2 LUFS on average (sd 0.73), the same targets as the Hungarian clips.
- `tests/voice_check.py --lang en`: checks `assets/voice_en/` with an English syllable estimate and fails on Hungarian letters; the
  `FROZEN.sha256` check stays Hungarian only. Without `--lang` it checks the Hungarian folder exactly as before.
- `tests/wiring_check.js`: the English pack has exactly the Hungarian categories, priorities and cooldowns, every listed mp3 exists,
  and the goodbye lines pass the same timing checks (every `limit_notice` clip at most 8 s, so it ends before the 9 s notice).
- `tests/run_all.js`: a `voice_en` step; the dash scan also reads `tools/en/` and the English manifest.
- `tests/shots_mac.js` (the phase 1 scratch screenshot tool, now in the repo): the screenshots plus the language checks in headless Edge
  on this Mac. For the voice it plays `over_stars_1`, `surprise_balloons` and `surprise_fruits` (every clip of these differs by more
  than 0.8 s between the packs) and checks from the measured length that each language plays its own pack.
- `tools/listen.py` (new): writes `dist/listen.html`, every clip of a category with the English and the Hungarian version side by side.
- `.gitignore`: `assets/voice_en/.raw/` and `assets/voice_en/.cache.json`.

No page code changed: `build.py` embeds every language whose `manifest.json` exists, so a default build now carries both packs and
`?language=en` speaks English. The two-language page is 9.4 MB (the published page: 5.3 MB). A build from `src/` also carries both
packs, but `src/80_audio.js` (not ported until phase 5) reads only the Hungarian `PM_VOICE` alias.

**Build and test:**

```
~/.local/share/venvs/pacman-voice/bin/python tools/gen_voice.py --lang en     # only changed lines are synthesized again (needs internet)
~/.local/share/venvs/pacman-voice/bin/python tests/voice_check.py --lang en
python3 tools/listen.py && open dist/listen.html
python3 tools/build.py --src verified-src --out dist/_en_preview.html && node tests/shots_mac.js
```

Results on 2026-10-25: `voice_check.py --lang en` OK (0 errors; 7 warnings: the three `limit_*` categories are not in the SPEC 4.5
list, as in Hungarian, and four short exclamations with pauses count as "slow lines"); `voice_check.py` OK for the frozen Hungarian
folder; `wiring_check.js` OK; `run_all.js --only build,static,wiring,voice,voice_en` all PASS; `lang_test`, `game_test`, `limit_test`
and `keys_test` ALL PASS with `PM_SRC=verified-src`. In the two-language build `PM_VOICES.hu` is identical to the voice of the live
page. `shots_mac.js`: 55 shots, all 21 checks PASS, no console errors; with `?language=en` the three probe clips lasted 2.01, 2.06 and
2.58 s (the English files: 2.04, 2.11, 2.62 s), without it 3.11, 2.98 and 3.40 s (the Hungarian files: 3.14, 3.02, 3.43 s).

**Left for phase 3:** nobody has listened to the English clips. The speaker settings are starting values, not tuned by ear. Listen
with `dist/listen.html`, change `rate`/`pitch` in `tools/en/voice_profiles.json` (or `rate`/`pitch`/`vol` on one line of the script),
run `gen_voice.py --lang en` again, then the screenshots with the voice, `game_test`, `limit_test` and `keys_test` with English loaded,
and `lang_test.js` in `run_all.js`. The raw cache is only on this Mac: on another computer the first `--lang en` run synthesizes every
clip again (the online voices change, so the clips can change a little).

## Appendix A: draft English on-screen strings

Same keys as `05_strings_hu.js` / `06_strings_hu_render.js`. Short, warm, informal, no em/en dashes. Read by a parent, heard by a 5-year-old.
This is the draft; the shipped table is `verified-src/07_strings_en.js`, and where the two differ the file wins.

| Key | Hungarian | English draft |
|---|---|---|
| title | Pacman Flipper | Pacman Flipper |
| subtitle | Pacman és a vidám szellemek | Pacman and the happy ghosts |
| press_start | Nyomd meg a SZÓKÖZT! | Press the SPACE bar! |
| press_start_touch | Érintsd meg a képernyőt! | Touch the screen! |
| hint_launch | Nyomd meg a SZÓKÖZT! | Press the SPACE bar! |
| hint_launch_touch | Nyomd meg az indítás gombot! | Press the launch button! |
| hint_flippers | Nyilak vagy Ctrl: ütők | Arrows or Ctrl: flippers |
| key_left / key_right / key_launch | Bal ütő / Jobb ütő / Indítás | Left flipper / Right flipper / Launch |
| paused / paused_hint | Szünet / Folytatás: SZÓKÖZ | Paused / Continue: SPACE |
| score / best / ball / balls_left / level | Pontok / Rekord / Labda / Labdák / Szint | Score / Best / Ball / Balls / Level |
| game_over | Vége a játéknak! | Game over! |
| great_job | Nagyon ügyes voltál! | You did really well! |
| new_record | Új rekord! | New record! |
| play_again | Még egyet? Nyomd meg a SZÓKÖZT! | Again? Press the SPACE bar! |
| play_again_touch | Még egyet? Érintsd meg a képernyőt! | Again? Touch the screen! |
| stars_word | csillag | stars |
| sound / music / fullscreen | Hang / Zene / Teljes képernyő | Sound / Music / Full screen |
| power | Kék szellemek! / Kapd el őket! | Blue ghosts! / Catch them! |
| power_end | Felébredtek! / A szellemek újra vidámak | They woke up! / The ghosts are happy again |
| multiball | Két labda! / Figyelj mindkettőre | Two balls! / Watch them both |
| multiball_end | Egy labda maradt | One ball left |
| house | Szellemház! | Ghost house! |
| lock | A labda a házban! / Jön a következő | The ball is in the house! / Here comes the next one |
| tunnel | Alagút! | Tunnel! |
| mult | Szorzó ×{n}! / Minden pont többet ér | Points ×{n}! / Every point is worth more |
| level_clear | Minden pötty elfogyott! / Jön a gyümölcs | All the dots are gone! / Here comes a fruit |
| ballsave | Pacman elkapta! / Indítsd újra a labdát | Pacman caught it! / Launch the ball again |
| drain | Semmi baj! / Jön a következő labda | That's okay! / Here comes the next ball |
| last_ball | Utolsó labda! / Hajrá! | Last ball! / You can do it! |
| nudge | Segítünk egy kicsit | Here's a little help |
| mystery | Meglepetés! | Surprise! |
| surprise.bigflip | Nagy ütők! / Az ütők megnőttek | Big flippers! / The flippers grew |
| surprise.slow | Lassú labda! / Lebeg, mint egy felhő | Slow ball! / It floats like a cloud |
| surprise.balloons | Lufieső! / Pukkaszd ki a lufikat! | Balloon rain! / Pop the balloons! |
| surprise.fruits | Gyümölcsvásár! / Szedd össze mindet! | Fruit party! / Collect them all! |
| surprise.dance | Szellemtánc! / Dupla pont a szellemekre | Ghost dance! / Double points for ghosts |
| surprise.shield | Pacman vigyáz rád! / Nem veszhet el a labda | Pacman keeps you safe! / The ball can't get lost |
| surprise.extraball | Ajándék labda! / Még egy labdát kaptál | Bonus ball! / You got one more ball |
| fruit | Cseresznye, Eper, Narancs, Alma, Körte, Szőlő | Cherry, Strawberry, Orange, Apple, Pear, Grapes |
| ghost | Piri, Rozi, Kiki, Nóri | Piri, Rozi, Kiki, Nori |
| ready / ready_touch | Jöhet a labda! / Nyomd meg a SZÓKÖZT! (… az indítás gombot!) | Here comes the ball! / Press the SPACE bar! (… the launch button!) |
| ball_n | {n}. labda / Hajrá! | Ball {n} / Go for it! |
| combo | {n} találat! | {n} hits! |
| praise / praise_list | Ügyes vagy! (list:) Ügyes vagy! / Szuper! / Nagyszerű! / Jól csinálod! | Well done! / Super! / Great! / You're doing great! |
| lanes_done | Mind világít! / Extra pontok | All lit up! / Bonus points |
| record | Új rekord! / Nagyszerű vagy! | New record! / You're amazing! |
| limit_notice | Sokat játszottunk! / Ez lesz az utolsó labda | We played a lot! / This is the last ball |
| limit_last | Utolsó labda / Aztán pihenünk | Last ball / Then we rest |
| goodbye.title / line1 / line2 | Pá-pá! / Később folytatjuk. / Addig segíts a szüleidnek! | Bye-bye! / Let's play again later. / Until then, help your parents! |
| goodbye.parents | Szülőknek: új játékhoz töltsd újra az oldalt (F5). | For parents: reload the page (F5) to start a new game. |
| r.resume_touch | Folytatás: érintsd meg a képernyőt | Continue: touch the screen |
| r.stars | 1 csillag, 2 csillag, 3 csillag | 1 star, 2 stars, 3 stars |
| r.ball_of / r.tiny_pause_hint / r.key_pause | Labda / Szünet: P / Szünet | Ball / Pause: P / Pause |
| r.guard | Pacman vigyáz | Pacman guards |
| r.hint_flippers_touch | Bal és jobb gomb: ütők | Left and right buttons: flippers |
| aria_label (new) | Pacman flipper játék (the published label) | Pacman Flipper game |
| fatal_missing (new) | Pacman Flipper: hiányzó modul | Pacman Flipper: missing module |
| num_sep (new) | (no-break space, U+00A0, as `fmtNum` already used) | , |

(`r.limit_notice`, `r.limit_last` and `r.goodbye` repeat the lines above as fallbacks, as in Hungarian.)

## Appendix B: English voice

**Suggested speaker mapping** (`tools/en/voice_profiles.json`; check names with `edge-tts --list-voices`, tune pitch/rate by ear):

| Role id | Hungarian voice | English (US) suggestion | Character |
|---|---|---|---|
| noemi | hu-HU-NoemiNeural | en-US-JennyNeural | warm, unhurried narrator |
| tamas | hu-HU-TamasNeural | en-US-GuyNeural | playful announcer |
| piri | Noemi +pitch | en-US-AnaNeural | bold red ghost |
| rozi | Noemi ++pitch, faster | en-US-AnaNeural, higher, quicker | giggly pink ghost |
| kiki | Tamas +pitch | en-US-GuyNeural, higher | silly cyan ghost |
| nori | Noemi slow, low | en-US-JennyNeural, slow, soft | sleepy orange ghost |
| pekmen | Tamas low, slow | en-US-GuyNeural, lower, slower | hungry, cozy Pacman |

UK alternative: en-GB-SoniaNeural (narrator), en-GB-RyanNeural (announcer), en-GB-MaisieNeural (child ghosts).

Starting values in `tools/en/voice_profiles.json` (phase 2, before the listening pass; rate in %, pitch in Hz, gain in dB):
`noemi` Jenny -6/0/0, `tamas` Guy -4/+4/0, `piri` Ana 0/0/+1, `rozi` Ana +10/+20/0, `kiki` Guy -4/+28/0, `nori` Jenny -18/-6/-2.5,
`pekmen` Guy -10/-16/+0.5.

**Tone examples** (one per category type; the full script is written in phase 2):

- welcome: "Hi! Welcome to Pacman Flipper!" / "Hi there! Let's play together!"
- howto: "Use the arrows to move the flippers, and the space bar to launch the ball!"
- hint_launch: "Press the space bar!" / "Press the long button!"
- ball_2: "Second ball!" · balls_left_2: "You have two balls left."
- dots_nyam (Pacman): "Yum, yum!" / "Munch, munch!"
- pellet: "The ghosts turned blue! Catch them!"
- ghost_nori: "Peekaboo!" · ghost_bonk: "Oops, you got me!"
- fruit_cherry: "A cherry! Yummy!"
- ballsave (Pacman): "No problem! Pacman saved it!" · drain: "Oh, it rolled away! That's okay!"
- mult_2: "Double points!" · combo_5: "Five in a row!"
- limit_notice (Pacman): "We've played a lot today. After this ball I'll say goodbye, so you can rest your eyes."
- limit_goodbye (Pacman): "It was so much fun playing with you! Now it's time to say goodbye. Let's play again later. Go and help your parents! Bye!"
- limit_rest (Pacman): "Now we rest. We'll play again later!"
