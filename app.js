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
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const left = running() ? Math.max(0, st.endAt - Date.now()) : st.remaining;
  const secs = Math.ceil(left / 1000);
  const t = `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
  const topicText = topic.value.trim() ? ` (${topic.value.trim()})` : '';
  navigator.mediaSession.metadata = new MediaMetadata({
    title: `${t} min – ${LABEL[st.mode]}${topicText}`,
    artist: running() ? 'Focus Timer läuft' : 'Timer pausiert',
    album: 'Pomodoro App',
    artwork: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }]
  });
  navigator.mediaSession.setActionHandler('play', () => { if (!running()) start(); });
  navigator.mediaSession.setActionHandler('pause', () => { if (running()) pause(); });
}

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

  updateMediaSession();
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
    if (document.hidden) {
      notify(wasFocus ? 'Fokus-Phase beendet!' : 'Pause vorbei!',
        wasFocus ? 'Deine aktuelle Fokus-Phase ist vorbei. Zeit für eine Pause!' : 'Deine Pause ist vorbei. Bereit für die nächste Session?');
    }
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
  if (linked()) ensureToken().then(ok => ok && flush());
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
// Ohne Client Secret: Verbindung hält ca. 1 Std. und wird bei jedem Tippen erneuert (Notlösung).
// Mit Client Secret (Einstellungen): dauerhafte Verbindung, die App tauscht den Refresh-Token direkt mit Google.
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

let tokenClient = null, codeClient = null, token = null, tokenExp = 0;
let pending = load('focus_pending', []);
const linked = () => !!localStorage.getItem('gcal_linked');
const secret = () => localStorage.getItem('gcal_secret') || '';
const refreshTok = () => localStorage.getItem('gcal_refresh');
const tokenValid = () => token && Date.now() < tokenExp;
const canAuto = () => !!(secret() && refreshTok());
const tokenReq = async params => (await fetch(TOKEN_URL, {
  method: 'POST', body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: secret(), ...params }),
})).json();

try {
  const s = JSON.parse(localStorage.getItem('gcal_token_data'));
  if (s && Date.now() < s.exp) { token = s.token; tokenExp = s.exp; }
} catch {}

function setToken(access, expiresIn) {
  token = access; tokenExp = Date.now() + (expiresIn - 60) * 1000;
  try { localStorage.setItem('gcal_token_data', JSON.stringify({ token, exp: tokenExp })); } catch {}
  localStorage.setItem('gcal_linked', '1'); setCal();
}
function dropToken() { token = null; tokenExp = 0; localStorage.removeItem('gcal_token_data'); setCal(); }
function clearAuth() {
  token = null; tokenExp = 0;
  ['gcal_token_data', 'gcal_linked', 'gcal_refresh', 'focus_stats_cache'].forEach(k => localStorage.removeItem(k)); setCal();
}

function setCal() {
  const state = tokenValid() || canAuto() ? 'on' : linked() ? 'expired' : 'off';
  $('#cal-state').textContent = { on: canAuto() ? 'Verbunden, dauerhaft' : 'Verbunden', expired: 'Verbindung abgelaufen', off: 'Nicht verbunden' }[state];
  $('#cal-btn').textContent = { on: 'Verbindung trennen', expired: 'Neu verbinden', off: 'Kalender verbinden' }[state];
  $('#cal-secret').placeholder = secret() ? 'Client Secret gespeichert' : 'Client Secret einfügen (optional)';
}

// Holt bei Bedarf automatisch einen frischen Zugriffs-Token (nur mit Client Secret)
let refreshing = null;
function ensureToken() {
  if (tokenValid()) return Promise.resolve(true);
  if (!canAuto()) return Promise.resolve(false);
  refreshing ||= (async () => {
    try {
      const d = await tokenReq({ grant_type: 'refresh_token', refresh_token: refreshTok() });
      if (d.access_token) { setToken(d.access_token, d.expires_in); return true; }
      if (d.error === 'invalid_grant') { localStorage.removeItem('gcal_refresh'); setCal(); status('Kalender-Verbindung abgelaufen. Bitte in den Einstellungen neu verbinden.'); }
    } catch {}
    return false;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

// Ohne Secret: im Tipp-Ereignis erneuern, nur dann lässt der Browser das Google-Popup zu
let lastTry = 0;
function refreshOnGesture() {
  if (canAuto() || !tokenClient || !linked() || Date.now() - lastTry < 60000) return;
  if (!token || tokenExp - Date.now() < 10 * 60000) { lastTry = Date.now(); try { tokenClient.requestAccessToken({ prompt: '' }); } catch {} }
}
document.addEventListener('pointerdown', refreshOnGesture, { passive: true });

function initGoogle() {
  try {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE,
      callback: r => {
        if (r.error) return status(`Anmeldung abgelehnt: ${r.error}`);
        if (!r.access_token) return;
        setToken(r.access_token, r.expires_in); status('Google Kalender verbunden.'); flush();
      },
      error_callback: err => { setCal(); status(`Google-Anmeldung fehlgeschlagen (${err?.type || 'Unbekannt'}). Pop-up blockiert?`); },
    });
    codeClient = google.accounts.oauth2.initCodeClient({
      client_id: CLIENT_ID, scope: SCOPE, ux_mode: 'popup',
      callback: async r => {
        if (r.error || !r.code) return status('Anmeldung abgebrochen.');
        try {
          const d = await tokenReq({ grant_type: 'authorization_code', code: r.code, redirect_uri: 'postmessage' });
          if (!d.access_token) throw new Error(d.error_description || d.error || 'unbekannt');
          setToken(d.access_token, d.expires_in);
          if (d.refresh_token) { localStorage.setItem('gcal_refresh', d.refresh_token); setCal(); status('Google Kalender dauerhaft verbunden.'); flush(); }
          else status('Google hat kein Dauer-Token geschickt. Entferne „Focus“ unter myaccount.google.com/permissions und verbinde neu.');
        } catch (e) {
          status(e instanceof TypeError ? 'Der Browser blockiert die Verbindung zu Google. Ohne Client Secret nutzen.' : `Google-Fehler: ${e.message}`);
        }
      },
      error_callback: err => status(`Google-Anmeldung fehlgeschlagen (${err?.type || 'Unbekannt'}).`),
    });
    if (canAuto()) ensureToken().then(ok => ok && flush());
  } catch (e) { console.error('Google Auth Init Error:', e); }
}
let tries = 0;
const waitGoogle = setInterval(() => {
  if (window.google?.accounts?.oauth2) { clearInterval(waitGoogle); initGoogle(); }
  else if (++tries > 40) clearInterval(waitGoogle);
}, 300);

$('#cal-btn').addEventListener('click', () => {
  if (tokenValid() || canAuto()) {
    if (!confirm('Kalender-Verbindung trennen?')) return;
    if (refreshTok()) fetch(REVOKE_URL, { method: 'POST', body: new URLSearchParams({ token: refreshTok() }) }).catch(() => {});
    else try { google.accounts.oauth2.revoke(token, () => {}); } catch {}
    clearAuth(); return status('Kalender-Verbindung getrennt.');
  }
  const v = $('#cal-secret').value.trim();
  if (v) { localStorage.setItem('gcal_secret', v); $('#cal-secret').value = ''; setCal(); }
  const c = secret() ? codeClient : tokenClient;
  if (!c) return status('Google-Skript lädt noch. Bitte kurz warten.');
  try { secret() ? c.requestCode() : c.requestAccessToken({ prompt: linked() ? '' : 'select_account' }); }
  catch { status('Fehler beim Öffnen des Login-Fensters.'); }
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
    colorId: isFocus ? '1' : '9',
    extendedProperties: { private: { focusApp: '1', kind: isFocus ? 'focus' : 'break' } },
  });
  save('focus_pending', pending); flush();
}

let flushing = false;
async function flush() {
  if (!pending.length || flushing) return;
  flushing = true;
  try {
    if (!(await ensureToken())) return setCal();
    while (pending.length) {
      const ev = pending[0];
      const res = await fetch(CAL_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(ev) });
      if (res.status === 401) { dropToken(); flushing = false; return flush(); }
      if (!res.ok) return;
      pending.shift(); save('focus_pending', pending);
      status(`Im Kalender gespeichert: ${ev.summary}`);
    }
  } catch {} finally { flushing = false; }
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
      if (res.status === 401) { dropToken(); return null; }
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
  await ensureToken();
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
if (pending.length) flush();
