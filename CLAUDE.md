# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` is the authoritative contributor/agent reference (architecture, conventions, release process). Read it for anything not covered here. `CONTRIBUTING.md` lists `data-test-id` naming rules for Playwright E2E.

## Runtime

- **Bun**, not Node. Scripts run via `bun`; the CLI shebang is `#!/usr/bin/env bun`.
- Workspace uses `bun.lock`; do not introduce `npm`/`pnpm`/`yarn` lockfiles.

## Common commands

```sh
bun install
bun run dev                # Vite dev server at localhost:1420
bun run tauri dev          # Desktop app (requires Rust)

# Quality gate (run before committing)
bun run check              # oxlint (type-aware) + tsgo typecheck + check:vue + check:i18n + check:arch + test:dupes
bun run format             # oxfmt with import sorting
bun run test:unit          # bun:test, ./tests/engine
bun run test               # Playwright E2E (auto-starts dev server)
bun run test:figma         # Playwright against Figma (start it with `bun run figma:debug` first)
bun run test:dupes         # jscpd — zero clones required

# Single-test runs
bun test ./tests/engine/<file>.test.ts
bun test ./tests/engine/<file>.test.ts -t "<test name pattern>"
bun run test -- <spec-or-glob>                 # Playwright single spec
bun run test -- -g "<test title pattern>"
bun run test:update                            # Update visual-regression snapshots

# CLI (works against .fig/.pen files or live desktop app)
bun open-pencil tree <file>
bun open-pencil eval <file> -c "<js>"
```

## Architecture — big picture

**Monorepo** (`packages/*` workspace) split into a framework-agnostic engine and a Vue app that consumes it:

| Package | Role |
|---|---|
| `packages/core` (`@open-pencil/core`) | Engine: scene graph, Skia/CanvasKit renderer, Yoga layout, Kiwi codec for `.fig`, editor core, tools registry, FigmaAPI, RPC, lint, profiler. **Zero DOM deps** — runs headless in Bun. |
| `packages/vue` (`@open-pencil/vue`) | Headless Vue 3 SDK (Reka UI-style) — renderless components + composables. App is one consumer. |
| `packages/cli` (`@open-pencil/cli`) | Headless CLI (`citty` + `agentfmt`). Connects to running desktop via RPC when no file arg. |
| `packages/mcp` (`@open-pencil/mcp`) | MCP server, stdio + Hono HTTP. All ToolDefs auto-registered. |
| `packages/docs` (`@open-pencil/docs`) | VitePress site at openpencil.dev. |
| `src/` | Tauri/Vite Vue app. App-specific code under `src/app/{editor,document,ai,collab,shell,tabs,demo,automation,tauri}`. |
| `desktop/` | Tauri v2 (Rust). |

**Subpath exports of `@open-pencil/core`** isolate heavy deps. The app imports targeted paths (`@open-pencil/core/scene-graph`, `/canvaskit`, `/kiwi`, `/editor`, `/tools`, etc.) — see `AGENTS.md` for the full table. **The runtime `canvaskit-wasm` import exists only in `canvaskit.ts`**; everywhere else uses `import type` and the CanvasKit instance is passed as a parameter.

**Editor core** (`packages/core/src/editor/`) is 13 modules sharing an `EditorContext`. Each module is a factory `createXxxActions(ctx) => { ... }`; `create.ts` assembles them. `Editor = ReturnType<typeof createEditor>`. State mutations go through `ctx.setSelectedIds()` / `ctx.setActiveTool()` (never direct assignment) so the nanoevents bus fires consistently. The Vue SDK exposes `useEditorEvent(event, handler)` for auto-disposing subscriptions. The app session in `src/app/editor/session/create.ts` is a thin Vue wrapper around `createEditor()`.

**Tools** (`packages/core/src/tools/`) are framework-agnostic `ToolDef` objects split by domain (`read`, `create`, `modify`, `structure`, `variables`, `vector`, `analyze`). Add a `defineTool()`, include it in `registry.ts` `ALL_TOOLS`, and it becomes available simultaneously in AI chat, MCP server, and CLI `eval`. `FigmaAPI` (`packages/core/src/figma-api/`) is the Figma-Plugin-API-compatible execution target.

**Rendering**: CanvasKit (Skia WASM) on WebGL — not DOM. `renderVersion` = canvas repaint counter; `sceneVersion` = scene-graph mutations. **UI panels watch `sceneVersion` only.** `requestRender()` bumps both; `requestRepaint()` bumps only `renderVersion`; `renderNow()` is reserved for surface recreation / font loading.

**Collaboration**: Trystero (WebRTC P2P, no relay) + Yjs CRDT + y-indexeddb. Provided via `COLLAB_KEY` injection.

**ACP (Agent Client Protocol)**: browser ↔ WebSocket :7601 ↔ MCP :7600 ↔ HTTP ↔ agent subprocess. Agents are spawned via `@tauri-apps/plugin-shell`; visible only in Tauri desktop when the MCP server is reachable.

## Conventions you can't infer from the code

- **Architecture boundaries are enforced by Steiger** (`bun run check:arch`). App must import workspace packages through public entrypoints; package-local aliases (`#core`, `#vue`, `#cli`, `#mcp`) are scoped to their owning package. Core must stay framework-agnostic. `src/app/**` must not import view/component layers. Vue components must **not** use `<style>` blocks. Components must not import views. Shared UI (`src/components/ui/**`) must not import app services/stores.
- **Test placement is enforced**: E2E → `tests/e2e/**/*.spec.ts`; Figma automation → `tests/figma/**/*.spec.ts`; engine/unit → `tests/engine/**/*.test.ts`; helpers → `tests/helpers/**`. Don't commit `*.tmp.*` or `*.profile.*`. If a test asserts internal graph state, it belongs in engine/unit, not E2E.
- **File naming** (Reka UI-inspired): PascalCase folders+files for Vue components (`ColorPicker/ColorPickerRoot.vue`); kebab-case/lowercase for non-component domains (`scene-graph/`, `figma-api/`). When a domain grows to 2+ files, **create a subfolder** instead of sibling files with repeated prefixes — `selection/hit-test.ts` not `selection-hit-test.ts`. Oxlint and Steiger enforce this.
- **No `Math.random()` anywhere** — use `crypto.getRandomValues()`. No `any`. No `!` non-null assertions. Use `culori` for color math.
- **No inline type literals** when a named type exists — use `Color`, `Vector`, `SceneNode`, `Fill`, `Stroke`, `Effect` from `@open-pencil/core/scene-graph`.
- **Editor commands** (`packages/vue/src/editor/commands/registry.ts`) are the canonical source for shortcut display tokens. Store portable shortcuts like `MOD+SHIFT+H`; render with `formatShortcut()`. **Labels and i18n strings must not contain shortcut text** — Steiger enforces this for `packages/vue/src/i18n/messages.ts` and locale JSON.
- **Shared menu schema** in `src/app/shell/menu/schema.ts` drives both browser (`AppMenu.vue`) and Tauri native menus. Run `bun run generate:tauri-menu` after editing it (Tauri also runs this from `tauri.conf.json` via `beforeDevCommand`/`beforeBuildCommand`).
- **CLI output** must use `agentfmt` helpers from `packages/cli/src/format.ts` (`fmtList`, `fmtTree`, `fmtNode`, etc.); every command must support `--json`. Don't hand-roll `console.log` formatting.
- **MCP-only tools** (`open_file`, `new_document`, `save_file`, `get_codegen_prompt`) are registered directly in `packages/mcp/src/server.ts`, not as ToolDefs. File-access tools are gated on `OPENPENCIL_MCP_ROOT` being set.
- **`packages/core/src/kiwi/kiwi-schema/` is vendored** — don't modify.
- **Test fixtures** (`tests/fixtures/*.fig`) are Git LFS. Use `git push --no-verify` to skip the slow LFS hook unless `.fig` fixtures changed.
- **Tauri `IS_TAURI` constant** lives in `packages/core/src/constants.ts` — don't inline `'__TAURI_INTERNALS__' in window`.

## When in doubt

- Architecture/release/conventions in depth → `AGENTS.md`
- User-facing features and CLI examples → `README.md`
- Visual-regression / E2E test-id naming → `CONTRIBUTING.md`
- Changelog (Unreleased section at top) → `CHANGELOG.md`
