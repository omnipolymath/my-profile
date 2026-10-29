'use strict';

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
  box.innerHTML = `Typing practice: <b>${fmt(t.chars)}</b> characters typed · avg <b>${fmt(wpm)}</b> WPM · <b>${acc.toFixed(1)}%</b> accuracy`
    + (t.bestWpm ? ` · best paragraph <b>${t.bestWpm}</b> WPM` : '')
    + (today ? ` · today <b>${fmt(today.chars)}</b> chars` : '')
    + ' · <a href="#/tests">typing practice &amp; your weak letters →</a>';
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
  renderContinue();
  const bytes = libraryBooks.reduce((n, b) => n + b.size, 0);
  const size = bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
  $('libInfo').textContent = libraryBooks.length
    ? `${libraryBooks.length} book${libraryBooks.length === 1 ? '' : 's'} · ${size} stored in your library folder on the server`
    : '';
}

function renderContinue() {
  const box = $('continue');
  const last = libraryBooks
    .filter((b) => b.progress && b.progress.updated && percent(b) < 1)
    .sort((a, b) => b.progress.updated - a.progress.updated)[0];
  box.hidden = !last;
  if (!last) return;
  const where = last.kind === 'epub'
    ? `chapter ${(last.progress.chapter || 0) + 1} of ${last.length}`
    : `page ${(last.progress.page || 0) + 1} of ${last.length}`;
  box.querySelector('.c-title').textContent = last.title;
  box.querySelector('.c-where').textContent = `${where} · ${Math.round(percent(last) * 100)}%`;
  const img = box.querySelector('img');
  img.hidden = !last.hasCover;
  if (last.hasCover) img.src = `/api/books/${last.id}/cover`;
  box.querySelector('.c-read').onclick = () => { location.hash = `#/read/${last.id}`; };
  const type = box.querySelector('.c-type');
  type.hidden = last.kind !== 'epub';
  type.onclick = () => { location.hash = `#/type/${last.id}`; };
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
  if (b.kind === 'epub') btn('Type', 'ghost', () => { location.hash = `#/type/${b.id}`; });
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
