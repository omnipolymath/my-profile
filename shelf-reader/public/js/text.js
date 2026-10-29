'use strict';

// ---------- text helpers (shared by typing practice and typing tests) ----------

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

// ---------- word lists + keybr-style pseudo-word generator ----------

const COMMON_WORDS = `the be to of and a in that have it for not on with he as you do at this but his by from they we say her
she or an will my one all would there their what so up out if about who get which go me when make can like time no just him
know take people into year your good some could them see other than then now look only come its over think also back after
use two how our work first well way even new want because any these give day most us is was are been has had were said did
having may should could might must shall each very much many more less few little long great small large big old young high
low right left early late hard easy last next same different own public able bad best better sure free full open short real
true whole clear close common poor strong special simple human local final main major nice dark light white black red green
blue cold warm hot happy sad fast slow deep quiet loud bright soft rough heavy thin thick wide narrow empty rich safe wild
place thing world life hand part child eye woman man home house room water word fact story point book money night side head
road door city tree line name voice light morning river ground window table chair paper letter music friend family mother
father brother sister heart mind face body foot hair street town village garden forest field mountain island sea ocean sky
sun moon star rain snow wind fire stone earth bird horse dog cat fish flower grass leaf wood glass bread milk food dinner
summer winter spring autumn week month hour minute moment second history power war peace game party team class school
question answer problem reason idea plan result change order sound color shape picture film song dream fear hope love
anger silence secret truth lie promise path bridge castle king queen prince soldier captain doctor teacher student driver
walk talk run read write sing dance sleep wake eat drink sit stand rise fall turn move play hold keep bring carry pull push
open close begin start stop finish leave arrive return follow lead meet find lose win help call ask tell show hear listen
watch wait stay live die grow build break cut draw drive fly swim climb throw catch reach touch feel smell taste believe
remember forget understand learn teach choose decide happen seem become remain appear allow offer pay send spend lend buy
sell wear wash clean fill pour cook boil burn shine smile laugh cry shout whisper wonder worry hurry pass cross enter explain
always never often sometimes usually again already still soon later almost enough quite rather really perhaps maybe
together alone away around above below behind between beyond inside outside through under without within against along
across toward until while since though although unless whether either neither before after during under upon every
another such both nothing something anything everything nobody somebody everyone someone whatever wherever however
north south east west center corner edge middle top bottom front end inside surface level line circle square letter number
silver golden iron paper cotton silk velvet leather candle lantern shadow mirror ribbon thread needle basket bottle kettle
pencil blanket pillow curtain ladder hammer engine market harbor tunnel valley meadow desert jungle canyon glacier
thunder lightning rainbow breeze storm cloud mist frost ember spark flame ashes smoke steam dust sand pebble crystal
gentle humble eager proud brave clever curious calm careful honest patient polite quick silly strange tiny tender
ancient modern hidden broken frozen golden silent sudden distant certain perfect simple gentle bitter sweet sour salty
travel journey adventure mystery legend battle treasure kingdom village captain pirate dragon wizard knight sword shield
letter message signal ticket station platform passenger journey window cabin railway airport harbor`.split(/\s+/).filter(Boolean);

function randomInt(n) { return Math.floor(Math.random() * n); }
function pick(list) { return list[randomInt(list.length)]; }

// Letter-level trigram model (with bigram backoff) trained on real words.
function buildWordModel(words) {
  const tri = new Map();
  const bi = new Map();
  const add = (map, key, ch) => {
    let m = map.get(key);
    if (!m) map.set(key, (m = new Map()));
    m.set(ch, (m.get(ch) || 0) + 1);
  };
  for (const raw of words) {
    const w = raw.toLowerCase();
    if (!/^[a-z]{2,}$/.test(w)) continue;
    const s = `^^${w}$`;
    for (let i = 2; i < s.length; i++) {
      add(tri, s[i - 2] + s[i - 1], s[i]);
      add(bi, s[i - 1], s[i]);
    }
  }
  return { tri, bi };
}

function sampleWeighted(entries) {
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = Math.random() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[entries.length - 1][0];
}

// A pronounceable made-up word using only `allowed` letters (like keybr's lessons).
function pseudoWord(model, allowed, focus, maxLen = 8) {
  const ok = (ch, len) => (ch === '$' ? len >= 3 : allowed.has(ch));
  for (let attempt = 0; attempt < 40; attempt++) {
    let a = '^';
    let b = '^';
    let w = '';
    while (w.length < maxLen) {
      const filter = (m) => (m ? [...m].filter(([ch]) => ok(ch, w.length)) : []);
      let opts = filter(model.tri.get(a + b));
      if (!opts.length) opts = filter(model.bi.get(b));
      if (!opts.length) opts = [...allowed].map((ch) => [ch, 1]);
      const ch = sampleWeighted(opts);
      if (ch === '$') break;
      w += ch;
      a = b;
      b = ch;
    }
    if (w.length >= 3 && (!focus || w.includes(focus) || Math.random() < 0.25)) return w;
  }
  const letters = [...allowed];
  return Array.from({ length: 3 + randomInt(3) }, () => pick(letters)).join('');
}
