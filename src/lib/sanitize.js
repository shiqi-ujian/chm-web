'use strict';
// sanitize — 复制文档产物到站点子目录时，剔除 CHM 内部元数据（#/$ 开头的文件）。
// 这些文件（#IDXHDR、$FIftiMain 等）对浏览器阅读无意义，还可能污染 git/上传。
const fs = require('fs');
const path = require('path');

function isChmMetaName(name) {
  return /^[#$]/.test(name);
}

/**
 * 拷贝某目录到目标（跳过 CHM 内部元数据 #/$ <> 文件）。
 * @param {string} srcFile 单个文件绝对路径
 */
function copyDocContent(extractedDir, siteDocDir) {
  return copyDir(extractedDir, siteDocDir);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    // 跳过 CHM 内部元数据（#/$ 开头；$WWAssociativeLinks、$WWKeywordLinks、$FIftiMain 等）
    if (isChmMeta(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
function isChmMeta(name) {
  return /^[#$]/.test(name);
}

module.exports = { copyDocContent, isChmMetaName };