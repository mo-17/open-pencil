---
title: Backend Provider 架构
description: Provider-neutral Backend、声明式插件、可信 Compiler Adapter、Host Release Controller 与 Supabase 上线边界。
---

# Backend Provider 架构

OpenPencil 把“描述后端需求”“生成后端产物”和“真实修改云端”分成不同权限：

```text
SceneGraph / 旧 Lowcode
  -> Provider-neutral BackendApplicationSpecV1
  -> data-only backendProviders 声明
  -> Host 审查过的 Compiler Adapter
  -> 确定性 Backend Artifact
  -> Host Inspect / Review / Confirm / Apply / Verify / Receipt
```

## 当前已实现

- `@open-pencil/lowcode/backend`：严格、可摘要、Provider-neutral 的 DataModel、Auth、Workflow、Storage、分阶段 Migration、源码 Ledger 与 Release Core。
- `@open-pencil/plugin-contracts`：Manifest v2 的 `backendProviders` 只声明身份、版本、能力、配置 Schema 与输出类型，不能携带代码、SQL、URL、Secret 或 Executor。
- `@open-pencil/compiler/backend`：静态可信 Registry、能力协商、纯 `plan/emit`、Fake Provider 与内置 Supabase Bundle。
- App Host：精确绑定安装状态、publisher/package digest、Provider/Adapter 版本和能力；MCP/AI 只能执行无副作用的 bounded plan/audit。
- Host Release Controller：本地实现了最终重新 Inspect、drift 检查、durable atomic dispatch claim、重启 reconcile、`outcome-unknown`、Verify 状态与无 Secret Receipt；IndexedDB journal 会跨 Desktop 重启保留 pending/applied/failed/unknown 结果。
- 可视化 Backend 编辑器：Design 面板可以编辑 DataModel、relation、owner/tenant、RLS、workflow、Storage 与可信 Provider，并显示 migration diff、风险和 destructive 警告；保存只修改文档声明。
- 安全 repeat migration：显式 staged execution 支持带索引 FK、unique、UUID/identity default、typed backfill、non-null、rename 与 expand/backfill/contract phase；不会扩展旧 staging live Apply 白名单。
- 源码迁移 Ledger：Desktop 可导出 digest 绑定的 migration ZIP；普通与 staged review 都同时进入 inspected-source 与 promotion ledger，并约束 source→dev→staging→production、drift、rollback/restore 与 approval。
- Edge Function authority：本地已有受限 Management deployer、Secret 名称检查、认证 health invoke 与无 Secret Receipt。
- Storage authority：本地已有 bucket/路径/RLS 生成、只读 bucket 检查、双账号 CRUD/upsert/越权/MIME/大小真实探测接口与 Receipt。
- React/Vue Web：均生成 Supabase Auth、CRUD、Storage upload 与携带 session JWT 的 Edge workflow invoke，并共享请求防重入、节流、防抖和 pending/disabled 状态。
- Desktop Supabase Backend Provider Review：Packaged Tauri 中已有显式、独立于 frontend deploy 的 review-only 入口；Browser 不可用。
- Desktop Supabase staging Apply：Packaged Tauri 中已有独立显式的 safety MVP，只接受空 managed baseline 上已审查的 `create-enum` / `create-entity` SQL；repeat migration、Browser、CLI 与 production Apply 仍不可用。
- Desktop 静态部署：可以完成前端上传，但会返回 `backendDeploymentRequired: true`。前端确认不会被当作 Backend Apply 确认。
- CLI：提供 `backend validate/plan/emit/audit/release`，但全部是 local-only；`release` 会在 Apply 前阻断。

普通 `compile()` / build 可以通过 `CompilerOptions.backendProvider` 接收 Host 已解析的纯数据
`CompilerBackendProviderRequest`。App 必须在编译前调用
`prepareAppBackendProviderCompilerOptions()`，用当前安装、启用/阻断、package digest、Digest Pin、
publisher review 和 Adapter authority 重新解析文档声明；Compiler 不导入 App，也不会获得 Store、
Credential、网络或可执行插件代码；`compileAppBackendProviderDocument()` 把 authority 解析与同步
`compile()` 保持在同一次 Host 调用中，并仍会通过静态 Registry 重新执行确定性的 validate/plan/emit。
显式 request 无效或 Host authority 不可用时会直接阻断，不会回退到旧 Supabase。显式 request 与旧
Supabase Backend intent 同时存在、文档重复声明，或 options 已预填第二份显式 request，都会按双重
authority fail closed。只有完全没有显式 request 时才保留 legacy lowering。

## 当前明确限制

- Desktop Review 已接入固定只读 `pg_catalog` Inspector、Management project authority 校验与 Credential grant generation；CLI 仍不接入这些 live 能力。
- 只有 Desktop staging safety MVP 接入 database Executor 与 post-Apply catalog Verifier；Edge/Storage 使用彼此独立的 operation-scoped authority，但尚未由普通 build、Browser 或 CLI 自动执行；production database executor 仍不可用。
- Inspected migration review 既接受空基线，也接受全部结构成员都有精确 OpenPencil marker、并通过同一 snapshot 的 OID/attnum 地址校验后还原出的 managed 基线；普通 repeat review 仍只开放新增 enum value、nullable field 和普通 index，更高风险的支持项必须进入显式 staged phase。
- Desktop review 面板可选导入有大小上限、无 Secret 的 `StagedMigrationExecutionPlanV1` JSON；Host 会在读取 Credential 或发起网络请求前完成严格校验与规范化，并显示 phase、操作数与风险，再把它绑定进 inspected artifact 和源码 ZIP。普通迁移不选择该文件。
- 未纳入 staged vocabulary 的 FK/non-null/rename/destructive 变更、任意默认表达式、未知 ACL、第三方 permissive policy、当前 inspection database role 的非 owner default privilege 和名称冲突均不会生成可执行 SQL。
- Review artifact 自身始终保持 `applyAllowed: false` 与 `releaseReady: false`；只有独立 staging authority 能消费其精确 digest，且不会产生 production-ready 结论。

## Supabase 安全边界

每次 review 都要求完整、未截断的 project/account/query provenance，以及 object、column、constraint、index、RLS policy、ACL 与当前 inspection database role 的 default ACL inventory。每个 table column 必须携带来自 `pg_attribute.attacl`、进入 digest 的“无 column-level grant”证据；固定 provenance 查询还会证明 table、partition、view 与 materialized view 均不存在 column ACL。一旦任何 relation 存在 column ACL，就会在 snapshot 授权 review 前阻断。Enum column 必须按精确 type OID 与 Schema 绑定到已检查的 `public` enum，不能只靠同名恢复。第一轮 proposal 会为新建的 enum、table、column、constraint、index 与 policy 写入精确 `COMMENT` marker；下一次 inspection 必须把这些 marker 绑定到同一 snapshot 的 PostgreSQL OID/attnum 地址，并从实证还原当前 `DataModelIR`。Managed table 的每个结构成员都必须有正确 kind/id 的 marker；未标记成员、伪造/畸形 marker、constraint-backed index 混入普通 index、或没有同时启用并强制 RLS 都会 fail closed。已标记 policy 会在同一个 review transaction 中显式 drop/recreate；只有与目标完全相等的 runtime grant 集合才会复用。新增 enum value 必须作为一份独立 migration review；同一 plan 只要还包含其他 operation 就会 fail closed，避免在创建新值的事务提交前消费该值。

固定查询会排除该角色固有的 owner 权限以及其他 Provider system role 所有的 defaults；Supabase `public` Schema 对 `PUBLIC`、`anon`、`authenticated`、`service_role` 和 inspection database role 的标准、不可转授 `USAGE` 被视为安全 provider baseline。`CREATE`、grant option、额外 object grant、第三方 grant，以及任何会影响 OpenPencil 新建对象的非 owner default grant 仍会进入 snapshot 并阻断。database role 本身也绑定进 provenance 与 inventory digest。`anon`、`authenticated` 和 policy/ACL 引用的每个 grantee 都必须有完整的 `rolsuper`、`rolbypassrls`、`rolinherit` 证据；role membership 保留 grantor 以及 PostgreSQL 16 的 `admin`、`inherit`、`set` options，ACL/default ACL 也保留 grantor 与 grant option。无法证明这些 membership options 的旧 catalog 必须在生成 snapshot 前失败，不能默填“安全”默认值。上述角色、membership 与 ACL 字段全部进入 inventory digest；缺字段或 tamper 会失败。

被引用 runtime role 具有 superuser/`BYPASSRLS`、存在直接或传递的父角色 membership，或 ACL/default ACL 带 grant option 时，整份 review 都会阻断。OpenPencil 不生成 `ALTER ROLE`、membership `GRANT`/`REVOKE`、grant-option 或 default-ACL 修复 SQL；这些外部权限必须由 operator 先处理，再重新 Inspect。

固定 catalog inspection 会为每个 `public` view 记录精确的 `security_invoker` 选项。它通过 `pg_options_to_table` 和 PostgreSQL boolean cast 解析 `pg_class.reloptions`，因此会规范化 PostgreSQL 接受的 true 写法，而不是匹配原始字符串。只要无法证明该值为 `true`，整份 migration review 就会阻断；OpenPencil 不会静默修改 view 或臆造补偿性 `REVOKE`。`public` Schema 中的 `SECURITY DEFINER` function 仍是必须由可信 operator 单独复核的 blocker。

安全 additive proposal 的顺序是：

1. `CREATE TYPE` / `CREATE TABLE` / 普通 index；
2. 对每个新 managed table 执行 `ENABLE ROW LEVEL SECURITY` 和 `FORCE ROW LEVEL SECURITY`；
3. 只从可精确翻译的 allow/deny intent 生成 policy；
4. GRANT 先取“Workflow 实际操作”和“显式 allow rowAccess 操作”的并集，再仅保留可生成 allow policy 覆盖的操作；UPDATE/DELETE 同时需要 SELECT；
5. 最后提交短事务。

OpenPencil 会在强制 RLS 与 policy 创建之后显式生成最小权限 table GRANT，不依赖 Supabase 旧的默认
table privilege，因此兼容 2026 年的
[Data API 暴露规则变更](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)。

任一 blocker 存在时，review 文件只包含注释，不包含 `BEGIN`、DDL、policy 或 GRANT。不会生成 `service_role`、`GRANT ALL`、默认权限修改或通用 down migration。

## Release 与 CLI

Backend Release 必须独立经过：

```text
Inspect -> Plan -> Emit -> Review -> Confirm -> Apply -> Verify -> Receipt
```

Apply 前必须重新 Inspect。Document/IR/schema、target、environment、Provider package/adapter、project、account、grant generation 或 migration plan 任一变化都会使计划 stale。Dispatch 后 timeout/abort/transport error 记录为 `outcome-unknown`，禁止自动重试，必须先重新 Inspect 并 reconcile。

Desktop 的 Supabase 配置面板提供单独的 **Backend Provider Review** 按钮。它不会随文档打开、Schema 浏览、frontend build 或 frontend deploy 自动执行。每次操作都会从 active editor graph 重建 Backend request，从 live App store 重新解析 Provider authority，仅在操作期间解析 Management PAT 与 grant generation，并且当前只接受精确的 `public` Schema。项目 organization authority 校验通过后，Host 只向 Management API read-only query endpoint 发送一条由固定白名单机械组合的 aggregate SQL；十组 catalog 结果来自同一个 PostgreSQL statement snapshot，不声称存在 session 级 `repeatable-read` transaction。Caller SQL、custom Schema、redirect、authority 缺失、响应形状错误、row-limit tamper，以及 graph/config/Provider/grant 在网络期间变化都会 fail closed。

PAT 不进入 reactive state、SceneGraph、Artifact、Manifest、日志或 Receipt。生成的 artifact 始终保持 `applyAllowed: false` 与 `releaseReady: false`，不能自行授权 mutation。Packaged Tauri 另有独立 staging action：必须单独保存具备 database-write 权限的 Management PAT，精确绑定并再次确认独立 staging project ref，才可消费该 artifact 的精确 digest。Browser 与 CLI 中该入口不可用，当前自动测试只用 fake transport 验证接线，并未证明真实 Supabase 项目连通。

Staging executor 只接受空 inspected OpenPencil-managed baseline、Compiler 已审查的 `create-enum` / `create-entity` operation 集合与精确 SQL digest。这里的“空”是没有 managed entity、enum、relation 或 catalog object，并不要求 `public` 中没有无关 external object；但 external object 不得与计划名称冲突。repeat `add-*` migration 仍可生成 review artifact，但不能使用本轮 live Apply。caller SQL、destructive operation、review/Provider/package/project/organization/grant/graph/config 任一变化都会 fail closed。Host 在 prepare 前校验 project authority，再次检查 catalog，并在精确 Management API query 请求前最后重验本地与远端 authority。Read PAT 与 Write PAT 必须不同、分槽保存，并且只在本次 operation 中解析。Host 不自行 introspect PAT scope，所需 database-write 权限最终由 Supabase API 接受或拒绝。

Durable journal 在真正 dispatch 前同时原子 claim semantic release key 与独立的 Provider/project mutation scope。切换 target、environment、document、account 或 grant generation，均不能绕过同一远端项目的 pending / `outcome-unknown`；旧版未决 journal 会按 project 保守阻断。Management query endpoint 不返回 durable remote operation ID，因此不能仅因生成新 review、catalog 仍等于派发前基线或本机时间已经过去，就把不确定请求视为失败。Supabase 的只读对账必须继续锁住 pending/unknown claim，直到 Provider 权威证据能把精确 operation 绑定到终态；Management query endpoint 当前还没有这条证据路径。证据不可得时，新的独立 staging project 拥有不同 mutation scope，是安全的继续方式。对账操作本身绝不重试；旧 claim 终结后，operator 仍需重新生成并确认一次 review。已知 Apply 响应后再 Inspect，并把完整的 timestamped capture digest 绑定进 verification evidence。JWT 下的 Auth 与表级 row-policy 仍是独立 `unknown` gate，直到匿名、owner、跨用户行为取得可信证据；Storage 双账号验证不能替代表级 RLS。`productionReleaseReady: false` 属于 Desktop staging result，而不是 `BackendReleaseReceiptV1` 字段。

新的 claim 会在 executor 的 dispatch 方法可能运行前先持久化切换为 `outcome-unknown`。越过这条边界后，
任意非成功结果都继续保持 unknown；lease 过期或结构化返回一个 `failed` 都不能释放 project scope。
read-only reconciliation 只有拿到与精确 single-flight key、release、plan 和 remote operation IDs 绑定的
一次性 opaque 正向 proof，才能结算为 `applied`。当前 Supabase reconciler 有意只返回
`outcome-unknown`，因为 Management endpoint 无法提供这份 proof。

### 源码迁移与环境提升

每份 ready 的 inspected review 都可以在 Desktop review 面板显式导出 ZIP。ZIP 包含精确的
`supabase/migrations/<UTC timestamp>_<slug>.sql`、
`supabase/openpencil-inspected-source-ledger.json`、`supabase/openpencil-migration-ledger.json` 与 digest
绑定的 Host export manifest。inspected-source ledger 为普通 additive 与显式 staged review 保留 review、
Provider emission 和源码证据；promotion ledger 则为每份源码 SQL 绑定精确执行权限。显式 staged review
保留审查过的 phase plan；普通安全 review 由 Compiler 规范化成唯一一个低风险
`apply-reviewed-migration` expand operation，精确绑定全部 source operation id、review manifest、migration
plan 与最终合成 SQL digest。存在 inspected Storage 差异时，该最终 digest 也覆盖 Storage SQL；因此只有
这种完整 digest 绑定的权限可接受空 source-operation 集合，例如纯 Storage 变更。只有首次导出可以不选择两个
Ledger；后续导出必须导入上一份 ZIP 中的两个 Ledger，否则会明确开始一条分叉历史。存在 Storage policy
artifact 时，Host 只接受两份可信 SQL 的精确事务包装，并将 Schema 与 Storage 变更合并进同一个外层
`BEGIN`/`COMMIT`，不会只提交其中一半。Host 会在选择保存前、写入前和
保存返回后重新解析 live document、配置、reviewed build 与已安装 Provider authority。导出接口不接受
Credential，不会写入仓库，也不会执行 SQL；一旦保存已经开始却无法确认结果，会返回
`outcome-unknown`，重试前应先检查所选目标。

离线 CLI 让 promotion ledger 成为 Operator/CI 可直接使用的产品入口，而不再只是库 API：
`openpencil backend ledger inspect <ledger> --source-root <repo> --json` 会校验完整的 digest 绑定历史，
并重新计算显式源码根目录下每个普通、非符号链接 migration 文件的 digest；
`openpencil backend ledger transition <ledger> --event <event.json> --source-root <repo> --output
<next.json> --json` 只有在结果账本引用的全部源码文件校验通过后，才会向一个新文件追加一条通过校验的
registration、promotion、drift、rollback、restore 或 authority-rebind 事件。它绝不覆盖输入或既有输出，
也没有网络、Apply 或 Deploy 权限。需要明确创建独立历史时，可运行
`openpencil backend ledger init --ledger-id <id> --created-at <UTC> --output <ledger.json>`。Provider/CI
自动化必须在 `event.json` 中提供无 Secret Receipt；CLI 只校验 Receipt，不会伪造远程证据。

Operator 需要解压并审查这些文件，再合并进源码仓库。用 `supabase migration list` 检查链条，先以
`supabase db reset` 做本地演练，再通过受控的 `supabase db push` 提升；把复制的 SQL 直接贴到远程
SQL Editor 不会更新 OpenPencil 源码 Ledger。Promotion ledger 只允许
`source -> dev -> staging -> production`，目标环境必须有无 drift
证据，执行必须有成功 Receipt，backfill/contract 必须有前序 phase Receipt，production 或 destructive
动作还必须携带精确 scope 的人工 approval。Drift、rollback 与 restore 都是显式记录；未知执行结果不会
被静默提升。这与 Supabase 的
[源码迁移流程](https://supabase.com/docs/guides/deployment/database-migrations)一致，但本地生成不等于远程部署。

PAT 轮换不会静默改写环境 authority。显式 `rebind-environment-authority` 事件只能改变
`grantGeneration`；Provider identity、authority digest、project、account 与 environment 必须逐项保持一致。
事件必须引用该环境最新的一条历史事件，且它必须是针对当前 schema 的成功 no-drift 检查；同时还要嵌入旧、
新 authority 各自独立 digest 的成功 Provider Receipt。两份 Receipt 都必须明确证明
`unresolvedMutation: false`；复用、过期、失败、未知或绑定不一致的证明一律 fail closed。production 还必须
携带 scope 精确为 `production` 的人工 approval。rebind 作为不可变历史追加，并通过 replay 推导新的环境摘要；
之后的 drift、promotion 与 recovery 证据都必须使用新 generation。离线 CLI 只校验调用方提供的证明；如果
Provider/CI 无法权威证明不存在未决远端 mutation，轮换将保持阻塞，不能从本地状态推断放行。

### Edge Function 与 Storage 发布证据

Supabase Edge runtime 现在是实际可审查的 Deno source：强制 JWT、限制 workflow 输入/响应、提供固定
health workflow、拒绝自动 redirect 与私网地址，并要求精确 outbound host allowlist。独立 Host transport
会重验 project/organization，检查必需 Secret 的**名称**而不是值，生成有大小上限的确定性 ZIP，通过
Management API 以 `verify_jwt=true` 部署，再用已认证用户 token 调用 health，最后生成无 Secret Receipt。
Supabase 当前会注入 `SUPABASE_URL` 与 `SUPABASE_PUBLISHABLE_KEYS`；只有应用自定义名称（例如 outbound
host allowlist Secret）才要求出现在 Management Secret inventory。参考 Supabase 的
[Edge Function 部署](https://supabase.com/docs/guides/functions/deploy)与
[Secret 管理](https://supabase.com/docs/guides/functions/secrets)。

Storage IR 会生成 review-only bucket 配置与 `storage.objects` RLS matrix。Owner predicate 使用
`(select auth.uid())`；tenant path 只查询明确声明的 membership table；upsert 必须同时具备
SELECT、INSERT、UPDATE。React/Vue 上传生成器对 private bucket 只写回对象路径；只有显式
`public-read` bucket 才生成 `getPublicUrl`，private 下载必须经过另行授权的签名 URL workflow。
Live verifier 会重新绑定 project authority，用 read-only catalog query 核对
bucket 限制，分别通过 `/auth/v1/user` 绑定两个不同会话，并测试 owner CRUD/upsert、匿名拒绝、User B
拒绝、路径逃逸、MIME 与大小拒绝。最大对象不超过 16 MiB 时会用精确的 `max + 1` 上传验证拒绝；更大
上限改由只读 bucket catalog 证明，避免授予超大测试上传权限。第一次 object 请求后遇到
transient/ambiguous response 会生成
`outcome-unknown`，不会自动重试。只有 exact、成功且无残留对象的 Receipt 才能通过 Storage gate。
参考 Supabase 的 [Storage RLS](https://supabase.com/docs/guides/storage/security/access-control)。

独立的 **预发布后端能力验证** 操作会先证明 inspected Schema 已精确达到本次 review target，再由真实
Desktop Host composition 生成 Edge 与 Storage Receipt。用户 JWT 只存在于本次 operation，dispatch 前
即从表单清空且绝不持久化。Verifier 会拒绝 project/account/grant/Provider 不匹配、Secret 不完整、未认证 health、public-read 或
不能完整探测的 Storage rule、未来时间、重复覆盖，以及绑定到另一 artifact 的 Receipt。Receipt 不能用
自身字段选择 expected digest；Host credential ref 在接入另一条可信 credential-evidence authority 前仍为
`unknown`。表级 Auth/RLS 证据仍然独立，因此 Edge/Storage 全部通过时整体 staging Receipt 仍可能是
blocked，且永远不会开启 production readiness。

CLI 接收的 gates JSON 是调用者提供的数据，因此报告 `gateEvidenceTrusted: false`。即使所有 gate 写成 passed，没有 Host authority 绑定且可接受的 Receipt，`auditPassed` 仍为 false。Compiler plan digest 也不会冒充 Host Release plan digest。CLI 不拥有 App 的已安装 package 生命周期、publisher review 或 live Store authority，因此不会把文档中的原始 `backendProviders` 声明直接当作可信 Adapter 权限；应使用 Desktop Host 导出，或给 CLI 显式传入本地 Backend spec。

## P2 Contract Foundation

P2 不会静默扩大 v1 文档的权限，而是从新的语义版本开始。`BackendApplicationSpecV2` 保留
Provider-neutral 的数据、Auth、workflow、Storage、capability 与 Secret reference，并新增各自版本化的
Realtime、atomic transaction、data migration/backfill 与 automation IR。严格兼容 lowering 会把已验证的
v1 应用映射成 P2 section 为空的 v2；既有 v1 parser 与 canonical bytes 不变。P2 parser 只接受有界 plain
data，拒绝未知字段和未声明引用，并从实际使用派生 required capability，不能用漏写或 optional 声明隐藏
运行时需求。

Backend Provider contract v2 是独立 opt-in 的 data-only contract。它可以声明 P2 能力与 model v2 支持，
但依然不授予 network、Credential、filesystem、process、Apply 或 Deploy 权限。它暂时不会进入既有已签名
Manifest schema v2 的解析路径；启用它需要显式的 Manifest/Host authority revision 与审查过的 registry
adapter。因此，内置 Supabase contribution 在 P2 artifact、release 与 live verification 完成前仍保持
contract/model v1，不能提前宣称支持。

Production evidence 也不再要求每个应用通过同一份固定列表。v2 foundation 会派生 3 个完整性 invariant，
再从 normalized IR 的实际能力派生精确 evidence 与 verifier check；其中数据库变更事件使用独立的
`events.data-change` capability，入站与出站 Webhook 还要求验证 dedicated HMAC credential purpose；出站
投递另外要求 Host 验证 endpoint authority 与 endpoint credential generation。未知
capability，以及缺失、过期、未来时间或应用未要求的 evidence 都会 fail closed。Receipt digest 只能证明
完整性；release readiness 仅在 Host 已认证 subject 与 accepted receipt store 的上下文中成立，不能代替已有的
authority-bound Backend Release receipt。

Automation 与 observability capability 还必须提供超出通用 capability Receipt 的专用 verifier check：精确的
idempotency-ledger CAS、有效 Queue lease 与 terminal CAS、transactional Outbox CAS、retry disposition 与
DLQ publish-before-source-archive 顺序，以及 operational-event sink CAS。仅声明 capability 或提供一份通用
成功 Receipt，不能代替这些 durable-state 证明。

`BackendOperationalEventV1` 是不含 payload 的 append-only envelope，绑定 Provider、environment、authority、
release/plan/single-flight/remote-operation id、phase、outcome、duration、稳定 error code、evidence、trace 与
前一事件 digest。验证必须提供 Host 已认证的 head、clock、domain 与前一个已关闭 segment 边界；append 会在
异步 hash 前把输入解析为 immutable snapshot，并返回必须用于持久化 CAS 的 expected head。Host 还必须全局
预留 event/attempt ID，并用同一个 head 做 atomic compare-and-swap。这样有界事件链可检测修改、删除、乱序、
重复、未来时间、并发 single-flight attempt 与未授权尾部插入；事件绝不记录请求/响应 body 或 Credential。

第一个 Provider v2 切片现在会生成 private Supabase Realtime Broadcast 审查包。Auth、migration、
security-policy 与 Realtime adapter 分别承担精确 capability；common adapter 在 v2 专用路径下复用已经验证的
v1 target schema、必须 inspection 的 migration 与 owner-RLS 审查产物。Realtime adapter 生成 owner topic 的
SELECT policy、只发送最小 invalidation payload 的有界 trigger function，以及不接收或保存 token、只使用 Host
已认证 Supabase client 的 React/Vue helper。该 bundle 仍是隔离的 candidate：未进入 built-in registry、
compile、App 或 CLI 路径，不授予 Apply/Deploy 权限；真实 staging 仍必须完成 source ledger、Dashboard、既有
policy inventory、可信 release、A/B 隔离、refresh、reconnect、trigger 与 dispose 检查。

第二个隔离的 Provider v2 切片在 adapter `2.1.0` 中引入，并生成一个有界 atomic transaction
审查包。它只接受：一个 transaction、一个源码管理 entity、互不相同且 non-null 的 UUID 主键与 owner
字段、一个默认值为字面量 0 的 non-null `int8` version 字段，以及 expected-version update。生成的 public
PostgREST function 使用 `SECURITY INVOKER` 和 serializable isolation，校验 `auth.uid()`，锁定 owner row，
执行 compare-and-swap update，并在 commit 前校验 version 后置条件；函数 EXECUTE 只授予
`authenticated`。Apply-time catalog preflight 会绑定 managed table、field、primary key、forced RLS、预期的
owner policy name/command/role/marker、table ACL、function signature/configuration 与最终 function ACL。
React/Vue neutral client 只发出一次 `.rpc()`，不会触发 response accessor，只接收已知 PostgREST transport
envelope，返回固定 typed error，并且既不自动 retry，也不接收 Credential。

这个 atomic slice 刻意保持 **non-exclusive**，且不是 release-ready。P1 owner RLS 与 authenticated table
SELECT/UPDATE grant 仍允许通过 REST 直接访问，所以它只保证这一次已审查 RPC call 内部的原子性，不能
宣称所有写入都被强制纳入 compare-and-swap。该 package 尚未绑定 P1 source-ledger Receipt、精确 P1
artifact digest 或 owner-policy expression evidence，未进入 built-in/compile/App/CLI/Apply 路径，也没有真实
staging 的 PostgREST schema cache、A/B 隔离、并发冲突与 rollback 证据。

第三个隔离切片在 candidate adapter `2.2.0` 中加入严格的 data migration/backfill 审查包。它只
接受一个源码管理 entity 和一个 `set-literal` migration；cursor 必须是 non-null、单列 `int8` identity
主键。target 必须同时是 null predicate 与 field-not-null 后置条件所引用的同一字段，并呈现 live nullable、
desired non-null 状态；literal 会再次按 field type 与 enum domain 校验，并拒绝 NUL 与不成对 UTF-16
surrogate。主键、unique、外键、owner、tenant 与 membership 字段都会被拒绝。第一版还拒绝带任意
secondary index、unique constraint 或 foreign key 的 source model，使 live review 可以要求它们完全不存在。
adapter 只生成确定性的 migration plan、review manifest 和 SELECT-only query template，不生成 client
config、DML/DDL runner、Credential、Apply hook 或 release-ready 声明；raw planner 与 SQL emitter 也不会
从 Compiler public API 导出。

查询模板只报告 **partial checklist，绝不等于 live evidence**：managed marker、主键精确列形状、forced
RLS、identity `ALWAYS`、sequence 的 ownership/increment/cache/cycle/range/state visibility、
primary-server 状态、target 的 OID/type-kind/typmod/generated shape、enum marker 与有序 labels、default
是否存在、整表 write-hazard 计数、current/session role、`row_security`、`search_path`、object OID、
observed high-water candidate 与一批 keyset pagination 预览。整表 hazard gate 会保守阻断所有 non-primary index、
unique/exclusion 或 CHECK constraint、outbound foreign key、generated column 与 inheritance edge，避免在
没有 trusted Inspector 时把 expression、partial 或 INCLUDE index metadata 误判成安全。主键检查有意使用
稳定 marker 加有序列号，不再根据当前 table/field 名重算 constraint name，因此合法 P1 rename 不会造成
永久误拦截。Receipt chain 总上限为 10,000，其中 index 0 专用于 high-water，所以最多只能有 9,999 个
batch checkpoint 与 `batchSize * 9,999` 条 matched row。估算使用完整 cursor range，而不是只数仍满足 null
predicate 的行，因为每个被扫描区间都必须推进 Receipt head。

这个 backfill slice 同样仅供审查，并非 release-ready；manifest 会把 `catalogChecks.required` 与
`observed: null` 分开。SELECT 可能调用 policy function，RLS 也可能隐藏行，因此模板本身既不能证明无
副作用，也不能证明全量可见。未来 trusted Host 必须绑定固定 current/session role 与 search path，在数据库
强制的 read-only transaction 中使用 `row_security=off` fail-closed 语义，并验证完整 ACL、role membership、
policy、trigger、rule、function、enum/default 与 table-hazard inventory。capture 前还必须安装阻止新增 NULL
的 write barrier 并取得已审查的 lock；每批与最终 postcondition 前都要重绑 live table/column/sequence OID
与 catalog digest。live catalog 证据、转换为 `GENERATED ALWAYS`、cursor immutable/source
append-monotonic 证明、sequence/cursor mutation authority、source-ledger/artifact/Provider authority 绑定、
atomic database batch ledger、receipt-v2 authority、实际有界 mutation runner、退役 P1 unbounded backfill、
dry run 与精确 postcondition 仍全部是 blocker。

第四个 review-only 基础切片把 candidate adapter 更新为 `2.3.0`，并新增公开的
`createSupabaseBackfillInspectionSubjectV1()`。它只接收 trusted Provider Registry、已经验证的 V2 plan 与
current selection，并在内部重新 replan/emit 与校验 application/plan/adapter-plan/manifest digest，然后生成绑定 Provider package authority、
应用、migration、managed marker、预期 PostgreSQL type/default/enum 和三个审查 artifact digest 的 canonical
Inspection Subject。该 Subject 只允许 Host 选择自己内置的 catalog-only query family；生成的 SQL 文件不是
查询 authority，Subject 也不能创建 execution Receipt、Apply 或 release authority。

同一切片修正了两个容易被误解的审查字段：未加 write barrier/lock 的 `MAX(cursor)` 现在明确命名为
`observed_high_water_candidate`，不能作为 captured high water；`pg_sequences.last_value` 不含 `is_called`，
因此模板只给出保守的 strict-`>` 判断，并把完整 next-value proof 固定为 false，留给未来 trusted Inspector。
模板也不再返回 raw default expression，只报告 default 是否存在并保留 equivalence blocker。

现在另有一个独立的 Supabase Automation `2.4.0` candidate，提供 scheduled job、private queue、入站/出站
webhook、idempotency、retry 与 durable execution 的有界审查面。它使用独立 descriptor 和 adapter ID，因此
新增能力不会改变已锁定的 Backfill Compiler `2.3.0` trust digest，也不会使现有跨语言证据失效。该 candidate
通过 full-superset composition 复用未改动的 `2.3.0` data、auth、policy、migration、Realtime、transaction 与
backfill adapter，因此真实 managed DataModel 可以和 Automation 一起规划，而不是只能依赖空模型测试样例。
出站 destination 不会把 URL 序列化进 Backend IR，而是持有 Host 签发的 opaque
`endpointCredentialRef`，并与签名用 `credentialRef` 分离。Compiler artifact 只保留 reference digest，以及
显式为 `null` 的 authority/generation slot。未来 Host 必须在每次 operation 时解析该引用，认证 canonical HTTPS
endpoint 与 credential generation，执行 redirect/DNS/private-address policy，并把这些事实绑定进 accepted
Receipt。替换 endpoint 必须轮换 generation 并重新进行 release review；Compiler artifact 本身没有 endpoint 或
fetch authority。
Compiler 会生成可纳入源码的确定性审查 SQL，用于 logged
[`pgmq`](https://supabase.com/docs/guides/queues/pgmq) queue 与 UTC
[`pg_cron`](https://supabase.com/docs/guides/cron/quickstart) job，另附 deployment manifest 和 inert worker
contract。extension bootstrap 必须作为另一项特权审查完成：该 artifact 不执行 `CREATE EXTENSION`，且只
接受位于精确 Schema、由对应 extension 持有的 `pgmq` / `pg_cron` object。它会直接拒绝通用
`pgmq_public` wrapper Schema，而不是推断该 Schema 未被 PostgREST 暴露。queue/Cron 名称均由内容派生。
在一个 transaction-scoped advisory lock 内，SQL 会拒绝任何既有 target queue 或带本应用 marker 的 queue，
只创建 logged、non-partitioned queue，写入精确 ownership/config-digest comment，撤销 `PUBLIC` 与已知
Supabase API role 的直接 table 权限，并验证这些 role 不再保有有效 table privilege。

调度必须使用当前专用、非 superuser、无 `BYPASSRLS` 的 role；SQL 会锁定 `cron.job`，并用跨季节探针证明
Cron 时区的有效 UTC offset 为零。同名 job 一律报错，只有在锁内确认不存在后才会调用 `cron.schedule`。
postcondition 会精确绑定 job ID/name、`CURRENT_USER`、`CURRENT_DATABASE()`、本地 node/port、schedule、
command、active 状态与确定性 command marker。生成 SQL 不会删除 queue、unschedule job 或接管旧 candidate
object；删除/改名必须经过显式 retirement approval 与新的完整 inventory。

存在普通 Automation 时，同一审查 artifact 现在还会包含 application-scoped、one-shot 的 idempotency-ledger
Schema candidate。head key 精确固定为 `(automation_id, idempotency_key_digest)`；不可变 revision 通过复合
foreign key 与精确 catalog postcondition 绑定 prior revision/head，以及 event、operation、causation、attempt、
state、time 与 retention 字段。revision mutation 会被拒绝，`outcome-unknown` 也不能开始新 attempt。该 Schema
拒绝 `PUBLIC` 与已知 API role。它刻意不生成 DML writer、outbox publisher、cleanup job、database
connection 或 applied-state 声明；在 trusted Host Receipt 接受 live database snapshot 前，所有 catalog fact
都只是 expected、unverified 状态。

普通 Automation artifact 现在还包含一份独立、one-shot 的 transactional Outbox Schema candidate。不可变
binding 会固定 business transaction、row version、event、Queue message、idempotency key、enqueue time 与
retention deadline；revision/self-FK/head tuple 则携带完整有序 publish-attempt history、state、纳秒时间与新鲜
transition evidence。publish attempt 必须严格早于 retention 到期点，未知投递会保持 fenced，`published` /
`delivered` evidence 也绑定本次精确 transition。私有 Schema 会检查 owner/ACL/catalog 后置条件，但仍不会生成
enqueue、publish、ack、cleanup、Host CAS writer、database connection、applied-state claim 或 release authority。

Automation candidate 仍不在任何 production registry 中，也不会生成可执行 worker。它不创建 database
session、credential lease、network、Apply、Deploy 或 release authority。

plan 与 manifest 只描述**预期但尚未验证**的 post-apply state；在可信 post-apply Receipt 绑定 extension
version/object inventory、完整 queue ACL 与 PostgREST exposure inventory、Cron connection target 前，不接受
任何 queue/Cron 声明。Queue 所声明的 payload、visibility 与 retention 值目前只进入 marker digest，本
candidate 尚未在数据库内强制这些 Queue 设置。

provider-neutral core 现在还提供纯函数 Webhook security review contract：它会拒绝非 HTTPS、userinfo、
query、fragment、redirect、歧义 path、本地/私有 DNS 或 IP 结果，以及过期 resolver observation；通过的输入会
立即缩减成 endpoint、origin、path、address set、credential reference 与 credential generation digest，返回的
subject 不包含 raw URL 或 address。它还能生成精确 `raw-body-v1` HMAC subject bytes，但从不接收 signing key。
这些 helper 不认证 DNS 或 credential store，不执行 network/crypto，也不授予 runtime/release authority；只有
Host 已认证的 Receipt 才能消费这份 secret-free subject。

retry 与 idempotency policy 也已有 provider-neutral 纯契约。disposition planner 绑定
automation、operation、attempt、event、idempotency 与 causation domain，在不溢出的前提下限制 fixed 或
exponential backoff，只从 Host 提供的 uint32 派生 full jitter，并且绝不会把 `outcome-unknown` 转成
retry、failure 或 dead-letter。idempotency contract 建模不可变 revision record 与精确的 head/revision CAS
proposal；未决 attempt 保持 fenced，成功 record 不可再扩展，只有已证明的 `known-not-dispatched` 才能开始新
attempt。两类输出都把 Host authentication、persistence、dispatch、runtime 与 release authority 固定为
false。

专用 successful-replay helper 只有在调用方同时提供完整的 succeeded idempotency record、其历史 CAS
proposal、精确 persisted head revision/digest 与独立 terminal-head verification evidence 时，才会把新收到的
delivery 转成 terminal `deduplicated` worker；输入还必须携带原始 message-envelope 与 payload digest。helper 会
交叉绑定 automation、event、operation、idempotency、causation 与 request-content identity；生成的 worker 只能
使用同一份 terminal verification 提议 ack。它不会扩展已经 succeeded 的 idempotency record，也不会认证调用方
声称的存储证据；generic worker transition API 无法构造该状态。

core 还定义了纯 Queue Worker 与 transactional Outbox handoff。Queue message/lease observation 会绑定 payload
digest、delivery attempt、纳秒级 visibility/retention window、worker revision、terminal idempotency CAS evidence
与 mutation proposal。unknown outcome 不能 ack、retry 或 archive；dead-letter 必须先取得独立的目标 publish-CAS
evidence，才能 archive source。Outbox revision 必须先持久化 pre-publish fence，unknown publish 会继续 fenced；
只有 fresh `known-not-published` evidence 才能开始一个新的有界 publish attempt。这些 contract 不读取 queue、
不 dispatch work、不持久化 CAS state、不 publish outbox row，也不授予任何 authority。

一个位于独立 leaf module 的 testing-only Host runner 现在会让单条 injected message 按目标顺序执行：live lease
observation、idempotency reservation CAS、worker receive CAS、idempotency `dispatch-started` CAS、worker
pre-dispatch unknown fence、重复 live-lease 检查、process-local one-shot dispatch permit、terminal CAS，最后才是
ack/retry 或 publish-before-source-archive DLQ planning。它只接受精确的进程内 `fake` 或
`durable-test-double` adapter handle，不提供 default adapter，不出现在 production import topology 中，不携带
payload 或 credential，并把 callback side effect 与 reconciliation evidence 全部标记为 unauthenticated。任何
source queue mutation 成功都只是 injected callback 的报告：`sourceQueueMutationReadbackVerified` 固定为
`false`，`sourceQueueMutationCallbackReportAuthenticated` 也固定为 `false`，并不构成 queue/database readback
或 authenticated proof。successful replay composition、lease-extension rebind、authenticated store/transport、
独立 reconciliation 以及所有 production/release authority 仍不可用；该 kernel 是可执行的测试覆盖，不是
production Queue worker。

另一条 testing-only、review-only Supabase idempotency-CAS 路径现在会把一份已验证的 provider-neutral candidate
降级成固定 27 参数 statement，且不暴露 canonical JSON 值。statement 会独立复核两份 canonical bytes 与
digest，要求单个带有界 timeout 和 synchronous commit 的 `SERIALIZABLE READ WRITE` transaction，先锁
head、再锁完整有序 revision chain（`FOR UPDATE` 后接 `FOR SHARE`），并且只允许 initial insert 或精确
successor 产生 DML。exact/historical replay 均为零写入，任何 partial effect 都会让 statement 整体中止。
catalog guard 会固定生成 Schema、column/default collation、全部 constraint/index definition、append-only
guard 正文与 trigger inventory、ACL/effective-role isolation，并要求 rewrite rule、policy 与 publication exposure
全部为零；严格 response parser 只接受一条原生 row 和六种固定 status 之一。

Desktop 同时会在 production build 中编译 private、不可达的 precommit 与 one-shot runner shape。它固定
TypeScript SQL 的精确 bytes、Schema sentinel 数量、SHA-256 digest、parameter cast 与 canonical encoding，
固定 transaction stage 顺序和 deadline，在 execute 结束后不可逆地切换到 abort-only，并把 commit outcome
unknown 单独分类为必须进行只读 reconciliation。只有 `inserted`、`advanced-head` 与 `exact-replay` 可以进入
commit；`cas-conflict`、`corruption` 与 `precondition-failed` 一律 abort。在这条可写 statement 中，
`advanced-head` 既可能表示 exact successor 已成功写入，也可能表示已存 head 更靠后的零写入 observation，因而
status 本身无法区分或认证这两种情形。testing parser 的六种 status 全部未经认证，transaction commit 或 status
本身都不能证明 database readback，也不会签发 Receipt。当前仍没有 production constructor/caller、credential lease、带 wire-level response
上限的 database adapter、operation-journal precommit、经过认证的 server cancellation、authenticated
response/readback、固定只读 reconciliation、reviewed deployment Receipt 绑定、Receipt V2 issuer、Tauri command
或 release authority，因此
这个已编译边界无法触达 live database。

`pgmq.read` visibility lease、成功后 archive、已认证的数据库 idempotency CAS、已授权的
retry/dead-letter execution、真实 HMAC 签名/常量时间验证与 replay storage、
固定 DNS/connect 的 Host transport、retention cleanup、health check、deployment Receipt 和真实 crash/retry
测试都仍是 blocker。
data-change trigger、workflow/transaction action、telemetry 与 drift monitoring 也会继续 fail closed，直到各自
独立的 trigger、execution 与 observability authority 完成。Supabase Database Webhook 本质是异步的 `pg_net`
trigger；本切片不会生成任何由数据库 trigger 发起的网络请求。

另一个独立的 Supabase Observability `2.5.0` candidate 会组合完整 `2.4.0` bundle，同时不改变两个旧 trust
domain。因此 managed DataModel、private queue、webhook、普通 Cron 与 telemetry/drift intent 可以共用同一个
Provider selection。composite 在调用 `2.4.0` Automation planner/emitter 前会投影掉唯一的 `drift.detect`
schedule：普通 job 可以进入审查 SQL，drift schedule 只保留为 inert Host-contract data，不能被静默生成为
database Cron job。它最多接受一个 UTC drift schedule，scope/mode 固定为 `declared-schema` / `read-only`，并
新增四个确定性审查 artifact：阻止 release 的 manifest、single-snapshot inspection contract、append-only
audit contract，以及仅供审查的 operational-event sink schema candidate。
如果投影后不存在普通 queue、destination 或 automation，composite 不会生成 Automation artifact，也不会建议
启用无关的 `pgmq` extension。

该 contract 明确分离两个 digest 域：`declaredDataModelDigest` 使用与 migration inspection 相同的规范化
DataModel digest；`declaredSubjectDigest` 还绑定 application/Auth/Automation 声明。
`expectedSourceLedgerSchemaDigest` 在 Compiler 输出中固定为 `null`，因为只有 trusted Host 能读取当前环境的
source-ledger baseline；未来 drift Receipt 必须使用 Host 证明的 digest，不能拿声明 digest 代替。inspection
contract 不接受 Compiler/调用方 SQL、URL、header 或 credential，并禁止 application row、raw error、query
parameter 和 Secret material。它只引用现有 canonical source-migration drift Receipt 作为未来 Host outcome，
不能创建 Receipt 或修改 source ledger。

provider-neutral core 现在还定义了 operational-event sink handoff。它复用严格的 event-chain 与 Host-anchor
verifier，限制每个 event 16 KiB、每个 batch/proposal 256 KiB，保留事件顺序与精确 prior/head digest，并输出
revision/head CAS proposal。结果是 canonical、secret-free 且 immutable 的，但
Host-anchor-authenticated、persistence、export、alert 与 release-authority flag 全部固定为 false。

Supabase 会把该 contract 投影为一次性、application-scoped private-schema candidate，并建立 append-only
revision table 与 exact-head table。DDL 精确绑定 Provider/environment/authority、trusted anchor、prior/next
head、ordered event digests、最后一条 event time、observed time 与 revision/head CAS state。所有时间字段都使用
固定九位小数 UTC text projection，必须由 trusted Host 在不舍入的前提下规范化，避免 PostgreSQL 静默丢失纳秒
identity。catalog postcondition 固定 owner、constraint、index、comment 与 API role 的 direct/effective ACL；
schema 是否不在 PostgREST exposed schemas 中仍保持未验证并阻塞 release。产物不包含 event payload、DML
writer、database session、credential、network transport、exporter 或任何 authority。因此 schema candidate 只
补齐已审查的 persistence shape，portable handoff 仍需已认证的 Host CAS writer。

`2.5.0` candidate 不生成 scheduler、observation runner、telemetry drain、audit DML writer、alert delivery、
database session、network request、credential lease、Apply、Deploy 或 release authority。trusted Host 的重启可恢复 scheduler、
current source-ledger baseline 绑定、精确 Provider/project authority、single-snapshot Receipt、redaction/cardinality
控制、retention/export policy、operator acknowledgement 与真实 drift/telemetry 测试都仍是明确 blocker。
production/source-only 对既有能力继续复用 `2.4.0` composition；新增 server-owned observability capability
仍必须等待单独审查的 Host authority。

下一个 Host-only 切片已经接入固定 native Desktop Management command、一次性 renderer adapter 与单快照
严格 decoder。Rust 持有已保存 PAT 与 grant snapshot，固定调用 Supabase project lookup 和
[`/database/query/read-only`](https://supabase.com/docs/reference/api/v1-read-only-query) endpoint，
禁用 redirect，不接收调用方 credential、SQL、URL、method、header 或 response limit；它先核验项目
organization，再发送唯一一条有界 catalog statement。Rust 与 TypeScript 会对精确 query + parameters request
body 绑定同一 digest；两个请求结束后，native command 会再次原子读取 PAT 与 grant generation，只有与初始
snapshot 完全一致才返回。绑定 organization 的 verification/release 还会在同一原子 snapshot 中要求独立的
database-write PAT，两个 PAT 都不会返回 renderer。command permission 与命令内部检查均只接受 Tauri `main`
window。命令还会从第一次 vault read 之前到两个 network request 与最终 vault snapshot 完成期间持有
process-wide fail-closed single-flight guard；并发 invoke 会被拒绝，RAII 会在成功、失败或取消时释放 guard。
Production Desktop review、staging verification 与 staging release 的 catalog read 现在默认使用该
module-owned native transport；可注入 renderer fetcher 与 dependency 只存在于显式 `ForTestingV1` factory，不能
取得 production transport brand。初次 review 可以发现一次 organization，verification/release 则必须传入已审查的
organization ID。Host 会从 live trusted V2 Registry、plan 与 selection 内部重建 Subject，并在查询前后重新解析
Subject 与 credential grant。严格 decoder 通过 OID 绑定 table、column、primary key、enum 与 identity sequence，只返回 default
presence，并记录固定 role、primary server、RLS、search path、transaction 和 write-hazard 证据。Supabase
当前的 `supabase_read_only_user` 带有 `BYPASSRLS`，endpoint 也没有承诺 `transaction_read_only=on`；实现不会
把这两项误写成 RLS 或 transaction 安全证明。该 catalog inspection 依靠的是固定 endpoint role 与 Host 内置、
schema-qualified 且不读取 managed-table row 的 catalog SQL。该 native 切片仍然只读，不能捕获 locked high
water、安装 CAS ledger、创建 Receipt、Apply SQL 或建立 release authority。

后续 Host-only 切片已可把成功的 live inspection 转成确定性的 write-barrier **审查计划**，但仍不能安装
barrier。Host 不接收调用方提供的 inspection、SQL、constraint name、predicate 或 marker；它会在内部重新运行
固定 Inspector，绑定完整 inspection、Provider/plan/artifact authority、project/account/grant generation 与 live
object OID，然后生成 digest-bound 预览事务。该事务只包含 `ALTER TABLE ONLY ... CHECK (target IS NOT NULL)
NO INHERIT NOT VALID` 和同事务 transient constraint comment。PostgreSQL
[`NOT VALID`](https://www.postgresql.org/docs/current/sql-altertable.html) 会跳过存量行扫描，但仍拒绝此后结果
为 NULL 的 insert/update；因此 legacy NULL 行即使只更新其他字段，也必须同时写入非 NULL target。预览会记录
5 秒 lock timeout、15 秒 statement timeout、serializable transaction 与
[`ACCESS EXCLUSIVE`](https://www.postgresql.org/docs/current/explicit-locking.html) 锁影响，但不会创建 mutation、
execution 或 Receipt authority。全部异步 digest 完成后还会再次核对 live subject/grant。原有
`write-barrier-not-installed` blocker 继续保留。

specialized Host verifier 及其 operation-scoped Management transport 现已覆盖下一段只读边界。它们只接受
真正的 in-memory review，在固定查询前后及异步 digest 完成后重新绑定 live Subject 与 credential grant，并固定
使用同一个 [`/database/query/read-only`](https://supabase.com/docs/reference/api/v1-read-only-query) endpoint。
单条 statement 会绑定已审查的 table owner、table/target OID、RLS 状态、generated/default shape、constraint
name、marker 与 target predicate。查询只返回计数和结构 flag；`pg_get_expr` 在 PostgreSQL 内部完成比较，raw
constraint definition 不会经过 transport。严格 decoder 只接受完全不存在、精确存在一个已审查 transient
barrier，或 mismatch 三种状态。installed 状态必须是唯一的 local、non-inherited、unvalidated、
non-deferrable `CHECK`，且 one-column key、predicate 与全局唯一 marker 精确匹配，`pg_class.relchecks` 也必须
与 constraint inventory 一致。固定查询当前仅允许 PostgreSQL 15-17；遇到更新 catalog 版本会 fail closed，
直到新版本查询能验证新增字段。对应结构约束见 PostgreSQL
[`pg_constraint`](https://www.postgresql.org/docs/current/catalog-pg-constraint.html)。

该 verifier 仍然只供审查，尚未接入 candidate V2 Provider 的 App UI，也不会创建 mutation、execution、
source-ledger 或 Receipt authority。只有通过的 `absent` 结果能被下述 installer preparation 一次性消费。
generic Inspector 保持原样，继续拒绝 managed table 上的任意 `CHECK`，不会为其他约束静默放宽。

下一段 Host-only 切片补上这个严格受限的 installer，但不会把审查 SQL 本身变成 authority。可审查的 endpoint
artifact 只能从 genuine review 与对应 genuine `absent` proof 生成。显式确认会绑定精确 review、proof、SQL
digest、独立保存的 staging project/account，以及另一份 `database:write` / `database_migrations_write` grant。
review 与 absent proof 会在任何异步 authority 检查前同步、成对且仅消费一次。实际 mutation SQL 由 Host 重新
生成：先设置 serializable isolation 与本地 timeout，在第一次 catalog snapshot 前取得 `ACCESS EXCLUSIVE`，
随后在锁内完整复核 table/cursor/target/primary-key/identity-sequence 的地址、shape 与 hazard inventory，并确认
精确 marker 在全库仍不存在，最后才添加 constraint 与 comment。SQL 不含 `IF NOT EXISTS`、调用方 SQL/name/
rollback、managed-row read 或 DML，也不会回退到 generic SQL endpoint。

operation-scoped transport 固定使用 Supabase 的
[`/database/migrations`](https://supabase.com/docs/reference/api/v1-apply-a-migration) endpoint，在 preparation 与
POST 紧邻前各核验一次 project organization，只发送精确 `{ query, name }`，并且只接受 HTTP 200 加空 JSON
object。专用 controller 会先持久化 project-wide single-flight claim 与完整 digest-only progress evidence，
再在允许 POST **之前**把 claim 锁定为 `outcome-unknown`，并私下登记一次性、context-bound journal permit；
没有任何导出 API 可以签发该 permit。固定 origin transport 会消费它，并在第二次 authority GET 或 POST 前
重新读取精确 unknown claim 与 `project-authority-confirmed` evidence。controller 两个入口也只接受 Host factory
创建的 journal；bare installer context、结构兼容的注入 transport 或注入 journal 都无法触达 mutation
boundary。已证明未越过 POST 边界的拒绝可以结算为 failed；POST 开始后的任何异常，甚至 HTTP 200
成功响应，都继续保持不可自动重试的 `outcome-unknown`。POST 尝试完成后 controller 会旋转进程内 verification
epoch。只有在新 epoch 下开始、且与同一 review 和精确 constraint OID 全部匹配的 genuine `installed`
proof，才能先写 final evidence，再结算 applied；dispatch 前已完成或尚在进行的 proof 都会被拒绝。controller
options 必须是精确 plain data record，accessor、自定义 prototype、symbol 或额外字段会在 journal/network
副作用前失败。applied 结果会保留 production/testing provenance、精确 credential-lease binding digest、write
credential incarnation 与 operation lease generation；Host 还会把 dispatch context、durable evidence、installed
verification 与 lease 作为同一份 identity-bound 进程内 provenance 保存。序列化或 equal-data clone 无法恢复这份
provenance，也不能成为后续 operation authority。这里有意不复用 generic Backend Apply helper，因为其
HTTP-success 语义对 barrier 来说过宽。

这只是 endpoint-ready Host primitive，并不是 App Apply 按钮或完整 release flow；测试没有修改任何真实项目。
Supabase 会生成远端 migration-history 记录，但对应源码 migration file 与 `db push` ledger 尚未建立，因此
`sourceLedgerBound` 和 `releaseReady` 始终为 false。genuine review/proof authority 仍是进程内 WeakMap
identity；不过，Host 创建的持久化 journal 中精确的 final `installed` 或已证明 `not-dispatched` evidence 本身可供
重启恢复：新的 genuine context 重新绑定同一份 canonical review 后，controller 只重试缺失的 terminal
settlement，不会再次 POST 或再次消费 proof，也覆盖 commit 已成功但调用返回丢失的窗口。如果在 POST 后、final
installed evidence 写入前崩溃，则必须继续保持 unresolved 并人工 reconcile，直到后续加入独立的 read-only
recovery verifier。过期 `pending` lease 也不会被猜测成 failed，因为当前 journal lease 尚不是数据库 CAS/fencing
token。

下一个 Host-only primitive 已能把一份 genuine applied barrier reconciliation 转成带锁、环境专属的
high-water proof。三个 applied settlement 分支（包括从精确 final journal evidence 重启恢复）都会把结果登记为
进程内 WeakMap capability；capture 在越过网络边界前只能消费一次。确定性 review artifact 会绑定 Provider
package、application、plan、manifest、migration、source review、已安装 constraint OID、完整 inspected object
address 与固定 query digest。显式确认还会单独绑定这份 artifact、已保存的 staging project/account，以及与
read-only inspection grant 不同 generation 的 operation-scoped `database:write` / `database_write` 凭据。

专用 transport 固定使用 Supabase
[`/database/query`](https://supabase.com/docs/reference/api/v1-run-a-query) endpoint，在 query POST 前后分别核验
project organization，不接收调用方 SQL、endpoint 或 parameters，只发送精确 `{ query, read_only: false }`。
有界的 60 秒 HTTP deadline 为固定 lock、catalog recheck 与 aggregate statement 预算留出余量。显式
serializable transaction 会在第一次 catalog 或 managed-row read 前取得
[`SHARE ROW EXCLUSIVE`](https://www.postgresql.org/docs/current/explicit-locking.html)，因此并发 table writer 会被
阻塞，普通 reader 仍可继续。锁内会按精确 name、marker、OID、column number、type 与 constraint definition
重新核验 table、cursor、target、primary key、identity sequence、hazard inventory 和唯一的 transient
barrier，然后才计算全表 minimum/maximum cursor、row count、剩余 NULL 数、unsafe cursor 数与所需 receipt
batch 数。batch 预算按**全部已捕获 cursor row**计算，而不是只按当前 NULL match 计算：即使 NULL 很稀疏，
有界 runner 也必须让每个 primary-key keyset window 最多推进 `batchSize` 行，并且只修改仍匹配
`target IS NULL` 的行。全部 `int8` 会以十进制文本跨越 JSON，再由
Host 用 `BigInt` 校验并限制到 JavaScript safe integer。

provider-neutral Receipt V2 contract 已把 cursor progress 与 completion 分开。immutable scope 会绑定 Provider
authority、application、migration/source-ledger artifact、captured high water、physical resource identity、batch
上限与 receipt-zero capture digest。只有同一个 database checkpoint 证明剩余 eligible/NULL 行均为 0 且全部
postcondition 成立时，Receipt chain 才能在小于 captured high-water key 的位置完成，因此可正确覆盖 sparse key
与 capture 后被删除的 row。零行 checkpoint 必须 terminalize，第 9,999 个 batch 不能继续 in-progress，
`outcome-unknown` 也不是 Receipt state；静态验证成功仍不会授予 database 或 execution authority。Host-only
review 只能从 genuine process-local capture identity 派生精确 Supabase scope draft，不会消费它，也不会创建
execution ID、receipt ID、CAS head 或 permit。capture 只会在后续 ledger initializer 中提供一次性消费。

同一个 provider-neutral 边界现在还提供用于 Host 分页读取的增量 Receipt-chain verifier。每个非空 page 最多
包含 64 份 Receipt，并在复制的 scalar transition state 与 page-local uniqueness delta 上验证；accepted
uniqueness set 只有在整页成功后才会合并，既保证畸形或无效 page 不提交任何状态、可由修正 page 替换，也避免
大量小 page 反复复制全部历史集合而退化成二次复杂度。verifier 只保留前一份/最近 exhaustion Receipt 与 4 组
有界 uniqueness set，不保留全部 canonical payload；只有 `finalize()` 会比较 caller 已认证的 head digest。
增量失败会提供稳定的 `failureDisposition`、`finalized` 与 `retryable`，调用方无需解析英文 message 就能区分
page rejected、operation in progress 与 terminal verifier。无效初始化会返回 terminal failure，而不会 reject
factory Promise；whole-array 与 paged malformed entry 也会报告相同的绝对 chain index。并发 append 与
finalize 后 append 均 fail closed。原 whole-array verifier 复用同一 transition engine，两种结果都不产生
authority。所有 canonical count 字段还会拒绝 negative zero，避免不同 JavaScript 输入折叠成相同 JSON digest。

现在还新增了 provider-neutral source-ledger binding Receipt，用于描述从该 draft 到最终 Receipt V2 scope
之间缺失的桥接。subject 会绑定 promotion ledger 的 canonical digest、staging 完整 applied prefix、当前
target authority 与 no-drift Receipt、已应用前缀最后一份 P1 源码 migration、inspected-ledger 的精确文件
bytes/head/entry，以及源码 SQL 的精确 bytes。P1 migration 必须已经是最后一个已应用前置项，并且必须与
尚待执行的 P2 backfill migration 不同。portable verifier 刻意只把自洽的 CI attestation 当作结构证据：它
不会认证受保护仓库 ref、`supabase db push`、远端 migration history、Credential 或 Host trust root，全部
authority flag 始终为 false。Host-only review 会先独立重建所有本地文件与 promotion-ledger 锚点，再接受
这份证据。带品牌的 testing-only CI verifier 可以继续测试 single-flight binding，并用非空
`sourceLedgerDigest` 生成经过严格解析的最终 V2 scope；clone、交叉接线、并发复用、证据不匹配与 replay
都会 fail closed。该测试路径仍不会创建 database、execution、Receipt 或 release authority，也不会连接
或改动 Supabase。production binding 仍需要固定 CI trust root，为同一 staging project/account 证明受保护
revision 以及精确成功的 `db push` 与远端 migration history。

现在还增加了一份 portable signed-receipt envelope，让未来 Host 边界具有 byte-exact 输入，但不宣称该信任边界
已经存在。envelope 只签名一个 canonical payload，其中包含自身 format/version 和完整 source-ledger binding
Receipt；在生成 payload digest 或待签 bytes 前，strict parser 会重新核验全部 subject、attestation、applied-prefix
digest 与时间关系。另一个 256 KiB 有界 byte parser 要求 fatal UTF-8 和唯一 canonical JSON，拒绝 duplicate key、
空白变体、替代 escape、accessor、自定义 prototype、未知字段与 unpaired surrogate。解析结果只称为
`structurallyValid`：Ed25519 `keyId` 只是未受信 locator，这里不接收 public key/trust root，也不授予 CI、
source-ledger、database、execution、Receipt 或 release authority。未来 production native verifier 必须独立选择编译期固定
trust root，并把验签后的 receipt 绑定到 live project/account/grant snapshot。

另有一个独立、dormant 的 Rust verifier，已经用同一份纳入源码的跨语言 fixture 证明该 native 边界。它只接收
精确 canonical envelope bytes，镜像嵌套 strict schema、JavaScript safe-integer 与 timestamp 规则，重新计算
applied-prefix、subject、attestation 和 payload digest，只能从编译期固定表中选择 Ed25519 root，并把完整签名
scope 与 Rust-owned expectation 比较。共享 fixture 覆盖 JSON escape、Unicode、`Number.MAX_SAFE_INTEGER` 与
真实 Ed25519 signature；两端 semantic reject vectors 还会拒绝 secret-like string、ECMAScript trim character
和非法 Supabase project ref。production root 表刻意为空，trusted expectation 也没有 production constructor。
测试只能签发 process-local、30 秒、有界的 one-shot handle，并用 issuer 与 generation fencing 防 ABA；consume、
mismatch、expiry、replay 与 drop 都会烧毁它。该 module 没有 Tauri command、network client、持久化 replay
high-water、journal 连接、database runner 或携带 authority 的结果，所以 production verification 与 release
authority 仍不可用。

Host 现在也会生成一份确定性、无秘密的私有 `openpencil_release` CAS ledger DDL **审查**。execution、
Receipt V2 与 current-head 三张表会为每次 execution 唯一绑定 capture 与 scope，保存有界 canonical
scope/Receipt 原始 bytes，并把 head 固定为 `(revision, eventId, receiptDigest)`。PostgreSQL 内建 SHA-256
与 base64url CHECK 会把这些 bytes 分别绑定到 `scopeDigest` 与 `receiptDigest`。receipt ID、idempotency key、
request digest、event ID 与 Receipt digest 在 execution 内唯一；previous-head foreign key 使用默认
`MATCH SIMPLE`，使第一条 Receipt 可以没有 predecessor；revision CHECK 则要求 revision 1 的三个 predecessor
字段全部为空、后续 revision 全部非空。current-head foreign key 固定引用 tuple。
schema 会撤销 `PUBLIC`、`anon`、`authenticated`、`service_role` 的访问权，启用零 policy
RLS 但不对未来 database owner/runner 使用 `FORCE`，也不依赖 extension、sequence、`SECURITY DEFINER`、
managed-row read 或 DML。DDL 只提供未来 CAS transaction 所需的 tuple 与 foreign-key precondition，
本身不会执行或声称已经执行 compare-and-swap update。该 artifact 刻意只是非幂等审查材料，没有
`IF NOT EXISTS`。Host-only preparation 路径现在会生成 operation-scoped install review，要求一份 genuine
`absent` proof，由 Host 生成非秘密的随机 UUID nonce，并在 `COMMIT` 前为
`backfill_executions_v1_pkey` constraint 追加一条精确 marker comment。marker、marker binding digest 与
install-specific SQL digest 会同时绑定到 review、confirmation 和脱敏 install context。base DDL 仍是确定的，
但每次准备的安装操作会刻意具有不同 identity。Host 随后执行固定 project-authority GET，返回的 prepared
migration metadata 会显式区分 `baseSqlDigest` 与 `installSqlDigest`，并绑定精确 marker 及其
`markerBindingDigest`。source review 的 `sqlDigest` 仍只表示确定性 base DDL；prepared migration 不再提供
含糊的 `sqlDigest` 字段。

现在已有一条 **仅供测试的** 完整 durable install state machine，但它尚未接入 Desktop 应用或 production
credential issuer。该组合会签发一份精确 operation-bound write credential lease，在第一次 authority GET 前
持久化占用 project scope，在 precommit 后再次执行 authority GET，并把 review、marker、SQL、credential
incarnation 与 operation generation 的全部字段绑定到 one-shot transport permit。permit 会在 injected fetcher
开始前，若 journal 已确认 claim commit、但立即回读暂时失败，Host 会保留 opaque claim capability；只有后续
exact reread 与该 claim 完全一致，才允许 precommit 或签发 permit。binding 已匹配的 permit validation 若在 POST
前失败，仍可签发 known-not-dispatched attestation；installed-verification epoch 也必须先完成 rotation，再删除
permit。若无法取得权威 no-POST proof，则保留 reconciliation handle，不会静默遗忘未决 scope。
permit 会在 injected fetcher
可能开始固定 [`/database/migrations`](https://supabase.com/docs/reference/api/v1-apply-a-migration) POST 的紧前方
切换为 durable `outcome-unknown`。只有在该边界前铸造的 opaque proof 才能把 claim 安全结算为
`not-dispatched`；越过边界后的任何失败都禁止自动重试。200 空 JSON 只能得到
`verification-required`，只有 fresh、operation-epoch 绑定的 installed proof 被持久化结算为 applied 后，
`databaseLedgerBound` 才会变为 true。能力 clone、authority/transport 交叉接线、stale proof 与并发 replay
都会 fail closed；无效 proof 也不能毒化或消耗 genuine attempt。durable claim 之后若时钟回拨或抛错，只有
已经证明未到达 POST 的路径才会复用最后一个已接受的单调时间。如果 final journal 写入或精确回读持续不可用，
attempt 会保持 reconciliation-required。已经消费的 no-dispatch 或 Applied proof 不会从序列化 final evidence
中重建；`resumeSettlement` 不会调用 transport，并会持续 fail closed，直到未来存在一条独立、fresh 且权威的
observation 路径。

现在还增加了 testing-only Receipt-zero review：只有 final V2 scope 与 durable applied CAS-ledger installation
来自完全相同的进程内 Receipt review identity 时，二者才能接合。它会把 testing CI trust-root evidence、
source-ledger Receipt/digest、capture/query/catalog digest、完整 applied-install result digest、installed
verification、marker 与旧 installer lease 三元组绑定进一份明确**未认证**的 operation-evidence digest。调用方提供
UUID v4 nonce，并据此确定性派生按用途分离的 execution、Receipt、event 与 idempotency ID；随后 request subject
绑定这些 ID 和初始 outcome，但不会哈希自身或最终 Receipt。共享 provider-neutral parser/chain verifier 会验证
生成的 capture checkpoint，最后的 row-plan digest 还会覆盖 execution/Receipt/head tuple 与精确 canonical byte
length。同一 input/time/nonce 会得到相同 candidate；nonce 不同会改变全部下游 identity 与 digest。

这仍然只是审查材料。`preparedAt` 仅为了静态验证而复制到尚未持久化的 testing Receipt `committedAt`，并不代表
database commit time，也没有 Host clock freshness 或未来时间 authority。review 不消费 capture、不签发
Receipt-zero credential/permit、不生成 SQL、不派发 request、不持久化 row，并让全部 production authority/release
flag 保持 false。CAS install lease 三元组只作为 provenance，不能授权初始化。未来 initializer 必须另发
purpose-specific lease，在同一个 `SERIALIZABLE` transaction 中重新核验 installed marker/shape 与 current head，
并在首次可能 mutation 的 await 紧前方同步、一次性消费 capture。chain absent 时才可依次插入
execution、Receipt zero、head；revision 1 完全相等时只能 read-only replay；head 已推进时绝不回退；partial state、
跨 identity collision 或 canonical bytes 不一致都属于 corruption。禁止 `ON CONFLICT DO UPDATE`；POST 结果不明确
时必须保持 `outcome-unknown`，先做 read-only reconciliation，不能自动重发。

在此基础上，新增的 testing-only CAS transaction review 会把 candidate 降低成一条与 operation 无关的固定参数化
writable CTE，以及精确的 28 位 positional parameter layout。provider/environment、revision、checkpoint kind、
previous-head null 与 Receipt 上限均为固定 SQL literal；canonical scope/Receipt 以标准 Base64 传入并直接解码，
不会经 `jsonb` 重新序列化。公共 review 只暴露参数名、PostgreSQL type、精确 byte length，以及相互独立的
SQL/schema/value digest；有序实值和 canonical bytes 只保留在进程内 trusted context，仍不授予 credential、permit
或 mutation authority。

严格的 testing-only response parser 只接受一行且仅含 allowlisted `status` 的 dense response，并重新计算
review、SQL、parameter schema 与全部 28 个 hidden value digest，最后只输出脱敏 observation。`inserted`、
`exact-replay`、`advanced-head`、`corruption` 和 `precondition-failed` 在这一层都只是未认证报告：不会消费
capture，不会创建 credential、transport、database、execution、Receipt 或 release authority，且五种状态都必须
继续做 fresh read-only reconciliation。当前剩余 blocker 是 production transport authentication，而不是 response
shape parser。

该 statement 有意不包含 `BEGIN`、`SET TRANSACTION` 或 `COMMIT`。Supabase Management 的参数化查询无法在同一
request 内先建立外围 transaction、再执行另一条 bind statement，而且 endpoint 没有 isolation 控制。因此 review
要求未来固定 native transport 先建立 `SERIALIZABLE READ WRITE`、`row_security=off`、
`synchronous_commit=on`、`search_path=pg_catalog` 以及有界 statement/lock timeout；直接 Management-query
dispatch 被明确标记为不兼容且不可用。runtime guard 会独立重验相同设置，包括精确的
`current_setting('synchronous_commit') = 'on'`，并返回 `precondition-failed`，不会把 authority/runtime 失败误报成
ledger corruption。可写 CAS statement 自身仍未内嵌
fresh catalog/install-marker guard；下文带完整 guard 的只读 reconciliation 不会消除这个 mutation-side blocker。

在被审查的 statement 内，candidate execution collision row 会先按 identity 排序加锁，再依次锁 head 与全部
candidate Receipt，全部使用 `NOWAIT`。只有精确的 absent pre-state 才能进入相互依赖的
execution → Receipt → head insert；`exact-replay`、`advanced-head`、`corruption` 与 `precondition-failed` 均为零写入，
completed/already-satisfied 的 Receipt zero 绝不允许出现 advanced head。最终 effect guard 会强制 absent 分支三表
各精确插入一行，或 non-absent 分支一行也不插；否则整个 statement 报错回滚。lock、serialization、unique、timeout
或 network failure 必须保持 `outcome-unknown` 并转入独立 read-only reconciliation，绝不能自动 retry，也不能直接
宣称 database corruption。
`advanced-head` 只表示 relational tuple chain 自洽，并不验证第 2..N 份 Receipt 的 portable 语义；在 runner 或恢复路径
把它视为健康状态前，必须再经过独立只读的共享 V2 chain verifier。

现在还新增了 testing-only Receipt-zero reconciliation review，用第二条固定 statement 承担读侧核对。它完全复用
CAS review 的 28 个 positional value，不公开也不重排；不包含 DML 或 row lock，并把 execution/head candidate
各限制为最多 2 行、Receipt 限制为最多 10,001 行。同一个 statement snapshot 会返回状态标签与紧凑事实，
Host parser 必须依据事实重新计算状态，不能信任数据库返回的标签。snapshot identity 只返回 SHA-256 digest，
不会让大量 active XID 膨胀 response。durable read state 固定为 `absent`、
`exact-replay`、`advanced-head`、`corruption`、`precondition-failed`；CAS 的 `inserted` 只是事件结果，读回后只能是
`exact-replay` 或随后已经推进的 head。

只有 managed-row read 和 response shape 具有契约上限。recursive role closure、全 Schema catalog scan 与完整
inventory aggregation 在 SQL 内部没有固有 cap，因此这里不把整条 query 称为全程有界，并继续要求 server 强制
statement timeout。
所有 managed relation read 都显式使用 `ONLY`；catalog 的 no-inheritance 检查仍作为独立 shape assertion，
不会成为隔离继承子表 row 的唯一防线。

同一个 snapshot 现在会内嵌既有 CAS-ledger catalog verifier，并比较完整 column inventory 与完整 constraint
inventory，其中包含 supporting index、opclass、foreign-key operator identity、trigger state、ACL、comment、RLS、
inheritance、publication、dropped column 和 unexpected object counter；同时要求全 schema 内只有一个格式合法的
install-marker comment。current/session role 还必须都是非 superuser 的
`supabase_read_only_user`，具有 `BYPASSRLS` 与立即可用的 `pg_read_all_data` `USAGE`，不得拥有 ledger；database
必须是 primary，configured search path 必须精确为 `pg_catalog`。由于历史 marker 没有作为第 29 个 SQL
参数传入，query 只返回 observed marker 的 SHA-256 digest；未来严格 Host parser 必须把它与 genuine 进程内 review
保留的 digest 比较。现在的严格 testing-only Host parser 还会检查精确的一行/字段 shape、依据相互一致的 facts
重新计算所有 relational state，并把任何原本健康但 marker 不匹配的结果降为 `precondition-failed`。response 仍是
injected 且没有 production authentication；同一个 fail-closed override 也会覆盖 reported `corruption`，独立的
`reportedStatus` 仍可用于诊断，但不能越过 installation provenance。因此数据库报告的分类与 Host 计算的 testing status 都不能证明真实
database state，也不会创建 database/reconciliation authority。`transaction_read_only` 只作为 evidence 返回，
不作为 SQL 硬门，因为 Management read-only endpoint 的公开契约没有承诺该 GUC。该 endpoint 也无法在解析另一条
参数化 statement 前建立所需的 `search_path=pg_catalog`，因此 direct Management-query dispatch 明确不兼容；
固定 native transport 必须同时强制这两个边界。
review 只声明完整 catalog verifier 已包含在固定 statement 中，不会声称已执行；只有未来经过认证的 transport
真正派发并验证后，`performed` 才能成立，当前固定为 false。

这份 exact catalog comparison 仍不是 drift-safe planning 或 execution-safety proof：PostgreSQL 必须先解析 data
expression，false runtime guard 才能在执行时压掉结果。任何 transport 在允许 dispatch 前，仍须证明
expression/operator resolution 与不存在 indirect execution path，由 transport 强制 read-only boundary，并由 server
提供有界 statement timeout 与 cancel。SQL 的 row limit 只限制返回的 candidate，不保证 drifted schema 下所有
physical scan 或 recursive intermediate 都有界；组合后的 fixed-query request size 也必须先针对最终
native/Management transport limit 完成认证，才能启用 dispatch。

这两份 testing-only read review 现在都必须接收 genuine、process-local 的
`postgres-read-query-static-conditional-v1` certificate。certificate 会绑定精确 query ID/version、原始 SQL bytes、
SQL/query/contract digest、positional parameter 顺序、response field 顺序、managed relation 清单、ledger shape，
以及预期 column/constraint inventory。它的有界 scanner 只对这份固定文本证明：statement 精确为一条最终
`SELECT`；不存在直接 DDL、DML、dynamic SQL、data-modifying CTE、row lock、direct typed-literal cast 与未知
operator token；显式带括号的 function/aggregate call、cast 和 catalog relation 只能来自显式 `pg_catalog`
allowlist；
三个 managed ledger relation 必须全部使用 `ONLY`。scanner 还会拒绝 doubled-quote identifier escape、显式
`OPERATOR(...)`、managed relation inheritance `*`，以及越过 parenthesis ancestry 或 declaration-order scope
的 CTE reference。PostgreSQL 会把 `COALESCE` 与 `LEAST` 解析成特殊
conditional form，而不是普通的 schema-qualified function；普通 aggregate 则仍显式使用 `pg_catalog`
qualification。reconciliation 与 page-review factory 还会独立把 genuine certificate 与各自完整的内置 query
contract 精确匹配。这只是一份 static、conditional text certificate，不是 PostgreSQL 已安全执行 statement 的证据。

certificate 并未解析完整 PostgreSQL grammar，也没有认证 live server version、catalog、function/aggregate
implementation、operator resolution、cast 与 type I/O、planner/index/opclass support，以及 relation rewrite、RLS、
FDW 或 table access method 行为。PostgreSQL 的 composite field notation 还可能把 `alias.field` 解析为单参数
function call；静态 scanner 无法认证该 live resolution，因此
`compositeFieldNotationFunctionResolutionAuthenticated` 固定为 false。固定 query 会刻意避开可能在 unsafe session
state 下初始化隐式 temporary schema 的 `current_schemas(TRUE)`，改为核对已经配置好的 `search_path` 字符串；但该
runtime check 仍发生在 parse 之后，不能替代 transport 预先设置 path。因此
`liveIndirectExecutionSafetyAuthenticated` 与 `indirectExecutionSafetyProven` 仍固定为 false。允许 dispatch 前，
两份 review 都会继续把 `requiresFullLiveTypeOperatorIndexGuardBeforeDispatch` 固定为 true；固定可信 transport
必须在 PostgreSQL parse query 之前建立安全 `search_path`，强制 read-only transaction boundary
和有界 timeout/cancellation，并 fresh bind 已认证的 live server 与全部相关 catalog semantics。statement 内部的
runtime guard 只能在 parse、rewrite 与 planning 之后运行，不能替代这些 pre-parse gate。

schema/relation/column 缺失、type 不兼容、HTTP failure、timeout 或 response parse failure 都可能在产生分类行之前
中止，必须继续记为 `outcome-unknown`，不能伪装成 `absent` 或 `corruption`，也不能允许自动 retry。同理，fresh
`absent` snapshot 不能证明较早的 mutation request 已经停止。`advanced-head` 仍只是 relational-only：紧凑事实
不能替代完整 portable Receipt V2 验证。testing-only collector 现在可以组合已解析的有界 page 并运行该 portable
verifier，但当前 review 仍未创建 Host/native transport；parser 只接受 injected testing response，并明确不创建
production response authentication 或 retry authority。

另有一个 process-local JavaScript fixed-read session，用单一闭合的 testing-only harness variant 演练
reconciliation parser。callback 只能收到内置 query identity、精确排序的 28 个 hidden value、不可变 binding
digest、`search_path=pg_catalog` 要求，以及显式 read-only/live-catalog 要求；API 不接受 SQL、URL、endpoint、
PAT、header、credential 或 parameter override。公开 session 只保留 request 长度与 digest；request bytes 和复制后的
UTF-8 JSON response bytes 都会先受上限约束，再复用既有 strict parser。session 会在 callback 前永久消费，因此
concurrent、reentrant、failed、aborted、timed-out 或 parser-rejected run 都不能 replay；该 harness 的 deadline
只提供进程内 cancellation signal，不能抢占它的同步 callback，也不会声称已经取消 server query。这项限制描述的是
callback harness，不是下文的 async Rust kernel。callback 仍是任意的同进程
测试代码，因此它的 side effect，以及“没有生产 request/transport”这件事都没有被认证。result 使用不返回 genuine
review 的 opaque WeakMap provenance，并把 production transport、read-only boundary、live catalog、snapshot、
database、mutation、execution、Receipt 与 release authority 全部保持为 false。这只是离线 lifecycle/binding
harness，不是仍缺失的可信 native transport，也不会让不兼容的 Management read-only endpoint 变得可用。

下一段离线 native 工作现在把精确 wire contract 与尚未注册的 execution kernel 分开。115,192-byte 的
reconciliation statement 已物化为唯一的 versioned `.sql` artifact：TypeScript 通过 `?raw` 导入，Rust 原样
`include`，不做换行归一化；末尾 LF 与 SHA-256 digest 都被钉死，保留的 TypeScript generator 会对任何 byte
drift fail closed。TypeScript contract 只接受固定 query/version、精确排序的 28 个 string-or-null 参数、完整
binding digest、`search_path=pg_catalog`、read-only、timeout 与 response limit 声明；它还通过公开 lowcode schema
严格解析嵌入的 Scope V2 与 Receipt V2，要求 typed canonical bytes 逐字节一致，并把全部 positional value 重绑到
这两份文档和 Receipt-zero 状态。未知字段会被拒绝，SQL、URL、endpoint、header、PAT、credential 及调用方自选
session override 都不在协议中。

private Rust mirror 会先在反序列化前限制完整 request 为 262,144 bytes，拒绝 unknown/duplicate field，并独立复核
固定 artifact、canonical digest、PostgreSQL 数值/时间范围、嵌入 typed document 和全部 cross-binding；只有经过 trusted
consume 后，结果才可送入同一 fixed execution kernel。不可 Clone 的 Host evidence 会绑定 17 个 digest、28 个参数、
project、account、grant generation 与 database-read credential incarnation。private process-local
`ReceiptZeroReconciliationAuthorityV1` / `HostFixedReadEvidenceIssuerV1` seam 现在承接上游 handoff：issuer 会先
remove one-shot authority，再比较 candidate 或 credential snapshot，并要求精确 request digest、全部 17 个 binding、
全部 28 个参数、Host project/account identity、grant generation、database-read credential incarnation 与
connection-profile digest。它唯一的 populate 路径带 `#[cfg(test)]`；production 仍不能 mint 这项 authority，renderer
可重算的值不能填充它，全部 production-authority 与 release flag 仍为 false。另一份 process-local session registry
使用随机 32-byte opaque ID、最多 32 个 live entry、30 秒 TTL 和 remove-before-validate 消费，所以 mismatch、expiry、
replay 与 concurrent consume 都会 burn session。session ID 还必须在查 registry 前满足 canonical 43-character Base64URL；entropy failure 或有界 collision
耗尽会 fail closed，且不会替换已有 session；承载 identity 的值不会输出或会脱敏 `Debug`。grant generation 与现有 Host
authority boundary 一样固定为 canonical UUID v4。production evidence producer 仍刻意没有接线；注册前必须原子
消费上游 operation authority，不能信任 renderer 可自行重算的 digest。注入式 database-session 测试要求严格按
read-only begin、local search path、local statement
timeout、prepare、execute、finish 的顺序运行：read-only begin 会绑定 project/account/grant/credential incarnation，
prepare 直接接收编译期 SQL bytes 及固定 length/SHA-256，execute 只能按值消费该次 prepare 返回的 opaque handle。
任一 failure、cancellation、concurrent call 或 replay 都会 burn
kernel，并且 response 必须恰好一行、非空且受 byte limit 约束。kernel 的 decoded-value aggregate limit 仍只是
defense-in-depth；wire decoder 会在进入高分配 schema 工作前另行执行完整 request bound。
这里的 database-read credential incarnation 是一项必须存在的 nonzero opaque 32-byte Host marker；它不是现有
database-write incarnation，也不得从 credential bytes 派生。
现在的 dormant native credential reader 会在同一个 process/file lock 下，从五个固定加密 vault account 原子读取
password、database-read incarnation、strict canonical connection-profile JSON、独立的 connection-profile digest
witness 与 shared grant generation。password 原始字节只存放在 zeroizing 容器中；空值、NUL 与超长值会被拒绝，
已发布 generation 必须是 canonical UUID v4，两个 marker 必须是 canonical、nonzero 的 32-byte Base64URL。持久化
profile 必须已经是 canonical，重新计算的 digest 还必须与同一 atomic snapshot 中的独立 witness 一致。缺少 canonical
profile 的 legacy four-record 状态会 fail closed；必须先通过专用 credential command replace，才能提供 connection
material。`supabase-database-read` integration namespace 已从通用 renderer credential command 中保留，普通
credential resolver 不能读取、替换、删除或探测这些 record。现在另有三个只授权给 Tauri `main` window 的专用
command：status 只返回 `configured`、`missing`、`unavailable` 或 `invalid`；replace 会验证 password 与严格
non-secret profile，生成彼此独立的新 incarnation 与 UUID-v4 grant generation，再通过一次 vault CAS 原子更新五个
record；clear 会删除 password、canonical profile 与 digest witness，并轮换两个 marker。TypeScript bridge 会序列化
canonical profile，并严格校验 native status/receipt shape；mutation receipt 不含 credential 或 connection-profile bytes，且会
显式返回 commit durability。`confirmed` 表示 vault replacement 与目录项均已完成 sync；`unconfirmed` 表示 atomic
rename 已完成、但 directory sync 失败，调用方必须同时保留新旧 generation 并在重启后 reconciliation，不能用旧
generation 自动重试或授予 release authority。这三个 command 只接受固定 raw IPC envelope：status/clear 必须是
versioned magic 加一个 36-byte generation；replace 使用 versioned magic、三个 checked `u32` length 与 18,488-byte
aggregate cap。JSON body、错误 magic、截断、overflow、trailing bytes 以及超限 password/profile 都会在字段
deserialization 前被拒绝。Tauri 仍持有这份已受限、但不会被 zeroize 的 transport `Vec<u8>`；bridge 会在 invoke
settle 后覆盖自身 secret-bearing request buffer。现在只有 Tauri 中的 Supabase backend-plugin
Settings 控件会调用这条 bridge 的 status、replace 与 clear：它只能通过 Management PAT generation
resolver 取得当前 canonical generation；没有该 generation 时会明确要求先配置 Management PAT，绝不自行
生成。UI 只接受有界的 direct 或 Supavisor-session profile 字段，password 仅在提交时从原生 password
input 读取，随后立即清空 DOM input 与局部值。`unconfirmed` receipt 会显示为需要重启后 reconciliation 的
警告，保留前后两个 generation 并禁用后续 mutation；它绝不会被展示成已确认的凭据变更或 release authority。

与之配套的 non-secret connection-profile contract 只允许 staging 的 `direct` 与 `supavisor-session`。direct host/user
由精确 project ref 推导；session mode 只接受 `pooler.supabase.com` 下范围受限的小写 DNS host。两种模式都固定
port `5432`、database `postgres` 与 TLS `verify-full`；DSN、password、任意 connection option、其他端口、transaction
pooler 和 TLS downgrade 字段都不在 schema 中。strict parser、canonical serialization 与 SHA-256 Base64URL digest
可以生成上述 vault witness。registry consume 会按值读取一次新的 five-record snapshot；project、account、grant
generation、credential incarnation 或 profile digest 只要有一项不再匹配 retained Host evidence，就会 burn
one-shot session。得到的 owned session 会保留该 checked snapshot，并且自身也按值消费；sealed Host connector 只能
收到 validated profile 与 exact zeroizing password，调用方不能再提供另一份 identity、endpoint、option set 或
预构造 database session。runner 只从 retained Host evidence 派生 connection identity，把结果绑定回原始 request
digest，并保持内外两层 authority envelope 为空。

dormant Rust runner 现在还定义了 async Host-raced interruption contract。sealed Host interrupt source 会在 connect
前只采样一次，kernel 据此派生编译期固定的绝对 deadline：connect 为 5 秒，overall 为 30 秒；renderer 与 runner
caller 都不能提供或延长它们。`connect` 和每个可能阻塞的 database stage 都是 async，并收到适用的不可变 deadline
与 cancellation signal。kernel 自身会把每个 database future 与该 signal 进行 race。确定性测试使用真正始终
`Pending` 的 connect 与 execute future，证明 deadline 到期或 cancellation 可以抢占 run，而不是只在 await 前后
检查状态。database session 已存在后发生 Host timeout/cancellation 时，raced future 会先被 drop，session 随后才
收到 nonblocking local `cancel_database_request` trigger，再执行 `abort_read_only`。`BEGIN` 一旦被 poll，在得到证明
前其远端结果就按 unknown 处理；因此即使 `BEGIN` 从未返回，failure 或 interruption 也会保守 abort。connector
future 必须可安全 drop、不得 detach work，并且必须让 cancellation/transaction handle 在上述 nonblocking hook
执行时仍然可用。
connect 成功后由 armed execution guard 按值持有 database session，因此即使外层 runner future 在某个 stage
处于 `Pending` 时被直接 drop，也会先 drop 该 stage，再精确执行一次本地
`cancel_database_request` 与 `abort_read_only`；finish 成功后则 disarm。session 与 connector trait 还明确要求
`Send` future、`Send` session/prepared statement 和 `Sync` connector，并由 compile-time test 保证 consumed
runner future 对未来 Tauri runtime 集成保持 `Send`。

该 connector 与 interrupt-source seam 仍只有 `#[cfg(test)]` implementation；这些 deadline 后面尚无 production
timer、connector 或 PostgreSQL driver。

这些仍只是 contract、credential-lifecycle、decoder、Host-session 与 state-machine proof。main-window credential
command 不会创建 read session 或 execution authority；当前没有注册 fixed-read execution command/capability、
production connector/timer、PostgreSQL driver、socket、network request dispatch 或 server cancellation path。
因此 deterministic Pending-future 测试证明的是 kernel contract，不是 production wall-clock enforcement，也不证明
真实 server query 已被取消。所有 server-property、production-transport、database、execution、Receipt 与 release
authority claim 仍为 false；可重算的 wire digest 也不能认证 dynamic binding 是否来自 genuine Host-minted
operation session。后续真实 adapter 必须在 native 进程中绑定精确 project/account/grant generation 与 expected
review digest，解析独立的加密 database-read credential，强制 TLS，提供真实 monotonic timer，并持有独立的
PostgreSQL cancellation token；还必须证明 drop stage future 不会遗留 detached work，且 local cancel/abort trigger
能够终止或安全关闭对应 server request/transaction。生产 driver 必须在 protocol decode/streaming 阶段实施
row/byte cap，而不是完整分配结果后才检查；Tauri 外层也必须在 command deserialize 前实施 body cap。连接必须保留
真实 session：Supabase 官方把 [direct connection 与 Supavisor session mode](https://supabase.com/docs/guides/database/connecting-to-postgres)
用于 persistent/session 场景，而 transaction-pooler mode 不支持 prepared statement。可选的
[temporary token-based database access](https://supabase.com/changelog/46346-feature-preview-temporary-token-based-database-access)
仍受 project、role、expiry 与 platform 条件约束，因此当前 contract 不把它假定为通用 credential source。

现在还增加了 testing-only Receipt V2 first-page review：它把完整 reconciliation statement 与一条固定的
33 参数 page query 组合起来。参数 1–28 仍是 Receipt-zero CAS 的原始 hidden value；first-page suffix 固定为
`afterRevision=0` 加四个 null anchor 字段。query 在同一个 statement 内捕获 current head 四元组，按 revision
升序最多读取 4 份 canonical Receipt，并用第 5 个 key 做有界 lookahead；所有 managed table 引用都使用
`FROM ONLY`。response 会嵌入完整 reconciliation row，而不是让 Host 信任一个简化状态，因此 Host 会先复用
既有严格 reconciliation parser，再计算 page 状态。所有作为 JSON number 返回的 revision/count 字段都会先
经过范围约束并 cast 为 PostgreSQL `int4`；参数与内部 ledger arithmetic 仍使用 `int8`。canonical Receipt
JSON 以 Base64 bytes 传输，因此 response 不依赖把 `bigint` 作为 JSON number。

对应的 first-page response parser 同样只用于 testing。它会在任何 await 前快照精确的一行 wire shape，拒绝
accessor、symbol、sparse array、异常 prototype、negative zero 与不支持的 PostgreSQL 版本，再逐项验证 canonical
standard Base64、fatal UTF-8、canonical Receipt JSON bytes、SHA-256 Receipt digest、scope digest、Receipt-zero CAS
metadata、微秒时间与全部 page link。1–4 份 Receipt 到达捕获 anchor 时为 `chain-complete`；返回 4 份且存在第
5 个 key 时为 `page-ready`。revision-one `exact-replay` 的 reconciliation chain bounds 仍为 null，只有
`advanced-head` 才要求 `1..head`；完成页的最后 Receipt outcome 还必须与 live execution status 对应。marker
drift 会保留 reported diagnosis，但把 Host status 降为 `precondition-failed`。

continuation safety 仍是独立边界。first page 与 continuation page 现在复用同一套严格 decoder。genuine
`page-ready` first/continuation observation 只能绑定原始固定 anchor、紧邻的前一份 trusted page，以及该 page
最后一份 canonical Receipt；任何 response 都不能静默 re-anchor。每个 trusted continuation 会以 O(1) 引用保留
原始 first-page context，不会递归遍历或重复 hash page history。只有 live head revision 向前增加才属于 stale；
head 回退、同一 revision 的 event/digest/timestamp 被改写、head 缺失或重复都属于 corruption。

现在还增加了 testing-only one-shot collector。它只接受这些 process-local page identity 构成的精确完整序列，
最多处理 10,000 份 Receipt/2,500 个四 Receipt page，重新核验固定 anchor 与相邻 provenance，并把每个 canonical
page 流式交给同一个 provider-neutral incremental verifier，最后匹配 head digest；同时累计已经验证过的
`canonicalReceiptByteLength`，超过 655,360,000 decoded bytes 就 fail closed。page sequence 即使结构合法，
只要违反 cursor、count、exhaustion、terminal、size 或其他 Receipt V2 transition 语义也会被拒绝。冻结后的结果
只公开脱敏的 digest、count、decoded-size evidence、anchor metadata、outcome 与显式 authority flags，不公开
canonical Receipt 或 secret，并明确不授予 credential、transport、database、mutation、execution、Receipt 或
release authority；继承的 capture 若在返回前被撤销，collection 也会失效。

first 与 continuation review 现在都会绑定一份可序列化重验的扁平 transport-size certificate，以及一份根据各自
hidden parameter vector 精确重算的 per-request certificate。本地 policy ceiling 为：每个 string parameter 最多
87,384 UTF-8 bytes，compact fixed-key request 最多 262,144 bytes，其中 request framing 最多 32,768 bytes；
每个 page 最多包含 349,536 个已验证 Base64 character 加 131,072 framing bytes，因此 response 精确上限为
480,608 bytes；decoded canonical Receipt 仍限制为每页 262,144 bytes、完整 collection 655,360,000 bytes。
request certificate 只公开 byte count 与 SHA-256 digest，绝不公开 parameter value。raw testing wire decoder 会在
copy 或 parse 前先检查 response cap，使用 fatal UTF-8，拒绝 BOM 与非 compact JSON，再运行完整 strict page
decoder，并以已验证 Base64 character sum 计算 framing。旧的 already-materialized object-injection seam 刻意不能
认证 raw transport size 或 framing。这些只是精确的本地算术与 decoder bound，不是 outer IPC frame、protocol
streaming、response producer 或真实 database session 的证据。

不同 page 仍不共享一个 MVCC snapshot，也没有 production Host transport 认证或派发这些 query。因此 cross-page
head freshness、production response provenance、Tauri 外层 body limit 与 protocol-level streaming enforcement
仍不可用。

这还不是 production Apply 路径。testing factory 只接受 testing authority、transport、credential issuer 与
injected fetcher 的精确 identity。上文的固定 native Desktop catalog inspector 不会使 CAS-ledger installer 或
对应 verifier 自动获得 production authority；当前仍没有固定 native mutation composition、production verifier
provenance、installed Receipt、production source-ledger binding 或 release authority。自动化测试没有改动真实 Supabase 项目，也不能
把 DDL 复制进 SQL Editor 当作已审批 migration 执行。recovery handle 与 final intent 仍是进程内 WeakMap
identity。final journal 写入或回读结果不确定后，即使仍在同一个 controller 中，也不会从 evidence bytes 重建
已经消费的 proof；recovery 会保持 reconciliation-required、绝不重新 dispatch。进程重启后同样不能重建 attempt。

Host IndexedDB journal 现在会升级到 schema v3，并在任何 claim/read 到达 release controller 前执行一次
fail-closed 的启动事务。该事务只把带 final（或没有）且已做容量限制和 secret 扫描 evidence 的 `applied`
与 `failed` 记录移动到版本化 `dispatchTombstones`；只有 progress evidence 的 terminal record 会继续留在
active store，直到 final evidence 已持久化；`pending` 与 `outcome-unknown` 同样继续留在 active store，并持续
占用对应 provider/project mutation scope。read 与 exact claim 都会查询 tombstone，因此归档可以释放 active 容量，
却不会重新打开 semantic release key。active 上限为 256，tombstone 上限为 4,096。遇到不支持的 shape、
orphan evidence、active/tombstone 重复 fence 或容量耗尽，整个启动事务都会 abort，并在该 journal 实例中
持续 fail closed。这里依赖 IndexedDB 的原子 store commit/abort，不会自动删除 tombstone，也不会自动 retry。
这些记录只是 audit/replay state，并非 issuer；renderer 构造的同形对象仍不能铸造 Host controller 私有的
dispatch 或 release authority。

另有一套独立、dormant 的 Rust operation-journal kernel，用来证明缺失的 restart-safe 本地持久化语义，但不会
改变上述 production 状态。它在 process mutex 与 cross-process file lock 下原子替换一份有界 checksum journal，
强制私有文件权限、no-follow/regular-file 检查、staged-file sync、atomic rename 与 directory sync。testing-only
状态机持久化 `claimed -> outcome-unknown -> applied|failed`，并把 progress/final evidence 与对应 transition 放在
同一次 replacement 中；只有 durability confirmed 后才签发下一份 opaque one-shot capability。TTL 只允许进入
recovery，不会解锁 project scope 或产生第二份 mutation。dispatch 一旦可能开始，只有 exact positive applied
observation 能结算；negative/error 必须保持 `outcome-unknown`，而 `failed` 必须有 dispatch 未开始的证明。
wall/monotonic 双 deadline、持久化 reconciliation lease、exact record digest 和有界 reserved/burned/active registry
覆盖 restart、replay、clock change、collision 与跨实例并发测试。该 module 未注册 Tauri command 或 network client，
没有 production trusted-plan/claim constructor，也未连接 fixed-read issuer。本地 checksum 不代表 authenticity 或
remote fencing；same-user deletion/rollback 和真实 Supabase CAS ledger 仍在本切片之外。

native envelope 现已升级到 version 2，同时继续严格读取 version-1 body。每次进程重启后第一次取得 process/file
lock 的访问，会在同一份原子 replacement 内只把 terminal record 移入有界 tombstone；tombstone 保留完整已校验
record、progress/final evidence 与 record digest。`claimed` 和 `outcome-unknown` 绝不会被归档，仍会锁住 project
scope。已经 tombstone 的 exact key 永远不能再次 claim；只有旧记录已 terminal 后，不同 key 才能复用该 scope。
同一份 16 MiB 文件上限与 4,096 条 tombstone 数量上限同时生效，且不会自动 prune。归档状态损坏、容量耗尽，
或 directory sync 无法确认时，该 journal 实例会持续不可用；它不会 retry、签发 capability，也不会推断 mutation
scope 已释放。journal lock 内只清理自己命名的 stale staging file，不会删除无关文件。

在此之上又增加了一层 dormant native admission composition：它消费 verifier 的 sealed one-shot proof，并由
journal 内部计算 exact replay key、source-ledger scope key 与 admission-plan digest，不接受调用方提供这些 authority
字段。durability confirmed 后会为该精确 signed source-ledger scope 永久保留一条 `claimed` replay fence，只返回
30 秒、opaque、one-shot 的 handoff；handoff 过期或 drop 后不可再使用，但绝不会删除持久化 fence。若 directory
sync 无法确认，则不返回 handoff；atomic rename 后仍可见的 claim 会继续阻断重试，而该永久 admission handoff
仍刻意不提供恢复。
admission record 与 mutation recovery 分类隔离；所有 precommit、dispatch、settlement 与 reconstruct 路径都正向
要求 CAS-ledger-install kind，所以 admission 不可能升级为 database 或 release authority。当前 signed contract
没有由 trust root 定义的单调 sequence，因此这里只提供 exact replay protection，不能声称是 CI high-water 或
downgrade 排序。bounded journal 的启动恢复与 tombstone policy 不会让该 admission 变成 production path。
production trust roots 仍为空，也没有 native expectation constructor、Tauri command、credential source、network
client、database runner 或 mutation path。

另一个独立的 dormant native CAS-ledger-install composition 现在只消费 sealed、已审查、不含
secret 的 install-plan proof。journal 会在内部派生 canonical plan digest、exact replay key 与
project-scoped install key，且最多只能持久化 durability confirmed 的 `claimed` fence，再返回一个
30 秒 opaque handoff。production 代码仍没有 reviewed proof issuer，也没有从该 handoff 进入 precommit、
dispatch、mutation、reconciliation 或 settlement 的路径。正向 `claimed -> outcome-unknown -> applied`
流程只存在于 `cfg(test)`：它必须消费与同一 plan 和当前同进程 verification epoch 精确绑定的
single-marker `installed` observation；也只有确认持久化后的 settlement 才会报告
`databaseLedgerBound: true`。它始终不会报告 source-ledger、Receipt、mutation、execution 或
release authority。malformed、secret-like、trimmed、stale 与 cross-plan 输入无法写入或结算；
source-ledger admission 使用独立 operation kind，不能经此路径升级。两种 kind 共享有界的
256-entry persistent 和 runtime registry，但 admission 在两处都最多占用 224 个槽位，因此即使短期
admission handle 或永久 fence 已饱和，仍会为 non-admission install/recovery authority 预留 32 个槽位。
这是 capacity isolation，不是 garbage collection：terminal non-admission record 可以在启动时移入 tombstone，
但没有自动 prune/export authority，未决 non-admission record 仍能耗尽 active 上限。
现在又增加了一条 `cfg(test)` composition，把 durable installer 与 fixed catalog verifier 接在一起，但不会让
任何一侧从 production 可达。它不接受 caller SQL，并会在使用前重新核对两份 checked-in shared SQL source
的 byte length 与 SHA-256 digest：write 侧只使用 fixed base-install bytes 加 plan-derived marker，read 侧只
使用 fixed catalog-verification bytes。在两个 opaque database authority 中的任意一个到达首次 database
callback 前，journal 都必须已经 durability-confirmed 地持久化 `outcome-unknown`；write authority 与
read-only verification authority 分别连接，不能相互替换或 cross-wire。migration response 或 write success
都不能结算 `applied`；只有与同一 plan 和 verification epoch 绑定的 fresh、exact `installed` catalog readback
才可完成 durable settlement。one-shot testing handoff 使用 25 秒 fused deadline，严格落在现有 30 秒 journal
settlement TTL 内；expiry、drop、结果不确定、非精确 readback 或 durability 未确认都会 fail closed，且不会重新
打开 fence。这仍只是 testing-only composition：当前仍没有 Tauri command、真实 credential、经过认证的
Management API adapter、in-flight attempt 的进程重启恢复、production installer/verifier provenance、真实
staging 项目执行、Receipt issuance 或 release authority。
正式接线前，还必须由 journal 的同一时间源提供剩余 settlement TTL，并据此约束 operation deadline，不能在
durable precommit 后用另一时钟重新开始完整 deadline；同时需要把三张表的 verified owner 绑定到预期 write
authority 或专用 `NOLOGIN` owner。当前 testing-only 检查明确不声称这两点。

现在又用一个 production-compiled、但仍 dormant 的 native locked-high-water provenance registry
替换了 C0 module 内的本地 epoch 替身。production 只能创建空 registry：唯一 raw material 写入方法仍受
`cfg(test)` 限制，也没有 renderer decoder、Tauri command、managed state、credential source、database
connector、SQL runner 或 network transport。每份测试 proof 都是 opaque、不可 clone 的 handle，并绑定随机
issuer id、monotonic generation 与精确 capture digest。容量为 32 的 `active + burned` registry 会在 30 秒
monotonic TTL 内对 signed source scope 做 single flight；consume、drop 与 expiry 都会 burn entry，generation 校验
阻止 stale-id ABA 消费替代 entry，并发 consumer 只能有一个成功者。TTL 只会在取得 registry lock 后采样，
clock 倒退会 fail closed，registry lock 也绝不会跨越 database 或 network 工作。

registry 保留的 secret-free material 现在覆盖 signed source-ledger grant identifier，以及
read/install-write/capture-write 三代 credential generation、signed source scope、
provider/application/migration/source-ledger binding、彼此独立的 signed source-ledger subject digest
与 Compiler backfill-inspection subject digest、installed plan/marker verification、capture
review/catalog/query digest、精确物理 address、locked query/transaction 设置和 high-water count。校验规则与
TypeScript contract 对齐：非空表必须同时提供两个 cursor，空表则两个都不能提供；row count 必须落在 cursor
span 内；声明的 cursor maximum 必须精确等于 `Number.MAX_SAFE_INTEGER`，batch size 必须落在 Compiler 的
`1..=1000` 范围，maximum batch Receipt count 必须精确等于 `9999`；unsafe cursor 恒为零；batch Receipt 数
必须等于 `ceil(total / batchSize)`；数值不得超过 JavaScript safe integer；`observedAt` 必须是真实合法的
canonical UTC 日历时间。这仍不会在 production
中认证调用方自报 material。未来 native transport 必须从固定 result decoder 构造 observation，绑定
capture-write credential incarnation 或等价 transport authority，并在 Host 内部重新计算 canonical capture
digest；仅具备正确形状的测试 digest 不代表 provenance。source-ledger grant 复用签名 receipt 的 bounded
release-identifier grammar，三个 Host credential incarnation 则继续要求两两不同的 canonical UUIDv4。
locked capture 的时间戳必须等于或晚于 installed-catalog observation；二者仍属于两个独立 snapshot，但
capture 不得在因果顺序上早于它所依赖的安装证明。

新增的 C0 proof-composition 测试 module 现在会核对 durable source-ledger admission、仅测试可用的
durably Applied CAS-ledger observation、独立 opaque 的 Compiler backfill-inspection-subject proof，以及
native-registry locked-high-water proof 是否精确指向同一个 provider、environment、project、account、grant、
application、migration、source ledger、signed scope、install plan、marker、installed verification 与兼容
server version。signed source-ledger subject digest 与 Compiler inspection-subject digest 是两份独立 binding，
不得互相替换；inspection proof 还会绑定 migration-plan digest、table/cursor/target field、精确 cursor maximum、
batch size 与 maximum batch Receipt count。它按值消费 source、installed observation 与 inspection 三份
handoff，对 capture 只做不消费的 registry inspect，并拒绝 stale registry 与跨 domain 替换。随后它会把四份
完整、secret-free subject 投影为 journal-owned canonical material。同一个 claim 现在还会绑定固定 Receipt-zero
transaction identity、精确有序的 28 个 typed parameter、canonical padded-Base64 scope 与候选 Receipt bytes，
并在 plan digest 派生前独立重算 SQL、schema、parameter、scope、resource 与 Receipt digest，再把 canonical
scope 和内嵌 Receipt 与 source、installation、inspection、locked capture subject 全部交叉核对。逻辑
`entityId` 不等于物理 table name；未来 production issuer 必须从可信 V2 review context 取得它，而不是接受
caller data。外部 detached transaction object 无法替换 opaque claim 内按值保存的副本。仅测试可用的
initializer operation 只持久化
canonical plan digest 与项目级 `providerId + projectRef` stable scope，并且只有在 `Claimed` fence 确认持久化后
才返回 non-cloneable 的 inert durable-claim handle。被消费的 source-admission 与 installed-CAS handoff 还必须
属于接收该 claim 的同一个 opaque、process-local journal authority；来自另一 store 的同形 handoff 无法重新绑定。
journal reopen 时会从 plan digest 重新派生 single-flight key，并从 provider/project 重新派生 stable-scope key，
因此替换任一 key 后再重算无密钥文件 checksum 仍会被判定为 corruption。`captureConsumed` 为 false：sealed
capture 会留在 handle 内，供未来 precommit 在紧邻 database transaction 的位置消费。现在还有一份纳入源码、
严格解析的 JSON golden fixture，由 Bun 与 native Rust 测试共同消费。它对同一组四域 prerequisite subject
固定了递归 ASCII key 排序的 canonical material、精确 domain 加 NUL 的哈希、plan digest、single-flight key
与项目 scope key。各 domain 的 mutation 会改变 plan 与 single-flight identity，但不会扩大稳定项目 scope；
fixture 还明确保持 `captureConsumed=false`，且不包含 SQL 正文、URL、credential、precommit 或 execution
authority。Bun 侧直接调用共享的 `canonicalManifestJSON` encoder，而不是维护测试专用副本；所有 JSON 整数
（包括 source `runAttempt`）都会按适用语义限制为正的 JavaScript safe integer。同一套完整 material model、
validator 与 private canonical identity derivation 现在会作为纯数据处理进入 production 编译；production 不会为
这些 material type 编译 deserialization，不会构造 `TrustedOperationPlanV1`，也仍未暴露 initializer claim、
precommit、database、network 或 dispatch 入口，只有测试可以把 validated identity 转成 journal plan。
现在还增加了第二份纳入源码的 golden fixture，固定 Compiler 真正生成的 Supabase backfill inspection 完整
envelope、递归 ASCII key canonical SHA-256 digest，以及 C0 精确使用的 14 字段 projection。native mirror 会拒绝
unknown 或 non-canonical JSON、unsafe number、secret-like material、任何 authority flag、外来 built-in identity、
被替换的 artifact path，以及无效 migration marker/limit。第二个真实 Compiler vector 还固定了 finite-float target
与未声明 matched-row minimum 的组合，并在 Rust 边界核对 ECMAScript number formatting。`migrationPlanDigest`
明确取自已生成的 migration-plan artifact，而不是 Provider plan digest 或 adapter-plan digest。production 编译的 bounded registry 会把验证后的
projection 封装成 opaque、按 scope single-flight、一次性消费的 handoff；C0 也必须经原 issuer registry 消费
inspection proof，不再直接构造本地替身。所有 production 可达 caller 仍只能创建空 registry；raw envelope 与
projection 的 issuer 都受 `cfg(test)` 限制。唯一进入 production 编译的 issuer 私有于 Compiler sidecar module，
并且只接受 strict decoder 产生的不可 clone、不可序列化结果。因此，自洽的 subject digest 只证明兼容性，不代表
provenance 或 execution authority；未来 caller 必须只经 trusted native Compiler/Host 重建边界触达该 issuer，
并核对 registry 内保留的 package、plan、application 与 emission authority。

这条重建边界现在已经具备 canonical Compiler wire、隔离的纯 sidecar runtime，以及 dormant native runner kernel。
除 protocol version 外，请求只精确包含规范化 Backend V2 application、React/Vue target 与 Host nonce，不能携带
Provider selection、compilation mode、SQL、credential 或 execution instruction。domain-separated request digest
覆盖 canonical version、target 与 application，并刻意排除 nonce；但外层 process response 与内层 Compiler
response 都必须绑定同一个已经校验的 nonce。response 还携带一份针对已审查 descriptor 与 trust profile 的固定
Compiler-only trust digest；它不是 app bundle digest、installed-package evidence、publisher provenance、binary
signature，也不授权填充 native inspection registry。

`@open-pencil/backend-compiler-sidecar` runtime 固定使用内置 Supabase V2 registry 与 Compiler selection，并且只以
`production` mode 规划。它只接受一条由单个 LF 结尾的 canonical JSON request，只返回一条由单个 LF 结尾的
canonical JSON response，stderr 必须为空，失败也只能使用枚举的静态 error code。规划路径不会读取 ambient
environment 或 filesystem，不执行 network 或 SQL，不解析 credential，也不创建 database-write、execution、
Receipt 或 release authority。私有 Rust decoder 从 Host-owned canonical application 加 target/nonce 构造请求，
随后严格校验外层 process envelope、内层 Compiler envelope、exit-status/stderr contract、nonce/request-digest
binding，以及完整固定的 Compiler、Provider、application、target 与 mode binding，最后复用完整 Subject
validator。纳入源码的跨语言 fixture 将 TypeScript producer 与 native decoder 精确绑定。在 Unix 上，私有 Rust
runner 只会把已打开且通过 pin 校验的 binary 复制到 opaque Host-owned `0700` runtime root 下的新目录，sync 并
重新哈希这些 bytes，关闭 writable handle，再通过 `O_NOFOLLOW` 以只读方式重开 `0500` snapshot，并在 spawn
前复验 file identity。child 不接收参数，只获得清空后固定的最小环境、私有 working directory、一条有界 request
frame、并发有界 output pipes 与 30 秒 monotonic deadline。timeout、output overflow、thread 创建失败或 descendant
继续持有 pipe 时，Host 会取消 pipe，并在固定时限内 kill/reap Unix process group。只有 strict decoder 完整成功，
私有 issuer 才能创建 scoped one-shot registry proof；失败不会占用 scope。同一个 opaque runtime-root capability
还持有 fail-closed、发生在 snapshot 之前的 single-flight admission：它会在任何 snapshot、copy 或 spawn 前取得，
并一直持有到 registry issuance 完成；RAII guard 会在成功、decoder 拒绝、timeout、cleanup failure、registry
collision 或 panic 时释放。这个上限属于每个 Host capability，并不是 renderer 可见或 process-global semaphore。
当前仍没有 production caller 或 runtime-root constructor。按路径执行无法防御 compromised same-UID process 替换私有 snapshot，恶意 descendant
也可能用 `setsid` 逃离 process group；两者继续作为 OS sandbox/post-sign packaging gate。在实现等价的 Windows
Job Object 与私有目录边界前，non-Unix execution 会明确返回 unavailable。

candidate-only 工具现在会关闭 Bun ambient config 与 dotenv autoload，为每个已声明平台构建 executable，并输出
严格十字段的 canonical provenance manifest，其中固定 target、精确名称、byte length、executable format check 与
SHA-256 digest，同时保持 release、execution、registry-issuer authority 全为 false。target-scoped exclusive lock、
私有 staging directory、file sync、受支持 Host 的 directory sync 与 manifest-last commit marker 会让中断的发布
fail closed。由于 Node/Bun 在 Windows 上没有可移植的 directory flush primitive，Windows 会明确记录较弱的
`manifest-digest-fail-closed` durability mode，且不宣称 crash-durable availability。host-target smoke 会把已验证
candidate 复制到私有 snapshot，按 manifest 对复制后的 bytes 重新完整哈希，并且只执行该
snapshot；这只是 build verification，不是 Desktop production runner。
release build matrix 现在会对每个已声明 desktop target 运行 candidate build 与独立的
`--verify-only`，并且只在匹配的 native runner 上执行 protocol smoke。该流程不会设置 pin-manifest
environment variable，不会把 candidate 加入 Tauri `externalBin`，也不会把 candidate provenance
提升为 packaged release authority。

`desktop/build.rs` 只会通过显式的 `OPENPENCIL_BACKEND_COMPILER_SIDECAR_PIN_MANIFEST` build environment
variable 接受 candidate manifest，按 Cargo 精确 target 重新验证 sibling binary；未选择时一律编译为
`Unavailable` pin。私有 Rust verifier 会重新检查精确 absolute candidate path、file identity、header、length 与
digest，然后把已打开文件保留在不可序列化、不可 clone 的 opaque token 中，其 authority flag 仍全部为 false。
runner 没有 production caller，Host-owned runtime-root capability 也没有 production constructor。当前仍没有
production candidate locator 或 issuer caller、Tauri command、renderer capability 或 database authority。

因此它仍是 P1 integration gate，而不是可达的 production Inspector。private sidecar package 现已加入 root
workspace、lockfile、package build/typecheck、type-aware lint、format、compiler unit-test shard 与 coverage selection。
binary 构建与 smoke 仍是显式命令，不会进入普通 package build 或 quick test。candidate manifest 不等于 signed
release provenance、installed-package evidence、codesign、notarization、Authenticode，也不是最终 packaged bytes
的 digest；签名本身可能改变 bytes。
当前也没有 Tauri `externalBin` entry。未来 process launcher 必须是 native、Host-internal；这个 Backend Compiler
sidecar 绝不能通过 `shell:allow-spawn` 或 renderer command allowlist 暴露给 renderer。production 仍需要 post-sign
packaged-byte provenance、经过审查的 packaged-candidate locator 与 Host runtime-root constructor、面向 sealed
private issuer 且受 capability 约束的 production caller、真实 source/install-ledger observation provenance、
locked-high-water trusted producer、经过审查的 production initializer constructor 与 journal precommit、面向已编译
SERIALIZABLE runner 的 certified database adapter、reconciliation path 与 bounded mutation runner。

两个 database observation 会刻意保留
不同的 `observedAt` 与 `snapshotMarker`，因为 installation
verification 和 locked capture 属于独立事务。C0 composition 仍只在 `cfg(test)` 下注册，而 capture registry
本身会进入 production 编译，但没有 production population path。消费前三份测试 handoff 会 burn 各自的
process-local one-shot entry。claim handle 的 drop 或 TTL 到期不会删除 durable fence；directory-sync 失败会被
视为 durability-unconfirmed，并留下 fail-closed 的 orphan `Claimed` record，而不是删除或自动重试。exact replay
以及同项目任意另一条 unresolved initializer 都会被阻断；unresolved CAS-ledger install 与 initializer 会双向
冲突，而 prerequisite source admission 可以共存。C0 handoff 本身没有 production 可达的 initializer
precommit、dispatch、settlement 或 fixed-read reconciliation capability；database、mutation、execution、
Receipt、retry、request-dispatch 与 release flag 全部保持 false。

Receipt-zero initializer 现在还会在 production build 中编译一个 private 且不可达的 precommit/runner contract。
它消费并固定共享、已签入的 CAS SQL artifact 精确 bytes，验证按顺序排列的 28 个 PostgreSQL typed parameter
及其 canonical encoding，并固定单次 `SERIALIZABLE READ WRITE` transaction：`pg_catalog` search path、
`row_security=off`、15 秒 statement timeout、5 秒 lock timeout、`synchronous_commit=on`、一个 prepared
statement、最多一行且不超过 64 bytes 的响应，以及 25 秒 fused Host deadline。固定 SQL 还会在自己的
runtime guard 中独立要求 `current_setting('synchronous_commit') = 'on'`，因此 adapter 无法静默跳过或弱化
runner 的固定 `SET LOCAL` 阶段。只有 `inserted` 与 `exact-replay` 可以进入 commit；`advanced-head`、
`corruption`、`precondition-failed`、畸形响应、取消、超时和任意阶段错误都会 fail closed。即使 commit ACK
成功，也只会得到必须经过独立 fixed read-only reconciliation 的结果，不能授权 journal `Applied`、Receipt
签发、settlement 或 release。commit 一旦派发，含糊的 I/O 结果、取消、超时或 future drop 都不会触发
cancel/abort 或自动重试。one-shot runner、cleanup guard，以及每个阶段失败和 pending future drop 只通过
deterministic fake session 测试。

Journal 现在还增加了一条 initializer 专用、testing-only 的 B2a precommit 与 restart kernel。创建 `Claimed`
之前，它会预检未来将持久化的精确 progress evidence；`Claimed` 仍只保存 canonical plan digest 与 stable
identity。durability 确认后的 precommit 只会把精确记录推进为 revision-two `OutcomeUnknown`，并将经过完整校验、
不含 secret 的 initializer material 递归 canonicalize 成 JSON，再编码为固定 2,048-byte 的 Standard Base64
chunks。Base64 只是编码，不是加密。canonical material 上限为 512 KiB，对应最多 699,052 encoded bytes 与
342 chunks；全局 2,048-byte string、1 MiB evidence、16,384 nodes、depth 32 与 16 MiB journal 上限均未放宽。
restart 会依次重新校验 evidence checksum 与全局边界、精确 chunk shape、canonical Base64、decoded length 与
digest、strict typed JSON、canonical reserialization、全部 material invariant，以及重新推导出的每个 plan/scope
identity。只有同时越过原 claim lease 与 transition 后 30 秒 quiet period，才能返回 inert、opaque recovery
handle。

testing-only 的 B2b layer 现在会为这份 recovery handle 建立 initializer 专属的 60 秒 durable
reconciliation lease。begin 会持久化单调递增的 generation、domain-separated authority digest、固定的
issued/expiry timestamp 和 `consumed: false`；durability 未确认前不会签发 opaque permit。consume 必须同时
匹配精确 journal record 与 runtime permit，先持久化 `consumed: true`，并且只有这次 replacement 也确认
durable 后才签发 read attempt。仍处于有效期内的 unconsumed 或 consumed lease 都会阻止 restart
reconstruction；只有 lease 到期后才能推进下一代。directory sync 的不确定结果可能让任一 durable form
已经可见但不返回 capability，也绝不会因此授权自动 retry。

B2b 刻意提供两种互不替代、inert、不可序列化的 testing handle，而不是一份通用 runner token。live
precommit lineage 拥有精确 25 秒窗口；restart reconciliation read 则在原 60 秒 durable lease 内拥有精确
30 秒窗口。两者都必须使用同一个 `JournalClock`，并在 persistence 结束、取得最终 runtime lock 后重新采样，
同时确认 wall-clock 与 monotonic clock 均还保有完整 runway。缓慢的 filesystem 工作或 lock contention 只会
消耗原有 runway 并导致拒绝签发，绝不能续期任一 deadline。initializer kind 继续被全部 generic dispatch、
recovery、settlement 与 terminal-transition API 排除。B2b constructor 本身不会创建 database consumer、
credential lease、authenticated observation、mutation、settlement、Receipt 或 release authority。

testing-only 的 B3a composition 现在封闭了本地 capture-to-journal handoff，但没有让 database runner 变得
可达。第一段 journal 操作会 burn 原 claim，并在最终 store/file lock 内构造、验证、精确序列化和检查
revision-two `OutcomeUnknown` 的大小；只有 file replacement 与 directory sync 都确认后，才返回 opaque
staged token。该 token 同时绑定同一个 journal instance、capability id、record digest/revision、原始双时钟
ceiling、完整 initializer material 与 capture digest。随后 proof composition 只消费一次 sealed
locked-high-water capture，把每个 captured field 重新投影回 journal-owned material，并要求完全相等。publish
会重新打开 store，要求精确的 `OutcomeUnknown` record，且不存在 final evidence 或 reconciliation lease；最后
再在 runtime lock 内做同一时钟检查，之后才插入 inert dispatch permit。最终 proof-level wrapper 保持 private，
不会暴露内部 journal dispatch handle。下述 B3b path 只接受这份 fused wrapper，绝不能接受尚未证明 capture
已消费的旧裸 testing dispatch handle。

testing-only 的 B3b composition 现在会按值消费整份 private wrapper。只构造 future 不会产生任何 journal 或
connector 副作用。第一次 poll 会先取得 opaque connector-clock anchor，重新验证完整 journal material（包括
canonical parameter-values digest），再仅从 static parameter schema、durable source/capture/transaction fields
重建精确的 28 个 typed value；随后依次消费 dispatch、签发 live window，并在重新读取精确 revision-two
`OutcomeUnknown` record 后最终消费该 window。最后一次 journal 检查要求不存在 final evidence 或
reconciliation lease，并在最后一次双时钟采样下消费精确 runtime attempt。任何 file、journal 或 runtime lock
都不会跨越 async boundary；sealed lazy connector 会在这段同步前缀之后立刻首次 poll，中间没有 await gap。

同一份 fused 25 秒 ceiling 覆盖 connect、transaction setup、prepare、execute 与 commit。external deadline
取“原 connector anchor 加 25 秒”和“当前 connector time 加 journal one-shot 剩余时长”两者较早值，因此同步
前缀耗时只扣减一次，不会重复扣减。每个 stage poll 都检查 cancellation、external clock rollback、external
deadline，以及仍然有效的 journal wall/monotonic ceiling。precommit 自己持有的 testing connector 不接受调用方
endpoint、TLS mode、credential、SQL、parameters、timeout、prebuilt session 或 detached cancellation task。
proof layer 只能选择有界测试结果并读取 diagnostic stage/deadline trace，不能控制 deadline，也拿不到 raw
session contract。

六个 SQL identifier 位置（`executionId`、`applicationId`、`migrationId`、`eventId`、`receiptId` 和
`idempotencyKey`）现在会在 durable claim 前统一执行 fixed precommit grammar：1–128 bytes，首字符必须为
ASCII 字母或数字，后续仅允许 ASCII 字母数字、点、下划线、冒号或连字符；Host review 也提前镜像同一约束。
这关闭了此前 portable 256-byte identifier 或包含斜杠/`@` 的 identifier 能通过 review、消耗 capture，最后却
被 fixed runner 拒绝并留下 durable wedge 的路径。

commit ACK、明确的 commit rejection 与含糊的 commit result 最终都只会产生 private、不可 clone、不可
serialize 的 `DurableReceiptZeroInitializerNeedsIndependentReadV1`。journal 继续保持 `OutcomeUnknown`；所有
database、settlement、Receipt V2、retry 与 release authority flag 均为 false。commit 前失败不会返回任何后继
authority，同样保持 `OutcomeUnknown`，且无法复用已经消费的 writer lineage。B3b 刻意没有加入 B3c readback、
`Applied` transition、Receipt V2 issuer、settlement 或 release path。

stage 之后的任意失败都保守地保持 `OutcomeUnknown`：capture 丢失、比对失败、时钟耗尽、record drift 或 publish
失败都不能恢复 capture，也不能重新 mint writer。directory durability 未确认时，不会返回 staged token 或
permit。更早的 deterministic pre-persist `Full` 语义刻意维持不变：transient claim 会被 burn，并可能留下 durable
`Claimed` repair wedge；当前仍没有 `Deferred` retry surface。它是 fail-closed 的，但仍属于 operator repair 与
capacity reservation 技术债。

durability 继续 fail closed。directory sync 未确认时，已经 rename 的 `OutcomeUnknown` 可以在 restart 后恢复，
但不会返回 dispatch handle。如果 journal 在 claim 与 precommit 之间变满，或 precommit 在持久化
`OutcomeUnknown` 之前失败，transient claim authority 会被 burn，未改变的 durable `Claimed` fence 会保持阻断且
没有 restart path；不得自动 write 或 retry。后续切片必须增加可信的 known-not-dispatched/`Claimed` recovery gate
（或 durable capacity reservation），并补 observation 与 operator repair。initializer record 目前也尚未进入通用
unresolved-operation listing。

这个静态 contract 不会创建 production live authority。initializer claim、precommit、dispatch-handoff、restart、
B2b lease、fixed-window constructor、sealed connector harness 与 B3b composition 仍由 test gate 隔离。当前没有
production capture consumer、credential lease、database adapter、经过认证的 server cancellation、可信
commit-time 来源、authenticated response、Receipt V2 issuer、
production reconciliation/settlement path、production caller、Tauri command、network call、registry wiring 或 release
authority。在这些 bridge 分别完成审查前，这个已编译 shape 不能获得 database session，也不能执行其中的 mutating
statement。由于 recovery chunks 会刻意隐藏通用 evidence scanner 无法直接看到的内部自由文本，production issuer
上线前还必须保留 sealed provenance，并持续强制执行 decoded material 的强 secret 检查。testing-only fused
runner 现在会在第一次 database poll 前重新验证精确 durable record 与双时钟 freshness，并将 commit ACK 只导向
private independent-read handoff；production 仍缺少经过审查的 adapter 与 caller。commit acknowledgement 本身
绝不能 settle journal 或签发 Receipt V2。B3b 也尚未闭合 production database TOCTOU：locked-high-water capture 使用的 application-table
lock 会在 capture transaction commit 时释放，而固定 28 参数 ledger statement 不会重新锁定或完整重验
application table。production 必须让同一条 live transaction/session 一直存活到 CAS，或者新增一条经过审查、
能够重新取得并验证完整 barrier/catalog state 的固定 CAS statement。deterministic pre-persist
`Full`/orphan-`Claimed` wedge 也仍然存在；参数 21 的 candidate commit time、参数 25 的 request digest
与参数 28 的 operation-evidence digest 仍属于 untrusted input，不能充当 release evidence；目前还没有独立的
canonical trusted request provenance 对参数 25 做认证。

另有一条 testing-only Automation CAS reconciliation review 会复用 mutating review 的精确 immutable 27-value
snapshot，并把它降低为一条固定的 72,823-byte `SELECT`。template 只允许一个 compiler-owned、20 字符的
application key 替换，包含 17 个 schema occurrence 和严格按参数顺序排列的 PostgreSQL cast；不包含 DML、DDL、
`CALL`、row lock、caller SQL 或 caller schema。单次 read-only transaction 必须先建立 `pg_catalog` search path、
`row_security=off`、有界 statement timeout、专用 `supabase_read_only_user`，并处于 PostgreSQL 15–17 的 primary
snapshot。query 只有在完整 catalog/runtime/input gate 全部通过后才读取 managed row；head 最多读取 2 行、revision
最多读取 1,026 行，最终只返回一列 non-null text JSON，大小上限为 128 KiB。紧凑事实只会分类为 `absent`、
`exact-replay`、`advanced-head`、`cas-conflict`、`corruption` 或 `precondition-failed`。

testing Host parser 只接受精确一行一列 text，拒绝重复或额外 JSON key，核验全部 26 个 typed field，重新绑定
proposal、record、query、SQL、parameter 与 schema-marker digest，检查 count/overflow 以及 gate-false 关系，并独立
重算六态 truth table；数据库返回的 reported status 只用于交叉核对。`absent` 永远不能证明之前的 mutation request
已经停止，`advanced-head` 也只能证明观察到的 relational chain；两者都不能认证具体 database，也不能允许 retry。
timeout、cancel、protocol、shape、UTF-8、JSON 或 database failure 都保持 indeterminate 并 fail closed。

同一份 raw SQL 还会被固定进 private、production-unreachable 的 native reconciliation kernel。其 test-only issuer
会在内部重建固定 statement，独立验证 canonical proposal/record bytes 与全部 27 个 typed cross-field binding，通过
128 KiB sink 流式接收精确一个 declared-length response，解析完整 observation，并在一次运行后 burn。它固定
`BEGIN READ ONLY`、session hardening、prepare/execute/finish 顺序，只在 request 仍 pending 时执行
cancel-then-abort。任意 row、column、chunk 或 declared-length 协议违规都会永久 poison sink，因此未来 adapter
即使吞掉 callback error，也无法随后把它伪装成成功。native 还会独立 canonical 重算精确的 parameter-schema 与
reconciliation-query digest；recovery 会重新计算 application-scoped mutating SQL digest，任何仅格式正确的替代值
都会在 database callback 前被拒绝。当前仍没有 credential source、live database adapter、
production constructor/caller、Tauri
command、journal settlement、authenticated readback、Receipt issuer、retry、mutation 或 release authority。

现在还增加了一条 sealed、testing-only recovery admission，为这个 kernel 使用独立的 operation-journal kind，
但没有让它从 production 可达。进入模拟 dispatch 边界前，typed progress evidence 会持久保留完整且不含 Secret
的 27-value material，包括两份 grant generation、credential/installation incarnation digest、immutable
review/query/SQL/schema binding，以及精确 canonical parameter snapshot。canonical proposal/record JSON 的
decoded 上限为 1,536 bytes，使 standard Base64 结果一定落在 journal 单 string 的 2,048-byte 上限内；而且在创建
任何 durable claim 前，会先按全部 journal evidence 限制预检精确 progress payload。重启后必须先跨过 5 分钟 claim
high-water，且只能从 journal 自己持有的精确 record 与 evidence 重建 authority；caller 不能替换或重新拼装
material。随后 journal 会持久化一份 Automation 专属的 60 秒、single-use reconciliation lease，绑定 generation
与 authority digest，并在签发 fixed-read attempt 前先把 lease 标为 consumed。这个窗口刻意大于 runner 的 30 秒
overall deadline，但不会扩大其他 journal capability 的生命周期。同一 database-head scope 的第二次 attempt 会被
拒绝；drop 或到期也只会保留 durable `OutcomeUnknown` fence，不会重新开放 mutation。

现在还增加了 test-only fused composition，唯一 authority input 是按值传入的 opaque recovery handle。创建 future
不会触发任何 transition；首次 poll 会无 `await` 地连续完成 begin、durable consume、material 重验、精确 27 参数与
review 派生，并立即 poll 固定 runner。consumed attempt 会一直由 future 持有到 runner 返回或 future 被 drop，且返回值
不会携带 journal observation authority。测试已证明：未 poll 即 drop 时 database/cancel/abort 都为零；过期或
durability 未确认会在 database 前失败；pending drop 会 cancel 后 abort；第一个 database callback 能看到 durable
consumed lease；六种 raw state 最终都让 journal 保持 `OutcomeUnknown` 且没有 final evidence。这个 60 秒 testing
lease 仍不是 production-grade strict single-flight：OS suspend 可能超过 lease，注入的 timer/database adapter 也尚未
绑定经过认证的 project、credential 或 installation authority。

这条 recovery path 刻意不提供 settlement API。当前全部 reconciliation observation 都未经认证，因此 raw
`exact-replay`、`advanced-head`、`absent`、conflict、corruption、precondition 或 error 都不能结算原 operation；
尤其 `absent` 永远不能证明之前的 mutation 没有执行。恢复后的 attempt 不授予 credential、network、Tauri、
database-adapter、automatic retry、Receipt V2、mutation 或 release authority；这些仍是需要分别审查的 production
blocker。

固定单 statement、仅 catalog 的 Host verifier 及其 operation-scoped Management transport 现在可以把精确
schema 分类为 `absent`、`installed` 或 `mismatch`。核验会绑定 review/query/project/account/grant digest，
要求 primary database 的单 snapshot，并且只接受 current/session 完全一致的
`supabase_read_only_user`：该角色必须非 superuser、不得是任何 ledger owner，effective search path 必须精确为
`pg_catalog, public`。同一 snapshot 还必须证明 current/session role 都具有 `BYPASSRLS` 且能立即 `USAGE`
`pg_read_all_data`；仅有 membership 不够，因为它可能并未被继承。否则 verification 不可用；这与 Supabase 当前 hosted
[只读查询角色](https://supabase.com/docs/guides/platform/access-control)一致，并会在 self-hosted 或未来平台角色变化时
fail closed。PostgreSQL 将 role `USAGE` 定义为无需 `SET ROLE` 即
[立即可用的权限](https://www.postgresql.org/docs/17/functions-info.html)。`transaction_read_only` 仍只保留为证据，
不会冒充 endpoint 的承诺。
精确 catalog 比较会拒绝 partial shape、任何非 owner 的 schema/table/column/default ACL、owner role membership、
RLS/policy 漂移、用户 RULE、`EXCLUDE` 等不支持的 constraint、意外 index/trigger、禁用的 FK constraint trigger、
unlogged/partitioned/inherited table、replica identity 或 dropped-column history、publication 暴露、column
type-modifier/collation 漂移，以及不健康的 constraint-backed index。它不会读取 ledger 或应用数据行，也不会
安装 DDL。核验还会把每个 primary/unique/FK constraint 绑定到 normalized btree index 的精确 identity、
table、按序 key/include fields、operator classes、index options、collation 语义和健康标记；三条 FK 会明确
绑定各自引用的 supporting index，并按 schema、名称与左右 operand type 固定 PostgreSQL 三组 equality
operator arrays，不保留 cluster-local OID。Host result 会把 observed/expected column 与 constraint fingerprint
digest 冻结进最终 verification digest，使后续 controller 能绑定精确语义而不是只依赖 health boolean。它仍不
创建 mutation、execution、Receipt 或 release authority。
同一个 snapshot 只会公开指定 constraint 上经过严格格式校验的 marker comment，以及整个 schema 内具有安装
marker prefix 的 constraint comment 数量；任意 raw comment 会直接被拒绝。marker 缺失、不同、重复或位于错误
constraint 时，只能作为后续 journal controller 的 evidence；它不会改变 `verifiedInstalled` 的结构验证语义，
也不会单独授予 install 或 mutation authority。

verifier proof 本身仍不创建 Receipt，也不建立 execution、database-ledger、production source-ledger 或 release
authority。testing controller 虽然能持久化确认一个精确安装，但该 capability 与未来 production consumer
刻意隔离。官方 migration endpoint 返回 200 空 JSON，因此 authority 边界是安装后的 catalog readback，而
不是 POST response。真实项目执行、mutation attempt 的进程重启重建、接入 production 的固定 native installer/verifier
composition 与 production-only verifier provenance 仍是明确 release gate。table lock 也不能阻止独立授权的
`nextval`/`setval`。Receipt V2 已建模
deletion-safe terminal exhaustion，DDL 审查也固定了预期 ledger shape，但当前尚无 production database
transaction 初始化并持久化 CAS chain，因此 cursor/sequence mutation authority 与对应 database-backed
实现仍未解决。candidate Provider/Compiler 路径保持不变，继续携带其静态 high-water/runner blocker。

P2 现在已有仅供审查的 Queue/Cron、idempotency-ledger、transactional-Outbox 与 operational-event-sink schema
artifact，以及纯 retry-disposition、不可变 idempotency-CAS、Queue Worker/transactional-Outbox handoff、
operational-event sink-CAS 和 Webhook endpoint/HMAC-subject 契约；另有 testing-only 的固定 Supabase Automation
idempotency-CAS mutation/read-only reconciliation review、严格 response parser，以及 production 不可达的 dormant
native runner contract。但仍**尚未**实现 exclusive atomic write authority、可执行的 Receipt 驱动
backfill、production Host queue worker 或 Cron job、Webhook network transport、database CAS/outbox/sink execution 或 monitoring
drain。剩余 Provider 工作继续按受限切片推进：locked high-water
capture 的真实 staging 认证，然后完成接入 production 的固定 native CAS ledger 安装/verifier composition、capture Receipt CAS
持久化与有界 Receipt V2 runner；Automation CAS 的 authenticated database adapter、journal precommit 与固定只读
reconciliation 的 production binding；带 idempotency/retry/DLQ 的 authenticated private Queue/Outbox execution；
签名 webhook intake；最后接入 drift 与 observability Receipt。后续 release-authority 切片必须
移除或进一步约束 direct REST update，才能宣称 exclusive atomic write。对应当前 Supabase、PostgREST 与
PostgreSQL 边界见
[Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)、
[Database Functions](https://supabase.com/docs/guides/database/functions)、
[Functions as RPC](https://docs.postgrest.org/en/stable/references/api/functions.html)、
[Transactions](https://docs.postgrest.org/en/stable/references/transactions.html)、
[Identity Columns](https://www.postgresql.org/docs/current/ddl-identity-columns.html)、
[Sequences](https://www.postgresql.org/docs/current/sql-createsequence.html)、
[Index Catalog](https://www.postgresql.org/docs/current/catalog-pg-index.html)、
[Constraint Catalog](https://www.postgresql.org/docs/current/catalog-pg-constraint.html)、
[Publication Tables](https://www.postgresql.org/docs/15/view-pg-publication-tables.html)、
[Queues](https://supabase.com/docs/guides/queues)、[Cron](https://supabase.com/docs/guides/cron) 与
[Database Webhooks](https://supabase.com/docs/guides/database/webhooks)。

第一版 resumable backfill 有意只接受 non-null、单字段 integer identity 主键，且 Provider 必须证明它
immutable 并只会 append-monotonic 增长。Source IR 只声明 cursor，不保存某个环境的 high-water；dev、
staging、production 各自在 Host/CAS 绑定的 Receipt chain 中捕获自己的 high-water。该 scope 还会绑定
Provider、authority、application、migration、source ledger、physical resource identity 与 batch size。testing-only
collector 现已验证 injected page chain 的 portable 语义与 deletion-safe terminal-exhaustion 规则，但当前
Provider 审查包仍不会持久化或认证这条 authority chain。data-change automation
的主键幂等也只允许 insert；update/delete 必须等后续
Provider-issued immutable event identifier 才能开放。

## Manual / Live Gate

真实 staging 至少需要：

- 独立 Supabase 项目和最小权限 Credential，值不得写入文档、Manifest、日志或 Receipt；
- 完整 read-only catalog inspection；
- 人工审查 migration、RLS、GRANT 与备份/恢复方案；
- 两个已确认 Auth 用户，验证 owner 成功、第二用户/跨 tenant 拒绝，以及所需 CRUD/upsert 负向路径；
- 应用使用 Function 或 Storage 时，在显式授权下通过 Desktop capability action 部署/验证对应 runtime、bucket 与 policy；
- production 再按套餐与运营策略开启泄露密码保护、SMTP 与 frontend-origin 等门禁；
- 模拟 timeout/restart，验证 `outcome-unknown` reconcile；
- Packaged Tauri 中验证 Credential 重启与 Receipt 持久化。

本地 Unit Test、静态构建、mock、CLI 成功退出或前端 URL 都不能替代这些 gate，也不能表述为 Production Ready。
