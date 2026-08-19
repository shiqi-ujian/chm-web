#!/bin/bash
# chm-web watchdog: 探活 + 自动重启 + 连续失败告警
# 用法:
#   bash watchdog.sh check     # 跑一次健康检查（cron 用，默认）
#   bash watchdog.sh install   # 注册 cron（每 5 分钟），写入 crontab
# 告警通道（可选）:
#   设置环境变量 ALERT_WEBHOOK_URL（Server酱 / 钉钉 / 企业微信机器人 webhook）
#   → 连续失败达阈值时 POST JSON {"title":..., "desp":...} 通知；
#   未设置则只写日志 /var/log/chm-web-watchdog.log。
# 说明: 本脚本随仓库部署同步（git reset 后仍在仓库内），cron 指向仓库内路径。

set -u
SERVICE=chm-web
PORT=${WATCH_PORT:-8080}
HEALTH_URL="http://127.0.0.1:${PORT}/api/docs"
LOG=/var/log/chm-web-watchdog.log
STATE=/var/run/chm-web-watchdog.state   # 连续失败计数
MAX_FAIL=${WATCH_MAX_FAIL:-3}           # 连续失败 N 次触发告警
RESTART_SLEEP=3

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

fail_count() { cat "$STATE" 2>/dev/null || echo 0; }

alert() {
  log "ALERT $*"
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    local payload
    payload=$(printf '{"title":"chm-web 服务异常","desp":"%s"}' "$(date '+%F %T') $*")
    if curl -s -m 10 -X POST -H 'Content-Type: application/json' -d "$payload" "$ALERT_WEBHOOK_URL" >> "$LOG" 2>&1; then
      log "webhook sent OK"
    else
      log "webhook send FAILED"
    fi
  fi
}

health_ok() {
  systemctl is-active --quiet "$SERVICE" || return 1
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 8 "$HEALTH_URL" 2>/dev/null)
  [ "$code" = "200" ]
}

install_cron() {
  local line="*/5 * * * * $(readlink -f "$0") check >> /var/log/chm-web-watchdog-cron.log 2>&1"
  if crontab -l 2>/dev/null | grep -q 'watchdog.sh'; then
    echo "watchdog cron already installed"
  else
    (crontab -l 2>/dev/null; echo "$line") | crontab -
    echo "watchdog cron installed: $line"
  fi
}

case "${1:-check}" in
  install) install_cron ;;
  check) ;;  # fall through
  *) echo "usage: $0 [check|install]"; exit 1 ;;
esac

# ---- 健康检查 ----
if health_ok; then
  n=$(fail_count)
  if [ "$n" -gt 0 ]; then
    log "recovered (after $n consecutive failures)"
    rm -f "$STATE"
  fi
  exit 0
fi

# 失败：计数 +1 → 重启 → 重启后再探活一次
n=$(fail_count)
n=$((n + 1))
echo "$n" > "$STATE"
log "health check FAILED (#$n) — restarting $SERVICE"
systemctl restart "$SERVICE" >> "$LOG" 2>&1
sleep "$RESTART_SLEEP"

if health_ok; then
  log "restart recovered the service"
  rm -f "$STATE"
else
  log "service still DOWN after restart (#$n)"
  if [ "$n" -ge "$MAX_FAIL" ]; then
    alert "连续 $n 次健康检查失败，已自动重启仍无法恢复（服务：$SERVICE）"
  fi
fi
