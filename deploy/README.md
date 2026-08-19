# chm-web 阿里云部署参考：Docker / systemd / Caddy 示例。
# 当前生产已部署在阿里云服务器；本目录保留为部署模板与运维参考。
# 作用：Node+7z 容器 + Caddy 自动 HTTPS 反代到 80/443。

# ---------- 0) 生成随机令牌 ----------
#   openssl rand -hex 16        # → 作 UPLOAD_TOKEN
#   openssl rand -hex 16        # → 作 EXPORT_TOKEN
#   openssl rand -hex 16        # → 作 ADMIN_TOKEN
#   记下来，别提交到版本库；只放阿里云服务器环境变量。

# ---------- 1) 启动后端（Docker，阿里云常用） ----------
# 也可直接用仓库 .deploy-tools/deploy.sh（已封装 container 名/数据卷/自启，
# 并把 UPLOAD_TOKEN/EXPORT_TOKEN/ADMIN_TOKEN/PUBLIC_BASE_URL/SMTP_*/RATE_*/MAX_*
# 从宿主机环境变量透传进容器）。
docker run -d --name chm-web \
  -p 8080:8080 \
  -v /var/chm-web/data:/app/data \
  -e CHM_SITE=/app/data/site \
  -e CHM_DATA=/app/data/data \
  -e UPLOAD_TOKEN='<上面生成的>' \
  -e EXPORT_TOKEN='<上面生成的>' \
  -e ADMIN_TOKEN='<上面生成的>' \
  -e PUBLIC_BASE_URL='https://你的域名' \
  -e SMTP_HOST='smtp.example.com' -e SMTP_PORT=465 -e SMTP_USER='...' -e SMTP_PASS='...' -e SMTP_FROM='no-reply@...' \
  -e PORT=8080 -e HOST=0.0.0.0 \
  chm-web:latest

# ---------- 2) 可选：Caddy 反代 + 自动 HTTPS ----------
# Caddyfile（放在宿主机）:
#   docs.example.com {
#       reverse_proxy 127.0.0.1:8080
#   }
# 运行：caddy run 即可自动申请 Let's Encrypt 证书。

# ---------- 3) 前端带 token 的说明 ----------
# 当前安全策略：欢迎页不烘焙任何密钥；公网下上传/导出/管理接口要求
# 「有效 token 或已登录会话」。
# 若有人要直接用 curl 上传（服务端到服务端）：
#   curl -F file=@a.chm -H "X-Auth-Token: <UPLOAD_TOKEN>" http://host/api/upload
# 管理端：
#   curl -H "X-Admin-Token: <ADMIN_TOKEN>" http://host/admin/reports

# ---------- 4) systemd（不用 docker 时）----------
# 见同目录 chm-web.service；需确保 7zz/7z 在 PATH，或设 SEVENZ=/usr/bin/7z。
# 敏感变量放在 /etc/systemd/system/chm-web.env（chmod 600），由 EnvironmentFile 引入。
# 注意：阿里云若直接用 systemd 跑，应用目录/数据目录以服务器实际部署为准。