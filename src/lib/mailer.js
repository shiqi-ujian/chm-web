'use strict';
// emailer.js — 邮件发送器（验证邮箱 / 找回密码）。
// 生产模式：配置 SMTP_* 环境变量后使用内置极简 SMTP 客户端发送（无新增依赖）。
// 本地/未配置模式：把内容写入 logs/mailer.log 并打印到控制台，方便开发与测试。
const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');

function getConfig() {
  return {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@example.com',
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
  };
}

function logDev(to, subject, text) {
  try {
    const dir = path.join(__dirname, '..', '..', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'mailer.log'),
      `\n[${new Date().toISOString()}] TO=${to}\nSUBJECT=${subject}\n${text}\n`);
  } catch (_) {}
  console.log('[mailer][dev] to=' + to + ' subject=' + subject + '\n' + text);
}

/** 简易 SMTP 客户端：EHLO → STARTTLS（可选）→ AUTH LOGIN → MAIL/RCPT/DATA。 */
function smtpSend({ to, subject, text }) {
  return new Promise((resolve, reject) => {
    const cfg = getConfig();
    let sock = null;
    let buf = '';
    let queue = [];
    let upgraded = false;
    const timeout = setTimeout(() => cleanup(new Error('SMTP timeout')), 20000);

    function cleanup(err) {
      clearTimeout(timeout);
      if (sock) { try { sock.destroy(); } catch (_) {} }
      if (err) reject(err); else resolve();
    }
    function onLine(line) {
      const code = parseInt(line.slice(0, 3), 10);
      if (code >= 400) { cleanup(new Error('SMTP error: ' + line)); return; }
      const fn = queue.shift();
      if (fn) { try { fn(line); } catch (e) { cleanup(e); } }
    }
    function onData(chunk) {
      buf += chunk.toString('latin1');
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        // 只处理最终行（非 3xx- 续行）
        if (!/^\d{3}-/.test(line)) onLine(line);
      }
    }
    function cmd(line, expectComplete = true) {
      return new Promise((res, rej) => {
        queue.push(() => res());
        sock.write(line + '\r\n');
      });
    }

    const connect = () => {
      if (cfg.secure && !upgraded) {
        sock = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }, onConnect);
      } else {
        sock = net.connect(cfg.port, cfg.host, onConnect);
      }
      sock.on('error', (e) => cleanup(e));
      sock.on('data', onData);
    };
    let started = false;
    function onConnect() {
      if (started) return;
      started = true;
      // greeting will be first line, after that begin EHLO
      queue.push(async () => {
        await send('EHLO localhost');
        if (!cfg.secure && !upgraded) {
          await send('STARTTLS');
          upgraded = true;
          started = false;
          const old = sock;
          old.removeAllListeners('data');
          sock = null;
          sock = tls.connect({ socket: old, servername: cfg.host }, onConnect);
          sock.on('data', onData);
          sock.on('error', (e) => cleanup(e));
        } else {
          await send('AUTH LOGIN');
          await send(Buffer.from(cfg.user || '').toString('base64'));
          await send(Buffer.from(cfg.pass || '').toString('base64'));
          await send('MAIL FROM:<' + cfg.from + '>');
          await send('RCPT TO:<' + to + '>');
          await send('DATA');
          const body = 'Subject: ' + subject + '\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n' + text;
          await send(body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..').replace(/\r\n\.\r\n$/, '\r\n.\r\n'));
          await send('.');
          await send('QUIT');
        }
      });
    }

    connect();
  });
}

/**
 * 发送邮件。
 * @param {object} o {to, subject, text, html?}
 * @returns {Promise<{mode:string}>}
 */
async function sendMail({ to, subject, text }) {
  const cfg = getConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) {
    logDev(to, subject, text || '');
    return { mode: 'dev' };
  }
  try {
    await smtpSend({ to, subject, text: text || '' });
    return { mode: 'smtp' };
  } catch (e) {
    // 任何 SMTP 失败都回退到 dev log，保证开发体验；生产应观察 logs/mailer.log
    logDev(to, subject, '[SMTP failed: ' + (e && e.message) + ']\n' + (text || ''));
    return { mode: 'dev-fallback', error: e.message };
  }
}

module.exports = { sendMail, getConfig };