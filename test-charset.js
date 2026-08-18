'use strict';
// test-charset.js — 回归测试：中文 CHM 的字符集自动检测（GBK/GB2312）与
// 目录/索引 href 归一化（相对路径、mk: 链接、外部协议、反斜杠）。
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const { decode } = require('./src/lib/charset');
const { parseHhcFile, resolveHref } = require('./src/lib/hhc');

let pass = true;
const ok = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) pass = false; };

// ---- charset ----
const gbkBuf = Buffer.from([0xD7, 0xA8, 0xC0, 0xB8, 0xCB, 0xB5, 0xC3, 0xF7]); // GBK: 专栏说明
ok('charset GBK bytes -> 中文', decode(gbkBuf) === '专栏说明');
const gbkHtml = Buffer.concat([Buffer.from('<html><head><meta charset=gb2312></head><body>'), gbkBuf, Buffer.from('</body></html>')]);
ok('charset meta gb2312 声明生效', decode(gbkHtml).includes('专栏说明'));
ok('charset UTF-8 原样通过', decode(Buffer.from('<p>规则 test</p>', 'utf8')) === '<p>规则 test</p>');
ok('charset UTF-8 BOM 剥除', decode(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('规则', 'utf8')])) === '规则');

// ---- resolveHref ----
ok('href 文档相对路径', resolveHref('专栏/5z说明.htm', '/app/x') === '专栏/5z说明.htm');
ok('href 根相对路径', resolveHref('/专栏/x.htm', '/app/x') === '专栏/x.htm');
ok('href 反斜杠', resolveHref('专栏\\5z说明.htm', '/app/x') === '专栏/5z说明.htm');
ok('href mk: 链接', resolveHref('mk:@MSITStore:5z规则1.59版.chm::/general/start.htm', '/app/x') === 'general/start.htm');
ok('href 外部协议原样', resolveHref('http://example.com/a.htm', '/app/x') === 'http://example.com/a.htm');
ok('href 归一化 ../', resolveHref('a/../general/x.htm', '/app/x') === 'general/x.htm');

// ---- parseHhcFile 端到端（UTF-8 文件；GBK 路径由 charset 单测覆盖） ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chm-test-'));
const hhc = [
  '<HTML><HEAD><TITLE>t</TITLE></HEAD><BODY><UL>',
  '<LI><OBJECT type="text/sitemap"><param name="Name" value="专栏说明"><param name="Local" value="专栏/5z说明.htm"></OBJECT>',
  '<LI><OBJECT type="text/sitemap"><param name="Name" value="intro"><param name="Local" value="start.htm"></OBJECT>',
  '</UL></BODY></HTML>',
].join('\n');
fs.writeFileSync(path.join(tmp, 'toc.hhc'), hhc, 'utf8');
const tree = parseHhcFile(path.join(tmp, 'toc.hhc'), tmp);
ok('parseHhcFile 节点数', tree.length === 2);
ok('parseHhcFile 中文名', tree[0].name === '专栏说明');
ok('parseHhcFile 相对 href', tree[0].href === '专栏/5z说明.htm' && tree[1].href === 'start.htm');
fs.rmSync(tmp, { recursive: true, force: true });

// ---- normalizeCharsets：GBK 页面 + 非法 <meta content="...charset=gb2312"> 修复 ----
const { normalizeCharsets, sniffFileCharset } = require('./src/lib/charset');
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'chm-norm-'));
// GBK 编码的 "地下城主指南"（B5D8 CFC2 B3C7 D6F7 D6B8 C4CF，与真实 Credits.htm 头部一致）
const normTitle = [0xB5, 0xD8, 0xCF, 0xC2, 0xB3, 0xC7, 0xD6, 0xF7, 0xD6, 0xB8, 0xC4, 0xCF];
const normBuf = Buffer.from([
  0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0x3c, 0x68, 0x65, 0x61, 0x64, 0x3e, 0x3c, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x3e,
  ...normTitle,
  0x3c, 0x2f, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x3e,
  0x3c, 0x6d, 0x65, 0x74, 0x61, 0x20, 0x63, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74, 0x3d, 0x22, 0x74, 0x65, 0x78, 0x74, 0x2f, 0x68, 0x74, 0x6d, 0x6c, 0x3b, 0x20, 0x63, 0x68, 0x61, 0x72, 0x73, 0x65, 0x74, 0x3d, 0x67, 0x62, 0x32, 0x33, 0x31, 0x32, 0x22, 0x3e,
  0x3c, 0x2f, 0x68, 0x65, 0x61, 0x64, 0x3e, 0x3c, 0x62, 0x6f, 0x64, 0x79, 0x3e, 0x68, 0x69, 0x3c, 0x2f, 0x62, 0x6f, 0x64, 0x79, 0x3e, 0x3c, 0x2f, 0x68, 0x74, 0x6d, 0x6c, 0x3e,
]);
fs.writeFileSync(path.join(tmp2, 'credits.htm'), normBuf);
const norm = normalizeCharsets(tmp2);
ok('normalizeCharsets 重写了 GBK 文件', norm.rewritten === 1);
const fixed = fs.readFileSync(path.join(tmp2, 'credits.htm'));
ok('normalizeCharsets 输出为合法 UTF-8', !fixed.toString('utf8').includes('\uFFFD'));
ok('normalizeCharsets 注入 <meta charset="utf-8">', fixed.toString('utf8').includes('<meta charset="utf-8">'));
ok('normalizeCharsets 移除非法 content 声明', !fixed.toString('utf8').includes('charset=gb2312'));
ok('normalizeCharsets 中文内容正确', fixed.toString('utf8').includes('地下城主指南'));
ok('sniffFileCharset 识别 GBK', sniffFileCharset(path.join(tmp2, 'credits.htm')) === 'utf-8');
fs.rmSync(tmp2, { recursive: true, force: true });

console.log(pass ? 'CHARSET_TEST_PASS' : 'CHARSET_TEST_FAIL');
process.exit(pass ? 0 : 1);
