/* engine/speicher.js – UK._engine.speicher: sicheres localStorage (try/catch, ohne Speicher lauffähig) und Prüfung/Reparatur von Spielständen. */
(function () {
  'use strict';
  var G = typeof window !== 'undefined' ? window : globalThis;
  var UK = G.UK = G.UK || {};
  UK._engine = UK._engine || {};

  var VERSION = 1;
  var PREFIX = 'uk_unknown_';

  function lies(sp, schluessel) {
    if (!sp) return null;
    try {
      var roh = sp.getItem(PREFIX + schluessel);
      if (roh === null || roh === undefined || roh === '') return null;
      return JSON.parse(roh);
    } catch (e) { return null; }
  }
  function schreibe(sp, schluessel, wert) {
    if (!sp) return false;
    try { sp.setItem(PREFIX + schluessel, JSON.stringify(wert)); return true; } catch (e) { return false; }
  }
  function loesche(sp, schluessel) {
    if (!sp) return;
    try { sp.removeItem(PREFIX + schluessel); } catch (e) { /* egal */ }
  }

  function istObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function nurStrings(a) { return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string'; }) : []; }

  // Prüft und repariert einen Spielstand gegen die aktuelle Geschichte. Liefert sauberen Zustand oder null.
  function pruefe(roh, story) {
    if (!istObj(roh) || !story || !istObj(story.szenen)) return null;
    if (typeof roh.szene !== 'string' || !story.szenen[roh.szene]) return null;
    var z = {
      v: VERSION,
      szene: roh.szene,
      phase: ['ablauf', 'wahl', 'ende'].indexOf(roh.phase) >= 0 ? roh.phase : 'ablauf',
      schritt: (typeof roh.schritt === 'number' && isFinite(roh.schritt) && roh.schritt >= 0) ? Math.floor(roh.schritt) : 0,
      antwortId: typeof roh.antwortId === 'string' ? roh.antwortId : null,
      nachText: typeof roh.nachText === 'string' ? roh.nachText : null,
      nachNachrichten: Array.isArray(roh.nachNachrichten) ? roh.nachNachrichten.filter(function (m) { return istObj(m) && typeof m.text === 'string'; })
        .map(function (m) { return { von: ['mike', 'ich', 'ethan', 'system'].indexOf(m.von) >= 0 ? m.von : 'mike', text: m.text }; }) : null,
      modus: UK._engine.tempo.gueltigerModus(roh.modus),
      merker: {},
      ort: typeof roh.ort === 'string' ? roh.ort : null,
      entdeckteOrte: nurStrings(roh.entdeckteOrte),
      besucht: nurStrings(roh.besucht),
      verlauf: [],
      weg: Array.isArray(roh.weg) ? roh.weg.filter(function (e) { return istObj(e) && typeof e.id === 'string'; })
        .map(function (e) { return { szene: typeof e.szene === 'string' ? e.szene : '', id: e.id, text: typeof e.text === 'string' ? e.text : null }; }) : [],
      stilleRest: (typeof roh.stilleRest === 'number' && isFinite(roh.stilleRest) && roh.stilleRest >= 0) ? roh.stilleRest : null,
      spielzeit: (typeof roh.spielzeit === 'number' && isFinite(roh.spielzeit)) ? roh.spielzeit : null,
      karte: roh.karte === undefined ? null : roh.karte,
      gespeichert: typeof roh.gespeichert === 'number' ? roh.gespeichert : 0
    };
    // Merker: Startwerte der Geschichte, darüber nur einfache Werte aus dem Stand
    var start = istObj(story.merker) ? story.merker : {};
    Object.keys(start).forEach(function (k) { z.merker[k] = start[k]; });
    if (istObj(roh.merker)) {
      Object.keys(roh.merker).forEach(function (k) {
        var w = roh.merker[k];
        if (typeof w === 'boolean' || typeof w === 'number' || typeof w === 'string') z.merker[k] = w;
      });
    }
    if (Array.isArray(roh.verlauf)) {
      roh.verlauf.forEach(function (e) {
        if (!istObj(e)) return;
        var von = ['mike', 'ich', 'system', 'ethan'].indexOf(e.von) >= 0 ? e.von : 'mike';
        var art = ['text', 'medium', 'pause'].indexOf(e.art) >= 0 ? e.art : 'text';
        if (art === 'medium' && typeof e.id !== 'string') return;
        if (art !== 'medium' && typeof e.text !== 'string') return;
        var eintrag = { von: von, art: art };
        if (art === 'medium') eintrag.id = e.id;
        eintrag.text = typeof e.text === 'string' ? e.text : '';
        eintrag.zeit = typeof e.zeit === 'string' ? e.zeit : '';
        if (typeof e.sprecher === 'string') eintrag.sprecher = e.sprecher;
        z.verlauf.push(eintrag);
      });
    }
    if (z.phase === 'ende' && !(story.szenen[z.szene].ende)) z.phase = 'ablauf';
    return z;
  }

  UK._engine.speicher = { VERSION: VERSION, PREFIX: PREFIX, lies: lies, schreibe: schreibe, loesche: loesche, pruefe: pruefe };
})();
