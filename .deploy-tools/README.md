# chm-web 运维资产（.deploy-tools）

服务器侧常用命令速查。所有写服务器凭证/部署令牌都只在服务器环境变量 / systemd
EnvironmentFile 或本机 gitignore 文件中，**不要提交进仓库**。

## 一键部署 / 常用命令

```bash
cd /root/app
bash .deploy-tools/deploy.sh status      # 容器状态
bash .deploy-tools/deploy.sh logs        # 实时日志
bash .deploy-tools/deploy.sh restart     # 重启容器
```

## 健康检查与自检

```bash
node scripts/launch-check.js             # 上线前/日常配置自检（只读，不打印 token）
bash .deploy-tools/watchdog.sh check     # 健康探活 + 自动重启 + 连续失败告警
bash .deploy-tools/watchdog.sh install   # 每 5 分钟 cron
```

- 告警：设置 `ALERT_WEBHOOK_URL`（Server酱 / 钉钉 / 企业微信机器人）后，
  连续 `WATCH_MAX_FAIL` 次失败会 POST JSON 提醒。

## 备份

```bash
# 手动全量备份（默认写到 /var/backups/chm-web，保留 14 份）
bash .deploy-tools/backup.sh

# 自定义目标目录 / 保留份数
CHM_BACKUP_DIR=/data/backups CHM_BACKUP_KEEP=30 bash .deploy-tools/backup.sh

# 回退旧逻辑（直接 tar WAL 库，不做一致性快照）
BACKUP_MODE=tar bash .deploy-tools/backup.sh
```

备份内容：

- 站点目录（`CHM_SITE`，含公开阅读产物与欢迎页）
- 数据目录（`CHM_DATA`，含 `app.db` 一致性快照 + `private/` + `uploads/` + `tmp/`）
- 默认每日 cron：每天 03:17（通过 `install-cron.sh` 装配）

恢复：

```bash
tar -tzf /var/backups/chm-web/chm-web-<STAMP>.tar.gz | head   # 先看内容
cd /
tar -xzf /var/backups/chm-web/chm-web-<STAMP>.tar.gz          # 解回原路径
systemctl restart chm-web    # 或 docker restart chm-web
```

## 存储 / 磁盘用量告警

```bash
# 只读统计：站点、数据、SQLite、最近备份，发现超过阈值退出码 1
node .deploy-tools/storage-report.js

# 输出 JSON（适合脚本解析）
REPORT_JSON=1 node .deploy-tools/storage-report.js

# 阈值示例：站点 5GB / 数据 5GB / 总 9GB / DB 1GB / 备份新鲜度 36h
ALERT_SITE_BYTES=5000000000 \
ALERT_DATA_BYTES=5000000000 \
ALERT_TOTAL_BYTES=9000000000 \
ALERT_DB_BYTES=1073741824 \
ALERT_BACKUP_HOURS=36 \
node .deploy-tools/storage-report.js

# 告警入口：打印告警 + 可选 webhook；有告警退出 1
ALERT_WEBHOOK_URL=... bash .deploy-tools/alert.sh
```

## 定时任务装配

```bash
bash .deploy-tools/install-cron.sh
```

该脚本安装：

- 每天 `03:17` 执行 `backup.sh`
- 每小时 `25 分` 执行 `alert.sh`

已有对应 cron 时幂等跳过；环境变量（如 `CHM_BACKUP_DIR`、`ALERT_WEBHOOK_URL`）
需在 cron 环境中配置（crontab 里或 `/etc/environment`）。

## 体积上限与内存预算（2026-09-29 加护栏）

| 变量 | 默认 | 作用 |
|---|---|---|
| `MAX_BYTES` | `209715200`（200MB，服务器 unit 里设置） | 单个 `.chm` 上传上限（含 multipart 开销另有 64KB 余量） |
| `EXPORT_MAX_BYTES` | 150MB | `GET /api/export-docs`（二进制直出）的选中内容上限 |
| `EXPORT_JSON_MAX_BYTES` | 60MB | `POST /api/export-docs`（zip→base64 塞进 JSON）的选中内容上限 |
| `EXPORT_SITE_MAX_BYTES` | 150MB | `/site-export.zip` 整站导出的内容上限 |

**为什么要卡这些数**：`src/lib/zip.js` 目前把整个 zip 在内存里拼装，实测**峰值 RSS ≈ 输入体积 ×3~4**；
POST 那条路还要 `zip.toString('base64')` + `JSON.stringify`，再翻约 4 倍压缩包体积。
9/5 与 9/27 两次 OOM（各 1.0~1.24GB RSS 被内核 kill）就是导出打爆内存：9/5 的 nginx 错误日志实锤是
`POST /api/export-docs`（用户在上传页点「打包成 zip 下载」）。
所以：**要导出更大的集合，必须先把 zip.js 改成流式写盘/写响应**，然后再抬这三个上限。

配套改动（都需要一起动，否则请求会在前一层被拒）：

- nginx：`client_max_body_size 210m;`（chmweb.cn 的 server 块）——原来 100m，比应用上限还低；
- systemd：`Environment=MAX_BYTES=209715200`；
- 上传 body 读取已按 `Content-Length` **预分配单块缓冲**（原来 `chunks[] + Buffer.concat` 是 2 倍瞬时占用）；
- 服务器已加 **2GB swap**（`/swapfile`，`vm.swappiness=20`）：内存打满时先换页而不是被 OOM kill。

回归测试：`node test-limits.js samples/7-zip.chm`（正向：限内上传/导出都正常；反向：三条导出路径 + 上传超限都返回 413 且文案带上限）。



## 服务器侧自动部署（push 即上线）

```bash
# 装配（幂等，覆盖旧的 /root/chm-web-autodeploy.sh）
cp /root/app/.deploy-tools/autodeploy.sh /root/chm-web-autodeploy.sh
chmod +x /root/chm-web-autodeploy.sh
crontab -l | grep autodeploy   # 应为 */2 * * * * /root/chm-web-autodeploy.sh >> /var/log/chm-web-deploy.log 2>&1
```

`autodeploy.sh` 每 2 分钟把 `/root/app` 同步到 `origin/main`，版本变化才 `systemctl restart chm-web`。
2026-09-29 加固：`flock` 串行化（旧版两个实例并发会留下 `.git/index.lock` 卡死后续所有部署）、
`github.com:22` → `ssh.github.com:443` 双通道重试（国内链路超时/DNS 失败时自动回落）、陈旧锁清理。

> ⚠️ 服务器上的 git 工作区由该脚本 `git reset --hard` 接管：**直接在服务器改代码会被下一轮 pull 覆盖**，
> 必须走 `push → 服务器 pull → 重启`。

## 文件说明

| 文件 | 作用 |
|---|---|
| `deploy.sh` | Docker 容器启动/重启/日志/状态 |
| `autodeploy.sh` | 服务器侧 cron 自动部署（同步 origin/main + 变化才重启；双通道重试） |
| `chm-web.service` | systemd 单元示例 |
| `watchdog.sh` | 健康探活 + 自动重启 + 告警 |
| `backup.sh` | 每日备份（默认一致 SQLite 快照 + tar） |
| `backup-snapshot.js` | 用 better-sqlite3 online backup 生成 DB 快照 |
| `storage-report.js` | 只读磁盘用量 / 备份新鲜度报告 |
| `alert.sh` | 存储告警统一出口（print + webhook） |
| `install-cron.sh` | 装配 backup + alert 定时任务 |
| `ssh-run.js` | SSH 远程命令/上传小助手 |