'use strict';
// 重新生成欢迎页(应用 landing.js 源码改动, 含 updateUploadGate)。
// 用法: node rebuild-landing.js
const fs = require('fs');
const path = require('path');
const landing = require('../src/lib/landing');

const SITE = path.resolve(process.env.CHM_SITE || 'docs');

// auth 依赖 better-sqlite3；本地无原生模块时降级为「全部按公开文档」重建。
let auth = null;
try {
  auth = require('../src/lib/auth');
  auth.init(path.resolve(process.env.CHM_DATA || 'data'));
} catch (e) {
  console.warn('[rebuild-landing] sqlite 不可用（' + (e && e.message) + '），按全部公开重建');
}

// 收集公开文档(d/d 下)用于注入 __DOCS_JSON__
const docs = [];
const d = path.join(SITE, 'd');
if (fs.existsSync(d)) {
  for (const n of fs.readdirSync(d)) {
    if (/^[^.].*/.test(n) && fs.statSync(path.join(d, n)).isDirectory()) {
      const meta = auth ? auth.getMeta(n) : null;
      if (meta && meta.visibility === 'private') continue;
      docs.push({ id: n, name: (meta && meta.name) || n, href: 'd/' + n + '/' });
    }
  }
}
landing.build({ outDir: SITE, docs, token: process.env.EXPORT_TOKEN || '', uploadToken: process.env.UPLOAD_TOKEN || '' });
console.log('rebuilt landing for ' + docs.length + ' public docs');