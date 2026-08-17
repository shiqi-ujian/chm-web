'use strict';
// convert.js — end-to-end: unpack a .chm + build the browseable shell.
const path = require('path');
const fs = require('fs');
const { extractChm, scan } = require('./chm');
const { build } = require('./preview');
const landing = require('./landing');
const { copyDocContent } = require('./sanitize');

async function convert(input, outArg) {
  const abs = path.resolve(input);
  let out = path.resolve(outArg || abs.replace(/\.chm$/i, ''));
  const extracted = await extractChm(abs, out);
  const dir = out;
  const files = scan(dir);

  let hhc = files.hhc.length ? path.join(dir, files.hhc[0]) : null;
  let hhk = files.hhk.length ? path.join(dir, files.hhk[0]) : null;
  const title = path.basename(dir);
  const preview = build({ outDir: dir, hhcFile: hhc, hhkFile: hhk, title });

  return { dir, files, preview, extracted };
}

/**
 * 生成一个“站点”：欢迎页在根 + 文档放在子目录。
 * 站点根目录结构：
 *   <siteRoot>/
 *     index.html        欢迎页（标题 + 上传入口 + 我的文档）
 *     __docs/<name>/    文档转换产物（含各自的 index.html 阅读壳）
 * @param {string} siteRoot 站点输出根目录
 * @param {Array<{name, chmFile}>} docs 要转换的文档
 */
async function buildSite(siteRoot, docs, { title } = {}) {
  const root = path.resolve(siteRoot);
  fs.mkdirSync(root, { recursive: true });
  const docRoot = path.join(root, '__docs');
  const docLinks = [];
  for (const d of docs || []) {
    const id = (d.id || d.name || 'doc').replace(/[^\w\u4e00-\u9fa5-]/g, '_');
    const tmpDir = path.join(docRoot, '.tmp_' + id);
    const outDir = path.join(docRoot, id);
    // 先解到临时目录，再拷贝干净内容到正式子目录（剔除 CHM 内部 #/$ 元数据）
    await convert(d.chmFile, tmpDir);
    copyDocContent(tmpDir, outDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    docLinks.push({ id, name: d.name || id, href: '__docs/' + id + '/' });
  }
  // 欢迎页
  landing.build({ outDir: root, docs: docLinks.map((d) => ({ name: d.name, href: d.href })) });
  return { root, docLinks };
}

module.exports = { convert, buildSite };