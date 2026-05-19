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
| 1 | **Canvas-direct 子节点的绝对定位** | 锁定，本 doc §2 详述 |

> §1 是 Phase 1 唯一已承诺交付项。其余候选见 §7，需要排期时再写入 1.1。

### 1.2 Phase 1 Out-of-Scope（明确推迟）

- 多页面路由（react-router-v6）—— 候选 §7.1
- `@vitejs/plugin-react` Fast Refresh —— 候选 §7.2
- 实时表达式校验 UI —— 候选 §7.3
- `ActionDef.kind` 收窄 + 扩 `navigate` / `setVariable` —— 候选 §7.4
- `pluginData` → Kiwi schema 正式化 —— 候选 §7.5（Phase 0 收尾任务，落地窗口与 Phase 1 重叠）
- `layoutMode: 'FREE'` schema 字段（任意层级混合 free + auto-layout）—— 留给 Phase 2+

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

React adapter 当前只编 `pageIds[0]`。本项启用 `react-router-v6`（Phase 0 §8 决定 #2 已批准 Phase 1 启用），编出多 `App.tsx` + `<Routes>` 入口。

### 7.2 `@vitejs/plugin-react` Fast Refresh

`packages/compiler/src/dev-server.ts` 当前每次 compile 都广播 `full-reload`。Fast Refresh 让 iframe 内 `useState` 跨编辑保持——表单 / 计数器调试体验质变。

### 7.3 实时表达式校验 UI

`packages/compiler/src/ir/expression.ts` 的 `action-invalid-expression` / `state-invalid` 警告目前只在 console。把它们 surface 到 StatePanel / BindingInput 的 inline error。

### 7.4 `ActionDef.kind` 收窄 + 扩 `navigate` / `setVariable`

当前是字面 `'setState'`。收窄成判别联合后再扩枚举；compiler 端要把 Phase 0 删掉的"unsupported kind"分支加回来。

### 7.5 `pluginData` → Kiwi schema 正式化

`docs/lowcode-phase-0.md` §2.5 标记的 Phase 0 收尾。把 state / bindings / events / interactiveProps 从 `pluginData` 的临时存储升级为 Kiwi 一等字段。

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
2. 实施 §2 改动，按 §4 工作分解推进，commit 命名 `feat(lowcode): absolute positioning for canvas-direct children (Phase 1 §1)`。
3. 完成 §1.3 全部 6 项成功标准后，更新 memory `lowcode-phase-0-next` → `lowcode-phase-1-progress`，把 §7 候选按用户优先级回填到 §1.1。
4. Phase 1 §1 落地后，与用户决定 §7 候选的下一个调度——不要替用户决定。
