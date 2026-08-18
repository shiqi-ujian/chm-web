'use strict';
// test-export-docs.js — verify batch selection export: pick a subset of docs from
// the site and pack them into a standalone static sub-site zip (rewritten welcome
// page + site-index.json covering only the chosen docs). Uses the same zip parser
// as test-zip.js to validate integrity and content.
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { exportDocs, aggregateSiteIndex } = require('./src/lib/site-export');
const { crc32 } = require('./src/lib/zip');

const siteRoot = path.join(__dirname, 'docs');

let pass = true;
const ok = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) pass = false; };

function parseZip(buf) {
  const eocdIdx = buf.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
  if (eocdIdx === -1) throw new Error('no EOCD');
  const count = buf.readUInt16LE(eocdIdx + 10);
  const cdOff = buf.readUInt32LE(eocdIdx + 16);
  const entries = {};
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
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

try {
  // 1) 选中单篇导出
  const one = exportDocs({ siteRoot, ids: ['7-zip'] });
  ok('exportDocs returns zip', one.zip.length > 500);
  ok('manifest.docs == [7-zip]', Array.isArray(one.manifest.docs) && one.manifest.docs.length === 1 && one.manifest.docs[0] === '7-zip');
  const z1 = parseZip(one.zip);
  ok('zip has manifest.json', !!z1['manifest.json']);
  ok('zip has standalone index.html', !!z1['index.html']);
  ok('zip has only selected doc entry', !z1['d/7-zip-e624e0/index.html']);
  ok('zip HAS selected doc shell', !!z1['d/7-zip/index.html']);
  const man1 = JSON.parse(z1['manifest.json'].toString());
  ok('manifest lists only 7-zip', man1.docs.length === 1);
  const home1 = z1['index.html'].toString();
  ok('standalone landing embeds only 7-zip', home1.includes('7-zip') && !home1.includes('7-zip-e624e0'));
  ok('standalone landing renders doc links', home1.includes('browse') || home1.includes('7-zip'));

  // 2) site-index only covers selected doc
  const si1 = JSON.parse(z1['site-index.json'].toString());
  const siDocs = new Set(si1.records.map((r) => r.doc));
  ok('site-index only references 7-zip', siDocs.has('7-zip') && siDocs.size === 1);

  // 3) 多选 / 全部导出（空 = 全选）
  //   实际遍历 docs/d 里所有目录；测试用 git 种子目录安装，可能含有额外导出的目录，
  //   故只断言"全选"至少包含 git 种子两篇 7-zip，而不要求恰好等于这两篇。
  const seedDocIds = ['7-zip', '7-zip-e624e0'];
  const multi = exportDocs({ siteRoot, ids: [] });
  const allDocs = multi.manifest.docs || [];
  ok('empty ids exports ALL docs (covers seed 7-zip pair)', seedDocIds.every((id) => allDocs.indexOf(id) !== -1) && allDocs.length >= seedDocIds.length);
  const zM = parseZip(multi.zip);
  ok('multi zip has every doc', seedDocIds.every((id) => zM['d/' + id + '/index.html']));
  ok('multi zip site-index covers both', JSON.parse(zM['site-index.json'].toString()).records.some((r) => r.doc === '7-zip-e624e0'));

  // 4) 未命中 id 被安全忽略，不报错
  const bogus = exportDocs({ siteRoot, ids: ['7-zip', 'does-not-exist-xyz'] });
  ok('unknown id stripped silently', bogus.manifest.docs.length === 1 && bogus.manifest.docs[0] === '7-zip');

  // 5) 落盘供 7-zip 人工校验
  const outZip = path.join(__dirname, 'out', 'docs-export-test.zip');
  fs.mkdirSync(path.dirname(outZip), { recursive: true });
  fs.writeFileSync(outZip, one.zip);
  ok('wrote docs-export-test.zip', fs.existsSync(outZip));

  console.log(pass ? 'EXPORT_DOCS_TEST_PASS' : 'EXPORT_DOCS_TEST_FAIL');
  process.exit(pass ? 0 : 1);
} catch (e) {
  console.error('FATAL', e);
  process.exit(1);
}