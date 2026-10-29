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
  theme: 'dark',
  fontSize: 19,
  mangaMode: 'single', // single | strip
  mangaDir: 'rtl', // rtl | ltr
  mangaFit: 'height', // height | width
  simplify: true,
  sort: 'recent',
  filter: 'all',
}, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);

const THEMES = ['dark', 'sepia', 'light'];
function applyTheme() {
  document.body.dataset.theme = settings.theme;
  const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]').content = bg;
}
function cycleTheme() {
  settings.theme = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length];
  saveSettings();
  applyTheme();
}

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
const saveProgress = (id, data) => api('PUT', `/api/books/${id}/progress`, data).catch(() => {});

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
  else showLibrary();
}

// ---------- library ----------

let libraryBooks = [];

function percent(b) {
  const p = b.progress;
  if (!p || !b.length) return 0;
  if (b.kind === 'epub') return clamp(((p.chapter || 0) + (p.scroll || 0)) / b.length, 0, 1);
  return clamp(((p.page || 0) + 1) / b.length, 0, 1);
}

async function showLibrary() {
  $('library').hidden = false;
  document.title = 'Shelf';
  $('filter').value = settings.filter;
  $('sort').value = settings.sort;
  const token = viewToken;
  try {
    const [list, typing] = await Promise.all([api('GET', '/api/books'), api('GET', '/api/typing')]);
    if (token !== viewToken) return;
    libraryBooks = list;
    renderTypingSummary(typing);
    renderGrid();
  } catch (err) {
    toast(`Could not load library: ${err.message}`);
  }
}

function renderTypingSummary(typing) {
  const t = typing.totals || {};
  const box = $('typingSummary');
  if (!t.chars) { box.hidden = true; return; }
  const today = (typing.days || {})[new Date().toISOString().slice(0, 10)];
  const wpm = t.ms ? (t.chars / 5) / (t.ms / 60000) : 0;
  const acc = t.keystrokes ? 100 * (1 - t.errors / t.keystrokes) : 100;
  box.innerHTML = `⌨ Typing practice: <b>${fmt(t.chars)}</b> characters typed · avg <b>${fmt(wpm)}</b> WPM · <b>${acc.toFixed(1)}%</b> accuracy`
    + (t.bestWpm ? ` · best paragraph <b>${t.bestWpm}</b> WPM` : '')
    + (today ? ` · today <b>${fmt(today.chars)}</b> chars` : '');
  box.hidden = false;
}

function renderGrid() {
  const q = $('search').value.trim().toLowerCase();
  let list = libraryBooks.filter((b) => settings.filter === 'all' || b.kind === settings.filter);
  if (q) list = list.filter((b) => `${b.title} ${b.author} ${b.series} ${b.file}`.toLowerCase().includes(q));
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  if (settings.sort === 'title') list.sort((a, b) => collator.compare(`${a.series} ${a.title}`, `${b.series} ${b.title}`));
  else if (settings.sort === 'added') list.sort((a, b) => b.added - a.added);
  else list.sort((a, b) => ((b.progress && b.progress.updated) || 0) - ((a.progress && a.progress.updated) || 0) || b.added - a.added);

  const grid = $('grid');
  grid.replaceChildren(...list.map(card));
  $('empty').hidden = libraryBooks.length > 0;
}

function card(b) {
  const el = document.createElement('div');
  el.className = 'card';
  const pct = percent(b);
  const cover = document.createElement('div');
  cover.className = 'cover';
  const placeholder = () => {
    const ph = document.createElement('div');
    ph.className = 'ph';
    ph.textContent = b.title;
    cover.prepend(ph);
  };
  if (b.hasCover) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '';
    img.src = `/api/books/${b.id}/cover`;
    img.onerror = () => { img.remove(); placeholder(); };
    cover.append(img);
  } else {
    placeholder();
  }
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = b.error ? 'Unreadable' : b.kind === 'epub' ? 'Novel' : 'Manga';
  cover.append(badge);
  if (pct > 0) {
    const bar = document.createElement('div');
    bar.className = 'bar-progress';
    bar.innerHTML = `<i style="width:${(pct * 100).toFixed(1)}%"></i>`;
    cover.append(bar);
  }

  const h3 = document.createElement('h3');
  h3.textContent = b.title;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = [b.author || b.series, pct > 0 ? `${Math.round(pct * 100)}%` : ''].filter(Boolean).join(' · ');
  meta.title = b.file;

  const actions = document.createElement('div');
  actions.className = 'actions';
  const btn = (label, cls, fn) => {
    const x = document.createElement('button');
    x.textContent = label;
    x.className = cls;
    x.onclick = (e) => { e.stopPropagation(); fn(); };
    actions.append(x);
  };
  if (b.kind === 'epub') btn('⌨ Type', 'ghost', () => { location.hash = `#/type/${b.id}`; });
  btn('✕', 'ghost del', async () => {
    if (!confirm(`Delete "${b.title}" from the library?\n\nThis removes the file from your NAS.`)) return;
    try {
      await api('DELETE', `/api/books/${b.id}`);
      libraryBooks = libraryBooks.filter((x) => x.id !== b.id);
      renderGrid();
    } catch (err) { toast(err.message); }
  });

  el.append(cover, h3, meta, actions);
  el.onclick = () => { location.hash = `#/read/${b.id}`; };
  return el;
}

async function uploadFiles(fileList) {
  const files = [...fileList].filter((f) => /\.(epub|cbz|zip)$/i.test(f.name));
  if (!files.length) { toast('Only .epub, .cbz and .zip files can be uploaded'); return; }
  for (const f of files) {
    const row = document.createElement('div');
    row.className = 'upload-row';
    row.innerHTML = '<span class="name"></span><progress max="1" value="0"></progress><span class="status muted">waiting</span>';
    row.querySelector('.name').textContent = f.name;
    $('uploads').append(row);
    f.row = row;
  }
  for (const f of files) {
    const row = f.row;
    const status = row.querySelector('.status');
    status.textContent = 'uploading';
    await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('X-Filename', encodeURIComponent(f.name));
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) row.querySelector('progress').value = e.loaded / e.total; };
      const fail = (msg) => {
        row.classList.add('err');
        status.textContent = msg;
        row.onclick = () => row.remove();
        row.title = 'Click to dismiss';
      };
      xhr.onload = () => {
        if (xhr.status < 300) row.remove();
        else {
          let msg = `failed (${xhr.status})`;
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* plain text */ }
          fail(msg);
        }
        resolve();
      };
      xhr.onerror = () => { fail('network error'); resolve(); };
      xhr.send(f);
    });
  }
  if (!$('library').hidden) showLibrary();
}

function setupLibrary() {
  $('search').addEventListener('input', renderGrid);
  $('filter').addEventListener('change', (e) => { settings.filter = e.target.value; saveSettings(); renderGrid(); });
  $('sort').addEventListener('change', (e) => { settings.sort = e.target.value; saveSettings(); renderGrid(); });
  $('uploadBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => { uploadFiles(e.target.files); e.target.value = ''; });
  $('themeBtn').addEventListener('click', cycleTheme);

  let depth = 0;
  const isFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if ($('library').hidden || !isFiles(e)) return;
    depth++;
    $('dropzone').hidden = false;
  });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('dropzone').hidden = true; } });
  window.addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    depth = 0;
    $('dropzone').hidden = true;
    if (!$('library').hidden) uploadFiles(e.dataTransfer.files);
  });
}

// ---------- reader ----------

async function openReader(id, params) {
  const token = viewToken;
  $('reader').hidden = false;
  $('rTitle').textContent = 'Loading…';
  $('rSub').textContent = '';
  const book = await api('GET', `/api/books/${id}`);
  if (token !== viewToken) return;
  if (book.error) throw new Error(`Can't open this file: ${book.error}`);
  document.title = book.title;
  $('rTitle').textContent = book.title;
  const ac = new AbortController();
  const isEpub = book.kind === 'epub';
  $('epubPane').hidden = !isEpub;
  $('epubTools').hidden = !isEpub;
  $('comicPane').hidden = isEpub;
  $('comicTools').hidden = isEpub;
  const stop = isEpub ? epubReader(book, params, ac.signal) : comicReader(book, ac.signal);
  cleanup = () => { ac.abort(); stop(); $('reader').classList.remove('immersive'); };
}

function readerCss() {
  const cs = getComputedStyle(document.body);
  const v = (name) => cs.getPropertyValue(name).trim();
  return `
    html, body { background: ${v('--page')} !important; }
    body { color: ${v('--page-text')} !important; max-width: 40em; margin: 0 auto !important;
      padding: 2em 1.4em 5em !important; font-size: ${settings.fontSize}px !important; line-height: 1.65 !important;
      font-family: Georgia, "Iowan Old Style", "Times New Roman", serif; overflow-wrap: break-word; }
    body * { color: inherit !important; background-color: transparent !important; }
    a, a * { color: ${v('--accent')} !important; }
    img, svg, video { max-width: 100% !important; height: auto !important; }
    p { line-height: inherit !important; }`;
}

function epubReader(book, params, signal) {
  const frame = $('chapter');
  const select = $('tocSelect');
  const spine = book.spine;
  if (!spine.length) throw new Error('This EPUB has no readable chapters');
  const labels = chapterLabels(book);
  select.replaceChildren(...labels.map((l, i) => new Option(l, i)));

  const progress = book.progress || {};
  let ch = clamp(params.has('ch') ? Number(params.get('ch')) || 0 : progress.chapter || 0, 0, spine.length - 1);
  let pendingScroll = params.has('ch') ? Number(params.get('pos')) || 0 : progress.scroll || 0;
  let pendingHash = '';

  const scroller = () => frame.contentDocument && (frame.contentDocument.scrollingElement || frame.contentDocument.documentElement);
  const fraction = () => {
    const s = scroller();
    if (!s) return 0;
    const max = s.scrollHeight - s.clientHeight;
    return max > 0 ? clamp(s.scrollTop / max, 0, 1) : 0;
  };
  const updateInfo = () => {
    const pct = Math.round(((ch + fraction()) / spine.length) * 100);
    $('chInfo').textContent = `Chapter ${ch + 1} of ${spine.length} · ${pct}%`;
    $('rSub').textContent = labels[ch].replace(/^\d+\.\s*/, '');
  };
  const save = debounce(() => saveProgress(book.id, { chapter: ch, scroll: fraction() }), 600);

  function load(i, scroll = 0, hash = '') {
    ch = clamp(i, 0, spine.length - 1);
    pendingScroll = scroll;
    pendingHash = hash;
    select.value = ch;
    $('prevCh').disabled = ch === 0;
    $('nextCh').disabled = ch === spine.length - 1;
    frame.src = resUrl(book.id, spine[ch].href);
  }

  function style(doc) {
    let el = doc.getElementById('shelf-style');
    if (!el) {
      el = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
      el.id = 'shelf-style';
      (doc.head || doc.documentElement).append(el);
    }
    el.textContent = readerCss();
  }

  function restyle() {
    const doc = frame.contentDocument;
    if (!doc) return;
    const f = fraction();
    style(doc);
    const s = scroller();
    s.scrollTop = f * (s.scrollHeight - s.clientHeight);
  }

  const prefix = `/api/books/${book.id}/res/`;
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    if (!doc || frame.src === 'about:blank') return;
    style(doc);
    const s = scroller();
    const target = pendingHash && doc.getElementById(pendingHash);
    if (target) target.scrollIntoView();
    else s.scrollTop = pendingScroll * (s.scrollHeight - s.clientHeight);
    pendingScroll = 0;
    pendingHash = '';
    updateInfo();
    save();

    frame.contentWindow.addEventListener('scroll', () => { updateInfo(); save(); });
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      e.preventDefault();
      const url = new URL(a.href, doc.baseURI);
      if (url.origin !== location.origin) { window.open(url.href, '_blank', 'noopener'); return; }
      if (!url.pathname.startsWith(prefix)) return;
      const href = decodeURIComponent(url.pathname.slice(prefix.length));
      const idx = spine.findIndex((sp) => sp.href === href);
      const hash = decodeURIComponent(url.hash.slice(1));
      if (idx === ch && hash) doc.getElementById(hash)?.scrollIntoView();
      else if (idx >= 0) load(idx, 0, hash);
    });
  }, { signal });

  function onKey(e) {
    if (e.target.closest && e.target.closest('select, input')) return;
    if (e.key === 'ArrowRight' && ch < spine.length - 1) load(ch + 1);
    else if (e.key === 'ArrowLeft' && ch > 0) load(ch - 1);
  }
  window.addEventListener('keydown', onKey, { signal });

  select.addEventListener('change', () => load(Number(select.value)), { signal });
  $('prevCh').addEventListener('click', () => load(ch - 1), { signal });
  $('nextCh').addEventListener('click', () => load(ch + 1), { signal });
  $('fontDown').addEventListener('click', () => { settings.fontSize = clamp(settings.fontSize - 1, 12, 34); saveSettings(); restyle(); }, { signal });
  $('fontUp').addEventListener('click', () => { settings.fontSize = clamp(settings.fontSize + 1, 12, 34); saveSettings(); restyle(); }, { signal });
  $('rTheme').addEventListener('click', () => { cycleTheme(); restyle(); }, { signal });
  $('typeHere').addEventListener('click', () => {
    save.flush();
    location.hash = `#/type/${book.id}?ch=${ch}&pos=${fraction().toFixed(4)}`;
  }, { signal });

  load(ch, pendingScroll);
  return () => {
    save.flush();
    frame.src = 'about:blank';
  };
}

function comicReader(book, signal) {
  const total = book.pages;
  if (!total) throw new Error('No images found in this archive');
  const pageUrl = (i) => `/api/books/${book.id}/page/${i}`;
  const view = $('pageView');
  const img = $('pageImg');
  const strip = $('stripView');
  const slider = $('pageSlider');
  let page = clamp((book.progress && book.progress.page) || 0, 0, total - 1);
  let observer = null;
  slider.max = total - 1;

  const save = debounce(() => saveProgress(book.id, { page }), 600);
  const info = () => {
    $('pageInfo').textContent = `${page + 1} / ${total}`;
    $('rSub').textContent = `Page ${page + 1} of ${total}`;
    slider.value = page;
  };

  function show(i) {
    page = clamp(i, 0, total - 1);
    if (settings.mangaMode === 'single') {
      img.src = pageUrl(page);
      view.scrollTop = 0;
      for (const n of [page + 1, page + 2]) if (n < total) new Image().src = pageUrl(n);
    } else {
      strip.children[page]?.scrollIntoView();
    }
    info();
    save();
  }
  const next = () => { if (page < total - 1) show(page + 1); else toast('Last page'); };
  const prev = () => { if (page > 0) show(page - 1); };

  function buildStrip() {
    observer?.disconnect();
    strip.replaceChildren();
    observer = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        page = Number(en.target.dataset.i);
        info();
        save();
      }
    }, { root: strip, rootMargin: '-50% 0px -50% 0px' });
    for (let i = 0; i < total; i++) {
      const im = document.createElement('img');
      im.loading = 'lazy';
      im.alt = `Page ${i + 1}`;
      im.dataset.i = i;
      im.src = pageUrl(i);
      im.onload = () => im.classList.add('loaded');
      strip.append(im);
      observer.observe(im);
    }
  }

  function render() {
    const single = settings.mangaMode === 'single';
    const rtl = settings.mangaDir === 'rtl';
    $('modeBtn').textContent = single ? '▭ Single page' : '▯ Long strip';
    $('dirBtn').textContent = rtl ? '← Right to left' : 'Left to right →';
    $('dirBtn').hidden = !single;
    $('fitBtn').hidden = !single;
    $('fitBtn').textContent = settings.mangaFit === 'width' ? '↔ Fit width' : '↕ Fit height';
    view.classList.toggle('fit-width', settings.mangaFit === 'width');
    slider.classList.toggle('rtl', rtl && single);
    view.hidden = !single;
    strip.hidden = single;
    if (single) {
      observer?.disconnect();
      strip.replaceChildren();
    } else if (!strip.children.length) {
      buildStrip();
    }
    show(page);
  }

  view.addEventListener('click', (e) => {
    const x = (e.clientX - view.getBoundingClientRect().left) / view.clientWidth;
    if (x > 0.35 && x < 0.65) { $('reader').classList.toggle('immersive'); return; }
    const forward = settings.mangaDir === 'rtl' ? x < 0.35 : x > 0.65;
    if (forward) next(); else prev();
  }, { signal });
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('select, input')) return;
    const rtl = settings.mangaDir === 'rtl' && settings.mangaMode === 'single';
    if (settings.mangaMode === 'single') {
      if (e.key === 'ArrowLeft') rtl ? next() : prev();
      else if (e.key === 'ArrowRight') rtl ? prev() : next();
      else if (e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); next(); }
      else if (e.key === 'PageUp') prev();
    }
  }, { signal });
  slider.addEventListener('input', () => show(Number(slider.value)), { signal });
  $('modeBtn').addEventListener('click', () => { settings.mangaMode = settings.mangaMode === 'single' ? 'strip' : 'single'; saveSettings(); render(); }, { signal });
  $('dirBtn').addEventListener('click', () => { settings.mangaDir = settings.mangaDir === 'rtl' ? 'ltr' : 'rtl'; saveSettings(); render(); }, { signal });
  $('fitBtn').addEventListener('click', () => { settings.mangaFit = settings.mangaFit === 'width' ? 'height' : 'width'; saveSettings(); render(); }, { signal });

  render();
  return () => {
    save.flush();
    observer?.disconnect();
    strip.replaceChildren();
    img.removeAttribute('src');
  };
}

// ---------- typing practice ----------

const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,dt,dd,figcaption,td,th';
const hasWords = (s) => /[\p{L}\p{N}]/u.test(s);

function splitLong(s, max = 450) {
  if (s.length <= max) return [s];
  const sentences = s.match(/[^.!?…]*[.!?…]+["'”’»)\]]*\s*|[^.!?…]+$/g) || [s];
  const out = [];
  let cur = '';
  for (const sentence of sentences) {
    if (cur && (cur + sentence).length > max) { out.push(cur.trim()); cur = ''; }
    cur += sentence;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function extractParagraphs(src) {
  let doc = new DOMParser().parseFromString(src, 'application/xhtml+xml');
  if (doc.getElementsByTagName('parsererror').length) doc = new DOMParser().parseFromString(src, 'text/html');
  const body = doc.getElementsByTagName('body')[0] || doc.documentElement;
  body.querySelectorAll('script, style, rt, rp, noscript').forEach((el) => el.remove());
  body.querySelectorAll('br').forEach((el) => el.replaceWith(' '));
  const collapse = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const leaves = (sel) => [...body.querySelectorAll(sel)].filter((el) => !el.querySelector(sel)).map((el) => collapse(el.textContent));

  const total = collapse(body.textContent).length;
  let texts = leaves(BLOCKS);
  const covered = texts.reduce((n, t) => n + t.length, 0);
  if (total && covered / total < 0.5) texts = leaves(`${BLOCKS},div`);
  if (!texts.some(hasWords)) texts = (body.textContent || '').split(/\n\s*\n/).map(collapse);
  return texts.filter(hasWords).flatMap((t) => splitLong(t));
}

function normalizeText(s, simplify) {
  s = s.replace(/[­​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim();
  if (!simplify) return s;
  return s
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/…/g, '...')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

const IDLE_CAP = 3000; // gaps longer than this (you looked away, turned a page) don't count against WPM

async function openTyping(id, params) {
  const token = viewToken;
  $('typing').hidden = false;
  $('tTitle').textContent = 'Loading…';
  const book = await api('GET', `/api/books/${id}`);
  if (token !== viewToken) return;
  if (book.kind !== 'epub') throw new Error('Typing practice works with novels (EPUB files)');
  if (!book.spine.length) throw new Error('This EPUB has no readable chapters');
  document.title = `Typing · ${book.title}`;
  $('tTitle').textContent = book.title;

  const ac = new AbortController();
  const signal = ac.signal;
  cleanup = () => ac.abort();

  const labels = chapterLabels(book);
  const spine = book.spine;
  const select = $('tChapter');
  select.replaceChildren(...labels.map((l, i) => new Option(l, i)));
  const simplifyBox = $('tSimplify');
  simplifyBox.checked = settings.simplify;

  const area = $('typeArea');
  const input = $('tInput');
  const cur = $('tCurrent');
  const cache = new Map();

  const progress = book.progress || {};
  const typed = progress.typing || {};
  let ch;
  let startPos = null; // fraction of chapter, used when we don't know the paragraph
  let para = 0;
  if (params.has('ch')) { ch = Number(params.get('ch')) || 0; startPos = Number(params.get('pos')) || 0; }
  else if (typed.chapter != null) { ch = typed.chapter; para = typed.para || 0; }
  else { ch = progress.chapter || 0; startPos = progress.scroll || 0; }
  ch = clamp(ch, 0, spine.length - 1);

  let paras = [];
  let chars = [];
  let spans = [];
  let prevLen = 0;
  let lastKey = 0;
  const p = { keys: 0, errors: 0, ms: 0 };
  const session = { chars: 0, keys: 0, errors: 0, ms: 0 };

  const wild = (c) => settings.simplify && /[^\x20-\x7e]/.test(c);
  const matches = (a, t) => a === t || wild(t);

  async function paragraphsOf(i) {
    if (!cache.has(i)) {
      const res = await fetch(resUrl(book.id, spine[i].href));
      cache.set(i, res.ok ? extractParagraphs(await res.text()) : []);
    }
    return cache.get(i);
  }

  async function loadChapter(i, which, direction = 1) {
    // Skip over cover pages / image-only sections.
    let list = await paragraphsOf(i);
    while (!list.length && i + direction >= 0 && i + direction < spine.length) {
      i += direction;
      list = await paragraphsOf(i);
    }
    if (signal.aborted) return;
    if (!list.length) { toast(direction > 0 ? 'You reached the end of the book 🎉' : 'Start of the book'); return; }
    ch = i;
    paras = list;
    select.value = ch;
    if (which === 'last') para = paras.length - 1;
    else if (typeof which === 'number') para = clamp(which, 0, paras.length - 1);
    else para = 0;
    showParagraph();
  }

  function showParagraph() {
    const text = normalizeText(paras[para], settings.simplify);
    chars = [...text];
    spans = chars.map((c) => {
      const s = document.createElement('span');
      s.textContent = c;
      return s;
    });
    cur.classList.remove('done');
    cur.replaceChildren(...spans);
    $('tPrev').textContent = para > 0 ? normalizeText(paras[para - 1], settings.simplify) : '';
    $('tNext').textContent = para < paras.length - 1 ? normalizeText(paras[para + 1], settings.simplify) : '';
    $('tSub').textContent = labels[ch].replace(/^\d+\.\s*/, '');
    $('sPara').textContent = `${para + 1}/${paras.length}`;
    input.value = '';
    prevLen = 0;
    p.keys = 0; p.errors = 0; p.ms = 0;
    paint([]);
    updateStats(0);
    area.scrollTop = 0;
    saveProgress(book.id, { typing: { chapter: ch, para }, chapter: ch, scroll: para / paras.length });
  }

  function paint(typedChars) {
    const n = typedChars.length;
    for (let i = 0; i < spans.length; i++) {
      let cls = '';
      if (i < n) cls = matches(typedChars[i], chars[i]) ? 'ok' : chars[i] === ' ' ? 'bad space' : 'bad';
      else if (i === n) cls = 'cur';
      spans[i].className = cls;
    }
    if (n >= spans.length && spans.length) spans[spans.length - 1].classList.add('cur', 'end');
    const caret = spans[Math.min(n, spans.length - 1)];
    if (caret) caret.scrollIntoView({ block: 'nearest' });
  }

  function updateStats(correctNow) {
    const ms = session.ms + p.ms;
    const correct = session.chars + correctNow;
    const keys = session.keys + p.keys;
    const errors = session.errors + p.errors;
    $('sWpm').textContent = ms > 1500 ? fmt((correct / 5) / (ms / 60000)) : '0';
    $('sAcc').textContent = keys ? `${(100 * (1 - errors / keys)).toFixed(1)}%` : '100%';
    const secs = Math.floor(ms / 1000);
    $('sTime').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  }

  function complete() {
    cur.classList.add('done');
    session.chars += chars.length;
    session.keys += p.keys;
    session.errors += p.errors;
    session.ms += p.ms;
    api('POST', '/api/typing', { bookId: book.id, chars: chars.length, keystrokes: p.keys, errors: p.errors, ms: Math.round(p.ms) }).catch(() => {});
    p.ms = 0; p.keys = 0; p.errors = 0;
    setTimeout(() => { if (!signal.aborted) step(1); }, 180);
  }

  function step(delta) {
    const next = para + delta;
    if (next >= paras.length) {
      if (ch < spine.length - 1) loadChapter(ch + 1, 0, 1);
      else toast('You reached the end of the book 🎉');
    } else if (next < 0) {
      if (ch > 0) loadChapter(ch - 1, 'last', -1);
    } else {
      para = next;
      showParagraph();
    }
  }

  input.addEventListener('input', () => {
    let typedChars = [...input.value];
    if (typedChars.length > chars.length) {
      typedChars = typedChars.slice(0, chars.length);
      input.value = typedChars.join('');
    }
    const now = performance.now();
    if (lastKey) p.ms += Math.min(now - lastKey, IDLE_CAP);
    lastKey = now;
    for (let i = prevLen; i < typedChars.length; i++) {
      p.keys++;
      if (!matches(typedChars[i], chars[i])) p.errors++;
    }
    prevLen = typedChars.length;
    paint(typedChars);
    let correct = 0;
    for (let i = 0; i < typedChars.length; i++) if (matches(typedChars[i], chars[i])) correct++;
    updateStats(correct);
    if (chars.length && correct === chars.length) complete();
  }, { signal });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.blur(); return; }
    if (e.key === 'Enter') { e.preventDefault(); return; }
    if ((e.ctrlKey || e.altKey) && e.key === 'ArrowRight') { e.preventDefault(); step(1); return; }
    if ((e.ctrlKey || e.altKey) && e.key === 'ArrowLeft') { e.preventDefault(); step(-1); return; }
    if (/^(Arrow|Home|End|PageUp|PageDown)/.test(e.key)) e.preventDefault(); // keep the caret at the end
  }, { signal });
  input.addEventListener('paste', (e) => e.preventDefault(), { signal });
  input.addEventListener('focus', () => area.classList.add('focused'), { signal });
  input.addEventListener('blur', () => { area.classList.remove('focused'); lastKey = 0; }, { signal });
  area.addEventListener('click', () => input.focus(), { signal });
  window.addEventListener('keydown', (e) => {
    if (document.activeElement === input || e.target.closest('select, input, button')) return;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) input.focus();
  }, { signal });

  select.addEventListener('change', () => loadChapter(Number(select.value), 0, 1), { signal });
  simplifyBox.addEventListener('change', () => { settings.simplify = simplifyBox.checked; saveSettings(); showParagraph(); input.focus(); }, { signal });
  $('tSkip').addEventListener('click', () => { step(1); input.focus(); }, { signal });
  $('tBack').addEventListener('click', () => { step(-1); input.focus(); }, { signal });
  $('tRead').addEventListener('click', () => {
    location.hash = `#/read/${book.id}?ch=${ch}&pos=${(para / Math.max(paras.length, 1)).toFixed(4)}`;
  }, { signal });

  const first = await paragraphsOf(ch);
  if (signal.aborted) return;
  if (startPos != null) para = Math.floor(clamp(startPos, 0, 0.9999) * first.length + 1e-6);
  await loadChapter(ch, para, 1);
  input.focus();
}

// ---------- boot ----------

applyTheme();
setupLibrary();
window.addEventListener('hashchange', route);
route();
