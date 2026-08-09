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

The current **Unreleased** source line contains 34 reviewed plugins with 37 contributions: 17
modules, six commands, eight exporters, five connectors, and one storage provider. A definition,
renderer, contract, or exporter source file alone does not make a plugin available; the contribution
must also have its reviewed central host registration. Map and Google Drive Storage are installed and
enabled on a new profile; every other bundled plugin is opt-in.

- **Map** is installed and enabled on a new profile. It creates a native editable map `FRAME` and
  compiles to the reviewed MapLibre-based React adapter.
- **Google Drive Storage** is an installed-and-enabled, host-owned storage-provider declaration. Its
  manifest supplies no network, OAuth, or executable implementation; connect the reviewed desktop
  adapter from **Settings → Storage**.
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
- **Lottie** is an installable vector-animation module for bounded embedded JSON or a canonical
  public HTTPS source. Canvas stays offline; embedded data loads locally, while generated Web/React
  output requires an explicit user action before fetching a URL. Expressions, external images,
  audio, and external fonts are rejected.
- **Carousel** is an installable accessible carousel with one to 12 bounded slides, safe links,
  optional public HTTPS images, arrows/dots, slide or fade transitions, and controllable autoplay.
  Remote slide media is not attached in Compiler Preview until the user explicitly loads it.
- **Advanced Data Grid** is an installable typed grid with bounded text/number/date/boolean data,
  initial sorting and filters, pagination, single/multiple selection, density, and visual controls.
  It accepts at most 16 columns, 200 rows, and 2,000 cells and does not fetch remote data.
- **Tabs** is an installable accessible tab set with two to 12 bounded plain-text panels, horizontal
  or vertical orientation, automatic or manual activation, an initial tab, and visual controls.
- **Accordion** is an installable set of one to 16 bounded plain-text expandable sections. It can
  allow one or several open items and validates every configured initial item ID.
- **QR / Barcode** generates a real QR code or Code 128 barcode locally in generated React output.
  The design canvas intentionally draws only a deterministic offline placeholder; it is not a
  scannable-code verification surface.
- **Markdown** renders up to 65,536 characters of CommonMark or GFM in generated React output. Raw
  HTML is skipped, and links are limited to safe anchors, root-relative paths, or public HTTPS URLs.
- **Code Block** displays bounded source as inert text with a language label, line numbers, wrapping,
  theme, and an optional copy button. It does not execute code, interpret HTML, or perform syntax
  highlighting.
- **PDF Viewer** stores bounded PDF source metadata, page/fit hints, toolbar visibility, and download
  policy. The canvas never loads or parses PDF bytes; Compiler Preview requires an explicit load.
- **Audio Player** stores bounded audio source metadata and playback controls. The canvas never loads
  or decodes audio; Compiler Preview requires an explicit load, and muted playback is required when
  autoplay is enabled.
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
- **Static Accessibility Audit** runs the host's bounded accessibility lint preset against the
  current document. It is a design-time report, not complete WCAG conformance or certification and
  not a screen-reader, keyboard-focus, runtime form-announcement, or dynamic-state audit.
- **Static Design System Audit** is an Unreleased host command for bounded token, component-variant,
  spacing, and typography consistency checks. It never edits the document and is not a design-system,
  brand, font-license, or final-rendering certification. It appears only after the current build has
  registered its bundled manifest and reviewed command adapter.
- **Design Tokens Exporter** writes deterministic JSON for published variables, collections, modes,
  types, descriptions, and values. Variables hidden from publishing are excluded. Aliases between
  exported tokens remain aliases; an alias to a hidden or missing token, an alias cycle, or a missing
  mode value fails the export instead of flattening or inventing a value.
- **Figma Editable Projection Exporter** creates a derived `.fig` projection with editable native
  Figma layers. It does not mutate the OpenPencil source document. OpenPencil interactions, module
  behavior, and plugin runtimes are not executable in Figma, so this is not a lossless runtime
  round-trip promise.
- **Next.js Exporter** packages a source-only Next.js + React App Router project. The authored React
  runtime mounts client-side in a catch-all route; this is not a Server Component or SSR conversion.
- **Capacitor Exporter** packages a source-only Capacitor + React project with relative assets and
  hash routing for the native WebView origin. It does not generate Android/iOS platform projects or
  invoke Gradle or Xcode.
- **Electron Exporter** packages a source-only Electron + React project with hash routing,
  `contextIsolation` and sandboxing enabled, and Node integration disabled. It does not package or
  sign an application.
- **Supabase Schema Inspector** reads a bounded, normalized schema catalog through the reviewed
  Supabase Management API authority. Its bearer credential stays in OpenPencil's central credential
  store; neither the raw catalog nor the credential is written to the design.
- **Airtable Records** lists a bounded page of records from one configured base and table through the
  fixed Airtable API origin. Returned fields are normalized into bounded name/value entries rather
  than exposed as an unrestricted provider object.
- **Supabase Tables** runs reviewed, bounded table queries and row mutations against the configured
  project origin. It cannot select an arbitrary host, method, path, header, or free-form request body.
- **Stripe Checkout & Billing** reads bounded product/price details and can create a Checkout Session
  after a fresh mutation confirmation. Success and cancel destinations must be canonical public
  HTTPS URLs.
- **Resend Email** reads bounded email status and can send a bounded message after a fresh mutation
  confirmation. It does not support arbitrary endpoints, headers, attachments, or streaming bodies.

Install and enable a plugin, then use its editor entry point. Insert modules from the **Plugins**
menu in the canvas toolbar, run copy commands from **Edit → Clipboard Toolkit**, and use the enabled
entries under **File → Export** for Tauri, Next.js, Capacitor, Electron, Expo React Native, or Flutter
source. Audits and exporters also remain available from their enabled installed-plugin cards when the
current build has registered their reviewed host adapters. Enabled modules, Clipboard commands,
Static Accessibility Audit, Static Design System Audit, and Design Tokens Exporter expose dynamic MCP
tools. A connector card also shows its central credential status, current-session authorization,
revocation, and reviewed operation launch controls. Explicitly authorized read-only connector queries
whose fixed method is `GET` expose dynamic MCP query tools; connector mutations remain UI-only and ask
for confirmation on every run.
Source/projection exporters whose Compiler or encoder stage cannot cooperatively
cancel—including Tauri, Next.js, Capacitor, Electron, Expo, Flutter, and Figma—remain UI-only so an
MCP timeout cannot leave an export occupying the editor. These actions still use the same reviewed
host adapters, and modules create native editable `FRAME` nodes rather than opaque browser surfaces.

The current Expo static MVP supports native `View`, `Text`, `Image`, `ImageBackground`, `Pressable`,
`TextInput`, and `Switch` shells; basic inline layout and visual styles; single-page output or
Expo Router page files; and static images. The presence of a native control
shell does not mean its authored web state/action runtime has been translated. All 17 plugin
modules; Motion and prototype effects; raw SVG; upload;
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

After installing **Lottie**, choose `url` or `json` under **Design → Module**, then configure loop,
autoplay, speed, direction, and fit. The Canvas placeholder never fetches a URL. Bounded embedded JSON
loads locally; Compiler Preview and generated Web/React output require **Load Lottie animation**
before making a public HTTPS request, and retry remains user initiated. Reduced-motion preferences
suppress autoplay. The validator accepts a bounded vector subset and rejects external assets,
expressions, audio, and external font loads rather than passing them to the renderer.

After installing **Carousel**, edit its bounded `Slides` JSON and accessible label, then choose the
initial slide, transition, autoplay interval, loop, arrows/dots, hover pause, and colors. Each slide
has plain-text title/description, optional public HTTPS image with required alternative text, and an
optional document path, anchor, or public HTTPS destination. Compiler Preview requires **Load remote
slide media** before attaching images. The generated Web/React adapter provides keyboard-operable
controls, pause/resume, an announced current slide, and reduced-motion handling.

After installing **Advanced Data Grid**, edit its typed `Grid data`, optional initial sort/filters,
page size, selection mode, density, headers, stripes, and colors under **Design → Module**. Row and
column IDs are stable bounded identifiers; every cell must match its declared text, number, date, or
boolean column. The generated Web/React table supports accessible sorting, filtering, pagination,
and row selection over this authored static data. It is not a remote database connector.

The same property panel has bounded CSV helpers. **Paste CSV** accepts UTF-8 comma-delimited text up
to 192 KiB, preserves the existing column schema, and requires every header to exactly match the
corresponding column label or ID. Numbers use locale-independent JSON syntax, booleans are `true` or
`false`, dates use `YYYY-MM-DD`, and an empty non-text field becomes `null`. A successful editor import
replaces the authored rows, is stored in the design, and participates in undo. **Prepare CSV text**
shows read-only text for manual copying; it requests neither file nor clipboard authority and prefixes
formula-like text fields before spreadsheet use. In generated React output, a pasted import changes
only the current running session and is not written back to the design or persisted across reloads.

After installing **Tabs**, edit its labelled items in **Design → Module**, choose horizontal or
vertical orientation, and choose automatic or manual activation. Generated React output uses tablist,
tab, and tabpanel semantics with roving focus. Arrow keys, Home, and End move focus; in manual mode,
Enter or Space activates the focused tab. Content is bounded plain text, not nested Markdown or HTML.

After installing **Accordion**, edit its labelled sections, choose single-open or multi-open behavior,
and select valid initial-open IDs. Generated React output exposes `aria-expanded`/`aria-controls`, and
Arrow Up/Down, Home, and End move focus between headers. Section content remains bounded plain text.

After installing **QR / Barcode**, select QR or Code 128, enter the value, and configure caption,
colors, error-correction level, and quiet zone. QR values accept up to 2,048 characters; Code 128
accepts up to 128 printable ASCII characters. The canvas pattern is only a deterministic placeholder.
Generated React output creates the actual code locally with bundled libraries and makes no network
request; validate the result with a scanner before production use.

After installing **Markdown**, edit CommonMark or GFM source, link behavior, colors, type size, and
line height. The canvas renders a bounded plain-text approximation. Generated React output skips raw
HTML and accepts only safe anchors, root-relative paths, and canonical public HTTPS links; an unsafe
destination is rendered as text instead of a link. Markdown image syntax is shown as an inert
alt-text placeholder and never loads its `src`; use a reviewed Image node or explicit media module
when remote media is required. This is display content, not a rich-text write-back editor.

After installing **Code Block**, edit the inert source text and choose its language label, light/dark
theme, line numbers, wrapping, copy-button visibility, type size, tab size, and colors. The language
selection is metadata and presentation only: the current adapter does not execute, compile, validate,
or syntax-highlight the code. The generated copy button uses the browser clipboard when available and
reports failure instead of claiming success.

After installing **PDF Viewer**, configure either a safe root-relative path or a canonical public
HTTPS source, plus title, initial-page/page-count hints, fit, toolbar, download, and colors. Canvas is
an inert paper/metadata placeholder. Compiler Preview does not attach the URL until **Load PDF
preview** is pressed; exported Web/React output delegates rendering to the browser's sandboxed PDF
iframe, so page controls and format support vary by browser. Never place credentials or secrets in
the URL.

After installing **Audio Player**, configure either a safe root-relative path or a canonical public
HTTPS source, title/artist, controls, loop, mute, preload, volume, playback rate, and colors. Canvas is
an inert waveform placeholder. Compiler Preview does not attach the URL until **Load audio preview**
is pressed; exported Web/React output uses the browser's native audio element. Browser autoplay rules
still apply, and the module validator requires autoplay to be muted.

The **Static Design System Audit** engine produces a cancellable, bounded report across token
collection/mode consistency, missing or mismatched aliases/bindings, component-set variant structure,
an advisory four-pixel spacing scale, and broad typography scales. It scans at most 25,000 nodes,
10,000 variables, 1,000 collections, and 1,000 issue details, with a 512 KiB report cap. Truncation is
reported explicitly. It does not check runtime theme resolution, semantic naming/governance, visual
interaction states, font licenses or glyph coverage, responsive/type-run output, or final rendered
appearance. The command is available only in an Unreleased build that has completed its central
catalog and host-adapter registration.

The Unreleased **Next.js**, **Capacitor**, and **Electron** exporters create source ZIPs only. They do
not install packages, start a development server, execute generated code, produce platform binaries,
or configure production signing. Next.js keeps the authored runtime client-side rather than claiming
SSR conversion. Capacitor requires the developer to add and review Android/iOS projects after export.
Electron keeps its renderer sandboxed but still needs an application-specific packaging, permission,
update, and signing review before distribution. Read each generated `README.md` and
`EXPORT_WARNINGS.md` before building.

Expo and Flutter source exports do not add a WebView for any plugin module, including **Lottie**,
**Carousel**, **Advanced Data Grid**, and the seven Unreleased content modules above. They emit
explicit unsupported-feature warnings and retain authored static native fallbacks without the
interactive module behavior until reviewed native adapters exist. This preserves the native export
security boundary instead of silently shipping a browser surface inside the mobile app.

Installation and enablement are separate on purpose. A newly installed plugin starts disabled so
you can review it before exposing its modules, commands, exporters, connectors, or storage-provider
declarations. Only modules join the canvas toolbar and built-in AI/MCP module discovery.

A verified signature proves who published a manifest; it does not make an adapter available. If a
catalog entry has no compatible reviewed contribution adapter in this OpenPencil build—including a
module, command, exporter, connector, or storage provider—the store keeps the entry visible for
diagnosis but disables activation. Install a build that ships the reviewed adapter before using that
entry. A manifest can name an adapter, but it cannot supply or execute one.

Schema v1 keeps all contribution descriptions declarative. `contributions.modules` describes
native frame modules, `contributions.commands` describes named host actions, and
`contributions.exporters` describes named export actions plus their safe file extension. The
manifest still has an empty capability list. Every contribution must match an exact adapter that
was registered and frozen at application startup; no contribution receives arbitrary editor,
filesystem, network, Tauri, or process APIs.

Manifest API v2 is a stricter contract foundation for commands, exporters, connectors, and storage
providers. It adds bounded, closed parameter/result JSON schemas, declared permissions from the fixed `document.read`,
`document.selection.read`, `document.variables.read`, and `file.save` vocabulary, and explicit safe
extension/MIME pairs for exporter outputs. `file.save` reaches only the reviewed host save boundary;
there is no general `document.write` permission, and the top-level capability list remains empty.
API v2 does not create a general plugin SDK or open
arbitrary JavaScript execution, generic network access, unrestricted document mutation, or custom
UI. The host still requires an exact reviewed adapter for every contribution. The bundled catalog
is intentionally mixed-version: existing contributions remain schema v1, while Static
Accessibility Audit, the Unreleased Static Design System Audit, Design Tokens Exporter, and Figma
Editable Projection use schema v2 to bind their reviewed parameters, results, permissions, and
outputs. A storage-provider contribution has only the exact `providerId`, `name`, `description`,
`adapterId`, `configVersion`, and `capabilities` keys. `capabilities` is a bounded subset of
`documents.read`, `documents.write`, `documents.delete`, `changes.read`, and `uploads.resumable`.
These declarations are host compatibility metadata, not plugin permissions: a v2 manifest never
supplies its own network, OAuth, or executable implementation. Google Drive Storage is the bundled
schema v2 storage-provider declaration.

## Cloud documents with Google Drive

**Google Drive Storage** is installed and enabled on new profiles, but all behavior remains in a
reviewed, host-owned adapter. In the desktop app, open **Settings → Storage → Google Drive**. If the
client ID field is empty, expand **Advanced** and enter the OAuth client ID for this fork's Google
Desktop application, then choose **Connect**. OpenPencil opens the system browser, completes an
Authorization Code flow with PKCE through a temporary loopback callback, and requests only
`openid`, `email`, and `drive.file`. The `drive.file` scope limits the adapter to files the application
created or that the user explicitly opened with it; it is not full-Drive access. Refresh tokens stay
in the native system credential store, while the binding records only non-secret account identity and
grant version. Browser-only Google Drive authorization is not supported.

Each provider can keep up to eight named storage profiles. A profile has its own OAuth account or S3
credentials, non-secret provider settings, local document index, change cursor, and durable sync
authority. Switching profiles cancels stale UI work before the newly selected account is shown; it
does not migrate or reuse another profile's secrets.

Cloud storage is enabled only while both persistence layers prove that they are durable. Before an
open, create, refresh, save, delete, account disconnect, profile deletion, or S3 configuration
rotation, OpenPencil performs live IndexedDB probes against the local document index and the Outbox.
Both the database open and a real transaction must succeed. A production memory fallback is not
treated as durable: the cloud workspace enters read-only recovery, all of those actions stay blocked,
and the UI tells you to export any already-open work as a local `.fig`. In that state OpenPencil does
not claim that offline edits or queued work will survive a restart.

Reconnecting the same Google account first inspects the current grant's cached documents and durable
jobs. If unfinished, conflicting, or queued work exists, Settings asks for confirmation before it
opens the system browser. After Google returns the same OIDC account, OpenPencil adopts all cached
documents and jobs into the new random grant and resumes synchronization. If the app closes between
OAuth and that adoption, Settings detects the stale same-account grant and offers a repair action.
Disconnecting or deleting a profile is blocked while unfinished work still needs its credential.

Documents are ordinary, user-visible `.fig` files in Drive rather than hidden app-data blobs. After
the durability gate succeeds, a save writes the local cache first and records a durable Outbox job,
so offline work and pending uploads can recover after an app restart. Large uploads use resumable
sessions. A bounded per-account change cursor later discovers relevant remote changes; this is
incremental polling, not push-based live collaboration. Deleting from the Storage workspace hides
the document locally first and records a durable delete job; Google Drive then moves it to trash when
synchronization runs. Open editor tabs must be closed first so an unsaved edit cannot be discarded or
resurrect the document.

Pending outbox jobs are durable, but a resumable upload session URL is deliberately process-local and
never written to logs or local storage. If Drive may have committed an upload immediately before the
app crashes, but OpenPencil could not durably record the response, restart recovery preserves the
bytes as a conflict copy instead of guessing that the original is safe to overwrite. This may leave a
duplicate-looking recovery file, but it never silently discards either possible outcome.

For an existing file, the adapter compares the expected remote revision and uses the current ETag for
a conditional update. If the revision changed, a usable conditional authority is missing, or Drive
reports a concurrent-write conflict, OpenPencil leaves the original remote file untouched and creates
a timestamped `.fig` conflict copy. Google Drive is therefore a whole-document, eventually reconciled
storage target—not a strongly consistent collaboration backend or a CRDT. Use the collaboration
features intended for simultaneous editing when several people need to edit the same document live.

S3-compatible storage remains the advanced self-managed alternative for AWS S3, Backblaze B2,
Cloudflare R2, MinIO, and compatible services. It requires endpoint, bucket, region, and credential
configuration and does not inherit Google Drive's revision/change-feed guarantees. Every S3 profile
also has a stable incarnation and random configuration generation. Changing its endpoint, bucket,
region, or credentials rotates that generation; Settings blocks the change while pending, conflicting,
or deletion work exists, and old-generation jobs fail closed instead of running against a new bucket.
When a legacy authority-less profile first adopts an exact generation, Settings displays the exact
endpoint and bucket together with the affected workload and requires explicit confirmation. The
restartable migration atomically rekeys document metadata, `.fig` bytes, and thumbnails in the local
document store and atomically replaces matching Outbox jobs in that generation. A key collision,
incompatible target, or cross-generation state fails closed; endpoint, bucket, region, and credential
changes stay blocked until migration completes.

::: warning Release verification
Automated contract, adapter, and native-bridge tests do not prove a real Google OAuth client/account
flow. Before release, use a real Google Desktop OAuth client and two test accounts to complete this
manual checklist:

1. Connect through the system browser, inspect the exact `openid`, `email`, and `drive.file` consent,
   restart the desktop app, and verify the same profile reconnects without exposing a refresh token.
2. Create and reopen a visible `.fig`, edit it offline, restart with a pending outbox item, reconnect,
   and verify progress resumes without silent overwrite or data loss. A normal, unambiguous pending
   job should not duplicate the file; an intentionally simulated crash after an ambiguous remote
   success may preserve a clearly named conflict copy.
3. Interrupt a multi-chunk upload and download, then verify the resumed byte ranges keep one strong
   ETag and produce a parseable document.
4. Switch between two named profiles backed by different Google accounts and verify files, cursors,
   credentials, and queued work never cross account or authorization boundaries.
   Then reconnect one account while it has a pending edit, confirm the handoff, and verify the same
   queued work resumes under the new grant without a duplicate upload unless the remote result was
   deliberately made ambiguous, in which case a conflict copy is the expected safe outcome.
5. Change the same remote document from a second client and verify OpenPencil preserves a timestamped
   conflict copy rather than overwriting either edit.
6. Delete a closed document from the Storage workspace, test the offline queue and restart path, then
   verify the file appears in Google Drive trash and can be restored there.
7. Revoke access in Google, confirm OpenPencil requests a reconnect without blind retries, and inspect
   logs/keychain storage to ensure access tokens, refresh tokens, and resumable session URLs are absent.
   :::

## Business connectors

The Phase 2 Broker makes five bundled connectors executable: **Supabase Schema Inspector**,
**Airtable Records**, **Supabase Tables**, **Stripe Checkout & Billing**, and **Resend Email**. They
remain reviewed host integrations, not a generic network capability that any publisher can request.

These connectors are local, design-time operator tools inside the OpenPencil editor. They are not
compiled into generated applications and are not a server-side connector runtime. A credential is
kept out of the manifest, design document, Compiler output, audit log, and long-lived reactive UI
state, but the renderer-side reviewed request path resolves it into memory when a call is dispatched.
On desktop, persistence uses the system credential store and transport uses the bounded Tauri proxy;
this does **not** provide server-side secret isolation or claim to withstand a compromised renderer.
Use least-privilege development credentials (for Stripe, prefer a restricted key) and keep production
application secrets in infrastructure you operate. Generated-app server connectors are a later phase.

To use one:

1. Open **Settings → Plugins**, install the connector, and enable it.
2. Enter or replace the required credential on its installed-plugin card. OpenPencil saves the secret
   only through the central credential manager; the manifest, design document, Compiler output, and
   long-lived UI state keep no raw token.
3. Review the connector identity and authority, then choose **Authorize** for the current session.
   The grant binds the exact plugin, connector, reviewed adapter, and installed package digest. A
   version/digest change requires another authorization. Eligible read-only `GET` queries become
   available to connected MCP/AI clients and use the same saved credential while this grant exists.
4. Launch one of the listed operations from the connector card. Queries may also appear as dynamic
   MCP `query` tools after this explicit authorization. Mutations never appear in MCP and ask for a
   new human confirmation every time they are run from the UI.
5. Choose **Revoke**, disable, or uninstall when finished. These actions remove the query tool and
   stop matching local requests that are still in flight. An accepted package-digest change also
   invalidates the grant and stops work started under the old identity. A query can be reported as
   cancelled. If a mutation was already dispatched, however, an abort, timeout, authorization
   change, or local response-processing failure makes the remote outcome unknown; verify the
   service before retrying.

### Operation parameters and paste-ready examples

The operation runner accepts a closed JSON object: unknown properties are rejected. The examples
below contain no credentials and can be pasted into the **Parameters (JSON)** field. Replace example
IDs, addresses, and URLs with values from your own development account.

#### Supabase Schema Inspector

| Operation        | Required parameters  | Optional parameters | Bounds and behavior                                                                                                                                                                 |
| ---------------- | -------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inspect-schema` | `projectRef: string` | `schema: string`    | Both strings are 1–63 characters; `schema` defaults to `public`. The adapter accepts only a canonical lowercase project ref and calls the fixed Supabase Management API `GET` path. |

```json
{
  "projectRef": "project-ref",
  "schema": "public"
}
```

#### Airtable Records

| Operation      | Required parameters                 | Optional parameters                   | Bounds and behavior                                                                                                                               |
| -------------- | ----------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list-records` | `baseId: string`, `tableId: string` | `pageSize: integer`, `offset: string` | `pageSize` is 1–100 and defaults to 100. Only bounded stable IDs and a pagination cursor are accepted; formula/filter injection is not supported. |

```json
{
  "baseId": "appBase123",
  "tableId": "tblTable123",
  "pageSize": 25
}
```

Add the returned cursor as `"offset": "itrPage123/recLast123"` to request the next page.

#### Supabase Tables

| Operation     | Required parameters                        | Optional parameters           | Bounds and behavior                                                                              |
| ------------- | ------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `query-rows`  | `projectRef`, `table`                      | `columns`, `filters`, `limit` | Up to 64 columns, 16 filters, and 100 rows. `limit` is 1–100.                                    |
| `insert-rows` | `projectRef`, `table`, `records`           | —                             | 1–100 records; every record has 1–64 `{ name, valueJson }` fields.                               |
| `update-rows` | `projectRef`, `table`, `fields`, `filters` | —                             | At least one field and one filter are required. Strict PostgREST `max-affected=100` is enforced. |
| `delete-rows` | `projectRef`, `table`, `filters`           | —                             | At least one filter is required. Strict PostgREST `max-affected=100` is enforced.                |

Each filter is `{ "column": string, "operator": string, "valueJson": string }`. Supported
operators are `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, and `is`. `valueJson` is a
bounded JSON value encoded as a string—not executable code.

Query:

```json
{
  "projectRef": "project-ref",
  "table": "tasks",
  "columns": ["id", "title"],
  "filters": [{ "column": "status", "operator": "eq", "valueJson": "\"open\"" }],
  "limit": 10
}
```

Insert:

```json
{
  "projectRef": "project-ref",
  "table": "tasks",
  "records": [
    {
      "fields": [
        { "name": "title", "valueJson": "\"Ship\"" },
        { "name": "done", "valueJson": "false" }
      ]
    }
  ]
}
```

Update:

```json
{
  "projectRef": "project-ref",
  "table": "tasks",
  "fields": [{ "name": "done", "valueJson": "true" }],
  "filters": [{ "column": "id", "operator": "eq", "valueJson": "7" }]
}
```

Delete:

```json
{
  "projectRef": "project-ref",
  "table": "tasks",
  "filters": [{ "column": "done", "operator": "is", "valueJson": "false" }]
}
```

`update-rows` and `delete-rows` send
`Prefer: handling=strict, max-affected=100, return=minimal`; strict handling makes PostgREST reject
the request rather than silently ignoring the affected-row cap. RLS and the authenticated Supabase
user still determine which rows can be read or changed.

#### Stripe Checkout & Billing

| Operation                 | Required parameters                                      | Optional parameters | Bounds and behavior                                                                                        |
| ------------------------- | -------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `get-product`             | `productId`                                              | —                   | Canonical `prod_…` ID; read-only `GET`.                                                                    |
| `get-price`               | `priceId`                                                | —                   | Canonical `price_…` ID; read-only `GET`.                                                                   |
| `create-checkout-session` | `priceId`, `quantity`, `mode`, `successUrl`, `cancelUrl` | —                   | `quantity` is 1–100; `mode` is `payment` or `subscription`; both URLs must be canonical public HTTPS URLs. |

```json
{
  "productId": "prod_Product123"
}
```

```json
{
  "priceId": "price_Price123"
}
```

```json
{
  "priceId": "price_Price123",
  "quantity": 2,
  "mode": "subscription",
  "successUrl": "https://shop.acme.com/checkout/success?session_id={CHECKOUT_SESSION_ID}",
  "cancelUrl": "https://shop.acme.com/checkout/cancel"
}
```

For Checkout, the Broker creates a UUID `mutationAttemptId`, shows it in the confirmation review,
and sends it as Stripe's `Idempotency-Key`. If a dispatched request returns an unknown outcome, the
restored review retains that same ID so an intentional retry can use the same key. Do not create a
new review until you have checked Stripe; Stripe's own idempotency retention and conflict rules still
apply.

#### Resend Email

| Operation    | Required parameters                                        | Optional parameters         | Bounds and behavior                                                                                                   |
| ------------ | ---------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `get-email`  | `emailId`                                                  | —                           | Bounded Resend email ID; read-only `GET`.                                                                             |
| `send-email` | `from`, `to`, `subject`, and at least one of `text`/`html` | `cc`, `bcc`, `text`, `html` | Each recipient list contains 1–50 bounded addresses. Attachments, arbitrary headers, and arbitrary URLs are rejected. |

```json
{
  "emailId": "4ef9a417-02e9-4d39-ad75-9611e0fcc33c"
}
```

```json
{
  "from": "OpenPencil <sender@example.com>",
  "to": ["reader@example.com"],
  "subject": "Connector review",
  "text": "The reviewed connector is ready."
}
```

For `send-email`, the Broker likewise sends the reviewed UUID `mutationAttemptId` as Resend's
`Idempotency-Key` and retains it when the same unknown-outcome review is restored. The key reduces
duplicate sends only within Resend's provider-defined idempotency window; always verify the service
before retrying.

For every call, the Broker rechecks installation, enablement, accepted digest, session grant, exact
contract, operation, and reviewed host adapter. The adapter can prepare only the declared bounded
path/query/body fields. The Broker alone resolves and injects the reviewed bearer or API-key
credential, enforces the
exact public HTTPS origin or reviewed origin template, HTTP method and path template, sets
`credentials: 'omit'`, rejects redirects, and applies timeout and request/response-size limits.
Desktop calls go through a bounded Tauri proxy. Provider JSON is normalized and validated against a
closed result schema before it reaches the UI or MCP.

Connector audit entries retain operation identity, outcome, timing, and byte counts, but not request
parameters, response bodies, or credentials. Supabase Auth/Storage, connector OAuth authorization flows, and
binary streaming are not implemented yet. Arbitrary publisher JavaScript/native code, background
services, endpoints, headers, and general network access remain unavailable.

Session grants, pending-operation state, and unknown-outcome notices are intentionally local and
session-only. A hard application/OS crash after dispatch cannot durably prove cancellation or retain
an in-memory notice; the remote mutation may already have succeeded. After any such restart, inspect
Supabase, Stripe, or Resend before submitting another mutation. Stripe/Resend idempotency keys reduce
duplicate effects for an intentional same-attempt retry, but do not turn an unknown outcome into a
confirmed failure and do not protect Supabase row mutations.

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

Enabling a plugin makes its reviewed modules, commands, exporters, connectors, and storage-provider
declarations available. Modules also become available for new insertion and for `list_modules` /
`create_module`. Disabling or removing the plugin prevents new module instances, blocks its commands
and exporters, revokes its connector authorization, and stops local waiting for matching connector
calls that are still in flight. A dispatched mutation is reported as outcome unknown rather than
falsely reported as cancelled.

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
handler. Compatible modules, commands, and exporters project to add, run, and export tools
respectively. An explicitly authorized read-only connector query whose fixed method is `GET` projects
to a query tool; connector mutations stay UI-only with per-invocation confirmation. Installation or
enablement alone does not authorize a connector tool.

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

The five bundled connectors use a separate, bounded host Broker and do not relax the publisher
runtime boundary. Supabase Auth/Storage, connector OAuth authorization flows, and binary streaming remain
future connector work. Publisher manifests and WASM packages still cannot add arbitrary network
origins, request handlers, JavaScript/native code, or background services.

The WASM channel does not expose Tauri IPC, and remote marketplace data is rendered as text rather
than executable markup. Host-wide Tauri hardening is nevertheless a separate release lane: the
desktop shell still needs a production CSP, an explicit local-origin navigation policy, debug-only
automation capabilities, and narrower filesystem/shell scopes before the project should claim a
fully hardened hostile-renderer boundary. Do not add remote origins to the default Tauri capability
or load plugin HTML/JavaScript into the main WebView.

For the package contract, deployment configuration, and publisher workflow, see
[Plugin Architecture](../development/plugins).
