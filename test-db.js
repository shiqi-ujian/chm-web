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

console.log(pass ? 'DB_TEST_PASS' : 'DB_TEST_FAIL');
try { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(tmp2, { recursive: true, force: true }); } catch (_) {}
process.exit(pass ? 0 : 1);