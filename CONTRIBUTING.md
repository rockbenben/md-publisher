# 开发 md-publisher

面向想改代码、排查问题或从源码运行的人。只想**使用**这个工具请看 [README](README.md) 与[使用说明](usage.md)。

## 环境要求

| 用途 | Node.js | 其他 |
| --- | --- | --- |
| 运行 CLI / GUI | `>= 18` | Chrome / Edge 等 Chromium 内核浏览器（Windows 自带 Edge） |
| 构建前端（`web:build`） | `^20.19.0 \|\| >=22.12.0` | — |
| 桌面应用开发与打包 | `>= 22.12.0` | Electron 44 的硬性下限 |

## 目录结构

```text
md-publisher/
├── src/
│   ├── index.js          # CLI 入口
│   ├── gui.js            # GUI 服务器（Express + SSE + CSP + Origin 校验）
│   ├── gui-utils.js      # GUI 纯工具函数（路径校验、ANSI 清洗、设置白名单）
│   ├── browser.js        # Playwright 浏览器管理（CDP 连接、剪贴板粘贴）
│   ├── config.js         # 平台配置与超时设定
│   ├── parser.js         # Frontmatter 解析与文件扫描
│   ├── fork-bridge.js    # Electron utilityProcess 握手 / 退出桥
│   ├── platforms/        # 各平台发布模块
│   └── public/           # GUI 构建产物（由 web/ 构建，含平台图标）
├── web/                  # GUI 前端源码（React + TS + antd 6 + Vite）
├── electron/             # Electron 桌面应用（主进程 / 托盘 / 预载 / 监管）
├── test/                 # 单元测试（node --test）
├── e2e/                  # Electron 冒烟测试
├── brand/                # 品牌资产（logo 源文件 / social card HTML + PNG / 自带字体与图标）
├── build/                # 应用图标（electron-builder 资源）
├── docs/                 # 首屏截图
├── .github/workflows/    # CI（tag 构建三平台安装包）
├── tools/                # 一次性脚本（首屏截图重拍）
├── usage.md              # 详细使用说明
├── eslint.config.js      # ESLint flat config
├── user-data/            # 浏览器持久化数据（登录态，gitignore）
├── settings.json         # GUI 用户设置（gitignore）
└── .uploads/             # GUI 上传文件暂存（gitignore）
```

## 命令

```bash
npm run web:install   # 首次：安装前端依赖（web/ 有自己的 package.json）
npm run web:dev       # 开发：Vite 热更新，API/SSE 自动代理到 9870（需另开 npm run gui）
npm run web:build     # 构建：tsc 校验 + 打包到 src/public/
npm test              # 单元测试（解析、转换、工具函数）
npm run lint          # ESLint 检查 Node 端源码（src/ electron/ test/ e2e/ brand/）
npm run lint:fix      # 同上，自动修可机械修复的问题
npm run check         # lint + 单元测试
npm run electron:dev  # 桌面应用：构建前端后启动 Electron
npm run test:e2e      # Electron 冒烟测试（需桌面会话，会真实启动应用）
npm run dist          # 打包当前系统的桌面安装包到 release/（三平台由 CI 各自构建）
```

> `npm test` 只跑 `test/` 下的单元测试；`npm run test:e2e` 会真正拉起 Electron，未包含在 `npm run check` 里，改动 `electron/` 或打包配置后请手动跑一次。

## 技术选型

| 领域 | 技术 |
| --- | --- |
| 浏览器自动化 | Playwright（连系统 Chrome，CDP，自动授予剪贴板权限） |
| CLI 交互 | @inquirer/prompts |
| GUI 服务 | Express + SSE 实时推送（仅监听本机回环，CSP + Origin 校验） |
| GUI 前端 | React 19 + TypeScript + Ant Design 6 + Vite（深度定制主题） |
| 桌面应用 | Electron + electron-builder（托盘常驻，Windows/macOS/Linux 安装包） |
| Markdown 解析 | js-yaml（frontmatter）+ marked（HTML 转换） |
| 跨平台 | 自动适配修饰键（macOS Cmd / Win & Linux Ctrl）、系统通知、路径 |
| 静态检查 | ESLint（`src/` `electron/` `test/` `e2e/` `brand/`）+ tsc（前端） |

CLI 与服务端为纯 ESM，无打包；GUI 前端经 Vite 构建为静态产物随仓库分发。字体经 `@fontsource` 本地打包，离线可用、不依赖 CDN。

## 改代码前要知道的几件事

这些约束在代码里看不出来，写错会静默出问题：

- **`src/public/` 是入库的构建产物。** 改了 `web/` 下的任何东西，都要跑 `npm run web:build` 并把 `src/public/` 一起提交，否则安装包里的界面还是旧的。
- **GUI 服务无鉴权，且暴露面很大** —— 能读文件、发布文章、关闭应用。因此它只监听回环地址并校验 `Origin`；不要在没意识到后果的情况下放宽 `HOST`。
- **各平台的选择器依赖平台 DOM，改版后会静默失效**，表现为"报成功但没填进去"。新增平台逻辑前先读 [AGENTS.md](AGENTS.md) 里的平台选择器一节。
- **X 平台的 `replaceMarkers` 按位置配对图片与占位符**，`insertImage` 因此会校验图片数量确实增长后抛错 —— 这个校验不要删。

更完整的清单见 [AGENTS.md](AGENTS.md)。

## 品牌资产

logo、社交预览图、应用图标、托盘图标都由 **html-shot** 技能渲染，仓库内没有对应的生成脚本（曾经有一份手工复刻，已删除）。重新生成的命令见 [AGENTS.md](AGENTS.md#brand-assets-are-rendered-by-the-html-shot-skill-not-by-a-local-script)。

首屏截图用 `node tools/capture-hero.mjs <一个装了几篇 .md 的目录> docs/images/hero.png [publish|settings]` 重拍。
