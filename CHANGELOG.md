# 更新日志 (Changelog)

本文件记录 **XuYa Terminal** 的所有重大版本更新与变动。

## [Unreleased]

## [1.0.7] - 2026-06-24

### ✨ 编码配置密钥与服务商优化 (Agent Config Key & Provider Improvements)
- 密钥框新增眼睛图标，点击切换明文 / 掩码查看。
- Claude 服务商下拉仅展示已配置 Key 的服务商，未配置的内置服务商移至添加表单。
- 添加服务商表单新增内置服务商模板快捷按钮，点击一键回显名称与 BaseURL，仅需填 Key 与模型即可保存为内置服务商。

### 🐛 Codex 密钥修改修复 (Codex Key Edit Fix)
- 修复 Codex 保存刷新后密钥被重置回旧值、导致无法修改的问题。

### 🐛 终端快捷键放行修复 (Terminal Shortcut Deferral)
- 终端聚焦时将 Ctrl+T/D/E/G/U/F/I 及 Ctrl+Tab 等交给终端 / shell / CLI，不再被全局快捷键抢走。
- 保持 Ctrl+W、缩放、命令面板、侧边栏等全局行为不变。

## [1.0.6] - 2026-06-14

### ✨ 编码配置完善 (Agent Config Improvements)
- Claude 自定义供应商支持分别设置 Opus / Sonnet / Haiku 角色模型。
- 自定义供应商编辑表单新增拉取模型按钮，模型字段支持从下拉选择。
- 编辑保存后若该供应商为当前生效则自动应用，主表单底部改为“保存配置”与“切换配置”两个按钮。

### 🐛 编码配置回显修复 (Config Echo Fixes)
- 修复主表单对自定义供应商的编辑未写入预设库、切换回来模型为空的问题。
- 修复保存后主表单字段被重置回当前生效配置、覆盖编辑的问题。

### ✨ 底部 Agent 服务商快速切换 (Status-bar Provider Switcher)
- 状态栏新增 Claude Code / Codex 服务商切换器，仅在 Agent 标签展示。
- 仅显示已配置 Key 的服务商，切换后重启当前 Agent 并恢复原对话。

### 🐛 更新内容渲染修复 (Release Notes Rendering)
- 修复更新通知里的更新内容未渲染 Markdown 的问题。

## [1.0.5] - 2026-06-14

### 🐛 终端唤醒与多窗口会话修复 (Terminal Wake & Multi-window Session Fixes)
- 修复新建终端 / Agent 偶发只开框不唤醒的问题。
- 修复多窗口同目录 Agent 会话互相抢占、重开双双 resume 同一对话的问题。

## [1.0.4] - 2026-06-14

### ✨ Agent 会话恢复 (Agent Session Resume)
- 新增 Agent 标签会话绑定，重启或重开时自动恢复上次对话。
- 恢复时重新捕获会话 ID，避免多次重启后恢复到旧会话。

### 🐛 终端浅色模式修复 (Terminal Light Mode Fixes)
- 固定终端区域深色渲染，修复浅色模式下文字与背景兼容异常。

## [1.0.3] - 2026-06-13

### ✨ 额度悬浮详情 (Quota Hover Details)
- Agent 额度由纯文本改为悬浮卡片详情。
- 修复智谱重置时间显示为原始数字的问题。

### 🐛 终端滚动修复 (Terminal Scrolling)
- 修复全屏 TUI 下终端无法滚动的问题，新增 Shift+滚轮逃生口。

## [1.0.2] - 2026-06-13

### 🐛 macOS 与终端快捷键修复 (macOS & Terminal Shortcuts)
- macOS 恢复原生标题栏，修复窗口按钮缺失。
- 统一复制粘贴快捷键：macOS 用 `⌘C` / `⌘V`，Windows / Linux 用 `Ctrl+Shift+C` / `Ctrl+Shift+V`。

### ✨ Agent 额度查询 (Agent Quota)
- 恢复状态栏 Agent 额度查询，按标签分开展示。

## [1.0.1] - 2026-06-12

### 🐛 macOS 窗口修复 (macOS Window Fixes)
- macOS 恢复原生窗口装饰，修复窗口按钮和圆角缺失。

### 👷 发布流程 (Release)
- 发布工作流改为仅在 `v*` 标签推送时触发。

## [1.0.0] - 2026-06-12

### 🚀 多系统发布 (Multi-platform Release)
- 首个多系统版本，扩展 Windows / macOS / Linux 构建矩阵。
- Windows 自动更新优先用 NSIS 包，兼容旧版发布者注册表。

## [0.1.8] - 2026-06-05

### 🐛 终端与状态栏修复 (Terminal & Status Bar Fixes)
- 修复 Agent 输出时光标乱窜、IME 候选框跳动的问题。
- 移除底部栏时间显示，取消每秒重绘。
- Windows 后台读取 Git 状态改用无窗口方式。

## [0.1.7] - 2026-06-05

### ✨ 状态栏信息增强 (Status Bar)
- 状态栏新增 Git 分支与工作区变更概览。
- Agent 会话状态栏新增 Token 用量与明细。

### 🐛 修复与可读性 (Fixes & Readability)
- 修复点击目录未打开资源管理器、浅色终端文字过浅等问题。
- 关于页版本号改为动态读取。

### 🚀 发布流程 (Release)
- 新增 `version:set` 版本同步脚本。

## [0.1.6] - 2026-06-05

### ⚡ 终端渲染与性能 (Terminal Rendering & Performance)
- 接入 WebGL 渲染器，提升高吞吐输出流畅度。
- 启用 Unicode 11 字符宽度，修复框线 / Emoji 对齐。
- PTY 输出改用二进制 IPC，消除序列化开销。

### 🎨 字体与配色 (Font & Color)
- 默认字体改为内置 JetBrains Maple Mono。
- 关闭强制对比度改写，还原真彩色语法高亮。

### 🔍 终端内搜索 (Terminal Search)
- 新增 `Ctrl+F` 终端内搜索。

### ⚙️ 启动体验 (Startup)
- 削减 Shell 启动延迟，新建会话更快。

## [0.1.5] - 2026-06-04

### ✨ AI 代理商与额度查询 (AI Providers & Quota)
- 状态栏新增 Agent 代理商切换器与额度展示。
- 内置代理商自动识别额度接口，覆盖主流服务商。

### 🐛 终端与切换体验 (Terminal UX)
- 切换代理商仅重启当前标签，不刷新整个应用。
- 修复切换后 Claude Code / Codex 会话恢复等问题。

### 🔧 AI 配置默认值 (AI Config Defaults)
- 更新默认端点，兜底模型默认改为空。

## [0.1.4] - 2026-06-04

### 🎨 主题精修与视觉效果提升 (Theme & UI Enhancements)
- 精修全部 9 套主题，修复浅色模式字体不可见。
- 状态栏与配置页改为展示已配置 Key 数量。

### 🤖 终端交互与功能优化 (Terminal & PTY Interactions)
- 有选区时 `Ctrl+C` 复制并阻止 `SIGINT`。
- 新增终端右键菜单与拖拽文件填路径。

### 👷 版本检测与更新 (Auto Update)
- 启动时自动检测更新，每 12 小时一次。

## [0.1.3] - 2026-06-04

### ✨ AI 配置 (AI Config)
- 新增 AI 配置页，可配置切换 Claude Code 与 Codex。
- Claude Code 支持多服务商，Codex 支持自定义端点。
- 支持设置模型、编辑完整配置、拉取模型列表。

## [0.1.2] - 2026-06-04

### 👷 发布流程 (Release)
- 修复 updater 签名校验逻辑。

## [0.1.1] - 2026-06-04

### ✨ 自动更新 (Auto Update)
- 接入 Tauri v2 updater，支持检查、下载、安装更新。
- 新增 GitHub Actions 发布工作流与 `latest.json` 更新源。

### 🧭 设置与关于页面 (Settings & About)
- 设置页改为标签页布局，帮助入口改为关于页。
- 主题选择整合到外观设置栏。

### 🐛 修复与体验优化 (Fixes & UX)
- 修复深浅模式预览、按钮对比度等若干问题。

## [0.1.0] - 2026-06-02

首个重构开源准备版本。

### 🎨 界面美学与布局优化 (UI/UX)
- 主容器改为卡片式悬浮布局。

### 🌈 主题系统 (Themes)
- 重构主题系统，新增 5 款中文主题。

### 🤖 终端与 AI 编程适配 (PTY & AI Integration)
- 一键启动 Agent 自动回车运行。
- 支持终端粘贴剪贴板图片。

### 📦 项目开源准备 (Open-Source Prep)
- 增加 MIT 许可证与开源文档。
