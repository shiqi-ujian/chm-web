'use strict';
// chm.js — 7-Zip based unpack + normalization
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SEVENSEZ = 'C:\\Program Files\\7-Zip\\7z.exe';

/**
 * Extract a .chm into a folder (html + .hhc + .hhk...).
 * Uses 7-Zip. Returns { ok, dir, files }.
 */
async function extractChm(input, outDir) {
  const seven = process.env.SEVENZ || SEVENSEZ;
  if (!fs.existsSync(seven)) {
    throw new Error(`7zip not found at ${seven} — install 7-Zip or set SEVEN env var`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const res = spawnSync(seven, ['x', input, `-o${outDir}`, '-y'], { stdio: 'pipe' });
  if (res.status !== 0) {
    throw new Error(`7z extract failed (${res.status}): ${res.stderr || res.stdout}`);
  }
  return { ok: true, dir: outDir };
}

/** list top-level loose files of interest in an unpacked dir */
function scan(dir) {
  const files = fs.readdirSync(dir);
  return {
    html: files.filter((f) => /\.html?$/i.test(f)),
    hhc: files.filter((f) => /\.hhc$/i.test(f)),
    hhk: files.filter((f) => /\.hhk$/i.test(f)),
  };
}

module.exports = { extractChm, scan };