// medien.js: UK.medien.render(id) -> HTMLElement | vorhanden(id) -> {bild,ton} | pruefe(id) -> Promise<{bild,ton}> | gesehen() | markiere(id) | stoppeAlles() | konfig({assets, vollansichtIn}) | quelle(id, {bild, ton})
// Fotos: ruhige Platzhalter-Karte, bis medien/assets/<id>.jpg|.png|.webp existiert. Memos: Player; ohne medien/assets/<id>.mp3|.m4a|.ogg stille Textwiedergabe. Nichts spielt automatisch.
(function () {
  'use strict';
  var UK = window.UK = window.UK || {};

  // ---------- Pfade und Grundeinstellungen ----------
  var skript = document.currentScript;
  var basis = skript && skript.src ? skript.src.replace(/[^\/]*$/, '') : 'medien/';
  var einst = { assets: basis + 'assets/', vollansichtIn: null };
  var BILD_ENDUNGEN = ['jpg', 'png', 'webp'];
  var TON_ENDUNGEN = ['mp3', 'm4a', 'ogg'];
  var vorgaben = {};      // id -> { bild:url, ton:url } (Tests, Sonderfälle)
  var bildStatus = {};    // id -> { zustand:'prueft'|'ja'|'nein', url, warte:[fn] }
  var tonStatus = {};     // id -> { zustand:'prueft'|'unbekannt'|'ja'|'nein', url, dauer, warte:[fn] }

  // Stylesheet selbst einbinden
  (function () {
    if (document.querySelector('link[data-ukm]')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = basis + 'medien.css'; l.setAttribute('data-ukm', '');
    (document.head || document.documentElement).appendChild(l);
  })();

  // ---------- Daten ----------
  var listeLaden = null;
  function ladeListe() {
    if (listeLaden) return listeLaden;
    listeLaden = new Promise(function (ok) {
      if (UK.medienDaten) return ok(true);
      var s = document.createElement('script');
      s.src = basis + 'medienliste.js';
      s.onload = function () { ok(!!UK.medienDaten); };
      s.onerror = function () { ok(false); };
      (document.head || document.documentElement).appendChild(s);
    });
    return listeLaden;
  }
  if (!(UK.story && UK.story.medien)) ladeListe();

  function roh(id) {
    var s = UK.story && UK.story.medien, m = null;
    if (s) {
      if (Array.isArray(s)) { for (var i = 0; i < s.length; i++) if (s[i] && s[i].id === id) m = s[i]; }
      else m = s[id];
    }
    if (!m && UK.medienDaten) m = UK.medienDaten[id];
    return m || null;
  }
  function norm(m, id) {
    var art = m.art || (m.kind === 'audio' ? 'memo' : m.kind === 'image' ? 'foto' : null);
    if (art === 'audio' || art === 'ton') art = 'memo';
    if (art === 'bild' || art === 'image') art = 'foto';
    var besch = m.beschreibung || m.description || '';
    var det = (m.details || m.inspect || []).map(function (d) { return { label: d.label || '', text: d.text || '' }; });
    var d = { id: m.id || id, art: art || 'foto', titel: m.titel || m.title || '', beschreibung: besch, details: det, szene: m.szene || m.scene || null };
    if (d.art === 'memo') { d.memoText = m.memoText || besch; d.dauer = +m.dauer || dauerAusText(d.titel + ' ' + d.memoText); }
    return d;
  }
  function definition(id) { var m = roh(id); return m ? norm(m, id) : null; }

  // ---------- Hilfen ----------
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // Wörtliche Rede („…“) hervorheben, sonst unverändert
  function mitRede(s) { return esc(s).replace(/„[^“]*“/g, function (r) { return '<span class="ukm-rede">' + r + '</span>'; }); }
  function zeit(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function dauerAusText(t) {
    var r = t.match(/(?:Dauer|Länge|Hörfassung,)\s*(\d+)\s*Sekunden/);
    if (r) return +r[1];
    var max = 0; t.replace(/(\d+)\s*(?:Sekunden|s)\b/g, function (_, n) { max = Math.max(max, +n); });
    return max || Math.max(8, Math.round(t.length / 14));
  }
  var stilBewegung = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  function ruhig() { return !!(stilBewegung && stilBewegung.matches); }

  // ---------- Gesehen (für spätere Sammlung) ----------
  var SPEICHER = 'uk.medien.gesehen';
  var gesehenListe = (function () { try { var v = JSON.parse(localStorage.getItem(SPEICHER) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } })();
  function markiere(id) {
    if (!id || gesehenListe.indexOf(id) >= 0) return;
    gesehenListe.push(id);
    try { localStorage.setItem(SPEICHER, JSON.stringify(gesehenListe)); } catch (e) { /* ohne Speicher */ }
  }

  // ---------- Dateien prüfen (per Laden, kein fetch) ----------
  // Dateiliste assets/dateien.js (von tools/erzeuge.js geschrieben): wenn vorhanden, massgebend -> keine 404-Anfragen.
  // Fehlt sie, wird jede Endung per Laden geprüft.
  var dateienBereit = new Promise(function (ok) {
    if (UK.medienDateien) return ok();
    var s = document.createElement('script');
    s.src = basis + 'assets/dateien.js';
    s.onload = s.onerror = function () { ok(); };
    (document.head || document.documentElement).appendChild(s);
  });
  function kandidaten(id, art) {
    if (vorgaben[id] && !(art in vorgaben[id]) && art === 'bildM') return [];
    var v = vorgaben[id] && vorgaben[id][art];
    if (v) return [v];
    if (v === null) return [];
    var liste = UK.medienDateien;
    if (liste && typeof liste === 'object') {
      var f = liste[id] && liste[id][art];
      return f ? [einst.assets + encodeURIComponent(f)] : [];
    }
    if (art === 'bildM') return [];
    return (art === 'bild' ? BILD_ENDUNGEN : TON_ENDUNGEN).map(function (e) { return einst.assets + encodeURIComponent(id) + '.' + e; });
  }
  function pruefeBild(id, fertig) {
    var st = bildStatus[id];
    if (st && st.zustand !== 'prueft') return fertig(st);
    if (st) return st.warte.push(fertig);
    st = bildStatus[id] = { zustand: 'prueft', url: null, warte: [fertig] };
    var liste, i = 0;
    // Im Chat die mittlere Fassung (bildM, 960 px), in der Vollansicht das Original (bild); fehlt bildM, gilt bild.
    dateienBereit.then(function () {
      var gross = kandidaten(id, 'bild');
      liste = kandidaten(id, 'bildM').concat(gross);
      st.voll = gross[0] || null;
      // Steht das Bild in assets/dateien.js, ist keine Probe nötig (eine Anfrage weniger)
      if (!vorgaben[id] && UK.medienDateien && typeof UK.medienDateien === 'object') return ende(liste.length ? 'ja' : 'nein', liste[0] || null);
      weiter();
    });
    function weiter() {
      if (i >= liste.length) return ende('nein', null);
      var url = liste[i++], img = new Image();
      img.onload = function () { ende('ja', url); };
      img.onerror = weiter;
      img.src = url;
    }
    function ende(z, url) { st.zustand = z; st.url = url; if (!st.voll || z !== 'ja') st.voll = url; var w = st.warte; st.warte = []; w.forEach(function (f) { f(st); }); }
  }
  function pruefeTon(id, fertig) {
    var st = tonStatus[id];
    if (st && st.zustand !== 'prueft') return fertig(st);
    if (st) return st.warte.push(fertig);
    st = tonStatus[id] = { zustand: 'prueft', url: null, dauer: 0, warte: [fertig] };
    var liste, i = 0, a = null, uhr = null;
    dateienBereit.then(function () {
      liste = kandidaten(id, 'ton');
      // Steht die Datei in assets/dateien.js, gilt sie als vorhanden: nichts vorab laden (keine abgebrochenen
      // Ladevorgänge beim Neuaufbau des Chats). Geladen wird erst beim Tippen auf Abspielen; die echte Dauer kommt dann.
      if (!vorgaben[id] && UK.medienDateien && typeof UK.medienDateien === 'object') return ende(liste.length ? 'ja' : 'nein', liste[0] || null);
      weiter();
    });
    function weiter() {
      if (st.zustand !== 'prueft') return;
      if (i >= liste.length) return ende('nein', null);
      var url = liste[i++];
      a = document.createElement('audio');
      a.preload = 'metadata'; a.muted = true;
      a.onloadedmetadata = function () { st.dauer = isFinite(a.duration) ? a.duration : 0; ende('ja', url); };
      a.onerror = weiter;
      a.src = url;
    }
    // iPhone lädt ohne Tippen oft nichts: dann bleibt es «unbekannt» und wird beim Abspielen versucht
    uhr = setTimeout(function () { if (st.zustand === 'prueft') ende('unbekannt', null); }, 3500);
    function ende(z, url) {
      if (st.zustand !== 'prueft') return;
      clearTimeout(uhr);
      if (a) { a.onloadedmetadata = a.onerror = null; a.removeAttribute('src'); try { a.load(); } catch (e) { /* egal */ } a = null; }
      st.zustand = z; st.url = url; var w = st.warte; st.warte = []; w.forEach(function (f) { f(st); });
    }
  }

  // ---------- Vollansicht ----------
  var offen = null;
  function details(liste, offenerText) {
    var box = el('div', 'ukm-details');
    liste.forEach(function (d) {
      var de = el('details', 'ukm-detail');
      var su = el('summary', 'ukm-detail-kopf');
      su.appendChild(el('span', 'ukm-detail-label', d.label));
      su.appendChild(el('span', 'ukm-zeichen'));
      de.appendChild(su);
      var p = el('p', 'ukm-detail-text'); p.innerHTML = mitRede(d.text);
      de.appendChild(p);
      if (offenerText && d.label === offenerText) de.open = true;
      box.appendChild(de);
    });
    return box;
  }
  var SVG_ZU = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12"/></svg>';
  // masse: [Breite, Höhe] des Vorschaubilds, damit die Vollansicht ihren Platz sofort hält (kein Springen beim Laden)
  function oeffneVollansicht(d, url, ausloeser, masse) {
    schliesseVollansicht();
    var huelle = el('div', 'ukm-voll');
    huelle.setAttribute('role', 'dialog'); huelle.setAttribute('aria-modal', 'true'); huelle.setAttribute('aria-label', d.titel);
    var innen = el('div', 'ukm-voll-innen');
    var kopf = el('div', 'ukm-voll-kopf');
    kopf.appendChild(el('span', 'ukm-voll-titel', d.titel));
    var zu = el('button', 'ukm-zu'); zu.type = 'button';
    zu.innerHTML = SVG_ZU; zu.setAttribute('aria-label', 'Schliessen'); zu.title = 'Schliessen (Esc)';
    kopf.appendChild(zu);
    innen.appendChild(kopf);
    if (url) {
      var rahmen = el('div', 'ukm-voll-bildrahmen');
      var img = el('img', 'ukm-voll-bild'); img.alt = d.titel; img.decoding = 'async';
      if (masse && masse[0] && masse[1]) { img.width = masse[0]; img.height = masse[1]; }
      img.onload = function () { img.classList.add('ukm-da'); };
      img.src = url;
      if (img.complete && img.naturalWidth) img.classList.add('ukm-da');
      rahmen.appendChild(img);
      innen.appendChild(rahmen);
      innen.appendChild(details([{ label: 'Bildbeschreibung', text: d.beschreibung }].concat(d.details)));
    } else {
      innen.classList.add('ukm-voll-schmal');
      var t = el('p', 'ukm-voll-text'); t.textContent = d.beschreibung;
      innen.appendChild(t);
      innen.appendChild(details(d.details));
    }
    huelle.appendChild(innen);
    (einst.vollansichtIn || document.body).appendChild(huelle);
    if (einst.vollansichtIn) huelle.classList.add('ukm-voll-eingebettet');
    void huelle.offsetWidth; // Layout erzwingen, damit das Einblenden greift
    huelle.classList.add('ukm-auf');
    huelle.addEventListener('click', function (e) {
      if (e.target === huelle || e.target === innen || (e.target.classList && e.target.classList.contains('ukm-voll-bildrahmen'))) schliesseVollansicht();
    });
    zu.addEventListener('click', schliesseVollansicht);
    offen = { el: huelle, zurueck: ausloeser };
    zu.focus({ preventScroll: true });
  }
  function schliesseVollansicht() {
    if (!offen) return;
    var o = offen; offen = null;
    o.el.classList.remove('ukm-auf');
    setTimeout(function () { if (o.el.parentNode) o.el.parentNode.removeChild(o.el); }, ruhig() ? 0 : 260);
    if (o.zurueck && o.zurueck.focus) o.zurueck.focus({ preventScroll: true });
  }
  // Auf window in der Einfangphase: kommt vor den Tasten der Oberfläche (document, Einfang). Solange die Vollansicht offen ist,
  // gehören ihr alle Tasten: Esc schliesst nur sie (nicht auch das Profil-Blatt darunter), Ziffern wählen keine Antwort im Hintergrund.
  window.addEventListener('keydown', function (e) {
    if (!offen) return;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); schliesseVollansicht(); return; }
    var f = offen.el.querySelectorAll('button, summary');
    if (e.key === 'Tab') { // Fokus in der Vollansicht halten
      if (!f.length) return;
      var a = f[0], z = f[f.length - 1], drin = offen.el.contains(document.activeElement);
      if (!drin) { e.preventDefault(); a.focus(); }
      else if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  }, true);

  // ---------- Foto ----------
  function renderFoto(d) {
    var fig = el('figure', 'ukm ukm-foto ukm-prueft');
    fig.setAttribute('data-medium', d.id);
    var rahmen = el('button', 'ukm-rahmen'); rahmen.type = 'button';
    rahmen.setAttribute('aria-label', d.titel + ', ganz ansehen');
    var flaeche = el('div', 'ukm-flaeche');
    flaeche.appendChild(el('span', 'ukm-ecken ukm-ecken-o'));
    flaeche.appendChild(el('span', 'ukm-ecken ukm-ecken-u'));
    var besch = el('p', 'ukm-beschrieb'); besch.textContent = d.beschreibung;
    flaeche.appendChild(besch);
    rahmen.appendChild(flaeche);
    fig.appendChild(rahmen);
    var cap = el('figcaption', 'ukm-unterschrift');
    cap.appendChild(el('span', 'ukm-titel', d.titel));
    var mehr = el('span', 'ukm-hinweis', 'Ganz lesen'); mehr.setAttribute('aria-hidden', 'true');
    cap.appendChild(mehr);
    fig.appendChild(cap);
    var det = details(d.details);
    fig.appendChild(det);

    var bildUrl = null;
    var vorschau = null;
    rahmen.addEventListener('click', function () {
      oeffneVollansicht(d, bildUrl, rahmen, vorschau && vorschau.naturalWidth ? [vorschau.naturalWidth, vorschau.naturalHeight] : null);
    });

    var notfall = setTimeout(function () { fig.classList.remove('ukm-prueft'); }, 1500);
    pruefeBild(d.id, function (st) {
      clearTimeout(notfall);
      if (st.zustand !== 'ja') { fig.classList.remove('ukm-prueft'); return; }
      bildUrl = st.voll || st.url;
      var img = vorschau = el('img', 'ukm-bild'); img.alt = d.titel; img.decoding = 'async';
      img.onload = function () { fig.classList.remove('ukm-prueft'); img.classList.add('ukm-da'); };
      var alteDetails = det;
      img.onerror = function () { // Liste sagt «da», Datei fehlt doch: still zurück zur Platzhalter-Karte
        if (st.url !== bildUrl && img.src.indexOf(bildUrl) < 0) { img.src = bildUrl; return; }
        fig.classList.remove('ukm-prueft', 'ukm-hat-bild'); bildUrl = null; vorschau = null;
        if (img.parentNode) img.parentNode.removeChild(img);
        rahmen.setAttribute('aria-label', d.titel + ', ganz ansehen'); mehr.textContent = 'Ganz lesen';
        fig.replaceChild(alteDetails, det); det = alteDetails;
      };
      img.src = st.url;
      fig.classList.add('ukm-hat-bild');
      rahmen.setAttribute('aria-label', d.titel + ', vergrössern');
      mehr.textContent = '';
      rahmen.appendChild(img);
      // Beschreibung wandert in die aufklappbaren Details
      var neu = details([{ label: 'Bildbeschreibung', text: d.beschreibung }].concat(d.details));
      fig.replaceChild(neu, det); det = neu;
    });
    return fig;
  }

  // ---------- Memo: Text in Abschnitte teilen ----------
  // Sätze trennen, aber nie innerhalb wörtlicher Rede „…“
  function saetze(s) {
    var aus = [], puffer = '', rede = false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i), n = s.charAt(i + 1);
      puffer += c;
      if (c === '„') rede = true;
      if (c === '“') rede = false;
      var schluss = /[.!?]/.test(c) || (c === '“' && /[.!?]/.test(s.charAt(i - 1)));
      if (!rede && schluss && (n === '' || n === ' ')) { aus.push(puffer.trim()); puffer = ''; }
    }
    if (puffer.trim()) aus.push(puffer.trim());
    return aus;
  }
  function abschnitte(text, dauer) {
    var t = String(text || '').trim();
    var marke = /(\d+)(?:\s*(?:–|-|und)\s*(\d+))?\s*(?:Sekunden|s):\s*/g, m, treffer = [];
    while ((m = marke.exec(t))) treffer.push({ ab: +m[1], von: m.index, bis: marke.lastIndex });
    var teile = [];
    if (treffer.length >= 2) {
      treffer.forEach(function (tr, i) {
        var ende = i + 1 < treffer.length ? treffer[i + 1].von : t.length;
        teile.push({ ab: Math.min(tr.ab, dauer), text: t.slice(tr.bis, ende).trim(), regie: false });
      });
      return teile;
    }
    // Ohne Zeitmarken: Kopf («Dauer 24 Sekunden. Vollständige Textfassung:») weglassen, nach Regie und Sprechern teilen
    t = t.replace(/^[^.\[„]*\d+\s*Sekunden\.\s*/, '').replace(/^Vollständige (?:Text|Hör)fassung:\s*/, '');
    var stuecke = [];
    t.split(/(\[[^\]]*\])/).forEach(function (s) {
      s = s.trim(); if (!s) return;
      if (s.charAt(0) === '[') {
        s = s.slice(1, -1).trim();
        if (s.length > 140) saetze(s).forEach(function (x) { stuecke.push({ text: x, regie: true }); });
        else stuecke.push({ text: s, regie: true });
      } else {
        s.split(/\s(?=[A-ZÄÖÜ][a-zäöü]+(?:,\s*[a-zäöü]+)?:\s*„)/).forEach(function (x) { x = x.trim(); if (x) stuecke.push({ text: x, regie: false }); });
      }
    });
    var gewicht = stuecke.map(function (s) { return Math.max(24, s.text.length); });
    var summe = gewicht.reduce(function (a, b) { return a + b; }, 0) || 1, lauf = 0;
    stuecke.forEach(function (s, i) { s.ab = dauer * lauf / summe; lauf += gewicht[i]; });
    return stuecke;
  }

  // ---------- Memo: gemeinsames Audio-Element ----------
  var tonEl = null, aktiv = null;
  function tonElement() {
    if (tonEl) return tonEl;
    tonEl = document.createElement('audio');
    tonEl.preload = 'auto';
    tonEl.setAttribute('playsinline', '');
    tonEl.style.display = 'none';
    document.body.appendChild(tonEl);
    tonEl.addEventListener('timeupdate', function () { if (aktiv && aktiv.modus === 'ton') aktiv.setzePos(tonEl.currentTime, true); });
    tonEl.addEventListener('ended', function () { if (aktiv && aktiv.modus === 'ton') aktiv.fertig(); });
    tonEl.addEventListener('pause', function () { if (aktiv && aktiv.modus === 'ton' && aktiv.spielt && !tonEl.ended) aktiv.halt(true); });
    tonEl.addEventListener('loadedmetadata', function () { if (aktiv && aktiv.modus === 'ton' && isFinite(tonEl.duration)) aktiv.setzeDauer(tonEl.duration); });
    return tonEl;
  }
  function stoppeAlles() { if (aktiv && aktiv.spielt) aktiv.halt(); }

  var SVG_PLAY = '<svg class="ukm-play-ikon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6L12.6 8z"/></svg>';
  var SVG_PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3h2.4v10H4.5zM9.1 3h2.4v10H9.1z"/></svg>';

  function renderMemo(d) {
    var box = el('div', 'ukm ukm-memo');
    box.setAttribute('data-medium', d.id);
    var dauer = d.dauer || 12;
    var teile = abschnitte(d.memoText, dauer);

    var leiste = el('div', 'ukm-leiste');
    var knopf = el('button', 'ukm-play'); knopf.type = 'button';
    knopf.innerHTML = SVG_PLAY; knopf.setAttribute('aria-label', 'Sprachmemo abspielen');
    var welle = el('div', 'ukm-welle');
    welle.setAttribute('role', 'slider'); welle.tabIndex = 0;
    welle.setAttribute('aria-label', 'Position im Sprachmemo');
    welle.setAttribute('aria-valuemin', '0');
    var N = 42, balken = [], zufall = hash(d.id);
    for (var i = 0; i < N; i++) {
      zufall = Math.imul(zufall ^ (zufall >>> 15), 2246822507) >>> 0;
      var r = (zufall % 1000) / 1000, x = i / (N - 1);
      var huelle = 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, x * 1.15 + 0.04));
      var b = el('span', 'ukm-balken'); b.style.height = Math.round(18 + 82 * huelle * (0.35 + 0.65 * r)) + '%';
      welle.appendChild(b); balken.push(b);
    }
    var anzeige = el('span', 'ukm-dauer', zeit(dauer));
    leiste.appendChild(knopf); leiste.appendChild(welle); leiste.appendChild(anzeige);
    box.appendChild(leiste);

    var unten = el('div', 'ukm-unterschrift');
    unten.appendChild(el('span', 'ukm-titel', d.titel));
    var umschalter = el('button', 'ukm-knopf-text ukm-mitlesen', 'Mitlesen'); umschalter.type = 'button';
    umschalter.setAttribute('aria-expanded', 'false');
    unten.appendChild(umschalter);
    box.appendChild(unten);

    var liste = el('ol', 'ukm-text'); liste.hidden = true;
    var tid = 'ukm-t-' + d.id; liste.id = tid; umschalter.setAttribute('aria-controls', tid);
    var zeilen = teile.map(function (t) {
      var li = el('li', 'ukm-zeile' + (t.regie ? ' ukm-regie' : ''));
      li.appendChild(el('span', 'ukm-stempel', zeit(t.ab)));
      var s = el('span', 'ukm-satz'); s.innerHTML = mitRede(t.text);
      li.appendChild(s); liste.appendChild(li); return li;
    });
    box.appendChild(liste);
    box.appendChild(details(d.details));

    // Zustand
    var p = { modus: null, spielt: false, pos: 0, dauer: dauer, voll: false, gestartet: false };
    var uhr = null, zuletzt = 0;

    function zeichne() {
      var anteil = p.dauer ? Math.min(1, p.pos / p.dauer) : 0;
      var bis = Math.round(anteil * N);
      for (var k = 0; k < N; k++) balken[k].classList.toggle('ukm-an', k < bis);
      anzeige.textContent = p.gestartet && p.pos < p.dauer ? zeit(p.pos) : zeit(p.dauer);
      welle.setAttribute('aria-valuemax', String(Math.round(p.dauer)));
      welle.setAttribute('aria-valuenow', String(Math.round(p.pos)));
      welle.setAttribute('aria-valuetext', zeit(p.pos) + ' von ' + zeit(p.dauer));
      var jetzt = -1;
      teile.forEach(function (t, k) { if (t.ab <= p.pos + 0.05) jetzt = k; });
      var zeigeVerlauf = p.gestartet && !p.voll;
      liste.hidden = !(p.voll || p.gestartet);
      zeilen.forEach(function (z, k) {
        var kommt = k > jetzt;
        z.classList.toggle('ukm-kommt', zeigeVerlauf && kommt);
        z.classList.toggle('ukm-spaeter', !zeigeVerlauf && p.gestartet && p.spielt && kommt);
        z.classList.toggle('ukm-jetzt', p.spielt && k === jetzt);
      });
      knopf.innerHTML = p.spielt ? SVG_PAUSE : SVG_PLAY;
      knopf.setAttribute('aria-label', p.spielt ? 'Sprachmemo anhalten' : 'Sprachmemo abspielen');
      box.classList.toggle('ukm-spielt', p.spielt);
      umschalter.textContent = p.voll ? 'Text ausblenden' : p.gestartet ? 'Ganzer Text' : 'Mitlesen';
      umschalter.setAttribute('aria-expanded', String(p.voll));
    }

    var api = {
      get modus() { return p.modus; }, get spielt() { return p.spielt; },
      setzePos: function (s, vonTon) { p.pos = Math.max(0, Math.min(p.dauer, s)); if (!vonTon && p.modus === 'ton' && aktiv === api) { try { tonEl.currentTime = p.pos; } catch (e) { /* noch nicht bereit */ } } zeichne(); },
      setzeDauer: function (s) { if (s > 0) { p.dauer = s; teile = abschnitte(d.memoText, s); teile.forEach(function (t, k) { if (zeilen[k]) zeilen[k].firstChild.textContent = zeit(t.ab); }); zeichne(); } },
      halt: function (vonTon) {
        p.spielt = false; clearInterval(uhr); uhr = null;
        if (!vonTon && p.modus === 'ton' && tonEl && aktiv === api) tonEl.pause();
        zeichne();
      },
      fertig: function () { p.spielt = false; clearInterval(uhr); uhr = null; p.pos = p.dauer; p.voll = true; zeichne(); }
    };

    function stillStart() {
      p.modus = 'still'; p.spielt = true; zuletzt = performance.now();
      clearInterval(uhr);
      uhr = setInterval(function () {
        var n = performance.now(); p.pos += (n - zuletzt) / 1000; zuletzt = n;
        if (p.pos >= p.dauer) { api.fertig(); return; }
        zeichne();
      }, 120);
      zeichne();
    }
    function tonStart(urls) {
      var a = tonElement(), i = 0, setze = null;
      p.modus = 'ton'; p.spielt = true; zeichne();
      function versuch() {
        if (aktiv !== api || !p.spielt) return;
        if (i >= urls.length) { tonStatus[d.id] = { zustand: 'nein', url: null, dauer: 0, warte: [] }; return stillStart(); }
        var url = urls[i++];
        a.onerror = function () { a.onerror = null; versuch(); };
        if (a.getAttribute('src') !== url) { a.src = url; }
        var startPos = p.pos;
        if (setze) a.removeEventListener('loadedmetadata', setze);
        setze = function () { a.removeEventListener('loadedmetadata', setze); if (startPos > 0) { try { a.currentTime = startPos; } catch (e) { /* egal */ } } tonStatus[d.id] = { zustand: 'ja', url: url, dauer: a.duration, warte: [] }; };
        if (a.readyState >= 1) setze(); else a.addEventListener('loadedmetadata', setze);
        var v = a.play();
        if (v && v.catch) v.catch(function (e) { if (e && e.name === 'NotAllowedError' && aktiv === api) { api.halt(true); } });
      }
      versuch();
    }

    function abspielen() {
      if (aktiv && aktiv !== api) aktiv.halt();
      aktiv = api;
      if (p.pos >= p.dauer - 0.05) p.pos = 0;
      if (!p.gestartet) { p.gestartet = true; markiere(d.id); }
      var st = tonStatus[d.id];
      if (st && st.zustand === 'nein') return stillStart();
      // Im Tippen selbst starten (iPhone entsperrt so das Element)
      var urls = st && st.zustand === 'ja' ? [st.url] : kandidaten(d.id, 'ton');
      if (!urls.length) return stillStart();
      tonStart(urls);
    }
    knopf.addEventListener('click', function () { if (p.spielt) api.halt(); else abspielen(); });
    umschalter.addEventListener('click', function () { p.voll = !p.voll; zeichne(); });

    function sprung(clientX) {
      var r = welle.getBoundingClientRect();
      var a = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      if (!p.gestartet) { p.gestartet = true; }
      api.setzePos(a * p.dauer);
    }
    welle.addEventListener('click', function (e) { sprung(e.clientX); });
    welle.addEventListener('keydown', function (e) {
      var s = { ArrowRight: 2, ArrowUp: 2, ArrowLeft: -2, ArrowDown: -2 }[e.key];
      if (e.key === 'Home') s = -p.pos; if (e.key === 'End') s = p.dauer - p.pos;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); knopf.click(); return; }
      if (s == null) return;
      e.preventDefault(); p.gestartet = true; api.setzePos(p.pos + s);
    });

    pruefeTon(d.id, function (st) {
      if (st.zustand === 'ja' && st.dauer && !p.gestartet) api.setzeDauer(st.dauer);
      box.classList.toggle('ukm-mit-ton', st.zustand === 'ja');
    });
    zeichne();
    return box;
  }

  // ---------- Öffentliche Schnittstelle ----------
  function render(id) {
    var d = definition(id);
    if (d) { markiere(id); return d.art === 'memo' ? renderMemo(d) : renderFoto(d); }
    // Daten noch nicht geladen: Hülle sofort zurückgeben, später füllen
    var huelle = el('div', 'ukm-huelle'); huelle.setAttribute('data-medium', id);
    ladeListe().then(function () {
      var d2 = definition(id);
      if (!d2) { if (window.console) console.warn('UK.medien: unbekanntes Medium', id); return; }
      markiere(id);
      huelle.appendChild(d2.art === 'memo' ? renderMemo(d2) : renderFoto(d2));
    });
    return huelle;
  }
  function vorhanden(id) {
    var b = bildStatus[id], t = tonStatus[id];
    if (!b) pruefeBild(id, function () {});
    if (!t) pruefeTon(id, function () {});
    return { bild: !!(b && b.zustand === 'ja'), ton: !!(t && t.zustand === 'ja') };
  }
  function pruefe(id) {
    return new Promise(function (ok) {
      var n = 0; function f() { if (++n === 2) ok(vorhanden(id)); }
      pruefeBild(id, f); pruefeTon(id, f);
    });
  }

  UK.medien = {
    render: render,
    vorhanden: vorhanden,
    pruefe: pruefe,
    gesehen: function () { return gesehenListe.slice(); },
    markiere: markiere,
    stoppeAlles: function () { stoppeAlles(); schliesseVollansicht(); },
    konfig: function (o) { o = o || {}; if (o.assets) einst.assets = o.assets.replace(/\/?$/, '/'); if ('vollansichtIn' in o) einst.vollansichtIn = o.vollansichtIn; },
    // Für Tests: bestimmte Dateien für ein Medium vorgeben (null = keine Datei)
    quelle: function (id, q) { vorgaben[id] = q || {}; delete bildStatus[id]; delete tonStatus[id]; },
    ids: function () { var s = (UK.story && UK.story.medien) || UK.medienDaten || {}; return Array.isArray(s) ? s.map(function (m) { return m.id; }) : Object.keys(s); },
    _abschnitte: abschnitte
  };
})();
