'use strict';
// server.js — 真正的后端：静态站点托管 + POST /api/upload 上传转换。
// 本机即可起服务验证闭环；部署到公网：设置 HOST/UPLOAD_TOKEN/PORT 后前置反代 + HTTPS。
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { processUpload, UploadError } = require('./lib/upload');
const landing = require('./lib/landing');
const { exportSite, exportDocs } = require('./lib/site-export');
const auth = require('./lib/auth');

// 站点根（含欢迎页 index.html 和 d/ 文档目录）。默认本项目 docs/。
const SITE_ROOT = path.resolve(process.env.CHM_SITE || path.join(__dirname, '..', 'docs'));
const DATA_DIR = path.resolve(process.env.CHM_DATA || path.join(__dirname, '..', 'data'));
auth.init(DATA_DIR); // 账号/会话/文档元数据/私有文档目录
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0'; // 默认绑全接口；本机调试可设 127.0.0.1
const MAX_BYTES = 80 * 1024 * 1024;

// —— 简单鉴权(A 形态)：用环境变量设 token 即开启对应防护；不设则保持现状（不锁）。
// UPLOAD_TOKEN  保护写操作（POST /api/upload）
// EXPORT_TOKEN  保护文档导出（/api/export-docs、/site-export.zip）
// 客户端须在请求头带 X-Auth-Token: <token>。
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN || '';
const EXPORT_TOKEN = process.env.EXPORT_TOKEN || '';

/** 请求头是否带有效 token（token 未设置时放行） */
function authorized(req, token) {
  if (!token) return true;                 // 未配置 → 不校验（默认开）
  const got = (req.headers['x-auth-token'] || '').trim();
  if (!got || got.length !== token.length) return false;
  // 常量时间比较，避免时序侧信道
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(token));
}
function deny(req, res) {
  sendJSON(res, 401, { ok: false, error: '需要有效的访问令牌' });
}

const MIME = {
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
  '.txt': 'text/plain', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

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
    const filenameMatch = /filename="([^"]*)"/.exec(header);
    if (filenameMatch) {
      result.file = { field: nameMatch ? nameMatch[1] : null, filename: filenameMatch[1], data: body };
    } else if (nameMatch) {
      result.fields[nameMatch[1]] = body.toString('utf8');
    }
    pos = next;
  }
  return result;
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
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
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

async function handleUpload(req, res) {
  if (!authorized(req, UPLOAD_TOKEN)) { deny(req, res); return; }
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

  try {
    const r = await processUpload(file.data, file.filename, {
      siteRoot: SITE_ROOT, dataDir: DATA_DIR, maxBytes: MAX_BYTES, visibility, owner: username,
    });
    // 更新"我的文档"索引（docs/_index.json，只含公开文档）并重建欢迎页
    rebuildSite();
    sendJSON(res, 200, { ok: true, ...r });
  } catch (e) {
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
        href: 'd/' + n + '/', url: '/d/' + n + '/', updated: fs.statSync(p).mtimeMs,
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
          href: 'p/' + n + '/', url: '/p/' + n + '/', updated: fs.statSync(p).mtimeMs,
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
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
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
  if (visibility === 'public') {
    if (fs.existsSync(priv)) {
      fs.mkdirSync(path.dirname(pub), { recursive: true });
      if (fs.existsSync(pub)) fs.rmSync(pub, { recursive: true, force: true });
      fs.cpSync(priv, pub, { recursive: true });
      fs.rmSync(priv, { recursive: true, force: true });
    }
  } else {
    if (fs.existsSync(pub)) {
      fs.mkdirSync(path.dirname(priv), { recursive: true });
      if (fs.existsSync(priv)) fs.rmSync(priv, { recursive: true, force: true });
      fs.cpSync(pub, priv, { recursive: true });
      fs.rmSync(pub, { recursive: true, force: true });
    }
  }
}

/** 重建欢迎页（公开清单）+ _index.json + 全站聚合检索索引 */
function rebuildSite() {
  try {
    fs.writeFileSync(path.join(SITE_ROOT, '_index.json'), JSON.stringify(listDocs(null), null, 2));
    landing.build({
      outDir: SITE_ROOT,
      docs: listDocs(null).map((d) => ({ name: d.name, href: d.href, id: d.id })),
      token: EXPORT_TOKEN,
      uploadToken: UPLOAD_TOKEN,
    });
  } catch (e) { console.error('site rebuild failed', e); }
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
  if (!authorized(req, EXPORT_TOKEN)) { deny(req, res); return; }
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
  if (!authorized(req, EXPORT_TOKEN)) { deny(req, res); return; }
  const u = new URL(req.url, 'http://x');
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

const server = http.createServer((req, res) => {
  const urlPath = (new URL(req.url, 'http://x')).pathname;
  if (req.method === 'POST' && urlPath === '/api/register') {
    handleJson(req, res, (b) => auth.register(b));
  } else if (req.method === 'POST' && urlPath === '/api/login') {
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
  } else if (req.method === 'GET' && urlPath === '/api/me') {
    sendJSON(res, 200, { user: currentUser(req) });
  } else if (req.method === 'GET' && urlPath === '/api/docs') {
    sendJSON(res, 200, { docs: listDocs(currentUser(req)) });
  } else if (req.method === 'POST' && /^\/api\/doc\/[^/]+\/visibility$/.test(urlPath)) {
    const id = decodeURIComponent(urlPath.split('/')[3]);
    handleJson(req, res, (b) => {
      const meta = auth.setVisibility(id, b.visibility, currentUser(req));
      migrateDoc(id, meta.visibility);   // 公开⇄私有实体迁移
      rebuildSite();                     // 重建欢迎页/索引
      return { id, visibility: meta.visibility };
    });
  } else if (req.method === 'POST' && /^\/api\/doc\/[^/]+\/share$/.test(urlPath)) {
    const id = decodeURIComponent(urlPath.split('/')[3]);
    handleJson(req, res, (b) => auth.share(id, currentUser(req), { reset: !!(b && b.reset) }));
  } else if (req.method === 'DELETE' && /^\/api\/doc\/[^/]+$/.test(urlPath)) {
    // 删除文档：仅 owner 可删。删除公开区 docs/d/<id> 与私有区 data/private/<id> 实体 + meta
    const id = decodeURIComponent(urlPath.split('/')[3]);
    const u = currentUser(req);
    try {
      auth.deleteMeta(id, u);
      let removed = [];
      const pub = path.join(SITE_ROOT, 'd', id);
      if (fs.existsSync(pub)) { fs.rmSync(pub, { recursive: true, force: true }); removed.push('d/' + id); }
      const priv = auth.privateDir(id);
      if (fs.existsSync(priv)) { fs.rmSync(priv, { recursive: true, force: true }); removed.push('private/' + id); }
      rebuildSite();
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
  } else {
    serveStatic(req, res);
  }
});

server.listen(Number(PORT), HOST, () => {
  const port = server.address().port;
  // 空卷时从镜像种子填充初始站点内容，再用当前环境变量重建欢迎页
  ensureSeed();
  rebuildSite();
  console.log('chm-web server listening: http://' + HOST + ':' + port);
  console.log('  site root :', SITE_ROOT);
  const lockU = UPLOAD_TOKEN ? 'on' : 'off'; const lockE = EXPORT_TOKEN ? 'on' : 'off';
  console.log('  auth      : upload=' + lockU + '  export=' + lockE + '  (UPLOAD_TOKEN/EXPORT_TOKEN)');
  console.log('  POST /api/register|login|logout  → 账号');
  console.log('  GET  /api/me / /api/docs         → 当前用户 / 可见文档列表（登录后含私有）');
  console.log('  POST /api/upload                 → 上传 .chm 并转换（表单可带 visibility=public|private）');
  console.log('  POST /api/doc/<id>/visibility|share → 改可见性 / 生成分享链接（仅 owner）');
  console.log('  GET  /p/<id>/...                 → 私有文档（仅 owner 或分享链接）');
  console.log('  GET  /s/<token>                  → 分享链接跳转');
  console.log('  GET  /api/export-docs?ids=a,b → 批量导出选中文档为独立裸站 zip');
  console.log('  GET  /site-export.zip     → 下载整站 zip');
  console.log('  直接打开首页: http://localhost:' + port + '/');
});