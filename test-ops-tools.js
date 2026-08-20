'use strict';
// test-ops-tools.js — .deploy-tools 运维脚本自测：
//   ① storage-report.js 只读统计：可识别站点/数据/DB，无最近备份时告警退出 1，
//     有最近备份时正常退出 0，JSON 输出可解析。
//   ② backup-snapshot.js 能生成一致 SQLite 快照，且备份库内容与源库一致。
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = __dirname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chmweb-ops-test-'));
const site = path.join(tmp, 'site');
const data = path.join(tmp, 'data');
const backup = path.join(tmp, 'backup');
fs.mkdirSync(site, { recursive: true });
fs.mkdirSync(data, { recursive: true });
fs.mkdirSync(backup, { recursive: true });
fs.writeFileSync(path.join(site, 'index.html'), 'hello');
fs.writeFileSync(path.join(data, 'app.db'), 'not-a-real-db');

let pass = true;
const ok = (n, c, x) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (x ? ' [' + x + ']' : '')); if (!c) pass = false; };

function run(file, args = [], env = {}) {
  return spawnSync(process.execPath, [path.join(root, file), ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 30000,
  });
}

// ---- 1) storage-report：无备份 → 告警退出 1 ----
const noBk = run('.deploy-tools/storage-report.js', [], {
  CHM_SITE_DIR: site,
  CHM_DATA_DIR: data,
  CHM_BACKUP_DIR: path.join(tmp, 'no-such-backup'),
  REPORT_JSON: '1',
});
ok('storage-report exits 1 when backup missing', noBk.status === 1, 'status=' + noBk.status);
let noBkJson = null;
try { noBkJson = JSON.parse(noBk.stdout); } catch (_) {}
ok('storage-report JSON parseable', !!noBkJson && noBkJson.site.bytes >= 0, '');
ok('storage-report alert mentions backup', Array.isArray(noBkJson && noBkJson.alerts) && noBkJson.alerts.some((a) => a.indexOf('备份') !== -1), '');

// ---- 2) storage-report：有备份 → 正常退出 0 ----
fs.writeFileSync(path.join(backup, 'chm-web-20260820-000000.tar.gz'), 'fake');
const withBk = run('.deploy-tools/storage-report.js', [], {
  CHM_SITE_DIR: site,
  CHM_DATA_DIR: data,
  CHM_BACKUP_DIR: backup,
  REPORT_JSON: '1',
});
ok('storage-report ok when recent backup exists', withBk.status === 0, 'status=' + withBk.status);
let withBkJson = null;
try { withBkJson = JSON.parse(withBk.stdout); } catch (_) {}
ok('storage-report backup found', !!withBkJson && withBkJson.backup.found === true, '');

// ---- 3) backup-snapshot：真实 SQLite 快照一致性 ----
const dbFile = path.join(data, 'real.db');
const snap = path.join(tmp, 'snap.db');
{
  const Database = require('better-sqlite3');
  const d = new Database(dbFile);
  d.exec('CREATE TABLE t(x); INSERT INTO t VALUES (1),(2)');
  d.close();
}
const snapRes = run('.deploy-tools/backup-snapshot.js', [dbFile, snap]);
ok('backup-snapshot exits 0', snapRes.status === 0, 'status=' + snapRes.status);
const Database = require('better-sqlite3');
try {
  const chk = new Database(snap, { readonly: true });
  const c = chk.prepare('SELECT COUNT(*) AS c FROM t').get().c;
  chk.close();
  ok('snapshot contains copied rows', c === 2, 'count=' + c);
} catch (e) {
  ok('snapshot is a readable sqlite db', false, e.message);
}

// ---- 4) alert.sh 存在且可执行？只验证文件存在/基本 shell 结构（真正 cron 由服务器装配）----
ok('alert.sh exists', fs.existsSync(path.join(root, '.deploy-tools', 'alert.sh')));
ok('install-cron.sh exists', fs.existsSync(path.join(root, '.deploy-tools', 'install-cron.sh')));

console.log(pass ? 'OPS_TOOLS_TEST_PASS' : 'OPS_TOOLS_TEST_FAIL');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
process.exit(pass ? 0 : 1);