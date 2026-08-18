'use strict';
// charset.js — 读取文本文件时自动检测字符集（UTF-8 / GBK 等），避免中文 CHM
// （页面 / .hhc / .hhk 常为 GB2312/GBK 编码）被按 UTF-8 硬读产生 U+FFFD 乱码。
//
// 检测顺序：
//   1) UTF-8 BOM        → 按 UTF-8 解
//   2) HTML meta charset / Content-Type 声明（gb2312/gbk/gb18030 → GBK 系；
//      utf-8 → UTF-8）
//   3) 严格 UTF-8（非法字节序列即抛错）→ 成功且结果无 U+FFFD 则视为 UTF-8
//   4) GBK / GB18030 回退（Node 22 全量 ICU 自带 gbk 解码器，无需额外依赖）
//   5) 最后兜底宽松 UTF-8（可能含 U+FFFD，但保证不抛错）

const fs = require('fs');
const path = require('path');

const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const decoders = {};
function getDecoder(label) {
  if (decoders[label]) return decoders[label];
  try { decoders[label] = new TextDecoder(label); } catch (_) { decoders[label] = null; }
  return decoders[label];
}

/** 从字节里嗅探 HTML 声明的字符集（<meta charset> 或 http-equiv Content-Type）。 */
function sniffMetaCharset(buf) {
  try {
    const head = buf.slice(0, Math.min(buf.length, 4096)).toString('latin1');
    const m = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head) ||
      /<meta[^>]+content\s*=\s*["'][^"']*charset=([\w-]+)/i.exec(head);
    return m ? m[1].toLowerCase() : null;
  } catch { return null; }
}

function decode(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);

  // 1) UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return buf.toString('utf8').replace(/^\uFEFF/, '');
  }

  // 2) HTML 显式声明
  const declared = sniffMetaCharset(buf);
  if (declared) {
    if (/^gb|gbk|gb2312|gb18030|csgb2312/i.test(declared)) {
      const g = getDecoder('gbk') || getDecoder('gb18030');
      if (g) { try { return g.decode(buf); } catch (_) {} }
    } else if (/utf-?8/i.test(declared)) {
      try { return utf8Strict.decode(buf); } catch (_) { /* fallthrough */ }
    }
  }

  // 3) 严格 UTF-8
  try {
    const s = utf8Strict.decode(buf);
    if (s.indexOf('\uFFFD') === -1) return s;
  } catch (_) { /* 非法 UTF-8 字节序列 */ }

  // 4) GBK / GB18030 回退
  const gbk = getDecoder('gbk') || getDecoder('gb18030');
  if (gbk) { try { return gbk.decode(buf); } catch (_) {} }

  // 5) 兜底
  return buf.toString('utf8');
}

/** 按检测到的字符集读取文本文件。 */
function readText(file) {
  return decode(fs.readFileSync(file));
}

/* ------------------------------------------------------------------ *
 * 字符集归一化：把解包出的页面统一转成 UTF-8，并重写 <meta> 声明。
 *
 * 背景：很多中文 CHM 的页面是 GBK 编码，但声明写成
 *   <meta content="text/html; charset=gb2312">
 * （没有 http-equiv、也没有 charset 属性）——浏览器不认这种声明；
 * 服务端若不带 charset 头，页面会按 UTF-8 解码 → 整页乱码。
 * 归一化后：所有 HTML 均为 UTF-8 字节 + 合法 <meta charset="utf-8">，
 * CSS 同步 @charset，hhc/hhk 也转 UTF-8（避免后续以 utf8 读写破坏）。
 * ------------------------------------------------------------------ */

/** 把 HTML 文本里的旧字符集声明替换为合法形式（HTML5 <meta charset="utf-8">）。 */
function rewriteMetaCharset(html) {
  // 1) 移除一切带 charset 声明的 meta（含合法 http-equiv 形式与非法 content 形式）
  let out = String(html).replace(/<meta\s+[^>]*charset\s*=\s*["']?[\w-]+["']?[^>]*>/gi, '');
  // 2) 顺带移除 http-equiv=Content-Type 的 meta（避免与新的 charset 声明冲突）
  out = out.replace(/<meta\s+http-equiv\s*=\s*["']?content-type["']?[^>]*>/gi, '');
  // 3) 在 <head ...> 之后注入合法声明；没有 head 就插到 <html ...> 后，再兜底前置
  const meta = '<meta charset="utf-8">';
  if (/<head[^>]*>/i.test(out)) out = out.replace(/(<head[^>]*>)/i, '$1' + meta);
  else if (/<html[^>]*>/i.test(out)) out = out.replace(/(<html[^>]*>)/i, '$1' + meta);
  else out = meta + out;
  return out;
}

/** 把 CSS 的 @charset 声明统一为 utf-8（无声明且需转码时补一条）。 */
function rewriteCssCharset(css) {
  let out = String(css).replace(/^\s*@charset\s+["'][^"']*["']\s*;/i, '@charset "utf-8";');
  if (!/^\s*@charset/i.test(out)) out = '@charset "utf-8";\n' + out;
  return out;
}

/** 归一化单个文本文件：按检测到的字符集解码 → 重写声明 → 以 UTF-8 写回。 */
function normalizeFile(file) {
  const buf = fs.readFileSync(file);
  const text = decode(buf);
  let out;
  if (/\.(html?)$/i.test(file)) out = rewriteMetaCharset(text);
  else if (/\.css$/i.test(file)) out = rewriteCssCharset(text);
  else out = text; // hhc/hhk：仅转码，不改声明
  const outBuf = Buffer.from(out, 'utf8');
  if (outBuf.equals(buf)) return false;
  fs.writeFileSync(file, outBuf);
  return true;
}

/**
 * 把目录下所有 html/htm/css/hhc/hhk 归一化为 UTF-8。
 * @param {string} dir 文档根目录
 * @returns {{scanned:number, rewritten:number}}
 */
function normalizeCharsets(dir) {
  const root = path.resolve(dir);
  const report = { scanned: 0, rewritten: 0 };
  (function walk(cur) {
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (/\.(html?|css|hhc|hhk)$/i.test(e.name)) {
        report.scanned++;
        if (normalizeFile(full)) report.rewritten++;
      }
    }
  })(root);
  return report;
}

/**
 * 嗅探单个 HTML 文件的字符集标签（用于服务端下发 charset 头，兼容存量 GBK 文档）。
 * @returns {'utf-8'|'gbk'|null} null 表示无法判断（非 HTML 或读取失败）
 */
function sniffFileCharset(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    const head = buf.slice(0, n);
    const declared = sniffMetaCharset(head);
    if (declared) {
      if (/^gb|gbk|gb2312|gb18030|csgb2312/i.test(declared)) return 'gbk';
      if (/utf-?8/i.test(declared)) return 'utf-8';
    }
    // 无声明：严格 UTF-8 能解且无替换符 → utf-8，否则按 GBK 兜底
    try {
      const s = utf8Strict.decode(head);
      if (s.indexOf('\uFFFD') === -1) return 'utf-8';
    } catch (_) { /* 非合法 UTF-8 */ }
    return 'gbk';
  } catch { return null; }
}

module.exports = { decode, readText, sniffMetaCharset, normalizeCharsets, sniffFileCharset };
