继续 lowcode-phase-0 分支。HEAD = `c7a96d6`。

Phase 3 §2 Supabase 🔒 + §3 AI tool surface 🔒 + §3.x INPUT controlled 🔒(全 2026-05-26)+ §3.v2 mega-undo 🔒 + §3.v3 UI 补全 🔒 + §3.v4 7 controlled bindings 🔒(全 2026-05-27)+ §3.v5 SWITCH CSS + RADIO/CHECKBOX inline 🔒 + §3.v6 InteractiveProps 通用编辑器 🔒(全 2026-05-28)+ §3.v7 DATEPICKER min/max range + ISO 校验 🔒 + **§3.v8 RLS policy advisor 🔒** + **§2.v2 Supabase auth action（signIn/signOut，第 7 个 ActionDef kind，推翻 §2 #5 6-kind 锁）🔒**(全 2026-05-29)。

**本会话起手:挑下一轮 mini-scope(#4 / signUp / §4 / §5 / 其它)+ 开设计**。

先读:

- `docs/lowcode-phase-3.md` §3.v8 全文(`3.v8.1-7` 设计 + `3.v8.8` post-mortem，含静态顾问 vs 实时探测的形态决定 + `(true)` 谓词决定 + 零-surprise 四连)
- `docs/lowcode-phase-3.md` §2.v2 全文(`2.v2.1-7` 设计 + `2.v2.8` post-mortem，含 7th ActionDef kind + emit 内联 `getSupabaseClient().auth.*` + `$currentUser` Q2 洞)
- `docs/lowcode-phase-3.md` §3.v7.8 + §3.v6.8 post-mortem(经验 J/K 演化)
- memory:user-role、lowcode-fork、lowcode-phase-1-progress、lowcode-phase-2-progress、**lowcode-phase-3-progress**(§3.v7 + **§3.v8** + **§2.v2** 全章节 + 候选池 + 经验 A–K)、lowcode-jsx-export-gotchas、lowcode-preview-modifier-key

## 上一会话已交付（§3.v8 + §2.v2，10 commits）

| 工作 | commits | 备注 |
|---|---|---|
| §3.v8 RLS policy advisor | `6cad85b`(设计)→`ec0c952`(step1 共享 `rls-advisor.ts`)→`3a1b973`(step2 panel 子区)→`c7a96d6`(close) | Tauri 7/7 ✅；**零-surprise 第四连**(§3.v5-v8)；静态 usage-driven 顾问，不做实时探测 |
| §2.v2 Supabase auth action | `c0190c2`(设计)→`e3c4bd3`→`e5444a3`→`1b4a48a`→`a8954b6`(step1-4)→`47fb59a`(Q2 提示)→`862f4da`(ACK doc)→`c7a96d6`(close) | Tauri 7/7 ✅；wiring 首过零 bug；**1 个 Q2 可发现性洞($currentUser)Tauri 找出 + mid-ACK 补**；**推翻 §2 #5 6-kind 锁** |

`bun run check` 0 error / 4(type-aware)·5(structure)pre-existing max-lines / 0 clones / locales 同步；429/429 compiler+tools 测试零回归。

**§3.v8 关键**:PostgREST 对 RLS-拦截 / 0-行-匹配返回相同(204/`[]`)→ silent-0-row footgun 不可靠探测，且无 live 实例不可 probe PostgREST 语义 → 形态选 A(静态推导 + 用户 ACK 验 SQL 跑通)。决 d 的 Postgres USING(SELECT/DELETE)/WITH CHECK(INSERT)/both(UPDATE) 矩阵实测成立。

**§2.v2 关键**:auth scope 从 §3.v8 ACK #3 孵出(`TO authenticated` policy 无代码路径触达 → 用户挑「顺手弄 signIn/signOut」)。emit 用 `getSupabaseClient().auth.*` **内联非 hook**(镜像 supabaseMutation)。signIn `{data,error}` / signOut `{error}` 已 `bun -e` probe。`$currentUser` 自动注册、不在 DocumentState 面板、editor 只语法校验(绑 `$currentUser.signedIn/.email` 不误红)。

## 下一轮候选池(#1/#2/#3/#5/#6 已消化)

| # | 候选 | 来源 | 体量估 | 状态 |
|---|---|---|---|---|
| 4 | `$event` / `$value` token in expression grammar | §3.8 follow-up #4 沿用 | ~3 day(§4.2 FROZEN 绕路)| open(最后一个交互控件 follow-up)|
| NEW | **signUp action**（Supabase Auth 注册） | §2.v2 follow-up | ~1 day（镜像 signIn）| open（§2.v2 只做了登录/登出，注册还得去 Dashboard 手建测试用户）|

更大方向:§4 多人协作(Trystero+Yjs 已在)/ §5 部署管线(依赖 §2)/ §6 Kiwi schema / §7 响应式 / §8 Symbol / §9 i18n runtime / §10 工作流 / §12 表达式扩展。

**注:交互控件链 + Supabase 数据/认证链已相当完整**（§3.x/§3.v2-v8 全闭 + §2.v2 auth 闭环 + §3.v8 RLS 顾问）。

**推荐**(对话锁前):
- **A. signUp 收尾**:signUp action(~1day，镜像 signIn 第 8 个 ActionDef kind 或复用 supabaseAuth 加 `'signUp'` operation)—— 补完认证三件套(登录/登出/注册)，体量小，无需 Dashboard 手建测试用户
- **B. 表达式增强**:#4 `$event`/`$value` token(~3day)—— 最后一个交互 follow-up，解锁 controlled onChange 里读 e.target，要谨慎绕 §4.2 FROZEN
- **C. 转 §4 协作 / §5 部署**(产品节奏决定)—— 交互 + 数据 + 认证链已完整，推荐转向产品级能力

### 起手对话

我先列 A/B/C 三选，等用户挑;挑定后:
- 开 §X 详细设计草案(§X.1 现状 / §X.2 8 主决定 + 8 次默 / §X.3 API / §X.4 实现拆解 / §X.5 ACK 表带 **Q1+Q2+Q3 三问题反向核** / §X.6 step 分解 / §X.7 风险 / §X.8 post-mortem stub)
- 用户 ACK → commit 设计 → 起 step 1

若用户直接说"起 #N"或"起 §4"或类似具体指令，跳问直接开。

## 经验(A–K，全继承;K 已升正)

| 经验 | 一句话 |
|---|---|
| A | Walker 漏 case(union widening)→ grep + 双轮 + cross-walker 回归 + dedup helper 抽取(jscpd 钉)|
| B | Tauri 拖拽 `dragDropEnabled: false` 不要动 |
| C | JSON / expr / date parse 不 swallow，surface 错误(IR warning + UI 警告条双面)|
| D | emit 产物新 npm import 必须进 `packages/compiler` devDeps + preview-resolve 回归 |
| E | 跨 §X 能力链设计阶段核对接口（静读 emit 真源对齐）。**§2.v2 印证**:静读 `emit/event.ts` 确认 supabase action 用 `getSupabaseClient()` 内联非 hook → signIn/signOut 才能同模式 emit 无需 hook hoist，避免一个潜在大坑 |
| F | 别全仓 `bun run format`(140 文件 pre-existing drift)|
| G | union widening → helper-first；**§2.v2 印证**:`ActionDef` 6→7 kind，tsgo `never` exhaustive 只逼出 1 处(tool buildAction)，step 1 即扫平保持 build 绿 |
| H | Tauri 实测找设计层洞(链路缺失 / UI 引导缺失 / 心智模型错位)；**§2.v2 再印证**:wiring 全对(Q1/Q3 首过)Tauri 仍找出 1 个 **Q2 可发现性洞($currentUser)**——同 §3.v2 ACK#1/#2 类，测试不可能发现 |
| I | 新 export / import / ALL_TOOLS / i18n key cross-walker 必含 import 行 + check-locales 正负断言；`scripts/` + `tests/` untracked 也进 `lint:structure`；加测把 test 推过 600 会新增 warning → 拆独立文件(§2.v2 `auth-action.test.ts` 独立避免 modify.test.ts 破 600)|
| J | **3 问题反向核**(Q1 技术链 / Q2 UI 引导 / Q3 心智模型)— 每条 §X.2 决定必走；Q3/Q2 洞在设计阶段发现 → 升回决定表 / AskUserQuestion 让用户定。**§3.v8 印证**(两 Q3 岔口 AskUserQuestion 锁 → 零 surprise)；**§2.v2 反例**:Q2 列只核了 auth 表单本身 affordance，漏了下游「登录态在哪浮现」的可发现性 → Tauri 找出 → mid-ACK 补。**教训:Q2 不只核"配置入口有没有引导"，还要核"结果/状态在哪儿浮现给用户"** |
| K | **(正式)依赖运行时形状/默认值/边界行为的决定必须 runtime probe**(`bun -e`/单测/静读真源)。§2.v2 印证:signOut `{error}` 无 data / signIn `{data,error}` 已 `bun -e` probe → emit 一次对。**边界**:probe 不了(如无 live Supabase 探 PostgREST RLS 语义)→ 别假装能探测，改确定性静态推导 + 用户 ACK 验(§3.v8 形态决定)|

详 `docs/lowcode-phase-3.md` §3.v7.8 + §3.v8.8 + §2.v2.8 post-mortem。

## 已锁文字面值(全继承 + §3.v8 + §2.v2 新增)

**§3.v8 锁**:
- `packages/core/src/lowcode-validation/rls-advisor.ts`:`collectRlsRequirements(actions)` / `buildRlsPolicySql(req)` / `RlsTableRequirement` / `SqlCommand`;barrel 导出 4 项
- operation→command:query=SELECT / insert=INSERT / update=UPDATE / delete=DELETE / **upsert={INSERT,UPDATE}**;固定序 `SELECT,INSERT,UPDATE,DELETE`
- SQL:Postgres USING(SELECT/DELETE)/WITH CHECK(INSERT)/both(UPDATE) 矩阵 + `(true)` 谓词 + `-- ⚠ replace before production` 注释 + `TO anon, authenticated`
- UI:SupabaseConfigPanel RLS 子区(`config && requirements.length` 才显)；test-id `lowcode-supabase-rls-advisor`/`-table`/`-sql`/`-copy`
- i18n:`lowcodeSupabaseRlsHeading`/`-WriteWarning`/`-Copy`/`-Copied`

**§2.v2 锁**:
- `SupabaseAuthAction { id, kind:'supabaseAuth', operation:'signIn'|'signOut', emailExpr?, passwordExpr?, errorTarget? }`(**无 resultTarget**);ActionDef union **7 kind**(推翻 §2 #5)
- `IRSupabaseAuthHandler { kind, operation, emailAst?, passwordAst?, references, errorTarget? }`
- emit:`getSupabaseClient().auth.signInWithPassword({email,password})`(signIn `{data,error}`)/ `.signOut()`(signOut **`{error}` 无 data**)；两者只解构 `{error}`，**不写 resultTarget**($currentUser 靠 onAuthStateChange 自动同步)
- IR collect `resolveSupabaseAuth`;warning 码 `action-supabase-auth-missing-credentials` / `-invalid-credential`
- tool:`KNOWN_ACTION_KINDS` += `'supabaseAuth'`;坏 expr reject、缺失 warn(决 g)
- UI:EventsPanel auth 表单(operation select + signIn email/password expr + errorTarget);**删 `AuthControls.vue`**;test-id `lowcode-action-auth-operation`/`-email`/`-password`/`-email-error`/`-password-error`/`-current-user-hint`
- i18n:删 5 `lowcodeAuth*`;加 `lowcodeActionSupabaseAuth`/`lowcodeActionAuthEmail`+Placeholder/`lowcodeActionAuthPassword`+Placeholder/`lowcodeActionAuthCurrentUserHint`/`lowcodeSupabaseCurrentUserNote`
- supabase emit 测试在 `tests/engine/compiler/adapters/react/emit/supabase/`(子文件夹，Steiger domain-folder)
- `$currentUser` = 自动注册保留 docState `{id,email,signedIn}`(`tree.ts` `currentUserBuiltIn()`);不在 DocumentState 面板;editor renderCondition/TextBinding 只语法校验

（§3.v7/§3.v6/§3.v5/§3.v4/§3.v3/§3.v2/§3.x/§3/§2 锁全继承，详见 memory + `docs/lowcode-phase-3.md` §1.6 + 各 §X.2。）

## 当前 uncommitted 改动

无(`c7a96d6` 后干净)。untracked(用户要求保留，不入仓):
- `lowcode-v5-test.fig` + `scripts/make-v5-testdoc.ts`(SWITCH/RADIO/CHECKBOX)
- `lowcode-v6-test.fig` + `scripts/make-v6-testdoc.ts`(全 8 类型，含 DATEPICKER)
- `prompt.md` 本身
- **注意**:`scripts/make-v*.ts` 在 `lint:structure` 扫描范围内，已 lint-clean(用 `@open-pencil/core/<subpath>` 而非 barrel)；改它们要保持 lint-clean

## 不要做的(全锁继承 + §3.v8 + §2.v2)

- 改 main 分支;`git push --force`;动 `tests/fixtures/*.fig` LFS pointer
- 撤销任一 §1.6 / §2.2 / §3.2 / §3.x / §3.v2.2 / §3.v3.2 / §3.v4.2 / §3.v5.2 / §3.v6.2 / §3.v7.2 / **§3.v8.2** / **§2.v2.2** 锁定决定（**例外:§2 #5 6-kind 锁已由 §2.v2 主动推翻为 7 kind，用户 ACK，别"恢复"成 6**）
- **§3.v8**:把形态从静态顾问改成实时探测(决 a，PostgREST 不可靠探测)/ 改 `(true)` 谓词为 auto-推断所有权(决 f)/ 改 upsert→{INSERT,UPDATE} 映射(决 c)/ 改 Postgres USING/WITH CHECK 矩阵(决 d)/ 改 `collectRlsRequirements`/`buildRlsPolicySql` 签名
- **§2.v2**:把 signIn/signOut emit 从 `getSupabaseClient().auth.*` 内联改成 hook hoist(决 c)/ 给 signIn/signOut 加 resultTarget(决 e，$currentUser 自动同步)/ 复活 `AuthControls.vue`(决 f)/ 改 `SupabaseAuthAction` shape / 在 tool 里 reject 缺失 credential(决 g 只 reject 坏 expr)/ 手动建 `$currentUser`(保留名，自动注册)
- **§3.v7/v6/v5/v4** 各自锁(详 memory)
- **bug**:从 `vite/server.ts` `WATCH_IGNORED` 移除 `.fig`/`.pen`;在 `scripts/` 放 barrel-import 脚本(卡 lint:structure)
- 改 `packages/core/src/kiwi/kiwi-schema/`(vendored)/ `@open-pencil/core/lowcode-validation` subpath 结构 / 6 lowcode tool snake_case 名 / `bindings.value` 通道 / `IRControlledInput` shape / `CONTROLLED_NODE_TYPES` / `payloadEntries` 系列
- 全仓 `bun run format`(经验 F);跑整个 `bun test ./tests/engine/`(慢 + LFS 失败)
- 拆 `tools/modify/lowcode.ts` / `bindings.ts` / `tree.ts` / `EventsPanel.vue` 多文件(同域，接受 max-lines warning)
- **设计阶段跳过 Q3 反向核**(经验 J)+ **Q2 只核配置入口、漏下游状态浮现**(§2.v2 教训)+ **依赖运行时形状的决定不 runtime probe**(经验 K)
- 用户主导的 Tauri 实测，不自动开 `bun run tauri dev`

## max-lines warnings(§3.v8/§2.v2 把几个文件养大，但 warning 数不增)

`bindings.ts`(§2.v2 加 `resolveSupabaseAuth` 后更大)/ `tools/modify/lowcode.ts`(加 `validateSupabaseAuthAction` + 描述段)/ `tree.ts` 782 / `scene-graph/types.ts`(加 `SupabaseAuthAction`)/ `tests/engine/kiwi/lowcode/plugin-data.test.ts` 603 —— 全 pre-existing 概念，splitting 违反惯例，接受。(type-aware pass 报 4 个、含 tests/ 的 structure pass 报 5 个，**数不增**。)`EventsPanel.vue`(~990 行，加 auth 表单)是 .vue 非 oxlint max-lines 扫描域。`modify.test.ts` 严格保持 600(auth tool 测试拆进独立 `auth-action.test.ts`)。

## 测试 / 验证命令(沿用)

每个 step commit 前跑:

```sh
bun test ./tests/engine/compiler/
bun test ./tests/engine/tools/lowcode/
bun run check
```

新 core 校验器 / kiwi 持久化改动加对应单测(`tests/engine/lowcode-validation/<file>.test.ts` / `tests/engine/kiwi/lowcode/<file>.test.ts`)。UI 面板类改动靠 Tauri ACK 验(无 e2e，沿先例)。

**不要**跑整个 `./tests/engine/`(15+ 分钟 + LFS 慢测 + 已知 pre-existing 失败:`kiwi/serialize-fixes/line/height.test.ts:44`、`tests/engine/scene-graph/plugin-data.test.ts` LFS fixture)。

IDE LSP `Cannot find module '@open-pencil/...'` / `#core/...` / `#tests/...` / `'vite'` 无视 —— 以 `bunx tsgo --noEmit` 和 `bun run check` 为准。

## 起手

第一件事:列 A/B/C 三选(A signUp action / B #4 `$event` token / C 转 §4 协作或 §5 部署)，AskUserQuestion。

挑定后:
- 开详细设计草案(§X.1-§X.7 + post-mortem stub)
- §X.5 ACK 表每条带 **Q1+Q2+Q3 三问题反向核**(强制；Q2 要核"结果/状态在哪浮现"，不只"入口有没有引导"——§2.v2 教训)
- 锁主决定 + 次默 → commit 设计 → 起 step 1

若用户直接说具体指令，跳问直接开。
