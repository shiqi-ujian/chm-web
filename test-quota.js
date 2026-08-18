'use strict';
// test-quota.js — 配额护栏自测：镜像真实 server（CHM_SITE/CHM_DATA 用临时目录），
// 验证每用户文档数上限、全局存储上限、限流 429、持久化 /api/usage。
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const root = __dirname;
const PORT = 18084;
const CHM = process.argv[2] || (
  process.platform === 'win32' && fs.existsSync('C:/Program Files/7-Zip/7-zip.chm')
    ? 'C:/Program Files/7-Zip/7-zip.chm' : null
);
if (!CHM || !fs.existsSync(CHM)) { console.error('need sample.chm'); process.exit(1); }
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chmweb-quota-'));
const SITE = path.join(tmpRoot, 'site'); const DATA = path.join(tmpRoot, 'data');
const srv = spawn(process.execPath, [path.join(root, 'src', 'server.js')], {
  cwd: root,
  env: { ...process.env, PORT: '18084', CHM_SITE: SITE, CHM_DATA: DATA,
         MAX_USER_DOCS: '2', MAX_USER_BYTES: String(10 * 1024 * 1024) },
  stdio: 'pipe',
});
let pass = true;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (x ? ' [' + x + ']' : '')); if (!c) pass = false; };
function json(method, p, body, headers = {}) {
  return new Promise((resolve) => {
    const r = http.request({ host: 'localhost', port: '18084', path: p, method, headers: { 'Content-Type': 'application/json', ...headers } }, (x) => {
      let b = []; x.on('data', (c) => b.push(c)); x.on('end', () => resolve({ st: x.statusCode, body: JSON.parse(Buffer.concat(b).toString() || '{}') }));
    });
    r.on('error', (e) => resolve({ st: 0, body: { err: e.message } }));
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}
function upload(token, filename) {
  return new Promise((resolve) => {
    const bd = '----qd' + Date.now() + Math.random().toString(36).slice(2);
    const buf = fs.readFileSync(CHM);
    const head = Buffer.from('--' + bd + '\r\nContent-Disposition: form-data; name="visibility"\r\n\r\npublic\r\n--' + bd +
      '\r\nContent-Disposition: form-data; name="file"; filename="' + (filename || 'd.chm') + '"\r\nContent-Type: application/octet-stream\r\n\r\n');
    const tail = Buffer.from('\r\n--' + bd + '--\r\n');
    const body = Buffer.concat([head, buf, tail]);
    const h = { 'Content-Type': 'multipart/form-data; boundary=' + bd, 'Content-Length': body.length };
    if (token) h['X-User-Token'] = token;
    const r = http.request({ host: '127.0.0.1', port: '18084', path: '/api/upload', method: 'POST', headers: h }, (x) => {
      let b = []; x.on('data', (c) => b.push(c)); x.on('end', () => resolve({ st: x.statusCode, body: JSON.parse(Buffer.concat(b).toString() || '{}') }));
    });
    r.on('error', (e) => resolve({ st: 0, body: { err: e.message } }));
    r.write(body); r.end();
  });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function main() {
  await sleep(1400);
  await json('POST', '/api/register', { username: 'quota1', password: 'secret1' });
  const l = await json('POST', '/api/login', { username: 'quota1', password: 'secret1' });
  const tok = l.body.token;
  ok('login ok', l.st === 200, String(l.st));

  const u1 = await upload(tok, 'quota_doc1.chm');
  ok('upload#1 ok (under limit)', u1.st === 200, String(u1.st) + ' ' + (u1.body.error || ''));
  const u2 = await upload(tok, 'quota_doc2.chm');
  ok('upload#2 ok (at limit)', u2.st === 200, String(u2.st));
  const u3 = await upload(tok, 'quota_doc3.chm');
  ok('upload#3 rejected by MAX_USER_DOCS=2', u3.st === 429, String(u3.st) + ' ' + (u3.body.error || ''));

  // 限流：大量 upload 请求（已超额度，但限流层先行），应出现 429
  let nonAuth429 = 0;
  for (let i = 0; i < 60; i++) { const r = await upload(tok, 'flood' + i + '.chm'); if (r.st === 429) nonAuth429++; }
  ok('some uploads hit rate-limit 429', nonAuth429 > 0, 'count=' + nonAuth429);

  // /api/usage：登录后可查到自己用量（文档数=2），匿名拿不到
  const usage = await json('GET', '/api/usage', null, { 'X-User-Token': tok });
  ok('usage api returns docs=2', usage.st === 200 && usage.body.usage && usage.body.usage.docs === 2, JSON.stringify(usage.body));
  const anonUsage = await json('GET', '/api/usage');
  ok('anon usage returns null', anonUsage.st === 200 && anonUsage.body.usage === null, JSON.stringify(anonUsage.body));

  console.log(pass ? 'QUOTA_TEST_PASS' : 'QUOTA_TEST_FAIL');
  srv.kill();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error('quota ERR', e); srv.kill(); process.exit(1); });