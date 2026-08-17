'use strict';
// preview.js — convert the usable shell (index.html) for a converted CHM, in both
// records. Writes __chm_nav.html + keywords.json + search-index.json too.
const fs = require('fs');
const path = require('path');
const { parseHhcFile } = require('./hhc');
const parseHhk = require('./hhk').parseHhk;
const { translate } = require('./translations');

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
    return path.relative(baseDir, href).replace(/\\/g, '/').split('#')[0] || '#';
  } catch { return '#'; }
}

// tree → HTML 列表（含折叠箭头）
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

const SHELL_CSS = String.raw`
  :root{--b:#f7f8fa;--card:#fff;--ink:#1f2328;--mut:#57606a;--line:#d8dee4;--acc:#0969da;--accbg:#ddf4ff;--shadow:0 1px 3px rgba(0,0,0,.12)}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;height:100%}
  body{font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink);background:var(--b)}
  a{color:var(--acc);text-decoration:none}
  a:hover{text-decoration:underline}
  .topbar{position:fixed;top:0;left:0;right:0;z-index:50;height:52px;background:var(--card);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px;padding:0 10px;box-shadow:var(--shadow)}
  .topbar .btn{border:1px solid var(--line);background:#fff;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:14px;color:var(--ink);line-height:1}
  .topbar .btn:hover{background:var(--b)}
  .topbar .title{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .topbar .search{flex:1;max-width:420px;min-width:150px;margin-left:auto;position:relative}
  .topbar input[type=text]{width:100%;padding:6px 26px 6px 10px;border:1px solid var(--line);border-radius:20px;font-size:14px;outline:none}
  .topbar input[type=text]:focus{border-color:var(--acc)}
  .sres{position:absolute;top:40px;left:0;right:0;background:var(--card);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);max-height:60vh;overflow:auto;display:none;z-index:80}
  .sres.on{display:block}
  .sres .empty{padding:12px 14px;color:var(--mut);font-size:13px}
  .sres a{display:block;padding:9px 14px;border-bottom:1px solid var(--b);font-size:13.5px;color:var(--ink);text-decoration:none}
  .sres a:last-child{border-bottom:0}
  .sres a:hover{background:var(--b)}
  .sres a .k{font-weight:600;color:var(--acc)}
  .sres a .p{display:block;color:var(--mut);font-size:12px;margin-top:1px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .btn.close{flex:0 0 auto}
  .main{position:fixed;top:52px;left:0;right:0;bottom:0;display:flex}
  .toc{width:300px;min-width:300px;overflow:auto;background:var(--card);border-right:1px solid var(--line)}
  .content{flex:1;min-width:0;position:relative;background:#fff}
  #frame{width:100%;height:100%;border:0}
  #toc ul{list-style:none;padding-left:14px;margin:0}
  #toc > ul{padding-left:10px}
  #toc li{line-height:1.7;position:relative;margin:0}
  #toc li a{display:block;padding:4px 6px 4px 18px;color:var(--ink);border-radius:6px;font-size:13.5px}
  #toc li a:hover{background:var(--b)}
  #toc li.active > a{background:var(--accbg);color:var(--acc);font-weight:600}
  #toc li.folder > ul{display:none}
  #toc li.folder.open > ul{display:block}
  #toc .tw{position:absolute;left:2px;top:8px;width:0;height:0;border:5px solid transparent;border-left-color:var(--mut);cursor:pointer}
  #toc li.folder.open > .tw{border-left-color:transparent;border-top-color:var(--mut)}
  #toc li:not(.folder) .tw{display:none}
  .mask{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:55;display:none}
  .mask.on{display:block}
  .closeBtn{display:none}
  @media(max-width:680px){
    .topbar .title{max-width:34vw}
    .main{display:block}
    .content{position:absolute;top:52px;left:0;right:0;bottom:0}
    #frame{height:100%}
    .toc{position:fixed;left:0;top:52px;bottom:0;width:86vw;max-width:340px;z-index:60;transform:translateX(-100%);transition:transform .22s ease;box-shadow:2px 0 12px rgba(0,0,0,.18)}
    .toc.open{transform:translateX(0)}
    .closeBtn{display:inline-block}
  }
`;

function shell({ navHtml, title, home }) {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escAttr(title || '文档')}</title>
<style>${SHELL_CSS}</style>
</head><body>
<div class="topbar">
  <button class="btn" id="btnMenu" type="button" aria-label="目录">☰</button>
  <span class="title" id="docTitle">${escAttr(title || '文档')}</span>
  <div class="search"><input type="text" id="q" placeholder="搜索…" autocomplete="off">
    <div class="sres" id="sres"></div></div>
  <button class="btn close closeBtn" id="btnClose" aria-label="关闭" title="关闭目录">✕</button>
</div>
<div class="mask" id="mask"></div>
<div class="main">
  <aside class="toc" id="tocPane"><nav id="toc">${navHtml}</nav></aside>
  <section class="content"><iframe id="frame" src=""></iframe></section>
</div>
<script>
(function(){
  var frame=document.getElementById('frame');
  var toc=document.getElementById('toc');
  var pane=document.getElementById('tocPane');
  var mask=document.getElementById('mask');
  var btnMenu=document.getElementById('btnMenu');
  var btnClose=document.getElementById('btnClose');
  var q=document.getElementById('q');
  var links=document.querySelectorAll('#toc a');

  // 目录默认全部展开（更直观）
  document.querySelectorAll('#toc li.folder').forEach(function(li){ li.classList.add('open'); });

  // 折叠箭头
  document.querySelectorAll('#toc li.folder > .tw').forEach(function(tw){
    tw.addEventListener('click',function(e){ e.stopPropagation(); tw.parentElement.classList.toggle('open'); });
  });

  // 手机：汉堡开抽屉
  btnMenu.addEventListener('click',function(){ pane.classList.add('open'); mask.classList.add('on'); });
  if(btnClose) btnClose.addEventListener('click',function(){ pane.classList.remove('open'); mask.classList.remove('on'); });
  mask.addEventListener('click',function(){ pane.classList.remove('open'); mask.classList.remove('on'); });

  // 默认首页 + 恢复 hash
  var home=(location.hash||'').replace('#','');
  if(!home){ home='${escAttr(home)}'; }
  frame.src=home;
  if(home){ links.forEach(function(a){ if(a.getAttribute('href')===home){ a.parentElement.classList.add('active'); } }); }

  // 点目录 → 载页 + 高亮 + 更新 hash
  links.forEach(function(a){
    a.addEventListener('click',function(ev){
      ev.preventDefault();
      var href=a.getAttribute('href');
      if(href && href!=='#'){ frame.src=href; }
      links.forEach(function(x){ x.parentElement.classList.remove('active'); });
      a.parentElement.classList.add('active');
      if(href){ try{ history.replaceState(null,'','#'+href); }catch(e){} }
      pane.classList.remove('open'); mask.classList.remove('on');
    });
  });

  // 搜索：关键字(keywords.json) + 全文(search-index.json) 组合下拉
  var sres=document.getElementById('sres');
  var kwData=[], ftData=[], kwReady=false, ftReady=false, ftTimer=null;
  var ftCache={};            // 查询关键词 -> 全文命中([])
  if(window.fetch){
    fetch('keywords.json').then(function(r){return r.json();}).then(function(j){ kwData=(j&&j.keywords)||[]; kwReady=true; })
      .catch(function(){ kwReady=true; });
    fetch('search-index.json').then(function(r){return r.json();}).then(function(j){ ftData=(j&&j.records)||[]; ftReady=true; })
      .catch(function(){ ftReady=true; });
  }
  function openResult(href){
    if(href && href!=='#'){ frame.src=href; }
    links.forEach(function(a){ a.parentElement.classList.remove('active'); if(a.getAttribute('href')===href) a.parentElement.classList.add('active'); });
    if(href){ try{ history.replaceState(null,'','#'+href); }catch(e){} }
    sres.className='sres';
    q.value='';
  }
  function renderRows(rows,s){
    var uniq={}, out=[];
    rows.forEach(function(h){ var key=h.href; if(key&&!uniq[key]){ uniq[key]=1; out.push(h); } });
    var html='';
    if(!out.length){ html='<div class="empty">无匹配结果</div>'; }
    else { out.slice(0,14).forEach(function(h){
      html+='<a href="javascript:void 0)" data-href="'+escAttr(h.url)+'"><span class="k">'+esc(h.title)+'</span><span class="p">'+esc(h.hint||'')+'</span></a>';
    }); }
    sres.innerHTML=html; sres.className='sres on';
    Array.prototype.forEach.call(sres.querySelectorAll('a[data-href]'),function(a){
      a.addEventListener('click',function(ev){ ev.preventDefault(); openResult(a.getAttribute('data-href')); });
    });
  }
  function fullSearch(s){
    if(!ftReady) return;
    var sl=s.toLowerCase(), hits=[];
    for(var i=0;i<ftData.length && hits.length<10;i++){
      var rec=(ftData[i].text||'').toLowerCase();
      var at=rec.indexOf(sl);
      if(at===-1) continue;
      var page=(ftData[i].text.match(/\[page:([^\]]+)\]/)||[])[1]||'';
      var ctx=ftData[i].text.slice(Math.max(0,at-30),at+55).replace(/\s+/g,' ').trim();
      hits.push({title:page,hint:ctx,url:page});
    }
    ftCache[s]=hits;
    // 与关键字结果合并后重绘（若输入框还是当前查询）
    if(q.value.trim().toLowerCase()===s) redraw(s);
  }
  function redraw(s){
    var rows=(ftCache[s]||[]).slice();
    (kwData||[]).forEach(function(k){
      if((k.name||'').toLowerCase().indexOf(s)!==-1) rows.push({title:k.name,hint:k.title||k.href,url:k.href});
    });
    renderRows(rows);
  }
  q.addEventListener('input',function(){
    var s=q.value.trim().toLowerCase();
    if(!s){ sres.className='sres'; ftCache={}; }
    else {
      // 目录树过滤
      document.querySelectorAll('#toc li').forEach(function(li){
        var self=(li.textContent||'').toLowerCase().indexOf(s)!==-1;
        if(!s){ li.style.display=''; }
        else{
          var childShow=false;
          li.querySelectorAll(':scope > ul li').forEach(function(c){ if(c.style.display!=='none') childShow=true; });
          li.style.display=(self||childShow)?'':'none';
          if(li.classList.contains('folder')&&childShow) li.classList.add('open');
        }
      });
      // 关键字即时；全文做 250ms 防抖
      var kwRows=(kwData||[]).filter(function(k){ return (k.name||'').toLowerCase().indexOf(s)!==-1; })
        .map(function(k){ return {title:k.name,hint:k.title||k.href,url:k.href}; });
      if(!ftCache[s]) ftCache[s]=[];
      renderRows(kwRows.concat(ftCache[s]));
      window.clearTimeout(ftTimer);
      ftTimer=window.setTimeout(function(){ fullSearch(s); },250);
    }
  });
  document.addEventListener('click',function(e){
    if(e.target===q) return;
    if(!sres.contains(e.target)) sres.className='sres';
  });
})();
</script>
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
    let text = htmlToText(fs.readFileSync(file, 'utf8'));
    if (!text) continue;
    const rel = path.relative(docDir, file).replace(/\\/g, '/');
    titles.push({ file: rel, title: text.slice(0, 120) });
    chunks.push('[page:' + rel + ']\n' + text.slice(0, 6000));
    if (chunks.length >= CHUNK_SIZE) flush();
  }
  flush();
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

  const navHtml = renderTree(tree, dir);
  let kw = { keywords: [] };
  if (hhkFile && fs.existsSync(hhkFile)) kw = { keywords: parseHhk(hhkFile, dir) };

  fs.writeFileSync(path.join(dir, 'keywords.json'), JSON.stringify(kw, null, 2));
  fs.writeFileSync(path.join(dir, 'search-index.json'),
    JSON.stringify(buildFullText(dir)));
  fs.writeFileSync(path.join(dir, 'index.html'), shell({ navHtml, title, home: homeHref }));
  fs.writeFileSync(path.join(dir, '__chm_nav.html'),
    '<!doctype html><html><head><meta charset="utf-8"><title>目录</title>' +
    `<style>ul{padding-left:16px}li{margin:3px 0}a{color:#0969da;text-decoration:none}</style></head>` +
    `<body>${navHtml}</body></html>`);
  return { navHtml, keywords: kw, title, homeHref };
}