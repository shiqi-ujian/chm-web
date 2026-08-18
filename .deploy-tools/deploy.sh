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
