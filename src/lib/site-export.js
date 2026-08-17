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

  const docIds = [];
  const d = path.join(root, 'd');
  if (fs.existsSync(d)) {
    docIds.push(...fs.readdirSync(d)
      .filter((n) => { try { return fs.statSync(path.join(d, n)).isDirectory(); } catch { return false; } })
      .sort());
  }

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

module.exports = { exportSite, collectFiles };