# XuYa Terminal

> 面向 AI Agent 工作流的原生终端工作台。
> 基于 Tauri v2、React 19、TypeScript 与 Rust 构建，重点优化 Windows PTY、中文界面、AI 编程会话和代理商配置体验。

当前版本：`1.0.1`

## 项目状态

XuYa Terminal 正在活跃开发中，当前面向 Windows、macOS 和 Linux 桌面环境与 AI 编程工作流。项目已接入 GitHub Releases 自动更新，欢迎提交 Issue、功能建议、文档改进和 Pull Request。

## 核心特性

- **AI 内置智能体**：基于 Vercel AI SDK 构建的完整 AI Agent 系统，支持工具调用、文件编辑、Shell 执行、代码搜索等。
- **多模型支持**：内置 30+ 模型，支持 OpenAI、Anthropic、Google、DeepSeek、智谱、MiniMax、Kimi、小米 MiMo 等 17 个服务商。
- **原生桌面终端**：使用 Tauri v2 与 Rust 管理 PTY，会话启动轻量、资源占用低。
- **代码编辑器**：集成 CodeMirror 6，支持多语言语法高亮、Vim 模式、多主题。
- **文件浏览器**：完整的文件树，支持搜索、重命名、上下文操作。
- **Git 集成**：完整的 Git 面板，支持 status、diff、commit、push、pull、history。
- **AI Agent 快捷会话**：内置 Claude Code、Codex、Open Code 快捷启动项。
- **AI 配置中心**：在应用内配置 Claude Code 与 Codex 的官方、内置和自定义代理商。
- **代理商快速切换**：Claude Code / Codex 会话底部状态栏可直接切换代理商。
- **额度查询**：支持展示余额、剩余额度、已用额度与周限制额度，并每分钟自动刷新。
- **多标签与分屏**：支持终端标签、分屏、拖放布局。
- **主题系统**：内置 10+ 主题，支持自定义主题。
- **自动更新**：通过 Tauri updater 从 GitHub Releases 检查、下载和安装更新。

## 安装

前往 GitHub Releases 下载最新安装包：

```text
https://github.com/xuya-dev/XuYa-Terminal/releases/latest
```

当前发布流程会生成 Windows、macOS 和 Linux 安装包，并生成 updater 所需的 `latest.json`。已安装客户端可在“关于”页面检查更新。

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
- Open Code

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
- 图片粘贴：为 Claude Code / Codex / Open Code 适配剪贴板图片或文件路径输入。
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
│   ├── modules/
│   │   ├── ai/                  # AI 智能体系统（Vercel AI SDK）
│   │   │   ├── config.ts        # 模型与服务商配置
│   │   │   ├── lib/             # Agent 运行引擎、密钥管理
│   │   │   ├── components/      # AI 聊天界面组件
│   │   │   ├── store/           # AI 状态管理
│   │   │   └── tools/           # AI 工具（文件、Shell、编辑等）
│   │   ├── terminal/            # 终端模块
│   │   ├── editor/              # CodeMirror 代码编辑器
│   │   ├── explorer/            # 文件浏览器
│   │   ├── theme/               # 主题引擎
│   │   └── settings/            # 设置界面
│   ├── components/ui/           # shadcn/ui 组件库
│   └── lib/                     # 工具函数
├── src-tauri/                   # Tauri 后端
│   ├── src/
│   │   ├── modules/
│   │   │   ├── agent_config.rs  # Claude/Codex 配置管理
│   │   │   ├── pty/             # PTY 会话管理
│   │   │   ├── fs/              # 文件系统操作
│   │   │   ├── git/             # Git 操作
│   │   │   ├── secrets/         # 密钥管理
│   │   │   └── ...
│   │   ├── lib.rs               # Tauri 命令注册
│   │   └── main.rs              # 程序入口
│   └── tauri.conf.json          # 应用配置
├── public/                      # 静态资源
├── scripts/                     # 构建脚本
├── CHANGELOG.md
├── CONTRIBUTING.md
├── Cargo.toml
└── package.json
```

## 技术栈

前端：

- React 19 + TypeScript 6
- Vite 8
- Tailwind CSS 4 + shadcn/ui
- Zustand 5（状态管理）
- Vercel AI SDK 6（内置 AI 智能体）
- CodeMirror 6（代码编辑器）
- xterm.js 6（终端模拟）
- Radix UI（UI 原语）

后端：

- Tauri v2
- Rust（模块化架构）
- `portable-pty`（PTY 管理）
- `rusqlite`（本地数据库）
- `reqwest`（HTTP 请求）
- `keyring`（系统密钥链）

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

版本号通过脚本统一更新：

```bash
pnpm run version:set -- 1.0.1
```

该命令会同步更新：

- `package.json`
- 根目录 `Cargo.toml` 的 workspace version
- `src-tauri/Cargo.toml`
- `Cargo.lock`
- `src-tauri/tauri.conf.json`
- README 当前版本与示例标签

版本变更说明仍需手动写入 `CHANGELOG.md`。

版本标签使用 `v*` 格式，例如：

```bash
git tag v1.0.1
git push origin v1.0.1
```

推送 `v*` 标签会触发 GitHub Actions 发布流程，自动构建 Windows、macOS 和 Linux 安装包并生成 updater 所需的发布文件。更多细节见 [docs/auto-update.md](docs/auto-update.md)。

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

## 致谢

XuYa Terminal 的 AI-native 终端架构基于 [terax-ai-zh](https://github.com/crynta/terax-ai) 项目进行二次开发。感谢原作者 [crynta](https://github.com/crynta) 的优秀工作！

原项目提供了：
- 完整的 AI 智能体系统（Vercel AI SDK）
- 模块化的 Rust 后端架构
- 现代化的 UI 组件（shadcn/ui + Tailwind CSS）
- 代码编辑器（CodeMirror 6）
- 文件浏览器和 Git 集成

XuYa Terminal 在此基础上进行了以下定制：
- 集成国产模型服务商（智谱、MiniMax、Kimi、小米 MiMo）
- 保留 Claude Code 和 Codex 配置管理功能
- 中文化界面和文档
- 针对国内用户优化

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 开源。
