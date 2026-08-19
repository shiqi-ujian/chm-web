// ============================================================
// 最小 xlsx 读取器（零依赖）：解析 zip 本地文件头 + inflate + XML 提取首个工作表。
// 用途：腾讯文档收集表「导出 Excel」兜底路径。
// 局限：只处理 sharedStrings + inlineStr + 数字单元格，足以覆盖表单导出。
// ============================================================
import fs from 'node:fs';
import zlib from 'node:zlib';

/** 从 xlsx 文件提取 <name> 条目（小端 32 位长度前缀），返回 Map<name, Buffer> */
function listZipEntries(buf) {
  const entries = new Map();
  let off = 0;
  while (off + 30 <= buf.length) {
    if (buf.readUInt32LE(off) !== 0x04034b50) break; // 本地文件头 PK\x03\x04
    const method = buf.readUInt16LE(off + 8);
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.subarray(off + 30, off + 30 + nameLen).toString('utf8');
    const dataStart = off + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    entries.set(name, method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data));
    off = dataStart + compSize;
  }
  return entries;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function extractSharedStrings(xml) {
  const out = [];
  const siRe = /<si>(.*?)<\/si>/gs;
  let m;
  while ((m = siRe.exec(xml))) {
    let text = '';
    const tRe = /<t(?:\s[^>]*)?>(.*?)<\/t>/gs;
    let tm;
    while ((tm = tRe.exec(m[1]))) text += decodeXmlEntities(tm[1]);
    out.push(text);
  }
  return out;
}

/**
 * 解析 xlsx 首个工作表为二维数组（行 x 列）。
 */
export function readXlsxRows(filePath) {
  const buf = fs.readFileSync(filePath);
  const entries = listZipEntries(buf);
  const shared = entries.has('xl/sharedStrings.xml')
    ? extractSharedStrings(entries.get('xl/sharedStrings.xml').toString('utf8'))
    : [];
  const sheetEntry = [...entries.keys()].find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
  if (!sheetEntry) throw new Error('xlsx 中未找到工作表条目');
  const xml = entries.get(sheetEntry).toString('utf8');

  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const rowXml = rm[1];
    const cells = [];
    const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cRe.exec(rowXml))) {
      const attrs = cm[1] || '';
      const body = cm[2] || '';
      const t = /t="([^"]+)"/.exec(attrs);
      const ref = /r="([A-Z]+)\d+"/.exec(attrs);
      const idx = ref ? ref[1].split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1 : cells.length;
      let val = '';
      if (t && t[1] === 's') {
        const v = /<v>(\d+)<\/v>/.exec(body);
        val = v ? shared[Number(v[1])] ?? '' : '';
      } else if (t && t[1] === 'inlineStr') {
        const is = /<is>[\s\S]*?<t(?:\s[^>]*)?>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(body);
        val = is ? decodeXmlEntities(is[1]) : '';
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        val = v ? decodeXmlEntities(v[1]) : '';
      }
      cells[idx] = val;
    }
    // 补空列
    const max = cells.length;
    for (let i = 0; i < max; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}
