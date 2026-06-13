# 更新日志 (Changelog)

本文件记录 **XuYa Terminal** 的所有重大版本更新与变动。

## [Unreleased]

## [1.0.4] - 2026-06-14

### ✨ Agent 会话恢复 (Agent Session Resume)
- 新增 Claude Code / Codex / OpenCode 终端标签的会话绑定：自动捕获各 agent 的会话 ID 并随标签持久化，重启或重开标签时用 `claude --resume` / `codex resume` / `opencode --session` 恢复上次对话。
- 恢复时重新捕获会话 ID，跟踪 agent 分叉出的新会话，避免多次重启后恢复到旧会话。
- OpenCode 会话改为读取 SQLite（`~/.local/share/opencode/opencode.db`）获取，适配新版存储结构。

### 🐛 终端浅色模式修复 (Terminal Light Mode Fixes)
- 固定终端区域始终使用深色渲染，并向 Claude Code / Codex / OpenCode 等 TUI 同步深色前景、背景与光标颜色，修复浅色模式下文字、背景和选择态兼容异常。

## [1.0.3] - 2026-06-13

### ✨ 额度悬浮详情 (Quota Hover Details)
- 底部状态栏 Agent 额度由纯文本提示改为悬浮卡片详情，展示服务商、套餐、剩余/已用/总额、5 小时与周限制档位及重置时间、查询时间等。
- 修复智谱（ZhiPu）等以时间戳返回的重置时间显示为原始数字的问题，自动按秒/毫秒量级转换为本地可读时间。

### 🐛 终端滚动修复 (Terminal Scrolling)
- 修复 Codex / Claude Code 等全屏 TUI（备用屏幕）下终端无法上下滚动的问题：启用 xterm `altScrollMouse` 使鼠标滚轮 / 触控板在备用屏幕翻译为方向键，并新增 Shift+滚轮逃生口，绕过应用鼠标跟踪、强制滚动终端缓冲区。

## [1.0.2] - 2026-06-13

### 🐛 macOS 与终端快捷键修复 (macOS & Terminal Shortcuts)
- macOS 主窗口与设置窗口恢复系统原生标题栏，修复左上角关闭、最小化、最大化按钮仍缺失的问题。
- 终端复制粘贴快捷键与设置页展示保持一致：macOS 使用 `⌘C` / `⌘V`，Windows 与 Linux 使用 `Ctrl+Shift+C` / `Ctrl+Shift+V`。

### ✨ Agent 额度查询 (Agent Quota)
- 底部状态栏恢复 Claude Code / Codex 的代理商额度查询，并按当前 Agent 标签分开展示。
- 恢复内置代理商额度查询，支持 DeepSeek、智谱 GLM、Kimi、MiniMax 等服务商。
- 自定义代理商继续支持 New API 与 Sub2API 额度查询，并提供刷新状态与详细提示信息。

## [1.0.1] - 2026-06-12

### 🐛 macOS 窗口修复 (macOS Window Fixes)
- macOS 恢复原生窗口装饰，修复左上角关闭、最小化、最大化按钮缺失和窗口圆角缺失的问题。
- Windows 与 Linux 继续保留现有自定义透明窗口配置，避免影响既有桌面表现。

### 👷 发布流程 (Release)
- CI 与发布工作流改为仅在 `v*` 标签推送时触发，避免普通代码推送自动运行。
- 版本号提升至 `1.0.1`。

## [1.0.0] - 2026-06-12

### 🚀 多系统发布 (Multi-platform Release)
- 版本号提升至 `1.0.0`，作为首个多系统发布版本。
- GitHub Actions 发布流程扩展为 Windows、macOS 和 Linux 构建矩阵，并继续生成 Tauri updater 所需的 `latest.json`。
- Windows 自动更新继续优先使用 NSIS 更新包，并兼容旧版 `xuya` 发布者注册表，避免自定义安装目录迁移到默认目录。

## [0.1.8] - 2026-06-05

### 🐛 终端与状态栏修复 (Terminal & Status Bar Fixes)
- 修复 Codex、Claude Code、Open Code 等 Agent 输出代码或全屏重绘时 xterm 光标乱窜、IME 候选框跟随跳动的问题，Agent 会话中固定隐藏 xterm caret，并将输入辅助锚点固定到底部输入区域。
- 移除底部栏运行时间与本地时间显示，取消每秒状态栏重绘，避免应用在前台时出现秒级闪动。
- Windows 下后台读取 Git 状态时使用无窗口方式启动 `git status`，避免打包版每 15 秒弹出短暂控制台窗口。

## [0.1.7] - 2026-06-05

### ✨ 状态栏信息增强 (Status Bar)
- 底部状态栏新增当前 Git 分支与工作区变更概览，支持展示已暂存、已修改、删除、未跟踪和冲突数量。
- Agent 会话状态栏新增真实会话用量读取，展示当前上下文大小与会话总 Token 消耗，并在悬浮提示中提供输入、输出、缓存与推理 Token 明细。
- Token 用量移动到代理商额度信息后方展示，移除低价值的标签数量统计，降低底栏噪音。

### 🐛 修复与可读性 (Fixes & Readability)
- 修复点击底部栏当前目录时未打开系统文件资源管理器的问题，改为由 Tauri 后端调用原生文件管理器。
- 修复浅色模式下 Agent 终端输出文字过浅的问题，浅色终端恢复最低对比度保护，深色模式保留原始 ANSI 配色。
- 修复关于弹窗版本号容易遗漏更新的问题，改为从 Tauri 应用版本动态读取。

### 🚀 发布流程 (Release)
- 新增 `pnpm run version:set -- <version>` 版本同步脚本，统一更新 `package.json`、workspace `Cargo.toml`、`Cargo.lock`、`tauri.conf.json` 与 README 示例版本。
- README 发布流程改为推荐使用版本同步脚本，并明确 changelog 仍需手动维护。

## [0.1.6] - 2026-06-05

### ⚡ 终端渲染与性能 (Terminal Rendering & Performance)
- 接入 WebGL 渲染器，大幅提升 Claude Code / Codex 等高吞吐流式输出与长 diff 滚动的流畅度；GPU 上下文丢失时自动降级回 DOM 渲染器。
- 启用 Unicode 11 字符宽度，框线、CJK 与 Emoji 列宽从首帧起即正确对齐，修复 Agent TUI 错位问题。
- PTY 输出改用二进制 IPC 通道（`tauri::ipc::Channel`）传输原始字节，取代旧的 emit/listen + JSON 数字数组，消除逐字节序列化开销。
- 优化 PTY 读取线程的合并逻辑，每轮循环即时回吐缓冲，避免背压缓解后小段尾包滞留。

### 🎨 字体与配色 (Font & Color)
- 终端默认字体改为内置分发的 JetBrains Maple Mono（随应用打包 Regular / Bold，无需用户手动安装），保证中英文严格等宽对齐。
- 关闭 `minimumContrastRatio` 强制对比度改写，还原 Agent 精心设计的真彩色语法高亮。

### 🔍 终端内搜索 (Terminal Search)
- 新增 `Ctrl+F` 终端内搜索浮层：支持回车 / Shift+回车 切换下一个 / 上一个、大小写切换、结果计数，Esc 关闭并归还焦点。
- 屏蔽 WebView 自带的页面查找栏，并在右键菜单新增"搜索"项（选中单行文本时自动填入）。

### ⚙️ 启动体验 (Startup)
- 削减各 Shell 启动时的等待延迟：PowerShell 由 500ms 降至 250ms，Git Bash / WSL 由 1s 降至 0.3s，CMD 移除多余的 1s 等待，新建会话与一键启动 Agent 更快。

## [0.1.5] - 2026-06-04
 - 2026-06-04

### ✨ AI 代理商与额度查询 (AI Providers & Quota)
- 底部状态栏新增 Claude Code / Codex 代理商切换器，仅在对应 Agent 会话中展示，并按当前工具过滤可用代理商。
- 状态栏支持展示代理商余额、剩余额度、已用额度和周限制额度，并每分钟自动刷新一次。
- 内置代理商支持自动识别额度接口，覆盖 Kimi、智谱 GLM、MiniMax、DeepSeek、XiaoMi Mimo、Sub2API、New API 等常用返回结构。
- 自定义代理商的额度查询改为手动选择接口类型，默认不查询；New API 可额外配置 Access Token 与用户 ID。
- 代理商下拉列表新增厂商图标与选中标记，状态栏目录支持点击打开当前工作目录。

### 🐛 终端与切换体验 (Terminal UX)
- 切换 Claude Code / Codex 代理商后，仅重启当前 Agent 标签页的 PTY 并重新运行原命令，避免整体刷新应用。
- 修复 Claude Code 首次会话切换代理商后无法重新加载会话的问题，重启时基于原会话 fork 新会话并重新绑定标签。
- 修复 Codex 代理商隔离导致切换配置后找不到原会话记录的问题，重启时显式使用已记录 Session ID 恢复。
- 修复底部运行时间变化导致状态栏后续数据抖动的问题。
- 修复 Codex diff 背景未对齐的问题，优化终端 resize 与初始 fit 时机。
- 额度文案在没有已用数据时仅展示剩余额度，避免出现 `用 —`。

### 🔧 AI 配置默认值 (AI Config Defaults)
- 更新 XiaoMi Mimo 默认端点为 `https://token-plan-cn.xiaomimimo.com/anthropic`。
- 更新 Kimi 默认端点为 `https://api.kimi.com/coding`。
- Claude 内置代理商的兜底模型默认改为空，旧版本保存的内置默认兜底模型会自动视为空值。

## [0.1.4] - 2026-06-04

### 🎨 主题精修与视觉效果提升 (Theme & UI Enhancements)
- 对全部 9 套主题进行了 HSL 精调与重构，彻底解决浅色模式下终端 ANSI 字体隐形问题（如高亮白字不可见），提升辅助前景色 `foregroundFaint` 的对比度。
- 精修新建会话、空白占位、侧边栏等各处的 Action 按钮样式，圆角统一定制为 8px，并增设 top-border 微光边框与 hover 向上浮动 1px 的轻量交互。
- 状态栏与 AI 配置页已配置的厂商 Key 信息展示从“有配置”改为“已配置 X 个 Key”的实时统计。
- 自定义分组卡片的主色边框和高亮颜色从灰暗色调优化为明亮淡紫色 `#8B5CF6`。

### 🤖 终端交互与功能优化 (Terminal & PTY Interactions)
- **快捷键复制拦截**：拦截 `Ctrl+C` / `Cmd+C` / `Ctrl+Shift+C` 快捷键，当有选区文字时复制至剪贴板并阻止向 PTY 发送 `SIGINT` 中断，无选区时保留标准的 shell 终止命令逻辑。
- **右键上下文菜单**：为终端增加右键 ContextMenu 功能，提供复制（无选区时禁用）、粘贴、全选、清除选择四个原生常用快捷项。
- **拖拽文件填入路径**：对接 Tauri v2 窗口原生 `onDragDropEvent` 文件放置事件，使用 DPI 自动换算 logical CSS 坐标对多终端分屏进行碰撞检测，精准识别拖入的目标终端面板，并在拖放时自动聚焦终端、拼接插入以双引号转义的绝对文件路径。
- **原生剪贴板拦截**：绑定原生 `copy` 事件，确保终端高亮选择与系统/浏览器剪贴板的复制深度对齐。
- **Codex diff 背景对齐**：优化 xterm 初始 fit 与 resize 稳定时机，修复 Codex 展示 diff 时背景色块断层、宽度不一致的问题。

### 👷 版本检测与更新 (Auto Update)
- 在启动时立即触发后台自动更新检测，随后每 12 小时检测一次，发现新版本时使用 Tauri 原生 `ask` 弹窗友好提示并引导前往“关于”页。

## [0.1.3] - 2026-06-04

### ✨ AI 配置 (AI Config)
- 设置页面新增 AI 配置标签页，支持在 XuYa Terminal 内快速配置和切换 Claude Code 与 Codex。
- Claude Code 支持官方、ZhiPu GLM、MiniMax、Kimi、DeepSeek、XiaoMi Mimo 与自定义端点。
- Codex 支持官方与自定义端点，并固定使用 Responses API 配置。
- Claude Code 与 Codex 的自定义厂商支持保存多个条目，可在设置页快速切换、更新或删除。
- 自定义厂商配置改为写入 `~/.xuya/agent-providers.sqlite`，再次选中已保存厂商时会回显完整配置。
- Claude Code 配置支持分别设置 Sonnet、Opus、Haiku 三个角色模型，并可直接查看和编辑完整 `settings.json`。
- Codex 配置可直接查看和编辑完整 `config.toml`，界面展示时使用占位符隐藏 API Key。
- Claude Code 与 Codex 配置页支持从当前厂商拉取 OpenAI 兼容模型列表，并可快速填入模型字段。
- AI 配置页改为 Claude Code / Codex 单卡切换布局，避免双列展示造成配置区域拥挤。
- AI 配置页将自定义厂商合并到内置厂商网格，并把模型列表、完整配置编辑器改为按需展开。
- 写入范围保持轻量：Claude Code 写入 `~/.claude/settings.json`，Codex 写入 `~/.codex/config.toml`。
- 端点能力保持约束：Claude Code 仅展示 `/v1/messages`，Codex 仅展示 `/v1/responses`，不提供反代协议转换。

## [0.1.2] - 2026-06-04

### 👷 发布流程 (Release)
- 修复 GitHub Actions 发布流程中的 updater 签名私钥预处理与校验逻辑。
- 补充自动更新发布文档，明确 `TAURI_SIGNING_PRIVATE_KEY` 和密码的填写方式。
- 用于验证 `0.1.1` 客户端到 `0.1.2` 的自动更新链路。

## [0.1.1] - 2026-06-04

### ✨ 自动更新 (Auto Update)
- 接入 Tauri v2 updater 插件，支持从 GitHub Releases 检查、下载并安装更新。
- 在关于页面新增自动更新区域，提供检查更新、查看版本说明、下载安装进度和安装后重启能力。
- 配置 GitHub Releases 静态更新源 `latest.json`，Windows 安装模式使用被动安装。
- 新增 GitHub Actions 发布工作流，推送 `v*` tag 后自动构建 Windows 安装包、生成 updater 签名并上传 Release 资源。
- 新增 [docs/auto-update.md](docs/auto-update.md)，记录 updater 签名密钥、GitHub Secrets 和版本发布流程。

### 🧭 设置与关于页面 (Settings & About)
- 将设置弹窗改为标签页布局，按外观、终端、会话菜单分组展示配置项。
- 将帮助入口改为关于页面，并把自动更新能力集中放入关于页面。
- 删除独立主题设置弹窗，主题选择直接整合到外观设置栏下。
- 主题选择网格调整为每排 3 个主题，提升浏览和切换效率。
- 删除侧边栏底部的独立主题按钮入口，减少重复入口。
- 关于页面新增 GitHub 仓库地址入口，可直接打开项目仓库。

### 🐛 修复与体验优化 (Fixes & UX)
- 修复设置页面中深浅模式预览需要点击两次才生效的问题。
- 修复部分深色主题下强调色按钮文字对比度不足的问题。
- 修复部分浅色主题下 Coding 工具终端输出颜色过浅、不可读的问题。
- 重新设计设置与关于页面布局，让配置分组和自动更新状态更清晰。

## [0.1.0] - 2026-06-02

这是 **XuYa Terminal** 的第一个重构开源准备版本，包含全局界面美学重塑、主题汉化与中文化特色重置，以及面向 AI 编程的功能性优化。

### 🎨 界面美学与布局优化 (UI/UX)
- **卡片式悬浮布局**：为主容器添加了 `padding` 与 `gap` 间隙，将左侧栏与主工作区分别重塑为具有 12px 圆角（`border-radius: 12px`）和完整四周描边的悬浮卡片，层次更立体分明。
- **界面细节精修**：
  - 将右上角 Dockview 终端操作控制区（新建标签、分屏、清屏等）全部改版为带微描边与浅背景色的软胶囊按钮，并支持平滑的主题高亮 hover 交互。
  - 顶栏项目选择触发器与主题触发器更换为极具质感的 `surface-sunken` 轻透底色背景配软毛玻璃边框，过渡更平滑。
  - 为会话列表中的激活项添加了左侧的垂直圆角高亮指示胶囊条，提升选中反馈度。
- **选项卡（Tabs）细节重塑**：
  - 修复选项卡底部指示横线左右圆角处超出界面的溢出 Bug，指示线改为顶部贴合且继承 8px 的顶部圆角。
  - 通过 `position: relative; top: 1px` 将激活选项卡向下平移 1 像素，配合纯白色/终端背景色底边，彻底遮盖住了长条底框的浅色分割线，选项卡与终端内容区融为一体。

### 🌈 主题系统 (Themes)
- **完全重构主题系统**：清空了原有的国外第三方主题，重新从零调配设计了 5 款原生的中文自然与古典色彩双模美学主题（均配有高度适配的深色与浅色双重 Palette）：
  - **极光冰川 (Aurora Glacier)** - 极地冰川的冷白与深海蓝，搭配极光青与冰蓝。
  - **赤焰霞光 (Crimson Sunset)** - 热烈温暖的晚霞红与夕阳橙。
  - **青木幽谷 (Forest Moss)** - 森野落叶的幽静古朴绿与 lichen 灰。
  - **紫黛漫步 (Lavender Mist)** - 浪漫朦胧的紫藤色与粉樱调。
  - **水墨丹青 (Ink Brush)** - 雅致古典的水墨灰、生宣白与微墨绿。
- **汉化支持**：主题列表、关于弹窗及顶栏选择框内的主题名称全面中文化显示（如 `极光冰川`、`青木幽谷` 等），实现完美中文使用环境。
- **底色一致性融合**：通过将终端核心背景色暴露为 `--xy-terminal-bg` CSS 自定义属性，使得选项卡底部及衬底外边距（padding）区域的纯白底框被完全抹除，衬底和终端背景色彻底实现无缝色泽融合。

### 🤖 终端与 AI 编程适配 (PTY & AI Integration)
- **自动回车执行**：将写入 PTY 终端的 Agent 会话（如 `Claude Code`、`Codex`、`Open Code`）启动指令末尾的回车符替换为适用于 Windows 环境的标准的回车换行符 `\r\n`。现在点击相应选项即可在新建标签页中实现免手动干预的自动回车运行。
- **剪贴板图片粘贴支持**：在终端视图内识别图片粘贴事件。Claude Code / Codex / Open Code 会按各自 Windows 图片粘贴快捷键触发原生剪贴板读取；图片文件或 WebView 可读取的截图数据会保存至系统临时路径，并向当前终端注入双引号包裹的绝对文件路径。

### 📦 项目开源准备 (Open-Source Prep)
- **开源文件准备**：
  - 增加了 MIT 开源许可证协议文件 [LICENSE](LICENSE)。
  - 编写了规范的 [README.md](README.md) 中文上手文档，包含安装运行、打包流程、架构说明。
  - 编写了 [CONTRIBUTING.md](CONTRIBUTING.md) 社区协作规范。
  - 补充并更新了 [.gitignore](.gitignore) 规则过滤本地冗余垃圾文件。
  - 清理了拼写错误创建的冗余临时文件。
