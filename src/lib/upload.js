'use strict';
// upload.js — 上传→转换→存盘→更新"我的文档"索引 的完整流水线。
// 独立于 http 层，便于测试与将来部署。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractChm } = require('./chm');
const { copyDocContent } = require('./sanitize');
const { normalizeCharsets } = require('./charset');

class UploadError extends Error {
  constructor(msg, status) { super(msg); this.status = status || 400; }
}

/**
 * 生成安全文档 id（小写字母数字+中文+短横，最长 40）。
 * 保留中文（文档常以中文命名），剔除其它符号；若剔除后为空则退回 'doc'。
 */
function safeId(seed) {
  let base = String(seed || 'doc')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (!base) base = 'doc';
  const u = crypto.randomBytes(3).toString('hex');
  return base + '-' + u;
}

/**
 * 从上传缓冲区处理一个 .chm：
 * @param {Buffer} buf 上传文件内容
 * @param {string} origName 原始文件名
 * @param {object} o { siteRoot, dataDir, maxBytes, visibility, owner }
 *   visibility: 'public'(默认, 落 siteRoot/d/) | 'private'(落 dataDir/private/, 需 owner)
 *   owner: 登录用户名（private 必需；public 可空=匿名种子文档）
 * @returns {Promise<{ok:true, id, name, visibility, href, url, isPrivate}>}
 */
async function processUpload(buf, origName, o = {}) {
  const siteRoot = path.resolve(o.siteRoot);
  const dataDir = path.resolve(o.dataDir || path.join(siteRoot, '..', 'data'));
  const maxBytes = o.maxBytes || 80 * 1024 * 1024; // 默认 80MB
  const visibility = o.visibility === 'private' ? 'private' : 'public';
  const owner = o.owner || null;

  // 1. 校验
  if (!origName || !/\.chm$/i.test(origName)) throw new UploadError('请上传 .chm 文件', 400);
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new UploadError('文件为空', 400);
  if (buf.length > maxBytes) throw new UploadError('文件过大（> ' + Math.round(maxBytes / 1048576) + 'MB）', 413);
  if (visibility === 'private' && !owner) throw new UploadError('私密文档需要先登录', 401);

  // 2. 落盘临时 chm
  const uploadsDir = path.join(dataDir, 'uploads');
  const tmpDir = path.join(dataDir, 'tmp');
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const id = safeId(path.parse(origName).name);
  const tmpChm = path.join(tmpDir, id + '.chm');
  fs.writeFileSync(tmpChm, buf);

  // 3. 转换到正式子目录（解到临时再 sanitize）
  //    公开 → 静态产物 siteRoot/d/<id>（可被静态托管直接发布）
  //    私有 → 数据区 dataDir/private/<id>（绝不落入公开静态产物，仅后端 ACL serve）
  const docDir = visibility === 'private'
    ? path.join(dataDir, 'private', id)
    : path.join(siteRoot, 'd', id);
  try {
    await convertOne(tmpChm, docDir, id, path.parse(origName).name, o);
  } catch (e) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new UploadError('转换失败：' + (e && e.message || e), 500);
  } finally {
    try { fs.unlinkSync(tmpChm); } catch {}
  }

  // 4. 登记元数据（归属 + 可见性）
  try {
    const auth = require('./auth');
    auth.ensureMeta(id, { owner, name: path.parse(origName).name, visibility });
  } catch (e) { console.error('meta write failed', e); }

  const isPrivate = visibility === 'private';
  return {
    ok: true, id, name: path.parse(origName).name, visibility,
    href: (isPrivate ? 'p/' : 'd/') + id + '/',
    url: (isPrivate ? '/p/' : '/d/') + id + '/',
    isPrivate,
  };
}

/** 单独文档：7z 解到临时 → sanitize 到正式目录，再补生成阅读壳 */
async function convertOne(input, outDir, id, name, o = {}) {
  const tmp = path.join(path.dirname(outDir), '.tmp_' + id);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  // extractChm 已改为异步 spawn + 超时（失败自动清理 tmp）
  await extractChm(input, tmp, { timeoutMs: (o && o.timeoutMs) || 120 * 1000 });
  copyDocContent(tmp, outDir);
  fs.rmSync(tmp, { recursive: true, force: true });
  // 统一转 UTF-8：修复 GBK 页面 + 非法 <meta content="...charset=..."> 声明导致的整页乱码
  try { normalizeCharsets(outDir); } catch (e) { console.error('normalizeCharsets failed', e); }
  // 修复链接大小写与实际文件不一致（Linux 严格区分大小写）
  try { require('./fixlinks').fixLinks(outDir); } catch (e) { console.error('fixlinks failed', e); }
  // 生成阅读壳 index.html + keywords.json（复用 preview parser）
  try { rebuildDocShell(outDir, id, name, o); } catch (e) {
    // 生成不了壳也不至于致命
  }
}

/**
 * 重建单个文档阅读壳（公开或私有统一入口）。
 * 私有文档挂在 /p/<id>/ 下，TOC/首页/章节 URL 必须带绝对前缀，否则 iframe
 * 会去请求 /start.htm 等公开静态路径 → 404 Not Found。
 * 启动修复存量私有文档时也会调用本函数。
 */
function rebuildDocShell(docDir, docId, title, o = {}) {
  const outDir = path.resolve(docDir);
  const files = fs.readdirSync(outDir);
  const hhc = files.find((f) => /\.hhc$/i.test(f));
  const hhk = files.find((f) => /\.hhk$/i.test(f));
  const isPrivate = o.visibility === 'private';
  const preview = require('./preview');
  preview.build({
    outDir,
    hhcFile: hhc ? path.join(outDir, hhc) : null,
    hhkFile: hhk ? path.join(outDir, hhk) : null,
    title: title || docId,
    urlPrefix: isPrivate ? ('p/' + docId + '/') : '',
    // 壳重建（转私有/公开、启动修复）不动索引（索引内容与前缀无关）；
    // 首次上传（convertOne 未传 skipIndexes）才需要全量建索引
    skipIndexes: o.skipIndexes === true,
  });
  return { docId, title: title || docId, hhc: hhc || null, hhk: hhk || null };
}

/**
 * 扫描并重建全部存量私有文档阅读壳（启动自愈）：
 * - 修复旧壳 URL 前缀缺失（无 /p/<id>/ 前缀 → 正文 iframe 404）
 * - 升级旧壳 JS（无惰性渲染 ensureKids → 大文档目录树全展开卡死）
 * 已是新壳（绝对前缀 + 惰性渲染）跳过（省 IO）。
 */
function rebuildPrivateShells({ dataDir }) {
  const privRoot = path.join(path.resolve(dataDir), 'private');
  if (!fs.existsSync(privRoot)) return { rebuilt: 0, skipped: 0 };
  const out = [];
  let rebuilt = 0, skipped = 0;
  for (const n of fs.readdirSync(privRoot)) {
    if (!/^[^.].*/.test(n)) continue;
    const dir = path.join(privRoot, n);
    let st;
    try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    try {
      const shell = path.join(dir, 'index.html');
      const content = fs.existsSync(shell) ? fs.readFileSync(shell, 'utf8') : '';
      if (content.indexOf('/p/' + n + '/') !== -1 && content.indexOf('ensureKids') !== -1) { skipped++; continue; }
      rebuildDocShell(dir, n, n, { visibility: 'private', skipIndexes: true });
      rebuilt++;
      out.push(n);
    } catch (e) {
      console.error('rebuild private shell failed:', n, e && e.message || e);
    }
  }
  if (rebuilt) console.log(`[private-shell] rebuilt ${rebuilt} private doc shell(s): ${out.join(', ')}`);
  return { rebuilt, skipped };
}

/** 扫描并升级存量公开文档阅读壳（旧 JS 全展开 → 惰性渲染），大文档目录树不再卡浏览器 */
function rebuildStalePublicShells({ siteRoot }) {
  const pubRoot = path.join(path.resolve(siteRoot), 'd');
  if (!fs.existsSync(pubRoot)) return { rebuilt: 0, skipped: 0 };
  const out = [];
  let rebuilt = 0, skipped = 0;
  for (const n of fs.readdirSync(pubRoot)) {
    if (!/^[^.].*/.test(n)) continue;
    const dir = path.join(pubRoot, n);
    let st;
    try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    try {
      const shell = path.join(dir, 'index.html');
      const content = fs.existsSync(shell) ? fs.readFileSync(shell, 'utf8') : '';
      if (content.indexOf('ensureKids') !== -1) { skipped++; continue; }
      rebuildDocShell(dir, n, n, { visibility: 'public', skipIndexes: true });
      rebuilt++;
      out.push(n);
    } catch (e) {
      console.error('rebuild public shell failed:', n, e && e.message || e);
    }
  }
  if (rebuilt) console.log(`[public-shell] upgraded ${rebuilt} public doc shell(s): ${out.join(', ')}`);
  return { rebuilt, skipped };
}

/**
 * 清理遗留的临时文件/目录（崩溃或超时残留）：data/tmp 内容、
 * 各文档目录下的 `.tmp_*` 半成品、以及 uploads 里过期的临时 .chm。
 */
function cleanupTmp({ dataDir, siteRoot, ageMs = 24 * 60 * 60 * 1000 } = {}) {
  const now = Date.now();
  const roots = [path.join(dataDir, 'tmp'), path.join(dataDir, 'uploads')];
  for (const r of roots) {
    try {
      const entries = fs.readdirSync(r, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(r, e.name);
        let s;
        try { s = fs.statSync(full); } catch { continue; }
        if (now - s.mtimeMs < ageMs) continue;
        try { fs.rmSync(full, { recursive: true, force: true }); } catch {}
      }
    } catch {}
  }
  // 站点文档目录下的 .tmp_<id> 半成品
  const dDir = path.join(siteRoot, 'd');
  try {
    for (const e of fs.readdirSync(dDir, { withFileTypes: true })) {
      if (e.isDirectory() && /^\.tmp_/.test(e.name)) {
        const full = path.join(dDir, e.name);
        let s; try { s = fs.statSync(full); } catch { continue; }
        if (now - s.mtimeMs >= ageMs) { try { fs.rmSync(full, { recursive: true, force: true }); } catch {} }
      }
    }
  } catch {}
}

module.exports = { processUpload, UploadError, safeId, cleanupTmp, rebuildDocShell, rebuildPrivateShells, rebuildStalePublicShells };