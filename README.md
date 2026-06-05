# XuYa Terminal

> 面向 AI Agent 工作流的原生终端工作台。
> 基于 Tauri v2、React 19、TypeScript 与 Rust 构建，重点优化 Windows PTY、中文界面、AI 编程会话和代理商配置体验。

当前版本：`0.1.5`

## 项目状态

XuYa Terminal 正在活跃开发中，当前主要面向 Windows 桌面环境和 AI 编程工作流。项目已接入 GitHub Releases 自动更新，欢迎提交 Issue、功能建议、文档改进和 Pull Request。

## 核心特性

- 原生桌面终端：使用 Tauri v2 与 Rust 管理 PTY，会话启动轻量、资源占用低。
- 多标签与分屏：基于 Dockview 提供终端标签、分屏、侧边栏会话列表和命令面板。
- AI Agent 快捷会话：内置 Claude Code、Codex、OpenCode 快捷启动项。
- AI 配置中心：在应用内配置 Claude Code 与 Codex 的官方、内置和自定义代理商。
- 代理商快速切换：Claude Code / Codex 会话底部状态栏可直接切换代理商。
- 额度查询：支持展示余额、剩余额度、已用额度与周限制额度，并每分钟自动刷新。
- 当前标签热重启：切换代理商后只重启当前 Agent 标签页，不刷新整个应用。
- 终端增强：支持复制拦截、右键菜单、文件拖拽路径输入、剪贴板图片粘贴和 diff 背景对齐优化。
- 中文主题系统：内置中文命名的深浅色主题，并针对终端 ANSI 对比度做了精调。
- 自动更新：通过 Tauri updater 从 GitHub Releases 检查、下载和安装更新。

## 安装

前往 GitHub Releases 下载最新 Windows 安装包：

```text
https://github.com/xuya-dev/XuYa-Terminal/releases/latest
```

当前发布流程会生成 Windows NSIS / MSI 安装包与 updater 所需的 `latest.json`。已安装客户端可在“关于”页面检查更新。

## 本地开发要求

推荐环境：

- Windows 10 / Windows 11
- Node.js 22+
- pnpm 10+
- Rust stable toolchain
- Tauri v2 开发环境

参考文档：

- Tauri 前置环境：https://v2.tauri.app/start/prerequisites/
- Rust 安装：https://www.rust-lang.org/tools/install
- pnpm 安装：https://pnpm.io/installation

## 快速开始

克隆仓库：

```bash
git clone https://github.com/xuya-dev/XuYa-Terminal.git
cd XuYa-Terminal
```

安装依赖：

```bash
pnpm install
```

启动 Tauri 开发环境：

```bash
pnpm tauri dev
```

仅构建前端：

```bash
pnpm run build
```

检查 Rust 工作区：

```bash
cargo check
```

格式化 Rust 代码：

```bash
cargo fmt
```

打包桌面应用：

```bash
pnpm tauri build
```

## AI Agent 集成

默认会话菜单包含：

- PowerShell
- CMD
- Claude Code
- Codex
- OpenCode

点击 Agent 会话后，XuYa Terminal 会在当前 PTY 中自动写入并执行对应命令，避免 Windows 终端中需要二次手动回车的问题。

### Claude Code

Claude Code 配置写入：

```text
~/.claude/settings.json
```

支持的代理商类型：

- 官方登录
- 内置代理商：ZhiPu GLM、MiniMax、Kimi、DeepSeek、XiaoMi Mimo
- 自定义代理商：可保存名称、端点、API Key 和模型信息

Claude Code 支持分别配置 Opus、Sonnet、Haiku 角色模型。内置代理商的兜底模型默认保持为空，避免覆盖角色模型的显式配置。

### Codex

Codex 配置写入：

```text
~/.codex/config.toml
~/.codex/auth.json
```

XuYa Terminal 只管理自己生成的 Codex provider 配置块，并尽量保留用户手写的其他配置。Codex 自定义代理商默认使用 Responses API 路径。

### 自定义代理商存储

自定义代理商保存到本地 SQLite 数据库：

```text
~/.xuya/agent-providers.sqlite
```

该文件可能包含 API Key，请按敏感本地数据处理，不要公开分享。

## 额度查询

当当前标签是 Claude Code 或 Codex 会话时，底部状态栏会展示代理商选择器和额度状态。

当前支持：

- 内置代理商根据端点自动识别额度接口。
- 自定义代理商默认不自动识别，可手动选择 `Sub2API` 或 `New API`。
- New API 支持额外配置 Access Token 与用户 ID。
- 可展示余额、剩余额度、已用额度和周限制额度。
- 若接口没有返回已用额度，则只展示剩余额度。
- 状态栏每分钟自动刷新额度。
- 切换代理商后会重启当前 Agent 标签页，让 `claude` / `codex` 重新加载最新配置。

## 终端能力

- 多标签、多分屏终端布局。
- 标签重命名、关闭和右键菜单。
- 终端上下文菜单：复制、粘贴、全选、清除选择。
- 复制快捷键优化：有选区时复制文本，无选区时保留 shell 中断行为。
- 文件拖拽：拖入终端后自动输入带引号的文件路径。
- 图片粘贴：为 Claude Code / Codex / OpenCode 适配剪贴板图片或文件路径输入。
- 状态栏展示 shell、运行时间、当前目录、编码、换行符和缩放控制。
- 当前目录可点击并在系统文件资源管理器中打开。

## 主题系统

XuYa Terminal 提供中文优先的深浅色主题，并持续调整终端 ANSI 色彩对比度。代表性主题包括：

- 极光冰川 / Aurora Glacier
- 赤焰霞光 / Crimson Sunset
- 青木幽谷 / Forest Moss
- 紫黛漫步 / Lavender Mist
- 水墨丹青 / Ink Brush

## 项目结构

```text
.
├── src/                         # React 前端
│   ├── components/              # 应用外壳、终端、弹窗和 UI 组件
│   ├── lib/                     # Agent、会话和面板工具函数
│   ├── stores/                  # Zustand 状态管理
│   ├── themes.ts                # 主题定义
│   └── index.css                # 全局样式
├── src-tauri/                   # Tauri 应用 crate
│   ├── src/commands.rs          # Tauri 命令、PTY 与本地配置逻辑
│   ├── src/main.rs              # Tauri 入口
│   ├── src/state.rs             # 共享状态
│   ├── capabilities/            # Tauri 权限配置
│   └── tauri.conf.json          # 桌面应用配置
├── crates/
│   ├── xuya-core/               # Rust 共享类型
│   └── xuya-pty/                # PTY 启动、Shell 解析与 IO
├── docs/
│   └── auto-update.md           # 自动更新与发布说明
├── CHANGELOG.md
├── CONTRIBUTING.md
├── Cargo.toml
└── package.json
```

## 技术栈

前端：

- React 19
- TypeScript
- Vite
- Zustand
- Dockview React
- xterm.js
- lucide-react
- `@lobehub/icons`

后端：

- Tauri v2
- Rust workspace
- `portable-pty`
- `rusqlite`
- `reqwest`

## 提交前检查

提交 Pull Request 前建议至少运行：

```bash
pnpm run build
cargo check
git diff --check
```

如果修改了 Rust 代码，请同时运行：

```bash
cargo fmt
```

## 发布流程

版本号需要同步更新：

- `package.json`
- 根目录 `Cargo.toml` 的 workspace version
- `Cargo.lock`
- `src-tauri/tauri.conf.json`
- `CHANGELOG.md`

版本标签使用 `v*` 格式，例如：

```bash
git tag v0.1.5
git push origin v0.1.5
```

推送 `v*` 标签会触发 GitHub Actions 发布流程，自动构建 Windows 安装包并生成 updater 所需的发布文件。更多细节见 [docs/auto-update.md](docs/auto-update.md)。

## 隐私与本地数据

XuYa Terminal 会读写本机 Agent 配置文件，不依赖远端服务保存代理商配置。

常见本地路径：

```text
~/.claude/settings.json
~/.codex/config.toml
~/.codex/auth.json
~/.xuya/agent-providers.sqlite
```

这些文件可能包含 API Key、Access Token 或其他敏感信息，请不要提交到公开仓库或发送给他人。

## 贡献

欢迎贡献代码、主题、文档和问题反馈。开始前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

适合参与的方向：

- 终端兼容性与 PTY 行为优化
- AI 代理商集成
- 额度查询解析适配
- 主题对比度与可访问性
- 文档与发布流程改进

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
