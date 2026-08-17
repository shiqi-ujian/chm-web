'use strict';
const { buildSite } = require('./src/lib/convert');
const path = require('path');

const siteRoot = path.resolve(process.argv[2]);
buildSite(siteRoot, [{ id: '7z-demo', name: '7-Zip 帮助手册（演示）', chmFile: 'C:/Program Files/7-Zip/7-zip.chm' }], { title: 'CHM 网页' })
  .then((r) => { console.log('OK', r.root); process.exit(0); })
  .catch((e) => { console.error('ERR', e.stack); process.exit(1); });