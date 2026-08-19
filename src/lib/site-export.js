'use strict';
// site-export.js — export the whole site (the docs/ root) as a self-contained
// deployable static website packed into a single ZIP, with a manifest.json.
// Pure Node, no deps: relies on ./zip (dependency-free ZIP writer).
const fs = require('fs');
const path = require('path');
const { zip } = require('./zip');

// Files/dirs we exclude from the export (private stuff, metadata).
const EXCLUDED = new Set([
  '.git', 'data', 'logs', 'out', 'samples', 'node_modules',
  '_index.json', '.DS_Store', 'Thumbs.db',
]);

/**
 * Collect all files under siteRoot into a flat list with relative names
 * (zip entries use '/'; we skip excluded roots).
 */
function collectFiles(siteRoot) {
  const out = [];
  const skipRoots = (name) => EXCLUDED.has(name);
  (function walk(dir, rel) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (rel === '' && skipRoots(e.name)) continue;
      if (e.name === '.git') continue; // never ship .git
      const full = path.join(dir, e.name);
      const relName = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(full, relName);
      else if (e.isFile()) {
        let size = 0;
        try { size = fs.statSync(full).size; } catch (_) {}
        out.push({ name: relName, full, size });
      }
    }
  })(siteRoot, '');
  return out;
}

/**
 * Export `siteRoot` into a zip Buffer. Also injects a generated manifest.json
 * describing the package.
 * @param {object} o { siteRoot, title?, date? }
 * @returns {Buffer} the zip
 */
function exportSite({ siteRoot, title, date }) {
  const root = path.resolve(siteRoot);
  const stamp = date ? new Date(date) : new Date();

  const docIds = listPublicDocIds(root);

  const manifest = {
    app: 'chm-web',
    title: title || 'CHM 网页导出站点',
    createdAt: stamp.toISOString(),
    docs: docIds,
    fileCount: 0,
    totalBytes: 0,
  };

  const filesList = collectFiles(root);
  const entries = filesList.map((f) => {
    manifest.fileCount += 1;
    manifest.totalBytes += f.size;
    return { name: f.name, data: fs.readFileSync(path.join(root, f.name)) };
  });
  // manifest goes first so a reader can inspect it easily
  entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) });

  return { zip: zip(entries), manifest };
}

/**
 * 列出单个文档子目录 d/<id> 下的相对文件列表（zip 条目名前缀 d/<id>/）。
 */
function listDocFiles(root, id) {
  return listFilesUnder(path.join(root, 'd', id), 'd/' + id);
}

/** 以指定 rel 前缀列出一个目录下的全部文件（dir 为真实目录；不存在返回空）。 */
function listFilesUnder(dir, relPrefix) {
  if (!fs.existsSync(dir)) return [];
  return collectFiles(dir).map((f) => ({
    name: relPrefix + '/' + f.name.replace(/\\/g, '/'),
    full: f.full,
    size: f.size,
  }));
}

/** 列出站点公开文档 id（siteRoot/d 下的目录）。 */
function listPublicDocIds(root) {
  const d = path.join(root, 'd');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d)
    .filter((n) => /^[^.].*/.test(n))
    .filter((n) => { try { return fs.statSync(path.join(d, n)).isDirectory(); } catch { return false; } })
    .sort();
}

/**
 * Export a *selection* of documents as a self-contained standalone static site
 * — its own welcome page + site-index.json covering only the chosen docs —
 * packed into one deployable ZIP. An empty id list means "export everything".
 * @param {object} o { siteRoot, ids:Array<string>, title?, date? }
 * @returns {{ zip: Buffer, manifest: object }}
 */
function exportDocs({ siteRoot, ids, title, date }) {
  const root = path.resolve(siteRoot);
  const stamp = date ? new Date(date) : new Date();

  // 所有可用文档 id（d/ 下目录，剔除 . 开头隐藏物）
  const all = listPublicDocIds(root);

  // 选中集合：取交集；空则不选 = 全选
  const want = new Set((ids || []).filter((i) => all.includes(i)));
  const selected = (want.size ? all.filter((i) => want.has(i)) : all) || [];

  const manifest = {
    app: 'chm-web',
    kind: 'doc-selection',
    title: title || 'CHM 网页文档导出',
    createdAt: stamp.toISOString(),
    docs: selected,
    fileCount: 0,
    totalBytes: 0,
  };

  const entries = [];
  // 每个选中文档的产物，zip 内路径保持 d/<id>/... 与源站点一致
  for (const id of selected) {
    for (const f of listDocFiles(root, id)) {
      manifest.fileCount += 1;
      manifest.totalBytes += f.size;
      entries.push({ name: f.name, data: fs.readFileSync(f.full) });
    }
  }

  // 为选中子集生成独立欢迎页 + 聚合检索索引（只含选中文档）—— 复用 landing 的模板
  const landing = require('./landing');
  const docs = selected.map((id) => ({ id, name: id, href: 'd/' + id + '/' }));
  const htmlText = landing.LANDING_HTML.replace('__DOCS_JSON__', JSON.stringify(docs));
  entries.push({ name: 'index.html', data: Buffer.from(htmlText, 'utf8') });
  manifest.fileCount += 1; manifest.totalBytes += Buffer.byteLength(htmlText);

  const siteIdxJson = aggregateSiteIndex(root, selected);
  entries.push({ name: 'site-index.json', data: Buffer.from(JSON.stringify(siteIdxJson), 'utf8') });
  manifest.fileCount += 1; manifest.totalBytes += Buffer.byteLength(JSON.stringify(siteIdxJson));

  entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') });

  return { zip: zip(entries), manifest };
}

/**
 * Export a set of *directory paths* as a self-contained static docs package.
 * Reuses exportDocs when the paths are regular public site docs under siteRoot/d,
 * and falls back to a manual "docs/…" zip for any other directory (e.g. private).
 * @param {object} o { siteRoot, dataDir?, dirs:Array<string>, title?, date? }
 * @returns {{ zip: Buffer, manifest: object }}
 */
function exportDocDirs({ siteRoot, dataDir, dirs, title, date }) {
  const root = path.resolve(siteRoot);
  const stamp = date ? new Date(date) : new Date();

  // 规范化输入：支持 [{dir, rel, name}] 或相对路径字符串
  const rels = [];
  for (const dir of dirs || []) {
    if (typeof dir === 'string') rels.push({ dir, rel: dir, name: basename(dir) });
    else if (dir && dir.dir) {
      const rel = dir.rel || path.relative(root, path.resolve(dir.dir)).replace(/\\/g, '/');
      rels.push({ dir: path.resolve(dir.dir), rel, name: dir.name || basename(dir.dir) });
    }
  }
  // 去重并过滤不存在的目录
  const seen = new Set();
  const valid = rels.filter((r) => {
    if (!r.dir || seen.has(r.rel)) return false;
    try { if (!fs.statSync(r.dir).isDirectory()) return false; } catch { return false; }
    seen.add(r.rel);
    return true;
  });

  const manifest = {
    app: 'chm-web',
    kind: 'doc-dirs-export',
    title: title || 'CHM 网页文档导出',
    createdAt: stamp.toISOString(),
    docs: valid.map((r) => r.rel),
    fileCount: 0,
    totalBytes: 0,
  };

  const entries = [];
  for (const r of valid) {
    for (const f of listFilesUnder(r.dir, r.rel)) {
      manifest.fileCount += 1;
      manifest.totalBytes += f.size;
      entries.push({ name: f.name, data: fs.readFileSync(f.full) });
    }
  }

  // 提供一个简单的入口页，列出目录层级
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || 'CHM 网页导出')}</title></head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#f3f5f7;color:#1f2937">
<div style="max-width:720px;margin:40px auto;padding:0 16px">
<h1>${escapeHtml(title || 'CHM 网页文档导出')}</h1>
<p style="color:#6b7280">共 ${valid.length} 个目录</p>
<ul>${valid.map((r) => `<li><a href="${escapeAttr(r.rel + '/index.html')}">${escapeHtml(r.name || r.rel)}</a></li>`).join('')}</ul>
</div></body></html>`;
  const htmlBuf = Buffer.from(html, 'utf8');
  entries.push({ name: 'index.html', data: htmlBuf });
  manifest.fileCount += 1; manifest.totalBytes += htmlBuf.length;

  entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') });
  return { zip: zip(entries), manifest };
}

/** 简单的 HTML 转义（导出入口页用） */
function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const escapeHtml = escHtml;
const escapeAttr = escHtml;

function basename(p) {
  const s = String(p || '').replace(/\\/g, '/');
  return s.slice(s.lastIndexOf('/') + 1);
}

/** 聚合一批文档的关键词 + 全文检索记录，生成选中子集的 site-index.json 结构 */
function aggregateSiteIndex(root, selected) {
  const keywords = [];
  const records = [];
  for (const id of selected) {
    const docRoot = path.join(root, 'd', id);
    keywords.push({ name: id, href: 'd/' + id + '/', doc: id });
    try {
      const kw = fs.existsSync(path.join(docRoot, 'keywords.json'))
        ? JSON.parse(fs.readFileSync(path.join(docRoot, 'keywords.json'), 'utf8')) : null;
      ((kw && kw.keywords) || []).forEach((k) =>
        keywords.push({ name: k.name, href: 'd/' + id + '/' + (k.href || '').replace(/\\/g, '/'), doc: id }));
    } catch (_) {}
    try {
      const idx = fs.existsSync(path.join(docRoot, 'search-index.json'))
        ? JSON.parse(fs.readFileSync(path.join(docRoot, 'search-index.json'), 'utf8')) : null;
      ((idx && idx.records) || []).forEach((r) => {
        if (r && r.text) records.push({ doc: id, text: r.text.slice(0, 4000) });
      });
    } catch (_) {}
  }
  return { keywords, records };
}

module.exports = { exportSite, collectFiles, listDocFiles, listFilesUnder, listPublicDocIds, exportDocs, exportDocDirs, aggregateSiteIndex };