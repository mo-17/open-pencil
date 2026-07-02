# Phase 5 — Lowcode Platform Productization

> 紧接 `docs/lowcode-phase-4.md`。Phase 4 已在 2026-06-25 收尾:
> #1–#12 均已完成,#13 Kiwi schema 升格明确 Deferred 到 Phase 5+ 工程债。
>
> **本 doc 的作用**:把 lowcode 从「功能链路已打通」推进到「真实应用发布 /
> 运营 / 商业化」阶段。这里先列候选、优先级、依赖和成功标准;开工前仍需用户
> 选定单条候选,再把对应小节扩写成详细设计。

---

## 0. Phase 4 Closeout Baseline

Phase 4 结束时已经具备:

- 数据 / 后端:Supabase auth、query、mutation、storage upload、RLS advisor。
- 交互 / 状态:docState、pageState、bindings、events、workflows、validation、
  remote validators、optional workflow params、page-scoped workflow state。
- 组件 / UI emit:responsive overrides、component props、component set variants、
  shadcn/ui adapter、overlays、Tabs/Accordion/Avatar/Badge/Skeleton/Progress/Alert、
  icons、image fills、gradients、sticky/fixed/overflow/z-index。
- i18n / preview:i18n runtime、RTL、CLI flags、preview i18n toggle、preview
  UI-kit toggle,真实 Tauri GUI ACK 已过。
- 发布:Netlify、Vercel、Cloudflare Pages Direct Upload provider;Cloudflare 真
  token live ACK 需真实凭据另跑。
- AI / MCP / CLI:lowcode ToolDefs、CLI build/deploy、MCP/Tauri GUI automation
  bridge。
- 持久化格式:lowcode 字段仍走 `lowcode/*` pluginData 旁路,稳定 round-trip。

**Phase 5 的默认前提**:不重做 Phase 0–4 已交付能力;除非明确进入 §9 Kiwi
schema 债务,否则继续保持 pluginData 旁路。

---

## 1. 范围

### 1.1 Phase 5 In-Scope Candidates

| #   | 主题                                                  | 优先级 | 类型     | 简述                                                                                         | 详写 |
| --- | ----------------------------------------------------- | ------ | -------- | -------------------------------------------------------------------------------------------- | ---- |
| 1   | **应用发布生命周期:preview / staging / production / rollback** | 高     | 产品闭环 | 在现有 deploy provider 之上建立 app version、environment、publish/rollback 语义。            | §2   |
| 2   | **轻量 SEO / metadata emit**                          | 高     | 小闭环   | per-page title/description/OG/static meta 注入;不做 SSG。                                     | §3   |
| 3   | **低代码能力文档 / release notes / onboarding**        | 高     | 发现性   | 把 Supabase/workflow/i18n/shadcn/deploy 等能力整理成用户入口和示例。                          | §4   |
| 4   | **全局主题 / design tokens / dark mode emit**          | 中     | 产品力   | 从 Figma variables / app theme 映射 CSS variables,支持 light/dark/theme switch。              | §5   |
| 5   | **Preview 圆角裁剪继承排查**                         | 高     | 质量修复 | 低代码展示画板中父元素圆角疑似没有正确裁剪/覆盖子元素圆角,需排查 compiler/runtime emit。      | §6   |
| 6   | **代码面板选中组件无代码排查**                       | 高     | 质量修复 | 选中 Button 等组件时代码面板疑似未展示对应代码,需排查 selection → codegen preview 链路。       | §7   |
| 7   | **Inspector / Design Panel 折叠信息架构**              | 高     | UX       | 右侧设计面板参数过多,用可记忆折叠分组、搜索和上下文显隐降低认知负担。                        | §8   |
| 8   | **Kiwi schema 升格设计文档**                          | 低     | 工程债   | 先设计,不直接改 codec;评估迁移/兼容/协作收益。                                                | §9   |
| 9   | **Analytics / tracking 集成**                         | 中     | 运营     | GA / Plausible / PostHog script injection + event tracking hooks。                            | §10  |
| 10  | **Custom code escape hatch**                          | 中     | 高级用户 | head/custom CSS/custom JS snippets;需要安全边界和 deploy 兼容。                               | §11  |
| 11  | **Stripe / paid app primitives**                      | 中     | 商业化   | Stripe checkout / webhook / Supabase Edge Function 模式;跨静态 SPA 边界。                     | §12  |
| 12  | **可视化 Workflow DAG editor**                        | 低     | 大重构   | 当前 ActionDef 链已够用;DAG 是 authoring 体验升级,不是 runtime 必需。                         | §13  |
| 13  | **Mobile/native export strategy**                     | 低     | 平台扩展 | React Native / Capacitor / Tauri Mobile 路线评估;不与 React web adapter 混改。                | §14  |
| 14  | **Plugin / marketplace architecture**                 | 低     | 生态     | 自定义节点/自定义 action/模板 marketplace;需权限、沙箱、包格式。                              | §15  |

### 1.2 推荐开工顺序

1. **§4 文档 / onboarding**:最快把已完成能力变成用户可发现价值,风险最低。
2. **§6 Preview 圆角裁剪继承排查**:视觉输出可信度问题,应先确认真实原因。
3. **§7 代码面板选中组件无代码排查**:代码可见性是低代码核心反馈链路。
4. **§8 Inspector / Design Panel 折叠信息架构**:直接改善日常编辑体验,实现风险低于
   runtime/compiler 能力。
5. **§3 轻量 SEO**:纯 compiler/CLI 小闭环,价值明确,不需要引入服务端。
6. **§2 应用发布生命周期**:承接 deploy provider,把“能 deploy”升级成“能发布产品”。
7. **§5 主题 / dark mode**:视觉产品力,但会横跨 variables、compiler、preview。
8. **§10 Analytics**:运营闭环,可在 custom head/script 注入前先做受控集成。
9. **§9 Kiwi schema 设计**:只在需要协作/AI 一等字段时做,先写设计文档。

### 1.3 Phase 5 Out-of-Scope Until Explicitly Chosen

- 不默认做 Kiwi schema 迁移;先设计,再决定是否落地。
- 不默认引入平台计费 / 多租户 / workspace billing。
- 不默认做 SSG/SSR;SEO 第一刀只做静态 metadata emit。
- 不默认做 native mobile export。
- 不默认做 plugin marketplace。
- 不默认改低代码 pluginData key 或已发布 runtime symbol。

### 1.4 2026-06-30 功能盘点与执行记录

本轮按“能在本地完成的直接完成,需要真实账号/人工判断的留到最后手测”原则处理。
使用 `gpt-5.3-codex-spark` 子代理做只读审计后,结论是:

- **已落地**:优先完成 §10 Analytics / Tracking 第一刀。它是受控 provider 集成,比
  custom script 注入风险更低,又能补齐发布后的运营闭环。
- **已记录但暂不编码**:§11 Custom Code Escape Hatch 应先做 head/meta + custom CSS,
  再评估 custom JS。直接开放任意 JS 会提前引入 XSS、preview iframe、CSP 和 deploy
  provider 兼容问题。
- **仍建议排在前面**:§4 文档 / onboarding 已有第一刀,后续需要继续补可复制示例;
  §2 deploy lifecycle 还缺真实 provider rollback ACK 和更完整 environment contract;
  §5 theme/tokens 已进入较深阶段,后续适合做真实模板回归。

需要人工或真实外部凭据验证的事项统一留到收尾 checklist,不阻塞本地实现:

- GA4 / Plausible / PostHog 真 property/project 的网络请求和 dashboard 入账。
- 发布到真实 Netlify / Vercel / Cloudflare Pages 后的 CSP、script 加载和 page view 记录。
- 编辑器 GUI 中 `Track event` 行的视觉和交互手感。

---

## 2. 应用发布生命周期

### 2.1 问题

Phase 4 已经能把编译产物部署到 Netlify / Vercel / Cloudflare Pages,但用户视角仍是
“一次性 deploy 命令”。真实 lowcode 平台需要:

- draft / preview / production 的环境概念;
- 发布前预览和发布后 live URL;
- 回滚到上一个版本;
- 记录 deploy provider、deploy id、commit/message、构建选项;
- 与 Supabase production URL / anon key override 对齐。

### 2.2 初始设计方向

- 新增 app-level deployment metadata,不写入每个 node。
- `open-pencil deploy` 仍保持 stateless CLI;发布历史可以由 app shell / local
  project metadata 管。
- 先支持 local history + provider deploy id,不做云端 team workspace。
- production/staging 命名仅影响 metadata 和 deploy target,不改 compiler emit。

**2026-06-25 第一刀已完成**:

- `open-pencil deploy` 增加 `--environment preview|staging|production`,默认 `preview`;
  `--json` 输出包含 `environment`。
- Tauri `DeployControls` 增加 Environment 选择,并继续通过 env 传 provider token,不持久化
  token。
- 桌面端成功部署后写入本机 `localStorage` deploy history,记录 provider /
  environment / url / deployId / fileCount / site / createdAt,最多保留 8 条。
- History item 可打开 live URL,并按 provider 派生 dashboard 链接作为 rollback 指引:
  Netlify deploy、Vercel deployment、Cloudflare Pages deployment(需要 `account/project`
  site shorthand)。
- 本刀仍不做 provider 原生 rollback API、团队共享发布历史或 environment 到 provider target
  的强绑定;这些留给后续发布生命周期第二刀。

**2026-06-25 第二刀已完成**:

- Deploy history item 增加 `redeploy this environment` 动作,把历史记录里的 provider /
  environment / site / UI kit / i18n locales 回填成当前 deploy form draft。
- Redeploy draft 明确不恢复 provider token、旧 deploy URL 或旧 deploy id;用户仍需输入当前
  token 后重新执行 `Build & Deploy`。
- 该动作把 rollback 从纯 dashboard 指引推进到本地 guarded redeploy flow,但仍不调用
  Netlify / Vercel / Cloudflare 的 provider 原生 rollback API。
- 本刀不引入团队共享 history、持久 build artifact bundle 或 environment 到 provider
  target 的强绑定;这些仍留给后续更完整发布生命周期。

**2026-06-25 第三刀已完成**:

- Deploy history entry 增加 `artifactLabel`、结构化 `buildOptions` snapshot 和
  `compat.schema` 版本位点。
- `recordDeployHistory()` 会从当前 UI kit / i18n / locales 生成 build option snapshot,
  并自动生成可读 artifact label。
- History list 直接显示 artifact label 与 build options,让用户在 redeploy 前能确认
  回放的构建配置。
- 旧 history 记录仍可读取;缺失 `buildOptions` / `compat` 时从 legacy fields 回退。
- 本刀仍不改 CLI deploy JSON、provider 上传实现或 provider 原生 rollback API。

**2026-06-25 第四刀已完成**:

- 增加本地 environment target presets,按 `preview` / `staging` / `production` 分别保存
  provider、site 和 build options。
- DeployControls 增加 `Save <environment> target`,切换 environment 时自动套用已保存的
  target preset。
- Target presets 只写入本机 `localStorage`,不保存 provider token,也不做 provider target
  形式的强校验。
- 本刀仍不改 CLI deploy 参数、provider 上传实现、团队共享 history 或 provider 原生
  rollback API。

**2026-06-25 第五刀已完成**:

- 增加本地 rollback contract helper,按 provider 描述未来真实 rollback API 所需字段和当前支持状态。
- Netlify / Cloudflare 带足本地字段时标记为 `api-candidate`;Cloudflare 缺少
  `account/project` target 时降级为 `dashboard-only`。
- Vercel 当前标记为 `dashboard-only`,因为 production alias / project ownership metadata
  尚未进入本地 history contract。
- Deploy history item 显示 rollback contract 状态,但仍不调用 provider API。
- 本刀仍不改 CLI deploy 参数、provider 上传实现、token 读取逻辑或远端 rollback endpoint。

**2026-06-25 第六刀已完成**:

- 增加 Netlify `restoreNetlifyDeploy()` helper,使用 site-scoped restore API:
  `POST /sites/{site_id}/deploys/{deploy_id}/restore`。
- Netlify rollback contract 现在要求 `token` / `site` / `deployId`;缺少 site 时降级为
  `dashboard-only`。
- DeployControls 对 Netlify `api-candidate` history item 显示 `restore deploy` 动作,
  使用当前 token 输入框调用 helper。
- Token 仍只留在组件内存,不写入 history / target presets / localStorage。
- 本刀仍不改 CLI deploy 参数、provider 上传实现、Cloudflare / Vercel rollback endpoint。

**2026-06-25 第七刀已完成**:

- 将 Netlify restore 的真 token / 真站点 ACK 从代码实现中拆出来,补进
  `docs/lowcode-gui-ack-test.md`。
- ACK checklist 明确真实 provider 验证所需前提:同一 Netlify site 至少两个 deploy
  history entry、目标 row 具备 site / deployId、并显示 `restore deploy`。
- ACK 步骤覆盖请求形态、成功回执、dashboard/live URL 观察点和 reload 后 token 不回填。
- 安全边界写入文档:不把 token 粘到 issue / chat / screenshot / shell history / committed
  files,不保存到 deploy target preset,优先在 preview/staging site 试跑。
- 失败路径要求记录 environment / site / deployId / HTTP status / visible error text,但不记录
  token 值。
- 本刀不执行真实 Netlify restore,不接 Cloudflare / Vercel rollback endpoint,也不新增 root-level
  Markdown 文件,避免 Steiger root Markdown allowlist 漂移。

**2026-06-25 第八刀已完成**:

- 将 Cloudflare Pages rollback contract 从 `site.includes('/')` 的宽松判断收紧为
  `parseCloudflarePagesTarget(site)`。
- Cloudflare target metadata 现在只接受 `account/project` shorthand,并 trim 两端空白;
  空 site、project-only、缺 account、缺 project、多段 slash、dashboard URL 等脏历史值都会降级为
  `dashboard-only`。
- `deployRollbackContract()` 的 Cloudflare 分支改为 provider-specific fields:
  `token` / `accountId` / `projectName` / `deployId`,并返回 `missingFields` 供后续 UI 或
  API helper 使用。
- `deployDashboardUrl()` 复用同一个 parser,只有 account/project 解析成功时才生成 Cloudflare
  dashboard deployment URL。
- 本刀不改 CLI `--account-id` / `--site` 参数、不改 Cloudflare Direct Upload provider、不调远端
  rollback API,也不改变旧 history 的读取兼容性。

**2026-06-25 第九刀已完成**:

- 将 Vercel rollback contract 的自然语言缺口拆成 `parseVercelProjectTarget(site)` 和
  `missingFields`。
- Vercel history 的 `site` 仍只表示 project name;helper 只 trim 并判断是否存在,不把它误认为
  production alias 或 owner scope。
- `deployRollbackContract()` 的 Vercel 分支保持 `dashboard-only`,但 required fields 改为:
  `token` / `deployId` / `projectName` / `productionAlias` / `projectOwner`。
- 有 project name 的 history 仍缺 `productionAlias` / `projectOwner`;legacy 无 site 的 history 还会额外缺
  `projectName`。
- 本刀不改 Vercel upload/deploy provider、不新增 Vercel API helper、不接 production alias promote,
  只让后续 UI/API 接入能机器读取缺失字段。

**2026-06-25 第十刀已完成**:

- Deploy history 的 rollback contract 文案现在直接显示 `missingFields`,例如
  `dashboard only · missing productionAlias, projectOwner`。
- `deployRollbackContractLabel()` / `deployRollbackContractTitle()` 把短 label 和 title tooltip
  格式化逻辑下沉到纯 helper,便于 app tests 覆盖。
- DeployControls 继续保持 history row 一行 `truncate`,长说明放入 title,避免部署历史列表被
  Vercel / Cloudflare provider-specific 字段撑宽。
- Netlify `api-candidate` 的 `restore deploy` 按钮路径不变;Cloudflare / Vercel 仍只显示
  dashboard-only / redeploy 指引,不调用远端 API。

### 2.3 成功标准草案

- CLI 可以输出包含 provider、deployId、url、environment 的 JSON。**2026-06-25 已完成,
  `tests/engine/cli/deploy-provider.test.ts` 覆盖 environment 解析。**
- Tauri DeployControls 可以选择 `preview/staging/production`。**2026-06-25 已完成。**
- 能记录最近 N 次 deploy history,显示 live URL 和 provider id。**2026-06-25 已完成
  local history,`tests/engine/app/deploy-history.test.ts` 覆盖排序、8 条上限和 token 不入库。**
- 支持 rollback 指引:至少能重新 deploy 某个历史 build artifact 或提示 provider
  dashboard rollback。**2026-06-25 已完成 provider dashboard 链接第一刀;真实 provider
  rollback API 未做。第二刀已补 history → redeploy draft,覆盖在
  `tests/engine/app/deploy-history.test.ts`。第三刀已补 artifact label /
  build option snapshot / compat schema,同文件覆盖。**
- Environment target 可以记住 provider/site/build options 且不保存 token。**2026-06-25
  第四刀已补本地 target presets,覆盖在 `tests/engine/app/deploy-history.test.ts`。**
- Provider rollback API 的前置 contract 可判断 api-candidate / dashboard-only /
  unsupported。**2026-06-25 第五刀已补本地 rollback contract,覆盖在
  `tests/engine/app/deploy-history.test.ts`;真实 provider API 仍未调用。**
- Netlify rollback API 可通过 mock fetch 验证请求构造和错误处理。**2026-06-25 第六刀已补
  Netlify site-scoped restore helper,覆盖在 `tests/engine/app/deploy-history.test.ts`;
  真 token live ACK 留给后续手动验证。**
- Netlify restore live ACK 有可执行手测步骤和安全边界。**2026-06-25 第七刀已补
  `docs/lowcode-gui-ack-test.md` checklist;真实 provider ACK 仍需用户凭有效 Netlify token
  手动执行。**
- Cloudflare rollback contract 能把 `account/project` 与脏历史 site 值区分开。**2026-06-25
  第八刀已补 `parseCloudflarePagesTarget()` 和 focused app tests;真实 Cloudflare rollback API
  仍未调用。**
- Vercel rollback contract 能说明 project / production alias / owner scope 缺口。**2026-06-25
  第九刀已补 `parseVercelProjectTarget()` 和 focused app tests;真实 Vercel production alias
  API 仍未调用。**
- Deploy history UI 能展示 rollback contract 缺失字段。**2026-06-25 第十刀已补纯 helper
  和 focused app tests;真实 Cloudflare/Vercel rollback API 仍未调用。**

---

## 3. 轻量 SEO / Metadata Emit

### 3.1 问题

当前 React SPA 仅有基础 HTML metadata。对营销页、公开页面、模板站点来说,缺
`title` / `description` / OG metadata 会直接影响分享和搜索体验。

### 3.2 范围

第一刀只做静态 metadata:

- document-level default title / description;
- page-level override title / description / social image / canonical URL;
- compile/build 时把当前 page metadata 注入 `index.html`; **2026-06-25 第一刀已补
  compiler `metadata` option,支持 title / description / OG image / canonical URL,
  且单页 compile 可用 page override 覆盖 document default。**
- **2026-06-25 第二刀已补持久化 / authoring 小闭环**:`SceneNode.lowcodeSeoMetadata`
  通过 `lowcode/seoMetadata` pluginData round-trip,root 作为 document defaults,
  page CANVAS 作为 single-page override;`update_lowcode_node` / `read_lowcode_node`
  可通过 MCP / CLI eval 写读该字段,compiler 默认读取 graph metadata,显式
  `CompilerOptions.metadata` 仍优先。
- 多页 SPA 不做 SSG,不承诺每个 route 独立 HTML。

### 3.3 非目标

- 不做 SSG/SSR。
- 不做 sitemap/robots 的全自动站点生成,除非后续 provider lifecycle 需要。
- 不做动态 runtime head manager。

### 3.4 成功标准草案

- `.fig` round-trip 保留 metadata。**2026-06-25 已覆盖 `.fig` root/page
  pluginData round-trip,并让 `.pen` importer 支持 `lowcodeSeoMetadata` /
  `pageSeoMetadata`;不改 Kiwi schema。`.pen` 当前仍是 read-only importer,完整
  write round-trip 留到后续专门处理。**
- CLI build 输出的 `index.html` 包含 title/description/OG tags。**2026-06-25 已由
  `tests/engine/compiler/seo-metadata.test.ts` 覆盖 compiler VFS output。**
- preview 不因 metadata 缺失崩溃。**2026-06-25 已覆盖 metadata absent path,不额外
  emit description/OG/canonical。**
- 无 metadata 时输出 byte-stable 或最小漂移。**2026-06-25 已保持默认
  `buildIndexHtml()` 输出不插入额外 tags。**

---

## 4. 文档 / Onboarding / Release Notes

### 4.1 问题

低代码能力已经跨 Supabase、workflow、validation、component library、i18n、
shadcn、deploy 多条线完成,但用户入口分散在 phase docs 和内部实现记录里。

### 4.2 交付物

- README 低代码能力总览:适合用户快速理解“能做什么”。**2026-06-25 第一刀已补
  `README.md` 的 lowcode app publishing 和 compile/build/deploy 快速路径。**
- `packages/docs` 用户指南:从设计到 preview 到 deploy 的一条完整路径。**2026-06-25
  第一刀已新增 `packages/docs/user-guide/lowcode-apps.md`,并从英文 docs 首页、
  User Guide 索引和英文 sidebar 挂入口。**
- 示例 app / demo checklist:展示 Supabase 列表、表单校验、workflow、deploy。**2026-06-25
  第一刀已在用户指南内加入 demo checklist。2026-07-01 第二刀已新增
  `packages/demos/lowcode/lowcode-onboarding-demo.fig` 和
  `tools/lowcode/src/make/onboarding-demo.ts`,覆盖示例 Supabase query/mutation、表单校验、
  workflow、analytics `trackEvent` / consent copy、i18n、shadcn/ui、custom head/CSS metadata,并由
  `tests/engine/app/lowcode/onboarding-demo.test.ts` 验证无真实外部凭据。**
  **2026-07-01 第三刀已把 Stripe checkout redirect trigger 纳入同一 onboarding fixture:
  `Start checkout` 按钮调用示例 `/api/demo-checkout` endpoint,传递公开 `plan` / `email`
  payload,错误写入 `checkoutError`;测试确认 generated source 不包含 Stripe secret。**
- CHANGELOG Unreleased 补齐 Cloudflare deploy / Tauri automation / GUI ACK 等用户可见项。**2026-06-25
  第一刀已补 lowcode onboarding 文档项,并顺手修复 CLI `--provider cloudflare`
  入口校验。**

### 4.3 成功标准草案

- 新用户能按文档完成一个低代码 app 的 preview + build + deploy。
- 文档明确哪些能力是 Tauri-only、哪些是 browser-only。
- 文档不暴露内部 phase 术语作为主要用户入口。

---

## 5. 全局主题 / Design Tokens / Dark Mode

### 5.1 问题

shadcn/ui、Tailwind、Figma variables 已经提供基础,但低代码 app 还缺一等主题模型。
没有主题模型时,dark mode、品牌色、运行时 theme switch 都只能靠零散 class。

### 5.2 初始设计方向

- 从 document/theme 或 variables collection 生成 CSS variables。
- compiler 输出 `:root` / `.dark` token blocks。
- lowcode runtime 提供 `ThemeProvider` 或最小 `useTheme` hook。
- preview pane 能切 theme,但默认保持 byte-stable。

**2026-06-25 第一刀已完成**:

- 新增 compiler 纯函数 `buildDesignTokenThemeCss(graph)`,从 SceneGraph
  `VariableCollection` / `Variable` 生成确定性的 CSS custom properties。
- `compile()` 在不改 SceneNode schema 的前提下自动把 graph variables 注入
  `CompilerOptions.themeCss`;显式 `themeCss` 会追加在生成 token CSS 后,可用于后续 runtime
  hook 或调用方覆盖。
- `src/index.css` 输出 `:root` 默认 mode token,并为非默认 mode 输出
  `:root[data-theme="<mode>"], .theme-<mode>`;mode 名为 `Dark` 时额外使用
  `:root[data-theme="dark"], .dark`。
- 无变量时保持无额外 theme block;shadcn/ui kit 的固定 theme CSS 仍按既有路径合并。
- 本刀只解决 token emit,还不自动把节点样式改写为 `var(...)`,也不提供 preview theme
  switch UI / runtime provider。

**2026-06-25 第二刀已完成**:

- 当 generated theme CSS 存在时,React adapter 同步 emit `src/_lowcode_theme.tsx`。
- `src/main.tsx` 自动用 `LowcodeThemeProvider` 包住 App;runtime 暴露 `useTheme()` 和
  `setTheme(theme)`。
- Runtime 默认从 `localStorage` / `prefers-color-scheme` 初始化,并把当前 theme 应用到
  `document.documentElement.dataset.theme`、`.dark` class 和 `color-scheme`。
- Preview pane 增加 Light / Dark theme switch,通过现有 editor→iframe postMessage 通道发送
  `{ type: 'theme' }`,iframe runtime 接收后即时切换。
- 本刀仍不自动把节点样式改写为 `var(...)`;只有已经使用 CSS variables / theme selectors
  的输出会随 theme 切换。

**2026-06-25 第三刀已完成**:

- `_lowcode_theme.tsx` 额外导出 `LowcodeThemeSwitch`,作为 generated app 内可见的
  fixed light/dark switch。
- `src/main.tsx` 在 `LowcodeThemeProvider` 内自动挂载 `LowcodeThemeSwitch`,确保多页
  app 只在 shell 层出现一次。
- Switch 复用既有 `useTheme()` / `setTheme(theme)` runtime,不改 preview
  postMessage 协议,也不触发重新编译。
- 本刀仍不自动把节点样式改写为 `var(...)`,也不引入 theme switch 配置面板;只有存在
  theme CSS 时才 emit 该 runtime 和控件。

**2026-06-25 第四刀已完成**:

- 新增 `CompilerOptions.themeSwitch`,让发布期可以关闭 generated app 内的可见
  `LowcodeThemeSwitch`,或把它放到 `top-left` / `top-right` / `bottom-left` /
  `bottom-right`。
- `themeSwitch: false` 或 `{ enabled: false }` 只隐藏 fixed switch;只要 theme CSS
  存在,`LowcodeThemeProvider` / `useTheme()` runtime 仍会 emit,preview pane 的
  postMessage theme 切换也保持可用。
- `LowcodeThemeSwitch` 默认位置仍为 `bottom-right`,未传配置的输出保持旧行为。
- 本刀仍不自动把节点样式改写为 `var(...)`,也不引入 app 侧配置面板;配置入口先保持在
  compiler publish-time options。

**2026-06-25 第五刀已完成**:

- 新增 `designTokenCssVariableName(graph, variableId)`,让 theme CSS emit 和节点样式引用共用
  同一套 token 命名规则。
- React IR 新增 `IRStyleAttr`,adapter 统一 emit JSX style object,避免在 collect 阶段拼原始
  JSX。
- Compiler 现在会把已有 `boundVariables['fills/0/color']` 的简单颜色绑定映射到
  generated inline style:
  - `TEXT` 节点输出 `style={{ color: "var(--op-...)" }}`。
  - 非 `TEXT` 节点在 fill 为 visible `SOLID` 且 opacity 为 `1` 时输出
    `style={{ backgroundColor: "var(--op-...)" }}`。
- shadcn 组合控件根节点会透传该 `styleAttr`,避免 `Switch` 等 composed controls
  静默吞掉 bound token style。
- 本刀只覆盖 `fills/0/color` 的最小闭环;暂不处理 stroke、多层 background、opacity 混合、
  gradients、component ref usage site 或未知 collection/token。

**2026-06-25 第六刀已完成**:

- Bound token style 收集从单点 `fills/0/color` 扩展为渐进声明收集器,继续通过
  `IRStyleAttr` 让 React adapter 统一 emit JSX style object。
- `strokes/N/color` 现在会取第一个 visible stroke 的 token binding,输出
  `style={{ borderColor: "var(--op-...)" }}`;仍不尝试完整还原 Figma 多 stroke /
  inside-center-outside 几何语义。
- `opacity` scalar FLOAT binding 现在会输出 `style={{ opacity: "var(--op-...)" }}`。
- `fills/N/color` 的 visible SOLID fill 支持 opacity < 1,输出
  `color-mix(in srgb, var(--op-...) <percent>%, transparent)`。
- 多层 background 现在可在保留其它 solid/image/gradient layer 的同时,把绑定的 SOLID
  fill layer 写入 inline `backgroundImage` / `backgroundSize` / `backgroundPosition` /
  `backgroundRepeat`。
- Component ref usage root 新增 `styleAttr` 通道,generated component wrapper 接收
  `style?: CSSProperties`,让 instance/component usage site 的 root bound token style 不再丢失。
- 找不到 collection/token 的 binding 现在会产生 `design-token-binding-missing` warning,
  不再静默跳过。
- 本刀仍不扩展 core binding path:不支持 `fills/0/gradientStops/0/color` 这类 gradient stop
  token binding;component 内部子节点 override 仍只有 `text` / `className` prop 通道,完整
  child style prop 另开后续设计。

**2026-06-25 第七刀已完成**:

- Component 内部子节点 override 新增 `style` prop 通道。实例子节点已有
  `boundVariables` token style 时,usage site 会传入 `<childName>Style={{ ... }}`,
  generated component body 则以 `style={<childName>Style}` 或
  `style={<childName>Style ?? <defaultStyle>}` 保留 master fallback。
- 该通道与既有 `text` / `className` prop 并行,不改变现有 Tailwind className override
  语义;style prop 使用 `CSSProperties` 类型,不会进入 Tailwind safelist。
- Core `bindVariable` 现在放行并校验 `fills/N/gradientStops/M/color` stop-level color
  binding;compiler 会把 stop-level token 写入 gradient inline `backgroundImage`,支持不同 stop
  使用不同 token 和 `color-mix(...)` alpha。
- 本刀仍不补齐 Figma/Kiwi 标准 stop-level variableConsumptionMap round-trip 和 editor UI
  创建入口;当前 stop-level binding 主要通过 core API / 手动 `boundVariables` 数据进入 compiler。

**2026-06-25 第八刀已完成**:

- Figma/Kiwi gradient stop binding 已支持 round-trip:
  - Kiwi codec `Paint` 暴露 `stopsVar`。
  - Import 会从 `fillPaints[N].stopsVar[M].colorVar` 恢复
    `fills/N/gradientStops/M/color`。
  - Export 会把 `boundVariables['fills/N/gradientStops/M/color']` 写回对应
    `stopsVar[M].colorVar`。
  - OpenPencil `boundVariables` plugin data 继续作为兼容 fallback 写入。
- Raw Figma payload 的 `stopsVar.colorVar.assetRef` 会和 paint-level `colorVar.assetRef`
  一样转换为 guid,避免 library variable 引用在重导出时丢失。
- 本刀仍不补 editor UI / ToolDef 创建入口;当前可通过 core API、导入 `.fig` 或已有
  `boundVariables` 数据进入 compiler。

**2026-06-25 第九刀已完成**:

- `bind_variable` / `unbind_variable` ToolDef 入口现在明确支持
  `fills/N/gradientStops/M/color` stop-level color binding path。
- 新增 focused tool tests 覆盖:
  - `bind_variable` 可创建 gradient stop color binding。
  - 非 COLOR variable 绑定到 gradient stop color 时返回校验错误且不落库。
  - `unbind_variable` 可移除 gradient stop color binding。
- 本刀只补 AI / MCP / CLI eval 可发现入口和回归测试;editor 右侧 UI / Vue color binding 控件
  的 stop-level authoring 仍留给后续单独一刀。

**2026-06-25 第十刀已完成**:

- Editor gradient stop UI 已接入 stop-level color variable authoring:
  - `useColorVariableBinding('fills')` 增加 gradient stop path helpers,统一生成
    `fills/N/gradientStops/M/color`。
  - Fill picker 会把 active node id、fill index 和 stop-level binding API 传给
    `GradientEditor`。
  - Gradient stop 行可应用已有 COLOR variable、从当前 stop color 创建并绑定新 variable、
    显示已绑定 variable 的解析颜色、解绑该 stop-level binding。
  - 用户手动修改已绑定 stop 的 hex、opacity 或 ColorPicker 时会先解绑该 stop,避免 UI 看似改色
    但仍被 variable 覆盖。
- 新增 app-neutral helper test 覆盖 gradient stop bound variable color resolution。
- 本刀不做 Tauri/browser GUI ACK,也不升格 Figma `variableConsumptionMap` 标准通道。

**2026-06-25 第十一刀已完成**:

- 新增 browser E2E 覆盖 `GradientEditor` 的 stop-level variable binding authoring:
  - 通过真实 fill popover 打开 gradient stop editor。
  - 点击 `fill-gradient-stop-apply-variable-0` 绑定已有 COLOR variable。
  - 点击 `fill-gradient-stop-unbind-variable-0` 解绑 stop-level binding。
  - 通过 `fill-gradient-stop-apply-variable-0-create` 从当前 stop color 创建并绑定新 variable。
  - 手动修改 stop hex 后验证 `fills/0/gradientStops/0/color` binding 被移除,stop color 直接落库。
- GUI ACK 过程中修复两个可见问题:
  - `GradientEditor.vue` 多行 template event expression 在真实 Vite / Vue compile 中会报 parse error,
    已下沉为 script helper。
  - 嵌套在 fill popover 内的 variable picker 会被父 popover 截住点击;`VariablePickerPopover`
    默认继续 portal,但 gradient stop picker 显式 `portal=false`,并提高内容层级。
- Stop-level bind / detach / create 后通过本地 `bindingVersion` 刷新 stop row,避免 graph 已更新但
  popover UI 仍显示旧按钮。
- 本刀仍不升格 Figma `variableConsumptionMap` 标准通道,也不处理完整多 stroke 几何语义。

**2026-06-25 第十二刀已完成**:

- Import 侧新增 stop-level `variableConsumptionMap` field decoder:
  - `FILL_PAINT_N_GRADIENT_STOP_M_COLOR` 会还原为
    `fills/N/gradientStops/M/color`。
  - `importVariableBindings()` 现在通过 `kiwiVariableFieldToBindingField()` 统一解析静态字段和
    stop-level dynamic 字段。
- Export 侧保持 schema-safe:
  - `variableConsumptionMap.variableField` 在 vendored Kiwi schema 中是固定 enum;尝试写
    `FILL_PAINT_0_GRADIENT_STOP_0_COLOR` 会在 encode 时抛
    `Invalid value ... for enum "VariableField"`。
  - 因此本刀不把 stop-level binding 写入 `variableConsumptionMap`;导出仍通过
    `fillPaints[N].stopsVar[M].colorVar` 写标准 paint stop binding,并继续写 OpenPencil
    `boundVariables` pluginData fallback。
  - 新增回归测试确保 export 不写非法 stop-level `variableConsumptionMap` entry,避免未来误把
    dynamic field 塞进固定 enum。
- 新增 focused fig roundtrip coverage:
  - 仅靠 raw `variableConsumptionMap` 的 stop-level entry 也能导入到
    `boundVariables['fills/0/gradientStops/1/color']`。
  - 导出 gradient stop binding 时 `stopsVar.colorVar` 存在,但非法 dynamic
    `variableConsumptionMap` entry 不存在。
- 结论:stop-level map **import compatibility 已完成**;stop-level map **export 标准化仍需 Kiwi
  schema / VariableField enum 升级或确认 Figma 官方 enum 名称**,继续 Deferred。

**2026-06-26 第十三刀已完成**:

- Compiler 的 bound stroke token emit 从单层 `borderColor` fallback 扩展到多 visible
  stroke fallback:
  - 单 visible stroke 仍保持旧行为,输出 `style={{ borderColor: "var(--op-...)" }}`。
  - 多 visible stroke 且至少一个 stroke color 绑定了 design token 时,generated React DOM
    输出 layered `boxShadow`,用累计 stroke weight 表达 inside/outside stroke layers。
  - 未绑定 token 的同组 stroke layer 会用静态 hex 颜色参与 `boxShadow`,避免多 stroke stack
    只保留 token layer 而丢掉相邻 hardcoded layer。
  - 如果节点已有 visible drop shadow / inner shadow effect,为避免 inline `boxShadow` 覆盖原本
    shadow effect,会保守退回第一个 bound stroke 的 `borderColor` 行为。
- 新增 focused compiler coverage:
  - 多 stroke token stack 会输出 `boxShadow` 中的 `var(--op-...)` /
    `color-mix(...)` layer。
  - 带 shadow effect 的多 stroke 节点不会写入 token `boxShadow`,而是保留单 stroke
    `borderColor` fallback。
- 本刀只覆盖 generated DOM 的 token-aware multi-stroke fallback,不等同完整 Figma stroke
  geometry:dash pattern、per-side independent stroke、center/outside 的精确几何裁剪仍留给后续。

**2026-06-26 第十四刀已完成**:

- Multi-stroke token fallback 现在会把原有 visible `DROP_SHADOW` / `INNER_SHADOW` effect
  合并到同一个 inline `boxShadow` 声明中,不再因为存在 shadow effect 就退回单
  `borderColor`。
- `effectShadows()` 会把现有 shadow effect 转成稳定 CSS layer:
  - `DROP_SHADOW` 输出 `<x>px <y>px <radius>px <spread?> <color>`。
  - `INNER_SHADOW` 额外带 `inset`。
  - effect color 使用 alpha-aware hex,保持 generated JSX snapshot 稳定。
- 合并顺序保持 stroke layers 在前、原 shadow effects 在后,让 token stroke fallback 和原视觉
  shadow 同时存在。
- 新增 focused compiler coverage 验证带 drop shadow 的 multi-stroke token node 会输出
  `boxShadow` 中的 token stroke layers + 原 drop shadow layer,且不再退回 `borderColor`。
- 本刀仍不处理 dash pattern、per-side independent stroke、center/outside 的精确几何裁剪。

**2026-06-26 第十五刀已完成**:

- Multi-stroke token fallback 的 stroke geometry guardrails 变为显式 compiler 行为:
  - `INSIDE` / `CENTER` 继续映射为 inset CSS shadow layer。
  - `OUTSIDE` 继续映射为 outset CSS shadow layer。
  - 多层 stroke 会分别累计 inset / outset width,避免不同 placement 互相污染。
- 对当前 CSS shadow fallback 无法诚实表达的几何能力降级:
  - `independentStrokeWeights` 且四边权重不一致时,降级为第一个 bound stroke 的
    `borderColor`,并输出 `design-token-stroke-geometry-unsupported` warning。
  - `dashPattern` 非空时,同样降级为第一个 bound stroke 的 `borderColor`,并输出相同
    warning。
- 新增 focused compiler coverage 锁定 align placement、independent side weight 降级和
  dash pattern 降级。
- 本刀仍不做完整 Figma stroke geometry: `CENTER` 的半内半外裁剪、per-side layered shadow
  合成、dash pattern 分段绘制仍留给后续更重的实现。

**2026-06-26 第十六刀已完成**:

- Generated app 的非 dark mode runtime UI 开始消费 theme/design token:
  - `buildDesignTokenThemeCss()` 会在 `:root` 中生成 runtime aliases:
    `--op-lowcode-theme-accent`、`--op-lowcode-theme-surface`、
    `--op-lowcode-theme-on-accent` 和可选 `--op-lowcode-theme-radius`。
  - `LowcodeThemeSwitch` 的 surface、accent、active button 和 radius 现在引用这些 aliases,
    并保留 Canvas fallback。
- Toast runtime 从固定 `bg-blue-600` / `bg-green-600` / `bg-red-600` / `text-white`
  切到 semantic token classes:
  - `info`: `bg-secondary text-secondary-foreground`。
  - `success`: `bg-primary text-primary-foreground`。
  - `error`: `bg-destructive text-destructive-foreground`。
- Confirm runtime 从固定 white/gray/blue 类切到 semantic token classes:
  - modal surface 使用 `bg-background` / `text-foreground` / `border-border`。
  - primary action 使用 `bg-primary` / `text-primary-foreground`。
  - cancel action 使用 `text-muted-foreground` / `hover:bg-secondary`。
- 新增/更新 focused compiler coverage:
  - `tests/engine/compiler/theme-css.test.ts`
  - `tests/engine/compiler/toast.test.ts`
  - `tests/engine/compiler/confirm.test.ts`
- 本刀不改 shadcn UI kit 本身,也不新增真实 browser/Tauri ACK;仅让 generated runtime
  surfaces 先使用现有 token/theme 通道。

**2026-06-26 第十七刀已完成**:

- Validation runtime 的 error surface 从固定 `text-red-600` 切到 semantic
  `text-destructive`:
  - per-field error `<p>` 使用 `text-sm text-destructive mt-1`。
  - FORM validation summary 使用同一套 semantic class。
  - validation safelist 也同步 seed `text-destructive`,不再 seed `text-red-600`。
- 新增 focused compiler coverage:
  - `tests/engine/compiler/form-validation.test.ts` 覆盖 field error、summary error、
    no-validation byte-stability 和 safelist。
- 本刀只处理 validation runtime 的文本错误 surface;input border/ring 的 invalid 视觉状态仍
  留给后续可见 UI 小刀。

**2026-06-26 第十八刀已完成**:

- Validated field 的 invalid state 现在会在有错误时追加 semantic destructive classes:
  - `border-destructive`
  - `ring-1`
  - `ring-destructive`
- Validation safelist 同步 seed invalid-state classes,无 validation 时仍保持 byte-stable 不注入。
- Overlay backdrop 从固定 `bg-black/50` 切到 semantic `bg-foreground/50`,并保持
  close-on-backdrop button / passive backdrop div 两条路径一致。
- 新增/更新 focused compiler coverage:
  - `tests/engine/compiler/form-validation.test.ts`
  - `tests/engine/compiler/overlay.test.ts`
- 本刀不改 overlay panel 本身的 layout / animation / focus trap 行为;只处理 runtime surface 的
  semantic token class。

**2026-06-26 第十九刀已完成**:

- Confirm runtime 的 modal backdrop 从固定 `bg-black/40` 切到 semantic
  `bg-foreground/40`,并通过 focused coverage 锁定不再 seed 固定黑色类。
- Generated app 现在只要发现 runtime/IR className 使用 semantic color utility,就会注入
  Tailwind v4 `@theme inline` token 映射:
  - runtime-only classes: toast / confirm / validation / overlay。
  - IR-emitted classes: SWITCH 等控件。
- SWITCH 默认视觉从固定 gray/blue/white 类切到 semantic token classes:
  - track off: `bg-secondary`。
  - track checked: `checked:bg-primary`。
  - thumb: `before:bg-background`。
  - SWITCH 路径会过滤节点默认 fill 生成的基础 `bg-*` 类,避免 `bg-gray-300` 与 semantic
    track token 同时出现在 compiled output。
- 新增/更新 focused compiler coverage:
  - `tests/engine/compiler/confirm.test.ts`
  - `tests/engine/compiler/toast.test.ts`
  - `tests/engine/compiler/form-validation.test.ts`
  - `tests/engine/compiler/overlay.test.ts`
  - `tests/engine/compiler/ir/collect/interactive-components.test.ts`
- 本刀不迁移设计内容本身的 hex/gradient 输出;那些仍应忠实表达 Figma/OpenPencil 节点样式。

**2026-06-26 第二十刀已完成**:

- RADIO / CHECKBOX-group 的 option input accent 从固定
  `accent-blue-500 dark:accent-blue-400` 切到 semantic `accent-primary`。
- Generated runtime theme utility 检测同步覆盖 `accent-*`,确保原生 radio/checkbox
  accent color 也能拿到 `--color-primary` 的 Tailwind v4 token 映射。
- 新增 focused compiler coverage:
  - `tests/engine/compiler/ir/collect/interactive-components.test.ts` 覆盖 option input
    className、`index.css` safelist、`@theme inline` 和旧 `accent-blue-*` 防回退。
- 本刀只处理 generated option input 的 accent color;不改变 radio/checkbox 的 DOM
  structure、groupName/value/defaultChecked 行为。

**2026-06-26 第二十一刀已完成**:

- 新增 generated runtime UI 的真实 browser smoke:
  - `tests/engine/compiler/preview/runtime-ui.test.ts`
  - 使用现有 `createPreviewServer()` + Chromium,加载 generated VFS app。
  - 拆成三段可排障用例:
    - theme switch + toast + confirm token surfaces。
    - validation invalid state + overlay backdrop。
    - switch + radio semantic control tokens。
- Preview dev-server 的 `optimizeDeps.include` 同步加入 `zustand` 和
  `zustand/vanilla`,避免 `_lowcode_state.ts` 页面在 Vite preview 中触发 duplicate React /
  invalid hook call。
- 本刀是 browser ACK,不是只看 emitted source string;但仍不覆盖 Tauri preview pane。

**2026-06-26 第二十二刀已完成**:

- 跑完整 pre-commit gate `bun run check` 并通过:
  - `build:packages`
  - `lint`
  - `tsgo --noEmit`
  - `check:vue`
  - `check:i18n`
  - `check:packages`
  - `check:arch`
  - `test:type-shapes`
  - `test:tools`
  - `test:dupes`
- 本刀补齐 focused tests 之外的 package build / Vue typecheck / package metadata /
  tooling gates。`bun run check` 本身仍不包含 browser smoke 或 Playwright E2E。

**2026-06-26 第二十三刀已完成**:

- 跑 Tauri preview pane 的 focused Playwright mock ACK:
  - `bun run test -- tests/e2e/code/preview-pane-tauri.spec.ts --project=openpencil`
  - 2 passed。
- 覆盖 preview pane toolbar 的 UI kit / theme / i18n controls,以及 Tauri shell
  mock 下 preview compile stdin payload 中的 rounded-card overflow clipping。
- 本刀使用 `installTauriPreviewMock()` 模拟 Tauri shell/事件环境,不是启动真实 Tauri app。

**2026-06-26 第二十四刀已完成**:

- 跑 full Playwright app/browser suite:
  - `bun run test`
  - 303 passed。
- 覆盖面包括 editor、properties panel、lowcode preview pane mock、validation panel、
  workflow optional params、viewport zoom/pan 等现有 `openpencil` project E2E。
- 本刀补齐 focused smoke 之外的全量 browser regression ACK;它仍不包含 `figma` project 或真实
  Tauri app automation。

**2026-06-26 第二十五刀已完成**:

- 跑真实 Tauri automation debug app:
  - `bun run tauri:automation:dev`
  - 自动化 bridge 在 `9223` 监听,app MCP HTTP/WS 在 `7600` / `7601` 监听。
- 使用 Hypothesi Tauri MCP CLI 完成 GUI ACK:
  - `bunx tauri-mcp driver-session start --port 9223`
  - `bunx tauri-mcp driver-session status`
  - `bunx tauri-mcp ipc-get-backend-state`
  - `bunx tauri-mcp manage-window --action list`
  - `bunx tauri-mcp webview-dom-snapshot --type structure`
  - `bunx tauri-mcp webview-execute-js --script "..."`
  - `bunx tauri-mcp webview-get-styles --selector '#lowcode-preview' --properties display,visibility,width,height`
  - `bunx tauri-mcp webview-wait-for --type selector --value '#lowcode-preview' --timeout 5000`
  - `bunx tauri-mcp webview-screenshot --file test-results/tauri-mcp-screenshot.png`
- 关键断言:
  - backend state 返回 `OpenPencil` `0.13.2`,debug macOS Tauri `2.10.2`,`window_count: 1`。
  - main window 可见并聚焦,URL 为 `http://localhost:1420/`。
  - webview JS 返回 `hasTauri: true`、`hasLowcodePreview: true`,toolbar text 包含 Preview /
    UI / Tailwind / shadcn / Theme / Light / Dark / i18n / Deploy。
  - `#lowcode-preview` computed style 为 `display: flex`,`visibility: visible`。
- 本刀是真实 Tauri debug app + webview automation bridge ACK,不是 Playwright/Tauri mock。

**2026-06-26 第二十六刀已完成**:

- 将真实 Tauri lowcode preview ACK 命令沉淀到 `docs/tauri-gui-automation.md`:
  - 记录 Terminal 1 / Terminal 2 的顺序命令。
  - 记录 session、backend、window、DOM、JS、style、wait 和 screenshot 的 expected signals。
  - 明确 `test-results/` 为 ignored,截图不应提交。
  - 记录 `driver-session start` 和 screenshot 不要并行跑,避免 active session race。
- 跑 Tauri automation engine 合约测试:
  - `bun test tests/engine/tauri/mcp-spawn.test.ts tests/engine/tauri/automation-files.test.ts`
  - 3 pass,0 fail,6 expects。

**2026-06-26 第二十七刀已完成**:

- 修复 package tarball smoke gate 并跑通 `bun run test:packages`:
  - `tools/package-quality/src/smoke.ts` 只从 `bun pm pack --quiet` 输出里选择 `.tgz` 行,避免把
    `Packed size: ...` 当成 tarball 路径。
  - smoke install 使用 temp-local `npm_config_cache`,不再受用户全局 `~/.npm` cache 权限污染影响。
  - smoke install 同时打包私有 `@open-pencil/compiler` tarball,让 public CLI tarball 的 workspace
    compiler dependency 在本地 smoke 中可解析,不去 npm registry 查找私有包。
  - `@open-pencil/compiler` 发布态构建切到 `tsdown` unbundle 输出 `.mjs`,并把 default exports 指向
    `dist/*.mjs`,修复 Node ESM extensionless relative import 问题。
  - compiler runtime dependencies 补齐 `@tailwindcss/vite`、`@vitejs/plugin-react`、`vite` 和
    `@noble/hashes`。
  - `@iconify-json/lucide/icons.json` 改为标准 JSON import attribute,避免 Node ESM 缺少
    `type: "json"`。
- 验证:
  - `bun --filter @open-pencil/compiler build` 通过。
  - `bun run test:packages` 通过,输出 `Packed package smoke tests passed.`。

**2026-06-26 第二十八刀已完成**:

- 将真实 Tauri lowcode preview ACK 从手工 runbook 沉淀成 repo-local helper:
  - 新增 `tools/lowcode/src/tauri-lowcode-preview-ack.ts`。
  - 新增 root shim `scripts/tauri-mcp-lowcode-preview-ack.ts`。
  - 新增 root script `tauri:mcp:lowcode-preview-ack`。
  - `docs/tauri-gui-automation.md` 更新为优先使用 helper,手工命令保留作排障步骤。
- helper 覆盖顺序:
  - `driver-session start/status`
  - `ipc-get-backend-state`
  - `manage-window --action list`
  - `webview-dom-snapshot`
  - `webview-execute-js`
  - `webview-get-styles`
  - `webview-wait-for`
  - `webview-screenshot`
- 验证:
  - `bun run tauri:mcp:lowcode-preview-ack --help` 通过。
  - 未启动 Tauri app 时,`bun run tauri:mcp:lowcode-preview-ack --skip-screenshot`
    给出清晰 `Tauri MCP driver session is not connected.` 错误。
  - 真实 Tauri automation app 下,`bun run tauri:mcp:lowcode-preview-ack` 通过并写入 ignored
    `test-results/tauri-mcp-screenshot.png`。
  - `bun run lint:structure` / `CHOKIDAR_USEPOLLING=1 bun run check:arch` /
    `bunx tsgo --noEmit` / `bun run test:tools` 通过。

**2026-06-29 第二十九刀已完成**:

- 将 repo-local Tauri lowcode preview ACK helper 拆成可测试的 CLI contract:
  - `tools/lowcode/src/tauri-lowcode-preview-ack.ts` 导出参数解析、CLI runner 和 ACK runner。
  - `scripts/tauri-mcp-lowcode-preview-ack.ts` 作为 root shim 显式调用 `runCli()`。
  - 新增 `tests/engine/tauri/lowcode-preview-ack.test.ts` 覆盖:
    - `--help` 不触发 bridge 命令。
    - 缺少全局 `tauri-mcp` 时 fallback 到 `bunx tauri-mcp`。
    - `TAURI_MCP_BIN` 自定义可执行文件路径。
    - `--skip-screenshot` 不写截图。
    - driver session 未连接时输出清晰错误。
- 为测试侧导入 tools 代码补充 `#tools/*` tsconfig alias,避免深层 parent-relative import。
- 验证:
  - `bun test tests/engine/tauri/mcp-spawn.test.ts tests/engine/tauri/automation-files.test.ts tests/engine/tauri/lowcode-preview-ack.test.ts`
    通过,7 pass,21 expects。
  - `bun run lint:structure` 通过,仅既有 max-lines warnings。
  - `bunx tsgo --noEmit` 通过。
  - `bun run test:tools` 通过。

**2026-06-29 第三十刀已完成**:

- 复查 `packages/compiler/src/adapters/react/preview-bridge.ts` 的 selection overlay 色值:
  - 将 `#4c8bf5` / `#4c8bf514` 收敛为 `PREVIEW_SELECTION_OVERLAY_BORDER` /
    `PREVIEW_SELECTION_OVERLAY_BACKGROUND`。
  - 增加注释说明这是 editor-only preview selection chrome,应独立于 generated app theme tokens。
  - 不把这层 debug/selection overlay 纳入 runtime semantic token CSS,避免用户设计主题影响编辑器
    高亮可读性。
- 验证:
  - `bun test tests/engine/compiler/preview/bridge.test.ts` 通过。

**2026-06-29 第三十一刀已完成**:

- 将 gradient stop 变量绑定的 scene path → Kiwi dynamic field 映射补成显式 helper contract:
  - `kiwiVariableFieldToBindingField('FILL_PAINT_N_GRADIENT_STOP_M_COLOR')` 继续导入为
    `fills/N/gradientStops/M/color`。
  - `variableBindingFieldToKiwi('fills/N/gradientStops/M/color')` 默认仍返回 `undefined`,
    防止 serializer 误写 vendored Kiwi fixed enum 不支持的 dynamic `variableField`。
  - 只有显式传入 `{ includeGradientStops: true }` 时,才返回
    `FILL_PAINT_N_GRADIENT_STOP_M_COLOR`,方便后续 Kiwi schema enum 升级或官方字段确认后接入。
- 新增 focused roundtrip test 锁定这个默认安全边界,避免未来重构把 stop-level binding
  重新写进 `variableConsumptionMap`。
- 本刀不改变 `.fig` export 行为:stop-level binding 仍走 `stopsVar.colorVar` + OpenPencil
  `boundVariables` fallback。

### 5.3 风险

- 与 shadcn theme tokens、Tailwind v4 `@theme` 交互复杂。
- Figma variables mode 与 app runtime theme 不是一回事,需要映射层。
- 节点样式 `var(...)` 映射仍是渐进覆盖;目前覆盖 simple fill/text、stroke、scalar
  opacity、多层 SOLID background layer、component usage root、component child style prop、多 visible
  stroke token fallback,以及 core/compiler/Kiwi/ToolDef/editor UI 层的 gradient stop token
  binding。Gradient stop editor UI 已有 browser E2E ACK。Stop-level `variableConsumptionMap`
  只完成 import compatibility;export 仍受 Kiwi fixed enum 限制。完整 stroke 几何语义和
  stop-level map export 标准化仍需后续补齐。

### 5.4 成功标准草案

- 有 Light/Dark mode variables 时,generated `src/index.css` 包含 `:root` 与 `.dark`
  token blocks。**2026-06-25 已由 `tests/engine/compiler/theme-css.test.ts` 覆盖。**
- 无 variables 时不引入额外 theme block。**2026-06-25 已覆盖。**
- 显式 `CompilerOptions.themeCss` 与自动 token CSS 合并顺序稳定。**2026-06-25 已覆盖。**
- Preview pane 可切换 light/dark,emitted runtime 暴露 `ThemeProvider` / `useTheme` hook。
  **2026-06-25 第二刀已完成;compiler runtime 覆盖在
  `tests/engine/compiler/theme-css.test.ts`。**
- Generated app 内可见 light/dark switch。**2026-06-25 第三刀已完成;同样由
  `tests/engine/compiler/theme-css.test.ts` 覆盖。**
- Theme switch 可在 publish-time 关闭或放置到四角。**2026-06-25 第四刀已完成;同样由
  `tests/engine/compiler/theme-css.test.ts` 覆盖。**
- 已绑定 `fills/0/color` 的简单 SOLID fill/text color 可 emit `var(--op-...)` inline style。
  **2026-06-25 第五刀已完成;同样由
  `tests/engine/compiler/theme-css.test.ts` 覆盖。**
- 已绑定 stroke color、scalar opacity、半透明 SOLID fill、多层 SOLID background layer 和
  component usage root style 可 emit `var(--op-...)` / `color-mix(...)` inline styles。
  **2026-06-25 第六刀已完成;同样由
  `tests/engine/compiler/theme-css.test.ts` 覆盖。**
- 已绑定 gradient stop color 和 component child token override 可 emit `var(--op-...)` /
  `color-mix(...)` inline styles。**2026-06-25 第七刀已完成;由
  `tests/engine/compiler/theme-css.test.ts` 和
  `tests/engine/scene-graph/variable/binding/validation.test.ts` 覆盖。**
- Gradient stop token binding 可通过 `.fig` export → re-import 保留。**2026-06-25 第八刀
  已完成;由 `tests/engine/io/fig/roundtrip/variables.test.ts` 覆盖。**
- Gradient stop token binding 可通过 `bind_variable` / `unbind_variable` ToolDef 创建和移除。
  **2026-06-25 第九刀已完成;由 `tests/engine/tools/variables.test.ts` 覆盖。**
- Gradient stop token binding 可通过 editor gradient stop UI 创建、显示和解绑。**2026-06-25
  第十刀已完成;由 `tests/engine/app/color-style-row.test.ts` 加固 app-neutral helper。**
- Gradient stop editor UI 有真实 browser E2E 覆盖。**2026-06-25 第十一刀已完成;由
  `tests/e2e/properties/panel.spec.ts` 覆盖 bind existing / create / detach / manual edit
  unbind。**
- Raw `.fig` stop-level `variableConsumptionMap` entry 可导入为 gradient stop binding,且
  export 不会写 vendored Kiwi enum 不支持的 dynamic field。**2026-06-25 第十二刀已完成;由
  `tests/engine/io/fig/roundtrip/variables.test.ts` 覆盖。**
- 多 visible stroke token stack 在 generated DOM 中可通过 layered `boxShadow` 保留 token
  colors,且可与原 drop / inner shadow effect 合并。**2026-06-26 第十三/十四刀已完成;由
  `tests/engine/compiler/theme-css.test.ts` 覆盖。**
- Multi-stroke token fallback 的 stroke align 近似和 unsupported geometry 降级可预测:
  `INSIDE` / `CENTER` 走 inset,`OUTSIDE` 走 outset;independent side weights / dash pattern
  降级为 `borderColor` 并给出 warning。**2026-06-26 第十五刀已完成;由
  `tests/engine/compiler/theme-stroke-geometry.test.ts` 覆盖。**
- Generated runtime UI 的 theme switch、toast 和 confirm surface 消费 semantic theme/design
  token。**2026-06-26 第十六刀已完成;由 `tests/engine/compiler/theme-css.test.ts`、
  `tests/engine/compiler/toast.test.ts` 和 `tests/engine/compiler/confirm.test.ts` 覆盖。**
- Validation runtime 的 error text surface 消费 semantic destructive token。
  **2026-06-26 第十七刀已完成;由 `tests/engine/compiler/form-validation.test.ts` 覆盖。**
- Validated field invalid state 和 overlay backdrop 消费 semantic token classes。
  **2026-06-26 第十八刀已完成;由 `tests/engine/compiler/form-validation.test.ts` 和
  `tests/engine/compiler/overlay.test.ts` 覆盖。**
- Generated runtime UI 在真实 browser preview 中有 smoke ACK。**2026-06-26 第二十一刀已完成;
  由 `tests/engine/compiler/preview/runtime-ui.test.ts` 覆盖。**
- Full pre-commit gate `bun run check` 通过。**2026-06-26 第二十二刀已完成。**
- Tauri preview pane mock ACK 通过。**2026-06-26 第二十三刀已完成;由
  `tests/e2e/code/preview-pane-tauri.spec.ts` 覆盖。**
- Full Playwright app/browser suite 通过。**2026-06-26 第二十四刀已完成;`bun run test`
  303 passed。**
- 真实 Tauri automation bridge 可连接并能读取 lowcode preview pane。**2026-06-26 第二十五刀
  已完成;由 `tauri-mcp` session/backend/window/DOM/JS/style/wait/screenshot ACK 覆盖。**
- 真实 Tauri automation ACK 有可复用 runbook,且 app automation spawn/file helper 合约测试通过。
  **2026-06-26 第二十六刀已完成;见 `docs/tauri-gui-automation.md` 与
  `tests/engine/tauri/**`。**
- Package tarball smoke gate 通过,public packages 与私有 compiler runtime dependency 的 Node
  安装/导入/bin 形态可执行。**2026-06-26 第二十七刀已完成;由 `bun run test:packages`
  覆盖。**
- 真实 Tauri lowcode preview ACK 可通过 repo-local helper 重复执行。**2026-06-26 第二十八刀
  已完成;由 `bun run tauri:mcp:lowcode-preview-ack` 覆盖。**
- Repo-local Tauri lowcode preview ACK helper 的 CLI contract 有 engine-level 覆盖。
  **2026-06-29 第二十九刀已完成;由
  `tests/engine/tauri/lowcode-preview-ack.test.ts` 覆盖。**
- Preview bridge selection overlay 色值被明确为 editor-only chrome,不并入 generated app
  theme token。**2026-06-29 第三十刀已完成;由
  `tests/engine/compiler/preview/bridge.test.ts` 覆盖。**
- Gradient stop scene path → Kiwi dynamic field mapping 有显式 opt-in helper,默认不影响
  schema-safe export。**2026-06-29 第三十一刀已完成;由
  `tests/engine/io/fig/roundtrip/variables.test.ts` 覆盖。**
- 后续可继续做:Kiwi `VariableField` enum 升级 / Figma 官方 stop-level field 名确认、完整多
  stroke 几何语义、评估真实 Tauri automation helper 是否应进一步升级为可自启动/自清理的 GUI
  spec、更多 runtime UI polish。

---

## 6. Preview 圆角裁剪继承排查

### 6.1 问题

低代码展示画板 / preview 中,父元素设置圆角时,子元素的圆角或背景疑似没有被父元素
正确裁剪。用户看到的结果可能与设计画布不一致,尤其出现在 card、button group、
image tile、component container 等常见结构里。

### 6.2 排查方向

- 确认问题发生在 editor canvas、lowcode preview iframe、compiled React output,
  还是三者都有。
- 检查 compiler 是否为带圆角的容器同时 emit `border-radius` 和必要的
  `overflow: hidden` / clipping wrapper。
- 检查 absolute/sticky/fixed 子元素、transform、z-index、background layer 是否绕过
  父级 clipping。
- 检查 shadcn/ui 或 component adapter 是否对子元素重新写入 radius class,导致视觉上
  覆盖父级语义。
- 建立最小复现:父 frame 圆角 + 子 rectangle/image/button 超出边界,对比设计画布、
  preview、build output。

### 6.3 成功标准草案

- 最小复现中,父元素圆角能稳定裁剪子元素背景和媒体内容。
- 不破坏需要子元素自有圆角的合法场景,例如 nested card/button。
- compiler/engine 增加 focused emit test。**2026-06-25 已补
  `tests/engine/compiler/ui-kit/card.test.ts`,覆盖 card-like frame emits
  `overflow-hidden`。**
- Tauri/browser preview GUI ACK 覆盖至少一个父圆角裁剪场景。**2026-06-25 已补
  `tests/e2e/code/preview-pane-tauri.spec.ts`,通过 Tauri shell stdin mock 验证 preview
  pane 实际 compile update 的 `src/App.tsx` 包含 rounded parent 的
  `overflow-hidden`。**

---

## 7. 代码面板选中组件无代码排查

### 7.1 问题

代码面板在选中 Button 等组件时疑似没有展示对应代码。低代码的核心反馈链路是
“选中设计节点 → 看到生成代码 / 绑定 / props”,如果组件选中态没有代码,用户很难判断
当前节点是否被 compiler 正确识别。

### 7.2 排查方向

- 确认问题只发生在组件实例,还是普通 frame/text/shape 也会出现。
- 检查 selection id 是否正确传到 code panel,尤其 component instance / variant /
  lowcode form control 是否被过滤。
- 检查代码面板使用的 generator 是 selection snippet、page preview VFS,还是 full
  compile output;不同路径可能对 component nodes 支持不一致。
- 检查 Button 等 UI-kit 组件是否只有 adapter-level emit,但缺少 selection-level
  snippet 映射。
- 失败时面板应显示空状态和原因,而不是静默无代码。

### 7.3 成功标准草案

- 选中 Button、Input、Select、Card、普通 Frame 时都能看到对应代码或明确 unsupported
  reason。**2026-06-25 已补 Button/Input/Select selection snippet 映射与 CodePanel
  E2E ACK;Card/Frame 已由既有 frame/rectangle 路径覆盖。**
- component instance 和 component set variant 的 snippet 能反映实际 props。
- 代码面板切换选择时不会残留上一个节点代码。
- 增加 focused unit/component test,并用 GUI ACK 验证选中 Button 后出现代码。**2026-06-25
  已补 `tests/engine/render/jsx/export.test.ts` 与 `tests/e2e/code/panel.spec.ts`,
  覆盖 OpenPencil / Tailwind 格式切换和 Input/Select 交互属性。**

---

## 8. Inspector / Design Panel 折叠信息架构

### 8.1 问题

右侧设计面板已经承载基础样式、布局、组件属性、低代码状态、bindings、events、
workflows、validation、i18n、deploy/preview 等入口。继续平铺会导致:

- 参数密度过高,新用户不知道先看哪里;
- 专业用户滚动成本高,频繁编辑时效率下降;
- lowcode 相关参数和常规 design 参数互相打断;
- 后续 Phase 5 增加 SEO、analytics、theme 等设置时面板会继续膨胀。

### 8.2 推荐方案

第一刀做 **可记忆的折叠分组 + 上下文显隐**,不要一次性重写 inspector:

- 分组建议:`Position`、`Layout`、`Appearance`、`Typography`、`Component`、
  `Prototype / Events`、`Lowcode`、`Export / Deploy`。
- 每个分组使用 disclosure/accordion,保留键盘可达、ARIA 状态和焦点恢复。
- 折叠状态按 user preference 持久化,不要写入 `.fig` 文档。
- 根据选择节点类型显隐分组:例如 text node 默认展开 Typography,component instance
  默认展开 Component,lowcode node 默认展开 Lowcode。
- 支持“搜索属性 / filter sections”作为第二刀,避免用户记不住参数在哪。
- 对高级低代码分组使用 progressive disclosure:默认只显示常用项,高级项折叠到
  `Advanced`。

**2026-06-25 收尾 polish 已完成**:

- 单选节点的低代码属性从单一 `Lowcode` section 拆成 `Bindings`、`Events`、
  `Validation`、`Advanced` 四组,保留原有子面板和写入路径。
- 空选择的文档级低代码入口拆成 `Lowcode State`、`Services & Workflows`、
  `Content & i18n`,减少 Supabase / workflow / translation 与 page 属性互相打断。
- Inspector filter 命中 section 时高亮 section trigger;无匹配时显示
  `No matching property sections` 空状态,不再留下静默空白面板。
- `tests/e2e/design/panel.spec.ts` 覆盖普通节点、低代码 INPUT/BUTTON、空选态、空结果、
  section 高亮和折叠状态记忆。

### 8.3 非目标

- 不在第一刀改变 SceneNode schema。
- 不重做所有 inspector controls。
- 不把每个参数都藏起来;常用参数仍应一眼可达。
- 不为了折叠而增加嵌套卡片;面板仍保持紧凑工具属性布局。

### 8.4 成功标准草案

- 常见节点选择后,首屏能看到最相关的 2-3 个分组。
- 折叠状态在同一设备重启 app 后保留。**2026-06-25 已由
  `tests/e2e/design/panel.spec.ts` 覆盖 localStorage 记忆。**
- 空选择、多选、text、frame、component instance、lowcode 表单节点都有合理默认展开。
  **2026-06-25 已覆盖空选态、多选、普通矩形、BUTTON/INPUT 低代码节点;component
  instance 仍沿用既有 `Component` section。**
- Tauri/browser GUI ACK 覆盖展开/折叠、切换选择、状态保留。**2026-06-25 已跑浏览器
  Playwright ACK:`bun run test -- tests/e2e/design/panel.spec.ts --project=openpencil`
  16 passed。**
- Vue typecheck 和 focused component tests 通过。**2026-06-25 已通过 `bun run check:vue`
  和 focused Playwright;本刀没有新增组件单测 harness。**

---

## 9. Kiwi Schema 升格设计

### 9.1 当前决定

保持 Deferred。当前 `lowcode/*` pluginData 旁路稳定 round-trip,已覆盖 compiler /
editor / MCP / `.fig` 兼容路径。升格 Kiwi schema 不解锁用户功能。

### 9.2 只有这些条件满足才值得进入实现

- 协作 / AI / 外部工具需要 lowcode 字段作为 schema 一等字段;
- pluginData 旁路在性能、兼容或迁移上出现真实瓶颈;
- 有明确旧文件迁移策略和回滚策略;
- 有完整 codec / kiwi / import-export / cross-version 测试预算。

### 9.3 设计文档必须回答

- 新字段归属哪个 Kiwi message?
- 旧 pluginData 如何迁移? 是否双写? 双写多久?
- 老客户端读新文件的行为是什么?
- 新客户端读旧文件如何升级?
- 与 Figma 原始 pluginData 是否冲突?
- 如何验证 round-trip 不丢字段?

---

## 10. Analytics / Tracking

### 10.1 范围

- Provider presets:GA4、Plausible、PostHog。
- document-level tracking id / endpoint。
- event action 可选 `trackEvent`。
- deploy/build 时注入 script 和 runtime helper。

**2026-06-30 第一刀已完成**:

- 数据模型新增 `AnalyticsConfig` 和 `TrackEventAction`:
  - root node 使用 `lowcodeAnalyticsConfig` 存 provider、tracking id、enabled、endpoint。
  - action chain 支持 `{ kind: 'trackEvent', eventNameExpr, properties? }`。
- 持久化继续走稳定 pluginData 旁路:
  - `.fig` export/import 使用 `lowcode/analyticsConfig`。
  - `trackEvent` 随既有 `lowcode/events` / `lowcode/workflows` JSON round-trip。
- ToolDef / MCP / AI 边界已校验:
  - provider 仅允许 `ga4` / `plausible` / `posthog`。
  - tracking id 必须是非空字符串。
  - `eventNameExpr` 和 property value 使用既有 expression parser。
  - property key 必须是 JS identifier。
- Compiler / React adapter 已 emit:
  - 生成 `src/_lowcode_analytics.ts`。
  - root analytics config 存在时 `main.tsx` side-effect import runtime 并自动发送
    `page_view`。
  - 事件链中使用 `trackEvent` 时页面 import `__opTrackEvent` 并按表达式生成 event
    name/properties。
  - 没有 provider config 但存在 `trackEvent` 时 runtime 生成 null config no-op,避免
    编译失败或运行时报错。
  - GA4、Plausible、PostHog 都先安装 queue/stub,避免 SDK 脚本加载前丢首个事件。
- GUI 第一刀已补:
  - Lowcode action factory 支持 `trackEvent`。
  - ActionRow 显示 `Track event` 并允许编辑 event name expression。
  - properties 复杂对象先保留给 MCP/JSON 工具,避免第一刀把 GUI 做成大表单。
- 覆盖:
  - `tests/engine/compiler/analytics.test.ts` 覆盖 runtime emit、main side-effect import、
    event helper import/properties emit、无 provider config no-op。
  - `tests/engine/kiwi/lowcode/roundtrip.test.ts` 覆盖 analytics config 与 trackEvent 经
    `.fig` round-trip。

**2026-06-30 第二刀已完成**:

- 空选择态 `Services & Workflows` 增加 document-level `Analytics` 配置面板:
  - provider 下拉支持 GA4 / Plausible / PostHog。
  - 支持 enabled 开关、public tracking id、optional endpoint。
  - `Clear` 清空 root `lowcodeAnalyticsConfig`。
  - 空 id 不持久化 config,避免写入无效 analytics 配置。
- `Track event` action GUI 增加 properties 编辑器:
  - 每行编辑 property key 和 expression value。
  - key 复用 payload entry identifier 校验。
  - value 复用 expression parser 校验。
- 覆盖:
  - `tests/engine/app/lowcode/action-errors.test.ts` 覆盖 trackEvent properties 的 GUI 校验。

**2026-06-30 第三刀已完成**:

- Analytics config 面板增加 provider-specific authoring guard:
  - GA4 id 使用 `G-...` placeholder 与格式提示。
  - Plausible id 使用 domain placeholder 与格式提示。
  - PostHog id 使用 `phc_...` placeholder 与格式提示。
  - optional endpoint 仅对 Plausible / PostHog 开放,并校验 http(s) URL。
  - provider 切到 GA4 时自动清空 endpoint,避免持久化运行时不会使用的字段。
- `Track event` 行增加未配置 provider hint:
  - 当 root analytics config 缺失、disabled 或 id 为空时,事件行提示发布前需要先配置
    Analytics。
  - 只提示,不阻断 authoring;runtime 仍保持 no-op。
- TrackEvent properties 增加重名防护:
  - 新增 property 时自动选择未占用 key。
  - 用户把 key 改成已有 key 时自动追加后缀,避免 object 写回时静默覆盖旧属性。

**2026-06-30 第四刀已完成**:

- Analytics config 增加 `pageViews?: boolean`:
  - 默认开启,不写入额外字段。
  - 用户在 GUI 里关闭 `Track page views` 时持久化 `pageViews:false`。
  - `update_lowcode_node` / `.fig` pluginData / compiler IR compact 均支持该字段。
- Runtime 拆出 `__opTrackPageView()`:
  - 初始加载仍按默认发送一次 `page_view`。
  - `pageViews:false` 时不自动发送 page view,但 `trackEvent` 手动事件仍可用。
- 多页 React router shell 增加 route-change tracker:
  - 仅在多页 app 且 analytics config 存在、`pageViews !== false` 时 emit。
  - tracker 跳过首次 mount,避免与 runtime 初始 `page_view` 重复。
  - 后续 route path/search/hash 变化时发送 `page_view`。
- 覆盖:
  - `tests/engine/compiler/analytics.test.ts` 覆盖多页 route tracker 和
    `pageViews:false` 的自动 page view 关闭。
  - `tests/engine/kiwi/lowcode/roundtrip.test.ts` 覆盖 `pageViews:false`
    `.fig` round-trip。

**2026-06-30 第五刀已完成**:

- Analytics config 面板增加 provider-specific help:
  - GA4 显示 `Measurement ID` 说明和官方文档链接。
  - Plausible 显示 domain 说明、自托管 script endpoint 提示和官方文档链接。
  - PostHog 显示 project API key 说明、host/region endpoint 提示和官方文档链接。
- `Track event` 未配置 provider hint 升级为非阻断式发布提示:
  - 明确指向空选择态 `Services & Workflows` 的 Analytics provider 配置。
  - 仍允许继续编辑 event name / properties,保持无 provider 时 runtime no-op 的语义。
- 浏览器级 ACK checklist 已补到 `docs/lowcode-gui-ack-test.md`:
  - 覆盖 provider help / docs link / endpoint hint。
  - 覆盖 `Track event` hint、properties、save/reopen、`Track page views` toggle。
  - 将真实 GA4 / Plausible / PostHog dashboard 入账留作 live-provider 手测。
- 覆盖:
  - `tests/engine/app/lowcode/action-errors.test.ts` 覆盖 provider help mapping 和
    missing-provider hint 不阻断有效 `trackEvent`。

**2026-06-30 第六刀已完成**:

- Analytics config 增加 privacy gates:
  - `respectDoNotTrack?: boolean`:生成 runtime 读取 `navigator.doNotTrack` /
    `navigator.msDoNotTrack` / `window.doNotTrack`,命中时不加载 provider script、不发送事件。
  - `consentRequired?: boolean`:生成 runtime 默认 no-op,直到 app flow 调用
    `__opGrantAnalyticsConsent()`。
  - runtime 同时导出 `__opRevokeAnalyticsConsent()`,用于用户撤回 consent 后暂停后续事件。
- GUI:
  - Analytics 面板增加 `Respect Do Not Track` 和 `Require consent before tracking` 两个开关。
  - 默认都关闭,保持既有 analytics 输出向后兼容。
- 覆盖:
  - `tests/engine/compiler/analytics.test.ts` 覆盖 DNT / consent runtime gate emit。
  - `tests/engine/tools/lowcode/modify.test.ts` 覆盖 ToolDef 写入 privacy gates。
  - `tests/engine/tools/lowcode/read.test.ts` 覆盖 ToolDef 读取 privacy gates。
  - `tests/engine/kiwi/lowcode/roundtrip.test.ts` 覆盖 `.fig` round-trip。

**2026-07-01 第七刀已完成**:

- Generated app 在 `consentRequired:true` 时自动挂载基础 Analytics consent banner:
  - `src/_lowcode_analytics.ts` 导出 `LowcodeAnalyticsConsentBanner`。
  - `src/main.tsx` 在 `<App />` 旁挂载该 banner。
  - 用户点击 `Accept` 时调用 `__opGrantAnalyticsConsent()` 并加载 provider script。
  - 用户点击 `Decline` 时调用 `__opRevokeAnalyticsConsent()` 并隐藏 banner。
- 无 consent gate 的 analytics 输出仍保持 side-effect import,不生成可见 banner。
- 本刀只提供基础 accept/decline template,不持久化用户偏好、不做多分类 preference center。
- 覆盖:
  - `tests/engine/compiler/analytics.test.ts` 覆盖 consent banner 的生成、挂载和未开启
    consent gate 时的缺省输出。

**2026-07-01 第八刀已完成**:

- 基础 Analytics consent banner 增加持久化偏好:
  - 使用 provider/id scoped `localStorage` key,避免同域多个生成 app 互相污染。
  - `Accept` 持久化 `granted`,后续加载直接允许 analytics setup。
  - `Decline` 持久化 `denied`,后续加载保持 no-op。
  - storage 不可用时降级为本次 page load 内有效,不阻断 app。
- Banner 隐藏后保留一个小型 `Analytics preferences` 按钮:
  - 用户可以重新打开偏好面板。
  - 再次选择 `Accept` / `Decline` 会覆盖旧偏好。
- 本刀仍不做多分类 preference center、品牌化 copy 或 region/legal preset。
- 覆盖:
  - `tests/engine/compiler/analytics.test.ts` 覆盖 localStorage key、granted/denied 写入和
    preferences 重开入口 emit。

**2026-07-01 第九刀已完成**:

- 基础 Analytics consent banner 升级为最小 preference center:
  - 固定显示 `Necessary` 类别,说明 app 必需能力始终启用。
  - 显示可切换的 `Analytics` 类别,控制是否允许 page views 和 explicit `trackEvent`。
  - 操作区提供 `Decline all`、`Save preferences` 和 `Accept all`。
  - `Analytics preferences` 重开入口会回到同一套分类选择 UI。
- 本刀仍不做品牌化文案、region/legal preset、IAB TCF 或多 provider category policy。
- 覆盖:
  - `tests/engine/compiler/analytics.test.ts` 覆盖 `Necessary` / `Analytics` 分类文案、
    `Save preferences`、`Accept all` 和 `Decline all` emit。

**2026-07-01 第十刀已完成**:

- Analytics config 新增 `consentCopy?: AnalyticsConsentCopy`:
  - `bannerText`:覆盖 generated consent banner 的主说明文案。
  - `analyticsDescription`:覆盖 `Analytics` category 描述。
  - `privacyPolicyUrl` / `privacyPolicyLabel`:在 banner 内渲染一个 policy link。
  - 全部以纯文本 / href 输出,不支持 raw HTML。
- GUI:
  - `Require consent before tracking` 开启时,Analytics 面板显示 `Consent copy` 输入区。
  - policy URL 只允许 `http(s)` 或 root-relative 路径,拒绝 `javascript:` 等不安全 URL。
- Compiler:
  - `src/_lowcode_analytics.ts` 从 config 读取 copy override。
  - 未配置 copy 时保持默认文案和默认 preference center 行为。
- 覆盖:
  - `tests/engine/compiler/analytics.test.ts` 覆盖 branded consent copy emit。
  - `tests/engine/tools/lowcode/modify.test.ts` 覆盖 ToolDef trim 和 unsafe URL 拒绝。
  - `tests/engine/tools/lowcode/read.test.ts` 覆盖 ToolDef read。
  - `tests/engine/kiwi/lowcode/roundtrip.test.ts` 覆盖 `.fig` round-trip。

**2026-07-01 第十一刀已完成**:

- Analytics config 新增 `consentAnalyticsDefault?: boolean`:
  - 默认不写入时保持现状:generated preference center 的 `Analytics` category 初始勾选。
  - 设置为 `false` 时,没有历史偏好时 `Analytics` category 初始不勾选。
  - 已有 `localStorage` 偏好仍优先,不会被默认值覆盖。
- GUI:
  - `Require consent before tracking` 开启时,`Consent copy` 区域新增
    `Analytics checked by default` 开关。
  - 关闭该开关会持久化 `consentAnalyticsDefault:false`。
- Compiler:
  - `LowcodeAnalyticsConsentBanner` 初始化 checkbox 时读取 `consentAnalyticsDefault`。
  - 用户仍必须点击 `Save preferences` / `Accept all` / `Decline all`;该字段只控制初始
    checkbox state,不绕过 consent gate。
- 覆盖:
  - `tests/engine/compiler/analytics.test.ts` 覆盖 unchecked default runtime emit。
  - `tests/engine/tools/lowcode/modify.test.ts` / `read.test.ts` 覆盖 ToolDef 写读。
  - `tests/engine/kiwi/lowcode/roundtrip.test.ts` 覆盖 `.fig` round-trip。
  - `tests/engine/app/lowcode/onboarding-demo.test.ts` 覆盖 onboarding fixture。

**2026-07-01 第十二刀已完成**:

- Analytics config 新增 `consentRegionPreset?: 'eea'`:
  - 这是 generated app 的 opt-in starter preset,不是法律合规声明或 IAB TCF 实现。
  - `eea` preset 在未显式覆盖时等价于 `consentRequired:true` +
    `consentAnalyticsDefault:false`。
  - 显式 `consentRequired` / `consentAnalyticsDefault` 仍优先,便于作者按产品和法务要求覆盖
    preset。
- GUI:
  - Analytics 面板新增 `Consent preset` 下拉,提供 `Manual` 和
    `EEA-style opt-in starter`。
  - 选择 EEA preset 会预填 consent gate 和 unchecked Analytics category draft。
- Compiler:
  - Single-page / multi-page React adapter 都会在 effective consent required 时挂载
    `LowcodeAnalyticsConsentBanner`。
  - Runtime 新增 `effectiveConsentRequired()`,统一处理显式字段和 region preset fallback。
- 覆盖:
  - `tests/engine/compiler/analytics.test.ts` 覆盖 preset-only banner emit 和显式覆盖 preset。
  - `tests/engine/tools/lowcode/modify.test.ts` 覆盖 preset 写入和非法 preset 拒绝。
  - `tests/engine/tools/lowcode/read.test.ts` 覆盖 ToolDef read。
  - `tests/engine/kiwi/lowcode/roundtrip.test.ts` 覆盖 `.fig` round-trip。
  - `tests/engine/app/lowcode/onboarding-demo.test.ts` 覆盖 onboarding fixture。

### 10.2 风险

- CSP / privacy / cookie consent。
- 不同 provider SDK 加载方式不同。
- 不能把 analytics secret 写进 document。

### 10.3 后续

- 真实 provider ACK:分别用 GA4 / Plausible / PostHog 测一次 preview → build →
  deploy 后 dashboard 入账。
- 隐私/合规:当前已具备 DNT gate、generated-app consent API、基础 Necessary/Analytics
  preference center、本地持久化偏好、品牌化文案、Analytics category 默认状态和 EEA-style
  opt-in starter preset;后续可补 IAB TCF 或更复杂的 category policy。
- CSP/deploy:确认 Netlify / Vercel / Cloudflare 默认 CSP 或用户自定义 header 下的
  provider script allowlist。

---

## 11. Custom Code Escape Hatch

### 11.1 范围

- custom `<head>` snippets;
- custom CSS;
- custom JS module / inline script;
- per-page embed blocks。

### 11.2 风险

- XSS / sandbox / deploy provider CSP。
- preview iframe 安全边界。
- AI 生成代码的可审计性。

### 11.3 建议第一刀

子代理审计建议 Custom Code 不要和 Analytics 初始批次混做。第一刀应只做:

- document-level custom head snippets,限定 meta/link/style 这类静态标签;
- document-level custom CSS,进入生成 app 的 `index.css` 尾部;
- 不做 inline JS / external JS,直到 CSP、preview sandbox、审计 UI 和 deploy header 策略
  写清楚。

成功标准应先锁为“能补 meta/link/CSS 且 build 输出稳定”,不要一开始开放任意脚本。

**2026-06-30 第一刀已完成**:

- SceneGraph root-level 新增:
  - `lowcodeHeadMetadata?: LowcodeHeadMetadata`
  - `lowcodeCustomCss?: string`
- `lowcodeHeadMetadata` 是结构化白名单,不是 raw HTML:
  - `meta`:仅允许 `{ kind: 'name' | 'property' | 'httpEquiv', key, content }`。
  - `link`:仅允许 `{ rel, href, as?, type?, media?, crossorigin? }`。
  - `styles`:纯 CSS 片段数组,由 compiler 包成 `<style>`。
- `.fig` 持久化:
  - `lowcode/headMetadata` round-trip 受控 head metadata。
  - `lowcode/customCss` round-trip custom CSS。
  - 空值不写入,保持未使用该能力的文档输出稳定。
- ToolDef / MCP / AI:
  - `update_lowcode_node` 接受并校验 `lowcodeHeadMetadata` / `lowcodeCustomCss`。
  - 拒绝未知 head 字段、非法 `kind`、空 rel/href/key/content、非法 `crossorigin`。
  - `read_lowcode_node` 返回这两个 root-level 字段。
- Compiler / React adapter:
  - persisted root fields 会并入 `CompilerOptions.metadata`。
  - `index.html` 输出受控 `<meta>` / `<link>` / `<style>`。
  - `src/index.css` 末尾追加 `lowcodeCustomCss`,方便用户覆盖生成样式。
  - `<style>` 内容会防止 `</style>` 逃逸。
- 覆盖:
  - `tests/engine/compiler/seo-metadata.test.ts` 覆盖 head/css emit 和 style text escape。
  - `tests/engine/kiwi/lowcode/roundtrip.test.ts` 覆盖 `.fig` round-trip。
  - `tests/engine/tools/lowcode/modify.test.ts` 覆盖 ToolDef 写入与非法结构拒绝。
  - `tests/engine/tools/lowcode/read.test.ts` 覆盖 ToolDef 读取。

**2026-06-30 第二刀已完成**:

- GUI:
  - 空选择态 `Services & Workflows` 增加 `Custom head & CSS` 面板。
  - 支持结构化编辑 `meta`、`link`、head `<style>` CSS 片段和 app-level custom CSS。
  - 半填的 `meta` / `link` 行只保留为本地草稿,不会写入 root node。
  - 空内容会清成 `undefined`,避免生成空 metadata container。
  - Inspector filter 增加 `head` / `metadata` / `meta` / `link` / `custom` / `css` /
    `stylesheet` / `style` / `csp` 关键词。
- 覆盖:
  - `tests/engine/app/lowcode/custom-code-panel.test.ts` 覆盖 GUI 草稿 hydrate、trim、
    空值清理、link 可选字段和半填行 guard。
- 手动 ACK:
  - `docs/lowcode-gui-ack-test.md` 增加 Custom Head/CSS GUI checklist。

**2026-07-01 第三刀已完成**:

- `docs/lowcode-gui-ack-test.md` 增加 Custom Head/CSS CSP/deploy provider ACK 矩阵:
  - 明确 Netlify / Vercel / Cloudflare Pages 的 live URL、CSP header、
    report-only header、external link/preload、inline head style 和 app CSS 观察点。
  - 明确需要在 Network / Elements / Console 中确认的内容。
  - 明确失败时记录 provider、live URL、CSP/report-only headers、affected tag 和 exact
    console error,同时不记录真实 provider token。
- 本刀仍不执行真实 provider deploy;真实 host ACK 留给具备账号/站点/Token 的用户最后手测。

**2026-07-01 第四刀已完成**:

- Custom Head/CSS 面板新增静态 CSP 风险提示:
  - head `<style>` 会提示 inline style 可能需要 nonce/hash 或 `style-src 'unsafe-inline'`。
  - 外部 `stylesheet` link 会提示部署端 `style-src` allowlist。
  - 外部 `preload` / `preconnect` 会按 `as` 推断 `style-src`、`font-src`、`img-src`、
    `script-src` 或 `connect-src`。
  - app-level custom CSS 中的外部 `@import` / `url(...)` 会提示部署端资源指令。
- 风险提示只做发布前 warning,不阻断保存、编译或 preview;真实 CSP header 是否允许仍以
  live deploy ACK 为准。
- 覆盖:
  - `tests/engine/app/lowcode/custom-code-panel.test.ts` 覆盖 inline style、external
    stylesheet、preload font、custom CSS 外部资源和本地资源静默。

### 11.4 后续

- CSP/deploy ACK:按 `docs/lowcode-gui-ack-test.md` 的 provider matrix 验证 Netlify /
  Vercel / Cloudflare Pages 对自定义 stylesheet / preload / inline style 的默认策略。
- 安全策略:继续暂缓 inline JS / external JS,直到有审计 UI、preview sandbox 策略、provider
  header 文档和更严格的脚本来源治理。

---

## 12. Stripe / Paid App Primitives

### 12.1 问题

真实商业 app 需要 checkout、subscription、webhook、customer portal。但静态 SPA
不能安全持有 secret key,必须依赖 Supabase Edge Function 或用户自有 backend。

### 12.2 初始方向

- Stripe checkout action 只调用 server endpoint。
- Supabase Edge Function template 作为推荐后端。
- 文档明确 secret 只进 server env,不进 `.fig` / compiled SPA。

### 12.3 2026-07-01 第一刀:Stripe checkout action v1

本刀先完成静态 SPA 可安全承担的最小商业化动作:**发起 checkout session
请求并跳转**。它不试图在前端保存 Stripe secret,也不生成 Stripe SDK / webhook /
customer portal。

已完成:

- SceneGraph 新增 `StripeCheckoutAction`:
  - `kind:'stripeCheckout'`
  - `endpoint?: string`
  - `payloadEntries?: { key:string; valueExpr:string }[]`
  - `errorTarget?: string`
- `update_lowcode_node` / workflow ToolDef 支持 `stripeCheckout`:
  - `endpoint` 必须是非空安全 URL/template,和 `apiCall` 走同一 template 校验。
  - `payloadEntries` 复用 expression payload contract:key 必须是 JS identifier,
    且同一 action 内唯一;value 走表达式 parser。
  - `errorTarget` 只能是字符串;真实 docState 存在性由 GUI / compiler collect 校验。
- Compiler IR collect 支持:
  - endpoint template 表达式解析;
  - payload entry 表达式解析;
  - docState / page state 读取收集;
  - unknown identifier / missing endpoint / invalid payload warning;
  - optional `errorTarget` 写入收集。
- React adapter emit:
  - `POST` 到 `endpoint`;
  - `Content-Type: application/json`;
  - body 为 payload entry 组成的 JSON object;
  - 成功时读取 `data?.url ?? data?.checkoutUrl`;
  - checkout URL 为非空 string 时 `window.location.assign(checkoutUrl)`;
  - 失败时写入 `errorTarget`(如配置)并 `console.error("stripeCheckout failed:", err)`。
- GUI:
  - Action kind 下拉新增 `Stripe checkout`。
  - ActionRow 支持 endpoint、payload entries、error target。
  - GUI inline validation 覆盖 endpoint、payload entries、error target。
  - 面板提示 secret key 只能放作者自己的 server endpoint,不能放进 document。

明确不做:

- 不存储 Stripe secret / restricted key / webhook signing secret。
- 不把 Stripe key 写进 `.fig`、ActionDef 或 generated SPA。
- 不引入 Stripe JS SDK。
- 不生成 Supabase Edge Function 或任意后端代码。
- 不做 webhook、subscription lifecycle、customer portal、retry、idempotency 或
  server-side signature verification。
- 不加 `onSuccess` / `onError` 分支;v1 只负责 redirect 和可选 errorTarget。

测试覆盖:

- `tests/engine/compiler/stripe-checkout.test.ts`
  - collect endpoint template、payload entries、error target;
  - emit POST / JSON body / checkout URL redirect;
  - missing endpoint warning;
  - 生成代码不包含 Stripe secret 示例字符串。
- `tests/engine/tools/lowcode/modify.test.ts`
  - ToolDef 接受合法 `stripeCheckout`;
  - 拒绝空 endpoint;
  - 拒绝 malformed payload entries。
- `tests/engine/app/lowcode/action-errors.test.ts`
  - GUI validation 接受合法 endpoint template / payload;
  - 报告 endpoint、payload、errorTarget 错误。
- `tests/engine/kiwi/lowcode/roundtrip.test.ts`
  - `stripeCheckout` event 经真实 `.fig` export / parse round-trip。

手动 ACK 留到最后:

- 用一个本地或真实 backend endpoint 返回 `{ "url": "https://checkout.stripe.com/..." }`
  或 `{ "checkoutUrl": "..." }`,确认 generated app 点击按钮后跳转。
- 用 4xx/5xx 或无 URL 响应确认 `errorTarget` 写入并且页面不假装成功。
- 确认 backend endpoint 只读取公开业务参数(如 priceId / quantity),Stripe secret 只在
  server env 中存在。

### 12.4 2026-07-01 第二刀:Supabase Edge Function demo template

本刀补一个可复制的 server-side 示例,对齐 onboarding demo 的 `/api/demo-checkout`
endpoint,但仍不把后端生成纳入 compiler。

已完成:

- 新增 `packages/demos/lowcode/supabase/functions/demo-checkout/index.ts`:
  - Supabase Edge Function / Deno style `Deno.serve`。
  - 只从 environment 读取 `STRIPE_SECRET_KEY`、`PUBLIC_SITE_URL` 和
    `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_PRO` / `STRIPE_PRICE_ENTERPRISE`。
  - 接收 generated app POST 的公开 `plan` / `email` payload。
  - 调用 Stripe Checkout Sessions REST API。
  - 返回 `{ url }`,与 `stripeCheckout` action 的 redirect contract 对齐。
  - 包含 CORS preflight handling,方便本地/静态 host 调试。
- `tests/engine/app/lowcode/onboarding-demo.test.ts` 覆盖:
  - 模板文件存在;
  - 使用 env var 而非硬编码 secret;
  - 调用 `checkout/sessions`;
  - 返回 `{ url }`;
  - 不包含 `sk_test` / `sk_live`。
- `packages/docs/user-guide/lowcode-apps.md` 和
  `packages/demos/lowcode/README.md` 说明模板路径和 env vars。

明确不做:

- 不自动部署 Supabase Edge Function。
- 不生成用户项目后端目录。
- 不实现 webhook、subscription lifecycle、customer portal 或 idempotency key 管理。
- 不在 `.fig` / generated SPA 中保存任何 Stripe secret。

### 12.5 2026-07-01 第三刀:Stripe customer portal action v1

本刀补齐生成 SPA 能安全承担的 billing portal 前端触发动作:**请求作者自己的
Customer Portal endpoint 并跳转**。它仍不创建 portal session、不查 customer、不持有
Stripe secret;这些都留在 server endpoint。

已完成:

- SceneGraph 新增 `StripeCustomerPortalAction`:
  - `kind:'stripeCustomerPortal'`
  - `endpoint?: string`
  - `payloadEntries?: { key:string; valueExpr:string }[]`
  - `errorTarget?: string`
- `update_lowcode_node` / workflow ToolDef 支持 `stripeCustomerPortal`:
  - 与 `stripeCheckout` 共用 endpoint / payloadEntries / errorTarget 校验。
  - warning code 使用 `action-stripe-customer-portal-*`,不复用 checkout 诊断码。
- Compiler:
  - IR collect 解析 endpoint template 和 payload entry expressions。
  - collect 记录 docState/pageState reads,`errorTarget` 写入,并对 missing endpoint /
    invalid payload / unknown identifier 给 portal-specific warning。
  - workflow 参数 substitution 覆盖 endpoint 和 payload entry expressions。
  - React emit 对 endpoint 发起 `POST` + JSON body。
  - 成功读取 `data?.url ?? data?.portalUrl`,非空 string 时
    `window.location.assign(portalUrl)`。
  - 失败时写入 `errorTarget`(如配置)并
    `console.error("stripeCustomerPortal failed:", err)`。
- GUI:
  - Action kind 下拉新增 `Stripe customer portal`。
  - ActionRow 复用 Stripe endpoint、payload entries、error target 编辑器。
  - GUI inline validation 覆盖 endpoint、payload entries、error target。
- 测试:
  - `tests/engine/compiler/stripe-customer-portal.test.ts`
  - `tests/engine/tools/lowcode/modify.test.ts`
  - `tests/engine/app/lowcode/action-errors.test.ts`
  - `tests/engine/kiwi/lowcode/roundtrip.test.ts`

明确不做:

- 不在前端创建 portal session 或查找 Stripe customer。
- 不做 webhook、subscription lifecycle、retry 或 idempotency key 管理。
- 不存储 Stripe secret / restricted key / webhook signing secret。

手动 ACK 留到最后:

- 用一个本地或真实 backend endpoint 返回 `{ "url": "https://billing.stripe.com/..." }`
  或 `{ "portalUrl": "https://billing.stripe.com/..." }`,确认 generated app 点击按钮后跳转。
- 用 4xx/5xx 或无 URL 响应确认 `errorTarget` 写入并且页面不假装成功。
- 确认 portal endpoint 在 server-side 完成当前用户认证、customer lookup 和 session
  creation;`.fig` / generated SPA 中不出现任何 Stripe secret 或 customer private data。

### 12.6 2026-07-01 第五刀:Customer Portal Edge Function demo template

本刀补上 `stripeCustomerPortal` action 对应的 server-side 示例,但仍不把后端生成纳入
compiler。模板演示创建 Stripe Customer Portal session 的安全边界,并通过 Supabase
Auth + service role 查询 `billing_customers` 获取 server-side customer mapping。

已完成:

- 新增 `packages/demos/lowcode/supabase/functions/demo-customer-portal/index.ts`:
  - Supabase Edge Function / Deno style `Deno.serve`。
  - 只从 environment 读取 `STRIPE_SECRET_KEY`、`PUBLIC_SITE_URL`。
  - 只从 environment 读取 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`。
  - 可选读取 `STRIPE_PORTAL_CONFIGURATION`。
  - 要求 `Authorization: Bearer ...`,缺失时返回 400。
  - 调 Supabase Auth `/auth/v1/user` 验证调用者。
  - 用 service role 调 `/rest/v1/billing_customers` 查询 `stripe_customer_id`。
  - 不从浏览器请求体信任 `customerId`。
  - 调用 Stripe `POST /v1/billing_portal/sessions`。
  - 传入 `customer` 和 `return_url`。
  - 返回 `{ url }`,与 `stripeCustomerPortal` action redirect contract 对齐。
- Onboarding demo:
  - `tools/lowcode/src/make/onboarding-demo.ts` 新增 `portalError` docState。
  - 新增 `Open billing portal button`,其 onClick 包含:
    - `stripeCustomerPortal` → endpoint `/api/demo-customer-portal`,
      payload `{ returnPath:"/account" }`,`errorTarget:'portalError'`;
    - `trackEvent` → `"billing_portal_open"`。
  - 已重建 `packages/demos/lowcode/lowcode-onboarding-demo.fig`。
- 测试:
  - `tests/engine/app/lowcode/onboarding-demo.test.ts` 覆盖 portal action、compiled
    `portalUrl` redirect、模板 env/auth/customer lookup 提示和无 hardcoded secret。
- 文档:
  - `packages/demos/lowcode/README.md` 说明 portal template 路径和生产 customer lookup 边界。
  - `packages/docs/user-guide/lowcode-apps.md` 说明 demo-only portal template 和
    `url/portalUrl` redirect contract。
  - `CHANGELOG.md` 已更新。

明确不做:

- 不自动部署 Customer Portal Edge Function。
- 不生成用户项目 DB schema 或 profile/customer mapping 表。
- 不把 customer id mapping、Stripe secret 或 portal configuration 写进前端。

### 12.7 2026-07-01 第四刀:Stripe webhook/subscription lifecycle demo template

本刀补齐真实付费闭环的 server-side 入口:**接收 Stripe webhook、校验签名、路由 checkout
和 subscription lifecycle 事件**。它不进入 compiler 自动生成,也不把任何 webhook secret /
Stripe secret 写入 `.fig` 或 generated SPA。

已完成:

- 新增 `packages/demos/lowcode/supabase/functions/demo-stripe-webhook/index.ts`:
  - Supabase Edge Function / Deno style `Deno.serve`。
  - 只从 environment 读取 `STRIPE_WEBHOOK_SECRET`。
  - 只从 environment 读取 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`。
  - 读取 `Stripe-Signature` header。
  - 使用 Web Crypto `HMAC SHA-256` 校验 `t.payload` 的 `v1` signature。
  - 默认 5 分钟 timestamp tolerance。
  - 将 Stripe event 写入 Supabase REST `/billing_events`,字段包含 `stripe_event_id`、
    `event_type`、`object_id` 和完整 `payload`。
  - `billing_events.stripe_event_id` 主键冲突/HTTP 409 会返回 `duplicate`,避免 Stripe retry
    重复执行事件分支。
  - 支持 `checkout.session.completed`。
  - 支持 `customer.subscription.created` / `updated` / `deleted`。
  - 未识别事件返回 `{ received:true, result:'ignored' }`,保持 webhook retry 友好。
  - 签名失败、缺少 event id、无效 JSON 等返回 400。
  - 注释明确生产扩展 orders/subscriptions 表更新时应优先用数据库 RPC/事务把 event insert
    和业务更新包起来。
- 测试:
  - `tests/engine/app/lowcode/onboarding-demo.test.ts` 确认模板存在、读取 env secret、
    校验 `Stripe-Signature`、覆盖 checkout/subscription 事件、写入 `billing_events`、
    用 HTTP 409 识别 duplicate,且不包含 `sk_test` / `sk_live` / webhook secret 示例字符串。
- 文档:
  - `packages/demos/lowcode/README.md` 说明 webhook template 路径和 Stripe dashboard 注册。
  - `packages/docs/user-guide/lowcode-apps.md` 说明 webhook template 使用 `billing_events`
    durable idempotency,生产扩展 subscription/order updates 时应保持事务语义。
  - `CHANGELOG.md` 已更新。

明确不做:

- 不自动部署 webhook endpoint。
- 不生成用户项目 DB schema。
- 不处理真实订单/订阅表更新;模板只记录 webhook event 并给出扩展事务边界。
- 不把 `STRIPE_WEBHOOK_SECRET` / `STRIPE_SECRET_KEY` 写进前端或文档 fixture。

手动 ACK 留到最后:

- 用 Stripe CLI 或 dashboard test webhook 命中部署后的 endpoint。
- 确认合法签名返回 200,错误签名返回 400。
- 确认 `checkout.session.completed` 和 `customer.subscription.*` 事件被路由到预期分支。
- 确认重复发送同一个 Stripe event id 时返回 `duplicate`,且 `billing_events` 只保留一条记录。
- 如果在生产里扩展订单/订阅表更新,确认 event 记录和业务更新通过 RPC/事务保持一致。

### 12.8 2026-07-01 第六刀:Durable billing schema template

本刀把 webhook/customer portal 模板中的“生产需持久化”从文字提醒补成可复制的
Supabase SQL 起点。它仍不自动部署、不写入 generated SPA、不保存任何 Stripe secret。

已完成:

- 新增 `packages/demos/lowcode/supabase/schema/billing.sql`:
  - `billing_customers`
    - `user_id uuid primary key references auth.users(id)`
    - `stripe_customer_id text not null unique`
    - client-side authenticated 用户只能 select 自己的映射。
  - `billing_subscriptions`
    - `stripe_subscription_id text primary key`
    - `user_id`
    - `stripe_customer_id`
    - `status`
    - `current_period_end`
    - `cancel_at_period_end`
    - `plan`
    - `metadata`
    - client-side authenticated 用户只能 select 自己的订阅。
  - `billing_events`
    - `stripe_event_id text primary key`,作为 webhook durable idempotency guard。
    - `event_type`
    - `object_id`
    - `processed_at`
    - `payload`
    - 不创建 client-facing policy;只给 server-side webhook/service role 写入。
  - 基础索引和 RLS 开启。
- 模板引用:
  - `demo-stripe-webhook/index.ts` 的 production note 指向
    `supabase/schema/billing.sql`。
  - `demo-customer-portal/index.ts` 的 customer mapping note 指向
    `supabase/schema/billing.sql`。
- 测试:
  - `tests/engine/app/lowcode/onboarding-demo.test.ts` 覆盖 SQL 文件存在、三张表、
    event id primary key、RLS policies、service role 提示,且不包含 `sk_test` /
    `sk_live` / `whsec_`。
- 文档:
  - `packages/demos/lowcode/README.md` 和
    `packages/docs/user-guide/lowcode-apps.md` 说明 schema 路径和用途。

明确不做:

- 不自动 apply SQL。
- 不生成用户项目 migration。
- 不承诺完整 SaaS 账务模型;这里只是 customer/subscription/event 起点。
- 不把 service role key 或 Stripe secret 写入任何前端文件。

### 12.9 2026-07-01 第七刀:Subscription webhook RPC transaction template

本刀把上一刀的“生产扩展 orders/subscriptions 表更新时应优先用数据库 RPC/事务”补成可复制
的最小 RPC 起点。它仍不生成完整 SaaS 账务系统,只覆盖 Stripe subscription lifecycle 的
event + subscription upsert 事务。

已完成:

- `packages/demos/lowcode/supabase/schema/billing.sql` 新增
  `public.record_stripe_subscription_event(...)`:
  - `security definer` + `set search_path = public`。
  - 先检查 `billing_events.stripe_event_id`,重复 event 返回 `duplicate`。
  - 要求 `billing_customers` 已有 `stripe_customer_id -> user_id` 映射,否则抛错让 webhook
    retry/报警,避免把未知 customer 写成孤儿 subscription。
  - 在同一函数事务中插入 `billing_events`,并 upsert `billing_subscriptions`。
  - `billing_subscriptions` 冲突时更新 `status`、`current_period_end`、
    `cancel_at_period_end`、`plan`、`metadata` 和 `updated_at`。
  - `revoke all` from `public` / `anon` / `authenticated`,预期只由 service-role Edge
    Function 调用。
- `demo-stripe-webhook/index.ts` 更新:
  - `checkout.session.completed` 和 ignored events 继续走普通 `billing_events` insert。
  - `customer.subscription.created` / `updated` / `deleted` 改为调用
    `/rest/v1/rpc/record_stripe_subscription_event`。
  - RPC 返回 `duplicate` 时直接返回 webhook result `duplicate`,不重复执行事件分支。
  - Stripe `current_period_end` 从 unix seconds 转 ISO timestamptz 参数。
- 测试:
  - `tests/engine/app/lowcode/onboarding-demo.test.ts` 覆盖 webhook RPC endpoint、subscription
    参数映射、schema RPC、`security definer`、subscription upsert、duplicate/recorded 返回和
    function 权限 revoke。
- 文档:
  - `packages/demos/lowcode/README.md` 和
    `packages/docs/user-guide/lowcode-apps.md` 说明 schema 已包含 subscription RPC 起点。

明确不做:

- 不创建 `billing_customers` 映射;checkout/customer 创建逻辑仍由作者后端按产品流程处理。
- 不建 orders/invoices/payments/entitlements 表。
- 不自动部署 Edge Function 或自动 apply SQL。
- 不把 service role key 或 Stripe secret 写入前端、`.fig` 或 generated source。

### 12.10 2026-07-01 第八刀:Checkout customer mapping template

本刀补上 subscription RPC 所依赖的 customer mapping 起点:**checkout Edge Function 在登录用户
场景下创建/复用 Stripe Customer,并写入 `billing_customers`**。匿名 demo 调用仍保留原来的
`customer_email` fallback,方便本地演示。

已完成:

- `packages/demos/lowcode/supabase/functions/demo-checkout/index.ts` 更新:
  - 可选读取 `Authorization: Bearer ...`。
  - 有 bearer token 时,用 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 调 Supabase Auth
    `/auth/v1/user` 验证当前用户。
  - 查询 `/rest/v1/billing_customers` 复用既有 `stripe_customer_id`。
  - 无映射时调用 Stripe `POST /v1/customers` 创建 customer。
  - 用 service role upsert `billing_customers?on_conflict=user_id`,保存
    `user_id`、`stripe_customer_id` 和 email。
  - 创建 Checkout Session 时,登录用户传 `customer`;匿名 demo fallback 仍传
    `customer_email`。
  - 新增 `STRIPE_CHECKOUT_MODE=payment|subscription`,默认 `subscription`,用于和
    subscription webhook / portal / `billing_subscriptions` demo 闭环对齐;一次性付款可显式切回
    `payment`。
- 测试:
  - `tests/engine/app/lowcode/onboarding-demo.test.ts` 覆盖 checkout template 的 Supabase env、
    Auth 验证、customer lookup、Stripe customer creation、`billing_customers` upsert、
    checkout `customer` / `customer_email` 分支和 checkout mode override。
- 文档:
  - `packages/demos/lowcode/README.md` 和
    `packages/docs/user-guide/lowcode-apps.md` 说明 authenticated checkout customer mapping。

明确不做:

- 不要求 generated demo 必须登录;无 bearer token 时仍允许匿名 email checkout。
- 不自动创建 orders、invoices 或 payments 表。
- 不把 service role key、Stripe secret 或 Stripe customer id 写入 `.fig` / generated SPA。

### 12.11 2026-07-01 第九刀:Billing entitlement read model template

本刀补一个 generated app 可直接查询的最小 entitlement read model,让付费闭环从
checkout/customer mapping → subscription webhook → app-readable entitlement 更完整。它仍只是 demo
schema 起点,不是完整套餐权限系统。

已完成:

- `packages/demos/lowcode/supabase/schema/billing.sql` 新增 `billing_entitlements`:
  - `user_id uuid primary key references auth.users(id)`。
  - `active boolean not null default false`。
  - `plan`、`status`、`stripe_subscription_id`、`current_period_end`、`metadata`、`updated_at`。
  - `billing_entitlements_active_idx` 方便后台筛选 active entitlement。
  - RLS enabled,authenticated 用户只能 select 自己的 entitlement。
- `record_stripe_subscription_event(...)` 更新:
  - 在同一 service-role RPC 事务里,继 `billing_events` insert 和 `billing_subscriptions` upsert
    后继续 upsert `billing_entitlements`。
  - `status in ('active','trialing')` 时 entitlement `active=true`,其它状态为 false。
  - `plan`、`status`、`stripe_subscription_id`、`current_period_end`、`metadata` 跟随最新
    subscription event 刷新。
- 测试:
  - `tests/engine/app/lowcode/onboarding-demo.test.ts` 覆盖 entitlement table、active default、
    RPC entitlement insert、active/trialing 判断、user_id upsert 和 RLS select-own policy。
- 文档:
  - `packages/demos/lowcode/README.md` 和
    `packages/docs/user-guide/lowcode-apps.md` 说明 schema 已包含 app-readable entitlement 起点。

明确不做:

- 不定义多 entitlement / feature flag / usage quota 模型。
- 不自动把 generated app 页面绑定到 `billing_entitlements`;作者仍需按产品页面选择 Supabase query。
- 不创建 orders/payments/refunds 表。

### 12.12 2026-07-01 第十刀:Billing invoice read model template

本刀补一个最小 invoice/payment read model,让 Stripe invoice webhook 能落到 Supabase,供 generated
app 或后台页面查询账单历史。它仍不处理税务、退款、usage-based billing 或完整订单模型。

已完成:

- `packages/demos/lowcode/supabase/schema/billing.sql` 新增 `billing_invoices`:
  - `stripe_invoice_id text primary key`。
  - `user_id`、`stripe_customer_id`、`stripe_subscription_id`。
  - `status`、`paid`、`amount_due`、`amount_paid`、`currency`。
  - `hosted_invoice_url`、`invoice_pdf`、`period_start`、`period_end`、`metadata`、`updated_at`。
  - `billing_invoices_user_id_idx` 和 `billing_invoices_customer_idx`。
  - RLS enabled,authenticated 用户只能 select 自己的 invoices。
- `packages/demos/lowcode/supabase/schema/billing.sql` 新增
  `public.record_stripe_invoice_event(...)`:
  - `security definer` + `set search_path = public`。
  - 先检查 `billing_events.stripe_event_id`,重复 event 返回 `duplicate`。
  - 要求 `billing_customers` 已有 `stripe_customer_id -> user_id` 映射。
  - 同一事务中插入 `billing_events` 并 upsert `billing_invoices`。
  - `revoke all` from `public` / `anon` / `authenticated`,预期只由 service-role Edge Function
    调用。
- `demo-stripe-webhook/index.ts` 更新:
  - 支持 `invoice.paid` 和 `invoice.payment_failed`。
  - 调用 `/rest/v1/rpc/record_stripe_invoice_event`。
  - 记录 `amount_due` / `amount_paid` / `currency` / hosted invoice URL / invoice PDF /
    billing period 等 read-model 字段。
- 测试:
  - `tests/engine/app/lowcode/onboarding-demo.test.ts` 覆盖 invoice webhook event、RPC endpoint、
    invoice 参数映射、schema table、RPC、upsert 和 RLS policy。
- 文档:
  - `packages/demos/lowcode/README.md` 和
    `packages/docs/user-guide/lowcode-apps.md` 说明 invoice read model 起点。

明确不做:

- 不创建 orders/tax/usage records 表。
- 不自动把 generated app 页面绑定到 `billing_invoices`;作者仍需按产品页面选择 Supabase query。
- 不处理 Stripe invoice 全量字段;只保留 demo/read-model 所需最小字段。

### 12.13 2026-07-01 第十一刀:Billing payment/refund read model template

本刀补 payment/refund read model,让 Stripe payment intent 和 charge refund webhook 能落到
Supabase,供 generated app 或后台页面查询付款/退款历史。它仍不做争议、税务、usage-based billing
或完整订单状态机。

已完成:

- `packages/demos/lowcode/supabase/schema/billing.sql` 新增 `billing_payments`:
  - `stripe_payment_intent_id text primary key`。
  - `user_id`、`stripe_customer_id`、`status`、`amount`、`currency`。
  - `latest_charge_id`、`receipt_email`、`metadata`、`updated_at`。
  - `billing_payments_user_id_idx` / `billing_payments_customer_idx`。
  - RLS enabled,authenticated 用户只能 select 自己的 payments。
- `packages/demos/lowcode/supabase/schema/billing.sql` 新增 `billing_refunds`:
  - `stripe_charge_id text primary key`。
  - `user_id`、`stripe_customer_id`、`stripe_payment_intent_id`。
  - `refunded`、`amount`、`amount_refunded`、`currency`、`receipt_url`、`metadata`、`updated_at`。
  - `billing_refunds_user_id_idx` / `billing_refunds_customer_idx`。
  - RLS enabled,authenticated 用户只能 select 自己的 refunds。
- 新增 `public.record_stripe_payment_event(...)` 和 `public.record_stripe_refund_event(...)`:
  - `security definer` + `set search_path = public`。
  - 先检查 `billing_events.stripe_event_id`,重复 event 返回 `duplicate`。
  - 要求 `billing_customers` 已有 `stripe_customer_id -> user_id` 映射。
  - 同一事务中插入 `billing_events` 并 upsert 对应 read-model 表。
  - `revoke all` from `public` / `anon` / `authenticated`,预期只由 service-role Edge Function
    调用。
- `demo-stripe-webhook/index.ts` 更新:
  - 支持 `payment_intent.succeeded` / `payment_intent.payment_failed`。
  - 支持 `charge.refunded`。
  - 调用 `/rest/v1/rpc/record_stripe_payment_event` 和
    `/rest/v1/rpc/record_stripe_refund_event`。
- 测试:
  - `tests/engine/app/lowcode/onboarding-demo.test.ts` 覆盖 payment/refund webhook events、
    RPC endpoints、参数映射、schema tables、RPCs、upsert 和 RLS policies。
- 文档:
  - `packages/demos/lowcode/README.md` 和
    `packages/docs/user-guide/lowcode-apps.md` 说明 payment/refund read model 起点。

明确不做:

- 不创建 tax/disputes/usage records 表。
- 不自动把 generated app 页面绑定到 `billing_payments` / `billing_refunds`;作者仍需按产品页面选择
  Supabase query。
- 不处理 Stripe PaymentIntent/Charge 全量字段;只保留 demo/read-model 所需最小字段。

### 12.14 2026-07-01 第十二刀:Billing orders read model template

本刀补一个最小 order read model,把 invoice/payment/refund 事件汇总到 `billing_orders`,方便
generated app 或后台页面按用户查询订单视角。它仍不做发货、税务、争议、usage 或复杂订单状态机。

已完成:

- `packages/demos/lowcode/supabase/schema/billing.sql` 新增 `billing_orders`:
  - `order_key text primary key`,由 `invoice:<id>` / `payment:<id>` / `charge:<id>` 组成。
  - `user_id`、`stripe_customer_id`、`stripe_subscription_id`、`stripe_invoice_id`、
    `stripe_payment_intent_id`、`stripe_charge_id`。
  - `status`、`fulfillment_status`、`amount_total`、`amount_paid`、`amount_refunded`、
    `currency`、`plan`、`metadata`、`updated_at`。
  - `billing_orders_user_id_idx` / `billing_orders_customer_idx`。
  - RLS enabled,authenticated 用户只能 select 自己的 orders。
- `record_stripe_invoice_event(...)` 更新:
  - upsert `billing_invoices` 后,同步 upsert `billing_orders` 的 `invoice:<invoice_id>` row。
- `record_stripe_payment_event(...)` 更新:
  - upsert `billing_payments` 后,同步 upsert `billing_orders` 的
    `payment:<payment_intent_id>` row。
- `record_stripe_refund_event(...)` 更新:
  - upsert `billing_refunds` 后,优先更新 `payment:<payment_intent_id>` order row;缺少 payment
    intent 时 fallback 到 `charge:<charge_id>`。
- 测试:
  - `tests/engine/app/lowcode/onboarding-demo.test.ts` 覆盖 `billing_orders` table、order keys、
    invoice/payment/refund RPC 写入、`on conflict (order_key)` upsert 和 RLS policy。
- 文档:
  - `packages/demos/lowcode/README.md` 和
    `packages/docs/user-guide/lowcode-apps.md` 说明 order read model 起点。

明确不做:

- 不实现发货、履约工作流、税务、争议、usage records 或完整订单状态机。
- 不自动把 generated app 页面绑定到 `billing_orders`;作者仍需按产品页面选择 Supabase query。
- 不把 `billing_orders` 作为真实账务总账;它只是 demo/read-model 汇总视图。

### 12.15 2026-07-01 第十三刀:Stripe webhook out-of-order read-model hardening

本刀修补真实 Stripe 环境里的一个顺序假设:Stripe webhook 不保证事件按 subscription →
invoice → payment → refund 顺序送达。读模型应该能先记录自己收到的事件,再由后续事件补齐
关联视图,而不是因为跨事件外键缺失直接失败。

已完成:

- `packages/demos/lowcode/supabase/schema/billing.sql` 顶部补充 webhook 乱序说明。
- `billing_invoices.stripe_subscription_id` 改为普通 `text`,不再引用
  `billing_subscriptions(stripe_subscription_id)`。
- `billing_refunds.stripe_payment_intent_id` 改为普通 `text`,不再引用
  `billing_payments(stripe_payment_intent_id)`。
- `billing_orders` 已经使用普通 Stripe id 文本字段,保持不变。
- 测试:
  - `tests/engine/app/lowcode/onboarding-demo.test.ts` 覆盖乱序注释,并断言 invoice/refund
    表片段不会重新引入对应跨事件 foreign key。
- 文档:
  - `packages/demos/lowcode/README.md` 和
    `packages/docs/user-guide/lowcode-apps.md` 说明 schema 有意让跨事件 read-model id
    tolerant to out-of-order delivery。

明确不做:

- 不取消 `billing_customers` 映射约束;webhook 仍需要先能把 Stripe customer 映射回 Supabase user。
- 不实现异步 backfill job;后续事件到达时由现有 RPC/upsert 刷新对应 read model。
- 不把 demo schema 升级成完整账务 ledger。

### 12.16 2026-07-01 第十四刀:Billing dispute read model template

本刀补 Stripe dispute/read-model 起点,让拒付/争议事件进入 Supabase 可查询状态。它只记录
dispute 状态、金额、原因和 evidence due date,不实现证据提交、申诉工作流或完整风控后台。

已完成:

- `packages/demos/lowcode/supabase/schema/billing.sql` 新增 `billing_disputes`:
  - `stripe_dispute_id text primary key`。
  - `user_id`、`stripe_customer_id`、`stripe_charge_id`、`stripe_payment_intent_id`。
  - `status`、`reason`、`amount`、`currency`、`disputed_at`、`evidence_due_by`、
    `metadata`、`updated_at`。
  - `billing_disputes_user_id_idx` / `billing_disputes_customer_idx` /
    `billing_disputes_status_idx`。
  - RLS enabled,authenticated 用户只能 select 自己的 disputes。
- 新增 `public.record_stripe_dispute_event(...)`:
  - 同一事务中插入 `billing_events` 并 upsert `billing_disputes`。
  - 尝试从 `billing_orders`、`billing_refunds`、`billing_payments` 反查 `user_id` /
    `stripe_customer_id`。
  - 如果 dispute 先于本地 charge/payment/order 映射到达,仍记录 dispute row;用户侧 RLS
    会等后续映射/自定义 backfill 后才可见。
- `packages/demos/lowcode/supabase/functions/demo-stripe-webhook/index.ts` 更新:
  - 支持 `charge.dispute.created`、`charge.dispute.updated`、`charge.dispute.closed`。
  - 调用 `/rest/v1/rpc/record_stripe_dispute_event`。
  - 记录 dispute id、charge id、payment intent id、status、reason、amount、currency、
    created time 和 evidence due date。
- 测试:
  - `tests/engine/app/lowcode/onboarding-demo.test.ts` 覆盖 dispute webhook events、RPC
    endpoint、参数映射、schema table、RPC、upsert 和 RLS policy。
- 文档:
  - `packages/demos/lowcode/README.md` 和
    `packages/docs/user-guide/lowcode-apps.md` 说明 dispute read model 起点。

明确不做:

- 不提交 dispute evidence,不调用 Stripe dispute update/close API。
- 不实现风控、通知、发货暂停或内部工单状态机。
- 不自动把 generated app 页面绑定到 `billing_disputes`;作者仍需按产品页面选择 Supabase query。

### 12.17 2026-07-01 第十五刀:Billing tax summary read model template

本刀补最小 tax summary read model,让 Stripe invoice webhook 中的 automatic tax 和
`total_taxes` 聚合进入 Supabase。它服务于订单/发票详情展示和后续报表起点,不做税务申报、
jurisdiction 归集或税务供应商结算。

已完成:

- `packages/demos/lowcode/supabase/schema/billing.sql` 新增 `billing_tax_summaries`:
  - `stripe_invoice_id text primary key`,并引用 `billing_invoices(stripe_invoice_id)`。
  - `user_id`、`stripe_customer_id`。
  - `automatic_tax_enabled`、`automatic_tax_status`、`automatic_tax_provider`。
  - `tax_amount`、`currency`、`total_taxes jsonb`、`updated_at`。
  - `billing_tax_summaries_user_id_idx` / `billing_tax_summaries_customer_idx`。
  - RLS enabled,authenticated 用户只能 select 自己的 tax summary rows。
- `record_stripe_invoice_event(...)` 更新:
  - 在 upsert `billing_invoices` 后,同一事务 upsert `billing_tax_summaries`。
  - 保留 Stripe invoice `total_taxes` 原始 JSON,并额外存 `tax_amount` 便于列表查询。
- `packages/demos/lowcode/supabase/functions/demo-stripe-webhook/index.ts` 更新:
  - `Invoice` 接口覆盖 `automatic_tax` 和 `total_taxes`。
  - `sumInvoiceTaxAmount()` 从 `total_taxes[].amount` 计算 tax summary amount。
  - invoice RPC payload 传递 automatic tax 状态、provider、tax amount 和 `total_taxes`。
- 测试:
  - `tests/engine/app/lowcode/onboarding-demo.test.ts` 覆盖 invoice tax 参数映射、tax summary
    table、RPC 写入和 RLS policy。
- 文档:
  - `packages/demos/lowcode/README.md` 和
    `packages/docs/user-guide/lowcode-apps.md` 说明 tax summary read model 起点。

明确不做:

- 不实现税务申报、税区报表、税务供应商 settlement 或会计总账。
- 不展开 `total_taxes` 为逐 jurisdiction 行;需要时可基于保留的 JSON 后续派生。
- 不自动把 generated app 页面绑定到 `billing_tax_summaries`;作者仍需按产品页面选择 Supabase
  query。

### 12.18 2026-07-01 第十六刀:Billing usage summary read model template

本刀补 invoice line 级 usage summary read model,把 Stripe invoice webhook 中随 invoice 一起返回的
line item 用量/数量快照落到 Supabase。它用于账单详情和用量账单可视化起点,不做 Meter Events
上报、实时计量或 Stripe usage record 写入。

已完成:

- `packages/demos/lowcode/supabase/schema/billing.sql` 新增 `billing_usage_summaries`:
  - `stripe_invoice_line_id text primary key`。
  - `stripe_invoice_id` 引用 `billing_invoices(stripe_invoice_id)`。
  - `user_id`、`stripe_customer_id`、`stripe_subscription_id`、`stripe_subscription_item_id`。
  - `stripe_price_id`、`stripe_product_id`、`quantity_decimal`、`amount`、`currency`。
  - `period_start`、`period_end`、`description`、`metadata`、`raw_line`、`updated_at`。
  - `billing_usage_summaries_user_id_idx` / `billing_usage_summaries_customer_idx` /
    `billing_usage_summaries_invoice_idx`。
  - RLS enabled,authenticated 用户只能 select 自己的 usage rows。
- `record_stripe_invoice_event(...)` 更新:
  - 新增 `p_usage_lines jsonb` 参数。
  - 在 upsert `billing_tax_summaries` 后,同一事务从 `jsonb_array_elements(p_usage_lines)`
    upsert `billing_usage_summaries`。
- `packages/demos/lowcode/supabase/functions/demo-stripe-webhook/index.ts` 更新:
  - `Invoice` 接口覆盖 `lines.data`。
  - 新增 `InvoiceLineItem` 和 `invoiceUsageLines()`。
  - usage payload 保留 line id、subscription item、price/product、quantity decimal、period、
    amount/currency、metadata 和 raw line。
- 测试:
  - `tests/engine/app/lowcode/onboarding-demo.test.ts` 覆盖 invoice usage 参数映射、usage
    summary table、RPC 写入和 RLS policy。
- 文档:
  - `packages/demos/lowcode/README.md` 和
    `packages/docs/user-guide/lowcode-apps.md` 说明 usage summary read model 起点。

明确不做:

- 不调用 Stripe Meter Events / Usage Records API。
- 不在 demo webhook 里自动分页拉取完整 invoice lines;生产 invoice 可能超过 webhook payload
  内置 line 快照时,需要在 server-side endpoint 里补拉 Stripe invoice lines 后再视为完整。
- 不实现实时计量、配额扣减、用量告警或账单预测。
- 不自动把 generated app 页面绑定到 `billing_usage_summaries`;作者仍需按产品页面选择 Supabase
  query。

### 12.19 2026-07-01 第十七刀:Phase 5 operator ACK checklist

本刀把前面分散在 Analytics、Custom Head/CSS、Onboarding demo、Stripe paid actions 和 billing
webhook 小节里的手动验证,整理成一张上线前 operator checklist。它不新增 runtime/schema 能力,
但把需要真实账号、真实部署或人工观察的验证集中到可执行顺序里。

已完成:

- `docs/lowcode-gui-ack-test.md` 新增 `Phase 5 Operator ACK`:
  - Preflight 覆盖 git 状态、schema apply、Edge Function 部署和 server env keep-out。
  - Analytics 覆盖真实 provider script、dashboard 入账、consent gate 和 DNT。
  - Custom Head/CSS 覆盖 deployed HTML/CSS、CSP/report-only header 和 console 结果。
  - Onboarding demo 覆盖 desktop app 打开、validation、Supabase query、workflow、i18n、
    shadcn/ui、analytics consent copy 和 secret absence。
  - Stripe paid actions 覆盖 checkout/customer portal 匿名与登录路径、server-side customer
    mapping、错误写入 state target。
  - Stripe webhook 覆盖 checkout、subscription、invoice、tax summary、usage summary、
    payment、refund、dispute、out-of-order delivery、duplicate idempotency、bad signature 和
    RLS。
  - Operator pass/fail criteria 明确只记录安全事实,不记录 secret/customer private data。
- Closeout 小节同步要求把 operator ACK 结果写回 Phase 5 doc / changelog / prompt。

明确不做:

- 不执行真实 provider ACK;真实账号、真实 Stripe/Supabase project 和部署 URL 留给用户最后测试。
- 不把 secret/token 写进仓库或 handoff。
- 不把 operator checklist 变成自动化脚本;它是最后人工/真实服务验证入口。

### 12.20 2026-07-01 第十八刀:Phase 5 pre-stage audit

本刀不新增 runtime 能力,而是把当前 Phase 5 §10/§11/§12 大批量变更收束到可提交状态前的
自动审计。目标是确认文档声称的 demo/template/schema/test 文件在工作树里真实存在,并把
最后需要用户真实账号验证的项目留在 operator ACK。

已完成:

- 使用 `gpt-5.3-codex-spark` 子代理做只读收口审计;旧子代理线程已回收后重新派发,主线程未
  把阻塞性实现委托出去。
- 核对当前工作树存在:
  - `packages/demos/lowcode/lowcode-onboarding-demo.fig`
  - `packages/demos/lowcode/supabase/functions/demo-checkout/index.ts`
  - `packages/demos/lowcode/supabase/functions/demo-customer-portal/index.ts`
  - `packages/demos/lowcode/supabase/functions/demo-stripe-webhook/index.ts`
  - `packages/demos/lowcode/supabase/schema/billing.sql`
  - `tests/engine/app/lowcode/action-errors.test.ts`
  - `tests/engine/app/lowcode/custom-code-panel.test.ts`
  - `tests/engine/app/lowcode/onboarding-demo.test.ts`
  - `tests/engine/compiler/analytics.test.ts`
  - `tests/engine/compiler/stripe-checkout.test.ts`
  - `tests/engine/compiler/stripe-customer-portal.test.ts`
- 重新跑 focused gate:
  - `bun test tests/engine/app/lowcode/onboarding-demo.test.ts`
  - `bun test tests/engine/compiler/stripe-checkout.test.ts tests/engine/compiler/stripe-customer-portal.test.ts tests/engine/compiler/analytics.test.ts tests/engine/app/lowcode/action-errors.test.ts tests/engine/app/lowcode/custom-code-panel.test.ts`
  - `bun test tests/engine/kiwi/lowcode/roundtrip.test.ts tests/engine/tools/lowcode/modify.test.ts tests/engine/tools/lowcode/read.test.ts tests/engine/compiler/seo-metadata.test.ts`
- 重新跑收口 hygiene:
  - `git diff --check`
  - `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- 当前最稳的下一步不是继续扩大功能面,而是 operator ACK 或显式 stage/review 当前 diff。

提交前 keep-out:

- 不提交 `.codegraph/`。
- 不提交 `prompt.md`。
- 不用 `git add -A`;按文件显式 stage 当前 Phase 5 相关路径。

明确不做:

- 不执行真实 provider/Stripe/Supabase ACK。
- 不把 inline JS / external JS escape hatch 提前并入当前批次。
- 不把 Analytics IAB TCF、多分类 policy 或更复杂 preference center 混进当前收口。

---

## 13. Workflow DAG Editor

当前 workflow runtime/action chain 已可表达大多数业务流程。DAG editor 是 authoring
体验升级,不是 runtime 必需。进入前先评估:

- 是否真的需要 graph,还是当前递归 editor + named workflow 足够;
- DAG 到 ActionDef chain 的序列化规则;
- cycle detection / branching / join semantics;
- UI complexity 与 Tauri/browser E2E 成本。

### 13.1 2026-07-01 第一刀:Workflow graph diagnostics

本刀不做拖拽式 DAG editor,先补 authoring 诊断视图。它复用现有 `WorkflowDef.actions`
和 `callWorkflow.workflowId` 关系,帮助作者在进入图编辑前看清工作流调用图。

已完成:

- 新增 `src/app/lowcode/workflow-graph.ts`:
  - 统计 workflow 数、嵌套 action 数和 `callWorkflow` 边数。
  - 为每个 workflow 汇总 incoming / outgoing 边和本 workflow 相关 issue。
  - 递归扫描 `condition` / `confirm` 分支,以及 `apiCall` / `supabaseQuery` /
    `supabaseMutation` 的 `onSuccess` / `onError` 分支。
  - 发现 missing workflow references。
  - 发现直接和间接 cycle,且同一个 cycle 只报告一次。
- `WorkflowsPanel` 在已有链式编辑器上方显示只读 graph summary:
  - 总 workflow / action / call 数。
  - “No workflow graph issues” 或具体 missing/cycle issue。
  - 每个 workflow 的 in/out/action 摘要。
- 保持 runtime/compiler 语义不变:
  - `callWorkflow` 仍由 compiler inline 展开。
  - cycle/unknown workflow 的 compile-time warning/drop 行为不变。
  - 不新增 schema 字段或 emitted runtime surface。
- 覆盖:
  - `tests/engine/app/lowcode/workflow-graph.test.ts` 覆盖嵌套分支统计、missing reference、
    direct/indirect cycle。

已验证:

- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun test tests/engine/compiler/call-workflow.test.ts tests/engine/compiler/ir/collect/workflow.test.ts`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `git diff --check`

明确不做:

- 不做拖拽节点/连线编辑器。
- 不改变 `WorkflowDef` / `ActionDef` schema。
- 不改变 compile-time inline/cycle warning 行为。
- 不新增 E2E;本刀为纯 helper + 轻量 panel summary,后续若加点击定位/折叠图视图再补 UI E2E。

### 13.2 2026-07-01 第二刀:Workflow graph jump targets

本刀继续保持只读诊断视图,补上从 summary/issue 回到链式 workflow editor 的定位能力。

已完成:

- `WorkflowGraphIssue` 新增 `targetWorkflowId`:
  - missing workflow reference 定位到发起调用的 workflow。
  - cycle issue 定位到 cycle path 的第一个 workflow。
- `WorkflowRow` 通过 Vue template ref 暴露 `focusRow()`:
  - 调用时滚动到 row,并把 focus 放到 row root。
  - 遵守 Vue 结构 lint,不在组件里使用 `document.querySelector`。
- `WorkflowsPanel`:
  - issue 行增加 `Jump` 按钮。
  - 每个 workflow graph node 摘要增加 `Jump` 按钮。
  - 使用组件 refs 定位,不改变 workflow 数据。
- 覆盖:
  - `tests/engine/app/lowcode/workflow-graph.test.ts` 覆盖 missing/cycle 的
    `targetWorkflowId`。

已验证:

- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun test tests/engine/compiler/call-workflow.test.ts tests/engine/compiler/ir/collect/workflow.test.ts`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `git diff --check`

明确不做:

- 不做折叠式图视图或画布图布局。
- 不做从 event action row 反向跳转到 workflow graph。
- 不新增 E2E;后续如果继续做点击定位/折叠状态/图交互,再补对应 UI E2E。

### 13.3 2026-07-01 第三刀:Workflow graph collapsible details

本刀继续把 workflow graph 保持为只读诊断 UI,补上局部展开/收起,避免 workflow 很多时详情列表
挤占整个 lowcode 面板。

已完成:

- `WorkflowsPanel` graph summary 常驻显示:
  - workflow / action / call 总数。
  - issue 列表仍常驻显示,避免隐藏 missing/cycle 风险。
- 每个 workflow 的 in/out/action 详情改为本地展开态:
  - 默认收起,只保留摘要和 issue。
  - `Show details` / `Hide details` 只影响当前组件本地状态。
  - 不写入 `SceneGraph`、不进 `.fig`、不跨 tab 持久化。
- 保留第二刀的 `Jump` 能力;展开后每个 workflow node 摘要仍可跳转到对应 row。

已验证:

- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun test tests/engine/compiler/call-workflow.test.ts tests/engine/compiler/ir/collect/workflow.test.ts`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `git diff --check`

明确不做:

- 不改 `workflow-graph.ts` 分析算法。
- 不改 workflow schema / ToolDef / compiler。
- 不新增本地存储或跨 session 折叠状态。
- 不做真正的图布局、拖拽或连线编辑。

### 13.4 2026-07-01 第四刀:Workflow graph UI regression

本刀不新增产品行为,只把第二/第三刀的可见 UI 行为固定到 targeted Playwright 回归里。

已完成:

- `tests/e2e/properties/workflow-optional-params.spec.ts` 增加 workflow graph 回归:
  - 构造两个 workflow,其中一个调用存在的 workflow,同时调用一个 missing workflow。
  - 验证 summary 显示 `2 workflows, 3 actions, 2 calls`。
  - 验证 missing workflow issue 常驻可见。
  - 验证 graph node details 默认收起。
  - 点击 `Show details` 后显示每个 workflow 的 in/out/action 摘要。
  - 点击 issue `Jump` 后 focus 到发起调用的 workflow row。
  - 点击 `Hide details` 后 node details 再次收起。

已验证:

- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (需本地端口监听权限;沙箱内首次因 `listen EPERM ::1:1420` 失败,升级权限后通过)
- `bunx tsgo --noEmit`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `git diff --check`

明确不做:

- 不新增全量 Playwright 回归。
- 不把只读 graph summary 升级为可编辑 DAG。
- 不改变 workflow compiler/IR 行为。

### 13.5 2026-07-01 第五刀:Workflow graph event entrypoints

本刀继续保持 workflow graph 为只读诊断 UI,补上页面/节点事件到 workflow 的入口统计。
这样作者可以区分 workflow 是由 UI 事件触发、只被其他 workflow 内部调用,还是暂时没有事件入口。

已完成:

- `src/app/lowcode/workflow-graph.ts` 新增 `collectWorkflowEntrypoints()`:
  - 从 `SceneNode.events` 扫描 `callWorkflow`。
  - 递归扫描 `condition` / `confirm` 分支,以及 `apiCall` / `supabaseQuery` /
    `supabaseMutation` 的 `onSuccess` / `onError` 分支。
  - 记录来源 node、event name、action id 和 action path。
  - 事件中引用 missing workflow 时生成只读 missing-workflow issue。
- `analyzeWorkflowGraph()` 支持可选 entrypoint context:
  - summary 显示 event entrypoint 总数。
  - 每个 workflow node 记录自己的 `entrypoints`。
  - 汇总 `workflowsWithoutEntrypoints`,用于提示没有 UI/event 入口的 workflow。
- `WorkflowsPanel`:
  - summary 从 `editor.graph.getAllNodes()` 收集事件入口。
  - 常驻显示 `No event entry` 诊断行,并复用现有 `Jump` 定位到 workflow row。
  - 展开 details 后每个 workflow 行显示 entry / in / out / action 摘要。
- 覆盖:
  - `tests/engine/app/lowcode/workflow-graph.test.ts` 覆盖事件入口收集、嵌套 action path、
    missing event workflow reference 和无入口 workflow。
  - `tests/e2e/properties/workflow-optional-params.spec.ts` 覆盖 summary entry count、
    `No event entry` 提示和 details 中的 entry count。

已验证:

- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `git diff --check`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (需本地端口监听权限;沙箱内首次因 `listen EPERM ::1:1420` 失败,升级权限后通过)

明确不做:

- 不新增 workflow schema / SceneGraph 持久化字段。
- 不改变 compiler inline/cycle warning/drop 语义。
- 不做图布局、拖拽节点或连线编辑。
- 不从 graph summary 反向定位到具体 nested action row;本刀只汇总入口来源。

### 13.6 2026-07-01 第六刀:Workflow graph source jumps

本刀继续增强只读 workflow graph diagnostics,补上从 entrypoint 诊断回到来源节点事件编辑器的
跳转。作者看到某个 workflow 有 UI/event 入口后,可以直接回到触发它的按钮/表单事件。

已完成:

- `WorkflowsPanel` 在 graph details 中列出每个 workflow 的 event entrypoint 来源:
  - 来源 node name。
  - event name。
  - `Source` 按钮。
- `Source` 按钮:
  - 选择来源 node。
  - 来源 node 不在当前 page 时先切到对应 page。
  - 让右侧 Design panel 自然切到该 node 的 `EventsPanel`。
- 保持数据模型不变:
  - 不写入 SceneGraph / `.fig`。
  - 不新增 workflow/action schema 字段。
  - 不改变 compiler/runtime。
- 覆盖:
  - `tests/e2e/properties/workflow-optional-params.spec.ts` 验证 Source 行可见,点击后选中
    `Run save` node,并显示该 node 的 `callWorkflow` event action。

已验证:

- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `git diff --check`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (需本地端口监听权限;沙箱内首次因 `listen EPERM ::1:1420` 失败,升级权限后通过)

明确不做:

- 不持久化 action focus 或高亮状态;Source 跳转只影响当前 UI 焦点。
- 不做可视化 DAG 布局、拖拽或连线编辑。
- 不新增持久化或 localStorage 状态。

### 13.7 2026-07-01 第七刀:Workflow graph action-row focus

本刀把第六刀的 Source 跳转补到具体 action row。作者从 entrypoint 诊断点击 Source 后,
不仅会选中来源 node,还会把焦点落到对应的 `callWorkflow` action row。

已完成:

- 新增 `src/app/lowcode/action-focus.ts`:
  - 保存一次性的 pending lowcode action focus target。
  - target 包含 `nodeId`、`actionId` 和 `actionPath`。
  - `EventsPanel` 成功聚焦后清除 pending target。
- `ActionList` / `ActionRow`:
  - 递归传递稳定 action path。
  - 每个 action row 暴露 `data-lowcode-action-path` 和 `data-lowcode-action-id`。
  - action row 可 programmatic focus,但不改变 persisted action 数据。
- `EventsPanel`:
  - 在本组件 root 内消费 pending focus target。
  - 选中来源 node 后,等待事件 action rows 渲染,再滚动并 focus 对应 row。
- `WorkflowsPanel`:
  - Source 跳转时把 entrypoint 的 `actionPath` 一起传给 pending focus。
- 覆盖:
  - `tests/e2e/properties/workflow-optional-params.spec.ts` 验证 Source 后焦点落在
    `data-lowcode-action-path="onClick[0]"` 的 action row。

已验证:

- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `git diff --check`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (需本地端口监听权限;沙箱内首次因 `listen EPERM ::1:1420` 失败,升级权限后通过)

明确不做:

- 不持久化 action focus / highlighter。
- 不自动展开未来可能出现的折叠 action branch;当前递归 ActionList 本来就是展开渲染。
- 不做可视化 DAG 布局、拖拽或连线编辑。

### 13.8 2026-07-01 第八刀:Workflow graph readonly relation groups

本刀把 graph details 从单行计数升级成更可扫读的只读关系块。它仍不是 canvas/DAG editor,
但作者可以直接看到每个 workflow 的入口、向外调用和被谁调用。

已完成:

- `WorkflowsPanel` graph details 按 workflow 分组显示:
  - Header:entry / incoming / outgoing / action count。
  - `Entries`:来自节点事件的 entrypoint,继续支持 `Source` 跳转并聚焦 action row。
  - `Calls out`:本 workflow 调用的 workflow,存在目标时提供 `Jump`。
  - `Called by`:调用本 workflow 的 workflow,提供 `Jump`。
- 空关系显示 `none`,避免只有计数时作者不知道是哪一类为空。
- missing workflow outgoing edge 仍显示目标 id,但不提供目标 `Jump`。
- 覆盖:
  - `tests/e2e/properties/workflow-optional-params.spec.ts` 验证 entry source、known outgoing、
    missing outgoing 和 incoming relation 行。

已验证:

- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `git diff --check`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (需本地端口监听权限;沙箱内首次因 `listen EPERM ::1:1420` 失败,升级权限后通过)

明确不做:

- 不绘制 canvas / SVG 节点连线图。
- 不做拖拽 DAG 编辑。
- 不持久化 graph details 展开状态或布局状态。

### 13.9 2026-07-01 第九刀:Workflow graph focus highlights

本刀给 workflow graph 的 Jump / Source 导航补一个短暂视觉落点。焦点已经能到目标 row,
但没有高亮时作者仍需要在密集属性面板里寻找落点;本刀只加本地 transient highlight。

已完成:

- 新增 `src/app/lowcode/focus-highlight.ts`:
  - 给目标 row 短暂加 `data-lowcode-focus-highlighted`。
  - 同时加轻量 `ring-accent` / `bg-accent/10` class。
  - 1.2s 后自动移除,不持久化。
- `WorkflowRow.focusRow()`:
  - 保持滚动和 focus 行为。
  - 额外 flash workflow row。
- `EventsPanel` action-row pending focus:
  - 找到目标 action row 后滚动、focus 并 flash。
- 覆盖:
  - `tests/e2e/properties/workflow-optional-params.spec.ts` 验证 workflow Jump 和 Source
    action row 都出现 transient highlight 标记。

已验证:

- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `git diff --check`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (需本地端口监听权限;沙箱内首次因 `listen EPERM ::1:1420` 失败,升级权限后通过)

明确不做:

- 不保存高亮状态到 SceneGraph / localStorage。
- 不新增动画库。
- 不做 SVG/HTML readonly graph layout。

### 13.10 2026-07-01 第十刀:Workflow graph readonly map

本刀把 workflow graph details 从纯文本分组再推进一步,增加一个 compact HTML readonly map。
它不改变 workflow 数据模型,也不引入 canvas/SVG;目标是让作者先扫一眼 workflow 节点和调用边,
再按需查看下方 Entries / Calls out / Called by 明细。

已完成:

- `WorkflowsPanel.vue` 在 graph details 展开时显示 `lowcode-workflow-graph-map`:
  - workflow 节点以小按钮 pill 呈现,点击可 Jump 到对应 `WorkflowRow`。
  - call edges 以 `from -> to` 列表呈现。
  - known target edge 保留 Jump 操作。
  - missing target edge 显示 `missing` 标记,并继续由上方 issue 文案承担诊断。
- 保留第八刀的 readonly relation groups:
  - `Entries`
  - `Calls out`
  - `Called by`
- 覆盖:
  - `tests/e2e/properties/workflow-optional-params.spec.ts` 验证 map 折叠/展开、节点数量、
    edge 文案、missing 标记和 map edge Jump 聚焦。

已验证:

- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `git diff --check`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (需本地端口监听权限;沙箱内首次因 `listen EPERM ::1:1420` 失败,升级权限后通过)

明确不做:

- 不绘制 SVG/canvas 节点连线图。
- 不做拖拽 DAG 编辑。
- 不保存 map layout 到 SceneGraph / localStorage。

### 13.11 2026-07-01 第十一刀:Workflow graph map node density

本刀继续增强第十刀的 HTML readonly map,把关键诊断信息直接压到 workflow node pill 上。
作者不需要先读下方 relation groups,就能看出某个 workflow 是否有事件入口、被谁调用、
向外调用多少、包含多少 action,以及是否带有 graph issue。

已完成:

- `WorkflowsPanel.vue` 的 `lowcode-workflow-graph-map-node` 改为两行 compact pill:
  - 第一行显示 workflow name。
  - 有 issue 的 node 显示红色 `issue` 标记。
  - 第二行显示压缩计数:`<entry>e / <incoming>i / <outgoing>o / <actions>a`。
- 这些标记全部来自现有 `WorkflowGraphNode`:
  - `entrypoints.length`
  - `incoming.length`
  - `outgoing.length`
  - `actionCount`
  - `issues.length`
- 覆盖:
  - `tests/e2e/properties/workflow-optional-params.spec.ts` 验证 map node stats 和 issue badge。

已验证:

- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `git diff --check`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (需本地端口监听权限;沙箱内首次因 `listen EPERM ::1:1420` 失败,升级权限后通过)

明确不做:

- 不新增 workflow graph 数据结构字段。
- 不把 map 节点状态持久化到 SceneGraph / localStorage。
- 不做拖拽 DAG 编辑或 SVG/canvas edge rendering。

### 13.12 2026-07-01 第十二刀:Workflow graph map filters

本刀给 HTML readonly map 增加本地过滤,让 workflow 变多时可以快速聚焦问题边或入口 workflow。
过滤只影响 map 区域,不影响常驻 summary、issue 列表、entrypoint 列表或下方 relation groups。

已完成:

- `WorkflowsPanel.vue` 在 `lowcode-workflow-graph-map` 顶部新增 filter controls:
  - `All`:显示全部 workflow map nodes 和 call edges。
  - `Issues`:显示带 issue 的 workflow nodes;edge 只显示 missing target edge 或 cycle
    issue nodes 之间的 edge。
  - `Entries`:显示有 UI/event entrypoint 的 workflow nodes;edge 显示与这些入口 workflow
    相连的 call edges。
- 新增本地 `graphMapFilter` 状态和 computed map projections:
  - `graphMapNodes`
  - `graphMapEdges`
  - `graphMapEmptyLabel()`
- 保持 map filters local-only:
  - 不写入 SceneGraph。
  - 不写入 `.fig`。
  - 不写入 localStorage。
- 覆盖:
  - `tests/e2e/properties/workflow-optional-params.spec.ts` 验证 `Issues` filter 只显示
    `Save` issue node 和 missing edge。
  - 同一用例验证 `Entries` filter 聚焦入口 workflow 并保留入口 workflow 的 outgoing edges。

已验证:

- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `git diff --check`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (需本地端口监听权限;沙箱内首次因 `listen EPERM ::1:1420` 失败,升级权限后通过)

明确不做:

- 不新增 workflow graph 数据结构字段。
- 不过滤下方 readonly relation groups。
- 不持久化 filter 状态。
- 不做拖拽 DAG 编辑或 SVG/canvas edge rendering。

### 13.13 2026-07-01 第十三刀:Workflow graph map entrypoint sources

本刀把 entrypoint source density 提到 HTML readonly map node 上。作者在 map 的 `Entries`
filter 中看到入口 workflow 时,不必再滚到下方 relation groups,可以直接看到第一个入口来源并跳转
到来源节点的具体 action row。

已完成:

- `WorkflowsPanel.vue` 的 map node 从单个 button 拆成小型容器:
  - 主区域仍可 Jump 到 workflow row。
  - 有 entrypoint 的 node 显示第一条来源:`<nodeName> <eventName>`。
  - 来源行提供 `Source` 按钮,复用现有 `jumpToEntrypointSource()`。
- 保持 HTML 结构有效:
  - 不在 button 内嵌套 button。
  - workflow row Jump 和 source action Jump 分开。
- 覆盖:
  - `tests/e2e/properties/workflow-optional-params.spec.ts` 验证 map node 显示
    `Run save onClick`。
  - 同一用例验证 map-level `Source` 能选中 `Run save` node,并聚焦 `onClick[0]` action row。

已验证:

- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `git diff --check`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (需本地端口监听权限;沙箱内首次因 `listen EPERM ::1:1420` 失败,升级权限后通过)

明确不做:

- 不显示全部 entrypoints;map node 只显示第一条,完整列表仍在 relation groups 的 `Entries` 区。
- 不新增 workflow graph 数据结构字段。
- 不持久化 map source 展开状态。
- 不做拖拽 DAG 编辑或 SVG/canvas edge rendering。

### 13.14 2026-07-01 第十四刀:Workflow graph map entrypoint overflow

本刀补 map node 的多入口提示。第十三刀只把第一条 entrypoint source 提到 map node 上;当一个
workflow 被多个 UI/event 入口触发时,作者还需要知道这里不止一个入口。本刀显示 overflow count,
完整来源仍保留在下方 relation groups。

已完成:

- `WorkflowsPanel.vue`:
  - 当 `node.entrypoints.length > 1` 时,在 map node source 行下方显示
    `+<count> more`。
  - 第一条来源仍保留 `Source` 跳转。
  - 不新增展开态或持久化状态。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - workflow graph fixture 新增第二个按钮入口 `Quick save`。
  - summary 现在验证 `2 entries`。
  - map node stats 验证 `2e / 0i / 2o / 2a`。
  - map node overflow 验证 `+1 more`。
  - relation groups 中的 multi-source strict locator 收紧到 first source row。

已验证:

- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `git diff --check`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (需本地端口监听权限;沙箱内首次因 `listen EPERM ::1:1420` 失败,升级权限后通过;修复
  multi-source strict locator 后重跑通过)

明确不做:

- 不在 map node 内展开全部 entrypoints。
- 不新增 workflow graph 数据结构字段。
- 不持久化 source overflow 状态。
- 不做拖拽 DAG 编辑或 SVG/canvas edge rendering。

### 13.15 2026-07-01 第十五刀:Workflow graph map source list

本刀把第十四刀的 overflow count 升级成 local-only 展开列表。作者点击 `+N more` 后,
可以在 map node 内直接看到剩余 entrypoint sources,并对每条来源执行 `Source` 跳转。

已完成:

- `WorkflowsPanel.vue`:
  - 新增 `expandedGraphMapSourceIds` 本地状态,用 `Set<string>` 记录展开的 workflow id。
  - 新增 `toggleGraphMapSources()` / `isGraphMapSourceExpanded()`。
  - `+N more` 改为按钮:
    - 收起时显示 `+N more`。
    - 展开时显示 `Hide sources`。
  - 展开后显示 `node.entrypoints.slice(1)` 的来源列表。
  - 每条 extra source 提供 `Source` 按钮,复用 `jumpToEntrypointSource()`。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - 验证点击 `+1 more` 后显示 `Hide sources`。
  - 验证 extra source `Quick save onClick` 可见。
  - 验证 extra source 的 `Source` 跳转可选中 `Quick save` 并聚焦 `onClick[0]`。

已验证:

- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `git diff --check`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (需本地端口监听权限;沙箱内首次因 `listen EPERM ::1:1420` 失败,升级权限后通过)

明确不做:

- 不持久化展开状态到 SceneGraph / `.fig` / localStorage。
- 不把展开状态同步到 relation groups。
- 不新增 workflow graph 数据结构字段。
- 不做拖拽 DAG 编辑或 SVG/canvas edge rendering。

### 13.16 2026-07-01 第十六刀:Workflow graph map source-list keyboard polish

本刀给第十五刀的 source list 补可访问性和键盘收起能力。展开仍是 local-only UI 状态,
但按钮现在会暴露 ARIA 展开状态,并允许作者在 extra source list 内按 Escape 收起。

已完成:

- `WorkflowsPanel.vue`:
  - 新增 `collapseGraphMapSources(workflowId)`。
  - 新增 `graphMapSourceListId(workflowId)`。
  - `+N more` / `Hide sources` 按钮增加:
    - `aria-expanded`
    - `aria-controls`
  - 展开的 extra source list 增加稳定 `id`。
  - extra source list 内支持 `Escape` 收起,并阻止事件继续冒泡。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - 验证按钮初始 `aria-expanded=false`。
  - 展开后验证 `aria-expanded=true`。
  - 聚焦 extra source `Source` 按钮后按 Escape。
  - 验证列表收起且 `aria-expanded=false`。
  - 再次展开后继续验证 extra source jump。

已验证:

- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `git diff --check`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (需本地端口监听权限;沙箱内首次因 `listen EPERM ::1:1420` 失败,升级权限后通过)

明确不做:

- 不持久化展开状态到 SceneGraph / `.fig` / localStorage。
- 不自动移动焦点回展开按钮;当前只收起列表。
- 不新增 workflow graph 数据结构字段。
- 不做拖拽 DAG 编辑或 SVG/canvas edge rendering。

### 13.17 2026-07-01 第十七刀:Workflow graph map source-list focus return

本刀收口第十六刀的键盘体验:作者在 extra source list 内按 Escape 收起后,焦点会回到对应
`Hide sources` / `+N more` toggle,避免 list 被移除后浏览器焦点落到不可预期位置。

本刀已完成:

- `WorkflowsPanel.vue`:
  - `collapseGraphMapSources(workflowId, event?)` 接收键盘事件。
  - 收起前从 list 的 `currentTarget.previousElementSibling` 捕获对应 source toggle。
  - 收起 local-only 展开状态后,把焦点回落到该 toggle。
  - template 的 Escape handler 传入 `$event`。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - 聚焦 extra source `Source` 后按 Escape。
  - 验证 `aria-expanded=false`。
  - 验证 `document.activeElement` 回到 `lowcode-workflow-graph-map-node-entrypoint-more`。
  - 验证列表已移除后仍可再次展开并跳转 extra source。

已验证:

- `git diff --check`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (沙箱内首次因 `listen EPERM ::1:1420` 失败,升级权限后通过)

明确不做:

- 不持久化展开状态到 SceneGraph / `.fig` / localStorage。
- 不新增 focus trap 或 roving tabindex。
- 不新增 workflow graph 数据结构字段。
- 不做拖拽 DAG 编辑或 SVG/canvas edge rendering。

### 13.18 2026-07-01 第十八刀:Workflow graph map source-list visual labels

本刀继续收口 source list 的可扫读性和可访问性。extra source list 仍是只读、本地展开状态,
但列表现在有更清晰的分组边界,每个 `Source` 跳转也会暴露具体来源,避免多个同名按钮在辅助
技术和测试里不可区分。

本刀已完成:

- `WorkflowsPanel.vue`:
  - 新增 `entrypointSourceLabel()` 和 `entrypointSourceJumpLabel()` 复用 source 文案。
  - 第一条 source 和 extra source 共用同一套来源标签。
  - 第一条 / extra `Source` 按钮增加 source-specific `aria-label` 和 `title`。
  - `+N more` / `Hide sources` toggle 增加具体 `aria-label`。
  - extra source list 增加 `aria-label`。
  - extra source list 增加左边界、缩进、行背景和稳定按钮宽度,提升密集 map node 内的扫读性。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - 验证 collapsed toggle 的 `Show 1 more sources for Save`。
  - 验证 expanded toggle 的 `Hide additional sources for Save`。
  - 验证 source list 的 `Additional sources for Save`。
  - 验证第一条和 extra source jump 的具体 `aria-label`。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (沙箱内首次因 `listen EPERM ::1:1420` 失败,升级权限后通过)

明确不做:

- 不持久化展开状态到 SceneGraph / `.fig` / localStorage。
- 不新增 focus trap 或 roving tabindex。
- 不新增 workflow graph 数据结构字段。
- 不做拖拽 DAG 编辑或 SVG/canvas edge rendering。

### 13.19 2026-07-01 第十九刀:Workflow graph map density empty states

本刀继续 polish workflow graph map 的密集视图。之前 map 的空状态跟 edge list 绑定,
会让“有节点但没有边”的场景看起来像整个 map 为空。本刀把节点空态和边空态拆开,
并在过滤器旁显示当前过滤后的 node / edge 计数。

本刀已完成:

- `WorkflowsPanel.vue`:
  - 新增 `countLabel()` 和 `graphMapSummaryLabel()`。
  - map filter 右侧显示 `N nodes, M edges` 摘要。
  - 新增 `graphMapNodeEmptyLabel()` 和 `graphMapEdgeEmptyLabel()`。
  - `graphMapNodes.length === 0` 时显示独立 node empty。
  - `graphMapNodes.length > 0 && graphMapEdges.length === 0` 时显示独立 edge empty。
  - 保留 All / Issues / Entries filter 的局部状态,不改 graph 数据结构。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - 在现有 diagnostics fixture 覆盖 All / Issues / Entries 的 map summary:
    - `2 nodes, 2 edges`
    - `1 node, 1 edge`
    - `1 node, 2 edges`
  - 新增 entrypoint-only fixture,覆盖:
    - 有 node 无 edge 时显示 `1 node, 0 edges` 和 `No workflow calls.`;
    - Entries filter 显示 `No entry edges.`;
    - Issues filter 显示 `0 nodes, 0 edges` 和 `No workflows with issues.`;
    - 没有 node 时不再显示 edge empty。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (沙箱内首次因 `listen EPERM ::1:1420` 失败,升级权限后通过)

明确不做:

- 不持久化 filter / 展开状态到 SceneGraph / `.fig` / localStorage。
- 不新增 workflow graph 数据结构字段。
- 不做拖拽 DAG 编辑或 SVG/canvas edge rendering。

### 13.20 2026-07-01 第二十刀:Workflow graph map jump keyboard labels

本刀继续收口 workflow graph map 的键盘可达性。map node 和 edge 的 `Jump` 控件此前能点,
但缺少具体目标标签,且键盘激活依赖浏览器原生按钮行为。本刀给这些 jump 控件补明确目标文案,
并把 Enter / Space 显式接到同一跳转行为。

本刀已完成:

- `WorkflowsPanel.vue`:
  - 新增 `graphMapNodeJumpLabel(nodeName)`。
  - 新增 `graphMapEdgeJumpLabel(edge)`。
  - map node jump 增加 source-specific `aria-label` / `title`。
  - map edge jump 增加 source-specific `aria-label` / `title`。
  - map node / edge jump 增加 focus 状态样式。
  - map node / edge jump 显式处理 `Enter` / `Space` 键盘激活,复用 `jumpToWorkflow()`。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - 验证 map node jump 的 `Jump to Save workflow`。
  - 用 `Enter` 激活 map node jump,验证焦点到 `wf-save` workflow row。
  - 验证 map edge jump 的 `Jump to Notify workflow from Save`。
  - 用 `Enter` 激活 map edge jump,验证焦点到 `wf-notify` workflow row。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (沙箱内首次因 `listen EPERM ::1:1420` 失败;首次提权暴露 native key activation 不稳定,
  改为显式 `keydown.enter/space` 后通过)

明确不做:

- 不持久化 filter / 展开状态到 SceneGraph / `.fig` / localStorage。
- 不新增 workflow graph 数据结构字段。
- 不做拖拽 DAG 编辑或 SVG/canvas edge rendering。

### 13.21 2026-07-02 第二十一刀:Workflow graph map missing-edge source jump

本刀继续 polish workflow graph map 的缺失目标边。此前 missing edge 只显示红色 `missing`,
作者仍需要自己在 graph 里找到是哪一个 workflow 发起了坏引用。本刀给 missing edge 增加
可键盘访问的 `Source` 跳转,直接回到发起坏引用的 workflow row。

本刀已完成:

- `WorkflowsPanel.vue`:
  - 新增 `graphMapMissingEdgeLabel(edge)`。
  - 新增 `graphMapMissingEdgeSourceJumpLabel(edge)`。
  - missing badge 增加 `data-test-id`、source-specific `aria-label` 和 `title`。
  - missing badge 改成轻量 pill 样式,在密集 edge list 中更容易扫描。
  - missing edge 增加 `Source` 按钮,跳回 `edge.fromId` workflow。
  - missing edge `Source` 按钮支持 `Enter` / `Space`,复用 `jumpToWorkflow(edge.fromId)`。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - 验证 missing badge 的 `Missing workflow wf-missing called from Save`。
  - 验证 missing edge source jump 的 `Jump to Save workflow to fix missing wf-missing`。
  - 用 `Enter` 激活 missing edge source jump,验证焦点回到 `wf-save` workflow row。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (提权后通过;本地 Vite webServer 仍需要端口监听权限)

明确不做:

- 不自动修复 missing workflowId。
- 不持久化 filter / 展开状态到 SceneGraph / `.fig` / localStorage。
- 不新增 workflow graph 数据结构字段。
- 不做拖拽 DAG 编辑或 SVG/canvas edge rendering。

### 13.22 2026-07-02 第二十二刀:Workflow graph map issue group

本刀继续 polish workflow graph map 的 issue 视图。此前 map 区域只显示节点、边和 missing badge,
具体 issue message 仍主要在 summary 顶部。本刀在 map 内加入 compact issue group,让作者展开
details 后可以在同一区域读到问题类型、问题文本,并从 map 内直接跳到可修复的 workflow。

本刀已完成:

- `WorkflowsPanel.vue`:
  - 新增 `WorkflowGraphIssue` 类型导入。
  - 新增 `graphMapIssueTypeLabel(issue)`。
  - 新增 `graphMapIssueJumpLabel(issue)`。
  - map 内新增 `lowcode-workflow-graph-map-issue-group`。
  - 每条 issue 显示 compact type pill 和 issue message。
  - 有 `targetWorkflowId` 的 issue 提供 map 内 `Jump` 按钮。
  - map issue jump 支持 `Enter` / `Space`,复用 `jumpToWorkflow()`。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - 验证 map issue group 存在。
  - 验证 issue type 显示 `Missing`。
  - 验证 issue message 显示 `Save calls a missing workflow (wf-missing)`。
  - 验证 map issue jump 的 source-specific `aria-label`。
  - 用 `Enter` 激活 map issue jump,验证焦点回到 `wf-save` workflow row。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (提权后通过;本地 Vite webServer 仍需要端口监听权限)

明确不做:

- 不新增 issue severity / grouping schema。
- 不自动修复 missing workflowId。
- 不持久化 filter / 展开状态到 SceneGraph / `.fig` / localStorage。
- 不做拖拽 DAG 编辑或 SVG/canvas edge rendering。

### 13.23 2026-07-02 第二十三刀:Workflow graph map issue clean state

本刀补齐第二十二刀的 clean state。此前 map 内有 issue 时会显示 compact issue group,
但没有 issue 时 map 区域没有对应反馈。本刀在 map 内显示明确的 clean issue 状态,
让作者知道当前 graph map 没有问题,而不是误以为 issue 组件未加载。

本刀已完成:

- `WorkflowsPanel.vue`:
  - `workflowGraph.issues.length === 0` 时显示 `lowcode-workflow-graph-map-issue-clean`。
  - clean state 文案为 `No graph issues in this map.`。
  - clean state 使用轻量边框/背景样式,与 issue group 占位层级一致。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - 有 issue 的 diagnostics fixture 验证 clean state 不出现。
  - entrypoint-only fixture 验证 issue group 不出现。
  - entrypoint-only fixture 验证 clean state 文案。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (提权后通过;本地 Vite webServer 仍需要端口监听权限)

明确不做:

- 不新增 issue severity / grouping schema。
- 不持久化 filter / 展开状态到 SceneGraph / `.fig` / localStorage。
- 不做拖拽 DAG 编辑或 SVG/canvas edge rendering。

### 13.24 2026-07-02 第二十四刀:Workflow graph map issue filter summary

本刀补齐 graph map issue 区域和 All / Issues / Entries 过滤器之间的语义一致性。
此前 node / edge 会随 filter 变化,但 issue group / clean state 仍读取全量
`workflowGraph.issues`,容易让 Entries 子图显示不相关 issue。本刀让 issue summary
和 clean copy 跟随当前 map filter。

本刀已完成:

- `WorkflowsPanel.vue`:
  - 新增 `graphMapIssues`,作为 map 内 issue group 的过滤后数据源。
  - Entries filter 只显示触达 entry workflows 的 issue。
  - issue group 新增 `lowcode-workflow-graph-map-issue-summary`。
  - issue summary 文案区分 `1 issue total`、`1 issue in issue filter`、以及
    `1 issue touching entry workflows`。
  - clean state 文案区分全量、Issues filter、Entries filter。
  - All / Issues / Entries filter buttons 增加 `aria-pressed` 当前态。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - 覆盖 diagnostics fixture 中 All / Issues / Entries 三种过滤下的 issue summary。
  - 覆盖无 issue fixture 中 Entries / Issues filter 的 clean state 文案。
  - 新增孤立 issue fixture,验证全量有 issue 但 Entries 子图显示 clean state。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts --project=openpencil`
  (提权后通过;本地 Vite webServer 仍需要端口监听权限)

明确不做:

- 不新增 issue severity / grouping schema。
- 不持久化 filter / 展开状态到 SceneGraph / `.fig` / localStorage。
- 不做拖拽 DAG 编辑或 SVG/canvas edge rendering。

### 13.25 2026-07-02 第二十五刀:Workflow graph map issue type/count polish

本刀继续收敛 graph map issue 表达。此前 map issue summary 已经会跟随 filter,
但只显示总数;node badge 也只显示固定 `issue` 文案。本刀补充 missing/cycle
类型计数,并让 node badge 显示具体 issue 数量。

本刀已完成:

- `WorkflowsPanel.vue`:
  - `graphMapIssueSummaryLabel()` 追加 issue type breakdown。
  - 新增 `graphMapIssueTypeSummaryLabel()` 统计 `missing-workflow` 和 `cycle`。
  - `missing` 复数保持为 `missing`,避免显示 `missings`。
  - map node issue badge 从固定 `issue` 改为 `1 issue` / `2 issues`。
  - node issue badge 增加 `title` / `aria-label`,说明对应 workflow 有几个 graph issue。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - 现有 diagnostics fixture 验证 `1 missing` breakdown。
  - 现有 node issue badge 断言升级为 `1 issue` 和 `Save has 1 issue`。
- `tests/e2e/properties/workflow-graph-map-issues.spec.ts`:
  - 新增 focused mixed issue spec,避免继续撑大既有 optional params spec。
  - 覆盖同一 graph 同时存在 missing workflow 和 cycle。
  - 验证 summary 显示 `2 issues total · 1 missing, 1 cycle`。
  - 验证 Issues filter 下 breakdown 仍跟随当前 filtered issue set。
  - 验证 Alpha node badge 显示 `2 issues` 和 `Alpha has 2 issues`。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts tests/e2e/properties/workflow-graph-map-issues.spec.ts --project=openpencil`
  (提权后通过;本地 Vite webServer 仍需要端口监听权限)

明确不做:

- 不新增 issue severity / grouping schema。
- 不持久化 filter / 展开状态到 SceneGraph / `.fig` / localStorage。
- 不做拖拽 DAG 编辑或 SVG/canvas edge rendering。

### 13.26 2026-07-02 第二十六刀:Workflow graph map readonly DAG grouping

本刀开始把 graph map 从纯节点列表推进到 readonly DAG visual grouping。仍不做拖拽、
SVG/canvas edge rendering 或 workflow schema 扩展,只在现有 HTML map 上按当前 filter
派生 Issues / Entries / Called 分组,帮助作者更快扫描 entry 起点、被调用节点和问题节点。

本刀已完成:

- `WorkflowsPanel.vue`:
  - 新增 `WorkflowGraphNode` 类型导入。
  - 新增 `GraphMapNodeGroupKind` / `GraphMapNodeGroup`。
  - 新增 `graphMapNodeGroups`,把当前 `graphMapNodes` 派生为 readonly 分组。
  - All filter 下节点优先归入 `Issues`,其次 `Entries`,最后 `Called`,同一节点只出现一次。
  - Issues filter 下节点统一归入 `Issues` 组。
  - Entries filter 下节点统一归入 `Entries` 组。
  - map 节点区域新增 `lowcode-workflow-graph-map-node-groups`。
  - 每组新增 `lowcode-workflow-graph-map-node-group`、group title、group count。
  - 节点卡片仍复用既有 jump/source/issue badge 行为。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - diagnostics fixture 覆盖 All filter 下 `Issues` / `Called` 分组。
  - 覆盖 Issues filter 下仅显示 `Issues` 组。
  - 覆盖 Entries filter 下仅显示 `Entries` 组。
  - entrypoint-only fixture 覆盖 clean graph 的 `Entries` 组。
  - 将 isolated issue clean-state 边界迁出,避免该 spec 超过结构 lint 行数阈值。
- `tests/e2e/properties/workflow-graph-map-issues.spec.ts`:
  - mixed missing/cycle fixture 覆盖 `Issues` 组和 `2 workflows` group count。
  - isolated issue fixture 覆盖 Entries filter clean-state 时的 `Entries` 组。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts tests/e2e/properties/workflow-graph-map-issues.spec.ts --project=openpencil`
  (提权后通过;本地 Vite webServer 仍需要端口监听权限)

明确不做:

- 不新增 workflow graph schema 或持久化 layout 数据。
- 不新增拖拽排序、拖拽连线或节点位置编辑。
- 不新增 SVG/canvas edge rendering。

### 13.27 2026-07-02 第二十七刀:Workflow graph map readonly edge grouping

本刀继续 readonly DAG visual grouping,把 graph map 的 edge list 从单一列表拆成
Calls / Missing 两组。目标是让作者一眼区分正常 workflow call 和需要修复的 missing
workflow call,同时保留既有 Jump / Source 修复入口。

本刀已完成:

- `WorkflowsPanel.vue`:
  - 新增 `GraphMapEdgeGroupKind` / `GraphMapEdgeGroup`。
  - 新增 `graphMapEdgeGroups`,把当前 `graphMapEdges` 派生为 Calls / Missing 分组。
  - 正常 edge 归入 `Calls`,missing target edge 归入 `Missing`。
  - map edge 区域新增 `lowcode-workflow-graph-map-edge-groups`。
  - 每组新增 `lowcode-workflow-graph-map-edge-group`、edge group title、edge group count。
  - edge row 仍保留既有 `Jump` 和 missing `Source` 行为。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - diagnostics fixture 覆盖 All filter 下 `Calls` / `Missing` 分组。
  - 覆盖 Issues filter 下仅显示 `Missing` edge group。
  - 覆盖 Entries filter 下恢复 `Calls` / `Missing` edge groups。
- `tests/e2e/properties/workflow-graph-map-issues.spec.ts`:
  - mixed missing/cycle fixture 覆盖 `Calls` / `Missing` 分组。
  - 覆盖 Calls group `2 edges`,Missing group `1 edge`。
  - 覆盖 Issues filter 下 edge grouping 仍跟随当前 filtered edge set。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts tests/e2e/properties/workflow-graph-map-issues.spec.ts --project=openpencil`
  (提权后通过;本地 Vite webServer 仍需要端口监听权限)

明确不做:

- 不新增 workflow graph schema 或持久化 layout 数据。
- 不新增拖拽排序、拖拽连线或节点位置编辑。
- 不新增 SVG/canvas edge rendering。

### 13.28 2026-07-02 第二十八刀:Workflow graph map edge path labels

本刀继续 readonly edge path / source-target polish。此前 edge row 仍主要是一段
`Save -> Notify` 文本。本刀把 edge row 拆成结构化的 From / To 标签,并给 edge row
增加 readable path `aria-label`,为后续真正的 edge path / DAG editor 做更稳定的 DOM
锚点。

本刀已完成:

- `WorkflowsPanel.vue`:
  - 新增 `graphMapEdgeTargetLabel(edge)`。
  - 新增 `graphMapEdgePathLabel(edge)`。
  - edge row 增加 `aria-label`,例如 `Save calls Notify`。
  - edge row 新增 `lowcode-workflow-graph-map-edge-from`。
  - edge row 新增 `lowcode-workflow-graph-map-edge-arrow`。
  - edge row 新增 `lowcode-workflow-graph-map-edge-to`。
  - missing badge 从整行文本后移到 To target 内,保留 `Missing workflow ...` 的
    `aria-label` / `title`。
  - 保留既有 normal `Jump` 和 missing `Source` 行为。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - 验证 normal edge row `aria-label` 为 `Save calls Notify`。
  - 验证 normal edge 的 `From Save` / `To Notify`。
  - 验证 missing edge row `aria-label` 为 `Save calls wf-missing`。
  - 验证 missing edge 的 `From Save` / `To wf-missing missing`。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts tests/e2e/properties/workflow-graph-map-issues.spec.ts --project=openpencil`
  (第一次提权 E2E 暴露 DOM text 为 `FromSave`;补真实空格后重跑通过)

明确不做:

- 不新增 workflow graph schema 或持久化 layout 数据。
- 不新增拖拽排序、拖拽连线或节点位置编辑。
- 不新增 SVG/canvas edge rendering。

### 13.29 2026-07-02 第二十九刀:Workflow graph map edge action metadata

本刀继续 readonly edge action/source metadata polish。此前 edge row 已有 From / To
结构化标签,但还看不到是哪一个 workflow action 产生了这条调用。本刀复用既有
`WorkflowGraphEdge.actionId`,在 edge row 内显示只读 action badge,并把 edge row 的
readable path `aria-label` 扩展到 action id。

本刀已完成:

- `WorkflowsPanel.vue`:
  - `graphMapEdgePathLabel(edge)` 从 `Save calls Notify` 扩展为
    `Save calls Notify from action call-notify`。
  - 新增 `graphMapEdgeActionLabel(edge)`。
  - edge row 新增 `lowcode-workflow-graph-map-edge-action`。
  - action badge 显示 `Action <actionId>`。
  - action badge 增加 `aria-label` / `title`。
  - 不改变 `WorkflowGraphEdge` schema,只使用已有 `actionId`。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - normal edge 验证 `Save calls Notify from action call-notify`。
  - normal edge 验证 `Action call-notify`。
  - missing edge 验证 `Save calls wf-missing from action call-missing`。
  - missing edge 验证 `Action call-missing` 和 badge title。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure` (仅既有 19 个 max-lines warnings,0 errors)
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts tests/e2e/properties/workflow-graph-map-issues.spec.ts --project=openpencil`
  (提权后通过;本地 Vite webServer 仍需要端口监听权限)

明确不做:

- 不新增 workflow graph schema 或持久化 layout 数据。
- 不新增拖拽排序、拖拽连线或节点位置编辑。
- 不新增 SVG/canvas edge rendering。

### 13.30 2026-07-02 第三十刀:Workflow graph map edge source action jump

本刀继续 readonly edge source/action locating polish。上一刀已经把 edge row 标出
`Action <actionId>`,但它仍只是静态 metadata。本刀把这个 action badge 升级为可点击
source jump:从任何 edge 的 action badge 都能回到产生该调用的源 workflow row,并复用
既有 row focus + temporary highlight。

本刀已完成:

- `WorkflowsPanel.vue`:
  - 新增 `graphMapEdgeSourceActionJumpLabel(edge)`。
  - `lowcode-workflow-graph-map-edge-action` 从静态 `span` 改为 button。
  - normal / missing edge 都可从 action badge 跳回 `edge.fromId` 对应 workflow row。
  - 保留 normal edge 的 target `Jump` 和 missing edge 的 `Source` 修复入口。
  - 不改变 `WorkflowGraphEdge` schema,只使用已有 `fromId` / `actionId`。
- `tests/e2e/properties/workflow-graph-map-issues.spec.ts`:
  - 验证 action badge 的 source jump aria label。
  - 验证按 Enter 后焦点回到源 workflow row。
  - 验证源 workflow row 获得临时 highlighter。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - 更新 missing edge action badge 的 title 断言为可执行 source jump 文案。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts tests/e2e/properties/workflow-graph-map-issues.spec.ts --project=openpencil`
  (普通沙箱下仍会被 Vite `listen EPERM ::1:1420` 拦截,提权后通过)

明确不做:

- 不新增 workflow graph schema 或 actionPath 字段。
- 不做嵌套 workflow action row 精准定位。
- 不新增拖拽排序、拖拽连线或节点位置编辑。

### 13.31 2026-07-02 第三十一刀:Workflow graph edge actionPath focus

本刀把上一刀的 source row jump 继续收窄到 exact source action row。Workflow graph edge
此前已经知道 `actionId`,但 workflow 内部 action 可能嵌套在 condition / confirm /
onSuccess / onError 分支里,只跳到 workflow row 仍需要人工再找一次。本刀让 graph
analysis 为 edge 生成与 `ActionRow` DOM 一致的 `actionPath`,再由 WorkflowRow 暴露
`focusAction(actionPath)` 复用既有 temporary highlight。

本刀已完成:

- `workflow-graph.ts`:
  - `WorkflowGraphEdge` 新增运行时 `actionPath`。
  - `collectCalls()` 递归时生成 `[index]` / `[index]/branch[index]` path。
  - path 格式与 `ActionList` / `ActionRow` 的 `data-lowcode-action-path` 保持一致。
- `WorkflowRow.vue`:
  - 新增 `focusAction(actionPath)` expose。
  - 根据 `data-lowcode-action-path` 查询 action row。
  - 命中后 scroll / focus / temporary highlight;未命中时由上层回退到 row focus。
- `WorkflowsPanel.vue`:
  - edge action badge 调用 `jumpToWorkflowAction(edge)`。
  - action badge 的 `aria-label` / `title` 增加 actionPath,例如
    `Jump to Save workflow action call-missing at [1]`。
  - 保留 normal target `Jump` 和 missing `Source`。
- `tests/engine/app/lowcode/workflow-graph.test.ts`:
  - 验证嵌套 workflow call edge 生成 `[0]/consequent[0]`。
- `tests/e2e/properties/workflow-graph-map-issues.spec.ts`:
  - 验证 action badge aria label 带 `[0]`。
  - 验证 Enter 后焦点落在具体 action row 的 `data-lowcode-action-path`。
  - 验证 action row 获得 temporary highlighter。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - 更新 missing edge action badge title 为带 actionPath 的 source action jump 文案。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts tests/e2e/properties/workflow-graph-map-issues.spec.ts --project=openpencil`
  (普通沙箱下仍会被 Vite `listen EPERM ::1:1420` 拦截,提权后通过)

明确不做:

- 不把 actionPath 写入 SceneGraph / `.fig` / `.pen` 持久化数据。
- 不新增 workflow graph 拖拽排序、拖拽连线或 action reparent。
- 不新增 SVG/canvas edge rendering。

### 13.32 2026-07-02 第三十二刀:Workflow graph edge source context badges

本刀继续只读 map 的 edge source action context polish。上一刀已经能从 edge action
badge 精准跳到 source action row,但 map 本身还看不出这条调用是在 root action chain,
还是嵌套在 condition / api result branch 中。本刀给 edge row 增加 source action kind
和 branch context badges,让作者在不跳转的情况下也能先判断调用来源。

本刀已完成:

- `workflow-graph.ts`:
  - `WorkflowGraphEdge` 新增运行时 `actionKind`。
  - `collectCalls()` 在记录 edge 时写入 source action `kind`。
  - 不改变 SceneGraph / `.fig` / `.pen` schema。
- `WorkflowsPanel.vue`:
  - 新增 `graphMapEdgeActionKindLabel(edge)`。
  - 新增 `graphMapEdgeBranchLabel(edge)` / `graphMapEdgeBranchTitle(edge)`。
  - edge row 新增 `lowcode-workflow-graph-map-edge-action-kind`。
  - edge row 新增 `lowcode-workflow-graph-map-edge-branch`。
  - 顶层 action 显示 `Root`;嵌套 branch 显示 `Then` / `Else` / `On success` /
    `On error`。
  - action jump badge 仍保留精准定位 source action row。
- `tests/engine/app/lowcode/workflow-graph.test.ts`:
  - 验证 edge 记录 `actionKind:'callWorkflow'`。
- `tests/e2e/properties/workflow-graph-map-issues.spec.ts`:
  - 将 mixed issue fixture 的 `call-beta` 放入 condition `consequent`。
  - 验证 action jump aria label 包含 `[0]/consequent[0]`。
  - 验证 kind badge title 为 `Kind callWorkflow`。
  - 验证 branch badge title 为 `Then branch at [0]/consequent[0]`。
  - 验证 Enter 后焦点落到嵌套 action row。
- `tests/e2e/properties/workflow-optional-params.spec.ts`:
  - 验证顶层 edge 显示 `callWorkflow` kind 和 `Root branch at [0]`。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts tests/e2e/properties/workflow-graph-map-issues.spec.ts --project=openpencil`
  (普通沙箱下仍会被 Vite `listen EPERM ::1:1420` 拦截,提权后通过)

明确不做:

- 不新增 workflow graph 拖拽排序、拖拽连线或 action reparent。
- 不新增 SVG/canvas edge rendering。
- 不把 branch context 写入持久化文档数据。

### 13.33 2026-07-02 第三十三刀:Workflow graph map group collapse

本刀开始处理只读 workflow graph map 的密度问题。此前 map 已经有 Issues / Entries /
Called node groups 和 Calls / Missing edge groups,但 group 内容会全部展开;继续添加
metadata badge 后,复杂 graph 会变得难扫。本刀先做组级 collapse,让作者能保留标题与
计数,临时收起不关心的节点或边。

本刀已完成:

- `WorkflowsPanel.vue`:
  - 新增 `collapsedGraphMapNodeGroupKinds` 和 `collapsedGraphMapEdgeGroupKinds`。
  - 新增 node group collapse helpers:
    - `isGraphMapNodeGroupCollapsed(kind)`;
    - `toggleGraphMapNodeGroup(kind)`;
    - `graphMapNodeGroupToggleLabel(group)`。
  - 新增 edge group collapse helpers:
    - `isGraphMapEdgeGroupCollapsed(kind)`;
    - `toggleGraphMapEdgeGroup(kind)`;
    - `graphMapEdgeGroupToggleLabel(group)`。
  - node group header 新增 `lowcode-workflow-graph-map-node-group-toggle`。
  - edge group header 新增 `lowcode-workflow-graph-map-edge-group-toggle`。
  - toggle 提供 `aria-expanded`、`aria-label`、`title`。
  - 折叠后保留 group title/count,隐藏 group 内容。
- `tests/e2e/properties/workflow-graph-map-issues.spec.ts`:
  - 验证 node group 默认展开。
  - 验证 node group 折叠后 node card 隐藏、count 保留。
  - 验证 node group 可重新展开。
  - 验证 edge group 默认展开。
  - 验证 Calls edge group 折叠后只剩 Missing edge rows、count 保留。
  - 验证 edge group 可重新展开。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts tests/e2e/properties/workflow-graph-map-issues.spec.ts --project=openpencil`
  (普通沙箱下仍会被 Vite `listen EPERM ::1:1420` 拦截,提权后通过)

明确不做:

- 不新增 workflow graph 拖拽排序、拖拽连线或 action reparent。
- 不新增 SVG/canvas edge rendering。
- 不持久化 group collapse 状态。

### 13.34 2026-07-02 第三十四刀:Workflow graph map search

本刀继续处理只读 workflow graph map 的密度与定位问题。上一刀提供 group collapse,
但复杂 graph 中作者仍需要按 workflow / action 快速收敛视图。本刀新增本地 search,
在当前 All / Issues / Entries filter 结果上继续过滤 nodes / edges / issues。

本刀已完成:

- `WorkflowsPanel.vue`:
  - 新增 `graphMapSearchQuery` 和 `graphMapSearchTerm`。
  - 将 map 数据拆为 base/result:
    - `graphMapBaseNodes`;
    - `graphMapBaseEdges`;
    - `graphMapBaseIssues`;
    - `graphMapNodes`;
    - `graphMapEdges`;
    - `graphMapIssues`。
  - 新增 `graphMapMatchedEdges` / `graphMapMatchedNodeIds`。
  - 新增 `graphMapNodeMatchesSearch(node, term)`。
  - 新增 `graphMapEdgeMatchesSearch(edge, term)`。
  - 新增 `graphMapSearchSummaryLabel()` 和 `clearGraphMapSearch()`。
  - 搜索 workflow node 时保留相连 edges。
  - 搜索 edge action/target 时保留 edge 两端可见 workflow nodes。
  - issue group 跟随 search term 收窄。
  - map header 新增 `lowcode-workflow-graph-map-search`。
  - 有 query 时显示 `lowcode-workflow-graph-map-search-summary` 和 Clear 按钮。
- `tests/e2e/properties/workflow-graph-map-issues.spec.ts`:
  - 验证搜索 `wf-missing` 后 map summary 变为 `1 node, 1 edge`。
  - 验证 search summary 显示匹配 query。
  - 验证 node list 收敛到 `Alpha`。
  - 验证 edge group 收敛到 `Missing`。
  - 验证 issue summary 收敛到 `1 issue total`。
  - 验证 Clear 后恢复 `2 nodes, 3 edges`。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts tests/e2e/properties/workflow-graph-map-issues.spec.ts --project=openpencil`
  (普通沙箱下仍会被 Vite `listen EPERM ::1:1420` 拦截,提权后通过)

明确不做:

- 不新增 workflow graph 拖拽排序、拖拽连线或 action reparent。
- 不新增 SVG/canvas edge rendering。
- 不持久化 search query。

### 13.35 2026-07-02 第三十五刀:Workflow graph map search keyboard focus

本刀继续 polish workflow graph map search 的可达性。上一刀新增 search 后,鼠标可用但键盘用户
还需要 tab 到输入框。本刀给 map 区域增加 `/` 聚焦 search 的本地快捷入口,并让 Escape
在 search 内先清空 query,再次 Escape 退出输入框。

本刀已完成:

- `WorkflowsPanel.vue`:
  - 新增 `graphMapSearchInput` ref。
  - 新增 `focusGraphMapSearch()`。
  - 新增 `isTextInputTarget(target)`。
  - 新增 `handleGraphMapKeydown(event)`:
    - map 内按 `/` 聚焦 search;
    - 在 input / textarea / select / contenteditable 内不拦截;
    - meta / ctrl / alt 组合键不拦截。
  - 新增 `handleGraphMapSearchEscape(event)`:
    - search 有 query 时先清空;
    - search 已空时 blur。
  - search placeholder 更新为 `Search workflow/action (/)`。
  - 不持久化快捷键或 search query。
- `tests/e2e/properties/workflow-graph-map-issues.spec.ts`:
  - 验证 map 内按 `/` 聚焦 search。
  - 验证搜索 `call-beta` 后显示 matching summary。
  - 验证第一次 Escape 清空 search。
  - 验证第二次 Escape 让 search 失焦。

已验证:

- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run check:vue`
- `bun test tests/engine/app/lowcode/workflow-graph.test.ts`
- `bun run lint:structure`
- `bun run test -- tests/e2e/properties/workflow-optional-params.spec.ts tests/e2e/properties/workflow-graph-map-issues.spec.ts --project=openpencil`
  (普通沙箱下仍会被 Vite `listen EPERM ::1:1420` 拦截,提权后通过)

明确不做:

- 不新增全局快捷键系统。
- 不持久化 search query 或快捷键偏好。
- 不新增 workflow graph 拖拽排序、拖拽连线或 action reparent。

---

## 14. Mobile / Native Export Strategy

不直接从现有 React web adapter 混改。先做路线评估:

- React Native adapter;
- Capacitor wrapper;
- Tauri Mobile;
- PWA-first。

每条路线需要分别评估 UI-kit、Supabase、navigation、storage、deploy/package。

---

## 15. Plugin / Marketplace Architecture

进入前先定义:

- plugin package format;
- allowed capabilities;
- custom node/action registration;
- install/update/revoke;
- sandbox and review model;
- marketplace metadata and signing。

这属于平台生态能力,不是 Phase 5 第一优先级。

---

## 16. 验证策略

每个 Phase 5 候选都必须至少有:

- compiler/engine unit tests for emitted behavior;
- `.fig` / `.pen` round-trip tests when document schema changes;
- CLI test when adding flags;
- Tauri/browser GUI ACK when adding authoring controls;
- `git diff --check`;
- `bun run check:vue` for Vue changes;
- `bunx tsgo --noEmit` for TS changes;
- focused tests before any broad `bun run check`。

---

## 17. 推荐第一刀

推荐先做 **§4 文档 / Onboarding / Release Notes**。

理由:

- Phase 0–4 已经积累大量真实能力,但分散在内部 phase docs;
- 风险最低,不会碰 compiler/codec;
- 能立刻提升可用性和产品表达;
- 如果优先修用户体验缺口,先做 §6 Preview 圆角裁剪和 §7 代码面板选中态排查;
- §3 轻量 SEO 的 compiler + persistence + ToolDef 小闭环已经完成;下一刀更适合接
  §8 Inspector 折叠面板的 GUI polish,或回到 §2 发布生命周期。
