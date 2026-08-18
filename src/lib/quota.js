'use strict';
// quota.js — 公共服务护栏：每用户配额（文档数/总字节）+ 上传/导出接口限流 + 全局存储上限。
// 纯 Node 零依赖；单实例进程内存态足够（重启返回宽松上限方向，可接受）。
const fs = require('fs');
const path = require('path');

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
  fs.mkdirSync(dataDir, { recursive: true });
  maxGlobalBytes = Number(env.MAX_GLOBAL_BYTES) || 0;
  perUserMaxDocs = Number(env.MAX_USER_DOCS) || 0;
  perUserMaxBytes = Number(env.MAX_USER_BYTES) || 0;
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

const userUsage = new Map(); // username -> { docs, bytes }
function usageOf(username) { return userUsage.get(username) || { docs: 0, bytes: 0 }; }

/** 校验并登记一次上传（校验失败抛 QuotaError，不入账） */
function checkUploadQuota(username, byteSize) {
  if (!username) return;
  const u = usageOf(username);
  if (perUserMaxDocs && (u.docs + 1) > perUserMaxDocs) {
    throw new QuotaError('每个用户最多上传 ' + perUserMaxDocs + ' 个文档', 429);
  }
  if (perUserMaxBytes && (u.bytes + byteSize) > perUserMaxBytes) {
    throw new QuotaError('该用户上传总量超限', 413);
  }
  if (maxGlobalBytes) {
    const g = globalUsage() + byteSize;
    if (g > maxGlobalBytes) throw new QuotaError('站点存储已满，请稍后再试', 507);
  }
  u.docs += 1; u.bytes += byteSize;
  userUsage.set(username, u);
  return u;
}

/** 用户删除文档时释放占用 */
function releaseQuota(username, byteSize) {
  if (!username) return;
  const u = usageOf(username);
  u.docs = Math.max(0, u.docs - 1);
  u.bytes = Math.max(0, u.bytes - (byteSize || 0));
  if (!u.docs && !u.bytes) userUsage.delete(username);
}

module.exports = { QuotaError, SlidingWindow, initQuota, checkUploadQuota, releaseQuota, globalUsage };