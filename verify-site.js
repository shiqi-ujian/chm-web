'use strict';
const { buildSite } = require('./src/lib/convert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const siteRoot = path.join(os.tmpdir(), 'chm-site-final');
const chm = 'C:/Program Files/7-Zip/7-zip.chm';
fs.rmSync(siteRoot, { recursive: true, force: true });

buildSite(siteRoot, [{ id: '7z-demo', name: '7-Zip 帮助手册（演示）', chmFile: chm }], { title: 'CHM 网页' })
  .then((r) => {
    console.log('site root:', r.root);
    console.log('doc links:', JSON.stringify(r.docLinks));
    // 校验欢迎页
    const idx = path.join(siteRoot, 'index.html');
    const html = fs.readFileSync(idx, 'utf8');
    const js = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
    try { new Function(js); console.log('WELCOME_JS_OK'); } catch (e) { console.log('WELCOME_JS_FAIL ' + e.message); }
    console.log('welcome has docs link:', html.includes('__docs/7z-demo'));
    console.log('doc index.html exists:', fs.existsSync(path.join(siteRoot, '__docs/7z-demo/index.html')));
    process.exit(0);
  })
  .catch((e) => { console.error('ERR', e.stack); process.exit(1); });