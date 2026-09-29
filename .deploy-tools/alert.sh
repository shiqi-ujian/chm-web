#!/bin/bash
# chm-web 运维告警：存储用量 + 备份新鲜度统一出口。
# 依赖 .deploy-tools/storage-report.js（只读）；可被 cron 调用。
# 用法:
#   bash .deploy-tools/alert.sh check
# 环境变量:
#   CHM_SITE / CHM_DATA / CHM_BACKUP_DIR
#   ALERT_WEBHOOK_URL（Server酱/钉钉/企业微信机器人 webhook）→ 触发时 POST JSON
#   REPORT_JSON=1 时输出 JSON（供外部解析）
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG=${CHM_ALERT_LOG:-/var/log/chm-web-alert.log}
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true

# 默认使用 Windows/宿主环境变量透传有坑；脚本内不强制 node 在 PATH 时给提示（服务器已装）。
REPORT="$(CHM_SITE="${CHM_SITE:-}" CHM_DATA="${CHM_DATA:-}" CHM_BACKUP_DIR="${CHM_BACKUP_DIR:-}" REPORT_JSON=1 node "$HERE/storage-report.js" 2>&1)" || RC=$?
RC=${RC:-0}
echo "$REPORT" | sed 's/^/ALERT-SCAN /' >> "$LOG" 2>/dev/null || true

if [ "$RC" -eq 0 ]; then
  echo "storage ok"
  exit 0
fi

# 有告警：打印 + 可选 webhook
echo "$REPORT"
SUMMARY=$(printf '%s' "$REPORT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const lines=[j.alerts[0]||'存储告警','站点:'+j.site.bytes+' 数据:'+j.data.bytes+' 总计:'+j.totalBytes];console.log(lines.join(' | '))}catch(e){console.log('存储告警')}})")
if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
  PAYLOAD=$(printf '{"title":"chm-web 存储告警","desp":"%s"}' "$(date '+%F %T') $SUMMARY")
  curl -s -m 10 -X POST -H 'Content-Type: application/json' -d "$PAYLOAD" "$ALERT_WEBHOOK_URL" >> "$LOG" 2>&1 || echo "webhook send failed" >> "$LOG"
fi
exit 1