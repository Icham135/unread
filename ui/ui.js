/* UK.ui – Oberfläche (Vertrag SPEC §3.1): init, showTitle, setKontakt, addNachricht, setTippt, zeigeAntworten, zeigePause, zeigeEnde, oeffneMenue, setOrt, leere, mountKarteKnopf.
   Zusätze: setModus(m), modus(), setHooks({onModus,onSpeichern,onLaden,onUeberspringen,onTitel,hatSlot,onProfil,onOhneFrist}), schliesseMenue(), karteEl(), oeffneKarte(), schliesseKarte(), zeigeTitel = showTitle.
   Funktionen (FUNKTIONEN.md): Zustellstatus unter der letzten eigenen Nachricht (Gesendet/Zugestellt/Gelesen HH:MM), setZeit(hhmm), friereStatus(an), versteckeAntworten(),
   Datumszeile, oeffneProfil()/schliesseProfil() («Geteilte Medien»), zeigeArchiv(liste) (Enden-Archiv «Dein Weg»), einstellung(name), kontakt().
   Regeln: Die UI schreibt die gewählte Antwort NICHT selbst in den Chat (das macht die Engine mit addNachricht von:'ich').
   leere() verwirft laufende Abläufe: deren Promises bleiben bewusst offen, damit keine alte Nachricht in einen neuen Verlauf fällt. */
(function () {
  'use strict';
  var UK = window.UK = window.UK || {};
  var ui = UK.ui = UK.ui || {};

  // ---------- Hilfen ----------
  function lesen(k, d) { try { var v = window.localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function schreiben(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ohne Speicher weiter */ } }
  function h(tag, attr, kinder) {
    var el = document.createElement(tag);
    if (attr) for (var k in attr) {
      if (!Object.prototype.hasOwnProperty.call(attr, k) || attr[k] == null || attr[k] === false) continue;
      if (k === 'text') el.textContent = attr[k];
      else if (k === 'html') el.innerHTML = attr[k];
      else if (k === 'class') el.className = attr[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attr[k]);
      else el.setAttribute(k, attr[k] === true ? '' : attr[k]);
    }
    if (kinder) (Array.isArray(kinder) ? kinder : [kinder]).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function zufall(a, b) { return a + Math.random() * (b - a); }
  function klemme(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function absaetze(text, klasse) {
    var frag = document.createDocumentFragment();
    String(text || '').split(/\n\s*\n|\n/).forEach(function (t) { t = t.trim(); if (t) frag.appendChild(h('p', { class: klasse || null, text: t })); });
    return frag;
  }
  var wenigBewegung = false;
  try { wenigBewegung = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { }

  var SVG = {
    menue: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 7h12M4 13h12"/></svg>',
    zu: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>',
    karte: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5.5l4.5-2 5 2 4.5-2v11l-4.5 2-5-2-4.5 2z"/><path d="M7.5 3.5v11M12.5 5.5v11"/></svg>',
    haken: '<svg class="uk-haken" viewBox="0 0 14 10" aria-hidden="true"><path class="h1" d="M1 5.2l2.6 2.6L9 2.4"/><path class="h2" d="M5.6 7.8l.4.4L12.6 1.6"/></svg>'
  };

  // ---------- Zustand ----------
  var S = {
    root: null, el: {}, modus: 'schnell', gen: 0, timer: [],
    letzteVon: null, letzteMsg: null, tippEl: null, tippVon: null,
    status: 'online', letzteZeit: '', ortId: null,
    antwort: null, karteOffen: false, karteCb: null, menueOffen: false, menueVorher: null,
    tastatur: false, amBoden: true, hooks: {},
    letzteIch: null, zustellung: null, gefroren: false, jetzt: '', zuletzt: '', profilOffen: false
  };
  var E = lesen('uk.ui.einstellungen', null) || {};
  // Schrift: drei Grössen (ältere Einstellungen mit vier Stufen werden umgerechnet)
  var schriftAlt = E.sv === 2 ? E.schrift : ({ 0: 0, 1: 0, 2: 1, 3: 2 })[E.schrift];
  var EIN = { schrift: klemme(+schriftAlt || 0, 0, 2), kontrast: !!E.kontrast, ton: false, modus: E.modus || 'schnell', vorlesen: !!E.vorlesen, ohneFrist: !!E.ohneFrist };
  var SKALA = [1, 1.12, 1.25];
  var SCHRIFT_NAME = ['Normal', 'Gross', 'Sehr gross'];
  var MODI = [
    { id: 'schnell', name: 'Schnelldurchlauf', text: 'Wartezeiten stark gekürzt. Etwa anderthalb Stunden.' },
    { id: 'realismus', name: 'Realismus', text: 'Mike tippt in echter Geschwindigkeit, Pausen dauern wirklich, bis zu anderthalb Minuten am Stück. Deutlich länger.' },
    { id: 'direkt', name: 'Direkt lesen', text: 'Alles erscheint sofort. Nur Entscheidungen halten an.' }
  ];
  S.modus = EIN.modus;
  ui._zustand = S; // nur zur Fehlersuche

  function speichereEinstellungen() { schreiben('uk.ui.einstellungen', { sv: 2, schrift: EIN.schrift, kontrast: EIN.kontrast, modus: S.modus, vorlesen: EIN.vorlesen, ohneFrist: EIN.ohneFrist }); }
  ui.einstellung = function (k) { return k === 'modus' ? S.modus : EIN[k]; };

  // Vorlesen (Zugang, nur nach ausdrücklichem Einschalten): Stimme des Geräts
  function vorlesen(text) {
    if (!EIN.vorlesen || !text) return;
    try {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
      var u = new window.SpeechSynthesisUtterance(String(text));
      u.lang = 'de-DE'; u.rate = 1;
      window.speechSynthesis.speak(u);
    } catch (e) { /* ohne Stimme weiter */ }
  }
  function stilleVorlesen() { try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { } }
  function wendeEinstellungenAn() {
    document.documentElement.style.fontSize = (SKALA[EIN.schrift] * 100) + '%';
    if (S.el.app) S.el.app.setAttribute('data-kontrast', EIN.kontrast ? 'hoch' : 'normal');
  }

  // Zeitgeber, die leere() abbrechen kann
  function warte(ms) {
    var g = S.gen;
    return new Promise(function (res) {
      var t = setTimeout(function () { S.timer = S.timer.filter(function (x) { return x !== t; }); if (g === S.gen) res(); }, Math.max(0, ms));
      S.timer.push(t);
    });
  }

  // ---------- Aufbau ----------
  ui.init = function (rootEl) {
    S.root = rootEl || document.body;
    S.root.textContent = '';
    var el = S.el = {};

    el.app = h('div', { class: 'uk-app' });
    el.geraet = h('div', { class: 'uk-geraet' });
    el.app.appendChild(el.geraet);

    // Titel
    el.titel = h('section', { class: 'uk-bild uk-titel', 'aria-label': 'Titel' });

    // Chat
    el.chat = h('section', { class: 'uk-bild uk-chat', 'aria-label': 'Chat' });
    el.name = h('span', { class: 'uk-name', text: 'Mike' });
    el.statusText = h('span', { class: 'uk-status-text', text: 'online' });
    el.ort = h('span', { class: 'uk-ort' });
    el.status = h('span', { class: 'uk-status', 'data-status': 'online' }, [el.statusText, el.ort]);
    el.avatar = h('span', { class: 'uk-avatar', 'aria-hidden': 'true', text: 'M' });
    el.aktionen = h('div', { class: 'uk-aktionen' });
    el.menueKnopf = h('button', { class: 'uk-ikon', type: 'button', 'aria-label': 'Menü', 'aria-haspopup': 'dialog', html: SVG.menue, onclick: function () { ui.oeffneMenue(); } });
    el.aktionen.appendChild(el.menueKnopf);
    el.kopf = h('header', { class: 'uk-kopf' }, [
      h('button', { class: 'uk-person', type: 'button', 'aria-haspopup': 'dialog', 'aria-label': 'Kontakt und geteilte Medien', onclick: function () { ui.oeffneProfil(); } }, [el.avatar, h('span', { class: 'uk-person-text' }, [el.name, el.status])]),
      el.aktionen
    ]);
    // Spur (bewegt sich per transform) in einem Rahmen mit overflow:clip: die Verschiebung vergrössert nie den Scrollbereich
    el.innen = h('div', { class: 'uk-spur' });
    el.rahmen = h('div', { class: 'uk-verlauf-innen' }, [el.innen]);
    el.verlauf = h('div', { class: 'uk-verlauf', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions', 'aria-label': 'Nachrichtenverlauf', tabindex: '-1' }, [el.rahmen]);
    el.neu = h('button', { class: 'uk-neu-hinweis', type: 'button', text: 'Neue Nachrichten', tabindex: '-1', onclick: function () { zumBoden(true); } });
    el.untenInnen = h('div', { class: 'uk-unten-innen' }, [h('div', { class: 'uk-unten-ruhe' })]);
    el.unten = h('div', { class: 'uk-unten' }, [el.untenInnen]);
    el.mitte = h('div', { style: 'position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:column' }, [el.verlauf, el.neu]);
    el.schleier = h('div', { class: 'uk-schleier', onclick: function () { if (S.profilOffen) ui.schliesseProfil(); else ui.schliesseKarte(); } });
    el.karteTitelOrt = h('span');
    el.karteInhalt = h('div', { class: 'uk-blatt-inhalt' });
    el.karteZu = h('button', { class: 'uk-ikon', type: 'button', 'aria-label': 'Karte schliessen', html: SVG.zu, onclick: function () { ui.schliesseKarte(); } });
    el.karteKopf = h('div', { class: 'uk-blatt-kopf' }, [h('h2', { class: 'uk-blatt-titel', id: 'uk-karte-titel' }, ['Karte', el.karteTitelOrt]), el.karteZu]);
    el.blatt = h('div', { class: 'uk-blatt', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'uk-karte-titel' }, [el.karteKopf, el.karteInhalt]);
    el.chat.appendChild(el.kopf);
    el.chat.appendChild(el.mitte);
    el.chat.appendChild(h('div', { class: 'uk-unten-wrap' }, [el.unten]));
    el.chat.appendChild(el.schleier);
    el.chat.appendChild(el.blatt);
    // Kontaktprofil («Geteilte Medien»)
    el.profilInhalt = h('div', { class: 'uk-blatt-inhalt uk-profil' });
    el.profilZu = h('button', { class: 'uk-ikon', type: 'button', 'aria-label': 'Kontakt schliessen', html: SVG.zu, onclick: function () { ui.schliesseProfil(); } });
    el.profilBlatt = h('div', { class: 'uk-blatt uk-blatt--profil', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'uk-profil-titel' }, [
      h('div', { class: 'uk-blatt-kopf' }, [h('h2', { class: 'uk-blatt-titel', id: 'uk-profil-titel', text: 'Kontakt' }), el.profilZu]), el.profilInhalt]);
    el.chat.appendChild(el.profilBlatt);

    // Ende
    el.ende = h('section', { class: 'uk-bild uk-ende', 'aria-label': 'Ende' });

    // Menü
    el.menue = h('div', { class: 'uk-menue', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'uk-menue-titel' });

    el.geraet.appendChild(el.titel);
    el.geraet.appendChild(el.chat);
    el.geraet.appendChild(el.ende);
    el.geraet.appendChild(el.menue);
    S.root.appendChild(el.app);

    wendeEinstellungenAn();
    bindeVerlauf();
    bindeBlattZiehen();
    if (!S.tastenGebunden) { document.addEventListener('keydown', taste, true); document.addEventListener('pointerdown', function () { S.tastatur = false; }, true); S.tastenGebunden = true; }
    zeigeBild('chat');
    return ui;
  };

  function zeigeBild(name) {
    ['titel', 'chat', 'ende'].forEach(function (n) {
      var b = S.el[n]; var an = n === name;
      b.classList.toggle('ist-aktiv', an);
      if (an) b.removeAttribute('inert'); else b.setAttribute('inert', '');
      b.setAttribute('aria-hidden', an ? 'false' : 'true');
    });
    S.bild = name;
  }

  // ---------- Verlauf: Rollen ----------
  function istAmBoden() { var v = S.el.verlauf; return v.scrollHeight - v.scrollTop - v.clientHeight < 48; }
  function zumBoden(weich) {
    var v = S.el.verlauf;
    if (weich && !wenigBewegung && v.scrollTo) { v.scrollTo({ top: v.scrollHeight, behavior: 'smooth' }); S.weichBis = Date.now() + 900; } else v.scrollTop = v.scrollHeight;
    S.amBoden = true; S.el.neu.classList.remove('ist-sichtbar');
  }
  // unten bleiben: während ein weiches Rollen läuft, dessen Ziel nachführen (kein Sprung), sonst sofort + transform-Gleiten
  function bleibUnten(ref, vorher) {
    var v = S.el.verlauf;
    if (S.weichBis && Date.now() < S.weichBis && v.scrollTo) { v.scrollTo({ top: v.scrollHeight, behavior: 'smooth' }); S.weichBis = Date.now() + 900; }
    else { v.scrollTop = v.scrollHeight; gleite(ref, vorher); }
    S.amBoden = true;
  }
  function bindeVerlauf() {
    var v = S.el.verlauf;
    // Nur echtes Scrollen durch den Spieler löst «nicht mehr unten» aus (FLIP-Verschiebung zählt nicht)
    var nutzer = 0;
    ['wheel', 'touchmove', 'pointerdown', 'keydown'].forEach(function (t) { v.addEventListener(t, function () { nutzer = Date.now(); }, { passive: true }); });
    v.addEventListener('scroll', function () {
      if (istAmBoden()) { S.amBoden = true; S.el.neu.classList.remove('ist-sichtbar'); }
      else if (Date.now() - nutzer < 1200) S.amBoden = false;
    }, { passive: true });
    if (window.ResizeObserver) {
      // Wenn der Antwortbereich, ein Bild oder die Schrift die Höhe ändert: unten kleben bleiben und weich gleiten
      var ro = new ResizeObserver(function () {
        if (!S.amBoden) return;
        var ref = anker(), vorher = ref ? ref.getBoundingClientRect().top : 0;
        bleibUnten(ref, vorher);
      });
      ro.observe(v); ro.observe(S.el.innen);
    }
  }
  // Letztes bleibendes Element (keine Lücke, keine Tipp-Blase): daran wird die Bewegung gemessen
  function anker() {
    var c = S.el.innen.lastElementChild;
    while (c && c.classList && (c.classList.contains('uk-luecke') || c.classList.contains('uk-tippt'))) c = c.previousElementSibling;
    return c;
  }
  function spurY() {
    var tf = getComputedStyle(S.el.innen).transform;
    if (!tf || tf === 'none') return 0;
    var m = tf.match(/matrix(3d)?\(([^)]+)\)/); if (!m) return 0;
    var w = m[2].split(','); return parseFloat(w[m[1] ? 13 : 5]) || 0;
  }
  // FLIP nur mit transform: was sich in der Lage verschoben hat, gleitet von der alten Stelle weich an die neue.
  // Eine laufende Bewegung wird übernommen (kein Ruck, wenn mehrere Nachrichten kurz nacheinander kommen).
  var GLEIT_ADD = !!(window.KeyframeEffect && 'composite' in window.KeyframeEffect.prototype && Element.prototype.animate);
  function gleite(ref, vorher) {
    if (!ref || !ref.parentNode || wenigBewegung) return;
    var d = vorher - ref.getBoundingClientRect().top;
    if (Math.abs(d) < 0.5) return;
    var spur = S.el.innen;
    // Bevorzugt: additive Web-Animation. Jede Bewegung kommt dazu, laufende bleiben unberührt (kein Neustart, kein Ruck)
    if (GLEIT_ADD) {
      try {
        // weite Wege (Bild lädt, grosser Antwortbereich) etwas länger, damit der Anfang nicht hastig wirkt
        spur.animate([{ transform: 'translateY(' + d.toFixed(2) + 'px)' }, { transform: 'translateY(0)' }], { duration: Math.round(klemme(400 + Math.abs(d) * 1.2, 460, 820)), easing: 'cubic-bezier(.25,.6,.25,1)', composite: 'add' });
        return;
      } catch (e) { GLEIT_ADD = false; }
    }
    var y = spurY() + d;
    spur.style.transition = 'none';
    spur.style.transform = 'translateY(' + y.toFixed(2) + 'px)';
    void spur.offsetHeight;
    spur.style.transition = 'transform 520ms cubic-bezier(.2,.7,.2,1)';
    spur.style.transform = '';
  }
  // Platzhalter gleicher Höhe: wenn etwas verschwindet (Tipp-Blase, Antwortbereich), springt nichts; das nächste Element ersetzt ihn
  function luecke(px) { var l = h('div', { class: 'uk-luecke', 'aria-hidden': 'true' }); l.style.height = Math.max(0, px) + 'px'; return l; }
  function entferneLuecken() { [].slice.call(S.el.innen.querySelectorAll(':scope > .uk-luecke')).forEach(function (l) { l.parentNode.removeChild(l); }); }
  // Fügt ein Element an und rollt weich nach (FLIP: alter Inhalt gleitet hoch)
  function anhaengen(node, ersetze) {
    var v = S.el.verlauf, innen = S.el.innen;
    var warUnten = S.amBoden;
    var letzte = innen.lastElementChild;
    if (!(ersetze && ersetze.parentNode === innen) && letzte && (letzte.classList.contains('uk-luecke') || (letzte.classList.contains('uk-tippt') && letzte.classList.contains('ist-weg')))) ersetze = letzte;
    var ref = anker();
    if (ersetze && ersetze.parentNode === innen && ref === ersetze) ref = ersetze.previousElementSibling;
    var vorher = ref ? ref.getBoundingClientRect().top : 0;
    if (ersetze && ersetze.parentNode === innen) { innen.replaceChild(node, ersetze); entferneLuecken(); }
    else innen.appendChild(node);
    if (warUnten) {
      bleibUnten(ref, vorher);
    } else if (node.classList && !node.classList.contains('uk-tippt')) {
      S.el.neu.classList.add('ist-sichtbar');
    }
  }

  // ---------- Bottom-Bereich: Höhe wechselt ohne Layout-Animation, der Verlauf gleitet per transform ----------
  function setzeUnten(inhalt) {
    var u = S.el.unten, v = S.el.verlauf;
    var warUnten = S.amBoden;
    var alt = S.el.untenInnen.offsetHeight;
    var ref = anker(), vorher = ref ? ref.getBoundingClientRect().top : 0;
    // neu einsetzen statt umbauen: ein neues Element erscheint, kein bestehendes verschiebt sich (CLS 0)
    var innen = h('div', { class: 'uk-unten-innen' }, [inhalt || h('div', { class: 'uk-unten-ruhe' })]);
    u.replaceChild(innen, S.el.untenInnen);
    S.el.untenInnen = innen;
    var neu = innen.offsetHeight;
    if (inhalt) entferneLuecken();
    else if (warUnten && alt - neu > 0.5) S.el.innen.appendChild(luecke(alt - neu)); // Platz halten, bis die nächste Nachricht kommt
    if (warUnten) bleibUnten(ref, vorher);
  }

  // ---------- Titel ----------
  ui.showTitle = ui.zeigeTitel = function (opt) {
    opt = opt || {};
    var t = S.el.titel; t.textContent = '';
    ui.schliesseMenue(true); ui.schliesseKarte(); ui.schliesseProfil(); stilleVorlesen();
    var kopf = h('div', { class: 'uk-titel-kopf uk-langsam' }, [
      h('h1', { class: 'uk-titel-name', text: 'UNKNOWN' }),
      h('p', { class: 'uk-titel-satz', text: 'Mike schreibt dir. Bleib bei ihm.' }),
      h('div', { class: 'uk-titel-linie', 'aria-hidden': 'true' })
    ]);
    var wahl = h('div', { class: 'uk-titel-wahl uk-langsam' });
    if (opt.hatSpielstand) {
      wahl.appendChild(h('button', { class: 'uk-knopf uk-fortsetzen', type: 'button', text: 'Fortsetzen', onclick: function () { if (opt.onFortsetzen) opt.onFortsetzen(); } }));
      wahl.appendChild(h('p', { class: 'uk-titel-label', style: 'margin-top:1rem', text: 'Neu beginnen' }));
    } else {
      wahl.appendChild(h('p', { class: 'uk-titel-label', id: 'uk-tempo-label', text: 'Tempo wählen' }));
    }
    MODI.slice(0, 2).forEach(function (m) {
      wahl.appendChild(h('button', {
        class: 'uk-wahl', type: 'button',
        onclick: function () { ui.setModus(m.id); if (opt.onStart) opt.onStart(m.id); }
      }, [h('span', { class: 'uk-wahl-name', text: m.name }), h('span', { class: 'uk-wahl-text', text: m.id === 'schnell' ? 'Wartezeiten stark gekürzt, Mike tippt zügig. Etwa anderthalb Stunden.' : 'Mike tippt in echter Geschwindigkeit, Pausen dauern wirklich (bis zu anderthalb Minuten am Stück). Deutlich länger.' })]));
    });
    var knoepfe = h('div', { class: 'uk-titel-knoepfe' }, [
      h('button', { class: 'uk-knopf uk-knopf--leise', type: 'button', text: 'Einstellungen', onclick: function () { ui.oeffneMenue({ nurDarstellung: true }); } })
    ]);
    // Enden-Archiv: erst sichtbar, wenn ein Ende erreicht wurde
    var ar = opt.archiv;
    if (ar && ar.erreicht > 0) knoepfe.insertBefore(h('button', { class: 'uk-knopf uk-knopf--leise', type: 'button', text: 'Enden ' + ar.erreicht + ' / ' + ar.gesamt, onclick: function () { ui.zeigeArchiv(ar.liste || []); } }), knoepfe.firstChild);
    var fuss = h('div', { class: 'uk-titel-fuss' }, [
      h('p', { class: 'uk-hinweis', text: 'Inhaltshinweis: psychischer Horror, Bedrohung, Isolation, Andeutungen von Gewalt. Ohne Ton. Das Tempo lässt sich im Menü jederzeit ändern.' }),
      knoepfe
    ]);
    t.appendChild(kopf); t.appendChild(wahl); t.appendChild(fuss);
    zeigeBild('titel');
    setTimeout(function () { var b = t.querySelector('button'); if (b && S.tastatur) b.focus({ preventScroll: true }); }, 50);
  };

  // ---------- Kontakt, Ort ----------
  ui.setKontakt = function (name, status, opt) {
    if (name) { S.el.name.textContent = name; S.el.avatar.textContent = String(name).charAt(0).toUpperCase(); }
    if (opt && opt.zuletzt) S.zuletzt = opt.zuletzt;
    if (status) setStatus(status);
  };
  ui.kontakt = function () { return S.el.name ? S.el.name.textContent : ''; };
  // Erzählte Uhrzeit «HH:MM» (von der Engine): Zeit für «Gelesen» und «zuletzt online»
  ui.setZeit = function (zeit) { if (!zeit) return; S.jetzt = zeit; if (S.status !== 'weg') S.zuletzt = zeit; };
  // Ende ohne weitere Nachricht des Kontakts: Kopfzeile bleibt «zuletzt online», letzte eigene Nachricht bleibt «Zugestellt»
  ui.friereStatus = function (an) { S.gefroren = !!an; if (an) setStatus('weg', true); };
  function setStatus(status, erzwingen) {
    if (S.gefroren && !erzwingen) return;
    if (status !== 'weg' && S.jetzt) S.zuletzt = S.jetzt;
    S.status = status;
    var z = S.zuletzt || S.letzteZeit;
    var txt = status === 'schreibt' ? 'schreibt …' : status === 'weg' ? (z ? 'zuletzt online ' + z : 'zuletzt online vor kurzem') : 'online';
    S.el.status.setAttribute('data-status', status);
    S.el.statusText.textContent = txt;
  }
  ui.setOrt = function (ortId) {
    S.ortId = ortId;
    var name = ortName(ortId);
    var o = S.el.ort;
    if (o.textContent === name) return;
    o.classList.add('ist-neu');
    setTimeout(function () { o.textContent = name; o.classList.remove('ist-neu'); }, wenigBewegung ? 0 : 350);
    S.el.karteTitelOrt.textContent = name;
    if (S.el.karteKnopf) S.el.karteKnopf.setAttribute('aria-label', name ? 'Karte, Mike ist: ' + name : 'Karte');
  };
  function ortName(id) {
    if (!id) return '';
    var orte = (UK.story && UK.story.orte) || [];
    for (var i = 0; i < orte.length; i++) if (orte[i].id === id) return orte[i].name || id;
    if (id === 'unbekannt') return '';
    return id.charAt(0).toUpperCase() + id.slice(1);
  }

  // ---------- Nachrichten ----------
  function neueMsg(n) {
    var von = n.von || 'mike';
    if (von === 'system') return h('p', { class: 'uk-system ist-neu', text: n.text || '' });
    var folge = S.letzteVon === von && S.letzteMsg && S.letzteMsg.parentNode;
    var m = h('div', { class: 'uk-msg von-' + von + ' ist-neu ist-letzte' + (folge ? ' ist-folge' : '') + (n.art === 'medium' ? ' art-medium' : '') });
    var wer = von === 'ich' ? 'Du' : S.el.name.textContent;
    var sprecher = n.sprecher || (von === 'ethan' ? 'Ethan' : '');
    if (sprecher && !(folge && S.letzteSprecher === sprecher)) m.appendChild(h('p', { class: 'uk-absender', 'aria-hidden': 'true', text: sprecher }));
    if (sprecher) wer = sprecher;
    S.letzteSprecher = sprecher;
    var blase;
    if (n.art === 'medium') {
      blase = h('div', { class: 'uk-medium' });
      if (n.mediumEl instanceof window.Node) blase.appendChild(n.mediumEl);
      else blase.appendChild(h('p', { class: 'uk-blase', text: n.text || 'Medium' }));
    } else {
      blase = h('div', { class: 'uk-blase', text: n.text || '' });
    }
    m.appendChild(h('span', { class: 'uk-sr', text: wer + ': ' }));
    m.appendChild(blase);
    var meta = h('div', { class: 'uk-meta', 'aria-hidden': 'true' });
    if (n.zeit) meta.appendChild(h('time', { text: n.zeit }));
    if (von === 'ich') {
      // Zustellstatus nur unter der jeweils letzten eigenen Nachricht, nur Text
      if (S.letzteIch) { var alt = S.letzteIch.querySelector('.uk-zustellung'); if (alt) alt.parentNode.removeChild(alt); }
      meta.appendChild(h('span', { class: 'uk-zustellung', text: 'Gesendet' }));
      S.letzteIch = m; S.zustellung = 'gesendet';
    } else if (von !== 'system' && n.zeit) S.zuletzt = n.zeit;
    m.appendChild(meta);
    if (folge) { S.letzteMsg.classList.remove('ist-letzte'); S.letzteMsg.classList.add('hat-folge'); }
    S.letzteVon = von; S.letzteMsg = m;
    if (n.zeit) S.letzteZeit = n.zeit;
    setTimeout(function () { m.classList.remove('ist-neu'); }, 600);
    return m;
  }
  function setzeZustellung(stufe, text) {
    S.zustellung = stufe;
    var e = S.letzteIch && S.letzteIch.querySelector('.uk-zustellung');
    if (e) e.textContent = text;
  }
  function markiereZugestellt() { if (S.zustellung === 'gesendet') setzeZustellung('zugestellt', 'Zugestellt'); }
  // Mike liest: «Gelesen HH:MM» (nie bei eingefrorenem Status, z. B. Ende 5)
  function markiereGelesen(zeit, sofort) {
    if (S.gefroren || !S.letzteIch || S.zustellung === 'gelesen' || S.zustellung === 'liest') return;
    var z = zeit || S.jetzt || S.letzteZeit, m = S.letzteIch;
    function gelesen() {
      if (S.gefroren || S.letzteIch !== m) return;
      m.classList.add('ist-gelesen');
      setzeZustellung('gelesen', 'Gelesen' + (z ? ' ' + z : ''));
    }
    // Reihenfolge bleibt sichtbar: erst «Zugestellt», einen Atemzug später «Gelesen»
    if (S.zustellung === 'gesendet' && !sofort && !wenigBewegung) { setzeZustellung('liest', 'Zugestellt'); var g = S.gen; setTimeout(function () { if (g === S.gen) gelesen(); }, 450); }
    else gelesen();
  }
  // Datumszeile über der ersten Nachricht (erzählter Tag)
  function datum() {
    if (!S.el.innen || S.el.innen.firstChild) return;
    var tag = (UK.story && UK.story.meta && UK.story.meta.tag) || 'Samstag';
    S.el.innen.appendChild(h('p', { class: 'uk-tag', text: tag }));
    if (S.amBoden) S.el.verlauf.scrollTop = S.el.verlauf.scrollHeight; // steht sofort, gleitet nicht herein
  }

  // Tippdauer je Modus (Realismus: 35–60 ms pro Zeichen, Denkpause)
  function tippPlan(text, modus) {
    var n = (text || '').length || 12;
    if (modus === 'direkt') return [];
    if (modus === 'realismus') {
      var gesamt = klemme(n * zufall(35, 60) + zufall(500, 1400), 900, 14000);
      if (gesamt > 2600 && Math.random() < 0.4) { var a = gesamt * zufall(0.35, 0.6); return [a, -zufall(900, 2200), gesamt - a]; }
      return [gesamt];
    }
    return [klemme(360 + n * 13, 520, 1700) * zufall(0.85, 1.15)];
  }

  ui.addNachricht = function (n) {
    n = n || {};
    var g = S.gen, von = n.von || 'mike';
    if (!S.el.innen) return Promise.resolve();
    datum();
    if (n.aufbau) {
      // Spielstand wird wiederaufgebaut: ohne Bewegung, unten bleiben
      var a = n.pause ? pauseEl(n.text || '', null) : neueMsg(n);
      if (n.pause) { a.classList.add('ist-fertig'); S.letzteVon = null; S.letzteMsg = null; }
      a.classList.remove('ist-neu');
      S.el.innen.appendChild(a);
      if (S.amBoden) S.el.verlauf.scrollTop = S.el.verlauf.scrollHeight;
      if (von === 'ich') markiereZugestellt();
      else if (von !== 'system' && !n.pause) markiereGelesen(n.zeit, true);
      return Promise.resolve();
    }
    if (von !== 'ich') vorlesen(n.art === 'medium' ? (n.text || '') : n.text);
    if (von === 'ich' || von === 'system' || n.sofort) {
      var m = neueMsg(n);
      var blase = von !== 'ich' && von !== 'system' && S.tippEl && S.tippEl.parentNode ? S.tippEl : null;
      if (blase) { clearTimeout(S.tippWegT); S.tippEl = null; anhaengen(m, blase); } else anhaengen(m);
      if (von !== 'ich' && von !== 'system') markiereGelesen(n.zeit);
      if (von === 'ich') { var g2 = S.gen; setTimeout(function () { if (g2 === S.gen && S.letzteIch === m) markiereZugestellt(); }, 350); }
      return warte(von === 'ich' ? 160 : 60);
    }
    var plan = tippPlan(n.text, S.modus);
    var p = Promise.resolve();
    if (S.modus === 'direkt') { p = warte(40); }
    plan.forEach(function (ms) {
      p = p.then(function () {
        if (g !== S.gen) return;
        if (ms < 0) { ui.setTippt(von, false); return warte(-ms); }
        ui.setTippt(von, true); return warte(ms);
      });
    });
    return p.then(function () {
      if (g !== S.gen) return new Promise(function () { });
      var m = neueMsg(n);
      var alt = S.tippEl && S.tippEl.parentNode ? S.tippEl : null;
      S.tippEl = null;
      if (alt) {
        // Folge-Status aus Tipp-Blase übernehmen
        anhaengen(m, alt);
      } else anhaengen(m);
      markiereGelesen(n.zeit);
      if (S.status === 'schreibt') setStatus('online');
      return warte(S.modus === 'direkt' ? 30 : S.modus === 'realismus' ? zufall(250, 700) : 180);
    });
  };

  function entferneTipp() {
    clearTimeout(S.tippWegT);
    if (S.tippEl && S.tippEl.parentNode) S.tippEl.parentNode.removeChild(S.tippEl);
    S.tippEl = null;
  }
  ui.setTippt = function (von, an) {
    von = von || 'mike';
    if (von === 'ich' || von === 'system') return;
    if (an) {
      datum();
      markiereGelesen();
      setStatus('schreibt');
      clearTimeout(S.tippWegT);
      if (S.tippEl && S.tippEl.parentNode) return;
      var folge = S.letzteVon === von && S.letzteMsg && S.letzteMsg.parentNode;
      var t = h('div', { class: 'uk-msg uk-tippt von-' + von + ' ist-neu' + (folge ? ' ist-folge' : ''), 'aria-hidden': 'true' }, [
        h('div', { class: 'uk-blase' }, [h('span', { class: 'uk-punkt' }), h('span', { class: 'uk-punkt' }), h('span', { class: 'uk-punkt' })])
      ]);
      if (folge) { S.letzteMsg.classList.add('hat-folge'); }
      S.tippEl = t; S.tippVon = von;
      anhaengen(t);
    } else {
      if (S.status === 'schreibt') setStatus('online');
      if (S.tippEl && S.tippEl.parentNode) {
        var alt = S.tippEl, g = S.gen;
        clearTimeout(S.tippWegT);
        S.tippWegT = setTimeout(function () {
          if (g !== S.gen || S.tippEl !== alt || !alt.parentNode) return;
          S.tippEl = null;
          if (S.letzteMsg && alt.previousElementSibling === S.letzteMsg) S.letzteMsg.classList.remove('hat-folge');
          // Blase blendet aus, ihr Platz bleibt als Lücke: nichts rutscht; die nächste Blase oder Nachricht ersetzt die Lücke
          var hoch = alt.getBoundingClientRect().height + (parseFloat(getComputedStyle(alt).marginTop) || 0);
          alt.classList.add('ist-weg');
          setTimeout(function () { if (alt.parentNode) alt.parentNode.replaceChild(luecke(hoch), alt); }, wenigBewegung ? 0 : 200);
        }, 90);
      }
    }
  };

  // ---------- Antworten ----------
  ui.zeigeAntworten = function (liste, opt) {
    opt = opt || {};
    liste = (liste || []).slice(0, 9);
    var g = S.gen;
    if (S.antwort) { S.antwort.abbrechen(); }
    return new Promise(function (resolve) {
      var box = h('div', { class: 'uk-antworten' + (wenigBewegung ? '' : ' ist-ein'), role: 'group', 'aria-label': 'Antwort wählen' });
      var frist = null, fristT = null, fertig = false;
      // Zählt die Engine die Frist (opt.frist), zeigt die UI keinen Zähler und läuft nicht selbst ab:
      // Mike bleibt «online», nach Ablauf ruft die Engine versteckeAntworten() (FUNKTIONEN.md 9).
      var sek = opt.frist ? 0 : (Number(opt.stilleSekunden) || 0);
      if (opt.frist) box.setAttribute('aria-description', 'Mike wartet nicht ewig.');
      if (sek > 0) {
        var balken = h('span');
        frist = h('div', { class: 'uk-frist', role: 'presentation' }, [balken]);
        box.appendChild(frist);
        box.setAttribute('aria-description', 'Mike wartet nicht ewig.');
      }
      if (opt.hinweis) box.appendChild(h('p', { class: 'uk-antwort-hinweis', text: opt.hinweis }));
      var knoepfe = liste.map(function (a, i) {
        var still = !!a.still;
        var b = h('button', {
          class: 'uk-antwort' + (still ? ' uk-antwort--still' : ''), type: 'button', 'data-id': a.id,
          'aria-keyshortcuts': String(i + 1),
          onclick: function () { waehle(i); }
        }, [h('span', { class: 'uk-antwort-nr', 'aria-hidden': 'true', text: String(i + 1) }),
        h('span', { class: 'uk-antwort-text', text: a.text || (still ? 'Nichts schreiben' : '…') })]);
        if (still) b.setAttribute('aria-label', (a.text || 'Nichts schreiben') + ' (schweigen, sendet nichts)');
        box.appendChild(b);
        return b;
      });
      function ende(wert, idx) {
        if (fertig) return; fertig = true;
        clearTimeout(fristT);
        S.antwort = null;
        if (g !== S.gen) return;
        box.classList.add('ist-gewaehlt');
        if (idx != null && knoepfe[idx]) knoepfe[idx].classList.add('ist-gewaehlt');
        if (frist) frist.style.opacity = '0';
        var verzug = wenigBewegung ? 0 : 260;
        setTimeout(function () {
          if (g !== S.gen) return;
          if (S.el.untenInnen.contains(box)) { setzeUnten(null); }
          resolve(wert);
        }, verzug);
      }
      function waehle(i) { if (fertig) return; if (!S.amBoden) zumBoden(true); ende({ id: liste[i].id }, i); } // eigene Antwort: weich zurück nach unten
      S.antwort = { waehle: waehle, knoepfe: knoepfe, verstecke: function () { ende(null, null); }, abbrechen: function () { fertig = true; clearTimeout(fristT); S.antwort = null; } };
      setzeUnten(box);
      if (frist) {
        var b = frist.firstChild;
        b.style.transform = 'scaleX(1)';
        void b.offsetWidth;
        b.style.transition = 'transform ' + sek + 's linear';
        b.style.transform = 'scaleX(0)';
        fristT = setTimeout(function () { ende(null, null); }, sek * 1000);
        S.timer.push(fristT);
      }
      if (S.tastatur && knoepfe[0]) setTimeout(function () { if (!fertig) knoepfe[0].focus({ preventScroll: true }); }, 80);
    });
  };

  // Frist abgelaufen (Engine): Antworten sinken zurück, nichts wird gesendet
  ui.versteckeAntworten = function () { if (S.antwort && S.antwort.verstecke) S.antwort.verstecke(); };

  // ---------- Pause ----------
  function zeitText(sek) {
    sek = Math.max(0, Math.round(sek || 0));
    if (sek < 60) return (sek === 1 ? 'Eine Sekunde' : sek + ' Sekunden') + ' später';
    var min = Math.round(sek / 60);
    if (min < 60) return (min === 1 ? 'Eine Minute' : min + ' Minuten') + ' später';
    var std = Math.round(sek / 360) / 10;
    return (std === 1 ? 'Eine Stunde' : String(std).replace('.', ',') + ' Stunden') + ' später';
  }
  function pausenDauer(sek, modus) {
    sek = Number(sek) || 0;
    if (modus === 'direkt') return 700;
    if (modus === 'realismus') return klemme(sek, 1, 90) * 1000;
    return klemme(2000 + sek * 25, 2000, 4000);
  }
  // p: { text, sekunden, modus } (+ von der Engine: dauer ms, erzaehlt s, grund). text = Zeitzeile, grund = leiser Zusatz.
  function pauseEl(label, grund) {
    var linie = h('div', { class: 'uk-pause-linie', 'aria-hidden': 'true' }, [h('span')]);
    var kinder = [h('p', { class: 'uk-pause-zeit', text: label })];
    void grund; // «grund» ist eine Autorenbeschreibung aus der Spielstruktur und wird NIE angezeigt; sichtbar bleibt nur die Zeitzeile
    kinder.push(linie);
    return h('div', { class: 'uk-pause', role: 'note' }, kinder);
  }
  ui.zeigePause = function (p) {
    p = p || {};
    var modus = p.modus || S.modus;
    var dauer = typeof p.dauer === 'number' ? p.dauer : pausenDauer(p.sekunden, modus);
    var erzaehlt = p.erzaehlt != null ? p.erzaehlt : p.sekunden;
    var label = p.text && String(p.text).trim() ? p.text : zeitText(erzaehlt);
    var el = pauseEl(label, p.grund);
    var linie = el.lastChild;
    var tippAlt = S.tippEl && S.tippEl.parentNode ? S.tippEl : null; // Zeitzeile ersetzt die Tipp-Blase: nichts springt
    clearTimeout(S.tippWegT); S.tippEl = null;
    datum();
    anhaengen(el, tippAlt);
    S.letzteVon = null; S.letzteMsg = null;
    var bar = linie.firstChild;
    void bar.offsetWidth;
    bar.style.transition = 'transform ' + dauer + 'ms linear';
    bar.style.transform = 'scaleX(1)';
    return warte(dauer).then(function () { el.classList.add('ist-fertig'); });
  };

  // ---------- Ende ----------
  ui.zeigeEnde = function (e) {
    e = e || {};
    var gesamt, gefunden;
    if (e.sammlung && Array.isArray(e.sammlung.ids)) { gefunden = e.sammlung.ids; gesamt = e.sammlung.gesamt || 5; }
    else {
      gesamt = (UK.story && UK.story.meta && UK.story.meta.enden) || 5;
      gefunden = lesen('uk.enden', []);
      if (!Array.isArray(gefunden)) gefunden = [];
      if (e.id && gefunden.indexOf(e.id) < 0) { gefunden.push(e.id); schreiben('uk.enden', gefunden); }
    }
    ui.schliesseMenue(true); ui.schliesseKarte(); ui.schliesseProfil();
    var box = S.el.ende; box.textContent = '';
    var innen = h('div', { class: 'uk-ende-innen uk-langsam' });
    innen.appendChild(h('div', null, [
      h('p', { class: 'uk-ende-kicker', text: e.kopf || 'Ende' }),
      h('h1', { class: 'uk-ende-titel', text: e.titel || '' })
    ]));
    var text = h('div', { class: 'uk-ende-text' }); text.appendChild(absaetze(e.einleitung));
    innen.appendChild(text);
    var nw = h('div');
    if (e.nachwort) {
      nw.appendChild(h('hr', { class: 'uk-ende-trenner' }));
      var nwt = h('div', { class: 'uk-ende-nachwort' }); nwt.appendChild(absaetze(e.nachwort)); nw.appendChild(nwt);
      if (e.absender) nw.appendChild(h('p', { class: 'uk-ende-absender', text: '— ' + e.absender }));
    }
    innen.appendChild(nw);
    if (e.schlussbild && typeof e.schlussbild === 'object') innen.appendChild(albumEl(e.schlussbild));
    else if (e.schlussbild) {
      var fig = h('figure', { class: 'uk-schlussbild' }, [h('figcaption', { text: 'Schlussbild' })]);
      fig.appendChild(absaetze(e.schlussbild));
      innen.appendChild(fig);
    } else innen.appendChild(h('div'));
    var punkte = h('span', { class: 'uk-ende-punkte', 'aria-hidden': 'true' });
    for (var i = 0; i < gesamt; i++) punkte.appendChild(h('i', { class: i < gefunden.length ? 'ist-gefunden' : null }));
    innen.appendChild(h('div', { class: 'uk-ende-fuss' }, [
      h('p', { class: 'uk-ende-zaehler' }, [punkte, h('span', { text: Math.min(gefunden.length, gesamt) + ' von ' + gesamt + ' Enden' })]),
      h('div', { class: 'uk-ende-knoepfe' }, [
        h('button', { class: 'uk-knopf', type: 'button', text: 'Nochmal', onclick: function () { if (e.onNochmal) e.onNochmal(); } }),
        h('button', { class: 'uk-knopf uk-knopf--leise', type: 'button', text: 'Zurück zum Titel', onclick: function () { if (e.onZurueck) e.onZurueck(); } })
      ])
    ]));
    box.appendChild(innen);
    box.scrollTop = 0;
    zeigeBild('ende');
    if (S.antwort) S.antwort.abbrechen();
    setTimeout(function () { var t = box.querySelector('h1'); if (t) { t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); } }, 400);
  };

  // Albumseite aus Raffis Ende (Name und leeres Feld, Wortlaut aus den Daten)
  function albumEl(a) {
    return h('div', { class: 'uk-album' }, [
      h('p', { class: 'uk-album-name', text: a.name || '' }),
      h('div', { class: 'uk-album-feld' }, [h('span', { text: a.leeresFeld || '' })])
    ]);
  }

  // ---------- Menü ----------
  ui.setHooks = function (hooks) { for (var k in hooks) S.hooks[k] = hooks[k]; };
  function hook(name) {
    if (S.hooks[name]) return S.hooks[name];
    var en = UK.engine;
    if (!en) return null;
    if (name === 'onModus' && en.setModus) return function (m) { en.setModus(m); };
    if (name === 'onSpeichern' && en.speichern) return function (s) { return en.speichern(s); };
    if (name === 'onLaden' && en.laden) return function (s) { return en.laden(s); };
    if (name === 'onUeberspringen' && en.ueberspringeBisEntscheidung) return function () { en.ueberspringeBisEntscheidung(); };
    return null;
  }
  ui.setModus = function (m) {
    if (['schnell', 'realismus', 'direkt'].indexOf(m) < 0) return;
    S.modus = m; speichereEinstellungen();
  };
  ui.modus = function () { return S.modus; };

  function segment(name, optionen, aktiv, wenn) {
    var seg = h('div', { class: 'uk-segment', role: 'radiogroup', 'aria-label': name, style: '--n:' + optionen.length });
    optionen.forEach(function (o, i) {
      var b = h('button', { type: 'button', role: 'radio', 'aria-checked': o.id === aktiv ? 'true' : 'false', tabindex: o.id === aktiv ? '0' : '-1', text: o.name });
      b.addEventListener('click', function () { setze(i); });
      b.addEventListener('keydown', function (ev) {
        var d = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
        if (!d) return; ev.preventDefault(); ev.stopPropagation();
        var j = (i + d + optionen.length) % optionen.length; setze(j); seg.children[j].focus();
      });
      seg.appendChild(b);
    });
    function setze(i) {
      for (var j = 0; j < seg.children.length; j++) { seg.children[j].setAttribute('aria-checked', j === i ? 'true' : 'false'); seg.children[j].setAttribute('tabindex', j === i ? '0' : '-1'); }
      wenn(optionen[i].id);
    }
    return seg;
  }
  function schalter(label, an, wenn, gesperrt) {
    var s = h('button', { class: 'uk-schalter', type: 'button', role: 'switch', 'aria-checked': an ? 'true' : 'false', 'aria-label': label, disabled: !!gesperrt });
    s.addEventListener('click', function () { var neu = s.getAttribute('aria-checked') !== 'true'; s.setAttribute('aria-checked', neu ? 'true' : 'false'); wenn(neu); });
    return s;
  }
  function slotInfo(i) {
    var slots = lesen('uk.ui.slots', {}) || {};
    var s = slots[i];
    if (!s) {
      var hat = S.hooks.hatSlot ? S.hooks.hatSlot(i) : false;
      return hat ? 'gespeichert' : 'leer';
    }
    return s.zeit + (s.ort ? ' · ' + s.ort : '');
  }

  ui.oeffneMenue = function (opt) {
    opt = opt || {};
    var nurDarstellung = !!opt.nurDarstellung || S.bild === 'titel';
    var m = S.el.menue; m.textContent = '';
    var rueck = h('p', { class: 'uk-rueckmeldung', 'aria-live': 'polite' });
    function melde(t) { rueck.textContent = t; clearTimeout(S.meldeT); S.meldeT = setTimeout(function () { rueck.textContent = ''; }, 3200); }

    m.appendChild(h('div', { class: 'uk-menue-kopf' }, [
      h('h2', { class: 'uk-menue-titel', id: 'uk-menue-titel', text: nurDarstellung ? 'Einstellungen' : 'Menü' }),
      h('button', { class: 'uk-ikon', type: 'button', 'aria-label': 'Menü schliessen', html: SVG.zu, onclick: function () { ui.schliesseMenue(); } })
    ]));
    var inhalt = h('div', { class: 'uk-menue-inhalt' });

    if (!nurDarstellung) {
      // Tempo
      var erkl = h('p', { class: 'uk-erklaerung' });
      var aktiv = MODI.filter(function (x) { return x.id === S.modus; })[0] || MODI[0];
      erkl.textContent = aktiv.text;
      var tempo = h('div', { class: 'uk-gruppe' }, [
        h('h3', { class: 'uk-gruppe-titel', text: 'Tempo' }),
        segment('Tempo', MODI.map(function (x) { return { id: x.id, name: x.id === 'schnell' ? 'Schnell' : x.name }; }), S.modus, function (id) {
          ui.setModus(id);
          var f = hook('onModus'); if (f) f(id);
          erkl.textContent = MODI.filter(function (x) { return x.id === id; })[0].text;
        }),
        erkl
      ]);
      var ueb = hook('onUeberspringen');
      if (ueb) tempo.appendChild(h('div', { class: 'uk-zeile', style: 'margin-top:0.5rem' }, [
        h('div', { class: 'uk-zeile-text' }, [h('p', { class: 'uk-zeile-name', text: 'Bis zur nächsten Entscheidung' }), h('p', { class: 'uk-zeile-info', text: 'Alles bis dahin sofort zeigen.' })]),
        h('button', { class: 'uk-knopf uk-klein', type: 'button', text: 'Weiter', onclick: function () { ui.schliesseMenue(); ueb(); } })
      ]));
      inhalt.appendChild(tempo);

      // Spielstand
      var sp = h('div', { class: 'uk-gruppe' }, [h('h3', { class: 'uk-gruppe-titel', text: 'Spielstand' })]);
      var fSp = hook('onSpeichern'), fLa = hook('onLaden');
      [1, 2, 3].forEach(function (i) {
        var info = h('p', { class: 'uk-zeile-info', text: slotInfo(i) });
        var laden = h('button', { class: 'uk-knopf uk-klein uk-knopf--leise', type: 'button', text: 'Laden', disabled: !fLa || info.textContent === 'leer' });
        var speichern = h('button', { class: 'uk-knopf uk-klein', type: 'button', text: 'Speichern', disabled: !fSp });
        speichern.addEventListener('click', function () {
          Promise.resolve(fSp && fSp('slot' + i)).then(function (ok) {
            if (ok === false) { melde('Speichern ist in diesem Browser nicht möglich.'); return; }
            var slots = lesen('uk.ui.slots', {}) || {};
            var d = new Date();
            var zeit = ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '. ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
            slots[i] = { zeit: zeit, ort: ortName(S.ortId) };
            schreiben('uk.ui.slots', slots);
            info.textContent = slotInfo(i); laden.disabled = !fLa;
            melde('Gespeichert auf Platz ' + i + '.');
          });
        });
        laden.addEventListener('click', function () {
          Promise.resolve(fLa && fLa('slot' + i)).then(function (ok) {
            if (ok === false) { melde('Dieser Spielstand liess sich nicht laden.'); return; }
            ui.schliesseMenue();
          });
        });
        sp.appendChild(h('div', { class: 'uk-zeile' }, [
          h('div', { class: 'uk-zeile-text' }, [h('p', { class: 'uk-zeile-name', text: 'Platz ' + i }), info]),
          h('div', { class: 'uk-zeile-knoepfe' }, [laden, speichern])
        ]));
      });
      sp.appendChild(rueck);
      inhalt.appendChild(sp);
    }

    // Darstellung
    var schriftWert = h('p', { class: 'uk-zeile-info', text: SCHRIFT_NAME[EIN.schrift] });
    var dar = h('div', { class: 'uk-gruppe' }, [
      h('h3', { class: 'uk-gruppe-titel', text: 'Darstellung' }),
      h('div', { class: 'uk-zeile' }, [
        h('div', { class: 'uk-zeile-text' }, [h('p', { class: 'uk-zeile-name', text: 'Schriftgrösse' }), schriftWert]),
        h('div', { class: 'uk-zeile-knoepfe' }, [
          h('button', { class: 'uk-knopf uk-klein', type: 'button', 'aria-label': 'Schrift kleiner', text: 'A−', onclick: function () { EIN.schrift = klemme(EIN.schrift - 1, 0, 2); schriftWert.textContent = SCHRIFT_NAME[EIN.schrift]; wendeEinstellungenAn(); speichereEinstellungen(); } }),
          h('button', { class: 'uk-knopf uk-klein', type: 'button', 'aria-label': 'Schrift grösser', text: 'A+', onclick: function () { EIN.schrift = klemme(EIN.schrift + 1, 0, 2); schriftWert.textContent = SCHRIFT_NAME[EIN.schrift]; wendeEinstellungenAn(); speichereEinstellungen(); } })
        ])
      ]),
      h('div', { class: 'uk-zeile' }, [
        h('div', { class: 'uk-zeile-text' }, [h('p', { class: 'uk-zeile-name', text: 'Kontrast hoch' })]),
        schalter('Kontrast hoch', EIN.kontrast, function (an) { EIN.kontrast = an; wendeEinstellungenAn(); speichereEinstellungen(); })
      ]),
      h('div', { class: 'uk-zeile' }, [
        h('div', { class: 'uk-zeile-text' }, [h('p', { class: 'uk-zeile-name', text: 'Ton' }), h('p', { class: 'uk-zeile-info', text: 'Aus. Diese Fassung hat noch keine Tonspur.' })]),
        schalter('Ton', false, function () { }, true)
      ])
    ]);
    if (!nurDarstellung && S.el.karteKnopf) {
      dar.appendChild(h('div', { class: 'uk-zeile' }, [
        h('div', { class: 'uk-zeile-text' }, [h('p', { class: 'uk-zeile-name', text: 'Karte' }), h('p', { class: 'uk-zeile-info', text: ortName(S.ortId) ? 'Mike ist: ' + ortName(S.ortId) : 'Was Mike bisher gesehen hat.' })]),
        h('button', { class: 'uk-knopf uk-klein', type: 'button', text: 'Öffnen', onclick: function () { ui.schliesseMenue(true); ui.oeffneKarte(); } })
      ]));
    }
    inhalt.appendChild(dar);

    // Zugang: Vorlesen und Entscheidungen ohne Zeitdruck
    var zug = h('div', { class: 'uk-gruppe' }, [
      h('h3', { class: 'uk-gruppe-titel', text: 'Zugang' }),
      h('div', { class: 'uk-zeile' }, [
        h('div', { class: 'uk-zeile-text' }, [h('p', { class: 'uk-zeile-name', text: 'Vorlesen' }), h('p', { class: 'uk-zeile-info', text: 'Neue Nachrichten mit der Stimme des Geräts.' })]),
        schalter('Vorlesen', EIN.vorlesen, function (an) { EIN.vorlesen = an; if (!an) stilleVorlesen(); speichereEinstellungen(); })
      ]),
      h('div', { class: 'uk-zeile' }, [
        h('div', { class: 'uk-zeile-text' }, [h('p', { class: 'uk-zeile-name', text: 'Ohne Zeitdruck' }), h('p', { class: 'uk-zeile-info', text: 'Mike wartet auf deine Antwort. Schweigen bleibt als Antwort möglich.' })]),
        schalter('Ohne Zeitdruck', EIN.ohneFrist, function (an) {
          EIN.ohneFrist = an; speichereEinstellungen();
          var f = S.hooks.onOhneFrist || (UK.engine && UK.engine.setOhneFrist ? function (x) { UK.engine.setOhneFrist(x); } : null);
          if (f) f(an);
        })
      ])
    ]);
    inhalt.appendChild(zug);

    var fuss = h('div', { class: 'uk-menue-fuss' }, [h('button', { class: 'uk-knopf', type: 'button', text: 'Weiterspielen', onclick: function () { ui.schliesseMenue(); } })]);
    if (nurDarstellung) fuss.firstChild.textContent = 'Fertig';
    var titelHook = S.hooks.onTitel;
    if (!nurDarstellung && titelHook) fuss.appendChild(h('button', { class: 'uk-knopf uk-knopf--leise', type: 'button', text: 'Zurück zum Titel', onclick: function () { ui.schliesseMenue(true); titelHook(); } }));
    inhalt.appendChild(fuss);
    m.appendChild(inhalt);

    S.menueVorher = document.activeElement;
    S.menueOffen = true;
    ['titel', 'chat', 'ende'].forEach(function (n) { S.el[n].setAttribute('inert', ''); });
    m.classList.add('ist-offen');
    m.removeAttribute('inert');
    setTimeout(function () { var f = m.querySelector('.uk-ikon'); if (f) f.focus({ preventScroll: true }); }, 60);
  };
  ui.schliesseMenue = function (still) {
    if (!S.el.menue || !S.menueOffen) return;
    S.menueOffen = false;
    S.el.menue.classList.remove('ist-offen');
    S.el.menue.setAttribute('inert', '');
    zeigeBild(S.bild || 'chat');
    if (S.karteOffen) S.el.mitte.setAttribute('inert', '');
    if (!still && S.menueVorher && S.menueVorher.focus && document.contains(S.menueVorher)) S.menueVorher.focus({ preventScroll: true });
  };

  // ---------- Enden-Archiv «Dein Weg» ----------
  // liste: [{ nummer, gesehen, kopf, titel, schlussbild, weg:[{text|null}] }] (nicht gesehene Enden: leere Zeile ohne Titel)
  ui.zeigeArchiv = function (liste) {
    var m = S.el.menue; m.textContent = '';
    m.appendChild(h('div', { class: 'uk-menue-kopf' }, [
      h('h2', { class: 'uk-menue-titel', id: 'uk-menue-titel', text: 'Enden' }),
      h('button', { class: 'uk-ikon', type: 'button', 'aria-label': 'Schliessen', html: SVG.zu, onclick: function () { ui.schliesseMenue(); } })
    ]));
    var inhalt = h('div', { class: 'uk-menue-inhalt' });
    (liste || []).forEach(function (e, i) {
      var g = h('div', { class: 'uk-gruppe uk-archiv' + (e.gesehen ? '' : ' ist-leer') });
      g.appendChild(h('p', { class: 'uk-archiv-kopf', text: e.kopf || ('Ende ' + (e.nummer || i + 1)) }));
      if (!e.gesehen) { g.appendChild(h('div', { class: 'uk-archiv-leerzeile', 'aria-label': 'Noch nicht erreicht' })); inhalt.appendChild(g); return; }
      g.appendChild(h('h3', { class: 'uk-archiv-titel', text: e.titel || '' }));
      if (e.schlussbild && typeof e.schlussbild === 'object') g.appendChild(albumEl(e.schlussbild));
      else if (e.schlussbild) g.appendChild(h('p', { class: 'uk-archiv-bild', text: e.schlussbild }));
      var weg = Array.isArray(e.weg) ? e.weg : [];
      if (weg.length) {
        var ol = h('ol', { class: 'uk-archiv-weg' });
        weg.forEach(function (w) { ol.appendChild(h('li', { class: w && w.text ? null : 'ist-still', text: w && w.text ? w.text : '—' })); });
        g.appendChild(h('details', { class: 'uk-archiv-details' }, [h('summary', { text: 'Dein Weg' }), ol]));
      }
      inhalt.appendChild(g);
    });
    inhalt.appendChild(h('div', { class: 'uk-menue-fuss' }, [h('button', { class: 'uk-knopf', type: 'button', text: 'Fertig', onclick: function () { ui.schliesseMenue(); } })]));
    m.appendChild(inhalt);
    S.menueVorher = document.activeElement;
    S.menueOffen = true;
    ['titel', 'chat', 'ende'].forEach(function (n) { S.el[n].setAttribute('inert', ''); });
    m.classList.add('ist-offen');
    m.removeAttribute('inert');
    setTimeout(function () { var f = m.querySelector('.uk-ikon'); if (f) f.focus({ preventScroll: true }); }, 60);
  };

  // ---------- Kontaktprofil: «Geteilte Medien» ----------
  // Daten über Hook onProfil() -> { name, status, medien:[{ id, art:'foto'|'memo', titel, zeit, bild? }] } (nur tatsächlich gesendete Medien)
  function profilListe(d) {
    var inh = S.el.profilInhalt; inh.textContent = '';
    inh.appendChild(h('div', { class: 'uk-profil-kopf' }, [
      h('span', { class: 'uk-avatar uk-avatar--gross', 'aria-hidden': 'true', text: String(d.name || '').charAt(0).toUpperCase() }),
      h('div', null, [h('p', { class: 'uk-profil-name', text: d.name || '' }), h('p', { class: 'uk-zeile-info', text: S.el.statusText.textContent })])
    ]));
    var medien = d.medien || [];
    var fotos = medien.filter(function (x) { return x.art !== 'memo'; }), memos = medien.filter(function (x) { return x.art === 'memo'; });
    inh.appendChild(h('h3', { class: 'uk-gruppe-titel uk-profil-titel', text: 'Geteilte Medien' + (medien.length ? ' · ' + medien.length : '') }));
    if (!medien.length) { inh.appendChild(h('p', { class: 'uk-zeile-info', text: 'Noch keine Fotos oder Sprachnachrichten.' })); return; }
    if (fotos.length) {
      var raster = h('div', { class: 'uk-profil-raster' });
      fotos.forEach(function (f) {
        var b = h('button', { class: 'uk-profil-kachel', type: 'button', 'aria-label': (f.titel || 'Foto') + (f.zeit ? ', ' + f.zeit : ''), onclick: function () { profilDetail(d, f); } });
        if (f.bild) b.appendChild(h('img', { src: f.bild, alt: '', loading: 'lazy', decoding: 'async' }));
        else b.appendChild(h('span', { class: 'uk-profil-kachel-text', text: f.titel || 'Foto' }));
        raster.appendChild(b);
      });
      inh.appendChild(raster);
    }
    memos.forEach(function (f) {
      inh.appendChild(h('button', { class: 'uk-profil-memo', type: 'button', onclick: function () { profilDetail(d, f); } }, [
        h('span', { class: 'uk-profil-memo-titel', text: f.titel || 'Sprachnachricht' }), h('span', { class: 'uk-zeile-info', text: f.zeit || '' })]));
    });
  }
  function profilDetail(d, f) {
    var inh = S.el.profilInhalt; inh.textContent = '';
    try { if (UK.medien && UK.medien.stoppeAlles) UK.medien.stoppeAlles(); } catch (e) { }
    inh.appendChild(h('div', { class: 'uk-profil-zurueck' }, [
      h('button', { class: 'uk-knopf uk-klein uk-knopf--leise', type: 'button', text: 'Alle Medien', onclick: function () { profilListe(d); } }),
      h('span', { class: 'uk-zeile-info', text: f.zeit || '' })]));
    var box = h('div', { class: 'uk-medium uk-profil-medium' });
    var el = null;
    try { el = UK.medien && UK.medien.render ? UK.medien.render(f.id) : null; } catch (e) { el = null; }
    box.appendChild(el instanceof window.Node ? el : h('p', { class: 'uk-blase', text: f.titel || '' }));
    inh.appendChild(box);
    inh.scrollTop = 0;
  }
  ui.oeffneProfil = function () {
    if (S.karteOffen) ui.schliesseKarte();
    var d = S.hooks.onProfil ? S.hooks.onProfil() : null;
    d = d || { name: ui.kontakt(), medien: [] };
    if (!d.name) d.name = ui.kontakt();
    profilListe(d);
    S.profilOffen = true;
    S.el.profilBlatt.classList.add('ist-offen'); S.el.schleier.classList.add('ist-offen');
    S.el.mitte.setAttribute('inert', ''); S.el.kopf.setAttribute('inert', ''); S.el.unten.setAttribute('inert', '');
    setTimeout(function () { S.el.profilZu.focus({ preventScroll: true }); }, 60);
  };
  ui.schliesseProfil = function () {
    if (!S.el.profilBlatt || !S.profilOffen) return;
    S.profilOffen = false;
    try { if (UK.medien && UK.medien.stoppeAlles) UK.medien.stoppeAlles(); } catch (e) { }
    S.el.profilBlatt.classList.remove('ist-offen'); S.el.schleier.classList.remove('ist-offen');
    S.el.mitte.removeAttribute('inert'); S.el.kopf.removeAttribute('inert'); S.el.unten.removeAttribute('inert');
  };

  // ---------- Karte ----------
  ui.karteEl = function () { return S.el.karteInhalt; };
  ui.mountKarteKnopf = function (onToggle) {
    S.karteCb = onToggle || null;
    if (!S.el.karteKnopf) {
      S.el.karteKnopf = h('button', { class: 'uk-ikon uk-karte-knopf', type: 'button', 'aria-label': 'Karte', 'aria-expanded': 'false', html: SVG.karte, onclick: function () { S.karteOffen ? ui.schliesseKarte() : ui.oeffneKarte(); } });
      S.el.aktionen.insertBefore(S.el.karteKnopf, S.el.menueKnopf);
    }
    return S.el.karteKnopf;
  };
  ui.oeffneKarte = function () {
    if (S.profilOffen) ui.schliesseProfil();
    var inh = S.el.karteInhalt;
    if (!inh.firstChild) {
      if (UK.karte && UK.karte.mount) { try { UK.karte.mount(inh); } catch (e) { inh.textContent = ''; } }
      if (!inh.firstChild) inh.appendChild(h('div', { class: 'uk-blatt-leer', text: 'Noch nichts erkundet.' }));
    }
    S.karteOffen = true;
    S.el.blatt.style.transform = '';
    S.el.blatt.classList.add('ist-offen'); S.el.schleier.classList.add('ist-offen');
    S.el.mitte.setAttribute('inert', ''); S.el.kopf.setAttribute('inert', ''); S.el.unten.setAttribute('inert', '');
    if (S.el.karteKnopf) S.el.karteKnopf.setAttribute('aria-expanded', 'true');
    if (S.karteCb) S.karteCb(true, inh);
    setTimeout(function () { S.el.karteZu.focus({ preventScroll: true }); }, 60);
  };
  ui.schliesseKarte = function () {
    if (!S.el.blatt || !S.karteOffen) return;
    S.karteOffen = false;
    S.el.blatt.style.transform = '';
    S.el.blatt.classList.remove('ist-offen'); S.el.schleier.classList.remove('ist-offen');
    S.el.mitte.removeAttribute('inert'); S.el.kopf.removeAttribute('inert'); S.el.unten.removeAttribute('inert');
    if (S.el.karteKnopf) { S.el.karteKnopf.setAttribute('aria-expanded', 'false'); if (S.tastatur) S.el.karteKnopf.focus({ preventScroll: true }); }
    if (S.karteCb) S.karteCb(false, S.el.karteInhalt);
  };
  // Blatt nach unten ziehen zum Schliessen
  function bindeBlattZiehen() {
    var kopf = S.el.karteKopf, blatt = S.el.blatt, start = null, dy = 0;
    kopf.addEventListener('pointerdown', function (ev) { if (ev.target.closest('button')) return; start = ev.clientY; dy = 0; blatt.classList.add('ist-gezogen'); try { kopf.setPointerCapture(ev.pointerId); } catch (e) { } });
    kopf.addEventListener('pointermove', function (ev) { if (start == null) return; dy = Math.max(0, ev.clientY - start); blatt.style.transform = 'translateY(' + dy + 'px)'; });
    function los(ev) { if (start == null) return; start = null; blatt.classList.remove('ist-gezogen'); blatt.style.transform = ''; if (dy > 80 && ev.type === 'pointerup') ui.schliesseKarte(); } // Abbruch (Systemgeste) federt nur zurück
    kopf.addEventListener('pointerup', los); kopf.addEventListener('pointercancel', los);
  }

  // ---------- Leeren ----------
  ui.leere = function () {
    S.gen++;
    S.timer.forEach(clearTimeout); S.timer = [];
    if (S.antwort) S.antwort.abbrechen();
    if (!S.el.innen) return;
    S.el.innen.textContent = '';
    S.el.innen.style.transform = '';
    if (S.el.innen.getAnimations) S.el.innen.getAnimations().forEach(function (x) { x.cancel(); });
    S.letzteVon = null; S.letzteMsg = null; S.tippEl = null; S.letzteZeit = ''; S.letzteSprecher = '';
    S.letzteIch = null; S.zustellung = null; S.gefroren = false; S.jetzt = ''; S.zuletzt = '';
    stilleVorlesen();
    ui.schliesseProfil();
    clearTimeout(S.tippWegT);
    setzeUnten(null);
    entferneLuecken(); S.amBoden = true; S.el.verlauf.scrollTop = S.el.verlauf.scrollHeight; S.el.neu.classList.remove('ist-sichtbar');
    setStatus('online');
    S.el.ort.textContent = ''; S.ortId = null;
    ui.schliesseKarte();
    S.amBoden = true; S.el.neu.classList.remove('ist-sichtbar');
    zeigeBild('chat');
  };

  // ---------- Tastatur ----------
  function taste(ev) {
    S.tastatur = true;
    if (!S.el.app) return;
    var k = ev.key;
    if (k === 'Escape') {
      if (S.menueOffen) { ev.preventDefault(); ui.schliesseMenue(); return; }
      if (S.profilOffen) { ev.preventDefault(); ui.schliesseProfil(); return; }
      if (S.karteOffen) { ev.preventDefault(); ui.schliesseKarte(); return; }
      return;
    }
    if (S.menueOffen) {
      if (k === 'Tab') falle(ev, S.el.menue);
      return;
    }
    if (S.profilOffen) { if (k === 'Tab') falle(ev, S.el.profilBlatt); return; }
    if (S.karteOffen) { if (k === 'Tab') falle(ev, S.el.blatt); return; }
    if (S.bild !== 'chat' || !S.antwort) return;
    var t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (/^[1-9]$/.test(k)) {
      var i = Number(k) - 1;
      if (S.antwort.knoepfe[i]) { ev.preventDefault(); S.antwort.knoepfe[i].focus({ preventScroll: true }); S.antwort.waehle(i); }
      return;
    }
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      var kn = S.antwort.knoepfe, idx = kn.indexOf(document.activeElement);
      if (idx < 0 && (t === document.body || S.el.unten.contains(t) || S.el.verlauf.contains(t) || !t)) idx = k === 'ArrowDown' ? -1 : kn.length;
      else if (idx < 0) return;
      ev.preventDefault();
      var j = klemme(idx + (k === 'ArrowDown' ? 1 : -1), 0, kn.length - 1);
      kn[j].focus({ preventScroll: true });
    }
  }
  function falle(ev, box) {
    var f = box.querySelectorAll('button:not([disabled]):not([tabindex="-1"]), [href], [tabindex="0"]');
    if (!f.length) return;
    var a = f[0], z = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === a) { ev.preventDefault(); z.focus(); }
    else if (!ev.shiftKey && document.activeElement === z) { ev.preventDefault(); a.focus(); }
    else if (!box.contains(document.activeElement)) { ev.preventDefault(); a.focus(); }
  }
})();
