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

console.log(pass ? 'CHARSET_TEST_PASS' : 'CHARSET_TEST_FAIL');
process.exit(pass ? 0 : 1);
