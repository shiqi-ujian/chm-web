#!/bin/bash
# chm-web 服务器侧自动部署（cron 每 2 分钟跑一次）
#   职责：把 /root/app 同步到 origin/main，发现版本变化就重启 systemd 服务。
#
# 相对旧版 /root/chm-web-autodeploy.sh 的加固（2026-09-29）：
#   1) flock 串行化——避免两个 cron 实例并发 git 操作，留下 .git/index.lock 把后续部署全部卡死；
#   2) 双通道 + 重试——github.com:22 在国内链路上常超时/DNS 失败，失败后自动回落 ssh.github.com:443；
#   3) 陈旧 index.lock 清理——确认没有 git 进程在跑时才删；
#   4) 失败静默跳过、只记日志，等下一轮（不写脏状态、不误重启）。
#
# 安装（服务器）：
#   cp /root/app/.deploy-tools/autodeploy.sh /root/chm-web-autodeploy.sh && chmod +x /root/chm-web-autodeploy.sh
#   crontab 中应有：*/2 * * * * /root/chm-web-autodeploy.sh >> /var/log/chm-web-deploy.log 2>&1
set -u

LOG=${CHM_DEPLOY_LOG:-/var/log/chm-web-deploy.log}
LOCK=${CHM_DEPLOY_LOCK:-/var/run/chm-web-autodeploy.lock}
APP=${CHM_APP_DIR:-/root/app}
KEY=${CHM_DEPLOY_KEY:-/root/.ssh/github_deploy}
SERVICE=${CHM_SERVICE:-chm-web}

cd "$APP" || exit 1

# 1) 串行化：拿不到锁说明上一轮还在跑，直接退出
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK" || exit 0
  flock -n 9 || exit 0
fi

# 2) 陈旧锁清理（只有确认没有 git 进程在跑才动手）
if [ -f "$APP/.git/index.lock" ] && ! pgrep -x git >/dev/null 2>&1; then
  echo "$(date '+%F %T') 清理陈旧 .git/index.lock" >>"$LOG"
  rm -f "$APP/.git/index.lock"
fi

# 3) 双通道拉取（22 直连 → 443 回落），最多 3 轮
SSH_BASE="ssh -i $KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=12 -o ServerAliveInterval=5"
SSH_22="$SSH_BASE"
SSH_443="$SSH_BASE -p 443 -o HostName=ssh.github.com"

fetch_ok=0
for _ in 1 2 3; do
  if GIT_SSH_COMMAND="$SSH_22" git fetch origin main -q 2>>"$LOG"; then fetch_ok=1; break; fi
  if GIT_SSH_COMMAND="$SSH_443" git fetch origin main -q 2>>"$LOG"; then fetch_ok=1; break; fi
  sleep 5
done
[ "$fetch_ok" -eq 1 ] || exit 0   # 网络抖动：本轮跳过，日志已记录

BEFORE=$(git rev-parse HEAD)
git reset --hard origin/main -q 2>>"$LOG" || exit 0
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" != "$AFTER" ]; then
  systemctl restart "$SERVICE"
  echo "$(date '+%F %T') updated $BEFORE -> $AFTER" >>"$LOG"
fi
