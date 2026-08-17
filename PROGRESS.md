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
| M2 | 双端可浏览 + 可见性权限 | 🔶 部分完成（可浏览/手机抽屉目录 + **真实上传闭环已通**；**可见性、账号未做**） |
| M3 | 全库检索 | ✅ 完成（**目录树 + 关键字 + 单文档全文 + 欢迎页跨文档统搜**，纯静态可托管） |
| M4 | 批量 + 私有部署导出 | ✅ 完成（**前端批量上传 + 整站单包导出 + 选中多篇导出独立裸站 zip**：前端勾选「导出选中 zip」→ 后端 `GET /api/export-docs?ids=` → CLI `export-docs`；manifest.json；每包自带专属欢迎页 + 只含选中文档的 site-index.json） |
| Rails部署 | 接正式后端（B 形态） | 🟡 进行中：已加 `HOST` 监听 + `UPLOAD_TOKEN`/`EXPORT_TOKEN` 访问令牌开关（不设则不锁）；`7zz` 候选；`deploy/` 脚手架（Dockerfile / systemd / Caddy 示例）+ 根 `Dockerfile`/`.dockerignore` 供 Railway 直接用 |

---

## 三、已实现 / 当前可用

- `bin/cli.js` + `src/cli.js`：`convert / extract / scan / serve` 命令。
- `src/lib/chm.js`：7-Zip 解包 + 文件扫描（html/hhc/hhk 计数）。
- `src/lib/hhc.js`：解析 `.hhc` 目录树（嵌套 <UL>/<OBJECT>）→ 目录树。
- `src/lib/hhk.js`：解析 `.hhk` 关键字 → 扁平关键字列表（供检索）。
- `src/lib/preview.js`：生成阅读壳 `index.html`（桌面左目录右正文 / 手机汉堡抽屉 + 搜索过滤 + 当前章节高亮）。
- `src/lib/landing.js`：欢迎页（标题说明 + 上传入口 + 我的文档）。
- `src/lib/convert.js`：`convert()` + `buildSite()`（欢迎页 + 文档子目录组装）。
- `src/lib/serve.js`：零依赖 http 静态服务器。
- `src/lib/sanitize.js`：复制文档产物时剔除 CHM 内部 `#`/`$` 元数据文件。
- `src/lib/translations.js`：目录节点名中英对照（示例做了 7-Zip 手册）。
- `src/lib/upload.js`：上传→转换→存盘→更新"我的文档"索引 的完整管线（`processUpload`）。
- `src/server.js`：真实后端（静态托管 + `POST /api/upload` + `GET /api/docs` + 批量导出/整站导出接口）。
- `scripts/autosync.ps1` + `autosync_run.vbs`：计划任务「拉取+推送」自动同步（**不做自动提交**），失败留到下一轮。
- GitHub Pages 已启用，仓库 `chm-web`（公开），文档放 `docs/` 目录。

**线上**：https://shiqi-ujian.github.io/chm-web/ （欢迎页 → 我的文档 → 打开 7-Zip 手册）。

---

## 四、遇到并已解决的问题

### 1. GitHub Pages 打开文档 404（已解决）
- 现象：首页能开，点"打开文档"进 GitHub 404。
- 根因有两层：
  1. **文档子目录名 `__docs` 以双下划线开头** —— GitHub Pages（内置 Jekyll）默认忽略下划线开头目录/文件，`__docs/...` 线上不存在 → 404。（本地 serve 不忽略，所以本地正常、线上不行。）
  2. 转换产物里混有 CHM 内部元数据 `#IDXHDR`、`$FIftiMain`、`$WWKeywordLinks` 等文件，污染部署还有 `#`/`$` 特殊字符（在 URL 里是保留字符），也可能干扰。
- 解决：文档子目录改名 **`d/`**（非下划线开头）；新增 `sanitize.js` 剔除所有 `#/$` 开头的元数据。手动 serve 验证 `/d/7z-demo/` → 200。

### 2. 自动同步脚本误报"缺少对象 sh"（已解决）
- 现象：桌面/日志弹出「缺少对象 sh」，形如报错。
- 根因：网络差时 git 失败会打印一大段帮助文本（含 `show`/`sh` 等命令名），脚本把 git 输出当数组解析 `[int]` 抛错/误报。
- 修复：`Invoke-Git` 改为按空格拆参数组传递（`@argsArr`），失败只截取第一行 `fatal/error`；计数用 `Get-GitCount` 只认纯数字。

### 3. autosync 把整个 argv 当一个参数传给 git
- 根因：`& git -C $Cwd $Git` 字符串整体传，git 报 "`fetch origin main` is not a git command"。
- 修复：`-split '\s+'` 成数组再 `@parts` 展开。实测网络差时已能干净报告 "Could not connect"，不再误读。

### 4. 中文乱码 / .ps1 读取
- 现象：Windows PowerShell 5.1 读无 BOM 的 UTF-8 .ps1 中文乱码，导致语法错。
- 处理：脚本保存为**带 UTF-8 BOM**。

### 5. /docs 资源建模（过程中的认知更正）
- 之前文档/README 把项目当"静态站"。实际是**动态后端 + 静态阅读产物**，已更新 README 的说法。

### 6. resolveSeven 候选解析 bug —— PATH 里无 7z 时兜底失效（已解决）
- 现象：winget 装好 7-Zip 26.02（默认**不进 PATH**）后，`node bin\cli.js convert` 报 `7z extract failed (null): undefined`。
- 根因：`chm.js resolveSeven()` 候选列表 `[SEVENZ, '7z', '7za', '7zz', 默认路径]` 中，第一个非绝对路径候选（`'7z'`）被**无条件立即返回**（`return c`），后面的绝对路径兜底永远走不到；本机 PATH 无 7z → `spawnSync` ENOENT → `status=null`。
- 修复：非绝对路径候选改用 `spawnSync(c, ['i'], { stdio: 'ignore' })` 探测可用性（`status===0` 才采用），失败继续下一个候选；绝对路径仍做 `existsSync` 预检。
- 验证：`npm test` 6 项全过（SERVE / HHC / FULLTEXT / SITE / ZIP / EXPORT_DOCS），`e2e-test.js` 上传闭环 200 + 新文档可访问。

### 7. 新工作区本机环境修复（2026-08-17）
- 安装 7-Zip 26.02（`winget install 7zip.7zip`），验证 `7z.exe` + 自带 `7-zip.chm` 样本。
- git 本地身份配置为 `qiujian.shi <qiujian.shi@ui-surgical.com>`（此前本地+全局均未配置，提交会失败）。
- remote 从 `YinJinDao/shiqi-ujian-chm-web.git` 改到 **`shiqi-ujian/chm-web.git`**（线上 GitHub Pages 实际源仓库），rebase 对齐到 `61afc9a`（M3 搜索 / M4 导出 / Railway 部署全量并入）。
- 顺带确认：`.tmp_7-zip` 标题泄漏、欢迎页清单缺 `id`、e2e/vbs 硬编码路径等问题在远程 `68fb5d5` 已修复，本地无需重复。
- e2e 可用 `CHM_SITE`/`CHM_DATA` 环境变量指向临时目录运行，避免污染 `docs/` 与仓库工作区。

---

## 五、仍待办 / 下一步

- [ ] **公网真实部署上线**：本地上传闭环已验证可用，待接 Railway / 自有服务器（部署后设 `UPLOAD_TOKEN` / `EXPORT_TOKEN` + 持久盘）。
- [ ] **账号 + 可见性**（M2 剩余）：私密/公开/分享链接，「我的上传」列表。属于需要后端的账号体系。
- [ ] **转换完成整批自动打包下载**（M4 可选增强）：目前是「逐个转换入库 → 勾选导出」；可再加「一次批量上传即直接打包整批下载」。
- [ ] 正文中文翻译：目录树已中文化；正文目前是原文（7-Zip 手册全部英文）。
- [ ] autosync 在多台设备上的部署说明。

---

## 六、技术备忘 / 关键文件

```
src/lib/
  chm.js        7z 解包 + 扫描
  hhc.js        .hhc 目录树解析
  hhk.js        .hhk 关键字解析
  preview.js    阅读壳(index.html) + 目录/关键字/全文检索 + search-index.json
  landing.js    欢迎页(index.html) + 全站聚合检索 site-index.json
  zip.js        零依赖 zip 打包器（STORE + DEFLATE）
  site-export.js  整站导出（含 manifest.json）：exportSite()/collectFiles()/exportDocs()/aggregateSiteIndex()
  convert.js    convert() + buildSite()
  serve.js      零依赖静态服务器
  sanitize.js   剔除 CHM 内部 #/$ 元数据
  translations.js  目录名中英对照
scripts/
  autosync.ps1      自动同步(拉取+推送，不自动提交)
  autosync_run.vbs  隐藏启动 autosync.ps1
 docs/          站点/发布产物（GitHub Pages 根）
```
（另 `test-export-docs.js`：选中多篇导出独立裸站 zip 的自测，随 `npm test` 跑。）

**运行**：`node bin/cli.js convert 文件.chm 输出目录`；`node bin/cli.js serve 输出目录 8080`；`npm test` 自测。