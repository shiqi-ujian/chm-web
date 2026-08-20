'use strict';
// auth.js — M2+ 账号体系 + 文档可见性。
// M6 升级：
//   - 邮箱绑定与验证（email / email_verified / verification_code / expiry）
//   - 忘记密码 / 重置密码（password_reset_token / expiry）
//   - 登录失败计数 + 临时锁定（failed_attempts / locked_until）
//   - 注册需同意用户协议（terms_accepted_at）
//   - 会话仍为 30 天不透明 token（后端 HttpOnly cookie 建议 + 兼容 X-User-Token）
// 存储：SQLite（src/lib/db.js）。
const path = require('path');
const crypto = require('crypto');
const dbm = require('./db');
const mailer = require('./mailer');

class AuthError extends Error {
  constructor(msg, status) { super(msg); this.status = status || 400; }
}

// 会话有效期（毫秒）。读会话时惰性清理过期条目，避免 sessions 无限增长。
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
// 邮箱验证 / 重置令牌有效期
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
// 登录失败锁定：连续失败次数 / 锁定时长
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MS = 10 * 60 * 1000;

const NAME_RE = /^[\w\u4e00-\u9fa5]{2,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function init(dir) {
  dbm.open(dir);
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}
function randomCode(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}
function hashToken(token) {
  // 令牌只以哈希入库，降低泄露风险
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/* ---------------- 用户：注册 / 登录 / 会话 ---------------- */

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function getRow(username) {
  return dbm.db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
}

function publicUser(row) {
  if (!row) return null;
  return {
    username: row.username,
    email: row.email || '',
    emailVerified: !!row.email_verified,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
    termsAccepted: !!row.terms_accepted_at,
  };
}

function register(body) {
  const b = body || {};
  const accepted = b.acceptTerms === true || b.acceptTerms === 1 || process.env.ALLOW_LEGACY_REGISTER === '1';
  if (!accepted) throw new AuthError('请阅读并同意用户协议与隐私政策', 403);
  const username = String(b.username || '').trim();
  const password = b.password;
  let email = String(b.email || '').trim().toLowerCase();
  if (!email && process.env.ALLOW_LEGACY_REGISTER === '1') email = username.toLowerCase() + '@local.invalid';
  if (!EMAIL_RE.test(email)) throw new AuthError('请输入有效邮箱', 400);
  if (!NAME_RE.test(username)) throw new AuthError('用户名需为 2-32 位字母/数字/下划线/中文', 400);
  if (!password || String(password).length < 6) throw new AuthError('密码至少 6 位', 400);
  if (String(password).length > 128) throw new AuthError('密码过长', 400);
  const exists = dbm.db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (exists) throw new AuthError('用户名已存在', 409);
  const emailExists = dbm.db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (emailExists) throw new AuthError('该邮箱已被注册', 409);
  const salt = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const verifCode = randomCode();
  dbm.db.prepare('INSERT INTO users (username, salt, hash, created_at, email, email_verified, verification_code, verification_expires, failed_attempts, locked_until, last_login_at, created_ip, terms_accepted_at, updated_at) VALUES (?,?,?,?,?,?,?,?,0,0,NULL,?,?,?)')
    .run(username, salt, hashPassword(password, salt), now, email, 0, hashToken(verifCode), now + VERIFY_TTL_MS, b.ip || null, now, now);
  sendVerificationEmail(email, verifCode);
  return { ok: true, username, emailVerified: false };
}

function login({ username, password }) {
  username = String(username || '').trim();
  const u = dbm.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u) throw new AuthError('用户名或密码错误', 401);
  const now = Date.now();
  if (u.locked_until && u.locked_until > now) {
    const mins = Math.ceil((u.locked_until - now) / 60000);
    throw new AuthError('登录失败次数过多，请在 ' + mins + ' 分钟后再试', 423);
  }
  const hash = hashPassword(password, u.salt);
  if (hash !== u.hash) {
    const attempts = (u.failed_attempts || 0) + 1;
    const locked = attempts >= MAX_FAILED_ATTEMPTS ? now + LOCK_MS : 0;
    dbm.db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE username = ?')
      .run(attempts, locked, now, username);
    if (locked) throw new AuthError('登录失败次数过多，请 10 分钟后再试', 423);
    throw new AuthError('用户名或密码错误', 401);
  }
  dbm.db.prepare('UPDATE users SET failed_attempts = 0, locked_until = 0, last_login_at = ?, updated_at = ? WHERE username = ?')
    .run(now, now, username);
  const token = randomToken();
  dbm.db.prepare('INSERT INTO sessions (token, username, created_at) VALUES (?,?,?)')
    .run(token, username, Date.now());
  try { dbm.pruneSessions(Date.now(), SESSION_TTL_MS); } catch (_) {}
  return { token, username };
}

function logout(token) {
  if (!token) return;
  dbm.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/**
 * 修改密码：校验旧密码 → 换盐重哈希 → 注销该用户的其他会话（保留当前会话）。
 */
function changePassword(username, oldPassword, newPassword, currentToken) {
  if (!username) throw new AuthError('请先登录', 401);
  const u = getRow(username);
  if (!u) throw new AuthError('用户不存在', 404);
  const old = String(oldPassword == null ? '' : oldPassword);
  if (hashPassword(old, u.salt) !== u.hash) throw new AuthError('当前密码不正确', 403);
  const next = String(newPassword == null ? '' : newPassword);
  if (next.length < 6) throw new AuthError('新密码至少 6 位', 400);
  if (next.length > 128) throw new AuthError('密码过长', 400);
  const salt = crypto.randomBytes(16).toString('hex');
  dbm.db.prepare('UPDATE users SET salt = ?, hash = ?, updated_at = ? WHERE username = ?')
    .run(salt, hashPassword(next, salt), Date.now(), username);
  if (currentToken) dbm.db.prepare('DELETE FROM sessions WHERE username = ? AND token != ?').run(username, currentToken);
  else dbm.db.prepare('DELETE FROM sessions WHERE username = ?').run(username);
  return { ok: true };
}

/** 由 token 解析出用户名；无效或已过期返回 null */
function userByToken(token) {
  if (!token) return null;
  const s = dbm.db.prepare('SELECT username FROM sessions WHERE token = ? AND created_at >= ?')
    .get(token, Date.now() - SESSION_TTL_MS);
  return s ? s.username : null;
}

/* ---------------- 邮箱验证 / 找回密码 ---------------- */

async function sendVerificationEmail(email, code) {
  const verifyUrl = (process.env.PUBLIC_BASE_URL || '') + '/api/verify-email?token=' + code;
  await mailer.sendMail({
    to: email,
    subject: 'CHM 网页 · 验证你的邮箱',
    text: '请点击链接验证邮箱：\n' + verifyUrl + '\n\n如果这不是你注册的，请忽略本邮件。',
  });
}

async function sendResetEmail(email, code) {
  const resetUrl = (process.env.PUBLIC_BASE_URL || '') + '/reset-password?token=' + code;
  await mailer.sendMail({
    to: email,
    subject: 'CHM 网页 · 重置密码',
    text: '请点击链接重置密码（1 小时内有效）：\n' + resetUrl + '\n\n如果这不是你的操作，请忽略。',
  });
}

function requestEmailVerification(username) {
  const u = getRow(username);
  if (!u) throw new AuthError('用户不存在', 404);
  if (u.email_verified) throw new AuthError('邮箱已验证', 400);
  if (!u.email) throw new AuthError('该账号未绑定邮箱', 400);
  const code = randomCode();
  dbm.db.prepare('UPDATE users SET verification_code = ?, verification_expires = ?, updated_at = ? WHERE username = ?')
    .run(hashToken(code), Date.now() + VERIFY_TTL_MS, Date.now(), username);
  sendVerificationEmail(u.email, code);
  return { ok: true, sentTo: u.email };
}

function verifyEmailCode(code) {
  const h = hashToken(String(code || '').trim());
  const row = dbm.db.prepare('SELECT username, verification_expires FROM users WHERE verification_code = ?').get(h);
  if (!row || !row.verification_expires || row.verification_expires < Date.now()) {
    throw new AuthError('验证链接无效或已过期', 400);
  }
  dbm.db.prepare('UPDATE users SET email_verified = 1, verification_code = NULL, verification_expires = NULL, updated_at = ? WHERE username = ?')
    .run(Date.now(), row.username);
  return { ok: true, username: row.username };
}

async function forgotPassword(usernameOrEmail) {
  const key = String(usernameOrEmail || '').trim().toLowerCase();
  if (!key) throw new AuthError('请输入用户名或邮箱', 400);
  let row = null;
  if (EMAIL_RE.test(key)) row = dbm.db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(key);
  else row = dbm.db.prepare('SELECT * FROM users WHERE username = ?').get(key);
  if (!row) return { ok: true }; // 统一应答，防枚举
  const code = randomCode();
  dbm.db.prepare('UPDATE users SET password_reset_token = ?, password_reset_expires = ?, updated_at = ? WHERE username = ?')
    .run(hashToken(code), Date.now() + RESET_TTL_MS, Date.now(), row.username);
  await sendResetEmail(row.email, code);
  return { ok: true };
}

function resetPassword(code, newPassword) {
  const h = hashToken(String(code || '').trim());
  const row = dbm.db.prepare('SELECT * FROM users WHERE password_reset_token = ?').get(h);
  if (!row || !row.password_reset_expires || row.password_reset_expires < Date.now()) {
    throw new AuthError('重置链接无效或已过期', 400);
  }
  const next = String(newPassword == null ? '' : newPassword);
  if (next.length < 6) throw new AuthError('新密码至少 6 位', 400);
  if (next.length > 128) throw new AuthError('密码过长', 400);
  const salt = crypto.randomBytes(16).toString('hex');
  dbm.db.prepare('UPDATE users SET salt = ?, hash = ?, password_reset_token = NULL, password_reset_expires = NULL, last_login_at = ?, updated_at = ? WHERE username = ?')
    .run(salt, hashPassword(next, salt), Date.now(), Date.now(), row.username);
  dbm.db.prepare('DELETE FROM sessions WHERE username = ?').run(row.username);
  return { ok: true, username: row.username };
}

/** 当前用户详情（含 email/验证状态） */
function getUser(username) {
  return publicUser(getRow(username));
}

/* ---------------- 举报 ---------------- */

function createReport({ docId, url, reason, contact, ip } = {}) {
  if (!reason || !String(reason).trim()) throw new AuthError('请填写举报原因', 400);
  const now = Date.now();
  const r = dbm.db.prepare('INSERT INTO reports (doc_id, url, reason, contact, status, created_ip, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(docId || null, String(url || '').slice(0, 500), String(reason).slice(0, 2000), String(contact || '').slice(0, 300), 'pending', ip || null, now);
  return { ok: true, id: Number(r.lastInsertRowid) };
}

/** 管理端列出举报（按时间倒序） */
function listReports({ status } = {}) {
  const rows = status
    ? dbm.db.prepare('SELECT * FROM reports WHERE status = ? ORDER BY created_at DESC').all(status)
    : dbm.db.prepare('SELECT * FROM reports ORDER BY created_at DESC').all();
  return rows.map((r) => ({
    id: r.id, docId: r.doc_id, url: r.url, reason: r.reason, contact: r.contact,
    status: r.status, createdAt: r.created_at, ip: r.created_ip,
  }));
}

/** 管理端更新举报状态（pending/processing/resolved/rejected） */
function setReportStatus(reportId, status) {
  const valid = ['pending', 'processing', 'resolved', 'rejected'];
  const next = String(status || '').trim();
  if (!valid.includes(next)) throw new AuthError('无效的举报状态', 400);
  const r = dbm.db.prepare(
    'UPDATE reports SET status = ? WHERE id = ?'
  ).run(next, Number(reportId) || 0);
  if (r.changes === 0) throw new AuthError('举报不存在', 404);
  return { ok: true, id: Number(reportId), status: next };
}

/* ---------------- 文档元数据 / 可见性 ---------------- */

function rowToMeta(r) {
  if (!r) return null;
  let tags = [];
  try { const p = JSON.parse(r.tags || '[]'); tags = Array.isArray(p) ? p.map((t) => String(t).trim().replace(/,/g, '').slice(0, 20)).filter(Boolean) : []; } catch (_) {}
  return {
    id: r.doc_id,
    owner: r.owner,
    name: r.name,
    visibility: r.visibility,
    shareToken: r.share_token,
    shareExpiresAt: r.share_expires_at || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at || r.created_at || null,
    tags: tags.slice(0, 10),
    author: r.author || '',
  };
}

function getMeta(docId) {
  const r = dbm.db.prepare('SELECT * FROM meta WHERE doc_id = ?').get(docId);
  return rowToMeta(r);
}

/** 上传/建站时登记文档元数据（已存在则不覆盖） */
function ensureMeta(docId, { owner = null, name = '', visibility = 'public', author = '' } = {}) {
  const existing = getMeta(docId);
  if (existing) return existing;
  const vis = visibility === 'private' ? 'private' : 'public';
  const now = Date.now();
  dbm.db.prepare('INSERT INTO meta (doc_id, owner, name, visibility, share_token, created_at, updated_at, tags, author) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(docId, owner || null, name || docId, vis, null, now, now, '[]', (author || '').trim().slice(0, 100) || null);
  return getMeta(docId);
}

/** 仅 owner 可改可见性；返回最新 meta */
function setVisibility(docId, visibility, username) {
  const meta = getMeta(docId);
  if (!meta) throw new AuthError('文档不存在', 404);
  if (!username || meta.owner !== username) throw new AuthError('只有文档所有者可以修改可见性', 403);
  const vis = visibility === 'private' ? 'private' : 'public';
  dbm.db.prepare('UPDATE meta SET visibility = ?, updated_at = ? WHERE doc_id = ?').run(vis, Date.now(), docId);
  return getMeta(docId);
}

/** 仅 owner 可更新文档信息（重命名 / 标签 / 作者）；返回最新 meta */
function updateMeta(docId, username, patch = {}) {
  const meta = getMeta(docId);
  if (!meta) throw new AuthError('文档不存在', 404);
  if (!username || meta.owner !== username) throw new AuthError('只有文档所有者可以编辑', 403);

  const sets = ['updated_at = ?'];
  const args = [Date.now()];

  if (patch.name !== undefined) {
    const name = String(patch.name || '').trim().slice(0, 120);
    if (!name) throw new AuthError('文档名称不能为空', 400);
    sets.push('name = ?'); args.push(name);
  }
  if (patch.author !== undefined) {
    const author = String(patch.author || '').trim().slice(0, 100);
    sets.push('author = ?'); args.push(author || null);
  }
  if (patch.tags !== undefined) {
    let tags = [];
    if (Array.isArray(patch.tags)) {
      tags = patch.tags.map((t) => String(t == null ? '' : t).trim().replace(/,/g, '').slice(0, 20)).filter(Boolean);
    } else if (patch.tags && typeof patch.tags === 'string') {
      tags = String(patch.tags).split(/[,，;\s]+/).map((t) => t.trim().replace(/,/g, '').slice(0, 20)).filter(Boolean);
    }
    // 去重（保持顺序）
    tags = tags.filter((t, i, arr) => arr.indexOf(t) === i);
    tags = tags.slice(0, 10);
    sets.push('tags = ?'); args.push(JSON.stringify(tags));
  }

  if (sets.length <= 1) throw new AuthError('没有需要更新的内容', 400);
  args.push(docId);
  dbm.db.prepare('UPDATE meta SET ' + sets.join(', ') + ' WHERE doc_id = ?').run(...args);
  return getMeta(docId);
}

function share(docId, username, { reset = false, expiresAt = null } = {}) {
  const meta = getMeta(docId);
  if (!meta) throw new AuthError('文档不存在', 404);
  if (!username || meta.owner !== username) throw new AuthError('只有文档所有者可以分享', 403);
  if (meta.visibility !== 'private') throw new AuthError('公开文档无需分享链接', 400);
  let exp = null;
  if (expiresAt !== null && expiresAt !== undefined && expiresAt !== '') {
    exp = Math.floor(Number(expiresAt));
    if (!Number.isFinite(exp) || exp <= Date.now()) throw new AuthError('分享有效期必须晚于当前时间', 400);
  }
  if (!meta.shareToken || reset) {
    const tok = crypto.randomBytes(16).toString('hex');
    dbm.db.prepare('UPDATE meta SET share_token = ?, share_expires_at = ?, updated_at = ? WHERE doc_id = ?')
      .run(tok, exp, Date.now(), docId);
    meta.shareToken = tok;
  } else {
    // 已有 token：仅更新有效期
    dbm.db.prepare('UPDATE meta SET share_expires_at = ?, updated_at = ? WHERE doc_id = ?')
      .run(exp, Date.now(), docId);
  }
  meta.shareExpiresAt = exp;
  return { shareToken: meta.shareToken, sharePath: '/s/' + meta.shareToken, expiresAt: exp };
}

/** 查看当前分享状态（仅 owner）；无 token 返回 {hasShare:false} */
function getShare(docId, username) {
  const meta = getMeta(docId);
  if (!meta) throw new AuthError('文档不存在', 404);
  if (!username || meta.owner !== username) throw new AuthError('只有文档所有者可以管理分享', 403);
  const expired = meta.shareToken && meta.shareExpiresAt && meta.shareExpiresAt < Date.now();
  return {
    docId,
    shareToken: meta.shareToken || null,
    sharePath: meta.shareToken ? '/s/' + meta.shareToken : null,
    expiresAt: meta.shareExpiresAt || null,
    expired: !!expired,
  };
}

/** 撤销分享：清除 token 与过期时间 */
function revokeShare(docId, username) {
  const meta = getMeta(docId);
  if (!meta) throw new AuthError('文档不存在', 404);
  if (!username || meta.owner !== username) throw new AuthError('只有文档所有者可以撤销分享', 403);
  dbm.db.prepare('UPDATE meta SET share_token = NULL, share_expires_at = NULL, updated_at = ? WHERE doc_id = ?')
    .run(Date.now(), docId);
  return { ok: true, shareToken: null, sharePath: null };
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
  return isShareValid(meta, shareToken);
}

/** 分享 token 是否有效期可用（不校验 owner） */
function isShareValid(metaOrId, shareToken) {
  const meta = typeof metaOrId === 'string' ? getMeta(metaOrId) : metaOrId;
  if (!meta || !meta.shareToken || !shareToken || shareToken !== meta.shareToken) return false;
  if (meta.shareExpiresAt && meta.shareExpiresAt < Date.now()) return false;
  return true;
}

/** 由分享 token 反查文档 id（无或已过期则 null） */
function docIdByShareToken(shareToken) {
  if (!shareToken) return null;
  const r = dbm.db.prepare('SELECT doc_id FROM meta WHERE share_token = ?').get(shareToken);
  if (!r) return null;
  return isShareValid(r.doc_id, shareToken) ? r.doc_id : null;
}

/** 私有文档实体目录 */
function privateDir(docId) { return path.join(dbm.dataDir, dbm.PRIVATE_DIR, docId); }

/* ---------------- 兼容辅助：批量读取 ---------------- */

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
  register, login, logout, changePassword, userByToken,
  verifyEmailCode, requestEmailVerification, forgotPassword, resetPassword, getUser,
  createReport, listReports, setReportStatus,
  ensureMeta, getMeta, setVisibility, updateMeta, share, getShare, revokeShare,
  deleteMeta, canRead, isShareValid, docIdByShareToken, privateDir,
  readAllMeta,
};