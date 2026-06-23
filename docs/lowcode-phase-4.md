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

- **§2 Supabase 接入**:§2 + §2.v2–v4(auth signIn/Out/signUp/reset/update)。
  备注:5 auth ops + data + interactive。
- **§3 AI-tools 生成/编辑**:§3 + §3.v2–v8(undo/payload/UI/controlled
  bindings/SWITCH CSS/InteractiveProps 框架/DATEPICKER range/RLS advisor)。
- **§4 协作**:§4.1–§4.6 + §4.3 self-host + §4.3-S Supabase signaling。
  备注:code-complete,卡两机真机 ACK(见 §1.7)。
- **§5 部署**:§5.1–§5.3 + Netlify §5.2 + Vercel §5.4。
  备注:code-complete,卡真 token ACK(见 §1.7)。
- **§7 响应式断点**:§7 v1 + **§7 v2 re-show**
  (base-hidden→bp-visible 已实现)。GUI 授权面板延后(→ phase-4 #6/#7)。
- **§8 自定义组件**:§8 v1–v11(clean→`<Component/>` / **v2 text→props** /
  **v3 fill/color→props** / **v4–v5 COMPONENT_SET variants** / v6 全推广 /
  v7 `:visible`→hidden / v8 instance `:visible` reverse / v9 nested-instance /
  v10 orphan 剪枝 / v11 override round-trip)。component-props 面板(GUI)延后
  (→ phase-4 #7)。
- **§9 i18n**:§9 v1–v15(react-intl runtime / locale 切换 / 属性串 /
  ICU 插值 / plural-select / 译文 catalog / **v11 RTL dir-flip** / CLI flags /
  缺译警告 / **v15 gated RTL logical padding**)。编辑器实时 preview
  i18n(GUI)延后(→ phase-4 #6)。
- **§10 工作流编排**:§10 v1–v11(condition/delay/stop / **v2 toast** /
  confirm/clipboard / **v4 named WorkflowDef** / **v6 callWorkflow 传参** /
  **v8 可选形参 emit** / v9 onSuccess/onError / v10 递归编辑器 /
  v11 callWorkflow GUI + WorkflowsPanel)。optionalParams **GUI** +
  跨页 pageStates 延后(→ phase-4 #7/#8)。
- **§15 UI-kit**:§15 设计 + Phase A(Button/Input/Textarea/Label) +
  Phase B(Select/Checkbox/Switch/RadioGroup)。FRAME→Card / Phase C /
  实时 preview shadcn 未实现(→ phase-4 #1/#2/#6)。

> 一句话:**§8/§9/§10 链在 phase-3 已基本走完**,phase-4 的剩余只是它们各自被显式延后的 GUI 入口 + 几条没起头的新线(§14 / §15 收尾 / §9 RTL 逻辑属性 / CF Pages / Kiwi 升格)。

---

## 1. 范围

### 1.1 Phase 4 In-Scope(真剩余候选,待逐条承诺)

> 用户明确(prompt.md):**优先做功能,Tauri 真机测试靠后**;偏好「一个一
> 个来 / 直接干推荐项」,真大决策才单问一个 AskUserQuestion。headless 可验的
> 连续增量优先,真机 GUI 验证类候选排在后面。

| #   | feature                                        | 优先级               | 简述 / 状态                                                                                    | 详写          |
| --- | ---------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------- | ------------- |
| 1   | **§15 FRAME→Card 容器映射**                    | **高(最快起点)**     | headless emit;容器型 FRAME → shadcn `Card`/`CardHeader`/`CardContent`,phase-3 未实现。         | §15           |
| 2   | **§16 动态路由 / 路由参数 / 路由守卫** ⭐      | **高(最高产品价值)** | headless emit(中-大);补 `/product/:id`、`useParams`、query string、带参 navigate、auth guard。 | §16           |
| 3   | **§15 Phase C array checkbox-group**           | 高                   | headless emit;array 字段 → shadcn checkbox-group,接 phase-3 §15 Phase A/B。                    | §15           |
| 4   | **§17 列表绑真实数据源 + 分页/排序/筛选**      | 中-高                | headless emit;LIST 从本地 array 扩到 Supabase query + 分页/排序/筛选。                         | §17           |
| 5   | **§19 表单校验**                               | 中                   | headless emit;required/pattern/min-max/自定义规则 + 错误提示 + 提交拦截。                      | §19           |
| 6   | **§18 文件 / 图片上传(Supabase Storage)**      | 中                   | headless emit,可能动 scene-graph;上传控件 + Storage upload/getPublicUrl + 进度/预览。          | §18           |
| 7   | **§9 v15 RTL 逻辑属性(ps-/pe-)**               | 中                   | headless emit;**CODE COMPLETE 2026-06-23**。gated `rtlLogicalProperties`,默认不漂移。          | §9            |
| 8   | **§14 跨文件组件库 / 团队库**                  | 中                   | headless(大);组件跨 .fig 复用 / 团队共享库 / 更新传播。phase-3 有设计但未实现。                | §14           |
| 9   | **更多 deploy providers(Cloudflare Pages 等)** | 中                   | headless;CF Pages 直传需 blake3,开工前必须 AskUserQuestion。                                   | §5            |
| 10  | **编辑器实时 preview i18n / ui-kit toggle**    | 高(真机)             | 真机 GUI;preview 入口补 i18n/uiKit toggle,解决 app 内看不到 i18n/shadcn。                      | §9 / §15      |
| 11  | **§7 / §8 / §10 编辑器授权面板(GUI)**          | 中(真机)             | 真机 GUI;responsive overrides、component-props、optionalParams 面板。                          | §7 / §8 / §10 |
| 12  | **§10 工作流体跨页 pageStates 精确**           | 低                   | headless;跨页 callWorkflow 按目标页解析 pageStates。                                           | §10           |
| 13  | **lowcode 字段升格 Kiwi schema**               | 低                   | 工程债;pluginData 旁路稳定,升格成本高,继续推迟。                                               | §6            |

> **#1–#9 = headless,#10–#11 = 真机 GUI,#12–#13 = 低优先。**
>
> **优先级建议**:两个高优先起手点 ——(a)**最快**:#1 §15 FRAME→Card(纯 emit
> 最干净,接 #3 Phase C 把 §15 收尾);(b)**最高产品价值**:#2 §16 动态路由
> ——它把「多页静态站」升级成「真应用」(详情页 `/product/:id`、仪表盘、auth-
> guarded 路由),是 Bubble 级平台的核心缺口,吃现有 react-router 地基、可
> headless 验。**建议先做 #1/#3 快速收一条线,再正式投 #2 §16**(量级中-大,值得
> 单独锁设计)。#4 §17 列表绑数据源 / #5 §19 校验 / #6 §18 上传 是真应用的另外三
> 块刚需,接在 §16 后成「真应用数据/表单链」。#7 RTL 有回归面、#9 CF Pages 卡
> blake3,先沟通。真机 GUI(#10 #11)攒一批 Tauri session 验。

### 1.1.1 第二波:落地增量候选(组件 / 样式 / 交互细节)

> 2026-06-20 第二轮缺口盘点。**全部 grep 坐实代码无实现**,且都是**纯 emit /
> 复用现有机制**的小-中增量(无架构改动),用来把产物从「能跑的页面」打磨成
> 「真应用」。优先级整体在第一波(§16–§19 数据/表单链)之后,但单条工作量小、
> 可穿插。**避坑(经验 Q):effects 阴影已 emit(`jsx/helpers.ts formatShadow`)、
> EventName 联合已含 5 事件、navigate 已在,均不重列。**

| #   | feature                                                                      | 复用 / 状态                                                     |
| --- | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
| §20 | **交互状态样式(hover/focus/active/disabled variants)**                       | §7 variant-emit;用户节点无状态变体 emit。                       |
| §21 | **覆盖层组件(Modal/Dialog/Drawer/Popover/Tooltip)**                          | FRAME `interactiveProps.overlay` + docState;**CODE COMPLETE**。 |
| §22 | **更多 shadcn 原语(Tabs/Accordion/Avatar/Badge/Skeleton/Progress/Alert 等)** | §15 ui-kit adapter;**CODE COMPLETE 2026-06-23**。               |
| §23 | **图标(lucide-react)**                                                       | §15 ui-kit / 新 icon 节点或 prop;无 icon 节点。                 |
| §24 | **图片与视觉填充(`<img>` 真 src/alt/object-fit + 渐变 + aspect-ratio)**      | **CODE COMPLETE 2026-06-23**;含 image-fill→asset v2。           |
| §25 | **外链 `<a href>` + target**                                                 | emit/element;**CODE COMPLETE 2026-06-22**。                     |
| §26 | **布局原语(sticky/fixed 定位 + overflow scroll + z-index)**                  | jsx tailwind-classes;**CODE COMPLETE 2026-06-22**。             |
| §27 | **state 持久化(localStorage)+ 派生/计算 state**                              | docState + 表达式子语言;无 localStorage/persist/computed。      |
| §28 | **用户事件覆盖收尾(onChange/onFocus/onBlur + `$event`/`$value`)**            | EventName 联合 + events emit;**CODE COMPLETE 2026-06-22**。     |

> **第二波优先级建议**:
>
> - **§20 交互状态样式**最值得先做:复用 §7 variant-emit,零新概念,立刻让产物有交互质感。
> - **§24 图片/填充** + **§25 外链** 是「真页面」基础缺口。
> - **§21 覆盖层** + **§22 更多原语** 补 UI 表达力。
> - **§27 持久化/派生 state** + **§28 事件收尾** 补运行时逻辑短板。
>
> 这些都可穿插在第一波 §16–§19 之间做(单条小)。

### 1.2 Phase 4 Out-of-Scope(明确推迟到 Phase 5+)

**(a) 继承 Phase 3 §1.2 —— 平台/架构级,仍未到时候**:

- **多租户 / 多 workspace** —— Bubble 风格 workspace + member + billing
- **平台层付费用户系统** —— 区别于应用层 Supabase auth;平台自身订阅/计费
- **AI 自动 debug / 修复** —— 运行时 AI agent(§3 AI-tools 限定「生成/编辑」)
- **可视化数据流 DAG 编辑器** —— §10 工作流编排限定 ActionDef 链 + condition/delay/stop;Bubble Flow-style 节点 DAG 编辑器留 Phase 5
- **手机原生导出**(iOS / Android) —— 当前 emit 仅 React/Web;React Native / Capacitor / Tauri Mobile
- **插件系统 / Marketplace** —— 自定义节点类型 / 自定义 action 动态加载

**(b) Tier 2/3 真实缺口 —— 已确认代码无实现,价值高但偏架构级/外部依赖,Phase 5 预留**(2026-06-20 产品缺口盘点,grep 确认):

- **应用内支付(Stripe)** —— 变现刚需(SaaS/市场类);需 Stripe SDK + 后端 webhook(Supabase Edge Function),跨「静态 SPA」边界,故 Phase 5。
- **SEO**(per-page `<title>`/`description`/OG/sitemap/robots)—— 现仅 `<meta charset>` + `<html lang>`(§9 v12)。静态 SPA 的 SEO 弱,做全需配 **SSG/预渲染**(改 emit 架构)→ Phase 5;**轻量版**(per-page 静态 `<title>`/meta 注入 `index.html`)可作 Phase 4 末小增量再评估。
- **应用版本管理 / staging↔prod** —— dev/live 版本、回滚、发布前预览;协作(§4)+ Yjs 给了底子,但「应用版本」是平台生命周期能力 → Phase 5。

**(c) 体验/高级项 —— 随产品节奏,Phase 4 末或 Phase 5**:

- **全局主题 / design tokens / 暗色模式** —— Figma variables(含本会话 `4bc1698e` 的绑定校验)是底子;缺 theme tokens→CSS 变量 + 暗色切换 emit。
- **动画 / 交互**(hover / scroll / transition)—— Webflow 差异化点;当前无任何动效 emit。
- **自定义代码注入**(custom JS / CSS / `<head>` embed)—— 高级用户逃生口。
- **分析 / 埋点集成**(GA / Plausible / PostHog)—— 第三方 script 注入 + 事件埋点。

### 1.3 Phase 4 整体成功标准(粗框,逐候选细化)

1. 本 doc §1.1 中所有承诺的候选各自 stub 扩写后的成功标准全过。
2. 不破坏 re-baseline 后的绿基线:`bun run check` exit 0;`bun test tests/engine/kiwi` 119/0(lowcode round-trip);`bun test tests/engine/compiler` 全绿;`bun test tests/engine/scene-graph` 全绿。
3. 不破坏 Phase 0/1/2/3 任一锁定的成功标准 —— 旧 demo / 旧 .fig 行为不变。
4. 既有 pre-existing fail 不回归(详见 §1.5):io 的 4 个 `material3.fig` EXCLUDE 基线;render/jsx 的 §6 `frame with children renders nested`。
5. headless 候选交付即算 code-complete;真机 GUI 候选由用户主导 Tauri 实测,不自己宣告通过。

### 1.4 Phase 4 继承的经验

**A–I 直接继承 Phase 3 §1.4**(walker 漏 case / Tauri 拖拽锁 / parse 不 swallow / emit 新 npm import 进 compiler deps / 跨 §X 接口预查 / 别全仓 format / union widening helper-first / UX 显示元素 vs 后台同步 / emit 全绿 ≠ 跑得起来 module-resolve 维度)。下面是 re-baseline 期 + Phase 4 新增/强化的:

| 经验                                                      | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **J. 上游 merge:relocate 而非 gut**                       | dev 脚本只用公共包导出时迁 `tools/` 零 import 破坏。3-way 交错冲突(上游重构成函数 + 我们加字段)= 重写整段而非逐 marker,把我们字段折进上游新函数签名;两侧独立贡献 pluginData 的,串调用顺序。**本会话实证**:`4bc1698e` 合入 = 2 个纯 import 行冲突取并集(`isAutoLayoutMode` value + 上游 `SceneGraph`/`SceneNode` type)                                                                                                                                                                                                                                                                                                                                                                                                            |
| **K. `scripts/*.ts` 必须是单行 shim**                     | 上游 steiger 规则 `scripts-are-entrypoint-shims`:`#!/usr/bin/env bun` + `import '../tools/...'`。实现逻辑放 `tools/<domain>/src/`(kebab domain,`strictToolsLayout`;每 tool 一个 minimal `package.json`,tools/\* 非 workspace 成员)。`check` 现含 `test:tools`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **L. keep-out scratch 现触发 shim 规则**                  | 未跟踪生成器(make-v5/v6/realmachine/layout-roundtrip)在 `scripts/` 下会触发 K 的 shim 规则 → **`bun run check` 前移到 `$CLAUDE_JOB_DIR/tmp/scratch`、check 后还原**。当前 tracked 低代码 demo 生成器统一收在 `tools/lowcode/src/make/`,别当 keep-out。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **M. 改 core/compiler src 必先 `build:packages` 再 lint** | 否则 type-aware oxlint 报 dist-vs-src SceneNode TS2345 假错。改 Vue 必跑 `check:vue`(第 4 道闸,vue-tsc 抓 oxlint/tsgo 抓不到的 narrow 漏 case)。每 commit 前 `git checkout -- desktop/Cargo.lock`(cargo run/check 会改它)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **N. type-shapes.ts 禁重复 alias-to-type-literal shape**  | 跨 src+tests 禁任何 ≥2 成员的具名 type-literal alias 形状重复;逃逸口 = inline union 或 interface-extends,不是具名 2 成员 literal alias                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **O. tsconfig paths 从最近的 tsconfig 解析**              | bun-test/tsgo 从 importing file 最近的 tsconfig 解析 `paths`;无匹配 key **不**回退父 tsconfig → 落到 node_modules exports。新 package 的 tsconfig 要 mirror `packages/vue/tsconfig.json` 的 `@open-pencil/core/*`→`../core/src/*` 映射                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **P. 旧 .fig 中文方框 = 两层**                            | (1)fallback 字体没加载(Stage 14 bundled Noto Sans SC);(2)烤进文件的 `.notdef` glyph 绕过实时 shape(Stage 13 写侧门控 + Stage 16/8d 读侧 `shouldLiveShapeOverDerivedGlyphs`)。invalidateAllPictures 清不掉文件数据,必须渲染侧门控落回 buildParagraph。文本乱码 after .fig reopen = baked-glyph,不是 encoding                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Q. 写 roadmap 前先核 phase-3 各 v-version 闭合状态**    | phase-3 在 v-version 里把当初「首次交付时延后的 follow-up」一路关掉了(§8 v3 fill/color、§8 v4/v5 variants、§7 v2 re-show、§10 v2 toast 全已实现)。**别拿「首次交付快照的延后清单」当剩余需求** —— 以 prompt.md「入口现状矩阵」+ phase-3 各 v-section 实际状态为准,否则 roadmap 重列已交付项                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **R. Phase 4 §16.1/§15.1 新增(4 条)**                     | ① **跨 N 个 register-chokepoint 跟踪一个新内置只读标识符**:sentinel-ride 既有已穿线的 Set + collect 末 `Set.delete` 抽布尔,比新建并行 set 穿 N 点更省、穷举-by-construction(§16.1 `$params` rode docStateReads)。② **UI-kit 容器型映射用 `mapContainer`(只换 tag、保留子)而非 `mapControl`(独占 markup、跳子)**;二者都靠 collect 期 kit-agnostic IR-hint(containerKind/controlKind),plain emit 忽略 → byte-identical-off(§15.1)。③ **`check:vue` 是真第 4 道闸**:tsgo 不覆盖 `.vue`,新增 IRTree/SceneNode 必填字段时 `.vue` 里的 stub 字面量只有 vue-tsc 抓得到 → 加必填字段后 grep 全仓字面量构造点(含 `.vue`)。④ **同前缀兄弟测试 ≥3 触发 steiger `prefer-domain-folders`** → 新增第 3 个时直接建子目录(§8 v4/§9/§15.1 印证)。 |

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
- 别 `git add -A` 把 keep-out 入仓:`prompt.md` / 根目录临时 `*.fig` / `fig-layout-roundtrip-findings.md` / `.claude/`。低代码 demo 生成器已统一 relocate 到 `tools/lowcode/src/make/`,tracked,别当 keep-out。
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
- **验证载体** = `packages/demos/lowcode/lowcode-realmachine-test.fig`;生成器 `tools/lowcode/src/make/realmachine-testdoc.ts`。Demo 页覆盖 §7/§8/§9/§10。

---

## 候选详写(stub —— 开工前 AskUserQuestion 锁定决定后扩写为详细设计)

> 每条扩写格式同 Phase 3 §X:`.1 现状与问题 / .2 关键决定 / .3 公开 API/Schema 改动 / .4 内部实现拆解 / .5 成功标准 / .6 工作分解 / .7 风险 / .8 Post-mortem`。

## §15 UI-kit 收尾(FRAME→Card + Phase C array checkbox-group)

**现状**:§15 shadcn 导出已交付 Phase A(Button/Input/Textarea/Label)+ Phase B(Select/Checkbox/Switch/RadioGroup),由导出/部署面板 ui-kit toggle 驱动,alias + deps 就位。**纯 compiler-emit 增量,零 scene-graph/round-trip 改动**。

**剩余 #1 FRAME → `Card`**:容器型 FRAME(尤其有 padding/背景/圆角的)映射到 shadcn `Card`,而非裸 `<div>`。phase-3 §15 设计已把它列为「Phase B 可选」但未实现。**推荐作为 Phase 4 headless 起点**(风险低)。详细设计见下 §15.1。

### §15.1 FRAME→Card 详细设计 + 锁定决定(2026-06-21,AskUserQuestion 锁定)

> **目标**:启用 shadcn ui-kit 时,容器型 card-like FRAME emit 成 `<Card>` 而非裸 `<div>`,产物更接近手写 shadcn 项目(生产级可维护)。className passthrough → kit 给语义/结构、设计保外观。

**现状坐实(经验 Q/E,直接读源)**:

- `emit/element.ts:118` `tagName = uiKit?.mapTag(node.tag, node.attrs)?.component ?? node.tag` —— kit 映射点;但 FRAME 全 `div`(TAG_BY_TYPE tree.ts:517),不能全 div→Card,需语义 hint。
- **`controlKind` 是现成 IR-hint 先例**(Phase B):`controlKindFor(node)`(tree.ts:1005)collect 期按 node.type 打 kit-agnostic hint;registry `walkForKit` 按 hint 解析 `mapControl`/`emitControl`,plain emit 忽略 → byte-identical-off。**但 control 的 emit 跳过子节点(`if (node.controlKind) return`),Card 要包裹子节点(子照常 emit)** —— 这是 Card vs control 的关键差异。
- SceneNode `cornerRadius: number`(required)+ `fills: Fill[]`(`Fill.visible: boolean` + `opacity: number`)→ 启发式可读。
- §15 全程纯 compiler-emit 零 scene-graph/round-trip。

**锁定决定**:

1. **〔Fork 1 锁定〕判定规则 = 启发式**:`node.type === 'FRAME'` && 有可见背景填充(`fills.some(f => f.visible && f.opacity > 0)`)&& `cornerRadius > 0` → card-like。纯 emit、零 scene-graph/round-trip(延续 §15 特性)。否决显式标记(需新 lowcode 字段 + round-trip + GUI,破坏纯-emit)。**className passthrough 使误判低害**(设计的 `rounded-[..] bg-[..]` 经 cn/tailwind-merge 覆盖 shadcn Card 默认 `rounded-lg border bg-card shadow-sm` → 视觉不变,只语义化成 `<Card>`)。仅限 FRAME(GROUP/ROUNDED_RECTANGLE 等不纳入:GROUP 无 surface、bare rounded-rect 是装饰非容器)。
2. **〔Fork 2 锁定〕子结构 = 只 `<Card>` wrapper**:FRAME → `<Card className=...>`,子节点原样 emit 在内,className passthrough 保设计布局/padding。否决拆 Header/Content/Footer(shadcn CardHeader/Content 自带 padding 与设计 padding 双重冲突 + 分区启发式脆;需作者意图,留后续)。

**实现(纯 compiler-emit,镜像 controlKind 但「包裹不跳子」;经验 M build:packages 再 lint)**:

- **IR hint**(`ir/types.ts`):`IRElement.containerKind?: 'card'`(平行 controlKind,kit-agnostic;plain emit 忽略 → byte-identical-off)。
- **detection**(`ir/collect/tree.ts`):`containerKindFor(node)` 启发式(同上),`nodeToIR` 里 `...(containerKind ? { containerKind } : {})`(镜像 controlKind 设置点)。
- **adapter 接口**(`ui-kit/types.ts`):`mapContainer?(kind): UiKitMapping | null`(平行 mapControl,但**不带 emitControl** —— Card 不需独占 markup/事件翻译,只换 tag)。
- **emit**(`emit/element.ts`):`emitTagElement` 的 tagName 解析扩成「containerKind→mapContainer 优先,否则 mapTag」;**子节点照常 emit(不像 control 跳子)** —— 即只改 `tagName`(`<Card>`/`</Card>`),children 走既有 `emitElement` 递归。
- **registry**(`ui-kit/registry.ts` `walkForKit`):识别 `node.containerKind` → mapContainer 把 `Card` 加进 used names,**但继续 walk 子节点(不 return)** —— 区别于 control 分支的 `if (node.controlKind) return`。
- **shadcn**(`shadcn/index.ts` + `templates.ts`):`Card` 模板(纯 `<div>` + `cn()`,**无 Radix dep**,只 className-merge)+ `COMPONENTS['Card']` 注册 + `CONTAINER_TO_MAPPING = { card: { component: 'Card', from: '@/components/ui/card' } }` + `mapContainer` 实现。Card 子组件(CardHeader/Content/Footer)本版不 emit(只 Card)。
- **零碰**:off / 无 card-like FRAME → byte-identical(既有 ui-kit 测试零改);Phase A/B control 路径不动。

**成功标准(headless)**:

1. card-like FRAME(FRAME+bg+圆角)+ `--ui-kit shadcn` → `<Card className=...>` + `import { Card } from '@/components/ui/card'` + emit `src/components/ui/card.tsx`;子节点保留在内。
2. 非-card FRAME(无 bg / 无圆角)→ 仍 `<div>`(不误判)。
3. off(无 uiKit)→ card-like FRAME 仍 `<div>`,byte-identical。
4. `bun run check` exit 0;tsgo 0;jscpd 0;compiler 全绿基准 + ui-kit 新测试。
5. **真机验 pending**:部署 shadcn 产物看 `<Card>` 视觉(headless 仅断言 emit 串 + 文件)。

**交付记录(CODE COMPLETE 2026-06-21,commit `d86489d9`)**:

- 实现按设计 8 文件(ir/types containerKind + tree.ts containerKindFor + ui-kit/types mapContainer + emit/element.ts tag 解析 + registry walkForKit + shadcn/index COMPONENTS+CONTAINER_TO_MAPPING+mapContainer + templates CARD_TSX + doc),零 scene-graph/round-trip 改动。
- **Card vs control 的关键差异落地干净**:emit tag 解析 `containerKind→mapContainer 优先 ?? mapTag ?? node.tag`,子节点走既有 emitElement 递归(**包裹不跳子**);walkForKit container 分支收 `Card` 进 used names **但继续 walk 子**(区别 control 的 `if(controlKind) return`)。
- **CARD_TSX = canonical shadcn card.tsx**(Card+Header+Title+Description+Content+Footer 全导出,纯 styled `<div>` + cn(),**无 Radix dep**);FRAME→Card 只 import/用 `Card`,子组件随文件 ship 供作者后续 compose。
- **1 处 GATE 收口(check:arch steiger)**:新增第 3 个 `ui-kit-*` 同前缀兄弟测试触发 `prefer-domain-folders`(经验:同前缀兄弟 ≥3 触发)→ 3 个 ui-kit 测试全 `git mv` 进 `tests/engine/compiler/ui-kit/`(tags/controls/card.test.ts,alias import 不受位置影响)。
- **GATE**:`bun run check` exit 0;tsgo 0;jscpd 0 clones;compiler **656/0**(+6 card 测试)。零 hotfix。
- **边界(已文档化)**:仅 FRAME(GROUP/ROUNDED_RECTANGLE 不纳);只 `<Card>` wrapper 不拆 Header/Content;className passthrough 使误判低害(Card 默认 `rounded-xl border bg-card shadow` 被设计 `rounded-[..] bg-[..]` 经 cn/tailwind-merge 覆盖);可见背景判定 = `fills.some(f => f.visible && f.opacity>0)` —— **任意 FillType(SOLID/渐变/图片)只要可见即算**(非仅 SOLID),所以渐变/图片背景的圆角 FRAME 也映 Card。

### §15 Phase C array checkbox-group 详细设计 + 锁定决定(2026-06-21,AskUserQuestion 锁定)

> **目标**:启用 shadcn ui-kit 时,array 多选 CHECKBOX group(`CHECKBOX` + `interactiveProps.options[]`)emit 成 N 个 `<Checkbox>` 行 + 手动数组 toggle,而非现在的裸 N 个 `<input type=checkbox>`。把 §15 ui-kit 这条线收完(Phase A/B 已交付的 9 个交互组件之后的最后一档)。

**现状坐实(经验 Q/E,直接读源)**:

- `isCheckboxGroup(node)`(tree.ts:560)= `CHECKBOX` + `interactiveProps.options[]` 非空。collect 出 `<div>` wrapper(tag `div`,className = design 类 + 非 flex/grid 时补 `OPTION_GROUP_WRAPPER_CLASSES='flex flex-col gap-2'`)+ 每项 `<label class=OPTION_LABEL_CLASSES><input type=checkbox value=opt class=OPTION_INPUT_CLASSES/> opt</label>`(`applyCheckboxGroupOptions`/`appendOptionInputs`)。
- **受控**:绑 array<string> state 时,`applyControlledInput` 走 `isCheckboxGroup` 分支调 `patchOptionLeafControlled(children,'checkbox',controlled)` 把同一 controlled 描述符贴到**每个** `<input type=checkbox>` leaf(wrapper 自身返回 undefined,无 value/onChange);plain emit(element.ts:254)出 `checked={read.includes(opt)}` + `onChange={(e)=>...spread/filter toggle}`(`arrayCheckboxOnChangeBody`)。
- **`controlKindFor`(tree.ts:1009)对 checkbox-group 刻意返回 `undefined`**(Phase B 排除注释:「no native shadcn group component — deferred」)→ shadcn 下 checkbox-group 留 plain `<input>`。这正是 Phase C 要补的点。
- Phase B 的 RADIO→`radio-group` 是完全对称的先例:`controlKindFor` 返回 `'radio-group'` → shadcn `CONTROL_TO_MAPPING['radio-group']` + `emitControl` case → `emitRadioGroup` 从 wrapper 的 `<label><input>` 子里抽 options(`radioOptions`)emit `<RadioGroupItem>` 行。

**锁定决定(2 fork + 1 定序,AskUserQuestion)**:

1. **〔Fork 1 锁定〕options 来源 = 仅静态 `interactiveProps.options[]`**(本次)。**动态 options 绑定已归 §17.4 交付**(options 来自 state/docState array,支持 `{value,label}` 对象映射)—— recon 坐实它是中等量级(`optionsSource` + 新 IR `.map()` 形态 + plain&shadcn 双 emit),与 §17 数据链重叠。用户先选「动态」,经定序问题后改选「先静态、动态归 §17(推荐)」。
2. **〔Fork 2 锁定〕shadcn 排版 = 镜像 radio-group 行布局**:wrapper 保持 plain `<div className=design 类>`(shadcn 无原生 group 组件),内含每项一行 `<div className="flex items-center gap-2"><Checkbox id checked onCheckedChange/><label htmlFor>opt</label></div>`。否决极简内联 `<label><Checkbox/> opt</label>`(与 shadcn radio-group 行布局不一致)。
3. **语义本身已定死**:checkbox-group 天然多选(array<string>,每项独立 toggle);单选互斥 = RADIO(Phase B 已做)。不浪费 AskUserQuestion。

**实现(纯 compiler-emit + IR-hint widening,镜像 Phase B controlKind;经验 M build:packages 再 lint;经验 A union widening sweep)**:

- **IR-hint widening**(`ir/types.ts`):`IRElement.controlKind` 联合加 `'checkbox-group'`(可选字段,无 `.vue` stub 破坏、无 `never` 闸)。
- **detection**(`ir/collect/tree.ts`):`controlKindFor` 的 CHECKBOX arm `isCheckboxGroup(node) ? 'checkbox-group' : 'checkbox'`(原 `undefined`)。**这是唯一 collect 改动**;`patchOptionLeafControlled` 仍贴 controlled 到 leaf(emitControl 从 leaf 读)。
- **shadcn**(`shadcn/index.ts`):`CONTROL_TO_MAPPING['checkbox-group'] = { component:'Checkbox', from:'@/components/ui/checkbox' }`(**复用既有 Checkbox.tsx + `@radix-ui/react-checkbox`,零新模板/零新 dep**)+ `emitControl` case `'checkbox-group'` → 新 `emitCheckboxGroup`。
- **`emitCheckboxGroup`**:从 wrapper 子抽 options(复用 `optionLeaves`,= 原 `radioOptions` 改名共享)→ wrapper `<div className=node.className>` + 每项经共享 `emitOptionRow` 出 `<div class="flex items-center gap-2">` + control 行 + `<label htmlFor>`;control = 受控时 `<Checkbox id checked={read.includes(opt)} onCheckedChange={(checked)=>write(checked===true?[...read,opt]:read.filter(v=>v!==opt))}/>`(`checkboxToggleParts`),非受控时裸 `<Checkbox id/>`。
- **零碰 = byte-identical-off**:plain emit 忽略 controlKind(`tryEmitKitControl` 仅 uiKit 非空时触发)→ checkbox-group plain 路径不变;registry `walkForKit`/emit `tryEmitKitControl` 都是 generic(`node.controlKind && mapControl`)→ 零改;shadcn `emitControl` switch 有 `default: return null`(graceful,非 `never`)。
- **经验 A 双轮 sweep(controlKind 全消费点)**:`controlKindFor`(producer,改)/ `IRElement.controlKind` union(widen)/ registry walkForKit(generic 不动)/ emit tryEmitKitControl(generic 不动)/ shadcn CONTROL_TO_MAPPING(加 arm)/ shadcn emitControl switch(加 arm)。`src/`+`packages/vue/src/` 零 controlKind 消费 → check:vue 不涉及。**无新 ActionDef kind / 无 round-trip / 无 scene-graph 改动**。

**成功标准(headless)**:

1. array checkbox-group(`options[]`)+ array state 绑定 + `--ui-kit shadcn` → N 个 `<Checkbox>` 行 + `checked={sel.includes(opt)}` + `onCheckedChange` spread/filter toggle + `<label htmlFor>` + `import { Checkbox }` + emit `checkbox.tsx` + `@radix-ui/react-checkbox` dep。
2. 受控(docState array → `setDocState`;page-state array → `setX` setter)+ 非受控(裸 `<Checkbox>`,无 checked/onCheckedChange)。
3. option label i18n-aware(`emitChild` → `<FormattedMessage>`)。
4. off(无 uiKit)→ checkbox-group 仍 plain `<input type=checkbox>` + plain onChange,byte-identical。
5. `bun run check` exit 0;tsgo 0;jscpd 0;compiler 全绿基准 + ui-kit 新测试;kiwi/scene-graph 零回归。
6. **真机验 pending**:部署 shadcn 产物看 `<Checkbox>` 复选框视觉 + 多选 toggle 行为。

**交付记录(CODE COMPLETE 2026-06-21,feat `1e4e4db5`)**:

- 实现按设计 4 文件(ir/types controlKind union + tree.ts controlKindFor + shadcn/index CONTROL_TO_MAPPING+emitControl+emitCheckboxGroup+checkboxToggleParts+optionGroupBase + ui-kit/controls.test),**零 scene-graph/round-trip/scene-graph types 改动**。
- **共享重构(消 jscpd clone)**:`radioOptions`→`optionLeaves`(radio+checkbox 共享抽 option leaf);新 `emitOptionRow`(共享行布局,radio/checkbox 各传 control 行);新 `optionGroupBase`(共享 pad/i1/i2 + options + controlled + rootParts 前导,radio 再 append valueBindingParts、checkbox 直接用)—— emitRadioGroup 一并改用,零行为变化。
- **GATE 收口 1 处(jscpd)**:`emitCheckboxGroup` 的前导(pad/i1/i2+options+controlled+rootParts)与 `emitRadioGroup` 6 行 116 token 重复 → 抽 `optionGroupBase` 消重(0 clones)。
- **GATE**:`bun run check` exit 0;tsgo 0;jscpd 0 clones;compiler **660/0**(+4 net:新增受控-docState/受控-pageState/非受控/i18n/byte-identical-off 5 条 - 改写 1 条 deferred);kiwi 120/0、scene-graph 202/0 零回归;check:vue 0。零 hotfix。
- **e2e 实跑**:scratch `.fig`(3-option checkbox-group 绑 docState array)经 `exportFigFile`→CLI `parseFigFile`→`compile --ui-kit shadcn` 真落盘 3 个 `<Checkbox>` 行 + includes/toggle + `<label htmlFor>` + `src/components/ui/checkbox.tsx` + package.json `@radix-ui/react-checkbox`(options 经 .fig round-trip 存活)。
- **边界(已文档化)**:§15 Phase C 只交付静态 `options[]`;动态 options 绑数据源 → §17.4 已交付;多选 array 语义(单选 = RADIO);wrapper 保 plain `<div>`(shadcn 无原生 CheckboxGroup);复用 Phase B 的 Checkbox.tsx/dep(无新增);静态 options 仍保持 `string[]` 假设。
- **新经验**:UI-kit「无原生分组件」的多选场景 —— 不造自定义 group 组件,而是 wrapper 保 plain `<div>` + 复用单组件(Checkbox)按 option `.flatMap` 拆行 + 手动 array toggle;与 radio-group(有原生 RadioGroup)的关键区别是 wrapper tag(`<div>` vs `<RadioGroup>`)+ control 的事件 API(`onCheckedChange` array spread/filter vs `onValueChange` 单值)。共享 `optionGroupBase`/`emitOptionRow`/`optionLeaves` 三 helper 让 radio/checkbox 两路零 jscpd clone。

## §16 动态路由 / 路由参数 / 路由守卫 ⭐

> 2026-06-20 产品缺口盘点新增。**最高产品价值 headless 候选** —— 把「多页静态站」升级成「真应用」。

**现状(grep 坐实)**:react-router 多页已在(`compiler/types.ts router:'react-router-v6'`,Phase 1/2 多页 emit + `route-paths.ts` 单一 route 派生源 + preview-bridge editor↔iframe navigate 同步)。但 **navigate 是字面路由**(`emit/event.ts:192` `navigate(${JSON.stringify(h.to)})`),`NavigateAction.to` = 「已校验非空的字面 route」。**无动态段 / 参数 / 守卫**。

**剩余 / 建议方向**:

- **动态路由段**:页面可声明 `/product/:id` 形态的路由 pattern(非纯 `/about` 字面)。
- **路由参数绑定**:emit `useParams()` → 参数进表达式子语言可读(类似 docState/pageState,新 read-context 源),供 supabaseQuery where-clause / 文本插值用。
- **query string**:`useSearchParams` 读写。
- **navigate 带参**:`navigate("/product/" + id)` / `navigate({ to, params })` —— NavigateAction 扩 params 字段(emit 拼接或 generatePath)。
- **路由守卫(auth guard)**:页面标 `requiresAuth` → emit 包一层 redirect-if-unauthed(复用 §2.v2 `useSupabaseAuth`)。

**类型**:headless emit + scene-graph/round-trip(route pattern + requiresAuth 进 page-level pluginData,类比 §7 responsiveOverrides);量级**中-大**,值得单独锁设计。**经验 E 必用**(跨 router/IR/emit/round-trip/表达式)。

### §16 拆分(连续 sub-version,契合「一个一个来」,每步 headless 验 + `bun run check` 绿)

- **§16.1 动态路由段 + `useParams` 参数进表达式**(地基)—— 本节详写,下方
- **§16.2 navigate 带参**:`NavigateAction` 扩 `params?: Record<param, exprString>` → emit `navigate(generatePath("/product/:id", { id }))`,从详情链路点入
- **§16.3 路由守卫(auth guard)**:页 `requiresAuth` → emit 包 redirect-if-unauthed(复用 §2.v2 `useSupabaseAuth().user` / `$currentUser`);**待锁**:redirect 目标约定(登录页 slug vs 显式字段)
- **§16.4 query string**:`useSearchParams` 读(`$query.foo`,与 §16.1 `$params` 命名空间平行)+ 写

### §16.1 详细设计 + 锁定决定(2026-06-21,AskUserQuestion 锁定)

> **目标**:页面可声明 `/product/:id` 动态路由,路由参数经 `$params.id` 在表达式子语言里可读(文本插值 / 绑定 / renderCondition / 未来 supabaseQuery where-clause)。把「多页静态站」升级成「能做详情页/仪表盘的真应用」的地基。

**现状坐实(经验 Q/E,直接读源)**:

- `derivePagePaths`(`adapters/react/route-paths.ts`)按 slug 派生 `route`(首页 `/`,其余 `/<slug>`);`buildRouterApp`(scaffold.ts:137)emit `<BrowserRouter><Routes><Route path={route} element={<Page/>}/></Routes>`;`buildPageFile` 按 `pageHasNavigateHandler` emit `useNavigate` + `import { useNavigate } from 'react-router-dom'`。
- 表达式只读上下文:`unknownIdentifiers`(bindings.ts:297)对 `states`/`inScope`/`docStates` 解析;`$currentUser` 经 `currentUserBuiltIn()` 注册成 docState(emit `useDocState`)。成员访问根标识符(`$currentUser.email` 的根 `$currentUser`)走 docStates 校验。
- 页级字段挂 CANVAS 节点(per-page `state?: StateDef[]`),round-trip = `serializeLowcodeFields(page)`(export.ts:267 序列化)+ `assignImportedLowcodeFields`(import.ts:26 吸收)+ `assignLowcodeField`(extract 分发)。

**锁定决定**:

1. **〔Fork 1 锁定〕route pattern 数据归属 = 页 CANVAS 节点字段**。新 `SceneNode.lowcodeRoutePattern?: string`(页级,镜像 per-page `state`);round-trip 走新 `lowcode/routePattern` key(`serializeLowcodeFields` + `assignLowcodeField` + `assignImportedLowcodeFields`,与 `state` 同路径)。否决文档级路由表(与 per-page state 模型分叉 + 多一层 pageId→pattern 间接)。
2. **〔Fork 2 锁定〕路由参数命名 = `$params.<name>` 命名空间内置只读源**。`$params` 注册为内置只读标识符(镜像 `$currentUser` 但 emit 不同),`unknownIdentifiers` 经 `BUILTIN_READ_IDENTS` 接受;页用到 `$params` 时 emit `const $params = useParams()` + `import { useParams }`。成员名(`.id`)不校验(同 `$currentUser.email` 先例,运行时 `useParams()` 返回 `string|undefined`)。否决裸名 `id`(与同名 state/docState 碰撞 + 需从 pattern 抽参数名列表)。

**实现(经验 E 跨 router/IR/emit/round-trip/表达式;经验 M 改 core 必 build:packages 再 lint)**:

- **数据模型**(`scene-graph/types.ts`):`SceneNode.lowcodeRoutePattern?: string`(页级,注释类比 `state`)。
- **round-trip**(`kiwi/fig/node-change/lowcode-plugin-data.ts`):`LOWCODE_ROUTE_PATTERN_KEY='lowcode/routePattern'` 入 `LOWCODE_PLUGIN_KEYS`;`serializeLowcodeFields` 加 `typeof===string && !==''` gate(非路由页 byte-identical);`ExtractedLowcodeAndPluginData.lowcodeRoutePattern?`;`assignLowcodeField` 加 case(string 守卫);`import.ts assignImportedLowcodeFields` 加一行(页/根经此吸收)。
- **IR**(`ir/types.ts` + `ir/collect/tree.ts`):`IRTree.routePattern?: string`;collectTree 从 `page.lowcodeRoutePattern` lift + 校验(非空 + `/` 开头,否则 warn `route-pattern-invalid` + 回退 undefined → slug 派生)。`routeParamReads: Set<string>` 跟踪(镜像 `docStateReads`,在每个 `registerDocStateReads` 旁加 `registerRouteParamReads`,经验 A 穷举所有表达式上下文);`IRTree.usesRouteParams = routeParamReads.size > 0`。
- **表达式校验**(`ir/collect/bindings.ts`):`ROUTE_PARAMS_IDENT='$params'` + `BUILTIN_READ_IDENTS=new Set([ROUTE_PARAMS_IDENT])`,`unknownIdentifiers` 循环加 `if (BUILTIN_READ_IDENTS.has(ref)) continue`(单点全 caller 覆盖);`registerRouteParamReads(refs, set)` helper。
- **emit**(`adapters/react/route-paths.ts` + `scaffold.ts`):`derivePagePaths` 的 `route = ir.routePattern ?? (slug==='index'?'/':'/'+slug)`(slug/file/component 仍从 pageName,pattern 只改 route);`buildPageFile` 把 react-router 具名 import 合并(`useNavigate` if needsNavigate / `useParams` if `ir.usesRouteParams`)+ emit `const $params = useParams()` 进 hookLines。`buildRouterApp` 的 `<Route path>` 自动用 PagePathInfo.route(= pattern)。
- **零碰**:navigate 仍字面(§16.2 才扩);单页 compile 无 router → 有 routePattern 也无意义(但 round-trip 仍存,无害)。

**成功标准(headless)**:

1. kiwi round-trip:页 `lowcodeRoutePattern` 经 exportFigFile→parseFigFile 存活;无字段时 byte-identical。
2. compiler:页声明 `/product/:id` → `<Route path="/product/:id">`;页内 `$params.id` 文本插值 → `const $params = useParams()` + `import { useParams }` + emit `$params.id`;非法 pattern → warn + slug 回退;无 routePattern/无 `$params` → byte-identical(既有测试零改)。
3. `bun run check` exit 0;tsgo 0;kiwi 119+ / compiler 全绿基准不回归。
4. **真机验 pending**:`open-pencil build` 导出的多页应用在浏览器实际按 `/product/123` 路由 + `$params.id` 渲染 123(headless 仅断言 emit 串)。

**交付记录(CODE COMPLETE 2026-06-21,commit `0af2e765`)**:

- 实现按设计 12 文件(scene-graph types + lowcode-plugin-data + import.ts + ir/types + bindings + tree + route-paths + scaffold + PreviewPane.vue stub + kiwi round-trip 测试 +1 + 新 routing.test.ts +10)。
- **`$params` 实现取「sentinel-ride-docStateReads」**:`$params` 经唯一 chokepoint `registerDocStateReads` 加进 `docStateReads`,`collectTree` 末 `docStateReads.delete(ROUTE_PARAMS_IDENT)` 抽成 `usesRouteParams` 布尔(`docStateReads` 对 emit 保持纯 docState)——避开 11 个 register 点的 set 穿线,经验 A 穷举-by-construction。component-body 的 `docStateReads` 被丢弃,sentinel 落那里无害。
- **GATE 收口 2 处**:① `assignLowcodeField` 加 ROUTE_PATTERN case → complexity 21>20 → 移进 `assignLowcodeLayoutFix` 溢出组(§8 v11 同款,经验「加分支前看 complexity 闸」);② **check:vue(第 4 道闸)抓到** `src/app/lowcode/preview-pane/PreviewPane.vue:80` 的 IRTree stub 缺新增必填 `usesRouteParams`(tsgo 不覆盖 .vue)→ 补 `usesRouteParams: false`(动态路由 preview 导航是真机 §16 follow-up,stub 保持 slug 派生不变)。
- **GATE**:`bun run check` exit 0;tsgo 0;jscpd 0 clones;kiwi **120/0**(+1)、scene-graph 202/0、compiler **650/0**(+10)。零 hotfix。
- **边界(已文档化)**:单页 compile 无 router → `$params` emit 被 `routerAvailable=false` 门控丢弃(单页 route param 无意义);component-body `$params` 不 emit;同 pattern 多页冲突不去重;preview-bridge 对动态路由页导航仍走 slug(真机 §16 follow-up)。
- **§16.2 起手**:`NavigateAction.params?: Record<param, exprString>` → emit `navigate(generatePath("/product/:id", { id }))`,详情链路点入。

### §16.2 navigate 带参 详细设计 + 交付(2026-06-21,无大分叉)

> **目标**:闭合「列表 → 详情页带 id」链路。§16.1 已能声明 `/product/:id` + 页内 `$params.id` 读;§16.2 让 navigate 能**带参跳进去** —— `navigate(generatePath("/product/:id", { id: <expr> }))`。无大分叉(只给已有 `NavigateAction` 加 `params?` 字段,不新增 ActionDef kind → 经验 A union sweep 不涉及),纯 headless。

**现状坐实(经验 Q/E,直接读源)**:

- `NavigateAction { id; kind:'navigate'; to? }`(scene-graph/types.ts);`resolveNavigate`(bindings.ts)只取 `to.trim()`,无表达式;`emitHandlerStatement` navigate(event.ts)= `navigate(${JSON.stringify(h.to)})`。
- 表达式子语言全套就位:`parseExpression` / `checkExprRefs`(`$prev` + unknown-identifier 闸)/ `registerDocStateReads`(§16.1 起把 `$params` sentinel-ride 进 docStateReads)/ `emitExpression`。**supabase filters 是最佳镜像**(每 filter:parse → checkExprRefs → registerDocStateReads → `{column,op,ast,references}`)。
- `substituteHandler`(§10 v6,substitute.ts)= total function over IREventHandler;navigate 原归「no-ast 组」与 delay/stop 一起原样返回。
- **import gate latent(经验 A「不报错但漏」)**:`pageHasNavigateHandler`(ir-walk)用 `treeHasHandler` 但**不下降 condition/confirm 分支**(不像 `pageUsesToast` 用 `handlerTreeHasKind`)→ 嵌在分支里的 navigate 漏导 `useNavigate`(pre-existing,§10 condition 引入后产生)。

**设计决定(无 AskUserQuestion,直接推荐项;`$params` 成员名/key-vs-pattern 不交叉校验,延续 §16.1 先例)**:

- **数据模型**:`NavigateAction.params?: Record<string, string>`(param 名 → 值表达式串)。round-trip:events 整块 `lowcode/events` JSON 序列化 → **零 codec 改动**(同 §10 condition/toast)。
- **IR**:`IRNavigateHandler.params?: IRNavigateParam[]`(`{name, ast, references}`,平行 IRSupabaseFilter);空/缺 → plain `navigate(to)`,非空 → `navigate(generatePath(to, {…}))`。
- **emit gate**:`generatePath` 仅在「页有带 params 的 navigate」时随 `useNavigate` 进同一 react-router-dom 具名 import(新 `pageHasNavigateParams`)。

**实现(经验 E 跨 scene-graph/IR/collect/substitute/emit/scaffold/tool;经验 M build:packages 再 lint;经验 A 双轮 sweep)**,8 src 文件:

- **scene-graph**(types.ts):`NavigateAction.params?`。
- **collect**(bindings.ts):`resolveNavigate` 加 states/inScope/docStates/docStateReads 参,逐 param `parseExpression` → `checkExprRefs`(code `action-navigate-param`)→ `registerDocStateReads` → push;**坏 param expr 丢整个 navigate handler**(同 supabase filters posture:坏目标链接比不导航更糟)。dispatchAction navigate 调用补参。
- **IR**(ir/types.ts):`IRNavigateHandler.params` + `IRNavigateParam`。
- **substitute**(substitute.ts,经验 A total function):navigate 从「no-ast 组」拆出,`params?.map(p => substituteFilter(p, bindings))`(workflow 形参可喂 navigate route param)。
- **emit**(event.ts):新 `emitNavigate(h)` —— 无 params `navigate(to)`,有 params `navigate(generatePath(to, { name: <emitExpression(ast)>, … }))`。
- **import gate**(ir-walk.ts):泛化 `handlerTreeHasKind` → `handlerTreeMatches(h, pred)`(下降 condition/confirm 分支),**顺手修 pre-existing latent**:`pageHasNavigateHandler` 改用分支下降(嵌分支的 navigate 现也正确导 useNavigate);新 `pageHasNavigateParams`(同款分支下降)。
- **scaffold**(scaffold.ts):`needsNavigate && pageHasNavigateParams(ir)` → routerNames push `'generatePath'`(与 useNavigate / useParams 合一 import)。
- **tool**(tools/modify/lowcode.ts):`validatePerKindFields` navigate arm → 新 `validateNavigateAction`(params 是 `{identifierKey: exprString}`,key 走 `PARAM_NAME_RE`、value 走 `validateExpression`);`buildActionFromValidated` navigate 带 params;tool 描述加 §16.2 段。

**成功标准(headless)**:

1. navigate + params + 多页 → `navigate(generatePath("/product/:id", { id: <expr> }))` + `generatePath` 进 react-router-dom import;无 params → plain `navigate("/about")`、无 generatePath。
2. param 值表达式解析 + 标识符解析(page state / docState / `$params`);unknown identifier → 丢 handler + warn(`action-navigate-param-unknown-identifier`);unparseable → 丢 handler + warn(`action-navigate-param-invalid-value`)。
3. round-trip:navigate.params 经 .fig 存活(events JSON 整块)。
4. tool 边界:非法 param key / unparseable value 拒;合法 params round-trip 进节点。
5. `bun run check` exit 0;tsgo 0;jscpd 0;compiler / kiwi / scene-graph / tools 全绿。
6. **真机验 pending**:`open-pencil build` 多页站浏览器实际从列表点入 `/product/123`(navigate 带 id)+ 详情页渲染 `$params.id`。

**交付记录(CODE COMPLETE 2026-06-21,feat `7b16cd47`)**:

- 实现按设计 8 src 文件 + 3 test(routing.test +9 / kiwi roundtrip +1 / modify tool +3),**零新 ActionDef kind**(经验 A union widening 完全不涉及)。
- **顺手修 pre-existing latent(经验 A「不报错但漏」)**:`pageHasNavigateHandler` 原不下降 condition/confirm 分支 → 嵌分支的 navigate 漏导 `useNavigate`(§10 condition 引入后的潜伏 bug);本次泛化 `handlerTreeMatches` 后两个 navigate gate(useNavigate + generatePath)都正确下降分支。新增测试坐实嵌 condition 分支的 navigate-with-params 仍导 generatePath。
- **GATE**:`bun run check` exit 0;tsgo 0;jscpd 0 clones;compiler **669/0**(+9)、kiwi **121/0**(+1)、scene-graph 202/0、tools 196/0(+3)零回归;check:vue 0。零 hotfix、零 GATE 收口、零意外。
- **e2e 实跑**:scratch 多页 `.fig`(Home 按钮 navigate `/product/:id` params `{id:'pid'}` + Product 页 routePattern + `$params.id` 文本)经 exportFigFile→CLI `compile`→`src/pages/index.tsx` 出 `import { useNavigate, generatePath }` + `navigate(generatePath("/product/:id", { id: pid }))`;`App.tsx` 出 `<Route path="/product/:id">`;`product.tsx` 出 `const $params = useParams()`。**§16.1+§16.2 详情链路端到端通**。
- **边界(已文档化)**:`to` 仍是字面路径(非表达式,只 params 是表达式);param key/value 不与目标页 routePattern 的 `:segments` 交叉校验(延续 §16.1 `$params.id` 成员名不校验);坏 param expr 丢整个 navigate handler;单页 compile navigate 被 strip(params 随之丢)。
- **§16.3 起手**:页 `requiresAuth` → emit redirect-if-unauthed(复用 §2.v2 `useSupabaseAuth().user` / `$currentUser`);**待锁**:redirect 目标约定(登录页 slug vs 显式字段)。**新经验:给已有 ActionDef kind 加表达式字段(非新 kind)= 经验 A union widening 不涉及,但所有「遍历 handler 树」的 total function(substituteHandler)+ import gate 必须随之处理新 ast 字段;顺带把同区的 pre-existing 漏下降分支的 gate 一并修(handlerTreeMatches 泛化)。**

### §16.3 auth guard 详细设计 + 交付(2026-06-21,AskUserQuestion 锁定)

> **目标**:页声明 `requiresAuth` → 多页编译在页模块顶部 emit redirect-if-unauthed 守卫(`if (!$currentUser.signedIn) return <Navigate to="/login" replace />`),复用 §2.v2 的 `$currentUser` auth docState。把「谁都能访问的多页站」升级成「带受保护页(仪表盘/账户)的真应用」。

**现状坐实(经验 Q/E,直接读源)**:

- `$currentUser`(`currentUserBuiltIn`,tree.ts)= **仅当 root 有 `lowcodeSupabaseConfig` 时**自动注册的 object docState(`{id,email,signedIn}`);runtime(`_lowcode_supabase.ts`)经 `auth.getSession()`+`onAuthStateChange` 同步;页经 `useDocState('$currentUser')` 读。→ **守卫前提 = supabase 已配**(否则 `$currentUser` 不存在)。
- §16.1 `lowcodeRoutePattern` 是页级 CANVAS 字段的范本:round-trip 五触点 = scene-graph type / `lowcode-plugin-data.ts`(KEY 常量 + LOWCODE_PLUGIN_KEYS + serialize + Extracted 类型 + assignLowcodeField(§16.1 因 complexity 移进 `assignLowcodeLayoutFix` 溢出组))/ `import.ts assignImportedLowcodeFields`(页/根经此吸收)/ collectTree lift / IRTree。**页/根路由字段不进 PATCH_KEYS → 非 AI-tool-settable,编辑器经 graph.updateNode 设、.fig round-trip**(§16.1 先例)。
- scaffold `buildPageFile`:hooks(docStateReads → `const x = useDocState('x')`)然后 `return (...)`;`routerAvailable` 门控(多页 buildPageModule=true / 单页 buildAppTsx=false)。

**锁定决定(AskUserQuestion)**:

1. **〔Fork 锁定〕redirect 目标 = 显式 document-level 字段**(root `lowcodeAuthRedirect?: string`,默认 `/login`)。app 级一处设登录路由,镜像 supabaseConfig root 归属,可配(/signin /auth)。否决「约定固定 `/login` 字面」(写死不可配)。
2. **守卫开关 = 页级 `lowcodeRequiresAuth?: boolean`**(每页自决,平行 routePattern)。**多选语义无**(布尔)。
3. **守卫 emit = react-router `<Navigate>` 早返**(`if (!$currentUser.signedIn) return <Navigate to=… replace/>`),比 useEffect+useNavigate 干净、声明式。

**实现(经验 E 跨 scene-graph/round-trip/collect/scaffold;经验 M build:packages 再 lint;经验「加分支前看 complexity 闸」)**,7 src 文件:

- **scene-graph**(types.ts):`lowcodeRequiresAuth?: boolean`(页)+ `lowcodeAuthRedirect?: string`(root)。
- **round-trip**(lowcode-plugin-data.ts + import.ts):`LOWCODE_REQUIRES_AUTH_KEY='lowcode/requiresAuth'` / `LOWCODE_AUTH_REDIRECT_KEY='lowcode/authRedirect'` 入 LOWCODE_PLUGIN_KEYS;serialize(requiresAuth 仅 `===true` 写、authRedirect 仅非空写 → public/默认页 byte-identical);Extracted 类型 + assignLowcodeLayoutFix 两 case(requiresAuth 严格 `===true` gate 同 FREE、authRedirect string 守卫);assignImportedLowcodeFields 两行。
- **IR**(ir/types.ts):`IRTree.requiresAuth?` + `authRedirect?`(可选 → 无 .vue stub 破坏,区别 §16.1 必填 usesRouteParams)。
- **collect**(tree.ts):新 `liftRequiresAuth(graph,page,pageId,docStatesByName,docStateReads,warnings)` —— `page.lowcodeRequiresAuth!==true`→`{}`;**无 `$currentUser`(无 supabase)→ warn `auth-guard-no-supabase` + 留 public**;否则 `docStateReads.add('$currentUser')`(→ 自动 emit hook)+ 从 root 解析 authRedirect(默认 `/login`)。
- **scaffold**(scaffold.ts):`guarded = routerAvailable && ir.requiresAuth===true`;guardLine 加进 hookLines 数组尾(在 `$currentUser` hook 之后、return 之前);**抽 `buildRouterImport(ir,needsNavigate,usesRouteParams,guarded)` helper**(useNavigate/generatePath/useParams/Navigate 合一)消 buildPageFile complexity。
- **单页警告**(index.ts `emitSinglePage`):`cleaned.requiresAuth` → warn `auth-guard-no-router`(单页无 router 不能 redirect,scaffold `routerAvailable` 门控已跳过 emit;经验 A 不静默丢)。

**GATE 收口 2 处(complexity,经验「加分支前看闸」)**:`serializeLowcodeFields` 22>20 → 抽 `serializeRoutingAuthFields`(routePattern+requiresAuth+authRedirect 三 entry 移出,同位置调用 → 顺序/byte-identical 不变);`buildPageFile` 24>20 → 抽 `buildRouterImport`。

**成功标准(headless)**:

1. 多页 + supabase + 页 requiresAuth → `import { Navigate }` + `const $currentUser = useDocState("$currentUser")` + `if (!$currentUser.signedIn) return <Navigate to="/login" replace />`;public 页无守卫。
2. root `lowcodeAuthRedirect` 覆盖默认(`/signin`)。
3. requiresAuth 无 supabase → warn `auth-guard-no-supabase` + 留 public(不 emit 引用不存在 docState 的守卫)。
4. 单页 → warn `auth-guard-no-router` + 不 emit。
5. round-trip:requiresAuth(页)+ authRedirect(root)经 .fig 存活;无则 byte-identical。
6. `bun run check` exit 0;tsgo 0;jscpd 0;compiler/kiwi/scene-graph/tools 全绿。
7. **真机验 pending**:部署多页站,未登录访问受保护页实际跳登录页 + 登录后可访问。

**交付记录(CODE COMPLETE 2026-06-21,feat `f91bb4a4`)**:

- 实现按设计 7 src + 2 test(routing.test +7 / kiwi roundtrip +1),**零新 ActionDef kind / 零 tool 改动**(页/根路由字段非 AI-settable,§16.1 先例)。
- **关键约束**:`$currentUser` 仅 supabase 配置时存在 → 守卫严格 gate 在 supabase 上(无则 warn + public);守卫 emit 用 `<Navigate>` 早返(声明式,免 useEffect)。
- **GATE 收口 2 处(complexity)**:serializeLowcodeFields→serializeRoutingAuthFields、buildPageFile→buildRouterImport(均抽 helper,行为不变)。
- **GATE**:`bun run check` exit 0;tsgo 0;jscpd 0;compiler **676/0**(+7)、kiwi **122/0**(+1)、scene-graph 202/0、tools 196/0 零回归;check:vue 0。零 hotfix。
- **e2e 实跑**:scratch 多页 .fig(root supabaseConfig + `lowcodeAuthRedirect:/signin`,Dashboard 页 requiresAuth)经 CLI compile → `dashboard.tsx` 出 `import { Navigate }` + `$currentUser` read + `if (!$currentUser.signedIn) return <Navigate to="/signin" replace />`;`index.tsx`(public)0 守卫。**§16.1+§16.2+§16.3 链端到端通**(声明路由 + 带参跳 + 守卫)。
- **边界**:守卫前提 = supabase 配置(无则 warn);单页无守卫(warn);`signedIn` 首帧 false→已登录用户可能闪一下登录页再回来(SPA auth-guard flash,runtime session 同步前;v1 接受,后续可加 loading 态);redirect 目标不与页 route 交叉校验(延续 §16.x)。**§16.4 起手**:query string `$query.foo` ← useSearchParams(BUILTIN_READ_IDENTS 加 `$query`,与 `$params` 平行)。**新经验:页级路由特性字段(routePattern/requiresAuth)走 graph.updateNode + .fig round-trip,刻意不进 update_lowcode_node PATCH_KEYS(非 AI-settable,§16.1 先例延续);新增页/根 round-trip 字段达 3+ 时把 serialize 的尾部分支抽溢出组 helper(同 assignLowcodeLayoutFix 先例)避 complexity-20 闸。**

### §16.4 query string 详细设计 + 交付(2026-06-21,无分叉)

> **目标**:页表达式可读 URL query 参数 `$query.foo`(`?foo=bar`),与 §16.1 `$params` 命名空间完全平行。补全 §16 路由链(声明动态路由 → 带参跳详情 → auth 守卫 → 读 query)。**读优先**(write = setSearchParams 无干净 authoring 入口,见边界,延后)。

**现状坐实(经验 Q/E)**:§16.1 已把 `$params` 做成 sentinel-ride 内置只读源:`BUILTIN_READ_IDENTS`(bindings.ts)+ `unknownIdentifiers` 跳过 + `registerDocStateReads` 单 chokepoint 把 `$params` 搭车进 `docStateReads` + `collectTree` 末 `docStateReads.delete(ROUTE_PARAMS_IDENT)` 抽 `usesRouteParams` + scaffold `routerAvailable` 门控 emit `const $params = useParams()`。§16.4 完全镜像这条。

**设计(无 AskUserQuestion,直接平行 §16.1)**:

- **`$query` 内置只读源**(bindings.ts):`QUERY_PARAMS_IDENT='$query'` 入 `BUILTIN_READ_IDENTS`;`registerDocStateReads` 的 sentinel 条件从 `ref===ROUTE_PARAMS_IDENT` 收敛成 `BUILTIN_READ_IDENTS.has(ref)`(`$params`+`$query` 都搭车,单点)。
- **collect**(tree.ts):`usesQueryParams = docStateReads.delete(QUERY_PARAMS_IDENT)`(平行 usesRouteParams),入 IRTree。
- **IR**(ir/types.ts):`IRTree.usesQueryParams?: boolean`(**可选** → 不破 .vue IRTree stub,§16.3 教训)。
- **emit**(scaffold.ts):`routerAvailable && ir.usesQueryParams` → routerNames push `useSearchParams` + hook line `const $query = Object.fromEntries(useSearchParams()[0])`。**关键:`useSearchParams()[0]` 是 URLSearchParams(`.get('foo')` 取值,无 `.foo`),用 `Object.fromEntries` 转 plain object → `$query.foo` 成员访问可直接用**(与 `$params`=useParams() 返回 object 不同,query 要转换)。
- **complexity 预防(经验「加分支前看闸」)**:buildPageFile 加 query 分支会再撞 20 闸 → 主动抽 `RouterUsage` 接口 + `buildRouterHookLines`(navigate/$params/$query 三 hook 行)+ buildRouterImport 收 `RouterUsage`,把多个 ternary 移出 buildPageFile。
- **零碰**:无新 scene-graph 字段(`$query` 在 bindings 表达式串里,随 `lowcode/bindings` 整块 round-trip)→ **零 round-trip / 零 scene-graph / 零 tool 改动**;单页无 router → 不 emit(byte-identical)。

**成功标准(headless)**:

1. 页表达式 `$query.foo` + 多页 → `import { useSearchParams }` + `const $query = Object.fromEntries(useSearchParams()[0])` + emit `$query.foo`;`$params` + `$query` 同页共一个 react-router-dom import(navigate/useParams/useSearchParams 合一)。
2. 无 `$query` → usesQueryParams false,byte-identical;单页 → 不 emit。
3. `bun run check` exit 0;tsgo 0;jscpd 0;compiler/kiwi/scene-graph/tools 全绿。
4. **真机验 pending**:浏览器 `/products?sort=price` 实际 `$query.sort` 渲 `price`。

**交付记录(CODE COMPLETE 2026-06-21,feat `7c315609`)**:

- 实现按设计 4 src + 1 test(routing.test +6),**零 scene-graph / 零 round-trip / 零 tool 改动**(§16.x 最干净一片;`$query` 随 bindings 表达式 round-trip)。
- **`$query.foo` 成员访问靠 `Object.fromEntries(useSearchParams()[0])`**(URLSearchParams→plain object;区别 §16.1 `$params`=useParams() 本就是 object)。
- **complexity 主动收口**:抽 `RouterUsage` + `buildRouterHookLines`(把 §16.3 已抽的 buildRouterImport 一并收进 RouterUsage 入参),buildPageFile 压回 20 以下,无 GATE 报错。
- **GATE**:`bun run check` exit 0;tsgo 0;jscpd 0;compiler **682/0**(+6)、kiwi 122/0、scene-graph 202/0、tools 196/0 零回归;check:vue 0。零 hotfix。
- **e2e 实跑**:scratch 多页 .fig(Products 页文本绑 `$query.sort`)经 CLI compile → products.tsx 出 `import { useSearchParams }` + `const $query = Object.fromEntries(useSearchParams()[0])` + `<p>{$query.sort}</p>`。**§16 路由链(§16.1+§16.2+§16.3+§16.4)全部闭合**。
- **边界 / 延后**:**write(setSearchParams 写 query)延后** —— 无干净 authoring 入口(需新 action kind 或扩 navigate,经验 A union widening),且 navigate-to-`/path?q=v` 已覆盖静态 query 写;`Object.fromEntries` 对重复 key(`?a=1&a=2`)取末值(数组 query 是边界,延后);`$query` 值恒为 string(URLSearchParams 语义)。**新经验:第二个 sentinel-ride 内置只读源(`$query`)零成本搭 §16.1 既有 `$params` 机制(BUILTIN_READ_IDENTS + registerDocStateReads 单 chokepoint 收敛成 `BUILTIN_READ_IDENTS.has` + collect 末 Set.delete 抽布尔)—— 印证 §16.1「sentinel-ride 穷举-by-construction」对追加内置源的可扩展性;React hook 返回值形状不同时(useParams=object vs useSearchParams=URLSearchParams),emit 端按需转换(Object.fromEntries)让表达式层成员访问统一。**

## §17 列表绑真实数据源 + 分页 / 排序 / 筛选

> 2026-06-20 产品缺口盘点新增。Bubble「repeating group」核心。

**现状(grep 坐实)**:`IRList`(ir/types.ts:256,Phase 2 §9)只对「array-typed **state** datasource」emit `.map()`。绑真实数据源要 `supabaseQuery action → setState(array) → LIST`(Phase 3 §2),**间接绕且无分页/排序/筛选**。

**剩余 / 建议方向**:

- **repeater 直接声明数据源 = Supabase query**(表/select/where/order/limit),编译期 emit 拉取 + `.map()`,免手搭 supabaseQuery→setState 链。
- **分页**:offset/cursor 分页 + 上一页/下一页 / 加载更多控件。
- **排序 / 筛选 UI**:绑控件值 → query order/where(复用 §3.v4 controlled bindings)。

**类型**:headless emit;与 §2 Supabase + §16 路由参数(详情页 `/product/:id` 从列表点入)天然成链。**待锁**:数据源声明位置(LIST 节点新字段 vs 复用 supabaseQuery 配置);分页模型(offset vs cursor);客户端筛选 vs 服务端 query。

### §17 详细设计 + 锁定决定(2026-06-21,AskUserQuestion 锁定)

**分叉锁定**:① 首片范围 = **全做**(数据源 + 分页 + 排序/筛选 UI)—— 用户选最进取项;② 数据源声明形态 = **LIST 内联 query 配置**(挂在 `dataSourceRef` 上,随 interactiveProps JSON blob round-trip → 零 codec)。**统一机制**:filter/sort/pagination 全靠「query 表达式引用响应式值(docState/page-state)」+ 复用既有 §3.v4 controlled bindings / setState 驱动控件 → **无新 ActionDef kind**。体量较大,按 §16 节奏分 §17.1→.2→.3 三片交付,每片 `bun run check` 绿。

**交付记录(CODE COMPLETE 2026-06-21,§17.1 `ff7ac57c` / §17.2+§17.3 `231c732d`)**:

- **§17.1 数据源 + 响应式 filters**:LIST `dataSourceRef.kind==='supabaseQuery'` + `query{table,columns,filters,orderBy,limit}` → 编译期 emit per-LIST fetch hook(`useState` rows + `useEffect` 跑 `getSupabaseClient().from(t).select(c)<filters><order><limit>`,`active` 守卫防卸载后 setState)+ `.map()` 迭代 rows。filters 复用 §2 `resolveSupabaseFilters`(`valueExpr` 走表达式子语言)→ 引用的 docState 进 effect deps = **绑控件即实时筛选,零额外接线**。门控 = supabase 配置(`$currentUser` proxy,同 §16.3);组件内的 supabase LIST 拒绝(无 page hook 槽)。`$`-builtin($params/$query)dep 走 `JSON.stringify` 防对象身份每渲染重跑。
- **§17.2 offset 分页**:`query.offsetExpr`(如 `$page * 20`,需 `limit` 页大小)→ emit `.range(offset, offset+size-1)` 取代 `.limit(size)`;offset 引用的 docState 进 deps → 用户自建的上一页/下一页 setState 改 page docState 即翻页。offset 无 limit → warn + 忽略分页(不丢整 list)。
- **§17.3 动态排序**:orderBy 子句接受响应式 `columnExpr`/`ascendingExpr`(覆盖静态 `column`/`ascending`)→ `.order(<expr>, { ascending: <expr> })`;绑 select/toggle 到引用的 docState 即实时改排序列/方向。静态 + 响应式子句共存。
- **§17.4 动态控件 options(CODE COMPLETE 2026-06-23)**:SELECT/RADIO/CHECKBOX 接受 `interactiveProps.optionsSource = { kind:'ref'|'stateRef'|'docStateRef', stateId?/docStateName?, itemName?, indexName?, valueExpr?, labelExpr? }`;source 必须是 array-typed page state / docState(docState 自动注册 read)。collect 将 options 降成控件内部 `IRList` 模板:SELECT → 动态 `<option value={...}>{...}</option>`;RADIO/CHECKBOX → 动态 `<label><input ... value={...}/>{...}</label>`。`valueExpr`/`labelExpr` 在 item/index 作用域解析,省略时回退到 item 本身。plain HTML 与 shadcn 双 emit 覆盖:shadcn SelectItem / RadioGroupItem / Checkbox rows 均支持动态 value,受控 CHECKBOX array toggle 用同一个 value 表达式做 `includes/spread/filter`。
- **共享机制**:泛型 `resolveListQueryExpr`(offset + sort 共用,与 filter 同一套 read-context 校验:拒 `$prev`/未知标识/注册 docState read);坏表达式丢整 list(filter posture);deps 聚合 filter+sort+offset 全部响应式 refs。
- **GATE**:`bun run check` exit 0;tsgo 0;jscpd 0;compiler **696/0**(+11)、kiwi **125/0**(+1 round-trip)、scene-graph 202/0、tools 196/0 零回归。2 次 complexity 闸(buildPageFile→抽 buildReactImport;resolveListSupabaseQuery→抽 resolveListOffset)按规则提前/即时收口。
- **边界 / 延后**:**纯数据层**——§17 让 LIST 数据响应控件,并让控件 options 响应已存在数组数据,但**不自动生成**分页/排序/筛选控件(用户用既有 setState 按钮 + controlled bindings 自接,Bubble 模型);query/optionsSource 写在 interactiveProps,**无 AI tool / 无 GUI**(graph.updateNode + .fig round-trip,沿用 §7/§16.1 先例);optionsSource v1 读取既有 array state/docState,**不为单个控件自动 emit Supabase query hook**;cursor 分页延后(offset 已覆盖常见场景);columns/table 静态(schema 感知 autocomplete 出范围)。**与 §16 成链**:filter `valueExpr` 可引用 `$params.id` → 详情页 `/post/:id` 直接列出该 id 的子数据(dep 走 `JSON.stringify($params)`)。**真机验积压 +1**:浏览器实拉 Supabase 表渲染 + 改筛选/排序/翻页控件实时刷新。

## §18 文件 / 图片上传(Supabase Storage)

> 2026-06-20 产品缺口盘点新增。头像/附件/封面近乎通用需求。

**现状(grep 坐实)**:**app 级上传零实现**(代码里 `upload` 只在 deploy 路径)。

**剩余 / 建议方向**:上传控件(新 NodeType 或 INPUT `type=file` interactiveProp)→ emit Supabase Storage `.from(bucket).upload()` + `getPublicUrl()` + 上传进度 / 预览;上传结果 URL 进 docState/binding(供后续表单提交/展示)。

**类型**:headless emit + **可能动 scene-graph**(新交互节点或 interactiveProp)→ 比纯 emit 候选更 invasive,经验 A/G(union widening)必走。**待锁**:用新 NodeType 还是 INPUT type=file prop;bucket / 路径约定;public vs signed URL。

### §18 详细设计 + 锁定决定(2026-06-21,AskUserQuestion 锁定)

**分叉锁定**:① 控件形态 = **INPUT 上 upload interactiveProp**(否决新 FILEUPLOAD NodeType —— **零 scene-graph/codec 改动,随 interactiveProps blob round-trip,延续 §17 经验**;避开经验 A/G union widening);② URL 形态 + 范围 = **public URL 核心上传**(`getPublicUrl` → resultTarget docState;单文件;否决 signed URL / 进度 / 预览 / 多文件,全延后)。

**交付记录(CODE COMPLETE 2026-06-21,feat `d99ae83b`)**:

- **数据模型**:INPUT `interactiveProps.upload = { bucket, resultTarget, pathExpr?, accept? }`(自由 blob,**零 scene-graph/codec**)。
- **collect**(tree.ts):`applyUploadInput` 门控 supabase(`$currentUser` proxy,同 §16.3/§17)+ bucket 非空 + resultTarget 是合法 docState(注册为 write → 自动 import `setDocState`);可选 `pathExpr` 走共享 `resolveReactiveExpr`(原 §17 `resolveListQueryExpr` 改名泛化);丢弃 file input 不需要的 text 属性(placeholder/value/defaultValue/type)。`resolveControlDescriptors` 把 upload>controlled>controlKind 的互斥优先级收进一个 helper(nodeToIR complexity 闸)。
- **emit**(element.ts):`<input type="file">` + accept + async onChange(`uploadAttrParts` + `emitUploadHandler`,formatAttrs complexity 闸):`const __file = e.target.files?.[0]; if (!__file) return; const __path = <pathExpr 前缀>/__file.name | __file.name; await getSupabaseClient().storage.from(bucket).upload(__path, __file, {upsert:true}); if (!error) setDocState(resultTarget, …getPublicUrl(__path).data.publicUrl)`。path = `` `${<pathExpr>}/${__file.name}` ``(有前缀)或裸 `__file.name`。
- **import gate**(ir-walk):`treeHasUpload` 扩入 `pageUsesSupabase`(getSupabaseClient import)。
- **GATE**:`bun run check` exit 0;tsgo 0;jscpd 0;compiler **702/0**(+6)、kiwi **126/0**(+1 round-trip)、scene-graph 202/0、tools 196/0 零回归。2 次 complexity 闸(nodeToIR→resolveControlDescriptors;formatAttrs→uploadAttrParts)即时收口。e2e probe 实跑输出正确。
- **边界 / 延后**:**upload INPUT 不走 controlled**(file input 天然 uncontrolled,互斥);upsert:true(同路径覆盖);单文件(`files[0]`);**无 AI tool/无 GUI**(graph.updateNode + .fig round-trip,§7/§17 先例);signed URL / 进度条 / 本地预览 / 多文件延后。**与 §17 成链**:上传 URL 进 docState → 可作 supabaseMutation payloadEntries(存进表)或后续展示。**真机验积压 +1**:浏览器选文件 → Supabase Storage 实传 → URL 落 docState。**新经验**:延续 §17「interactiveProps 自由 blob 加结构化子配置零 codec」—— §18 给 INPUT 加 upload 子配置零 scene-graph,印证「给现有交互节点加能力」首选 interactiveProp 而非新 NodeType(避经验 A/G);多个互斥 control 描述符(upload/controlled/controlKind)收进一个 resolveControlDescriptors helper 既守 complexity 闸又表达优先级。

## §19 表单校验

> 2026-06-20 产品缺口盘点新增。

**现状(grep 坐实)**:FORM 节点在,但 input 节点**无 required/pattern/min-max/自定义校验 + 错误提示 + 提交拦截**(代码里 validation 全是编译器内部校验,非用户表单校验)。

**剩余 / 建议方向**:input 节点 interactiveProps 加校验规则(required/pattern/minLength/maxLength/min/max/自定义表达式)→ emit 客户端校验 + 错误消息显示 + FORM submit 时拦截非法 + 可绑 `:invalid` 状态。**复用 §3.v6 InteractiveProps 通用编辑器框架** + §4 表达式子语言(自定义规则)。

**类型**:headless emit;无 scene-graph 改动(走 interactiveProps,schema-native pluginData)。**待锁**:校验规则数据形态(每 input 一组规则);错误显示位置(节点下方 vs FORM 级汇总);校验时机(onBlur/onChange/onSubmit)。

### §19 详细设计 + 锁定决定(2026-06-22,3 个待锁 fork 经 AskUserQuestion 全锁推荐项)

**三 fork 锁定**(全推荐项):① 校验时机 = **onSubmit 拦截 + onBlur 实时**(提交校验全部字段并拦截非法提交,字段失焦校验该字段给即时反馈,= React Hook Form 默认);② 错误显示 = **字段下方逐个显示**(每非法 input 下 emit 一条红色 `<p>` + `aria-invalid`);③ 规则集 = **核心规则 + 自定义表达式**(required/pattern/minLength/maxLength/min/max + customExpr,每规则可配自定义消息)。

**前提约束**:校验只挂**受控字段**(有 `bindings.value` → docState/page-state),因为校验要读字段当前值;无值源的非受控 input 带 validation → warn `validation-not-controlled` + 跳过(留 plain input)。docState 绑定的字段值在校验时经 `getDocStateSnapshot` **新鲜读**(绕开 §10 v9 同-handler 渲染快照陈旧),page-state 绑定读其 `useState` 局部。

**数据模型(零 scene-graph/codec,延续 §17/§18 的 interactiveProps blob 路径)**:受控 input `interactiveProps.validation = { required?, pattern?, minLength?, maxLength?, min?, max?, customExpr?, messages?: { required?, pattern?, minLength?, maxLength?, min?, max?, custom? } }`。随 `lowcode/interactiveProps` 整块 round-trip。

**实现(纯 compiler-emit,8 文件)**:

- `ir/types.ts`:`IRFieldValidation { key; stateName; stateKind; rules: IRValidationRules; custom?: IRValidationCustom }` + `IRValidationRules`/`IRValidationMessages`/`IRValidationCustom`;`IRElement.validation?`(字段)+ `IRElement.formValidationKeys?`(`<form>` 的受控校验后代键)+ `IRTree.validatedFields?`(页级累加,**全可选 → 不破 .vue IRTree stub**,§16.3 教训)。
- `ir/collect/tree.ts`:`WalkCtx.validatedFields` 累加器;`applyValidation(node,ctx,controlled,events)`(读 validation 配置,parse 核心规则[pattern compile 校验、数值 finite 校验,坏规则 warn+drop]、customExpr 经共享 `resolveReactiveExpr` 解析[复用 §17,拒 `$prev`/未知标识、注册 docState read]、onBlur 冲突 warn+drop[校验占有 onBlur]),接进 `resolveControlDescriptors`(受控才解析,非受控带配置 warn);`collectValidationKeys(nodes)` 给 FORM 收后代校验键 → `element.formValidationKeys`;collectTree 末 lift `validatedFields`。
- `adapters/react/lowcode/validation.ts`(新):`buildLowcodeValidationRuntime()`(`_lowcode_validation.tsx` 的纯 `validateValue(value, rules)` —— 核心规则求值,首条失败规则消息[自定义或默认],空可选字段跳过非 required 规则;**消息用字符串拼接非 `${}` 避 no-template-curly**)+ `buildValidationGlue(fields)`(页级 `useState` 错误存 + `__validators` map[每字段一闭包:核心规则调 `validateValue`,customExpr 内联 `emitExpression`]+ `__validateField`(onBlur)/`__validateFieldValue`(onChange next value)/`__validateFields`(onSubmit)) + `VALIDATION_ERROR_CLASSES` safelist。
- `adapters/react/emit/event.ts`:`emitFormSubmitHandler(handlers, keys)` →`(e) => { e.preventDefault(); if (!__validateFields([keys])) return; <user onSubmit> }`(取 `e` 参 preventDefault;async 跟随用户 handler)。
- `adapters/react/emit/element.ts`:`formatAttrs` 加 `validationKey`(`aria-invalid` + 验证-onBlur)+ `formValidationKeys`(包裹 onSubmit,即使无用户 onSubmit 也 emit 验证-only);`emitTagElement` 拆 dispatcher + `emitTagElementCore`,验证字段经 `wrapValidatedField` 包成 `<>{input}{__fieldErrors[k] && <p role=alert/>}</>`(内层元素 +1 缩进);`eventAttrParts`/`validationFieldParts` 抽出守 complexity。
- `adapters/react/scaffold.ts`:`buildReactImport` 加 `useState`(验证错误存);`buildLowcodeStateImport` 加 `getDocStateSnapshot`(docState 绑定字段);`buildLowcodeRuntimeImports` 抽出(supabase/toast/confirm/validation 四 import,**守 buildPageFile complexity 24→19 闸**,§16.4 RouterUsage 先例);hookLines 插 validation glue(docState hoist 之后,customExpr 引用它们);`BuildPageOptions.lowcodeValidationImportPath`。
- `adapters/react/index.ts`:`maybeEmitLowcodeValidationRuntime` + `validationActive` 双路径计算 + `emitLowcodeRuntimes` 抽共享(6 个 maybeEmit 调用收一处,**消 jscpd clone**)+ import 路径单/多页 + safelist 并入 VALIDATION_ERROR_CLASSES。

**交付记录(CODE COMPLETE 2026-06-22,feat `e888effb`)**:实现按设计 8 src 文件 + 2 test 文件;**2 处 GATE 收口**(complexity:buildPageFile→`buildLowcodeRuntimeImports`;jscpd:双路径 maybeEmit 序列→`emitLowcodeRuntimes` 共享 helper),零 hotfix、零意外。

- **GATE**:`bun run check` exit 0;tsgo 0;jscpd 0;compiler **715/0**(+13 form-validation.test)、kiwi **127/0**(+1 round-trip)、scene-graph 202/0、tools 196/0 零回归;check:vue 0。
- **e2e 实跑**:scratch 多字段验证表单 .fig(required+pattern+minLength+customExpr+中文消息,FORM onSubmit setVariable)经 `exportFigFile` 写真盘 → CLI `compile` → App.tsx 出 `validateValue` import + `getDocStateSnapshot` 新鲜读 + `__validators` map(核心规则 JSON + 转义 pattern `\\.` + 中文消息)+ customExpr 内联 `if (__error === null && !(email !== "blocked@x.com")) __error = "该邮箱被禁用"` + 字段 `aria-invalid`+`onBlur` + 错误 `<p className="text-sm text-red-600 mt-1" role="alert">` + form `onSubmit={(e) => { e.preventDefault(); if (!__validateFields(["0:5"])) return; setDocState("status", "submitted"); }}` + index.css safelist 含 text-red-600 + `_lowcode_validation.tsx` 含 validateValue(scene-graph→.fig→parse→IR→emit 全链 + 真盘 round-trip)。
- **§19 v2 onChange 实时校验(CODE COMPLETE 2026-06-23)**:受控 validated field 的合成 `onChange` 现在按 `writer → __validateFieldValue(id,nextValue) → user onChange` 顺序输出。`__validateFieldValue` 直接吃 event next value,避免同一 handler 内 React/page-state 尚未提交导致读旧值;`onBlur`/`onSubmit` 仍走 `__validateField`/`__validateFields` 的快照读取。覆盖 docState/page-state 字段、无用户 onChange baseline、以及用户 onChange 组合顺序。
- **§19 v3 FORM 级错误汇总(CODE COMPLETE 2026-06-23)**:FORM 可通过 `interactiveProps.validationSummary=true` 或 `{ enabled:true,title }` 显式开启汇总;默认关闭保持旧产物 byte-stable。开启后 adapter 在 `<form>` 内 emit 基于同一组 `formValidationKeys` / `__fieldErrors` 的聚合 `<div role="alert">`,逐项列出当前字段错误。覆盖 opt-in emit、默认不输出,并把 `tools/lowcode/src/validation-runtime-smoke.ts` 扩到真实 Chromium 验证 summary 聚合。
- **§19 v4 async remote custom validators(CODE COMPLETE 2026-06-23)**:受控 field 可声明 `interactiveProps.validation.async={ url|urlExpr, method:"GET"|"POST", message }`。生成 runtime `validateRemote(value, config)`:POST 发送 `{ value }`,GET 追加 `?value=...`;endpoint 返回 `{ valid:true }` 通过,否则用返回 `message` 或 fallback message。执行顺序 = core rules → sync `customExpr` → async remote;async 只在 blur/submit 跑,onChange 仍只跑本地即时规则,避免远程请求竞态覆盖 blur/submit 的权威错误。blur 改用 event target current value 调校验,避免 page-state render snapshot 尚未更新。覆盖静态 url、`urlExpr`、method 校验、runtime helper emit,并把 `tools/lowcode/src/validation-runtime-smoke.ts` 扩到真实 Chromium 拦截 endpoint 验证 remote invalid 阻止 submit、valid 放行。
- **§19 v5 GUI + component-internal fields(CODE COMPLETE 2026-06-23)**:右侧属性面板新增 `ValidationPanel.vue`,字段节点(INPUT/TEXTAREA/SELECT/DATEPICKER)可 author required、pattern、min/max、customExpr、自定义消息和 async remote endpoint;FORM 可 author validationSummary enabled/title。面板直接写 `interactiveProps.validation` / `interactiveProps.validationSummary`,零 scene-graph/codec。组件体 walk 现在也携带 `validatedFields`、`docStateReads`、`docStateWrites` 到 `ComponentDef`;React component module 按需 import `useState`、`../_lowcode_state`、`../_lowcode_validation`,并在组件函数内生成 component-local `__fieldErrors`/`__validators` glue,所以每个组件实例的错误状态互不污染。项目级 `_lowcode_validation.tsx` runtime 触发条件扩为 page 或 reachable component 任一存在 validated field。
- **§19 v6 remote debounce/cancel(CODE COMPLETE 2026-06-23)**:生成 runtime 的 `validateRemote(value, config, signal?)` 现在把 `AbortSignal` 传进 GET/POST `fetch`,并把 abort 当成无错误返回。页面/组件 glue 仅在存在 async remote validator 时额外 import `useRef`,维护每字段 seq + `AbortController`;新的 blur remote 校验会先 abort 旧请求,等待 150ms debounce 后再发请求,返回时若 signal 已 abort 或 seq 已过期则不写 `__fieldErrors`。submit 仍不 debounce,会立即 abort 旧请求并跑权威校验;onChange 继续只跑本地规则,但会 abort/作废同字段仍在途的 remote 结果。
- **§19 v7 AI tool/schema boundary(CODE COMPLETE 2026-06-23)**:`update_lowcode_node` 的 `interactiveProps` 仍保留自由 blob sibling 透传,但对已知 §19 子配置硬校验: `validation` 只允许 required/pattern/minLength/maxLength/min/max/customExpr/messages/async;pattern 必须可编译、数字规则必须 finite、customExpr/urlExpr 必须能过表达式 parser;messages 只允许已知 key 且值为 string;async 必须有且仅有 `url` 或 `urlExpr`,method 只允许 GET/POST;`validationSummary` 只允许 boolean/null 或 `{ enabled?: boolean, title?: string }`。坏 schema 在 tool boundary 拒绝,不再等 compiler warn+drop。
- **§19 v8 ValidationPanel GUI E2E(CODE COMPLETE 2026-06-23)**:新增 `tests/e2e/properties/validation-panel.spec.ts`,真实 Playwright 选中 value-bound INPUT / FORM,通过右侧 inspector 写 required、minLength/maxLength、pattern、customExpr、自定义 messages、async remote URL/method/message、FORM validationSummary,并断言 SceneNode `interactiveProps.validation` / `validationSummary` 持久化。E2E 同时覆盖清空字段规则会删除 validation 配置;由此修复 GUI 清空 numeric rule 时留下 `{ minLength: undefined }` 的空 validation entry。验证:targeted Playwright 3/0 + `bun run check` exit 0。
- **边界 / 延后**:校验只挂受控单值字段(RADIO/CHECKBOX group 的值在 leaf 上,v1 不校验,warn);customExpr 用渲染快照读 docState(blur/submit 时已提交,正确;同-handler 程序化 setDocState 后陈旧 —— 罕见,核心规则 onChange 用 next value、blur 用 event current value、submit 用 getDocStateSnapshot 新鲜读);async custom v1 是远程 endpoint,不注入任意 JS 函数;组合型 UI-kit 控件(shadcn Select 等)校验时错误 `<p>` 仍显示但无 per-field onBlur/aria(kit 自有 markup);GUI 暂不显示 CHECKBOX/SWITCH/RADIO 校验入口,避免鼓励当前 boolean/group blur-value 边界。**真机 ACK 2026-06-23**:`tools/lowcode/src/validation-runtime-smoke.ts` 用 compiler preview server + Chromium 跑真实 React app,覆盖 onChange 即时报错、blur required、summary 聚合、async remote error、非法 submit 拦截、合法 submit 跑用户 onSubmit。**§19 follow-ups**:全量 Playwright 按需补。

**新经验**:① §17/§18/§19 三度印证「给现有交互节点加能力 = interactiveProps 子配置(零 codec/零 scene-graph,随 blob round-trip)」是首选路径;② 页级 emit 增量(validators map + 错误存)= 抽运行时纯函数(`validateValue` 进 `_lowcode_validation.tsx`,跨页 DRY)+ 页级 glue(`buildValidationGlue`)+ per-字段/form emit 三层;③ 「字段 emit 包错误兄弟节点」用 dispatcher 拆 core + fragment 包裹(`emitTagElement`→`emitTagElementCore` + `wrapValidatedField`),内层元素 +1 缩进,避免重排 children 数组;④ FORM 提交拦截 = 一个 `emitFormSubmitHandler` 在 event.ts 复用 `emitStatementList` 把 `preventDefault + validate-abort` 前置到用户 handler,无须改 events 解析;⑤ 加分支撞 complexity/jscpd 即时抽 helper(`buildLowcodeRuntimeImports` 守 complexity、`emitLowcodeRuntimes` 消 clone),提前看闸别等报。

---

## §20 交互状态样式(hover / focus / active / disabled variants)

> 第二波。**最值得先做**(复用 §7 variant-emit,零新概念,立刻给产物交互质感)。

**现状(grep 坐实)**:用户节点无状态变体样式 —— `hover:` 命中全是 shadcn 模板内部,无用户可授权的 hover/focus/active 样式。

**建议方向**:

- 节点可声明 `hover/focus/active/disabled` 的样式覆盖,形态同 §7
  `responsiveOverrides` 的 `Partial<Pick<SceneNode, 样式键>>`。
- emit 复用 §7 的 **style-level diff + 前缀**机制
  (`hover:bg-...` / `focus:ring-...`),并复用 `LAYOUT_STYLE_RESET` 思路。
- round-trip 走 `lowcode/stateOverrides` 通道。

**待锁**:状态集合(是否含 group-hover / focus-within);与 §7 断点的组合(`md:hover:`)。

### §20 详细设计 + 锁定决定(2026-06-21,无 AskUserQuestion — 明确保守默认,镜像 §16.2/§16.4「直接推荐项」)

**锁定 scope**(助手推荐,三个分叉皆保守默认):

1. **状态集合 = hover/focus/active/disabled 四个核心**(否决 group-hover/focus-within —— 它们需「`group` 祖先」概念,谁是 group 根是更大设计,延后)。
2. **可覆盖属性 = 仅 appearance**(`fills`/`strokes`/`cornerRadius`/`opacity`/`effects`)—— 交互态是「视觉反馈」非「重排」,layout-on-hover 罕见;reset map 因此聚焦 appearance 默认值。
3. **不支持断点×状态组合(`md:hover:`)v1** —— 正交、组合爆炸,延后;状态前缀仅顶层。
4. **v1 起初无 GUI;tool read/write 后续接通**(先经 `graph.updateNode` + .fig round-trip 验证,再补 AI/MCP tool 边界;GUI 仍延后)。
5. round-trip 走 `lowcode/stateOverrides`(镜像 responsiveOverrides,经 `...lowcodeRest` 落到节点,零 codec override)。

**实现 6 文件**:

- `scene-graph/types.ts`:`InteractionState`/`StateOverride`(appearance-only Pick)/`StateOverrides` + `SceneNode.stateOverrides?`(**可选 → 不破 .vue IRTree stub**,§16.3 教训)。
- `io/formats/jsx/tailwind-classes.ts`:
  - 把 §7 的 `layoutStyleDelta` 泛化为 `styleDelta(base,variant,resetMap)`。
  - 抽共享 `collectVariantClasses<V>`;breakpoint/state 共用
    `merge override → nodeToStyle → diff → twirl → ${variant}:` 核心。
  - 新增 `INTERACTION_STATES`、`STATE_STYLE_RESET`、
    `collectStateTailwindClasses`,并从 jsx barrel 导出。
- `compiler/ir/style.ts`:`tailwindClassName` 在 base/responsive 后追加 state classes。
- `lowcode-plugin-data.ts`:
  `LOWCODE_STATE_OVERRIDES_KEY` 入 `LOWCODE_PLUGIN_KEYS`,并补 serialize /
  Extracted 字段 / assign case / `isStateOverrides` 轻校验。

**交付记录(CODE COMPLETE 2026-06-21,feat `209371ad`)**:

- 实现按设计 6 src/test 触点 + 3 test 文件(core unit 8 / compiler 3 / kiwi round-trip 2)。**零 hotfix、零 GATE 收口**(jscpd 0 —— 共享 `collectVariantClasses` 把 responsive/state 两 collector 去重),**零意外**。
- **关键复用**:state 与 §7 responsive 共用同一条 `nodeToStyle`
  style-level diff 管线。两者仅前缀(`hover:` vs `md:`)、reset map
  (appearance vs layout)和属性集不同。
- **GATE**:`bun run check` exit 0;tsgo 0;jscpd 0;compiler **685/0**(+3)、
  kiwi **124/0**(+2)、scene-graph 202/0、tools 196/0 零回归;check:vue 0;
  render/jsx +8(仅既有 §6 frame-nested 出范围 fail)。
- **e2e 实跑**:scratch .fig(HoverCard 帧带 `stateOverrides.hover.fills` +
  `disabled.opacity`)经 IORegistry 写真 .fig → CLI compile → App.tsx 出
  `bg-white hover:bg-[#EDF2FA] disabled:opacity-50`。
- **边界 / 延后**:`disabled:` 仅匹配 form 控件(input/button/select/textarea);
  其它节点上为惰性 util;GUI 仍延后;group-hover/focus-within +
  断点×状态组合延后。
- **新经验**:把同形态的两个 variant emitter 收敛到泛型
  `collectVariantClasses<V>`,既杀 jscpd clone,又锁单一翻译源。

### §20.3 tool / round-trip polish(2026-06-23)

**交付记录**:

- `update_lowcode_node` 接受 `stateOverrides`,工具边界只允许 `hover|focus|active|disabled` 和 appearance-only 字段(`fills/strokes/cornerRadius/opacity/effects`);`null` 可清空。
- `read_lowcode_node` 返回节点已设置的 `stateOverrides`,保持「未配置字段省略」契约。
- Kiwi 覆盖补齐 `lowcode/stateOverrides` export + `serializeLowcodeFields` round-trip 测试,防止后续 lowcode pluginData 收口时误删交互态样式。

**验证**:

```sh
bun test \
  tests/engine/compiler/state-variants.test.ts \
  tests/engine/tools/lowcode/modify.test.ts \
  tests/engine/tools/lowcode/read.test.ts \
  tests/engine/kiwi/lowcode/export-node.test.ts \
  tests/engine/kiwi/lowcode/plugin-data.test.ts
```

## §21 覆盖层组件(Modal / Dialog / Drawer / Popover / Tooltip)

> 第二波。真应用普遍需要弹窗/抽屉。

**现状(grep 坐实)**:无用户可授权覆盖层(命中仅 preview-bridge overlay + `__opConfirm` 内部 modal)。

**锁定决定 + 交付记录(CODE COMPLETE 2026-06-22)**:

- **授权形态**:不加新 NodeType,不引入 Radix/shadcn runtime 依赖;覆盖层走 FRAME 的 `interactiveProps.overlay` blob。`kind` 支持 `modal | drawer | popover | tooltip`,默认 `modal`;`openRef` 必须指向 boolean docState;`closeOnBackdrop` 默认 `true`。
- **IR/API**:`IRElement.overlay?: IROverlay`。collect 期验证 FRAME + boolean docState,通过后把 `openRef` 加入 docState read;可点击 backdrop 时把 `openRef` 加入 docState write。非 FRAME / unknown docState / 非 boolean docState 分别 warn 并回退普通元素。
- **emit**:overlay panel 仍走原始元素 emitter;外层包 `{openRef && (...)}` + fixed shell + backdrop + panel class。`closeOnBackdrop=true` 时 backdrop 是 button 并 `setDocState(openRef,false)`;`false` 时 backdrop 是 `aria-hidden` div,不导入 setter。runtime-only Tailwind class 由 `OVERLAY_RUNTIME_CLASSES` 注入 safelist,避免动态类被漏扫。
- **验证**:`tests/engine/compiler/overlay.test.ts` 覆盖 modal/drawer、backdrop close 开关、Tailwind safelist、三类 invalid fallback。定向 compiler 相关测试 + tsgo/lint 通过;整 `tests/engine/compiler` 仅 preview HMR 在当前 sandbox 不能 listen `127.0.0.1:0`(EPERM),非本功能回归。
- **边界/延后**:v1 是 headless/plain overlay,无 trigger 语义 UI、无 focus trap/portal/escape key、无 shadcn Dialog/Sheet 结构;触发器可先沿用既有 action 写 boolean docState。后续 §22 Tabs/Accordion 若需要 open/active state,可复用同一 docState 绑定思路。

## §22 更多 shadcn 原语(Tabs / Accordion / Avatar / Badge / Skeleton / Progress / Alert / Separator)

> 第二波。扩 §15 ui-kit 映射表到展示型组件。

**现状**:§15 ui-kit adapter 仅映射 9 个交互组件(Button/Input/Textarea/Label/Select/Checkbox/Switch/RadioGroup + Phase C 在做)。无展示型原语。

**锁定决定 + 交付记录(CODE COMPLETE 2026-06-23)**:

- **首批范围**:只做展示型/低状态原语 `Badge` / `Alert` / `Separator` / `Skeleton` / `Progress` / `Avatar`。`Tabs` / `Accordion` 需要 active/open state 数据模型,延后到复用 §21 docState open-state 的独立片。
- **授权形态**:不加新 NodeType,走任意节点:

  ```ts
  interactiveProps: {
    uiKit: {
      primitive: 'badge' | 'alert' | 'separator' | 'skeleton' | 'progress' | 'avatar'
    }
  }
  ```

  兼容字段 `kind`/`component` 作为 primitive 别名;plain emit 忽略该 hint。

- **IR/API**:`IRElement.displayKind?: "badge" | ... | "avatar"` +
  `display?: { variant?, value?, src?, alt?, fallback? }`。
  collect 期识别未知 primitive 时 warn `ui-kit-primitive-unknown` 并回退普通元素。
- **emit**:shadcn adapter 新增 `mapDisplay` / `emitDisplay`。Badge/Alert/
  Separator/Skeleton 走 tag replacement + children passthrough;Progress emit
  `<Progress value={...}/>`;Avatar emit Avatar/Image/Fallback composition。
- **dependency / files**:按实际使用 inline `badge.tsx` / `alert.tsx` /
  `separator.tsx` / `skeleton.tsx` / `progress.tsx` / `avatar.tsx`;deps 按需加入
  `class-variance-authority` 和 Radix avatar/progress/separator 包。
- **验证**:`tests/engine/compiler/ui-kit/display-primitives.test.ts` 覆盖首批基础映射、Progress value、Avatar image/fallback、uiKit off plain path、unknown primitive warning;并回跑 §15 tags/controls/card UI-kit 测试。
- **边界/延后**:v1 是 headless compiler 能力,无 GUI primitive picker;不做 Tabs/Accordion;不自动根据节点名称/样式推断 primitive;不做 variant 白名单校验(交给生成项目 TS/shadcn 类型约束)。

### §22 v2 Tabs / Accordion(2026-06-23)

**锁定决定 + 交付记录**:

- **范围**:补 `Tabs` / `Accordion` 两个 composed display primitives,继续走 `interactiveProps.uiKit` blob,不新增 NodeType,plain emit 保持普通节点。
- **授权形态**:

  ```ts
  { primitive: "tabs", defaultValue?, items: [{ value, label, content }] }
  ```

  ```ts
  {
    primitive: "accordion",
    defaultValue?,
    type?: "single" | "multiple",
    collapsible?,
    items: [{ value, title | label, content }]
  }
  ```

  `items` 缺失/无有效项时 warn `ui-kit-primitive-items-invalid` 并回退普通元素。

- **IR/API**:`displayKind` 扩到 `tabs|accordion`;`IRDisplayPrimitive` 增加 `items/defaultValue/type/collapsible`。v2 先做静态 items。
- **emit**:shadcn adapter inline `tabs.tsx` / `accordion.tsx`,deps 按需加入 `@radix-ui/react-tabs` / `@radix-ui/react-accordion`;`emitDisplay` 输出 `TabsList/TabsTrigger/TabsContent` 和 `AccordionItem/AccordionTrigger/AccordionContent` 结构。
- **验证**:

  ```sh
  bun test \
    tests/engine/compiler/ui-kit/display-primitives.test.ts \
    tests/engine/compiler/ui-kit/card.test.ts \
    tests/engine/compiler/ui-kit/tags.test.ts \
    tests/engine/compiler/ui-kit/controls.test.ts
  ```

### §22 v3 stateful Tabs / Accordion(2026-06-23)

**锁定决定 + 交付记录**:

- **范围**:给 v2 的 Tabs / Accordion 增加 active/open state 双向绑定;仍走
  `interactiveProps.uiKit` blob,plain emit 保持普通节点。
- **授权形态**:

  ```ts
  {
    primitive: "tabs",
    valueBinding: { kind: "ref", stateId: "s-active-tab" },
    items: [{ value, label, content }]
  }
  ```

  ```ts
  {
    primitive: "accordion",
    type: "multiple",
    valueBinding: { kind: "docState", docStateName: "openSections" },
    items: [{ value, title, content }]
  }
  ```

- **类型约束**:Tabs 和 single Accordion 绑定 `string` state;multiple Accordion 绑定
  `array` state。computed page state 是只读目标,拒绝绑定。坏绑定 warn
  `ui-kit-primitive-binding-*` 并回退非受控 `defaultValue`。
- **emit**:controlled primitive 输出 `value={state}` + `onValueChange` 写回
  page state setter 或 `setDocState`;controlled 时不再 emit `defaultValue`。
- **验证**:

  ```sh
  bun test tests/engine/compiler/ui-kit/display-primitives.test.ts
  ./node_modules/.bin/tsgo --noEmit
  ```

- **真机 ACK 2026-06-23**:`tools/lowcode/src/stateful-primitives-runtime-smoke.ts`
  用 compiler preview server + Chrome 跑真实 shadcn Tabs/Accordion app,覆盖 Tabs
  page-state active 切换、Accordion multiple docState array open/close。该 smoke 抓到
  preview/root 缺 `@radix-ui/react-tabs` / `@radix-ui/react-accordion` 的真实 Vite
  resolve 问题;已把 §22 display primitive 所需 Radix 运行依赖补进 root
  `package.json` / `bun.lock`。

## §23 图标(lucide-react)

> 第二波。shadcn 默认图标库,小而通用。

**现状(grep 坐实)**:无 icon 节点(lucide 仅在 shadcn 内部注释「inline SVG instead of lucide-react」)。

**锁定决定 + 交付记录(CODE COMPLETE 2026-06-22)**:

- **授权形态**:不加新 NodeType,走任意节点 `interactiveProps.icon`。支持字符串 `icon:"camera"` / `icon:"lucide:camera"` / `icon:"Camera"` 或对象 `{ name, size, color, strokeWidth, ariaLabel }`。对象 `label` 兼容为 `ariaLabel`。
- **IR/API**:`IRElement.icon?: IRLucideIcon`。collect 期用本地 `@iconify-json/lucide` 图标清单验证名称,归一化为 lucide-react PascalCase export(如 `camera-off`→`CameraOff`)。unknown / 非 lucide prefix warn `lucide-icon-unknown` 并回退普通元素,避免生成缺失 named import。
- **emit**:page/component module 按实际使用 emit `import { Name } from 'lucide-react'`;元素 emit `<Name className="..." size color strokeWidth ... />`。无 `ariaLabel` 时默认 `aria-hidden="true"`;有 label 时 `role="img" aria-label="..."`。icon 名不进 Tailwind safelist(走 JS import);节点尺寸/颜色布局仍走既有 className + optional props。
- **dependency**:生成项目在实际使用 lucide icon 时加入 `lucide-react:^1.21.0`;compiler 自身声明 `@iconify-json/lucide` 用于编译期校验。
- **验证**:`tests/engine/compiler/lucide-icon.test.ts` 覆盖基础 emit+dependency、`lucide:`/PascalCase 归一化、unknown fallback+warning。
- **边界/延后**:v1 是 compiler/headless 能力,无图标选择 GUI;不导出 Figma vector 图标到 lucide 名(已有 vector SVG fold 继续覆盖 path 图标);不做 icon 动态表达式/按状态换 icon。

## §24 图片与视觉填充(`<img>` 真 src/alt/object-fit + 渐变 + aspect-ratio)

> 第二波。**无图片是真页面硬伤**。

**现状(grep 坐实)**:无 `<img>` emit、无 gradient 填充、无 aspect-ratio/object-fit(全空;effects 阴影已 emit 不在此列)。

**建议方向**:(a)image fill / IMAGE 节点 → `<img src alt>` + `object-cover/contain`;(b)渐变填充(`GRADIENT_LINEAR/RADIAL`)→ `bg-gradient-to-* from-* to-*`(扩 `jsx/tailwind-classes`);(c)`aspectRatio` → `aspect-[w/h]`。**待锁**:image src 来源(Figma imageRef 导出为 asset vs 用户填 URL/绑 §18 上传结果);gradient 多 stop 的 Tailwind 表达上限(arbitrary value 兜底)。

### §24 详细设计 + 锁定决定(2026-06-22,2 fork 经 AskUserQuestion)+ 交付记录

**两 fork 锁定**(全推荐项):① 图片 src 来源 = **用户填 URL / 绑定**(`interactiveProps.image`,src 可字面 URL 或表达式绑 docState[含 §18 上传结果];否决 Figma image-fill 导出 asset —— 要 asset 管道,且不能动态换图);② 范围 = **图片 + 渐变 + aspect-ratio 全做**。**recon 坐实**:无 IMAGE NodeType —— 图片是 **fill**(`Fill.imageHash`+`imageScaleMode`),`SceneGraph.images: Map<hash,Uint8Array>` 持字节;`applyAppearanceStyle`(core tailwind-classes)当前**只 emit SOLID→backgroundColor**(无 gradient/image/aspect);无 `aspectRatio` 字段。**纯 compiler/core emit,零 scene-graph/codec**(image+aspect 走 interactiveProps blob;gradient 读 native Fill 数据,本就 round-trip)。按 §17 节奏拆 2 片串行交付。

**§24.1 图片 + aspect-ratio**(feat `8a145cbb`):节点 `interactiveProps.image={src?,srcExpr?,alt?,objectFit?}` → emit 空 `<img>`(`srcExpr` 表达式[绑 docState/§18 上传结果]优先于字面 `src` URL;`alt`;object-fit→`object-cover/contain/fill/none/scale-down`)。`interactiveProps.aspectRatio`(任意节点)→ `aspect-[w/h]`(校验 "16/9"/"1.5",坏的 warn+drop)。实现:`IRImage{srcLiteral?,srcExpr?,alt}` + `IRElement.image?`;tree.ts `resolveImageNode`(srcExpr 经共享 `resolveReactiveExpr`,坏 expr/缺 src warn+skip)+ `appendAspectRatio` + `buildImageElement`(void 叶,early-return 跳 control/vector/children 路径,events 仍解析支持 onClick);element.ts `formatAttrs` += image → `imageAttrParts`(`src={expr}`/`src="url"` + `alt`)。object-fit/aspect 进 className → collectClassNames 自动 safelist。**2 GATE 收口**:nodeToIR complexity 21→抽 `applyOptionGroupWrapper`;no-nested-ternary→`joinClass` helper。compiler **726/0**(+11 images.test)、kiwi **128/0**(+1 round-trip)。e2e CLI compile 真盘 .fig:字面 URL `<img src="..." object-cover aspect-[16/9]>` + 绑定 `<img src={avatarUrl}>`(useDocState,链 §18)。

**§24.2 渐变填充**(feat `bcd89742`):GRADIENT*LINEAR/RADIAL fill → `bg-[linear-gradient(...)]`/`bg-[radial-gradient(circle,...)]` arbitrary value(core `collectTailwindClasses` 的 `collectGradientClasses`,镜像 clip-path bypass:twirl 表达不了 gradient background → 直接建 CSS 值,空格→`*`,hex 色,linear 角度从 gradientTransform 端点 `atan2(dx,-dy)` 派生)。跳 TEXT(那里 gradient 是文字色)+ ANGULAR/DIAMOND(v1)。**native fill 数据 → 零 scene-graph/codec**;arbitrary value 进 index.css safelist(`@source inline`)。endpoint 数学内联(不 import canvas/,守 arch 边界)。compiler **729/0**(+3 gradient.test)、render/jsx gradient +8(仅既有 §6 frame-nested 出范围 fail)。e2e CLI compile 真盘 .fig:`bg-[linear-gradient(180deg,_#3366F2_0%,_#991ACC_100%)]` + safelisted(gradient native fill 经 exportFigFile→parseFigFile→emit 全链)。

**GATE(两片)**:`bun run check` exit 0;tsgo 0;jscpd 0;零回归。**边界/延后(当时)**:image 只走用户 URL/绑定(Figma image-fill 导出 asset 当时延后,现已由 §24 v2 补齐);单 fill;object-fit 走 className;gradient ANGULAR(conic)/DIAMOND + 多 fill 叠加延后;aspect-ratio 任意节点但 image 容器最常用;无 AI tool/GUI(graph.updateNode+interactiveProps round-trip)。**真机验积压 +1**(浏览器渲图片[含 §18 上传 URL]+ 渐变背景 + aspect-ratio 盒)。**§24 后续**:gradient conic/多 stop 精度。

**§24 v2 Figma image-fill asset 导出**(CODE COMPLETE 2026-06-23):原 §24.1 只做 `interactiveProps.image` 的 URL/绑定 `<img>`;本次补齐原延后的 native Figma `IMAGE` fill 管道。collector 从 `SceneNode.fills` 找第一个可见 `type:'IMAGE'` fill,用 `fill.imageHash` 读取 `SceneGraph.images` bytes,注册到 IR asset(`src/assets/openpencil-image-<hash>.<ext>`;扩展名从 PNG/JPEG/GIF/WebP/SVG 魔数识别),className 追加 `bg-[url(./assets/...)] bg-center` + scale mode 映射:`FILL/CROP→bg-cover bg-no-repeat`,`FIT→bg-contain bg-no-repeat`,`TILE→bg-auto bg-repeat`。adapter 从 IRTree/ComponentDef 汇总 assets 去重写入 `CompilerOutput.files`,Tailwind safelist 继续由 className 自动收集。缺 `imageHash` warn `image-fill-missing-hash`;hash 有但 graph 无 bytes warn `image-fill-missing-asset`;均跳过背景图,保持普通节点输出。单 image fill 保持该紧凑输出;多 fill 叠加由 §24.7 接管。响应式 srcset 由 §24.4 补齐。

**§24.3 image loading attr(CODE COMPLETE 2026-06-23)**:`interactiveProps.image.loading`
接受 `lazy | eager`,emit 到 `<img loading="...">`;非法值静默丢弃,默认不输出
以保持旧产物 byte-stable。验证:`bun test tests/engine/compiler/images.test.ts`。

**§24.4 responsive picture/srcSet(CODE COMPLETE 2026-06-23)**:`interactiveProps.image.sources`
可声明响应式 `<source>` 列表,存在有效 source 时 emit
`<picture><source .../><img .../></picture>`,fallback `<img>` 仍由原 `src`/`srcExpr`
驱动,所以无 sources 的旧产物 byte-stable。每个 source 支持 `src`/`srcSet` 字面值或
`srcExpr`/`srcSetExpr` 绑定表达式,并可带 `media`、`type`、`sizes`;无效 source
被丢弃,坏表达式沿用 `image-source-*` warning,不影响 fallback image。验证:
`bun test tests/engine/compiler/images.test.ts`。

**§24.5 angular gradient → conic-gradient(CODE COMPLETE 2026-06-23)**:native
`GRADIENT_ANGULAR` fill 现在 emit
`bg-[conic-gradient(from_<angle>deg_at_<x>%_<y>%,...)]` arbitrary-value class,
并自动进入 Tailwind safelist。角度从 `gradientTransform` 的 x-axis 推导,center 从
transform 映射的 `(0.5,0.5)` 推导,比默认 conic 更接近 CanvasKit sweep gradient。
仍跳过 TEXT(文字 gradient 不是 background)和 DIAMOND。验证:
`bun test tests/engine/render/jsx/gradient.test.ts`、
`bun test tests/engine/compiler/gradient.test.ts`。

**§24.6 image CROP transform 精度(CODE COMPLETE 2026-06-23)**:native
`IMAGE` fill 的 `imageScaleMode:'CROP'` 现在在 `imageTransform` 为 axis-aligned
(无旋转/斜切、正 scale、有限 translate)时 emit CSS background geometry:
`[background-size:<w>%_<h>%]` + `[background-position:left_<x>%_top_<y>%]` +
`bg-no-repeat`,从而保留导入 Figma crop 的缩放/偏移。旋转/斜切 transform 仍 fallback
到旧 `bg-cover bg-no-repeat`,避免错编。验证:
`bun test tests/engine/compiler/images.test.ts`。

**§24.7 multi fill stacking(CODE COMPLETE 2026-06-23)**:当一个非 TEXT 节点存在多个
可编译视觉 fill(`SOLID`/`IMAGE`/`GRADIENT_LINEAR`/`GRADIENT_RADIAL`/
`GRADIENT_ANGULAR`)时,compiler 不再追加多个会互相覆盖的 `bg-*` utility,而是输出
一组 CSS multi-background arbitrary-property class:
`[background-image:...]`、`[background-size:...]`、`[background-position:...]`、
`[background-repeat:...]`。layer 顺序按 Canvas/Figma 绘制模型反转:fill 数组后面的
层在 CSS 中排前面,保持 topmost-first。`SOLID` 作为
`linear-gradient(color,color)` 层参与叠加;image fill 继续注册 asset,并把
`FILL/FIT/TILE/CROP` 的 size/position/repeat 写入对应逗号列表。单层 image/gradient
保持旧紧凑 `bg-[url]`/`bg-[gradient]` 输出以降低回归面。验证:
`bun test tests/engine/compiler/images.test.ts`。

**§24.8 image runtime smoke + preview asset serving(CODE COMPLETE 2026-06-23)**:
补上低代码 preview dev-server 的运行时 smoke。测试构造一个页面同时包含
responsive `<picture>` image node 和 multi-background image/gradient/solid fill,把
compiler VFS 推给 `createPreviewServer`,再请求 Vite 转换后的 `src/index.css` 和
image asset URL。修复点:`inMemoryVFS.configureServer` 现在会服务 VFS 里的
`Uint8Array` 二进制文件,包括 `/src/assets/...` 以及 CSS `url(./assets/...)`
在根路径下解析出的 `/assets/...`,并返回正确 image content-type。`PreviewServer.close()`
也主动关闭底层 HTTP keep-alive connections,避免 runtime smoke 结束时挂住。验证:
`bun test tests/engine/compiler/preview/image-runtime.test.ts`、
`bun test tests/engine/compiler/preview/hmr.test.ts`。

**§24.9 DIAMOND gradient fallback(CODE COMPLETE 2026-06-23)**:native
`GRADIENT_DIAMOND` fill 现在会 emit 成 radial CSS fallback:
`bg-[radial-gradient(circle_at_<x>%_<y>%,...)]`。CSS 没有 Figma diamond gradient 的
直接等价;本实现选择与现有 Canvas/SVG 路径一致的保守近似(CanvasKit/SVG 侧也把
DIAMOND 走 radial shader/defs fallback),避免 preview/export 直接丢层。center 从
`gradientTransform` 映射的 `(0.5,0.5)` 推导。multi fill stacking 也把 DIAMOND 作为
可编译 background layer 参与 `[background-image:...]` 逗号列表。仍跳过 TEXT。验证:
`bun test tests/engine/render/jsx/gradient.test.ts`、
`bun test tests/engine/compiler/gradient.test.ts`、
`bun test tests/engine/compiler/images.test.ts`。

**§24.10 visual unsupported warnings(CODE COMPLETE 2026-06-23)**:compiler
现在会对尚未可安全 emit 的视觉语义给出显式 warning,避免静默错编或误以为完全支持:
`visual-fill-type-unsupported` 覆盖可见 `PATTERN`/`NOISE`/`VIDEO`/`CUSTOM` fill(跳过该
layer,保留同节点上可表达的 SOLID/IMAGE/GRADIENT layers);
`visual-fill-blend-mode-unsupported` 覆盖 fill-level 非 NORMAL/PASS_THROUGH blend;
`visual-blend-mode-unsupported` 覆盖 node-level blend;
`visual-mask-unsupported` 覆盖 `isMask` 节点。当前策略是 warning+保守降级,不新增
CSS mask/mix-blend-mode emit,因为 Figma mask stack、per-fill blend 与 CSS stacking
context 不是一一等价。验证:`bun test tests/engine/compiler/images.test.ts`。

**新经验**:① 图片在我们模型里是 **fill 非 NodeType** —— 用户 URL 路径走 interactiveProps(零 asset 管道,链 §18),Figma-asset 导出是更重的 v2;② void 叶节点(`<img>`)用 early-return 建专用元素跳 control/vector/children 路径最干净(events 仍解析);③ gradient 等 twirl 表达不了的 CSS 走 arbitrary-value extraClass + 空格→`_`(clip-path 先例),native fill 数据零 codec;④ 跨包纯数学(linearGradientEndpoints)**内联**而非 import canvas/(守 io↛canvas arch 边界 + 不拉 CanvasKit 重依赖);⑤ 加分支撞 complexity/nested-ternary 即抽 helper(applyOptionGroupWrapper / joinClass)。

## §25 外链 `<a href>` + target

> 第二波。小。

**现状(grep 坐实)**:无 `<a href>` emit(只有内部 navigate)。

**锁定决定 + 交付记录(CODE COMPLETE 2026-06-22)**:

- **授权形态**:外链显式走 `interactiveProps.href`/`target`,或嵌套 `interactiveProps.link.{href,hrefExpr,target}`;不做 URL 自动判定,避免把内部路由与外链混淆。`target` 允许 `_self | _blank | _parent | _top`,默认 `_blank`。
- **IR/API**:`IRElement.link?: IRLink`。collect 期一旦解析出 link,元素 tag 从原 tag 改为 `a`;静态 `href` 变 `hrefLiteral`,动态 `hrefExpr` 走已有表达式解析和 docState read 追踪。表达式非法 / 引用未知时 warn 并回退普通元素。
- **emit**:`<a href target>`;`target="_blank"` 自动加 `rel="noopener noreferrer"`,其它 target 不加 rel。链接能力与内部 `navigate` action 完全分离。
- **验证**:`tests/engine/compiler/external-link.test.ts` 覆盖直接 href、嵌套 link、动态 hrefExpr、unknown expr fallback、无 link 保持 div。定向 compiler 相关测试 + tsgo/lint 通过。

## §26 布局原语(sticky / fixed 定位 + overflow scroll + z-index)

> 第二波。吸顶头/侧栏/滚动容器/堆叠层级。

**现状(grep 坐实)**:无 sticky/fixed/overflow-/z-index emit。

**锁定决定 + 交付记录(CODE COMPLETE 2026-06-22)**:

- **授权形态**:首选 `interactiveProps.layout` 子配置;兼容直接放在 `interactiveProps` 的旧形态字段。纯 emit 能力,不改 scene-graph / codec。
- **支持范围**:`position` 仅接受 `sticky | fixed`;offset 支持 `top/right/bottom/left/inset`;overflow 支持 `overflow/overflowX/overflowY = auto | scroll | hidden | visible`;`zIndex` 支持有限 number 或数字字符串。
- **Tailwind emit**:位置/overflow 走普通 utility;offset 数值转 `top-[0px]` 等 arbitrary value,也接受 `px/rem/em/vh/vw/%/cqw/cqh`、`auto/full/px`、fraction token;zIndex 转 `z-[n]`。无效值静默忽略,不污染 className。
- **验证**:`tests/engine/compiler/layout-primitives.test.ts` 覆盖 fixed+offset+zIndex、sticky+overflow、direct legacy keys、invalid drop、`src/index.css` safelist、空配置不 emit。
- **边界/延后**:不改变现有 FREE/ABSOLUTE 几何定位语义;本轮只补运行时布局 utility,更复杂的 responsive/gated 布局状态后续走 §7 variant/override 机制。

## §27 state 持久化(localStorage)+ 派生 / 计算 state

> 第二波。补运行时逻辑短板。

**现状(grep 坐实)**:无 localStorage/persist/computed。

**建议方向**:

- docState 键标 `persist` → emit 初值读 `localStorage` + 变更写回(版本化 key)。
- 派生 state = 一条表达式从其它 state/props 算出(emit `useMemo`)。
- 复用表达式子语言 + read-context 引用追踪。

**待锁**:持久化范围(整 docState vs 标记键);派生 state 的循环依赖检测(collect 期静态拒)。

### §27.1 persisted docState 详细设计 + 锁定决定(2026-06-23,无 AskUserQuestion — prompt.md 锁保守推荐项)

> **目标**:让显式标记的 Document State 在生成应用里跨刷新保存到 `localStorage`,补齐「应用状态会变但刷新即丢」的运行时短板。派生 / 计算 state 不混入本片,单独放 §27.2。

**现状坐实(直接读源)**:

- `StateDef` 同时服务 page state 和 root `lowcodeDocumentState`;docState 经 `collectDocStates` 转成 `IRDocStateDecl` 后由 `buildLowcodeStateRuntime` 生成 `src/_lowcode_state.ts`。
- `_lowcode_state.ts` 目前只有 `initial` 默认值 + zustand store;无 `localStorage` 读写。
- `.fig` lowcode 字段走 `lowcode/documentState` pluginData 整 blob;给 docState entry 加可选字段无需新 pluginData key / kiwi schema。
- `set_doc_states` / `update_lowcode_node.lowcodeDocumentState` 共用 `validateStateDecls`;新增字段必须在工具边界校验,避免 AI 写入坏持久化配置。

**锁定决定**:

1. **持久化范围 = 仅显式标记的 docState**:`DocumentStateDef.persist?: true`
   才持久化。page state 不持久化;`state[]` 里出现持久化字段由工具拒绝。
2. **key 策略 = `openpencil:<packageName>:<stateName>` + 可选 `storageKey` 覆盖**。
   默认 key 绑定生成项目包名和状态名;高级用户可用 `storageKey` 做跨重命名保留。
3. **版本策略 = `storageVersion?: string` 变化时忽略旧值**。runtime 存
   `{ version, value }`;未设置版本时写 `version:null`。读取时版本不等回退默认值。
4. **错误策略 = fail-open 到默认值**。`window` 不存在、JSON parse 失败、
   localStorage security/quota 异常都不阻断应用启动;写入失败静默忽略。
5. **§27.2 computed state 延后**:新增 `computedExpr` / `useMemo` / 循环依赖检测会触碰表达式 read-context 和 setter 语义,独立交付。

**公开 API / Schema 改动**:

- `StateDef` 增加可选字段:`persist?: boolean`, `storageKey?: string`, `storageVersion?: string`。字段共享在类型上存在,但编译器只在 `lowcodeDocumentState` 使用。
- `IRStateDecl` 同步增加这三个可选字段;`collectDocStates` 透传用户 docState 的配置,内置 `$currentUser` 不持久化。
- `set_doc_states` 文案更新为可接收 `{ persist?: true, storageKey?, storageVersion? }`。

**内部实现拆解**:

- `collectDocStates`:输出 `persist/storageKey/storageVersion`;page `collectPageStates` 保持默认值逻辑不变,不会把 page state 持久化到 runtime。
- `buildLowcodeStateRuntime(decls, packageName)`:
  拆 `initialDefaults`;对每个字段生成 `readPersisted(name, default)` 初值;
  生成 `persistConfig` + `persistedNames`;`store.subscribe` 在变更时写 `localStorage`。
- adapter emit:单页 / 多页把 `options.packageName` 传给 runtime builder;没有 docState 时仍不 emit runtime / zustand。
- tools:校验持久化字段类型;`state[]` 带持久化字段拒绝,`lowcodeDocumentState[]` 允许。
- tests:覆盖 runtime 读写代码串、adapter 传包名、tool 接受/拒绝、pluginData blob round-trip。

**成功标准(headless)**:

1. `persist:true` docState → `_lowcode_state.ts` 初值从 `localStorage` 读取,store 变更写回同 key。
2. 未标记 docState → 保持内存态默认值,不进入 `persistConfig`。
3. `storageKey` 覆盖默认 key;`storageVersion` 不匹配时回退默认值。
4. page state 持久化字段由工具拒绝;docState 持久化字段经工具和 `.fig` pluginData 保留。
5. `bun run build:packages`, focused tests, `tsgo --noEmit`, `bun run lint:structure` 通过;完整 `bun run check` 视 keep-out scratch 按 §1.5 处理。

### §27.2 computed page state 详细设计 + 锁定决定(2026-06-23,无 AskUserQuestion — prompt.md 锁保守推荐项)

> **目标**:让 page-scoped state 可以声明只读派生值,由现有表达式子语言从其它 state/docState/路由上下文计算,生成 React `useMemo`。本片不做 document-level computed state,避免把全局 store 生命周期和 page/router 生命周期混在一起。

**锁定决定**:

1. **范围 = page state only**:`StateDef.computedExpr?: string` 只允许出现在 page
   `state[]`;`lowcodeDocumentState[]` 带 `computedExpr` 由工具拒绝。
2. **只读语义**:computed state 不生成 setter。`setState` 或 `bindings.value`
   写入 computed state 时 collect 阶段丢弃并告警。
3. **read-context 复用**:表达式复用现有 `parseExpression` + read-context 引用校验。
   可读 page state、docState、`$params`、`$query`;拒绝 `$prev`、未知 identifier。
4. **循环依赖 = collect 期静态降级**:computed↔computed 循环会标记循环成员为 `computedInvalid`,emit 为默认值常量并告警,而不是生成运行时递归或抛错。未知引用 / parse error 同样降级为默认值常量。
5. **声明顺序 = writable state/doc/router before computed**:
   page scaffold 先声明 `useDocState`、`$params/$query`,再声明 page state;
   state emit 内部把 writable state 放前面,computed state 按依赖拓扑排序。

**公开 API / Schema 改动**:

- `StateDef` 增加 `computedExpr?: string`。字段存在于共享类型上,但工具边界只允许 page `state[]` 使用。
- `IRStateDecl` 增加 `computed?: { ast, references }` 和 `computedInvalid?: true`;adapter 根据这两个字段选择 `useMemo`、默认值常量、或普通 `useState`。

**内部实现拆解**:

- `collectPageStates`:保留合法 state 声明与原始 `computedExpr`。
- `resolveComputedStates`:在 docState 已收集后解析 computed 表达式,注册 docState/route/query reads,检测 unknown / `$prev` / 循环,并输出可 emit 的拓扑顺序。
- `emitStateDecl`:普通 state → `useState(default)`;有效 computed → `useMemo(() => expr, deps)`;无效 computed → `const name = default`。
- `buildReactImport` / page scaffold:仅有 computed state 时只导入 `useMemo`;混合 state 时导入 `useState, useMemo`;hook 声明顺序调整为 docState/router before state。
- `resolveSetState` / `resolveValueBinding`:computed state 统一视作 read-only target,写入路径丢弃并告警。
- tools:`update_lowcode_node.state[]` 允许并校验非空合法 `computedExpr`;`lowcodeDocumentState` / `set_doc_states` 明确拒绝。

**成功标准(headless)**:

1. `computedExpr: "count + tax"` → emitted TSX 含 `const total = useMemo(() => count + tax, [count, tax])`。
2. computed 可读 docState、`$params`、`$query`;对应 hook 声明出现在 computed `useMemo` 之前。
3. computed target 被 `setState` 或 controlled `bindings.value` 写入时 collect 告警并丢弃写入 wiring。
4. 循环 / 未知引用 / parse error 不生成坏代码,而是默认值常量 + warning。
5. focused compiler/tool tests、`bun run build:packages`, `tsgo --noEmit`, `bun run lint:structure` 通过;完整 `bun run check` 视 keep-out scratch 按 §1.5 处理。

### §27.3 polish / round-trip 收尾(2026-06-23)

> **目标**:把 §27.1/§27.2 从「能 emit」收尾到「schema/codec/IR 行为被钉住」,避免后续低代码字段扩展时误删 state 元数据。

**交付记录**:

- **Kiwi / `.fig` pluginData 覆盖**:`computedExpr` 继续走现有 `lowcode/state` JSON blob;不新增 kiwi schema key。测试固定 page computed state export 到 `NodeChange.pluginData`、`serializeLowcodeFields` JSON round-trip。
- **IR collect 覆盖**:新增不依赖 React adapter 的 collect 测试,直接断言 computed state 的拓扑顺序、docState read 注册、`$query` 标记、循环/unknown warning 和 `computedInvalid` fallback。
- **任务入口更新**:`prompt.md` 同步标记 §27.1/§27.2/§27.3 已完成,下一轮默认顺序改为 §20 → §24 → §22。

**验证**:

```sh
bun test \
  tests/engine/compiler/ir/collect/state.test.ts \
  tests/engine/kiwi/lowcode/export-node.test.ts \
  tests/engine/kiwi/lowcode/plugin-data.test.ts
```

§27.1/§27.2 聚焦测试与 full `bun run check` 已在同轮验证;§27.3 只补 coverage / docs / prompt。

## §28 用户事件覆盖收尾(onChange / onFocus / onBlur 端到端 + `$event`/`$value` 复活)

> 第二波。接通已有但未走通的事件 + 复活 memory 里 shelved 的 token。

**现状(grep 坐实)**:`EventName` 联合已含 `onClick|onChange|onSubmit|onFocus|onBlur`,但 events→handler emit 路径**只接 onClick/onSubmit**;`element.ts` 的 onChange **只被 controlled binding 占用**,用户在 events 里授权的 onChange/onFocus/onBlur **不 emit**。memory 记 `$event`/`$value` token 因「onChange 无授权入口、无 live 用例」**SHELVED**(token 本身已能 parse,IDENT_RE 含 `$`)。

**锁定决定 + 交付记录(CODE COMPLETE 2026-06-22)**:

- **事件 emit**:events→handler 端到端接通 `onChange/onFocus/onBlur`,保留既有 `onClick/onSubmit` 行为;无事件局部变量的单 action handler 仍保持旧的 braceless emit 形态,降低快照漂移。
- **事件局部变量**:`onChange/onFocus/onBlur` handler 内注入 `$event` 和 `$value`。`$event = e`;`$value = (e.target as HTMLInputElement).value`。collect 期只在这三个事件的 read-context 放行 `$event/$value`;例如 onClick 里用 `$value` 仍报 unknown identifier 并丢 handler。
- **受控 onChange 合成策略**:controlled input 的 synthesized writer 先执行,用户授权的 `events.onChange` 后执行,合成同一个 `onChange={(e) => { ... }}`;因此 `$value` 可用于 writer 后的自定义动作。
- **校验 onBlur 合成策略**:带 validation 的字段先执行 `__validateField(...)`,再执行用户授权 `events.onBlur`;旧 `validation-onblur-conflict` warning 移除。
- **工具说明**:`update_lowcode_node` 文案同步说明 `$event/$value` 作用域、controlled onChange 组合行为,避免继续暗示用户 handler 会被丢。
- **验证**:`tests/engine/compiler/event-runtime.test.ts` 覆盖 focus/blur 局部变量、controlled onChange writer-first+user-chain、onClick 拒绝 `$value`;既有 controlled/form-validation/cross-walker 测试更新为新语义。
- **边界/延后**:本轮复活 HTML 事件局部值;复杂 UI-kit 组合控件的非 input target 归一化值仍可在 §22/§27 之后按组件语义细化。

## §9 i18n RTL 逻辑属性(v15)

**现状**:§9 i18n 链 v1–v14 已交付(react-intl runtime / locale 切换 / 属性串 / ICU 插值 / plural-select / 译文 catalog / **v11 RTL dir-flip** `document.dir` 翻转 / v13 CLI flags / v14 缺译警告)。

**剩余(v15)**:**RTL 逻辑属性** —— `margin`/`padding` 物理方向(`ml-`/`mr-`/`pl-`/`pr-`)→ `ms-`/`me-`/`ps-`/`pe-` 逻辑属性,让 RTL locale 自动镜像间距(v11 只翻 `dir`,间距仍物理方向 → RTL 下左右间距不镜像)。改 core `collectTailwindClasses`。

**⚠ 回归面大**:大量既有测试断言具体 class(`ml-`/`mr-`)→ 改成逻辑属性后期望全变。**强烈建议 gated**(RTL locale / ui-kit 条件触发,而非全局改 default emit),否则非-RTL 产物 class 全漂移 + 大批测试要改。**待锁**:全局默认改 vs gated(建议 gated);逻辑属性覆盖范围(仅 margin/padding 还是含 inset/border)。

**§9 v15 gated RTL logical padding**(CODE COMPLETE 2026-06-23):按建议走 gated,新增 `CompilerOptions.rtlLogicalProperties?: boolean`,默认 `false` 保持旧物理 `pl-*`/`pr-*` 输出不漂移;显式开启时 compiler 把 style option 传入 component registry / page tree / component body / instance override className 计算。core JSX Tailwind emitter 新增可选 `TailwindClassOptions.logicalProperties`;仅 auto-layout padding 走 logical emit:对称 padding 仍 `p-*`/`px-*`/`py-*`,非对称左右改 `ps-*`/`pe-*`(上下仍 `pt-*`/`pb-*`)。当前只覆盖 padding(本仓尚无 margin SceneNode 字段 emit);inset/border 延后。新增 `tests/engine/compiler/rtl-logical.test.ts` 锁默认物理 + gated logical 两路。

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

**交付记录(CODE COMPLETE 2026-06-23)**:

- `WorkflowDef.pageId?` 增加可选页面作用域,用于 authoring / tool validation
  的 page-local state 解析;未设置时继续回退当前页,保持旧文件兼容。
- `set_workflows` / `read_workflows` 保留并说明 `pageId`;工具边界拒绝空或不存在的
  `pageId`,`.fig` 仍走 `lowcode/workflows` 轻 guard,无需新 pluginData key。
- `WorkflowsPanel` 新建 workflow 时记录当前页 `pageId`;`WorkflowRow` 暴露页面作用域
  下拉,并按该页把 `pageStates` 传给递归 `ActionList`,不再用全局当前页近似。
- **边界**:运行时仍 inline 到 call site;跨页局部 state 写入没有共享生命周期,应建模为
  docState。此轮修 authoring 精确度,不生成跨页面局部 state runtime。

**验证**:`bun test tests/engine/tools/lowcode/workflow-action.test.ts`;
`bun run check:vue`;`tsgo --noEmit`;`bun run lint:structure`;`git diff --check`。

## §6 lowcode 字段升格 Kiwi schema(工程债,继续推迟)

**现状**:全部 lowcode 字段经 pluginData 旁路通道(`lowcode/*`,含 §7 `responsiveOverrides`)round-trip,稳定运行,kiwi 119/0。

**评估**:升格成本高(fork vendored `kiwi-schema/` + 通道重写 + 老 .fig 迁移工具),产品层面零新功能解锁。**继续推迟**(phase-3 §1.1 候选 5 的 carry-over),除非协作/AI 流程对 schema 一等字段位有刚需。本节仅占位,不主动开工。
