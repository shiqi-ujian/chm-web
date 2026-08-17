'use strict';
const { serve } = require('./src/lib/serve');
const http = require('http');
serve('docs', 0).then(({ server, port }) => {
  const req = http.get({ host: 'localhost', port, path: '/d/7z-demo/' }, (r) => {
    let n = 0; r.on('data', (c) => n += c.length);
    r.on('end', () => {
      require('fs').writeFileSync(require('os').tmpdir() + '/sd5.txt', '/d/7z-demo/ -> ' + r.statusCode + ' bytes=' + n);
      server.close(); process.exit(0);
    });
  });
  req.on('error', (e) => { require('fs').writeFileSync(require('os').tmpdir() + '/sd5.txt', 'ERR ' + e.message); process.exit(1); });
});