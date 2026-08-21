'use strict';
// launch-check.js — 上线/运维前自检脚本。
// 在服务器上运行:  node scripts/launch-check.js
// 本脚本只读取环境变量 / 文件系统，不写任何状态、不打印 token 明文。
// 适合白天写好，晚上回家在服务器上跑一遍验收配置。
const fs = require('fs');
const path = require('path');

const SITE_ROOT = path.resolve(process.env.CHM_SITE || path.join(__dirname, '..', 'docs'));
const DATA = path.resolve(process.env.CHM_DATA || path.join(__dirname, '..', 'data'));
const results = [];
const passes = { pass: 0, warn: 0, fail: 0 };

function check(name, ok, detail, level) {
  const st = ok ? 'PASS' : (level === 'warn' ? 'WARN' : 'FAIL');
  results.push({ st, name, detail: detail || '' });
  passes[st.toLowerCase()] = (passes[st.toLowerCase()] || 0) + 1;
  console.log(`[${st}] ${name}${detail ? '  — ' + detail : ''}`);
}

// ---- 环境变量检查 ----
const boolEnv = (v) => String(v || '').trim();
check('PUBLIC_BASE_URL 已设置', !!boolEnv(process.env.PUBLIC_BASE_URL), process.env.PUBLIC_BASE_URL || '未设置');
if (boolEnv(process.env.PUBLIC_BASE_URL)) {
  check('PUBLIC_BASE_URL 是 https://', /^https:\/\//.test(process.env.PUBLIC_BASE_URL), process.env.PUBLIC_BASE_URL);
}

check('UPLOAD_TOKEN 已配置（生产建议）', !!boolEnv(process.env.UPLOAD_TOKEN), boolEnv(process.env.UPLOAD_TOKEN) ? '已设置' : '未设置');
check('EXPORT_TOKEN 已配置（生产建议）', !!boolEnv(process.env.EXPORT_TOKEN), boolEnv(process.env.EXPORT_TOKEN) ? '已设置' : '未设置');
check('ADMIN_TOKEN 已配置（生产建议）', !!boolEnv(process.env.ADMIN_TOKEN), boolEnv(process.env.ADMIN_TOKEN) ? '已设置' : '未设置');

// SMTP 配置检查：生产要能发验证/重置邮件
const smtpHost = boolEnv(process.env.SMTP_HOST);
const smtpUser = boolEnv(process.env.SMTP_USER);
const smtpPass = boolEnv(process.env.SMTP_PASS);
const smtpFrom = boolEnv(process.env.SMTP_FROM);
const smtpConfigured = smtpHost && smtpUser && smtpPass && smtpFrom;
// 生产建议不设 NO_CAPTCHA（人机校验开启）；本地/测试可设 NO_CAPTCHA=1 跳过算术题。
check('人机校验未全局关闭（NO_CAPTCHA 不设为 1）', process.env.NO_CAPTCHA !== '1', process.env.NO_CAPTCHA === '1' ? 'NO_CAPTCHA=1' : 'OK');
check('SMTP 四件套已配置', smtpConfigured || !!boolEnv(process.env.ALLOW_LEGACY_REGISTER),
  smtpConfigured ? 'SMTP_HOST/USER/PASS/FROM 已设置' : (boolEnv(process.env.ALLOW_LEGACY_REGISTER) ? 'ALLOW_LEGACY_REGISTER=1（开发模式，未走真实邮件）' : '缺少 SMTP_*'));

// 配额/限流
const quotas = ['MAX_GLOBAL_BYTES', 'MAX_USER_DOCS', 'MAX_USER_BYTES', 'RATE_AUTH_MAX', 'RATE_UPLOAD_MAX', 'RATE_EXPORT_MAX', 'RATE_SEARCH_MAX'];
const quotaSet = quotas.filter((v) => boolEnv(process.env[v])).length;
check('配额/限流环境变量（建议设置）', !!boolEnv(process.env.LAUNCH_CHECK_SKIP_QUOTA) || quotaSet > 0, quotaSet ? `${quotaSet}/${quotas.length} 项已设置` : (boolEnv(process.env.LAUNCH_CHECK_SKIP_QUOTA) ? '跳过（本地/测试）' : '全部未设置'));
check('生产未关闭 CSRF（NO_CSRF 不设为 1）', process.env.NO_CSRF !== '1', process.env.NO_CSRF === '1' ? 'NO_CSRF=1' : 'OK');

// ---- 目录 / 文件 ----
check('站点目录存在', fs.existsSync(SITE_ROOT), SITE_ROOT);
check('数据目录存在', fs.existsSync(DATA), DATA);
if (fs.existsSync(SITE_ROOT) && fs.existsSync(path.join(SITE_ROOT, 'index.html'))) {
  check('欢迎页 index.html 存在', true, path.join(SITE_ROOT, 'index.html'));
} else {
  check('欢迎页 index.html 存在', false, path.join(SITE_ROOT, 'index.html'));
}

// 数据库文件
const dbFile = path.join(DATA, 'app.db');
check('SQLite app.db 存在', fs.existsSync(dbFile), dbFile);

// 私有文档目录
check('私有数据目录 private/ 存在', fs.existsSync(path.join(DATA, 'private')), path.join(DATA, 'private'));

// 备份目录/最近备份（可用 CHM_BACKUP_DIR 覆盖；本地/测试可设 LAUNCH_CHECK_SKIP_BACKUP=1）
const backupDirs = [
  process.env.CHM_BACKUP_DIR ? path.resolve(process.env.CHM_BACKUP_DIR) : null,
  '/var/backups/chm-web', '/var/chm-web/backups', path.join(DATA, '..', 'backups'),
].filter(Boolean);
let backupAgeHours = 0;
let backupInfo = '';
let backupDirOk = false;
let backupOriginDir = '';
for (const dir of backupDirs) {
  if (!fs.existsSync(dir)) continue;
  let newest = null;
  try {
    newest = fs.readdirSync(dir).filter((f) => /chm-web-.*\.tar\.gz$/.test(f)).map((f) => path.join(dir, f)).sort((a, b) => {
      try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; }
    })[0] || null;
  } catch (_) {}
  if (newest) {
    try {
      const age = Date.now() - fs.statSync(newest).mtimeMs;
      backupAgeHours = Math.round(age / 3600000);
      backupInfo = `${path.basename(newest)} (${backupAgeHours}h 前)`;
      backupDir = dir;
      backupDirOk = backupAgeHours < 36;
      break;
    } catch (_) {}
  }
}
if (boolEnv(process.env.LAUNCH_CHECK_SKIP_BACKUP)) {
  check('最近备份存在', true, '跳过（本地/测试）');
} else if (backupInfo) {
  check('最近备份存在', backupDirOk, `${backupInfo}`);
} else {
  check('最近备份存在', false, '未发现 chm-web-*.tar.gz 备份（请检查 cron/backup.sh）');
}

// 粗略可写性：不写文件，只检查目录权限位（unix 可写由 owner 决定；Windows 下视为可写）
function writableDir(dir) {
  if (!fs.existsSync(dir)) return false;
  try {
    const f = path.join(dir, '.launch-check');
    fs.writeFileSync(f, '');
    fs.unlinkSync(f);
    return true;
  } catch (_) { return false; }
}
check('站点目录可写', writableDir(SITE_ROOT), '');
check('数据目录可写', writableDir(DATA), '');

// ---- 汇总 ----
console.log('\n===== 汇总 =====');
console.log(`PASS ${passes.pass || 0}  WARN ${passes.warn || 0}  FAIL ${passes.fail || 0}`);
process.exit((passes.fail || 0) > 0 ? 1 : 0);