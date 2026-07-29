# OpenPencil

Vue 3 + CanvasKit (Skia WASM) + Yoga WASM design editor. Tauri v2 desktop, also runs in browser.

**Roadmap:** `packages/docs/development/roadmap.md` tracks product direction, Figma compatibility gaps, and raw metadata coverage. Current architecture and commands live in this file.

## Monorepo

Bun workspace with focused packages:

- `packages/scene-graph` — `@open-pencil/scene-graph`: framework-agnostic node types, graph storage, variables, libraries, copy/snap/undo, and geometry primitives.
- `packages/pen` — `@open-pencil/pen`: Pencil.dev `.pen` document model, parser, SceneGraph import adapter, and source-preserving MotionSpec writer. The writer accepts imported `.pen` graphs and rejects non-Motion edits rather than emitting a lossy document.
- `packages/kiwi` — `@open-pencil/kiwi`: pure Kiwi schema/runtime/protocol package. Owns low-level Figma Kiwi codec/container/parse helpers and stays SceneGraph-agnostic.
- `packages/fig` — `@open-pencil/fig`: `.fig` archive/parser package owning Figma-specific SceneGraph conversion, raw metadata policy, and component/instance interpretation. Core keeps format-neutral IO registration and runtime rendering/font integration.
- `packages/core` — `@open-pencil/core`: renderer, layout, editor core, Figma API, tools, clipboard, vector conversion, lowcode validation, and app/CLI-facing document I/O. Keeps browser DOM out of core.
- `packages/motion-runtime` — `@open-pencil/motion-runtime`: public SSR-safe Motion playback SDK. Owns the shared scheduler, manual clock, reversible DOM projection, and Vanilla/Vue lifecycle adapters while reusing `@open-pencil/core/motion` prepared plans.
- `packages/dom-css` — `@open-pencil/dom-css`: DOM/CSS/Tailwind/JSX import and HTML export pipelines.
- `packages/vue` — `@open-pencil/vue`: headless Vue 3 SDK (Reka UI-style) for custom editor shells and embedded editing surfaces. Renderless components and composables. The app is one consumer of the SDK.
- `packages/compiler` — `@open-pencil/compiler`: private design-to-code compiler. Converts SceneGraph pages into a framework-neutral IR, then emits runnable Vite + React + TypeScript + Tailwind projects, preview VFS, static builds, and deploy bundles.
- `packages/cli` — `@open-pencil/cli`: headless CLI for `.fig`/`.pen` inspection, conversion, export, linting, XPath query, and compiler build/deploy flows. Uses `citty` + `agentfmt`.
- `packages/mcp` — `@open-pencil/mcp`: MCP server for AI coding tools. Stdio + Streamable HTTP (Hono) + browser WebSocket RPC. Reuses core ToolDefs.
- `packages/figma-motion-plugin` — private development Figma plugin that consumes OpenPencil's strict shared Motion envelope and applies the verified official Motion Plugin API subset through the shared `@open-pencil/fig` applicator.
- `packages/docs` — `@open-pencil/docs`: VitePress documentation site. Run with `bun run docs:dev`.
- `packages/demos` — demo media/assets only, not a published workspace package.

The root app (`src/`) is the Tauri/Vite desktop editor. App-specific editor, document, AI, lowcode preview, collaboration, shell, tabs, demo, and automation code lives under `src/app/*`. The app consumes `@open-pencil/scene-graph`, `@open-pencil/core`, `@open-pencil/compiler`, and `@open-pencil/vue` through public workspace exports.

### Public engine exports

`@open-pencil/scene-graph` owns graph data and geometry. `@open-pencil/core` builds editor, renderer, IO, and automation behavior on top and exposes targeted subpaths.

Use public package exports across package/app boundaries. Do not import workspace package internals from app code. Do not create cross-package re-export shim files whose only purpose is forwarding another package's API. Import the owning package directly at call sites; public compatibility barrels may re-export the owner directly when preserving an established package API.

| Subpath                                | What                                                                                  | Heavy dep isolated        |
| -------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------- |
| `@open-pencil/core`                    | everything (barrel)                                                                   | all                       |
| `@open-pencil/scene-graph`             | SceneGraph, node/domain types, variables, libraries, hit-test, copy                   | —                         |
| `@open-pencil/scene-graph/primitives`  | shared primitive types: `GUID`, `Color`, `Vector`, `Matrix`, `Rect`                   | —                         |
| `@open-pencil/scene-graph/geometry`    | geometry and math helpers                                                             | —                         |
| `@open-pencil/scene-graph/snap`        | snapping helpers and types                                                            | —                         |
| `@open-pencil/scene-graph/undo`        | SceneGraph undo manager                                                               | —                         |
| `@open-pencil/core/color`              | parseColor, colorToHex, color management, OkHCL                                       | culori                    |
| `@open-pencil/core/text`               | fonts, text editor, style runs, direction                                             | —                         |
| `@open-pencil/core/vector`             | vector network encode/decode, bezier math                                             | —                         |
| `@open-pencil/core/figma-api`          | FigmaAPI, FigmaNodeProxy                                                              | —                         |
| `@open-pencil/core/icons`              | Iconify API client, icon rendering                                                    | @iconify/utils            |
| `@open-pencil/core/canvas`             | SkiaRenderer (Skia/CanvasKit painting engine)                                         | —                         |
| `@open-pencil/core/design-jsx`         | JSX-to-design renderer                                                                | sucrase                   |
| `@open-pencil/core/editor`             | createEditor, Editor, EditorState                                                     | —                         |
| `@open-pencil/core/motion`             | prepared MotionSpec sampling, per-track diagnostics, easing, and timeline timing      | —                         |
| `@open-pencil/core/tools`              | ToolDef, ALL_TOOLS, AI adapter                                                        | diff                      |
| `@open-pencil/core/kiwi`               | .fig parse/serialize, codec, protocol                                                 | fflate, fzstd             |
| `@open-pencil/core/clipboard`          | Figma/OpenPencil clipboard parsing and import helpers                                 | —                         |
| `@open-pencil/core/rpc`                | RPC commands for CLI                                                                  | —                         |
| `@open-pencil/core/lint`               | design linter rules and presets                                                       | —                         |
| `@open-pencil/core/lowcode-validation` | lowcode state/action/expression/Supabase validators shared by tools, editor, compiler | expr-eval                 |
| `@open-pencil/core/io`                 | IORegistry, builtin read/write/export formats, headless raster/SVG/JSX helpers        | CanvasKit, jspdf, svg2pdf |
| `@open-pencil/core/io/motion-export`   | deterministic Motion frame planning, PNG sequences, and encoder capabilities          | CanvasKit                 |
| `@open-pencil/core/io/formats/fig`     | .fig read/write helpers                                                               | fflate, fzstd             |
| `@open-pencil/core/io/formats/pen`     | .pen read/write helpers                                                               | —                         |
| `@open-pencil/core/io/formats/jsx`     | selection/node JSX export helpers                                                     | —                         |
| `@open-pencil/core/io/formats/raster`  | PNG/JPG/WEBP export helpers                                                           | CanvasKit                 |
| `@open-pencil/core/io/formats/svg`     | SVG export and vector geometry conversion helpers                                     | svgpath                   |
| `@open-pencil/core/profiler`           | render profiling                                                                      | —                         |
| `@open-pencil/core/canvaskit`          | getCanvasKit loader                                                                   | canvaskit-wasm            |
| `@open-pencil/core/layout`             | computeLayout                                                                         | yoga-layout               |
| `@open-pencil/core/constants`          | shared runtime constants such as `IS_TAURI`                                           | —                         |
| `@open-pencil/core/random`             | crypto-backed random helpers                                                          | —                         |
| `@open-pencil/core/xpath`              | XPath selector support for querying design nodes                                      | fontoxpath                |

Runtime `canvaskit-wasm` import exists only in `canvaskit.ts` — all other files use `import type`. CanvasKit instance is passed as a parameter everywhere.

### Editor architecture

`packages/core/src/editor/` is the framework-agnostic editor core. `create.ts` owns the shared `EditorContext`, creates the event bus, wires graph subscriptions/component sync/layout runners, then spreads domain action factories into a flat `Editor` API:

| Module                                                                         | What                                                                                         |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `types.ts`                                                                     | `EditorState`, `EditorOptions`, `EditorEvents`, `Tool`, `EditorContext`                      |
| `state.ts`                                                                     | `createDefaultEditorState()` and initial editor state shape                                  |
| `create.ts`                                                                    | `createEditor()` assembler — context, event bus, graph subscriptions, all actions            |
| `graph-reads.ts`                                                               | read-only graph helpers exposed on `Editor`                                                  |
| `graph-events.ts`                                                              | SceneGraph emitter → editor event bus + render invalidation                                  |
| `layout-runner.ts`                                                             | targeted Yoga layout recomputation                                                           |
| `component-sync.ts`                                                            | debounced component/instance propagation after graph changes                                 |
| `viewport.ts` / `page-viewports.ts`                                            | screen/canvas transforms, pan/zoom, per-page viewport restoration                            |
| `selection/` + `selection.ts`                                                  | select, hover, marquee, hit-test, overlays, entered container                                |
| `pages.ts`                                                                     | switch/add/delete/rename pages                                                               |
| `shapes/` + `shapes.ts`                                                        | primitive shapes, lowcode form tools, pen tool, section adoption                             |
| `structure/` + `structure.ts`                                                  | group, ungroup, frames, auto-layout wrap, reorder, reparent, boolean ops, flatten            |
| `components/` + `components.ts`                                                | component/instance/component set/detach/focus actions                                        |
| `clipboard/` + `clipboard.ts`                                                  | duplicate, copy, paste, paste-to-replace, images, fonts, history                             |
| `undo.ts` + `history/`                                                         | undo snapshots and move/resize/rotation history helpers                                      |
| `text/` + `text.ts`                                                            | text edit sessions, style runs, commit/cancel                                                |
| `nodes.ts`, `layout-mode.ts`, `alignment.ts`, `variables.ts`, `color-space.ts` | node mutation, layout mode, align/flip/rotate, variable binding, color profile actions       |
| `bridges/`                                                                     | compatibility bridges that compose newer domain actions into older app-facing command shapes |

Each action module exports a factory: `createXxxActions(ctx: EditorContext) => { ... }`.
`Editor` type = `ReturnType<typeof createEditor>`.

#### Editor event bus

The editor exposes a typed nanoevents emitter for lifecycle events. Defined in `EditorEvents` (`types.ts`), emitted via `emitEditorEvent()` on the context, subscribed via `editor.onEditorEvent(event, handler)` which returns an unbind function.

| Event               | Payload                            | Emitted by                             |
| ------------------- | ---------------------------------- | -------------------------------------- |
| `render:requested`  | `{ renderVersion, sceneVersion }`  | `requestRender()`                      |
| `repaint:requested` | `{ renderVersion, sceneVersion }`  | `requestRepaint()`                     |
| `graph:replaced`    | `SceneGraph`                       | `replaceGraph()`                       |
| `node:created`      | `SceneNode`                        | SceneGraph emitter → `graph-events.ts` |
| `node:updated`      | `id, changes`                      | SceneGraph emitter → `graph-events.ts` |
| `node:deleted`      | `id`                               | SceneGraph emitter → `graph-events.ts` |
| `node:reparented`   | `nodeId, oldParentId, newParentId` | SceneGraph emitter → `graph-events.ts` |
| `node:reordered`    | `nodeId, parentId, index`          | SceneGraph emitter → `graph-events.ts` |
| `selection:changed` | `selectedIds[], previousIds[]`     | `setSelectedIds()`                     |
| `tool:changed`      | `tool, previousTool`               | `setActiveTool()`                      |
| `page:changed`      | `pageId, previousPageId`           | `switchPage()`, `replaceGraph()`       |
| `viewport:changed`  | `{ panX, panY, zoom }, previous`   | viewport actions                       |

All selection mutations in core use `ctx.setSelectedIds()` and all tool changes use `ctx.setActiveTool()` so the event bus fires consistently. App-layer code uses `editor.clearSelection()`, `editor.select()`, or `editor.setTool()` — never direct `state.selectedIds =` or `state.activeTool =` assignments.

Vue SDK provides `useEditorEvent(event, handler)` composable (`packages/vue/src/editor/events/use.ts`) that auto-disposes on scope cleanup.

The app editor session (`src/app/editor/session/create.ts`) is a thin Vue wrapper: creates `shallowReactive` state, calls `createEditor()`, and assembles app-specific modules for document I/O, autosave, export, vector edit, pen resume, flashes, profiler, mobile clipboard, lowcode preview state, and shell integration. Tabs live in `src/app/tabs/`; active editor access lives in `src/app/editor/active-store/`.

Headless SDK fields compose variable/token binding through `BindingProvider` and the `BindableValue` primitives in `packages/vue/src/controls/binding-provider/` and `packages/vue/src/primitives/BindableValue/`. Keep numeric interaction in `NumberField`; providers own binding lookup, mutation, and undo batching.

Property-panel anatomy in `packages/vue/src/primitives/PropertySection/`, `SegmentedControl/`, and `PropertyList/` is controlled and editor-agnostic. Connect PropertyList events to OpenPencil selection and undo through `useEditorPropertyList()` or an app adapter; never call `useEditor()` from these primitives.

### Settings and credentials

Credential persistence lives under `src/app/settings/credentials/`. Settings components receive `CredentialManager` and may inspect status, replace, or clear credentials; runtime adapters receive `CredentialResolver`. Components must not read saved secrets or keep them in long-lived reactive refs. Non-secret provider preferences remain in normal settings storage.

Tauri stores secrets in the native system credential store through `desktop/src/credentials.rs`; browser sessions default to memory and may explicitly opt into WebCrypto-encrypted IndexedDB storage. Native failures must never silently fall back to browser or plaintext storage. New integration credentials use stable `CredentialRef` values and join the unified Settings surface rather than adding feature-local key forms.

App dialogs compose the Reka-backed components under `src/components/ui/dialog/` and the typed theme in `src/theme/dialog.ts`. Do not repeat portal, overlay, content, header, or footer infrastructure in feature dialogs.

## Commands

- `bun run dev` — Vite web app dev server
- `bun run build` — build workspace packages, run `lint`, then `vite build`
- `bun run preview` — preview the built web app
- `bun run tauri dev` — Tauri desktop app with hot reload; generates native menu first via Tauri `beforeDevCommand`
- `bun run tauri:automation:dev` — Tauri desktop app with debug automation config (`withGlobalTauri`) for MCP/WebDriver GUI automation bridges
- `bun run mcp:tauri` — start the `hypothesi/mcp-server-tauri` MCP server
- `bun run tauri:mcp:session` — start a `hypothesi/mcp-server-tauri` driver session on port 9223
- `bun run tauri:mcp:screenshot` — capture a webview screenshot through the hypothesi Tauri MCP CLI
- `bun run tauri:webdriver:install` — install `tauri-wd` from `tauri-webdriver-automation`
- `bun run tauri:webdriver` — start the `tauri-wd` WebDriver server on port 4444
- `bun run build:packages` — build `@open-pencil/core`, `@open-pencil/vue`, `@open-pencil/mcp`, `@open-pencil/cli`, and private `@open-pencil/compiler`
- `bun run lint` — structure lint + type-aware oxlint over app, packages, compiler, tests, scripts, tools
- `bun run lint:structure` — fast structural oxlint pass
- `bun run check` — full pre-commit gate: package build, lint, `tsgo`, Vue typecheck, i18n/package/arch checks, type-shape/tool/dupe tests
- `bun run check:arch` — Steiger architecture lint for import boundaries, test placement, scripts/tools layout, compiler layers
- `bun run check:vue` — `vue-tsc` for root app and `packages/vue`
- `bun run check:i18n` — locale JSON keys must match `packages/vue/src/i18n/messages.ts`
- `bun run check:packages` — public package metadata must point to built `dist/`, not runtime TypeScript
- `bun run format` — oxfmt with import sorting
- `bun run format:check` — run formatter and fail if it leaves a git diff
- `bun run test:unit` — Bun unit/engine tests under `tests/engine`
- `bun run test:coverage` — Bun coverage for `tests/engine`
- `bun run test` — Playwright app/visual regression (`--project=openpencil`)
- `bun run test:update` — update Playwright snapshots for the OpenPencil project
- `bun run test:figma` — Playwright Figma automation project
- `bun run test:dupes` — jscpd clone detection across `packages/core/src`, `packages/cli/src`, `packages/compiler/src`, and `src`
- `bun run test:type-shapes` — duplicate object-type shape detector
- `bun run test:tools` — run private tool package tests under `tools/*`
- `bun run test:packages` — package metadata check + packed tarball smoke tests
- `bun run check:figma-motion-plugin` — typecheck, test, and build the development Figma Motion adapter plugin
- `bun run docs:dev` / `docs:build` / `docs:preview` — VitePress docs lifecycle
- `bun run generate:tauri-menu` — regenerate `desktop/generated/menu.json` from shared menu schema
- `bun run visual-compare` — Figma vs OpenPencil renderer visual comparison helper
- `bun open-pencil info <file>` — document stats
- `bun open-pencil tree <file>` — node tree
- `bun open-pencil find <file>` — search nodes
- `bun open-pencil node <file> --id <id>` — detailed node properties
- `bun open-pencil pages <file>` — list pages
- `bun open-pencil formats` — list readable/writable/export formats registered by `IORegistry`
- `bun open-pencil convert <file> --format fig -o <out.fig>` — convert documents through the IO registry
- `bun open-pencil convert <file.pen> --format pen -o <out.pen>` — source-preserving `.pen` MotionSpec metadata write; rejects non-Motion edits
- `bun open-pencil query <file> '<xpath>'` — query nodes with XPath selectors
- `bun open-pencil selection` — inspect current selection from a running app via RPC
- `bun open-pencil variables <file>` — list design variables
- `bun open-pencil lint <file>` — run design linter rules
- `bun open-pencil export <file>` — headless render to PNG/JPG/WEBP
- `bun open-pencil compile <file> -o <dir>` — compile `.pen`/`.fig` to a runnable Vite + React + TypeScript project
- `bun open-pencil build <file> -o <dir>` — compile and Vite-build a static SPA bundle
- `bun open-pencil deploy <file> --provider netlify|vercel` — build and deploy a static SPA; token comes from CLI arg or provider env var
- `bun open-pencil analyze colors <file>` — color palette usage
- `bun open-pencil analyze typography <file>` — font/size/weight stats
- `bun open-pencil analyze spacing <file>` — gap/padding values
- `bun open-pencil analyze clusters <file>` — repeated patterns
- `bun open-pencil eval <file> --code '<js>'` — execute JS with Figma Plugin API
- `bun open-pencil motion figma-adapter <file> --node <id> -o <script.js>` — diagnose and generate a safe official Figma Motion Plugin API adapter script
- `bun open-pencil motion inspect <snapshot.json>` — inspect/import a detached official Figma Motion readback snapshot
- `bun open-pencil motion apply <file> --node <id>` — compare/plan by default, or explicitly emit a Plugin API script/safe apply snapshot
- `bun open-pencil motion clear [snapshot.json]` — compare/plan a clear or emit a guarded clear snapshot without raw timeline writes
- `bun open-pencil motion export <file> --node <id> -o <path>` — export deterministic PNG/GIF or capability-gated WebM/MP4 animation
- `bun open-pencil motion presets publish|import|check|accept ...` — manage readonly shared Motion preset manifests with explicit update acceptance

## Releases & CI

### How to release

1. Update version in `package.json`, each public `packages/*/package.json` including `packages/motion-runtime/package.json`, `desktop/tauri.conf.json`, and `desktop/Cargo.toml`
2. Update `CHANGELOG.md` — move "Unreleased" items under new version heading with date
3. Commit: `Release v0.x.y`
4. Tag: `git tag v0.x.y && git push --tags`
5. Ensure GitHub release secrets include `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the updater key is password-protected); the public updater key is configured in `desktop/tauri.conf.json`.
6. The `build.yml` workflow triggers on `v*` tags and:
   - Builds Tauri binaries for macOS (arm64 + x64), Windows (x64 + arm64), Linux (x64)
   - Creates a draft GitHub Release with all platform binaries
   - Publishes all public workspace packages, including `@open-pencil/motion-runtime`, to npm with provenance
7. `@open-pencil/compiler` is private and built for app/CLI consumption, but it is not currently published as a standalone npm package.
8. Go to GitHub Releases → edit the draft → paste changelog section → publish

### CI workflows

| Workflow                 | Trigger                                          | What it does                                                                                                           |
| ------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                 | PR to `master` (non-docs)                        | `format:check`, full `bun run check`, engine unit tests, copy-paste detection                                          |
| `preview.yml`            | PR to `master` (non-docs), `pull_request_target` | Build web app, deploy Cloudflare Pages preview, comment preview URL                                                    |
| `build.yml`              | `v*` tag push or manual                          | Build Tauri desktop apps (5 targets), create GitHub Release, and publish all public workspace packages with provenance |
| `homebrew.yml`           | Release published                                | Update `open-pencil/homebrew-tap` cask with new version + SHA256 hashes                                                |
| `app.yml`                | Push to `master` (non-docs)                      | Build web app, deploy to Cloudflare Pages (`app.openpencil.dev`)                                                       |
| `docs.yml`               | Push to `master` (`packages/docs/**`)            | Build VitePress docs, deploy to Cloudflare Pages (`openpencil.dev`)                                                    |
| `heavy-tests.yml`        | Manual                                           | Heavy `.fig` round-trip tests with `BUN_HEAVY_TESTS=true`                                                              |
| `pr-review-guidance.yml` | PR review/comment events                         | Record CodeRabbit review guidance using trusted default-branch tooling only                                            |

### Before committing

Run all quality gates (see [Code quality](#code-quality) for the self-review checklist):

```sh
bun run check          # oxlint + tsgo type-aware lint & typecheck
bun run format         # oxfmt
bun run test:dupes     # jscpd — zero clones
bun run test:type-shapes # duplicate object type-shape detector
bun run test:tools     # private repo tooling tests
bun run test:unit      # bun:test
bun run test:packages  # package metadata + packed tarball smoke tests
bun run test           # Playwright E2E
```

## Documentation

- `CHANGELOG.md` — all user-facing changes, grouped by version. "Unreleased" section at top for in-progress work.
- `README.md` — user-facing: features, getting started, CLI, project structure. No implementation details.
- `AGENTS.md` (this file) — contributor/agent reference: architecture, conventions, how to release.
- `packages/docs/` — VitePress site deployed at `openpencil.dev`. User guide, SDK, automation, reference, and development docs. Do not create English placeholder copies under locale directories; until a real translation exists, localized navigation should link to the canonical English page.
- `docs/lowcode-phase-*.md` — implementation/design notes for the lowcode compiler phases. Keep durable public docs in `packages/docs/**`; only add root-level Markdown by deliberately updating the Steiger allowlist.
- `docs/tauri-gui-automation.md` — local Tauri GUI automation setup for hypothesi MCP bridge and tauri-webdriver.

When adding features, update `CHANGELOG.md` (Unreleased section) and `README.md` (if user-facing). Update `AGENTS.md` when architecture or conventions change.

## Commit messages

Use Conventional Commits for regular development commits: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `chore`.

- Keep the first line short, imperative, and scoped when helpful
- Put rationale and implementation details in the commit body
- Keep the commit type lowercase (`fix:`, `feat:`, `docs:`), but start each body line/bullet with an uppercase word
- Prefer scopes that match the project structure: `app`, `tauri`, `core`, `cli`, `mcp`, `vue`, `docs`, or focused domains like `editor`, `scene-graph`, `canvas`, `tools`, `kiwi`, `io`, `text`, `vector`, `color`, `acp`, `ai`, `collab`, `automation`, `i18n`
- Use the narrowest honest scope, or omit it if the change spans multiple unrelated areas

Example:

```text
fix(editor): preserve text edit undo state

- Snapshot both text and styleRuns when editing starts
- Restore both on undo instead of comparing against the live node
```

Release commits are the exception: keep using `Release v0.x.y`.

## CLI

- All CLI output must use `agentfmt` formatters — `fmtList`, `fmtHistogram`, `fmtSummary`, `fmtNode`, `fmtTree`, `kv`, `entity`, `bold`, `dim`, etc.
- Don't hand-roll `console.log` formatting — use the helpers from `packages/cli/src/format.ts` which re-exports agentfmt with project-specific adapters (`nodeToData`, `nodeDetails`, `nodeToTreeNode`, `nodeToListItem`)
- Inspect/report commands should support `--json` when practical. Do not add `--json` to pure write-only commands unless there is a useful structured result.
- Document format operations go through `@open-pencil/core/io` and `IORegistry`; do not duplicate `.fig`/`.pen`/SVG/raster read-write logic in CLI commands.
- Design-to-code commands (`compile`, `build`, `deploy`) share `packages/cli/src/codegen.ts`, `i18n-args.ts`, and `ui-kit-args.ts`. Keep option parsing there when flags must remain consistent across all three commands.

## Tools (AI / MCP / CLI)

- Tool operations live in `packages/core/src/tools/` as framework-agnostic `ToolDef` objects, split by domain folders and barrels:
  - `schema.ts` — `ToolDef` type, `defineTool()`, shared helpers (`nodeSummary`, `nodeToResult`, `requireNode`)
  - `read/` + `read.ts` — selection, node lookup, JSX, pages, fonts, components, XPath query, lowcode reads
  - `create/` + `create.ts` — basic shapes, JSX render, components, icons, SVG import, vectors
  - `modify/` + `modify.ts` — node updates, paint, text, layout, effects, state, lowcode mutations
  - `structure/` + `structure.ts` — delete, clone, reparent, group, arrange, replace, tree/batch ops
  - `variables/` + `variables.ts` — variable/collection CRUD, binding, unbinding
  - `vector/` + `vector.ts` — boolean ops, path edit, viewport, SVG/PDF/image export
  - `analyze/` + `analyze.ts` — colors, typography, spacing, clusters, diff, eval wrappers
  - `describe/` — design summaries, issue detection, role/tree descriptions
  - `codegen/` — token and component-map extraction
  - `stock-photo/` + `stock-photo.ts` — stock image provider requests and fill application
  - `calc.ts` — utility calculation tool
  - `registry-core.ts` — `CORE_TOOLS`, the default app AI set (curated 50+ common tools, lower schema/token cost)
  - `registry-extended.ts` — advanced variables, vector, export, analysis, codegen, and structure tools
  - `registry.ts` — exports `ALL_TOOLS = [...CORE_TOOLS, ...EXTENDED_TOOLS]`
- Each tool has: name, description, typed params, and an `execute(figma: FigmaAPI, args)` function
- `defineTool()` gives type-safe params in the execute body; the array `ALL_TOOLS` erases the generics for adapters
- AI adapter (`packages/core/src/tools/ai-adapter.ts`): `toolsToAI()` converts ToolDefs → valibot schemas + Vercel AI `tool()` wrappers
- `src/app/ai/tools/index.ts` intentionally uses `CORE_TOOLS` to keep chat schemas small. Only add a tool to `CORE_TOOLS` when it is common enough for default AI chat; otherwise put it in `EXTENDED_TOOLS`.
- CLI commands (`packages/cli/src/commands/`) are **not** generated from ToolDefs — they have custom agentfmt formatting, tree walking, pagination. The `eval` command is the CLI's access to all ToolDef operations via FigmaAPI.
- MCP adapter (`packages/mcp/src/server.ts` + `tool/registration.ts`): `startServer()` creates the HTTP/WebSocket server and registers `ALL_TOOLS` as MCP tools (zod schemas). Listener lifecycle and session ownership live under `packages/mcp/src/server/`; the stdio client bridge lives under `packages/mcp/src/stdio/`.
- Local MCP transport discovery lives under `packages/mcp/src/transport/`: macOS/Linux prefer an owner-only Unix socket, Windows uses localhost TCP, and `mcp.json` advertises the active transport and token. Keep transport tests grouped under `tests/engine/mcp/{server,stdio,transport}/`, shared MCP fixtures under `tests/helpers/mcp/`, and test discovery paths isolated from the user's runtime file.
- MCP-only tools (`open_file`, `new_document`, `save_file`, `get_codegen_prompt`) are registered directly in `packages/mcp/src/tool/registration.ts`, not as ToolDefs — they need Node.js fs access or don't operate on the scene graph
- `open_file` and `new_document` are only registered when `OPENPENCIL_MCP_ROOT` is set (path scoping for security)
- Export tools (`export_image`, `export_svg`, `get_jsx`) accept an optional `path` param — when provided and `OPENPENCIL_MCP_ROOT` is set, the MCP server writes output to disk and returns `{ written, byteLength }` instead of the raw data. Path checks must resolve symlinks before filesystem access.
- Core prompts (`CODEGEN_PROMPT`, `JSX_REFERENCE`) live as markdown files in `packages/core/src/tools/prompts/`, loaded via raw-md bundler plugin; app chat/ACP prompts live under `src/app/ai/**` markdown files.
- To add a new tool: add a `defineTool()` in the appropriate domain file, export it from the domain barrel, add it to `CORE_TOOLS` or `EXTENDED_TOOLS` intentionally. MCP and CLI eval see `ALL_TOOLS`; app AI chat sees only `CORE_TOOLS`.
- `FigmaAPI` (`packages/core/src/figma-api/`) is the execution target for all tools — Figma Plugin API compatible, uses Symbols for hidden internals

## Lowcode compiler

- `packages/compiler` is private and is the source of truth for design-to-code output. Data flow is one-way: `SceneGraph` → `packages/compiler/src/ir/**` → `packages/compiler/src/adapters/**`.
- `packages/compiler/src/ir/**` must not import adapters. `packages/compiler/src/adapters/**` must not import `@open-pencil/scene-graph`; adapters consume only IR types. Steiger enforces this with `open-pencil/no-cross-layer-in-compiler`.
- Public compiler entrypoints: `compile()`, `withDefaults()`, lowcode validators re-exported from `@open-pencil/core/lowcode-validation`, route helpers, VFS/dev-server/build/deploy subpaths.
- React adapter output is Vite + React + TypeScript + Tailwind. It supports multi-page `react-router-dom`, preview bridge `data-node-id` wiring, i18n via `react-intl`, optional shadcn UI kit emission, Supabase auth/data helpers, workflows, validation, uploads, and static builds.
- Preview pane code lives in `src/app/lowcode/preview-pane/`. In Tauri, it spawns `bun packages/compiler/src/dev-server.ts --root <repo>` through the shell allowlist name `lowcode-preview`; the browser bundle must not statically import compiler dev-server/build/deploy code.
- One-click deploy shells out to `bun packages/cli/src/index.ts deploy ... --json` with provider tokens passed through env (`NETLIFY_AUTH_TOKEN` / `VERCEL_TOKEN`), never as process args or persisted document data.
- Lowcode document/page/node fields live on `SceneNode` (`state`, `bindings`, `events`, `interactiveProps`, `lowcodeDocumentState`, `lowcodeSupabaseConfig`, translations, workflows, route/auth fields) and round-trip through `.fig` pluginData keys in `packages/core/src/kiwi/fig/node-change/lowcode-plugin-data.ts`.
- Personal Motion preset definitions and favorites are user-scoped app settings, not SceneGraph fields. The local settings envelope stores both; portable JSON contains the versioned library metadata and preset definitions but deliberately omits favorites. The portable library format and strict migration/parser helpers live under `packages/scene-graph/src/motion/`; app persistence, browser/native file exchange, and UI state live under `src/app/motion-presets/`. Applied nodes always receive a complete expanded `MotionSpec` snapshot, so `.fig`, clipboard, collaboration, instances, and compiler behavior never require the source library. Imported `.pen` sources use the versioned `metadata.openPencil` envelope; the Pen writer updates Motion-only edits and rejects all other edits.
- Figma native Motion remains an adapter boundary: `MotionSpec` is canonical, the active shared envelope is strict and conflict-free, and both generated scripts and `packages/figma-motion-plugin` must execute the same runtime-validated applicator from `@open-pencil/fig`. Reject unsupported semantics; under the default `replace-owned` policy, also reject foreign/native-edited state. Treat `replace-all` as explicit destructive consent to remove only the verified removable subset, while indexed and unknown future tracks still fail closed. Require explicit timeline-growth consent, verify readback and rollback, and never synthesize undocumented native timeline bytes in raw `.fig` output.
- Preset-card previews use the editor's ephemeral Motion preview state and must not mutate nodes or create undo entries. Multi-node preset/spec application validates every staggered snapshot first, then commits one instance-aware undo batch.
- Validate lowcode mutations through `packages/core/src/lowcode-validation/**` and the lowcode ToolDefs in `packages/core/src/tools/modify/lowcode.ts`; do not hand-assign unvalidated action/state JSON in app UI or compiler code.
- Lowcode test coverage belongs under `tests/engine/compiler/**`, `tests/engine/lowcode-validation/**`, `tests/engine/tools/lowcode/**`, `tests/engine/kiwi/lowcode/**`, or UI-facing E2E specs when behavior is visible in the app.

## ACP (Agent Client Protocol)

- ACP transport (`src/app/ai/acp/transport.ts`) spawns agents via dynamic import of `@tauri-apps/plugin-shell`
- Pure mapping logic in `src/app/ai/acp/map-update.ts` — converts `SessionUpdate` → `UIMessageChunk`
- ACP design context prompt (`ACP_DESIGN_CONTEXT`) is authored in `src/app/ai/acp/design-context.md` and re-exported from `src/constants.ts`
- Agent definitions (`ACP_AGENTS`) in `packages/core/src/constants.ts`
- MCP server: Vite plugin in dev spawns `bun run packages/mcp/src/index.ts`; production Tauri spawns global `openpencil-mcp-http` through shell permissions (requires matching `@open-pencil/mcp` version installed globally; follow-up: bundle as Tauri sidecar)
- Architecture: app/browser ↔ WebSocket :7601 ↔ MCP server HTTP :7600 (`/health`, `/rpc`, `/mcp`) ↔ agent subprocess / MCP clients
- Production MCP spawn uses `OPENPENCIL_MCP_AUTH_TOKEN` and `OPENPENCIL_MCP_CORS_ORIGIN`; app health-checks version compatibility and surfaces the package-manager-specific install command
- Shell permissions scoped per-command in `desktop/capabilities/default.json` (`args: true` — agents need dynamic SDK flags)
- ACP providers visible only in Tauri desktop when MCP server is reachable
- Permission requests shown in AlertDialog — user must approve/reject each request (60s auto-reject timeout)

## Collaboration

- P2P via Trystero (WebRTC) — no server relay. Signaling over MQTT public brokers.
- Yjs CRDT for document state sync. Awareness protocol for cursors/selections/presence.
- y-indexeddb for local persistence — room survives page refresh.
- Constants in `src/constants.ts`: `TRYSTERO_APP_ID`, `PEER_COLORS`, `ROOM_ID_LENGTH`, `ROOM_ID_CHARS`, `YJS_JSON_FIELDS`
- `src/app/collab/use.ts` — composable: connect/disconnect, cursor/selection broadcasting, follow mode, Yjs ↔ SceneGraph sync
- Provided via `COLLAB_KEY` injection — `useCollabInjected()` in child components
- ICE servers: Google STUN + Cloudflare STUN + Open Relay TURN (TCP + UDP)
- Room IDs use `crypto.getRandomValues()` — no `Math.random()` anywhere in codebase
- Stale cursors cleaned on peer disconnect via `removeAwarenessStates()`

## Code conventions

- Do not place code or tests ad hoc. Before adding or moving files, inspect the existing folder structure and nearby patterns, then put changes in the established domain-specific location. If no proper location exists, create one deliberately and update docs/conventions as needed.
- Architecture boundaries are enforced by Steiger (`bun run check:arch`). App code must use public workspace package exports, workspace packages must not import app `src/` code, package-local aliases (`#core`, `#vue`, `#cli`, `#compiler`, `#mcp`) are only for their owning package, core must stay framework-agnostic, compiler IR must not import adapters, compiler adapters must not import scene-graph internals, app service/domain code (`src/app/**`) must not import app component/view layers, components must not import views, shared UI (`src/components/ui/**`) must not import app services/stores, property-panel internals must stay inside the property panel, canvas/editor overlay code must not import property-panel internals, Vue components must not use `<style>` blocks, code outside core editor internals must not assign `editor.state.selectedIds` or `editor.state.activeTool` directly, committed code must not import scratch/generated/vendor internals, and durable docs belong under `packages/docs/**` unless the root Markdown allowlist is deliberately updated.
- Test placement is strict and enforced by Steiger: app E2E tests live under `tests/e2e/**` and use `*.spec.ts`; Figma automation tests live under `tests/figma/**` and use `*.spec.ts`; engine/unit tests live under `tests/engine/**` and use `*.test.ts` (with `helpers.ts`, `*.bench.ts`, and `visual-*` support scripts allowed); shared test utilities live under `tests/helpers/**`. Engine tests should live under a domain folder that mirrors the source module under test (for example `tests/engine/io/fig/**`, not `tests/engine/fig/**`). Do not commit temporary/profile specs (`*.tmp.*`, `*.profile.*`). Do not put store-only/internal-state assertions in E2E. If a test drives the UI like a user and verifies visible behavior, it can be E2E; if it creates nodes through internals and asserts graph state, it belongs in engine/unit coverage.

### File and folder naming

OpenPencil follows a Reka UI-inspired component namespace structure:

- Vue component namespace folders use PascalCase: `ColorPicker/`, `Toolbar/`, `ProviderSettings/`.
- Vue component files use PascalCase: `ColorPickerRoot.vue`, `ToolbarItem.vue`.
- Component-scoped composables use camelCase: `useToolbarState.ts`, `usePageList.ts`.
- Non-component domain folders use lowercase or kebab-case: `scene-graph/`, `figma-api/`, `node-edit/`.
- Non-component TypeScript files use lowercase or kebab-case unless they are conventional entrypoints such as `index.ts`, `types.ts`, `context.ts`, or `use.ts`.
- Multi-file root components live inside their component namespace folder, not beside it.
- Use subfolders for multi-file domains instead of sibling files with repeated prefixes. Prefer `selection/container.ts`, `selection/hit-test.ts` over `selection-container.ts`, `selection-hit-test.ts`. When adding a second file for a domain (e.g. `eval-wrap.ts` next to `eval.ts`), create the folder immediately (`eval/index.ts` + `eval/wrap.ts`) instead of prefixing. Oxlint catches sibling prefix files when a sibling folder exists; Steiger catches 3+ sibling files with the same prefix. The convention applies even before either rule triggers.

### Repo tools and scripts

Private repository tooling lives under `tools/<domain>/`, not as ad-hoc root scripts. Use kebab-case domain folders and split by capability inside `src/`:

```text
tools/<domain>/
  package.json
  src/index.ts
  src/<capability>.ts
  tests/<capability>.test.ts
```

Use `scripts/` only for tiny compatibility entrypoint shims that import `../tools/<domain>/src/...`; do not put implementation logic there. Workflow helpers, release packaging helpers, architecture rules, package checks, visual-oracle utilities, and other maintainable programs belong in `tools/` with focused tests when they contain logic. Steiger enforces tool layout and script shims. `bun run check` includes `bun run test:tools`, and lint/format cover `tools/`.

- `@/` import alias for app cross-directory imports; app feature code lives under `src/app/*`
- Use package-local aliases inside workspace packages: `#vue/*` in `packages/vue`, `#cli/*` in `packages/cli`, `#compiler/*` in `packages/compiler`, `#mcp/*` in `packages/mcp`, and `#core/*` when core code needs an alias. Prefer relative imports within nearby modules when that is clearer than an alias.
- No `any` — use proper types, generics, declaration merging
- No `!` non-null assertions — use guards, `?.`, `??`
- No `Math.random()` — use `crypto.getRandomValues()` everywhere
- No inline type definitions when a named type exists — use `Color` not `{ r: number; g: number; b: number; a: number }`, use `Vector` not `{ x: number; y: number }`, use `SceneNode` / `Effect` / `Fill` / `Stroke` from `@open-pencil/scene-graph` instead of re-spelling their shapes inline
- Shared types (GUID, Color, Vector, Matrix, Rect) are exported from `@open-pencil/scene-graph/primitives`
- Domain types (SceneNode, Fill, Stroke, Effect, BlendMode, etc.) live in `packages/scene-graph/src/` and are exported from `@open-pencil/scene-graph`
- Window API extensions (showOpenFilePicker, queryLocalFonts) live in `src/global.d.ts` and `packages/core/src/global.d.ts`
- Use `culori` for color conversions — don't reimplement parseColor/colorToRgba
- Use `@vueuse/core` hooks — prefer higher-level composables (`useBreakpoints`, `useEventListener`, `onClickOutside`, etc.) over raw APIs (`useMediaQuery`, manual `addEventListener`)
- Prefer VueUse utilities for simple browser/timer state: `refAutoReset` for temporary copied/saved flags, `promiseTimeout` for async sleeps/retry backoff, `useClipboard`/`useFileDialog`/`useLocalStorage` where they fit the local state model. Don't force VueUse when direct APIs are clearer: one-shot `requestAnimationFrame` focus/defer calls, explicit service-owned reconnect/permission timers, or nanostores-backed state can stay hand-rolled.
- No module-level mutable state in components — use the editor store
- Prefer `tw-animate-css` for animations — don't hand-write `<style>` transition keyframes
- No duplicated component logic — if two components share data (icon maps, util functions, constants), export from one place and import in both
- `packages/kiwi/src/schema-runtime/` contains the vendored Kiwi codec runtime; keep runtime changes minimal and prefer wrappers/helpers for project-specific validation
- Core code must guard browser APIs: `typeof window !== 'undefined'`, `typeof document === 'undefined'`
- Constants in `src/constants.ts` — no magic numbers in components or composables

## Code quality

Before submitting a PR, run the full quality gate and do a self-review:

```sh
bun run check          # oxlint + tsgo type-aware lint & typecheck — zero errors required
bun run format         # oxfmt with import sorting
bun run test:dupes     # jscpd — zero clones required
bun run test:type-shapes # duplicate object type shapes — zero duplicates required
bun run test:tools     # private repo tooling tests
bun run test:unit      # bun:test
bun run test:packages  # package metadata + tarball smoke tests
bun run test           # Playwright E2E
```

Self-review checklist:

- Run `bun run test:dupes` — if duplication rises, extract shared helpers or use existing types
- Run `bun run test:type-shapes` — if object type shapes duplicate, reuse/export a named type instead of re-declaring it
- Run `bun run check:i18n` after editing `packages/vue/src/i18n/messages.ts` or locale JSON files
- Run `bun run check:packages` / `bun run test:packages` after touching public package exports, `files`, `bin`, `main`, `types`, or publish prep tooling
- No inline type definitions that duplicate named types (Color, Vector, SceneNode, Effect, Fill, Stroke, etc.)
- No copy-pasted logic — extract into functions. If two components share a util, icon map, or data structure, export from one place. If `jscpd` flags it, fix it.
- Use precise union types — `'closed' | 'half' | 'full'` not `number | string | null`
- Files should stay under ~600 lines — split by domain when they grow (see `packages/core/src/tools/` for the pattern)
- `structuredClone` for deep copies, never shallow spread when mutating nested objects
- Don't hand-roll what a dependency already does. Check existing deps first (`package.json`, `packages/*/package.json`). If none covers it, find a quality library instead of inlining an implementation — e.g. use `diff` for unified diffs, not a custom line-by-line loop; use `culori` for color math, not manual RGB parsing
- `es-toolkit` is available in core for small, focused utility helpers when it clearly improves readability. Prefer subpath imports such as `es-toolkit/object`, `es-toolkit/array`, and `es-toolkit/predicate`; good fits include `omit` / `pick` for object key selection, `uniq` for dedupe, and `isNotNil` for typed nullish filtering. Do not replace clear native JavaScript just for consistency, and avoid `es-toolkit/compat` unless deliberately migrating lodash-compatible behavior.
- Check Reka UI for existing components (Dialog, Popover, DropdownMenu, Select, Tooltip, Toast, etc.) before building custom ones — especially dropdowns, popovers, and modals

## Rendering

- Canvas is CanvasKit (Skia WASM) on a WebGL surface, not DOM
- `renderVersion` vs `sceneVersion`: `renderVersion` = canvas repaint (pan/zoom/hover); `sceneVersion` = scene graph mutations. UI panels watch `sceneVersion` only.
- `requestRender()` bumps both counters; `requestRepaint()` bumps only `renderVersion`
- `renderNow()` is only for surface recreation and font loading (need immediate draw)
- Resize observer uses rAF throttle, not debounce — debounce causes canvas skew
- Viewport culling skips off-screen nodes; unclipped parents are NOT culled (children may extend beyond bounds)
- Selection border width must be constant regardless of zoom — divide by scale
- Section/frame title text never scales — render at fixed font size, ellipsize to fit
- Rulers are rendered on the canvas (not DOM), with selection range badges that don't overlap tick numbers
- Remote cursors: Figma-style colored arrows with white border + name pill, rendered in screen space
- Pixel-affecting renderer features need committed visual coverage, not just mock/geometry assertions. Add or update a Playwright canvas snapshot for changes to fills, gradients, images, blend modes, masks, boolean geometry, corners, strokes, shadows, blur, text rendering, or demo showcase scenes. Use targeted snapshot updates such as `bunx playwright test tests/e2e/canvas/renderer-visuals.spec.ts --project=openpencil --update-snapshots` and then rerun the same test without `--update-snapshots`.

## Scene graph

- Nodes live in flat `Map<string, SceneNode>`, tree via `parentIndex` references
- Frames clip content by default is OFF (unlike what you'd assume)
- When creating auto-layout, sort children by geometric position first
- Dragging a child outside a frame should reparent it, not clip it
- Layer panel tree must react to reparenting — watch for stale children refs
- Groups: creating a group must preserve children's visual positions

## Components & instances

- Purple (#9747ff) for COMPONENT, COMPONENT_SET, INSTANCE — matches Figma
- Instance children map to component children via `componentId` for 1:1 sync
- Override key format: `"childId:propName"` in instance's `overrides` record
- Editing a component must call `syncIfInsideComponent()` to propagate to instances
- `SceneGraph.copyProp<K>()` typed helper — uses `structuredClone` for arrays

## Layout

- `computeAllLayouts()` must be called after demo creation and after opening .fig files
- Yoga WASM handles flexbox; CSS Grid blocked on upstream (facebook/yoga#1893)
- Auto-layout creation (Shift+A) must recompute layout immediately to update selection bounds
- Editing a Hug/Fill width or height switches only that axis to Fixed on the first value mutation; focus stays non-destructive, and mode plus value changes belong to one undo transaction

## UI

### Component structure

- `src/components/ui/**` is the app design-system layer: reusable visual primitives, wrappers around Reka UI primitives, low-level styled controls, and UI class helpers. These files must not import app services/stores or feature panels.
- `src/components/Shell/**` is for app shell chrome and global app services rendered as components (menu bar, toast viewport, update/status chrome). Shell components may use app shell/editor stores.
- `src/components/properties/**`, `src/components/chat/**`, `src/components/LayerTree/**`, `src/components/Toolbar/**`, and similar folders are feature/domain component namespaces. Keep feature-specific controls there unless they are genuinely reusable UI primitives.
- Treat existing root-level picker/input/control components as migration candidates when touched; do not expand that pattern.
- Property-panel composition uses `PanelGrid`, `PanelFieldGroup`, `PanelItemRow`, and `PropertyItemRow`; do not reintroduce generic row wrappers such as the removed `PanelRow`. Variable-capable fields compose `BindableValue` providers, and fill UIs compose `FillRoot` / `FillSwatch` with a consumer-owned popover rather than rebuilding a combined picker wrapper.
- Test locators follow Playwright's user-facing priority: role/name, label, and text first. Multi-part components expose scoped `data-slot` anatomy; app concepts use semantic attributes such as `data-property`, `data-command`, and `data-node-id` when accessible identity is insufficient. Reserve `data-test-id` for rare integration boundaries such as the canvas/editor host, never add `testId`/`testHook` props, and do not manufacture globally unique compound IDs inside shared components.

- Use reka-ui for UI components (Splitter, ContextMenu, DropdownMenu, etc.)
- Vue UI styling APIs follow the Nuxt UI architecture: static Tailwind Variants themes live under `src/theme/**` with `slots`, `variants`, `compoundVariants`, and `defaultVariants`; components resolve the theme with `tv()` and merge per-instance `ui` overrides at each rendered slot. Single-root components expose `class` rather than a one-slot `ui` object. Do not add one-off `fooClass`, `barClass`, `emptyActionClass`, etc. props. Use `UI` casing in type names (`SelectUI`, not `SelectUi`).
- Steiger parses Vue templates and rejects visual-state Tailwind utility branches, template-time `use*UI()` calls, and raw SVG app icons. Bind semantic state through `data-*` attributes and resolve typed theme variants in script instead of bypassing the rule.
- Storybook is the internal component-state workshop (`bun run storybook`, `bun run build-storybook`), while VitePress is the canonical public SDK documentation. Colocate `*.stories.ts` with app UI components and use toolbar themes for light/dark states instead of adding test-only routes or showcase pages to the app.
- Reuse colocated Vue demo components between Storybook and VitePress rather than maintaining separate examples. Style shared demos with Tailwind; the docs theme scans Vue SDK primitive demos through its dedicated Tailwind source.
- Public component API tables are generated from Vue source and JSDoc with `vue-component-meta`; do not manually duplicate props, events, slots, or exposed APIs in Markdown. SDK examples are processed by VitePress Twoslash and must resolve against the public `@open-pencil/vue` API.
- Do not pass imperative setters/actions through slots as `:set-*`, `:update-*`, `:request-*`, `:toggle-*`, etc. unless the component is explicitly a renderless primitive whose whole contract is slot actions. Prefer `v-model`, emitted events, normal component props, or owned default UI. For DOM refs/focus, use VueUse (`templateRef`, `unrefElement`, `useFocus`, etc.) instead of ref callback plumbing through slots.
- App wrappers around SDK primitives should compose a single `ui` object from shared UI helpers (`useSelectUI`, `usePopoverUI`, etc.) rather than bypassing the design system with raw Tailwind strings spread across multiple props.
- Editor commands share `packages/vue/src/editor/commands/registry.ts` as the canonical source for shortcut display tokens, keyboard bindings, and context-menu test IDs. Store portable shortcuts such as `MOD+D`, `MOD+SHIFT+H`, and `MOD+ALT+K`; format them with `formatShortcut()` at render time so macOS shows `⌘`/`⌥` and Windows/Linux show `Ctrl`/`Alt`.
- Labels and translations must not contain shortcut text. Keep labels semantic (`Add auto layout`, `Show/Hide`) and render shortcuts from command metadata. Steiger enforces this for `packages/vue/src/i18n/messages.ts` and locale JSON files.
- Canvas context-menu structure lives in `packages/vue/src/editor/menu-model/canvas.ts`. Do not hand-build command grouping in `src/components/CanvasMenu.vue`; the component should render menu entries and provide app-specific actions only when unavoidable.
- Browser and Tauri menus share `src/app/shell/menu/schema.ts` as the canonical menu model. Do not add menu items directly in `src/components/AppMenu.vue` or `desktop/src/menu.rs`.
- Regenerate the native menu with `bun run generate:tauri-menu` after editing the shared menu schema; `desktop/generated/menu.json` is consumed by the Tauri menu builder. Tauri also runs this generator from `desktop/tauri.conf.json` via `beforeDevCommand` and `beforeBuildCommand`.
- Every shared menu item with an `id` must be handled by `src/app/shell/menu/use.ts`, an editor command, or explicitly marked browser/native-only in the schema.
- Tailwind 4 for styling — no inline CSS, no component-level `<style>` blocks
- Mac keyboards: use `e.code` not `e.key` for shortcuts with modifiers (Option transforms characters)
- Splitter resize handles need inner div with `pointer-events-none` for sizing (zero-width handle collapses without it)
- Number input spinner hiding is global CSS in `app.css`, not per-component
- ScrubInput (drag-to-change number) — cursor and pointerdown on outer container, not inner spans
- Icons: use unplugin-icons with Iconify/Lucide (`<icon-lucide-*>`) — don't use raw SVG or Unicode symbols
- App menu (`src/components/Shell/AppMenu.vue`) — browser-only menu bar using reka-ui Menubar components; Tauri uses native menus, so menu is hidden when `IS_TAURI` is true
- Binding-aware fields must not mutate or detach on focus. Start detach/edit-variable transactions only on the first actual value mutation; opening the variable picker is also non-destructive.
- Preserve established UI gotchas in nearby components before refactoring: splitter handle sizing, NumberField pointer ownership, section drag targets, side-panel containment, and global number-spinner styling.

## File format

- `@open-pencil/core/io` owns document/export format registration through `IORegistry` and `BUILTIN_IO_FORMATS`; app, CLI, and tests should route `.fig`, `.pen`, SVG, raster, and JSX operations through it when possible.
- `.fig` files use Figma's Kiwi schema and `NodeChange[]` records. Low-level schema/runtime/codec/container helpers live in `packages/kiwi/src/fig/**` and `packages/kiwi/src/schema-runtime/**`; complete `.fig` archive parsing lives in `packages/fig`.
- `@open-pencil/fig` owns SceneGraph ⇄ NodeChange conversion in `packages/fig/src/node-change/**`, component/instance interpretation in `packages/fig/src/instance-overrides/**`, and effective raw metadata policy in `packages/fig/src/source-metadata.ts`.
- Core owns `.fig` IO orchestration in `packages/core/src/io/formats/fig/**`, runtime font/glyph integration, workers, and CanvasKit thumbnails. Keep Fig behavior covered by package-local tests and dist smoke.
- `.pen` is the OpenPencil document format accepted by compiler/CLI workflows.
- Vector data uses reverse-engineered `vectorNetworkBlob` binary format — encoder/decoder in `packages/core/src/vector/` and scene-graph vector-network types in `@open-pencil/scene-graph`.
- `showOpenFilePicker` / `showSaveFilePicker` are File System Access API (Chrome/Edge), not Tauri-only; code must keep browser fallbacks.
- Safari save: no File System Access API → use an `<a>` download fallback with deferred `revokeObjectURL`. SafariBanner warns users about limitations.
- Tauri detection: use `IS_TAURI` from `@open-pencil/core/constants` / `src/constants.ts`; don't inline `__TAURI_INTERNALS__` checks.
- `.fig` export compression uses fflate in browser paths and Tauri Rust commands where available.
- Test `.fig` round-trip by exporting and reimporting in Figma when changing file-format behavior.
- Test fixtures (`tests/fixtures/*.fig`) are Git LFS. If no `.fig` fixtures changed, `git push --no-verify` can skip the slow LFS pre-push hook; use regular `git push` when fixtures changed.

## Tauri

- Tauri v2 with plugin-dialog, plugin-fs, plugin-opener, plugin-process, plugin-shell, and plugin-updater
- File system permissions must be configured in `desktop/tauri.conf.json` — "Internal error" on save means missing permissions
- Dev tools: add a menu item to toggle, don't rely on keyboard shortcut
- Shell permissions live in `desktop/capabilities/default.json`; ACP agents, MCP HTTP, and lowcode preview/deploy use allowlisted command names with `args: true`
- Lowcode preview/deploy uses allowlist name `lowcode-preview` (`cmd: bun`) to spawn compiler dev-server or CLI deploy from the repo root; if it fails in macOS GUI launches, check Bun is on the launch environment PATH

## Publishing

- `bun publish` from package dirs — resolves `workspace:*` → actual versions
- Public packages publish built `dist/` output, not runtime TypeScript entrypoints
- Core, Vue, MCP, and CLI build with tsdown before publishing
- `@open-pencil/compiler` is private; it is built by `bun run build:packages` and consumed by app/CLI workspace code, but not packed or published by `build.yml`
- CLI publishes a Node-compatible `bin/openpencil.js` wrapper; do not point package `bin` entries at TypeScript source
- `tools/package-quality` verifies public package entrypoints and packed tarballs; keep `main`, `types`, `exports`, `bin`, and `files` aligned with built output

## Reference

[figma-use](https://github.com/dannote/figma-use) — our Figma toolkit. Use as reference for:

- Kiwi binary format, schema, encode/decode (`packages/shared/src/kiwi/`)
- Figma WebSocket multiplayer protocol (`packages/plugin/src/ws/`)
- Vector network blob format (`packages/shared/src/vector/`)
- Node types, paints, effects, layout fields (`packages/shared/src/types/`)
- MCP tools / design operations (`packages/mcp/`)
- JSX-to-design renderer (`packages/render/`)
- Design linter rules (`packages/linter/`)

## Known issues

- Safari ew-resize/col-resize/ns-resize cursor bug (WebKit #303845) — fixed in Safari 26.3 Beta
