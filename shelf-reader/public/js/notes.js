'use strict';

// ---------- notes (saved as Markdown in your Obsidian vault) ----------

let vaultInfo = null;
async function getVaultInfo() {
  if (!vaultInfo) vaultInfo = await api('GET', '/api/vault');
  return vaultInfo;
}
const obsidianUrl = (p) => (vaultInfo && vaultInfo.vaultName && p
  ? `obsidian://open?vault=${encodeURIComponent(vaultInfo.vaultName)}&file=${encodeURIComponent(p.replace(/\.md$/i, ''))}`
  : null);

// Small, safe Markdown renderer covering what notes usually use, plus Obsidian's
// ==highlights==, [[wikilinks]] and %% comments %%.
function renderMarkdown(src) {
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/==([^=\n]+)==/g, '<mark>$1</mark>')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '<span class="wikilink">$2</span>')
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="wikilink">$1</span>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  let text = src.replace(/\r\n/g, '\n').replace(/%%[\s\S]*?%%\n?/g, '');
  let props = '';
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (fm) {
    text = text.slice(fm[0].length);
    const rows = [];
    let key = null;
    for (const line of fm[1].split('\n')) {
      const kv = /^([\w-]+):\s*(.*)$/.exec(line);
      if (kv) { key = kv[1]; rows.push([key, kv[2].replace(/^"(.*)"$/, '$1')]); }
      else if (key && /^\s+-\s+/.test(line)) rows[rows.length - 1][1] += `${rows[rows.length - 1][1] ? ', ' : ''}${line.replace(/^\s+-\s+/, '')}`;
    }
    props = `<dl class="md-props">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  }

  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^#+/)[0].length;
      out.push(`<h${level}>${inline(line.replace(/^#+\s*/, ''))}</h${level}>`);
      i++;
    } else if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push('<hr>');
      i++;
    } else if (/^>/.test(line)) {
      const q = [];
      for (; i < lines.length && /^>/.test(lines[i]); i++) q.push(lines[i].replace(/^>\s?/, ''));
      out.push(`<blockquote>${q.map(inline).join('<br>')}</blockquote>`);
    } else if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      for (; i < lines.length && /^\s*([-*+]|\d+\.)\s/.test(lines[i]); i++) {
        const item = lines[i].replace(/^\s*([-*+]|\d+\.)\s/, '');
        const task = /^\[( |x)\]\s/i.exec(item);
        items.push(task ? `<li class="task"><input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}> ${inline(item.slice(4))}</li>` : `<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
    } else if (!line.trim()) {
      i++;
    } else {
      const para = [];
      for (; i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>|```|\s*([-*+]|\d+\.)\s)/.test(lines[i]); i++) para.push(lines[i]);
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    }
  }
  return props + out.join('\n');
}

function obsidianLink(el, p) {
  const href = obsidianUrl(p);
  el.hidden = !href;
  if (href) el.href = href;
}

// ---------- notes panel inside the reader ----------

function setupNotesPanel(book, getPlace, signal) {
  const panel = $('notesPanel');
  const list = $('npList');
  const input = $('npText');
  const quoteBox = $('npQuote');
  let quote = '';
  let entries = [];
  let notePath = null;

  const setQuote = (q) => {
    quote = q || '';
    quoteBox.hidden = !quote;
    quoteBox.querySelector('blockquote').textContent = quote;
  };

  function render() {
    const place = getPlace();
    $('npPlace').textContent = place.label;
    input.placeholder = `Write a note about ${place.label.toLowerCase().startsWith('page') ? 'this page' : place.label}…`;
    obsidianLink($('npObsidian'), notePath);
    $('npFile').textContent = notePath ? `Saved in your vault: ${notePath}` : 'Your first note creates this book’s page in your Obsidian vault.';
    if (!entries.length) {
      list.innerHTML = '<p class="muted np-empty">No notes for this book yet.</p>';
      return;
    }
    list.replaceChildren(...entries.map((e) => {
      const item = document.createElement('article');
      item.className = 'np-entry';
      if (e.chapter != null && e.chapter === place.chapter) item.classList.add('here');
      const h = document.createElement('h4');
      h.textContent = e.heading;
      item.append(h);
      if (e.quote) {
        const q = document.createElement('blockquote');
        q.textContent = e.quote;
        item.append(q);
      }
      const body = document.createElement('div');
      body.className = 'md';
      body.innerHTML = renderMarkdown(e.body || '');
      item.append(body);
      const actions = document.createElement('div');
      actions.className = 'np-actions';
      const btn = (label, fn) => {
        const b = document.createElement('button');
        b.className = 'ghost';
        b.textContent = label;
        b.addEventListener('click', fn);
        actions.append(b);
      };
      if (e.chapter != null && e.chapter !== place.chapter && place.goTo) btn('Go to chapter', () => place.goTo(e.chapter));
      btn('Edit', () => {
        const ta = document.createElement('textarea');
        ta.className = 'np-edit';
        ta.value = e.body;
        body.replaceWith(ta);
        actions.replaceChildren();
        btn('Save', async () => {
          try { await api('PUT', `/api/books/${book.id}/notes/${e.id}`, { body: ta.value }); await load(); } catch (err) { toast(err.message); load(); }
        });
        btn('Cancel', render);
        ta.focus();
      });
      btn('Delete', async () => {
        if (!confirm('Delete this note? It is removed from your Obsidian vault too.')) return;
        try { await api('DELETE', `/api/books/${book.id}/notes/${e.id}`); } catch (err) { toast(err.message); }
        load();
      });
      item.append(actions);
      return item;
    }));
    list.querySelector('.np-entry.here:last-of-type')?.scrollIntoView({ block: 'nearest' });
  }

  let loads = 0;
  async function load() {
    const mine = ++loads; // only the newest load wins, so a slow earlier one can't hide a new note
    try {
      const data = await api('GET', `/api/books/${book.id}/notes`);
      if (mine !== loads) return;
      entries = data.entries;
      notePath = data.path;
    } catch (err) { if (mine === loads) toast(err.message); }
    if (!signal.aborted && mine === loads) render();
  }

  async function submit() {
    const body = input.value.trim();
    if (!body && !quote) { input.focus(); return; }
    const place = getPlace();
    try {
      await api('POST', `/api/books/${book.id}/notes`, { chapter: place.chapter, chapterLabel: place.label, quote, body });
      input.value = '';
      setQuote('');
      toast(vaultInfo && vaultInfo.vaultName ? 'Note saved to Obsidian' : 'Note saved');
      await load();
    } catch (err) { toast(err.message); }
  }

  const open = (prefillQuote) => {
    panel.hidden = false;
    $('notesBtn').setAttribute('aria-expanded', 'true');
    $('notesBtnComic').setAttribute('aria-expanded', 'true');
    if (prefillQuote != null) setQuote(prefillQuote);
    load();
    setTimeout(() => input.focus(), 50);
  };
  const close = () => {
    panel.hidden = true;
    $('notesBtn').setAttribute('aria-expanded', 'false');
    $('notesBtnComic').setAttribute('aria-expanded', 'false');
  };

  $('npSave').addEventListener('click', submit, { signal });
  $('npClose').addEventListener('click', close, { signal });
  $('npQuoteClear').addEventListener('click', () => setQuote(''), { signal });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') close();
    e.stopPropagation(); // don't turn pages while writing
  }, { signal });
  for (const id of ['notesBtn', 'notesBtnComic']) {
    $(id).addEventListener('click', () => (panel.hidden ? open() : close()), { signal });
  }
  signal.addEventListener('abort', () => { close(); setQuote(''); input.value = ''; });
  getVaultInfo().catch(() => {});
  return { open, close, refresh: () => { if (!panel.hidden) render(); } };
}

// ---------- the Notes page ----------

async function openNotes() {
  const token = viewToken;
  $('notes').hidden = false;
  document.title = 'Notes · Shelf';
  const [info, files] = await Promise.all([getVaultInfo(), api('GET', '/api/notes')]);
  if (token !== viewToken) return;
  const ac = new AbortController();
  const signal = ac.signal;
  let current = null; // { path, content, mtime }
  let dirty = false;
  let files_ = files;

  const editor = $('noteEditor');
  const preview = $('notePreview');
  const status = $('noteStatus');
  const setStatus = (text, cls = '') => { status.textContent = text; status.className = `note-status muted ${cls}`; };

  $('vaultHint').innerHTML = info.configured
    ? `Notes are Markdown files in your Obsidian vault, in the <b></b> folder. Edit them here or in Obsidian.`
    : 'Notes are saved as Markdown files in Shelf’s data folder (<b></b>). To use your own Obsidian vault, set <code>OBSIDIAN_VAULT</code> in docker-compose.yml.';
  $('vaultHint').querySelector('b').textContent = `${info.folder}/`;

  const save = debounce(async (force = false) => {
    if (!current || !dirty) return;
    const content = editor.value;
    setStatus('Saving…');
    try {
      const r = await api('PUT', `/api/notes/file?path=${encodeURIComponent(current.path)}`, { content, baseMtime: force ? 0 : current.mtime });
      current.mtime = r.mtime;
      current.content = content;
      dirty = editor.value !== content;
      setStatus(`Saved · ${current.path}`);
      refreshList();
    } catch (err) {
      if (/changed somewhere else/.test(err.message)) {
        setStatus('This note was changed in Obsidian. ', 'warn');
        const reload = document.createElement('button');
        reload.className = 'ghost small';
        reload.textContent = 'Load their version';
        reload.onclick = () => openFile(current.path, true);
        const keep = document.createElement('button');
        keep.className = 'ghost small';
        keep.textContent = 'Keep mine';
        keep.onclick = () => save.flush(true);
        status.append(reload, keep);
      } else setStatus(err.message, 'warn');
    }
  }, 700);

  function renderPreview() {
    preview.innerHTML = renderMarkdown(editor.value);
  }
  function setMode(mode) {
    settings.noteMode = mode;
    saveSettings();
    for (const b of $('noteModeSeg').children) b.classList.toggle('on', b.dataset.v === mode);
    editor.hidden = mode !== 'edit';
    preview.hidden = mode !== 'preview';
    if (mode === 'preview') renderPreview();
  }

  function renderList() {
    const q = $('noteSearch').value.trim().toLowerCase();
    const groups = [['note', 'Notes'], ['book', 'Books'], ['quotes', 'Quotes']];
    const box = $('noteList');
    box.replaceChildren();
    for (const [kind, label] of groups) {
      const list = files_.filter((f) => f.kind === kind && (!q || f.title.toLowerCase().includes(q)));
      if (!list.length) continue;
      const h = document.createElement('h3');
      h.textContent = label;
      box.append(h);
      for (const f of list) {
        const b = document.createElement('button');
        b.className = 'note-item';
        if (current && current.path === f.path) b.classList.add('on');
        b.innerHTML = '<span></span><small class="muted"></small>';
        b.querySelector('span').textContent = f.title;
        b.querySelector('small').textContent = new Date(f.mtime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        b.addEventListener('click', () => openFile(f.path), { signal });
        box.append(b);
      }
    }
    if (!box.children.length) box.innerHTML = `<p class="muted">${q ? 'No matching notes.' : 'No notes yet. Create one above, or add notes while reading a book.'}</p>`;
  }
  async function refreshList() {
    try { files_ = await api('GET', '/api/notes'); } catch { return; }
    if (!signal.aborted) renderList();
  }

  async function openFile(p, discard = false) {
    if (dirty && !discard) save.flush();
    try {
      current = await api('GET', `/api/notes/file?path=${encodeURIComponent(p)}`);
    } catch (err) { toast(err.message); return; }
    dirty = false;
    settings.lastNote = p;
    saveSettings();
    editor.value = current.content;
    $('noteTitle').textContent = current.path.split('/').pop().replace(/\.md$/, '');
    $('notePane').hidden = false;
    $('notesLayout').classList.add('has-note');
    obsidianLink($('noteObsidian'), current.path);
    setStatus(`Saved · ${current.path}`);
    setMode(settings.noteMode === 'preview' ? 'preview' : 'edit');
    renderList();
  }

  editor.addEventListener('input', () => { dirty = true; setStatus('Editing…'); save(); }, { signal });
  editor.addEventListener('keydown', (e) => {
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save.flush(); }
  }, { signal });
  $('noteModeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.v); }, { signal });
  $('noteSearch').addEventListener('input', renderList, { signal });
  $('noteNewForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('noteNewTitle').value.trim();
    if (!title) { $('noteNewTitle').focus(); return; }
    try {
      const r = await api('POST', '/api/notes', { title });
      $('noteNewTitle').value = '';
      await refreshList();
      await openFile(r.path);
      setMode('edit');
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
    } catch (err) { toast(err.message); }
  }, { signal });
  $('noteDelete').addEventListener('click', async () => {
    if (!current || !confirm(`Delete "${$('noteTitle').textContent}"? This removes the file from your Obsidian vault.`)) return;
    try { await api('DELETE', `/api/notes/file?path=${encodeURIComponent(current.path)}`); } catch (err) { toast(err.message); return; }
    current = null;
    dirty = false;
    $('notePane').hidden = true;
    $('notesLayout').classList.remove('has-note');
    refreshList();
  }, { signal });
  $('noteBack').addEventListener('click', () => { save.flush(); $('notesLayout').classList.remove('has-note'); }, { signal });
  // Pick up edits made in Obsidian when you come back to this tab.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { save.flush(); return; }
    refreshList();
    if (current && !dirty) openFile(current.path, true);
  }, { signal });
  window.addEventListener('pagehide', () => save.flush(), { signal });

  cleanup = () => { save.flush(); ac.abort(); };
  $('notePane').hidden = true;
  $('notesLayout').classList.remove('has-note');
  renderList();
  const last = settings.lastNote && files_.find((f) => f.path === settings.lastNote);
  if (last && window.innerWidth > 720) openFile(last.path);
}
