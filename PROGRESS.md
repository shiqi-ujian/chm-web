# chm-web 开发进度与遇到问题记录（PROGRESS）

> 持续记录项目走到哪了、卡过什么、怎么解决的。后续接手直接看这篇，不必翻历史对话。

---

## 一、项目当前是什么

一个「CHM → 可浏览网页」的**动态后端驱动网站**：用户上传 `.chm` → Node 服务解包 → 转成静态可浏览文档 → 分享给他人。

- **非纯静态站**（前端要服务器收上传/转换），但「阅读产物」这层是纯静态 HTML（见 README 修正后的说明）。
- 定位免费 / 非营利 / 服务大众。

---

## 二、里程碑状态

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | CHM 解包 + 转静态 HTML | ✅ 已完成（7z 解包、.hhc 目录树、.hhk 关键字、阅读壳） |
| M2 | 双端可浏览 + 可见性权限 | ✅ 完成（浏览/手机抽屉 + **真实上传闭环 + 账号体系 + 可见性**：注册/登录/会话、公开免登录 / 私密仅 owner+分享链接、文档归属"我的"、可见性切换实体迁移、公开/私密标签） |
| M3 | 全库检索 | ✅ 完成（**目录树 + 关键字 + 单文档全文 + 欢迎页跨文档统搜**，纯静态可托管） |
| M4 | 批量 + 私有部署导出 | ✅ 完成（**前端批量上传 + 整站单包导出 + 选中多篇导出独立裸站 zip**：前端勾选「导出选中 zip」→ 后端 `GET /api/export-docs?ids=` → CLI `export-docs`；manifest.json；每包自带专属欢迎页 + 只含选中文档的 site-index.json） |
| 公网部署 | 迁至阿里云自建生产 | ✅ 已完成：生产环境从 Railway 迁移到阿里云服务器，`push → GitHub → 阿里云自动拉取部署`链路已验证。由 `HOST`/`PORT` 监听 + `UPLOAD_TOKEN`/`EXPORT_TOKEN`/`ADMIN_TOKEN` 访问令牌 + 持久数据目录（`CHM_SITE` / `CHM_DATA`，站点与数据分离）。访问密钥只放阿里云服务器环境变量 + 本机 `data/deploy-tokens.txt`（gitignore），不入库 |
| **P1·健壮与安全**（M5） | **稳定性 + 公共服务护栏** | **✅ 已完成一批**：原子写（临时文件+rename+重试，防崩溃损坏）、会话 30 天惰性过期清理、账号/上传/导出接口限流（滑动窗口）、每用户文档数/字节配额 + 全局存储上限、并发上传槽位（异步 7z 解包 + 超时 + 失败自动清理临时文件）、修复阅读壳/欢迎页**存储型 XSS**（搜索结果一律转义再高亮）、**移除烘焙进页面的 UPLOAD/EXPORT_TOKEN 明文**（改为已登录用户会话服务端校验）、新增服务端检索 `/api/search`（保留客户端静态回退）。新增 `test-quota / test-xss / test-search-api / test-atomic` 并接入 CI。SQLite 化 + FTS5 + 字符集归一化也已完成，`npm test` 15 项全绿 |
| M7 | 登录加固 + 移动端 + 合规 | ✅ 已完成：注册需邮箱+同意条款、邮箱验证、忘记/重置密码、失败锁定、CSRF；移动端优化（汉堡菜单、上传权利勾选、阅读壳适配）；新增 `terms/privacy/disclaimer/report.html`，举报入库 + 管理后台 `admin.html`（状态流转/下架）；测试 `test-auth-v2` 并入 `npm test`，15 项全绿 |
| M8·产品体验补强 | 首页改版 / SEO / 运维自愈 / 问题反馈闭环 | ✅ 已完成：首页公开文档区改为响应式卡片网格；全站加 SEO meta + OpenGraph；新增文档管理增强（重命名/作者/标签/用量）、批量操作（勾选导出/改公开/删除）、浏览页标签/作者筛选、上传失败重试、批量上传后直接打包下载；新增 `watchdog.sh` 探活（自动重启 + 连续失败 webhook/日志告警）、启动自检、旧库缺列崩溃修复；上线「问题反馈」流程：腾讯文档收集表读取桥 `tools/feedback-bridge/` + 全站入口（导航/抽屉/页脚）+ 自动处理工作流（定时读取→修复→发布→CHANGELOG 公示） |

---

## 三、已实现 / 当前可用

- `bin/cli.js` + `src/cli.js`：`convert / extract / scan / serve / export-site / export-docs / fix-charsets` 命令。
- `src/lib/chm.js`：7-Zip 解包 + 文件扫描（html/hhc/hhk 计数）。
- `src/lib/hhc.js`：解析 `.hhc` 目录树（嵌套 `<UL>/<OBJECT>`）→ 目录树。
- `src/lib/hhk.js`：解析 `.hhk` 关键字 → 扁平关键字列表（供检索）。
- `src/lib/preview.js`：生成阅读壳 `index.html`（桌面左目录右正文 / 手机汉堡抽屉 + 搜索过滤 + 当前章节高亮）。
- `src/lib/landing.js`：欢迎页（标题说明 + 上传入口 + 我的文档）。
- `src/lib/convert.js`：`convert()` + `buildSite()`（欢迎页 + 文档子目录组装）。
- `src/lib/serve.js`：零依赖 http 静态服务器。
- `src/lib/sanitize.js`：复制文档产物时剔除 CHM 内部 `#`/`$` 元数据文件。
- `src/lib/translations.js`：目录节点名中英对照（示例做了 7-Zip 手册）。
- `src/lib/upload.js`：上传→转换→存盘→更新索引 的完整管线（`processUpload`，支持公开/私密落盘）。
- `src/lib/auth.js`：账号体系 + 可见性 + 举报（注册/登录/会话 scrypt 哈希；文档元数据；私有/公开/分享链接 ACL；私有实体 `data/private/`；存储已 SQLite 化）。
- `src/lib/db.js`：SQLite（better-sqlite3，WAL）+ JSON→SQLite 一次性迁移；`users/sessions/meta/user_usage` + FTS5。
- `src/lib/quota.js`：限流 / 配额（`user_usage` 持久化）。
- `src/lib/search.js`：服务端检索（SQLite FTS5，相关性排序 + 高亮 + 分页）。
- `src/lib/mailer.js`：零依赖 SMTP 邮件发送（`SMTP_*`，缺省写 `logs/mailer.log`）。
- `src/server.js`：真实后端（静态托管 + 账号 API + `POST /api/upload` + `GET /api/docs`（按可见性过滤） + 私有文档 `/p/` 服务 + 分享 `/s/` 跳转 + 批量导出/整站导出 + 举报/管理接口 + `/api/search`）。
- `tools/feedback-bridge/`：腾讯文档收集表读取桥（定时把新问题读入本地 inbox，供 agent 自动处理）。
- `scripts/autosync.ps1` + `autosync_over.vbs`：计划任务「拉取+推送」自动同步（**不做自动提交**），失败留到下一轮。
- `scripts/launch-check.js` / `.deploy-tools/watchdog.sh`：启动自检 + 服务器探活（自动重启 + 连续失败 webhook/日志告警）。
- Git 已开启 GitHub Actions CI：每次 push 到 main 自动跑 15+ 项测试；阿里云生产由 `push → GitHub → 自动拉取`链路发布。

**线上**：生产为**阿里云服务器**（地址占位，不写入仓库）；GitHub Pages `https://shiqi-ujian.github.io/chm-web/` 仍作为静态阅读层示例/公开页使用。

---

## 四、遇到并已解决的问题

### 1. GitHub Pages 打开文档 404（已解决）
- 现象：首页能开，点"打开文档"进 GitHub 404。
- 根因：
  1. **文档子目录名 `__docs` 以双下划线开头** —— GitHub Pages（内置 Jekyll）默认忽略下划线开头目录/文件，`__docs/...` 线上不存在 → 404。
  2. 转换产物里混有 CHM 内部元数据 `#IDXHDR`、`$FIftiMain`、`$WWKeywordLinks` 等文件，`#`/`$` 在 URL 里特殊，也容易干扰。
- 解决：文档子目录改名 **`d/`**；新增 `sanitize.js` 剔除所有 `#/$` 开头的元数据。手动 serve 验证 `/d/7z-demo/` → 200。

### 2. 自动同步脚本误报"缺少对象 sh"（已解决）
- 现象：桌面/日志弹出「缺少对象 sh」。
- 根因：网络差时 git 失败会打印大量帮助文本，脚本将 git 输出当数组解析 `[int]` 抛错。
- 修复：`Invoke-Git` 按空格拆分参数组传递，失败只截取第一行 `fatal/error`；计数用只认纯数字的 `Get-GitCount`。

### 3. autosync 把整个 argv 当一个参数传给 git（已解决）
- 根因：`& git -C $Cwd $Git` 字符串整体传，git 报 "`fetch origin main` is not a git command"。
- 修复：`-split '\s+'` 成数组再 `@parts` 展开。

### 4. 中文乱码 / .ps1 读取（已解决）
- 现象：Windows PowerShell 5.1 读无 BOM 的 UTF-8 .ps1 中文乱码。
- 处理：脚本带 UTF-8 BOM。

### 5. 文档资源建模（过程的认知更正）
- 之前文档/README 把项目当"纯静态站"。实际是**动态后端 + 静态阅读产物**，已更新 README 的说法。

### 6. resolveSeven 候选解析 bug —— PATH 里无 7z 时兜底失效（已解决）
- 现象：winget 装好 7-Zip 26.02（默认**不进 PATH**）后 `node bin\cli.js convert` 报 `7z extract failed (null): undefined`。
- 根因：`chm.js resolveSeven()` 把第一个非绝对路径候选（如 `'7z'`）无条件返回，PATH 无 7z 时后续绝对路径兜底永远走不到。
- 修复：非绝对路径候选用 `spawnSync(c, ['i'], { stdio: 'ignore' })` 探测可用性，失败继续下一候选；绝对路径做 `existsSync` 预检。

### 7. 新工作区本机环境修复（2026-08-17）
- 安装 7-Zip 26.02（`winget install 7zip.7zip`），验证 `7z.exe` + 自带 `7-zip.chm` 样本。
- git 本地身份配置为 `qiujian.shi <qiujian.shi@ui-surgical.com>`。
- remote 改为 **`shiqi-ujian/chm-web.git`**，对齐到 `61afc9a`。
- e2e 可用 `CHM_SITE`/`CHM_DATA` 环境变量指向临时目录运行，避免污染 `docs/` 与仓库工作区。

### 8. M2 实现要点记录（账号 + 可见性，2026-08-17）
- **私有文档绝不落入公开静态产物**：public → `docs/d/<id>/`；private → `data/private/<id>/`（仅后端 `/p/<id>/` ACL serve）。
- **会话**：scrypt 哈希存用户；登录发 token 存 sessions，前端携带 `X-User-Token`，同时种 `chm_user` cookie。
- **可见性**：`meta` 记录 `{owner, visibility, shareToken}`；公开免登录、私密仅 owner + 分享链接。
- **实体迁移**：owner 切换可见性时实体在 `docs/d/` 与 `data/private/` 间搬移（`migrateDoc`）。
- **接口**：`POST /api/register|login|logout`、`GET /api/me`、`POST /api/doc/<id>/visibility|share`、`/api/docs`。
- 自测：`test-auth.js`（32 项）并入 `npm test`，全绿。

### 9. GBK 页面整页乱码（已解决，2026-08-18）
- 根因：页面是 GBK 但 `<meta>` 声明非法，且服务端没带 charset。
- 修复三处：转换管统一转 UTF-8；服务端按文件实际编码下发 charset；`fixlinks` 用 `readText` 字符集安全读写。
- 命令：`node bin/cli.js fix-charsets <dir>`。
- 自测：`test-charset.js` 新增回归项；当时 `npm test` 14 项全绿（后续新增 `test-auth-v2` 后为 15 项）。

### 10. 阿里云迁移完成（2026-08-19）
- 生产从 Railway 迁到阿里云，线上已搭好。
- 部署方式：`push 到 main → GitHub → 阿里云自动拉取/触发部署`；链路已验证。
- 运维资产归档 `.deploy-tools/`。

### 11. 登录加固 + 合规（已解决，当前 M7）
- 注册强制邮箱 / 同意条款；邮箱验证 / 忘记密码 / 重置密码；连续 5 次失败锁 10 分钟；CSRF 防护。
- 新增合规页 + 举报入库 + 管理后台 `admin.html` + 举报状态 API + 下架接口。
- 邮件走零依赖 SMTP 客户端（缺省写 `logs/mailer.log`）。

### 12. 旧库缺列启动崩溃（已解决，2026-08-19）
- 现象：旧库升级后服务启动崩溃。
- 根因：`email` 索引在补列之前创建，旧库缺列时 `ensureIndex` 直接抛错。
- 修复：把 `email` 索引移到补列之后创建；`test-db.js` 补旧库缺列升级回归用例。

### 13. 我的文档页整页 JS 失效（已解决，2026-08-19）
- 根因：`loadUsage` 调用少写一个右括号，导致整页脚本解析失败。
- 修复：补缺失括号；`test-site.js` 增加全页面脚本语法检查回归，防类似问题再发生。

### 14. 问题反馈自动处理工作流上线（2026-08-19/20）
- 群友在腾讯文档收集表提交问题 → `tools/feedback-bridge/` 定时读取进本地 inbox → agent 自动 debug / 修复 / 发布 → `CHANGELOG.md` 公示。
- 同步上线全站「问题反馈」入口（导航 / 抽屉 / 页脚）。
- 注意：`问题收集/`、`tools/feedback-bridge/config.json`、共享登录 profile、`feedback-state.json` 均在 .gitignore，严禁提交（公开仓库）。

---

## 五、仍待办 / 下一步

- [x] 公网真实部署上线（阿里云迁移）
- [x] P1 稳健/安全批处理
- [x] M7 登录加固 + 移动端 + 合规
- [x] M8 产品体验补强 + 问题反馈闭环（首页卡片 / SEO / 文档管理增强 / watchdog / feedback-bridge）
- [x] 转换完成整批自动打包下载（M4 可选增强）——批量上传后直接打包下载已实现
- [ ] 正文中文翻译（需外部服务/预算评估）
- [ ] autosync 在多台设备上的部署说明
- [ ] PROGRESS/README/HANDOFF 按最新线上与功能状态持续归档（有更新随提交补）

---

## 六、技术备忘 / 关键文件

```
src/lib/
  chm.js	7z 解包 + 扫描（异步 spawn + 超时）
  hhc.js	.hhc 目录树解析
  hhk.js	.hhk 关键字解析
  landing.js	多页前端模板（index/browse/upload/mine/terms/privacy/disclaimer/report/admin + site-index.json）
  zip.js	零依赖 zip 打包器
  site-export.js	整站导出（含 manifest.json）
  upload.js	上传→转换→存盘→重建索引
  convert.js	convert() + buildSite()
  serve.js	零依赖静态服务器
  sanitize.js	剔除 CHM 内部 #/$ 元数据
  translations.js	目录名中英对照
  auth.js	账号/会话/可见性/举报
  db.js	SQLite(better-sqlite3, WAL) + JSON→SQLite 一次性迁移
  quota.js	限流/配额（user_usage 持久化）
  search.js	服务端检索（SQLite FTS5）
  mailer.js	邮件发送（SMTP_*）
```

**运行**：`node bin/cli.js convert 文件.chm 输出目录`；`node bin/cli.js serve 输出目录 8080`；`npm test` 自测。