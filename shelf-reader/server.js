'use strict';
// Shelf — a small self-hosted reader for EPUB novels and CBZ manga,
// with a typing-practice mode that uses your own books as the text.

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { openZip } = require('./lib/zip');
const { parseEpub } = require('./lib/epub');

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const LIBRARY_DIR = path.resolve(process.env.LIBRARY_DIR || path.join(DATA_DIR, 'library'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const USERNAME = process.env.READER_USER || 'reader';
const PASSWORD = process.env.READER_PASSWORD || '';
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.xhtml': 'application/xhtml+xml; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
// Book content is displayed, never executed.
const BOOK_CSP = "default-src 'self' data: blob:; script-src 'none'; style-src 'self' 'unsafe-inline' data:; object-src 'none'";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// ---------- persistent state (progress + typing stats) ----------

let state = { progress: {}, typing: { totals: {}, days: {}, books: {} }, keys: { letters: {}, confusions: {} }, tests: [] };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
} catch { /* first run */ }
const MAX_TESTS = 2000;

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const tmp = `${STATE_FILE}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(state));
      await fsp.rename(tmp, STATE_FILE);
    } catch (err) {
      console.error('Failed to save state:', err.message);
    }
  }, 250);
}

// ---------- library ----------

const books = new Map(); // id -> book

function kindOf(name) {
  const l = name.toLowerCase();
  if (l.endsWith('.epub')) return 'epub';
  if (l.endsWith('.cbz') || l.endsWith('.zip')) return 'comic';
  return null;
}

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 0.9999) : 0);
const idFor = (rel) => crypto.createHash('sha1').update(rel).digest('hex').slice(0, 16);

async function walk(dir, out) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('.') || ent.name.startsWith('@')) continue; // skip hidden + Synology @eaDir
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) await walk(abs, out);
    else if (ent.isFile() && kindOf(ent.name)) out.push(abs);
  }
}

async function loadMeta(book) {
  const fallbackTitle = path.basename(book.abs).replace(/\.(kepub\.)?[^.]+$/i, '');
  if (book.kind === 'epub') {
    const meta = await parseEpub(book.abs);
    return { ...meta, title: meta.title || fallbackTitle };
  }
  const zip = await openZip(book.abs);
  const pages = zip.names()
    .filter((n) => IMAGE_RE.test(n) && !n.startsWith('__MACOSX/') && !path.posix.basename(n).startsWith('.'))
    .sort(collator.compare);
  return { title: fallbackTitle, pages, cover: pages[0] || null };
}

// A content fingerprint lets reading progress follow a book that was renamed or moved.
async function fingerprint(abs, size) {
  const fh = await fsp.open(abs, 'r');
  try {
    const buf = Buffer.alloc(Math.min(size, 65536));
    await fh.read(buf, 0, buf.length, 0);
    return crypto.createHash('sha1').update(String(size)).update(buf).digest('hex').slice(0, 16);
  } finally {
    await fh.close();
  }
}

function reclaimProgress() {
  const orphans = Object.keys(state.progress).filter((id) => !books.has(id) && state.progress[id].fp);
  let changed = false;
  for (const book of books.values()) {
    const own = state.progress[book.id];
    if (own) {
      if (own.fp !== book.fp) { own.fp = book.fp; changed = true; }
      continue;
    }
    const i = orphans.findIndex((id) => state.progress[id].fp === book.fp);
    if (i < 0) continue;
    const [old] = orphans.splice(i, 1);
    state.progress[book.id] = state.progress[old];
    delete state.progress[old];
    if (state.typing.books[old]) {
      state.typing.books[book.id] = state.typing.books[old];
      delete state.typing.books[old];
    }
    changed = true;
  }
  if (changed) saveState();
}

let scanning = null;
let lastScan = 0;
function scan(force = false) {
  if (!force && Date.now() - lastScan < 3000) return Promise.resolve();
  if (!scanning) {
    scanning = (async () => {
      await fsp.mkdir(LIBRARY_DIR, { recursive: true });
      const files = [];
      await walk(LIBRARY_DIR, files);
      const seen = new Set();
      for (const abs of files) {
        const rel = path.relative(LIBRARY_DIR, abs).split(path.sep).join('/');
        const id = idFor(rel);
        seen.add(id);
        const st = await fsp.stat(abs);
        const old = books.get(id);
        if (old && old.mtimeMs === st.mtimeMs && old.size === st.size) continue;
        const book = { id, rel, abs, kind: kindOf(abs), size: st.size, mtimeMs: st.mtimeMs, added: st.birthtimeMs || st.mtimeMs };
        try {
          book.fp = await fingerprint(abs, st.size);
          book.meta = await loadMeta(book);
        } catch (err) {
          book.error = err.message;
          book.meta = { title: path.basename(abs), spine: [], toc: [], pages: [] };
        }
        books.set(id, book);
      }
      for (const id of books.keys()) if (!seen.has(id)) books.delete(id);
      reclaimProgress();
      lastScan = Date.now();
    })().finally(() => { scanning = null; });
  }
  return scanning;
}

async function getBook(id) {
  if (!books.has(id)) await scan(true);
  return books.get(id);
}

function summary(b) {
  const series = path.posix.dirname(b.rel);
  return {
    id: b.id,
    kind: b.kind,
    title: b.meta.title,
    author: b.meta.author || '',
    series: series === '.' ? '' : series,
    file: b.rel,
    size: b.size,
    added: b.added,
    length: b.kind === 'epub' ? b.meta.spine.length : b.meta.pages.length,
    hasCover: !!b.meta.cover,
    error: b.error || null,
    progress: state.progress[b.id] || null,
  };
}

// ---------- helpers ----------

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

async function readJson(req, limit = 1e6) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

function cleanSegment(s) {
  return s.replace(/[\u0000-\u001f<>:"\\|?*]/g, '').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 200);
}

function authorized(req) {
  if (!PASSWORD) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const [user, ...rest] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
  const a = Buffer.from(`${user}:${rest.join(':')}`);
  const b = Buffer.from(`${USERNAME}:${PASSWORD}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function sendEntry(res, book, name, extraHeaders = {}) {
  const zip = await openZip(book.abs);
  let data;
  try { data = await zip.read(name); } catch (err) {
    if (err.code === 'ENOENT') return send(res, 404, 'Not found');
    throw err;
  }
  const ext = path.extname(name).toLowerCase();
  send(res, 200, data, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found');
  try {
    const data = await fsp.readFile(file);
    // Fonts never change; everything else is revalidated so app updates show up right away.
    const cache = rel.startsWith('fonts/') && rel.endsWith('.woff2') ? 'public, max-age=31536000, immutable' : 'no-cache';
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
  } catch {
    send(res, 404, 'Not found');
  }
}

// ---------- routes ----------

async function handleUpload(req, res) {
  const rawName = decodeURIComponent(req.headers['x-filename'] || '');
  const name = cleanSegment(path.basename(rawName.replace(/\\/g, '/')));
  if (!name || !kindOf(name)) return json(res, 400, { error: 'Only .epub, .cbz and .zip files are supported' });
  const folder = decodeURIComponent(req.headers['x-folder'] || '')
    .split(/[\\/]+/).map(cleanSegment).filter((s) => s && s !== '..').join('/');
  const dir = path.join(LIBRARY_DIR, folder);
  await fsp.mkdir(dir, { recursive: true });

  const tmp = path.join(dir, `.upload-${crypto.randomBytes(6).toString('hex')}`);
  try {
    await pipeline(req, fs.createWriteStream(tmp));
    await openZip(tmp); // reject anything that isn't a readable archive
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    return json(res, 400, { error: `Upload failed: ${err.message}` });
  }

  const ext = name.toLowerCase().endsWith('.kepub.epub') ? '.kepub.epub' : path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let dest = path.join(dir, name);
  for (let n = 1; fs.existsSync(dest); n++) dest = path.join(dir, `${base} (${n})${ext}`);
  await fsp.rename(tmp, dest);
  await scan(true);
  const id = idFor(path.relative(LIBRARY_DIR, dest).split(path.sep).join('/'));
  const book = books.get(id);
  json(res, 201, book ? summary(book) : { id });
}

// Per-key accuracy, shared by typing practice and typing tests.
// letters[char] = [correct, missed, msSum, msCount]; confusions[expected][typed] = count
function recordKeys(body) {
  const { letters, confusions } = state.keys;
  if (body.letters && typeof body.letters === 'object') {
    for (const [ch, v] of Object.entries(body.letters)) {
      if ([...ch].length !== 1 || !Array.isArray(v)) continue;
      const cur = letters[ch] || (letters[ch] = [0, 0, 0, 0]);
      for (let i = 0; i < 4; i++) cur[i] += Number.isFinite(v[i]) && v[i] > 0 ? Math.min(v[i], 1e7) : 0;
    }
  }
  if (body.confusions && typeof body.confusions === 'object') {
    for (const [want, typedMap] of Object.entries(body.confusions)) {
      if ([...want].length !== 1 || !typedMap || typeof typedMap !== 'object') continue;
      const cur = confusions[want] || (confusions[want] = {});
      for (const [got, n] of Object.entries(typedMap)) {
        if ([...got].length === 1 && Number.isFinite(n) && n > 0) cur[got] = (cur[got] || 0) + Math.min(n, 1e5);
      }
    }
  }
}

const SOURCES = new Set(['words', 'books', 'lesson']);

// keybr-style practice state: how many letters are unlocked, the target speed, and a
// smoothed speed per letter. The browser computes it; we just validate and keep it.
function cleanAdaptive(body) {
  const unlocked = Math.round(Number(body.unlocked));
  const target = Math.round(Number(body.target));
  if (!(unlocked >= 1 && unlocked <= 26) || !(target >= 10 && target <= 200)) return null;
  const keys = {};
  for (const [k, v] of Object.entries(body.keys || {})) {
    if (!/^[a-z]$/.test(k) || !v || typeof v !== 'object') continue;
    const speed = Number(v.speed);
    const lessons = Math.round(Number(v.lessons));
    if (Number.isFinite(speed) && speed >= 0 && Number.isFinite(lessons) && lessons >= 0) {
      keys[k] = { speed: Math.min(Math.round(speed * 10) / 10, 400), lessons: Math.min(lessons, 1e6) };
    }
  }
  return { unlocked, target, keys };
}
function recordTest(body) {
  const num = (v, max) => (Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0);
  const test = {
    at: Date.now(),
    duration: num(body.duration, 3600),
    source: SOURCES.has(body.source) ? body.source : 'words',
    label: typeof body.label === 'string' ? body.label.slice(0, 200) : '',
    wpm: Math.round(num(body.wpm, 400) * 10) / 10,
    raw: Math.round(num(body.raw, 400) * 10) / 10,
    acc: Math.round(num(body.acc, 100) * 10) / 10,
    chars: num(body.chars, 1e6),
    errors: num(body.errors, 1e6),
  };
  if (!test.chars) return null;
  state.tests.push(test);
  if (state.tests.length > MAX_TESTS) state.tests.splice(0, state.tests.length - MAX_TESTS);
  recordKeys(body);
  saveState();
  return test;
}

function recordTyping(body) {
  recordKeys(body);
  const n = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
  const delta = { chars: n(body.chars), keystrokes: n(body.keystrokes), errors: n(body.errors), ms: Math.min(n(body.ms), 3.6e6) };
  if (!delta.chars) return;
  const add = (bucket) => {
    for (const k of Object.keys(delta)) bucket[k] = (bucket[k] || 0) + delta[k];
    return bucket;
  };
  const t = state.typing;
  add(t.totals);
  const day = new Date().toISOString().slice(0, 10);
  t.days[day] = add(t.days[day] || {});
  if (typeof body.bookId === 'string' && books.has(body.bookId)) t.books[body.bookId] = add(t.books[body.bookId] || {});
  const wpm = delta.ms ? (delta.chars / 5) / (delta.ms / 60000) : 0;
  if (delta.chars >= 100 && wpm > (t.totals.bestWpm || 0) && wpm < 300) t.totals.bestWpm = Math.round(wpm);
  saveState();
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/healthz') return send(res, 200, 'ok');
  if (!authorized(req)) {
    return send(res, 401, 'Authentication required', { 'WWW-Authenticate': 'Basic realm="Shelf", charset="UTF-8"' });
  }
  if (!p.startsWith('/api/')) return serveStatic(res, p);

  if (p === '/api/books' && req.method === 'GET') {
    await scan(url.searchParams.has('refresh'));
    const list = [...books.values()].map(summary);
    return json(res, 200, list);
  }
  if (p === '/api/upload' && req.method === 'POST') return handleUpload(req, res);
  if (p === '/api/typing' && req.method === 'GET') return json(res, 200, state.typing);
  if (p === '/api/tests' && req.method === 'GET') return json(res, 200, { tests: state.tests, ...state.keys, adaptive: state.adaptive || null });
  if (p === '/api/adaptive' && req.method === 'PUT') {
    const adaptive = cleanAdaptive(await readJson(req));
    if (!adaptive) return json(res, 400, { error: 'Invalid practice state' });
    state.adaptive = adaptive;
    saveState();
    return json(res, 200, adaptive);
  }
  if (p === '/api/tests' && req.method === 'POST') {
    const test = recordTest(await readJson(req));
    return test ? json(res, 201, test) : json(res, 400, { error: 'Empty test' });
  }
  if (p === '/api/typing' && req.method === 'POST') {
    recordTyping(await readJson(req));
    return json(res, 200, state.typing.totals);
  }

  const m = /^\/api\/books\/([0-9a-f]{16})(?:\/(cover|progress|res|page)(?:\/(.*))?)?$/.exec(p);
  if (!m) return json(res, 404, { error: 'Not found' });
  const [, id, action, rest] = m;
  const book = await getBook(id);
  if (!book) return json(res, 404, { error: 'Book not found' });

  if (!action) {
    if (req.method === 'DELETE') {
      await fsp.rm(book.abs, { force: true });
      books.delete(id);
      delete state.progress[id];
      delete state.typing.books[id];
      saveState();
      return json(res, 200, { ok: true });
    }
    const { meta } = book;
    return json(res, 200, {
      ...summary(book),
      spine: meta.spine,
      toc: meta.toc,
      pages: meta.pages ? meta.pages.length : 0,
      typing: state.typing.books[id] || null,
    });
  }
  if (action === 'progress') {
    if (req.method === 'PUT') {
      const body = await readJson(req);
      const prev = state.progress[id] || {};
      const next = { ...prev, ...body, fp: book.fp, updated: Date.now() };
      // The furthest point you've reached, used to keep typing-test passages spoiler free.
      const pos = book.kind === 'epub' ? (Number(next.chapter) || 0) + clamp01(next.scroll) : Number(next.page) || 0;
      next.furthest = Math.max(Number(prev.furthest) || 0, pos);
      state.progress[id] = next;
      saveState();
    }
    return json(res, 200, state.progress[id] || {});
  }
  if (action === 'cover') {
    if (!book.meta.cover) return send(res, 404, 'No cover');
    return sendEntry(res, book, book.meta.cover);
  }
  if (action === 'page' && book.kind === 'comic') {
    const name = book.meta.pages[Number(rest)];
    if (!name) return send(res, 404, 'No such page');
    return sendEntry(res, book, name);
  }
  if (action === 'res' && book.kind === 'epub' && rest) {
    return sendEntry(res, book, decodeURIComponent(rest), { 'Content-Security-Policy': BOOK_CSP });
  }
  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) json(res, err.status || 500, { error: err.message });
    else res.end();
  });
});

server.requestTimeout = 0; // big manga uploads over slow Wi-Fi
server.listen(PORT, () => {
  console.log(`Shelf listening on http://0.0.0.0:${PORT}`);
  console.log(`  library: ${LIBRARY_DIR}`);
  console.log(`  data:    ${DATA_DIR}`);
  if (!PASSWORD) console.log('  WARNING: READER_PASSWORD is not set; anyone on your network can open the reader.');
  scan(true).then(() => console.log(`  ${books.size} book(s) found`));
});
