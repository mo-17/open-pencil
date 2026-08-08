---
title: Plugin Architecture
description: Marketplace control plane, signed trust chain, declarative lifecycle, WASM isolation, and host adapter boundaries.
---

# Plugin Architecture

OpenPencil uses startup-frozen host registries for trusted contributions that need coordinated
behavior across the document model, editor, Compiler, and AI/MCP tools. A separate application
service owns bundled and marketplace catalogs, installation, enablement, explicit update review,
rollback, exact-digest pinning, document dependency reporting, runtime grants, and local
persistence.

The platform keeps three trust domains distinct. Declarative manifests map only to reviewed host
adapters. The self-hostable marketplace control plane accepts signed publisher submissions and
publishes root-signed discovery state. The optional executable channel runs only separately signed,
root-indexed, import-free WASM compute packages after an exact local grant. No manifest path or URL
is dynamically imported as JavaScript, HTML, CSS, native code, or privileged host functionality.

The current application bundle contains 17 reviewed plugins and 20 contributions: ten module
contributions; five commands (four Clipboard Toolkit commands plus Static Accessibility Audit); and
five exporters (Tauri React, Expo React Native, Flutter, Design Tokens JSON, and Figma Editable
Projection). Only Map is installed and enabled by default. Catalog count is an application snapshot,
not a promise that a signed remote manifest can introduce a new host implementation.

## Package and trust model

The portable package is one bounded UTF-8 JSON manifest, not a ZIP archive. Schema v1 declares
identity, publisher identity, stable semantic version, OpenPencil `engineRange`, an empty
`capabilities` list, and declarative contributions. `contributions.modules` is a required array and
may be empty when a command or exporter is present; the manifest must contain at least one
contribution in total.

```ts
interface PluginManifestContributionsV1 {
  modules: Array<{
    moduleType: string
    name: string
    description: string
    adapterId: string
    configVersion: number
    defaultSize: { width: number; height: number }
    defaultConfig: JsonObject
    fields: DeclarativeModuleFieldV1[]
  }>
  commands?: Array<{
    commandId: string
    name: string
    description: string
    adapterId: string
  }>
  exporters?: Array<{
    exporterId: string
    name: string
    description: string
    adapterId: string
    fileExtension: string
  }>
}
```

These fields describe identity and presentation only. They do not contain implementation code,
URLs, permission grants, or arbitrary host calls. A command or exporter becomes usable only when
the application has registered the exact reviewed host adapter for that plugin and contribution.

### Manifest API v2 safety contract

Schema v2 keeps module contributions declarative and adds closed parameter/result JSON schemas,
declared host permissions, and explicit output extension/MIME pairs to commands and exporters. The
only permission strings are `document.read`, `document.selection.read`, `document.variables.read`,
and `file.save`. Object schemas must reject additional properties, result sizes are bounded,
and safe MIME values cannot include parameters. Unknown keys, permissions, automation targets, and
duplicate output extensions fail parsing. The top-level `capabilities` array remains empty in v2;
these contribution permissions are constrained inputs to a reviewed adapter, not ambient powers.

This is a contract and validation foundation, not a general executable plugin API. `file.save`
allows only the reviewed exporter path to publish its bounded output; there is no general
`document.write`. Schema v2 does not provide arbitrary JavaScript, generic network access,
unrestricted document mutation, custom UI, DOM/Tauri/process access, or an implementation supplied
by the package. Exact startup-frozen host adapter compatibility remains mandatory. The bundled
catalog is mixed-version: legacy contributions stay on schema v1, while the reviewed Static
Accessibility Audit, Design Tokens Exporter, and Figma Editable Projection contributions exercise
the v2 contract. Their implementation still ships only in the host build.

Publisher packages add a SHA-256 digest and Ed25519 signature. Verification requires a public key
selected by the host trust store; a key embedded in package content is never sufficient. Parsing is
exact-key and size bounded, rejects prototype-related property paths, checks default field values,
and compares engine compatibility before catalog activation.

The Phase 3 remote boundary has three linked verification levels:

1. One pinned marketplace root key verifies snapshot identity, monotonic sequence/version, validity
   window, publisher directory, plugin ownership, stable/beta catalog coordinates, signed listings,
   append-only audit head, and optional runtime-index coordinate.
2. The same root key verifies the exact catalog digest named by that snapshot and every
   plugin/version/digest/URL/publisher/key coordinate inside the selected channel.
3. A publisher key from the snapshot directory verifies the referenced manifest, binds its key to
   the publisher and owned plugin IDs, enforces validity/revocation, and authorizes rotation only
   through an explicit predecessor chain.

`verifyCatalogPluginPackage()` requires the exact verified catalog object produced in the current
process and verifies that the entry belongs to it. Do not deserialize, clone, or synthesize a
`VerifiedPluginCatalog`; pass the original verifier result through the ingestion pipeline.
`parseVerifiedPluginPackageSnapshot()` only validates shape and self-consistency and is never a
replacement for public-key verification.

`verifyMarketplaceSnapshot()` and `verifyPluginRuntimeIndex()` also brand their successful results
in process. Never clone or deserialize those results and then treat them as trusted. Network and
cache consumers must retain the original verifier objects, compare exact signed digests, and reject
snapshot rollback before replacing the accepted cache entry.

Bundled entries use the separate `app-bundle` trust source. They are hashed and pinned but are not
misrepresented as publisher-signed. Both trust sources must resolve to a host adapter already
present in the application.

The remote catalog is therefore a signed distribution and lifecycle control plane, not a dynamic
adapter loader. Catalog packages with an unknown module, command, or exporter identity/`adapterId`,
an unsupported module configuration version, or an invalid module default remain non-activatable
until a reviewed host release registers the exact compatible definition. Signature success never
relaxes this gate. The generic store receives this decision through an injected manifest-activation
compatibility policy; it does not import or understand app adapter registries. The application
policy evaluates every contribution against startup-frozen host registries.

## Remote ingestion and cache

The Phase 3 application path accepts one non-secret root from the build-time
`VITE_OPENPENCIL_MARKETPLACE_TRUST_CONFIG` JSON value. No remote marketplace is enabled when this
variable is absent. The strict v1 shape is:

```json
{
  "schemaVersion": 1,
  "url": "https://plugins.example.com/marketplace.json",
  "marketplaceId": "openpencil.marketplace",
  "keyId": "marketplace-root-2026",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
  "channel": "stable"
}
```

`channel` may be `stable` or `beta` and defaults to `stable`. A marketplace configuration takes
precedence over the legacy Phase 2 catalog configuration because its signed publisher directory is
the current source of ownership, rotation, and revocation truth.

The legacy Phase 2 application path accepts its non-secret trust roots from
`VITE_OPENPENCIL_PLUGIN_TRUST_CONFIG`. Its strict v1 shape is:

```json
{
  "schemaVersion": 1,
  "catalog": {
    "url": "https://plugins.example.com/catalog.json",
    "catalogId": "example-catalog",
    "keyId": "catalog-root-2026",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
  },
  "publisherKeys": [
    {
      "keyId": "publisher-2026",
      "publisherId": "example-publisher",
      "pluginIds": ["example-plugin"],
      "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
      "notBefore": "2026-01-01T00:00:00.000Z",
      "notAfter": "2027-01-01T00:00:00.000Z"
    }
  ]
}
```

For rotation, the successor may add `predecessorKeyId`. For revocation, the trust configuration may
add `revokedAt` and `revocationReason`. Trust configuration contains public keys only; never package
a publisher or catalog private key into Vite environment values.

The transport accepts canonical HTTPS sources, rejects redirects, URL credentials and fragments,
uses `credentials: 'omit'`, requires a JSON content type, and applies strict byte, timeout, package
count, and concurrency limits. Loopback HTTP exists only as an explicit injected test/development
transport option and is not enabled by the application configuration parser.

Marketplace, catalog, manifest, runtime-index, and runtime-package responses use a separate bounded
IndexedDB cache with ETag/Last-Modified validators. Cache presence is not trust: every cached
response is parsed and cryptographically reverified at the current time. An expired or invalid root
snapshot/catalog/runtime index never activates cached packages. Individual invalid declarative
packages are excluded with diagnostics; valid siblings may still load.

## Self-hosted marketplace control plane

`@open-pencil/marketplace` is a private Bun service package, not a dependency of the browser
bundle. Its repository contract owns publishers, keys, immutable plugin ownership, signed
submissions, accepted releases, publication checkpoints, and append-only audit events. The reference
implementation provides an in-memory repository for tests and SQLite for local/self-hosted
operation. Mutations are serialized in transactions; strict state parsing runs again before commit.

Submission lifecycle is explicit: a publisher signs a declarative manifest (and optional runtime
package), submits immutable bytes, and receives validation/review state. Publisher withdrawal ends
an unpublished submission; a published release can only be administratively yanked. Review approval
does not silently publish. Publication deterministically rebuilds stable/beta catalogs, an optional
runtime index, and the root snapshot, writes content-addressed artifacts, then records the exact
digests and audit checkpoint. The next snapshot incorporates the previous publication record to
avoid a circular snapshot-digest dependency.

Publisher HTTP mutations use Ed25519 request authentication over a canonical method, path,
timestamp, nonce, and body digest. Timestamps have a bounded clock window and a successfully used
nonce is one-shot. Administrative mutations require an explicit server-side token. This is a
reference local authentication boundary, not OAuth, password recovery, organizations, or a public
identity service. Public discovery endpoints need no credential and return only already-published
signed artifacts/state.

The package installs the `openpencil-marketplace` operator CLI. From this repository, replace that
name with `bun run marketplace`. A minimal local control-plane workflow is:

```sh
# Create SQLite state and the immutable artifact directory.
openpencil-marketplace init \
  --database .marketplace/state.sqlite --artifacts .marketplace/artifacts

# Register a pending publisher/key, approve both, and assign immutable plugin ownership.
openpencil-marketplace publisher create \
  --id example-publisher --name "Example Publisher" \
  --key-id example-2026 --public-key publisher-public.pem \
  --not-before 2026-08-01T00:00:00.000Z --not-after 2027-08-01T00:00:00.000Z
openpencil-marketplace publisher status example-publisher --status active
openpencil-marketplace publisher key-status example-2026 --status active
openpencil-marketplace publisher ownership-request \
  --plugin example-plugin --publisher example-publisher
openpencil-marketplace publisher ownership-status example-plugin --status active

# Import signed immutable bytes, approve them, then create the release explicitly.
openpencil-marketplace submission import \
  --id example-plugin-1-0-0 --publisher example-publisher --channel stable \
  --manifest plugin.json --listing listing.json --runtime runtime.json
openpencil-marketplace review example-plugin-1-0-0 --status approved
openpencil-marketplace review example-plugin-1-0-0 --status published

# Root signing is a short-lived offline operation. The matching public key self-verifies the
# result before the latest publication pointer advances.
openpencil-marketplace publish \
  --private-key marketplace-root-private.pem --public-key marketplace-root-public.pem \
  --root-key-id marketplace-root-2026
openpencil-marketplace audit --json

# The long-running server is public/read-only by default and loads no root private key or token.
openpencil-marketplace serve \
  --public-key marketplace-root-public.pem --root-key-id marketplace-root-2026 \
  --host 127.0.0.1 --port 43121
```

Key rotation is explicit: register the successor with
`publisher key-register --predecessor <old-key-id>`, then approve it with `publisher key-status`.
Loopback administrative HTTP routes
require `serve --enable-admin --admin-token-env <ENV_NAME>`. Online root signing additionally
requires `--enable-online-signing` plus a private-key reference, is rejected on non-loopback hosts,
and is intended only for local operational testing. Production deployments should keep root signing
offline, put only the public server behind a reviewed TLS reverse proxy, and back up SQLite plus the
artifact directory together.

The artifact store is immutable content-addressed storage. `manifestDigest` always means the digest
inside the publisher-signed manifest; `artifactDigest` means the SHA-256 address of its exact stored
JSON bytes. Runtime index byte length is the canonical package length, not the size of pretty-printed
operator input. Publication URLs must be immutable canonical HTTPS coordinates in signed production
artifacts.

### Public distribution layout

Keep source, review history, version tags, and release notes in a GitHub repository and GitHub
Releases. Publish signed manifests, catalogs, runtime indexes, and other immutable artifacts at
content-addressed HTTPS paths. The recommended public layout uses Cloudflare R2 for immutable bytes
and Cloudflare Pages for the public index, documentation, and stable discovery endpoint. GitHub
Pages is sufficient for a small static deployment.

Do not point production catalog coordinates at direct GitHub Release asset URLs: those URLs commonly
redirect, while the OpenPencil transport deliberately rejects redirects. Releases remain the
source/version/history record; R2 plus Pages, or GitHub Pages for a small deployment, supplies the
redirect-free artifact and index endpoints. Keep any current-snapshot discovery pointer small and
signed, and keep every referenced package coordinate immutable.

## Compatibility contract

All contribution behavior is host-owned. The manifest may select only an adapter that the current
build registered for the exact identity:

- Modules bind `pluginId`, `moduleType`, `adapterId`, and `configVersion` to a core definition plus
  Canvas and Compiler adapters.
- Commands bind `pluginId`, `commandId`, and `adapterId` to a reviewed application action.
- Exporters bind `pluginId`, `exporterId`, and `adapterId` to a reviewed application export action;
  `fileExtension` is validated metadata, not filesystem authority.

Unknown or mismatched identities fail closed. Remote JSON cannot add an adapter, change the host
action behind an adapter, inject code, or expand its inputs. The host supplies only the bounded
context required by its own implementation and retains control of selection reads, file saving,
clipboard writes, and all error reporting.

A module is represented by a native `FRAME`. Its configuration lives in
`interactiveProps.module`:

```ts
interface ModuleInstanceV1 {
  version: 1
  pluginId: string
  moduleType: string
  configVersion: number
  config: JsonObject
}
```

Using a frame instead of adding a `MAP` or `MODULE` SceneGraph node type has three useful properties:

- Figma and older OpenPencil versions can retain the frame and its shared plugin data.
- Unknown or temporarily unavailable modules degrade to ordinary editable frame geometry.
- Clipboard, collaboration, component, save, and `.fig` round-trip paths reuse the existing node
  model.

The envelope has strict identity, depth, entry-count, array-count, string-length, and byte limits.
Each definition validates its own configuration version and rejects unknown executable or provider
fields.

## Runtime lifecycle and updates

Module definitions in `@open-pencil/core/plugins` provide identity, metadata, default size and
config, property fields, validation, and frame creation. Trusted app code registers definitions
during startup and then calls `freeze()`. Duplicate plugin and module identities fail before the
registry becomes active. Canvas and Compiler registries independently dispatch on the same
`pluginId/moduleType` identity, so adding an adapter does not add branches to their main walkers.
Application-owned command and exporter registries are frozen under the same exact-identity policy;
their implementation functions never come from manifest or marketplace content.

The application service loads strict versioned records from IndexedDB and cryptographically
reverifies accepted, historical, and pending publisher snapshots. Legacy v1 app records migrate to
v2 without silently accepting new remote content. A newer semantic version is staged with its
module/key/digest diff; only an explicit accept operation promotes it. Reject removes the pending
snapshot, and rollback can select a retained verified history entry. Same-version content changes,
untrusted key changes, expired or revoked keys, and unsupported engine ranges fail closed.

Before promotion, the application also checks every pending module contribution against the frozen
host registry. A candidate that changes to an unknown adapter, identity, configuration version, or
invalid default stays pending and cannot be accepted. Rollback and new-module creation re-evaluate
the current publisher keyring rather than trusting a startup-time status.

Compatibility is enforced inside the store—not only by Settings UI rendering—during installation,
enablement, update acceptance, rollback, and runtime module lookup. Publisher installation requires
a current verified catalog entry. Acceptance additionally requires the pending digest to exactly
match the current catalog package. If that entry carries remote-catalog provenance, installation and
acceptance recheck `catalogExpiresAt` at mutation time and require a refresh after expiry. Existing
accepted packages and retained rollback history do not become unusable merely because the catalog
expires; rollback still rechecks the retained snapshot's active key and host compatibility.

App-bundle digest changes migrate automatically only when the entry is unpinned. A missing pinned
digest fails closed. A digest pin must be removed before accepting or rolling back. A blocked
publisher entry cannot be enabled for new creation, while existing document nodes and trusted
adapters remain available for non-destructive recovery.

## Executable runtime trust and isolation

Executable provenance is intentionally independent from the declarative manifest:

1. The accepted publisher-signed declarative package establishes plugin identity, version, engine
   compatibility, and reviewed host contributions.
2. A publisher-signed `PluginRuntimePackageV1` binds that exact declarative digest to one embedded
   runtime asset, capability list, and resource limits.
3. A root-signed `PluginRuntimeIndexV1`, whose exact digest is named by the verified marketplace
   snapshot, binds plugin/version/publisher/key/declarative digest/runtime digest/URL/byte length.
4. `verifyIndexedPluginRuntimePackage()` rechecks the current marketplace keyring and exact accepted
   declarative package. No individual signature is sufficient by itself.
5. A local user grant binds the exact declarative digest, runtime digest, and complete capability
   list. Any change makes the old grant unusable.

The Phase 4 executable ABI is `openpencil.compute.v1` with UTF-8 JSON input/output:

```text
openpencil_alloc(length:i32) -> pointer:i32
openpencil_compute(inputPointer:i32, inputLength:i32,
                   outputPointer:i32, outputCapacity:i32) -> outputLength:i32
openpencil_dealloc(pointer:i32, length:i32) -> void
```

Production execution accepts only statically validated WASM with no imports, table, start function,
shared/memory64 memory, or unbounded memory. It requires the four ABI exports and a declared maximum
within the signed limit. Each invocation creates a new module Worker, transfers a private copy of the
verified bytes, enforces signed input/output/time limits, validates all linear-memory ranges and
UTF-8 JSON, and terminates on success, failure, timeout, or cancellation.

The only Phase 4 capabilities are `document.nodes.read` and `document.selection.read`. The host
projects a bounded immutable JSON summary: IDs, hierarchy, geometry, visibility/lock state, bounded
names, and bounded text. Raw SceneGraph objects, image bytes, arbitrary plugin data, credentials,
host functions, and mutation APIs never enter the Worker. Runtime inputs/outputs are not persisted.
The local audit record stores only sequence, time, action, runtime digest, and a bounded reason code.

JavaScript runtime packages are parsed and signature-verified so operators can diagnose provenance,
but their fixed execution status is `runtime-unavailable`. A browser Worker is not a security
boundary for hostile JavaScript in the privileged Tauri application. Native code, DOM, network,
filesystem, shell, background processes, document writes, dynamic permissions, and cross-plugin
communication remain unsupported.

This compute boundary does not make the whole desktop renderer a hostile-code sandbox. Keep plugin
HTML and JavaScript out of the main WebView, never grant Tauri capabilities to remote origins, and
treat production CSP, local-origin navigation enforcement, debug-capability separation, and
filesystem/shell scope reduction as host-hardening release work independent of the WASM ABI.

## Portable document dependency lock

Module frames remain the source of dependency discovery. The application can write a strict
`openpencil-plugin-lock` v1 value to the document root under plugin data ID
`open-pencil.plugins` and key `document-lock`. Each sorted entry contains only:

```ts
interface PluginDocumentLockEntryV1 {
  pluginId: string
  version: string
  manifestDigest: string
  publisherKeyId: string
}
```

Resolution compares referenced plugin IDs with installed/enabled accepted snapshots and reports a
missing installation, missing lock/entry, version mismatch, digest mismatch, or key mismatch. It is
diagnostic and fail-safe: opening never blocks, and invalid dependency data never becomes code.
Scanning distinguishes an absent module envelope from a malformed one, reports malformed node IDs
with a bounded diagnostic list, and refuses to write a lock while any are present. Every structurally
valid instance is also resolved through the reviewed host `ModuleDefinition`; rejected instance
configuration is reported and fails lock creation instead of being silently summarized by version.
Root plugin data round-trips through `.fig`. The source-preserving `.pen` writer still rejects
non-Motion edits, so do not claim general `.pen` plugin-lock authoring.

## Rendering and compilation

Canvas previews must be deterministic, offline, and compatible with CanvasKit. They cannot require
DOM, WebGL, remote tiles, or credentials. The Map module therefore draws a bounded schematic preview
on the design canvas.

Compiler adapters may emit a trusted package runtime. The Map module emits a local MapLibre GL React
component, fixed tile style presets, a non-editable link to the OpenStreetMap copyright page, safe
text markers, initialization fallback, and complete listener/map cleanup. Authored frame children
compile as overlays after the map layer without disabling interaction in uncovered map regions.
Module configuration cannot supply raw script, style, HTML, token, arbitrary attribution, or URL
execution.

The Chart reference module exercises the same registries without adding another conditional branch.
Its Canvas preview is dependency-free and its generated React component has no runtime package
dependency. The Rich Text module follows the same pattern with a deterministic Canvas preview and
reviewed Compiler adapter. Its generated editor keeps the editable DOM outside React's managed child
tree so browser editing cannot corrupt reconciliation during a parent render. Initial and edited
content is projected through bounded semantic nodes rather than raw HTML; paste/drop is plain-text
only, links repeat the core protocol/control-character checks, and runtime changes are exposed as a
hidden form value plus `openpencil:rich-text-change`. This is an application-data boundary, not a
write-back channel to the source design document.

The HTML, Video, Table, and Slide Menu modules keep the same reviewed-adapter boundary. HTML uses a
script-free, opaque-origin iframe with strict CSP. Video accepts only empty or canonical public HTTPS
source and poster URLs, requires muted autoplay, draws an offline Canvas placeholder, and requires an
explicit load action in dev-mode Compiler Preview before attaching either remote URL. Generated
React/Tauri apps use the browser's native `<video>` element. Table accepts bounded rectangular string
data and renders cells through React text nodes in a semantic `<table>`; cell content is never
interpreted as markup.

Slide Menu accepts only bounded plain-text content plus document paths, anchors, or canonical public
HTTPS link targets. Its React adapter emits a dependency-free portal runtime with two reviewed
presentation modes and four entrance directions. Escape dismissal, focus trapping, trigger-focus
restoration, scroll locking, reduced-motion handling, and the configured backdrop policy live in
that generated host adapter; declarative plugin data cannot provide code or arbitrary styles.
Expo and Flutter retain the authored static frame and emit an unsupported-module warning instead of
introducing a WebView.

Lottie, Carousel, and Advanced Data Grid complete the ten-module bundled set. Lottie Canvas rendering
is offline and deterministic. Its React adapter accepts bounded embedded vector JSON or performs a
bounded canonical-public-HTTPS fetch only after explicit user activation; expressions, external
images/audio/fonts, oversized payloads, and unsupported structures fail closed. Carousel accepts
bounded slides, safe destinations, and optional canonical public HTTPS media; its generated React
adapter owns accessible controls, autoplay pause/resume, reduced-motion behavior, and explicit remote
media activation. Advanced Data Grid accepts bounded typed cells and host-validated sort/filter/page/
selection settings; the generated React adapter owns its accessible table behavior and does not add a
remote-data capability.

Web/React and Tauri output use those reviewed interactive adapters. Expo and Flutter do not execute
plugin module runtimes or insert a WebView: for every module, including these three, they emit an
unsupported-module warning and retain the authored static fallback until a reviewed native adapter
exists.

The Clipboard Toolkit is a command-only built-in. Its reviewed host adapters copy the active
selection as text, SVG, JSX, or PNG and reject invocation when no selection is active. The manifest
does not receive the selected nodes or clipboard API; the application action performs the bounded
read and write. PNG uses the browser image-clipboard API. The current Tauri capability set does not
grant native image writes, so that path fails visibly until a reviewed native image conversion and
IPC permission are added.

The Tauri React Exporter is an exporter-only built-in. Its reviewed host adapter packages generated
React source plus a Tauri scaffold into a `.zip` source archive through the application's save
flow. It never runs `npm`, `bun`, `cargo`, generated code, or a native build, and the plugin receives
no filesystem or process access.

The Expo React Native Exporter follows the same source-only boundary but dispatches through its own
exact trusted `adapterId` into the Compiler's Expo target. It emits native React Native source and an
Expo Router scaffold rather than post-processing DOM React output. Unsupported web-only IR must
produce a deterministic warning or an explicit authored-frame fallback; it must not be hidden behind
React Native Web or a WebView. The host archives and saves the generated files but never installs
dependencies, launches Expo, or invokes Android/iOS build tools.

The Static Accessibility Audit command runs the host accessibility lint preset and returns a bounded
report. It is not complete WCAG conformance or certification: screen-reader naming/alternatives,
runtime focus order, form announcements/dynamic state, and contrast that depends on variables,
images, gradients, or complex compositing remain explicitly unevaluated.

The Design Tokens exporter emits deterministic, bounded JSON for published variables. Variables with
`hiddenFromPublishing` are excluded, while aliases between exported variables are preserved as alias
IDs. Aliases to hidden or missing variables, cycles, and missing mode values fail closed. The Figma
Editable Projection exporter runs the `figma-compatible` export profile into a derived `.fig` without
mutating the source graph. The result favors native editable Figma layers; OpenPencil interactions and
plugin runtime behavior are not executable in Figma and are not a lossless round-trip guarantee.

## AI and MCP

Use the generic operations for every registered module:

- `list_modules` discovers enabled definitions and property schemas.
- `create_module` creates a native frame with validated defaults or overrides.
- `read_module` validates and returns a frame's module identity and config.
- `update_module` requires the current plugin/module identity and validates the merged config before
  one undoable mutation.

Unknown or invalid module data remains preserved for repair instead of being silently rewritten.
Do not add a separate tool family for each module unless it performs a genuinely different bounded
operation.

The application projects each installed, enabled, host-compatible declarative contribution that the
host explicitly marks MCP-safe into the MCP catalog: modules become add tools, commands become run
tools, and cancellable exporters become export tools. The Tauri, Expo, Flutter, and Figma
source/projection exporters remain UI-only until their synchronous Compiler/encoder stages support
cooperative cancellation. Tool names contain a canonical contribution SHA-256 identity. Store changes trigger
`notifications/tools/list_changed`; disablement, removal, or host disconnect removes the descriptor,
and execution rechecks live state so a client-cached name cannot bypass revocation. Manifests cannot
supply arbitrary MCP handlers, and an installed-but-disabled contribution remains absent.

## Publisher and catalog workflow

The CLI operates only on explicit local files. It never downloads a catalog entry or executes plugin
code:

```sh
# Validate an unsigned payload or signed manifest.
openpencil plugin manifest validate plugin-payload.json

# Sign with an Ed25519 PKCS8 private key, then verify with the SPKI public key.
openpencil plugin manifest sign plugin-payload.json \
  --private-key publisher-private.pem -o plugin.json
openpencil plugin manifest verify plugin.json \
  --public-key publisher-public.pem --key-id publisher-2026

# Build and verify the separately signed catalog index.
openpencil plugin catalog build catalog-payload.json \
  --private-key catalog-private.pem --key-id catalog-root-2026 -o catalog.json
openpencil plugin catalog verify catalog.json \
  --public-key catalog-public.pem --catalog-id example-catalog \
  --key-id catalog-root-2026

# Validate/sign the separate compute package, pinning it to the accepted manifest digest.
openpencil plugin runtime validate runtime-payload.json
openpencil plugin runtime sign runtime-payload.json \
  --private-key publisher-private.pem -o runtime.json
openpencil plugin runtime verify runtime.json \
  --public-key publisher-public.pem \
  --plugin-id example-plugin --plugin-version 1.0.0 \
  --publisher-id example-publisher --key-id publisher-2026 \
  --manifest-digest <manifest-sha256-base64url> \
  --digest <runtime-sha256-base64url> --byte-length <canonical-byte-length>

# Build/verify the root-signed index; these commands do not fetch or run its entries.
openpencil plugin runtime-index build runtime-index-payload.json \
  --private-key marketplace-root-private.pem --key-id marketplace-root-2026 \
  -o runtime-index.json
openpencil plugin runtime-index verify runtime-index.json \
  --public-key marketplace-root-public.pem \
  --index-id openpencil.marketplace.runtime --key-id marketplace-root-2026 \
  --digest <runtime-index-sha256-base64url>
```

CI may pass the **name** of an environment variable through `--private-key-env` or
`--public-key-env`. The CLI resolves that variable only for the command and does not print or write
the key. `runtime verify` and `runtime-index verify` require all release coordinates, digest pins,
and the runtime package's canonical byte length; obtain them from the accepted root-signed index,
not from the downloaded artifact being checked. Use `--json` for structured validation output.
Reproducible publication should verify every
artifact, host immutable URLs, and update the marketplace root through reviewed source control before
rotation. The reference marketplace CLI provides the separate serve/publisher/review/publication
workflow; use `bun run marketplace --help` from this repository for the exact deployment commands.

## Adding a trusted adapter or compute runtime

Adding a usable module still requires all of the following in the application release:

1. A strict `ModuleDefinition` with bounded defaults, exact config validation, property metadata,
   and native frame creation.
2. A deterministic Canvas adapter registered by `pluginId/moduleType`.
3. A framework-neutral Compiler lowerer and target adapter under the same identity.
4. A bundled or publisher-signed manifest whose `adapterId` maps to that exact trusted definition.
5. Canvas, Compiler, AI/MCP, store lifecycle, compatibility, and fail-closed regression tests.

Do not dynamically import a path or URL taken from a manifest. A compute runtime additionally needs
a publisher-signed runtime package, exact declarative digest, root-index entry, static WASM safety
validation, explicit local capability grant, and runtime manager/audit tests. It cannot register a
Canvas/Compiler adapter.

The reference control plane supplies submissions and moderation, but public identity recovery,
teams, payments, ratings/reviews, abuse operations, external transparency witnesses, production key
custody, backups, production deployment, JavaScript/native execution, write/network/filesystem
capabilities, and automatic update acceptance remain outside the verified Phase 3/4 boundary.

## Manual production handoff

The following steps intentionally require an operator and are not automated by the repository:

1. Generate the marketplace root Ed25519 key in an offline or hardware-backed environment, define a
   reviewed rotation/recovery ceremony, and package only its public SPKI key in the application trust
   configuration.
2. Choose the final HTTPS origin before signing the first release. Configure DNS, TLS termination,
   immutable artifact caching, request-size/rate limits, and proxy rules that expose only public
   routes. Keep admin routes on loopback and root signing offline.
3. Back up SQLite and the content-addressed artifact directory as one consistency unit. Exercise a
   restore, verify the complete audit hash chain, and optionally publish audit heads to an independent
   transparency witness.
4. Rebuild the fork with `VITE_OPENPENCIL_MARKETPLACE_TRUST_CONFIG`, then perform real Tauri
   restart/offline/update/revocation tests on macOS, Windows, and Linux. Separately add the production
   CSP, local-origin navigation policy, debug-only capabilities, and narrower filesystem/shell
   scopes described above.
5. Select and integrate any public account/OAuth, organization, email recovery, billing, tax,
   ratings/reviews, abuse-reporting, sanctions, refund, and support systems. None of those systems is
   implied by the local publisher-signature/admin-token reference service.
