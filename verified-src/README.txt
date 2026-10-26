The JavaScript, page template and CSS of the build that is published in docs/index.html
(the last verified build of 2026-09-29 plus the left/right Ctrl flipper keys),
plus the English version of ENGLISH-PLAN.md (published 2026-10-26): ?language=en gives English text and the English voice
(07_strings_en.js, 08_lang.js and small changes in 05, 70, 80, 90 and the template). Hungarian stays the default.
The folder src/ is the newer working copy with quality fixes that were not finished or checked in a browser yet;
it has the same language change since phase 5 of ENGLISH-PLAN.md (2026-10-26).
Build: python3 tools/build.py --src verified-src --out dist/<name>.html
Test:  PM_SRC=verified-src node tests/lang_test.js (and game_test.js, limit_test.js, keys_test.js, sim.js;
       PM_LANG=en runs game_test.js, limit_test.js and keys_test.js in English)
tools/build.py embeds the fonts and the voice packs from assets/: assets/voice/ is the published Hungarian voice (241 clips,
frozen, assets/voice/FROZEN.sha256), assets/voice_en/ the English voice (241 clips).
