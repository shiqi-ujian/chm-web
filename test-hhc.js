'use strict';
// test-runner: parse real .hhc and dump tree; writes output to temp + stdout
const { parseHhcFile } = require('./src/lib/hhc');
const fs = require('fs');
const path = require('path');

async function main() {
  let base = process.argv[2];
  if (!base || !fs.existsSync(base)) {
    const tmp = path.join(process.env.TEMP || '.', 'chm-m1-hhc');
    base = fs.existsSync(tmp) ? tmp : path.join('out', '7z-demo');
  }
  const hhc = fs.readdirSync(base).find((x) => x.toLowerCase().endsWith('.hhc'));
  if (!hhc) { console.error('no .hhc in ' + base); process.exit(2); }
  const tree = parseHhcFile(path.join(base, hhc), base);
  const lines = [];
  let top = 0, leaf = 0;
  function walk(nodes, d) {
    for (const n of nodes) {
      if (d === 0) top++;
      if (!(n.children && n.children.length)) leaf++;
      lines.push('  '.repeat(d) + '- ' + n.name + (n.href ? '  [' + n.href + ']' : ''));
      if (n.children && n.children.length) walk(n.children, d + 1);
    }
  }
  walk(tree, 0);
  if (top === 0) { console.error('parse produced empty tree'); process.exit(3); }
  console.log('hhc tree parsed OK — top-level nodes: ' + top + ', leaf pages: ' + leaf);
  fs.writeFileSync(path.join(process.env.TEMP || '.', 'hhcparse.txt'), lines.join('\n'));
}
main().catch((e) => { console.error(e); process.exit(1); });