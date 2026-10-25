The JavaScript, page template and CSS of the build that is published in docs/index.html
(the last verified build of 2026-09-29 plus the left/right Ctrl flipper keys),
plus phase 1 of ENGLISH-PLAN.md (2026-10-25, not published yet): ?language=en shows English text with no voice
(07_strings_en.js, 08_lang.js and small changes in 05, 70, 80, 90 and the template). Hungarian stays the default.
The folder src/ is the newer working copy with quality fixes that were not finished or checked in a browser yet;
it is still Hungarian only (phase 5 of ENGLISH-PLAN.md ports the language change to it).
Build: python3 tools/build.py --src verified-src --out dist/<name>.html
Test:  PM_SRC=verified-src node tests/lang_test.js (and game_test.js, limit_test.js, keys_test.js, sim.js)
tools/build.py embeds the fonts and voice clips from assets/. The published page has an older Hungarian voice set (241 clips);
assets/voice/ holds the newer 238-clip set, see ENGLISH-PLAN.md section 5.
