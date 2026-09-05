'use strict';
// mht.js — 把 CHM 里用 MHTML(.mht) 单文件保存的内容页转成可浏览的自包含 HTML。
//
// 背景：部分 CHM（Word 导出）的正文页是 .mht（multipart/related），浏览器对 .mht
// 的 iframe 支持极差且内容常为 GBK，导致阅读壳里正文显示原始 MIME/乱码。
// 本模块把每个 .mht 解析为：
//   - 主干 text/html 部分 → 解码字符集(GBK→UTF-8) + 重写 <meta charset="utf-8">
//   - 内嵌资源(图片/css/...) → 内联成 data URI（自包含，单文件即可渲染）
//   - 交叉引用 .mht → .html（重命名产物）
// 并把 .hhc/.hhk 及所有 html/htm 里的 ".mht" 引用改写为 ".html"。

const fs = require('fs');
const path = require('path');
const { decode, rewriteMetaCharset } = require('./charset');

/* ---------------- MIME 工具 ---------------- */

// quoted-printable 解码：=HH → 字节；=CRLF/=LF 为软换行，删掉。
function qpDecode(buf) {
  let s = buf.toString('latin1');
  s = s.replace(/=\r?\n/g, '');
  s = s.replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(s, 'latin1');
}

function decodeCTE(bodyBuf, cte) {
  const t = String(cte || '').trim().toLowerCase();
  if (t === 'base64') {
    const b64 = bodyBuf.toString('utf8').replace(/[^A-Za-z0-9+/=]/g, '');
    return Buffer.from(b64, 'base64');
  }
  if (t === 'quoted-printable') return qpDecode(bodyBuf);
  return bodyBuf; // 7bit / 8bit / binary / raw
}

function parseHdr(hdr) {
  const o = {
    contentType: '',
    charset: '',
    cte: '',
    location: '',
    cid: '',
    base: '',
  };
  for (const line of hdr.split(/\r?\n/)) {
    if (/^Content-Type:/i.test(line)) {
      o.contentType = line.replace(/^[^:]+:\s*/i, '');
      const cm = o.contentType.match(/charset\s*=\s*"?([\w-]+)"?/i);
      if (cm) o.charset = cm[1].toLowerCase();
      const bm = o.contentType.match(/base\s*=\s*"?([^";]+)"?/i);
      if (bm) o.base = bm[1];
    } else if (/^Content-Transfer-Encoding:/i.test(line)) {
      o.cte = line.replace(/^[^:]+:\s*/i, '');
    } else if (/^Content-Location:/i.test(line)) {
      o.location = line.replace(/^[^:]+:\s*/i, '').trim();
    } else if (/^Content-ID:/i.test(line)) {
      o.cid = line.replace(/^[^:]+:\s*/i, '').trim().replace(/[<>]/g, '');
    }
  }
  return o;
}

/** 解析一个 .mht 文件为 { mainHtml, charset, resources: [{keys, dataUri}], dropped } */
function parseMht(rawBuf) {
  const raw = rawBuf.toString('latin1');
  // 顶部 MIME 头
  const topEnd = raw.indexOf('\r\n\r\n');
  const topHdr = topEnd >= 0 ? raw.slice(0, topEnd) : raw;
  const top = parseHdr(topHdr);
  const bm = topHdr.match(/boundary\s*=\s*"?([^";\s]+)"?/i);

  if (!bm) {
    // 单 part（Word 也常见）：没有 boundary，整段 body 就是主内容（QP/base64）。
    if (topEnd === -1) return null;
    const body = decodeCTE(Buffer.from(raw.slice(topEnd + 4), 'latin1'), top.cte);
    if (!/text\/html/i.test(top.contentType) || body.length < 2) return null;
    return { main: { h: top, body }, resources: [], single: true };
  }

  const boundary = bm[1];
  const marker = '--' + boundary;

  const chunks = raw.split(marker);
  const parts = [];
  for (let i = 1; i < chunks.length; i++) {
    let p = chunks[i].replace(/^\r?\n/, '');
    // 结束边界：这一片以 '--' 开头（--boundary--）
    if (p.indexOf('--') === 0) continue;
    const idx = p.indexOf('\r\n\r\n');
    if (idx === -1) continue;
    const hdr = p.slice(0, idx);
    const body = p.slice(idx + 4);
    const h = parseHdr(hdr);
    const decoded = decodeCTE(Buffer.from(body, 'latin1'), h.cte);
    parts.push({ h, body: decoded });
  }
  if (!parts.length) return null;

  // 选主干：text/html 且含 <html/<body 且体积最大者
  let main = null;
  const htmlParts = parts.filter((x) => /text\/html/i.test(x.h.contentType) && /<html|<body|<head/i.test(x.body.toString('latin1').slice(0, 20000)));
  if (htmlParts.length) {
    main = htmlParts.reduce((a, b) => (b.body.length > a.body.length ? b : a));
  } else {
    main = parts.find((x) => /text\/html/i.test(x.h.contentType));
  }
  if (!main) main = parts[0];

  // 资源挂载：除主干外的所有非 text/plain 公告 part，按 Content-Location/cid 挂 data URI
  const resources = [];
  for (const x of parts) {
    if (x === main) continue;
    if (/multipart|message\//i.test(x.h.contentType)) continue;
    // 公告性质的 text/plain（"This is a multi-part message in MIME format"）
    if (/^text\/plain/i.test(x.h.contentType) && x.body.length < 600) continue;
    if (!x.h.contentType || x.h.contentType === '-') continue; // 空 part
    const b64 = x.body.toString('base64');
    const dataUri = 'data:' + x.h.contentType + ';base64,' + b64;
    const keys = [];
    // 用 body 里的 base 推导 media subpath，便于匹配相对引用
    if (x.h.base) keys.push(x.h.base);
    if (x.h.location) {
      keys.push(x.h.location); // 完整 file:///... 
      // 归一化 / 分隔符的相对形式
      keys.push(x.h.location.replace(/\\/g, '/'));
    }
    if (x.h.location) {
      const loc = x.h.location;
      // 取 basename
      const base = loc.replace(/\\/g, '/').split('/').pop();
      if (base) keys.push(base);
      // 取 .files 子路径形式：.../xxx.files/image001.jpg
      const rel = loc.replace(/\\/g, '/').match(/[^/]*\.files\/[^/]+$/i);
      if (rel) keys.push(rel[0]);
    }
    if (x.h.cid) keys.push('cid:' + x.h.cid, x.h.cid);
    // 去重
    const uniq = [...new Set(keys)].filter(Boolean);
    resources.push({ keys: uniq, dataUri });
  }
  return { main, resources };
}

/** 把 HTML 实体（尤其 Word 导出的 &#N; 数值实体代表中文）解码回真实字符。 */
function decodeEntities(html) {
  let s = String(html);
  // 数值实体十进制 / 十六进制
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
    try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; }
  });
  s = s.replace(/&#([0-9]+);/g, (_, d) => {
    try { return String.fromCodePoint(Number(d)); } catch { return _; }
  });
  // 常见命名实体
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0', ldquo: '\u201C', rdquo: '\u201D', lsquo: '\u2018', rsquo: '\u2019', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', middot: '\u00B7', sdot: '\u22C5', bull: '\u2022' };
  s = s.replace(/&([a-zA-Z]+);/g, (m, name) => named[name] || m);
  return s;
}

/** 把页面里的 file:///C:/xxx/… 绝对资源引用改成相对路径（Word 导出，资源与页面同目录的 .files/）。 */
function relativizeFileRefs(html, contentLocation) {
  let out = String(html);
  if (contentLocation) {
    const norm = String(contentLocation).replace(/\\/g, '/');
    const dirPrefix = norm.replace(/[^/]*$/, ''); // file:///C:/2669BA50/
    if (dirPrefix && dirPrefix.length > 'file:///'.length) out = out.split(dirPrefix).join('');
  }
  // 兜底：把残留的 file:/// 前缀与反斜杠路径统一成相对
  out = out.replace(/file:\/\/\/[A-Za-z]:\//gi, '');
  out = out.replace(/file:\/\/\//gi, '');
  out = out.replace(/\\/g, '/'); // 统一分隔符，便于相对解析
  return out;
}

/** 把 html 串里的资源引用替换成 data URI，并改写 .mht → .html。 */
function inlineResources(html, resources) {
  let out = html;
  // 先替换高度特异（完整路径 / .files 子路径），再替换裸 basename，以减少误伤
  const ordered = [...resources].sort((a, b) => (b.keys.length ? b.keys[0].length : 0) - (a.keys.length ? a.keys[0].length : 0));
  for (const r of ordered) {
    for (const k of r.keys) {
      if (out.indexOf(k) !== -1) out = out.split(k).join(r.dataUri);
    }
  }
  // 交叉引用 .mht → .html
  out = out.replace(/\.mht(?=[^a-zA-Z0-9]|$)/gi, '.html');
  return out;
}

/** 转换单个 .mht 为 .html；返回 { htmlPath } 或 { skipped }。 */
function convertOne(mhtFile) {
  try {
    const parsed = parseMht(fs.readFileSync(mhtFile));
    if (!parsed) return { skipped: mhtFile, reason: 'not-multipart' };
    const { main, resources } = parsed;
    let html = decode(main.body); // 自动探测 GBK → UTF-8
    html = decodeEntities(html);  // Word 常把中文存成 &#N; 数值实体，解码成真汉字
    html = relativizeFileRefs(html, main.h.location); // file:///C:/xxx/ 绝对资源引用 → 相对路径
    html = inlineResources(html, resources);
    html = rewriteMetaCharset(html); // 刷成合法 <meta charset="utf-8">
    const htmlPath = mhtFile.replace(/\.mht$/i, '.html');
    if (fs.existsSync(htmlPath)) return { skipped: mhtFile, reason: 'target-exists' };
    fs.writeFileSync(htmlPath, Buffer.from(html, 'utf8'));
    fs.rmSync(mhtFile);
    return { htmlPath };
  } catch (e) {
    return { skipped: mhtFile, reason: 'error:' + (e && e.message) };
  }
}

/** 把文本里的 .mht 引用改写为 .html，但仅当同目录/文档根下确实存在对应 .html（避免把跳过未转换的 .mht 指向死链接）。 */
function rewriteMhtRefs(text, filePath, root) {
  const dir = path.dirname(filePath);
  return String(text).replace(/([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5.\-]*?)\.mht(?=[^a-zA-Z0-9]|$)/gi, (m, base) => {
    if (fs.existsSync(path.join(dir, base + '.html'))) return base + '.html';
    if (root && fs.existsSync(path.join(root, base + '.html'))) return base + '.html';
    return m;
  });
}

/** 递归找出目录下所有 .mht 并转换；随后把 .hhc/.hhk/html/htm 里的 .mht 引用改 .html。 */
function convertMht(dir) {
  const root = path.resolve(dir);
  const report = { mht: 0, converted: 0, skipped: [], refRewritten: 0 };
  const mhtFiles = [];
  (function walk(cur) {
    let ents;
    try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.mht$/i.test(e.name)) mhtFiles.push(full);
    }
  })(root);

  report.mht = mhtFiles.length;
  for (const f of mhtFiles) {
    const r = convertOne(f);
    if (r.htmlPath) report.converted++;
    else report.skipped.push((r.reason || '') + ':' + path.relative(root, f));
  }

  // 更新 .mht 引用
  (function walkRef(cur) {
    let ents;
    try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) { walkRef(full); continue; }
      if (/\.(hhc|hhk|html?)$/i.test(e.name)) {
        let txt;
        try { txt = fs.readFileSync(full, 'utf8'); } catch { continue; }
        if (txt.indexOf('.mht') !== -1) {
          const nxt = rewriteMhtRefs(txt, full, root);
          if (nxt !== txt) { fs.writeFileSync(full, Buffer.from(nxt, 'utf8')); report.refRewritten++; }
        }
      }
    }
  })(root);

  return report;
}

module.exports = { convertMht, convertOne, parseMht };
