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

## 文件说明

| 文件 | 作用 |
|---|---|
| `deploy.sh` | Docker 容器启动/重启/日志/状态 |
| `chm-web.service` | systemd 单元示例 |
| `watchdog.sh` | 健康探活 + 自动重启 + 告警 |
| `backup.sh` | 每日备份（默认一致 SQLite 快照 + tar） |
| `backup-snapshot.js` | 用 better-sqlite3 online backup 生成 DB 快照 |
| `storage-report.js` | 只读磁盘用量 / 备份新鲜度报告 |
| `alert.sh` | 存储告警统一出口（print + webhook） |
| `install-cron.sh` | 装配 backup + alert 定时任务 |
| `ssh-run.js` | SSH 远程命令/上传小助手 |