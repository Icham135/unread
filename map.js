// Hauskarte. Schnittstelle: go(knoten, merker), hint('og'|'keller'|'eg'), reset()
// Alles Sichtbare entsteht hier in #map (Klassen mit Präfix map-), das Aussehen steht in map.css.
(() => {
  'use strict';
  const NOOP = { go() {}, hint() {}, reset() {} };
  const host = document.getElementById('map');
  if (!host) { window.RaffiMap = NOOP; return; }

  // ---------------------------------------------------------------------------
  // TABELLE 1: Etagen. Platte = 400 x 400 Einheiten, Koordinaten unten sind Anteile (0..1) einer Platte.
  // left: Versatz in der gestapelten Ansicht, damit die Treppen übereinanderliegen
  // (Treppe EG/OG bei x .455, im Keller bei x .19 -> Keller um .265 * 400 nach rechts).
  // ---------------------------------------------------------------------------
  const P = 400;
  const FLOORS = [
    { key: 'keller', name: 'Keller',         tab: 'Keller', img: 'keller', left: 106, z: 0 },
    { key: 'eg',     name: 'Erdgeschoss',    tab: 'EG',     img: 'eg',     left: 0,   z: 230 },
    { key: 'og',     name: 'Obergeschoss',   tab: 'OG',     img: 'og',     left: 0,   z: 460 },
  ];
  const IDX = { keller: 0, eg: 1, og: 2 };

  // Treppe: Weg vom Knotenpunkt (Hub) der Etage zur Treppe
  const STAIRS = {
    keller: [[.64, .5], [.3, .5], [.19, .5]],
    eg:     [[.52, .69], [.52, .5], [.455, .5]],
    og:     [[.52, .69], [.52, .5], [.455, .5]],
  };
  // Aufdeck-Rechtecke für Treppenhaus/Flur (immer mit dem Flur zusammen sichtbar)
  const STAIR_REVEAL = { keller: [.10, .20, .16, .46], eg: null, og: null };

  // ---------------------------------------------------------------------------
  // TABELLE 2: Räume. rect = aufgedeckter Bereich [x, y, b, h]; anchor = Mikes Standpunkt;
  // route = Weg vom Standpunkt bis zum Hub der Etage (durch die Tür).
  // ---------------------------------------------------------------------------
  const R = {};
  function room(fl, id, name, rect, anchor, route) { R[fl + '.' + id] = { fl, id, name, rect, anchor, route: route || [anchor] }; }
  // Erdgeschoss (Hub = Flur vor Wohnzimmer-/Eingangstür bei .52/.69)
  room('eg', 'eingang', 'Eingang',    [.43, .62, .18, .30], [.52, .83], [[.52, .83], [.52, .69]]);
  room('eg', 'hall',    'Flur',       [.41, .10, .21, .60], [.52, .56], [[.52, .56], [.52, .69]]);
  room('eg', 'wohn',    'Wohnzimmer', [.07, .09, .36, .84], [.25, .55], [[.25, .55], [.25, .69], [.52, .69]]);
  room('eg', 'kueche',  'Küche',      [.60, .35, .31, .30], [.76, .42], [[.76, .42], [.75, .41], [.52, .41], [.52, .69]]);
  room('eg', 'essen',   'Zimmer',     [.60, .09, .31, .27], [.75, .24], [[.75, .24], [.66, .31], [.52, .31], [.52, .69]]);
  room('eg', 'sued',    'Zimmer',     [.60, .63, .31, .30], [.76, .78], [[.76, .78], [.76, .69], [.52, .69]]);
  // Obergeschoss (gleiche Treppe und Türen)
  room('og', 'hall',    'Gang',       [.41, .10, .21, .62], [.52, .56], [[.52, .56], [.52, .69]]);
  room('og', 'schlaf',  'Schlafzimmer', [.07, .09, .36, .84], [.25, .55], [[.25, .55], [.25, .69], [.52, .69]]);
  room('og', 'bad',     'Bad',        [.60, .35, .31, .30], [.78, .50], [[.78, .50], [.66, .41], [.52, .41], [.52, .69]]);
  room('og', 'nord',    'Zimmer',     [.60, .09, .31, .27], [.75, .24], [[.75, .24], [.66, .31], [.52, .31], [.52, .69]]);
  room('og', 'sued',    'Zimmer',     [.60, .63, .31, .30], [.76, .78], [[.76, .78], [.76, .69], [.52, .69]]);
  room('og', 'kammer',  'Kammer',     [.43, .72, .18, .22], [.52, .84], [[.52, .84], [.52, .69]]);
  // Keller (Hub = Ende des Kellergangs bei .64/.5)
  room('keller', 'hall',    'Kellergang',   [.22, .34, .46, .30], [.42, .50], [[.42, .50], [.64, .50]]);
  room('keller', 'heiz',    'Heizraum',     [.60, .09, .31, .28], [.76, .24], [[.76, .24], [.66, .31], [.64, .50]]);
  room('keller', 'abstell', 'Abstellraum',  [.72, .35, .20, .32], [.82, .50], [[.82, .50], [.64, .50]]);
  room('keller', 'lager',   'Lagerraum',    [.50, .63, .43, .31], [.72, .80], [[.72, .80], [.64, .68], [.64, .50]]);

  // ---------------------------------------------------------------------------
  // TABELLE 3: Knoten -> Raum (Kürzel). Nicht aufgeführte Knoten behalten den letzten Raum.
  // 'candle'/'next' hängen von der Etage ab (siehe CANDLE/NEXT), 'hall' = Flur/Gang der Etage.
  // ---------------------------------------------------------------------------
  const NODE_ROOM = {};
  const setRoom = (tok, ids) => ids.split(' ').forEach(i => { NODE_ROOM[i] = tok; });
  setRoom('eingang', 'start wer wo wieso krass besitzer keineGuteIdee legLos flucht polizeiband verriegelt jemand ausweg');
  setRoom('wohn', 'horAuf wohnzimmer wohnzimmerSauber bildWohnzimmer portraet nachfrage schrank schrankUnters weitermachen deko fenster');
  setRoom('kueche', 'kueche geruch kuehlZu kuehlOffen ruhig schraenke');
  setRoom('hall', 'hintertuer weitergehen');
  setRoom('candle', 'kerzen geraeusch');
  setRoom('next', 'bleiben');
  const CANDLE = { og: 'schlaf', keller: 'lager' };
  const NEXT = { og: 'sued', keller: 'heiz' };
  const GHOST = { og: 'bad', keller: 'abstell' };      // Raum, den Mike nicht erwähnt
  const KEEP_FLOOR = new Set(['kerzen', 'geraeusch', 'bleiben']);

  // ---------------------------------------------------------------------------
  // TABELLE 4: Fundstücke. sprite = [Spalte, Zeile] im Symbolbogen; at = [Etage, x, y]
  // when(visited, flags) sagt, ob es schon gefunden ist.
  // ---------------------------------------------------------------------------
  const SYMS = [
    { id: 'murmeln',  name: 'Murmeln',        sprite: [0, 0], at: ['eg', .36, .64], when: v => v.has('schrank') },
    { id: 'schluessel', name: 'Schlüssel',    sprite: [1, 0], at: ['eg', .31, .76], when: (v, f) => v.has('schrankUnters') || !!f.schluessel },
    { id: 'rabe',     name: 'Rabe',           sprite: [2, 0], at: ['eg', .86, .64], when: v => v.has('kuehlOffen') },
    { id: 'fernseher', name: 'Fernseher',     sprite: [3, 0], at: ['eg', .15, .20], when: v => v.has('nachfrage') },
    { id: 'kerzen',   name: 'Kerzen',         sprite: [0, 1], at: 'dyn:candle', when: v => v.has('kerzen') },
    { id: 'tuer',     name: 'Verriegelte Tür', sprite: [1, 1], at: ['eg', .52, .93], when: v => v.has('flucht') },
    { id: 'fenster',  name: 'Vernagelte Fenster', sprite: [2, 1], at: ['eg', .30, .91], when: v => v.has('fenster') },
    { id: 'band',     name: 'Absperrband',    sprite: [3, 1], at: ['eg', .58, .97], when: v => v.has('polizeiband') },
    { id: 'kuehl',    name: 'Kühlschrank',    sprite: [0, 2], at: ['eg', .65, .64], when: v => v.has('kuehlOffen') },
    { id: 'bild',     name: 'Familienbild',   sprite: [1, 2], at: ['eg', .30, .15], when: v => v.has('portraet') },
    { id: 'uhr',      name: 'Uhrwerk',        sprite: [2, 2], at: 'dyn:uhr', when: v => v.has('geraeusch') },
  ];
  const GHOST_SPRITE = [3, 2];
  // Mittelpunkte der Symbole im 2000 x 2000 px grossen Bogen (ausgemessen)
  const SHEET = { size: 2000, win: 480, cx: [302, 770, 1232, 1692], cy: [360, 934, 1540] };
  const ICON = 46;

  const DIR = 'karte/';
  const IMG = n => DIR + n + '.jpg';
  const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const $ = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.append(e); return e; };
  const SVGNS = 'http://www.w3.org/2000/svg';

  // CSS selbst laden (index.html bleibt unberührt)
  try {
    const src = (document.currentScript && document.currentScript.src) || '';
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = (src ? src.replace(/map\.js(\?.*)?$/, 'map.css') : 'map.css') + '?v=4';
    document.head.append(link);
  } catch (e) { /* ohne CSS weiter */ }

  // ---------------------------------------------------------------------------
  // Aufbau
  // ---------------------------------------------------------------------------
  host.textContent = '';
  const head = $('div', 'map-head', host);
  const title = $('div', 'map-title', head);
  const titleMain = $('b', '', title); titleMain.textContent = 'Haus';
  const titleSub = $('span', 'map-where', title); titleSub.textContent = '';
  const tabs = $('div', 'map-tabs', head);
  tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'Ansicht');
  const MODES = [['og', 'OG'], ['eg', 'EG'], ['keller', 'Keller']];
  const tabBtn = {};
  MODES.forEach(([m, label]) => {
    const b = $('button', 'map-tab', tabs); b.type = 'button'; b.textContent = label; b.dataset.mode = m;
    b.onclick = () => setMode(m);
    tabBtn[m] = b;
  });
  const fold = $('button', 'map-fold', head);
  fold.type = 'button'; fold.setAttribute('aria-label', 'Karte ein- oder ausklappen'); fold.innerHTML = '<i></i>';
  fold.onclick = () => setOpen(host.dataset.open === 'false');

  const view = $('div', 'map-view', host);
  const shake = $('div', 'map-shake', view);
  const fit = $('div', 'map-fit', shake);
  const stack = $('div', 'map-stack', fit);
  const fx = $('div', 'map-fx', view);
  $('i', 'map-fx-a', fx); $('i', 'map-fx-b', fx);
  $('div', 'map-vignette', view);

  // Platten
  const plates = FLOORS.map(F => {
    const el = $('div', 'map-plate', stack); el.dataset.floor = F.key;
    const img = $('img', 'map-plan', el); img.alt = ''; img.draggable = false;
    img.onerror = () => { img.remove(); el.classList.add('map-noimg'); };
    img.src = IMG('karte-' + F.img);
    const canvas = $('canvas', 'map-fog', el); canvas.width = canvas.height = P * 2;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'map-trail'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
    el.append(svg);
    $('div', 'map-dim', el);
    const lab = $('div', 'map-plabel', el); lab.textContent = F.name;
    return { F, el, canvas, ctx: canvas.getContext && canvas.getContext('2d'), svg, rev: {} };
  });

  // Nebel-Textur (optional)
  const mist = new Image(); let mistOk = false;
  mist.onload = () => { mistOk = true; drawAllFog(); };
  mist.src = IMG('nebel');

  // Symbol-Bogen prüfen
  const sheetProbe = new Image();
  sheetProbe.onerror = () => host.classList.add('map-nosheet');
  sheetProbe.src = IMG('symbole');

  // Mikes Punkt
  const dot = $('div', 'map-dot', stack);
  $('i', 'map-ring', dot);
  const pin = $('div', 'map-pin', dot);
  $('i', 'map-core', pin); $('i', 'map-stem', pin);
  dot.style.display = 'none';

  // Gestalt (zweiter, blasser Punkt)
  const ghost = $('div', 'map-ghost', stack);
  const ghostPin = $('div', 'map-pin', ghost);
  const ghostBadge = $('div', 'map-badge', ghostPin);
  setIcon($('i', 'map-ico', ghostBadge), GHOST_SPRITE);
  $('i', 'map-gcore', ghostPin);

  function setIcon(el, [c, r]) {
    const s = ICON * 0.86, k = s / SHEET.win;
    el.style.width = el.style.height = s + 'px';
    el.style.backgroundSize = (SHEET.size * k) + 'px ' + (SHEET.size * k) + 'px';
    el.style.backgroundPosition = (-(SHEET.cx[c] - SHEET.win / 2) * k) + 'px ' + (-(SHEET.cy[r] - SHEET.win / 2) * k) + 'px';
  }

  // ---------------------------------------------------------------------------
  // Zustand
  // ---------------------------------------------------------------------------
  let mode = 'eg', compact = false, autoFloor = null;
  let visited, trail, found, symEls, pendingFloor, curFloor, curToken, curRoom, pos, tween, ghostRoom, timers, lastFlags;
  function freshState() {
    visited = new Set(); trail = []; found = new Map(); pendingFloor = null; curFloor = 'eg'; curToken = 'eingang';
    curRoom = null; pos = null; tween = null; ghostRoom = null; timers = []; lastFlags = {};
    plates.forEach(p => { p.rev = {}; });
    Object.values(symEls || {}).forEach(e => e.remove()); symEls = {};
  }
  freshState();

  // ---------------------------------------------------------------------------
  // Geometrie
  // ---------------------------------------------------------------------------
  const lerp = (a, b, t) => a + (b - a) * t;
  function scenePos(fi, x, y) {
    const i = Math.max(0, Math.min(2, fi)), a = Math.floor(i), b = Math.min(2, a + 1), t = i - a;
    const left = lerp(FLOORS[a].left, FLOORS[b].left, t);
    const z = mode === 'all' ? lerp(FLOORS[a].z, FLOORS[b].z, t) * (compact ? .5 : 1) : 0;
    return [left + x * P, y * P, z];
  }
  function layoutPlates() {
    plates.forEach(p => {
      const [x, y, z] = scenePos(IDX[p.F.key], 0, 0);
      p.el.style.transform = `translate3d(${x}px,${y}px,${z}px)`;
      const shown = mode === 'all' || mode === p.F.key;
      p.el.classList.toggle('map-hidden', !shown);
      p.el.classList.toggle('map-on', p.F.key === curFloor && mode === 'all');
      p.el.classList.toggle('map-off', p.F.key !== curFloor && mode === 'all');
    });
    fit.style.setProperty('--a', mode !== 'all' ? '42deg' : compact ? '58deg' : '62deg');
  }
  function place(el, fi, x, y, lift) {
    const [X, Y, Z] = scenePos(fi, x, y);
    el.style.transform = `translate3d(${X}px,${Y}px,${Z + (lift || 3)}px)`;
  }

  // ---------------------------------------------------------------------------
  // Nebel (Canvas): dunkel, besuchte Räume werden weich aufgedeckt
  // ---------------------------------------------------------------------------
  function drawFog(p) {
    const c = p.ctx; if (!c) return;
    const S = P * 2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgb(3,3,5)'; c.fillRect(0, 0, S, S);
    if (mistOk) { c.globalAlpha = .34; try { c.drawImage(mist, 0, 0, S, S); } catch (e) { /* ohne Textur */ } c.globalAlpha = 1; }
    c.globalCompositeOperation = 'destination-out';
    c.shadowColor = '#000'; c.shadowBlur = 34; c.fillStyle = '#000';
    for (const id in p.rev) {
      const r = R[p.F.key + '.' + id]; if (!r || p.rev[id] <= 0) continue;
      const [x, y, w, h] = r.rect, pad = 0.012;
      c.globalAlpha = Math.min(1, p.rev[id]);
      c.shadowOffsetX = 4000; c.shadowOffsetY = 0;
      c.fillRect((x - pad) * S - 4000, (y - pad) * S, (w + 2 * pad) * S, (h + 2 * pad) * S);
    }
    c.shadowOffsetX = 0; c.shadowBlur = 0; c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  function drawAllFog() { plates.forEach(drawFog); }

  let fogRaf = 0;
  function reveal(fl, id) {
    const p = plates[IDX[fl]];
    if (!R[fl + '.' + id] || p.rev[id] !== undefined) return;
    p.rev[id] = reduce.matches ? 1 : 0;
    if (reduce.matches) { drawFog(p); return; }
    if (!fogRaf) fogRaf = requestAnimationFrame(fogStep);
  }
  let fogLast = 0;
  function fogStep(t) {
    const dt = fogLast ? Math.min(60, t - fogLast) : 16; fogLast = t;
    let busy = false;
    plates.forEach(p => {
      let ch = false;
      for (const id in p.rev) if (p.rev[id] < 1) { p.rev[id] = Math.min(1, p.rev[id] + dt / 1400); ch = true; }
      if (ch) { drawFog(p); busy = true; }
    });
    fogRaf = busy ? requestAnimationFrame(fogStep) : 0; if (!busy) fogLast = 0;
  }
  // Räume, die auf einem Weg aufgedeckt werden (Raum + Flur/Treppenhaus)
  function revealRoom(r) {
    reveal(r.fl, r.id);
    if (r.id !== 'hall' && R[r.fl + '.hall']) reveal(r.fl, 'hall');
  }

  // ---------------------------------------------------------------------------
  // Spur
  // ---------------------------------------------------------------------------
  function drawTrail(tip) {
    plates.forEach(p => {
      while (p.svg.firstChild) p.svg.firstChild.remove();
    });
    const segs = tip ? trail.concat([tip]) : trail;
    segs.forEach(s => {
      if (s.pts.length < 2) return;
      const pl = document.createElementNS(SVGNS, 'polyline');
      pl.setAttribute('points', s.pts.map(q => (q[0] * 100).toFixed(2) + ',' + (q[1] * 100).toFixed(2)).join(' '));
      pl.setAttribute('class', 'map-line');
      plates[IDX[s.fl]].svg.append(pl);
    });
  }

  // ---------------------------------------------------------------------------
  // Wege & Bewegung
  // ---------------------------------------------------------------------------
  const same = (a, b) => Math.abs(a[0] - b[0]) < .001 && Math.abs(a[1] - b[1]) < .001;
  function pathBetween(a, b) {
    const out = [];
    const push = (fl, pt) => { const l = out[out.length - 1]; if (!l || l.fl !== fl || !same(l.pt, pt)) out.push({ fl, pt }); };
    if (a.fl === b.fl) {
      const pa = a.route.slice(), pb = b.route.slice();
      while (pa.length > 1 && pb.length > 1 && same(pa[pa.length - 1], pb[pb.length - 1]) && same(pa[pa.length - 2], pb[pb.length - 2])) { pa.pop(); pb.pop(); }
      pa.forEach(q => push(a.fl, q)); pb.reverse().forEach(q => push(b.fl, q));
      return out;
    }
    a.route.forEach(q => push(a.fl, q));
    let i = IDX[a.fl]; const j = IDX[b.fl], step = j > i ? 1 : -1;
    while (i !== j) {
      const f1 = FLOORS[i].key, f2 = FLOORS[i + step].key;
      STAIRS[f1].forEach(q => push(f1, q));
      const s1 = STAIRS[f2].slice().reverse(); s1.forEach(q => push(f2, q));
      i += step;
    }
    b.route.slice().reverse().forEach(q => push(b.fl, q));
    return out;
  }
  const toVert = v => ({ fi: IDX[v.fl], x: v.pt[0], y: v.pt[1] });

  function startMove(from, to, opts) {
    // aktuelle Position als Startpunkt
    const verts = pathBetween(from, to).map(toVert);
    const start = pos ? { fi: pos.fi, x: pos.x, y: pos.y } : verts[0];
    if (!verts.length) verts.push({ fi: IDX[to.fl], x: to.anchor[0], y: to.anchor[1] });
    const pts = [start].concat(verts);
    // Länge (Etagenwechsel zählt als fester Anteil)
    const seg = [], total = [0];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const d = a.fi !== b.fi ? 170 : Math.hypot((b.x - a.x) * P, (b.y - a.y) * P);
      seg.push(d); total.push(total[i - 1] + d);
    }
    const len = total[total.length - 1];
    const dur = reduce.matches || opts.instant ? 0 : Math.min(3400, Math.max(650, len * 4.2));
    if (tween) cancelAnimationFrame(tween.raf);
    // laufende Spur abschliessen
    const T = { pts, seg, total, len, dur, t0: 0, commit: 0, cur: null, raf: 0 };
    tween = T;
    const startFl = FLOORS[Math.round(start.fi)].key;
    T.cur = { fl: startFl, pts: [[start.x, start.y]] };
    if (dur === 0) { finishMove(T); return; }
    const step = t => {
      if (tween !== T) return;
      if (!T.t0) T.t0 = t;
      let k = Math.min(1, (t - T.t0) / dur);
      const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      applyAt(T, e * len);
      if (k < 1) T.raf = requestAnimationFrame(step); else finishMove(T);
    };
    T.raf = requestAnimationFrame(step);
  }

  function applyAt(T, d) {
    let i = 1; while (i < T.pts.length - 1 && T.total[i] < d) i++;
    const a = T.pts[i - 1], b = T.pts[i], l = T.seg[i - 1] || 1;
    const t = Math.max(0, Math.min(1, (d - T.total[i - 1]) / l));
    // Spurpunkte der übersprungenen Wegpunkte übernehmen
    while (T.commit < i - 1) { T.commit++; commitPoint(T, T.pts[T.commit]); }
    pos = { fi: lerp(a.fi, b.fi, t), x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
    place(dot, pos.fi, pos.x, pos.y, 3);
    if (a.fi === b.fi) {
      const tipSeg = { fl: FLOORS[a.fi].key, pts: T.cur.fl === FLOORS[a.fi].key ? T.cur.pts.concat([[pos.x, pos.y]]) : [[a.x, a.y], [pos.x, pos.y]] };
      drawTrail(tipSeg);
    }
    syncFloorGlow(pos.fi);
  }
  function commitPoint(T, v) {
    const fl = FLOORS[Math.round(v.fi)].key;
    if (T.cur.fl !== fl) { if (T.cur.pts.length > 1) trail.push(T.cur); T.cur = { fl, pts: [] }; }
    const l = T.cur.pts[T.cur.pts.length - 1];
    if (!l || !same(l, [v.x, v.y])) T.cur.pts.push([v.x, v.y]);
  }
  function finishMove(T) {
    const last = T.pts[T.pts.length - 1];
    while (T.commit < T.pts.length - 1) { T.commit++; commitPoint(T, T.pts[T.commit]); }
    pos = { fi: last.fi, x: last.x, y: last.y };
    place(dot, pos.fi, pos.x, pos.y, 3);
    if (T.cur.pts.length > 1) trail.push(T.cur);
    drawTrail(null);
    syncFloorGlow(pos.fi);
    tween = null;
  }
  function syncFloorGlow(fi) {
    const near = FLOORS[Math.round(fi)].key;
    plates.forEach(p => {
      const on = p.F.key === near;
      p.el.classList.toggle('map-on', on && mode === 'all');
      p.el.classList.toggle('map-off', !on && mode === 'all');
    });
    host.dataset.floor = near;
    refreshSymDim();
  }

  // ---------------------------------------------------------------------------
  // Fundstücke
  // ---------------------------------------------------------------------------
  function symTarget(s) {
    if (typeof s.at === 'string') {
      const fl = s.dynFloor || curFloor, r = R[fl + '.' + (CANDLE[fl] || 'hall')] || R[fl + '.hall'];
      if (!r) return null;
      return s.at === 'dyn:candle' ? [fl, r.anchor[0] - .09, r.anchor[1] - .09] : [fl, r.anchor[0] + .10, r.anchor[1] + .12];
    }
    return s.at;
  }
  function addSym(s, delay) {
    if (found.has(s.id)) return;
    if (s.at === 'dyn:candle' || s.at === 'dyn:uhr') s.dynFloor = (s.id === 'uhr' && found.has('kerzen')) ? found.get('kerzen').floor : curFloor;
    const at = symTarget(s); if (!at) return;
    found.set(s.id, { floor: at[0] });
    const w = $('div', 'map-sym', stack); w.dataset.floor = at[0]; w.dataset.sym = s.id;
    const pn = $('div', 'map-pin', w);
    const b = $('div', 'map-badge', pn); b.title = s.name;
    setIcon($('i', 'map-ico', b), s.sprite);
    $('span', 'map-glyph', b).textContent = '◆';
    w.style.display = 'none'; w.__at = at; symEls[s.id] = w;
    const show = () => { place(w, IDX[at[0]], at[1], at[2], 4); w.style.display = ''; w.classList.add('map-pop'); refreshSymDim(); };
    if (delay && !reduce.matches) timers.push(setTimeout(show, delay)); else show();
  }
  function placeSyms() { Object.values(symEls).forEach(w => { if (w.__at) place(w, IDX[w.__at[0]], w.__at[1], w.__at[2], 4); }); }
  function refreshSymDim() {
    const near = host.dataset.floor || curFloor;
    Object.values(symEls).forEach(w => {
      const fl = w.dataset.floor;
      w.classList.toggle('map-dimmed', mode === 'all' && fl !== near);
      w.classList.toggle('map-hidden', mode !== 'all' && mode !== fl);
    });
    dot.classList.toggle('map-hidden', mode !== 'all' && mode !== near);
    ghost.classList.toggle('map-hidden', !ghostRoom || (mode !== 'all' && mode !== ghostRoom.fl));
  }

  // ---------------------------------------------------------------------------
  // Etage & Raum bestimmen, Knoten verarbeiten
  // ---------------------------------------------------------------------------
  function resolveRoom(fl, tok) {
    if (tok === 'candle') tok = CANDLE[fl] || 'hall';
    else if (tok === 'next') tok = NEXT[fl] || 'hall';
    if (fl === 'og' && tok === 'wohn') tok = 'schlaf';
    if (fl === 'og' && tok === 'kueche') tok = 'bad';
    return R[fl + '.' + tok] || R[fl + '.hall'];
  }

  function go(id, flags) {
    try { goInner(id, flags || {}); } catch (e) { console.warn('Karte:', e); }
  }
  function goInner(id, flags) {
    lastFlags = flags;
    visited.add(id);
    let fl;
    if (pendingFloor) { fl = pendingFloor; pendingFloor = null; }
    else if (KEEP_FLOOR.has(id)) fl = curFloor;
    else fl = 'eg';
    curFloor = fl;
    // Die Etage, in der Mike gerade ist, wird automatisch gezeigt; wer will, kann freiwillig eine andere ansehen
    MODES.forEach(([k]) => tabBtn[k].classList.toggle('map-here', k === fl));
    if (autoFloor !== fl) { autoFloor = fl; if (mode !== fl) setMode(fl); }
    if (NODE_ROOM[id]) curToken = NODE_ROOM[id];
    const to = resolveRoom(fl, curToken);
    const from = curRoom;
    const first = !from;
    curRoom = to;
    dot.style.display = '';
    titleSub.textContent = to.fl === 'eg' ? to.name : FLOORS[IDX[to.fl]].tab + ' · ' + to.name;

    revealRoom(to);
    if (from && from !== to) {
      revealRoom(from);
      if (from.fl !== to.fl) {
        [from.fl, to.fl].forEach(f => { reveal(f, 'hall'); if (STAIR_REVEAL[f]) { R[f + '.stairs'] = R[f + '.stairs'] || { fl: f, id: 'stairs', rect: STAIR_REVEAL[f] }; reveal(f, 'stairs'); } });
      } else reveal(to.fl, 'hall');
    }
    if (first) {
      pos = { fi: IDX[to.fl], x: to.anchor[0], y: to.anchor[1] };
      place(dot, pos.fi, pos.x, pos.y, 3);
      trail.push({ fl: to.fl, pts: [[pos.x, pos.y]] });
      dot.classList.remove('map-in'); void dot.offsetWidth; dot.classList.add('map-in');
      syncFloorGlow(pos.fi);
    } else if (from !== to) {
      startMove(from, to, {});
    } else syncFloorGlow(pos ? pos.fi : IDX[to.fl]);

    // Fundstücke
    SYMS.forEach(s => { if (!found.has(s.id) && s.when(visited, flags)) addSym(s, 1300); });

    // Gestalt: später, in einem Raum, den Mike nicht erwähnt
    if ((id === 'geraeusch' || id === 'bleiben') && !ghostRoom) {
      const gr = R[fl + '.' + GHOST[fl]];
      if (gr) timers.push(setTimeout(() => showGhost(gr), reduce.matches ? 600 : 5200));
    }
  }

  function showGhost(gr) {
    ghostRoom = gr;
    place(ghost, IDX[gr.fl], gr.anchor[0], gr.anchor[1], 3);
    ghost.classList.remove('map-gshow'); void ghost.offsetWidth; ghost.classList.add('map-gshow');
    refreshSymDim();
  }

  function hint(f) {
    if (f === 'og' || f === 'keller' || f === 'eg') pendingFloor = f;
  }

  function reset() {
    timers.forEach(clearTimeout);
    if (tween) cancelAnimationFrame(tween.raf);
    freshState(); autoFloor = null;
    ghost.classList.remove('map-gshow'); ghost.classList.add('map-hidden');
    dot.style.display = 'none';
    titleSub.textContent = '';
    drawTrail(null); drawAllFog(); setMode('eg'); syncFloorGlow(1);
    MODES.forEach(([k]) => tabBtn[k].classList.toggle('map-here', k === 'eg'));
  }

  // ---------------------------------------------------------------------------
  // Ansicht: Tabs, Einpassen, Klappen
  // ---------------------------------------------------------------------------
  function setMode(m) {
    mode = m;
    MODES.forEach(([k]) => { tabBtn[k].classList.toggle('map-act', k === m); tabBtn[k].setAttribute('aria-pressed', k === m); });
    view.classList.add('map-swap');
    layoutPlates(); placeSyms();
    if (pos) place(dot, pos.fi, pos.x, pos.y, 3);
    if (ghostRoom) place(ghost, IDX[ghostRoom.fl], ghostRoom.anchor[0], ghostRoom.anchor[1], 3);
    refreshSymDim(); doFit();
    setTimeout(() => view.classList.remove('map-swap'), 30);
  }
  function setOpen(open) {
    host.dataset.open = open ? 'true' : 'false';
    host.classList.toggle('collapsed', !open);
    fold.setAttribute('aria-expanded', open);
    if (open) requestAnimationFrame(doFit);
  }

  function doFit() {
    const vw = view.clientWidth, vh = view.clientHeight;
    if (vw < 50 || vh < 60) return;
    const wantCompact = vw / vh > 1.25;
    if (wantCompact !== compact) {
      compact = wantCompact; layoutPlates(); placeSyms();
      if (pos) place(dot, pos.fi, pos.x, pos.y, 3);
      if (ghostRoom) place(ghost, IDX[ghostRoom.fl], ghostRoom.anchor[0], ghostRoom.anchor[1], 3);
    }
    fit.style.transition = 'none';
    fit.style.transform = 'translate(0,0) scale(1)';
    void fit.offsetWidth;
    const vr = view.getBoundingClientRect();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    plates.forEach(p => {
      if (p.el.classList.contains('map-hidden')) return;
      const r = p.el.getBoundingClientRect();
      x0 = Math.min(x0, r.left - vr.left); y0 = Math.min(y0, r.top - vr.top);
      x1 = Math.max(x1, r.right - vr.left); y1 = Math.max(y1, r.bottom - vr.top);
    });
    if (x1 < x0) return;
    const padX = 14, padY = 12;
    const s = Math.min((vw - padX * 2) / (x1 - x0), (vh - padY * 2) / (y1 - y0));
    const tx = vw / 2 - s * (x0 + x1) / 2, ty = vh / 2 - s * (y0 + y1) / 2 + 4;
    fit.style.transform = `translate(${tx}px,${ty}px) scale(${s})`;
    fit.style.setProperty('--s', s);
    void fit.offsetWidth; fit.style.transition = '';
  }
  if (window.ResizeObserver) new ResizeObserver(() => doFit()).observe(view);
  else window.addEventListener('resize', doFit);

  // Störung, wenn Mike offline geht
  let fxTimer = 0;
  function glitch(strong) {
    view.classList.remove('map-glitch', 'map-glitch-soft'); void view.offsetWidth;
    view.classList.add(reduce.matches ? 'map-glitch-soft' : 'map-glitch');
    clearTimeout(fxTimer);
    fxTimer = setTimeout(() => view.classList.remove('map-glitch', 'map-glitch-soft'), strong ? 1100 : 700);
  }
  const statusEl = document.getElementById('status');
  if (statusEl && window.MutationObserver) {
    let was = statusEl.classList.contains('off');
    new MutationObserver(() => {
      const now = statusEl.classList.contains('off');
      if (now && !was) {
        glitch(true);
        timers.push(setTimeout(() => { if (statusEl.classList.contains('off')) glitch(false); }, 2800));
      }
      was = now;
    }).observe(statusEl, { attributes: true, attributeFilter: ['class'] });
  }

  // Start
  host.dataset.open = 'true';
  fold.setAttribute('aria-expanded', 'true');
  setMode('eg');
  MODES.forEach(([k]) => tabBtn[k].classList.toggle('map-here', k === 'eg'));
  drawAllFog(); drawTrail(null);
  window.RaffiMap = { go, hint, reset };
})();
