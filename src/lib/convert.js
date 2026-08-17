'use strict';
// convert.js — end-to-end: unpack a .chm + build the browseable shell.
const path = require('path');
const { extractChm, scan } = require('./chm');
const { build } = require('./preview');

async function convert(input, outArg) {
  const abs = path.resolve(input);
  let out = path.resolve(outArg || abs.replace(/\.chm$/i, ''));
  const extracted = await extractChm(abs, out);
  const dir = out;
  const files = scan(dir);

  let hhc = files.hhc.length ? path.join(dir, files.hhc[0]) : null;
  let hhk = files.hhk.length ? path.join(dir, files.hhk[0]) : null;
  const title = path.basename(dir);
  const preview = build({ outDir: dir, hhcFile: hhc, hhkFile: hhk, title });

  return { dir, files, preview, extracted };
}

module.exports = { convert };