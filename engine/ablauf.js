/* engine/ablauf.js – UK._engine.ablauf(szene, eintritt) -> [Schritt]. Liefert die vollständige, ungefilterte Schrittliste einer Szene (Bedingungen `wenn` prüft die Engine beim Abspielen). Stabil: gleiche Szene + gleicher Eintritt = gleiche Liste (wichtig für Spielstände mitten in der Szene). */
(function () {
  'use strict';
  var G = typeof window !== 'undefined' ? window : globalThis;
  var UK = G.UK = G.UK || {};
  UK._engine = UK._engine || {};

  // Text in Absätze teilen (Leerzeile = neue Nachricht)
  function absaetze(text) {
    return String(text || '').split(/\n\s*\n/).map(function (t) { return t.trim(); }).filter(Boolean);
  }
  function nachrichten(text, von, wenn) {
    return absaetze(text).map(function (t) { return { art: 'nachricht', von: von, text: t, wenn: wenn || null }; });
  }

  // Einen Schritt aus den Daten vereinheitlichen
  function normal(s, vonStandard) {
    if (s === null || s === undefined) return null;
    if (typeof s === 'string') return { art: 'nachricht', von: vonStandard, text: s, wenn: null };
    if (typeof s !== 'object') return null;
    var art = s.art || (s.medium ? 'medium' : (s.ort && !s.text ? 'ort' : 'nachricht'));
    if (art === 'medium' || art === 'bild' || art === 'memo') {
      var id = s.id || s.medium;
      return id ? { art: 'medium', id: String(id), von: s.von || vonStandard, wenn: s.wenn || null } : null;
    }
    if (art === 'pause') return { art: 'pause', ms: +s.ms || 0, sekunden: +s.sekunden || (s.ms ? s.ms / 1000 : 0), grund: s.grund || '', text: s.text || null, wenn: s.wenn || null };
    if (art === 'warten') return { art: 'warten', sekunden: +s.sekunden || 0, ms: +s.ms || 0, wenn: s.wenn || null };
    if (art === 'ort') return s.ort || s.id ? { art: 'ort', ort: String(s.ort || s.id), wenn: s.wenn || null } : null;
    if (art === 'nachricht' || art === 'text') {
      if (typeof s.text !== 'string' || !s.text.trim()) return null;
      return { art: 'nachricht', von: s.von || vonStandard, text: s.text, wenn: s.wenn || null, dauer: s.dauer, sprecher: s.sprecher || null };
    }
    return null; // unbekannte Art: überspringen (neuere Daten)
  }

  function vonStandard(szene) {
    var ab = (szene.ende && szene.ende.absender) || szene.absender || null;
    if (!ab) return 'mike';
    ab = String(ab).toLowerCase();
    if (ab === 'ethan') return 'ethan';
    if (ab === 'mike') return 'mike';
    return 'system';
  }

  function baue(szene, eintritt) {
    eintritt = eintritt || {};
    var von = vonStandard(szene);
    var liste = [];
    // nachText der gewählten Antwort: Mike schreibt sofort danach (vor allem anderen)
    if (Array.isArray(eintritt.nachNachrichten) && eintritt.nachNachrichten.length) {
      eintritt.nachNachrichten.forEach(function (m) { var n = normal(m, 'mike'); if (n) liste.push(n); });
    } else if (eintritt.nachText) liste = liste.concat(nachrichten(eintritt.nachText, 'mike'));

    if (Array.isArray(szene.ablauf)) {
      szene.ablauf.forEach(function (s) { var n = normal(s, von); if (n) liste.push(n); });
      return liste;
    }

    // Ersatz, falls die Daten kein `ablauf` liefern: aus den Einzelfeldern zusammensetzen
    if (szene.eroeffnungsOrt) liste.push({ art: 'ort', ort: szene.eroeffnungsOrt, wenn: null });
    if (szene.eroeffnungsText) liste = liste.concat(nachrichten(szene.eroeffnungsText, von));
    if (szene.warten) liste.push({ art: 'warten', sekunden: +szene.warten || 0, wenn: null });
    if (szene.pause) liste.push({ art: 'pause', sekunden: +szene.pause.sekunden || 0, ms: +szene.pause.ms || 0, grund: szene.pause.grund || '', wenn: null });
    if (szene.eroeffnungsOrt && szene.ort) liste.push({ art: 'ort', ort: szene.ort, wenn: null });
    if (szene.spielerNachPause) liste = liste.concat(nachrichten(szene.spielerNachPause, 'ich'));
    var an = szene.antwortNachrichten || {};
    Object.keys(an).forEach(function (rid) {
      (an[rid] || []).forEach(function (m) {
        var t = typeof m === 'string' ? m : m && m.text;
        var w = { all: [{ antwort: rid }].concat(m && m.wenn ? [m.wenn] : []) };
        nachrichten(t, von, w).forEach(function (x) { liste.push(x); });
      });
    });
    var gesetzt = {};
    (szene.nachrichten || []).forEach(function (m) {
      var n = normal(m, von);
      if (!n) return;
      if (n.art === 'medium') gesetzt[n.id] = true;
      if (n.art === 'nachricht') nachrichten(n.text, n.von, n.wenn).forEach(function (x) { liste.push(x); });
      else liste.push(n);
    });
    (szene.medien || []).forEach(function (id) { if (!gesetzt[id]) liste.push({ art: 'medium', id: id, von: von, wenn: null }); });
    if (szene.schlussText) liste = liste.concat(nachrichten(szene.schlussText, von));
    return liste;
  }

  UK._engine.ablauf = baue;
  UK._engine.absaetze = absaetze;
})();
