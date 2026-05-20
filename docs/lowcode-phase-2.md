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
| 8 | **条件渲染 / 列表渲染**(候选 §9) | 高 | 当前不能在画布上表达 "if / for";至少需要 IR 层加 `IRConditional` / `IRList` + 编辑器 UI 暴露 | TBD §9 |

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

## 2. 候选 §2 — `setVariable` 运行时存储

**当前**: `SetVariableAction` 在 §7.4 落了 union slot,但 compiler 端永远 warn 并 drop。

**Phase 2 目标**: 给编译产物补最小运行时变量 store,让 `setVariable` 从警告变功能。

**待锁决定**:
- store 选什么?候选:`localStorage` / React Context / `zustand`(已用 React,加依赖小) / 自写 mini-store
- 变量是页面级还是文档级?Phase 0 §2 的 state 是页面级,setVariable 走文档级才有意义,否则跟 setState 冗余
- 跨页持久化:存 sessionStorage / localStorage / 内存
- 跟 `bindings` 是否打通?(`TEXT.bindings.text = { kind: 'var', varName: 'username' }`?)

**风险**: 若 store 选 Context,得改 `App.tsx` / 多页 router shell;若选 `zustand`,加 `dependencies` 一项。

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

## 9. 候选 §9 — 条件渲染 / 列表渲染

**当前**: 不能表达 "if X show this" / "for each item show that"。所有节点都无条件渲染。

**Phase 2 目标**: 至少 IR 层加 `IRConditional` / `IRList` + 编辑器 UI 暴露入口。

**待锁决定**:
- 条件:绑哪种 expression?和 `bindings` 共用 grammar 还是单独一套?
- 列表:数据源是 state 还是单独 dataSource?(LIST 节点已经有 `dataSourceRef` 占位)
- UI 暴露:右键菜单 / 设计面板加 "Conditional render" 卡片?
- emit:用 `{cond && <X/>}` / `<X v-if>` 等价?React 端就是 `cond ? <X/> : null` 或 `{cond && <X/>}`

**风险**: 影响 IR / emit / UI 三层,工作量大;但产品价值最高 —— **Bubble 用户实际诉求高频排第二(仅次于 API)**。

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
