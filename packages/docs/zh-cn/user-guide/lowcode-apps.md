---
title: 低代码应用
description: 将 OpenPencil 页面转换为可预览、构建和部署的 React 低代码应用。
---

# 低代码应用

OpenPencil 可以把设计页面编译为可运行的 React + TypeScript + Tailwind 静态单页应用（SPA）。你仍然使用普通的 Frame、Text、Button、Input、组件与自动布局完成视觉设计，再通过低代码属性为节点添加状态、表单、导航、API、Supabase、工作流和国际化行为。

## 可以构建什么

- 营销页面、产品页面、仪表盘、表单和数据列表。
- 使用 `react-router-dom` 的多页面 SPA。
- 带本地校验、远程校验和提交工作流的受控表单。
- 使用 Supabase Auth、数据库查询/变更和 Storage 上传的应用。
- 文档级或页面级状态，例如筛选器、开关、计数器和界面状态。
- 支持语言目录、RTL 方向和语言切换器的 i18n 应用。
- GA4、Plausible 或 PostHog 分析，以及受控的静态 Head/CSS 扩展。
- 普通 Tailwind 或受支持的 shadcn/ui 控件输出。
- 可部署到 Netlify、Vercel、Cloudflare Pages 或其他 SPA 主机的静态文件。

## 桌面版与浏览器版

| 能力                               | 桌面应用     | 浏览器应用                        |
| ---------------------------------- | ------------ | --------------------------------- |
| 编辑设计与低代码属性               | 支持         | 支持                              |
| 本地实时预览面板                   | 支持         | 不支持；预览 sidecar 仅用于桌面版 |
| 预览面板中的部署操作               | 支持         | 不支持                            |
| CLI `compile` / `build` / `deploy` | 可在终端运行 | 可在终端运行                      |
| 通过 MCP/AI 操作当前文档           | 支持         | 取决于所连接的工具                |

只使用浏览器编辑时，请先保存 `.fig` 或 `.pen` 文件，再从终端运行 `openpencil compile`、`openpencil build` 或 `openpencil deploy`。

## 推荐工作流

1. 使用普通 OpenPencil 节点完成页面设计。
2. 在设计属性面板中添加低代码行为：
   - **状态**：保存文档级或页面/节点级值。
   - **绑定**：绑定文本、表单值、可见性、列表数据和渲染条件。
   - **事件**：处理点击、提交、导航、API、Supabase 和工作流。
   - **校验**：配置必填项、文本/数字规则和远程校验器。
   - **响应式**：配置断点下的布局与可见性覆盖。
3. 在桌面应用中打开低代码预览面板。
4. 选择 Tailwind 或 shadcn/ui，并按需启用 i18n。
5. 验证交互、失败状态和路由后再构建与部署。

第一次验证建议只创建一个页面：一个 Input 绑定到 `email` 页面状态，添加必填校验，再让一个 Button 更新状态或显示 Toast。确认预览中的值和错误状态正常后运行：

```sh
openpencil build app.fig -o dist
```

这样可以先验证“设计 → 绑定 → 事件 → 预览 → 构建”的完整链路，再引入 Supabase、多页面、工作流或 i18n。

## 表单绑定与校验

校验只会对受控值执行。Input、Textarea、Select、Radio、DatePicker、Checkbox 或 Switch 如果有校验规则但没有 `bindings.value`，请在绑定属性中选择**创建页面状态并绑定**。OpenPencil 会在一次可撤销操作中创建匹配的页面状态并写入引用绑定。

内置 AI 与 MCP 可以先审计，再进行可预览的修复：

1. 调用 `audit_form_controls`。
2. 调用 `ensure_form_value_bindings({ dry_run: true })` 检查计划。
3. 确认后再次调用工具并移除 `dry_run`。

工具不会覆盖已有的有效或无效绑定；无效目标会留给人工处理。审计默认最多返回 50 个控件，可配置到 200 个；结果包含 `total`、`returned` 和 `truncated`。一次修复若缺失绑定超过 199 个，会在修改前失败，请缩小范围后重试。

页面或表单范围的扫描会跳过可复用的 `COMPONENT` 与 `COMPONENT_SET` 主节点。组件主节点内部的字段不能绑定页面状态，应使用文档状态。如果导航或提交必须在校验成功后发生，请把动作配置在 FORM 的 `onSubmit` 事件上。

## 地图模块

从 Interactive（交互）工具组选择 **Map**，再在画布上单击或拖动。地图会保存为普通 `FRAME` 与版本化模块配置，因此即使地图运行时不可用，节点仍可显示、编辑并在 `.fig` 往返中保留数据。

画布使用确定性的离线预览；桌面预览和生成应用使用本地安装的 MapLibre GL。经纬度、缩放、交互和标记均由受控配置提供，不注入 CDN 脚本，也不接受任意供应商代码。OpenStreetMap 署名链接始终可见且不可移除。

内置 OpenStreetMap 栅格源支持 0–19 级缩放，其公共瓦片服务适合普通交互浏览，不适合批量下载、离线包或高流量商业用途。此类场景应使用自托管瓦片或未来的供应商适配器，并遵守 [OpenStreetMap 瓦片使用政策](https://operations.osmfoundation.org/policies/tiles/)。

AI 与 MCP 使用同一模块注册表：`list_modules`、`create_module`、`read_module` 和 `update_module`。只有受信任的内置/已审查适配器才能创建模块；不能借此执行任意第三方代码。

## 预览

桌面预览面板会把当前页面编译成本地 React 应用，并在设计变化后重新加载。画布与预览之间的桥接可让兼容节点的选中状态保持对应。

- **UI**：选择普通 Tailwind 或受支持的 shadcn/ui 输出。
- **i18n**：启用国际化运行时，并输入 `fr,ar` 这类目标语言列表。
- **Motion**：打开 Motion Debug，检查节点、轨道、触发器、播放状态、进度、减弱动效策略和编译警告。
- **Deploy**：发布前运行只读就绪审计，再执行部署。

预览 sidecar 由 Tauri 启动，因此浏览器版不会显示该面板。预览成功并不等于生产环境已正确配置；还必须验证环境变量、CSP、SPA 路由回退、数据库 RLS 和服务端工作流部署状态。

## 事件、工作流与 Motion

事件与工作流可以更新状态、导航、调用 API/Supabase、执行条件分支，也可使用**播放动效**、**停止动效**、**切换动效**和**等待动效**。Motion 保持为受限的声明式 `MotionSpec` JSON，不接受任意 JavaScript 或 CSS。

**等待动效**支持有界超时和可选的超时停止。多页面应用执行导航动作前，会等待当前页面的 `pageExit` 轨道；等待有四秒硬上限，停滞或无限动画不会把用户困在旧路由。

更完整的 Motion authoring、导出和 Figma Motion Plugin API Beta 限制请参阅[英文低代码应用指南](/user-guide/lowcode-apps#motion-and-workflow-actions)。

## 编译为可编辑源码

需要完整项目源码时使用 `compile`：

```sh
openpencil compile app.fig -o generated-app
cd generated-app
npm install
npm run dev
```

常用参数：

```sh
openpencil compile app.fig -o generated-app --page "Landing"
openpencil compile app.fig -o generated-app --ui-kit shadcn
openpencil compile app.fig -o generated-app --i18n --locale fr --locale ar
openpencil compile app.fig -o generated-app --source-locale ar
```

`--page` 只编译一个页面；不指定时会生成使用 `react-router-dom` 的多页面应用。

## 构建静态文件

生成生产用静态文件：

```sh
openpencil build app.fig -o dist
```

部署在子路径时设置 `--base`：

```sh
openpencil build app.fig -o dist --base /my-app/
```

如果要组合多个独立发布的 React 与 Vue 导出，请使用显式微前端打包参数，并参考
[微前端组合](./microfrontends)构建路由与插槽 Shell；没有这些参数时，原有 standalone
构建路径保持不变。

Supabase 的生产环境公开值应来自环境变量或命令行，而不是依赖设计时回退值：

```sh
VITE_SUPABASE_URL=https://example.supabase.co \
VITE_SUPABASE_ANON_KEY=... \
VITE_SUPABASE_SCHEMA=app \
openpencil build app.fig -o dist
```

也可以使用参数：

```sh
openpencil build app.fig -o dist \
  --supabase-url https://example.supabase.co \
  --supabase-anon-key ... \
  --supabase-schema app
```

## Supabase 与运行时就绪检查

根节点的 **Supabase** 面板会区分浏览器公开配置和管理访问：

- 项目 URL、publishable/legacy anon key 与可选 schema 可以进入浏览器运行时。
- 已知 `sb_secret_*` 和旧版 `service_role` key 会在写入设计或客户端 Bundle 前被拒绝。
- **数据库结构**检查器使用统一凭据存储中的 Supabase Personal Access Token。PAT 不会写入 `.fig` 或响应式编辑器状态；缓存只保存有界、规范化的表/列/关系目录。
- RLS Advisor 生成的是可审查起点，不证明数据库已经应用策略。`UPDATE` 与 `DELETE` 通常还需要相同用户行的 `SELECT` 可见性。

部署前，桌面 Deploy（部署）面板会执行相同的只读检查。AI/MCP 的 `audit_application_runtime` 只报告配置准备度、表命令、schema 不匹配、服务端环境变量**名称**和工作流部署需求；它不会返回秘密，也不会声称检查了实时 RLS 或部署状态。

从配置、RLS、环境隔离到服务端部署的完整清单，请参阅[应用运行时指南](/zh-cn/user-guide/application-runtime)。

## 服务端工作流

文档级服务端工作流与客户端 `lowcodeWorkflows` 相互独立：

- 每个端点都是通过 Supabase 用户身份验证的 `POST` 请求。
- 支持受限表达式、用户范围的 Supabase 查询/变更、条件、返回值、其他已验证工作流和 HTTPS 请求。
- 私密值只能引用服务端环境变量名称，不能写进设计。
- 生成的处理器会拒绝超大/畸形请求、未登录调用、带凭据或指向本地/私有网络的 URL、长时间请求和超大响应；它不会创建 service-role 客户端。

`compile` 会输出：

- `supabase/functions/openpencil-runtime/index.ts`
- `.env.server.example`
- `openpencil-server.manifest.json`
- `SERVER_DEPLOYMENT.md`

`build` 将这些文件保留在 `<outDir>/openpencil-server/`。静态 `deploy` 只上传浏览器文件，并打印手动执行 `supabase functions deploy openpencil-runtime` 的步骤。OpenPencil 不会自动关联 Supabase 项目、上传函数或配置秘密。

## 部署

`deploy` 会先构建，再上传到指定供应商。

Netlify：

```sh
NETLIFY_AUTH_TOKEN=... \
openpencil deploy app.fig --provider netlify --site my-site
```

Vercel：

```sh
VERCEL_TOKEN=... \
openpencil deploy app.fig --provider vercel --site my-project
```

Cloudflare Pages：

```sh
CLOUDFLARE_API_TOKEN=... \
openpencil deploy app.fig \
  --provider cloudflare \
  --account-id <account-id> \
  --site my-pages-project
```

Cloudflare 也可以从 `CLOUDFLARE_ACCOUNT_ID` 读取账号 ID，或使用 `--site <account>/<project>`。自动化场景可添加 `--json`，获取 provider、deployment ID、URL 和文件数量。

## 安全边界

::: warning 注意
不要把秘密写入设计文件或生成的 SPA。`.fig`、生成源码与浏览器 Bundle 都可能被最终用户读取。
:::

- 低代码输出是静态 React SPA，不是 SSR 或 SSG。
- Supabase 客户端只能使用 publishable/anon key；`service_role`、PAT 和其他管理秘密必须留在凭据存储或服务端。
- Stripe Checkout 与 Customer Portal 动作只负责调用你自己的服务端端点并跳转。`STRIPE_SECRET_KEY`、Webhook 签名秘密、幂等、订阅与客户查询必须在服务端实现。
- Analytics ID 是公开的客户端标识，不是服务端 API key。按需启用 DNT/Consent，并验证部署 CSP。
- Custom Head/CSS 仅支持静态标签和 CSS。不会输出原始 `<script>`、行内事件处理器或外部 JavaScript 模块。
- 多页面 SPA 的托管环境必须把未知路径回退到 `index.html`。
- 供应商 Token 应通过环境变量或 CLI 参数传入，不应进入设计文档。

## 上线前检查

- 桌面预览可打开并渲染目标页面。
- Button、表单校验、成功与错误分支都实际执行。
- Supabase 查询/变更具有加载、空数据和错误状态，并人工验证所需 RLS。
- i18n 目录完整，RTL 页面方向正确。
- `openpencil build app.fig -o dist` 成功。
- 托管平台支持 SPA 回退；刷新深层路由不会返回 404。
- 自定义外部资源符合 CSP；分析与付费动作没有泄露秘密。
- 服务端工作流已单独部署，所需环境变量只存在于服务端。

## 常见问题

- **预览不可用**：请使用桌面应用；浏览器版没有本地 preview sidecar。
- **Supabase 只在预览中工作**：为 `build` / `deploy` 设置 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY`，或使用相应 CLI 参数。
- **部署后的路由刷新返回 404**：把主机配置为 SPA，并将未知路径回退到 `index.html`。
- **Cloudflare 上传前失败**：传入 `--account-id`，设置 `CLOUDFLARE_ACCOUNT_ID`，或使用 `--site <account>/<project>`。
- **i18n 有缺失翻译**：检查生成的 `src/locales/_coverage.json` 并补齐目标语言目录。
