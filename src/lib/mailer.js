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
      if (process.env.SMTP_DEBUG) console.log('[smtp] <<', line);
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
    const send = (line) => {
      if (process.env.SMTP_DEBUG) console.log('[smtp] >>', String(line).slice(0, 80));
      return cmd(line);
    };

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
        try {
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
            // 完整 RFC5322 头：QQ 等严格服务商会校验 From/Date/Message-ID（缺 From 直接 550）
            const encSubject = '=?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=';
            const msgId = '<' + Date.now() + '.' + Math.random().toString(16).slice(2) + '@' + (cfg.host || 'localhost') + '>';
            // 发件显示名（SMTP_FROM_NAME，RFC2047 编码）：收件人看到「CHM 网页 <addr>」而非裸地址
            const fromName = process.env.SMTP_FROM_NAME || '';
            const fromHdr = fromName
              ? 'From: =?UTF-8?B?' + Buffer.from(fromName).toString('base64') + '?= <' + cfg.from + '>\r\n'
              : 'From: <' + cfg.from + '>\r\n';
            const body = fromHdr
              + 'To: <' + to + '>\r\n'
              + 'Subject: ' + encSubject + '\r\n'
              + 'Date: ' + new Date().toUTCString() + '\r\n'
              + 'Message-ID: ' + msgId + '\r\n'
              + 'MIME-Version: 1.0\r\n'
              + 'Content-Type: text/plain; charset=utf-8\r\n'
              + 'Content-Transfer-Encoding: 8bit\r\n'
              + '\r\n'
              + text;
            // DATA 正文：CRLF 归一化 + SMTP 行首点填充 + 尾部结束标记点。
            // 不能写成 body + '\r\n.\r\n' 再让下一行 send('.')——那样点终止符不在正确行位。
            await send(body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..') + '\r\n.');
            await send('QUIT');
          }
          // 成功完成：解析 Promise（不清除已建立的连接由 cleanup 处理）。
          // 修复：原实现成功后无人 resolve，只能等 20s 超时报错——邮件其实已发出。
          cleanup();
        } catch (e) {
          cleanup(e);
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