# 功能

## Figma .fig 文件

直接打开和保存 Figma 原生文件。导入与导出流程采用和 Figma 相同的 Kiwi 二进制编解码器，包含 194 个模式定义，每个节点约有 390 个字段。按 <kbd>⌘</kbd><kbd>S</kbd> 保存，按 <kbd>⇧</kbd><kbd>⌘</kbd><kbd>S</kbd> 另存为。

**与 Figma 互相复制粘贴**——在 Figma 中选中节点并按 <kbd>⌘</kbd><kbd>C</kbd>，切换到 OpenPencil 后按 <kbd>⌘</kbd><kbd>V</kbd>。填充、描边、自动布局、文本、效果、圆角和矢量网络都会保留，反向操作同样有效。

## 绘制与编辑

- **形状**——矩形（<kbd>R</kbd>）、椭圆（<kbd>O</kbd>）、直线（<kbd>L</kbd>）、多边形、星形
- **钢笔工具**——绘制矢量网络（而非简单路径）以及带切线手柄的贝塞尔曲线
- **文本**——支持输入法的画布原生编辑；双击进入编辑模式
- **富文本**——可按字符设置粗体（<kbd>⌘</kbd><kbd>B</kbd>）、斜体（<kbd>⌘</kbd><kbd>I</kbd>）、下划线（<kbd>⌘</kbd><kbd>U</kbd>）和删除线
- **自动布局**——通过 Yoga WASM 实现 Flexbox 和 CSS Grid，支持方向、间距、内边距、主轴对齐、交叉轴对齐、子项尺寸和网格轨道；按 <kbd>⇧</kbd><kbd>A</kbd> 切换
- **组件**——创建组件（<kbd>⌥</kbd><kbd>⌘</kbd><kbd>K</kbd>）和组件集（<kbd>⇧</kbd><kbd>⌘</kbd><kbd>K</kbd>），实例支持覆盖和实时同步
- **变量**——设计令牌支持集合、模式（浅色/深色）、颜色/浮点数/字符串/布尔类型和变量绑定
- **区段**——用于组织内容的容器，可自动接纳子节点并显示标题标签

## 属性面板

“设计 | 代码 | AI”选项卡会根据当前上下文显示对应内容：

- **外观**——不透明度、统一或独立圆角、可见性
- **填充**——纯色、渐变（线性/径向/角度/菱形）、图像
- **描边**——颜色、粗细、对齐方式（内部/居中/外部）、各边独立粗细、端点、连接和虚线
- **效果**——投影、内阴影、图层模糊、背景模糊、前景模糊
- **排版**——支持虚拟滚动和搜索的字体选择器，以及字重、字号、对齐和样式按钮
- **布局**——启用自动布局后显示相应控制项
- **导出**——缩放比例、格式（PNG/JPG/WEBP/SVG）和实时预览

## 渲染

OpenPencil 使用 Skia（CanvasKit WASM），与 Figma 采用相同的渲染引擎：

- 渐变填充（线性、径向、角度、菱形）
- 带缩放模式的图像填充
- 使用逐节点缓存的效果
- 圆弧数据（部分椭圆、圆环）
- 视口裁剪与绘制对象复用
- 能感知旋转角度的对齐吸附参考线
- 带选区标记的画布标尺
- 跟随实际几何轮廓的悬停高亮

## 撤销与重做

创建、删除、移动、调整大小、属性修改、重新设置父级、布局修改和变量操作均可撤销。底层采用逆命令模式。按 <kbd>⌘</kbd><kbd>Z</kbd> 撤销，按 <kbd>⇧</kbd><kbd>⌘</kbd><kbd>Z</kbd> 重做。

## 多页面文档

添加、删除和重命名页面。每个页面拥有独立的视口状态，双击页面名称可就地重命名。

## 多文件标签页

在标签页中同时打开多个文档。按 <kbd>⌘</kbd><kbd>T</kbd> 新建标签页，按 <kbd>⌘</kbd><kbd>W</kbd> 关闭，按 <kbd>⌘</kbd><kbd>O</kbd> 打开文件。

## 导出

- **图像**——以可配置比例（0.5×–4×）导出 PNG、JPG、WEBP；可通过属性面板、上下文菜单或 <kbd>⇧</kbd><kbd>⌘</kbd><kbd>E</kbd> 操作
- **SVG**——支持形状、带样式区间的文本、渐变、效果和混合模式
- **Tailwind JSX**——导出使用 Tailwind v4 工具类的 HTML，可直接用于 React 或 Vue
- **复制为**——通过上下文菜单复制为文本、SVG、PNG（<kbd>⇧</kbd><kbd>⌘</kbd><kbd>C</kbd>）或 JSX

CLI：`openpencil export design.fig -f jsx --style tailwind`

## AI 聊天

按 <kbd>⌘</kbd><kbd>J</kbd> 打开 AI 助手。其精选的 50 多种工具可以创建形状、设置样式、管理布局、处理组件和变量、执行布尔运算、分析设计令牌并导出资源。你可以连接 Anthropic、OpenAI、Google AI、OpenRouter 或任何兼容端点。

工具调用会显示为可折叠的时间线条目。AI 助手能够渲染工作结果，并对照你的要求进行视觉验证。所有由 AI 产生的修改都支持撤销。

有关配置和模型服务商的详细信息，请参阅[AI 聊天](/zh-cn/programmable/ai-chat)。

## MCP 服务器

将 Claude Code、Cursor、Windsurf 或任何 MCP 客户端连接到 OpenPencil，即可无头读取和修改 `.fig` 文件。服务器通过 stdio 和 HTTP 提供 140 多种设计操作以及文档和文件生命周期工具。

```sh
npm install -g @open-pencil/mcp
```

```json
{
  "mcpServers": {
    "open-pencil": {
      "command": "openpencil-mcp"
    }
  }
}
```

完整工具列表请参阅 [MCP 工具参考](/zh-cn/programmable/mcp-server)。

## CLI

从终端检查、导出和分析 `.fig` 文件：

```sh
openpencil tree design.fig          # Node tree
openpencil find design.fig --type TEXT  # Search
openpencil export design.fig -f png     # Render
openpencil analyze colors design.fig    # Color audit
openpencil analyze clusters design.fig  # Repeated patterns
openpencil eval design.fig -c "..."     # Figma Plugin API
```

桌面应用运行时，可以省略文件名，通过 RPC 控制实时编辑器：

```sh
openpencil tree                     # Live document
openpencil export -f png            # Screenshot canvas
```

多数检查和报告命令支持 `--json`；纯写入命令不一定提供该选项。安装方式：`npm install -g @open-pencil/cli`（或 `bun add -g @open-pencil/cli`）。

## 实时协作

通过 WebRTC 进行点对点协作，无需服务器。分享链接即可共同编辑。

- 带彩色箭头和姓名标签的实时光标
- 在线成员头像
- 跟随模式——点击协作者即可跟随其视口
- 通过 IndexedDB 实现本地持久化
- 使用 `crypto.getRandomValues()` 生成安全房间 ID

## 桌面版与 Web 版

**桌面版**——基于 Tauri v2，大小约 7 MB。支持 macOS（已签名和公证）、Windows 和 Linux，并提供原生菜单、离线使用和自动保存。

**Web 版**——可在 [app.openpencil.dev](https://app.openpencil.dev) 使用；也可在移动设备上安装为 PWA，并提供针对触控优化的界面。

**Homebrew：**

```sh
brew install open-pencil/tap/open-pencil
```

## Google Fonts 回退

本地没有所需字体时，OpenPencil 会自动从 Google Fonts 获取，无需为含有陌生字体的 .fig 文件手动安装字体。
