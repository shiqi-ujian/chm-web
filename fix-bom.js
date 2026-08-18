'use strict';
// 去除 data/ 各 JSON 的 UTF-8 BOM（BOM 会导致 auth 首键解析异常，如 meta 读不到）。
const fs = require('fs');
const path = require('path');
for (const f of ['meta.json', 'users.json', 'sessions.json']) {
  const p = path.join('data', f);
  if (!fs.existsSync(p)) continue;
  let t = fs.readFileSync(p, 'utf8');
  t = t.replace(/^\uFEFF/, '');
  fs.writeFileSync(p, t, 'utf8');
  const b = fs.readFileSync(p);
  const bom = b[0] === 0xEF;
  console.log(f + ' len=' + b.length + ' BOM=' + bom);
}
// 验证 auth 能读到
const auth = require('./src/lib/auth');
auth.init(path.resolve('data'));
console.log('vba meta:', JSON.stringify(auth.getMeta('vba_cn-c9e3ab')));
console.log('pywin meta:', JSON.stringify(auth.getMeta('pywin32_cn-fcc243')));