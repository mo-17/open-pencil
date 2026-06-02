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
4. ~~expression grammar 加 `$event` / `$value` token~~ **→ SHELVED 2026-05-30(用户 ACK)**。勘察坐实(经验 C):① `$event`/`$value` 早已 parse(`IDENT_RE` 含 `$`,同 `$prev`/`$currentUser`)→ 零文法改动、「§4.2 FROZEN」非难点;② **但无活用例** —— onChange/onFocus/onBlur 无 authoring 入口(EventsPanel 仅 onClick/onSubmit),controlled 输入的 user onChange 被 IR 主动丢弃(`input-controlled-onchange-conflict`「binding.value owns onChange」);③ **原动机(onChange 读 `e.target.value`)已被 §3.x/§3.v4 的 controlled `bindings.value`→docState 通道取代**(表单值走 docState,action 引用 docState 名)。单做 token = 造无消费者的语法。**真要做须先重框为「可编 onChange/Focus/Blur handler」(扩 EventsPanel + handler emit 带 event 参),那是更大的独立 scope,非本 token follow-up。**
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

## §4 协作 — lowcode-aware collaboration(设计 2026-05-30)

转产品级方向。基座 OpenPencil 的协作链已完整:Trystero MQTT(WebRTC P2P 无 relay)+ Yjs CRDT + y-indexeddb 持久化 + graph↔Yjs 双向同步 + awareness(远端光标/选区/follow/peer 颜色),代码在 `src/app/collab/`。但它**对 lowcode 不感知**。§4 分多刀打磨;**§4.1 先修最高优先的 correctness 缺口**(lowcode 字段在协作同步中静默损坏),后续刀均 additive。

#### §4 候选 slice 池(2026-05-30 起,§4.1 已闭)

网络架构勘察结论:协作是**公网**实现,非局域网专用。两层 —— **信令/发现**走公共 MQTT broker(`trystero/mqtt`,必须上公网);**数据**走 WebRTC P2P DataChannel(STUN 打 NAT 直连,`rtcConfig` 配了 Google/Cloudflare STUN + openrelay 免费 TURN 兜底)。同 LAN 优选局域网直连;纯内网/离线不可用(信令+STUN/TURN 都是公网)。"no relay" 准确含义 = 默认 P2P 不经自建中央服务器,但严格 NAT 下 fall back 到公共 TURN。

| # | 候选 slice | 来源 | 体量估 | 优先级理由 |
|---|---|---|---|---|
| ~~4.1~~ | ~~lowcode 字段 Yjs 往返 correctness~~ | 勘察发现 | ~0.5 day | ✅ 闭(2026-05-30)|
| 4.2 | **房间鉴权 / 私有信令** | 网络勘察 #3 | 中 | **安全缺口最高优先**:`appId` 全局共享 + roomId 仅 8 位随机 → 任何知 roomId 者可进同房间;lowcode 应用可能带 Supabase config / 业务数据。需房间口令/鉴权层或私有信令命名空间 |
| 4.3 | **自建信令 + TURN** | 网络勘察 #1 | 中-大 | 生产可靠性/隐私/限流:当前依赖公共 MQTT broker + openrelay 免费 TURN(社区免费服务,无 SLA)。认真产品(尤其 §5 部署)需自建或托管;与 §5 部署管线强耦合 |
| 4.4 | lowcode-aware presence | §4 设计 | 中 | 远端 peer 在编哪个 binding/event/docState 的可视化(扩 awareness payload,现仅 cursor+selection)|
| 4.5 | docState 协作冲突语义 | §4 设计 | 中 | 两人同时改同一 docState 默认值 / 同一 action 的合并策略(Yjs CRDT 自动合并 node 字段,但 lowcode 语义层冲突未审视)|
| 4.6 | preview 协作 | §4 设计 | 中-大 | 多人共享同一 lowcode preview 会话(运行态而非编辑态协作)|

注:base collab 还有 ~11 个非 lowcode object 字段同样在 Yjs 往返成字符串(§4.1.8 记录),属基座/上游议题,非 §4 lowcode slice。

### 4.6 preview 协作(运行态共享会话,设计 2026-05-30)

#### 4.6.1 现状与架构勘察(静读真源,经验 E)

§4.1–§4.5 协作的全是**编辑态**(scene graph / lowcode 定义)。§4.6 是**运行态**:多人共享同一个正在跑的 lowcode preview 会话(候选池原话「运行态而非编辑态」)。

**preview 架构(实读 `PreviewPane.vue` + `preview-bridge.ts` + `lowcode-state.ts`):**
- preview = **每端各自的 `<iframe>`**,加载**本端 sidecar dev-server URL**(`http://localhost:PORT/`),iframe 里跑编译出的 React app。两端**不共享** iframe(各自 localhost)。
- 编辑器 ↔ iframe 走 **postMessage 桥**(`preview-bridge.ts`,编译期注入 iframe),现有两类消息:`select`(覆盖高亮 / Alt-click 回程)+ `navigate`(页面同步,双向,`pushState` monkeypatch + `suppressOutbound` 破 echo)。源标记 `op-lowcode-editor`(出)/ `op-lowcode-preview`(入)。
- **运行态 docState = iframe 里的 zustand vanilla store**(`_lowcode_state.ts`:`useDocState`/`setDocState`/`getDocStateSnapshot`,`createStore`)。`store.subscribe`/`store.setState` 是干净的 observe/apply 钩——**运行态同步技术上可行**。
- 编辑态文档已由 §4.1 同步 → 两端编译出的 app **docState schema 相同** → 共享运行态值是自洽的。

**缺口:** 运行态(docState 值、当前路由、表单输入)只活在各自 iframe 的内存里,协作时完全不共享。A 在 preview 里填表单/改运行 docState/导航,B 的 preview 毫无感知。

#### 4.6.2 关键决定 —— **决定 a = 范围,是真岔口 → AskUserQuestion 锁**

跨 **iframe runtime + 编译 emit + 新 collab 传输** 三层,体量与验证性差异巨大,且 emit 改动碰 React adapter(fork 可合并性,经验新-4)、iframe runtime 难单端验(经验 K boundary)。三选:

| 方案 | 做法 | 体量 | 验证性 | 备注 |
|---|---|---|---|---|
| **A 预览在场/跟随** | 扩 §4.4 awareness 加「peer 当前 preview 路由」,preview header / roster 显示 + 「在预览里跟随」(本端 iframe 跟着导航)| 小 | 高(纯编辑器侧 + awareness,单端可验) | **但**:preview 路由 ↔ `currentPageId` 已双向同步,与 §4.4 page-presence **高度重叠**,价值偏薄 |
| **B 运行态 docState 同步** ⭐推荐 | 共享 iframe 的 zustand docState 值:桥加 `docState` 消息(`store.subscribe`→出站 / 入站→`store.setState`+suppress)+ 编辑器经新 collab 通道中继到对端 iframe | 中-大 | 中(中继/传输纯逻辑 + 桥 emit 契约可单端;真跨 iframe 双端留双机)| **运行态协作的核心价值**;碰 `_lowcode_state.ts` + `preview-bridge.ts` emit(scoped,类 §4.1 扩 base collab);传输见决 c |
| **C presenter 全镜像** | 一端 presenter 驱动,其余镜像路由+docState+表单输入+滚动(类屏幕共享,presenter 拓扑)| 大 | 低(几乎全靠双机) | 最重;输入/滚动镜像需更深 iframe 注入 |

**推荐 B(运行态 docState 同步,对称)**:这是 §4.6 区别于 §4.4 的**实质价值**(A 太薄、与 §4.4 重叠;C 过重)。用户明确挑了「中-大」的 §4.6 → B 量级匹配。诚实边界:B 的 iframe-runtime 部分真双端验(经验 K),单端只能覆盖中继/传输逻辑 + 桥消息契约 snapshot;emit 改动 scoped 在 docState runtime + bridge(同 §4.1「lowcode-aware 扩 base collab」姿态,保持可合并)。**最终 A/B/C 由 AskUserQuestion 定**,下表 b–h 按 B 展开(选 A/C 改写)。

| # | 决定(B 下) | 理由 |
|---|---|---|
| b | **桥加第 3 类消息 `docState`**:iframe→editor `{type:'docState', name, value}`(某 key 变);editor→iframe `{type:'docState', name, value}`(应用远端)| 沿现成 select/navigate 双向 + source-tag + suppressOutbound 破 echo 的成熟模式 |
| c | **传输 = Trystero room action(临时广播),非 Yjs/非持久化**(**probe 坐实**:`makeAction<T extends DataPayload>('doc-state')`→`[send,get]`,payload `{name,value:JsonValue}` 合规,namespace 9B<12B 限;已在 room.ts 用 4 次同模式)| 运行态是**会话临时态**,不该进 .fig / IndexedDB / scene-graph;Trystero room action 临时 P2P 广播语义最贴。**Yjs Y.Map 会持久化运行值**(不合适)。docState 值类型全 JSON(string/number/boolean/array/object)→ JsonValue 兼容 |
| d | **桥访问 zustand store**:`_lowcode_state.ts` 把 store 挂 `window.__opDocStore`(emit 增几行),桥读它 `subscribe`/`setState`;桥不直接 import 状态模块(保持桥通用)| 最小耦合;桥仍是通用模板,状态模块只多暴露一个 window 句柄 |
| e | **suppressInbound 破 echo**:应用入站 `setDocState` 时置标志,阻止 `store.subscribe` 回播出站(镜像 navigate 的 suppressOutbound)| 否则 A→B→A 无限回播 |
| f | **对称、per-key LWW**:任一端改某 docState key 都广播,后到覆盖该 key;无 presenter | 运行态值冲突可接受 LWW(同 §4.5 决,运行态比编辑态更短命);对称无角色管理负担 |
| g | **仅连接态 + preview 就绪时启用**;未协作/无 preview = 零行为(运行态不广播)| 单机零噪;preview 关着不挂 subscribe |
| h | **0 scene-graph / 0 .fig / 0 Yjs-ynodes 改动**;新增仅 bridge emit + `_lowcode_state` emit(几行)+ PreviewPane 中继 + room action wiring | 运行态是独立于编辑态文档的旁路通道 |

**次默(8)**:① 远端应用 docState 不触发本端业务副作用循环(suppress);② docState key 名两端同(schema 由 §4.1 同步)→ 直接按 name 应用;③ 值用 structured-clone 安全的 JSON(zustand 值本就可序列化);④ 新 peer 加入时可选「快照拉取」(留 follow-up,首刀只同步增量变更);⑤ preview 重载(iframe reload)后桥重挂 subscribe,运行态从本地 initial 起(不强拉远端,除非 ④);⑥ room action 在断连/换房时解绑;⑦ 消息体限 `{name,value}` 结构,不含编辑态;⑧ navigate 运行态同步(peer 导航联动)可顺带纳入或留 A-scope,首刀聚焦 docState。

#### 4.6.3 三问题反向核(经验 J,B 下)

- **Q1 技术链**:iframe `store.subscribe` → 出站 postMessage `docState` → PreviewPane onMessage → Trystero `sendDocState` action → 对端 `getDocState` 回调 → 对端 PreviewPane postIframe → 对端桥 inbound → `setDocState`(suppress)。**新增一条独立旁路链**(不碰 ynodes/yjs-sync)。需 probe:Trystero `makeAction` 的 API 形状 + payload 限制(经验 K)。
- **Q2 浮现**:运行态变化本身就是可见 UI(对端 preview 里值变了)。可选加「运行态协作中」指示(留次默)。关键 Q2 风险:**桥 echo / 副作用循环**(决 e suppress)。
- **Q3 心智模型**:用户期望「共享同一个跑起来的 app」。LWW 运行值(决 f)= 末次胜出,符合「多人同操作一个会话」直觉;但要明确这是**运行态镜像、非编辑态**(改 docState 默认值要去编辑态面板,§4.5)。preview reload 后从 initial 起(次默⑤)需文案/行为不误导。

#### 4.6.4–4.6.8(B 下,AskUserQuestion 锁定后细化)

- **API**:`preview-bridge.ts` 加 `docState` inbound/outbound 类型;`_lowcode_state.ts` emit `window.__opDocStore = store`;PreviewPane `postIframe` 扩 `docState` + onMessage 分支;collab `use.ts` 加 `sendPreviewDocState`/`onPreviewDocState`(Trystero action 封装,room.ts)。
- **改动**:`preview-bridge.ts`(桥)、`lowcode-state.ts`(emit window 句柄)、`PreviewPane.vue`(中继)、`room.ts`/`use.ts`(room action 通道)、可能 i18n(协作中指示)。**0 ynodes/scene-graph**。
- **step**(~中-大,3-4 step):设计 → step1 桥 `docState` 消息 + `_lowcode_state` window 句柄 + 出/入站 + suppress(emit 契约 snapshot 测)→ step2 PreviewPane 中继 + Trystero room action 通道(`makeAction` probe 先行)→ step3 启用门控/指示 + close。
- **风险**:Trystero action API/payload 形状(决 K-probe);桥 echo(决 e);iframe runtime 真双端验(K boundary);emit 改动 fork 可合并性(scoped,克制)。
- **post-mortem**:close 时补。

#### 4.6.x Post-mortem(进行中 — 代码完成,待 Tauri/双机 ACK)

**§4.6 代码完成 2026-05-30**(单端检查全绿:`bun run check` 0 error / 0 clone / locale 同步;`bridge.test.ts` +5 + `document-state.test.ts` +1 emit-契约测;collab + compiler 410 测零回归)。**scope 岔口 AskUserQuestion 锁 = B 运行态 docState 同步**(对称、per-key LWW、临时广播)。**传输 probe 坐实**(Trystero `makeAction`,经验 K)。

**step 3 并入 close:** 决 g「仅连接态启用」是**隐式门控**——`sendPreviewDocState` 在未连接时 no-op(`runtime.sendPreviewDocState=null`),桥只在 store 在场时挂 subscribe;「运行态协作中」可见指示是次默④/可选,**留 follow-up**。功能层 step 2 即完整。

#### Commit 链(设计 + 2 step;close 待 ACK)

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `9f42af8` | §4.6 全文(架构勘察)+ scope A/B/C AskUserQuestion 锁 = B + 传输 probe |
| step 1 | `a3d7a6c` | 桥第 3 类消息 `docState`(emit 层):`window.__opDocStore` 句柄(`_lowcode_state.ts`,+ `op-docstore-ready` 事件覆盖两 eval 顺序)+ `store.subscribe` diff 出站 + `setState` 入站 + `suppressDocStateOutbound` 破 echo;两模板 emit-契约测 |
| step 2 | `5b78a73` | 编辑器中继:Trystero `doc-state` room action(临时、不持久化)+ `connectCollabRoom` 返回 sender / 惰性 receiver handler + `use.ts` `sendPreviewDocState`/`onPreviewDocState` + PreviewPane 双向中继(入站 iframe→广播 / 远端→postIframe) |
| close | _待 Tauri ACK_ | post-mortem 补 surprise/经验 + memory + §4 进度 |

#### 单端可验 / 双机留验(经验 K boundary)

- **单端可验**:桥 emit 契约(docState 消息/句柄/suppress)snapshot 测;`makeAction` API probe;桥/中继 wiring 编译通过。
- **双机留验(经验 K)**:真跨 iframe 运行态镜像 —— A 在 preview 改 docState(zustand)→ B 的 preview 同步变化。单进程无信令 broker、且运行态活在 iframe React 内存里,验不了真传播(同 §4.1/§4.2/§4.4/§4.5 live 路径)。
- **诚实边界**:① 运行态 LWW(决 f),并发同 key 改末次胜出(可接受,运行态短命);② preview reload 后从本地 initial 起(次默⑤,不强拉远端快照——新 peer 快照拉取留 follow-up ④);③ emit 改动 scoped 在 bridge + `_lowcode_state`(类 §4.1 扩 base collab,保持可合并);④ prod 也 emit `window.__opDocStore` 句柄(无桥读取,无害,但暴露内部 store ref——可接受,已注释)。
- **Tauri 留意点**:桥 echo(决 e suppress 双向);store 句柄 eval 顺序(`op-docstore-ready` 兜底);无 docState 的文档不 emit `_lowcode_state`(无句柄,无运行态同步——符合预期)。

#### follow-up(§4.6 衍生)

- **§4.6-A 预览在场/跟随**(awareness +previewRoute);**§4.6-C presenter 全镜像**(+表单输入/滚动);**新 peer docState 快照拉取**(onPeerJoin 时同步当前运行态,次默④);**运行态协作中可见指示**(次默,UI)。

### 4.5 docState 协作冲突语义(设计 2026-05-30)

#### 4.5.1 现状与问题(已实测坐实 — 经验 C/K)

**核心发现(probe 坐实,非推断):** §4.1 的同步机制把节点存成 `Y.Map<字段名→值>`,**每个 object/array 字段经 `JSON.stringify` 存成一个不透明字符串**(`yjs-sync.ts:38-44`)。Yjs 只在「字段名」这一粒度合并 → **整个 `state` / `lowcodeDocumentState` 数组是单个 CRDT 寄存器 = 整块 last-write-wins**,无逐项合并。

两-doc 并发 probe(各自 doc,交换 update):两端**并发**给同一节点的 `state` 各加一项(A 加 `count` / B 加 `name`)→ 交换后两端都收敛成 `[count]`,**`name` 被静默丢失**(converged=true 但数据丢)。`bun -e`/two-peer harness 实测,非假设。

**这就是 §4.5:** 「Yjs 自动合并 node 字段」只在字段级成立(不同字段互不干扰);**同一 lowcode 集合字段内部并发编辑 = 整块覆盖,一方的并发改动静默丢失**。最高冲突面是**文档级集合**——
- 页面 `state`(`StatePanel`,`StateDef[]`)+ 文档 `lowcodeDocumentState`(`DocumentStatePanel`,`DocumentStateDef[]`)+ `lowcodeSupabaseConfig`(`SupabaseConfigPanel`):**共享、多人、追加型**,且 §4.4 已点出它们**无画布选区信号**(两人同改 docState,presence 都显示「没选东西」)。
- `bindings`/`events`/`interactiveProps`:单节点、通常单人编,冲突面低(§4.4 presence 已覆盖 awareness)。

「Yjs CRDT 自动合并」对这些**不**成立 —— 这是 §4.1 把 object 字段当黑盒 blob 存的直接后果(§4.1 修了「往返成字符串」的 correctness,但没碰「整块寄存器无逐项 CRDT」的并发语义)。

#### 4.5.2 关键决定(8 主 + 次默)

**决定 a = 修复深度,是真岔口 → AskUserQuestion 锁**(经验 J/H;三选,trade-off 见下):

| 方案 | 做法 | 正确性 | 风险 / 可合并性 | 体量 |
|---|---|---|---|---|
| **α 真逐项 CRDT** | `state`/`lowcodeDocumentState` 改存**嵌套 `Y.Map<entryId→JSON>`**(非 blob)→ Yjs 原生收敛:并发加不同项都活、同项改 = 逐项 LWW | 最强(零丢失) | **碰 base 同步热路径**(`syncNodePropsToYMap`/`yNodeToProps`/`applyYnodeToGraph` 须按字段名 carve-out + 跳过 blob 化 + observeDeep 嵌套事件);偏离 base 统一「object→stringify」编码 → fork 可合并性代价(经验新-4);中-大 | 中-大 |
| **β apply 时合并** | 保留 blob 存储;apply 远端 docState 时按 entry name/id **并集合并**远端+本地再回播 | 中(并集存活,但同项冲突需规则 + 回播经 suppress flag 有 echo 风险,probe 显示朴素 merge 不回播会发散) | 不碰 base 编码(可合并),但收敛正确性靠手写易错 | 中 |
| **γ 冲突浮现(不自动合并)** ⭐推荐 | 保留 LWW;**借 §4.4 presence 主动预警**「另一 peer 也在编文档状态 → 末次保存胜出、改动可能丢失」横幅(就是 §4.4 deferred 的面板内联 β)+ 远端 docState 到达且与本地发散时 no-swallow 提示;**诚实标注这些字段是整块 LWW** | 不防丢失,但**让丢失可见**(经验 C no-swallow) | 纯 additive、不碰 base 编码、可合并、低风险、承接 §4.4 节奏、单端可验检测逻辑 | 小-中 |

**推荐 γ:** 与本 fork 一贯的「最小可验 additive 刀 + 保持上游可合并」(§4.1/§4.4)一致;真 CRDT 重构(α)风险/体量更大、碰 base 热路径,留作「true-merge」后续刀。γ 同时把 §4.4 deferred 的面板内联 presence 徽标顺势补上,且诚实呈现冲突语义(候选池原话 = 「冲突语义未审视」→ 审视 + 浮现)。**最终 α/β/γ 由用户 AskUserQuestion 定**,下表 b–h 按 γ 展开(选 α/β 则相应改写)。

| # | 决定(γ 下) | 理由 |
|---|---|---|
| b | **冲突面限定文档级集合 3 字段**:页面 `state` / `lowcodeDocumentState` / `lowcodeSupabaseConfig` | 多人共享 + 无选区信号的高冲突面;单节点 bindings/events 冲突面低,不纳入(克制,经验新-4) |
| c | **主动预警靠 §4.4 presence**:面板检测「有远端 peer 的 `editing.kind` ∈ {state,docState,supabaseConfig} 且与本面板同 kind」→ 面板头横幅「⚠ 协作者也在编辑此处,末次保存胜出」| 复用 §4.4 awareness,零新广播;这正是 §4.4 decision h deferred 的内联 β 形态,§4.5 顺势落地 |
| d | **被动提示(no-swallow,经验 C)**:远端 `state`/`lowcodeDocumentState`(两个**数组**集合)到达 `applyYnodeToGraph`,若**本地 pre-apply 值 ⊄ 远端**(本地有项远端缺/同 id 异值 → 应用远端会丢本地信息)→ toast「文档状态被协作者改动,请检查」。**`supabaseConfig`(单对象、无 entry 粒度)不做被动检测**(纯顺序改也会整体≠ → 噪声),仅靠决 c 主动横幅 | 「本地⊄远端」精确捕捉「应用远端会丢本地改动」且对纯顺序追加(本地⊆远端)不报;单对象无法在不追踪 dirty 态下区分「并发改」vs「落后」→ 不被动报,避免误报 |
| e | **不自动合并、不改存储编码**(γ 的边界)| 保持 base 同步路径与 §4.1 blob 编码不动 → 上游可合并;真合并是 α(后续刀) |
| f | **检测纯函数 `docStateApplyLosesLocal(local, remote)`** 放 app 层,单测可验(喂「本地⊄远端」断言检出) | 经验 K:能确定性单测的就单测(检测逻辑单端可验,真双端传播留双机) |
| g | **横幅/toast 文案传达「提示性、末次保存胜出」非「已锁/已合并」**(经验 J Q3 心智模型) | 用户须知道这是 LWW 软预警,不是被阻止、也不是自动 merge 了;避免误以为安全 |
| h | **0 engine/kiwi/compiler/docState 编码改动**;纯 collab 读侧检测 + app UI + i18n | γ 是上层 additive 层,同 §4.4 |

**次默(8)**:① 横幅只在面板可见(连接态 + 有同 kind 远端 editing);② 文案区分页面状态/文档状态/Supabase 配置(同 §4.4 label 三分);③ 检测函数按 entry `id` 优先、回落 `name` 比对;④ toast 去重(同字段短时间内只提示一次);⑤ 未连接协作 = 无横幅无 toast(单机零噪);⑥ 被动检测仅 `state`/`docState` 两数组(决 d);`supabaseConfig` 主动横幅(决 c)有、被动 toast 无;⑦ 不持久化任何冲突态(运行态);⑧ 比对 entry 值用 `JSON.stringify`(这些字段本就 JSON blob,足够)。

#### 4.5.3 三问题反向核(经验 J)

- **Q1 技术链**(γ):面板读 `useCollabInjected().remotePeers` → filter editing.kind 同 kind → 横幅;`applyYnodeToGraph` 旁路调 `docStateApplyLosesLocal(localPre, remoteProps)`(仅 state/docState 两数组)→ toast。**复用 §4.4 presence + §4.1 apply 路径**,无新订阅/无新广播。✅
- **Q2 浮现**:主动横幅(编辑前/中)+ 被动 toast(覆盖已发生)双层 —— 编辑时就看到「有人也在编」,事后看到「被改了」。避免 §2.v2 类「只加状态不浮现」。
- **Q3 心智模型**:用户看到横幅期望什么?→ 期望「知道有并发风险」,**不是**期望「系统帮我合并好了」(γ 不 merge)。文案必须诚实:LWW、末次胜出、请协调/复查。若选 α 则 Q3 反过来——用户期望「都不丢」,α 满足但要确认同项冲突 = 逐项 LWW(默认值并发改仍单赢,可接受)。

#### 4.5.4 API / 类型(γ)

```ts
// src/app/collab/conflict.ts (新)
/** 应用远端数组集合(state / lowcodeDocumentState)是否会丢失本地信息 =
 *  「本地 ⊄ 远端」:本地有 entry 远端缺,或同 id 值不同。纯函数,单测可验。
 *  本地 ⊆ 远端(纯顺序追加 / 完全相同)→ false(无丢失,不报)。 */
export function docStateApplyLosesLocal(
  local: unknown,
  remote: unknown
): boolean
```

#### 4.5.5 改动清单(γ)

- ➕ `src/app/collab/conflict.ts`:`docStateApplyLosesLocal` 纯函数(本地⊄远端,entry id/name 比对)
- 🔁 `applyYnodeToGraph`(或其 lowcode-aware 包装):apply `state`/`lowcodeDocumentState` 前抓 local pre-apply 值,若 `docStateApplyLosesLocal` → 经回调冒泡 toast(连接态才提示)
- 🔁 `StatePanel.vue` / `DocumentStatePanel.vue` / `SupabaseConfigPanel.vue`:头部并发横幅(读 §4.4 `remotePeers` 同 kind editing)—— 抽共享小组件/composable `usePresenceConflictBanner(kind)` 杜绝 3 份 clone(经验 A)
- ➕ i18n:`presenceConflictBanner`(横幅,带 {target} 占位)+ `presenceConflictToast`(被动提示)× 8 locale
- ➕ 单测 `tests/engine/collab/conflict.test.ts`:`docStateApplyLosesLocal` 正负例(本地有项远端缺=true / 同 id 异值=true / 本地⊆远端纯追加=false / 完全相同=false / 空=false)
- **0** engine/compiler/kiwi/docState 编码改动

#### 4.5.6 工作分解(γ,~小-中,2-3 step)

| Step | 任务 | commit 前缀 |
|---|---|---|
| 0 | §4.5 设计 doc + 深度 AskUserQuestion 锁 | `docs(lowcode): §4.5 docState conflict — detailed design` |
| 1 | `docStateApplyLosesLocal` 纯函数 + apply 路径接入 + onConflict 回调 + toast + 单测 | `feat(collab): §4.5 step 1 — docState conflict detection` |
| 2 | `usePresenceConflictBanner(kind)` + 3 文档级面板横幅 + i18n×8 + close | `feat(collab): §4.5 step 2 — concurrent-edit banner` |

#### 4.5.7 风险(γ)

| 风险 | 影响 | 缓解 |
|---|---|---|
| 检测误报(正常顺序编辑也判发散) | 中 | 只在「双方各有独有项 / 同 id 异值」判冲突;纯顺序追加(远端是本地超集)不报;单测钉正负例 |
| toast 噪声 | 低 | 次默 ④ 去重;次默 ⑤ 未连接零提示 |
| 真双端检测单进程验不了 | 低 | 经验 K:检测纯函数单端可验;真双端传播留双机(同 §4.1/§4.2/§4.4) |
| 横幅 3 面板 clone | 低 | 共享 composable(经验 A) |
| 用户误以为已自动合并(Q3) | 中 | 决 g 文案诚实「末次保存胜出」 |

#### 4.5.8 Post-mortem(进行中 — 代码完成,待 Tauri/双机 ACK)

**§4.5 代码完成 2026-05-30**(单端检查全绿:`bun run check` 0 error / 0 clone / 8 locale 同步;`conflict.test.ts` 7 纯函数 + 1 apply-path 集成测试 + collab 全套 23 测;零回归)。**深度岔口 AskUserQuestion 锁 = γ 冲突浮现**(保留 LWW、不自动合并、不碰 base 编码;真逐项 CRDT α 留后续刀)。**关键:bug 由 two-doc probe 实测坐实**(并发加不同 state 项 → 整块 LWW、一方静默丢;经验 C/K)——不是基于推断。

#### Commit 链(设计 + 2 step;close 待 ACK)

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `860d9fb` | §4.5 全文(含 probe 发现)+ 深度 α/β/γ AskUserQuestion 锁 = γ |
| step 1 | `beee2ec` | `docStateApplyLosesLocal`(本地⊄远端纯函数)+ apply 路径接入(conflictHandler 经 createYjsGraphSync→useCollab→EditorView 透传)+ toast + 纯函数单测 + two-doc apply-path 集成测试 |
| step 2 | `0519e5c` | `usePresenceConflictBanner(kind)` 共享 composable + 3 文档级面板 amber 横幅(顺带落地 §4.4 deferred 的内联 β)+ banner/target i18n × 8 |
| close | _待 Tauri ACK_ | post-mortem 补 surprise/经验 + memory + §4 进度 |

#### 单端可验 / 双机留验(经验 K boundary)

- **单端可验(待 Tauri ACK)**:`docStateApplyLosesLocal` 正负例(纯函数);apply-path 集成测试断言 handler 触发;横幅喂假 remotePeer.editing 渲染。
- **双机留验**:真两端并发改同一 docState → 被动 toast「文档状态被协作者改动」(收到方丢失时);两端同 kind 编辑 → 主动横幅。单进程验不了真 WebRTC 传播(同 §4.1/§4.2/§4.4)。
- **诚实边界(决 g Q3)**:γ **不防丢失、不合并**,只让丢失可见 + 编辑前预警。文案明确「末次保存胜出」。真零丢失要 α(嵌套 Y.Map 逐项 CRDT)—— 已记为后续刀。
- **Tauri 留意点**:被动 toast 仅 `state`/`docState` 两数组(`supabaseConfig` 单对象无 entry 粒度 → 仅主动横幅,决 d);横幅依赖 §4.4 presence,需 §4.4 也在场(已 code complete)。

### 4.4 lowcode-aware presence(协作在编什么,设计 2026-05-30)

#### 4.4.1 现状与问题

基座 awareness 广播三类本地状态(`local-awareness.ts` `setLocalStateField`):`user`{name,color}、`cursor`{x,y,pageId,zoom}、`selection`[nodeId…]。远端 peer 因此已可见「谁选了哪个节点」(`selection` 驱动画布远端选区高亮 + avatar follow)。

缺口:**lowcode 编辑发生在右侧属性面板**(`src/components/properties/Lowcode/` 9 个面板),协作时这层完全不可见 ——
- **节点级**:两人都选中同一 BUTTON,一个在编 `bindings`(TextBindingPanel)、一个在编 `events`(EventsPanel)→ 双方只看到对方「选了同一节点」,看不到「在编不同的子配置」,无冲突预警。
- **文档级最严重**:`StatePanel`(page state)/ `SupabaseConfigPanel` / `DocumentStatePanel`(`lowcodeDocumentState`)三个**无节点选择**的面板 —— 两人同改 docState 默认值时,双方的 `selection` 都是空,presence 上表现成「都没在干活」,而这恰是 §4.5 docState 冲突最易撞车处。`selection` 信号对文档级编辑零覆盖。

§4.4 补这层:扩 awareness payload 加一个 `editing` 字段,广播「本地正在编哪个 lowcode 面板 / 子目标」,远端浮现。**纯 additive**:不动 cursor/selection/user 三条既有通道,不动 engine/kiwi/docState 编码;0 持久化、0 广播敏感值。

#### 4.4.2 关键决定(8 主 + 次默)

| # | 决定 | 理由 |
|---|---|---|
| a | **新增第 4 条 awareness 字段 `editing`**(`setLocalStateField('editing', …)`),与 cursor/selection 并列,**不挤进 selection** | selection 是 nodeId 数组、语义是「画布选区」,塞 lowcode 面板状态会污染既有远端选区渲染。独立字段 = 0 回归、清晰拆分(经验「additive 不动既有通道」) |
| b | **payload = `{ kind, nodeId? }`**(`PresenceEditingTarget`,**AskUserQuestion 锁 2026-05-30 = kind+nodeId 面板级,不带 detail**):`kind` ∈ 9 面板枚举(`textBinding`/`valueBinding`/`interactiveProps`/`state`/`events`/`list`/`renderCondition`/`docState`/`supabaseConfig`);`nodeId` 仅节点级面板带,文档级缺省 | 最小载荷;**只播结构性标识(kind + nodeId,二者皆非敏感:nodeId 已在 selection 通道存在),绝不播字段名/值/序号/表达式**。行级 detail 经评估接线成本高且非首刀必需 → 留 follow-up |
| c | **label 在渲染端派生,不进 payload**(远端用本地 graph 把 `nodeId`→节点名,kind→i18n 文案,拼「在编 Button1 的事件」/「在编文档状态」)| 节点经 Yjs 同步在两端同 id → 远端可解析名;payload 保持 tiny + 不冗余(镜像 `remoteCursors` 的 selection 派生法,经验 E 对齐既有惯例) |
| d | **focus 驱动 set / blur(+ 选区变 / 断连)驱动 clear**:面板根 `@focusin` 设 editing、`@focusout`(焦点离开面板子树)清;`selection:changed`、`disconnect` 也清 | 「在编」= 该面板内有输入聚焦,符合直觉;focusin/out 冒泡天然覆盖面板内全部 input,无需逐 input 接线(DRY) |
| e | **单一共享 composable `usePresenceTarget(kind, getNodeId?)`** 封装 focusin/focusout→collab 调用,每个 lowcode 面板根 div 用 `v-on` 绑两个 handler;`getNodeId` 节点级面板传 `() => node.value?.id`,文档级面板省略 | 9 面板复用一个 helper,杜绝 jscpd clone(经验 A dedup helper);面板只多两行模板属性(.vue 非 oxlint/jscpd 扫描重灾,但仍单点收口) |
| f | **collab 出口加 `updateEditingTarget(target \| null)`**,镜像 `updateSelection`;`buildRemotePeers` 读 `peerState.editing` 填 `RemotePeer.editing` | 沿现成 local-awareness / use.ts / RemotePeer 链加一参,0 新链路 |
| g | **隐私:payload 仅 kind + nodeId,零业务值**(无 docState key 名、无表达式、无凭证)| kind+nodeId 是「在编哪个面板/节点」的最小必要信息,nodeId 既有 selection 通道已播 → 0 新增暴露面。沿 §4.2「房间内也不过度广播」姿态。行级 detail 留 follow-up 时须重审隐私(决 b) |
| h | **surfacing = 集中式(α,AskUserQuestion 锁 2026-05-30)**:`ConnectedRoom.vue` peer-list 每行派生 label(「Alice · 在编文档状态」),`CollabAvatarStack.vue` avatar tooltip 同文案;**不动 9 面板渲染**(面板头内联徽标 β 留 follow-up)| 低风险、单端可验(喂假 peerState)、0 面板侵入;承接 §4.1/§4.2「最小可验刀」节奏 |

**次默(8,沿用未单列)**:① 文档级面板(无 nodeId)editing.nodeId=undefined,label 走「文档状态/Supabase 配置/页面状态」文案;② 远端 peer 离页(pageId≠本地)其 editing 仍可在 peer-list 显示(不依赖同页,区别于 cursor);③ editing 不写 IndexedDB、不进 .fig(运行态,同 cursor);④ 同一 peer 同时只有一个 editing(后聚焦覆盖前);⑤ kind 枚举集中在 `collab/types.ts`,与面板一一对应;⑥ nodeId 解析不到节点名(远端尚未同步到该节点)→ label 回落「在编某节点的事件」泛称,不崩;⑦ 本地自身 editing 不渲染(buildRemotePeers 已跳 localClientId);⑧ 无 editing 的 peer(未在编 lowcode)payload 该字段缺省,UI 回落到「在线」。

#### 4.4.3 三问题反向核(经验 J,每决必走)

- **Q1 技术链**:`usePresenceTarget` → `collab.updateEditingTarget` → `setLocalStateField('editing',…)` → Yjs awareness 广播 → 远端 `awareness 'change'` → `updatePeersList` → `buildRemotePeers` 读 `editing` → `RemotePeer.editing` → UI 派生 label。**全程复用既有 awareness 'change' 监听**(updatePeersList 已挂),无新订阅。✅ 链路闭合。
- **Q2 UI 与状态浮现**:editing 设了但**哪儿看得见?** → 这正是决 h 的岔口,**AskUserQuestion 锁 = 集中式 α**(ConnectedRoom peer-list 行 + avatar tooltip),不动面板。若只加 payload 不加可见出口 = 白做(同 §2.v2 Q2 可发现性洞)→ 已堵。另:focus→set 的**清除时机**若漏(切面板没 focusout?)→ editing 残留误导 → 决 d 补 `selection:changed`/disconnect 兜底清。
- **Q3 心智模型**:用户看到「Alice 在编 Button1 的事件」期望什么?→ 期望「别去抢编同一处」的软提示,**非锁**(Yjs CRDT 仍自动合并,§4.5 才谈冲突语义)。文案须传达「提示性 presence」而非「已锁定」,避免误以为被阻止(决 c label 用「在编」非「锁定」)。文档级 label 须明确指向「文档状态/Supabase 配置/页面状态」让无选区的撞车可见(§4.4.1 核心动机)。

#### 4.4.4 API / 类型

```ts
// collab/types.ts
export type PresenceEditingKind =
  | 'textBinding' | 'valueBinding' | 'interactiveProps' | 'state'
  | 'events' | 'list' | 'renderCondition' | 'docState' | 'supabaseConfig'

export interface PresenceEditingTarget {
  kind: PresenceEditingKind
  nodeId?: string          // 节点级面板带;文档级缺省(行级 detail 留 follow-up)
}

export interface RemotePeer {
  /* …既有 cursor/selection… */
  editing?: PresenceEditingTarget
}
```

#### 4.4.5 改动清单

- 🔁 `src/app/collab/types.ts`:`PresenceEditingKind` / `PresenceEditingTarget` + `RemotePeer.editing`
- 🔁 `src/app/collab/awareness.ts` `buildRemotePeers`:读 `peerState.editing` → `RemotePeer.editing`
- 🔁 `src/app/collab/local-awareness.ts`:`updateEditingTarget(target | null)`(set/clear `setLocalStateField('editing', …)`);`updateSelection` 顺带 clear editing(决 d 兜底,选区变即清)
- 🔁 `src/app/collab/use.ts`:暴露 `updateEditingTarget`
- ➕ `src/app/editor/presence/use-presence-target.ts`(新,共享 composable):`usePresenceTarget(kind, getNodeId?)` → `{ onFocusIn, onFocusOut }`;节点级面板传 `() => node.value?.id`,文档级省略
- 🔁 9 个 `Lowcode/*.vue` 面板根:`@focusin`/`@focusout` 接 composable(仅 kind+nodeId,无 detail)
- 🔁 surfacing UI(集中式 α):`ConnectedRoom.vue` peer-list 每行派生 editing label;`CollabAvatarStack.vue` tooltip 追加 label;`MobileHud/MobilePresencePopover.vue` 若有同款 peer 列表则复用同一 label helper(否则记 follow-up,不强塞)
- ➕ label 派生 helper(`presenceEditingLabel(peer, getNodeName, i18n)`),ConnectedRoom + AvatarStack(+ MobileHud)共用,杜绝 clone
- ➕ i18n:`presenceEditing{TextBinding,ValueBinding,InteractiveProps,State,Events,List,RenderCondition,DocState,SupabaseConfig}` label 模板 × 8 locale(节点级带 `{node}` 占位)
- ➕ 单测 `tests/engine/collab/presence-editing.test.ts`:`buildRemotePeers` 带 editing 的 peerState → `RemotePeer.editing` round-trip;localClientId 自身跳过;无 editing 缺省
- **0** engine/compiler/kiwi/docState 改动

#### 4.4.6 工作分解(~中,3-4 step)

| Step | 任务 | commit 前缀 |
|---|---|---|
| 0 | §4.4 设计 doc + Q1/Q2 AskUserQuestion 锁 | `docs(lowcode): §4.4 presence — detailed design` |
| 1 | payload 类型 + buildRemotePeers + updateEditingTarget + use.ts 出口 + buildRemotePeers 单测 | `feat(collab): §4.4 step 1 — editing-target awareness payload` |
| 2 | `usePresenceTarget` composable + 9 面板根接线(focusin/out,kind+nodeId) | `feat(collab): §4.4 step 2 — panel focus → presence target` |
| 3 | 集中式 surfacing(ConnectedRoom peer-list + avatar tooltip)+ label helper + i18n×8 + close | `feat(collab): §4.4 step 3 — remote editing surfacing` |

#### 4.4.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| focusout 时机:面板内 popover/portal(VariablePickerPopover)聚焦 → 误判离开 | 中 | focusout 用 `relatedTarget` 判是否仍在面板子树;portal 元素加 data 标记或容忍短暂 clear(presence 非关键态) |
| editing 残留(切走没清) | 中 | 决 d 三重清:focusout + selection:changed + disconnect |
| 9 面板接线产生 jscpd clone | 低 | 决 e 单一 composable,面板只调用不复制逻辑 |
| 真双端 presence 单进程验不了 | 低 | 同 §4.1/§4.2 boundary:单端验 payload build/parse + UI(喂假 peerState)+ 本地 focus→updateEditingTarget 调用;真双端留双机(经验 K) |
| payload 泄露业务值 | 低 | 决 b/g payload 仅 kind+nodeId,零业务值;nodeId 既有 selection 通道已播 → 0 新增暴露面 |

#### 4.4.8 Post-mortem(进行中 — 代码完成,待 Tauri/双机 ACK)

**§4.4 代码完成 2026-05-30**(单端检查全绿:`bun run check` 0 error / 0 clone / 8 locale 同步;`presence-editing.test.ts` 4 测 + collab 全套 15 测绿;compiler+tools+collab 457 测零回归)。**形态/粒度两岔口设计阶段经 AskUserQuestion 锁**(粒度 = kind+nodeId 面板级;浮现 = 集中式 peer-list + avatar tooltip),无 detail / 不动面板渲染。**正式 close 留用户主导 Tauri ACK 之后**(经验 H:Tauri/真实路径照 wiring/UX/心智模型洞;§4.2 即 Tauri 验照出 keyless footgun)。

#### Commit 链(设计 + 3 step;close 待 ACK)

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `1f1d2ec` | §4.4 全文 + 两岔口 AskUserQuestion 锁(粒度 kind+nodeId / 浮现集中式)|
| step 1 | `3cfd386` | `editing` awareness 字段(additive,{kind,nodeId?})+ `buildRemotePeers` 读 + `updateEditingTarget`(选区变即清)+ `RemotePeer.editing` + guard 单测 |
| step 2 | `6a0e0e3` | `usePresenceTarget(kind, getNodeId?)` composable(focusin set / focusout subtree-leave clear)+ 9 面板根接线(6 节点级 + 3 文档/页面级)|
| step 3 | `2ec0f0e` | 共享 `presenceEditingLabel` helper(穷举 Record over kind)+ CollabPanel peer-roster(ConnectedRoom)+ avatar tooltip + MobilePresencePopover + 10 i18n key × 8 locale |
| close | _待 Tauri ACK_ | post-mortem 补 surprise/经验 + memory |

#### 单端可验 / 双机留验(经验 K boundary)

- **单端可验(待 Tauri ACK)**:聚焦各 lowcode 面板 → `updateEditingTarget` 调用(payload {kind,nodeId?});peer-roster + tooltip 喂假 peerState 渲染 label;切面板/换选区 → editing 清;label 节点名解析 + fallback。
- **双机留验**:两端真 WebRTC awareness 传播(A 编 events → B 的 roster 显示「Editing events of <A 选中节点>」);文档级(A 编 docState → B 显「Editing document state」,即便 A 无画布选区)。单进程验不了真 WebRTC,同 §4.1/§4.2。
- **已知待 Tauri 留意点**:focusout 遇 teleport 弹层(VariablePickerPopover)会误清 editing(决 e 注释 + §4.4.7 风险已记;非关键态,回焦即复);MobileHud `share()` 把 `shareCurrentDoc()` 返回的 `{roomId,key}` 当字符串用(§4.2 carry-over 既有 lint warning,非 §4.4 引入,留上游/§4.x)。

### 4.2 房间鉴权(room auth,设计 2026-05-30)

#### 4.2.1 现状与问题

当前任何人凭 `appId`(全局字面量 `'openpencil'`)+ 8 位随机 `roomId` 即可进同一协作房间(`room.ts` `joinTrysteroRoom({appId, rtcConfig}, roomId)`,无 password)。威胁:① roomId 仅 36^8≈2.8e12,且公共 MQTT broker 上房间话题由 `appId+roomId` 派生 → 监听 broker 可观测/枚举活跃房间;② lowcode 应用可能带 Supabase config / 业务数据。无鉴权层 = 协作房间对「知道/猜到/枚举出 roomId 的人」敞开。

#### 4.2.2 关键决定

| # | 决定 | 理由 |
|---|---|---|
| a | **用 Trystero 原生 `password`**(`joinRoom` config),非 app 层 post-join gate | `genKey(password, appId, roomId)` 加密 SDP 会话描述 → 密钥不匹配的 peer **无法建立 WebRTC 连接**(密码学级);即便 broker 上看到房间也连不上。appId 仍全局(私有 appId/信令 = §4.3)|
| b | **自动生成长随机密钥、内嵌邀请链接**(用户 2026-05-30 AskUserQuestion ACK 推荐项)| 零摩擦(UX 同今天),裸 roomId 不再够;「有完整链接即可进」= Figma/腾讯文档「知道链接的人」模型,标准做法。堵 guess/enumerate 向量 |
| c | **密钥走 URL fragment**(`#k=<key>`),roomId 仍在路径(`/share/:roomId` 不变)| fragment 永不发服务器(隐私,不进服务器日志);标准 secure-link 模式 |
| d | **密钥用 `crypto.getRandomValues` 生成**(禁 `Math.random`,CLAUDE.md 锁),~128 bit | 远强于 8 位 roomId;CLAUDE.md 随机源约束 |
| e | **password 透传连接链**:`connect(roomId, key?)` → `connectCollabSession` → `connectCollabRoom` → `joinTrysteroRoom({appId, password:key, rtcConfig}, roomId, onJoinError)`;`shareCurrentDoc()` 生成 `{roomId, key}` 并存 `CollabState.roomKey` | 沿现有 options-object 链路加参 |
| f | **鉴权失败浮现(Q2)**:`joinRoom` 第 3 参 `onJoinError(details)`(incorrect password)→ 经回调冒泡到 CollabPanel → toast「房间密钥错误或缺失」+ 复位 connecting 态 | §2.v2 教训:失败不能表现成静默连不上;Trystero 原生回调 |
| g | **0 持久化 / 0 schema**:密钥仅活在 URL/运行态(`CollabState.roomKey`,本地非广播)| **绝不写进 .fig / docState / awareness 广播**(awareness 只播 `{name,color}`)|
| h | ~~旧裸-roomId 链接(无密钥)空 password 兜底~~ **→ 推翻(2026-05-30,用户 ACK)。密钥强制必需:join 解析不到 `#k=` → 拒绝连接 + toast,裸 roomId 什么都开不了**。 | **原 h(空密码兜底)是缺陷**:虽与带密钥房间密码学隔离、无数据泄露,但「裸 roomId 能开空密码房间」误导 + 削弱「房间鉴权」本意(UI 乐观置 connected,看似没密钥也进来了)。房间短生命周期、无长期裸链接 → 兼容理由弱。**「鉴权」= 没密钥进不去** |

#### 4.2.3 改动

- 🔁 `src/constants.ts`:`ROOM_KEY_LENGTH`(+ 复用/新 charset)
- 🔁 `src/app/collab/awareness.ts`:`generateRoomKey()`(镜像 `generateRoomId`,长 + crypto)
- 🔁 `src/app/collab/types.ts`:`CollabState.roomKey: string | null` + DEFAULT
- 🔁 `src/app/collab/room.ts`:`connectCollabRoom` opts += `password?` / `onAuthError?`;config 加 `password` + `joinRoom` 第 3 参 `onJoinError`
- 🔁 `src/app/collab/session.ts`:`connect(roomId, key?)` + `connectCollabSession` 透传 password/onAuthError;存 roomKey
- 🔁 `src/app/collab/use.ts`:`connect(roomId, key?)`;`shareCurrentDoc()` → `{roomId, key}`;暴露 onAuthError 钩
- 🔁 `src/components/CollabPanel/context.ts`:`shareUrl` 带 `#k=`;`share()` 复制带密钥链接;`join()` 从 `route.hash`/`joinInput` 解析密钥;onAuthError → toast
- ➕ i18n dialogs key `roomKeyError` × 8
- ➕ 单测:`generateRoomKey`(长度/charset/唯一)+ 邀请链接 key 解析(roomId + `#k=` 提取)
- **0** engine/compiler / kiwi / docState 改动

#### 4.2.4 成功标准 + Tauri ACK

1. key-gen + URL key-parse 单测绿;`bun run check` 全绿;零回归
2. **Tauri 实测(部分可单端,完整鉴权需两端 → 同 §4.1 留双机/部署验)**:
   - 单端可验:share 生成的链接含 `#k=`;copy 出的链接带密钥;join 粘带密钥链接能解析 roomId+key
   - 双端(留验):正确密钥连通;**裸 roomId / 错密钥 → 连不上 + toast「密钥错误或缺失」**(非静默)

#### 4.2.5 工作分解(~1 day)

| Step | 任务 | commit |
|---|---|---|
| 0 | §4.2 设计 doc | `docs(lowcode): §4.2 room auth — detailed design` |
| 1 | 密钥生成 + password 透传连接链 + onJoinError + key-gen 单测 | `feat(collab): §4.2 step 1 — room key + password threading + join-error` |
| 2 | CollabPanel shareUrl/join 密钥 + onAuthError toast + i18n×8 + key-parse 单测 + close | `feat(collab): §4.2 step 2 — keyed share link + auth-error surfacing` |

#### 4.2.6 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| fragment 在 router/Tauri deep-link 丢失 | 中 | 用 `route.hash` 读(vue-router history 模式保留);join 也从粘贴的 joinInput 字符串提取 `#k=` |
| 密钥意外进服务器/日志 | 中 | 决 c fragment 永不发服务器;决 g 绝不持久化 |
| 完整鉴权双端验不了(单机)| 低 | 单测覆盖 key-gen/parse;Trystero crypto 是其保证;双端留部署验(经验 K boundary,同 §4.1)|
| `Math.random` 误用 | 低 | 决 d crypto.getRandomValues;check:arch/oxlint 钉 |

#### 4.2.8 Post-mortem

**§4.2 closed 2026-05-30**(单端验证 ✅;双端鉴密钥留双机/部署验,经验 K boundary)。补上协作的房间鉴权层 —— §4 第二刀、最高优先安全缺口。**验证期用户照出 1 个 keyless footgun → 推翻决 h**。

#### Commit 链(设计 + 代码 + 1 keyless 收紧)

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `bdf3392` | Trystero password(决 a)+ 自动随机密钥内嵌 fragment(决 b/c/d,AskUserQuestion)+ onJoinError 浮现(决 f)|
| 代码 | `5b84658` | `generateRoomKey`(crypto)+ CollabState.roomKey + room.ts password/onJoinError(typed alias 绕 mqtt .d.ts 缺第 3 参)+ connect 链透传 + CollabPanel shareUrl `#k=`/join 解析/onAuthError toast + `dialogs.roomKeyError`×8 + key-gen/parse 单测 |
| keyless 收紧 | `39feb31` | **join 拒绝无密钥邀请(推翻决 h)** —— 用户验证照出 |
| close | _this commit_ | §4.2.8 + memory + close |

#### 验证结果(用户主导 2026-05-30,单端)

- ✅ share 生成链接含 `#k=<26位密钥>`;复制链接带密钥
- ✅ 粘带密钥完整链接 → 正常解析 roomId+key
- ✅ **粘裸 roomId/无 `#k=` 链接 → toast「房间密钥错误或缺失」、不开房间**(收紧后)
- 双端(正确密钥连通 / 错密钥 onJoinError toast)留双机/部署验 —— Trystero crypto 是其保证,单进程验不了真 WebRTC(同 §4.1 boundary)

#### Surprise(1,用户验证照出 → 推翻决 h)

1. **keyless 裸链接「能开房间」**(commit `39feb31` 收紧)—— 决 h 原设计:无密钥降级空密码房间(向后兼容)。用户单端验证时发现粘裸链接仍「开了房间」,质疑是否正确。分析:空密码房间与带密钥房间**密码学隔离、无数据泄露**(`genKey('',...)` ≠ `genKey(key,...)`,SDP 互解不开;房主在场广播时 keyless 反收 onJoinError),但 **UI 乐观置 `connected` + 「裸 roomId 能开房」误导,削弱「房间鉴权」本意**。推翻决 h 为「密钥强制必需,无密钥 join 直接拒」。**根因:决 h 把「向后兼容」凌驾于「鉴权语义一致性」之上 —— 安全功能里,降级路径(empty-password fallback)本身就是个口子,即便密码学上隔离也不该留**。

#### 经验印证 / 新增

- **H(实测照洞)再印证,且这次是「用户语义直觉」照出的**:不是 wiring bug、不是 crypto 漏洞(隔离成立),是**设计决定与功能本意的语义错位**(决 h 的兼容兜底 vs「鉴权=进不去」)。单元/集成测试都不会报(keyless 房间技术上工作正常)—— 只有人「这对吗?」的直觉能接住。**同 §3.v4 的 Q3 心智模型类,但对象是安全语义**。
- **新增:安全功能里慎留「降级/兼容兜底」路径**。empty-password fallback 即便密码学隔离、无泄露,也是个削弱保证的口子;鉴权类功能的默认姿态应是「缺凭证 = 拒绝」,而非「缺凭证 = 降级到无鉴权变体」。把向后兼容让位于鉴权语义一致性。
- **K boundary**:双端真鉴权(WebRTC SDP 加解密)单进程验不了 → 单端验 key-gen/parse/UI-reject + 明确双端留部署验。同 §4.1 / §2.v4。

#### §4 进度
§4.1(lowcode 字段同步 correctness)+ §4.2(房间鉴权)闭。剩 §4.3 自建信令+TURN(耦合 §5)/ §4.4 lowcode-aware presence / §4.5 docState 冲突 / §4.6 preview 协作。

---

---

### 4.1 lowcode 字段 Yjs 往返 correctness(设计 2026-05-30)

#### 4.1.1 现状与问题(已实测坐实)

`src/app/collab/yjs-sync.ts` 的写/读不对称:
- **写** `syncNodePropsToYMap`:`Object.entries(node)` 遍历**全部** key,任何 object 值 → `ynode.set(key, JSON.stringify(value))`。
- **读** `yNodeToProps`:只对 `YJS_JSON_FIELDS`(`src/constants.ts`,7 个核心字段:childIds/fills/strokes/effects/vectorNetwork/boundVariables/styleRuns)`JSON.parse` 回来;其余 key 直接返回原值(即仍是 JSON 字符串)。

lowcode 字段 `state`/`bindings`/`events`/`interactiveProps`/`renderCondition`/`lowcodeDocumentState`/`lowcodeSupabaseConfig` **全是 object、全不在白名单** → 协作时远端经 `applyYnodeToGraph → yNodeToProps → updateNode` 收到的是 **JSON 字符串**而非对象。后果:远端编辑器读 `node.bindings`(期望对象)崩、保存损坏、该端下次 `syncNodeToYjs` 再 stringify 一次 → 双重编码累积。**白名单当初加 lowcode 字段时漏了同步更新,静默损坏无报错**。实测确认:`yNodeToProps(syncNodePropsToYMap(node)).bindings` 返回 `typeof === 'string'`。

#### 4.1.2 关键决定

| # | 决定 | 理由 |
|---|---|---|
| a | **扩 `YJS_JSON_FIELDS` 白名单 +7 lowcode object 字段 + guard 测试**(用户 2026-05-30 AskUserQuestion ACK 推荐项)| 改动最小、贴基座惯例、对上游 collab 编码 0 冲突(fork 要保持可与上游合并);guard 测试把「静默损坏」变「响亮的测试失败」,治根因(白名单漂移)|
| b | 加入的 7 字段:`state` / `bindings` / `events` / `interactiveProps` / `renderCondition` / `lowcodeDocumentState` / `lowcodeSupabaseConfig`(对齐 `update_lowcode_node` 的 patch keys + `serializeLowcodeFields`)| 这是当前 schema 下全部 object 值 lowcode 字段 |
| c | **修复仅读侧生效,写侧不变**(写早已 stringify)→ **向后兼容**已持久化的 Yjs 状态(之前存的就是 stringify 后的字符串,修复后读时正确 parse)| 无 IndexedDB 迁移负担 |
| d | guard 测试**从测试节点自身推导 object 字段集**(不硬编码列表):round-trip 后遍历原节点每个 object 值 key,断言往返值仍是 object 且 deep-equal | 未来新增 object 字段忘了加白名单 → 只要测试节点填了该字段就响亮失败(治 a 的残留脆弱) |

#### 4.1.3 改动

- 🔁 `src/constants.ts` `YJS_JSON_FIELDS` += 7 lowcode 字段(注释说明:写/读必须对称,新增 object 字段必须进此集)
- ➕ `tests/engine/collab/yjs-roundtrip.test.ts`(新):guard —— 带全 lowcode 字段的节点 `syncNodePropsToYMap → yNodeToProps` deep-equal + 每个 object 字段 typeof==='object' 断言
- **0** 写侧 / awareness / room / session 改动

#### 4.1.4 成功标准 + Tauri ACK

1. guard 单测绿;`bun run check` 全绿;零回归
2. **Tauri 实测(用户主导)**:两端(两窗口/两机)加入同一 room,A 端给节点配 binding/event/docState/supabaseConfig → B 端实时收到且**是对象**(binding 面板正常显示、保存 .fig 正确、preview 编译正常),非字符串损坏

#### 4.1.5 工作分解(~0.5 day)

| Step | 任务 | commit |
|---|---|---|
| 0 | §4.1 设计 doc | `docs(lowcode): §4.1 lowcode-aware collab sync — detailed design` |
| 1 | YJS_JSON_FIELDS +7 + guard 测试 + Tauri ACK + §4.1.8 + close | `fix(lowcode): §4.1 round-trip lowcode fields through Yjs collab sync` |

#### 4.1.6 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 漏某个 object 字段 | 中 | guard 测试从节点自身推导 object 字段(决 d),非硬编码 |
| 已双重编码的旧 IndexedDB 数据 | 低 | collab room 短生命周期 + IndexedDB 是本地缓存;新 room 不受影响 |
| 改 base 共享常量影响非 lowcode 文档 | 低 | 只**增**白名单成员,非 lowcode 文档不带这些字段 → `Object.entries` 不产出 → 无行为变化 |

#### 4.1.8 Post-mortem

**§4.1 closed 2026-05-30**(无 live 两-client 环境 → 用单进程两端集成测试替代验证;零回归)。修复 lowcode 字段在协作同步中的静默损坏,是 §4 协作方向的第一刀。

#### Commit 链(设计 + fix + 集成测试)

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `c8506dd` | 决 a 扩白名单 + guard(AskUserQuestion 锁);实测坐实 `yNodeToProps(...).bindings` 是 `string` |
| fix | `64f068a` | `YJS_JSON_FIELDS` +7 lowcode 字段 + guard 单测(节点带全 lowcode 字段 write→read deep-equal)|
| 集成测试 | `b8e8556` | 单进程两端模拟(两 SceneGraph 共享一 Y.Doc,A `syncNodeToYjs` → B `applyYjsToGraph` 落对象)|
| close | _this commit_ | §4.1.8 + memory + close |

#### 验证(无 live 两-client,经验 K boundary)

用户两端都开不了 live client。但**本 bug 根因 100% 在读侧 `yNodeToProps` transform**(不在网络/observer 接线 —— 那是基座既有且对白名单字段一直 work 的代码)→ 用两层测试覆盖:
1. **guard 单测**:`syncNodePropsToYMap → yNodeToProps` 往返,7 lowcode 字段每个 deep-equal + typeof==='object'(直接钉损坏点)。
2. **两端集成测试**:两 SceneGraph 共享一 Y.Doc(Trystero 只是把同一份 CRDT update 经 WebRTC 中继,共享 doc 忠实复现 serialize→observe→apply),A 端设 binding/event/docState → B 端经真实 `observeDeep → applyYjsToGraph → updateNode` 落地为对象。覆盖整条 app 同步路径。

live 多机 Tauri 留作部署/双机时验(同 §2.v4 邮件往返:能确定性单进程验的已验,跨进程网络层是 Trystero/Yjs 的保证非本 fork 代码)。

#### 勘察额外发现(out of §4.1 scope,记录待后续/上游)

广义 drift 检测时发现 base 还有 ~11 个非 lowcode object 字段同样往返成字符串(读侧不在白名单):`fillGeometry` / `strokeGeometry` / `dashPattern` / `gridTemplateColumns` / `gridTemplateRows` / `overrides` / `componentPropertyDefinitions` / `componentPropertyValues` / `symbolLinks` / `variantPropSpecs` / `pluginData` / `pluginRelaunchData`。这是基座既存行为(多为派生/空字段,基座 collab 容忍;`pluginData` 在 live graph 是序列化副本、保存时重生成,损坏无实际后果)→ **超出 §4.1 lowcode correctness 范围**,不在本期修(避免动基座共享编码、保持与上游可合并)。guard 测试因此收窄到 lowcode 字段,不耦合 base 决定。若后续要彻底治本(决 b/c 的结构对称编码),是独立的 base/上游议题。

#### 经验印证 / 新增

- **H(Tauri/真实路径照出测试漏的洞)的"前置版"**:这个洞不是 Tauri 实测照出的,是**勘察现状时静读 write/read 对称性 + 一个 5 行往返实测**照出的(经验 C/K:别基于推断,跑一遍)。比 §2.v3 的 import-gate 洞(Tauri 才暴露)更早被接住 —— 因为转入新模块(collab)时先做了「写/读对称性」的针对性勘察。**教训:接手既有子系统做 fork 适配时,先核对该子系统的「序列化/反序列化对称性」对 fork 新增字段是否成立** —— 白名单/schema 驱动的双向转换是 fork 字段最易被漏的一类。
- **K boundary**:live 两-client 不可得 → 不假装能跑,改用「单进程共享-doc 两端模拟」做确定性验证 + 明确标注跨进程网络层留部署验。同 §3.v8(PostgREST RLS)/ §2.v4(邮件往返)。
- **fork-vs-upstream 边界判断**:发现 base 同类隐患(11 字段)时,克制只修 lowcode scope、不动基座共享编码 —— 保持 fork 与上游可合并是 lowcode fork 的长期约束(见 §2.v3 决 a 同类考量)。

---

## §5 部署管线(设计 2026-05-30)

转产品级方向第二刀。§4 协作给了「多人编辑/运行同一 lowcode app」,但 app 始终活在编辑器 preview 的 iframe 里(本端 sidecar dev-server)。§5 把 compiler emit 的项目变成**可上线的部署产物 + 托管**。**双赢**:§4.x 的真双端/运行态验证本就需真部署 → §5 解锁全部 §4.x 双机 ACK。依赖 §2 Supabase(已就位)。**吸收 §4.3**(自建信令+TURN)作为 follow-up(本刀公共 broker 已够双机 ACK)。

#### §5.1 现状勘察(静读真源 + probe 坐实,经验 C/E/K)

1. **可构建产物已存在。** `compile()`(`packages/compiler/src/index.ts`)产出 `Map<path, content>` = 完整 Vite+React+TS 项目;`buildPackageJson`(`project.ts`)写的 `package.json` 已带 `dev`/`build`(`tsc --noEmit && vite build`)/`preview` 脚本。CLI `compile` 命令(`packages/cli/src/commands/compile.ts`)`devMode:false`(干净无 canvas↔preview bridge)把它写盘 → 用户手动 `npm install && npm run build` 即得 static `dist/`。**§5 不是从零做构建,是补「源码 → 可部署产物 + 托管」这两段。**
2. **lowcode app = 纯 client SPA + Supabase 后端**(emit 零服务端;数据/认证全走 `@supabase/supabase-js` 直连)→ **天然静态可托管**。
3. **Supabase config 编译期内联进源码**(`lowcode-supabase.ts`:`createClient(${JSON.stringify(url)}, ${JSON.stringify(anonKey)})`),非 env。anonKey 本就 public(Supabase 设计)→ 内联可接受;多环境 env 注入 = follow-up。
4. **preview sidecar = Vite `createServer`(dev/HMR,in-memory VFS,Tauri plugin-shell 起 `dev-server.ts`)**。**无 `vite build` 路径** → 这是 §5.1 要补的核心。
5. **§4.3 信令/TURN**(`src/app/collab/room.ts`):`TRYSTERO_APP_ID='openpencil'` + 公共 MQTT broker(`trystero/mqtt`)+ openrelay 免费 TURN。**编辑器侧链,不进 emit 产物**;双机 ACK 用公共 broker 已可跑 → 自建留 follow-up。
6. **VFS build probe 坐实(经验 K)**:编程式 Vite `build()` + 复用 dev-server 的 in-memory VFS plugin + workspace hoisted `node_modules` → **零 npm install** 产 static dist(`index.html` + hashed `assets/*.js`/`*.css`)。Tailwind `@tailwindcss/vite` 在 build 路径正常(CSS 含 `@source inline` utilities)。build 须显式 `rollupOptions.input` 指 VFS-prefixed `index.html`(无盘上 html 可自动发现)。

#### §5.2 关键决定(8 主 + 次默)

**决定 a = 四个真岔口,AskUserQuestion 锁定 2026-05-30**:
- ① §5.1 首刀范围 = **构建产物路径**(`vite build` → static dist;托管/PaaS 集成留下一刀,同 §4 最小可验节奏)。
- ② 部署目标形态 = **静态 SPA 托管**(匹配 emit 零服务端产物,最简可验)。
- ③ Supabase config 注入 = **首刀保持内联**(anonKey public、零新工作、当前行为),env-based 留 follow-up(碰 emit 热路径,fork 可合并性,经验新-4)。
- ④ §4.3 信令/TURN = **暂用公共 broker**(已能跑双机 ACK),自建/托管留 follow-up(解耦首刀)。

下表 b–h 在锁定的「构建产物路径 / 静态 SPA」范围内展开。

| # | 决定(首刀) | 理由 |
|---|---|---|
| b | **build = 编程式 Vite `build()` + 复用 VFS plugin(probe 坐实),非写盘+npm install** | 与 dev-server 架构对称(经验 E);零网络/零 install 延迟;同源依赖解析(workspace hoisted node_modules)|
| c | **抽共享 VFS module** `packages/compiler/src/vfs.ts`:`inMemoryVFS` + `lookupFile`/`stripQuery`/`resolveRelative` + `PreviewFiles` 类型,dev-server + build 共享 import | 经验 A(dedup helper,jscpd 零 clone):build 复制 VFS 逻辑必撞 jscpd;单点收口 |
| d | **build 入口 = `rollupOptions.input` 指 VFS-prefixed `index.html`**(probe 坐实) | build 无盘上 html 可发现,须显式 input |
| e | **输出 = 写真实 `outDir`(磁盘),CLI 首消费者** | dist 含 hashed binary assets → 真实目录比 Map 自然;与 CLI compile「写盘」一致;editor 侧「导出已构建 app」按需读回(follow-up)|
| f | **CLI 新增独立 `build` 命令**(`bun open-pencil build <file> -o <dir>`),非 `compile --build` flag | 语义清晰:`compile`=源码、`build`=可部署产物;沿 `compile.ts` 结构(citty + agentfmt + `--json`)|
| g | **`devMode:false` 强制**(同 CLI compile) | 部署产物不带编辑器 canvas↔preview bridge(干净分发物)|
| h | **0 scene-graph / 0 kiwi / 0 emit-内容改动**;首刀纯加 build 路径(VFS 抽离 + build wrapper + CLI 命令) | emit 内容是已闭 §1-§4 scope;首刀聚焦「源码→产物」编译步;保持 fork 可合并(经验新-4)|

**次默(8)**:① build 失败(类型错/缺依赖)→ 结构化错误回传,CLI 非零退出 + stderr 尾,不静吞(经验 C no-swallow);② CLI `-o` 指项目根,Vite 默认 `dist/` 落其下;③ base path 默认 `/`(根托管),子路径(`--base /app/`)留 follow-up;④ Tailwind:emit 的 `@source inline(...)` 已含全部用到 class(probe 坐实 build 下 utilities 正常)→ 无需额外 safelist;⑤ sourcemap 默认关(分发物精简),`--sourcemap` 留 follow-up;⑥ 多页 = client-side BrowserRouter → 静态托管需 SPA fallback(所有路径回 `index.html`)→ 文档注明,`_redirects`/`vercel.json` 生成留 follow-up;⑦ build 复用 dev-server 的 `.preview-root` scanRoot(deps 解析),但一次性、无 watcher;⑧ 产物纯 static dist(无 node_modules/package.json),可直接丢 CDN。

#### §5.2 三问题反向核(经验 J)

- **Q1 技术链**:`compile(graph, {devMode:false})` → `Map` → `buildPreviewProject({files, outDir})` 内 Vite `build()`(input=VFS html,plugins=[vfs, react, tailwind])→ static dist 写 `outDir` → CLI 报告文件清单。**新增一条独立编译步**,不碰 emit 内容 / dev-server HMR 路径。已 probe 坐实(经验 K)。
- **Q2 浮现**:CLI 输出 build 后 dist 文件清单 + 大小(沿 compile 的 `fmtList`)+「Next: 部署 `dist/` 到静态托管」提示;失败 → 结构化错误浮现(次默 ①)。`--json` 支持(CLI 惯例)。
- **Q3 心智模型**:用户期望「一条命令把设计变成可上线的网站文件夹」。产物 = 纯 static dist,可直接拖到 Netlify/CF Pages。须明确:(a) 多页是 client-side 路由 → 托管需 SPA fallback(次默 ⑥ 文档);(b) Supabase 配置内联在产物里(anonKey public 可接受,Q3 文案点明);(c) 这是「**构建**」非「**托管**」—— 上线仍需用户自行推到托管(首刀边界,托管集成 = follow-up)。

#### §5.3 公开 API / 类型(首刀)

```ts
// packages/compiler/src/vfs.ts(新,抽自 dev-server)
export type PreviewFiles = Map<string, string | Uint8Array>
export function inMemoryVFS(state: { files: PreviewFiles }, vfsPrefix: string): Plugin
// + lookupFile / stripQuery / resolveRelative(纯函数,单测可验)

// packages/compiler/src/build.ts(新)
export interface BuildOptions {
  files: PreviewFiles      // CompilerOutput.files(devMode:false)
  outDir: string           // 真实目录,写 static dist
  fsRoot?: string          // workspace root,npm 解析,默认 process.cwd()
  base?: string            // public base path,默认 '/'
}
export interface BuildResult {
  outDir: string
  files: string[]          // dist-relative 写出路径
}
export async function buildPreviewProject(opts: BuildOptions): Promise<BuildResult>
```

- `packages/compiler/package.json` exports 加 `./build`(镜像 `./dev-server`)。
- `packages/cli/src/commands/build.ts`(新):`build` 命令,`-o`/`--package-name`/`--page`/`--json`(沿 compile)。

#### §5.4 改动清单(首刀)

- ➕ `packages/compiler/src/vfs.ts`:抽共享 VFS plugin + helpers
- 🔁 `packages/compiler/src/dev-server.ts`:改 import 共享 VFS(删本地副本,emit 字节零变)
- ➕ `packages/compiler/src/build.ts`:`buildPreviewProject`(Vite `build()` + VFS)
- 🔁 `packages/compiler/package.json`:exports 加 `./build`
- ➕ `packages/cli/src/commands/build.ts`:`build` 命令
- 🔁 CLI 命令注册(`packages/cli/src/` main/registry)
- ➕ 单测 `tests/engine/compiler/vfs.test.ts`:`lookupFile`/`resolveRelative`/`stripQuery` 正负例(经验 K:纯函数确定性单测);可选 smoke build 测(最小 Map → dist 存在,标注慢)
- **0** scene-graph / kiwi / emit-内容

#### §5.5 成功标准 + ACK(经验 K boundary)

- **单端可验**:`vfs.ts` 纯函数正负例单测;`bun open-pencil build <fixture> -o /tmp/out` → `dist/index.html` + `assets/*.{js,css}` 存在 + CLI 文件清单;`bun run check` 0 error / 0 clone;dev-server preview 单端仍 ready(VFS 抽离零回归)。
- **部署 ACK(留)**:dist 推静态托管(CF Pages/Netlify)→ app 跑起来,Supabase 数据/认证可用,多页 SPA fallback 工作。**这一步同时解锁 §4.x 双机 ACK**(真部署/真双端)。

#### §5.6 工作分解(~中,3 step)

| Step | 任务 | commit 前缀 |
|---|---|---|
| 0 | §5 设计 doc + 四岔口 AskUserQuestion 锁 + VFS build probe | `docs(lowcode): §5 deployment pipeline — detailed design` |
| 1 | 抽共享 `vfs.ts`(dev-server 改 import)+ 纯函数单测 | `refactor(compiler): §5 step 1 — extract shared in-memory VFS` |
| 2 | `buildPreviewProject`(Vite build wrapper)+ `./build` export + smoke 测 | `feat(compiler): §5 step 2 — static build via in-memory VFS` |
| 3 | CLI `build` 命令(citty + agentfmt + --json)+ close | `feat(cli): §5 step 3 — `build` command emits deployable dist` |

#### §5.7 风险(首刀)

| 风险 | 影响 | 缓解 |
|---|---|---|
| Vite/Tailwind 版本漂移致 build 失败 | 中 | probe 已坐实当前版本可用;CLI 端到端 smoke 接住;失败结构化浮现(次默 ①)|
| 抽 VFS 重构破 dev-server | 中 | 纯函数单测 + dev-server preview 单端仍验;emit 字节零变 |
| 多页 SPA fallback 托管配置缺失 → 刷新 404 | 中 | 文档注明(次默 ⑥);fallback 配置生成留 follow-up |
| build 慢测拖 CI | 低 | 纯函数单测为主;smoke build 最小化/标注;不进 `bun test ./tests/engine/` 全跑 |
| Supabase 内联进产物(Q3) | 低 | anonKey public 可接受;Q3 文案点明,敏感配置勿放 |

#### §5.8 Post-mortem(进行中 — 代码完成,待部署 ACK)

**§5.1 首刀代码完成 2026-05-30**(单端检查全绿:`bun run check` 0 error / **0 clone** / 8 locale 同步 / Steiger 通过;`vfs.test.ts` 14 纯函数测 + `build.test.ts` 1 端到端 smoke;compiler 401 测零回归)。**四岔口 AskUserQuestion 锁 = 构建产物路径 / 静态 SPA / Supabase 内联 / 公共 broker**。**VFS build probe 坐实**(经验 K):编程式 Vite `build()` + 复用 VFS plugin + workspace hoisted deps → static dist,零 npm install。CLI `build` 端到端验过真 fixture(`lowcode-v6-test.fig` → `index.html` + hashed `assets/*.{js,css}`,exit 0,`--json` stdout 纯净)。

**Surprise / 经验印证:**
- **经验 A 钉子打晚了**:step 2 commit 时只跑了 `bun test compiler` + `tsgo`(没跑全 `bun run check`)→ 漏了 `build.ts`↔`dev-server.ts` 的 scanRoot/tsconfig-plant clone(jscpd 只在全 `check` 跑)。step 3 加 CLI 命令时又引入 `build.ts`↔`compile.ts` clone,全 `check` 一次性照出两处。**教训:每个 step commit 前跑全 `bun run check`(含 jscpd),别用「per-step 子集测」替代** —— 跨文件 clone 子集测看不见。dedup 收口:`vfs.ts` 加 `prepareVfsRoot`/`VITE_JSX_ESBUILD`(compiler 侧)+ `cli/codegen.ts` 加 `loadAndCompile`/`reportCodegenResult`(CLI 侧)。
- **经验 C 印证(勘察先于推断)**:勘察坐实 emit 产物**已可构建**(CLI compile + package.json build 脚本),§5.1 不是从零做构建,只补「编程式 build 路径」——避免了「重造 emit/build」的过度设计。
- **经验 E 印证**:build 路径完全镜像 dev-server 架构(同 VFS plugin / 同 scanRoot / 同 JSX 覆盖)→ 抽共享模块天然,且坐实「dev `createServer` 与 `build` 共用一个 VFS plugin」可行(`configureServer` 在 build 下是 no-op)。
- **build vs dev-server stderr 不对称(记录)**:dev-server `createServer` 路径有 vite-v8/rolldown 的 `Invalid key: jsx` / `Rolldown panicked` optimizeDeps 噪声(**pre-existing**,esbuild 配置抽离前后字节相同,preview 由 §4.x Tauri 实测覆盖);**build 路径 stderr 全净**(`vite build` 不走 optimizeDeps depscan)→ 我的 §5 deliverable 路径干净,非回归。

#### Commit 链(设计 + 3 step;close 待部署 ACK)

| Step | Commit | 内容 |
|---|---|---|
| 设计 | `462a749` | §5 全文(§5.1 勘察 + 四岔口 AskUserQuestion 锁 + VFS build probe)|
| step 1 | `f9a08f5` | 抽共享 `vfs.ts`(`inMemoryVFS` + `lookupFile`/`resolveRelative`/`stripQuery`,dev-server 改 import,emit 字节零变)+ `./vfs` export + 纯函数单测 |
| step 2 | `dbfb346` | `buildPreviewProject`(Vite `build()` + VFS,probe 坐实)+ `./build` export + 端到端 smoke 测 |
| step 3 | `dd2d58e` | CLI `build` 命令(citty + agentfmt + `--json` + `--base`)+ dedup 收口(`cli/codegen.ts` + `vfs.ts` 共享 `prepareVfsRoot`/`VITE_JSX_ESBUILD`)+ close |

#### 单端可验 / 部署留验(经验 K boundary)

- **单端可验(已绿)**:`vfs.ts` 纯函数正负例(14 测);`buildPreviewProject` smoke(最小 Map → dist:`index.html` + hashed `assets`);CLI `build` 端到端真 fixture(human + `--json`);dev-server CLI 仍 `ready`(VFS/scanRoot 抽离零回归)。
- **部署留验(经验 K)**:dist 推真实静态托管(CF Pages/Netlify)→ app 跑起来,Supabase 数据/认证可用,多页 client-side 路由配 SPA fallback 工作。单进程/单端验不了真托管 HTTP/路由 fallback。**这步同时解锁全部 §4.x 双机 ACK**(真部署/真双端)。
- **诚实边界**:① Supabase config 内联进产物(anonKey public 可接受,Q3 文案点明);② 多页需托管侧 SPA fallback(次默 ⑥,fallback 配置生成留 follow-up);③ base 默认 `/`(子路径 `--base` 已留 flag);④ build 复用 workspace hoisted deps(零 npm install)—— 产物本身纯静态,但 build 步依赖编辑器 workspace 在场(CLI 是 workspace 内消费者,符合预期)。

#### §5 follow-up(派生)

- **托管集成**(CF Pages/Netlify/Vercel API 一键推);**Supabase env 注入**(③ 解锁多环境);**§4.3 自建信令+TURN**(④);**`--base` 子路径托管**;**SPA fallback 配置生成**(`_redirects`/`vercel.json`);**`--sourcemap` flag**;**editor 侧「导出已构建 app」UI**(读回 Map → 下载/保存)。

### §5 第二刀 — 托管集成(Netlify direct-upload,设计 2026-05-30)

§5.1 给了可部署静态 dist;第二刀把「dist → 上线 URL」这段接上。**接 §5.1 follow-up「托管一键推」+「SPA fallback 配置生成」两条。**

#### 现状勘察(经验 C/E,静读真源)

- **零既有部署代码**;CLI deps 极简,**Bun 有全局 `fetch`**(`packages/cli/src/app-client.ts` 已用 `fetch` + `Authorization: Bearer` 模式 RPC),无需引 HTTP 库;CLI 目前不读 env。
- **§5.1 `buildPreviewProject` 已产出真实 dist 目录**(`index.html` + hashed `assets`)→ 部署 = build + 把目录文件推到 provider。
- **lowcode app = 纯静态 SPA**(零服务端,Supabase 直连)→ 任一静态托管可用;**多页 = client-side BrowserRouter → 需 provider SPA fallback**(Netlify `_redirects` 的 `/* /index.html 200`)。
- **Netlify Deploy API = 最简纯 HTTP 摘要上传流**(无需装 CLI):① (可选)`POST /api/v1/sites` 建站 → `{id}`;② `POST /api/v1/sites/{site}/deploys` 带 `{files:{"/path":sha1,…}}` → 响应 `{id, required:[sha1…]}`(服务端缺失的摘要集);③ 对每个 sha1∈required 的文件 `PUT /api/v1/deploys/{deploy}/files/{path}` 原始字节;④ URL = `deploy.ssl_url`。摘要/清单/上传循环**可 mock fetch 确定性单测**;真上传留 deploy ACK(经验 K)。

#### 关键决定(8 主 + 次默)

**决定 a = 三个真岔口,AskUserQuestion 锁定 2026-05-30**:① provider 首target = **Netlify**(Deploy API 最简纯 HTTP,其它 provider 留 follow-up);② 上传机制 = **直连 provider HTTP API**(fetch + bearer,零外部 CLI 依赖,请求构造可 mock 单测);③ 暴露面 = **CLI `deploy` 命令 + editor UI 都做**。

| # | 决定 | 理由 |
|---|---|---|
| b | **单一 deploy 实现**:共享 `packages/compiler/src/deploy.ts`(`deployFiles(files, target, {onProgress})`,Netlify 摘要上传),CLI `deploy` 命令消费它;**editor UI 经 plugin-shell spawn 同一个 `open-pencil deploy` 命令**(同 preview sidecar 模式),不复制 deploy 逻辑 | 经验 A:一条 deploy 管线、零 clone;editor 复用整条 CLI build+deploy,UI 仅 token 弹窗 + spawn + 进度流 + 结果链接 |
| c | **`deploy.ts` 浏览器安全**:只用 `fetch` + Web Crypto `crypto.subtle.digest('SHA-1')`(Bun+浏览器皆有),不 import vite/node-only | 保持可在 editor 直连复用的余地(虽首刀 editor 走 spawn);SHA1 hex 跨端一致 |
| d | **CLI `deploy` = build(§5.1)→ 读 dist 回 Map → `deployFiles`**;build 到临时目录 → 读回字节 | 复用 §5.1 `buildPreviewProject` 整条;dist 含 binary → 从目录读回 `Uint8Array` |
| e | **SPA fallback `_redirects` 在 deploy 时注入**(Netlify 路径若 dist 无 `_redirects` 则补 `/* /index.html 200`),**不进 build** | provider-specific 配置归 provider deploy 路径;build 保持 provider-agnostic(决 §5.1 h 边界) |
| f | **auth = `--token` flag 或 `NETLIFY_AUTH_TOKEN` env**(flag 优先);token 永不落盘/不进产物 | 沿 app-client.ts bearer 模式;CLI 惯例;editor 弹窗输入 token 透传给 spawn 的 env(不写文件)|
| g | **site:`--site <id\|name>` 指定已有站;缺省则建新站**(`POST /sites`,可带 name)| 首次部署零预备(自动建站);重部署指 `--site` 复用 |
| h | **0 scene-graph / kiwi / emit-内容改动**;新增仅 `deploy.ts` + CLI `deploy` 命令 + editor 部署 UI(spawn 封装) | 同 §5.1:聚焦「dist → 托管」这段,不碰已闭的 emit/build scope;保持 fork 可合并(经验新-4)|

**次默(8)**:① 部署失败(401/网络/必填缺)→ 结构化错误回传,CLI 非零退出 + 信息,不静吞(经验 C);② `--json` 输出 `{url, deployId, provider, fileCount}`(CLI 惯例);③ 进度经 `onProgress(stage, done/total)` 回调,CLI 打印阶段、editor 显进度条;④ `_redirects` 已存在(用户自带或将来 build 生成)则不覆盖;⑤ 大文件/多文件上传**串行 PUT**(首刀简单,可并发化留 follow-up);⑥ editor 部署需已保存文档路径(脏/未存 → 先走现有保存流);⑦ deploy 仅上传 dist 静态文件,不上传源码/node_modules;⑧ token 来源优先级 flag > env,二者皆无 → 明确报错指引(不静默)。

#### 三问题反向核(经验 J)

- **Q1 技术链**:CLI `deploy` → `loadAndCompile`(复用)→ `buildPreviewProject`(§5.1,临时 dir)→ 读 dist 回 Map → `deployFiles`(注 `_redirects` → SHA1 清单 → POST deploy → PUT required → 返 URL)。editor → plugin-shell spawn `open-pencil deploy <file> --token … --json` → 解析 NDJSON/JSON 进度+结果。**复用 §5.1 build + app-client bearer 模式 + preview sidecar spawn 模式**,无新链路类型。Netlify 请求构造按文档,真 API 形状留 deploy ACK 核(经验 K)。
- **Q2 浮现**:CLI 打印 build→upload 阶段 + 最终 URL + `--json`;editor 进度条 + 部署完成 toast/链接(可复制/打开)。失败结构化浮现(次默 ①⑧)。
- **Q3 心智模型**:用户期望「点一下/一条命令 → 拿到公开 URL」。须明确:(a) 首次自动建站、重部署指 `--site`(决 g);(b) 多页 SPA fallback 自动注入(决 e),刷新不 404;(c) 需 Netlify token(决 f 报错指引);(d) Supabase config 已内联在产物(§5.1 Q3,anonKey public);(e) editor 部署用当前已保存文档(次默 ⑥)。

#### 公开 API / 类型

```ts
// packages/compiler/src/deploy.ts(新,fetch + Web Crypto,浏览器安全)
export interface DeployTarget {
  provider: 'netlify'
  token: string
  /** existing site id or name; omit to create a new site. */
  site?: string
}
export interface DeployResult {
  provider: string
  url: string
  deployId: string
  fileCount: number
}
export interface DeployProgress {
  stage: 'digest' | 'create' | 'upload' | 'done'
  done?: number
  total?: number
}
export async function deployFiles(
  files: Map<string, string | Uint8Array>,
  target: DeployTarget,
  opts?: { onProgress?: (p: DeployProgress) => void }
): Promise<DeployResult>
```

- `packages/compiler/package.json` exports 加 `./deploy`(镜像 `./build`)。
- `packages/cli/src/commands/deploy.ts`(新):`deploy` 命令(`--token`/`--site`/`--page`/`--base`/`--json`)。
- editor:部署按钮 + token 弹窗 + plugin-shell spawn `open-pencil deploy`(`src/app/lowcode/` 下,Tauri-only)。

#### 改动清单

- ➕ `packages/compiler/src/deploy.ts`:`deployFiles`(Netlify 摘要上传 + `_redirects` 注入 + SHA1 + onProgress)
- 🔁 `packages/compiler/package.json`:exports 加 `./deploy`
- ➕ `packages/cli/src/commands/deploy.ts`:`deploy` 命令(build → 读 dist → deployFiles)
- 🔁 CLI 注册 `deploy`(`packages/cli/src/index.ts`)
- ➕ editor 部署 UI + spawn 封装(Tauri-only,复用 preview sidecar spawn 模式)+ i18n
- ➕ 单测 `tests/engine/compiler/deploy.test.ts`:mock fetch —— SHA1 hex 正确;清单 `{files:{"/p":sha}}` 形状;`required` → PUT 循环只传缺失;`_redirects` 注入(缺则补/有则不覆盖);401/网络错误结构化抛;onProgress 阶段序列
- **0** scene-graph / kiwi / emit-内容

#### 成功标准 + ACK(经验 K boundary)

- **单端可验**:`deploy.test.ts`(mock fetch 全流程 + SHA1 + `_redirects` + 错误);CLI `deploy --json` 形状(mock/dry-run);`bun run check` 0 error/clone/locale 同步。
- **Deploy ACK(留)**:真 Netlify token → `open-pencil deploy <fixture> --token …` → 拿到 live URL,app 跑、Supabase 可用、多页刷新不 404(`_redirects` 生效);**editor UI 一键部署(Tauri ACK)**。这步同时是 §5.1 + §4.x 双机的真部署验证场。

#### 工作分解(~中-大,3 step + 设计 + close)

| Step | 任务 | commit 前缀 |
|---|---|---|
| 0 | §5 托管集成设计 + 三岔口 AskUserQuestion 锁 | `docs(lowcode): §5 hosting integration — detailed design` |
| 1 | `deploy.ts`(Netlify 摘要上传 + `_redirects` + SHA1 + onProgress)+ `./deploy` export + mock-fetch 单测 | `feat(compiler): §5 step 4 — Netlify direct-upload deploy core` |
| 2 | CLI `deploy` 命令(build → 读 dist → deployFiles,token/site/json)+ 注册 | `feat(cli): §5 step 5 — `deploy` command (build + push to Netlify)` |
| 3 | editor 部署 UI(token 弹窗 + plugin-shell spawn `deploy` + 进度/结果)+ i18n + close | `feat(app): §5 step 6 — one-click deploy from the editor` |

#### 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| Netlify API 真实形状与文档偏差(required 语义/PUT 路径/URL 字段) | 中 | mock 单测钉请求构造;真形状留 deploy ACK 核(经验 K,无 token 单进程探不了);结构化错误不静吞 |
| token 泄露(落盘/进产物/日志) | 高 | 决 f:flag/env-only,永不写文件;editor 经 spawn env 透传不持久化;不打印 token |
| editor build 子进程(vite 仅 bun)| 中 | 决 b:editor spawn 整条 CLI `deploy`(CLI 内跑 build),不在浏览器建;同 preview sidecar 已验模式 |
| 多页刷新 404(无 fallback)| 中 | 决 e:deploy 注入 `_redirects`;deploy ACK 验刷新 |
| 上传慢测/网络进 CI | 低 | 单测全 mock fetch;无真网络;真上传仅 deploy ACK 手动 |

#### Post-mortem(进行中 — 代码完成,待 deploy/Tauri ACK)

**托管集成代码完成 2026-05-30**(单端检查全绿:`bun run check` 0 error / **0 clone** / locale 同步 / Steiger 通过;`deploy.test.ts` 8 mock-fetch 测;compiler 409 测零回归)。**三岔口 AskUserQuestion 锁 = Netlify / 直连 HTTP API / CLI + editor UI 都做**。

**Commit 链(设计 + 3 step + close):**
| Step | Commit | 内容 |
|---|---|---|
| 设计 | `c39c42b` | §5 托管全文 + 三岔口锁 |
| step 4 | `692bdf3` | `deploy.ts`:Netlify 摘要上传(SHA1 清单→`required`→PUT 缺失)+ `_redirects` 注入 + 建站回落 + onProgress;`./deploy` export;8 mock-fetch 单测 |
| step 5 | `1ad2cd4` | CLI `deploy` 命令(`loadAndCompile`→`buildPreviewProject`→读 dist→`deployFiles`);`--token`/env/`--site`/`--json`;临时 dir `finally` 清 |
| step 6 | `7fb5b2a` | editor 一键部署(`DeployControls.vue` + `use-deploy.ts` spawn 同一 CLI;token 经 spawn env;`getDocumentPath()` 暴露)|
| close | _本 commit_ | post-mortem + CHANGELOG |

**Surprise / 经验印证:**
- **单一 deploy 管线落地(经验 A 升级)**:本欲 editor 侧另写 build+upload,但 build 是 bun-only(vite)→ 浏览器跑不了。改为 **editor spawn 同一个 `open-pencil deploy` CLI**(与 preview sidecar 同 spawn 模式)→ 一条 deploy 实现、零重复、editor 仅 token 弹窗 + spawn + 结果。**Tauri 复用坐实:`shell:allow-spawn` 的 `lowcode-preview`(`cmd:bun, args:true`)可直接跑 CLI,零新 capability。**
- **complexity 阈值(本地内修)**:`deployFiles` 初版 cyclomatic 23>20 → 抽 `digestFiles`/`resolveSite`/`createDeploy`/`uploadRequired` 四 phase helper;单成员 `provider` union 守卫触发 `no-unnecessary-condition` → 移除(多 provider follow-up 再 dispatch)。同 §5.1 经验:每 step 前跑全 `check`(本 step 一次性照出,未漏到下一 step)。
- **i18n 对齐既有(经验 E)**:设计写「+ i18n」,但静读 PreviewPane 发现**整个 preview pane 用硬编码英文、无 i18n**;deploy UI 随之用 plain 英文(match 兄弟代码),省掉 8-locale churn —— 代码现实覆盖设计假设(同 §5.1「勘察先于推断」)。
- **安全:token 不落盘/不入 arg(经验 新-3 同源)**:token 仅 component 内存 + spawn env(非 `--token` arg,避免 `ps`/日志泄露),CLI 侧也不打印。

**单端可验 / ACK 留验(经验 K boundary):**
- **单端可验(已绿)**:`deploy.test.ts` mock-fetch 全流程(SHA1/清单/required-PUT/`_redirects`/401/缺 token/进度);CLI `deploy` 端到端真跑(build→读 dist→Netlify API,bogus token→结构化 401,exit 1);no-token 路径报错指引;`bun run check` 0 error/clone。
- **Deploy ACK(留)**:真 Netlify token → `open-pencil deploy <fixture>` → live URL,app 跑、Supabase 可用、多页刷新不 404(`_redirects` 生效);**editor 一键部署按钮(Tauri ACK)**。这步同时是 §5.1 + §4.x 双机的真部署验证场。
- **诚实边界**:① Netlify 真实 API 形状(`required` 语义/PUT 路径/`ssl_url` 字段)按文档,留 ACK 核;② editor 部署 Tauri-only(同 preview sidecar,需 bun + repo 在场)且需已保存 .fig 路径;③ Netlify 之外 provider + 并发上传 + token keychain 留 follow-up。

#### §5 托管 follow-up(派生)

- 多 provider(CF Pages / Vercel,各自 fallback 配置);并发上传;site 列表/选择 UI;自定义域名;部署历史;deploy hooks/CI;Supabase env 注入与多环境部署联动;editor 内置 token 安全存储(keychain)。

### §5 第三刀 — Supabase env 注入(设计 2026-05-30)

接 §5.1 fork ③(当时 deferred)。托管做完后暴露:Supabase config 编译期内联进产物 → 一份 build 没法切 preview/staging/prod 库。本刀让 emit 走 `import.meta.env`,产物可按环境注入。

#### 现状勘察(经验 C/E + probe 坐实)

- `buildLowcodeSupabaseRuntime`(`lowcode-supabase.ts`)现 emit `createClient(JSON.stringify(url), JSON.stringify(anonKey))` —— 设计期值**硬编码**进 `src/_lowcode_supabase.ts`。
- 该文件仅在 `maybeEmitLowcodeSupabaseRuntime`(`adapters/react/index.ts`)`config` 在场时 emit(`pageUsesSupabase` 门控)。
- preview dev-server `envFile:false`(不读 `.env`);我方 build(`buildPreviewProject`)用 VFS,Vite 的 `loadEnv` 读磁盘 `envDir`、不读 VFS 里的 `.env`,也不读 `process.env` 的 `VITE_*` → **env 必须经 Vite `define` 注入**才能进我方 build/preview。
- **probe 坐实(经验 K)**:emit `import.meta.env.VITE_SUPABASE_URL ?? 'FALLBACK'`,(a) 无 define → 产物含 `FALLBACK`(回落,preview/build 行为不变);(b) `define:{'import.meta.env.VITE_SUPABASE_URL':'"OVERRIDE"'}` → 产物含 `OVERRIDE`、回落被 DCE。两路皆验。
- 标准独立导出(CLI `compile` → 用户自己 `npm run build`):Vite 原生读 `.env` → `import.meta.env.VITE_*` 生效(无需 define)。`tsc --noEmit`(独立 build 脚本)需 `import.meta.env` 类型 → 须 emit `src/vite-env.d.ts`(`/// <reference types="vite/client" />`)。

#### 关键决定(8 主 + 次默)

**模式非真岔口(probe 定死)**:`import.meta.env.VITE_SUPABASE_*` **带设计期回落**(`?? <inline>`)。**纯 env(无回落)被否**(破 preview,除非额外注入);**opt-in flag(inline|env 双路)被否**(双码路、违 fork 可合并克制)。回落 = preview/build 零注入照跑 + anonKey 本就 public,设计期值作默认无泄露。

| # | 决定 | 理由 |
|---|---|---|
| a | emit `createClient(import.meta.env.VITE_SUPABASE_URL ?? <json url>, import.meta.env.VITE_SUPABASE_ANON_KEY ?? <json anonKey>)` | probe 坐实回落 + override 双路;设计期值留作默认 |
| b | **设计期值烤进回落**(非省略) | preview/我方 build 零注入照跑(回落);anonKey public,无泄露 |
| c | emit `src/vite-env.d.ts`(`vite/client` 引用),仅 supabase 在场时 | 独立 `tsc --noEmit && vite build` 需 `import.meta.env` 类型 |
| d | emit `.env.example`(`VITE_SUPABASE_URL=`/`VITE_SUPABASE_ANON_KEY=`),仅 supabase 在场时 | 文档化两 env;独立用户 copy 成 `.env` 即多环境(Vite 原生读)|
| e | 我方 build/deploy override 经 Vite **`define`**(probe 坐实);`BuildOptions.env?:{VITE_SUPABASE_URL?;VITE_SUPABASE_ANON_KEY?}` | VFS 不读磁盘 `.env`/`process.env` VITE_*,只能 define 注入 |
| f | CLI `build`/`deploy` 加 `--supabase-url`/`--supabase-anon-key`,并回落读 `process.env.VITE_SUPABASE_URL`/`_ANON_KEY` → 传 `BuildOptions.env` | 我方管线多环境入口;flag 优先 env |
| g | **preview/dev-server 不动**(走回落,不传 define)→ 运行态与今日完全一致 | 零 preview 回归;emit 改动 scoped 在 supabase 运行时 + scaffold |
| h | 0 scene-graph / kiwi / docState 编码改动;改动仅 supabase 运行时 emit + 2 scaffold 文件 + build env + CLI flag | 同 §5.1/§5.2:scoped、保持 fork 可合并(经验新-4)|

**次默(8)**:① 无 supabase config 的文档不 emit(`vite-env.d.ts`/`.env.example` 也不出);② override 缺省(无 flag/env)→ 回落设计期值(等价今日);③ `--supabase-url` 与 `--supabase-anon-key` 可分别给(只给一个 → 另一个回落);④ `define` 仅当值在场才注入对应 key(避免误把 undefined 烤进);⑤ token/anonKey 仍是 public anonKey(非 service_role,绝不注入服务端密钥);⑥ `.env.example` 非 `.env`(不覆盖用户 `.env`,`.gitignore` 已含 `*.local`/`.env` 习惯——确认 emit gitignore 含 `.env`);⑦ build env 透传只认两 VITE_ key(不泛化任意 env,克制);⑧ deploy 复用 build 的 env 透传(deploy 内部调 build)。

#### 三问题反向核(经验 J)

- **Q1 技术链**:`buildLowcodeSupabaseRuntime(config)` → `import.meta.env.* ?? json(config.*)`;`maybeEmitLowcodeSupabaseRuntime` 顺带 emit `vite-env.d.ts`+`.env.example`;`buildPreviewProject({env})` → Vite `define`(仅在场 key);CLI build/deploy flag/env → `BuildOptions.env`。**probe 坐实回落 + define**(经验 K)。
- **Q2 浮现**:独立用户 → `.env.example` 指明两 env;CLI → `--supabase-url`/`--supabase-anon-key` help + 缺省回落(无声但符合预期=用设计期库);override 生效与否 = 部署后 app 连的库(deploy ACK 可见)。
- **Q3 心智模型**:用户期望「一份设计/build,按环境换库」。须明确:(a) 静态 SPA 的 env 是**build 期**烤进(非运行时),换环境 = 换 build 的 env,非一包通吃;(b) 不设 env → 回落设计期库(preview/默认部署照常,符合直觉);(c) 注入的是 **anon key**(public),不是 service_role;(d) 独立项目走 `.env`,我方 CLI 走 flag/env。

#### 公开 API / 类型

```ts
// buildPreviewProject (build.ts) — 加可选 env override
export interface BuildOptions {
  files: PreviewFiles
  outDir: string
  fsRoot?: string
  base?: string
  /** Build-time Supabase env override → Vite define. Omitted keys fall back to
   *  the design-time values baked into the emitted runtime. */
  env?: { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string }
}
```
- `lowcode-supabase.ts`:emit `import.meta.env.VITE_SUPABASE_* ?? <json>`。
- `adapters/react/index.ts`:`maybeEmitLowcodeSupabaseRuntime` 加 `src/vite-env.d.ts` + `.env.example`(supabase 在场)。
- CLI `build`/`deploy`:`--supabase-url` / `--supabase-anon-key`(+ `process.env.VITE_SUPABASE_URL`/`_ANON_KEY` 回落)。

#### 改动清单

- 🔁 `packages/compiler/src/adapters/react/lowcode-supabase.ts`:emit `import.meta.env.* ?? <json>`
- 🔁 `packages/compiler/src/adapters/react/index.ts`:`maybeEmitLowcodeSupabaseRuntime` emit `vite-env.d.ts` + `.env.example`
- 🔁 `packages/compiler/src/build.ts`:`BuildOptions.env` → Vite `define`(仅在场 key)
- 🔁 `packages/cli/src/commands/build.ts` + `deploy.ts`:`--supabase-url`/`--supabase-anon-key` + `process.env` 回落 → `BuildOptions.env`(deploy 透传 build)
- ➕ 测:`lowcode-supabase` emit-契约(`import.meta.env` + 回落含设计期值 + `vite-env.d.ts`/`.env.example` 在场);`build.test.ts` define-override(env 注入 → 产物含 override、回落 DCE — probe 已验,补固化测)
- **0** scene-graph / kiwi / docState 编码

#### 成功标准 + ACK(经验 K)

- **单端可验**:emit-契约测(`import.meta.env.VITE_SUPABASE_URL ?? "<设计期>"` 串 + 两 scaffold 文件);build define-override 测(env → 产物含 override);CLI build/deploy `--supabase-url` 透传(`--json`/dry 或 mock);`bun run check` 0 error/clone;preview/dev-server 回归(回落,行为不变)。
- **Deploy ACK(留)**:`open-pencil deploy <file> --supabase-url <prod> --supabase-anon-key <prod>` → 部署产物连 prod 库(≠ 设计期库);独立 `.env` 路径(用户改 `.env` → `npm run build` → 连指定库)。

#### 工作分解(~小-中,2 step + 设计 + close)

| Step | 任务 | commit 前缀 |
|---|---|---|
| 0 | §5 env 注入设计(probe 坐实回落+define)| `docs(lowcode): §5 Supabase env injection — detailed design` |
| 1 | emit `import.meta.env.* ?? 回落` + `vite-env.d.ts` + `.env.example` + emit-契约测 | `feat(compiler): §5 step 7 — Supabase config via import.meta.env` |
| 2 | `BuildOptions.env`→define + CLI build/deploy `--supabase-*`/env + define-override 测 + close | `feat(cli): §5 step 8 — per-environment Supabase override on build/deploy` |

#### 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| emit `import.meta.env` 破 preview/build(值丢)| 中 | 决 b 回落 + probe 坐实无 define 走回落;preview/dev-server 不传 define(决 g)|
| 独立 `tsc --noEmit` 缺 `import.meta.env` 类型报错 | 中 | 决 c emit `vite-env.d.ts`(`vite/client`)|
| 误注入 undefined(只给一个 flag)| 低 | 次默 ④:define 仅在场 key,另一个走回落 |
| 误以为运行时可换 env(Q3)| 中 | 决 Q3 文案:静态 SPA env 是 build 期烤进,换环境=换 build |
| service_role 误注入 | 中 | 次默 ⑤:只注 anon key(public);flag 命名 `--supabase-anon-key` 明示 |

#### Post-mortem(进行中 — 代码完成,待 deploy ACK)

**Supabase env 注入代码完成 2026-05-30**(单端检查全绿:`bun run check` 0 error / **0 clone** / locale 同步 / Steiger 通过;`supabase-auth-emit.test.ts` +4(env 回落 + scaffold + gate)+ `build.test.ts` +1 define-override;compiler 412 测零回归)。**模式 probe 定死(非 AskUserQuestion 岔口)= `import.meta.env.* ?? 设计期回落`**。

**Commit 链(设计 + 2 step + close):**
| Step | Commit | 内容 |
|---|---|---|
| 设计 | `c39c42b` 后续 | §5 env 注入全文 + probe(回落+define)|
| step 7 | `5912e25` | emit `import.meta.env.VITE_SUPABASE_* ?? <json>` + `vite-env.d.ts` + `.env.example`(supabase 在场)+ gitignore `.env*` + emit-契约测 |
| step 8 | `f4bd32b` | `BuildOptions.env`→Vite `define`(仅在场 key)+ CLI build/deploy `--supabase-url`/`--supabase-anon-key`(+ `process.env` 回落,共享 `resolveBuildEnv`)+ define-override 测 |
| close | _本 commit_ | post-mortem + CHANGELOG |

**Surprise / 经验印证:**
- **probe 先于设计定死模式(经验 K)**:`import.meta.env.X ?? fallback` 的 no-define→回落 / define→override 两路在写设计前 `bun -e` 实测坐实 → 模式不再是"岔口"(纯 env 破 preview、opt-in 双路违克制,皆被 probe 排除)→ 本刀无 AskUserQuestion(决定由约束 + probe 定死)。
- **改动碰既有 emit 测(经验 A/I)**:emit 从 `createClient("url","key")` 改为 `?? 回落` + `createClient(SUPABASE_URL, SUPABASE_ANON_KEY)` → 既有两条断言失效,同 commit 更新(没漏到下一 step,全 `check` 在 step 7 跑)。
- **VFS 不读磁盘 env(经验 C 勘察)**:静读坐实 Vite `loadEnv` 读磁盘 `envDir`、不读 VFS 也不读 `process.env` 的 VITE_* → 我方 build override 只能 `define`;独立导出走原生 `.env`。两路分明。
- **dedup 收口(经验 A)**:build/deploy 两命令的 env 解析(flag>env>设计期)抽 `resolveBuildEnv`(codegen.ts,type-only import `BuildOptions['env']` 不引 vite 运行时)→ jscpd 0。
- **安全(次默⑤)**:只注 anon key(public);flag 名 `--supabase-anon-key` 明示;绝不碰 service_role。

**单端可验 / Deploy ACK(经验 K boundary):**
- **单端可验(已绿)**:emit-契约(`import.meta.env.* ?? 设计期`、`vite-env.d.ts`、`.env.example`、gate)、`build.test.ts` define-override(override 烤进 + 回落 DCE / 无 override 回落存活)、CLI `--supabase-url` 端到端接受、preview/dev-server 回归(回落,行为不变)。
- **Deploy ACK(留)**:`open-pencil deploy <file> --supabase-url <prod> --supabase-anon-key <prod>` → 产物连 prod 库(≠ 设计期库);独立项目改 `.env` → `npm run build` → 连指定库。
- **诚实边界**:① 静态 SPA 的 env 是 **build 期**烤进,换环境 = 换 build(非一包通吃运行时切换);② 我方 VFS build 经 `define` override,独立导出经原生 `.env`;③ multi-env 真效果(连不同库)需 deploy ACK 实证。

#### §5 env 注入 follow-up(派生)

- service_role / 服务端密钥的安全注入(绝不入 client bundle);per-deploy 多套 Supabase 预设管理;editor UI 暴露 env override(目前仅 CLI);其它 `VITE_*` 自定义 env 透传(目前仅两 Supabase key)。

### §4.3 自建信令 + TURN(可配端点,设计 2026-05-31)

§4 候选池 #4.3(耦合 §5)。生产可靠性/隐私:协作信令现走公共 MQTT broker(`trystero/mqtt` 默认 `test.mosquitto.org`/`broker.emqx.io`/`broker.hivemq.com`)+ openrelay 免费 TURN —— 社区服务、无 SLA。本刀让这些**端点可配**,指向自建 broker/coturn。

#### 4.3.1 现状勘察(经验 C/E)

- 信令/TURN **全硬编码在 `room.ts`**:`appId: TRYSTERO_APP_ID('openpencil')` + `joinRoom from 'trystero/mqtt'` + 写死 openrelay iceServers;**零注入点**。配置链 `session.ts connect()` → `connectCollabSession` → `connectCollabRoom`。
- **Trystero 0.22**:mqtt 策略 `RelayConfig.relayUrls?: string[]` 可覆盖默认公共 broker;`rtcConfig: RTCConfiguration`(现用 iceServers)。
- **编辑器是 Vite app**(`src/env.d.ts` 已 `/// <reference types="vite/client" />`)→ 配置走 `import.meta.env.VITE_COLLAB_*`,**完全镜像 §5.3 的 `import.meta.env + 回落` 模式**。

#### 4.3.2 关键决定(8 主 + 次默)

**决定 a = 两岔口 AskUserQuestion 锁 2026-05-31**:① 信令 = **MQTT relay 可配**(保留 `trystero/mqtt`,`relayUrls`+TURN 走 `import.meta.env.VITE_COLLAB_*`;Supabase 策略切换留 follow-up);② **保留公共默认回落**(env 未配 = 同今日,零回归;自建 = 设 env 覆盖)。

| # | 决定 | 理由 |
|---|---|---|
| b | 配置走 `import.meta.env.VITE_COLLAB_*`(editor build-time env),纯函数 `buildCollabNetworkConfig(env)` 解析 → `{appId, relayUrls?, iceServers}` | 镜像 §5.3;editor 级配置(非 per-doc,不碰文档 Supabase),单端可验 |
| c | `VITE_COLLAB_RELAY_URLS` 逗号分隔 wss URLs → `relayUrls`;未配 → 省略(trystero 用其公共默认)| 自建 broker 列表;回落公共(决 a②)|
| d | `VITE_COLLAB_TURN_URL`(+`_USERNAME`/`_CREDENTIAL`)→ 自定义 TURN iceServer 替 openrelay;未配 → openrelay(同今日)。STUN(Google/Cloudflare)恒含 | 自建 coturn;TURN 是 NAT 兜底,STUN 免费保留 |
| e | `VITE_COLLAB_APP_ID ?? TRYSTERO_APP_ID('openpencil')` | 自建 broker 上隔离命名空间;回落现值 |
| f | `ImportMetaEnv` 在 `src/env.d.ts` 增 5 个 `VITE_COLLAB_*` 可选 string 键(避免 any-access)| Vite 惯例;类型安全(无 `any` 违 lint)|
| g | 纯 additive、保留 `trystero/mqtt` transport、保留公共回落 | 零回归、可合并(经验新-4);自建是 opt-in |
| h | 0 scene-graph/kiwi/emit;editor-side collab only(`room.ts` + 新 `network-config.ts` + `env.d.ts`)| 同 §4.x additive 姿态 |

**次默(8)**:① relayUrls 逗号项 trim + 去空;② 只设 TURN_URL 无 username/credential 也接受(开放 TURN);③ STUN 永含(免费、NAT 发现);④ env 全空 = 当前行为(public broker + openrelay + 'openpencil');⑤ 配置只读一次(连接时),不热更;⑥ 不持久化、不广播(运行态,同 §4.x);⑦ 解析失败/空串当未配(回落,不抛);⑧ §4.2 房间口令(password)与本刀正交(信令端点 vs 房间加密),两者独立。

#### 4.3.3 三问题反向核(经验 J)

- **Q1 技术链**:`buildCollabNetworkConfig(import.meta.env)` → `{appId, relayUrls?, iceServers}` → 传 `connectCollabRoom` → `joinRoom({appId, password, relayUrls?, rtcConfig:{iceServers}}, roomId, onErr)`。**纯函数单端可验**;真自建 broker/TURN 留双机 ACK(经验 K)。
- **Q2 浮现**:配置是运维侧(env),无 UI;但**诚实**:未配 = 公共 broker(决 a② 接受)。「自建已生效」可日后加指示(follow-up)。
- **Q3 心智模型**:用户期望「设 env → 协作走我的 broker/TURN」。须明确:(a) 是 **editor build-time** env(设在跑/构建编辑器处,非 per-doc);(b) 未配仍用公共(决 a②,非强制自建);(c) relayUrls 是 wss MQTT broker(非任意 URL);(d) 与 §4.2 房间口令正交。

#### 4.3.4 公开 API / 类型

```ts
// src/app/collab/network-config.ts(新,纯函数)
export interface CollabNetworkEnv {
  VITE_COLLAB_APP_ID?: string
  VITE_COLLAB_RELAY_URLS?: string
  VITE_COLLAB_TURN_URL?: string
  VITE_COLLAB_TURN_USERNAME?: string
  VITE_COLLAB_TURN_CREDENTIAL?: string
}
export interface CollabNetworkConfig {
  appId: string
  relayUrls?: string[]
  iceServers: RTCIceServer[]
}
export function buildCollabNetworkConfig(env: CollabNetworkEnv): CollabNetworkConfig
```
- `src/env.d.ts`:`interface ImportMetaEnv` 增 5 个 `VITE_COLLAB_*` 可选 string。
- `room.ts`:`connectCollabRoom` 用 `buildCollabNetworkConfig(import.meta.env)` 取代硬编码 appId/iceServers,relayUrls 透传 joinRoom config。

#### 4.3.5 改动清单

- ➕ `src/app/collab/network-config.ts`:`buildCollabNetworkConfig` 纯函数(relayUrls 逗号解析 / TURN 替换 + STUN 恒含 / appId 回落)
- 🔁 `src/app/collab/room.ts`:调 `buildCollabNetworkConfig(import.meta.env)`;`relayUrls` 进 joinRoom config(`BaseRoomConfig & RelayConfig`)
- 🔁 `src/env.d.ts`:`ImportMetaEnv` 增 5 `VITE_COLLAB_*`
- ➕ 单测 `tests/engine/collab/network-config.test.ts`:env 全空 → 公共默认(openrelay + 无 relayUrls + 'openpencil');设 relayUrls → 数组解析;设 TURN → 替 openrelay + STUN 仍在;appId 覆盖;空串/脏值当未配
- **0** scene-graph/kiwi/emit

#### 4.3.6 工作分解(~小,1-2 step + 设计 + close)

| Step | 任务 | commit 前缀 |
|---|---|---|
| 0 | §4.3 设计 + 两岔口 AskUserQuestion 锁 | `docs(lowcode): §4.3 self-host signaling+TURN — detailed design` |
| 1 | `buildCollabNetworkConfig` 纯函数 + `env.d.ts` 类型 + room.ts 接入 + relayUrls 透传 + 单测 + close | `feat(collab): §4.3 — configurable signaling relays + TURN via env` |

#### 4.3.7 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| relayUrls 透传破 joinRoom 类型(`RelayConfig`)| 中 | trystero 类型 `BaseRoomConfig & RelayConfig` 已含 `relayUrls?`;tsgo 钉 |
| `import.meta.env.VITE_COLLAB_*` any-access lint | 中 | 决 f:`env.d.ts` augment ImportMetaEnv → `string|undefined` |
| 误配空 relayUrls 数组 → 无 broker 连不上 | 中 | 次默 ①⑦:trim+去空,全空当未配回落公共 |
| 自建端点真连不验单端 | 低 | 经验 K:纯函数单端可验;真传播留双机 ACK(同 §4.x)|
| 用户以为未配也走自建(Q3)| 低 | 决 a② + Q3 文案:未配 = 公共回落 |

#### 4.3.8 Post-mortem(进行中 — 代码完成,待双机 ACK)

**§4.3 代码完成 2026-05-31**(单端检查全绿:`bun run check` 0 error / 0 clone / locale 同步 / Steiger;`network-config.test.ts` 7 纯函数测;collab 30 测零回归)。**两岔口 AskUserQuestion 锁 = MQTT relay 可配 / 保留公共回落**。1 step 收尾(设计 `<前一 commit>` → feat `afc16ea` → close 本 commit)。

**Surprise / 经验印证:**
- **§5.3 模式直接复用(经验 E/复用)**:`import.meta.env.VITE_* ?? 公共默认` 与 §5.3 Supabase 注入同构 —— 同一会话内第二次用此模式,零新设计风险;probe 不需(§5.3 已坐实 import.meta.env 行为,且本刀值在编辑器侧 Vite,非 emit 产物)。
- **类型安全(经验 决 f)**:`import.meta.env.VITE_COLLAB_*` 默认 `any`(vite/client `[key:string]:any`)→ augment `ImportMetaEnv`(`src/env.d.ts`)给 5 键 `string|undefined`,避免 no-unsafe lint;纯函数取 `CollabNetworkEnv` 参数(非直读 import.meta.env)→ 单端可测。
- **正交于 §4.2(次默⑧)**:信令端点(broker/TURN/appId)与房间口令(password 加密 SDP)是两条独立轴,本刀只动前者,§4.2 锁不变。
- **transport 不动(决 g)**:保留 `trystero/mqtt`,只换 relayUrls/iceServers/appId → 零 transport 回归;Supabase 策略(换 transport)明确留 follow-up。

**单端可验 / 双机 ACK(经验 K boundary):**
- **单端可验(已绿)**:`buildCollabNetworkConfig` 正负例(空→公共默认 4 iceServers + 无 relayUrls + 'openpencil';relayUrls 逗号 trim/去空;TURN 替换 + STUN 留 + creds;appId 覆盖;脏值回落);room.ts 接入编译通过;collab 全套零回归。
- **双机 ACK(留)**:设 `VITE_COLLAB_RELAY_URLS` 指向自建 mosquitto/emqx + `VITE_COLLAB_TURN_URL` 指 coturn → 两端经自建端点连通协作(不碰公共)。单进程/无自建 broker 验不了真信令传播(同 §4.1/§4.2/§4.4/§4.6 边界)。
- **诚实边界**:① 是 editor build-time env(运维设在跑/构建编辑器处,非 per-doc);② 未配 = 公共回落(决 a②,非强制自建);③ relayUrls 须 wss MQTT broker(transport 仍 mqtt);④ 真自建可靠性/隐私收益靠运维跑对端点 + 双机验。

#### §4.3 follow-up(派生)

- ~~Trystero **Supabase 信令策略**~~(✅ §4.3-S);~~自建模式可见指示~~(✅ `0589986`:ConnectedRoom 「Self-hosted signaling」/「Supabase Realtime signaling」行,`describeCollabSignaling` 纯函数派生,公共默认不显;2 i18n×8);relayRedundancy 可配;TURN 多组;editor 设置 UI 暴露(目前仅 build-time env);与 §5 部署联动(部署产物的协作?——注:emit 产物**不含**编辑器协作,此刀纯 editor-side)。

### §4.3-S Trystero Supabase 信令策略(§4.3 follow-up,设计 2026-05-31)

无公共 broker 选项:信令改走 **Supabase Realtime**(`trystero/supabase`,复用 §2 已在的 `@supabase/supabase-js`),而非公共 MQTT。

#### 勘察 + 决定(经验 C/E)

- `trystero/supabase` 自带类型:`joinRoom(config: BaseRoomConfig & {supabaseKey}, roomId)` —— **2 参、无 `onJoinError`**(§4.2 错误口令 toast 是 mqtt-only;**口令仍加密 SDP**,strategy-agnostic 层 `genKey`,错口令端静默不连)。`init: createClient(config.appId=SupabaseURL, config.supabaseKey)`。
- **加载岔口 AskUserQuestion 锁 = 静态 import 两策略**(`trystero/mqtt` + `trystero/supabase` 都 top-import,按 `VITE_COLLAB_STRATEGY` 选)→ connectCollabRoom 保持同步、零 call-chain 改;代价 = 编辑器 bundle 多 `@supabase/supabase-js`(与 mqtt 的 `mqtt` 库对称)。动态 import(code-split)需整条 connect 链改 async,否决。
- **策略 = `VITE_COLLAB_STRATEGY=mqtt|supabase`**(默认 mqtt);supabase 走 **editor 级** `VITE_COLLAB_SUPABASE_URL`+`_KEY`(区别于 §5.3 emit 产物的 `VITE_SUPABASE_*` 与文档的 `lowcodeSupabaseConfig`)。
- **不全则回落 mqtt**:`strategy=supabase` 但 URL/KEY 缺 → 有效 strategy = mqtt(协作仍可用,transport 非 auth);`buildCollabNetworkConfig` 纯函数返回**有效** strategy,room.ts 检测 intent≠effective 时 `console.warn`(no-swallow,经验 C)。
- iceServers(STUN+TURN,§4.3)两策略共用(WebRTC 数据面);relayUrls 仅 mqtt。**transport 切换不动 §4.2 口令/§4.3 TURN/scene-graph/kiwi/emit**。

#### 改动 + 验证

- 🔁 `network-config.ts`:`CollabStrategy='mqtt'|'supabase'`;env += `VITE_COLLAB_STRATEGY`/`_SUPABASE_URL`/`_SUPABASE_KEY`;config += `strategy` + `supabaseKey?`;supabase 分支(URL+KEY 全 → strategy='supabase', appId=URL)。
- 🔁 `room.ts`:静态 import 两 joinRoom;按 `network.strategy` 分支(supabase 2 参无 onAuthError / mqtt 3 参);intent≠effective warn。
- 🔁 `src/env.d.ts`:+3 `VITE_COLLAB_*` 键。
- ➕ 单测:`network-config.test.ts` += supabase 路径(全配→strategy=supabase+appId=URL+supabaseKey;缺 KEY→回落 mqtt;strategy 大小写;默认 mqtt + strategy 字段)。
- **单端可验**:纯函数策略解析;room.ts 编译通过 + collab 零回归。**双机 ACK(留)**:设 supabase env → 两端经 Supabase Realtime 连通(无公共 broker)。经验 K:真 Realtime 传播单进程验不了。
- **1 step**;commit 前缀 `feat(collab): §4.3-S — Trystero Supabase signaling strategy`。

**代码完成 2026-05-31**(设计 → feat `e00fd0d` → close):`bun run check` 0 error / 0 clone;`network-config.test.ts` 11 测(+5 supabase 路径:全配→supabase / 缺 key→回落 mqtt / 大小写 / 无 strategy 默认 mqtt);collab 34 测零回归。静态 import 两策略坐实(编辑器 bundle 进 @supabase,connectCollabRoom 仍同步)。**双机 ACK 留**:设 `VITE_COLLAB_STRATEGY=supabase`+URL/KEY → 两端经 Supabase Realtime 连通(无公共 broker)——单进程验不了真 Realtime 传播(经验 K,同 §4.3)。

### §5 第四刀 — 多 provider 部署(Vercel,设计 2026-05-31)

接 §5 托管 follow-up「多 provider(CF Pages / Vercel)」。§5.2 给了 Netlify 单一部署管线,`deploy.ts` 注释 + follow-up 都预留了 per-provider dispatch。本刀把 **Vercel** 接上(CF Pages 因 JWT+multipart+预存 project 流程重、待验面大,留 follow-up)。**真岔口 AskUserQuestion 锁 2026-05-31 = 仅 Vercel / CLI + editor 都做。**

#### §5.4.1 现状勘察(经验 C/E,静读真源 + recon)

- `deployFiles(files, target, {onProgress})`(`packages/compiler/src/deploy.ts`)现 Netlify-only:`DeployTarget.provider` 单成员 union(§5.2 因 `no-unnecessary-condition` 移除了 provider 守卫);流程 = `digestFiles`(SHA1 hex + `/`-前缀 manifest + `_redirects` 注入)→ `resolveSite`(缺 `--site` 则 `POST /sites` 建站)→ `createDeploy`(`POST /sites/{id}/deploys` 带 `{files:{"/p":sha}}` → 拿 `required` 缺失摘要集)→ `uploadRequired`(对 required∋ 的文件 `PUT /deploys/{id}/files{path}` 原始字节)。
- 浏览器安全(决 §5.2 c):仅 `fetch` + Web Crypto `crypto.subtle.digest('SHA-1')`,无 vite/node-only import。`sha1Hex`/`encodeFilePath`/`netlifyFetch`/`pickUrl` 私有 helper。
- CLI `deploy`(`packages/cli/src/commands/deploy.ts`):`--token`(回落 `NETLIFY_AUTH_TOKEN` env)/`--site`/`--page`/`--base`/`--supabase-*`/`--json`;`logProgress` 现硬编码「Uploading to Netlify…」。
- editor `use-deploy.ts` + `DeployControls.vue`:spawn 同一 `open-pencil deploy <file> --json [--site]`(经验 A 单管线),token 经 `NETLIFY_AUTH_TOKEN` spawn env(非 arg,不落盘);DeployControls plain 英文(无 i18n,经验 E)、token + site 两输入。
- **Vercel REST 形状(recon 确认,留 deploy ACK 核,经验 K)**:① 上传 = 对每文件 `POST https://api.vercel.com/v2/files`,headers `{Authorization: Bearer, x-vercel-digest:<sha1>, Content-Type: application/octet-stream}`,body = 原始字节(按摘要**幂等去重**,已存在秒回);② 建部署 = `POST https://api.vercel.com/v13/deployments`(可选 `?teamId=`),JSON `{name, files:[{file:"index.html", sha, size}], projectSettings:{framework:null}, target:"production"}` → 返回 `{id, url, readyState, alias?}`,`url` 是**无 scheme 的 hostname** → 公开 URL = `https://${url}`;③ project 不存在时 deploy 自动建(`name` 字段)→ 首次零预备,契合决 §5.2 g;④ SPA 回落 = `vercel.json` 含 `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}`(等价 Netlify `_redirects` 的 `/* /index.html 200`)。**结构 = upload-then-create**(Netlify 是 create-then-upload-required),摘要计算共享、清单/端点 per-provider。

#### §5.4.2 关键决定(8 主 + 次默)

**决定 a = 真岔口,AskUserQuestion 锁 2026-05-31**:① 本刀 provider = **仅 Vercel**(干净契合 fetch+SHA1,自动建 project,可全 mock 单测;CF Pages 留 follow-up);② 暴露面 = **CLI `--provider` + editor 选择器都做**(镜像 §5.2 决 a③)。

| # | 决定 | 理由 |
|---|---|---|
| b | **per-provider dispatch**:`DeployTarget.provider: 'netlify' \| 'vercel'`;`deployFiles` 顶层按 `provider` 分派到内部 `deployNetlify`/`deployVercel`;现有 Netlify 流程整体下沉为 `deployNetlify`,**行为零变**(Netlify 8 测须全绿) | `deploy.ts` 注释 + follow-up 早预留;dispatch 是最小侵入扩展 |
| c | **抽中性共享层防 jscpd**:`sha1Hex`(已共享)+ 新 `digestFiles` 返回**中性** `Array<{rel, bytes, sha}>`(`rel` 无前导斜杠)+ 泛化 `apiFetch(url,{method,token,jsonBody?,rawBody?,extraHeaders?})`(bearer + 结构化 401/网络错误,no-swallow)。两 provider 函数只放各自端点/清单形态 | 两 provider digest/upload/create 结构相似 → 不抽必触发 clone(§5.1/§5.2 教训:每 step 前跑全 `check`,jscpd 只在全 check 跑,经验 A) |
| d | **SPA 回落 per-provider 注入**(决 §5.2 e 边界延续):Netlify 注 `_redirects`(`/* /index.html 200`)、Vercel 注 `vercel.json`(rewrites);各自在 provider 函数内对 payload 副本注入,**已存在则不覆盖**(次默④);**不进 build**(build 保持 provider-agnostic,决 §5.1 h) | provider-specific 配置归 provider 路径 |
| e | **`provider` 选择**:CLI 加 `--provider <netlify\|vercel>`(**默认 `netlify`,向后兼容**);editor DeployControls 加 `<select>` provider(无 i18n,plain 英文 match 兄弟代码,经验 E) | 默认不变 = 现有命令/按钮零行为变 |
| f | **token 来源 per-provider env 回落**:`--token` 通用(flag 优先);env 回落 Netlify=`NETLIFY_AUTH_TOKEN`、Vercel=`VERCEL_TOKEN`;token 永不落盘/不进 arg/不打印(决 §5.2 f + 经验新-3);editor 经对应 env 名 spawn 透传 | 沿 §5.2 安全语义;Vercel CLI 惯例 env 名 |
| g | **`--site` 复用为通用「目标标识」**:Netlify=site id/subdomain、Vercel=project name;help 文案说明 per-provider 含义(不新增 flag,最小改动);缺省两 provider 皆「自动建」 | 语义统一一个旋钮,UI 仅 label 随 provider 变 |
| h | **0 scene-graph / kiwi / emit-内容 / build 改动**;新增仅 `deploy.ts`(dispatch + Vercel)+ CLI `--provider`/env/文案 + editor 选择器 + 单测 | 同 §5.1/§5.2:聚焦「dist → 托管」段,fork 可合并(经验新-4) |

**次默(8)**:① Vercel 失败(401/网络/必填缺)结构化抛、CLI 非零退出 + 信息,不静吞(经验 C);② `--json` 输出不变 `{provider, url, deployId, fileCount}`(Vercel `deployId`=deployment id,`fileCount`=清单文件数含注入的 `vercel.json`);③ `onProgress` 复用 `stage:'digest'|'create'|'upload'|'done'`,Vercel 自然序 digest→upload→create→done(stage 名复用,顺序略不同,进度提示非契约);④ SPA 配置文件已存在(用户自带)则不覆盖;⑤ Vercel 上传**串行 POST**(首刀简单,并发化留 follow-up,同 Netlify PUT);⑥ editor 部署需已保存文档路径(脏/未存先走保存流,同 §5.2 次默⑥);⑦ 仅上传 dist 静态文件,不传源码/node_modules;⑧ token 优先级 flag > env,皆无 → 明确报错指引 provider 对应 env 名(不静默)。

#### §5.4.3 三问题反向核(经验 J)

- **Q1 技术链**:`deployFiles` → 按 `target.provider` 分派。Vercel 链 = 注 `vercel.json` → `digestFiles`(中性 entries,共享)→ 对每 entry `POST /v2/files`(`x-vercel-digest`,`apiFetch` rawBody,共享 wrapper)→ `POST /v13/deployments`(`files:[{file:rel,sha,size}]`)→ `url`→`https://${url}`。CLI 链不变(`loadAndCompile`→`buildPreviewProject`→读 dist→`deployFiles`),仅多传 `provider` + provider-aware token env。editor 链 = spawn `open-pencil deploy <file> --provider <p> --json [--site]`,token 经对应 env。**复用 §5.1 build + §5.2 单管线/spawn 模式 + 共享 digest/fetch**,无新链路类型。Vercel 真实 API 形状按文档,留 deploy ACK 核(经验 K)。
- **Q2 浮现**:CLI 打印 `Uploading to ${provider}…` + 最终 URL + `--json`;editor provider `<select>` + token/target label 随 provider 变 + 进度/完成链接/结构化错误(同 §5.2)。失败结构化浮现(次默①⑧)。
- **Q3 心智模型**:用户期望「选 provider + token → 公开 URL」。须明确:(a) 默认 Netlify、`--provider vercel` 切换(决 e);(b) 首次自动建站/建 project、重部署指 `--site`(决 g);(c) 多页 SPA 回落自动注入(Netlify `_redirects` / Vercel `vercel.json`),刷新不 404(决 d);(d) token 用对应 env 名(`VERCEL_TOKEN`,决 f 报错指引);(e) Supabase config 已内联/可经 §5.3 env 注入(provider 无关)。

#### §5.4.4 公开 API / 类型

```ts
// packages/compiler/src/deploy.ts(改)
export interface DeployTarget {
  provider: 'netlify' | 'vercel'   // 单成员 → 二成员 union;dispatch 重新成立
  token: string
  /** Netlify: site id/subdomain;Vercel: project name。缺省 = 自动建。 */
  site?: string
}
// DeployResult / DeployProgress / DeployOptions 不变;deployFiles 签名不变(仅 provider 多一值)
```

- `packages/cli/src/commands/deploy.ts`:`--provider <netlify|vercel>`(默认 netlify);token env 回落 per-provider;`logProgress` 文案 provider-aware。
- `src/app/lowcode/preview-pane/use-deploy.ts`:`deploy(token, provider, site?)`;spawn args += `--provider`;env 名按 provider。
- `src/app/lowcode/preview-pane/DeployControls.vue`:provider `<select>` + label 随 provider。

#### §5.4.5 改动清单

- 🔁 `packages/compiler/src/deploy.ts`:`provider` union 加 `'vercel'`;`deployFiles` 顶层 dispatch;现 Netlify 流程 → `deployNetlify`;`digestFiles` 改返回中性 `entries`;泛化 `apiFetch`;新 `deployVercel`(注 `vercel.json` → 中性 digest → `POST /v2/files` 摘要上传 → `POST /v13/deployments` 清单 → `https://${url}`)
- 🔁 `packages/cli/src/commands/deploy.ts`:`--provider` arg(默认 netlify);token env 回落 `provider==='vercel'?VERCEL_TOKEN:NETLIFY_AUTH_TOKEN`;`logProgress(p, provider)` 文案;`deployFiles({provider,...})`
- 🔁 `src/app/lowcode/preview-pane/use-deploy.ts`:`deploy(token, provider, site?)`;spawn `--provider`;env 名 per-provider
- 🔁 `src/app/lowcode/preview-pane/DeployControls.vue`:provider `<select>`(netlify/vercel)+ token/target label 随 provider;`title` 改通用「Deploy」
- ➕ 单测 `tests/engine/compiler/deploy.test.ts` += Vercel describe:`POST /v2/files` 带 `x-vercel-digest`=SHA1 + octet-stream + raw bytes;`POST /v13/deployments` body `files:[{file(无前导斜杠),sha,size}]`;`vercel.json` rewrites 注入(缺补/有不覆盖);`url`→`https://${url}`;401 结构化(检 token);缺 token 报错;onProgress 序列;dispatch(provider:'vercel' 不碰 Netlify 端点 / provider:'netlify' 零回归)
- **0** scene-graph / kiwi / emit-内容 / build

#### §5.4.6 成功标准 + ACK(经验 K boundary)

- **单端可验**:`deploy.test.ts` Vercel 路径全 mock-fetch(上传/建部署/`vercel.json`/url/401/缺 token/进度/dispatch);Netlify 8 测零回归;CLI `--provider` 解析 + provider-aware env;`bun run check` 0 error/clone/locale 同步。
- **Deploy ACK(留)**:真 Vercel token → `open-pencil deploy <fixture> --provider vercel --token …` → live URL,app 跑、Supabase 可用、多页刷新不 404(`vercel.json` rewrites 生效);**editor 选 Vercel 一键(Tauri ACK)**。同时复用为 §5.1/§5.3/§4.x 真部署场。
- **诚实边界**:① Vercel 真实 API 形状(`v2/files` digest header / `v13/deployments` files 数组 / `url` 无 scheme / 自动建 project)按文档,留 ACK 核(经验 K,无 token/单进程探不了);② editor Tauri-only(同 preview sidecar);③ CF Pages + team/scope + 并发上传 + token keychain 留 follow-up。

#### §5.4.7 工作分解(~中,3 step + 设计 + close)

| Step | 任务 | commit 前缀 |
|---|---|---|
| 0 | §5 第四刀设计 + 真岔口 AskUserQuestion 锁 | `docs(lowcode): §5 multi-provider deploy (Vercel) — detailed design` |
| 1 | `deploy.ts` dispatch + 中性 digest + 泛化 apiFetch + `deployVercel` + Vercel mock 单测 | `feat(compiler): §5 step 7 — Vercel deploy provider` |
| 2 | CLI `--provider` + provider-aware token env/文案 | `feat(cli): §5 step 8 — \`deploy --provider\` (netlify\|vercel)` |
| 3 | editor provider 选择器 + use-deploy provider 参数 + close | `feat(app): §5 step 9 — provider picker in one-click deploy` |

#### §5.4.8 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| Vercel 真实 API 形状与文档偏差(digest header/files 数组/url 字段/自动建 project) | 中 | mock 单测钉请求构造;真形状留 deploy ACK 核(经验 K);结构化错误不静吞 |
| 两 provider 函数结构相似触发 jscpd clone | 中 | 决 c:抽中性 `digestFiles`/`apiFetch`/`sha1Hex` 共享;每 step 前跑全 `check`(经验 A) |
| Netlify 行为回归(digest 签名改 / dispatch) | 中 | Netlify 8 测全绿门;`deployNetlify` 行为零变;中性 entries 仅改内部清单映射 |
| `vercel.json` rewrites 静态 SPA 不生效 | 中 | deploy ACK 验多页刷新不 404 |
| token 泄露(落盘/arg/日志) | 高 | 决 f:flag/env-only,spawn env,不打印(继承 §5.2) |

#### §5.4.9 Post-mortem(代码完成 2026-05-31,待 deploy/Tauri ACK)

**多 provider(Vercel)代码完成**(worktree 单端检查全绿:`deploy.test.ts` 16 测 = Netlify 8 零回归 + Vercel 8;`test:dupes` **0 clone**;`check:i18n` sync;`check:arch` Steiger 通过;tsgo/vue-tsc 对 deploy 文件零 error)。**真岔口 AskUserQuestion 锁 = 仅 Vercel / CLI + editor 都做**。

**Commit 链(设计 + 3 step + close):**
| Step | Commit | 内容 |
|---|---|---|
| 设计 | `e55bd7c` | §5 第四刀全文 + 真岔口锁 |
| step 7 | `c987114` | `deploy.ts` per-provider dispatch;Netlify 流程下沉 `deployNetlify`(行为零变);`deployVercel`(`/v2/files` 摘要上传 → `/v13/deployments` 清单 → `https://${host}`);中性 `digestPayload`(`{rel,bytes,sha}`)+ 泛化 `apiFetch`;SPA 回落 per-provider(`_redirects`/`vercel.json`);16 mock-fetch 单测 |
| step 8 | `3c8c2e1` | CLI `--provider`(默认 netlify);token env 回落 per-provider(`NETLIFY_AUTH_TOKEN`/`VERCEL_TOKEN`)+ 报错指引;`--site` per-provider 含义;`logProgress` provider-aware;未知 provider 拒 |
| step 9 | `10ccb7f` | editor `DeployControls` provider `<select>` + token/target label 随 provider;`use-deploy` 加 `provider` 参 + `--provider` spawn arg + 对应 env 名透传 |
| close | _本 commit_ | post-mortem + CHANGELOG |

**Surprise / 经验印证:**
- **共享中性层一次抽对(经验 A,jscpd 0 clone)**:两 provider digest/upload/create 结构高度相似,设计期(决 c)预判 clone 风险 → 抽 `sha1Hex`/中性 `digestPayload`(返 `/`-less `{rel,bytes,sha}`,各 provider 自映射清单形态)/ 泛化 `apiFetch`。结果 `test:dupes` 0 clone 一次过,未触发 §5.1/§5.2 那种「per-step 子集测漏跨文件 clone」回炉。
- **dispatch 行为零变(决 b)**:`DeployTarget.provider` 单成员 → 二成员 union 重新使 dispatch 守卫成立(§5.2 曾因单成员触发 `no-unnecessary-condition` 移除);Netlify 流程整体下沉 `deployNetlify` + `digestPayload` 内部从中性 entries 重建 `/`-prefixed manifest → Netlify 8 测零回归。
- **upload-then-create vs create-then-upload(API 形状差异)**:Netlify = 先 `POST /deploys` 拿 `required` 缺失集再 `PUT` 缺失;Vercel = 先逐个 `POST /v2/files`(`x-vercel-digest` 幂等去重)再 `POST /v13/deployments` 引用全清单。`onProgress` stage 名复用(`digest/upload/create/done`),Vercel 自然序 digest→upload→create→done(单测断言 `upload` 早于 `create`),CLI `logProgress` 移到 `upload` stage 打印「Uploading to ${provider}…」。
- **worktree 环境噪音(本会话流程教训)**:本刀在 git worktree 内做(背景隔离守卫强制)。worktree 无独立 `node_modules` → type-aware lint/tsgo/vue-tsc 对第三方 `tinykeys` 报 3 个 `TS7016`/`TS18046`(`keyboard/registry.ts`,与 deploy 零关),主 checkout 同命令 **0 error**。判定为环境性假 error(同 prompt「`Cannot find module '@open-pencil/...'` LSP 派生无视」类),**真权威门 = 主 checkout 合并后跑全 `bun run check`**。

**单端可验 / ACK 留验(经验 K boundary):**
- **单端可验(已绿)**:`deploy.test.ts` Vercel mock-fetch(上传 header/清单形态/`vercel.json` 注入/url/401/缺 token/进度序/dispatch 不碰 Netlify);Netlify 8 零回归;CLI `--provider` 解析 + bad-provider 拒 + per-provider no-token 报错(端到端真跑,exit 1);`test:dupes` 0 clone。
- **Deploy ACK(留)**:真 Vercel token → `open-pencil deploy <fixture> --provider vercel --token …` → live URL,app 跑、Supabase 可用、多页刷新不 404(`vercel.json` rewrites 生效);**editor 选 Vercel 一键(Tauri ACK)**。同时复用为 §5.1/§5.3/§4.x 真部署场。
- **诚实边界**:① Vercel 真实 API 形状(`v2/files` digest header / `v13/deployments` files 数组 / `url` 无 scheme / 自动建 project / `projectSettings.framework=null` 纯静态 serve)按文档,留 ACK 核(经验 K,无 token/单进程探不了);② editor Tauri-only(同 preview sidecar);③ CF Pages + team/scope + 并发上传 + token keychain 留 follow-up。

#### §5 多 provider follow-up(派生)

- ~~Vercel~~(✅ `c987114`→`10ccb7f`);CF Pages 直传(account_id + 预存 project + upload-JWT + multipart);Vercel team/scope(`--team`/`VERCEL_TEAM_ID`);并发上传;site/project 列表选择 UI;自定义域名;部署历史;token keychain。

### Bug 修复 — 矢量图标在 preview 里成方块(2026-05-31)

用户报:编辑器里的图标在 preview 网页变成好几个实心方块。

**根因(勘察 + headless probe 坐实,经验 C/K):** `TAG_BY_TYPE[VECTOR]='div'`(`ir/collect/tree.ts`)—— `VECTOR`/`BOOLEAN_OPERATION`/`STAR`/`POLYGON`/`LINE` 一律 emit 成 `<div>`,只带尺寸 + fill→`bg-[色]`,**路径几何(`fillGeometry`/`strokeGeometry` 的 `commandsBlob`)从不 emit** → 图标 = 一个带背景色的方块。编辑器画布是用 `getFillGeometry` 画路径的,这条信息编译期被丢。

**2 岔口 AskUserQuestion 锁:** ① 节点范围 = **全部纯矢量形状**(上述 5 类;RECTANGLE/ELLIPSE/ROUNDED_RECTANGLE/FRAME 保持 CSS div,本就正确);② 生成方式 = **复用 core `renderNodesToSVG` 内联原始 SVG**(非自建)。

**实现(复用既有 headless SVG 导出,经验 A;`@open-pencil/core/io/formats/svg`,与编译器已用的 `…/jsx` 同源):**
- `IRElement.rawHtml?` 新字段;`emit/element.ts` 在其在场时 emit `<tag … dangerouslySetInnerHTML={{__html: <json>}} />`(自闭合、无 children;React 禁止二者并存)。
- `tree.ts`:`SVG_SHAPE_TYPES` 的节点 → `buildVectorSvg`(`renderNodesToSVG(graph,'',[id],{xmlDeclaration:false})` 拿到 `viewBox=0 0 w h` 自含 SVG,正则把固定 px `width/height` 换 `100%` 以填满布局盒、viewBox 保宽高比)→ 设 `rawHtml`;并 `stripPaintClasses` 去掉 `bg-*`/`border*`/`ring*`/`shadow*`(**关键**:不去的话纯色图标盖在同色 `bg-[…]` 盒子上仍是方块)。布局/尺寸/定位/`rounded`/`opacity` 类保留。
- `data-node-id`(devMode 预览点选)仍打在 wrapper 上 → preview ↔ canvas 映射不受影响。
- **fork 可合并(经验 新-4):** `collectTailwindClasses` 是 core 共享 `…/jsx` 模块,不动它 —— paint 剥离在编译器本地做(`stripPaintClasses`),零 core 改动。

**验证:** `tests/engine/compiler/vector-svg.test.ts`(VECTOR → 输出含 `<svg`/`<path`/`dangerouslySetInnerHTML`/`100%`、无 `bg-[`;FRAME 对照仍是 CSS div);compiler 423 测零回归;主 checkout 全 `bun run check` 0 error/0 clone。**真观感(图标可见、不再方块)留 Tauri/preview ACK**(emit 契约单测能钉,真渲染靠预览)。

**后续修(2026-05-31,多 path 错位):** 单 path 图标 OK,但多 path 错位。勘察坐实:`import_svg` 把多 path 图标做成 **FRAME + N 个满尺寸 VECTOR 子**(每 path 一个子节点,`x=0,y=0,w=h=` 帧尺寸,几何在共享 viewBox 坐标系)。初版按叶子逐个 emit SVG → 每个子 `<div>` 无定位类(GROUP/FRAME 子节点不带 absolute/left/top,core 共享定位逻辑的既有空缺),于是 block 流**纵向堆叠/重叠** → path 错位(单 path 因只有一个子、无堆叠对象才看着对)。**修:把"全矢量容器"折叠成一个 SVG** —— `isVectorIcon`(节点是矢量形状,或 `VECTOR_FOLDABLE_CONTAINERS`={FRAME,GROUP,SECTION,COMPONENT,INSTANCE} 且可见子树全是 icon)为真时,`renderNodesToSVG([容器id])` 把整棵子树画进**一个**共享 viewBox(各 path 在真实坐标)→ 一个 wrapper(容器自身定位正确)、零逐子定位 → 对齐。叶子矢量仍各自成 SVG。子节点递归抽到 `collectChildNodes`,折叠时跳过(并降低 `nodeToIR` 复杂度)。`vector-svg.test.ts` 加多 path FRAME → 恰好一个 `dangerouslySetInnerHTML`、两 path 都在内。RECTANGLE/ELLIPSE/FORM 不折叠(各自 CSS/表单语义)。

**遗留 follow-up:** 折叠容器丢弃子节点各自的事件(图标子一般无事件;真有需求再说);渐变/图像填充由 `renderNodesToSVG` 原样保真(已覆盖)。

---

---

## §10 工作流编排 — inline ActionDef 扩展(设计 2026-06-02)

> 2026-06-02 用户挑定 §7 / §8 之后的第三项功能 milestone。两关键分叉用 AskUserQuestion 锁定。

### 10.1 现状与问题

事件模型自 Phase 1 §7.4 起是 `events: Partial<Record<EventName, ActionDef[]>>` —— 每个事件挂一条 **顺序 ActionDef 链**,编译成单个 arrow 函数,含异步 action(apiCall / supabase*)时整体变 `async` 且每步各自 `await`。所以「多步链 + 顺序等待」**已经具备**。缺的是 Bubble 风格 workflow 的另两块:**条件分支**(按运行态决定走哪条子链)和**显式异步等待**(定时 delay)。例:`onClick → supabaseQuery → if(error) navigate('/login') else { setDocState(user); delay(500); ... }`。

### 10.2 关键决定

| # | 决定 | 取舍 |
|---|---|---|
| 1 | **inline 扩展,不新增顶层实体** | 直接给 `ActionDef` 联合加嵌套 kind,`events` 本身即 workflow。复用全部现有 collect / emit / round-trip(`lowcode/events` 整块 JSON 序列化 → 嵌套 then/else 天然往返,零 codec 改动)。对齐 §1.1 §10 原文「ActionDef 链」+ §1.2 把可视化 DAG 编辑器明确划到 Phase 4。Named WorkflowDef(可复用命名工作流)否决:要新 round-trip 通道 + 顶层实体 + 循环引用检测,过重,留 v2。 |
| 2 | **新增三 kind:`condition` / `delay` / `stop`** | 全零 npm 依赖、全 clean recursion。condition=`if/else` 嵌套子链;delay=`await new Promise(r=>setTimeout(r,ms))` 定时等待;stop=`return` 提前终止。`+toast` 否决(需 emit 端新 runtime toast surface,留 v2;§3.x 受控输入已有 docState 反馈路径)。 |
| 3 | **condition 表达式复用现有子语言** | `parseExpression` / `emitExpression` 已支持完整布尔 / 比较 / 三元 / 成员访问(`===` `<` `&&` `\|\|` `?:` `.`)→ 条件表达式零成本,不需 §12 表达式扩展。`$prev` 不允许(非 setState/setVariable 上下文)。引用按 read-context 校验(page state / docState / inScope),命中 docState 注册 read。 |
| 4 | **GUI 授权面板延后**(沿用 §7 / §8 先例) | v1 = 数据模型 + tool/AI 授权(`tools/modify` 支持嵌套校验) + collect + emit + round-trip + headless 测试。EventsPanel.vue 的 `ACTION_KINDS` 下拉**不**加三新 kind(其 label/errors/makeAction 都是 if-chain 带兜底,加联合成员不破 tsgo),所以编辑器 GUI 暂不能授权 workflow,只能 AI/tool/编程构造。 |

### 10.3 公开 API / Schema 改动

- `scene-graph/types.ts`:新增 `ConditionalAction {id; kind:'condition'; condExpr?; consequent: ActionDef[]; alternate?: ActionDef[]}`、`DelayAction {id; kind:'delay'; ms?}`、`StopAction {id; kind:'stop'}`,并入 `ActionDef` 联合(`ActionKind` 自动扩 3)。**分支字段名用 `consequent`/`alternate`(对齐 `ExprAst` ternary 词汇),不用 `then`/`else`** —— oxlint `unicorn/no-thenable` 禁止任何对象有 `then` 属性(实现中踩到,改名而非 scope-disable correctness 规则,经验:新数据模型字段名避开 `then`)。
- `packages/compiler/src/ir/types.ts`:新增 `IRConditionalHandler {kind:'condition'; condAst; references; consequent: IREventHandler[]; alternate?}`、`IRDelayHandler {kind:'delay'; ms}`、`IRStopHandler {kind:'stop'}`,并入 `IREventHandler` 联合。

### 10.4 内部实现拆解

1. **collect**(`ir/collect/bindings.ts`):`dispatchAction` 加三 case;`resolveCondition` parse condExpr + checkExprRefs(read-context、禁 $prev、注册 docState read)+ 递归 `resolveBranch(then)` / `resolveBranch(else)`;`resolveDelay` 校验 `ms` 为有限非负数;`resolveStop` trivial。`recordWrites` 对 condition/delay/stop no-op(嵌套写在 `resolveBranch` 内逐 handler 已记)。把现有 `resolveActions` 主循环抽成可复用的 `resolveBranch(actions, ctx)`。
2. **emit**(`adapters/react/emit/event.ts`):异步判定递归(`delay` 或 任一嵌套 handler 异步 → 整体 `async`);单语句捷径仅限「简单表达式 kind」(setState/navigate/setVariable),其余(apiCall/supabase*/condition/delay/stop)强制花括号体;分号规则:setState/navigate/setVariable/delay/stop 加 `;`,apiCall/supabase*/condition 是完整块不加。`emitStatementList(handlers)` 抽出供 condition 分支递归。condition→`if (<cond>) { <then> }` + 可选 ` else { <else> }`;delay→`await new Promise((resolve) => setTimeout(resolve, <ms>))`;stop→`return`。
3. **rls-advisor**(`lowcode-validation/rls-advisor.ts`,经验 A 嵌套漏报):`collectRlsRequirements` 须**下降进 condition.then/else** 收集嵌套 supabase action 的 RLS 需求,否则分支里的 query/mutation 被漏。
4. **tool/AI 授权**(`tools/modify/lowcode.ts`,经验 A `never` 强制):`KNOWN_ACTION_KINDS` += 三 kind;`buildActionFromValidated` 加三 case(condition 递归校验 then/else 每个 ActionDef);validate 入口对 condition 递归。

### 10.5 成功标准

- collect 单测:condition then/else 递归 lower、delay ms 校验、stop;嵌套 supabase 在分支里 resolve;docState read/write 在分支里注册。
- emit 单测:`if(...){}else{}`、`await ...setTimeout`、`return`;含嵌套异步时整体 `async`;纯同步分支不 async。
- round-trip:嵌套 condition events 经 `exportFigFile→parseFigFile` 存活。
- rls:分支内 supabase action 的 RLS 需求被收集。
- tool:AI 构造 condition(嵌套)校验通过/失败路径。
- 不破坏既有 7 kind 行为 + 全 `bun run check` exit 0。

### 10.6 Post-mortem

CODE COMPLETE 2026-06-02。实现完全符合设计,1 个非预期 + 2 个经验复用:

- **非预期(field naming):** `ConditionalAction.then`/`else` 触发 oxlint `unicorn/no-thenable`(禁止任何对象字面量带 `then` 属性,防误 await)—— 实现/测试共 ~24 处报错。**改名 `then`→`consequent` / `else`→`alternate`(对齐 `ExprAst` ternary 既有词汇),不 scope-disable correctness 规则。** 新经验:lowcode 数据模型新字段名避开 `then`(以及任何会被 lint 当 thenable 的名字)。
- **经验 A(union widening 双轮 sweep):** 加 3 个 `ActionDef`/`IREventHandler` kind,sweep 命中 4 个穷举点:collect `dispatchAction`、emit `emitHandlerStatement`(`never`)、tool `buildActionFromValidated`(`never`)、check:vue 的 EventsPanel `errorsFor` if-chain 末尾(narrow 后把 condition/delay/stop 喂给 `supabaseAuthErrors`,vue-tsc 才抓到 —— oxlint/tsgo 没抓,**check:vue 是第 4 道闸**)。另 `rls-advisor.collectRlsRequirements` 是 if-chain 不报错但会**漏** condition 分支里的嵌套 supabase action → 加 `flattenActions` 递归下降(经验 A 的「不报错但漏」典型)。
- **round-trip 零改动验证:** `lowcode/events` 整块 JSON 序列化的设计假设成立 —— 嵌套 consequent/alternate 经 `exportFigFile→parseFigFile` 字段完全存活,codec 零改。
- **GATE 流程:** 先 `build:packages` 再改 src → dist 与 src 不同步,type-aware oxlint 报 12 个 `SceneNode(src) vs SceneNode(dist)` TS2345 假错 —— **改完 src 必须重 `build:packages` 再 lint**。CLI 子进程测试(cli.test.ts)的 `invalid zip data` 是 LFS fixture 未实体化(131B stub),`git lfs pull --include="tests/fixtures/*"` 解决,非回归。
- **测试:** emit 6 + collect 8 + tool 5 + rls(+1)+ round-trip(+1)= 21 个,全绿;`bun run check` exit 0;唯一既有 fail 仍是 §6 `frame with children renders nested`(出范围)。

**§10 follow-ups:** 编辑器授权面板(GUI:condition 分支编辑器 + delay 输入 + stop)—— EventsPanel `ACTION_KINDS` 暂未加 3 新 kind(GUI 授权延后,沿用 §7/§8);named WorkflowDef(可复用命名工作流)v2;`toast`/notify action(需 runtime toast surface)v2;condition 表达式的 GUI 校验红框。

## §8 v2 override→props — text-override 映射成组件 props(设计 2026-06-02)

> §8 v1 follow-up。用户 2026-06-02 挑定。scope fork AskUserQuestion 锁定 = **仅 text override**。

### 8v2.1 现状与问题

§8 v1:clean INSTANCE(`overrides` 空)→ `<Card/>`;**dirty INSTANCE(任一 override)→ 整棵子树内联**(忠实但失去复用,同一组件改一处文案就退化成重复子树)。Bubble/Figma 的真实用法是 instance 改子节点文案 → 应映射成组件 prop `<Card title="新文案"/>`。

### 8v2.2 关键决定

| # | 决定 | 取舍 |
|---|---|---|
| 1 | **仅 text override → string prop** | `:text` 是干净的内容槽(TEXT 的 `{kind:'text',value}` → `{propName}`,复用 IRExpression `{ident}` emit)。fill/size/font override → className 驱动,要参数化 className + safelist 交织,过重 → **保留 v1 内联回退**。 |
| 2 | **instance 资格 = all-or-nothing** | 一个 instance 要么是 `<Card .../>` ref 要么整棵内联,不能半。dirty instance **当且仅当所有 override key 都是 `:text`** 才转 ref;含任一非-text override(`:fills`/`:name`/...)→ 内联(v1)。 |
| 3 | **prop 槽 = 跨实例 union** | 一个组件模块服务 master + 所有 clean + 合格 dirty 实例 → prop 集 = 该 master 所有实例 `:text` override 槽的并集(按 master-child-id 去重,`instChild.componentId` 映射回 master child)。每个 prop **默认值 = master child 的 text** → clean 实例 `<Card/>` 渲染 master 文案,零行为回归。 |
| 4 | **override 值取自 instance child 节点**(非 overrides map 值) | syncChildren 只看 `overrideKey in overrides`(presence,跳过 sync);**diverged 值 materialized 在 instance 自己的 clone child 上**(`instChild.text`)。overrides map 用于(a)资格判定 + (b)知道传哪些槽;值从 `graph.getNode(instChildId).text` 读。 |
| 5 | **prop 命名 = master child name → camel-ish,组件内去重** | child "Title" → `title`;空/非法名 → `text1` 兜底;同组件内冲突加数字。 |
| 6 | **GUI 授权面板仍延后** | 沿用 §7/§8 v1/§10 先例,纯 compiler-emit 增量,无编辑器面板。 |

### 8v2.3 公开 API / Schema 改动

零 scene-graph / round-trip 改动(COMPONENT/INSTANCE schema-native,overrides 已存在)。仅 IR + emit:
- `ir/types.ts`:`ComponentDef` 加 `props: ComponentProp[]`(`{name; defaultValue}` 签名用);`IRComponentRef` 加 `props: ComponentRefProp[]`(`{name; value}` 实例传值,master/clean = `[]`)。
- `ir/collect/components.ts`:`ComponentRegistry` 升格 `Map<masterId, ComponentMeta{name; propSlots: Map<masterChildId, ComponentProp>}>`。

### 8v2.4 内部实现拆解

1. **components.ts**:`buildComponentRegistry` 同时算 `propSlots` —— 扫每个 registered master 的所有 instance,收 `:text` override key,`instChildId→componentId`(master child id)union,master child 的 `name`→propName(去重)、`text`→defaultValue。
2. **tree.ts collect**:`WalkCtx` 加 `componentPropSlots?: Map<masterChildId, ComponentProp>`;collectComponents 每个 master 设 `ctx.componentPropSlots = meta.propSlots`;TEXT 分支:binding 优先,否则**若 `node.id` 命中 propSlot → emit `IRExpression{ast:{kind:'ident',name:propName}, references:[propName]}`**(而非 literal),否则 literal。`resolveComponentRef`:COMPONENT → props `[]`;INSTANCE → `resolveInstanceProps`(任一非-text override key → null 内联;否则逐 `:text` key 取 `instChild.text` + map componentId→propName 出 `{name,value}[]`)。registry `.get(id)` → `.get(id)?.name`。
3. **emit/component.ts**:签名 `function Name({ className, title = "默认", ... }: NameProps)` + interface `{ className?: string; title?: string; ... }`(default + 值 escape)。
4. **emit/element.ts** componentRef arm:`<Name className=".." title="新文案" ... />`(props attr escape)。
5. **react index.ts**:`registry.get().name`/`.propSlots` 解构处适配;collectClassNames 不受影响(text prop 无 class)。

### 8v2.5 成功标准

- master + clean instance 仍 `<Card/>`(默认 = master 文案),组件签名带 `title?` 默认值。
- 单 text-override dirty instance → `<Card title="新文案"/>`,子树 NOT 内联。
- 多实例不同 text 槽 → 组件 prop = union,各传各的;未覆盖槽 → 默认。
- 含非-text override(fill)→ 仍内联(v1 回归保留)。
- 跨页:master page1 / dirty instance page2 共用一个组件文件 + props。
- `bun run check` exit 0。

### 8v2.6 Post-mortem

CODE COMPLETE 2026-06-02。完全符合设计,零非预期架构问题:

- **override 值来源坐实 = instance child 节点**(非 overrides map 值):canvas 渲染的是 child 节点,syncChildren 只用 overrides 做 presence-marker(跳过 sync),diverged 值 materialized 在 `instChild.text`。v1 旧测试 `overrides={'childId:text':'Custom'}` 是退化构造(marker 在但 child.text 没改)→ 改成正经构造(`updateNode(child,{text}) + 标 marker`),并把旧的「override→inline」测试改用**非-text override(`:fills`)**保留 v1 回归。
- **ComponentRegistry 升格** `Map<id,name>`→`Map<id,ComponentMeta{name,propSlots}>`:`.get(id)` 全改 `.get(id)?.name`;index.ts/ir-walk 不直接碰 registry(只过 ComponentDef/IRComponentRef),改动局限 components.ts + tree.ts。
- **prop 槽 = master-descendant-id 键**:跨实例并集靠 `instChild.componentId→master child id`;component body collect 时 TEXT node 的 `node.id`(= master child id)命中 propSlots → emit `IRExpression{ident}`(复用既有 `{expr}` emit,零新 emit 路径);default = master child text → clean `<Card/>` 零回归。
- **lint:** `masterChild.text ?? ''` 被 no-unnecessary-condition 拦(text 类型 `string` 非空)→ 去 `?? ''`;`instChild?.text ?? ''`(instChild 可空)保留。**改 src 后必 `build:packages` 再 lint**(否则 dist-vs-src 假错)——§10 同款教训。
- **测试:** v2 新 5 个(prop 默认/传值不内联/master+clean 不传/跨实例 union/跨页)+ v1 旧 6 个(改 1 个为非-text)= 11/11;`bun run check` exit 0;断言用 `/<Card[^>]*title="X"/` 不假设 className/prop attr 顺序。

**§8 v3 follow-ups:** fill/size/font override → props(className 参数化 + safelist);COMPONENT_SET variants;编辑器组件 props 面板(GUI)。

## §8 v3 override→props — fill/color override 映射成 className prop(设计 2026-06-02)

> §8 v2 follow-up。用户 2026-06-02 挑定。granularity fork AskUserQuestion 锁定 = **整个 child className 参数化**。

### 8v3.1 现状与问题

§8 v2 把 `:text` override 映射成 string content prop;`:fills` 等仍走 v1 内联回退。fill/color 改动是组件复用的另一常见诉求(同一卡片不同主题色)。但 fill 与 text 不同:**fill 不是内容槽,它 twirl 进 element 的 className 字符串**(`backgroundColor`→`bg-[#hex]`,TEXT→`text-[#hex]`)。

### 8v3.2 关键决定

| # | 决定 | 取舍 |
|---|---|---|
| 1 | **fill override → 整个 child className 参数化**(string prop) | fill-override 的 child emit `className={badgeClassName}`,默认 = master child 的 `tailwindClassName`,instance 传自己计算的 className。**零 twirl 耦合 / 不拆 token**(否决「只抽 bg 色」:要从合并 className 拆 fill token + 防 base 重复叠 + TEXT→text-color 分支,脆)。prop 值含该 child 全部视觉类(fill+其他),但只在该 child 有 `:fills` override 时才参数化。 |
| 2 | **资格扩展** = 所有 override ∈ {`:text`, `:fills`} | `isTextOnlyInstance`→`isSupportedOverrideInstance`。含 size/font/其他 override → 仍内联(v1)。一个 child 可同时有 text + fill 两个 prop。 |
| 3 | **className prop 值取自 instance child 计算 className**(`tailwindClassName(instChild)`) | 与 v2 的「值取自 instance child 节点」一致——canvas 真值。root 自己的 fill 仍走 usage className(componentRef.className),只有 descendant fill 需 prop(同 v2 root 位置)。 |
| 4 | **复用 IRElement.classNameProp,零新 emit 路径** | 新 `IRElement.classNameProp?: string`;set 时 emit `className={prop}`(否则静态字符串)。`node.className` 仍保留静态值作 prop 默认 + safelist。 |
| 5 | **safelist 两边都收** | body 默认(master className)经既有 `walk(node.className)` 已收;instance 传的 className 值 → collectClassNames 对 componentRef 的 className-kind props 显式 addClasses。text-kind props NOT safelist(非 class)。 |

### 8v3.3 公开 API / Schema 改动(零 scene-graph / round-trip)

- `ir/types.ts`:`ComponentProp` + `ComponentRefProp` 加 `kind: 'text' | 'className'`;`IRElement` 加 `classNameProp?: string`。
- `ir/collect/components.ts`:`ComponentMeta.propSlots` 升格 `Map<masterChildId, ComponentSlot>`,`ComponentSlot = {text?: ComponentProp; className?: ComponentProp}`(一个 child 可有两个 prop)。

### 8v3.4 内部实现拆解

1. **components.ts**:`buildPropSlots` → `Map<masterChildId, ComponentSlot>`;`:text`→`slot.text`(default master.text, kind text),`:fills`→`slot.className`(default `tailwindClassName(masterChild,graph)`, kind className)。prop 名 text=`<child>`、className=`<child>ClassName`,组件内统一去重。`isSupportedOverrideInstance`(所有 key ∈ {`:text`,`:fills`})。注意:components.ts 现在要 `tailwindClassName` → 从 `#compiler/ir/style` import(原只在 tree.ts 用)。
2. **tree.ts**:`componentPropSlots: Map<string, ComponentSlot>`;TEXT 分支 `slot?.text`→IRExpression;**构造 IRElement 后**若 `slot?.className`→`classNameProp = slot.className.name`;`resolveComponentRef` 用 `isSupportedOverrideInstance`,`resolveInstanceProps` 出 text props(value=instChild.text,kind text)+ className props(value=`tailwindClassName(instChild)`,kind className);`ComponentDef.props` 扁平化 slots 的 text+className。
3. **emit/element.ts**:IRElement emit——`classNameProp` set → `className={classNameProp}`(替静态 `className="..."`)。
4. **emit/component.ts**:签名 props 含 className-kind(default = class 字符串,JSON.stringify escape)。
5. **react index.ts collectClassNames**:componentRef arm 对 `node.props` 里 kind==='className' 的 value `addClasses`(body 默认经 node.className 已收)。

### 8v3.5 成功标准

- fill-override dirty instance → `<Card badgeClassName="bg-blue-500 .."/>`,子树 NOT 内联;组件签名 `badgeClassName = "bg-red-500 .."`(master 默认)。
- body 该 child emit `className={badgeClassName}`。
- text + fill 同 child → 两 prop(`title` + `titleClassName`)。
- 含 size/font override → 仍内联(v1/v2 回归)。
- instance 传的 className 进 safelist(iframe 不被剥)。
- master + clean instance 仍 `<Card/>`(默认)。
- `bun run check` exit 0。

### 8v3.6 Post-mortem

CODE COMPLETE 2026-06-02。完全符合设计:

- **className prop = 整条 child className**(锁定 fork):`IRElement.classNameProp?`,set 时 emit `className={prop}`;`node.className` 保留静态值作默认 + safelist。零 twirl 耦合。component.ts 签名 emit **零改动**(className-kind 也是 string prop + JSON.stringify default,与 text-kind 同形)。
- **propSlots 升格** `Map<masterChildId, ComponentProp>`→`Map<masterChildId, ComponentSlot{text?, className?}>`(一个 child 可 text+fill 两 prop);`ComponentProp`/`ComponentRefProp` 加 `kind:'text'|'className'`(driving safelist:只 className-kind 值进 collectClassNames)。
- **safelist 两边**:body 默认经既有 `walk(node.className)` 自动收(classNameProp 不动 node.className 是关键);instance 传值经 collectClassNames componentRef arm 新增 `prop.kind==='className'→addClasses`。**probe 实测**:red→`bg-[#FF0000]`(大写 hex,full-alpha 截断),不是 `bg-[#ff0000]`——测试断言对齐。
- **资格扩展** `isTextOnlyInstance`→`isSupportedOverrideInstance`(key ∈ {`:text`,`:fills`});v2 旧测试原用 `:fills` 断言 inline 现在变 prop → 改用真正不支持的 `:fontSize` 保 inline 回归。
- **lint**:`colon < 0` 被 `unicorn/consistent-existence-index-check` 拦 → `=== -1`(×2)。改 src 必 `build:packages` 再 lint(§10/§8v2 同款)。
- **override 值同 v2 取自 instance child**:fill 值 = `tailwindClassName(instChild)`(canvas 真值);editor 正经改 = `updateNode(child,{fills}) + 标 `${childId}:fills` marker`。
- **测试**:components-fill-props.test.ts 5 新(prop 默认/传值不内联/safelist/text+fill 双 prop/fontSize 仍内联)+ v1/v2 旧 11(改 1 个 `:fills`→`:fontSize`)= 16/16;compiler 全套 457/0;`bun run check` exit 0。

**§8 v4 follow-ups:** size/font override→props;COMPONENT_SET variants;编辑器组件 props 面板(GUI)。

## §8 v4 COMPONENT_SET variants — 一个组件 + 每轴 variant prop(设计 2026-06-02)

> §8 v3 follow-up。用户 2026-06-02 挑定。两 fork AskUserQuestion 锁定 = **每轴一个 prop** + **variant-only(有 override→内联)**。

### 8v4.1 现状与问题

variant 在 scene-graph = COMPONENT_SET 容器的 COMPONENT 子节点,子名形如 `"Size=Large, State=Default"`(`parseVariantName`→`{Size:'Large',State:'Default'}`);INSTANCE 经 `componentId` 指向某个 variant 子。**当前**:每个被实例化的 variant 子是独立 COMPONENT → 各自注册成 `<SizeLarge/>`,SET 容器内联成 div。丢了「一个组件 + variant prop」抽象,且同语义按钮散成 N 个组件。

### 8v4.2 关键决定

| # | 决定 | 取舍 |
|---|---|---|
| 1 | **COMPONENT_SET → 一个组件,每 variant 轴一个 string-union prop** | `<Button size="small" state="hover"/>`,prop 名 = sanitize(轴名),类型 = 该轴 options union,默认 = 默认 variant 的轴值。组件内 join 成 key、if-chain switch 各 variant 子树。否决单 `variant` prop(多轴不友好)。 |
| 2 | **variant-only;variant instance 带任一 override → 内联** | v4 只管 variant 选择。clean variant instance → `<Button size=.. />`;带 `:text`/`:fills` override → 整棵内联(v1 fallback)。compose(variant + v2/v3 props)留 v5,避免「跨 variant union prop 槽 + switch 每支参数化」复杂度骤增。 |
| 3 | **轴/options/默认从 variant 子名派生**(robust,不依赖 componentPropertyDefinitions) | 轴 = 所有 variant 子 `parseVariantName` key 的并集(首见序);options = 各轴值并集;默认 = **第一个 variant 子**的轴值(确定性,不依赖 SET 可能为空的 componentPropertyDefinitions)。 |
| 4 | **instance→SET 经 parent 走查,不另存 map** | INSTANCE.componentId → variant 子节点 → 其 `parentId` 是已注册 COMPONENT_SET → 用 SET 组件名 + `parseVariantName(子名)` 出 variant props。registry 注册 SET、**排除** variant 子的独立注册(parent 是 COMPONENT_SET 的 COMPONENT 跳过)。 |
| 5 | **switch emit:其余 if-guard + 默认 variant 兜底 return**(不重复子树) | `if(__v===k2) return <c2>; … return <c1默认>`。未传 prop→默认轴值→落兜底;非法组合→也落兜底。 |

### 8v4.3 公开 API / Schema 改动(零 scene-graph / round-trip)

- `ir/types.ts`:`ComponentPropKind` 加 `'variant'`(variant prop 值不进 safelist,同 text);新 `VariantAxis {name; rawName; options; defaultValue}`、`VariantCase {key; children: IRNode[]}`;`ComponentDef` 加 `variantAxes?`、`variants?`。
- `ir/collect/components.ts`:`ComponentMeta` 加 `variants?: { axes: VariantAxis[]; cases: {childId; values}[] }`。

### 8v4.4 内部实现拆解

1. **components.ts**:`buildComponentRegistry` 三类扫描——plain COMPONENT(parent 非 SET)走 v2/v3;**parent 是 COMPONENT_SET 的 COMPONENT 跳过**(variant 子);COMPONENT_SET 若任一 variant 子有实例 → 注册 `{name, propSlots: empty, variants: buildVariants(set, kids)}`。`buildVariants`:轴并集 + options + 默认(首子)+ cases `{childId, values}`。
2. **tree.ts**:collectComponents SET 分支——每 case 走 `graph.getChildren(childId)` 出子树 IR(**不**设 componentPropSlots,variant-only),`key = axes.map(a=>values[a.rawName]).join('|')`;`ComponentDef.variants`/`variantAxes` 填充(plain 组件 children/props 照旧)。`resolveComponentRef`:INSTANCE.componentId→variant 子→parent SET 已注册→**有 override 返回 null 内联**,否则 ref(SET 名 + `parseVariantName` 出 `ComponentRefProp{kind:'variant'}`)。
3. **emit/component.ts**:`def.variants` 在场 → 每轴 prop(union 类型 + 默认)+ `const __v = \`${a1}|${a2}\``+ if-chain(其余)+ 默认 case 兜底 return,各 case 包 `<div className={className}>`。无 variants → v2/v3 路径。
4. **emit/element.ts** componentRef arm 不变(variant prop 同 `name="value"` attr)。
5. **react index.ts collectClassNames**:walk `def.variants?.[].children`(SET 子树类不在 def.children);componentRef variant-kind prop **不** safelist(同 text)。

### 8v4.5 成功标准

- COMPONENT_SET(≥1 variant 实例)→ 一个 `src/components/<Set>.tsx`,每轴 string-union prop + 默认。
- clean variant instance → `<Button size="small" state="hover"/>`,选对子树。
- 未传轴 → 默认 variant;多轴 join key switch 正确。
- variant instance 带 override → 内联(variant-only)。
- 各 variant 子树的类进 safelist。
- 既有 plain COMPONENT(v1/v2/v3)零回归。
- `bun run check` exit 0。

### 8v4.6 Post-mortem

CODE COMPLETE 2026-06-02。符合设计,几处机械修正:

- **核心公开面新增**:`parseVariantName` 原只经 `#core/scene-graph/variant-name`(package-local alias)用,compiler 够不到 → 从 `scene-graph/index.ts` barrel **re-export**(`@open-pencil/core/scene-graph`),纯 util,稳定。否决在 compiler 重写(jscpd threshold 0 会判 clone)。
- **registry 三类扫描**:plain COMPONENT(parent 非 SET)走 v2/v3;variant 子(parent 是 COMPONENT_SET)**跳过**(经 SET 出);COMPONENT_SET 有 instanced variant → 注册 `{variants:{axes,cases}}`。instance→SET 经 `instance.componentId→variant子→parentId→已注册SET` 走查,**不另存 map**。
- **emit switch**:`const __variant = \`${size}|${state}\``+ 其余 if-guard + 默认(首 variant)兜底 return,各 case 包 `<div className={className}>`。string-union prop 类型 `JSON.stringify`(双引号)——测试断言对齐 `"Large" | "Small"`(非单引号)。default 全 = 默认轴值的 instance → 0 props(`variantProps` 省略 == 默认的轴)。
- **lint 两修**:`meta.variants!` non-null assertion 禁 → 闭包外 `const variantMeta = meta.variants`;`defaultCase ?`(destructure 后类型非可选)always-truthy → 加 `variants.length===0` 早返 + 直用 `defaultCase`。
- **check:arch(steiger)**:`components-props`/`fill-props`/`variants` 三个 `components-` 前缀兄弟文件触发 prefer-domain-folders 规则 → **全部移进 `tests/engine/compiler/components/`**(`instances`/`text-props`/`fill-props`/`variants`.test.ts,git mv,import 用 `#tests`/package 别名不受位置影响)。**经验:同前缀兄弟测试文件 ≥3 触发 steiger,提前用子目录。**
- **测试**:components/variants.test.ts 6 新(一组件每轴 prop / 实例传非默认轴值 / 默认实例 0 props / variant 子不独立注册 / 带 override 内联 / 子树类进 safelist)+ v1/v2/v3 移入子目录共 22/22;scene-graph+compiler 608/0;`bun run check` exit 0。

**§8 v5 follow-ups:** variant + text/fill props compose(variant instance 也参数化子树文案/色);COMPONENT_SET 的 componentPropertyDefinitions 显式默认(当前用首子);编辑器组件 props 面板(GUI)。

## §8 v5 variant + text/fill props compose — COMPONENT_SET 变体也能参数化子树文案/色(设计 2026-06-02)

> §8 v4 follow-up。用户 2026-06-02 挑定。一 fork AskUserQuestion 锁定 = **B 按 name 合并 prop + per-variant 回退**(否决 A 每节点一 prop:同名节点跨 variant 会得 `label`/`label2` 冗余 prop)。

### 8v5.1 现状与问题

§8 v4:COMPONENT_SET → 一个组件 + 每轴 variant prop,但 **variant instance 带任一 override → 整棵内联**(`resolveComponentRef` SET 分支 `Object.keys(node.overrides).length > 0 → return null`)。真实用法是「同一 Button SET,Large/Small 两变体,每个实例还改自己的 label 文案/badge 颜色」—— v4 一旦改文案就退回重复子树,丢了 SET 复用 + v2/v3 的 prop 化。v5 让 variant instance **同时** 传 variant prop 和 text/fill prop:`<Button size="Small" label="点我" badgeClassName="bg-red-500"/>`。

难点 = **跨 variant 的默认值**:同一逻辑 prop(如 `label`)的字面默认在不同 variant 子树里可能不同(Large 的 label 节点 vs Small 的 label 节点是不同 node id、可不同文案),但一个 prop 只能一个签名默认。

### 8v5.2 关键决定

| # | 决定 | 取舍 |
|---|---|---|
| 1 | **variant instance 支持 override 复用 v2/v3 判据** | variant instance 的 override 全 ∈ {`:text`,`:fills`}(`isSupportedOverrideInstance`)→ 不内联,compose;含任一不支持 override → 仍内联(v1 fallback)。与 plain 组件同一条 `isSupportedOverrideInstance` 闸,零新判据。 |
| 2 | **prop 按 name 合并跨 variant(锁定 B)** | 同名 master 后代(各 variant 子树里 name 相同的节点,Figma variant 本就结构平行)合成**一个** prop。prop 名 = sanitize(layer name),跨 variant 去重。否决 A(每被 override 节点一 prop → 同名节点得 `label`/`label2` 冗余)。 |
| 3 | **per-variant 回退 emit**`{prop ?? 该variant自己字面}` | 一个 prop 多个默认 → 签名里 **不给** 默认(`label?: string`),每个 variant 子树节点 emit `{label ?? "该节点自己文案"}` / `className={cls ?? "该节点静态类"}`。clean / 未传 prop 的实例 → 各 variant 保留自己默认;传了 → 跨所有 variant 生效。 |
| 4 | **fallback emit 落 JSX 层,不动 core ExprAst** | 表达式子语言无 `??`(BinaryOp 无),加它要改 core lowcode-validation 跨包。改为:text prop 的 `IRExpression` 加可选 `fallback?: string`,className 走 `IRElement.classNameProp` + 既有静态 `className` 当回退,emit 时拼 `?? "<literal>"`。本地化 2~3 行 emit 改动。 |
| 5 | **回退只在 SET(variant)子树用;plain 组件 v2/v3 emit 零改动** | plain 组件单子树单默认,`{prop}`+签名默认正确,保持不动(不碰 v2/v3 测试)。SET 子树才走 fallback 形。由 `componentPropSlots` 的来源(SET vs plain)区分:SET 注入 `slot` 时带 fallback 标记。 |
| 6 | **GUI 授权面板仍延后** | 沿用 §7/§8/§10 先例,纯 compiler-emit 增量。 |

### 8v5.3 公开 API / Schema 改动(零 scene-graph / round-trip)

- `ir/types.ts`:`IRExpression` 加可选 `fallback?: string`(§8 v5 variant text prop 的 per-variant 字面回退,emit `{<expr> ?? "<fallback>"}`);`IRElement` 加可选 `classNamePropFallback?: true`(set 时 className prop emit `className={<prop> ?? "<静态className>"}`)。两者都只在 SET variant 子树里出现。
- `ir/collect/components.ts`:`ComponentSlot` 字段语义不变;`buildSetPropSlots` 新内部函数(按 name 合并 → 回填每 variant 子后代 node id),`ComponentMeta.propSlots` 对 SET 也填充(v4 是 empty)。

### 8v5.4 内部实现拆解

1. **components.ts**:`buildComponentRegistry` SET 分支——除 `buildVariants` 外,收集**所有** variant 子的实例(`kids.flatMap(k => instancesByComponent.get(k.id) ?? [])`)→ `buildSetPropSlots(graph, kids, instances)`。`buildSetPropSlots`:(a) 扫 override → `resolveMasterChild` → 后代 D(在某 variant)→ 按 D.name 建 `byName: Map<name, ComponentSlot>`(prop 名/默认从 D 派生,name 去重);(b) 遍历**每个** variant 子的全部后代,name 命中 byName → `slots.set(descendant.id, byName.get(name))`(同名节点跨 variant 共享同一 slot 对象 = 同 prop)。
2. **tree.ts**:`collectComponents` SET 分支——`collectChildSubtree(graph, c.childId, { ...baseCtx, componentPropSlots: meta.propSlots, variantBody: true })`(v4 不传 propSlots);`def.props` = `[...propSlots.values()]` 去重(同一 slot 对象多 node id 共享 → 用 Set 去重 prop 名)。`WalkCtx` 加 `variantBody?: boolean`。`collectChildNodes` TEXT prop 分支:`variantBody` 时 emit `{kind:'expression', ast:{ident:prop}, fallback: node.text}`(否则照旧无 fallback);`nodeToIR` className prop:`variantBody && classNameProp` 时置 `classNamePropFallback: true`。
3. **`resolveComponentRef` SET 分支**:去掉 `overrides.length > 0 → null`;改为 `isSupportedOverrideInstance(node)` 不通过才 null;通过则 `refOf(node, setMeta.name, [...variantProps(...), ...resolveInstanceProps(node, setMeta.propSlots, ctx.graph)], ctx)`。`resolveInstanceProps` 复用(instChild.componentId → variant 后代 → slot,读 instChild.text / `tailwindClassName`)。
4. **emit/component.ts** `buildVariantModule`:header/destructure 并入 `def.props`(text/className kind,**无签名默认**:`label?: string`,destructure 不给 `= ...`),variant 子树经 element emit 已带 `{prop ?? literal}`。
5. **emit/element.ts**:expression arm `node.fallback` 在场 → `{${emitExpression(ast)} ?? ${JSON.stringify(fallback)}}`;`formatAttrs` className prop:`classNamePropFallback` 时 `className={${prop} ?? "${escapeAttr(className)}"}`。
6. **react index.ts collectClassNames**:已 walk `def.variants[].children`(v4),variant 子树里 classNameProp 节点的静态 `className` 仍是默认 → 自动进 safelist;componentRef className-kind prop 值照 v3 进 safelist。

### 8v5.5 成功标准

- variant instance 带 `:text`/`:fills` override → `<Button size="Small" label=".." badgeClassName=".." />`(不内联)。
- 组件签名:variant 轴 union prop + text/className prop(后者 `?: string` 无默认);variant 子树节点 emit `{label ?? "本变体文案"}` / `className={cls ?? "本变体类"}`。
- clean / 未传文案的 variant instance → 各 variant 保留自己字面默认(零回归)。
- 同名后代跨 variant 合一个 prop(无 `label`/`label2` 冗余)。
- variant instance 含不支持 override(如 `:fontSize`)→ 内联。
- plain COMPONENT(v1/v2/v3)+ clean variant(v4)零回归;classNameProp 静态默认仍进 safelist。
- `bun run check` exit 0。

### 8v5.6 工作分解(~0.5–1 day)

types(2 可选字段)→ components.ts `buildSetPropSlots` → tree.ts(`variantBody` ctx + resolveComponentRef 放开 + fallback 注入)→ component.ts buildVariantModule 并入 props → element.ts fallback emit → 测试(components/variants-compose.test.ts)→ `bun run check`。

### 8v5.7 Post-mortem

CODE COMPLETE 2026-06-02。完全符合设计,无意外,几处机械修正:

- **跨 variant 默认走 name-merge + `??` 回退(锁定 B)**:`buildSetPropSlots` 用 `accumulateSlots(…, c=>c.name)` 按 name 聚合槽(同名跨 variant 合一 prop),再 `descendantsOf` 把 name-keyed 槽**扇出**到每个 variant 子的全部后代 node id(walker 按 id 查)。`resolveComponentRef` SET 分支去掉 v4 的 `overrides.length>0→null`,改判 `isSupportedOverrideInstance`(复用 v2/v3 闸):支持 → `[...variantProps, ...resolveInstanceProps(node, setMeta.propSlots, graph)]` compose;不支持(如 `:fontSize`)→ 仍内联。
- **回退 emit 落 JSX 层,零碰 core ExprAst**(决定 #4 兑现):`IRExpression.fallback?`(emit `{<expr> ?? "literal"}`)+ `IRElement.classNamePropFallback?`(emit `className={prop ?? "literal"}`)。两者只在 `ctx.variantBody` 为 true 时由 tree.ts 注入,plain 组件 v2/v3 emit(`{prop}`+签名默认)**零改动**。
- **lint 复杂度闸**:加两条 fallback 分支后 `emitElement` cyclomatic complexity 21 > 20 → 抽出 `tryInlineSingleChild` + `emitExpressionWithFallback` 两 helper(单子内联 + 表达式回退拼接),降回 < 20。**经验:emit 函数加分支前先看它离 complexity-20 闸多近。**
- **jscpd 0-clone 闸**:`buildSetPropSlots` 的「override→槽」内循环与 `buildPropSlots` 6+14 行重复(只差 map key = node id vs name)→ 抽 `accumulateSlots(graph, instances, keyOf)`,两者各传 `c=>c.id` / `c=>c.name`。**经验:新函数若复用既有循环只改一个 key,优先抽参数化 helper,别拷贝(jscpd threshold 0)。**
- **v4 测试改判**:原 v4「variant instance 带 override → 内联」用的是 `:text` override(v5 现 compose)→ 改用真正不支持的 `:fontSize`(对齐 v2→v3 先例),保 inline 回退回归。
- **safelist 零改动**:react index.ts `collectClassNames` v4 已 walk `def.variants[].children`,variant 子 classNameProp 节点的静态 `className`(回退默认)自动进 safelist;componentRef className-kind prop 值照 v3 进。variant-kind prop 不 safelist(对)。
- **测试**:components/variants-compose.test.ts 7 新(`:text` compose 不内联 / text prop 无签名默认 + 每 variant body `{label ?? 本变体文案}` / 同名跨 variant 合一 prop 无 label2 / clean 实例保自己默认 / `:fills`→className prop 带回退 / text+fill 同传 / 默认 variant + text override)+ v4 改 1 = 29/29;compiler 470/0;`bun run check` exit 0(jscpd 0 clones、complexity < 20、tsgo 0)。

**§8 v6 follow-ups:** COMPONENT_SET 的 componentPropertyDefinitions 显式默认(当前用首子);component props 编辑器面板(GUI);size/font 等非 fill/text override → props。

## §8 v6 override→props 全推广 — 所有非-text 视觉 override 都映射成 className prop(设计 2026-06-02)

> §8 v5 follow-up。用户 2026-06-02 挑定。一 fork AskUserQuestion 锁定 = **A 全推广**(否决 B 白名单 font/size,冗长且要随 INSTANCE_SYNC_PROPS 维护;否决 C componentPropertyDefinitions 默认,窄+依赖可能为空字段)。

### 8v6.1 现状与问题

§8 v2 把 `:text` override 映射成 content prop,v3 把 `:fills` 映射成整条 className prop;**其余 override(`:fontSize`/`:strokes`/`:opacity`/`:cornerRadius`/`:width`/layout/padding/…)仍走内联回退**——instance 改个字号就退化成重复子树。Recon 坐实(经验 E):override key 宇宙 = `${childId}:${prop}`,`prop` ∈ INSTANCE_SYNC_PROPS(width/height/fills/strokes/effects/opacity/cornerRadius/layout/padding/grid/border…)∪ {name,text,fontSize,fontWeight,fontFamily,textDirection}(instances.ts)——**全是属性级,无结构级 override(无子节点增删/swap)**。而 v3 的 className prop 取的是 `tailwindClassName(instChild)` = child 整条重算 className → **天然囊括 fill+font+size+stroke+opacity+corner+… 一切视觉发散**。所以「只 fills 支持」是人为限制:任何非-text 视觉 override 都能走同一条 className prop。

### 8v6.2 关键决定

| # | 决定 | 取舍 |
|---|---|---|
| 1 | **override 三分类:text / ignore / className**(锁定 A) | `overrideKind(key)`:`:text`→content prop;`:name`→ignore(非视觉改名,不出 prop 也不内联);**其余一律 className**(整条 className 重算)。否决白名单(B):无结构 override → 无需枚举,默认 className 即正确。 |
| 2 | **取消 property override 的内联回退** | suffix 宇宙全属性级 → 所有 instance 都 compose。`isSupportedOverrideInstance` 闸删除,`resolveComponentRef` instance 永远出 ref(plain + variant 一致)。faithfulness 不丢(text content prop + 整条 className 重算覆盖一切视觉)。 |
| 3 | **同 child 多个非-text override 合一个 className prop** | accumulateSlots 已是 `!slot.className` 一次性建槽;resolveInstanceProps 加 `seen` Set 去重(多 key→一次 push),避免 `boxClassName=` 重复 attr。 |
| 4 | **零新 emit / 零 IR 改动** | 复用 v3 的 `IRElement.classNameProp` + v5 的 `classNamePropFallback`(variant 子树仍 per-variant 回退);ComponentPropKind 不变(className 已涵盖)。 |
| 5 | **GUI 面板仍延后** | 沿用 §7/§8/§10 先例。 |

### 8v6.3 公开 API / Schema 改动(零 scene-graph / round-trip / IR)

- `ir/collect/components.ts`:删 `FILLS_OVERRIDE_SUFFIX`、`isSupportedOverrideInstance`;新 `overrideKind(key): 'text'|'className'|'ignore'`(导出,tree.ts 复用)+ `NAME_OVERRIDE_SUFFIX`。
- 无 ir/types.ts 改动(className prop 机制 v3/v5 已就位)。

### 8v6.4 内部实现拆解

1. **components.ts**:`overrideKind` 三分类替代 `:text`/`:fills` 判定;`accumulateSlots`(v5 抽的共享累加器)`:text`→text 槽、`className`-kind→className 槽(整条重算默认)、`ignore`→跳过。`buildSetPropSlots`(v5)无改动——经 accumulateSlots 自动覆盖所有视觉 override。
2. **tree.ts**:`resolveComponentRef` 删两处 `isSupportedOverrideInstance` 闸(plain + SET),instance 永远出 ref;`resolveInstanceProps` 用 `overrideKind` 分类 + `seen` Set 去重 className(同 child 多视觉 override→一次 push,值=整条 `tailwindClassName(instChild)`)。body 的 classNameProp 注入(v3/v5)无改动。
3. **emit**:零改动(className prop + 回退 emit v3/v5 已就位)。
4. **safelist**:零改动(className-kind prop 值进 safelist 是 v3 路径;现所有视觉 override 都产 className prop,其重算 className 串自动进)。

### 8v6.5 成功标准

- instance 任一非-text 视觉 override(fontSize/strokes/opacity/cornerRadius/size/…)→ compose 成 `className={prop}` + 实例传整条重算 className(不再内联)。
- 同 child 多个非-text override → 一个 className prop(不重复 attr / 不 label2)。
- `:text` 仍 content prop;`:name` 忽略(不出 prop、不内联)。
- variant instance 同样(v5 compose 推广到所有视觉 override)。
- clean instance / 纯 master 零回归;v2/v3/v4/v5 既有行为(text content prop、fills className、variant prop)零回归。
- `bun run check` exit 0。

### 8v6.6 工作分解(~0.3 day)

`overrideKind` 三分类(components.ts)→ 删 isSupportedOverrideInstance + 两处闸(tree.ts resolveComponentRef)→ resolveInstanceProps 分类 + seen 去重 → 改 3 个旧「unsupported→inline」测试为 compose + 新 override-props-general.test.ts → `bun run check`。

### 8v6.7 Post-mortem

CODE COMPLETE 2026-06-02。完全符合设计,零意外:

- **核心 = 一个三分类器**:`overrideKind(key)` text/ignore/className,默认 className(整条 `tailwindClassName(instChild)` 重算囊括一切视觉)。删 `isSupportedOverrideInstance`(suffix 宇宙全属性级 → 无「不支持」可言,instance 永远 compose);resolveComponentRef 两处闸删除。`resolveInstanceProps` 加 `seen` Set 防同 child 多视觉 override 重复 push 同名 className prop。
- **block-comment 坑**:JSDoc 里写 `font*/layout` 的 `*/` 提前闭合块注释 → tsgo 一串 syntax error;去掉 `*` 即解(**经验:注释里别写裸 `*/`**)。
- **3 个旧测试改判**:v1 instances / v3 fill-props / v4 variants 各有一个「`:fontSize`(unsupported)→inline」测试,v6 后 fontSize 也 compose → 全改为断言 className prop compose(给 instChild 真改 fontSize 再断言 `ClassName="..."` 传值 + 3 refs 不内联)。+ override-props-general.test.ts 2 新(同 child 三 override 合一 prop / stroke-only compose)。
- **零 emit / 零 IR / 零 scene-graph 改动**:全靠 v3 className prop + v5 fallback 既有机制;safelist 零改动。compiler 472/0(+2),components 29→已含;`bun run check` exit 0。

**§8 v7 follow-ups:** componentPropertyDefinitions 显式默认;component props 编辑器面板(GUI);nested-instance / boolean(visible)override(目前 `:visible` 不映射,collectTailwindClasses 忽略 visible)。

## 4–13. 候选 §X 详细设计(待用户挑定后扩写)

> 用户挑定某条 §X → 回本 doc 把对应小节改写成「详细设计 + 锁定决定」格式(参考 Phase 2 §2 / §3 / §4 / §6 / §7 / §8 / §9 任一已收尾节 + 本期 §2 / §3 结构:§X.1 现状与问题、§X.2 关键决定表、§X.3 公开 API / Schema 改动、§X.4 内部实现拆解、§X.5 成功标准、§X.6 工作分解、§X.7 风险、§X.8 Post-mortem)→ 对话锁主决定 → 用户 ACK 次级默认 → 分 step commit + Tauri 实测。

§4 多人协作 / §5 部署 / §6 Kiwi schema / §7 响应式 / §8 Symbol / §9 i18n runtime / §10 工作流 / §11 §3.v2 fetch / §12 §4.v2 表达式 / §13 SWITCH CSS —— 简述见 §1.1 表。
