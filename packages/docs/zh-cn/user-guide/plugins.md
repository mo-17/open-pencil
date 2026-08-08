---
title: 插件市场
description: 发现、验证、安装、授权、更新和回滚经过签名的 OpenPencil 插件。
---

# 插件市场

OpenPencil 插件系统分为两个明确隔离的层级：

1. **声明式贡献**：默认且最安全。清单只能描述受支持的模块、命令、导出器和配置，不能执行 JavaScript、注入 HTML/CSS、启动原生进程，也不能请求文件系统或网络权限。
2. **可执行运行时**：默认不可用。当前只允许发布者签名、市场索引授权、用户按精确摘要与完整只读能力列表授予权限的 WASM 计算包。JavaScript 包可以验证来源，但永远不会被执行。

每个 OpenPencil 构建都包含离线声明式目录。Fork 维护者还可以固定一个市场根公钥，自托管签名快照、发布者目录、stable/beta 渠道、搜索与追加式审计检查点，不依赖 OpenPencil 官网或官方账号。

## 浏览与安装

打开 **设置 → 插件**：

- **浏览**：显示内置与已验证远程条目，包括信任来源、版本和安装状态。
- **已安装**：管理启用、精确摘要固定、更新审查、回滚、依赖与移除。

配置远程市场根之后，页面还会显示 stable/beta 渠道、发布者与密钥身份、快照状态、审计头，以及该快照是否授权可执行运行时索引。搜索只匹配签名内容中的名称、摘要、分类、关键词、插件 ID 和发布者元数据，不会信任未签名搜索服务返回的身份信息。

应用内置 11 个经过审查的插件：

- **Map**：新配置中默认安装并启用，创建可原生编辑的地图 `FRAME`，并通过经过审查的
  MapLibre React 适配器编译。
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

通常的操作顺序是：

1. 在 **浏览** 中选择插件并检查信任标签、发布者和摘要。
2. 安装插件。新安装的插件默认保持禁用。
3. 完成人工审查后启用插件。
4. 从编辑器使用对应入口：画布底部工具栏的 **插件** 菜单插入模块；**编辑 → Clipboard
   Toolkit** 执行复制命令；**文件 → 导出 → Tauri React Project** 导出桌面项目源码，
   或通过 **文件 → 导出 → Expo React Native Project**、**Flutter Project** 导出移动端源码。
5. 对模块，在画布中编辑生成的原生 `FRAME` 与受控属性。

当前 Expo 静态 MVP 支持原生 `View`、`Text`、`Image`、`ImageBackground`、`Pressable`、
`TextInput` 与 `Switch` 外壳，基础行内布局和视觉样式，单页或 Expo Router 多页面文件，
以及静态图片。出现原生控件外壳不代表画布中编写的 Web 状态/动作
运行时已经完成移动端翻译。Map、Chart、Rich Text、HTML、Video、Table、Slide Menu 等模块，Motion 与
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
设置从左、右、上、下进入，并编辑触发文字、标题、说明、菜单项、面板尺寸、颜色、遮罩透明度、
点击遮罩关闭和关闭按钮。Compiler 预览与导出的 React/Tauri 项目会在点击画布中的触发器后，
通过本地 `document.body` portal 打开面板。Escape 始终可以关闭；打开时键盘焦点限制在面板内，
关闭后回到触发器；用户启用减少动态效果时会取消滑动过渡。菜单地址只接受以 `/` 开头的文档
路径、以 `#` 开头的页面锚点或规范的公开 HTTPS URL，所有文字都按纯文本显示。

Expo 与 Flutter 源码导出不会为 **</> HTML**、**Video**、**Table** 或 **Slide Menu** 引入
WebView。在经过
审查的原生适配器就绪前，这些模块会生成明确的不支持功能警告和不包含原模块行为的静态
原生 fallback，不会在移动应用中静默嵌入浏览器表面。

安装和启用是两个独立步骤。启用后，经过审查的模块、命令与导出器才可使用；其中只有
模块会出现在工具栏以及 `list_modules` / `create_module` 的发现结果中。

::: warning 注意
有效签名只能证明“谁发布了这份内容”以及内容未被篡改，不能证明插件安全，也不能自动提供画布/编译器适配器，更不代表已经取得执行权限。
:::

如果一个目录条目没有与当前 OpenPencil 构建兼容的、经过审查的模块、命令或导出器
适配器，商店仍会显示该条目用于诊断，但会禁止激活。必须安装包含对应适配器的
OpenPencil 构建。清单可以声明适配器名称，但不能携带或执行适配器。

清单 Schema v1 中的贡献保持纯声明式：`contributions.modules` 描述原生 `FRAME` 模块，
`contributions.commands` 描述具名主机操作，`contributions.exporters` 描述具名导出操作与
安全文件扩展名。清单能力列表仍为空。每个贡献都必须精确匹配应用启动时注册并冻结的主机
适配器；贡献不会获得任意编辑器、文件系统、网络、Tauri 或进程 API。

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

启用插件后，其经过审查的模块、命令与导出器才可使用；模块也允许创建新实例。禁用或
移除插件会阻止新模块实例并停用命令和导出器，但不会删除或改写文档中的既有节点。

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
导出适配器，插件清单不能增加任意可执行 MCP 处理器。

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
- JavaScript、原生代码、DOM、网络、文件系统、命令行、文档写入、后台服务、跨插件通信和自动接受更新均不可用。
- 声明式模块、命令与导出器仍需要 OpenPencil 构建中随附的已审查主机适配器。WASM
  不能安装新渲染器，也不能绕过主机注册表。
- WASM 不暴露 Tauri IPC，远程市场数据只按文本渲染，不按可执行标记处理。
- 桌面主机的生产 CSP、本地来源导航策略、仅调试自动化能力，以及更窄的文件系统/命令行范围是独立的加固工作；在完成前不能声称已构成完全加固的恶意渲染器边界。

::: danger 危险
不要把远程来源加入默认 Tauri 能力，也不要在主 WebView 中加载插件 HTML 或 JavaScript。
:::
