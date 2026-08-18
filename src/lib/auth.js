'use strict';
// auth.js — M2 账号体系 + 文档可见性。
// 存储层已迁移到 SQLite（src/lib/db.js，better-sqlite3 + WAL）：users/sessions/meta。
// 对外导出签名与旧 JSON 版完全一致，server.js / upload.js 无需改动。
// 可见性三态：
//   public   —— 免登录，静态产物（docs/d/<id>/）直接可访问
//   private  —— 仅 owner（登录态）或分享链接（/s/<shareToken>）可访问，
//               文档实体放 dataDir/private/<id>/，绝不落入公开静态产物
const path = require('path');
const crypto = require('crypto');
const dbm = require('./db');

class AuthError extends Error {
  constructor(msg, status) { super(msg); this.status = status || 400; }
}

// 会话有效期（毫秒）。读会话时惰性清理过期条目，避免 sessions 无限增长。
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

function init(dir) {
  dbm.open(dir);
}

/* ---------------- 用户：注册 / 登录 / 会话 ---------------- */

const NAME_RE = /^[\w\u4e00-\u9fa5]{2,32}$/;

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function register({ username, password }) {
  username = String(username || '').trim();
  if (!NAME_RE.test(username)) throw new AuthError('用户名需为 2-32 位字母/数字/下划线/中文', 400);
  if (!password || String(password).length < 6) throw new AuthError('密码至少 6 位', 400);
  const exists = dbm.db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (exists) throw new AuthError('用户名已存在', 409);
  const salt = crypto.randomBytes(16).toString('hex');
  dbm.db.prepare('INSERT INTO users (username, salt, hash, created_at) VALUES (?,?,?,?)')
    .run(username, salt, hashPassword(password, salt), Date.now());
  return { ok: true };
}

function login({ username, password }) {
  username = String(username || '').trim();
  const u = dbm.db.prepare('SELECT salt, hash FROM users WHERE username = ?').get(username);
  if (!u) throw new AuthError('用户名或密码错误', 401);
  const hash = hashPassword(password, u.salt);
  if (hash !== u.hash) throw new AuthError('用户名或密码错误', 401);
  const token = crypto.randomBytes(32).toString('hex');
  dbm.db.prepare('INSERT INTO sessions (token, username, created_at) VALUES (?,?,?)')
    .run(token, username, Date.now());
  // 顺手清理过期会话
  try { dbm.pruneSessions(Date.now(), SESSION_TTL_MS); } catch (_) {}
  return { token, username };
}

function logout(token) {
  if (!token) return;
  dbm.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** 由 token 解析出用户名；无效或已过期返回 null */
function userByToken(token) {
  if (!token) return null;
  const s = dbm.db.prepare('SELECT username FROM sessions WHERE token = ? AND created_at >= ?')
    .get(token, Date.now() - SESSION_TTL_MS);
  return s ? s.username : null;
}

/* ---------------- 文档元数据 / 可见性 ---------------- */

function rowToMeta(r) {
  if (!r) return null;
  return {
    id: r.doc_id,
    owner: r.owner,
    name: r.name,
    visibility: r.visibility,
    shareToken: r.share_token,
    createdAt: r.created_at,
  };
}

function getMeta(docId) {
  const r = dbm.db.prepare('SELECT * FROM meta WHERE doc_id = ?').get(docId);
  return rowToMeta(r);
}

/** 上传/建站时登记文档元数据（已存在则不覆盖） */
function ensureMeta(docId, { owner = null, name = '', visibility = 'public' } = {}) {
  const existing = getMeta(docId);
  if (existing) return existing;
  const vis = visibility === 'private' ? 'private' : 'public';
  dbm.db.prepare('INSERT INTO meta (doc_id, owner, name, visibility, share_token, created_at) VALUES (?,?,?,?,?,?)')
    .run(docId, owner || null, name || docId, vis, null, Date.now());
  return getMeta(docId);
}

/** 仅 owner 可改可见性；返回最新 meta */
function setVisibility(docId, visibility, username) {
  const meta = getMeta(docId);
  if (!meta) throw new AuthError('文档不存在', 404);
  if (!username || meta.owner !== username) throw new AuthError('只有文档所有者可以修改可见性', 403);
  const vis = visibility === 'private' ? 'private' : 'public';
  dbm.db.prepare('UPDATE meta SET visibility = ? WHERE doc_id = ?').run(vis, docId);
  return getMeta(docId);
}

/** 仅 owner 可生成/重置分享链接；返回 shareUrl 路径片段 */
function share(docId, username, { reset = false } = {}) {
  const meta = getMeta(docId);
  if (!meta) throw new AuthError('文档不存在', 404);
  if (!username || meta.owner !== username) throw new AuthError('只有文档所有者可以分享', 403);
  if (!meta.shareToken || reset) {
    const tok = crypto.randomBytes(16).toString('hex');
    dbm.db.prepare('UPDATE meta SET share_token = ? WHERE doc_id = ?').run(tok, docId);
    meta.shareToken = tok;
  }
  return { shareToken: meta.shareToken, sharePath: '/s/' + meta.shareToken };
}

/** 仅 owner 可删除文档元数据；返回是否删除了 meta 记录 */
function deleteMeta(docId, username) {
  const meta = getMeta(docId);
  if (!meta) throw new AuthError('文档不存在', 404);
  if (!username || meta.owner !== username) throw new AuthError('只有文档所有者可以删除', 403);
  const r = dbm.db.prepare('DELETE FROM meta WHERE doc_id = ?').run(docId);
  return r.changes > 0;
}

/** 某人/某分享 token 是否可读该文档 */
function canRead(docId, { username = null, shareToken = null } = {}) {
  const meta = getMeta(docId);
  if (!meta) return false;
  if (meta.visibility !== 'private') return true; // public / 无 meta 视为公开
  if (username && meta.owner && username === meta.owner) return true;
  if (shareToken && meta.shareToken && shareToken === meta.shareToken) return true;
  return false;
}

/** 由分享 token 反查文档 id（无则 null） */
function docIdByShareToken(shareToken) {
  if (!shareToken) return null;
  const r = dbm.db.prepare('SELECT doc_id FROM meta WHERE share_token = ?').get(shareToken);
  return r ? r.doc_id : null;
}

/** 私有文档实体目录 */
function privateDir(docId) { return path.join(dbm.dataDir, dbm.PRIVATE_DIR, docId); }

/* ---------------- 兼容辅助：批量读取（供 rebuild/listDocs 等需要全量 meta 的调用） ---------------- */

/** 返回全部 meta 记录的对象映射（docId -> meta），兼容旧 readJson(META_FILE) 用法 */
function readAllMeta() {
  const out = {};
  for (const r of dbm.db.prepare('SELECT * FROM meta').all()) {
    const m = rowToMeta(r);
    out[m.id] = m;
  }
  return out;
}

module.exports = {
  init, AuthError,
  register, login, logout, userByToken,
  ensureMeta, getMeta, setVisibility, share, deleteMeta, canRead, docIdByShareToken, privateDir,
  readAllMeta,
};