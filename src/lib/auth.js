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

let dataDir = '';

function init(dir) {
  dataDir = path.resolve(dir);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, PRIVATE_DIR), { recursive: true });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')); }
  catch { return fallback; }
}
function writeJson(file, obj) {
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(obj, null, 2));
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
  const sessions = readJson(SESSIONS_FILE, {});
  sessions[token] = { username, createdAt: Date.now() };
  writeJson(SESSIONS_FILE, sessions);
  return { token, username };
}

function logout(token) {
  if (!token) return;
  const sessions = readJson(SESSIONS_FILE, {});
  if (sessions[token]) { delete sessions[token]; writeJson(SESSIONS_FILE, sessions); }
}

/** 由 token 解析出用户名；无效返回 null */
function userByToken(token) {
  if (!token) return null;
  const sessions = readJson(SESSIONS_FILE, {});
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
  const m = readMeta();
  if (!m[docId]) {
    m[docId] = {
      owner: owner || null,
      name: name || docId,
      visibility: visibility === 'private' ? 'private' : 'public',
      shareToken: null,
      createdAt: Date.now(),
    };
    writeJson(META_FILE, m);
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
  writeJson(META_FILE, m);
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
    writeJson(META_FILE, m);
  }
  return { shareToken: meta.shareToken, sharePath: '/s/' + meta.shareToken };
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
  ensureMeta, getMeta, setVisibility, share, canRead, docIdByShareToken, privateDir,
};
