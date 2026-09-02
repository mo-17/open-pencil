---
title: Backend Provider Architecture
description: Provider-neutral Backend IR, data-only plugin declarations, trusted compiler bundles, host-owned release orchestration, and production gates.
---

# Backend Provider Architecture

OpenPencil separates an application's backend intent from any vendor SDK or remote deployment API.
The compiler can validate, plan, and emit deterministic backend artifacts offline. A trusted App
host may later inspect a remote provider, resolve credentials, ask for confirmation, and apply an
already reviewed plan. The current CLI is intentionally local-only: it validates, plans, emits, and
audits, then blocks before remote Apply.

```text
SceneGraph / legacy lowcode
  -> provider-neutral BackendApplicationSpecV1
  -> data-only backendProviders contribution
  -> host-reviewed BackendProviderBundle
  -> deterministic plan and BackendArtifactManifest
  -> host-owned Inspect / Review / Confirm / Apply / Verify
  -> secret-free release receipt
```

These stages are intentionally different:

1. Generating frontend source does not generate or deploy a backend.
2. Generating backend artifacts creates local, reviewable files only.
3. Generating schema or row-policy proposals does not modify a database.
4. Applying a migration is a separate privileged host operation.
5. Deploying a server runtime is a separate privileged host operation.
6. Production readiness requires fresh evidence for every release gate.

## Current implementation status

| Layer                                          | Current status                                                                                                  | Explicit limit                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Backend Core and plugin contract               | Implemented and covered by package tests                                                                        | Data-only; no provider SDK, credential, URL, SQL executor, or runtime permission                                                    |
| Compiler registry and built-in Supabase bundle | Implemented                                                                                                     | Pure local plan/emit; ordinary build artifacts remain review-only                                                                   |
| Inspected Supabase migration review            | Implemented as a strict safety MVP with bounded repeat reviews                                                  | Existing managed state must be address-validated and carry exact OpenPencil markers; only the reviewed additive subset can continue |
| Host Release Controller                        | Implemented with a durable dispatch-journal boundary and injected Inspect/Emit/Review/Apply/Verify capabilities | The Desktop review path never reaches a journal claim; no live Supabase executor or verifier is wired into Desktop or CLI           |
| Desktop Supabase Backend review                | Implemented as an explicit, Tauri-only, review-only action                                                      | Exact `public` schema only; Browser, Apply, Verify, and production-readiness claims are unavailable                                 |
| Desktop frontend deployment                    | Implemented as a partial deployment                                                                             | Frontend confirmation does not confirm Backend Apply; Backend remains at the separate confirmation boundary                         |
| CLI Backend commands                           | Implemented as local-only validation, plan, emit, and audit                                                     | No Inspect, credential resolution, Apply, or accepted remote receipt                                                                |
| Live Supabase Apply and verification           | Not implemented in the product UI                                                                               | Manual/live gate; no current build may claim production readiness from local evidence                                               |

The strict inspected-review MVP requires project/account/query provenance, a non-truncated complete
coverage declaration, and explicit object, column, constraint, index, RLS policy, object ACL, and
default-ACL inventories scoped to the inspected database role. Every inspected table column carries
digest-bound negative evidence from `pg_attribute.attacl`, while the fixed provenance query proves
that tables, partitions, views, and materialized views have no column ACL; any column-level grant
blocks before a snapshot can authorize review. Enum columns must resolve by exact type OID and schema
to the
inspected `public` enum object, not merely share its name. The fixed query excludes that role's
inherent owner privileges and defaults owned by unrelated provider system roles; any non-owner
default grant that can affect OpenPencil-created objects remains explicit and blocking. The database
role is bound into provenance and the inventory digest. Role coverage is also complete and explicit:
`anon`, `authenticated`, and every policy or ACL grantee must have exact `rolsuper`,
`rolbypassrls`, and `rolinherit` evidence;
direct role memberships preserve grantor plus PostgreSQL 16 `admin`, `inherit`, and `set` options,
while ACL rows preserve grantor and grant-option state. Older catalogs that cannot prove those
membership options must fail before creating a snapshot rather than infer safe defaults. Every role,
membership, grantor, and grant-option field participates in the inventory digest, and missing or
tampered evidence is rejected. A first review may render deterministic additive `CREATE TYPE` and
`CREATE TABLE` SQL plus exact `COMMENT` markers, forced RLS, closed policies, and the intersection of
workflow operations with emittable allow policies. A later inspection binds those markers to the
same-snapshot PostgreSQL OID/attnum addresses and reconstructs the current `DataModelIR`; every
structural member of a managed table must be marked, and an unmarked or malformed managed claim fails
closed. Constraint-backed indexes are excluded from the ordinary-index inventory. From that exact
baseline, repeat reviews support only new enum values, nullable fields, and ordinary indexes. Marked
policies are explicitly replaced in the reviewed transaction, while an exact already-inspected set
of runtime grants is reused rather than broadened. An enum-value extension must be reviewed as a
dedicated migration: if the same plan contains any other operation, review fails closed instead of
placing an operation that could consume the new value in the transaction that creates it.

The standard non-grantable `USAGE` grants on Supabase's `public` schema for `PUBLIC`, `anon`,
`authenticated`, `service_role`, and the inspected database role are accepted as provider baseline;
schema `CREATE`, grant options, column grants, object grants not required by the reviewed plan, third-party grants,
and non-owner default privileges remain blocking. Name collisions, foreign keys, non-null field
additions, destructive operations, unknown ACL or permissive policy state, UUID function authority,
identity sequences, unsupported defaults, or RLS that is not both enabled and forced also produce
blockers. A blocked review contains comments only; every review keeps `applyAllowed: false` and
`releaseReady: false`.

A referenced runtime role with superuser or `BYPASSRLS` authority, any direct or transitive parent
membership, or any object/default ACL with grant option blocks the entire review. OpenPencil does
not emit `ALTER ROLE`, membership `GRANT`/`REVOKE`, grant-option repair, or default-ACL repair SQL;
those remain external operator-owned authority that must be reconciled before a fresh inspection.

## Owning boundaries

| Boundary           | Owner                           | May do                                                                                                | Must not do                                                                                        |
| ------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Backend Core       | `@open-pencil/lowcode/backend`  | Validate and canonicalize data, auth, workflow, capability, secret-reference, and migration intent    | Import a provider SDK or contain vendor-specific fields                                            |
| Plugin declaration | `@open-pencil/plugin-contracts` | Sign bounded provider identity, capabilities, configuration schema, outputs, and empty v1 permissions | Let a `backendProviders` contribution carry code, SQL, URLs, credentials, commands, or an executor |
| Compiler bundle    | `@open-pencil/compiler`         | Resolve a static reviewed adapter, negotiate capabilities, and deterministically plan/emit artifacts  | Read the SceneGraph again, use the network/filesystem, resolve credentials, or read `process.env`  |
| Trusted host       | App host and local CLI          | App: re-resolve authority and own remote Inspect/Apply; CLI: local validate/plan/emit/audit only      | Treat a manifest as executable authority or let CLI, Browser, or MCP perform Apply                 |

Framework targets and backend providers are orthogonal. React, Vue, Flutter, Expo, and mini-program
adapters consume frontend IR; they do not each contain a copy of provider migration or security
logic. Unsupported capabilities produce structured diagnostics. A production build fails for a
required unsupported capability; only an explicit source-only prototype may omit it with a warning.
The Compiler also derives requirements from actual normalized auth, workflow, HTTP, storage, and
managed-schema use. An omitted or optional declaration cannot hide that use from capability
negotiation or prevent the owning adapter slot from being checked.

The main `compile()` entrypoint participates in this boundary. When it finds legacy Supabase config,
actions, storage, or server workflows, it lowers them once to provider-neutral IR and runs the
reviewed built-in Provider plan/emission beside the existing frontend compatibility output. A
Provider plan or emission error throws `BackendProviderCompilationError`; production never keeps a
frontend-only result and downgrades the missing Backend half to a warning. A target such as Vue v1,
whose generated client omits Backend runtime behavior, must explicitly select
`backendCompilationMode: 'source-only-prototype'` to retain a static prototype with omission
diagnostics. Vue production remains fail closed.

A trusted Host can instead supply `CompilerOptions.backendProvider` as the exact data-only
`CompilerBackendProviderRequest` for one ordinary compile/build. The request contains only the
Host-resolved `BackendProviderSelection` and normalized application; the Compiler imports no App
state and still revalidates the selection against its static registry before deterministic
plan/emit. The App helper `prepareAppBackendProviderCompilerOptions()` resolves the document
declaration against the current installed/enabled/unblocked package, digest pin, publisher review,
and adapter authority immediately before compilation; `compileAppBackendProviderDocument()` keeps
that resolution and synchronous `compile()` in one Host call. If the explicit request is invalid or
its Host authority is unavailable, compilation stops instead of falling back to legacy Supabase. An
explicit request combined with legacy Supabase Backend intent, duplicate document declarations, or
a second pre-populated explicit request is ambiguous and fails closed. Legacy lowering remains
available only when no explicit request exists.

## Backend Core

`BackendApplicationSpecV1` is strict, bounded plain JSON. It contains versioned `DataModelIR`,
`AuthPolicyIR`, `BackendWorkflowIR`, capability requirements, and `BackendSecretRef` values. Unknown
versions, fields, scalar types, capabilities, auth intents, malformed references, managed foreign-key
cycles, accessors, custom prototypes, sparse arrays, and cyclic values fail closed.

`MigrationPlan` is semantic rather than raw SQL. Drops and data rewrites are destructive. Type
narrowing, `NOT NULL`, primary-key, foreign-key, and unique-constraint changes are high risk. A
provider may render those operations into a review artifact, but it cannot lower their risk or infer
a backup. External entities are compatibility references and never become implicit schema-creation
operations.

Secrets are references, never values. A Backend `CredentialRef` is a host-issued opaque handle with
the exact `credential.<UUID>` form, for example
`credential.123e4567-e89b-42d3-a456-426614174000`; a label, provider key, token, or other caller-made
string is not a valid substitute. Client-public environment names are rejected when they imply a
secret, admin, service-role, password, private key, or token. Credential values remain behind the
App's `CredentialResolver` and are resolved only for the concrete privileged host operation.

As defense in depth, Backend Core scans bounded IR keys and values for known secret-like forms and
conservative mixed-alphabet high-entropy tokens. The Compiler repeats this check for adapter plans,
Provider diagnostics, artifact paths, media types, and text content. Backend Provider contract v1
rejects binary artifacts rather than accepting an opaque byte channel. Recognized API-key, token,
JWT, private-key, authorization-header, credentialed-database-URL, and AWS-secret shapes fail without
echoing the matched key or value in diagnostics. This remains a heuristic, not a general secret
detector: novel, encrypted, fragmented, contextually indistinguishable, or otherwise unrecognized
secrets can evade pattern matching. Hosts and adapters must therefore preserve the reference-only
boundary even when the scanner reports no match.

## Data-only manifest and trusted registry

Manifest schema v2 adds an optional `contributions.backendProviders` array without changing legacy
v1/v2 canonical bytes. Each declaration binds `providerId`, `contributionId`, `adapterId`, contract
and model versions, a closed capability list, a closed configuration schema, output kinds, and the
contract's bounded permissions. Contract v1 grants no runtime permission.

A declaration never installs an implementation. The compiler and App use code-reviewed static
registries. Resolution requires exact identity, version, capabilities, outputs, publisher/package
authority, digest pin, enablement state, and review authority. A disabled contribution, changed
digest, unsupported version, or unregistered adapter fails closed. Provider state changes never
connect to a service, migrate data, or deploy in the background.

`packageDigest` is package authority supplied and bound by the trusted Host. The Compiler validates
its form and carries the exact value through selection, plan, artifact manifest, and release
evidence, but does not read, hash, or independently authenticate the provider package bytes. The
Host must verify those bytes against its signed or app-bundled trust source and pin the accepted
digest before asking the Compiler to resolve the selection.

Compiler `plan` and `emit` are pure functions over normalized Backend IR. Artifacts are bounded,
portable paths with exact media types and output kinds. Path traversal, absolute paths, case-folded
collisions, frontend-file collisions, oversized output, and undeclared artifact kinds are rejected.
The manifest binds the application, plan, provider authority, target, capabilities, required secret
names, each file digest, and the aggregate manifest digest.

## MCP and AI audit/plan projection

The bundled Supabase declaration exposes two exact-reviewed Manifest v2 commands to MCP and AI:
`audit-backend-provider` and `plan-backend-provider`. Both accept only the closed `target` and `mode`
parameters. They do not accept application data, a package or adapter identity, credential or secret
references, artifact paths, SQL, remote project state, or an Apply request.

Before each invocation, the App re-resolves the command and Backend Provider contribution from the
current installed-plugin snapshot. Plugin and contribution identity, package digest, publisher/key
authority, provider/adapter identity and version, capabilities, outputs, and enabled state must still
match the startup-frozen host registries. A cached MCP tool name cannot bypass disablement,
uninstallation, digest substitution, or a changed contribution descriptor.

These commands call the deterministic Backend `plan` boundary only; they never call `emit`. Their
closed, size-bounded, secret-scanned result contains metadata such as authority and plan digests,
capability decisions, diagnostic counts, output-kind names, and an explicit no-side-effect safety
state. It contains no application payload, required-secret names or values, adapter plan, artifact
content or path, migration SQL, deployment instruction, or release receipt. Neither command resolves
credentials, performs Apply, runs a migration, changes RLS or storage policy, deploys a function or
frontend, or invokes a provider network API.

## Built-in Supabase provider

Supabase is the first bundled provider, not part of the provider-neutral model. Existing documents
with Supabase config, client actions, storage uploads, and server workflows use a compatibility
lowering. Legacy table and bucket references stay external; OpenPencil does not infer production
tables from page queries. Only an explicit managed `DataModelIR` can produce a schema migration
proposal.

Schema, RLS, storage-policy, function, client-config, and deployment-instruction outputs are local
review artifacts. They are never applied by compilation or preview. Production emission rejects a
broad `allow` for either `anonymous` or `authenticated`, and rejects a conditional `deny` whose
restrictive-policy semantics cannot be translated exactly. Source-only prototype mode retains those
cases only as explicit warnings for review and emits no policy SQL for them.

Owner identity fields and membership identity fields must be `uuid`, so their generated policies
are compatible with `auth.uid()`. A tenant target field and its membership tenant field must have
the same scalar type and the same `enumId` when they are enums. Production review also blocks
permissive placeholder policies, authorization based on user-editable metadata, exposed objects
without reviewed row policies, unsafe view/function semantics, and incomplete update or storage
upsert policy coverage. Client artifacts may use only publishable/anon configuration; service-role,
admin, root, management, and database credentials never enter the document, manifest, log, or
generated client code.

The fixed catalog inspection records the exact `security_invoker` option for every `public` view.
It parses `pg_class.reloptions` through `pg_options_to_table` and PostgreSQL's boolean cast, so
accepted true spellings are normalized instead of matched as raw strings. A view without positive
inspected `security_invoker` evidence blocks the complete migration review; OpenPencil does not
silently alter the view or invent a compensating revoke. Public-schema `SECURITY DEFINER` functions
remain a separate blocker requiring trusted operator review.

`CompilerOutput.artifactOwnership` keeps Provider review material separate from executable server
workflow source. Build copies both only under `openpencil-server/` and excludes that directory from
the static upload boundary. `BuildResult.backendReviewFiles` requires human/host review and Apply;
only `BuildResult.executableServerWorkflowFiles` may produce a function-deployment instruction. A
schema or RLS proposal alone never results in a `supabase functions deploy` recommendation.

## Desktop deployment integration

The Desktop deployment controls read an explicit Backend Provider request from document plugin data,
parse the complete `BackendApplicationSpecV1`, and re-resolve the installed provider against the live
App store before review, after confirmation, after runtime preflight, after credential resolution,
and immediately before frontend dispatch. The confirmation snapshot binds provider/package identity
plus application, plan, and artifact-manifest digests. A missing host lifecycle, disabled or blocked
provider, substituted digest, unreviewed adapter, invalid request, or changed review fails before the
frontend network dispatch.

Frontend deployment still performs only trusted local Backend validation, planning, and emission.
The current Desktop deployment session can upload the static frontend, then records
`backendDeploymentRequired: true` and a `frontend-deployed` status while Backend verification is
outstanding. It does not apply migrations, deploy functions, inspect a live database, or convert a
frontend URL into Backend release proof. The frontend-hosting confirmation is not reused as Backend
confirmation.

The Supabase configuration panel now exposes a separate, explicit **Backend Provider Review** action
in the packaged Tauri app. It is never triggered by document loading, schema browsing, frontend
build, or frontend deployment. The action rebuilds the request from the active editor graph,
re-resolves the installed Provider from the live App store, normalizes the target to the exact
`public` schema, and resolves the Management PAT plus credential grant generation only for the
operation. It validates project organization authority, then sends exactly one fixed aggregate SQL
statement to the Management API read-only query endpoint. The ten fixed catalog result sets
therefore share one PostgreSQL statement snapshot; the transport does not claim a session-level
`repeatable-read` transaction. Caller SQL, custom schemas, redirects, incomplete authority,
malformed aggregate responses, row-limit tampering, or changed graph/config/Provider/grant
authority fail closed. The PAT is not stored in reactive state, SceneGraph data, artifacts,
manifests, logs, or receipts.

The resulting artifact is explicitly review-only: `applyAllowed: false`, `releaseReady: false`, and
the UI reports that live Apply/Verify is unavailable. Its Backend review callback deliberately
denies continuation before confirmation, journal claim, or dispatch. Browser builds keep this
action unavailable. Automated tests exercise the fixed transport and runtime composition with
fakes; this does not prove connectivity to a real Supabase project.

## Release controller

The host state machine is:

```text
Inspect -> Plan -> Emit -> Review -> Confirm -> Apply -> Verify -> Receipt
```

The dependency-injected App controller implements this state machine locally, including final
reinspection, migration-plan drift detection, an atomic durable dispatch claim, restart
reconciliation, pre-dispatch failure receipts, outcome-unknown handling, failed verification gates,
and secret-free receipts. The durable IndexedDB journal preserves pending/applied/failed/unknown
claims across Desktop restarts and never treats an uncertain outcome as permission to retry. The
fixed Supabase `pg_catalog` inspector and its single-statement Management transport are wired only to
the explicit Desktop review action. The current executor and verifier remain deliberately
unavailable, so no product path can dispatch a migration or issue live verification evidence.

Build and compile stop after local validation, planning, and emission. Apply is a separate authority.
Immediately before Apply the host inspects again and compares the document/IR/schema digests, target,
environment, provider/package/adapter authority, project, account, and grant generation. Any change
makes the plan stale. Destructive operations need a separate confirmation for each operation, a
backup description, and provider-specific recovery instructions; there is no promised generic down
migration.

Cancellation before dispatch is safe. A timeout, abort, or transport error after dispatch is recorded
as `outcome-unknown`, disables automatic retry, and requires a fresh inspect/reconcile. Apply is
single-flight through the durable claim key, and its scope cannot be reused across projects,
accounts, or grant generations. The Supabase bridge additionally requires a fresh host callback to
rebuild graph/config/Provider/grant authority immediately before both initial and pre-Apply
inspection; captured build state cannot authorize a later remote read or future Apply.

Production `releaseReady` is fail closed. Missing, unknown, future-dated, duplicate, or failed
evidence for migration application, schema drift, auth/RLS, server workflows, required secret names,
storage policy, health, artifact/document match, provider authority, or target capabilities blocks
release.
A successful static-host upload returns `backendDeploymentRequired` while required backend work is
not verified. Core binds every passed gate's `checkedAt` to be no later than the enclosing
`verifiedAt`; any additional evidence TTL or provider-specific freshness window remains an explicit
trusted-Host policy and is not self-proven by the receipt format.

An `evidenceDigest` is a canonical digest-shaped binding supplied by the trusted Host. Its presence
does not by itself prove the evidence issuer, signature, semantic relationship to the plan, or a
provider-specific freshness policy. Those provenance checks must happen before the Host records a
passed gate; the public receipt validator proves bounded structure and internal consistency only.

The final receipt is data-only and secret-free. It binds document and IR digests, compiler and target,
provider/package/adapter authority, static/server/schema artifacts, migration operation checksums,
required environment and credential-reference names, remote operation IDs, verification time, gate
states, and any failure or unknown outcome.

## Local CLI workflow

The Backend CLI accepts an explicit local `BackendApplicationSpecV1` JSON file. It does not inspect a
remote project, resolve a credential, connect to a database, or expose an Apply command:

```sh
bun open-pencil backend validate backend-application.json --json
bun open-pencil backend plan backend-application.json --backend-provider supabase --target react --mode production --json
bun open-pencil backend emit backend-application.json -o local-backend-artifacts --json
bun open-pencil backend audit backend-application.json --gates production-gates.json --receipt release-receipt.json --environment production --json
```

`emit` requires a new output directory and never overwrites an existing path. `audit` parses strict
gate evidence and an optional secret-free receipt, but it cannot accept that receipt as proof of an
Apply because the CLI has no reducer-owned remote execution state. `backend release` composes the
same local validate/plan/emit/audit path and deliberately exits blocked before Apply; it never issues
a receipt or turns a static frontend upload into a complete application release. Caller-supplied
gate JSON is reported with `gateEvidenceTrusted: false`; even a complete passed set cannot make
`auditPassed` true without an accepted authority-bound receipt. A Compiler plan digest is not
compared with a Host Release plan digest because those values belong to different authority domains.

## Manual and live gates

Unit tests and deterministic fixtures prove parsing, negotiation, emission, and state-machine
behavior. They do not prove a real database or production deployment. Apply authority and remote
proof belong to the Host, and live database verification remains a Manual gate. A release still
needs an authorized operator to review the generated proposal, inspect a real project, test
anonymous and authenticated owner/cross-tenant behavior, exercise
insert/update/delete/upsert/storage denial paths, deploy and verify server workflows, validate
restart/reconcile behavior, and capture fresh evidence. Do not describe a build, source assertion,
mock, CLI exit code, deterministic receipt fixture, or static URL as production readiness.

For the first staging exercise, use an independent project and record the project/account/grant
generation without exposing credential values. A minimal database/RLS gate needs two confirmed Auth
users, a complete read-only catalog snapshot, an operator-reviewed additive migration plus backup
plan, and Data API tests showing owner success and second-user denial for every required operation.
Function, Storage, SMTP, and frontend-origin setup are separate gates and are required only when the
application actually declares those capabilities. After any dispatch timeout or restart, do not
retry automatically: re-inspect first, compare the reviewed plan, and reconcile the remote outcome.
