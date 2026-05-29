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

## 3.v2 §3.v2 详细设计:mega-undo + payloadEntries + `'{}'` normalize

**Scope = §3.v2 mini-scope**(follow-up 1 + 2 + 7,1-2 天)。§3.v2 follow-up 3/4/5/6 推 §3.v3(留候选)。

### 3.v2.1 现状与问题

§3 step 5 Tauri 实测暴露 3 条主线 surprise:

1. **Cmd+Z 多 entry**(surprise #2)— `update_lowcode_node` mega patch 走 `figma.graph.updateNode`(全局 mutator,不进 undo stack);先 commit data 字段、再走 setSelectedIds 路径,Cmd+Z 一次只能撤一步,与 §3.2 #6 「mega tool = 一个 undo entry」设计意图冲突。
2. **payloadJson 不支持表达式**(surprise #3)— `SupabaseMutationAction.payloadJson` 是 JSON literal,IR collect 走 `JSON.parse(JSON.stringify(...))` 再 verbatim splice 进 `.insert/.update/.upsert(...)`,**INPUT 输入 → mutation payload** 这条 UX 路径不存在(filters 没这问题,因为 `SupabaseFilter.valueExpr` 走 expression sub-language)。
3. **AI 残留 `'{}'` silent drop**(surprise #6)— `payloadJson === '{}'` trim 后非 `''`,delete + 残留 `'{}'` 触发 IR collect `action-supabase-mutation-unexpected-payload` warning + drop。AI 写 prompt「No payloadJson」时容易留 `'{}'`,行为变成 silent fail。

§3.v2 mini-scope **不做**:CHECKBOX / TEXTAREA / DATEPICKER / SELECT / RADIO / SWITCH 的 controlled binding(follow-up 3,推 §3.v3,体量 6 类型 × IR/emit/UI/test);`$event` / `$value` token 扩 grammar(follow-up 4,§4.2 FROZEN 绕路工程量大);INPUT boolean/date(follow-up 5);RLS 健康检查(follow-up 6,UX nice-to-have);§3.v3 视产品节奏再排。

### 3.v2.2 关键决定

**8 主决定**(对话锁定 2026-05-26):

| # | 决定 | 理由 |
|---|---|---|
| a | **ToolDef API** = `execute: (figma, args, ctx?: { editor?: Editor }) => unknown` 第 3 位 opt-in,既有 tool 0 改;`Editor` type 从 `#core/editor` 导入,核内引用不破跨包 | 选 1 而非新 `defineToolWithEditor`(两套并存 ALL_TOOLS 变 union 改动面广);选 1 而非塞进 FigmaAPI(违 core framework-agnostic) |
| b | **谁注入** = 仅 `src/app/ai/**` 调 lowcode tool 时注入 editor(app 层有 session.editor);CLI / MCP server / fixture 测试不注入 → fallback 走既有 `figma.graph.updateNode` 路径(no undo) | CLI/MCP/headless 调用本就无 editor 上下文,fallback 是设计意图 |
| c | **哪些 tool opt-in** = 仅 3 个 lowcode mutate(`update_lowcode_node` / `set_doc_states` / `set_supabase_config`);其它 modify tools(paint/geometry/layout/text/effects)本期不动 | mini-scope;其它 tool 走既有 `updateNodeWithUndo`(已有单 undo),无 batch 需求 |
| d | **batch 内部 mutate** = 3 mutate tool 内部新 helper `pushFieldUpdate(ctx, node, key, value)` snap previous + mutate + `ctx.undo.push({ forward, inverse })`;外层 `editor.undo.runBatch('AI: <tool_name>', () => { ... })` 汇聚 | `runBatch` 只汇聚 push 进来的 entries,不会自动 capture mutations;需显式 push 出 inverse closure |
| e | **payloadEntries 字段** = `SupabaseMutationAction.payloadEntries?: { key: string; valueExpr: string }[]` 与 `payloadJson` 并存;both 时 entries 胜 + payloadJson drop + warn `action-supabase-mutation-payload-source-conflict` | 不破 Phase 0 §2 既有 payloadJson 持久化;新功能 opt-in;AI 逐步迁 |
| f | **payloadEntries.valueExpr grammar** = 复用 `SupabaseFilter.valueExpr` = `SetStateAction.valueExpr` 的 restricted sub-language(page-state + docState + `$prev` + 字面),0 新 grammar | 避开 §4.2 FROZEN;filters 已用,无新风险 |
| g | **payloadEntries emit** = `{ <key>: <valueExpr emit>, ... }` object literal 喂 `.insert/.update/.upsert(payloadObj)`;delete + entries 非空 → warn 沿用既有 `action-supabase-mutation-unexpected-payload` code;`payloadEntries.length === 0` 视同 empty | 与 payloadJson emit 形态对齐(都是 object literal),emit walker 只需处理 entries 路径多一条分支 |
| h | **`payloadJson '{}'` / '[]' 防呆位置** = shared validator `validateActions` 入口处 trim 后 === '{}' / '[]' → normalize 为 `''`;IR collect / tool 入口同走这个 validator,自动覆盖 | 入口处 normalize 一次,下游 emit / IR collect 看到的就是 empty;比双 normalize 简洁 |

**8 次级默认**(用户 one-shot ACK 2026-05-26):

- **i.** undo label = `'AI: <tool_name>'`(例:`'AI: update_lowcode_node'`)— 短英文,Edit menu 看得懂
- **ii.** `runBatch` throw → `UndoManager.rollbackBatch` 自动逆操作(已实现);tool 返 `{ ok: false, error }`
- **iii.** `set_doc_states` / `set_supabase_config` 同样 runBatch 包(一致性,即便单 root node 改)
- **iv.** `payloadEntries` tool param 走 JSON-string,format 同 `filters`(AI 拼 `'[{"key":"name","valueExpr":"$prev.name"}]'`)
- **v.** `payloadEntries.key` 校验:non-empty + duplicate key reject + JS identifier-safe(同 `DocumentStateDef.name` 字符集);failed → 该 entry drop + warn,不整行丢
- **vi.** Kiwi schema 0 改(actions 走 JSON-string blob 存 `lowcode/events` pluginData,加 field 0 schema 改)
- **vii.** cross-walker 增 2 用例:① mega patch with editor ⇒ undo stack 长度 == 1(模拟 editor.undo);② payloadEntries 端到端(AI tool → IR → emit valueExpr 引 docState)
- **viii.** `update_lowcode_node` tool description 加 ~150 字段:payloadEntries 优先于 payloadJson + 表达式语法 + delete 不带 payload + `'{}'` 视同 empty

### 3.v2.3 公开 API / Schema 改动

**新增 / 改 type**:

| 文件 | 改 |
|---|---|
| `packages/core/src/scene-graph/types.ts` | `SupabaseMutationAction` 加 `payloadEntries?: { key: string; valueExpr: string }[]` |
| `packages/core/src/tools/schema.ts` | `ToolDef.execute` + `defineTool` 入参签名加第 3 位 `ctx?: { editor?: Editor }`;既有 tool 0 改(typescript 优化:`ctx` 可省) |
| `packages/core/src/tools/modify/lowcode.ts` | 3 mutate tool 实现拆 with-editor / fallback 分支;新 helper `pushFieldUpdate` |
| `packages/core/src/lowcode-validation/validate.ts` | `validateActions`(或对应入口)新增 `normalizeEmptyPayloadJson`:trim 后 === '{}' / '[]' → '' |
| `packages/compiler/src/ir/collect/bindings.ts` | `collectSupabaseMutationPayload` 拆出 `collectPayloadEntries` 分支;both-present 检测 + warn;emit-side `emitSupabaseMutation` 加 entries 路径 |
| `packages/compiler/src/adapters/react/emit/event.ts` | emit `.insert/.update/.upsert({key: valueExpr, ...})` 当 entries 在 IR 里(对齐既有 valueExpr emit pathway) |
| `src/app/ai/**`(AI 调用 dispatch 处) | tool 调用点拼 `ctx: { editor: session.editor }` 注入 |

**注册 / 测试**:

| 文件 | 改 |
|---|---|
| `tests/engine/tools/lowcode/modify.test.ts` | 加 with-editor / fallback 路径;assert undo stack length == 1 with-editor;assert 既有 figma.graph.updateNode 路径 fallback 时 0 entry(behavior 不变) |
| `tests/engine/compiler/ir/supabase-mutation-payload-entries.test.ts` | 新:6 IR case + 4 emit case + valueExpr grammar 校验 |
| `tests/engine/lowcode-validation/validate.test.ts` | 加 `'{}'` / `' {} '` / `'[]'` / `' [] '` normalize 测试 |
| `tests/engine/tools/lowcode/cross-walker.test.ts` | 加 2 用例(主决定 vii) |

### 3.v2.4 内部实现拆解

**Step 1 — ToolDef ctx + runBatch**:

- `schema.ts`:`ToolDef.execute` 加 opt 第 3 参;`defineTool` 同步加;`ToolCtx` type alias `{ editor?: Editor }`
- `tools/modify/lowcode.ts`:3 mutate tool 实现拆 `executeWithEditor(ctx.editor)` vs `executeFigmaPath()`(既有);with-editor 路径 `editor.undo.runBatch('AI: <name>', () => { ... pushFieldUpdate × N ... })`
- `pushFieldUpdate(ctx, nodeId, key, value)`:snapshot `node[key]`(用 structuredClone)→ mutate → `ctx.undo.push({ label, forward, inverse })`;`forward = () => ctx.graph.updateNode(...)`、`inverse = () => ctx.graph.updateNode(... previous)`
- app 注入点:找 AI tool dispatch(`src/app/ai/{tools,chat,acp}` 之一)调 `tool.execute(figma, args)` 处,append `, { editor: session.editor }`

**Step 2 — payloadEntries**:

- `types.ts` 加 field;Kiwi 不动
- `bindings.ts` IR collect:`collectSupabaseMutationAction` 内 `payloadEntries` 长度 > 0 → 走 entries 分支;同时 payloadJson 非空 → warn `payload-source-conflict` + drop payloadJson 路径;每 entry `validateExpression(valueExpr, scope)` 拒掉非 expression 子语言;key 校验(主决定 v)
- `event.ts` emit:既有 `supabaseMutation` emit 分支多 entries 路径,生成 `{ [JSON.stringify(key)]: <valueExpr emit>, ... }` object literal
- tool input:`update_lowcode_node` patch 解析 `payloadEntries` JSON-string;校验失败返 `{ ok: false, error }`

**Step 3 — `{}` / `[]` normalize**:

- `lowcode-validation/validate.ts`:`validateActions` 入口扫每个 action,若 `kind === 'supabaseMutation'` 且 `payloadJson?.trim()` ∈ `['{}', '[]']` → `payloadJson = ''`
- IR collect 端 `collectSupabaseMutationPayload` 现有防御代码沿用(double safety,不依赖 normalize 是否被调)
- tool description 加 ~150 字段

**Step 4 — cross-walker**:

- 模拟 `editor.undo.push` 计数(jest-style spy 或 stub `UndoManager`),验 with-editor ⇒ stack +1;without-editor ⇒ 0
- payloadEntries 端到端:`update_lowcode_node` 拼 supabaseMutation action with entries → 跑 collectTree → assert IR 里 entries 长度 + emit 里 `.update({...})` 含 valueExpr emit
- 经验 I:断言 IR `bindings.ts:collectPayloadEntries` 调用链 + emit `event.ts` 含 entries 路径 import 行 / 函数名 +/- 双向

### 3.v2.5 成功标准

1. `bun test ./tests/engine/lowcode-validation/` 全绿
2. `bun test ./tests/engine/tools/lowcode/` 全绿(含 modify with-editor / fallback)
3. `bun test ./tests/engine/compiler/` 全绿(含新 supabase-mutation-payload-entries.test.ts)
4. `bun test ./tests/engine/kiwi/lowcode/` 全绿(零回归)
5. `bun run check` 全绿
6. **Tauri 实测(用户主导)~6 项 user-ACK**:
   1. AI 改完 lowcode 节点 → **Cmd+Z 一次**全部回到改前(修 surprise #2)
   2. AI 用 INPUT 输入值绑 docState → 加 supabaseMutation insert 用 payloadEntries 引 docState → 提交后 Supabase Dashboard 看到行的字段值就是 INPUT 的输入(修 surprise #3)
   3. AI 调 update_lowcode_node 残留 `payloadJson: '{}'` 在 delete action → IR collect / Tauri 都按 empty 处理,不再 silent fail(修 surprise #6)
   4. **零回归**:Phase 3 §3 既有 8 项 + §3.x INPUT controlled + §2 Supabase 11 项 spot-check 通过
   5. CLI / MCP server 调 lowcode tool fallback 不挂(无 editor 上下文,走既有 figma.graph 路径)。CLI eval 只暴露 `figma` 全局;调 ToolDef 用 `ALL_TOOLS.find`,**不是** `tools.<name>(...)`:
      ```sh
      bun open-pencil eval <file.pen> -c "
        const { ALL_TOOLS } = await import('@open-pencil/core/tools')
        const t = ALL_TOOLS.find(x => x.name === 'update_lowcode_node')
        return t.execute(figma, { id: '<node-id>', patch_json: '{...}' })
      "
      ```
   6. payloadEntries `both-present` warning 在 DevTools console 露出(经验 C 防 silent drop)
7. 不破坏 Phase 0 §8 / Phase 1(除 §1.5 #3+#5 §11.3 #5)/ Phase 2 §9.2 §2.2 §3.2 §4.2 §6.2 §7.2 §8.2 / Phase 3 §2.2 §3.2 §3.x 任一锁定决定

### 3.v2.6 工作分解(建议 1 名工程师,1-2 天)

| Step | 任务 | 验收 / commit message |
|---|---|---|
| 1 | ToolDef.execute 加 ctx 参 + 3 lowcode mutate tool runBatch + app 注入;测试 with-editor / fallback | `bun test ./tests/engine/tools/lowcode/` 全绿;`bun run check` 全绿;`feat(lowcode): step 1 — ToolDef ctx + lowcode mega-tool runBatch (§3.v2)` |
| 2 | `SupabaseMutationAction.payloadEntries` 字段 + IR collect + emit + tool input;新测试文件 6 IR + 4 emit | `bun test ./tests/engine/compiler/` 全绿;`bun run check` 全绿;`feat(lowcode): step 2 — supabaseMutation payloadEntries (§3.v2)` |
| 3 | shared validator `'{}'` / `'[]'` normalize + tool desc 加 150 字 | `bun test ./tests/engine/lowcode-validation/` 全绿;`bun run check` 全绿;`feat(lowcode): step 3 — payloadJson '{}' normalize + tool desc (§3.v2)` |
| 4 | cross-walker 2 新用例(mega 单 entry / payloadEntries 端到端) | `bun test ./tests/engine/tools/lowcode/` 全绿;`bun run check` 全绿;`test(lowcode): step 4 — §3.v2 cross-walker (mega undo + payloadEntries)` |
| 5 | Tauri 实测 ~6 项 user-ACK + §3.v2.8 post-mortem + 关闭 §3.v2 + memory 更新 | 6 项全 ACK;`docs(lowcode): §3.v2 Tauri verification + close` |

### 3.v2.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| `ToolDef.execute` 加 ctx 参破坏既有 ToolDef 实现(隐式签名漏接)| 中 | TS strict;optional 第 3 参 + 既有 0 改;ctx 默认 undefined,既有 tool 不读 |
| `pushFieldUpdate` snapshot 用 structuredClone 性能慢(大节点)| 低 | lowcode 字段都 small(bindings/events/interactiveProps/renderCondition/freeLayout 各几 KB);profile 真慢再优化 |
| `payloadEntries` 与 `payloadJson` both-present 时迁移期 AI 会同时给两个(漏)→ warn 但 entries 胜 | 低 | tool desc + 单测覆盖;production runtime warn 在 console 不挡 |
| `valueExpr` 引 docState 失败 silent drop(原 `action-setvariable-unknown-identifier` 风格)| 中 | IR collect warn 必须 surface(经验 C);单测覆盖 4 失败 case |
| 经验 I — 新 `ctx?: { editor }` 参跨包传递 / `payloadEntries` 新字段 emit walker 漏接 | 高 | cross-walker 双新用例钉死;import 行 +/- 断言 |
| 经验 D — payloadEntries emit 不需新 npm import(`Number(...)` 之类 lowcode runtime 已在),无 dep-resolve 风险 | 0 | 沿用 |
| AI 漏 `payloadEntries.key` JS identifier 校验 → emit 出语法错误 JS | 中 | step 2 validator key 校验 + 单测 |
| `runBatch` throw rollback 后部分字段 already mutated(snapshot 漂移)| 中 | `pushFieldUpdate` snap 在 mutate 前 + push inverse;rollbackBatch 走 inverse;单测验 throw 路径 |

### 3.v2.8 Post-mortem

**§3.v2 closed 2026-05-27**(HEAD this commit;实现链 `d588dc1` → `933461c` → `bb8be39` → `d677c4f`;Tauri 实测后本节回填 + close)。

#### Commit 链

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `dd97656` | §3.v2 mini-scope 设计(8 主决定 + 8 次级默认 + 5 step + 8 风险 + post-mortem stub) |
| 1 | `d588dc1` | `ToolDef.execute` 加第 3 参 `ctx?: { editor?: Editor }`(opt-in,既有 tool 0 改);3 lowcode mutate tool 走 `applyPatchWithUndo`;`src/app/automation/bridge/tool-handlers.ts` 注入 editor + `beginBatch/commitBatch` 包 lowcode tool;5 新测试 |
| 2 | `933461c` | `SupabaseMutationAction.payloadEntries` + `IRSupabasePayloadEntry`;IR `resolvePayloadEntries`(key identifier-safe + dedupe + valueExpr 解析 + refs 校验);emit `emitMutationPayload`;tool input `validateSupabasePayloadEntries`;both-present → `payload-source-conflict` warn;7 IR + 4 emit + 4 tool-input case |
| 3 | `bb8be39` | `normalizeSupabaseMutationPayloadJson` 在 `@open-pencil/core/lowcode-validation`;trim 后 ∈ `['{}', '[]', '']` → `''`;tool input + IR collect 两端调;6 + 2 新 case |
| 4 | `d677c4f` | cross-walker:① mega patch under `editor.runBatch` → 1 undo entry + Cmd+Z 恢复 4 字段;② payloadEntries 端到端(tool → IR docStateReads + emit `.insert({"name": formName, ...})` + import 行 +/- 双向) |
| 5 | _this commit_ | Tauri ACK 6 项 + §3.v2.8 回填 + memory 更新 |

**测试**:`bun test ./tests/engine/{compiler,tools/lowcode,lowcode-validation,kiwi/lowcode}` 512 pass / 0 fail / 1367 expect。`bun run check` 0 error / 4 pre-existing max-lines warn(已记 prompt.md §max-lines warnings)。

#### Tauri ACK 结果(用户主导 2026-05-27)

| # | Check | Result | 备注 |
|---|---|---|---|
| 1 | AI mega update_lowcode_node + Cmd+Z 一次回 3 字段 | ✅ | 用户反馈 UI gap:BUTTON Properties 面板**没**手动编辑 `interactiveProps.text` 的入口 → §3.v3 候选(只能 AI 改) |
| 2 | docState + INPUT bindings.value + BUTTON supabaseMutation `payloadEntries` → Supabase Dashboard 写入 | ✅ | 用户反馈 UI gap:EventsPanel **没**展示 / 编辑 `payloadEntries` 的 UI(目前只能 AI 改 / read 出来的 supabaseMutation 看不到) → §3.v3 候选 |
| 3 | AI 残留 `payloadJson: '{}'` 在 delete action → 不再 silent fail | ✅ | normalize 在 tool 入口生效,Console 无 `unexpected-payload` warn |
| 4 | 零回归 spot-check | ✅ | 3 read tool / §3.x INPUT controlled / §2 Test connection / 既有 supabaseMutation payloadJson(无 entries)全 work |
| 5 | CLI `update_lowcode_node` 不挂 → fallback path | ✅ | 通过 `bun open-pencil eval tests/fixtures/pencil_button.pen -c "const {ALL_TOOLS}=...; return tool.execute(figma, args)"` 实测,返 `{ ok: true, data: { id: 'T3Um0', updated: ['interactiveProps'] } }`,无 crash。注:CLI 注入只暴露 `figma`,不暴露 `tools` 全局;prompt.md 里 `tools.update_lowcode_node(...)` 语法是 MCP / AI 侧的简写,CLI 要 `ALL_TOOLS.find(t => t.name === '...').execute(figma, args)` |
| 6 | `payloadEntries` + `payloadJson` 同时设 → entries 胜 + warn | ✅ | DevTools `action-supabase-mutation-payload-source-conflict` warn 露出;Network body 是 entries 值 |

全 6 项 ✅;0 个 🟨 / ❌。

#### Surprise 列表

1. **CLI eval globals 不含 `tools`**(ACK #5 期间发现) — `packages/cli/src/commands/eval.ts:83` 只注入 `figma` 一个全局;`tools.update_lowcode_node(...)` 这种 prompt.md 简写在 CLI 不 work。正确 incantation 是 `const { ALL_TOOLS } = await import('@open-pencil/core/tools'); const t = ALL_TOOLS.find(x => x.name === 'update_lowcode_node'); return t.execute(figma, args)`。**这不是 §3.v2 bug**(fallback 行为正确),是 prompt.md / docs 示例不准确。**fix**:更新 prompt.md ACK #5 命令,把 `tools.update_lowcode_node(...)` 改成 ALL_TOOLS 写法,或给 CLI eval 加 `tools` 全局(后者破坏 isolation,推荐前者)。
2. **BUTTON `interactiveProps.text` 无手动编辑 UI**(ACK #1 用户反馈) — Properties / EventsPanel / DesignPanel 无字段;AI 能 update_lowcode_node 改,但用户在 canvas 上手动点不开。**§3.v3 候选**(UI 补全,体量小,~1 day)。
3. **`payloadEntries` 无 EventsPanel UI**(ACK #2 用户反馈) — supabaseMutation action UI 只显示 `payloadJson`(§2),`payloadEntries` 字段只能 AI / CLI 注入,手动用户不可见。**§3.v3 候选**(UI 补全 + table-style key/valueExpr editor,体量中,~2 day)。

#### 经验沉淀(对 §1.4 / §3.8 增补 / 印证)

- **A + G** Walker union widening — §3.v2 step 2 加 `payloadEntries`,IR `bindings.ts` resolvePayloadEntries + emit `emitMutationPayload` 双侧 sweep,7 IR + 4 emit + cross-walker 钉死,**0 漏 case**(经验 A 完整 work)
- **C** No-swallow — both-present `payload-source-conflict` warn + `'{}'` normalize 两端 surface,**ACK #3 / #6 正面印证**:Console warn 即诊断信号;若静默 drop / coerce,ACK 全靠肉眼对 Dashboard 数据,debug 不可能
- **H** Tauri 实测找设计层洞 — 本期 §3.v2 设计阶段已沿用 §3.8 新经验 J(反向核),没踩 §3.x 那种基础事实洞,但 Tauri 实测**找到 2 个 UI 缺口**(ACK #1/#2 用户反馈)。这两个 unit + cross-walker **不可能发现**,仍只 Tauri 可见。**继续印证**:UX-end-to-end 必须人眼 + 鼠标手验
- **I** Module-resolve / new-symbol cross-walker — §3.v2 step 2 加 `SupabasePayloadEntry` interface 跨 4 包(`core/scene-graph` decl / `compiler/ir` collect / `compiler/emit/react` walker / `core/tools` validator),cross-walker `useDocState` import 行 +/- 双向断言;ACK #2 端到端 Dashboard 写入印证完整链路;**沿用未踩坑**
- **J**(原候选,本期升正经验)— 反向核已写进 §3.v2.5 ACK 表(6 项 × 设计阶段反向核技术依赖),Tauri 实测期没踩**任何**「链路根本不存在」型洞;唯有 ACK #1/#2 的 UI 缺口属于「scope 内不验,本就推 §3.v3」类。**经验 J 从候选转正**

#### §3.v2 follow-up(推 §3.v3 候选池)

| # | 候选 | 来源 | 体量估 |
|---|---|---|---|
| 1 | BUTTON `interactiveProps.text` 手动编辑 UI(Properties / DesignPanel) | ACK #1 用户反馈 | ~1 day |
| 2 | EventsPanel `payloadEntries` 编辑器(table-style key/valueExpr,与 `payloadJson` 并存切换 / both-present 警示) | ACK #2 用户反馈 | ~2 day |
| 3 | prompt.md ACK #5 CLI 示例改成 ALL_TOOLS 写法(顺手 fix) | surprise #1 | <1h |
| 4 | CHECKBOX / TEXTAREA / DATEPICKER / SELECT / RADIO / SWITCH controlled binding(扩 §3.x 模式) | §3.8 follow-up #3 沿用 | ~5 day |
| 5 | expression grammar 加 `$event` / `$value` token | §3.8 follow-up #4 沿用 | ~3 day(§4.2 FROZEN 绕路) |
| 6 | INPUT controlled boolean / date | §3.8 follow-up #5 沿用 | ~1 day |
| 7 | SupabaseConfigPanel RLS policy 健康检查 | §3.8 follow-up #6 沿用 | ~1 day nice-to-have |

---

## 3.v3 §3.v3 详细设计:UI 补全(BUTTON text + payloadEntries editor + CLI docs)

**Scope = §3.v3 mini-scope**(§3.v2 ACK 反馈 #1 + #2 + surprise #1 sourced;3-4 天)。§3.v3 候选池剩余 4 条(`payloadEntries` ≠ §3.v3 候选 #2 是本期内容;6 控件 controlled / `$event` token / INPUT boolean+date / RLS 健康检查)推 §3.v4 / §X.X 视用户节奏。

### 3.v3.1 现状与问题

§3.v2 closed 2026-05-27 后用户 Tauri ACK 反馈 2 处 UI 缺口 + 1 处 docs 不准:

1. **BUTTON `interactiveProps.text` 无手动编辑入口**(§3.v2 ACK #1 用户反馈)— `TextBindingPanel.vue:73-74` 在 select=`literal` 时 `commitBinding(undefined)` 直接删 `bindings.text`,**没**给 `interactiveProps.text` 的 input 入口;BUTTON 默认显示 `'Button'`,手动用户无法改文字,只能 AI / CLI 调 `update_lowcode_node` 改
2. **EventsPanel 无 `payloadEntries` 编辑器**(§3.v2 ACK #2 用户反馈)— `EventsPanel.vue:625-638` 只 input `payloadJson`(§2),`payloadEntries` 字段只能 AI / CLI 写,手动用户既看不到也不可编辑;`SupabaseFilter` 的行编辑器(EventsPanel.vue:642-)已有可镜像模板
3. **prompt.md ACK #5 CLI 示例错误**(§3.v2 surprise #1)— `tools.update_lowcode_node(...)` 这种 MCP/AI 侧的简写在 CLI eval 不 work;`packages/cli/src/commands/eval.ts:83` 只注入 `figma` 全局,正确写法是 `const { ALL_TOOLS } = await import('@open-pencil/core/tools'); const t = ALL_TOOLS.find(x => x.name === 'update_lowcode_node'); return t.execute(figma, args)`

§3.v3 mini-scope 解决这 3 条;§3.v3 **不做**:6 控件(CHECKBOX / TEXTAREA / DATEPICKER / SELECT / RADIO / SWITCH)controlled binding(体量 5 day,§3.x 模式镜像 6 倍);`$event` / `$value` token 扩 grammar;INPUT boolean / date 类型;SupabaseConfigPanel RLS 健康检查。

### 3.v3.2 关键决定

**8 主决定**(2026-05-27 ACK 锁定):

| # | 决定 | 理由 |
|---|---|---|
| a | BUTTON `interactiveProps.text` 入口**扩 `TextBindingPanel.vue`**:当 select=`literal` 且 `selectedNode.type === 'BUTTON'` 时露 input 写 `interactiveProps.text`;TEXT 节点不露 input(TEXT 文字走 `node.characters` + canvas 双击) | 最小 UI 改动 + 用户直觉(已选 literal 自然想到输入文字);TEXT 不出现 input 避免歧义 |
| b | `interactiveProps.text` 清空 input → 删字段(写 `undefined`),emit fallback `'Button'` literal(`applyButtonProps:527`) | 与 §3.2 "set null/undefined to clear" 语义一致 |
| c | `EventsPanel` `payloadEntries` 行编辑器**镜像 filters 行 UI**(`EventsPanel.vue:642-`):column input + valueExpr input + 删除按钮 + "Add entry" 按钮 | 零 UX 学习成本;reuse 既有 css/test-id 风格 |
| d | both-present(`payloadJson` + `payloadEntries` 都设)→ UI **两块都显示** + surface `payload-source-conflict` warn 条(镜像 IR warn,经验 C no-swallow);**不**强制单选 / 不自动清对方 | 镜像 runtime warn fidelity;UI 不藏 AI/CLI 设的状态 |
| e | `operation === 'delete'` → UI **隐藏** payload + entries 编辑器(强约束,与 IR `unexpected-payload` 一致);切到 delete 时已存字段**保留 raw**,切回 insert/update 字段重现 | UI 层强约束消歧;raw 保留体现「不 silent drop 用户已写的数据」(经验 C) |
| f | `validateSupabasePayloadEntries` + `PAYLOAD_ENTRY_KEY_RE` 从 `tools/modify/lowcode.ts:213-260` **上抬到** `@open-pencil/core/lowcode-validation` barrel;3 处(tool input + IR collect + EventsPanel UI)共享 | 经验 I 单源;沿用 `validateUrlTemplate` / `normalizeSupabaseMutationPayloadJson` / `validateExpression` 同位置惯例 |
| g | UI 写入走 `editor.updateNodeWithUndo`(沿用 EventsPanel 既有 mutate 模式) | §3.v2.2 #b 锁:仅 `src/app/ai/**` 注入 editor 给 tool;UI 自己**就是** editor 持有方,不绕道 ToolDef ctx |
| h | prompt.md ACK #5 CLI 写法 fix 沉到入仓位置:`docs/lowcode-phase-3.md §3.v2.5` ACK #5 加正确示例 + `packages/cli/src/commands/eval.ts` 顶部 jsdoc 1 行;prompt.md 本地顺手改(不入仓) | 经验沉淀必须入仓;prompt.md 是 untracked 模板,本地改不算交付 |

**8 次级默认**:

1. BUTTON literal input placeholder = `'Button'`(显示 emit fallback 值);test-id `lowcode-button-interactive-text`
2. payloadEntries 行 test-id `lowcode-action-supabase-payload-entry` + 子 `-key` / `-value` / `-remove`;Add 按钮 `-add-entry`;warn 条 `-payload-source-conflict`
3. payloadEntries column input 用 `PAYLOAD_ENTRY_KEY_RE` **即时校验**(invalid 红框 + `aria-invalid="true"`);dup-key 红框
4. payloadEntries valueExpr input 复用 `validateExpression`(与 filters valueExpr UX 一致)
5. delete 隐藏 payload 时 **保留 raw 数据**,只藏 UI(`v-if action.operation !== 'delete'`);切回 insert/update 字段重现
6. both-present warn 条:`text-orange-500 text-[10px]`,显示在 entries 列表上方;i18n key `panels.lowcodeActionSupabasePayloadSourceConflict`
7. **8 新 i18n key × 7 locale** = 56 新条目:`lowcodeButtonText` + `lowcodeButtonTextPlaceholder` + `lowcodeActionSupabasePayloadEntries` + `lowcodeActionSupabasePayloadAddEntry` + `lowcodeActionSupabasePayloadEntryKey` + `lowcodeActionSupabasePayloadEntryValue` + `lowcodeActionSupabasePayloadEntryKeyInvalid` + `lowcodeActionSupabasePayloadSourceConflict`
8. 不动既有 test-id;新增一律 `lowcode-` 前缀(CONTRIBUTING.md 规则)

**经验 J 反向核**(每条 ACK 倒推技术链,0 链路不存在):

| 假设 | 技术链反向核 |
|---|---|
| BUTTON literal input 改值 → emit 出新字 | ✅ `editor.updateNodeWithUndo` → `SceneNode.interactiveProps` 已支持 → `applyButtonProps:527` `ip.text` 已读 |
| entry 新增 + emit → Supabase 写入 | ✅ §3.v2 step 2 `resolvePayloadEntries` IR + `emitMutationPayload` 已实现;`SceneNode.events` 已支持 entries 字段 |
| both-set UI surface warn | ✅ UI 镜像 IR `payload-source-conflict`(已存),只渲染 warn 条,**不**重做校验逻辑 |
| delete 隐藏 payload | ✅ `v-if action.operation !== 'delete'`;raw 数据不动 |
| dup-key UI 红框 | ✅ `validateSupabasePayloadEntries` 上抬后 UI 复用 |

### 3.v3.3 公开 API / Schema 改动

- ➕ **新 export** `@open-pencil/core/lowcode-validation` barrel:
  - `validateSupabasePayloadEntries(where: string, raw: unknown): { ok: true; entries: SupabasePayloadEntry[] } | { ok: false; error: string }`
  - `PAYLOAD_ENTRY_KEY_RE: RegExp`
  - 签名 0 改动,纯位置迁移(`tools/modify/lowcode.ts:213-260` → `packages/core/src/lowcode-validation/supabase-payload-entries.ts`)
- ➕ **8 i18n key × 7 locale** = 56 新条目(详 §3.v3.2 次级默认 #7)
- ➕ **7 新 test-id**(全 `lowcode-` 前缀):
  - `lowcode-button-interactive-text`
  - `lowcode-action-supabase-payload-entry` + `-key` / `-value` / `-remove`
  - `lowcode-action-supabase-payload-add-entry`
  - `lowcode-action-supabase-payload-source-conflict`
- 0 SceneNode / ActionDef shape 改动
- 0 Kiwi 改动
- 0 既有 `bindings.text` 通道改动 / `EDITOR_UNDO_TOOLS` 改动 / `applyPatchWithUndo` 签名改动

### 3.v3.4 内部实现拆解

#### `lowcode-validation/supabase-payload-entries.ts`(新文件)

从 `tools/modify/lowcode.ts:213-260` 抬出:
- `export const PAYLOAD_ENTRY_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/`
- `export function validateSupabasePayloadEntries(where: string, raw: unknown): ValidationResult` —— 校验 raw 是数组、每项有 `key` 和 `valueExpr`、key 合法、key 唯一、valueExpr 非空且 parse 通过

`packages/core/src/lowcode-validation/index.ts` barrel 加 export。`tools/modify/lowcode.ts` 改为 `import { validateSupabasePayloadEntries, PAYLOAD_ENTRY_KEY_RE } from '@open-pencil/core/lowcode-validation'`,移除私有定义。

#### `TextBindingPanel.vue`

- 新 computed `buttonLiteralText`:`selectedNode.value?.type === 'BUTTON' ? (selectedNode.value.interactiveProps?.text as string ?? '') : null`
- `<input v-if="binding == null && buttonLiteralText !== null"` 在 select 下方;`@change` 写 `editor.updateNodeWithUndo(id, { interactiveProps: { ...prev, text: value || undefined } }, 'Update button text')`
- 空字符串 → 写 `undefined`(触发 emit fallback `'Button'`)
- placeholder = i18n `panels.lowcodeButtonTextPlaceholder`(默认 'Button')
- test-id `lowcode-button-interactive-text`

#### `EventsPanel.vue`

- `updateEntry(actionId, index, patch)` / `addEntry(actionId)` / `removeEntry(actionId, index)`:镜像 `updateFilter` / `addFilter` / `removeFilter`(已有 ~640 行)
- `addEntry` 默认 `{ key: '', valueExpr: '' }`
- 完整 payload 块包 `v-if action.operation !== 'delete'`(insert/update/upsert 时显示)
- payload 块内布局:
  1. 既有 `payloadJson` input(不动)
  2. **新** payloadEntries 列表(每行:column input + valueExpr input + remove 按钮)
  3. **新** "Add entry" 按钮
  4. **新** both-present warn 条(top of entries 列表,`v-if conflictWarn`)
- `conflictWarn = computed`:`action.payloadJson?.trim() && (action.payloadEntries?.length ?? 0) > 0`
- entry column input 即时校验:`PAYLOAD_ENTRY_KEY_RE.test(entry.key)`,失败 → `border-red-500 + aria-invalid="true"`
- entry dup-key 校验:对每条 entry 计算其 key 在 entries 中重复 → 红框
- entry valueExpr input 复用 `validateExpression`(与 filters valueExpr 一致)

#### docs / cli

- `docs/lowcode-phase-3.md §3.v2.5` ACK #5 那行后加示例 block:
  ```sh
  bun open-pencil eval <file.pen> -c "
    const { ALL_TOOLS } = await import('@open-pencil/core/tools')
    const t = ALL_TOOLS.find(x => x.name === 'update_lowcode_node')
    return t.execute(figma, { id: '<node-id>', patch_json: '...' })
  "
  ```
- `packages/cli/src/commands/eval.ts` 顶部 jsdoc 加 1 行:`// To invoke a ToolDef: const { ALL_TOOLS } = await import('@open-pencil/core/tools'); ALL_TOOLS.find(t => t.name === '...').execute(figma, args)`

### 3.v3.5 成功标准

1. `bun test ./tests/engine/lowcode-validation/` 全绿(含新文件 `supabase-payload-entries.test.ts` 移过来)
2. `bun test ./tests/engine/tools/lowcode/` 全绿(import 改后零回归)
3. `bun run check` 全绿(含 `check:i18n` 钉 8 新 key × 7 locale)
4. **Tauri 实测(用户主导)~7 项 user-ACK**:
   1. BUTTON Properties → source=literal → input 出现 → 改 'Save' → canvas 即时刷 + emit `<button>Save</button>`
   2. BUTTON literal input 清空 → emit fallback `'Button'`
   3. EventsPanel insert + Add 2 entries `{ name: formName, age: '25' }` → Preview 提交后 Supabase 行 `name=<INPUT>, age=25`
   4. EventsPanel 同时设 `payloadJson` + `payloadEntries` → UI 橙色 `payload-source-conflict` warn 条;Preview body 是 entries 值(不含 payloadJson 静态值)
   5. EventsPanel 切 op=`delete` → payload 编辑器 + entries 编辑器**消失**;切回 `insert` → 字段重现(raw 保留)
   6. dup-key(两 entry 都叫 `name`)→ 第二行红框 + aria-invalid
   7. 零回归:§3.v2 6 ACK 仍 work;TEXT 节点 TextBindingPanel literal **不**露 input
5. 不破坏 Phase 0 §8 / Phase 1 / Phase 2 §9.2 §2.2 §3.2 §4.2 §6.2 §7.2 §8.2 / Phase 3 §2.2 §3.2 §3.x §3.v2.2 任一锁定决定

### 3.v3.6 工作分解(建议 1 名工程师,3-4 天)

| Step | 任务 | 验收 / commit |
|---|---|---|
| 0 | §3.v3 设计 doc 写入 + commit | 本 commit `docs(lowcode): §3.v3 mini-scope detailed design (UI补全 + payloadEntries editor + CLI docs)` |
| 1 | 上抬 `validateSupabasePayloadEntries` + `PAYLOAD_ENTRY_KEY_RE` 到 `@open-pencil/core/lowcode-validation`;tools/modify import 改;tests 迁移 | `bun test ./tests/engine/lowcode-validation/` + `tools/lowcode/` 全绿;`bun run check` 全绿;`refactor(lowcode): step 1 — lift validateSupabasePayloadEntries (§3.v3)` |
| 2 | `TextBindingPanel.vue` BUTTON-only literal input;2 i18n key × 7 locale;单测 | `bun run check` 全绿(`check:i18n` 钉);`feat(lowcode): step 2 — BUTTON interactiveProps.text editor (§3.v3)` |
| 3 | `EventsPanel.vue` payloadEntries 行编辑器 + Add + both-present warn + delete v-if;6 i18n key × 7 locale | `bun run check` 全绿;`feat(lowcode): step 3 — EventsPanel payloadEntries editor + delete-hide + conflict-warn (§3.v3)` |
| 4 | docs fix:`§3.v2.5` ACK #5 + `cli/commands/eval.ts` jsdoc | `bun run check` 全绿;`docs(lowcode): step 4 — CLI eval ALL_TOOLS example (§3.v3)` |
| 5 | Tauri 实测 7 项 + §3.v3.8 post-mortem + 关闭 + memory | 7 ACK 全 ✅;`docs(lowcode): §3.v3 Tauri verification + close` |

### 3.v3.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 上抬 `validateSupabasePayloadEntries` 破坏 tool import / 既有单测路径 | 低 | TS strict + step 1 单测 + Steiger 钉 import 链 |
| TEXT 节点漏 v-if 也露 BUTTON input | 低 | step 2 单测 TEXT 节点 v-if=false |
| both-present warn 文案过长撑爆窄面板 | 低 | `text-[10px] truncate` + 真宽度调整 |
| delete v-if 后用户以为 payload 字段没了 | 中 | raw 保留 + 切回 insert/update 字段重现(经验 C);可选加 helper text "Delete operations cannot have payload" |
| 经验 I — `validateSupabasePayloadEntries` barrel + 跨包 import 双侧改 | 中 | step 1 单测 + Steiger 钉 |
| 8 i18n key × 7 locale 漏译 | 中 | `check:i18n` 钉死 |
| BUTTON literal input + bindings.text 共存语义混淆(`bindings.text` 优先于 `interactiveProps.text`) | 低 | helper text 标 source 优先级;`applyButtonProps:516-528` 已有清晰 fallback 链 |

### 3.v3.8 Post-mortem

**§3.v3 closed 2026-05-27**(HEAD this commit;实现链 `ee96a2f` → `754bb3c` → `f862be4` → `65c53ab` → `fbf47d9`,Tauri 7 ACK 全绿后本节回填 + close)。

#### Commit 链

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `77d9852` | §3.v3 mini-scope 设计(8 主决定 + 8 次默 + 5 step → 6 step + 7 风险 + post-mortem stub) |
| 1 | `ee96a2f` | `validateSupabasePayloadEntries` + `PAYLOAD_ENTRY_KEY_RE` 上抬到 `@open-pencil/core/lowcode-validation`;`tools/modify/lowcode.ts` + `compiler/ir/collect/bindings.ts` 双侧改 import 单源;11 新单测 |
| 2 | `754bb3c` | `TextBindingPanel.vue` BUTTON literal 模式露 `interactiveProps.text` input(TEXT 节点不露);2 i18n key × 7 locale |
| 3 | `f862be4` | `EventsPanel.vue` `payloadEntries` 行编辑器(镜像 filters 行 UI)+ delete v-if 隐藏 + both-present 橙色 conflict warn 条;raw 数据保留切回 op 重现;6 i18n key × 7 locale;5 新 test-id |
| 4 | `65c53ab` | `docs §3.v2.5 ACK #5` + `cli/commands/eval.ts` 顶部加 ALL_TOOLS 正确写法示例 |
| 6 | `fbf47d9` | payloadEntries valueExpr placeholder hint(ACK #3 surprise sourced)— 1 i18n key × 7 locale |
| 5 | _this commit_ | Tauri ACK 7 + 重测 + §3.v3.8 回填 + 关闭 + memory 更新 |

**测试**:`bun run check` 全程 0 error / 4 pre-existing max-lines warn / 0 clones;step 1 的 11 新单测全绿;现有 lowcode/compiler/tools 测试零回归(363 pass via `tests/engine/tools/lowcode/ + compiler/`)。

#### Tauri ACK 结果(用户主导 2026-05-27)

| # | Check | Result | 备注 |
|---|---|---|---|
| 1 | BUTTON Properties Text source=Literal → input 出现 → 改 'Save' → canvas 即时 + emit | ✅ | |
| 2 | BUTTON literal input 清空 → fallback `'Button'` | ✅ | |
| 3 | EventsPanel insert + Add 2 entries(name+age)→ Supabase Dashboard 写入 | ✅(初测后 retest)| 初测踩坑:用户给 `email` 字段写 `alice@example.com`(无引号)→ valueExpr parser 报 `unexpected character '@'`。识别为 §3.v3 surprise #1 → step 6 加 placeholder hint(`e.g. formName or 'static'`)→ retest ✅ |
| 4 | both 设 `payloadJson` + `payloadEntries` → UI 橙色 warn + body 是 entries 值 | ✅ | |
| 5 | 切 op=delete → payload + entries 区消失;切回 insert → 字段重现(raw 保留)| ✅ | |
| 6 | dup-key 第二行红框 + aria-invalid | ✅ | |
| 7 | 零回归:§3.v2 6 ACK 仍 work;TEXT 节点 TextBindingPanel literal **不**露 BUTTON input | ✅ | |

全 7 项 ✅;ACK #3 经一次踩坑 + step 6 修后 retest ✅。

#### Surprise 列表

1. **valueExpr 字符串字面值必须加引号**(ACK #3 用户反馈)— `payloadEntries[].valueExpr` 走 §7.3 / §4.2 expression sublanguage(同 `filters.valueExpr` / `setState.valueExpr`),tokenizer 在 `'`/`"` 包裹外的 `@` `.` 等字符 throw `unexpected character`。用户输 `alice@example.com`(无引号)→ parser fail。**根因**:UI placeholder 只写 `Value expression` 不暗示"这是表达式不是 raw 字符串"。filters 有同问题但常用数字/标识符所以没暴露。**修法**:step 6 新 i18n key `lowcodeActionSupabasePayloadEntryValuePlaceholder` = `e.g. formName or 'static'`(中文 `如 formName 或 'static'(字符串要加引号)`),aria-label 保留 `Value expression` 清晰。filters 这边**没修**(scope 外,推 §3.v4 / §X 视后续 UX 反馈)。
2. **(无,#1 是本期唯一 surprise)**

#### 经验沉淀(对 §1.4 / §3.8 / §3.v2.8 增补 / 印证)

- **A + G** Walker union widening — §3.v3 step 1 上抬纯 import 重定向,IR collect + tool 两侧验证零回归,A 完整 work。
- **C** No-swallow — `payload-source-conflict` warn 现在**双层** surface(IR collect runtime warn + EventsPanel UI 橙色提示条),ACK #4 一眼可见;step 3 delete v-if 选择"raw 保留 / 仅藏 UI"而非"silent 删",切回 insert/update 字段重现 = 真正的 no-swallow 实现。
- **H** Tauri 实测找设计层洞 — §3.v3 设计阶段反向核 7 项 ACK 都对应到现有 schema/IR/emit/UI 路径,**0 链路不存在**;但 Tauri 实测仍找到 1 个 UX 缺口(ACK #3 引号坑)。**继续印证**:即便每条 ACK 技术链都核过,UX-discoverability 维度仍只 Tauri 可见;经验 H 含义应扩为「Tauri 不止找设计洞,还找 UX 引导洞」。
- **I** Module-resolve / cross-file dedup — step 1 把 `validateSupabasePayloadEntries` + 同名常量 `PAYLOAD_ENTRY_KEY_RE`(原存 2 份)抬到单源,Steiger + check-locales 双栅栏过;0 漏 callsite。
- **J**(2026-05-27 §3.v2.8 promoted)— §3.v3 设计阶段对 7 ACK 全反向核;0 链路不存在 surprise;**升级**:反向核应不仅核「技术链是否存在」,也核「UI 是否引导用户用对路径」(本期 ACK #3 引号坑就是技术链存在但 UI 不引导)。**经验 J refined**:`§X.5 ACK 表每条问两个问题:(1) 技术链是否存在?(2) UI placeholder / helper / label 是否引导用户用对路径?任一缺 → 推回 §X.2 或标 design-only`。

#### §3.v3 未做 / §3.v4 候选(沿用 §3.v2.8 候选池 + 本期增量)

| # | 候选 | 来源 | 体量估 |
|---|---|---|---|
| 1 | filters `valueExpr` 同 hint placeholder(`Filter row UI 引号坑`)| §3.v3 ACK #3 sibling | <1 day |
| 2 | CHECKBOX / TEXTAREA / DATEPICKER / SELECT / RADIO / SWITCH controlled bindings(§3.x mirror)| §3.8 follow-up #3 沿用 | ~5 day |
| 3 | `$event` / `$value` token in expression grammar | §3.8 follow-up #4 沿用 | ~3 day(§4.2 FROZEN 绕路) |
| 4 | INPUT controlled boolean / date types | §3.8 follow-up #5 沿用 | ~1 day |
| 5 | SupabaseConfigPanel RLS policy 健康检查 | §3.8 follow-up #6 沿用 | ~1 day nice-to-have |

**推荐下一轮**:§3.v4 #1(filters hint 顺手,<1 day)+ #2(6 控件 controlled,5 day)= §3.v4 mini-scope,~6 day。或直接 §4 / §5(协作 / 部署)。

---

## 3.v4 §3.v4 详细设计:filters hint + 6 控件 controlled bindings

**Scope = §3.v4 mini-scope**(§3.v3 候选池 #1 + #2,5-6 天)。§3.v4 **不做**:`$event` / `$value` token 扩 grammar(§3.8 follow-up #4,§4.2 FROZEN 绕路);INPUT controlled `boolean` / `date` targetType(boolean 本期顺带 CHECKBOX/SWITCH 已扩;date 留 §3.v5 需要 'YYYY-MM-DD' 格式验证);SupabaseConfigPanel RLS 健康检查。

### 3.v4.1 现状与问题

§3.v3 closed 2026-05-27 后:

1. **filters valueExpr 引号坑**(§3.v3 ACK #3 sibling) — `EventsPanel.vue:809-820` filter valueExpr input **无 placeholder**;同 §3.v3 step 6 修法,加 hint。`filters.valueExpr` 走 §7.3 / §4.2 expression sublanguage,字符串必须引号(`'static'`),identifier 引 state(`formId`)。filter 语境数字比较(`id = 1`)多,但 like / in 操作字符串字面也常见
2. **§3.x 只 INPUT 一种 controlled**(§3.v2 follow-up #3 + #5 沿用) — Phase 2/3 实现的 6 类型 interactive components 全 emit `defaultValue` / `defaultChecked` uncontrolled:
   - `CHECKBOX` `<input type="checkbox" defaultChecked={ip.checked}>` (`applyToggleProps`)
   - `SWITCH` 同 CHECKBOX + `role="switch"` (`applyToggleProps('switch')`)
   - `TEXTAREA` `<textarea defaultValue={ip.value} placeholder={ip.placeholder}>` (`applyTextInputProps`)
   - `SELECT` `<select><option value={opt}>{opt}</option>...` (`applySelectOptions`)
   - `RADIO` `<label><input type="radio" name={groupName} value={opt} [defaultChecked]/>{opt}</label>...` (`applyRadioOptions`)
   - `DATEPICKER` `<input type="date" defaultValue={ip.value}>` (`applyDatePickerProps`)

   `applyControlledInput:296` early-return `if (node.type !== 'INPUT') return undefined` 卡住其它 6 类型。`IRControlledInput.write.targetType: 'string' \| 'number'` 不含 `'boolean'` 故 CHECKBOX/SWITCH 也无法走 docState 写。**form 端 → state 端**链路只 INPUT;Bubble-like 表单基本只能用 INPUT 一种字段

### 3.v4.2 关键决定

**8 主决定**(2026-05-27 ACK 锁定):

| # | 决定 | 理由 |
|---|---|---|
| a | `IRControlledInput.write.targetType` 扩 `'string' \| 'number' \| 'boolean'`(单一 shape,**不**新增 IR 变体) | 单源 dispatch;emit branch 按 targetType + node.type 双键展开;最小 IR 表面扩张 |
| b | `applyControlledInput:296` early-return 白名单从 `INPUT` 扩到 **7 类型**(`INPUT/TEXTAREA/CHECKBOX/SWITCH/SELECT/RADIO/DATEPICKER`);每类型在 `resolveValueBinding` 内部走 per-type 合法 targetType 校验 | switch by node.type 集中校验;UI / IR / emit 三处共享 |
| c | `resolveValueBinding` per-type targetType 规则:**INPUT** = string \| number;**TEXTAREA/SELECT/RADIO/DATEPICKER** = string;**CHECKBOX/SWITCH** = boolean | 与 React 控件 value/checked 语义一致;number 单 INPUT 支持(textarea/date 数值不实用) |
| d | emit 分支:**text-like(targetType ∈ string/number)** → `value={read}` + `onChange={(e) => write(<coerce>(e.target.value))}`(沿用 §3.x);**boolean** → `checked={read}` + `onChange={(e) => write(e.target.checked)}` | 单 boolean 写器无 coerce,Number(...) 只在 number 路径;清晰可枚举 |
| e | RADIO controlled:每个 `<input type="radio">` emit `checked={read === <optValue>}` + 共享 `onChange={(e) => write(e.target.value)}`(每 radio 都 attach);丢弃 `defaultChecked` | 标准 React 受控 radio group 写法;与 SELECT 都是单值选择故复用 onChange writer |
| f | SELECT controlled:`<select value={read} onChange={...}>`;option 不带 `defaultSelected`;uncontrolled 时保持现状 | 标准 React 受控 select |
| g | 既有 onChange 与 controlled value 冲突 → drop 用户 onChange + warn **沿用** `input-controlled-onchange-conflict` code,**不**改 code 字面(已锁);message 模板改 `controlled {type} {nodeId} has user onChange; dropped` | 不动锁定 warning code(经验 C 单源);用 message 描述新覆盖类型 |
| h | UI:`InputValueBindingPanel.vue` **重命名** `ValueBindingPanel.vue`;DesignPanel.vue:114 `v-if` 扩 7 类型;panel 内部按 `selectedNode.type` 路由候选 state 过滤(string-only / string+number / boolean-only)+ 切换 hint 文案;test-id 改 `lowcode-value-binding` | 单 Vue 组件 + 内部路由(经验 I 单源);DesignPanel 一行 v-if 改 |

**8 次级默认**:

1. filters valueExpr placeholder 新 i18n key `lowcodeActionSupabaseFilterValuePlaceholder` = `e.g. id, count, 'static'`(中文 `如 id, count, 'static'(字符串要加引号)`)— **不**复用 step-6 entry key,filter 语境数字/标识符更多
2. `lowcode-input-value-binding*` test-id 全部改 `lowcode-value-binding*`(同步 panel 改名);**不**保留 alias(test-id 内部 contract,直接迁移 + 更新 e2e)
3. boolean docState/page-state 默认值 dropdown 行 `{name} (boolean)` 与既有 `(string)` / `(number)` 一致风格
4. 6 类型新 onChange 冲突 warn message 用 `controlled {type} {nodeId} has user-defined onChange; dropped` 统一模板;code 不变
5. cross-walker 新用例每类型 1 个(6 用例)+ filter hint 0 walker(纯 UI)
6. i18n 新 key:`lowcodeActionSupabaseFilterValuePlaceholder` + `lowcodeValueBindingBooleanHint` = **2 新 key × 7 locale** = 14 条目。原 INPUT i18n key 4 个(`lowcodeInputValue` / `lowcodeInputValueUncontrolled` / `lowcodeInputValueHint` / `lowcodeInputValueNoStringStates`)**重命名** `lowcodeValueBinding*`;**不**保留 alias(i18n key 内部 contract)
7. emit walker 改动 = `element.ts` `formatAttrs` 加 boolean 分支 + RADIO/SELECT 分支;`applyControlledInput` switch 扩
8. SceneNode shape 0 改动;Kiwi 0 改动;`bindings.value` 通道名锁(§3.x 沿用);`EDITOR_UNDO_TOOLS` / `applyPatchWithUndo` 0 改动

**经验 J 双问题反向核**(每 ACK × Q1 Q2,0 漏):

| ACK 项 | Q1 技术链 | Q2 UI 引导 |
|---|---|---|
| filter valueExpr placeholder hint | ✅ existing input + placeholder attr | ✅ 本期加 hint 即修 |
| INPUT 仍 work(零回归) | ✅ unchanged path | ✅ unchanged |
| CHECKBOX bool docState → 勾选状态写入 | ✅ widen targetType + apply 白名单 + emit boolean branch | ✅ ValueBindingPanel 改名 + boolean filter |
| SWITCH bool docState | ✅ 同 CHECKBOX(同 applyToggleProps) | ✅ 同 CHECKBOX |
| TEXTAREA string docState | ✅ 白名单加 + 同 INPUT string path | ✅ 改名 panel + string filter |
| SELECT string docState options 切换 | ✅ 白名单加 + `<select value=>` emit | ✅ 改名 panel + string filter |
| RADIO string docState 选项切换 | ✅ 白名单加 + 每 radio checked + 共享 onChange | ✅ 改名 panel + string filter |
| DATEPICKER string docState 日期 | ✅ 白名单加 + 同 INPUT string path | ✅ 改名 panel + string filter |

### 3.v4.3 公开 API / Schema 改动

- ✏️ **改型** `IRControlledInput.write.targetType`:`'string' | 'number'` → `'string' | 'number' | 'boolean'`(`packages/compiler/src/ir/types.ts:40-43`)
- ✏️ **改型** `resolveValueBinding` 内部 per-type targetType 规则(签名不变;`packages/compiler/src/ir/collect/bindings.ts:157-236`)
- ✏️ **改型** `applyControlledInput` 早返白名单(签名不变;`packages/compiler/src/ir/collect/tree.ts:290-309`)
- ✏️ **emit** `formatAttrs` + `controlledOnChangeBody` 加 boolean 分支 + RADIO/SELECT 分支(`packages/compiler/src/adapters/react/emit/element.ts:88-136`)
- ➕ **i18n 新 key**:`lowcodeActionSupabaseFilterValuePlaceholder` + `lowcodeValueBindingBooleanHint` × 7 locale
- 🔁 **i18n 重命名**:`lowcodeInputValue*` 4 个 → `lowcodeValueBinding*`(不保留 alias)
- 🔁 **test-id 重命名**:`lowcode-input-value-binding*` → `lowcode-value-binding*`(不保留 alias)
- 🔁 **文件重命名**:`InputValueBindingPanel.vue` → `ValueBindingPanel.vue`;DesignPanel.vue:114 v-if 扩 7 类型
- 0 SceneNode / ActionDef / Kiwi 改动
- 0 `bindings.value` 通道名改动(§3.x 锁继承)
- 0 `EDITOR_UNDO_TOOLS` / `applyPatchWithUndo` / `validateSupabasePayloadEntries` / `normalizeSupabaseMutationPayloadJson` 改动

### 3.v4.4 内部实现拆解

#### `IRControlledInput.write.targetType` 扩 boolean

`packages/compiler/src/ir/types.ts:40-43`:

```ts
export interface IRControlledInput {
  read: string
  write: { kind: 'docState' | 'state'; name: string; targetType: 'string' | 'number' | 'boolean' }
}
```

#### `resolveValueBinding` per-type targetType

`packages/compiler/src/ir/collect/bindings.ts` — 当前 line 194 / 224 都硬编码 `'string' \| 'number'`。改为按 `node.type` 决定合法 targetType set:

```ts
function allowedTargetTypes(nodeType: SceneNode['type']): Set<'string' | 'number' | 'boolean'> {
  if (nodeType === 'INPUT') return new Set(['string', 'number'])
  if (nodeType === 'CHECKBOX' || nodeType === 'SWITCH') return new Set(['boolean'])
  // TEXTAREA / SELECT / RADIO / DATEPICKER → string only
  return new Set(['string'])
}
```

type 不匹配 → warn `binding-value-bad-state-type` + return null(沿用既有 code)。

#### `applyControlledInput` 白名单

`packages/compiler/src/ir/collect/tree.ts:296`:

```ts
const CONTROLLED_TYPES = new Set<SceneNode['type']>([
  'INPUT', 'TEXTAREA', 'CHECKBOX', 'SWITCH', 'SELECT', 'RADIO', 'DATEPICKER'
])
if (!CONTROLLED_TYPES.has(node.type)) return undefined
```

加完后 drop uncontrolled fallback attrs(per-type):

- TEXTAREA/INPUT: drop `defaultValue`(已有 `delete attrs.defaultValue`)
- CHECKBOX/SWITCH: drop `defaultChecked`
- DATEPICKER: drop `defaultValue`
- SELECT: 0(option-level)
- RADIO: 0(option-level,emit 端 skip `defaultChecked`)

#### emit 分支

`packages/compiler/src/adapters/react/emit/element.ts:101-110`:

```ts
if (controlled) {
  if (controlled.write.targetType === 'boolean') {
    parts.push(`checked={${controlled.read}}`)
    parts.push(`onChange={(e) => ${controlledOnChangeBody(controlled)}}`)
  } else {
    // text-like (string / number) — sync §3.x path
    if (controlled.write.targetType === 'number' && !('type' in attrs)) {
      parts.push('type="number"')
    }
    parts.push(`value={${controlled.read}}`)
    parts.push(`onChange={(e) => ${controlledOnChangeBody(controlled)}}`)
  }
}
```

`controlledOnChangeBody` 加 boolean 分支:

```ts
function controlledOnChangeBody(c: IRControlledInput): string {
  const valueExpr =
    c.write.targetType === 'boolean' ? 'e.target.checked'
    : c.write.targetType === 'number' ? 'Number(e.target.value)'
    : 'e.target.value'
  // (same docState / state dispatch)
}
```

#### SELECT / RADIO controlled

SELECT(`applySelectOptions`)— 当前 emit option list 不变;controlled value 通过 `<select value={read}>` 在 parent attr 拼上(formatAttrs 已处理)。option-level 无需改。

RADIO(`applyRadioOptions`)— 每 radio 当前 emit `defaultChecked` if `opt === selected`;controlled 时 emit `checked={read === <optValue>}` + `onChange`。需要把 `controlled` 传进 `applyRadioOptions`。建议:radio 不走 parent-level formatAttrs(因为 radio group 没单一 root element 容器),改为 per-radio inputAttrs 注入 `checked` + `onChange`(JSX 表达式属性)。

#### `ValueBindingPanel.vue` 改名 + 7 类型路由

- `src/components/properties/Lowcode/ValueBindingPanel.vue`(原 `InputValueBindingPanel.vue`)
- 顶部 computed `targetTypeFilter`:by `selectedNode.value?.type` 返 `('string' | 'number' | 'boolean')[]`
- `candidatePageStates` / `candidateDocStates` filter 按 `targetTypeFilter`
- hint 文案 by node type:CHECKBOX/SWITCH → `lowcodeValueBindingBooleanHint`;其余沿用 `lowcodeValueBindingHint`(原 `lowcodeInputValueHint`)
- test-id `lowcode-value-binding` + 子项

`src/components/DesignPanel.vue:114`:

```vue
<ValueBindingPanel
  v-if="['INPUT','TEXTAREA','CHECKBOX','SWITCH','SELECT','RADIO','DATEPICKER'].includes(node.type)"
/>
```

#### filters valueExpr placeholder

`src/components/properties/Lowcode/EventsPanel.vue:809-820` filter valueExpr input 加 `:placeholder="panels.lowcodeActionSupabaseFilterValuePlaceholder"`。零逻辑改动,纯 placeholder + 1 i18n key × 7 locale。

### 3.v4.5 成功标准 + Tauri ACK

1. `bun test ./tests/engine/compiler/` 全绿(含 6 新 emit + IR collect 用例)
2. `bun test ./tests/engine/tools/lowcode/` 全绿(import 改后零回归)
3. `bun run check` 全绿(`check:i18n` 钉 2 新 key + 4 重命名 × 7 locale)
4. **Tauri 实测(用户主导)~8 项 user-ACK**:

| # | ACK | 反向核 Q1/Q2 |
|---|---|---|
| 1 | filter valueExpr input 出 placeholder hint;不影响既有 filter 行为 | Q1 ✅/Q2 ✅ |
| 2 | docState `agreed: boolean` + CHECKBOX bindings.value 绑 `agreed` → Preview 勾选/取消勾选 → DevTools `useDocState('agreed')` 实时变化 | Q1 ✅/Q2 ✅ |
| 3 | SWITCH 同 CHECKBOX(`agreed` boolean docState) | Q1 ✅/Q2 ✅ |
| 4 | docState `bio: string` + TEXTAREA bindings.value → Preview 多行输入 → docState 实时变化 | Q1 ✅/Q2 ✅ |
| 5 | docState `country: string` + SELECT(options `[US,CN,JP]`)bindings.value 绑 `country` → 切换 option → docState 实时变化 | Q1 ✅/Q2 ✅ |
| 6 | docState `gender: string` + RADIO(options `[M,F]` + groupName `g`)bindings.value 绑 `gender` → 切换 radio → docState 实时变化 | Q1 ✅/Q2 ✅ |
| 7 | docState `dob: string` + DATEPICKER bindings.value → Preview 选日期 → docState 写入 `'YYYY-MM-DD'` | Q1 ✅/Q2 ✅ |
| 8 | 零回归:§3.v3 7 ACK 仍 work;§3.x INPUT controlled 仍 work;type 不匹配(给 CHECKBOX 绑 string docState)→ fallback uncontrolled + warn `binding-value-bad-state-type` | Q1 ✅/Q2 ✅ |

5. 不破坏 Phase 0 §8 / Phase 1 / Phase 2 §9.2 §2.2 §3.2 §4.2 §6.2 §7.2 §8.2 / Phase 3 §2.2 §3.2 §3.x §3.v2.2 §3.v3.2 任一锁定决定

### 3.v4.6 工作分解(建议 1 名工程师,5-6 天)

| Step | 任务 | 验收 / commit |
|---|---|---|
| 0 | §3.v4 设计 doc 写入 + commit | `docs(lowcode): §3.v4 mini-scope detailed design (filters hint + 6 controlled bindings)` |
| 1 | filters valueExpr placeholder hint(#1)+ 1 i18n key × 7 locale | `bun run check` 全绿;`fix(lowcode): step 1 — filters valueExpr placeholder hint (§3.v4)` |
| 2 | `IRControlledInput.write.targetType` 扩 boolean + `resolveValueBinding` per-type 规则 + IR collect 单测 6 case(每类型 1 + bool typecheck)| `bun test ./tests/engine/compiler/` + `bun run check` 全绿;`feat(lowcode): step 2 — IRControlledInput boolean + per-type validation (§3.v4)` |
| 3 | emit:`formatAttrs` + `controlledOnChangeBody` 加 boolean 分支 + SELECT/RADIO 分支;6 emit 单测;cross-walker 6 用例 | `bun test ./tests/engine/compiler/` + `tools/lowcode/` 全绿;`feat(lowcode): step 3 — emit controlled CHECKBOX/SWITCH/TEXTAREA/SELECT/RADIO/DATEPICKER (§3.v4)` |
| 4 | UI:`InputValueBindingPanel.vue` → `ValueBindingPanel.vue` rename + 7 类型 v-if + per-type candidate filter + 1 i18n key 加(boolean hint)+ 4 key 改名 × 7 locale + test-id 改名 | `bun run check` + `check:i18n` 全绿;`refactor(lowcode): step 4 — ValueBindingPanel 7 component types (§3.v4)` |
| 5 | Tauri 实测 8 项 + §3.v4.8 post-mortem + 关闭 + memory | 8 ACK 全 ✅;`docs(lowcode): §3.v4 Tauri verification + close` |

### 3.v4.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| `IRControlledInput.targetType` 扩 boolean 破坏既有 INPUT only string/number 假设 | 中 | TS strict;step 2 单测既有 INPUT 路径零回归;cross-walker 钉 |
| 6 类型 cross-walker 缺一个 → silent 漏 emit boolean / SELECT / RADIO branch | 高 | step 3 cross-walker 每类型 1 用例必带 import 行 +/- 双向断言(经验 A/G/I) |
| RADIO 每 option emit onChange 字符串重复(每 radio 都 attach 同一函数体)→ 生成代码膨胀 | 低 | 可接受;React 抽 helper 是 §4.v3 优化项,本期不做 |
| SELECT controlled value 与现有 `optionStrings` 渲染逻辑交互 → option `defaultSelected` 与 value 矛盾 | 中 | step 3 emit drop `defaultSelected`;单测覆盖 |
| panel 重命名 + test-id 重命名 → 既有 e2e / Steiger import 链断 | 中 | step 4 同 commit 改 DesignPanel import + grep 所有 test-id 引用替换;Steiger 钉新 import |
| i18n key 重命名 → 7 locale × 4 key 全替换漏译 | 中 | check-locales 钉死;单 commit 同步 7 locale |
| 经验 J Q2 — 7 类型 UI hint 文案不够 actionable | 中 | step 4 boolean / string 各 hint;Tauri ACK 8 验 |
| DATEPICKER `'YYYY-MM-DD'` 格式校验缺失 → 用户输非法日期写入 docState | 低 | 本期不做(留 §3.v5 INPUT controlled boolean/date type 候选);native `<input type=date>` 浏览器自带格式校验已基本兜底 |

### 3.v4.8 Post-mortem

**§3.v4 closed 2026-05-27**(HEAD this commit;Tauri ACK 8/8 ✅ 后回填)。Scope 从 5 step 扩到 **10 commit + 4 mid-flight hotfix**(step 7/8/9/9b),全部源于 Tauri 实测发现的"用户心智模型 vs 我们实现"错位 — 经验 J 再次细化。

#### Commit 链

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `6504686` | §3.v4 mini-scope 8 主决定 + 8 次默 + 5 step + 7 风险 |
| 1 | `8f5ee2c` | filters valueExpr placeholder hint(1 i18n × 7 locale) |
| 2 | `821868f` | `IRControlledInput.targetType` 扩 boolean + `resolveValueBinding` per-type 规则 + 13 IR 单测 |
| 3 | `6f8e2b3` | emit `formatAttrs` 3 路分支(radio / boolean / text-like)+ RADIO 子节点 controlled patching + 8 emit + 8 cross-walker |
| 4 | `614eebf` | `InputValueBindingPanel.vue` → `ValueBindingPanel.vue` rename + 7 类型路由 + per-type candidate 过滤 + boolean hint + 5 i18n × 7 locale |
| 7 | `f8bb3e0` | **(hotfix)** `InteractiveOptionsPanel.vue` 新建 — SELECT/RADIO `interactiveProps.options` + RADIO `groupName` 编辑器;7 i18n × 7 locale。修 ACK #5/#6 |
| 8 | `71afe71` | **(hotfix)** CHECKBOX group:options[] → array<string> 多选;`IRControlledInput.targetType` 扩 array;emit 新 `arrayCheckboxOnChangeBody`;`patchOptionLeafControlled` + `appendOptionInputs` 共享 helper(顺手 dedupe RADIO);10 新测试。修 CHECKBOX 单 boolean 不能多选的 mental-model gap |
| 9 | `fbdce37` | **(hotfix)** SWITCH Tailwind 滑动样式(`appearance-none` + track + `before` thumb)|
| 9b | `a771318` | **(hotfix)** SWITCH thumb 改 left/right 双 anchor 对称,任何 aspect ratio |
| 5 | _this commit_ | Tauri ACK 8 + §3.v4.8 回填 + close + memory 更新 |

**测试**:`bun run check` 全程 0 error / 4 pre-existing max-lines / 0 clones。351/351 compiler tests + 49/49 tools tests,零回归(含 §3.x INPUT 完全保持原行为)。

#### Tauri ACK 结果(用户主导 2026-05-27)

| # | Check | Result | 备注 |
|---|---|---|---|
| 1 | filter valueExpr input 出 placeholder hint | ✅ | |
| 2 | CHECKBOX(单)+ boolean docState → 勾选 toggles | ✅ | back-compat 保留 |
| 3 | SWITCH(单)+ boolean docState | ✅ | step 9/9b hotfix 后视觉是滑动 toggle 对称 |
| 4 | TEXTAREA + string docState | ✅ | |
| 5 | SELECT + string docState + options 切换 | ✅ | 初测 #5 ❌(无 options UI)→ step 7 hotfix → retest ✅ |
| 6 | RADIO + string docState + 选项切换 | ✅ | 初测 #6 ❌(无 options/groupName UI)→ step 7 hotfix → retest ✅ |
| 7 | DATEPICKER + string docState | ✅ | 初测描述不清,step 7+8 后用户确认 work |
| 8 | 零回归(§3.v3 + §3.x INPUT) + 类型不匹配 fallback | ✅ | |

**新增隐式 ACK**:CHECKBOX group(options[] + array<string>)→ 多选 ✅;SWITCH 视觉滑动 + thumb 对称 ✅。

#### Surprise 列表

3 mid-flight hotfix step 全部源于 Tauri 实测发现的"用户心智模型 vs 我们实现"错位 — 都不是 wiring bug,是 scope/UX 假设错位:

1. **SELECT/RADIO 无 `interactiveProps.options` UI**(step 7 hotfix `f8bb3e0`)— 与 §3.v2 ACK #1 BUTTON.text 同型 UI 缺口。controlled wiring(value binding → docState 写)全链路 work(IR + emit + cross-walker 测试都过),但 Preview 渲染空 `<select>` / 零 radios,因为 SELECT/RADIO 的 options 数组没有手动编辑入口,只能 AI/CLI 改。设计阶段反向核(经验 J Q1/Q2)漏了"用户怎么填 options"这条 — 我们只问"controlled 链路通吗"和"binding UI 引导对吗",没问"组件渲染所需的非-binding 数据怎么填"。**Fix**:新建 `InteractiveOptionsPanel.vue`,DesignPanel v-if SELECT/RADIO(后 step 8 widen 到 CHECKBOX)。

2. **CHECKBOX 设计成单 boolean,用户心智是多选组**(step 8 hotfix `71afe71`)— 设计阶段把 CHECKBOX = SWITCH 都归 `boolean` targetType,假设两者都是单状态 toggle。用户立刻反馈:"建立多个复选框,选择两个,绑定的数据应该不能是布尔值吧" — 立即暴露设计盲点。Web 表单中 CHECKBOX 默认是多选组(N 个选项 → array<string>),不是单 boolean(那是 SWITCH 或同意条款)。**Fix**:`IRControlledInput.targetType` 扩 `'array'`;CHECKBOX 节点 with `interactiveProps.options` 切换到 group mode(div wrapper + N child input + array.includes/toggle writer);without options 沿用单 boolean(back-compat)。**这是 Phase 3 整个 §3.v4 最大设计 surprise** — 整个 §3.v4.2 决定表里 CHECKBOX/SWITCH 都归 boolean 是 8 主决定 #c 锁定项,被用户一句话推翻。如果坚持锁定决定,这个 hotfix 就推 §3.v5 了;选择 mid-flight fix 是因为问题足够基础(CHECKBOX 多选是 Web 表单第一类需求)。

3. **SWITCH 视觉渲染成原生 checkbox**(step 9/9b hotfix `fbdce37` + `a771318`)— wiring 完美(`role="switch"` + checked/onChange),但浏览器渲染就是 checkbox 方框,不是用户期待的滑动按钮。`role` 是 ARIA 语义,不改视觉。设计阶段没考虑视觉特化,因为 §13 SWITCH CSS 是已分类的"低优先候选",但用户 ACK 时立刻不接受"功能对但样子像 checkbox"。**Fix**:`style.ts` 加 SWITCH 节点专用 Tailwind 类(`appearance-none` + track 颜色 + `before` thumb + checked 切换)。两轮:初版 fixed-percentage anchor (`left-[5%]/[55%]`) 在非 44×24 节点上不对称 → 改 left/right 双 anchor 真正对称。

#### 经验沉淀 — J 第二次细化:**三问题**反向核(从两问题升级)

§3.v3.8 把经验 J 从一问题(Q1 技术链)细化为两问题(+ Q2 UI 引导)。本期 3 个 surprise 全部不是 Q1/Q2 漏,而是更深层的"用户心智模型 vs 实现假设"错位。**第三个问题** Q3 必须问:

> **Q3:用户期待的组件语义 / 视觉 / 数据形状,是否匹配实现?**(mental model alignment)

三个 surprise 都是 Q3 漏:
- SELECT/RADIO surprise 1:数据形状 — 用户期待"组件自带选项列表(像 native `<select>` 有 options)",我们实现要求用户外部填 options;UI 没暴露填的入口
- CHECKBOX surprise 2:数据形状 — 用户期待"多个 checkbox = 数组",我们实现"一个 checkbox = boolean"
- SWITCH surprise 3:视觉模型 — 用户期待"滑动按钮",我们实现"checkbox + ARIA role"

**Process change for Phase 4+**:`§X.5 ACK` 表每条问 **三个问题**:
1. Q1:技术链存在?(state shape / IR / emit / UI panel / i18n / persistence — 经验 J 原版)
2. Q2:UI 引导用户走对路径?(placeholder / hint / label — §3.v3 升级)
3. Q3:用户心智模型 / 期待视觉 / 期待数据形状 与实现一致?(**本期升级**)

任一问题失败 → 推回 §X.2 决定表 或 标"design-only / 不验"。

#### 其它经验印证

- **A + G** Walker union widening — `IRControlledInput.targetType` 扩 3 次(boolean 在 step 2、array 在 step 8),`applyControlledInput` 白名单 7 类型 + RADIO/CHECKBOX 特殊 patching,emit `formatAttrs` 4 路分支(radio / array-checkbox / boolean / text-like),全部带 cross-walker 钉死。step 8 dedupe(`patchOptionLeafControlled` + `appendOptionInputs`)主动应对 jscpd clone 警告 — **经验 A/G 现在内含"dedupe is mandatory when adding parallel paths"**。
- **C** No-swallow — type mismatch / kind unsupported 全部走 `binding-value-bad-state-type` / `binding-value-unsupported-kind` warning;CHECKBOX group + boolean docState mismatch 产生明确 warning("controlled CHECKBOX requires type=array"),用户 ACK 一眼可见为什么不工作。
- **H** Tauri 实测找设计层洞 — 本期 3 个 hotfix step 全部源于 Tauri 实测,unit + cross-walker **完全无能**(我们能写的所有单测都过了,因为单测验的是"实现按设计 work",而非"设计对不对")。经验 H 现在含义扩大:Tauri 不止找"链路不存在"洞、不止找"UI 引导缺失"洞,还找"心智模型错位"洞 — 三类都只有人眼操作能发现。
- **I** Module-resolve / 跨包 — 新文件 `InteractiveOptionsPanel.vue` + `lowcodeValueBindingArrayHint` i18n key 等都走 DesignPanel import + check-locales 钉死;jscpd 主动钉 clone 强制 helper 抽取。零 module-resolve 漏。
- **J refined 2nd time** — 上面单独段。

#### §3.v4 未做 / §3.v5 候选(沿用 §3.v3 候选池 + 本期新增 4 候选)

| # | 候选 | 来源 | 体量估 |
|---|---|---|---|
| 1 | §13 SWITCH CSS proper(尺寸/颜色/动画 tween/暗色主题等)| §3.v4 step 9/9b 是 hotfix,完整设计待 §13 | ~2 day |
| 2 | RADIO/CHECKBOX-group label 间距 + inline 排版(用户提及"radio/switch preview UI 需要优化好看一点")| §3.v4 surprise(scope 外) | ~1 day |
| 3 | `$event` / `$value` token in expression grammar | §3.8 follow-up #4 沿用 | ~3 day(§4.2 FROZEN 绕路) |
| 4 | INPUT controlled boolean / date types | §3.8 follow-up #5 沿用 | ~1 day(boolean 已在 §3.v4 step 2 扩 INPUT 不支持) |
| 5 | SupabaseConfigPanel RLS policy 健康检查 | §3.8 follow-up #6 沿用 | ~1 day nice-to-have |
| 6 | InteractiveProps 通用编辑器框架(BUTTON.text / SELECT.options / RADIO.groupName / CHECKBOX.options 等都是同型缺口的反复出现 — 抽通用)| 经验 J Q2 系统化 | ~3 day refactor |
| 7 | DATEPICKER 格式校验 + range 限制 | §3.v4 留 | ~1 day |

---

## 3.v5 §3.v5 详细设计:完整 SWITCH CSS + RADIO/CHECKBOX-group inline 排版

**Scope = §3.v5 mini-scope**(§3.v5 候选池 #1 + #2,~3 天 UI-polish-only)。这是 **Q3-only(纯视觉)** scope —— 专门收尾 §3.v4 三次 mid-flight hotfix(step 7/8/9)留下的视觉债:SWITCH 是 step 9/9b hotfix(只有 anchor 跳变、硬编码色、无暗色),RADIO/CHECKBOX-group option 的 `<label>`/`<input>` className 全空(挤一起、无间距、input 与文字不对齐)。

§3.v5 **不做**:`$event` / `$value` token 扩 grammar(候选 #4,§4.2 FROZEN 绕路);DATEPICKER format 校验 + range(候选 #5);SupabaseConfigPanel RLS 健康检查(候选 #6);InteractiveProps 通用编辑器 refactor(候选 #3,本期不抽框架,只补视觉);**任何新 i18n key / 新 UI panel / 新 test-id / SceneNode·IR·Kiwi schema 改动**(本期纯 emit className 字符串)。

### 3.v5.1 现状与问题

§3.v4 closed 2026-05-27 后,3 个视觉缺口(全部 Q3,人眼 Tauri 可见,单测无能):

1. **SWITCH 只有 hotfix 级 CSS**(`packages/compiler/src/ir/style.ts:16-45` `SWITCH_CLASSES` 扁平常量)—— step 9/9b 是赶工 hotfix:
   - **不滑动**:thumb 用 `before:left-[5%]` ↔ `checked:before:left-auto right-[5%]` 双 anchor 切换,`before:transition-colors` 只 tween 颜色;`left`/`right` 在 CSS 里**无法 tween 到/从 `auto`**,所以 thumb 是**跳变**不是滑动
   - **硬编码颜色**:`bg-gray-300` / `checked:bg-blue-500` 写死,忽略 SceneNode fill;用户在画布给 SWITCH 改色无效
   - **无暗色**:无 `dark:` 变体,暗色主题下 track 灰白难辨
   - 注释自己标了 "full smooth-tween CSS goes to §13" / "full CSS spec lives at §13" —— 即本节
2. **RADIO / CHECKBOX-group option 排版裸奔**(`packages/compiler/src/ir/collect/tree.ts:631-657` `appendOptionInputs`)—— 每 option emit `<label className=''>` 内含 `<input className=''>` + 文字 text node,**className 全空**:
   - `<label>` 默认 `display:inline` → N 个 option 横向挤成一行无间距
   - `<input>` 与其文字之间无 gap、不垂直居中对齐
   - wrapper `<div>` className 来自 SceneNode(`tailwindClassName`);若用户用 FREE 布局(非 auto-layout)则 wrapper 无 `flex`/`gap` → option 之间也无间距
   - 用户 §3.v4 ACK 原话:"radio/switch preview UI 需要优化好看一点"

### 3.v5.2 关键决定

**8 主决定**:

| # | 决定 | 理由 |
|---|---|---|
| a | `SWITCH_CLASSES` 扁平常量 → `switchClasses(node, graph): string` builder(仍在 `style.ts`)。**这是锁定项里唯一被授权改 SWITCH_CLASSES 顶层结构的地方**(§3.v5 #1) | checked 颜色需按 node fill 派生 → 必须从常量升为 builder;off-track + thumb 几何仍是常量片段拼接 |
| b | **平滑滑动**:抛弃 `left`/`right` 双 anchor(无法 tween),改 thumb 固定锚 `left` + `checked:before:translate-x-[calc(100cqw_-_100cqh)]` + `before:transition-transform`。`<input>` 设 `[container-type:size]` 使 `cqw`/`cqh` 解析为 track 自身宽/高 | translate 可 tween → 真滑动;cqw/cqh 让位移 = 轨道宽 − 轨道高 = 对称落位,**任何 aspect ratio 通用**且随 bbox 缩放(比 §3.v4 anchor 跳变严格更优) |
| c | thumb 几何用 `cqh`:`before:h-[80cqh] before:aspect-square before:top-[10cqh] before:left-[10cqh]`(高 80%、上下各 10% gap、左 10% gap)→ checked 位移 `100cqw − 100cqh` 落到右 10% gap 对称 | 单位统一 cqh,几何自洽;数学已验:off 左缘 10cqh、右缘 10cqh+80cqh=90cqh;checked 位移后右缘 = 90cqh + (100cqw−100cqh) = 100cqw−10cqh,右 gap = 10cqh ✅ 对称 |
| d | **固定颜色**:OFF 恒 `bg-gray-300`、ON 恒 `checked:bg-blue-500`(覆盖 base 的 fill bg)。**~~原定"按 SceneNode fill 派生 checked 色"在 step 1 实现时推翻~~**:`node-defaults.ts:235` SWITCH 专属默认 fill 就是 `BORDER_GRAY`(gray-300),`solidFillColor` 永远非 null → ON 永远读到默认灰(灰底灰,看不见);且无可靠的"用户是否改过 fill"信号 | 与 §3.v4 已 ACK 配色一致;无脆弱"是否默认灰"启发式;颜色定制非核心诉求(用户原话是"好看一点",由滑动 + 暗色 + 排版满足)|
| e | **暗色变体**:off `dark:bg-gray-600`、ON `dark:checked:bg-blue-400`、thumb `dark:before:bg-gray-100` | 暗色主题可辨 |
| f | **option `<label>` 排版**:`appendOptionInputs` body 把 label className 从 `''` 改为常量 `OPTION_LABEL_CLASSES = 'inline-flex items-center gap-2 cursor-pointer'`;option `<input>` className 改为 `OPTION_INPUT_CLASSES = 'accent-blue-500 dark:accent-blue-400'` | input 与文字对齐 + gap;inline-flex 让 label 自身横向不撑满;accent 给原生 radio/checkbox 上色 |
| g | **wrapper 布局兜底**:`nodeToIR` 算完 className 后,若 node 是 RADIO 或 checkbox-group **且** base className 不含 flex/grid token → append 常量 `OPTION_GROUP_WRAPPER_CLASSES = 'flex flex-col gap-2'`;**auto-layout(base 已有 flex)原样尊重**(用户在画布设的 row/col 不被覆盖) | FREE 布局给个竖排默认间距;auto-layout 用户已掌控方向 → 不动(经验 H:不抢用户已表达的意图) |
| h | **零签名 / 零 tag 逻辑改动**:`appendOptionInputs` / `patchOptionLeafControlled` / `arrayCheckboxOnChangeBody` 签名不动;`isCheckboxGroup` group-vs-single tag 逻辑不动;`tailwindClassName(node, graph)` 签名不动(SWITCH 分支内部从常量换 builder 调用) | 全是 emit className 字符串 body 改动,不碰任一 §3.v4.2 锁定的 shape / 签名 / tag 决策 |

**8 次级默认**:

1. SWITCH 几何用 cqw/cqh(container query units,2023+ 浏览器 + 近期 WKWebView 支持);**风险兜底**:若 Tauri 实测 cqw 不滑动,回退 §3.v4 anchor-swap(hotfix 即安全网),标记 "design-only"。`[container-type:size]` 用 Tailwind 任意属性 `[container-type:size]`
2. checked 自定义色用 Tailwind 任意值 `checked:bg-[#3b82f6]` —— 字面 hex 直接进 emit 的 .tsx,下游项目自带 Tailwind JIT 扫源码可识别(经验 D 类:emit 产物用任意值无需新依赖)
3. SWITCH **不**做尺寸预设(sm/md/lg)—— 尺寸由 bbox 决定(cqw/cqh 自动缩放);显式 size 变体若 ACK 要再加,本期默认 bbox-driven
4. wrapper flex 兜底的"base 无 flex"判定用正则 `/(^|\s)(flex|inline-flex|grid|inline-grid)(\s|$)/.test(base)`;`flex-wrap`/`flex-col` 单独出现(无 `flex`)罕见,不特判
5. option `<input>` 不强制尺寸(原生大小),只加 accent 色 + shrink-0(防文字长时被压);label gap-2 ≈ 0.5rem
6. emit 测试:扩 `element.test.ts`(SWITCH 新 class 串 + RADIO/checkbox label/input class)+ `interactive-components.test.ts`(wrapper flex 兜底正负例:FREE 加 flex / auto-layout 不加);cross-walker 视情况加 1 SWITCH + 1 RADIO className 断言
7. 现有 golden 断言若硬编码旧 SWITCH class 串 / 空 label className → step 1/2 同 commit 更新
8. SceneNode / ActionDef / Kiwi / i18n / test-id / `bindings.value` / `IRControlledInput` shape / `EDITOR_UNDO_TOOLS` / payloadEntries 全 **0 改动**;Steiger / check-locales 无新增

**经验 J 三问题反向核**(每决定 × Q1 Q2 Q3):本期 Q1 技术链全部**既存**(改的是已渲染元素的 className 字符串,链路早通);Q2 UI 引导**N/A**(无新 authoring surface —— "默认即好看,无需用户配置"本身就是 Q2 的答案);**Q3 是全部 scope**(视觉 / 心智模型,只人眼 Tauri 可见):

| 决定 | Q1 技术链 | Q2 UI 引导 | Q3 心智模型 / 视觉 |
|---|---|---|---|
| SWITCH 平滑滑动(b/c) | ✅ class 串挂已渲染 input | N/A 无配置 | ✅ 用户期待"滑动按钮会平滑动",非跳变 |
| SWITCH 固定颜色(d) | ✅ class 串恒 gray/blue | N/A 无配置 | ✅ 与 §3.v4 已 ACK 配色一致(默认 fill=灰,派生会灰底灰 → 推翻派生)|
| 暗色变体(e) | ✅ dark: 变体 | N/A | ✅ 暗色主题下控件可辨 |
| RADIO/CHECKBOX label 排版(f) | ✅ className 挂已渲染 label/input | N/A 无配置 | ✅ 用户期待 option 有间距、input 对齐文字 |
| wrapper flex 兜底(g) | ✅ className append | N/A | ✅ FREE 布局 option 不挤一行;auto-layout 尊重用户方向 |

### 3.v5.3 公开 API / Schema 改动

- ✏️ **重构** `style.ts`:`const SWITCH_CLASSES`(扁平常量)→ `SWITCH_TRACK` + `SWITCH_THUMB` 两段常量拼成的 `SWITCH_CLASSES`(cqw/cqh 滑动 + dark + 固定 gray/blue);`tailwindClassName` SWITCH 分支不变(仍拼常量,**不**升 builder —— 颜色派生已在 step 1 推翻,builder 失去理由)
- ✏️ **改 body** `tree.ts` `appendOptionInputs`:label/input className `''` → 常量(签名不变)
- ✏️ **改 body** `tree.ts` `nodeToIR`:className 算完后 RADIO/checkbox-group wrapper flex 兜底(`const` → `let`)
- ➕ **新常量**(`tree.ts`):`OPTION_LABEL_CLASSES` / `OPTION_INPUT_CLASSES` / `OPTION_GROUP_WRAPPER_CLASSES`(模块私有)
- **0** SceneNode / ActionDef / Kiwi / i18n key / test-id / `bindings.value` / `IRControlledInput` shape / `applyPatchWithUndo` / payloadEntries 改动
- **0** 新文件 / 新 UI panel / 新 DesignPanel v-if / Steiger import 链改动

### 3.v5.4 内部实现拆解

#### `style.ts` — `SWITCH_TRACK` + `SWITCH_THUMB` 常量

```ts
const SWITCH_TRACK = [
  'appearance-none', 'cursor-pointer', 'relative', 'rounded-full',
  '[container-type:size]',                       // cqw/cqh 解析锚点 = input 自身
  'bg-gray-300', 'dark:bg-gray-600',             // off-track(覆盖 base fill)
  'checked:bg-blue-500', 'dark:checked:bg-blue-400', // on-track(固定,非派生)
  'transition-colors'
]
const SWITCH_THUMB = [
  "before:content-['']", 'before:absolute',
  'before:top-[10cqh]', 'before:left-[10cqh]',
  'before:h-[80cqh]', 'before:aspect-square',
  'before:rounded-full', 'before:bg-white', 'dark:before:bg-gray-100',
  'before:shadow',
  'before:transition-transform', 'before:duration-200', 'before:ease-in-out',
  'checked:before:translate-x-[calc(100cqw_-_100cqh)]'  // 对称滑动
]
const SWITCH_CLASSES = [...SWITCH_TRACK, ...SWITCH_THUMB].join(' ')
```

`tailwindClassName` SWITCH 分支:`return base === '' ? SWITCH_CLASSES : \`${base} ${SWITCH_CLASSES}\``(`bg-gray-300` 在 base 之后 → off 态覆盖 fill;`checked:bg-blue-500` 给 ON 态)。**step 1 实现时发现 SWITCH 默认 fill = gray-300 → 放弃颜色派生**(见决定 d 推翻),故无需 builder / 无需 `solidFillColor` 导出。

#### `tree.ts` — option 排版常量

```ts
const OPTION_LABEL_CLASSES = 'inline-flex items-center gap-2 cursor-pointer'
const OPTION_INPUT_CLASSES = 'shrink-0 accent-blue-500 dark:accent-blue-400'
const OPTION_GROUP_WRAPPER_CLASSES = 'flex flex-col gap-2'
```

`appendOptionInputs` body:label node `className: OPTION_LABEL_CLASSES`、input node `className: OPTION_INPUT_CLASSES`(原 `''`)。

`nodeToIR`(line 242 附近):
```ts
let className = tailwindClassName(node, ctx.graph)
if ((node.type === 'RADIO' || isCheckboxGroup(node)) &&
    !/(^|\s)(flex|inline-flex|grid|inline-grid)(\s|$)/.test(className)) {
  className = className === '' ? OPTION_GROUP_WRAPPER_CLASSES : `${className} ${OPTION_GROUP_WRAPPER_CLASSES}`
}
```
`isCheckboxGroup` 复用既有(tree.ts:228),不改其逻辑。

### 3.v5.5 成功标准 + Tauri ACK

1. `bun test ./tests/engine/compiler/` 全绿(含更新的 SWITCH class 串 + 新 option className + wrapper flex 兜底正负例)
2. `bun test ./tests/engine/tools/lowcode/` 全绿(零回归)
3. `bun run check` 全绿(0 新 i18n → check:i18n 无变;jscpd 0 clones;Steiger 无新 import)
4. **Tauri 实测(用户主导)~6 项 user-ACK(全 Q3 人眼)**:

| # | ACK | Q1 / Q2 / Q3 |
|---|---|---|
| 1 | SWITCH 切换 ON/OFF → thumb **平滑滑动**(非跳变)左右对称,任意宽高比 | Q1 ✅ / Q2 N/A / **Q3** 滑动动画 |
| 2 | SWITCH OFF 态 gray-300、ON 态 blue-500(固定,不随 fill);与 §3.v4 配色一致 | Q1 ✅ / Q2 N/A / **Q3** 配色清晰 |
| 3 | 暗色主题:SWITCH off/on + thumb 可辨;option accent 可辨 | Q1 ✅ / Q2 N/A / **Q3** 暗色可辨 |
| 4 | RADIO(options [M,F] FREE 布局)→ option 竖排有间距、input 与文字对齐有 gap | Q1 ✅ / Q2 N/A / **Q3** 间距对齐 |
| 5 | CHECKBOX-group(options [A,B,C])同 RADIO 排版;多选 array 仍 work(零回归 §3.v4 step 8) | Q1 ✅ / Q2 N/A / **Q3** 间距 + 回归 |
| 6 | RADIO/CHECKBOX 用 **auto-layout 横排** → 方向被尊重(不被竖排兜底覆盖),仅 label 内对齐改善 | Q1 ✅ / Q2 N/A / **Q3** 不抢用户意图 |

5. 零回归:§3.v4 7 controlled bindings(含 CHECKBOX group array、SWITCH boolean 绑定)+ §3.x INPUT + §3.v3 + §3.v2 全 work;不破坏任一 Phase 0/1/2/§2/§3/§3.x/§3.v2/§3.v3/§3.v4 锁定决定(尤其 `appendOptionInputs`/`patchOptionLeafControlled`/`arrayCheckboxOnChangeBody` 签名、CHECKBOX group-vs-single tag、`bindings.value`、`IRControlledInput` shape)

### 3.v5.6 工作分解(建议 1 名工程师,~3 天)

| Step | 任务 | 验收 / commit |
|---|---|---|
| 0 | §3.v5 设计 doc 写入 + commit | `docs(lowcode): §3.v5 mini-scope detailed design (full SWITCH CSS + RADIO/CHECKBOX inline layout)` |
| 1 | #1 SWITCH:`SWITCH_CLASSES` → `switchClasses(node)` builder(cqw/cqh 滑动 + dark + fill 派生 checked 色);更新/扩 emit 测试 | `bun test ./tests/engine/compiler/` + `bun run check` 全绿;`feat(lowcode): step 1 — full SWITCH CSS (slide tween + dark + fill color) (§3.v5)` |
| 2 | #2 RADIO/CHECKBOX-group:option label/input className 常量 + wrapper flex 兜底(RADIO+checkbox-group,base 无 flex 时);扩 emit 正负例测试 | `bun test ./tests/engine/compiler/` + `bun run check` 全绿;`feat(lowcode): step 2 — RADIO/CHECKBOX-group inline layout polish (§3.v5)` |
| 3 | Tauri 实测 6 项(Q3 人眼)+ §3.v5.8 post-mortem 回填 + memory 更新 + close | 6 ACK 全 ✅(或 cqw 回退标记);`docs(lowcode): §3.v5 Tauri verification + close` |

### 3.v5.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| `cqw`/`cqh` + `[container-type:size]` 在 Tauri WKWebView 不生效 → SWITCH 不滑动 | 中 | Step 3 Tauri 必验;不滑回退 §3.v4 anchor-swap(hotfix 安全网)并标 design-only;container query units macOS WKWebView 近年支持,预期 OK |
| `[container-type:size]` 给 `<input>` 加 size containment 影响其内在尺寸 | 中 | bbox 已给显式 w/h(Tailwind)→ 应不受影响;Tauri 验 |
| `checked:bg-[#hex]` 自定义色 dark 态太亮/太暗 | 低 | 自定义色不加 dark 变体(明暗一致),用户自负;默认蓝才有 dark |
| wrapper flex 兜底正则误判(base 有 `flex-wrap` 无 `flex`)| 低 | 罕见;`flex-wrap` 必伴 `flex`(用户极少裸用);可接受 |
| 现有 golden 测试硬编码旧 SWITCH class 串 → step 1 break | 中 | step 1 同 commit 更新断言;已确认 element/cross-walker 测试断 `role="switch"`/`checked=` 而非全 class 串,影响面小 |
| jscpd:SWITCH_TRACK/THUMB 与 option 常量片段被判 clone | 低 | 常量是声明非逻辑,片段短;若触发抽到单一数组 |
| 误改 `appendOptionInputs` 签名或 CHECKBOX group tag 逻辑(锁定项)| 高 | 只改 body 的 className 字面 + 加 wrapper 后处理;签名/tag 决策 grep 自查不动 |

### 3.v5.8 Post-mortem

**§3.v5 closed 2026-05-28**(HEAD this commit;Tauri ACK 6/6 ✅,cqw 滑动在 WKWebView 顺畅,无需回退)。Phase 3 首个"纯 Q3 视觉收尾"scope,**零 Tauri surprise**(对照 §3.v4 的 3 个 mid-flight hotfix)—— 不是因为运气,而是因为本期没有遗留 Q3 洞:视觉债本身就是 §3.v4 三次 hotfix 明确推迟的部分,且唯一的 Q3-数据形状风险(颜色派生)在 step 1 用 runtime probe 提前抓掉了。

#### Commit 链(4 个,无 hotfix)

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `b0ed907` | §3.v5 8 主决定 + 8 次默 + Q1/Q2/Q3 反向核 + 5 step |
| 1 | `36bcbf8` | 完整 SWITCH CSS:`SWITCH_CLASSES` 扁平常量 → `SWITCH_TRACK`+`SWITCH_THUMB`;`[container-type:size]` + `checked:before:translate-x-[calc(100cqw_-_100cqh)]` 真滑动(替代 §3.v4 anchor-swap)+ dark 变体;**决定 (d) 颜色派生 fill 在本 step 推翻**(SWITCH 默认 fill=gray-300 → 派生会灰底灰)→ 固定 gray/blue;新增 SWITCH className 测试 |
| 2 | `4184625` | RADIO/CHECKBOX-group inline 排版:option `<label>` = `inline-flex items-center gap-2 cursor-pointer`、`<input>` = `accent-blue-500 dark:accent-blue-400`;FREE wrapper 补 `flex flex-col gap-2` 兜底(auto-layout 尊重方向);4 新测试(label/input class + FREE 兜底 + auto-layout 不兜底 + CHECKBOX-group)|
| 3 | _this commit_ | Tauri ACK 6/6 + §3.v5.8 回填 + close + memory |

**测试**:356/356 compiler tests(+5 新:1 SWITCH className + 4 option/wrapper)+ 49/49 tools tests,零回归。`bun run check` 0 error / 5 pre-existing max-lines(含 tree.ts 700→742,同一既有 warning)/ 0 clones / locales 同步 / Steiger 干净。**0 新 i18n / 0 新 UI panel / 0 新 test-id / 0 SceneNode·IR·Kiwi 改动** —— 全 emit className 字符串。

#### Tauri ACK 结果(用户主导 2026-05-28)

| # | Check | Result | 备注 |
|---|---|---|---|
| 1 | SWITCH thumb 平滑滑动、左右对称 | ✅ | **cqw/cqh + container-type:size 在 WKWebView 生效**,无需回退 anchor-swap 安全网;用户:"switch 滑动很顺" |
| 2 | OFF=gray / ON=blue 固定色 | ✅ | |
| 3 | 暗色变体可辨 | ✅ | |
| 4 | RADIO(FREE)竖排间距 + input 对齐 | ✅ | |
| 5 | CHECKBOX-group(FREE)同上 + 多选 array work | ✅ | 回归 §3.v4 step 8 OK |
| 6 | RADIO auto-layout 横排方向被尊重 | ✅ | wrapper 有 `flex ... gap-5`(来自 auto-layout),无 `flex flex-col` 兜底 |

测试文档:`lowcode-v5-test.fig`(单页 4 节点,`scripts/make-v5-testdoc.ts` 生成,均 untracked 不入仓)。`bun open-pencil compile` 已离线证明 4 节点 emit 出全部 §3.v5 类(见 `index.tsx`),Tauri 仅验运行时渲染。

#### Surprise 列表(1 个,且在 Tauri 之前抓掉)

1. **SWITCH 默认 fill = gray-300 → 颜色派生决定 (d) 自毁**(step 1,`node-defaults.ts:235` `BORDER_GRAY`)。设计阶段锁了"ON 色按 SceneNode fill 派生"(Q3 直觉:画布改色=改 toggle 色),但 step 1 用 `bun -e` 实跑 `createNode('SWITCH')` 看 `node.fills` 时发现**新建 SWITCH 默认就带 gray-300 SOLID fill**(各类型默认 fill 不同:CHECKBOX/INPUT 白、BUTTON 蓝、SWITCH 灰)。派生会让 ON 永远读到默认灰 → 灰底灰看不见,且无可靠"用户是否改过 fill"信号。**这是 §3.v4 同型的 Q3-数据形状错位,但本期在 implementation 阶段(非 Tauri)抓到** —— 关键差异:决定一旦依赖"X 的实际默认/当前状态是什么",就用 runtime eval 实测,别假设。推翻 (d),固定 gray/blue(与 §3.v4 已 ACK 配色一致),对话确认后 close。

#### 经验沉淀(对 §1.4 / §3.v4.8 印证 + 1 条新增)

- **J 三问题反向核验证**:本期 Q1/Q2 设计阶段即判定"技术链既存 + 无新 authoring surface",Q3 是全部 scope。结果 6/6 ACK 全过、零 Tauri surprise —— **印证 J 的核心论断**:当 Q1/Q2 真清且 Q3 洞被提前堵(本期靠 runtime probe + 直接源于用户视觉反馈的设计),Tauri 就没有 surprise。§3.v4 的 3 个 surprise 是 Q3 洞没堵;§3.v5 是 Q3 洞堵住的对照组。
- **新增经验 K(候选,待二次印证)——「依赖默认/现状的决定必须 runtime probe」**:当一个决定的正确性取决于"某属性的实际默认值 / 当前状态 / 运行时形状"(本期 = SWITCH 默认 fill),不要凭记忆或源码静读假设,用 `bun -e` / 单测实跑确认。本期靠它把一个 Q3-数据形状错位从 Tauri 提前到 implementation 阶段(成本从"mid-flight hotfix"降到"step 内调整")。是经验 J Q3 的一个可操作前置检查 + 经验 H"Tauri 找洞"的成本左移。
- **H 反向印证**:Tauri 本期"没找到洞"不是 H 失效,而是设计真没留 Q3 洞 —— Tauri 仍是唯一能确认"渲染出来好看"的关口(单测全程只证 class 串按设计 emit,compile 离线证明产物含类,但"cqw 在 WKWebView 是否真滑动""暗色是否可辨"只有人眼 Tauri 能答)。
- **A/G 持平**:本期无 union widening / walker 改动(纯 className body),`appendOptionInputs` 签名 / CHECKBOX group-vs-single tag 逻辑 0 改动,jscpd 0 clones。
- **cqw/cqh 技术点**:用容器查询单位让 thumb 位移 = `100cqw - 100cqh`,实现任意宽高比对称 + 可 tween 的滑动(CSS 无法 tween 到/从 `auto`,故 §3.v4 anchor-swap 不可能平滑)。WKWebView(近期 macOS)支持确认。这是本期 headline 技术升级。

---

## 3.v6 §3.v6 详细设计:InteractiveProps 通用编辑器框架

**Scope = §3.v6 mini-scope**(§3.v5 候选池 #3,~3 天 refactor)。系统性消除 §3.v2 / §3.v4 反复出现的「interactiveProps 字段无 authoring UI」缺口类(§3.v2 ACK#1 BUTTON.text / §3.v4 ACK#5/#6 SELECT·RADIO options),把零散 bespoke 面板抽成一个**声明式 per-NodeType 字段 schema + 单一通用面板**。经验 J Q2 系统化。

**关键性质**:emit 的 `applyXxxProps`(`tree.ts`)**早已消费**所有这些字段(placeholder/value/checked/options/groupName/value)—— 缺的只是 UI authoring 入口。故本期 **0 SceneNode / 0 IR / 0 emit / 0 Kiwi 改动 / 0 compiler 改动**,纯 app-side UI + i18n。这是 Phase 3 首个 **Q1 全既存、Q2 是全部 scope** 的"补 UI 引导"refactor。

§3.v6 **不做**:把 BUTTON.text 折进通用 schema(决定 e:留 TextBindingPanel,binding 耦合);interactiveProps 字段类型校验(如 date 格式 —— 候选 #5);通用编辑器扩到 events/bindings(只管 interactiveProps 一类);新 number 字段(当前无 number 型 interactiveProps)。

### 3.v6.1 现状与问题

§3.v5 closed 2026-05-28 后,interactiveProps 字段的 UI 覆盖**零散且有洞**:

| NodeType | interactiveProps 字段(emit 消费) | 当前 UI |
|---|---|---|
| INPUT | `placeholder`, `value` | ❌ 无(只 AI/CLI)|
| TEXTAREA | `placeholder`, `value` | ❌ 无 |
| CHECKBOX | `options`(group)/ `checked`(single)| options ✅(InteractiveOptionsPanel);`checked` ❌ |
| SWITCH | `checked` | ❌ 无 |
| DATEPICKER | `value`(日期)| ❌ 无 |
| BUTTON | `text` | ✅ TextBindingPanel(literal mode)|
| SELECT | `options` | ✅ InteractiveOptionsPanel |
| RADIO | `options`, `groupName`, `value`(默认选中)| options ✅ / groupName ✅ / `value` ❌ |

3 个问题:
1. **6 个字段完全无 UI**:INPUT/TEXTAREA `placeholder`+`value`、DATEPICKER `value`、CHECKBOX/SWITCH `checked`、RADIO 默认 `value` —— Bubble-like 表单里这些是最基本的字段属性,却只能 AI/CLI 改(同 §3.v2/§3.v4 缺口类)
2. **两个 bespoke 面板**(`InteractiveOptionsPanel.vue` options+groupName / `TextBindingPanel.vue` button-text)各自硬编码 —— 每加一个 interactiveProps 字段就要新写/改一个面板 + DesignPanel v-if,缺口反复出现(经验 J Q2 指出的系统病)
3. **DesignPanel.vue:126-128** `InteractiveOptionsPanel v-if SELECT||RADIO||CHECKBOX` —— 加类型/字段都要手改 v-if

### 3.v6.2 关键决定

**8 主决定**:

| # | 决定 | 理由 |
|---|---|---|
| a | **声明式 schema**:新 `src/components/properties/Lowcode/interactive-fields.ts` 导出 `INTERACTIVE_PROP_FIELDS: Partial<Record<SceneNode['type'], InteractiveField[]>>`。`InteractiveField = { key: string; kind: FieldKind; labelKey: PanelKey; placeholderKey?: PanelKey; visibleWhen?: (ip: Record<string, unknown>) => boolean }` | 单源:per-NodeType "哪些 interactiveProps 字段可编辑 + 怎么编辑";加字段 = 改一处数组,不再新写面板 |
| b | **5 个 FieldKind**:`text`(string `<input>`)/ `boolean`(checkbox toggle)/ `date`(`<input type=date>`)/ `string-array`(options 列表增删改)/ `enum`(从兄弟字段 options 派生的 `<select>`,用于 RADIO 默认 value)| 覆盖全部现存字段形状;`enum` 让 RADIO 默认值从 options 里选(防自由文本错填,Q3)|
| c | **单一 `InteractivePropsPanel.vue`**:按 `INTERACTIVE_PROP_FIELDS[node.type]` 遍历,每 field 按 kind v-if 内联渲染(**不**拆子文件 —— 同域避免多文件惯例);读 `useSceneComputed(interactiveProps)`,写 `editor.updateNodeWithUndo(id, { interactiveProps: merged }, label)`。**替换并删除 `InteractiveOptionsPanel.vue`**(options/groupName 变成 schema 字段)| 一个面板 + 内部 kind 路由(经验 I 单源);string-array 编辑逻辑从 InteractiveOptionsPanel 原样搬入 |
| d | **CHECKBOX 模式分裂**:`options`(string-array)恒显示;`checked`(boolean)仅 `visibleWhen: ip => !hasOptions(ip)` 时显示;options 字段带 hint「填选项 → 切换为多选组」。镜像 emit `isCheckboxGroup`(options 非空 = group)| 与 §3.v4 step 8 emit 语义一致;条件可见 + hint 解决"options vs checked 哪个生效"的 Q3 困惑 |
| e | **BUTTON.text 留 `TextBindingPanel`,不进通用 schema** | BUTTON.text 本质是 `bindings.text` 的字面 fallback(binding 存在时被覆盖),属于 binding UI 旁;折进通用面板会(1)回退 §3.v3 的"仅 literal mode 显示"UX,或(2)把 binding 感知泄进通用面板。通用面板只管"无 binding 通道的纯 interactiveProps 数据" |
| f | **schema 字段集**(对齐 compiler `applyXxxProps` 消费,经验 E):INPUT/TEXTAREA = [placeholder:text, value:text];CHECKBOX = [options:string-array, checked:boolean(no options 时)];SWITCH = [checked:boolean];DATEPICKER = [value:date];SELECT = [options:string-array];RADIO = [options:string-array, groupName:text, value:enum] | 字段集 = emit 真实读取的字段(单源对齐);BUTTON 不入(决定 e)|
| g | **DesignPanel 接线**:删 `InteractiveOptionsPanel` import + v-if;加 `InteractivePropsPanel v-if="node.type in INTERACTIVE_PROP_FIELDS"`(import schema 做单一 v-if 判定)| 加类型只改 schema,DesignPanel v-if 不再逐类型手列 |
| h | **i18n**:复用现有 option/groupName key(`lowcodeInteractiveOptions*` / `lowcodeInteractiveGroupName*`);新增通用字段 label key(panel 标题 + placeholder/value/defaultChecked/defaultSelected/date)× 7 locale。test-id:新根 `lowcode-interactive-props`;复用 option/group 子 id;text/boolean/date/enum 字段加新 id | 最小化 i18n / test-id churn;check-locales + Steiger 钉 |

**8 次级默认**:

1. **清空语义**:text/date 空串 → `delete ipNext[key]`(emit fallback 到默认);boolean 仅 `true` 时存 `checked: true`,`false` → `delete`(镜像 `applyToggleProps` 的 `ip.checked === true`);沿用 §3.2 + §3.v3 button-text 先例
2. **enum(RADIO.value)** 选项 = 当前 `options` 字段实时值;含一个空 `(none)` 默认项;value 不在 options 内时仍显示当前值不报错(emit 端 `opt === selected` 自然不命中)
3. **date kind** = `<input type=date>`,浏览器原生格式校验;空 → undefined
4. **string-array 编辑器** = InteractiveOptionsPanel 的 add/remove/update + commit-merge 逻辑原样搬入(reuse,非重写;jscpd 0 clone)
5. **字段顺序** = schema 数组顺序;panel 标题新 key `lowcodeInteractiveProps`('Properties' / '属性')
6. **visibleWhen** 对当前 `interactiveProps` 响应式求值(useSceneComputed 驱动)
7. **0 compiler / SceneNode / IR / emit / Kiwi 改动** —— 全 app-side(`src/components/properties/Lowcode/`)+ i18n(`packages/vue/src/i18n` + 7 locale json)
8. **e2e**:`InteractiveOptionsPanel` 既有 e2e 重命名/迁移到 `InteractivePropsPanel`;新增缺口字段(placeholder/value/checked/date/default-selected)用例;test-id 迁移在同 commit

**经验 J 三问题反向核**:本期 **Q1 技术链对所有字段既存**(emit 早已消费 → 设新 UI 写入 interactiveProps 即生效,零新链路);**Q2 是全部 scope**(系统补 authoring UI + label/hint 引导);**Q3** 重点在 CHECKBOX 模式分裂 + RADIO 默认值 enum:

| 字段/决定 | Q1 技术链 | Q2 UI 引导 | Q3 心智模型 |
|---|---|---|---|
| INPUT/TEXTAREA placeholder+value | ✅ applyTextInputProps 已读 | ✅ text 字段 + placeholder hint | ✅ 表单字段基本属性,用户期待可编辑 |
| CHECKBOX/SWITCH checked | ✅ applyToggleProps 已读 | ✅ boolean toggle | ✅ "默认勾选"符合预期 |
| CHECKBOX options vs checked | ✅ isCheckboxGroup 已分支 | ✅ options hint「填选项→多选组」 | ⚠️ 重点:条件可见 + hint 防"哪个生效"困惑 |
| DATEPICKER value | ✅ applyDatePickerProps 已读 | ✅ date input | ✅ 默认日期 |
| RADIO default value | ✅ applyRadioOptions 已读 `opt===selected` | ✅ enum 从 options 选 | ⚠️ enum 防自由文本错填 |
| SELECT/RADIO options + groupName | ✅ 既有 | ✅ 复用既有编辑器 | ✅ 零回归 |
| BUTTON.text 留 TextBindingPanel(e)| ✅ 既有 | ✅ 不动 | ✅ binding fallback 语义不变 |

### 3.v6.3 公开 API / Schema 改动

- ➕ **新文件** `src/components/properties/Lowcode/interactive-fields.ts`:`InteractiveField` 类型 + `FieldKind` 联合 + `INTERACTIVE_PROP_FIELDS` schema(app-side,纯数据)
- ➕ **新文件** `src/components/properties/Lowcode/InteractivePropsPanel.vue`
- 🗑️ **删** `src/components/properties/Lowcode/InteractiveOptionsPanel.vue`(逻辑并入通用面板)
- 🔁 **改** `src/components/DesignPanel.vue`:import 替换 + v-if 改 `node.type in INTERACTIVE_PROP_FIELDS`
- ➕ **i18n 新 key** × 7 locale:`lowcodeInteractiveProps`(标题)+ `lowcodeInteractivePlaceholder` / `lowcodeInteractiveValue` / `lowcodeInteractiveDefaultChecked` / `lowcodeInteractiveDefaultSelected` / `lowcodeInteractiveDateValue` 等字段 label(具体集 step 1 定),复用 option/groupName key
- 🔁 **test-id**:新 `lowcode-interactive-props`(根)+ 字段子 id;复用 `lowcode-interactive-option*` / `lowcode-interactive-group-name`
- **0** SceneNode / ActionDef / IR / emit / Kiwi / compiler / `bindings.*` / `IRControlledInput` 改动
- **0** `appendOptionInputs` / `patchOptionLeafControlled` / CHECKBOX group tag 逻辑改动(锁定项不碰)

### 3.v6.4 内部实现拆解

#### `interactive-fields.ts`(新)

```ts
import type { SceneNode } from '@open-pencil/core/scene-graph'

export type FieldKind = 'text' | 'boolean' | 'date' | 'string-array' | 'enum'

export interface InteractiveField {
  key: string                 // interactiveProps key
  kind: FieldKind
  labelKey: string            // i18n panels key
  placeholderKey?: string
  optionsFrom?: string        // enum: sibling key holding the string[]
  visibleWhen?: (ip: Record<string, unknown>) => boolean
}

const hasOptions = (ip: Record<string, unknown>): boolean =>
  Array.isArray(ip.options) && ip.options.length > 0

export const INTERACTIVE_PROP_FIELDS: Partial<Record<SceneNode['type'], InteractiveField[]>> = {
  INPUT: [
    { key: 'placeholder', kind: 'text', labelKey: 'lowcodeInteractivePlaceholder' },
    { key: 'value', kind: 'text', labelKey: 'lowcodeInteractiveValue' }
  ],
  TEXTAREA: [/* same as INPUT */],
  CHECKBOX: [
    { key: 'options', kind: 'string-array', labelKey: 'lowcodeInteractiveOptions' },
    { key: 'checked', kind: 'boolean', labelKey: 'lowcodeInteractiveDefaultChecked',
      visibleWhen: (ip) => !hasOptions(ip) }
  ],
  SWITCH: [{ key: 'checked', kind: 'boolean', labelKey: 'lowcodeInteractiveDefaultChecked' }],
  DATEPICKER: [{ key: 'value', kind: 'date', labelKey: 'lowcodeInteractiveDateValue' }],
  SELECT: [{ key: 'options', kind: 'string-array', labelKey: 'lowcodeInteractiveOptions' }],
  RADIO: [
    { key: 'options', kind: 'string-array', labelKey: 'lowcodeInteractiveOptions' },
    { key: 'groupName', kind: 'text', labelKey: 'lowcodeInteractiveGroupName',
      placeholderKey: 'lowcodeInteractiveGroupNamePlaceholder' },
    { key: 'value', kind: 'enum', labelKey: 'lowcodeInteractiveDefaultSelected', optionsFrom: 'options' }
  ]
}
```

字段集**严格对齐** `tree.ts` 各 `applyXxxProps` 实际读取的 key(经验 E 跨层接口核对)。

#### `InteractivePropsPanel.vue`(新)

- `fields = computed(() => INTERACTIVE_PROP_FIELDS[selectedNode.value?.type ?? ''] ?? [])`
- `ip = useSceneComputed(() => selectedNode.value?.interactiveProps ?? {})`
- `commit(patch)`:`{ ...ip.value, ...patch }`,空值 delete key,`updateNodeWithUndo(id, { interactiveProps: merged }, 'Update properties')`
- template:`v-for field in fields`,内层 `v-if field.visibleWhen?.(ip) ?? true`,再按 `field.kind` v-if 渲染 text / boolean / date / string-array(搬 InteractiveOptionsPanel)/ enum(`<select>` from `ip[field.optionsFrom]`)
- 根 `data-test-id="lowcode-interactive-props"`

#### `DesignPanel.vue`

```vue
import { INTERACTIVE_PROP_FIELDS } from './properties/Lowcode/interactive-fields'
import InteractivePropsPanel from './properties/Lowcode/InteractivePropsPanel.vue'
// 删 InteractiveOptionsPanel import
...
<InteractivePropsPanel v-if="node.type in INTERACTIVE_PROP_FIELDS" />
```

### 3.v6.5 成功标准 + Tauri ACK

1. `bun run check` 全绿(check:i18n 钉新 key × 7 locale;Steiger 钉新 import + 删文件;jscpd 0 clone —— string-array 逻辑搬移非复制)
2. `bun test ./tests/engine/compiler/` + `tools/lowcode/` 全绿(本期 0 compiler 改动 → 应纯零回归)
3. e2e 全绿(InteractiveOptionsPanel → InteractivePropsPanel 迁移 + 新字段用例)
4. **Tauri 实测(用户主导)~8 项 ACK**(Q2/Q3 为主):

| # | ACK | Q1/Q2/Q3 |
|---|---|---|
| 1 | INPUT 选中 → Properties 出 placeholder + value 字段;填 → Preview `<input placeholder= defaultValue=>` | Q1 ✅(emit 既有)/ Q2 ✅ / Q3 ✅ |
| 2 | TEXTAREA 同 INPUT | ✅✅✅ |
| 3 | SWITCH → "Default checked" toggle;勾 → Preview 默认 on | ✅✅✅ |
| 4 | CHECKBOX 无 options → 出 "Default checked";填 options → checked 字段隐藏 + 变多选组(hint 提示)| ✅✅ / **Q3 模式分裂清晰** |
| 5 | DATEPICKER → date input;选日期 → Preview 默认日期 | ✅✅✅ |
| 6 | SELECT/RADIO options + RADIO groupName 仍 work(零回归 §3.v4 step 7)| ✅✅✅ |
| 7 | RADIO → "Default selected" 是从 options 派生的下拉;选 → Preview 对应 radio defaultChecked | ✅✅ / **Q3 enum 防错填** |
| 8 | BUTTON.text 仍在 TextBindingPanel(决定 e),通用面板不重复出 BUTTON.text;零回归 | ✅✅✅ |

5. 不破坏任一 Phase 0/1/2/§2/§3/§3.x/§3.v2/§3.v3/§3.v4/§3.v5 锁定决定

### 3.v6.6 工作分解(建议 1 名工程师,~3 天)

| Step | 任务 | 验收 / commit |
|---|---|---|
| 0 | §3.v6 设计 doc + commit | `docs(lowcode): §3.v6 mini-scope detailed design (InteractiveProps generic editor)` |
| 1 | `interactive-fields.ts` schema + 类型(对齐 emit 消费)| `bun run check` 全绿;`feat(lowcode): step 1 — interactiveProps field schema (§3.v6)` |
| 2 | `InteractivePropsPanel.vue`(全 kind)+ 删 InteractiveOptionsPanel + DesignPanel 接线 + i18n × 7 locale + e2e 迁移/扩 | `bun run check` + e2e 全绿;`feat(lowcode): step 2 — generic InteractivePropsPanel + remove InteractiveOptionsPanel (§3.v6)` |
| 3 | Tauri 实测 8 项 + §3.v6.8 post-mortem + memory + close | 8 ACK ✅;`docs(lowcode): §3.v6 Tauri verification + close` |

### 3.v6.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 删 InteractiveOptionsPanel + DesignPanel v-if 改 → 既有 e2e / Steiger import 断 | 中 | step 2 同 commit 改 DesignPanel import + 迁移 e2e test-id + grep 全引用 |
| CHECKBOX options-vs-checked 模式分裂 UX 困惑 | 中 | 条件可见 + options hint;Tauri ACK #4 专验 Q3 |
| schema 与 compiler `applyXxxProps` 漂移(将来加 emit 字段忘加 schema)| 中 | 字段集设计阶段对齐 + 文件头注释指向 tree.ts;ACK 覆盖全 8 类型;经验 E |
| i18n 新 key × 7 locale 漏译 | 中 | check-locales 钉死;step 2 单 commit 同步 7 locale |
| enum(RADIO.value)options 改变后下拉不同步 | 低 | useSceneComputed 响应式;value 不在 options 不报错 |
| 过度抽象(YAGNI)| 低 | 由 4 次反复缺口(§3.v2/§3.v4×2)实证驱动,非预设;限 5 kind + 单文件面板,不扩到 events/bindings |
| string-array 逻辑搬移引入 jscpd clone | 低 | 搬移非复制(InteractiveOptionsPanel 删除);check 跑 jscpd 确认 0 |

### 3.v6.8 Post-mortem

**§3.v6 closed 2026-05-28**(HEAD this commit;Tauri ACK 8/8 ✅,零 surprise)。Phase 3 首个 **Q1 全既存、Q2-only(纯补 authoring UI)**的 refactor —— 验证经验 J Q2 的系统化判断成立:声明式 schema 一次性消除"interactiveProps 无 UI"缺口类,后续加字段 = 改一处数组,不再触发同类 surprise。

#### Commit 链(4 个,无 hotfix)

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `e96de06` | §3.v6 8 主决定 + 8 次默 + Q1/Q2/Q3 反向核 |
| 1 | `e386d4a` | `interactive-fields.ts` 声明式 schema(7 类型 × 字段 × 5 kind);对齐 emit `applyXxxProps` 消费 |
| 2 | `90eeeb0` | `InteractivePropsPanel.vue`(按 kind 渲染)+ 删 `InteractiveOptionsPanel.vue` + DesignPanel 单 v-if + 8 i18n key × 7 locale |
| 3 | _this commit_ | Tauri ACK 8/8 + §3.v6.8 回填 + close + memory |

**测试**:`bun run check` 0 error / 5 pre-existing max-lines / 0 clones / locales 同步 / Steiger 干净;405/405 compiler+tools 测试零回归(**本期 0 compiler 改动** → emit 早已消费全部字段,纯 app-side UI + i18n)。

#### Tauri ACK 结果(用户主导 2026-05-28)

| # | Check | Result |
|---|---|---|
| 1 | INPUT placeholder + value 字段可填 → Preview 生效 | ✅ |
| 2 | TEXTAREA 同 INPUT | ✅ |
| 3 | SWITCH Default checked toggle | ✅ |
| 4 | CHECKBOX:无 options 出 checked;填 options → checked 隐藏 + 多选组(hint)| ✅(Q3 模式分裂清晰)|
| 5 | DATEPICKER date 默认值 | ✅ |
| 6 | SELECT/RADIO options + groupName 零回归 | ✅ |
| 7 | RADIO Default selected = options 派生下拉 | ✅(Q3 enum 防错填)|
| 8 | BUTTON.text 仍在 TextBindingPanel,通用面板不出(决定 e)| ✅ |

#### Surprise 列表(1 个,工具链非功能)

1. **`scripts/make-v5-testdoc.ts` 触发 `no-script-core-barrel-imports`**(step 1)—— §3.v5 用 `bun run` 直跑、从没被 lint;step 1 跑 `bun run check` 时 `lint:structure` 扫 `scripts/`(+`tests/`)发现它用了 `@open-pencil/core` barrel import,报 error 卡住整个 gate。Fix:改 `@open-pencil/core/scene-graph` subpath。**教训:`scripts/` 下的 untracked 文件也进 `lint:structure` 扫描范围 —— 一次性脚本也得 lint-clean,否则卡 gate**(经验 I 邻域:gate 的扫描面比"我改的文件"大)。非 §3.v6 功能 surprise。

#### 经验印证

- **J Q2 系统化兑现** + **K 第二次印证(候选 → 可升正)**:本期无"依赖默认值"的决定,但 step 1 的 schema 字段集是靠**静读 emit `applyXxxProps` 源码**对齐的(经验 E 跨层接口核),Tauri 8/8 一次过 = 对齐正确。**经验 K 的同源思想**:不确定就实测/静读真源,别假设 —— 本期对 emit 消费字段做了源码核对,零字段漏/错。
- **H**:Tauri ACK 仍是 UI 面板唯一验收关口(本期无 e2e,沿用 §3.v2-§3.v5 lowcode 面板的 Tauri-ACK 先例);8 项全人眼过。
- **零回归无 compiler 改动**:本期证明"补 UI 引导"可以完全不碰引擎 —— 当 Q1 技术链全既存时,scope 收敛到纯 app-side。
- **YAGNI 边界**:5 kind + 单文件面板 + 不扩到 events/bindings,由 4 次实证缺口(§3.v2/§3.v4×2)驱动,非预设抽象。

---

## 3.v7 §3.v7 详细设计:DATEPICKER `min`/`max` range + ISO 格式校验

**Scope = §3.v7 mini-scope**(§3.v5/§3.v6 候选池 #5,~1 天)。补 §3.v4 carry-over 留的 DATEPICKER 校验洞:当前只 emit `defaultValue`,无 range 约束、无格式校验。本期加 `min`/`max` 两键 + 一个共享 ISO 校验器(tool/IR/UI 三源),让非法日期/反向 range/越界 value 全部 no-swallow 出诊断(经验 C)。

**关键性质**:与 §3.v6 的"Q1 全既存"不同,本期 **emit 需新读 `min`/`max`**(Q1 部分新链),但仍是小体量 —— 一个 core 纯逻辑校验器(全可单测)+ emit 两行 attr + tool 一处校验 + UI 一个警告条。延续 §3.v6 的声明式 schema(min/max 作纯数据加进 `INTERACTIVE_PROP_FIELDS.DATEPICKER`,**不动** `InteractiveField` 类型 / 不加第 6 FieldKind —— §3.v6 锁)。

§3.v7 **不做**:`step` 属性(按天步进,YAGNI);自定义显示格式(原生 `<input type=date>` 只认 ISO,显示由浏览器 locale 决定,不可改);把 range 概念推广到其它数值控件(当前无 number-range 需求);live `:min`/`:max` 跨输入约束联动(改 `InteractiveField` 跨字段引用 —— 留 warn 警告条即可)。

### 3.v7.1 现状与问题

§3.v6 closed 2026-05-28 后,DATEPICKER 的 interactiveProps 仍只有一个 `value`(默认日期)字段,三处缺口:

1. **无 range 约束**:`applyDatePickerProps`(tree.ts:587)只 emit `type="date"` + `defaultValue`(从 `ip.value`),无 `min`/`max`。Bubble-like 表单常需"只能选未来日期 / 某区间"。
2. **`value` 零格式校验**:AI/CLI 可写 `value:"2026-13-45"` / `"next tuesday"` → emit `defaultValue` 垃圾值 → 浏览器静默丢弃(date input 显空),**无任何诊断**(违经验 C no-swallow)。
3. **tool boundary 不校验**:`update_lowcode_node`(lowcode.ts:468)对 `interactiveProps` 只 `isPlainObject` 检查,date 字段直接 pass-through。

§3.v6 panel 已给 DATEPICKER 一个 `date` kind 的 `value` 字段(浏览器原生 ISO 输入),但无 min/max、无跨字段/AI 引入值的校验反馈。

### 3.v7.2 关键决定

**8 主决定**:

| # | 决定 | 理由 |
|---|---|---|
| a | 新增 DATEPICKER `interactiveProps` 两键 **`min` / `max`**(ISO `YYYY-MM-DD` 字符串);复用既存 `value` 作默认日期。**不引 `step`**(YAGNI)| 原生 `<input type=date>` 的 `min`/`max` 是 range 的标准实现;复用 value 不新增"默认值"概念 |
| b | 新建**共享校验器** `validateDatePickerProps(ip)` 落 `@open-pencil/core/lowcode-validation/datepicker-props.ts` + barrel 导出;**3 消费方** tool input / IR collect / UI panel 同源 | 经验 I 单源,沿 §3.v3 `supabase-payload-entries.ts` 先例;校验逻辑只写一遍,三处不漂移 |
| c | ISO 判定 = 严格 `^\d{4}-\d{2}-\d{2}$`(零填充)+ **本地 `Date` round-trip** 拒非法历法日(`2026-02-30`/`2026-13-45`/`2026-2-3` 拒、`2024-02-29` 闰过)。**已 `bun -e` runtime probe 验证**(经验 K)| 单纯 regex 放行 `2026-13-45`;round-trip 是唯一可靠的"真历法日"判定 |
| d | 序关系 = **ISO 字符串字典序**(== 时序,已 probe);校验 `min<=max`、`value∈[min,max]` 均纯字符串比较,**无需 Date 解析排序** | YYYY-MM-DD 零填充 → 字典序恒等于时序;最简实现 |
| e | emit:`applyDatePickerProps` 校验后写 `attrs.min`/`attrs.max`(**合法才写**);非法 min/max/value → **跳过该 attr + push IR warning**(no-swallow)。`value` 既存逻辑保留 + 加校验 | 非法值不该污染产物 attr;但要出诊断,不静默 |
| f | tool boundary:`update_lowcode_node` 对 DATEPICKER 的 `value`/`min`/`max` 非法 → **reject 返 `{ok:false, error}`**(不静默 pass) | 与 §3.v2 payloadEntries 校验同档;AI 错填即时反馈 |
| g | UI:**不改** `InteractiveField` 类型 / 不加第 6 FieldKind(§3.v6 锁)。新增**同级导出** `INTERACTIVE_PROP_VALIDATORS: Partial<Record<NodeType,(ip)=>DatePickerIssue[]>>`,panel 按 `node.type` 查校验器 → 渲染警告条(node-type-gated,不脏化通用 kind 渲染)。min/max 作 `date` 字段加进 `INTERACTIVE_PROP_FIELDS.DATEPICKER`(纯数据增,合锁)| 保留 §3.v6 通用面板设计;校验是 per-type 的,用声明式 map 而非 `if (type==='DATEPICKER')` 硬编码(经验 J Q2) |
| h | **决定 ④⑤(越界策略)= warn + 保留**(用户 2026-05-29 ACK):`min>max` → 两 attr 都 emit(浏览器 date input 自禁选)+ warn;`value∉[min,max]` → 保留 `defaultValue`(浏览器显原值+标无效)+ warn。**不 auto-correct / 不 drop** | 匹配原生 date input 行为 + no-swallow(经验 C);不静默改用户输入。auto-correct 会让 product 看似合法但丢用户意图 |

**8 次级默认**:

1. **空串 = 未设**:`value`/`min`/`max` 空串 → 不 emit、不校验(沿 §3.v6 清空语义)
2. **min/max 缺一合法**:单边 range(只 min 或只 max)不报错
3. **value 越界 → warn 保留**(决 h):`datepicker-value-out-of-range`,defaultValue 仍 emit
4. **range 反向 → warn 保留**(决 h):`datepicker-range-inverted`,min+max 两 attr 都 emit
5. panel min/max date 字段复用 `lowcode-interactive-{key}` test-id(`lowcode-interactive-min` / `-max`)
6. 警告条新 test-id `lowcode-interactive-warning`;每条 issue 一行文案
7. i18n:2 label key `lowcodeInteractiveMin` / `lowcodeInteractiveMax` + 5 warning 文案 key(每 IR code 一条人读文案),× 8 文件(messages.ts + 7 locale json)
8. **不改 DATEPICKER node-defaults**(仍 `{ value: '' }`,不加 min/max 默认);**0 SceneNode / IR shape / Kiwi 改动**(min/max 是 interactiveProps record 内的普通 string,无 schema 升格)

**经验 J 三问题反向核**(强制):

| ACK 项 | Q1 技术链 | Q2 UI 引导 | Q3 心智模型 |
|---|---|---|---|
| panel 设 min/max → emit attrs → product 日历限可选范围 | ⚠️ emit 新读 min/max(step 2 新链)| ✅ step 4 带标签 date 输入 | ✅ "range=日历上下界"匹配原生 |
| value 默认日期(§3.v6 既存)| ✅ 既存 | ✅ 既存 | ✅ |
| AI 写 `value:"2026-13-45"` → tool reject | ⚠️ step 3 新校验 | n/a(error msg 即面)| ✅ 期望拒绝非静默 |
| min>max → panel 警告条 + 两 attr 都 emit | ⚠️ validator + IR warn(step 1/2)| ✅ step 4 警告条 | ✅ **决 h 锁 warn+keep**(匹配浏览器自禁选)|
| value∉[min,max] → 警告条 + 保留 value | ⚠️ 同上 | ✅ 警告条 | ✅ **决 h 锁 warn+keep**(浏览器显原值+标无效)|
| IR warning no-swallow | ⚠️ step 2 新码族 | ✅ panel 警告条=授权时面 / IR warn=编译面(沿 §3.v3)| ✅ |
| 零回归:既存 value-only + 其余 7 交互类型 | ✅ | ✅ | ✅ |

Q3 唯一风险(越界/反向策略)由决 h 锁定 warn+keep,经用户 ACK。

### 3.v7.3 公开 API / Schema 改动

```ts
// @open-pencil/core/lowcode-validation/datepicker-props.ts(新)
export type DatePickerIssueCode =
  | 'datepicker-invalid-value'
  | 'datepicker-invalid-min'
  | 'datepicker-invalid-max'
  | 'datepicker-range-inverted'
  | 'datepicker-value-out-of-range'

export interface DatePickerIssue {
  code: DatePickerIssueCode
  key?: 'value' | 'min' | 'max'   // 哪个字段(range-inverted 无单一 key)
}

export function isIsoDate(s: string): boolean
export function validateDatePickerProps(ip: Record<string, unknown>): DatePickerIssue[]
```

- ➕ **新文件** `packages/core/src/lowcode-validation/datepicker-props.ts`(纯逻辑,全可单测)
- 🔁 **barrel** `lowcode-validation/index.ts` 加导出 `isIsoDate` / `validateDatePickerProps` / `DatePickerIssue` / `DatePickerIssueCode`
- 🔁 **emit** `packages/compiler/src/ir/collect/tree.ts`:`applyDatePickerProps` 签名加 `node` + `ctx`(为 push warning);读 min/max + 校验 + emit attr + warn
- 🔁 **tool** `packages/core/src/tools/modify/lowcode.ts`:`interactiveProps` 校验分支加 DATEPICKER date 字段校验(node.type 已知时)
- 🔁 **UI schema** `src/components/properties/Lowcode/interactive-fields.ts`:`INTERACTIVE_PROP_FIELDS.DATEPICKER` 加 `min`/`max` date 字段 + **新同级导出** `INTERACTIVE_PROP_VALIDATORS`
- 🔁 **UI panel** `InteractivePropsPanel.vue`:按 `INTERACTIVE_PROP_VALIDATORS[node.type]` 渲染警告条
- ➕ **i18n** 2 label + 5 warning 文案 key × 8 文件
- 🔁 **test-id**:复用 `lowcode-interactive-min` / `-max`;新 `lowcode-interactive-warning`
- **0** SceneNode / ActionDef / Kiwi / `IRControlledInput` / `bindings.*` 改动;**0** node-defaults 改动;**不改** `InteractiveField` 类型 / FieldKind 字面(§3.v6 锁)

### 3.v7.4 内部实现拆解

#### `datepicker-props.ts`(新)

```ts
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isIsoDate(s: string): boolean {
  const m = ISO_RE.exec(s)
  if (!m) return false
  const [, y, mo, d] = m
  const dt = new Date(Number(y), Number(mo) - 1, Number(d))
  return (
    dt.getFullYear() === Number(y) &&
    dt.getMonth() === Number(mo) - 1 &&
    dt.getDate() === Number(d)
  )
}

// 空串 = 未设(次默 1),跳过;非空非法 → invalid issue;字典序比较(决 d)
export function validateDatePickerProps(ip: Record<string, unknown>): DatePickerIssue[] {
  // value/min/max:typeof string && !== '' 才校验
  //   非法 ISO → datepicker-invalid-{key}
  // min&max 都合法 && min > max → datepicker-range-inverted
  // value 合法 && (value < min || value > max) → datepicker-value-out-of-range
}
```

字典序比较(决 d):`min > max`、`value < min`、`value > max` 直接用字符串 `<`/`>`(YYYY-MM-DD 零填充 == 时序,已 probe)。

#### `tree.ts` `applyDatePickerProps`

```ts
function applyDatePickerProps(node: SceneNode, ip: InteractiveProps, attrs, ctx: WalkCtx): void {
  attrs.type = 'date'
  const issues = validateDatePickerProps(ip)
  for (const issue of issues) ctx.warnings.push({ code: issue.code, message: ..., nodeId: node.id })
  const badKeys = new Set(issues.filter(i => i.key && i.code.startsWith('datepicker-invalid')).map(i => i.key))
  // value/min/max:非空 && 未被标 invalid 才 emit(决 e + h:range-inverted/out-of-range 仍 emit)
  if (typeof ip.value === 'string' && ip.value !== '' && !badKeys.has('value')) attrs.defaultValue = ip.value
  if (typeof ip.min === 'string' && ip.min !== '' && !badKeys.has('min')) attrs.min = ip.min
  if (typeof ip.max === 'string' && ip.max !== '' && !badKeys.has('max')) attrs.max = ip.max
}
```

注意决 h:`range-inverted` / `value-out-of-range` issue **不**进 `badKeys`(它们不是格式非法),故 min/max/value 仍 emit —— 只 warn。仅 `datepicker-invalid-*`(格式坏)跳过该 attr。

#### `lowcode.ts` tool 校验

`interactiveProps` 校验分支:已知 `node.type === 'DATEPICKER'` 时跑 `validateDatePickerProps`,有任一 `datepicker-invalid-*` issue → `fail('interactiveProps: <key> must be YYYY-MM-DD')`。range-inverted / out-of-range 走 IR warn(决 h warn 而非 reject —— tool 不拦,留给 IR/UI 警告)。

#### `interactive-fields.ts`

```ts
DATEPICKER: [
  { key: 'value', kind: 'date', labelKey: 'lowcodeInteractiveDateValue' },
  { key: 'min', kind: 'date', labelKey: 'lowcodeInteractiveMin' },
  { key: 'max', kind: 'date', labelKey: 'lowcodeInteractiveMax' }
],
// 新同级导出
export const INTERACTIVE_PROP_VALIDATORS: Partial<Record<SceneNode['type'], (ip: Record<string, unknown>) => DatePickerIssue[]>> = {
  DATEPICKER: validateDatePickerProps
}
```

#### `InteractivePropsPanel.vue`

`computed` 取 `INTERACTIVE_PROP_VALIDATORS[node.type]?.(ip.value) ?? []`;非空 → 渲染警告条(`data-test-id="lowcode-interactive-warning"`),每 issue 一行(按 `issue.code` 查 i18n 文案)。其余 kind 渲染不变。

### 3.v7.5 成功标准 + Tauri ACK

1. `bun run check` 全绿(check:i18n 钉 7 label+warning key × 8 文件;Steiger 钉新 import;jscpd 0 clone)
2. `bun test ./tests/engine/compiler/` + `tools/lowcode/` 全绿;新增 `tests/engine/lowcode-validation/datepicker-props.test.ts`
3. **Tauri 实测(用户主导)~7 项 ACK**:

| # | ACK | Q1/Q2/Q3 |
|---|---|---|
| 1 | DATEPICKER 选中 → Properties 出 value/min/max 三 date 字段;设 min+max → Preview `<input type=date min= max=>` 日历限范围 | Q1 ⚠️(新 emit)/ Q2 ✅ / Q3 ✅ |
| 2 | 只设 value(§3.v6 既存)→ Preview defaultValue 不变(零回归)| ✅✅✅ |
| 3 | CLI/AI `update_lowcode_node` 写 `value:"2026-13-45"` → 返 `{ok:false,error}` reject | ⚠️✅(error msg)/ ✅ |
| 4 | panel 设 min>max → 出警告条(range inverted)+ Preview 两 attr 都在(浏览器禁选)| ⚠️✅✅(决 h)|
| 5 | value 设在 [min,max] 外 → 出警告条(out of range)+ defaultValue 保留 | ⚠️✅✅(决 h)|
| 6 | 合法历法边界:`2024-02-29`(闰)接受、`2026-02-30` 被 IR warn + 不 emit | ⚠️✅✅ |
| 7 | 其余 7 交互类型 Properties 零回归(§3.v6 全 ACK 仍 work)| ✅✅✅ |

4. 不破坏任一 Phase 0/1/2/§2/§3/§3.x/§3.v2/§3.v3/§3.v4/§3.v5/§3.v6 锁定决定(尤其 §3.v6 `InteractiveField` 类型 / 5 FieldKind / `INTERACTIVE_PROP_FIELDS` shape 不动)

### 3.v7.6 工作分解(建议 1 名工程师,~1 天)

| Step | 任务 | 验收 / commit |
|---|---|---|
| 0 | §3.v7 设计 doc + commit | `docs(lowcode): §3.v7 mini-scope detailed design (DATEPICKER range + ISO validation)` |
| 1 | `datepicker-props.ts` 共享校验器(`isIsoDate` + `validateDatePickerProps`)+ barrel + 单测 | `bun run check` + datepicker-props.test 全绿;`feat(lowcode): step 1 — shared validateDatePickerProps (§3.v7)` |
| 2 | `applyDatePickerProps` 读 min/max + 校验 + emit attr + IR warning 码族;compiler/IR 测试 | compiler + IR 测试全绿;`feat(lowcode): step 2 — DATEPICKER min/max emit + IR warnings (§3.v7)` |
| 3 | tool boundary DATEPICKER 校验;tools 测试 | tools/lowcode 测试全绿;`feat(lowcode): step 3 — tool-boundary DATEPICKER validation (§3.v7)` |
| 4 | schema 加 min/max + `INTERACTIVE_PROP_VALIDATORS` + panel 警告条 + i18n × 8 + Tauri ACK + §3.v7.8 + close | 7 ACK ✅;`docs(lowcode): §3.v7 Tauri verification + close` |

### 3.v7.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| `applyDatePickerProps` 签名改(加 node+ctx)漏改 callsite | 低 | 单一 callsite(`applyInteractiveProps` switch);tsgo 钉 |
| ISO round-trip 判定边界错(月份/闰年)| 中 | 已 `bun -e` probe(经验 K);step 1 单测覆盖 `2026-02-30`/`2024-02-29`/`2026-13-45`/`2026-2-3` |
| 决 h warn-keep:用户误以为越界值"生效"| 中 | 警告条文案明确"超出范围,浏览器会标无效";Tauri ACK #4/#5 专验 |
| `INTERACTIVE_PROP_VALIDATORS` 与 schema 漂移(将来加 emit 校验忘加)| 低 | 同源校验器 + 文件头注释;经验 E |
| i18n 7 key × 8 文件漏译 | 中 | check-locales 钉;step 4 单 commit 同步 |
| tool 校验与 IR warn 双轨(tool reject invalid-format,IR warn range)语义不一致引困惑 | 低 | 文档明示:格式坏=两处都拦/warn,range/越界=仅 warn(决 h)|

### 3.v7.8 Post-mortem

**§3.v7 closed 2026-05-29**(Tauri ACK 7/7 ✅,**零 surprise**)。补完 §3.v4 carry-over 的 DATEPICKER 校验洞:加 `min`/`max` range + 一个共享 ISO 校验器(tool/IR/UI 三源)。延续 §3.v5/§3.v6 的"Q3 洞已堵 → 零 surprise"对照组(连续第三个零-surprise mini-scope)。

#### Commit 链(5 个,无 hotfix)

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `f73ce03` | §3.v7 8 主 + 8 次默 + Q1/Q2/Q3 反向核;决 h(越界 warn+keep)对话锁 |
| 1 | `705a9a5` | `datepicker-props.ts` 共享校验器(`isIsoDate` 严格 regex + 本地 Date round-trip / `validateDatePickerProps` 字典序 range)+ barrel + 12 单测 |
| 2 | `04e7112` | `applyDatePickerProps` 读 min/max + 校验 + emit attr + 5 IR warning 码族(格式坏 drop、range/越界 warn-keep)+ 8 compiler 测试 |
| 3 | `6bc65a5` | tool boundary DATEPICKER 格式 reject(`buildPatch` 收 nodeType)+ 2 tool 测试 |
| 4 | `b6f60f6` | schema 加 min/max(纯数据,§3.v6 类型不动)+ 新同级导出 `INTERACTIVE_PROP_VALIDATORS`/`INTERACTIVE_WARNING_KEYS` + panel 警告条 + 7 i18n key × 8 文件 |
| close | _this commit_ | §3.v7.8 回填 + memory + close |

**测试**:`bun run check` 0 error / 4(type-aware)·5(structure)pre-existing max-lines / 0 clones / locales 同步 / Steiger 干净;412/412 compiler+tools 测试(原 405 + 8 IR/emit + 4→2 tool,`modify.test.ts` 因新测一度破 600,合并两 reject 测试压回 600 保持 max-lines warning 数不增 —— 沿 §3.v5/§3.v6 "0 新增 warning")。

#### Tauri ACK 结果(用户主导 2026-05-29)

| # | Check | Result |
|---|---|---|
| 1 | DATEPICKER 出 value/最早/最晚三 date 字段;min+max → Preview 日历限范围 | ✅ |
| 2 | 只设 value 零回归 | ✅ |
| 3 | AI/CLI 写非法 value → tool reject | ✅ |
| 4 | min>max → 橙色警告条 + 两 attr 仍 emit(浏览器禁选)| ✅(决 h 成立)|
| 5 | value 越界 → 警告条 + defaultValue 保留 | ✅(决 h 成立)|
| 6 | 闰年边界 `2024-02-29` 接受 / `2026-02-30` 拒 | ✅ |
| 7 | 其余 7 交互类型零回归 | ✅ |

#### Surprise 列表(0 个)

连续第三个零-Tauri-surprise mini-scope(§3.v5 / §3.v6 / §3.v7)。原因:Q1 部分新链(emit 读 min/max)但小且静测全覆盖;Q2 UI 引导(min/max 标签 + 警告条)设计阶段就位;**Q3 唯一风险(越界/反向 = warn-keep vs auto-correct)在设计阶段经 AskUserQuestion 锁定**(决 h),没留到 Tauri 才暴露。

#### 经验印证

- **K 第三次印证 → 升正(不再候选)**:决 c(ISO 格式判定)正确性取决于 `new Date()` round-trip 对非法历法日的行为 + ISO 字典序是否等于时序 —— 都用 `bun -e` runtime probe 实证后才落代码(`2026-02-30`→false、`2024-02-29`→true、`"2026-01-05" <= "2026-12-01"`)。3 次连续印证(§3.v5 SWITCH 默认 fill / §3.v6 emit 字段集静读 / §3.v7 日期判定 probe),**经验 K 正式升为正式经验**:依赖运行时形状/默认值/边界行为的决定必须 probe,别假设。
- **J Q3 在设计阶段堵洞 = 零 surprise 的直接原因**:§3.v4 的 3 个 hotfix 全是 Q3 洞没在设计阶段发现;§3.v7 把唯一 Q3 fork(越界策略)在 §3.v7.2 反向核时识别 → AskUserQuestion 让用户定 → 决 h 锁 → Tauri ACK #4/#5 一次过。**证明 J 的处理流程(Q3 洞 → 升回决定表 → 用户定)能把 §3.v4 式 hotfix 成本前移到设计阶段**。
- **I(三源同一 + scan 面)**:`validateDatePickerProps` 一处写、tool/IR/UI 三处调,check-locales 钉 7 key × 8 文件;延续 §3.v3 supabase-payload-entries 先例,0 漂移。
- **C(no-swallow)**:格式坏 → drop attr + warn;range/越界 → keep + warn;两类都出诊断(IR warning + panel 橙条),无静默。
- **§3.v6 通用面板保持通用**:校验是 per-type 的,用新同级导出 `INTERACTIVE_PROP_VALIDATORS` map(panel 按 node.type 查)而非 `if(type==='DATEPICKER')` 硬编码 —— 通用 kind 渲染器零改动,§3.v6 的 `InteractiveField`/5 FieldKind 锁全保持。

---

## §3.v8 SupabaseConfigPanel RLS policy advisor(静态 usage-driven,设计 2026-05-29)

候选池 #6(§3.8 follow-up #6 沿用)。用户在 §3.v7 close 后挑定 A(小修收尾),堵 §3.8 surprise #5 的 RLS silent-0-row footgun。**两关键岔口在设计阶段经 AskUserQuestion 锁定**(经验 J Q3 前移):形态 = A 静态策略顾问(对话锁);policy 谓词 = A `(true)` 占位 + 生产提醒注释(对话锁)。

### 3.v8.1 现状与问题

§2 决定 j 只做了「不配 RLS = 全表裸奔」的安全侧警告(首次 connect 一次性 toast + Properties 永久 inline note)。§3.8 surprise #5 暴露**另一侧 footgun**(功能侧,不是安全侧):

1. **anon 缺 UPDATE/DELETE policy → PATCH/DELETE 返 HTTP 204 但 0 行受影响**,看上去像「id 没传过去」,实际是 RLS 在 row 层把所有行挡在外面。PostgREST 对「RLS 拦截」和「0 行匹配」**返回完全一样**(204 / `[]`)—— 这正是它成为隐蔽 footgun 的原因,也是为什么**无法靠 anon REST API 可靠探测**(形态选 A 静态而非 B 实时探测的根因)。
2. **upsert 在 anon 缺 UPDATE policy 时静默 fallback 走 INSERT**,创建重复行(anon 看不到既有行 → 认为是新行)。
3. 现状缺口:用户在编辑器内**无从得知**「我这份文档用了哪些表、每张表需要哪些 anon policy」,只能去 Supabase dashboard 试错。

§3.8 把它列为 follow-up #6 nice-to-have(~1 day)。

### 3.v8.2 关键决定

**8 主决定**:

| # | 决定 | 理由 |
|---|---|---|
| a | **形态 = 静态 usage-driven 策略顾问**(用户 2026-05-29 AskUserQuestion ACK):扫描文档全部 supabase action,聚合「每表 → anon 所需操作集」→ 生成最小 anon RLS policy SQL + footgun 提示。**0 网络 / 0 破坏 / 确定性**。**不做实时探测(B)**:silent-0-row footgun 本质无法靠 anon REST 可靠探测,且 PostgREST RLS 运行时语义无 live 实例不可 probe(经验 K) | 直击 surprise #5;诚实于「可探测的边界」 |
| b | **共享纯函数** `collectRlsRequirements(actions: ActionDef[]): RlsTableRequirement[]` 落 `@open-pencil/core/lowcode-validation/rls-advisor.ts` + barrel 导出。**输入 = 已收集的 action 列表(不吃 graph API)**,纯逻辑全可单测;panel 侧用一个 thin walker 收集 root subtree 全部 `node.events` 的 action 喂进去 | 经验 I 单源,沿 §3.v3/v7 validator 先例;保持 lowcode-validation framework-agnostic(只 `import type { ActionDef } from '#core/scene-graph'`) |
| c | **operation → SQL command 映射**:`supabaseQuery` → `SELECT`;mutation `insert`→`INSERT` / `update`→`UPDATE` / `delete`→`DELETE` / **`upsert`→{`INSERT`,`UPDATE`}**(footgun 核心:upsert 缺 UPDATE 静默 INSERT 重复行)| upsert 双命令是用户最易踩的洞,显式拆开 |
| d | **SQL 生成**:每表一 block = `ALTER TABLE "<t>" ENABLE ROW LEVEL SECURITY;` + 每 command 一条 `CREATE POLICY "<t>_<cmd>_anon" ON "<t>" FOR <CMD> TO anon, authenticated <子句>;`。**USING / WITH CHECK 矩阵据 Postgres RLS 文档确定**(经验 K,文档化 PG 语义,非 probe):`SELECT`/`DELETE` → 仅 `USING (true)`;`INSERT` → 仅 `WITH CHECK (true)`;`UPDATE` → `USING (true) WITH CHECK (true)` | 标准 Postgres RLS 命令-子句矩阵;Tauri ACK #6 由用户在真 Supabase SQL editor 验跑通 |
| e | **target role = `anon, authenticated`**:emit 始终用 anon key(未登录);登录后 supabase-js 自动带 user JWT → role 变 `authenticated`。两者都需 policy 才不被挡 | 覆盖两种运行时身份;呼应 §2 `$currentUser` auth 同步 |
| f | **policy 谓词 = `(true)` 占位 + 生产提醒注释**(用户 2026-05-29 AskUserQuestion ACK):全放行最快解除 silent-0-row 阻塞;每 block 顶部 SQL 注释 `-- ⚠ replace (true) with a real predicate before production (e.g. auth.uid() = user_id)`。**不自动推断真实谓词(B)/ 不双段(C)** | 真谓词业务相关无法自动推断;顾问目的是「解除阻塞」;注释呼应 §2 决定 j 的「别裸奔上生产」 |
| g | **UI = SupabaseConfigPanel 内新折叠子区「RLS policies」**,仅当 `config 已设 && 文档有 ≥1 supabase action` 时显示;列每表 + 操作 chip + `<pre>` SQL 块 + Copy 按钮 + footgun 提示行。沿 §3.v3/v7「面板内信息区」先例,**无 e2e,Tauri ACK 验** | 收尾性 nice-to-have,信息展示型,无需独立 panel |
| h | **footgun 文案明示**:含 `UPDATE`/`DELETE`/upsert 的表,块顶橙色提示「Without these policies, update/delete return HTTP 204 with 0 rows changed (looks like a missing id), and upsert silently inserts duplicate rows.」(surprise #5 原话)| no-swallow 精神(经验 C):把隐蔽 footgun 显式化 |

**8 次级默认**:

1. 扫描范围 = root subtree 全部 node 的 `events`(所有 `EventName` → `ActionDef[]`);panel 侧 walker 遍历 `editor.graph` 全节点。
2. `table` 名 trim 后空 → 跳过(不入需求表)。
3. 聚合去重:同表多 action 合并操作集(`Set<SqlCommand>`),同表只出一个 block;block 内 command 按固定序 `SELECT,INSERT,UPDATE,DELETE` 排(稳定输出)。
4. Copy:**每表一个 Copy 按钮**(复制该表整 block SQL via `navigator.clipboard.writeText`)。**不做 Copy-all**(YAGNI)。
5. **0 supabase action(即便 config 已设)→ 整个 RLS 子区隐藏**(沿决 g 条件),不显示空态(零噪音)。
6. test-id:`lowcode-supabase-rls-advisor`(容器)/ `lowcode-supabase-rls-table`(每表行)/ `lowcode-supabase-rls-sql`(SQL `<pre>`)/ `lowcode-supabase-rls-copy`(copy 按钮)。
7. i18n:子区标题 + footgun 提示 + copy label + copied 反馈,**4 key × 8 文件**(messages.ts + 7 locale)。**SQL 内容本身不 i18n**(是代码)。
8. **0 SceneNode / IR / emit / Kiwi / ActionDef 改动**;compiler 完全不碰。纯 core 校验器新文件 + app-side panel 子区 + i18n。

**经验 J 三问题反向核**(强制):

| ACK 项 | Q1 技术链 | Q2 UI 引导 | Q3 心智模型 |
|---|---|---|---|
| config 设 + 文档有 supabaseMutation(update)→ RLS 子区出现,列该表 + UPDATE policy SQL + footgun 提示 | ⚠️ `collectRlsRequirements` + panel 子区(step 1/2 新链)| ✅ 标题+chip+SQL+copy 引导 | ✅「用了这表的 update → 这是要配的 policy」匹配心智 |
| upsert → SQL 含 INSERT+UPDATE 两条 + 明示 upsert footgun | ⚠️ 决 c upsert→{INSERT,UPDATE} | ✅ | ✅ upsert 需双 policy 是最易踩洞 |
| 0 supabase action → 子区不显示(零噪音)| ⚠️ 决 g/次默 5 条件 | ✅(无噪音即引导)| ✅ |
| Copy 按钮 → clipboard 拿到该表 SQL | ⚠️ clipboard API | ✅ copy 按钮+反馈 | ✅ |
| 多 action 同表 → 合并一个 block,操作集去重 | ⚠️ 聚合逻辑(单测覆盖)| ✅ | ✅ |
| **生成 SQL 可直接 paste 进 Supabase SQL editor 跑通**(USING/WITH CHECK 矩阵对)| ⚠️ **决 d Postgres RLS 矩阵**(经验 K,据 PG 文档锁;无 live 实例不可 probe)| n/a | ✅ |
| 零回归:Test connection / service_role reject / RLS note 仍 work | ✅ | ✅ | ✅ |

**唯一 Q3/K 风险**:生成的 SQL 能否在真 Supabase SQL editor 跑通(决 d 的 USING/WITH CHECK 命令矩阵)。我无 live Supabase 实例 → **据 Postgres RLS 官方文档锁矩阵 + 列为 Tauri ACK #6 重点验项**(用户在真实例 paste 跑)。这是诚实的「无法 probe → 用户 ACK 验」分工,符合 J 流程(把不可自验的 Q3 风险显式标到 ACK 表,而非假设)。

### 3.v8.3 公开 API / Schema 改动

```ts
// @open-pencil/core/lowcode-validation/rls-advisor.ts(新)
export type SqlCommand = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'

export interface RlsTableRequirement {
  table: string
  commands: SqlCommand[]          // 去重 + 固定序 SELECT,INSERT,UPDATE,DELETE
  needsWriteWarning: boolean      // 含 UPDATE/DELETE/upsert(footgun 提示触发)
}

export function collectRlsRequirements(actions: ActionDef[]): RlsTableRequirement[]
export function buildRlsPolicySql(req: RlsTableRequirement): string  // 一表整 block SQL
```

- ➕ **新文件** `packages/core/src/lowcode-validation/rls-advisor.ts`(纯逻辑,全可单测;只 `import type { ActionDef, SupabaseQueryAction, SupabaseMutationAction } from '#core/scene-graph'`)
- 🔁 **barrel** `lowcode-validation/index.ts` 加导出 `collectRlsRequirements` / `buildRlsPolicySql` / `RlsTableRequirement` / `SqlCommand`
- 🔁 **UI panel** `src/components/properties/Lowcode/SupabaseConfigPanel.vue`:新折叠子区,thin walker 收集 `editor.graph` 全节点 `events` 的 action → `collectRlsRequirements` → 渲染每表 block + `buildRlsPolicySql` + Copy
- ➕ **i18n** 4 key × 8 文件
- 🔁 **test-id**:4 新(`lowcode-supabase-rls-advisor` / `-table` / `-sql` / `-copy`)
- **0** SceneNode / ActionDef / IR / emit / Kiwi 改动;compiler 零改动

### 3.v8.4 内部实现拆解

#### `rls-advisor.ts`(新)

```ts
const COMMAND_ORDER: SqlCommand[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']

// supabaseQuery → SELECT;mutation operation → 命令集(upsert = INSERT+UPDATE,决 c)
function commandsForAction(a: ActionDef): SqlCommand[] {
  if (a.kind === 'supabaseQuery') return ['SELECT']
  if (a.kind === 'supabaseMutation') {
    switch (a.operation) {
      case 'insert': return ['INSERT']
      case 'update': return ['UPDATE']
      case 'delete': return ['DELETE']
      case 'upsert': return ['INSERT', 'UPDATE']
    }
  }
  return []
}

export function collectRlsRequirements(actions: ActionDef[]): RlsTableRequirement[] {
  const byTable = new Map<string, Set<SqlCommand>>()
  for (const a of actions) {
    if (a.kind !== 'supabaseQuery' && a.kind !== 'supabaseMutation') continue
    const table = a.table.trim()
    if (!table) continue              // 次默 2
    const set = byTable.get(table) ?? new Set<SqlCommand>()
    for (const c of commandsForAction(a)) set.add(c)
    byTable.set(table, set)
  }
  return [...byTable.entries()].map(([table, set]) => {
    const commands = COMMAND_ORDER.filter((c) => set.has(c))   // 次默 3 固定序
    return {
      table,
      commands,
      needsWriteWarning: commands.some((c) => c === 'UPDATE' || c === 'DELETE')
        || set.has('INSERT') && set.has('UPDATE')   // upsert 痕迹
    }
  })
}

// 决 d 命令-子句矩阵 + 决 e role + 决 f (true)+注释
export function buildRlsPolicySql(req: RlsTableRequirement): string {
  const t = req.table
  const lines = [
    `-- ⚠ replace (true) with a real predicate before production (e.g. auth.uid() = user_id)`,
    `alter table "${t}" enable row level security;`
  ]
  for (const cmd of req.commands) {
    const clause =
      cmd === 'INSERT' ? 'with check (true)'
      : cmd === 'UPDATE' ? 'using (true) with check (true)'
      : 'using (true)'   // SELECT / DELETE
    lines.push(
      `create policy "${t}_${cmd.toLowerCase()}_anon" on "${t}" for ${cmd.toLowerCase()} to anon, authenticated ${clause};`
    )
  }
  return lines.join('\n')
}
```

字符串拼接的表名/列名直接内插(table 名来自用户文档,Supabase SQL editor 手动 paste 场景,非自动执行 → 不引 SQL 注入面;identifier 用双引号包)。

#### `SupabaseConfigPanel.vue`

- thin walker:`useSceneComputed(() => { const acts: ActionDef[] = []; walk editor.graph 全节点; for node.events 各 EventName 各 action push; return collectRlsRequirements(acts) })`
- 子区 `v-if="config && requirements.length"`(决 g + 次默 5):折叠区标题 `lowcodeSupabaseRlsHeading`;`v-for` 每 req:
  - 表名 + 命令 chip 行(`lowcode-supabase-rls-table`)
  - `needsWriteWarning` → 橙色 footgun 提示行(`lowcodeSupabaseRlsWriteWarning`)
  - `<pre data-test-id="lowcode-supabase-rls-sql">{{ buildRlsPolicySql(req) }}</pre>`
  - Copy 按钮(`lowcode-supabase-rls-copy`)→ `navigator.clipboard.writeText` + 短暂 copied 反馈
- 子区挂在现有 RLS note(`lowcode-supabase-rls-note`)之后,保持 §2 安全 note 在前。

### 3.v8.5 成功标准 + Tauri ACK

1. `bun run check` 全绿(check:i18n 钉 4 key × 8 文件;Steiger 钉新 import / arch 边界;jscpd 0 clone)
2. `bun test ./tests/engine/tools/lowcode/` 全绿(零回归)+ 新增 `tests/engine/lowcode-validation/rls-advisor.test.ts`(聚合 / 去重 / upsert 双命令 / 空表名跳过 / SQL 矩阵 / 固定序)
3. **Tauri 实测(用户主导)~7 项 ACK**:

| # | ACK | Q1/Q2/Q3 |
|---|---|---|
| 1 | config 设 + 文档有 update mutation → Properties RLS 子区出现,列该表 + `for update ... using(true) with check(true)` SQL + footgun 提示 | ⚠️✅✅ |
| 2 | upsert action → SQL 含 INSERT + UPDATE 两条 + upsert footgun 提示 | ⚠️✅✅ |
| 3 | 0 supabase action(纯静态文档)→ RLS 子区不显示 | ⚠️✅✅ |
| 4 | Copy 按钮 → 粘贴到别处拿到完整 block SQL | ⚠️✅✅ |
| 5 | 同表多 action(query + update)→ 合并一个 block,SELECT+UPDATE 两条去重 | ⚠️✅✅ |
| 6 | **生成 SQL paste 进真 Supabase SQL editor 跑通**,跑后原本 silent-0-row 的 update 真正改到行 | ⚠️(Postgres 矩阵,决 d)✅✅ |
| 7 | 零回归:Test connection / service_role reject / §2 RLS note 仍 work | ✅✅✅ |

4. 不破坏任一 Phase 0/1/2/§2/§3/§3.x/§3.v2-v7 锁定决定(尤其 §2 SupabaseConfigPanel 既有 service_role reject + Test connection + RLS note 不动)

### 3.v8.6 工作分解(建议 1 名工程师,~1 天)

| Step | 任务 | 验收 / commit |
|---|---|---|
| 0 | §3.v8 设计 doc + commit | `docs(lowcode): §3.v8 mini-scope detailed design (RLS policy advisor)` |
| 1 | `rls-advisor.ts`(`collectRlsRequirements` + `buildRlsPolicySql` + 类型)+ barrel + 单测 | `bun run check` + rls-advisor.test 全绿;`feat(lowcode): step 1 — shared RLS policy advisor (§3.v8)` |
| 2 | SupabaseConfigPanel RLS 子区(walker + 渲染 + Copy)+ 4 i18n key × 8 文件 + Tauri ACK + §3.v8.8 + close | 7 ACK ✅;`docs(lowcode): §3.v8 Tauri verification + close` |

(仅 2 个功能 step:core 纯函数 + app panel;无 compiler/IR/emit/tool 改动 → 比 §3.v7 的 4 step 更小。)

### 3.v8.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| Postgres RLS USING/WITH CHECK 命令矩阵记错(决 d)| 中 | 据 PG 官方文档锁(SELECT/DELETE=USING、INSERT=WITH CHECK、UPDATE=两者);Tauri ACK #6 用户真实例 paste 跑验 |
| walker 漏某 EventName 的 action(union 漏 case)| 低 | 遍历 `Object.values(node.events ?? {})` 全 ActionDef[],不按 EventName 硬编码;单测喂多 EventName |
| `(true)` 占位让用户误以为安全(裸奔上生产)| 中 | 决 f SQL 注释 + footgun 提示双重明示「replace before production」;呼应 §2 决定 j |
| clipboard API 在 Tauri WKWebView 不可用 | 低 | `navigator.clipboard` 在 WKWebView 可用(§3.v3 toast / 既有 copy 路径先例);失败 catch 不崩 |
| i18n 4 key × 8 文件漏译 | 中 | check-locales 钉;step 2 单 commit 同步 |
| 子区与 §2 既有 RLS note 视觉/语义重叠 | 低 | note=安全侧(裸奔警告)/ 顾问=功能侧(解除 silent-0-row);顾问挂 note 之后,文案区分 |

### 3.v8.8 Post-mortem

**§3.v8 closed 2026-05-29**(Tauri ACK 7/7 ✅,**零 surprise** —— 连续第四个零-Tauri-surprise mini-scope,§3.v5/v6/v7/v8)。补完 §3.8 surprise #5 的 RLS silent-0-row footgun:静态 usage-driven 策略顾问扫文档全部 Supabase action → 每表 anon 操作集 → 可 copy 的 `CREATE POLICY` SQL + footgun 提示。

#### Commit 链(2 个功能 step + 设计,无 hotfix)

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `6cad85b` | §3.v8 8 主 + 8 次默 + Q1/Q2/Q3 反向核;两 Q3 岔口(形态 / 谓词)经 AskUserQuestion 锁定 |
| 1 | `ec0c952` | 共享 `rls-advisor.ts`(`collectRlsRequirements` + `buildRlsPolicySql`,upsert→{INSERT,UPDATE}、Postgres USING/WITH CHECK 矩阵、`(true)` + 生产提醒)+ barrel + 9 单测 |
| 2 | `3a1b973` | SupabaseConfigPanel RLS 子区(graph walk + chip + SQL + Copy + 橙 footgun 条)+ 4 i18n key × 8 文件 |
| close | _this commit_ | §3.v8.8 回填 + memory + close |

#### Tauri ACK 结果(用户主导 2026-05-29)

7/7 ✅。重点 #6(我无 live 实例不可自验的 Q3/K 风险):生成 SQL paste 进真 Supabase SQL editor 跑通,跑后原本 silent-0-row 的 update 真正改到行 —— **决 d 的 Postgres USING/WITH CHECK 命令矩阵实测成立**。

#### Surprise 列表(0 个,但孵出一个 follow-up scope)

§3.v8 顾问本身零 surprise。但 ACK #3(authenticated 角色端到端)暴露:`TO authenticated` 那半 policy 无代码路径可触达 —— 因为 §2 决定 #5 把 auth 动作 defer 了,`AuthControls` 还是 info-toast shim。用户遂挑「顺手弄 signIn/signOut」→ 孵出 **§2.v2**(见下)。这不是 §3.v8 的 bug,是它把一个既存缺口照出来了(经验 H:Tauri 实测照出设计层缺口)。

#### 经验印证

- **零-surprise 第四连**:两 Q3 岔口(形态 = 静态顾问 vs 实时探测;谓词 = `(true)` vs 所有权模板)在 §3.v8.2 反向核时识别 → AskUserQuestion 锁 → Tauri 一次过。诚实标注「无法自验的 SQL-跑通风险」到 ACK #6 → 用户验。
- **C(no-swallow)**:silent-0-row footgun 本来是「看不见的 204/0 行」,顾问把它显式化成可 copy 的 SQL + 橙色提示。
- **诚实于可探测边界**:形态选 A 而非 B,正因 PostgREST 对 RLS-拦截 / 0-行-匹配返回相同(204/`[]`)—— footgun 不可靠探测,且无 live 实例不可 probe PostgREST 语义(经验 K 的边界:probe 不了就别假装能探测,改成确定性的静态推导 + 用户 ACK 验)。

---

## §2.v2 Supabase auth action — signIn / signOut(设计 2026-05-29)

§2 决定 #5 把 auth helper(`signIn(email,pwd)` / `signOut()`)defer 到 §2.v2:它们只活在 emit 侧 `useSupabaseAuth()` hook,`AuthControls.vue` 在 BUTTON 面板放了个 info-toast shim,无真动作。本期补齐:加**第 7 个 `ActionDef` kind** 让 signIn/signOut 成为可在 EventsPanel 配置的真动作。**用户 2026-05-29 在 §3.v8 ACK 间隙挑定「顺手弄一下 signIn/signOut」** → 经评估为完整跨 walker mini-scope(非顺手),按 §3.v8 同等纪律设计。

### 2.v2.1 现状与问题

1. `ActionDef` union 锁死 6 种(§2 决定 #5),auth 不在内 → 无代码路径**无法登录/登出**。emit 侧 `useSupabaseAuth().signIn/signOut` 存在,但只能在导出项目里**手写代码**调。
2. `AuthControls.vue`(BUTTON 面板)的 signIn/signOut 按钮只 `toast.info` 提示运行时 API 名,**不是真动作**(§2 决定 #5 shim)。
3. 直接后果:生成的 app 实际**始终跑 `anon` 角色**(除非手写 signIn)→ `TO authenticated` 那半 RLS policy(§3.v8 决 e)无代码路径触不到。补 auth action 后,登录闭环 + authenticated 角色才能端到端走通。

### 2.v2.2 关键决定

**8 主决定**:

| # | 决定 | 理由 |
|---|---|---|
| a | **新增第 7 个 `ActionDef` kind `SupabaseAuthAction`**(`kind:'supabaseAuth'`),**推翻 §2 决定 #5 的「ActionDef union 锁 6 种」**(用户 2026-05-29 ACK)| auth 是 Supabase 表单核心闭环;§2 defer 是体量考量,现补齐 |
| b | **shape** `{ id, kind:'supabaseAuth', operation:'signIn'\|'signOut', emailExpr?, passwordExpr?, errorTarget? }`。signIn 的 email/password 用 §2 表达式子语言(同 `SupabaseFilter.valueExpr`/`payloadEntries.valueExpr` → 可绑 INPUT/docState);signOut 无输入 | 复用既有表达式机器(0 新 grammar);email/password 绑控件 state 是登录表单刚需 |
| c | **emit 走 `getSupabaseClient().auth.*` 内联**(非 hook hoisting,镜像 supabaseQuery/Mutation):signIn → `signInWithPassword({ email, password })`;signOut → `signOut()`。两者进 `BLOCK_KINDS` + try/catch | `getSupabaseClient()` 是普通模块函数非 hook,handler 内可直接调 —— **无需组件顶层 hoist hook**(静读 `emit/event.ts` 确认) |
| d | **emit 返回形状区分**(已 `bun -e` runtime probe,经验 K):signIn 返 `{ data, error }`(data=`{user,session}`);signOut 返 **`{ error }`(无 data)**。signOut 只做 error 检查,**不写 resultTarget**;signIn 同理不强制 resultTarget | probe 实证:`signOut()` 仅 `error` 键 / `signInWithPassword()` 为 `{data:{user,session},error}` |
| e | **`$currentUser` 自动同步,不手写**:运行时 `lowcode-supabase.ts` 既有 `onAuthStateChange` 在 signIn/signOut 后自动刷新 `$currentUser` docState → 动作**不暴露 resultTarget**,登录态靠 `$currentUser` 响应式 | 避免双写 $currentUser;UI 简化(只 errorTarget) |
| f | **删 `AuthControls.vue` shim**(用户 ACK):移除组件 + EventsPanel import/mount + 5 个 `lowcodeAuth*` i18n key + 3 个 `lowcode-auth-*` test-id。真路径 = EventsPanel supabaseAuth 动作 | 真动作上线后 shim 冗余;两入口易混淆 |
| g | **tool 校验**:`KNOWN_ACTION_KINDS` 加 `'supabaseAuth'`;`buildActionFromValidated` 加 case(exhaustive 注释 6→7);emailExpr/passwordExpr **坏表达式 → reject**(同 payloadEntries valueExpr),**缺失 → IR warn**(同 supabaseQuery no-table,不硬 reject)| 与既有 action 校验同档:语法错即时拦,缺值留 IR 诊断 |
| h | **0 Kiwi 改动**:ActionDef 经 `events` pluginData JSON 旁路持久化,新 kind 只是更多 JSON,零 vendored kiwi schema 改动 | 沿 §2/§3 全部先例;step 1 加往返测试钉死 |

**8 次级默认**:

1. signIn UI 显 email/password expr 输入 + 可选 errorTarget;signOut UI 只显 operation select(+ 可选 errorTarget)。
2. email/password placeholder 提示(沿 §3.v3 教训:字符串要引号),通常绑 INPUT docState 标识符 → `如 emailInput 或 'a@b.com'`。
3. **不暴露 resultTarget**(决 e:$currentUser 自动同步)。
4. `makeAction('supabaseAuth')` 默认 `{ operation:'signIn', emailExpr:'', passwordExpr:'' }`。
5. i18n 新增 ~6 key(action kind label `lowcodeActionSupabaseAuth` + operation signIn/signOut label + email/password label + placeholder)× 8 文件;**删 5 个 `lowcodeAuth*` key**。
6. test-id:`lowcode-action-auth-operation` / `-email` / `-password`(沿 `lowcode-action-*` 前缀);删 `lowcode-auth-label`/`-sign-in`/`-sign-out`。
7. errorTarget 走 docState 名校验(同 supabaseQuery errorTarget)。
8. **0 新 npm import**(supabase-js 已 pinned);emit 产物零新依赖。

**经验 J 三问题反向核**(强制):

| ACK 项 | Q1 技术链 | Q2 UI 引导 | Q3 心智模型 |
|---|---|---|---|
| EventsPanel 加 supabaseAuth/signIn,email/password 绑 INPUT docState → 按钮点击 → 登录 → `$currentUser.signedIn` 变 true | ⚠️ 全新 kind 跨 schema/IR/emit/tool/UI(step 1-3 新链)| ✅ operation select + email/password 输入 + placeholder | ✅ "配置登录动作"匹配 Bubble 心智 |
| signOut 动作 → 点击 → `$currentUser` 清空 | ⚠️ 决 d 无 data 分支 | ✅ operation=signOut 隐藏 email/password | ✅ |
| signIn 后角色变 authenticated → §3.v8 `TO authenticated` policy 生效 | ⚠️ 端到端依赖 supabase-js JWT 注入 | n/a | ✅ 闭合 §3.v8 决 e 的前向兼容 |
| 坏 email/passwordExpr → tool reject | ⚠️ 决 g 校验 | n/a(error msg)| ✅ |
| 删 AuthControls 后 BUTTON 面板无 shim,EventsPanel 出真动作 | ⚠️ 删组件 + mount | ✅ 单一入口 | ✅ 消除"提示 vs 真动作"困惑 |
| 零回归:既有 6 kind + .fig 往返 | ✅ | ✅ | ✅ |

唯一 Q3/K 风险(supabase-js auth 返回 shape)**已 `bun -e` runtime probe 实证**(决 d)→ 设计阶段已堵。端到端登录(authenticated 角色)与 §3.v8 SQL 一并由用户 Tauri ACK 验。

### 2.v2.3 公开 API / Schema 改动

```ts
// packages/core/src/scene-graph/types.ts
export interface SupabaseAuthAction {
  id: string
  kind: 'supabaseAuth'
  operation: 'signIn' | 'signOut'
  emailExpr?: string      // signIn only; §2 表达式子语言(可绑 INPUT/docState)
  passwordExpr?: string   // signIn only
  errorTarget?: string    // 可选;decision e 不暴露 resultTarget
}
export type ActionDef = … | SupabaseAuthAction   // 6 → 7 kinds(推翻 §2 #5)
```

- 🔁 **schema** `types.ts`:新 interface + ActionDef union 第 7 kind
- 🔁 **IR types** `ir/types.ts`:`IRSupabaseAuthHandler`(`emailAst?`/`passwordAst?`/`references`/`errorTarget?`)加进 `IREventHandler` union
- 🔁 **IR collect** `bindings.ts`:`resolveActions` switch 加 `supabaseAuth`;新 `resolveSupabaseAuth`(parse email/password expr,镜像 `resolveSupabaseMutation`)
- 🔁 **emit** `emit/event.ts`:`BLOCK_KINDS` 加 `supabaseAuth` + case + `emitSupabaseAuth`(signIn=`{data,error}`、signOut=`{error}`)
- 🔁 **tool** `modify/lowcode.ts`:`KNOWN_ACTION_KINDS` + `buildActionFromValidated` case + email/password expr 校验
- 🔁 **EventsPanel.vue**:`ACTION_KINDS`/`actionKindLabel`/`makeAction`/errors/template 加 supabaseAuth 表单;**删 `AuthControls` import + mount**
- ➖ **删 `AuthControls.vue`** + 5 `lowcodeAuth*` i18n key + 3 `lowcode-auth-*` test-id
- ➕ **i18n** ~6 新 key × 8 文件(净增 ~1)
- **0** Kiwi / node-defaults / 新 npm 改动

### 2.v2.4 内部实现拆解

#### emit `emitSupabaseAuth`(`emit/event.ts`)

```ts
function emitSupabaseAuth(h: IRSupabaseAuthHandler): string {
  if (h.operation === 'signOut') {
    // 决 d:signOut 返 { error },无 data
    const errorWrite = h.errorTarget ? `setDocState(${JSON.stringify(h.errorTarget)}, error); ` : ''
    return `try { const { error } = await getSupabaseClient().auth.signOut(); ` +
      `if (error) { ${errorWrite}console.error("signOut failed:", error) } } ` +
      `catch (err) { console.error("signOut threw:", err) }`
  }
  // signIn:{ data, error };email/password expr;$currentUser 自动同步(不写 data)
  const email = emitExpression(h.emailAst)
  const password = emitExpression(h.passwordAst)
  const errorWrite = h.errorTarget ? `setDocState(${JSON.stringify(h.errorTarget)}, error); ` : ''
  return `try { const { error } = await getSupabaseClient().auth.signInWithPassword({ email: ${email}, password: ${password} }); ` +
    `if (error) { ${errorWrite}console.error("signIn failed:", error) } } ` +
    `catch (err) { console.error("signIn threw:", err) }`
}
```

（signIn 也只解构 `{ error }`:登录成功后 `$currentUser` 靠 `onAuthStateChange` 自动同步,无需 `data`。决 e。）

#### IR collect `resolveSupabaseAuth`(`bindings.ts`)

镜像 `resolveSupabaseMutation`:signIn 时 parse emailExpr/passwordExpr(空 → IR warn `action-supabase-auth-missing-credentials`;坏 → 该 action drop + warn);errorTarget 校验 docState 名。signOut 时跳过 email/password。

#### tool `modify/lowcode.ts`

`KNOWN_ACTION_KINDS` += `'supabaseAuth'`;`buildActionFromValidated` case 构造 `SupabaseAuthAction`;signIn 的 emailExpr/passwordExpr 走 `parseExpression`,坏 → `fail(...)`。exhaustive 注释 6→7。

#### EventsPanel.vue + 删 AuthControls

`ACTION_KINDS` 末加 `'supabaseAuth'`;`makeAction` 默认 signIn;template 加 `v-else-if="action.kind === 'supabaseAuth'"`:operation select + (signIn 时)email/password expr 输入 + 可选 errorTarget。删 `import AuthControls` + `<AuthControls />`(行 22 / 449),删 `AuthControls.vue` 文件 + 5 i18n key。

### 2.v2.5 成功标准 + Tauri ACK

1. `bun run check` 全绿;`bun test ./tests/engine/compiler/` + `tools/lowcode/` + kiwi 往返全绿;新增 emit/IR/tool/cross-walker 测试
2. **Tauri 实测(用户主导)~7 项 ACK**:

| # | ACK |
|---|---|
| 1 | EventsPanel 选 Supabase auth → signIn,email 绑 emailInput docState、password 绑 passwordInput → 按钮点击 → 真登录,`$currentUser.signedIn` 变 true |
| 2 | signOut 动作 → 点击 → `$currentUser` 清空(signedIn=false)|
| 3 | 登录后访问 `TO authenticated` 的表(§3.v8 SQL 跑过)→ 读写成功(authenticated 角色端到端)|
| 4 | 坏 emailExpr(如 `a@b.co` 不加引号)→ tool/IR 诊断 |
| 5 | BUTTON 面板**不再有** AuthControls shim;EventsPanel 出真 auth 动作 |
| 6 | 零回归:既有 6 kind 动作 + .fig 存读往返 |
| 7 | **(Q2 后补,commit `47fb59a`)** auth 表单下显示 `$currentUser` 提示 + SupabaseConfigPanel 显 `$currentUser` note —— 用户无需被告知即可发现 `$currentUser.signedIn / .email / .id`(Tauri 实测找出的 Q2 可发现性洞,经验 H/J Q2)|

3. 不破坏 §2/§3/§3.x/§3.v2-v8 其余锁定(除明确推翻的 §2 #5 6-kind 锁)

### 2.v2.6 工作分解(建议 1 名工程师,~2-3 天)

| Step | 任务 | commit |
|---|---|---|
| 0 | §2.v2 设计 doc + commit | `docs(lowcode): §2.v2 mini-scope detailed design (Supabase auth action)` |
| 1 | schema `SupabaseAuthAction` + ActionDef 7th kind + Kiwi 往返测试 | `feat(lowcode): step 1 — SupabaseAuthAction schema + persistence (§2.v2)` |
| 2 | IR types + collect `resolveSupabaseAuth` + emit `emitSupabaseAuth`(signIn/signOut)+ compiler/IR 测试 | `feat(lowcode): step 2 — auth action IR collect + emit (§2.v2)` |
| 3 | tool 校验(`KNOWN_ACTION_KINDS` + buildAction + expr 校验)+ tools 测试 | `feat(lowcode): step 3 — tool-boundary auth action validation (§2.v2)` |
| 4 | EventsPanel supabaseAuth 表单 + 删 AuthControls + i18n × 8 + Tauri ACK + §2.v2.8 + close | `docs(lowcode): §2.v2 Tauri verification + close` |

### 2.v2.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| ActionDef union widening 漏 walker case(经验 A/G)| 中 | exhaustive `never` switch(emit/tool 都有)tsgo 钉;grep `ActionKind`/`action.kind` 全 callsite;cross-walker 测试 |
| supabase-js auth 返回 shape 记错 | 低 | 已 `bun -e` probe(决 d):signOut=`{error}`、signIn=`{data,error}` |
| 删 AuthControls 漏清 i18n key / test-id 引用 | 中 | check-locales 钉;grep `lowcodeAuth`/`lowcode-auth-` 全仓清零 |
| Kiwi 往返漏新 kind | 低 | events 走 JSON pluginData(决 h),step 1 往返测试钉 |
| email/password 明文 expr 暴露 | 低(设计内)| 绑 INPUT docState(运行时值),非硬编码;placeholder 引导绑控件 |
| EventsPanel 已 912 行,加表单更大 | 低 | .vue 非 oxlint max-lines 扫描域;表单 ~60 行,接受 |

### 2.v2.8 Post-mortem

**§2.v2 closed 2026-05-29**(Tauri ACK 7/7 ✅;auth 功能本身首过零 bug,但 Tauri 找出 **1 个 Q2 可发现性洞**,mid-ACK 补掉)。从 §3.v8 ACK 孵出:加第 7 个 `ActionDef` kind `SupabaseAuthAction`(推翻 §2 决定 #5 的 6-kind 锁),补完登录闭环 → authenticated 角色端到端打通。

#### Commit 链(5 step + 设计 + 1 Q2 后补 + ACK doc)

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `c0190c2` | 7th ActionDef kind + Q1/Q2/Q3;auth 返回 shape `bun -e` probe |
| 1 | `e3c4bd3` | `SupabaseAuthAction` schema + 0-Kiwi 持久化往返 + union-widening sweep(tool 构造 / EventsPanel errors stub,经验 A/G)|
| 2 | `e5444a3` | IR collect `resolveSupabaseAuth` + emit `emitSupabaseAuth`(signIn `{data,error}` / signOut `{error}`)+ 9 测试;3 supabase emit 测试移进 `emit/supabase/` 子文件夹(Steiger domain-folder)|
| 3 | `1b4a48a` | tool 校验(坏 expr reject / 缺失 warn)+ tool 描述 §2.v2 段 + 独立 `auth-action.test.ts`(避免 modify.test.ts 破 600)|
| 4 | `a8954b6` | EventsPanel auth 表单(operation + email/password expr + errorTarget + 红框)+ **删 AuthControls shim** + i18n(删 5 旧 key、加 5 新 key)|
| Q2 后补 | `47fb59a` | **`$currentUser` 可发现性提示**(auth 表单 + SupabaseConfigPanel note)+ 2 i18n key —— Tauri 实测找出的 Q2 洞 |
| ACK doc | `862f4da` | §2.v2.5 加 ACK #7($currentUser 提示)|
| close | _this commit_ | §2.v2.8 回填 + memory + close |

#### Tauri ACK 结果(用户主导 2026-05-29)

7/7 ✅:signIn 绑 INPUT → 真登录 `$currentUser.signedIn` 变 true(#1)/ signOut 清空(#2)/ **登录后 authenticated 角色访问 `TO authenticated` 表读写成功(#3,端到端闭合 §3.v8 决 e 的前向兼容)**/ 坏 emailExpr reject(#4)/ AuthControls shim 已删、EventsPanel 出真动作(#5)/ 6 既有 kind + .fig 往返零回归(#6)/ `$currentUser` 提示显示(#7)。

#### Surprise 列表(1 个 Q2 可发现性洞,mid-ACK 补)

1. **`$currentUser` 无可发现性**(commit `47fb59a` 补)—— auth wiring 全对(登录/登出/角色切换 ACK 一次过),但 `$currentUser` 是编译期注入、不在 DocumentState 面板、无任何提示其 `{id,email,signedIn}` shape。用户必须被告知才知道能绑 `$currentUser.signedIn/.email`。**这是 §2.v2.2 Q2 列的自漏**:设计阶段反向核了 auth 表单本身的 Q2 affordance(operation select / email-password 输入 / placeholder),但漏了下游「登录态在哪儿浮现给用户」的可发现性。补法:auth 表单下 + SupabaseConfigPanel 加上下文提示(决 A,经 AskUserQuestion)。
   - 旁注:ACK 期间用户还活体重现了 §3.v3 的表达式引号坑(裸 `a@b.co` → `unexpected character '@'`),但 placeholder `e.g. emailInput or 'a@b.co'` 已含引号提示 → 是「校验正确 surface(经验 C)+ 提示已就位」,非新 surprise。

#### 经验印证

- **H(Tauri 找 UX 洞)再印证**:即便 Q1(wiring)+ Q3(心智模型)首过全绿,Tauri 仍找出 1 个 Q2 可发现性洞($currentUser)—— 同 §3.v2 ACK #1/#2(BUTTON.text 无 UI)那一类,测试不可能发现。**§2.v2 中断了 §3.v5-v8 的「零-surprise 四连」,但 surprise 是 Q2 可发现性(additive 提示),非 Q3 行为 bug**;auth 行为本身首过零 hotfix。
- **A + G(union widening 6→7)**:`ActionDef` 加第 7 kind,tsgo `never` exhaustive 只逼出 1 处(tool buildAction),其余 emit/collect 是 IR-type 侧、EventsPanel 是 if-chain;step 1 即把强制 callsite 扫平保持 build 绿,step 2-4 补全。0 漏 case。
- **K(运行时形状必 probe)**:决 d 的 emit 形状(signOut `{error}` 无 data / signIn `{data,error}`)`bun -e` 实证后才写 → emit 一次对,ACK 无返回-shape surprise。
- **E(emit 内联 vs hook)**:静读 `emit/event.ts` 确认 supabase action 用 `getSupabaseClient()` 内联(非 hook),signIn/signOut 才能同模式 emit 而无需组件顶层 hoist hook —— 这是「顺手」可行的关键,设计阶段静读避免了一个潜在大坑。
- **流程**:§2.v2 是个好样本——一个 scope(§3.v8)的 Tauri ACK 照出另一个既存缺口(auth defer),用户当场挑成新 scope,按同等设计纪律(§X.2 决定 + Q1/Q2/Q3 + probe)走完。Q2 自漏被 Tauri 接住并 mid-ACK 补 → 仍受控收尾。

---

## §2.v3 Supabase signUp action — 注册(设计 2026-05-29)

§2.v2 交付登录/登出(第 7 个 `ActionDef` kind `supabaseAuth`,operation `signIn`/`signOut`)。注册缺位 → 用户必须去 Supabase Dashboard 手建测试用户才能跑 signIn,认证三件套(登录/登出/**注册**)缺一角。本期补 signUp,补完三件套。**用户 2026-05-29 在 §2.v2 close 后挑定方向 A(signUp 收尾)**。

### 2.v3.1 现状与问题

1. `SupabaseAuthAction.operation` 只有 `signIn`/`signOut`,无注册路径 → 生成的 app 无法在应用内创建账户,测试用户得去 Dashboard 手建。
2. emit 侧 `supabase.auth.signUp` 早已在 SDK(supabase-js pinned),**无任何代码路径触达**——镜像 §2.v2 前 signIn/signOut 只活在 hook 的局面。
3. signUp 与 signIn **完全同构**(email + password + 可选 errorTarget,返回 `{ data, error }`),唯一额外语义是 **email 确认门控**(见决 e)。

### 2.v3.2 关键决定

**8 主决定**(决 a / 决 e 经 AskUserQuestion 锁,均取推荐项):

| # | 决定 | 理由 |
|---|---|---|
| a | **复用 `supabaseAuth` kind,扩 `operation` union 为 `'signIn'\|'signOut'\|'signUp'`**,**不**加第 8 个 `ActionDef` kind(用户 2026-05-29 AskUserQuestion ACK 推荐项)| signUp shape 与 signIn 完全相同;加 8th kind 会全链重复 schema/IR/emit/tool/UI + 触发 `ActionDef` union widening(经验 A/G),零额外收益。镜像 `supabaseMutation` 用 operation 装 insert/update/delete/upsert 的先例。**`ActionDef` 仍 7 kind,§2.v2 锁不动** |
| b | **0 schema struct 改动**:只把 `SupabaseAuthAction.operation` 字面量 union 加 `'signUp'`;emailExpr/passwordExpr/errorTarget 全复用 | signUp = signIn 的同构动作 |
| c | **emit 走 `getSupabaseClient().auth.signUp({ email, password })` 内联**(同 §2.v2 决 c,非 hook hoist):`call` 三元从「signOut vs signIn」改为「signOut vs `auth.${op==='signUp'?'signUp':'signInWithPassword'}({email,password})`」;只解构 `{ error }`;label = operation | $currentUser 靠 onAuthStateChange 自动同步(决 e 继承),无 resultTarget |
| d | **runtime probe(经验 K)已做**:`bun -e` 实证 `signUp({email,password})` 返 `{ data:{user,session}, error }` —— **与 `signInWithPassword` 同形**;signUp 同 signIn 只用 `{ error }` | probe 输出:`signUp keys: [data, error]`,`data={user,session}` |
| e | **`$currentUser` email 确认门控(Q3/Q2 设计阶段堵)**:email confirmation 开(Supabase 项目默认)时 `signUp` 返回 `session:null`(无 error)→ `onAuthStateChange` 不发 SIGNED_IN → `$currentUser.signedIn` 停 false 直到用户点确认邮件;confirmation 关时 signUp 即时登录(同 signIn)。**运行时行为不改**($currentUser 已忠实跟踪 session);**通过 signUp 表单下专用 note 把门控浮现给搭建者**(用户 2026-05-29 AskUserQuestion ACK 推荐项)| §2.v2 教训:Q2 要核「结果/状态在哪浮现」,且**设计阶段就堵**(§2.v2 该洞 Tauri 才发现 → 本期前移) |
| f | **IR collect**:`resolveSupabaseAuth` 把 signIn 分支泛化吃 signUp(同样 parse email/password);硬编码 `operation:'signIn'` 改为 `operation: action.operation`;warning 码不变(`-missing-credentials`/`-invalid-credential`,message 文案从 "signIn" 泛化)| 同构,零新诊断码 |
| g | **tool 校验**:`validateSupabaseAuthAction` 接受 `'signUp'`;email/password 校验对 signIn + signUp 都跑(signOut 提前 return);`buildActionFromValidated` cast 加 `'signUp'`;坏 expr reject / 缺失 IR warn 不变(决 g 继承)| 与 signIn 同档 |
| h | **0 Kiwi / 0 新 npm**:operation 只是 events pluginData JSON 里多一个字面量;supabase-js 已 pinned 且 `signUp` 早在 SDK | 沿全部先例;step 1 往返测试钉 |

**8 次级默认**:

1. signUp UI = signIn 表单同构(operation select 加 signUp option;email/password expr 对 signIn|signUp 显;signOut 隐藏)。
2. `makeAction('supabaseAuth')` 默认仍 `{ operation:'signIn', emailExpr:'', passwordExpr:'' }`(signUp 经 select opt-in)。
3. **不暴露 resultTarget**(决 e 继承)。
4. errorTarget 对 signUp 生效(signUp 会错:弱密码 / 邮箱已注册)。
5. i18n:复用 `lowcodeActionAuthEmail`/`lowcodeActionAuthPassword`(+Placeholder);**净增 1 key**(`lowcodeActionAuthSignUpNote` 确认门控提示)× 8 文件。
6. test-id:复用 `lowcode-action-auth-operation`/`-email`/`-password`;operation select 只多一个 `<option>`;新增 `lowcode-action-auth-signup-note`。
7. `SUPABASE_AUTH_OPS` 顺序 `['signIn','signUp','signOut']`(两个带凭证的相邻)。
8. **0 新 npm import**;emit 产物零新依赖。

**经验 J 三问题反向核**(强制;Q2 核「结果/状态在哪浮现」):

| ACK 项 | Q1 技术链 | Q2 UI/状态浮现 | Q3 心智模型 |
|---|---|---|---|
| signUp 绑 email/password INPUT → 点击 → 注册 | ✅ 复用 signIn 链(无 union widening)| ✅ operation select + email/password(复用)| ✅ "注册"匹配 Bubble |
| **signUp 后 `$currentUser` 行为(确认开/关)** | ✅ onAuthStateChange 已忠实跟踪 session | ⚠️ **确认开 → signedIn 停 false,易误判 bug → 决 e signUp note 设计阶段堵** | ⚠️ **搭建者预期 signUp 即时登录 → 心智错位 → 同 note 堵** |
| signUp 错(弱密码/重复邮箱)→ errorTarget 捕获 | ✅ 决 g 继承 | ✅ errorTarget select | ✅ |
| 坏 emailExpr → tool reject | ✅ 决 g | n/a | ✅ |
| 零回归:signIn/signOut + 6 既有 kind + .fig 往返 | ✅ | ✅ | ✅ |

→ 唯一真岔口是决 e/Q2/Q3 的确认门控浮现(AskUserQuestion 锁 signUp note,**设计阶段前移**,避免重演 §2.v2 的 Tauri-才发现);其余全是 signIn 同构镜像。

### 2.v3.3 公开 API / Schema 改动

```ts
// packages/core/src/scene-graph/types.ts
export interface SupabaseAuthAction {
  id: string
  kind: 'supabaseAuth'
  operation: 'signIn' | 'signOut' | 'signUp'   // +signUp(决 a/b);ActionDef 仍 7 kind
  emailExpr?: string      // signIn + signUp
  passwordExpr?: string   // signIn + signUp
  errorTarget?: string
}
```

- 🔁 **schema** `types.ts`:`operation` union +`'signUp'`(无新 interface,无 ActionDef 改动)
- 🔁 **IR types** `ir/types.ts`:`IRSupabaseAuthHandler.operation` +`'signUp'`
- 🔁 **IR collect** `bindings.ts`:`resolveSupabaseAuth` signIn 分支泛化(`operation: action.operation`)
- 🔁 **emit** `emit/event.ts`:`emitSupabaseAuth` call 三元加 signUp→`auth.signUp(...)`,label=operation
- 🔁 **tool** `modify/lowcode.ts`:`validateSupabaseAuthAction` 接受 signUp、email/password 校验对 signIn+signUp 跑;`buildActionFromValidated` cast +`'signUp'`
- 🔁 **EventsPanel.vue**:`SUPABASE_AUTH_OPS` +`'signUp'`;form v-if 吃 signUp;cast +`'signUp'`;signUp note
- ➕ **i18n** 1 新 key `lowcodeActionAuthSignUpNote` × 8 文件
- **0** Kiwi / node-defaults / 新 npm / 新 ActionDef kind 改动

### 2.v3.4 内部实现拆解

#### emit `emitSupabaseAuth`(`emit/event.ts`)— call 三元泛化

```ts
const call =
  h.operation === 'signOut'
    ? 'getSupabaseClient().auth.signOut()'
    : `getSupabaseClient().auth.${h.operation === 'signUp' ? 'signUp' : 'signInWithPassword'}({ ` +
      `email: ${emitExpression(h.emailAst as ExprAst)}, password: ${emitExpression(h.passwordAst as ExprAst)} })`
const label = h.operation   // signIn / signOut / signUp(原来三元写死,现直接用 operation)
```

(signUp 同 signIn 只解构 `{ error }`:`$currentUser` 靠 `onAuthStateChange` 自动同步,门控由 session 真值驱动。决 c/e。)

#### IR collect `resolveSupabaseAuth`(`bindings.ts`)— signIn 分支泛化

signOut 提前 return 不变;其余(signIn + signUp)统一 parse email/password,返回 `operation: action.operation`(不再写死 `'signIn'`)。warning message 从 "supabaseAuth signIn …" 泛化为 "supabaseAuth ${operation} …"。

#### tool `modify/lowcode.ts`

`validateSupabaseAuthAction`:operation 校验放宽到 signIn/signOut/signUp;`if (operation === 'signOut') return ok` 不变 → email/password 校验对 signIn + signUp 都跑。`buildActionFromValidated` cast `'signIn' | 'signOut'` → `'signIn' | 'signOut' | 'signUp'`。

#### EventsPanel.vue

`SUPABASE_AUTH_OPS = ['signIn','signUp','signOut']`;email/password form 的 `v-if="...operation === 'signIn'"` → `(operation === 'signIn' || operation === 'signUp')`;`supabaseAuthErrors` 的 `if (operation === 'signOut') return e` 已天然覆盖 signUp(无需改);两处 cast 加 `'signUp'`;新增 `v-if="operation === 'signUp'"` 的确认门控 note(`lowcode-action-auth-signup-note`)。

### 2.v3.5 成功标准 + Tauri ACK

1. `bun run check` 全绿;`bun test ./tests/engine/compiler/` + `tools/lowcode/` + kiwi 往返全绿;新增 emit/IR/tool/cross-walker 测试
2. **Tauri 实测(用户主导)~6 项 ACK**:

| # | ACK |
|---|---|
| 1 | EventsPanel 选 Supabase auth → operation=signUp,email/password 绑 INPUT docState → 点击 → 真注册 |
| 2 | 确认**关**的项目:signUp 即时登录,`$currentUser.signedIn` 变 true(同 signIn)|
| 3 | 确认**开**的项目(默认):signUp 无 error 但 `$currentUser.signedIn` 停 false → **signUp note 已提示「需确认邮件」**,不误判 bug |
| 4 | signUp 错(弱密码 / 邮箱已注册)→ errorTarget 捕获 |
| 5 | 坏 emailExpr → tool/IR 诊断 |
| 6 | 零回归:signIn/signOut + 6 既有 kind + .fig 往返 |

3. 不破坏 §2/§3/§3.x/§3.v2-v8/§2.v2 锁定

### 2.v3.6 工作分解(建议 1 名工程师,~1 天)

| Step | 任务 | commit |
|---|---|---|
| 0 | §2.v3 设计 doc + commit | `docs(lowcode): §2.v3 mini-scope detailed design (Supabase signUp action)` |
| 1 | `operation` union +signUp(schema + IR types)+ Kiwi 往返测试 | `feat(lowcode): step 1 — signUp operation union + persistence (§2.v3)` |
| 2 | IR collect 泛化 + emit signUp + compiler/IR 测试 | `feat(lowcode): step 2 — signUp IR collect + emit (§2.v3)` |
| 3 | tool 校验(signUp + email/password)+ tools 测试 | `feat(lowcode): step 3 — tool-boundary signUp validation (§2.v3)` |
| 4 | EventsPanel signUp form + 确认门控 note + i18n × 8 + Tauri ACK + §2.v3.8 + close | `docs(lowcode): §2.v3 Tauri verification + close` |

### 2.v3.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| signUp 确认门控被误判 bug | 中 | 决 e signUp note **设计阶段前移**(§2.v2 教训);Tauri ACK #3 验 |
| `operation` union widening 漏 callsite(经验 A/G)| 中 | grep `operation ===`/`'signIn' \| 'signOut'` cast 全 callsite;emit/tool exhaustive;cross-walker 测试 |
| 漏改某处 signIn/signOut cast | 低 | tsgo + grep 钉;EventsPanel 两处 cast |
| Kiwi 往返漏 signUp operation | 低 | events 走 JSON pluginData(决 h),step 1 往返测试钉 |
| supabase-js signUp 返回 shape 记错 | 低 | 已 `bun -e` probe(决 d):`{data:{user,session},error}` |

### 2.v3.8 Post-mortem

**§2.v3 closed 2026-05-30**(Tauri ACK ✅ after 1 hotfix;signUp 功能本身首过零 bug,但 Tauri 照出 **1 个 §2.v2 遗留的 import-gate 洞**,mid-ACK 修掉)。补完认证三件套(登录/登出/**注册**),做法是复用 `supabaseAuth` kind 扩 operation(决 a),**不动 ActionDef 7-kind 锁**。

#### Commit 链(设计 + 4 step + 1 mid-ACK hotfix)

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `ce750e0` | 复用 operation(决 a)+ email 确认门控 note(决 e),两 AskUserQuestion 锁;signUp 返回 `{data:{user,session},error}` `bun -e` probed(决 d)|
| 1 | `203212a` | `operation` union +`'signUp'`(schema + IR types)+ 0-Kiwi 往返测试 |
| 2 | `bc217cf` | IR collect signIn 分支泛化吃 signUp(`operation: action.operation`)+ emit `auth.signUp(...)`(method 选择)+ emit/IR 测试 |
| 3 | `8dac295` | tool validate/build +signUp + 描述段 + auth-action.test.ts signUp 用例 |
| 4 | `837c004` | EventsPanel signUp form(email/password 表单 signIn∨signUp 显)+ 确认门控 note + i18n×8 |
| **hotfix** | `2312cca` | **`pageUsesSupabase` import-gate 加 `supabaseAuth`** + 抽共享 `treeHasHandler` walker + auth-only 页回归测试 |
| close | _this commit_ | §2.v3.8 回填 + memory + close |

#### Tauri ACK 结果(用户主导 2026-05-30）

signUp 按钮初次点击 **无 network 无报错** → 逐层排查(确认门控 → 空 expr → 最终 console `ReferenceError: getSupabaseClient is not defined`)定位为 import-gate 洞;hotfix 后**重点 ACK #1 通过**(signUp 真发 `/auth/v1/signup` 请求)。hotfix 同时修好 signIn/signOut 在 auth-only 页上的同一问题。

#### Surprise 列表(1 个 §2.v2 遗留 import-gate 洞,mid-ACK hotfix)

1. **auth-only 页缺 `getSupabaseClient` import**(commit `2312cca` 修)—— `pageUsesSupabase`(决定页面是否 emit `import { getSupabaseClient }` 的闸)自 §2 起只匹配 `supabaseQuery` / `supabaseMutation`,**从未含 `supabaseAuth`**。§2.v2 加 auth handler(emit `getSupabaseClient().auth.*` 内联)时未同步扩这道闸 → **只用 auth 的页面**(signIn/signOut/signUp,无 query/mutation)emit 出 `getSupabaseClient()` 却不 import → 运行时 `ReferenceError`。**§2.v2 ACK 时 signIn「能用」是因为测试页恰好还挂了一个 supabaseQuery,把闸撑成 true 掩盖了洞**;signUp 的独立注册页只有 auth,首次把它照出来。
   - 讽刺点:`ir-walk.ts` 该函数注释**早就警告过**这类「emit 测试只验调用串、不验模块解析 → ReferenceError」的坑(navigate import 有过同款),而 §2.v2 的 auth emit 测试正好又踩了一遍(只断言 `getSupabaseClient().auth.signUp(...)` 字符串)。

#### 经验印证 / 演化

- **H(Tauri 找 wiring 洞)再印证 + 升级**:本期 surprise 不是 §2.v2 那种 Q2 可发现性洞(additive 提示),而是一个**真运行时 ReferenceError**——但同样是「全 step 测试绿 + Tauri 才暴露」。关键教训:**emit 层测试断言调用串 ≠ 断言模块可解析**;auth-only 页这种「最小组合」是 import-gate 的边界用例,query/mutation 同页会掩盖。**新增防线**:任何「emit 出某 runtime 符号」的 handler,回归必须有一个**只含该 handler、不含其它同 runtime handler 的页面**断言 import 在场(本期 `auth-only page` 测试)。
- **A + dedup**:hotfix 把 `nodeHasNavigate` / `nodeUsesSupabase` 两个同构递归 walker 抽成 `treeHasHandler(node, pred)` —— union-widening 类改动顺手 dedup,jscpd 钉零 clone(本期改 supabase 闸谓词为多行恰好撞出与 navigate walker 的 clone,正好触发抽取)。
- **决 a(复用 operation 而非第 8 kind)回报**:signUp 与 signIn 完全同构 → 全程零 ActionDef union widening,emit/collect/tool 仅 operation 分支微调;唯一 bug 还是出在**跨 walker 的 import-gate**(handler-kind 层面,与 operation 无关),印证「同构复用把改动面压到最小,残留风险集中在跨 §X 的 wiring」(经验 E/H)。
- **决 e(确认门控 note)有效**:虽然本次 surprise 是 import bug 不是门控,但排查过程中「确认门控」作为首个假设被快速排除(network 无请求 → 不是门控,门控会有请求)——note 把这层语义前置说清,缩短了排查路径。

---

---

## §2.v4 Supabase auth — resetPassword + updatePassword(设计 2026-05-30)

§2.v3 闭认证三件套(signIn/signOut/signUp)。**用户挑「忘记密码」方向 B** = 补 `resetPassword`(发重置邮件)+ `updatePassword`(设新密码)。两者仍复用 `supabaseAuth` kind 的 operation union(决 a),`ActionDef` 仍 7 kind。与 signUp 的纯镜像不同,本期引入 **per-operation 字段门控**(决 b)。

### 2.v4.1 现状与问题

1. `SupabaseAuthAction.operation` 现为 `signIn|signOut|signUp`(§2.v3),无密码找回路径。Supabase 的密码找回是**两步**:`resetPasswordForEmail(email, {redirectTo})` 发邮件 → 用户点链接落地(`onAuthStateChange` 发 `PASSWORD_RECOVERY`)→ `updateUser({password})` 设新密码。
2. emit 侧 `supabase.auth.resetPasswordForEmail` / `updateUser` 早在 SDK,无代码路径触达。
3. `updateUser({password})` 不限恢复会话 —— **任何已登录态都能改密码**,所以「已登录用户改密码」与「忘记密码后设新密码」共用一个 operation(`updatePassword`)。

### 2.v4.2 关键决定

**8 主决定**(决 f 经 AskUserQuestion 锁):

| # | 决定 | 理由 |
|---|---|---|
| a | **operation union 扩到 5:`+'resetPassword'\|'updatePassword'`**,复用 `supabaseAuth` kind,**0 新 ActionDef kind / 0 新 schema 字段**(emailExpr/passwordExpr 复用)| 沿 §2.v3 决 a;`ActionDef` 仍 7 kind,§2.v2 锁不动 |
| b | **per-operation 字段门控**(本期新增,非 signUp 纯镜像):signOut=无;**resetPassword=email only**;**updatePassword=password only**;signIn/signUp=email+password。贯穿 collect / tool / UI | resetPasswordForEmail 只收 email,updateUser 只收 password |
| c | **emit 内联**(同 §2.v2 决 c):resetPassword → `getSupabaseClient().auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })`;updatePassword → `getSupabaseClient().auth.updateUser({ password })`。两者只解构 `{ error }` | 沿内联非 hook 先例 |
| d | **runtime probe(经验 K)已做**:`resetPasswordForEmail(email,{redirectTo})` 返 `{data:{},error}`;`updateUser({password})` 返 `{data:{user},error}` —— 都 `{data,error}`,同 signIn 只用 `{error}` | `bun -e` 实证 |
| e | **无 resultTarget**(继承决 e):resetPassword 不改 session;updatePassword 触发 `USER_UPDATED` 但仍登录态,`$currentUser` 经 onAuthStateChange 自动同步。errorTarget 对两者生效(reset:限流/坏邮箱;update:弱密码/无会话)| 避免双写 |
| f | **redirectTo = `window.location.origin`**(用户 2026-05-30 AskUserQuestion ACK 推荐项):重置邮件链接指回「应用当前被服务的地址」——preview 是 localhost:port,生产是部署域名,零硬编码、零新字段。落地后 onAuthStateChange 发 PASSWORD_RECOVERY | 不需要「应用部署 URL」概念即可双环境工作;**注意**:origin 须在 Supabase Dashboard Redirect URLs 白名单(localhost 默认允许,生产域名手加)|
| g | **tool 校验**:`validateSupabaseAuthAction` 接受 reset/update;沿既有「present-then-parse」—— 哪个 expr 在场就校验哪个(坏→reject),**缺失留 IR warn**(决 g 继承,tool 从不强制 required)| 与 signIn/signUp 同档 |
| h | **验证边界(经验 K boundary)**:updatePassword 在 preview **可端到端验**(登录→改密→登出→新密码登录,`updateUser` 不限恢复会话);**resetPassword 的邮件→链接→落地不可在 preview 验**(无真邮箱/真重定向落地),preview 只验请求发出(network `/auth/v1/recover`),端到端靠真部署 | 同 §3.v8「探不了的别假装能探」 |

**8 次级默认**:
1. UI:email / password 输入**拆成独立 v-if**(不再合并在一个 template)——email 显示于 signIn∨signUp∨resetPassword;password 显示于 signIn∨signUp∨updatePassword。
2. `SUPABASE_AUTH_OPS` 顺序 `['signIn','signUp','signOut','resetPassword','updatePassword']`。
3. `makeAction` 默认仍 signIn。
4. i18n:复用 `lowcodeActionAuthEmail`/`lowcodeActionAuthPassword`(+Placeholder);**净增 2 key**(`lowcodeActionAuthResetNote` 邮件往返/部署验提示 + `lowcodeActionAuthUpdateNote` 「改当前登录用户密码」提示)× 8 文件。
5. test-id:复用 `lowcode-action-auth-operation`/`-email`/`-password`;新增 `lowcode-action-auth-reset-note`/`-update-note`。
6. updatePassword 的 password 框语义是「新密码」,placeholder 复用既有(`e.g. passwordInput`)。
7. errorTarget 走既有 UI(对全部 5 op 生效)。
8. **0 Kiwi / 0 新 npm / 0 新 ActionDef kind**。

**经验 J 三问题反向核**:

| ACK 项 | Q1 技术链 | Q2 UI/状态浮现 | Q3 心智模型 |
|---|---|---|---|
| updatePassword:登录→改密→登出→新密码登录 | ✅ 决 b/c per-op | ✅ password-only 表单 | ✅ 「改密码」匹配心智;preview 可验 |
| resetPassword:点击→发 `/auth/v1/recover` | ⚠️ redirectTo=origin(决 f)| ✅ email-only 表单 + **reset note(邮件往返/部署验)** | ⚠️ **用户可能以为 preview 点完就能改密 → reset note 说明「邮件链接落地才进下一步、preview 验不了往返」(决 h/Q2 设计阶段堵)** |
| resetPassword 后落地 PASSWORD_RECOVERY → updatePassword | ⚠️ 端到端依赖真邮件+白名单 | n/a(部署验)| ✅ note 已铺垫两步流 |
| 坏 emailExpr(reset)/ 坏 passwordExpr(update)→ tool reject | ✅ 决 g | n/a | ✅ |
| 零回归:signIn/signOut/signUp + 6 既有 kind + .fig 往返 | ✅ | ✅ | ✅ |

→ Q3 风险(reset 的「preview 验不了邮件往返」)用 reset note **设计阶段堵**(沿 §2.v3 决 e 前移先例);updatePassword 全 preview 可验。

### 2.v4.3 公开 API / Schema 改动

```ts
// packages/core/src/scene-graph/types.ts — operation union 扩到 5(无新字段)
operation: 'signIn' | 'signOut' | 'signUp' | 'resetPassword' | 'updatePassword'
```

- 🔁 schema `types.ts` + IR types `ir/types.ts`:`operation` union +2
- 🔁 IR collect `bindings.ts`:`resolveSupabaseAuth` per-op 门控(needsEmail / needsPassword)
- 🔁 emit `emit/event.ts`:`emitSupabaseAuth` 加 resetPassword / updatePassword 分支
- 🔁 tool `modify/lowcode.ts`:接受 2 新 op + cast
- 🔁 EventsPanel.vue:`SUPABASE_AUTH_OPS` +2;email/password 输入拆独立 v-if;reset/update note;`supabaseAuthErrors` per-op
- ➕ i18n 2 新 key × 8
- **0** Kiwi / 新 npm / 新 ActionDef kind

### 2.v4.4 内部实现拆解

#### IR collect `resolveSupabaseAuth`(per-op 门控)

```ts
if (action.operation === 'signOut') return { ...signOut, references: [], errorTarget }
const needsEmail = op === 'signIn' || op === 'signUp' || op === 'resetPassword'
const needsPassword = op === 'signIn' || op === 'signUp' || op === 'updatePassword'
let emailAst, passwordAst, refs = []
if (needsEmail) { const e = resolveAuthCredential(...,'email',...); if (e===null) return null; emailAst=e.ast; refs.push(...e.references) }
if (needsPassword) { const p = resolveAuthCredential(...,'password',...); if (p===null) return null; passwordAst=p.ast; refs.push(...p.references) }
return { kind:'supabaseAuth', operation: op, emailAst, passwordAst, references: refs, errorTarget }
```

#### emit `emitSupabaseAuth`(call 分支)

```ts
const call =
  op === 'signOut'        ? 'getSupabaseClient().auth.signOut()' :
  op === 'resetPassword'  ? `getSupabaseClient().auth.resetPasswordForEmail(${email}, { redirectTo: window.location.origin })` :
  op === 'updatePassword' ? `getSupabaseClient().auth.updateUser({ password: ${password} })` :
  op === 'signUp'         ? `getSupabaseClient().auth.signUp({ email: ${email}, password: ${password} })` :
                            `getSupabaseClient().auth.signInWithPassword({ email: ${email}, password: ${password} })`
const label = op
```
（避免 oxlint no-nested-ternary:用 if-链或 `switch` 而非嵌套 `?:`,沿 §2.v3 step 2 教训。）

#### EventsPanel form

email 输入 `v-if op∈{signIn,signUp,resetPassword}`;password 输入 `v-if op∈{signIn,signUp,updatePassword}`;reset note `v-if op==='resetPassword'`;update note `v-if op==='updatePassword'`。`supabaseAuthErrors`:needsEmail 才校 email,needsPassword 才校 password。

### 2.v4.5 成功标准 + Tauri ACK

1. `bun run check` 全绿;compiler + tools + kiwi 全绿;新增 emit/IR/tool/cross-walker 测试
2. **Tauri 实测(用户主导)~6 项 ACK**:

| # | ACK |
|---|---|
| 1 | updatePassword:已登录 → 改密动作(password 绑 INPUT)→ 登出 → 新密码能登录(端到端,preview 可验)|
| 2 | resetPassword:点击 → network 发 `/auth/v1/recover`(请求发出;邮件往返部署验)|
| 3 | reset note 显示「邮件链接落地才进下一步、preview 验不了往返」;update note 显示「改当前登录用户密码」|
| 4 | per-op 表单:resetPassword 只显 email、updatePassword 只显 password、signOut 都不显 |
| 5 | 坏 emailExpr(reset)/ 坏 passwordExpr(update)→ tool/IR 诊断 |
| 6 | 零回归:signIn/signOut/signUp + 6 既有 kind + .fig 往返;auth-only 页仍 import getSupabaseClient（§2.v3 hotfix 不回退)|

### 2.v4.6 工作分解(~1-1.5 day)

| Step | 任务 | commit |
|---|---|---|
| 0 | §2.v4 设计 doc | `docs(lowcode): §2.v4 mini-scope detailed design (Supabase resetPassword + updatePassword)` |
| 1 | operation union +2(schema+IR)+ Kiwi 往返 | `feat(lowcode): step 1 — reset/updatePassword operation union + persistence (§2.v4)` |
| 2 | IR collect per-op 门控 + emit + 测试 | `feat(lowcode): step 2 — reset/updatePassword IR collect + emit (§2.v4)` |
| 3 | tool 校验 + 测试 | `feat(lowcode): step 3 — tool-boundary reset/updatePassword validation (§2.v4)` |
| 4 | EventsPanel per-op form + 2 note + i18n×8 + Tauri ACK + §2.v4.8 + close | `docs(lowcode): §2.v4 Tauri verification + close` |

### 2.v4.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| operation union widening 漏 callsite(经验 A/G)| 中 | grep `operation ===` 全 callsite + emit if-链 + cross-walker；§2.v3 已建 auth-only import 回归 |
| per-op 门控分支错(reset 误要 password 等)| 中 | collect/tool/UI 三处对齐 needsEmail/needsPassword;单测覆盖 4 op × 字段 |
| resetPassword preview 验不了邮件往返被误判 bug | 中 | 决 h + reset note 设计阶段堵;ACK #2 只验请求发出 |
| redirectTo origin 不在 Supabase 白名单 | 低(部署期配置)| reset note 提示;localhost 默认允许 |
| nested ternary oxlint(§2.v3 踩过)| 低 | emit 用 if-链/switch 非嵌套 `?:` |

### 2.v4.8 Post-mortem

**§2.v4 closed 2026-05-30**(Tauri ACK ✅,**零 hotfix、零 surprise** —— Phase 3 又一个一次过)。补完密码找回:`resetPassword`(发重置邮件)+ `updatePassword`(设新密码),仍复用 `supabaseAuth` operation union(5 op,`ActionDef` 仍 7 kind),引入 per-operation 字段门控。

#### Commit 链(设计 + 4 step,无 hotfix)

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `4d1ac15` | redirectTo=`window.location.origin`(决 f,AskUserQuestion 锁)+ 两返回 shape `bun -e` probe(决 d)|
| 1 | `86c2830` | operation union +2(schema+IR)+ Kiwi 往返 + `resolveAuthCredential` 参数 union-widening sweep(经验 A/G 保 build 绿)|
| 2 | `d7cb483` | IR collect per-op 门控(needsEmail/needsPassword)+ emit `emitAuthCall` if-链(无嵌套三元,§2.v3 教训)|
| 3 | `2b05bd4` | tool `SUPABASE_AUTH_OPS` set + cast + 描述 per-op + reset 邮件往返 caveat |
| 4 | `9b1bb26` | EventsPanel email/password 独立 per-op v-if(`authNeedsEmail`/`authNeedsPassword` 镜像 collect)+ reset/update note + i18n×8 |
| close | _this commit_ | §2.v4.8 + memory + close |

#### Tauri ACK 结果(用户主导 2026-05-30)

- **#1 updatePassword 端到端 ✅(preview 闭环)**:登录 → updatePassword → 登出 → 新密码登录。
- **#2 resetPassword ✅**:点击发出 `/auth/v1/recover`。
- **#3-#6**:per-op 表单 / note / 诊断 / 零回归随上述一并通过。
- **邮件往返(链接→落地→改密)按决 h 延后**到真实部署期验(用户:「邮件限制,等后面完善其他功能再测」)—— **不是失败,是设计已承认的验证边界**(经验 K boundary:探不了的不假装能探,reset note 已把这层说清)。

#### 为什么零 surprise

- **决 h(验证边界)+ reset note 设计阶段前移**:把「resetPassword 邮件往返 preview 验不了」这个最可能被误判成 bug 的点,在设计阶段就经 Q3 反向核识别、用 reset note 铺给用户 → Tauri 实测时用户直接知道这是预期、主动延后,而非当 bug 报。**对照 §2.v3**:signUp 的 import-gate 洞是「测试绿但运行时炸」的真 bug(Tauri 才暴露);§2.v4 没有这类洞,因为唯一的运行时依赖(redirectTo / 邮件)已在设计阶段标成「部署验」,且 emit 路径与 signUp 同构、§2.v3 的 import-gate 已修。
- **决 a(复用 operation)+ per-op 门控对齐三处**:collect 的 needsEmail/needsPassword、tool 的 present-then-parse、UI 的 authNeedsEmail/authNeedsPassword —— 三处同一套门控规则,设计阶段静读对齐(经验 E),Tauri #4(per-op 表单)一次过,零字段错配。
- **updatePassword 选了「不限恢复会话」的语义**(决 b/h):`updateUser({password})` 任何登录态可用 → 让「改密码」在 preview 完全可闭环验,不必依赖邮件 —— 这是方向 B 当初被选中的原因(用户要 preview 能验的那半),兑现。

#### 经验印证

- **K boundary 再次生效**:reset 邮件往返 = 「无真邮箱/真重定向落地不可探」→ 走确定性 emit(redirectTo=origin)+ note + 部署验,不假装 preview 能端到端。同 §3.v8(PostgREST RLS 不可探)同类。
- **J(Q3 设计阶段堵)**:reset 的 Q3 心智错位(「点完就该能改密」)在 §2.v4.2 反向核识别 → reset note → 零 Tauri surprise。延续 §2.v3 决 e 把 Q2/Q3 洞前移的做法。
- **A/G + dedup**:operation union 第三次 widening(signUp→reset/update),`resolveAuthCredential` 参数类型 step 1 即扫平;emit 改 if-链(`emitAuthCall` 抽出)规避 §2.v3 踩过的 nested-ternary oxlint。0 漏 case、0 clone。

#### 认证能力链现状(§2 → §2.v4)

signIn / signOut / signUp / resetPassword / updatePassword 五动作齐备(1 个 `supabaseAuth` ActionDef kind,5 operation)。剩余 auth 缺口:OAuth / magic link(无密码登录)/ email 确认重发 —— 体量与部署耦合更深,留后续按需。

---

---

## 4–13. 候选 §X 详细设计(待用户挑定后扩写)

> 用户挑定某条 §X → 回本 doc 把对应小节改写成「详细设计 + 锁定决定」格式(参考 Phase 2 §2 / §3 / §4 / §6 / §7 / §8 / §9 任一已收尾节 + 本期 §2 / §3 结构:§X.1 现状与问题、§X.2 关键决定表、§X.3 公开 API / Schema 改动、§X.4 内部实现拆解、§X.5 成功标准、§X.6 工作分解、§X.7 风险、§X.8 Post-mortem)→ 对话锁主决定 → 用户 ACK 次级默认 → 分 step commit + Tauri 实测。

§4 多人协作 / §5 部署 / §6 Kiwi schema / §7 响应式 / §8 Symbol / §9 i18n runtime / §10 工作流 / §11 §3.v2 fetch / §12 §4.v2 表达式 / §13 SWITCH CSS —— 简述见 §1.1 表。
