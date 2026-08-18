# CHM 网页工作交接文档

> 说明：本文件用于 **CHM 网页工作区的新对话** 无需阅读本历史对话即可接手。目标、路线图、决策与验收标准均已记录在案。

---

## 一、项目定位（先读我）

**免费 · 非盈利 · 服务大众** 的静态站点：用户上传 `.chm` → 转成双端可浏览、可搜索的页面；上传者设为**私密（仅自己和被分享者可见）或公开**；后期支持逐章检索；最终支持**批量私有部署导出**。

### 核心原则
1. **不收费**。本项目是公益/免费产品，服务费来自域名/托管/维护，不在功能上设付费墙。
2. **P0 = 核心闭环**；可见性/批量导出是**加分项而非收费理由**——定位为“**免费 + 完整**”，并非“收费：私密”。

---

## 二、技术选择与架构

| 模块 | 选型 | 理由 |
|------|------|------|
| 运行环境 | `Node.js + TypeScript`(或纯 JS) | 无框架依赖、起静态服务方便 |
| CHM 解包 | `7z` / `mspack` / `chmlib`(解析 ITSF + LZX) | 现成开源、免造轮子 |
| 解包产物 | 静态 HTML + `.hhc` 目录树 + `.hhk` 关键字 | 7-zip 直接解出 |
| 双端体验 | 移动端/桌面端均用**响应式 HTML**，不引传统 CHM 浏览器 | 移动端只做“可读可搜”，桌面端再做“批量/部署” |
| 可见性 | 私密/公开/指定链接可见 → 登录态 + 邀请链接 | 简单 ACL |
| 全文检索 | 先做目录检索，再加 `lunr.js` / `FlexSearch` | 静态站也可以搜 |
| 批量私有部署 | **导出产物 → 打 zip / jekyll 静态站** | **后期核心价值点** |

## 三、里程碑（MVP 是最下层）

### M1 — CHM 解包 + 转静态 HTML（地基）
- 输入 `.chm` → 输出 同名目录(内嵌 HTML + `.hhc` + `.hhk`)
- 用 7-Zip 校验解包产物结构正确
- 能正确画出 `.hhc` 目录树
- 记录 `.hhk` 关键字，后续“站内搜索”用
- 验收：`a.chm` → `a/` 目录可浏览首页

### M2 — 双端可浏览 + 可见性权限 ✅ 已完成
- 移动端/桌面端起本地静态服务，可翻页浏览
- 用户态与“可见性”绑定：**私密/公开/指定链接**（注册/登录/会话 `src/lib/auth.js` + `POST /api/register|login|logout`，scrypt 哈希）
- 上传条目挂在“我的上传”下，带公开/私密标签（`X-User-Token` / `chm_user` cookie，owner 可设公开/私密、复制分享链接）
- 验收：手机浏览器能打开子页面，公开条目免登录可见，私密条目需特定链接可见 ✅（`test-auth.js` 32 项全绿，含分享 `/s/`、实体迁移 `migrateDoc`、越权 403）

### M3 — 全库检索（搜索）✅ 已完成
- 目录树检索（基于 `.hhc`）
- 单文档全文检索（`.hhk` 关键字 + 基于 `.htm` 的浏览器端全文索引，`search-index.json`）
- **跨文档 / 全站统搜**（欢迎页 `site-index.json` 聚合索引，一个框搜所有文档）
- 验收：搜到 CHM 内页标题/关键字，手机端可用 ✅

### M4 — 批量 + 私有部署（真正的“付费线”）✅ 已完成
- 支持**一个/多个** CHM 批量上传（多选/拖拽 + 逐个上传进度）
- “打包下载 / 导出为站点” = zip/静态站点：整站导出（`/site-export.zip` / CLI `export-site`）+ 选中多篇导出独立裸站 zip（`/api/export-docs` / CLI `export-docs`，含 `manifest.json`）
- 部署物：根 `Dockerfile`（Railway 直用）+ `deploy/`（Docker / systemd / Caddy 示例）
- 验收：选中多个 CHM，一次转换后能整包导出为 zip/静态站点 ✅

### M5 — 健壮与安全（P1 公共服务护栏）✅ 已完成
- **稳定性**：状态文件原子写（临时文件 + rename + 短退避重试，防崩溃/瞬时占用损坏）、会话 30 天惰性过期清理、并发上传槽位（`MAX_CONCURRENT_UPLOADS`）+ 异步 7z 解包（`src/lib/chm.js` 改 `spawn`）+ 超时 + 失败自动清理临时文件（`cleanupTmp`）。
- **限流/配额（`src/lib/quota.js`）**：账号/上传/导出接口滑动窗口限流（`RATE_AUTH_MAX`/`RATE_UPLOAD_MAX`/`RATE_EXPORT_MAX`）；每用户文档数/字节配额（`MAX_USER_DOCS`/`MAX_USER_BYTES`）+ 全局存储上限（`MAX_GLOBAL_BYTES`）。
- **安全**：
  - 修复阅读壳/欢迎页**存储型 XSS**：`renderResults`/`hl`/欢迎页搜索输出一律先 `esc()` 再环绕 `<mark>` 高亮，杜绝把文档标题/正文当 HTML 执行。
  
  - **移除烘焙进页面的 `UPLOAD_TOKEN`/`EXPORT_TOKEN` 明文**（此前后台源码可 `view-source` 拿到密钥致防护失效）。现改为：公网下上传/导出要求「请求带有效 token 或 已登录会话（同源 cookie）」，由服务端校验；未配置 token 时保持不锁（本地/离线兼容）。欢迎页不再注入任何密钥。
  - **检索**：新增服务端 `/api/search`（`src/lib/search.js`：在线走 **SQLite FTS5** 相关性排序+高亮+分页；文档多时更稳）；欢迎页在线时优先走 API，纯静态/离线 zip 回退本地 `site-index.json`。
  - 新增 `test-quota / test-xss / test-search-api / test-atomic / test-db`，`npm test` 跑全 13 项。
  - **存储层（better-sqlite3，WAL，`src/lib/db.js`）**：`users/sessions/meta` 与配额 `user_usage` 从 JSON+原子写迁移到 SQLite；首次打开自动一次性迁移并备份 `.bak.<ts>`（可回滚）；检索灌入 FTS5 虚拟表。**注意**：`better-sqlite3` 是 native 依赖，已给 CI/Railway/Docker/systemd 补编译工具链 + `npm install`。
**部署注意（M5）**：以上环境变量均为可选；除非在 Railway 变量与本地 `data/deploy-tokens.txt` 里同时设置，否则默认不开启配额/限流上限（保持免费易用）。部署令牌仍只放 Railway Variables + 本机 gitignore 文件，**不要写入页面源码**。

---

## 四、字符集乱码修复（2026-08-18 已解决）

**现象**：`/d/<id>/#城主指南2024/Credits.htm` 等页面打开后中文全变 `????`/方块。

**根因**：页面是 **GBK 编码**，但 `<meta>` 声明写成了非法形式 `<meta content="text/html; charset=gb2312">`（无 `http-equiv` 也无 `charset` 属性），浏览器不认；服务端又没带 charset 头 → 按 UTF-8 解码 → 乱码。

**修复（三处）**：
1. **转换管线转 UTF-8**：`src/lib/charset.js#normalizeCharsets(dir)` 把解包出的 html/css/hhc/hhk 全部按实际字符集转 UTF-8 并重写为合法 `<meta charset="utf-8">`；`convert.js convert()` 与 `upload.js convertOne()` 已接入（先转码再 fixlinks）。
2. **服务端按文件下发 charset**：`server.js` 与 `serve.js` 对 html 用 `sniffFileCharset(file)` 探测并追加 `; charset=...` —— **存量 GBK 文档升级代码后即可正常显示，无需重新转换**。
3. **fixlinks 字符集安全**：读用 `readText`（按实际编码）、写回 UTF-8，避免 GBK 二次乱码。

**修复存量文档**：`node bin/cli.js fix-charsets <docDir>` 原地转 UTF-8；或直接重新上传 `.chm`（新转换自动转 UTF-8）。自测：`test-charset.js` 新增回归项，`npm test` 全绿。

---

## 开发顺序（建议）

1. **P0·跑通**：`7z` 解一个 CHM → 起静态服务 → 手机能开 → **约 3~5 天**
2. **P1·目录+搜索**：解析 **hhc/hhk** → 页面搜索 → **约 3~7 天**
3. **P2·可见性 + 账号**：登录态、私密/公开链接、主体 → **约 5~10 天**
4. **P3·批量导出/部署**：批处理 + 生成静态站点/zip（**真正的球门**）→ **约 7~14 天**

> **总计（单人业余）：约 3~6 周**。如果 90% 走基础（解包+静态托管），大约 2~3 周就能上线 MVP。

---

## 成本估算（当前阶段）

| 项目 | 方式 | 成本 |
|------|------|------|
| 域名 | 可先用你自己的 / 免费 `*.pages.dev` | ¥0（先期） |
| 托管 | GitHub Pages / Cloudflare Pages / 自有小服务器 | ¥0 ~ ¥20/月 |
| 解包 | 用 7-Zip / `mspack` | ¥0（一次性开源） |
| 存储 | 解包后都是 KB 级小文件 | 几乎可忽略 |
| 搜索 | 目录（hhc）= 静态；全文搜索进阶 | 初期 ¥0，后续如需可加 |
| **批量私有部署导出** | 自己生成 zip/静态站点 | **主要人工成本（你的维护时间）** |

**一句话结论：如果是个人 + 静态 + 基础托管，成本 ≈ 0 元/月；花钱主要在“批量/导出/私有部署”这些让你真正省事的功能上。**

---

## 关键风险与你的把握

| 这个计划里“站得住”的 | 真正会“烧钱”的 |
|----------------|----------------|
| 上传→解包→浏览（pc+手机） | 批量/导出/私有部署 |
| 公开/私密可见性 | 全文搜索 |
| 目录保留 | 长期维护（你自己的时间） |

---

## 新电脑/工位开发上手（5 分钟）
1. **clone + 装环境**：`git clone https://github.com/shiqi-ujian/chm-web.git`；装 **Node.js ≥ 22** 和 **7-Zip**（转换/测试必需）；然后 **`npm install`**（项目已引入 native 依赖 `better-sqlite3`，其 v13 需要 Node ≥ 22）。
2. **配置 git 身份**（仓库不随 push 带身份，新机器必须配）：
   ```bash
   git config user.name "qiujian.shi"
   git config user.email "qiujian.shi@ui-surgical.com"
   ```
3. **自测**：`npm test`（本机 Windows 自动用 7-Zip 自带 chm；CI 用 `samples/7-zip.chm`；跑 13 项含 SQLite `test-db`）。本地快速验证也可：
   `node test-serve.js docs/d/7-zip` 等（见 `.github/workflows/test.yml` 里的命令序列）。
4. **push 即自动测**：GitHub Actions 会在每次 push 跑全部 13 项测试，红了先看 CI 报错再提交。
5. **上线部署**：
   - 平时：push 到 main → Railway 自动部署（约 1-2 分钟）。
   - GitHub 异常/webhook 失效时：装 Railway CLI（`npm i -g @railway/cli`）→ `railway login`（浏览器授权）→ `railway redeploy --from-source -y`。
6. **敏感信息**：部署令牌 `UPLOAD_TOKEN`/`EXPORT_TOKEN` 只在本机 `data/deploy-tokens.txt`（gitignored）和 Railway 变量里；新机器如需手动部署，从 Railway 项目 Variables 里复制（勿提交进仓库）。
7. **提交纪律**：保持单 `main` 直推（单人项目）；提交信息用 `feat:/fix:/docs:/deploy:` 前缀；`data/`、`out/`、`logs/`、`.dsh-vision-toolkit/` 永不提交。

---

## 最后，我一开始的建议

1. **先做 P0 (MVP)**：`7z` 解一个 CHM → 起个静态服务 → 手机能开：真正体验“核心闭环”。
2. **再做可见性**：公开/私密 + 分享链接（快速见效的部分）。
3. **把“批量导出/私密部署”做成卖点**，那才是别人没法免费拿走的部分。

要不要我接着写：任何一批工程的 `PLAN.md` 阶段里程碑、验收标准都直接拿过去，还是你指了一个更具体的方向？我可以接着往下推。

好——你桌面，已经准备好了**开发文件夹**。按上面那一版`PLAN.md`，我们现在就有、按阶段上马的东西了。
