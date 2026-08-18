'use strict';
// search.js — 服务端检索。
// 在线后端优先走 SQLite FTS5（src/lib/db.js 的 search_fts 虚拟表）：相关性排序 +
// 高亮片段 + 分页，文档一多时性能好。离线/纯静态 zip 仍由前端回退到 site-index.json。
const fs = require('fs');
const path = require('path');
const dbm = require('./db');

/** 读取站点根下的 site-index.json（聚合各文档关键字/标题/正文摘要） */
function loadSiteIndex(siteRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(siteRoot, 'site-index.json'), 'utf8'));
  } catch { return { keywords: [], records: [] }; }
}

/** 用站点级 site-index.json 重建 FTS 索引（幂等：先清空再整插）。由引用方在重建站点后调用。 */
function rebuild(siteRoot) {
  if (!dbm.db) return 0;
  const idx = loadSiteIndex(siteRoot);
  const db = dbm.db;
  const ins = db.prepare('INSERT INTO search_fts (doc, title, body) VALUES (?,?,?)');
  const tx = db.transaction(() => {
    db.exec('DELETE FROM search_fts');
    for (const k of (idx.keywords || [])) {
      if (k && k.name) ins.run(String(k.doc || ''), String(k.name).slice(0, 500), '');
    }
    for (const r of (idx.records || [])) {
      if (r && r.text) ins.run(String(r.doc || ''), '', String(r.text).slice(0, 2000));
    }
  });
  try { tx(); } catch (e) { console.error('[search] FTS rebuild failed', e); return 0; }
  return (idx.keywords || []).length + (idx.records || []).length;
}

/** 把一个 plain token 转成 FTS 匹配片段：含非字母数字时拆分后各自加前缀 `"run"*`。
 *  例：7-zip → `"7"* "zip"*`（隐式 AND） */
function ftsTerm(term) {
  const runs = String(term).match(/[\w\u4e00-\u9fa5]+/g) || [];
  return runs.length ? runs.map((r) => '"' + r + '"*').join(' ') : JSON.stringify(String(term));
}

/** 把用户 query 转成 FTS5 MATCH 表达式：空格=AND、A|B=OR、引号=短语。 */
function buildFtsQuery(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const groups = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(q))) {
    if (m[1]) groups.push({ type: 'phrase', term: m[1] });
    else {
      const parts = m[2].split('|').map((s) => s.trim()).filter(Boolean);
      if (parts.length > 1) groups.push({ type: 'or', terms: parts });
      else if (parts.length) groups.push({ type: 'and', term: parts[0] });
    }
  }
  if (!groups.length) return null;
  const pieces = groups.map((g) => {
    if (g.type === 'phrase') return '"' + g.term + '"';
    if (g.type === 'or') return '(' + g.terms.map(ftsTerm).join(' OR ') + ')';
    return ftsTerm(g.term);
  });
  return pieces.join(' ');
}

/**
 * 服务端检索：优先 FTS5；FTS 失败或返回空时回退纯文本扫描（兼容非常规 query / 未建索引）。
 * @returns {{ok:true, query, total, hits:[{doc,href,snippet}]}}
 */
function search(siteRoot, query, { limit = 10, offset = 0 } = {}) {
  const q = String(query || '').trim();
  if (!q) return { ok: true, query: q, hits: [], total: 0 };

  const ftsQuery = buildFtsQuery(q);
  if (dbm.db && ftsQuery) {
    try {
      const total = dbm.db.prepare('SELECT COUNT(*) AS c FROM search_fts WHERE search_fts MATCH ?').get(ftsQuery).c;
      if (total > 0) {
        const rows = dbm.db.prepare(
          `SELECT doc, title, snippet(search_fts, 2, '', '', '…', 28) AS body
           FROM search_fts WHERE search_fts MATCH ?
           ORDER BY rank LIMIT ? OFFSET ?`
        ).all(ftsQuery, Math.max(0, limit), Math.max(0, offset));
        const hits = rows.map((r) => ({
          doc: r.doc || '',
          href: 'd/' + (r.doc || '') + '/',
          snippet: (r.title || r.body || '').replace(/\[page:[^\]]*\]/g, '').trim(),
        }));
        return { ok: true, query: q, total, hits };
      }
    } catch (e) { /* fall through to string search */ }
  }
  return stringSearch(siteRoot, q, { limit, offset });
}

/** 纯静态回退（读取 site-index.json 字符串扫描），与旧行为一致。 */
function stringSearch(siteRoot, query, { limit = 10, offset = 0 } = {}) {
  const idx = loadSiteIndex(siteRoot);
  const q = String(query || '').trim();
  if (!q) return { ok: true, query: q, hits: [], total: 0 };

  const kwHits = [];
  for (const k of (idx.keywords || [])) {
    const name = (k.name || '').toLowerCase();
    const doc = (k.doc || '');
    if (name.indexOf(q.toLowerCase()) !== -1) {
      kwHits.push({ doc, snippet: (k.name || ''), href: k.href || ('d/' + doc + '/'), score: 10 });
    }
  }

  const recordsByDoc = {};
  for (const rec of (idx.records || [])) {
    if (!rec || !rec.text) continue;
    (recordsByDoc[rec.doc] = recordsByDoc[rec.doc] || []).push(rec);
  }
  const body = legacyMatch(idx.records, recordsByDoc, q);

  const all = kwHits.concat(body.hits.map((h) => ({ doc: h.doc, text: h.text, score: h.score, href: 'd/' + (h.doc || '') + '/' })));
  all.sort((a, b) => (b.score || 0) - (a.score || 0));
  const seen = new Set();
  const uniq = all.filter((h) => { const k = h.doc + '::' + (h.text || h.snippet || ''); if (seen.has(k)) return false; seen.add(k); return true; });
  const total = uniq.length;
  const page = uniq.slice(offset, offset + limit);
  return { ok: true, query: q, total, hits: page.map((h) => ({ doc: h.doc || '', href: h.href || '', snippet: h.text || h.snippet || '' })) };
}

/** 旧版简单分词/匹配（AND/OR/短语），作离线回退。 */
function legacyMatch(records, recordsByDoc, query) {
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
    for (const rec of recordsByDoc[docName]) {
      const text = (rec.text || '').toLowerCase();
      let ok = true, score = 0;
      for (const g of groups) {
        if (g.type === 'and') { if (text.indexOf(g.term) === -1) { ok = false; break; } score += 2; }
        else if (g.type === 'phrase') { if (text.indexOf(g.term) === -1) { ok = false; break; } score += 4; }
        else { let any = false; for (const t of g.terms) if (text.indexOf(t) !== -1) { any = true; score += 2; } if (!any) { ok = false; break; } }
      }
      if (!ok) continue;
      const firstTerm = groups[0].type === 'and' ? groups[0].term : (groups[0].terms || [groups[0].term])[0];
      const at = text.indexOf(firstTerm);
      const snippet = rec.text.slice(Math.max(0, at - 30), at + 200).replace(/\s+/g, ' ').replace(/\[page:[^\]]*\]/g, '').trim();
      hits.push({ doc: docName, text: snippet, score });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const uniq = hits.filter((h) => { const k = h.doc + '::' + h.text; if (seen.has(k)) return false; seen.add(k); return true; });
  return { hits: uniq, total: uniq.length };
}

module.exports = { search, loadSiteIndex, rebuild, buildFtsQuery };