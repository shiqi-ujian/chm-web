'use strict';
// server.js — 真正的后端：静态站点托管 + POST /api/upload 上传转换。
// 本机即可起服务验证闭环；部署到公网：设置 HOST/UPLOAD_TOKEN/PORT 后前置反代 + HTTPS。
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { processUpload, UploadError, cleanupTmp, rebuildPrivateShells, rebuildDocShell } = require('./lib/upload');
const landing = require('./lib/landing');
const { exportSite, exportDocs, exportDocDirs } = require('./lib/site-export');
const auth = require('./lib/auth');
const dbm = require('./lib/db');
const { QuotaError, SlidingWindow, initQuota, checkUploadQuota, releaseQuota, globalUsage, usageOf, reconcileUsage } = require('./lib/quota');
const LibSearch = require('./lib/search');
const { sniffFileCharset } = require('./lib/charset');

// 站点根（含欢迎页 index.html 和 d/ 文档目录）。默认本项目 docs/。
const SITE_ROOT = path.resolve(process.env.CHM_SITE || path.join(__dirname, '..', 'docs'));
const DATA_DIR = path.resolve(process.env.CHM_DATA || path.join(__dirname, '..', 'data'));
auth.init(DATA_DIR); // 账号/会话/文档元数据/私有文档目录
initQuota(DATA_DIR, {
  MAX_GLOBAL_BYTES: process.env.MAX_GLOBAL_BYTES,
  MAX_USER_DOCS: process.env.MAX_USER_DOCS,
  MAX_USER_BYTES: process.env.MAX_USER_BYTES,
});

// —— 接口限流（滑动窗口，进程内存态）：防止账号/上传/导出/搜索被暴力刷爆。
const rateLimits = {
  auth: new SlidingWindow({ windowMs: 60 * 1000, max: Number(process.env.RATE_AUTH_MAX) || 30 }),
  upload: new SlidingWindow({ windowMs: 60 * 1000, max: Number(process.env.RATE_UPLOAD_MAX) || 20 }),
  export: new SlidingWindow({ windowMs: 60 * 1000, max: Number(process.env.RATE_EXPORT_MAX) || 30 }),
  search: new SlidingWindow({ windowMs: 60 * 1000, max: Number(process.env.RATE_SEARCH_MAX) || 120 }),
};
function limited(limiter, key, res) {
  if (!limiter.allow(key)) { sendJSON(res, 429, { ok: false, error: '请求过于频繁，请稍后再试' }); return true; }
  return false;
}
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0'; // 默认绑全接口；本机调试可设 127.0.0.1
const MAX_BYTES = 80 * 1024 * 1024;

// —— 鉴权(A 形态，A3 收紧)：用环境变量设 token 即开启对应防护；不设则保持不锁。
//   UPLOAD_TOKEN 保护写操作（POST /api/upload）；EXPORT_TOKEN 保护文档导出。
//   公网下除非请求头带有效 X-Auth-Token，否则须为已登录用户（同源 cookie）。
//   密钥不再烘焙进页面源码，避免被任何人 view-source 拿到。
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN || '';
const EXPORT_TOKEN = process.env.EXPORT_TOKEN || '';

// —— 并发上传护栏：限制同时进行的 7z 解包数量，其余排队，避免打爆服务器。
const MAX_CONCURRENT_UPLOADS = Number(process.env.MAX_CONCURRENT_UPLOADS) || 2;
let activeUploads = 0;
const uploadWaiters = [];
async function withUploadSlot(fn) {
  if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
    await new Promise((r) => uploadWaiters.push(r));
  }
  activeUploads++;
  try {
    return await fn();
  } finally {
    activeUploads--;
    const next = uploadWaiters.shift();
    if (next) next();
  }
}

/** 请求头是否带有效 token（token 未设置时放行） */
function authorized(req, token) {
  if (!token) return true;                 // 未配置 → 不校验（默认开）
  const got = (req.headers['x-auth-token'] || '').trim();
  if (!got || got.length !== token.length) return false;
  // 常量时间比较，避免时序侧信道
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(token));
}
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
function adminAuthorized(req) {
  if (!ADMIN_TOKEN) return false;
  const got = (req.headers['x-admin-token'] || '').trim();
  if (!got || got.length !== ADMIN_TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(ADMIN_TOKEN));
}
function deny(req, res) {
  sendJSON(res, 401, { ok: false, error: '需要有效的访问令牌' });
}

const MIME = {
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
  '.txt': 'text/plain', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

// —— 传输优化：文本类资源 gzip 压缩 + 静态缓存头。
//   背景：文档壳页/搜索索引可达数百 KB~1.3MB，弱网下每次刷新全量重下体验像"卡死"。
//   gzip 可把 JSON/HTML 压到 10%~20%；合理 max-age 让浏览器复用已下载内容。
const COMPRESSIBLE = new Set(['.html', '.htm', '.css', '.js', '.json', '.svg', '.txt', '.xml', '.webmanifest']);
function acceptsGzip(req) {
  return /(^|,)\s*(gzip|x-gzip)\s*(,|$)/i.test(req.headers['accept-encoding'] || '');
}
/** 静态文件统一出口：gzip（文本类且客户端接受）+ Cache-Control */
function sendStatic(req, res, file, contentType, cacheControl) {
  const ext = path.extname(file).toLowerCase();
  const headers = { 'Content-Type': contentType, 'Cache-Control': cacheControl };
  // sw.js 必须尽快感知更新（浏览器每次都会重新拉取比对），不能强缓存
  if (path.basename(file) === 'sw.js') headers['Cache-Control'] = 'no-cache';
  if (acceptsGzip(req) && COMPRESSIBLE.has(ext)) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
  } else {
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  }
}

/************ 简易 multipart 解析（file 字段 + 其它表单字段） ************/
function parseMultipart(buf, boundary) {
  const result = { fields: {}, file: null };
  if (!boundary || buf.length === 0) return result;
  const sep = Buffer.from('--' + boundary);
  let pos = buf.indexOf(sep);
  while (pos !== -1) {
    const next = buf.indexOf(sep, pos + sep.length);
    if (next === -1) break;
    let section = buf.slice(pos + sep.length, next);
    // 去掉开头 \r\n（--boundary 与 header 之间）与结尾 \r\n（part 与下一分隔符之间）
    if (section.length >= 2 && section[0] === 13 && section[1] === 10) section = section.slice(2);
    if (section.length >= 2 && section[section.length - 2] === 13 && section[section.length - 1] === 10) section = section.slice(0, -2);
    const headEnd = section.indexOf(Buffer.from('\r\n\r\n'));
    if (headEnd === -1) { pos = next; continue; }
    const header = section.slice(0, headEnd).toString('latin1');
    const body = section.slice(headEnd + 4);
    const nameMatch = /name="([^"]*)"/.exec(header);
    // filename 可能带 UTF-8 中文（现代浏览器按 UTF-8 编码 header）。
    // header 已按 latin1 转码会破坏中文，因此从原始 buffer 里按 UTF-8 提取。
    const fnRaw = /filename="([^"]*)"/.exec(section.slice(0, headEnd).toString('latin1'));
    let filename = null;
    if (fnRaw) {
      // fnRaw[1] 是 latin1 字符串（每个字节对应一个码点 0-255），可无损还原回 Buffer
      const bytes = Buffer.from(fnRaw[1], 'latin1');
      try { filename = bytes.toString('utf8'); } catch { filename = fnRaw[1]; }
    }
    if (filename) {
      result.file = { field: nameMatch ? nameMatch[1] : null, filename, data: body };
    } else if (nameMatch) {
      result.fields[nameMatch[1]] = body.toString('utf8');
    }
    pos = next;
  }
  return result;
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',   // API 响应（登录态/配额/文档列表）一律禁止缓存
  });
  res.end(body);
}

/** 读取 JSON 请求体（上限 1MB） */
function readBody(req, max = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// —— CSRF 防护（轻量）——
// 写操作要求自定义头 X-CSRF，值为 server 下发到页面的随机 token（存 cookie）。
// 前端所有写请求统一带 X-CSRF；本地/未登录测试若未启用 CSRF 环境变量，则不强校验。
const CSRF_SECRET = process.env.CSRF_SECRET || '';
function csrfTokenFor(req) {
  const cookies = parseCookies(req);
  const existing = cookies.chm_csrf;
  if (existing && existing.length >= 16) return existing;
  return crypto.randomBytes(16).toString('hex');
}
function enforceCsrf(req, res) {
  if (process.env.NO_CSRF === '1') return true; // 本地调试/测试可关
  const cookies = parseCookies(req);
  const cookieTok = cookies.chm_csrf || '';
  const headerTok = req.headers['x-csrf-token'] || '';
  if (!cookieTok || !headerTok || cookieTok.length !== headerTok.length) return false;
  // 常量时间比较
  return crypto.timingSafeEqual(Buffer.from(cookieTok), Buffer.from(headerTok));
}
function setCsrfCookie(res, token) {
  setCookie(res, 'chm_csrf', token, { httpOnly: false, maxAge: 60 * 60 * 24 * 7, sameSite: 'Lax' });
}

/** 当前登录用户：优先 X-User-Token 头，其次 chm_user cookie */
function currentUser(req) {
  const t = (req.headers['x-user-token'] || '').trim() || parseCookies(req).chm_user;
  return auth.userByToken(t);
}

function setCookie(res, name, value, opts = {}) {
  const parts = [name + '=' + encodeURIComponent(value), 'Path=' + (opts.path || '/')];
  if (opts.maxAge) parts.push('Max-Age=' + opts.maxAge);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.sameSite) parts.push('SameSite=' + opts.sameSite);
  if (opts.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

/** 当前登录用户信息（含邮箱/验证状态）；未登录返回 null */
function currentUserInfo(req) {
  const u = currentUser(req);
  return u ? auth.getUser(u) : null;
}

/** JSON API 统一包装：解析 body → 执行 → 回 JSON；AuthError/UploadError 映射状态码 */
async function handleJson(req, res, fn) {
  let buf;
  try { buf = await readBody(req); } catch { sendJSON(res, 413, { ok: false, error: '请求体过大' }); return; }
  let body = {};
  try { body = buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch { sendJSON(res, 400, { ok: false, error: 'JSON 解析失败' }); return; }
  try {
    const r = await fn(body);
    sendJSON(res, 200, { ok: true, ...(r || {}) });
  } catch (e) {
    if (e instanceof auth.AuthError || e instanceof UploadError) sendJSON(res, e.status || 400, { ok: false, error: e.message });
    else { console.error(e); sendJSON(res, 500, { ok: false, error: '服务器错误：' + (e.message || e) }); }
  }
}

function serveStatic(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { urlPath = '/'; }
  if (urlPath === '/') urlPath = '/index.html';
  const target = path.resolve(SITE_ROOT, '.' + path.sep + urlPath.replace(/^\/+/, '').replace(/\\/g, '/'));
  if (target !== SITE_ROOT && !target.startsWith(SITE_ROOT + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  let file = target;
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('Not Found'); return;
  }
  const ext = path.extname(file).toLowerCase();
  // HTML 按文件实际字符集下发 charset（存量 GBK 文档即使 meta 写得不规范也能正确显示）
  let contentType = MIME[ext] || 'application/octet-stream';
  if (ext === '.html' || ext === '.htm') {
    const cs = sniffFileCharset(file);
    if (cs) contentType += '; charset=' + cs;
  }
  // 静态资源强缓存 5 分钟（文档站更新低频；上传/重建后最多 5 分钟内可见）
  sendStatic(req, res, file, contentType, 'public, max-age=300');
}

async function handleUpload(req, res) {
  // 限流（IP/账号级）
  const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
  if (limited(rateLimits.upload, 'up:' + ip, res)) return;
  // A3 授权收紧：UPLOAD_TOKEN 不再烘焙进页面。公网下上传要求：有效 UPLOAD_TOKEN
  // 或 已登录用户（同源 cookie / X-User-Token）。未配置 token 时保持不锁（本地/离线）。
  if (UPLOAD_TOKEN && !authorized(req, UPLOAD_TOKEN) && !currentUser(req)) {
    deny(req, res); return;
  }
  const contentType = req.headers['content-type'] || '';
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = m && (m[1] || m[2]);
  if (!boundary) { sendJSON(res, 400, { ok: false, error: 'multipart/form-data 需带 boundary' }); return; }

  // 累积 body
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BYTES) { sendJSON(res, 413, { ok: false, error: '文件过大' }); req.resume(); return; }
    chunks.push(c);
  }
  const buf = Buffer.concat(chunks);
  const form = parseMultipart(buf, boundary);
  const file = form.file;
  if (!file || !file.filename || !file.data) { sendJSON(res, 400, { ok: false, error: '未收到文件' }); return; }

  const username = currentUser(req);
  if (!username) { sendJSON(res, 401, { ok: false, error: '请先登录后再上传' }); return; }
  const visibility = (form.fields.visibility || 'public').trim() === 'private' ? 'private' : 'public';
  const uploadAccept = (form.fields.acceptTerms || 'false').trim();
  if (uploadAccept !== 'true') { sendJSON(res, 403, { ok: false, error: '请先勾选确认拥有合法权利/授权' }); return; }

  // 配额：校验前先锁定在内存使用量（文档数 + 字节），超限 429/413/507。
  let quotaRegistered = false;
  try {
    checkUploadQuota(username, file.data.length);
    quotaRegistered = true;
  } catch (e) {
    if (e instanceof QuotaError) { sendJSON(res, e.status, { ok: false, error: e.message }); return; }
    throw e;
  }

  // 并发护栏：解包在受限槽位内执行，避免并发 7z 拖垮进程。
  try {
    const r = await withUploadSlot(() => processUpload(file.data, file.filename, {
      siteRoot: SITE_ROOT, dataDir: DATA_DIR, maxBytes: MAX_BYTES, visibility, owner: username,
    }));
    // 更新"我的文档"索引（docs/_index.json，只含公开文档）并重建欢迎页（异步，先返回）
    queueRebuildSite();
    sendJSON(res, 200, { ok: true, ...r });
  } catch (e) {
    // 上传/转换失败时回收配额
    if (quotaRegistered) releaseQuota(username, file.data.length);
    if (e instanceof UploadError || e instanceof auth.AuthError) sendJSON(res, e.status || 400, { ok: false, error: e.message });
    else { console.error(e); sendJSON(res, 500, { ok: false, error: '服务器错误：' + (e.message || e) }); }
  }
}

/**
 * 列出可见文档：公开（docs/d/ 下全部，私有 meta 防御性剔除）+ 登录用户的私有文档（data/private/）。
 * @param {string|null} username 当前登录用户（null=匿名）
 */
function listDocs(username) {
  const out = [];
  const d = path.join(SITE_ROOT, 'd');
  if (fs.existsSync(d)) {
    for (const n of fs.readdirSync(d)) {
      if (!/^[^.].*/.test(n)) continue;
      const p = path.join(d, n);
      if (!fs.statSync(p).isDirectory()) continue;
      const meta = auth.getMeta(n);
      if (meta && meta.visibility === 'private') continue; // 防御：私有不进公开静态区
      out.push({
        id: n, name: (meta && meta.name) || n, visibility: 'public', owner: (meta && meta.owner) || null,
        href: 'd/' + n + '/', url: '/d/' + n + '/', updated: (meta && meta.updatedAt) || fs.statSync(p).mtimeMs,
        tags: (meta && meta.tags) || [], author: (meta && meta.author) || '',
      });
    }
  }
  if (username) {
    const priv = path.join(DATA_DIR, 'private');
    if (fs.existsSync(priv)) {
      for (const n of fs.readdirSync(priv)) {
        if (!/^[^.].*/.test(n)) continue;
        const p = path.join(priv, n);
        if (!fs.statSync(p).isDirectory()) continue;
        const meta = auth.getMeta(n);
        if (!meta || meta.visibility !== 'private' || meta.owner !== username) continue;
        out.push({
          id: n, name: meta.name || n, visibility: 'private', owner: username,
          href: 'p/' + n + '/', url: '/p/' + n + '/', updated: (meta && meta.updatedAt) || fs.statSync(p).mtimeMs,
          tags: (meta && meta.tags) || [], author: (meta && meta.author) || '',
        });
      }
    }
  }
  return out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

/** 私有文档静态服务：/p/<id>/... 仅 owner 或分享 token 可读 */function servePrivate(req, res, urlPath, username) {
  const m = /^\/p\/([^/]+)(\/.*)?$/.exec(urlPath);
  if (!m) { res.writeHead(404); res.end('Not Found'); return; }
  const id = decodeURIComponent(m[1]);
  const sub = (m[2] || '/').replace(/^\/+/, '');
  const cookies = parseCookies(req);
  const shareToken = (new URL(req.url, 'http://x')).searchParams.get('share')
    || cookies['chm_share_' + id] || null;
  if (!auth.canRead(id, { username, shareToken })) { res.writeHead(403); res.end('Forbidden'); return; }
  const base = auth.privateDir(id);
  if (!fs.existsSync(base)) { res.writeHead(404); res.end('Not Found'); return; }
  let target = path.resolve(base, '.' + path.sep + sub.replace(/\\/g, '/'));
  if (target !== base && !target.startsWith(base + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  let file = target;
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not Found'); return; }
  const ext = path.extname(file).toLowerCase();
  let contentType = MIME[ext] || 'application/octet-stream';
  if (ext === '.html' || ext === '.htm') {
    const cs = sniffFileCharset(file);
    if (cs) contentType += '; charset=' + cs;
  }
  // 私有文档内容仅本浏览器缓存（private 语义，不共享）
  sendStatic(req, res, file, contentType, 'private, max-age=300');
}

/** 分享链接：/s/<token> → 302 到私有文档并种下该文档的分享 cookie */
function handleShare(req, res, urlPath) {
  const tok = urlPath.slice(3);
  const id = auth.docIdByShareToken(tok);
  if (!id) { res.writeHead(404); res.end('Not Found'); return; }
  setCookie(res, 'chm_share_' + id, tok, { path: '/p/' + id + '/', maxAge: 60 * 60 * 24 * 30, sameSite: 'Lax' });
  res.writeHead(302, { Location: '/p/' + id + '/' });
  res.end();
}

/** 实体迁移：可见性变化时在公开静态区 docs/d/<id> 与私有区 data/private/<id> 间搬移 */
function migrateDoc(id, visibility) {
  const priv = auth.privateDir(id);
  const pub = path.join(SITE_ROOT, 'd', id);
  // 优先 rename（同文件系统 O(1) 原子移动，不复制几百 MB）；跨设备才回退 cpSync+rm。
  // 之前用 cpSync 同步复制大文档（如 285MB）会长时间阻塞事件循环 → 页面"卡死"。
  const move = (from, to) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
    if (!fs.existsSync(from)) return;
    try {
      fs.renameSync(from, to);
    } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      fs.cpSync(from, to, { recursive: true });
      fs.rmSync(from, { recursive: true, force: true });
    }
  };
  if (visibility === 'public') move(priv, pub);
  else move(pub, priv);
}

/** 重建欢迎页（公开清单）+ _index.json + 全站聚合检索索引 */
function rebuildSite() {
  try {
    fs.writeFileSync(path.join(SITE_ROOT, '_index.json'), JSON.stringify(listDocs(null), null, 2));
    landing.build({
      outDir: SITE_ROOT,
      docs: listDocs(null).map((d) => ({ id: d.id, name: d.name, href: d.href })),
    });
    // 重建后同步灌入 SQLite FTS 索引（在线检索底座）
    LibSearch.rebuild(SITE_ROOT);
  } catch (e) { console.error('site rebuild failed', e); }
}

/**
 * 异步站点重建：用户写操作（上传/可见性/改名/删除）先返回响应，重建放到事件循环尾部。
 * 合并多次触发（busy 期间再触发直接忽略），避免大站点下同步重建阻塞事件循环。
 */
let siteRebuildPending = false;
function queueRebuildSite() {
  if (siteRebuildPending) return;
  siteRebuildPending = true;
  setImmediate(() => { siteRebuildPending = false; rebuildSite(); });
}

/**
 * 首次部署/空卷时从镜像种子目录填充初始站点内容。
 * 挂在 /app/docs 的 Volume 是空的会遮住镜像里的 docs/（预置文档消失），
 * Dockerfile 另把 docs 复制到 /app/seed-docs 作备份；这里在站点根为空时复制回来。
 */
function ensureSeed() {
  const seed = process.env.CHM_SEED || path.join(__dirname, '..', 'seed-docs');
  try {
    if (!fs.existsSync(seed)) return;
    if (fs.existsSync(path.join(SITE_ROOT, 'index.html'))) return; // 已有内容（卷已填充）
    fs.cpSync(seed, SITE_ROOT, { recursive: true });
    console.log('seeded initial site content from ' + seed);
  } catch (e) { console.error('seed failed', e); }
}

/** 打包整站为 zip 下载 */
function handleSiteExport(req, res) {
  // 限流
  if (limited(rateLimits.export, 'exp:' + ((req.socket && req.socket.remoteAddress) || 'unknown'), res)) return;
  // A3 授权收紧：EXPORT_TOKEN 不再烘焙进页面。公网下导出要求：
  //   - 显式鉴权：请求头带有效 EXPORT_TOKEN（服务方/运维），或
  //   - 已登录用户（同源 cookie / X-User-Token）。
  // 两者都有则放行；本地未配置 token 时保持不锁（兼容本地/离线）。
  if (EXPORT_TOKEN) {
    if (authorized(req, EXPORT_TOKEN)) { /* 服务方令牌放行 */ }
    else if (currentUser(req)) { /* 登录用户放行 */ }
    else { deny(req, res); return; }
  }
  const r = exportSite({ siteRoot: SITE_ROOT });
  const name = 'chm-web-site-' + Date.now() + '.zip';
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': r.zip.length,
    'Content-Disposition': 'attachment; filename="' + name + '"',
  });
  res.end(r.zip);
}

/** 打包"选中若干文档"为独立静态子站 zip 下载（批量导出/私密部署的核心） */
function handleExportDocs(req, res) {
  // 限流
  if (limited(rateLimits.export, 'exp:' + ((req.socket && req.socket.remoteAddress) || 'unknown'), res)) return;
  // A3 授权收紧：同 handleSiteExport。
  if (EXPORT_TOKEN) {
    if (authorized(req, EXPORT_TOKEN)) { /* 放行 */ }
    else if (currentUser(req)) { /* 登录用户放行 */ }
    else { deny(req, res); return; }
  }
  const u = new URL(req.url, 'http://x');
  // 新：支持 POST JSON { ids }，用于上传完直接打包（公开 + 自己的私有文档都可导出）
  if (req.method === 'POST') {
    handleJson(req, res, async (b) => {
      const ids = Array.isArray(b && b.ids) ? b.ids.map(String).filter(Boolean) : [];
      const user = currentUser(req);
      const dirs = [];
      for (const id of ids) {
        const meta = auth.getMeta(id);
        const pub = path.join(SITE_ROOT, 'd', id);
        if (fs.existsSync(pub) && fs.statSync(pub).isDirectory()) {
          dirs.push({ dir: pub, rel: 'd/' + String(id).replace(/\\/g, '/').replace(/^\/+/, ''), name: (meta && meta.name) || id });
          continue;
        }
        const priv = auth.privateDir(id);
        if (fs.existsSync(priv) && fs.statSync(priv).isDirectory()) {
          // 私有文档：登录用户须为 owner；若走服务方 EXPORT_TOKEN 也放行
          if (!(user && meta && meta.owner === user) && !authorized(req, EXPORT_TOKEN)) {
            throw new auth.AuthError('无权导出私有文档：' + id, 403);
          }
          dirs.push({ dir: priv, rel: 'p/' + String(id).replace(/\\/g, '/').replace(/^\/+/, ''), name: (meta && meta.name) || id });
        }
      }
      if (!dirs.length) throw new auth.AuthError('没有可导出的文档', 404);
      const r = exportDocDirs({
        siteRoot: SITE_ROOT,
        dataDir: DATA_DIR,
        dirs,
        title: (b && b.title) || (dirs.length > 1 ? '批量上传导出' : '单篇上传导出'),
      });
      // handleJson 会把返回对象 JSON 序列化；zip 转 base64 交给前端下载
      return { zip: r.zip.toString('base64'), manifest: r.manifest, count: dirs.length };
    });
    return;
  }
  const ids = (u.searchParams.get('ids') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const r = exportDocs({ siteRoot: SITE_ROOT, ids });
  const name = 'chm-web-docs-' + Date.now() + '.zip';
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': r.zip.length,
    'Content-Disposition': 'attachment; filename="' + name + '"',
  });
  res.end(r.zip);
}

/** 删除某文档（公开区 d/ 与私有区 private/）并释放配额；返回实际移除路径与体积 */
function removeDocFiles(id) {
  let removed = [];
  let size = 0;
  const pub = path.join(SITE_ROOT, 'd', id);
  if (fs.existsSync(pub)) { size += dirBytes(pub); fs.rmSync(pub, { recursive: true, force: true }); removed.push('d/' + id); }
  const priv = auth.privateDir(id);
  if (fs.existsSync(priv)) { size += dirBytes(priv); fs.rmSync(priv, { recursive: true, force: true }); removed.push('private/' + id); }
  return { removed, size };
}
function dirBytes(dir) {
  let sum = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) sum += dirBytes(full);
      else sum += fs.statSync(full).size;
    }
  } catch (_) {}
  return sum;
}

const server = http.createServer((req, res) => {
  // 兜底：请求处理中的任何同步异常都不得打崩进程（畸形请求行/探针可触发，
  // 例如 path 为 '//' 时 new URL 抛 ERR_INVALID_URL、%zz 让 decodeURIComponent 抛 URIError），
  // 统一记录日志并回 500/400，进程保持存活。
  try {
    route(req, res);
  } catch (e) {
    console.error('handler error', req.method, req.url, (e && e.stack) || e);
    if (!res.headersSent) sendJSON(res, 500, { ok: false, error: '服务器错误：' + ((e && e.message) || e) });
    else res.end();
  }
});
function route(req, res) {
  // 防御：畸形请求行（如 path 为 '//'）会让 new URL 抛 ERR_INVALID_URL，解析失败按 400 处理。
  let u = null;
  try { u = new URL(req.url, 'http://x'); } catch (_) { u = null; }
  if (!u) { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('Bad Request'); return; }
  const urlPath = u.pathname;
  // 写操作统一 CSRF 防护（本地测试/旧客户端可 NO_CSRF=1 关闭）
  if (req.method !== 'GET' && req.method !== 'HEAD' && process.env.NO_CSRF !== '1' && !enforceCsrf(req, res)) {
    sendJSON(res, 403, { ok: false, error: 'CSRF 校验失败，请刷新页面重试' }); return;
  }
  // 给所有页面响应种 CSRF cookie（简化，前端读 cookie 后放头）
  if (req.method === 'GET' && urlPath !== '/api/' && !parseCookies(req).chm_csrf) {
    setCsrfCookie(res, csrfTokenFor(req));
  }
  if (req.method === 'POST' && urlPath === '/api/register') {
    if (limited(rateLimits.auth, 'auth:' + ((req.socket && req.socket.remoteAddress) || 'unknown'), res)) return;
    handleJson(req, res, (b) => auth.register(b));
  } else if (req.method === 'POST' && urlPath === '/api/login') {
    if (limited(rateLimits.auth, 'auth:' + ((req.socket && req.socket.remoteAddress) || 'unknown'), res)) return;
    handleJson(req, res, (b) => {
      const r = auth.login(b);
      setCookie(res, 'chm_user', r.token, { maxAge: 60 * 60 * 24 * 30, sameSite: 'Lax' });
      return r;
    });
  } else if (req.method === 'POST' && urlPath === '/api/logout') {
    const t = (req.headers['x-user-token'] || '').trim() || parseCookies(req).chm_user;
    auth.logout(t);
    setCookie(res, 'chm_user', '', { maxAge: 0 });
    sendJSON(res, 200, { ok: true });
  } else if (req.method === 'POST' && urlPath === '/api/change-password') {
    // 修改密码：需登录；校验旧密码后换盐重哈希，并注销该用户其它会话（当前会话保留）。
    handleJson(req, res, (b) => {
      const tok = (req.headers['x-user-token'] || '').trim() || parseCookies(req).chm_user;
      return auth.changePassword(currentUser(req), b.oldPassword, b.newPassword, tok);
    });
  } else if (req.method === 'GET' && urlPath === '/api/me') {
    sendJSON(res, 200, { user: currentUser(req), info: currentUserInfo(req) });
  } else if (req.method === 'GET' && urlPath === '/api/docs') {
    sendJSON(res, 200, { docs: listDocs(currentUser(req)) });
  } else if (req.method === 'GET' && urlPath === '/api/usage') {
    const u = currentUser(req);
    sendJSON(res, 200, u ? { usage: usageOf(u), username: u } : { usage: null, username: null });
  } else if (req.method === 'GET' && urlPath === '/api/search') {
    // 搜索限流：避免公开接口被高频抓取/滥用
    if (limited(rateLimits.search, 'search:' + ((req.socket && req.socket.remoteAddress) || 'unknown'), res)) return;
    // B1 服务端检索：分页 + 高亮片段；文档一多时比前端整包拉索引更稳。
    const q = (u.searchParams.get('q') || '').trim();
    const limit = Math.min(Number(u.searchParams.get('limit')) || 10, 50);
    const offset = Math.max(Number(u.searchParams.get('offset')) || 0, 0);
    const username = currentUser(req) || null;
    // 私密搜索：?scope=mine 只搜当前登录用户自己的私有文档
    const scopeKind = u.searchParams.get('scope') || '';
    if (scopeKind === 'mine') {
      if (!username) { sendJSON(res, 401, { ok: false, error: '请先登录后再搜索私密文档' }); return; }
      sendJSON(res, 200, LibSearch.searchUserPrivate(SITE_ROOT, q, username, { limit, offset }));
      return;
    }
    // 可选：?scope=<id> 或 ?share=<token>（分享链接授权时由前端显式传，服务端校验分享 token）
    const scopeParam = u.searchParams.get('share') || (scopeKind && scopeKind !== 'mine' ? scopeKind : '') || '';
    let scopeIds = null;
    if (scopeParam) {
      const id = auth.docIdByShareToken(scopeParam);
      if (!id) { sendJSON(res, 404, { ok: false, error: '分享链接无效或已过期' }); return; }
      scopeIds = [id];
    }
    sendJSON(res, 200, LibSearch.search(SITE_ROOT, q, { limit, offset, username, scopeIds }));
  } else if (req.method === 'GET' && urlPath === '/api/verify-email') {
    handleJson(req, res, () => auth.verifyEmailCode(u.searchParams.get('token') || ''));
  } else if (req.method === 'POST' && urlPath === '/api/verify-email') {
    handleJson(req, res, (b) => auth.verifyEmailCode(b && b.token));
  } else if (req.method === 'POST' && urlPath === '/api/resend-verification') {
    handleJson(req, res, () => auth.requestEmailVerification(currentUser(req)));
  } else if (req.method === 'POST' && urlPath === '/api/forgot-password') {
    handleJson(req, res, (b) => auth.forgotPassword(b && b.usernameOrEmail));
  } else if (req.method === 'POST' && urlPath === '/api/reset-password') {
    handleJson(req, res, (b) => auth.resetPassword(b && b.token, b && b.newPassword));
  } else if (req.method === 'POST' && urlPath === '/api/report') {
    handleJson(req, res, (b) => auth.createReport({
      docId: b && b.docId, url: b && b.url, reason: b && b.reason, contact: b && b.contact,
      ip: (req.socket && req.socket.remoteAddress) || null,
    }));
  } else if (req.method === 'GET' && urlPath.startsWith('/admin/reports')) {
    // 管理端：ADMIN_TOKEN 校验
    if (!adminAuthorized(req)) { sendJSON(res, 401, { ok: false, error: '需要管理员令牌' }); return; }
    const st = u.searchParams.get('status') || '';
    sendJSON(res, 200, { ok: true, reports: auth.listReports({ status: st || undefined }) });
  } else if (req.method === 'PATCH' && /^\/admin\/reports\/[^/]+$/.test(urlPath)) {
    if (!adminAuthorized(req)) { sendJSON(res, 401, { ok: false, error: '需要管理员令牌' }); return; }
    const id = decodeURIComponent(urlPath.split('/')[3]);
    handleJson(req, res, (b) => auth.setReportStatus(id, b && b.status));
  } else if (req.method === 'POST' && urlPath === '/admin/remove-doc') {
    if (!adminAuthorized(req)) { sendJSON(res, 401, { ok: false, error: '需要管理员令牌' }); return; }
    handleJson(req, res, (b) => {
      const id = String(b && b.docId || '').trim();
      if (!id) throw new auth.AuthError('缺少 docId', 400);
      const meta = auth.getMeta(id);
      if (meta && meta.owner) releaseQuota(meta.owner, removeDocFiles(id).size);
      const { removed, size } = removeDocFiles(id);
      if (meta && meta.owner) releaseQuota(meta.owner, size);
      // 管理员下架：不经过 owner 校验，直接删除元数据
      try { dbm.db.prepare('DELETE FROM meta WHERE doc_id=?').run(id); } catch (_) {}
      queueRebuildSite();
      return { id, removed };
    });
  } else if (req.method === 'POST' && /^\/api\/doc\/[^/]+\/visibility$/.test(urlPath)) {
    const id = decodeURIComponent(urlPath.split('/')[3]);
    handleJson(req, res, (b) => {
      const meta = auth.setVisibility(id, b.visibility, currentUser(req));
      migrateDoc(id, meta.visibility);   // 公开⇄私有实体迁移
      // 可见性切换后重建阅读壳，保证 URL 前缀与所在区一致：
      //   转私有 → /p/<id>/ 绝对前缀；转公开 → 相对链接（否则旧私有壳的 /p/ 前缀
      //   会让公开访问 403/404，且目录高亮/上下页匹配失效）
      if (meta.visibility === 'private') {
        const privDir = path.join(DATA_DIR, 'private', id);
        if (fs.existsSync(privDir)) {
          try {
            rebuildDocShell(privDir, id, meta.name || id, { visibility: 'private', skipIndexes: true });
          } catch (e) { console.error('rebuild private shell after visibility change failed', id, e); }
        }
      } else {
        const pubDir = path.join(SITE_ROOT, 'd', id);
        if (fs.existsSync(pubDir)) {
          try {
            rebuildDocShell(pubDir, id, meta.name || id, { visibility: 'public', skipIndexes: true });
          } catch (e) { console.error('rebuild public shell after visibility change failed', id, e); }
        }
      }
      queueRebuildSite();                // 重建欢迎页/索引（异步，先返回响应）
      return { id, visibility: meta.visibility };
    });
  } else if (req.method === 'POST' && /^\/api\/doc\/[^/]+\/meta$/.test(urlPath)) {
    // 文档管理：重命名 / 标签 / 作者（仅 owner）
    const id = decodeURIComponent(urlPath.split('/')[3]);
    handleJson(req, res, (b) => {
      const meta = auth.updateMeta(id, currentUser(req), b || {});
      queueRebuildSite(); // 名称会出现在欢迎页/索引，异步重建保证一致
      return { id, meta };
    });
  } else if (req.method === 'POST' && /^\/api\/doc\/[^/]+\/share$/.test(urlPath)) {
    const id = decodeURIComponent(urlPath.split('/')[3]);
    handleJson(req, res, (b) => {
      const owner = currentUser(req);
      return auth.share(id, owner, { reset: !!(b && b.reset), expiresAt: (b && b.expiresAt) || null });
    });
  } else if (req.method === 'GET' && /^\/api\/doc\/[^/]+\/share$/.test(urlPath)) {
    const id = decodeURIComponent(urlPath.split('/')[3]);
    handleJson(req, res, () => auth.getShare(id, currentUser(req)));
  } else if (req.method === 'DELETE' && /^\/api\/doc\/[^/]+\/share$/.test(urlPath)) {
    const id = decodeURIComponent(urlPath.split('/')[3]);
    handleJson(req, res, () => auth.revokeShare(id, currentUser(req)));
  } else if (req.method === 'DELETE' && /^\/api\/doc\/[^/]+$/.test(urlPath)) {
    // 删除文档：仅 owner 可删。删除公开区 docs/d/<id> 与私有区 data/private/<id> 实体 + meta
    const id = decodeURIComponent(urlPath.split('/')[3]);
    const u = currentUser(req);
    try {
      const meta = auth.getMeta(id);
      auth.deleteMeta(id, u);
      const { removed, size } = removeDocFiles(id);
      // 释放配额（删 1 文档 + 释放其体积）
      if (meta && meta.owner) releaseQuota(meta.owner, size);
      queueRebuildSite();
      sendJSON(res, 200, { ok: true, id, removed });
    } catch (e) {
      if (e instanceof auth.AuthError) sendJSON(res, e.status || 400, { ok: false, error: e.message });
      else { console.error(e); sendJSON(res, 500, { ok: false, error: '服务器错误：' + (e.message || e) }); }
    }
  } else if (req.method === 'GET' && urlPath.startsWith('/s/')) {
    handleShare(req, res, urlPath);
  } else if (req.method === 'GET' && urlPath.startsWith('/p/')) {
    servePrivate(req, res, urlPath, currentUser(req));
  } else if (req.method === 'POST' && urlPath === '/api/upload') {
    handleUpload(req, res);
  } else if (req.method === 'GET' && urlPath === '/site-export.zip') {
    handleSiteExport(req, res);
  } else if (req.method === 'GET' && urlPath === '/api/export-docs') {
    handleExportDocs(req, res);
  } else if (req.method === 'POST' && urlPath === '/api/export-docs') {
    handleExportDocs(req, res);
  } else {
    serveStatic(req, res);
  }
}

server.listen(Number(PORT), HOST, () => {
  const port = server.address().port;
  // 空卷时从镜像种子填充初始站点内容，再用当前环境变量重建欢迎页
  ensureSeed();
  rebuildSite();
  // 启动修复存量私有文档阅读壳（旧壳 URL 缺 /p/<id>/ 前缀 → 正文 iframe 404）。
  // 重要：线上阿里云要求重启后私有文档才能全部恢复。
  try {
    const r = rebuildPrivateShells({ dataDir: DATA_DIR });
    if (r.rebuilt) console.log('[startup] rebuilt private shells:', r.rebuilt, '件；skipped', r.skipped);
  } catch (e) { console.error('[startup] rebuildPrivateShells failed', e); }
  // 启动时清理崩溃/超时残留的临时文件（异步，不阻塞监听）
  try { cleanupTmp({ dataDir: DATA_DIR, siteRoot: SITE_ROOT }); } catch (e) { console.error('cleanup failed', e); }
  // 用量校准：以 meta + 磁盘为准重算 user_usage（防历史迁移/手动改动导致的 docs/bytes 失实）
  try {
    const reconciled = reconcileUsage(SITE_ROOT, DATA_DIR);
    if (reconciled.length) console.log('[startup] usage reconciled:', reconciled.map((u) => u.username + '=' + u.docs + '篇/' + u.bytes + 'B').join(', '));
  } catch (e) { console.error('[startup] reconcileUsage failed', e); }
  console.log('chm-web server listening: http://' + HOST + ':' + port);
  console.log('  site root :', SITE_ROOT);
  const lockU = UPLOAD_TOKEN ? 'on' : 'off'; const lockE = EXPORT_TOKEN ? 'on' : 'off';
  console.log('  auth      : upload=' + lockU + '  export=' + lockE + '  (UPLOAD_TOKEN/EXPORT_TOKEN)');
  console.log('  POST /api/register|login|logout|change-password  → 账号');
  console.log('  GET  /api/me / /api/docs         → 当前用户 / 可见文档列表（登录后含私有）');
  console.log('  POST /api/upload                 → 上传 .chm 并转换（表单可带 visibility=public|private）');
  console.log('  POST /api/doc/<id>/visibility|share → 改可见性 / 生成分享链接（仅 owner）');
  console.log('  GET  /p/<id>/...                 → 私有文档（仅 owner 或分享链接）');
  console.log('  GET  /s/<token>                  → 分享链接跳转');
  console.log('  GET  /api/export-docs?ids=a,b → 批量导出选中文档为独立裸站 zip');
  console.log('  GET  /site-export.zip     → 下载整站 zip');
  console.log('  直接打开首页: http://localhost:' + port + '/');
});