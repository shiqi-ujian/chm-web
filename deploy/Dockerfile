# chm-web 后端（B 形态）：Node + 7-Zip，单容器跑静态托管 + 上传转换 + 导出。
# 构建/运行示例见同目录 deploy/README.md。
# 零 npm 依赖，无需 npm install/构建步骤。
FROM node:20-slim

# 安装 7-Zip（新版 Debian 官方包名为 7zip，提供 7zz；老式再补 p7zip-full 提供 7z）
RUN apt-get update \
    && apt-get install -y --no-install-recommends 7zip p7zip-full \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY src /app/src
COPY bin /app/bin
COPY package.json /app/package.json

# 站点/数据都放持久化卷，别放镜像层
VOLUME ["/data/site", "/data/data"]
ENV CHM_SITE=/app/docs \
    CHM_DATA=/app/data \
    HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080
CMD ["node", "src/server.js"]