# 快速开始

## 在线体验

OpenPencil 可直接在浏览器中运行，无需安装。打开 [app.openpencil.dev](https://app.openpencil.dev) 即可开始设计。

如果你想基于 OpenPencil 进行开发，而不只是使用默认应用，请参阅英文版的 [Programmable](/programmable/) 和 [Vue SDK](/programmable/sdk/) 文档。

## 下载桌面应用

macOS、Windows 和 Linux 的预构建安装包可从 [Releases 页面](https://github.com/open-pencil/open-pencil/releases/latest)下载。

| 平台                | 下载格式             |
| ------------------- | -------------------- |
| macOS（Apple 芯片） | `.dmg`（aarch64）    |
| macOS（Intel）      | `.dmg`（x64）        |
| Windows（x64）      | `.msi` / `.exe`      |
| Windows（ARM）      | `.msi` / `.exe`      |
| Linux（x64）        | `.AppImage` / `.deb` |

## 通过 Homebrew 安装 macOS 版本

```sh
brew install open-pencil/tap/open-pencil
```

该命令会安装适用于 macOS（Apple 芯片和 Intel）的最新签名版本。每次发布新版本时，Homebrew Tap 都会自动更新。

## 从源码构建

### 前置条件

- [Bun](https://bun.sh/)（包管理器和运行时）
- [Rust](https://rustup.rs/)（仅桌面应用需要）

### 安装

```sh
git clone https://github.com/open-pencil/open-pencil.git
cd open-pencil
bun install
```

### 启动开发服务器

```sh
bun run dev
```

编辑器将在 `http://localhost:1420` 打开。

## 可用脚本

| 命令                  | 说明                                     |
| --------------------- | ---------------------------------------- |
| `bun run dev`         | 启动支持 HMR 的开发服务器                |
| `bun run build`       | 执行生产构建                             |
| `bun run check`       | 运行代码检查（oxlint）和类型检查（tsgo） |
| `bun run test`        | 运行端到端视觉回归测试（Playwright）     |
| `bun run test:update` | 重新生成截图基线                         |
| `bun run test:unit`   | 运行单元测试（bun:test）                 |
| `bun run docs:dev`    | 启动文档开发服务器                       |
| `bun run docs:build`  | 构建文档站点                             |

## 桌面应用（Tauri）

构建桌面应用需要 Rust 以及对应平台的依赖。

### macOS

```sh
xcode-select --install
cargo install tauri-cli --version "^2"
bun run tauri dev
```

### Windows

1. 安装 [Rust](https://rustup.rs/)，并使用 `stable-msvc` 工具链：
   ```sh
   rustup default stable-msvc
   ```
2. 安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，并选择“使用 C++ 的桌面开发”工作负载
3. Windows 10（1803 及以上版本）和 Windows 11 已预装 WebView2
4. 运行：
   ```sh
   bun run tauri dev
   ```

### Linux

安装系统依赖（Debian/Ubuntu）：

```sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

然后运行：

```sh
bun run tauri dev
```

### 构建分发版本

```sh
bun run tauri build                                    # Current platform
bun run tauri build --target universal-apple-darwin    # macOS universal
```
