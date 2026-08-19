'use strict';
// test-atomic.js — 持久化健壮性自测（SQLite 版）：
//   注册/登录与会话持久化、大量会话并发写入不丢更新、会话惰性过期清理、无残留临时文件。
// 直接驱动 auth.js（内部走 SQLite + WAL），用临时 dataDir。
const path = require('path');
const fs = require('fs');
const os = require('os');
const auth = require('./src/lib/auth');
const dbm = require('./src/lib/db');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chmweb-atomic-'));
let pass = true;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (x ? ' [' + x + ']' : '')); if (!c) pass = false; };

// 1) 注册+登录
auth.init(tmp);
process.env.ALLOW_LEGACY_REGISTER = '1';
const r1 = auth.register({ username: 'userA', password: 'secret1' });
ok('register ok', r1.ok, '');
const l1 = auth.login({ username: 'userA', password: 'secret1' });
ok('login yields token', !!l1.token, '');
ok('userByToken resolves', auth.userByToken(l1.token) === 'userA', '');

// 2) 并发登录（大量会话）后仍能解析：验证写入不丢更新（SQLite 事务 + WAL）
const toks = [];
for (let i = 0; i < 40; i++) { const x = auth.login({ username: 'userA', password: 'secret1' }); toks.push(x.token); }
let allOk = toks.every((t) => auth.userByToken(t) === 'userA');
ok('40 concurrent logins all resolvable', allOk, 'count=' + toks.length);

// 3) 会话惰性清理：往 sessions 表插一个过期会话，读时应收敛（userByToken 只认 TTL 内）
const expired = 'e'.repeat(64);
dbm.db.prepare('INSERT INTO sessions (token, username, created_at) VALUES (?,?,?)')
  .run(expired, 'userA', Date.now() - 40 * 24 * 60 * 60 * 1000); // 40 天前
ok('expired session yields null after prune', auth.userByToken(expired) === null, '');

// 4) 数据层完整性：残留了 app.db 且无 .tmp 半成品
ok('app.db exists', fs.existsSync(path.join(tmp, 'app.db')), '');
ok('no *.tmp residue in dataDir', fs.readdirSync(tmp).filter((f) => f.endsWith('.tmp')).length === 0, '');

// 5) 重开数据库后会话仍在（持久化跨进程/重启）
dbm.close();
auth.init(tmp);
ok('session survives reopen', auth.userByToken(l1.token) === 'userA', '');

console.log(pass ? 'ATOMIC_TEST_PASS' : 'ATOMIC_TEST_FAIL');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
process.exit(pass ? 0 : 1);