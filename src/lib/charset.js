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

module.exports = { decode, readText, sniffMetaCharset };
