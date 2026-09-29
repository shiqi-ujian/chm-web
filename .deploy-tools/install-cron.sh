#!/bin/bash
# chm-web 定时维护 cron 装配器：
#   每日备份（backup.sh，默认凌晨 3:17）+ 存储/备份新鲜度告警（alert.sh，每小时 25 分）。
# 环境变量可从调用侧传入（CHM_BACKUP_DIR / CHM_SITE / CHM_DATA / ALERT_WEBHOOK_URL 等）。
# 用法: bash .deploy-tools/install-cron.sh
set -e
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS=/var/log

# 备份：每天 03:17
BCRON="17 3 * * * $HERE/backup.sh >> $LOGS/chm-web-backup.log 2>&1"
# 存储告警：每小时 25 分
ACRON="25 * * * * $HERE/alert.sh >> $LOGS/chm-web-alert-cron.log 2>&1"

CURRENT=$(crontab -l 2>/dev/null || true)
if ! printf '%s\n' "$CURRENT" | grep -qF "$HERE/backup.sh"; then
  printf '%s\n' "$CURRENT" "$BCRON" | crontab -
  echo "installed backup cron: $BCRON"
else
  echo "backup cron already installed"
fi

CURRENT=$(crontab -l 2>/dev/null || true)
if ! printf '%s\n' "$CURRENT" | grep -qF "$HERE/alert.sh"; then
  printf '%s\n' "$CURRENT" "$ACRON" | crontab -
  echo "installed alert cron: $ACRON"
else
  echo "alert cron already installed"
fi