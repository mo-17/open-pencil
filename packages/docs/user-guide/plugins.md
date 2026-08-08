---
title: Plugin Marketplace
description: Discover, verify, install, audit, grant, revoke, update, and roll back signed OpenPencil plugins.
---

# Plugin Marketplace

OpenPencil has a controlled plugin marketplace with two deliberately separate layers. Every build
includes an offline catalog of declarative contributions. A fork operator may also pin one marketplace
root key and serve a signed marketplace snapshot, publisher directory, stable/beta catalogs,
searchable listings, and an append-only audit checkpoint without depending on the official
OpenPencil website or an OpenPencil account.

Declarative manifests remain the default and safest path: they cannot run JavaScript, inject HTML or
CSS, start a native process, or request filesystem/network access. Phase 4 adds a separate,
default-unavailable executable channel for publisher-signed, marketplace-indexed WASM compute
packages. A user must grant the package's exact digest and complete read-only capability list before
each version can run. JavaScript packages may be verified for provenance but are never executed.

## Browse and install

Open **Settings → Plugins**. The store has two views:

- **Browse** lists bundled and verified remote entries with trust source, version, and installation
  state.
- **Installed** provides enable, exact-digest pin, update review, rollback, dependency, and remove
  controls.

When a marketplace root is configured, the page also shows marketplace search, the selected stable
or beta channel, publisher/key identity, snapshot status, the audit head, and whether the snapshot
authorizes an executable runtime index. Search matches the signed name, summary, category, keyword,
plugin ID, and publisher metadata; it does not trust an unsigned search-service response.

The application bundle contains eleven reviewed plugins:

- **Map** is installed and enabled on a new profile. It creates a native editable map `FRAME` and
  compiles to the reviewed MapLibre-based React adapter.
- **Chart** is an installable reference module with deterministic Canvas and Compiler adapters.
- **Rich Text** is an installable editable content module with reviewed Canvas and Compiler
  adapters.
- **</> HTML** is an installable, opt-in HTML content module. Its reviewed adapter accepts at most
  65,536 characters and renders them in a script-free sandbox with a strict Content Security
  Policy; the manifest itself cannot inject markup or executable code.
- **Video** is an installable media module for a user-configured public HTTPS video and optional
  poster. It provides generic controls for playback behavior and sizing without granting the plugin
  network or credential capabilities.
- **Table** is an installable structured-data module with an editable header and up to 12 columns
  and 100 body rows. Cells remain bounded plain text and never execute HTML.
- **Slide Menu** is an installable trigger module that opens either an edge menu or a modal from the
  left, right, top, or bottom. Its links are bounded plain text with safe document, anchor, or public
  HTTPS destinations.
- **Clipboard Toolkit** provides host-owned commands for copying the active selection as text,
  SVG, JSX, or PNG. These commands are unavailable when there is no active selection. PNG uses the
  browser image-clipboard API; the current Tauri permission set reports it as unsupported instead
  of claiming a successful native image copy.
- **Tauri React Exporter** packages the current document's generated React source and a Tauri
  scaffold into a `.zip` source archive. It never runs `npm`, `bun`, `cargo`, or generated code, and
  it does not give the plugin filesystem or process access.
- **Expo React Native Exporter** packages the supported static design subset and native control
  shells as a real Expo + React Native + TypeScript source project. It does not use a WebView or
  React Native Web wrapper, install dependencies, or invoke mobile build tools. Web-only features
  are recorded in `EXPORT_WARNINGS.md` instead of being silently treated as native.
- **Flutter Exporter** packages the supported static design subset as a source-only Dart + Flutter
  project. It emits Flutter widgets and navigation source rather than a WebView, does not install
  dependencies, generate platform runners, or invoke Flutter tooling, and records unsupported behavior in
  `EXPORT_WARNINGS.md`.

Install and enable a plugin, then use its editor entry point. Insert modules from the **Plugins**
menu in the canvas toolbar, run copy commands from **Edit → Clipboard Toolkit**, and export desktop
source from **File → Export → Tauri React Project** or mobile source from **File → Export → Expo
React Native Project** or **File → Export → Flutter Project**. These actions still use the same reviewed host
adapters shown on the installed-plugin card, and modules create native editable `FRAME` nodes rather
than opaque browser surfaces.

The current Expo static MVP supports native `View`, `Text`, `Image`, `ImageBackground`, `Pressable`,
`TextInput`, and `Switch` shells; basic inline layout and visual styles; single-page output or
Expo Router page files; and static images. The presence of a native control
shell does not mean its authored web state/action runtime has been translated. Modules such as Map,
Chart, Rich Text, HTML, Video, Table, and Slide Menu; Motion and prototype effects; raw SVG; upload;
Supabase/server workflows;
analytics and Stripe; persistence; advanced form validation; overlays; responsive/hover/custom CSS;
and other DOM/Tailwind-only behavior currently remain explicit warnings for native follow-up.
Mobile source ZIPs currently omit every font file. Existing exact-license evidence records an SPDX
identifier but does not carry the font-specific copyright, complete license text, or required NOTICE
files, so it is not sufficient to redistribute the bytes safely. Each omission records the family,
asset path, and known SPDX identifiers in `EXPORT_WARNINGS.md`; OpenPencil does not invent missing
legal notices.

The current Flutter static MVP emits a normal `pubspec.yaml`, `lib/main.dart`, generated page and
component Dart files, and portable image assets. Multiple pages use a centralized Flutter
router with the normal `Navigator` back stack. Font references fall back to locally available system
faces because the source ZIP does not redistribute font bytes; WOFF and WOFF2 are additionally not
supported by this Flutter target. The ZIP deliberately omits
`android/` and `ios/` runners and is not an APK, AAB, IPA, or signed application.

After extracting, keep a backup (or commit the generated source) before asking a locally installed
[Flutter CLI](https://docs.flutter.dev/reference/flutter-cli) to add the missing runner directories.
Run these commands from the export root, then review that `lib/`, `assets/`, and `pubspec.yaml` still
contain the OpenPencil output before continuing:

```sh
flutter create --platforms=android,ios --project-name <dart_package_name> --no-pub .
flutter pub get
dart format lib test
flutter analyze
flutter run
```

Replace `<dart_package_name>` with the exact `name:` value from the generated `pubspec.yaml`.
`flutter create` is used only after export to add the platform bootstrap files; OpenPencil never runs
it. Review `EXPORT_WARNINGS.md` before treating the generated application as feature-complete.

After inserting Rich Text, OpenPencil selects it automatically. Use **Design → Module** to add,
reorder, or convert paragraphs, headings, quotes, code blocks, and lists, and apply bold, italic,
underline, strike, inline-code, or safe-link marks without editing JSON. The settings-card actions
remain available as management and diagnostic fallbacks.

In Compiler Preview and exported React/Tauri projects, the same module becomes an accessible,
directly editable rich-text field with a formatting toolbar. The current v1 toolbar covers normal
text, H1–H3, quotes, code blocks, bold, italic, underline, strike, inline code, ordered and bullet
lists, left/center/right alignment, safe links, clear formatting, undo, and redo. Paste and drop
accept plain text only, so copied HTML cannot inject images or scripts. The editor exposes its
bounded JSON value through a hidden form field and an `openpencil:rich-text-change` DOM event, and
keeps edits across ordinary parent React re-renders. Runtime edits are not written back into the
`.fig` document or persisted across a page reload unless the generated application handles and
stores that value.

After installing and enabling **</> HTML**, insert it from the canvas **Plugins** menu and edit the
`HTML` field under **Design → Module**. The code textarea updates a non-interactive sandboxed preview
as you type. Blur the textarea or press **Cmd/Ctrl+Enter** to commit the bounded value to the
document. External document changes are reflected back into the editor, and invalid values remain
visible as an error instead of replacing the last valid module configuration.

Compiler Preview and exported React/Tauri projects use the same bounded source and strict CSP in an
iframe without script or same-origin privileges. The editor preview also disables pointer events
and sends no referrer. This is a reviewed host adapter for document content, not a way for a plugin
manifest to inject HTML, JavaScript, CSS, permissions, or a new runtime into OpenPencil's main
WebView.

After installing **Video**, insert it from the **Plugins** menu and configure its public HTTPS source
under **Design → Module**. Compiler Preview does not attach the source or poster until you press
**Load video preview**; generated Web or Tauri projects load the configured URL through the browser's
native video element. The media host can therefore observe the viewer's IP address and ordinary
HTTPS request metadata after activation or in the exported app. The initial URL rejects local hosts,
IP literals, credentials, fragments, and non-HTTPS schemes, but DNS and redirects remain controlled
by the media host and viewer's browser. Use only a media host you trust, and never put credentials,
access tokens, or private data in source/poster URLs: query parameters are preserved in the `.fig`
document and generated source, not treated as secrets. Browser autoplay policy may still require
muted playback or a user gesture.

After installing **Table**, use **Design → Module** to edit header and body cells, add or remove rows
and columns, and review the live size and text counters. The editor and core validator enforce the
same maximum of 12 columns, 100 rows, 2,000 characters per cell, and 100,000 characters in total.
The committed value is structured table data, not HTML; tags typed into a cell are displayed as
text and are never evaluated as markup or script.

After installing **Slide Menu**, use **Design → Module** to choose **menu** or **dialog**, select the
left, right, top, or bottom entrance, edit the trigger/title/description and destinations, and set
the panel size, colors, backdrop opacity, backdrop dismissal, and close-button visibility. In
Compiler Preview and exported React/Tauri projects, activating the authored trigger renders the
panel in a local `document.body` portal. Escape always dismisses it, keyboard focus stays inside
while open and returns to the trigger after close, and reduced-motion preferences suppress the
sliding transition. Menu links accept only document paths beginning with `/`, local anchors
beginning with `#`, or canonical public HTTPS URLs; labels and descriptions remain plain text.

Expo and Flutter source exports do not add a WebView for **</> HTML**, **Video**, **Table**, or
**Slide Menu**. They
emit explicit unsupported-feature warnings and static native fallbacks without the authored module
behavior until reviewed native adapters exist. This preserves the existing native export security
boundary instead of silently shipping a browser surface inside the mobile app.

Installation and enablement are separate on purpose. A newly installed plugin starts disabled so
you can review it before exposing its modules, commands, or exporters. Only modules join the canvas
toolbar and built-in AI/MCP module discovery.

A verified signature proves who published a manifest; it does not make an adapter available. If a
catalog entry has no compatible module, command, or exporter adapter in this OpenPencil build, the
store keeps the entry visible for diagnosis but disables activation. Install a build that ships the
reviewed adapter before using that entry. A manifest can name an adapter, but it cannot supply or
execute one.

Schema v1 keeps all contribution descriptions declarative. `contributions.modules` describes
native frame modules, `contributions.commands` describes named host actions, and
`contributions.exporters` describes named export actions plus their safe file extension. The
manifest still has an empty capability list. Every contribution must match an exact adapter that
was registered and frozen at application startup; no contribution receives arbitrary editor,
filesystem, network, Tauri, or process APIs.

## Remote catalog status

The **Remote catalog** card reports the source used for the current session:

- **Verified now** means the catalog and accepted manifests came from the network and passed all
  current checks.
- **Verified cache** means at least one signed response came from the local cache and was verified
  again before use.
- **Stale cache** means cached data exists but cannot currently pass its validity or trust checks;
  it is not activated.
- **Unavailable** means neither the network nor a usable verified cache can supply the catalog.
- **Not configured** means this application build contains only the bundled offline catalog.

Remote requests use HTTPS, reject redirects and embedded credentials, omit browser credentials, and
apply response-size and timeout limits. The signature—not HTTPS or cache presence—is the final
identity and integrity check. One invalid catalog fails closed; an invalid individual manifest is
excluded and counted as an issue without enabling it.

The root-signed marketplace snapshot replaces a static publisher-key list with a signed directory.
It binds every active publisher key, ownership, rotation/revocation record, catalog digest, listing,
audit checkpoint, and optional runtime-index digest. OpenPencil refuses a validly signed snapshot
rollback and re-verifies cached snapshots at the current time. A cached response that is expired,
tampered, rooted in a different key, or older than the accepted sequence is never activated.

Installing a publisher plugin and accepting an update are catalog-bound operations. OpenPencil
checks again when you confirm that the exact signed package is still present in the current catalog
and that the catalog has not expired. If either check fails, refresh the catalog and review the
result before retrying. A catalog expiring after installation does not disable an already accepted
plugin; accepted declarative contributions remain usable while their publisher key and host adapter
remain valid.

## Enable, disable, and remove

Enabling a plugin makes its reviewed modules, commands, and exporters available. Modules also
become available for new insertion and for `list_modules` / `create_module`. Disabling or removing
the plugin prevents new module instances and blocks its commands and exporters.

Existing document nodes are not deleted or rewritten. Trusted adapters that still ship with the
application continue to render and edit their existing declarative configuration. If an adapter is
unavailable, the node safely degrades to its ordinary frame geometry and OpenPencil preserves the
module envelope for later recovery.

Removing a plugin changes only local installation state. It does not scan or mutate open documents.
Before removal, OpenPencil aborts any active runtime invocation and durably revokes its exact
runtime grant. Reinstalling the same version and digest therefore still requires a new explicit
runtime review and grant; the prior audit remains available for local diagnosis.

Enabled declarative contributions also appear as dynamically named MCP tools under the
`plugin__<readable-plugin>__<action>_<readable-contribution>_<sha256>` namespace. The canonical
identity digest prevents a different plugin with the same normalized readable name from reusing a
cached tool name. The MCP server refreshes its tool list after install, enable, disable, and remove
operations. It checks the current plugin state again at execution time, so a tool cached by an MCP
client stops working immediately after its plugin is disabled or removed. Only host-reviewed module,
command, and exporter adapters are exposed; a plugin manifest cannot add an arbitrary executable MCP
handler.

## Review updates and roll back

A newer publisher-signed manifest is staged as **Update review required**. It never replaces the
accepted version silently. The review shows the version change, manifest digest, signing-key change,
and added, removed, or modified contributions.

- **Accept update** promotes the verified candidate and keeps the previous accepted snapshot in a
  bounded local history.
- **Reject update** dismisses the current candidate. A later catalog refresh may offer it again.
- **Rollback** restores the latest retained verified snapshot after confirmation; the version being
  replaced remains in history.

An exact-digest pin must be removed before accepting an update or rolling back. A signing-key change
is accepted only when the host trust configuration declares a valid predecessor chain for the same
publisher and plugin. An expired, revoked, or unauthorized accepted key disables new module creation
and displays a blocked reason; it does not delete existing document content. An update that changes
to an adapter or configuration version this build does not support remains visible but cannot be
accepted. Rollback also rechecks the retained snapshot against the current keyring, so revoking an
old key cannot be bypassed through history.
Rollback uses the locally retained verified history and does not require a fresh catalog. It still
rechecks the target publisher key and the current build's host-adapter compatibility before changing
the accepted version.

## Review and run an executable plugin

Executable controls appear only for an installed, enabled, publisher-signed plugin when the verified
marketplace snapshot publishes a matching runtime index. Choose **Review runtime** before granting
anything. The review shows:

- The declarative manifest digest and the independently signed runtime-package digest.
- The publisher/key identity, runtime kind, requested capabilities, and network/cache source.
- Whether the runtime is eligible on this build. JavaScript always reports **Runtime unavailable**.

For Phase 4, the complete capability vocabulary is `document.nodes.read` and
`document.selection.read`. A grant always covers the exact runtime digest, exact declarative digest,
and complete sorted capability list. Updating either package or changing capabilities invalidates
the old grant automatically. **Revoke** stops later invocations immediately. **Run once** starts a
new disposable Worker and returns only JSON; it does not leave an idle plugin process behind.

WASM execution is deliberately compute-only. The module cannot import host functions, fetch the
network, read files, mutate the document, access credentials, create DOM, or call Tauri. It receives
only a bounded JSON envelope for explicitly granted read snapshots. The host enforces signed
input/output/memory limits, a hard invocation deadline, bounded UTF-8 JSON, no tables/start/shared
memory, and a declared maximum memory. Timeout, cancellation, completion, and failure all terminate
the Worker.

The runtime panel keeps a local machine-readable audit trail of grants, revocations, successful
runs, failed runs, and blocked attempts. Inputs, outputs, document content, and credentials are not
written to that audit trail.

## Exact digest pinning

Use **Pin digest** to lock the installed entry to its exact manifest digest. The store records both
the declared semantic version and SHA-256 digest, so different content cannot silently replace a
pinned build while keeping the same version string.

Bundled plugins follow application releases. An unpinned bundled plugin can move to the manifest
included in a newer OpenPencil build while preserving its installed and enabled state. If a pinned
digest is no longer present in the new application bundle, the store fails closed and asks for an
explicit decision instead of silently changing the pin.

## Document dependencies

The **Current document dependencies** section scans native module frames in the active document and
compares them with locally installed accepted versions. It reports missing installation, disabled
plugins, missing lock entries, and version, digest, or publisher-key mismatches.

Choose **Write verified lock** after the required plugins are installed and reviewed. OpenPencil
writes a bounded `openpencil-plugin-lock` record to the document root containing only plugin ID,
version, manifest digest, and publisher key ID. It does not embed executable code, credentials, or
download URLs. The lock round-trips in `.fig`; the existing source-preserving `.pen` writer still
rejects non-Motion document edits and therefore is not a general plugin-lock authoring path.

Opening a document is never blocked by dependency resolution. A missing or invalid lock is reported
for repair, while unknown module data remains inert and preserved. A malformed module envelope or
instance configuration rejected by the reviewed host adapter is shown with its node ID and prevents
writing a misleading verified lock; OpenPencil still leaves the original frame data untouched.

## Trust labels

The store distinguishes two trust sources:

- **App bundle** means the manifest and every referenced adapter were packaged with this OpenPencil
  build. It is not presented as publisher-signed.
- **Verified publisher** means the package was named by a verified catalog, then passed strict
  parsing, SHA-256 integrity validation, Ed25519 publisher-signature verification, publisher/plugin
  ownership checks, key validity and revocation checks, and OpenPencil engine compatibility checks.

A valid signature establishes package identity and integrity; it does not grant execution rights.
Both trust sources still use the same host adapter allowlist.

## Data stored locally

Plugin state is stored in local IndexedDB (or an in-memory backend when IndexedDB is unavailable).
The versioned record includes the active accepted snapshot, bounded verified history, optional
pending review, install/enable state, and optional digest pin. A separate bounded cache stores raw
marketplace/catalog/manifest/runtime JSON plus HTTP validators. Cached JSON is cryptographically
reverified before use. Runtime grants and their bounded local audit history live in a third
versioned store. None of these stores contains credentials, prompts, runtime inputs, or outputs.

If IndexedDB fails temporarily, use **Retry**. If OpenPencil identifies one malformed or obsolete
record by a safe catalog plugin ID, **Reset local state** requires confirmation before deleting only
that record and reloading catalog defaults. Records without a validated plugin ID remain
fail-closed and are never guessed or bulk-deleted.

The module instance itself is stored on its frame at `interactiveProps.module` with a versioned,
bounded JSON configuration. This makes unknown modules inert and allows `.fig` round trips to retain
their data.

## Public distribution

Use a GitHub repository and GitHub Releases for source review, version tags, release notes, and
history. Serve the signed, immutable manifest/catalog artifacts and indexes from content-addressed
HTTPS paths instead of treating a mutable Git branch or release label as package identity.

For a public marketplace, the recommended arrangement is Cloudflare R2 for immutable artifacts and
Cloudflare Pages for the public index, documentation, and stable discovery endpoint. A small
deployment can publish the same static layout with GitHub Pages. Direct GitHub Release asset URLs
commonly redirect, while OpenPencil's production transport rejects redirects, so Releases should
remain the source/version/history record rather than the application's artifact endpoint.

## Current limitations

Phase 3 includes a self-hostable reference control plane for publisher registration, signed
submissions, moderation, stable/beta publication, immutable artifacts, root-signed snapshots, and a
hash-chained audit log. Its local publisher-signature/admin-token model is an operational starting
point, not a hosted identity, billing, or community system. Public OAuth accounts, email recovery,
teams, payments, ratings/reviews, abuse operations, external transparency witnesses, production key
custody, backups, and production deployment remain operator work.

Phase 4 executes only the documented import-free WASM compute ABI. JavaScript, native code, DOM,
network, filesystem, shell, document writes, background services, cross-plugin communication, and
automatic update acceptance remain unavailable. Declarative modules, commands, and exporters still
require reviewed host adapters shipped by OpenPencil; the WASM channel is for bounded computation,
not for installing a new renderer or bypassing the host registry.

The WASM channel does not expose Tauri IPC, and remote marketplace data is rendered as text rather
than executable markup. Host-wide Tauri hardening is nevertheless a separate release lane: the
desktop shell still needs a production CSP, an explicit local-origin navigation policy, debug-only
automation capabilities, and narrower filesystem/shell scopes before the project should claim a
fully hardened hostile-renderer boundary. Do not add remote origins to the default Tauri capability
or load plugin HTML/JavaScript into the main WebView.

For the package contract, deployment configuration, and publisher workflow, see
[Plugin Architecture](../development/plugins).
