/* engine/tempo.js – UK._engine.tempo: Dauern je Modus ('schnell' | 'realismus' | 'direkt'), Uhr und Zeitangaben. Reine Funktionen, Zufall wird übergeben. */
(function () {
  'use strict';
  var G = typeof window !== 'undefined' ? window : globalThis;
  var UK = G.UK = G.UK || {};
  UK._engine = UK._engine || {};

  var MODI = ['schnell', 'realismus', 'direkt'];
  function gueltigerModus(m) { return MODI.indexOf(m) >= 0 ? m : 'schnell'; }
  function zwischen(z, a, b) { return a + (b - a) * z(); }
  function begrenze(x, a, b) { return Math.max(a, Math.min(b, x)); }

  // Standarduhr (ersetzbar über UK.engine.uhr)
  function standardUhr() {
    return {
      jetzt: function () { return Date.now(); },
      warte: function (ms) { return new Promise(function (r) { setTimeout(r, Math.max(0, ms | 0)); }); }
    };
  }

  // Einstellwerte (ms). Gemessen mit /private/tmp/claude-501/zeit/ (siehe ZEIT-BERICHT.md, «Nach der Einstellung»).
  var EINSTELLUNG = {
    schnell:   { zMin: 75,  zMax: 110, basis: 1500, tMin: 2200, tMax: 8000,  vorMin: 1000, vorMax: 3000, leseMs: 280 },
    realismus: { zMin: 130, zMax: 190, basis: 2000, tMin: 3000, tMax: 16000, vorMin: 2500, vorMax: 6000, leseMs: 280 }
  };
  function woerter(t) { var m = String(t || '').trim().match(/\S+/g); return m ? m.length : 0; }
  // Vorlauf (Mike liest, denkt) gestaffelt nach Länge der eigenen Nachricht: kurz = kurz, lang = lang (n >= 70 Zeichen: Maximum).
  function vorlauf(E, n, z) {
    var f = 0.7 * begrenze(n / 70, 0, 1) + 0.3 * z();
    return E.vorMin + (E.vorMax - E.vorMin) * f;
  }

  // Tipp-Rhythmus für eine Nachricht. Liefert Abschnitte: [{tippt:true|false, ms}], Summe = Gesamtdauer.
  // vorher: kurze Lesepause vor dem Tippen (Mike liest, denkt).
  // spannung (0|1|2, optional): Mike stockt öfter. Es entstehen nie Wörter, nur «schreibt …» setzt aus und wieder an.
  // vorher (optional, Text der vorherigen Nachricht von Mike): Lesezeit-Mindestabstand im Schnell- und Realismusmodus,
  // damit lange Nachrichtenserien (Textschwall) nicht schneller eintreffen, als man sie lesen kann (leseMs je Wort).
  function tippen(text, modus, z, spannung, vorherText) {
    text = String(text || '');
    var n = text.length;
    spannung = spannung || 0;
    if (modus === 'direkt') return [];
    var E = EINSTELLUNG[modus] || EINSTELLUNG.schnell;
    var lese = vorherText ? woerter(vorherText) * E.leseMs : 0;
    var teile;
    if (modus === 'schnell') {
      var ms = begrenze(E.basis + n * zwischen(z, E.zMin, E.zMax), E.tMin, E.tMax);
      var v = vorlauf(E, n, z);
      if (spannung >= 2 && n > 35 && z() < 0.15) { // abgeschwächt: kurzes Stocken
        var a = ms * zwischen(z, 0.35, 0.6);
        teile = [{ tippt: false, ms: Math.round(v) }, { tippt: true, ms: Math.round(a) },
          { tippt: false, ms: Math.round(zwischen(z, 400, 900)) }, { tippt: true, ms: Math.round(ms - a) }];
      } else {
        teile = [{ tippt: false, ms: Math.round(v) }, { tippt: true, ms: Math.round(ms) }];
      }
    } else {
      // Realismus: Zeit je Zeichen + Grundwert, Denkpause, gelegentlich setzt «schreibt» kurz aus
      var gesamt = begrenze(E.basis + n * zwischen(z, E.zMin, E.zMax), E.tMin, E.tMax);
      teile = [{ tippt: false, ms: Math.round(vorlauf(E, n, z)) }];
      if (n > 35 && z() < (spannung >= 2 ? 0.4 : spannung === 1 ? 0.3 : 0.22)) {
        var erster = gesamt * zwischen(z, 0.3, 0.6);
        teile.push({ tippt: true, ms: Math.round(erster) });
        teile.push({ tippt: false, ms: Math.round(zwischen(z, 900, 2600)) }); // hört auf zu tippen …
        teile.push({ tippt: true, ms: Math.round(gesamt - erster + zwischen(z, 200, 700)) }); // … und setzt wieder an
      } else {
        teile.push({ tippt: true, ms: Math.round(gesamt) });
      }
    }
    var summe = 0;
    for (var i = 0; i < teile.length; i++) summe += teile[i].ms;
    if (lese > summe) teile[0].ms += Math.round(lese - summe); // Lesezeit-Mindestpause (zuerst «online», ohne «schreibt»)
    return teile;
  }

  // Kurzer Abstand nach einer Nachricht des Spielers, bevor Mike reagiert
  function nachSpieler(modus, z) {
    if (modus === 'direkt') return 0;
    if (modus === 'schnell') return Math.round(zwischen(z, 300, 700));
    return Math.round(zwischen(z, 900, 2600));
  }

  // Ein Medium «senden» (Bild/Memo lädt)
  function medium(modus, z) {
    if (modus === 'direkt') return 0;
    if (modus === 'schnell') return Math.round(zwischen(z, 3000, 5000));
    return Math.round(zwischen(z, 4000, 8000));
  }

  // Erzählte Pause: sekunden = erzählte Zeit. Schnell 8–25 s (je erzählter Länge), Realismus echt aber höchstens 180 s, Direkt 0.
  function pause(sekunden, modus) {
    sekunden = Math.max(0, +sekunden || 0);
    if (modus === 'direkt' || !sekunden) return 0;
    if (modus === 'schnell') return Math.round(8000 + begrenze(sekunden / 300, 0, 1) * 17000);
    return Math.round(Math.min(sekunden, 180) * 1000);
  }

  // Stille-Frist in Sekunden: Realismus voll, sonst die Hälfte (mind. 20 s), 60 → 30 s
  function stille(sekunden, modus) {
    sekunden = Math.max(0, +sekunden || 0);
    if (!sekunden) return 0;
    if (modus === 'realismus') return sekunden;
    return Math.max(20, Math.round(sekunden / 2));
  }

  // «15 Sekunden später», «8 Minuten später», «Eine Stunde später»
  function zeitText(sek) {
    sek = Math.max(0, Math.round(+sek || 0));
    if (sek < 60) return (sek <= 1 ? 'Eine Sekunde' : sek + ' Sekunden') + ' später';
    var min = Math.round(sek / 60);
    if (min < 60) return (min === 1 ? 'Eine Minute' : min + ' Minuten') + ' später';
    var std = Math.round(min / 60);
    return (std === 1 ? 'Eine Stunde' : std + ' Stunden') + ' später';
  }

  // Erzählte Uhrzeit HH:MM aus Sekunden seit Mitternacht
  function uhrzeit(sek) {
    sek = Math.max(0, Math.floor(+sek || 0)) % 86400;
    var h = Math.floor(sek / 3600), m = Math.floor((sek % 3600) / 60);
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  UK._engine.tempo = {
    MODI: MODI, gueltigerModus: gueltigerModus, standardUhr: standardUhr,
    tippen: tippen, nachSpieler: nachSpieler, medium: medium, pause: pause, stille: stille,
    zeitText: zeitText, uhrzeit: uhrzeit
  };
})();
