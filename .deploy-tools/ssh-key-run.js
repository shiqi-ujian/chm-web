// SSH 助手（密钥版）：node ssh-key-run.js "<command>" [timeoutSec]
// 使用 pc-1.pem 直连阿里云 47.122.108.216，执行单条命令并打印输出。
// 支持上传：node ssh-key-run.js "put:<local>:<remote>"
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const HOST = '47.122.108.216';
const USER = 'root';
const KEY = path.join(__dirname, '..', 'pc-1.pem');

const [, , cmd, timeoutSec] = process.argv;
if (!cmd) {
  console.error('usage: node ssh-key-run.js "<command>" [timeoutSec]');
  process.exit(2);
}

const timeout = (parseInt(timeoutSec, 10) || 60) * 1000;

const conn = new Client();
let settled = false;
const finish = (code, msg) => {
  if (settled) return;
  settled = true;
  if (msg) console.error(msg);
  conn.end();
  process.exit(code);
};
setTimeout(() => finish(124, 'TIMEOUT'), timeout + 5000);

conn.on('ready', () => {
  if (cmd.startsWith('put:')) {
    const rest = cmd.slice(4);
    // Windows 本地路径含盘符冒号，不能 lastIndexOf(':')；远端路径以 '/' 开头，
    // 用 ':/' 定位分隔点最稳（本地路径里不会出现 ':/'）。
    const marker = rest.indexOf(':/');
    if (marker <= 0) return finish(2, 'put format: put:<local>:<remote>');
    const local = rest.slice(0, marker);
    const remote = rest.slice(marker + 1);
    conn.sftp((err, sftp) => {
      if (err) return finish(1, 'sftp error: ' + err.message);
      sftp.fastPut(local, remote, (e) => {
        if (e) return finish(1, 'put error: ' + e.message);
        finish(0, '');
      });
    });
  } else {
    conn.exec(cmd, (err, stream) => {
      if (err) return finish(1, 'exec error: ' + err.message);
      let out = '';
      stream.on('close', (code) => { if (out) process.stdout.write(out); finish(code || 0, ''); });
      stream.on('data', (d) => { out += d.toString(); });
      stream.stderr.on('data', (d) => { out += d.toString(); });
    });
  }
});

conn.on('error', (e) => finish(1, 'ssh error: ' + e.message));

conn.connect({
  host: HOST,
  port: 22,
  username: USER,
  privateKey: fs.readFileSync(KEY),
  readyTimeout: 15000,
  keepaliveInterval: 10000,
});
