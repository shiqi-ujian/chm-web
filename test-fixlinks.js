'use strict';
// test-fixlinks.js — 链接大小写规范化自测：
//   scanDirMap / fixRel(含 ../ 解析) / fixLinks 端到端（临时目录）。
const path = require('path');
const fs = require('fs');
const os = require('os');
const { scanDirMap, fixRel, fixLinks } = require('./src/lib/fixlinks');

function log(s) { console.log('  ' + s); }
let pass = true;
const ok = (name, cond, extra) => { log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (extra ? '  [' + extra + ']' : '')); if (!cond) pass = false; };

// 1) 映射：小写 → 实际
const map = scanDirMap(path.join(__dirname, 'docs', 'd', '7-zip'));
ok('map has fm/menu.htm (lowercase key)', !!map['fm/menu.htm'], 'actual=' + map['fm/menu.htm']);
ok('map resolves case (Menu → menu)', map['fm/menu.htm'] === 'fm/menu.htm');

// 2) fixRel：无前缀大小写修复
const fixed1 = fixRel('', 'fm/Menu.htm', map);
ok('fixRel case-fix no prefix (fm/Menu.htm → fm/menu.htm)', fixed1 === 'fm/menu.htm', fixed1);
const fixed2 = fixRel('', 'GENERAL/7Z.HTM', map);
ok('fixRel multi-seg case-fix (GENERAL/7Z.HTM → general/7z.htm)', fixed2 === 'general/7z.htm', fixed2);
ok('fixRel keeps query/hash', fixRel('', 'fm/Menu.htm#sec', map) === 'fm/menu.htm#sec');
// 3) fixRel：../ 前缀解析后大小写修复
const fixed3 = fixRel('cmdline/commands', '../Switches/BB.htm', map);
ok('fixRel ../ case-fix (cmdline/commands → ../switches/bb.htm)', fixed3 === '../switches/bb.htm', fixed3);
ok('fixRel ../ no-change when correct', fixRel('cmdline/commands', '../switches/bb.htm', map) === '../switches/bb.htm');
// 4) 外链不动
ok('fixRel external untouched', fixRel('', 'https://x.com/a.htm', map) === 'https://x.com/a.htm');

// 5) 端到端：临时目录里造一个大小写错误的链接，fixLinks 修好
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chm-fixlinks-'));
try {
  fs.mkdirSync(path.join(tmp, 'fm'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'fm', 'menu.htm'), '<html><body>menu</body></html>');
  fs.writeFileSync(path.join(tmp, 'index.html'), '');
  fs.writeFileSync(path.join(tmp, '7zip.hhc'),
    '<html><body><param name="Local" value="fm/Menu.htm"><a href="FM/MENU.HTM">x</a></body></html>');
  const r = fixLinks(tmp);
  ok('fixLinks reports fixed files', r.fixedFiles >= 1, 'fixed=' + r.fixedFiles);
  const hhc = fs.readFileSync(path.join(tmp, '7zip.hhc'), 'utf8');
  ok('hhc Local case fixed', hhc.includes('fm/menu.htm'), hhc.match(/Local" value="([^"]+)"/)?.[1] || '');
  ok('hhc href case fixed', hhc.includes('FM/MENU.HTM') === false && hhc.includes('href="fm/menu.htm"'));
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}

console.log(pass ? 'FIXLINKS_TEST_PASS' : 'FIXLINKS_TEST_FAIL');
process.exit(pass ? 0 : 1);
