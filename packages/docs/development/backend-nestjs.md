---
title: NestJS Backend Provider
description: Generate an editable NestJS and PostgreSQL HTTP service with explicit owner, role, and public-read policies from Backend IR.
---

# NestJS Backend Provider

For the single-product checkout example, atomic stock updates and idempotent retries, see
[Atomic Backend commands](./backend-commands.md).

The built-in `open-pencil.nestjs-backend` provider generates a standalone NestJS project under
`backend/nestjs/`, alongside React or Vue frontend sources. It uses Backend Application V1 and the
[HTTP API contract](./backend-http-api.md). The provider is registered in both the trusted Compiler
registry and the App's installed-package compatibility registry.

The preset implements owner CRUD, explicit public reads and JWT role access. Its generated Controller, Service, DTO,
JWT guard, PostgreSQL connection pool, API client, OpenAPI description, initial SQL and dependency
lockfile are editable source. Generation does not start the server, run migrations or deploy it.

## Experimental Prisma 8 CRM export

An opt-in **NestJS + Prisma 8 CRM (Experimental)** plugin provides a separate source-export
provider. The default NestJS provider continues to use `pg` and supports its existing preview modes.

1. In **Settings → Plugins → Browse**, install and enable the experimental Prisma CRM plugin.
2. Create the **Customer CRM** starter through the Backend library using the regular NestJS provider.
3. In the Backend editor, select **NestJS + Prisma 8 CRM (Experimental)** and save the Backend draft.
4. Export a React or Vue source project. In its `backend/nestjs` directory, use Node **24.19**,
   run `npm ci --ignore-scripts`, then `npm run build`.

The exported build runs the pinned local Prisma CLI to emit its query contract and types.
It does not connect to a database or apply migrations. The current pins are `prisma` CLI
`8.0.0-rc.15`, `@prisma/orm-postgres` `8.0.0-rc.11`, and `pg` `8.22.0`.
Minimum runtime is Node 22.18 or 24.11; Node 24.19 is the verified version.

Customer list/detail, filters, literal substring search and microsecond-precision pagination use
Prisma. User/profile/history reads and all business commands retain `pg`, sharing the same pool.
Customer reassignment, current-assignee/manager authorization, row locks, idempotency and audit
history keep their existing server behavior.

This first version accepts the reviewed three-entity CRM field/enum/key layout and the exact
customer read authority. Custom customer fields, broader/conditional policies, tenant partitions
and composed modules are rejected with a compatibility diagnostic. Switch back to the regular
NestJS provider when working outside that profile.

`migrations/001-initial.sql` remains the schema owner. The Prisma contract omits SQL-owned
secondary indexes and must not be used to initialize, update or migrate a database with Prisma.
The ORM's disabled marker verification is not proof that a database matches the contract.

The standalone local application runner remains available after export. This experimental provider
supports neither External nor Managed editor preview; its compatibility handshake is disabled.
Real OIDC login, platform behavior and production deployment remain separate verification steps.

## Supported application

Every entity must be managed and have a single, non-null UUID primary key with a generated UUID
default. Each entity has exactly one separate, non-null UUID ownership field without a default.
Field IDs are JSON names, while field names are SQL column names.

Supported field types are `string`, `uuid`, `integer` (signed 32-bit), `number` (finite double),
`boolean`, `date`, `datetime` and `enum`. Dates use `YYYY-MM-DD` without timezone conversion.
Datetime writes accept RFC 3339 timestamps with `Z` or offsets up to ±14:00 and at most six
fractional digits; responses use UTC and preserve microseconds. Both the written calendar year
and the normalized UTC year must remain within 0001–9999. These checks cover authored defaults
and HTTP DTOs, not arbitrary direct database writes. Compatible literal defaults, generated UUID keys, `created-at` datetime defaults and nullable fields are supported. SQL names and field
IDs use lowercase ASCII identifiers of at most 48 characters; resource IDs use portable lowercase
slugs. The preset accepts 1–32 entities, each explicitly exposed by at least one HTTP resource.
Table names must not collide with another table's generated `<table>_pkey` or
`<table>_owner_page_idx` index name; planning rejects such collisions before emitting SQL.

Each exposed operation requires an explicit supported `allow` policy. There is one
declared `user` identity, selected by HTTP authentication. The verified JWT `sub` must be a UUID and
becomes the owner value. The server injects it on create; owner policies scope list, read, update
and delete to that subject. When access is owner-scoped, a different owner's record returns 404; DTOs cannot assign ownership
or replace a generated primary key. Role policies combine with owner policies using OR. Only the
verified access token's top-level `openpencil_roles` array grants roles, matched against declared
role IDs. Missing roles mean an empty array. User-editable profile metadata never grants access.

An explicit anonymous `select` policy makes the resource's entire read projection public for all
rows, including for signed-in users. Missing credentials are accepted only on those read routes;
an invalid supplied token still fails. Anonymous writes, broad authenticated policies, deny and
tenant policies remain unsupported. Keep private fields out of public read projections and use
separate private entities for unpublished drafts; a browser filter is not an authorization rule.

Authored indexes, unique constraints, enums and foreign keys are emitted into initial SQL.
Private foreign keys must carry the source owner to the target owner in the same composite
constraint. Cross-owner references are allowed only to explicitly public, readable target keys.
Only `restrict` and `no-action` deletes are supported. Relation metadata must correspond to real
foreign keys; it does not generate automatic joins. Unique constraints on private business data
should include the owner where uniqueness is intended to be per user.

The application must declare exactly four distinct, required server environment references:
the issuer, audience and JWKS names selected in `httpApi.authentication`, plus `DATABASE_URL`.
Credentials and environment values never enter Backend IR or emitted files.

The preset rejects tenants, additional anonymous/service identities, deny policies, missing
permissions, workflows, storage, external tables, composite primary keys and other field types. A create projection must cover
all non-null fields that have neither a default nor a server-supplied value.

## Author a personal notes application

The built-in AI can create the same editable application using `create_personal_notes_app`.
For a local Keycloak instance configured for this project, a suitable request is:

> Create a personal notes application using the local Keycloak profile and the NestJS Backend
> Provider. Include login, a private notes list, a multiline editor, create/update/delete actions,
> and pagination. Preserve these bindings when adjusting the visual design. Export a complete
> React or Vue application that I can run locally.

The tool uses the enabled, trusted NestJS provider and performs one undoable document change.
It preserves existing pages and refuses to replace an existing Backend or authentication flow.
It receives only public identity settings, never an administrator password, database password or
access token. The local profile expects issuer `http://127.0.0.1:18080/realms/openpencil` and client
`notes-public-client`; it does not install or start Keycloak. Other services require their explicit
public issuer and client ID. The AI may restyle the resulting native nodes using ordinary design
tools while retaining the generated actions and state bindings.

For the visual flow, open **Services & Workflows → Backend → Browse backend library** and choose
**Personal notes**. Review its included pages and setup requirements, choose **Local Keycloak**
for the existing local service or enter your public issuer and client ID under **Custom OIDC**,
then click **Use template**. The enabled NestJS provider is checked again when creating the template.

This creates the Backend model, login configuration, `/login` and protected `/notes` pages in one
undo step, then opens the notes page in the editor. It includes UUID IDs, server-owned users,
title/content fields, owner policies, a form, an authenticated resource LIST, edit/delete actions
and pagination. Existing pages and document state remain; route and state names receive suffixes
when necessary. Open the generated login route after export, since an existing homepage is preserved.

Templates do not replace existing Backend declarations or authentication flows, and are blocked
when the declaration cannot be read or the model draft contains custom changes. Finish editing that
model or use a new document for the starter. A custom application ID alone is preserved. Browsing
cards does not change the document, and creating a template does not start Keycloak, PostgreSQL or
the generated service.

Identity settings remain editable in **HTTP API & login**. Register
`<frontend-origin>/_openpencil/auth/callback` with that service as an exact redirect URI
for a public browser client using Authorization Code and S256 PKCE. Discovery, token and JWKS
responses must permit browser CORS. The service must issue JWT access tokens for this API, with a
UUID user subject and the audience configured on the NestJS server. Opaque access tokens and
non-UUID subjects are outside this preset. Add scopes or a resource indicator only when required
by the identity service; do not enter a client secret.

For manual model authoring, choose a provider card and click **Select provider**, configure the
draft, then explicitly choose **Save Backend model**. Selecting a provider does not save a document
or migrate its database. In **Advanced provider settings**, **Create personal notes model** is
available only for an empty draft and creates an editable model draft without pages. Configure its
login settings before using **Create notes and login pages** in the staged workflow. Model edits
retain stable field IDs; changing a field's display/SQL name does not break its JSON bindings.

**Manage plugins** opens the existing Plugins settings for installation and enabled state. The
library browses installed provider declarations and built-in application templates; it introduces
no remote marketplace protocol and does not install or enable a provider when a card is opened.

The same panels can bind other declared resources: select a LIST's **Backend resource**, or add
**Backend request** / **Backend authentication** actions to a button or form. Request fields refer
to model field IDs and expressions. Results use writable, non-persistent document state; response
arrays, rows and cursor/error strings have distinct types. Mutations refresh resource lists.
Unsupported providers, missing operations and fields outside the write projection fail validation.

### Recover an unavailable provider after an update

A saved document identifies the exact installed provider package. After an app update, the
Backend model panel may report that its provider is unavailable. This message does not by itself
confirm an outdated pin; the provider may also be disabled or unavailable for another reason.

If NestJS is pinned to an older bundled version, open **Settings → Plugins → Browse**, locate
`open-pencil.nestjs-backend`, and choose **Replace pinned version**. Review the displayed old and
new digests, then confirm **Replace pin and install**. If no replacement is offered, check that
the trusted NestJS provider is installed and enabled.

Return to **Services & Workflows → Backend → Browse backend library**, open the **NestJS** provider
card and click **Select provider**, then choose **Save Backend model**. Save the document, then
prepare the preview or export again.
Keep the existing model and pages; this recovery does not require clearing the Backend declaration,
recreating pages, or resetting the database. Opening the document or reading the recovery hint does
not replace its provider selection or change a plugin pin automatically.

## Export

In the App, an explicit document Backend Provider request selects the installed NestJS contribution.
The existing React and Vue source-export actions re-check its enabled state, descriptor, package
digest and publisher authority immediately before compiling the complete source ZIP. Select the
new login and notes pages in the complete application source export. Source export does not start a
backend server or expose Supabase Apply actions.

Trusted embedding hosts can use the public Compiler API:

```ts
import { compile, withDefaults } from '@open-pencil/compiler'
import {
  NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
  NESTJS_BACKEND_PROVIDER_COMPILER_BUNDLE_DIGEST
} from '@open-pencil/compiler/backend'

// graph, pageIds and application are supplied by the embedding host.
const result = compile({
  graph,
  pageIds,
  options: withDefaults({
    target: 'react', // or 'vue'
    devMode: false,
    backendProvider: {
      application,
      selection: {
        descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
        packageDigest: NESTJS_BACKEND_PROVIDER_COMPILER_BUNDLE_DIGEST,
        enabled: true
      }
    }
  })
})
```

The Compiler-local digest identifies its bundled adapter; it is not an App installed-package
digest or publisher receipt. App callers must continue through the App's authority resolver.
The ordinary CLI must not trust document-supplied package authority to bypass its existing handoff.

Only React/Vue `production` compilation mode includes the complete server source. Here that mode
describes generation policy, not a production deployment. Ordinary preview, prototype omission and native
targets fail; desktop connected preview uses the explicit frontend-only path described below.
Existing Supabase configuration, actions and data widgets cannot be combined with
NestJS; they require an explicit client migration. Authenticated pages are supported when a valid
`httpApi.browserClient` is declared. Microfrontend packaging is outside this browser-login preset.

## Desktop live preview

Desktop Compiler Preview offers **External backend** and **Managed backend** modes for React and
Vue. Both update the frontend when the document changes and open the actual application in the
system browser for OIDC login and CRUD. The embedded editor pane shows status; it does not share
the browser's login session. Ordinary browser-hosted editors do not start these services.

### External backend

External mode connects to an already-running local NestJS backend:

1. Export the complete application using the current generator and start its backend. `local:up`
   enables the local compatibility endpoint automatically. For a manually started service, set
   `OPENPENCIL_LOCAL_PREVIEW=1` and `HOST=127.0.0.1` before `npm start`.
2. Use a dedicated preview database. API requests perform real writes, and connecting the editor
   does not provision a database, apply migrations, or restart the backend.
3. Register `http://127.0.0.1:5181/_openpencil/auth/callback` as an exact redirect URI and
   `http://127.0.0.1:5181` as an allowed origin in the public OIDC client. The desktop control uses
   fixed port `5181`. An occupied preview port is an error; it never silently changes.
4. Open Compiler Preview in the desktop editor, choose **NestJS → External backend**, enter the
   API port (default `3000`), connect, then open the preview in the browser and sign in.

The host checks the generated backend's application ID and normalized contract digest before
connection, frontend updates and API forwarding. A mismatch or unavailable service blocks further
API requests for that connection; synchronize the backend explicitly and reconnect. Model or authentication edits also
disconnect the old preview. This fingerprint detects incompatible generated contracts; it does
not inspect the live database or prove that hand-edited server code matches its metadata.

Component and style edits normally use HMR and retain the in-memory login session. Changes that
replace the entrypoint or file topology can reload the page and require signing in again. Tokens,
the current user and backend response state are not mirrored into the editor document or
collaboration. Disconnecting stops only the editor-owned frontend sidecar; the existing API,
identity service and database remain running.

The compatibility endpoint is local-only, disabled for ordinary server startup, and returns only
version, application ID and digest. It is not an authentication bypass for resource routes or a
production release receipt. Resource routes retain their declared JWT and owner, role, or public-read checks.

### Managed backend

Managed mode prepares and runs a separate NestJS service and PostgreSQL 16 database for the
current application. It currently targets the macOS/Linux desktop development integration.
Install Bun, Node 22.12+ with npm, and Docker, and make them available to the desktop process.
Docker must be running. The desktop uses the companion in the local OpenPencil checkout; this
does not bundle a JavaScript runtime or establish packaged desktop distribution support.
Windows and browser-only managed startup are unsupported.

The current controls use fixed loopback ports: frontend `5181`, API `3012`, and database `55443`.
An occupied port fails instead of selecting another service or stopping its process. External and
Managed preview share frontend port `5181` and run one mode at a time. Existing exported apps,
APIs, databases and identity services remain independent; Managed does not adopt or migrate them.

1. Configure the document's NestJS Backend, HTTP API, public OIDC issuer/client ID, and login
   pages. Start your identity service separately. Register the exact redirect URI
   `http://127.0.0.1:5181/_openpencil/auth/callback` and allowed web origin
   `http://127.0.0.1:5181` in its public PKCE client.
2. Open **Compiler Preview → NestJS → Managed backend**. The side panel shows the current status
   and next action. Open **Connection & sign-in** to check the document issuer and client ID.
   Choose a configuration preset to fill missing values, or enter the server audience and canonical
   HTTPS JWKS URL yourself. For a local CA, select a public certificate file or provide an absolute
   path to a regular PEM file containing public certificates only under advanced settings. This adds
   trust to the generated Node processes; it does not install a system CA or disable TLS checks.
   Browser trust and CORS must already work. These fields require no password or client secret.
3. Check the configuration. This validates the current application and writes generated sources and
   a plan into the private managed directory. It does not install dependencies or execute SQL.
   Open the pending database review, inspect the initial SQL and summary, and explicitly confirm
   dependency installation and database initialization. This installs the pinned backend dependencies, builds the server, and initializes the
   isolated database. First setup may download npm packages and the PostgreSQL Docker image.
4. Start the preview, open it in the browser, and sign in. Preview actions save real data in this
   dedicated database. The panel reports installation, build, migration and startup progress;
   its bounded log withholds raw process output that could contain private values.

Connection settings collapse after successful preparation. Closing the side panel keeps the preview
running and retains its edited settings for the same document. Use **Stop** to stop it, or close
Compiler Preview to end the preview session. Errors remain visible above the collapsible log.

#### Configuration presets

Presets are applied only when you choose to fill settings. They preserve entered values, read the
document's public authentication configuration, and do not change the document, register accounts,
install an identity service, or start the backend.

| Preset         | Values it supplies                                                                                                                                                               | What you provide                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Local Keycloak | For the local OpenPencil issuer `http://127.0.0.1:18080/realms/openpencil`, the HTTPS JWKS endpoint on `18443` and the document audience, or `openpencil-notes-api` when absent. | Start the local identity service and select its public CA certificate. Register the preview callback.                    |
| HTTPS Keycloak | Derives `/protocol/openid-connect/certs` from the document's HTTPS `/realms/<realm>` issuer and uses its resource as the audience.                                               | Your realm, public client and API audience; add a CA only if the service uses a private CA.                              |
| Custom OIDC    | Uses the document resource as the audience when available and preserves your explicit JWKS endpoint.                                                                             | Your provider's canonical HTTPS JWKS URL and API audience. The provider must issue JWT access tokens with UUID subjects. |

For either Keycloak preset, the panel can copy a public client JSON configuration with the current
client ID, an API audience mapper, S256 PKCE, and the exact preview callback and web origin. It
contains no password or client secret. Import it when creating a dedicated client in your realm.
For an existing client, merge the preview callback and required settings while preserving callbacks
used by other applications; do not replace its configuration blindly. The preset does not verify
that your identity service has accepted these settings.

The local CA file is machine-specific and is never bundled into a preset. Selecting it adds trust
only to the generated Node processes; browser certificate trust remains separate. A preset shown
as complete means its fields are filled, not that network connectivity or authentication has passed.

Component and style changes continue through frontend HMR. While Managed is running, supported
API/auth changes that leave the schema unchanged automatically rebuild and restart its backend.
A full frontend reload requires signing in again. Server-setting, login-route, framework or
Provider changes can invalidate the current session and require Prepare again; a disabled
Provider or replaced document cannot reuse an earlier operation's authority.

Schema changes stop the old writable frontend/API before displaying the migration's SQL,
summary and diagnostics. **Apply reviewed update & rebuild** confirms that exact plan; further
edits invalidate the approval. For models without enums, authored indexes, unique constraints,
foreign keys or relation metadata in either the current or proposed version, supported changes are:

- Adding a table that meets the owner-CRUD preset.
- Adding a nullable field or a field with a compatible literal default.
- Renaming a table or column while preserving its stable entity/field ID and existing values.

Models containing advanced declarations support fresh initialization and backend rebuilds with
an unchanged data model. A modular application also supports a strict **append new modules**
migration: only separately owned new tables and enum types, plus their indexes and foreign keys,
may be added. Existing tables, fields, enums, relationships, commands, resources, identity settings,
tenant bindings and commerce configuration must remain unchanged. New account-directory resources
must use explicit read policies without widening an existing endpoint. New module commands cannot
write an existing table through this migration path. Adding a table to an existing module remains
a separate migration task.

All new tables are created before foreign keys are attached. The normal exact-plan review, live
schema checks and transactional SQL/receipt commit still apply. An old application without the
command ledger cannot introduce it through this path. Other advanced-model changes remain blocked;
use a separately managed export and reviewed migration, or a new isolated database.

Appending entities changes command-definition digests. Existing idempotency records are preserved,
but replaying an old key can return `409` instead of replaying or re-executing that command. The
review includes this warning. Resolve outstanding operations before upgrading and do not replace
an unresolved attempt's key to force another execution.

Drops, field type or primary-key changes, owner-binding changes, name swaps, and changes to an
existing field's nullability/default require a separately reviewed migration. They remain blocked
and never trigger a database reset. Application identity changes cannot adopt another managed
database. The executor checks the owned database's live schema and receipt under a lock, then
commits the exact SQL and new receipt together. Manual schema drift is an error, not permission
to overwrite it. An interrupted approved operation must recover or resume its exact plan before
different changes can proceed. Managed mode does not provide a general manual-migration importer;
use the separately managed export workflow for unsupported schema work.

**Stop** and normal preview shutdown stop only the owned frontend, API and database container.
The database volume, generated sources and private session state remain for later starts. If a
review was pending when stopped, Prepare again before restarting. The application-to-session UUID
mapping stays in local host preferences, while files live under the app-data
`managed-preview-v1/<session-uuid>` directory. Database credentials are generated privately and
never enter the document, source export or progress log. Stop is not a data export or a backup.

Managed preview is a local development tool. Its migration receipts are scoped to its owned
database and do not satisfy Backend production release gates. Compiler, controller and mocked
desktop GUI checks do not by themselves prove real Docker/OIDC operation, packaged Tauri
lifecycle behavior, Linux acceptance, remote deployment or production readiness.

## Generated project

### Local setup and startup

The source archive includes `backend/nestjs/LOCAL-RUN.md` and a local runner. With Node 22.12+
and Docker available, configure the identity service once, review the initial schema, and run setup
to install the export's dependencies and initialize its isolated database. Subsequent starts reuse
the database and built frontend. From the export root, the local Keycloak example is:

```sh
npm --prefix backend/nestjs run local:configure -- --local-keycloak --ca /path/to/local.crt
# First review backend/nestjs/migrations/001-initial.sql.
npm --prefix backend/nestjs run local:setup -- --accept-initial-schema
npm --prefix backend/nestjs run local:up
```

The certificate path is an explicit operator choice and is trusted only by the generated Node
processes. No system certificate store changes or TLS verification bypass are required. Use
`local:doctor` for configuration/connection diagnostics and `local:down` to stop this application's
services while retaining its database. The root README links this procedure before the standalone
frontend instructions. Export itself remains a source-only operation: it does not start processes,
install dependencies, or apply a database schema inside the editor.

This runner targets local development and personal use. It does not implement remote deployment,
production release receipts, arbitrary migrations of an existing schema, or automatic OIDC
session renewal. Follow the manual deployment sections below when running outside loopback.

| Path                                                 | Purpose                                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `package.json`, `package-lock.json`, `tsconfig.json` | Pinned NestJS 11 project and reproducible dependency graph              |
| `src/main.ts`, `src/app.module.ts`                   | Startup and resource modules                                            |
| `src/resources/*`                                    | Controllers, services and create/update DTOs                            |
| `src/auth.*`, `src/jwks.ts`                          | JWT signature, issuer, audience, expiry and UUID subject verification   |
| `src/database.service.ts`                            | Bounded connection pool, TLS policy and error redaction                 |
| `migrations/001-initial.sql`                         | Transactional initial schema for fresh tables, applied manually         |
| `security-policy.json`                               | Explicit owner, role and public-read enforcement; no database RLS claim |
| `openapi.json`, `client.ts`                          | Matching HTTP contract and portable typed client                        |
| `.env.example`, `README.md`                          | Environment names and startup instructions                              |

Use Node 22.12 or newer, run `npm ci --ignore-scripts`, then `npm run build`. Review and manually
apply the initial SQL to an isolated PostgreSQL 16+ database. Export the four environment variables
in the launching shell or process manager before `npm start`; the service does not automatically
load `.env`. It listens on `127.0.0.1:3000` unless `HOST` and `PORT` are explicitly configured.

The preset pins NestJS `11.1.19`, jose `6.2.8`, pg `8.20.0`, class-validator `0.15.1` and the full
lockfile dependency graph. These are a tested preset, not a claim that they are the latest releases.
The lockfile's public integrity hashes are accepted only as the exact reviewed static artifact;
the general credential scanner remains enabled for all authored data and other artifacts.

`DATABASE_URL` must include an explicit user, nonempty password, hostname and database. Only one
optional `sslmode=require` or `sslmode=verify-full` parameter is accepted. Remote connections verify
TLS; numeric loopback addresses may use plaintext or `sslmode=disable`. JWKS must be HTTPS without
userinfo, query, fragment or redirects. Remote key fetching has time, response-size and key-count
limits, while jose owns the cache and signature verification.

Without an explicit sort, list uses `limit` and `after` with ascending UUID keyset pagination and returns
`{ data, nextCursor }`. Read/create/update return the declared read projection; delete returns
`{ deleted: true }`. SQL values are parameterized. The generated owner/key index supports paging.
Unknown input, empty mutation bodies, invalid types and oversized JSON are rejected. Numbers are
not coerced from strings, and nullable values are handled separately from omitted fields.

An optional resource `query` declares `filterFields`, `searchFields` and `sortFields` (each at most
16 field IDs, all within `readFields`). The generated API accepts a bounded JSON `filter` object
for exact equality, `q` for literal case-insensitive substring search, and one `sort` with optional
`direction: asc|desc`. Search accepts strings; sorting accepts non-null numeric, Boolean, UUID,
date, datetime or enum fields. Text sorting is currently unsupported. A sorted response uses an
opaque cursor containing the sort value and UUID tie-breaker; reuse it only with the same sort,
direction, filter and search. Cursors are pagination data, never authorization credentials.
Datetime filter values use the UTC `Z` representation returned by the API; offset representations
are accepted for writes but not filters or cursors.
These pages do not share a database snapshot, so edits between requests can change results.
Indexes should match the application's common filters and sort order.

In the visual Backend panel, the **Data model**, **Relations**, **Security** and **HTTP API & login**
tabs expose these declarations. Saving updates the document only. Managed preview initializes
advanced models in fresh databases and rejects subsequent data-model changes while preserving
existing data, as described in the migration limits above.

## Browser login and local run

With `httpApi.browserClient`, React and Vue exports include `src/lowcode-backend-auth.ts`,
`src/lowcode-backend-api.ts` and `src/lowcode-backend.ts`. The generated frontend pins
`openid-client` to `6.8.8`. Install its dependencies in the frontend directory and run the generated
build command before `npm run dev`. The Vite development proxy forwards the declared API mount
(default `/api`) to `http://127.0.0.1:3000`, removing the mount prefix. Thus a resource declared at
`/notes` is requested by the browser at `/api/notes`. Keep the NestJS service on that local port
when using the generated development proxy.

Production hosting needs the same API forwarding rule plus SPA history fallback for `/login`,
`/notes` and `/_openpencil/auth/callback`. Forward `/api/*` to NestJS before applying the SPA
fallback. The static frontend alone does not serve the API. The public issuer must be HTTPS;
explicit numeric-loopback HTTP issuers are supported only for local browser development. The
server's JWKS URL still requires HTTPS.

Login uses discovery and a one-use state, nonce and PKCE verifier bound to the public configuration,
redirect URI and a short expiry. Callback validation completes before the router is evaluated.
Only the pending transaction crosses the redirect in `sessionStorage`; access and ID tokens are
not persisted. The API receives the access token resolved for each request. Logout and expiry
clear account data, and a previous session's late response cannot replace the current session.

This initial client has local application logout and requires a new login after reload or token
expiry. It does not implement refresh tokens, silent renewal or identity-provider session logout.
The provider may still have its own SSO session. Existing Supabase widgets are not transformed.

## Verification boundary

Validation includes deterministic plan/emission and tamper checks, App package/lifecycle checks,
actual React/Vue source-export ZIPs, dependency installation and generated TypeScript builds,
`.fig` persistence and editor interaction. The local browser acceptance runs both generated
frontends with the unchanged Nest main entrypoint, an isolated PostgreSQL instance and a synthetic
HTTPS OIDC service. It verifies password/code/PKCE login, real JWT signature validation through
HTTPS JWKS, visible CRUD controls, cross-user isolation, logout/re-login and a rejected ID signature
returning to a visible login retry. Its temporary CA is scoped to test processes and is never
installed globally or emitted into the application.

The browser client also has actual-library type checks, bounded protocol tests and runtime tests
for stale-response isolation and list refresh. Local identity fixtures are test infrastructure and
never enter generated applications. A selected external issuer/account, remote database TLS,
production ingress and release readiness require their own acceptance. The editor's Native
PostgreSQL management driver is a
different runtime and does not supply this server's database connection or authority.
