/* main.js – verbindet Daten, Engine, Oberfläche, Karte und Medien und startet das Spiel.
   Dazu die Funktionen aus FUNKTIONEN.md, die mehrere Module brauchen: Tab-Titel «(1) Mike», Enden-Archiv «Dein Weg»,
   «Geteilte Medien» (Daten für das Kontaktprofil), «ohne Zeitdruck» an die Engine, Gerüst für die Wiederkehr nach Ende 4. */
(function () {
  'use strict';
  var UK = window.UK;
  var root = document.getElementById('uk-root');
  if (!UK || !root) return;

  // Wiederkehr nach Ende 4 (FUNKTIONEN.md 8): NUR Gerüst. Der Text kommt wörtlich von Raffi; ohne Text passiert nichts.
  // Einschalten: aktiv:true und nachrichten:['…'] (oder UK.story.meta.wiederkehr mit denselben Feldern).
  var WIEDERKEHR = { aktiv: false, nachEnde: 'end_brief', stunden: 12, nachrichten: [] };

  var K_ARCHIV = 'uk_unknown_archiv', K_ENDE4 = 'uk_unknown_ende4_zeit', K_WIEDER = 'uk_unknown_wiederkehr_gezeigt';
  function speicher() { try { return window.localStorage; } catch (e) { return null; } }
  function lies(k, d) { try { var v = window.localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function schreib(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ohne Speicher weiter */ } }
  function zwei(n) { return (n < 10 ? '0' : '') + n; }

  // ---------- Enden-Archiv ----------
  function endenDerGeschichte() {
    var sz = (UK.story && UK.story.szenen) || {};
    return Object.keys(sz).filter(function (k) { return sz[k] && sz[k].ende; })
      .map(function (k) { var e = sz[k].ende; return { id: e.id || k, nummer: e.nummer || 0, kopf: e.kopf || '', titel: e.titel || sz[k].titel || '', album: e.album || null }; })
      .sort(function (a, b) { return a.nummer - b.nummer; });
  }
  function archiv() {
    var sam = UK.engine.endeSammlung ? UK.engine.endeSammlung() : { ids: [], erreicht: 0, gesamt: 5 };
    var wege = lies(K_ARCHIV, {}) || {};
    var liste = endenDerGeschichte().map(function (e) {
      var gesehen = sam.ids.indexOf(e.id) >= 0;
      if (!gesehen) return { nummer: e.nummer, gesehen: false, kopf: 'Ende ' + e.nummer };
      var w = wege[e.id] || {};
      return { nummer: e.nummer, gesehen: true, kopf: e.kopf, titel: e.titel, schlussbild: e.album, weg: Array.isArray(w.weg) ? w.weg : [] };
    });
    return { erreicht: sam.erreicht, gesamt: sam.gesamt, liste: liste };
  }

  // ---------- Titel ----------
  function titel() {
    UK.ui.showTitle({
      hatSpielstand: !!(UK.engine.hatSpielstand && UK.engine.hatSpielstand()),
      archiv: archiv(),
      onStart: function (modus) { UK.ui.leere(); UK.engine.start(modus); },
      onFortsetzen: function () { UK.ui.leere(); UK.engine.fortsetzen(); }
    });
  }
  function zumTitel() { if (UK.engine.stoppe) UK.engine.stoppe(); titel(); }

  // ---------- Geteilte Medien (Kontaktprofil): nur, was in diesem Durchgang wirklich gesendet wurde ----------
  function profil() {
    var z = UK.engine.zustand && UK.engine.zustand();
    var md = (UK.story && UK.story.medien) || {}, dateien = UK.medienDateien || {};
    var medien = [];
    ((z && z.verlauf) || []).forEach(function (e) {
      if (e.art !== 'medium' || !e.id) return;
      var m = md[e.id] || {}, f = dateien[e.id] || {};
      medien.push({ id: e.id, art: m.art === 'memo' ? 'memo' : 'foto', titel: m.titel || e.text || '', zeit: e.zeit || '', bild: (f.bildT || f.bild) ? 'medien/assets/' + (f.bildT || f.bild) : null });
    });
    return { name: UK.ui.kontakt ? UK.ui.kontakt() : 'Mike', medien: medien };
  }

  // ---------- Tab-Titel «(1) Mike», wenn die Seite im Hintergrund ist ----------
  var grundTitel = document.title, ungelesen = 0;
  function tabTitel() { document.title = ungelesen ? '(' + ungelesen + ') ' + ((UK.ui.kontakt && UK.ui.kontakt()) || 'Mike') : grundTitel; }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState !== 'hidden') { ungelesen = 0; tabTitel(); } });

  // ---------- Wiederkehr nach Ende 4 (Gerüst) ----------
  function wiederkehrDaten() {
    var m = UK.story && UK.story.meta && UK.story.meta.wiederkehr;
    var w = {}; for (var k in WIEDERKEHR) w[k] = WIEDERKEHR[k];
    if (m && typeof m === 'object') for (var j in m) w[j] = m[j];
    return w;
  }
  function wiederkehr() {
    var w = wiederkehrDaten();
    var texte = Array.isArray(w.nachrichten) ? w.nachrichten.filter(function (t) { return typeof t === 'string' && t.trim(); }) : [];
    if (!w.aktiv || !texte.length || lies(K_WIEDER, false)) return false;
    var seit = lies(K_ENDE4, 0);
    if (!seit || Date.now() - seit < (+w.stunden || 12) * 3600000) return false;
    schreib(K_WIEDER, true); // einmalig
    var d = new Date(), zeit = zwei(d.getHours()) + ':' + zwei(d.getMinutes());
    UK.ui.leere();
    UK.ui.setKontakt((UK.story.meta && UK.story.meta.kontakt) || 'Mike', 'weg', { zuletzt: zeit });
    texte.forEach(function (t) { UK.ui.addNachricht({ von: 'mike', text: t, zeit: zeit, art: 'text', sofort: true, aufbau: true }); });
    UK.ui.friereStatus && UK.ui.friereStatus(true); // kein Antwortfeld, Mike bleibt «zuletzt online»
    return true;
  }

  try {
    UK.ui.init(root);
    UK.engine.init({
      story: UK.story,
      ui: UK.ui,
      karte: UK.karte,
      medien: UK.medien,
      speicher: speicher(),
      onZurueck: titel
    });
    if (UK.engine.setOhneFrist && UK.ui.einstellung) UK.engine.setOhneFrist(!!UK.ui.einstellung('ohneFrist'));
    UK.ui.setHooks({
      onTitel: zumTitel,
      onProfil: profil,
      hatSlot: function (i) { var s = UK.engine.spielstaende && UK.engine.spielstaende(['slot' + i]); return !!(s && s[0] && !s[0].leer); }
    });
    UK.ui.mountKarteKnopf(function () { });

    UK.engine.on('nachricht', function (e) {
      if (document.visibilityState === 'hidden' && e && (e.von === 'mike' || e.von === 'ethan')) { ungelesen++; tabTitel(); }
    });
    UK.engine.on('ende', function (e) {
      var z = UK.engine.zustand && UK.engine.zustand();
      var wege = lies(K_ARCHIV, {}) || {};
      wege[e.id] = { weg: ((z && z.weg) || []).map(function (w) { return { text: w.text || null }; }), datum: Date.now() };
      schreib(K_ARCHIV, wege);
      if (e.id === wiederkehrDaten().nachEnde) { schreib(K_ENDE4, Date.now()); schreib(K_WIEDER, false); }
    });

    if (!wiederkehr()) titel();
  } catch (e) {
    root.innerHTML = '<p class="uk-notiz">Das Spiel konnte nicht starten.</p>';
    if (window.console) console.warn('UNKNOWN Start:', e);
  }
})();
