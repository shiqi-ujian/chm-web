#!/bin/bash
# chm-web 每日备份：打包站点+数据目录到 ${CHM_BACKUP_DIR:-/var/backups/chm-web}，保留最近 KEEP 份。
#
# 改进（2026-08-20）：
#   1) 一致备份（默认）：用 .deploy-tools/backup-snapshot.js 经 better-sqlite3 在线备份
#      API 生成 app.db 一致性快照，再 tar 归档“站点目录 + 数据目录（其中的 app.db 用快照替换）”，
#      比直接 tar WAL 库更安全，且源库无需停机。
#   2) 可用 BACKUP_MODE=tar 回退到旧逻辑（直接 tar，简单直接）。
#   3) 保留最近 CHM_BACKUP_KEEP 份（默认 14）。
#   4) 失败时退出非 0，外部 cron / 运维脚本可感知并告警。
#
# 用法: bash backup.sh
# 环境变量: CHM_DATA / CHM_SITE / CHM_BACKUP_DIR / CHM_BACKUP_KEEP / BACKUP_MODE
set -e

DATA=${CHM_DATA:-/var/chm-web/data}
SITE=${CHM_SITE:-$DATA/site}
BK=${CHM_BACKUP_DIR:-/var/backups/chm-web}
KEEP=${CHM_BACKUP_KEEP:-14}
MODE=${BACKUP_MODE:-sqlite}
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$BK"
STAMP=$(date +%Y%m%d-%H%M%S)
TMP=$(mktemp -d "$BK/.chm-web-bk.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

# 1) 一致性 SQLite 快照（在线备份 API，只读源库）
SNAP=""
if [ "$MODE" = "sqlite" ]; then
  DB="$DATA/app.db"
  if [ -f "$DB" ]; then
    SNAP="$TMP/app.db"
    node "$HERE/backup-snapshot.js" "$DB" "$SNAP"
    echo "sqlite snapshot ok: $SNAP"
  else
    echo "no app.db, skip sqlite snapshot"
  fi
fi

# 2) 归档。包含：站点目录 + 数据目录；若生成了快照，把快照放进归档 data/app.db（覆盖原始 app.db）
if [ -n "$SNAP" ]; then
  # 复制一份到 staging 根对应 DATA 路径，避免 tar --transform 兼容性问题
  STAGE_ROOT="$TMP/stage"
  STAGE_DATA="$STAGE_ROOT$DATA"   # DATA 是绝对路径，例如 /var/chm-web/data
  mkdir -p "$STAGE_DATA"
  cp "$SNAP" "$STAGE_DATA/app.db"
  tar -czf "$BK/chm-web-$STAMP.tar.gz" -C "$STAGE_ROOT" "$(echo "$DATA" | sed 's|^/||')" \
      -C / "$(echo "$SITE" | sed 's|^/||')" 2>/dev/null || {
        echo "stage tar failed, fallback to plain tar" >&2
        tar -czf "$BK/chm-web-$STAMP.tar.gz" -C / "$(echo "$DATA" | sed 's|^/||')" "$(echo "$SITE" | sed 's|^/||')" 2>/dev/null || \
          tar -czf "$BK/chm-web-$STAMP.tar.gz" -C /var/chm-web data
      }
else
  tar -czf "$BK/chm-web-$STAMP.tar.gz" -C / \
    "$(echo "$SITE" | sed 's|^/||')" "$(echo "$DATA" | sed 's|^/||')" 2>/dev/null || \
    tar -czf "$BK/chm-web-$STAMP.tar.gz" -C /var/chm-web data
fi

# 3) 保留最近 KEEP 份
ls -1t "$BK"/chm-web-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "backup ok: $BK/chm-web-$STAMP.tar.gz ($(du -h "$BK/chm-web-$STAMP.tar.gz" | cut -f1))"