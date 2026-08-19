// ============================================================
// Edge 无头 CDP 共享助手（复用项目已有模式，零依赖，Node >= 22）
// 供 collect-docs.mjs 等桥接脚本使用。
// ============================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

export function findEdge() {
  return EDGE_CANDIDATES.find((f) => fs.existsSync(f));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动 Edge（默认无头），返回 { proc, port, close() }。
 * profileDir 可空：空则用临时目录。固定端口可复用已有实例（如已有实例在跑则复用）。
 */
export async function launchEdge({ profileDir, port, headless = true, extraArgs = [] } = {}) {
  const EDGE = findEdge();
  if (!EDGE) throw new Error('未找到 Edge，请先安装 Microsoft Edge');
  const tmpProfile = profileDir
    ? null
    : fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'wz-cdp-'));
  const userDataDir = profileDir || tmpProfile;
  const PORT = port || 9300 + Math.floor(Math.random() * 400);
  const args = [
    ...(headless ? ['--headless=new'] : []),
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--disable-gpu', '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1440,900',
    'about:blank',
    ...extraArgs,
  ];
  const proc = spawn(EDGE, args, { stdio: 'ignore' });
  proc.on('error', (e) => { throw e; });
  return {
    proc,
    port: PORT,
    profileDir: userDataDir,
    async close() {
      try { proc.kill(); } catch { /* already dead */ }
      // 等待进程退出，避免 profile 锁残留
      for (let i = 0; i < 50; i++) {
        try { process.kill(proc.pid, 0); await sleep(100); } catch { break; }
      }
      if (tmpProfile) { try { fs.rmSync(tmpProfile, { recursive: true, force: true }); } catch { /* ignore */ } }
    },
  };
}

/** 等待 CDP 就绪并返回第一个 page target */
export async function getPageTarget(port, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* not ready */ }
    await sleep(200);
  }
  throw new Error('CDP not ready');
}

let msgId = 0;
const pending = new Map();

export function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('ws error'));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      }
    };
  });
}

export function send(ws, method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/** 在页面上下文执行 JS 并返回值 */
export async function evalJs(ws, expr) {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
  }
  return r.result ? r.result.value : undefined;
}

export async function waitFor(ws, expr, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (await evalJs(ws, expr)) return; } catch { /* navigating */ }
    await sleep(250);
  }
  throw new Error('waitFor 超时: ' + expr);
}

export async function nav(ws, url, waitExpr, timeoutMs = 30000) {
  await send(ws, 'Page.navigate', { url });
  await waitFor(ws, waitExpr, timeoutMs);
  await sleep(500);
}

export async function shot(ws, filePath) {
  const r = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(filePath, Buffer.from(r.data, 'base64'));
  console.log('[shot]', filePath);
}

/** 下载文件（配合 Page.setDownloadBehavior） */
export async function setupDownloads(ws, dir) {
  fs.mkdirSync(dir, { recursive: true });
  await send(ws, 'Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: dir,
  });
}
