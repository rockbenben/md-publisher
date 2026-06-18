# md-publisher

> Markdown 一稿多发 —— 一次编写，自动填充到多个内容平台。

基于 Playwright 浏览器自动化：工具打开各平台编辑器、自动填写标题与正文，**你只需检查后点击「发布」**。提供命令行（CLI）和 Web 图形界面（GUI）两种模式。

## 目录

- [md-publisher](#md-publisher)
  - [目录](#目录)
  - [特性](#特性)
  - [支持平台](#支持平台)
  - [快速开始](#快速开始)
  - [使用](#使用)
    - [CLI 模式](#cli-模式)
    - [GUI 模式](#gui-模式)
      - [启动脚本](#启动脚本)
      - [环境变量](#环境变量)
  - [文章格式](#文章格式)
    - [字段说明](#字段说明)
    - [封面图逻辑](#封面图逻辑)
    - [其他](#其他)
  - [项目配置](#项目配置)
  - [登录](#登录)
  - [开发与构建](#开发与构建)
  - [项目结构](#项目结构)
  - [技术栈](#技术栈)

## 特性

- **6 大内容平台 + X** —— 少数派、知乎、微信公众号、什么值得买、掘金、X (Twitter)
- **多篇 × 多平台** —— 一次选择多篇文章和多个平台，批量自动填充
- **两种操作模式** —— 命令行交互或 Web 图形界面，按需选择
- **智能内容适配** —— 按各平台编辑器自动处理：原文粘贴 / 转富文本 / 转 HTML
- **封面图自动设置** —— 优先用 frontmatter `cover` 字段，否则自动提取正文首图作为封面（支持格式转换与压缩）。带裁剪的平台可选自动确认或留给手动裁切
- **提示语法转换** —— GitHub `> [!NOTE]` 等提示框语法自动转换为 emoji 标签（公众号除外）
- **代码块内容安全** —— 标题、封面、提示语法的识别均会跳过代码块，文档中的语法示例原样保留
- **登录状态持久化** —— 首次登录后自动保存，后续无需重复操作
- **项目级配置** —— `.md-publisher.yml` 预设平台、分类、标签，团队共享发布策略
- **发布可取消** —— GUI 模式支持发布过程中随时取消
- **全平台兼容** —— Windows / macOS / Linux，提供各系统快捷启动脚本

## 支持平台

| 平台        | 标识     | 自动操作                                                    | 封面 |
| ----------- | -------- | ----------------------------------------------------------- | ---- |
| 少数派      | `sspai`  | 填写标题 → 粘贴 Markdown → 触发格式转换 → 设置封面          | ✓    |
| 知乎        | `zhihu`  | 填写标题 → 粘贴 Markdown → 自动解析 → 设置封面              | ✓    |
| 微信公众号  | `wechat` | Markdown 转富文本 → 填写标题/摘要 → 粘贴内容 → 上传设置封面 | ✓    |
| 什么值得买  | `smzdm`  | 填写标题 → Markdown 转 HTML 后粘贴 → 上传长图封面           | ✓    |
| 掘金        | `juejin` | 填写标题 → 粘贴 Markdown 原文 → 发布抽屉内上传封面          | ✓    |
| X (Twitter) | `x`      | 填写标题 → 粘贴富文本 → 上传图片/代码块 → 设置封面          | ✓    |

> 工具完成内容填充后会保持页面打开，由你检查内容并手动点击各平台的「发布」按钮。

需要其他平台支持？欢迎到 [GitHub](https://github.com/rockbenben/md-publisher) 提 Issue 或在文章下方留言。

## 快速开始

**前置要求：** Node.js >= 18，且系统已安装 Chrome 浏览器。

```bash
git clone https://github.com/rockbenben/md-publisher.git
cd md-publisher
npm install
npx playwright install chromium
```

安装完成后，选择 [CLI](#cli-模式) 或 [GUI](#gui-模式) 任一模式使用即可（GUI 构建产物已随仓库提供，无需额外构建）。

## 使用

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

流程：选择文章 → 选择平台 → 确认 → 自动填充 → 检查后按 Enter 关闭浏览器。

默认会将首图设为封面并从正文移除；加 `--keep-cover-img` 参数可保留正文首图。

### GUI 模式

```bash
npm run gui
```

自动打开浏览器访问 `http://localhost:9870`，提供自定义主题的 Web 界面（暖纸配色 + 朱砂印章风格）：

- 选择文件或扫描目录，勾选文章和目标平台
- 一键发布，实时查看进度和日志，支持中途取消
- 一键检测各平台登录状态和用户名，快速打开任意平台进行手动操作
- 封面自动确认、正文去除首图（可配置，设置自动保存）
- 关闭浏览器释放资源（仅关闭自动化 Chrome，不影响本页面）
- 设置持久化（文章目录、默认平台、封面选项等）

#### 启动脚本

也可双击启动脚本直接运行 GUI（日志输出到 `md-publisher.log`）：

| 文件            | 系统    | 说明                   |
| --------------- | ------- | ---------------------- |
| `start.bat`     | Windows | 命令行窗口启动         |
| `start.vbs`     | Windows | 静默启动（无黑窗）     |
| `start.sh`      | Linux   | 后台启动，终端显示 PID |
| `start.command` | macOS   | 双击启动，窗口自动关闭 |

#### 环境变量

| 变量      | 说明                        | 默认值 |
| --------- | --------------------------- | ------ |
| `PORT`    | GUI 服务端口                | `9870` |
| `NO_OPEN` | 设为 `1` 跳过自动打开浏览器 | —      |

详细操作指南见 [使用说明](usage.md)。

## 文章格式

标准 Markdown 文件，文件开头使用 YAML frontmatter 声明元数据。下面是一篇较完整的样例：

```markdown
---
title: 我的文章标题
description: 文章摘要，公众号会自动填入摘要栏（可选）
date: 2026-06-18
cover: https://example.com/cover.png # 封面图：网络 URL 或本地路径（可选）
category:
  - 技术
tag:
  - Markdown
  - 效率
---

正文从这里开始，支持标准 Markdown 语法。

> [!NOTE]
> GitHub 风格的提示语法会自动转换为 emoji 标签（公众号除外）。

![题图](./images/hero.png)

其余正文内容……
```

### 字段说明

| 字段          | 必填 | 说明                                                            |
| ------------- | ---- | --------------------------------------------------------------- |
| `title`       | 否\* | 文章标题，自动填入各平台标题栏                                  |
| `description` | 否   | 文章摘要，公众号自动填入摘要栏                                  |
| `date`        | 否   | 发布日期                                                        |
| `cover`       | 否   | 封面图地址，支持网络 URL 或本地路径（相对路径相对文章文件解析） |
| `category`    | 否   | 分类，字符串或数组；文章 frontmatter 优先于项目配置             |
| `tag`         | 否   | 标签，字符串或数组；文章 frontmatter 优先于项目配置             |

> \* `title` 省略时自动取正文第一个一级标题（`# 标题`），都没有则用文件名。

### 封面图逻辑

- **优先级：** frontmatter 的 `cover` 字段 > 正文第一张图片
- 未设 `cover` 时，自动提取正文首图作为封面（自动支持 webp/gif 转 JPEG、超 5MB 压缩）
- **封面自动确认（autoCover）：** 带裁剪步骤的平台（微信、少数派、什么值得买、X）开启时自动完成裁剪确认，关闭时只上传封面、保留裁剪弹窗交给手动裁切；知乎、掘金无裁剪步骤，不受影响
- 「正文去除首图」开启且**未设 `cover`** 时，被用作封面的正文首图会从正文中移除以避免重复；一旦设置了 `cover`，正文图片原样保留
- 代码块内的图片、标题、提示语法均会被识别逻辑跳过，原样保留

### 其他

- **支持的扩展名：** `.md` `.markdown` `.mdown` `.mkd` `.mkdn` `.mdwn` `.mdx` `.txt`
- **自动跳过：** `README.md` `CHANGELOG.md` `LICENSE.*`，以及 `node_modules/` `user-data/` 等隐藏目录

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

GUI 模式下可点击「检测登录」按钮，并行检测所有平台的登录状态与用户名。

## 开发与构建

> 仅在修改界面时需要；普通使用无需构建。

GUI 前端源码在 `web/`（React 19 + TypeScript + Ant Design 6 + Vite），构建产物输出到 `src/public/`，由 Express 直接托管。字体经 `@fontsource` 本地打包，离线可用、不依赖 CDN。

```bash
npm run web:install   # 首次：安装前端依赖
npm run web:dev       # 开发：Vite 热更新，API/SSE 自动代理到 9870（需另开 npm run gui）
npm run web:build     # 构建：tsc 校验 + 打包到 src/public/
npm test              # 运行单元测试（解析、转换、工具函数）
```

## 项目结构

```text
md-publisher/
├── src/
│   ├── index.js          # CLI 入口
│   ├── gui.js            # GUI 服务器（Express + SSE）
│   ├── browser.js        # Playwright 浏览器管理
│   ├── config.js         # 平台配置与超时设定
│   ├── parser.js         # Frontmatter 解析与文件扫描
│   ├── platforms/        # 各平台发布模块
│   └── public/           # GUI 构建产物（由 web/ 构建，含平台图标）
├── web/                  # GUI 前端源码（React + TS + antd 6 + Vite）
├── test/                 # 单元测试
├── usage.md              # 详细使用说明
├── user-data/            # 浏览器持久化数据（登录态）
├── settings.json         # GUI 用户设置
├── .uploads/             # GUI 上传文件暂存
└── start.*               # 各系统快捷启动脚本
```

## 技术栈

| 领域          | 技术                                                           |
| ------------- | -------------------------------------------------------------- |
| 浏览器自动化  | Playwright（系统 Chrome，有头模式，自动授予剪贴板权限）        |
| CLI 交互      | @inquirer/prompts                                              |
| GUI 服务      | Express + SSE 实时推送                                         |
| GUI 前端      | React 19 + TypeScript + Ant Design 6 + Vite（深度定制主题）    |
| Markdown 解析 | gray-matter（frontmatter）+ marked（HTML 转换）                |
| 跨平台兼容    | 自动适配修饰键（macOS Cmd / Win & Linux Ctrl）、系统通知、路径 |

CLI 与服务端为纯 ESM，无打包；GUI 前端经 Vite 构建为静态产物随仓库分发。

---

_如果这个工具帮你节省了时间，欢迎在 GitHub 上点个 Star。_
