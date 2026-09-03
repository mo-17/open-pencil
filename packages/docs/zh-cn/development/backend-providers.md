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
`events.data-change` capability，入站与出站 Webhook 还要求验证 dedicated HMAC credential purpose。未知
capability，以及缺失、过期、未来时间或应用未要求的 evidence 都会 fail closed。Receipt digest 只能证明
完整性；release readiness 仅在 Host 已认证 subject 与 accepted receipt store 的上下文中成立，不能代替已有的
authority-bound Backend Release receipt。

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

P2 仍**尚未**实现 atomic RPC、queue worker、Cron job、webhook endpoint 或 monitoring drain。剩余 Provider
工作继续按受限切片推进：`SECURITY INVOKER` atomic RPC；Receipt 驱动的 backfill；带
idempotency/retry/DLQ 的 private queue 与 transactional outbox；签名 webhook intake；最后接入 drift 与
observability Receipt。对应当前 Supabase 边界见
[Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)、
[Database Functions](https://supabase.com/docs/guides/database/functions)、
[Queues](https://supabase.com/docs/guides/queues)、[Cron](https://supabase.com/docs/guides/cron) 与
[Database Webhooks](https://supabase.com/docs/guides/database/webhooks)。

第一版 resumable backfill 有意只接受 non-null、单字段 integer identity 主键，且 Provider 必须证明它
immutable 并只会 append-monotonic 增长。Source IR 只声明 cursor，不保存某个环境的 high-water；dev、
staging、production 各自在 Host/CAS 绑定的 Receipt chain 中捕获自己的 high-water。该 scope 还会绑定
Provider、authority、application、migration 与 batch size，进度不能倒退、越过 high-water 或在 terminal
Receipt 后继续。data-change automation 的主键幂等也只允许 insert；update/delete 必须等后续
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
