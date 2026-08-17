'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const landing = require('./src/lib/landing');

const dir = path.join(os.tmpdir(), 'lnd-verify');
const out = [];
try {
  const o = landing.build({ outDir: dir, docs: [{ name: '示例文档', href: 'x/' }] });
  out.push('built -> ' + o.outFile);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const js = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
  try { new Function(js); out.push('JS_PARSES_OK'); }
  catch (e) { out.push('JS_PARSE_FAIL: ' + e.message); }
  out.push('placeholder_left: ' + html.includes('__DOCS_JSON__'));
  out.push('docs_injected: ' + html.includes('示例文档'));
  out.push('DOCS_LINE: ' + (html.match(/var DOCS = ([^;]+);/) || [])[1]);
} catch (e) { out.push('ERR: ' + e.stack); }
fs.writeFileSync(path.join(process.env.TEMP, 'lndverify.txt'), out.join('\n'));
process.exit(0);