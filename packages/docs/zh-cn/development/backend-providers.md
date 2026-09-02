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

- `@open-pencil/lowcode/backend`：严格、可摘要、Provider-neutral 的 DataModel、Auth、Workflow、Migration 与 Release Core。
- `@open-pencil/plugin-contracts`：Manifest v2 的 `backendProviders` 只声明身份、版本、能力、配置 Schema 与输出类型，不能携带代码、SQL、URL、Secret 或 Executor。
- `@open-pencil/compiler/backend`：静态可信 Registry、能力协商、纯 `plan/emit`、Fake Provider 与内置 Supabase Bundle。
- App Host：精确绑定安装状态、publisher/package digest、Provider/Adapter 版本和能力；MCP/AI 只能执行无副作用的 bounded plan/audit。
- Host Release Controller：本地实现了最终重新 Inspect、drift 检查、durable atomic dispatch claim、重启 reconcile、`outcome-unknown`、Verify 状态与无 Secret Receipt；IndexedDB journal 会跨 Desktop 重启保留 pending/applied/failed/unknown 结果。
- Desktop Supabase Backend Provider Review：Packaged Tauri 中已有显式、独立于 frontend deploy 的 review-only 入口；Browser 不可用。
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

## 当前明确未实现

- Desktop Review 已接入固定只读 `pg_catalog` Inspector、Management project authority 校验与 Credential grant generation；CLI 仍不接入这些 live 能力。
- Desktop/CLI 均未接入 Supabase Executor 或 Verifier，UI 明确显示 live Apply/Verify unavailable。
- Inspected migration review 既接受空基线，也接受全部结构成员都有精确 OpenPencil marker、并通过同一 snapshot 的 OID/attnum 地址校验后还原出的 managed 基线；重复 review 只开放新增 enum value、nullable field 和普通 index。
- UUID generator、identity sequence、foreign key、non-null field、破坏性 migration、未知 ACL、第三方 permissive policy、当前 inspection database role 的非 owner default privilege 和名称冲突均不会生成可执行 SQL。
- 所有 SQL 都只是人工 review artifact；`applyAllowed` 与 `releaseReady` 始终为 `false`。

## Supabase 安全边界

每次 review 都要求完整、未截断的 project/account/query provenance，以及 object、column、constraint、index、RLS policy、ACL 与当前 inspection database role 的 default ACL inventory。每个 table column 必须携带来自 `pg_attribute.attacl`、进入 digest 的“无 column-level grant”证据；固定 provenance 查询还会证明 table、partition、view 与 materialized view 均不存在 column ACL。一旦任何 relation 存在 column ACL，就会在 snapshot 授权 review 前阻断。Enum column 必须按精确 type OID 与 Schema 绑定到已检查的 `public` enum，不能只靠同名恢复。第一轮 proposal 会为新建的 enum、table、column、constraint、index 与 policy 写入精确 `COMMENT` marker；下一次 inspection 必须把这些 marker 绑定到同一 snapshot 的 PostgreSQL OID/attnum 地址，并从实证还原当前 `DataModelIR`。Managed table 的每个结构成员都必须有正确 kind/id 的 marker；未标记成员、伪造/畸形 marker、constraint-backed index 混入普通 index、或没有同时启用并强制 RLS 都会 fail closed。已标记 policy 会在同一个 review transaction 中显式 drop/recreate；只有与目标完全相等的 runtime grant 集合才会复用。新增 enum value 必须作为一份独立 migration review；同一 plan 只要还包含其他 operation 就会 fail closed，避免在创建新值的事务提交前消费该值。

固定查询会排除该角色固有的 owner 权限以及其他 Provider system role 所有的 defaults；Supabase `public` Schema 对 `PUBLIC`、`anon`、`authenticated`、`service_role` 和 inspection database role 的标准、不可转授 `USAGE` 被视为安全 provider baseline。`CREATE`、grant option、额外 object grant、第三方 grant，以及任何会影响 OpenPencil 新建对象的非 owner default grant 仍会进入 snapshot 并阻断。database role 本身也绑定进 provenance 与 inventory digest。`anon`、`authenticated` 和 policy/ACL 引用的每个 grantee 都必须有完整的 `rolsuper`、`rolbypassrls`、`rolinherit` 证据；role membership 保留 grantor 以及 PostgreSQL 16 的 `admin`、`inherit`、`set` options，ACL/default ACL 也保留 grantor 与 grant option。无法证明这些 membership options 的旧 catalog 必须在生成 snapshot 前失败，不能默填“安全”默认值。上述角色、membership 与 ACL 字段全部进入 inventory digest；缺字段或 tamper 会失败。

被引用 runtime role 具有 superuser/`BYPASSRLS`、存在直接或传递的父角色 membership，或 ACL/default ACL 带 grant option 时，整份 review 都会阻断。OpenPencil 不生成 `ALTER ROLE`、membership `GRANT`/`REVOKE`、grant-option 或 default-ACL 修复 SQL；这些外部权限必须由 operator 先处理，再重新 Inspect。

固定 catalog inspection 会为每个 `public` view 记录精确的 `security_invoker` 选项。它通过 `pg_options_to_table` 和 PostgreSQL boolean cast 解析 `pg_class.reloptions`，因此会规范化 PostgreSQL 接受的 true 写法，而不是匹配原始字符串。只要无法证明该值为 `true`，整份 migration review 就会阻断；OpenPencil 不会静默修改 view 或臆造补偿性 `REVOKE`。`public` Schema 中的 `SECURITY DEFINER` function 仍是必须由可信 operator 单独复核的 blocker。

安全 additive proposal 的顺序是：

1. `CREATE TYPE` / `CREATE TABLE` / 普通 index；
2. 对每个新 managed table 执行 `ENABLE ROW LEVEL SECURITY` 和 `FORCE ROW LEVEL SECURITY`；
3. 只从可精确翻译的 allow/deny intent 生成 policy；
4. GRANT 仅取“Workflow 实际操作”和“可生成 allow policy”的交集；UPDATE 同时需要 SELECT；
5. 最后提交短事务。

任一 blocker 存在时，review 文件只包含注释，不包含 `BEGIN`、DDL、policy 或 GRANT。不会生成 `service_role`、`GRANT ALL`、默认权限修改或通用 down migration。

## Release 与 CLI

Backend Release 必须独立经过：

```text
Inspect -> Plan -> Emit -> Review -> Confirm -> Apply -> Verify -> Receipt
```

Apply 前必须重新 Inspect。Document/IR/schema、target、environment、Provider package/adapter、project、account、grant generation 或 migration plan 任一变化都会使计划 stale。Dispatch 后 timeout/abort/transport error 记录为 `outcome-unknown`，禁止自动重试，必须先重新 Inspect 并 reconcile。

Desktop 的 Supabase 配置面板提供单独的 **Backend Provider Review** 按钮。它不会随文档打开、Schema 浏览、frontend build 或 frontend deploy 自动执行。每次操作都会从 active editor graph 重建 Backend request，从 live App store 重新解析 Provider authority，仅在操作期间解析 Management PAT 与 grant generation，并且当前只接受精确的 `public` Schema。项目 organization authority 校验通过后，Host 只向 Management API read-only query endpoint 发送一条由固定白名单机械组合的 aggregate SQL；十组 catalog 结果来自同一个 PostgreSQL statement snapshot，不声称存在 session 级 `repeatable-read` transaction。Caller SQL、custom Schema、redirect、authority 缺失、响应形状错误、row-limit tamper，以及 graph/config/Provider/grant 在网络期间变化都会 fail closed。

PAT 不进入 reactive state、SceneGraph、Artifact、Manifest、日志或 Receipt。生成的 artifact 始终保持 `applyAllowed: false` 与 `releaseReady: false`；Backend review callback 会在 confirmation、journal claim 和 dispatch 前主动拒绝继续。Browser 中该入口不可用，当前自动测试只用 fake transport 验证接线，并未证明真实 Supabase 项目连通。

Release bridge 在 initial 与 pre-Apply inspection 前还必须调用 Host 的 live local-authority revalidation callback，重新构建 graph/config/Provider/grant authority；captured build 不能授权之后的远程读取或未来 Apply。Durable journal 只在真正 dispatch 前 claim；当前 review-only 路径不会到达 claim。Executor 与 Verifier 未实现，因此目前没有产品路径会真实修改数据库或生成 live verification evidence。

CLI 接收的 gates JSON 是调用者提供的数据，因此报告 `gateEvidenceTrusted: false`。即使所有 gate 写成 passed，没有 Host authority 绑定且可接受的 Receipt，`auditPassed` 仍为 false。Compiler plan digest 也不会冒充 Host Release plan digest。

## Manual / Live Gate

真实 staging 至少需要：

- 独立 Supabase 项目和最小权限 Credential，值不得写入文档、Manifest、日志或 Receipt；
- 完整 read-only catalog inspection；
- 人工审查 migration、RLS、GRANT 与备份/恢复方案；
- 两个已确认 Auth 用户，验证 owner 成功、第二用户/跨 tenant 拒绝，以及所需 CRUD/upsert 负向路径；
- 应用使用 Function 或 Storage 时，再分别部署并验证对应 runtime、bucket 与 policy；
- 模拟 timeout/restart，验证 `outcome-unknown` reconcile；
- Packaged Tauri 中验证 Credential 重启与 Receipt 持久化。

本地 Unit Test、静态构建、mock、CLI 成功退出或前端 URL 都不能替代这些 gate，也不能表述为 Production Ready。
