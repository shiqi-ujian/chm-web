'use strict';
// test-auth.js — M2 账号 + 可见性自测：
//   注册/登录/会话 / 公开-私有上传 / ACL(owner/匿名/分享链接) / 可见性切换实体迁移 / /api/docs 过滤。
// 用临时 CHM_SITE/CHM_DATA 起真实 server，不污染仓库 docs/ 与 data/。
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = __dirname;
const PORT = 18082;
const CHM = process.argv[2] || (
  process.platform === 'win32' && fs.existsSync('C:/Program Files/7-Zip/7-zip.chm')
    ? 'C:/Program Files/7-Zip/7-zip.chm'
    : null
);
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chmweb-auth-test-'));
const SITE = path.join(tmpRoot, 'site');
const DATA = path.join(tmpRoot, 'data');

if (!CHM || !fs.existsSync(CHM)) {
  console.error('未找到 7-Zip 自带样例 chm，无法测试上传。用法：node test-auth.js <sample.chm>');
  process.exit(1);
}

const srv = spawn(process.execPath, [path.join(root, 'src', 'server.js')], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), CHM_SITE: SITE, CHM_DATA: DATA },
  stdio: 'pipe',
});
let log = '';
srv.stdout.on('data', (d) => { log += d; });
srv.stderr.on('data', (d) => { log += d; });

let pass = true;
const ok = (n, c, extra) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (extra ? '  [' + extra + ']' : '')); if (!c) pass = false; };

function json(method, p, body, headers = {}) {
  return new Promise((resolve) => {
    const r = http.request({ host: 'localhost', port: PORT, path: p, method, headers: { 'Content-Type': 'application/json', ...headers } }, (x) => {
      let b = []; x.on('data', (c) => b.push(c)); x.on('end', () => resolve({ st: x.statusCode, body: JSON.parse(Buffer.concat(b).toString() || '{}') }));
    });
    r.on('error', (e) => resolve({ st: 0, body: { err: e.message } }));
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}
function upload(token, visibility, filename) {
  return new Promise((resolve) => {
    const bd = '----auth' + Date.now() + Math.random().toString(36).slice(2);
    const buf = fs.readFileSync(CHM);
    const head = Buffer.from('--' + bd + '\r\nContent-Disposition: form-data; name="visibility"\r\n\r\n' + visibility +
      '\r\n--' + bd + '\r\nContent-Disposition: form-data; name="file"; filename="' + (filename || 'doc.chm') + '"\r\nContent-Type: application/octet-stream\r\n\r\n');
    const tail = Buffer.from('\r\n--' + bd + '--\r\n');
    const body = Buffer.concat([head, buf, tail]);
    const h = { 'Content-Type': 'multipart/form-data; boundary=' + bd, 'Content-Length': body.length };
    if (token) h['X-User-Token'] = token;
    const r = http.request({ host: 'localhost', port: PORT, path: '/api/upload', method: 'POST', headers: h }, (x) => {
      let b = []; x.on('data', (c) => b.push(c)); x.on('end', () => resolve({ st: x.statusCode, body: JSON.parse(Buffer.concat(b).toString() || '{}') }));
    });
    r.on('error', (e) => resolve({ st: 0, body: { err: e.message } }));
    r.write(body); r.end();
  });
}
function get(p, token) {
  return new Promise((resolve) => {
    const h = {}; if (token) h['X-User-Token'] = token;
    const r = http.request({ host: 'localhost', port: PORT, path: p, method: 'GET', headers: h }, (x) => {
      x.resume(); x.on('end', () => resolve(x.statusCode));
    });
    r.on('error', () => resolve(0));
    r.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  await sleep(1200); // 等 server 起

  // ---- 账号 ----
  const reg = await json('POST', '/api/register', { username: 'alice', password: 'secret1' });
  ok('register 200', reg.st === 200, String(reg.st));
  const dup = await json('POST', '/api/register', { username: 'alice', password: 'secret1' });
  ok('dup register 409', dup.st === 409, String(dup.st));
  const short = await json('POST', '/api/register', { username: 'bob', password: '123' });
  ok('short pwd 400', short.st === 400, String(short.st));
  const login = await json('POST', '/api/login', { username: 'alice', password: 'secret1' });
  ok('login 200 + token', login.st === 200 && !!login.body.token, String(login.st));
  const tok = login.body.token;
  const wrong = await json('POST', '/api/login', { username: 'alice', password: 'wrong1' });
  ok('wrong pwd 401', wrong.st === 401, String(wrong.st));
  const me = await json('GET', '/api/me', null, { 'X-User-Token': tok });
  ok('me = alice', me.st === 200 && me.body.user === 'alice', JSON.stringify(me.body));

  // ---- 上传可见性 (C档：未登录一律不可上传) ----
  const anonPriv = await upload(null, 'private');
  ok('anon upload private 401', anonPriv.st === 401, String(anonPriv.st) + ' ' + (anonPriv.body.error || ''));
  const anonPub = await upload(null, 'public', 'anonpub.chm');
  ok('anon upload public 401 (C档强制登录)', anonPub.st === 401, String(anonPub.st) + ' ' + (anonPub.body.error || ''));
  const pub = await upload(tok, 'public', 'pubdoc.chm');
  ok('owner upload public 200', pub.st === 200 && pub.body.url, String(pub.st));
  const idA = pub.body.id;
  ok('public doc readable at /d/', (await get('/d/' + idA + '/')) === 200);

  const priv = await upload(tok, 'private', 'privdoc.chm');
  ok('owner upload private 200', priv.st === 200 && priv.body.isPrivate === true, String(priv.st));
  const idB = priv.body.id;
  ok('private NOT in /d/ (404)', (await get('/d/' + idB + '/')) === 404);
  ok('private /p/ anon 403', (await get('/p/' + idB + '/')) === 403);
  ok('private /p/ owner 200', (await get('/p/' + idB + '/', tok)) === 200);
  ok('private /p/ subpage owner 200', (await get('/p/' + idB + '/start.htm', tok)) === 200);
  ok('private entity under data/', fs.existsSync(path.join(DATA, 'private', idB, 'index.html')));

  // ---- 分享链接 ----
  const sh = await json('POST', '/api/doc/' + idB + '/share', {}, { 'X-User-Token': tok });
  ok('share 200 + sharePath', sh.st === 200 && !!sh.body.sharePath, JSON.stringify(sh.body));
  ok('share link redirects 302', (await get(sh.body.sharePath)) === 302);
  ok('share query grants access 200', (await get('/p/' + idB + '/?share=' + sh.body.shareToken)) === 200);
  const anonShare = await json('POST', '/api/doc/' + idB + '/share', {}, {});
  ok('anon share 403', anonShare.st === 403, String(anonShare.st));

  // ---- 可见性切换（实体迁移）----
  await json('POST', '/api/register', { username: 'mallory', password: 'secret1' });
  const l2 = await json('POST', '/api/login', { username: 'mallory', password: 'secret1' });
  const visX = await json('POST', '/api/doc/' + idB + '/visibility', { visibility: 'public' }, { 'X-User-Token': l2.body.token });
  ok('non-owner set visibility 403', visX.st === 403, String(visX.st));
  const visPub = await json('POST', '/api/doc/' + idB + '/visibility', { visibility: 'public' }, { 'X-User-Token': tok });
  ok('owner set public 200', visPub.st === 200, String(visPub.st));
  ok('after public: /d/ 200 (migrated)', (await get('/d/' + idB + '/')) === 200);
  ok('after public: entity left private/', !fs.existsSync(path.join(DATA, 'private', idB)));
  const visPriv = await json('POST', '/api/doc/' + idB + '/visibility', { visibility: 'private' }, { 'X-User-Token': tok });
  ok('owner set private 200', visPriv.st === 200, String(visPriv.st));
  ok('after private: /d/ 404', (await get('/d/' + idB + '/')) === 404);
  ok('after private: /p/ anon 403', (await get('/p/' + idB + '/')) === 403);
  ok('after private: /p/ owner 200', (await get('/p/' + idB + '/', tok)) === 200);

  // ---- /api/docs 过滤 ----
  const anonList = await json('GET', '/api/docs');
  ok('anon /api/docs hides private', !anonList.body.docs.some((d) => d.id === idB), JSON.stringify(anonList.body.docs.map((d) => d.id)));
  const myList = await json('GET', '/api/docs', null, { 'X-User-Token': tok });
  const mine = myList.body.docs.find((d) => d.id === idB);
  ok('owner /api/docs lists private with tag', !!mine && mine.visibility === 'private' && mine.owner === 'alice', JSON.stringify(mine || {}));

  // ---- 登出 ----
  const out = await json('POST', '/api/logout', null, { 'X-User-Token': tok });
  ok('logout 200', out.st === 200);
  const me2 = await json('GET', '/api/me', null, { 'X-User-Token': tok });
  ok('after logout me=null', me2.body.user === null, JSON.stringify(me2.body));

  console.log(pass ? 'AUTH_TEST_PASS' : 'AUTH_TEST_FAIL');
  srv.kill();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('test-auth ERR', e); console.log(log.split('\n').slice(-10).join('\n')); srv.kill(); process.exit(1); });
