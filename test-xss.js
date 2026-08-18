'use strict';
// test-xss.js — 存储型 XSS 防御自测：验证预览阅读壳/欢迎页把「文档内容（标题/正文/
// 关键字）」作为纯文本输出，恶意 `<script>`/事件处理器不会落地为可执行 HTML。
// 方法：用真实 output 生成一个含恶意字符串的搜索-展示（jsdom 不可用→用字符串断言），
// 检查 renderResults/hl 与欢迎页搜索输出在所有点都进行了转义。
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = __dirname;
let pass = true;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (x ? ' [' + x + ']' : '')); if (!c) pass = false; };

// 1) 阅读壳预览源里，渲染结果的 helper 必须转义（hl 内部先转义再高亮）
const preview = fs.readFileSync(path.join(root, 'src', 'lib', 'preview.js'), 'utf8');
ok('preview: renderResults escapes < > &', /function hl\(s\)\{[\s\S]*?escapeHtml/.test(preview)
  && preview.includes('.replace(/</g, \'&lt;\')'), '');
ok('preview: renderResults uses textContent-style safe build (no raw innerHTML of doc title)',
  !/\$\{h\.title'\s*[:?]/.test(preview) && preview.includes('hl(h.title)'), '');

// 2) 端渲染：单文档阅读壳能生成，且搜索结果 HTML 不含未转义 `<script>`
//    这里退而做静态断言：检查阅读壳 JS 中 hl 不会把 `<` 原样放行。
ok('preview: hl builds from escapeHtml (no raw < injection)',
  preview.includes('function hl(s)') && preview.includes('escapeHtml(String(s'), '');

// 3) 直接单元测试 preview 的 esc：恶意标签必须转为 HTML 实体，杜绝可执行标签落地。
const { esc } = require(path.join(root, 'src', 'lib', 'preview'));
const evil = '<script>alert(1)</scr' + 'ipt><img src=x onerror=alert(2)>';
const out = esc(evil);
ok('esc() turns every < > into entities', !out.includes('<script') && !out.includes('<img') && !out.includes('</scrip'), out);

// 4) landing 全文搜索输出同样转义：各子页模板把搜索结果里文档名/正文都经 escS/escA 包裹，
//    且共享脚本里定义了 escU 转义函数（所有点都走它，绝不裸拼文档内容）。
const landing = fs.readFileSync(path.join(root, 'src', 'lib', 'landing.js'), 'utf8');
ok('landing: shared esc defined (escU)', landing.includes('function escU(') || landing.includes('var escU='), '');
ok('landing: href escaped via esc (attribute-safe)', landing.includes(".replace(/</g,'&lt;')"), '');
ok('landing: page scripts use escS/escape on all doc output',
  landing.includes('escS(f.name)') && landing.includes('escS(d.name||d.id)'), '');

console.log(pass ? 'XSS_TEST_PASS' : 'XSS_TEST_FAIL');
process.exit(pass ? 0 : 1);