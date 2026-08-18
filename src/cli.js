'use strict';
// cli.js — CLI entry for chm-web
const { convert } = require('./lib/convert');
const { extractChm, scan } = require('./lib/chm');
const { serve } = require('./lib/serve');
const { exportSite, exportDocs } = require('./lib/site-export');
const { normalizeCharsets } = require('./lib/charset');
const path = require('path');
const fs = require('fs');

const [, , cmd, input, arg2, arg3] = process.argv;

function printHelp() {
  console.log(`chm-web — CHM → browseable static site

Usage:
  node bin/cli.js convert <input.chm> [outDir]   # unpack + build preview
  node bin/cli.js extract <input.chm> [outDir]   # unpack only
  node bin/cli.js scan <dir>                     # inspect a dir
  node bin/cli.js serve <dir> [port]             # static server
  node bin/cli.js fix-charsets <dir>             # re-normalize an existing doc to UTF-8 (repair GBK/乱码)
  node bin/cli.js export-site <siteRoot> [out.zip]  # pack whole site into a deployable zip
  node bin/cli.js export-docs <siteRoot> <out.zip> [ids…]  # pack selected docs as a standalone static sub-site zip
  node bin/cli.js help
`);
}

async function main() {
  if (cmd === 'convert') {
    const r = await convert(input, arg2);
    console.log(JSON.stringify({ dir: r.dir, files: r.files, preview: r.preview && r.preview.navHtml ? undefined : r.preview }, null, 2).slice(0, 500));
    console.log(`Converted → ${r.dir}`);
  } else if (cmd === 'extract') {
    const out = arg2 || input.replace(/\.chm$/i, '');
    const r = await extractChm(input, path.resolve(out));
    const s = scan(r.dir);
    console.log(`extracted → ${r.dir}  html:${s.html.length} hhc:${s.hhc.length} hhk:${s.hhk.length}`);
  } else if (cmd === 'scan') {
    console.log(JSON.stringify(scan(path.resolve(input)), null, 2));
  } else if (cmd === 'serve') {
    const { server, port } = await serve(path.resolve(input));
    console.log(`serving ${input} → http://localhost:${port}`);
  } else if (cmd === 'fix-charsets') {
    const dir = path.resolve(input);
    const r = normalizeCharsets(dir);
    console.log(`normalized ${dir} → scanned=${r.scanned} rewritten=${r.rewritten}`);
  } else if (cmd === 'export-site') {
    const outZip = arg2 || 'site-export-' + Date.now() + '.zip';
    const r = exportSite({ siteRoot: path.resolve(input) });
    fs.writeFileSync(path.resolve(outZip), r.zip);
    console.log(`exported site (${r.manifest.fileCount} files, ${Math.round(r.manifest.totalBytes / 1024)} KB) → ${path.resolve(outZip)}`);
  } else if (cmd === 'export-docs') {
    const rest = process.argv.slice(2);
    const idx = rest.indexOf('export-docs');
    const outZip = rest[idx + 2] || 'docs-export-' + Date.now() + '.zip';
    const ids = rest.slice(idx + 3)
      .flatMap((s) => s.split(','))
      .map((s) => s.trim())
      .filter(Boolean);
    const r = exportDocs({ siteRoot: path.resolve(rest[idx + 1]), ids });
    fs.writeFileSync(path.resolve(outZip), r.zip);
    console.log(`exported ${r.manifest.docs.length} docs (${r.manifest.fileCount} files, ${Math.round(r.manifest.totalBytes / 1024)} KB) → ${path.resolve(outZip)}`);
    console.log('  docs: ' + r.manifest.docs.join(', '));
  } else {
    printHelp();
  }
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });