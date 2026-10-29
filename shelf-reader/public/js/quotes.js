'use strict';

// ---------- quotes: built-in collections, saving the ones you like, and the Quotes page ----------
// Anime lines are common English translations; wording differs a little between subs and dubs.

const QUOTES = [
  ['Strive not to be a success, but rather to be of value.', 'Albert Einstein'],
  ['The only way to do great work is to love what you do.', 'Steve Jobs'],
  ['It does not matter how slowly you go as long as you do not stop.', 'Confucius'],
  ['The journey of a thousand miles begins with one step.', 'Lao Tzu'],
  ['That which does not kill us makes us stronger.', 'Friedrich Nietzsche'],
  ['The unexamined life is not worth living.', 'Socrates'],
  ["I have not failed. I've just found 10,000 ways that won't work.", 'Thomas Edison'],
  ["Whether you think you can or you think you can't, you're right.", 'Henry Ford'],
  ['The best time to plant a tree was 20 years ago. The second best time is now.', 'Chinese proverb'],
  ["You miss 100% of the shots you don't take.", 'Wayne Gretzky'],
  ["Life is what happens when you're busy making other plans.", 'John Lennon'],
  ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
  ['Not all those who wander are lost.', 'J.R.R. Tolkien'],
  ["It always seems impossible until it's done.", 'Nelson Mandela'],
  ['Happiness depends upon ourselves.', 'Aristotle'],
  ['The future belongs to those who believe in the beauty of their dreams.', 'Eleanor Roosevelt'],
  ['Well done is better than well said.', 'Benjamin Franklin'],
  ['Imagination is more important than knowledge.', 'Albert Einstein'],
  ['We are what we repeatedly do. Excellence, then, is not an act, but a habit.', 'Will Durant'],
  ['Act as if what you do makes a difference. It does.', 'William James'],
  ['Reading is to the mind what exercise is to the body.', 'Joseph Addison'],
  ['There is no friend as loyal as a book.', 'Ernest Hemingway'],
  ['Today a reader, tomorrow a leader.', 'Margaret Fuller'],
  ['Everything you can imagine is real.', 'Pablo Picasso'],
  ['Turn your wounds into wisdom.', 'Oprah Winfrey'],
  ['In the middle of every difficulty lies opportunity.', 'Albert Einstein'],
  ['The secret of getting ahead is getting started.', 'Mark Twain'],
  ['Be the change that you wish to see in the world.', 'Mahatma Gandhi'],
].map(([text, by]) => ({ kind: 'quote', text, by, from: '' }));

const ANIME_QUOTES = [
  ["If you don't take risks, you can't create a future!", 'Monkey D. Luffy', 'One Piece'],
  ['No matter how deep the night, it always turns to day, eventually.', 'Brook', 'One Piece'],
  ['Forgetting is like a wound. The wound may heal, but it has already left a scar.', 'Monkey D. Luffy', 'One Piece'],
  ["Hard work is worthless for those that don't believe in themselves.", 'Naruto Uzumaki', 'Naruto'],
  ["If you don't like your destiny, don't accept it. Instead, have the courage to change it the way you want it to be.", 'Naruto Uzumaki', 'Naruto'],
  ['When people are protecting something truly special to them, they truly can become as strong as they can be.', 'Haku', 'Naruto'],
  ['A dropout will beat a genius through hard work.', 'Rock Lee', 'Naruto'],
  ["People's lives don't end when they die. It ends when they lose faith.", 'Itachi Uchiha', 'Naruto'],
  ["A lesson without pain is meaningless. That's because no one can gain without sacrificing something.", 'Edward Elric', 'Fullmetal Alchemist: Brotherhood'],
  ["The world isn't perfect. But it's there for us, doing the best it can. That's what makes it so damn beautiful.", 'Roy Mustang', 'Fullmetal Alchemist'],
  ['Fear is not evil. It tells you what your weakness is. And once you know your weakness, you can become stronger as well as kinder.', 'Gildarts Clive', 'Fairy Tail'],
  ["We don't have to know what tomorrow holds! That's why we can live for everything we're worth today!", 'Natsu Dragneel', 'Fairy Tail'],
  ["Whatever you lose, you'll find it again. But what you throw away you'll never get back.", 'Kenshin Himura', 'Rurouni Kenshin'],
  ["If you win, you live. If you lose, you die. If you don't fight, you can't win!", 'Eren Yeager', 'Attack on Titan'],
  ['Power comes in response to a need, not a desire. You have to create that need.', 'Goku', 'Dragon Ball Z'],
  ["I'll leave tomorrow's problems to tomorrow's me.", 'Saitama', 'One Punch Man'],
  ['Human strength lies in the ability to change yourself.', 'Saitama', 'One Punch Man'],
  ['Being weak is nothing to be ashamed of. Staying weak is!', 'Fuegoleon Vermillion', 'Black Clover'],
  ['Set your heart ablaze.', 'Kyojuro Rengoku', 'Demon Slayer'],
  ['Whether a fish lives in a clear stream or a water ditch, so long as it continues swimming forward, it will grow up beautifully.', 'Koro-sensei', 'Assassination Classroom'],
  ["You should enjoy the little detours to the fullest. Because that's where you'll find the things more important than what you want.", 'Ging Freecss', 'Hunter x Hunter'],
  ["Don't give up, there's no shame in falling down! True shame is to not stand up again!", 'Shintaro Midorima', "Kuroko's Basketball"],
  ["To know sorrow is not terrifying. What is terrifying is to know you can't go back to happiness you could have.", 'Rangiku Matsumoto', 'Bleach'],
  ["It's not the face that makes someone a monster; it's the choices they make with their lives.", 'Naruto Uzumaki', 'Naruto'],
].map(([text, by, from]) => ({ kind: 'anime', text, by, from }));

const quoteSource = (q) => [q.by, q.from].filter(Boolean).join(', ');

// Saved quotes are cached here so hearts can show the right state everywhere.
let savedQuotes = null;
async function loadSavedQuotes() {
  if (!savedQuotes) savedQuotes = await api('GET', '/api/quotes');
  return savedQuotes;
}
const findSaved = (text) => (savedQuotes || []).find((q) => q.text === text);

async function saveQuote(q) {
  await loadSavedQuotes();
  const saved = await api('POST', '/api/quotes', q);
  if (!findSaved(saved.text)) savedQuotes.push(saved);
  return saved;
}
async function unsaveQuote(text) {
  const q = findSaved(text);
  if (!q) return;
  await api('DELETE', `/api/quotes/${q.id}`);
  savedQuotes = savedQuotes.filter((x) => x.id !== q.id);
}

// A ♡ button that saves/unsaves `getQuote()`; returns { el, refresh }.
function heartButton(getQuote, signal, onChange = () => {}) {
  const el = document.createElement('button');
  el.className = 'heart ghost';
  const refresh = () => {
    const q = getQuote();
    const on = !!(q && findSaved(q.text));
    el.hidden = !q;
    el.classList.toggle('on', on);
    el.innerHTML = `<span aria-hidden="true">${on ? '♥' : '♡'}</span> ${on ? 'Saved' : 'Save quote'}`;
    el.title = on ? 'Remove from your saved quotes' : 'Save to your quotes';
  };
  el.addEventListener('click', async (e) => {
    e.stopPropagation();
    const q = getQuote();
    if (!q) return;
    try {
      if (findSaved(q.text)) { await unsaveQuote(q.text); toast('Removed from your quotes'); }
      else { await saveQuote(q); toast('Saved to your quotes ♥'); }
    } catch (err) { toast(err.message); }
    refresh();
    onChange();
  }, { signal });
  loadSavedQuotes().then(refresh, refresh);
  refresh();
  return { el, refresh };
}

// ---------- the Quotes page ----------

async function openQuotes() {
  const token = viewToken;
  $('quotes').hidden = false;
  document.title = 'Quotes · Shelf';
  savedQuotes = null;
  await loadSavedQuotes();
  if (token !== viewToken) return;
  const ac = new AbortController();
  const signal = ac.signal;
  cleanup = () => ac.abort();
  if (!['all', 'quote', 'anime', 'book'].includes(settings.quoteFilter)) settings.quoteFilter = 'all';

  // A random quote to discover, with save / type / another.
  let current = null;
  const heart = heartButton(() => current, signal, () => render());
  $('discoverActions').prepend(heart.el);
  signal.addEventListener('abort', () => heart.el.remove());
  const pool = () => (settings.discover === 'anime' ? ANIME_QUOTES : settings.discover === 'quote' ? QUOTES : [...QUOTES, ...ANIME_QUOTES]);
  function another() {
    const list = pool().filter((q) => !current || q.text !== current.text);
    current = pick(list);
    $('discoverText').textContent = current.text;
    $('discoverBy').textContent = `— ${quoteSource(current)}`;
    heart.refresh();
  }
  const seg = $('discoverSeg');
  const syncSeg = () => { for (const b of seg.children) b.classList.toggle('on', b.dataset.v === (settings.discover || 'all')); };
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.discover = b.dataset.v;
    saveSettings();
    syncSeg();
    another();
  }, { signal });
  $('discoverNext').addEventListener('click', another, { signal });
  $('discoverType').addEventListener('click', () => {
    sessionStorage.setItem('shelf.typeQuote', JSON.stringify(current));
    location.hash = '#/tests?quote';
  }, { signal });
  syncSeg();
  another();

  // Saved quotes
  const fseg = $('quoteFilter');
  function render() {
    for (const b of fseg.children) b.classList.toggle('on', b.dataset.v === settings.quoteFilter);
    const list = savedQuotes.filter((q) => settings.quoteFilter === 'all' || q.kind === settings.quoteFilter).slice().reverse();
    $('savedCount').textContent = savedQuotes.length ? `${savedQuotes.length} saved` : '';
    const box = $('savedList');
    if (!list.length) {
      box.innerHTML = `<p class="muted empty-quotes">${savedQuotes.length ? 'Nothing saved in this group yet.'
        : 'Nothing saved yet. Tap <b>♡ Save quote</b> on a quote you like, after a quote typing test, or select text while reading a novel.'}</p>`;
      return;
    }
    box.replaceChildren(...list.map((q) => {
      const card = document.createElement('article');
      card.className = 'quote-card';
      const text = document.createElement('blockquote');
      text.textContent = q.text;
      const meta = document.createElement('div');
      meta.className = 'quote-meta';
      const by = document.createElement('span');
      by.textContent = quoteSource(q) || 'Saved quote';
      const tag = document.createElement('small');
      tag.className = 'muted';
      tag.textContent = `${q.kind === 'anime' ? 'Anime' : q.kind === 'book' ? 'From my books' : 'Quote'} · ${new Date(q.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
      meta.append(by, tag);
      const actions = document.createElement('div');
      actions.className = 'quote-actions';
      const btn = (label, fn, cls = 'ghost') => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = label;
        b.addEventListener('click', fn, { signal });
        actions.append(b);
      };
      btn('Type it', () => {
        sessionStorage.setItem('shelf.typeQuote', JSON.stringify(q));
        location.hash = '#/tests?quote';
      });
      if (q.bookId) btn('Open book', () => { location.hash = `#/read/${q.bookId}${q.chapter != null ? `?ch=${q.chapter}&pos=0` : ''}`; });
      btn('Copy', async () => {
        try { await navigator.clipboard.writeText(`“${q.text}” — ${quoteSource(q)}`); toast('Copied'); } catch { toast('Copy is not available here'); }
      });
      btn('Remove', async () => {
        try { await unsaveQuote(q.text); render(); heart.refresh(); } catch (err) { toast(err.message); }
      }, 'ghost del');
      card.append(text, meta, actions);
      return card;
    }));
  }
  fseg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.quoteFilter = b.dataset.v;
    saveSettings();
    render();
  }, { signal });
  render();
}
