/* UK.karte: Grundriss von Black Pine House als SVG. Schnittstelle: mount(el), setOrt(ortId), entdecke(ortIds), reset(), zustand(), laden(zustand). Bindet karte/karte.css selbst ein. */
(function () {
  'use strict';
  var UK = window.UK = window.UK || {};

  // Stylesheet neben dieser Datei einbinden (index.html bleibt unberührt)
  (function stil() {
    try {
      if (document.querySelector('link[data-uk-karte]')) return;
      var s = document.currentScript && document.currentScript.src;
      var href = s ? s.replace(/karte\.js(\?.*)?$/, 'karte.css') : 'karte/karte.css';
      var l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = href; l.setAttribute('data-uk-karte', '');
      (document.head || document.documentElement).appendChild(l);
    } catch (e) { /* ohne Stil läuft die Karte trotzdem */ }
  })();

  var NS = 'http://www.w3.org/2000/svg';
  // Blatt im Hochformat nahe 6:7, damit es das Karten-Blatt (Handy und Computer) ohne Rollen füllt.
  var VB_B = 360, VB_H = 430;
  var SCHRIFT_MAX = 1.05;  // Ortsnamen bleiben 11 px; auf sehr kleinen Blättern wachsen sie höchstens um 5 % mit, damit sie in den Räumen bleiben

  // Orte: Name, Wegpunkt (k), Beschriftung (l: x, y, Anker, Drehung).
  // Unentdeckte Orte sind unsichtbar; das Blatt füllt sich erst beim Erkunden.
  var ORTE = {
    strasse:       { name: 'Strasse',      k: 'S',  l: [8, 15, 'start'], geheim: true },
    zufahrt:       { name: 'Zufahrt',      k: 'Z',  l: [306, 52, 'start'] },
    wald:          { name: 'Wald',         k: 'W',  l: [22, 196, 'middle', -90], geheim: true },
    schuppen:      { name: 'Schuppen',     k: 'K',  l: [75, 113, 'start'] },
    speisezimmer:  { name: 'Esszimmer',    k: 'E',  l: [153, 105, 'start'] },
    flur:          { name: 'Flur',         k: 'F',  l: [227, 105, 'start'] },
    archiv:        { name: 'Archiv',       k: 'A',  l: [103, 187, 'start'] },
    seitenfluegel: { name: 'Seitenflügel', k: 'SF', l: [165, 187, 'start'] },
    pumpenhaus:    { name: 'Pumpenhaus',   k: 'PH', l: [224, 314, 'start'], geheim: true },
    gaestezimmer:  { name: 'Gästezimmer',  k: 'GZ', l: [169, 383, 'start'], geheim: true },
    bad:           { name: 'Bad',          k: 'BD', l: [259, 383, 'start'], geheim: true },
    unbekannt:     { name: 'Unbekannter Ort', k: null, l: null, geheim: true }
  };
  var REIHE = ['zufahrt', 'flur', 'speisezimmer', 'gaestezimmer', 'bad', 'schuppen', 'wald',
    'seitenfluegel', 'archiv', 'pumpenhaus', 'strasse', 'unbekannt'];

  // Wegnetz: Punkte und Verbindungen (Türen, Hof, Pfad). Unsichtbare Kanten (Treppe, langer Aussenweg) werden nicht gezeichnet.
  // Namen stehen oben links im Raum (wie auf einem Bauplan), Punkte und Wege in der Raummitte: sie berühren sich nie.
  var P = {
    S: [296, 26], T: [296, 72], Z: [304, 104], O1: [268, 82], D: [268, 100], F: [251, 148], E: [183, 148],
    O2: [146, 82], K2: [146, 126], K: [103, 126], PF: [56, 131], P2: [34, 131], W: [34, 250], L: [78, 204],
    A: [127, 204], SF: [200, 204], B1: [80, 240], B2: [184, 240], G: [200, 228], PH: [200, 304],
    R: [326, 262], GZ: [207, 404], OF: [278, 411], BD: [290, 388]
  };
  var KANTEN = [
    ['S', 'T'], ['T', 'Z'], ['Z', 'O1'], ['O1', 'D'], ['D', 'F'], ['F', 'E'], ['O1', 'O2'], ['O2', 'K2'], ['K2', 'K'],
    ['K', 'PF'], ['PF', 'P2'], ['P2', 'W'], ['PF', 'L'], ['L', 'A'], ['L', 'B1'], ['B1', 'B2'], ['B2', 'SF'],
    ['A', 'SF'], ['SF', 'G'], ['G', 'PH'], ['PH', 'R'], ['R', 'Z'], ['PH', 'B1'],
    ['GZ', 'OF'], ['OF', 'BD'],
    ['F', 'OF', 140, true],   // Treppe ins Obergeschoss
    ['W', 'S', 170, true]     // langer Aussenweg bis zur Strasse
  ];

  // Zeichnung (Haarlinien). r = Raum, p = Wand als Pfad, w = Linie/Weg
  var FORMEN = {
    strasse: [['w', 'M8 26 H352']],
    zufahrt: [['w', 'M296 26 C 292 46, 300 56, 296 72', 'weg'], ['r', 320, 116, 11, 22, 'fahrzeug']],
    wald: [['w', 'M56 131 H34 V300', 'weg'], ['w', 'M34 300 C 36 332, 60 352, 98 364', 'weg ende'],
      ['w', 'M30 306 C 46 322, 60 338, 68 360', 'graben'], ['w', 'M38 302 C 54 318, 68 334, 76 356', 'graben']],
    schuppen: [['r', 68, 98, 70, 40]],
    speisezimmer: [['r', 146, 90, 74, 82]],
    flur: [['p', 'M262 90 H220 V172 H282 V90 H274'], ['r', 252, 398, 52, 24, 'og']],
    archiv: [['r', 96, 172, 62, 46]],
    seitenfluegel: [['r', 158, 172, 84, 46], ['r', 96, 138, 30, 34]],
    pumpenhaus: [['w', 'M196 218 V290 M204 218 V290', 'gang'], ['r', 184, 290, 32, 28]],
    gaestezimmer: [['r', 162, 368, 90, 54, 'og']],
    bad: [['r', 252, 368, 52, 30, 'og']]
  };
  // Grundstück: Zaun mit Tor (oben), Pforte (links) und offenem Ende am Graben (unten links)
  var ZAUN = 'M56 312 V138 M56 124 V72 H286 M306 72 H344 V336 H84';

  var st = { ort: null, entdeckt: {}, weg: [] };
  var dom = null;
  var lauf = null; // laufende Bewegung

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function gueltig(id) { return typeof id === 'string' && ORTE.hasOwnProperty(id); }
  function reduziert() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  function abstand(a, b) { return Math.sqrt(Math.pow(b[0] - a[0], 2) + Math.pow(b[1] - a[1], 2)); }

  // Kürzester Weg im Wegnetz (Dijkstra, winzig). Ergebnis: Liste von Abschnitten [[punkt,...], ...];
  // ein neuer Abschnitt beginnt nach jeder unsichtbaren Kante.
  var NACHBARN = (function () {
    var n = {};
    KANTEN.forEach(function (k) {
      var w = k[2] || abstand(P[k[0]], P[k[1]]), u = !!k[3];
      (n[k[0]] = n[k[0]] || []).push([k[1], w, u]);
      (n[k[1]] = n[k[1]] || []).push([k[0], w, u]);
    });
    return n;
  })();
  function route(von, nach) {
    var a = ORTE[von].k, b = ORTE[nach].k;
    if (!a || !b) return null;
    var dist = {}, vor = {}, offen = {}, x;
    for (x in P) { dist[x] = Infinity; offen[x] = true; }
    dist[a] = 0;
    for (;;) {
      var u = null;
      for (x in offen) if (u === null || dist[x] < dist[u]) u = x;
      if (u === null || dist[u] === Infinity || u === b) break;
      delete offen[u];
      (NACHBARN[u] || []).forEach(function (nb) {
        if (dist[u] + nb[1] < dist[nb[0]]) { dist[nb[0]] = dist[u] + nb[1]; vor[nb[0]] = [u, nb[2]]; }
      });
    }
    if (dist[b] === Infinity) return null;
    var abschnitte = [[P[b]]], c = b;
    while (c !== a) {
      var v = vor[c];
      if (v[1]) abschnitte.unshift([P[v[0]]]); else abschnitte[0].unshift(P[v[0]]);
      c = v[0];
    }
    return abschnitte;
  }

  function zeichne(root) {
    var blatt = el('svg', { viewBox: '0 0 ' + VB_B + ' ' + VB_H, role: 'img', 'class': 'uk-karte__blatt',
      preserveAspectRatio: 'xMidYMid meet', focusable: 'false' });
    var svg = el('g', { 'class': 'uk-karte__inhalt' }, blatt);
    el('path', { d: ZAUN, 'class': 'uk-karte__zaun' }, svg);
    var og = el('text', { x: 162, y: 360, 'class': 'uk-karte__og', 'aria-hidden': 'true' }, svg);
    og.textContent = 'Obergeschoss';

    var gruppen = {};
    REIHE.forEach(function (id) {
      var o = ORTE[id];
      var g = el('g', { 'class': 'uk-ort' + (o.geheim ? ' uk-ort--geheim' : ''), 'data-ort': id, 'data-z': 'nein', 'aria-hidden': 'true' }, svg);
      (FORMEN[id] || []).forEach(function (f) {
        var zusatz = (f[0] === 'r' ? f[5] : f[2]);
        var cls = zusatz ? ' ' + zusatz.split(' ').map(function (c) { return 'uk-ort__' + c; }).join(' ') : '';
        if (f[0] === 'r') el('rect', { x: f[1], y: f[2], width: f[3], height: f[4], 'class': 'uk-ort__wand' + cls }, g);
        else if (f[0] === 'p') el('path', { d: f[1], 'class': 'uk-ort__wand' }, g);
        else el('path', { d: f[1], 'class': 'uk-ort__linie' + cls }, g);
      });
      if (o.l) {
        var t = el('text', { x: o.l[0], y: o.l[1], 'text-anchor': o.l[2], 'class': 'uk-ort__name' }, g);
        if (o.l[3]) t.setAttribute('transform', 'rotate(' + o.l[3] + ' ' + o.l[0] + ' ' + o.l[1] + ')');
        t.textContent = o.name;
      }
      gruppen[id] = g;
    });

    // Spur: gepunktete Linie, sichtbar nur, wo die Maske (gleiche Linien, durchgezogen) schon gezeichnet ist
    var defs = el('defs', {}, blatt);
    var maske = el('mask', { id: 'uk-karte-spur', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: VB_B, height: VB_H }, defs);
    var weg = el('g', { 'class': 'uk-karte__weg', 'aria-hidden': 'true', mask: 'url(#uk-karte-spur)' }, svg);
    var mike = el('g', { 'class': 'uk-karte__mike', 'aria-hidden': 'true' }, svg);
    el('circle', { r: 8, 'class': 'uk-karte__hauch' }, mike);
    el('circle', { r: 3.2, 'class': 'uk-karte__punkt' }, mike);
    // Ruhige Fläche hinter «Unbekannter Ort», damit keine verblasste Linie durch die Schrift läuft
    var fortGrund = el('g', { 'class': 'uk-karte__fort', 'aria-hidden': 'true' }, blatt);
    el('rect', { x: VB_B / 2 - 96, y: 218, width: 192, height: 26, rx: 2, 'class': 'uk-karte__fortgrund' }, fortGrund);
    var fort = el('text', { x: VB_B / 2, y: 236, 'text-anchor': 'middle', 'class': 'uk-karte__fort', 'aria-hidden': 'true' }, blatt);
    fort.textContent = 'Unbekannter Ort';

    root.appendChild(blatt);
    return { root: root, svg: blatt, gruppen: gruppen, weg: weg, maske: maske, mike: mike };
  }

  // Schrift in echten Pixeln halten: --k-s = Blatt-Einheiten pro Bildschirm-Pixel (gedeckelt für sehr kleine Blätter)
  var beobachter = null;
  function massstab() {
    if (!dom) return;
    var b = dom.svg.clientWidth, h = dom.svg.clientHeight;
    if (!b || !h) return;
    var s = Math.min(b / VB_B, h / VB_H);
    dom.svg.style.setProperty('--k-s', Math.min(1 / s, SCHRIFT_MAX).toFixed(4));
  }
  function beobachte() {
    if (beobachter) { try { beobachter.disconnect(); } catch (e) { /* egal */ } beobachter = null; }
    if (!dom) return;
    if (window.ResizeObserver) {
      beobachter = new ResizeObserver(massstab);
      beobachter.observe(dom.svg);
    }
    massstab();
  }

  // Zeichnet einen Spurabschnitt; gibt die Maskenlinie zurück (für das langsame Aufzeichnen).
  // neu: zum letzten Weg gehörend (heller), ältere Wege treten zurück.
  function linie(punkte, neu) {
    var pts = punkte.map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
    el('polyline', { points: pts, 'class': neu ? 'uk-karte__neu' : '' }, dom.weg);
    return el('polyline', { points: pts }, dom.maske);
  }
  function altern() {
    if (!dom) return;
    Array.prototype.forEach.call(dom.weg.querySelectorAll('.uk-karte__neu'), function (n) { n.setAttribute('class', ''); });
  }
  function setzePunkt(p) { if (dom && p) dom.mike.setAttribute('transform', 'translate(' + p[0] + ' ' + p[1] + ')'); }

  // Ganze Spur neu zeichnen (Laden, Reset, Mount)
  function zeichneWeg() {
    if (!dom) return;
    while (dom.weg.firstChild) dom.weg.removeChild(dom.weg.firstChild);
    while (dom.maske.firstChild) dom.maske.removeChild(dom.maske.firstChild);
    for (var i = 1; i < st.weg.length; i++) {
      var r = route(st.weg[i - 1], st.weg[i]);
      var neu = i === st.weg.length - 1;
      if (r) r.forEach(function (ab) { if (ab.length > 1) linie(ab, neu); });
    }
  }

  function beende() {
    if (!lauf) return;
    if (lauf.id) cancelAnimationFrame(lauf.id);
    lauf.teile.forEach(function (t) { t.el.style.strokeDasharray = ''; t.el.style.strokeDashoffset = ''; });
    setzePunkt(lauf.ziel);
    lauf = null;
  }

  // Mike läuft langsam die Route entlang; die Spur zeichnet sich mit.
  function bewege(abschnitte) {
    beende();
    var ziel = abschnitte[abschnitte.length - 1];
    ziel = ziel[ziel.length - 1];
    var teile = [], gesamt = 0;
    altern();
    abschnitte.forEach(function (ab, ai) {
      if (ab.length < 2) { teile.push({ sprung: true, p: ab[0], von: gesamt }); return; }
      var lens = [], len = 0;
      for (var i = 1; i < ab.length; i++) { lens.push(abstand(ab[i - 1], ab[i])); len += lens[lens.length - 1]; }
      var l = linie(ab, true);
      teile.push({ el: l, pts: ab, lens: lens, len: len, von: gesamt });
      if (ai > 0) teile[teile.length - 1].sprungVorher = true;
      gesamt += len;
    });
    teile = teile.filter(function (t) { return !t.sprung; });
    if (reduziert() || gesamt === 0) { setzePunkt(ziel); return; }
    teile.forEach(function (t) { t.el.style.strokeDasharray = t.len + ' ' + t.len; t.el.style.strokeDashoffset = t.len; });
    var dauer = Math.max(1800, Math.min(4200, gesamt * 9));
    var start = null;
    lauf = { teile: teile, ziel: ziel, id: 0 };
    function schritt(jetzt) {
      if (!lauf) return;
      if (start === null) start = jetzt;
      var t = Math.min(1, (jetzt - start) / dauer);
      var e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // sanft an, sanft aus
      var s = e * gesamt, pos = null;
      teile.forEach(function (tl) {
        var lokal = Math.max(0, Math.min(tl.len, s - tl.von));
        tl.el.style.strokeDashoffset = tl.len - lokal;
        if (s >= tl.von && (pos === null || s <= tl.von + tl.len)) {
          var r = lokal;
          for (var i = 0; i < tl.lens.length; i++) {
            if (r <= tl.lens[i] || i === tl.lens.length - 1) {
              var q = tl.lens[i] ? Math.min(1, r / tl.lens[i]) : 1, a = tl.pts[i], b = tl.pts[i + 1];
              pos = [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q];
              break;
            }
            r -= tl.lens[i];
          }
        }
      });
      // Treppe/Aussenweg: Punkt blendet kurz aus
      var halb = teile.some(function (tl) { return tl.sprungVorher && Math.abs(s - tl.von) < gesamt * 0.04; });
      dom.mike.style.opacity = halb ? '0' : '';
      setzePunkt(pos || ziel);
      if (t < 1) lauf.id = requestAnimationFrame(schritt);
      else { lauf.id = 0; beende(); }
    }
    lauf.id = requestAnimationFrame(schritt);
  }

  function beschreibung() {
    var teile = ['Karte von Black Pine House.'];
    if (st.ort === 'unbekannt') teile.push('Mike ist an einem unbekannten Ort.');
    else if (st.ort) teile.push('Mike ist hier: ' + ORTE[st.ort].name + '.');
    var e = REIHE.filter(function (id) { return st.entdeckt[id] && id !== 'unbekannt'; })
      .map(function (id) { return ORTE[id].name; });
    teile.push(e.length ? 'Entdeckt: ' + e.join(', ') + '.' : 'Noch nichts entdeckt.');
    return teile.join(' ');
  }

  function aktualisiere(sofort) {
    if (!dom) return;
    var r = dom.root;
    if (sofort) r.classList.add('uk-karte--sofort');
    REIHE.forEach(function (id) {
      dom.gruppen[id].setAttribute('data-z', id === st.ort ? 'hier' : (st.entdeckt[id] ? 'ja' : 'nein'));
    });
    r.classList.toggle('uk-karte--og', !!(st.entdeckt.gaestezimmer || st.entdeckt.bad));
    r.classList.toggle('uk-karte--fort', st.ort === 'unbekannt');
    var k = st.ort && ORTE[st.ort].k;
    dom.mike.classList.toggle('uk-karte__mike--da', !!k);
    if (k && (sofort || !lauf)) setzePunkt(P[k]);
    dom.svg.setAttribute('aria-label', beschreibung());
    if (sofort) {
      r.getBoundingClientRect();
      setTimeout(function () { r.classList.remove('uk-karte--sofort'); }, 30);
    }
  }

  UK.karte = {
    mount: function (ziel) {
      if (!ziel) return;
      beende();
      while (ziel.firstChild) ziel.removeChild(ziel.firstChild);
      ziel.classList.add('uk-karte');
      dom = zeichne(ziel);
      zeichneWeg();
      aktualisiere(true);
      beobachte();
    },
    setOrt: function (id) {
      if (!gueltig(id) || id === st.ort) return;
      var vorher = st.ort;
      st.ort = id;
      st.entdeckt[id] = true;
      if (ORTE[id].k) {
        var letzter = st.weg[st.weg.length - 1];
        if (letzter !== id) st.weg.push(id);
        var r = letzter && letzter !== id ? route(letzter, id) : null;
        if (dom && r && vorher && vorher !== 'unbekannt') {
          aktualisiere(false);
          bewege(r);
          return;
        }
        if (dom && r) { altern(); r.forEach(function (ab) { if (ab.length > 1) linie(ab, true); }); }
      }
      aktualisiere(!vorher);
    },
    entdecke: function (ids) {
      if (typeof ids === 'string') ids = [ids];
      if (!Array.isArray(ids)) return;
      var neu = false;
      ids.forEach(function (id) { if (gueltig(id) && !st.entdeckt[id]) { st.entdeckt[id] = true; neu = true; } });
      if (neu) aktualisiere(false);
    },
    reset: function () {
      beende();
      st = { ort: null, entdeckt: {}, weg: [] };
      zeichneWeg();
      aktualisiere(true);
    },
    zustand: function () {
      return { version: 1, ort: st.ort,
        entdeckt: REIHE.filter(function (id) { return st.entdeckt[id]; }), weg: st.weg.slice() };
    },
    laden: function (z) {
      beende();
      st = { ort: null, entdeckt: {}, weg: [] };
      if (z && typeof z === 'object') {
        var liste = function (x) { return Array.isArray(x) ? x : []; };
        liste(z.entdeckt).forEach(function (id) { if (gueltig(id)) st.entdeckt[id] = true; });
        liste(z.weg).forEach(function (id) {
          if (gueltig(id) && ORTE[id].k && st.weg[st.weg.length - 1] !== id) st.weg.push(id);
        });
        if (gueltig(z.ort)) { st.ort = z.ort; st.entdeckt[z.ort] = true; }
      }
      zeichneWeg();
      aktualisiere(true);
    }
  };
})();
