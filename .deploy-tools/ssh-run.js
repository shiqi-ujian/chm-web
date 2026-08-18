// SSH 助手：node ssh-run.js "<host>" "<user>" "<password>" "<command>" [timeoutSec]
// 执行单条命令并打印输出。也支持上传文件：node ssh-run.js host user pass "put:<local>:<remote>"
const { Client } = require('ssh2');

const [, , host, user, password, cmd, timeoutSec] = process.argv;
if (!host || !user || !password || !cmd) {
  console.error('usage: node ssh-run.js host user password "command" [timeoutSec]');
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
    const idx = rest.lastIndexOf(':');
    if (idx <= 0) return finish(2, 'put format: put:<local>:<remote>');
    const local = rest.slice(0, idx);
    const remote = rest.slice(idx + 1);
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

conn.connect({ host, port: 22, username: user, password, readyTimeout: 15000, keepaliveInterval: 10000 });
