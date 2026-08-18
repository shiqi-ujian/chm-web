'use strict';
// rebuild-docs.js — regenerate shell + indexes for every doc under docs/d (idempotent).
const fs = require('fs');
const path = require('path');
const preview = require('./src/lib/preview');
const landing = require('./src/lib/landing');

const root = path.join(__dirname, 'docs', 'd');
const ids = fs.readdirSync(root).filter((n) => {
  try { return fs.statSync(path.join(root, n)).isDirectory(); } catch { return false; }
});
const docLinks = [];
for (const id of ids) {
  const dir = path.join(root, id);
  const files = fs.readdirSync(dir);
  const hhc = files.find((f) => /\.hhc$/i.test(f));
  const hhk = files.find((f) => /\.hhk$/i.test(f));
  try {
    preview.build({
      outDir: dir,
      hhcFile: hhc ? path.join(dir, hhc) : null,
      hhkFile: hhk ? path.join(dir, hhk) : null,
      title: id,
    });
    docLinks.push({ id, name: id, href: 'd/' + id + '/' });
    console.log('rebuilt ' + id + ' -> search-index=' + fs.existsSync(path.join(dir, 'search-index.json')));
  } catch (e) {
    console.log('ERR ' + id + ' -> ' + (e && e.message));
  }
}
// 重建欢迎页 + 全站聚合检索索引
landing.build({ outDir: path.join(__dirname, 'docs'), docs: docLinks });
console.log('rebuilt landing + site-index.json = ' + fs.existsSync(path.join(__dirname, 'docs', 'site-index.json')));