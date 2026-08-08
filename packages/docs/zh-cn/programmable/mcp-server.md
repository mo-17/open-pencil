---
title: MCP 服务器
description: 将 Claude Code、Codex、Cursor、Windsurf 等 MCP 客户端连接到 OpenPencil，读取、修改并验证当前设计。
---

# MCP 服务器

OpenPencil 内置 MCP（Model Context Protocol）服务器。Claude Code、Codex、Cursor、Windsurf 等 AI 工具可以通过正在运行的桌面应用读取和修改设计。

提供两种传输：

- **stdio**：适合本地 MCP 客户端；
- **Streamable HTTP**：适合浏览器扩展、脚本和 CI。

macOS 与 Linux 上，本地客户端优先使用私有 Unix Domain Socket；Windows 或 Socket 不可用时回退到 localhost TCP。

## 安装

```sh
npm install -g @open-pencil/mcp
```

## stdio 配置

stdio 服务器会自动发现正在运行的 OpenPencil。开始前请打开桌面应用并加载文档。

### Claude Code

```sh
npm install -g @open-pencil/mcp
claude mcp add --scope user open-pencil -- openpencil-mcp
claude mcp list
```

Claude Code 默认会在每次调用 MCP 工具前请求批准。若只想自动批准 OpenPencil 工具，可在 `~/.claude/settings.json` 中加入：

```json
{
  "permissions": {
    "allow": ["mcp__open-pencil__*"]
  }
}
```

这比 `--permission-mode bypassPermissions` 更窄；后者会跳过所有工具的权限提示。

示例提示词：

```text
使用 open-pencil MCP 检查当前页面，在画布上创建一个小型 Hero 区域，并在完成后读取结构进行验证。
```

### 其他 MCP 客户端

在客户端配置中加入：

```json
{
  "mcpServers": {
    "open-pencil": {
      "command": "openpencil-mcp"
    }
  }
}
```

也可以直接从源码启动：

::: code-group

```json [Bun]
{
  "mcpServers": {
    "open-pencil": {
      "command": "bun",
      "args": ["/path/to/open-pencil/packages/mcp/src/stdio.ts"]
    }
  }
}
```

```json [Node.js]
{
  "mcpServers": {
    "open-pencil": {
      "command": "npx",
      "args": ["tsx", "/path/to/open-pencil/packages/mcp/src/stdio.ts"]
    }
  }
}
```

:::

## Streamable HTTP

```sh
openpencil-mcp-http
```

从源码运行：

```sh
bun packages/mcp/src/index.ts
```

默认安全策略：

- macOS/Linux 的 Unix Socket 与发现文件只允许当前用户访问；
- TCP 只绑定 `127.0.0.1`，默认端口为 7600；
- 默认启用认证，随机 Token 保存在私有发现文件中；
- HTTP 模式禁用 `eval`；
- 文件操作限制在 `OPENPENCIL_MCP_ROOT` 内，并拒绝符号链接逃逸；
- 默认关闭 CORS，可用 `OPENPENCIL_MCP_CORS_ORIGIN` 只允许一个 Origin。

macOS/Linux 可用 `PORT=0` 禁用 TCP；Windows 必须使用 TCP。`OPENPENCIL_MCP_SOCKET` 可覆盖 Socket 路径，`OPENPENCIL_MCP_DISCOVERY_PATH` 可覆盖发现文件路径，`OPENPENCIL_MCP_AUTH_TOKEN` 可设置固定 Token。显式空 Token 会关闭认证，只能用于可信本地 Socket。

可用端点：

- `GET /health`：服务器与应用连接状态，不返回 Token；
- `POST /rpc`：经过认证的实时应用自动化；
- `POST /mcp`：MCP Streamable HTTP，使用 `mcp-session-id` Header 管理会话。

## 推荐工作流

1. **确认目标**：存在多个文档或页面时先调用 `list_documents`，获取稳定的 `document_id` 与页面 ID。
2. **打开文档**：使用 `open_file` 加载 `.fig`，或使用 `new_document` 创建空白文档。
3. **读取基线**：使用 `get_page_tree`、`find_nodes`、`get_node`、`list_pages`；批量低代码和 Motion 数据优先使用 `read_lowcode_nodes`、`read_motions`。
4. **创建内容**：简单节点使用 `create_shape`，复杂布局使用 `render`。
5. **修改内容**：使用 `set_fill`、`set_stroke`、`set_layout`、`update_node`、`update_lowcode_nodes`、`ensure_form_value_bindings` 或 Motion 工具。
6. **调整结构**：使用 `reparent_nodes`、`group_nodes`、`clone_node`、`delete_node`。
7. **验证结果**：读取修改后的节点；路由应用调用 `audit_navigation`，表单调用 `audit_form_controls`，数据应用调用 `audit_application_runtime`。
8. **保存**：使用 `save_file` 写回 `.fig`。

多数工具支持可选的 `document_id` 与 `page_id`。自动化任务应显式传入目标，不要依赖当前可见 Tab。`create_page` 只创建页面；需要切换时再调用 `switch_page`。

## 动态插件工具

只有插件同时处于“已安装”和“已启用”状态时，正在运行的应用才会把其经过审查的模块、
命令和导出器注册为 MCP 工具。工具使用稳定的
`plugin__<可读插件名>__<动作>_<可读贡献名>_<sha256>` 命名空间。SHA-256 后缀由规范化的
插件 ID、贡献类型与贡献 ID 共同生成，因此以后即使出现可读名称归一化冲突的新插件，也不能
接管客户端缓存的旧工具名。安装、启用、禁用或移除插件后，MCP 会更新 `tools/list`，并向已
连接会话发送 `notifications/tools/list_changed`。

Streamable HTTP 会话会直接根据应用连接同步目录。独立 stdio 桥会在启动、重连时刷新，并每
2 秒轮询一次；应用断开后，最后一次失败刷新还可能叠加浏览器桥有界的 10 秒连接等待。这个
短暂列表延迟不会放宽执行权限，因为每次调用仍会实时复查应用状态并以失败关闭。

当前内置目录在对应插件启用后最多提供 7 个模块工具（Map、Chart、富文本、HTML、Video、
Table、滑动菜单）、4 个 Clipboard Toolkit 命令，以及 3 个源码工程导出器（Tauri React、
Expo React Native、Flutter）。

每次调用插件工具前，应用都会重新检查实时插件状态。因此，即使 MCP 客户端缓存了旧工具
列表，也不能继续调用已禁用或已移除的插件。应用断开时，动态插件工具会全部移除，经过认证
的自动化桥重新连接后再恢复。插件清单不能注入可执行 MCP 处理器；OpenPencil 只生成有界参数
结构，并把调用路由到软件内置且经过审查的模块、命令与导出适配器。

## 字体许可与渲染检查

### `audit_font_licenses`

默认扫描当前页面，也可以传入 `id` 检查子树，或用 `all_pages: true` 检查整个文档。`intended_use` 可选：

- `commercial_use`：商业使用；
- `embedding`：嵌入；
- `redistribution`：再分发；
- `modification`：修改字体。

结果含义：

- `verified_open`：加载的准确字体字节匹配经过审核的开放字体 SHA-256 清单；
- `restricted`：字体明确声明了与目标用途冲突的限制；
- `unknown`：必须人工审查。

字体已安装、可以下载、能够渲染或出现在提供商列表中，都不能单独证明它免费。结果还会报告 OpenType 许可与嵌入元数据、使用位置、义务以及 `pass`、`review` 或 `block` 决策。这是证据审计，不是法律意见。

### `audit_font_rendering`

按子树、页面或整个文档检查实际字体状态，并可执行一次有界重试。工具会区分作者请求的字体、准确加载的字体与合成字体，覆盖 TEXT、Button、Input 和 Textarea。

CanvasKit 无法暴露每个 fallback 字形最终使用的字体家族，因此工具会报告未知，而不是猜测。字体可渲染也不会被当成许可证据。

### `audit_image_assets`

检查已存储和被引用的图片 Hash、文件签名、尺寸、字节/像素预算、缺失数据、无效 Header 与孤立资源。摘要覆盖整个文档，问题记录有数量上限，并明确报告省略数量。

## 安装 Agent Skill

```sh
npx skills add open-pencil/skills@open-pencil
```

该 Skill 适用于 Claude Code、Cursor、Windsurf、Codex 以及支持 [skills](https://skills.sh) 的 Agent，包含 CLI、MCP、JSX 渲染、`eval` 与实时应用自动化的工作方法。

## 工具分类

### 文档

| 工具             | 用途                         |
| ---------------- | ---------------------------- |
| `open_file`      | 打开 `.fig` 文件             |
| `save_file`      | 保存当前文档                 |
| `new_document`   | 创建空白文档                 |
| `list_documents` | 列出已打开的文档、Tab 与页面 |

### 读取与审计

| 工具                                             | 用途                                                   |
| ------------------------------------------------ | ------------------------------------------------------ |
| `get_selection`                                  | 获取当前选择                                           |
| `get_page_tree`                                  | 获取当前页面完整节点树                                 |
| `get_current_page`                               | 获取当前页面名称与 ID                                  |
| `get_node` / `find_nodes`                        | 按 ID 读取节点，或按名称和类型查找                     |
| `get_components`                                 | 列出组件                                               |
| `list_pages`                                     | 列出页面                                               |
| `list_variables` / `list_collections`            | 列出变量与集合                                         |
| `list_fonts` / `list_available_fonts`            | 列出文档字体与宿主可渲染字体                           |
| `check_font`                                     | 检查单个节点的字体分配、实际字体样式、回退与字形状态   |
| `audit_font_rendering`                           | 有界检查实际字体效果                                   |
| `audit_font_licenses`                            | 按目标用途审计字体许可证据                             |
| `audit_image_assets`                             | 审计图片完整性                                         |
| `audit_form_controls`                            | 审计表单控件和绑定                                     |
| `audit_application_runtime`                      | 审计 Supabase、Schema、RLS、服务器环境变量和部署准备度 |
| `audit_navigation`                               | 审计编译器最终路由与导航事件                           |
| `read_lowcode_nodes`                             | 批量读取低代码元数据                                   |
| `read_server_workflows`                          | 读取经过身份验证的服务端工作流                         |
| `read_motions`                                   | 批量读取 Motion 数据                                   |
| `read_page_route`                                | 读取页面最终路由与冲突信息                             |
| `page_bounds` / `node_bounds`                    | 获取页面或节点边界                                     |
| `node_ancestors` / `node_children` / `node_tree` | 读取节点层级                                           |
| `node_bindings`                                  | 读取变量绑定                                           |

### 创建

| 工具                                     | 用途                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `create_shape`                           | 创建 FRAME、RECTANGLE、ELLIPSE、TEXT、LINE、STAR、POLYGON 或 SECTION |
| `create_vector`                          | 从 Path 字符串创建矢量                                               |
| `create_slice`                           | 创建导出 Slice                                                       |
| `create_page`                            | 创建页面                                                             |
| `render`                                 | 把 JSX 渲染成完整设计节点树                                          |
| `create_component` / `node_to_component` | 创建组件或原地转换节点                                               |
| `create_instance`                        | 在准确父级与顺序位置创建实例                                         |

### 修改

| 工具                                              | 用途                                       |
| ------------------------------------------------- | ------------------------------------------ |
| `set_fill` / `set_stroke` / `set_effects`         | 设置填充、描边与效果                       |
| `update_node`                                     | 修改位置、尺寸、不透明度、圆角、文本和字体 |
| `set_layout` / `set_layout_child`                 | 设置自动布局与子节点行为                   |
| `set_constraints` / `set_minmax`                  | 设置响应式约束和最小/最大尺寸              |
| `set_rotation` / `set_opacity` / `set_radius`     | 设置旋转、不透明度和圆角                   |
| `set_text` / `set_font` / `set_font_range`        | 修改文本和字体范围                         |
| `set_text_resize` / `set_text_properties`         | 设置文本尺寸、对齐、大小写、装饰和截断     |
| `set_visible` / `set_blend` / `set_locked`        | 设置可见性、混合模式和锁定状态             |
| `node_move` / `node_resize` / `node_replace_with` | 移动、缩放或替换节点                       |
| `arrange`                                         | 对齐或分布节点                             |
| `update_lowcode_nodes`                            | 在一次可撤销事务中校验并修改多个低代码节点 |
| `ensure_form_value_bindings`                      | 修复缺少的表单值绑定                       |
| `set_server_workflows`                            | 原子校验并替换服务端工作流定义             |

`audit_form_controls` 会返回 `total`、`returned` 和 `truncated`。页面/表单作用域会跳过 `COMPONENT` 与 `COMPONENT_SET` 主体；组件主节点不能读取页面状态，可复用组件字段应绑定文档状态。

### Motion 与原型

| 工具                                                                                       | 用途                                          |
| ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `read_motion` / `read_motions`                                                             | 读取单个或多个节点的 MotionSpec               |
| `list_motion_presets`                                                                      | 列出内置预设、关键词、参数和限制              |
| `apply_motion_preset`                                                                      | 原子应用预设，可选空间错峰（stagger）         |
| `apply_motion_spec` / `update_motion`                                                      | 应用或替换严格校验的 MotionSpec               |
| `clear_motion`                                                                             | 清除 MotionSpec                               |
| `apply_motion_recipe`                                                                      | 校验角色和参数后应用多节点配方                |
| `verify_team_motion_library`                                                               | 使用可信 Ed25519 公钥验证 Team Library        |
| `review_team_motion_library_update`                                                        | 生成确定性的更新审查差异                      |
| `manage_team_motion_library_registry`                                                      | 接受、拒绝或回滚 Registry 审查                |
| `apply_team_motion_library_entry`                                                          | 重新验证后原子应用 Library 条目               |
| `read_motion_scene` / `update_motion_scene` / `clear_motion_scene`                         | 管理页面或 Frame 场景时间线                   |
| `read_motion_drivers` / `update_motion_drivers` / `clear_motion_drivers`                   | 管理滚动、指针、拖拽、可见性、状态和变量驱动  |
| `read_prototype` / `update_prototype` / `clear_prototype`                                  | 管理导航与 Overlay 原型连接                   |
| `read_motion_transition_key` / `set_motion_transition_key` / `clear_motion_transition_key` | 管理 Smart Match 身份                         |
| `read_generated_effect` / `update_generated_effect` / `clear_generated_effect`             | 管理安全的生成式效果层                        |
| `get_figma_motion_adapter`                                                                 | 诊断 Figma Motion Beta 子集并生成安全适配计划 |

个人预设库只存于用户本机，不作为隐藏 MCP 状态暴露。Agent 可以读取已应用节点上的完整 MotionSpec，再复制到其他节点。

### 结构与矢量

| 工具                                                                           | 用途                   |
| ------------------------------------------------------------------------------ | ---------------------- |
| `delete_node` / `clone_node` / `rename_node`                                   | 删除、复制或重命名节点 |
| `reparent_node` / `reparent_nodes`                                             | 移动到准确父级和顺序   |
| `select_nodes`                                                                 | 按 ID 选择节点         |
| `group_nodes` / `ungroup_node`                                                 | 组合或取消组合         |
| `flatten_nodes`                                                                | 扁平化为单个矢量       |
| `boolean_union` / `boolean_subtract` / `boolean_intersect` / `boolean_exclude` | 布尔运算               |
| `path_get` / `path_set`                                                        | 读取或设置矢量 Path    |
| `path_scale` / `path_flip` / `path_move`                                       | 缩放、翻转或移动 Path  |

### 导出

| 工具                      | 用途                            |
| ------------------------- | ------------------------------- |
| `export_image`            | 导出 PNG、JPG 或 WEBP           |
| `export_svg`              | 导出 SVG Markup                 |
| `export_motion_animation` | 导出 PNG 序列、GIF、WebM 或 MP4 |

`export_motion_animation` 必须提供 `path` 与 `OPENPENCIL_MCP_ROOT`。服务器会验证路径与输出签名，通过临时同级路径写入，并以不覆盖既有目标的方式发布。PNG 序列和确定性 GIF 内置可用；只有发现兼容 FFmpeg 编码器后才开放 WebM/MP4。取消请求会贯穿画面渲染、编码和发布流程。

### 视口、变量与分析

| 类别 | 工具                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------- |
| 视口 | `viewport_get`、`viewport_set`、`viewport_zoom_to_fit`                                                  |
| 变量 | `get_variable`、`find_variables`、`create_variable`、`set_variable`、`delete_variable`、`bind_variable` |
| 集合 | `get_collection`、`create_collection`、`delete_collection`                                              |
| 分析 | `analyze_colors`、`analyze_typography`、`analyze_spacing`、`analyze_clusters`                           |
| 差异 | `diff_create`、`diff_show`                                                                              |
| 页面 | `switch_page`                                                                                           |

### 高级脚本入口

`eval` 可通过 Figma-compatible Plugin API 执行 JavaScript。它只在 stdio 模式可用；HTTP 模式出于安全原因默认禁用。

有关内置助手，请参阅 [AI 对话](/zh-cn/programmable/ai-chat)。完整英文工具参考仍可在 [MCP Server（英文）](/programmable/mcp-server) 查看。
