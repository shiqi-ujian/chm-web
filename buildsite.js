'use strict';
const path = require('path');
const fs = require('fs');
const { buildSite } = require('./src/lib/convert');

(async () => {
  try {
    const r = await buildSite('C:/Users/qiujian.shi/Desktop/chm-web/docs', [
      { id: '7z-demo', name: '7-Zip 帮助手册（演示）', chmFile: 'C:/Program Files/7-Zip/7-zip.chm' }
    ]);
    fs.writeFileSync(path.join(process.env.TEMP, 'buildsite-out.txt'), 'OK links=' + JSON.stringify(r.docLinks) + '\nsite=' + r.root + '\n');
  } catch (e) {
    fs.writeFileSync(path.join(process.env.TEMP, 'buildsite-out.txt'), 'FAIL\n' + (e.stack || String(e)) + '\n');
  }
  process.exit(0);
})();