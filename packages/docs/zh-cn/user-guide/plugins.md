---
title: 插件市场
description: 发现、验证、安装、授权、更新和回滚经过签名的 OpenPencil 插件。
---

# 插件市场

OpenPencil 插件系统分为两个明确隔离的层级：

1. **声明式贡献**：默认且最安全。清单只能描述受支持的模块、命令、导出器、连接器、存储服务商和配置，不能执行 JavaScript、注入 HTML/CSS、启动原生进程，也不能请求文件系统或网络权限。
2. **可执行运行时**：默认不可用。当前只允许发布者签名、市场索引授权、用户按精确摘要与完整只读能力列表授予权限的 WASM 计算包。JavaScript 包可以验证来源，但永远不会被执行。

每个 OpenPencil 构建都包含离线声明式目录。Fork 维护者还可以固定一个市场根公钥，自托管签名快照、发布者目录、stable/beta 渠道、搜索与追加式审计检查点，不依赖 OpenPencil 官网或官方账号。

## 浏览与安装

打开 **设置 → 插件**：

- **浏览**：显示内置与已验证远程条目，包括信任来源、版本和安装状态。
- **已安装**：管理启用、精确摘要固定、更新审查、回滚、依赖与移除。

配置远程市场根之后，页面还会显示 stable/beta 渠道、发布者与密钥身份、快照状态、审计头，以及该快照是否授权可执行运行时索引。搜索只匹配签名内容中的名称、摘要、分类、关键词、插件 ID 和发布者元数据，不会信任未签名搜索服务返回的身份信息。

当前 **Unreleased** 源码线包含 60 个经过审查的插件、63 项 contribution：20 个模块、
11 个命令、9 个导出器、22 个连接器与 1 个存储服务商。只有定义、渲染器、合同或导出源码
文件，并不代表插件已经可以使用；该 contribution 还必须完成中央主机注册。新配置中 Map、
Google Drive Storage、Compiler Preview Popout 与 AI Popout 默认安装并启用，其余内置插件都需要用户选择安装并启用。

- **Map**：新配置中默认安装并启用，创建可原生编辑的地图 `FRAME`，并通过经过审查的
  MapLibre React 适配器编译。
- **Google Drive Storage**：默认安装并启用的主机自有存储服务商声明。其清单不携带网络、
  OAuth 或可执行实现；请从 **设置 → 存储** 连接经过审查的桌面适配器。
- **Compiler Preview Popout（编译器预览悬浮窗）**：新配置中默认安装并启用，仅在
  Tauri 桌面应用中可用。使用 Compiler Preview 工具栏的 **Pop out** 可在独立窗口打开当前
  本机预览。插件不会收到 URL、窗口标签或原生窗口参数；宿主只从当前 Loopback 预览服务与路由
  派生 URL，并使用固定窗口参数。该 UI 命令不会暴露给 MCP。禁用或卸载插件会移除该入口，
  并关闭已打开的编译器预览窗口。
- **AI Popout（AI 独立窗口）**：新配置中默认安装并启用，仅在 Tauri 桌面应用中可用。
  在 **AI** 标签页点击弹出按钮，即可把当前对话放到独立窗口。AI transport、ACP 进程、
  凭据、文档上下文与工具执行仍只由主编辑器持有；独立窗只接收经过裁剪和脱敏的消息投影，
  并通过封闭动作集合请求宿主操作。禁用插件会移除入口并关闭独立窗口；该命令不会暴露给 MCP。
- **Chart**：可安装的参考图表模块，提供确定性的画布与编译器适配器。
- **Rich Text**：可安装、可编辑的富文本内容模块，提供经过审查的画布与编译器适配器。
- **</> HTML**：可选择安装的 HTML 内容模块。经过审查的适配器最多接受 65,536 个字符，
  并使用严格内容安全策略在无脚本沙箱中渲染；插件清单自身不能注入标记或可执行代码。
- **Video**：可安装的媒体模块，使用用户配置的公开 HTTPS 视频地址及可选封面；提供播放行为
  和尺寸相关的通用属性，但不会向插件授予网络或凭据能力。
- **Table**：可安装的结构化数据模块，可编辑表头，并支持最多 12 列、100 个正文行。单元格
  始终是有界纯文本，不会执行 HTML。
- **Slide Menu（滑出菜单）**：可安装的触发器模块，可以从左、右、上、下打开边缘菜单或
  模态弹窗。菜单项使用有界纯文本，只允许安全的文档路径、锚点或公开 HTTPS 地址。
- **Dropdown Menu（下拉菜单）**：可选择安装的扁平菜单，支持点击/悬停触发、12 种经过审查的
  弹出位置、项目/分隔线、快捷键提示，以及明确的禁用项和危险项。跳转地址可留空，或使用安全的
  文档路径、锚点或公开 HTTPS URL；v1 不支持子菜单或业务回调。
- **Upload Button（上传按钮）**：可选择安装的本地文件选择器，支持有界文件类型 token、
  文件数量与单文件大小限制、拖放和可选已选文件列表。它仅校验本地选择，不会上传或持久化文件内容。
- **Modal（模态弹窗）**：可安装的对话框触发器，提供有界纯文本标题和正文、可分别
  显示的触发图标/文字，以及可配置的关闭规则、底部操作、颜色和响应式宽度。
  它不接受 HTML、脚本、远程内容或凭据。
- **Lottie**：可安装的矢量动画模块，接受有界的内嵌 JSON 或规范公开 HTTPS 来源。画布
  始终离线；内嵌数据在本地加载，生成的 Web/React 只有在用户明确点击后才会请求 URL，
  并拒绝表达式、外部图片、音频和外部字体。
- **Carousel（轮播）**：可安装的无障碍轮播模块，支持 1–12 个有界幻灯片、安全链接、可选
  公开 HTTPS 图片、箭头/圆点、滑动或淡入淡出以及可控自动播放。Compiler 预览只有在用户
  明确点击后才挂载远程幻灯片媒体。
- **Advanced Data Grid（高级数据网格）**：可安装的类型化网格，支持有界文本、数字、日期、
  布尔数据，以及初始排序/筛选、分页、单选/多选、密度与外观设置。最多接受 16 列、200 行、
  2,000 个单元格，不会自行获取远程数据。
- **Tabs（标签页）**：可安装的无障碍标签页，支持 2–12 个有界纯文本面板、横向/纵向布局、
  自动/手动激活、初始标签页和外观设置。
- **Accordion（手风琴）**：可安装的折叠面板，支持 1–16 个有界纯文本项目、单项或多项同时
  展开，并会校验所有初始展开 ID。
- **QR / Barcode（二维码与条形码）**：在生成的 React 项目中本地生成真实二维码或 Code 128
  条形码。设计画布只绘制确定性的离线占位图，不能用于验证是否可扫码。
- **Markdown**：在生成的 React 项目中渲染最多 65,536 个字符的 CommonMark 或 GFM。
  原始 HTML 会被忽略，链接只允许安全锚点、根相对路径或公开 HTTPS 地址。
- **Code Block（代码块）**：把有界源码作为惰性纯文本展示，可配置语言标签、行号、换行、
  主题和复制按钮；不会执行代码、解释 HTML，也不提供语法高亮。
- **PDF Viewer（PDF 查看器）**：保存有界 PDF 来源、页码/适配提示、工具栏与下载策略。画布
  不会加载或解析 PDF；Compiler 预览必须由用户明确点击后才加载。
- **Audio Player（音频播放器）**：保存有界音频来源和播放设置。画布不会加载或解码音频；
  Compiler 预览必须由用户明确点击后才加载，启用自动播放时必须同时静音。
- **Clipboard Toolkit**：通过主机自有命令把当前选区复制为文本、SVG、JSX 或 PNG；没有
  活动选区时，这些命令不可用。PNG 使用浏览器图片剪贴板 API；当前 Tauri 权限集会明确
  提示不支持，不会把未完成的原生图片复制显示为成功。
- **Tauri React Exporter**：把当前文档生成的 React 源码与 Tauri 脚手架打包为 `.zip`
  源码归档。它不会运行 `npm`、`bun`、`cargo` 或生成的代码，也不会向插件开放文件系统或
  进程权限。
- **Expo React Native Exporter**：把当前文档中受支持的静态设计和原生控件外壳打包为
  真正的 Expo + React Native + TypeScript 源码工程，不使用 WebView 或 React Native Web
  套壳，不安装依赖，也不调用移动端构建工具。Web 专属或尚未原生适配的能力会记录在
  `EXPORT_WARNINGS.md`，不会静默冒充原生实现。
- **Flutter Exporter**：把当前文档中受支持的静态设计打包为 source-only 的 Dart + Flutter
  源码工程，直接生成 Flutter Widget 与导航源码，不使用 WebView，不安装依赖、不生成平台
  Runner，也不调用 Flutter 工具链；尚未支持的行为会写入 `EXPORT_WARNINGS.md`。
- **Static Accessibility Audit（静态无障碍审计）**：使用主机内置、结果有界的无障碍 lint
  规则检查当前文档。它不是完整 WCAG 符合性测试或认证，也不能替代屏幕阅读器、键盘焦点、
  运行时表单播报与动态状态测试。
- **Static Design System Audit（静态设计系统审计）**：Unreleased 主机命令，用于执行有界的
  设计令牌、组件变体、间距和排版一致性检查。它不会自动修改文档，也不是设计系统、品牌、
  字体许可或最终渲染认证；只有当前构建同时注册了内置清单和审查后的命令适配器时才会出现。
- **Design Tokens Exporter**：把已发布变量、集合、模式、类型、说明和值导出为确定性 JSON。
  `hiddenFromPublishing` 变量会被排除；导出范围内的 alias 会保留为 alias。若 alias 指向隐藏/
  缺失 token、形成循环，或某模式缺值，导出会安全失败，不会展开或伪造值。
- **Figma Editable Projection Exporter**：生成派生 `.fig` 投影，把可视内容转换为可编辑的
  Figma 原生图层，不修改 OpenPencil 源文档。OpenPencil 交互、模块行为和插件运行时不能在
  Figma 中执行，因此这不代表运行时可无损往返。
- **Next.js Exporter**：生成 source-only 的 Next.js + React App Router 工程。现有 React
  运行时在 catch-all 路由中以客户端方式挂载，不代表已经转换为 Server Component 或 SSR。
- **Vue Exporter**：生成 source-only 的 Vite + Vue 3 + TypeScript + Tailwind 工程，包括可编辑
  `.vue` SFC、多页面 Vue Router v4、本地 `src/assets/**` 图片，以及基础响应式状态、绑定和
  事件、路由/查询参数、Toast/Confirm 反馈、本地表单校验，以及 Modal、Dropdown Menu、Slide
  Menu 和仅限本地的 Upload Button 真实运行时。Vue v1 会把高级运行时缺口写入
  `EXPORT_WARNINGS.md`，不会宣称与
  React 完全等价。UI 与 MCP 共用一次性编译与 ZIP Worker；取消会终止当前 Worker，同时不会
  detach 编辑器仍在使用的图片缓冲区。插件导出器只会在精确摘要与再分发许可证审查通过后复用
  已保留、缓存或内置的字体字节，并在包含字体时生成 `FONT-LICENSES.txt`。
- **Capacitor Exporter**：生成使用相对资源与 Hash Router 的 Capacitor + React 源码工程，
  以适配原生 WebView 来源；不会生成 Android/iOS 平台工程，也不会调用 Gradle 或 Xcode。
- **Electron Exporter**：生成采用 Hash Router 的 Electron + React 源码工程，默认启用
  `contextIsolation` 和沙箱、禁用 Node integration；不会打包或签名应用。
- **Supabase Schema Inspector（Supabase Schema 检查器）**：通过经过审查的 Supabase
  Management API 权限读取有界、规范化的 Schema 目录。Bearer 凭据只保存在 OpenPencil
  中央凭据存储中；原始目录和凭据都不会写入设计文档。
- **Airtable Records（Airtable 记录）**：从已配置的 Base 与 Table 读取有界的一页记录，
  只能访问固定的 Airtable API 来源。返回字段会转换为有界的名称/值条目，不会把服务方的任意
  对象直接暴露给插件。
- **Supabase Tables（Supabase 表）**：对已配置项目执行经过审查且有界的表查询和行变更；
  不能自行选择任意主机、方法、路径、请求头或自由格式请求体。
- **Stripe Checkout & Billing（Stripe 结账与计费）**：读取有界的 Product/Price 信息，并可
  在每次重新确认后创建 Checkout Session。成功与取消地址必须是规范的公开 HTTPS URL。
- **Resend Email（Resend 邮件）**：读取有界的邮件状态，并可在每次重新确认后发送有界邮件；
  不支持任意端点、请求头、附件或流式请求体。
- 17 个**外部服务连接器**均为可选安装且只读：Neon Projects、Sentry Issues、HubSpot
  Contacts、Apollo Lists、PostHog Insights、Asana Workspaces、Zotero Top Items、HeyGen
  Avatars、Linear Issues、OpenAI Models、Box Root Items、Slack Public Channels、Google
  Calendar Events、SharePoint Root Site、Outlook Mail Folders、Outlook Calendar Events 与
  Microsoft Teams。每个连接器都只使用固定的主机审查请求和封闭结果 Schema；启用前请检查
  下方的凭据与最小 Scope 表。
- **Application Security Readiness（应用安全就绪检查）**：可选安装的本地命令，以只读、
  可取消、资源有界方式执行静态生产就绪检查。它只返回固定问题代码、数量和修复建议，不返回
  文档内容或秘密；它不是完整安全评估、渗透测试、认证或安全保证。
- **Vercel Deployment** 与 **Cloudflare Pages Deployment**：MCP 只会看到安全的部署计划
  审查命令。真实部署是单独的已安装插件 UI 操作，每次都必须重新人工确认；MCP 不能执行部署。

通常的操作顺序是：

1. 在 **浏览** 中选择插件并检查信任标签、发布者和摘要。
2. 安装插件。新安装的插件默认保持禁用。
3. 完成人工审查后启用插件。
4. 从编辑器使用对应入口：画布底部工具栏的 **插件** 菜单插入模块；**编辑 → Clipboard
   Toolkit** 执行复制命令；在插件启用后，从 **文件 → 导出** 选择 Tauri、Next.js、Vue、
   Capacitor、Electron、Expo React Native 或 Flutter 源码导出。当前构建完成相应中央注册后，
   审计和导出器也可从已启用插件卡片运行。已启用模块、Clipboard 命令、静态无障碍审计、
   静态设计系统审计、Application Security Readiness、两个安全部署计划审查、Design Tokens 与 Vue Exporter
   会暴露动态 MCP 工具。连接器卡片还会显示中央凭据状态、当前会话授权/撤销和经过审查的操作
   入口；只有同时完成安装、启用、保存凭据，并为当前会话授权精确的连接器/适配器/包摘要，
   对应只读查询才会进入 MCP。允许的合同只能是固定 `GET` 或主机明确审查的固定 `POST`；任意
   `POST` 与连接器变更都不能进入 MCP。撤权、清除凭据、禁用或卸载会立即移除工具。连接器变更
   始终只能从 UI 执行，并且每次都要求人工确认。Tauri、Next.js、Capacitor、
   Electron、Expo、Flutter 与 Figma 的同步 Compiler/编码阶段尚不能协作式取消，因此暂时只
   允许从 UI 运行，避免 MCP 超时后仍继续占用编辑器。Vue 源码导出在取消时会终止当前有界
   编译或 ZIP Worker，并把取消检查延伸到最终原子写入边界；只有插件已安装并启用时才进入 MCP，禁用或
   卸载后会立即撤销。Worker 快照超过 25,000 个节点、4,096 张图片或 32 MiB（包括每个完整
   二进制 backing buffer）会安全失败；Worker 输出和路径安全 ZIP 均保留 4,096 文件/64 MiB
   上限。
5. 对模块，在画布中编辑生成的原生 `FRAME` 与受控属性。

任何插件导出运行时，已安装插件卡片都会显示“选择位置、准备、编译、归档、保存或取消中”状态；
支持协作式取消的适配器还会提供可键盘操作的**取消**按钮。同一时间只允许一个插件导出。
导出结束前，OpenPencil 会阻止对当前插件执行禁用、更新、回滚和卸载；关闭后重新打开设置仍会
读取同一个主机导出会话，不会重复启动任务。

当前 Expo 静态 MVP 支持原生 `View`、`Text`、`Image`、`ImageBackground`、`Pressable`、
`TextInput` 与 `Switch` 外壳，基础行内布局和视觉样式，单页或 Expo Router 多页面文件，
以及静态图片。出现原生控件外壳不代表画布中编写的 Web 状态/动作
运行时已经完成移动端翻译。全部 20 个插件模块、Motion 与
原型效果、原始 SVG、上传、Supabase/服务端工作流、分析与 Stripe、持久化、高级表单校验、Overlay、响应式、
Hover、Custom CSS 以及其他只适用于 DOM/Tailwind 的行为，目前都会留下明确警告，等待
后续原生适配。
当前移动端源码 ZIP 会省略所有字体文件。现有精确许可证据只记录 SPDX 标识，不包含字体
专属版权声明、完整许可文本或必要 NOTICE，因此不足以安全再分发字体字节。每次省略都会在
`EXPORT_WARNINGS.md` 中列出字体 family、资源路径和已知 SPDX 标识；OpenPencil 不会伪造
缺失的法律声明。

当前 Flutter 静态 MVP 会生成标准 `pubspec.yaml`、`lib/main.dart`、页面/组件 Dart 文件，
以及可移植的图片资源。多页面工程使用集中式 Flutter Router，并保留正常的
`Navigator` 返回栈。源码 ZIP 不再分发字体字节，字体引用会回退到设备可用字体；此外该
Flutter target 也不支持 WOFF 和 WOFF2。ZIP 刻意不包含 `android/`、`ios/`
Runner，也不是 APK、AAB、IPA 或签名应用。

解压后，先备份（或提交）生成源码，再使用本机安装的
[Flutter CLI](https://docs.flutter.dev/reference/flutter-cli) 补齐平台 Runner。从导出目录
根部执行以下命令，并在继续前检查 `lib/`、`assets/` 与 `pubspec.yaml` 仍保留 OpenPencil
输出：

```sh
flutter create --platforms=android,ios --project-name <dart_package_name> --no-pub .
flutter pub get
dart format lib test
flutter analyze
flutter run
```

请把 `<dart_package_name>` 替换为生成的 `pubspec.yaml` 中 `name:` 的准确值。
`flutter create` 只在导出后由用户用于补齐平台启动文件；OpenPencil 不会运行它。把生成
应用视为功能完整之前，还应先检查 `EXPORT_WARNINGS.md`。

Rich Text 插入后会自动选中。在右侧 **设计 → 模块** 面板中可直接添加、排序和转换段落、
标题、引用、代码块与列表，并用格式按钮设置粗体、斜体、下划线、删除线、行内代码和安全
链接，不需要手写 JSON。插件设置页中的操作按钮继续保留，作为管理与诊断入口。

在 Compiler 预览以及导出的 React/Tauri 项目中，同一个模块会变成可直接输入、符合无障碍
语义的富文本编辑器，并显示格式工具栏。当前 v1 支持正文、H1–H3、引用、代码块、粗体、
斜体、下划线、删除线、行内代码、有序/无序列表、左/中/右对齐、安全链接、清除格式以及
撤销/重做。粘贴和拖放只接受纯文本，复制进来的 HTML 不会注入图片或脚本。编辑器通过隐藏
表单字段和 `openpencil:rich-text-change` DOM 事件提供有界 JSON 值，并能在普通父级 React
重渲染后保留内容。运行时编辑不会自动回写 `.fig`，页面刷新后也不会自动持久化；生成应用
需要接收并保存该值，才能实现业务数据持久化。

安装并启用 **</> HTML** 后，从画布的 **插件** 菜单插入模块，再在 **设计 → 模块** 中编辑
`HTML` 字段。代码输入框会在输入时同步更新不可交互的沙箱预览；输入框失焦或按下
**Cmd/Ctrl+Enter** 时，才会把有界内容提交到文档。外部文档值变化会同步回编辑器，无效值
会显示错误，不会替换最后一份有效模块配置。

Compiler 预览与导出的 React/Tauri 项目会把同一份有界源码和严格 CSP 放进 iframe，既不
授予脚本权限，也不授予同源权限。编辑器预览还会禁用指针事件并使用 `no-referrer`。这是
用于文档内容的、经过审查的主机适配器，不允许插件清单向 OpenPencil 主 WebView 注入
HTML、JavaScript、CSS、权限或新的运行时。

安装 **Video** 后，从 **插件** 菜单插入，再在 **设计 → 模块** 中配置公开 HTTPS 视频
地址。Compiler 预览在你点击 **加载视频预览** 前不会挂载视频或封面地址；生成的 Web/Tauri
项目则通过浏览器原生视频元素加载配置地址。激活预览或运行导出应用后，媒体服务器可以看到
访问者 IP 与普通 HTTPS 请求元数据。初始 URL 会拒绝本地主机、IP 字面量、凭据、片段和非
HTTPS 协议，但 DNS 与重定向仍由媒体服务器和访问者浏览器控制，因此只能使用你信任的媒体
主机，且视频和封面 URL 中不得包含凭据、访问令牌或私密数据；查询参数会原样保存在 `.fig`
文档与生成源码中，不会被当作秘密处理。浏览器自动播放策略仍可能要求静音播放或先由用户操作。

安装 **Table** 后，在 **设计 → 模块** 中编辑表头和正文单元格、增删行列，并查看实时尺寸
与字符计数。编辑器与 core 校验器共同限制为最多 12 列、100 行、每个单元格 2,000 个字符，
且总计不超过 100,000 个字符。提交值是结构化表格数据而不是 HTML；单元格中的标签会按
纯文本显示，绝不会作为标记或脚本执行。

安装 **Slide Menu（滑出菜单）** 后，可在 **设计 → 模块** 中选择 **menu** 或 **dialog**，
设置从左、右、上、下进入，并编辑触发文字、标题、说明和菜单项；三横线矢量图标与触发文字可
分别显示或隐藏，同时还可设置面板尺寸、颜色、遮罩透明度、点击遮罩关闭和关闭按钮。即使两项
都隐藏，生成的 React 与 Vue 按钮仍会把配置的触发文字保留为无障碍名称。Compiler 预览与导出的
React/Vue/Tauri 项目会在点击画布中的触发器后，
通过本地 `document.body` portal 打开面板。Escape 始终可以关闭；打开时键盘焦点限制在面板内，
关闭后回到触发器；用户启用减少动态效果时会取消滑动过渡。菜单地址只接受以 `/` 开头的文档
路径、以 `#` 开头的页面锚点或规范的公开 HTTPS URL，所有文字都按纯文本显示。

安装 **Dropdown Menu（下拉菜单）** 后，可在 **设计 → 模块** 中配置点击或悬停触发、
12 种弹出位置、关闭规则、宽度、颜色，以及触发文字/箭头。专用项目编辑器使用可折叠分组，
把 **添加项目** 与 **添加分隔线** 分开，并可编辑纯文本标签、跳转地址、快捷键提示、禁用状态和
危险状态。必须至少保留一个真实项目，总条目最多 20 个；禁用和危险状态同时使用文字与复选框，
不会只依赖颜色。v1 明确为扁平菜单，不接受子菜单树、HTML、脚本、业务回调或凭据。只有插件
已经安装并启用时，MCP 才会显示添加模块工具；停用或移除后会立即撤销。Compiler 预览与导出的
React/Vue/Tauri 项目会生成真实菜单运行时，支持方向键、Escape/Tab/外部点击关闭，以及安全的
本地或公开链接。

安装 **Upload Button（上传按钮）** 后，可在 **设计 → 模块** 中编辑触发器、允许的文件类型、
单选/多选、数量与单文件大小限制、拖放、已选文件列表、帮助文字和颜色。文件类型按 token 逐项编辑，
例如 `.png`、`image/*` 或 `application/pdf`；重复项和无效项不会写入文档。浏览器的 `accept`
属性只是文件选择器提示，生成的运行时仍会逐个校验类型、数量和大小。该模块只在用户设备上选择文件：
它不会上传、持久化、显示传输进度或宣称成功。需要服务器存储时，请使用现有的低代码 **INPUT + Supabase 上传**
路径。只有插件已安装并启用时，MCP 才会显示添加模块工具，且参数与结果仅包含声明式配置，绝不包含已选文件名或文件字节。
生成的 React/Vue/Tauri 项目使用相同的本地校验与“尚未上传”明确状态。

安装 **Modal（模态弹窗）** 后，可在 **设计 → 模块** 中编辑触发器、标题、多行正文、
关闭按钮/Escape/遮罩关闭规则、取消与确认文字、底部对齐、颜色、遮罩透明度和
面板宽度。Compiler 预览与导出的 React/Vue/Tauri 项目会通过本地 `document.body` portal
打开响应式弹窗；打开时限制键盘焦点，关闭后将焦点还给触发器，并在用户启用
减少动效时取消过渡。右上角关闭控件和底部操作都是可键盘操作的原生按钮；
v1 中的取消和确认只会关闭弹窗，不暗示已执行应用变更或回调。Canvas 保持离线且确定；
Expo/Flutter 在原生弹窗实现前只输出明确不可交互的静态触发器。所有配置文字均按有界
纯文本显示，绝不会被当作 HTML。

安装 **Lottie** 后，在 **设计 → 模块** 中选择 `url` 或 `json`，并配置循环、自动播放、速度、
方向与填充方式。Canvas 占位预览绝不请求网络。有界内嵌 JSON 会在本地加载；Compiler 预览与
生成的 Web/React 输出只有在点击 **Load Lottie animation** 后才执行公开 HTTPS 请求，重试也必须由用户发起；
系统开启减少动态效果时会禁止自动播放。校验器只接受有界矢量子集，外部资源、表达式、音频
和外部字体会安全拒绝，不会继续交给渲染器。

安装 **Carousel** 后，在 **设计 → 模块** 中编辑有界 `Slides` JSON 和无障碍标签，再设置初始
幻灯片、过渡、自动播放间隔、循环、箭头/圆点、悬停暂停与颜色。每个幻灯片包含纯文本标题/
说明、可选公开 HTTPS 图片（使用图片时必须提供替代文本），以及可选文档路径、锚点或公开
HTTPS 目标。Compiler 预览必须点击 **Load remote slide media** 后才挂载图片；生成的 Web/React
适配器提供键盘可操作控件、暂停/继续、当前幻灯片播报与减少动态效果处理。

安装 **Advanced Data Grid** 后，在 **设计 → 模块** 中编辑类型化 `Grid data`、可选初始排序/
筛选、分页大小、选择模式、密度、表头、斑马纹与颜色。行列 ID 必须是稳定的有界标识符，每个
单元格必须匹配该列声明的文本、数字、日期或布尔类型。生成的 Web/React 表格针对这些静态
编写数据提供无障碍排序、筛选、分页与行选择；它不是远程数据库连接器。

同一个属性面板还提供有界 CSV 工具。**粘贴 CSV** 接受不超过 192 KiB 的 UTF-8 逗号分隔
文本，保留既有列定义，并要求每个表头与对应列的标签或 ID 完全一致。数字必须使用与地区
无关的 JSON 数字格式，布尔值只能是 `true` 或 `false`，日期格式为 `YYYY-MM-DD`；非文本列
中的空字段会转换为 `null`。编辑器导入成功后会替换已编写的行，写入设计文档并加入撤销历史。
**准备 CSV 文本**只生成只读文本供用户手动复制，不申请文件或剪贴板权限；类似电子表格公式
的文本字段会先加前缀以降低公式注入风险。生成的 React 应用中，粘贴导入只影响当前运行会话，
不会回写设计，也不会在页面刷新后保留。

安装 **Tabs（标签页）** 后，在 **设计 → 模块** 中编辑带标签的项目，选择横向/纵向布局和
自动/手动激活方式。生成的 React 输出使用 tablist、tab 与 tabpanel 语义，并采用游走焦点：
方向键、Home、End 用于移动焦点；手动模式下按 Enter 或 Space 才会激活标签页。面板内容是
有界纯文本，不会按 Markdown 或 HTML 解释。

安装 **Accordion（手风琴）** 后，可编辑标题与内容，选择只展开一项或允许多项展开，并设置
有效的初始展开 ID。生成的 React 输出提供 `aria-expanded`、`aria-controls`，方向键、Home 与
End 可在标题按钮之间移动焦点。每个面板的内容仍是有界纯文本。

安装 **QR / Barcode** 后，可选择 QR 或 Code 128，设置编码值、说明文字、颜色、容错级别和
静区。QR 最多接受 2,048 个字符；Code 128 最多接受 128 个可打印 ASCII 字符。画布图案只是
确定性占位图；生成的 React 代码会使用随项目声明的库在本地生成真实编码，不发起网络请求。
正式使用前仍应使用扫码设备验证结果。

安装 **Markdown** 后，可编辑 CommonMark 或 GFM 源码、链接打开方式、颜色、字号和行高。
画布只显示有界纯文本近似预览。生成的 React 输出会跳过原始 HTML，只允许安全锚点、根相对
路径和规范公开 HTTPS 链接；不安全的目标会退化为普通文字。Markdown 图片语法只显示惰性的
替代文本占位，不会加载 `src`；需要远程媒体时应使用经过审查的图片节点或显式媒体模块。这是
展示模块，不是会回写设计的富文本编辑器。

安装 **Code Block（代码块）** 后，可编辑惰性源码文本，并设置语言标签、明暗主题、行号、
换行、复制按钮、字号、Tab 宽度和颜色。语言选择只属于元数据与展示：当前适配器不会执行、
编译、校验或语法高亮代码。生成的复制按钮只在浏览器剪贴板可用时写入，失败会明确提示。

安装 **PDF Viewer** 后，可配置安全根相对路径或规范公开 HTTPS 来源，以及标题、初始页/页数
提示、适配方式、工具栏、下载和颜色。画布只显示不加载网络的纸张与元数据占位。Compiler
预览只有在点击 **Load PDF preview** 后才挂载 URL；导出的 Web/React 项目通过沙箱 iframe
交给浏览器显示 PDF，因此页码控制和格式支持取决于具体浏览器。URL 中不得包含凭据或秘密。

安装 **Audio Player** 后，可配置安全根相对路径或规范公开 HTTPS 来源，以及标题/作者、
控件、循环、静音、预加载、音量、播放速度和颜色。画布只显示惰性波形占位。Compiler 预览
只有在点击 **Load audio preview** 后才挂载 URL；导出的 Web/React 项目使用浏览器原生音频
元素。浏览器自动播放策略仍然有效，模块校验器还要求自动播放必须同时静音。

**静态设计系统审计**引擎会生成可取消、结果有界的报告，覆盖 token 集合/模式一致性、缺失或
类型不匹配的 alias/绑定、组件集变体结构、建议的 4px 间距尺度，以及过宽的字体家族/字号
尺度。单次最多扫描 25,000 个节点、10,000 个变量、1,000 个集合和 1,000 条问题详情，报告
上限为 512 KiB；达到上限会明确标记截断。它不会检查运行时主题解析、语义命名与治理、交互
状态视觉正确性、字体许可或字形覆盖、响应式/文本 style run 输出，也不会认证最终渲染结果。
只有完成中央目录和主机适配器注册的 Unreleased 构建才会显示该命令。

Unreleased 的 **Next.js**、**Capacitor** 和 **Electron** 导出器只生成源码 ZIP，不安装依赖、
不启动开发服务器、不执行生成代码、不生成平台二进制，也不配置生产签名。Next.js 保留客户端
运行方式，不宣称完成 SSR 转换；Capacitor 需要开发者在导出后自行添加并审查 Android/iOS
平台工程；Electron 虽然默认隔离渲染器，发布前仍需按具体应用审查打包、权限、更新和签名流程。
开始构建前请阅读归档内的 `README.md` 和 `EXPORT_WARNINGS.md`。

**Vue Exporter** 同样只创建源码 ZIP，不安装依赖、不运行生成应用，也不启动 Vite。Vue v1
输出可移植图片、可编辑组件、Vue Router v4 页面、路由/查询读取和安全的参数化导航、基础响应式
状态/绑定/事件、Toast/Confirm 反馈、本地表单校验，以及 Modal、Dropdown Menu、Slide Menu
和仅限本地的 Upload Button 真实运行时。Toast 支持 info/success/error、六个位置、持续时间、
去重、关闭和具有无障碍语义的有界消息栈；Confirm 保留自定义按钮文字与两个结果分支，支持点击
遮罩或 Escape 取消、键盘焦点约束及关闭后的焦点恢复。本地校验支持 required、pattern、长度与
数值上下限和自定义表达式，提供行内/汇总错误与 `aria-invalid`、`aria-describedby`，无效提交不会
执行已编写的 submit handler。远程异步校验不会请求配置的 URL，而是显示通用不可用错误、阻止
提交，并在 `EXPORT_WARNINGS.md` 中加入 `vue-validation-async-unsupported`。无路由的单页面
导出会把路由/查询上下文保持为空并给出警告。作者提供的原始 HTML 会被替换为空静态外壳，并
生成 `vue-raw-html-unsupported`；导出器不会把这段内容写入 `v-html`。其他插件模块、Motion、
Prototype 与 Overlay、Supabase/Auth/服务端工作流、Stripe、i18n、Analytics、React UI Kit、
主题切换和文档状态持久化仍会被省略或降级，并生成确定性的 `vue-*-unsupported` 警告。

插件导出器的无网络字体阶段只复用渲染器已保留、导入/下载缓存中已有，或作为经过审查资源随包
提供的精确字节。每个候选都会检查 OpenType 嵌入标志与 SHA-256 摘要；只有再分发许可证、版权
声明和完整 NOTICE 都通过审查的字体才会复制到工程，并同时生成 `FONT-LICENSES.txt`。受限、
不匹配或材料不完整的字体会留下明确警告并被省略，原有字体族 CSS 保持不变。在把工程视为生产
完成前必须审查 `EXPORT_WARNINGS.md`。超过 Worker 边界的文档需要先缩小或拆分；导出器不会
静默回退到同步编译。

开发或自动化场景可在 `openpencil compile`、`openpencil build` 和 `openpencil deploy` 上使用
`--target vue`；默认仍是 React。桌面 Compiler 预览的 **Target** 控件可在 React 与 Vue 3 间
切换，并重启对应 sidecar。Vue 支持静态 Vite 构建以及 Netlify、Vercel 或 Cloudflare Pages
部署，但 React 专属的 `--i18n`、locale 与 `--ui-kit` 选项会被明确拒绝，不会静默忽略。

在编辑器 Preview 中，React 与 Vue 都会高亮画布选区，支持用 Alt/Option 点击预览元素后在
画布中选中它，双向同步页面导航且抑制回声，同步协作文档状态，并立即应用 Light/Dark 主题。
该桥接只存在于编辑器 Preview，源码/静态导出不会包含它。Vue 仍没有 Motion runtime，因此
Motion Debug 会立即显示**不可用**，不会一直停在等待状态。

静态构建只会写入不存在/为空的输出目录，或替换带有上一次 OpenPencil 成功构建所写入的有效
普通文件 `.openpencil-build-output.json` 标记，且当前完整文件集合仍与该清单完全一致的目录。
非空且未标记的目录、不受信标记，以及存在缺失或额外文件的已标记目录都会被拒绝，不会删除其中
内容；请改用空目录，或人工审查后自行处理无关文件。

Expo 与 Flutter 源码导出不会为任何插件模块引入 WebView，包括 **Lottie**、**Carousel**
、**Advanced Data Grid** 以及上面七个 Unreleased 内容模块。在经过审查的原生适配器就绪前，
它们会生成明确的不支持功能警告，并保留不包含交互模块行为的静态原生 fallback，不会在移动
应用中静默嵌入浏览器表面。

安装和启用是两个独立步骤。启用后，经过审查的模块、命令、导出器、连接器与存储服务商声明
才可使用；其中只有模块会出现在工具栏以及 `list_modules` / `create_module` 的发现结果中。

::: warning 注意
有效签名只能证明“谁发布了这份内容”以及内容未被篡改，不能证明插件安全，也不能自动提供画布/编译器适配器，更不代表已经取得执行权限。
:::

如果一个目录条目没有与当前 OpenPencil 构建兼容的、经过审查的 contribution 适配器——包括
模块、命令、导出器、连接器或存储服务商——商店仍会显示该条目用于诊断，但会禁止激活。必须
安装包含对应适配器的 OpenPencil 构建。清单可以声明适配器名称，但不能携带或执行适配器。

清单 Schema v1 中的贡献保持纯声明式：`contributions.modules` 描述原生 `FRAME` 模块，
`contributions.commands` 描述具名主机操作，`contributions.exporters` 描述具名导出操作与
安全文件扩展名。清单能力列表仍为空。每个贡献都必须精确匹配应用启动时注册并冻结的主机
适配器；贡献不会获得任意编辑器、文件系统、网络、Tauri 或进程 API。

Manifest API v2 是命令、导出器、连接器与存储服务商的安全 contract 基础：它增加有界且封闭的参数/结果
JSON Schema、`contributions.connectors`、固定的 `document.read`、`document.selection.read`、
`document.variables.read`、
`file.save` 权限词表，以及明确且安全的导出扩展名/MIME 组合。`file.save` 只能到达经过审查
的主机保存边界，并不存在通用 `document.write` 权限，顶层 capability 列表也继续保持为空。
API v2 不是通用插件 SDK，不开放任意
JavaScript、通用网络访问、不受限文档写入或自定义 UI；每个 contribution 仍必须映射到精确
的主机审查适配器。内置目录现在有意混用版本：既有 contribution 继续使用 Schema v1；静态
无障碍审计、Unreleased 静态设计系统审计、Design Tokens 导出与 Figma 可编辑投影使用
Schema v2，将参数、结果、权限和输出绑定到已审查的主机适配器。存储服务商 contribution
只能包含精确的 `providerId`、`name`、`description`、`adapterId`、`configVersion` 与
`capabilities` 键；`capabilities` 只能是 `documents.read`、`documents.write`、
`documents.delete`、`changes.read`、`uploads.resumable` 的有界子集。这些字段只是主机兼容性
元数据，不是插件权限；v2 清单仍不能携带网络、OAuth 或可执行实现。Google Drive Storage 是
内置的 Schema v2 存储服务商声明。

## 使用 Google Drive 的云文档

**Google Drive Storage** 在新配置中默认安装并启用，但实际行为全部由经过审查的主机自有
适配器提供。Fork 发布者通过 `VITE_GOOGLE_DRIVE_CLIENT_ID` 在构建时提供公开的
Google Desktop OAuth Client ID。在桌面应用打开 **设置 → 存储 → Google Drive**，再选择
**连接**。Desktop OAuth Client 是
[公开的已安装应用客户端](https://developers.google.com/identity/protocols/oauth2/native-app)：
OpenPencil 只需要 Client ID，不会内置 Client Secret。应用会打开系统浏览器，通过临时 Loopback
回调完成带 PKCE 的 Authorization Code
流程，并且只请求 `openid`、`email` 与 `drive.file`。`drive.file` 只允许适配器访问由本应用
创建或用户明确用它打开的文件，并不是整个 Drive 的访问权。Refresh Token 保存在应用本地
IndexedDB 中，并使用 AES-GCM 与不可提取的 WebCrypto 密钥加密；绑定只记录非秘密的账号身份与
授权版本。Tauri 开发版和正式版都会直接选用这一加密应用存储，它不是原生凭据库失败后的回退，
并且不使用 macOS 钥匙串。浏览器版暂不支持 Google Drive 授权。

从使用钥匙串的旧构建升级时，OpenPencil 不会自动迁移或删除原有的 macOS 钥匙串项目。首次使用
时请重新连接 Google Drive，并重新录入其他已保存凭据；旧项目会保持不变，直至你另行移除。

每个存储服务最多可保存 8 个具名配置。每个配置都有独立的 OAuth 账号或 S3 凭据、非秘密服务
设置、本地文档索引、Change Cursor 与持久同步权限。切换配置时会先取消旧界面的异步工作，再
展示新账号；不同配置之间不会迁移或复用秘密。

云存储只有在两层持久化都实际证明可持久时才可用。执行打开、新建、刷新、保存、删除、断开
账号、删除配置或旋转 S3 配置世代之前，OpenPencil 都会分别对本地文档索引与 Outbox 执行实时
IndexedDB 探测；数据库打开和真实事务都必须成功。生产环境的内存回退不会被当成持久存储：云端
工作区会进入只读恢复状态，上述操作全部阻止，界面会提示把已经打开的工作导出为本地 `.fig`。
在这种状态下，OpenPencil 不会声称离线编辑或排队任务能够跨重启保留。

重新连接同一个 Google 账号时，OpenPencil 会先检查当前授权下的本地缓存与持久任务。存在
未同步、冲突或排队任务时，设置界面会在打开系统浏览器前要求确认。Google 返回同一个 OIDC
账号后，应用会把全部缓存文档和任务迁移到新的随机授权版本并恢复同步；如果应用恰好在 OAuth
与迁移之间退出，设置界面会识别同账号的旧授权并提供修复操作。仍有未完成工作时，断开连接或
删除配置都会失败关闭，避免丢失恢复这些工作的凭据。

文档以普通、用户可见的 `.fig` 文件保存到 Drive，不是隐藏的 app-data blob。通过持久化门禁
后，保存会先写本地缓存，再记录持久 Outbox 任务，因此离线修改与待上传任务可在应用重启后
恢复。大文件使用可恢复上传。每个账号都有有界的增量 Change Cursor，用于轮询相关远程变化；
这不是基于推送的实时协作。在存储工作区删除文档时，会先在本地隐藏并持久记录删除任务，之后
同步到 Google Drive 回收站。为避免丢弃未保存编辑或把文档重新写回，删除前必须先关闭它的
编辑标签页。

持久 Outbox 任务可以跨重启恢复，但可恢复上传的 Session URL 刻意只保留在当前进程，不会
写入日志或本地存储。如果 Drive 可能在应用崩溃前刚好完成上传，但 OpenPencil 来不及持久记录
返回结果，重启恢复会把这份数据保留为冲突副本，而不是猜测原文件可以安全覆盖。这可能产生看似
重复的恢复文件，但不会静默丢弃任一可能结果。

更新已有文件时，适配器会比较预期远程 revision，并用当前 ETag 执行条件更新。如果 revision
已经改变、缺少可用的条件更新依据，或 Drive 报告并发写入冲突，OpenPencil 会保留原远程文件，
另建带时间戳的 `.fig` 冲突副本。因此 Google Drive 是整文档、最终调和的存储目标，不是强一致
协作后端或 CRDT。多人需要同时编辑同一文档时，请使用专门的实时协作能力。

S3-compatible storage 仍是 AWS S3、Backblaze B2、Cloudflare R2、MinIO 及兼容服务的高级
自托管备选。它需要配置 Endpoint、Bucket、Region 和凭据，也不继承 Google Drive 的
revision/change-feed 保证。每个 S3 配置还拥有稳定的配置身份和随机配置世代；修改 Endpoint、
Bucket、Region 或凭据会旋转世代。存在待同步、冲突或待删除工作时，设置界面会阻止修改；旧世代
任务也会失败关闭，绝不会被投递到新 Bucket。
旧版不带 authority 的配置首次采用精确世代时，设置界面会展示准确的 Endpoint、Bucket 与受
影响工作量，并要求显式确认。这个可重启迁移会在本地文档库内原子重建文档元数据、`.fig` 数据
和缩略图的世代键，并在 Outbox 内原子替换匹配任务。只要出现键碰撞、不兼容目标或跨世代状态，
迁移就会失败关闭；完成前会一直阻止修改 Endpoint、Bucket、Region 或凭据。

::: warning 发布前验证
自动化 contract、adapter 与原生 Bridge 测试不能证明真实 Google OAuth Client/账号流程。
正式发布前，请使用真实 Google Desktop OAuth Client 与两个测试账号逐项完成以下验收：

1. 通过系统浏览器连接，核对授权页仅包含 `openid`、`email` 与 `drive.file`；重启桌面应用后，
   同一配置应能恢复连接，界面和日志都不得暴露 Refresh Token。
2. 创建并重新打开一个 Drive 中可见的 `.fig`；离线编辑并在 Outbox 待同步时重启，恢复网络后
   应继续显示进度，且不得静默覆盖或丢失数据。普通、结果明确的待同步任务不应产生重复；
   若人为模拟“远端可能已成功、本地尚未记录”后立即崩溃，则允许保留命名清晰的冲突副本。
3. 中断多分块上传和下载；恢复后各 Range 必须绑定同一个强 ETag，最终文档能够正常解析。
4. 使用两个具名配置连接不同 Google 账号并来回切换；文档、Cursor、凭据和队列任务不得跨越
   账号或授权版本。随后在某账号有待同步编辑时执行重新连接，确认迁移后验证同一任务在新授权
   下继续；除非人为制造了无法确认的远端结果，否则不应重复上传。在结果不明时，冲突副本是预期的安全结果。
5. 用另一客户端修改同一远程文档；OpenPencil 必须创建带时间戳的冲突副本，而不是覆盖任一方。
6. 关闭编辑标签页后从存储工作区删除文档，覆盖离线队列与重启恢复，再确认文件进入 Drive
   回收站并可从回收站恢复。
7. 在 Google 端撤销授权；OpenPencil 应提示重新连接而不是盲目重试，并检查日志与应用本地
   IndexedDB，确认其中不含 Access Token、Refresh Token 或可恢复上传 Session URL 的明文；
   在 macOS 上还应确认 OpenPencil 没有新建钥匙串项目。
   :::

## Application Security Readiness（应用安全就绪检查）

安装并启用 **Application Security Readiness** 后，可从插件卡片或动态注册的 MCP 命令运行
本地静态检查。命令只扫描公开的低代码结构和有界运行时就绪信号，覆盖配置、数据访问、传输与
服务端形态、隐私和自定义代码。它只读、支持协作式取消，并限制扫描资源。固定结果只包含问题
代码、严重级别、数量与静态修复建议，不回显文档内容、输入值、凭据或其他秘密。

这只是早期生产就绪信号，并不是完整应用安全评估、渗透测试、依赖或基础设施扫描、合规认证，
也不是安全保证。本地 MCP 命令只要求安装并启用插件，不需要凭据或连接器会话授权；禁用或卸载
后，MCP 命令会立即消失。

## 经过审查的部署插件

可选安装的 **Vercel Deployment** 与 **Cloudflare Pages Deployment** 刻意把计划与部署隔离：

- 动态 MCP 命令 `review-vercel-deployment-plan` 与
  `review-cloudflare-pages-deployment-plan` 只校验并展示有界计划，不解析 Token、不构建文档、
  不发送网络请求，也不改变本地或远端状态。
- 真实部署只能从已安装插件卡片运行。每次都必须重新人工确认服务商、目标、环境和审核文档；
  OpenPencil 会在确认后及凭据读取后再次核对文档身份，只有核对通过才会构建并上传静态文件。
- Vercel 需要人工创建账号 Token；Cloudflare Pages 需要人工创建 API Token，并填写目标
  Account ID 与 Project Name。首次验证请使用最小权限 Token 和非生产目标。
- MCP 不能调用真实部署适配器。UI 在上传发出后被中断时，远端结果可能未知；重试前必须到服务商
  控制台核验。
- 关闭或切换设置页不会丢失部署进度和有界结果。远端部署进行中不能禁用、更新、回滚或卸载插件；
  若部署中执行 Save As，结果与历史仍归属审核时的原文档，不会静默记到新文档。

安装并启用任一插件只会把安全计划命令加入 MCP；禁用或卸载会立即移除。计划审查不读取凭据，
但真实 UI 部署必须存在凭据；清除凭据后，后续部署不会开始。

## 业务连接器

Phase 2 Broker 已让 22 个内置连接器可以执行：原有的 **Supabase Schema Inspector**、
**Airtable Records**、**Supabase Tables**、**Stripe Checkout & Billing**、**Resend Email**，
以及 17 个可选安装的只读外部服务连接器。它们是经过主机审查的窄集成能力，不是任何发布者
都能申请的通用网络权限。

这些连接器是 OpenPencil 编辑器中的本地、设计时操作者工具；它们不会被编译进生成应用，
也不是服务端连接器运行时。凭据不会进入插件清单、设计文档、Compiler 输出、审计日志或长期
响应式 UI 状态，但 renderer 侧经过审查的请求路径会在发出调用时把凭据解析到内存。桌面端使用
AES-GCM 与不可提取的 WebCrypto 密钥加密应用本地 IndexedDB 记录，并通过有界的 Tauri 代理
传输；这**不等于服务端秘密隔离**，也不声称能抵御已受损的 renderer。请使用最小权限的开发
凭据（Stripe 优先使用受限密钥），生产应用秘密应留在你自己运维的
基础设施中。生成应用的服务端连接器属于后续阶段。

使用步骤如下：

1. 打开 **设置 → 插件**，安装并启用连接器。
2. 在已安装插件卡片中输入或替换所需凭据。OpenPencil 只通过中央凭据管理器保存秘密；插件
   清单、设计文档、Compiler 输出和长期 UI 状态都不会保留原始 Token。
3. 检查连接器身份与权限范围，然后为**当前会话**选择**授权**。授权会绑定精确的插件 ID、
   连接器 ID、经过审查的适配器 ID 与已安装包摘要；版本或摘要变化后必须重新授权。授权存在时，
   符合条件的固定 `GET`，或经过主机明确审查的固定 `POST` 只读查询，也会使用同一份已保存
   凭据向已连接的 MCP/AI 客户端开放。任意 `POST` 不允许进入 MCP。
4. 从连接器卡片启动列出的操作。明确授权后的查询也可以显示为动态 MCP `query` 工具。
   变更操作不会进入 MCP，只能从 UI 发起，而且每次执行都必须重新人工确认。
5. 使用完毕后选择**撤销授权**、清除凭据、禁用或卸载。这些操作会移除相应 MCP 查询工具，并停止本地
   等待仍在执行的匹配请求。已接受包摘要发生变化时，旧授权同样会失效，并停止使用旧身份启动
   的本地在途工作。查询可以记为已取消；但变更请求一旦发出，之后若发生取消、超时、撤权或
   本地响应处理失败，远端结果会明确标记为未知，重试前必须先到对应服务中核验。

### 可选安装的外部只读服务

对于新增的 17 项能力，OpenPencil 不会自动完成服务商 OAuth Consent、Token Exchange、Refresh、
租户批准或敏感 Scope 验证。请先在服务商控制台创建最小权限 Token/Key，人工完成服务商或管理员
审批，再把当前值粘贴到插件卡片。表单接受 Token 不代表服务商 Scope 一定正确；第一次有界读取
才是实际连通性检查。

| 插件 / 只读结果                                  | 手工凭据与最低权限                                                                  | 仍需人工完成的门禁                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Neon Projects** — 有界项目列表                 | 有 Scope 限制的 Neon API Key；没有具名 OAuth Scope                                  | 按测试账号选择尽可能窄的个人、组织或项目 Key。                                            |
| **Sentry Issues** — 有界 Issue 列表              | Auth Token 或 Internal Integration Token，包含 `event:read`                         | 在 Sentry 选择组织/项目，并确认 Token 没有写权限。                                        |
| **HubSpot Contacts** — 有界联系人元数据          | Private App 或 OAuth Access Token，包含 `crm.objects.contacts.read`                 | 在 HubSpot 人工创建/批准应用并签发 Token。                                                |
| **Apollo Lists** — 有界列表目录                  | Apollo API Key，具备已审查的 `tags_list` 权限                                       | 确认账号与套餐开放已审查的列表端点。                                                      |
| **PostHog Insights** — 有界 Insight 列表         | Personal API Key，包含 `insight:read`                                               | 当前适配器只审查了 PostHog US Cloud；EU Cloud 与自托管来源需另行审查。                    |
| **Asana Workspaces** — 有界 Workspace 列表       | OAuth Access Token 或 PAT，包含 `workspaces:read`                                   | 人工完成 Asana App/PAT 设置。                                                             |
| **Zotero Top Items** — 有界条目元数据            | 专用只读 Key，包含 `library:read`；数字 User ID 是单独的非秘密配置                  | 创建 Library Read-only Key，并复制数字 User ID。                                          |
| **HeyGen Avatars** — 有界 Avatar 列表            | HeyGen API Key；没有具名服务商 Scope                                                | 使用测试 Workspace Key；适配器只能列出 Avatar。                                           |
| **Linear Issues** — 有界 Issue 列表              | OAuth Access Token，包含 `read`                                                     | 人工完成 Linear OAuth。这是已审查的固定 GraphQL `POST`，调用方不能更改 Document 或 Body。 |
| **OpenAI Models** — 有界模型列表                 | Project API Key，包含 `models.read`                                                 | 创建最小权限 Project Key；适配器不能提交 Prompt 或 Response。                             |
| **Box Root Items** — 有界根文件夹条目            | OAuth Access Token，具备已审查的根目录只读权限（主机标签 `root_readonly`）          | 人工完成 Box OAuth，并避免给测试 App 添加写 Scope。                                       |
| **Slack Public Channels** — 有界公开频道列表     | Bot 或 User Token，包含 `channels:read`                                             | 人工安装/批准 Slack App；不会请求私有频道或历史记录 Scope。                               |
| **Google Calendar Events** — 有界事件元数据      | OAuth Access Token，包含 `https://www.googleapis.com/auth/calendar.events.readonly` | Google Consent、敏感 Scope 验证与生产 OAuth 审查仍是人工发布门。                          |
| **SharePoint Root Site** — 只返回根站点元数据    | Microsoft Graph Token，包含 `Sites.Read.All`                                        | Entra App 注册与租户/管理员 Consent 需人工完成。                                          |
| **Outlook Mail Folders** — 只返回文件夹元数据    | Microsoft Graph Token，包含 `Mail.ReadBasic`                                        | Entra Consent 需人工完成；适配器不读取邮件正文，也不发送邮件。                            |
| **Outlook Calendar Events** — 有界基础事件元数据 | Microsoft Graph Token，包含 `Calendars.ReadBasic`                                   | Entra Consent 需人工完成。                                                                |
| **Microsoft Teams** — 有界已加入 Team 列表       | Microsoft Graph Token，包含 `Team.ReadBasic.All`                                    | Entra Consent 需人工完成；支持工作/学校账号，不支持个人 Microsoft 账号。                  |

服务商返回的名称、描述、标题、地址、URL 等显示字符串始终是**不可信外部数据**。Broker 会通过
封闭结果 Schema 做规范化和长度限制，但这不会把它们变成指令。只能把它们作为文本渲染；不得
执行其中的标记、把内容回送为权限依据，也不得自动打开返回 URL。审计仍不会记录请求参数、
响应正文或秘密。

另外四个看似合适的候选目前有意延后：

| 候选           | 当前不启用的原因                                                                    | 必须完成的门禁                                                    |
| -------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Gmail**      | Google Restricted Scope 与 AI/MCP 数据传输组合需要独立的政策和安全审查。            | 完成 Restricted Scope 验证，并批准 AI 数据传输政策。              |
| **Monday.com** | 其稳定 Token 流程使用原始/非 Bearer 的 `Authorization` 形式，当前 Broker 不会注入。 | 增加并审查精确的非 Bearer 授权 Scheme，且不能由此开放任意请求头。 |
| **Semrush**    | 候选 API 仍属 Early Access，当前审查注入合同也未表达其 `ApiKey` 凭据 Scheme。       | 确认稳定生产 API，并增加专用、经过审查的 `ApiKey` Scheme。        |
| **Replit**     | 尚未为目标操作验证稳定的公开管理 API。                                              | 先选定并审查有正式文档的公开 API，再授予网络权限。                |

### 操作参数与可粘贴示例

操作面板只接受封闭的 JSON 对象，会拒绝未声明字段。下列示例不包含凭据，可直接粘贴到
**参数（JSON）**，再把示例 ID、地址和 URL 替换为自己开发账号中的值。

#### Supabase Schema Inspector

| 操作             | 必填参数             | 可选参数         | 限制与行为                                                                                                                           |
| ---------------- | -------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `inspect-schema` | `projectRef: string` | `schema: string` | 两个字符串长度都为 1–63；`schema` 默认为 `public`。适配器只接受规范的小写项目 ref，并调用固定的 Supabase Management API `GET` 路径。 |

```json
{
  "projectRef": "project-ref",
  "schema": "public"
}
```

#### Airtable Records

| 操作           | 必填参数                            | 可选参数                              | 限制与行为                                                                           |
| -------------- | ----------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| `list-records` | `baseId: string`、`tableId: string` | `pageSize: integer`、`offset: string` | `pageSize` 为 1–100，默认 100。只接受有界的稳定 ID 和分页游标，不支持公式/过滤注入。 |

```json
{
  "baseId": "appBase123",
  "tableId": "tblTable123",
  "pageSize": 25
}
```

获取下一页时，可加入返回的游标，例如 `"offset": "itrPage123/recLast123"`。

#### Supabase Tables

| 操作          | 必填参数                                   | 可选参数                      | 限制与行为                                                              |
| ------------- | ------------------------------------------ | ----------------------------- | ----------------------------------------------------------------------- |
| `query-rows`  | `projectRef`、`table`                      | `columns`、`filters`、`limit` | 最多 64 列、16 个过滤器和 100 行；`limit` 为 1–100。                    |
| `insert-rows` | `projectRef`、`table`、`records`           | —                             | 1–100 条记录；每条记录包含 1–64 个 `{ name, valueJson }` 字段。         |
| `update-rows` | `projectRef`、`table`、`fields`、`filters` | —                             | 至少需要一个字段和一个过滤器；强制严格的 PostgREST `max-affected=100`。 |
| `delete-rows` | `projectRef`、`table`、`filters`           | —                             | 至少需要一个过滤器；强制严格的 PostgREST `max-affected=100`。           |

每个过滤器的结构为 `{ "column": string, "operator": string, "valueJson": string }`。支持
`eq`、`neq`、`gt`、`gte`、`lt`、`lte`、`like`、`ilike` 和 `is`。`valueJson` 是用字符串编码的
有界 JSON 值，不是可执行代码。

查询：

```json
{
  "projectRef": "project-ref",
  "table": "tasks",
  "columns": ["id", "title"],
  "filters": [{ "column": "status", "operator": "eq", "valueJson": "\"open\"" }],
  "limit": 10
}
```

新增：

```json
{
  "projectRef": "project-ref",
  "table": "tasks",
  "records": [
    {
      "fields": [
        { "name": "title", "valueJson": "\"Ship\"" },
        { "name": "done", "valueJson": "false" }
      ]
    }
  ]
}
```

更新：

```json
{
  "projectRef": "project-ref",
  "table": "tasks",
  "fields": [{ "name": "done", "valueJson": "true" }],
  "filters": [{ "column": "id", "operator": "eq", "valueJson": "7" }]
}
```

删除：

```json
{
  "projectRef": "project-ref",
  "table": "tasks",
  "filters": [{ "column": "done", "operator": "is", "valueJson": "false" }]
}
```

`update-rows` 和 `delete-rows` 会发送
`Prefer: handling=strict, max-affected=100, return=minimal`；严格处理会让 PostgREST 拒绝超出影响行上限的请求，
而不会静默忽略该限制。RLS 和当前 Supabase 用户身份仍然决定哪些行可以读取或修改。

#### Stripe Checkout & Billing

| 操作                      | 必填参数                                                 | 可选参数 | 限制与行为                                                                                          |
| ------------------------- | -------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `get-product`             | `productId`                                              | —        | 规范的 `prod_…` ID；只读 `GET`。                                                                    |
| `get-price`               | `priceId`                                                | —        | 规范的 `price_…` ID；只读 `GET`。                                                                   |
| `create-checkout-session` | `priceId`、`quantity`、`mode`、`successUrl`、`cancelUrl` | —        | `quantity` 为 1–100；`mode` 为 `payment` 或 `subscription`；两个 URL 都必须是规范的公开 HTTPS URL。 |

```json
{
  "productId": "prod_Product123"
}
```

```json
{
  "priceId": "price_Price123"
}
```

```json
{
  "priceId": "price_Price123",
  "quantity": 2,
  "mode": "subscription",
  "successUrl": "https://shop.acme.com/checkout/success?session_id={CHECKOUT_SESSION_ID}",
  "cancelUrl": "https://shop.acme.com/checkout/cancel"
}
```

创建 Checkout 时，Broker 会生成 UUID `mutationAttemptId`，在确认审核中显示，并作为 Stripe
的 `Idempotency-Key` 发送。已发出请求返回“远端结果未知”时，恢复的审核会保留同一 ID，使人工重试能复用同一个键。
在检查 Stripe 之前不要创建新的审核；Stripe 自身的幂等保留时间和冲突规则仍然适用。

#### Resend Email

| 操作         | 必填参数                                              | 可选参数                    | 限制与行为                                                             |
| ------------ | ----------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| `get-email`  | `emailId`                                             | —                           | 有界的 Resend 邮件 ID；只读 `GET`。                                    |
| `send-email` | `from`、`to`、`subject` 以及 `text`/`html` 中至少一项 | `cc`、`bcc`、`text`、`html` | 每个收件人列表包含 1–50 个有界地址；会拒绝附件、任意请求头和任意 URL。 |

```json
{
  "emailId": "4ef9a417-02e9-4d39-ad75-9611e0fcc33c"
}
```

```json
{
  "from": "OpenPencil <sender@example.com>",
  "to": ["reader@example.com"],
  "subject": "Connector review",
  "text": "The reviewed connector is ready."
}
```

`send-email` 同样会把经过审核的 UUID `mutationAttemptId` 作为 Resend `Idempotency-Key`
发送，并在恢复同一个未知结果审核时保留它。该键只会在 Resend 规定的幂等保留窗口内降低重复发送；
重试前仍须先到服务中核验。

每次调用时，Broker 都会重新检查安装/启用状态、已接受包摘要、当前会话授权、完整合同、具体
操作和精确的主机适配器。适配器只能准备合同声明的有界路径、查询参数和请求字段；Broker 才能
在执行时解析并注入经过审查的 Bearer 或 API Key 凭据，并强制执行精确公开 HTTPS 来源或经过审查的来源模板、HTTP
方法、路径模板、`credentials: 'omit'`、拒绝重定向、超时和请求/响应大小上限。桌面请求通过
有界的 Tauri 原生代理发送。服务方 JSON 必须先转换并通过封闭的结果 Schema 校验，才能进入
UI 或 MCP。

连接器审计只保留操作身份、结果状态、耗时和字节数等元数据，不记录参数、请求/响应正文或
凭据。Supabase Auth/Storage、这些连接器由服务商管理的 OAuth Consent/Refresh 流程与二进制
流式传输尚未实现；目前必须人工签发并录入 Access Token。发布者仍不能提供任意
JavaScript/原生代码、后台服务、端点、请求头或通用网络访问。

会话授权、待处理操作状态和“远端结果未知”提示都是本地且仅在当前会话中保留的。请求发出后如果
应用或操作系统硬崩溃，应用无法持久证明操作已取消，也无法保留内存中的提示；远端变更可能已经成功。重启后再次发起
变更前，必须先检查 Supabase、Stripe 或 Resend。Stripe/Resend 的幂等键可降低人工重试同一次操作时的重复效果，
但不会把未知结果变成“已确认失败”，也不保护 Supabase 行变更。

## 远程目录状态

**远程目录**卡片会说明本次会话使用了什么来源：

- **刚刚验证**：目录与清单来自网络，并通过当前全部检查。
- **已验证缓存**：至少一个签名响应来自本地缓存，并在使用前重新验证。
- **缓存已过期**：存在缓存，但已无法通过有效期或信任检查，不会被激活。
- **不可用**：网络与可用的已验证缓存都无法提供目录。
- **未配置**：当前构建只使用内置离线目录。

远程请求必须使用 HTTPS，会拒绝重定向和 URL 内嵌凭据，不携带浏览器凭据，并限制超时与响应大小。HTTPS 或“缓存存在”不是最终信任依据；签名才是身份与完整性检查。无效目录会整体安全拒绝（fail closed）；单个无效清单会被排除并计入问题，不会因此启用。

由根密钥签名的市场快照会绑定：

- 当前有效的发布者密钥与插件所有权。
- 密钥轮换和撤销记录。
- 目录摘要、条目和审计检查点。
- 可选的运行时索引摘要。

OpenPencil 会拒绝已签名快照的回滚，并按当前时间重新验证缓存。过期、被篡改、使用不同根密钥，或 `Sequence` 早于已接受状态的缓存不会激活。

安装发布者插件与接受更新都绑定当前目录。确认操作时，OpenPencil 会再次检查精确签名包仍在未过期目录中。目录在安装后过期不会自动禁用已接受插件；只要发布者密钥与主机适配器仍有效，已接受的声明式贡献就可以继续使用。

## 启用、禁用与移除

启用插件后，其经过审查的模块、命令、导出器、连接器与存储服务商声明才可使用；模块也允许创建新实例。禁用或
移除插件会阻止新模块实例、停用命令与导出器、撤销连接器授权，并停止本地等待仍在执行的
匹配连接器调用，但不会删除或改写文档中的既有节点。已发出的变更操作会标记为“远端结果未知”，
不会被错误地宣称为已经取消。

- 可信适配器仍随应用提供时，既有声明式配置可以继续渲染和编辑。
- 适配器不可用时，模块会安全降级为普通 `FRAME` 几何，版本化模块封装会原样保留，便于以后恢复。
- 移除插件只改变本机安装状态，不会扫描或修改打开的文档。
- 移除前会终止正在执行的运行时调用，并持久撤销该精确运行时授权。
- 即使重新安装相同版本与摘要，也必须重新审查和授权运行时；旧审计记录仍保留用于诊断。

启用后的声明式贡献也会以
`plugin__<可读插件名>__<动作>_<可读贡献名>_<sha256>` 命名空间动态出现在 MCP 工具列表
中。规范身份摘要可防止另一个可读名称归一化后相同的插件复用客户端缓存的旧工具名。安装、
启用、禁用或移除插件时，MCP 会刷新工具列表；执行每次调用前还会再次检查实时插件状态，
因此客户端缓存的旧工具不能绕过禁用或卸载。这里只暴露软件内置且经过审查的模块、命令和
导出适配器，以及使用固定 `GET` 或主机明确审查的固定 `POST` 且已授权的只读连接器查询；
插件清单不能增加任意可执行 MCP 处理器。兼容模块、命令与导出器会分别投影为 add、run、export
工具；符合上述条件的连接器查询会投影为 query 工具。任意 `POST` 与连接器变更都不能进入 MCP，
变更只能在 UI 中逐次确认。仅安装或启用并不会自动授权连接器 MCP 工具；还必须保存凭据并授予
当前会话的精确摘要权限。撤权或清除凭据会立即移除工具。

## 更新与回滚

新的发布者签名清单会进入**需要审核更新**状态，不会静默替换已接受版本。审查页面会显示版本变化、清单摘要、签名密钥变化，以及新增、删除或修改的贡献。

- **接受更新**：接受已验证候选，并把旧快照放入有界本地历史。
- **拒绝更新**：拒绝当前候选；后续目录刷新仍可能再次提供它。
- **回滚**：确认后恢复最近保留的已验证快照，并把被替换版本留在历史中。

接受更新或回滚前必须先移除精确摘要固定。只有当主机信任配置为同一发布者和插件声明了有效的前任链时，才允许更换签名密钥。过期、撤销或未授权的密钥会阻止创建新模块，但不会删除文档内容。

不兼容当前适配器/配置版本的更新会保持可见但不可接受。回滚无需新的目录，但仍会按照当前密钥环和当前构建的主机适配器兼容性重新检查，因此不能通过历史记录绕过旧密钥的撤销。

## 精确摘要固定

使用**固定摘要**将已安装条目固定到精确清单摘要。商店同时保存语义化版本与 SHA-256 摘要，因此攻击者不能在版本字符串不变时悄悄替换内容。

内置插件随应用版本更新。未固定的内置插件可迁移到新构建携带的清单，同时保留安装和启用状态。如果新应用包不再包含已固定摘要，商店会安全拒绝并要求人工决定，而不是静默更换固定值。

## 文档依赖与锁文件

**当前文档依赖**会扫描当前文档中的原生模块 `FRAME`，并与本机已安装的接受版本比较，报告：

- 插件未安装或被禁用。
- 缺少锁定条目。
- 版本、摘要或发布者密钥不匹配。

在安装并审查所需插件后，选择**写入已验证依赖锁**。OpenPencil 会在文档根写入有界的 `openpencil-plugin-lock`，仅包含插件 ID、版本、清单摘要与发布者密钥 ID，不包含可执行代码、凭据或下载 URL。

插件锁可以在 `.fig` 中往返。当前 `.pen` 源保留写入器只允许更新 MotionSpec 元数据，不是通用插件锁写入路径。依赖解析不会阻止打开文档：缺失或无效的锁会显示修复建议，未知模块数据保持惰性并原样保留。

若主机适配器拒绝畸形模块封装或实例配置，界面会显示节点 ID 并禁止写入误导性的已验证锁，但不会修改原始 `FRAME` 数据。

## 信任标签

插件商店区分两种信任来源：

- **应用内置**：清单与引用的适配器都由当前 OpenPencil 构建打包，不会伪装成发布者签名内容。
- **已验证发布者**：软件包先被已验证目录列出，再通过严格解析、SHA-256 完整性、Ed25519 发布者签名、发布者/插件所有权、密钥有效期与撤销，以及 OpenPencil 引擎兼容性检查。

两种来源最终都受同一主机适配器允许列表限制。签名不会自动授予执行权限。

## 审查和运行可执行插件

只有同时满足以下条件时才会显示可执行控制：

- 插件已经安装并启用。
- 插件由发布者签名。
- 当前已验证市场快照发布了匹配的运行时索引。
- 当前 OpenPencil 构建支持该运行时类型。

先选择**审核运行时**。审查内容必须包括：

- 声明式清单摘要与独立签名的运行时软件包摘要。
- 发布者/密钥身份、运行时类型、请求的能力与网络/缓存来源。
- 当前构建是否有资格运行。JavaScript 始终显示**运行时不可用**。

当前完整能力词表只有：

- `document.nodes.read`
- `document.selection.read`

一次授权会精确绑定运行时摘要、声明式摘要与排序后的完整能力列表。任何软件包更新或能力变化都会自动使旧授权失效。**撤销授权**会立即阻止之后的调用；**使用 null 输入运行**会为每次执行创建一次性 Worker，只返回 JSON，不留下空闲的插件进程。

### WASM 运行时边界

WASM 运行时是纯计算、只读且无主机导入的隔离通道。它不能：

- 请求网络或读取文件。
- 修改文档或访问凭据。
- 创建 DOM、调用 Tauri 或启动原生/命令行进程。
- 运行后台服务或与其他插件通信。

运行时只接收根据已授予只读能力构造的有界 JSON 封装。主机会执行签名、输入/输出/内存限制、硬超时和 UTF-8 JSON 检查，并拒绝表、启动函数、共享内存或超过声明上限的内存。超时、取消、成功和失败都会终止 Worker。

本机会记录授权、撤销、成功执行、失败执行和被阻止尝试的有界机器可读审计轨迹，但不会记录运行时输入/输出、文档内容或凭据。

::: danger 注意
不要把运行时授权理解成永久权限。它只对一个精确版本、摘要和完整能力集合有效；更新后必须重新审查。
:::

## 本地保存的数据

插件状态保存于本地 IndexedDB；IndexedDB 不可用时使用内存后端。版本化状态包含已接受快照、有限的已验证历史、可选待审查项、安装/启用状态与可选摘要固定。

独立的有界缓存保存市场、目录、清单和运行时原始 JSON，以及 HTTP 验证器；每次使用前都会重新进行密码学验证。运行时授权与本地审计历史使用另一个版本化存储。这些存储都不保存凭据、提示词、运行时输入或运行时输出。

如果 IndexedDB 暂时失败，使用**重试**。只有当 OpenPencil 能从可信目录插件 ID 精确识别一条畸形或过时记录时，**重置本地状态**才会在确认后删除该记录。无法验证插件 ID 的记录保持安全拒绝，不会猜测或批量删除。

模块实例自身保存在 `FRAME` 的 `interactiveProps.module` 中，使用版本化、有界 JSON 配置。这使未知模块保持惰性，并允许 `.fig` 往返保留数据。

## 公共分发建议

建议使用 GitHub 仓库和 GitHub Releases 承载源码审查、版本标签、发布说明与历史记录。
签名后的不可变清单、目录制品与索引应通过内容寻址的 HTTPS 路径发布，不要把可变 Git
分支或 Release 标签当作软件包身份。

公开市场推荐使用 Cloudflare R2 存储不可变制品，并用 Cloudflare Pages 承载公开索引、
文档与稳定发现入口。小型部署也可以使用 GitHub Pages 发布相同的静态目录。GitHub
Release 制品直链通常会重定向，而 OpenPencil 生产传输会拒绝重定向，因此 Releases 更
适合保留源码、版本和历史，不应直接作为应用使用的制品端点。

## 发布者与自托管运维入口

清单、目录、运行时软件包与运行时索引使用独立的验证/签名命令；这些命令只处理显式指定的本地文件，不会下载目录/运行时 URL，也不会执行插件代码：

```sh
# 验证、签名并再次验证声明式清单。
openpencil plugin manifest validate plugin-payload.json --json
openpencil plugin manifest sign plugin-payload.json \
  --private-key publisher-private.pem -o plugin.json
openpencil plugin manifest verify plugin.json \
  --public-key publisher-public.pem --key-id publisher-key-1

# 构建并验证独立签名的目录索引。
openpencil plugin catalog build catalog-payload.json \
  --private-key catalog-private.pem -o catalog.json
openpencil plugin catalog verify catalog.json \
  --public-key catalog-public.pem --catalog-id official

# 验证、签名并验证发布者运行时软件包。
openpencil plugin runtime validate runtime-payload.json --json
openpencil plugin runtime sign runtime-payload.json \
  --private-key publisher-private.pem -o runtime.json
openpencil plugin runtime verify runtime.json \
  --public-key publisher-public.pem \
  --plugin-id example-plugin --plugin-version 1.0.0 \
  --publisher-id example-publisher --key-id publisher-key-1 \
  --manifest-digest <manifest-sha256-base64url> \
  --digest <runtime-sha256-base64url> --byte-length <canonical-byte-length>

# 构建并验证根密钥签名的运行时索引。
openpencil plugin runtime-index build runtime-index-payload.json \
  --private-key marketplace-root-private.pem --key-id marketplace-root-2026 \
  -o runtime-index.json
openpencil plugin runtime-index verify runtime-index.json \
  --public-key marketplace-root-public.pem \
  --index-id openpencil.marketplace.runtime --key-id marketplace-root-2026 \
  --digest <runtime-index-sha256-base64url>
```

签名命令只能选择一种私钥来源：`--private-key <file>` 或 `--private-key-env <variable-name>`。环境变量参数接收的是“变量名称”，不是 PEM 内容。密钥只在当前调用中读取，不会写入签名 JSON 或命令输出。验证命令同样支持 `--public-key-env`。

从仓库根目录查看或启动自托管市场控制平面：

```sh
bun run marketplace --help
bun run marketplace:serve
```

完整的软件包约定、部署配置和发布者工作流请参阅英文 [插件架构](/development/plugins)。

## 当前限制

- 自托管控制平面已覆盖发布者注册、签名提交、内容审核、stable/beta 发布、不可变制品、根密钥签名快照与哈希链审计日志，但它不是完整的商业插件商店。
- OAuth 账号、邮件恢复、团队、支付、评分/评论、滥用处理、外部透明度见证、生产密钥保管、备份与生产部署仍由运营方实现。
- 可执行通道只支持文档规定的无导入 WASM 计算 ABI。
- 发布者 WASM 执行通道仍不开放 JavaScript、原生代码、DOM、网络、文件系统、命令行、文档
  写入、后台服务、跨插件通信或自动接受更新。
- 22 个内置连接器使用独立且有界的主机 Broker，不会放宽发布者运行时边界。Supabase
  Auth/Storage、由服务商管理的 OAuth Consent/Refresh 流程和二进制流式传输仍属于后续工作；发布者清单与 WASM 包仍不能
  增加任意网络来源、请求处理器、JavaScript/原生代码或后台服务。
- 声明式模块、命令与导出器仍需要 OpenPencil 构建中随附的已审查主机适配器。WASM
  不能安装新渲染器，也不能绕过主机注册表。
- WASM 不暴露 Tauri IPC，远程市场数据只按文本渲染，不按可执行标记处理。
- 桌面主机的生产 CSP、本地来源导航策略、仅调试自动化能力，以及更窄的文件系统/命令行范围是独立的加固工作；在完成前不能声称已构成完全加固的恶意渲染器边界。

::: danger 危险
不要把远程来源加入默认 Tauri 能力，也不要在主 WebView 中加载插件 HTML 或 JavaScript。
:::
