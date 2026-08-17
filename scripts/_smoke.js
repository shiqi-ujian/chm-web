'use strict';
// 轻量级冒烟测试：验证 autosync.ps1 的 Invoke-Git 拆分参数后不再触发 "sh is not a git command"
const { spawnSync } = require('child_process');
const fs = require('fs');
const repo = process.cwd();

// 直接按脚本解析参数的方式跑 git，看能否正确执行 rev-list --count HEAD..HEAD (应该是 0)
const parts = 'rev-list --count HEAD..HEAD'.trim().split(/\s+/);
const r = spawnSync('git', ['-C', repo, '--no-pager', ...parts], { stdio: 'pipe', encoding: 'utf8' });
console.log('拆分传参 exit=' + r.status);
console.log('stdout=' + (r.stdout||'').trim());
console.log('stderr=' + (r.stderr||'').slice(0,120));
console.log(r.status === 0 ? 'PARSE_OK' : 'PARSE_FAIL');