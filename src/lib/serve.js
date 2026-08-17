'use strict';
// serve.js — minimal http static server (no deps)
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html', '.htm': 'text/html',
  '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.json': 'application/json', '.txt': 'text/plain',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function serve(root, port = 8080) {
  root = path.resolve(root);
  const server = http.createServer((req, res) => {
    let urlPath;
    try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
    catch { urlPath = '/'; }
    if (urlPath === '/') urlPath = '/index.html';
    // prevent path traversal
    const target = path.resolve(root, '.' + path.sep + urlPath.replace(/^\/+/, '').replace(/\\/g, '/'));
    if (!target.startsWith(root + path.sep) && target !== root) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    let file = target;
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      file = path.join(file, 'index.html');
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  const listenPort = Number.isFinite(Number(port)) && Number(port) > 0 ? Number(port) : 0;
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(listenPort, () => {
      resolve({ server, port: server.address().port });
    });
  });
}

module.exports = { serve };