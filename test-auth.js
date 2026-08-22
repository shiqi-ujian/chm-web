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
  env: { ...process.env, PORT: String(PORT), CHM_SITE: SITE, CHM_DATA: DATA, ALLOW_LEGACY_REGISTER: '1', NO_CSRF: '1', NO_CAPTCHA: '1' },
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
function upload(token, visibility, filename, acceptTerms) {
  return new Promise((resolve) => {
    const bd = '----auth' + Date.now() + Math.random().toString(36).slice(2);
    const buf = fs.readFileSync(CHM);
    const head = Buffer.from('--' + bd + '\r\nContent-Disposition: form-data; name="acceptTerms"\r\n\r\n' + (acceptTerms === false ? 'false' : 'true') +
      '\r\n--' + bd + '\r\nContent-Disposition: form-data; name="visibility"\r\n\r\n' + visibility +
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
function raw(p, token) {
  return new Promise((resolve) => {
    const h = {}; if (token) h['X-User-Token'] = token;
    const r = http.request({ host: 'localhost', port: PORT, path: p, method: 'GET', headers: h }, (x) => {
      let b = []; x.on('data', (c) => b.push(c)); x.on('end', () => resolve({ st: x.statusCode, body: Buffer.concat(b).toString() }));
    });
    r.on('error', (e) => resolve({ st: 0, body: 'ERR ' + e.message }));
    r.end();
  });
}
function del(p, headers) {
  return new Promise((resolve) => {
    const r = http.request({ host: 'localhost', port: PORT, path: p, method: 'DELETE', headers: headers || {} }, (x) => {
      let b = []; x.on('data', (c) => b.push(c)); x.on('end', () => resolve({ st: x.statusCode, body: JSON.parse(Buffer.concat(b).toString() || '{}') }));
    });
    r.on('error', (e) => resolve({ st: 0, body: { err: e.message } }));
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

  // ---- 强制邮箱验证（绑定真实邮箱的账号未验证禁止登录）----
  const regE = await json('POST', '/api/register', { username: 'carol', email: 'carol@test.com', password: 'secret1' });
  ok('register with email 200', regE.st === 200, String(regE.st));
  const lgE1 = await json('POST', '/api/login', { username: 'carol', password: 'secret1' });
  ok('unverified login 403', lgE1.st === 403 && /验证邮箱/.test(lgE1.body.error || ''), lgE1.st + ' ' + (lgE1.body.error || ''));
  const Database = require('better-sqlite3');
  const dbx = new Database(path.join(DATA, 'app.db'));
  dbx.prepare("UPDATE users SET email_verified=1 WHERE username='carol'").run();
  dbx.close();
  const lgE2 = await json('POST', '/api/login', { username: 'carol', password: 'secret1' });
  ok('verified login 200', lgE2.st === 200 && !!lgE2.body.token, String(lgE2.st));

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
  // 转公开后壳必须重建为相对链接（此前 idB 是私有上传的，壳带 /p/ 前缀；不重建则公开页 403/404）
  {
    const pubShell = await raw('/d/' + idB + '/');
    const pubHome = /var home = '([^']*)'/.exec(pubShell.body);
    ok('public shell rebuilt: home is relative (no /p/ prefix)', pubShell.st === 200 && pubHome && !pubHome[1].startsWith('/'),
      pubHome ? pubHome[1] : 'no home');
    ok('public shell has no /p/<id>/ absolute refs', !pubShell.body.includes('/p/' + idB + '/'));
  }
  const visPriv = await json('POST', '/api/doc/' + idB + '/visibility', { visibility: 'private' }, { 'X-User-Token': tok });
  ok('owner set private 200', visPriv.st === 200, String(visPriv.st));
  ok('after private: /d/ 404', (await get('/d/' + idB + '/')) === 404);
  ok('after private: /p/ anon 403', (await get('/p/' + idB + '/')) === 403);
  ok('after private: /p/ owner 200', (await get('/p/' + idB + '/', tok)) === 200);
  // 转私有后壳必须用 /p/<id>/ 绝对前缀（否则正文 iframe 相对解析 404 / 无尾斜杠 URL 也 404）
  {
    const privShell = await raw('/p/' + idB + '/', tok);
    const privHome = /var home = '([^']*)'/.exec(privShell.body);
    ok('private shell home is absolute /p/<id>/ prefixed', privShell.st === 200 && privHome && privHome[1].startsWith('/p/' + idB + '/'),
      privHome ? privHome[1] : 'no home');
    if (privHome && privHome[1].startsWith('/p/' + idB + '/')) {
      const homeDoc = privHome[1].slice(('/p/' + idB).length); // /xxx.htm
      ok('private home doc reachable', (await get('/p/' + idB + homeDoc, tok)) === 200, homeDoc);
    }
  }

  // ---- 中文子路径私密浏览回归（/p/<id>/<中文路径> 曾因未 decode 子路径而 404）----
  // 7-Zip 样例 CHM 内部全是 ASCII 文件名，覆盖不到中文路径；这里直接构造一个
  // 带中文目录/文件的私有文档，用真实浏览器会发出的百分号编码 URL 请求。
  {
    const enc = (s) => s.split('/').map(encodeURIComponent).join('/');
    const cjkId = '中文文档-cjk1';
    const dave = await json('POST', '/api/register', { username: 'dave', password: 'secret1' });
    const dl = await json('POST', '/api/login', { username: 'dave', password: 'secret1' });
    const dTok = dl.body.token;
    const privDir = path.join(DATA, 'private', cjkId);
    fs.mkdirSync(path.join(privDir, '职业', '狂战士'), { recursive: true });
    fs.writeFileSync(path.join(privDir, 'index.html'), '<!doctype html><html><meta charset="utf-8"><title>壳</title><body><script>window.__TOC__=[];<\/script></body></html>');
    fs.writeFileSync(path.join(privDir, '职业', '狂战士', '图腾武者.htm'), '<!doctype html><html><meta charset="utf-8"><title>图腾武者</title><body>图腾武者正文</body></html>');
    fs.mkdirSync(path.join(privDir, '职业', '狂战士', '图腾武者.files'), { recursive: true });
    fs.writeFileSync(path.join(privDir, '职业', '狂战士', '图腾武者.files', 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const dbx2 = new Database(path.join(DATA, 'app.db'));
    dbx2.prepare('INSERT INTO meta (doc_id, owner, name, visibility, share_token, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(cjkId, 'dave', '中文文档', 'private', null, Date.now(), Date.now());
    dbx2.close();
    const encId = encodeURIComponent(cjkId);
    ok('cjk private shell 200 (owner)', (await get('/p/' + encId + '/', dTok)) === 200);
    ok('cjk private subpage 200 (owner)', (await get('/p/' + encId + '/' + enc('职业/狂战士/图腾武者.htm'), dTok)) === 200);
    ok('cjk private .files resource 200 (owner)', (await get('/p/' + encId + '/' + enc('职业/狂战士/图腾武者.files/img.png'), dTok)) === 200);
    ok('cjk private subpage anon 403', (await get('/p/' + encId + '/' + enc('职业/狂战士/图腾武者.htm'))) === 403);
    await del('/api/doc/' + encId, { 'X-User-Token': dTok }); // 清理
    ok('cjk private cleanup done', !fs.existsSync(privDir));
  }

  // ---- /api/docs 过滤 ----
  const anonList = await json('GET', '/api/docs');
  ok('anon /api/docs hides private', !anonList.body.docs.some((d) => d.id === idB), JSON.stringify(anonList.body.docs.map((d) => d.id)));
  const myList = await json('GET', '/api/docs', null, { 'X-User-Token': tok });
  const mine = myList.body.docs.find((d) => d.id === idB);
  ok('owner /api/docs lists private with tag', !!mine && mine.visibility === 'private' && mine.owner === 'alice', JSON.stringify(mine || {}));

  // ---- 删除（仅 owner 可删，放 /api/docs 过滤之后，避免删掉后影响 listing 用例）----
  const delAnon = await del('/api/doc/' + idB, null);
  ok('anon delete 403', delAnon.st === 403, String(delAnon.st));
  const delOther = await del('/api/doc/' + idB, { 'X-User-Token': l2.body.token });
  ok('non-owner delete 403', delOther.st === 403, String(delOther.st));
  const delOwner = await del('/api/doc/' + idB, { 'X-User-Token': tok });
  ok('owner delete 200', delOwner.st === 200, JSON.stringify(delOwner.body));
  ok('after delete: /p/ gone (not 200)', (await get('/p/' + idB + '/', tok)) !== 200);
  ok('after delete: entity gone', !fs.existsSync(path.join(DATA, 'private', idB)));

  // ---- 私有文档导出 ACL（回归：EXPORT_TOKEN 未配置时匿名不得导出私有）----
  {
    // 重新造一个私有文档来测（上面已删）
    const up2 = await upload(tok, 'private', 'exppriv.chm');
    const expId = up2.body.id;
    const anonExp = await json('POST', '/api/export-docs', { ids: [expId], title: 'x' }, {});
    ok('anon export private doc 403', anonExp.st === 403, String(anonExp.st) + ' ' + (anonExp.body && anonExp.body.error || ''));
    const ownerExp = await json('POST', '/api/export-docs', { ids: [expId], title: 'x' }, { 'X-User-Token': tok });
    ok('owner export private doc 200', ownerExp.st === 200 && !!ownerExp.body.zip, String(ownerExp.st));
    await del('/api/doc/' + expId, { 'X-User-Token': tok });
  }

  // ---- 修改密码 ----
  const cpAnon = await json('POST', '/api/change-password', { oldPassword: 'secret1', newPassword: 'newsecret1' });
  ok('change-pwd anon 401', cpAnon.st === 401, String(cpAnon.st));
  const cpWrong = await json('POST', '/api/change-password', { oldPassword: 'badold', newPassword: 'newsecret1' }, { 'X-User-Token': tok });
  ok('change-pwd wrong old 403', cpWrong.st === 403, String(cpWrong.st));
  const cpShort = await json('POST', '/api/change-password', { oldPassword: 'secret1', newPassword: '123' }, { 'X-User-Token': tok });
  ok('change-pwd short new 400', cpShort.st === 400, String(cpShort.st));
  const tok2 = (await json('POST', '/api/login', { username: 'alice', password: 'secret1' })).body.token;
  ok('second session before change', !!tok2, '');
  const cpOk = await json('POST', '/api/change-password', { oldPassword: 'secret1', newPassword: 'newsecret1' }, { 'X-User-Token': tok });
  ok('change-pwd 200', cpOk.st === 200 && cpOk.body.ok === true, String(cpOk.st));
  const oldLogin = await json('POST', '/api/login', { username: 'alice', password: 'secret1' });
  ok('old pwd login 401', oldLogin.st === 401, String(oldLogin.st));
  const newLogin = await json('POST', '/api/login', { username: 'alice', password: 'newsecret1' });
  ok('new pwd login 200', newLogin.st === 200 && !!newLogin.body.token, String(newLogin.st));
  ok('current session kept', (await json('GET', '/api/me', null, { 'X-User-Token': tok })).body.user === 'alice');
  ok('other session revoked', (await json('GET', '/api/me', null, { 'X-User-Token': tok2 })).body.user === null);

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
