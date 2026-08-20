'use strict';
// db.js — SQLite 存储层（better-sqlite3，WAL 模式）。
// 只管理「状态元数据」：users / sessions / meta（文档元数据）/ user_usage（配额）/ reports（举报）/ search_fts（检索）。
// 文档实体文件仍走文件系统（docs/d 公开、data/private 私有）——那是静态产物，不该进库。
// 打开时做一次性 JSON → SQLite 迁移（首次，DB 空且旧 JSON 存在时），并把旧 JSON 改名 .bak.<ts> 备份。
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_FILE = 'app.db';
const USERS_FILE = 'users.json';
const SESSIONS_FILE = 'sessions.json';
const META_FILE = 'meta.json';
const PRIVATE_DIR = 'private';

let db = null;
let dataDir = '';

/** 打开/初始化数据库（幂等）。JSON 遗留仅迁移一次。 */
function ensureColumn(table, column, ddl) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  } catch (e) {
    console.error('[db] ensureColumn failed', table, column, e);
  }
}

/** 幂等创建索引（必须在补列之后调用，避免旧库缺列崩溃）。 */
function ensureIndex(table, index, columns) {
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS ${index} ON ${table}(${columns})`);
  } catch (e) {
    console.error('[db] ensureIndex failed', table, index, e);
  }
}

function open(dir) {
  if (db) return db;
  dataDir = path.resolve(dir);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, PRIVATE_DIR), { recursive: true });

  const file = path.join(dataDir, DB_FILE);
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username   TEXT PRIMARY KEY,
      salt       TEXT NOT NULL,
      hash       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      email      TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,
      verification_code TEXT,
      verification_expires INTEGER,
      password_reset_token TEXT,
      password_reset_expires INTEGER,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,
      last_login_at INTEGER,
      created_ip TEXT,
      terms_accepted_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      username   TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
    CREATE TABLE IF NOT EXISTS meta (
      doc_id      TEXT PRIMARY KEY,
      owner       TEXT,
      name        TEXT,
      visibility  TEXT NOT NULL DEFAULT 'public',
      share_token TEXT,
      share_expires_at INTEGER,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER,
      tags        TEXT DEFAULT '[]',
      author      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_meta_owner ON meta(owner);
    CREATE INDEX IF NOT EXISTS idx_meta_visibility ON meta(visibility);
    CREATE INDEX IF NOT EXISTS idx_meta_share ON meta(share_token);
    CREATE TABLE IF NOT EXISTS user_usage (
      username TEXT PRIMARY KEY,
      docs     INTEGER NOT NULL DEFAULT 0,
      bytes    INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS reports (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id     TEXT,
      url        TEXT,
      reason     TEXT,
      contact    TEXT,
      status     TEXT NOT NULL DEFAULT 'pending',
      created_ip TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
      doc, title, body,
      tokenize = 'unicode61'
    );
  `);

  // 老库升级：为 users 补列（幂等）
  ensureColumn('users', 'email', 'TEXT');
  ensureColumn('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'verification_code', 'TEXT');
  ensureColumn('users', 'verification_expires', 'INTEGER');
  ensureColumn('users', 'password_reset_token', 'TEXT');
  ensureColumn('users', 'password_reset_expires', 'INTEGER');
  ensureColumn('users', 'failed_attempts', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'locked_until', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'last_login_at', 'INTEGER');
  ensureColumn('users', 'created_ip', 'TEXT');
  ensureColumn('users', 'terms_accepted_at', 'INTEGER');
  ensureColumn('users', 'updated_at', 'INTEGER');
  // 索引必须在补列之后创建，否则旧库（无 email 列）会在此崩溃
  ensureIndex('users', 'idx_users_email', 'email');

  // 老库升级：meta 增加文档管理字段（幂等）
  ensureColumn('meta', 'updated_at', 'INTEGER');
  ensureColumn('meta', 'tags', "TEXT DEFAULT '[]'");
  ensureColumn('meta', 'author', 'TEXT');
  ensureColumn('meta', 'share_expires_at', 'INTEGER');

  migrateFromJsonOnce();
  return db;
}

/** 首次打开时把历史 JSON 数据导入 SQLite（仅当 DB 表空且 JSON 存在）。留 .bak 可回滚。 */
function migrateFromJsonOnce() {
  const users = readJson(USERS_FILE);
  const sessions = readJson(SESSIONS_FILE);
  const meta = readJson(META_FILE);
  if (Object.keys(users).length === 0 && Object.keys(sessions).length === 0 && Object.keys(meta).length === 0) {
    return; // 无历史数据需要迁移
  }

  // 每张表独立判断，避免某表已迁移而重复导入
  const hasUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0;
  const hasSessions = db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c > 0;
  const hasMeta = db.prepare('SELECT COUNT(*) AS c FROM meta').get().c > 0;

  const insertUser = db.prepare('INSERT OR IGNORE INTO users (username, salt, hash, created_at) VALUES (?,?,?,?)');
  const insertSession = db.prepare('INSERT OR IGNORE INTO sessions (token, username, created_at) VALUES (?,?,?)');
  const insertMeta = db.prepare('INSERT OR IGNORE INTO meta (doc_id, owner, name, visibility, share_token, created_at, updated_at) VALUES (?,?,?,?,?,?,?)');

  db.transaction(() => {
    if (!hasUsers) {
      for (const [name, u] of Object.entries(users)) {
        if (!u) continue;
        insertUser.run(name, u.salt || '', u.hash || '', Number(u.createdAt) || 0);
      }
    }
    if (!hasSessions) {
      for (const [tok, s] of Object.entries(sessions)) {
        if (!s) continue;
        insertSession.run(tok, s.username || '', Number(s.createdAt) || 0);
      }
    }
    if (!hasMeta) {
      for (const [id, m] of Object.entries(meta)) {
        if (!m) continue;
        insertMeta.run(
          id, m.owner || null, m.name || id,
          m.visibility === 'private' ? 'private' : 'public',
          m.shareToken || null, Number(m.createdAt) || 0, Number(m.updatedAt) || Number(m.createdAt) || 0
        );
      }
    }
  })();

  // 备份原始 JSON（保留可回滚）
  backupJsonIfExists(USERS_FILE);
  backupJsonIfExists(SESSIONS_FILE);
  backupJsonIfExists(META_FILE);
  console.log('[db] migrated JSON → SQLite (' + DB_FILE + ')');
}

function backupJsonIfExists(file) {
  const abs = path.join(dataDir, file);
  if (!fs.existsSync(abs)) return;
  const bak = abs + '.bak.' + Date.now();
  try { fs.renameSync(abs, bak); console.log('[db] backed up', file, '→', path.basename(bak)); } catch (e) { console.error('[db] backup failed', file, e); }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')); } catch { return {}; }
}

/** 惰性清理过期会话，返回清理条数。 */
function pruneSessions(now, ttlMs) {
  const cutoff = (now || Date.now()) - ttlMs;
  const r = db.prepare('DELETE FROM sessions WHERE created_at < ?').run(cutoff);
  return r.changes;
}

function close() {
  if (db) { try { db.close(); } catch (_) {} db = null; }
}

module.exports = {
  open, close, DB_FILE, PRIVATE_DIR, pruneSessions,
  get db() { return db; },
  get dataDir() { return dataDir; },
};