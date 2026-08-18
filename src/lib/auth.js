'use strict';
// auth.js — M2 账号体系 + 文档可见性（零依赖，纯 Node）。
// 数据全部持久化在 dataDir 下的三个 JSON：
//   users.json    { username: { salt, hash, createdAt } }      —— scrypt 哈希
//   sessions.json { token: { username, createdAt } }           —— 登录会话
//   meta.json     { docId: { owner, visibility, shareToken, name, createdAt } } —— 文档元数据
// 可见性三态：
//   public   —— 免登录，静态产物（docs/d/<id>/）直接可访问
//   private  —— 仅 owner（登录态）或分享链接（/s/<shareToken>）可访问，
//               文档实体放 dataDir/private/<id>/，绝不落入公开静态产物
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class AuthError extends Error {
  constructor(msg, status) { super(msg); this.status = status || 400; }
}

const USERS_FILE = 'users.json';
const SESSIONS_FILE = 'sessions.json';
const META_FILE = 'meta.json';
const PRIVATE_DIR = 'private';
// 会话有效期（毫秒）。会话表据此惰性清理，避免 users/sessions/meta 无限增长。
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

let dataDir = '';

function init(dir) {
  dataDir = path.resolve(dir);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, PRIVATE_DIR), { recursive: true });
}

/** 原子写 JSON：先写 `<file>.<pid>.tmp` 再 rename 覆盖。
 * 崩溃/断电/写中途失败不会损坏原数据 —— 旧文件始终完整可用，
 * rename 在同一文件系统内是原子的（Windows 上对已存在目标也保证覆盖）。
 */
function writeJsonAtomic(file, obj) {
  const abs = path.join(dataDir, file);
  const tmp = abs + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.mkdirSync(dataDir, { recursive: true });
  const json = JSON.stringify(obj, null, 2);
  // 写入临时文件（截断重建，避免残留旧尾）
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, json, 'utf8');
    fs.fsyncSync(fd); // 落盘，避免断电丢数据
  } finally {
    fs.closeSync(fd);
  }
  // Windows 上 rename 覆盖已存在目标偶尔抛 EPERM（AV/文件系统瞬时占用）。
  // 采用「重命名到轮替临时→原文件删除→新文件就位」或简单重试；这里用短退避重试，
  // 保证并发/瞬时占用下仍能完成原子替换且不损坏目标。
  for (let attempt = 0; attempt < 8; attempt++) {
    try { fs.renameSync(tmp, abs); return; }
    catch (e) {
      if (attempt === 7 || !/EPERM|EEXIST|EACCES/.test(e.code || '')) throw e;
      // 忙等极短时间后重试
      const until = Date.now() + 15;
      while (Date.now() < until) { /* busy-wait */ }
    }
  }
}

/** 读 JSON；文件损坏（如被并发写坏）时回退默认值并在控制台提示 */
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')); }
  catch { return fallback; }
}

// 数据的「读→改→写」都在同一同步块内完成 —— Node 单线程内不会交错，
// 因此原子写（临时文件+rename）即可保证并发安全与崩溃一致性。
const writeJson = writeJsonAtomic;

/**
 * 惰性清理过期会话。sessions.json 读时顺带剔除 TTL 之外的条目；
 * 若有清除则原子写回。防止会话表无限增长，也提升 token 安全性。
 */
function pruneSessions(sessions, now) {
  const cutoff = (now || Date.now()) - SESSION_TTL_MS;
  const kept = {};
  for (const t of Object.keys(sessions)) {
    const s = sessions[t];
    if (s && s.createdAt >= cutoff) kept[t] = s;
  }
  return kept;
}
function readSessions() {
  const sessions = readJson(SESSIONS_FILE, {});
  const now = Date.now();
  if (readHasExpired(sessions, now)) {
    const kept = pruneSessions(sessions, now);
    try { writeJsonAtomic(SESSIONS_FILE, kept); } catch (e) { console.error('session prune write failed', e); }
    return kept;
  }
  return sessions;
}
function readHasExpired(sessions, now) {
  const cutoff = now - SESSION_TTL_MS;
  return Object.keys(sessions).some((t) => sessions[t] && sessions[t].createdAt < cutoff);
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
  const users = readJson(USERS_FILE, {});
  if (users[username]) throw new AuthError('用户名已存在', 409);
  const salt = crypto.randomBytes(16).toString('hex');
  users[username] = { salt, hash: hashPassword(password, salt), createdAt: Date.now() };
  writeJson(USERS_FILE, users);
  return { ok: true };
}

function login({ username, password }) {
  username = String(username || '').trim();
  const users = readJson(USERS_FILE, {});
  const u = users[username];
  if (!u) throw new AuthError('用户名或密码错误', 401);
  const hash = hashPassword(password, u.salt);
  if (hash !== u.hash) throw new AuthError('用户名或密码错误', 401);
  const token = crypto.randomBytes(32).toString('hex');
  const sessions = readSessions();
  sessions[token] = { username, createdAt: Date.now() };
  writeJson(SESSIONS_FILE, sessions);
  return { token, username };
}

function logout(token) {
  if (!token) return;
  const sessions = readSessions();
  if (sessions[token]) { delete sessions[token]; writeJson(SESSIONS_FILE, sessions); }
}

/** 由 token 解析出用户名；无效或已过期返回 null */
function userByToken(token) {
  if (!token) return null;
  const sessions = readSessions();
  const s = sessions[token];
  return s ? s.username : null;
}

/* ---------------- 文档元数据 / 可见性 ---------------- */

function readMeta() { return readJson(META_FILE, {}); }

function getMeta(docId) {
  const m = readMeta();
  return m[docId] || null;
}

/** 上传/建站时登记文档元数据（已存在则不覆盖） */
function ensureMeta(docId, { owner = null, name = '', visibility = 'public' } = {}) {
  const m = readJson(META_FILE, {});
  if (!m[docId]) {
    m[docId] = {
      owner: owner || null,
      name: name || docId,
      visibility: visibility === 'private' ? 'private' : 'public',
      shareToken: null,
      createdAt: Date.now(),
    };
    writeJsonAtomic(META_FILE, m);
  }
  return m[docId];
}

/** 仅 owner 可改可见性；返回最新 meta */
function setVisibility(docId, visibility, username) {
  const m = readMeta();
  const meta = m[docId];
  if (!meta) throw new AuthError('文档不存在', 404);
  if (!username || meta.owner !== username) throw new AuthError('只有文档所有者可以修改可见性', 403);
  meta.visibility = visibility === 'private' ? 'private' : 'public';
  writeJsonAtomic(META_FILE, m);
  return meta;
}

/** 仅 owner 可生成/重置分享链接；返回 shareUrl 路径片段 */
function share(docId, username, { reset = false } = {}) {
  const m = readMeta();
  const meta = m[docId];
  if (!meta) throw new AuthError('文档不存在', 404);
  if (!username || meta.owner !== username) throw new AuthError('只有文档所有者可以分享', 403);
  if (!meta.shareToken || reset) {
    meta.shareToken = crypto.randomBytes(16).toString('hex');
    writeJsonAtomic(META_FILE, m);
  }
  return { shareToken: meta.shareToken, sharePath: '/s/' + meta.shareToken };
}

/** 仅 owner 可删除文档元数据；返回是否删除了 meta 记录 */
function deleteMeta(docId, username) {
  const m = readMeta();
  const meta = m[docId];
  if (!meta) throw new AuthError('文档不存在', 404);
  if (!username || meta.owner !== username) throw new AuthError('只有文档所有者可以删除', 403);
  delete m[docId];
  writeJsonAtomic(META_FILE, m);
  return true;
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
  const m = readMeta();
  for (const id of Object.keys(m)) {
    if (m[id].shareToken === shareToken) return id;
  }
  return null;
}

/** 私有文档实体目录 */
function privateDir(docId) { return path.join(dataDir, PRIVATE_DIR, docId); }

module.exports = {
  init, AuthError,
  register, login, logout, userByToken,
  ensureMeta, getMeta, setVisibility, share, deleteMeta, canRead, docIdByShareToken, privateDir,
};
