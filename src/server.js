'use strict';
// server.js — 真正的后端：静态站点托管 + POST /api/upload 上传转换。
// 本机即可起服务验证闭环；将来部署到公网改绑 0.0.0.0 并配 HTTPS/域名即可。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { processUpload, UploadError } = require('./lib/upload');

// 站点根（含欢迎页 index.html 和 d/ 文档目录）。默认本项目 docs/。
const SITE_ROOT = path.resolve(process.env.CHM_SITE || path.join(__dirname, '..', 'docs'));
const DATA_DIR = path.resolve(process.env.CHM_DATA || path.join(__dirname, '..', 'data'));
const PORT = Number(process.env.PORT) || 8080;
const MAX_BYTES = 80 * 1024 * 1024;

const MIME = {
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
  '.txt': 'text/plain', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

/************ 简易 multipart 解析（只取首个文件字段 file） ************/
function parseMultipart(buf, boundary) {
  if (!boundary || buf.length === 0) return null;
  const b = Buffer.from('--' + boundary);
  // 定位第一个文件域的 header 与正文起点
  const headEnd = buf.indexOf(Buffer.from('\r\n\r\n'));
  if (headEnd === -1) return null;
  const header = buf.slice(0, headEnd).toString('latin1');
  const nameMatch = /name="([^"]+)"/.exec(header);
  const filenameMatch = /filename="([^"]*)"/.exec(header);
  // body 起点
  const dataStart = headEnd + 4;
  // 找下一个 \r\n--boundary 结束
  const closing = Buffer.from('\r\n--' + boundary);
  const bodyEnd = buf.indexOf(closing, dataStart);
  const len = bodyEnd === -1 ? buf.length - dataStart : bodyEnd - dataStart;
  return {
    field: nameMatch ? nameMatch[1] : null,
    filename: filenameMatch ? filenameMatch[1] : null,
    data: buf.slice(dataStart, dataStart + len),
  };
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
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
  const file = parseMultipart(buf, boundary);
  if (!file || !file.filename || !file.data) { sendJSON(res, 400, { ok: false, error: '未收到文件' }); return; }

  try {
    const r = await processUpload(file.data, file.filename, { siteRoot: SITE_ROOT, dataDir: DATA_DIR, maxBytes: MAX_BYTES });
    // 更新"我的文档"索引（docs/_index.json）
    fs.writeFileSync(path.join(SITE_ROOT, '_index.json'), JSON.stringify(listDocs(), null, 2));
    sendJSON(res, 200, { ok: true, ...r });
  } catch (e) {
    if (e instanceof UploadError) sendJSON(res, e.status || 400, { ok: false, error: e.message });
    else { console.error(e); sendJSON(res, 500, { ok: false, error: '服务器错误：' + (e.message || e) }); }
  }
}

/** 列出站点 d/ 下所有已发布文档 */
function listDocs() {
  const d = path.join(SITE_ROOT, 'd');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d)
    .filter((n) => /^[^.].*/.test(n) && fs.statSync(path.join(d, n)).isDirectory())
    .map((id) => ({ id, name: id, href: 'd/' + id + '/', url: '/d/' + id + '/' , updated: fs.statSync(path.join(d, id)).mtimeMs }));
}

const server = http.createServer((req, res) => {
  const urlPath = (new URL(req.url, 'http://x')).pathname;
  if (req.method === 'POST' && urlPath === '/api/upload') {
    handleUpload(req, res);
  } else if (req.method === 'GET' && urlPath === '/api/docs') {
    sendJSON(res, 200, { docs: listDocs() });
  } else {
    serveStatic(req, res);
  }
});

server.listen(Number(PORT), () => {
  const port = server.address().port;
  console.log('chm-web server listening: http://localhost:' + port);
  console.log('  site root :', SITE_ROOT);
  console.log('  POST /api/upload  → 上传 .chm 并转换');
  console.log('  GET  /api/docs    → 已发布文档列表');
  console.log('  直接打开首页: http://localhost:' + port + '/');
});