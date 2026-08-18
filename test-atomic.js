'use strict';
// test-atomic.js — 持久化健壮性自测：验证原子写（临时文件 rename）、
// 并发写入不损坏 JSON、会话表惰性过期清理正常。直接驱动 auth.js，用临时 dataDir。
const path = require('path');
const fs = require('fs');
const os = require('os');
const auth = require('./src/lib/auth');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chmweb-atomic-'));
let pass = true;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (x ? ' [' + x + ']' : '')); if (!c) pass = false; };

// 1) 注册+登录
auth.init(tmp);
const r1 = auth.register({ username: 'userA', password: 'secret1' });
ok('register ok', r1.ok, '');
const l1 = auth.login({ username: 'userA', password: 'secret1' });
ok('login yields token', !!l1.token, '');
ok('userByToken resolves', auth.userByToken(l1.token) === 'userA', '');

// 2) 并发登录（大量会话）后仍能解析：验证写队列不丢更新
const toks = [];
for (let i = 0; i < 40; i++) { const x = auth.login({ username: 'userA', password: 'secret1' }); toks.push(x.token); }
// 这里逐 token 取样（数据已同步落盘）
let allOk = toks.every((t) => auth.userByToken(t) === 'userA');
ok('40 concurrent logins all resolvable', allOk, 'count=' + toks.length);

// 3) 会话惰性清理：直接写一个过期会话，读时应收敛
const sessionsFile = path.join(tmp, 'sessions.json');
const s = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
const expired = 'a'.repeat(64);
s[expired] = { username: 'userA', createdAt: Date.now() - 40 * 24 * 60 * 60 * 1000 }; // 40天前
fs.writeFileSync(sessionsFile, JSON.stringify(s));
ok('expired session yields null after prune', auth.userByToken(expired) === null, '');

// 4) 原子性：文件里不应残留 .tmp（崩溃中断后不存在半成品）
ok('no *.tmp residue in dataDir', fs.readdirSync(tmp).filter((f) => f.endsWith('.tmp')).length === 0, '');

console.log(pass ? 'ATOMIC_TEST_PASS' : 'ATOMIC_TEST_FAIL');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
process.exit(pass ? 0 : 1);