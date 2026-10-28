// Ablauf der Chat-App: tippt, spricht, wartet, verzweigt. Ton kommt aus sound.js (optional).
(function () {
  const $ = s => document.querySelector(s);
  const N = window.STORY.nodes;
  const FAST = new URLSearchParams(location.search).has('fast') ? 0.04 : 1; // ?fast zum Testen
  const chat = $('#chat'), choicesEl = $('#choices'), statusEl = $('#status');
  const sleep = ms => new Promise(r => setTimeout(r, ms * FAST));
  const fx = () => window.RaffiSound || {};
  let flags = {}, sound = true, runId = 0;

  const STATUS = { on: 'Online', typing: 'schreibt …', rec: 'nimmt auf …', off: 'Offline' };
  function setStatus(k) { statusEl.className = k; statusEl.querySelector('em').textContent = STATUS[k]; }
  const clock = () => new Date().toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
  // Chat bleibt unten kleben: neue Blasen rollen weich nach, und wenn sich die Höhe des Chats ändert
  // (Auswahl erscheint/verschwindet, Karte klappt), wird sofort nachgezogen, damit nichts springt.
  let pinned = true;
  chat.addEventListener('scroll', () => { pinned = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 90; }, { passive: true });
  const down = () => { pinned = true; chat.scrollTo({ top: chat.scrollHeight, behavior: FAST < 1 ? 'auto' : 'smooth' }); };
  if (window.ResizeObserver) new ResizeObserver(() => { if (pinned) chat.scrollTop = chat.scrollHeight; }).observe(chat);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function bubble(text, who) {
    const b = el('div', 'msg ' + who);
    b.append(el('span', 'txt', text), el('time', '', clock()));
    chat.append(b); down(); return b;
  }
  function note(text) { chat.append(el('div', 'note', text)); down(); }

  // Platzhalter, bis echte Fotos in fotos/<name>.jpg liegen
  const LABEL = { haus: 'Das Haus von aussen', wohnzimmer: 'Wohnzimmer', deko: 'Familienfoto', kerzen: 'Brennende Kerzen' };
  function placeholder(key) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="440"><defs><radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#2a2a30"/><stop offset="1" stop-color="#050506"/></radialGradient><filter id="n"><feTurbulence baseFrequency=".9" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 .6 0 0 0 0 .6 0 0 0 0 .6 0 0 0 .22 0"/></filter></defs><rect width="640" height="440" fill="url(#g)"/><rect width="640" height="440" filter="url(#n)"/><text x="320" y="225" fill="#7d7d86" font-family="Helvetica,Arial" font-size="24" text-anchor="middle">${LABEL[key] || key}</text></svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  function photo(key) {
    const wrap = el('figure', 'msg mike photo');
    const img = new Image();
    img.alt = LABEL[key] || key; img.src = 'fotos/' + key + '.jpg';
    img.onerror = () => { img.onerror = null; img.src = placeholder(key); };
    img.onload = down;
    const rec = el('div', 'rec'); rec.append(el('i'), el('b', '', 'REC'), el('span', '', clock()));
    wrap.append(img, rec, el('time', '', clock()));
    chat.append(wrap); down(); fx().photo?.(); return wrap;
  }
  // Sprachmemo: Blase mit Abspielknopf und Wellenform; läuft von selbst, Text ist per Knopf lesbar
  const fmt = s => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
  function memoBubble(m) {
    const b = el('div', 'msg mike memo'), btn = el('button', 'mplay', '▶'), wave = el('div', 'wave');
    btn.setAttribute('aria-label', 'Sprachnachricht abspielen');
    for (let i = 0; i < 30; i++) { const s = el('i'); s.style.height = 22 + Math.abs(Math.sin(i * 1.9 + m.sec)) * 70 + '%'; s.style.setProperty('--k', i / 30); wave.append(s); }
    const tr = el('p', 'transcript', m.text); tr.hidden = true;
    const tb = el('button', 'mtext', 'Text'); tb.onclick = () => { tr.hidden = !tr.hidden; down(); };
    b.append(btn, wave, el('span', 'dur', fmt(m.sec)), tb, tr, el('time', '', clock()));
    chat.append(b); down(); fx().msgIn?.(); (navigator.userActivation?.hasBeenActive && navigator.vibrate?.(18));
    return { b, btn, wave, tr };
  }
  async function playMemo(m, id) {
    setStatus('rec'); await sleep(1600);
    if (id !== runId) return;
    const { b, btn, wave, tr } = memoBubble(m); setStatus('on');
    const play = () => {
      b.classList.remove('heard'); b.classList.add('playing'); wave.style.setProperty('--dn', m.sec); btn.textContent = '❚❚';
      const done = (sound && FAST >= 1 && fx().memoPlay) ? fx().memoPlay(m.name) : sleep(sound ? m.sec * 1000 : 1500);
      return Promise.resolve(done).then(() => { b.classList.remove('playing'); b.classList.add('heard'); btn.textContent = '▶'; });
    };
    if (!sound) { tr.hidden = false; down(); }
    btn.onclick = () => { if (!b.classList.contains('playing')) play(); else { fx().memoStop?.(); btn.textContent = '▶'; b.classList.remove('playing'); } };
    await sleep(500); await play(); await sleep(500);
  }
  function typingBubble() {
    const t = el('div', 'msg mike typing'); t.append(el('i'), el('i'), el('i'));
    chat.append(t); down(); return t;
  }

  // Nur die Sprachmemos werden gesprochen; normale Nachrichten bleiben still (nur kurze Lesepause)
  const speak = () => sleep(350);
  const typeTime = t => Math.min(2300, Math.max(750, t.length * 30));

  async function mikeSays(text, id) {
    if (id !== runId) return;
    setStatus('typing'); const t = typingBubble(); fx().typing?.();
    await sleep(typeTime(text));
    if (id !== runId) { t.remove(); return; }
    // Die Tipp-Blase wird an Ort und Stelle zur Nachricht (kein Entfernen und Neueinfügen, daher kein Springen)
    t.className = 'msg mike morphed'; t.replaceChildren(el('span', 'txt', text), el('time', '', clock())); down();
    setStatus('on'); fx().msgIn?.(); (navigator.userActivation?.hasBeenActive && navigator.vibrate?.(18));
    await speak(text, 'mike'); await sleep(320);
  }

  async function run(id) {
    const my = ++runId, n = N[id];
    choicesEl.replaceChildren(); document.body.dataset.node = id;
    fx().ambient?.(id);
    if (n.floor) window.RaffiMap?.hint?.(n.floor);
    window.RaffiMap?.go?.(id, flags);
    if (n.set) flags[n.set] = true;
    const lines = typeof n.m === 'function' ? n.m(flags) : n.m;
    if (n.set === 'schrank' && lines.length > 2) fx().scare?.();
    for (const l of lines) await mikeSays(l, my);
    if (my !== runId) return;
    if (n.photo) { await sleep(500); photo(n.photo); await sleep(700); }
    if (n.memo) { await playMemo(n.memo, my); if (my !== runId) return; }
    if (n.wait) {
      setStatus('off'); note('Mike ist offline …'); await sleep(n.wait * 1000);
      if (my !== runId) return;
      setStatus('on'); return run(n.next);
    }
    if (n.offline) setStatus('off');
    if (n.end) { if (n.memo) { fx().door?.(); await sleep(1400); } setStatus('off'); note('Mike ist offline …'); await sleep(2500); return ending(); }
    showChoices(n.c(flags));
  }

  function showChoices(list) {
    choicesEl.replaceChildren();
    list.forEach(([text, next, hint], i) => {
      const b = el('button', 'choice', text); b.style.animationDelay = i * 80 + 'ms';
      b.onclick = () => pick(text, next, hint);
      choicesEl.append(b);
    });
  }
  async function pick(text, next, hint) {
    choicesEl.replaceChildren(); fx().msgOut?.();
    if (hint) window.RaffiMap?.hint?.(hint);
    bubble(text, 'me'); await speak(text, 'me'); await sleep(450);
    run(next);
  }
  function ending() {
    note('Ende des bisherigen Stands');
    const b = el('button', 'choice again', 'Nochmal von vorn');
    b.onclick = () => { flags = {}; chat.replaceChildren(); window.RaffiMap?.reset?.(); setStatus('on'); run(window.STORY.start); };
    choicesEl.append(b);
  }

  $('#go').onclick = () => {
    sound = $('#sound').checked; $('#snd').textContent = sound ? 'Ton an' : 'Ton aus';
    fx().start?.(sound && FAST >= 1); $('#intro').classList.add('gone'); run(window.STORY.start);
    // Hinweis, falls der Browser den Ton blockiert (z. B. Stumm-Schalter am Handy)
    if (sound && FAST >= 1) setTimeout(() => { const st = fx().state?.(); if (st && st !== 'running') note('Kein Ton? Stumm-Schalter am Handy und Lautstärke prüfen, dann «Ton an» tippen.'); }, 900);
  };
  $('#snd').onclick = () => {
    sound = !sound; $('#snd').textContent = sound ? 'Ton an' : 'Ton aus';
    fx().mute?.(!sound); if (sound) fx().msgIn?.(); // kurzer Ton zur Kontrolle
  };
})();
