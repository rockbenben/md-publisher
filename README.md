# md-publisher

Markdown 文章批量分发工具 —— 一次编写，自动填充到多个内容平台。

基于 Playwright 浏览器自动化，工具会打开各平台编辑器并自动填写标题和内容，你只需检查后点击发布。支持 CLI 和 Web GUI 两种操作模式。

## 特性

- **6 大内容平台 + X** —— 少数派、知乎、微信公众号、什么值得买、掘金、X (Twitter)
- **多篇 × 多平台** —— 一次选择多篇文章和多个平台，批量自动填充
- **两种操作模式** —— 命令行交互或 Web 图形界面，按需选择
- **智能内容适配** —— 根据各平台编辑器自动处理：原文粘贴 / 转富文本 / 转 HTML
- **封面图自动设置** —— 少数派、知乎、X 自动提取首图作为封面并上传（支持格式转换与压缩）
- **Callout 语法支持** —— GitHub `> [!NOTE]` 等提示语法自动转换为 emoji 标签（微信除外）
- **登录状态持久化** —— 首次登录后自动保存，后续无需重复操作
- **项目级配置** —— `.md-publisher.yml` 预设平台、分类、标签，团队共享发布策略
- **发布可取消** —— GUI 模式支持发布过程中随时取消
- **全平台兼容** —— Windows / macOS / Linux，提供各系统快捷启动脚本

## 支持平台

| 平台        | 标识     | 自动操作                                            | 封面 |
| ----------- | -------- | --------------------------------------------------- | ---- |
| 少数派      | `sspai`  | 填写标题 → 粘贴 Markdown → 触发格式转换 → 设置封面  | ✓    |
| 知乎        | `zhihu`  | 填写标题 → 粘贴 Markdown → 自动解析 → 设置封面      | ✓    |
| 微信公众号  | `wechat` | Markdown 转富文本 → 填写标题/摘要 → 粘贴内容         | —    |
| 什么值得买  | `smzdm`  | 填写标题 → Markdown 转 HTML 后粘贴                   | —    |
| 掘金        | `juejin` | 填写标题 → 粘贴 Markdown 原文                        | —    |
| X (Twitter) | `x`      | 填写标题 → 粘贴富文本 → 上传图片/代码块 → 设置封面  | ✓    |

> 工具完成内容填充后会保持页面打开，由你检查内容并手动点击各平台的「发布」按钮。

如果你需要其他平台的支持，欢迎到 [GitHub](https://github.com/rockbenben/md-publisher) 提 Issue 或在文章下方留言。

## 快速开始

**前置要求：** Node.js >= 18、系统已安装 Chrome 浏览器

```bash
git clone https://github.com/rockbenben/md-publisher.git
cd md-publisher
npm install
npx playwright install chromium
```

### CLI 模式

```bash
# 扫描当前目录，交互式选择文章和平台
npm start

# 发布单篇文章
node src/index.js article.md

# 发布目录下所有文章（递归扫描子目录）
node src/index.js ./my-posts/

# 在文章目录中直接运行（自动扫描 .md 文件）
cd ~/blog/posts && npm start --prefix /path/to/md-publisher
```

CLI 完整流程：选择文章 → 选择平台 → 确认 → 自动填充 → 检查后按 Enter 关闭浏览器。

CLI 默认会将首图设为封面并从正文移除，添加 `--keep-cover-img` 参数可保留正文首图。

### GUI 模式

```bash
npm run gui
```

自动打开浏览器访问 `http://localhost:9870`，提供暗色主题 Web 界面：

- 选择文件或扫描目录，勾选文章和目标平台
- 一键发布，实时查看进度和日志，支持中途取消
- 一键检测各平台登录状态和用户名
- 封面自动确认、正文去除首图（可配置，设置自动保存）
- 关闭浏览器释放资源（仅关闭自动化 Chrome，不影响本页面）
- 设置持久化（文章目录、默认平台、封面选项等）

也可通过启动脚本直接运行 GUI（日志输出到 `md-publisher.log`）：

| 文件            | 系统    | 说明                   |
| --------------- | ------- | ---------------------- |
| `start.bat`     | Windows | 命令行窗口启动         |
| `start.vbs`     | Windows | 静默启动（无黑窗）     |
| `start.sh`      | Linux   | 后台启动，终端显示 PID |
| `start.command` | macOS   | 双击启动，窗口自动关闭 |

**环境变量：**

| 变量      | 说明                        | 默认值 |
| --------- | --------------------------- | ------ |
| `PORT`    | GUI 服务端口                | `9870` |
| `NO_OPEN` | 设为 `1` 跳过自动打开浏览器 | —      |

详细操作指南见 [使用说明](usage.md)。

## 文章格式

标准 Markdown 文件，文件开头使用 YAML frontmatter 声明元数据：

```markdown
---
title: 文章标题
description: 文章摘要（可选，公众号自动填入摘要栏）
category:
  - 分类一
tag:
  - 标签一
  - 标签二
---

正文内容...
```

**必填字段：** `title`

**分类/标签优先级：** 文章 frontmatter 中的 `category`/`tag` 优先于项目配置中的同名字段。

**支持的扩展名：** `.md` `.markdown` `.mdown` `.mkd` `.mkdn` `.mdwn` `.mdx` `.txt`

**自动跳过：** `README.md` `CHANGELOG.md` `LICENSE.*` 及 `node_modules/` `user-data/` 隐藏目录

完整字段说明见 [使用说明 — 文章格式](usage.md#文章格式)。

## 项目配置

在文章目录下创建 `.md-publisher.yml`，可预设发布参数：

```yaml
platforms:
  - sspai
  - zhihu
  - juejin
category:
  - 技术
tag:
  - Markdown
  - 效率
```

CLI 和 GUI 都会自动读取该配置，预选平台并填充分类/标签。详见 [使用说明 — 项目配置](usage.md#项目配置)。

## 登录

首次使用时工具打开浏览器并提示手动登录，通过终端提示音和系统通知多重提醒。登录状态保存在 `user-data/` 目录中，后续自动复用。

GUI 模式下可点击「检测登录」按钮并行检测所有平台的登录状态。

## 项目结构

```yaml
md-publisher/
├── src/
│   ├── index.js          # CLI 入口
│   ├── gui.js            # GUI 服务器（Express + SSE）
│   ├── browser.js        # Playwright 浏览器管理
│   ├── config.js         # 平台配置与超时设定
│   ├── parser.js         # Frontmatter 解析与文件扫描
│   ├── platforms/        # 各平台发布模块
│   └── public/
│       └── index.html    # GUI 单页应用
├── usage.md              # 详细使用说明
├── user-data/            # 浏览器持久化数据（登录态）
├── settings.json         # GUI 用户设置
├── .uploads/             # GUI 上传文件暂存
└── start.*               # 各系统快捷启动脚本
```

## 技术栈

- **浏览器自动化：** Playwright（系统 Chrome，有头模式，剪贴板权限自动授予）
- **CLI 交互：** @inquirer/prompts
- **GUI 服务：** Express + SSE 实时推送
- **Markdown 解析：** gray-matter（frontmatter）+ marked（HTML 转换）
- **跨平台兼容：** 自动适配修饰键（macOS Cmd / Windows & Linux Ctrl）、系统通知、路径分隔符
- **零构建：** 纯 ESM，无 TypeScript，无打包

---

_如果这个工具帮你节省了时间，欢迎在 GitHub 上点个 Star。_
