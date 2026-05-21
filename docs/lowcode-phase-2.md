# Phase 2 — Lowcode Platform on OpenPencil

> 紧接 `docs/lowcode-phase-1.md`。Phase 1 在 HEAD `07c15ba`(branch
> `lowcode-phase-0`)收官,所有 5 项主条目交付:§1 canvas-direct 绝对定位、§7.3
> inline 表达式校验 UI、§7.4 ActionDef 判别联合 + navigate / setVariable、§10
> Fast Refresh + VFS HMR、§11 多页编译 + react-router-dom、§12 lowcode 字段
> `.fig` 持久化。本 doc 是 Phase 2 的 source of truth。**目前所有候选未锁定,以下
> 列出范围预期 + 优先级建议,实际开工前每条候选单独锁决定并扩写本 doc。**

---

## 1. 范围

### 1.1 Phase 2 In-Scope(待逐条承诺)

| # | 主题 | 优先级 | 简述 | 详写 |
|---|---|---|---|---|
| 1 | **`setVariable` 运行时存储**(候选 §2) | 高 | §7.4 留了占位 stub;Phase 2 给编译产物补一个最小运行时变量 store,把 `setVariable` 从警告变成能跑 | TBD §2 |
| 2 | **数据 fetch / API 调用**(候选 §3) | 高 | Bubble 能力对位的基本要件;扩展 `ActionDef` 加 `apiCall` 或类似 kind | TBD §3 |
| 3 | **表达式子语言扩展**(候选 §4) | 中 | 加函数调用、数组 / 对象字面量;字符串模板留 §5+;触及 `expression.ts` 语法表 + emit | TBD §4 |
| 4 | **lowcode 字段升格为 Kiwi schema**(候选 §5) | 中 | §12 用的是 pluginData 通道;Phase 2 评估是否值得 fork `kiwi-schema/`(vendored)拿一等字段位 | TBD §5 |
| 5 | **`layoutMode: 'FREE'` schema 字段**(候选 §6) | 低 | 任意层级混合 free + auto-layout;§1 收尾时锁定的"只在 CANVAS → 直接子项一层"放宽 | TBD §6 |
| 6 | **多页 preview iframe 联动**(候选 §7) | 低 | §11 决定 #5 锁定 preview 仍传 `[currentPageId]` 单页切片;Phase 2 评估是否给 preview 也上 router | TBD §7 |
| 7 | **更多交互组件**(候选 §8) | 中 | 当前 6 个(BUTTON/INPUT/CHECKBOX/FORM/LIST/SELECT)覆盖 80% 表单场景;补 RADIO/TEXTAREA/DATEPICKER/SWITCH | TBD §8 |
| 8 | **条件渲染 / 列表渲染**(候选 §9) | 高 | 当前不能在画布上表达 "if / for";至少需要 IR 层加 `IRConditional` / `IRList` + 编辑器 UI 暴露 | **§9 ✅ 2026-05-21**(HEAD `c1cd202`) |

> §2 / §8 / §9 是产品层面影响最大的候选,§4 / §5 是工程债务清理。开工前每条都要回到本 doc 写 §X 详述,锁决定。

### 1.2 Phase 2 Out-of-Scope(明确推迟到 Phase 3+)

- **数据库 / Supabase 接入** —— 需要服务器端,跟 §3 的 API fetch 不同;Phase 0 §1 明确推到 Phase 2,但深度集成留 Phase 3
- **工作流编排** —— 多步 ActionDef 链 + 条件分支 + 异步等待
- **用户系统 / 鉴权** —— 跟 Supabase 一起
- **部署管线** —— 一键发布到 Vercel / Netlify / 自有 server
- **响应式断点 / 容器查询** —— Phase 3+
- **自定义组件 / Symbol 跨页复用** —— Phase 0 决定 #6 推迟,Phase 2 暂不动
- **i18n 实运行时** —— 编辑器侧的 i18n 已有,编译产物的 i18n 留到 Phase 3

### 1.3 Phase 2 整体成功标准(粗框,逐 § 细化)

整 Phase 2 需要满足:

1. 本 doc §1.1 中所有承诺的子项各自 §X.5 成功标准全过。
2. 不破坏 Phase 0 / Phase 1 任一 §X.3 / §X.5 锁定的成功标准 —— 旧 demo / 旧 .fig 行为不变。
3. `bun run check` 全绿。
4. `bun test ./tests/engine/compiler/` + `bun test ./tests/engine/kiwi/lowcode/` + `bun test ./tests/engine/render/jsx/` 全绿。
5. 每个承诺子项都有 Tauri 用户实测(用户主导,不自己宣告通过)。

---

## 2. §2 详细设计:Document State 运行时

> 2026-05-22 用户在对话中挑定 Phase 2 第二项开工。形式参照 §9 / `lowcode-phase-1.md` §11 / §12。**全部 6 项主决定 2026-05-22 已由用户在对话中锁定,10 项次级决定一次性 ACK 入锁**。
>
> **状态:🚧 开工中**(HEAD `2c5cd14`)。Step 1–5 分日 commit,跟 §9 同节奏。

### 2.1 现状与问题

- `SetVariableAction`(`packages/core/src/scene-graph/types.ts:486`)在 Phase 1 §7.4 落了判别联合 slot(`targetName` + `valueExpr`),编辑器 EventsPanel 也给了 input UI,但 compiler `bindings.ts:152` 永远 `warn + drop`。用户在 EventsPanel 看到 "not yet emitted — compiles to a warning" 的 amber stub。
- `BindingExpr` 只有 `'literal' | 'ref' | 'expr'` 三种 kind,**没有**绑全局变量的路径。
- `StateDef[]` 只能挂 CANVAS(页面)/ BUTTON / FORM / TEXT 等 4 个 NodeType 上,且语义是**页面级 `useState`**;Bubble 风格的"跨页全局 K-V"无法表达。
- OpenPencil 现有 `Variable` / `VariableCollection`(`types.ts:405-429`)是 **Figma-style 设计 token**(`COLOR / FLOAT / STRING / BOOLEAN`,多 mode,绑节点属性,编译时常量替换),且已进 vendored Kiwi schema、有 MCP tool、有 Vue 组件 ABI —— 跟 Bubble 风格的运行时变量是**完全两个东西**,不能复用类型。

**调试场景(期望)**:

```
SceneGraph (root "Document"):
  lowcodeDocumentState: [
    { name: 'username',  type: 'string',  defaultValue: 'guest' },
    { name: 'cartCount', type: 'number',  defaultValue: 0 },
    { name: 'isLoggedIn', type: 'boolean', defaultValue: false }
  ]

  CANVAS Home
    BUTTON  events.onClick = [{
      kind: 'setVariable', targetName: 'cartCount', valueExpr: '$prev + 1'
    }]
    TEXT    bindings.text = { kind: 'docState', docStateName: 'cartCount' }
  CANVAS About
    TEXT    bindings.text = { kind: 'docState', docStateName: 'cartCount' }

期望 emit (multi-page,简化):

  // src/_lowcode_state.ts (auto-generated)
  import { createStore } from 'zustand/vanilla'
  import { useStore } from 'zustand'
  type DocState = { username: string; cartCount: number; isLoggedIn: boolean }
  const store = createStore<DocState>(() => ({
    username: 'guest', cartCount: 0, isLoggedIn: false
  }))
  export function useDocState<K extends keyof DocState>(name: K): DocState[K] {
    return useStore(store, (s) => s[name])
  }
  export function setDocState<K extends keyof DocState>(
    name: K, value: DocState[K] | ((prev: DocState[K]) => DocState[K])
  ): void {
    store.setState((s) =>
      ({ [name]: typeof value === 'function' ? (value as Function)(s[name]) : value }) as Partial<DocState>
    )
  }
  export function getDocStateSnapshot<K extends keyof DocState>(name: K): DocState[K] {
    return store.getState()[name]
  }

  // src/pages/Home.tsx (片段)
  import { useDocState, setDocState } from '../_lowcode_state'
  ...
  const cartCount = useDocState('cartCount')
  ...
  <button onClick={() => setDocState('cartCount', (prev) => prev + 1)}>...</button>
  <p>{cartCount}</p>
```

### 2.2 关键决定

> 形式同 §9.2。**#1–#6 已锁;#a–#j 为次级默认,step 1 前用户 ACK 视为已锁。**

| # | 主题 | 决定 | 理由 | 状态 |
|---|---|---|---|---|
| 1 | Store 实现 | **zustand 底层 + 自写封装层** —— compiler emit 出 `_lowcode_state.ts`,内部用 `zustand/vanilla` `createStore`,对外只暴露 `useDocState` / `setDocState` / `getDocStateSnapshot` 三个 API。zustand 加在**编译产物**的 `package.json`,**不**加到 `packages/compiler` 自身 deps | 自写 mini-store 要重新踩 React 18 concurrent / batching 边界;zustand 已被千万项目验证。封装层让用户 emit 代码只接触低代码语义符号,zustand 是实现细节,Phase 3+ 想加 `persist` 直接接 `zustand/middleware/persist`。compiler 自身保持框架无关 | **🔒 已锁** |
| 2 | 变量粒度 | **仅文档级**。页面级 state 走 §7.4 已有 setState,不重复造 | setVariable 走文档级才与 setState 语义不重复(否则冗余);跨页共享必须文档级 | **🔒 已锁** |
| 3 | 跨页持久化 | **仅内存**。运行时 store 只活在 preview iframe 里,iframe 刷新 = 回到 defaultValue。不写 localStorage / sessionStorage | Phase 2 §2 范围最小;不打开 JSON 序列化 / type fence / quota / schema 变更的门。Phase 3+ 再加 `persist` flag | **🔒 已锁** |
| 4 | bindings 读 docState 的接口 | **新增** `BindingExpr.kind: 'docState'`,字段 `docStateName: string`。kind 集合扩为 `'literal' \| 'ref' \| 'expr' \| 'docState'` | 与 state ref(`kind:'ref'`)彻底分轨,不复用 `stateId` 字段避免 ID 冲突;`expr` 加 var 引用留 §4 一并(本期不动 expression.ts 标识符解析) | **🔒 已锁** |
| 5 | 命名 / 边界严分 | 现有 Figma `Variable` / `VariableCollection` **不动**。新概念类型名 **`DocumentStateDef`**;编辑器中文术语 **"Document State / 全局状态"**;schema 字段 `SceneNode.lowcodeDocumentState?: DocumentStateDef[]`(仅 root 节点有意义);pluginData key `lowcode/documentState`;BindingExpr 新 kind 字面值 `'docState'`(不是 `'var'`);emit 文件路径 `src/_lowcode_state.ts`。`SetVariableAction.kind: 'setVariable'` 字面值因 §7.4 锁定保留,编辑器 UI dropdown 显示标签为 "Set Document State",emit 出来的运行时调用是 `setDocState(...)` | Figma Variable 已有完整 schema + Kiwi codec + MCP tool + UI,复用必撞;`SetVariableAction.kind` 撤换会破坏旧 .fig 兼容(prompt.md 明令)。两套并存、内部叫法严分 | **🔒 已锁** |
| 6 | 回调式 set | valueExpr 子语言 reserve identifier **`$prev`**。检测 `$prev` 出现 → emit functional updater(`setDocState('name', (prev) => prev + 1)`/ `setCount((prev) => prev + 1)`);不含 → 维持绝对赋值。**setState + setVariable 两条路径同步生效**(避免心智不一致) | 防连续 set 读后写竞态;跟 React `setState` 心智一致;不加 schema 字段(零迁移成本);用户用 `$prev + 1` 即走回调,无需 UI toggle。这是 emit 路径扩展,**不**撤销 §7.4 锁定(§7.4 锁的是 union 形状,没锁 valueExpr 必须绝对赋值) | **🔒 已锁** |

**次级默认(step 1 前用户 ACK 视为已锁)**:

| # | 主题 | 默认 |
|---|---|---|
| a | DocumentStateDef 持久化通道 | 走 §12 同款 pluginData 通道。新增 key `LOWCODE_DOCUMENT_STATE_KEY = 'lowcode/documentState'`,JSON 编码,挂在 **root 节点**(`graph.rootId`)的 pluginData 上。**不**动 vendored `kiwi-schema/` |
| b | DocumentStateDef shape | `type DocumentStateDef = StateDef`(类型别名,字段完全同形:`{ id, name, type: StateValueType, defaultValue, description? }`)。理由:语义同源,复用 StateDef 的编辑器组件 / 校验 / 默认值逻辑 |
| c | 编辑器入口位置 | 在 `DesignPanel.vue` "no node selected" 分支里、`StatePanel` 与 `VariablesSection` 之间,**新增** `<DocumentStatePanel />`。`StatePanel` 当前在该分支也出现,但作用于**当前页面**;`DocumentStatePanel` 作用于整个文档,UI 形态高度复用 `StatePanel`(jscpd 0 clones → 抽 composable) |
| d | emit 产物路径 | vfs 路径 `src/_lowcode_state.ts`(跟 §11 router shell 同款下划线前缀,标识 generated)。仅当文档有 ≥1 个 DocumentStateDef 时生成 |
| e | 运行时 store 不进 .fig | 运行时 Map 只活在 preview iframe;`DocumentStateDef` 声明走 pluginData(同 a);**不**碰 `.fig` 二进制 |
| f | setVariable action emit 形态 | `bindings.ts:152` 的 warn → `setDocState('name', <expr>)`;含 `$prev` → `setDocState('name', (prev) => <expr where $prev → prev>)`。`<expr>` 用 §7.3 受限子语言,内部标识符引用按上下文解析(setState 的 onClick 表达式可引用页面 state + `$prev`;setVariable 可引用页面 state + 当前 docState 是否可读 → 见 #h) |
| g | bindings.expr 里读 docState | Phase 2 §2 范围内**不**给 expression 加 docState 标识符解析。要读 docState 走 `kind: 'docState'` binding 一条路 —— `expr` + docState 引用留 §4 一并 |
| h | setVariable.valueExpr 不识别 docState | 跟 setState 同口径(避免 docState→docState 循环依赖)。仅识别:页面 state + literal + `$prev`(当前 target 的"上一值") |
| i | 校验 | `targetName`(setVariable action)/ `docStateName`(binding)必须解析到一个 `DocumentStateDef`,否则 IR warning(`action-setvariable-unknown-target` / `binding-docstate-unknown-name`)+ 编辑器 amber 角标(复用 §7.3 inline 校验 UI)。`$prev` 仅在 set* action valueExpr 合法,binding.expr 出现 → IR warning(`expression-prev-out-of-context`) |
| j | zustand 依赖加在哪里 | **仅编译产物** package.json(emit 时 `dependencies.zustand` 注入,版本 pin 跟 React 一致),preview esbuild prebundle 一次。**不**加到 `packages/compiler/package.json` |

> 锁定后**不在对话中重新讨论**;若用户后续推翻视为显式 scope change,更新本节。

### 2.3 公开 API / Schema 改动

**SceneGraph types(`packages/core/src/scene-graph/types.ts`)**:

```ts
/** Phase 2 §2: document-level "Document State" variable declarations,
 *  distinct from Figma-style Variable / VariableCollection (which are
 *  design tokens with multi-mode). Document State is Bubble-style
 *  runtime K-V — writable via SetVariableAction, read via
 *  BindingExpr.kind:'docState'. Same shape as page-level StateDef. */
export type DocumentStateDef = StateDef

export interface SceneNode {
  // ...existing fields
  state?: StateDef[]              // page-/component-scoped
  bindings?: Record<string, BindingExpr>
  events?: Partial<Record<EventName, ActionDef[]>>
  interactiveProps?: Record<string, unknown>
  renderCondition?: string
  /** Phase 2 §2: only the root node (graph.rootId) populates this. */
  lowcodeDocumentState?: DocumentStateDef[]
}

export interface BindingExpr {
  kind: 'literal' | 'ref' | 'expr' | 'docState'   // ← Phase 2 §2 adds 'docState'
  stateId?: string
  literalValue?: unknown
  expr?: string
  /** Phase 2 §2: when kind='docState', resolves to a DocumentStateDef by name. */
  docStateName?: string
}
```

> `SetVariableAction`(types.ts:486)字段不动 —— `kind: 'setVariable'` / `targetName` / `valueExpr` 仍是原样,改的是它在 `bindings.ts` 里的语义(从 warn 改成 emit 真实 handler)和编辑器 UI 标签("Set Variable" → "Set Document State")。

**pluginData(`packages/core/src/kiwi/node-change/lowcode-plugin-data.ts`)**:

```ts
/** Phase 2 §2: document-level state declarations, attached to the root node only. */
export const LOWCODE_DOCUMENT_STATE_KEY = 'lowcode/documentState'

// serializeLowcodeFields 新增:
if (isNonEmpty(node.lowcodeDocumentState)) {
  entries.push(makeEntry(LOWCODE_DOCUMENT_STATE_KEY, node.lowcodeDocumentState))
}

// assignLowcodeField 新增 case:
case LOWCODE_DOCUMENT_STATE_KEY:
  target.lowcodeDocumentState = value as DocumentStateDef[]
  return
```

**expression sub-language(`packages/compiler/src/ir/expression.ts`)**:

- IDENT_RE 由 `/^[A-Za-z_][A-Za-z0-9_]*/` 扩为 `/^[A-Za-z_$][A-Za-z0-9_$]*/`(allow `$` in identifiers,跟 JS 同款)
- `parseExpression` / `emitExpression` 行为不变 —— `$prev` 仅作为合法 identifier 通过,`references` 集合里会包含 `'$prev'`
- 新增导出函数:`hasPrevReference(ast: ExprAst): boolean` 和 `substitutePrev(ast: ExprAst, replacement: string): ExprAst` —— functional updater emit 路径用

**IR collect(`packages/compiler/src/ir/collect/`)**:

- `bindings.ts:152` 的 `case 'setVariable'` warn 改为真实 handler `resolveSetVariable(...)`:
  - 解析 `valueExpr` AST
  - 校验 `targetName` 必须在 `graph.rootNode.lowcodeDocumentState` 里
  - 校验表达式 references:页面 state ids + `$prev` 合法,docState 名 / 未声明 ident 报 warning
  - 检测 `$prev` → 标记 `IRSetVariable { mode: 'functional', innerExpr: <expr with $prev as prev> }`,否则 `mode: 'absolute'`
- `resolveSetState`(同文件)同步加 `$prev` 检测 + functional 标记 → `IRSetState { mode: 'absolute' | 'functional' }`
- `BindingExpr.kind: 'docState'` 在 `collect/bindings.ts` / binding 解析处加 case,生成 `IRDocStateRef { name: string }` 之类的 IR(具体 IR 类型名见 step 2 实现 PR)
- 任何 `binding.expr` collect 路径检测到 references 含 `'$prev'` → warning `expression-prev-out-of-context`

**IR types(`packages/compiler/src/ir/types.ts`)**:

```ts
// IREventHandler 已是 union;扩展 setVariable / 增强 setState:
export interface IRSetStateHandler {
  kind: 'setState'
  stateName: string
  innerExpr: string
  mode: 'absolute' | 'functional'   // ← Phase 2 §2 新增 mode
}

export interface IRSetVariableHandler {
  kind: 'setVariable'
  docStateName: string
  innerExpr: string
  mode: 'absolute' | 'functional'
}

// Binding IR:扩展 docState 一支(具体 union 形状以现有 collect/bindings.ts 输出为准)
```

**emit react(`packages/compiler/src/adapters/react/`)**:

- 新增 scaffold file gen:`scaffoldLowcodeState(stateDefs: DocumentStateDef[]) => { path: 'src/_lowcode_state.ts', source: string }`。仅当 `stateDefs.length > 0` 时调用
- emit 产物 `package.json` 在有 docState 时注入 `dependencies.zustand`(版本跟随当前 React 版本兼容范围 —— 见 step 3 选定)
- 每个 page module 在引用 docState 时自动 import `useDocState` / `setDocState` from `'../_lowcode_state'`(类似 §11 router shell import 同 pattern)
- `emit/handlers.ts`(或同位)给 `IRSetStateHandler` / `IRSetVariableHandler` 加 `mode` 分支:`absolute` emit `setX('name', <expr>)`;`functional` emit `setX('name', (prev) => <expr>)`(setState 的 `name` 形参就是 stateName setter,签名匹配)

**编辑器 UI**:

- 新建 `src/components/properties/Lowcode/DocumentStatePanel.vue`,UI 高度复用 `StatePanel.vue`(抽 composable `useStateRowEditor` 把行级编辑、JSON parse 校验、命名校验等逻辑共享 → jscpd 0 clones)。挂在 `DesignPanel.vue` no-node-selected 分支中 `<PageSection />` 与 `<StatePanel />` 之后、`<VariablesSection />` 之前
- `EventsPanel.vue` 第 146-148 行 setVariable amber stub 去掉,改为正常输入:
  - target 是 docState 名下拉(只列 `graph.rootNode.lowcodeDocumentState`,空时显示 "no document state")
  - valueExpr 同 setState 的输入框 + §7.3 inline 校验(`$prev` 是合法 token)
  - dropdown 显示标签:`'setState' / 'navigate' / 'Set Document State'`(setVariable 显示成 "Set Document State")
- `TextBindingPanel.vue`(或 binding 选择器所在文件)选 `kind: 'docState'` 时显示 docState 名下拉
- `$prev` 快速按钮:setState / setVariable input 右侧加 "插入 $prev" chip(可选,Step 4 收尾再加,不阻塞)
- i18n 新 key:`panels.lowcodeDocumentState*` 系列 + `panels.lowcodeActionSetDocument*`

### 2.4 不动什么

- **kiwi schema**(vendored)—— DocumentStateDef 走 pluginData,不 fork
- **Figma `Variable` / `VariableCollection` / `VariableBinding` / `VariablesDialog.vue`** —— 不动,跟 docState 严分两轨
- `validateExpression`(`packages/compiler/src/ir/validate.ts`)—— 复用,只增加 `$prev` 合法上下文判定
- `useState` emit / `IRStateDecl` —— 不动;docState 走独立 emit 路径
- `App.tsx` / router shell(§11)—— 不动;`_lowcode_state.ts` 是模块单例,无 Provider
- `SetVariableAction.kind` 字面值 `'setVariable'` —— 不动(§7.4 锁 + 老 .fig 兼容)
- `OPEN_PENCIL_PLUGIN_ID` —— 不动
- `EventsPanel.vue` 的 `ACTION_KINDS` 数组(`['setState', 'navigate', 'setVariable']`)字面值不动,只改显示标签

### 2.5 成功标准

仅针对 §2。所有项通过即可宣告 Phase 2 §2 完成:

1. `bun test ./tests/engine/compiler/` 全绿;新增至少:
   - `ir/collect/set-variable.test.ts` —— targetName 解析 / 未声明 docState warning / `$prev` functional 标记 / valueExpr 不识别 docState
   - `ir/collect/set-state-prev.test.ts` —— setState 也支持 `$prev`;不含 `$prev` 保持 absolute 形态
   - `ir/collect/binding-docstate.test.ts` —— `kind:'docState'` 合法 / 未声明 docStateName warning / binding.expr 用 `$prev` warning
   - `ir/expression-prev.test.ts` —— `$prev` 作为合法 identifier 通过 parse;`hasPrevReference` / `substitutePrev` 工作
   - `adapters/react/emit-document-state.test.ts` —— `_lowcode_state.ts` scaffold 内容正确;有/无 docState 时 package.json `dependencies.zustand` 注入/不注入
   - `adapters/react/emit-set-variable.test.ts` —— absolute / functional 两种 emit 形态
   - `adapters/react/emit-set-state-prev.test.ts` —— setState functional emit 形态

2. `bun test ./tests/engine/kiwi/lowcode/` 全绿;新增至少:
   - `document-state-pluginData.test.ts` —— root 节点 `lowcodeDocumentState` 来回 .fig;旧 .fig(无字段)字节级回归
   - `bindings-docstate-kind.test.ts` —— `bindings.text = { kind:'docState', docStateName:'x' }` 来回

3. `bun run check` 全绿(oxlint、tsgo、vue-tsc、i18n、steiger、jscpd 0 clones)

4. **Tauri 实测(用户主导,§9 同节奏)**:
   - "no node selected" 时 DocumentStatePanel 出现在 PageSection 下方;添加 username/cartCount/isLoggedIn 三个 docState
   - BUTTON onClick setVariable target dropdown 列出三个 docState 名;valueExpr 输入 `$prev + 1` 不报红
   - TEXT bindings.text 切到 `kind:'docState'`,选 cartCount;画布上 TEXT 显示 0
   - preview iframe 里点 BUTTON;cartCount TEXT 实时变 1 / 2 / 3
   - 跨页(Home → About)切换,About 页面同样有 TEXT 绑 cartCount,值保持不变(跨页共享)
   - 保存 .fig → reopen → docState 声明 / binding / action 全部还在
   - iframe 刷新(reload)→ cartCount 复位到 0(确认无持久化)

5. 不破坏 Phase 0 §8 / Phase 1 §1 §5 §7.3 §7.4 §10.3 §11.3 §12.3 / Phase 2 §9.2 任一锁定决定 —— 旧 demo / 旧 .fig 行为完全不变

### 2.6 测试策略

**单元测试(`tests/engine/compiler/`)**:

- `ir/expression-prev.test.ts`
  | 用例 | 期望 |
  |---|---|
  | `parseExpression('$prev')` | ok=true;references=Set(['$prev']) |
  | `parseExpression('$prev + 1')` | ok=true;references=Set(['$prev']) |
  | `parseExpression('$prev * 2 - count')` | ok=true;references=Set(['$prev', 'count']) |
  | `hasPrevReference(ast)` 在含 `$prev` 时 true,不含时 false | |
  | `substitutePrev(ast, 'prev')` 把 ident 节点 `'$prev'` 替成 `'prev'`,emit 出 `prev + 1` 等 | |

- `ir/collect/set-variable.test.ts`
  | 用例 | 期望 |
  |---|---|
  | targetName 在 docState 里 + valueExpr=`5` | IRSetVariableHandler { mode:'absolute', innerExpr:'5' } |
  | targetName 在 docState 里 + valueExpr=`$prev + 1` | IRSetVariableHandler { mode:'functional', innerExpr:'prev + 1' } |
  | targetName 不在 docState 里 | warning `action-setvariable-unknown-target`;handler 丢 |
  | valueExpr 引用未声明 ident `foo` | warning `expression-unknown-identifier` |
  | valueExpr 引用另一个 docState 名 | warning `expression-unknown-identifier`(决定 #h:setVariable.valueExpr 不识别 docState) |

- `ir/collect/set-state-prev.test.ts`
  | 用例 | 期望 |
  |---|---|
  | 现有 setState 不含 `$prev` | IRSetStateHandler { mode:'absolute' } (兼容现有行为) |
  | setState valueExpr=`$prev + 1` | IRSetStateHandler { mode:'functional', innerExpr:'prev + 1' } |
  | setState valueExpr=`$prev * 2 + count` | functional;innerExpr:`prev * 2 + count`;references 包含 count |

- `ir/collect/binding-docstate.test.ts`
  | 用例 | 期望 |
  |---|---|
  | bindings.text = { kind:'docState', docStateName:'username' } + docState 已声明 | IR 含 docState 引用;无 warning |
  | docStateName 未声明 | warning `binding-docstate-unknown-name` |
  | bindings.text = { kind:'expr', expr:'$prev' } | warning `expression-prev-out-of-context` |
  | bindings.text = { kind:'expr', expr:'count + $prev' } | warning(同上) |

- `adapters/react/emit-document-state.test.ts`
  | 用例 | 期望 |
  |---|---|
  | 文档有 3 个 docState | 产生 `src/_lowcode_state.ts`,内容包含 `import { createStore } from 'zustand/vanilla'`、三个字段初值;package.json `dependencies.zustand` 注入 |
  | 文档 0 个 docState | 不产生 `_lowcode_state.ts`;package.json 不注入 zustand |

- `adapters/react/emit-set-variable.test.ts` / `emit-set-state-prev.test.ts`
  | 用例 | 期望 emit 含 |
  |---|---|
  | setVariable absolute | `setDocState('cartCount', 5)` |
  | setVariable functional | `setDocState('cartCount', (prev) => prev + 1)` |
  | setState absolute(回归) | `setCartCount(5)` |
  | setState functional | `setCartCount((prev) => prev + 1)` |

**Kiwi 持久化(`tests/engine/kiwi/lowcode/`)**:

- `document-state-pluginData.test.ts` —— root 节点加 `lowcodeDocumentState: [...]` → save .fig → reload → 字段还在 + JSON 编码正确;旧 .fig(无字段)字节级回归
- `bindings-docstate-kind.test.ts` —— bindings.text = { kind:'docState', docStateName:'x' } → 来回

**集成测试(用户主导)**:§2.5 #4。

### 2.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| `BindingExpr.kind` 加 `'docState'` 后旧 .fig 解析撞 union 收窄 | 中 | kind 是 string union;读路径 switch 默认走 unknown-kind warning 而非崩溃;**Phase 1 §12 实测过的 .fig 做 fixture 字节回归** |
| zustand 加在编译产物会影响 preview esbuild prebundle 时间 | 低 | zustand ~1KB gzipped + zero transitive deps;esbuild prebundle 一次后缓存;Tauri 实测在 5 个 docState 规模下肉眼无感 |
| `$prev` widen IDENT_RE 后老 .fig 里 valueExpr 含 `$` 字符(虽然原本不合法但 tokenize 已拒)突然合法 | 低 | 现状 tokenize 见 `$` 直接 `unexpected character '$'`;改后 `$` 起首会进 ident 通道,旧 .fig 没有合法 `$ident` → 不会有 false negative;`$` 在 String 字面量内不受影响 |
| `$prev` 在嵌套 set 里(setState + 别处 setVariable 同 handler)上下文歧义 | 低 | `$prev` 在 valueExpr **解析时**就携带"当前 set target"上下文 —— setState 的 `$prev` = 当前 stateName 上一值,setVariable 的 `$prev` = 当前 docStateName 上一值;两条 handler 之间不共享 `$prev`(它是 emit 时的 closure 形参) |
| 跨页 docState 共享但 `_lowcode_state.ts` 在 multi-page compile 下能否正确单例 | 中 | zustand vanilla `createStore` 是模块顶层;esm 模块单例语义 → 两个 page module `import`,同一个 store 实例 |
| 文档级 state 名命名空间跟页面 state 名重叠时,binding 解析歧义 | 中 | `kind:'ref'` 解析 page state(stateId);`kind:'docState'` 解析 docState(docStateName)。**两种 kind 完全不复用字段** → ID 冲突零风险。但 valueExpr 里裸 ident 解析:页面 state 名优先;裸 ident 撞 docState 名时 IR warning(`expression-shadow-docstate-name`)提醒用户改名 |
| Phase 2 §9 加的 walker(collectClassNames / nodeHasNavigate / stripNode)对 IRSetVariable 漏 case | **中—§9 经验 A** | step 5 走 §9.9 同款 walker checklist;**任何**新 handler kind / IR kind 扩展都 grep 全文 `.kind ===` / `case '`,verify 每个 walker 显式 descend |
| `_lowcode_state.ts` 路径跟用户某 page 命名冲突 | 极低 | `_` 前缀 + Phase 2 §2 锁定路径;§11 router shell 同款约定,无报错 |
| jscpd 0 clones —— DocumentStatePanel.vue 跟 StatePanel.vue 行级编辑逻辑高度重复 | 中 | step 4 抽 composable `useStateRowEditor` 共享;两边都消费同一个 composable;jscpd 通过 |
| 用户 valueExpr 写 `$prev = 5` 之类的赋值 | 极低 | expression 子语言**没有**赋值运算符(没有 `=`);tokenize 见 `=` 在等号上下文只识 `==` / `===` / `<=` / `>=` / `!=` / `!==`,单等号直接 `unexpected character` |

### 2.8 工作分解(建议 1 名工程师,3–5 天)

| 天 / Step | 任务 | 验收 / commit message |
|---|---|---|
| A | 本节(§2)写完,主决定 #1–#6 + 次级 #a–#j 用户 ACK | 本节存在;memory `lowcode-phase-2-progress` 更新 |
| B(step 1) | `DocumentStateDef` 类型 + `SceneNode.lowcodeDocumentState` + `BindingExpr.kind:'docState'` + `docStateName` 字段;pluginData 通道扩 `LOWCODE_DOCUMENT_STATE_KEY`;expression.ts IDENT_RE 扩 `$` + `hasPrevReference` / `substitutePrev`;kiwi 持久化测试 + expression 单测 | `bun test ./tests/engine/kiwi/lowcode/` + `bun test ./tests/engine/compiler/ir/expression*` 全绿;`bun run check` 全绿;commit `feat(lowcode): step 1 — document state schema + bindings.docState + $prev (§2)` |
| C(step 2) | `bindings.ts:152` 改为真实 `resolveSetVariable`;`resolveSetState` 加 `$prev` 检测 → `mode:'absolute'\|'functional'` 分支;binding collect 加 `kind:'docState'` case;`expression-prev-out-of-context` warning 在 binding.expr 路径生效;IR collect 单测 | `bun test ./tests/engine/compiler/` 全绿;`bun run check` 全绿;commit `feat(lowcode): step 2 — IRSetVariable + docState collect + $prev (§2)` |
| D(step 3) | `scaffoldLowcodeState`(emit `_lowcode_state.ts`);编译产物 package.json 注入 zustand;每个 page module 自动 import `useDocState` / `setDocState`;emit handlers `absolute` / `functional` 两种形态;emit 单测 | `bun test ./tests/engine/compiler/` 全绿;`bun run check` 全绿;commit `feat(lowcode): step 3 — emit lowcode document state runtime (§2)` |
| E(step 4) | `DocumentStatePanel.vue` 新建 + `useStateRowEditor` composable 抽出(StatePanel 同步消费,jscpd 通过);`EventsPanel.vue` setVariable amber stub 改为完整 UI + dropdown 标签 "Set Document State";`TextBindingPanel.vue` binding 选择器加 docState 选项;i18n key 同步;(可选)`$prev` 插入 chip | `bun run check:vue` + `bun run check:i18n` + `bun run test:dupes` 全绿;commit `feat(lowcode): step 4 — document state editor UI (§2)` |
| F(step 5) | §9.9 walker checklist 跑一遍(grep 全文 `.kind ===` / `case '`,verify IRSetVariable / `kind:'docState'` 不漏);跨路径 `$prev` 回归测试;Tauri 实测 §2.5 #4(用户主导);修发现的 bug | 用户 ACK 全过;changelog + commit `docs(lowcode): §2 Tauri verification` |

> 每个 step commit 前跑 `bun test ./tests/engine/compiler/` + `bun test ./tests/engine/kiwi/lowcode/` + `bun run check`,**不要**跑整个 `./tests/engine/`(15+ 分钟,LFS 慢测 + `kiwi/serialize-fixes/line/height.test.ts:44` pre-existing 失败跟本工作无关)。

### 2.9 Post-mortem

(留空待 Tauri 实测后补)

---

## 3. 候选 §3 — 数据 fetch / API 调用

**当前**: ActionDef 只能 setState / navigate;不能"按钮点了 → 调 API → 拿到数据 → 写到 state"。

**Phase 2 目标**: 加 `ApiCallAction`(或类似 kind),编译时 emit `fetch()` + 回写 state。

**待锁决定**:
- URL / method / body 怎么在 ActionDef 里表达?静态 URL 还是支持 `${ }` 模板?
- 鉴权头:从哪里读 token?跟 §2 store 联动?
- 响应类型 / 错误处理:用 fetch + try/catch 还是引入 `@tanstack/react-query`?
- 加载状态:是否给 ActionDef 加自动 `loading` / `error` 状态写回?

**风险**: 一旦加 fetch,跨域 / CORS / 网络重试是用户层面的麻烦点;Phase 2 锁最小范围(只发请求 + 写一个 state),其它推 Phase 3。

---

## 4. 候选 §4 — 表达式子语言扩展

**当前**(`packages/compiler/src/ir/expression.ts`):
- 算术 / 比较 / 逻辑 / 三元 / 一元 / 成员访问
- **没有**函数调用、数组字面量、对象字面量、字符串模板

**Phase 2 目标**: 加 `expr(args)` / `[a, b, c]` / `{ k: v }` 三件;字符串模板留 §5+。

**待锁决定**:
- 函数调用允许什么前缀?`Math.*` / `String.*` 等内置允许,用户自定义函数怎么走?
- 数组 / 对象字面量是否允许嵌套 spread?(`{...obj, x: 1}` 影响 emit 复杂度)
- AST + emit 的回滚兼容性:旧 .fig 里的表达式必须依然 parse

**风险**: 解析器从 precedence climbing 改成更复杂的 LR;测试用例量级会涨;为了换"能用"不一定值。先做"用户最实际诉求是什么"调研再开工。

---

## 5. 候选 §5 — lowcode 字段升格为 Kiwi schema

**当前**: §12 用 pluginData 通道,JSON 编码进 string。read/write OK,但:
- 字段在工具里看不见(Figma 客户端打开 .fig 不识别)
- 序列化体积大(JSON 字符串重)
- 类型校验在 read 时才发生

**Phase 2 目标**: 评估是否值得 fork `kiwi-schema/`(vendored),把 `state` / `bindings` / `events` / `interactiveProps` / `lowcode/nodeType` 升格为 schema 一等字段。

**待锁决定**:
- 是否真要 fork?Phase 1 §12.3 决定 #1 的理由(`kiwi-schema/` vendored,不动)还成立吗?
- 兼容期策略:同时支持 schema 字段 + pluginData 通道?如果用户 .fig 同时有两者怎么 reconcile?
- 迁移路径:写一个 one-shot migration tool,把老 .fig 的 pluginData 移到 schema 字段?

**风险**: fork 后想吸收上游(Figma 自己更新 schema)成本高;若上游不更新这条留着也无所谓。建议:**先不开工,Phase 2 末期评估**。

---

## 6. 候选 §6 — `layoutMode: 'FREE'`

**当前**: §1 只在 "CANVAS → 直接子项"一层做绝对定位。深层嵌套(FRAME 里再放一个 free-position 的子)用不了。

**Phase 2 目标**: 加 `layoutMode: 'FREE'` schema 字段,任意 FRAME 可以切到 free 模式。

**待锁决定**:
- schema 字段位置:现有 `layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL'`,加 `'FREE'`?
- Properties 面板 UI:在哪里出"FREE"开关?
- 嵌套规则:FREE 容器里的 auto-layout 容器,sizing 怎么算?
- 跟 §1 联动:CANVAS 默认就是 FREE 吗?如果是,§1 的 `parentIsCanvas` 判断可以放宽成 `parentIsFreeLayout`

**风险**: 复杂度真不低;Bubble 也没有像样的混合 layout。**优先级低,Phase 2 末期再启动**。

---

## 7. 候选 §7 — 多页 preview iframe 联动

**当前**: 编辑器 preview pane 始终编 `[currentPageId]`,iframe 没 router URL,切页靠 sceneVersion 重新 compile。

**Phase 2 目标**: 评估是否给 preview iframe 上 router。

**待锁决定**:
- 体验是否真改善?切页本来就靠点编辑器侧的页面面板,不靠 URL
- 如果上 router,preview 一直在重 compile 整套多页项目,性能 / debounce 怎么调?
- 跟 Tauri 桥(`__preview-bridge`)的 selection 信号怎么处理?多页切换会丢 selection 上下文吗?

**风险**: 大概率不值得。**优先级低,等用户主动要求再开工**。

---

## 8. 候选 §8 — 更多交互组件

**当前**: BUTTON / INPUT / CHECKBOX / FORM / LIST / SELECT(6 个)。

**Phase 2 目标**: 加 RADIO / TEXTAREA / DATEPICKER / SWITCH(4 个,或视用户实际诉求)。

**待锁决定**:
- 每加一个组件:`NODE_TYPES` + `node-defaults.ts` 加默认 interactiveProps + `nodeTypeToJSX` 加映射 + compiler emit
- DATEPICKER 涉及第三方库,引入 dependency 慎重
- canvas-side 的占位卡片(画布上不真渲染交互组件,只画占位)样式定义

**风险**: 没什么风险,纯加法;每个组件 0.5–1 天工作量。**适合作为 Phase 2 早期热身**。

---

## 9. §9 详细设计:条件渲染 / 列表渲染

> 本节是 Phase 2 第一个开工 § —— 2026-05-21 用户在对话里挑定,**同日交付 + Tauri 用户实测通过**。形式参照 `lowcode-phase-1.md` §11 / §12。**全部 10 项决定 2026-05-21 已由用户在对话中锁定**(主决定 #1–#3 第一轮 ACK,次级决定 #4–#10 第二轮一次性 ACK)。
>
> **状态:🔒 已收尾**(HEAD `c1cd202`)。5 个 step 全 ✅。实测期间额外抓了 6 个相关 bug,见 §9.9 post-mortem。

### 9.1 现状与问题

当前 IR / SceneGraph 不能表达两种最基础的动态结构:

- **条件渲染** —— 不能说"`isLoggedIn` 为真才渲染这个 BUTTON"。所有可见节点(`visible === true`)都无条件出现在 JSX 树里。
- **列表渲染** —— 不能说"对 `users` 数组的每一项渲染一份这个 FRAME"。`LIST` 节点(`packages/core/src/scene-graph/types.ts:80`)与 `interactiveProps.dataSourceRef: null`(`node-defaults.ts:224`)从 Phase 0 起就预留了字段,但 `ir/collect/tree.ts` 既没有读 `dataSourceRef`,也没有把 LIST 视作迭代节点 —— LIST 当前 emit 出来就是个 `<div>` + 静态子节点。

后果:用户只能编 staticly-shaped 页面。**Bubble 用户实际诉求里频次排第二(仅次于 API)** —— "用户列表 / 商品列表 / 评论列表"全做不出来;"登录后显示 X、否则显示 Y"全做不出来。

**调试场景(期望):**

```
SceneGraph (page Home):
  state: users: array = [{name:'Alice',age:30},{name:'Bob',age:25}]
  state: isLoggedIn: boolean = false

  FRAME (renderCondition = 'isLoggedIn')
  └─ TEXT  "Welcome back"

  LIST (interactiveProps.dataSourceRef = { kind:'stateRef', stateId: <users.id> })
  └─ FRAME (item template)
     └─ TEXT (bindings.text = { kind:'expr', expr:'item.name' })

期望 emit (单页 Home.tsx,简化):
  {isLoggedIn && (
    <div className="...">
      <p className="...">Welcome back</p>
    </div>
  )}
  {users.map((item, index) => (
    <div key={index} className="...">
      <p className="...">{item.name}</p>
    </div>
  ))}
```

### 9.2 关键决定

> 形式同 `lowcode-phase-1.md` §11.3 / §12.3。**#1 / #2 / #3 已锁;#4–#10 为建议默认,step 1 前用户 ACK 后视为已锁。**

| # | 主题 | 决定 | 理由 | 状态 |
|---|---|---|---|---|
| 1 | 条件信号的存放位置 | 新增可选 schema 字段 `renderCondition?: string`(表达式字符串)在 `SceneNode` 上。任何节点皆可挂条件。走 §12 pluginData 通道持久化(key = `lowcode/renderCondition`,JSON 编码),不动 kiwi schema | 跟 `state` / `bindings` / `events` / `interactiveProps` 一致;不污染 `BindingExpr` 语义(它表示"值从哪来",条件是"渲不渲");任何 NodeType 都能挂,不锁在容器 | **🔒 已锁** |
| 2 | 列表数据源粒度 | `LIST.interactiveProps.dataSourceRef: { kind: 'stateRef', stateId: string } \| null`;指向的 StateDef.type **必须**为 `'array'`,否则 IR 层 warning + 退化为空 LIST | 最小切入面;UI 是下拉选 state;表达式数据源(`users.filter(...)`)留 §9.v2,等 §4 表达式扩展(`.filter` / `.map`)落地 | **🔒 已锁** |
| 3 | LIST 子树里的 `item.<field>` 引用 | `BindingExpr` 加 `kind: 'expr'` 变体(`{ kind: 'expr', expr: string }`),`expr` 复用 §7.3 表达式子语言(已支持 `member access`)。collect 走 LIST 子树时往 ctx 加 `inScope = [itemName, indexName]`,expression 引用这两个标识符不报"unknown identifier" | 同时给"TEXT 绑 state 表达式"打开大门(过去只能 ref 整个 state,现在能写 `count + 1`);member access 已有 AST 支持,emit 几乎免费;collect 加 inScope 单点小改动 | **🔒 已锁** |
| 4 | LIST 的 item / index 标识符 | `LIST.interactiveProps.itemName: string`(默认 `'item'`)、`indexName: string`(默认 `'index'`)。两者都需通过 `validateStateName` 合法性校验 | 用户可命名(`user` / `product` 等),编辑器面板里出两个 input;默认值兼容简单场景 | **🔒 已锁** |
| 5 | LIST 的 key 表达式 | Phase 2 §9 emit `key={index}`,不暴露用户配置入口。`keyExpr` 字段不进 schema —— 留 §9.v2 | React 警告免;`key={index}` 在列表项不重排时无问题(Phase 2 §9 不做拖排);加 key 选择 UI 一次到位会膨胀面板 | **🔒 已锁** |
| 6 | LIST 的模板 | LIST 节点的**第一个可见子节点**作为 item 模板;其余可见子节点 IR 层 warning + 丢弃 | 隐式插槽语义直观;一个 LIST 一个模板符合 v-for / `.map()` 心智;多模板需要 if/else 组合,留 §9.v2 | **🔒 已锁** |
| 7 | LIST 数据源缺失 / 类型不符的处理 | `dataSourceRef === null` → IR 层 warning `list-no-datasource`,emit 空数组 `[]` (不出 `.map`);`stateRef` 指向的 state 不是 `type='array'` → warning `list-bad-datasource-type`,同上 | 编辑器里能看到红字提示,emit 不抛异常,运行时不崩 | **🔒 已锁** |
| 8 | 条件指向不存在 / 不合法 state | 表达式解析失败 → warning `condition-invalid-expression`,**保留**节点(等价 `true`),让用户能看到节点继续修;表达式合法但引用未声明 identifier → warning `condition-unknown-identifier`,同上保留 | 跟 §7.3 的"表达式 inline 错误不阻断编辑器"心智一致;实测过程中用户能看到节点继续在画布上 | **🔒 已锁** |
| 9 | emit 形态 | 条件:`{(<cond>) && <node/>}`(三元仅当条件本身已经是 ternary 才用 ternary 避免嵌套混乱)。列表:`{(<arr>).map((item, index) => <template key={index}>)}`。条件 + 列表都有的 LIST:`{(<cond>) && (<arr>).map(...)}` | `&&` 比 ternary 短、惯用;空状态 UI 留 §9.v2 | **🔒 已锁** |
| 10 | UI 暴露 | **新建** `src/components/properties/Lowcode/RenderConditionPanel.vue` —— 任意选中节点可用,单 input + §7.3 inline 错误样式(red border + 10px error line)。**新建** `src/components/properties/Lowcode/ListPanel.vue` —— 仅 NodeType=LIST 时显示,含 state 下拉(只列 type='array' 的)、itemName / indexName 两个 input、模板提示文字 | 与 EventsPanel / StatePanel 同形式;`<style>` 不允许(Steiger 规则);i18n key 全走 `packages/vue/src/i18n/messages.ts` | **🔒 已锁** |

> 锁定后**不在对话中重新讨论**;若用户后续想推翻视为显式 scope change 并更新本节。

### 9.3 公开 API / Schema 改动

**SceneGraph types(`packages/core/src/scene-graph/types.ts`):**

```ts
export interface SceneNode {
  // ...existing fields
  state?: StateDef[]
  bindings?: Record<string, BindingExpr>
  events?: Partial<Record<EventName, ActionDef[]>>
  interactiveProps?: Record<string, unknown>
  /** Phase 2 §9: optional render-condition expression. Evaluated at runtime;
   *  falsy → node + subtree omitted from JSX. Expression sub-language is
   *  §7.3's (validated via validateExpression). */
  renderCondition?: string
}

export interface BindingExpr {
  kind: 'literal' | 'ref' | 'expr'   // ← Phase 2 §9 adds 'expr'
  stateId?: string
  literalValue?: unknown
  /** Phase 2 §9: when kind='expr', this is the source-language expression
   *  string. Validated at edit-time, parsed at IR-collect-time. */
  expr?: string
}
```

**LIST `interactiveProps` shape(documented contract, no schema type change):**

```ts
type ListInteractiveProps = {
  dataSourceRef: { kind: 'stateRef'; stateId: string } | null
  itemName: string           // default 'item'
  indexName: string          // default 'index'
}
```

**IR types(`packages/compiler/src/ir/types.ts`):**

```ts
export type IRNode = IRElement | IRText | IRExpression | IRConditional | IRList  // ← 新增 2 种

export interface IRConditional {
  kind: 'conditional'
  /** Pre-parsed AST for the condition expression. */
  ast: ExprAst
  /** Identifiers the condition references (subset of in-scope state vars + list-item identifiers). */
  references: string[]
  /** The subtree to render when the condition is truthy. */
  consequent: IRNode
}

export interface IRList {
  kind: 'list'
  /** Variable name of the array state being iterated. */
  arrayName: string
  /** Local identifier for the item in the template scope. */
  itemName: string
  /** Local identifier for the loop index in the template scope. */
  indexName: string
  /** The IR for the first visible child — rendered once per array item. */
  template: IRNode
}
```

**IR collect 改动:**

- `ir/collect/tree.ts` — `nodeToIR` 末尾若 `node.renderCondition` 存在,解析表达式 + 校验 references,生成 `IRConditional { consequent: <原本的 IRElement> }` 包外。
- `ir/collect/tree.ts` — 遇到 NodeType=LIST,读 `interactiveProps.dataSourceRef` / `itemName` / `indexName`,解析 state,递归子节点时把 ctx 加 `inScope: Set<string>`(itemName + indexName),只对**第一个**可见子节点 collect 出 IR 作为 `template`,其余 children warning + 丢弃。
- `ir/collect/bindings.ts` —— `resolveTextBinding` 处理新的 `kind: 'expr'` 路径:`parseExpression(binding.expr)` → 返回 `IRExpression { ast, references }`;references 校验时 inScope 标识符放行(不当 unknown state)。

**Adapter 改动(`packages/compiler/src/adapters/react/emit/`):**

- `emit/node.ts`(或 `walk.ts`,看现有命名) —— 对 IRConditional / IRList 加 case;IRConditional emit `{(<expr>) && (<consequent>)}`;IRList emit `{(<arrayName>).map((<itemName>, <indexName>) => (<template>))}`(template 自动加 `key={<indexName>}`)。
- 表达式 emit 复用现有 `emit/expression.ts`,member access 已支持。

### 9.4 不动什么

- **kiwi schema**(vendored)—— `renderCondition` 跟 §12 一样走 pluginData;不 fork。
- `validateExpression`(`packages/compiler/src/ir/validate.ts`)—— 不改,直接复用。
- React adapter 已有的 single-page / multi-page 分发逻辑(§11);条件 / 列表是节点级 IR,跟路由层正交。
- `IRStateDecl` / `useState` emit —— 不动;`item` / `index` 是 `.map` 回调的形参,不进 `useState`。
- `EventsPanel.vue` / `StatePanel.vue` / `TextBindingPanel.vue` —— 不动;`RenderConditionPanel.vue` / `ListPanel.vue` 作为新组件注册到 properties 面板入口。

### 9.5 成功标准

仅针对 §9。当所有项均通过即可宣告 Phase 2 §9 完成:

1. `bun test ./tests/engine/compiler/` 全绿;新增至少:
   - `ir/collect/conditional.test.ts` —— 条件包裹 / 无条件保持 / 不合法表达式 warning + 保留
   - `ir/collect/list.test.ts` —— stateRef 合法 / 数据源缺失 warning / 数据源类型非 array warning / 多 children warning + 只取第一个 / inScope item.field 解析
   - `adapters/react/emit-conditional.test.ts` —— `&&` 形态正确;嵌套条件
   - `adapters/react/emit-list.test.ts` —— `.map` 形态正确;`item.name` 在子 TEXT 里 emit;条件 + 列表组合 emit
2. `bun test ./tests/engine/kiwi/lowcode/` 全绿;新增至少:
   - `renderCondition` pluginData 来回(写 .fig → 读 → 字符串保留)
   - 旧 .fig(无 `renderCondition` / 无新 LIST interactiveProps)字节级回归
3. `bun run check` 全绿(oxlint、tsgo、vue-tsc、i18n、steiger、jscpd 0 clones)。
4. Tauri 实测(**用户主导**):
   - 编辑器选中任意节点 → RenderConditionPanel 出现 → 输入 `count > 0` → 实时 inline error 行为同 §7.3
   - 编辑器选中 LIST → ListPanel 出现 → state 下拉只列 array 类型 → 选 + 填 itemName / indexName
   - LIST 子树里 TEXT 的 bindings.text 选 `kind: 'expr'`,填 `item.name` 不报"unknown identifier"
   - 保存 → reopen .fig → 上面三件全部还在
   - CLI 多页 compile → 浏览器渲列表 + 条件;切 state 后列表 / 条件实时变(配合 §10 Fast Refresh)
5. 不破坏 Phase 0 §8 / Phase 1 §1 §5 / §10.3 / §11.3 / §12.3 / §7.3 / §7.4 任一锁定决定 —— 旧 demo / 旧 .fig 行为完全不变。

### 9.6 测试策略

**单元测试(`tests/engine/compiler/`):**

- `ir/collect/conditional.test.ts`
  | 用例 | 期望 |
  |---|---|
  | 节点带 `renderCondition: 'flag'`,state flag 存在 | IRConditional 包裹 IRElement;references=['flag'] |
  | 节点带 `renderCondition: 'count > 0'` | IRConditional;ast.kind='binary' |
  | 节点带 `renderCondition: ''` | 无 IRConditional 包裹(空字符串视为无条件) |
  | 节点带 `renderCondition: 'foo bar'`(parse fail) | warning `condition-invalid-expression`;节点保留(无 Conditional 包) |
  | 节点带 `renderCondition: 'undeclared'` | warning `condition-unknown-identifier`;节点保留 |

- `ir/collect/list.test.ts`
  | 用例 | 期望 |
  |---|---|
  | LIST + dataSourceRef → 合法 array state + 1 child + itemName='item' | IRList { arrayName, itemName='item', indexName='index', template: IRElement } |
  | LIST + dataSourceRef=null | warning `list-no-datasource`;IRList 不生成(LIST 节点 emit 为空 `<div>` 或 skip) |
  | LIST + dataSourceRef 指向非 array state | warning `list-bad-datasource-type` |
  | LIST + 0 visible children | warning `list-no-template` |
  | LIST + 3 visible children | 只取第一个;warning `list-multiple-templates`(忽略 2/3) |
  | LIST 子节点 TEXT.bindings = { kind:'expr', expr:'item.name' } | IRExpression { ast: member-access, references=['item'] };不报 unknown identifier |
  | LIST 子节点 TEXT.bindings = { kind:'expr', expr:'undeclared' } | warning `expression-unknown-identifier` |

- `adapters/react/emit-conditional.test.ts`
  | 用例 | 期望 emit 含 |
  |---|---|
  | 简单条件 `flag` | `{(flag) && (` ... `)}` |
  | 二元 `count > 0` | `{(count > 0) && (` ... `)}` |
  | 条件嵌套条件(父节点 + 子节点都有 renderCondition) | 两层 `&&` 嵌套 |

- `adapters/react/emit-list.test.ts`
  | 用例 | 期望 emit 含 |
  |---|---|
  | 基础 LIST | `{(users).map((item, index) => (<div key={index} ...>{item.name}</div>))}` |
  | LIST + 条件 | `{(flag) && (users).map(...)}` |
  | 列表项里子节点也有条件 | `<div key={index}>{(item.active) && (<p>{item.name}</p>)}</div>` |
  | 自定义 itemName / indexName(`user` / `i`) | `(users).map((user, i) => ... user.name ... key={i})` |

**Kiwi 持久化(`tests/engine/kiwi/lowcode/`):**

- `render-condition-pluginData.test.ts` —— SceneGraph 加 `renderCondition: 'count > 0'` → save .fig → reload → 字段还在;旧 .fig(无字段)字节级回归
- `list-interactive-props.test.ts` —— LIST.interactiveProps 含 `dataSourceRef` / `itemName` / `indexName` → 来回;旧 LIST(只有 `dataSourceRef: null`)字节级回归
- `bindings-expr-kind.test.ts` —— bindings.text = { kind:'expr', expr:'item.name' } → 来回

**集成测试(手动 / 用户主导):**§9.5 #4。

### 9.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| `bindings.text` 加 `kind: 'expr'` 后,老 .fig 里只有 `kind: 'literal' / 'ref'` 的条目读出来要兼容 | 中 | `kind` 字段是 union,读路径 switch 加 case 之后旧 case 不动;collect 入口先判 kind 再走分支;**测试用 Phase 1 §12 实测过的 .fig 做 fixture 校验字节回归** |
| LIST 子树里 expression 的 inScope 标识符泄漏到 LIST 外面(比如父级 TEXT 引用 `item.name`)| 中——影响心智模型 | inScope 是 collect ctx 的栈式字段;进 LIST 子树 push,出 LIST pop;父级 collect 时栈为空 → 父级表达式引用 `item` 报 unknown identifier;单测覆盖 |
| `renderCondition` 为空字符串 vs 不存在的区分 | 低 | 决定 #8 明示:空字符串 = 无条件;`undefined` = 无条件;两者等价 |
| 用户用 `index` 当 itemName / indexName 重名 | 低 | step 1 加 `validateStateName` 校验 + UI inline error;两个相同也是 error |
| 用户在 LIST 模板里用 setState onClick,handler 闭包里要不要看到 item / index | 中——产品决策 | Phase 2 §9 不支持;ActionDef 表达式里引用 `item` / `index` 当 unknown identifier 处理(action 表达式不在 inScope 里);留 §9.v2 评估"item-aware actions";单测覆盖这条 |
| 性能:大列表(>1000 items)+ Fast Refresh 是否还跟得上 | 低——非 Phase 2 目标 | 用户层面问题,Phase 2 §9 不优化;Tauri 实测用 5–10 个元素的小 demo 就够 |
| `key={index}` 在排序场景下导致 React diff 出错 | 低 —— Phase 2 §9 没有列表排序 UI | 决定 #5 明示 v1 锁 `key={index}`;v2 再开 keyExpr |
| jscpd 0 clones 跟 EventsPanel / StatePanel 类似结构容易撞 | 中 | step 3 写 UI 时复用 `useInlineError` / `useStateOptions` 等 composables;面板 markup 不复制粘贴 |

### 9.8 工作分解(建议 1 名工程师,3–5 天)

| 天 / Step | 任务 | 验收 / commit message |
|---|---|---|
| A | doc §9 写完,主决定 #1 #2 #3 锁定,次级 #4–#10 用户 ACK 后入锁定 | 本节存在;用户在对话里 ACK |
| B(step 1) | SceneNode 加 `renderCondition`,BindingExpr 加 `'expr'` kind;§12 pluginData 通道扩 `lowcode/renderCondition` + `lowcode/bindings` expr 兼容;旧 .fig 字节回归测试;kiwi 持久化测试 | `bun test ./tests/engine/kiwi/lowcode/` 全绿;`bun run check` 全绿;commit `feat(lowcode): step 1 — renderCondition schema + bindings.expr (§9)` |
| C(step 2) | IR 加 `IRConditional` / `IRList`;collect 加 inScope 栈 + LIST 模板提取;collect/conditional + collect/list 单测 | `bun test ./tests/engine/compiler/` 全绿;`bun run check` 全绿;commit `feat(lowcode): step 2 — IRConditional / IRList collect (§9)` |
| D(step 3) | React adapter emit IRConditional / IRList;`.map` + `&&` 语法;emit 单测 | `bun test ./tests/engine/compiler/` 全绿;`bun run check` 全绿;commit `feat(lowcode): step 3 — emit conditional / list (§9)` |
| E(step 4) | `RenderConditionPanel.vue` / `ListPanel.vue` 新建;properties 入口注册;§7.3 inline error UX;i18n key 同步 | `bun run check:vue` + `bun run check:i18n` 全绿;commit `feat(lowcode): step 4 — RenderCondition + List property panels (§9)` |
| F(step 5) | Tauri 实测 §9.5 #4(用户主导);修发现的 bug;changelog | 用户 ACK 全过;commit `docs(lowcode): §9 Tauri verification` |

> 每个 step commit 前跑 `bun test ./tests/engine/compiler/` + `bun test ./tests/engine/kiwi/lowcode/` + `bun run check`,**不要**跑整个 `./tests/engine/`(15+ 分钟,含 LFS 慢测,且 `kiwi/serialize-fixes/line/height.test.ts:44` pre-existing 失败跟本工作无关)。

### 9.9 Post-mortem(2026-05-21 实测发现 + 修复)

5 个 step 自动化全绿后,Tauri 实测过程中**用户主导**地抓出 6 个相关 bug —— 没一个被自动化测试盖到,因此每个都补了回归测试 + 单独 commit。模式分两类:

**A. "Walker 漏 case"类** —— Phase 2 §9 把 `IRNode` widen 加了 `IRConditional` / `IRList` 两个 kind,但若干个早写好的递归 walker 都 `if (node.kind !== 'element') return` 早返。需要每个 walker 显式 descend 进 `consequent` / `template`。

| Commit | 漏 case 的 walker | 症状 |
|---|---|---|
| `a62f9af` | `collectClassNames` (adapter/react/index.ts) | 条件 / 列表里子树的 Tailwind class 进不了 `@source inline(...)` 安全列表;iframe CSS 缺失,元素错位 |
| `c1cd202` | `nodeHasNavigate` + `stripNode` (adapter/react/ir-walk.ts) | 条件 / 列表里的 navigate handler 对 scaffold 不可见 → 没 `useNavigate` 导入 → 运行时 `navigate is not defined` |

**经验**:**任何 IR 节点 kind 的扩展都要全文 grep 一遍 `node.kind`,确保每个 walker 都补上分支**。未来 §9.v2 / §3 / §4 加新 IR kind 时同样的 checklist 适用。

**B. UX / 配置债**:

| Commit | 问题 |
|---|---|
| `a62f9af` | `StatePanel.vue` TYPES 数组硬写三种 primitive,`array` / `object` 进不了 UI |
| `64f7900` | array / object 默认值 JSON.parse 失败时静默 fallback 到 `[]`(掩盖 JS 字面量 vs JSON 字面量混淆) |
| `f8b768a` | Tauri 2.x 默认 `dragDropEnabled: true` → OS handler 吃掉 webview 的 dragstart → 整个 Layers 拖拽链路死亡 |
| `fcc8ec6` | atlaskit hitbox mode 只看 `hasChildren`,空容器无法接 make-child |
| `1511ab0` | atlaskit `expanded` mode 无 reorder-below 区,末位容器无法被绕过 |

**经验**:
- Tauri 任何带前端 HTML5 drag-and-drop 的项目,`tauri.conf.json` 里的 `dragDropEnabled: false` 是默认配置,不是可选项。
- atlaskit `pragmatic-drag-and-drop-hitbox/tree-item` 模式选择要按"是否容器 + 是否末位"二维矩阵决定,不是按 `hasChildren` 单维。
- 任何接 JSON 字面量的输入都必须 surface parse error,不能 swallow + fallback 到默认值。

---

## 10. 与 Phase 3+ 的边界

明确**不属于** Phase 2,避免本 doc scope 漂移:

- **数据库 / Supabase 深度集成** —— Phase 3
- **工作流编排** —— Phase 3
- **用户系统 / 鉴权** —— Phase 3
- **部署管线** —— Phase 4
- **响应式断点** —— Phase 3+
- **i18n 运行时** —— Phase 3
- **协作 / 多人编辑** —— Phase 4+(已有 Trystero + Yjs 底座,但 lowcode 字段的协作语义没设计)

---

## 11. 下一步

1. 用户主导挑 Phase 2 第一个开工候选(按 §1.1 表里的优先级建议:§9 条件/列表渲染 / §2 setVariable 运行时 / §3 API fetch 三选一)。
2. 选定后回本 doc 把对应 §X 改写成"详细设计 + 锁定决定"格式(参考 `lowcode-phase-1.md` §2 / §11 / §12 的结构)。
3. 实施 + 测试 + Tauri 实测(用户主导)。
4. 收尾后回到 §11 挑下一项。
5. 每收一个 §X commit + 更新 memory `lowcode-phase-1-progress` → 创建 `lowcode-phase-2-progress`。

> 不在用户明确批准前推进任何 §X 详细设计或代码。本 doc 当前只是 Phase 2 的 **roadmap**,不是开工合同。
