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
| M2 | 双端可浏览 + 可见性权限 | 🔶 部分完成（可浏览/手机抽屉目录；**可见性、账号、上传真实闭环未做**） |
| M3 | 全库检索 | ◻️ 未开始（目录树搜索已在壳里临时内联，全库检索未做） |
| M4 | 批量 + 私有部署导出 | ◻️ 未开始 |

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
- `scripts/autosync.ps1` + `autosync_hidden.vbs`：计划任务「提交+拉取+推送」自动同步，失败留到下一轮。
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

---

## 五、仍待办 / 下一步

- [ ] **真实上传闭环**：把欢迎页「上传」按钮接到真实后端。需要一台能跑 Node + 7z 的服务器（约 ¥50/月档）——当前按钮只提示"服务器即将开放"。
- [ ] **账号 + 可见性**（M2 剩余）：私密/公开/分享链接，「我的上传」列表。属于需要后端的账号体系。
- [ ] **M3 搜索**：把目录树检索完善 + 全库关键字检索（现在 `keywords.json` 已生成）。
- [ ] **M4 批量 + 私有导出**：一次多个 CHM、打包 zip/静态站点。
- [ ] 正文中文翻译：目录树已中文化；正文目前是原文（7-Zip 手册全部英文）。
- [ ] autosync 在多台设备上的部署说明。

---

## 六、技术备忘 / 关键文件

```
src/lib/
  chm.js        7z 解包 + 扫描
  hhc.js        .hhc 目录树解析
  hhk.js        .hhk 关键字解析
  preview.js    阅读壳(index.html)
  landing.js    欢迎页(index.html)
  convert.js    convert() + buildSite()
  serve.js      零依赖静态服务器
  sanitize.js   剔除 CHM 内部 #/$ 元数据
  translations.js  目录名中英对照
scripts/
  autosync.ps1      自动同步(commit+pull+push)
  autosync_hidden.vbs  隐藏启动
 docs/          站点/发布产物（GitHub Pages 根）
```

**运行**：`node bin/cli.js convert 文件.chm 输出目录`；`node bin/cli.js serve 输出目录 8080`；`npm test` 自测。