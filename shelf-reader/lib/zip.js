'use strict';
// Minimal read-only ZIP reader (EPUB / CBZ are both ZIP files).
// Reads the central directory once and pulls individual entries on demand,
// so large manga archives are never loaded into memory whole.

const fs = require('fs');
const zlib = require('zlib');

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOC = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

async function readAt(fh, pos, len) {
  const buf = Buffer.alloc(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  return buf.subarray(0, bytesRead);
}

function applyZip64Extra(extra, entry) {
  let p = 0;
  while (p + 4 <= extra.length) {
    const id = extra.readUInt16LE(p);
    const len = extra.readUInt16LE(p + 2);
    if (id === 0x0001) {
      let q = p + 4;
      if (entry.usize === 0xffffffff) { entry.usize = Number(extra.readBigUInt64LE(q)); q += 8; }
      if (entry.csize === 0xffffffff) { entry.csize = Number(extra.readBigUInt64LE(q)); q += 8; }
      if (entry.offset === 0xffffffff) { entry.offset = Number(extra.readBigUInt64LE(q)); }
      return;
    }
    p += 4 + len;
  }
}

class ZipFile {
  constructor(file, entries) {
    this.file = file;
    this.entries = entries; // Map name -> entry
    this.lower = new Map();
    for (const name of entries.keys()) this.lower.set(name.toLowerCase(), name);
  }

  names() {
    return [...this.entries.keys()];
  }

  has(name) {
    return this.entries.has(name) || this.lower.has(name.toLowerCase());
  }

  find(name) {
    return this.entries.get(name) || this.entries.get(this.lower.get(name.toLowerCase()));
  }

  async read(name) {
    const entry = this.find(name);
    if (!entry) {
      const err = new Error(`Entry not found: ${name}`);
      err.code = 'ENOENT';
      throw err;
    }
    if (entry.flags & 0x1) throw new Error('Encrypted archives are not supported');
    const fh = await fs.promises.open(this.file, 'r');
    try {
      const header = await readAt(fh, entry.offset, 30);
      if (header.length < 30 || header.readUInt32LE(0) !== SIG_LOCAL) throw new Error('Corrupt zip entry');
      const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      const data = await readAt(fh, start, entry.csize);
      if (entry.method === 0) return data;
      if (entry.method === 8) return zlib.inflateRawSync(data);
      throw new Error(`Unsupported compression method ${entry.method}`);
    } finally {
      await fh.close();
    }
  }
}

async function parse(file) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 0xffff + 22);
    const tail = await readAt(fh, size - tailLen, tailLen);
    let i = tail.length - 22;
    while (i >= 0 && tail.readUInt32LE(i) !== SIG_EOCD) i--;
    if (i < 0) throw new Error('Not a zip archive');

    let count = tail.readUInt16LE(i + 10);
    let cdSize = tail.readUInt32LE(i + 12);
    let cdOffset = tail.readUInt32LE(i + 16);
    const loc = i - 20;
    if ((count === 0xffff || cdOffset === 0xffffffff) && loc >= 0 && tail.readUInt32LE(loc) === SIG_EOCD64_LOC) {
      const rec = await readAt(fh, Number(tail.readBigUInt64LE(loc + 8)), 56);
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
    }

    const cd = await readAt(fh, cdOffset, cdSize);
    const entries = new Map();
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== SIG_CENTRAL) break;
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const entry = {
        flags: cd.readUInt16LE(p + 8),
        method: cd.readUInt16LE(p + 10),
        csize: cd.readUInt32LE(p + 20),
        usize: cd.readUInt32LE(p + 24),
        offset: cd.readUInt32LE(p + 42),
      };
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      applyZip64Extra(cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen), entry);
      if (!name.endsWith('/')) entries.set(name, entry);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return new ZipFile(file, entries);
  } finally {
    await fh.close();
  }
}

// Small cache so we don't re-read the central directory on every page turn.
const cache = new Map();
const CACHE_MAX = 40;

async function openZip(file) {
  const st = await fs.promises.stat(file);
  const key = `${file}:${st.size}:${st.mtimeMs}`;
  const hit = cache.get(file);
  if (hit && hit.key === key) {
    cache.delete(file);
    cache.set(file, hit);
    return hit.zip;
  }
  const zip = await parse(file);
  cache.set(file, { key, zip });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return zip;
}

module.exports = { openZip };
