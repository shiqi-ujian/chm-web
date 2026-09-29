'use strict';
// test-limits.js — 上传/导出体积护栏自测（2026-09-29 新增）
//   A) 放宽实例：上传限内 200、导出 POST/GET 正常出 zip（正向路径不能被护栏误伤）
//   B) 严格实例：超限时返回 413 且文案里带上限数字（上传 / 批量导出 / 整站导出三条路）
// 说明：护栏的意义是防 OOM —— 导出 zip 目前在内存里拼装，实测峰值 ≈ 输入体积 ×3~4。
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const root = __dirname;
const CHM = process.argv[2] || (
  process.platform === 'win32' && fs.existsSync('C:/Program Files/7-Zip/7-zip.chm')
    ? 'C:/Program Files/7-Zip/7-zip.chm' : null
);
if (!CHM || !fs.existsSync(CHM)) { console.error('need sample.chm'); process.exit(1); }

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chmweb-limits-'));
const SITE = path.join(tmpRoot, 'site');
const DATA = path.join(tmpRoot, 'data');

let pass = true;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (x ? ' [' + x + ']' : '')); if (!c) pass = false; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(port, extraEnv) {
  return spawn(process.execPath, [path.join(root, 'src', 'server.js')], {
    cwd: root,
    env: {
      ...process.env, PORT: String(port), CHM_SITE: SITE, CHM_DATA: DATA,
      ALLOW_LEGACY_REGISTER: '1', NO_CSRF: '1', NO_CAPTCHA: '1', ...extraEnv,
    },
    stdio: 'pipe',
  });
}

function json(port, method, p, body, headers = {}) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', ...headers } }, (x) => {
      const b = []; x.on('data', (c) => b.push(c));
      x.on('end', () => resolve({ st: x.statusCode, body: JSON.parse(Buffer.concat(b).toString() || '{}') }));
    });
    r.on('error', (e) => resolve({ st: 0, body: { err: e.message } }));
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function get(port, p, headers = {}) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers }, (x) => {
      const b = []; x.on('data', (c) => b.push(c));
      x.on('end', () => resolve({ st: x.statusCode, len: Buffer.concat(b).length, body: Buffer.concat(b).toString().slice(0, 300) }));
    });
    r.on('error', (e) => resolve({ st: 0, len: 0, body: e.message }));
    r.end();
  });
}

/** 上传：padBytes 用来把 multipart 体积撑大（模拟超大文件） */
function upload(port, token, { padBytes = 0, filename = 'd.chm' } = {}) {
  return new Promise((resolve) => {
    const bd = '----lt' + Date.now() + Math.random().toString(36).slice(2);
    const buf = fs.readFileSync(CHM);
    const parts = [
      Buffer.from('--' + bd + '\r\nContent-Disposition: form-data; name="acceptTerms"\r\n\r\ntrue\r\n'),
      Buffer.from('--' + bd + '\r\nContent-Disposition: form-data; name="visibility"\r\n\r\npublic\r\n'),
    ];
    if (padBytes > 0) {
      parts.push(Buffer.from('--' + bd + '\r\nContent-Disposition: form-data; name="pad"\r\n\r\n'));
      parts.push(Buffer.alloc(padBytes, 0x61));
      parts.push(Buffer.from('\r\n'));
    }
    parts.push(Buffer.from('--' + bd + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename +
      '"\r\nContent-Type: application/octet-stream\r\n\r\n'));
    parts.push(buf);
    parts.push(Buffer.from('\r\n--' + bd + '--\r\n'));
    const body = Buffer.concat(parts);
    const h = { 'Content-Type': 'multipart/form-data; boundary=' + bd, 'Content-Length': body.length };
    if (token) h['X-User-Token'] = token;
    const r = http.request({ host: '127.0.0.1', port, path: '/api/upload', method: 'POST', headers: h }, (x) => {
      const b = []; x.on('data', (c) => b.push(c));
      x.on('end', () => resolve({ st: x.statusCode, body: JSON.parse(Buffer.concat(b).toString() || '{}') }));
    });
    r.on('error', (e) => resolve({ st: 0, body: { err: e.message } }));
    r.write(body); r.end();
  });
}

async function login(port, user) {
  await json(port, 'POST', '/api/register', { username: user, password: 'secret1' });
  const l = await json(port, 'POST', '/api/login', { username: user, password: 'secret1' });
  return l.body.token;
}

async function main() {
  const A = 18085, B = 18086;
  const srvA = start(A, { MAX_BYTES: String(2 * 1024 * 1024), EXPORT_MAX_BYTES: String(4 * 1024 * 1024), EXPORT_JSON_MAX_BYTES: String(4 * 1024 * 1024), EXPORT_SITE_MAX_BYTES: String(4 * 1024 * 1024) });
  await sleep(1500);
  const tokA = await login(A, 'lima');
  ok('A: 注册/登录拿到 token', !!tokA);

  const upOk = await upload(A, tokA, { filename: 'limit-a.chm' });
  ok('A: 限内上传 200', upOk.st === 200 && upOk.body.ok === true, 'st=' + upOk.st + ' ' + JSON.stringify(upOk.body).slice(0, 80));
  const id = upOk.body.id;

  const upBigA = await upload(A, tokA, { padBytes: 3 * 1024 * 1024, filename: 'limit-big.chm' });
  ok('A: 超 MAX_BYTES 上传 413', upBigA.st === 413, 'st=' + upBigA.st);
  ok('A: 413 文案带上限数字', /上限 2MB/.test(upBigA.body.error || ''), upBigA.body.error);

  const postOk = await json(A, 'POST', '/api/export-docs', { ids: [id] }, { 'X-User-Token': tokA });
  ok('A: POST 批量导出在限内出 zip', postOk.st === 200 && !!postOk.body.zip, 'st=' + postOk.st + ' count=' + postOk.body.count);
  const getOk = await get(A, '/api/export-docs?ids=' + encodeURIComponent(id));
  ok('A: GET 批量导出在限内出 zip', getOk.st === 200 && getOk.len > 1000, 'st=' + getOk.st + ' len=' + getOk.len);
  const siteOk = await get(A, '/site-export.zip');
  ok('A: 限内整站导出 200', siteOk.st === 200 && siteOk.len > 1000, 'st=' + siteOk.st + ' len=' + siteOk.len);

  // —— 严格实例：同样的文档，三条导出路径都应被 413 拦住 ——
  const srvB = start(B, { MAX_BYTES: String(2 * 1024 * 1024), EXPORT_MAX_BYTES: String(64 * 1024), EXPORT_JSON_MAX_BYTES: String(64 * 1024), EXPORT_SITE_MAX_BYTES: String(64 * 1024) });
  await sleep(1500);
  const tokB = await login(B, 'limb');
  const postBig = await json(B, 'POST', '/api/export-docs', { ids: [id] }, { 'X-User-Token': tokB });
  ok('B: POST 导出超限 413', postBig.st === 413, 'st=' + postBig.st + ' ' + (postBig.body.error || '').slice(0, 60));
  ok('B: 413 提示改走直接下载', /export-docs\?ids=/.test(postBig.body.error || ''), (postBig.body.error || '').slice(-70));
  const getBig = await get(B, '/api/export-docs?ids=' + encodeURIComponent(id));
  ok('B: GET 导出超限 413', getBig.st === 413, 'st=' + getBig.st);
  const siteBig = await get(B, '/site-export.zip');
  ok('B: 整站导出超限 413', siteBig.st === 413, 'st=' + siteBig.st);
  ok('B: 整站 413 提示 rsync/scp', /rsync\/scp/.test(siteBig.body), siteBig.body.slice(-90));

  srvA.kill(); srvB.kill();
  await sleep(300);
  console.log(pass ? 'LIMITS_TEST_PASS' : 'LIMITS_TEST_FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('test-limits ERR', e); process.exit(1); });
