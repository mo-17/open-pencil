# Phase 1 — Lowcode Platform on OpenPencil

> 紧接 `docs/lowcode-phase-0.md`。Phase 0 在 HEAD `dd6dfe3`（branch
> `lowcode-phase-0`）收官，所有 6 项成功标准均已达成（CLI `compile` 端到端 + 画布 ↔
> preview 选区桥 + Tauri 实测）。本 doc 是 Phase 1 的 source of truth：**§1 已锁定可
> 直接实施；§7 列出的其它候选未承诺，将随排期分批扩写本 doc**。

---

## 1. 范围

### 1.1 Phase 1 In-Scope（已承诺）

| # | 主题 | 状态 |
|---|---|---|
| 1 | **Canvas-direct 子节点的绝对定位** | ✅ 已交付（HEAD `d36be97`），本 doc §2 详述 |
| 2 | **`@vitejs/plugin-react` Fast Refresh** | ✅ 已交付（HEAD `4247e6e`），本 doc §10 详述（原 §7.2） |
| 3 | **多页面编译 + `react-router-dom`（v6）** | 代码落地（HEAD `79db27e`），Tauri 实测暂停（依赖 §12），本 doc §11 详述（原 §7.1） |
| 4 | **Lowcode 字段 `.fig` 持久化** | 锁定，本 doc §12 详述（原 §7.5；Phase 0 §2.5 承诺兜底） |

> §1 / §10 已交付；§11 代码已落地待联调；§12 锁定。其余候选见 §7，需要排期时再写入 1.1。

### 1.2 Phase 1 Out-of-Scope（明确推迟）

- 实时表达式校验 UI —— 候选 §7.3
- `ActionDef.kind` 收窄 + 扩 `navigate` / `setVariable` —— 候选 §7.4
- `layoutMode: 'FREE'` schema 字段（任意层级混合 free + auto-layout）—— 留给 Phase 2+
- 多页面 **preview iframe** 联动（编辑器 preview 仍传 `[currentPageId]` 单页切片）——`react-router-dom` 仅落地在 CLI 导出与 single-iframe-route 内部使用；preview-pane 跨页路由留作 §11 后续候选
- Lowcode 字段升格为 Kiwi schema 一等字段（`kiwi-schema/` 是 vendored）—— Phase 2+ 评估

### 1.3 Phase 1 成功标准

仅针对 §1。当所有项均通过即可宣告 Phase 1 §1 完成：

1. 任意 SceneNode 直接放置在 CANVAS（页面）上，其在 iframe 预览里的位置（top-left 像素坐标）等于画布上的 `(x, y)`，**误差 0px**。
2. 把同一节点拖到画布新坐标，preview iframe 在 200ms 内（compile 防抖）反映到新位置；canvas↔preview 选区桥的蓝色 overlay 跟随移动。
3. CANVAS 直接子项若自身是 AutoLayout FRAME，其**内部**子节点仍按 flex/grid 流式布局——绝对定位只发生在"page → 直接子项"这一层。
4. CLI `bun open-pencil compile <file>` 产出的项目里，CANVAS 直接子项的 `App.tsx` 含 `absolute` / `left-[Xpx]` / `top-[Ypx]` 等价类，页面 wrapper 含 `relative`。
5. 现有 AutoLayout / Flex / Grid 路径行为**完全不变**：把 Phase 0 的 hello-world / count-button demo 重新编译，diff 应当只多出 page wrapper 的 `relative` 类，其它字节不变。
6. `bun run check` 全绿；`bun test ./tests/engine/compiler/` 全绿。

---

## 2. §1 详细设计：Canvas-direct 绝对定位

### 2.1 现状与问题

Phase 0 的 compiler 直接复用 `packages/core/src/io/formats/jsx/tailwind-classes.ts`（Figma "Dev Mode" JSX 导出器）。该导出器只翻译 **AutoLayout / Flex / Grid 容器语义**——`layoutMode`、`itemSpacing`、`padding`、`gridTemplateColumns` 等——而 SceneNode 自由 `(x, y)` 一律丢弃。

后果：用户在画布空白处摆放一个 BUTTON，iframe 里它会变成页面 `<div>` 的 block-flow 兄弟节点，与设计稿位置完全不符。这违背产品对标 Bubble 的核心承诺——"drag where it stays"。

**反面例子（当前行为）：**

```
画布:
  ┌──────────────────┐
  │  CANVAS (page)   │
  │                  │
  │     [BUTTON]     │  ← x=200, y=150
  │                  │
  │  [TEXT]          │  ← x=40,  y=300
  └──────────────────┘

iframe 现状:
  ┌──────────────────┐
  │ [BUTTON]         │  ← 顺序排列，x/y 丢失
  │ TEXT             │
  └──────────────────┘
```

### 2.2 SceneGraph → CSS 路径改动

**位置**：`packages/core/src/io/formats/jsx/` —— 故意复用，与 Phase 0 §4.6 决定一致（"compiler 不重写样式翻译；样式由 jsx 导出器集中负责"）。

**改动 1：扩 `getNodeContext`**

文件：`packages/core/src/io/formats/jsx/helpers.ts`

```ts
export function getNodeContext(node: SceneNode, graph: SceneGraph) {
  const parent = node.parentId ? graph.getNode(node.parentId) : null
  return {
    isAutoLayout: node.layoutMode !== 'NONE',
    isGrid: node.layoutMode === 'GRID',
    isFlex: node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL',
    parentIsAutoLayout: parent ? parent.layoutMode !== 'NONE' : false,
    parentIsGrid: parent ? parent.layoutMode === 'GRID' : false,
    parentIsCanvas: parent?.type === 'CANVAS' // ⭐ 新增
  }
}
```

**改动 2：`applyLayoutStyle` 末尾追加一个 pass**

文件：`packages/core/src/io/formats/jsx/tailwind-classes.ts`

```ts
function applyLayoutStyle(style, node, graph): void {
  const ctx = getNodeContext(node, graph)

  // 既有 Grid / Flex / 默认尺寸分支保持不变 …

  if (ctx.parentIsAutoLayout && node.layoutGrow > 0) style.flexGrow = '1'
  if (ctx.isAutoLayout) applyPadding(style, node)

  // ⭐ Phase 1 §1：CANVAS 直接子项 → 绝对定位
  if (ctx.parentIsCanvas) {
    style.position = 'absolute'
    style.left = px(node.x)
    style.top = px(node.y)
    // 注意：width / height 已由上方 Grid/Flex/默认分支写入；
    // 即便子项内部是 HUG，CANVAS 直接子项也必须有显式尺寸，
    // 否则 absolute 元素脱离文档流后会塌成 0×0。补一个兜底：
    if (!style.width) style.width = px(node.width)
    if (!style.height) style.height = px(node.height)
  }
}
```

**改动 3：rotation 不冲突**

`applyAppearanceStyle` 中 `node.rotation !== 0` 时已经写 `style.transform = rotate(...)`。CSS 里 `position` 与 `transform` 互不干扰——absolute 元素的位置由 `left/top` 决定，`transform` 在其上叠加。**不要**改成 `transform: translate(x, y)`，因为：
- 旋转会被 `translate` 覆盖；
- Plasmic/Bubble 都用 `left/top`，便于用户读懂导出的代码。

### 2.3 Page 根容器

文件：`packages/compiler/src/adapters/react/scaffold.ts`

当前 page wrapper 是裸 `<div>`：

```tsx
return (
  <div>
    {/* children */}
  </div>
)
```

改为：

```tsx
return (
  <div className="relative min-h-screen">
    {/* children */}
  </div>
)
```

- `relative` 为 absolute 子项建立定位上下文。
- `min-h-screen` 防止 page wrapper 因所有子项 `absolute` 后塌成 0px 高、整页空白。

`buildIndexCss` 的 `@source inline(...)` 安全列表需要把 `relative` / `min-h-screen` 加进去——但实际上它已经会从 `App.tsx` 里收集到所有 className，所以一旦 scaffold 写出这两个类，安全列表自动包含，无需手动追加。

### 2.4 嵌套规则

**只在 CANVAS → 直接子项**这一层 emit 绝对定位。任何更深的子树（包括 CANVAS-direct 子项**内部**的孩子）继续走 Flex/Grid 或文档流。

示例：

```
CANVAS
├─ FRAME (autoLayout=HORIZONTAL)   ← parentIsCanvas=true  → absolute, left/top
│  ├─ BUTTON                       ← parentIsCanvas=false → flex item, no left/top
│  └─ TEXT                         ← parentIsCanvas=false → flex item, no left/top
└─ BUTTON                          ← parentIsCanvas=true  → absolute, left/top
```

这保证了 §1.3 成功标准 #3：CANVAS 直接子项可以是 AutoLayout 容器，其内部子节点继续按 flex 流。

### 2.5 不动什么

- **不**改 IR 层（`packages/compiler/src/ir/**`）。`isPageChild` 信号通过 `getNodeContext` 在 jsx 导出器内部隐式表达，IR 保持纯净。
- **不**改 Kiwi schema。`SceneNode.x / y` 早就存在；不引入 `layoutMode: 'FREE'`、不引入"page 类型"等新枚举。
- **不**改 canvas-side 渲染。Phase 0 §3.1 已经说交互组件在画布上画占位卡片，本 phase 不变。
- **不**为 LIST / FORM / 其它容器加 absolute 子项规则——只针对 page。

---

## 3. 测试策略

### 3.1 单元测试

新增 `tests/engine/compiler/canvas-absolute.test.ts`（或追加 `compile.test.ts`）：

| 用例 | 期望 |
|---|---|
| CANVAS 上放 1 个 BUTTON（x=120, y=80）→ compile | App.tsx 含 `absolute`、`left-[120px]`、`top-[80px]`；page wrapper 含 `relative`。 |
| BUTTON 嵌套在 AutoLayout FRAME 中 → compile | BUTTON 的 className **不含** `absolute` / `left-` / `top-`；FRAME 自己含。 |
| 空 page → compile | wrapper 仍是 `<div className="relative min-h-screen">` 或等价（验证默认不破坏）。 |
| 现有 hello-world / count-button 用例 | diff 应当只在 page wrapper 类名出现，正文 JSX 不变。 |

### 3.2 集成测试（手动）

1. `bun run tauri dev`
2. 拖一个 BUTTON 到画布坐标 (200, 150)、再拖一个 TEXT 到 (40, 300)。
3. preview iframe 中两者位置应当与画布完全一致。
4. 把 BUTTON 拖到新坐标 (300, 100)，200ms 内 iframe 跟到新位置。
5. canvas↔preview 选区桥的蓝色 overlay 跟随 BUTTON 移动；Option-click iframe 中的 BUTTON 仍能反向选中。

### 3.3 性能验证

不在 §1 成功标准里，但顺手测一下：CANVAS 上放 50 个节点 → compile 输出仍 <50ms，preview iframe 首次渲染 <300ms。如果显著退化再回头优化（不会，本改动只是多加几行 inline style）。

---

## 4. 工作分解（建议 1 名工程师，3–5 天）

| 天 | 任务 | 验收 |
|---|---|---|
| 1 | `getNodeContext` 扩 `parentIsCanvas` + `applyLayoutStyle` pass + helpers/tailwind-classes 单测 | 单测全过；`bun run check` 全绿 |
| 2 | scaffold.ts 改 page wrapper + scaffold 单测调整 | scaffold.test.ts / compile.test.ts 全过 |
| 3 | `tests/engine/compiler/canvas-absolute.test.ts` 端到端用例 | 4 个用例全绿 |
| 4 | Tauri 实测 + 视觉确认 + bug 修复 | §3.2 五步全过 |
| 5 (buffer) | 处理嵌套/旋转/视觉回归边角；写 changelog；commit | PR 风格小步 commit |

---

## 5. 关键决定（已锁定）

> 与 Phase 0 §8 同形式。锁定后**不在对话中重新讨论**；若用户后续想推翻视为显式 scope change 并更新本节。

| # | 主题 | 决定 | 理由 |
|---|---|---|---|
| 1 | 信号位置 | 在 jsx 导出器的 `getNodeContext` 内隐式判断，**不**新增 IR 字段 | 与 Phase 0 §4.6 "复用 JSX 导出器" 一致；避免 IR schema 变更 |
| 2 | 定位 CSS | 用 `position: absolute; left/top`，**不**用 `transform: translate(...)` | 与现有 rotation 路径正交；Plasmic/Bubble 同款，可读性更好 |
| 3 | 适用范围 | 只针对 CANVAS → 直接子项一层；更深的 absolute 留给 Phase 2+ | 避免 free + auto-layout 在树内任意层混合带来的 schema 复杂度 |
| 4 | Page wrapper | 默认 `relative min-h-screen`（无论是否真有 absolute 子项） | 单一 wrapper 类型，AutoLayout-only 页面也无副作用 |
| 5 | 不引入 `layoutMode: 'FREE'` | Phase 1 不动 schema | 留给 Phase 2 重新评估是否要在树内任意层混合 |

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| CANVAS 直接子项是 AutoLayout 容器时，HUG sizing 与 absolute 冲突（HUG 期望 0 尺寸由内容撑开，absolute 期望显式尺寸） | 中——画面塌掉 | §2.2 改动 2 已兜底：CANVAS 直接子项无论 sizing 模式，必须有显式 `width/height` |
| 旧 demo 的视觉回归（Phase 0 已通过的 hello-world / count-button） | 高——回归是硬伤 | §1.3 #5 成功标准要求"diff 只多 page wrapper 类名"，写测试断言 |
| Tailwind v4 `@source inline(...)` 没收到 `min-h-screen` / `relative` | 低 | `buildIndexCss` 已经从 App.tsx className 自动收集；scaffold 写出即被包含 |
| 用户在 CANVAS 上放节点后调整 `width: HUG`，期望尺寸由内容决定 | 低 | §1.3 #1 只要求位置 0 误差；尺寸由 `node.width/height` 当前值决定；HUG 实际反映为 SceneNode width/height 由 canvas 渲染层维护 |
| Phase 2 引入 `layoutMode: 'FREE'` 后本期决定需要重构 | 低 | §5.5 已锁定不引入，留干净的迁移路径——届时把"只 CANVAS 直接子项"放宽为"任何 FREE 容器的直接子项"即可 |

---

## 7. Phase 1 其他候选（未承诺）

> 排序按"产品冲击 × 实施成本"的粗略性价比，不是最终顺序；正式纳入 §1.1 前不开工。详见 memory `lowcode-phase-1-candidates`。

### 7.1 多页面路由

> ✅ 已纳入 §1.1，详见 §11。原描述保留作为历史参考：
> React adapter 当前只编 `pageIds[0]`。本项启用 `react-router-v6`（Phase 0 §8 决定 #2 已批准 Phase 1 启用），编出多 `App.tsx` + `<Routes>` 入口。

### 7.2 `@vitejs/plugin-react` Fast Refresh

> ✅ 已纳入 §1.1，详见 §10。原描述保留作为历史参考：
> `packages/compiler/src/dev-server.ts` 当前每次 compile 都广播 `full-reload`。Fast Refresh 让 iframe 内 `useState` 跨编辑保持——表单 / 计数器调试体验质变。

### 7.3 实时表达式校验 UI

`packages/compiler/src/ir/expression.ts` 的 `action-invalid-expression` / `state-invalid` 警告目前只在 console。把它们 surface 到 StatePanel / BindingInput 的 inline error。

### 7.4 `ActionDef.kind` 收窄 + 扩 `navigate` / `setVariable`

当前是字面 `'setState'`。收窄成判别联合后再扩枚举；compiler 端要把 Phase 0 删掉的"unsupported kind"分支加回来。

### 7.5 `pluginData` → Kiwi schema 正式化

> ⚠️ Phase 1 §12 落地的是 **§7.5 的前半段**：用 `pluginData` 真正持久化 lowcode 字段。原 §7.5 描述里 "升格为 Kiwi 一等字段" 那部分（schema 升级）已划入 Phase 2+（见 §1.2），原因是 `kiwi-schema/` 是 vendored。
>
> 历史背景：`docs/lowcode-phase-0.md` §2.5 承诺 "全走 pluginData，正式化推到 Phase 0 验收后单独 PR" —— 但 Phase 0 验收时 pluginData 的 read/write 路径**就没写**：`SceneNode.state` 等 4 个字段仅在内存里活，存 `.fig` 时被 Kiwi codec 静默丢弃。§12 补上这条管线。

---

## 8. 与 Phase 2 的边界

明确**不属于** Phase 1，避免本 doc scope 漂移：

- `layoutMode: 'FREE'` schema 字段：任意层级混合 free + auto-layout，需要 Properties 面板 UI + undo 注册 + 嵌套规则重构。**Phase 2 起评估**。
- 响应式断点 / 容器查询：Bubble 没有像样的响应式，但 Phase 3+ 想做时再说。
- 自定义组件 / Symbol 跨页复用：Phase 0 决定 #6 推迟，与本 phase 无关。
- 服务器端持久化、用户系统、API：Phase 0 决定 #7 推迟到接 API 阶段。

---

## 9. 下一步

1. ✅ ~~批准本设计文档~~ §1 已锁定 5 项决定。
2. ✅ ~~实施 §2 改动~~ Phase 1 §1 已交付（HEAD `d36be97`），§1.3 全部 6 项成功标准通过 + Tauri 实测通过。
3. ✅ ~~更新 memory `lowcode-phase-0-next` → `lowcode-phase-1-progress`~~ 已完成。
4. ✅ ~~与用户决定 §7 候选的下一个调度~~ 用户选 §7.2 Fast Refresh；已纳入 §1.1，详见 §10。
5. ✅ ~~实施 §10 改动~~ Phase 1 §10 已交付（HEAD `4247e6e`），§10.5 成功标准全部通过 + Tauri 实测通过。
6. ✅ ~~与用户决定下一项~~ 用户选 §7.1 多页面路由；已纳入 §1.1，详见 §11。
7. ✅ ~~实施 §11 代码~~ §11.5 #1–#2 单元测试全过（HEAD `79db27e`）。
8. ✅ ~~Tauri 实测期间发现 §7.5 持久化缺口~~ 用户决定先做 §7.5；§11 Tauri 实测暂停，待 §12 完工后合并实测。
9. 实施 §12 改动；完成 §12.5 成功标准 + 合并实测 §11 + §12 通过后再问用户选下一项。

---

## 10. §7.2 详细设计：Fast Refresh

### 10.1 现状与问题

`packages/compiler/src/dev-server.ts` 的 `updateFiles` 在**两条分支都**广播 `server.ws.send({ type: 'full-reload' })`（见 dev-server.ts:283-289 的 "play it safe; React Fast Refresh upgrade is a followup" 注释）。后果：编辑器里每改一处属性，iframe 都会整页重载——`useState` 状态、`<input>` 焦点、滚动位置全部丢失。

**调试场景示例（当前行为）：**

1. 画布上放一个 BUTTON + TEXT（绑定 `count`）+ Page state `count: number = 0`。
2. iframe 里 +1 三次，counter 显示 `3`。
3. 在编辑器修改 BUTTON 文字 "+1" → "Increment"。
4. **当前**：iframe 整页重载，counter 重置为 `0`。
5. **期望**：iframe 内 BUTTON 文字更新，counter 保持 `3`。

VFS 没有文件 watcher，单靠 `moduleGraph.invalidateModule()` 不会通知客户端。`@vitejs/plugin-react` 已经在编译产物（`packages/compiler/src/project.ts` package.json + buildViteConfig）和 dev-server `plugins: [vfs, react(), tailwindcss()]` 里都跑着——Fast Refresh 链路其它部分已通，差的就是 dev-server 端的事件分发。

### 10.2 dev-server 改动

文件：`packages/compiler/src/dev-server.ts`

**抽出 `classifyUpdate`（纯函数，便于单测）：**

```ts
export type UpdateMode = 'full-reload' | 'hmr' | 'noop'

export function classifyUpdate(changes: readonly string[], invalidated: number): UpdateMode {
  if (changes.length === 0) return 'noop'
  if (changes.includes('index.html') || invalidated === 0) return 'full-reload'
  return 'hmr'
}
```

**改写 `updateFiles` 末段，发 Vite 自有 `update` 协议事件：**

```ts
const mode = classifyUpdate(changed, invalidated)
if (mode === 'noop') return
if (mode === 'full-reload') {
  server.ws.send({ type: 'full-reload' })
  return
}
// HMR: send Vite's native 'update' event with js-update / css-update entries.
// plugin-react's transform stage auto-injects `import.meta.hot.accept(...)`
// boundaries into modules whose only exports are React components; the
// client runtime then re-evaluates the module in place and preserves
// useState. If a module isn't accept-able (e.g. it exports non-component
// values), the Vite client itself falls back to full-reload.
const timestamp = Date.now()
const updates = invalidatedPaths.map((rel) => {
  const url = '/' + rel
  const type = rel.endsWith('.css') ? 'css-update' : 'js-update'
  return { type, path: url, acceptedPath: url, timestamp }
})
server.ws.send({ type: 'update', updates })
```

> `invalidatedPaths` is captured from the existing invalidation loop — store the rels alongside the counter rather than re-walking.

### 10.3 关键决定（已锁定）

| # | 主题 | 决定 | 理由 |
|---|---|---|---|
| 1 | 客户端协议 | 用 Vite 自有 HMR 协议 `{type:'update', updates:[...]}`，**不**发明自定义事件 | 客户端运行时已经在 iframe 里，无需 ship 额外代码 |
| 2 | plugin-react 边界 | 信任 plugin-react 在 transform 阶段自动注入的 `import.meta.hot.accept`；**不**手工 invoke `handleHotUpdate` | 我们的 App.tsx 是纯组件模块（`export default function App`），命中 plugin-react 的自动 accept；写死调用是反模式 |
| 3 | 分类抽出 | 把 `noop / full-reload / hmr` 三态抽成 pure helper，单测覆盖；**不**写 WebSocket 集成测试 | ws 集成测试重而脆；pure helper 覆盖决策矩阵已足够 |
| 4 | 回退策略 | Fast Refresh 失败时（模块加了非组件导出）由 Vite 客户端自动回退到 full-reload；**不**在 server 端兜底 | Vite 客户端已实现此回退，重复实现只会跑偏 |
| 5 | full-reload 触发条件 | `index.html` 变更 ∨ `invalidated === 0` → full-reload；其它 → HMR | index.html 是 SPA 入口，HMR 替换不了；零失效说明 VFS 没匹配上，HMR 没意义 |

### 10.4 不动什么

- 编译产物（`package.json` / `vite.config.ts` / `main.tsx`）保持不变；plugin-react 已在。
- 编辑器侧 `PreviewPane.vue` / preview-bridge 不变；NDJSON `update` 命令格式不变。
- 不引入 React DevTools / source maps / 错误边界（正交关注点）。
- 不动 §1 的 absolute 定位逻辑。

### 10.5 成功标准

仅针对 §10。当所有项均通过即可宣告 §10 完成：

1. `bun test ./tests/engine/compiler/` 全绿；新增 `classifyUpdate` 单测覆盖 4 个分支（empty/index-html/zero-invalidated/hmr）。
2. `bun run check` 全绿。
3. Tauri 实测（doc §10.6）：count-button demo —— +1 三次到 `count=3` → 编辑 BUTTON 文字 → iframe BUTTON 文字变，counter 数字仍是 `3`。
4. 同实测：编辑 BUTTON 颜色或 padding（仅 className 变动）→ iframe 视觉更新，counter 数字保留。
5. 视觉/交互回归：当 index.html 真的变了（比如改 packageName），仍触发 full-reload，行为与现在一致。

### 10.6 测试策略

**单元测试**：`tests/engine/compiler/classify-update.test.ts`

| 用例 | 期望 |
|---|---|
| `classifyUpdate([], 0)` | `'noop'` |
| `classifyUpdate(['index.html'], 1)` | `'full-reload'` |
| `classifyUpdate(['src/App.tsx'], 0)` | `'full-reload'`（无匹配模块） |
| `classifyUpdate(['src/App.tsx'], 1)` | `'hmr'` |
| `classifyUpdate(['src/App.tsx', 'index.html'], 1)` | `'full-reload'` |

**集成测试**：手动 Tauri，§10.5 #3-5。

### 10.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| plugin-react 拒绝 accept（App.tsx 同时 export 非组件） | 中——Fast Refresh 失败 fall back to full-reload | Vite 客户端原生兜底，我们不引入额外异常；compile 端目前只 export 一个组件 |
| HMR 事件 `path` 形式不对（应当 `/src/App.tsx`，不能裸 `src/App.tsx`） | 中——客户端拿不到 update | 严格用 `'/' + rel`；单测断言不需要（Vite 自己会忽略错误路径），手测覆盖 |
| Tailwind v4 CSS 通过 `@source inline(...)` 注入；新增 className 后 css-update 是否覆盖？ | 低 | Tailwind v4 vite plugin 自带 HMR；我们 invalidate 后它会重 transform，Vite 自己发 css-update |
| Vite 版本升级改了 HMR 协议字段名 | 低 | 项目锁 `vite: ^7.0.0`，本期不变；如升级需重新测 |
| HMR 频繁触发导致 plugin-react runtime 累积内存 | 低 | iframe 是短命的；Tauri 重开就清 |

### 10.8 工作分解（建议 1 名工程师，1–2 天）

| 天 | 任务 | 验收 |
|---|---|---|
| A | doc §10 写完，决定锁定 | 本节存在 |
| B | `classifyUpdate` 抽出 + `updateFiles` 改写 + 单测 | `bun test ./tests/engine/compiler/` 全绿；`bun run check` 全绿 |
| C | Tauri 实测 §10.5 #3-5 | 全过 |

---

## 11. §7.1 详细设计：多页面编译 + react-router-dom

### 11.1 现状与问题

`packages/compiler/src/index.ts:34` 当前只对 `input.pageIds[0]` 收集 IR；其它 page 一律忽略。CLI (`packages/cli/src/commands/compile.ts:103`) 默认拿 `pages[0]`，或按 `--page <name>` 过滤后取**一个** page。`CompilerOptions.router` 字段从 Phase 0 就是 `'react-router-v6' | 'vue-router-v4' | 'none'`，但 React adapter 完全不读它（`packages/compiler/src/adapters/react/index.ts` 没引用 `options.router`）。

后果：用户在 SceneGraph 里 `addPage()` 几次得到多个 CANVAS 节点（schema 早就支持），但编译出来的项目只渲一个页面、没有路由，导航 / 跨页跳转无从谈起。Phase 0 §8 决定 #2（"react-router-v6 仅 Phase 1 启用"）就是为本期落地预留的口子。

**调试场景（当前 vs 期望）：**

```
SceneGraph:
  root
  ├─ CANVAS "Home"     (id=p1)
  ├─ CANVAS "About"    (id=p2)
  └─ CANVAS "Contact"  (id=p3)

CLI:    bun open-pencil compile demo.pen --out ./dist
当前:  ./dist/src/App.tsx                  ← 只有 Home 一页，About/Contact 丢
期望:  ./dist/src/App.tsx                  ← <BrowserRouter><Routes>…</Routes></BrowserRouter>
       ./dist/src/pages/index.tsx          ← Home 路由 /
       ./dist/src/pages/about.tsx          ← About 路由 /about
       ./dist/src/pages/contact.tsx        ← Contact 路由 /contact
```

### 11.2 公开 API 改动

唯一行为变化在 `compile()` 内部，签名不变：

```ts
// packages/compiler/src/index.ts
export function compile(input: CompilerInput): CompilerOutput {
  if (input.pageIds.length === 0) {
    return { files: new Map(), warnings: [{ code: 'no-pages', message: 'CompilerInput.pageIds is empty' }] }
  }
  const { adapter, warnings: selectionWarnings } = selectAdapter(input.options)
  if (!adapter) return { files: new Map(), warnings: selectionWarnings }

  const irs: IRTree[] = input.pageIds.map((id) => collectTree(input.graph, id))
  const { files, warnings: adapterWarnings } = adapter.emit(irs, input.options)
  return {
    files,
    warnings: [...selectionWarnings, ...irs.flatMap((ir) => ir.warnings), ...adapterWarnings]
  }
}
```

`FrameworkAdapter.emit` 签名从 `(ir: IRTree, …)` 改为 `(irs: readonly IRTree[], …)`。React adapter 在 emit 内部判 `irs.length`：

- `irs.length === 1` → 既有 `src/App.tsx` 路径，零回归（绝大部分既有测试沿用）
- `irs.length > 1` → 走多页路径，emit `src/App.tsx`（router shell）+ `src/pages/<slug>.tsx`（每页一个），同时把 `react-router-dom` 加进 `package.json`

`CompilerOptions.router` 字段 Phase 1 仍 **仅作类型占位 / 文档**，runtime 由 `irs.length` 单独决定（见 §11.3 决定 #4）。

### 11.3 关键决定（已锁定）

> 与 §5 / §10.3 同形式。锁定后**不在对话中重新讨论**；若用户后续想推翻视为显式 scope change 并更新本节。

| # | 主题 | 决定 | 理由 |
|---|---|---|---|
| 1 | 单页 / 多页分支 | `pageIds.length === 1` 沿用既有 `src/App.tsx`；`length > 1` 拆 router shell + `src/pages/<slug>.tsx` | 单页路径零字节回归（既有测试不动）；多页是新形态；两条分支都很短，不引入抽象 |
| 2 | 路由器选择 | `BrowserRouter` from `react-router-dom@^6.27.0` | Phase 0 §8 决定 #2 已批准；Vite SPA fallback 已天然兼容 `BrowserRouter`；HashRouter 留 Phase 2+ 评估部署场景再上 |
| 3 | 路径派生 | 首页（`pageIds[0]`）固定 `/`；其它按 `pageName` slugify（小写 + `[^a-z0-9]+` → `-`，首尾去 `-`）；冲突追加 `-${index}`；空 slug fallback `page-${index}` | 用户可读、与 Plasmic/WeWeb 一致；page id 是内部细节不进 URL；冲突算法稳定可复现 |
| 4 | `options.router` 字段 | Phase 1 不读；runtime 由 `pageIds.length` 单独决定多页 emit | 避免 `router: 'none' + 多页` 的语义歧义；该字段留作未来 Phase 区分 SPA / HashRouter / Next.js export 时再启用 |
| 5 | preview-pane 仍单页 | 编辑器 preview-pane (`use-compile-on-change.ts`) 仍传 `[currentPageId]` 单页切片，命中 §11.3 决定 #1 的单页分支；多页只在 CLI 导出生效 | iframe + 路由 + HMR 三方联动复杂度高；本期先把"多页能编 + 多页能跑（CLI export）"做扎实，preview 跨页路由留作后续候选 |

### 11.4 React adapter 改动

文件清单：

- `packages/compiler/src/adapters/types.ts` — `FrameworkAdapter.emit` 签名 `(ir → irs)`
- `packages/compiler/src/adapters/react/index.ts` — 入口分发：单页走旧路径，多页走新路径；`collectClassNames` 改成接受 `irs`
- `packages/compiler/src/adapters/react/scaffold.ts` — 抽出 `buildPageBody(ir, devMode)` 共享给单页 / 多页两条路径；新增 `buildRouterApp(slugByPageId, devMode)` emit router shell；保留 `buildAppTsx` 作为单页便捷封装
- `packages/compiler/src/adapters/react/route-paths.ts` — **新增**，纯函数 `derivePagePaths(irs): Map<pageId, { slug, file, route, component }>`；冲突解决在这里集中
- `packages/compiler/src/project.ts` — `buildPackageJson` 接受 `extraDeps?: Record<string, string>`；多页时 React adapter 传 `{ 'react-router-dom': '^6.27.0' }`
- `packages/compiler/src/index.ts` — 收 IR 列表，转发给 adapter
- `packages/compiler/src/types.ts` — `CompilerInput.pageIds` 注释从 "Phase 0 only emits the first entry" 改为 "All pages are compiled (Phase 1 §11)"

不动的：

- IR 层（`ir/types.ts` / `ir/collect/tree.ts`）—— `collectTree` 已经按 pageId 工作；只是被调用 N 次而已
- preview-bridge.ts —— 不需要 navigate 消息（决定 #5）
- `src/main.tsx` —— 仍 `<App />`，App 自己变成 router shell
- `index.html` —— title 仍来自 packageName
- esbuild / vfs / dev-server —— 不感知页面数量

### 11.5 成功标准

仅针对 §11。当所有项均通过即可宣告 Phase 1 §11 完成：

1. `bun test ./tests/engine/compiler/` 全绿；新增 `multi-page.test.ts` + `route-paths.test.ts` 覆盖至少：slug 派生 / 冲突解决 / 单页路径零回归 / 多页文件清单 / package.json 含 `react-router-dom` 当且仅当多页 / router shell 含 `BrowserRouter` + `Routes` + 正确路由数。
2. `bun run check` 全绿（oxlint、tsgo、vue-tsc、i18n、steiger、jscpd 0 clones）。
3. CLI 实测（**用户主导**）：`bun open-pencil compile <multi-page.pen> --out /tmp/multi-page-out`，输出含 `src/App.tsx`（含 `BrowserRouter`）+ `src/pages/index.tsx` 与至少一个其它 `src/pages/<slug>.tsx`；`cd /tmp/multi-page-out && bun install && bun run dev`，浏览器手动改 URL 切路由，对应页面渲染。
4. CLI 单页实测（**用户主导**）：在一个单页 `.pen` 上 `bun open-pencil compile`，输出与本期前完全一致（除非用户主动改了 page 内容）—— 单页字节级回归零。
5. Tauri preview 实测（**用户主导**）：preview-pane 行为与本期前一致（仍传 `[currentPageId]` 单页切片），iframe 不应出现 router URL；切换 page 仍触发 recompile + 重渲染。

### 11.6 测试策略

**单元测试**：

- `tests/engine/compiler/route-paths.test.ts` —— 纯函数 `derivePagePaths`
  | 用例 | 期望 |
  |---|---|
  | 单页 `[{ name: 'Home' }]` | first → `{ slug: 'index', route: '/', component: 'PageIndex' }` |
  | 多页 `['Home', 'About']` | `['/','/about']` |
  | 名字含空格 / 大写 / 标点 `'My Page!'` | `'my-page'` |
  | 同名冲突 `['Home','Home']` | second slug 追加 `-1` |
  | 空名字 / 纯标点 `''` | fallback `page-${index}` |

- `tests/engine/compiler/multi-page.test.ts` —— 端到端
  | 用例 | 期望 |
  |---|---|
  | 单页 compile | 文件清单与本期前完全一致；`package.json.dependencies` 不含 `react-router-dom` |
  | 三页 compile | `src/App.tsx` 含 `BrowserRouter` + 三个 `<Route>`；三个 `src/pages/*.tsx` 文件；`package.json.dependencies['react-router-dom']` 存在 |
  | 多页 compile + devMode | `src/__preview-bridge.ts` 还在；router shell 顶部 `import './__preview-bridge'`；页面模块 **不** import bridge（决定 #4：每模块自防御已由 bridge 内部 `__openPencilPreviewBridge` guard） |
  | 空 pageIds | `no-pages` warning + 0 文件（保持原行为） |

**集成测试（手动 / 用户主导）**：§11.5 #3–#5。

### 11.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| `react-router-dom@6.x` 在 React 19 下 `<StrictMode>` 双调用导致路由副作用重复 | 低 | 6.27 已支持 React 19；`main.tsx` 保持现状；如真出问题在 §11.5 #3 实测即暴露 |
| Vite SPA fallback 在 dev-server VFS 里是否还能把 `/about` 重写到 `index.html` | 中——影响 CLI export 与 preview 多页 | preview 决定 #5 不走多页所以不受影响；CLI export 跑用户本机 Vite，是真 SPA fallback；VFS 中间件（`dev-server.ts:171-188`）只拦 `/` 与 `/index.html`，其它路径 fall through 到 Vite 默认 SPA fallback —— 不需要改 |
| slugify 算法跟用户中文 page 名冲突（全转空 → 全 fallback） | 低——但生成的 URL 全是 `page-0` `page-1` 不可读 | 决定 #3 明确 fallback；后续 candidate 加 transliteration 时再扩；本期不上 |
| `react-router-dom` 加进 `dependencies` 后用户 `bun install` 失败（registry hiccup） | 低 | 锁版本 `^6.27.0` 与现行 React `^19.2.0` 兼容；若用户自定义 reactVersion='18'，6.x 也支持 18 |
| 重复 page name 导致路由冲突 | 中 | 决定 #3 #-${index} 后缀；新增 `multi-page-duplicate-slug` warning 提示用户 rename |
| 编译输出文件数 1 → N，VFS / dev-server 是否吃得消 | 低 | VFS 走 Map，O(N) lookups；几十页以内无感知；preview 决定 #5 也用不上 |

### 11.8 工作分解（建议 1 名工程师，2–3 天）

| 天 / Step | 任务 | 验收 / commit message |
|---|---|---|
| A（已完成） | doc §11 写完，决定锁定，§1.1 / §1.2 / §7.1 / §9 同步 | 本节存在；用户在对话里 ACK 锁定决定 |
| B（step 1） | `compile()` 收 N 个 IR；`FrameworkAdapter.emit` 改 `(irs, options)`；React adapter 入口分发；单页走旧 `buildAppTsx` 路径；既有测试零修改通过；新增 `multi-page.test.ts` 占位（单页用例） | `bun test ./tests/engine/compiler/` 全绿；`bun run check` 全绿；commit `feat(lowcode): step 1 — multi-page IR pipeline` |
| C（step 2） | `route-paths.ts` 新增 + 单测；`scaffold.ts` 抽 `buildPageBody`；新增 `buildRouterApp` + `buildPageModule`；`project.ts` 接 `extraDeps`；React adapter 多页分支；`multi-page.test.ts` 多页用例补齐 | `bun test ./tests/engine/compiler/` 全绿；`bun run check` 全绿；commit `feat(lowcode): step 2 — react-router-dom emit` |
| D（step 3） | CLI `compile.ts` 默认导出全部 pages；`--page <name>` 仍作单页过滤；CLI 集成测试补 multi-page snapshot | `bun test ./tests/engine/compiler/` 全绿（CLI 测试在 `tests/engine/cli` 内）；`bun run check` 全绿；commit `feat(lowcode): step 3 — CLI exports all pages` |
| E（step 4） | Tauri / CLI 实测 §11.5 #3–#5（用户主导）；修发现的 bug；写 changelog | 用户在对话里 ACK 三条实测全过 |

> **Step 4 状态**：暂停 — Tauri 实测期间发现 lowcode 字段不持久化（state/bindings/events/interactiveProps 写 `.fig` 时被 Kiwi codec 静默丢弃，是 Phase 0 §2.5 的承诺没兑现）。§12 修这条管线后再合并实测 §11 + §12。

---

## 12. §7.5 详细设计：Lowcode 字段 `.fig` 持久化

### 12.1 现状与问题

`SceneNode` 类型上已声明 4 个 lowcode 字段（`packages/core/src/scene-graph/types.ts:383-386`）：

```ts
state?: StateDef[]
bindings?: Record<string, BindingExpr>
events?: Partial<Record<EventName, ActionDef[]>>
interactiveProps?: Record<string, unknown>
```

编辑器 UI（StatePanel / EventsPanel / TextBindingPanel）通过 `updateNodeWithUndo` 把这些字段写入内存 `SceneNode`（`StatePanel.vue:23`）。然而 Kiwi binary codec **完全不读不写** —— 在 `kiwi/node-change/export-node.ts:193-194` 序列化时只 merge `node.pluginData`；4 个 lowcode 字段从未路由到 pluginData，也没有自己的 Kiwi schema 字段（schema 是 vendored，无法新增）。

Phase 0 §2.5 当时的承诺是 "全走 pluginData，正式化推到 Phase 0 验收后单独 PR"，但**那个 PR 从没写过**。`upsertPluginData()` / `getOpenPencilPluginValue()` 这些工具函数（`plugin-data.ts:10-50`）已就位，但 grep 全文搜不到一个**写 lowcode 字段进 pluginData** 的调用点。

后果：
- 用户在 StatePanel 定义 `count: number = 0` → 保存 `.fig` → 关掉编辑器 / CLI 重读 → `count` 丢失。
- §11 编出来的 `App.tsx` 没有 `useState` hook —— 因为 IR 收集器读 `page.state` 拿到 `undefined`。
- Bindings / events / interactiveProps（包括 BUTTON 文字、INPUT placeholder）**同样**不持久化，目前能在 Tauri preview 里看到点击效果只是因为 SceneGraph 还在内存里。

### 12.2 改动路径

走 pluginData 通道（与 Phase 0 §2.5 的设计一致，不动 vendored Kiwi schema）。每个 SceneNode 上多挂 4 个 plugin-data 条目（按需，空值跳过），用 JSON 编码值：

```
PluginDataEntry {
  pluginId: 'open-pencil',
  key:      'lowcode/state' | 'lowcode/bindings' | 'lowcode/events' | 'lowcode/interactiveProps',
  value:    JSON.stringify(<field-value>)
}
```

**Write 端**（`kiwi/node-change/export-node.ts` 第 ~185–194 行附近）：

```ts
// 现在：
const pluginData = mergePluginData(node.pluginData)
if (pluginData.length > 0) nc.pluginData = pluginData

// 改为：
const lowcodeEntries = serializeLowcodeFields(node)
const merged = mergePluginData([...node.pluginData, ...lowcodeEntries])
if (merged.length > 0) nc.pluginData = merged
```

`serializeLowcodeFields(node)` 是新增的纯函数，返回 `PluginDataEntry[]`：
- 跳过 `undefined` / 空数组 / 空对象（保 .fig 字节级零回归）
- 每个非空字段 emit 一条 `{ pluginId: OPEN_PENCIL_PLUGIN_ID, key: 'lowcode/<field>', value: JSON.stringify(...) }`

**Read 端**（`kiwi/node-change/convert.ts` 第 ~484 行 `pluginData: extractPluginData(nc)` 旁边）：

```ts
const { pluginData, lowcode } = extractPluginDataAndLowcode(nc)
return {
  // … 其它字段
  pluginData,                  // 已剥离 lowcode/* 条目
  ...lowcode,                  // { state?, bindings?, events?, interactiveProps? }
  // …
}
```

`extractPluginDataAndLowcode(nc)`：
- 遍历 `nc.pluginData ?? []`：命中 `pluginId === OPEN_PENCIL_PLUGIN_ID && key.startsWith('lowcode/')` 的条目 → 解 JSON 进对应字段；剩下原样回填 pluginData
- JSON.parse 异常 → 字段保持 `undefined` + `console.warn`，不抛错
- key 不在白名单（未来加字段）→ 原样保留在 pluginData 里给前向兼容

新增模块：`packages/core/src/kiwi/node-change/lowcode-plugin-data.ts`
- 导出常量：`LOWCODE_KEYS = ['lowcode/state','lowcode/bindings','lowcode/events','lowcode/interactiveProps']`
- 导出函数：`serializeLowcodeFields(node): PluginDataEntry[]` / `extractPluginDataAndLowcode(nc): { pluginData, lowcode }`

### 12.3 关键决定（已锁定）

> 与 §5 / §10.3 / §11.3 同形式。锁定后**不在对话中重新讨论**。

| # | 主题 | 决定 | 理由 |
|---|---|---|---|
| 1 | 持久化通道 | `pluginData` 条目，**不**改 Kiwi schema | `kiwi-schema/` 是 vendored；pluginData 是 Figma 官方逃生路径，基础设施（`upsertPluginData` / `OPEN_PENCIL_PLUGIN_ID`）已就位；schema 升级留 Phase 2+ 评估 |
| 2 | Key 命名 | `OPEN_PENCIL_PLUGIN_ID` + 字面 key `lowcode/state` / `lowcode/bindings` / `lowcode/events` / `lowcode/interactiveProps` | 命名空间清晰；新增 lowcode 字段只用加 key，不动 schema；查 .fig dump 时一眼能 grep 出来 |
| 3 | 编码 | `JSON.stringify` value，字符串存 pluginData | pluginData value 类型是 string；JSON 是已有 schema 的自然映射；StateDef / ActionDef / BindingExpr 都是纯数据可序列化 |
| 4 | 空值跳过 | 字段 `undefined` 或值为空（`[]` / `{}`）不 emit 条目 | 单页/无 state 的 .fig 字节级零回归；与 §11 的"单页 / 多页不增删"分支一致 |
| 5 | 错误恢复 | JSON.parse 失败 → 字段保持 `undefined` + `console.warn`；非 lowcode/* 的 OPEN_PENCIL_PLUGIN_ID 条目原样保留 | 一个字段坏不应让整文件加载失败；保留未知 key 给前向兼容 |
| 6 | 范围 | **仅** `.fig` codec round-trip；`.pen` JSON codec 本期不动 | 用户主要保存路径是 `.fig`；`.pen` 内部用于 CLI 互操作且自身已是 JSON，未来同步即可；最小化本期改动 |

### 12.4 不动什么

- `kiwi-schema/`（vendored，CLAUDE.md 明令禁动）
- `pluginData[]` 自身的 Kiwi 二进制 wire 格式（只 piggyback，不重写）
- `boundVariables` / `pluginRelaunchData`（正交，不混淆 lowcode 通道）
- `.pen` codec（待 Phase 2 同步；当前 `.pen` 也不写 lowcode 字段，行为与本期前一致）
- 编辑器 UI（`StatePanel.vue` / `EventsPanel.vue` / `TextBindingPanel.vue`）（已经写对地方了，只是 codec 这段断）
- 编译器（compiler 读 `node.state` 就行；load 端把字段填回去后链路自然通）

### 12.5 成功标准

仅针对 §12。当所有项均通过即可宣告 Phase 1 §12 完成：

1. `bun test ./tests/engine/kiwi/` + `bun test ./tests/engine/compiler/` 全绿；新增 `tests/engine/kiwi/lowcode-plugin-data.test.ts`（pure 序列化 helper）+ `tests/engine/kiwi/lowcode-roundtrip.test.ts`（真 `.fig` 端到端 export → parse round-trip）。
2. `bun run check` 全绿。
3. **不含 lowcode 字段**的旧 `.fig` 文件加载与本期前**字节级一致**（pluginData 不增条目；新增字段全 `undefined`）—— 在测试里用既有 fixtures 验证。
4. Tauri 实测（**用户主导**）：在画布定义 page state、绑 BUTTON onClick、保存 `.fig` → 关闭编辑器 → 重新打开 → state / event / interactiveProps 全部还在；preview iframe 仍能跑 +1 计数。
5. 合并 §11 + §12 端到端（**用户主导**）：编辑多页文档、每页配 state、保存 `.fig`、CLI `bun open-pencil compile` → 编出来的 `src/pages/<slug>.tsx` 含 `useState` hook、`onClick` handler；`bun run dev` 浏览器里点击交互按预期工作。

### 12.6 测试策略

**单元测试 1** — `tests/engine/kiwi/lowcode-plugin-data.test.ts`（纯函数）：

| 用例 | 期望 |
|---|---|
| `serializeLowcodeFields` 无字段 | `[]` |
| `serializeLowcodeFields` 仅 `state=[{id,name,type,defaultValue}]` | 1 条目，key=`lowcode/state`，value 是 JSON |
| `serializeLowcodeFields` 4 字段都有 | 4 条目，顺序稳定 |
| `serializeLowcodeFields` `state=[]` / `bindings={}` / `events={}` / `interactiveProps={}` | `[]`（跳过空） |
| `extractPluginDataAndLowcode` 含 1 条 `lowcode/state` | lowcode.state 填回；pluginData 不含此条 |
| `extractPluginDataAndLowcode` 含 JSON 损坏的 `lowcode/state` | lowcode.state 仍 `undefined`；pluginData 不含此条；`console.warn` |
| `extractPluginDataAndLowcode` 含 `lowcode/futureField`（未来 key） | lowcode 不动；pluginData **保留**这条原样 |
| `extractPluginDataAndLowcode` 含非 lowcode/* 的 OPEN_PENCIL_PLUGIN_ID 条目（如 `textDirection`） | 保留在 pluginData |

**单元测试 2** — `tests/engine/kiwi/lowcode-roundtrip.test.ts`（真 .fig 二进制 round-trip）：

| 用例 | 期望 |
|---|---|
| 一个 page 含 state，export → parse | 还原后 page.state 与原值深等 |
| BUTTON 含 `interactiveProps: { text: 'Hi' }` + `events.onClick`，round-trip | 全部还原 |
| 一个 TEXT 含 `bindings.text = { kind:'ref', stateId:'…' }`，round-trip | 还原后等值 |
| 没有 lowcode 字段的图（既有 fixture），round-trip | pluginData 字节级零增；4 字段均 `undefined` |

**集成测试（手动 / 用户主导）**：§12.5 #4 + #5。

### 12.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 既有 .fig 测试 fixture 含 OPEN_PENCIL_PLUGIN_ID 条目但 key 不是 lowcode/* | 低 | 决定 #5 保留未知 key 原样；既有条目（如 `textDirection`）走 read 路径不变 |
| StateDef.defaultValue 类型是 `unknown`，可能含函数 / Symbol / undefined | 中——JSON.stringify 静默丢函数/undefined | StateDef 是用户定义的纯数据；UI 已限制为 string/number/boolean/object/array；测试覆盖各 type；如果将来 UI 允许更复杂值再加 validator |
| 大型 page 的 state 数组让单条 pluginData value 变大 | 低 | pluginData value 类型是 string，无显式上限；Figma 自家用法也走这个通道；几 KB 完全 ok |
| Phase 2 引入 Kiwi schema 一等字段后，需要兼容期两个通道并存 | 低（未来） | 决定 #5 已为前向兼容铺垫：未知 key 保留；Phase 2 可让 schema 字段优先，pluginData 作 fallback |
| 写出顺序不稳定让两次保存产生不同字节 | 低——影响 git diff 友好度但不影响功能 | `serializeLowcodeFields` 按 `LOWCODE_KEYS` 固定顺序 emit |
| 编辑器内存里 state 在保存→重载之间 mutation 没触发 sceneVersion bump | 中——但与本期解耦 | 本期只补 codec 持久化；编辑器侧 mutation 信号是另一条链，已由 `updateNodeWithUndo` 处理 |

### 12.8 工作分解（建议 1 名工程师，1.5–2 天）

| 天 / Step | 任务 | 验收 / commit message |
|---|---|---|
| A（已完成） | doc §12 写完，决定锁定，§1.1 / §1.2 / §7.5 / §9 同步 | 本节存在；用户在对话里 ACK 锁定决定 |
| B（step 1） | `lowcode-plugin-data.ts` 新增 `serializeLowcodeFields`；`export-node.ts` 接 write 端；纯函数单测（§12.6 测试 1 前半） | `bun test ./tests/engine/kiwi/` 全绿；`bun run check` 全绿；commit `feat(lowcode): step 1 — lowcode fields → pluginData on save` |
| C（step 2） | `extractPluginDataAndLowcode` 实现；`convert.ts` 接 read 端；纯函数单测（§12.6 测试 1 后半）+ 真 .fig round-trip 单测（§12.6 测试 2） | `bun test ./tests/engine/kiwi/` + `./tests/engine/compiler/` 全绿；`bun run check` 全绿；commit `feat(lowcode): step 2 — pluginData → lowcode fields on load` |
| D（step 3） | 合并 §11 + §12 Tauri / CLI 实测（用户主导）；修联调 bug；写 changelog | 用户在对话里 ACK §11.5 #3–#5 + §12.5 #4–#5 全过 |
