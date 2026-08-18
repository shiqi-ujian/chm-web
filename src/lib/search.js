'use strict';
// search.js — 服务端检索（B1）：把站点级 site-index.json（关键字 + 正文摘要）在服务端
// 过滤，返回分页 + 高亮片段。浏览器端仍保留静态回退（离线 zip / 纯静态托管），
// /api/search 只是给在线后端更多文档时更稳的底座，接口稳定、可被前端防抖调用。
const fs = require('fs');
const path = require('path');

/** 读取站点根下的 site-index.json（聚合各文档关键字/标题/正文摘要） */
function loadSiteIndex(siteRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(siteRoot, 'site-index.json'), 'utf8'));
  } catch { return { keywords: [], records: [] }; }
}

/** 简单分词/匹配：空格分隔视为 AND，A|B 视为 OR，引号视为短语（近似）。
 *  返回是否命中 + 命中片段（截到 query 周围）。 */
function match(records, recordsByDoc, query) {
  const q = String(query || '').trim();
  if (!q) return { hits: [], total: 0 };
  const groups = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(q))) {
    if (m[1]) groups.push({ type: 'phrase', term: m[1].toLowerCase() });
    else {
      const parts = m[2].split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (parts.length > 1) groups.push({ type: 'or', terms: parts });
      else if (parts.length) groups.push({ type: 'and', term: parts[0] });
    }
  }
  if (!groups.length) return { hits: [], total: 0 };

  const hits = [];
  for (const docName of Object.keys(recordsByDoc)) {
    const list = recordsByDoc[docName];
    for (const rec of list) {
      const text = (rec.text || '').toLowerCase();
      let ok = true, score = 0;
      for (const g of groups) {
        if (g.type === 'and') { if (text.indexOf(g.term) === -1) { ok = false; break; } score += 2; }
        else if (g.type === 'phrase') { if (text.indexOf(g.term) === -1) { ok = false; break; } score += 4; }
        else {
          let any = false;
          for (const t of g.terms) if (text.indexOf(t) !== -1) { any = true; score += 2; }
          if (!any) { ok = false; break; }
        }
      }
      if (!ok) continue;
      const firstTerm = groups[0].type === 'and' ? groups[0].term : (groups[0].terms || [groups[0].term])[0];
      const at = text.indexOf(firstTerm);
      const snippet = rec.text.slice(Math.max(0, at - 30), at + 200).replace(/\s+/g, ' ').replace(/\[page:[^\]]*\]/g, '').trim();
      hits.push({ doc: docName, text: snippet, score });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  // 去重（doc+text）
  const seen = new Set();
  const uniq = hits.filter((h) => { const k = h.doc + '::' + h.text; if (seen.has(k)) return false; seen.add(k); return true; });
  return { hits: uniq, total: uniq.length };
}

/**
 * 服务端检索：输入 siteRoot 与 query/limit。返回 { ok, query, total, hits }。
 * hit 形如 { doc, snippet }。
 */
function search(siteRoot, query, { limit = 10, offset = 0 } = {}) {
  const idx = loadSiteIndex(siteRoot);
  const q = String(query || '').trim();
  if (!q) return { query: q, hits: [], total: 0 };

  // 关键字命中（标题/关键字）：优先且权重更高
  const kwHits = [];
  for (const k of (idx.keywords || [])) {
    const name = (k.name || '').toLowerCase();
    const doc = (k.doc || '');
    if (name.indexOf(q.toLowerCase()) !== -1) {
      kwHits.push({ doc, snippet: (k.name || ''), href: k.href || ('d/' + doc + '/'), score: 10 });
    }
  }

  // 正文命中（聚合每文档 records）
  const recordsByDoc = {};
  for (const rec of (idx.records || [])) {
    if (!rec || !rec.text) continue;
    (recordsByDoc[rec.doc] = recordsByDoc[rec.doc] || []).push(rec);
  }
  const body = match(idx.records, recordsByDoc, q);

  // 合并 + 排序 + 分页
  const all = kwHits.concat(body.hits.map((h) => ({ doc: h.doc, text: h.text, score: h.score, href: 'd/' + (h.doc || '') + '/' })));
  all.sort((a, b) => (b.score || 0) - (a.score || 0));
  const seen = new Set();
  const uniq = all.filter((h) => { const k = h.doc + '::' + (h.text || h.snippet || ''); if (seen.has(k)) return false; seen.add(k); return true; });
  const total = uniq.length;
  const page = uniq.slice(offset, offset + limit);
  return { ok: true, query: q, total, hits: page.map((h) => ({ doc: h.doc || '', href: h.href || '', snippet: h.text || h.snippet || '' })) };
}

module.exports = { search, loadSiteIndex };