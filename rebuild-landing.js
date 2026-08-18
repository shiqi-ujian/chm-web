'use strict';
// 重新生成欢迎页(应用 landing.js 源码改动, 含 updateUploadGate)。
// 用法: node rebuild-landing.js
const fs = require('fs');
const path = require('path');
const landing = require('./src/lib/landing');
const auth = require('./src/lib/auth');

const SITE = path.resolve(process.env.CHM_SITE || 'docs');
auth.init(path.resolve(process.env.CHM_DATA || 'data'));

// 收集公开文档(d/d 下)用于注入 __DOCS_JSON__
const docs = [];
const d = path.join(SITE, 'd');
if (fs.existsSync(d)) {
  for (const n of fs.readdirSync(d)) {
    if (/^[^.].*/.test(n) && fs.statSync(path.join(d, n)).isDirectory()) {
      const meta = auth.getMeta(n);
      if (meta && meta.visibility === 'private') continue;
      docs.push({ id: n, name: (meta && meta.name) || n, href: 'd/' + n + '/' });
    }
  }
}
landing.build({ outDir: SITE, docs, token: process.env.EXPORT_TOKEN || '', uploadToken: process.env.UPLOAD_TOKEN || '' });
console.log('rebuilt landing for ' + docs.length + ' public docs');