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
  第一刀已在用户指南内加入 demo checklist;真实 demo 文件仍可后续补。**
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

### 10.2 风险

- CSP / privacy / cookie consent。
- 不同 provider SDK 加载方式不同。
- 不能把 analytics secret 写进 document。

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

---

## 12. Stripe / Paid App Primitives

### 12.1 问题

真实商业 app 需要 checkout、subscription、webhook、customer portal。但静态 SPA
不能安全持有 secret key,必须依赖 Supabase Edge Function 或用户自有 backend。

### 12.2 初始方向

- Stripe checkout action 只调用 server endpoint。
- Supabase Edge Function template 作为推荐后端。
- 文档明确 secret 只进 server env,不进 `.fig` / compiled SPA。

---

## 13. Workflow DAG Editor

当前 workflow runtime/action chain 已可表达大多数业务流程。DAG editor 是 authoring
体验升级,不是 runtime 必需。进入前先评估:

- 是否真的需要 graph,还是当前递归 editor + named workflow 足够;
- DAG 到 ActionDef chain 的序列化规则;
- cycle detection / branching / join semantics;
- UI complexity 与 Tauri/browser E2E 成本。

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
