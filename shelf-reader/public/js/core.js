'use strict';

const $ = (id) => document.getElementById(id);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const fmt = (n) => Math.round(n).toLocaleString();

// ---------- settings (per browser) ----------

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`shelf.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`shelf.${key}`, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

const settings = Object.assign({
  theme: 'dark', // dark | light
  font: 'literata',
  fontSize: 19,
  lineHeight: 1.7,
  width: 'medium', // narrow | medium | wide
  focus: 'off', // off | sentence | ruler
  testDuration: 60,
  testSource: 'words', // words | books | weak
  testFont: 'mono',
  typingMode: 'practice', // practice (keybr-style) | speed
  rulerAt: null, // reading ruler position, as a fraction of the screen height
  mangaMode: 'single', // single | strip
  mangaDir: 'rtl', // rtl | ltr
  mangaFit: 'height', // height | width
  simplify: true,
  sort: 'recent',
  filter: 'all',
}, store.get('settings', {}));
if (settings.theme !== 'light') settings.theme = 'dark'; // older versions had a sepia theme
const saveSettings = () => store.set('settings', settings);

// Fonts bundled in /fonts (no internet needed). `stack` is what goes into CSS.
const FONTS = {
  literata: { name: 'Literata', stack: "'Literata Variable', Georgia, serif" },
  lora: { name: 'Lora', stack: "'Lora Variable', Georgia, serif" },
  merriweather: { name: 'Merriweather', stack: "'Merriweather Variable', Georgia, serif" },
  sourceserif: { name: 'Source Serif', stack: "'Source Serif 4 Variable', Georgia, serif" },
  atkinson: { name: 'Atkinson Hyperlegible', stack: "'Atkinson Hyperlegible Next Variable', system-ui, sans-serif" },
  inter: { name: 'Inter', stack: "'Inter Variable', system-ui, sans-serif" },
  opendyslexic: { name: 'OpenDyslexic', stack: "'OpenDyslexic', system-ui, sans-serif" },
  mono: { name: 'JetBrains Mono', stack: "'JetBrains Mono Variable', ui-monospace, monospace" },
  book: { name: "Book's own font", stack: '' },
};
const fontStack = (key) => (FONTS[key] && FONTS[key].stack) || FONTS.literata.stack;

function applyTheme() {
  document.body.dataset.theme = settings.theme;
  document.body.style.setProperty('--read-font', fontStack(settings.font));
  document.body.style.setProperty('--test-font', fontStack(settings.testFont));
  for (const el of document.querySelectorAll('.theme-switch')) el.setAttribute('aria-checked', String(settings.theme === 'light'));
  const forced = document.querySelector('.view.force-dark:not([hidden])');
  const bg = getComputedStyle(forced || document.body).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]').content = bg;
}
// Every .theme-switch on the page is the same light/dark switch.
const themeListeners = new Set();
function toggleTheme() {
  settings.theme = settings.theme === 'light' ? 'dark' : 'light';
  saveSettings();
  applyTheme();
  for (const fn of themeListeners) fn();
}
function setupThemeSwitches() {
  for (const el of document.querySelectorAll('.theme-switch')) {
    el.setAttribute('role', 'switch');
    el.title = 'Light / dark';
    el.innerHTML = '<span class="sw-track"><span class="sw-knob"></span></span><span class="sw-label">Light</span>';
    el.addEventListener('click', toggleTheme);
  }
}

// ---------- per-key stats (what you get wrong, and how long each key takes) ----------

const keyName = (c) => (/\p{L}/u.test(c) ? c.toLowerCase() : c);

function createKeyStats() {
  let letters = {};
  let confusions = {};
  return {
    record(expected, typed, ms) {
      const k = keyName(expected);
      const row = letters[k] || (letters[k] = [0, 0, 0, 0]);
      if (typed === expected) {
        row[0]++;
        if (ms > 0 && ms < IDLE_CAP) { row[2] += Math.round(ms); row[3]++; }
      } else {
        row[1]++;
        const t = keyName(typed);
        const m = confusions[k] || (confusions[k] = {});
        m[t] = (m[t] || 0) + 1;
      }
    },
    take() {
      const out = { letters, confusions };
      letters = {};
      confusions = {};
      return out;
    },
  };
}

const IDLE_CAP = 3000; // gaps longer than this (you looked away, turned a page) don't count

// ---------- api ----------

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    keepalive: method !== 'GET',
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return res.json();
}

const resUrl = (id, href) => `/api/books/${id}/res/${href.split('/').map(encodeURIComponent).join('/')}`;
// Identifies this browser so we can tell when you've read further on another device.
const DEVICE = store.get('device', null) || (() => {
  const id = Math.random().toString(36).slice(2, 10);
  store.set('device', id);
  return id;
})();
const saveProgress = (id, data) => api('PUT', `/api/books/${id}/progress`, { ...data, device: DEVICE }).catch(() => {});

let syncTimer;
function offerJump(text, onJump) {
  const bar = $('syncBar');
  bar.querySelector('span').textContent = text;
  bar.querySelector('.jump').onclick = () => { bar.hidden = true; onJump(); };
  bar.querySelector('.dismiss').onclick = () => { bar.hidden = true; };
  bar.hidden = false;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { bar.hidden = true; }, 15000);
}

// Save immediately when the tab is hidden (phone locked, app switched), and when coming
// back, check whether another device has moved further in this book.
function keepPlace(id, signal, progress, save, onNewer) {
  let seen = (progress && progress.updated) || 0;
  const check = async () => {
    try {
      const p = await api('GET', `/api/books/${id}/progress`);
      if (signal.aborted || !(p.updated > seen) || !p.device || p.device === DEVICE) return;
      seen = p.updated;
      onNewer(p);
    } catch { /* offline */ }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) save.flush(); else check(); }, { signal });
  window.addEventListener('pagehide', () => save.flush(), { signal });
  signal.addEventListener('abort', () => { $('syncBar').hidden = true; });
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function debounce(fn, ms) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  return d;
}

function chapterLabels(book) {
  const byHref = new Map();
  for (const t of book.toc || []) if (!byHref.has(t.href)) byHref.set(t.href, t.label);
  return book.spine.map((s, i) => `${i + 1}. ${byHref.get(s.href) || `Section ${i + 1}`}`);
}

// ---------- router ----------

let cleanup = null;
let viewToken = 0;

function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  viewToken++;
  const [path, query] = location.hash.slice(1).split('?');
  const parts = (path || '/').split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  for (const v of document.querySelectorAll('.view')) v.hidden = true;
  const fail = (err) => { toast(err.message); location.hash = '#/'; };
  if (parts[0] === 'read' && parts[1]) openReader(parts[1], params).catch(fail);
  else if (parts[0] === 'type' && parts[1]) openTyping(parts[1], params).catch(fail);
  else if (parts[0] === 'tests') openTests().catch(fail);
  else showLibrary();
}

// ---------- boot ----------

window.addEventListener('DOMContentLoaded', () => {
  setupThemeSwitches();
  applyTheme();
  setupLibrary();
  window.addEventListener('hashchange', route);
  route();
});
