'use strict';
// storage-report.js — 运维辅助：统计 chm-web 数据目录与站点目录的磁盘用量、
// 数据库规模、最近备份，并提示是否超过阈值。只读，不写任何状态。
//
// 用法:
//   env CHM_SITE=/var/chm-web/data/site CHM_DATA=/var/chm-web/data/data \
//     node .deploy-tools/storage-report.js
//   REPORT_JSON=1 node .deploy-tools/storage-report.js   # 输出 JSON 方便告警脚本解析
//   ALERT_GLOBAL_BYTES=5242880000 node .deploy-tools/storage-report.js
//
// 返回码: 0=正常; 1=存储/数据库/备份触发警告（供 cron 告警/运维脚本使用）
const fs = require('fs');
const path = require('path');

const SITE = path.resolve(process.env.CHM_SITE_DIR || process.env.CHM_SITE || process.cwd());
const DATA = path.resolve(process.env.CHM_DATA_DIR || process.env.CHM_DATA || path.join(SITE, '..', 'data'));
const BACKUP_DIR = process.env.CHM_BACKUP_DIR ? path.resolve(process.env.CHM_BACKUP_DIR) : null;
const REPORT_JSON = process.env.REPORT_JSON === '1';

// 默认阈值：站点 5GB / 数据 5GB / 总 9GB（可覆盖）
const ALERT_SITE = Number(process.env.ALERT_SITE_BYTES || 5 * 1024 * 1024 * 1024);
const ALERT_DATA = Number(process.env.ALERT_DATA_BYTES || 5 * 1024 * 1024 * 1024);
const ALERT_TOTAL = Number(process.env.ALERT_TOTAL_BYTES || 9 * 1024 * 1024 * 1024);
const ALERT_DB = Number(process.env.ALERT_DB_BYTES || 1 * 1024 * 1024 * 1024);
const ALERT_BACKUP_HOURS = Number(process.env.ALERT_BACKUP_HOURS || 36);

function formatBytes(b) {
  b = Number(b) || 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (Math.abs(b) >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return (i === 0 ? String(Math.round(b)) : b.toFixed(1)) + ' ' + units[i];
}

function dirSize(dir) {
  let sum = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) sum += dirSize(full);
      else if (e.isFile()) {
        try { sum += fs.statSync(full).size; } catch (_) {}
      }
    }
  } catch (_) {}
  return sum;
}

function newestBackup() {
  if (!BACKUP_DIR || !fs.existsSync(BACKUP_DIR)) return { found: false, file: null, ageHours: null };
  let best = null;
  try {
    for (const name of fs.readdirSync(BACKUP_DIR)) {
      if (!/^chm-web-.*\.tar\.gz$/.test(name)) continue;
      const p = path.join(BACKUP_DIR, name);
      let st = null;
      try { st = fs.statSync(p); } catch (_) { continue; }
      if (!best || st.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs };
    }
  } catch (_) {}
  if (!best) return { found: false, file: null, ageHours: null };
  return {
    found: true,
    file: best.path,
    ageHours: (Date.now() - best.mtimeMs) / 3600000,
  };
}

const stats = {
  checkedAt: new Date().toISOString(),
  site: { dir: SITE, exists: fs.existsSync(SITE), bytes: 0 },
  data: { dir: DATA, exists: fs.existsSync(DATA), bytes: 0 },
  db: { file: null, bytes: 0, walBytes: 0 },
  backup: { found: false, file: null, ageHours: null },
  totalBytes: 0,
  thresholds: {
    siteBytes: ALERT_SITE,
    dataBytes: ALERT_DATA,
    totalBytes: ALERT_TOTAL,
    dbBytes: ALERT_DB,
    backupHours: ALERT_BACKUP_HOURS,
  },
  alerts: [],
};

if (stats.site.exists) {
  try { stats.site.bytes = dirSize(SITE); } catch (_) {}
}
if (stats.data.exists) {
  try { stats.data.bytes = dirSize(DATA); } catch (_) {}
}
const dbFile = path.join(DATA, 'app.db');
if (fs.existsSync(dbFile)) {
  try {
    stats.db.file = dbFile;
    stats.db.bytes = fs.statSync(dbFile).size;
    const wal = dbFile + '-wal';
    if (fs.existsSync(wal)) stats.db.walBytes = fs.statSync(wal).size;
  } catch (_) {}
}
const backup = newestBackup();
if (backup.found) {
  stats.backup.found = true;
  stats.backup.file = backup.file;
  stats.backup.ageHours = Math.round(backup.ageHours * 10) / 10;
}

const total = stats.site.bytes + stats.data.bytes;
stats.totalBytes = total;
if (stats.site.bytes > ALERT_SITE) stats.alerts.push(`站点目录超阈值: ${formatBytes(stats.site.bytes)} > ${formatBytes(ALERT_SITE)}`);
if (stats.data.bytes > ALERT_DATA) stats.alerts.push(`数据目录超阈值: ${formatBytes(stats.data.bytes)} > ${formatBytes(ALERT_DATA)}`);
if (total > ALERT_TOTAL) stats.alerts.push(`站点+数据总量超阈值: ${formatBytes(total)} > ${formatBytes(ALERT_TOTAL)}`);
if (stats.db.bytes > ALERT_DB) stats.alerts.push(`SQLite app.db 偏大: ${formatBytes(stats.db.bytes)} > ${formatBytes(ALERT_DB)}`);
if (!stats.backup.found) {
  stats.alerts.push('未发现最近备份（chm-web-*.tar.gz）');
} else if (stats.backup.ageHours > ALERT_BACKUP_HOURS) {
  stats.alerts.push(`最近备份已 ${stats.backup.ageHours}h，超过 ${ALERT_BACKUP_HOURS}h 阈值`);
}

stats.alerts = stats.alerts.slice(0, 20);

if (REPORT_JSON) {
  console.log(JSON.stringify(stats, null, 2));
} else {
  console.log('chm-web 存储自检');
  console.log('  站点目录      : ' + (stats.site.exists ? SITE + '  ' + formatBytes(stats.site.bytes) : SITE + '（不存在）'));
  console.log('  数据目录      : ' + (stats.data.exists ? DATA + '  ' + formatBytes(stats.data.bytes) : DATA + '（不存在）'));
  console.log('  站点+数据总计 : ' + formatBytes(total));
  if (stats.db.file) console.log('  SQLite         : ' + stats.db.file + '  ' + formatBytes(stats.db.bytes) + (stats.db.walBytes ? '（WAL ' + formatBytes(stats.db.walBytes) + '）' : ''));
  if (stats.backup.found) console.log('  最近备份       : ' + stats.backup.file + '  ' + stats.backup.ageHours + 'h 前');
  else console.log('  最近备份       : 未发现');
  if (stats.alerts.length) {
    console.log('\n[ALERT] ' + stats.alerts.join('\n[ALERT] '));
  } else {
    console.log('\nOK，无告警');
  }
}

process.exit(stats.alerts.length ? 1 : 0);