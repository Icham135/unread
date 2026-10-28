// Ton für Project Raffi: alles live mit der Web Audio API erzeugt (keine Dateien nötig).
// Schnittstelle: start(an), mute(stumm), ambient(knoten), msgIn(), msgOut(), typing(), photo(), scare(),
// mechanical(), creak(), door(), memoPlay(name) -> Promise, memoStop()
// Alles optional und abgesichert: ein Fehler hier darf die Geschichte nie anhalten.
window.RaffiSound = (() => {
  let ctx = null, master = null, sfx = null, verb = null, amb = null;
  let muted = true, started = false, ambOn = false, tension = 0.05, nodeCount = 0;
  let noiseBuf = null, ambTimer = 0;
  let drone = null;
  let memo = null; // { el, stop(), done }

  // Spannung je Knoten (0 ruhig .. 1 bedrohlich); unbekannte Knoten schleichen langsam nach oben.
  const LEVEL = {
    start: .05, wer: .06, wo: .1, wieso: .12, krass: .14, besitzer: .2, wohnzimmer: .24, portraet: .3,
    nachfrage: .3, schrank: .4, weitermachen: .38, deko: .38, kueche: .42, geruch: .46, ruhig: .45,
    schraenke: .5, flucht: .75, polizeiband: .72, verriegelt: .78, jemand: .8, ausweg: .8, fenster: .8,
    hintertuer: .88, weitergehen: .6, kerzen: .9, geraeusch: .93, bleiben: 1
  };

  // iPhone/Safari: Audio-Elemente dürfen nur nach einem Fingertipp starten. Wir "entsperren" sie beim ersten Tippen
  // und benutzen sie danach immer wieder (neue Datei laden, abspielen).
  // Eine echte, kurze stille WAV-Datei (null Samples werden von iOS nicht als Wiedergabe gezählt)
  const SILENT = (() => {
    try {
      const n = 8000, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
      v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      w(36, 'data'); v.setUint32(40, n * 2, true);
      return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    } catch (e) { return ''; }
  })();
  let loopEl = null;
  let memoEl = null, sfxIdx = 0; const sfxPool = [];
  function unlockAudio() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    // iPhone: Solange ein (stilles) Medium läuft, hört man Web-Audio auch bei aktivem Stumm-Schalter
    try { if (SILENT) { if (!loopEl) { loopEl = new Audio(SILENT); loopEl.loop = true; loopEl.volume = .02; } const p = loopEl.play(); if (p && p.catch) p.catch(() => {}); } } catch (e) {}
    const warm = e => { try { e.src = SILENT; e.volume = .01; const p = e.play(); if (p && p.then) p.then(() => e.pause(), () => {}); } catch (x) {} };
    try { if (!memoEl) memoEl = new Audio(); warm(memoEl); } catch (e) {}
    try { while (sfxPool.length < 3) { const e = new Audio(); sfxPool.push(e); warm(e); } } catch (e) {}
    try { if (ctx && ctx.state === 'suspended') ctx.resume(); } catch (e) {}
  }
  ['pointerdown', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, unlockAudio, { once: true, passive: true }));

  // Echte Geräusch-Dateien (audio/sfx-*.mp3) abspielen; fehlt die Datei, läuft die Synthese als Ersatz.
  const synth = { mechanical: false, creak: false, door: false };
  const sfxEls = new Set();
  function playSfx(file, vol, fallback) {
    let el; try { el = sfxPool.length ? sfxPool[sfxIdx++ % sfxPool.length] : new Audio(); } catch (e) { return fallback(); }
    try { el.pause(); el.src = 'audio/' + file; el.currentTime = 0; el.volume = vol; } catch (e) { return fallback(); }
    sfxEls.add(el);
    const fail = () => { sfxEls.delete(el); fallback(); };
    el.onerror = fail; el.onended = () => sfxEls.delete(el);
    const p = el.play(); if (p && p.catch) p.catch(fail);
  }
  function stopSfx() { sfxEls.forEach(e => { try { e.pause(); } catch (x) {} }); sfxEls.clear(); }

  const safe = fn => (...a) => { try { return fn(...a); } catch (e) { return undefined; } };
  const live = () => !!ctx && !muted && ctx.state !== 'closed';
  const rnd = (a, b) => a + Math.random() * (b - a);

  function noise() {
    if (noiseBuf) return noiseBuf;
    const len = ctx.sampleRate * 2, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return (noiseBuf = b);
  }

  function impulse(sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp); comp.connect(ctx.destination);
    sfx = ctx.createGain(); sfx.gain.value = 1; sfx.connect(master);
    amb = ctx.createGain(); amb.gain.value = 0; amb.connect(master);
    verb = ctx.createConvolver(); verb.buffer = impulse(2.6, 3);
    const vg = ctx.createGain(); vg.gain.value = .5;
    verb.connect(vg); vg.connect(master);
    return true;
  }

  // Einzelner Ton mit Hüllkurve (kein Knacken: kurzer Anstieg, exponentielles Abklingen).
  function tone(freq, t0, dur, vol, type = 'sine', toVerb = 0, freqEnd) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + Math.min(.012, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(sfx);
    if (toVerb) { const s = ctx.createGain(); s.gain.value = toVerb; g.connect(s); s.connect(verb); }
    o.start(t0); o.stop(t0 + dur + .05);
  }

  // Gefilterter Rauschimpuls.
  function burst(t0, dur, vol, ftype, f, q = 1, toVerb = 0, fEnd) {
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise(); s.loop = true;
    fl.type = ftype; fl.frequency.setValueAtTime(f, t0); fl.Q.value = q;
    if (fEnd) fl.frequency.exponentialRampToValueAtTime(fEnd, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + Math.min(.006, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(fl); fl.connect(g); g.connect(sfx);
    if (toVerb) { const v = ctx.createGain(); v.gain.value = toVerb; g.connect(v); v.connect(verb); }
    s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + .05);
  }

  // ---------- Atmosphäre ----------
  function buildDrone() {
    const t = ctx.currentTime, nodes = [];
    const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 160;
    const dg = ctx.createGain(); dg.gain.value = .5;
    low.connect(dg); dg.connect(amb);
    const oscs = [[55, 'sawtooth'], [55.6, 'sawtooth'], [82.4, 'sine'], [27.5, 'sine']].map(([f, ty]) => {
      const o = ctx.createOscillator(); o.type = ty; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = ty === 'sine' ? .5 : .22;
      o.connect(g); g.connect(low); o.start(t); nodes.push(o); return o;
    });
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = .07; lg.gain.value = 40; lfo.connect(lg); lg.connect(low.frequency); lfo.start(t); nodes.push(lfo);
    // Wind / Raumrauschen
    const ns = ctx.createBufferSource(); ns.buffer = noise(); ns.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = .7;
    const wg = ctx.createGain(); wg.gain.value = .12;
    ns.connect(bp); bp.connect(wg); wg.connect(amb); ns.start(t); nodes.push(ns);
    const wl = ctx.createOscillator(), wlg = ctx.createGain();
    wl.frequency.value = .11; wlg.gain.value = 220; wl.connect(wlg); wlg.connect(bp.frequency); wl.start(t); nodes.push(wl);
    // Hohes, dünnes Pfeifen, nur bei Spannung hörbar
    const hi = ctx.createOscillator(), hg = ctx.createGain();
    hi.type = 'sine'; hi.frequency.value = 1760; hg.gain.value = 0; hi.connect(hg); hg.connect(amb); hi.start(t); nodes.push(hi);
    return { nodes, low, wg, hg, oscs, bp };
  }

  function applyTension(sec) {
    if (!drone || !ctx) return;
    const t = ctx.currentTime, k = tension;
    const ramp = (p, v) => { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(v, t + sec); };
    ramp(amb.gain, muted ? 0 : .14 + k * .2);
    ramp(drone.low.frequency, 110 + k * 260);
    ramp(drone.wg.gain, .08 + k * .22);
    ramp(drone.hg.gain, Math.max(0, k - .6) * .012);
    ramp(drone.oscs[1].frequency, 55 + .4 + k * 3);
  }

  function ambLoop() {
    clearTimeout(ambTimer);
    if (!ambOn) return;
    try {
      if (live()) {
        const t = ctx.currentTime, k = tension;
        const r = Math.random();
        if (r < .35 && k > .25) burst(t, rnd(.25, .5), .05, 'bandpass', rnd(300, 700), 6, .3, rnd(150, 400)); // Holz knackt leise
        else if (r < .55 && k > .5) tone(rnd(48, 62), t, rnd(.8, 1.4), .08 + k * .06, 'sine', .2); // Dumpfer Schlag im Haus
        else if (r < .7 && k > .7) burst(t, rnd(.5, 1), .03, 'bandpass', rnd(1500, 3000), 8, .5); // Flüstern-artiges Zischen
        if (k > .8 && Math.random() < .3) { // schwacher Herzschlag
          tone(52, t, .18, .09, 'sine'); tone(48, t + .22, .22, .07, 'sine');
        }
      }
    } catch (e) {}
    ambTimer = setTimeout(ambLoop, rnd(2500, 7000) * (1.2 - tension * .7));
  }

  function startAmbient() {
    if (ambOn || !ctx) return;
    drone = buildDrone(); ambOn = true; applyTension(3); ambLoop();
  }

  // ---------- Öffentliche Funktionen ----------
  const api = {
    start: safe((anAus = true) => {
      unlockAudio();
      if (started) { if (ctx && ctx.state === 'suspended') ctx.resume(); return; }
      if (!build()) return;
      started = true; muted = !anAus;
      ctx.resume();
      master.gain.setValueAtTime(0, ctx.currentTime);
      master.gain.linearRampToValueAtTime(muted ? 0 : .9, ctx.currentTime + 1.2);
      startAmbient();
    }),

    state: () => (ctx ? ctx.state : 'none'),
    mute: safe(stumm => {
      if (stumm) stopSfx();
      muted = !!stumm;
      if (memo && memo.el) memo.el.muted = muted;
      if (!ctx) return;
      if (!muted && ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(muted ? 0 : .9, t + .35);
      if (!muted) { startAmbient(); applyTension(1); }
    }),

    ambient: safe(name => {
      nodeCount++;
      const lvl = LEVEL[name];
      tension = lvl !== undefined ? lvl : Math.min(1, tension + .04);
      // nie wieder ruhiger werden als zuvor erreicht minus ein kleiner Rückgang (Spannung baut sich auf)
      tension = Math.max(tension, Math.min(1, nodeCount * .015));
      applyTension(4);
    }),

    msgIn: safe(() => {
      if (!live()) return;
      const t = ctx.currentTime;
      tone(740, t, .22, .06, 'sine', .25);
      tone(554, t + .11, .3, .05, 'sine', .3);
    }),

    msgOut: safe(() => {
      if (!live()) return;
      const t = ctx.currentTime;
      tone(392, t, .1, .025, 'sine');
      tone(523, t + .06, .14, .02, 'sine');
    }),

    typing: safe(() => {
      if (!live()) return;
      burst(ctx.currentTime, .03, .008, 'bandpass', 2200, 2);
    }),

    photo: safe(() => {
      if (!live()) return;
      const t = ctx.currentTime;
      burst(t, .035, .12, 'highpass', 2500, .7);
      tone(1800, t, .03, .03, 'square');
      burst(t + .075, .05, .09, 'bandpass', 1400, 1.2);
      tone(900, t + .075, .045, .03, 'square');
    }),

    scare: safe(() => {
      if (!live()) return;
      const t = ctx.currentTime;
      tone(60, t, .5, .22, 'sine', .3, 40); // Aufprall des Beutels
      // Murmeln prasseln: erst dicht, dann springen sie in immer grösseren Abständen aus.
      let at = .06, gap = .018;
      for (let i = 0; i < 52; i++) {
        const v = rnd(.05, .13) * (1 - i / 80);
        burst(t + at, rnd(.01, .02), v, 'bandpass', rnd(2500, 5500), rnd(1.5, 4), .55);
        tone(rnd(1800, 4200), t + at, rnd(.025, .05), v * .5, 'sine', .4);
        if (i % 6 === 0) tone(rnd(100, 160), t + at, .06, v * .8, 'triangle', .2); // dumpfer Aufschlag auf Holz
        at += gap; gap = Math.min(.22, gap * rnd(1.04, 1.12)) + rnd(0, .012);
      }
      // Nachhall im Raum
      burst(t + .1, 1.8, .03, 'lowpass', 900, .5, 1, 200);
    }),

    mechanical: safe(() => {
      if (!live()) return;
      if (!synth.mechanical) return playSfx('sfx-ticken.mp3', 0.5, () => { synth.mechanical = true; api.mechanical(); synth.mechanical = false; });
      const t = ctx.currentTime;
      let at = 0;
      for (let i = 0; i < 12; i++) {
        const tock = i % 2;
        burst(t + at, .025, .1, 'bandpass', tock ? 1100 : 2400, 4, .2);
        tone(tock ? 260 : 420, t + at, .04, .06, 'square', .1);
        at += (i === 6 ? .55 : .36) + rnd(-.015, .015);
      }
    }),

    creak: safe(() => {
      if (!live()) return;
      if (!synth.creak) return playSfx('sfx-treppe.mp3', 0.55, () => { synth.creak = true; api.creak(); synth.creak = false; });
      const t = ctx.currentTime;
      creakAt(t, .85, 70, 125);
      burst(t, .1, .05, 'lowpass', 300, 1, .3); // dumpfer Tritt
    }),

    door: safe(() => {
      if (!live()) return;
      if (!synth.door) return playSfx('sfx-tuer.mp3', 0.7, () => { synth.door = true; api.door(); synth.door = false; });
      const t = ctx.currentTime;
      creakAt(t, 1.8, 160, 520, true);
    }),

    memoPlay: safe(name => {
      api.memoStop();
      const m = { el: null, timers: [], ended: false };
      memo = m;
      m.done = new Promise(res => {
        m.finish = () => { if (m.ended) return; m.ended = true; m.timers.forEach(clearTimeout); res(); if (memo === m) memo = null; };
      });
      // Zuerst echte Aufnahme versuchen, sonst Platzhalter.
      let el;
      try { el = memoEl || new Audio(); el.pause(); el.src = 'audio/memo-' + name + '.mp3'; el.currentTime = 0; } catch (e) { el = null; }
      if (!el) { placeholder(m, name); return m.done; }
      el.muted = muted; el.volume = .9; el.preload = 'auto';
      m.el = el;
      let decided = false;
      const fallback = () => { if (decided) return; decided = true; m.el = null; placeholder(m, name); };
      el.onerror = fallback;
      el.oncanplay = () => {
        if (decided) return; decided = true;
        const p = el.play(); if (p && p.catch) p.catch(() => { m.el = null; placeholder(m, name); });
      };
      el.onended = m.finish;
      m.timers.push(setTimeout(() => { if (!decided) fallback(); }, 2500)); // Datei lädt nicht (z. B. nicht vorhanden)
      return m.done;
    }),

    memoStop: safe(() => {
      const m = memo; if (!m) return;
      if (m.el) { try { m.el.pause(); } catch (e) {} }
      if (m.gain && ctx) { // weich ausblenden
        const t = ctx.currentTime;
        m.gain.gain.cancelScheduledValues(t); m.gain.gain.setValueAtTime(m.gain.gain.value, t);
        m.gain.gain.linearRampToValueAtTime(0, t + .25);
        const stopNodes = m.nodes || []; setTimeout(() => stopNodes.forEach(n => { try { n.stop(); } catch (e) {} }), 300);
      }
      m.finish();
    })
  };

  // Knarzen: Sägezahn mit schwankender Tonhöhe durch schmalen Bandpass, in Stufen "stotternd".
  function creakAt(t, dur, f0, f1, squeal) {
    const o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain(), am = ctx.createOscillator(), ag = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + dur);
    for (let i = 0; i < 10; i++) o.frequency.setValueAtTime(f0 + (f1 - f0) * (i / 10) * rnd(.7, 1.3), t + dur * i / 10); // Ruckeln
    bp.type = 'bandpass'; bp.Q.value = squeal ? 14 : 8;
    bp.frequency.setValueAtTime(f0 * (squeal ? 3 : 5), t); bp.frequency.linearRampToValueAtTime(f1 * (squeal ? 3 : 4), t + dur);
    am.type = 'square'; am.frequency.value = rnd(14, 24); ag.gain.value = .5;
    const base = ctx.createGain(); base.gain.value = .5; am.connect(ag); ag.connect(base.gain);
    g.gain.setValueAtTime(.0001, t);
    g.gain.linearRampToValueAtTime(squeal ? .09 : .12, t + dur * .15);
    g.gain.setValueAtTime(squeal ? .09 : .12, t + dur * .7);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(bp); bp.connect(base); base.connect(g); g.connect(sfx);
    const v = ctx.createGain(); v.gain.value = .3; g.connect(v); v.connect(verb);
    o.start(t); am.start(t); o.stop(t + dur + .05); am.stop(t + dur + .05);
  }

  // Platzhalter für Sprachmemo: leises Rauschen mit Atemgeräusch; je nach Memo mit Schritten, Knarzen oder Ticken.
  function placeholder(m, name) {
    if (!ctx || m.ended) return;
    const dur = { flur: 7, treppe: 6, ticken: 8 }[name] || 6;
    const t = ctx.currentTime;
    const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(master);
    gain.gain.linearRampToValueAtTime(muted ? 0 : 1, t + .4);
    const nodes = [];
    const s = ctx.createBufferSource(); s.buffer = noise(); s.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const rg = ctx.createGain(); rg.gain.value = .05;
    s.connect(lp); lp.connect(rg); rg.connect(gain); s.start(t); nodes.push(s);
    // Atem: Rauschen schwillt an und ab (ca. alle 2.2 s)
    const sb = ctx.createBufferSource(); sb.buffer = noise(); sb.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = .8;
    const bg = ctx.createGain(); bg.gain.value = 0;
    sb.connect(bp); bp.connect(bg); bg.connect(gain); sb.start(t); nodes.push(sb);
    for (let at = .6; at < dur - 1; at += 2.2) {
      bg.gain.setValueAtTime(0, t + at);
      bg.gain.linearRampToValueAtTime(.09, t + at + .8);
      bg.gain.linearRampToValueAtTime(0, t + at + 1.4);
    }
    m.gain = gain; m.nodes = nodes;
    const ev = (ms, fn) => m.timers.push(setTimeout(() => { try { if (live() && !m.ended) fn(); } catch (e) {} }, ms));
    if (name === 'treppe') [1500, 3200, 4600].forEach(ms => ev(ms, api.creak));
    if (name === 'ticken') for (let i = 0; i < 5; i++) ev(1000 + i * 1300, api.mechanical);
    if (name === 'flur') [1200, 2000, 3600, 4400].forEach(ms => ev(ms, () => {
      burst(ctx.currentTime, .09, .09, 'lowpass', 220, 1, .3); }));
    m.timers.push(setTimeout(() => {
      try { gain.gain.cancelScheduledValues(ctx.currentTime); gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime); gain.gain.linearRampToValueAtTime(0, ctx.currentTime + .4); } catch (e) {}
      setTimeout(() => { nodes.forEach(n => { try { n.stop(); } catch (e) {} }); m.finish(); }, 450);
    }, dur * 1000));
  }

  return api;
})();
