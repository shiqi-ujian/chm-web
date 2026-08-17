'use strict';
// preview.js — build a browsable shell: index.html that embeds the .hhc
// directory tree and links to the real .htm pages. Also writes keywords.json.
const fs = require('fs');
const path = require('path');
const { parseHhcFile } = require('./hhc');
const parseHhk = require('./hhk').parseHhk;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function relPath(baseDir, href) {
  if (!href) return '#';
  try {
    const rel = path.relative(baseDir, href).replace(/\\/g, '/');
    return rel.split('#')[0] || '#';
  } catch { return '#'; }
}

function renderNodes(nodes, dir) {
  return nodes.map((n) => {
    const hasKids = n.children && n.children.length;
    const href = relPath(dir, n.href);
    const kids = hasKids ? '<ul>' + renderNodes(n.children, dir) + '</ul>' : '';
    const cls = hasKids ? ' folder' : '';
    return `<li class="${cls.trim()}"><a href="${esc(href)}">${esc(n.name || '(untitled)')}</a>${kids}</li>`;
  }).join('\n');
}

/** Render a full tree into a single <ul> for nesting correctness. */
function renderTree(nodes, dir) {
  return '<ul>' + renderNodes(nodes, dir) + '</ul>';
}

function shell(navHtml, title) {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || 'CHM')}</title>
<style>
  html,body{height:100%;margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;}
  .wrap{display:flex;height:100vh;}
  aside{width:320px;min-width:320px;border-right:1px solid #ddd;background:#fafafa;overflow:auto;box-sizing:border-box;}
  nav{padding:12px;}
  ul{padding-left:16px;margin:2px 0;}
  li{list-style:none;margin:2px 0;}
  li.folder > a{font-weight:600;}
  li.folder > ul{display:none;}
  li.folder.open > ul{display:block;}
  a{color:#0366d6;text-decoration:none;}
  a:hover{text-decoration:underline;}
  iframe{flex:1;border:0;width:100%;height:100vh;}
  .marker{color:#8a9aa8;display:inline-block;width:14px;cursor:pointer;user-select:none;font-size:12px;vertical-align:middle;}
  @media(max-width:680px){.wrap{flex-direction:column}.wrap aside{width:100%;min-width:0;max-height:45vh;} iframe{height:55vh}}
</style></head><body>
<div class="wrap">
  <aside><nav id="toc">${navHtml}</nav></aside>
  <iframe id="content" src="start.htm"></iframe>
</div>
<script>
(function(){
  document.querySelectorAll('#toc li.folder > a').forEach(function(a){
    var li=a.parentElement; var ul=li.querySelector(':scope > ul');
    var mark=document.createElement('span'); mark.className='marker'; mark.textContent='▸';
    li.insertBefore(mark,a); li.classList.add('closed');
    a.addEventListener('click',function(e){ e.preventDefault(); toggle(li); });
    mark.addEventListener('click',function(e){ e.stopPropagation(); toggle(li); });
  });
  function toggle(li){ li.classList.toggle('open'); li.classList.toggle('closed');
    var m=li.querySelector('.marker'); if(m) m.textContent=(li.classList.contains('open')?'▾':'▸'); }
})();
</script>
</body></html>`;
}

function build({ outDir, hhcFile, hhkFile, title }) {
  const dir = path.resolve(outDir);
  let tree = [];
  if (hhcFile && fs.existsSync(hhcFile)) tree = parseHhcFile(hhcFile, dir);
  const navHtml = renderTree(tree, dir);

  let kw = { keywords: [] };
  if (hhkFile && fs.existsSync(hhkFile)) kw = { keywords: parseHhk(hhkFile, dir) };
  fs.writeFileSync(path.join(dir, 'keywords.json'), JSON.stringify(kw, null, 2));

  fs.writeFileSync(path.join(dir, 'index.html'), shell(navHtml, title));
  fs.writeFileSync(path.join(dir, '__chm_nav.html'),
    `<!doctype html><html><head><meta charset="utf-8"><title>目录</title>` +
    `<style>ul{padding-left:16px}li{margin:3px 0}a{color:#0366d6;text-decoration:none}</style></head>` +
    `<body>${navHtml}</body></html>`);

  return { navHtml, keywords: kw, title };
}

module.exports = { build, renderTree, esc };