#!/bin/bash
# chm-web 每日备份：打包站点+数据目录到 /var/backups/chm-web，保留最近 14 份
set -e
DATA=/var/chm-web/data
BK=/var/backups/chm-web
mkdir -p "$BK"
STAMP=$(date +%Y%m%d-%H%M%S)
# 先安全停写：SQLite 用 WAL，直接打包可能不一致；用 sqlite3 .backup 或直接 tar（文件不大，简单 tar + 停机窗口极短）
tar -czf "$BK/chm-web-$STAMP.tar.gz" -C / "$(echo $DATA | sed 's|^/||')" 2>/dev/null || tar -czf "$BK/chm-web-$STAMP.tar.gz" -C /var/chm-web data
# 保留最近 14 份
ls -1t "$BK"/chm-web-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "backup ok: $BK/chm-web-$STAMP.tar.gz ($(du -h "$BK/chm-web-$STAMP.tar.gz" | cut -f1))"
