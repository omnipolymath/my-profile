'use strict';
// Just enough EPUB 2/3 parsing to get metadata, reading order, TOC and cover.

const posix = require('path').posix;
const { openZip } = require('./zip');

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
    const l = e.toLowerCase();
    if (l[0] !== '#') return NAMED[l];
    const cp = l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
    try { return String.fromCodePoint(cp); } catch { return m; }
  });
}

function attrs(tag) {
  const out = {};
  const re = /([^\s=<>/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3]);
  return out;
}

function plain(html) {
  return decodeEntities(html.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

// Resolve an href found inside `fromFile` to a zip entry path.
function resolve(fromFile, href) {
  let h = (href || '').split('#')[0];
  if (!h || /^[a-z]+:/i.test(h)) return '';
  try { h = decodeURIComponent(h); } catch { /* keep raw */ }
  return posix.normalize(posix.join(posix.dirname(fromFile), h)).replace(/^\/+/, '');
}

function tags(xml, name) {
  return [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>`, 'gi'))].map((m) => attrs(m[0]));
}

function element(xml, name) {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i'));
  return m ? m[1] : '';
}

function navToc(xml, navPath) {
  const navs = [...xml.matchAll(/<nav\b([^>]*)>([\s\S]*?)<\/nav>/gi)];
  const toc = navs.find((n) => /type\s*=\s*["'][^"']*\btoc\b/i.test(n[1])) || navs[0];
  if (!toc) return [];
  return [...toc[2].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((a) => ({ label: plain(a[2]), href: resolve(navPath, attrs(a[1]).href) }))
    .filter((t) => t.label && t.href);
}

function ncxToc(xml, ncxPath) {
  const out = [];
  const re = /<navLabel\b[^>]*>[\s\S]*?<text\b[^>]*>([\s\S]*?)<\/text>[\s\S]*?(<content\b[^>]*>)/gi;
  let m;
  while ((m = re.exec(xml))) {
    const href = resolve(ncxPath, attrs(m[2]).src);
    const label = plain(m[1]);
    if (label && href) out.push({ label, href });
  }
  return out;
}

async function parseEpub(file) {
  const zip = await openZip(file);
  const container = (await zip.read('META-INF/container.xml')).toString('utf8');
  const rootfile = tags(container, 'rootfile')[0];
  if (!rootfile || !rootfile['full-path']) throw new Error('EPUB has no rootfile');
  const opfPath = rootfile['full-path'];
  const opf = (await zip.read(opfPath)).toString('utf8');

  const metadata = element(opf, 'metadata');
  const title = plain(element(metadata, 'title'));
  const author = plain(element(metadata, 'creator'));
  const language = plain(element(metadata, 'language'));

  const items = tags(element(opf, 'manifest'), 'item').map((a) => ({
    id: a.id,
    href: resolve(opfPath, a.href),
    type: a['media-type'] || '',
    props: a.properties || '',
  }));
  const byId = new Map(items.map((i) => [i.id, i]));

  const spineXml = opf.match(/<(?:[\w-]+:)?spine\b[^>]*>/i);
  const spineAttrs = spineXml ? attrs(spineXml[0]) : {};
  const spine = tags(element(opf, 'spine'), 'itemref')
    .map((r) => byId.get(r.idref))
    .filter((i) => i && zip.has(i.href))
    .map((i) => ({ href: i.href }));

  let cover = items.find((i) => /\bcover-image\b/.test(i.props));
  if (!cover) {
    const meta = tags(metadata, 'meta').find((m) => m.name === 'cover');
    if (meta) cover = byId.get(meta.content);
  }
  if (!cover) cover = items.find((i) => i.type.startsWith('image/') && /cover/i.test(i.id + i.href));
  if (cover && !zip.has(cover.href)) cover = null;

  let toc = [];
  try {
    const nav = items.find((i) => /\bnav\b/.test(i.props));
    if (nav) toc = navToc((await zip.read(nav.href)).toString('utf8'), nav.href);
    if (!toc.length) {
      const ncx = byId.get(spineAttrs.toc) || items.find((i) => i.type === 'application/x-dtbncx+xml');
      if (ncx) toc = ncxToc((await zip.read(ncx.href)).toString('utf8'), ncx.href);
    }
  } catch {
    toc = [];
  }

  return { title, author, language, cover: cover ? cover.href : null, spine, toc };
}

module.exports = { parseEpub };
