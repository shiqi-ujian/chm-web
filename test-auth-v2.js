'use strict';
// test-auth-v2.js — 登录系统升级自测：
//   注册需邮箱 + 同意条款；邮箱验证；忘记/重置；失败锁定；举报入库；管理接口。
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = __dirname;
const PORT = 18093;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chmweb-authv2-'));
const SITE = path.join(tmpRoot, 'site');
const DATA = path.join(tmpRoot, 'data');
fs.mkdirSync(SITE, { recursive: true });

const env = { ...process.env, PORT: String(PORT), CHM_SITE: SITE, CHM_DATA: DATA, ALLOW_LEGACY_REGISTER: '0', NO_CSRF: '1', NO_CAPTCHA: '1', ADMIN_TOKEN: 'admin-secret-test' };
const srv = spawn(process.execPath, [path.join(root, 'src', 'server.js')], { cwd: root, env, stdio: 'pipe' });
let log = '';
srv.stdout.on('data', (d) => { log += d; });
srv.stderr.on('data', (d) => { log += d; });

let pass = true;
const ok = (n, c, extra) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (extra ? '  [' + extra + ']' : '')); if (!c) pass = false; };

function json(method, p, body, headers = {}, raw = false) {
  return new Promise((resolve) => {
    const r = http.request({ host: 'localhost', port: PORT, path: p, method, headers: { 'Content-Type': 'application/json', ...headers } }, (x) => {
      let b = []; x.on('data', (c) => b.push(c)); x.on('end', () => resolve(raw ? { st: x.statusCode, body: Buffer.concat(b).toString(), headers: x.headers } : { st: x.statusCode, body: JSON.parse(Buffer.concat(b).toString() || '{}'), headers: x.headers }));
    });
    r.on('error', (e) => resolve({ st: 0, body: { err: e.message } }));
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  await sleep(1200);

  // ---- 注册必须邮箱 + 同意条款 ----
  const noTerms = await json('POST', '/api/register', { username: 'carol', password: 'secret1', email: 'carol@example.com' });
  ok('register without acceptTerms 403', noTerms.st === 403, String(noTerms.st));
  const badEmail = await json('POST', '/api/register', { username: 'carol', password: 'secret1', email: 'bad', acceptTerms: true });
  ok('register bad email 400', badEmail.st === 400, String(badEmail.st));
  const reg = await json('POST', '/api/register', { username: 'carol', password: 'secret1', email: 'carol@example.com', acceptTerms: true });
  ok('register with terms+email 200', reg.st === 200, String(reg.st));
  const dupEmail = await json('POST', '/api/register', { username: 'carol2', password: 'secret1', email: 'carol@example.com', acceptTerms: true });
  ok('register duplicate email 409', dupEmail.st === 409, String(dupEmail.st));

  // 从 mailer.log 取最新验证 token（dev 模式）
  const mailLog = path.join(root, 'logs', 'mailer.log');
  let verifToken = '';
  try {
    const text = fs.readFileSync(mailLog, 'utf8');
    const all = [...text.matchAll(/verify-email\?token=([0-9a-f]+)/g)];
    if (all.length) verifToken = all[all.length - 1][1];
  } catch (_) {}
  const verify = await json('POST', '/api/verify-email', { token: verifToken });
  ok('verify email via link 200', verify.st === 200 && !!verify.body.token, String(verify.st) + ' ' + (verify.body.error || ''));
  // 登录支持用户名或邮箱（邮箱大小写不敏感）
  const login = await json('POST', '/api/login', { username: 'carol', password: 'secret1' });
  const loginEmail = await json('POST', '/api/login', { username: 'carol@example.com', password: 'secret1' });
  ok('login by email works', loginEmail.st === 200 && !!loginEmail.body.token, JSON.stringify(loginEmail.body));
  const me = await json('GET', '/api/me', null, { 'X-User-Token': login.body.token || '' });
  ok('me returns emailVerified', me.body.user && me.body.info && me.body.info.emailVerified === true, JSON.stringify(me.body));

  // 失败锁定
  const lockUser = await json('POST', '/api/register', { username: 'dave', password: 'secret1', email: 'dave@example.com', acceptTerms: true });
  let last = null;
  for (let i = 0; i < 5; i++) last = await json('POST', '/api/login', { username: 'dave', password: 'wrong' });
  ok('5th wrong triggers 423 locked', last.st === 423, String(last.st));

  // 忘记密码
  const forgot = await json('POST', '/api/forgot-password', { usernameOrEmail: 'carol' });
  ok('forgot password 200', forgot.st === 200, String(forgot.st));
  let resetToken = '';
  try {
    const text = fs.readFileSync(mailLog, 'utf8');
    const all = [...text.matchAll(/reset-password\?token=([0-9a-f]+)/g)];
    if (all.length) resetToken = all[all.length - 1][1];
  } catch (_) {}
  const reset = await json('POST', '/api/reset-password', { token: resetToken, newPassword: 'newsecret1' });
  ok('reset password via token 200', reset.st === 200, String(reset.st));
  const oldLogin = await json('POST', '/api/login', { username: 'carol', password: 'secret1' });
  ok('old password login after reset 401', oldLogin.st === 401, String(oldLogin.st));
  const newLogin = await json('POST', '/api/login', { username: 'carol', password: 'newsecret1' });
  ok('new password login 200', newLogin.st === 200, !!newLogin.body.token);

  // ---- 修改邮箱（登录后可改，改后需重验） ----
  const ceAnon = await json('POST', '/api/change-email', { email: 'newcarol@example.com' });
  ok('change-email anon 401', ceAnon.st === 401, String(ceAnon.st));
  const ce = await json('POST', '/api/change-email', { email: 'newcarol@example.com' }, { 'X-User-Token': newLogin.body.token });
  ok('change-email 200', ce.st === 200 && ce.body.ok, JSON.stringify(ce.body));
  const meAfterCe = await json('GET', '/api/me', null, { 'X-User-Token': newLogin.body.token });
  ok('me shows unverified after email change', meAfterCe.body.info && meAfterCe.body.info.email === 'newcarol@example.com' && meAfterCe.body.info.emailVerified === false, JSON.stringify(meAfterCe.body));

  // ---- 自助注销 ----
  const daAnon = await json('POST', '/api/delete-account', {});
  ok('delete-account anon 401', daAnon.st === 401, String(daAnon.st));
  // 直接使用已登录且已验证的 carol 会话注销（省去新用户验证步骤）
  const da = await json('POST', '/api/delete-account', {}, { 'X-User-Token': newLogin.body.token });
  ok('delete-account 200', da.st === 200 && da.body.ok === true, JSON.stringify(da.body));
  const meDel = await json('GET', '/api/me', null, { 'X-User-Token': newLogin.body.token });
  ok('after delete-account session invalid', meDel.body.user === null, JSON.stringify(meDel.body));

  // 举报
  const rep = await json('POST', '/api/report', { url: '/d/some-doc/', docId: 'some-doc', reason: '侵犯版权', contact: 'owner@example.com' });
  ok('report created', rep.st === 200 && rep.body.id, JSON.stringify(rep.body));
  const badRep = await json('POST', '/api/report', { url: '/d/x' });
  ok('report without reason 400', badRep.st === 400, String(badRep.st));

  // 管理端状态流转
  const setProcessing = await json('PATCH', '/admin/reports/' + rep.body.id, { status: 'processing' }, { 'X-Admin-Token': 'admin-secret-test' });
  ok('admin can mark report processing', setProcessing.st === 200 && setProcessing.body.status === 'processing', JSON.stringify(setProcessing.body));
  const resolveRep = await json('PATCH', '/admin/reports/' + rep.body.id, { status: 'resolved' }, { 'X-Admin-Token': 'admin-secret-test' });
  ok('admin can resolve report', resolveRep.st === 200 && resolveRep.body.status === 'resolved', JSON.stringify(resolveRep.body));
  const badStatus = await json('PATCH', '/admin/reports/' + rep.body.id, { status: 'fake' }, { 'X-Admin-Token': 'admin-secret-test' });
  ok('admin invalid status 400', badStatus.st === 400, String(badStatus.st));
  const statusDenied = await json('PATCH', '/admin/reports/' + rep.body.id, { status: 'resolved' }, {});
  ok('admin status without token 401', statusDenied.st === 401, String(statusDenied.st));

  // 管理端
  const repList = await json('GET', '/admin/reports', null, { 'X-Admin-Token': 'admin-secret-test' });
  ok('admin reports list', repList.st === 200 && Array.isArray(repList.body.reports) && repList.body.reports.length >= 1, JSON.stringify(repList.body));
  const repListDenied = await json('GET', '/admin/reports', null, {});
  ok('admin reports without token 401', repListDenied.st === 401, String(repListDenied.st));

  console.log(pass ? 'AUTH_V2_TEST_PASS' : 'AUTH_V2_TEST_FAIL');
  try { srv.kill(); fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
  process.exit(pass ? 0 : 1);
}

setTimeout(() => { console.error('AUTH_V2_TIMEOUT\n' + log); process.exit(1); }, 20000).unref();
main().catch((e) => { console.error(e); srv.kill(); process.exit(1); });