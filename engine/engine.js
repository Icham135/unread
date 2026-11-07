/* engine/engine.js – UK.engine: spielt UK.story ab. init({story,ui,karte,medien,speicher,onZurueck}) · start(modus) · setModus(m) · ueberspringeBisEntscheidung() · waehle(id) · speichern(slot)/laden(slot)/hatSpielstand()/fortsetzen()/spielstaende()/loescheSpielstand(slot) · zustand() · endeSammlung() · on(ereignis, fn). Uhr/Zufall/Sichtbarkeit ersetzbar: UK.engine.uhr, .zufall, .sichtbar. Details: engine/README.md */
(function () {
  'use strict';
  var G = typeof window !== 'undefined' ? window : globalThis;
  var UK = G.UK = G.UK || {};
  var I = UK._engine || {};
  var T = I.tempo, B = I.bedingung, S = I.speicher, A = I.ablauf;

  var E = UK.engine = UK.engine || {};
  E.version = '1.0';
  E.uhr = E.uhr || T.standardUhr();
  E.zufall = E.zufall || Math.random;
  E.sichtbar = E.sichtbar || function () {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  };

  function Abbruch() { this.abbruch = true; }

  var cfg = { story: null, ui: null, karte: null, medien: null, speicher: null, onZurueck: null };
  var z = null;            // aktueller Zustand
  var lauf = 0;            // Generationszähler: neuer Start/Laden beendet den alten Ablauf
  var wartende = [];       // laufende Wartezeiten (abbrechbar)
  var ueberspringen = false;
  var aktiveWahl = null;   // { nimm(antwort), liste }
  var hoerer = {};
  var bevorzugterModus = 'schnell';
  var ohneFrist = false;    // Zugang: «Entscheidungen ohne Zeitdruck» (Schweigen nur über die stille Antwort)

  // ---------- Hilfen ----------
  function story() { return cfg.story || UK.story || { szenen: {}, merker: {}, meta: {} }; }
  function teil(name) { return cfg[name] || UK[name] || null; }
  function rufe(objName, fn) {
    var o = teil(objName);
    if (!o || typeof o[fn] !== 'function') return undefined;
    try { return o[fn].apply(o, Array.prototype.slice.call(arguments, 2)); }
    catch (e) { melde('fehler', { wo: objName + '.' + fn, fehler: String(e && e.message || e) }); return undefined; }
  }
  // Promise einer anderen Komponente abwarten, aber nie länger als maxMs (echte Zeit; nie hängen)
  function begrenzt(p, maxMs) {
    if (!p || typeof p.then !== 'function') return Promise.resolve(p);
    return new Promise(function (res) {
      var fertig = false;
      var h = setTimeout(function () { if (!fertig) { fertig = true; res(undefined); } }, maxMs);
      p.then(function (w) { if (!fertig) { fertig = true; clearTimeout(h); res(w); } },
             function () { if (!fertig) { fertig = true; clearTimeout(h); res(undefined); } });
    });
  }
  var puffer = null; // Ereignisse während einer Zustandsänderung sammeln (Hörer sehen nie einen halben Zustand)
  function sammleEreignisse() { puffer = []; }
  function gibEreignisseFrei() { var q = puffer || []; puffer = null; q.forEach(function (x) { melde(x[0], x[1]); }); }
  function melde(ereignis, daten) {
    if (puffer) { puffer.push([ereignis, daten]); return; }
    (hoerer[ereignis] || []).slice().forEach(function (fn) { try { fn(daten); } catch (e) { /* Hörer-Fehler nicht weitertragen */ } });
  }
  function modus() { return (z && z.modus) || bevorzugterModus; }
  function sp() { return cfg.speicher === undefined ? null : cfg.speicher; }
  function kontext() { return { antwortId: z ? z.antwortId : null }; }
  // Kontaktname in der Kopfzeile: absender der Szene (z. B. 'Ethan'), sonst meta.kontakt
  function kontakt() { var sz = z && z.szene && story().szenen[z.szene]; return (sz && sz.absender) || (story().meta && story().meta.kontakt) || 'Mike'; }
  function pruefeLauf(t) { if (t !== lauf) throw new Abbruch(); }

  function schlafe(ms, t) {
    if (t !== lauf) return Promise.reject(new Abbruch());
    if (!(ms > 0) || ueberspringen || modus() === 'direkt') return Promise.resolve();
    return new Promise(function (res, rej) {
      var e = { fertig: false };
      e.los = function () {
        if (e.fertig) return;
        e.fertig = true;
        var i = wartende.indexOf(e); if (i >= 0) wartende.splice(i, 1);
        if (t === lauf) res(); else rej(new Abbruch());
      };
      wartende.push(e);
      var w;
      try { w = E.uhr.warte(ms); } catch (x) { w = null; }
      Promise.resolve(w).then(e.los, e.los);
    });
  }
  function brichWartenAb() { wartende.slice().forEach(function (e) { e.los(); }); }

  // Spannung einer Szene (0|1|2) für Mikes Tippverhalten: Datenfeld `spannung`, sonst Regel (Fristen und Akt D = 2, Akt C = 1)
  function spannung(sz) {
    if (!sz) return 0;
    if (typeof sz.spannung === 'number') return sz.spannung;
    if (sz.stilleNach) return 2;
    var id = String(sz.id || z.szene || '');
    return /^d_/.test(id) ? 2 : /^c_/.test(id) ? 1 : 0;
  }
  // Fester Zufall pro Szene (gleicher Durchgang = gleiches Verhalten)
  function festerZufall(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
  }

  function startSpielzeit() {
    var s = story().meta && story().meta.startzeit;
    var m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
    return m ? (+m[1]) * 3600 + (+m[2]) * 60 : 17 * 3600 + 48 * 60;
  }
  function zeit() { return T.uhrzeit(z.spielzeit); }

  function gegenstandsMerker(g) { return g.merker || g.flag || g.id; }
  function gegenstaendeImBesitz() {
    var gs = story().gegenstaende || [];
    return gs.filter(function (g) { return g && z && z.merker[gegenstandsMerker(g)] === true; }).map(function (g) { return g.id; });
  }

  function setzeMerker(obj) {
    if (!obj || typeof obj !== 'object') return;
    var gs = story().gegenstaende || [];
    Object.keys(obj).forEach(function (k) {
      var alt = z.merker[k], neu = obj[k];
      z.merker[k] = neu;
      if (alt !== neu) {
        melde('merker', { name: k, wert: neu, alt: alt });
        gs.forEach(function (g) {
          if (g && gegenstandsMerker(g) === k && neu === true) melde('gegenstand', { id: g.id, name: g.name });
        });
      }
    });
  }

  function ortName(id) {
    var o = (story().orte || []).filter(function (x) { return x && x.id === id; })[0];
    return o ? o.name : id;
  }
  function wechsleOrt(id) {
    if (!id || typeof id !== 'string') return;
    var neu = z.entdeckteOrte.indexOf(id) < 0;
    if (neu) { z.entdeckteOrte.push(id); rufe('karte', 'entdecke', [id]); }
    if (z.ort !== id || neu) {
      z.ort = id;
      rufe('karte', 'setOrt', id);
      rufe('ui', 'setOrt', id);
      var m = 'gesehen_' + id;
      if (story().merker && Object.prototype.hasOwnProperty.call(story().merker, m) && z.merker[m] !== true) {
        var o = {}; o[m] = true; setzeMerker(o);
      }
      melde('ort', { id: id, name: ortName(id) });
    }
  }

  function frischerZustand(m) {
    var st = story();
    var merker = {};
    Object.keys(st.merker || {}).forEach(function (k) { merker[k] = st.merker[k]; });
    return {
      v: S.VERSION, szene: null, phase: 'ablauf', schritt: 0, antwortId: null, nachText: null, nachNachrichten: null,
      modus: T.gueltigerModus(m || bevorzugterModus), merker: merker, ort: null, entdeckteOrte: [],
      besucht: [], verlauf: [], weg: [], stilleRest: null, spielzeit: startSpielzeit(), karte: null, gespeichert: 0
    };
  }

  // ---------- Ausgabe ----------
  async function ausgabe(eintrag, uiDaten, t) {
    z.verlauf.push(eintrag);
    melde('nachricht', eintrag);
    await begrenzt(rufe('ui', 'addNachricht', uiDaten), 8000);
    pruefeLauf(t);
  }

  var letzteMikeText = ''; // nur Tempo (Lesezeit-Mindestabstand), nicht gespeichert
  async function nachricht(von, text, t, ausAblauf, sprecher) {
    var m = modus();
    var vorherText = von === 'ich' ? '' : letzteMikeText;
    letzteMikeText = von === 'ich' ? '' : String(text || '');
    if (von !== 'ich' && von !== 'system') rufe('ui', 'setZeit', zeit());
    if (von !== 'ich' && m !== 'direkt' && !ueberspringen) {
      var teile = T.tippen(text, m, E.zufall, spannung(szene()), vorherText);
      for (var i = 0; i < teile.length && !ueberspringen; i++) {
        rufe('ui', 'setTippt', von, !!teile[i].tippt);
        if (von !== 'system') rufe('ui', 'setKontakt', kontakt(), teile[i].tippt ? 'schreibt' : 'online');
        await schlafe(teile[i].ms, t);
      }
      rufe('ui', 'setTippt', von, false);
      if (von !== 'system') rufe('ui', 'setKontakt', kontakt(), 'online');
    }
    pruefeLauf(t);
    z.spielzeit += von === 'ich' ? 12 : 6 + Math.round(String(text).length * 0.3);
    if (ausAblauf) z.schritt++;
    var e = { von: von, art: 'text', text: text, zeit: zeit() };
    if (sprecher) e.sprecher = sprecher;
    await ausgabe(e, { von: von, text: text, zeit: e.zeit, art: 'text', sprecher: sprecher || undefined, sofort: true, getippt: true }, t);
  }

  function mediumElement(id) {
    var el = rufe('medien', 'render', id);
    rufe('medien', 'markiere', id);
    return el || null;
  }
  function mediumTitel(id) {
    var md = story().medien && story().medien[id];
    return (md && (md.titel || md.title)) || id;
  }

  async function medium(id, von, t) {
    var m = modus();
    if (m !== 'direkt' && !ueberspringen) {
      rufe('ui', 'setTippt', von, true);
      await schlafe(T.medium(m, E.zufall), t);
      rufe('ui', 'setTippt', von, false);
    }
    pruefeLauf(t);
    z.spielzeit += 10;
    z.schritt++;
    var e = { von: von, art: 'medium', id: id, text: mediumTitel(id), zeit: zeit() };
    await ausgabe(e, { von: von, art: 'medium', mediumId: id, mediumEl: mediumElement(id), text: e.text, zeit: e.zeit, sofort: true, getippt: true }, t);
  }

  async function pause(s, t) {
    var erzaehlt = s.sekunden || (s.ms ? s.ms / 1000 : 0);
    var text = s.text || T.zeitText(erzaehlt);
    var ms = ueberspringen ? 0 : T.pause(erzaehlt, modus());
    await abgebrochenesTippen(t);
    rufe('ui', 'setTippt', 'mike', false);
    rufe('ui', 'setKontakt', kontakt(), 'weg');
    z.spielzeit += Math.round(erzaehlt);
    z.schritt++;
    var e = { von: 'system', art: 'pause', text: text, zeit: zeit() };
    z.verlauf.push(e);
    melde('pause', { text: text, sekunden: erzaehlt, ms: ms, grund: s.grund || '' });
    var p = rufe('ui', 'zeigePause', { text: text, sekunden: Math.round(ms / 1000), dauer: ms, erzaehlt: erzaehlt, modus: modus() }); // grund (Autorentext) geht nicht an die UI
    await Promise.all([begrenzt(p, ms + 4000), schlafe(ms, t)]);
    pruefeLauf(t);
    rufe('ui', 'setZeit', zeit());
    rufe('ui', 'setKontakt', kontakt(), 'online');
  }

  // Tippverhalten: Vor einer Pause beginnt Mike manchmal zu tippen, hört auf, und dann kommt nichts (keine neuen Wörter).
  // Höchstens einmal pro Szene, nur bei Spannung, fester Zufall pro Szene. Realismus voll, Schnelldurchlauf nur bei Spannung 2 und kurz.
  async function abgebrochenesTippen(t) {
    var m = modus(), sz = szene(), sp = spannung(sz);
    if (ueberspringen || m === 'direkt' || !sp || z.abbruchIn === z.szene) return;
    if (m === 'schnell' && sp < 2) return;
    var r = festerZufall(z.szene + '|abbruch');
    if (r >= (sp >= 2 ? 0.7 : 0.35)) return;
    z.abbruchIn = z.szene;
    var lang = m === 'realismus';
    rufe('ui', 'setTippt', 'mike', true);
    rufe('ui', 'setKontakt', kontakt(), 'schreibt');
    await schlafe(lang ? 1400 + r * 2000 : 700 + r * 500, t);
    rufe('ui', 'setTippt', 'mike', false);
    rufe('ui', 'setKontakt', kontakt(), 'online');
    await schlafe(lang ? 900 + r * 900 : 450, t);
  }

  async function warten(s, t) {
    var sek = s.sekunden || (s.ms ? s.ms / 1000 : 0);
    var ms = ueberspringen ? 0 : (modus() === 'realismus' ? Math.min(sek, 90) * 1000 : T.pause(Math.min(sek, 30), modus()) / 2);
    rufe('ui', 'setKontakt', kontakt(), 'weg');
    z.spielzeit += Math.round(sek);
    await schlafe(ms, t);
    pruefeLauf(t);
    z.schritt++;
    rufe('ui', 'setKontakt', kontakt(), 'online');
  }

  async function spieleSchritt(s, t) {
    if (!B(s.wenn, z.merker, kontext())) { z.schritt++; return; }
    if (s.art === 'nachricht') return nachricht(s.von || 'mike', s.text, t, true, s.sprecher || null);
    if (s.art === 'medium') return medium(s.id, s.von || 'mike', t);
    if (s.art === 'pause') return pause(s, t);
    if (s.art === 'warten') return warten(s, t);
    if (s.art === 'ort') { z.schritt++; wechsleOrt(s.ort); return; }
    z.schritt++;
  }

  // ---------- Szenen ----------
  function szene() { return story().szenen[z.szene]; }

  function betrete(id, eintritt) {
    var sz = story().szenen[id];
    z.szene = id;
    z.phase = 'ablauf';
    z.schritt = 0;
    z.antwortId = eintritt.antwortId || null;
    z.nachText = eintritt.nachText || null;
    z.nachNachrichten = eintritt.nachNachrichten || null;
    z.stilleRest = null;
    z.besucht.push(id);
    setzeMerker(sz.beimEintritt);
    if (sz.bedingung && !B(sz.bedingung, z.merker, kontext())) melde('warnung', { art: 'bedingung', szene: id });
    wechsleOrt(sz.ortStart || sz.eroeffnungsOrt || sz.ort);
    rufe('ui', 'setKontakt', kontakt(), 'online');
    if (sz.ende && endeOhneKontakt(sz)) { rufe('ui', 'setKontakt', kontakt(), 'weg'); rufe('ui', 'friereStatus', true); }
    melde('szene', { id: id, titel: sz.titel, ort: z.ort });
  }

  // Ende, in dem vom Kontakt nichts mehr kommt (Ende 5): letzte Nachricht bleibt «Zugestellt», Kopfzeile «zuletzt online»
  function endeOhneKontakt(sz) {
    var l = A(sz, {});
    return !l.some(function (s) { return (s.art === 'nachricht' || s.art === 'medium') && s.von !== 'system' && s.von !== 'ich'; });
  }

  async function spieleAb(t) {
    var liste = A(szene(), { antwortId: z.antwortId, nachText: z.nachText, nachNachrichten: z.nachNachrichten });
    while (z.schritt < liste.length) {
      await spieleSchritt(liste[z.schritt], t);
      pruefeLauf(t);
    }
  }

  function sichtbareAntworten() {
    var alle = (szene().antworten || []).filter(function (a) { return a && typeof a === 'object'; });
    var sicht = alle.filter(function (a) { return B(a.wenn, z.merker, kontext()); });
    if (!sicht.length && alle.length) { melde('warnung', { art: 'keineAntworten', szene: z.szene }); sicht = alle.slice(); }
    return sicht;
  }

  function waehle(liste, t) {
    return new Promise(function (resolve) {
      var fertig = false, versuche = 0;
      var still = stilleAntwort(liste);
      function nimm(a) {
        if (fertig) return;
        fertig = true;
        aktiveWahl = null;
        resolve(a);
      }
      aktiveWahl = { nimm: nimm, liste: liste };
      function zeige() {
        var p = rufe('ui', 'zeigeAntworten',
          liste.map(function (a) { return { id: a.id, text: a.text, still: !!a.still }; }),
          { stilleSekunden: z.stilleRest ? Math.ceil(z.stilleRest) : undefined, frist: !!z.stilleRest, hinweis: szene().stilleHinweis || null });
        if (!p || typeof p.then !== 'function') return; // Oberfläche meldet sich über UK.engine.waehle(id)
        p.then(function (r) {
          if (fertig || t !== lauf) return;
          if (r && r.id !== undefined) {
            var a = liste.filter(function (x) { return x.id === r.id; })[0];
            if (a) return nimm(a);
          } else if (still) return nimm(still);
          if (++versuche < 5) zeige(); else { melde('fehler', { art: 'ungueltigeWahl', szene: z.szene }); nimm(still || liste[0]); }
        }, function () { if (!fertig && t === lauf && ++versuche < 5) zeige(); });
      }
      zeige();
      if (z.stilleRest > 0 && still) frist(t, function () { return fertig; }, function () { rufe('ui', 'versteckeAntworten'); rufe('ui', 'setKontakt', kontakt(), 'weg'); nimm(still); });
    });
  }

  // Stille-Frist: zählt nur bei sichtbarem Tab, Rest steht im Zustand (wird mitgespeichert)
  async function frist(t, istFertig, abgelaufen) {
    var letzte = E.uhr.jetzt(), seitSpeichern = 0;
    while (!istFertig() && t === lauf && z.stilleRest > 0) {
      try { await E.uhr.warte(250); } catch (e) { /* weiter */ }
      if (istFertig() || t !== lauf) return;
      var jetzt = E.uhr.jetzt();
      var d = Math.min(1000, Math.max(0, jetzt - letzte));
      letzte = jetzt;
      var sichtbar = true;
      try { sichtbar = E.sichtbar(); } catch (e) { sichtbar = true; }
      if (sichtbar) {
        z.stilleRest = Math.max(0, z.stilleRest - d / 1000);
        seitSpeichern += d;
        if (seitSpeichern >= 5000) { seitSpeichern = 0; autoSpeichern(); }
      }
    }
    if (!istFertig() && t === lauf && z.stilleRest !== null && z.stilleRest <= 0) abgelaufen(); // null = Frist aufgehoben (ohne Zeitdruck)
  }

  // Antwort, die bei Schweigen/Fristablauf gilt: stilleAntwort der Szene, sonst die erste stille Antwort
  function stilleAntwort(liste) {
    var sz = szene(), id = sz && sz.stilleAntwort;
    var a = id ? liste.filter(function (x) { return x.id === id; })[0] : null;
    return a || liste.filter(function (x) { return x.still; })[0] || null;
  }

  async function entscheidung(t) {
    var sz = szene();
    z.phase = 'wahl';
    ueberspringen = false;
    var liste = sichtbareAntworten();
    if (!liste.length) { melde('fehler', { art: 'sackgasse', szene: z.szene }); return null; }
    var hatStill = !!stilleAntwort(liste);
    if (sz.stilleNach && hatStill && !ohneFrist) {
      if (z.stilleRest === null || z.stilleRest === undefined) z.stilleRest = T.stille(sz.stilleNach, modus());
    } else z.stilleRest = null;
    autoSpeichern();
    melde('entscheidung', { szene: z.szene, antworten: liste.map(function (a) { return a.id; }), stille: z.stilleRest });
    var a = await waehle(liste, t);
    pruefeLauf(t);
    return a;
  }

  // Antwort anwenden. Zustandsänderungen geschehen synchron (Spielstand ist nie halb), danach erst Anzeige und Wartezeit.
  async function antworte(a, t) {
    z.stilleRest = null;
    var p = null;
    sammleEreignisse();
    if (!a.still && a.text) {
      z.spielzeit += 12;
      var e = { von: 'ich', art: 'text', text: a.text, zeit: zeit() };
      z.verlauf.push(e);
      melde('nachricht', e);
      p = rufe('ui', 'addNachricht', { von: 'ich', text: a.text, zeit: e.zeit, art: 'text', sofort: true, getippt: true });
    }
    setzeMerker(a.setze);
    z.weg.push({ szene: z.szene, id: a.id, text: (!a.still && a.text) ? a.text : null });
    melde('antwort', { id: a.id, still: !!a.still, szene: z.szene });
    var ziel = a.nach;
    if (!ziel || !story().szenen[ziel]) { melde('fehler', { art: 'zielFehlt', antwort: a.id, nach: ziel }); gibEreignisseFrei(); return false; }
    betrete(ziel, { antwortId: a.antwortId || null, nachText: a.nachText || null, nachNachrichten: Array.isArray(a.nachNachrichten) ? a.nachNachrichten : null });
    gibEreignisseFrei();
    if (a.still && !story().szenen[ziel].ende) rufe('ui', 'setKontakt', kontakt(), 'weg'); // Schweigen: Mike ist «zuletzt online», bis er wieder tippt
    await begrenzt(p, 8000);
    pruefeLauf(t);
    await schlafe(T.nachSpieler(modus(), E.zufall), t);
    pruefeLauf(t);
    return true;
  }

  // Endbildschirm nach daten/SCHEMA.md §6: einleitung = sichtbare Absätze, nachwort = sichtbare kleine Absätze, schlussbild = album
  function endeDaten(sz) {
    var e = (sz.ende && typeof sz.ende === 'object') ? sz.ende : {};
    var ctx = kontext();
    var absaetze = (Array.isArray(e.absaetze) ? e.absaetze : [])
      .filter(function (x) { return x && typeof x.text === 'string' && B(x.wenn, z.merker, ctx); })
      .map(function (x) { return { text: x.text, klein: !!x.klein }; });
    var gross = absaetze.filter(function (x) { return !x.klein; }).map(function (x) { return x.text; });
    var klein = absaetze.filter(function (x) { return x.klein; }).map(function (x) { return x.text; });
    return {
      id: e.id || sz.id || z.szene,
      nummer: e.nummer || null,
      kopf: e.kopf || '',
      titel: e.titel || sz.titel || '',
      absaetze: absaetze,
      album: e.album || null,
      einleitung: absaetze.length ? gross.join('\n\n') : (e.einleitung || ''),
      nachwort: absaetze.length ? klein.join('\n\n') : (e.nachwort || ''),
      schlussbild: e.album || e.schlussbild || null,
      absender: e.absender || sz.absender || null,
      autorEinleitung: e.einleitung || '', autorNachwort: e.nachwort || '' // Autorenbeschreibung, nicht anzeigen
    };
  }
  function anzahlEnden() {
    var sz = story().szenen || {};
    return Object.keys(sz).filter(function (k) { return sz[k] && sz[k].ende; }).length || 5;
  }
  function endeSammlung() {
    var ids = S.lies(sp(), 'enden');
    ids = Array.isArray(ids) ? ids.filter(function (x) { return typeof x === 'string'; }) : [];
    var gesamt = anzahlEnden();
    return { ids: ids, erreicht: ids.length, gesamt: gesamt, text: ids.length + ' von ' + gesamt + ' Enden' };
  }

  async function zeigeEnde(t) {
    var sz = szene();
    z.phase = 'ende';
    var d = endeDaten(sz);
    var sam = endeSammlung();
    if (sam.ids.indexOf(d.id) < 0) { sam.ids.push(d.id); S.schreibe(sp(), 'enden', sam.ids); }
    sam = endeSammlung();
    S.loesche(sp(), 'auto'); // ein beendetes Spiel wird nicht «fortgesetzt»
    rufe('ui', 'setTippt', 'mike', false);
    melde('ende', { id: d.id, titel: d.titel, sammlung: sam, szene: z.szene });
    var m = z.modus;
    rufe('ui', 'zeigeEnde', {
      id: d.id, nummer: d.nummer, kopf: d.kopf, titel: d.titel, absaetze: d.absaetze, album: d.album,
      einleitung: d.einleitung, nachwort: d.nachwort, schlussbild: d.schlussbild, absender: d.absender,
      autorEinleitung: d.autorEinleitung, autorNachwort: d.autorNachwort,
      merker: Object.assign({}, z.merker),
      sammlung: sam,
      onNochmal: function () { E.start(m); },
      onZurueck: function () { melde('zurueck', {}); if (typeof cfg.onZurueck === 'function') { try { cfg.onZurueck(); } catch (e) { /* egal */ } } }
    });
  }

  // Hauptschleife: spielt ab dem aktuellen Zustand weiter
  async function treibe(t) {
    var fehler = 0;
    for (;;) {
      try {
        if (t !== lauf) return;
        if (z.phase === 'ablauf') {
          await spieleAb(t);
          z.phase = szene().ende ? 'ende' : 'wahl';
        } else if (z.phase === 'wahl') {
          var a = await entscheidung(t);
          if (!a) return;
          if (!(await antworte(a, t))) return;
        } else {
          await zeigeEnde(t);
          return;
        }
      } catch (e) {
        if (e && e.abbruch) return;
        melde('fehler', { art: 'ausnahme', szene: z && z.szene, fehler: String(e && e.message || e) });
        if (++fehler > 20 || !z || z.phase !== 'ablauf') return;
        z.schritt++; // fehlerhaften Schritt überspringen, nie hängen bleiben
      }
    }
  }

  function neuerLauf() {
    puffer = null;
    lauf++;
    ueberspringen = false;
    aktiveWahl = null;
    brichWartenAb();
    return lauf;
  }

  // ---------- Speichern ----------
  function schnappschuss() {
    var s = JSON.parse(JSON.stringify(E.zustand()));
    s.v = S.VERSION;
    s.gespeichert = Date.now();
    var k = rufe('karte', 'zustand');
    if (k !== undefined) { try { s.karte = JSON.parse(JSON.stringify(k)); } catch (e) { s.karte = null; } }
    return s;
  }
  function slotName(slot) { return (slot === undefined || slot === null || slot === 'auto') ? 'auto' : 'slot_' + String(slot); }
  function autoSpeichern() {
    if (!z || !z.szene || z.phase === 'ende') return false;
    var ok = S.schreibe(sp(), 'auto', schnappschuss());
    if (ok) melde('gespeichert', { slot: 'auto' });
    return ok;
  }

  async function wiederaufbau(t) {
    rufe('ui', 'leere');
    rufe('karte', 'reset');
    var kartenOk = false;
    if (z.karte !== null && z.karte !== undefined && teil('karte') && typeof teil('karte').laden === 'function') {
      try { teil('karte').laden(z.karte); kartenOk = true; } catch (e) { kartenOk = false; }
    }
    z.karte = null;
    if (!kartenOk && z.entdeckteOrte.length) rufe('karte', 'entdecke', z.entdeckteOrte.slice());
    if (z.ort) { rufe('karte', 'setOrt', z.ort); rufe('ui', 'setOrt', z.ort); }
    rufe('ui', 'setKontakt', kontakt(), 'online');
    var warte = [];
    z.verlauf.forEach(function (e) {
      var d = { von: e.von, text: e.text, zeit: e.zeit, art: e.art === 'medium' ? 'medium' : 'text', sofort: true, aufbau: true };
      if (e.art === 'pause') d.pause = true;
      if (e.sprecher) d.sprecher = e.sprecher;
      if (e.art === 'medium') { d.mediumId = e.id; d.mediumEl = mediumElement(e.id); }
      warte.push(begrenzt(rufe('ui', 'addNachricht', d), 4000));
    });
    await Promise.all(warte);
    pruefeLauf(t);
    melde('szene', { id: z.szene, titel: szene().titel, ort: z.ort, geladen: true });
    if (z.ort) melde('ort', { id: z.ort, name: ortName(z.ort), geladen: true });
  }

  // ---------- Öffentliche Schnittstelle ----------
  E.init = function (o) {
    o = o || {};
    cfg.story = o.story || UK.story || null;
    cfg.ui = o.ui || null; cfg.karte = o.karte || null; cfg.medien = o.medien || null;
    if (o.speicher !== undefined) cfg.speicher = o.speicher;
    else { try { cfg.speicher = G.localStorage || null; } catch (e) { cfg.speicher = null; } }
    cfg.onZurueck = o.onZurueck || null;
    if (o.uhr) E.uhr = o.uhr;
    if (o.zufall) E.zufall = o.zufall;
    if (o.sichtbar) E.sichtbar = o.sichtbar;
    if (!E._hoertSichtbarkeit && typeof document !== 'undefined' && document.addEventListener) {
      E._hoertSichtbarkeit = true;
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') autoSpeichern(); });
      G.addEventListener && G.addEventListener('pagehide', function () { autoSpeichern(); });
    }
    return E;
  };

  E.start = function (m) {
    var t = neuerLauf();
    bevorzugterModus = T.gueltigerModus(m || bevorzugterModus);
    z = frischerZustand(bevorzugterModus);
    rufe('ui', 'leere');
    rufe('karte', 'reset');
    rufe('ui', 'setKontakt', kontakt(), 'online');
    var st = story();
    var startId = (st.meta && st.meta.start) || Object.keys(st.szenen || {})[0];
    if (!startId || !st.szenen[startId]) { melde('fehler', { art: 'startFehlt' }); return Promise.resolve(); }
    sammleEreignisse();
    betrete(startId, {});
    gibEreignisseFrei();
    return treibe(t);
  };

  E.setModus = function (m) {
    m = T.gueltigerModus(m);
    bevorzugterModus = m;
    if (z) z.modus = m;
    brichWartenAb(); // laufende Wartezeit endet, ab der nächsten Nachricht gilt das neue Tempo
    melde('modus', { modus: m });
  };
  E.modus = function () { return modus(); };

  // Zugang: Entscheidungen ohne Zeitdruck. Wirkt ab der nächsten Entscheidung; eine laufende Frist endet sofort ohne Folgen.
  E.setOhneFrist = function (an) {
    ohneFrist = !!an;
    if (ohneFrist && z && z.stilleRest !== null) z.stilleRest = null;
  };
  E.ohneFrist = function () { return ohneFrist; };

  E.ueberspringeBisEntscheidung = function () {
    if (!z || z.phase !== 'ablauf') return;
    ueberspringen = true;
    brichWartenAb();
    rufe('ui', 'setTippt', 'mike', false);
  };

  // Antwort von aussen wählen (z. B. wenn ui.zeigeAntworten kein Promise liefert). id=null: schweigen.
  E.waehle = function (id) {
    if (!aktiveWahl) return false;
    var l = aktiveWahl.liste;
    var a = id === null ? stilleAntwort(l) : l.filter(function (x) { return x.id === id; })[0];
    if (!a) return false;
    aktiveWahl.nimm(a);
    return true;
  };

  E.speichern = function (slot) {
    if (!z || !z.szene) return false;
    var n = slotName(slot);
    if (n === 'auto') return autoSpeichern();
    var ok = S.schreibe(sp(), n, schnappschuss());
    if (ok) melde('gespeichert', { slot: slot });
    return ok;
  };

  E.laden = function (slot) {
    var roh = S.lies(sp(), slotName(slot));
    var neu = S.pruefe(roh, story());
    if (!neu) return false;
    var t = neuerLauf();
    z = neu;
    if (z.spielzeit === null) z.spielzeit = startSpielzeit();
    if (ohneFrist) z.stilleRest = null;
    bevorzugterModus = z.modus;
    wiederaufbau(t).then(function () { return treibe(t); }, function (e) { if (!(e && e.abbruch)) melde('fehler', { art: 'laden', fehler: String(e) }); });
    return true;
  };

  E.hatSpielstand = function () { return !!S.pruefe(S.lies(sp(), 'auto'), story()); };
  E.fortsetzen = function () { return E.laden('auto'); };
  E.loescheSpielstand = function (slot) { S.loesche(sp(), slotName(slot)); };

  // Übersicht für das Menü: [{slot, szene, titel, ort, gespeichert}]
  E.spielstaende = function (slots) {
    slots = slots || ['auto', 1, 2, 3];
    return slots.map(function (s) {
      var g = S.pruefe(S.lies(sp(), slotName(s)), story());
      if (!g) return { slot: s, leer: true };
      var sz = story().szenen[g.szene];
      return { slot: s, leer: false, szene: g.szene, titel: sz.titel || g.szene, ort: g.ort, ortName: g.ort ? ortName(g.ort) : '', gespeichert: g.gespeichert, modus: g.modus };
    });
  };

  E.zustand = function () {
    if (!z) return null;
    return {
      v: S.VERSION, szene: z.szene, phase: z.phase, schritt: z.schritt, antwortId: z.antwortId, nachText: z.nachText,
      nachNachrichten: z.nachNachrichten ? JSON.parse(JSON.stringify(z.nachNachrichten)) : null,
      ort: z.ort, merker: Object.assign({}, z.merker), gegenstaende: gegenstaendeImBesitz(),
      entdeckteOrte: z.entdeckteOrte.slice(), besucht: z.besucht.slice(), modus: z.modus,
      verlauf: z.verlauf.map(function (e) { return Object.assign({}, e); }),
      weg: (z.weg || []).map(function (e) { return Object.assign({}, e); }),
      stilleRest: z.stilleRest, spielzeit: z.spielzeit, karte: z.karte
    };
  };

  E.endeSammlung = endeSammlung;

  E.on = function (ereignis, fn) {
    if (typeof fn !== 'function') return function () {};
    (hoerer[ereignis] = hoerer[ereignis] || []).push(fn);
    return function () { var l = hoerer[ereignis] || []; var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
  };

  // Laufenden Ablauf anhalten (z. B. zurück zum Titel), Spielstand bleibt
  E.stoppe = function () { autoSpeichern(); neuerLauf(); };
})();
