# 更新日志 (Changelog)

本文件记录 **XuYa Terminal** 的所有重大版本更新与变动。

## [0.1.3] - 2026-06-04

### ✨ AI 配置 (AI Config)
- 设置页面新增 AI 配置标签页，支持在 XuYa Terminal 内快速配置和切换 Claude Code 与 Codex。
- Claude Code 支持官方、ZhiPu GLM、MiniMax、Kimi、DeepSeek、XiaoMi Mimo 与自定义端点。
- Codex 支持官方与自定义端点，并固定使用 Responses API 配置。
- Claude Code 与 Codex 的自定义厂商支持保存多个条目，可在设置页快速切换、更新或删除。
- Claude Code 配置支持分别设置 Sonnet、Opus、Haiku 三个角色模型，并可直接查看和编辑完整 `settings.json`。
- Codex 配置可直接查看和编辑完整 `config.toml`，界面展示时使用占位符隐藏 API Key。
- Claude Code 与 Codex 配置页支持从当前厂商拉取 OpenAI 兼容模型列表，并可快速填入模型字段。
- AI 配置页改为 Claude Code / Codex 单卡切换布局，避免双列展示造成配置区域拥挤。
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
- **自动回车执行**：将写入 PTY 终端的 Agent 会话（如 `Claude Code`、`Codex`、`OpenCode`）启动指令末尾的回车符替换为适用于 Windows 环境的标准的回车换行符 `\r\n`。现在点击相应选项即可在新建标签页中实现免手动干预的自动回车运行。
- **剪贴板图片粘贴支持**：在终端视图内识别图片粘贴事件。Claude Code / Codex / OpenCode 会按各自 Windows 图片粘贴快捷键触发原生剪贴板读取；图片文件或 WebView 可读取的截图数据会保存至系统临时路径，并向当前终端注入双引号包裹的绝对文件路径。

### 📦 项目开源准备 (Open-Source Prep)
- **开源文件准备**：
  - 增加了 MIT 开源许可证协议文件 [LICENSE](LICENSE)。
  - 编写了规范的 [README.md](README.md) 中文上手文档，包含安装运行、打包流程、架构说明。
  - 编写了 [CONTRIBUTING.md](CONTRIBUTING.md) 社区协作规范。
  - 补充并更新了 [.gitignore](.gitignore) 规则过滤本地冗余垃圾文件。
  - 清理了拼写错误创建的冗余临时文件。
