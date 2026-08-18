# chm-web 后端（B 形态）：Node + 7-Zip，单容器跑静态托管 + 上传转换 + 导出。
# 构建/运行示例见同目录 deploy/README.md。
FROM node:20-slim

# 安装 7-Zip（新版 Debian 官方包名为 7zip，提供 7zz；老式再补 p7zip-full 提供 7z）
# + better-sqlite3（native 模块）编译工具链。
RUN apt-get update \
    && apt-get install -y --no-install-recommends 7zip p7zip-full build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖（含 native better-sqlite3），再拷代码
COPY package.json /app/package.json
RUN npm install

COPY src /app/src
COPY bin /app/bin

# 站点/数据都放持久化卷，别放镜像层
VOLUME ["/data/site", "/data/data"]
ENV CHM_SITE=/app/docs \
    CHM_DATA=/app/data \
    HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080
CMD ["node", "src/server.js"]