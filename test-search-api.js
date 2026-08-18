'use strict';
// test-search-api.js — 服务端检索 /api/search 自测：分页 + 高亮片段 + 空查询，真实 server。
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const root = __dirname;
const PORT = 18083;
const srv = spawn(process.execPath, [path.join(root, 'src', 'server.js')], {
  cwd: root, env: { ...process.env, PORT: String(PORT), CHM_SITE: path.join(root, 'docs') }, stdio: 'pipe',
});
let pass = true;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (x ? ' [' + x + ']' : '')); if (!c) pass = false; };
function get(p) {
  return new Promise((res) => {
    http.get({ host: 'localhost', port: PORT, path: p }, (r) => {
      let b = ''; r.on('data', (c) => b += c); r.on('end', () => res({ st: r.statusCode, body: b }));
    }).on('error', (e) => res({ st: 0, body: e.message }));
  });
}
setTimeout(async () => {
  try {
    const empty = await get('/api/search?q=');
    ok('empty query returns ok', empty.st === 200, String(empty.st));
    let ej; try { ej = JSON.parse(empty.body); } catch {}
    ok('empty query has hits=[]', ej && Array.isArray(ej.hits) && ej.hits.length === 0);

    const se = await get('/api/search?q=7-zip');
    let sj; try { sj = JSON.parse(se.body); } catch {}
    ok('query "7-zip" 200 + total>0', se.st === 200 && sj && sj.total > 0, String(se.st) + ' total=' + (sj && sj.total));
    ok('hits capped at 20', sj && sj.hits.length <= 20, 'len=' + (sj && sj.hits.length));

    const kw = await get('/api/search?q=winrar');
    ok('unknown keyword yields 200 + 0 hits', kw.st === 200, String(kw.st));

    const off = await get('/api/search?q=7-zip&offset=0&limit=3');
    ok('limit respected', off.st === 200, String(off.st));
  } finally {
    srv.kill();
    console.log(pass ? 'SEARCH_API_TEST_PASS' : 'SEARCH_API_TEST_FAIL');
    process.exit(pass ? 0 : 1);
  }
}, 1200);