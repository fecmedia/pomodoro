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
const today = () => new Date().toLocaleDateString('sv');

// ===== Zustand =====
let settings = { focus: 25, break: 5, long: 15, ...load('focus_settings', {}) };
let st = { mode: 'focus', remaining: settings.focus * 60000, endAt: null, completed: 0, day: today(), count: 0, minutes: 0, ...load('focus_state', {}) };
if (st.day !== today()) Object.assign(st, { day: today(), completed: 0, count: 0, minutes: 0 });

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
  fill.style.transform = `scaleY(${Math.min(1, Math.max(0, 1 - left / total))})`;
  document.title = running() ? `${t} ${LABEL[st.mode]}${topic.value ? ' – ' + topic.value : ''}` : 'Focus';

  document.body.dataset.mode = st.mode;
  document.querySelectorAll('.mode').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === st.mode));
  toggleBtn.classList.toggle('running', running());
  toggleBtn.setAttribute('aria-label', running() ? 'Pause' : (st.remaining < total ? 'Weiter' : 'Start'));

  const filled = st.completed > 0 && st.completed % 4 === 0 && st.mode !== 'focus' ? 4 : st.completed % 4;
  document.querySelectorAll('#dots span').forEach((d, i) => d.classList.toggle('on', i < filled));
  $('#dots').setAttribute('aria-label', `${filled} von 4 Sessions`);
  $('#today').textContent = st.count
    ? `Heute ${st.count} ${st.count === 1 ? 'Session' : 'Sessions'}, ${st.minutes} Min Fokus`
    : 'Noch keine Session heute';
}
function snapRender() { fill.classList.add('snap'); render(); fill.offsetWidth; fill.classList.remove('snap'); }

let statusTimer;
function status(text) {
  const el = $('#status'); el.textContent = text;
  clearTimeout(statusTimer); statusTimer = setTimeout(() => (el.textContent = ''), 6000);
}

// ===== Timer (Zeitstempel statt Zählen: bleibt im Hintergrund genau) =====
let timer = null;
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
  clearInterval(timer); releaseLock();
  st.endAt = null; st.remaining = totalMs(); persist(); snapRender();
}
function setMode(m, force) {
  if (!force && running() && !confirm('Laufende Phase abbrechen?')) return;
  clearInterval(timer); releaseLock();
  st.mode = m; st.endAt = null; st.remaining = totalMs(); persist(); snapRender();
}
function complete(quiet) {
  clearInterval(timer); releaseLock();
  const end = new Date(Math.min(st.endAt ?? Date.now(), Date.now()));
  st.endAt = null;
  const wasFocus = st.mode === 'focus';
  if (wasFocus) {
    st.completed++; st.count++; st.minutes += settings.focus;
    queueEvent(new Date(end - settings.focus * 60000), end);
  }
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
  if (e.code === 'Space' && !['INPUT', 'BUTTON', 'TEXTAREA'].includes(e.target.tagName) && !$('#settings').open) {
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
  $('#cal').classList.toggle('on', state === 'on');
  $('#cal-text').textContent = { on: 'Kalender verbunden', expired: 'Kalender neu verbinden', off: 'Kalender verbinden' }[state];
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
  if (window.google?.accounts?.oauth2) { clearInterval(waitGoogle); if (!CLIENT_ID.startsWith('DEINE')) initGoogle(); }
  else if (++tries > 40) clearInterval(waitGoogle);
}, 300);

$('#cal').addEventListener('click', () => {
  if (CLIENT_ID.startsWith('DEINE')) return status('Trage zuerst deine Google Client-ID in app.js ein.');
  if (!tokenClient) return status('Google-Anmeldung nicht erreichbar. Bist du online?');
  if (tokenValid()) {
    if (!confirm('Kalender-Verbindung trennen?')) return;
    google.accounts.oauth2.revoke(token, () => {});
    token = null; sessionStorage.removeItem('gcal'); localStorage.removeItem('gcal_linked'); setCal();
  } else tokenClient.requestAccessToken({ prompt: linked() ? '' : 'consent' });
});

function queueEvent(start, end) {
  if (!linked()) return;
  const name = topic.value.trim() || 'Fokus-Session';
  pending.push({ summary: `🍅 ${name}`, description: 'Automatisch erfasste Pomodoro-Session (Focus)', start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } });
  save('focus_pending', pending); flush();
}
async function flush() {
  if (!pending.length) return;
  if (!tokenValid()) { setCal(); return status('Kalender neu verbinden, dann wird die Session eingetragen.'); }
  while (pending.length) {
    const ev = pending[0];
    try {
      const res = await fetch(CAL_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(ev) });
      if (res.status === 401) { token = null; sessionStorage.removeItem('gcal'); setCal(); return status('Kalender neu verbinden, dann wird die Session eingetragen.'); }
      if (!res.ok) throw new Error(res.status);
      pending.shift(); save('focus_pending', pending);
      status(`Im Kalender gespeichert: ${ev.summary.slice(3)}`);
    } catch { return status('Kalender-Sync fehlgeschlagen. Nächster Versuch folgt.'); }
  }
}

// ===== Einstellungen & Installation =====
const dlg = $('#settings');
$('#settings-btn').addEventListener('click', () => {
  $('#s-focus').value = settings.focus; $('#s-break').value = settings.break; $('#s-long').value = settings.long;
  dlg.showModal();
});
$('#cancel').addEventListener('click', () => dlg.close());
$('#settings-form').addEventListener('submit', () => {
  const v = (id, d, max) => Math.min(max, Math.max(1, parseInt($(id).value, 10) || d));
  settings = { focus: v('#s-focus', 25, 180), break: v('#s-break', 5, 60), long: v('#s-long', 15, 90) };
  save('focus_settings', settings);
  if (!running()) { st.remaining = totalMs(); persist(); snapRender(); }
});

let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#install').hidden = false; });
$('#install').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#install').hidden = true; });
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (isIOS && !navigator.standalone) $('#install-hint').hidden = false;

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

// ===== Start =====
setCal();
if (running()) {
  if (st.endAt <= Date.now()) complete(true);
  else { timer = setInterval(tick, 250); lockScreen(); }
}
snapRender();
if (pending.length && tokenValid()) flush();
