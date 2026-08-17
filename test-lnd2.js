const l = require('C:/Users/qiujian.shi/Desktop/chm-web/src/lib/landing');
const os=require('os'),p=require('path');
const d=p.join(os.tmpdir(),'lnd4');
const o=l.build({outDir:d,docs:[{name:'示例',href:'x/'}]});
const fs=require('fs');
const h=fs.readFileSync(p.join(d,'index.html'),'utf8');
const m=h.match(/var DOCS = ([^;]+);/);
console.log('DOCS line: [' + (m?m[1]:'NO MATCH') + ']');
