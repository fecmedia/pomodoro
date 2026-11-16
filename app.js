'use strict';

// ===== Konfiguration =====
const CLIENT_ID = '393963352444-b8qditk7v9pd3vir9o5q2msftq6dof3h.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const CAL_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const LABEL = { focus: 'Fokus', break: 'Pause', long: 'Lange Pause' };

// ===== Helfer =====
const $ = s => document.querySelector(s);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const pad = n => String(n).padStart(2, '0');
const dayKey = d => new Date(d).toLocaleDateString('sv');
const today = () => dayKey(Date.now());

// ===== Zustand =====
let settings = { focus: 25, break: 5, long: 15, ...load('focus_settings', {}) };
let st = { mode: 'focus', remaining: settings.focus * 60000, endAt: null, completed: 0, day: today(), ...load('focus_state', {}) };
if (st.day !== today()) Object.assign(st, { day: today(), completed: 0 });

const fill = $('#fill'), timeEl = $('#time'), topic = $('#topic'), toggleBtn = $('#toggle');
const running = () => st.endAt !== null;
const totalMs = () => settings[st.mode] * 60000;
const persist = () => save('focus_state', st);

topic.value = load('focus_topic', '');
topic.addEventListener('input', () => save('focus_topic', topic.value));

// ===== Anzeige =====
function render() {
  const total = totalMs();
  const left = running() ? Math.max(0, st.endAt - Date.now()) : st.remaining;
  const secs = Math.ceil(left / 1000);
  const t = `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
  timeEl.textContent = t;
  fill.style.setProperty('--p', Math.min(1, Math.max(0, 1 - left / total)));
  document.title = running() ? `${t} ${LABEL[st.mode]}${topic.value ? ' – ' + topic.value : ''}` : 'Focus';

  document.body.dataset.mode = st.mode;
  document.body.classList.toggle('running', running());
  document.querySelectorAll('.mode').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === st.mode));
  toggleBtn.classList.toggle('running', running());
  toggleBtn.setAttribute('aria-label', running() ? 'Pause' : (st.remaining < total ? 'Weiter' : 'Start'));

  const filled = st.completed > 0 && st.completed % 4 === 0 && st.mode !== 'focus' ? 4 : st.completed % 4;
  document.querySelectorAll('#dots span').forEach((d, i) => d.classList.toggle('on', i < filled));
  $('#dots').setAttribute('aria-label', `${filled} von 4 Sessions`);
}
function snapRender() { fill.classList.add('snap'); render(); fill.offsetWidth; fill.classList.remove('snap'); }

let statusTimer;
function status(text) {
  const el = $('#status'); el.textContent = text;
  clearTimeout(statusTimer); statusTimer = setTimeout(() => (el.textContent = ''), 6000);
}

// ===== Timer (Zeitstempel statt Zählen: bleibt im Hintergrund genau) =====
let timer = null;
// Abgebrochene Phasen (Reset, Phasenwechsel) ab 1 Minute mitschreiben
function logPartialSession() {
  const left = running() ? Math.max(0, st.endAt - Date.now()) : st.remaining;
  const elapsedMs = totalMs() - left;
  const mins = Math.round(elapsedMs / 60000);
  if (mins < 1) return;
  const end = new Date(), begin = new Date(end - elapsedMs);
  if (st.mode === 'focus') {
    logAdd(begin.getTime(), mins);
    status(`Abgebrochene Session (${mins} Min.) gespeichert.`);
  } else if (linked()) {
    status(`Abgebrochene Pause (${mins} Min.) gespeichert.`);
  }
  queueEvent(begin, end, st.mode);
}

function tick() {
  if (!running()) return;
  if (st.endAt - Date.now() <= 0) complete(); else render();
}
function start() {
  unlockAudio(); askNotify();
  st.endAt = Date.now() + st.remaining;
  persist(); clearInterval(timer); timer = setInterval(tick, 250);
  lockScreen(); render();
}
function pause() {
  st.remaining = Math.max(0, st.endAt - Date.now()); st.endAt = null;
  clearInterval(timer); releaseLock(); persist(); render();
}
function reset() {
  logPartialSession();
  clearInterval(timer); releaseLock();
  st.endAt = null; st.remaining = totalMs(); persist(); snapRender();
}
function setMode(m, force) {
  if (!force && running() && !confirm('Laufende Phase abbrechen?')) return;
  if (!force) logPartialSession();
  clearInterval(timer); releaseLock();
  st.mode = m; st.endAt = null; st.remaining = totalMs(); persist(); snapRender();
}
function complete(quiet) {
  clearInterval(timer); releaseLock();
  const end = new Date(Math.min(st.endAt ?? Date.now(), Date.now()));
  st.endAt = null;
  const mode = st.mode, wasFocus = mode === 'focus';
  const begin = new Date(end - settings[mode] * 60000);
  if (wasFocus) { st.completed++; logAdd(begin.getTime(), settings.focus); }
  queueEvent(begin, end, mode);
  const next = wasFocus ? (st.completed % 4 === 0 ? 'long' : 'break') : 'focus';
  if (!quiet) {
    chime();
    if (document.hidden) notify(wasFocus ? 'Fokus-Session beendet' : 'Pause vorbei', `Als Nächstes: ${LABEL[next]}`);
    status(wasFocus ? 'Session beendet. Zeit für eine Pause.' : 'Pause vorbei. Bereit für die nächste Session?');
  }
  setMode(next, true);
}

toggleBtn.addEventListener('click', () => (running() ? pause() : start()));
$('#reset').addEventListener('click', reset);
$('#skip').addEventListener('click', () => setMode(st.mode === 'focus' ? 'break' : 'focus'));
document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => b.dataset.mode !== st.mode && setMode(b.dataset.mode)));
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !['INPUT', 'BUTTON', 'TEXTAREA'].includes(e.target.tagName) && !document.querySelector('dialog[open]')) {
    e.preventDefault(); toggleBtn.click();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  tick(); render();
  if (running() && !lock) lockScreen();
});

// ===== Ton, Benachrichtigung, Display =====
let ac, lock = null;
function unlockAudio() {
  try { ac ||= new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch {}
}
function chime() {
  if (!ac) return;
  [523.25, 659.25, 783.99].forEach((f, i) => {
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.18;
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.65);
  });
}
function askNotify() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}
async function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.ready;
    const opts = { body, icon: 'icons/icon-192.png', tag: 'focus', renotify: true };
    reg ? reg.showNotification(title, opts) : new Notification(title, opts);
  } catch {}
}
async function lockScreen() { try { lock = await navigator.wakeLock?.request('screen'); } catch {} }
function releaseLock() { lock?.release().catch(() => {}); lock = null; }

// ===== Google Kalender =====
let tokenClient = null, token = null, tokenExp = 0;
let pending = load('focus_pending', []);
const linked = () => !!localStorage.getItem('gcal_linked');
const tokenValid = () => token && Date.now() < tokenExp;

try {
  const s = JSON.parse(sessionStorage.getItem('gcal'));
  if (s && Date.now() < s.exp) { token = s.token; tokenExp = s.exp; }
} catch {}

function setCal() {
  const state = tokenValid() ? 'on' : linked() ? 'expired' : 'off';
  $('#cal-state').textContent = { on: 'Verbunden', expired: 'Verbindung abgelaufen', off: 'Nicht verbunden' }[state];
  $('#cal-btn').textContent = { on: 'Verbindung trennen', expired: 'Neu verbinden', off: 'Kalender verbinden' }[state];
}
function initGoogle() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID, scope: SCOPE,
    callback: r => {
      if (!r.access_token) return;
      token = r.access_token; tokenExp = Date.now() + (r.expires_in - 60) * 1000;
      try { sessionStorage.setItem('gcal', JSON.stringify({ token, exp: tokenExp })); } catch {}
      localStorage.setItem('gcal_linked', '1');
      setCal(); status('Google Kalender verbunden.'); flush();
    },
    error_callback: () => status('Verbindung zu Google abgebrochen.'),
  });
}
let tries = 0;
const waitGoogle = setInterval(() => {
  if (window.google?.accounts?.oauth2) { clearInterval(waitGoogle); initGoogle(); }
  else if (++tries > 40) clearInterval(waitGoogle);
}, 300);

$('#cal-btn').addEventListener('click', () => {
  if (!tokenClient) return status('Google-Anmeldung nicht erreichbar. Bist du online?');
  if (tokenValid()) {
    if (!confirm('Kalender-Verbindung trennen?')) return;
    google.accounts.oauth2.revoke(token, () => {});
    token = null; sessionStorage.removeItem('gcal'); localStorage.removeItem('gcal_linked');
    localStorage.removeItem('focus_stats_cache'); setCal();
  } else tokenClient.requestAccessToken({ prompt: linked() ? '' : 'consent' });
});

function queueEvent(start, end, mode) {
  if (!linked()) return;
  const isFocus = mode === 'focus';
  const summary = isFocus ? (topic.value.trim() || 'Fokus-Session') : (mode === 'long' ? 'Lange Pause' : 'Pause');
  pending.push({
    summary,
    description: isFocus ? 'Automatisch erfasste Pomodoro-Session (Focus)' : 'Automatisch erfasste Pause (Focus)',
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    colorId: isFocus ? '1' : '9', // Fokus = Lavendel, Pausen = Blaubeere
    extendedProperties: { private: { focusApp: '1', kind: isFocus ? 'focus' : 'break' } },
  });
  save('focus_pending', pending); flush();
}
async function flush() {
  if (!pending.length) return;
  if (!tokenValid()) { setCal(); return status('Kalender neu verbinden (Einstellungen), dann wird die Session eingetragen.'); }
  while (pending.length) {
    const ev = pending[0];
    try {
      const res = await fetch(CAL_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(ev) });
      if (res.status === 401) { token = null; sessionStorage.removeItem('gcal'); setCal(); return status('Kalender neu verbinden (Einstellungen), dann wird die Session eingetragen.'); }
      if (!res.ok) throw new Error(res.status);
      pending.shift(); save('focus_pending', pending);
      status(`Im Kalender gespeichert: ${ev.summary}`);
    } catch { return status('Kalender-Sync fehlgeschlagen. Nächster Versuch folgt.'); }
  }
}

// ===== Statistik (Quelle: Google Kalender, damit sie auf allen Geräten gleich ist) =====
const logGet = () => load('focus_log', []);
function logAdd(ms, min) {
  const cut = Date.now() - 90 * 864e5;
  const l = logGet().filter(x => x[0] > cut); l.push([ms, min]); save('focus_log', l);
}

async function fetchSessions() {
  const min = new Date(); min.setDate(min.getDate() - 60); min.setHours(0, 0, 0, 0);
  const list = []; let page = '';
  try {
    do {
      const q = new URLSearchParams({ privateExtendedProperty: 'focusApp=1', timeMin: min.toISOString(), maxResults: '250', singleEvents: 'true' });
      if (page) q.set('pageToken', page);
      const res = await fetch(`${CAL_URL}?${q}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) { token = null; sessionStorage.removeItem('gcal'); setCal(); return null; }
      if (!res.ok) return null;
      const data = await res.json();
      (data.items || []).forEach(e => {
        if (e.extendedProperties?.private?.kind === 'break') return;
        const s = Date.parse(e.start?.dateTime), f = Date.parse(e.end?.dateTime);
        if (s && f && f > s) list.push([s, Math.round((f - s) / 60000)]);
      });
      page = data.nextPageToken || '';
    } while (page);
    return list;
  } catch { return null; }
}

function computeStats(list) {
  const per = {}, cnt = {};
  list.forEach(([t, m]) => { const k = dayKey(t); per[k] = (per[k] || 0) + m; cnt[k] = (cnt[k] || 0) + 1; });
  const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = ago(i), k = dayKey(d);
    days.push({ label: d.toLocaleDateString('de', { weekday: 'short' }).replace('.', '').slice(0, 2), m: per[k] || 0 });
  }
  const sum = n => { let m = 0, c = 0; for (let i = 0; i < n; i++) { const k = dayKey(ago(i)); m += per[k] || 0; c += cnt[k] || 0; } return { m, c }; };
  let streak = 0, i = per[dayKey(ago(0))] ? 0 : 1;
  while (per[dayKey(ago(i))]) { streak++; i++; }
  return { days, today: sum(1), week: sum(7), month: sum(30), streak };
}
function fmt(m) { const h = Math.floor(m / 60), r = m % 60; return h ? `${h} Std${r ? ` ${r} Min` : ''}` : `${r} Min`; }
const sessions = c => `${c} ${c === 1 ? 'Session' : 'Sessions'}`;

function showStats(list, note) {
  const s = computeStats(list);
  $('#k-today').textContent = fmt(s.today.m); $('#l-today').textContent = `Heute, ${sessions(s.today.c)}`;
  $('#k-week').textContent = fmt(s.week.m);   $('#l-week').textContent = `Letzte 7 Tage, ${sessions(s.week.c)}`;
  $('#k-month').textContent = fmt(s.month.m); $('#l-month').textContent = `Letzte 30 Tage, ${sessions(s.month.c)}`;
  $('#k-streak').textContent = s.streak;
  const max = Math.max(...s.days.map(d => d.m), 1);
  $('#chart').innerHTML = s.days.map((d, i) =>
    `<div class="col" role="img" aria-label="${d.label}: ${fmt(d.m)}"><span class="val">${d.m || ''}</span>` +
    `<div class="track"><div class="bar${i === 6 ? ' now' : ''}" style="height:${d.m ? Math.max(4, d.m / max * 100) : 2}%"></div></div>` +
    `<span class="lab">${d.label}</span></div>`).join('');
  $('#stats-src').textContent = note;
}

async function openStats() {
  const dlg = $('#stats'); dlg.showModal();
  const cached = load('focus_stats_cache', null);
  if (tokenValid()) {
    showStats(cached?.list ?? logGet(), 'Wird aktualisiert …');
    const list = await fetchSessions();
    if (list) { save('focus_stats_cache', { list }); showStats(list, 'Aus deinem Google Kalender, gilt für alle Geräte.'); }
    else if (cached) showStats(cached.list, 'Letzter geladener Stand. Der Kalender ist gerade nicht erreichbar.');
    else showStats(logGet(), 'Der Kalender ist gerade nicht erreichbar. Gezeigt werden nur Sessions von diesem Gerät.');
  } else if (linked()) {
    showStats(cached?.list ?? logGet(), 'Stand vom letzten Abruf. Verbinde den Kalender in den Einstellungen neu, um zu aktualisieren.');
  } else {
    showStats(logGet(), 'Nur Sessions von diesem Gerät. Verbinde in den Einstellungen deinen Google Kalender, dann siehst du die Statistik von allen Geräten.');
  }
}

// ===== Dialoge, Einstellungen, Installation =====
const dlgSet = $('#settings'), dlgStats = $('#stats');
[dlgSet, dlgStats].forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
$('#stats-btn').addEventListener('click', openStats);
$('#stats-close').addEventListener('click', () => dlgStats.close());
$('#settings-close').addEventListener('click', () => dlgSet.close());
$('#settings-btn').addEventListener('click', () => {
  $('#s-focus').value = settings.focus; $('#s-break').value = settings.break; $('#s-long').value = settings.long;
  setCal(); dlgSet.showModal();
});
$('#settings-form').addEventListener('submit', () => {
  const v = (id, d, max) => Math.min(max, Math.max(1, parseInt($(id).value, 10) || d));
  settings = { focus: v('#s-focus', 25, 180), break: v('#s-break', 5, 60), long: v('#s-long', 15, 90) };
  save('focus_settings', settings);
  if (!running()) { st.remaining = totalMs(); persist(); snapRender(); }
});

let installEvt = null;
const showInstall = () => ($('#install-group').hidden = false);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#install').hidden = false; showInstall(); });
$('#install').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#install-group').hidden = true; });
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (isIOS && !navigator.standalone) { $('#install-hint').hidden = false; showInstall(); }

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

// ===== Start =====
setCal();
if (running()) {
  if (st.endAt <= Date.now()) complete(true);
  else { timer = setInterval(tick, 250); lockScreen(); }
}
snapRender();
if (pending.length && tokenValid()) flush();
