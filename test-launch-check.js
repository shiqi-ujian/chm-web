'use strict';
// test-launch-check.js — 自检脚本冒烟测试：
//   用一组"生产就绪"的环境变量运行 scripts/launch-check.js，必须 PASS 退出 0。
//   同时验证脚本不打印任何 token 明文。
const { spawn } = require('child_process');
const path = require('path');

const root = __dirname;
const env = {
  ...process.env,
  PUBLIC_BASE_URL: 'https://example.com',
  UPLOAD_TOKEN: 'upload-secret-test',
  EXPORT_TOKEN: 'export-secret-test',
  ADMIN_TOKEN: 'admin-secret-test',
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'user',
  SMTP_PASS: 'pass',
  SMTP_FROM: 'no-reply@example.com',
  LAUNCH_CHECK_SKIP_QUOTA: '1',
  LAUNCH_CHECK_SKIP_BACKUP: '1',
  // 指向仓库内目录，保证 CI/本地都能找到
  CHM_SITE: path.join(root, 'docs'),
  CHM_DATA: path.join(root, 'data'),
};

const child = spawn(process.execPath, [path.join(root, 'scripts', 'launch-check.js')], { cwd: root, env, stdio: 'pipe' });
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));
child.on('close', (code) => {
  const okExit = code === 0;
  const noSecret = out.indexOf('upload-secret-test') === -1 && out.indexOf('export-secret-test') === -1 && out.indexOf('admin-secret-test') === -1;
  console.log((okExit ? 'OK  ' : 'FAIL') + ' launch-check exits 0 with ready env  [' + code + ']');
  console.log((noSecret ? 'OK  ' : 'FAIL') + ' launch-check does not print tokens');
  if (!okExit || !noSecret) {
    console.error(out);
    process.exit(1);
  }
  console.log('LAUNCH_CHECK_TEST_PASS');
  process.exit(0);
});