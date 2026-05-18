# Phase 0 — Lowcode Platform on OpenPencil

> 编译器路线 / 目标：基于 OpenPencil 构建 Bubble-like 低代码平台，产出真实 React 项目。
> Phase 0 目标：搭好底座，让一个**带 state 的可交互按钮**端到端跑通——从画布拖出、属性面板绑事件、iframe 预览看到点击 +1。

---

## 1. 范围

### Phase 0 In-Scope

1. SceneNode schema 扩展：`state`、`bindings`、`events`、新 `NodeType`
2. 6 个交互组件类型：`INPUT`、`BUTTON`、`SELECT`、`CHECKBOX`、`FORM`、`LIST`
3. 编译器：`SceneGraph → React 项目`（输出真实 `.tsx` 文件 + Vite 工程）
4. 预览管线：iframe + esbuild incremental rebuild + HMR
5. 属性面板「值/绑定」二态切换原型（仅文本类属性）

### Phase 0 Out-of-Scope（留给后续 Phase）

- 数据库 / Supabase 接入（Phase 2）
- 工作流编辑器（Phase 3）
- 表达式语言完整实现（Phase 1，Phase 0 只支持 `{stateName}` 直接引用）
- 路由 / 多页面运行时（Phase 1）
- 用户认证 / 部署（Phase 4）

### 成功标准

把以下场景跑通即视为 Phase 0 完成：

```
1. 在画布拖一个 BUTTON 节点
2. 在属性面板创建 page-level state: `count: number = 0`
3. BUTTON 的 `onClick` 绑定到 `setCount(count + 1)`
4. 在画布拖一个 TEXT 节点，文本绑定到 `count`
5. iframe 预览：点 button → text 变化、HMR 不刷新
6. 一键导出：得到一个可独立运行的 Vite + React 项目，npm install && npm run dev 能跑
```

---

## 2. Schema 扩展（最关键）

### 2.1 设计原则

- **零破坏**：所有新字段都是 optional，旧 `.pen` 文件不需要迁移
- **复用现有锚点**：`boundVariables` 已经是 `Record<string, string>` 格式，正好用来存绑定
- **延伸 NodeType**：新增 `INPUT`/`BUTTON` 等不动旧类型，添加到 `NodeType` union

### 2.2 NodeType 扩展

`packages/core/src/scene-graph/types.ts`:

```ts
export type NodeType =
  | 'CANVAS' | 'FRAME' | 'RECTANGLE' | 'ROUNDED_RECTANGLE' | 'ELLIPSE'
  | 'TEXT' | 'LINE' | 'STAR' | 'POLYGON' | 'VECTOR' | 'BOOLEAN_OPERATION'
  | 'GROUP' | 'SECTION' | 'COMPONENT' | 'COMPONENT_SET' | 'INSTANCE'
  | 'CONNECTOR' | 'SHAPE_WITH_TEXT'
  // ── Phase 0 新增 ──
  | 'INPUT'
  | 'BUTTON'
  | 'SELECT'
  | 'CHECKBOX'
  | 'FORM'
  | 'LIST'
```

> **重要**：所有新类型在 Skia 渲染层 **直接复用 FRAME 的绘制**（圆角矩形 + 子节点），只是 `NodeType` 不同——保证画布渲染零改动。差异化全部由属性面板 + 编译器处理。

### 2.3 新增 SceneNode 字段

追加到 `SceneNode` interface（全部 optional）：

```ts
export interface SceneNode {
  // ... 现有字段 ...

  // ── Phase 0: Lowcode 扩展 ──
  /** Page-level / Component-level state 定义（仅 FRAME/PAGE/COMPONENT 节点用） */
  state?: StateDef[]

  /** 属性绑定：属性名 → 表达式字符串。Phase 0 只支持 `{stateName}` 形式 */
  bindings?: Record<string, BindingExpr>

  /** 事件绑定：事件名 → action 列表。Phase 0 仅 onClick / onChange / onSubmit */
  events?: Record<EventName, ActionDef[]>

  /** 交互组件专用属性（INPUT 的 placeholder、SELECT 的 options 等） */
  interactiveProps?: Record<string, unknown>
}

export interface StateDef {
  id: string                 // GUID，编译时变 useState 变量名
  name: string               // 用户写的标识符 `count`
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  defaultValue: unknown
  description?: string
}

export interface BindingExpr {
  /** Phase 0: 'literal' (直接值) | 'ref' (引用单个 state) */
  kind: 'literal' | 'ref'
  /** kind=ref 时填 state.id */
  stateId?: string
  /** kind=literal 时填原始值；ref 时为 undefined */
  literalValue?: unknown
}

export type EventName = 'onClick' | 'onChange' | 'onSubmit' | 'onFocus' | 'onBlur'

export interface ActionDef {
  id: string
  /** Phase 0: 仅 'setState' */
  kind: 'setState'
  /** kind=setState 时：目标 state.id */
  targetStateId?: string
  /** kind=setState 时：新值表达式。Phase 0 支持 `count + 1`、`count - 1`、`!flag`、字面值 */
  valueExpr?: string
}
```

### 2.4 为什么不用 boundVariables

`boundVariables` 已经存在，但语义是绑到**全局 design variable**（颜色、字号等）。我们的 `bindings` 是绑到**页面状态**，作用域不同：

| 字段 | 来源 | 作用域 | 编译产出 |
|---|---|---|---|
| `boundVariables` | Design Variables（CSS 变量） | 全局 | `var(--token-name)` |
| `bindings`（新） | StateDef | 页面/组件 | `{stateName}` JSX 表达式 |

两者可以并存。

### 2.5 Kiwi codec 兼容性

`packages/core/src/kiwi/binary/codec.ts` 用 Kiwi schema 序列化。Kiwi 对未知字段会**忽略**——所以新字段不会破坏旧文件读取。但写出去的新文件，旧客户端读了会丢失这些字段。

**策略**：
- Phase 0：先用 `pluginData` 暂存（已有逃逸字段），不动 Kiwi schema
- Phase 0 末期再把字段提升进 Kiwi schema 正式化

`pluginData` 写入约定：

```ts
{
  pluginId: 'openpencil-lowcode',
  key: 'lowcode-v0',
  value: JSON.stringify({ state, bindings, events, interactiveProps })
}
```

---

## 3. 交互组件实现

### 3.1 组件清单

| Type | 默认 width × height | 默认 props | 编译产出 |
|---|---|---|---|
| `INPUT` | 200 × 36 | `placeholder: ''`, `value: ''` | `<input className="..." {...bindings} />` |
| `BUTTON` | 100 × 36 | `text: 'Button'` | `<button className="..." onClick={...}>{text}</button>` |
| `SELECT` | 200 × 36 | `options: []`, `value: ''` | `<select>...</select>` |
| `CHECKBOX` | 20 × 20 | `checked: false` | `<input type="checkbox" />` |
| `FORM` | 320 × auto（FRAME） | — | `<form onSubmit={...}>` 包子节点 |
| `LIST` | 320 × auto（FRAME） | `dataSourceRef: stateId` | `{items.map(item => <ChildClone />)}` |

### 3.2 工具栏入口

`packages/core/src/tools/create.ts` 新增 6 个 `defineTool()` 条目，自动出现在：
- AI chat（自动）
- MCP server（自动）
- `bun open-pencil eval` CLI（自动）

工具栏 UI（`src/components/Toolbar/`）：在现有"形状"组旁边加"交互"组，包含这 6 个图标。

### 3.3 节点创建

`packages/core/src/editor/shapes.ts` 加 `createInteractiveNode(type, defaults)`。复用 `node-defaults.ts` 的 base，叠加 `interactiveProps`。

### 3.4 属性面板

新增 `src/components/Properties/Interactive/` 子目录：
- `InteractivePropsPanel.vue` — 当 `selected.type` 是 6 个交互类型时显示
- `BindingInput.vue` — 通用「值/绑定」二态控件（Phase 0 核心 UI 创新）
- `StatePanel.vue` — 当前页面/组件的 state 列表 + 增删改

`BindingInput.vue` 组件接口：

```ts
defineProps<{
  modelValue: BindingExpr | string | number // literal 或 BindingExpr
  type: 'string' | 'number' | 'boolean'
  availableStates: StateDef[]  // 可绑的 state 列表
}>()

defineEmits<{
  'update:modelValue': [BindingExpr | string | number]
}>()
```

UI 设计：
```
┌───────────────────────────────────┐
│ Placeholder                       │
│ ┌─────────────────────────────┐⚡ │  ← ⚡ 切换值/绑定
│ │ Enter your name             │   │
│ └─────────────────────────────┘   │
└───────────────────────────────────┘

按 ⚡ 后变成：
┌───────────────────────────────────┐
│ Placeholder                       │
│ ┌─────────────────────────────┐⚡ │
│ │ {userName}            ▼     │   │  ← 下拉选可用 state
│ └─────────────────────────────┘   │
└───────────────────────────────────┘
```

---

## 4. 编译器架构

### 4.1 模块位置（IR + adapter 架构）

新增 `packages/compiler/` 工作区包，**两层切分**：

```
packages/compiler/
  package.json                # @open-pencil/compiler
  src/
    index.ts                  # public API: compile(input)
    types.ts                  # CompilerInput/Output/Options (framework-neutral)
    options.ts                # withDefaults() + target validation

    # ── 框架无关层 ──
    ir/
      types.ts                # IR node types: Element, Text, StateDef,
                              # Binding, Event, Conditional, List
      collect-state.ts        # walk page → StateDef[]
      collect-tree.ts         # SceneGraph → IRTree
      collect-bindings.ts     # node.bindings → IR Binding nodes
      expression.ts           # `count + 1` 子集 parse + emit (target-agnostic)
      style.ts                # SceneNode → Tailwind class string
                              # (复用 io/formats/jsx/tailwind-classes.ts)

    # ── 框架适配层 ──
    adapters/
      types.ts                # interface FrameworkAdapter { emit, scaffold }
      react/
        index.ts              # FrameworkAdapter implementation
        emit-element.ts       # IR Element → JSX
        emit-state.ts         # StateDef → useState hook
        emit-event.ts         # Event → onClick={() => setX(...)}
        emit-binding.ts       # Binding → {expr}
        scaffold.ts           # package.json / vite.config.ts / main.tsx
      # adapters/vue/ 留空目录占位，Phase 5 实现

    select-adapter.ts         # options.target → adapter instance
```

**关键不变量**：
- `ir/**` 只依赖 `@open-pencil/core`，**禁止**导入 `adapters/**`
- `adapters/react/**` 只依赖 `ir/types.ts`，**禁止**直接访问 `SceneGraph`
- 这条边界由 Steiger 规则强制 — 加 `lint/no-cross-layer-in-compiler.mjs`

**测试策略**：
- IR 层测试：input SceneGraph → assert IR shape（不涉及任何框架字符串）
- Adapter 层测试：input IR → assert React 源码字符串
- 端到端测试：SceneGraph → compile → 生成的源码 + Vite 实际能跑起来

### 4.2 公开 API

```ts
// packages/compiler/src/index.ts
import type { SceneGraph } from '@open-pencil/core/scene-graph'

export interface CompilerInput {
  graph: SceneGraph
  pageIds: string[]              // 哪些 page 编译为路由
  options: CompilerOptions
}

export interface CompilerOptions {
  /** 目标框架。Phase 0 仅 'react' 落地；'vue' 留 enum 占位，Phase 5 实现 */
  target: 'react' | 'vue'
  /** target=react 时生效。Phase 0 默认 '19' */
  reactVersion?: '18' | '19'
  /** 路由方案。Phase 0 都是 'none' */
  router: 'react-router-v6' | 'vue-router-v4' | 'none'
  /** 输出目录的 package.json name */
  packageName: string
  /** 是否包含 TypeScript。Phase 0 始终 true */
  typescript: true
}

export interface CompilerOutput {
  /** 文件路径 → 文件内容（UTF-8 字符串或 Uint8Array） */
  files: Map<string, string | Uint8Array>
  /** 编译警告 */
  warnings: CompileWarning[]
}

export function compile(input: CompilerInput): CompilerOutput
```

**target='vue' 的处理**（Phase 0）：

```ts
if (options.target === 'vue') {
  return {
    files: new Map(),
    warnings: [{
      code: 'target-not-implemented',
      message: "target 'vue' is reserved for Phase 5; only 'react' is implemented in Phase 0"
    }]
  }
}
```

让类型上接受 Vue，运行时拒绝 — 这是「保留架构口子但不实现」的契约。

### 4.3 输出工程结构

```
output/
  package.json
  vite.config.ts
  tsconfig.json
  index.html
  src/
    main.tsx
    App.tsx
    pages/
      <pageName>.tsx
    components/
      <ComponentName>.tsx
    state/                # 每页一个 state 类型文件
      <pageName>.types.ts
```

### 4.4 单页面编译流程

```
SceneGraph (page node)
  ├── 收集 state[] → emit `const [count, setCount] = useState(0)`
  ├── 收集 bindings → 记录 propName → ref(stateId) 映射
  ├── 收集 events → emit 事件 handlers
  └── 递归子节点 → emit JSX
        ├── FRAME → <div className={tailwind...}>
        ├── TEXT → 检查 bindings.text → {count} 或 字面文本
        ├── INPUT → <input className={...} value={...} onChange={...} />
        ├── BUTTON → <button onClick={...}>{text}</button>
        └── LIST → {items.map(item => <ChildClone />)}
```

### 4.5 表达式子集（Phase 0）

只支持极简表达式，不引入完整 parser：

| 输入 | 输出 |
|---|---|
| `count + 1` | `count + 1` |
| `count - 1` | `count - 1` |
| `!flag` | `!flag` |
| `"hello"` | `"hello"` |
| `42` | `42` |
| `count` | `count` |

实现：正则 + 白名单 token，禁止函数调用、属性访问、操作符以外的 token。Phase 1 升级到 `@babel/parser` 做 AST 校验。

### 4.6 复用现有 JSX 导出器

`packages/core/src/io/formats/jsx/export.ts` 已经能输出 JSX + Tailwind。**重构而不是重写**：

```ts
// 现状：
nodeToJSX(node, graph, indent, format): string

// Phase 0 改造为：
nodeToJSX(node, graph, indent, format, ctx?: CompileCtx): string

interface CompileCtx {
  /** 已定义的 state，决定 bindings 该 emit 什么 */
  states: Map<string, StateDef>
  /** 当前 component scope（用于 LIST 内部的 item.xxx 引用） */
  scope: 'page' | 'list-item'
}
```

`ctx` 为 undefined 时行为完全等同现状（向后兼容）。传 `ctx` 时启用 state 注入。

---

## 5. iframe 预览管线

### 5.1 架构

```
┌─ Editor (Vue) ────────────────────────────────┐
│  SceneGraph 变更                                │
│       │ (debounced 200ms)                      │
│       ▼                                        │
│  @open-pencil/compiler.compile()               │
│       │                                        │
│       ▼ Map<path, content>                     │
│  In-Memory VFS (vite-plugin-vfs?自实现)        │
│       │                                        │
│       ▼                                        │
│  Vite Dev Server (esbuild HMR)                 │
│       │                                        │
│       ▼ http://localhost:<port>/               │
│  <iframe src=...>                              │
└────────────────────────────────────────────────┘
```

### 5.2 实现路径

**Option A：内嵌 Vite dev server（推荐）**

主进程额外起一个 Vite 实例（端口 5174），由 `packages/compiler/dev-server.ts` 维护：

```ts
import { createServer } from 'vite'

const previewServer = await createServer({
  server: { port: 5174, middlewareMode: false },
  plugins: [
    react(),
    inMemoryVFS({ getFiles: () => latestCompilerOutput.files })
  ]
})
```

- 编译器每次 compile 完成 → 把 `files` Map 灌进 in-memory VFS plugin
- VFS plugin 拦截 `resolveId` / `load` 钩子，对 `/virtual-app/**` 路径返回内存文件
- Vite HMR 自动检测变化并推 update 到 iframe

**Option B：直接 esbuild bundle 后 srcdoc 注入**

简单但失去 HMR，每次都全量刷新。**不推荐**——MVP 也要保 HMR 体验。

### 5.3 编辑器集成

新增 `src/app/lowcode/preview-pane/`:

```
preview-pane/
  PreviewPane.vue        # iframe 容器 + 设备尺寸切换 + 刷新按钮
  use-preview-server.ts  # 启动/重启/状态查询
  use-compile-on-change.ts # 监听 sceneVersion 触发编译
```

`PreviewPane.vue` 作为编辑器右侧的可选面板（和现有 Properties / Layers 并列）。

### 5.4 数据流绑定

编辑器画布的 selection 与 iframe 预览的元素**双向高亮**：
- iframe 内运行时注入一段 postMessage 桥
- 用户在画布选中节点 → postMessage → iframe 高亮对应元素
- iframe 点击元素 → postMessage → 编辑器选中节点
- 通过 `data-node-id` 在编译时埋点（dev 模式独占，prod 移除）

---

## 6. 文件 / 目录布局变更

```
packages/
  core/                  # 现有，新增几个字段和 6 个 NodeType
  compiler/              # ⭐ 新增
    src/
      index.ts
      types.ts
      project.ts
      page.ts
      component.ts
      expression.ts
      state.ts
      event.ts
      interactive.ts
      style.ts
      dev-server.ts
      vfs-plugin.ts
    tests/
  vue/                   # 现有
  cli/                   # 现有，新增 `open-pencil compile <file>` 命令
  mcp/                   # 现有
  docs/                  # 现有

src/
  app/
    lowcode/             # ⭐ 新增 app-level lowcode 集成
      preview-pane/
      state-store/       # 编辑器侧的 state 编辑 store（不是用户应用 state）
      binding-utils/

  components/
    Properties/
      Interactive/       # ⭐ 新增交互组件属性面板
        InteractivePropsPanel.vue
        BindingInput.vue
        StatePanel.vue
        EventBindingList.vue
    Toolbar/
      ToolbarInteractiveGroup.vue  # ⭐ 新增工具栏交互分组
```

### Steiger 边界更新

`steiger.config.ts` 需加新规则：
- `packages/compiler/**` 不能导入 `src/**` 或 `packages/vue/**`（必须保持 Node/Bun 可执行）
- `src/app/lowcode/**` 可以导入 `@open-pencil/compiler`
- `src/components/Properties/Interactive/**` 不能导入 `src/app/lowcode/**`（保持 components 不依赖 app）

---

## 7. 工作分解（建议 3 人，11-13 周）

> 比初稿多 1 周——为 IR 层（决定 #1 修订后引入）预留。

| 周 | 工程师 A（Core） | 工程师 B（Compiler） | 工程师 C（App/UI） |
|---|---|---|---|
| 1-2 | Schema 扩展 + Kiwi pluginData 编解码 + types 测试 | 起 `@open-pencil/compiler` 骨架 + project.ts + 输出 hello-world Vite 工程 | 工具栏交互组 + 6 个交互节点的 Skia 渲染（FRAME 复用） |
| 3 | 6 个 NodeType 的 defaultProps + 工具集成（ALL_TOOLS） | **IR 层：collect-tree.ts + ir/types.ts + 单测**（无 adapter） | InteractivePropsPanel.vue 骨架 |
| 4 | — | **React adapter：emit-element.ts + scaffold.ts**（端到端 hello-element） | — |
| 5-6 | bindings/events 字段持久化 + undo 集成 | expression.ts（IR 层）+ collect-bindings.ts + emit-binding.ts + emit-event.ts | StatePanel.vue + BindingInput.vue |
| 7-8 | — | dev-server.ts + vfs-plugin.ts + HMR | PreviewPane.vue + 通信桥 |
| 9-10 | 测试 + 文档 | 测试 + CLI 集成（`open-pencil compile`）+ Steiger 跨层边界规则 | 端到端 demo 流程打磨 |
| 11-13 | 联调 + bug bash + 验收 Phase 0 success criteria |

---

## 8. 关键决定（已锁定）

| # | 主题 | 决定 | 影响范围 |
|---|---|---|---|
| 1 | 输出目标框架 | **IR + React adapter**（Phase 0 仅 React；Vue adapter 留架构口子，Phase 5 实现） | 编辑器保持 Vue 不动。编译器内部 SceneGraph → IR → React adapter → `.tsx`。Phase 0 + 1 周做 IR 层，换 Vue/Solid/Svelte adapter 都是 +3-4 周 |
| 2 | 路由架构 | **Vite SPA**（Phase 0/MVP）；Next.js export 推迟到 Phase 4 | `react-router-v6` 仅 Phase 1 启用，Phase 0 无路由 |
| 3 | 输出语言 | **TypeScript**（始终启用，无 JS 选项） | StateDef → 自动生成的 `.types.ts` 文件提供类型补全 |
| 4 | 表达式语法 | Phase 0 用**白名单正则子集**（变量 + `+ - !` + 字面值）；Phase 1 升级到 `@babel/parser` AST 校验 | `packages/compiler/src/expression.ts` 在 Phase 0 不引 babel 依赖 |
| 5 | iframe 沙箱 | dev 模式**不加** `sandbox` 属性（允许 fetch 测试）；编译产物末态 `sandbox="allow-scripts allow-same-origin"` | 影响 `PreviewPane.vue` 实现 |
| 6 | 多页面 | Phase 0 **只编译 currentPage**，输出单一 `App.tsx` | 跨页跳转、`<Link>` 留到 Phase 1 |
| 7 | LIST 数据源 | Phase 0 **只支持本地 array state**，不接 API | 必须配 `dataSourceRef: stateId` 指向 array 类型的 StateDef |
| 8 | 撤销栈范围 | **包含**所有 lowcode 字段（state/bindings/events/interactiveProps） | 在 `packages/core/src/editor/undo.ts` 注册新字段；工程师 A 周 5-6 完成 |

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Skia 画布上让 INPUT 显示真实输入框需要 DOM 覆盖层 | 高——可能拖到 Phase 1 | Phase 0 在画布上**不**画真实输入框，画"占位卡片"；交互体验全在 iframe 预览。`get_screenshot` 仍能截图 |
| in-memory VFS Vite plugin 不存在现成的 | 中 | 自实现 ~150 行，参考 `vite-plugin-virtual` |
| Kiwi schema 升级容易但回滚痛 | 中 | Phase 0 全走 pluginData，正式化推到 Phase 0 验收后单独 PR |
| 编辑器是 Vue / 产出 React，两套心智 | 低 | 文档清晰区分；用 `// @editor` `// @runtime` 注释标位置 |
| LIST 编译产物如何 emit map+key | 中 | 强制每个 LIST 子节点带 `dataItemKey` interactiveProp |

---

## 10. 下一步（决定已锁，进入执行）

1. ✅ ~~批准本设计文档~~ 已锁定 8 项决定
2. **建立 `lowcode-phase-0` 分支** — 主线继续 OpenPencil 自身演进，新分支专做扩展
3. **第一个可落地 PR — 周 1 工程师 A 任务**：
   - 在 `packages/core/src/scene-graph/types.ts` 添加 `StateDef` / `BindingExpr` / `ActionDef` / `EventName` 类型
   - 在 `SceneNode` 添加 optional 字段 `state` / `bindings` / `events` / `interactiveProps`
   - `NodeType` union 添加 6 个新值
   - `node-defaults.ts` 为 6 个新 type 设 defaults
   - 单测：旧 `.pen` 文件读取无破坏
4. **第二个 PR — 周 1 工程师 B 任务**：起 `packages/compiler/` 工作区包骨架，跑通输出 hello-world Vite + React + TS 工程
5. **第三个 PR — 周 1 工程师 C 任务**：工具栏交互组按钮 +  6 个新 NodeType 的 Skia 渲染（复用 FRAME）
6. **架构防腐** — 写 `lint/no-lowcode-in-core.mjs` Steiger 插件，保 `packages/core` 不被 lowcode 概念污染

---

### 附：与 Bubble 的最终对位（Phase 0 完成时）

| Bubble 能力 | Phase 0 状态 |
|---|---|
| 可视化页面搭建 | ✅ 基本覆盖（OpenPencil 原生） |
| 交互组件 | 🟡 6 个，覆盖 80% 表单场景 |
| 状态管理 | 🟡 页面级 state，无全局 store |
| 表达式 | 🟡 极简子集（变量 + 加减取反） |
| 事件 | 🟡 onClick/onChange/onSubmit + setState only |
| 数据库 | ❌ Phase 2 |
| 工作流 | ❌ Phase 3 |
| 部署 | ❌ Phase 4 |

Phase 0 完成时还**不是**可商用产品，是**底座 + PoC**。验收标准只看技术架构成立、demo 跑通。
