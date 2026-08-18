# chm-web

**CHM → 可浏览/搜索网站**：免费 · 非营利 · 服务大众。用户上传 `.chm`，转成**双端（PC / 手机）可浏览、可搜索**的子页；上传者可设为**私密（仅自己和被分享者可见）或公开**；后期支持逐章搜索，最终支持**批量私有部署导出**（把整个 CHM 转成自己可带走的静态站点产物）。

---

## 核心原则

1. **不收费**。本项目是公益 / 免费产品，服务费来自域名 / 托管 / 维护，不在功能上设付费墙。
2. **P0 = 核心闭环**；可见性、批量导出是**加分项而非收费理由** —— 定位为"**免费 + 完整**"，而非"收费：私密"。

---

## 先说明：这不是一个"纯静态站"

> （早期文档把本项目称作"静态站"，这是不准确的，现已更正。）严格说，本项目是一个**动态后端驱动的网站**，只不过其中"浏览/展示"那一层用的是静态 HTML。

要分清两层：

- **需要一个有程序的后端（动态）** —— 这是本项目成立的关键。用户上传 `.chm` 后，需要一台跑了 **Node 服务**的服务器：接收上传 → 调 7z 解包 → 跑转换脚本 → 结果存盘。这一步**必须**有"一直有人值班"的后端程序，纯 HTML 做不到。所以**上传/转换环节不是静态站**。
- **浏览/阅读那一层生成的是静态页面** —— 转换完成后，产生的是**写死的 HTML 文件**（解包出的 `.htm` + 我们生成的 `index.html` 阅读壳 + `.hhc/.hhk` 索引）。这一层以静态文件交付，可用 GitHub Pages / Cloudflare Pages 免费托管，或用轻量服务器直接提供。

一句话概括：**前端（接收上传、转换、权限）是动态的，依赖后端；文档阅读产物是静态的，交付/托管可以白嫖静态平台。** 这也是"批量私有部署导出 = 把静态产物打 zip 带走"能成立的物理基础。

---

## 技术栈

| 模块 | 选型 | 理由 |
|------|------|------|
| 运行环境 | Node.js（纯 JS，无框架依赖） | 后端服务 + 转换脚本 |
| CHM 解包 | 7z / mspack / chmlib（解析 ITSF 表 + LZX 解压） | 现成开源，免造轮子 |
| 解包产物 | 静态 HTML + `.hhc` 目录树 + `.hhk` 关键字索引 | 7-zip 即能解出，阅读层静态 |
| 双端体验 | 移动 / 桌面都用响应式 HTML | 移动端可读可搜，桌面端做批量 / 部署 |
| 可见性 | 私有 / 公开 / 指定链接 → 登录态 + 邀请链接 | 简单 ACL |
| 全文检索 | 先目录检索，再加 flexsearch / lunr.js | 客户端索引，静态阅读层也能搜 |
| 托管 | 阅读产物静态 → GitHub/Cloudflare Pages；上传/转换需轻量服务器 | 前端动态需后端，阅读产物免费托管 |
| 批量私有部署 | 导出产物 → 打 zip / 静态站点 | 后期核心卖点 |

---

## 里程碑

### M1 — CHM 解包 + 转静态 HTML（地基）
- [x] 输入 `.chm` → 输出同名目录（内嵌 HTML + `.hhc` + `.hhk`）
- [x] 用 7-Zip 校验解包产物结构正确
- [x] 能正确画出 `.hhc` 目录树
- [x] 记录 `.hhk` 关键字，后续"站内搜索"用
- **验收**：`a.chm` → `a/` 目录可浏览首页（✅ 已用 7-zip.chm 跑通，`npm run convert` 一步生成预览站）

### M2 — 双端可访问 + 可见性权限
- [x] 移动端 / 桌面端起本地静态服务，可翻页浏览（手机：顶栏 + 汉堡抽屉目录；桌面：左目录右正文）
- [x] 用户态与"可见性"绑定：私有 / 公开 / 指定链接（注册/登录/会话 scrypt 哈希，`src/lib/auth.js` + `POST /api/register|login|logout`）
- [x] 上传条目挂"我的上传"下，带公开 / 私有标签（`X-User-Token` / `chm_user` cookie 双通道，owner 可设公开/私密、复制分享链接）
- **验收**：手机能打开子页，公开条目免登录可见，私有条目需指定链接可见（✅ `test-auth.js` 32 项全绿，含分享链接 / 实体迁移 / 越权拒绝）

### M3 — 全库检索（搜索）
- [x] 目录树检索（基于 `.hhc`）
- [x] 单文档全文检索（`.hhk` 关键字 + 基于 `.htm` 的浏览器端全文索引）
- [x] **跨文档 / 全站统搜**（欢迎页 `site-index.json` 聚合索引，一个框搜所有文档的关键字与正文）
- **验收**：搜到 CHM 内页标题 / 关键字，手机端可用（✅ 已在欢迎页与阅读壳打通）

### M4 — 批量 + 私有部署
- [x] 站点级导出：整站打 zip（含 `manifest.json` 清单），欢迎页「导出整站 zip ⬇」按钮直达，CLI `export-site` / 后端 `GET /site-export.zip` 均可
- [x] 支持一个 / 多个 CHM 批量上传（多选 / 拖拽 + 逐个上传汇总进度）
- [x] 批量 / 选中导出为 zip / 静态站点（勾选若干文档 → 「导出选中 zip」→ `GET /api/export-docs` → CLI `export-docs`）
- **验收**：选中多个 CHM，一次转换后整包导出为 zip / 静态站点 ✅（`deploy/` 提供 Docker / systemd / Caddy 部署物，`docs/` 里 import `docs/index.html`）

---

## 用 Railway 上线（面向 0 基础）🚀

> 这一步是让「**真后端闭环**」（用户上传 .chm → 服务器解包转换 → 在线浏览 / 导出）跑起来，
> 不再局限于看仓库里已生成好的那几个文档。Railway 会帮你把 Nginx、证书、公网网址全搞定，
> **你不用碰命令行服务器**。

### 1. Railway 是什么（大白话）
你过去上传一个 `.chm`，需要一台"有人值班、挂了还能自动拉起"的程序服务器帮它解包。传统上你得自己买服务器并折腾装环境；**Railway 替你干了这些**——你把本项目的 GitHub 仓库接上去（或直接传代码），它自动装好 Node + 7-Zip、起服务、给你一个 `https://你的项目.up.railway.app` 链接，访问这个链接就是你的网站。

> **注意**：Railway 是**按用量计费**（有少量免费额度，跑起来量大会超），不是永久免费。个人起步验证闭环足够，量大后考虑迁到自有服务器。

### 2. 前置：代码已经在本地跑通 + 已提交到 GitHub
先把当前工作区提交并推送到你的 GitHub 仓库（`chm-web`）。Railway 直接从这个仓库拉代码。

### 3. 注册并连接仓库
1. 注册 Railway（用 GitHub 账号一键登录最省事）。
2. 新建项目 `New Project` → `Deploy from GitHub repo`，选 `shiqi-ujian/chm-web`（或你自己的那个）。
3. Railway 会读到仓库根目录的 [Dockerfile](Dockerfile)，**自动开始构建**，不用点别的。

### 4. 第一次构建可能会替 REPLACE 的变量（不填也能先跑起来）
> **不要一上来就填，先不填任何变量直接 Deploy**，能起来再回来加锁 —— 见第 6 步。

在项目的 `Variables` 面板里，全填你线下随机生成的长字符串：
- `UPLOAD_TOKEN`：上传钥匙（防别人乱传）
- `EXPORT_TOKEN`：导出钥匙（防别人拉走文档）
生成方式：终端 `openssl rand -hex 16`（Windows 用 Git Bash 一样有）。

### 5. 让 Railway 用持久盘保存文档
上传后文档会写进 `/app/docs`。若要重启不丢，给项目加一个 **Volume**（挂到 `/app/docs`），并把 `CHM_SITE=/app/docs`、`CHM_DATA=/app/data` 设好。

### 6. 打开
构建完成会有 `Deployments → View Deploy` 或 `Settings → Networking` 里的域名，点开即你的欢迎页。上传一个 `.chm` 试试真闭环。

### 7. 上线后务必做的一步：开「访问令牌」
前端知道了怎么办：欢迎页重建时会把 `EXPORT_TOKEN` 注入页面，浏览器上传 / 导出会自动带 `X-Auth-Token`，用户无感。**不开 token 的话，公网任何一个人都能偷偷传文件、能拉走你所有文档。**

### 8. 本地复现用的一样的东西
- `Dockerfile`（根目录）：Railway 默认检测它；本地也能 `docker build -t chm-web . && docker run -p 8080:8080 chm-web` 预览。
- `deploy/Dockerfile`、`deploy/README.md`、`deploy/chm-web.service`：Caddy / systemd 非 Docker 部署示例（备用 / 自托管时用）。
- 更简单：没设 `EXPORT_TOKEN` / `UPLOAD_TOKEN` 时服务器保持「不锁」，本地起服务照常，兼容你现在看的静态 A 形态。

---

## 开发路线（建议顺序）

1. **P0·跑通**：7z 解一个 CHM → 起静态服务 → 手机能开（约 3~5 天）
2. **P1·目录 + 搜索**：解析 hhc / hhk → 页面搜索（约 3~7 天）
3. **P2·可见性 + 账号**：登录态、私有 / 公开链接（约 5~10 天）
4. **P3·批量导出 / 部署**：批处理 + 生成静态站点 / zip（真正的核心价值）（约 7~14 天）

> 单人业余总计约 3~6 周；若 90% 走基础（解包 + 静态托管），2~3 周可上线 MVP。

成本大致：域名可用自己 / 免费 `*.pages.dev`（¥0 先期），托管 GitHub / Cloudflare Pages（¥0~¥20/月），解包用 7-Zip（¥0），存储基本可忽略。**如果是个人 + 静态 + 基础托管，成本约 ¥0/月**。

---

## License

免费 / 非营利公益项目，授权将在代码落地后明确。

---

## 目录结构

```
chm-web/
├─ README.md        # 本文件：项目定位、技术栈、里程碑
├─ PLAN.md          # 开发计划（技术选型、里程碑、成本、风险）
├─ HANDOFF.md       # 交接文档（新对话接手无需读历史对话）
├─ 上传网页教程.md   # 把转换好的站点上传到静态托管的图文步骤
├─ package.json     # 依赖清单 + convert/serve/test 脚本
├─ bin/cli.js       # CLI 入口
├─ src/
│  ├─ cli.js        # convert / extract / scan / serve 命令
│  └─ lib/
│     ├─ chm.js      # 7-Zip 解包 + 扫描
│     ├─ hhc.js      # 解析 .hhc 目录树
│     ├─ hhk.js      # 解析 .hhk 关键字
│     ├─ preview.js  # 生成 index.html / __chm_nav.html / keywords.json / search-index.json
│     ├─ serve.js    # 零依赖静态服务器
│     ├─ landing.js  # 欢迎页 + 全站聚合检索 site-index.json
│     ├─ zip.js      # 零依赖 zip 打包器
│     ├─ site-export.js  # 整站导出（含 manifest.json）
│     └─ convert.js  # 端到端转换编排
├─ test-hhc.js      # 目录树解析自测
├─ test-serve.js    # 静态服务自测
├─ test-fulltext.js # 全文检索索引自测
├─ test-site.js     # 欢迎页全站搜索烟测
├─ test-zip.js      # zip 打包 / 整站导出自测
└─ out/             # （git 忽略）转换产物输出目录
```

---

## 环境要求

- **Node.js** ≥ 16（推荐最新 LTS；转换用 `node bin/cli.js`）
- **7-Zip** 命令行版。解析顺序（见 `src/lib/chm.js`）：
  1. 环境变量 `SEVENZ`（最高优先，可指向任意路径）
  2. PATH 里的 `7z` / `7za`（跨平台，**部署 Linux 服务器时推荐**，`apt install p7zip-full` 后即走 PATH）
  3. Windows 默认安装路径 `C:\Program Files\7-Zip\7z.exe`（仅本机兜底）

## 如何运行

> **M1 已完成**：把一个 `.chm` 转成可浏览的静态站。

```bash
# 1) 一步转换：解包 + 生成目录树 + 关键字 + 预览首页
node bin\cli.js convert 你的文档.chm 输出目录

# 2) 本地浏览（起静态服务）
node bin\cli.js serve 输出目录 8080
# 浏览器打开 http://localhost:8080/ ，左侧目录树可折叠，右侧预览正文

# 3) 其它命令
node bin\cli.js scan  输出目录            # 查看一个目录里有哪些 html/hhc/hhk
node bin\cli.js extract 你的文档.chm 输出目录   # 仅解包，不生成预览
```

npm 脚本对照：`npm run convert -- <chm> [outDir]`、`npm run serve -- <dir> [port]`、`npm test`（自测）。

**性能**：转换耗时几乎全部花在 7-Zip 解包上；常见 CHM（几十 KB ~ 几 MB、几十上百页）实测 **约 0.4 秒**，解析目录/关键字、生成页面均在毫秒级。

**转换产物（输出目录内）**：
- `index.html` — 主入口：左侧 `.hhc` 目录树 + 右侧正文 iframe
- `__chm_nav.html` — 独立目录树页
- `keywords.json` — 由 `.hhk` 生成的关键字表（供后期站内检索）
- 解包出来的真实 `.htm/.css` 等页面

整套产物是**纯静态文件**，可整包打 zip，或直接部署到任意静态托管平台（见《上传网页教程》）。

---

## 当前进度

- [x] 文档与规划（README / PLAN / HANDOFF）
- [x] **M1：CHM 解包 + 转静态 HTML**（7z 解包、目录树、关键字、预览站全部落地自测通过）
- [x] **M2：双端可浏览 + 可见性权限**（浏览 + 账号体系 + 公告/私密/分享链接，`test-auth.js` 全绿）
- [x] **M3：全库检索**（阅读壳单文档 + 欢迎页跨文档统搜；纯静态可托管）
- [x] **M4：批量 + 私有部署导出**（批量上传、整站导出 zip、选中多篇导出独立裸站 zip）

---

## License

免费 / 非营利公益项目，授权将在代码落地后明确。