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
| 1 | **§15 FRAME→Card 容器映射** | headless emit | **高(最快起点)** | 容器型 FRAME(有 padding/背景/圆角)→ shadcn `Card`/`CardHeader`/`CardContent`,而非裸 `<div>` | phase-3 §15 设计标为「Phase B 可选」**但未实现**;本 phase 实现 | §15 |
| 2 | **§16 动态路由 / 路由参数 / 路由守卫** ⭐ | headless emit(中-大)| **高(最高产品价值)** | router 现仅字面跳(`navigate("/about")`);加 `/product/:id` 动态段 + `useParams` 绑定 + query string + navigate 带参 + auth-guarded 路由 | **react-router 多页已在**(Phase 1/2);动态段/参数/守卫是新增,**做不了详情页/仪表盘的最大缺口** | §16 |
| 3 | **§15 Phase C array checkbox-group** | headless emit | 高 | array 类型字段(多选)→ shadcn checkbox-group 排版(复用 §3.v5 RADIO/CHECKBOX inline 排版)| phase-3 §15 Phase A/B 后的下一档,未起头 | §15 |
| 4 | **§17 列表绑真实数据源 + 分页/排序/筛选** | headless emit(中)| 中-高 | repeater 直接绑 Supabase query 结果(Bubble repeating-group)+ 分页/排序/筛选 UI | LIST 现仅绑 state 本地 array(Phase 0 #7);扩到 query + 分页是新增,**当前要 supabaseQuery→setState→LIST 间接绕且无分页** | §17 |
| 5 | **§19 表单校验** | headless emit(中)| 中 | input 节点 required/pattern/min-max/自定义规则 + 错误提示 + 提交拦截 | FORM 节点在但**无校验**;复用 §3.v6 InteractiveProps 框架 | §19 |
| 6 | **§18 文件 / 图片上传(Supabase Storage)** | headless emit(中,动 scene-graph)| 中 | 上传控件 + Supabase Storage `upload` + `getPublicUrl` + 进度/预览 | **app 级上传零实现**(代码只有 deploy 的 upload);可能加 node type / interactiveProp | §18 |
| 7 | **§9 v15 RTL 逻辑属性(ms-/me-)** | headless emit(有回归面)| 中 | margin/padding 物理方向 → `ms-`/`me-`/`ps-`/`pe-` 逻辑属性,RTL locale 自动镜像 | **§9 v11 已做 dir-flip**;v15 是逻辑属性镜像,是 v11 之上**新增**(非重复)| §9 |
| 8 | **§14 跨文件组件库 / 团队库** | headless(大)| 中 | 组件跨 .fig 文件复用 / 团队共享库 / 更新传播(Figma Team Library 语义)| **phase-3 §14 已有完整设计但标〔未实现〕**;本 phase 才实现 | §14 |
| 9 | **更多 deploy providers(Cloudflare Pages 等)** | headless | 中 | Netlify/Vercel 已完整;CF Pages 直传需 **blake3**(Web Crypto 只有 SHA-\*)→ 违零依赖,**开工前必须 AskUserQuestion** | phase-3 §10 v7/v8/§7 v2 多次因 blake3 否决 CF Pages,留到本 phase 决策 | §5 |
| 10 | **编辑器实时 preview i18n / ui-kit toggle** | 真机 GUI | 高(真机)| `src/app/lowcode/preview-pane/use-compile-on-change.ts` 硬编码 `withDefaults`(无 i18n/uiKit)→ app 内 preview 看不到 i18n/shadcn。加 toggle | phase-3 §9 v13(CLI flags)修了 CLI 入口,**编辑器 preview 入口仍缺**;§15 Phase A 注明 preview 不带 uiKit | §9 / §15 |
| 11 | **§7 / §8 / §10 编辑器授权面板(GUI)** | 真机 GUI | 中(真机)| §7 responsive overrides 编辑面板;§8 component-props 面板;§10 optionalParams GUI(当前 MCP-only)| 三条线在 phase-3 **均显式「GUI 延后」**(沿用「先 emit/headless,GUI 真机」先例)| §7 / §8 / §10 |
| 12 | **§10 工作流体跨页 pageStates 精确** | headless | 低 | 工作流体当前取**当前页** pageStates 近似;跨页 callWorkflow 时应按目标页解析 | phase-3 §10 v11 已闭合 GUI 链,此为已知小缺口 | §10 |
| 13 | **lowcode 字段升格 Kiwi schema** | 工程债 | 低 | pluginData 旁路通道稳定;升格成本高(fork vendored `kiwi-schema/` + 通道重写 + 老 .fig 迁移),收益仅清债 | phase-3 §1.1 候选 5 / §6 的纯 **carry-over**(继续推迟)| §6 |

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

> 2026-06-20 第二轮缺口盘点。**全部 grep 坐实代码无实现**,且都是**纯 emit / 复用现有机制**的小-中增量(无架构改动),用来把产物从「能跑的页面」打磨成「真应用」。优先级整体在第一波(§16–§19 数据/表单链)之后,但单条工作量小、可穿插。**避坑(经验 Q):effects 阴影已 emit(`jsx/helpers.ts formatShadow`)、EventName 联合已含 5 事件、navigate 已在,均不重列。**

| # | feature | 复用 | 简述 | grep 坐实 |
|---|---|---|---|---|
| §20 | **交互状态样式(hover/focus/active/disabled variants)** | §7 variant-emit 机制 | 节点可声明 `hover:`/`focus:`/`active:`/`disabled:` Tailwind 变体样式(悬停变色/按下/禁用态)| 用户节点无状态变体 emit(命中全是 shadcn 模板内部 hover:)|
| §21 | **覆盖层组件(Modal/Dialog/Drawer/Popover/Tooltip)** | shadcn Dialog/Sheet/Popover 模板 + docState open-state | 可授权弹窗/抽屉/气泡,open 态绑 docState,触发器 action 开关 | 无用户可授权覆盖层(命中仅 preview-bridge overlay + `__opConfirm` 内部 modal)|
| §22 | **更多 shadcn 原语(Tabs/Accordion/Avatar/Badge/Skeleton/Progress/Alert/Separator)** | §15 ui-kit adapter | 扩 §15 映射表到展示型组件 | §15 仅到 9 个交互组件 |
| §23 | **图标(lucide-react)** | §15 ui-kit / 新 icon 节点或 prop | 放置 lucide 图标(shadcn 默认图标库),名称/尺寸/色可配 | 无 icon 节点(lucide 仅在 shadcn 内部注释)|
| §24 | **图片与视觉填充(`<img>` 真 src/alt/object-fit + 渐变 + aspect-ratio)** | jsx tailwind-classes | image fill / IMAGE 节点 → `<img src alt>` + object-cover/contain;渐变填充 → `bg-gradient-*`;宽高比 | 无 `<img>` emit、无 gradient、无 aspect/object-fit(全空)|
| §25 | **外链 `<a href>` + target** | emit/element | 外部链接节点 → `<a href target=_blank rel>`(区别于内部 navigate)| 无 `<a href>` emit |
| §26 | **布局原语(sticky/fixed 定位 + overflow scroll + z-index)** | jsx tailwind-classes | 吸顶头/侧栏、滚动容器、堆叠层级 | 无 sticky/overflow-/z-index emit |
| §27 | **state 持久化(localStorage)+ 派生/计算 state** | docState + 表达式子语言 | docState 标记持久化→`localStorage` 读写;派生 state = 表达式从其它 state 算出(memo)| 无 localStorage/persist/computed |
| §28 | **用户事件覆盖收尾(onChange/onFocus/onBlur 端到端 + `$event`/`$value` 复活)** | EventName 联合(已有 5)+ events emit | `EventName` 已含 onChange/onSubmit/onFocus/onBlur,但 emit 只接 onClick/onSubmit;onChange 当前**只被 controlled binding 占用**,用户授权的 onChange/onFocus/onBlur 未接 → 接通 + 复活 memory 里 shelved 的 `$event`/`$value` token(已能 parse,缺 live 用例)| `element.ts` onChange 仅 controlled,events→handler 路径无 onChange/onFocus/onBlur |

> **第二波优先级建议**:**§20 交互状态样式**最值得先做(复用 §7 的 variant-emit 机制、零新概念、立刻让产物有交互质感);**§24 图片/填充** + **§25 外链** 是「真页面」基础缺(无图片是硬伤);**§21 覆盖层** + **§22 更多原语** 把 UI 表达力补齐;**§27 持久化/派生 state** + **§28 事件收尾** 补运行时逻辑短板(§28 顺带解 memory 里 shelved 的 `$event`/`$value`)。这些都可穿插在第一波 §16–§19 之间做(单条小)。

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
| **R. Phase 4 §16.1/§15.1 新增(4 条)** | ① **跨 N 个 register-chokepoint 跟踪一个新内置只读标识符**:sentinel-ride 既有已穿线的 Set + collect 末 `Set.delete` 抽布尔,比新建并行 set 穿 N 点更省、穷举-by-construction(§16.1 `$params` rode docStateReads)。② **UI-kit 容器型映射用 `mapContainer`(只换 tag、保留子)而非 `mapControl`(独占 markup、跳子)**;二者都靠 collect 期 kit-agnostic IR-hint(containerKind/controlKind),plain emit 忽略 → byte-identical-off(§15.1)。③ **`check:vue` 是真第 4 道闸**:tsgo 不覆盖 `.vue`,新增 IRTree/SceneNode 必填字段时 `.vue` 里的 stub 字面量只有 vue-tsc 抓得到 → 加必填字段后 grep 全仓字面量构造点(含 `.vue`)。④ **同前缀兄弟测试 ≥3 触发 steiger `prefer-domain-folders`** → 新增第 3 个时直接建子目录(§8 v4/§9/§15.1 印证)。 |

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
1. **〔Fork 1 锁定〕options 来源 = 仅静态 `interactiveProps.options[]`**(本次)。**动态 options 绑定(options 来自 state/query array)归 §17 数据链首片**(独立设计,含 `{value,label}` 对象选项决策)—— recon 坐实它是中等量级(scene-graph `optionsSourceRef` + 新 IR `.map()` 形态 + plain&shadcn 双 emit + round-trip),与 §17 列表绑数据源重叠。用户先选「动态」,经定序问题后改选「先静态、动态归 §17(推荐)」。
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
- **边界(已文档化)**:仅静态 `options[]`(动态 options 绑数据源 → §17 首片);多选 array 语义(单选 = RADIO);wrapper 保 plain `<div>`(shadcn 无原生 CheckboxGroup);复用 Phase B 的 Checkbox.tsx/dep(无新增);`{value,label}` 对象选项延后(同 static options 的 `string[]` 假设)。
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

## §17 列表绑真实数据源 + 分页 / 排序 / 筛选

> 2026-06-20 产品缺口盘点新增。Bubble「repeating group」核心。

**现状(grep 坐实)**:`IRList`(ir/types.ts:256,Phase 2 §9)只对「array-typed **state** datasource」emit `.map()`。绑真实数据源要 `supabaseQuery action → setState(array) → LIST`(Phase 3 §2),**间接绕且无分页/排序/筛选**。

**剩余 / 建议方向**:
- **repeater 直接声明数据源 = Supabase query**(表/select/where/order/limit),编译期 emit 拉取 + `.map()`,免手搭 supabaseQuery→setState 链。
- **分页**:offset/cursor 分页 + 上一页/下一页 / 加载更多控件。
- **排序 / 筛选 UI**:绑控件值 → query order/where(复用 §3.v4 controlled bindings)。

**类型**:headless emit;与 §2 Supabase + §16 路由参数(详情页 `/product/:id` 从列表点入)天然成链。**待锁**:数据源声明位置(LIST 节点新字段 vs 复用 supabaseQuery 配置);分页模型(offset vs cursor);客户端筛选 vs 服务端 query。

## §18 文件 / 图片上传(Supabase Storage)

> 2026-06-20 产品缺口盘点新增。头像/附件/封面近乎通用需求。

**现状(grep 坐实)**:**app 级上传零实现**(代码里 `upload` 只在 deploy 路径)。

**剩余 / 建议方向**:上传控件(新 NodeType 或 INPUT `type=file` interactiveProp)→ emit Supabase Storage `.from(bucket).upload()` + `getPublicUrl()` + 上传进度 / 预览;上传结果 URL 进 docState/binding(供后续表单提交/展示)。

**类型**:headless emit + **可能动 scene-graph**(新交互节点或 interactiveProp)→ 比纯 emit 候选更 invasive,经验 A/G(union widening)必走。**待锁**:用新 NodeType 还是 INPUT type=file prop;bucket / 路径约定;public vs signed URL。

## §19 表单校验

> 2026-06-20 产品缺口盘点新增。

**现状(grep 坐实)**:FORM 节点在,但 input 节点**无 required/pattern/min-max/自定义校验 + 错误提示 + 提交拦截**(代码里 validation 全是编译器内部校验,非用户表单校验)。

**剩余 / 建议方向**:input 节点 interactiveProps 加校验规则(required/pattern/minLength/maxLength/min/max/自定义表达式)→ emit 客户端校验 + 错误消息显示 + FORM submit 时拦截非法 + 可绑 `:invalid` 状态。**复用 §3.v6 InteractiveProps 通用编辑器框架** + §4 表达式子语言(自定义规则)。

**类型**:headless emit;无 scene-graph 改动(走 interactiveProps,schema-native pluginData)。**待锁**:校验规则数据形态(每 input 一组规则);错误显示位置(节点下方 vs FORM 级汇总);校验时机(onBlur/onChange/onSubmit)。

---

## §20 交互状态样式(hover / focus / active / disabled variants)

> 第二波。**最值得先做**(复用 §7 variant-emit,零新概念,立刻给产物交互质感)。

**现状(grep 坐实)**:用户节点无状态变体样式 —— `hover:` 命中全是 shadcn 模板内部,无用户可授权的 hover/focus/active 样式。

**建议方向**:节点可声明各状态(hover/focus/active/disabled)的样式覆盖(同 §7 responsiveOverrides 的 `Partial<Pick<SceneNode, 样式键>>` 形态),emit 走 §7 的 **style-level diff + 前缀**机制(`hover:bg-...`/`focus:ring-...`),复用 `LAYOUT_STYLE_RESET` 思路。round-trip 走 `lowcode/stateOverrides` 通道(类比 responsiveOverrides)。**待锁**:状态集合(是否含 group-hover / focus-within);与 §7 断点的组合(`md:hover:`)。

## §21 覆盖层组件(Modal / Dialog / Drawer / Popover / Tooltip)

> 第二波。真应用普遍需要弹窗/抽屉。

**现状(grep 坐实)**:无用户可授权覆盖层(命中仅 preview-bridge overlay + `__opConfirm` 内部 modal)。

**建议方向**:覆盖层容器节点(新 NodeType 或 FRAME 标记)+ open 态绑 docState(布尔)+ 触发器 action 开/关;emit 复用 **shadcn Dialog/Sheet/Popover/Tooltip 模板**(uiKit off 时退化为自绘 portal + 遮罩)。**待锁**:用新 NodeType 还是 FRAME `overlayKind` 标记;open 态数据归属(docState key);非-shadcn 退化策略。**经验 A/G**(union widening)+ **经验 D**(radix dep 进 compiler deps)。

## §22 更多 shadcn 原语(Tabs / Accordion / Avatar / Badge / Skeleton / Progress / Alert / Separator)

> 第二波。扩 §15 ui-kit 映射表到展示型组件。

**现状**:§15 ui-kit adapter 仅映射 9 个交互组件(Button/Input/Textarea/Label/Select/Checkbox/Switch/RadioGroup + Phase C 在做)。无展示型原语。

**建议方向**:adapter 映射表加展示组件;部分需 open/active 态(Tabs/Accordion → 复用 §21 的 docState open-state 机制)。**待锁**:哪些进首批;Tabs/Accordion 的 active 态数据模型(可与 §21 共用)。

## §23 图标(lucide-react)

> 第二波。shadcn 默认图标库,小而通用。

**现状(grep 坐实)**:无 icon 节点(lucide 仅在 shadcn 内部注释「inline SVG instead of lucide-react」)。

**建议方向**:icon 节点(或 interactiveProp)→ emit `import { Name } from 'lucide-react'` + `<Name size color />`;icon 名进 Tailwind safelist 无关(走 import)。**经验 D**(lucide-react 进 compiler deps)。**待锁**:用新 NodeType 还是给 FRAME/INSTANCE 标 icon prop;图标选择 UI(GUI 延后真机)。

## §24 图片与视觉填充(`<img>` 真 src/alt/object-fit + 渐变 + aspect-ratio)

> 第二波。**无图片是真页面硬伤**。

**现状(grep 坐实)**:无 `<img>` emit、无 gradient 填充、无 aspect-ratio/object-fit(全空;effects 阴影已 emit 不在此列)。

**建议方向**:(a)image fill / IMAGE 节点 → `<img src alt>` + `object-cover/contain`;(b)渐变填充(`GRADIENT_LINEAR/RADIAL`)→ `bg-gradient-to-* from-* to-*`(扩 `jsx/tailwind-classes`);(c)`aspectRatio` → `aspect-[w/h]`。**待锁**:image src 来源(Figma imageRef 导出为 asset vs 用户填 URL/绑 §18 上传结果);gradient 多 stop 的 Tailwind 表达上限(arbitrary value 兜底)。

## §25 外链 `<a href>` + target

> 第二波。小。

**现状(grep 坐实)**:无 `<a href>` emit(只有内部 navigate)。

**建议方向**:节点标外链(interactiveProp `href` + `target`)→ emit `<a href target=_blank rel=noopener>`;区别于内部 `navigate`(§16)。**待锁**:外链 vs navigate 的授权区分(URL 是否 http(s) 自动判定)。

## §26 布局原语(sticky / fixed 定位 + overflow scroll + z-index)

> 第二波。吸顶头/侧栏/滚动容器/堆叠层级。

**现状(grep 坐实)**:无 sticky/fixed/overflow-/z-index emit。

**建议方向**:节点布局属性加 `position: sticky/fixed`(+ offset)、`overflow: auto/scroll/hidden`、`zIndex` → 对应 Tailwind class(`sticky top-0`/`overflow-auto`/`z-10`)。扩 `jsx/tailwind-classes`。**待锁**:与现有 FREE/ABSOLUTE 定位(§6)的关系;sticky offset 来源。

## §27 state 持久化(localStorage)+ 派生 / 计算 state

> 第二波。补运行时逻辑短板。

**现状(grep 坐实)**:无 localStorage/persist/computed。

**建议方向**:(a)docState 键标 `persist` → emit 初值读 `localStorage` + 变更写回(版本化 key);(b)派生 state = 一条表达式从其它 state/props 算出(emit `useMemo`),复用表达式子语言 + read-context 引用追踪。**待锁**:持久化范围(整 docState vs 标记键);派生 state 的循环依赖检测(collect 期静态拒)。

## §28 用户事件覆盖收尾(onChange / onFocus / onBlur 端到端 + `$event`/`$value` 复活)

> 第二波。接通已有但未走通的事件 + 复活 memory 里 shelved 的 token。

**现状(grep 坐实)**:`EventName` 联合已含 `onClick|onChange|onSubmit|onFocus|onBlur`,但 events→handler emit 路径**只接 onClick/onSubmit**;`element.ts` 的 onChange **只被 controlled binding 占用**,用户在 events 里授权的 onChange/onFocus/onBlur **不 emit**。memory 记 `$event`/`$value` token 因「onChange 无授权入口、无 live 用例」**SHELVED**(token 本身已能 parse,IDENT_RE 含 `$`)。

**建议方向**:把 events→handler emit 扩到 onChange/onFocus/onBlur(与 controlled binding 的 onChange 共存:controlled 先跑、再调用户 handler,或合成一个 onChange);**复活 `$event`/`$value`** 作为这些 handler 体内可读的 read-context token(`$value` = 当前控件值)→ 给 §3.x controlled binding 之外的「自定义 onChange 逻辑」一个真入口。**待锁**:controlled onChange 与用户 onChange 的合并策略;`$value` 的类型/来源(`e.target.value`)。**经验 A**(emit/collect/tool/check:vue 四穷举点 + event-name walker)。

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
