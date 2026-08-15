# OpenPencil

Open-source design editor. Opens `.fig` and `.pen` design files, includes built-in AI, and ships as a programmable toolkit with a headless Vue SDK for building custom editors.

> **Status:** Active development. Usable today, with some rough edges as features evolve.

**[Try it online →](https://app.openpencil.dev/demo)** · [Download](https://github.com/open-pencil/open-pencil/releases/latest) · [Documentation](https://openpencil.dev) · [Roadmap](https://openpencil.dev/development/roadmap) · [llms.txt](https://openpencil.dev/llms.txt)

![OpenPencil](packages/docs/public/screenshot.png)

## Installation

**macOS (Homebrew):**

```sh
brew install --cask openpencil
```

Or download from the [releases page](https://github.com/open-pencil/open-pencil/releases/latest), or [use the web app](https://app.openpencil.dev) — no install needed.

## What it does

- **Opens `.fig` and `.pen` files** — read and write native Figma files, open supported Pencil documents from the app or OS file browser, copy & paste nodes between apps
- **AI builds designs** — describe what you want in chat with a curated set of common design operations, including real buttons, inputs, forms, lists, and other lowcode controls. Connect OpenRouter, Anthropic, OpenAI, Google AI, DeepSeek, Z.ai, MiniMax, or compatible endpoints; optionally enable cited web search, hosted code execution, or Remote MCP tools per model (per-call approval for Direct chat; agent-owned policy for ACP)
- **Fully programmable** — headless CLI, XPath queries, Figma Plugin API via `eval`, MCP server for AI agents, and desktop agent integrations for Claude Code, Codex, and Gemini CLI
- **Lint, convert, and extract tokens** — inspect documents, lint naming/layout/accessibility, convert between supported formats, analyze colors/typography/spacing/clusters, and extract design tokens
- **Components and variants** — create reusable components, group variants into component sets, insert local assets as instances, and switch variants from the inspector
- **Image vectorization** — convert image layers into editable vector layers with Recraft or fal.ai
- **Adaptive canvas performance** — use Automatic mode or choose resource saving, balanced, or
  smoothness-first rendering. Ordinary pointer, drag, pan, and zoom interaction stays on the native
  display cadence; the selected level dynamically budgets generated effects, collaboration cursors,
  retained scene work, decoded-image wrappers, font loading, FIG parsing, and background layout.
  Longer page font/fallback preparation reports non-blocking canvas progress instead of appearing
  stuck, while short operations complete without flashing a status
- **Design-to-code export** — export selections as JSX/Tailwind, generate token outputs, and map designs into component-oriented code workflows
- **Code-based motion** — author bounded MotionSpec v1/v2/v3 timelines, structured channels, and
  cubic paths; choreograph page/frame scenes; build multi-node recipes, continuous drivers,
  prototypes, and Smart Match transitions; use personal, shared, or signed Team libraries; trigger
  tracks from lowcode workflows; compile to CSS/WAAPI with live reduced-motion handling; export
  deterministic PNG sequences or GIF plus capability-gated WebM/MP4; embed the public SSR-safe
  Motion Runtime SDK; and generate a fail-closed Figma Motion Plugin API adapter for the verified
  native subset
- **Lowcode app publishing** — turn pages into React/Tailwind apps with state, bindings, form validation, Supabase schema inspection and RLS guidance, authenticated client/server workflows, environment-scoped runtime configuration, i18n, shadcn/ui output, preview diagnostics, build, and deploy flows. Switch Compiler Preview and the `compile`/`build`/`deploy` CLI between the full React target and the bounded Vue 3 target; preview refresh supports Real-time, Auto, and Manual policies with single-flight latest-change scheduling
- **Built-in plugin marketplace** — manage 58 reviewed plugins with 61 module, command, exporter,
  connector, and storage-provider contributions: 20 editable modules, nine bounded commands, nine
  source/data exporters, 22 host-reviewed connectors, and the default-enabled Google Drive Storage
  declaration. The opt-in additions include 17 read-only external-service connectors, local
  Application Security Readiness, and safe deployment-plan reviews for Vercel and Cloudflare Pages
- **Local-first cloud documents** — connect the Tauri desktop app to Google Drive through the system
  browser and OAuth PKCE with the narrow `drive.file` scope. OpenPencil keeps visible `.fig` files in
  Drive. After the local document index and Outbox pass live durable IndexedDB probes, it saves
  locally before queuing background uploads, resumes pending work after restart, uses resumable
  transfers and incremental change cursors, and preserves concurrent edits as conflict copies. A
  production memory fallback blocks cloud operations and directs users to export open work as a
  local `.fig`; it never claims offline or restart safety. Resumable session URLs are process-local,
  so an ambiguous remote success followed by an app crash is preserved as a conflict copy instead of
  risking a silent overwrite. Self-managed S3-compatible storage remains an advanced alternative
- **Vue SDK for custom editors** — headless components and composables for embedding OpenPencil into other apps or building workflow-specific editing surfaces. [Read the SDK docs →](https://openpencil.dev/programmable/sdk/)
- **Real-time collaboration** — peer-to-peer collaboration via WebRTC, with cursors, presence,
  follow mode, and fine-grained MotionSpec v3 timeline merging with remote playheads and selections
- **Auto layout & CSS Grid** — flex and grid layout via Yoga WASM, with gap, padding, alignment, track sizing
- **~7 MB desktop app** — Tauri v2 for macOS, Windows, Linux. Also runs in the browser as a PWA

## CLI

```sh
npm install -g @open-pencil/cli
# or: bun add -g @open-pencil/cli
```

### Inspect design files

Browse node trees, search by name or type, dig into properties — all without opening the editor:

```sh
openpencil tree design.fig
openpencil find design.pen --type TEXT
openpencil node design.fig --id 1:23
openpencil info design.fig
```

```
[0] [page] "Getting started" (0:46566)
  [0] [section] "" (0:46567)
    [0] [frame] "Body" (0:46568)
      [0] [frame] "Introduction" (0:46569)
        [0] [frame] "Introduction Card" (0:46570)
          [0] [frame] "Guidance" (0:46571)
```

### Query with XPath

Use XPath selectors to find nodes by type, attributes, and structure:

```sh
openpencil query design.fig "//FRAME"                              # All frames
openpencil query design.fig "//FRAME[@width < 300]"                # Frames under 300px
openpencil query design.fig "//TEXT[contains(@name, 'Button')]"     # Text with 'Button' in name
openpencil query design.fig "//*[@cornerRadius > 0]"               # Rounded corners
openpencil query design.fig "//SECTION//TEXT"                       # Text inside sections
```

### Export

Render to PNG, JPG, WEBP, SVG, PDF, JSX, HTML, or `.fig` — or export selections/pages as `.fig` and convert whole documents between supported formats:

```sh
openpencil export design.fig                           # PNG
openpencil export design.fig -f jpg -s 2 -q 90        # JPG at 2x, quality 90
openpencil export design.fig -f fig --page "Page 1"   # Export a page as .fig
openpencil export design.fig -f pdf                     # PDF
openpencil export design.fig -f jsx --style tailwind   # Tailwind JSX
openpencil export design.fig -f html --css tailwind    # Tailwind HTML fragment
openpencil export design.fig -f html --html standalone --assets external # HTML + assets
openpencil convert design.pen -f fig -o output.fig     # Convert between document formats
openpencil convert animated.pen -f pen -o updated.pen # Source-preserving Motion metadata write
openpencil motion export animated.fig --node 1:23 --fps 30 -o motion-frames # PNG sequence
openpencil motion export animated.fig --node 1:23 --format gif -o motion.gif # Built-in GIF89a
openpencil motion export animated.fig --node 1:23 --format webm -o motion.webm # FFmpeg capability
openpencil import page.html --css styles.css -o page.fig # HTML/CSS → editable .fig
```

The `.pen` writer currently updates MotionSpec metadata only on documents originally read from
`.pen`; it preserves untouched foreign/future metadata and rejects conflicting unknown-schema,
structural, or visual changes instead of emitting a lossy Pencil document. Use `.fig` for general
editing and conversion.

DOM/CSS input flows through `@open-pencil/dom-css`, so HTML, authored CSS, and Tailwind utility CSS can become editable OpenPencil layers:

```sh
openpencil import card.html --css card.css -o card.fig
openpencil import card.html --tailwind "flex flex-col gap-3 w-80 p-6 rounded-xl bg-white" -o card.fig
```

```html
<div className="flex flex-col gap-4 p-6 bg-white rounded-xl">
  <p className="text-2xl font-bold text-[#1D1B20]">Card Title</p>
  <p className="text-sm text-[#49454F]">Description text</p>
</div>
```

### Lint design files

Catch naming, layout, structure, and accessibility issues from the terminal:

```sh
openpencil lint design.fig
openpencil lint design.pen --preset strict
openpencil lint design.fig --rule color-contrast
openpencil lint design.fig --list-rules
```

### Analyze and extract design tokens

Audit an entire design system from the terminal — find inconsistencies, extract the real palette, and spot components waiting to be extracted:

```sh
openpencil analyze colors design.fig
openpencil analyze typography design.fig
openpencil analyze spacing design.fig
openpencil analyze clusters design.fig
openpencil analyze overlaps design.fig
openpencil variables design.fig
```

```
#1d1b20  ██████████████████████████████ 17155×
#49454f  ██████████████████████████████ 9814×
#ffffff  ██████████████████████████████ 8620×
#6750a4  ██████████████████████████████ 3967×

3771× frame "container" (100% match)
     size: 40×40, structure: Frame > [Frame]

2982× instance "Checkboxes" (100% match)
     size: 48×48, structure: Instance > [Frame]
```

### Script with Figma Plugin API

`eval` exposes OpenPencil's Figma-compatible Plugin API surface. Modify the file, write it back:

```sh
openpencil eval design.fig -c "figma.currentPage.children.length"
openpencil eval design.fig -c "figma.currentPage.selection.forEach(n => n.opacity = 0.5)" -w
```

### Adapt Motion to Figma (Beta)

Generate a self-contained Figma plugin script for a node whose `MotionSpec` fits the verified
[official Motion API](https://developers.figma.com/docs/plugins/api/Motion/) subset:

```sh
openpencil motion inspect figma-motion-snapshot.json --json
openpencil motion apply design.fig --node 1:23 --emit script -o apply-motion.js
openpencil motion clear figma-motion-snapshot.json --emit snapshot -o clear-motion.json
```

The safe default targets one selected Figma node, replaces only Motion previously owned by the
OpenPencil adapter, and refuses unsupported triggers, timing, properties, or conflicting native
state. Use `--target-node`, `--conflict-policy replace-all`, or `--allow-timeline-growth` only when
that broader target or mutation is intentional. This bridge applies through Figma's official
Plugin API; OpenPencil still does not synthesize undocumented native timeline payloads directly
inside `.fig` archives.

### Share Motion preset libraries

Publish a personal preset JSON file as a readonly, versioned shared manifest, then import, check,
and explicitly accept updates from its declared file or HTTP(S) source:

```sh
openpencil motion presets publish personal.json --publisher-id design-team --publisher-name "Design Team" --library-id product-motion --library-name "Product Motion" --source-version v1 -o product-motion.json
openpencil motion presets import product-motion.json -o accepted.json
openpencil motion presets check accepted.json -o checked.json
openpencil motion presets accept checked.json -o accepted-v2.json
```

`check` records that a source version is available without replacing the accepted preset snapshots.
Only `accept` replaces them. Add `--json` to any command for machine-readable output.

### Control the running app

When the desktop app is running, omit the file argument — the CLI connects via RPC and operates on the live canvas. Useful for automation scripts, CI pipelines, or AI agents that need to interact with the editor:

```sh
openpencil tree                               # Inspect the live document
openpencil export -f png                      # Screenshot the current canvas
openpencil eval -c "figma.currentPage.name"   # Query the editor
```

Applicable inspect and report commands support `--json` for machine-readable output.

### Build lowcode apps

OpenPencil can compile a `.fig` or `.pen` document into a runnable Vite + React + TypeScript app by default, or a Vite + Vue 3 + TypeScript app with `--target vue`. The full React target preserves layout, resolved web-font assets and script fallbacks, routes, interactive state, bindings, validation, workflows, Supabase auth/data actions, authenticated server workflows, Stripe checkout and customer portal redirects through your own server endpoints, i18n catalogs, analytics hooks, controlled custom head/CSS metadata, and optional shadcn/ui components. Button, Input, and Textarea nodes expose per-control text colors, while Input and Textarea also expose placeholder colors; both remain consistent between the CanvasKit canvas, generated Tailwind code, and Figma-compatible exports. Desktop Font settings can also import validated TTF, OTF, or WOFF files for persistent offline use; previews embed the same loaded face bytes as the CanvasKit canvas unless OpenType metadata explicitly restricts embedding. Restricted faces are omitted with a `font-license-embedding-restricted` compiler warning, while unknown or incomplete redistribution evidence remains visible for manual review.

```sh
openpencil compile app.fig -o generated-app
openpencil compile app.fig -o generated-vue-app --target vue
cd generated-app
npm install
npm run dev
```

For Vue delivery, install and enable the opt-in **Vue Exporter** plugin, then choose
**File → Export → Vue Project…** (or call its dynamically registered MCP export tool). It emits a
source-only Vite + Vue 3 + TypeScript + Tailwind project; multiple pages use Vue Router v4, route and
query expressions read live `$params`/`$query`, safe navigation fills optional/repeated/splat
parameters plus query/hash suffixes, local image bytes remain under `src/assets/**`, and generated
components use editable `.vue` SFCs. Vue v1 provides basic reactive state, bindings, events, local
form validation, and real Toast and Confirm feedback, plus accessible Modal, Dropdown Menu, Slide
Menu, and local-only Upload Button runtimes. Local validation covers required, pattern, length,
numeric range, and custom-expression rules and blocks invalid submit handlers; remote asynchronous
validation performs no request and blocks submission with a `vue-validation-async-unsupported`
warning. It does not claim React feature parity: other plugin modules, Motion, prototypes and
overlays, authored raw HTML, Supabase/auth/server workflows, Stripe, analytics, i18n, React UI kits,
and persisted document state remain omitted or reduced with explicit `vue-*-unsupported` entries in
`EXPORT_WARNINGS.md`. The exporter never installs dependencies or executes generated code.
Both the plugin card/File menu and MCP use the same bounded Worker pipeline: compilation and ZIP
compression run in separate disposable module Workers, and cancellation terminates the active
isolate. The plugin card exposes choosing, preparing, compiling, archiving, saving, and cancelling
stages plus an accessible Cancel action; the active plugin cannot be disabled, updated, rolled back,
or uninstalled until the export ends. Image buffers are cloned without detaching the live editor
graph. The exporter resolves only font bytes already retained, cached, or bundled locally; it starts
neither an online provider nor a new system-font request. Exact bytes are copied only when their
digest and redistribution license match the reviewed manifest, and the ZIP then includes
`FONT-LICENSES.txt`. Restricted or unverified faces are omitted with explicit warnings while authored
font-family CSS remains intact. The input snapshot fails closed above 25,000 nodes, 4,096 images, or
32 MiB (counting each complete unique
binary backing buffer); Worker output and the path-safe ZIP each retain a 4,096-file/64-MiB ceiling.

Compiler Preview has a **Target** selector for React or Vue 3 and restarts the matching isolated
sidecar when it changes. React-only shadcn and i18n controls are disabled for Vue instead of being
silently ignored. The same target is available directly from all three codegen commands; `--i18n`,
`--locale`, `--source-locale`, and `--ui-kit` remain React-only and are rejected with `--target vue`.
Both preview targets share editor-to-iframe selection highlighting, Alt/Option-click selection back
to the canvas, echo-suppressed two-way page navigation, collaborative document-state mirroring, and
instant Light/Dark theme synchronization. That bridge is generated only for editor Preview and is
absent from source/static delivery. Vue still has no Motion runtime; Motion Debug reports unavailable
immediately instead of waiting indefinitely.

Build a static SPA bundle for any static host:

```sh
openpencil build app.fig -o dist --ui-kit shadcn --i18n --locale fr
openpencil build app.fig -o dist-vue --target vue
```

Static builds write only to a nonexistent/empty output directory or replace a directory whose valid,
regular-file `.openpencil-build-output.json` marker came from a preceding OpenPencil build and whose
complete file set still exactly matches that manifest. A non-empty unmarked directory, missing
managed file, or extra file fails closed instead of being deleted.

Deploy directly to Netlify, Vercel, or Cloudflare Pages:

```sh
NETLIFY_AUTH_TOKEN=... openpencil deploy app.fig --provider netlify --site my-site
VERCEL_TOKEN=... openpencil deploy app.fig --provider vercel --site my-project
CLOUDFLARE_API_TOKEN=... openpencil deploy app.fig --provider cloudflare --account-id <account-id> --site my-pages-project
VERCEL_TOKEN=... openpencil deploy app.fig --target vue --provider vercel --site my-vue-project
```

For Supabase-backed apps, override production public runtime values at build/deploy time with `--supabase-url`, `--supabase-anon-key`, and `--supabase-schema`, or the matching `VITE_SUPABASE_*` environment variables. The editor can inspect a normalized schema catalog with a management PAT held only in the credential store; the PAT and raw catalog never enter the design. Server workflows compile to `openpencil-server/` beside the static bundle. Static deploys intentionally exclude that directory and leave function deployment plus server environment values to the operator. Stripe checkout actions POST JSON to an author-owned endpoint and redirect to a returned `url` / `checkoutUrl`; Stripe customer portal actions POST JSON to an author-owned endpoint and redirect to a returned `url` / `portalUrl`. Stripe secret keys, webhook handling, subscriptions, and customer lookup stay on your server, never in the document or generated SPA. Lowcode analytics supports GA4, Plausible, and PostHog configuration stored in the document plus `trackEvent` actions, optional page views, Do Not Track, and a generated consent banner with local preference persistence, configurable copy, a configurable Analytics default state, and an EEA-style opt-in starter preset. Custom head/CSS support is limited to structured `<meta>`, `<link>`, `<style>`, and `index.css` output; arbitrary JavaScript is intentionally out of scope. See the repository's [Lowcode Apps guide](packages/docs/user-guide/lowcode-apps.md) for authoring. For the fork-specific Supabase, RLS, server-workflow, and deployment path, open **Help → Application Runtime Guide** in the app; that complete guide is bundled for offline use.

Open **Settings → Plugins** to manage the bundled offline catalog or a self-hosted marketplace rooted
in one packaged Ed25519 public key. The marketplace publishes a signed publisher directory,
stable/beta catalogs, searchable listings, immutable artifact coordinates, an append-only audit
checkpoint, and an optional executable-runtime index. Explicit update review, verified rollback,
digest pins, cache status, and portable document dependency locks remain enforced.
After enablement, insert module plugins from the canvas toolbar, run Clipboard Toolkit commands from
the Edit menu, and use reviewed exporters from File → Export or the installed-plugin card. The 58
reviewed built-ins expose 61 contributions: twenty modules (including Map, Rich Text, sandboxed
HTML, Video, Lottie, Carousel, Advanced Data Grid, Tabs, Accordion, QR/Code 128, Markdown, Code
Block, PDF Viewer, Audio Player, Modal, Dropdown Menu, and Upload Button), nine commands (four Clipboard Toolkit
actions, Static Accessibility Audit, Static Design System Audit, Application Security Readiness, and
safe Vercel and Cloudflare Pages deployment-plan reviews), nine exporters (Tauri React, Expo React Native, Flutter,
Next.js, Vue, Capacitor, Electron, Design Tokens JSON, and Figma Editable Projection), 22 connectors, and
one Google Drive storage provider. The connector set includes the original five bounded business
integrations plus opt-in read-only Neon, Sentry, HubSpot, Apollo, PostHog, Asana, Zotero, HeyGen,
Linear, OpenAI, Box, Slack, Google Calendar, SharePoint, Outlook Email, Outlook Calendar, and
Microsoft Teams integrations.
Upload Button only selects and validates files in the generated browser runtime; it does not upload,
persist, or report transfer progress. Use the existing low-code `INPUT` plus Supabase upload workflow
when an application needs server storage. Dynamic MCP can add the declarative Upload Button module
only while its plugin is installed and enabled; file names and file bytes never enter MCP arguments
or results.
Map and the host-owned Google Drive Storage declaration are installed and enabled by default; all
other built-ins are opt-in. Advanced Data Grid can
round-trip bounded RFC 4180 CSV in the property panel and generated web runtime without requesting
file or clipboard privileges. Rich Text uses a structured visual block and inline-format editor in
the Design panel. Compiler Preview and
exported React/Tauri source render Rich Text as a directly editable, dependency-free field with a
safe v1 formatting toolbar, plain-text paste, a hidden form value, and a change event; runtime values
remain application data and are not silently written back to the source `.fig` file. Mobile source
ZIPs currently omit font bytes because the available SPDX IDs do not include the font-specific
copyright, full license text, or NOTICE files required for safe redistribution; every omission
remains visible in the export report.

For cloud documents, the app publisher supplies the public Google OAuth Desktop client ID through
`VITE_GOOGLE_DRIVE_CLIENT_ID` at build time. Open **Settings → Storage → Google Drive** in the
desktop app and complete consent in the system browser. A Desktop OAuth client is a public
installed-app client: OpenPencil needs only its Client ID and does not bundle a client secret. The
app uses Authorization Code + PKCE through a temporary loopback callback and requests
only `openid`, `email`, and `drive.file`. Refresh tokens are stored in app-local IndexedDB and
encrypted with AES-GCM using a non-extractable WebCrypto key. Desktop development and release builds
select this encrypted app backend directly—it is not a fallback after a native credential error—and
do not use macOS Keychain. Existing Keychain items are neither migrated nor deleted, so after an
upgrade you must reconnect Google Drive and enter other saved credentials once. Google Drive stores
ordinary, user-visible `.fig` files rather than hidden
app-data blobs. Up to eight named profiles keep accounts, provider settings, local indexes, cursors,
and durable work isolated. Reconnecting the same Google account checks unfinished work before OAuth,
asks for confirmation when needed, then rebinds cached documents and queued jobs to the new grant;
an interrupted handoff remains repairable from Settings. Before cloud open, create, refresh, save,
delete, account disconnect, profile removal, or S3 configuration rotation, both the local document
index and Outbox must pass live durable IndexedDB probes. A production memory fallback puts cloud
storage into read-only recovery: those actions stay blocked, the UI directs users to export any open
work as a local `.fig`, and no offline/restart guarantee is made.

S3 profiles rotate an exact configuration generation when their endpoint, bucket, region, or
credentials change, and block such changes while unfinished work exists so an old job cannot run
against a new bucket. When a legacy authority-less S3 profile first adopts an exact generation,
Settings shows its endpoint, bucket, and affected workload and requires explicit confirmation before
running a restartable migration that atomically rekeys metadata, `.fig` bytes, and thumbnails and
atomically replaces matching Outbox jobs. A collision or cross-generation target fails closed, and
configuration or credential changes remain blocked until migration completes. Synchronization is
whole-document, local-first storage with resumable
transfers, polling, trash-backed deletion, and conflict copies—not a strongly consistent multi-user
collaboration backend. Pending jobs survive restart only after the durable probes succeed, but
resumable session URLs do not: if Drive may have committed an upload before the app could record its
result, recovery preserves another conflict copy rather than guessing that an overwrite is safe. The
implementation has automated contract coverage, but real Google authorization, restart,
interrupted-transfer, multi-account, trash, and conflict checks remain a manual release gate. See
[Cloud documents with Google Drive](packages/docs/user-guide/plugins.md#cloud-documents-with-google-drive).

Installed and enabled plugin contributions that the host explicitly marks MCP-safe also appear as
dynamic MCP tools. Disabling, removing, or disconnecting the plugin host removes those tools from
discovery, and every call rechecks live plugin state before it reaches a reviewed host adapter.
Modules, commands, cancellable exporters, and explicitly session-authorized read-only connector
queries whose contract uses fixed `GET` or an explicitly reviewed fixed `POST` map to add, run,
export, and query tools respectively. Connector
mutations remain UI-only and require a new human confirmation for every invocation. The
Tauri, Next.js, Capacitor, Electron, Expo, Flutter, and Figma source/projection exporters remain
UI-only until their synchronous Compiler/encoder stages support cooperative cancellation. The Vue
source exporter compiles and compresses in bounded module Workers that are terminated on
cancellation, then checks the signal through its atomic write boundary. It appears in MCP only while its opt-in plugin is
installed and enabled;
uninstalled, disabled, or host-incompatible contributions and non-cancellable exporters are never
exposed.

The Static Accessibility Audit is a bounded design-time lint report, not a complete WCAG conformance
test or runtime assistive-technology audit. Design Tokens JSON excludes variables hidden from
publishing, preserves aliases between exported tokens, and fails closed when an alias targets a hidden
or missing token. Figma Editable Projection creates a derived `.fig` with native editable layers; it
does not mutate the source document, and OpenPencil interactions or plugin runtimes are not executable
in Figma. Web/React and Tauri output can use the complete reviewed interactive module set. Vue v1
adds real Modal, Dropdown Menu, Slide Menu, and local-only Upload Button runtimes and preserves the
static shell plus an explicit warning for other plugin modules. Expo and Flutter currently emit
warnings and preserve authored static fallbacks for every plugin module.

Manifest API v2 adds strict parameter/result JSON schemas, a fixed host-permission vocabulary, and
explicit exporter extension/MIME contracts. It is a safety-contract foundation, not a general plugin
runtime: it does not open arbitrary JavaScript, generic network access, unrestricted document writes,
or custom UI. Contributions still resolve only to reviewed adapters shipped by the host.

The Phase 2 connector Broker executes only the 22 bundled connector contracts through exact,
host-reviewed adapters. The 17 external-service additions are opt-in and read-only. In
**Settings → Plugins**, install and enable one, save its least-privilege token or key in the
centralized credential store, then authorize the exact connector, adapter, and package digest for
the current session. Only after all four gates—installed, enabled, credential present, and session
authorization—pass does an eligible MCP query appear. Disable, uninstall, revoke, clear the
credential, or accept a different package digest and the query disappears immediately. Request preparation receives
bounded parameters rather than credentials; only a reviewed host validator may inspect an ephemeral
credential before the Broker injects it at request time. Eligible read-only fixed `GET` queries and
explicitly host-reviewed fixed `POST` queries are also available to connected MCP/AI clients after
that explicit session authorization. Linear's read-only GraphQL operation demonstrates the fixed
`POST` shape: its document and body are not caller-controlled. Arbitrary `POST`, arbitrary GraphQL,
and connector mutations remain unavailable to MCP. The Broker enforces
the reviewed exact HTTPS origin or origin template, method, path template, `credentials: 'omit'`,
redirect rejection, timeout, and request/response limits; Tauri requests use the bounded native
proxy. Results are normalized through closed schemas, and audit records contain metadata rather than
parameters, response bodies, or secrets. Disable, uninstall, digest change, or authorization
revocation stops local in-flight work. A query can report cancellation, but once a mutation crosses
the transport dispatch boundary, any later abort, timeout, or local response failure is reported as
an unknown remote outcome and the UI asks the user to verify the service before retrying. Supabase
updates/deletes require a filter and enforce strict `max-affected=100`; Stripe Checkout and Resend
send operations reuse their reviewed UUID `mutationAttemptId` as the provider `Idempotency-Key` when
retrying the same unknown-outcome review. Session grants, pending state, and notices are not durable
across a hard crash, so always verify the provider after a crash or unknown outcome.

Provider display strings remain untrusted external data even after bounded normalization and closed
schema validation. Treat them as text, never as AI instructions, executable markup, or authority to
open a returned URL. These are local design-time operator integrations, not generated-app or server-side connectors.
Credentials stay out of documents, Compiler output, audit logs, and long-lived UI state, but the
reviewed renderer request path resolves them into memory at dispatch time; encrypted app-local
credential storage and the Tauri proxy do not claim server-side secret isolation from a compromised
renderer. Use least-privilege
development credentials and keep production secrets on infrastructure you operate. Generated-app
server connectors, Supabase Auth/Storage, provider-managed OAuth consent/refresh flows, and connector
binary streaming remain future work. Gmail is deferred pending restricted-scope and AI data-transfer
review; Monday.com pending an exact non-Bearer `Authorization` contract; Semrush pending a stable
production API and dedicated `ApiKey` injection scheme; and Replit pending a documented stable public
management API. This
host-owned lane does not grant arbitrary publisher manifests, JavaScript, native code, or WASM
packages generic network access.

Application Security Readiness is an opt-in, local, read-only, cancellable, and resource-bounded
static review of production configuration, data access, transport/server posture, privacy, and
custom-code signals. It returns fixed issue codes, counts, and remediation—not document content or
secrets—and is not a complete security assessment, penetration test, certification, or guarantee.

The Vercel and Cloudflare Pages plugins expose only safe deployment-plan review commands to MCP.
Those commands validate and disclose a bounded plan without reading a token, building, making a
network request, or changing state. Actual deployment is available only from the installed-plugin
card, reads its credential after a fresh UI confirmation for that invocation, builds the saved
document, and uploads generated static files. MCP cannot execute a real deployment; if the UI is
interrupted after dispatch, the remote outcome may be unknown and must be checked at the provider.
The confirmation is bound to the reviewed document, and deployment progress survives closing
Settings; plugin disable, update, rollback, and uninstall stay blocked until that operation settles.

| Connector operation              | Parameters                                                                     | Paste-ready example                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase Schema `inspect-schema` | required `projectRef`; optional `schema`                                       | `{"projectRef":"project-ref","schema":"public"}`                                                                                                         |
| Airtable `list-records`          | required `baseId`, `tableId`; optional `pageSize` (1–100), `offset`            | `{"baseId":"appBase123","tableId":"tblTable123","pageSize":25}`                                                                                          |
| Supabase Tables `query-rows`     | required `projectRef`, `table`; optional `columns`, `filters`, `limit` (1–100) | `{"projectRef":"project-ref","table":"tasks","limit":10}`                                                                                                |
| Supabase Tables `insert-rows`    | required `projectRef`, `table`, `records` (1–100)                              | `{"projectRef":"project-ref","table":"tasks","records":[{"fields":[{"name":"done","valueJson":"false"}]}]}`                                              |
| Supabase Tables `update-rows`    | required `projectRef`, `table`, `fields`, non-empty `filters`                  | `{"projectRef":"project-ref","table":"tasks","fields":[{"name":"done","valueJson":"true"}],"filters":[{"column":"id","operator":"eq","valueJson":"7"}]}` |
| Supabase Tables `delete-rows`    | required `projectRef`, `table`, non-empty `filters`                            | `{"projectRef":"project-ref","table":"tasks","filters":[{"column":"done","operator":"is","valueJson":"false"}]}`                                         |
| Stripe `get-product`             | required canonical `productId`                                                 | `{"productId":"prod_Product123"}`                                                                                                                        |
| Stripe `get-price`               | required canonical `priceId`                                                   | `{"priceId":"price_Price123"}`                                                                                                                           |
| Stripe `create-checkout-session` | required `priceId`, `quantity`, `mode`, `successUrl`, `cancelUrl`              | `{"priceId":"price_Price123","quantity":1,"mode":"payment","successUrl":"https://shop.acme.com/success","cancelUrl":"https://shop.acme.com/cancel"}`     |
| Resend `get-email`               | required `emailId`                                                             | `{"emailId":"4ef9a417-02e9-4d39-ad75-9611e0fcc33c"}`                                                                                                     |
| Resend `send-email`              | required `from`, `to`, `subject`, plus `text` or `html`; optional `cc`, `bcc`  | `{"from":"sender@example.com","to":["reader@example.com"],"subject":"Hello","text":"Ready."}`                                                            |

See the [Plugin Marketplace guide](packages/docs/user-guide/plugins.md#business-connectors) for field
bounds, filter operators, formatted copyable examples, idempotency behavior, and crash boundaries.

Declarative modules still map only to Canvas/Compiler adapters shipped with the app. An optional
Phase 4 channel can run a separately publisher-signed and root-indexed, import-free WASM compute
package after the user grants its exact digest and complete read-only capability list. Every run uses
a disposable Worker with time, memory, input, and output limits. JavaScript/native execution and
network, filesystem, shell, DOM, credential, and document-write capabilities remain unavailable.
See the [Plugin Marketplace guide](packages/docs/user-guide/plugins.md) and
[Plugin Architecture](packages/docs/development/plugins.md).

Plugin publishers can validate and sign bounded manifests, and catalog maintainers can build a
separately signed index without downloading or executing plugin code:

```sh
openpencil plugin manifest validate plugin-payload.json
openpencil plugin manifest sign plugin-payload.json --private-key publisher.pem -o plugin.json
openpencil plugin manifest verify plugin.json --public-key publisher-public.pem
openpencil plugin catalog build catalog-payload.json --private-key catalog.pem -o catalog.json
openpencil plugin catalog verify catalog.json --public-key catalog-public.pem
openpencil plugin runtime validate runtime-payload.json
openpencil plugin runtime sign runtime-payload.json --private-key publisher.pem -o runtime.json
openpencil plugin runtime verify runtime.json --public-key publisher-public.pem \
  --plugin-id example-plugin --plugin-version 1.0.0 \
  --publisher-id example-publisher --key-id publisher-2026 \
  --manifest-digest <manifest-digest> --digest <runtime-digest> --byte-length <bytes>
openpencil plugin runtime-index build runtime-index-payload.json --private-key catalog.pem -o runtime-index.json
openpencil plugin runtime-index verify runtime-index.json --public-key catalog-public.pem \
  --index-id openpencil.marketplace.runtime --key-id marketplace-root-2026 \
  --digest <runtime-index-digest>
```

For CI, signing commands also accept an environment-variable **name** through `--private-key-env`;
the secret is resolved only for that invocation and is never written into the artifact or output.

For a safe end-to-end example, open or rebuild `packages/demos/lowcode/lowcode-onboarding-demo.fig`; it exercises Supabase, validation, workflows, Stripe checkout redirects through a demo endpoint, analytics hooks, i18n, shadcn/ui, and custom head/CSS using example provider values only.

## AI & MCP

### Built-in chat

Press <kbd>⌘</kbd><kbd>J</kbd> to open the AI assistant. Its curated built-in tool set covers common work such as rendering and editing nodes, fills, strokes, text, auto-layout, structure changes, and lowcode state. Attach a PNG, JPEG, WebP, or the current canvas selection as an explicit visual reference; a vision-capable model can analyze it and generate editable layout. A selected canvas reference can remain in place while the assistant builds beside it; a paperclip attachment stays chat-only and is not inserted onto the canvas. The composer shows which configured provider and model will receive the image. Model settings also offer default-off OpenRouter web search, provider-hosted OpenAI Code Interpreter, and selected Remote Streamable HTTP MCP servers; citations, generated-file references, and Direct MCP approval requests stay visible in chat. ACP agents apply their own redirect and permission policies for forwarded MCP servers. Bearer tokens use the unified credential store rather than model settings. Advanced component, variable, vector, analysis, and export operations are available through coding-agent and MCP integrations. Bring your own API key for OpenRouter, Anthropic, OpenAI, Google AI, DeepSeek, Z.ai, MiniMax, or compatible endpoints. No OpenPencil account or hosted backend is required.

Not every provider works in the browser, and not every model streams tool calls correctly. See [BYOK provider & model compatibility](packages/docs/programmable/byok-provider-compatibility.md) for measured results — contributions welcome.

### Coding agents (desktop)

Use Claude Code, Codex, or Gemini CLI directly in the chat panel. The agent connects to the editor's MCP server and uses all 140+ design operations. For a source-backed document, OpenPencil's local session store contains the ACP session/thread ID plus non-secret routing metadata: its local path or storage provider/document IDs, the isolated scope, a SHA-256 identity of the effective model and selected Remote MCP configuration, and timestamps. It never persists prompts, attachments, the visible transcript, agent history, credential secrets, or any of this metadata in the `.fig` document.

The binding is isolated by document, Design role, provider/agent, connection, effective OpenPencil runtime model configuration, credential profile, selected Remote MCP server configuration, and prompt-context version. A new or replacement ID is committed only after its first successful prompt. If that durable write fails, the live session remains usable but the chat warns that its ID was not saved and restart continuity is not guaranteed. Unsaved documents keep ACP continuity only for the current process; the first save preserves and binds that session, while Save As starts a new document identity. A matching thread is resumed only when the agent advertises `session/resume`; when resume is unavailable or fails, the replacement becomes active after a successful prompt and the chat shows a notice. The chat also shows whether the current ACP context was resumed, newly created, replaced after a fallback, or failed, together with its session ID.

When an agent advertises the unstable ACP `session/list` capability, the session control can explicitly discover its bounded history. OpenPencil cross-checks returned IDs against its local document/configuration bindings and groups them as **Exact match**, **Same document** with different AI settings, or **Source unverified**. Agent titles, timestamps, and the shared working directory are display hints only and never prove document ownership; unverified and different-configuration candidates require confirmation. A selected thread is resumed through a strict candidate connection: OpenPencil replaces the current chat only after that connection succeeds, and a manual failure never silently starts a new thread. Agent-discovered titles and IDs remain transient and are not written into the document or a copied local Agent catalog. Resuming restores the coding agent's internal context, not the visible OpenPencil transcript; the selected ID is committed to the current document scope only after its first successful prompt.

**Force stop** preserves an existing resumable binding. **Clear chat** waits for deletion of the current local session binding and reports a failure visibly, but it cannot delete history retained by the agent because ACP has no stable cross-agent delete API. Session records expire after 90 days and are capped at 8 per document and 200 globally; unreferenced document-routing metadata is pruned after 90 days. Direct API providers never read ACP records and continue to use bounded in-memory messages. The visible transcript is not restored after an application restart. Actual restoration still depends on the installed agent retaining the thread and supporting ACP resume. Requires the desktop app and the agent CLI installed locally.

**Setup (Claude Code):**

1. Install the ACP adapter: `npm install -g @agentclientprotocol/claude-agent-acp`
2. Add MCP permission to `~/.claude/settings.json`:
   ```json
   {
     "permissions": {
       "allow": ["mcp__open-pencil__*"]
     }
   }
   ```
3. Open the desktop app → <kbd>Ctrl</kbd><kbd>J</kbd> → select **Claude Code** from the provider dropdown

### MCP server

Connect Claude Code, Cursor, Windsurf, or any MCP client to inspect, modify, and export design documents through 140+ design operations plus document/file lifecycle tools. The server connects to a running OpenPencil app for live-document operations, including bounded navigation, form-control, font-rendering, font-license, and image-asset audits; type-safe validated-form binding repair; structured multi-node reads; and atomic batch updates. [Full docs →](https://openpencil.dev/programmable/mcp-server)

**Stdio** (Claude Code, Cursor, Windsurf):

```sh
npm install -g @open-pencil/mcp
claude mcp add --scope user open-pencil -- openpencil-mcp
```

For other MCP clients:

```json
{
  "mcpServers": {
    "open-pencil": {
      "command": "openpencil-mcp"
    }
  }
}
```

**HTTP** (scripts, CI):

```sh
openpencil-mcp-http   # Unix socket on macOS/Linux + http://127.0.0.1:7600/mcp
```

Local clients discover the private Unix socket automatically and fall back to localhost TCP. By default, the HTTP endpoint is `http://127.0.0.1:7600/mcp` and the app bridge uses `ws://127.0.0.1:7601`. Set `PORT=0` to disable TCP on macOS/Linux.

**File access:** Set `OPENPENCIL_MCP_ROOT` to scope file operations (`open_file`, `new_document`, export `path` param) to a directory. It defaults to the server's current working directory.

### AI agent skill

Teach your AI coding agent to use OpenPencil — inspect designs, export assets, analyze tokens, modify .fig files:

```sh
npx skills add open-pencil/skills@open-pencil
```

Works with Claude Code, Cursor, Windsurf, Codex, and any agent that supports [skills](https://skills.sh).

For documentation-aware agents, the docs site publishes [llms.txt](https://openpencil.dev/llms.txt), [llms-full.txt](https://openpencil.dev/llms-full.txt), and per-page Markdown files generated from the VitePress docs.

## Collaboration

Share a generated invite link to co-edit in real time. Document updates travel peer-to-peer over WebRTC; connection establishment may use signaling, STUN, or TURN services.

1. Click the share button in the top-right panel
2. Share the complete generated invite link (including its access key)
3. Collaborators see your cursor, selection, and edits in real time
4. Click a peer's avatar to follow their viewport

## Why

OpenPencil is built for teams and developers who want an inspectable, programmable design stack instead of a workflow tied to one hosted editor. It is MIT-licensed, reads and writes `.fig` files natively, and exposes the same document model through the app, CLI, Vue SDK, and automation tools.

Core editing is local-first and requires no OpenPencil account or hosted backend. Optional AI APIs, collaboration connection services and peers, web-font and stock-photo providers, and deployment providers receive the requests or data needed for the features you choose.

See the [roadmap](https://openpencil.dev/development/roadmap) for product direction and current Figma compatibility gaps.

## Contributing

### Setup

```sh
bun install
bun run dev        # Dev server at localhost:1420
bun run tauri dev  # Desktop app (requires Rust)
```

Alternatively, open the repository in any [Dev Container](https://containers.dev/)-compatible tool. The container pins Bun, installs the workspace dependencies, and forwards the web editor on port 1420. Start it with `bun run dev` after the container is ready.

The Dev Container supports the web editor, packages, CLI, and automated checks. Native Tauri development still requires the host setup described below because desktop windows and platform WebView dependencies are not provided in the container.

### Quality gates

| Command             | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `bun run check`     | Package build, lint, type, i18n, package, and architecture checks |
| `bun run test`      | Playwright app and visual regression tests                        |
| `bun run test:unit` | Bun engine unit tests                                             |
| `bun run format`    | Format the repository with oxfmt                                  |

### Project structure

```
packages/
  scene-graph/    @open-pencil/scene-graph — nodes, primitives, hit testing, copy/snap/undo
  motion/         @open-pencil/motion — deterministic Motion planning, sampling, and projection
  lowcode/        @open-pencil/lowcode — expressions, validation, routes, forms, runtime audits
  plugin-contracts/ @open-pencil/plugin-contracts — portable plugin schemas, trust, runtime contracts
  pen/            @open-pencil/pen — Pencil document format helpers
  kiwi/           @open-pencil/kiwi — Kiwi runtime and low-level .fig container parsing
  fig/            @open-pencil/fig — .fig archives, SceneGraph conversion, instances, metadata
  core/           @open-pencil/core — editor engine, renderer, layout, tools, RPC, document I/O
  motion-runtime/ @open-pencil/motion-runtime — shared scheduler and DOM/Vanilla/Vue adapters
  dom-css/        @open-pencil/dom-css — HTML/CSS/Tailwind to editable design documents
  vue/            @open-pencil/vue — headless Vue SDK
  compiler/       @open-pencil/compiler — private design-to-code compiler for React/Tailwind apps
  cli/            @open-pencil/cli — headless CLI
  mcp/            @open-pencil/mcp — MCP server (stdio + HTTP)
  docs/           Documentation site (openpencil.dev)
  demos/          Demo media and example assets
src/              Vue app (editor shell, AI, collaboration, document I/O)
desktop/          Tauri v2 desktop app (Rust + config)
tests/            E2E, visual, engine, and integration tests
```

### Tech stack

| Layer          | Tech                                                                               |
| -------------- | ---------------------------------------------------------------------------------- |
| Rendering      | Skia (CanvasKit WASM)                                                              |
| Layout         | Yoga WASM (flex + grid via [fork](https://github.com/open-pencil/yoga/tree/grid))  |
| UI             | Vue 3, Reka UI, Tailwind CSS 4                                                     |
| Build tooling  | Bun workspaces, Vite 8, TypeScript                                                 |
| File format    | Kiwi binary + Zstd + ZIP                                                           |
| Collaboration  | Trystero (WebRTC P2P) + Yjs (CRDT)                                                 |
| Desktop        | Tauri v2                                                                           |
| AI/MCP         | Multi-provider (Anthropic, OpenAI, Google AI, DeepSeek, OpenRouter), MCP SDK, Hono |
| Lowcode output | Vite, React, TypeScript, Tailwind CSS                                              |

### Desktop builds

Requires [Rust](https://rustup.rs/) and platform-specific prerequisites ([Tauri v2 guide](https://v2.tauri.app/start/prerequisites/)).

```sh
bun run tauri build
```

## Acknowledgments

Thanks to [@sld0Ant](https://github.com/sld0Ant) (Anton Soldatov) for creating and maintaining the [documentation site](https://openpencil.dev).

## License

MIT
