'use strict';
// test-fulltext.js — verify the full-text search index builder + shell + site index.
const path = require('path');
const fs = require('fs');
const preview = require('./src/lib/preview');
const landing = require('./src/lib/landing');

function log(s) { console.log('  ' + s); }
let pass = true;
const ok = (name, cond) => { log((cond ? 'OK  ' : 'FAIL') + ' ' + name); if (!cond) pass = false; };

(async () => {
  // 1) index builder on the existing 7-zip doc
  const r = preview.buildFullText(path.join(__dirname, 'docs', 'd', '7-zip'));
  ok('full-text has >=1 record', r.records.length >= 1);
  const benchHits = r.records.filter((x) => x.text.toLowerCase().includes('benchmark')).length;
  ok('matches "benchmark" in >=1 record', benchHits >= 1);
  const pageMarker = r.records.some((x) => /\[page:[A-Za-z0-9_\/.-]+\.(htm|html)\]/.test(x.text));
  ok('records carry [page:...] markers', pageMarker);

  // 2) build() writes search-index.json alongside existing docs
  const docDir = path.join(__dirname, 'docs', 'd', '7-zip');
  preview.build({ outDir: docDir, hhcFile: path.join(docDir, '7zip.hhc'), hhkFile: path.join(docDir, '7zip.hhk'), title: '7-Zip' });
  const idxPath = path.join(docDir, 'search-index.json');
  ok('search-index.json written', fs.existsSync(idxPath));
  const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  ok('search-index.json parses with records', Array.isArray(idx.records) && idx.records.length > 0);
  const idxHits = idx.records.filter((x) => x.text.toLowerCase().includes('benchmark')).length;
  ok('search-index.json matches benchmark', idxHits >= 1);
  const titleRecords = idx.records.filter((x) => /^\[page:[^\]]+\]\n/.test(x.text)).length;
  ok('search-index.json includes page-title records', titleRecords >= 1);

  // 3) index.html shell now references search + dropdown (5z 风格壳)
  const shell = fs.readFileSync(path.join(docDir, 'index.html'), 'utf8');
  ok('shell references search-index.json', shell.includes('search-index.json'));
  ok('shell has result dropdown (#results)', shell.includes('id="results"'));
  ok('shell has __TOC__ JSON tree', shell.includes('window.__TOC__'));
  ok('shell has page search (#page-search-btn)', shell.includes('id="page-search-btn"'));
  ok('shell has dark theme toggle', shell.includes('data-theme') && shell.includes('theme-btn'));
  ok('shell has breadcrumb (#crumb)', shell.includes('id="crumb"'));

  // 4) site-index.json aggregation (cross-document search on the landing page)
  const si = landing.buildSiteIndex({ siteRoot: path.join(__dirname, 'docs'),
    docs: [{ id: '7-zip', name: '7-zip', href: 'd/7-zip/' }, { id: '7-zip-e624e0', name: '7-zip-e624e0', href: 'd/7-zip-e624e0/' }] });
  ok('site-index has keywords', si.keywords.length > 3);
  ok('site-index has text records', si.records.length > 3);
  const lzma = si.records.filter((x) => /lzma/i.test((x.text || '').toLowerCase())).length;
  ok('site-index records have LZMA hits', lzma >= 1);
  const kwSwitch = si.keywords.some((k) => /switch/i.test(k.name || ''));
  ok('site-index keywords include switch', kwSwitch);
  const recsHavePage = si.records.some((x) => /\[page:[^\]]+\]/.test(x.text || ''));
  ok('site-index records carry [page:] markers', recsHavePage);

  console.log(pass ? 'FULLTEXT_TEST_PASS' : 'FULLTEXT_TEST_FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });