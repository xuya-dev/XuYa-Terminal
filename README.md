# 🖥️ XuYa Terminal

> **面向 AI Agent 工程师的新一代高颜值终端管理器**。  
> 基于 **Tauri v2** + **React 19** + **TypeScript** 构建，致力于提供极致流畅、现代卡片式悬浮视觉与深度中文化支持的开发环境。

---

## ✨ 核心特性

- 🎨 **卡片式悬浮布局**：左右侧栏与主工作区采用圆角卡片化（`border-radius: 12px`）排布，四周留有精致的段落感间隙，底色透出当前主题的深邃色泽，呼吸感十足。
- 🌈 **5 款原生中文美学主题**：我们精心调配了五款极具东方传统与自然美感的中文双模主题，支持深浅色（Light/Dark）独立切换，前景色、背景色与终端色完全一致融合：
  - **极光冰川 (Aurora Glacier)** - 冰川冷白与深海蓝，搭配极光青与冰蓝。
  - **赤焰霞光 (Crimson Sunset)** - 热烈温暖的晚霞红与夕阳橙。
  - **青木幽谷 (Forest Moss)** - 森野落叶的幽静古朴绿与 lichen 灰。
  - **紫黛漫步 (Lavender Mist)** - 浪漫朦胧的紫藤色与粉樱调。
  - **水墨丹青 (Ink Brush)** - 雅致古典的水墨灰、生宣白与微墨绿。
- 🤖 **面向 AI 编程深度集成**：在“会话管理”侧栏中，专门开辟了面向 AI 编程的快捷启动通道：
  - 一键创建并运行 `Claude Code`、`Codex`、`OpenCode` 等 Agent 会话。
  - **Windows PTY 自动回车适配**：优化了 Windows 底层 PTY 的写入机制，点击对应选项时自动完成命令并执行回车，无需繁琐的二次手动按键。
- 📦 **高性能 Native 终端内核**：基于 Tauri v2 + Rust 底层重写的 PTY 调度程序，相较传统 Electron 架构，内存占用减少 80%，启动延迟近乎为 0。
- 💎 **精致的界面打磨**：
  - 活动选项卡（Tabs）高亮线完美贴合边缘，支持顶端指示与圆角裁剪防溢出。
  - 右侧控制按钮（分屏、洁屏等）组件化为带微描边的软胶囊按钮，交互充满灵动性。

---

## 🛠️ 快速开始

### 1. 克隆并进入项目

```bash
git clone https://github.com/your-username/XuYa-Terminal.git
cd XuYa-Terminal
```

### 2. 准备运行环境

由于本项目基于 [Tauri v2](https://v2.tauri.app/) 开发，请确保您本地已经搭建好 Rust 开发工具链（安装 Rust & Cargo）和 Node.js 环境（建议使用 pnpm 作为包管理器）。

### 3. 安装依赖

```bash
pnpm install
```

### 4. 启动本地开发环境 (Dev)

运行以下命令，项目会同时拉起 Vite 网页服务和 Tauri 桌面窗口：

```bash
pnpm run tauri dev
```

### 5. 编译生产版本打包 (Build)

运行以下命令，Tauri 会自动打包为目标平台的原生桌面端安装包（Windows 下生成 `.msi` 或 `.exe` 格式）：

```bash
pnpm run tauri build
```

---

## 📂 项目结构

```text
├── src/                  # 前端 React 项目代码
│   ├── components/       # UI 组件（包含侧边栏、顶栏、选项卡等）
│   ├── stores/           # Zustand 状态管理（主题、设置、项目）
│   ├── themes.ts         # 重新设计的 5 款高颜值中文双模主题定义
│   ├── index.css         # 重建的全局卡片布局及美学样式样式表
│   └── main.tsx          # 前端入口
├── src-tauri/            # Tauri 后端 Rust 项目代码
│   ├── src/              # Rust 底层源码（PTY 控制与文件 IO）
│   ├── capabilities/     # Tauri 应用权限安全配置
│   └── tauri.conf.json   # 桌面客户端全局参数（已重命名为 XuYa Terminal）
├── Cargo.toml            # Rust 依赖配置文件
└── package.json          # Node 依赖与构建指令
```

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 协议开源。
