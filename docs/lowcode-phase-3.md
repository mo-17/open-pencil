# Phase 3 — Lowcode Platform on OpenPencil

> 紧接 `docs/lowcode-phase-2.md`。Phase 2 在 HEAD `f9a58ca`(branch
> `lowcode-phase-0`)收官,§1.1 候选 8 项中 7 项交付,§5(Kiwi schema 升格)
> 推迟到本 Phase 作为候选。Phase 2 全部交付:§9 条件/列表渲染、§2 Document
> State 运行时、§3 API fetch、§4 表达式子语言扩展(`${}` 模板 + docState-in-
> expr)、§7 多页 preview iframe 联动、§8 RADIO/TEXTAREA/DATEPICKER/SWITCH
> 四个交互组件、§6 `layoutMode: 'FREE'` + `layoutPositioning: 'ABSOLUTE'`
> emit。本 doc 是 Phase 3 的 source of truth。**目前所有候选未锁定,以下列
> 出范围预期 + 优先级建议,实际开工前每条候选单独锁决定并扩写本 doc。**

---

## 1. 范围

### 1.1 Phase 3 In-Scope(候选,待逐条承诺)

> 形式同 Phase 2 §1.1。每条候选实际开工前必须用户在对话中挑定 → 回本 doc 把对应 §X stub 改写成「详细设计 + 锁定决定」格式 → 用户锁主决定 → ACK 次级默认 → 分 step commit + Tauri 实测。**不要自动开工任何候选**。

> 编号约定:**§1 = 范围(本节);候选从 §2 起编号**(对齐 Phase 2 `docs/lowcode-phase-2.md`)。

| # | 主题 | 优先级 | 简述 | 详写 |
|---|---|---|---|---|
| 1 | **Supabase 接入 / 数据库**(候选 §2) | 高 | Bubble 平台核心能力;在 Phase 2 §3 API fetch 基础上加 typed DB 客户端、表 schema、CRUD action、auth、row-level security;Supabase 官方 client(`@supabase/supabase-js`)+ anon key + RLS 架构正好匹配 lowcode 的 SPA emit 模型 | **🔒 关闭 2026-05-25**(详见 §2)|
| 2 | **AI 生成 / 编辑**(候选 §3) | 高 | tool surface only:补 lowcode 域 ToolDef(state / binding / event / supabaseConfig)让既有 chat / MCP / CLI 看见 lowcode 字段;narrow scope,不动 chat UX / system-prompt | **🔨 开工中**(详见 §3)|
| 3 | **多人协作打磨**(候选 §4) | 中 | 现有 Trystero + Yjs + y-indexeddb 已落底(`CLAUDE.md`);Phase 3 验证 lowcode 字段(`lowcode/state` / `bindings` / `events` / `interactiveProps` / `documentState` / `freeLayout` / `nodeType` / `renderCondition` / `supabaseConfig`)在协作下的 CRDT 收敛、preview iframe 跨用户同步、conflict UX | TBD §4 |
| 4 | **部署管线**(候选 §5) | 中 | 一键发布编译产物到 Vercel / Netlify / 自有 server;依赖 §2(Supabase 后端可指定 production URL)与 Phase 1 §11.4 的多页 emit | TBD §5 |
| 5 | **lowcode 字段升格 Kiwi schema**(候选 §6,**从 Phase 2 §5 推迟**)| 低 | §12 / §8 / §6 / §2 / 本期 §2 共 5 条 pluginData 旁路通道已稳定运行;升格成本高(fork vendored `kiwi-schema/` + 5 通道重写 + 老 .fig 迁移工具),收益仅工程债务清理。**Phase 3 重新评估**:产品层面无新功能解锁,除非协作 / AI 流程对 schema 一等字段位有刚需 | TBD §6(Phase 2 §5 stub 仍在 `docs/lowcode-phase-2.md` §5)|
| 6 | **响应式断点 / 容器查询**(候选 §7) | 中 | 当前单一布局,无 mobile/tablet 切换;评估 emit `@container` queries vs `md:` Tailwind 断点 vs Bubble 风格 device-specific layout 三条路径 | TBD §7 |
| 7 | **自定义组件 / Symbol 跨页复用**(候选 §8) | 中 | Phase 0 决定 #6 推迟到此;FRAME 标记为 symbol → 跨页 instance 同步;评估与 Figma component instance 体系的关系(沿用 vs 另起 lowcode-only 路径) | TBD §8 |
| 8 | **编译产物 i18n 实运行时**(候选 §9) | 低 | 当前编辑器侧 i18n 完整,编译产物 hardcode 中文 / 英文字面值;加 i18n runtime(react-intl / lingui / 自写)+ TEXT 节点多语言绑定 UI | TBD §9 |
| 9 | **工作流编排**(候选 §10) | 中 | 多步 ActionDef 链 + 条件分支 + 异步等待;Bubble 风格 "workflow" 概念,允许 onClick → fetch → setState → conditional navigate 的可视化编排 | TBD §10 |
| 10 | **Phase 2 §3.v2 fetch 加强**(候选 §11) | 低 | Phase 2 §3 锁定的次级默认:axios + auth header + loading/error state 自动管理;若 §2 Supabase 自带 client 处理了 80% fetch 场景,本条可彻底跳过 | TBD §11 |
| 11 | **Phase 2 §4.v2 表达式语言扩展**(候选 §12) | 低 | Phase 2 §4 锁定的次级默认:函数调用 / 数组字面量 / 对象字面量 / `&&` / `??`;由 §X 实际诉求驱动开 —— 比如 §10 工作流编排里需要表达 array 转换 / object spread | TBD §12 |
| 12 | **SWITCH CSS styling**(候选 §13) | 低 | Phase 2 §8 follow-up:SWITCH 当前用原生 `<input type="checkbox" role="switch">`,语义/可访问性正确但视觉是 plain checkbox(非 slider affordance)。加 CSS-only switch styling 至 emit 端(保持零依赖),或纳入 Phase 3+ component theme layer | TBD §13 |

> **优先级建议**:§2(Supabase)+ §3(AI 生成)是产品层面跳跃最大的两条,做完 lowcode 平台真正具备 Bubble 等价能力;§4(协作)是已有基础设施验证,工作量中等;§5(部署)依赖 §2。§6–§13 视产品节奏挑做。

### 1.2 Phase 3 Out-of-Scope(明确推迟到 Phase 4+)

- **多租户 / 多 workspace** —— Phase 3 假设单租户;Bubble.io 风格的 workspace + member + billing 留 Phase 4
- **付费用户系统(平台层)** —— 不同于 §1 Supabase auth(应用层用户);平台自身的订阅 / 计费留 Phase 4
- **AI 自动 debug / 修复** —— §2 限定 "生成 / 编辑",不含运行时 AI agent
- **可视化数据流编辑器** —— §9 工作流编排限定 ActionDef 链;Bubble Flow-style 节点 DAG 编辑器留 Phase 4
- **手机原生导出**(iOS / Android) —— 当前 emit 只 React/Web;React Native / Capacitor / Tauri Mobile 留 Phase 4
- **插件系统 / Marketplace** —— 自定义节点类型 / 自定义 action 加载 .pen 之外,留 Phase 4

### 1.3 Phase 3 整体成功标准(粗框,逐 § 细化)

整 Phase 3 需要满足:

1. 本 doc §1.1 中所有承诺的子项各自 §X.5 成功标准全过。
2. 不破坏 Phase 0 / Phase 1 / Phase 2 任一 §X.3 / §X.5 锁定的成功标准 —— 旧 demo / 旧 .fig 行为不变。具体见每个候选所列既往锁定清单。
3. `bun run check` 全绿。
4. `bun test ./tests/engine/compiler/` + `bun test ./tests/engine/kiwi/lowcode/` + `bun test ./tests/engine/scene-graph/is-auto-layout-mode.test.ts` 全绿(以及候选新增的 `cross-walker/` / `preview/` 测试集)。
5. 每个承诺子项都有 Tauri 用户实测(用户主导,不自己宣告通过)。

### 1.4 Phase 3 继承的经验(从 Phase 1 + Phase 2 沉淀,直接复用)

| 经验 | 内容 |
|---|---|
| **A. Walker 漏 case(union widening)** | 加新 `IRNode` / `BindingExpr.kind` / `ActionDef.kind` / `IREventHandler.kind` / `ExprAst.kind` / `NodeType` / `Tool` / `LayoutMode` 时,grep 全文 `node.kind` / `.kind ===` / `node.type` / `case '` / `field === '字面值'`,verify 每个 walker / switch 显式处理。`Record<Tool>` / `Record<NodeType>` 穷举表 tsgo 强制;`default`-兜底 switch + scalar equality 都**不**报错,要 step 末手动核 + 写跨 walker 回归 + **至少 grep 两轮**(§6 round 1 抓 18 处,round 2 又找出 7 处) |
| **B. Tauri 拖拽** | 不动 `desktop/tauri.conf.json` 的 `dragDropEnabled: false`(`@atlaskit/pragmatic-drag-and-drop` + 任何 webview HTML5 drag UX 全靠它) |
| **C. JSON/expr parse 不 swallow** | 默认值 / body / URL 模板等输入,parse 失败要 surface 红框 + 10px error line,不静默回退 |
| **D. emit 产物的新 npm import** | emit 出来的代码若 `import` 新 npm 包,必须同步加进 `packages/compiler` devDependencies —— preview dev-server 从 monorepo hoisted `node_modules` 解析裸 import。漏了则 CLI/单测全绿、preview 白屏。加「该包能 resolve」回归断言。§4 / §6 / §7 / §8 靠「全原生 / 零依赖」决定规避了本经验。Phase 3 §1(Supabase client)、§2(AI SDK)、§4(部署 SDK)、§6(响应式 polyfill)、§8(i18n runtime)直接吃这条 |
| **E. 跨 §X 能力链** | 横跨多个 §X 的能力,要在设计阶段核对每段接口已存在 —— 设计 doc 列一行「读写两端接口核对」(Phase 2 §4.1 有范例)。§7 用 `derivePagePaths` 跨 compiler / editor 全凭这一行预查。Phase 3 §1+§2(AI 生成 Supabase 调用)、§4+§1(部署带 Supabase URL)、§9 工作流编排几乎跨所有现有 §X,本经验必用 |
| **F. 别全仓 `bun run format`** | `bun run format` 会重排整个仓库(~140 文件 pre-existing 格式漂移)。只在自己改的文件上验格式;若 format 污染了无关文件,`git checkout` 掉非本任务文件 |
| **G. union widening → helper-first** | 任何向现有 union 加变体的 §X(`LayoutMode` 加 FREE / `NodeType` 加 X / `ActionDef.kind` 加 X)**先引 `isXxx`-类 helper 再 sweep callsite**。否则 `=== '字面值'` 在 tsgo 下永远合法,变体加完每个旧 callsite 默默漏 —— 唯一可靠 mitigation 是 helper-first + 双轮 grep + cross-walker 回归。sub-lesson:`LintNode` / `LayerNode` 等故意「松散 string」类型在 sweep 时会断,**紧化到真 union 是最干净的修法**(构造端已喂真值,零运行时变化) |
| **H. UX 显示元素 vs 后台同步** | 任何跨双向同步的功能,设计阶段就列「面向用户的显示元素清单 + 状态来源」核对表 —— UX「停在某个值」类 bug 不在 walker checklist 不在 cross-walker 覆盖范围内,只能 Tauri 实测发现。Phase 3 §3(协作)、§2(AI 流式生成)、§9(工作流编排实时状态)直接吃这条 |
| **I. emit 完 + 单测全绿 ≠ 跑得起来(module-resolve 维度)** | 涉及新 export / 新 import / 新 ALL_TOOLS 注册的 emit 或 tool 改动,cross-walker test 必须包含「import 行 / 注册行 存在 vs 不存在」的正负断言 —— 仅 grep call-site 字符串会漏 module 解析裂缝。来源:Phase 3 §2 step 5b `183e6fc` —— `emit/event.ts` 写 `getSupabaseClient().from(...)` 进 page body,scaffold 端漏配 `import { getSupabaseClient } from '<path>'`,unit + cross-walker call-site 字符串全绿,Tauri `bun run dev` ReferenceError 才暴露。两次实证:Phase 3 §2 step 5a + §3 step 4 cross-walker 都把 import-line 正负断言写进 test 顶层。**经验 D 守 dep-resolve 维度**(npm 包能否被 resolve),**本经验守 module-resolve 维度**(import 行 / 注册行是否实际被 emit / scaffold / registry 写出),两条并行 |

### 1.5 测试 / 验证命令

每个 step commit 前跑:

```sh
bun test ./tests/engine/compiler/
bun test ./tests/engine/kiwi/lowcode/
bun test ./tests/engine/scene-graph/is-auto-layout-mode.test.ts
bun run check
```

**不要**跑整个 `./tests/engine/`(15+ 分钟 + LFS 慢测 + 已知 pre-existing 失败):
- `kiwi/serialize-fixes/line/height.test.ts:44` —— 跟 lowcode 工作无关
- `tests/engine/scene-graph/plugin-data.test.ts` `preserves plugin relaunch data from imported fig files` —— LFS fixture 类失败,§6 step 1 期间确认在基线 baseline 上同样挂(`git stash` 后挂),非 lowcode 回归

IDE 偶发报 `Cannot find module '@open-pencil/...'` / `#core/...` / `#compiler/...` / `#tests/helpers/scene` 是 LSP moduleResolution 噪音 —— 以 `bunx tsgo --noEmit` 和 `bun run check` 为准。

### 1.6 不要做的(Phase 0 / 1 / 2 锁定继承)

- 改 main 分支;`git push --force`;动 `tests/fixtures/*.fig` 的 LFS pointer
- 撤销 Phase 0 §8 / Phase 1 §1(除 §1.5 #3 + #5 已被 Phase 2 §6 推翻外)§5 §7.3 §7.4 §10.3 §11.3(除 #5 已被 Phase 2 §7 推翻外)§12.3 / Phase 2 §9.2 §2.2 §3.2 §4.2 §6.2 §7.2 §8.2 任一锁定决定
- 改 `packages/core/src/kiwi/kiwi-schema/`(vendored;Phase 3 §6 候选评估这条锁要不要推,**不要自动改**)
- 改 pluginData key 前缀(`lowcode/state` / `bindings` / `events` / `interactiveProps` / `renderCondition` / `documentState` / `nodeType` / `freeLayout` / `supabaseConfig`)或 `OPEN_PENCIL_PLUGIN_ID`
- 改 `ActionDef.kind` 字面值(`setState` / `navigate` / `setVariable` / `apiCall` / **`supabaseQuery` / `supabaseMutation`**)、emit 公开 runtime 符号名(`useDocState` / `setDocState` / `getDocStateSnapshot` / **`getSupabaseClient` / `useSupabaseAuth`**)、bridge 协议 `source` 字面值(`op-lowcode-editor` / `op-lowcode-preview`)或 message `type` 字面值(`'select'` / `'navigate'`)—— 老 .fig / 产物兼容 + iframe ↔ editor 兼容
- 改既有 10 个交互组件(BUTTON/INPUT/CHECKBOX/FORM/LIST/SELECT + RADIO/TEXTAREA/DATEPICKER/SWITCH)的 NodeType / 默认值 / emit
- 改 `LayoutMode` 字面值(`'NONE'` / `'HORIZONTAL'` / `'VERTICAL'` / `'GRID'` / `'FREE'`)或 `isAutoLayoutMode` helper 的窄集合(`'HORIZONTAL' | 'VERTICAL' | 'GRID'`)
- 改 `parentIsFreeLayout` 字段名 / `nodeIcon` / `LintNode.layoutMode` / `LayerNode.layoutMode` 的 `LayoutMode` 紧化类型
- 全仓跑 `bun run format`(经验 F)
- 在测试里跑 `bun test ./tests/engine/`(整套慢且有 2 处 LFS pre-existing 失败)
- **自动开工任何候选 —— 必须用户先挑**

---

## 2. §2 详细设计:Supabase 接入 / 数据库

> 2026-05-24 用户挑定 Phase 3 第一项开工。形式参照 Phase 2 §6 / §7 / §8。
> **8 项主决定 + 10 项次级默认 2026-05-24 已由用户在对话中一次性锁定**。
> **本节是 Phase 3 第一个落点 —— lowcode 平台首个 backend 接入**;Bubble parity 的核心缺口由此起步。
>
> **状态:🔨 开工中**(step 1–5)。

### 2.1 现状与问题

Phase 2 §3 落了通用 `apiCall`(REST + fetch + setDocState),但 lowcode 平台仍**无 backend**:用户做出来的 app 既不能持久化数据、也没有用户系统、更没有权限模型。Bubble、Glide、Adalo 三家 lowcode 龙头都自带数据库 + auth 一等公民,缺这一块 lowcode 平台只能做 demo,无法上线真实 app。

**为什么选 Supabase**:

| 维度 | Supabase | 替代候选(简评) |
|---|---|---|
| Backend | PostgreSQL(open)+ auth + storage + realtime | Firebase(闭源,vendor lock-in)、PocketBase(轻量但功能少)、Appwrite(类比但生态小) |
| Client | 官方 `@supabase/supabase-js` typed query builder + auth + realtime + storage 全集 | Firebase JS SDK(类比);其他需自写 |
| 部署模式 | self-host OSS 或 cloud;anon key + RLS 架构正好匹配 lowcode emit 的 SPA 模型(全静态前端 + anon key) | Firebase 也支持但 RLS 不如 PostgreSQL RLS 灵活 |
| 与现有 §3 关系 | apiCall 是通用 REST,Supabase 是 typed 专用 → 互补 | (N/A)|

**§2 不做 / 留 §2.v2**:

- typed schema 探测(表名 / 列名自动补全):静态文本输入起步,探测留 §2.v2
- realtime 订阅(row 变更推送 → docState 自动同步):留 §2.v2
- OAuth / magic link / password reset / email confirm:留 §2.v2
- Storage(文件上传):留 §2.v2
- raw SQL(`rpc()`):明确不做(SQL 注入风险 + 偏离 typed 路线)

### 2.2 关键决定

> 形式同 Phase 2 §6.2 / §7.2 / §8.2。**#1–#8 已锁(2026-05-24 对话);#a–#j 为次级默认,用户 2026-05-24 一次性 ACK 入锁。**

| # | 主题 | 决定 | 理由 |
|---|---|---|---|
| 1 | SDK 选择 | 官方 `@supabase/supabase-js` | typed query builder + auth + realtime / storage 内部模块全集;走 fetch 等于自己重写 client。**吃经验 D**(new npm import → `packages/compiler` devDeps + resolve 回归)|
| 2 | 连接配置存储 | `lowcode/supabaseConfig: { url, anonKey, schema? }` pluginData 旁路 + Properties panel "Connect Supabase" + "Test connection" 按钮 | anon key 公开是 Supabase 设计如此(RLS 在 DB 层兜底);service_role key 永不入 .fig / pluginData / emit / git。沿用 §12 / §2 / §6 / §8 已稳定的 pluginData 旁路通道,零 vendored kiwi 改动 |
| 3 | Action 形态 | 拆两 kind:`ActionDef.kind: 'supabaseQuery'`(read,SELECT)+ `'supabaseMutation'`(write,INSERT/UPDATE/DELETE/UPSERT)| read 可缓存 / 可订阅 / 不需 confirm;write 需 form binding + 错误 UI。两 kind 在 EventsPanel 不同表单 |
| 4 | Schema 探测 | 静态文本输入(table name / column name 手填)+ "Test query" 按钮验证;探测留 §2.v2 | narrow scope(Phase 2 §3 / §4 / §6 都靠 narrow scope 一次过 Tauri)|
| 5 | Auth 集成 | 同 §2 加最小 auth 三件套:`signIn(email, pwd)` / `signOut()` / `$currentUser` 内置 docState 自动同步 session | Bubble 类应用 80% 需登录,缺 auth 等于 demo 都跑不通。OAuth / magic link 留 §2.v2 |
| 6 | Realtime 订阅 | 推迟到 §2.v2 | 设计成本高(订阅 → docState 自动同步 → preview iframe 双向),早期应用不需要 |
| 7 | Loading / Error state | 沿用 §3 锁定:不自动管理,query/mutation 结果写用户指定 docState(`resultTarget` + `errorTarget`),loading 用户自己 boolean docState 切 | 一致性 > 自动魔法;同 §3 EventsPanel UX 心智 |
| 8 | RLS 与数据安全 | 编辑器不代理 RLS,假设用户在 Supabase 端配 RLS;编辑器仅读 metadata。文档化「不配 RLS = 全表裸奔」警告(决定 #j)| RLS 是 Supabase 核心机制;代理 = 安全噩梦 |
| a | emit 文件名 | `src/_lowcode_supabase.ts`(镜像 `_lowcode_state.ts`,仅当文档有 supabaseConfig 时 emit)| 沿用 §2 命名 |
| b | pluginData key 字面值 | `lowcode/supabaseConfig`,schema `{ url: string; anonKey: string; schema?: string }`,`schema` 缺省 `'public'` | (-) |
| c | `ActionDef.kind` 字面值 | `'supabaseQuery'` / `'supabaseMutation'` | (-) |
| d | runtime 公开符号名 | `getSupabaseClient()`(singleton 工厂)+ `useSupabaseAuth()`(返回 `{ user, signIn, signOut }`)| 同 §2 `useDocState` / `setDocState` 命名风格 |
| e | `$currentUser` 内置 docState schema | `{ id: string \| null; email: string \| null; signedIn: boolean }`;模块初始化时 `supabase.auth.getSession()` 填充 + `onAuthStateChange` 监听同步 | 窄而稳;`$` 前缀防止与用户 docState 冲突 |
| f | connection-test 错误 UI | 经验 C:Properties 面板 inline 红 banner 显示 Supabase 原始 error;不静默回退;状态 dot 灰 / 绿 / 红 | 同 §2 / §3 红框 + 10px error line 心智 |
| g | `packages/compiler` 加 npm 包 | 仅 `@supabase/supabase-js`(auth / realtime / storage / postgrest 都是内部模块,不分包)→ devDependencies;`preview-supabase-resolvable.test.ts` 回归 | 单一包,bundle size 由 emit 端 tree-shake |
| h | client 实例化 lifecycle | emit 端 `_lowcode_supabase.ts` 模块作用域 `createClient(url, anonKey)` 单例(首次 import 创建);跨页共享;auth session 走 supabase-js 默认 localStorage(刷新保持登录)| Tauri webview 支持 localStorage |
| i | SQL 安全 | 强制走 supabase-js query builder API;**不**暴露 raw SQL `.rpc()`;emit 不生成 raw SQL 字符串 | 自然规避 SQL 注入 |
| j | RLS 警告可见性 | 用户首次成功 connect 时一次性 toast「**Supabase RLS is required** —— configure Row Level Security in your Supabase dashboard before going to production. Without RLS, anyone with your anon key can read/write all your data.」+ Properties supabaseConfig 区永久 inline note + doc 链接 | RLS 未配 = 安全裸奔 |

### 2.3 公开 API / Schema 改动

**SceneNode(root CANVAS / document-level)**:

```ts
// packages/core/src/scene-graph/types.ts
export interface SupabaseConfig {
  url: string;        // https://xxx.supabase.co
  anonKey: string;    // 可公开 OK,RLS 在 DB 层兜底
  schema?: string;    // 缺省 'public'
}

// SceneNode 加(仅 root CANVAS 写入)
lowcodeSupabaseConfig?: SupabaseConfig;
```

**`ActionDef` union 加两 kind**:

```ts
// packages/core/src/scene-graph/types.ts
export interface SupabaseQueryAction {
  kind: 'supabaseQuery';
  table: string;
  columns?: string;           // 缺省 '*'
  filters?: SupabaseFilter[];
  single?: boolean;           // .single() vs 数组
  resultTarget: string;       // docStateName
  errorTarget?: string;       // docStateName
}

export interface SupabaseMutationAction {
  kind: 'supabaseMutation';
  operation: 'insert' | 'update' | 'delete' | 'upsert';
  table: string;
  payloadExpr?: ExprAst;      // insert / update / upsert 的 payload
  filters?: SupabaseFilter[]; // update / delete 的 where
  resultTarget?: string;
  errorTarget?: string;
}

export interface SupabaseFilter {
  column: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in';
  valueExpr: ExprAst;
}

export type ActionDef =
  | SetStateAction
  | NavigateAction
  | SetVariableAction
  | ApiCallAction
  | SupabaseQueryAction      // 新
  | SupabaseMutationAction;  // 新
```

**Emit runtime(`src/_lowcode_supabase.ts`,仅当 supabaseConfig 存在时 emit)**:

```ts
import { createClient } from '@supabase/supabase-js';
import { setDocState, useDocState } from './_lowcode_state';

let _client: ReturnType<typeof createClient> | null = null;
export function getSupabaseClient() {
  if (!_client) _client = createClient(URL, ANON_KEY);
  return _client;
}

const supabase = getSupabaseClient();

// 启动时同步一次 + 持续监听
supabase.auth.getSession().then(({ data: { session } }) => {
  setDocState('$currentUser', toCurrentUser(session));
});
supabase.auth.onAuthStateChange((_event, session) => {
  setDocState('$currentUser', toCurrentUser(session));
});

function toCurrentUser(session) {
  return {
    id: session?.user.id ?? null,
    email: session?.user.email ?? null,
    signedIn: !!session,
  };
}

export function useSupabaseAuth() {
  const user = useDocState('$currentUser');
  return {
    user,
    signIn: (email: string, password: string) =>
      supabase.auth.signInWithPassword({ email, password }),
    signOut: () => supabase.auth.signOut(),
  };
}
```

**pluginData**:`lowcode/supabaseConfig`(经 §12 pluginData 旁路 + `LOWCODE_PLUGIN_KEYS` 控写端)

**`$currentUser` docState 自动注册**:仅当 supabaseConfig 存在时,IR collect 端自动把 `$currentUser` 注册进 `docStateDefs`(type `'object'`,defaultValue `{ id: null, email: null, signedIn: false }`);用户 docState 命名验证(`validateStateName`)加 reject `^\$` 规则(`$` 保留前缀)。

**npm**:`@supabase/supabase-js` 进 `packages/compiler` package.json devDependencies(同 §2 zustand / `react` / `react-dom` 路径);`preview-supabase-resolvable.test.ts` 钉死 monorepo hoisted node_modules 能 resolve。

### 2.4 内部实现拆解

| 路径 | 改动 |
|---|---|
| `packages/core/src/scene-graph/types.ts` | `SupabaseConfig` / `SupabaseQueryAction` / `SupabaseMutationAction` / `SupabaseFilter` 接口;`ActionDef` union 加两 kind;`SceneNode.lowcodeSupabaseConfig?` 字段 |
| `packages/core/src/scene-graph/lowcode/plugin-data.ts` | `lowcode/supabaseConfig` key 进 `LOWCODE_PLUGIN_KEYS`;serialize / deserialize hook;JSON encode |
| `packages/core/src/scene-graph/lowcode/validate.ts` | `validateStateName` 加 `^\$` 拒绝(`$` 是保留前缀)|
| `packages/compiler/src/collect/bindings.ts` | `resolveActions` 加 `case 'supabaseQuery'` + `case 'supabaseMutation'`;新 `IRSupabaseQueryHandler` / `IRSupabaseMutationHandler` 进 `IREventHandler` union(`never`-exhaustive,couples collect+emit per Phase 2 §3 pattern);auto-register `$currentUser` 进 `docStateDefs` 当 root 有 supabaseConfig 时 |
| `packages/compiler/src/emit/event.ts` | 两新 handler 的 emit:supabaseQuery → `const { data, error } = await supabase.from(...).select(...).eq(...)...; setDocState(...);`;supabaseMutation 同形态;async 风格沿用 §3 apiCall |
| `packages/compiler/src/adapters/react/lowcode-supabase.ts` | 新文件:生成 `_lowcode_supabase.ts` template(client singleton + auth integration);仅 root supabaseConfig 存在时 emit |
| `packages/compiler/src/adapters/react/index.ts` | 条件 emit `_lowcode_supabase.ts` 文件 + 向 `package.json` 注入 `@supabase/supabase-js: ^2.x`(同 zustand 注入路径) |
| `packages/compiler/src/walk/ir-walk.ts` | 两新 handler kind 通过 `{...ir}` spread 自然继承(同 §2 docState 字段);walker checklist 验证 |
| `src/components/properties/SupabaseConfigPanel.vue` | 新组件:root CANVAS no-selection 分支显示;"Connect Supabase" 折叠区 + URL / anonKey / schema(可选)输入 + "Test connection" 按钮 + 状态 dot + 错误 banner + RLS 永久 note + 首次 connect toast(经验 C/H)+ service_role key 检测拒绝 |
| `src/app/lowcode/DesignPanel.vue` | root no-selection 分支挂载 SupabaseConfigPanel(在 DocumentStatePanel 之前)|
| `src/components/properties/EventsPanel.vue` | 加 supabaseQuery / supabaseMutation 两 ActionDef kind 的 UI;query 表单:table / columns / filters / single? / resultTarget / errorTarget;mutation 表单:operation / table / payloadExpr / filters(update/delete) / resultTarget / errorTarget;inline validation(table / column 非空)|
| `src/components/properties/AuthControls.vue` | 新组件:EventsPanel quick-actions 区 "signIn (email pwd)" / "signOut" 一键插入对应 handler |
| `packages/vue/src/i18n/messages.ts` + 7 locales | `panels.supabaseConfig*` / `panels.supabaseConnect*` / `lowcodeActionSupabaseQuery` / `lowcodeActionSupabaseMutation` / `lowcodeAuthSignIn` / `lowcodeAuthSignOut` / `lowcodeRlsWarning*` / `lowcodeServiceRoleReject*` 等 |
| `tests/engine/kiwi/lowcode/plugin-data.test.ts` | `supabaseConfig` 持久化往返测试;字节级 .fig 回归 |
| `tests/engine/compiler/supabase-query-emit.test.ts` | query 各种 op + single + filter 组合的 emit 单测 |
| `tests/engine/compiler/supabase-mutation-emit.test.ts` | mutation 四种 operation 的 emit 单测 |
| `tests/engine/compiler/supabase-auth-emit.test.ts` | useSupabaseAuth + $currentUser 自动注册的 emit 单测 |
| `tests/engine/compiler/preview/preview-supabase-resolvable.test.ts` | 经验 D 回归:`@supabase/supabase-js` 从 monorepo hoisted 能 resolve |
| `tests/engine/compiler/cross-walker/supabase.test.ts` | cross-walker:两新 handler kind + $currentUser docState 在 ir-walk / collectClassNames / nodeHasNavigate / stripNode 等所有 walker 不漏 |

### 2.5 成功标准

1. `bun test ./tests/engine/compiler/` 全绿;新增 5 个 supabase-* 测试文件
2. `bun test ./tests/engine/kiwi/lowcode/` 全绿;新增 `supabaseConfig` 往返 + 字节级回归
3. `bun run check` 全绿(jscpd 0 clones、Steiger pass)
4. **Tauri 实测(用户主导)7 项 user-ACK**:
   1. **连接配置**:Properties → "Connect Supabase" 输入 URL + anonKey → "Test connection" → 绿色 dot;error case 红 banner
   2. **`.fig` 存读回**:supabaseConfig(url + anonKey + optional schema)保留;service_role key 永不出现在任何 pluginData / emit / `.fig`
   3. **supabaseQuery emit + 执行**:onClick 触发 `from('table').select('*')` → result 写入用户指定 docState → TEXT binding 显示数据
   4. **supabaseMutation emit + 执行**:Form submit INSERT → Supabase dashboard 看到 row 创建;UPDATE / DELETE 同理
   5. **Auth signIn / signOut 流**:`$currentUser.signedIn` 从 false → true → false;`renderCondition` 在登录态切换时切换显示
   6. **跨页 client 单例**:多页文档 navigate 切页,`getSupabaseClient()` 不重复实例化(console 不双 init log),`$currentUser` session 持续
   7. **零回归**:不连 Supabase 的旧 demo `.fig` 行为不变(无 `_lowcode_supabase.ts` emit、`package.json` 无 supabase-js 注入、bundle size 不增)
5. 不破坏 Phase 0 §8 / Phase 1 §1(除 §1.5 #3+#5)§5 §7.3 §7.4 §10.3 §11.3(除 #5)§12.3 / Phase 2 §9.2 §2.2 §3.2 §4.2 §6.2 §7.2 §8.2 任一锁定决定

### 2.6 工作分解(建议 1 名工程师,5–6 天)

| Step | 任务 | 验收 / commit message |
|---|---|---|
| 1 | schema:`SupabaseConfig` / `SupabaseQueryAction` / `SupabaseMutationAction` / `SupabaseFilter` interface;`ActionDef` union 加两 kind;`SceneNode.lowcodeSupabaseConfig?`;`lowcode/supabaseConfig` pluginData hook + `LOWCODE_PLUGIN_KEYS`;`validateStateName` 拒 `^\$`;持久化往返 + 字节级回归测试 | `bun test ./tests/engine/kiwi/lowcode/` 全绿;`bun run check` 全绿;`feat(lowcode): step 1 — Supabase schema + supabaseConfig persistence (§2 Phase 3)` |
| 2 | compiler:`IRSupabaseQueryHandler` / `IRSupabaseMutationHandler` 进 `IREventHandler` union;`resolveActions` 加两 case;`emitEventHandler` 写两 kind 的 async emit;auto-register `$currentUser` 当 root supabaseConfig 存在;`@supabase/supabase-js` 进 `packages/compiler` devDeps + `preview-supabase-resolvable.test.ts` 回归 | `bun test ./tests/engine/compiler/` 全绿;`bun run check` 全绿;`feat(lowcode): step 2 — Supabase IR + emit + preview resolve (§2 Phase 3)` |
| 3 | runtime:`adapters/react/lowcode-supabase.ts` template + React adapter 条件 emit `_lowcode_supabase.ts` 文件 + `package.json` 注入 supabase-js;`useSupabaseAuth` + `$currentUser` auth-state 同步 emit;`supabase-auth-emit.test.ts` 单测 | `bun test ./tests/engine/compiler/` 全绿;`bun run check` 全绿;`feat(lowcode): step 3 — Supabase runtime + auth emit (§2 Phase 3)` |
| 4 | editor UI:`SupabaseConfigPanel.vue`(URL/anonKey/schema 输入 + Test connection 按钮 + 红 banner + RLS 永久 note + 首次 toast + service_role 检测拒绝);`DesignPanel.vue` no-selection 分支挂载;`EventsPanel.vue` 加 supabaseQuery / supabaseMutation 两表单;`AuthControls.vue` signIn/signOut quick-actions;i18n×12 词条 + 7 locale | `bun run check:vue` + `check:i18n` 全绿;`feat(lowcode): step 4 — Supabase editor UI + i18n (§2 Phase 3)` |
| 5 | walker checklist(经验 A + G:`IREventHandler.kind` 加两枚 → grep 所有 handler walker;`ActionDef.kind` 加两枚 → grep 所有 action switch;`$currentUser` reserved → docState walker 不应被用户重定义)+ `cross-walker/supabase.test.ts` 跨场景回归 + Tauri 实测准备 | 用户 ACK 7 项 Tauri 全过;`docs(lowcode): §2 Phase 3 Tauri verification` |

### 2.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 经验 D —— `@supabase/supabase-js` 未进 `packages/compiler` devDeps → preview iframe 白屏 | 高 | 决定 #g + step 2 `preview-supabase-resolvable.test.ts` 钉死 |
| supabase-js bundle size(~70 KB gzipped + tree-shake 后 ~30 KB)→ 旧 demo 编译体积膨胀 | 低 | emit 仅在 root 有 `supabaseConfig` 时引入 `_lowcode_supabase.ts` + 注入 package.json,无 config 文档零变化(Tauri 实测 #7)|
| Tauri webview localStorage 行为差异 → auth session 不持久化 | 中 | step 5 Tauri 实测专项验:刷新 preview iframe 后 `$currentUser.signedIn` 仍 true |
| RLS 未配置 → 用户 anon key + 全表 access 上生产 = 数据裸奔 | **高(安全)** | 决定 #j:首次 connect 一次性 toast + Properties 永久 inline note + doc 链接;UI 文案明确「**before going to production**」|
| `$currentUser` 名字冲突(用户也想叫这个)| 低 | 决定 #e + step 1 `validateStateName` 拒 `^\$`(`$` 保留前缀);旧文档若有 `$currentUser` 用户 docState,IR collect 时 warn + skip 用户的,走自动注册版 |
| service_role key 用户误填进 anonKey 输入框 → 暴露在 .fig / git | 中 | step 4 SupabaseConfigPanel "Test connection" 按钮检测 key 类型(service_role JWT 有 `role: "service_role"` claim,可解析),若是则 hard-reject 并红 banner 提示「This is a service_role key, NEVER enter it here. Use anon (public) key.」|
| 经验 A —— `IREventHandler.kind` 加两枚 → 若 ir-walk / cross-walker / collectClassNames / nodeHasNavigate / stripNode 等 walker 漏 case → preview 跑不到新 handler | 高(经验 A 经典)| 决定 #c + step 5 walker checklist 二轮(round 1 = step 2 设计时;round 2 = step 5 sweep)+ `cross-walker/supabase.test.ts` 钉死 |
| `ActionDef.kind` 加两枚 → EventsPanel switch / 其他 panel 漏 → UI 看不到 / 切别的 action 串味 | 中 | 决定 #c + step 4 末尾 grep `case '` / `ActionDef.kind` 全仓;tsgo `Record<ActionDef['kind']>` 类型表强制(已有)|
| 经验 E —— Supabase + docState + LIST + renderCondition + apiCall 多 §X 联动 | 中 | 设计阶段已列接口核对:supabaseQuery `resultTarget` → docState(§2 已存在)→ LIST `dataSourceRef='docStateRef'`(Phase 2 §3 已补)→ TEXT `kind:'docState'`(§2 已存在);现成路径无新接口需求 |

### 2.8 Post-mortem

🔒 **§2 关闭 2026-05-25**(设计 2026-05-24,实施 + Tauri 实测 2026-05-24~25)。

#### Commit 链(从设计到收尾,共 10 个)

| Commit | Step | 内容 |
|---|---|---|
| `d623529` | 设计 | §2 详细设计 + 8 主决定 + 10 次级默认锁定 |
| `556fd35` | 1 | schema + persistence:`SupabaseConfig` / `SupabaseQueryAction` / `SupabaseMutationAction` / `SupabaseFilter`;`SceneNode.lowcodeSupabaseConfig?`;pluginData 旁路 + `validateStateName` reject `^\$`;16 case 测试 |
| `48bb0e1` | 2 | compiler IR + emit + preview-resolve;`@supabase/supabase-js@^2.100.0` 进 `packages/compiler` devDeps;31 case 测试 |
| `1628915` | 3 | `_lowcode_supabase.ts` runtime template + 条件 emit + `useSupabaseAuth` + `$currentUser` auth-state 同步;`IRTree.supabaseConfig` + `IRSupabaseConfig` IR-local mirror(守 `adapters/** ↛ core/scene-graph` arch 边界);12 case 测试 |
| `cbc7b5f` | 4 | editor UI:`SupabaseConfigPanel.vue` + `EventsPanel.vue` 加 2 kind 表单 + filter list editor + `AuthControls.vue`(info-toast shim,真 onClick 推 §2.v2);33 新 `panels.*` i18n key × 7 locale |
| `a84ff02` | 5a | walker checklist 二轮 sweep(emit/event.ts `never` exhaustive switch + recordWrites + dispatchAction + EventsPanel.errorsFor 全覆盖)+ `cross-walker/supabase.test.ts` 6 场景回归 |
| `75ac999` | 5b fix | Test connection endpoint:`/rest/v1/` → `/auth/v1/settings` + surface response body |
| `00ca198` | 5b fix | service_role banner reactivity:`anonKeyTyped` local ref 驱动 banner / red border / disable,绕开 `buildPatch` 拒持久化导致 committed 值不变的反应链断路 |
| `183e6fc` | 5b fix | emit `import { getSupabaseClient } from '<path>'` 进 page module —— step 3 漏配的 page-side import 接线,unit + cross-walker 全测call site string 不查 import 行所以一直绿,Tauri 实测 #3 才暴露 |
| (本 commit) | 5b doc | §2.8 post-mortem + 关闭 §2 |

#### Walker checklist 轮次

- **Round 1**(step 2 设计时):`IREventHandler.kind` / `ActionDef.kind` 加两枚 → grep 所有 switch / Record map / handler 走访点,补 case
- **Round 2**(step 5a sweep):再走一遍。`emit/event.ts` 的 `never` exhaustive switch + `recordWrites` + `dispatchAction` + EventsPanel `errorsFor` switch 都验过,**当时报「无 miss」**
- **Round 2 漏点(本期暴露)**:cross-walker test 验了 emit 走到了 `getSupabaseClient().from(...)` 字符串,但**没验 page module 顶部有 `import` 行**。step 3 写了 runtime 文件出口符号,scaffold 端没接 import 进 page。Walker 思维只覆盖了「用了哪些 kind」,没覆盖「emit 出来的代码是否引用得到符号」—— 这是 **walker checklist 的视角盲区**:框架是 kind / switch 维度的,接线 / module 解析维度需要另一类 emit-runtime smoke test 钉(本期已补:cross-walker 新加 3 条 import-line 断言,正负各一)

#### Tauri 实测 7 项 ACK 结果

| # | Check | 结果 |
|---|---|---|
| 1 | 连接配置 UI(URL / anonKey / Test connection 绿 dot + 红 banner + service_role 拒绝) | ✅ 修两次:endpoint 换 + surface body(`75ac999`)|
| 2 | .fig 存读回 supabaseConfig + service_role 永不入 .fig | ✅ A 持久化 + B 红 banner(修反应链,`00ca198`)+ C .fig 干净 |
| 3 | supabaseQuery emit + 执行 | ✅ 修一次:补 page-side `getSupabaseClient` import(`183e6fc`)|
| 4 | supabaseMutation INSERT → Supabase Dashboard 看到行 | ✅ 复用 #3 的 import 修,直接 work。**UPDATE / DELETE / UPSERT closure gap**:代码 + 单测 + IR collect 三层验过(`emit/event.ts:109-126` 全四 op 都有 chain;`ir/collect/supabase.test.ts:214/234` reject malformed update/delete;`emit/supabase-mutation.test.ts` `BASE(operation)` 参数化覆盖),emit chain 形 + import 接线与 INSERT 同;**Tauri 未单独跑**,推断 work,严格意义算 closure 残留 → 已加入 §3 step 5 实测 #9-#11 顺手补 |
| 5 | Auth signIn / signOut 流 | ❌ **SKIPPED**(KNOWN-LIMITATION,2026-05-24 用户 ACK)—— AuthControls 是 info-toast shim;runtime `useSupabaseAuth()` 已就位但无 ActionDef.kind 把 hook 调用绑到 onClick(锁定 6 个 kind,改要走 §2.v2),要让用户在 emit 出来的 React 项目里手写代码才能调用 |
| 6 | 跨页 client 单例(navigate 切页 `getSupabaseClient()` 不重复 init) | ✅ Network 验:GoTrue 初始化仅一次,navigate 后不新增 init |
| 7 | 零回归(无 supabaseConfig → 旧 demo `_lowcode_supabase.ts` + supabase-js dep + page import 都不出现) | ✅ 测试层验(`supabase-auth-emit.test.ts` + `cross-walker/supabase.test.ts` 各两条负向断言),419/419 全绿 |

#### Bundle size 实测(supabase-js@2.100.1)

- UMD raw:`184 KB`
- UMD gzipped:`47 KB`
- ESM entry:`24 KB` raw(tree-shake 后实测 vite build 估在 30 KB gzipped 量级)

§2.7 风险表里写「~70 KB gzipped + tree-shake 后 ~30 KB」—— UMD gzipped 47 KB 比预期略低;tree-shake 估计与上次基本符。零回归路径(无 supabaseConfig)产物**完全不含** supabase-js,bundle 不增。

#### Surprises(没在风险表 / walker checklist 里事先预见的)

1. **经验 H 实证 —— Supabase PostgREST `/rest/v1/` 根 endpoint 在当前版本拒 anon key**(`"Only the 'service_role' API key can be used for this endpoint"`)。Test connection 第一次盲改加 Authorization Bearer 还是 401,加 surface response body 后才看到 Supabase 的真实 reason。**对症方案**:换到 `/auth/v1/settings`(GoTrue 公开 endpoint,需 anon `apikey` header,同时验 URL + key)。Walker checklist 不可能覆盖这种 Supabase 平台协议细节
2. **service_role 检测反应链断路** —— `serviceRoleDetected` computed 读 committed config,但 `buildPatch` 拒 service_role 持久化 → committed 永不变 → banner / red border / disable 三个视觉指示全哑火,只剩持久化安全保证还在 work。§2.7 risk row 1 明确要 4 件齐,需要把输入框换成 typed-local-ref 驱动,与 commit 走两条并行轨。**反应式 UI 设计陷阱:gate 在 buildPatch 上的字段无法直接驱动 computed**
3. **emit page-side import 接线漏配** —— step 3 runtime 文件 export `getSupabaseClient`,step 4 emit walker 写 `getSupabaseClient()...` 进 page body,但 scaffold 从未生成 `import { getSupabaseClient } from '<path>'`。单测 + cross-walker 全在 grep call site 字符串而**不验 module 解析**,所以 emit-level 一直绿,Tauri `bun run dev` 跑起来 ReferenceError 才暴露。修法对称 `pageHasNavigateHandler` —— 新加 `pageUsesSupabase` 走 IR 树,scaffold 按需 emit import line,paths 走单/多页对称(`./_lowcode_supabase` / `../_lowcode_supabase`)
4. **`@supabase/supabase-js` 在 Tauri WKWebView(macOS Darwin 25.5.0)兼容性** —— 无异常。createClient / GoTrue session / PostgREST query / mutation / auth listener 全部 work,无 CORS / fetch 怪行为。可信
5. **$currentUser 与现有 docState 冲突的实际发生率** —— 本期实测 session 中**未发生**:step 1 `validateStateName` reject `^\$` 在用户侧入口就挡;auto-register 在 collectDocStates 内部 prepend 与用户 decls 走 dedup。验证路径覆盖到了 reserved-name 拦截,但「用户在旧 .fig 里 raw 写 $currentUser」的 wild case 没遇到 —— 风险低,代码层兜底齐
6. **「emit 出来的代码能跑」与「emit 单测全绿」是两个不同的验证维度** —— 前者要 module 解析 + runtime 调用栈跑通;后者只要 grep 字符串匹配。本期 5a 后还冒出 3 个 5b fix commit,根因都在这条裂缝。本期已补 3 条 import-line 正负断言;**Phase 3 §3 step 4 cross-walker `39b3729` 又验一次**(tool 注册 / import line 正负覆盖)→ 已升 §1.4 正式 **经验 I**(emit 完 + 单测全绿 ≠ 跑得起来;module-resolve 维度;补充经验 D 的 dep-resolve 维度)

---

## 3. §3 详细设计:AI 生成 / 编辑(tool surface)

### 3.1 现状与问题

`src/app/ai/{tools,chat,acp,debug}` 全部基础设施已就位:MCP server(`packages/mcp/src/server.ts` auto-register ALL_TOOLS)、ACP transport(browser ↔ WebSocket :7601 ↔ MCP :7600 ↔ HTTP ↔ agent subprocess,见 CLAUDE.md)、chat panel + `system-prompt.md` + `model.ts` 全 work。

`packages/core/src/tools/` 现有 8 个领域(`read` / `modify` / `structure` / `codegen` / `variables` / `prompts` / `analyze` / `stock-photo`),覆盖 **pencil-design 域**(paint / geometry / layout / text / effects / stock photo)。**lowcode 域 0 工具**:grep `lowcode|docState|supabaseConfig|setBinding|ActionDef` 在 tools 下命中 0 处。

后果:AI agents 通过 chat 能修改 fill / stroke / position / text content,但**无法**修改 lowcode 字段(bindings / events / interactiveProps / renderCondition / freeLayout / lowcodeStates / supabaseConfig)。Phase 1 / 2 / §2 全部 lowcode 能力对 AI 不可见。要让 lowcode 平台真正具备「描述 → 生成」起步能力,先补齐工具表面。

**§3 不做** chat panel / system-prompt / streaming UX / mega "describe-app" 模式 —— scope 锁在 tool surface,与 §2 narrow-scope 一致。

### 3.2 关键决定

**8 主决定**(对话锁定 2026-05-25):

| # | 决定 | 理由 |
|---|---|---|
| 1 | **Scope** = tool surface only;chat / UX / system-prompt 不动 | 与 Phase 2 / §2 narrow scope 一致;mega "describe-app" 锁产品方向且强制改 chat UX,工作量 3-4 倍且命中经验 H |
| 2 | **Tool 粒度** = 6 MVP(3 read + 3 modify);细粒度 helper(setNodeBinding / setNodeEvent / setRenderCondition / 等)推 §3.v2 | mega 镜像现有 `updateNode` 模式,AI 单 tool 调一次完成多字段改动;粒度细化等 AI 用错积累的真实案例再补 |
| 3 | **文件落位** = `packages/core/src/tools/read/lowcode.ts` + `packages/core/src/tools/modify/lowcode.ts`,一域一文件 | 镜像 `tools/read/{nodes,query,...}` + `tools/modify/{paint,geometry,...}` 现有惯例 |
| 4 | **工具命名** = camelCase 镜像现有(`updateLowcodeNode` 而非 `update_lowcode_node`)| 现有 ALL_TOOLS 全 camelCase(`getPageTree` / `setFill` / `updateNode`);MCP server / CLI eval 都按 camelCase 处理 |
| 5 | **校验路径** = 校验逻辑提取共享模块(`packages/core/src/lowcode-validation/`),editor + tool 双路共用 | 校验 drift 是已知风险(§2 step 4 SupabaseConfigPanel.vue 内嵌 `decodeJwtPayload` 同 step 1 `validateStateName` 不在同一文件),共享避免 |
| 6 | **Undo 粒度** = 每个 modify tool = 一个 undo entry;mega `updateLowcodeNode` 哪怕 patch 含多字段也单 commit | 镜像现有 `updateNode` mega 行为;AI 视角:一次操作 = 一个 Cmd+Z 步 |
| 7 | **系统提示** = **不动** `src/app/ai/chat/system-prompt.md` —— 6 tool 自描述自给自足(`defineTool({description, ...})` 详写「何时用」「输入约束」「失败语义」+ 至少 1 个示例)| 系统提示一改就要 Tauri 实测 prompt 质量,scope 外;tool description 是 MCP 标准外延,任何调用方都看 |
| 8 | **MCP / CLI 可见** = 6 tool 全部进 `ALL_TOOLS`,自动同步 AI chat + MCP server + CLI eval(`bun open-pencil eval`)| 现有 ToolDef 单一注册点 = 三处生效是 Phase 1 决定 |

**10 次级默认**(用户 one-shot ACK 2026-05-25):

- **a.** `readLowcodeNode` 不递归子节点(AI 自己递归调,与现有 `getNode` 行为一致)
- **b.** `setDocStates` 整体替换 root.lowcodeDocumentState 数组,不做 per-entry diff(简单 = 稳;diff 推 §3.v2)
- **c.** `updateLowcodeNode(nodeId, patch)` —— patch 字段**未列出**的不删除;只显式 `null` 才清字段。避免 AI 忘传字段误抹除既有配置
- **d.** `setSupabaseConfig(undefined)` —— undefined 等于清空整个 root.lowcodeSupabaseConfig
- **e.** 校验失败:tool 返 `{ ok: false, error: <reason> }`,不抛 + 不静默(经验 C 沿用)
- **f.** 工具 description 写英文(现有 ALL_TOOLS 全英文;AI prompt 也以英文为主)
- **g.** 测试落 `tests/engine/tools/lowcode/`,镜像现有 `tests/engine/tools/` 既有结构
- **h.** 每个 modify tool 入口处显式 grep service_role / `^\$` reject —— 不能信任 AI 输入(经验 H 防线在 AI 入口外延)
- **i.** AI 改完后 `editor.requestRender()` 自动触发 —— 走既有 `updateNodeWithUndo` 路径(`ctx.setSelectedIds` / `ctx.setActiveTool` 已经 bump renderVersion,本期无需新加)
- **j.** CLI eval 通过 `bun open-pencil eval <file> -c "tools.updateLowcodeNode(...)"` 可调(与现有 tool CLI 入口一致)

### 3.3 公开 API / Schema 改动

**新增文件**:

| 文件 | 内容 |
|---|---|
| `packages/core/src/lowcode-validation/expression.ts` | **从 `packages/compiler/src/ir/expression.ts` 整体移过来**:Phase 0 表达式子语言 parser + AST + `parseExpression` / `parseTemplate` / `emitExpression` / `PREV_IDENT` / `hasPrevReference` / `substitutePrev`(589 行,Phase 2 §4 FROZEN grammar 不改)|
| `packages/core/src/lowcode-validation/validate.ts` | **从 `packages/compiler/src/ir/validate.ts` 整体移过来**:`ValidationResult` + `validateStateName` + `validateExpression` + `validateUrlTemplate` |
| `packages/core/src/lowcode-validation/supabase-config.ts` | NEW:`decodeJwtPayload` + `detectServiceRole` + `validateSupabaseConfig`,提取自 `src/components/properties/Lowcode/SupabaseConfigPanel.vue` |
| `packages/core/src/lowcode-validation/index.ts` | 单一 barrel,导出全部 validator + parser + `ValidationResult` 类型 |
| `packages/core/src/tools/read/lowcode.ts` | `readLowcodeNode` / `readDocStates` / `readSupabaseConfig` 3 tool |
| `packages/core/src/tools/modify/lowcode.ts` | `updateLowcodeNode` / `setDocStates` / `setSupabaseConfig` 3 tool。**step 3 实际差异**:`validateBinding` / `validateAction` 未抽成独立函数 / 文件 —— 改成 modify tool 内部 inline(`validateBindingExpr` / `validateActionShape` / `buildActionFromValidated`)+ `parseSupabaseConfig` 共享 helper(避免 jscpd clone)。由 tool 真实需求驱动 API,有第二消费方再抽 v2 |
| `tests/engine/lowcode-validation/{expression,expression-template,expression-prev,validate,supabase-config}.test.ts` | 5 个 validator + parser 单测(前 4 个从 `tests/engine/compiler/ir/` 移过来,`supabase-config.test.ts` 是 step 1 新加)|
| `tests/engine/tools/lowcode/{read,modify}.test.ts` | 2 个 tool 集成测试 |
| `tests/engine/tools/lowcode/cross-walker.test.ts` | walker checklist round-2 用 |

**已有文件镜像改动**:

| 文件 | 改 |
|---|---|
| `packages/compiler/src/ir/expression.ts` | **删除**(整体移到 `@open-pencil/core/lowcode-validation/expression.ts`)|
| `packages/compiler/src/ir/validate.ts` | **删除**(整体移到 `@open-pencil/core/lowcode-validation/validate.ts`)|
| `packages/compiler/src/index.ts` + 5 个 compiler 内部 import 站(`ir/types.ts` / `ir/collect/{state,tree,bindings}.ts` / `adapters/react/emit/{element,event}.ts`)| import 路径从 `./expression` / `../validate` / `#compiler/ir/expression` 改 `@open-pencil/core/lowcode-validation`;`compiler/src/index.ts` 保留 `validateStateName` / `validateExpression` / `validateUrlTemplate` / `ValidationResult` re-export 防外部破坏 |
| `src/components/properties/Lowcode/{EventsPanel,ListPanel,RenderConditionPanel,TextBindingPanel}.vue` + `state-row-editor.ts` | import 从 `@open-pencil/compiler` 直接换 `@open-pencil/core/lowcode-validation`(canonical source)|
| `src/components/properties/Lowcode/SupabaseConfigPanel.vue` | 删除内联 `decodeJwtPayload`,改 import `detectServiceRole` 共享;`testConnection` 不动(那是网络 IO 不是 schema 校验)|
| `packages/core/src/tools/registry-core.ts` | 注册 6 个新 tool(step 2 进 3 个 read,step 3 进 3 个 modify)—— 全部归入 `CORE_TOOLS`,默认在 AI chat / MCP / CLI 都可见;未走 `registry-extended.ts` |

**ToolDef 入参 shape**(锁定):

```ts
// read
readLowcodeNode: (nodeId: string) => { ok: true; data: LowcodeNodeRead } | { ok: false; error: string }
readDocStates: () => { ok: true; data: DocumentStateDef[] } // 始终成功(根存在)
readSupabaseConfig: () => { ok: true; data: SupabaseConfig | null } // null = 未配

// modify
updateLowcodeNode: (nodeId: string, patch: LowcodeNodePatch) => { ok: true } | { ok: false; error: string }
setDocStates: (states: DocumentStateDef[]) => { ok: true } | { ok: false; error: string }
setSupabaseConfig: (config: SupabaseConfig | undefined) => { ok: true } | { ok: false; error: string }
```

**Step 2–3 实施差异**:
- `LowcodeNodeRead` 定义 inline 在 `packages/core/src/tools/read/lowcode.ts`,通过 `tools/read.ts` barrel 导出;未建独立 `lowcode-shapes.ts`
- `LowcodeNodePatch` 类型**未建** —— `update_lowcode_node` 入参实际是 `patch_json: string`(JSON-encoded;ToolDef param schema 只支持 primitive),patch 形状由 modify tool 内部 `PATCH_KEYS` set + per-field appliers 钉死,而非顶层类型
- 6 tool 的 `params` 实际全是 JSON 字符串入参(`patch_json` / `states_json` / `config_json`),返回 shape `{ ok, data | error }` 一致(§3.2 #e 锁)

### 3.4 内部实现拆解

**校验共享路径**(step 1):
- editor(`SupabaseConfigPanel.vue` / `EventsPanel.vue` / `DocumentStatePanel.vue`)直接 `import { validateXxx } from '@open-pencil/core/lowcode-validation'`(架构边界:`src/components/properties/Lowcode/** ↛ @open-pencil/core/scene-graph` 已有 → `@open-pencil/core/lowcode-validation` 新增 subpath export,scaffold + 适配 已落)
- tool(`packages/core/src/tools/modify/lowcode.ts`)从同一 subpath import
- 校验失败统一返 `ValidationResult: { ok: false; reason: string }` —— 与既有 `Phase 2 §2 step 4 新观察 #2` 经验对齐

**read tool 流程**(step 2):
- `readLowcodeNode(nodeId)` —— 拿 SceneGraph.getNode(nodeId);返 `{ interactiveProps, bindings, events, renderCondition, freeLayout, nodeType, lowcodeStates }`,缺字段返 undefined;**不递归子节点**(决定 #a)
- `readDocStates()` —— 拿 root.lowcodeDocumentState[] 直接返
- `readSupabaseConfig()` —— 拿 root.lowcodeSupabaseConfig | null

**modify tool 流程**(step 3):
- `updateLowcodeNode(nodeId, patch)` —— 流程:节点存在 check → 各字段 validator → editor.updateNodeWithUndo(nodeId, validatedPatch, 'AI update lowcode')—— 单 commit 单 undo
- `setDocStates(states)` —— 全表 validator 后整替;**前置查 root.lowcodeSupabaseConfig`,若存在,**$currentUser**(本期决定 #h 防线之一)由系统自动注入,AI 传的 states[] 里不能含 `$` 前缀
- `setSupabaseConfig(config)` —— `decodeJwtPayload(config.anonKey)?.role === 'service_role'` 直接 reject;若 `config === undefined` 走清空

**walker checklist round-2**(step 4):
- AI tool 改动的字段(bindings / events 各 kind / interactiveProps / renderCondition / freeLayout / nodeType / lowcodeStates / supabaseConfig)都已在 §2 + Phase 2 既有 walker 中走过 —— round-2 只是钉死 tool 改完后 IR collect / preview rebuild / .fig 持久化全链路不漏
- 新加 `tests/engine/tools/lowcode/cross-walker.test.ts`:用一个真实 SceneGraph 跑 `updateLowcodeNode` 多字段 patch → collectTree → emit → 检查每字段都在 emit 出来的代码里出现

### 3.5 成功标准

1. `bun test ./tests/engine/lowcode-validation/` 全绿;`bun test ./tests/engine/tools/lowcode/` 全绿
2. `bun test ./tests/engine/compiler/` + `bun test ./tests/engine/kiwi/lowcode/` 全绿(零回归)
3. `bun run check` 全绿
4. **Tauri 实测(用户主导)11 项 user-ACK**(§3 本期 8 项 + §2 closure gap 3 项):
   1. AI chat 输入「读当前选中节点的 lowcode 状态」→ AI 调 `readLowcodeNode` 返结构化结果
   2. AI 输入「列出所有 document states」→ AI 调 `readDocStates` 返全表
   3. AI 输入「读当前 Supabase 配置」→ AI 调 `readSupabaseConfig`(anon key 直接返,不脱敏 —— editor-side AI,信任边界内)
   4. AI 输入「给选中 BUTTON 加 onClick supabaseQuery,table=users,storeAs=items」→ AI 调 `updateLowcodeNode`,Properties 面板**立即**反映新 action;preview 跑得起来
   5. AI 输入「加一个 docState `items` array,initial=[]」→ AI 调 `setDocStates`,Properties 面板**立即**出新 state line
   6. AI 输入「设置 Supabase anonKey 为 <service_role JWT>」→ tool **reject**,AI 返「拒绝原因」消息;不持久化任何字段
   7. AI 改完后,**Cmd+Z 一次**回到改前(单 undo entry)
   8. **零回归**:Phase 2 既有 8 项 + §2 既有 7 项 Tauri 实测 spot-check 通过(SupabaseConfigPanel Test connection 仍 work / .fig 存读回 / supabaseQuery emit 跑起来)
   9. **§2 closure gap — UPDATE 实测**:Form 触发 `supabaseMutation` `operation: 'update'` + filter where 子句 → Supabase Dashboard 看到目标行字段值变化(§2.8 row 4 仅验过 INSERT,UPDATE 走 §3 step 5 补)
   10. **§2 closure gap — DELETE 实测**:Form 触发 `supabaseMutation` `operation: 'delete'` + filter where 子句 → Supabase Dashboard 看到目标行消失;无 filters 在 IR collect 已 reject(走代码 + 单测验过,Tauri 仅需 happy-path)
   11. **§2 closure gap — UPSERT 实测**:`operation: 'upsert'` + payload 含 primary key → 行不存在时插入、行存在时更新,Supabase Dashboard 双场景各验一次
5. 不破坏 Phase 0 §8 / Phase 1 §1(除 §1.5 #3+#5)§5 §7.3 §7.4 §10.3 §11.3(除 #5)§12.3 / Phase 2 §9.2 §2.2 §3.2 §4.2 §6.2 §7.2 §8.2 / Phase 3 §2.2 任一锁定决定

### 3.6 工作分解(建议 1 名工程师,4–5 天)

| Step | 任务 | 验收 / commit message |
|---|---|---|
| 1 | shared validators 提取:`@open-pencil/core/lowcode-validation` subpath + 5 个 validator 文件 + barrel;`packages/core/src/scene-graph/lowcode/state.ts` re-export `validateStateName`;`SupabaseConfigPanel.vue` 改 import 共享版;5 个 validator 单测 | `bun test ./tests/engine/lowcode-validation/` 全绿;`bun run check` 全绿;`feat(lowcode): step 1 — shared lowcode validators (§3 Phase 3)` |
| 2 | `tools/read/lowcode.ts` 3 read tool + `tools/lowcode-shapes.ts` Read shape + 集成测试 | `bun test ./tests/engine/tools/lowcode/read.test.ts` 全绿;`bun run check` 全绿;`feat(lowcode): step 2 — lowcode read tools (§3 Phase 3)` |
| 3 | `tools/modify/lowcode.ts` 3 modify tool + Patch shape + 集成测试 + 进 ALL_TOOLS;tool description 各 ≥ 300 字 含示例 | `bun test ./tests/engine/tools/lowcode/modify.test.ts` 全绿;`bun run check` 全绿;`feat(lowcode): step 3 — lowcode modify tools (§3 Phase 3)` |
| 4 | walker checklist round-2 + `tests/engine/tools/lowcode/cross-walker.test.ts`(updateLowcodeNode mega patch → collectTree → emit / Properties 反应全链路覆盖) | `bun test ./tests/engine/tools/lowcode/` 全绿;`bun run check` 全绿;`test(lowcode): step 4 — lowcode tool cross-walker (§3 Phase 3)` |
| 5 | Tauri 实测 user-ACK 8 项 + §3.8 post-mortem 回填 + 关闭 §3 | 8 项全 ACK;`docs(lowcode): §3 Phase 3 Tauri verification` |

### 3.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| AI 漏 `service_role` 拒绝路径 → 暴露 service_role key 到 .fig / pluginData / git | **高(安全)** | 决定 #h:每个 modify tool 入口显式 grep + 单测钉死;`validateSupabaseConfig` 共享自 §2 SupabaseConfigPanel.vue 已验过的 `decodeJwtPayload` 逻辑 |
| AI 把错的 `valueExpr` / 表达式塞进 patch(parser 拒绝)→ tool 返 error 但 AI 反复试错 | 中 | 决定 #e:tool description 详写「expression sublanguage 不支持 array / object literal / function call」(本期 step 5a 经验);`validateExpression` 入参时校验,失败带具体 reason |
| 校验代码 drift:editor 改了 validator 但 tool 漏跟 / 反之 | **高(隐蔽)** | 决定 #5 主决定锁:**共享模块 `@open-pencil/core/lowcode-validation`**;step 1 重构既有 editor 代码同时改 import;单测同时覆盖两路 |
| 经验 A —— AI tool 改动后 IR collect / preview rebuild / .fig 持久化某一环漏 | 高 | 决定 #6 + step 4 cross-walker;新加 `tests/engine/tools/lowcode/cross-walker.test.ts` 钉死 full pipeline |
| `system-prompt.md` 未改但工具 description 写得不到位 → AI 不会调 / 调错 | 中 | 决定 #7 + tool description 锁 ≥ 300 字 + 含 1 个示例;step 3 末尾 sanity-check 各 tool description 长度 + 例子 |
| AI 改完后 Properties 面板未实时反映(经验 H —— UX 同步类 bug)| 中 | 决定 #i:`updateNodeWithUndo` 既有路径自动 bump sceneVersion;Tauri 实测 #4-#5 专项验「立即反映」 |
| 工具粒度太粗 → AI 一次性传太多字段一改全错 → 难调试 | 低 | 决定 #6:mega tool 单 undo,Cmd+Z 一键回滚;v2 加细粒度 helper |
| 经验 D —— 新加 subpath export `@open-pencil/core/lowcode-validation` 漏配进 package.json `exports` | 中 | step 1 第一件事:在 `packages/core/package.json` `exports` field 加 subpath;`bun run check:arch` (Steiger)钉死 |

### 3.8 Post-mortem

**§3 closed 2026-05-26**(HEAD `<post-mortem-commit>` 后)。

#### Commit 链

| Step / 项 | Commit | 内容 |
|---|---|---|
| 设计 | `9297711` | §3 详细设计 + 8 主决定 + 10 次级默认 |
| 1 | `b1210df` | shared validators — `@open-pencil/core/lowcode-validation/` subpath(`expression.ts` + `validate.ts` + `supabase-config.ts` + barrel);6 compiler + 5 editor + 4 test 改 import;75 单测 |
| 2 | `d97b284` | read tools — `tools/read/lowcode.ts`(`readLowcodeNode` / `readDocStates` / `readSupabaseConfig`)+ `LowcodeNodeRead` 类型 + 进 `CORE_TOOLS`;9 case 测试 |
| 3 | `6f31ca9` | modify tools — `tools/modify/lowcode.ts`(`updateLowcodeNode` mega patch / `setDocStates` / `setSupabaseConfig`)+ 7 field appliers + 6 action builders + `parseSupabaseConfig` 共享 helper;21 case 测试 |
| 4 | `39b3729` | cross-walker — `tests/engine/tools/lowcode/cross-walker.test.ts` 7 用例 / 66 expect;walker round-2 + 经验 I 正负 import-line 断言 |
| follow-up 1 | `62dddf1` | §3.3 doc drift 修;`update_lowcode_node` desc 加 setVariable.valueExpr scope 注释 |
| follow-up 2 | `6e1dea5` | 经验 I 升 §1.4 正式经验(module-resolve 维度) |
| follow-up 3 | `d1d4c7d` | §2 closure gap 标注 + §3 step 5 ACK 8 项扩 11 项 |
| **§3.x** | (本期) | INPUT controlled input via `bindings.value`:IR `IRControlledInput`(targetType=string\|number)+ collect `resolveValueBinding` + emit `controlledOnChangeBody`(`Number(...)` coercion + auto `type="number"`)+ `InputValueBindingPanel.vue` + 4 i18n key × 7 locale + `update_lowcode_node` desc 加 200 字段。8 新测试 case;`bun run check` 0 error |
| 5 | (本期) | Tauri 实测 user-ACK 11 项 + §3.8 post-mortem + memory 更新 |

#### Walker checklist round-2(step 4)

- IR collect 端 `update_lowcode_node` mega patch 5 字段(state / bindings / events / interactiveProps / renderCondition)在 `tests/engine/tools/lowcode/cross-walker.test.ts:43` 钉死 5 字段命中 + 0 warnings
- React emit 端的 useState / useDocState/setDocState import 行 + call-site 在 `cross-walker.test.ts:106` 双向断言
- 零回归 baseline 用 `byte-stable against a baseline graph` 模式
- 6 个 §3 tool snake_case 名注册校验

#### Tauri 实测 11 项结果(用户主导,本期 §3.x 扩 → 17 项实质)

| # | Check | 结果 |
|---|---|---|
| 1 | `read_lowcode_node` 返结构化 | ✅ |
| 2 | `read_doc_states` 返全表 | ✅ |
| 3 | `read_supabase_config` 返完整 config(不脱敏)| ✅ |
| 4 | AI 给 BUTTON 加 supabaseQuery → Properties **立即**反映 | ✅(经验 H sceneVersion bump 起效)|
| 5 | AI 加 docState `items` → Properties **立即**出新 state line | ✅ |
| 6 | service_role JWT 拒掉 + 带 reason | ✅ |
| 7 | Cmd+Z 单 undo 回滚 | 🟨 **多 undo entry**:第 1 次撤 data,第 2 次撤 UI/selection。比预期(完全无 undo)温和。known-limitation:§3.v2 改 ToolDef.execute 入参带 Editor + `beginUndoGroup`/`endUndoGroup` 合 1 entry |
| 8 | 零回归 spot-check | ✅(SupabaseConfigPanel Test connection / .fig 持久化 / Phase 2 supabaseQuery preview 全 OK)|
| 9 | supabaseMutation UPDATE | ✅ filter 动态 + payload 字面;debug:UPDATE/DELETE/UPSERT 首次全无效 → 定位 Supabase users 表只有 INSERT policy,缺 UPDATE/DELETE policy;加 anon UPDATE/DELETE policy 后通过 |
| 10 | supabaseMutation DELETE | ✅ delete 无 payloadJson;debug:首次请求未发,AI 给 delete action 残留 payloadJson 被 IR collect drop(`action-supabase-mutation-unexpected-payload`);删 payload 后通过 |
| 11 | supabaseMutation UPSERT | ✅ PK 类型 + 值匹配后双场景双结果;debug:首次用 `'upsert-demo-1'` 字符串值与 `bigint` PK 不匹配,Supabase 走 INSERT 自动分配新 id;改成数字 PK 值后第二次 UPSERT 走 UPDATE 分支 |

#### Surprise 列表

1. **INPUT controlled 路径整个不存在(experience H 重击)** — 设计阶段 §3.5 假设 form-driven supabaseMutation `filters` / `payload` 能引用「表单当前值」,但 Phase 0/2/3 全部 INPUT emit 是 `defaultValue` uncontrolled,没 `bindings.value` 通道,onChange handler 也无 `$event` / `$value` token 拿 `e.target.value`。expression grammar §4.2 FROZEN 又封死 `$event` 拓展。**本期被迫提前实现 §3.v2 一部分作 §3.x**:`bindings.value` controlled 通道 + IR `controlled` 字段 + emit two-way wiring(string + number)+ UI 面板 + i18n。Tauri 实测前必须重启。**等于本期 scope 实质扩了 30-40%**。
2. **Cmd+Z 多 undo entry**(§3.5 #7) — 不是预期的「无 undo」,而是「data + UI 两步分撤」。比预期温和,但仍违 §3.2 #6「mega tool = 单 undo」设计意图。fix path:`editor.beginUndoGroup` / `endUndoGroup` 包,推 §3.v2。
3. **supabaseMutation.payloadJson 是纯字面 JSON**(本期 #9 debug 期发现) — `payload` 走 `JSON.parse(JSON.stringify(...))` 校验然后 emit 时 verbatim splice 进 `.update(...)`,**不支持表达式插值**。意味着「INPUT 输入 → mutation payload 写入」这条 UX 路径**不存在**。filters 没这个问题(filters.valueExpr 是表达式 AST)。所以 #9 走「filter 动态 + payload 字面」,#11 UPSERT 完全用字面值演示 INSERT vs UPDATE 分支。**§3.v2 列入**:`supabaseMutation.payloadEntries: { key, valueExpr }[]` 替代 / 并存 `payloadJson` literal。
4. **Tauri 网络面板「An error occurred trying to load the resource」是 204 No Content 误显** — UPDATE/DELETE 走 PostgREST 返 204(无 body),Tauri WKWebView devtools 面板把这显示成「错误」字样。不是网络失败。**经验 C 沿用**:debug 看完整 Headers / Status / Request Body,别信面板顶层文案。
5. **Supabase RLS UPDATE / DELETE 静默 0 行**(本期 #9 debug 主血泪) — anon 缺 UPDATE policy 时,PATCH 仍返 204 但「matched 0 rows under RLS」,看上去「id 没传过去」;UPSERT 因为 anon 看不到既有行,fallback 走 INSERT 创建重复行。**修法**:测试期临时关 RLS 或加 anon UPDATE/DELETE policy。这是 Supabase 一个隐蔽 footgun,值得在 §3.v2 SupabaseConfigPanel 加 RLS policy 健康检查(可选)。
6. **AI tool 调用「delete + payloadJson 静默 drop」陷阱** — IR collect 端 `action-supabase-mutation-unexpected-payload` 警告 + drop handler;runtime 完全无反应、无网络请求。AI 写 prompt「No payloadJson」时容易给 action 留 `payloadJson: ''` 或 `'{}'`,被 trim 后判 `raw !== ''` 触发 drop。**修法 v2**:`payloadJson === '{}'` 也按 empty 处理,或 tool 入参 validator 直接拒。当前期 doc 标 known-pitfall。
7. **PK 类型不匹配 UPSERT 静默 INSERT**(本期 #11 debug) — Supabase `users.id` 是 `bigint` 时,upsert payload `{"id":"upsert-demo-1",...}`(字符串)Supabase 不报错,直接走 INSERT 自动分配新 id。**修法**:doc UPSERT prompt 强调「PK 值类型必须与列匹配」。
8. **setVariable.valueExpr 仅 page-state + `$prev`**(step 4 期间发现,§3.5 已 hint) — 在 cross-walker 写 `valueExpr: 'items'` 引用 docState `items` 时被 IR walker drop(`action-setvariable-unknown-identifier`)。已在 `update_lowcode_node` desc 加 IMPORTANT 注。Tauri ACK 期没再踩。
9. **emit import 顺序 read-then-write 非字母序**(step 4 期间发现) — React adapter 拼 `useDocState, setDocState` 是按 `ir.docStateReads.length > 0` then `ir.docStateWrites.length > 0`,cross-walker 断言要镜像或用 regex。

#### 经验沉淀(对 §1.4 增补 / 印证)

- **A + G** 走 union widening / walker 多轮 — 本期 IR collect / emit / cross-walker / UI panel / i18n × 7 locale 全维度命中,**新增 i18n locale 维度**(我新增 4 个 key,7 个 locale 文件得各加,check-locales 钉)
- **H** Tauri 实测出 unit / cross-walker 找不到的问题 — 本期最严重:**INPUT controlled 路径根本不存在**这一基础事实,unit + cross-walker 不可能发现(因为这是设计层面的洞,不是实现层面的回归)。**§4 / §5 / §X 设计阶段强烈建议先 Tauri 短跑 UX 假设链,再写详细设计**(designsmoke testing)
- **I** module-resolve 维度 — 本期再次印证:`InputValueBindingPanel.vue` 加进去后,DesignPanel.vue 必须 import + 注册,Steiger 钉死;漏 i18n key 任一 locale → check-locales 钉死。两道独立栅栏 work
- **C** no-swallow — 本期 #10 DELETE debug 全靠 IR collect warning(`action-supabase-mutation-unexpected-payload`)在 DevTools console 露出;若 IR collect 静默 drop 就完全 dead-end
- **新经验候选 J**:**设计阶段先做「假设链反向核」** — §3.5 ACK 表里写「Form 触发 supabaseMutation」是设计假设,但没人 reverse-check「form 输入到底怎么进 state」这条 UX 链。结果实施完整套发现链条断了。**Phase 4 起草 §X.5 ACK 表前,必须沿 ACK 倒推每一步技术依赖,任一步不存在标黄推回 §X.2 决定表**

#### §3.v2 follow-up

按本期 surprise 沉淀的 todo 列表(优先级降序):
1. ToolDef.execute 入参加 Editor + `beginUndoGroup`/`endUndoGroup` 合并 mega 调用为 1 undo entry(surprise #2)
2. `supabaseMutation.payloadJson` 升级为 / 并存 `payloadEntries: { key, valueExpr }[]`,支持 docState / page-state 引用(surprise #3)
3. CHECKBOX / TEXTAREA / DATEPICKER / SELECT / RADIO / SWITCH 的 controlled binding(扩 §3.x 模式)
4. expression grammar 加 `$event` / `$value` token(若需要,可能避开 §4.2 FROZEN 走 token 后置注入路径)
5. INPUT controlled boolean / date 类型支持
6. SupabaseConfigPanel 加 RLS policy 健康检查(可选 nice-to-have,surprise #5)
7. `payloadJson === '{}'` 按 empty 处理消歧义(surprise #6 防呆)

---

---

## 4–13. 候选 §X 详细设计(待用户挑定后扩写)

> 用户挑定某条 §X → 回本 doc 把对应小节改写成「详细设计 + 锁定决定」格式(参考 Phase 2 §2 / §3 / §4 / §6 / §7 / §8 / §9 任一已收尾节 + 本期 §2 / §3 结构:§X.1 现状与问题、§X.2 关键决定表、§X.3 公开 API / Schema 改动、§X.4 内部实现拆解、§X.5 成功标准、§X.6 工作分解、§X.7 风险、§X.8 Post-mortem)→ 对话锁主决定 → 用户 ACK 次级默认 → 分 step commit + Tauri 实测。

§4 多人协作 / §5 部署 / §6 Kiwi schema / §7 响应式 / §8 Symbol / §9 i18n runtime / §10 工作流 / §11 §3.v2 fetch / §12 §4.v2 表达式 / §13 SWITCH CSS —— 简述见 §1.1 表。
