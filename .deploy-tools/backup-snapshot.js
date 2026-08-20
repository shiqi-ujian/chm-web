'use strict';
// backup-snapshot.js — 使用 better-sqlite3 在线备份 API 生成 SQLite 一致快照。
// 用法: node backup-snapshot.js <source.db> <target.db>
// 不会写源库；对 WAL 模式安全。退出码 0=成功，1=失败。
const fs = require('fs');
const path = require('path');

const [, , source, target] = process.argv;
if (!source || !target) {
  console.error('usage: node backup-snapshot.js <source.db> <target.db>');
  process.exit(2);
}
if (!fs.existsSync(source)) {
  console.error('source db not found: ' + source);
  process.exit(2);
}

const Database = require('better-sqlite3');
try {
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  const db = new Database(path.resolve(source), { readonly: true, fileMustExist: true });
  const out = path.resolve(target);
  // better-sqlite3 的 backup() 返回 Promise，必须等待完成（不等待会直接 close 导致快照为空）
  Promise.resolve(db.backup(out)).then(() => {
    db.close();
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error('snapshot empty');
    console.log(out);
    process.exit(0);
  }).catch((e) => {
    console.error('snapshot failed: ' + (e && e.stack || e));
    process.exit(1);
  });
} catch (e) {
  console.error('snapshot failed: ' + (e && e.stack || e));
  process.exit(1);
}