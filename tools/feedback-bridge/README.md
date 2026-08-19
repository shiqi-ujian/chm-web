# 腾讯文档收集表 → 问题收集箱 读取桥（chm-web）

群友通过腾讯文档收集表提交问题；本桥定时把新提交读入 `问题收集/inbox/`，由 agent（主会话 dsh-schedule 定时唤醒）自动 debug、修复、发布，并在 `CHANGELOG.md` 公示。

## 一次性设置

1. **创建收集表**：打开 [docs.qq.com](https://docs.qq.com) → 新建「收集表」，字段（与 5z 表单一致，保证读取桥列映射可用）：
   - 昵称（选填）
   - 页面/功能（如 `上传` / `阅读页` / `搜索` / `导出` / `登录注册`）
   - 问题标题
   - 问题描述
   - 期望行为
   - 复现步骤（选填）
   - 截图（选填）
2. **填配置**：把收集表「结果/表格」页地址填进本目录 `config.json` 的 `formResultUrl`（已从 example 复制一份，等待填写）。
3. **登录一次**：双击本目录 `login-docs.bat`，在弹出的 Edge 里用 QQ 登录 docs.qq.com，登录后关窗。登录态保存在共享 profile（`E:\yingren\_feedback-shared\docs-profile`），4AD 与 chm-web 共用，只需登录一次。
4. 把收集表填写链接发到 QQ 群 / 放到网站合适位置。

## 使用

```bash
node tools/feedback-bridge/collect-docs.mjs            单次读取（写入 问题收集/inbox/）
node tools/feedback-bridge/collect-docs.mjs --probe    校准：dump 表格结构
node tools/feedback-bridge/collect-docs.mjs --login    有头打开登录页（一次性登录）
node tools/feedback-bridge/collect-docs.mjs --manual   导入 问题收集/manual/ 下的 CSV/XLSX
node tools/feedback-bridge/collect-docs.mjs --serve    常驻轮询（watch-collect 调用）
```

处理规程见同目录 `维护手册.md`。
