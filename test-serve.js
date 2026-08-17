'use strict';
const { serve } = require('./src/lib/serve');
const http = require('http');
const path = require('path');

async function main() {
  const root = process.argv[2] || path.join(__dirname, 'out', '7z-demo');
  const { server, port } = await serve(root, 0);
  const log = (s) => console.log('  ' + s);
  log('server up on port ' + port);

  function get(p, expectStatus) {
    return new Promise((resolve) => {
      const req = http.get({ host: 'localhost', port, path: p }, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => {
          const ok = res.statusCode === expectStatus;
          log(`GET ${p} → ${res.statusCode} (expect ${expectStatus}) ${ok ? 'OK' : 'FAIL'} len=${body.length}`);
          resolve(ok);
        });
      });
      req.on('error', (e) => { log(`GET ${p} → ERROR ${e.message}`); resolve(false); });
    });
  }

  const a = await get('/', 200);
  const b = await get('/general/7z.htm', 200);
  const c = await get('/keywords.json', 200);
  const d = await get('/nope-missing.htm', 404);

  server.close();
  console.log(a && b && c && d ? 'SERVE_TEST_PASS' : 'SERVE_TEST_FAIL');
}
main().catch((e) => { console.error(e); process.exit(1); });