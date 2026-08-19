// ============================================================
// 腾讯文档收集表读取桥
//   自动读取群友在腾讯文档收集表（链接发 QQ 群）提交的问题，
//   写入 问题收集/inbox/<id>.json，供 agent 定时处理。
//
// 提取方式：登录态下进入收集表「统计 → 人员名单 → 已填写 → 表格视图」，
//   读取官方表格视图的虚拟列表 DOM（表头 + 数据行），跨页面/接口变化更稳。
//
// 用法（在仓库根目录或任意目录运行均可）：
//   node 5z_build/feedback-bridge/collect-docs.mjs            单次读取
//   node 5z_build/feedback-bridge/collect-docs.mjs --probe    校准：dump 表格结构
//   node 5z_build/feedback-bridge/collect-docs.mjs --login    有头打开登录页（一次性登录）
//   node 5z_build/feedback-bridge/collect-docs.mjs --manual   导入 问题收集/manual/ 下的 CSV/XLSX
//   node 5z_build/feedback-bridge/collect-docs.mjs --serve    常驻轮询（watch-collect 调用）
//
// 前置：5z_build/feedback-bridge/config.json（由 config.example.json 复制并填写）。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { launchEdge, getPageTarget, connect, send, evalJs, waitFor, nav, sleep } from './cdp.mjs';
import { readXlsxRows } from './xlsx-util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BRIDGE = HERE;
const INBOX = path.join(ROOT, '问题收集', 'inbox');
const MANUAL = path.join(ROOT, '问题收集', 'manual');
const MANUAL_DONE = path.join(MANUAL, 'imported');
const ATTACH = path.join(ROOT, '问题收集', 'attachments');
const CONFIG_PATH = path.join(BRIDGE, 'config.json');
const STATE_PATH = path.join(BRIDGE, 'feedback-state.json');
const PROFILE = path.join(BRIDGE, 'docs-profile');
const profileOf = (config) => (config.profileDir ? (path.isAbsolute(config.profileDir) ? config.profileDir : path.resolve(BRIDGE, config.profileDir)) : PROFILE);
const ALERTS = path.join(ROOT, '问题收集', 'alerts.md');

for (const d of [INBOX, MANUAL, MANUAL_DONE, ATTACH]) fs.mkdirSync(d, { recursive: true });

const now = () => new Date();
const p2 = (n) => String(n).padStart(2, '0');
const iso = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}+08:00`;

/** 归一化时间："2026-08-16 21:58" / "2026-08-16T13:58:29Z" → ISO(+08:00) */
function normTs(s) {
  if (!s) return null;
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) {
    const [, Y, Mo, D, h, mi, se] = m;
    return `${Y}-${p2(Mo)}-${p2(D)}T${p2(h)}:${mi}:${se ? p2(se) : '00'}+08:00`;
  }
  m = /(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})/.exec(s);
  if (m) {
    const y = now().getFullYear();
    return `${y}-${p2(m[1])}-${p2(m[2])}T${p2(m[3])}:${m[4]}:00+08:00`;
  }
  return null;
}

// ---------- 配置 / 状态 ----------
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('[配置缺失] 请先复制 config.example.json 为 config.json 并填写 formResultUrl。');
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { lastSeenTs: null, seen: [], lastProbe: null }; }
}
function saveState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

function alert(msg) {
  const line = `- ${iso()} ${msg}`;
  fs.appendFileSync(ALERTS, line + '\n');
  console.error('[ALERT]', line);
}

// ---------- 工具 ----------
function hash(s) { return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12); }

function issueId(ts) {
  const m = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(ts || iso());
  const base = m ? `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6] || '00'}` : now().toISOString().replace(/\D/g, '').slice(0, 14);
  return `${base}-${hash(String(ts) + Math.random()).slice(0, 4)}`;
}

// ---------- 表格视图提取（官方 UI 流程） ----------
/** 进入「统计 → 人员名单 → 已填写」并切换「表格视图」，返回列定义 + 数据行（含滚动加载） */
async function extractTable(ws, config) {
  // 1) 进入已填写名单
  const entered = await evalJs(ws, `(() => {
    const el = Array.from(document.querySelectorAll('.category-child-name')).find(e =>
      /^已填写/.test((e.innerText || '').trim()) && e.offsetParent !== null
    );
    if (!el) return false;
    el.click(); return true;
  })()`);
  if (!entered) return { ok: false, reason: '未找到「已填写」名单入口（可能未登录或页面结构变化）', columns: [], rows: [] };
  await sleep(2000);

  // 2) 打开切换视图菜单
  await evalJs(ws, `(() => {
    const el = Array.from(document.querySelectorAll('*')).find(e =>
      (e.innerText || '').trim() === '切换视图' && e.children.length === 0 && e.offsetParent !== null
    );
    if (el) el.click();
    return true;
  })()`);
  await sleep(1000);

  // 3) 点击「表格视图」
  const switched = await evalJs(ws, `(() => {
    const els = Array.from(document.querySelectorAll('*')).filter(e =>
      (e.innerText || '').trim() === '表格视图' && e.offsetParent !== null
    );
    const el = els[els.length - 1];
    if (!el) return false;
    el.click(); return true;
  })()`);
  if (!switched) return { ok: false, reason: '未找到「表格视图」菜单项', columns: [], rows: [] };
  await sleep(3500);

  // 4) 读取表头列
  const columns = await evalJs(ws, `(() => {
    const cells = Array.from(document.querySelectorAll('.virtual-list-header .virtual-list-header-cell'));
    return cells.map(c => {
      const t = c.querySelector('.column-header-cell-title');
      return (t ? t.innerText : c.innerText || '').trim();
    }).filter(Boolean);
  })()`);
  if (!columns.length) return { ok: false, reason: '表格视图未渲染出表头', columns: [], rows: [] };

  // 5) 滚动收集数据行（虚拟列表：滚动到底加载更多，最多 40 轮）
  const rows = [];
  const seenKeys = new Set();
  const collect = () => evalJs(ws, `(() => {
    const out = [];
    const items = Array.from(document.querySelectorAll('.virtual-list-main-item.filled-table-item, .virtual-list-main .virtual-list-main-item'));
    for (const it of items) {
      const cells = Array.from(it.querySelectorAll('.virtual-list-cell')).map(c => (c.innerText || '').trim());
      const imgs = Array.from(it.querySelectorAll('.virtual-list-cell img')).map(i => i.src).filter(s => s && !s.startsWith('data:'));
      if (cells.length) out.push({ cells, imgs });
    }
    return out;
  })()`);
  const scroll = () => evalJs(ws, `(() => {
    const el = document.querySelector('.virtual-list-main') || document.querySelector('.virtual-list-container.filled-table-container');
    if (!el) return false;
    const before = el.scrollTop;
    el.scrollTop = el.scrollHeight + 2000;
    return el.scrollTop > before;
  })()`);

  for (let i = 0; i < 40; i++) {
    const batch = await collect();
    for (const r of batch) {
      const k = r.cells.join('\u0001');
      if (!seenKeys.has(k)) { seenKeys.add(k); rows.push(r); }
    }
    if (!(await scroll())) break;
    await sleep(600);
  }
  return { ok: true, columns, rows };
}

/** 列名 → 字段映射 */
function mapColumns(columns, config) {
  const labels = config.fieldMap || {};
  const map = { ts: null, reporter: null, page: null, title: null, description: null, expected: null, reproduce: null, attachments: null };
  const colByName = {};
  columns.forEach((c, i) => { colByName[c] = i; });
  const find = (...names) => {
    for (const n of names) if (colByName[n] !== undefined) return colByName[n];
    return null;
  };
  map.ts = find('提交时间', '填写时间');
  map.reporter = find('昵称', labels.reporter);
  map.page = find('页面/功能', labels.page);
  map.title = find('问题标题', labels.title);
  map.description = find('问题描述', labels.description);
  map.expected = find('期望行为', labels.expected);
  map.reproduce = find('复现步骤', labels.reproduce);
  map.attachments = find('截图', labels.attachments);
  return map;
}

// ---------- 导出 xlsx 模式（兜底） ----------
async function extractExport(ws, config) {
  const dlDir = path.join(BRIDGE, '_dl');
  fs.mkdirSync(dlDir, { recursive: true });
  await send(ws, 'Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  const clicked = await evalJs(ws, `(() => {
    const btns = Array.from(document.querySelectorAll('button,span,a,div'));
    const b = btns.find(el => {
      const t = (el.innerText || '').trim();
      return /^(导出|导出为|导出数据|下载)/.test(t) && t.length <= 8 && el.offsetParent !== null;
    });
    if (!b) return [];
    b.click(); return [true];
  })()`);
  if (!clicked.length) { console.warn('[export] 未找到导出按钮'); return []; }
  await sleep(4000);
  const files = fs.readdirSync(dlDir).filter((f) => /\.(xlsx|xls|csv)$/i.test(f));
  if (!files.length) { console.warn('[export] 导出目录为空'); return []; }
  const newest = files.map((f) => ({ f, t: fs.statSync(path.join(dlDir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
  const fp = path.join(dlDir, newest.f);
  let rows;
  if (/\.csv$/i.test(fp)) {
    rows = fs.readFileSync(fp, 'utf8').split(/\r?\n/).map((l) => l.split(',').map((c) => c.replace(/^"|"$/g, '')));
  } else {
    rows = readXlsxRows(fp);
  }
  const labels = config.fieldMap || {};
  const headerIdx = rows.findIndex((r) => Object.values(labels).some((l) => r.includes(l)));
  if (headerIdx < 0) { console.warn('[export] 未找到表头行'); return []; }
  const header = rows[headerIdx];
  const colForKey = {};
  for (const [key, label] of Object.entries(labels)) {
    const i = header.findIndex((h) => String(h).trim().includes(label));
    if (i >= 0) colForKey[key] = i;
  }
  const out = [];
  for (const r of rows.slice(headerIdx + 1)) {
    if (!r.length || r.every((c) => !String(c).trim())) continue;
    const fields = {};
    for (const [key, i] of Object.entries(colForKey)) fields[key] = String(r[i] ?? '').trim();
    const tsCell = r.find((c) => /20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/.test(String(c)));
    out.push({ ts: tsCell ? String(tsCell) : null, fields, imgs: [], raw: r.join(' | ').slice(0, 2000) });
  }
  try { fs.rmSync(fp, { force: true }); } catch { /* ignore */ }
  return out;
}

// ---------- 写入 inbox ----------
function isDuplicate(row, state) {
  const key = hash(row.ts + '|' + (row.fields.title || '') + '|' + (row.fields.description || ''));
  return state.seen.includes(key);
}

function writeInbox(row, state, config, source) {
  if (isDuplicate(row, state)) return false;
  const id = issueId(row.ts);
  const fields = row.fields || {};
  const issue = {
    id,
    source,
    ts: row.ts,
    reporter: fields.reporter || '',
    category: fields.category || '其他',
    page: fields.page || '',
    title: fields.title || (fields.description || '').slice(0, 40) || '（无标题）',
    description: fields.description || '',
    expected: fields.expected || '',
    reproduce: fields.reproduce || '',
    attachments: [],
    status: 'new',
    resolution: '',
    released: '',
    doneAt: null,
    raw: row.raw || '',
  };
  if (row.imgs && row.imgs.length) {
    const dir = path.join(ATTACH, id);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < row.imgs.length; i++) {
      const ext = /\.(png|jpe?g|gif|webp)(\?|$)/i.exec(row.imgs[i]);
      const name = `${i + 1}.${ext ? (ext[1].toLowerCase() === 'jpeg' ? 'jpg' : ext[1].toLowerCase()) : 'img'}`;
      try { fs.copyFileSync(new URL(row.imgs[i]), path.join(dir, name)); }
      catch { /* 跨域图抓不到就跳过 */ }
    }
    const saved = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
    issue.attachments = saved.map((f) => `attachments/${id}/${f}`);
  }
  fs.writeFileSync(path.join(INBOX, `${id}.json`), JSON.stringify(issue, null, 2));
  const key = hash(row.ts + '|' + (fields.title || '') + '|' + (fields.description || ''));
  state.seen.push(key);
  if (state.seen.length > 300) state.seen = state.seen.slice(-300);
  if (row.ts && (!state.lastSeenTs || row.ts > state.lastSeenTs)) state.lastSeenTs = row.ts;
  console.log('[new]', id, '←', (fields.title || '').slice(0, 40) || '(无标题)');
  return true;
}

// ---------- 校准探测 ----------
async function runProbe() {
  const config = loadConfig();
  const state = loadState();
  const edge = await launchEdge({ profileDir: profileOf(config) });
  let ws;
  try {
    const target = await getPageTarget(edge.port);
    ws = await connect(target.webSocketDebuggerUrl);
    await send(ws, 'Page.enable');
    await send(ws, 'Runtime.enable');
    await nav(ws, config.formResultUrl, `document.body && document.body.innerText.length > 200`, 45000);
    await sleep(1500);
    const wall = await evalJs(ws, `/登录后才能填写|请登录|扫码登录/.test(document.body.innerText)`);
    const res = await extractTable(ws, config);
    const probe = {
      at: iso(),
      loginWall: wall,
      ok: res.ok,
      reason: res.reason || '',
      columns: res.columns,
      sampleRows: res.rows.slice(0, 3).map((r) => r.cells),
      rowCount: res.rows.length,
    };
    state.lastProbe = probe;
    saveState(state);
    console.log(JSON.stringify(probe, null, 2));
    if (wall) console.log('\n[probe] 检测到登录墙：请运行 login-docs.bat 重新登录。');
  } finally {
    if (ws) { try { await send(ws, 'Browser.close'); } catch {} }
    await edge.close();
  }
}

async function runLogin() {
  const config = loadConfig();
  console.log('[login] 有头打开', config.loginUrl || 'https://docs.qq.com', '请登录并保持一段时间（登录态会存入 docs-profile）。完成后关闭浏览器窗口。');
  const edge = await launchEdge({ profileDir: profileOf(config), headless: false });
  const target = await getPageTarget(edge.port);
  const ws = await connect(target.webSocketDebuggerUrl);
  await send(ws, 'Page.enable');
  await nav(ws, config.loginUrl || 'https://docs.qq.com', `document.body && document.body.innerText.length > 50`, 60000);
  console.log('[login] 窗口已打开。登录完成后直接关闭浏览器即可（脚本等待窗口关闭）。');
  await new Promise((resolve) => {
    edge.proc.on('exit', resolve);
    edge.proc.on('error', resolve);
  });
}

function runManual() {
  const config = loadConfig();
  const state = loadState();
  const files = fs.readdirSync(MANUAL).filter((f) => /\.(csv|xlsx)$/i.test(f));
  if (!files.length) { console.log('[manual] 没有待导入文件。'); return; }
  let added = 0;
  for (const f of files) {
    const fp = path.join(MANUAL, f);
    let rows;
    try {
      if (/\.csv$/i.test(fp)) {
        rows = fs.readFileSync(fp, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(',').map((c) => c.replace(/^"|"$/g, '').trim()));
      } else {
        rows = readXlsxRows(fp);
      }
    } catch (e) { alert(`手动导入 ${f} 失败：${e.message.slice(0, 200)}`); continue; }
    const labels = config.fieldMap || {};
    const header = rows[0] || [];
    const colForKey = {};
    for (const [key, label] of Object.entries(labels)) {
      const i = header.findIndex((h) => String(h).trim().includes(label));
      if (i >= 0) colForKey[key] = i;
    }
    for (const r of rows.slice(1)) {
      if (!r.length || r.every((c) => !String(c).trim())) continue;
      const fields = {};
      for (const [key, i] of Object.entries(colForKey)) fields[key] = String(r[i] ?? '').trim();
      const tsCell = r.find((c) => /20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/.test(String(c)));
      const row = { ts: tsCell ? String(tsCell) : null, fields, imgs: [], raw: r.join(' | ').slice(0, 2000) };
      if (writeInbox(row, state, config, 'manual-csv')) added++;
    }
    try { fs.renameSync(fp, path.join(MANUAL_DONE, f)); } catch { /* ignore */ }
  }
  console.log(`[manual] 新增 ${added} 条`);
  saveState(state);
}

// ---------- 单次读取 ----------
async function runOnce() {
  const config = loadConfig();
  const state = loadState();
  if (!config.formResultUrl || !/^https?:\/\//.test(config.formResultUrl)) {
    console.error('[配置错误] config.json 中 formResultUrl 无效。');
    process.exit(2);
  }
  const edge = await launchEdge({ profileDir: profileOf(config) });
  let ws;
  try {
    const target = await getPageTarget(edge.port);
    ws = await connect(target.webSocketDebuggerUrl);
    await send(ws, 'Page.enable');
    await send(ws, 'Runtime.enable');
    console.log('[nav]', config.formResultUrl.slice(0, 80));
    await nav(ws, config.formResultUrl, `document.body && document.body.innerText.length > 200`, 45000);
    await sleep(1500);

    let added = 0;
    const mode = (config.extractMode || 'auto').toLowerCase();
    if (mode === 'export') {
      const rows = await extractExport(ws, config);
      for (const r of rows) if (writeInbox(r, state, config, 'tencent-docs-form')) added++;
    } else {
      const res = await extractTable(ws, config);
      if (res.ok) {
        const colMap = mapColumns(res.columns, config);
        for (const r of res.rows) {
          const fields = {
            reporter: colMap.reporter !== null ? r.cells[colMap.reporter] : '',
            page: colMap.page !== null ? r.cells[colMap.page] : '',
            title: colMap.title !== null ? r.cells[colMap.title] : '',
            description: colMap.description !== null ? r.cells[colMap.description] : '',
            expected: colMap.expected !== null ? r.cells[colMap.expected] : '',
            reproduce: colMap.reproduce !== null ? r.cells[colMap.reproduce] : '',
          };
          const row = {
            ts: colMap.ts !== null ? (normTs(r.cells[colMap.ts]) || iso()) : iso(),
            fields,
            imgs: r.imgs || [],
            raw: r.cells.join(' | ').slice(0, 2000),
          };
          if (writeInbox(row, state, config, 'tencent-docs-form')) added++;
        }
        if (res.rows.length === 0 && added === 0) {
          const wall = await evalJs(ws, `/登录后才能填写|请登录|扫码登录/.test(document.body.innerText)`);
          if (wall) alert('收集表显示需登录：请运行 login-docs.bat 重新登录。');
        }
      } else {
        // 表格视图失败 → 尝试导出兜底
        console.log('[auto]', res.reason, '→ 尝试导出兜底…');
        const rows = await extractExport(ws, config);
        for (const r of rows) if (writeInbox(r, state, config, 'tencent-docs-form')) added++;
        if (rows.length === 0) alert(`读取桥失败：${res.reason}`);
      }
    }
    console.log(`[done] 新增 ${added}`);
    saveState(state);
  } catch (e) {
    alert(`读取桥失败：${e.message.slice(0, 300)}`);
    throw e;
  } finally {
    if (ws) { try { await send(ws, 'Browser.close'); } catch {} }
    await edge.close();
  }
}

async function runServe() {
  const config = loadConfig();
  const interval = (config.pollIntervalSec || 1800) * 1000;
  console.log(`[serve] 每 ${interval / 1000}s 轮询一次。Ctrl+C 停止。`);
  let fails = 0;
  for (;;) {
    try { await runOnce(); fails = 0; }
    catch { if (++fails >= 3) { alert(`读取桥连续失败 ${fails} 次，请检查登录与页面结构（--probe）。`); fails = 0; } }
    await sleep(interval);
  }
}

// ---------- main ----------
const arg = process.argv[2] || 'once';
try {
  if (arg === '--login') await runLogin();
  else if (arg === '--probe') await runProbe();
  else if (arg === '--manual') runManual();
  else if (arg === '--serve') await runServe();
  else await runOnce();
} catch (e) {
  console.error('[FATAL]', e.message);
  process.exit(1);
}
