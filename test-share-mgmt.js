'use strict';
// test-share-mgmt.js — 分享链接有效期/查看/撤销/重置 + 私有文档搜索自测。
// 覆盖：
//   ① auth 层：share() 支持 expiresAt、getShare、revokeShare、过期 token 失效
//   ② HTTP 层：GET /api/search?scope=mine 只返回登录用户自己的私密文档结果
//   ③ HTTP 层：?share=<token> 只能按有效分享 token 检索（无效/过期 404）
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = __dirname;
const PORT = 18089;
const CHM = process.argv[2] || (
  process.platform === 'win32' && fs.existsSync('C:/Program Files/7-Zip/7-zip.chm')
    ? 'C:/Program Files/7-Zip/7-zip.chm'
    : null
);
if (!CHM || !fs.existsSync(CHM)) {
  console.error('未找到 7-Zip 自带样例 chm，无法测试分享管理。用法：node test-share-mgmt.js <sample.chm>');
  process.exit(1);
}
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chmweb-share-test-'));
const SITE = path.join(tmpRoot, 'site');
const DATA = path.join(tmpRoot, 'data');

const srv = spawn(process.execPath, [path.join(root, 'src', 'server.js')], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), CHM_SITE: SITE, CHM_DATA: DATA, ALLOW_LEGACY_REGISTER: '1', NO_CSRF: '1' },
  stdio: 'pipe',
});
let log = '';
srv.stdout.on('data', (d) => log += d);
srv.stderr.on('data', (d) => log += d);

let pass = true;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (x ? ' [' + x + ']' : '')); if (!c) pass = false; };

function json(method, p, body, headers = {}) {
  return new Promise((resolve) => {
    const r = http.request({ host: 'localhost', port: PORT, path: p, method, headers: { 'Content-Type': 'application/json', ...headers } }, (x) => {
      let b = []; x.on('data', (c) => b.push(c)); x.on('end', () => { try { resolve({ st: x.statusCode, body: JSON.parse(Buffer.concat(b).toString() || '{}') }); } catch (e) { resolve({ st: x.statusCode, body: { parse: false } }); } });
    });
    r.on('error', (e) => resolve({ st: 0, body: { err: e.message } }));
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}
function upload(token, filename) {
  return new Promise((resolve) => {
    const bd = '----share' + Date.now() + Math.random().toString(36).slice(2);
    const buf = fs.readFileSync(CHM);
    const head = Buffer.from('--' + bd + '\r\nContent-Disposition: form-data; name="acceptTerms"\r\n\r\ntrue' +
      '\r\n--' + bd + '\r\nContent-Disposition: form-data; name="visibility"\r\n\r\nprivate' +
      '\r\n--' + bd + '\r\nContent-Disposition: form-data; name="file"; filename="' + (filename || 'priv.chm') + '"\r\nContent-Type: application/octet-stream\r\n\r\n');
    const tail = Buffer.from('\r\n--' + bd + '--\r\n');
    const body = Buffer.concat([head, buf, tail]);
    const r = http.request({ host: 'localhost', port: PORT, path: '/api/upload', method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=' + bd, 'Content-Length': body.length, 'X-User-Token': token } }, (x) => {
      let b = []; x.on('data', (c) => b.push(c)); x.on('end', () => resolve({ st: x.statusCode, body: JSON.parse(Buffer.concat(b).toString() || '{}') }));
    });
    r.on('error', (e) => resolve({ st: 0, body: { err: e.message } }));
    r.write(body); r.end();
  });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  await sleep(1200);

  // 注册 + 登录
  await json('POST', '/api/register', { username: 'alice', password: 'secret1' });
  const l = await json('POST', '/api/login', { username: 'alice', password: 'secret1' });
  const tok = l.body.token;

  // 上传私有文档
  const up = await upload(tok, 'share-priv.chm');
  ok('upload private ok', up.st === 200 && up.body.isPrivate === true, String(up.st));
  const id = up.body.id;

  // 私密搜索：未登录 → 401
  const anonMine = await json('GET', '/api/search?scope=mine&q=7-zip');
  ok('scope=mine anon 401', anonMine.st === 401, String(anonMine.st));

  // 私密搜索：登录后返回自己私密命中
  const mine = await json('GET', '/api/search?scope=mine&q=7-zip', null, { 'X-User-Token': tok });
  ok('scope=mine owner finds own private', mine.st === 200 && mine.body.total > 0, 'st=' + mine.st + ' total=' + (mine.body.total));

  // 生成分享：永久
  const sh = await json('POST', '/api/doc/' + id + '/share', {}, { 'X-User-Token': tok });
  ok('share create ok', sh.st === 200 && !!sh.body.sharePath, JSON.stringify(sh.body));
  const shareToken = sh.body.shareToken;
  ok('share has no expiresAt', sh.body.expiresAt === null || sh.body.expiresAt === undefined, '');

  // GET share 查看
  const gs = await json('GET', '/api/doc/' + id + '/share', null, { 'X-User-Token': tok });
  ok('get share ok', gs.st === 200 && gs.body.shareToken === shareToken, '');

  // 带有效期更新
  const future = Date.now() + 3600 * 1000;
  const sh2 = await json('POST', '/api/doc/' + id + '/share', { expiresAt: future }, { 'X-User-Token': tok });
  ok('update share expiresAt', sh2.st === 200 && sh2.body.expiresAt === future, JSON.stringify(sh2.body));

  // 用分享 token 可搜索
  const scoped = await json('GET', '/api/search?q=7-zip&share=' + shareToken);
  ok('share token scoped search ok', scoped.st === 200 && scoped.body.total > 0, 'st=' + scoped.st + ' total=' + (scoped.body.total));
  ok('share search href starts with p/', Array.isArray(scoped.body.hits) && scoped.body.hits.length && scoped.body.hits[0].href.indexOf('p/') !== -1, scoped.body.hits && scoped.body.hits[0] && scoped.body.hits[0].href);

  // 过期：把 expiresAt 改成过去（直接更新库）
  const past = Date.now() - 1000;
  await json('POST', '/api/doc/' + id + '/share', { expiresAt: past }, { 'X-User-Token': tok }).then((r) => { ok('reject past expiry', r.st === 400, String(r.st)); });
  // 用数据库直接置过去（单元层验证过期失效）
  const dbm = require('./src/lib/db');
  dbm.close();
  const Database = require('better-sqlite3');
  const db = new Database(path.join(DATA, 'app.db'));
  db.prepare('UPDATE meta SET share_expires_at = ? WHERE doc_id = ?').run(Date.now() - 1000, id);
  db.close();

  const scopedExpired = await json('GET', '/api/search?q=7-zip&share=' + shareToken);
  ok('expired share token scoped search 404', scopedExpired.st === 404, String(scopedExpired.st));

  // 撤销分享
  const rev = await json('DELETE', '/api/doc/' + id + '/share', null, { 'X-User-Token': tok });
  ok('revoke share ok', rev.st === 200 && rev.body.shareToken === null, JSON.stringify(rev.body));
  const scopedRevoked = await json('GET', '/api/search?q=7-zip&share=' + shareToken);
  ok('revoked share token 404', scopedRevoked.st === 404, String(scopedRevoked.st));

  // 越权查看
  await json('POST', '/api/register', { username: 'mallory', password: 'secret1' });
  const l2 = await json('POST', '/api/login', { username: 'mallory', password: 'secret1' });
  const getOther = await json('GET', '/api/doc/' + id + '/share', null, { 'X-User-Token': l2.body.token });
  ok('non-owner get share 403', getOther.st === 403, String(getOther.st));

  console.log(pass ? 'SHARE_MGMT_TEST_PASS' : 'SHARE_MGMT_TEST_FAIL');
  srv.kill();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('test-share-mgmt ERR', e); console.log(log.split('\n').slice(-20).join('\n')); srv.kill(); process.exit(1); });