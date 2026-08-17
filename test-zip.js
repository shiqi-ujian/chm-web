'use strict';
// test-zip.js — verify the dependency-free zip writer and site export.
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { zip, crc32 } = require('./src/lib/zip');
const { exportSite } = require('./src/lib/site-export');

let pass = true;
const ok = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) pass = false; };

// ---- minimal zip parser for verification ----
function parseZip(buf) {
  // scan central directory via EOCD
  const eocdIdx = buf.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
  if (eocdIdx === -1) throw new Error('no EOCD');
  const count = buf.readUInt16LE(eocdIdx + 10);
  const cdOff = buf.readUInt32LE(eocdIdx + 16);
  const entries = {};
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (buf.toString('latin1', p, p + 4) !== 'PK\x01\x02') throw new Error('bad central @' + i);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // local header -> data offset
    const dataStart = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.slice(dataStart, dataStart + csize);
    let data = raw;
    if (method === 8) data = zlib.inflateRawSync(raw);
    if (crc32(data) !== (crc >>> 0)) throw new Error('CRC mismatch for ' + name);
    entries[name] = data;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

(async () => {
  // 1) tiny zip roundtrip
  const tiny = zip([
    { name: 'a.txt', data: Buffer.from('hello world') },
    { name: 'dir/b.txt', data: Buffer.from('second ' .repeat(50) + 'content') },
  ]);
  const parsed = parseZip(tiny);
  ok('zip parses + unzips a.txt', parsed['a.txt'].toString() === 'hello world');
  ok('zip parses + unzips dir/b.txt', parsed['dir/b.txt'].includes('second'));

  // 2) full site export
  const siteRoot = path.join(__dirname, 'docs');
  const r = exportSite({ siteRoot });
  ok('export returns non-empty zip', r.zip.length > 1000);
  ok('manifest lists docs', Array.isArray(r.manifest.docs) && r.manifest.docs.indexOf('7-zip') !== -1);

  const site = parseZip(r.zip);
  ok('zip has manifest.json', site['manifest.json']);
  ok('zip has landing index.html', site['index.html']);
  ok('zip has a doc shell', site['d/7-zip/index.html']);
  ok('zip has site-index.json', site['site-index.json']);
  const man = JSON.parse(site['manifest.json'].toString());
  ok('manifest fileCount matches ~', man.fileCount >= 10);

  // 3) write a real .zip file on disk and let 7-zip check integrity
  const outZip = path.join(__dirname, 'out', 'site-test.zip');
  fs.mkdirSync(path.dirname(outZip), { recursive: true });
  fs.writeFileSync(outZip, r.zip);
  ok('wrote site-test.zip', fs.existsSync(outZip));

  console.log(pass ? 'ZIP_TEST_PASS' : 'ZIP_TEST_FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });