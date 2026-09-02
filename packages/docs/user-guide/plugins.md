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

The current **Unreleased** source line contains 68 reviewed plugins with 73 contributions: 20
modules, 13 commands, 13 exporters, 22 connectors, four storage providers, and one Backend Provider. A definition,
renderer, contract, or exporter source file alone does not make a plugin available; the contribution
must also have its reviewed central host registration. Map, Google Drive Storage, OneDrive Storage,
Aliyun Drive Storage, Baidu Netdisk Storage, Supabase Backend Provider, Compiler Preview Popout, and AI Popout are installed and enabled on a new profile; every other bundled
plugin is opt-in.

- **Map** is installed and enabled on a new profile. It creates a native editable map `FRAME` and
  compiles to the reviewed MapLibre-based React adapter.
- **Google Drive Storage** is an installed-and-enabled, host-owned storage-provider declaration. Its
  manifest supplies no network, OAuth, or executable implementation; connect the reviewed desktop
  adapter from **Settings → Storage**.
- **OneDrive Storage** is an installed-and-enabled, host-owned storage-provider declaration for the
  Tauri desktop app. Its reviewed adapter is confined by Microsoft Graph to OpenPencil's app folder;
  connect it from **Settings → Storage**.
- **Aliyun Drive Storage** is an installed-and-enabled, host-owned storage-provider declaration. Its
  reviewed adapter is confined by Aliyun Drive's folder-style authorization root; connect it from
  **Settings → Storage**.
- **Baidu Netdisk Storage** is an installed-and-enabled, host-owned storage-provider declaration. Its
  reviewed adapter is confined to `/apps/OpenPencil`; connect it from **Settings → Storage**.
- **Supabase Backend Provider** is an installed-and-enabled, data-only declaration backed by the
  exact Compiler/App adapter shipped with OpenPencil. It can validate, plan, and emit deterministic
  local schema/RLS/function/config artifacts; enabling it never connects an account, applies a
  migration, changes RLS, or deploys a function. Production Apply remains a separately confirmed
  host operation. MCP/AI receives only the reviewed `audit` and `plan` tools: each accepts `target`
  and `mode`, returns bounded secret-free planning metadata, and cannot read credentials, emit files
  or SQL, apply migrations, or deploy. See [Backend Provider Architecture](/development/backend-providers).
- **Compiler Preview Popout** is installed and enabled on a new profile and is available only in the
  Tauri desktop application. Use **Pop out** in the Compiler Preview toolbar to open the active local
  preview in a separate window. The plugin receives no URL, window label, or native window options:
  the host derives the URL from the current loopback preview server and route and uses fixed window
  parameters. This UI command is not exposed to MCP. Disabling or uninstalling the plugin removes the
  entry and closes an open compiler-preview window.
- **AI Popout** is installed and enabled on a new profile and is available only in the Tauri desktop
  application. Use the pop-out control in the **AI** tab to open the active conversation in a separate
  window. The main editor remains the only owner of the AI transport, ACP process, credentials,
  document context, and tool execution; the window receives only a bounded, redacted message
  projection and sends a closed set of actions back to the host. Disable the plugin to remove the
  entry and close its window. This UI command is not exposed to MCP.
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
- **Dropdown Menu** is an opt-in flat menu with click or hover activation, 12 reviewed placements,
  item/divider rows, shortcut hints, and explicit disabled and danger states. Destinations may be
  empty or use a safe document path, anchor, or public HTTPS URL; v1 has no submenus or callbacks.
- **Upload Button** is an opt-in local file picker with bounded accepted-type tokens, file-count and
  per-file-size limits, drag-and-drop, and an optional selected-file list. It validates local
  selections but never uploads or persists their contents.
- **Modal** is an installable dialog trigger with a bounded plain-text title and body, independently
  visible trigger icon/text, configurable dismissal controls, footer actions, colors, and responsive
  panel width. It does not accept HTML, script, remote content, or credentials.
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
- **Vue Exporter** packages a source-only Vite + Vue 3 + TypeScript + Tailwind project. It emits
  editable `.vue` SFCs, Vue Router v4 for multiple pages, local images under `src/assets/**`, and
  basic reactive state, bindings, events, route/query parameters, Toast/Confirm feedback, local form
  validation, and real Modal, Dropdown Menu, Slide Menu, and local-only Upload Button runtimes. Vue
  v1 records unsupported
  advanced runtimes in `EXPORT_WARNINGS.md` instead of claiming React feature parity. Its UI and MCP
  paths share disposable compiler and ZIP Workers; cancellation terminates the active Worker without
  detaching live image buffers. The plugin exporter can reuse retained, cached, or bundled font bytes
  only after exact digest and redistribution-license review, and writes `FONT-LICENSES.txt` when it
  includes them.
- **WeChat Mini Program Exporter** emits native WXML, WXSS, JavaScript, page configuration, and
  reviewed local raster assets. It never supplies an AppID or invokes WeChat Developer Tools.
- **Taro Exporter** emits a pinned, source-only Taro React project with native page routes and local
  assets; dependency installation and `taro build` remain developer actions after export.
- **uni-app Exporter** emits an HBuilderX-compatible Vue project with `App.vue`, `pages.json`, native
  pages, components, and local assets; it does not launch HBuilderX or cloud build services.
- **Mpx Exporter** emits an Mpx source project with `.mpx` pages/components and reviewed local assets;
  package installation and the Mpx/WeChat build toolchain remain outside OpenPencil.
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
- Seventeen **external-service connectors** are opt-in and read-only: Neon Projects, Sentry Issues,
  HubSpot Contacts, Apollo Lists, PostHog Insights, Asana Workspaces, Zotero Top Items, HeyGen
  Avatars, Linear Issues, OpenAI Models, Box Root Items, Slack Public Channels, Google Calendar
  Events, SharePoint Root Site, Outlook Mail Folders, Outlook Calendar Events, and Microsoft Teams.
  Each one uses a fixed host-reviewed request and closed result schema; see the credential and scope
  table below before enabling one.
- **Application Security Readiness** is an opt-in local command that performs a read-only,
  cancellable, resource-bounded static production-readiness review. It returns fixed issue codes,
  counts, and remediation without document content or secrets. It is not a complete security
  assessment, penetration test, certification, or guarantee.
- **Vercel Deployment** and **Cloudflare Pages Deployment** expose only safe deployment-plan review
  commands to MCP. Actual deployment is a separate installed-plugin UI action that requires a fresh
  human confirmation for every invocation; MCP cannot execute it.

Install and enable a plugin, then use its editor entry point. Insert modules from the **Plugins**
menu in the canvas toolbar, run copy commands from **Edit → Clipboard Toolkit**, and use the enabled
entries under **File → Export** for Tauri, Next.js, Vue, Capacitor, Electron, Expo React Native,
Flutter, WeChat Mini Program, Taro, uni-app, or Mpx
source. Audits and exporters also remain available from their enabled installed-plugin cards when the
current build has registered their reviewed host adapters. Enabled modules, Clipboard commands,
Static Accessibility Audit, Static Design System Audit, Application Security Readiness, the two safe
deployment-plan reviews, Design Tokens Exporter, and Vue Exporter expose dynamic MCP tools after their plugin is
installed and enabled. A connector card also shows its central credential status, current-session
authorization, revocation, and reviewed operation launch controls. A connector query appears in MCP
only after the plugin is installed, enabled, has a saved credential, and is authorized for the exact
connector/adapter/package digest in the current session. Eligible read-only contracts use fixed
`GET` or an explicitly host-reviewed fixed `POST`; arbitrary `POST` and connector mutations remain
unavailable to MCP. Disable, uninstall, revoke, or clear the credential and the tool disappears
immediately. UI mutations continue to ask for confirmation on every run.
Source/projection exporters whose Compiler or encoder stage cannot cooperatively
cancel—including Tauri, Next.js, Capacitor, Electron, Expo, Flutter, and Figma—remain UI-only so an
MCP timeout cannot leave an export occupying the editor. These actions still use the same reviewed
host adapters. Vue source export terminates its bounded compiler or ZIP Worker on cancellation and keeps
checking through the final atomic write boundary, so its tool appears only while the opt-in plugin is
installed and enabled and disappears immediately on disable or uninstall. The Worker snapshot fails
closed above 25,000 nodes, 4,096 images, or 32 MiB including complete binary backing buffers; Worker
output and the path-safe ZIP retain 4,096-file/64-MiB ceilings. Modules create native editable
`FRAME` nodes rather than opaque browser surfaces.

WeChat Mini Program, Taro, uni-app, and Mpx exports also use cooperatively cancellable compiler and
archive Workers, but remain UI/menu-only. Their real platform build, package, permission, AppID, and
signing review is an explicit post-export gate rather than an MCP capability.

While any plugin exporter runs, its installed-plugin card shows choosing, preparing, compiling,
archiving, saving, or cancelling status and provides a keyboard-accessible **Cancel** action when the
adapter supports it. Only one plugin export runs at a time. OpenPencil blocks disable, update,
rollback, and uninstall for the exporting plugin until the session finishes; reopening Settings
continues to show the host-owned session instead of starting a duplicate export.

The current Expo static MVP supports native `View`, `Text`, `Image`, `ImageBackground`, `Pressable`,
`TextInput`, and `Switch` shells; basic inline layout and visual styles; single-page output or
Expo Router page files; and static images. The presence of a native control
shell does not mean its authored web state/action runtime has been translated. All 20 plugin
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
left, right, top, or bottom entrance, edit the trigger/title/description and destinations,
independently show or hide the vector menu icon and trigger text, and set the panel size, colors,
backdrop opacity, backdrop dismissal, and close-button visibility. Even when both trigger visuals
are hidden, generated React and Vue keep the configured trigger text as the button's accessible name.
In Compiler Preview and exported React/Vue/Tauri projects, activating the authored trigger renders the
panel in a local `document.body` portal. Escape always dismisses it, keyboard focus stays inside
while open and returns to the trigger after close, and reduced-motion preferences suppress the
sliding transition. Menu links accept only document paths beginning with `/`, local anchors
beginning with `#`, or canonical public HTTPS URLs; labels and descriptions remain plain text.

After installing **Dropdown Menu**, use **Design → Module** to configure click or hover activation,
one of 12 placements, dismissal rules, width, colors, and the trigger label/chevron. The dedicated
item editor keeps entries in collapsible groups, offers separate **Add item** and **Add divider**
actions, and edits plain-text label, destination, shortcut hint, disabled state, and danger state.
At least one real item must remain and the menu accepts at most 20 total entries. Disabled and danger
states are shown with text and checkboxes rather than color alone. In v1 the menu is deliberately
flat: it accepts no submenu tree, HTML, script, business callback, or credential. The MCP add-module
tool appears only while the plugin is both installed and enabled and is revoked immediately when the
plugin is disabled or removed. Compiler Preview and exported React/Vue/Tauri projects emit the real
menu runtime with arrow-key navigation, Escape/Tab/outside dismissal, and safe local/public links.

After installing **Upload Button**, use **Design → Module** to edit the trigger, accepted file
types, single- or multi-file mode, count and per-file-size limits, drag-and-drop, selected-file list,
helper copy, and colors. Accepted types are edited one token at a time, for example `.png`,
`image/*`, or `application/pdf`; duplicates and invalid tokens are rejected without changing the
document. The browser's `accept` attribute is only a chooser hint, so the generated runtime still
validates every selected file against the authored type, count, and size limits. This module selects
files only on the user's device: it does not upload, persist, report transfer progress, or claim
success. Use the existing low-code **INPUT + Supabase upload** workflow for server storage. Its MCP
add-module tool exists only while the plugin is installed and enabled and carries declarative
configuration only—never selected file names or file bytes. The same local-only validation and clear
not-uploaded status run in generated React/Vue/Tauri projects.

After installing **Modal**, edit its trigger, title, multiline body, close/Escape/backdrop rules,
cancel and confirm labels, footer alignment, colors, opacity, and panel width under
**Design → Module**. Compiler Preview and exported React/Vue/Tauri projects open a responsive local
`document.body` portal, trap focus while open, restore it to the trigger after close, and suppress
transitions for reduced-motion users. The top-right close control and footer actions use native
buttons with keyboard focus; cancel and confirm close the v1 dialog and do not imply an application
mutation or callback. Canvas stays deterministic and offline, while Expo/Flutter exports emit an
explicitly non-interactive static trigger until native modal behavior is implemented. All configured
copy is rendered as bounded text, never HTML.

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

The **WeChat Mini Program**, **Taro**, **uni-app**, and **Mpx** exporters also create source ZIPs
only. They compile the same SceneGraph pages and shared IR into four platform-specific project
layouts rather than wrapping React output. Local PNG/JPEG/GIF/WebP assets stay inside the project;
native page routing is generated; unsupported Motion, module, provider, server, remote-code, and web
behavior is listed in `EXPORT_WARNINGS.md`. Custom font bytes, credentials, AppID/AppSecret values,
arbitrary remote URLs, and local file paths are omitted. OpenPencil never installs these projects'
dependencies, runs their build tools, opens an IDE, signs a package, or claims device compatibility.

The **Vue Exporter** also creates a source ZIP only and never installs packages, runs the generated
application, or starts Vite. Vue v1 emits portable image assets, editable components, Vue Router v4
pages, route/query reads and safe parameterized navigation, basic reactive state/bindings/events,
Toast/Confirm feedback, local form validation, and real Modal, Dropdown Menu, Slide Menu, and
local-only Upload Button runtimes. Toast supports info/success/error feedback, six positions,
duration, duplicate suppression, dismissal, and an accessible bounded stack. Confirm uses authored
button labels and both branches, supports backdrop/Escape cancellation, traps keyboard focus, and
restores focus after closing. Local validation covers required, pattern, minimum/maximum length or
value, and custom-expression rules; it exposes inline/summary errors, updates `aria-invalid` and
`aria-describedby`, and prevents invalid submit handlers from running. Remote asynchronous validation
does not contact its configured URL: it blocks submission with a generic unavailable error and adds
`vue-validation-async-unsupported` to `EXPORT_WARNINGS.md`. Routerless single-page exports leave
route/query context empty and warn. Authored raw HTML is replaced by an empty static shell with
`vue-raw-html-unsupported`; the exporter never places that payload in a `v-html` binding. Other
plugin modules, Motion, prototypes and overlays, Supabase/auth/server workflows, Stripe, i18n,
analytics, React UI kits, theme switching, and persisted document state remain omitted or reduced
with deterministic `vue-*-unsupported` warnings.

The plugin exporter's no-network font pass reuses only exact bytes already retained by the renderer,
present in its imported/downloaded cache, or shipped as a reviewed bundled asset. It audits every
candidate's OpenType embedding flag and SHA-256 digest. A face is copied only when its redistribution
license, copyright, and full notice are all reviewed; the archive then contains
`FONT-LICENSES.txt`. Restricted, mismatched, or incomplete faces are omitted with explicit warnings
while authored family CSS stays intact. Review `EXPORT_WARNINGS.md` before treating the generated app
as production-complete. Documents outside the bounded Worker limits must be reduced or split before
export; the exporter does not silently fall back to synchronous compilation.

For development or automation, `openpencil compile`, `openpencil build`, and `openpencil deploy` all
accept `--target vue`; React remains the default. The desktop Compiler Preview **Target** control can
switch between React and Vue 3 and restarts the matching sidecar. Vue supports static Vite builds and
Netlify, Vercel, or Cloudflare Pages deployment, but React-only `--i18n`, locale, and `--ui-kit`
options are rejected rather than ignored.

In editor Preview, React and Vue both highlight the canvas selection, let Alt/Option-click select a
preview element back on the canvas, synchronize page navigation in both directions without echoing,
mirror collaborative document-state changes, and apply Light/Dark theme changes immediately. This
bridge exists only in editor Preview; source/static exports do not include it. Vue still has no
Motion runtime, so Motion Debug reports **unavailable** immediately rather than waiting forever.

Static builds write only to a nonexistent/empty output directory or replace a directory whose valid,
regular-file `.openpencil-build-output.json` marker came from a preceding OpenPencil build and whose
complete file set still exactly matches that manifest. A non-empty unmarked directory, untrusted
marker, or any missing/extra file is rejected instead of being deleted; choose another empty output
directory or remove the unrelated files yourself after reviewing them.

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
supplies its own network, OAuth, or executable implementation. Google Drive Storage, OneDrive
Storage, Aliyun Drive Storage, and Baidu Netdisk Storage are the bundled schema v2 storage-provider
declarations.

## Cloud documents with Google Drive

**Google Drive Storage** is installed and enabled on new profiles, but all behavior remains in a
reviewed, host-owned adapter. Its default official connection takes the public Google Desktop OAuth
Client ID only from `VITE_GOOGLE_DRIVE_CLIENT_ID` at build time; profiles cannot override that identity,
and release builds never bundle the publisher's client secret. In the desktop app, open
**Settings → Storage → Google Drive**, then choose **Connect**. Official Tauri builds compile a canonical
HTTPS token Broker origin through `OPENPENCIL_GOOGLE_DRIVE_OAUTH_BROKER_ORIGIN`. Native Rust sends the
Broker only the one-time code, PKCE verifier and loopback URI for exchange, or the locally decrypted
refresh token for refresh. The stateless Broker injects the publisher credential; Drive API and
`.fig` traffic remain direct between the desktop and Google. Missing or invalid release Broker
configuration fails closed with no cross-backend retry.

The desktop-only **Advanced / self-hosted** option can explicitly import a downloaded Google Desktop
`credentials.json` for one profile. This is a separately tagged custom-client mode, never a profile
override of the official client. OpenPencil consumes only `installed.client_id` and
`installed.client_secret`; imported authorization, token, or redirect URI values are ignored. The host
keeps the Google authorization/token/userinfo/revoke endpoints, exact `openid`, `email`, and
`drive.file` scopes, temporary loopback callback, and PKCE behavior fixed. The custom client identity,
client secret, and refresh token live together in one encrypted authorization envelope; neither the
original JSON nor its path is retained. A Desktop `client_secret` cannot remain confidential once it
is distributed, but OpenPencil still treats it as sensitive and keeps it out of manifests,
preferences, logs, errors, long-lived UI state, build variables, and the repository. Custom-client
mode calls Google directly and never falls back to the official Broker; the official path never falls
back to imported credentials.

Both supported connection modes open the system browser and use a
[public installed-app client](https://developers.google.com/identity/protocols/oauth2/native-app).
The `drive.file` scope limits the adapter to files the application created or that the user explicitly
opened with it; it is not full-Drive access. Rust stores refresh tokens in a versioned encrypted vault
under Tauri's fixed app-local-data directory, while the binding records only non-secret account identity and
grant version. Each record uses AES-256-GCM with a fresh random nonce; the random master key is a separate
private file in the same directory. This path does not persist a WebCrypto key and does not use macOS
Keychain. It prevents plaintext credential snapshots, but it is not protection from the same OS user, a
compromised main renderer, rollback, or a backup containing both the key and vault. Browser-only Google
Drive authorization is not supported.

A Broker outage pauses new token exchange or refresh but does not block local editing or discard the
durable Outbox. Publisher faults and revoked grants pause affected jobs until the build is repaired or
the same account is explicitly reconnected.

When upgrading from an IndexedDB- or Keychain-backed desktop build, OpenPencil neither imports nor
deletes the old records. Connect Google Drive again and enter other saved credentials once; the old
IndexedDB database and macOS Keychain items stay untouched until you remove them separately.

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
manual checklist through the official Broker. If advanced mode ships, repeat consent, restart,
refresh, revoke, and Drive operations with an explicitly imported Desktop `credentials.json` from a
separate Google project, and verify that neither mode contacts the other's token backend:

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
   logs plus the app-local credential vault to ensure access tokens, refresh tokens, and resumable session
   URLs are absent in plaintext. On macOS, verify OpenPencil creates neither a WebKit WebCrypto master-key
   item nor any other new credential item in Keychain.
   :::

## Cloud documents with OneDrive

**OneDrive Storage** is installed and enabled on new profiles, but authorization and Microsoft Graph
operations are available only in the Tauri desktop app through a reviewed, host-owned adapter. The app
publisher must register a Microsoft Entra **public client / desktop application** and provide its
public Client ID at build time through `VITE_ONEDRIVE_CLIENT_ID`. OpenPencil does not need, accept, or
bundle a Client Secret. In the desktop app, open **Settings → Storage → OneDrive**, then choose
**Connect**. Browser-only OneDrive authorization is not supported.

Configure the Entra app before building:

1. Name the registration **OpenPencil**, then select **Accounts in any organizational directory and
   personal Microsoft accounts** as the supported account type. The registration name determines
   the user-visible app-folder name.
2. Under **Authentication**, add the **Mobile and desktop applications** redirect URI
   `http://localhost` and enable public-client flows.
3. Under **API permissions**, add the delegated Microsoft Graph permission
   `Files.ReadWrite.AppFolder`. Do not create or configure a Client Secret for OpenPencil.
4. For a local build, pass the public ID to the same shell that launches Tauri:
   `VITE_ONEDRIVE_CLIENT_ID=00000000-0000-0000-0000-000000000000 bun run tauri dev`. A value loaded
   only by Vite from `.env.local` does not reach Rust's compile-time `option_env!`. Release builds use
   the GitHub Actions repository variable with the same name.

The native host fixes the Microsoft identity-platform tenant to `common`, allowing both personal
Microsoft accounts and work or school accounts. It opens the system browser and completes an
Authorization Code flow with S256 PKCE through a random `localhost` loopback callback. The requested
and accepted scope set is exactly `openid`, `profile`, `email`, `offline_access`, and
`https://graph.microsoft.com/Files.ReadWrite.AppFolder`; grants containing broader
`Files.ReadWrite` or `Files.ReadWrite.All` permissions are rejected. The verified OpenID Connect
subject identifies the account authority, and refresh tokens stay in the Rust-owned encrypted vault.

Microsoft Graph resolves `special/approot` to the app folder displayed as `Apps/OpenPencil`.
OpenPencil creates and manages its document hierarchy only below that resolved root. The
`Files.ReadWrite.AppFolder` permission makes this a service-enforced boundary rather than a UI rule or
path-prefix check: the adapter has no fallback to arbitrary OneDrive files. Documents still use the
shared local-first cache and durable Outbox. Large files use resumable uploads, updates are conditioned
on the current ETag, concurrent changes preserve a timestamped conflict copy, and deletion moves the
remote item through OneDrive's recycle-bin behavior.

::: warning Release verification
Automated contract, adapter, and native-bridge tests do not prove a real Microsoft Entra client or
OneDrive account flow. Before release, use the configured public Desktop Client ID with both a personal
Microsoft account and a work or school account. Verify the exact consent screen, restart and refresh,
upload and download (including interrupted transfers), a second-client conflict copy, and deletion/recycle-bin
behavior. These real consent, restart, upload, download, conflict, and delete checks remain a manual
release gate until they have been completed on the distributed Tauri build. Microsoft currently labels
the delegated `Files.ReadWrite.AppFolder` permission as Preview in the Graph permission reference, so
tenant availability and consent behavior must also be checked before every release.
:::

## Cloud documents with Aliyun Drive

**Aliyun Drive Storage** is installed and enabled on new profiles, while authorization and data
operations remain in the reviewed desktop host. Official builds accept only the public OAuth client
ID in `VITE_ALIYUN_DRIVE_CLIENT_ID`, the canonical HTTPS token-service origin in
`OPENPENCIL_ALIYUN_DRIVE_OAUTH_BROKER_ORIGIN`, and the exact registered callback in
`OPENPENCIL_ALIYUN_DRIVE_REDIRECT_URI`. These are public build coordinates, not a Client Secret.
The official callback is a fixed `http://127.0.0.1:<port>/oauth/aliyun-drive/callback` loopback URI registered for the desktop
client. The publisher-managed confidential grant keeps its Client Secret in the Broker and rotates
refresh tokens; the Broker never proxies Aliyun Drive API requests or `.fig` bytes.

Authorization uses S256 PKCE and the exact comma-separated scopes
`user:base,file:all:read,file:all:write`, with `style=folder` and the recommended `drive=backup`.
After consent, Aliyun Drive returns a `folder_id` from `/adrive/v1.0/user/getDriveInfo`; the service
enforces that folder as the accessible root. This is not a client-side path-prefix convention.
The explicit **Advanced / self-hosted** path may import either the user's confidential Client ID and
Client Secret or a public-app Client ID, together with its separately registered fixed loopback
callback. The public-app flow documents a roughly 30-day access token and no refresh token, so that
mode requires explicit reauthorization after expiry. Neither self-hosted mode falls back to the
official Broker, and the official profile never falls back to imported configuration. Aliyun Drive does not expose a
usable change feed or ETag/`If-Match` conditional content update for this integration: the manifest
therefore omits `changes.read`, refresh uses bounded folder listing, and the UI must not claim the
same remote-precondition guarantees as Google Drive or OneDrive.

::: warning Release verification
Contract and adapter tests do not prove a real Aliyun Open Platform grant. Before release, verify the
fixed loopback callback and Broker TLS, exact scopes and folder-style consent, the service-enforced root,
refresh-token rotation and public-mode expiry behavior, reconnect/adoption, upload/download/resumable transfer, trash, and
conflict preservation with real accounts. Complete any provider production-app review or account
allowlisting before calling the distributed build ready.
:::

## Cloud documents with Baidu Netdisk

**Baidu Netdisk Storage** is installed and enabled on new profiles. Official builds contain only the
public App Key from `VITE_BAIDU_NETDISK_APP_KEY` and the canonical HTTPS token-service origin from
`OPENPENCIL_BAIDU_NETDISK_OAUTH_BROKER_ORIGIN`. Authorization uses the device-code endpoint with the
exact `basic,netdisk` scope. Baidu requires the application's `SecretKey` for both the
`grant_type=device_token` exchange and refresh, so that value belongs only in the hosted Broker and
must never enter a Tauri artifact, Vite environment, manifest, log, or document. The Broker handles
only token exchange and refresh; Baidu API calls and `.fig` bytes stay direct between the desktop and
Baidu Netdisk.

Every remote document stays below the fixed `/apps/OpenPencil` application directory; the adapter
does not request or emulate a broader root. The explicit **Advanced / self-hosted** path may use the
user's own App Key and SecretKey. It stores that pair and the rotating refresh token together in the
native encrypted vault, retains neither an imported source file nor its path, and never falls back to
the official Broker. The bundled manifest omits `changes.read`; remote reconciliation remains a
bounded whole-document process rather than a change-feed or collaboration guarantee.

::: warning Release verification
A Baidu personal developer account can create one application. Personal use without production
review is limited to ten users; public distribution requires Baidu's production launch review.
Before release, submit the exact API inventory and necessity, test account, OAuth and core-flow
recording, and security and privacy explanation requested by the provider. Then verify a real
device-code grant, restart and refresh, upload/download/resumable transfer, `/apps/OpenPencil`
confinement, reconnect/adoption, conflict preservation, and trash behavior in a distributed Tauri
build. Automated tests cannot clear these account and review gates.
:::

## Application Security Readiness

Install and enable **Application Security Readiness** to run a local static review from its plugin
card or from the dynamically registered MCP command. The command inspects only the public low-code
structure and bounded runtime-readiness signals for configuration, data access, transport/server
posture, privacy, and custom code. It is read-only, cooperatively cancellable, and resource-bounded.
Its fixed result contains issue codes, severities, counts, and static remediation; it does not echo
document content, input values, credentials, or other secrets.

This is an early production-readiness signal, not a complete application-security assessment,
penetration test, dependency or infrastructure scan, compliance certification, or guarantee of
security. Installation and enablement are sufficient for its local MCP command; it does not request
a credential or network/session connector grant. Disabling or uninstalling the plugin removes the
MCP command immediately.

## Reviewed deployment plugins

The opt-in **Vercel Deployment** and **Cloudflare Pages Deployment** plugins deliberately separate
planning from deployment:

- Their dynamic MCP commands, `review-vercel-deployment-plan` and
  `review-cloudflare-pages-deployment-plan`, only validate and disclose a bounded plan. They do not
  resolve a token, build the document, perform a network request, or change local or remote state.
- Actual deployment is available only from the installed-plugin card. Every invocation requires a
  new human confirmation that shows the provider, target, environment, and reviewed document.
  OpenPencil rechecks that document after confirmation and after credential lookup, before any
  remote dispatch. Only then does it build the saved document and upload the generated static files.
- Vercel requires a manually created account token. Cloudflare Pages requires a manually created API
  token plus the target account ID and project name. Keep both tokens least-privilege and use a
  non-production target for initial validation.
- MCP cannot invoke the real deployment adapter. If the UI is interrupted after upload dispatch,
  the remote result can be unknown; inspect the provider before retrying.
- Deployment progress and its bounded result survive closing or switching Settings. While a remote
  deployment is active, the plugin cannot be disabled, updated, rolled back, or uninstalled. Save As
  during an in-flight deployment keeps the result and history attached to the document that was
  reviewed instead of silently assigning it to the new document.

Installing and enabling either plugin adds only its safe plan command to MCP. Disabling or
uninstalling removes it immediately. The credential is required for the confirmed UI deployment,
not for plan review, and clearing it prevents a later UI deployment from starting.

## Business connectors

The Phase 2 Broker makes 22 bundled connectors executable: the existing **Supabase Schema
Inspector**, **Airtable Records**, **Supabase Tables**, **Stripe Checkout & Billing**, and **Resend
Email** integrations plus 17 opt-in, read-only external-service connectors. They remain reviewed host
integrations, not a generic network capability that any publisher can request.

These connectors are local, design-time operator tools inside the OpenPencil editor. They are not
compiled into generated applications and are not a server-side connector runtime. A credential is
kept out of the manifest, design document, Compiler output, audit log, and long-lived reactive UI
state, but the renderer-side reviewed request path resolves it into memory when a call is dispatched.
On desktop, Rust persists each value in the AES-256-GCM app-local vault described above, while transport
uses the bounded Tauri proxy. The key and vault share the same OS-user data directory, so this does
**not** provide server-side secret isolation or claim to withstand a compromised renderer, same-user
malware, or a combined backup.
Use least-privilege development credentials (for Stripe, prefer a restricted key) and keep production
application secrets in infrastructure you operate. Generated-app server connectors are a later phase.

To use one:

1. Open **Settings → Plugins**, install the connector, and enable it.
2. Enter or replace the required credential on its installed-plugin card. OpenPencil saves the secret
   only through the central credential manager; the manifest, design document, Compiler output, and
   long-lived UI state keep no raw token.
3. Review the connector identity and authority, then choose **Authorize** for the current session.
   The grant binds the exact plugin, connector, reviewed adapter, and installed package digest. A
   version/digest change requires another authorization. Eligible read-only fixed `GET` or explicitly
   host-reviewed fixed `POST` queries become available to connected MCP/AI clients and use the same
   saved credential while this grant exists. Arbitrary `POST` is not allowed.
4. Launch one of the listed operations from the connector card. Queries may also appear as dynamic
   MCP `query` tools after this explicit authorization. Mutations never appear in MCP and ask for a
   new human confirmation every time they are run from the UI.
5. Choose **Revoke**, clear the credential, disable, or uninstall when finished. These actions remove the query tool and
   stop matching local requests that are still in flight. An accepted package-digest change also
   invalidates the grant and stops work started under the old identity. A query can be reported as
   cancelled. If a mutation was already dispatched, however, an abort, timeout, authorization
   change, or local response-processing failure makes the remote outcome unknown; verify the
   service before retrying.

### Opt-in external read-only services

For these 17 additions, OpenPencil does not automate provider OAuth consent, token exchange, refresh,
tenant approval, or sensitive-scope verification. Create the least-privilege token or key in the
provider console, complete any provider/administrator approval manually, and paste the current value
into the plugin card. A token being accepted by the form does not prove that its provider scopes are
correct; the first bounded read is the operational check.

| Plugin / read-only result                                  | Manual credential and minimum authority                                                                  | Remaining manual gate                                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Neon Projects** — bounded project list                   | Scoped Neon API key; no named OAuth scope                                                                | Choose the narrowest personal, organization, or project key suitable for the test account.                                  |
| **Sentry Issues** — bounded issue list                     | Auth token or internal-integration token with `event:read`                                               | Select the organization/project in Sentry and verify the token is not write-enabled.                                        |
| **HubSpot Contacts** — bounded contact metadata            | Private-app or OAuth access token with `crm.objects.contacts.read`                                       | Create/approve the app and issue the token in HubSpot.                                                                      |
| **Apollo Lists** — bounded list catalog                    | Apollo API key with the reviewed `tags_list` authority                                                   | Confirm the account/plan exposes the reviewed list endpoint.                                                                |
| **PostHog Insights** — bounded insight list                | Personal API key with `insight:read`                                                                     | The reviewed adapter targets PostHog US Cloud only; EU Cloud and self-hosted origins need separate review.                  |
| **Asana Workspaces** — bounded workspace list              | OAuth access token or PAT with `workspaces:read`                                                         | Complete the Asana app/PAT setup manually.                                                                                  |
| **Zotero Top Items** — bounded item metadata               | Dedicated read-only key with `library:read`; numeric Zotero user ID is separate non-secret configuration | Create a library read-only key and copy the numeric user ID.                                                                |
| **HeyGen Avatars** — bounded avatar list                   | HeyGen API key; no named provider scope                                                                  | Use a test-workspace key; the adapter can only list avatars.                                                                |
| **Linear Issues** — bounded issue list                     | OAuth access token with `read`                                                                           | Complete Linear OAuth manually. This is the reviewed fixed GraphQL `POST`; its document and body are not caller-controlled. |
| **OpenAI Models** — bounded model list                     | Project API key with `models.read`                                                                       | Create a least-privilege project key; the adapter cannot submit prompts or responses.                                       |
| **Box Root Items** — bounded root-folder item list         | OAuth access token with the reviewed root-read-only authority (`root_readonly` host label)               | Complete Box OAuth manually and keep write scopes out of the test app.                                                      |
| **Slack Public Channels** — bounded public-channel list    | Bot or user token with `channels:read`                                                                   | Install/approve the Slack app manually; private-channel/history scopes are not requested.                                   |
| **Google Calendar Events** — bounded event metadata        | OAuth access token with `https://www.googleapis.com/auth/calendar.events.readonly`                       | Google consent, sensitive-scope verification, and production OAuth review remain manual release gates.                      |
| **SharePoint Root Site** — root-site metadata only         | Microsoft Graph token with `Sites.Read.All`                                                              | Entra app registration and tenant/admin consent remain manual.                                                              |
| **Outlook Mail Folders** — folder metadata only            | Microsoft Graph token with `Mail.ReadBasic`                                                              | Entra consent remains manual; the adapter does not read message content or send mail.                                       |
| **Outlook Calendar Events** — bounded basic event metadata | Microsoft Graph token with `Calendars.ReadBasic`                                                         | Entra consent remains manual.                                                                                               |
| **Microsoft Teams** — bounded joined-team list             | Microsoft Graph token with `Team.ReadBasic.All`                                                          | Entra consent remains manual; work/school accounts are supported, personal Microsoft accounts are not.                      |

Provider-returned names, descriptions, titles, addresses, URLs, and other display strings are
**untrusted external data**. The Broker normalizes and bounds them through a closed result schema, but
that does not make them instructions. Render them as text; do not execute markup, feed them back as
authority, or automatically open a returned URL. Audit output continues to omit request parameters,
response bodies, and secrets.

Four otherwise attractive candidates remain intentionally deferred:

| Candidate      | Why it is not enabled yet                                                                                                           | Required gate                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Gmail**      | Restricted Google scopes combined with AI/MCP data transfer need a separate policy and security review.                             | Complete restricted-scope verification and approve the AI data-transfer policy.            |
| **Monday.com** | Its stable token flow uses a raw/non-Bearer `Authorization` form that the current Broker does not inject.                           | Add and review an exact non-Bearer authorization scheme without opening arbitrary headers. |
| **Semrush**    | The candidate API is early-access and its `ApiKey` credential scheme is not represented by the current reviewed injection contract. | Confirm a stable production API and add a dedicated reviewed `ApiKey` scheme.              |
| **Replit**     | No stable public management API has been verified for the intended operations.                                                      | Select and review a documented public API before granting network authority.               |

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
parameters, response bodies, or credentials. Supabase Auth/Storage, provider-managed OAuth
consent/refresh flows for these connectors, and binary streaming are not implemented; manually
issued access tokens are the current integration gate. Arbitrary publisher JavaScript/native code, background
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
respectively. An explicitly authorized read-only connector query using fixed `GET` or an explicitly
host-reviewed fixed `POST` projects to a query tool; arbitrary `POST` and connector mutations stay
unavailable to MCP. Installation or enablement alone does not authorize a connector tool: a saved
credential and current-session exact-digest grant are also required. Revocation or credential
clearing removes the tool immediately.

For the default-enabled Supabase Backend Provider, the only MCP/AI projections are its reviewed
`audit` and `plan` run tools. They recheck the live plugin and provider authority before planning and
never expose credentials, artifact content, Apply, migration execution, or deployment.

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

The 22 bundled connectors use a separate, bounded host Broker and do not relax the publisher runtime
boundary. Supabase Auth/Storage, provider-managed OAuth consent/refresh flows, and binary streaming
remain future connector work. Publisher manifests and WASM packages still cannot add arbitrary network
origins, request handlers, JavaScript/native code, or background services.

The WASM channel does not expose Tauri IPC, and remote marketplace data is rendered as text rather
than executable markup. Host-wide Tauri hardening is nevertheless a separate release lane: the
desktop shell still needs a production CSP, an explicit local-origin navigation policy, debug-only
automation capabilities, and narrower filesystem/shell scopes before the project should claim a
fully hardened hostile-renderer boundary. Do not add remote origins to the default Tauri capability
or load plugin HTML/JavaScript into the main WebView.

For the package contract, deployment configuration, and publisher workflow, see
[Plugin Architecture](../development/plugins).
