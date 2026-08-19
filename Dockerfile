# chm-web 后端（B 形态）—— 阿里云生产使用的镜像。
# 与 deploy/Dockerfile 等价，但把已有的 docs/（已生成的阅读产物 + 欢迎页）
# 一并打进镜像，作为「初始站点内容」——容器首次启动就能浏览现有文档。
# 生产部署：push → GitHub → 阿里云自动拉取/触发构建部署（见 README「生产部署」）。
FROM node:22-slim

# 安装 7-Zip（新版 Debian 官方包 `7zip` 提供 7zz；p7zip-full 提供 7z 老式备选）
# + better-sqlite3（native 模块，v13 需 Node ≥ 22）所需编译工具链。
RUN apt-get update \
    && apt-get install -y --no-install-recommends 7zip p7zip-full build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖（含 native better-sqlite3，便于利用构建缓存）
COPY package.json /app/package.json
RUN npm install

# 代码
COPY src /app/src
COPY bin /app/bin

# 初始站点内容（欢迎页 + d/ 下的阅读文档产物）。
# 生产环境运行时通常用 Volume 覆盖 /app/docs 持久化；这里提供默认值以便开箱即用。
COPY docs /app/docs
# 种子备份：挂到 /app/docs 的空 Volume 会遮住镜像内容，server 启动时若站点根
# 为空会从 /app/seed-docs 复制回来（见 src/server.js ensureSeed）。
COPY docs /app/seed-docs

# 站点/数据目录放持久卷。当前生产用 /var/chm-web/data 宿主机目录挂到容器 /app/data：
# CHM_SITE=/app/data/site、CHM_DATA=/app/data/data。
# 挂载后重启不丢上传/账号/私密文档。
ENV CHM_SITE=/app/data/site \
    CHM_DATA=/app/data/data \
    HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080
CMD ["node", "src/server.js"]