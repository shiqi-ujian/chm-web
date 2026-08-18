'use strict';
// 重建所有文档的阅读壳 index.html（让首页🏠返回按钮等在已生成产物上生效）。
// 用法: node rebuild-shells.js
const fs = require('fs');
const path = require('path');
const preview = require('./src/lib/preview');

const roots = [path.resolve('docs/d'), path.resolve('data/private')];
let count = 0;
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    let hhcFile = null, hhkFile = null;
    for (const f of fs.readdirSync(dir)) {
      if (/\.hhc$/i.test(f)) hhcFile = path.join(dir, f);
      else if (/\.hhk$/i.test(f)) hhkFile = path.join(dir, f);
    }
    try {
      const r = preview.build({ outDir: dir, hhcFile, hhkFile, title: entry.name });
      console.log('rebuilt ' + entry.name + ' -> home=' + r.homeHref);
      count++;
    } catch (e) { console.error('failed ' + entry.name + ': ' + e.message); }
  }
}
console.log('rebuilt ' + count + ' doc shells');