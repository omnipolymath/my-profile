'use strict';

// ---------- focus aid for the novel reader ----------
// "sentence": highlights one sentence at a time; move it with ↓/↑, the round buttons, or a tap.
// "ruler":    a reading bar that shades everything except the line you're on; drag it or step it.

const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const SENTENCE_BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,dt,dd,figcaption,td,th';

function splitSentences(text, lang) {
  if (window.Intl && Intl.Segmenter) {
    try {
      return [...new Intl.Segmenter(lang || undefined, { granularity: 'sentence' }).segment(text)]
        .map((s) => ({ start: s.index, text: s.segment }));
    } catch { /* unsupported language tag */ }
  }
  return [...text.matchAll(/[^.!?…]*[.!?…]+["'”’»)\]]*\s*|[^.!?…]+$/g)].map((m) => ({ start: m.index, text: m[0] }));
}

function findSentences(doc, selector = SENTENCE_BLOCKS) {
  const body = doc.body;
  if (!body) return [];
  const root = doc.documentElement;
  const lang = root.getAttribute('lang') || root.getAttribute('xml:lang') || '';
  const ranges = [];
  for (const el of body.querySelectorAll(selector)) {
    if (el.querySelector(selector)) continue; // only innermost blocks
    const nodes = [];
    let text = '';
    const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n.parentNode.closest && n.parentNode.closest('rt, rp')) continue;
      nodes.push({ n, start: text.length });
      text += n.data;
    }
    if (!hasWords(text)) continue;
    const at = (pos, isEnd) => {
      for (const { n, start } of nodes) {
        const end = start + n.data.length;
        if (isEnd ? pos > start && pos <= end : pos >= start && pos < end) return [n, pos - start];
      }
      return null;
    };
    for (const s of splitSentences(text, lang)) {
      if (!hasWords(s.text)) continue;
      const a = at(s.start + (s.text.length - s.text.trimStart().length), false);
      const b = at(s.start + s.text.trimEnd().length, true);
      if (!a || !b) continue;
      const r = doc.createRange();
      r.setStart(a[0], a[1]);
      r.setEnd(b[0], b[1]);
      ranges.push(r);
    }
  }
  // Some books put paragraphs in plain <div>s.
  if (!ranges.length && selector === SENTENCE_BLOCKS) return findSentences(doc, `${SENTENCE_BLOCKS},div`);
  return ranges;
}

// Merge a range's per-fragment rects into one box per visual line.
function lineBoxes(range) {
  const lines = [];
  for (const r of range.getClientRects()) {
    if (!r.width || !r.height) continue;
    const line = lines.find((l) => Math.abs(l.top - r.top) < r.height / 2);
    if (line) {
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else {
      lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }
  }
  return lines;
}

function caretAt(doc, x, y) {
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    return r && { node: r.startContainer, offset: r.startOffset };
  }
  return null;
}

function createFocusAid(frame, onEdge) {
  let doc = null;
  let win = null;
  let sentences = null;
  let index = -1;
  let layer = null;
  let band = null;
  let fromEnd = false;

  const lineHeight = () => settings.fontSize * settings.lineHeight;
  const bandHeight = () => Math.round(lineHeight() * 1.15 + 6);

  function clear() {
    layer?.remove();
    band?.remove();
    layer = null;
    band = null;
  }

  function firstVisible() {
    const vh = win.innerHeight;
    for (let i = 0; i < sentences.length; i++) {
      const r = sentences[i].getBoundingClientRect();
      if (r.bottom > vh * 0.08 && r.height) return i;
    }
    return 0;
  }

  function drawSentence() {
    layer.replaceChildren();
    const range = sentences[index];
    if (!range) return;
    for (const l of lineBoxes(range)) {
      const d = doc.createElementNS(XHTML_NS, 'div');
      d.className = 'shelf-hl';
      d.style.cssText = `left:${l.left + win.scrollX - 4}px;top:${l.top + win.scrollY - 1}px;`
        + `width:${l.right - l.left + 8}px;height:${l.bottom - l.top + 2}px`;
      layer.append(d);
    }
  }

  function keepInView() {
    const range = sentences[index];
    if (!range) return;
    const r = range.getBoundingClientRect();
    const vh = win.innerHeight;
    if (r.top < vh * 0.12 || r.bottom > vh * 0.78) {
      win.scrollTo({ top: win.scrollY + r.top - vh * 0.3, behavior: 'smooth' });
    }
  }

  // --- ruler ---
  function snapBand() {
    const vh = win.innerHeight;
    let top = clamp(settings.rulerAt * vh, 0, vh - bandHeight());
    const body = doc.body.getBoundingClientRect();
    band.style.pointerEvents = 'none';
    const c = caretAt(doc, body.left + Math.min(60, body.width / 2), top + bandHeight() / 2);
    band.style.pointerEvents = '';
    if (c && c.node && c.node.nodeType === 3) {
      const r = doc.createRange();
      r.setStart(c.node, Math.min(c.offset, c.node.data.length));
      r.setEnd(c.node, Math.min(c.offset + 1, c.node.data.length));
      const rect = r.getClientRects()[0];
      if (rect && rect.height) top = clamp(rect.top + rect.height / 2 - bandHeight() / 2, 0, vh - bandHeight());
    }
    placeBand(top);
  }

  function placeBand(top) {
    band.style.top = `${top}px`;
    band.style.height = `${bandHeight()}px`;
    settings.rulerAt = top / win.innerHeight;
  }

  function makeBand() {
    band = doc.createElementNS(XHTML_NS, 'div');
    band.id = 'shelf-ruler';
    band.setAttribute('aria-hidden', 'true');
    doc.documentElement.append(band);
    let startY = 0;
    let startTop = 0;
    band.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      startY = e.clientY;
      startTop = band.offsetTop;
      band.setPointerCapture(e.pointerId);
      band.classList.add('dragging');
    });
    band.addEventListener('pointermove', (e) => {
      if (!band.hasPointerCapture(e.pointerId)) return;
      placeBand(clamp(startTop + e.clientY - startY, 0, win.innerHeight - bandHeight()));
    });
    const end = (e) => {
      if (!band.hasPointerCapture(e.pointerId)) return;
      band.releasePointerCapture(e.pointerId);
      band.classList.remove('dragging');
      snapBand();
      saveSettings();
    };
    band.addEventListener('pointerup', end);
    band.addEventListener('pointercancel', end);
    snapBand();
  }

  function moveBand(dir) {
    const vh = win.innerHeight;
    const step = lineHeight();
    const top = band.offsetTop + dir * step;
    if (dir > 0 && top + bandHeight() > vh * 0.82) {
      if (win.scrollY + vh >= doc.documentElement.scrollHeight - 2) { onEdge(1); return; }
      win.scrollBy(0, step); // keep the bar still and move the page under it
    } else if (dir < 0 && top < vh * 0.1) {
      if (win.scrollY <= 0) { onEdge(-1); return; }
      win.scrollBy(0, -step);
    } else {
      placeBand(top);
    }
    snapBand();
    saveSettings();
  }

  function render() {
    clear();
    $('focusNav').hidden = !doc || settings.focus === 'off';
    if (!doc || !doc.body) return;
    if (settings.focus === 'sentence') {
      if (!sentences) sentences = findSentences(doc);
      if (index < 0 || index >= sentences.length) index = fromEnd ? sentences.length - 1 : firstVisible();
      layer = doc.createElementNS(XHTML_NS, 'div');
      layer.id = 'shelf-focus';
      doc.documentElement.append(layer);
      drawSentence();
      if (fromEnd) keepInView();
    } else if (settings.focus === 'ruler') {
      if (settings.rulerAt == null) settings.rulerAt = 0.35;
      makeBand();
    }
    fromEnd = false;
  }

  return {
    attach(d) {
      doc = d;
      win = frame.contentWindow;
      sentences = null;
      index = -1;
      render();
    },
    detach() {
      clear();
      doc = null;
      $('focusNav').hidden = true;
    },
    startAtEnd() { fromEnd = true; },
    refresh() {
      if (settings.focus !== 'sentence') index = -1;
      render();
    },
    move(dir) {
      if (!doc) return;
      if (settings.focus === 'ruler' && band) { moveBand(dir); return; }
      if (settings.focus !== 'sentence' || !sentences) return;
      const next = index + dir;
      if (next >= sentences.length) { onEdge(1); return; }
      if (next < 0) { onEdge(-1); return; }
      index = next;
      drawSentence();
      keepInView();
    },
    click(e) {
      if (!doc || settings.focus === 'off') return;
      if (settings.focus === 'ruler' && band) {
        placeBand(clamp(e.clientY - bandHeight() / 2, 0, win.innerHeight - bandHeight()));
        snapBand();
        saveSettings();
        return;
      }
      if (settings.focus !== 'sentence' || !sentences) return;
      const c = caretAt(doc, e.clientX, e.clientY);
      if (!c) return;
      const i = sentences.findIndex((r) => {
        try { return r.comparePoint(c.node, c.offset) === 0; } catch { return false; }
      });
      if (i >= 0) { index = i; drawSentence(); }
    },
  };
}
