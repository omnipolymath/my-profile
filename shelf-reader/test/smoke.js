'use strict';
// End-to-end smoke test: builds a tiny EPUB + CBZ, starts the server, exercises the API.
// Run with: npm test

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

// Tiny zip writer: entries is [name, string|Buffer, deflate?]
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content, deflate] of entries) {
    const data = Buffer.from(content);
    const body = deflate ? zlib.deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x800, 6);
    head.writeUInt16LE(deflate ? 8 : 0, 8);
    head.writeUInt32LE(crc32(data), 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x800, 8);
    cen.writeUInt16LE(deflate ? 8 : 0, 10);
    cen.writeUInt32LE(crc32(data), 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    locals.push(head, nameBuf, body);
    centrals.push(cen, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

function sampleEpub() {
  const chapter = (title, paras) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h1>${title}</h1>${paras.map((p) => `<p>${p}</p>`).join('')}</body></html>`;
  return makeZip([
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ['OEBPS/content.opf', `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>The Test &amp; Novel</dc:title><dc:creator>Ada Writer</dc:creator><dc:language>en</dc:language>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover-img" href="Images/cover.png" media-type="image/png"/>
    <item id="c1" href="Text/chapter%201.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="Text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`, true],
    ['OEBPS/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="Text/chapter%201.xhtml">Chapter One</a></li><li><a href="Text/ch2.xhtml#start">Chapter Two</a></li></ol></nav></body></html>'],
    ['OEBPS/Images/cover.png', PNG],
    ['OEBPS/Text/chapter 1.xhtml', chapter('Chapter One', ['“Hello,” she said — quietly.', 'The cat sat on the mat.']), true],
    ['OEBPS/Text/ch2.xhtml', chapter('Chapter Two', ['Second chapter text.'])],
  ]);
}

function sampleCbz() {
  return makeZip([
    ['vol1/page10.png', PNG],
    ['vol1/page2.png', PNG],
    ['vol1/page1.png', PNG],
    ['__MACOSX/vol1/._page1.png', 'junk'],
  ]);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-test-'));
  const lib = path.join(dir, 'library');
  fs.mkdirSync(path.join(lib, 'Manga Series'), { recursive: true });
  fs.writeFileSync(path.join(lib, 'Manga Series', 'Chapter 1.cbz'), sampleCbz());

  const port = 18000 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, LIBRARY_DIR: lib, READER_PASSWORD: 'secret' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve) => server.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(); }));

  const base = `http://127.0.0.1:${port}`;
  const auth = { Authorization: `Basic ${Buffer.from('reader:secret').toString('base64')}` };
  const get = (p) => fetch(base + p, { headers: auth });

  try {
    assert.strictEqual((await fetch(`${base}/api/books`)).status, 401, 'auth required');
    assert.strictEqual((await fetch(`${base}/healthz`)).status, 200);

    const up = await fetch(`${base}/api/upload`, {
      method: 'POST', headers: { ...auth, 'X-Filename': encodeURIComponent('My Novel.epub') }, body: sampleEpub(),
    });
    assert.strictEqual(up.status, 201);
    const uploaded = await up.json();
    assert.strictEqual(uploaded.title, 'The Test & Novel');

    const bad = await fetch(`${base}/api/upload`, {
      method: 'POST', headers: { ...auth, 'X-Filename': 'evil.epub' }, body: 'not a zip',
    });
    assert.strictEqual(bad.status, 400);
    const traversal = await fetch(`${base}/api/upload`, {
      method: 'POST', headers: { ...auth, 'X-Filename': encodeURIComponent('../../escape.cbz') }, body: sampleCbz(),
    });
    assert.strictEqual(traversal.status, 201);
    assert.ok(fs.existsSync(path.join(lib, 'escape.cbz')), 'traversal stripped to basename');

    const list = await (await get('/api/books')).json();
    assert.strictEqual(list.length, 3);
    const novel = list.find((b) => b.kind === 'epub');
    const manga = list.find((b) => b.series === 'Manga Series');
    assert.strictEqual(novel.author, 'Ada Writer');
    assert.strictEqual(novel.length, 2);
    assert.strictEqual(manga.length, 3);

    const detail = await (await get(`/api/books/${novel.id}`)).json();
    assert.deepStrictEqual(detail.spine.map((s) => s.href), ['OEBPS/Text/chapter 1.xhtml', 'OEBPS/Text/ch2.xhtml']);
    assert.deepStrictEqual(detail.toc.map((t) => t.label), ['Chapter One', 'Chapter Two']);

    const ch1 = await get(`/api/books/${novel.id}/res/OEBPS/Text/chapter%201.xhtml`);
    assert.strictEqual(ch1.status, 200);
    assert.match(ch1.headers.get('content-type'), /xhtml/);
    assert.match(ch1.headers.get('content-security-policy'), /script-src 'none'/);
    assert.match(await ch1.text(), /The cat sat on the mat/);

    const cover = await get(`/api/books/${novel.id}/cover`);
    assert.strictEqual(cover.headers.get('content-type'), 'image/png');

    // natural sort: page1, page2, page10
    const p2 = await get(`/api/books/${manga.id}/page/2`);
    assert.strictEqual(p2.status, 200);
    assert.strictEqual((await get(`/api/books/${manga.id}/page/3`)).status, 404);

    await fetch(`${base}/api/books/${novel.id}/progress`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ chapter: 1, scroll: 0.5 }),
    });
    const prog = await (await get(`/api/books/${novel.id}/progress`)).json();
    assert.strictEqual(prog.chapter, 1);

    await fetch(`${base}/api/typing`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: novel.id, chars: 300, keystrokes: 310, errors: 10, ms: 60000 }),
    });
    const typing = await (await get('/api/typing')).json();
    assert.strictEqual(typing.totals.chars, 300);
    assert.strictEqual(typing.totals.bestWpm, 60);

    // typing tests, per-letter stats and keybr-style practice state
    const posted = await fetch(`${base}/api/tests`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'lesson', duration: 20, wpm: 41.5, raw: 44, acc: 96.5, chars: 60, errors: 2,
        letters: { e: [20, 1, 4000, 19], t: [10, 2, 3000, 9] }, confusions: { t: { r: 2 } } }),
    });
    assert.strictEqual(posted.status, 201);
    assert.strictEqual((await fetch(`${base}/api/adaptive`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ unlocked: 99, target: 35 }),
    })).status, 400, 'bad practice state rejected');
    await fetch(`${base}/api/adaptive`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ unlocked: 7, target: 40, keys: { e: { speed: 42.3, lessons: 3 }, '<b>': { speed: 1, lessons: 1 } } }),
    });
    const tests = await (await get('/api/tests')).json();
    assert.strictEqual(tests.tests.length, 1);
    assert.deepStrictEqual(tests.letters.t, [10, 2, 3000, 9]);
    assert.strictEqual(tests.confusions.t.r, 2);
    assert.deepStrictEqual(tests.adaptive, { unlocked: 7, target: 40, keys: { e: { speed: 42.3, lessons: 3 } } });

    // furthest position never goes backwards (keeps typing-test passages spoiler free)
    await fetch(`${base}/api/books/${novel.id}/progress`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ chapter: 0, scroll: 0.1 }),
    });
    const back = await (await get(`/api/books/${novel.id}/progress`)).json();
    assert.strictEqual(back.furthest, 1.5);

    // saved quotes
    const q1 = await (await fetch(`${base}/api/quotes`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'anime', text: '  Set your heart ablaze.  ', by: 'Kyojuro Rengoku', from: 'Demon Slayer' }),
    })).json();
    assert.strictEqual(q1.text, 'Set your heart ablaze.');
    const again = await fetch(`${base}/api/quotes`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Set your heart ablaze.' }),
    });
    assert.strictEqual(again.status, 200, 'saving the same quote twice keeps one copy');
    assert.strictEqual((await (await get('/api/quotes')).json()).length, 1);
    await fetch(`${base}/api/quotes/${q1.id}`, { method: 'DELETE', headers: auth });
    assert.strictEqual((await (await get('/api/quotes')).json()).length, 0);

    // Obsidian notes: book notes + free notes are Markdown files in the vault
    const added = await (await fetch(`${base}/api/books/${novel.id}/notes`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter: 0, chapterLabel: 'Chapter One', quote: 'The cat sat on the mat.', body: 'A *classic* line.' }),
    })).json();
    assert.match(added.path, /^Shelf\/Books\/The Test & Novel\.md$/);
    const noteFile = path.join(dir, 'vault', added.path);
    const md = fs.readFileSync(noteFile, 'utf8');
    assert.match(md, /shelf-id: "[0-9a-f]{16}"/);
    assert.match(md, /> The cat sat on the mat\./);
    fs.appendFileSync(noteFile, '### Typed in Obsidian\nHello from the vault.\n');
    const listed = await (await get(`/api/books/${novel.id}/notes`)).json();
    assert.deepStrictEqual(listed.entries.map((e) => e.heading.split(' · ')[0]), ['Chapter One', 'Typed in Obsidian']);
    assert.strictEqual((await fetch(`${base}/api/books/${novel.id}/notes/${listed.entries[0].id}`, { method: 'DELETE', headers: auth })).status, 200);
    const free = await (await fetch(`${base}/api/notes`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Reading goals' }),
    })).json();
    const freeFile = await (await get(`/api/notes/file?path=${encodeURIComponent(free.path)}`)).json();
    const stale = await fetch(`${base}/api/notes/file?path=${encodeURIComponent(free.path)}`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: '# x', baseMtime: freeFile.mtime - 5000 }),
    });
    assert.strictEqual(stale.status, 409, 'refuses to overwrite a note changed elsewhere');
    assert.strictEqual((await get('/api/notes/file?path=..%2F..%2Fstate.json')).status, 400, 'cannot read outside the notes folder');
    const notesList = await (await get('/api/notes')).json();
    assert.deepStrictEqual(notesList.map((n) => n.kind).sort(), ['book', 'note']);

    // fonts are served and cached
    const font = await get('/fonts/literata-latin-wght-normal.woff2');
    assert.strictEqual(font.headers.get('content-type'), 'font/woff2');
    assert.match(font.headers.get('cache-control'), /immutable/);

    // progress follows a renamed/moved file
    fs.mkdirSync(path.join(lib, 'Moved'));
    fs.renameSync(path.join(lib, 'My Novel.epub'), path.join(lib, 'Moved', 'Renamed.epub'));
    const afterMove = await (await get('/api/books?refresh')).json();
    const moved = afterMove.find((b) => b.file === 'Moved/Renamed.epub');
    assert.ok(moved && moved.id !== novel.id);
    assert.strictEqual(moved.progress && moved.progress.furthest, 1.5, 'progress kept after rename');

    const del = await fetch(`${base}/api/books/${manga.id}`, { method: 'DELETE', headers: auth });
    assert.strictEqual(del.status, 200);
    assert.ok(!fs.existsSync(path.join(lib, 'Manga Series', 'Chapter 1.cbz')));

    assert.strictEqual((await get('/')).status, 200);
    assert.strictEqual((await get('/../server.js')).status, 404);
    console.log('All smoke tests passed');
    if (process.env.KEEP) {
      console.log(`Server still running at ${base} (library ${lib})`);
      return;
    }
  } finally {
    if (!process.env.KEEP) {
      server.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

module.exports = { makeZip, sampleEpub, sampleCbz };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
