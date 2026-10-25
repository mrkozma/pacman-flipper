/* 08_lang.js: the language registry. DOM-free. Runs after 05 + 06 (the Hungarian PM.T) and 07 (PM.STRINGS_EN).
   PM.STRINGS.hu   the PM.T built by 05 + 06 (the same object)
   PM.STRINGS.en   a deep copy of the Hungarian table with PM.STRINGS_EN on top (an English array replaces the whole array),
                   so a key missing in English shows the Hungarian text instead of crashing (tests/lang_test.js stops such gaps)
   PM.LANG         'hu' until PM.setLanguage() picks another table
   PM.normLang(v)  trimmed, lower case, first two letters ('EN', ' en ', 'en-GB', 'en_US' give 'en'); not in PM.STRINGS: 'hu'
   PM.setLanguage(code) -> the chosen code; sets PM.T and PM.LANG. 90_main.js calls it in boot(), before PM.Render.create()
                   copies PM.T. A new language = one more 0x_strings_xx.js plus one line here. */
(function (g) {
  'use strict';
  const PM = g.PM = g.PM || {};
  const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  // a deep copy of base with over on top: objects merge key by key (base order first), an array or a plain value in over wins
  function merge(base, over) {
    if (over === undefined) return isObj(base) ? merge(base, {}) : Array.isArray(base) ? base.slice() : base;
    if (Array.isArray(over)) return over.slice();
    if (!isObj(over)) return over;
    const b = isObj(base) ? base : {}, out = {};
    Object.keys(b).forEach((k) => { out[k] = merge(b[k], over[k]); });
    Object.keys(over).forEach((k) => { if (!(k in out)) out[k] = merge(undefined, over[k]); });
    return out;
  }

  PM.STRINGS = { hu: PM.T };
  if (PM.STRINGS_EN) PM.STRINGS.en = merge(PM.T, PM.STRINGS_EN);
  PM.LANG = 'hu';
  PM.normLang = function (v) {
    const c = String(v || '').trim().toLowerCase().slice(0, 2);
    return Object.prototype.hasOwnProperty.call(PM.STRINGS, c) ? c : 'hu';
  };
  PM.setLanguage = function (code) {
    code = PM.normLang(code);
    PM.T = PM.STRINGS[code];
    PM.LANG = code;
    return code;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
