'use strict';
const { parseHhcFile } = require('./src/lib/hhc');
const fs = require('fs');
const path = require('path');
const base = path.resolve('out/7z-demo');
const t = parseHhcFile(path.join(base, '7zip.hhc'), base);
const names = [];
(function walk(ns) {
  for (const n of ns) {
    if (n.name) names.push(n.name);
    if (n.children && n.children.length) walk(n.children);
  }
})(t);
const out = process.argv[2] || path.join(process.env.TEMP || '.', 'names.txt');
fs.writeFileSync(out, names.join('\n'));
console.log('count=' + names.length + ' -> ' + out);