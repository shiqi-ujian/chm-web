'use strict';
// chm.js — 7-Zip based unpack + normalization
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 7z 可执行文件的解析顺序：
// 1) 环境变量 SEVENZ（显式指定，最高优先，可指向任意路径）
// 2) PATH 里的 7z / 7za（跨平台，部署到 Linux 服务器时最常用）
// 3) Windows 常见默认安装路径（仅本机兜底，可移植性最差所以放最后）
const DEFAULT_SEVENSEZ = 'C:\\Program Files\\7-Zip\\7z.exe';
const CANDIDATES = [process.env.SEVENZ, '7z', '7za', DEFAULT_SEVENSEZ].filter(Boolean);

/** 从候选里挑一个真实存在/可用的 7z 可执行文件；找不到则抛错 */
function resolveSeven() {
  for (const c of CANDIDATES) {
    // '7z'/'7za' 是 PATH 里的命令，可能不带扩展名，用 existsSync 无法判断，
    // 统一交给 spawnSync 去探。绝对路径才做文件存在性预检。
    if (path.isAbsolute(c)) {
      if (fs.existsSync(c)) return c;
      continue;
    }
    return c; // 交给 PATH 解析
  }
  throw new Error(
    `找不到 7-Zip：请安装 7-Zip，或设置环境变量 SEVENZ 指向 7z 可执行文件` +
      `（例如 SEVENZ="C:\\Program Files\\7-Zip\\7z.exe"，Linux 上通常是 PATH 里的 7z）`
  );
}

/**
 * Extract a .chm file into a folder (extract .hhc .hhk★...).
 * Uses 7-Zip. Returns { ok, dir, files }.
 */
async function extractChm(input, outDir) {
  const seven = resolveSeven();
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