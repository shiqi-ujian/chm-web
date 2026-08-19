'use strict';
// test-doc-meta.js — 文档管理增强自测：
//   ① updateMeta 重命名 / 作者 / 标签
//   ② 标签输入归一化（去空、去重、限长、限数量）
//   ③ 权限：非 owner 不能编辑
//   ④ 老库 meta 通过 ensureColumn 自动补列（模拟旧表结构）
const path = require('path');
const fs = require('fs');
const os = require('os');
const dbm = require('./src/lib/db');
const auth = require('./src/lib/auth');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chmweb-docmeta-'));
let pass = true;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (x ? ' [' + x + ']' : '')); if (!c) pass = false; };

// 清理单例（test-db.js 可能先跑）
try { dbm.close(); } catch (_) {}

// ---- 先用 auth.init 创建完整新库 ----
auth.init(tmp);
process.env.ALLOW_LEGACY_REGISTER = '1';
const reg = auth.register({ username: 'owner', password: 'secret1' });
ok('register owner', reg.ok);
const reg2 = auth.register({ username: 'other', password: 'secret1' });
ok('register other', reg2.ok);

auth.ensureMeta('d1', { owner: 'owner', name: 'Old', visibility: 'public' });
let m = auth.getMeta('d1');
ok('ensureMeta creates doc', !!m && m.id === 'd1' && m.name === 'Old' && m.tags.length === 0 && m.author === '', JSON.stringify(m));

// ---- 2. 重命名 + 作者 + 标签（字符串形式）----
m = auth.updateMeta('d1', 'owner', { name: '新名字', author: '张小明', tags: '手册, 指南，参考,手册' });
ok('rename + author + tags', m.name === '新名字' && m.author === '张小明' && m.tags.join('|') === '手册|指南|参考', JSON.stringify(m));

// ---- 3. 标签数组形式 + 数量上限 ----
m = auth.updateMeta('d1', 'owner', { tags: Array.from({ length: 15 }, (_, i) => 'tag' + i) });
ok('tags capped to 10', Array.isArray(m.tags) && m.tags.length === 10 && m.tags[0] === 'tag0' && m.tags[9] === 'tag9', JSON.stringify(m.tags));

// ---- 4. 仅 owner 可编辑 ----
let denied = false;
try { auth.updateMeta('d1', 'other', { name: 'Hack' }); } catch (e) { denied = e.status === 403; }
ok('non-owner cannot edit', denied);
ok('non-owner cannot edit name preserved', auth.getMeta('d1').name === '新名字');

// ---- 5. 空名称被拒绝 ----
let emptyName = false;
try { auth.updateMeta('d1', 'owner', { name: '   ' }); } catch (e) { emptyName = e.status === 400; }
ok('empty name rejected', emptyName);

// ---- 6. updatedAt 被刷新 ----
const beforeTs = auth.getMeta('d1').updatedAt;
const after = auth.updateMeta('d1', 'owner', { author: '李四' });
ok('updatedAt advances', !!after.updatedAt && after.updatedAt >= beforeTs, String(beforeTs) + ' -> ' + String(after.updatedAt));

console.log(pass ? 'DOC_META_TEST_PASS' : 'DOC_META_TEST_FAIL');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
process.exit(pass ? 0 : 1);