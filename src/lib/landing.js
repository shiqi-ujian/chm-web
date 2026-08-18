'use strict';
// landing.js —— 多页架构：把原单一巨大欢迎页拆成 4 个独立静态子页。
//   index.html   欢迎页（Hero + 全站搜索 + 热门文档）
//   browse.html  浏览文档（公开文档列表）
//   upload.html  上传页（登录门控上传工作台）
//   mine.html    我的文档（登录用户的文档管理）
// 全部纯静态自包含（内联 CSS/JS），可被静态托管 / 离线 zip 承载；
// 动态数据（登录态、文档列表、上传）仍由后端 API 提供，失败时前端回退到
// 构建期注入的 __DOCS_JSON__（公开文档清单）。不再烘焙任何访问令牌（A3）。
const fs = require('fs');
const path = require('path');

function esc(s) {
  return String(s == null ? '' : '' + s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ============ 共享设计 token 与公共片段（浅紫延续） ============ */

const CSS = `
:root{--acc:#7c3aed;--acc-dark:#6d28d9;--acc-soft:#f3e8ff;--bg:#f6f7fb;--card:#fff;
  --ink:#1e293b;--mut:#64748b;--line:#e2e8f0;--hover:#f1f5f9;--ok:#1a7f37;--err:#cf222e;
  --radius-lg:18px;--radius:12px;--shadow-sm:0 1px 3px rgba(15,23,42,.06);
  --shadow-md:0 12px 32px rgba(88,45,161,.12);}
[data-theme="dark"]{--acc:#a78bfa;--acc-dark:#c4b5fd;--acc-soft:#312e81;--bg:#0d1524;--card:#1b2740;
  --ink:#e6ecf5;--mut:#94a3b8;--line:#2a3a56;--hover:#243450;--ok:#4ade80;--err:#f87171;}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  color:var(--ink);background:var(--bg);line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1020px;margin:0 auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-sm)}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--acc);color:#fff;border:0;border-radius:12px;
  padding:12px 24px;font-size:15px;font-weight:700;cursor:pointer;transition:.18s transform,.18s box-shadow;text-decoration:none}
.btn:hover{background:var(--acc-dark);transform:translateY(-1px);box-shadow:var(--shadow-md)}
.btn:disabled{background:#9db6d9;cursor:not-allowed;transform:none;box-shadow:none}
.btn.ghost{background:transparent;color:var(--acc);border:1px solid var(--acc)}
.btn.ghost:hover{background:var(--acc-soft)}
.btn.danger{background:var(--err)}.btn.sm{padding:6px 14px;font-size:13px;border-radius:9px}
.in{width:100%;padding:11px 14px;border:1px solid var(--line);border-radius:10px;font-size:14px;
  background:var(--bg);color:var(--ink);outline:none}
.in:focus{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft)}
.field{display:block;font-size:13px;color:var(--mut);margin:12px 0 4px}
.message{margin-top:12px;font-size:14px;min-height:20px}.message .err{color:var(--err)}.message .ok{color:var(--ok)}
.tag{display:inline-block;font-size:12px;color:var(--mut);background:var(--hover);border-radius:999px;padding:2px 10px}
.tag.pub{background:rgba(26,127,55,.14);color:var(--ok)}.tag.priv{color:#b35900;background:rgba(179,89,0,.12)}
.foot{text-align:center;color:var(--mut);font-size:13px;padding:28px 0 36px}
.header{position:sticky;top:0;z-index:100;height:60px;display:flex;align-items:center;gap:16px;
  padding:0 clamp(16px,4vw,40px);backdrop-filter:blur(10px);background:rgba(246,247,251,.82);border-bottom:1px solid var(--line)}
[data-theme="dark"] .header{background:rgba(13,21,36,.82)}
.header .logo{display:flex;align-items:center;gap:8px;font-weight:800;font-size:16px;color:var(--ink);white-space:nowrap}
.header .logo .dot{width:20px;height:20px;border-radius:6px;background:linear-gradient(135deg,#7c3aed,#c084fc)}
.header nav{display:flex;gap:4px;margin-left:8px}
.header nav a{padding:7px 13px;border-radius:10px;font-size:14px;color:var(--mut);font-weight:600}
.header nav a:hover{background:var(--hover);color:var(--ink);text-decoration:none}
.header nav a.on{background:var(--acc-soft);color:var(--acc)}
.header .spacer{flex:1}.header .who{font-size:13px;color:var(--mut);white-space:nowrap}
.auth-link{border:1px solid var(--line);background:var(--card);color:var(--acc);border-radius:999px;
  padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer}
.auth-link:hover{background:var(--acc-soft);border-color:var(--acc);text-decoration:none}
.theme-btn{border:1px solid var(--line);background:var(--card);border-radius:999px;width:34px;height:34px;
  cursor:pointer;font-size:15px;display:grid;place-items:center}
.hero{background:linear-gradient(160deg,#7c3aed 0%,#9f5bd5 45%,#c084fc 100%);color:#fff;
  padding:clamp(36px,7vw,64px) 16px;text-align:center}
.hero.small{padding:clamp(22px,3vw,34px) 16px}
.hero .eyebrow{opacity:.9;letter-spacing:2px;font-size:13px;font-weight:600}
.hero h1{font-size:clamp(24px,4.5vw,36px);margin:10px auto;font-weight:800;max-width:720px}
.hero .sub{font-size:clamp(14px,2vw,16px);opacity:.95;max-width:560px;margin:0 auto}
.modal{position:fixed;inset:0;background:rgba(15,23,42,.4);display:none;align-items:center;justify-content:center;z-index:300}
.modal.on{display:flex}
.modal .box{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-lg);
  padding:26px;width:min(92vw,380px);box-shadow:0 20px 60px rgba(0,0,0,.25)}
.modal h3{margin:0 0 6px;font-size:18px}
.modal .row{display:flex;gap:10px;margin-top:18px}.modal .row .btn{margin:0;flex:1;text-align:center}
.modal .err{color:var(--err);font-size:12.5px;margin-top:10px;min-height:16px}
.row-card{display:flex;align-items:center;gap:14px;padding:18px;margin-bottom:12px;transition:.16s box-shadow}
.row-card:hover{box-shadow:var(--shadow-md)}
@media(max-width:640px){.header nav a{font-size:13px;padding:6px 9px}.header .logo span.txt{display:none}}
`;

const NAV = `
<div class="header">
  <div class="logo"><span class="dot"></span><span class="txt">CHM 网页</span></div>
  <nav>
    <a href="index.html" data-nav="home">首页</a>
    <a href="browse.html" data-nav="browse">浏览文档</a>
    <a href="upload.html" data-nav="upload">上传</a>
    <a href="mine.html" data-nav="mine">我的文档</a>
  </nav>
  <span class="spacer"></span>
  <span class="who" id="who"></span>
  <button class="theme-btn" id="themeBtn" title="切换深色模式" type="button">🌙</button>
  <button class="auth-link" id="loginBtn" type="button">登录 / 注册</button>
</div>`;

const MODAL = `
<div class="modal" id="authModal">
  <div class="box">
    <h3 id="authTitle">登录</h3>
    <label class="field">用户名</label><input class="in" id="au" autocomplete="username">
    <label class="field">密码</label><input class="in" id="ap" type="password" autocomplete="current-password">
    <div class="err" id="authErr"></div>
    <div class="row"><button class="btn ghost" id="authSwitch" type="button">去注册</button>
      <button class="btn" id="authGo" type="button">登录</button></div>
  </div>
</div>`;

// 公共 JS：主题/登录模态/文档清单 + 各页脚本（pageScript 占位）。
// navActive 用于高亮当前导航。
function SHARED_JS(pageScript) {
  return `(function(){
var escU=function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');};
var theme=(function(){try{return localStorage.getItem('chm-theme')||(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch(e){return 'light';}})();
document.documentElement.dataset.theme=theme;
var tb=document.getElementById('themeBtn');
if(tb){tb.textContent=theme==='dark'?'☀️':'🌙';tb.addEventListener('click',function(){var n=document.documentElement.dataset.theme==='dark'?'light':'dark';
  document.documentElement.dataset.theme=n;try{localStorage.setItem('chm-theme',n);}catch(e){}tb.textContent=n==='dark'?'☀️':'🌙';});}
(function(){var nav=document.querySelector('[data-nav="__NAV_ACTIVE__"]');if(nav)nav.classList.add('on');})();
var USER_TOKEN=(function(){try{return localStorage.getItem('chm_user')||'';}catch(e){return '';}})();
function userHeaders(){return USER_TOKEN?{'X-User-Token':USER_TOKEN}:{};}
window.userHeaders=userHeaders;
var currentUser=null,who=document.getElementById('who'),lb=document.getElementById('loginBtn');
window.currentUser=currentUser;
function renderAuth(){window.currentUser=currentUser;if(who)who.textContent=currentUser?('你好，'+currentUser):'';if(lb)lb.textContent=currentUser?'退出':'登录 / 注册';}
window.renderAuth=renderAuth;
function afterMe(){try{if(window.__onAuth)window.__onAuth();}catch(e){}}
function loadMe(){if(!window.fetch||!USER_TOKEN)return;fetch('/api/me',{headers:userHeaders()}).then(function(r){return r.json();})
  .then(function(j){currentUser=(j&&j.user)||null;renderAuth();afterMe();}).catch(function(){renderAuth();afterMe();});}
var modal=document.getElementById('authModal');
window.__openAuth=function(){if(modal)modal.classList.add('on');};
window.__closeAuth=function(){if(modal)modal.classList.remove('on');};
function doAuth(){var u=document.getElementById('au').value.trim(),p=document.getElementById('ap').value,er=document.getElementById('authErr');
  if(!u||!p){er.textContent='请填写用户名和密码';return;}
  var mode=document.getElementById('authTitle').textContent.indexOf('注册')===0?'register':'login';
  fetch('/api/'+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})})
    .then(function(r){return r.json().then(function(j){return {st:r.status,j:j};});}).then(function(x){
      if(x.st===200&&x.j.token){USER_TOKEN=x.j.token;try{localStorage.setItem('chm_user',USER_TOKEN);}catch(e){}
        currentUser=x.j.username||u;window.__closeAuth();renderAuth();afterMe();}
      else er.textContent=(x.j&&x.j.error)||'失败';})
    .catch(function(e){er.textContent='网络错误：'+e.message;});}
if(lb)lb.addEventListener('click',function(){if(currentUser){fetch('/api/logout',{method:'POST',headers:userHeaders()}).catch(function(){});USER_TOKEN='';currentUser=null;
  try{localStorage.removeItem('chm_user');}catch(e){}renderAuth();afterMe();}else window.__openAuth();});
if(modal){document.getElementById('authGo').addEventListener('click',doAuth);
  document.getElementById('authSwitch').addEventListener('click',function(){
    var reg=document.getElementById('authTitle').textContent==='登录';
    document.getElementById('authTitle').textContent=reg?'注册新账号':'登录';
    document.getElementById('authGo').textContent=reg?'注册':'登录';
    document.getElementById('authSwitch').textContent=reg?'去登录':'去注册';});
  modal.addEventListener('click',function(e){if(e.target===modal)window.__closeAuth();});}
var DOCS=(typeof __DOCS_JSON__!=='undefined'&&__DOCS_JSON__)?__DOCS_JSON__:[];
window.__docs=DOCS;window.__setDocs=function(d){window.__docs=d;};
window.__onAuth=window.__onAuth||function(){};
loadMe();
${pageScript}
})();`;
}

/** 页面骨架：nav + hero + 正文 + foot + 模态 + 公共脚本 + 页面脚本 */
function page(title, heroSmall, heroInner, body, pageScript, navActive) {
  return `<!doctype html><html lang="zh" data-theme="light"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head><body>
${NAV}
<div class="hero${heroSmall ? ' small' : ''}">${heroInner}</div>
<div class="wrap">${body}</div>
<div class="foot">CHM 网页 · 免费 · 非营利 · 数据仅用于转换与展示</div>
${MODAL}
<script>
${SHARED_JS(pageScript).split('__NAV_ACTIVE__').join(esc(navActive || 'home'))}
</script>
</body></html>`;
}

/* ============ 四个页面 ============ */

const WELCOME = page('CHM 网页 · 免费在线阅读工具', false, `
  <div class="eyebrow">CHM 网页</div>
  <h1>把 CHM 帮助文档变成手机也能看的网页</h1>
  <div class="sub">上传 .chm，自动解包为可浏览、可搜索的静态页面，PC / 手机随时翻阅，完全免费。</div>`, `
  <div style="margin:-26px auto 26px;max-width:680px;position:relative">
    <div class="card" style="padding:14px;box-shadow:var(--shadow-md)">
      <div style="position:relative">
        <input class="in" style="padding:13px 46px 13px 18px;border-radius:999px;font-size:15px" id="siteq" type="search" placeholder="搜索全部文档（标题 / 关键字 / 正文）…" autocomplete="off">
        <span style="position:absolute;right:20px;top:50%;transform:translateY(-50%);color:var(--mut)">⌕</span>
        <div id="sres" style="position:absolute;top:56px;left:0;right:0;background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:0 14px 40px rgba(0,0,0,.16);max-height:62vh;overflow:auto;display:none;z-index:90"></div>
      </div>
    </div>
  </div>
  <div style="max-width:680px;margin:0 auto 28px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
    <div class="card" style="padding:20px;text-align:center"><div style="font-size:26px">📄</div><b style="display:block;margin-top:6px">上传 .chm</b><p style="font-size:13px;color:var(--mut);margin:4px 0 0">选择或拖入帮助文档</p></div>
    <div class="card" style="padding:20px;text-align:center"><div style="font-size:26px">⚙️</div><b style="display:block;margin-top:6px">自动转换</b><p style="font-size:13px;color:var(--mut);margin:4px 0 0">解包为静态 HTML + 目录 + 关键字</p></div>
    <div class="card" style="padding:20px;text-align:center"><div style="font-size:26px">📱</div><b style="display:block;margin-top:6px">随处浏览</b><p style="font-size:13px;color:var(--mut);margin:4px 0 0">手机 / 电脑打开即读，可搜索</p></div>
  </div>
  <div style="text-align:center"><a class="btn" href="upload.html">立即上传 →</a></div>
  <div style="max-width:680px;margin:40px auto 0">
    <h2 style="font-size:18px;margin:0 0 14px">热门文档</h2>
    <div id="recentDocs"></div>
  </div>`, `
  /* 欢迎页：全站搜索 + 热门文档 */
  var sres=document.getElementById('sres'),siteq=document.getElementById('siteq');
  var siKw=[],siRec=[],api=false;
  function escA(x){return escS(x).replace(/'/g,'&#39;');}
  function loadSite(){try{if(!window.fetch)return;fetch('site-index.json').then(function(r){return r.json();}).then(function(j){siKw=j.keywords||[];siRec=j.records||[];}).catch(function(){});}catch(e){}}
  function probeApi(){try{fetch('/api/search?q=__p__').then(function(r){api=r.status===200;}).catch(function(){});}catch(e){}}
  loadSite();probeApi();
  function render(rows){var h='';if(!rows.length)h='<div style="padding:14px;color:var(--mut);font-size:14px">无匹配结果</div>';
    else{var c=null;rows.slice(0,20).forEach(function(r){if(r.grp&&r.grp!==c){h+='<div style="padding:8px 16px 2px;font-size:12px;color:var(--mut)">'+escS(r.grp)+'</div>';c=r.grp;}
      h+='<a href="'+escS(r.href)+'" style="display:block;padding:9px 16px;border-bottom:1px solid var(--line);text-decoration:none;color:var(--ink)"><b style="display:block;font-size:14px">'+escS(r.t)+'</b><span style="color:var(--mut);font-size:12px">'+escS(r.p||'')+'</span></a>';});}
    sres.innerHTML=h;sres.style.display='block';}
  function local(q){q=String(q||'').toLowerCase();var rows=[];(siKw||[]).slice(0,120).forEach(function(k){if((k.name||'').toLowerCase().indexOf(q)!==-1)rows.push({grp:k.doc||'',href:k.href||'',t:k.name,p:k.doc});});
    (siRec||[]).forEach(function(rep){var lt=(rep.text||'').toLowerCase(),at=lt.indexOf(q);if(at===-1)return;
      var pg=(rep.text.match(/\\[page:([^\\]]+)\\]/)||[])[1]||'';var ctx=rep.text.slice(Math.max(0,at-30),at+100).replace(/\\s+/g,' ');
      rows.push({grp:rep.doc||'',href:'d/'+(rep.doc||'')+'/'+pg,t:pg||'',p:ctx});});
    var seen={},u=[];rows.forEach(function(r){var k=r.href+'|'+r.t;if(!seen[k]){seen[k]=1;u.push(r);}});render(u);}
  function apiFn(q){fetch('/api/search?q='+encodeURIComponent(q)+'&limit=20').then(function(r){return r.json();}).then(function(j){
    var rows=(j&&j.hits||[]).map(function(h){return {grp:h.doc||'',href:h.href||('d/'+(h.doc||'')+'/'),t:h.doc||'',p:h.snippet||''};});render(rows);}).catch(function(){local(q);});}
  siteq.addEventListener('input',function(){var v=siteq.value.trim();if(!v){sres.style.display='none';return;}if(api)apiFn(v);else local(v);});
  document.addEventListener('click',function(e){if(e.target!==siteq&&!sres.contains(e.target))sres.style.display='none';});
  function recentRender(list){var box=document.getElementById('recentDocs');var arr=list&&list.length?list:window.__docs||[];
    if(!arr.length){box.innerHTML='<div style="color:var(--mut);font-size:14px;text-align:center">还没有公开文档，去上传第一个吧。</div>';return;}
    box.innerHTML=arr.slice(0,6).map(function(d){var priv=d.visibility==='private';
      return '<div class="card row-card" style="flex-wrap:wrap"><span style="font-size:24px">📘</span>'+
      '<span style="flex:1;min-width:0"><b style="display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">'+escS(d.name||d.id)+'</b>'+
      '<span class="tag '+(priv?'priv':'pub')+'">'+(priv?'私密':'公开')+'</span></span>'+
      '<a href="'+escS(d.href||('d/'+d.id+'/'))+'" class="btn ghost sm">打开 →</a></div>';}).join('');}
  function recent(){fetch('/api/docs',{headers:userHeaders()}).then(function(r){return r.json();}).then(function(j){if(j&&j.docs){window.__setDocs(j.docs);recentRender(j.docs);}}).catch(function(){recentRender();});}
  recent();
  window.__onAuth=function(){renderAuth();if(window.location.hash==='#mine')location.reload();};
`, 'home');

const BROWSE = page('浏览文档 · CHM 网页', true, `
  <div class="eyebrow">浏览文档</div><h1>站内文档</h1>
  <div class="sub">所有公开文档，随时翻阅。</div>`, `
  <div style="max-width:820px;margin:28px auto 0">
    <input class="in" id="browseQ" placeholder="在标题中筛选…" style="margin-bottom:18px">
    <div id="browseList"></div>
  </div>`, `
  var box=document.getElementById('browseList');
  function render(list){var arr=list&&list.length?list:window.__docs||[];
    if(!arr.length){box.innerHTML='<div style="text-align:center;color:var(--mut);padding:40px 0">暂无文档</div>';return;}
    box.innerHTML=arr.filter(function(d){return d.visibility!=='private';}).map(function(d){
      return '<div class="card row-card"><span style="font-size:24px">📘</span>'+
      '<span style="flex:1;min-width:0"><b style="display:block;font-size:16px">'+escS(d.name||d.id)+'</b>'+
      '<span class="tag pub">公开</span></span>'+
      '<a href="'+escS(d.href||('d/'+d.id+'/'))+'" class="btn ghost sm">打开 →</a></div>';}).join('');}
  function load(){fetch('/api/docs',{headers:userHeaders()}).then(function(r){return r.json();}).then(function(j){if(j&&j.docs)render(j.docs);}).catch(function(){render();});}
  load();
  var q=document.getElementById('browseQ');if(q)q.addEventListener('input',function(){var s=q.value.trim().toLowerCase();
    var arr=(window.__docs||[]).filter(function(d){return (d.name||d.id||'').toLowerCase().indexOf(s)!==-1;});render(arr);});
  window.__onAuth=function(){};`, 'browse');

const UPLOAD = page('上传 · CHM 网页', true, `
  <div class="eyebrow">上传</div><h1>上传 .chm</h1>
  <div class="sub">登录后可上传，转换后立即可浏览。</div>`, `
  <div id="uploadGate" style="max-width:680px;margin:30px auto;text-align:center"><div class="card" style="padding:30px">
    🔒 上传需要先登录。<br><br><button class="btn" id="gateLogin">去登录 / 注册</button></div></div>
  <div id="uploadWork" style="max-width:680px;margin:30px auto;display:none">
    <div class="card" style="padding:24px">
      <div id="drop" tabindex="0" style="border:2px dashed #b6c2d0;border-radius:14px;padding:40px 20px;text-align:center;cursor:pointer">
        <div style="font-size:20px;font-weight:700">点击选择 .chm，或拖进来</div>
        <div style="color:var(--mut);font-size:13px;margin-top:6px">支持 .chm 格式 · 可多选</div>
        <input type="file" id="file" accept=".chm" multiple style="display:none">
      </div>
      <div style="margin-top:14px;display:flex;gap:16px;justify-content:center;font-size:13.5px;color:var(--mut)">
        <label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" name="vis" value="public" checked> 公开（所有人可看）</label>
        <label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" name="vis" value="private"> 私密（仅自己 + 分享链接）</label>
      </div>
      <div id="filePick" style="margin-top:14px;font-size:14px;color:var(--mut)"></div>
      <div class="message" id="msg"></div>
      <div style="text-align:center"><button class="btn" id="go" disabled>转换文档</button></div>
    </div>
    <div class="card" style="margin-top:18px;padding:20px;font-size:13.5px;color:var(--mut)">
      <b>批量说明</b>：可一次选择多个 .chm，逐个转换并汇总进度；转换后到「我的文档」里管理可见性与分享。
    </div>
  </div>`, `
  var gate=document.getElementById('uploadGate'),work=document.getElementById('uploadWork');
  document.getElementById('gateLogin').addEventListener('click',function(){window.__openAuth();});
  function updateGate(){if(window.currentUser){work.style.display='';gate.style.display='none';}else{work.style.display='none';gate.style.display='';}}
  window.__onAuth=updateGate;loadMe();updateGate();
  var file=document.getElementById('file'),drop=document.getElementById('drop'),go=document.getElementById('go'),msg=document.getElementById('msg');
  var all=[],seq=0,ok=[],fail=[];
  function sel(){var pk=document.getElementById('filePick');pk.innerHTML=all.map(function(f,i){return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border:1px solid var(--line);border-radius:9px;margin-bottom:6px">'+
    '<b>'+escS(f.name)+'</b><button type="button" data-i="'+i+'" class="rm" style="border:0;background:var(--hover);border-radius:50%;width:22px;height:22px;cursor:pointer">✕</button></div>';}).join('');
    Array.prototype.forEach.call(pk.querySelectorAll('.rm'),function(b){b.addEventListener('click',function(){all.splice(+b.getAttribute('data-i'),1);sel();});});
    go.textContent=all.length>1?('转换 '+all.length+' 个文档'):'转换文档';go.disabled=!(all.length>0);}
  function addFiles(list){list=list||[];Array.prototype.forEach.call(list,function(f){if(/\.chm$/i.test(f.name||''))all.push(f);else msg.innerHTML='<span class="err">跳过非 .chm：'+escS(f.name)+'</span>';});sel();}
  function vis(){var r=document.querySelector('input[name=vis]:checked');return (r&&r.value==='private')?'private':'public';}
  function doUpload(f,cb){var fd=new FormData();fd.append('file',f);fd.append('visibility',vis());
    fetch('/api/upload',{method:'POST',body:fd,headers:userHeaders()}).then(function(r){return r.json().then(function(j){return {st:r.status,j:j};});})
      .then(function(x){if(x.st===200&&x.j.ok)ok.push(x.j.name||f.name);else fail.push(f.name);cb();})
      .catch(function(){fail.push(f.name);cb();});}
  function runBatch(){var files=all.slice();if(!files.length){msg.innerHTML='<span class="err">先选择 .chm 文件</span>';return;}
    var mySeq=++seq;go.disabled=true;ok=[];fail=[];
    function finish(){go.disabled=false;all=[];sel();
      msg.innerHTML=fail.length?('<span class="err">完成 '+ok.length+'，失败 '+fail.length+' 个（'+escS(fail.join('、'))+'）</span>'):('<span class="ok">全部转换成功！'+ok.length+' 篇已就绪，可在「我的文档」打开。</span>');}
    (function loop(i){if(i>=files.length)return finish();var f=files[i];go.textContent='转换中 '+i+'/'+files.length;
      doUpload(f,function(){if(seq!==mySeq)return;loop(i+1);});})(0);}
  drop.addEventListener('click',function(){file.click();});
  drop.addEventListener('dragover',function(e){e.preventDefault();drop.style.borderColor='var(--acc)';});
  drop.addEventListener('dragleave',function(){drop.style.borderColor='#b6c2d0';});
  drop.addEventListener('drop',function(e){e.preventDefault();addFiles(e.dataTransfer&&e.dataTransfer.files);drop.style.borderColor='#b6c2d0';});
  file.addEventListener('change',function(){addFiles(file.files);file.value='';});
  go.addEventListener('click',runBatch);`, 'upload');

const MINE = page('我的文档 · CHM 网页', true, `
  <div class="eyebrow">我的文档</div><h1>我的文档</h1>
  <div class="sub">管理你的私有 / 公开文档：改可见性、复制分享链接、删除。</div>`, `
  <div style="max-width:820px;margin:28px auto 0" id="mineList"></div>`, `
  var box=document.getElementById('mineList');
  function escS2(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  // 「我的文档」只展示当前登录用户自己上传的文档，绝不列公共区/他人/匿名种子文档。
  function mineOnly(list){return (list||[]).filter(function(d){return window.currentUser&&d.owner===window.currentUser;});}
  function toggleVis(id,btn){var target=btn.textContent.indexOf('公开')!==-1?'public':'private';
    fetch('/api/doc/'+encodeURIComponent(id)+'/visibility',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},userHeaders()),body:JSON.stringify({visibility:target})}).then(function(){load();});}
  function shareLink(id){fetch('/api/doc/'+encodeURIComponent(id)+'/share',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},userHeaders()),body:'{}'}).then(function(r){return r.json();}).then(function(j){
      if(j.sharePath){var url=location.origin+location.pathname.replace(/\\/[^\\/]*$/,'/')+j.sharePath;if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(url).then(function(){alert('分享链接已复制');});}else{alert('分享链接：'+url);}}});}
  function del(id){if(!confirm('删除该文档？不可恢复。'))return;fetch('/api/doc/'+encodeURIComponent(id),{method:'DELETE',headers:userHeaders()}).then(function(){load();});}
  function render(arr){arr=arr||[];
    if(!window.currentUser){box.innerHTML='<div style="text-align:center;color:var(--mut);padding:40px 0">请先登录，才能查看和管理你的上传文档。</div>';return;}
    if(!arr.length){box.innerHTML='<div style="text-align:center;color:var(--mut);padding:40px 0">你还没有上传文档，去「上传」页传一个 .chm 吧。</div>';return;}
    box.innerHTML=arr.map(function(d){
      return '<div class="card row-card" style="flex-wrap:wrap"><span style="font-size:24px">📘</span>'+
      '<span style="flex:1;min-width:0"><b style="display:block">'+escS2(d.name||d.id)+'</b>'+
      '<span class="tag '+(d.visibility==='private'?'priv':'pub')+'">'+(d.visibility==='private'?'私密':'公开')+'</span>'+
      '<span class="tag">我的</span></span>'+
      '<a href="'+escS2(d.href||(d.visibility==='private'?'p/':'d/')+d.id+'/')+'" class="btn ghost sm">打开</a>'+
      '<span style="flex:100%;display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">'+
        '<button class="btn ghost sm" data-vis="'+escS2(d.id)+'">'+(d.visibility==='private'?'设为公开':'设为私密')+'</button>'+
        '<button class="btn ghost sm" data-share="'+escS2(d.id)+'">复制分享链接</button>'+
        '<button class="btn danger sm" data-del="'+escS2(d.id)+'">删除</button></span></div>';}).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-vis]'),function(b){b.addEventListener('click',function(){toggleVis(b.getAttribute('data-vis'),b);});});
    Array.prototype.forEach.call(box.querySelectorAll('[data-share]'),function(b){b.addEventListener('click',function(){shareLink(b.getAttribute('data-share'));});});
    Array.prototype.forEach.call(box.querySelectorAll('[data-del]'),function(b){b.addEventListener('click',function(){del(b.getAttribute('data-del'));});});
  }
  function load(){render(mineOnly(window.__docs));
    fetch('/api/docs',{headers:userHeaders()}).then(function(r){return r.json();}).then(function(j){if(j&&j.docs)render(mineOnly(j.docs));}).catch(function(){});}
  load();
  window.__onAuth=function(){load();};`, 'mine');

module.exports = { build, buildSiteIndex, WELCOME, BROWSE, UPLOAD, MINE, LANDING_HTML: WELCOME };

/**
 * 生成站点四个子页到 outDir（index/browse/upload/mine.html）。
 * 注意（A3 安全）：不再把 UPLOAD_TOKEN/EXPORT_TOKEN 注入任何页面源码 —— 那会让
 * view-source 拿到明文密钥。浏览器端登录态(同源 cookie)由服务端校验。
 * @param {object} o { outDir, docs } docs 形如 [{ id, name, href }]（公开清单）
 */
function build({ outDir, docs }) {
  const dir = path.resolve(outDir);
  fs.mkdirSync(dir, { recursive: true });
  const docsJson = JSON.stringify(docs || []);
  const write = (file, html) => fs.writeFileSync(path.join(dir, file),
    html.replace(/__DOCS_JSON__/g, docsJson), 'utf8');

  write('index.html', WELCOME);
  write('browse.html', BROWSE);
  write('upload.html', UPLOAD);
  write('mine.html', MINE);

  // 全站聚合检索索引（欢迎页/浏览页共用）
  fs.writeFileSync(path.join(dir, 'site-index.json'),
    JSON.stringify(buildSiteIndex({ siteRoot: dir, docs })));
  return { outFile: path.join(dir, 'index.html'), docs };
}

/**
 * 生成站点级聚合检索索引 site-index.json，供欢迎页全站搜索。
 * @param {object} o { siteRoot, docs } docs 形如 [{ id, name, href }]
 * @returns {{keywords:Array, records:Array}}
 */
function buildSiteIndex({ siteRoot, docs }) {
  const root = path.resolve(siteRoot);
  const keywords = [];
  const records = [];
  for (const d of docs || []) {
    const docRoot = d.href ? path.join(root, d.href.replace(/[\\/]+$/, '')) : null;
    const docName = d.name || d.id;
    keywords.push({ name: docName, href: d.href || ('d/' + (d.id) + '/'), doc: docName });
    try {
      const kwFile = docRoot && fs.existsSync(path.join(docRoot, 'keywords.json'))
        ? JSON.parse(fs.readFileSync(path.join(docRoot, 'keywords.json'), 'utf8')) : null;
      (kwFile && kwFile.keywords || []).forEach((k) => {
        const rel = (k.href || '').replace(/\\/g, '/');
        keywords.push({ name: k.name, href: d.href + rel, doc: docName });
      });
    } catch (_) {}
    try {
      const idxFile = docRoot && path.join(docRoot, 'search-index.json');
      if (idxFile && fs.existsSync(idxFile)) {
        const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
        const recs = (idx && idx.records) || [];
        recs.forEach((r) => {
          if (!r || !r.text) return;
          let txt = r.text.slice(0, 4000);
          records.push({ doc: docName, text: txt });
        });
      }
    } catch (_) {}
  }
  return { keywords, records };
}