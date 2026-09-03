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

| Layer                                          | Current status                                                                                                      | Explicit limit                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend Core and plugin contract               | Implemented for DataModel, Auth, Workflow, first-class Storage, staged migrations, source ledger, and release gates | Data-only; no provider SDK, credential, URL, SQL executor, or runtime permission                                                           |
| Visual Backend editor                          | Implemented in the Design panel for model, relations, ownership/tenant/RLS, workflows, Storage, Provider, and risk  | Saving changes the document declaration only; it never inspects, applies, or deploys                                                       |
| Compiler registry and built-in Supabase bundle | Implemented                                                                                                         | Pure local plan/emit; ordinary build artifacts remain review-only                                                                          |
| Inspected Supabase migration review            | Implemented for additive and explicit expand/backfill/contract reviews                                              | Existing managed state must be address-validated; destructive and production operations remain separately approved                         |
| Source migration ledger                        | Implemented with canonical SQL/ledger artifacts, dev→staging→production ordering, drift, rollback, and restore      | Desktop exports a reviewed ZIP; merging it into source control and executing it remain operator/CI actions                                 |
| Edge Function release authority                | Implemented as a bounded Host deploy/secret/health/Receipt boundary                                                 | Not auto-run by build; real deployment still requires operation-scoped credentials and explicit release orchestration                      |
| Storage release verification                   | Implemented for bucket catalog checks and two-account CRUD/upsert isolation Receipts                                | Not auto-run by build; real object probes are destructive test operations and require explicit staging authority                           |
| React and Vue web runtimes                     | Implemented for Supabase Auth, CRUD, Storage upload, and authenticated server workflow invoke                       | Server and Storage remain provider release gates; generated frontend success is not backend readiness                                      |
| Host Release Controller                        | Implemented with durable dispatch claims and injected Inspect/Emit/Review/Apply/Verify capabilities                 | The legacy live database Apply path remains a bounded staging create-only MVP; Browser, CLI, and production database Apply are unavailable |
| Desktop Supabase Backend review                | Implemented as an explicit, Tauri-only, review-only action                                                          | Exact `public` schema only; the review artifact itself never grants Apply or production readiness                                          |
| CLI Backend commands                           | Implemented as local-only validation, plan, emit, and audit                                                         | No Inspect, credential resolution, Apply, or accepted remote receipt                                                                       |

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
`CREATE TABLE` SQL plus exact `COMMENT` markers, forced RLS, closed policies, and least-privilege
grants for the union of workflow-required operations and explicitly declared allow row-access
operations, narrowed to emittable allow-policy coverage. A later inspection binds those markers to the
same-snapshot PostgreSQL OID/attnum addresses and reconstructs the current `DataModelIR`; every
structural member of a managed table must be marked, and an unmarked or malformed managed claim fails
closed. Constraint-backed indexes are excluded from the ordinary-index inventory. The ordinary
repeat-review path remains limited to new enum values, nullable fields, and ordinary indexes. A
separately validated staged execution plan can review indexed foreign keys, unique constraints,
UUID/identity generated defaults, typed non-null backfills, constraint validation, compatible
renames, and explicit retirement through ordered `expand`, `backfill`, and `contract` phases. Every
staged operation is bound back to the semantic `MigrationPlan`; backfill/contract require a
successful predecessor Receipt, while direct destructive or production review remains blocked until
the independent approval/recovery authority is supplied. This does not widen the existing live
Desktop Apply allowlist. In the Desktop review panel, the optional staged-plan file input validates
and normalizes a bounded, secret-free `StagedMigrationExecutionPlanV1` before any credential or
network use, displays its phase/operation count/risk, and binds it into the inspected artifact and
source ZIP. Ordinary reviews leave this input empty. Marked policies are explicitly replaced in the
reviewed transaction, while an exact already-inspected set of runtime grants is reused rather than
broadened. An enum-value extension must still be reviewed as a dedicated migration.

OpenPencil always emits explicit least-privilege table grants after forced RLS and policy creation; it
does not depend on Supabase's legacy default table privileges. This is required by Supabase's 2026
[Data API exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

The standard non-grantable `USAGE` grants on Supabase's `public` schema for `PUBLIC`, `anon`,
`authenticated`, `service_role`, and the inspected database role are accepted as provider baseline;
schema `CREATE`, grant options, column grants, object grants not required by the reviewed plan,
third-party grants, and non-owner default privileges remain blocking. Name collisions, an unscoped
foreign key/non-null/rename/destructive change, unknown ACL or permissive policy state, arbitrary
default expressions, or RLS that is not both enabled and forced also produce blockers. UUID and
identity defaults are accepted only through the explicit staged generated-default vocabulary. A
blocked review contains comments only; every review keeps `applyAllowed: false` and
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
frontend-only result and downgrades the missing Backend half to a warning. React and Vue web targets
both emit the supported Supabase Auth, CRUD, Storage upload, and authenticated Edge workflow client
surface. They share request single-flight, pending UI, throttling/debouncing, session propagation,
and missing-configuration fail-closed behavior. Other targets must explicitly use a supported
source-only prototype mode when their runtime omits a required Backend capability.

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
`AuthPolicyIR`, `BackendWorkflowIR`, `BackendStorageIR`, capability requirements, and
`BackendSecretRef` values. Storage declares bounded bucket names, private/public-read intent,
per-object size and MIME limits, literal path prefixes, owner/tenant principals, and exact
read/create/update/delete/upsert operations. Unknown
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

The resulting artifact remains explicitly review-only: `applyAllowed: false` and
`releaseReady: false`. It cannot authorize a mutation by itself. Packaged Tauri exposes a separate
staging-only action that can consume that exact artifact only after the user saves a distinct
database-write Management PAT, binds the exact project ref as an independent staging target, and
confirms that target again. Browser and CLI builds keep Apply unavailable. Automated tests exercise
the transports and runtime composition with fakes; this does not prove connectivity to a real
Supabase project.

The staging executor accepts only an empty inspected OpenPencil-managed baseline, the compiler's
reviewed `create-enum` / `create-entity` operation set, and its exact SQL digest. "Empty" means no
managed entities, enums, relations, or managed catalog objects; unrelated external objects may
remain in `public` unless they collide with a planned name. Repeat `add-*` migrations remain
reviewable but cannot use live Apply in this MVP. It rejects caller SQL, destructive
operations, a changed review, a changed
Provider/package, and any project, organization, grant, graph, or configuration drift. The Host
checks project authority before preparing the request, performs another catalog inspection, and
revalidates both local and remote project/organization authority again immediately before the exact
Management API query request. The write PAT is operation-scoped and must differ from the read
credential. The Host does not introspect PAT scopes; Supabase remains the authority that accepts or
rejects the required database-write permission. Neither value may enter
reactive state, the document, an artifact, a log, the journal, or a receipt.

Immediately before dispatch, the durable journal atomically claims a semantic release key and a
separate provider/project mutation scope. Target, environment, document, organization transfer, or
credential rotation therefore cannot create a second mutation slot while any claim for that remote
project is pending or `outcome-unknown`. Legacy unresolved journal records block conservatively by
project. The query endpoint returns no durable remote operation identifier, so an uncertain claim
cannot be treated as failed merely because a new review exists, the catalog still equals its
pre-dispatch baseline, or local time elapsed. Read-only reconciliation therefore keeps Supabase
pending/unknown claims locked unless provider-authoritative evidence can bind the exact operation to
a terminal result; that evidence path is not yet available for the Management query endpoint. A new
independent staging project has a separate mutation scope and is the safe continuation when such
evidence is unavailable. Reconciliation never retries in the same run; the operator must generate
and confirm a new review after the old claim reaches a terminal result. After a known Apply response, the
Host inspects the catalog again and binds the complete timestamped capture digest into verification
evidence. Catalog gates may pass, but JWT-backed Auth and table row-policy behavior remain a separate
`unknown` gate until the required anonymous/owner/cross-user checks have trusted evidence. Storage
isolation has its own two-account verifier and does not prove table RLS.
The Desktop staging result, rather than `BackendReleaseReceiptV1`, always reports
`productionReleaseReady: false`.

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
fixed Supabase `pg_catalog` inspector and its single-statement Management transport are used by both
the explicit Desktop review action and the bounded staging release action. A provider-specific
database executor and post-Apply catalog verifier exist only for that staging subset. Edge Function
and Storage use separate operation-scoped Host authorities: neither reuses the migration executor or
inherits authority from a frontend build. Browser and CLI expose no remote executor, and production
database Apply remains unavailable.

### Source migrations and environment promotion

Every ready inspected review can be exported from the Desktop review panel as an exact ZIP containing
`supabase/migrations/<UTC timestamp>_<slug>.sql`,
`supabase/openpencil-inspected-source-ledger.json`,
`supabase/openpencil-migration-ledger.json`, and a digest-bound Host export manifest. The
inspected-source ledger retains review and Provider-emission evidence for ordinary additive and
explicit staged reviews. The promotion ledger binds every source SQL file to exact execution
authority: explicit staged reviews retain their reviewed phase plan, while an ordinary safe review
is compiler-normalized to one low-risk `apply-reviewed-migration` expand operation that binds all
source operation ids, the review manifest, the migration plan, and the final composed SQL digest.
That final digest includes an inspected Storage delta when one exists; an empty source-operation set
is therefore allowed only inside this digest-bound authority (for example, a Storage-only change).
Omit both ledger inputs only for the first export; every later export must import both ledgers from
the previous ZIP or it intentionally starts a separate history. When a
Storage policy artifact exists, the Host unwraps the two exact trusted renderings and emits the
schema and Storage changes inside one outer `BEGIN`/`COMMIT`, so the source migration cannot commit
only one half. Before and after saving, the Host re-resolves the live document,
configuration, reviewed build, and installed Provider authority. It never accepts a credential,
writes into the repository, or executes SQL. If saving has started and completion cannot be proved,
the result is `outcome-unknown`; inspect the chosen destination before retrying.

The offline CLI makes the promotion ledger an operator/CI product surface rather than a library-only
contract. `openpencil backend ledger inspect <ledger> --source-root <repo> --json` verifies its
complete digest-bound history and re-hashes every referenced regular, non-symlink migration file
below the explicit repository root. `openpencil backend ledger transition <ledger> --event
<event.json> --source-root <repo> --output <next.json> --json` appends exactly one validated
registration, promotion, drift, rollback, restore, or authority-rebind event to a new file only after
every resulting source-file digest is verified; it never overwrites its input or output and has no
network, Apply, or Deploy authority.
`openpencil backend ledger init --ledger-id <id> --created-at <UTC> --output <ledger.json>` is
available for an explicitly separate history. Provider/CI automation must create the secret-free
Receipt in `event.json`; the CLI validates it but never fabricates remote evidence.

Extract the reviewed files, merge them into the repository, and let the normal source-control/CI
workflow own execution. Use `supabase migration list`, exercise the chain locally with
`supabase db reset`, and promote it with a controlled `supabase db push`; running copied SQL directly
in the remote SQL Editor does not update this OpenPencil source ledger. The promotion ledger admits
only `source -> dev -> staging -> production`, requires no-drift evidence at the destination,
requires successful execution Receipts, requires each promoted migration to prove the same logical
post-schema digest as its source environment, enforces predecessor phases, and requires exact human
approval scopes for production or destructive work. Drift and recovery use canonical, secret-free
provider Receipts bound to the exact authority, schema transition, timestamp, outcome, and evidence;
only successful Receipts enter the structured ledger, while failed or outcome-unknown results remain
in the Host journal. A healthy environment can only roll back its latest migration. Restore is
reserved for detected drift and must bind a canonical provider backup/recovery point to the resulting
source prefix and schema. This follows Supabase's
[source-controlled migration workflow](https://supabase.com/docs/guides/deployment/database-migrations)
without treating local generation as a remote deployment.

PAT rotation never silently edits an environment authority. An explicit
`rebind-environment-authority` event may change **only** `grantGeneration`; Provider identity and
authority digest, project, account, and environment must remain byte-for-byte equal. The event must
reference the latest environment event, which must be a successful no-drift observation against the
current schema, and embed separately digested successful Provider Receipts from both the previous and
next authority. Each Receipt explicitly proves `unresolvedMutation: false`; reused, stale, failed,
unknown, or mismatched proof fails closed. Production additionally requires exact `production` human
approval. The rebind is appended to immutable history and replayed to derive the new environment
summary; subsequent drift, promotion, and recovery evidence must use the new generation. The offline
CLI only validates these supplied proofs. If the Provider/CI cannot authoritatively prove that no
remote mutation is unresolved, rotation remains blocked rather than being inferred from local state.

### Edge Function and Storage release evidence

The Supabase Edge runtime is emitted as reviewed Deno source with JWT authentication, bounded
workflow inputs/responses, a fixed health workflow, manual redirects, private-address rejection, and
an exact outbound-host allowlist. A separate Host transport rechecks project/organization authority,
proves required secret **names** (never values), creates a bounded deterministic ZIP, calls the
documented Management deployment endpoint with `verify_jwt=true`, invokes the deployed health route
with an authenticated user token, and returns a secret-free Receipt. Supabase currently injects both
`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEYS`; only application-defined names, such as an outbound
host allowlist secret, are required in the Management secrets inventory. See Supabase's
[Edge Function deployment](https://supabase.com/docs/guides/functions/deploy) and
[secret management](https://supabase.com/docs/guides/functions/secrets).

First-class Storage emission creates a review-only bucket configuration and `storage.objects` RLS
matrix. Owner predicates use `(select auth.uid())`; tenant paths query only the declared membership
table; upsert always expands to SELECT + INSERT + UPDATE. Generated React and Vue upload handlers
store only the object path for private buckets; only an explicitly `public-read` bucket emits
`getPublicUrl`, so private delivery must go through a separately authorized signed-URL workflow.
The live verifier rechecks project authority,
uses a read-only catalog query for exact bucket limits, binds two distinct `/auth/v1/user` sessions,
and probes owner CRUD/upsert plus anonymous, second-user, prefix escape, MIME, and size denial. For a
bucket limited to at most 16 MiB the size check uses an exact `max + 1` rejection probe; a larger
limit is proven from the read-only bucket catalog instead of granting a potentially large upload. A
transient or ambiguous response after the first object request produces `outcome-unknown`, not an
automatic retry. Only exact, successful, no-residual Receipts can satisfy the Storage production
gate. See Supabase's [Storage RLS model](https://supabase.com/docs/guides/storage/security/access-control).

Build and compile stop after local validation, planning, and emission. Apply is a separate authority.
Immediately before Apply the host inspects again and compares the document/IR/schema digests, target,
environment, provider/package/adapter authority, project, account, and grant generation. Any change
makes the plan stale. Destructive operations need a separate confirmation for each operation, a
backup description, and provider-specific recovery instructions; there is no promised generic down
migration.

Cancellation before dispatch is safe. A timeout, abort, or transport error after dispatch is recorded
as `outcome-unknown`, disables automatic retry, and requires a fresh inspect/reconcile. Apply is
single-flight through the durable claim key. Supabase additionally locks the provider and remote
project independently of target, environment, document, account, or grant generation until an
uncertain write is reconciled. The Supabase bridge additionally requires a fresh host callback to
rebuild graph/config/Provider/grant authority immediately before both initial and pre-Apply
inspection; captured build state cannot authorize a later remote read or future Apply.

Production `releaseReady` is fail closed. Missing, unknown, future-dated, duplicate, or failed
evidence for migration application, schema drift, auth/RLS, server workflows, required secret names,
storage policy, health, artifact/document match, provider authority, or target capabilities blocks
release.
A separate **Staging backend capabilities** action now creates those Edge and Storage Receipts through
the real Desktop Host composition after proving that the inspected schema already equals the exact
review target. User JWTs are operation-scoped, cleared from the form before dispatch, and never
persisted. The verifier rejects stale project/account/grant/provider bindings,
incomplete secrets, unauthenticated health, public or only partially probeable Storage rules, future
evidence, duplicate coverage, and a Receipt bound to another artifact. A supplied Receipt cannot
choose its own expected digest. Required host credential references remain unknown until a separate
trusted credential-evidence authority is attached. Table Auth/RLS evidence also remains independent,
so a successful Edge/Storage run can still return a blocked overall staging Receipt and never enables
production readiness.
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

Unlike App-owned React/Vue source export, the CLI has no installed-package lifecycle, publisher
review, or live App Store authority with which to resolve a document's `backendProviders`
declaration. It therefore does not consume a raw declaration as trusted adapter authority; use the
Desktop Host export or an explicit local Backend spec instead.

`emit` requires a new output directory and never overwrites an existing path. `audit` parses strict
gate evidence and an optional secret-free receipt, but it cannot accept that receipt as proof of an
Apply because the CLI has no reducer-owned remote execution state. `backend release` composes the
same local validate/plan/emit/audit path and deliberately exits blocked before Apply; it never issues
a receipt or turns a static frontend upload into a complete application release. Caller-supplied
gate JSON is reported with `gateEvidenceTrusted: false`; even a complete passed set cannot make
`auditPassed` true without an accepted authority-bound receipt. A Compiler plan digest is not
compared with a Host Release plan digest because those values belong to different authority domains.

## P2 contract foundation

P2 starts with a new semantic version instead of silently adding authority to a v1 document.
`BackendApplicationSpecV2` keeps the provider-neutral data, Auth, workflow, Storage, capability, and
secret-reference sections, and adds independently versioned Realtime, atomic transaction, data
migration/backfill, and automation IR. A strict compatibility lowering maps a validated v1
application to v2 with empty P2 sections; existing v1 parsing and canonical bytes do not change.
The P2 parser accepts bounded plain data only, rejects unknown fields and undeclared references, and
derives required capabilities from actual use so an optional or omitted declaration cannot hide a
runtime requirement.

Backend Provider contract v2 is a separate opt-in data-only contract. It can describe the expanded
P2 capability vocabulary and model v2 support, but still grants no network, credential, filesystem,
process, Apply, or Deploy permission. It is deliberately not accepted by the existing signed
Manifest schema v2 path yet: enabling it there requires an explicit manifest/Host authority revision
and a reviewed registry adapter. The bundled Supabase contribution therefore remains on contract and
model v1 until its P2 artifact, release, and live-verification paths exist.

Production evidence is no longer modeled as one fixed list for every application. The v2 foundation
derives three invariant integrity requirements plus exact evidence and verifier checks for every
capability used by the normalized IR, including the distinct `events.data-change` capability and
dedicated HMAC-credential-purpose checks for inbound and outbound webhooks. Unknown capabilities,
missing, expired, future, or out-of-scope evidence fail closed. A receipt digest provides integrity
only; release readiness exists only relative to the Host-authenticated subject and accepted receipt
store, and never replaces the authority-bound Backend Release receipt.

`BackendOperationalEventV1` is a payload-free append-only envelope that binds provider, environment,
authority, release/plan/single-flight/remote-operation identifiers, phase, outcome, duration, stable
error code, evidence, trace, and the previous event digest. Verification requires a Host-authenticated
head, clock, domain, and prior closed-segment boundary. Append parses those values into immutable
snapshots before asynchronous hashing and returns the expected CAS head; persistence must reserve
event and attempt IDs globally and atomically compare-and-swap that same head. The bounded chain then
detects modification, deletion, reordering, duplication, future timestamps, concurrent single-flight
attempts, and untrusted tail insertion. Events never contain request/response bodies or credentials.

The first Provider v2 slice now emits a private Supabase Realtime Broadcast review bundle. Separate
Auth, migration, security-policy, and Realtime adapters own their exact capabilities; the common
adapters reuse the validated v1 target-schema, inspection-required migration, and owner-RLS review
artifacts under v2-specific paths. The Realtime adapter emits an owner-topic SELECT policy, bounded
trigger functions with minimal invalidation payloads, and a React/Vue helper that uses the Host-owned
authenticated Supabase client without accepting or retaining a token. The bundle remains an isolated
candidate: it is not in the built-in registry or compile/App/CLI path, grants no Apply or Deploy
authority, and still requires source-ledger, dashboard, existing-policy inventory, trusted-release,
A/B isolation, refresh, reconnect, trigger, and disposal checks in a real staging project.

The second isolated Provider v2 slice was introduced with adapter `2.1.0` and emits one bounded
atomic-transaction review package. It accepts exactly one transaction over one source-managed
entity with distinct non-null UUID primary-key and owner fields, a non-null `int8` version field with
literal zero default, and an expected-version update. The generated public PostgREST function is
`SECURITY INVOKER`, pins serializable isolation, checks `auth.uid()`, locks the owner row, performs a
compare-and-swap update, verifies the version postcondition before commit, and grants function
execution only to `authenticated`. Apply-time catalog checks bind the managed table, fields, primary
key, forced RLS, expected owner-policy names/commands/roles/markers, table ACLs, function
signature/configuration, and final function ACL. The React/Vue-neutral client makes one `.rpc()`
request, accepts the known
PostgREST transport envelope without invoking accessors, returns fixed typed errors, and never
retries or accepts credentials.

This atomic slice is deliberately **non-exclusive** and not release-ready. P1 owner RLS and direct
authenticated table SELECT/UPDATE grants remain available through REST, so the guarantee applies
only inside this one reviewed RPC call; it does not force every write through compare-and-swap. The
package is not bound to a P1 source-ledger receipt, exact P1 artifact digests, or owner-policy
expression evidence, is not registered in the built-in/compile/App/CLI/Apply path, and still lacks
live staging evidence for PostgREST schema cache, A/B isolation, concurrency, conflict, and rollback
behavior.

The third isolated slice updates the candidate adapter to `2.2.0` and adds a strict
data-migration/backfill review package. It accepts exactly one source-managed entity and one
`set-literal` migration whose cursor is a non-null, single-column `int8` identity primary key. The
target must be the same nullable-live/non-null-desired field used by the null predicate and the
field-not-null postcondition. Its literal is revalidated against the field type and enum domain and
must contain neither NUL nor an unpaired UTF-16 surrogate. Primary-key, unique, foreign-key, owner,
tenant, and membership fields are rejected. This first slice also refuses source models with any
secondary index, unique constraint, or foreign key so its live review can require their complete
absence. The adapter emits only a deterministic migration plan, review manifest, and SELECT-only
query template. It emits no client configuration, DML/DDL runner, credential, Apply hook, or release
claim; the raw planner and SQL emitter are not public Compiler exports.

The query template reports a **partial checklist, never live evidence**: managed markers, exact
primary-key column shape, forced RLS, identity `ALWAYS`, sequence
ownership/increment/cache/cycle/range/state visibility, primary-server status, target OID/type-kind/
typmod/generated shape, enum marker plus ordered labels, raw default expression, complete-table
write-hazard counts, current/session roles, `row_security`, `search_path`, object OIDs, a high-water
summary, and one keyset-paginated batch preview. The whole-table hazard gate conservatively blocks
every non-primary index, unique/exclusion or CHECK constraint, outbound foreign key, generated
column, and inheritance edge; this avoids treating expression, partial, or INCLUDE index metadata as
safe without a trusted Inspector. The primary-key check intentionally uses the stable marker plus
ordered column numbers rather than a name derived from the current table and field names, so a
reviewed P1 rename does not create a false blocker. A 10,000-entry receipt-chain ceiling reserves
index 0 for high water and therefore permits at most 9,999 batch checkpoints and
`batchSize * 9,999` matched rows. The estimate counts the complete cursor range, not only rows still
matching the null predicate, because every scanned range must advance the receipt head.

This backfill slice is also review-only and not release-ready. Its manifest separates
`catalogChecks.required` from `observed: null`. SELECT can invoke policy functions and RLS can hide
rows, so the template is not independently side-effect-free or complete: a future trusted Host must
use one fixed current/session role and search path, enforce a database read-only transaction plus
`row_security=off` fail-closed behavior, and verify complete ACL, role-membership, policy, trigger,
rule, function, enum/default, and table-hazard inventories. Before capture it must install a new-NULL
write barrier and take the reviewed lock; every batch and the final postcondition must rebind the live
table/column/sequence OIDs and catalog digest. Live catalog evidence, `GENERATED ALWAYS` conversion,
cursor immutability, sequence/cursor mutation-authority proof, source-ledger/artifact/provider
binding, an atomic database batch ledger, receipt-v2 authority, the actual bounded mutation runner,
P1 unbounded-backfill retirement, dry run, and exact postconditions all remain explicit blockers.

P2 still does **not** implement exclusive atomic write authority, an executable receipt-driven
backfill, a queue worker, Cron job, webhook endpoint, or monitoring drain. The remaining Provider
work follows in bounded slices: trusted backfill Inspector plus receipt-v2/database-ledger runner;
private queue and transactional outbox with idempotency/retry/DLQ; signed webhook intake; then drift
and observability receipts. A later release-authority slice must remove or otherwise constrain direct
REST updates before claiming exclusive atomic writes. These choices follow the current Supabase,
PostgREST, and PostgreSQL
[Realtime authorization](https://supabase.com/docs/guides/realtime/authorization),
[database functions](https://supabase.com/docs/guides/database/functions),
[functions as RPC](https://docs.postgrest.org/en/stable/references/api/functions.html),
[transactions](https://docs.postgrest.org/en/stable/references/transactions.html),
[identity columns](https://www.postgresql.org/docs/current/ddl-identity-columns.html),
[sequences](https://www.postgresql.org/docs/current/sql-createsequence.html),
[index catalog](https://www.postgresql.org/docs/current/catalog-pg-index.html),
[constraint catalog](https://www.postgresql.org/docs/current/catalog-pg-constraint.html),
[Queues](https://supabase.com/docs/guides/queues), [Cron](https://supabase.com/docs/guides/cron),
and [Database Webhooks](https://supabase.com/docs/guides/database/webhooks) boundaries.

The first resumable backfill subset intentionally uses only a non-null, single-field integer identity
primary key that the Provider proves is immutable and append-monotonic. Source IR names that cursor
but does not contain an environment-specific high-water value. Each environment captures its own
high water in a Host/CAS-bound receipt chain whose scope also binds provider, authority, application,
migration, and batch size; progress cannot move backwards, exceed the captured high water, or extend
a terminal receipt. The current Provider review package does not yet construct or persist that
authority chain. Similarly, primary-key idempotency for data-change automations is restricted to
insert events; update and delete require a future Provider-issued immutable event identifier.

## Manual and live gates

Unit tests and deterministic fixtures prove parsing, negotiation, emission, transport envelopes,
and state-machine behavior. They do not prove a real database or production deployment. The first
real staging Apply, packaged-Tauri persistence, and runtime table auth/RLS verification remain Manual
gates. The Desktop capability action can perform an explicitly authorized Edge deploy and destructive
Storage test-object probes, but local mocks do not prove the user's project. A release still
needs an authorized operator to review the generated proposal, inspect a real project, test
anonymous and authenticated owner/cross-tenant behavior, exercise
insert/update/delete/upsert/storage denial paths, deploy and verify server workflows, validate
restart/reconcile behavior, and capture fresh evidence. Do not describe a build, source assertion,
mock, CLI exit code, deterministic receipt fixture, or static URL as production readiness.

For the first staging exercise, use an independent project and record the project/account/grant
generation without exposing credential values. A minimal database/RLS gate needs two confirmed Auth
users, a complete read-only catalog snapshot, an operator-reviewed additive migration plus backup
plan, and Data API tests showing owner success and second-user denial for every required operation.
Function, Storage, SMTP, leaked-password protection where the plan supports it, and frontend-origin
setup are separate production gates and are required only when the application declares those
capabilities or the operator's policy requires them. After any dispatch timeout or restart, do not
retry automatically: re-inspect first, compare the reviewed plan, and reconcile the remote outcome.
