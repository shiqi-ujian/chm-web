#!/bin/bash
# chm-web 阿里云部署脚本：启动容器 + 数据持久化 + 自启
# 用法: bash deploy.sh [start|stop|restart|logs|status]

set -e
APP_DIR=/root/app
DATA_DIR=/var/chm-web/data
CONTAINER=chm-web
IMAGE=chm-web:latest
PORT=3000

mkdir -p "$DATA_DIR"

start() {
  docker rm -f "$CONTAINER" 2>/dev/null || true
  docker run -d --name "$CONTAINER" \
    --restart unless-stopped \
    -p "$PORT:8080" \
    -e CHM_SITE=/app/data/site \
    -e CHM_DATA=/app/data/data \
    -e HOST=0.0.0.0 \
    -e PORT=8080 \
    -e UPLOAD_TOKEN="$UPLOAD_TOKEN" \
    -e EXPORT_TOKEN="$EXPORT_TOKEN" \
    -e ADMIN_TOKEN="$ADMIN_TOKEN" \
    -e PUBLIC_BASE_URL="$PUBLIC_BASE_URL" \
    -e SMTP_HOST="$SMTP_HOST" \
    -e SMTP_PORT="$SMTP_PORT" \
    -e SMTP_USER="$SMTP_USER" \
    -e SMTP_PASS="$SMTP_PASS" \
    -e SMTP_FROM="$SMTP_FROM" \
    -e SMTP_SECURE="$SMTP_SECURE" \
    -e RATE_AUTH_MAX="$RATE_AUTH_MAX" \
    -e RATE_UPLOAD_MAX="$RATE_UPLOAD_MAX" \
    -e RATE_EXPORT_MAX="$RATE_EXPORT_MAX" \
    -e RATE_SEARCH_MAX="$RATE_SEARCH_MAX" \
    -e MAX_GLOBAL_BYTES="$MAX_GLOBAL_BYTES" \
    -e MAX_USER_DOCS="$MAX_USER_DOCS" \
    -e MAX_USER_BYTES="$MAX_USER_BYTES" \
    -v "$DATA_DIR:/app/data" \
    "$IMAGE"
  echo "started: http://<ip>:$PORT"
}

case "${1:-start}" in
  start) start ;;
  stop) docker rm -f "$CONTAINER" 2>/dev/null || true; echo stopped ;;
  restart) start ;;
  logs) docker logs -f --tail 50 "$CONTAINER" ;;
  status) docker ps --filter name="$CONTAINER" ;;
  *) echo "usage: $0 [start|stop|restart|logs|status]"; exit 1 ;;
esac