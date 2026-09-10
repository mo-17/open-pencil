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
claims across Desktop restarts and never treats an uncertain outcome as permission to retry. A new
claim is durably changed to `outcome-unknown` before the executor's dispatch method can run. Once
that boundary is crossed, every non-success remains unknown; an expired lease or a structurally
returned `failed` result cannot release the project scope. Read-only reconciliation may settle
`applied` only with a one-shot opaque positive proof bound to the exact single-flight key, release,
plan, and remote-operation IDs. The current Supabase reconciler intentionally returns only
`outcome-unknown`, because its Management endpoint cannot supply that proof. The
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
Automation and observability capabilities also require dedicated verifier checks beyond their generic
capability Receipt: exact idempotency-ledger CAS, a live Queue lease plus terminal CAS, transactional
Outbox CAS, retry disposition plus DLQ publish-before-source-archive ordering, and operational-event
sink CAS respectively. Declaring the capability or presenting a generic success Receipt cannot
substitute for those durable-state proofs.
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
dedicated HMAC-credential-purpose checks for inbound and outbound webhooks. Outbound delivery also
requires a separate Host-verifier check for the endpoint authority and endpoint-credential
generation. Unknown capabilities,
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

The third isolated slice introduced a strict data-migration/backfill review package in candidate
adapter `2.2.0`. It accepts exactly one source-managed entity and one
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
typmod/generated shape, enum marker plus ordered labels, default presence, complete-table
write-hazard counts, current/session roles, `row_security`, `search_path`, object OIDs, an observed
high-water candidate, and one keyset-paginated batch preview. The whole-table hazard gate conservatively blocks
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

A fourth review-only foundation slice updates the candidate adapter to `2.3.0` and exports
`createSupabaseBackfillInspectionSubjectV1()`. It accepts only a trusted Provider Registry, a
validated V2 plan, and the current selection; internally it replans, re-emits, and rechecks the
application, plan, adapter-plan, and manifest digests before deriving a canonical Inspection Subject
bound to the Provider package authority, application,
migration, managed markers, expected PostgreSQL type/default/enum, and all three review-artifact
digests. A Host may use that Subject only to select its own built-in catalog-only query family. The
generated SQL file is not query authority, and the Subject creates no execution Receipt, Apply, or
release authority.

The same slice removes two misleading review semantics. `MAX(cursor)` without a write barrier or
lock is now named `observed_high_water_candidate` and cannot become a captured execution high water.
Because `pg_sequences.last_value` does not expose `is_called`, the template emits only a conservative
strict-`>` check and fixes the complete next-value proof to false for a future trusted Inspector. It
also stops returning raw default expressions, reports only default presence, and retains the
equivalence blocker.

An independent `2.4.0` Supabase Automation candidate now covers the bounded review surface for
scheduled jobs, private queues, inbound/outbound webhooks, idempotency, retry, and durable execution.
It deliberately uses a separate descriptor and adapter ID, so adding these capabilities does not
change the locked `2.3.0` Backfill Compiler trust digest or invalidate its cross-language evidence.
The candidate is a full-superset composition that reuses the unchanged `2.3.0` data, auth, policy,
migration, Realtime, transaction, and backfill adapters; a real managed DataModel can therefore be
planned together with Automation instead of passing only an artificial empty-model fixture.
An outbound destination never serializes its URL into Backend IR. It carries a Host-issued opaque
`endpointCredentialRef`, separate from its signing `credentialRef`; Compiler artifacts retain only
the reference digest and explicit `null` authority/generation slots. A future Host must resolve the
reference at operation time, authenticate a canonical HTTPS endpoint and credential generation,
apply redirect/DNS/private-address policy, and bind those facts into an accepted Receipt. Replacing
the endpoint requires a new generation and release review; the Compiler artifact itself has no
endpoint or fetch authority.
The Compiler emits deterministic source-controlled review SQL for logged
[`pgmq`](https://supabase.com/docs/guides/queues/pgmq) queues and UTC
[`pg_cron`](https://supabase.com/docs/guides/cron/quickstart) jobs, plus a deployment manifest and an
inert worker contract. Extension bootstrap is a separate privileged review: this artifact never
runs `CREATE EXTENSION`, and it accepts only extension-owned `pgmq`/`pg_cron` objects in their exact
schemas. It also rejects the generic `pgmq_public` wrapper schema rather than inferring that it is
absent from PostgREST exposure. Queue and Cron names are content-derived. Under one transaction-scoped
advisory lock, the SQL refuses every pre-existing target or application-marked queue, creates only a
logged non-partitioned queue, writes exact ownership/config-digest comments, revokes direct table
access from `PUBLIC` and the known Supabase API roles, and verifies those roles retain no effective
table privilege.

Scheduling requires a dedicated current role with no superuser or `BYPASSRLS` authority, locks
`cron.job`, and proves the effective Cron timezone has zero UTC offset across seasonal probes. A
same-name job is always an error—`cron.schedule` is called only after the locked absence check. The
postcondition binds job ID/name, `CURRENT_USER`, `CURRENT_DATABASE()`, local node/port, schedule,
exact command, active state, and a deterministic command marker. Generated SQL never drops a queue,
unschedules a job, or adopts an older candidate object; removal/rename remains an explicit-retirement
approval plus fresh-inventory operation.

When ordinary Automation exists, the same review artifact now includes an application-scoped,
one-shot idempotency-ledger schema candidate. Its head key is exactly
`(automation_id, idempotency_key_digest)`; immutable revisions bind the prior revision/head plus the
event, operation, causation, attempt, state, time, and retention fields through composite foreign
keys and exact catalog postconditions. Revision mutation is rejected and `outcome-unknown` cannot
start a fresh attempt. The schema is denied to `PUBLIC` and known API roles. It deliberately emits
no DML writer, outbox publisher, cleanup job, database connection, or applied-state claim; every
catalog fact remains expected and unverified until a trusted Host Receipt accepts a live database
snapshot.

The ordinary-Automation artifact now also includes a separate, one-shot transactional Outbox schema
candidate. Immutable bindings pin the business transaction, row version, event, Queue message,
idempotency key, enqueue time, and retention deadline. Revision/self-FK/head tuples carry the complete
ordered publish-attempt history, state, nanosecond time, and fresh transition evidence. A publish
attempt must begin strictly before retention expires; unknown publication stays fenced; and
`published`/`delivered` evidence is bound to the exact transition. The private schema has exact
owner/ACL/catalog postconditions, but still emits no enqueue, publish, acknowledge, cleanup, Host CAS
writer, database connection, applied-state claim, or release authority.

This Automation candidate remains outside all production registries and emits no executable worker.
It creates no database session, credential lease, network, Apply, Deploy, or release authority.
Plan and manifest fields describe an **expected, unverified** post-apply state; no queue/Cron claim is
accepted until a trusted post-apply Receipt binds the extension version/object inventory, full queue
ACL and PostgREST exposure inventory, and Cron connection target. Queue-declared payload, visibility,
and retention values are bound into a marker digest only; this candidate does not yet enforce those
Queue settings in the database.

The provider-neutral core now includes a pure Webhook security review contract. It rejects
non-HTTPS/userinfo/query/fragment/redirect authorities, ambiguous paths, local or private DNS/IP
answers, and stale resolver observations; accepted observations are immediately reduced to endpoint,
origin, path, address-set, credential-reference, and credential-generation digests, so no raw URL or
address appears in the returned subject. It also emits the exact `raw-body-v1` HMAC subject bytes
without ever accepting a signing key. These helpers authenticate neither DNS nor the credential
store, perform no network request or cryptography, and grant no runtime/release authority; only a
Host-authenticated Receipt can consume their secret-free subject.

Retry and idempotency policy also have provider-neutral pure contracts. The disposition planner
binds the automation, operation, attempt, event, idempotency, and causation domains; caps fixed or
exponential backoff without overflow; derives full jitter only from a Host-supplied uint32; and never
converts `outcome-unknown` into retry, failure, or dead-letter. The idempotency contract models
immutable revision records and an exact head/revision CAS proposal: unresolved attempts remain
fenced, successful records cannot be extended, and a new attempt can follow only a proven
`known-not-dispatched` outcome. Both outputs keep Host authentication, persistence, dispatch,
runtime, and release authority false.

A dedicated successful-replay helper can turn a newly received delivery into a terminal
`deduplicated` worker only when the caller supplies the complete succeeded idempotency record, its
historical CAS proposal, the exact persisted head revision/digest, and separate terminal-head
verification evidence plus the original message-envelope and payload digests. The helper cross-binds
automation, event, operation, idempotency, causation, and request-content identity; the resulting
worker can only propose an acknowledgement using that exact terminal verification. It neither
extends the succeeded idempotency record nor authenticates the claimed storage evidence, and the
generic worker transition API cannot construct this state.

The core additionally defines pure Queue Worker and transactional Outbox handoffs. Queue message and
lease observations bind payload digests, delivery attempts, nanosecond visibility/retention windows,
worker revisions, terminal idempotency CAS evidence, and mutation proposals. Unknown outcomes cannot
ack, retry, or archive; dead-lettering requires separate target publish-CAS evidence before source
archive. Outbox revisions require a durable pre-publish fence, keep unknown publishes fenced, and
allow a bounded new publish attempt only after fresh `known-not-published` evidence. These contracts
do not read a queue, dispatch work, persist CAS state, publish an outbox row, or grant any authority.

A leaf testing-only Host runner now exercises one injected message through the intended ordering:
live lease observation, idempotency reservation CAS, worker receive CAS, idempotency
`dispatch-started` CAS, worker pre-dispatch unknown fence, repeated live-lease checks, one-shot
process-local dispatch permit, terminal CAS, then ack/retry or publish-before-source-archive DLQ
planning. It accepts only exact process-local `fake` or `durable-test-double` adapter handles, exposes
no default adapter, is absent from production imports, carries no payload or credential, and marks
all callback side effects and reconciliation evidence unauthenticated. A reported successful source
queue mutation is only the injected callback's report: `sourceQueueMutationReadbackVerified` remains
`false`, and `sourceQueueMutationCallbackReportAuthenticated` remains `false`. Successful replay
composition, lease-extension rebinding, authenticated stores/transports, independent reconciliation,
and every production/release authority remain unavailable; this kernel is executable test coverage,
not a production Queue worker.

A separate testing-only, review-only Supabase idempotency-CAS path now lowers one verified provider-neutral
candidate into a fixed 27-parameter statement without exposing its canonical JSON values. The
statement independently rechecks both canonical byte sequences and digests, requires one
`SERIALIZABLE READ WRITE` transaction with bounded timeouts and synchronous commit, locks the head
before the complete ordered revision chain (`FOR UPDATE` then `FOR SHARE`), and permits DML only for
an initial insert or exact successor. Exact and historical replay write nothing; a partial effect
forces the statement to abort. Its catalog guard pins the generated schema, columns and default
collations, all constraint/index definitions, the append-only guard body and trigger inventory,
ACL/effective-role isolation, and zero rewrite-rule, policy, or publication exposure. A strict
response parser accepts only one native row with one of the six fixed statuses.

The Desktop also production-compiles a private, unreachable precommit and one-shot runner shape. It
pins the exact TypeScript SQL bytes, schema-sentinel count, SHA-256 digest, parameter casts and
canonical encodings; fixes transaction stage order and deadlines; switches irrevocably to abort-only
after execute; and classifies an uncertain commit separately for mandatory read-only reconciliation.
Only `inserted`, `advanced-head`, and `exact-replay` may reach commit; `cas-conflict`, `corruption`,
and `precondition-failed` always abort. In this mutating statement, `advanced-head` can describe
either a committed exact-successor write or a zero-write observation that the stored head is already
later, so the status alone cannot distinguish or authenticate either case. All six testing-parser
statuses remain unauthenticated: neither a committed transaction nor its status alone proves database
readback or issues a Receipt. There is still no production constructor,
caller, credential lease, database adapter with wire-level response bounds, operation-journal
precommit, certified server cancellation, authenticated response/readback, fixed read-only
reconciliation, reviewed-deployment Receipt binding, Receipt V2 issuer, Tauri command, or release authority, so this compiled boundary
cannot reach a live database.

`pgmq.read` visibility leases, archive-after-success, an authenticated database idempotency CAS,
authorized retry/dead-letter execution, actual HMAC signing/constant-time verification and replay
storage, a pinned
Host DNS/connect transport, retention cleanup, health checks, deployment Receipts, and live
crash/retry tests are explicit blockers. Data-change
triggers, workflow/transaction actions, telemetry, and drift monitoring are also rejected until their
separate trigger, execution, and observability authorities exist. This is intentionally stricter than
Supabase Database Webhooks, which are asynchronous `pg_net`-backed triggers: no database-triggered
network request is generated by this slice.

An independent `2.5.0` Supabase Observability candidate composes the complete `2.4.0` bundle without
changing either older trust domain. A managed DataModel, private queues, webhooks, ordinary Cron, and
telemetry/drift intent can therefore share one Provider selection. The composite projects the unique
`drift.detect` schedule out before invoking the `2.4.0` Automation planner/emitter: ordinary jobs may
appear in review SQL, while the drift schedule remains inert Host-contract data and cannot silently
become a database Cron job. It accepts at most one UTC drift schedule with `declared-schema` /
`read-only` semantics and emits four deterministic review artifacts: a release-blocking manifest,
a single-snapshot inspection contract, an append-only audit contract, and a review-only operational
event sink schema candidate.
When projection leaves no ordinary queue, destination, or automation, the composite emits no
Automation artifacts and does not propose enabling the unrelated `pgmq` extension.

The contract keeps two digest domains separate. `declaredDataModelDigest` uses the same normalized
DataModel digest as migration inspection, while `declaredSubjectDigest` additionally binds the
application/Auth/Automation declaration. `expectedSourceLedgerSchemaDigest` remains `null` in
Compiler output because only the trusted Host can read the current environment's source-ledger
baseline; a future drift Receipt must use that Host-proven digest, never substitute the declaration
digest. The inspection contract accepts no Compiler/caller SQL, URL, headers, or credential and
forbids application rows, raw errors, query parameters, and secret material. It identifies the
existing canonical source-migration drift Receipt as the eventual Host outcome, but cannot create
that Receipt or mutate the source ledger.

The provider-neutral core now also defines an operational-event sink handoff. It reuses the strict
event-chain and Host-anchor verifier, enforces 16 KiB per event and 256 KiB per batch/proposal, keeps
event order and exact prior/head digests, and emits a revision/head CAS proposal. The output is
canonical, secret-free, and immutable, but its Host-anchor-authenticated, persistence, export,
alert, and release-authority flags remain false.

Supabase projects that contract into a one-shot, application-scoped private-schema candidate with
append-only revision and exact-head tables. The DDL binds Provider/environment/authority, trusted
anchor, prior and next heads, ordered event digests, the final event time, observed time, and exact
revision/head CAS state. All time fields use a fixed nine-fraction UTC text projection that a trusted
Host must normalize without rounding, so PostgreSQL cannot silently discard nanosecond identity.
The catalog postcondition fixes ownership, constraints, indexes, comments, and direct/effective API
role ACLs; absence from PostgREST exposed schemas remains explicitly unverified and release-blocking.
No event payload, DML writer, database session, credential, network transport, exporter, or authority
is emitted. The schema candidate therefore closes only the reviewed persistence shape, while the
portable handoff still requires an authenticated Host CAS writer.

The `2.5.0` candidate emits no scheduler, observation runner, telemetry drain, audit DML writer,
alert delivery, database session, network request, credential lease, Apply, Deploy, or release
authority. A trusted Host scheduler with restart recovery, current source-ledger baseline binding,
exact Provider/project
authority, a single-snapshot Receipt, redaction/cardinality controls, retention/export policy,
operator acknowledgement, and live drift/telemetry tests remain explicit blockers. Production and
source-only modes preserve the existing `2.4.0` composition for already supported capabilities;
only the new server-owned observability capabilities remain unavailable outside their reviewed
Host authority.

The next Host-only slice adds a fixed native Desktop Management command, a one-shot renderer
adapter, and a strict single-snapshot decoder. Rust owns the saved PAT and grant snapshot, hardcodes
Supabase's project lookup and
[`/database/query/read-only`](https://supabase.com/docs/reference/api/v1-read-only-query) endpoint,
disables redirects, accepts no caller credential, SQL, URL, method, headers, or response limit,
verifies the project organization, and sends exactly one bounded catalog statement. The exact query
and parameter body is digest-bound across Rust and TypeScript, and the native command atomically
re-reads the PAT plus grant generation after both requests before returning. Bound verification and
release calls also require an independent database-write PAT in the same atomic snapshots without
returning either PAT to the renderer. Only the main Tauri window receives command permission.
The command also holds a process-wide fail-closed single-flight guard from before the first vault
read through both network requests and the final vault snapshot. Concurrent invokes are rejected,
and RAII releases the guard on success, failure, or cancellation.
Production Desktop review, staging verification, and staging release catalog reads now default to
this module-owned native transport; injectable renderer fetchers and dependencies live only on
explicit `ForTestingV1` factories and cannot acquire the production transport brand. Initial review
may discover the organization once, while verification and release require the reviewed
organization ID. The Host rebuilds the Subject from the live trusted V2 Registry, plan, and
selection, then re-resolves both that Subject and the credential grant around the query. The decoder
binds the table, columns, primary key, enum, and identity sequence by OID,
returns only default presence, and records exact role, primary-server, RLS, search-path, transaction,
and write-hazard evidence. Supabase's current `supabase_read_only_user` is `BYPASSRLS`, and the
endpoint does not document `transaction_read_only=on`; neither observation is misrepresented as an
RLS or transaction safety proof. This catalog inspection instead relies on the fixed endpoint role
and Host-owned schema-qualified catalog SQL, which never reads managed-table rows. This native slice
is still read-only: it cannot capture a locked high water, install the CAS ledger, create a Receipt,
Apply SQL, or establish release authority.

The following Host-only slice turns a successful live inspection into a deterministic write-barrier
**review**, but still cannot install it. The Host accepts no caller inspection, SQL, constraint name,
predicate, or marker. It internally reruns the fixed Inspector, binds the complete inspection,
Provider/plan/artifact authority, project/account/grant generation, and live object OIDs, then emits a
digest-bound preview transaction containing exactly `ALTER TABLE ONLY ... CHECK (target IS NOT NULL)
NO INHERIT NOT VALID` plus a same-transaction transient constraint comment. PostgreSQL
[`NOT VALID`](https://www.postgresql.org/docs/current/sql-altertable.html) skips the
existing-row scan but still rejects later inserts and updates whose resulting target is null; it also
means an unrelated update to a legacy-null row fails until that row supplies a non-null target. The
preview records the required five-second lock timeout, fifteen-second statement timeout, serializable
transaction, and [`ACCESS EXCLUSIVE`](https://www.postgresql.org/docs/current/explicit-locking.html)
lock impact, but creates no mutation, execution, or Receipt authority. A final live subject/grant
check runs after all asynchronous digests. The original
`write-barrier-not-installed` blocker remains.

A specialized Host verifier and its operation-scoped Management transport now cover the next
read-only boundary. They accept only a genuine in-memory review, rebuild the live Subject and grant
before and after the fixed query and once more after digest construction, and hardcode the same
[`/database/query/read-only`](https://supabase.com/docs/reference/api/v1-read-only-query) endpoint. The
single statement binds the reviewed table owner, table/target OIDs, RLS state, generated/default
shape, constraint name, marker, and target predicate. It returns counts and structural flags only;
`pg_get_expr` is compared inside PostgreSQL and no raw constraint definition crosses the transport.
The strict decoder distinguishes only an entirely absent barrier, exactly one reviewed transient
barrier, or a mismatch. Installed state requires one local, non-inherited, unvalidated, non-deferrable
`CHECK`, the exact one-column key and predicate, a globally unique marker, and agreement between
`pg_class.relchecks` and the constraint inventory. The query is deliberately version-gated to
PostgreSQL 15-17; newer catalog versions fail closed until a versioned query also verifies their new
fields. These details follow PostgreSQL's
[`pg_constraint`](https://www.postgresql.org/docs/current/catalog-pg-constraint.html) contract.

This verifier is still review-only, is not wired into the candidate V2 Provider's App UI, and creates
no mutation, execution, source-ledger, or Receipt authority. Only a successful `absent` result can be
consumed once by the installer preparation step described below. The generic Inspector remains unchanged and
continues to reject every managed-table `CHECK`; it is not silently relaxed for arbitrary constraints.

The next Host-only slice supplies that narrowly scoped installer without turning the review SQL into
authority. A reviewable endpoint artifact is built only from a genuine review plus its genuine
`absent` proof. Explicit confirmation then binds the exact review, proof, SQL digest, independently
saved staging project/account, and a separate `database:write` / `database_migrations_write` grant.
The review and absent proof are consumed together, synchronously and once, before any asynchronous
authority check. The mutation SQL is independently generated by the Host: it sets serializable
isolation and local timeouts, obtains `ACCESS EXCLUSIVE` before the first catalog snapshot, rechecks
the complete table/cursor/target/primary-key/identity-sequence address and hazard inventory under the
lock, proves the exact marker remains globally absent, and only then adds and comments the transient
constraint. It has no `IF NOT EXISTS`, caller SQL/name/rollback, managed-row read, DML, or generic SQL
endpoint fallback.

Its operation-scoped transport hardcodes Supabase's
[`/database/migrations`](https://supabase.com/docs/reference/api/v1-apply-a-migration) endpoint,
checks project organization once during preparation and again immediately before POST, sends only
the exact `{ query, name }` body, and accepts only HTTP 200 with an exact empty JSON object. A
specialized controller durably records the project-wide single-flight claim and complete digest-only
progress evidence, then settles the claim to `outcome-unknown` **before** privately registering a
one-shot, context-bound journal permit. No exported API can mint that permit. The fixed-origin
transport consumes it and re-reads the exact unknown claim and `project-authority-confirmed` evidence
before its second authority GET or POST. Both controller entry points accept only Host-factory-created
journals; a bare installer context, structurally compatible injected transport, or injected journal
cannot reach the mutation boundary. A proven pre-POST rejection may become failed; every error after POST begins and even a
successful HTTP 200 remain non-retryable `outcome-unknown`. After the POST attempt completes, the
controller rotates a process-local verification epoch. Only a genuine `installed` proof whose
verification started under that new epoch, and which is bound to the same review and exact
constraint OID, may write final evidence and then settle applied. Completed or in-flight proofs from
before dispatch are rejected. Exact controller option records reject accessors, custom prototypes,
symbols, and extra fields before journal or network effects. The generic Backend Apply helper is
intentionally not used because its HTTP-success semantics are too broad for this barrier.

This is an endpoint-ready Host primitive, not an App Apply button or a completed release flow. No
real project was mutated by the tests. Supabase assigns the remote migration-history entry, while a
matching source migration file and `db push` ledger remain absent, so `sourceLedgerBound` and
`releaseReady` stay false. Genuine review/proof authorities remain process-local WeakMap identities.
Exact terminal `installed` or proven `not-dispatched` evidence in a Host-created durable journal is,
however, restart-safe recovery evidence: after a fresh genuine context rebinds the same canonical
review, the controller may retry only the missing terminal settlement without another POST or proof
consumption, including the commit/return crash gap. A process crash after POST but before final
installed evidence exists still stays unresolved and requires manual reconciliation until a separate
read-only recovery verifier is added. Expired
`pending` leases are not guessed to be failed: the current journal lease is not yet a database CAS or
fencing token.

The next Host-only primitive can now turn one genuine applied barrier reconciliation into a locked,
environment-specific high-water proof. The applied result is registered as a process-local WeakMap
capability for all three settlement paths, including restart recovery from exact final journal
evidence, and is consumed once before capture can cross the network boundary. A deterministic review
artifact binds the Provider package, application, plan, manifest, migration, source review, installed
constraint OID, complete inspected object address, and fixed query digest. Confirmation separately
binds that artifact, the saved staging project/account, and an operation-scoped
`database:write` / `database_write` credential generation distinct from the read-only inspection
grant.

The dedicated transport hardcodes Supabase's
[`/database/query`](https://supabase.com/docs/reference/api/v1-run-a-query) endpoint, checks the project
organization before and after the query POST, accepts no caller SQL, endpoint, or parameters, and
sends only exact `{ query, read_only: false }`. Its bounded 60-second HTTP deadline leaves margin
above the fixed lock, catalog-recheck, and aggregate-statement budgets. The explicit serializable transaction takes
[`SHARE ROW EXCLUSIVE`](https://www.postgresql.org/docs/current/explicit-locking.html) before the first
catalog or managed-row read, so concurrent table writers are blocked while ordinary readers may
continue. Under that lock it rechecks the table, cursor, target, primary key, identity sequence,
hazard inventory, and the unique installed transient barrier by exact names, markers, OIDs, column
numbers, types, and constraint definition. Only then does it compute the full-table minimum/maximum
cursor, row count, remaining-null count, unsafe-cursor count, and required receipt-batch count. The
batch budget is derived from **all captured cursor rows**, not only current NULL matches: the bounded
runner must advance a primary-key keyset window of at most `batchSize` rows even when NULL values are
sparse, while mutating only rows that still match `target IS NULL`. Every
`int8` result crosses JSON as decimal text and is parsed through `BigInt` before it is admitted into
JavaScript's safe-integer range.

The provider-neutral Receipt V2 contract now separates cursor progress from completion. Its immutable
scope binds Provider authority, application, migration/source-ledger artifacts, captured high water,
physical resource identity, batch bounds, and the receipt-zero capture digest. A receipt chain may
complete below the captured high-water key only when the same database checkpoint proves zero
remaining eligible/NULL rows and every postcondition; this covers sparse keys and rows deleted after
capture. A zero-row checkpoint must terminalize, the 9,999th batch cannot remain in progress,
`outcome-unknown` is not a Receipt state, and successful verification still grants neither database
nor execution authority. A Host-only review derives the exact Supabase scope draft from one genuine
process-local capture identity without consuming it or creating execution IDs, receipt IDs, CAS head,
or a permit. The capture becomes consumable exactly once only at the future ledger initializer.

The same provider-neutral boundary now exposes an incremental Receipt-chain verifier for paged Host
reads. Each non-empty page is capped at 64 Receipts and is verified against copied scalar transition
state plus page-local uniqueness deltas. Accepted uniqueness sets are neither copied nor mutated until
the whole page succeeds, so a malformed or invalid page commits nothing, may be replaced with a
corrected page, and total uniqueness work remains linear rather than quadratic across many small
pages. The verifier retains only the prior/last-exhaustion Receipt plus four bounded uniqueness sets,
not every canonical payload, and `finalize()` alone compares the caller-authenticated head digest.
Incremental failures expose stable `failureDisposition`, `finalized`, and `retryable` fields so callers
can distinguish a rejected page, an operation already in progress, and a terminal verifier without
parsing messages. Invalid initialization becomes a terminal failure result rather than a rejected
factory promise, and whole-array or paged malformed entries report the same absolute chain index.
Concurrent appends and post-finalization appends fail closed. The original whole-array verifier uses
this same transition engine, and both results remain non-authoritative. All canonical count fields
reject negative zero so distinct JavaScript inputs cannot collapse onto the same JSON digest.

A provider-neutral source-ledger binding Receipt now describes the missing bridge from that draft to
the final Receipt V2 scope. Its subject binds the canonical promotion-ledger digest, the complete
staging applied prefix, current target authority and no-drift Receipt, the final applied P1 source
migration, the exact inspected-ledger file bytes/head/entry, and the exact source SQL bytes. The P1
source migration must already be the final applied prerequisite and must be distinct from the pending
P2 backfill migration. The portable verifier deliberately treats a self-consistent CI attestation as
structural evidence only: it does not authenticate a protected repository ref, `supabase db push`,
remote migration history, credentials, or any Host trust root, and all of its authority flags remain
false. A Host-only review independently rebuilds every local and promotion-ledger anchor before it
accepts that evidence. A branded testing-only CI verifier can then exercise single-flight binding and
materialize the strictly parsed final V2 scope with a non-null `sourceLedgerDigest`; clones,
cross-wiring, concurrent reuse, mismatched evidence, and replay fail closed. This testing path still
creates no database, execution, Receipt, or release authority and never contacts or mutates Supabase.
Production binding still requires a fixed CI trust root that proves the protected revision and exact
successful `db push`/remote history for the same staging project and account.

A portable signed-receipt envelope now makes that future Host boundary byte-exact without claiming
it already exists. The envelope signs one canonical payload containing its own format/version and
the complete source-ledger binding Receipt. Its strict parser rechecks every internal subject,
attestation, applied-prefix digest, and timestamp relationship before either the payload digest or
signing bytes can be produced. A bounded 256 KiB byte parser additionally requires fatal UTF-8 and
the unique canonical JSON representation, rejecting duplicate keys, whitespace variants, alternate
escapes, accessors, custom prototypes, unknown fields, and unpaired surrogates. The parsed result is
named only `structurallyValid`: its Ed25519 `keyId` is an untrusted locator, no public key or trust
root is accepted here, and no CI, source-ledger, database, execution, Receipt, or release authority
is granted. A future production native verifier must select a compiled trust root independently and bind the
verified receipt to the live project/account/grant snapshot.

A separate dormant Rust verifier now proves that native boundary against the same checked-in
cross-language fixture. It requires the exact canonical envelope bytes, mirrors the nested strict
schema and JavaScript safe-integer/timestamp rules, recomputes the applied-prefix, subject,
attestation, and payload digests, selects an Ed25519 root only from a compiled table, and compares
the complete signed scope with a Rust-owned expectation. The shared fixture covers JSON escaping,
Unicode, `Number.MAX_SAFE_INTEGER`, and a real Ed25519 signature; semantic reject vectors also keep
secret-like strings, ECMAScript trim characters, and invalid Supabase project refs outside the
native acceptance set. Its production root table is deliberately empty and the trusted expectation
has no production constructor. Tests can issue only a process-local, 30-second, bounded one-shot
handle with issuer and generation fencing; consume, mismatch, expiry, replay, and drop burn it.
The module has no Tauri command, network client, persistent replay high-water, journal connection,
database runner, or authority-bearing result, so production verification and release authority
remain unavailable.

The Host now also emits a deterministic, secret-free DDL **review** for a private
`openpencil_release` CAS ledger. Its execution, Receipt V2, and current-head tables bind one capture
and one scope per execution, retain the exact bounded canonical scope/Receipt bytes, and constrain
the head tuple to `(revision, eventId, receiptDigest)`. Core PostgreSQL SHA-256 plus base64url checks
bind those byte sequences to `scopeDigest` and `receiptDigest`. Receipt IDs, idempotency keys,
request digests, event IDs, and Receipt digests are unique within an execution; the previous-head
foreign key uses default `MATCH SIMPLE` so the initial Receipt can have no predecessor, while the
revision CHECK requires all three predecessor fields to be either absent at revision 1 or present at
later revisions. The current-head foreign key fixes the referenced tuple. The schema revokes access from `PUBLIC`, `anon`,
`authenticated`, and `service_role`, enables zero-policy RLS without forcing it on the future
database owner/runner, and uses no extension, sequence, `SECURITY DEFINER`, managed-row read, or DML.
The DDL provides the tuple and foreign-key preconditions needed by a future CAS transaction; it does
not itself perform or claim a compare-and-swap update.
This artifact is deliberately non-idempotent review material and has no `IF NOT EXISTS`. A Host-only
preparation path now creates an operation-scoped install review, requires one genuine `absent` proof,
generates a non-secret random UUID nonce, and appends one exact marker comment to the
`backfill_executions_v1_pkey` constraint before `COMMIT`. The marker, its binding digest, and the
install-specific SQL digest are bound through review, confirmation, and the redacted install context.
The base DDL remains deterministic; each prepared installation is intentionally distinct. The Host
performs the fixed project-authority GET before returning prepared migration metadata that explicitly
separates `baseSqlDigest` from `installSqlDigest` and also binds the exact marker plus its
`markerBindingDigest`. The source review's `sqlDigest` continues to identify only the deterministic
base DDL; the prepared migration has no ambiguous `sqlDigest` field.

A testing-only composition now exercises the complete durable install state machine without being
connected to the Desktop application or a production credential issuer. It issues one exact
operation-bound write-credential lease, durably claims the project scope before the first authority
GET, performs a second authority GET after precommit, and binds every review, marker, SQL,
credential-incarnation, and operation-generation field into the one-shot transport permit. The
Host retains the opaque claim capability if the journal confirms the commit but its immediate
readback is temporarily unavailable; no precommit or permit can proceed until a later exact reread
matches that claim. A binding-matched permit-validation failure before POST remains attestable as
known-not-dispatched, and the installed-verification epoch is rotated before the permit is deleted.
If no authoritative no-POST proof can be produced, the reconciliation handle is retained instead
of silently forgetting the unresolved scope.
The permit crosses to durable `outcome-unknown` immediately before the injected fetcher can start the
fixed [`/database/migrations`](https://supabase.com/docs/reference/api/v1-apply-a-migration) POST.
Only an opaque proof minted before that boundary can settle the claim as `not-dispatched`; every
failure after it forbids automatic retry. A 200 empty JSON response is only
`verification-required`. `databaseLedgerBound` becomes true only after a fresh, operation-epoch
installed proof is durably settled as applied. Capability clones, cross-wired authority/transport
pairs, stale proofs, and concurrent replay fail closed, while invalid proofs cannot poison or consume
the genuine attempt. The resulting applied value retains whether it came from the production or
testing composition, the exact credential-lease binding digest, write-credential incarnation, and
operation lease generation; the Host also keeps its dispatch context, durable evidence, installed
verification, and lease as one identity-bound process-local provenance record. A serialized or
equal-data clone cannot recover that provenance or become authority for a later operation. A clock
regression or exception after the durable claim reuses only the last
accepted monotonic timestamp on paths already proven not to have reached POST. If a final journal
write or exact readback remains unavailable, the attempt stays reconciliation-required. The
consumed no-dispatch or Applied proof is never reconstructed from serialized final evidence;
`resumeSettlement` performs no transport call and remains fail-closed until a separate fresh,
authoritative observation path is available.

A testing-only Receipt-zero review now joins the genuine final V2 scope to the durable applied
CAS-ledger installation only when both descend from the exact same process-local Receipt review.
It binds the testing CI trust-root evidence, source-ledger Receipt and digest, capture/query/catalog
digests, the complete applied-install result digest, installed verification, marker, and the old
installer lease triplet into one explicitly unauthenticated operation-evidence digest. A caller-supplied
UUID v4 nonce derives deterministic, role-separated execution, Receipt, event, and idempotency IDs;
the request subject then binds those IDs and the initial outcome without hashing itself or the final
Receipt. The shared provider-neutral parser and chain verifier validate the resulting capture
checkpoint, and a final row-plan digest covers the execution/Receipt/head tuple plus exact canonical
byte lengths. Equal input, time, and nonce reproduce the same candidate; a different nonce changes
all downstream identities and digests.

This candidate is still review material. `preparedAt` is copied into the unpersisted testing
Receipt's `committedAt` only so static validation can run; it is not a database commit time and has no
Host-clock freshness or future-time authority. The review consumes no capture, issues no
Receipt-zero credential or permit, emits no SQL, dispatches no request, persists no row, and keeps
every production authority/release flag false. The CAS install lease triplet is provenance only and
cannot authorize initialization. A future initializer must issue a new purpose-specific lease,
reverify the installed marker/shape and current head inside the same `SERIALIZABLE` transaction, and
consume the capture synchronously immediately before its first mutation-capable await. An absent
chain may insert execution, Receipt zero, then head; an exact revision-one replay is read-only; an
advanced head is never rewound; partial state, cross-identity collisions, or unequal canonical bytes
are corruption. `ON CONFLICT DO UPDATE` is forbidden, and an ambiguous POST must remain
`outcome-unknown` until read-only reconciliation rather than being resubmitted automatically.

A further testing-only CAS transaction review now lowers that candidate to one operation-independent,
parameterized writable CTE plus an exact 28-position parameter layout. Provider/environment,
revision, checkpoint kind, previous-head nulls, and receipt limits are fixed SQL literals; canonical
scope and Receipt bytes are passed as standard Base64 and decoded without JSON reserialization.
The public review exposes only parameter names, PostgreSQL types, exact byte lengths, and separate
SQL/schema/value digests. The ordered values and canonical bytes remain in a process-local trusted
context and still grant no credential, permit, or mutation authority.

A strict testing-only response parser accepts only one dense row with one allowlisted `status`,
recomputes the review, SQL, parameter-schema, and all 28 hidden-value digests, and emits a sanitized
observation. `inserted`, `exact-replay`, `advanced-head`, `corruption`, and `precondition-failed` are
all unauthenticated reports at this layer: none consumes the capture or creates credential,
transport, database, execution, Receipt, or release authority, and every state still requires a
fresh read-only reconciliation. The remaining blocker is production transport authentication, not
response-shape parsing.

This statement deliberately does **not** contain `BEGIN`, `SET TRANSACTION`, or `COMMIT`.
Parameterized Supabase Management queries cannot establish a surrounding transaction and then run
another bound statement in the same request, while the endpoint exposes no isolation control. The
review therefore requires a future fixed native transport to establish `SERIALIZABLE READ WRITE`,
`row_security=off`, `synchronous_commit=on`, `search_path=pg_catalog`, and bounded statement/lock
timeouts before execution; direct Management-query dispatch is explicitly incompatible and
unavailable. Its runtime guard independently requires the same settings, including the exact
`current_setting('synchronous_commit') = 'on'` check, and returns `precondition-failed` rather than
confusing an authority/runtime failure with ledger corruption. The writable CAS statement itself
still has no fresh in-statement catalog/install-marker guard; the guarded read-only reconciliation below
does not remove that mutation-side blocker.

Within the reviewed statement, candidate execution collisions are locked in sorted identity order,
then the head, then all candidate Receipts, all with `NOWAIT`. Only an exact absent pre-state may feed
the dependent execution → Receipt → head inserts. `exact-replay`, `advanced-head`, `corruption`, and
`precondition-failed` feed zero writes; a completed/already-satisfied Receipt zero can never have an
advanced head. A final effect guard aborts unless the absent branch inserted exactly one row in every
table or a non-absent branch inserted none. Lock, serialization, unique, timeout, or network failures
must remain `outcome-unknown` and move to a separate read-only reconciliation path; they are never
automatic retries or database-corruption claims.
`advanced-head` is only a relational tuple-chain classification: it does not validate the portable
semantics of Receipts 2..N and always requires the separate read-only shared V2 chain verifier before
any runner or recovery path may treat it as healthy.

A testing-only Receipt-zero reconciliation review now emits a second fixed statement for the
read side. It reuses the CAS review's exact 28 positional values without exposing or reordering
them, performs no DML or row lock, and bounds candidate execution/head reads to two rows and Receipt
reads to 10,001 rows. One statement snapshot returns the reported state plus compact facts; a Host
parser must recompute the state rather than trust the returned label. The snapshot identity is
returned only as a SHA-256 digest, so a large active-XID list cannot expand the response. Durable read states are
`absent`, `exact-replay`, `advanced-head`, `corruption`, and `precondition-failed`; a successful CAS
`inserted` event can only read back as `exact-replay` or a subsequently advanced head.

Only the managed-row reads and response shape are contract-bounded. Recursive role closure,
schema-wide catalog scans, and full inventory aggregation have no intrinsic SQL cap, so this is not
described as a globally bounded query and must remain behind a server-enforced statement timeout.
Every managed relation read uses `ONLY`; the catalog no-inheritance check remains an independent
shape assertion rather than the sole defense against inherited rows.

The same snapshot now embeds the established CAS-ledger catalog verifier and compares its complete
column inventory plus the complete constraint inventory, including supporting indexes, opclasses,
foreign-key operator identities, trigger state, ACLs, comments, RLS, inheritance, publications,
dropped columns, and unexpected object counters. It also requires exactly one syntactically valid
install-marker comment and matching non-superuser `supabase_read_only_user`
current/session roles with `BYPASSRLS`, immediate `USAGE` of `pg_read_all_data`, no ledger ownership,
a primary database, and the exact `pg_catalog` configured search path. Because the historical
marker is not a 29th SQL parameter, the query returns only the SHA-256 digest of the observed marker;
a strict testing-only Host parser compares it with the digest retained by the genuine process-local
review, checks an exact one-row/field shape, recomputes every relational state from mutually
consistent facts, and lowers any otherwise healthy marker mismatch to `precondition-failed`.
The same fail-closed override also applies when the reported state is `corruption`; the separate
`reportedStatus` remains available for diagnosis without outranking installation provenance.
The response remains injected and production-unauthenticated, so neither its reported classification
nor the Host-computed testing status proves database state or creates database/reconciliation
authority. `transaction_read_only` is returned as evidence rather
than used as a hard SQL gate because the documented read-only Management endpoint does not promise
that GUC. That endpoint also cannot establish the required `search_path=pg_catalog` before parsing a
separate parameterized statement, so direct Management-query dispatch is explicitly incompatible;
the fixed native transport must enforce both boundaries.
The review records this catalog verifier as included in the fixed statement, not as performed; that
flag remains false until a future authenticated transport actually dispatches and validates it.

The exact catalog comparison is still not a drift-safe planning or execution-safety proof: PostgreSQL
must resolve the data expressions before a false runtime guard can suppress their rows. Before any
transport may dispatch it, expression/operator resolution and the absence of indirect execution paths
must therefore be proven, the transport must enforce the read-only boundary, and the server must
enforce bounded statement timeout and cancellation. The SQL row limits bound returned candidates,
not every possible physical scan or recursive intermediate under a drifted schema. The composed
fixed-query request size must also be certified against the eventual native/Management transport
limit before dispatch is enabled.

Both testing-only read reviews now require a genuine process-local
`postgres-read-query-static-conditional-v1` certificate. The certificate binds the exact query ID and
version, raw SQL bytes, SQL/query/contract digests, positional-parameter order, response-field order,
managed-relation list, ledger shape, and expected column and constraint inventories. For that fixed
text only, its bounded scanner proves one terminal `SELECT`; rejects direct DDL, DML, dynamic SQL,
data-modifying CTEs, row locks, direct typed-literal casts, and unrecognized operator tokens; restricts
explicit parenthesized function and aggregate calls, casts, and catalog relations to explicit `pg_catalog`
allowlists; and
requires `ONLY` for all three managed ledger relations. It also rejects doubled-quote identifier
escapes, explicit `OPERATOR(...)`, managed-relation inheritance `*`, and CTE references outside their
parenthesis ancestry and declaration-order scope. PostgreSQL parses `COALESCE` and `LEAST` as
special conditional forms rather than ordinary schema-qualified functions, while ordinary aggregates
remain explicitly `pg_catalog`-qualified. The reconciliation and page-review factories independently
match the genuine certificate against their complete built-in query contracts. This is a static,
conditional text certificate, not evidence that PostgreSQL executed the statement safely.

In particular, the certificate does not parse the complete PostgreSQL grammar or authenticate the
live server version, catalog, function/aggregate implementations, operator resolution, casts and type
I/O, planner/index/opclass support, or relation rewrite, RLS, FDW, and table-access-method behavior.
PostgreSQL composite field notation can also resolve `alias.field` as a one-argument function call; the
static scanner does not authenticate that live resolution, so
`compositeFieldNotationFunctionResolutionAuthenticated` remains false.
The fixed query deliberately avoids `current_schemas(TRUE)`, which can initialize an implicit
temporary schema under unsafe session state, and instead verifies the already configured
`search_path` string. That runtime check still occurs after parsing and is not a substitute for the
transport setting the path first. Consequently
`liveIndirectExecutionSafetyAuthenticated` and `indirectExecutionSafetyProven` remain false. Before
dispatch can exist, both reviews keep `requiresFullLiveTypeOperatorIndexGuardBeforeDispatch` true,
and a fixed trusted transport must establish a safe `search_path` before PostgreSQL
parses the query, enforce a read-only transaction boundary plus bounded timeout and cancellation, and
freshly bind the authenticated live server and complete relevant catalog semantics. An in-statement
runtime guard runs only after parse, rewrite, and planning, so it cannot replace those pre-parse gates.

Missing schemas, relations, columns, incompatible types, HTTP failures, timeouts, and response-parse
failures can abort before a classification row exists. They remain `outcome-unknown`, never become
`absent` or `corruption`, and never permit an automatic retry. Likewise, a fresh `absent` snapshot
does not prove that an earlier mutation request has stopped. `advanced-head` remains relational-only:
compact facts cannot replace full portable Receipt V2 verification. A testing-only collector can now
assemble already parsed bounded pages and run that portable verifier, but the review still creates no
Host/native transport. Its parsers accept injected testing responses only and deliberately create no
production response-authentication or retry authority.

A separate process-local JavaScript fixed-read session exercises the reconciliation parser through
one closed testing-only harness variant. Its callback receives only the built-in query identity, exact hidden
28-value ordering, immutable binding digests, required `search_path=pg_catalog`, and explicit
read-only/live-catalog requirements; the API accepts no SQL, URL, endpoint, PAT, header, credential,
or parameter override. The public session retains only request length/digest metadata, while request
bytes and copied UTF-8 JSON response bytes are capped before the existing strict parser is reused.
Each session is consumed before its callback, so concurrent, reentrant, failed, aborted, timed-out,
or parse-rejected runs cannot be replayed; that harness deadline supplies only a process-local
cancellation signal and cannot preempt its synchronous callback or claim server cancellation. This
limitation describes the callback harness, not the later async Rust kernel below. The callback is still
arbitrary same-process test code, so neither its side effects nor the absence of a production request
or transport are authenticated. Results have opaque WeakMap provenance without returning the genuine
review, and keep every production transport, read-only boundary, live catalog, snapshot, database,
mutation, execution, Receipt, and release authority flag false. This harness is an offline lifecycle
and binding test, not the missing trusted native transport, and it does not make the incompatible
Management read-only endpoint usable.

The next offline native slice separates an exact wire contract from a still-unregistered execution
kernel. The 115,192-byte reconciliation statement is now materialized once as a versioned `.sql`
artifact, imported by TypeScript with `?raw`, and included by Rust without newline normalization; its
terminal LF and SHA-256 digest are pinned, while the retained TypeScript generator fails closed on
any byte drift. The TypeScript contract accepts only the fixed query/version, 28 ordered
string-or-null parameters, exact binding digests, `search_path=pg_catalog`, read-only, timeout, and
response-limit declarations. It also parses the embedded Scope V2 and Receipt V2 documents through
the public lowcode schemas, requires their typed canonical bytes to match exactly, and binds every
positional value back to those documents and the Receipt-zero state. Unknown fields are rejected,
and SQL, URL, endpoint, header, PAT, credential, and caller-selected session overrides are absent.

The private Rust mirror caps the complete 262,144-byte request before deserialization, rejects
unknown or duplicate fields, independently rechecks the fixed artifacts, canonical digests,
PostgreSQL numeric/timestamp bounds, embedded typed documents, and all cross-bindings, and can feed
the same fixed execution kernel only after trusted consumption. A non-cloneable Host evidence value
binds the 17 digests, 28 parameters, project, account, grant generation, and database-read credential
incarnation. A private process-local `ReceiptZeroReconciliationAuthorityV1` /
`HostFixedReadEvidenceIssuerV1` seam now represents the upstream handoff: issuance removes the
one-shot authority before comparing the candidate or credential snapshot, then requires the exact
request digest, all 17 bindings, all 28 parameters, Host project/account identity, grant generation,
database-read credential incarnation, and connection-profile digest. Its only population path is
`#[cfg(test)]`; production still cannot mint this authority, renderer-reconstructible values cannot
populate it, and all production-authority and release flags remain false. A separate process-local
session registry uses random 32-byte opaque IDs, at most 32 live entries, a 30-second TTL, and
remove-before-validate consumption, so mismatch, expiry, replay, and concurrent consumption burn the
session.
Session IDs must also be canonical 43-character Base64URL values before registry lookup; entropy
failure or bounded collision exhaustion fails closed without replacing an existing session, and
identity-bearing values omit or redact `Debug` output. Grant generations use the same canonical
UUID-v4 shape as the existing Host authority boundary.
The database-read credential incarnation is a required nonzero opaque 32-byte Host marker. It is
not the existing database-write incarnation and must not be derived from credential bytes.
The dormant native credential reader now takes the password, database-read incarnation, strict
canonical connection-profile JSON, an independent connection-profile digest witness, and the shared
grant generation from five fixed encrypted-vault accounts in one process/file-locked snapshot. It
preserves the password bytes in zeroizing storage, rejects empty, NUL, or oversized values, requires a
canonical UUID-v4 published grant generation, and requires both markers to be canonical nonzero
32-byte Base64URL values. The stored profile must already be canonical, and its freshly recomputed
digest must equal the separate witness from the same atomic snapshot. A legacy four-record state that
lacks the canonical profile therefore fails closed and must be replaced through the dedicated
credential command before it can supply connection material. The `supabase-database-read` integration
namespace is reserved from the generic renderer credential commands, so a caller cannot use the
ordinary credential resolver to read, replace, remove, or inspect these records. Three dedicated
commands are now registered only for the Tauri `main` window: status returns only `configured`,
`missing`, `unavailable`, or `invalid`; replace validates the password and strict non-secret profile,
creates an independent fresh incarnation plus UUID-v4 grant generation, and updates all five records
through one vault CAS; clear removes the password, canonical profile, and digest witness while
rotating both markers. The TypeScript bridge serializes the canonical profile and strictly validates
the native status/receipt shape.
Mutation receipts contain no credential or connection-profile bytes and explicitly report commit
durability. A `confirmed` receipt means the vault replacement and directory entry were synced;
`unconfirmed` means the atomic rename completed but directory sync failed, so callers must retain
both generations and reconcile after restart instead of retrying the stale generation or granting
release authority. The commands accept only fixed raw IPC envelopes: status/clear are exactly a
versioned magic plus one 36-byte generation, while replace uses a versioned magic and three checked
`u32` lengths with an 18,488-byte aggregate cap. JSON bodies, bad magic, truncation, overflow,
trailing bytes, and oversized password/profile fields are rejected before field deserialization.
Tauri still owns the already-bounded transport `Vec<u8>` and does not zeroize that allocation; the
bridge overwrites its secret-bearing request buffer after invoke settles. The Tauri-only Supabase
backend-plugin Settings control now calls this bridge for status, replace, and clear. It derives the
current canonical generation only through the Management PAT generation resolver and tells the user
to configure that PAT when no canonical generation exists; it never invents one. The UI accepts only
the bounded direct or Supavisor-session profile fields and reads the password from the native password
input only while submitting, then clears the DOM input and local value. An `unconfirmed` receipt is
shown as a restart-and-reconciliation warning with both generations retained, disables further
mutations, and is never presented as a confirmed credential change or release authority.

The matching non-secret connection-profile contract permits only staging `direct` and
`supavisor-session` modes. Direct host and user are derived from the exact project reference;
session mode accepts only a bounded lowercase DNS name below `pooler.supabase.com`. Both modes pin
port `5432`, database `postgres`, and TLS `verify-full`; DSNs, passwords, arbitrary options, alternate
ports, transaction-pooler mode, and TLS downgrade fields are outside the schema. Strict parsing,
canonical serialization, and a SHA-256 Base64URL digest make the profile suitable for the encrypted
vault witness above. Registry consumption takes a fresh five-record snapshot by value and burns the
one-shot session unless project, account, grant generation, credential incarnation, and profile
digest all still match the retained Host evidence. The resulting owned session retains that checked
snapshot and is itself consumed by value. Its sealed Host connector receives only the validated
profile and exact zeroizing password; the caller cannot supply another identity, endpoint, option
set, or preconstructed database session. The runner derives connection identity only from retained
Host evidence and binds its result to the original request digest while keeping both authority
envelopes empty.

The dormant Rust runner now also defines an asynchronous Host-raced interruption contract. A sealed
Host interrupt source is sampled once before connect, and the kernel derives compiled-in absolute
deadlines of 5 seconds for connect and 30 seconds overall; the renderer and runner caller can neither
supply nor extend them. `connect` and every potentially blocking database stage are async and receive
the applicable immutable deadline plus cancellation signal. The kernel itself races each database
future against that signal. Deterministic tests use connect and execute futures that remain genuinely
`Pending` and prove that deadline expiry or cancellation preempts the run, rather than relying on
checks only before and after an await. For a Host timeout or cancellation after a database session
exists, the raced future is dropped before the session receives the nonblocking local
`cancel_database_request` trigger and then `abort_read_only`. Once `BEGIN` has been polled, its remote
outcome is treated as unknown until proved otherwise, so failure or interruption conservatively
aborts even when `BEGIN` never returned. Connector futures must therefore be safe to drop, must not
detach work, and must leave cancellation/transaction handles available to those nonblocking hooks.
An armed execution guard owns the database session after connect, so dropping the outer runner
future while a stage is `Pending` also drops that stage first and then performs exactly one local
`cancel_database_request` followed by `abort_read_only`; successful finish disarms the guard. The
session and connector traits require `Send` futures, a `Send` session and prepared statement, and a
`Sync` connector. A compile-time test keeps the consumed runner future `Send` for eventual Tauri
runtime integration.

This connector and interrupt-source seam still has only `#[cfg(test)]` implementations; there is no
production timer, connector, or PostgreSQL driver behind those deadlines.
The production evidence producer is deliberately not wired yet; before registration it must
atomically consume the upstream operation authority rather than trust renderer-reconstructible
digests. The injected database-session tests bind the project/account/grant/credential incarnation at
read-only begin, require local search path and local statement timeout, pass the compile-time SQL
bytes plus pinned length and SHA-256 into prepare, and let execute consume only the opaque handle
returned by that prepare. Every failure, timeout, cancellation, concurrent call, or replay burns the
kernel, and exactly one bounded non-empty response row is required. The kernel's decoded-value
aggregate bound remains defense in depth; the wire decoder separately enforces the complete request
bound before allocation-heavy schema work.

These are still contract, credential-lifecycle, decoder, Host-session, and state-machine proofs. The
main-window credential commands create no read session or execution authority. No fixed-read
execution command/capability, production connector/timer, PostgreSQL driver, socket, network request
dispatch, or server cancellation path has been registered. The deterministic Pending-future tests
therefore prove the kernel contract, not production wall-clock enforcement or cancellation of a real
server query. All server-property, production-transport, database, execution, Receipt, and release
authority claims remain false. A reproducible wire digest also does not authenticate dynamic bindings
against a genuine Host-minted operation session. The later adapter must bind the exact
project/account/grant generation and expected review digests inside the native process, resolve a
separate encrypted database-read credential, require TLS, provide a real monotonic timer, and hold an
independent PostgreSQL cancellation token. It must prove that dropping a stage future leaves no
detached work and that its local cancel/abort triggers can terminate or safely close the corresponding
server request/transaction. The production driver must enforce the row and byte caps while decoding
the protocol rather than after allocating a complete result, and the outer Tauri boundary must enforce
its body cap before command deserialization. It must use a true session connection: Supabase documents
[direct connections and Supavisor session mode](https://supabase.com/docs/guides/database/connecting-to-postgres)
for persistent/session work, while transaction-pooler mode does not support prepared statements.
Optional [temporary token-based database access](https://supabase.com/changelog/46346-feature-preview-temporary-token-based-database-access)
is project-, role-, expiry-, and platform-constrained, so this contract does not assume it as the
universal credential source.

A testing-only Receipt V2 first-page review now composes that complete reconciliation statement
with one fixed 33-parameter page query. Parameters 1–28 remain the exact hidden Receipt-zero CAS
values; the first-page suffix is `afterRevision=0` plus four null anchor fields. The query captures
the current four-field head anchor in the same statement, reads at most four canonical Receipts in
revision order, and uses a fifth key as bounded lookahead. Every managed-table reference uses
`FROM ONLY`. Its response embeds the complete reconciliation row rather than a trusted status
shortcut, so the Host reuses the established strict reconciliation parser before classifying the
page. Every revision/count field emitted as a JSON number is range-bounded and cast to PostgreSQL
`int4`; parameters and internal ledger arithmetic remain `int8`. Canonical Receipt JSON travels as
Base64 bytes, so this response has no JSON-number dependency on `bigint`.

The matching first-page response parser is also testing-only. It snapshots an exact one-row wire
shape before any await, rejects accessors, symbols, sparse arrays, custom prototypes, negative zero,
and unsupported PostgreSQL versions, then verifies canonical standard Base64, fatal UTF-8, canonical
Receipt JSON bytes, SHA-256 Receipt digests, scope digests, Receipt-zero CAS metadata, microsecond
timestamps, and every returned page link. A first page is `chain-complete` when one to four Receipts
reach the captured anchor, or `page-ready` when four Receipts are returned with a fifth key present.
For revision-one `exact-replay`, the reconciliation chain bounds remain null; only
`advanced-head` requires bounds `1..head`. A completed page also requires the final Receipt outcome
to match the live execution status. Marker drift preserves the reported diagnosis but lowers the
Host status to `precondition-failed`.

Continuation safety remains a separate boundary. The shared strict decoder handles both first and
continuation pages. A genuine `page-ready` first or continuation observation may bind the same fixed
anchor, the immediately preceding trusted page, and that page's final canonical Receipt; no response
may silently re-anchor. Each trusted continuation retains an O(1) reference to the original first-page
context rather than recursively walking or rehashing the page history. A continuation is stale only
when the live head revision moved forward. Head rollback, a same-revision event/digest/timestamp
rewrite, a missing head, or duplicate heads are corruption.

A testing-only one-shot collector now accepts an exact complete sequence of those process-local page
identities. It caps the chain at 10,000 Receipts/2,500 four-Receipt pages, rechecks the fixed anchor and
adjacent provenance, and streams every canonical page through one provider-neutral incremental
verifier before matching the final head digest. It also sums the already verified
`canonicalReceiptByteLength` values and fails closed above 655,360,000 decoded bytes. It rejects a page
sequence that is structurally valid but violates cursor, count, exhaustion, terminal, size, or other
Receipt V2 transition semantics. Its frozen result exposes only sanitized digests, counts, decoded-size
evidence, anchor metadata, outcome, and explicit authority flags; it exposes no canonical Receipt or
secret and grants no credential, transport, database, mutation, execution, Receipt, or release
authority. Inherited capture revocation before return also invalidates the collection.

The first and continuation reviews now bind one serialized-verifiable flat transport-size certificate
and an exact per-request certificate recomputed from their hidden parameter vector. The local policy
ceilings are 87,384 UTF-8 bytes per string parameter, 262,144 bytes for the compact fixed-key request,
and 32,768 bytes for request framing. A page permits at most 349,536 verified Base64 characters plus
131,072 framing bytes, for an exact 480,608-byte response ceiling; decoded canonical Receipts remain
bounded to 262,144 bytes per page and 655,360,000 bytes per complete collection. The request certificate
publishes only byte counts and SHA-256 digests, never parameter values. The raw testing wire decoder
checks the response cap before copying or parsing, uses fatal UTF-8, rejects BOM/non-compact JSON, runs
the complete strict page decoder, and derives framing from the verified Base64 character sum. The older
already-materialized object-injection seam intentionally cannot certify raw transport size or framing.
These are exact local arithmetic and decoder bounds, not evidence about an outer IPC frame, protocol
streaming, a response producer, or a real database session.

Pages still do not share one MVCC snapshot, and no production Host transport authenticates or
dispatches these queries. Cross-page head freshness, production response provenance, outer Tauri body
limits, and protocol-level streaming enforcement therefore remain unavailable.

This is not a production Apply path. The testing factory accepts only testing authority, transport,
credential issuer, and injected fetcher identities. The fixed native Desktop catalog inspector above
does not make this CAS-ledger installer or its verifier production-authoritative; there is still no
fixed native mutation composition, production verifier provenance, installed Receipt, production
source-ledger binding, or release authority. No real Supabase project was mutated by the automated tests, and the DDL must not be
copied into the SQL Editor as an approved migration. The recovery handle and final intent are still
process-local WeakMap identities. After an ambiguous final journal write/readback, the consumed
proof is not recreated from evidence bytes even in the same running controller; recovery remains
reconciliation-required and never redispatches. An attempt also cannot be reconstructed after
process restart.

The Host IndexedDB journal now upgrades to schema v3 and runs one fail-closed startup transaction
before any claim/read can reach the release controller. That transaction moves only `applied` and
`failed` records with final (or absent) bounded secret-scanned evidence into versioned
`dispatchTombstones`; a terminal record with progress-only evidence remains active until final
evidence is durable, while `pending` and `outcome-unknown` remain active and continue to hold their
provider/project mutation scope. Reads and exact claims consult the tombstone, so archival frees
active capacity without reopening a semantic release key. The active set is capped at 256 and the
tombstone set at 4,096. Unsupported shapes, orphan evidence, duplicate active/tombstone fences, or
capacity exhaustion abort and latch startup closed for that journal instance. IndexedDB supplies
atomic store commit/abort here; there is no automatic tombstone pruning or retry. These records are
audit/replay state, not an issuer: a renderer-shaped object still cannot mint the Host controller's
private dispatch or release authority.

A separate dormant Rust operation-journal kernel now proves the missing restart-safe local storage
semantics without changing that production status. It atomically replaces one bounded,
checksummed journal under a process mutex and cross-process file lock, with private file modes,
no-follow/regular-file checks, staged-file sync, atomic rename, and directory sync. Its test-only
state machine persists `claimed -> outcome-unknown -> applied|failed`, commits progress or final
evidence in the same replacement as its transition, and issues the next opaque one-shot capability
only after confirmed durability. Expiry permits recovery but never unlocks the project scope or
mints another mutation. Once dispatch may have started, only an exact positive applied observation
can settle; negative/error observations remain `outcome-unknown`, while `failed` requires a proof
that dispatch did not start. Wall and monotonic deadlines, persistent reconciliation leases, exact
record digests, and a bounded reserved/burned/active registry cover restart, replay, clock change,
collision, and concurrent-instance tests. This module registers no Tauri command or network client,
has no production trusted-plan/claim constructor, and is not connected to the fixed-read issuer.
Its local checksum is not authenticity or remote fencing: same-user deletion/rollback and the real
Supabase CAS ledger remain outside this slice.

The native envelope is now version 2 while continuing to read the strict version-1 body. On the
first process- and file-locked access after restart, it atomically moves only terminal records into
bounded tombstones that retain the complete validated record, final/progress evidence, and record
digest. Claimed and `outcome-unknown` records are never archived and keep the project scope blocked.
An exact tombstoned key can never be claimed again; a different key may reuse the scope only after
the prior record is terminal. The same 16 MiB file bound plus a 4,096-tombstone count bound apply,
and no tombstone is pruned automatically. A corrupt/over-capacity archive or unconfirmed directory
sync latches the journal instance unavailable; it does not retry, issue a capability, or infer that
the mutation scope is free. Owned stale staging files are cleaned under the journal lock, while
unrelated files are left untouched.

A further dormant native admission composition now consumes the verifier's sealed one-shot proof
and lets the journal derive, rather than accept from a caller, the exact replay key, source-ledger
scope key, and admission-plan digest. A confirmed write leaves a permanent `claimed` replay fence
for that exact signed source-ledger scope and returns only an opaque, 30-second, one-shot handoff;
expiry or drop makes the handoff unusable but never removes the durable fence. When directory sync
cannot be confirmed, no handoff is returned; a claim that is visible after the atomic rename still
blocks retry, while recovery of that permanent admission handoff remains deliberately unavailable.
Admission records are classified separately from mutation recovery, and every precommit, dispatch, settlement, and
reconstruction path positively requires the CAS-ledger-install operation kind, so an admission cannot
become database or release authority. The signed contract has no trust-root-defined monotonic
sequence, so this is exact replay protection, not a CI high-water or downgrade-order claim. The
bounded journal's startup recovery and tombstone policy do not make this admission a production
path. Production trust roots remain empty, no native expectation constructor exists, and
this composition registers no Tauri command, credential source, network client, database runner, or
mutation path.

A separate dormant native CAS-ledger-install composition now consumes only a sealed, reviewed,
secret-free install-plan proof. The journal derives the canonical plan digest, exact replay key, and
project-scoped install key internally, then may persist only a confirmed `claimed` fence and return
an opaque 30-second handoff. Production code still has no issuer for the reviewed proof and no path
from that handoff to precommit, dispatch, mutation, reconciliation, or settlement. The positive
`claimed -> outcome-unknown -> applied` flow exists only under `cfg(test)`: it requires an exact
single-marker `installed` observation bound to the same plan and current same-process verification
epoch, and only its confirmed durable settlement reports `databaseLedgerBound: true`. It never
reports source-ledger, Receipt, mutation, execution, or release authority. Malformed, secret-like,
trimmed, stale, or cross-plan inputs cannot write or settle, and source-ledger admission uses a
different operation kind so it cannot be upgraded through this path. Both kinds share bounded
256-entry persistent and runtime registries, but admission is capped at 224 occupied entries in
each, reserving 32 slots for non-admission install or recovery authority even when admission
handles or permanent fences are saturated. This is capacity isolation, not garbage collection:
terminal non-admission records can move into startup tombstones, but no automatic prune/export
authority exists and unresolved non-admission records can still exhaust the active bound. There is
now an additional `cfg(test)` composition that joins the durable installer to the fixed catalog
verifier without making either production-reachable. It accepts no caller SQL and revalidates the
byte length and SHA-256 digest of both checked-in shared SQL sources: the write side uses only the
fixed base-install bytes plus the plan-derived marker, while the read side uses only the fixed
catalog-verification bytes. Before either opaque database authority can reach its first database
callback, the journal must have durably committed `outcome-unknown`; write authority and read-only
verification authority are connected separately and cannot be substituted or cross-wired. Neither
the migration response nor reported write success can settle `applied`: only a fresh, exact
`installed` catalog readback bound to the same plan and verification epoch may do so durably. The
one-shot testing handoffs are bounded by a 25-second fused deadline inside the existing 30-second
journal settlement TTL. Expiry, drop, ambiguity, non-exact readback, or unconfirmed durability fails
closed without reopening the fence. This remains a testing-only composition: there is still no
Tauri command, real credential, authenticated Management API adapter, process-restart recovery of an
in-flight attempt, production installer/verifier provenance, execution against a real staging
project, Receipt issuance, or release authority.
Before production wiring, the operation deadline must also be derived from the journal's own
remaining settlement TTL rather than starting a second independent clock after durable precommit,
and the verified three-table owner must be bound to the expected write authority or a dedicated
`NOLOGIN` owner. The current testing-only checks deliberately do not claim either property.

A production-compiled but still dormant native locked-high-water provenance registry now replaces
the C0 module's local epoch stand-in. Production can create only an empty registry: the sole raw
material insertion method remains under `cfg(test)`, and there is no renderer decoder, Tauri
command, managed state, credential source, database connector, SQL runner, or network transport.
Each test proof is an opaque non-cloneable handle bound to a random issuer id, monotonic generation,
and exact capture digest. A bounded 32-entry `active + burned` registry enforces signed source-scope
single flight for a 30-second monotonic TTL; consume, drop, and expiry burn the entry, generation
checks prevent stale-id ABA from consuming a replacement, and concurrent consumers have exactly one
winner. TTL samples occur only after the registry lock is acquired, backwards clocks fail closed,
and registry locks never cross database or network work.

The retained secret-free material now covers the signed source-ledger grant identifier plus the
read/install-write/capture-write credential generations, signed source scope,
provider/application/migration/source-ledger bindings, distinct signed source-ledger and Compiler
backfill-inspection subject digests, installed
plan and marker verification, capture review/catalog/query digests, exact physical address, locked
query/transaction settings, and high-water counts. Validation aligns the capture summary with the
TypeScript contract: non-empty tables require both cursors, empty tables require neither, the row
count must fit the cursor span, the declared cursor maximum is exactly `Number.MAX_SAFE_INTEGER`,
batch size remains within the Compiler's `1..=1000` range, the maximum batch Receipt count is
exactly `9999`, unsafe cursors remain zero, batch receipts equal `ceil(total / batchSize)`, numbers
remain JavaScript-safe, and `observedAt` must be a real canonical UTC calendar timestamp. This does
not authenticate caller-supplied material in production. The
future native transport must construct the observation from its fixed result decoder, bind the
capture-write credential incarnation or equivalent transport authority, and recompute the canonical
capture digest internally; a shaped test digest is not provenance. The source-ledger grant follows
the signed receipt's bounded release-identifier grammar, while the three Host credential
incarnations remain pairwise-distinct canonical UUIDv4 values. The locked capture timestamp must be
equal to or later than the installed-catalog observation; both remain independent snapshots, but a
capture cannot causally precede the prerequisite installation proof.

An additional C0 proof-composition test module now checks that the durable source-ledger admission,
the test-only durably Applied CAS-ledger observation, an independent opaque Compiler
backfill-inspection-subject proof, and the native-registry locked-high-water proof all describe the
same provider, environment, project, account, grants, application, migration, source ledger and
signed scope, install plan, marker, installed verification, and compatible server version. The
signed source-ledger subject digest and Compiler inspection-subject digest are separate bindings and
cannot be substituted for one another. The inspection proof also binds the migration-plan digest,
table/cursor/target fields, exact cursor maximum, batch size, and maximum batch Receipt count. It
consumes the source, installed-observation, and inspection handoffs by value, performs a non-consuming
registry inspection of the capture, and rejects stale registries and cross-domain substitutions. It
then projects all four complete secret-free subjects into journal-owned canonical material. The
same claim now also binds the fixed Receipt-zero transaction identity, exact ordered 28 typed
parameters, canonical padded-Base64 scope and candidate Receipt bytes, and their independently
recomputed SQL, schema, parameter, scope, resource, and Receipt digests. The canonical scope and
embedded Receipt are cross-checked against the source, installation, inspection, and locked-capture
subjects before the plan digest is derived. Logical `entityId` remains distinct from the physical
table name; a future production issuer must obtain it from the trusted V2 review context rather than
caller data. A detached transaction object cannot replace the copy retained by the opaque claim. The
testing-only initializer operation persists only its canonical plan digest and a project-level
`providerId + projectRef` stable scope, and returns a non-cloneable inert durable-claim handle only
after the `Claimed` fence is confirmed. The consumed source-admission and installed-CAS handoffs must
also belong to the exact same opaque process-local journal authority that receives this claim; a
same-shaped handoff from another store cannot be rebound. On reopen, the journal rederives the
single-flight key from the plan digest and the stable-scope key from provider/project, so replacing
either key and recalculating the unkeyed file checksum is classified as corruption. `captureConsumed`
is therefore false: the sealed capture stays inside the handle so a future precommit can consume it
immediately beside the database transaction.
A checked-in, strict JSON golden fixture is now consumed by both Bun and native Rust tests. It pins
the recursively ASCII-key-sorted canonical material, exact domain-plus-NUL hashing, plan digest,
single-flight key, and project scope key for the same four prerequisite subjects. Per-domain
mutations change the plan and single-flight identity without widening the stable project scope, and
the fixture explicitly keeps `captureConsumed` false; it carries no SQL text, URL, credential,
precommit, or execution authority. The Bun side calls the shared `canonicalManifestJSON` encoder
rather than a test-local copy, and every JSON integer—including the source `runAttempt`—must be a
positive JavaScript-safe integer where applicable.
The same full material model, validator, and private canonical identity derivation now compile in
production as pure data processing. Production does not compile deserialization for these material
types, does not construct a `TrustedOperationPlanV1`, and still exposes no initializer claim,
precommit, database, network, or dispatch entrypoint; only tests may convert the validated identity
into a journal plan.
A second checked-in golden fixture now pins the complete Compiler-produced Supabase backfill
inspection envelope, its recursive ASCII-key canonical SHA-256 digest, and the exact 14-field C0
projection. The native mirror rejects unknown or non-canonical JSON, unsafe numbers, secret-like
material, authority-bearing flags, foreign built-in identities, altered artifact paths, and invalid
migration markers or limits. A second real Compiler vector pins a finite-float target with no
matched-row minimum, including ECMAScript number formatting at the Rust boundary. In particular,
`migrationPlanDigest` comes from the emitted migration plan artifact rather than the Provider plan or
adapter-plan digest. A production-compiled bounded
registry turns that validated projection into an opaque, scoped, one-shot handoff, and C0 now has to
consume the inspection proof through the issuing registry instead of constructing a local stand-in.
Production can still create only an empty registry from every reachable caller. Raw-envelope and
projection issuers remain under `cfg(test)`; the sole production-compiled issuer is private to the
Compiler sidecar module and accepts only its non-cloneable, non-serializable strict-decoder result.
A self-consistent subject digest is therefore compatibility evidence, not provenance or execution
authority; a future caller must reach that issuer only through the trusted native Compiler/Host
reconstruction boundary and compare it with retained package, plan, application, and emission
authority.

That reconstruction boundary now has a canonical Compiler wire, an isolated pure sidecar runtime,
and a dormant native runner kernel. Apart from the protocol version, the request contains exactly the
normalized Backend V2 application, the React/Vue target, and a Host nonce; it cannot carry a Provider
selection, compilation mode, SQL, credential, or execution instruction. The domain-separated
request digest covers the canonical version, target, and application while deliberately excluding
the nonce, but both the process response and the nested Compiler response must bind that same
validated nonce. The response also carries a fixed Compiler-only trust digest for the reviewed
descriptor and trust profile. That digest is not an app-bundle digest, installed-package evidence,
publisher provenance, a signature over a binary, or permission to populate the native inspection
registry.

The `@open-pencil/backend-compiler-sidecar` runtime pins the built-in Supabase V2 registry and its
fixed Compiler selection, and always plans in `production` mode. It accepts exactly one canonical
JSON request terminated by one LF, returns exactly one canonical JSON response terminated by one LF,
keeps stderr empty, and reports only its enumerated static failure codes. Its planning path reads no
ambient environment or filesystem, performs no network or SQL operation, resolves no credential,
and creates no database-write, execution, Receipt, or release authority. The private Rust decoder
constructs the request from a Host-owned canonical application plus target and nonce, then strictly
checks the outer process envelope, nested Compiler envelope, exit-status/stderr contract,
nonce/request-digest binding, and the complete fixed Compiler, Provider, application, target, and
mode bindings before reusing the full Subject validator. A checked-in cross-language fixture binds
the TypeScript producer to that native decoder. On Unix, the private Rust runner can copy only an
already-opened, pin-verified binary into a fresh directory below an opaque Host-owned `0700` runtime
root, sync and rehash those bytes, close the writable handle, reopen the `0500` snapshot read-only
with `O_NOFOLLOW`, and revalidate its file identity before spawning it. The child receives zero
arguments, a cleared and fixed minimal environment, a private working directory, one bounded request
frame, concurrently bounded output pipes, and a 30-second monotonic deadline. Timeout, output
overflow, thread-creation failure, or a descendant retaining a pipe triggers cancellable pipe
shutdown plus a bounded Unix process-group kill and reap. The strict decoder still runs before the
private issuer can create a scoped one-shot registry proof; failure leaves no active scope. The same
opaque runtime-root capability owns a fail-closed, pre-snapshot single-flight admission. It is
acquired before any snapshot, copy, or spawn and held through registry issuance; its RAII guard
releases on success, decoder rejection, timeout, cleanup failure, registry collision, or panic. This
bound is per Host capability rather than a renderer-visible or process-global semaphore. There is
still no production caller or runtime-root constructor. Path-based execution does not defend against
a compromised same-UID process replacing the private snapshot, and a malicious descendant may
escape the process group with `setsid`; both remain explicit OS sandbox/post-sign packaging gates.
Non-Unix execution is unavailable until an equivalent Windows Job Object and private-directory
boundary exists.

Candidate-only tooling now builds each declared platform executable with Bun's ambient config and
dotenv autoload disabled. It emits an exact ten-field canonical provenance manifest containing the
target, exact name, byte length, executable-format check, and SHA-256 digest while keeping release,
execution, and registry-issuer authority false. A target-scoped exclusive lock, private staging
directory, file sync, supported-host directory sync, and manifest-last commit marker make an
interrupted publication fail closed. Windows explicitly records the weaker
`manifest-digest-fail-closed` durability mode because Node/Bun exposes no portable directory-flush
primitive there; it does not claim crash-durable availability. The host-target smoke copies the verified candidate into a private snapshot, rehashes those
copied bytes against the manifest, and executes only that snapshot. This smoke path is build
verification, not the Desktop production runner.
The release build matrix runs the candidate build and independent `--verify-only` check for every
declared desktop target, then runs the protocol smoke only on the matching native runner. It does
not set the pin-manifest environment variable, add the candidate to Tauri `externalBin`, or turn
candidate provenance into packaged release authority.

`desktop/build.rs` accepts a candidate manifest only through the explicit
`OPENPENCIL_BACKEND_COMPILER_SIDECAR_PIN_MANIFEST` build environment variable, revalidates its
sibling binary for Cargo's exact target, and otherwise compiles an `Unavailable` pin. The private
Rust verifier rechecks an exact absolute candidate path, file identity, header, length, and digest,
then retains an open file in a non-serializable, non-cloneable opaque token whose authority flags all
remain false. The runner has no production caller, and the Host-owned runtime-root capability has no
production constructor. There is still no production candidate locator or issuer caller, Tauri
command, renderer capability, or database authority.

This remains a P1 integration gate rather than a reachable production Inspector. The private
sidecar package is now enrolled in the root workspace, lockfile, package build/typecheck, type-aware
lint, formatting, compiler unit-test shard, and coverage selection. Binary construction and smoke
remain explicit commands and do not run during an ordinary package build or quick test. The
candidate manifest is not signed release provenance, installed-package evidence, codesign,
notarization, Authenticode, or a digest of the final packaged bytes; signing may change those bytes.
There is also no Tauri `externalBin` entry. A future process launcher must be native and
Host-internal: this Backend Compiler sidecar must never be exposed to the renderer through
`shell:allow-spawn` or a renderer command allowlist. Production still requires post-sign
packaged-byte provenance, a reviewed packaged-candidate locator and Host runtime-root constructor,
a capability-gated production caller for the sealed private issuer, genuine source/install-ledger observation provenance,
a trusted locked-high-water producer, a reviewed production initializer constructor and journal
precommit, a certified database adapter for the compiled SERIALIZABLE runner, reconciliation, and
the bounded mutation runner.

The two database observations deliberately retain distinct
`observedAt` and `snapshotMarker` values because installation verification and locked capture are
separate transactions. The C0 composition remains registered only under `cfg(test)`, while the
capture registry itself is production-compiled with no production population path. Consuming these
three test handoffs burns their process-local one-shot entries. Dropping or expiring the claim handle
does not remove the durable fence; a directory-sync failure is treated as durability-unconfirmed and
leaves a fail-closed orphan `Claimed` record rather than deleting or retrying it. Exact replay and any
other unresolved initializer in the same project are blocked, and an unresolved CAS-ledger install
conflicts in both directions, while the prerequisite source admission may coexist. The C0 handoff
itself has no production-reachable initializer precommit, dispatch, settlement, or fixed-read
reconciliation capability. Every database, mutation, execution, Receipt, retry, request-dispatch,
and release flag remains false.

The Receipt-zero initializer now also production-compiles a private, unreachable precommit and
runner contract. It consumes and pins the exact shared checked-in CAS SQL artifact bytes, validates
the ordered 28-position PostgreSQL parameter schema and canonical encodings, and fixes one
`SERIALIZABLE READ WRITE` transaction with `pg_catalog` search path, `row_security=off`, 15-second
statement timeout, 5-second lock timeout, `synchronous_commit=on`, one prepared statement, one
response row of at most 64 bytes, and a 25-second fused Host deadline. The fixed SQL independently
requires `current_setting('synchronous_commit') = 'on'` inside its runtime guard, so an adapter cannot
silently omit or weaken the runner's fixed `SET LOCAL` stage. Only `inserted` and `exact-replay`
reach commit; `advanced-head`, `corruption`, `precondition-failed`, malformed responses,
cancellation, timeout, and stage errors fail closed. A successful commit ACK still yields only an
outcome that requires an independent fixed read-only reconciliation; it cannot authorize journal
`Applied`, Receipt issuance, settlement, or release. Once commit has been dispatched, an ambiguous
I/O result, cancellation, timeout, or dropped future triggers neither cancel/abort nor automatic
retry. The one-shot runner and its cleanup guard are exercised only by a deterministic fake session,
including every stage failure and pending-future drop.

The journal now also has an initializer-specific, testing-only B2a precommit and restart kernel.
Before creating `Claimed`, it preflights the exact future progress evidence. `Claimed` still stores
only the canonical plan digest and stable identity. A confirmed precommit advances only that exact
record to revision-two `OutcomeUnknown` and persists the complete validated, secret-free initializer
material as recursively canonical JSON encoded into fixed 2,048-byte Standard Base64 chunks. Base64
is an encoding, not encryption. Canonical material is capped at 512 KiB, which yields at most 699,052
encoded bytes and 342 chunks; the global 2,048-byte string, 1 MiB evidence, 16,384-node, depth-32,
and 16 MiB journal limits are unchanged. Restart first revalidates the evidence checksum and global
bounds, then the exact chunk shape, canonical Base64, decoded length and digest, strict typed JSON,
canonical reserialization, complete material invariants, and every rederived plan/scope identity.
Only after the later of the original claim lease and the transition plus 30-second quiet period may
it return an inert, opaque recovery handle.

The testing-only B2b layer now gives that recovery handle an initializer-specific 60-second durable
reconciliation lease. Begin persists a monotonically increasing generation, a domain-separated
authority digest, fixed issue/expiry timestamps, and `consumed: false`; it publishes no opaque
permit until durability is confirmed. Consume must match that exact journal record and runtime
permit, persists `consumed: true`, and publishes no read attempt until that replacement is also
durability-confirmed. An active unconsumed or consumed lease blocks restart reconstruction; only an
expired lease can advance to the next generation. Directory-sync uncertainty may therefore leave
either durable form visible while returning no capability, and it never authorizes automatic
retry.

B2b deliberately exposes two distinct, inert, non-serializable testing handles rather than one
interchangeable runner token. The live precommit lineage has exactly a 25-second window, while a
restart reconciliation read has exactly 30 seconds inside the original 60-second durable lease.
Both require the complete wall-clock and monotonic runway from the same `JournalClock`, sampled
again after persistence and after acquiring the final runtime lock. Slow filesystem work or lock
contention consumes the existing runway and can only reject issuance; it cannot renew either
deadline. The initializer kind remains excluded from every generic dispatch, recovery, settlement,
and terminal-transition API. The B2b constructors themselves create no database consumer,
credential lease, authenticated observation, mutation, settlement, Receipt, or release authority.

The testing-only B3a composition now closes the local capture-to-journal handoff without making the
database runner reachable. Its first journal phase burns the original claim and, under the final
store/file lock, constructs, validates, exactly serializes, and size-checks revision-two
`OutcomeUnknown`. Only confirmed file replacement plus directory sync returns an opaque staged
token; that token is bound to the same journal instance, capability id, record digest and revision,
original dual-clock ceilings, complete initializer material, and capture digest. The proof
composition then consumes the sealed locked-high-water capture exactly once, projects every
captured field back to the journal-owned material, and requires exact equality. Publish reopens the
store, requires that exact `OutcomeUnknown` record with no final evidence or reconciliation lease,
and only then performs the final same-clock check under the runtime lock before inserting the inert
dispatch permit. The resulting proof-level wrapper is private and does not expose its inner journal
dispatch handle. The B3b path described below accepts only that fused wrapper, never the older bare
testing dispatch handle which does not prove capture consumption.

The testing-only B3b composition now consumes that complete private wrapper by value. Constructing
its future has zero journal or connector side effects. On the first poll it samples an opaque
connector-clock anchor, revalidates the complete journal material including the canonical parameter
values digest, rebuilds the exact 28 typed values from the static parameter schema plus the durable
source, capture, and transaction fields, then consumes the dispatch, issues the live window, and
finally consumes that window after re-reading the exact revision-two `OutcomeUnknown` record. The
final journal check requires no final evidence or reconciliation lease and consumes the exact
runtime attempt under its last dual-clock sample. No file, journal, or runtime lock crosses the
asynchronous boundary, and the sealed lazy connector is polled immediately after this synchronous
prefix with no intervening await.

One fused 25-second ceiling covers connect, transaction setup, prepare, execute, and commit. Its
external deadline is the earlier of the original connector anchor plus 25 seconds and the current
connector time plus the journal's one-shot remaining duration, so synchronous prefix work is
deducted once rather than twice. Every stage poll checks cancellation, external clock rollback,
external deadline, and the still-live wall/monotonic journal ceiling. The precommit-owned testing
connector accepts no caller endpoint, TLS mode, credential, SQL, parameters, timeout, prebuilt
session, or cancellation task. The proof layer can select only bounded test outcomes and observe a
diagnostic stage/deadline trace; it cannot control the deadline or obtain the raw session contract.

All six SQL identifier positions (`executionId`, `applicationId`, `migrationId`, `eventId`,
`receiptId`, and `idempotencyKey`) now share the fixed precommit grammar before the durable claim:
1–128 bytes, ASCII alphanumeric first, then only ASCII alphanumeric, dot, underscore, colon, or
hyphen. The Host review mirrors the same early constraint. This closes the prior case where a
portable 256-byte or slash/at-sign identifier could pass review, consume the capture, and wedge the
durable record before the fixed runner rejected it.

Commit ACK, a definitive commit rejection, and an ambiguous commit result all produce only the
private, non-cloneable, non-serializable
`DurableReceiptZeroInitializerNeedsIndependentReadV1`. The journal remains `OutcomeUnknown`; every
database, settlement, Receipt V2, retry, and release authority flag remains false. A failure before
commit returns no successor authority, also remains `OutcomeUnknown`, and cannot reuse the consumed
writer lineage. B3b deliberately adds no B3c readback, `Applied` transition, Receipt V2 issuer,
settlement, or release path.

Every post-stage failure stays conservatively `OutcomeUnknown`: capture loss, comparison failure,
clock exhaustion, record drift, or publication failure neither restores the capture nor remints a
writer. Unconfirmed directory durability returns no staged token or permit. The earlier deterministic
pre-persist `Full` behavior is intentionally unchanged: the transient claim is burned and a durable
`Claimed` repair wedge may remain; there is no `Deferred` retry surface yet. This is fail closed but
is still an operator-repair and capacity-reservation debt.

Durability remains fail closed. If directory sync is unconfirmed, the renamed
`OutcomeUnknown` record may be recovered after restart, but no dispatch handle is returned. If the
journal becomes too full between claim and precommit, or precommit fails before
`OutcomeUnknown` is persisted, the transient claim authority is burned and the unchanged durable
`Claimed` fence remains blocked with no restart path. No automatic write or retry is allowed. A later
slice must add a trusted known-not-dispatched/`Claimed` recovery gate (or durable capacity
reservation), plus observation and operator repair. Initializer records are not yet included in the
generic unresolved-operation listing.

This static contract creates no production live authority. Its initializer claim, precommit,
dispatch-handoff, restart, B2b lease, fixed-window constructors, sealed connector harness, and B3b
composition remain test-gated. There is no production capture consumer, credential lease, database
adapter, certified server cancellation, trusted
commit-time source, authenticated response, Receipt V2 issuer, production reconciliation or
settlement path, production caller, Tauri command, network call, registry wiring, or release
authority. Production still requires each reviewed bridge before this compiled shape may receive a
database session or execute the mutating statement. Because recovery chunks intentionally hide the
inner free text from the generic evidence scanner, the production issuer must retain sealed
provenance and keep the strong decoded-material secret checks enforced before this path becomes
reachable. The testing-only fused runner now revalidates the exact durable record and both-clock
freshness immediately before its first database poll and routes commit ACK only to a private
independent-read handoff; production still lacks the reviewed adapter and caller for that boundary.
Commit acknowledgement alone must never settle the journal or issue Receipt V2. B3b also does not
close the production database TOCTOU: the application-table lock
used by locked-high-water capture is released when that capture transaction commits, and the fixed
28-parameter ledger statement does not relock or fully re-inspect the application table. Production
must either retain the same live transaction/session through the CAS step or add a reviewed fixed
CAS statement which reacquires and verifies the complete barrier/catalog state. The deterministic
pre-persist `Full`/orphan-`Claimed` wedge also remains, and parameter 21's candidate commit time,
parameter 25's request digest, plus parameter 28's operation-evidence digest remain untrusted inputs
rather than release evidence; no canonical trusted request provenance independently authenticates
parameter 25 yet.

A separate testing-only Automation CAS reconciliation review now reuses the mutating review's exact
immutable 27-value snapshot and lowers it to one fixed 72,823-byte `SELECT`. The template has one
compiler-owned 20-character application-key substitution, 17 schema occurrences, exact PostgreSQL
casts in parameter order, no DML, DDL, `CALL`, row lock, caller SQL, or caller schema. One
read-only transaction must establish `pg_catalog` search path, `row_security=off`, a bounded
statement timeout, the dedicated `supabase_read_only_user`, and one primary PostgreSQL 15–17
snapshot. The query gates managed-row reads behind the complete catalog/runtime/input checks, reads
the head at most twice and revisions at most 1,026 times, and returns one non-null text JSON column
bounded to 128 KiB. Its compact facts classify only `absent`, `exact-replay`, `advanced-head`,
`cas-conflict`, `corruption`, or `precondition-failed`.

The testing Host parser accepts exactly one row and one text column, rejects duplicate or additional
JSON keys, verifies all 26 typed fields, rebinds the proposal, record, query, SQL, parameter, and
schema-marker digests, checks count/overflow and gate-false relations, and independently recomputes
the six-state truth table. A reported status is only a cross-check. `absent` never proves that a
previous mutation request stopped, and `advanced-head` proves only the observed relational chain;
neither state authenticates a specific database or permits retry. Timeout, cancellation, protocol,
shape, UTF-8, JSON, and database failures remain indeterminate and fail closed.

The same raw SQL is pinned in a private, production-unreachable native reconciliation kernel. Its
test-only issuer reconstructs the fixed statement internally, independently validates the canonical
proposal/record bytes and all 27 typed cross-field bindings, streams exactly one declared-length
response through a 128 KiB sink, parses the exact observation, and burns after one run. It fixes
`BEGIN READ ONLY`, session hardening, prepare/execute/finish order, and cancel-then-abort only while a
request remains pending. Any row, column, chunk, or declared-length protocol violation permanently
poisons the sink, so a future adapter cannot suppress a callback error and later complete it. There
is also an independent native canonical anchor for the exact parameter-schema and reconciliation-
query digests; recovery recomputes the application-scoped mutating SQL digest and rejects any
shape-valid substitute before a database callback can run. There
is still no credential source, live database adapter, production
constructor/caller, Tauri command, journal settlement, authenticated readback, Receipt issuer,
retry, mutation, or release authority.

A sealed, testing-only recovery admission now gives this kernel a distinct operation-journal kind
without making it reachable from production. Before the simulated dispatch boundary, typed progress
evidence durably retains the complete secret-free 27-value material, including both grant
generations, credential and installation incarnation digests, the immutable review/query/SQL/schema
bindings, and the exact canonical parameter snapshot. Canonical proposal/record JSON is capped at
1,536 decoded bytes so its standard Base64 form fits the journal's 2,048-byte per-string bound, and
the exact progress payload is preflighted against all journal evidence limits before any durable
claim is created. After restart, recovery waits for the
five-minute claim high-water and reconstructs authority only from the exact journal-owned record and
that evidence; callers cannot replace or rebuild the material. The journal then persists an
Automation-specific 60-second, single-use reconciliation lease—binding its generation and authority
digest—and marks it consumed before issuing the fixed-read attempt. This deliberately exceeds the
runner's 30-second overall deadline without expanding other journal capability lifetimes. Another
attempt for the same database-head scope is rejected, while drop or expiry leaves the durable
`OutcomeUnknown` fence in place.

A test-only fused composition now accepts only that opaque recovery handle by value. Creating its
future performs no transition; the first poll synchronously performs begin, durable consume,
material revalidation, exact 27-parameter/review derivation, and immediately polls the fixed runner.
It holds the consumed attempt until the runner returns or the future is dropped and never returns
journal observation authority. Tests prove unpolled drop has zero database/cancel/abort effects,
expiry and unconfirmed durability fail before the database, pending drop cancels then aborts, the
first database callback sees the durable consumed lease, and all six raw states leave the journal
`OutcomeUnknown` with no final evidence. This 60-second testing lease is not yet production-grade
strict single-flight: OS suspension can outlive it, and the injected timer/database adapter is not
bound to authenticated project, credential, or installation authority.

This recovery path intentionally has no settlement API. Every current reconciliation observation is
unauthenticated, so raw `exact-replay`, `advanced-head`, `absent`, conflict, corruption,
precondition, or error results cannot resolve the original operation. In particular, `absent` is
never evidence that a prior mutation did not run. The recovered attempt grants no credential,
network, Tauri, database-adapter, automatic-retry, Receipt V2, mutation, or release authority; those
remain separately reviewed production blockers.

A fixed single-statement, catalog-only Host verifier and its operation-scoped Management transport
can now classify the exact schema as `absent`, `installed`, or `mismatch`. Verification binds the
review/query/project/account/grant digests and requires one primary database snapshot. It accepts
only matching current/session `supabase_read_only_user` roles that are non-superuser, distinct from
every ledger owner, and running with the exact `pg_catalog, public` effective search path. The same
snapshot must also prove both current/session roles have `BYPASSRLS` and immediate `USAGE` of
`pg_read_all_data`; membership alone is insufficient because it may not be inherited. Otherwise
verification is unavailable. This matches Supabase's current hosted
[read-only query role](https://supabase.com/docs/guides/platform/access-control) and fails closed if a
self-hosted or future platform role differs. PostgreSQL defines role `USAGE` as privileges that are
[immediately available](https://www.postgresql.org/docs/17/functions-info.html), without `SET ROLE`.
`transaction_read_only` remains observed evidence rather than a promise made by the endpoint. Exact
catalog comparison rejects partial shape; non-owner schema,
table, column, or owner-default ACLs; owner-role membership; RLS/policy drift; user rules; unsupported
constraints such as `EXCLUDE`; unexpected indexes/triggers; disabled FK constraint triggers;
unlogged/partitioned/inherited tables; replica-identity or dropped-column history; publication
exposure; column type-modifier or collation drift; and unhealthy constraint-backed indexes. It
also binds every primary/unique/FK constraint to the exact normalized btree index identity, table,
ordered key/include fields, operator classes, index options, collation semantics, and health flags;
the three FKs name their exact referenced supporting indexes and bind all three PostgreSQL equality
operator arrays by schema, name, and operand types without retaining cluster-local OIDs. The Host
result freezes the observed and expected column/constraint fingerprint digests into the final
verification digest, so a future controller can bind exact semantics rather than a health boolean.
It neither reads ledger or application rows nor installs DDL, and it still creates no mutation,
execution, Receipt, or release authority.
The same snapshot returns only a strictly parsed marker comment from that designated constraint and
the schema-wide count of install-marker-prefixed constraint comments. Arbitrary raw comments are
rejected. Missing, different, duplicated, or misplaced markers remain evidence for a future journal
controller; they do not change the structural meaning of `verifiedInstalled` and never grant install
or mutation authority by themselves.

The verifier proof by itself still creates neither a Receipt nor execution, database-ledger,
production source-ledger, or release authority. The testing controller can durably recognize one exact
installation, but that capability is deliberately isolated from future production consumers. The
official migration endpoint returns 200 with an empty JSON object, so installed catalog readback—not
the POST response—is the authority boundary. Real-project execution, process-restart reconstruction
of the mutation attempt, a production-wired fixed native installer/verifier composition, and production-only verifier
provenance remain explicit release gates. Table
locking also cannot prevent an independently authorized `nextval`/`setval`. Receipt V2 now models
deletion-safe terminal exhaustion and the DDL review fixes the intended ledger shape, but no
production database transaction yet initializes or persists the CAS chain; cursor/sequence mutation
authority and its database-backed realization remain unresolved. The candidate Provider/Compiler
path is therefore unchanged and continues to carry its static high-water/runner blockers.

P2 now includes review-only Queue/Cron, idempotency-ledger, transactional-Outbox, and
operational-event-sink schema artifacts plus pure retry-disposition, immutable idempotency-CAS,
Queue Worker/transactional-Outbox handoffs, operational-event sink-CAS, and Webhook
endpoint/HMAC-subject contracts. Separate testing-only fixed Supabase Automation idempotency-CAS
mutation and read-only reconciliation reviews, strict response parsers, and dormant
production-unreachable native runner contracts are also present. It still does **not** implement
exclusive atomic write authority, an executable receipt-driven backfill, a production Host queue worker or Cron
job, Webhook network transport, authenticated database CAS/outbox/sink execution, or monitoring
drain. The remaining Provider
work follows in bounded slices: real-staging certification of locked capture, a production-wired
fixed native CAS-ledger installation/verifier composition, capture-receipt CAS persistence, and the
bounded Receipt V2 runner;
an authenticated Automation CAS database adapter, journal precommit, and production binding of the fixed
read-only reconciliation;
authenticated private Queue/Outbox execution with idempotency/retry/DLQ; signed webhook intake; then drift
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
[publication table view](https://www.postgresql.org/docs/15/view-pg-publication-tables.html),
[Queues](https://supabase.com/docs/guides/queues), [Cron](https://supabase.com/docs/guides/cron),
and [Database Webhooks](https://supabase.com/docs/guides/database/webhooks) boundaries.

The first resumable backfill subset intentionally uses only a non-null, single-field integer identity
primary key that the Provider proves is immutable and append-monotonic. Source IR names that cursor
but does not contain an environment-specific high-water value. Each environment captures its own
high water in a Host/CAS-bound receipt chain whose scope also binds provider, authority, application,
migration, source ledger, physical resource identity, and batch size. The testing-only collector now
verifies the portable semantics and deletion-safe terminal-exhaustion rule of an injected page chain,
but the current Provider review package does not yet persist or authenticate that authority chain.
Similarly, primary-key idempotency for data-change automations is restricted to
insert events; update and delete require a future Provider-issued immutable event identifier.

## Manual and live gates

The Receipt-zero native independent-read contract now has a private fixed runner and a **test-only
fused recovery composition**. This does not complete production B3c. The contract pins the exact
checked-in reconciliation SQL (115,192 bytes and SHA-256),
shares the writer's complete journal-material validation and 28-position parameter projection, and
accepts exactly one ordered row of 29 typed PostgreSQL text-protocol columns. Its bounded scalar
sink rejects wrong names/types, duplicate or extra columns/rows, invalid UTF-8, noncanonical integer
or boolean representations, illegal NULLs, and oversized cells before allocation. A callback error
permanently poisons the sink. Native code recomputes all five relational states and cross-checks the
reported status; historical-marker drift or an observed read-write transaction lowers the result to
`precondition-failed`. The scalar transcript digest is domain-separated and is not the Management
parser's canonical-JSON response digest.

The recovery future is inert until its first poll, which fixes a 30-second overall deadline before
journal work. It consumes an opaque recovery handle, persists and consumes the 60-second
reconciliation lease, derives all 28 parameters exclusively from journal-owned material, and
consumes the single-use read window. Admission binds the same journal instance, exact durable
record and material, lease generation, and authority digest. A distinct read-only execution ceiling
projects the remaining budget once and retains the original journal wall and monotonic clocks for
freshness checks throughout execution; neither the journal prefix nor any database stage refreshes
the deadline. An independently owned sealed connector then follows eight fixed stages: Connect,
BeginReadOnly, SearchPath (`pg_catalog`), RowSecurity (`off`), StatementTimeout (15,000 ms), Prepare,
Execute, and FinishReadOnly (`ROLLBACK`). Pending connect cancellation/drop only cancels the
connection attempt; a pending session request is cancelled before aborting the transaction.
Completed failures do not receive a late cancel. The final freshness check runs after
`ROLLBACK`, and the returned observation carries no settlement or release authority. Success, error,
expiry, and drop retain the original `OutcomeUnknown` fence.

The current local regression snapshot is 105 passing native `receipt_zero` tests, including 14
scalar-contract tests, nine fixed-runner tests, and nine fused-recovery tests. The separately run
native journal module passes 86 tests, including eight B3c execution/instance-binding regressions;
these filters overlap and must not be added together. The three selected Host journal/staging
release/verification files pass 32 tests. The non-test native library passes offline `cargo check`,
the scoped secret scan is clean, and documentation integrity checks pass. `bun run check` completed
the package builds but stopped at existing repository-wide structural lint findings: 32 errors and
116 warnings. The full check is therefore not green. These deterministic fixtures exercise local
journal persistence, injected clocks, and fake connectors; they do not certify a live database.

There is still no production constructor or connector, credential/endpoint source, authenticated
project/account/grant or installation authority, production active timer, certified server
cancellation, or authenticated settlement path. The local poll-time deadline and cleanup checks do
not prove that a real pending server request wakes or stops on time. Raw observations cannot settle
the journal, allow automatic retry, issue Receipt V2, or authorize release. In particular, `absent`
never proves the old mutation stopped, and `advanced-head` still lacks full portable Receipt V2 chain
verification. These production bindings and live checks remain separate gates after this local B3c
composition.

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
