'use strict';

// ---------- reader ----------

async function openReader(id, params) {
  const token = viewToken;
  const view = $('reader');
  view.hidden = false;
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
  // Manga always stays on a dark background; the light switch only applies to novels.
  view.classList.toggle('force-dark', !isEpub);
  applyTheme();
  const stop = isEpub ? epubReader(book, params, ac.signal) : comicReader(book, ac.signal);
  cleanup = () => {
    ac.abort();
    stop();
    view.classList.remove('immersive', 'force-dark');
    $('readPanel').hidden = true;
    $('focusNav').hidden = true;
    applyTheme();
  };
}

const WIDTHS = { narrow: '31em', medium: '37em', wide: '46em' };

function readerCss() {
  const cs = getComputedStyle(document.body);
  const v = (name) => cs.getPropertyValue(name).trim();
  const font = settings.font === 'book' ? ''
    : `body, body *:not(code):not(pre):not(kbd):not(samp) { font-family: ${fontStack(settings.font)} !important; }`;
  return `
    html, body { background: ${v('--page')} !important; }
    body { color: ${v('--page-text')} !important; max-width: ${WIDTHS[settings.width] || WIDTHS.medium}; margin: 0 auto !important;
      padding: 2em 1.5em 6em !important; font-size: ${settings.fontSize}px !important; line-height: ${settings.lineHeight} !important;
      overflow-wrap: break-word; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
    body * { color: inherit !important; background-color: transparent !important; }
    p, li, blockquote, dd, div, span { line-height: inherit !important; }
    ${font}
    a, a * { color: ${v('--accent')} !important; }
    img, svg, video { max-width: 100% !important; height: auto !important; }
    ::selection { background: ${v('--hl')}; }
    #shelf-focus { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; z-index: 2147483646; }
    .shelf-hl { position: absolute; background: ${v('--hl')}; border-radius: 5px; transition: top .12s ease, left .12s ease, width .12s ease; }
    #shelf-ruler { position: fixed; left: 0; right: 0; z-index: 2147483647; box-shadow: 0 0 0 100vmax ${v('--shade')};
      border-top: 1px solid ${v('--accent-soft')}; border-bottom: 1px solid ${v('--accent-soft')};
      cursor: ns-resize; touch-action: none; transition: top .1s ease; }
    #shelf-ruler.dragging { transition: none; }
    #shelf-ruler::after { content: ""; position: absolute; right: 12px; top: 50%; width: 24px; height: 4px; margin-top: -2px;
      border-radius: 2px; background: ${v('--accent')}; opacity: .7; }`;
}

// Wait (briefly) for the chosen font so the saved position is restored against the final layout.
function fontsReady(doc) {
  const timeout = new Promise((r) => setTimeout(r, 1500));
  let link = doc.getElementById('shelf-fonts');
  const linkLoaded = link ? Promise.resolve() : new Promise((resolve) => {
    link = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link');
    link.id = 'shelf-fonts';
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href', '/fonts/fonts.css');
    link.addEventListener('load', resolve);
    link.addEventListener('error', resolve);
    (doc.head || doc.documentElement).append(link);
  });
  const ready = linkLoaded.then(() => {
    if (settings.font === 'book' || !doc.fonts) return null;
    const stack = fontStack(settings.font);
    return Promise.all([doc.fonts.load(`${settings.fontSize}px ${stack}`), doc.fonts.load(`italic ${settings.fontSize}px ${stack}`)]);
  }).catch(() => {});
  return Promise.race([ready, timeout]);
}

function setupReadPanel(signal, onChange) {
  const panel = $('readPanel');
  const aa = $('aaBtn');
  const setOpen = (open) => { panel.hidden = !open; aa.setAttribute('aria-expanded', String(open)); };
  aa.addEventListener('click', () => setOpen(panel.hidden), { signal });
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== aa) setOpen(false);
  }, { signal });

  const fonts = $('fontChoices');
  fonts.replaceChildren(...Object.entries(FONTS).map(([key, f]) => {
    const b = document.createElement('button');
    b.textContent = f.name;
    b.dataset.v = key;
    b.style.fontFamily = f.stack || 'var(--font-ui)';
    return b;
  }));
  const size = $('sizeRange');
  const line = $('lineRange');
  const hints = {
    off: '',
    sentence: 'The sentence you are on is highlighted. Move it with ↓ / ↑ or the round buttons, or tap any sentence to jump there.',
    ruler: 'A bar marks the line you are reading and shades the rest. Drag it, move it a line at a time with ↓ / ↑ or the round buttons, or tap a line.',
  };
  const sync = () => {
    for (const b of fonts.children) b.classList.toggle('on', b.dataset.v === settings.font);
    size.value = settings.fontSize;
    $('sizeOut').textContent = `${settings.fontSize}px`;
    line.value = settings.lineHeight;
    $('lineOut').textContent = Number(settings.lineHeight).toFixed(2);
    for (const b of $('widthSeg').children) b.classList.toggle('on', b.dataset.v === settings.width);
    for (const b of $('focusSeg').children) b.classList.toggle('on', b.dataset.v === settings.focus);
    $('focusHint').textContent = hints[settings.focus] || '';
  };
  const change = (key, value, kind = 'style') => {
    settings[key] = value;
    saveSettings();
    applyTheme();
    sync();
    onChange(kind);
  };
  fonts.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) change('font', b.dataset.v); }, { signal });
  size.addEventListener('input', () => change('fontSize', Number(size.value)), { signal });
  line.addEventListener('input', () => change('lineHeight', Number(line.value)), { signal });
  $('widthSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) change('width', b.dataset.v); }, { signal });
  $('focusSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) change('focus', b.dataset.v, 'focus'); }, { signal });
  sync();
  return { close: () => setOpen(false) };
}

const ANCHORS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,img,figure,table,dt,dd';

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
  let pendingAnchor = !params.has('ch') && progress.anchor != null && progress.chapter === ch
    ? { anchor: progress.anchor, anchorOffset: progress.anchorOffset || 0 } : null;
  let loads = 0;
  let ready = false;

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
  // The exact paragraph at the top of the screen, so your place survives a different
  // screen size or font size (a plain percentage drifts between phone and PC).
  const anchor = () => {
    const doc = frame.contentDocument;
    if (!doc || !doc.body) return null;
    const els = doc.body.querySelectorAll(ANCHORS);
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (r.bottom > 1) return { anchor: i, anchorOffset: r.height ? clamp(-r.top / r.height, 0, 1) : 0 };
    }
    return null;
  };
  const scrollToAnchor = (a) => {
    const doc = frame.contentDocument;
    const el = a && doc && doc.body && doc.body.querySelectorAll(ANCHORS)[a.anchor];
    if (!el) return false;
    const r = el.getBoundingClientRect();
    scroller().scrollTop += r.top + a.anchorOffset * r.height;
    return true;
  };
  const save = debounce(() => {
    if (!ready || !frame.contentDocument || frame.src === 'about:blank') return;
    saveProgress(book.id, { chapter: ch, scroll: fraction(), ...(anchor() || { anchor: null, anchorOffset: 0 }) });
  }, 600);

  const focus = createFocusAid(frame, (dir) => {
    if (dir > 0 && ch < spine.length - 1) load(ch + 1);
    else if (dir < 0 && ch > 0) { focus.startAtEnd(); load(ch - 1, 1); }
  });

  function load(i, scroll = 0, hash = '', at = null) {
    save.flush();
    ch = clamp(i, 0, spine.length - 1);
    pendingScroll = scroll;
    pendingHash = hash;
    pendingAnchor = at;
    ready = false;
    select.value = ch;
    $('prevCh').disabled = ch === 0;
    $('nextCh').disabled = ch === spine.length - 1;
    frame.style.visibility = 'hidden';
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

  async function restyle() {
    const doc = frame.contentDocument;
    if (!doc || !ready) return;
    const f = fraction();
    const a = anchor();
    style(doc);
    await fontsReady(doc);
    if (!scrollToAnchor(a)) {
      const s = scroller();
      s.scrollTop = f * (s.scrollHeight - s.clientHeight);
    }
    focus.refresh();
    save();
  }

  const prefix = `/api/books/${book.id}/res/`;
  frame.addEventListener('load', async () => {
    const doc = frame.contentDocument;
    if (!doc || frame.src === 'about:blank') return;
    const mine = ++loads;
    style(doc);
    await fontsReady(doc);
    if (mine !== loads || signal.aborted) return;
    const s = scroller();
    const target = pendingHash && doc.getElementById(pendingHash);
    if (target) target.scrollIntoView();
    else if (!scrollToAnchor(pendingAnchor)) s.scrollTop = pendingScroll * (s.scrollHeight - s.clientHeight);
    pendingScroll = 0;
    pendingHash = '';
    pendingAnchor = null;
    ready = true;
    frame.style.visibility = '';
    focus.attach(doc);
    notes.refresh();
    updateInfo();
    save();

    frame.contentWindow.addEventListener('scroll', () => { updateInfo(); save(); selection.hide(); });
    doc.addEventListener('selectionchange', selection.check);
    frame.contentWindow.addEventListener('resize', () => focus.refresh());
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('pointerdown', () => panel.close());
    doc.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) { focus.click(e); return; }
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
    if (e.target.closest && e.target.closest('select, input, textarea')) return;
    if (settings.focus !== 'off' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      focus.move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'ArrowRight' && ch < spine.length - 1) load(ch + 1);
    else if (e.key === 'ArrowLeft' && ch > 0) load(ch - 1);
  }
  window.addEventListener('keydown', onKey, { signal });

  // Select text in the chapter to save it as a quote.
  const notes = setupNotesPanel(book, () => ({
    chapter: ch,
    label: labels[ch].replace(/^\d+\.\s*/, ''),
    goTo: (i) => load(i),
  }), signal);

  const selection = (() => {
    const pop = $('selPop');
    const btn = $('selSave');
    let picked = '';
    const hide = () => { pop.hidden = true; picked = ''; };
    const check = debounce(() => {
      const doc = frame.contentDocument;
      const sel = doc && doc.getSelection();
      const text = sel ? sel.toString().replace(/\s+/g, ' ').trim() : '';
      if (!sel || sel.isCollapsed || text.length < 3 || text.length > 2000) { hide(); return; }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      picked = text;
      const below = rect.top < 50;
      pop.style.left = `${clamp(rect.left + rect.width / 2, 130, frame.clientWidth - 130)}px`;
      pop.style.top = `${clamp(below ? rect.bottom + 50 : rect.top - 8, 48, frame.clientHeight - 8)}px`;
      btn.textContent = findSaved(text) ? '♥ Saved' : '♡ Save quote';
      pop.hidden = false;
    }, 250);
    pop.addEventListener('pointerdown', (e) => e.preventDefault(), { signal });
    $('selNote').addEventListener('click', () => {
      const text = picked;
      frame.contentDocument?.getSelection()?.removeAllRanges();
      hide();
      notes.open(text);
    }, { signal });
    btn.addEventListener('click', async () => {
      if (!picked) return;
      try {
        await saveQuote({
          kind: 'book', text: picked, by: book.author || '', bookId: book.id, chapter: ch,
          from: `${book.title} · ${labels[ch].replace(/^\d+\.\s*/, '')}`,
        });
        toast('Saved to your quotes ♥');
        notes.refresh();
        frame.contentDocument?.getSelection()?.removeAllRanges();
      } catch (err) { toast(err.message); }
      hide();
    }, { signal });
    loadSavedQuotes().catch(() => {});
    return { check, hide };
  })();

  const panel = setupReadPanel(signal, (kind) => {
    if (kind === 'focus') focus.refresh();
    else restyle();
    notes.close();
  });
  themeListeners.add(restyle);
  signal.addEventListener('abort', () => themeListeners.delete(restyle));

  select.addEventListener('change', () => load(Number(select.value)), { signal });
  $('prevCh').addEventListener('click', () => load(ch - 1), { signal });
  $('nextCh').addEventListener('click', () => load(ch + 1), { signal });
  $('focusUp').addEventListener('click', () => focus.move(-1), { signal });
  $('focusDown').addEventListener('click', () => focus.move(1), { signal });
  $('typeHere').addEventListener('click', () => {
    save.flush();
    location.hash = `#/type/${book.id}?ch=${ch}&pos=${fraction().toFixed(4)}`;
  }, { signal });

  keepPlace(book.id, signal, progress, save, (p) => {
    if (p.chapter == null) return;
    offerJump(`You read further on another device: ${(labels[p.chapter] || '').replace(/^\d+\.\s*/, '') || `chapter ${p.chapter + 1}`}.`, () => {
      load(p.chapter, p.scroll || 0, '', p.anchor != null ? { anchor: p.anchor, anchorOffset: p.anchorOffset || 0 } : null);
    });
  });

  load(ch, pendingScroll, '', pendingAnchor);
  return () => {
    save.flush();
    selection.hide();
    focus.detach();
    frame.style.visibility = '';
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
    notes?.refresh();
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
    if (e.target.closest('select, input, textarea')) return;
    const rtl = settings.mangaDir === 'rtl' && settings.mangaMode === 'single';
    if (settings.mangaMode === 'single') {
      if (e.key === 'ArrowLeft') rtl ? next() : prev();
      else if (e.key === 'ArrowRight') rtl ? prev() : next();
      else if (e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); next(); }
      else if (e.key === 'PageUp') prev();
    }
  }, { signal });
  slider.addEventListener('input', () => show(Number(slider.value)), { signal });
  const notes = setupNotesPanel(book, () => ({ chapter: null, label: `Page ${page + 1}` }), signal);
  keepPlace(book.id, signal, book.progress, save, (p) => {
    if (p.page == null || p.page === page) return;
    offerJump(`You're on page ${p.page + 1} on another device.`, () => show(p.page));
  });
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
