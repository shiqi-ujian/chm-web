'use strict';
// test-site.js — smoke-test the site landing page's global search over the real server.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const root = __dirname;
const PORT = 18081;
const srv = spawn(process.execPath, [path.join(root, 'src', 'server.js')], {
  cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe'
});
let log = '';
srv.stdout.on('data', (d) => log += d);
srv.stderr.on('data', (d) => log += d);
let pass = true;
const ok = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) pass = false; };

function get(p) {
  return new Promise((res) => {
    http.get({ host: 'localhost', port: PORT, path: p }, (r) => {
      let b = ''; r.on('data', (c) => b += c); r.on('end', () => res({ st: r.statusCode, body: b }));
    }).on('error', (e) => res({ st: 0, body: e.message }));
  });
}

setTimeout(async () => {
  try {
    const home = await get('/');
    ok('GET / landing 200', home.st === 200);
    ok('landing has search box', home.body.includes('id="siteq"'));
    ok('landing loads site-index', home.body.includes('site-index.json'));

    const si = await get('/site-index.json');
    let siok = false;
    try { const j = JSON.parse(si.body); siok = j.keywords && j.records && j.keywords.length > 3; } catch (_) {}
    ok('GET /site-index.json valid', si.st === 200 && siok);

    // fetch one doc shell + its index over real server
    const doc = await get('/d/7-zip/');
    ok('GET /d/7-zip/ shell 200', doc.st === 200 && doc.body.includes('frame'));
    const didx = await get('/d/7-zip/search-index.json');
    ok('GET doc search-index 200', didx.st === 200);

    // site export endpoint serves a real zip
    const z = await get('/site-export.zip');
    ok('GET /site-export.zip 200', z.st === 200 && z.body && z.body.length > 5000);
    ok('zip starts with PK', z.body && z.body.slice(0, 2).toString('latin1') === 'PK');
  } finally {
    srv.kill();
    console.log(pass ? 'SITE_TEST_PASS' : 'SITE_TEST_FAIL');
    process.exit(pass ? 0 : 1);
  }
}, 900);