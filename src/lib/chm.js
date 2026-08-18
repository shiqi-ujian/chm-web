'use strict';
// chm.js — 7-Zip based unpack + normalization
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// 7z 可执行文件的解析顺序：
// 1) 环境变量 SEVENZ（显式指定，最高优先，可指向任意路径）
// 2) PATH 里的 7z / 7za / 7zz（跨平台，部署到 Linux 服务器时最常用；
//    7zz 是较新 Debian/Ubuntu 上 7-Zip 官方包 7zip 提供的可执行名）
// 3) Windows 常见默认安装路径（仅本机兜底，可移植性最差所以放最后）
const DEFAULT_SEVENSEZ = 'C:\\Program Files\\7-Zip\\7z.exe';
const CANDIDATES = [process.env.SEVENZ, '7z', '7za', '7zz', DEFAULT_SEVENSEZ].filter(Boolean);

/** 从候选里挑一个真实存在/可用的 7z 可执行文件；找不到则抛错 */
function resolveSeven() {
  for (const c of CANDIDATES) {
    // '7z'/'7za' 是 PATH 里的命令，可能不带扩展名，用 existsSync 无法判断，
    // 用 spawnSync 探测可用性（ENOENT 时返回 status=null，不抛异常）。
    if (path.isAbsolute(c)) {
      if (fs.existsSync(c)) return c;
      continue;
    }
    try {
      const probe = spawnSync(c, ['i'], { stdio: 'ignore' });
      if (probe.status === 0) return c;
    } catch { /* 探测失败，继续下一个候选 */ }
  }
  throw new Error(
    `找不到 7-Zip：请安装 7-Zip，或设置环境变量 SEVENZ 指向 7z 可执行文件` +
      `（例如 SEVENZ="C:\\Program Files\\7-Zip\\7z.exe"，Linux 上通常是 PATH 里的 7z）`
  );
}

/**
 * Extract a .chm file into a folder. Uses 7-Zip.
 * 异步版本：spawn（不阻塞事件循环）。设超时，超时/失败会清理半成品。
 * @param {string} input .chm 路径
 * @param {string} outDir 目标目录
 * @param {object} o { timeoutMs } 可选解包超时（默认 120s）
 * @returns {Promise<{ok:true, dir:string}>}
 */
function extractChm(input, outDir, o = {}) {
  const seven = resolveSeven();
  const timeoutMs = o.timeoutMs || 120 * 1000;
  fs.mkdirSync(outDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(seven, ['x', input, `-o${outDir}`, '-y'], { stdio: 'ignore' });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); reject(new Error('7z 启动失败: ' + err.message)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (_) {}
        reject(new Error('7z 解包超时（> ' + Math.round(timeoutMs / 1000) + 's），已清理半成品'));
      } else if (code === 0) {
        resolve({ ok: true, dir: outDir });
      } else {
        try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (_) {}
        reject(new Error('7z 解包失败（exit ' + code + '）：' + (stderr || '未知原因')));
      }
    });
    if (child.stderr) child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  });
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

module.exports = { extractChm, scan, resolveSeven };