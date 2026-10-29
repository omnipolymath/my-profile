'use strict';

// ---------- typing: keybr-style adaptive practice + timed speed tests ----------
//
// Practice works like keybr.com: you start with a handful of letters and type short lessons of
// made-up (but pronounceable) words using only those letters. Each lesson leans on your slowest
// letter. When every unlocked letter reaches your target speed, the next letter unlocks.

const KEY_ORDER = [...'enitrlsauodychgmpbkvwfzxqj'];
const START_KEYS = 6;
const TARGETS = [20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 100];
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', ",.;'-?!"];
const LESSON_CHARS = 58;
let wordModel = null;

const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const keyWpm = (ms) => 12000 / ms; // one keystroke every `ms` milliseconds, as words per minute

// A typing surface shared by practice (cursor stops on mistakes) and speed tests (mistakes
// are marked and you can backspace).
function createTyper(box, wordsEl, input, signal, opts) {
  let chars = [];
  let spans = [];
  let typed = [];
  let pos = 0;
  let started = 0;
  let lastOk = 0;
  let lastKey = 0;
  let keys = 0;
  let errors = 0;
  let missedHere = false;
  let done = true;
  let caret = null;

  function setCaret() {
    caret?.classList.remove('cur', 'end');
    caret = spans[Math.min(pos, spans.length - 1)];
    if (!caret) return;
    caret.classList.add('cur');
    if (pos >= spans.length) caret.classList.add('end');
    const lh = parseFloat(getComputedStyle(wordsEl).lineHeight) || 40;
    wordsEl.scrollTop = Math.max(0, Math.round(caret.offsetTop / lh) - 1) * lh;
  }

  function setText(text) {
    chars = [...text];
    typed = [];
    pos = 0;
    started = 0;
    keys = 0;
    errors = 0;
    missedHere = false;
    done = false;
    spans = [];
    const frag = document.createDocumentFragment();
    let word = null;
    for (const c of chars) {
      if (!word) {
        word = document.createElement('span');
        word.className = 'w';
        frag.append(word);
      }
      const s = document.createElement('span');
      s.textContent = c;
      word.append(s);
      spans.push(s);
      if (c === ' ') word = null;
    }
    wordsEl.replaceChildren(frag);
    caret = null;
    setCaret();
  }

  function finish() {
    if (done) return;
    done = true;
    const ms = started ? performance.now() - started : 0;
    const correct = opts.stopOnError() ? pos : typed.filter((c, i) => c === chars[i]).length;
    opts.onDone({ ms, keys, errors, correct, typedLen: pos, total: chars.length });
  }

  function handleChar(c) {
    if (done || pos >= chars.length) return;
    const now = performance.now();
    if (!started) { started = now; lastOk = now; opts.onStart(); }
    const gap = lastKey ? now - lastKey : 0;
    lastKey = now;
    const expected = chars[pos];
    keys++;
    if (opts.stopOnError()) {
      if (c === expected) {
        spans[pos].className = missedHere ? 'fixed' : 'ok';
        opts.onKey(expected, c, pos > 0 ? now - lastOk : 0);
        lastOk = now;
        missedHere = false;
        pos++;
      } else {
        errors++;
        if (!missedHere) opts.onKey(expected, c, 0);
        missedHere = true;
        const s = spans[pos];
        s.className = expected === ' ' ? 'bad space' : 'bad';
        void s.offsetWidth; // restart the shake animation
        s.classList.add('miss');
      }
    } else {
      const ok = c === expected;
      if (!ok) errors++;
      typed[pos] = c;
      spans[pos].className = ok ? 'ok' : expected === ' ' ? 'bad space' : 'bad';
      opts.onKey(expected, c, ok && pos > 0 ? Math.min(gap, IDLE_CAP) : 0);
      pos++;
    }
    setCaret();
    opts.onProgress();
    if (pos >= chars.length) finish();
  }

  function back(word) {
    if (done || opts.stopOnError() || pos === 0) return;
    do {
      pos--;
      typed.pop();
      spans[pos].className = '';
    } while (word && pos > 0 && chars[pos - 1] !== ' ');
    setCaret();
  }

  // Keep one character in the box so Backspace still fires on phones.
  const SENTINEL = ' ';
  const reset = () => { input.value = SENTINEL; };
  input.addEventListener('beforeinput', (e) => {
    const t = e.inputType;
    if (t === 'insertText' || t === 'insertReplacementText') { e.preventDefault(); for (const c of e.data || '') handleChar(c); }
    else if (t === 'deleteContentBackward') { e.preventDefault(); back(false); }
    else if (t === 'deleteWordBackward') { e.preventDefault(); back(true); }
    else if (!t.startsWith('insertComposition')) e.preventDefault();
  }, { signal });
  input.addEventListener('compositionend', (e) => {
    for (const c of e.data || '') handleChar(c);
    reset();
  }, { signal });
  input.addEventListener('input', (e) => {
    if (e.isComposing) return;
    const v = input.value.startsWith(SENTINEL) ? input.value.slice(1) : input.value;
    reset();
    for (const c of v) handleChar(c);
  }, { signal });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace') { e.preventDefault(); back(e.ctrlKey || e.altKey); }
    else if (/^(Arrow|Home|End|PageUp|PageDown|Enter)/.test(e.key)) e.preventDefault();
  }, { signal });
  input.addEventListener('focus', () => { box.classList.add('focused'); reset(); }, { signal });
  input.addEventListener('blur', () => { box.classList.remove('focused'); lastKey = 0; }, { signal });
  box.addEventListener('click', () => input.focus(), { signal });
  reset();

  return {
    setText,
    finish,
    stop() { done = true; },
    live() {
      const ms = started ? performance.now() - started : 0;
      const correct = opts.stopOnError() ? pos : typed.filter((c, i) => c === chars[i]).length;
      return { ms, correct, started: !!started, done };
    },
  };
}

// Spoiler-free passages: only from the parts of your novels you've already reached.
const bookCache = new Map();
async function bookPassage(minChars) {
  const furthest = (b) => {
    const p = b.progress || {};
    return Number(p.furthest) || (p.chapter || 0) + (p.scroll || 0);
  };
  const list = (await api('GET', '/api/books')).filter((b) => b.kind === 'epub' && furthest(b) > 0.02);
  list.sort(() => Math.random() - 0.5);
  for (const b of list) {
    if (!bookCache.has(b.id)) bookCache.set(b.id, { detail: await api('GET', `/api/books/${b.id}`), chapters: new Map() });
    const entry = bookCache.get(b.id);
    const { detail } = entry;
    const f = furthest(b);
    const lastCh = Math.min(Math.floor(f), detail.spine.length - 1);
    const frac = f - Math.floor(f);
    for (let tries = 0; tries < 6; tries++) {
      const c = randomInt(lastCh + 1);
      if (!entry.chapters.has(c)) {
        const res = await fetch(resUrl(b.id, detail.spine[c].href));
        entry.chapters.set(c, res.ok ? extractParagraphs(await res.text()) : []);
      }
      const paras = entry.chapters.get(c);
      const allowed = c < lastCh ? paras.length : Math.floor(frac * paras.length);
      if (allowed < 1) continue;
      const clean = (p) => normalizeText(p, true).replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
      let start = randomInt(allowed);
      let end = start;
      const parts = [];
      let total = 0;
      while (end < allowed && total < minChars) { const t = clean(paras[end++]); parts.push(t); total += t.length + 1; }
      while (start > 0 && total < minChars) { const t = clean(paras[--start]); parts.unshift(t); total += t.length + 1; }
      const text = parts.filter(Boolean).join(' ');
      if (text.length < 40) continue;
      return { text, label: `${detail.title} · ${chapterLabels(detail)[c].replace(/^\d+\.\s*/, '')}` };
    }
  }
  return null;
}

function commonWords(count) {
  const out = [];
  while (out.length < count) {
    const w = pick(COMMON_WORDS);
    if (w !== out[out.length - 1]) out.push(w);
  }
  return out.join(' ');
}

// ---------- charts + stats ----------

function showTip(html, x, y) {
  const tip = $('tooltip');
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = `${clamp(x + 14, 8, window.innerWidth - r.width - 8)}px`;
  tip.style.top = `${clamp(y - r.height - 12, 8, window.innerHeight - r.height - 8)}px`;
}
const hideTip = () => { $('tooltip').hidden = true; };

function describeTest(t) {
  const when = new Date(t.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const len = t.source === 'lesson' ? 'lesson' : t.duration >= 60 ? `${t.duration / 60} min` : `${t.duration}s`;
  const text = t.source === 'lesson' ? t.label || 'practice' : t.source === 'books' ? t.label || 'my books' : 'common words';
  return { when, len, text };
}

function drawChart(el, tests, signal) {
  el.replaceChildren();
  if (tests.length < 2) {
    el.innerHTML = '<div class="empty-msg">Finish a couple of rounds and your speed will be charted here.</div>';
    return;
  }
  const W = Math.max(el.clientWidth, 280);
  const H = el.clientHeight || 220;
  const m = { l: 34, r: 10, t: 10, b: 22 };
  const max = Math.max(...tests.map((t) => t.wpm));
  const step = max > 80 ? 20 : max > 40 ? 10 : 5;
  const top = Math.ceil((max * 1.1) / step) * step || step;
  const x = (i) => m.l + (i / (tests.length - 1)) * (W - m.l - m.r);
  const y = (v) => H - m.b - (v / top) * (H - m.t - m.b);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Words per minute over your last ${tests.length} rounds`);
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    svg.append(n);
    return n;
  };
  for (let v = 0; v <= top; v += step) {
    add('line', { class: 'grid-line', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) });
    add('text', { class: 'axis-text', x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, v);
  }
  const fmtDate = (t) => new Date(t.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  add('text', { class: 'axis-text', x: m.l, y: H - 4 }, fmtDate(tests[0]));
  add('text', { class: 'axis-text', x: W - m.r, y: H - 4, 'text-anchor': 'end' }, fmtDate(tests[tests.length - 1]));
  const pts = tests.map((t, i) => `${x(i).toFixed(1)},${y(t.wpm).toFixed(1)}`);
  add('path', { class: 'area', d: `M${x(0)},${y(0)} L${pts.join(' L')} L${x(tests.length - 1)},${y(0)} Z` });
  add('path', { class: 'line', d: `M${pts.join(' L')}` });
  if (tests.length <= 30) tests.forEach((t, i) => add('circle', { class: 'dot', cx: x(i), cy: y(t.wpm), r: 4 }));
  const cross = add('line', { class: 'cross', y1: m.t, y2: H - m.b, visibility: 'hidden' });
  const hover = add('circle', { class: 'dot', r: 5, visibility: 'hidden' });
  const hit = add('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent' });
  hit.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = clamp(Math.round(((px - m.l) / (W - m.l - m.r)) * (tests.length - 1)), 0, tests.length - 1);
    const t = tests[i];
    const d = describeTest(t);
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    hover.setAttribute('cx', x(i)); hover.setAttribute('cy', y(t.wpm)); hover.setAttribute('visibility', 'visible');
    showTip(`<b>${t.wpm} WPM</b> · ${t.acc}% accuracy<br><span class="muted">${d.when} · ${d.len} · ${d.text}</span>`, e.clientX, e.clientY);
  }, { signal });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    hover.setAttribute('visibility', 'hidden');
    hideTip();
  }, { signal });
  el.append(svg);
}

function letterRows(letters, confusions) {
  return Object.entries(letters).map(([k, [hits, misses, ms, n]]) => {
    const total = hits + misses;
    const conf = confusions[k] ? Object.entries(confusions[k]).sort((a, b) => b[1] - a[1])[0] : null;
    return { k, hits, misses, total, rate: total ? misses / total : 0, wpm: n ? keyWpm(ms / n) : 0, often: conf && conf[0] };
  });
}

const showKey = (k) => (k === ' ' ? 'space' : k);

function drawKeyboard(data, signal) {
  const rows = new Map(letterRows(data.letters || {}, data.confusions || {}).map((r) => [r.k, r]));
  const rated = [...rows.values()].filter((r) => r.total >= 5);
  const maxRate = Math.max(0.05, ...rated.map((r) => r.rate));
  const kb = $('keyboard');
  kb.replaceChildren(...KEY_ROWS.map((row) => {
    const line = document.createElement('div');
    line.className = 'krow';
    for (const k of row) {
      const r = rows.get(k);
      const key = document.createElement('div');
      key.className = 'key';
      key.textContent = k;
      if (!r || r.total < 5) {
        key.classList.add('nodata');
      } else {
        key.style.background = `color-mix(in oklab, var(--heat) ${Math.round((r.rate / maxRate) * 80)}%, var(--raised))`;
        const pct = document.createElement('small');
        pct.textContent = `${Math.round(r.rate * 100)}%`;
        key.append(pct);
      }
      key.addEventListener('pointerenter', (e) => {
        const html = !r || r.total < 5 ? `<b>${k}</b> · not enough typing yet`
          : `<b>${k}</b> · ${(r.rate * 100).toFixed(1)}% missed (${r.misses} of ${r.total})`
            + (r.often ? `<br>often typed as <b>${showKey(r.often)}</b>` : '')
            + (r.wpm ? `<br>${Math.round(r.wpm)} WPM on this key` : '');
        showTip(html, e.clientX, e.clientY);
      }, { signal });
      key.addEventListener('pointerleave', hideTip, { signal });
      line.append(key);
    }
    return line;
  }));

  const weak = rated.filter((r) => r.rate > 0 && r.total >= 10).sort((a, b) => b.rate - a.rate).slice(0, 6);
  const list = $('weakList');
  if (!weak.length) {
    list.innerHTML = '<p class="muted">Type a little more and the letters you struggle with will show up here.</p>';
    return;
  }
  list.replaceChildren(...weak.map((r) => {
    const d = document.createElement('div');
    d.className = 'weak';
    d.innerHTML = `<kbd></kbd><span><b>${(r.rate * 100).toFixed(1)}%</b> missed (${r.misses} of ${r.total})<br>`
      + `${r.often ? `often typed as <b></b> · ` : ''}${r.wpm ? `${Math.round(r.wpm)} WPM` : ''}</span>`;
    d.querySelector('kbd').textContent = showKey(r.k);
    if (r.often) d.querySelector('span b:nth-of-type(2)').textContent = showKey(r.often);
    return d;
  }));
}

// ---------- the page ----------

async function openTests() {
  const token = viewToken;
  $('tests').hidden = false;
  document.title = 'Typing · Shelf';
  const data = await api('GET', '/api/tests');
  if (token !== viewToken) return;
  const ac = new AbortController();
  const signal = ac.signal;
  let timer = null;
  cleanup = () => { ac.abort(); clearInterval(timer); hideTip(); };

  if (!wordModel) wordModel = buildWordModel(COMMON_WORDS);
  if (!['practice', 'speed'].includes(settings.typingMode)) settings.typingMode = 'practice';
  if (!['words', 'books'].includes(settings.testSource)) settings.testSource = 'words';
  const adaptive = data.adaptive || { unlocked: START_KEYS, target: 35, keys: {} };
  const keyStats = createKeyStats();
  const box = $('testBox');
  const input = $('testInput');
  let lessonTimes = new Map(); // letter -> [ms...] for the current lesson
  let focus = null;
  let lastLesson = data.tests.filter((t) => t.source === 'lesson').at(-1) || null;
  let round = 0;

  const practicing = () => settings.typingMode === 'practice';
  const speedOf = (k) => (adaptive.keys[k] ? adaptive.keys[k].speed : 0);

  const typer = createTyper(box, $('testWords'), input, signal, {
    stopOnError: practicing,
    onStart() {
      if (practicing()) return;
      const end = performance.now() + settings.testDuration * 1000;
      clearInterval(timer);
      timer = setInterval(() => {
        const left = Math.max(0, Math.ceil((end - performance.now()) / 1000));
        $('tLeft').textContent = left;
        if (left <= 0) typer.finish();
      }, 100);
    },
    onKey(expected, got, ms) {
      if (/[^\x20-\x7e]/.test(expected)) return;
      keyStats.record(expected, got, ms);
      if (practicing() && got === expected && ms > 0 && ms < IDLE_CAP && /[a-z]/.test(expected)) {
        if (!lessonTimes.has(expected)) lessonTimes.set(expected, []);
        lessonTimes.get(expected).push(ms);
      }
    },
    onProgress() {
      const l = typer.live();
      $('tLiveWpm').textContent = l.ms > 1500 ? `${Math.round((l.correct / 5) / (l.ms / 60000))} WPM` : '';
    },
    onDone(r) {
      clearInterval(timer);
      if (practicing()) finishLesson(r);
      else finishSpeedTest(r);
    },
  });

  // ----- practice -----

  function focusKey() {
    const unlocked = KEY_ORDER.slice(0, adaptive.unlocked);
    const fresh = unlocked.filter((k) => !adaptive.keys[k] || adaptive.keys[k].lessons < 1);
    if (fresh.length) return fresh[fresh.length - 1];
    return unlocked.reduce((a, b) => (speedOf(a) <= speedOf(b) ? a : b));
  }

  function renderChips() {
    const chips = $('keyChips');
    chips.replaceChildren(...KEY_ORDER.map((k, i) => {
      const c = document.createElement('div');
      c.className = 'kchip';
      c.textContent = k;
      const locked = i >= adaptive.unlocked;
      const conf = clamp(speedOf(k) / adaptive.target, 0, 1);
      if (locked) c.classList.add('locked');
      else {
        c.innerHTML += `<i><b style="width:${Math.round(conf * 100)}%"></b></i>`;
        if (conf >= 1) c.classList.add('done');
      }
      if (k === focus) c.classList.add('focus');
      c.addEventListener('pointerenter', (e) => {
        const ks = adaptive.keys[k];
        const html = locked ? `<b>${k}</b> · unlocks when every letter before it reaches ${adaptive.target} WPM`
          : ks ? `<b>${k}</b> · ${Math.round(ks.speed)} WPM of ${adaptive.target} target<br><span class="muted">${ks.lessons} lesson${ks.lessons === 1 ? '' : 's'}</span>`
            : `<b>${k}</b> · new letter, not typed yet`;
        showTip(html, e.clientX, e.clientY);
      }, { signal });
      c.addEventListener('pointerleave', hideTip, { signal });
      return c;
    }));
    const done = KEY_ORDER.slice(0, adaptive.unlocked).filter((k) => speedOf(k) >= adaptive.target).length;
    $('unlockInfo').textContent = `${adaptive.unlocked} of 26 letters unlocked · ${done} at target speed`;
    $('lFocus').textContent = focus || '–';
  }

  function newLesson() {
    focus = focusKey();
    const allowed = new Set(KEY_ORDER.slice(0, adaptive.unlocked));
    const words = [];
    let len = 0;
    for (let guard = 0; len < LESSON_CHARS && guard < 200; guard++) {
      const w = pseudoWord(wordModel, allowed, focus);
      if (w === words[words.length - 1]) continue;
      words.push(w);
      len += w.length + 1;
    }
    lessonTimes = new Map();
    typer.setText(words.join(' '));
    renderChips();
  }

  function delta(el, now, before, unit = '') {
    if (before == null) { el.textContent = ''; return; }
    const d = now - before;
    el.textContent = `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}${unit}`;
    el.className = d > 0.05 ? 'up' : d < -0.05 ? 'down' : '';
  }

  function finishLesson(r) {
    const minutes = Math.max(r.ms, 1) / 60000;
    const wpm = (r.correct / 5) / minutes;
    const acc = r.keys ? (100 * (r.keys - r.errors)) / r.keys : 100;
    for (const [k, times] of lessonTimes) {
      const s = keyWpm(times.reduce((a, b) => a + b, 0) / times.length);
      const ks = adaptive.keys[k] || (adaptive.keys[k] = { speed: 0, lessons: 0 });
      ks.speed = ks.lessons ? ks.speed * 0.65 + s * 0.35 : s; // smoothed over recent lessons
      ks.lessons++;
    }
    const unlocked = KEY_ORDER.slice(0, adaptive.unlocked);
    if (adaptive.unlocked < 26 && unlocked.every((k) => adaptive.keys[k] && adaptive.keys[k].lessons >= 2 && adaptive.keys[k].speed >= adaptive.target)) {
      adaptive.unlocked++;
      toast(`New letter unlocked: ${KEY_ORDER[adaptive.unlocked - 1]}`);
    }
    api('PUT', '/api/adaptive', adaptive).catch(() => {});
    const test = { at: Date.now(), source: 'lesson', label: `focus on ${focus}`, duration: Math.round(r.ms / 100) / 10, wpm: Math.round(wpm * 10) / 10, raw: Math.round(((r.keys / 5) / minutes) * 10) / 10, acc: Math.round(acc * 10) / 10, chars: r.total, errors: r.errors };
    save(test);
    $('lSpeed').textContent = test.wpm.toFixed(1);
    $('lAcc').textContent = `${test.acc.toFixed(1)}%`;
    delta($('lSpeedD'), test.wpm, lastLesson && lastLesson.wpm);
    delta($('lAccD'), test.acc, lastLesson && lastLesson.acc, '%');
    lastLesson = test;
    newLesson();
  }

  // ----- speed test -----

  async function newSpeedTest() {
    const mine = ++round;
    $('testResult').hidden = true;
    $('tLeft').textContent = settings.testDuration;
    let text = '';
    let label = 'Common English words';
    if (settings.testSource === 'books') {
      $('testSource').textContent = 'Finding a passage you have already read…';
      const passage = await bookPassage(settings.testDuration * 13).catch(() => null);
      if (mine !== round || signal.aborted) return;
      if (passage) {
        text = passage.text;
        label = passage.label;
        $('testSource').innerHTML = 'From <i></i> · only from parts you have already read, so no spoilers';
        $('testSource').querySelector('i').textContent = label;
      } else {
        $('testSource').textContent = 'Read a bit of a novel first: passages only come from parts you have reached. Using common words for now.';
      }
    } else {
      $('testSource').textContent = '';
    }
    if (!text) text = commonWords(settings.testDuration * 3);
    typer.setText(text);
    typer.label = label;
  }

  function finishSpeedTest(r) {
    const seconds = Math.min(r.ms / 1000, settings.testDuration) || 1;
    const minutes = seconds / 60;
    const wpm = (r.correct / 5) / minutes;
    const raw = (r.typedLen / 5) / minutes;
    const acc = r.keys ? (100 * (r.keys - r.errors)) / r.keys : 0;
    const before = data.tests.filter((t) => t.source !== 'lesson' && t.duration === settings.testDuration);
    const best = Math.max(0, ...before.map((t) => t.wpm));
    const missed = Object.entries(pendingKeys().letters).filter(([, v]) => v[1] > 0).sort((a, b) => b[1][1] - a[1][1]).slice(0, 6);
    const test = { at: Date.now(), source: settings.testSource, label: typer.label || '', duration: settings.testDuration, wpm: Math.round(wpm * 10) / 10, raw: Math.round(raw * 10) / 10, acc: Math.round(acc * 10) / 10, chars: r.typedLen, errors: r.errors };
    save(test);
    $('rWpm').textContent = Math.round(wpm);
    $('rAcc').textContent = `${acc.toFixed(1)}%`;
    $('rRaw').textContent = Math.round(raw);
    $('rChars').textContent = `${r.correct}/${r.typedLen}`;
    $('rBest').textContent = Math.round(Math.max(best, wpm));
    $('rBestLabel').textContent = wpm > best && before.length ? 'new personal best!' : 'personal best';
    $('rMissed').innerHTML = missed.length
      ? `Missed this time: ${missed.map(([k, v]) => `<kbd>${k === ' ' ? 'space' : k.replace(/[<&]/g, '')}</kbd> ×${v[1]}`).join(' ')}`
      : 'No mistakes. Nice!';
    $('testResult').hidden = false;
    $('tLiveWpm').textContent = '';
  }

  // Key stats for the round in progress; sent along with the result.
  let pending = { letters: {}, confusions: {} };
  function pendingKeys() {
    const k = keyStats.take();
    for (const [ch, v] of Object.entries(k.letters)) {
      const row = pending.letters[ch] || (pending.letters[ch] = [0, 0, 0, 0]);
      v.forEach((n, i) => { row[i] += n; });
    }
    for (const [ch, m] of Object.entries(k.confusions)) {
      const row = pending.confusions[ch] || (pending.confusions[ch] = {});
      for (const [t, n] of Object.entries(m)) row[t] = (row[t] || 0) + n;
    }
    return pending;
  }

  function save(test) {
    const keysUsed = pendingKeys();
    pending = { letters: {}, confusions: {} };
    data.tests.push(test);
    for (const [ch, v] of Object.entries(keysUsed.letters)) {
      const row = data.letters[ch] || (data.letters[ch] = [0, 0, 0, 0]);
      v.forEach((n, i) => { row[i] += n; });
    }
    for (const [ch, m] of Object.entries(keysUsed.confusions)) {
      const row = data.confusions[ch] || (data.confusions[ch] = {});
      for (const [t, n] of Object.entries(m)) row[t] = (row[t] || 0) + n;
    }
    api('POST', '/api/tests', { ...test, ...keysUsed }).catch(() => {});
    renderProgress();
  }

  // ----- progress section -----

  function renderProgress() {
    const lessons = data.tests.filter((t) => t.source === 'lesson');
    const speed = data.tests.filter((t) => t.source !== 'lesson');
    const today = dayKey(Date.now());
    $('lCount').textContent = lessons.filter((t) => dayKey(t.at) === today).length;
    const card = (label, value, unit = '') => `<div class="best"><span>${label}</span><b>${value}</b><small>${unit}</small></div>`;
    const avg = (list, f) => (list.length ? list.reduce((n, t) => n + t[f], 0) / list.length : 0);
    if (practicing()) {
      const recent = lessons.slice(-10);
      $('bests').innerHTML = card('Letters unlocked', `${adaptive.unlocked}`, 'of 26')
        + card('Average, last 10 lessons', recent.length ? avg(recent, 'wpm').toFixed(1) : '–', 'WPM')
        + card('Accuracy, last 10 lessons', recent.length ? avg(recent, 'acc').toFixed(1) : '–', '%')
        + card('Lessons', lessons.length);
    } else {
      $('bests').innerHTML = [15, 30, 60, 120].map((d) => {
        const list = speed.filter((t) => t.duration === d);
        const label = `Best ${d >= 60 ? `${d / 60} min` : `${d}s`} test`;
        return card(label, list.length ? Math.round(Math.max(...list.map((t) => t.wpm))) : '–', list.length ? 'WPM' : '');
      }).join('');
    }
    const shown = (practicing() ? lessons : speed).slice(-60);
    $('chartTitle').textContent = practicing() ? 'Practice speed, lesson by lesson' : 'Speed test results over time';
    drawChart($('wpmChart'), shown, signal);
    drawKeyboard(data, signal);
    $('historyTitle').textContent = practicing() ? 'Recent lessons' : 'Recent speed tests';
    const body = $('history').querySelector('tbody');
    body.replaceChildren(...shown.slice(-10).reverse().map((t) => {
      const d = describeTest(t);
      const tr = document.createElement('tr');
      for (const v of [d.when, t.wpm.toFixed(1), `${t.acc.toFixed(1)}%`, d.len, d.text]) {
        const td = document.createElement('td');
        td.textContent = v;
        tr.append(td);
      }
      return tr;
    }));
    if (!shown.length) body.innerHTML = '<tr><td colspan="5" class="muted">Nothing yet.</td></tr>';
  }

  // ----- controls -----

  function setMode(mode) {
    settings.typingMode = mode;
    saveSettings();
    clearInterval(timer);
    typer.stop();
    pending = { letters: {}, confusions: {} };
    keyStats.take();
    for (const b of $('modeSeg').children) b.classList.toggle('on', b.dataset.v === mode);
    $('practicePane').hidden = mode !== 'practice';
    $('speedPane').hidden = mode !== 'speed';
    $('testResult').hidden = true;
    $('tLeft').textContent = '';
    $('tLiveWpm').textContent = '';
    $('testRestart').textContent = mode === 'practice' ? 'New lesson' : 'New test';
    $('keysHint').textContent = mode === 'practice'
      ? 'Mistakes stop the cursor until you press the right key · Tab: new lesson · Esc: pause'
      : 'Backspace fixes mistakes · Tab: new test · Esc: pause';
    renderProgress();
    restart();
  }

  function restart() {
    clearInterval(timer);
    typer.stop();
    keyStats.take();
    pending = { letters: {}, confusions: {} };
    if (practicing()) newLesson();
    else newSpeedTest();
    input.focus();
  }

  const segment = (id, key, after) => {
    const seg = $(id);
    const sync = () => { for (const b of seg.children) b.classList.toggle('on', b.dataset.v === String(settings[key])); };
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      settings[key] = key === 'testDuration' ? Number(b.dataset.v) : b.dataset.v;
      saveSettings();
      sync();
      after();
    }, { signal });
    sync();
  };
  segment('durSeg', 'testDuration', () => { renderProgress(); restart(); });
  segment('srcSeg', 'testSource', restart);
  $('modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.v); }, { signal });

  const targetSel = $('targetSel');
  targetSel.replaceChildren(...TARGETS.map((t) => new Option(`${t} WPM`, t)));
  targetSel.value = adaptive.target;
  targetSel.addEventListener('change', () => {
    adaptive.target = Number(targetSel.value);
    api('PUT', '/api/adaptive', adaptive).catch(() => {});
    renderChips();
  }, { signal });
  $('resetPractice').addEventListener('click', () => {
    if (!confirm('Start practice over from the first 6 letters? Your lesson history is kept.')) return;
    adaptive.unlocked = START_KEYS;
    adaptive.keys = {};
    api('PUT', '/api/adaptive', adaptive).catch(() => {});
    renderProgress();
    restart();
  }, { signal });

  const fontSel = $('testFont');
  fontSel.replaceChildren(...Object.entries(FONTS).filter(([k]) => k !== 'book').map(([k, f]) => new Option(f.name, k)));
  fontSel.value = settings.testFont;
  fontSel.addEventListener('change', () => { settings.testFont = fontSel.value; saveSettings(); applyTheme(); input.focus(); }, { signal });
  $('testRestart').addEventListener('click', restart, { signal });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); restart(); return; }
    if (e.key === 'Escape') { input.blur(); return; }
    if (document.activeElement === input || e.target.closest('select, input, button, textarea')) return;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) input.focus();
  }, { signal });
  window.addEventListener('resize', debounce(renderProgress, 200), { signal });
  themeListeners.add(renderProgress);
  signal.addEventListener('abort', () => themeListeners.delete(renderProgress));

  setMode(settings.typingMode);
}
