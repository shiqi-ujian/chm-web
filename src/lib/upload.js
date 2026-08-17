'use strict';
// upload.js — 上传→转换→存盘→更新"我的文档"索引 的完整流水线。
// 独立于 http 层，便于测试与将来部署。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractChm } = require('./chm');
const { copyDocContent } = require('./sanitize');

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
 * @param {object} o { siteRoot, uploadedDir, maxBytes }
 * @returns {Promise<{ok:true, id, name, href, url}>}
 */
async function processUpload(buf, origName, o = {}) {
  const siteRoot = path.resolve(o.siteRoot);
  const maxBytes = o.maxBytes || 80 * 1024 * 1024; // 默认 80MB

  // 1. 校验
  if (!origName || !/\.chm$/i.test(origName)) throw new UploadError('请上传 .chm 文件', 400);
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new UploadError('文件为空', 400);
  if (buf.length > maxBytes) throw new UploadError('文件过大（> ' + Math.round(maxBytes / 1048576) + 'MB）', 413);

  // 2. 落盘临时 chm
  const dataDir = path.resolve(o.dataDir || path.join(siteRoot, '..', 'data'));
  const uploadsDir = path.join(dataDir, 'uploads');
  const tmpDir = path.join(dataDir, 'tmp');
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const id = safeId(path.parse(origName).name);
  const tmpChm = path.join(tmpDir, id + '.chm');
  fs.writeFileSync(tmpChm, buf);

  // 3. 转换到正式子目录（解到临时再 sanitize）
  const docDir = path.join(siteRoot, 'd', id);
  try {
    await convertOne(tmpChm, docDir, id, path.parse(origName).name);
  } catch (e) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new UploadError('转换失败：' + (e && e.message || e), 500);
  } finally {
    try { fs.unlinkSync(tmpChm); } catch {}
  }

  return { ok: true, id, name: path.parse(origName).name, href: 'd/' + id + '/', url: '/d/' + id + '/' };
}

/** 单独文档：7z 解到临时 → sanitize 到正式目录，再补生成阅读壳 */
async function convertOne(input, outDir, id, name) {
  const tmp = path.join(path.dirname(outDir), '.tmp_' + id);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  await extractChm(input, tmp);
  copyDocContent(tmp, outDir);
  fs.rmSync(tmp, { recursive: true, force: true });
  // 生成阅读壳 index.html + keywords.json（复用 preview parser）
  try {
    const preview = require('./preview');
    const files = require('fs').readdirSync(outDir);
    const hhc = files.find((f) => /\.hhc$/i.test(f));
    const hhk = files.find((f) => /\.hhk$/i.test(f));
    preview.build({
      outDir: outDir,
      hhcFile: hhc ? path.join(outDir, hhc) : null,
      hhkFile: hhk ? path.join(outDir, hhk) : null,
      title: name || id,
    });
  } catch (e) {
    // 生成不了壳也不至于致命
  }
}

module.exports = { processUpload, UploadError, safeId };