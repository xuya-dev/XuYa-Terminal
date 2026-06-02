# 🤝 贡献指南 (Contributing Guide)

感谢您对 **XuYa Terminal** 做出贡献！

我们非常欢迎来自社区的 Issue 报告、新特性建议、代码修复以及文档改进。以下是参与开发的一些基本指南：

## 🚀 提报 Issue

- **报告 Bug**：请尽可能提供详细的运行环境（OS 版本、Node/Rust 版本）、复现步骤以及屏幕截图（如果有）。
- **功能请求 (Feature Request)**：请清晰地描述您期望的效果以及目前无法解决的痛点。

## 🛠️ 本地开发流程

1. **Fork** 本项目仓库。
2. 将您 Fork 后的仓库克隆到本地开发环境：
   ```bash
   git clone https://github.com/YOUR_USERNAME/XuYa-Terminal.git
   ```
3. 创建您独立的特性分支 (Feature branch)：
   ```bash
   git checkout -b feature/your-awesome-feature
   ```
4. 本地调测前，请确保安装了 Rust 工具链（cargo）及 Node.js，随后安装依赖：
   ```bash
   pnpm install
   ```
5. 本地运行开发环境：
   ```bash
   pnpm run tauri dev
   ```

## 📝 代码提交规范

- **Lint 校验**：在提交代码前，请确保在前端运行 `pnpm build` 或者没有引入新的 TypeScript/CSS 编译报错。
- **Commit Message**：为了保持提交历史的清晰，建议遵循以下提交前缀：
  - `feat`: 新增特性 / 功能
  - `fix`: 修复 Bug 或样式瑕疵
  - `docs`: 文档、README 补充与修正
  - `style`: 格式调整（不影响逻辑的代码格式化）
  - `refactor`: 代码重构（不增加新功能也不修复 Bug）

## 📬 提交 Pull Request (PR)

1. 在您的特性分支上调测无误后，将分支推送至您的远端仓库：
   ```bash
   git push origin feature/your-awesome-feature
   ```
2. 访问本项目的原仓库，点击 **Compare & pull request** 按钮。
3. 请在 PR 描述中清晰说明：
   - 您的修改解决了什么问题或引入了什么特性。
   - 复现/验证的具体效果。
4. 提交后请等待项目维护者的 Review，我们会尽快评估并合入。
