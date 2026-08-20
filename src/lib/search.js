'use strict';
// search.js — 服务端检索。
// 在线后端优先走 SQLite FTS5（src/lib/db.js 的 search_fts 虚拟表）：相关性排序 +
// 高亮片段 + 分页，文档一多时性能好。离线/纯静态 zip 仍由前端回退到 site-index.json。
// 私有文档不写入公开 site-index，单独按文档扫描 keywords.json / search-index.json，
// 由 server 层把可读范围（owner / 分享 token）转换成 scopeIds 传入。
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
      if (r && r.text) ins.run(String(r.doc || ''), String(r.name || '').slice(0, 500), String(r.text).slice(0, 2000));
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

/** 统一查询解析函数；FTS 和字符串回退共用 */
function parseQueryTerms(query) {
  const q = String(query || '').trim();
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
  return groups;
}

function parseQuery(query) {
  return parseQueryTerms(query);
}

function hitScore(text, groups) {
  if (!groups.length) return 0;
  const t = String(text || '').toLowerCase();
  let score = 0;
  for (const g of groups) {
    if (g.type === 'and') { if (t.indexOf(g.term) === -1) return -1; score += 2; }
    else if (g.type === 'phrase') { if (t.indexOf(g.term) === -1) return -1; score += 4; }
    else {
      let any = false;
      for (const term of g.terms) { if (t.indexOf(term) !== -1) { any = true; score += 2; } }
      if (!any) return -1;
    }
  }
  return score;
}

/** 扫一个本地文档目录（私密文档或分享范围），返回 [{doc, name, href, snippet, score}] */
function scanDocDir(docId, dir, query, groups, hrefPrefix) {
  const hits = [];
  if (!dir || !fs.existsSync(dir)) return hits;
  // 标题关键字
  try {
    const kw = JSON.parse(fs.readFileSync(path.join(dir, 'keywords.json'), 'utf8')) || { keywords: [] };
    for (const k of (kw.keywords || [])) {
      const name = String(k.name || '');
      if (hitScore(name, groups) !== -1) {
        hits.push({ doc: doc, name: name, href: hrefPrefix + doc + '/' + (k.href || '').replace(/\\/g, '/'), snippet: '', score: 10 });
      }
    }
  } catch (_) {}
  // 全文
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(dir, 'search-index.json'), 'utf8')) || { records: [] };
    for (const rec of (idx.records || [])) {
      const text = String(rec && rec.text || '');
      const pages = [];
      const re = /\[page:([^\]]+)\]([\s\S]*?)(?=\[page:|$)/g;
      let m;
      while ((m = re.exec(text))) pages.push({ url: m[1], seg: m[2] });
      if (!pages.length) pages.push({ url: '', seg: text });
      for (const p of pages) {
        const score = hitScore(p.seg, groups);
        if (score === -1) continue;
        const at = p.seg.toLowerCase().indexOf((groups[0] && (groups[0].term || (groups[0].terms || [''])[0])) || '');
        const ctx = p.seg.replace(/\s+/g, ' ').trim();
        const snippet = ctx.slice(Math.max(0, at - 30), at + 60);
        hits.push({
          doc,
          name: p.url || doc,
          href: hrefPrefix + doc + '/' + p.url || hrefPrefix + doc + '/',
          snippet,
          score: score + 6,
        });
      }
    }
  } catch (_) {}
  return hits;
}

function privateDocDir(docId) {
  return path.join(dbm.dataDir, 'private', docId);
}

/**
 * 服务端检索。
 * @param {object} opts { limit, offset, username?, scopeIds?, onlyPrivate? }
 *   scopeIds 非空 = 只在指定文档（多为分享授权文档）内检索。
 *   username + onlyPrivate = 搜索该用户自己的私有文档。
 * @returns {{ok:true, query, total, hits:[{doc,href,snippet}]}}
 */
function search(siteRoot, query, { limit = 10, offset = 0, username = null, scopeIds = null, onlyPrivate = false } = {}) {
  const q = String(query || '').trim();
  if (!q) return { ok: true, query: q, hits: [], total: 0 };
  const groups = parseQueryTerms(q);

  // 明确范围：分享/单文档 或 “我的私密文档”
  let localDocs = [];
  if (scopeIds && scopeIds.length) {
    for (const id of scopeIds) {
      const dir = privateDocDir(id);
      if (!fs.existsSync(dir)) continue;
      localDocs.push(...scanDoc(id, dir, 'p/', groups));
    }
  } else if (onlyPrivate && username) {
    const rows = dbm.db.prepare('SELECT doc_id FROM meta WHERE owner = ? AND visibility = ?').all(username, 'private');
    for (const r of rows) {
      const dir = privateDocDir(r.doc_id);
      if (!fs.existsSync(dir)) continue;
      localDocs.push(...scanDoc(r.doc_id, dir, 'p/', groups));
    }
  }

  if (localDocs.length) {
    localDocs.sort((a, b) => (b.score || 0) - (a.score || 0));
    const seen = new Set();
    const uniq = localDocs.filter((h) => { const k = h.doc + '::' + h.href; if (seen.has(k)) return false; seen.add(k); return true; });
    return {
      ok: true,
      query: q,
      total: uniq.length,
      hits: uniq.slice(offset, offset + limit).map((h) => ({ doc: h.doc, href: h.href, snippet: h.snippet })),
    };
  }

  // 全局公开搜索（默认）——保留原 FTS5 路径 + 字符串回退
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
        return {
          ok: true,
          query: q,
          total,
          hits: rows.map((r) => ({
            doc: (r.title || r.doc || ''),
            href: 'd/' + (r.doc || '') + '/',
            snippet: (r.body || r.title || '').replace(/\[page:[^\]]*\]/g, '').trim(),
          })),
        };
      }
    } catch (e) { /* fall through */ }
  }
  return publicStringSearch(siteRoot, q, { limit, offset });
}

function scanDoc(docId, dir, hrefPrefix, groups) {
  const out = [];
  try {
    const kw = JSON.parse(fs.readFileSync(path.join(dir, 'keywords.json'), 'utf8')) || { keywords: [] };
    for (const k of (kw.keywords || [])) {
      const name = String(k.name || '');
      if (hitScore(name, groups) !== -1) {
        out.push({
          doc: name, href: hrefPrefix + docId + '/' + (k.href || '').replace(/\\/g, '/'),
          snippet: '', score: 10,
        });
      }
    }
  } catch (_) {}
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(dir, 'search-index.json'), 'utf8')) || { records: [] };
    for (const rec of (idx.records || [])) {
      const text = String(rec.text || '');
      const pages = [];
      const re = /\[page:([^\]]+)\]([\s\S]*?)(?=\[page:|$)/g;
      let m;
      while ((m = re.exec(text))) pages.push({ url: m[1], seg: m[2] });
      if (!pages.length) pages.push({ url: '', seg: text });
      for (const p of pages) {
        const score = hitScore(p.seg, groups);
        if (score === -1) continue;
        const first = (groups[0] && (groups[0].term || (groups[0].terms || [''])[0])) || '';
        const at = p.seg.toLowerCase().indexOf(first);
        const ctx = p.seg.replace(/\s+/g, ' ').trim();
        const snippet = ctx.slice(Math.max(0, at - 30), at + 60);
        out.push({
          doc,
          href: hrefPrefix + docId + '/' + (p.url || '').replace(/\\/g, '/'),
          snippet,
          score: score + 6,
        });
      }
    }
  } catch (_) {}
  return out;
}

/** 纯静态回退：读取 site-index.json 字符串扫描（公开库）。 */
function publicStringSearch(siteRoot, query, { limit = 10, offset = 0 } = {}) {
  const idx = loadSiteIndex(siteRoot);
  const q = String(query || '').trim();
  if (!q) return { ok: true, query: q, hits: [], total: 0 };
  const groups = parseQueryTerms(q);
  const kwHits = [];
  for (const k of (idx.keywords || [])) {
    const name = (k.name || '').toLowerCase();
    const doc = (k.doc || '');
    if (hitScore(k.name || '', groups) !== -1) {
      kwHits.push({ doc, snippet: (k.name || ''), href: k.href || ('d/' + doc + '/'), score: 10 });
    }
  }
  const hits = [];
  const seen = new Set();
  for (const rec of (idx.records || [])) {
    const text = rec.text || '';
    const pages = [];
    const re = /\[page:([^\]]+)\]([\s\S]*?)(?=\[page:|$)/g;
    let m;
    while ((m = re.exec(text))) pages.push({ url: m[1], seg: m[2] });
    if (!pages.length) pages.push({ url: '', seg: text });
    for (const p of pages) {
      const score = hitScore(p.seg, groups);
      if (score === -1) continue;
      const first = (groups[0] && (groups[0].term || (groups[0].terms || [''])[0])) || '';
      const at = p.seg.toLowerCase().indexOf(first);
      const ctx = p.seg.replace(/\s+/g, ' ').trim();
      const snippet = ctx.slice(Math.max(0, at - 30), at + 60);
      const href = 'd/' + (rec.doc || '') + '/' + (p.url || '').replace(/\\/g, '/');
      const key = href + '::' + snippet;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ doc: rec.doc || '', href, snippet, score: score + 6 });
    }
  }
  const all = kwHits.concat(hits);
  all.sort((a, b) => (b.score || 0) - (a.score || 0));
  const uniq = [];
  const uniqSet = new Set();
  for (const h of all) {
    const key = h.href + '::' + (h.snippet || h.doc || '');
    if (uniqSet.has(key)) continue;
    uniqSet.add(key);
    uniq.push(h);
  }
  return { ok: true, query: q, total: uniq.length, hits: uniq.slice(offset, offset + limit).map((h) => ({ doc: h.doc || '', href: h.href || '', snippet: h.snippet || '' })) };
}

/** 在指定文档 id 范围内检索（分享链接场景），结果链接指向 p/。 */
function searchScoped(siteRoot, query, docIds, { limit = 10, offset = 0 } = {}) {
  return search(siteRoot, query, { limit, offset, scopeIds: docIds });
}

/** 搜索某用户自己的全部私有文档（用于「我的文档」私密搜索） */
function searchUserPrivate(siteRoot, query, username, { limit = 10, offset = 0 } = {}) {
  return search(siteRoot, query, { limit, offset, username, onlyPrivate: true });
}

module.exports = { search, searchScoped, searchUserPrivate, loadSiteIndex, rebuild, buildFtsQuery };