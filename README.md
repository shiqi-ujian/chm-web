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
- [x] 支持一个 / 多个 CHM 批量上传（多选 / 拖拽 + 逐个上传汇总）
- [x] 批量 / 选中导出为 zip / 静态站点（勾选若干文档 → 「导出选中 zip」→ `GET /api/export-docs` → CLI `export-docs`）
- **验收**：选中多个 CHM，一次转换后整包导出为 zip / 静态站点 ✅

### M5 — 阿里云自建部署（生产上线）✅ 已完成
- [x] **迁移完成**：生产环境已从 Railway 迁到自有**阿里云服务器**，线上闭环已搭好。
- [x] **部署方式**：`push 到 main → GitHub → 阿里云自动拉取部署`（链路已用临时验证文件实测通过）。
- [x] **运维资产**：`.deploy-tools/` 提供 SSH 助手、Docker 部署脚本、systemd 服务、每日备份等脚本；`Dockerfile` 可直接构建生产镜像。
- [x] **持久化**：站点与数据统一放在持久卷，`CHM_SITE` 与 `CHM_DATA` 分离，重启不丢上传 / 账号 / 私密文档。
- [x] **性能与体验（2026-08-20 晚）**：大文档性能（hhc 线性化、惰性目录树、rename 迁移、异步重建、gzip+缓存）、邮箱验证闭环、SMTP 修复、私有导出 ACL。

### M6 — 登录加固 + 移动端 + 合规（✅ 已完成）
- [x] 注册强制邮箱 + 同意条款；邮箱验证；忘记/重置密码；失败锁定；CSRF；举报/管理后台。
- [x] 2026-08-20 晚补强：未验证邮箱禁止登录 + 验证链接自动登录。

### M7 — 私密搜索/分享/性能收尾（✅ 已完成，2026-08-20）
- [x] 私密文档全文搜索、「我的文档」分享链接有效期/查看/撤销。
- [x] 私有阅读壳 `/p/` 前缀 + URL 归一化；移动端体验第二批。
- [x] 大文档性能：hhc 线性化（20s→17ms）、目录惰性渲染、rename 迁移、异步重建、gzip+缓存。
- [x] 邮件：SMTP 三连坑修复、`SMTP_FROM_NAME` 发件显示名、QQ SMTP 实测；私有文档导出 ACL 安全修复。

---

## 生产部署（阿里云）🚀

> 当前线上真实部署已经是**阿里云服务器**。生产访问地址：`<你的域名/IP>` 或 `<服务器公网地址>`（按需替换，不写入仓库）。
> 历史 Railway 部署只作早期验证用途，已下线 / 不再作为生产说明。

### 发布流程（日常工作流）

```bash
# 本地改动提交后直接推送
git add -A
git commit -m "feat: ..."
git push origin main
```

推送成功后，服务器侧（阿里云）会自动拉取代码 / 触发部署。  
> 提交信息保持 `feat:` / `fix:` / `docs:` / `chore:` 前缀。

### 生产必需/推荐环境变量

| 变量 | 必需/推荐 | 说明 |
|---|---|---|
| `UPLOAD_TOKEN` | 生产推荐 | 上传接口访问令牌 |
| `EXPORT_TOKEN` | 生产推荐 | 导出接口访问令牌 |
| `ADMIN_TOKEN` | 推荐 | 管理后台/举报下架接口令牌 |
| `PUBLIC_BASE_URL` | 推荐 | 邮件里验证/重置链接的完整公网前缀 |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`/`SMTP_SECURE` | 推荐 | 真实发信；未配置时回退 `logs/mailer.log` |
| `SMTP_FROM_NAME` | 可选 | 发件显示名；RFC2047 编码后收件人看到「CHM 网页 \<addr\>」而非裸地址 |
| `RATE_AUTH_MAX`/`RATE_UPLOAD_MAX`/`RATE_EXPORT_MAX`/`RATE_SEARCH_MAX` | 可选 | 接口限流阈值 |
| `MAX_GLOBAL_BYTES`/`MAX_USER_DOCS`/`MAX_USER_BYTES` | 可选 | 存储配额 |
| `NO_CAPTCHA` | 仅本地/测试 | 置 `1` 跳过注册算术题人机校验；生产不要设置 |

> 生产环境**不要设 `NO_CSRF=1` / `NO_CAPTCHA=1`**；本地/测试才关闭。

### 服务器目录约定（来自 .deploy-tools/）

| 项目 | 路径 / 值 |
|---|---|
| 应用目录 | `/root/app`（阿里云实际部署目录） |
| 数据卷 / 数据根 | `/var/chm-web/data` |
| 站点内容 | `/var/chm-web/data/site`（欢迎页 + 公开文档） |
| 数据区 | `/var/chm-web/data/data`（账号 / 元数据 / 私密文档） |
| 运行方式 | Docker 容器 `chm-web` 或 systemd（以服务器实际配置为准） |
| 镜像 | `chm-web:latest` |
| 对外端口 | `3000`（按实际反向代理调整） |

> 这些值以服务器真实配置为准；如果阿里云上已调整路径，请同步更新 `.deploy-tools/` 中的脚本。

### 运维命令

```bash
cd .deploy-tools
bash deploy.sh status    # 查看容器/服务状态（Docker 方式）
bash deploy.sh logs       # 查看日志
bash deploy.sh restart     # 重启
bash deploy.sh stop        # 停止
# 若服务器用 systemd：sudo systemctl status/restart chm-web
```

不用 Docker、直接用 systemd 时，参考 [deploy/chm-web.service](deploy/chm-web.service) 安装服务；`.deploy-tools/chm-web.service` 是面向 `/root/app` 的阿里云 systemd 示例。

### 重要提醒：访问令牌

生产环境必须设置 `UPLOAD_TOKEN` / `EXPORT_TOKEN` / `ADMIN_TOKEN`（服务器环境变量或 systemd 环境）：
- `UPLOAD_TOKEN` → 上传接口校验（`POST /api/upload`）
- `EXPORT_TOKEN` → 导出接口校验（`/site-export.zip`、`/api/export-docs`）
- `ADMIN_TOKEN` → 管理后台 / 举报处理 / 文档下架接口校验（`/admin/*`）
- 密钥只放服务器环境 / 本机 gitignore 文件，绝不写入页面源码或提交仓库。

---

## 用 Docker 构建生产镜像（可选，本地复现）

根目录 `Dockerfile` 即生产镜像（Node 22 + 7-Zip + better-sqlite3）：

```bash
docker build -t chm-web .
docker run -d --name chm-web \
  -p 8080:8080 \
  -e UPLOAD_TOKEN=xxx \
  -e EXPORT_TOKEN=xxx \
  -v chm-data:/app/data \
  chm-web
```

更简版：不设置 `UPLOAD_TOKEN` / `EXPORT_TOKEN` 时后端保持“不锁”，适合本地调试。

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
├─ tools/           # 开发辅助脚本（重建壳/索引，非生产代码）
│  ├─ rebuild-docs.js     # 重建 docs/d 下所有文档的壳 + 索引
│  ├─ rebuild-landing.js  # 重建欢迎页（应用 landing.js 改动）
│  └─ rebuild-shells.js   # 重建所有文档阅读壳 index.html
├─ .deploy-tools/   # 阿里云运维脚本（deploy/backup/systemd/ssh）
├─ src/
│  ├─ cli.js        # convert / extract / scan / serve / fix-charsets 命令
│  └─ lib/
│     ├─ chm.js      # 7-Zip 解包 + 扫描
│     ├─ hhc.js      # 解析 .hhc 目录树
│     ├─ hhk.js      # 解析 .hhk 关键字
│     ├─ charset.js  # 字符集检测 / 归一化（GBK→UTF-8）
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

- **Node.js** ≥ 22（生产与 CI 均用 Node 22；native 依赖 `better-sqlite3` v13 需要 Node ≥ 22）
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
node bin\cli.js fix-charsets 输出目录     # 存量文档乱码修复：把 GBK 页面统一转 UTF-8（重写 charset 声明）
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
- [x] **P1·健壮与安全**（公共服务护栏）：
  - 稳定性：**原子写**（临时文件+rename+重试，防崩溃损坏）、会话 30 天过期清理、账号/上传/导出**限流 + 每用户/全局配额**、并发上传槽位（**异步 7z 解包 + 超时 + 失败自动清理临时文件**）。
  - 安全：修复阅读壳/欢迎页**存储型 XSS**（搜索结果一律转义再高亮）；**移除烘焙进页面的 `UPLOAD_TOKEN`/`EXPORT_TOKEN` 明文**，改为已登录会话由服务端校验。
  - 检索：凡是有后端时欢迎页搜索自动走**服务端 `/api/search`**（在线走 **SQLite FTS5** 相关性排序+高亮+分页；文档多时更稳），纯静态/离线 zip 仍回退到本地 `site-index.json` 客户端索引。
  - 新增 `test-quota / test-xss / test-search-api / test-atomic / test-db / test-auth-v2` 并全绿；`npm test` 覆盖全部 15 项（含 `test-charset`）。
  - **SQLite 化（better-sqlite3，WAL）**：`users/sessions/meta` 与配额 `user_usage` 迁移到 SQLite，一次性 JSON→迁移并备份 `.bak.<ts>`；检索灌入 FTS5 虚拟表。
  - **字符集归一化**：解包后所有 html/css/hhc/hhk 按实际字符集转 UTF-8 并重写为合法 `<meta charset="utf-8">`（`charset.js#normalizeCharsets`），服务端对 html 按文件实际编码下发 charset 头（`sniffFileCharset`），修复 GBK 中文 CHM 整页乱码；`fix-charsets` 命令可修复存量文档。
- [x] **M5：阿里云自建部署**：生产环境已完成从 Railway 到阿里云的迁移，`push → GitHub → 阿里云自动拉取`链路已验证，`.deploy-tools` 运维脚本与持久化方案已就绪。
- [x] **M6：登录加固 + 移动端 + 合规**：注册强制邮箱与同意条款、邮箱验证、忘记/重置密码、登录失败锁定、CSRF 防护、移动端汉堡菜单与上传勾选、terms/privacy/disclaimer 合规页、举报与管理员下架接口；新增 `admin.html` 管理页；`npm test` 15 项全绿。
- [x] **M7+：私密搜索/分享/性能收尾（2026-08-20）**：私密文档全文搜索与分享链接有效期/撤销；私有阅读壳 `/p/` 前缀 + URL 归一化；移动端体验第二批；大文档性能（hhc 线性化、目录惰性渲染、rename 迁移、异步重建、gzip+缓存）；邮箱验证强制登录 + SMTP 修复与 `SMTP_FROM_NAME`；私有导出 ACL 安全修复；未验证邮箱禁止登录 + 验证链接自动登录。
- [x] **M7b：注册/账号体系补强（2026-08-21）**：登录支持邮箱/用户名；注册人机校验（算术题 + `NO_CAPTCHA` 测试开关）；重发验证邮件 60s 冷却；修改绑定邮箱（改后重验）；自助注销账号（软删 + 清理会话/用量/文档）；「我的文档」新增账号设置入口；`npm test` 全绿。

## 后续优化方向（P2，按需推进）

1. **批量上传即打包**：一次多选上传后直接打整批 zip 下载（当前是逐个入库→勾选导出）。
2. **上传流式化（可选）**：改用 `busboy` 流式接收大文件。
3. **正文中文翻译**：涉及外部服务/预算，单独评估。
4. **autosync 多设备部署说明**。

---

## License

免费 / 非营利公益项目，授权将在代码落地后明确。
