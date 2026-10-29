'use strict';

// ---------- typing practice (type the book as you read) ----------

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
  const keyStats = createKeyStats();

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
    saveProgress(book.id, { typing: { chapter: ch, para }, chapter: ch, scroll: para / paras.length, anchor: null });
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
    api('POST', '/api/typing', {
      bookId: book.id, chars: chars.length, keystrokes: p.keys, errors: p.errors, ms: Math.round(p.ms), ...keyStats.take(),
    }).catch(() => {});
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
    const gap = lastKey ? now - lastKey : 0;
    if (lastKey) p.ms += Math.min(gap, IDLE_CAP);
    lastKey = now;
    for (let i = prevLen; i < typedChars.length; i++) {
      p.keys++;
      const ok = matches(typedChars[i], chars[i]);
      if (!ok) p.errors++;
      if (!wild(chars[i])) keyStats.record(chars[i], ok ? chars[i] : typedChars[i], typedChars.length - prevLen === 1 ? gap : 0);
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
