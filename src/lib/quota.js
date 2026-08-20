'use strict';
// quota.js — 公共服务护栏：每用户配额（文档数/总字节）+ 上传/导出接口限流 + 全局存储上限。
// 每用户用量持久化在 SQLite（src/lib/db.js 的 user_usage 表），重启不丢、删除精确释放。
// 全局存储上限仍按磁盘扫描（docs/d + data/private 体积）作为近似。
const fs = require('fs');
const path = require('path');
const dbm = require('./db');

/** 简单滑动窗口限流器（进程内存态；单实例够用） */
class SlidingWindow {
  constructor({ windowMs, max }) { this.windowMs = windowMs; this.max = max; this.hits = new Map(); }
  allow(key) {
    const now = Date.now();
    const arr = this.hits.get(key);
    if (!arr) { this.hits.set(key, [now]); return true; }
    while (arr.length && now - arr[0] > this.windowMs) arr.shift();
    if (!arr.length) { arr.push(now); return true; }
    if (arr.length >= this.max) return false;
    arr.push(now);
    return true;
  }
}

class QuotaError extends Error {
  constructor(msg, status) { super(msg); this.status = status || 429; }
}

let dataDir = '';
let maxGlobalBytes = 0;
let perUserMaxDocs = 0;
let perUserMaxBytes = 0;

/** 初始化：dataDir + 配额环境变量。0 = 不限。 */
function initQuota(dir, env = {}) {
  dataDir = path.resolve(dir);
  maxGlobalBytes = Number(env.MAX_GLOBAL_BYTES) || 0;
  perUserMaxDocs = Number(env.MAX_USER_DOCS) || 0;
  perUserMaxBytes = Number(env.MAX_USER_BYTES) || 0;
  // 确保 SQLite 已打开（user_usage 表可用）
  dbm.open(dataDir);
}

function fsSizeRec(dir) {
  let sum = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      if (e.isDirectory()) sum += fsSizeRec(full);
      else sum += fs.statSync(full).size;
    } catch {}
  }
  return sum;
}

/** 站点公开正文区 + 私有区体积（作为全局占用近似） */
function globalUsage() {
  return fsSizeRec(path.join(dataDir, '..', 'docs', 'd')) + fsSizeRec(path.join(dataDir, 'private'));
}

/** 每用户用量（文档数/字节）。持久化于 SQLite user_usage。 */
function usageOf(username) {
  if (!username) return { docs: 0, bytes: 0 };
  const r = dbm.db.prepare('SELECT docs, bytes FROM user_usage WHERE username = ?').get(username);
  return r ? { docs: Number(r.docs), bytes: Number(r.bytes) } : { docs: 0, bytes: 0 };
}

function setUsage(username, docs, bytes) {
  if (!username) return;
  dbm.db.prepare(
    'INSERT INTO user_usage (username, docs, bytes) VALUES (?,?,?) ' +
    'ON CONFLICT(username) DO UPDATE SET docs=excluded.docs, bytes=excluded.bytes'
  ).run(username, docs, bytes);
}

/** 校验并登记一次上传（校验失败抛 QuotaError，不入账）。事务内更新用量。 */
function checkUploadQuota(username, byteSize) {
  if (!username) return;
  const use = usageOf(username);
  if (perUserMaxDocs && (use.docs + 1) > perUserMaxDocs) {
    throw new QuotaError('每个用户最多上传 ' + perUserMaxDocs + ' 个文档', 429);
  }
  if (perUserMaxBytes && (use.bytes + byteSize) > perUserMaxBytes) {
    throw new QuotaError('该用户上传总量超限', 413);
  }
  if (maxGlobalBytes) {
    const g = globalUsage() + byteSize;
    if (g > maxGlobalBytes) throw new QuotaError('站点存储已满，请稍后再试', 507);
  }
  setUsage(username, use.docs + 1, use.bytes + byteSize);
  return usageOf(username);
}

/** 用户删除文档时释放占用（精确扣减）。 */
function releaseQuota(username, byteSize, { docs = 1 } = {}) {
  if (!username) return;
  const use = usageOf(username);
  setUsage(username,
    Math.max(0, use.docs - docs),
    Math.max(0, use.bytes - (byteSize || 0)));
}

/**
 * 用量校准：以 meta 表（现存文档）为权威，重算每个 owner 的文档数与磁盘占用，
 * 覆盖 user_usage 中的漂移值（历史迁移丢 bytes、删除未扣减、手动改动等都会导致失实）。
 * bytes 口径 = 解包后磁盘实际占用（docs/d/<id> 或 data/private/<id>）。
 * 返回本次校准的逐用户结果，供启动日志打印。
 */
function reconcileUsage(siteRoot, dataDir) {
  const rows = dbm.db.prepare('SELECT doc_id, owner FROM meta').all();
  const perUser = new Map(); // username -> { docs, bytes }
  for (const r of rows) {
    if (!r.owner) continue;
    const u = perUser.get(r.owner) || { docs: 0, bytes: 0 };
    u.docs += 1;
    const pub = path.join(siteRoot, 'd', r.doc_id);
    const priv = path.join(dataDir, 'private', r.doc_id);
    let size = 0;
    if (fs.existsSync(pub)) size = fsSizeRec(pub);
    else if (fs.existsSync(priv)) size = fsSizeRec(priv);
    u.bytes += size;
    perUser.set(r.owner, u);
  }
  const stmt = dbm.db.prepare(
    'INSERT INTO user_usage (username, docs, bytes) VALUES (?,?,?) ' +
    'ON CONFLICT(username) DO UPDATE SET docs=excluded.docs, bytes=excluded.bytes'
  );
  dbm.db.transaction(() => {
    for (const [name, v] of perUser) stmt.run(name, v.docs, v.bytes);
  })();
  return [...perUser.entries()].map(([username, v]) => ({ username, ...v }));
}

module.exports = { QuotaError, SlidingWindow, initQuota, checkUploadQuota, releaseQuota, globalUsage, usageOf, reconcileUsage };