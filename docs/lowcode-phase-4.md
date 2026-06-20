# Phase 4 — Lowcode Platform on OpenPencil(re-baseline 后)

> 紧接 `docs/lowcode-phase-3.md` 与 memory `lowcode-rebaseline`。
>
> **基线**:fork 已 re-baseline 到上游 `open-pencil/open-pencil` 之上,分支
> `lowcode-rebaseline`(HEAD `04f54910`,与 mo-17 `upstream` 0/0 同步,与
> `official/master` 0 behind)。re-baseline 项目本身(Stage 1–16)+ 后续四条
> feature 线均已 code-complete 且 `bun run check` exit 0。
>
> **本 doc 的作用**:只列 **phase-3 未闭合的真剩余需求** + 优先级 + 每条 stub。
> **目前所有候选未锁定;实际开工前每条单独 AskUserQuestion 锁主决定 → 回本 doc
> 把对应 stub 扩写成「详细设计 + 锁定决定」格式 → 分 step commit → headless 验
> 证(Tauri 真机靠后)。不要自动开工任何候选。**

---

## 0. ⚠ phase-3 已闭合,不在本 doc 重列

phase-3(`docs/lowcode-phase-3.md`)已经把大量 feature 线一路做到收尾。**以下全部已交付、`bun run check` 绿,phase-4 不重列**,改这些前先读 phase-3 对应 §section:

| feature 线 | phase-3 闭合到 | 备注 |
|---|---|---|
| §2 Supabase 接入 | §2 + §2.v2–v4(auth signIn/Out/signUp/reset/update)| 5 auth ops + data + interactive |
| §3 AI-tools 生成/编辑 | §3 + §3.v2–v8(undo/payload/UI/controlled bindings/SWITCH CSS/InteractiveProps 框架/DATEPICKER range/RLS advisor)| |
| §4 协作 | §4.1–§4.6 + §4.3 self-host + §4.3-S Supabase signaling | code-complete,卡两机真机 ACK(见 §1.7)|
| §5 部署 | §5.1–§5.3 + Netlify §5.2 + Vercel §5.4 | code-complete,卡真 token ACK(见 §1.7)|
| §7 响应式断点 | §7 v1 + **§7 v2 re-show**(base-hidden→bp-visible 已实现)| GUI 授权面板延后(→ phase-4 #6/#7)|
| §8 自定义组件 | §8 v1–v11(clean→`<Component/>` / **v2 text→props** / **v3 fill/color→props** / **v4–v5 COMPONENT_SET variants** / v6 全推广 / v7 `:visible`→hidden / v8 instance `:visible` reverse / v9 nested-instance / v10 orphan 剪枝 / v11 override round-trip)| component-props 面板(GUI)延后(→ phase-4 #7)|
| §9 i18n | §9 v1–v14(react-intl runtime / locale 切换 / 属性串 / ICU 插值 / plural-select / 译文 catalog / **v11 RTL dir-flip** / CLI flags / 缺译警告)| 编辑器实时 preview i18n(GUI)延后(→ phase-4 #6);RTL **逻辑属性**(ms-/me-)是 v11 之上新增(→ phase-4 #3)|
| §10 工作流编排 | §10 v1–v11(condition/delay/stop / **v2 toast** / confirm/clipboard / **v4 named WorkflowDef** / **v6 callWorkflow 传参** / **v8 可选形参 emit** / v9 onSuccess/onError / v10 递归编辑器 / v11 callWorkflow GUI + WorkflowsPanel)| optionalParams **GUI** + 跨页 pageStates 延后(→ phase-4 #7/#8)|
| §15 UI-kit | §15 设计 + Phase A(Button/Input/Textarea/Label)+ Phase B(Select/Checkbox/Switch/RadioGroup)| FRAME→Card / Phase C / 实时 preview shadcn 未实现(→ phase-4 #1/#2/#6)|

> 一句话:**§8/§9/§10 链在 phase-3 已基本走完**,phase-4 的剩余只是它们各自被显式延后的 GUI 入口 + 几条没起头的新线(§14 / §15 收尾 / §9 RTL 逻辑属性 / CF Pages / Kiwi 升格)。

---

## 1. 范围

### 1.1 Phase 4 In-Scope(真剩余候选,待逐条承诺)

> 用户明确(prompt.md):**优先做功能,Tauri 真机测试靠后**;偏好「一个一
> 个来 / 直接干推荐项」,真大决策才单问一个 AskUserQuestion。headless 可验的
> 连续增量优先,真机 GUI 验证类候选排在后面。

| # | feature | 类型 | 优先级 | 简述 | 与 phase-3 关系 | 详写 |
|---|---|---|---|---|---|---|
| 1 | **§15 FRAME→Card 容器映射** | headless emit | **高(推荐起点)** | 容器型 FRAME(有 padding/背景/圆角)→ shadcn `Card`/`CardHeader`/`CardContent`,而非裸 `<div>` | phase-3 §15 设计标为「Phase B 可选」**但未实现**;本 phase 实现 | §15 |
| 2 | **§15 Phase C array checkbox-group** | headless emit | **高** | array 类型字段(多选)→ shadcn checkbox-group 排版(复用 §3.v5 RADIO/CHECKBOX inline 排版)| phase-3 §15 Phase A/B 后的下一档,未起头 | §15 |
| 3 | **§9 v15 RTL 逻辑属性(ms-/me-)** | headless emit(有回归面)| 中 | margin/padding 物理方向 → `ms-`/`me-`/`ps-`/`pe-` 逻辑属性,RTL locale 自动镜像 | **§9 v11 已做 dir-flip**;v15 是逻辑属性镜像,是 v11 之上**新增**(非重复)| §9 |
| 4 | **§14 跨文件组件库 / 团队库** | headless(大)| 中 | 组件跨 .fig 文件复用 / 团队共享库 / 更新传播(Figma Team Library 语义)| **phase-3 §14 已有完整设计但标〔未实现〕**;本 phase 才实现 | §14 |
| 5 | **更多 deploy providers(Cloudflare Pages 等)** | headless | 中 | Netlify/Vercel 已完整;CF Pages 直传需 **blake3**(Web Crypto 只有 SHA-\*)→ 违零依赖,**开工前必须 AskUserQuestion** | phase-3 §10 v7/v8/§7 v2 多次因 blake3 否决 CF Pages,留到本 phase 决策 | §5 |
| 6 | **编辑器实时 preview i18n / ui-kit toggle** | 真机 GUI | 高(真机)| `src/app/lowcode/preview-pane/use-compile-on-change.ts` 硬编码 `withDefaults`(无 i18n/uiKit)→ app 内 preview 看不到 i18n/shadcn。加 toggle | phase-3 §9 v13(CLI flags)修了 CLI 入口,**编辑器 preview 入口仍缺**;§15 Phase A 注明 preview 不带 uiKit | §9 / §15 |
| 7 | **§7 / §8 / §10 编辑器授权面板(GUI)** | 真机 GUI | 中(真机)| §7 responsive overrides 编辑面板;§8 component-props 面板;§10 optionalParams GUI(当前 MCP-only)| 三条线在 phase-3 **均显式「GUI 延后」**(沿用「先 emit/headless,GUI 真机」先例)| §7 / §8 / §10 |
| 8 | **§10 工作流体跨页 pageStates 精确** | headless | 低 | 工作流体当前取**当前页** pageStates 近似;跨页 callWorkflow 时应按目标页解析 | phase-3 §10 v11 已闭合 GUI 链,此为已知小缺口 | §10 |
| 9 | **lowcode 字段升格 Kiwi schema** | 工程债 | 低 | pluginData 旁路通道稳定;升格成本高(fork vendored `kiwi-schema/` + 通道重写 + 老 .fig 迁移),收益仅清债 | phase-3 §1.1 候选 5 / §6 的纯 **carry-over**(继续推迟)| §6 |

> **优先级建议**:headless 连续增量从 **#1 §15 FRAME→Card**起手(纯 emit 最干净),
> 接 **#2 Phase C**,再 **#4 §14**(组件能力线,量级大)。**#3 §9 RTL 逻辑属性**有
> 回归面、**#5 CF Pages** 卡 blake3 决策,二者需先沟通。真机 GUI 类(#6 #7)价值
> 高但靠后,攒一批一起在 Tauri session 验证。**#8/#9 低优先,随产品节奏挑。**

### 1.2 Phase 4 Out-of-Scope(明确推迟到 Phase 5+)

(继承 Phase 3 §1.2,仍未到时候)

- **多租户 / 多 workspace** —— Bubble 风格 workspace + member + billing
- **平台层付费用户系统** —— 区别于应用层 Supabase auth;平台自身订阅/计费
- **AI 自动 debug / 修复** —— 运行时 AI agent(§3 AI-tools 限定「生成/编辑」)
- **可视化数据流 DAG 编辑器** —— §10 工作流编排限定 ActionDef 链 + condition/delay/stop;Bubble Flow-style 节点 DAG 编辑器留 Phase 5
- **手机原生导出**(iOS / Android) —— 当前 emit 仅 React/Web;React Native / Capacitor / Tauri Mobile
- **插件系统 / Marketplace** —— 自定义节点类型 / 自定义 action 动态加载

### 1.3 Phase 4 整体成功标准(粗框,逐候选细化)

1. 本 doc §1.1 中所有承诺的候选各自 stub 扩写后的成功标准全过。
2. 不破坏 re-baseline 后的绿基线:`bun run check` exit 0;`bun test tests/engine/kiwi` 119/0(lowcode round-trip);`bun test tests/engine/compiler` 全绿;`bun test tests/engine/scene-graph` 全绿。
3. 不破坏 Phase 0/1/2/3 任一锁定的成功标准 —— 旧 demo / 旧 .fig 行为不变。
4. 既有 pre-existing fail 不回归(详见 §1.5):io 的 4 个 `material3.fig` EXCLUDE 基线;render/jsx 的 §6 `frame with children renders nested`。
5. headless 候选交付即算 code-complete;真机 GUI 候选由用户主导 Tauri 实测,不自己宣告通过。

### 1.4 Phase 4 继承的经验

**A–I 直接继承 Phase 3 §1.4**(walker 漏 case / Tauri 拖拽锁 / parse 不 swallow / emit 新 npm import 进 compiler deps / 跨 §X 接口预查 / 别全仓 format / union widening helper-first / UX 显示元素 vs 后台同步 / emit 全绿 ≠ 跑得起来 module-resolve 维度)。下面是 re-baseline 期 + Phase 4 新增/强化的:

| 经验 | 内容 |
|---|---|
| **J. 上游 merge:relocate 而非 gut** | dev 脚本只用公共包导出时迁 `tools/` 零 import 破坏。3-way 交错冲突(上游重构成函数 + 我们加字段)= 重写整段而非逐 marker,把我们字段折进上游新函数签名;两侧独立贡献 pluginData 的,串调用顺序。**本会话实证**:`4bc1698e` 合入 = 2 个纯 import 行冲突取并集(`isAutoLayoutMode` value + 上游 `SceneGraph`/`SceneNode` type) |
| **K. `scripts/*.ts` 必须是单行 shim** | 上游 steiger 规则 `scripts-are-entrypoint-shims`:`#!/usr/bin/env bun` + `import '../tools/...'`。实现逻辑放 `tools/<domain>/src/`(kebab domain,`strictToolsLayout`;每 tool 一个 minimal `package.json`,tools/* 非 workspace 成员)。`check` 现含 `test:tools` |
| **L. keep-out scratch 现触发 shim 规则** | 未跟踪生成器(make-v5/v6/realmachine/layout-roundtrip)在 `scripts/` 下会触发 K 的 shim 规则 → **`bun run check` 前移到 `$CLAUDE_JOB_DIR/tmp/scratch`、check 后还原**(make-v7 已 relocate 到 `tools/lowcode/src/`,tracked,别当 keep-out)|
| **M. 改 core/compiler src 必先 `build:packages` 再 lint** | 否则 type-aware oxlint 报 dist-vs-src SceneNode TS2345 假错。改 Vue 必跑 `check:vue`(第 4 道闸,vue-tsc 抓 oxlint/tsgo 抓不到的 narrow 漏 case)。每 commit 前 `git checkout -- desktop/Cargo.lock`(cargo run/check 会改它)|
| **N. type-shapes.ts 禁重复 alias-to-type-literal shape** | 跨 src+tests 禁任何 ≥2 成员的具名 type-literal alias 形状重复;逃逸口 = inline union 或 interface-extends,不是具名 2 成员 literal alias |
| **O. tsconfig paths 从最近的 tsconfig 解析** | bun-test/tsgo 从 importing file 最近的 tsconfig 解析 `paths`;无匹配 key **不**回退父 tsconfig → 落到 node_modules exports。新 package 的 tsconfig 要 mirror `packages/vue/tsconfig.json` 的 `@open-pencil/core/*`→`../core/src/*` 映射 |
| **P. 旧 .fig 中文方框 = 两层** | (1)fallback 字体没加载(Stage 14 bundled Noto Sans SC);(2)烤进文件的 `.notdef` glyph 绕过实时 shape(Stage 13 写侧门控 + Stage 16/8d 读侧 `shouldLiveShapeOverDerivedGlyphs`)。invalidateAllPictures 清不掉文件数据,必须渲染侧门控落回 buildParagraph。文本乱码 after .fig reopen = baked-glyph,不是 encoding |
| **Q. 写 roadmap 前先核 phase-3 各 v-version 闭合状态** | phase-3 在 v-version 里把当初「首次交付时延后的 follow-up」一路关掉了(§8 v3 fill/color、§8 v4/v5 variants、§7 v2 re-show、§10 v2 toast 全已实现)。**别拿「首次交付快照的延后清单」当剩余需求** —— 以 prompt.md「入口现状矩阵」+ phase-3 各 v-section 实际状态为准,否则 roadmap 重列已交付项 |

### 1.5 测试 / 验证命令

```sh
bun install                                  # 切分支后先跑
git lfs pull --include="tests/fixtures/*"    # 实体化 LFS fixture(+ fonts/* for CJK)
bun run build:packages                       # core/compiler 改动 + check 前置(经验 M)
# 跑前移开 keep-out make-* scratch 到 $CLAUDE_JOB_DIR/tmp/scratch(经验 L)、check 后还原
bun run check                                # 完整门(exit 0=回归基准;现含 test:tools / test:dupes)
bun run check:vue                            # 改 Vue 必跑(第 4 道闸)
./node_modules/.bin/tsgo --noEmit            # 0 错基准(以此为准,别信编辑器假错)
bun test tests/engine/kiwi                   # 119/0 lowcode round-trip 基准
bun test tests/engine/compiler               # compiler 全绿基准
bun test tests/engine/scene-graph            # scene-graph 全绿基准
git checkout -- desktop/Cargo.lock           # cargo 改了它就 revert(经验 M)
git push --no-verify upstream lowcode-rebaseline   # 推送(mo-17 fork,保 0/0)
git fetch official && git merge official/master    # 上游前进时合入(merge-base 现新,干净)
```

**既有 pre-existing fail(非回归,出范围,勿修)**:
- io 的 4 个 `material3.fig` —— export-node 写 `EXCLUDE` 到 kiwi enum(只有 XOR=3),上游既有(checkout 纯 upstream kiwi+io 同样挂)。`bun test tests/engine/io` ~10min。
- render/jsx `Tailwind JSX export > frame with children renders nested` —— §6 CANVAS 隐式 FREE 漂移,clean HEAD 同样挂。
- IDE 偶发 `Cannot find module '@open-pencil/...'` / `#core/...` 是 LSP moduleResolution 噪音 —— 以 `tsgo --noEmit` + `check:vue` 为准。

### 1.6 不要做的(继承 Phase 0/1/2/3 + re-baseline 锁定)

- 改 main 分支;`git push --force`;动 `tests/fixtures/*.fig` 的 LFS pointer。
- 在 `lowcode-phase-0` 上修;删它(已 `archive/lowcode-phase-0` 退役)。
- 撤销 Phase 0/1/2/3 任一锁定决定;改 `packages/core/src/kiwi/kiwi-schema/`(vendored)。
- 改 pluginData key 前缀 / `OPEN_PENCIL_PLUGIN_ID`;改 `ActionDef.kind` 字面值 / emit 公开 runtime 符号名 / bridge 协议 `source` / message `type` 字面值(老 .fig + iframe↔editor 兼容)。
- 改既有交互组件的 NodeType / 默认值 / emit;改 `LayoutMode` 字面值或 `isAutoLayoutMode` 窄集合(`'HORIZONTAL'|'VERTICAL'|'GRID'`)。
- 重 port .fig band-aid(已锁丢弃;仅 Stage 16 C5 read 侧 + CJK heal render 侧是经授权例外)。
- 别修既有 fail(§1.5 列的两类)、出范围。
- 别 `git add -A` 把 keep-out 入仓:`prompt.md` / `*.fig` / `scripts/make-{layout-roundtrip,realmachine,v5,v6}-testdoc.ts` / `fig-layout-roundtrip-findings.md` / `.claude/`(`make-v7-testdoc.ts` 已 relocate 到 `tools/lowcode/src/`、tracked,别当 keep-out)。
- 别全仓 `bun run format`(经验 F);别在测试里跑整套 `tests/engine/`(慢 + pre-existing fail)。
- 新增 `scripts/*.ts` 必须是单行 shim(经验 K);实现逻辑放 `tools/<domain>/src/`。
- **CF Pages deploy 别默认开干 —— 需 blake3 依赖,先 AskUserQuestion 问用户**。
- 别盲目开 workflow 并行多 milestone:候选互撞 `scene-graph/types.ts` + emit 路径 → 串行单 milestone。
- bg 隔离守卫:本会话就地工作(`.claude/settings.local.json` gitignored 设 `worktree.bgIsolation:none`,用户授权)。EnterWorktree 默认 baseRef=fresh 从 origin/main 分,不要用。
- **自动开工任何候选 —— 必须用户先挑**。
- **别重列 phase-3 已交付项(经验 Q)** —— roadmap 以 prompt.md「入口现状矩阵」+ phase-3 各 v-section 实际状态为准。

### 1.7 挂起的真机 ACK(headless 做不了画面,carry-over backlog)

这些不是「需求」,是已 code-complete 但卡用户真机/真 token 验证的积压:

- **§4.x collab 两机 ACK** —— §4.1–§4.6 + §4.3 self-host + §4.3-S Supabase signaling 全 code-complete,卡两机/真 token 验证。一过解锁所有 §4.x 两机 ACK。
- **§5.x deploy 真 token ACK** —— Netlify/Vercel deploy 真 token → live URL、编辑器一键按钮、多环境 Supabase 连 prod project。
- **§10 v11 WorkflowsPanel 视觉** —— 无选中出 Workflows 面板,加工作流/改名/加 params(+default)/递归编工作流体;BUTTON Events 面板 callWorkflow 下拉 + args 填写。
- **§15 Phase B shadcn 视觉** —— Select 下拉 / Switch 滑块 / Radio 圆点线上视觉。
- 旧积压:§10 v10 递归编辑器、§10 v9 toast 闭环、§8 deep-override 渲染、§9 全链导出、CJK heal 真机画面、.fig 5 fix 的 GUI canvas-pixel ACK。
- **验证载体** = `lowcode-realmachine-test.fig`(仓库根,未跟踪 keep-out;生成器 `scripts/make-realmachine-testdoc.ts` 未跟踪 keep-out)。Demo 页覆盖 §7/§8/§9/§10。

---

## 候选详写(stub —— 开工前 AskUserQuestion 锁定决定后扩写为详细设计)

> 每条扩写格式同 Phase 3 §X:`.1 现状与问题 / .2 关键决定 / .3 公开 API/Schema 改动 / .4 内部实现拆解 / .5 成功标准 / .6 工作分解 / .7 风险 / .8 Post-mortem`。

## §15 UI-kit 收尾(FRAME→Card + Phase C array checkbox-group)

**现状**:§15 shadcn 导出已交付 Phase A(Button/Input/Textarea/Label)+ Phase B(Select/Checkbox/Switch/RadioGroup),由导出/部署面板 ui-kit toggle 驱动,alias + deps 就位。**纯 compiler-emit 增量,零 scene-graph/round-trip 改动**。

**剩余 #1 FRAME → `Card`**:容器型 FRAME(尤其有 padding/背景/圆角的)映射到 shadcn `Card`/`CardHeader`/`CardContent`,而非裸 `<div>`。phase-3 §15 设计已把它列为「Phase B 可选」但未实现。需判定「哪种 FRAME 算 Card」(probe:lowcode 标记 vs 启发式,设计阶段定)。**待锁**:判定规则(显式标记 vs 启发式);Card 子结构粒度(是否拆 Header/Content)。**推荐作为 Phase 4 headless 起点**(风险低)。

**剩余 #2 Phase C array checkbox-group**:array 类型字段(多选)→ shadcn checkbox-group 排版(复用 §3.v5 RADIO/CHECKBOX inline 排版经验)。**待锁**:array 字段来源(已有数据模型 vs 新增);单选/多选语义。

## §9 i18n RTL 逻辑属性(v15)

**现状**:§9 i18n 链 v1–v14 已交付(react-intl runtime / locale 切换 / 属性串 / ICU 插值 / plural-select / 译文 catalog / **v11 RTL dir-flip** `document.dir` 翻转 / v13 CLI flags / v14 缺译警告)。

**剩余(v15)**:**RTL 逻辑属性** —— `margin`/`padding` 物理方向(`ml-`/`mr-`/`pl-`/`pr-`)→ `ms-`/`me-`/`ps-`/`pe-` 逻辑属性,让 RTL locale 自动镜像间距(v11 只翻 `dir`,间距仍物理方向 → RTL 下左右间距不镜像)。改 core `collectTailwindClasses`。

**⚠ 回归面大**:大量既有测试断言具体 class(`ml-`/`mr-`)→ 改成逻辑属性后期望全变。**强烈建议 gated**(RTL locale / ui-kit 条件触发,而非全局改 default emit),否则非-RTL 产物 class 全漂移 + 大批测试要改。**待锁**:全局默认改 vs gated(建议 gated);逻辑属性覆盖范围(仅 margin/padding 还是含 inset/border)。

## §14 跨文件组件库 / 团队库

**现状**:§8 组件复用限单文件内 COMPONENT/INSTANCE(v1–v11 已闭合)。跨 .fig 文件 / 团队共享库未做。**phase-3 §14 已有完整设计,状态标〔未实现〕** —— 设计阶段先重读 phase-3 §14 并核对是否仍适用 re-baseline 后的架构。

**地基(phase-3 §14 已勘)**:`SceneNode.componentKey: string | null`(Figma 库组件用全局 GUID 做跨文件身份,天然锚点);`componentId` 是文档内 master 链接;编译器侧零改动(§8 已能提取/复用本地 master,团队库纯 scene-graph + import + round-trip + 编辑器面板)。

**风险**:**override 跨版本 index-path 错位** —— 库组件更新后,实例的 child-override key(`<childId>:<prop>`)可能指向已变的子树结构。设计阶段必须定 index 稳定性策略。**待锁**:库存储/引用机制(componentKey 注册表 vs 文件路径);版本/更新传播策略;关键 fork 走 AskUserQuestion。

## §5 更多 deploy providers(Cloudflare Pages 等)

**现状**:deploy 管线 Netlify(§5.2)+ Vercel(§5.4)完整 —— `deploy.ts` digest-upload + CLI `deploy` + 编辑器一键 DeployControls(shell out `open-pencil deploy --json`)。

**剩余**:Cloudflare Pages 直传。**⚠ 阻塞决策**:CF Pages 直传 API 需 **blake3** 文件哈希(Web Crypto 只有 SHA-\*)→ 引 blake3 npm 依赖,**违背零依赖约束**。phase-3(§10 v7/v8、§7 v2)已多次因此否决 CF Pages。**开工前必须 AskUserQuestion 问用户是否接受 blake3 依赖**;若不接受,评估 CF Pages 的 Git-integration 路径(无需直传哈希)或换其它 provider(Render/Surge/GitHub Pages)。**待锁**:是否接受 blake3 依赖。

## §9 / §15 编辑器实时 preview i18n / ui-kit toggle(真机 GUI)

**现状**:§9 v13 修了 CLI i18n 入口(`compile`/`build --i18n`),但 **编辑器实时 preview 入口仍缺** —— `src/app/lowcode/preview-pane/use-compile-on-change.ts` 硬编码 `compile(withDefaults({packageName}))`(i18n 默认 false、无 uiKit)→ app 内 preview 看不到 i18n 译文 / shadcn 组件。§15 Phase A 也注明 preview 不带 uiKit(避免缺 dep 崩)。

**剩余**:给编辑器 preview 加 i18n / ui-kit toggle,让实时 preview 编译带 i18n/shadcn(shadcn alias+deps 真机 install 后就位)。**需真机点画面**(headless 验不了视觉)。**待锁**:toggle 位置(导出面板 vs preview 工具条);shadcn preview 的 dep 解析(VFS-build 缺 radix dep → 真机 install 才视觉保真)。

## §7 / §8 / §10 编辑器授权面板(GUI,真机)

**现状**:§7 responsive overrides / §8 component-props / §10 optionalParams 的数据模型 + emit + round-trip 在 phase-3 均已 headless 交付,**但授权 GUI 在 phase-3 均显式「延后真机」**(沿用「先 emit/headless,GUI 真机」先例)。

**剩余**:
- **§7 responsive overrides 编辑面板** —— 当前响应式 override 只能 MCP/CLI 写。
- **§8 component-props 面板** —— 显式 props 编辑(text/fill/variant prop 值)。
- **§10 optionalParams GUI** —— callWorkflow 的 optionalParams 当前 MCP-only(§10 v8 已实现 emit/数据,缺 GUI)。

**需真机点画面**。**待锁**:三块是否一并做还是拆;面板挂载位置(沿用 Lowcode/ 现有面板结构)。

## §10 工作流体跨页 pageStates 精确

**现状**:§10 v11 GUI 链已闭合(EventsPanel 递归编辑器 + WorkflowsPanel + callWorkflow GUI)。**已知小缺口**:工作流体的 pageStates 当前取**当前页**近似。

**剩余**:跨页 callWorkflow 时,工作流体内引用的 pageStates 应按**目标页**解析(而非编辑时的当前页)。纯 collect/emit 逻辑修正。**待锁**:目标页解析时机(compile 期静态 vs runtime)。

## §6 lowcode 字段升格 Kiwi schema(工程债,继续推迟)

**现状**:全部 lowcode 字段经 pluginData 旁路通道(`lowcode/*`,含 §7 `responsiveOverrides`)round-trip,稳定运行,kiwi 119/0。

**评估**:升格成本高(fork vendored `kiwi-schema/` + 通道重写 + 老 .fig 迁移工具),产品层面零新功能解锁。**继续推迟**(phase-3 §1.1 候选 5 的 carry-over),除非协作/AI 流程对 schema 一等字段位有刚需。本节仅占位,不主动开工。
