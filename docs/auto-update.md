# 自动更新发布流程

XuYa Terminal 使用 Tauri v2 updater 插件，通过 GitHub Releases 提供 `latest.json` 和安装包。

## GitHub Secrets

在仓库的 `Settings -> Secrets and variables -> Actions` 中添加：

- `TAURI_SIGNING_PRIVATE_KEY`：`D:\tmp\xuya-tauri-updater.key` 的完整内容。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：`D:\tmp\xuya-tauri-updater.password` 的完整内容。

这套私钥和密码必须长期保留。更换私钥后，已经安装的旧版本无法校验后续更新包签名。

## 发布新版本

1. 同步版本号：
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - Cargo workspace version
2. 提交并推送代码到主分支。
3. 创建并推送版本 tag，例如：

```powershell
git tag v0.1.2
git push origin v0.1.2
```

GitHub Actions 会构建 Windows 安装包、生成 updater 签名，并上传 `latest.json` 到 GitHub Release。客户端检查更新时会请求：

```text
https://github.com/xuya-dev/XuYa-Terminal/releases/latest/download/latest.json
```

## 本地验证

本地打包验证可以使用：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw D:\tmp\xuya-tauri-updater.key
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Get-Content -Raw D:\tmp\xuya-tauri-updater.password
pnpm tauri build
```

成功后应生成：

- `target/release/bundle/nsis/*.exe`
- `target/release/bundle/nsis/*.exe.sig`
- `target/release/bundle/msi/*.msi`
- `target/release/bundle/msi/*.msi.sig`
