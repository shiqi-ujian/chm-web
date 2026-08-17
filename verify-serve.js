'use strict';
const { serve } = require('./src/lib/serve');
const http = require('http');
const os = require('os');
const path = require('path');

const site = path.join(os.tmpdir(), 'chm-site-final');
serve(site, 0).then(({ server, port }) => {
  function get(p, exp, cb) {
    http.get({ host: 'localhost', port, path: p }, (r) => {
      let b = '';
      r.on('data', (c) => b += c);
      r.on('end', () => cb(r.statusCode, exp, b));
    }).on('error', (e) => cb('ERR', exp, ''));
  }
  get('/', 200, (s, e, b) => {
    console.log('GET / ->', s, 'len', b.length, 'isWelcome', b.includes('上传 .chm'));
    get('/__docs/7z-demo/', 200, (s2, e2, b2) => {
      console.log('GET doc ->', s2, 'isShell', b2.includes('frame'));
      get('/__docs/7z-demo/general/7z.htm', 200, (s3) => {
        console.log('GET docpage ->', s3);
        server.close();
        process.exit(0);
      });
    });
  });
}).catch((e) => { console.error(e); process.exit(1); });