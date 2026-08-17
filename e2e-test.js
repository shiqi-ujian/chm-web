'use strict';
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

const root = 'C:/Users/qiujian.shi/Desktop/chm-web';
const chm = 'C:/Program Files/7-Zip/7-zip.chm';
const PORT = 18080;

const srv = spawn(process.execPath, [root + '/src/server.js'], {
  cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe'
});
let log = '';
srv.stdout.on('data', (d) => log += d);
srv.stderr.on('data', (d) => log += d);
setTimeout(() => {
  httpGet('/', (st, body) => {
    console.log('GET / ->', st, 'isWelcome', body.includes('CHM 网页'));
    uploadFile();
  });
}, 1000);

function httpGet(p, cb) {
  http.get({ host: 'localhost', port: PORT, path: p }, (r) => {
    let b = ''; r.on('data', c => b += c); r.on('end', () => cb(r.statusCode, b));
  }).on('error', e => { console.log('GET', p, 'ERR', e.message); finish(); });
}

function uploadFile() {
  const boundary = '----chmweb' + Date.now();
  const fileBuf = fs.readFileSync(chm);
  const name = '7-zip.chm';
  const head = Buffer.from('--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="file"; filename="' + name + '"\r\n' +
    'Content-Type: application/octet-stream\r\n\r\n');
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
  const body = Buffer.concat([head, fileBuf, tail]);
  const req = http.request({ host: 'localhost', port: PORT, path: '/api/upload', method: 'POST', headers: {
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
    'Content-Length': body.length
  } }, (res) => {
    let b = ''; res.on('data', c => b += c);
    res.on('end', () => {
      console.log('POST /api/upload ->', res.statusCode, b.slice(-200));
      // 3) 检查新文档 URL 是否能 serve
      const url = (() => { try { return JSON.parse(b).url; } catch { return '/d/'; } })();
      httpGet(url, (st, body2) => {
        console.log('GET new doc', url, '->', st, 'isShell', body2.includes('frame'));
        finish();
      });
    });
  });
  req.on('error', e => { console.log('upload ERR', e.message); finish(); });
  req.write(body); req.end();
}

function finish() {
  console.log('--- data/uploads 内容 ---');
  try { console.log(fs.readdirSync(root + '/data/uploads')); } catch {}
  console.log('--- server log tail ---');
  console.log(log.split('\n').slice(-8).join('\n'));
  srv.kill(); process.exit(0);
}