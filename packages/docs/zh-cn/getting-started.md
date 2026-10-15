# 快速开始

## 在线体验

OpenPencil 可直接在浏览器中运行，无需安装。打开 [app.openpencil.dev](https://app.openpencil.dev) 即可开始设计。

如果你想基于 OpenPencil 进行开发，而不只是使用默认应用，请参阅英文版的 [Programmable](/programmable/) 和 [Vue SDK](/programmable/sdk/) 文档。

## 下载桌面应用

这里的在线应用、Homebrew 和发布页来自官方上游。本分支的低代码、Backend 和 Motion 扩展请使用本分支源码构建，参阅下方[从源码构建](#building-from-source)。

macOS、Windows 和 Linux 的预构建安装包可从 [官方版下载页](/zh-cn/download)下载。

| 平台                | 下载格式             |
| ------------------- | -------------------- |
| macOS（Apple 芯片） | `.dmg`（aarch64）    |
| macOS（Intel）      | `.dmg`（x64）        |
| Windows（x64）      | `.msi` / `.exe`      |
| Windows（ARM）      | `.msi` / `.exe`      |
| Linux（x64）        | `.AppImage` / `.deb` |

## 系统要求 {#system-requirements}

编辑器依赖 CanvasKit、WebGL 和现代 Web API。浏览器至少需要 Chrome 111、Edge 111、Firefox 128 或 Safari 16.4。桌面端需要 macOS 13 Ventura 或更新版本及当前 Safari 更新、Windows 10 或更新版本及 WebView2 Evergreen，或提供 WebKitGTK 2.40 及以上版本的 Linux 环境。

## 通过 Homebrew 安装 macOS 版本

```sh
brew install --cask openpencil
```

该命令从官方 cask 安装适用于 macOS（Apple 芯片和 Intel）的签名应用。Homebrew 更新经过上游审阅，可能晚于 GitHub 发布。CLI 需要另外通过 `npm install -g @open-pencil/cli` 安装。

<span id="从源码构建"></span>

## 从源码构建 {#building-from-source}

### 前置条件

- [Bun](https://bun.sh/)（包管理器和运行时）
- [Rust](https://rustup.rs/)（仅桌面应用需要）

### 安装

使用已经取得的本分支源码目录；低代码等分支扩展以该源码为准。打开该目录后运行：

```sh
bun install
bun run build:packages
```

[官方上游源码](https://github.com/open-pencil/open-pencil)可用于构建官方版本，不代表本分支扩展已发布到上游。

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
