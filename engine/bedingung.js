/* engine/bedingung.js – UK._engine.bedingung(C, merker, kontext) -> bool. Wertet Merker-Bedingungen aus (Formate siehe engine/README.md). */
(function () {
  'use strict';
  var UK = (typeof window !== 'undefined' ? window : globalThis).UK = (typeof window !== 'undefined' ? window : globalThis).UK || {};
  UK._engine = UK._engine || {};

  // Bedingung: null | {flag:'x'} | {not:C} | {all:[]} | {any:[]} | {antwort:'id'} | {merkerName:wert,…} (Raffis Kurzform) | [C,…] (= all)
  function pruefe(c, merker, kontext) {
    if (c === null || c === undefined || c === true) return true;
    if (c === false) return false;
    merker = merker || {};
    kontext = kontext || {};
    if (Array.isArray(c)) {
      for (var i = 0; i < c.length; i++) if (!pruefe(c[i], merker, kontext)) return false;
      return true;
    }
    if (typeof c === 'string') return !!merker[c];
    if (typeof c !== 'object') return !!c;
    var schluessel = Object.keys(c);
    if (!schluessel.length) return true;
    var ok = true;
    for (var k = 0; k < schluessel.length && ok; k++) {
      var s = schluessel[k], w = c[s];
      if (s === 'flag') ok = !!merker[w];
      else if (s === 'not') ok = !pruefe(w, merker, kontext);
      else if (s === 'all') ok = Array.isArray(w) ? w.every(function (x) { return pruefe(x, merker, kontext); }) : pruefe(w, merker, kontext);
      else if (s === 'any') ok = Array.isArray(w) ? w.some(function (x) { return pruefe(x, merker, kontext); }) : pruefe(w, merker, kontext);
      else if (s === 'antwort') ok = Array.isArray(w) ? w.indexOf(kontext.antwortId) >= 0 : kontext.antwortId === w;
      else if (s === 'wert') ok = true; // reserviert
      else ok = (typeof w === 'boolean') ? (!!merker[s] === w) : (merker[s] === w); // Kurzform {merker:true/false}
    }
    return ok;
  }

  // Alle Merker-Namen, die in einer Bedingung vorkommen (für Prüfungen)
  function merkerIn(c, liste) {
    liste = liste || [];
    if (!c || typeof c !== 'object') { if (typeof c === 'string') liste.push(c); return liste; }
    if (Array.isArray(c)) { c.forEach(function (x) { merkerIn(x, liste); }); return liste; }
    Object.keys(c).forEach(function (s) {
      var w = c[s];
      if (s === 'flag') liste.push(w);
      else if (s === 'not') merkerIn(w, liste);
      else if (s === 'all' || s === 'any') merkerIn(w, liste);
      else if (s === 'antwort' || s === 'wert') { /* keine Merker */ }
      else liste.push(s);
    });
    return liste;
  }

  UK._engine.bedingung = pruefe;
  UK._engine.merkerIn = merkerIn;
})();
