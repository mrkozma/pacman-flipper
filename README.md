# Pacman Flipper

Magyar nyelvű, Pac-Man témájú flipperjáték kisgyerekeknek (a célközönség egy 5 éves). Egyetlen HTML fájl, a játékhoz nem kell internet, és mindent magyarul mond és ír ki.

**Játék:** https://mrkozma.github.io/pacman-flipper/

## Irányítás

| Billentyű | Mit csinál |
|---|---|
| Bal nyíl vagy bal Ctrl | bal flipper |
| Jobb nyíl vagy jobb Ctrl | jobb flipper |
| Szóköz | labda kilövése (nyomva tartva erősebb), a játék indítása |
| P vagy Esc | szünet |
| M | hang ki/be |
| F | teljes képernyő |

Érintőképernyőn a képernyő bal és jobb fele a két flipper. A hang az első billentyű- vagy egérnyomás után indul.

## Játékidő

Tíz perc aktív játék után Pac-Man előjön, elmondja, hogy ez lesz az utolsó labda, majd elköszön. A szünet és a címképernyő nem számít bele. A weboldal címének végére írva átállítható:

* `?perc=15` 15 percre
* `?perc=0` kikapcsolja a korlátot
* `?perc=0.5` fél percre, kipróbáláshoz

Új játékot az oldal újratöltésével (F5) lehet indítani.

## Állapot (2026-09-30)

* `docs/index.html` a közzétett, ellenőrzött változat. Ennek a JavaScript-forrása a `verified-src/` mappában van.
* A `src/` mappa az újabb munkapéldány. Egy minőségellenőrző kör 31 megerősített javítása van benne részben, még nem ellenőrizve böngészőben, és néhány teszt (`game_test`, `limit_test`) emiatt hibát jelez.
* A magyar hangok zárolva vannak (2026-10-25): az `assets/voice/` mappa pontosan a közzétett oldal 241 hangfájlját tartalmazza, ezt az `assets/voice/FROZEN.sha256` és a `tests/voice_check.py` ellenőrzi. Egy félbehagyott, 238 fájlos változat a `hu-voice-draft-2026-09-30` git-címkénél érhető el.
* Nem ellenőrzött valódi videokártyán, telefonon, Firefoxban és Safariban. Az összes hangot csak mérésekkel néztük, meghallgatni senki nem tudta őket.

## Fejlesztés

```
python tools/build.py              # dist/pacman-flipper.html
node tests/sim.js                  # fizikai szimuláció
node tests/game_test.js            # játékszabályok
node tests/limit_test.js           # az elköszönés
node tests/keys_test.js            # billentyűk (kamu böngészővel, böngésző nélkül)
python tests/voice_check.py        # hangfájlok
```

A tervet és a szerződéseket a `SPEC.md` tartalmazza. A forrásfájlok számozottak (`src/NN_*.js`), a 60 alattiak böngésző nélkül, Node-ban is futnak. A magyar hangokat az `edge-tts` csomaggal generálta a `tools/gen_voice.py` (internet kell hozzá). A hangok zárolva vannak, ezért az eszköz csak a `--unfreeze-hungarian` kapcsolóval fut: csak akkor használd, ha tényleg új magyar hangokat akarsz.

A böngészős tesztek (`tests/browser_helper.js`, Playwright) ezen a fejlesztői gépen ki vannak kapcsolva, mert a fejetlen Edge-indítások hibás Windows-bejelentkezéseket okoztak. Lásd a projekt jegyzeteit, mielőtt újra bekapcsolod őket.

## Jogi megjegyzés

Ez egy nem hivatalos, hobbi rajongói projekt. A Pac-Man név és a klasszikus játék a Bandai Namco védjegye, a projekt nem áll velük kapcsolatban, és nem kereskedelmi célú. A karakterek saját rajzok, a zene és a hangeffektek saját, kódból szintetizált szerzemények.

A magyar beszédet a Microsoft Edge felolvasó hangjaival (Noémi, Tamás) készítettem az `edge-tts` nem hivatalos eszközzel. Magánhasználatra szántam, a szélesebb terjesztés jogi helyzetét nem vizsgáltam. A Fredoka betűtípus az SIL Open Font License alatt van.

Licencet még nem adtam a kódhoz.

---

## English summary

A Hungarian-language, Pac-Man themed pinball game for small children, delivered as one self-contained HTML file (no network needed, everything spoken and written in Hungarian). Play it at https://mrkozma.github.io/pacman-flipper/.

Controls: left/right arrow or left/right Ctrl = flippers, Space = launch, P/Esc = pause, M = mute, F = fullscreen. After ten minutes of active play Pacman announces the last ball and says goodbye (`?perc=N` in the URL changes the minutes, `?perc=0` turns it off).

`docs/index.html` is the published, verified build (its JavaScript is in `verified-src/`); `src/` is a newer working copy with unfinished, unverified quality fixes. The Hungarian voice in `assets/voice/` is frozen to the published 241 clips (`assets/voice/FROZEN.sha256`, checked by `tests/voice_check.py`); `tools/gen_voice.py` only runs with `--unfreeze-hungarian`. Unofficial fan project, not affiliated with Bandai Namco; no license has been granted for the code yet.
