'use strict';
// hhk.js — parse a CHM `.hhk` keyword index into a flat list of entries:
//   [{ name, href }]
// .hhk is the same sitemap shape as .hhc but with keyword entries (often flat).
const path = require('path');
const { parseHhc, resolveHref } = require('./hhc');
const { readText } = require('./charset');

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
  const text = clean(readText(file));
  const tree = parseHhc(text);
  const dir = path.resolve(baseDir || path.dirname(file));
  const entries = flatten(tree);
  return entries.map((e) => ({ name: e.name, title: e.title, href: resolveHref(e.href, dir) }));
}

module.exports = { parseHhk, flatten };