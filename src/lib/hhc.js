'use strict';
// hhc.js — parse a Windows CHM `.hhc` Sitemap into a nested navigation tree.
//
// A .hhc is an HTML fragment: each entry is
//   <OBJECT type="text/sitemap"><param name="Name" value=".."><param name="Local" value=".."></OBJECT>
// nested inside <UL>/<LI> (an <UL> after an entry makes that entry a folder).
// Only Name + Local(href) are needed to draw the tree.

const fs = require('fs');
const path = require('path');

function clean(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/** Extract the type= and param name/local from an <OBJECT> tag body. */
function objectInfo(openTag) {
  const type = (openTag.match(/type\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
  return type;
}

function paramValue(inner, key) {
  const re = new RegExp(`<param\\s+name\\s*=\\s*["']?${key}["']?\\s+value\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = inner.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Parse .hhc text into nested nodes: {name, href, children[]}.
 */
function parseHhc(text) {
  const root = [];
  const lists = [root];
  let curSitemap = null;

  const tokenRe = /<\s*(OBJECT|UL|LI)\b([^>]*)>|<\s*\/(?:OBJECT|UL|LI)\s*>/gi;
  let m;
  while ((m = tokenRe.exec(text)) !== null) {
    const full = m[0];
    if (full[1] === '/') {
      if (/\/\s*UL\b/i.test(full)) {
        lists.pop();
        curSitemap = null;
      }
      continue;
    }
    const tag = (m[1] || '').toLowerCase();
    const attrs = m[2] || '';
    if (tag === 'ul') {
      let children = [];
      if (curSitemap) {
        children = [];
        curSitemap.children = children;
      } else {
        // first (top-level) UL: its list is the root itself
        children = root;
      }
      lists.push(children);
    } else if (tag === 'object') {
      const type = (attrs.match(/type\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
      if (!/sitemap/i.test(type)) continue;
      const start = m.index + full.length;
      const endIdx = text.toLowerCase().indexOf('</object>', start);
      if (endIdx === -1) continue;
      const inner = text.slice(start, endIdx);
      tokenRe.lastIndex = endIdx + '</object>'.length;
      const node = {
        name: paramValue(inner, 'name') || '',
        href: paramValue(inner, 'local'),
        children: [],
      };
      lists[lists.length - 1].push(node);
      curSitemap = node;
    }
  }
  return root;
}

/** Parse a .hhc file; resolve hrefs against baseDir. */
function parseHhcFile(file, baseDir) {
  const text = clean(fs.readFileSync(file, 'utf8'));
  const tree = parseHhc(text);
  const dir = path.resolve(baseDir || path.dirname(file)).replace(/\\/g, '/');
  const resolve = (href) => {
    if (!href) return null;
    // CHM 内部链接：mk:@MSITStore:<file>::/<path> 或 <file>::/<path>
    // 去掉协议与主机部分，只保留文档内相对路径 /path（可与文档真实文件对齐）
    if (/^mk:@|::\//i.test(href)) {
      let p = href.replace(/^.*?::\//i, '').replace(/\\/g, '/');
      p = decodeURIComponent(p.replace(/^\/+/, ''));
      if (p) return p.replace(/\//g, path.sep);
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
    const url = new URL(href.replace(/\\/g, '/'), 'file://' + dir + '/');
    return decodeURIComponent(url.pathname).replace(/^\//, '').replace(/\//g, path.sep);
  };
  const walk = (nodes) => nodes.map((n) => ({ ...n, href: resolve(n.href), children: walk(n.children) }));
  return walk(tree);
}

module.exports = { parseHhc, parseHhcFile };