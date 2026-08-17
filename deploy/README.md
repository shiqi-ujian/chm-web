# 正式起 chm-web 后端（B 形态）的 Docker/Caddy 示例。
# 作用：Node+7z 容器 + Caddy 自动 HTTPS 反代到 80/443。

# ---------- 0) 生成两个随机 token ----------
#   openssl rand -hex 16        # → 作 UPLOAD_TOKEN
#   openssl rand -hex 16        # → 作 EXPORT_TOKEN
#   记下来，别提交到版本库。

# ---------- 1) 启动后端 ----------
docker run -d --name chm-web \
  -p 8080:8080 \
  -v chm-site:/app/docs \     # 文档产物（可浏览的静态阅读层），持久
  -v chm-data:/app/data \     # 上传的临时 chm 等，持久
  -e UPLOAD_TOKEN='<上面生成的>' \
  -e EXPORT_TOKEN='<上面生成的>' \
  -e CHM_SITE=/app/docs \
  -e CHM_DATA=/app/data \
  -e PORT=8080 -e HOST=0.0.0.0 \
  chm-web:latest

# ---------- 2) 可选：Caddy 反代 + 自动 HTTPS ----------
# Caddyfile（放在宿主机）:
#   docs.example.com {
#       reverse_proxy 127.0.0.1:8080
#   }
# 运行：caddy run 即可自动申请 Let's Encrypt 证书。

# ---------- 3) 前端带 token 的说明 ----------
# 一旦设置了 EXPORT_TOKEN/UPLOAD_TOKEN，欢迎页重建时会把 token 注入前端，
# 浏览器上传/导出会自动携带 X-Auth-Token，通常无需人工干预。
# 若有人要直接用 curl 上传（服务端到服务端）：
#   curl -F file=@a.chm -H "X-Auth-Token: <UPLOAD_TOKEN>" http://host/api/upload

# ---------- 4) systemd（不用 docker 时）----------
# 见同目录 chm-web.service 示例；需确保 7zz/7z 在 PATH，或设 SEVENZ=/usr/bin/7z