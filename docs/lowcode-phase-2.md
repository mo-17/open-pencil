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
| 2 | **数据 fetch / API 调用**(候选 §3) | 高 | Bubble 能力对位的基本要件;扩展 `ActionDef` 加 `apiCall` 或类似 kind | **§3 ✅ 2026-05-22**(HEAD `df5e1b4`) |
| 3 | **表达式子语言扩展**(候选 §4) | 中 | 窄口径:`${}` 字符串插值(URL 模板)+ docState 可在读上下文表达式引用 —— 接 §3 留的尾;函数调用 / 数组 / 对象字面量推迟 | **§4 ✅ 2026-05-23** |
| 4 | **lowcode 字段升格为 Kiwi schema**(候选 §5) | 中 | §12 用的是 pluginData 通道;Phase 2 评估是否值得 fork `kiwi-schema/`(vendored)拿一等字段位 | TBD §5 |
| 5 | **`layoutMode: 'FREE'` schema 字段**(候选 §6) | 低 | 任意层级混合 free + auto-layout;§1 收尾时锁定的"只在 CANVAS → 直接子项一层"放宽 | TBD §6 |
| 6 | **多页 preview iframe 联动**(候选 §7) | 低 | §11 决定 #5 锁定 preview 仍传 `[currentPageId]` 单页切片;Phase 2 评估是否给 preview 也上 router | TBD §7 |
| 7 | **更多交互组件**(候选 §8) | 中 | 补 RADIO/TEXTAREA/DATEPICKER/SWITCH 四个,全 emit 原生 HTML 零依赖;纯组件增量,不动属性面板 / EventsPanel | **§8 开工中**(详见 §8) |
| 8 | **条件渲染 / 列表渲染**(候选 §9) | 高 | 当前不能在画布上表达 "if / for";至少需要 IR 层加 `IRConditional` / `IRList` + 编辑器 UI 暴露 | **§9 ✅ 2026-05-21**(HEAD `c1cd202`) |

> 行 1(§2)已收尾:**§2 ✅ 2026-05-22**(HEAD `d3d1fd9`)。

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
> **状态:🔒 已收尾**(HEAD `d3d1fd9`)。Step 1–5 全 ✅,Tauri 实测 2026-05-22 用户 ACK 全过;实测期间抓 1 个 bug(preview 解析不到 zustand),见 §2.9 post-mortem。

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
| j | zustand 依赖加在哪里 | 编译产物 package.json 注入 `dependencies.zustand`(标准导出用);**且** `packages/compiler` devDependencies 也加 `zustand`(pin = `ZUSTAND_VERSION`)。**修订(2026-05-22 Tauri 实测)**:原决定"不加到 `packages/compiler/package.json`"错误 —— preview dev-server 从 monorepo hoisted `node_modules` 解析裸 import(同 `react` / `react-dom`),从不对 VFS 跑 `npm install`;不加则 `_lowcode_state.ts` 的 `zustand/vanilla` 解析失败,docState 页面 preview 白屏。见 commit `4f41917` |

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

**Step commits:**

| Step | Commit | 内容 |
|---|---|---|
| 1 | `f9734f2` | document state schema + bindings.docState + `$prev` |
| 2 | `5c25bd6` | IRSetVariable + docState collect + `$prev` |
| 3 | `8751a30` | emit lowcode document state runtime |
| 4 | `a5d5d6e` | document state editor UI(`useStateRowEditor` composable + `DocumentStatePanel.vue` + EventsPanel/TextBindingPanel) |
| 5 | `984391c` | cross-walker 回归测试(`cross-walker-docstate.test.ts`) |
| fix | `4f41917` | preview 解析不到 zustand → docState 页面白屏 |
| docs | `d3d1fd9` | 修订 §2.2 #j |

**Walker checklist(§9 经验 A)**:本期跑了一遍,**无 walker miss**。`emit/event.ts` switch 是穷举式(`never` 兜底自动报错);`collect/bindings.ts` `resolveActions` 有 `case 'setVariable'`、`resolveTextBinding` 有 `kind:'docState'` 分支;`adapters/react/ir-walk.ts` 只过滤 `navigate`,其余 handler 全保留;`IRTree` 拷贝点(`ir-walk.ts` 的 `{...ir}` spread)带过 `docStates` / `docStateReads` / `docStateWrites` 三字段。`cross-walker-docstate.test.ts` 钉死这条。§9 是 IRNode 加新 kind(walker 重灾区),§2 是加新 handler kind + 新 binding kind + 新 IRTree 字段 —— 后者风险低于前者(handler / binding switch 本来就穷举式),实测印证。

**实测抓到的 bug —— preview 解析不到 zustand(`4f41917`)**:

- **现象**:TEXT 绑字面值 preview 正常,绑 docState 时 preview iframe 白屏。
- **根因**:preview 单页编译,产物 `_lowcode_state.ts` `import 'zustand/vanilla'`;preview dev-server(`dev-server.ts`)从 **monorepo hoisted `node_modules`** 解析裸 import(同 `react` / `react-dom`),**从不**对 VFS 产物 `package.json` 跑 `npm install`。`zustand` 没装进 monorepo → 解析失败 → 模块崩 → 白屏。字面值页面无此 import,故不对称。
- **修复**:`zustand` 加进 `packages/compiler` devDependencies(理由同 `react` 在那里)。产物 package.json 仍注入 `dependencies.zustand`(标准导出用)。这推翻了次级决定 #j 里"不加到 `packages/compiler/package.json`"—— 已在 §2.2 #j 标注修订。
- **教训(新增一条,与 §9.9 经验 A/B/C 并列)**:**经验 D —— emit 产物的新裸 import,preview 能不能解析?** 任何让 emit 出来的代码 `import` 一个新 npm 包的改动(本期 zustand,未来 §3 可能引入 fetch 库 / `@tanstack/react-query`),都要同步把该包加进 `packages/compiler` devDependencies,否则 CLI / 单测路径(走 `compile()` 返回字符串,不解析)全绿、唯独 preview 白屏。单测层加一条"该包能从 monorepo resolve"的回归断言(见 `preview-zustand-resolvable.test.ts`)。

**测试结果**:`bun test ./tests/engine/compiler/` 208 pass、`./tests/engine/kiwi/lowcode/` 45 pass;`bun run check` 全绿(oxlint / tsgo / vue-tsc / i18n / steiger / jscpd 0 clones)。Tauri 实测 2026-05-22 §2.5 #4 七条用户 ACK 全过。

---

## 3. §3 详细设计:API fetch / 数据调用

> 2026-05-22 用户挑定 Phase 2 第三项开工(§2 收尾后)。形式参照 §2 / §9。**4 项主决定 2026-05-22 已由用户在对话中锁定**;次级默认 step 1 前用户 ACK 视为已锁。
>
> **状态:🔒 已收尾**(HEAD `df5e1b4`)。Step 1–4 全 ✅,Tauri 实测 2026-05-22 用户 ACK 全过;实测期间补了 1 个链路缺口(LIST 不能绑 docState),见 §3.8 post-mortem。

### 3.1 现状与问题

- `ActionDef`(§7.4 判别联合)只有 `setState` / `navigate` / `setVariable` 三种 kind。无法表达 Bubble 最基本的 "按钮点了 → 调 API → 响应写进状态"。
- §2 落地了 Document State 运行时(`useDocState` / `setDocState` + zustand store)。§3 的 API 响应正好有处可写 —— 复用 §2 store,不另造状态层。
- 当前 onClick handler emit 全是**同步** arrow(`() => { setX(); setY(); }`)。fetch 是异步,emit 路径要支持 `async () => { ... }`。

**调试场景(期望)**:

```
SceneGraph (root "Document"):
  lowcodeDocumentState: [{ name: 'users', type: 'array', defaultValue: [] }]

  CANVAS Home
    BUTTON  events.onClick = [{
      kind: 'apiCall',
      method: 'GET',
      url: 'https://jsonplaceholder.typicode.com/users',
      targetName: 'users'
    }]
    LIST    dataSource = users   (§9 列表渲染)

期望 emit (片段):

  const users = useDocState('users')
  ...
  <button onClick={async () => {
    try {
      const res = await fetch("https://jsonplaceholder.typicode.com/users")
      const data = await res.json()
      setDocState("users", data)
    } catch (err) {
      console.error("apiCall failed:", err)
    }
  }}>...</button>
```

### 3.2 关键决定

> 形式同 §2.2。**#1–#4 已锁(2026-05-22 对话);#a–#g 为次级默认,step 1 前用户 ACK 视为已锁。**

| # | 主题 | 决定 | 理由 | 状态 |
|---|---|---|---|---|
| 1 | 响应写回目标 | API 响应 JSON **写回一个 Document State**(§2)。`ApiCallAction.targetName` 指向 root `lowcodeDocumentState` 里的一个名字;emit `setDocState(name, data)` | 复用 §2 store —— 跨页可读、不再造第三套状态层;与 setVariable 同口径(都写 docState) | **🔒 已锁** |
| 2 | HTTP 库 | **原生 `fetch` + `try/catch`**,不引入 axios / `@tanstack/react-query`。§3.v2 上鉴权 + loading/error 时再换 axios(那时 interceptor 正好统一加 token) | 本期范围(GET/POST、静态 URL、JSON body、无鉴权、无 loading/error)fetch 完全够;零依赖 → 不触发经验 D、emit 产物不背运行时依赖。axios 的价值(interceptor / 重试 / 取消)对应被推迟的能力,本期引入只付成本 | **🔒 已锁** |
| 3 | 范围 | **GET + POST**;`url` 是**静态字符串**(不支持 `${}` 模板 —— 留 §4);POST `body` 是 **JSON 字面量字符串**(同 StatePanel array/object 默认值,parse + 校验);响应一律 `res.json()` | 最小可用面;`${}` 模板 / 表达式 body 触及 expression.ts 语法,与 §4 范畴重叠,本期不开门 | **🔒 已锁** |
| 4 | loading / error 自动状态 | **不**自动写回 `loading` / `error` 状态。只把成功响应写进 `targetName`;失败 `console.error` | 自动造 `<name>_loading` 之类是隐式状态 + schema 膨胀,IR/emit/UI 全要特判;留 §3.v2 跟鉴权一起做 | **🔒 已锁** |

**次级默认(step 1 前用户 ACK 视为已锁)**:

| # | 主题 | 默认 |
|---|---|---|
| a | 新 kind 字面值 | `ActionKind` 扩为 `'setState' \| 'navigate' \| 'setVariable' \| 'apiCall'`;`ApiCallAction.kind = 'apiCall'`。全新 kind,无老 .fig 兼容包袱;编辑器 dropdown 标签 "Call API" |
| b | 持久化 | `ApiCallAction` 走现有 `lowcode/events` pluginData 通道(events 负载 schema-free JSON,新 kind 自动序列化)。**不**新增 pluginData key、**不**动 vendored `kiwi-schema/` |
| c | `ApiCallAction` shape | `{ id, kind:'apiCall', method:'GET'\|'POST', url:string, bodyJson?:string, targetName:string }`。`bodyJson` 仅 POST 用,GET 忽略;`targetName` 必填(空 → IR warning + 编辑器 amber) |
| d | IR handler | 新增 `IRApiCallHandler { kind:'apiCall', method, url, body?:string, docStateName }`;`IREventHandler` 联合扩。`body` 是已校验过的 JSON 字符串(GET 时 undefined) |
| e | async handler emit | onClick handler 列表中**只要有一个** `apiCall` → 整个 arrow emit 成 `async () => { … }`,每个 handler 变语句;`apiCall` 是 `try { … } catch { … }` 块,同步 handler(setState 等)仍是表达式语句。纯同步列表维持现有 `() => …` 形态(零回归) |
| f | docStateWrites | `apiCall` 解析成功 → `docStateName` 进 `IRTree.docStateWrites`(驱动 `setDocState` import),与 setVariable 同 |
| g | 响应不校验类型 | 响应 `data` 直接 `setDocState(targetName, data)`,**不**比对 docState 声明的 type。类型不符是用户问题(或 §3.v2 + 运行时校验)。CORS / 网络错误同理 —— emit 不处理,文档提示 |

> 锁定后**不在对话中重新讨论**;若用户后续推翻视为显式 scope change,更新本节。

### 3.3 公开 API / Schema 改动

**SceneGraph types(`packages/core/src/scene-graph/types.ts`)**:

```ts
/** Phase 2 §3: fire an HTTP request on an event and write the parsed JSON
 *  response into a Document State. GET + POST only; static URL (no ${}
 *  templating — that rides §4). */
export interface ApiCallAction {
  id: string
  kind: 'apiCall'
  method: 'GET' | 'POST'
  /** Static request URL. Literal string — no interpolation in Phase 2 §3. */
  url: string
  /** POST request body — a JSON literal string, parsed + validated like a
   *  StatePanel array/object default. Undefined / ignored for GET. */
  bodyJson?: string
  /** Name of the DocumentStateDef the parsed JSON response is written into. */
  targetName: string
}

export type ActionDef = SetStateAction | NavigateAction | SetVariableAction | ApiCallAction
```

> `ActionKind = ActionDef['kind']` 自动扩成四元联合。`SetVariableAction` 等其它三个不动。

**IR types(`packages/compiler/src/ir/types.ts`)**:

```ts
/** Phase 2 §3: an HTTP request handler. Emits an async fetch + setDocState. */
export interface IRApiCallHandler {
  kind: 'apiCall'
  method: 'GET' | 'POST'
  url: string
  /** Validated JSON string for POST; undefined for GET. */
  body?: string
  /** Resolved target Document State name. */
  docStateName: string
}
// IREventHandler 联合扩 IRApiCallHandler
```

**IR collect(`packages/compiler/src/ir/collect/bindings.ts`)**:

- `resolveActions` switch 加 `case 'apiCall'`:
  - 校验 `url` 非空 → 否则 warning `action-apicall-missing-url`,handler 丢
  - 校验 `targetName` 在 `docStates` 里 → 否则 warning `action-apicall-unknown-target`,handler 丢
  - `method === 'POST'` 且 `bodyJson` 非空 → `JSON.parse` 校验,失败 warning `action-apicall-invalid-body`;GET 忽略 body
  - 成功 → push `IRApiCallHandler`,`docStateName` 进 `docStateWrites`

**emit react(`packages/compiler/src/adapters/react/emit/event.ts`)**:

- `emitEventHandler` 检测列表含 `apiCall` → arrow 前缀 `async `,body 走多语句块
- `case 'apiCall'`:emit `try { const res = await fetch(<url>[, <init>]); const data = await res.json(); setDocState(<name>, data) } catch (err) { console.error("apiCall failed:", err) }`;POST 时 `<init>` = `{ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(<parsed body>) }`

**编辑器 UI(`EventsPanel.vue`)**:

- `ACTION_KINDS` 加 `'apiCall'`;`actionKindLabel` 映射 `apiCall → "Call API"`
- `makeAction('apiCall')` → `{ id, kind:'apiCall', method:'GET', url:'', targetName: docStates[0]?.name ?? '' }`
- 行 UI:method 下拉(GET/POST)+ url input + targetName docState 下拉(同 setVariable);`method==='POST'` 时多一行 body JSON 输入(parse 错误 → 红框 + 10px error line,沿用 §2 经验 C)
- 校验:url 必填、targetName 解析到 docState、POST body JSON 合法

**i18n**:`panels.lowcodeActionCallApi` / `lowcodeActionApiUrl` / `lowcodeActionApiMethod` / `lowcodeActionApiBody` / `lowcodeActionApiTarget` 系列 + 7 locale 同步。

### 3.4 不动什么

- **不引入** axios / `@tanstack/react-query` / 任何 HTTP 库(决定 #2)
- **不做**鉴权头 / token(§3.v2)
- **不做** loading / error 自动状态(§3.v2)
- **不做** `${}` URL 模板 / 表达式 body(§4)
- `expression.ts` 子语言 —— 不动
- §2 的 `_lowcode_state.ts` / zustand runtime —— 不动(响应复用 `setDocState`)
- `kiwi-schema/`(vendored)、pluginData key 前缀 —— 不动
- `SetVariableAction` / `SetStateAction` / `NavigateAction` 三个既有 kind —— 不动

### 3.5 成功标准

1. `bun test ./tests/engine/compiler/` 全绿;新增至少:
   - `ir/collect/api-call.test.ts` —— url/targetName 校验、POST body JSON 校验、docStateWrites 写入
   - `adapters/react/emit/api-call.test.ts` —— GET / POST emit 形态、async handler、apiCall 与同步 handler 混排
2. `bun test ./tests/engine/kiwi/lowcode/` 全绿;新增 `api-call-action-pluginData.test.ts` —— `ApiCallAction` 经 `lowcode/events` 来回 .fig + 旧 .fig 字节回归
3. `bun run check` 全绿(jscpd 0 clones)
4. **Tauri 实测(用户主导)**:BUTTON onClick 加 apiCall、GET 一个公开 API、响应写进 array docState、画布上 LIST(§9)绑该 docState、preview iframe 点按钮看数据填充;POST + JSON body;.fig 存/读回
5. 不破坏 Phase 0 §8 / Phase 1 / Phase 2 §9 §2 任一锁定决定

### 3.6 工作分解(建议 1 名工程师,3–4 天)

> **步骤耦合说明**:`emit/event.ts` 的 `IREventHandler` switch 是 `never`-穷举式 —— 一旦把 `IRApiCallHandler` 加进 `IREventHandler` 联合,collect 与 emit 必须同一 commit 落地(否则 `bun run check` 红)。故 step 1 只定义 `IRApiCallHandler` 接口(不进联合),collect + emit 合并为 step 2。

| Step | 任务 | 验收 / commit message |
|---|---|---|
| 1 | `ApiCallAction` scene-graph schema + `ActionDef` 联合扩(`resolveActions` `default` 非穷举,安全);`IRApiCallHandler` 接口定义(**暂不进** `IREventHandler` 联合);kiwi 持久化测试 | `bun test ./tests/engine/kiwi/lowcode/` 全绿;`bun run check` 全绿;`feat(lowcode): step 1 — ApiCallAction schema + IR type (§3)` |
| 2 | `IRApiCallHandler` 进 `IREventHandler` 联合;`resolveActions` 加 `apiCall` case + 三类校验 + `docStateWrites`;`emitEventHandler` async 化 + GET/POST emit 形态;collect + emit 单测 | `bun test ./tests/engine/compiler/` 全绿;`bun run check` 全绿;`feat(lowcode): step 2 — apiCall IR collect + async fetch emit (§3)` |
| 3 | `EventsPanel.vue` apiCall 完整 UI(method / url / body / target)+ i18n + locale 同步 | `check:vue` + `check:i18n` + `test:dupes` 全绿;`feat(lowcode): step 3 — Call API editor UI (§3)` |
| 4 | walker checklist(§9.9 经验 A)+ 跨 walker 回归测试;Tauri 实测(用户主导);修 bug | 用户 ACK 全过;`docs(lowcode): §3 Tauri verification` |

### 3.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| onClick handler 变 async | 低 | React `onClick` 接受 async 函数(返回的 promise 被忽略);纯同步列表维持 `() => …` 形态,零回归 |
| 新 handler kind `apiCall` 被某 walker 漏 | 中(§9 经验 A) | step 5 走 walker checklist;`event.ts` switch 是穷举式(`never` 兜底自动报错),`ir-walk.ts` `stripEvents` 只过滤 navigate → apiCall 自动保留;跨 walker 回归测试 |
| apiCall 必须有 docState target,文档无 docState 时不可用 | 低 | UI target 下拉空时显示 "no document state"(同 setVariable);IR warning `action-apicall-unknown-target` |
| CORS / 网络失败 | 用户层 | emit 不处理,`try/catch` + `console.error`;文档提示这是用户后端 / 部署问题 |
| 响应非 JSON → `res.json()` 抛错 | 低 | 落进 `catch`,`console.error`;§3.v2 再加响应类型选择 |

### 3.8 Post-mortem

**Step commits:**

| Step | Commit | 内容 |
|---|---|---|
| 1 | `0c6fef8` | `ApiCallAction` schema + `ActionDef` 联合扩 + `IRApiCallHandler` 接口(暂不进 `IREventHandler` 联合)+ 持久化测试 |
| 2 | `362ea8f` | `IRApiCallHandler` 进联合 + `resolveApiCall` collect(3 道校验)+ `emitEventHandler` async fetch emit |
| 3 | `362ea8f` | EventsPanel "Call API" UI(method/url/body/target)+ i18n×8 |
| 4 | `5961432` | walker checklist + `cross-walker-apicall.test.ts` |
| fix | `df5e1b4` | LIST 可绑 docState 作数据源 |
| docs | (本提交) | §3 Tauri verification |

> Step 2+3 同一 commit(`362ea8f`):`IREventHandler` 的 `never`-穷举 switch 让 collect+emit 必须同 commit。

**Walker checklist(§9 经验 A)**:跑了一遍,**无 walker miss**。`emit/event.ts` switch 穷举式(`never` 兜底);`collect/bindings.ts` `resolveActions` 有 `case 'apiCall'`;`ir-walk.ts` 只过滤 `navigate`,apiCall 自动保留;`emit/element.ts` kind-agnostic。`cross-walker-apicall.test.ts` 钉死。

**实测发现 1 —— 瞬态 URL 重复(非 bug)**:用户报告 preview 里 apiCall 请求 URL 被重复拼接 9× → 404。编译器侧反复跑都是单次 URL(repro 验证),preview-bridge / dev-server 链路也无拼接逻辑。用户重试即恢复。判定为 preview 陈旧构建态(HMR 没吃到最新编译),非代码缺陷,不修补。教训:preview 偶发陈旧态;复现需抓 DevTools Network 的实际 Request URL + 当时 preview 跑的 `App.tsx` 才能区分。

**实测发现 2 —— LIST 不能绑 docState(链路缺口,已修 `df5e1b4`)**:§3 设计假定 apiCall 响应写进 docState 后,LIST 能绑该 docState 渲染。但 §9 建 LIST 数据源选择器时 §2 还不存在,LIST 只认页面 state;§2 加了 docState 却没接 LIST;§3 默认这条线通。修复:`dataSourceRef` 加 `docStateRef` 变体,`ListPanel.vue` 数据源下拉用两个 optgroup 列页面 state + docState,`collect/tree.ts` 抽 `resolveListArrayName` 双路解析、docState 源登记 `docStateReads`。emit 零改动(IRList `{(name).map}` 直接迭代 `useDocState` 局部)。回归测试 `list-docstate.test.ts`。**教训(§3 经验 E)**:跨 §X 的能力组合(本期 apiCall→docState→LIST 三段)要在设计阶段显式检查每段接口是否已存在 —— 不能假定前序 §X 留下的组件已经互相打通。§4+ 凡涉及"A 写、B 读"的数据流,设计 doc 里列一行"读写两端的现有接口核对"。

**测试结果**:`bun test ./tests/engine/compiler/` 230 pass、`./tests/engine/kiwi/lowcode/` 49 pass;`bun run check` 全绿(jscpd 0 clones)。Tauri 实测 2026-05-22 §3.5 #4 用户 ACK 全过。

---

## 4. §4 详细设计:表达式子语言扩展(窄口径)

> 2026-05-22 用户挑定 Phase 2 第四项开工(§3 收尾后)。形式参照 §2 / §3 / §9。
> **范围在对话中先锁为「窄口径」** —— 只接 §3 留的尾,不做 stub 原计划的函数调用 /
> 数组 / 对象字面量。4 项主决定 + 7 项次级默认见 §4.2。**4 项主决定 + 7 项次级默认
> 2026-05-22 已由用户在对话中锁定**(范围 #1 第一轮锁;#2–#4 + #a–#g 第二轮一次性 ACK)。
>
> **状态:🔒 已收尾**(HEAD `ae42730`)。Step 1–4 全 ✅,Tauri 实测 2026-05-23 用户 ACK 全过;实测期间无新发现。

### 4.1 现状与问题

当前表达式子语言(`packages/compiler/src/ir/expression.ts`)是一个 precedence-climbing
解析器:算术 / 比较 / 逻辑 / 三元 / 一元 / 成员访问 + 数字 / 字符串 / 标识符字面量。
`parseExpression(src) → { ast, references }`,`emitExpression(ast) → JS 串`。**没有**
函数调用、数组 / 对象字面量、字符串模板。

§3(API fetch)收尾时显式往本节推了两个尾:

1. **`${}` URL 模板** —— §3 决定 #3 锁了 `ApiCallAction.url` 是**静态字符串**,
   `https://api.example.com/users/${userId}` 这种带插值的 URL 不支持。Bubble 里
   "按行 ID 调接口" 是基本盘,本期补上。
2. **docState-in-expr** —— §2 落地 Document State 后,docState 只能经 `kind:'docState'`
   **直接绑定**整个值;不能在 `kind:'expr'` 表达式里把 docState 名当标识符引用
   (`users.length > 0`)。已确认是真实间隙:`unknownIdentifiers()`
   (`ir/collect/bindings.ts:132`)把表达式引用比对 page state + inScope,
   **docState 不在白名单**,所以 `kind:'expr'` 文本绑定 / `renderCondition` 里
   引用 docState 会被判 `binding-unknown-identifier` / `condition-unknown-identifier`。

stub 原计划的函数调用 `f(args)` / 数组字面量 `[a,b,c]` / 对象字面量 `{k:v}` —— stub 自身
已警告"为了换'能用'不一定值得";本期**不做**,推迟 §4.v2 / Phase 3。

**调试场景(期望)**:

```
SceneGraph (root "Document"):
  lowcodeDocumentState: [
    { name: 'userId', type: 'number', defaultValue: 1 },
    { name: 'user',   type: 'object', defaultValue: {} }
  ]

  CANVAS Home
    BUTTON  events.onClick = [{
      kind: 'apiCall', method: 'GET',
      url: 'https://jsonplaceholder.typicode.com/users/${userId}',  ← §4 模板
      targetName: 'user'
    }]
    TEXT    text binding kind:'expr', expr = 'user.name'            ← §4 docState-in-expr
    TEXT    renderCondition = 'user.id > 0'                          ← §4 docState-in-expr

期望 emit (片段):

  const userId = useDocState('userId')
  const user   = useDocState('user')
  ...
  <button onClick={async () => {
    try {
      const res = await fetch(`https://jsonplaceholder.typicode.com/users/${userId}`)
      const data = await res.json()
      setDocState("user", data)
    } catch (err) { console.error("apiCall failed:", err) }
  }}>...</button>
  ...
  <span>{user.name}</span>
  {(user.id > 0) && (<span>…</span>)}
```

**读写两端接口核对(经验 E)** —— §4 涉及的数据流每一段现有接口都已存在:

| 数据流 | 写端 | 读端 | 核对 |
|---|---|---|---|
| `${userId}` 在 URL → 读 docState | §2 `setDocState` / §3 apiCall | `docStateReads` → emit `const userId = useDocState('userId')` | ✅ `docStateReads` 机制 §2 已落地 |
| `${pageState}` 在 URL → 读 page state | 页面 `setX` | page state 已是组件内 `useState` 局部 | ✅ 无需额外登记 |
| docState-in-expr(文本绑定 / renderCondition) | §2 / §3 | 同上,`docStateReads` → `useDocState` 局部 | ✅ §2 已落地;§4 只需把引用登记进 `docStateReads` |

> §4 **不**新建任何"写"端 —— 全部复用 §2 / §3 已有的 docState 写入路径。

### 4.2 关键决定

> 形式同 §2.2 / §3.2。**#1–#4 已锁(2026-05-22 对话);#a–#g 为次级默认,开工前用户 ACK 视为已锁。**

| # | 主题 | 决定 | 理由 | 状态 |
|---|---|---|---|---|
| 1 | 范围 | **窄口径**:§4 = (1) `${}` 字符串插值,新 `ExprAst` kind `'template'` + 独立 `parseTemplate` scanner;(2) docState 名可在**读上下文**表达式引用。函数调用 / 数组字面量 / 对象字面量 **不做** | §3 留的尾是真实诉求;stub 自警函数 / 字面量扩展价值存疑、解析器复杂度抬升大。窄口径低风险、walker 改动面小 | **🔒 已锁** |
| 2 | `${}` 机制 | 插值落点是 `ApiCallAction.url`(§3 字段,scene-graph 类型**不变**仍 `string`)。IR collect 阶段用独立 `parseTemplate(raw)` 把原始 URL 串解析成 `template` AST。**不**给 `parseExpression` 文法加反引号模板字面量 —— `parseExpression` 文法**冻结**(零回归);`parseTemplate` 是独立 scanner,只在 URL 这一处入口用 | URL 字段是个原始串(不是表达式),需要一个"整串即模板体"的入口;给 `parseExpression` 加反引号 sugar 会动 tokenizer,带回归面而文本 `${}` 仅是 `+` 拼接的语法糖(`"Hello " + name` 今天就能用) | **🔒 已锁** |
| 3 | docState 可见上下文 | docState 名只在**读上下文**表达式可引用:`kind:'expr'` 文本绑定、`renderCondition`、apiCall url 模板。**写上下文 valueExpr 不变** —— setState / setVariable `valueExpr` 仍只解析 page state + `$prev` | 尊重 §2.2 #h 锁定决定(valueExpr 不开 docState→docState 引用图);读上下文引用 docState 无环路风险,是纯增量 | **🔒 已锁** |
| 4 | scene-graph / kiwi 改动 | §4 **零** scene-graph schema / kiwi / pluginData 改动。`ApiCallAction.url` 仍 `string`(原始用户串,含 `${}`,JSON 安全、`lowcode/events` 直接来回);模板解析全在 compiler IR 层。只 `IRApiCallHandler.url` 从 `string` 升 `ExprAst` | 模板是 compiler 关注点,不是持久化关注点;零 schema 改动 → 无 kiwi 持久化测试、无 vendored `kiwi-schema/` 顾虑、老 .fig 字节不变 | **🔒 已锁** |

**次级默认(开工前用户 ACK 视为已锁)**:

| # | 主题 | 默认 |
|---|---|---|
| a | `template` AST shape | `{ kind:'template'; quasis:string[]; expressions:ExprAst[] }`,不变式 `quasis.length === expressions.length + 1`。零 expression 的退化 template 表示纯静态串 |
| b | `parseTemplate(raw)` 行为 | 扫 raw 串找 `${`,提取**平衡 `}`** 段喂 `parseExpression`,累积 quasis。raw 不含 `${` → 单 quasi、零 expression 的退化 template。`${` 不平衡 / 内层表达式语法错 → 返回 `{ ok:false, error }`(复用 `ParseResult` 的 ok/error 联合)。`${}` 字面量在 quasi 段内不需转义还原 —— scanner 只识别 `${` |
| c | emit | `emitWithPrec` 加 `case 'template'`:`expressions.length === 0` → `JSON.stringify(quasis[0])`(双引号串,与 §3 字节一致 → 静态 URL 零回归);否则反引号模板 `` `q0${e0}q1…` ``,每个 expression 以 prec `0` emit,quasi 段对反引号 / `${` / 反斜杠转义 |
| d | walker(经验 A) | `collectReferences` / `hasPrevReference` / `substitutePrev` 各加 `case 'template'` 递归进 `expressions`。`collectReferences` 必需(收集 `${}` 内标识符);`hasPrevReference` / `substitutePrev` 为完备性补 —— 模板理论上不携 `$prev`,但 walker 是 `ExprAst` 全函数,不留隐式 `default` 漏 |
| e | url 模板引用解析 | apiCall url 模板的标识符按**读上下文**解析:page state + docState + inScope(LIST item/index)。`unknownIdentifiers` 加 `docStates` 入参;`resolveApiCall` 经 `resolveEvents`→`resolveActions` 新拿 `states` / `inScope` / `docStateReads`。引用解析到 docState → 登记 `docStateReads` |
| f | 新 warning code | `action-apicall-invalid-url`(url 模板 parse 失败,handler 丢)+ `action-apicall-unknown-identifier`(url 模板引用未知标识符,handler 丢);`expression-prev-out-of-context` 复用(`$prev` 出现在 url 模板)。§3 的 `action-apicall-missing-url`(空 url)保留。docState-in-expr 复用既有 `binding-unknown-identifier` / `condition-unknown-identifier` —— 只是白名单放宽,引用真未知时仍报 |
| g | 编辑器 UI | `EventsPanel.vue` apiCall 的 url `<input>` 加实时模板校验 —— `parseTemplate` 失败 → 红框 + 10px error line(经验 C),i18n 加一条 "supports ${expr}" 提示。docState-in-expr 的文本绑定 / `renderCondition` 面板**不**动(纯 compiler 白名单放宽,无 UI 表面) |

> 锁定后**不在对话中重新讨论**;若用户后续推翻视为显式 scope change,更新本节。

### 4.3 公开 API / Schema 改动

**表达式子语言(`packages/compiler/src/ir/expression.ts`)**:

```ts
export type ExprAst =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'ident'; name: string }
  | { kind: 'member'; object: ExprAst; property: string }
  | { kind: 'unary'; op: '!' | '-' | '+'; arg: ExprAst }
  | { kind: 'binary'; op: BinaryOp; left: ExprAst; right: ExprAst }
  | { kind: 'ternary'; test: ExprAst; consequent: ExprAst; alternate: ExprAst }
  | { kind: 'template'; quasis: string[]; expressions: ExprAst[] }  // §4

/** Phase 2 §4: parse a raw string as a template body — no surrounding
 *  backticks. Splits on `${ … }` (balanced braces); each interpolation
 *  segment is parsed by `parseExpression`. A raw string with no `${`
 *  yields a degenerate single-quasi template. Used for `ApiCallAction.url`.
 *  `parseExpression`'s grammar is NOT touched — this is a standalone scanner. */
export function parseTemplate(raw: string): ParseResult
```

> `emitExpression` / `collectReferences` / `hasPrevReference` / `substitutePrev` 各加 `case 'template'`(经验 A)。`parseExpression` 文法、tokenizer、`Token` 联合 —— **不动**。

**IR types(`packages/compiler/src/ir/types.ts`)**:

```ts
export interface IRApiCallHandler {
  kind: 'apiCall'
  method: 'GET' | 'POST'
  /** Phase 2 §4: parsed URL template (a `kind:'template'` ExprAst). A
   *  static URL is a degenerate zero-expression template — emits as a
   *  plain double-quoted string, byte-identical to §3. */
  url: ExprAst
  body?: string
  docStateName: string
}
```

> `IRApiCallHandler.url` 由 `string` 升 `ExprAst`。其余 IR 类型不动。

**IR collect**:

- `unknownIdentifiers`(`collect/bindings.ts`)签名加 `docStates: ReadonlyMap<string, IRDocStateDecl>` 入参;docState 名进白名单。
- `resolveTextBinding` `kind:'expr'` 分支(`bindings.ts`)+ `wrapConditional`(`collect/tree.ts`):调 `unknownIdentifiers` 时传 `docStates`;引用解析到 docState → `docStateReads.add(name)`。
- `resolveApiCall`(`bindings.ts`):`url` 改走 `parseTemplate`;非空校验后,模板 parse 失败 → `action-apicall-invalid-url`;收集模板引用,`$prev` → `expression-prev-out-of-context`,未知标识符 → `action-apicall-unknown-identifier`,docState 引用 → `docStateReads`。`resolveEvents` / `resolveActions` 新增 `inScope` / `docStateReads` 透传。
- 写上下文(`resolveSetState` / `resolveSetVariable` 的 `valueExpr`)—— **不动**(决定 #3)。

**emit react(`adapters/react/emit/event.ts`)**:

- `apiCall` case:`fetch(${url})` 的 `url` 由 `JSON.stringify(h.url)` 改 `emitExpression(h.url)`。静态 URL → `emitExpression` 输出双引号串,字节不变;带插值 → 反引号模板。

**编辑器 UI(`EventsPanel.vue`)**:url `<input>` 实时 `parseTemplate` 校验 → 红框 + 10px error line;i18n `panels.lowcodeActionApiUrlHint`(+ 7 locale 同步)。

### 4.4 不动什么

- **不做**函数调用 `f(args)` / 数组字面量 `[a,b,c]` / 对象字面量 `{k:v}`(推迟 §4.v2 / Phase 3)
- **不动** `parseExpression` 文法 / tokenizer / `Token` 联合 —— 反引号模板字面量**不**进通用文法(决定 #2)
- **不动** scene-graph schema / `ApiCallAction` 字段 / kiwi / pluginData(决定 #4);`ApiCallAction.url` 仍 `string`
- **不动**写上下文 `valueExpr` 的标识符解析 —— setState / setVariable 仍只认 page state + `$prev`(尊重 §2.2 #h,决定 #3)
- **不动** §2 的 `_lowcode_state.ts` / zustand runtime / `useDocState` / `setDocState`
- **不动** `ActionDef.kind` 字面值、`OPEN_PENCIL_PLUGIN_ID`、pluginData key 前缀
- vendored `kiwi-schema/` —— 不动

### 4.5 成功标准

1. `bun test ./tests/engine/compiler/` 全绿;新增至少:
   - `ir/expression-template.test.ts` —— `parseTemplate` 退化 / 单插值 / 多插值 / 不平衡 `${` / 内层语法错;`emitExpression` template 形态(零 expression → 双引号、带插值 → 反引号);`collectReferences` 收集模板引用
   - `ir/collect/expr-docstate.test.ts` —— `kind:'expr'` 文本绑定 + `renderCondition` 引用 docState 解析成功 + `docStateReads` 登记;引用真未知仍报 warning
   - `ir/collect/api-call-url-template.test.ts` —— url 模板引用 page state / docState / item;模板 parse 失败 / 未知标识符 / `$prev` 三类 warning
   - `adapters/react/emit/api-call.test.ts`(§3 既有)—— 更新:静态 URL emit 字节不变;带插值 URL emit 反引号模板
2. `bun test ./tests/engine/kiwi/lowcode/` 全绿(§4 零 schema 改动 → 无新增测试,既有全过)
3. `bun run check` 全绿(jscpd 0 clones)
4. **Tauri 实测(用户主导)**:apiCall url 写 `${docState}` 模板、docState 在文本绑定 / renderCondition 里引用、preview 看插值生效;静态 URL 回归无变化;.fig 存/读回
5. 不破坏 Phase 0 §8 / Phase 1 / Phase 2 §9 §2 §3 任一锁定决定

### 4.6 工作分解(建议 1 名工程师,2–3 天)

> **步骤耦合说明**:`IRApiCallHandler.url` 从 `string` 升 `ExprAst` 后,collect(产出 `url:ExprAst`)与 emit(`emitExpression(h.url)`)必须同 commit 落地(否则类型不符,`bun run check` 红)。故 step 3 collect + emit 合并。step 1(`expression.ts` 纯增量)、step 2(docState-in-expr,改 `unknownIdentifiers` 签名)各自独立可单 commit。

| Step | 任务 | 验收 / commit message |
|---|---|---|
| 1 | `expression.ts`:`template` AST kind + `parseTemplate` scanner + `emitWithPrec` / `collectReferences` / `hasPrevReference` / `substitutePrev` 各加 `case 'template'`;`parseExpression` 文法冻结不动;单测 | `bun test ./tests/engine/compiler/` 全绿;`bun run check` 全绿;`feat(lowcode): step 1 — template AST + parseTemplate (§4)` |
| 2 | docState-in-expr:`unknownIdentifiers` 加 `docStates` 入参;`resolveTextBinding` `kind:'expr'` + `wrapConditional` 传 `docStates` + 登记 `docStateReads`;collect 单测 | `bun test ./tests/engine/compiler/` 全绿;`bun run check` 全绿;`feat(lowcode): step 2 — docState-in-expr read contexts (§4)` |
| 3 | apiCall url 模板:`IRApiCallHandler.url` 升 `ExprAst`;`resolveApiCall` 走 `parseTemplate` + 引用校验(`states`/`inScope`/`docStateReads` 透传);`emitEventHandler` apiCall case 改 `emitExpression`;§3 既有测试更新 + 新增 url-template 测试 | `bun test ./tests/engine/compiler/` 全绿;`bun run check` 全绿;`feat(lowcode): step 3 — apiCall url template (§4)` |
| 4 | `EventsPanel.vue` url 实时模板校验(红框 + error line)+ i18n×8;walker checklist(经验 A)+ 跨 walker 回归测试;Tauri 实测(用户主导);修 bug | `check:vue` + `check:i18n` + `test:dupes` 全绿;用户 ACK 全过;`docs(lowcode): §4 Tauri verification` |

### 4.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 新 `ExprAst` kind `template` 被某 expr walker 漏 | 中(经验 A) | `expression.ts` 内 4 个 walker(`emitWithPrec` / `collectReferences` / `hasPrevReference` / `substitutePrev`)全有 `default` 分支 —— 加 union member **不**触发 tsgo 报错,必须 step 4 走 walker checklist 逐个核对 + 跨 walker 回归测试钉死 |
| `parseTemplate` 的 `${}` 平衡括号扫描出错(嵌套 `{}`、字符串内 `}`) | 中 | 内层表达式可含对象成员?本期无对象字面量 → `${}` 内不会有裸 `{`;字符串字面量内的 `}` 要靠 scanner 跳过引号段。单测覆盖 `${"a}b"}` / 不平衡 `${` |
| 静态 URL emit 字节漂移 → §3 emit 测试回归 | 低 | `emitWithPrec` template 零 expression 分支走 `JSON.stringify(quasis[0])`,与 §3 `JSON.stringify(h.url)` 完全一致;§3 `api-call.test.ts` 静态用例不改即过 |
| `IRApiCallHandler.url` 类型变更打到 §3 既有测试 | 低(预期内) | §3 `api-call.test.ts` 断言 `url` 为 string 的用例随 step 3 更新为 `ExprAst`;属计划内改动,不是回归 |
| docState-in-expr 放宽白名单后,老 .fig 里"恰好撞 docState 名"的表达式语义变化 | 低 | docState 引用前本来就报 `unknown-identifier` 并丢绑定 → 老 .fig 该表达式本就不生效;放宽后开始生效是修复不是回归。文档记一句 |

### 4.8 Post-mortem

> 设计 + step 1–4 交付 2026-05-22;**Tauri 用户实测 2026-05-23 §4.5 #4 全过,实测期间无新发现 —— 无 bug-fix commit。**

**Step commits:**

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `ddf60b5` | §4 详细设计 + 锁定决定 |
| 1 | `d740a0a` | `template` ExprAst kind + `parseTemplate` scanner + 4 walker case + 单测 |
| 2 | `6584e9b` | docState-in-expr:`unknownIdentifiers` `docStates` 入参 + `registerDocStateReads` + 文本绑定 / renderCondition 登记 reads |
| 3 | `85345c3` | `IRApiCallHandler.url` 升 `ExprAst`;`resolveApiCall` `parseTemplate` + 引用校验;emit `emitExpression(h.url)` |
| 4 | `ae42730` | `validateUrlTemplate` + EventsPanel url 红框/hint + i18n×8;walker checklist + `cross-walker/template.test.ts` |
| docs | `77ea85e` | §4 step 1–4 post-mortem(commit 链 + walker checklist) |
| docs | (本提交) | §4 Tauri verification |

**Walker checklist(经验 A)**:跑了一遍,**无 walker miss**。新增的是 `ExprAst` kind `template`(非 IRNode / ActionDef kind)。4 个 ExprAst walker(`emitWithPrec` / `collectReferences` / `hasPrevReference` / `substitutePrev`,全在 `expression.ts`)各加显式 `case 'template'`。其余 `ExprAst` 触点(`element.ts` / `event.ts` 的 `emitExpression(...)`、`bindings.ts` 的 `buildValueUpdate`)均 kind-agnostic,经 walker 处理。`ir-walk.ts` 不碰表达式。`cross-walker/template.test.ts` 钉死每个 walker 下降进 template + 全编译端到端。

**实测发现**:无。§4.5 #4 六项(`${}` URL 模板 / docState-in-expr 文本绑定 + renderCondition / EventsPanel url 红框校验 / 静态 URL 回归 / `.fig` 存读回)2026-05-23 用户逐项 ACK 全过。窄口径锁得准 —— 零 scene-graph / kiwi 改动,无 §3 那种链路缺口(经验 E:设计阶段「读写两端接口核对」表已先核过 `docStateReads → useDocState` 全链路)。

**测试结果**:`bun test ./tests/engine/compiler/` + `./tests/engine/kiwi/lowcode/` 313 pass;`bun run check` 全绿(jscpd 0 clones)。Tauri 实测 §4.5 #4 用户 ACK 全过。

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

## 8. §8 详细设计:更多交互组件

> 2026-05-23 用户挑定 Phase 2 第五项开工(§4 收尾后)。形式参照 §3 / §4。
> **4 项主决定 2026-05-23 已由用户在对话中锁定**(#1 / #3 第一轮分别 ACK「原生零依赖」「RADIO 单选组」;#2 / #4 + #a–#g 第二轮一次性 ACK)。
>
> **状态:🔨 开工中**(step 1–4)。

### 8.1 现状与问题

当前 6 个交互组件:`BUTTON` / `INPUT` / `CHECKBOX` / `FORM` / `LIST` / `SELECT`。
覆盖了大部分表单场景,但缺多行文本、单选组、日期、开关 —— Bubble 表单的常见件。

**Phase 2 目标**:加 `RADIO` / `TEXTAREA` / `DATEPICKER` / `SWITCH` 共 4 个。

**加一个交互组件的改动面**(已逐文件核过):

| 层 | 文件 | 改动 |
|---|---|---|
| scene-graph | `scene-graph/types.ts` | `NodeType` 联合加字面值 |
| scene-graph | `scene-graph/node-defaults.ts` | `interactiveDefaults()` 加 `case`(尺寸 + 默认 `interactiveProps`) |
| editor | `editor/types.ts` | `Tool` 联合加字面值 |
| editor | `editor/tool-registry.ts` | `EDITOR_TOOLS` 的 Interactive flyout 列表 |
| editor | `editor/shapes.ts` | `INTERACTIVE_TYPES` 集合(跳过通用 fill 覆盖) |
| canvas | `canvas/renderer.ts` | `isRectangularType()` |
| kiwi | `kiwi/node-change/lowcode-plugin-data.ts` | `LOWCODE_NODE_TYPES` 集合 —— **决定能否 .fig 往返** |
| vue | `shared/input/types.ts` | `TOOL_TO_NODE` 工具→节点映射 |
| vue | `editor/tool-cursor/index.ts` | `TOOL_CURSORS`(`Record<Tool>` 穷举) |
| vue | `i18n/messages.ts` + 7 locale | `tools` 组工具标签 |
| app | `app/editor/icons.ts` | `toolIcons`(`Record<Tool>` 穷举) |
| app | `components/Toolbar/Toolbar.vue` | `toolLabels` / `toolShortcuts`(`Record<Tool>` 穷举) |
| compiler | `ir/collect/tree.ts` | `TAG_BY_TYPE` + `applyInteractiveProps()` 加 `case` |

**关键现状**:**当前没有 interactiveProps 编辑面板** —— `INPUT` 的 `placeholder` / `value`、`CHECKBOX` 的 `checked`、`SELECT` 的 `options` 都没有 UI 可编辑,只吃 `node-defaults.ts` 默认值(`ListPanel` 是唯一编 `interactiveProps` 的面板,只编 `dataSourceRef`)。§8 跟进同一现状 —— 不为新组件造属性面板。

### 8.2 关键决定

> 形式同 §3.2 / §4.2。**#1–#4 已锁(2026-05-23 对话);#a–#g 为次级默认,开工前用户 ACK 视为已锁。**

| # | 主题 | 决定 | 理由 | 状态 |
|---|---|---|---|---|
| 1 | DOM 落地 | 4 个组件**全 emit 原生 HTML 元素,零新依赖**:`RADIO`→`<input type="radio">`、`TEXTAREA`→`<textarea>`、`DATEPICKER`→`<input type="date">`、`SWITCH`→`<input type="checkbox" role="switch">`。`DATEPICKER` 走原生 date input,**不引** react-datepicker | 原生元素零成本、零运行时依赖 → 经验 D 不触发(emit 产物不背新 npm 包),§8 保持真·纯增量零风险;日期选择 UI 交给浏览器原生件,本期够用 | **🔒 已锁** |
| 2 | 范围 | **纯组件增量**:加 NodeType / Tool / 默认值 / canvas 占位 / kiwi 持久化 / 编译 emit。**不**新增 interactiveProps 编辑面板(沿用 INPUT/CHECKBOX/SELECT 现状)、**不**动 `EventsPanel`(事件仍只 BUTTON / FORM) | 属性面板缺失是预存现状,补它是独立工作不属 §8;事件扩展(onChange 等)触及 `EventsPanel` + IR + emit,远超「纯加法」范畴 | **🔒 已锁** |
| 3 | RADIO 模型 | `RADIO` 是**单选组节点** —— 一个节点带 `interactiveProps.options: string[]` + `value` + `groupName`,emit 一个 `<div>` 包 N 个 `<label><input type="radio" name={groupName}>…</label>`。同构 `SELECT`(options 数组 → 多子节点)。**无** `RADIO_GROUP` 容器(推迟) | 叶子单选钮在缺属性面板时所有 RADIO 吃同一默认 `groupName` → 不可区分、实际不可用;单选组节点与 SELECT 同构,开箱即一个完整单选组 | **🔒 已锁** |
| 4 | 持久化 | 4 个新 `NodeType` 经 `lowcode/nodeType` pluginData **旁路持久化**(kiwi 二进制按 `mapToFigmaType` 默认存成 `RECTANGLE`,读回时 `nodeTypeOverride` 还原)。只需把 4 个字面值加进 `LOWCODE_NODE_TYPES` 集合 —— **零 vendored `kiwi-schema/` 改动** | §12 既有机制,新 NodeType 自动套用;不动 vendored schema(Phase 1 §12.3 #1 锁定) | **🔒 已锁** |

**次级默认(开工前用户 ACK 视为已锁)**:

| # | 主题 | 默认 |
|---|---|---|
| a | NodeType / Tool 字面值 | 组件名直用:`RADIO` / `TEXTAREA` / `DATEPICKER` / `SWITCH`。`Tool` key 同名 —— 无与现有 Tool 冲突(只有 `SELECT` 节点因撞 move 工具 `SELECT` 才用 `SELECT_FIELD` 别名) |
| b | node-defaults | `RADIO` 200×96 白底灰框 `{ options: [], value: '', groupName: 'radio-group' }`;`TEXTAREA` 200×80 圆角 6 + 左右 padding 12 白底灰框 `{ placeholder: 'Enter text', value: '' }`;`DATEPICKER` 200×36 同 `INPUT` `{ value: '' }`;`SWITCH` 44×24 圆角 12 灰底 `{ checked: false }`。4 个**均非** `CONTAINER`(无子场景节点 —— RADIO 选项同 SELECT options 是 emit 期生成) |
| c | canvas 占位 | 4 个都进 `renderer.ts` `isRectangularType()` —— 画布画成矩形占位卡片,选项/开关态/日期值**不在画布渲染**(与 SELECT/CHECKBOX 一致,只在 emit / preview 出真元素) |
| d | compiler emit | `TAG_BY_TYPE`:`RADIO`→`div`、`TEXTAREA`→`textarea`、`DATEPICKER`→`input`、`SWITCH`→`input`。`applyInteractiveProps`:`TEXTAREA` 同 `INPUT`(`placeholder` 属性 + `value`→`defaultValue`);`DATEPICKER` `type="date"` + `value`→`defaultValue`;`SWITCH` `type="checkbox"` + `role="switch"` + `checked`→`defaultChecked`;`RADIO` 遍历 `options` push `<label>`(内含 `<input type="radio" name value defaultChecked>` + 文本)。RADIO 的 options 循环若与 SELECT 的 jscpd 报 clone → 抽公共 helper |
| e | flyout 顺序 | Interactive flyout 按逻辑分组:`[BUTTON, INPUT, TEXTAREA, SELECT_FIELD, CHECKBOX, RADIO, SWITCH, DATEPICKER, FORM, LIST]` |
| f | i18n | `tools` i18n 组加 `radio` / `textarea` / `datepicker` / `switch`(键 `switch` 作对象属性名 + 成员访问均合法 JS;若 oxlint 报保留字再改 `switchToggle`)+ 7 locale 同步。`toolShortcuts` 4 个均空串(无快捷键,同 INPUT/SELECT_FIELD/CHECKBOX) |
| g | 不加什么 | 不加 `EventsPanel` / interactiveProps 属性面板 / `NODE_ICONS` 图层图标(现有 6 个交互组件在图层面板本就 fallback `IconSquare`,§8 跟进) |

> 锁定后**不在对话中重新讨论**;若用户后续推翻视为显式 scope change,更新本节。

### 8.3 公开 API / Schema 改动

**SceneGraph(`packages/core/src/scene-graph/`)**:

```ts
// types.ts — NodeType 联合追加
export type NodeType =
  | …
  | 'INPUT' | 'BUTTON' | 'SELECT' | 'CHECKBOX' | 'FORM' | 'LIST'
  | 'RADIO' | 'TEXTAREA' | 'DATEPICKER' | 'SWITCH'   // §8

// node-defaults.ts — interactiveDefaults() 加 4 个 case(尺寸 + interactiveProps)
```

**editor(`packages/core/src/editor/`)**:`Tool` 联合 + `EDITOR_TOOLS` flyout + `INTERACTIVE_TYPES` 集合各加 4 个。

**canvas**:`renderer.ts` `isRectangularType()` 加 4 个。

**kiwi**:`lowcode-plugin-data.ts` `LOWCODE_NODE_TYPES` 集合加 4 个 —— 4 个新类型自动经 `lowcode/nodeType` 往返。`LOWCODE_PLUGIN_KEYS` 不变(无新 key)。

**vue / app**:`TOOL_TO_NODE`、`TOOL_CURSORS`、`toolIcons`、`toolLabels`、`toolShortcuts` 各加 4 个(后 4 个是 `Record<Tool>` 穷举 → tsgo 强制不漏);i18n `tools` 组 + 7 locale。

**compiler(`packages/compiler/src/ir/collect/tree.ts`)**:`TAG_BY_TYPE` + `applyInteractiveProps()` 各加 4 个 `case`。`CONTAINER_TYPES` / `CONTAINER_TYPES_FOR_RECURSION` **不动**(新组件非容器)。

> 无新 IR 类型、无新 `ExprAst` / `ActionDef` / `IREventHandler` kind、无 scene-graph 字段新增 —— 4 个组件全部复用既有 `interactiveProps: Record<string, unknown>` 通道。

### 8.4 不动什么

- **不引入** react-datepicker / 任何 npm 包(决定 #1)
- **不新增** interactiveProps 编辑面板(决定 #2)
- **不动** `EventsPanel.vue` —— 事件仍只 BUTTON / FORM,新组件无事件(决定 #2)
- **不动** vendored `kiwi-schema/`、`LOWCODE_PLUGIN_KEYS`、pluginData key 前缀(决定 #4)
- **不动** `CONTAINER_TYPES` / `CONTAINER_TYPES_FOR_RECURSION`(新组件非容器)
- **不动** 既有 6 个交互组件的 NodeType / 默认值 / emit
- **不新增** IR 类型 / `ExprAst` / `ActionDef` / `IREventHandler` kind
- **不动** `OPEN_PENCIL_PLUGIN_ID`

### 8.5 成功标准

1. `bun test ./tests/engine/compiler/` 全绿;新增至少 `ir/collect/interactive-components.test.ts` —— 4 个组件 `TAG_BY_TYPE` + `applyInteractiveProps`(TEXTAREA placeholder/value、DATEPICKER `type=date`、SWITCH `type=checkbox` + `role=switch`、RADIO options→`<label>` 组)
2. `bun test ./tests/engine/kiwi/lowcode/` 全绿;新增 4 个新 `NodeType` 的 `lowcode/nodeType` 往返测试 + 旧 .fig 字节回归
3. `bun run check` 全绿(jscpd 0 clones —— RADIO/SELECT 循环抽 helper 后)
4. **Tauri 实测(用户主导)**:Interactive flyout 出现 4 个新工具、画布能画占位卡片、preview 渲染成对应原生元素(`<textarea>` / `<input type="date">` / radio 组 / switch)、`.fig` 存读回类型不丢
5. 不破坏 Phase 0 §8 / Phase 1 / Phase 2 §9 §2 §3 §4 任一锁定决定

### 8.6 工作分解(建议 1 名工程师,2–3 天)

| Step | 任务 | 验收 / commit message |
|---|---|---|
| 1 | scene-graph + editor + canvas + kiwi + vue/app 脚手架(NodeType / Tool / node-defaults / tool-registry / shapes / renderer / `LOWCODE_NODE_TYPES` / `TOOL_TO_NODE` / cursor / icons / labels / i18n×8);kiwi `lowcode/nodeType` 往返测试 | `bun test ./tests/engine/kiwi/lowcode/` 全绿;`bun run check` 全绿;`feat(lowcode): step 1 — RADIO/TEXTAREA/DATEPICKER/SWITCH scaffolding (§8)` |
| 2 | compiler emit:`TEXTAREA` / `DATEPICKER` / `SWITCH` 三个叶子组件 `TAG_BY_TYPE` + `applyInteractiveProps` + emit 单测 | `bun test ./tests/engine/compiler/` 全绿;`bun run check` 全绿;`feat(lowcode): step 2 — TEXTAREA/DATEPICKER/SWITCH emit (§8)` |
| 3 | compiler emit:`RADIO` 单选组(options→`<label>` 子节点,与 SELECT 抽公共 helper)+ emit 单测 | `bun test ./tests/engine/compiler/` 全绿;`bun run check` 全绿(jscpd 0);`feat(lowcode): step 3 — RADIO radio-group emit (§8)` |
| 4 | walker checklist(经验 A)+ 跨 walker 回归测试;Tauri 实测(用户主导);修 bug | 用户 ACK 全过;`docs(lowcode): §8 Tauri verification` |

### 8.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 新 `NodeType` ×4 被某 `node.type` switch 漏 | 中(经验 A) | `Record<Tool>` 四张表(`TOOL_CURSORS` / `toolIcons` / `toolLabels` / `toolShortcuts`)tsgo 穷举强制;`interactiveDefaults` / `applyInteractiveProps` 是 `default`-兜底 switch,**不**报错 → step 4 走 walker checklist 逐个核 `node.type` / `NodeType` + 跨 walker 回归测试 |
| RADIO 的 options 循环与 SELECT 的 jscpd 报 clone | 低 | 决定 #d:抽公共 helper(SELECT 的 `<option>` 与 RADIO 的 `<label><input>` 结构不同,helper 收敛「遍历 options + 类型守卫」骨架);`bun run test:dupes` 钉 0 clones |
| `<textarea>` 的 React value 应走 `defaultValue` 而非 children | 低 | `applyInteractiveProps` 把 value 写进 `attrs.defaultValue`(同 INPUT)—— React `<textarea defaultValue="…" />` 是正确写法,emit 的 attr 通道天然正确 |
| 新组件无属性面板,用户只能用默认值 | 低(预存现状) | 决定 #2:SELECT 的 options 当前同样无 UICN;非 §8 回归。文档提示;属性面板是独立后续工作 |
| `lowcode/nodeType` 往返:旧 .fig 不含新类型 | 低 | `LOWCODE_NODE_TYPES` 只控制**写**;读端 `assignLowcodeField` 对未知类型字符串已有守卫(`LOWCODE_NODE_TYPES.has` 判断)。旧 .fig 字节回归测试钉死 |

### 8.8 Post-mortem

> 设计 + step 1–4 交付 2026-05-23;**Tauri 用户实测待跑**,实测后回填发现 + `docs(lowcode): §8 Tauri verification`。

**Step commits:**

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `e5a8bc2` | §8 详细设计 + 锁定决定 |
| 1 | `2cf788d` | 4 个组件脚手架(NodeType / Tool / node-defaults / tool-registry / shapes / renderer / `LOWCODE_NODE_TYPES` / `TOOL_TO_NODE` / cursor / icons / labels / i18n×8)+ kiwi 往返测试 |
| 2 | `149234d` | `TEXTAREA` / `DATEPICKER` / `SWITCH` emit;`applyInteractiveProps` 重构为薄分发 + 抽 per-component helper(内联 switch 触 oxlint complexity-20 上限) |
| 3 | `f60a5ee` | `RADIO` 单选组 emit;SELECT/RADIO 共用 `optionStrings` helper |
| 4 | `1925628` | walker checklist + `cross-walker/interactive-components.test.ts` |
| docs | (待提交) | §8 Tauri verification |

**Walker checklist(经验 A)**:跑了一遍,**无 walker miss**。4 个新 `NodeType` 被每个 `node.type` 分发处理 —— `TAG_BY_TYPE` / `applyInteractiveProps` / `isRectangularType` / `INTERACTIVE_TYPES` / `LOWCODE_NODE_TYPES` / `TOOL_TO_NODE` + 4 张 tsgo 穷举 `Record<Tool>` 表。`canvas/scene.ts` 的 `isClippableContainer` 与 `CONTAINER_TYPES` 正确不含新类型(非容器);`DesignPanel` / `EventsPanel` 正确不含(决定 #2 —— 无面板、无事件)。`io/formats/jsx` 核心导出器对交互类型本就泛化处理,无新增 type switch。

**意外 1 —— `applyInteractiveProps` 复杂度超标**:step 2 把 4 个组件 case 内联进 switch 后 oxlint `complexity` 报 21 > 20。重构成薄分发 + 5 个 per-component helper(`applyTextInputProps` / `applyToggleProps` / `applyDatePickerProps` / `applyButtonProps` / `applySelectOptions`),CHECKBOX 与 SWITCH 共用 `applyToggleProps`。顺带消除了 RADIO/SELECT 的 jscpd 风险(step 3 抽 `optionStrings`)。

**测试结果**:`bun test ./tests/engine/compiler/` + `./tests/engine/kiwi/lowcode/` 324 pass;`bun run check` 全绿(jscpd 0 clones)。Tauri 实测待用户主导。

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
