'use strict';
// zip.js — tiny dependency-free ZIP writer (STORE + 32-bit DEFLATE).
// Covers the classic ZIP local file header + central directory + EOCD,
// using Node's zlib.deflateRawSync for DEFLATE-compressed entries.
// Sufficient for packing a small static site (KB~MB of small files).
const zlib = require('zlib');

// ---- CRC-32 (IEEE) table + function ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d) {
  d = d || new Date();
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  return { time, date };
}

function toLE32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }
function toLE16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xFFFF); return b; }

/**
 * Build a ZIP file from an ordered list of entries.
 * Each entry: { name: '/'-separated path, data: Buffer, date?: Date, deflate?: true }
 * Returns a Buffer of the finished archive.
 */
function zip(entries) {
  const opts = { level: 9 };
  const localParts = [];
  const centralParts = [];
  const stats = [];
  let offset = 0;

  const now = new Date();
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    // DEFLATE unless disabled (store) or data already tiny.
    const useDeflate = e.deflate !== false && e.data.length >= 40;
    const data = useDeflate ? zlib.deflateRawSync(e.data, opts) : e.data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(e.data);
    const { time, date } = dosDateTime(e.date ? new Date(e.date) : now);
    const compressSize = data.length;
    const uncomp = e.data.length;

    // Local file header
    const local = Buffer.concat([
      Buffer.from('PK\x03\x04', 'latin1'),
      toLE16(20), toLE16(0), toLE16(method),
      toLE16(time), toLE16(date),
      toLE32(crc), toLE32(compressSize), toLE32(uncomp),
      toLE16(nameBuf.length), toLE16(0),
      nameBuf,
    ]);
    localParts.push(local, data);
    stats.push({ crc, method, time, date, compressSize, uncomp, nameLen: nameBuf.length, offset, name: e.name });

    // Central directory header
    const central = Buffer.concat([
      Buffer.from('PK\x01\x02', 'latin1'),
      toLE16(20), toLE16(20), toLE16(0), toLE16(method),
      toLE16(time), toLE16(date),
      toLE32(crc), toLE32(compressSize), toLE32(uncomp),
      toLE16(nameBuf.length), toLE16(0), toLE16(0),
      toLE16(0), toLE16(0), toLE32(0),
      toLE32(offset),
    ]);
    centralParts.push(central, nameBuf);

    offset += local.length + data.length;
  }

  const centralSize = centralParts.reduce((a, b) => a + b.length, 0);
  const centralOffset = offset;
  const count = entries.length;

  const eocd = Buffer.concat([
    Buffer.from('PK\x05\x06', 'latin1'),
    toLE16(0), toLE16(0),
    toLE16(count), toLE16(count),
    toLE32(centralSize), toLE32(centralOffset),
    toLE16(0),
  ]);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

// helper not yet used; placeholder for readable CRC expose
function crc32Hex(buf) {
  return (function () { const c = crc32(buf); return ('00000000' + c.toString(16)).slice(-8); })();
}

module.exports = { zip, crc32 };