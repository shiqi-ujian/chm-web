'use strict';
// preview.js — 5z 风格阅读壳：紫色主题 / 深色模式 / __TOC__ JSON 目录树(JS 渲染+折叠记忆) /
// 面包屑 / 上一页下一页 / 页内高亮搜索(同源 iframe contentDocument) / 全站搜索增强
// (空格AND、A|B任一、"短语"精确、分类过滤、只匹配标题、结果内筛选、相关度排序)。
// 同时写出 keywords.json / search-index.json / __chm_nav.html，保持纯静态自包含。
const fs = require('fs');
const path = require('path');
const { parseHhcFile } = require('./hhc');
const parseHhk = require('./hhk').parseHhk;
const { translate } = require('./translations');
const { readText } = require('./charset');

// Number of HTML pages per index-record / chunk for full-text search.
const CHUNK_SIZE = 64;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escAttr(s) {
  return esc(s).replace(/'/g, '&#39;');
}

function relPath(baseDir, href) {
  if (!href) return '#';
  try {
    // 外部协议（http/https/mailto…）保持原样；相对路径先对齐到文档根再求相对，
    // 避免 path.relative 把相对目标按进程 CWD 解析成 ../../../../ 容器绝对路径。
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
    if (!path.isAbsolute(href)) href = path.join(baseDir, href);
    return path.relative(baseDir, href).replace(/\\/g, '/').split('#')[0] || '#';
  } catch { return '#'; }
}

// tree → HTML 列表（__chm_nav.html 用，保持兼容）
function renderNodes(nodes, dir) {
  return nodes.map((n) => {
    const hasKids = n.children && n.children.length;
    const href = relPath(dir, n.href);
    const label = translate(n.name) || '（无标题）';
    const kids = hasKids ? '<ul>' + renderNodes(n.children, dir) + '</ul>' : '';
    const cls = hasKids ? ' folder' : '';
    return `<li class="${cls.trim()}" data-href="${escAttr(href)}">` +
      (hasKids ? '<span class="tw toggle"></span>' : '<span class="tw"></span>') +
      `<a href="${escAttr(href)}">${esc(label)}</a>${kids}</li>`;
  }).join('\n');
}
function renderTree(nodes, dir) {
  return '<ul>' + renderNodes(nodes, dir) + '</ul>';
}

// tree → __TOC__ JSON：[{i,n,u,c}]，u 为相对阅读壳的 URL（leaf 才有），c 为子树。
// i 全局唯一递增：递归子节点后必须用返回的 next 推进计数器，否则父级后续
// 兄弟与子节点编号冲突 → setActive/折叠记忆按 i 匹配会错乱（多行同时高亮）。
function toTocJson(nodes, dir, start) {
  let i = start;
  const out = [];
  for (const n of nodes) {
    const node = { i: i++, n: translate(n.name) || n.name || '' };
    const href = relPath(dir, n.href);
    if (href && href !== '#') node.u = href;
    if (n.children && n.children.length) {
      const sub = toTocJson(n.children, dir, i);
      node.c = sub.nodes;
      i = sub.next; // 关键：子节点占用过的编号要跳过
    }
    out.push(node);
  }
  return { nodes: out, next: i };
}

const SHELL_CSS = String.raw`
:root{--bg:#f6f7fb;--panel:#fff;--border:#e2e8f0;--text:#1e293b;--muted:#64748b;--accent:#7c3aed;--accent-soft:#f3e8ff;--hover:#f1f5f9;--shadow:0 1px 3px rgba(15,23,42,.08);--hl:#fff3b0}
[data-theme="dark"]{--bg:#0f172a;--panel:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#94a3b8;--accent:#a78bfa;--accent-soft:#312e81;--hover:#334155;--shadow:0 1px 3px rgba(0,0,0,.4);--hl:#6b5b00}
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%}
body{font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text)}
a{color:var(--accent);text-decoration:none}
#app{display:flex;height:100vh;height:100dvh;overflow:hidden}
#mask{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:55;display:none}
#mask.on{display:block}
/* ---------- 侧栏 ---------- */
#sidebar{width:320px;min-width:320px;display:flex;flex-direction:column;background:var(--panel);border-right:1px solid var(--border)}
.side-head{padding:12px 14px;border-bottom:1px solid var(--border)}
.brand{font-size:16px;font-weight:700;color:var(--accent);letter-spacing:.5px}
.version{font-size:11.5px;color:var(--muted);margin:2px 0 10px}
.search-box{position:relative}
.search-box input{width:100%;padding:9px 32px 9px 12px;border:1px solid var(--border);border-radius:9px;font-size:13.5px;background:var(--bg);color:var(--text);outline:none}
.search-box input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.search-box .ico{position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none}
#results{position:absolute;top:42px;left:0;right:0;background:var(--panel);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.14);max-height:60vh;overflow:auto;z-index:90}
#results .empty{padding:12px 14px;color:var(--muted);font-size:13px}
.res-item{display:block;padding:9px 14px;border-bottom:1px solid var(--hover);cursor:pointer}
.res-item:last-child{border-bottom:0}
.res-item:hover,.res-item.sel{background:var(--accent-soft)}
.res-item .t{font-weight:600;font-size:13.5px;color:var(--text)}
.res-item .t mark{background:transparent;color:var(--accent)}
.res-item .p{display:block;color:var(--muted);font-size:12px;margin-top:2px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.res-item .r{float:right;font-size:11px;color:var(--muted)}
.search-options{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--muted)}
.opt-label{display:inline-flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap}
.opt-select{border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:12px;padding:2px 4px;outline:none}
.opt-btn{border:1px solid var(--border);background:var(--bg);color:var(--muted);border-radius:6px;font-size:12px;padding:2px 8px;cursor:pointer;white-space:nowrap}
.opt-btn:hover{border-color:var(--accent);color:var(--accent)}
.opt-btn.on{background:var(--accent-soft);color:var(--accent);border-color:var(--accent)}
#toc{flex:1;overflow:auto;padding:8px 0}
.toc-node{user-select:none}
.toc-row{display:flex;align-items:center;padding:5px 14px 5px 6px;cursor:pointer;border-radius:6px;margin:1px 6px;gap:4px;font-size:13.5px}
.toc-row:hover{background:var(--hover)}
.toc-row.active{background:var(--accent-soft);color:var(--accent);font-weight:600}
.toc-row .tw{width:0;height:0;border:5px solid transparent;border-left-color:var(--muted);flex:0 0 auto;transition:transform .15s}
.toc-row.branch.open>.tw{transform:rotate(90deg)}
.toc-row .tt{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.toc-kids{display:none}
.toc-row.open + .toc-kids{display:block}
.side-foot{padding:8px 14px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
#theme-btn{border:1px solid var(--border);background:var(--bg);border-radius:8px;padding:5px 12px;cursor:pointer;font-size:14px}
#theme-btn:hover{border-color:var(--accent)}
/* ---------- 主区 ---------- */
#main{flex:1;min-width:0;display:flex;flex-direction:column}
#topbar{height:48px;min-height:48px;display:flex;align-items:center;gap:8px;padding:0 10px;background:var(--panel);border-bottom:1px solid var(--border)}
.tb-btn{border:1px solid var(--border);background:var(--bg);border-radius:8px;padding:5px 10px;cursor:pointer;font-size:14px;color:var(--text);line-height:1}
.tb-btn:hover{border-color:var(--accent);color:var(--accent)}
#crumb{flex:1;min-width:0;font-size:13px;color:var(--muted);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
#crumb b{color:var(--accent);font-weight:600}
#page-search-bar{display:none;align-items:center;gap:6px;padding:6px 10px;background:var(--accent-soft);border-bottom:1px solid var(--border)}
#page-search-bar.on{display:flex}
#page-search-bar input{flex:1;min-width:0;padding:5px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;outline:none;background:var(--panel);color:var(--text)}
#page-search-bar input:focus{border-color:var(--accent)}
#page-search-bar button{border:1px solid var(--border);background:var(--panel);border-radius:6px;padding:4px 9px;cursor:pointer;font-size:13px}
#page-search-bar .cnt{font-size:12px;color:var(--muted);white-space:nowrap}
#frame{flex:1;width:100%;border:0;background:#fff}
mark.wz-hl{background:var(--hl);color:inherit;padding:0 1px;border-radius:2px}
mark.wz-hl.cur{outline:2px solid var(--accent)}
/* ---------- 移动端底部操作条 ---------- */
#mobile-bar{display:none}
@media(max-width:680px){
  #sidebar{position:fixed;left:0;top:0;bottom:0;z-index:60;transform:translateX(-100%);transition:transform .22s ease;box-shadow:2px 0 12px rgba(0,0,0,.18);width:86vw;max-width:340px;min-width:0}
  #sidebar.open{transform:translateX(0)}
  #topbar{gap:4px;padding:0 6px}
  .tb-btn{padding:5px 8px;font-size:13px}
  #frame{-webkit-text-size-adjust:100%}
  /* 底部固定条：目录 / 字号 / 上一页 / 下一页 / 页内搜索 */
  #mobile-bar{display:flex;align-items:center;justify-content:space-around;height:52px;min-height:52px;background:var(--panel);border-top:1px solid var(--border);position:sticky;bottom:0;z-index:50}
  #mobile-bar .mb-btn{flex:1;text-align:center;border:0;background:transparent;color:var(--text);font-size:13px;padding:4px 0;line-height:1.2;cursor:pointer}
  #mobile-bar .mb-btn:hover{color:var(--accent)}
  #mobile-bar .mb-btn b{display:block;font-size:16px;font-weight:600}
  #main{padding-bottom:env(safe-area-inset-bottom)}
  #app{min-height:0}
}
@media(max-width:380px){
  .tb-btn{width:34px;padding:0}
  #crumb{max-width:30vw}
}
`;

// 壳内 JS（独立函数生成，避免与外壳模板字符串插值冲突）
function shellJs(t) {
  return `(function(){
'use strict';
var tocData = window.__TOC__ || [];
var frame = document.getElementById('frame');
var tocEl = document.getElementById('toc');
var q = document.getElementById('q');
var resultsEl = document.getElementById('results');
var crumbEl = document.getElementById('crumb');
var mask = document.getElementById('mask');
var sidebar = document.getElementById('sidebar');
var home = '${escAttr(t.home)}';
var title = '${escAttr(t.title)}';

/* ---------- 主题（深色/浅色，记忆 + 跟随系统） ---------- */
var theme = (function(){ try { return localStorage.getItem('chm-theme') || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch(e){ return 'light'; } })();
document.documentElement.dataset.theme = theme;
var themeBtn = document.getElementById('theme-btn');
if(themeBtn){
  themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
  themeBtn.addEventListener('click', function(){
    var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('chm-theme', next); } catch(e){}
    themeBtn.textContent = next === 'dark' ? '☀️' : '🌙';
  });
}

/* ---------- 目录树 ---------- */
var urlToNode = new Map();
var leafList = [];
var openSet = new Set();
(function(){
  try { openSet = new Set(JSON.parse(localStorage.getItem('chm-open') || 'null') || []); } catch(e){}
  function walk(nodes){
    for (var i=0;i<nodes.length;i++){
      var n = nodes[i];
      if (n.u) { urlToNode.set(n.u, n); leafList.push(n); }
      if (n.c) {
        if (openSet.size === 0) openSet.add(n.i); // 首次：全部展开
        walk(n.c);
      }
    }
  }
  walk(tocData);
})();
function saveOpen(){ try { localStorage.setItem('chm-open', JSON.stringify(Array.from(openSet))); } catch(e){} }
function renderNode(n, depth){
  var div = document.createElement('div');
  div.className = 'toc-node';
  div.dataset.id = n.i;
  var row = document.createElement('div');
  row.className = 'toc-row' + (n.c ? ' branch' : ' leaf');
  row.style.paddingLeft = (10 + depth * 14) + 'px';
  if (openSet.has(n.i)) row.classList.add('open');
  if (n.c) {
    var tw = document.createElement('span');
    tw.className = 'tw';
    tw.title = openSet.has(n.i) ? '折叠' : '展开';
    row.appendChild(tw);
    // 箭头：仅折叠/展开（阻止冒泡，避免触发打开页面）
    tw.addEventListener('click', function(e){
      e.stopPropagation();
      if (openSet.has(n.i)) openSet.delete(n.i); else openSet.add(n.i);
      row.classList.toggle('open');
      tw.title = openSet.has(n.i) ? '折叠' : '展开';
      saveOpen();
    });
    // 分支整行：打开该节点自身页面（若有）
    if (n.u) {
      row.addEventListener('click', function(){ openPage(n.u); });
    }
  } else if (n.u) {
    // 叶子整行：打开页面
    row.addEventListener('click', function(){ openPage(n.u); });
  }
  var label = document.createElement('span');
  label.className = 'tt';
  label.textContent = n.n || '';
  row.appendChild(label);
  div.appendChild(row);
  if (n.c) {
    var kids = document.createElement('div');
    kids.className = 'toc-kids';
    n.c.forEach(function(k){ kids.appendChild(renderNode(k, depth + 1)); });
    div.appendChild(kids);
  }
  return div;
}
function renderTree(){
  tocEl.innerHTML = '';
  tocData.forEach(function(n){ tocEl.appendChild(renderNode(n, 0)); });
}
renderTree();

/* ---------- 打开页面 / 面包屑 / 上下页 ---------- */
function setActive(url){
  var list = tocEl.querySelectorAll('.toc-row');
  for (var i=0;i<list.length;i++) list[i].classList.remove('active');
  var node = urlToNode.get(url);
  if (!node) return;
  var rows = tocEl.querySelectorAll('.toc-row');
  for (var i=0;i<rows.length;i++){
    if (rows[i].parentElement.dataset.id === String(node.i)) rows[i].classList.add('active');
  }
}
function renderCrumb(url){
  var node = urlToNode.get(url);
  var parts = [];
  if (!node) parts.push(title);
  else {
    var chain = [];
    (function find(nodes){
      for (var i=0;i<nodes.length;i++){
        var n = nodes[i];
        if (n === node) { chain.push(n); return true; }
        if (n.c && find(n.c)) { chain.unshift(n); return true; }
      }
      return false;
    })(tocData);
    chain.forEach(function(n){ parts.push(n.n); });
    parts.unshift(title);
  }
  crumbEl.innerHTML = parts.map(function(p,i){ return i===parts.length-1 ? '<b>'+p+'</b>' : p; }).join(' › ');
}
function openPage(url){
  if (!url || url === '#') return;
  frame.src = url;
  setActive(url);
  renderCrumb(url);
  try { history.replaceState(null, '', '#' + url); } catch(e){}
  if (window.innerWidth <= 680) closeDrawer();
  try { localStorage.setItem('chm-last', url); } catch(e){}
  // 打开新页面后应用已保存的字号/阅读宽度（iframe 可能尚未加载，等 load 再设一次）
  try { setTimeout(function(){ applyFontSize(fontSizeStep); applyReadingStyle(); }, 30); } catch(e){}
  renderProgress();
}
/* ---------- 移动端底部操作条 ---------- */
var mbMenu = document.getElementById('mb-menu'), mbPrev = document.getElementById('mb-prev'), mbNext = document.getElementById('mb-next'), mbSearch = document.getElementById('mb-search');
var mbFontM = document.getElementById('mb-font-m'), mbFontP = document.getElementById('mb-font-p');
function openDrawer(){ sidebar.classList.add('open'); mask.classList.add('on'); }
function closeDrawer(){ sidebar.classList.remove('open'); mask.classList.remove('on'); }
if (mbMenu) mbMenu.addEventListener('click', openDrawer);
/* 正文字号：向 iframe 注入 font-size + 记忆 */
var fontSizeStep = (function(){ try { var v = parseInt(localStorage.getItem('chm-font-size') || '0', 10) || 0; return Math.max(-3, Math.min(3, v)); } catch(e){ return 0; } })();
function applyFontSize(step){
  step = Math.max(-3, Math.min(3, step));
  fontSizeStep = step;
  try { localStorage.setItem('chm-font-size', String(step)); } catch(e){}
  try {
    var d = frame.contentDocument;
    if (d && d.body) d.body.style.fontSize = step ? ((100 + step * 10) + '%') : '';
  } catch(e){}
  if (mbFontM) mbFontM.disabled = step <= -3;
  if (mbFontP) mbFontP.disabled = step >= 3;
}
/* 阅读排版：给 iframe 正文注入合适的行高/段落间距/最大宽度，桌面与移动通用 */
function applyReadingStyle(){
  try {
    var d = frame.contentDocument;
    if (!d || !d.body) return;
    d.body.style.lineHeight = '1.7';
    d.body.style.maxWidth = '860px';
    d.body.style.margin = '0 auto';
    var p = d.querySelectorAll('p,li,td,blockquote');
    for (var i=0;i<p.length;i++) p[i].style.lineHeight = '1.7';
  } catch(e){}
}
applyFontSize(fontSizeStep);
applyReadingStyle();
if (mbFontM) mbFontM.addEventListener('click', function(e){ e.stopPropagation(); applyFontSize(fontSizeStep - 1); });
if (mbFontP) mbFontP.addEventListener('click', function(e){ e.stopPropagation(); applyFontSize(fontSizeStep + 1); });
if (mbNext) mbNext.addEventListener('click', function(){ var i = leafList.indexOf(urlToNode.get(currentUrl())); if (i >= 0 && i < leafList.length-1) openPage(leafList[i+1].u); });
if (mbPrev) mbPrev.addEventListener('click', function(){ var i = leafList.indexOf(urlToNode.get(currentUrl())); if (i > 0) openPage(leafList[i-1].u); });
if (mbSearch) mbSearch.addEventListener('click', function(){ psBar.classList.add('on'); psQ.focus(); runPageSearch(); });
document.getElementById('menu-btn').addEventListener('click', openDrawer);
if (mask) mask.addEventListener('click', closeDrawer);
document.getElementById('prev-btn').addEventListener('click', function(){ var i = leafList.indexOf(urlToNode.get(currentUrl())); if (i > 0) openPage(leafList[i-1].u); });
document.getElementById('next-btn').addEventListener('click', function(){ var i = leafList.indexOf(urlToNode.get(currentUrl())); if (i >= 0 && i < leafList.length-1) openPage(leafList[i+1].u); });
function currentUrl(){
  try {
    var a = new URL(frame.contentWindow.location.href);
    return decodeURIComponent(a.pathname).replace(/^\\//, '');
  } catch(e){ return (frame.getAttribute('src')||'').replace(/^[^:]*:\\/\\//,''); }
}
/* ---------- 章节进度 / 返回顶部 ---------- */
var progressEl = document.getElementById('progress');
function renderProgress(){
  if (!progressEl) return;
  var idx = leafList.indexOf(urlToNode.get(currentUrl()));
  if (idx < 0){ progressEl.textContent = ''; return; }
  progressEl.textContent = (idx + 1) + ' / ' + leafList.length;
  progressEl.setAttribute('data-idx', idx);
}
function backToTop(){
  try {
    var w = frame.contentWindow, d = w && w.document;
    if (d && d.documentElement) d.documentElement.scrollTop = 0;
    if (d && d.body) d.body.scrollTop = 0;
    if (w && w.scrollTo) w.scrollTo(0, 0);
  } catch(e){}
}
var progBtn = document.getElementById('progress');
if (progBtn) progBtn.addEventListener('click', backToTop);
/* ---------- 移动端左右滑动切章 ---------- */
var touchStartX = 0, touchStartY = 0, touchStartT = 0;
function goPrevPage(){ var i = leafList.indexOf(urlToNode.get(currentUrl())); if (i > 0) openPage(leafList[i-1].u); }
function goNextPage(){ var i = leafList.indexOf(urlToNode.get(currentUrl())); if (i >= 0 && i < leafList.length-1) openPage(leafList[i+1].u); }
document.addEventListener('touchstart', function(e){
  if (window.innerWidth > 680) return;
  var t = e.touches && e.touches[0]; if (!t) return;
  touchStartX = t.clientX; touchStartY = t.clientY; touchStartT = Date.now();
}, { passive: true });
document.addEventListener('touchend', function(e){
  if (window.innerWidth > 680) return;
  var t = e.changedTouches && e.changedTouches[0]; if (!t) return;
  var dx = t.clientX - touchStartX, dy = t.clientY - touchStartY, dt = Date.now() - touchStartT;
  if (dt > 700 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 1.5) return;
  if (dx < 0) goNextPage(); else goPrevPage();
}, { passive: true });

/* ---------- 页内搜索（同源 iframe 高亮） ---------- */
var psBar = document.getElementById('page-search-bar');
var psQ = document.getElementById('ps-q');
var psCount = document.getElementById('ps-count');
var psCur = 0, psTotal = 0;
function fdoc(){ try { return frame.contentDocument; } catch(e){ return null; } }
function clearHl(doc){
  if (!doc) return;
  var marks = doc.querySelectorAll('mark.wz-hl');
  for (var i=marks.length-1;i>=0;i--){
    var m = marks[i], t = doc.createTextNode(m.textContent);
    m.parentNode.replaceChild(t, m);
  }
}
function highlightIn(doc, terms){
  clearHl(doc);
  if (!terms.length || !doc || !doc.body) return 0;
  var MAX_MARKS = 500;
  var walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */, null);
  var nodes = [], n;
  while ((n = walker.nextNode())) nodes.push(n);
  var count = 0;
  for (var ni = 0; ni < nodes.length && count < MAX_MARKS; ni++){
    var node = nodes[ni];
    var text = node.nodeValue || '', lower = text.toLowerCase();
    var hits = [];
    for (var ti = 0; ti < terms.length && count + hits.length < MAX_MARKS; ti++){
      var tl = terms[ti].toLowerCase(), from = 0, at;
      while ((at = lower.indexOf(tl, from)) !== -1){ hits.push([at, terms[ti].length]); from = at + terms[ti].length; }
    }
    if (!hits.length) continue;
    hits.sort(function(a,b){ return a[0]-b[0]; });
    var frag = doc.createDocumentFragment(), pos = 0;
    for (var hi = 0; hi < hits.length && count < MAX_MARKS; hi++){
      var h = hits[hi];
      if (h[0] > pos) frag.appendChild(doc.createTextNode(text.slice(pos, h[0])));
      var mk = doc.createElement('mark'); mk.className = 'wz-hl'; mk.textContent = text.slice(h[0], h[0]+h[1]);
      frag.appendChild(mk); pos = h[0]+h[1]; count++;
    }
    if (pos < text.length) frag.appendChild(doc.createTextNode(text.slice(pos)));
    node.parentNode.replaceChild(frag, node);
  }
  return count;
}
function extractTerms(input){
  var out = [], re = /"([^"]+)"|(\\S+)/g, m;
  while ((m = re.exec(input))){
    var t = (m[1] || m[2] || '').trim();
    if (t) out.push(t);
  }
  return out;
}
function runPageSearch(){
  var terms = extractTerms(psQ.value.trim());
  var doc = fdoc();
  if (!doc) { psCount.textContent = '无法访问'; return; }
  psTotal = highlightIn(doc, terms);
  psCur = 0;
  psCount.textContent = terms.length ? (psTotal ? ('1/' + psTotal) : '0 结果') : '';
  if (psTotal) scrollToMark(0);
}
function scrollToMark(i, keepFocus){
  var doc = fdoc(); if (!doc) return;
  var marks = doc.querySelectorAll('mark.wz-hl');
  for (var k=0;k<marks.length;k++) marks[k].classList.remove('cur');
  if (i < 0 || i >= marks.length) return;
  marks[i].classList.add('cur');
  psCur = i;
  psCount.textContent = (i+1) + '/' + marks.length;
  try { marks[i].scrollIntoView({ block: 'center' }); } catch(e){}
  // 只有用户主动用键盘导航（Enter/↑↓）时才把焦点交给 iframe，
  // 否则（搜索输入触发）会抢走输入框焦点，导致无法连续输入。
  if (keepFocus){ var w = frame.contentWindow; if (w && w.focus) w.focus(); }
}
document.getElementById('page-search-btn').addEventListener('click', function(){
  psBar.classList.toggle('on');
  if (psBar.classList.contains('on')){ psQ.focus(); runPageSearch(); }
  else { clearHl(fdoc()); psCount.textContent=''; }
});
if (psQ){
  var psTimer = null;
  var psRun = function(){
    psTimer = null;
    runPageSearch();
  };
  psQ.addEventListener('input', function(){
    if (psTimer) window.clearTimeout(psTimer);
    psTimer = window.setTimeout(psRun, 250);
  });
  psQ.addEventListener('keydown', function(e){
    if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); psCur = (psCur + 1) % (psTotal || 1); scrollToMark(psCur, true); }
    else if (e.key === 'Enter' && e.shiftKey){ e.preventDefault(); psCur = (psCur - 1 + (psTotal||1)) % (psTotal||1); scrollToMark(psCur, true); }
    else if (e.key === 'ArrowUp' && e.altKey){ e.preventDefault(); psCur = (psCur - 1 + (psTotal||1)) % (psTotal||1); scrollToMark(psCur, true); }
    else if (e.key === 'ArrowDown' && e.altKey){ e.preventDefault(); psCur = (psCur + 1) % (psTotal || 1); scrollToMark(psCur, true); }
    else if (e.key === 'Escape'){ psBar.classList.remove('on'); clearHl(fdoc()); }
  });
}
document.getElementById('ps-prev').addEventListener('click', function(){ if (psTotal) { psCur = (psCur - 1 + psTotal) % psTotal; scrollToMark(psCur, true); } });
document.getElementById('ps-next').addEventListener('click', function(){ if (psTotal) { psCur = (psCur + 1) % psTotal; scrollToMark(psCur, true); } });
document.getElementById('ps-close').addEventListener('click', function(){ psBar.classList.remove('on'); clearHl(fdoc()); });

/* ---------- 全站搜索（keywords + search-index，增强语法） ---------- */
var kwData = [], ftData = [], kwReady = false, ftReady = false;
var withinSet = null;  // 结果内筛选
var lastQuery = '', lastTerms = [], lastHits = [];
if (window.fetch){
  fetch('keywords.json').then(function(r){ return r.json(); }).then(function(j){ kwData = (j && j.keywords) || []; kwReady = true; }).catch(function(){ kwReady = true; });
  fetch('search-index.json').then(function(r){ return r.json(); }).then(function(j){ ftData = (j && j.records) || []; ftReady = true; }).catch(function(){ ftReady = true; });
}
function parseQuery(input){
  var groups = [], re = /"([^"]+)"|(\\S+)/g, m;
  while ((m = re.exec(input))){
    if (m[1]) groups.push({ type: 'phrase', term: m[1].toLowerCase() });
    else {
      var parts = m[2].split('|').map(function(s){ return s.trim().toLowerCase(); }).filter(Boolean);
      if (parts.length > 1) groups.push({ type: 'or', terms: parts });
      else if (parts.length) groups.push({ type: 'and', term: parts[0] });
    }
  }
  return groups;
}
function hitScore(text, groups){
  var score = 0, t = text.toLowerCase();
  for (var i=0;i<groups.length;i++){
    var g = groups[i];
    if (g.type === 'and'){ if (t.indexOf(g.term) === -1) return -1; score += 2; }
    else if (g.type === 'phrase'){ if (t.indexOf(g.term) === -1) return -1; score += 4; }
    else {
      var any = false;
      for (var j=0;j<g.terms.length;j++){ if (t.indexOf(g.terms[j]) !== -1){ any = true; score += 2; } }
      if (!any) return -1;
    }
  }
  return score;
}
function catOf(url){ return url.indexOf('/') === -1 ? '（根）' : url.split('/')[0]; }
function runSearch(raw){
  var query = raw.trim();
  if (!query){ resultsEl.hidden = true; lastHits = []; return; }
  var groups = parseQuery(query);
  var titleOnly = document.getElementById('titleOnly').checked;
  var cat = document.getElementById('catFilter').value;
  var hits = [];
  var titleHit = {};
  if (!titleOnly){
    for (var i=0;i<ftData.length;i++){
      var rec = ftData[i].text || '';
      var score = hitScore(rec, groups);
      if (score === -1) continue;
      // 拆出每个 [page:...] 段单独计分
      var re = /\\[page:([^\\]]+)\\]([\\s\\S]*?)(?=\\[page:|$)/g, m;
      while ((m = re.exec(rec))){
        var url = m[1], seg = m[2];
        var s2 = hitScore(seg, groups);
        if (s2 === -1) continue;
        if (cat !== 'all' && catOf(url) !== cat) continue;
        if (withinSet && !withinSet[url]) continue;
        var at = seg.toLowerCase().indexOf(groups.length ? (groups[0].term || (groups[0].terms||[])[0] || '') : '');
        var ctx = seg.replace(/\\s+/g, ' ').trim();
        var snippet = ctx.slice(Math.max(0, at - 30), at + 60);
        hits.push({ url: url, title: url, score: s2 + 6, snip: snippet });
        titleHit[url] = 1;
      }
    }
  }
  (kwData || []).forEach(function(k){
    if (!k.name || !k.href) return;
    var url = String(k.href).replace(/\\\\/g, '/');
    if (cat !== 'all' && catOf(url) !== cat) return;
    if (withinSet && !withinSet[url]) return;
    var s = hitScore(k.name + ' ' + (k.title||''), groups);
    if (s === -1) return;
    hits.push({ url: url, title: k.name, score: s + 10, snip: k.title || '' });
  });
  // 排序：相关度
  hits.sort(function(a,b){ return b.score - a.score; });
  var seen = {}, uniq = [];
  hits.forEach(function(h){ if (!seen[h.url]){ seen[h.url] = 1; uniq.push(h); } });
  renderResults(uniq.slice(0, 30), extractTerms(query));
}
function renderResults(hits, terms){
  lastHits = hits;
  resultsEl.innerHTML = '';
  if (!hits.length){ resultsEl.innerHTML = '<div class="empty">无匹配结果</div>'; resultsEl.hidden = false; return; }
  // XSS 修复：全文/关键字索引可能来自任意上传文档（页面标题、正文），
  // 绝不能直接把其内容当 HTML 拼进 DOM —— 先转义再环绕高亮 <mark>，杜绝脚本注入。
  function escapeHtml(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function hl(s){
    var out = escapeHtml(String(s == null ? '' : s));
    terms.slice().sort(function(a,b){ return (b||'').length - (a||'').length; }).forEach(function(t){
      var te = escapeHtml(String(t || ''));
      if (!te) return;
      out = out.split(te).join('<mark>' + te + '</mark>');
    });
    return out;
  }
  hits.forEach(function(h, i){
    var d = document.createElement('div');
    d.className = 'res-item' + (i === 0 ? ' sel' : '');
    d.innerHTML = '<span class="r">相关度 ' + h.score + '</span><span class="t">' + hl(h.title) + '</span><span class="p">' + hl(h.snip || '') + '</span>';
    d.addEventListener('click', function(){ openPage(h.url); resultsEl.hidden = true; });
    resultsEl.appendChild(d);
  });
  resultsEl.hidden = false;
}
function buildCats(){
  var cats = {};
  (kwData||[]).forEach(function(k){ if (k.href) cats[catOf(String(k.href).replace(/\\\\/g,'/'))] = 1; });
  (ftData||[]).forEach(function(rec){
    var re = /\\[page:([^\\]]+)\\]/g, m;
    while ((m = re.exec(rec.text||''))) cats[catOf(m[1])] = 1;
  });
  var sel = document.getElementById('catFilter');
  Object.keys(cats).sort().forEach(function(c){
    var o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
  });
}
var searchTimer = null;
if (q){
  q.addEventListener('input', function(){
    var v = q.value;
    window.clearTimeout(searchTimer);
    if (!v){ resultsEl.hidden = true; return; }
    searchTimer = window.setTimeout(function(){ runSearch(v); }, 180);
  });
  q.addEventListener('keydown', function(e){
    if (e.key === 'Escape'){ q.value=''; resultsEl.hidden = true; }
    else if (e.key === 'Enter'){
      e.preventDefault();
      var sel = resultsEl.querySelector('.res-item.sel');
      if (sel) sel.click();
      else { var first = resultsEl.querySelector('.res-item'); if (first) first.click(); }
    }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      var items = resultsEl.querySelectorAll('.res-item');
      if (!items.length) return;
      var idx = 0;
      for (var i=0;i<items.length;i++) if (items[i].classList.contains('sel')) idx = i;
      idx = e.key === 'ArrowDown' ? Math.min(items.length-1, idx+1) : Math.max(0, idx-1);
      for (var j=0;j<items.length;j++) items[j].classList.remove('sel');
      items[idx].classList.add('sel');
      try { items[idx].scrollIntoView({ block: 'nearest' }); } catch(_){}
    }
  });
}
document.addEventListener('click', function(e){
  if (resultsEl.contains(e.target) || e.target === q) return;
  resultsEl.hidden = true;
});
document.getElementById('titleOnly').addEventListener('change', function(){ if (q.value.trim()) runSearch(q.value); });
document.getElementById('catFilter').addEventListener('change', function(){ if (q.value.trim()) runSearch(q.value); });
var withinBtn = document.getElementById('within-btn');
if (withinBtn){
  withinBtn.addEventListener('click', function(){
    if (!lastHits.length && !q.value.trim()) return;
    if (!withinSet){
      withinSet = {};
      lastHits.forEach(function(h){ withinSet[h.url] = 1; });
      withinBtn.classList.add('on');
      withinBtn.textContent = '结果内筛选 ✓';
    } else {
      withinSet = null;
      withinBtn.classList.remove('on');
      withinBtn.textContent = '结果内筛选';
    }
    if (q.value.trim()) runSearch(q.value);
  });
}
buildCats();

/* ---------- 初始化 ---------- */
(function init(){
  var start = (location.hash || '').replace('#', '');
  if (!start || !urlToNode.has(start)) {
    try { start = localStorage.getItem('chm-last') || ''; } catch(e){ start = ''; }
    if (!start || !urlToNode.has(start)) start = home;
  }
  openPage(start);
  try { localStorage.setItem('chm-last', start); } catch(e){}
})();
})();
`;
}

function shell({ title, home, tocJson }) {
  return `<!doctype html><html lang="zh" data-theme="light"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escAttr(title || '文档')}</title>
<style>${SHELL_CSS}</style>
</head><body>
<div id="app">
  <div id="mask"></div>
  <aside id="sidebar">
    <div class="side-head">
      <div class="brand">${escAttr(title || '文档')}</div>
      <div class="version">目录 · 可折叠 · Ctrl+K 搜索</div>
      <div class="search-box">
        <input id="q" type="search" placeholder="搜索…（空格=交集 / A|B=任一 / 「短语」=精确）" autocomplete="off">
        <span class="ico">⌕</span>
        <div id="results" hidden></div>
      </div>
      <div class="search-options">
        <label class="opt-label"><input type="checkbox" id="titleOnly"> 只匹配标题</label>
        <select id="catFilter" class="opt-select"><option value="all">全部分类</option></select>
        <button id="within-btn" class="opt-btn" type="button" title="在当前搜索结果中继续筛选">结果内筛选</button>
      </div>
    </div>
    <nav id="toc" aria-label="目录"></nav>
    <div class="side-foot">
      <button id="theme-btn" title="切换深色模式" type="button">🌙</button>
    </div>
  </aside>
  <main id="main">
    <header id="topbar">
      <button class="tb-btn" id="menu-btn" title="目录" aria-label="打开目录" type="button">☰</button>
      <button class="tb-btn" id="home-btn" title="返回主页" aria-label="返回主页" type="button">🏠</button>
      <span id="crumb"></span>
      <button class="tb-btn" id="prev-btn" title="上一页" type="button">↑</button>
      <button class="tb-btn" id="next-btn" title="下一页" type="button">↓</button>
      <button class="tb-btn" id="page-search-btn" title="页内搜索（Alt+↑↓ 跳转）" type="button">🔍</button>
      <button class="tb-btn" id="progress" title="第 N / M 章 · 点击回到顶部" type="button"></button>
    </header>
    <div id="page-search-bar">
      <input id="ps-q" type="search" placeholder="在当前页面中查找…" autocomplete="off">
      <button id="ps-prev" title="上一个" type="button">↑</button>
      <span class="cnt" id="ps-count"></span>
      <button id="ps-next" title="下一个" type="button">↓</button>
      <button id="ps-close" title="关闭" type="button">✕</button>
    </div>
    <iframe id="frame" title="正文" src=""></iframe>
    <div id="mobile-bar" aria-label="移动端操作">
      <button class="mb-btn" id="mb-menu" type="button"><b>☰</b>目录</button>
      <button class="mb-btn" id="mb-font-m" type="button"><b>A-</b>字号</button>
      <button class="mb-btn" id="mb-prev" type="button"><b>↑</b>上一页</button>
      <button class="mb-btn" id="mb-next" type="button"><b>↓</b>下一页</button>
      <button class="mb-btn" id="mb-search" type="button"><b>🔍</b>查找</button>
    </div>
  </main>
</div>
<script>window.__TOC__ = ${JSON.stringify(tocJson)};</script>
<script>${shellJs({ title, home })}</script>
</body></html>`;
}

// ---- full-text search index generation ----

/** Crude HTML→plain-text: strip tags/scripts/styles, collapse whitespace. */
function htmlToText(html) {
  const s = String(html == null ? '' : html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return s.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

/** Build a full-text search index from the HTML pages under docRoot. */
function buildFullText(docDir) {
  // The synthetic shells we generate ourselves must not be indexed.
  const skip = new Set(['index.html', '__chm_nav.html']);
  const allFiles = [];
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (skip.has(e.name)) continue;
      if (e.isDirectory()) { walk(full); continue; }
      if (/\.(html?)$/i.test(e.name)) allFiles.push(full);
    }
  })(docDir);

  const records = [];
  const titles = [];
  const chunks = [];
  const flush = () => { if (chunks.length) { records.push({ text: chunks.splice(0).join('\n') }); } };

  for (const file of allFiles) {
    let text = htmlToText(readText(file));
    if (!text) continue;
    const rel = path.relative(docDir, file).replace(/\\/g, '/');
    titles.push({ file: rel, title: text.slice(0, 120) });
    chunks.push('[page:' + rel + ']\n' + text.slice(0, 6000));
    if (chunks.length >= CHUNK_SIZE) flush();
  }
  flush();
  // 标题记录同时进入 records，让服务端 /api/search 能把正文命中的“章节名”展示出来
  for (const t of titles) {
    records.push({ text: '[page:' + t.file + ']\n' + t.title });
  }
  return { records, titles };
}

module.exports = { build, renderTree, esc, buildFullText };

function build({ outDir, hhcFile, hhkFile, title }) {
  const dir = path.resolve(outDir);
  let tree = [];
  if (hhcFile && fs.existsSync(hhcFile)) tree = parseHhcFile(hhcFile, dir);

  // 找首页：优先 start/index；否则取目录树第一个有 href 的节点
  let homeHref = 'start.htm';
  const top = tree.find((n) => n.href && /\/(index|start)\.?/.test(n.href));
  if (top && top.href) homeHref = relPath(dir, top.href);
  else {
    const first = tree.find((n) => n.href);
    if (first && first.href) homeHref = relPath(dir, first.href);
  }
  // 兜底：若算出的首页是外部协议(CHM 内部 / 绝对 URL)或对应文件不存在，
  // 回退到文档内真实存在的内容首页。注意 index.html 是本阅读壳本身（不能当首页，
  // 否则 iframe 套娃）；故只挑真实内容页。
  {
    let candidate = path.resolve(dir, homeHref);
    const isExternal = /^(?:[a-z]+:|mk:@)/i.test(homeHref) || /^([a-zA-Z]:[\\/]|\/)/.test(homeHref);
    if (isExternal || !fs.existsSync(candidate)) {
      // 候选真实首页（升序优先级；排除我们生成的壳文件）
      const findReal = (fns) => {
        for (const f of fns) {
          const p = path.join(dir, f);
          if (fs.existsSync(p) && fs.statSync(p).isFile() && !shellFile(f)) return f;
        }
        return null;
      };
      const shellFile = (f) => /^(index\.html?|__chm_nav\.html|keywords\.json|search-index\.json)$/i.test(f);
      const real = findReal(['index.htm', 'start.htm', 'start.html', 'main.htm', 'default.htm', 'PyWin32.html', 'win32_overview.html', 'overviews.html', 'Contents.html', 'Home.html'])
        || (() => { try {
            const rootFiles = fs.readdirSync(dir).filter((f) => /\.html?$/i.test(f) && !shellFile(f) && fs.statSync(path.join(dir, f)).isFile());
            return rootFiles.length ? rootFiles[0] : null;
          } catch { return null; } })();
      if (real) homeHref = path.relative(dir, path.join(dir, real)).replace(/\\/g, '/');
    }
  }

  const navHtml = renderTree(tree, dir);
  const tocJson = toTocJson(tree, dir, 0).nodes;
  let kw = { keywords: [] };
  if (hhkFile && fs.existsSync(hhkFile)) kw = { keywords: parseHhk(hhkFile, dir) };

  fs.writeFileSync(path.join(dir, 'keywords.json'), JSON.stringify(kw, null, 2));
  fs.writeFileSync(path.join(dir, 'search-index.json'),
    JSON.stringify(buildFullText(dir)));
  fs.writeFileSync(path.join(dir, 'index.html'), shell({ title: title || path.basename(dir), home: homeHref, tocJson }));
  fs.writeFileSync(path.join(dir, '__chm_nav.html'),
    '<!doctype html><html><head><meta charset="utf-8"><title>目录</title>' +
    `<style>ul{padding-left:16px}li{margin:3px 0}a{color:#7c3aed;text-decoration:none}</style></head>` +
    `<body>${navHtml}</body></html>`);
  return { navHtml, keywords: kw, title, homeHref, tocJson };
}
