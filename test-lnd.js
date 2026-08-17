const l = require('C:/Users/qiujian.shi/Desktop/chm-web/src/lib/landing');
const os = require('os'), path = require('path');
const dir = path.join(os.tmpdir(), 'lnd2');
const o = l.build({ outDir: dir, docs: [{ name: '甲', href: 'x/' }] });
console.log('built -> ' + o.outFile);
