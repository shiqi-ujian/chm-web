'use strict';
// test-db.js — SQLite 存储层 + JSON→SQLite 迁移自测：
//   ① auth 全链路走 SQLite（注册/登录/可见性）
//   ② 一次性 JSON→SQLite 迁移：预置 JSON 数据 → 打开 → 数据进表且 JSON 被备份
//   ③ 幂等：再次打开不重复迁移、不丢新数据
const path = require('path');
const fs = require('fs');
const os = require('os');
const auth = require('./src/lib/auth');
const dbm = require('./src/lib/db');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chmweb-db-test-'));
let pass = true;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (x ? ' [' + x + ']' : '')); if (!c) pass = false; };

// ---- 1) 全链路 SQLite 存取 ----
auth.init(tmp);
process.env.ALLOW_LEGACY_REGISTER = '1'; // 兼容旧测试签名：不强制 email/acceptTerms
const reg = auth.register({ username: 'alice', password: 'secret1' });
ok('register ok', reg.ok);
const l = auth.login({ username: 'alice', password: 'secret1' });
ok('login token', !!l.token);
auth.ensureMeta('doc1', { owner: 'alice', name: 'Doc One', visibility: 'private' });
const m = auth.getMeta('doc1');
ok('meta stored', !!m && m.owner === 'alice' && m.visibility === 'private' && m.name === 'Doc One', JSON.stringify(m));
const sh = auth.share('doc1', 'alice');
ok('share token', !!sh.shareToken && auth.docIdByShareToken(sh.shareToken) === 'doc1', sh.sharePath);
ok('canRead owner', auth.canRead('doc1', { username: 'alice' }) === true);
ok('canRead share', auth.canRead('doc1', { shareToken: sh.shareToken }) === true);
ok('canRead anon', auth.canRead('doc1', {}) === false);
ok('deleteMeta', auth.deleteMeta('doc1', 'alice') === true);
ok('after delete meta gone', auth.getMeta('doc1') === null);
// 关闭，为下一用例让出 DB 单例
dbm.close();

// ---- 2) JSON→SQLite 迁移（新 tmp2）----
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'chmweb-db-mig-'));
fs.writeFileSync(path.join(tmp2, 'users.json'), JSON.stringify({
  bob: { salt: 's1', hash: 'h1', createdAt: 1000 },
}, null, 2));
fs.writeFileSync(path.join(tmp2, 'sessions.json'), JSON.stringify({
  'tok1': { username: 'bob', createdAt: 2000 },
}, null, 2));
fs.writeFileSync(path.join(tmp2, 'meta.json'), JSON.stringify({
  m1: { owner: 'bob', name: 'MigDoc', visibility: 'public', shareToken: 'st1', createdAt: 3000 },
}, null, 2));

auth.init(tmp2);
ok('migration: user imported', dbm.db.prepare('SELECT 1 FROM users WHERE username=?').get('bob') !== undefined);
ok('migration: session imported', dbm.db.prepare('SELECT 1 FROM sessions WHERE token=?').get('tok1') !== undefined);
ok('migration: meta imported', auth.getMeta('m1') !== null && auth.getMeta('m1').owner === 'bob', JSON.stringify(auth.getMeta('m1')));
ok('migration: json backed up', !fs.existsSync(path.join(tmp2, 'users.json')), '');

// 幂等：再次打开不重复导入/不报错，且老会话/老 meta 仍在
dbm.close();
auth.init(tmp2);
ok('reopen idempotent (user still 1)', dbm.db.prepare('SELECT COUNT(*) c FROM users').get().c === 1, '');
ok('reopen: imported session still there', dbm.db.prepare('SELECT 1 FROM sessions WHERE token=?').get('tok1') !== undefined, '');
ok('reopen: imported meta still there', auth.getMeta('m1') !== null, '');
dbm.close();

// ---- 3) 旧库缺列升级（回归：线上崩溃根因）----
// 构造只有旧 4 列的 users 表（无 email 等新列），open 必须成功补列、建索引、保留数据
const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'chmweb-db-old-'));
const Database = require('better-sqlite3');
const old = new Database(path.join(tmp3, 'app.db'));
old.exec(`
  CREATE TABLE users (username TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE sessions (token TEXT PRIMARY KEY, username TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE meta (doc_id TEXT PRIMARY KEY, owner TEXT, name TEXT, visibility TEXT NOT NULL DEFAULT 'public', share_token TEXT, created_at INTEGER NOT NULL);
`);
old.exec(`INSERT INTO users VALUES ('legacy','s','h',1)`);
old.close();

auth.init(tmp3); // 不应抛异常（旧库升级必须幂等成功）
const cols3 = dbm.db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
ok('old-schema upgrade: email column added', cols3.includes('email'), cols3.join(','));
ok('old-schema upgrade: email_verified column added', cols3.includes('email_verified'), '');
ok('old-schema upgrade: failed_attempts column added', cols3.includes('failed_attempts'), '');
ok('old-schema upgrade: last_failed_at column added', cols3.includes('last_failed_at'), '');
ok('old-schema upgrade: email index created', dbm.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_users_email'`).get() !== undefined, '');
ok('old-schema upgrade: data preserved', dbm.db.prepare('SELECT COUNT(*) c FROM users').get().c === 1, '');
dbm.close();

// ---- 4) 登录失败计数与锁定修复（M6.1 三连修）----
//   4a. 邮箱登录输错密码也必须累计失败次数（修复前 UPDATE WHERE username=邮箱 不生效）
//   4b. 失败计数时间衰减：距上次失败 >10 分钟重新计数，不再「锁一次永久锁死」
//   4c. resetPassword 必须清除失败计数与锁定（修复前重置完仍被 423 挡在门外）
const tmp4 = fs.mkdtempSync(path.join(os.tmpdir(), 'chmweb-db-lock-'));
auth.init(tmp4);
const reg4 = auth.register({ username: 'erin', password: 'secret1' }); // legacy → erin@local.invalid
ok('lock-fix: register erin', reg4.ok);

// 4a：用邮箱输错密码
let lastErr = null;
for (let i = 0; i < 4; i++) {
  try { auth.login({ username: 'erin@local.invalid', password: 'bad' }); } catch (e) { lastErr = e; }
}
ok('lock-fix: 4×email-wrong → 401', lastErr && lastErr.status === 401, String(lastErr && lastErr.status));
try { auth.login({ username: 'erin@local.invalid', password: 'bad' }); } catch (e) { lastErr = e; }
ok('lock-fix: 5th email-wrong → 423 locked', lastErr && lastErr.status === 423, String(lastErr && lastErr.status));
let r4 = dbm.db.prepare('SELECT failed_attempts, locked_until, last_failed_at FROM users WHERE username=?').get('erin');
ok('lock-fix: counter=5 + locked_until set', r4.failed_attempts === 5 && r4.locked_until > 0, JSON.stringify(r4));

// 4b：锁定已过期 + 距上次失败超过窗口 → 重新计数
dbm.db.prepare('UPDATE users SET locked_until=0, last_failed_at=? WHERE username=?').run(Date.now() - 11 * 60 * 1000, 'erin');
try { auth.login({ username: 'erin', password: 'bad' }); } catch (e) { lastErr = e; }
ok('lock-fix: decayed failure → 401 (not 423)', lastErr && lastErr.status === 401, String(lastErr && lastErr.status));
r4 = dbm.db.prepare('SELECT failed_attempts, locked_until, last_failed_at FROM users WHERE username=?').get('erin');
ok('lock-fix: counter decayed to 1', r4.failed_attempts === 1 && r4.locked_until === 0, JSON.stringify(r4));

// 4b2：窗口内（<10 分钟）不衰减 → 继续累计并重新锁定
dbm.db.prepare('UPDATE users SET failed_attempts=5, locked_until=0, last_failed_at=? WHERE username=?').run(Date.now() - 5 * 60 * 1000, 'erin');
try { auth.login({ username: 'erin', password: 'bad' }); } catch (e) { lastErr = e; }
ok('lock-fix: recent streak still relocks (423)', lastErr && lastErr.status === 423, String(lastErr && lastErr.status));

// 4c：重置密码清除锁定
dbm.db.prepare('UPDATE users SET failed_attempts=1, locked_until=0, last_failed_at=? WHERE username=?').run(Date.now(), 'erin');
const code = 'resetcode123';
dbm.db.prepare('UPDATE users SET password_reset_token=?, password_reset_expires=? WHERE username=?')
  .run(require('crypto').createHash('sha256').update(code).digest('hex'), Date.now() + 3600000, 'erin');
const rp4 = auth.resetPassword(code, 'newsecret1');
ok('lock-fix: resetPassword ok', rp4.ok && rp4.username === 'erin');
r4 = dbm.db.prepare('SELECT failed_attempts, locked_until, last_failed_at FROM users WHERE username=?').get('erin');
ok('lock-fix: reset cleared lock counters', r4.failed_attempts === 0 && r4.locked_until === 0, JSON.stringify(r4));
const rel4 = auth.login({ username: 'erin', password: 'newsecret1' });
ok('lock-fix: login with new password right after reset', !!rel4.token, '');
dbm.close();

console.log(pass ? 'DB_TEST_PASS' : 'DB_TEST_FAIL');
try { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(tmp2, { recursive: true, force: true }); fs.rmSync(tmp3, { recursive: true, force: true }); fs.rmSync(tmp4, { recursive: true, force: true }); } catch (_) {}
process.exit(pass ? 0 : 1);