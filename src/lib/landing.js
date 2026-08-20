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
.header nav{display:flex;align-items:center;gap:4px;margin-left:8px}
.header nav a{padding:7px 13px;border-radius:10px;font-size:14px;color:var(--mut);font-weight:600;white-space:nowrap}
.header nav a:hover{background:var(--hover);color:var(--ink);text-decoration:none}
.header nav a.on{background:var(--acc-soft);color:var(--acc)}
.header .spacer{flex:1}.header .who{font-size:13px;color:var(--mut);white-space:nowrap}
.auth-link{border:1px solid var(--line);background:var(--card);color:var(--acc);border-radius:999px;
  padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.auth-link:hover{background:var(--acc-soft);border-color:var(--acc);text-decoration:none}
.theme-btn{border:1px solid var(--line);background:var(--card);border-radius:999px;width:34px;height:34px;
  cursor:pointer;font-size:15px;display:grid;place-items:center;flex:0 0 auto}
/* 移动端汉堡菜单 */
.menu-btn{display:none;border:1px solid var(--line);background:var(--card);border-radius:999px;width:36px;height:36px;
  cursor:pointer;font-size:16px;place-items:center;flex:0 0 auto}
.nav-drawer-backdrop{display:none;position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:199}
.nav-drawer{position:fixed;top:0;bottom:0;left:0;width:min(78vw,300px);background:var(--card);z-index:200;
  transform:translateX(-100%);transition:transform .22s ease;padding:20px;box-shadow:2px 0 18px rgba(0,0,0,.18)}
.nav-drawer.open{transform:translateX(0)}
.nav-drawer a{display:block;padding:12px 14px;border-radius:12px;font-size:15px;font-weight:600;color:var(--ink)}
.nav-drawer a.on{background:var(--acc-soft);color:var(--acc)}
.nav-drawer .close{position:absolute;top:14px;right:14px;border:0;background:var(--hover);border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:14px}
/* 手机导航：窄屏时把"首页/浏览/上传/我的"改成 4 个等宽按钮组，
   避免 logo + 长按钮 + 图标把四个链接挤成一条竖条。 */
@media(max-width:860px){
  .header{height:auto;min-height:60px;flex-wrap:wrap;gap:6px 12px;padding:8px clamp(12px,4vw,24px)}
  .header .logo{margin-right:auto}
  .header nav{order:10;flex:1 1 100%;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));
    gap:6px;margin:2px 0 0}
  .header nav a.fb-link{display:none}
  .header nav a{padding:8px 2px;border-radius:10px;font-size:13.5px;text-align:center}
  .header .spacer{display:none}
  .header .who{margin-left:auto}
  .theme-btn{width:32px;height:32px;font-size:14px}
  .auth-link{padding:6px 12px;font-size:12.5px}
}
@media(max-width:560px){
  .header .logo span.txt{display:none}
  .header nav{gap:4px}
  .header nav a{font-size:12.5px;padding:7px 2px}
  .auth-link{font-size:12px;padding:6px 10px}
}
@media(max-width:380px){
  .header{position:static}
  .auth-link{max-width:96px;overflow:hidden;text-overflow:ellipsis}
}
.hero{background:linear-gradient(160deg,#7c3aed 0%,#9f5bd5 45%,#c084fc 100%);color:#fff;
  padding:clamp(36px,7vw,64px) 16px;text-align:center}
.hero.small{padding:clamp(22px,3vw,34px) 16px}
.hero .eyebrow{opacity:.9;letter-spacing:2px;font-size:13px;font-weight:600}
.hero h1{font-size:clamp(24px,4.5vw,36px);margin:10px auto;font-weight:800;max-width:720px}
.hero .sub{font-size:clamp(14px,2vw,16px);opacity:.95;max-width:560px;margin:0 auto}
/* 移动端卡片与上传区 */
@media(max-width:640px){
  .row-card{gap:10px;padding:14px}
  .foot a{display:inline-block;padding:4px 6px}
}
.legal{max-width:760px;margin:30px auto}
.legal h1{font-size:24px}
.legal h2{font-size:18px;margin-top:26px}
.legal p,.legal li{font-size:15px;line-height:1.8;color:var(--ink)}
.report-form{max-width:560px;margin:0 auto}
.report-form .card{padding:24px}
.admin-form .card, .admin-box{padding:24px}
.admin-form .card{margin-bottom:14px}
.admin-box{max-width:760px;margin:28px auto}
.admin-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
.admin-actions button{flex:1;min-width:90px}
.modal{position:fixed;inset:0;background:rgba(15,23,42,.4);display:none;align-items:center;justify-content:center;z-index:300}
.modal.on{display:flex}
.modal .box{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-lg);
  padding:26px;width:min(92vw,380px);box-shadow:0 20px 60px rgba(0,0,0,.25)}
.modal h3{margin:0 0 6px;font-size:18px}
.modal .row{display:flex;gap:10px;margin-top:18px}.modal .row .btn{margin:0;flex:1;text-align:center}
.modal .err{color:var(--err);font-size:12.5px;margin-top:10px;min-height:16px}
.row-card{display:flex;align-items:center;gap:14px;padding:18px;margin-bottom:12px;transition:.16s box-shadow}
.row-card:hover{box-shadow:var(--shadow-md)}
.doc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.doc-card{display:flex;flex-direction:column;gap:8px;padding:18px;border:1px solid var(--line);background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow-sm);transition:.16s box-shadow,transform}
.doc-card:hover{box-shadow:var(--shadow-md);transform:translateY(-2px)}
.doc-card .doc-title{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.doc-card .doc-tags{display:flex;flex-wrap:wrap;gap:6px}
@media(max-width:640px){.header .logo span.txt{display:none}.row-card{gap:10px;padding:14px}}
@media(max-width:480px){.modal .box{padding:20px}.btn{padding:12px 18px}}
`;

const NAV = `
<div class="header">
  <button class="menu-btn" id="menuBtn" aria-label="打开导航" type="button">☰</button>
  <div class="logo"><span class="dot"></span><span class="txt">CHM 网页</span></div>
  <nav>
    <a href="index.html" data-nav="home">首页</a>
    <a href="browse.html" data-nav="browse">浏览文档</a>
    <a href="upload.html" data-nav="upload">上传</a>
    <a href="mine.html" data-nav="mine">我的文档</a>
    <a class="fb-link" href="https://docs.qq.com/form/page/DWkh0VFdOb2tFVFJV" target="_blank" rel="noopener" title="发现问题？提交反馈">📝 问题反馈</a>
  </nav>
  <span class="spacer"></span>
  <span class="who" id="who"></span>
  <button class="theme-btn" id="themeBtn" title="切换深色模式" type="button">🌙</button>
  <button class="auth-link" id="loginBtn" type="button">登录 / 注册</button>
</div>
<div class="nav-drawer-backdrop" id="navBackdrop"></div>
<aside class="nav-drawer" id="navDrawer" aria-label="移动端导航">
  <button class="close" id="navClose" type="button">✕</button>
  <a href="index.html" data-nav="home">首页</a>
  <a href="browse.html" data-nav="browse">浏览文档</a>
  <a href="upload.html" data-nav="upload">上传</a>
  <a href="mine.html" data-nav="mine">我的文档</a>
  <a href="https://docs.qq.com/form/page/DWkh0VFdOb2tFVFJV" target="_blank" rel="noopener">📝 问题反馈</a>
  <a href="terms.html">用户协议</a>
  <a href="privacy.html">隐私政策</a>
  <a href="disclaimer.html">免责声明</a>
  <a href="admin.html">管理后台</a>
</aside>`;

const MODAL = `
<div class="modal" id="authModal">
  <div class="box">
    <h3 id="authTitle">登录</h3>
    <div id="authFieldsLogin">
      <label class="field">用户名</label><input class="in" id="au" autocomplete="username">
      <label class="field">密码</label><input class="in" id="ap" type="password" autocomplete="current-password">
    </div>
    <div id="authFieldsReg" style="display:none">
      <label class="field">用户名</label><input class="in" id="au2" autocomplete="username">
      <label class="field">邮箱</label><input class="in" id="ae" type="email" autocomplete="email" placeholder="用于验证与找回密码">
      <label class="field">密码</label><input class="in" id="ap2" type="password" autocomplete="new-password">
      <label style="display:flex;align-items:flex-start;gap:8px;margin-top:12px;font-size:12.5px;color:var(--mut);cursor:pointer">
        <input type="checkbox" id="acceptTerms" style="margin-top:2px">
        <span>我已阅读并同意 <a href="terms.html" target="_blank">《用户协议》</a> 与 <a href="privacy.html" target="_blank">《隐私政策》</a></span>
      </label>
    </div>
    <div id="authForgot" style="display:none">
      <label class="field">用户名或邮箱</label><input class="in" id="af" autocomplete="username">
    </div>
    <div class="err" id="authErr"></div>
    <div class="row">
      <button class="btn ghost" id="authForgotLink" type="button" style="display:none">忘记密码？</button>
      <button class="btn ghost" id="authSwitch" type="button">去注册</button>
      <button class="btn" id="authGo" type="button">登录</button>
    </div>
    <div style="text-align:center;margin-top:10px"><a href="terms.html" style="font-size:12px;color:var(--mut)">用户协议</a> · <a href="privacy.html" style="font-size:12px;color:var(--mut)">隐私政策</a> · <a href="disclaimer.html" style="font-size:12px;color:var(--mut)">免责声明</a></div>
  </div>
</div>`;

// 公共 JS：主题/登录模态/文档清单 + 各页脚本（pageScript 占位）。
// navActive 用于高亮当前导航。
function SHARED_JS(pageScript) {
  return `(function(){
var escU=function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');};
var escS=escU;
var theme=(function(){try{return localStorage.getItem('chm-theme')||(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch(e){return 'light';}})();
document.documentElement.dataset.theme=theme;
var tb=document.getElementById('themeBtn');
if(tb){tb.textContent=theme==='dark'?'☀️':'🌙';tb.addEventListener('click',function(){var n=document.documentElement.dataset.theme==='dark'?'light':'dark';
  document.documentElement.dataset.theme=n;try{localStorage.setItem('chm-theme',n);}catch(e){}tb.textContent=n==='dark'?'☀️':'🌙';});}
(function(){var nav=document.querySelector('[data-nav="__NAV_ACTIVE__"]');if(nav)nav.classList.add('on');
  var mn=document.getElementById('menuBtn'),dr=document.getElementById('navDrawer'),bk=document.getElementById('navBackdrop');
  function openNav(){if(dr)dr.classList.add('open');if(bk)bk.style.display='block';}
  function closeNav(){if(dr)dr.classList.remove('open');if(bk)bk.style.display='none';}
  if(mn)mn.addEventListener('click',openNav);
  if(bk)bk.addEventListener('click',closeNav);
  var nc=document.getElementById('navClose');if(nc)nc.addEventListener('click',closeNav);
  if(dr)dr.querySelectorAll('a').forEach(function(a){a.addEventListener('click',closeNav);});})();
var USER_TOKEN=(function(){try{return localStorage.getItem('chm_user')||'';}catch(e){return '';}})();
function csrfHeader(){try{var csrf=document.cookie.split('; ').find(function(c){return c.indexOf('chm_csrf=')===0;});return csrf?csrf.split('=')[1]:'';}catch(e){return '';}}
function userHeaders(){var h=USER_TOKEN?{'X-User-Token':USER_TOKEN}:{};var csrf=csrfHeader();if(csrf)h['X-CSRF-Token']=csrf;return h;}
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
function doAuth(){var er=document.getElementById('authErr');
  var title=document.getElementById('authTitle').textContent;
  if(title.indexOf('忘记')===0){
    var af=document.getElementById('af').value.trim();if(!af){er.textContent='请输入用户名或邮箱';return;}
    fetch('/api/forgot-password',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},userHeaders()),body:JSON.stringify({usernameOrEmail:af})})
      .then(function(r){return r.json().then(function(j){return {st:r.status,j:j};});}).then(function(x){
        if(x.st===200)er.style.color='#16a34a';else er.style.color='';
        er.textContent=(x.st===200)?'如果该账号存在，我们已发送重置邮件。':((x.j&&x.j.error)||'失败');}).catch(function(e){er.textContent='网络错误：'+e.message;});
    return;}
  var mode=title.indexOf('注册')===0?'register':'login';
  var bodyObj;
  if(mode==='register'){
    var ru=document.getElementById('au2').value.trim(),re=document.getElementById('ae').value.trim(),rp=document.getElementById('ap2').value,acc=document.getElementById('acceptTerms');
    if(!ru||!re||!rp){er.textContent='请填写用户名、邮箱和密码';return;}
    if(!acc||!acc.checked){er.textContent='请阅读并同意用户协议与隐私政策';return;}
    bodyObj={username:ru,email:re,password:rp,acceptTerms:true};
  }else{
    var u=document.getElementById('au').value.trim(),p=document.getElementById('ap').value;
    if(!u||!p){er.textContent='请填写用户名和密码';return;}
    bodyObj={username:u,password:p};
  }
  fetch('/api/'+mode,{method:'POST',headers:Object.assign({'Content-Type':'application/json'},userHeaders()),body:JSON.stringify(bodyObj)})
    .then(function(r){return r.json().then(function(j){return {st:r.status,j:j};});}).then(function(x){
      if(x.st===200&&x.j.token){USER_TOKEN=x.j.token;try{localStorage.setItem('chm_user',USER_TOKEN);}catch(e){}
        currentUser=x.j.username||bodyObj.username;window.__closeAuth();renderAuth();afterMe();
        if(mode==='register')er.textContent='注册成功，验证邮件已发送（开发模式见 logs/mailer.log）';
      }
      else er.textContent=(x.j&&x.j.error)||'失败';
      if(x.j&&x.j.token)er.textContent='';
    })
    .catch(function(e){er.textContent='网络错误：'+e.message;});}
if(lb)lb.addEventListener('click',function(){if(currentUser){fetch('/api/logout',{method:'POST',headers:userHeaders()}).catch(function(){});USER_TOKEN='';currentUser=null;
  try{localStorage.removeItem('chm_user');}catch(e){}renderAuth();afterMe();}else window.__openAuth();});
if(modal){document.getElementById('authGo').addEventListener('click',doAuth);
  function showLogin(){
    document.getElementById('authTitle').textContent='登录';
    document.getElementById('authGo').textContent='登录';
    document.getElementById('authSwitch').textContent='去注册';
    document.getElementById('authFieldsLogin').style.display='';
    document.getElementById('authFieldsReg').style.display='none';
    document.getElementById('authForgot').style.display='none';
    document.getElementById('authForgotLink').style.display='';
  }
  document.getElementById('authSwitch').addEventListener('click',function(){
    var reg=document.getElementById('authTitle').textContent==='登录';
    var forgotView=document.getElementById('authTitle').textContent.indexOf('忘记')===0;
    if(forgotView){showLogin();return;}
    document.getElementById('authTitle').textContent=reg?'注册新账号':'登录';
    document.getElementById('authGo').textContent=reg?'注册':'登录';
    document.getElementById('authSwitch').textContent=reg?'去登录':'去注册';
    document.getElementById('authFieldsLogin').style.display=reg?'none':'';
    document.getElementById('authFieldsReg').style.display=reg?'':'none';
    document.getElementById('authForgot').style.display='none';
    document.getElementById('authForgotLink').style.display=reg?'none':'';
    document.getElementById('authErr').textContent='';
  });
  var fl=document.getElementById('authForgotLink');
  if(fl)fl.addEventListener('click',function(){
    document.getElementById('authTitle').textContent='忘记密码';
    document.getElementById('authGo').textContent='发送重置链接';
    document.getElementById('authSwitch').textContent='返回登录';
    document.getElementById('authFieldsLogin').style.display='none';
    document.getElementById('authFieldsReg').style.display='none';
    document.getElementById('authForgot').style.display='';
    document.getElementById('authForgotLink').style.display='none';
  });
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
  const desc = pageDesc(navActive, title);
  return `<!doctype html><html lang="zh" data-theme="light"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="keywords" content="CHM,CHM网页,CHM在线阅读,CHM转换,文档分享,全文检索,批量导出">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CHM 网页">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta name="twitter:card" content="summary">
<style>${CSS}</style>
</head><body>
${NAV}
<div class="hero${heroSmall ? ' small' : ''}">${heroInner}</div>
<div class="wrap">${body}</div>
<div class="foot">CHM 网页 · 免费 · 非营利 · 数据仅用于转换与展示<br>
  <a href="terms.html">用户协议</a> · <a href="privacy.html">隐私政策</a> · <a href="disclaimer.html">免责声明</a> · <a href="report.html">侵权举报</a> · <a href="https://docs.qq.com/form/page/DWkh0VFdOb2tFVFJV" target="_blank" rel="noopener">📝 问题反馈</a></div>
${MODAL}
<script>
${SHARED_JS(pageScript).split('__NAV_ACTIVE__').join(esc(navActive || 'home'))}
</script>
</body></html>`;
}

/** 按页面生成简短的 description，提升搜索引擎/社交分享预览体验。 */
function pageDesc(navActive, title) {
  const t = String(title || '');
  if (t.indexOf('用户协议') !== -1) return 'CHM 网页用户协议：使用本平台前请阅读并同意服务条款。';
  if (t.indexOf('隐私') !== -1) return 'CHM 网页隐私政策：我们只收集提供转换与账号服务所必需的信息，不出售个人数据。';
  if (t.indexOf('免责') !== -1) return 'CHM 网页免责声明：平台为自动化转换工具，内容由上传者负责。';
  if (t.indexOf('侵权举报') !== -1) return '如认为本站内容侵犯您的权益，请通过举报页提交材料，我们将尽快处理。';
  if (navActive === 'browse') return '浏览 CHM 网页上公开的文档，标题/标签/作者快速筛选，随时在线翻阅。';
  if (navActive === 'upload') return '上传 CHM 文档，自动转换为手机/电脑均可浏览、搜索的在线页面，可批量导出。';
  if (navActive === 'mine') return '管理你的 CHM 文档：重命名、标签、作者、可见性、批量导出与删除。';
  return '免费将 CHM 文档转换为可浏览、可搜索的网页，支持批量上传、私有分享与静态站点导出。';
}

/* ============ 合规页面 / 举报页 ============ */

const legalPage = (title, heading, sections, navActive) => page(title, true, `
  <div class="eyebrow">法律与合规</div><h1>${esc(heading)}</h1>`, `
  <div class="legal card" style="padding:26px">
    ${sections.map((s) => `<h2>${esc(s.h)}</h2>${s.body}`).join('\n')}
  </div>`, ``, navActive);

const TERMS = legalPage('用户协议 · CHM 网页', '用户协议', [
  { h: '1. 服务说明', body: `<p>本平台提供 CHM 文档转换、浏览与分享的技术工具服务。用户通过本平台上传 CHM 文件，系统自动转换为可浏览页面。</p>` },
  { h: '2. 用户责任', body: `<p>用户应保证对上传的 CHM 文档拥有合法权利，包括但不限于著作权、使用权或合法授权。禁止上传侵犯第三方著作权、商标权、隐私权或其他合法权益的内容。</p>` },
  { h: '3. 内容归属', body: `<p>平台不主张对用户上传内容的所有权。上传内容的知识产权仍归权利人所有，本平台仅提供技术处理与托管。</p>` },
  { h: '4. 免责', body: `<p>用户自行对其上传内容负责。因用户上传内容引发的纠纷、索赔或处罚，由用户自行承担；平台在收到有效权利人通知后配合下架。</p>` },
  { h: '5. 账号安全', body: `<p>请妥善保管账号密码。任何通过你的账号进行的操作，均视为你本人的行为。</p>` },
  { h: '6. 服务变更', body: `<p>本平台有权根据运营需要调整、暂停或终止服务，并尽可能提前通知。</p>` },
], 'terms');

const PRIVACY = legalPage('隐私政策 · CHM 网页', '隐私政策', [
  { h: '1. 收集信息', body: `<p>我们收集：用户名、邮箱（用于验证与找回）、上传文件、访问日志（IP/UA）等为提供服务所必需的信息。</p>` },
  { h: '2. 使用目的', body: `<p>用于账号管理、文件转换、内容展示、安全防护与改进体验。我们不会将个人信息出售给第三方。</p>` },
  { h: '3. 存储与删除', body: `<p>数据存储在阿里云服务器。用户可以删除自己的文档；注销/删除账号可联系管理员处理。</p>` },
  { h: '4. Cookies', body: `<p>使用 Cookie 维持登录会话与 CSRF 防护，不使用跨站追踪 Cookie。</p>` },
  { h: '5. 未成年人', body: `<p>若您未满 18 岁，请勿上传与您学习无关的内容或在监护人指导下使用。</p>` },
], 'privacy');

const DISCLAIMER = legalPage('免责声明 · CHM 网页', '免责声明', [
  { h: '1. 平台性质', body: `<p>本平台是一个自动化转换工具，不对用户上传的 CHM 文件内容进行事前审查。所有内容由上传者提供，与平台无关。</p>` },
  { h: '2. 著作权', body: `<p>请勿上传未经授权的受版权保护材料。若您为权利人，发现本站展示内容侵犯您的权利，请通过 <a href="report.html">侵权举报</a> 提交材料，我们将在核实后尽快删除。</p>` },
  { h: '3. 责任限制', body: `<p>在适用法律允许范围内，平台不对因用户上传内容、外部链接或不可抗力导致的损失承担责任。用户使用本站即视为接受本声明。</p>` },
], 'disclaimer');

const REPORT = page('侵权举报 · CHM 网页', true, `
  <div class="eyebrow">合规</div><h1>侵权举报 / 权利人投诉</h1>`, `
  <div class="report-form">
    <div class="card">
      <p style="color:var(--mut)">如您认为本站内容侵犯了您的合法权益，请填写以下信息，我们将在核实后处理（通常 1-3 个工作日）。</p>
      <label class="field">文档 ID 或 URL（必填）</label><input class="in" id="repUrl" placeholder="例如 /d/xxxxx/">
      <label class="field">举报原因（必填）</label><textarea class="in" id="repReason" rows="4" style="resize:vertical"></textarea>
      <label class="field">联系邮箱（选填）</label><input class="in" id="repContact" type="email">
      <div class="message" id="repMsg"></div>
      <div style="text-align:center"><button class="btn" id="repGo">提交举报</button></div>
    </div>
  </div>`, `
  document.getElementById('repGo').addEventListener('click',function(){
    var url=document.getElementById('repUrl').value.trim(),reason=document.getElementById('repReason').value.trim(),contact=document.getElementById('repContact').value.trim();
    var msg=document.getElementById('repMsg');
    if(!url||!reason){msg.innerHTML='<span class="err">请填写文档地址和举报原因</span>';return;}
    fetch('/api/report',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},userHeaders()),body:JSON.stringify({url:url,docId:url.replace(/^\\/d\\//,'').replace(/\\/$/,''),reason:reason,contact:contact})})
      .then(function(r){return r.json().then(function(j){return {st:r.status,j:j};});}).then(function(x){
        if(x.st===200){msg.innerHTML='<span class="ok">举报已提交，我们将尽快处理。</span>';document.getElementById('repUrl').value='';document.getElementById('repReason').value='';document.getElementById('repContact').value='';}
        else msg.innerHTML='<span class="err">'+(x.j&&x.j.error||'提交失败')+'</span>';})
      .catch(function(e){msg.innerHTML='<span class="err">网络错误：'+e.message+'</span>';});
  });`, 'report');

const ADMIN = page('管理后台 · CHM 网页', true, `
  <div class="eyebrow">管理后台</div><h1>举报处理 / 文档下架</h1>
  <div class="sub">使用 ADMIN_TOKEN 登录后台，处理侵权举报。</div>`, `
  <div class="admin-box">
    <div class="card admin-form">
      <label class="field">管理员令牌</label>
      <input class="in" id="admToken" type="password" autocomplete="current-password" placeholder="请输入 ADMIN_TOKEN">
      <div class="message" id="admMsg"></div>
      <div style="text-align:center"><button class="btn" id="admGo">加载举报</button></div>
      <div style="text-align:center;margin-top:8px"><a href="report.html">查看公开举报页</a></div>
    </div>
    <div id="admPanel" style="display:none"></div>
  </div>`, `
  var admBox=document.getElementById('admPanel'),admMsg=document.getElementById('admMsg');
  function escA(x){return escS(x).replace(/'/g,'&#39;');}
  function admHeaders(extra){var h={};if(window.__admToken){h['X-Admin-Token']=window.__admToken;}var csrf=csrfHeader();if(csrf)h['X-CSRF-Token']=csrf;if(extra)Object.assign(h,extra);return h;}
  function admJson(method,url,body){return fetch(url,{method:method,headers:Object.assign({'Content-Type':'application/json'},admHeaders()),body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().then(function(j){return {st:r.status,j:j};});});}
  function statusText(s){return {pending:'待处理',processing:'处理中',resolved:'已解决',rejected:'已驳回'}[s]||s||'';}
  function renderReports(reports){
    if(!reports||!reports.length){admBox.innerHTML='<div class="card" style="padding:24px;text-align:center;color:var(--mut)">暂无举报</div>';return;}
    admBox.innerHTML='<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">'+
      '<button class="btn sm" data-status="">全部</button>'+
      '<button class="btn ghost sm" data-status="pending">待处理</button>'+
      '<button class="btn ghost sm" data-status="processing">处理中</button>'+
      '<button class="btn ghost sm" data-status="resolved">已解决</button>'+
      '<button class="btn ghost sm" data-status="rejected">已驳回</button></div>'+
      reports.map(function(r){
        var href=r.url||r.docId?('/d/'+(r.docId||'').replace(/^\\/d\\//,'')+'/'):'';
        return '<div class="card" style="padding:18px;margin-bottom:12px">'+
        '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>#'+escA(r.id)+'</b>'+
        '<span class="tag '+(r.status==='pending'?'':'')+'" style="color:var(--mut)">'+escA(statusText(r.status))+'</span></div>'+
        '<div style="font-size:13px;color:var(--mut);margin:6px 0">'+(r.docId?'文档 ID：<b>'+escA(r.docId)+'</b><br>':'')+
        (r.url?'地址：'+escA(r.url)+'<br>':'')+(r.contact?'联系：'+escA(r.contact)+'<br>':'')+
        (r.ip?'来源：'+escA(r.ip)+'<br>':'')+'时间：'+(new Date(r.createdAt).toLocaleString()) +'</div>'+
        '<div style="font-size:14px;white-space:pre-wrap;word-break:break-word">'+escA(r.reason)+'</div>'+
        '<div class="admin-actions">'+
        '<button class="btn sm" data-st="processing" data-id="'+escA(r.id)+'">标记处理中</button>'+
        '<button class="btn sm" data-st="resolved" data-id="'+escA(r.id)+'">标记已解决</button>'+
        '<button class="btn ghost sm" data-st="rejected" data-id="'+escA(r.id)+'">驳回</button>'+
        (href?'<a href="'+escA(href)+'" class="btn ghost sm">打开文档</a>':'')+
        (href?'<button class="btn danger sm" data-del="'+escA(r.id)+'" data-href="'+escA(href)+'">下架文档</button>':'')+
        '</div></div>';
      }).join('');
    Array.prototype.forEach.call(admBox.querySelectorAll('[data-st]'),function(b){b.addEventListener('click',function(){admSet(b.getAttribute('data-id'),b.getAttribute('data-st'));});});
    Array.prototype.forEach.call(admBox.querySelectorAll('[data-del]'),function(b){b.addEventListener('click',function(){admDelDoc(b.getAttribute('data-id'),b.getAttribute('data-href'));});});
    Array.prototype.forEach.call(admBox.querySelectorAll('button[data-status]'),function(b){b.addEventListener('click',function(){load(b.getAttribute('data-status'));});});
  }
  function load(st){var st=st||'';admMsg.innerHTML='';return fetch('/admin/reports'+(st?'?status='+encodeURIComponent(st):''),{headers:admHeaders()}).then(function(r){return r.json().then(function(j){return {st:r.status,j:j};});}).then(function(x){if(x.st===200){admBox.style.display='';render(x.j.reports||[]);}else{admMsg.innerHTML='<span class="err">'+(x.j&&x.j.error||'加载失败')+'</span>';}}).catch(function(e){admMsg.innerHTML='<span class="err">网络错误：'+e.message+'</span>';});}
  function admSet(id,st){fetch('/admin/reports/'+encodeURIComponent(id),{method:'PATCH',headers:Object.assign({'Content-Type':'application/json'},admHeaders()),body:JSON.stringify({status:st})}).then(function(r){return r.json().then(function(j){return {st:r.status,j:j};});}).then(function(x){if(x.st===200)load();else{alert((x.j&&x.j.error)||'更新失败');}}).catch(function(e){alert('网络错误：'+e.message);});}
  function admDelDoc(id,href){if(!confirm('确认下架该文档？此操作会删除文档实体，不可恢复。'))return;fetch('/admin/remove-doc',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},admHeaders()),body:JSON.stringify({docId:(href||'').replace(/^\\/d\\//,'').replace(/\\/$/,'')})}).then(function(r){return r.json().then(function(j){return {st:r.status,j:j};});}).then(function(x){alert((x.j&&(x.j.ok?'已下架':'失败：'+x.j.error))||'下架失败');if(x.st===200)load();}).catch(function(e){alert('网络错误：'+e.message);});}
  document.getElementById('admGo').addEventListener('click',function(){
    var t=document.getElementById('admToken').value.trim();if(!t){admMsg.innerHTML='<span class="err">请输入管理员令牌</span>';return;}
    window.__admToken=t;load();
  });
  document.getElementById('admToken').addEventListener('keydown',function(e){if(e.key==='Enter')document.getElementById('admGo').click();});
  window.__onAuth=function(){};`, 'admin');

/* ============ 页面 ============ */

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
  <div style="max-width:820px;margin:40px auto 0">
    <h2 style="font-size:18px;margin:0 0 14px">公开文档</h2>
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
  function local(q){q=String(q||'').toLowerCase();var rows=[];(siKw||[]).slice(0,120).forEach(function(k){if((k.name||'').toLowerCase().indexOf(q)!==-1)rows.push({grp:k.dn||k.doc||'',href:k.href||'',t:k.name,p:k.dn||k.doc||''});});
    (siRec||[]).forEach(function(rep){var lt=(rep.text||'').toLowerCase(),at=lt.indexOf(q);if(at===-1)return;
      var pg=(rep.text.match(/\\[page:([^\\]]+)\\]/)||[])[1]||'';var ctx=rep.text.slice(Math.max(0,at-30),at+100).replace(/\\s+/g,' ');
      rows.push({grp:rep.name||rep.doc||'',href:'d/'+(rep.doc||'')+'/'+pg,t:pg||'',p:ctx});});
    var seen={},u=[];rows.forEach(function(r){var k=r.href+'|'+r.t;if(!seen[k]){seen[k]=1;u.push(r);}});render(u);}
  function apiFn(q){fetch('/api/search?q='+encodeURIComponent(q)+'&limit=20').then(function(r){return r.json();}).then(function(j){
    var rows=(j&&j.hits||[]).map(function(h){return {grp:h.doc||'',href:h.href||('d/'+(h.doc||'')+'/'),t:h.doc||'',p:h.snippet||''};});render(rows);}).catch(function(){local(q);});}
  siteq.addEventListener('input',function(){var v=siteq.value.trim();if(!v){sres.style.display='none';return;}if(api)apiFn(v);else local(v);});
  document.addEventListener('click',function(e){if(e.target!==siteq&&!sres.contains(e.target))sres.style.display='none';});
  function recentRender(list){var box=document.getElementById('recentDocs');var arr=list&&list.length?list:window.__docs||[];
    if(!arr.length){box.innerHTML='<div style="color:var(--mut);font-size:14px;text-align:center">还没有公开文档，去上传第一个吧。</div>';return;}
    arr=arr.filter(function(d){return d.visibility!=='private';});
    if(!arr.length){box.innerHTML='<div style="color:var(--mut);font-size:14px;text-align:center">还没有公开文档，去上传第一个吧。</div>';return;}
    box.innerHTML='<div class="doc-grid">'+arr.slice(0,6).map(function(d){
      var tags=(d.tags||[]).map(function(t){return '<span class="tag">#'+escS(t)+'</span>';}).join('');
      return '<div class="card doc-card"><span style="font-size:28px">📘</span>'+
      '<b class="doc-title">'+escS(d.name||d.id)+'</b>'+
      (d.author?'<div style="font-size:12.5px;color:var(--mut)">作者：'+escS(d.author)+'</div>':'')+
      '<span class="tag pub">公开</span>'+
      (tags?'<div class="doc-tags">'+tags+'</div>':'')+
      '<a href="'+escS(d.href||('d/'+d.id+'/'))+'" class="btn ghost sm" style="margin-top:auto">打开 →</a></div>';}).join('')+'</div>';}
  function recent(){fetch('/api/docs',{headers:userHeaders()}).then(function(r){return r.json();}).then(function(j){if(j&&j.docs){window.__setDocs(j.docs);recentRender(j.docs);}}).catch(function(){recentRender();});}
  recent();
  window.__onAuth=function(){renderAuth();if(window.location.hash==='#mine')location.reload();};
`, 'home');

const BROWSE = page('浏览文档 · CHM 网页', true, `
  <div class="eyebrow">浏览文档</div><h1>站内文档</h1>
  <div class="sub">所有公开文档，随时翻阅。</div>`, `
  <div style="max-width:820px;margin:28px auto 0">
    <input class="in" id="browseQ" placeholder="在标题中筛选…" style="margin-bottom:12px">
    <div id="browseFilters" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px"></div>
    <div id="browseList"></div>
  </div>`, `
  var box=document.getElementById('browseList'),q=document.getElementById('browseQ'),filters=document.getElementById('browseFilters');
  var fTag='',fAuthor='';
  function render(list){var arr=list&&list.length?list:window.__docs||[];
    arr=arr.filter(function(d){return d.visibility!=='private';});
    if(fTag)arr=arr.filter(function(d){return (d.tags||[]).indexOf(fTag)!==-1;});
    if(fAuthor)arr=arr.filter(function(d){return (d.author||'')===fAuthor;});
    if(!arr.length){box.innerHTML='<div style="text-align:center;color:var(--mut);padding:40px 0">没有匹配的文档</div>';return;}
    box.innerHTML=arr.map(function(d){
      return '<div class="card row-card"><span style="font-size:24px">📘</span>'+
      '<span style="flex:1;min-width:0"><b style="display:block;font-size:16px">'+escS(d.name||d.id)+'</b>'+
      (d.author?'<div style="font-size:13px;color:var(--mut)">作者：'+escS(d.author)+'</div>':'')+
      '<span class="tag pub">公开</span>'+
      (d.tags||[]).map(function(t){return '<span class="tag" data-tag="'+escS(t)+'" style="cursor:pointer">#'+escS(t)+'</span>';}).join('')+
      '</span>'+
      '<a href="'+escS(d.href||('d/'+d.id+'/'))+'" class="btn ghost sm">打开 →</a></div>';}).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-tag]'),function(b){b.addEventListener('click',function(){fTag=b.getAttribute('data-tag');refresh();});});
  }
  function renderFilters(allArr){var tagSet=[],authorSet=[];(allArr||[]).forEach(function(d){if(d.visibility==='private')return;(d.tags||[]).forEach(function(t){if(tagSet.indexOf(t)===-1)tagSet.push(t);});if(d.author&&authorSet.indexOf(d.author)===-1)authorSet.push(d.author);});
    var h='';
    if(tagSet.length){h+='<button class="btn ghost sm" data-tag="" style="'+(fTag===''?'border-color:var(--acc);color:var(--acc)':'')+'">全部标签</button>'+tagSet.map(function(t){return '<button class="btn ghost sm" data-tag="'+escS(t)+'" style="'+(fTag===t?'border-color:var(--acc);color:var(--acc)':'')+'">#'+escS(t)+'</button>';}).join('');}
    if(authorSet.length){h+='<button class="btn ghost sm" data-author="" style="'+(fAuthor===''?'border-color:var(--acc);color:var(--acc)':'')+'">全部作者</button>'+authorSet.map(function(a){return '<button class="btn ghost sm" data-author="'+escS(a)+'" style="'+(fAuthor===a?'border-color:var(--acc);color:var(--acc)':'')+'">'+escS(a)+'</button>';}).join('');}
    if(filters)filters.innerHTML=h;
    Array.prototype.forEach.call(filters.querySelectorAll('[data-tag]'),function(b){b.addEventListener('click',function(){fTag=b.getAttribute('data-tag');fAuthor='';refresh();});});
    Array.prototype.forEach.call(filters.querySelectorAll('[data-author]'),function(b){b.addEventListener('click',function(){fAuthor=b.getAttribute('data-author');fTag='';refresh();});});
  }
  function allArr(){return window.__docs||[];}
  function refresh(){var s=(q&&q.value||'').trim().toLowerCase();var arr=allArr().filter(function(d){return (d.name||d.id||'').toLowerCase().indexOf(s)!==-1;});renderFilters(allArr());render(arr);}
  function load(){fetch('/api/docs',{headers:userHeaders()}).then(function(r){return r.json();}).then(function(j){if(j&&j.docs){window.__setDocs(j.docs);refresh();}}).catch(function(){refresh();});}
  if(q)q.addEventListener('input',refresh);
  load();refresh();
  window.__onAuth=function(){load();};`, 'browse');

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
      <div id="progWrap" style="display:none;margin-top:14px">
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--mut);margin-bottom:6px">
          <span id="progLabel">上传中…</span><span id="progPct">0%</span></div>
        <div style="height:10px;border-radius:999px;background:var(--hover);overflow:hidden">
          <div id="progBar" style="height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#7c3aed,#c084fc);transition:width .15s ease"></div>
        </div>
      </div>
      <div id="batchDone" style="display:none;margin-top:14px;text-align:center">
        <button class="btn" id="packZip" type="button">⬇ 把刚上传的这篇打包成 zip 下载</button>
        <button class="btn ghost" id="retryFail" type="button" style="display:none">↻ 重试失败的 N 个</button>
        <div style="font-size:13px;color:var(--mut);margin-top:6px">公开文档直接生成独立静态站点；私密文档也会一并打包。</div>
      </div>
      <div class="message" id="msg"></div>
      <div style="text-align:center"><button class="btn" id="go" disabled>转换文档</button></div>
    </div>
    <div class="card" style="margin-top:18px;padding:20px;font-size:13.5px;color:var(--mut)">
      <b>批量说明</b>：可一次选择多个 .chm，逐个转换并汇总进度；转换完成后可直接把整批打包成 zip 下载，也可到「我的文档」里管理可见性与分享。
    </div>
    <label style="display:flex;align-items:flex-start;gap:8px;margin-top:14px;font-size:13px;color:var(--mut);cursor:pointer">
      <input type="checkbox" id="uploadAgree">
      <span>我已确认拥有该 CHM 文档的合法权利/已获授权，且不会违反第三方著作权。详见 <a href="disclaimer.html">免责声明</a>。</span>
    </label>
  </div>`, `
  var gate=document.getElementById('uploadGate'),work=document.getElementById('uploadWork');
  document.getElementById('gateLogin').addEventListener('click',function(){window.__openAuth();});
  function updateGate(){if(window.currentUser){work.style.display='';gate.style.display='none';}else{work.style.display='none';gate.style.display='';}}
  window.__onAuth=updateGate;loadMe();updateGate();
  var file=document.getElementById('file'),drop=document.getElementById('drop'),go=document.getElementById('go'),msg=document.getElementById('msg');
  var all=[],seq=0,ok=[],fail=[],failFiles=[],okId=[];
  var batchDone=document.getElementById('batchDone'),packBtn=document.getElementById('packZip'),retryBtn=document.getElementById('retryFail');
  function packZip(){if(!okId.length)return;var ids=okId.slice();if(packBtn)packBtn.disabled=true;
    fetch('/api/export-docs',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},userHeaders()),body:JSON.stringify({ids:ids,title:ids.length>1?'批量上传导出':'单篇上传导出'})}).then(function(r){return r.json().then(function(j){return {st:r.status,j:j};});}).then(function(x){
      if(packBtn)packBtn.disabled=false;
      if(x.st===200&&x.j&&x.j.zip){var blob=new Blob([Uint8Array.from(atob(x.j.zip),function(c){return c.charCodeAt(0);})],{type:'application/zip'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='chm-web-docs-'+Date.now()+'.zip';document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);document.body.removeChild(a);},200);msg.innerHTML='<span class="ok">打包完成，已开始下载。</span>';}
      else{msg.innerHTML='<span class="err">打包失败：'+(x.j&&x.j.error||'未知错误')+'</span>';}
    }).catch(function(e){if(packBtn)packBtn.disabled=false;msg.innerHTML='<span class="err">网络错误：'+e.message+'</span>';});}
  function retryFailed(){if(!failFiles.length)return;var fs2=failFiles.slice();failFiles=[];if(retryBtn)retryBtn.style.display='none';runUploads(fs2);}
  function runUploads(files){var mySeq=++seq;go.disabled=true;var i=0;
    (function loop(){if(i>=files.length){go.disabled=false;finish();return;}var f=files[i];
      go.textContent='转换中 '+(i+1)+'/'+files.length;
      setProg(0,(files.length>1?('第 '+(i+1)+'/'+files.length+' 个 · '):'')+escS(f.name)+' — 上传中…');
      doUpload(f,function(){if(seq!==mySeq)return;i++;loop();},function(p){setProg(p,'正在上传 '+escS(f.name)+'…');});})();}
  if(packBtn)packBtn.addEventListener('click',packZip);
  if(retryBtn)retryBtn.addEventListener('click',retryFailed);
  function sel(){var pk=document.getElementById('filePick');pk.innerHTML=all.map(function(f,i){return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border:1px solid var(--line);border-radius:9px;margin-bottom:6px">'+
    '<b>'+escS(f.name)+'</b><button type="button" data-i="'+i+'" class="rm" style="border:0;background:var(--hover);border-radius:50%;width:22px;height:22px;cursor:pointer">✕</button></div>';}).join('');
    Array.prototype.forEach.call(pk.querySelectorAll('.rm'),function(b){b.addEventListener('click',function(){all.splice(+b.getAttribute('data-i'),1);sel();});});
    go.textContent=all.length>1?('转换 '+all.length+' 个文档'):'转换文档';go.disabled=!(all.length>0);}
  function addFiles(list){list=list||[];Array.prototype.forEach.call(list,function(f){if(/\.chm$/i.test(f.name||''))all.push(f);else msg.innerHTML='<span class="err">跳过非 .chm：'+escS(f.name)+'</span>';});sel();}
  function vis(){var r=document.querySelector('input[name=vis]:checked');return (r&&r.value==='private')?'private':'public';}
  var progWrap=document.getElementById('progWrap'),progBar=document.getElementById('progBar'),progPct=document.getElementById('progPct'),progLabel=document.getElementById('progLabel');
  function setProg(p,label){if(!progWrap)return;progWrap.style.display='';progBar.style.width=Math.max(0,Math.min(100,p))+'%';progPct.textContent=Math.round(p)+'%';if(label)progLabel.textContent=label;}
  function hideProg(){if(progWrap)progWrap.style.display='none';}
  var isDone=false;
  function doUpload(f,cb,onProg){var fd=new FormData();fd.append('file',f);fd.append('visibility',vis());
    fd.append('acceptTerms', (document.getElementById('uploadAgree')||{}).checked ? 'true':'false');
    var xhr=new XMLHttpRequest();
    xhr.open('POST','/api/upload');
    var tok=USER_TOKEN;if(tok)xhr.setRequestHeader('X-User-Token',tok);
    var csrf=csrfHeader();if(csrf)xhr.setRequestHeader('X-CSRF-Token',csrf);
    xhr.upload.onprogress=function(e){if(e.lengthComputable&&onProg)onProg(e.loaded/e.total*100);};
    xhr.onloadstart=function(){if(onProg)onProg(0);};
    xhr.onload=function(){if(onProg)onProg(100,'正在转换（解包 + 生成阅读页）…');var j={};try{j=JSON.parse(xhr.responseText);}catch(e){}
      if(xhr.status===200&&j.ok){ok.push(j.name||f.name);if(j.id)okId.push(j.id);}else{fail.push(f.name);failFiles.push(f);if(msg)msg.innerHTML='<span class="err">失败：'+escS(f.name)+'（'+(j&&j.error||'未知错误')+'）</span>';}cb();};
    xhr.onerror=function(){fail.push(f.name);failFiles.push(f);cb();};
    xhr.send(fd);}
  function runBatch(){var files=all.slice();if(!files.length){msg.innerHTML='<span class="err">先选择 .chm 文件</span>';return;}
    var ag=document.getElementById('uploadAgree');if(!ag||!ag.checked){msg.innerHTML='<span class="err">请先勾选确认拥有合法权利/授权</span>';return;}
    var mySeq=++seq;go.disabled=true;ok=[];fail=[];failFiles=[];okId=[];isDone=false;if(batchDone)batchDone.style.display='none';if(retryBtn)retryBtn.style.display='none';
    function finish(){go.disabled=false;all=[];sel();hideProg();isDone=!!ok.length;
      if(isDone&&batchDone){batchDone.style.display='';packBtn.textContent=ok.length>1?'⬇ 把刚上传的 '+ok.length+' 篇一起打包成 zip 下载':'⬇ 把刚上传的这篇打包成 zip 下载';
        if(failFiles.length&&retryBtn){retryBtn.style.display='';retryBtn.textContent='↻ 重试失败的 '+failFiles.length+' 个';}}
      msg.innerHTML=fail.length?('<span class="err">完成 '+ok.length+'，失败 '+fail.length+' 个（'+escS(fail.join('、'))+'）</span>'):('<span class="ok">全部转换成功！'+ok.length+' 篇已就绪，可在「我的文档」打开。</span>');}
    (function loop(i){if(i>=files.length)return finish();var f=files[i];
      go.textContent='转换中 '+i+'/'+files.length;
      setProg(0,(files.length>1?('第 '+(i+1)+'/'+files.length+' 个 · '):'')+escS(f.name)+' — 上传中…');
      doUpload(f,function(){if(seq!==mySeq)return;loop(i+1);},function(p){setProg(p,'正在上传 '+escS(f.name)+'…');});})(0);}
  drop.addEventListener('click',function(){file.click();});
  drop.addEventListener('dragover',function(e){e.preventDefault();drop.style.borderColor='var(--acc)';});
  drop.addEventListener('dragleave',function(){drop.style.borderColor='#b6c2d0';});
  drop.addEventListener('drop',function(e){e.preventDefault();addFiles(e.dataTransfer&&e.dataTransfer.files);drop.style.borderColor='#b6c2d0';});
  file.addEventListener('change',function(){addFiles(file.files);file.value='';});
  go.addEventListener('click',runBatch);`, 'upload');

const MINE = page('我的文档 · CHM 网页', true, `
  <div class="eyebrow">我的文档</div><h1>我的文档</h1>
  <div class="sub">管理你的私有 / 公开文档：改可见性、复制分享链接、删除。</div>`, `
  <div style="max-width:820px;margin:28px auto 0">
    <div class="card" style="padding:14px 20px;margin-bottom:16px;display:none" id="usageCard">
      <b>📦 已用容量</b>：<span id="usageText">--</span>
      <div style="font-size:13px;color:var(--mut);margin-top:2px">配额由服务器端控制，删除文档会实时释放。</div>
    </div>
    <div class="card" style="padding:14px 20px;margin-bottom:16px;display:none" id="privateSearchCard">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <b style="font-size:14px">🔍 搜索我的私密文档</b>
        <input class="in" id="privateSearchInput" placeholder="输入关键词…" style="flex:1;min-width:180px" autocomplete="off">
        <button class="btn sm" id="privateSearchBtn" type="button">搜索</button>
        <button class="btn ghost sm" id="privateSearchClear" type="button" style="display:none">清除</button>
      </div>
      <div id="privateSearchResults" style="margin-top:10px;font-size:13.5px"></div>
    </div>
    <div id="batchBar" style="display:none;margin-bottom:14px;padding:12px 16px;border:1px solid var(--line);border-radius:12px;background:var(--card);align-items:center;gap:10px;flex-wrap:wrap">
      <span>已选 <b id="selCount">0</b> 篇</span>
      <button class="btn ghost sm" id="batchExport" type="button">⬇ 导出选中</button>
      <button class="btn ghost sm" id="batchVis" type="button">设为公开</button>
      <button class="btn danger sm" id="batchDel" type="button">批量删除</button>
      <button class="btn ghost sm" id="batchClear" type="button">取消选择</button>
    </div>
    <div id="mineList"></div>
  </div>
  <div class="card" id="pwCard" style="max-width:820px;margin:28px auto 0;display:none">
    <div class="eyebrow">账号</div>
    <h2 style="font-size:17px;margin:0 0 4px">修改密码</h2>
    <div class="sub">改完后其它设备上的登录会自动失效，当前会话保持。</div>
    <div style="display:flex;flex-direction:column;gap:10px;max-width:420px;margin-top:14px">
      <input class="in" id="cpOld" type="password" placeholder="当前密码" autocomplete="current-password">
      <input class="in" id="cpNew" type="password" placeholder="新密码（至少 6 位）" autocomplete="new-password">
      <input class="in" id="cpConfirm" type="password" placeholder="确认新密码" autocomplete="new-password">
      <div class="err" id="cpErr"></div>
      <div style="display:flex;align-items:center;gap:10px"><button class="btn" id="cpGo" type="button">保存新密码</button></div>
    </div>
  </div>`, `
  var box=document.getElementById('mineList');
  function escS2(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  var usageCard=document.getElementById('usageCard'),usageText=document.getElementById('usageText');
  var batchBar=document.getElementById('batchBar'),selCount=document.getElementById('selCount');
  var selected={};
  function updateBatchBar(){if(!batchBar)return;var n=Object.keys(selected).length;if(selCount)selCount.textContent=n;batchBar.style.display=n?'flex':'none';}
  function fmtSize(b){b=+b||0;if(b>=1048576)return (b/1048576).toFixed(1)+' MB';if(b>=1024)return (b/1024).toFixed(1)+' KB';return b+' B';}
  function loadUsage(){if(!window.currentUser||!window.fetch||!usageCard)return;fetch('/api/usage',{headers:userHeaders()}).then(function(r){return r.json();}).then(function(j){
    if(j&&j.usage&&usageCard){usageCard.style.display='';usageText.textContent=(j.usage.docs||0)+' 篇 / '+fmtSize(j.usage.bytes||0);}})
    .catch(function(){});}
  // ---- 私密文档搜索 ----
  var privateSearchCard=document.getElementById('privateSearchCard'),privateSearchInput=document.getElementById('privateSearchInput'),privateSearchBtn=document.getElementById('privateSearchBtn'),privateSearchClear=document.getElementById('privateSearchClear'),privateSearchResults=document.getElementById('privateSearchResults');
  function mineHasPrivate(){return (window.__docs||[]).some(function(d){return window.currentUser && d.owner===window.currentUser && d.visibility==='private';});}
  function showPrivateSearch(on){if(!privateSearchCard)return;privateSearchCard.style.display=(on&&window.currentUser)?'':'none';}
  function runPrivateSearch(){
    var q=privateSearchInput.value.trim();if(!q){privateSearchResults.innerHTML='';return;}
    fetch('/api/search?scope=mine&q='+encodeURIComponent(q)+'&limit=20',{headers:userHeaders()}).then(function(r){return r.json();}).then(function(j){
      if(privateSearchClear)privateSearchClear.style.display='';
      if(!j||!j.hits||!j.hits.length){privateSearchResults.innerHTML='<div style="color:var(--mut)">没有匹配的私密文档内容。</div>';return;}
      privateSearchResults.innerHTML='<div style="margin-bottom:6px">命中 '+j.total+' 条：</div>'+j.hits.map(function(h){
        var url=h.href||('p/'+h.doc+'/');var title=escS2(h.doc||'');
        return '<div style="padding:5px 0;border-bottom:1px solid var(--line)"><a href="'+escS2(url)+'">'+title+'</a>'+
          (h.snippet?'<div style="color:var(--mut);font-size:12px;word-break:break-all">'+escS2(h.snippet)+'</div>':'')+'</div>';
      }).join('');
    }).catch(function(){privateSearchResults.innerHTML='<div style="color:var(--err)">搜索失败，请稍后重试。</div>';});
  }
  if(privateSearchBtn)privateSearchBtn.addEventListener('click',runPrivateSearch);
  if(privateSearchInput)privateSearchInput.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();runPrivateSearch();}});
  if(privateSearchClear)privateSearchClear.addEventListener('click',function(){privateSearchInput.value='';privateSearchResults.innerHTML='';privateSearchClear.style.display='none';});
  function touchPrivateSearch(){showPrivateSearch(mineHasPrivate());}
  function mineHasPrivate(){return (window.__docs||[]).some(function(d){return window.currentUser && d.owner===window.currentUser && d.visibility==='private';});}
  function showPrivateSearch(on){if(!privateSearchCard)return;privateSearchCard.style.display=(on&&window.currentUser)?'':'none';}
  function editMeta(id,name,tags,author){var nn=prompt('重命名文档',name||'');if(nn==null)return;var na=prompt('作者（可留空）',author||'');if(na==null)return;var nt=prompt('标签（用逗号分隔，最多 10 个）',(tags||[]).join(', '));if(nt==null)return;
    fetch('/api/doc/'+encodeURIComponent(id)+'/meta',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},userHeaders()),body:JSON.stringify({name:nn.trim(),author:na.trim(),tags:String(nt).split(/[,，;\s]+/).filter(function(t){return t.trim();})})})
      .then(function(r){return r.json().then(function(j){return {st:r.status,j:j};});}).then(function(x){if(x.st===200)load();else alert((x.j&&x.j.error)||'保存失败');}).catch(function(e){alert('网络错误：'+e.message);});}
  // 「我的文档」只展示当前登录用户自己上传的文档，绝不列公共区/他人/匿名种子文档。
  function mineOnly(list){return (list||[]).filter(function(d){return window.currentUser&&d.owner===window.currentUser;});}
  function toggleVis(id,btn){var target=btn.textContent.indexOf('公开')!==-1?'public':'private';
    fetch('/api/doc/'+encodeURIComponent(id)+'/visibility',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},userHeaders()),body:JSON.stringify({visibility:target})}).then(function(){load();});}
  function revokeShare2(id){if(!confirm('确认撤销该文档的分享链接？已有链接将立即失效。'))return;
    fetch('/api/doc/'+encodeURIComponent(id)+'/share',{method:'DELETE',headers:userHeaders()}).then(function(r){return r.json();}).then(function(){load();}).catch(function(){alert('撤销失败');});}
  function manageShareFlow(id){if(window.confirm('管理分享链接？' + String.fromCharCode(10) + '确定：设置/更新有效期；取消：撤销当前分享。')){manageShare(id);}else{revokeShare2(id);}}
  function shareLink(id){fetch('/api/doc/'+encodeURIComponent(id)+'/share',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},userHeaders()),body:'{}'}).then(function(r){return r.json();}).then(function(j){
      if(j.sharePath){var url=location.origin+location.pathname.replace(/\\/[^\\/]*$/,'/')+j.sharePath;if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(url).then(function(){alert('分享链接已复制');});}else{alert('分享链接：'+url);}}});}
  function del(id){if(!confirm('删除该文档？不可恢复。'))return;fetch('/api/doc/'+encodeURIComponent(id),{method:'DELETE',headers:userHeaders()}).then(function(){load();});}
  function manageShare(id){fetch('/api/doc/'+encodeURIComponent(id)+'/share',{headers:userHeaders()}).then(function(r){return r.json();}).then(function(j){
    if(!j||j.error){alert((j&&j.error)||'加载分享状态失败');return;}
    var exp='';
    if(j.expiresAt) exp=new Date(j.expiresAt).toISOString().slice(0,16).replace('T',' ');
    var msg='当前分享链接：'+(j.sharePath?('https://'+location.hostname+(location.port?':'+location.port:'')+j.sharePath):'（未创建）')+
      String.fromCharCode(10,10)+'有效期：'+(j.expiresAt?('到 '+exp):'永久')+
      String.fromCharCode(10,10)+'输入新的过期时间（留空=永久，格式 YYYY-MM-DDTHH:mm）或输入 0 保持原样：';
    var today=new Date();today.setDate(today.getDate()+1);var def=today.toISOString().slice(0,16);
    var input=window.prompt(msg, j.expiresAt?new Date(j.expiresAt).toISOString().slice(0,16):def);
    if(input===null)return;
    if(input==='0')input='';
    var expiresAt=input?new Date(input).getTime():null;
    if(input&&isNaN(expiresAt)){alert('日期格式无效');return;}
    fetch('/api/doc/'+encodeURIComponent(id)+'/share',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},userHeaders()),body:JSON.stringify({reset:false,expiresAt:expiresAt})}).then(function(r){return r.json();}).then(function(x){
      if(x.error){alert(x.error);return;}
      var url=location.origin+location.pathname.replace(/\\/[^\\/]*$/,'/')+x.sharePath;
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(url).then(function(){alert('分享链接已更新并复制');});}
      else alert('分享链接已更新：'+url);load();}).catch(function(e){alert('网络错误：'+e.message);});
  });
  function revokeShare2(id){if(!confirm('确认撤销该文档的分享链接？已有链接将立即失效。'))return;
    fetch('/api/doc/'+encodeURIComponent(id)+'/share',{method:'DELETE',headers:userHeaders()}).then(function(r){return r.json();}).then(function(){load();}).catch(function(){alert('撤销失败');});}
  function manageShareFlow(id){if(window.confirm('管理分享链接？' + String.fromCharCode(10) + '确定：设置/更新有效期；取消：撤销当前分享。')){manageShare(id);}else{revokeShare2(id);}}
  function shareLink(id){fetch('/api/doc/'+encodeURIComponent(id)+'/share',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},userHeaders()),body:'{}'}).then(function(r){return r.json();}).then(function(j){
      if(j.sharePath){var url=location.origin+location.pathname.replace(/\\/[^\\/]*$/,'/')+j.sharePath;if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(url).then(function(){alert('分享链接已复制');});}else{alert('分享链接：'+url);}}});}
  var ids=Object.keys(selected).filter(function(id){return selected[id];});if(!ids.length){alert('请先勾选文档');return;}
    fetch('/api/export-docs',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},userHeaders()),body:JSON.stringify({ids:ids,title:'选中导出'})}).then(function(r){return r.json().then(function(j){return {st:r.status,j:j};});}).then(function(x){
      if(x.st===200&&x.j&&x.j.zip){var blob=new Blob([Uint8Array.from(atob(x.j.zip),function(c){return c.charCodeAt(0);})],{type:'application/zip'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='chm-web-docs-'+Date.now()+'.zip';document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);document.body.removeChild(a);},200);}
      else alert((x.j&&x.j.error)||'导出失败');}).catch(function(e){alert('网络错误：'+e.message);});}
  function batchVis(vis){var ids=Object.keys(selected).filter(function(id){return selected[id];});if(!ids.length)return;var done=0;
    ids.forEach(function(id){fetch('/api/doc/'+encodeURIComponent(id)+'/visibility',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},userHeaders()),body:JSON.stringify({visibility:vis})}).then(function(){done++;if(done===ids.length){selected={};load();}}).catch(function(){});});}
  function batchDel(){var ids=Object.keys(selected).filter(function(id){return selected[id];});if(!ids.length)return;
    if(!confirm('确认删除选中的 '+ids.length+' 篇文档？不可恢复。'))return;
    var done=0;ids.forEach(function(id){fetch('/api/doc/'+encodeURIComponent(id),{method:'DELETE',headers:userHeaders()}).then(function(){done++;if(done===ids.length){selected={};load();}}).catch(function(){});});}
  function clearSelection(){selected={};updateBatchBar();load();}
  function bindBatch(){if(!batchBar)return;var be=document.getElementById('batchExport');if(be)be.addEventListener('click',batchExport);
    var bd=document.getElementById('batchDel');if(bd)bd.addEventListener('click',batchDel);
    var bc=document.getElementById('batchClear');if(bc)bc.addEventListener('click',clearSelection);
    var bv=document.getElementById('batchVis');if(bv)bv.addEventListener('click',function(){batchVis('public');});}
  var filterTag='';
  function render(arr){arr=arr||[];
    if(!window.currentUser){box.innerHTML='<div style="text-align:center;color:var(--mut);padding:40px 0">请先登录，才能查看和管理你的上传文档。</div>';if(usageCard)usageCard.style.display='none';if(privateSearchCard)privateSearchCard.style.display='none';return;}
    if(!arr.length){box.innerHTML='<div style="text-align:center;color:var(--mut);padding:40px 0">你还没有上传文档，去「上传」页传一个 .chm 吧。</div>';if(usageCard)usageCard.style.display='none';if(privateSearchCard)privateSearchCard.style.display='none';return;}
    if(filterTag)arr=arr.filter(function(d){return (d.tags||[]).indexOf(filterTag)!==-1;});
    touchPrivateSearch();
    var tagSet=[];
    arr.forEach(function(d){(d.tags||[]).forEach(function(t){if(tagSet.indexOf(t)===-1)tagSet.push(t);});});
    var filterHtml=tagSet.length?('<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px"><button class="btn ghost sm" data-tag="" style="'+(filterTag===''?'border-color:var(--acc);color:var(--acc)':'')+'">全部</button>'+
      tagSet.map(function(t){return '<button class="btn ghost sm" data-tag="'+escS2(t)+'" style="'+(filterTag===t?'border-color:var(--acc);color:var(--acc)':'')+'">#'+escS2(t)+'</button>';}).join('')+'</div>'):'';
    box.innerHTML=filterHtml + arr.map(function(d){
      var checked=(selected[d.id]?' checked':'');
      return '<div class="card row-card" style="flex-wrap:wrap"><label style="display:flex;align-items:flex-start;cursor:pointer;padding-right:4px"><input type="checkbox" class="row-check" data-id="'+escS2(d.id)+'"'+checked+'></label>'+
      '<span style="font-size:24px">📘</span>'+
      '<span style="flex:1;min-width:0"><b style="display:block">'+escS2(d.name||d.id)+'</b>'+
      (d.author?'<div style="font-size:13px;color:var(--mut)">作者：'+escS2(d.author)+'</div>':'')+
      '<span class="tag '+(d.visibility==='private'?'priv':'pub')+'">'+(d.visibility==='private'?'私密':'公开')+'</span>'+
      (d.tags||[]).map(function(t){return '<span class="tag" data-tag="'+escS2(t)+'" style="cursor:pointer">#'+escS2(t)+'</span>';}).join('')+
      '</span>'+
      '<a href="'+escS2(d.href||(d.visibility==='private'?'p/':'d/')+d.id+'/')+'" class="btn ghost sm">打开</a>'+
      '<span style="flex:100%;display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">'+
        '<button class="btn ghost sm" data-edit="'+escS2(d.id)+'" data-name="'+escS2(d.name||d.id)+'" data-author="'+escS2(d.author||'')+'" data-tags="'+escS2((d.tags||[]).join(','))+'">编辑信息</button>'+
        '<button class="btn ghost sm" data-vis="'+escS2(d.id)+'">'+(d.visibility==='private'?'设为公开':'设为私密')+'</button>'+
        '<button class="btn ghost sm" data-share="'+escS2(d.id)+'">管理分享链接</button>'+
        '<button class="btn danger sm" data-del="'+escS2(d.id)+'">删除</button></span></div>';}).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.row-check'),function(b){b.addEventListener('click',function(){if(b.checked)selected[b.getAttribute('data-id')]=true;else delete selected[b.getAttribute('data-id')];updateBatchBar();});});
    Array.prototype.forEach.call(box.querySelectorAll('[data-edit]'),function(b){b.addEventListener('click',function(){editMeta(b.getAttribute('data-edit'),b.getAttribute('data-name'),(b.getAttribute('data-tags')||'').split(',').filter(Boolean),b.getAttribute('data-author'));});});
    Array.prototype.forEach.call(box.querySelectorAll('[data-tag]'),function(b){b.addEventListener('click',function(){filterTag=b.getAttribute('data-tag');load();});});
    Array.prototype.forEach.call(box.querySelectorAll('[data-vis]'),function(b){b.addEventListener('click',function(){toggleVis(b.getAttribute('data-vis'),b);});});
    Array.prototype.forEach.call(box.querySelectorAll('[data-share]'),function(b){b.addEventListener('click',function(){manageShareFlow(b.getAttribute('data-share'));});});
    Array.prototype.forEach.call(box.querySelectorAll('[data-del]'),function(b){b.addEventListener('click',function(){del(b.getAttribute('data-del'));});});
  }
  function load(){render(mineOnly(window.__docs));
    fetch('/api/docs',{headers:userHeaders()}).then(function(r){return r.json();}).then(function(j){if(j&&j.docs){render(mineOnly(j.docs));touchPrivateSearch();}}).catch(function(){});}
  bindBatch();
  touchPrivateSearch();
  // ---- 修改密码（仅登录后可见）----
  var pwCard=document.getElementById('pwCard'),cpGo=document.getElementById('cpGo');
  function showPw(on){if(pwCard)pwCard.style.display=on?'':'none';}
  function changePw(){var o=document.getElementById('cpOld').value,n=document.getElementById('cpNew').value,c=document.getElementById('cpConfirm').value,er=document.getElementById('cpErr');
    if(!o||!n){er.style.color='';er.textContent='请填写当前密码和新密码';return;}
    if(n.length<6){er.style.color='';er.textContent='新密码至少 6 位';return;}
    if(n!==c){er.style.color='';er.textContent='两次输入的新密码不一致';return;}
    er.textContent='';if(cpGo)cpGo.disabled=true;
    fetch('/api/change-password',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},userHeaders()),body:JSON.stringify({oldPassword:o,newPassword:n})})
      .then(function(r){return r.json().then(function(j){return {st:r.status,j:j};});}).then(function(x){
        if(cpGo)cpGo.disabled=false;
        if(x.st===200&&x.j.ok){er.style.color='#16a34a';er.textContent='密码已更新 ✓';
          document.getElementById('cpOld').value='';document.getElementById('cpNew').value='';document.getElementById('cpConfirm').value='';}
        else{er.style.color='';er.textContent=(x.j&&x.j.error)||'修改失败';}})
      .catch(function(e){if(cpGo)cpGo.disabled=false;er.style.color='';er.textContent='网络错误：'+e.message;});}
  if(cpGo)cpGo.addEventListener('click',changePw);
  load();loadUsage();showPw(!!window.currentUser);
  window.__onAuth=function(){load();loadUsage();showPw(!!window.currentUser);touchPrivateSearch();};`, 'mine');

module.exports = { build, buildSiteIndex, WELCOME, BROWSE, UPLOAD, MINE, TERMS, PRIVACY, DISCLAIMER, REPORT, ADMIN, LANDING_HTML: WELCOME };

/**
 * 生成站点四个子页到 outDir（index/browse/upload/mine.html）+ 合规页（terms/privacy/disclaimer/report.html）。
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
  write('terms.html', TERMS);
  write('privacy.html', PRIVACY);
  write('disclaimer.html', DISCLAIMER);
  write('report.html', REPORT);
  write('admin.html', ADMIN);

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
    // 键用文档 id（slug）：上传文档 name ≠ id，搜索结果的链接须指向 d/<id>/；
    // dn 保留文档名供前端分组标题显示。
    keywords.push({ name: docName, href: d.href || ('d/' + (d.id) + '/'), doc: d.id, dn: docName });
    try {
      const kwFile = docRoot && fs.existsSync(path.join(docRoot, 'keywords.json'))
        ? JSON.parse(fs.readFileSync(path.join(docRoot, 'keywords.json'), 'utf8')) : null;
      (kwFile && kwFile.keywords || []).forEach((k) => {
        const rel = (k.href || '').replace(/\\/g, '/');
        keywords.push({ name: k.name, href: d.href + rel, doc: d.id, dn: docName });
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
          records.push({ doc: d.id, name: docName, text: txt });
        });
      }
    } catch (_) {}
  }
  return { keywords, records };
}
