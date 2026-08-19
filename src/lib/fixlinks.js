'use strict';
// fixlinks.js — 修复 CHM 解包后的坏路径：hhc/hhk/正文链接的大小写与实际文件不一致。
// CHM 内部查找不区分大小写，但解包到 Linux（阿里云/自有服务器）后文件系统严格区分大小写，
// 例如 hhc 写 "fm/Menu.htm" 而实际文件是 "fm/menu.htm" → 线上 404。
// 做法：扫描目录建立「小写相对路径 → 实际路径」映射，把 html/hhc/hhk/css 里的
// 相对链接（含 ./ ../ 前缀）解析为根相对路径后对齐实际大小写；找不到匹配保持原样。
const fs = require('fs');
const path = require('path');
const { readText } = require('./charset');

/** 扫描目录，建立 小写相对路径 → 实际相对路径 映射（根相对，/ 分隔） */
function scanDirMap(dir) {
  const map = {};
  const walk = (cur, rel) => {
    let entries = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (!(r.toLowerCase() in map)) map[r.toLowerCase()] = r;
      if (e.isDirectory()) walk(path.join(cur, e.name), r);
    }
  };
  walk(dir, '');
  return map;
}

/** 把 baseDir（根相对目录）+ url（可含 ./ ../）合并解析为根相对路径 */
function joinRel(baseDir, url) {
  const segs = [];
  (baseDir ? baseDir.split('/') : []).concat(url.replace(/\\/g, '/').split('/')).forEach((s) => {
    if (!s || s === '.') return;
    if (s === '..') { if (segs.length) segs.pop(); }
    else segs.push(s);
  });
  return segs.join('/');
}

/** 从 baseDir（根相对目录）到 target（根相对路径）的相对 URL */
function relFrom(baseDir, target) {
  const b = baseDir ? baseDir.split('/') : [];
  const t = target.split('/');
  let i = 0;
  while (i < b.length && i < t.length && b[i] === t[i]) i++;
  const ups = b.length - i;
  const rest = t.slice(i).join('/');
  if (!ups) return rest;
  const prefix = new Array(ups).fill('..').join('/');
  return rest ? prefix + '/' + rest : prefix;
}

/** 规范化一个相对 URL（相对当前文件所在目录 baseDir），对齐实际大小写，保留 ?query #hash */
function fixRel(baseDir, url, map) {
  const qIdx = url.search(/[?#]/);
  const suffix = qIdx === -1 ? '' : url.slice(qIdx);
  const p = (qIdx === -1 ? url : url.slice(0, qIdx)).replace(/\\/g, '/');
  if (!p) return url;
  const rootRel = joinRel(baseDir, p);
  if (!rootRel) return url;
  const hit = map[rootRel.toLowerCase()];
  if (!hit || hit === rootRel) return url;
  return relFrom(baseDir, hit) + suffix;
}

function isExternal(v) {
  return /^(https?:|mailto:|javascript:|data:|tel:|\/\/|#|\/)/i.test(v) || /^[a-z][a-z0-9+.-]*:/i.test(v);
}

/** 重写单个文件里的相对链接；rel 为该文件相对根目录的路径 */
function fixFile(file, rel, map) {
  const baseDir = rel.indexOf('/') === -1 ? '' : rel.slice(0, rel.lastIndexOf('/'));
  // 按实际字符集读取（GBK 页面也能正确改链接），写回统一 UTF-8，
  // 避免把 GBK 字节当 utf8 读出来再写回造成二次乱码。
  const raw = readText(file);
  let out = raw;
  let changed = false;

  out = out.replace(/(href|src)=["']([^"']+)["']/gi, (m, attr, val) => {
    const v = val.trim();
    if (isExternal(v)) return m;
    const fixed = fixRel(baseDir, v, map);
    if (fixed === v) return m;
    changed = true;
    return attr + '="' + fixed + '"';
  });

  out = out.replace(/(<param\s+name=["']Local["']\s+value=["'])([^"']*)(["'])/gi, (m, pre, val, post) => {
    const v = val.trim();
    if (isExternal(v)) return m;
    const fixed = fixRel(baseDir, v, map);
    if (fixed === v) return m;
    changed = true;
    return pre + fixed + post;
  });

  out = out.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (m, val) => {
    const v = val.trim();
    if (isExternal(v) || /^data:/i.test(v)) return m;
    const fixed = fixRel(baseDir, v, map);
    if (fixed === v) return m;
    changed = true;
    return 'url(' + fixed + ')';
  });

  if (changed) fs.writeFileSync(file, out, 'utf8');
  return changed;
}

/** 对解包目录执行链接规范化（html/hhc/hhk/css） */
function fixLinks(dir) {
  const root = path.resolve(dir);
  const map = scanDirMap(root);
  const files = [];
  (function walk(d, rel) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'index.html' || e.name === '__chm_nav.html') continue; // 壳由 preview 生成，不碰
      const f = path.join(d, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { walk(f, r); continue; }
      if (/\.(html?|hhc|hhk|css)$/i.test(e.name)) files.push({ file: f, rel: r });
    }
  })(root, '');
  let fixed = 0;
  for (const { file, rel } of files) if (fixFile(file, rel, map)) fixed++;
  return { scanned: files.length, fixedFiles: fixed, mapped: Object.keys(map).length };
}

module.exports = { fixLinks, scanDirMap, fixRel, joinRel };
