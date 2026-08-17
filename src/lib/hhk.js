'use strict';
// hhk.js — parse a CHM `.hhk` keyword index into a flat list of entries:
//   [{ name, href }]
// .hhk is the same sitemap shape as .hhc but with keyword entries (often flat).
const fs = require('fs');
const path = require('path');
const { parseHhc } = require('./hhc');

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

/** Flatten the (hierarchical) sitemap tree into a single keyword list. */
function flatten(tree, parentName = '') {
  const out = [];
  for (const n of tree) {
    const title = parentName ? `${parentName} › ${n.name}` : n.name;
    if (n.name && n.href) out.push({ name: n.name, title, href: n.href });
    if (n.children && n.children.length) out.push(...flatten(n.children, title));
  }
  return out;
}

/** Parse a .hhk file into flat keyword entries (href relative to baseDir). */
function parseHhk(file, baseDir) {
  const text = clean(fs.readFileSync(file, 'utf8'));
  const tree = parseHhc(text);
  const dir = path.resolve(baseDir || path.dirname(file));
  const relHref = (href) => {
    if (!href) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
    // normalize to forward slashes relative path
    const abs = new URL(href.replace(/\\/g, '/'), 'file://' + dir.replace(/\\/g, '/') + '/').pathname;
    const rel = require('path').relative(dir, decodeURIComponent(abs).replace(/^\//, '')).replace(/\\/g, '/');
    return rel;
  };
  const entries = flatten(tree);
  return entries.map((e) => ({ name: e.name, title: e.title, href: relHref(e.href) }));
}

module.exports = { parseHhk, flatten };