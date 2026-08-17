# chm-web 后端（B 形态）—— 供 Railway 直接使用的镜像。
# 与 deploy/Dockerfile 等价，但把已有的 docs/（已生成的阅读产物 + 欢迎页）
# 一并打进镜像，作为「初始站点内容」——容器首次启动就能浏览现有文档。
# Railway 会自动检测并据此构建，无需手动配置（见 README「用 Railway 上线」）。
FROM node:20-slim

# 安装 7-Zip：新版 Debian 官方包 `7zip` 提供 7zz；p7zip-full 提供 7z（老式备选）。
RUN apt-get update \
    && apt-get install -y --no-install-recommends 7zip p7zip-full \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 代码
COPY src /app/src
COPY bin /app/bin
COPY package.json /app/package.json

# 初始站点内容（欢迎页 + d/ 下的阅读文档产物）。
# 生产环境运行时通常用 Volume 覆盖 /app/docs 持久化；这里提供默认值以便开箱即用。
COPY docs /app/docs
# 种子备份：挂到 /app/docs 的空 Volume 会遮住镜像内容，server 启动时若站点根
# 为空会从 /app/seed-docs 复制回来（见 src/server.js ensureSeed）。
COPY docs /app/seed-docs

# 站点/数据目录放卷（在 Railway 上挂 Volume 到这两个路径，重启不丢上传）。
ENV CHM_SITE=/app/docs \
    CHM_DATA=/app/data \
    HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080
CMD ["node", "src/server.js"]