# Contributing

## Project Structure

```
packages/
  scene-graph/       @open-pencil/scene-graph — graph data, geometry, and authored schemas
  motion/            @open-pencil/motion — deterministic Motion planning and sampling
  lowcode/           @open-pencil/lowcode — expressions, validation, and runtime audits
  plugin-contracts/  @open-pencil/plugin-contracts — portable plugin and trust contracts
  pen/               @open-pencil/pen — Pencil document model and source-preserving writer
  kiwi/              @open-pencil/kiwi — Kiwi schema, codec, and container primitives
  fig/               @open-pencil/fig — .fig archives and SceneGraph conversion
  core/              @open-pencil/core — editor, renderer, layout, tools, and document I/O
  motion-runtime/    @open-pencil/motion-runtime — clocks, playback, and DOM/Vue adapters
  cli/               @open-pencil/cli — headless CLI
  mcp/               @open-pencil/mcp — MCP server for AI tools
src/
  app/               App-owned editor sessions, documents, AI, collaboration, and automation
  components/        Vue SFCs for the editor shell and feature surfaces
desktop/             Tauri v2 (Rust + config)
tests/
  e2e/               Playwright visual regression
  engine/            Integration and engine tests (bun:test)
packages/docs/       VitePress documentation site
```

## Development Setup

```sh
bun install
bun run dev          # Editor at localhost:1420
bun run docs:dev     # Docs at localhost:5173
```

## SDK documentation

VitePress is the canonical public documentation, while Storybook is the internal component-state workshop. Shared Vue demos live beside their SDK primitives and are embedded in both surfaces. The docs Tailwind entry scans these demos, so examples use the same utility-first styling in both environments.

Component API tables are extracted from Vue source and JSDoc with `vue-component-meta`. Keep descriptions next to the public props, events, and slots instead of duplicating signatures in Markdown. VitePress processes SDK code examples with Twoslash so imports and types stay aligned with the public package API.

## Code Style

### Tooling

| Tool   | Command             | Purpose                                     |
| ------ | ------------------- | ------------------------------------------- |
| oxlint | `bun run lint`      | Linting (Rust-based, fast)                  |
| oxfmt  | `bun run format`    | Code formatting                             |
| tsgo   | `bun run typecheck` | Type checking (Go-based TypeScript checker) |

Run all checks:

```sh
bun run check
```

### Conventions

- **File names** — kebab-case (`scene-graph.ts`, `use-canvas-input.ts`)
- **Components** — PascalCase Vue SFCs (`EditorCanvas.vue`, `NumberField.vue`)
- **Constants** — SCREAMING_SNAKE_CASE
- **Functions/variables** — camelCase
- **Types/interfaces** — PascalCase

### Test selectors

Playwright tests should locate behavior the way users and assistive technology do: prefer roles and
accessible names, labels, and visible text. Scope repeated controls to a named region. Multi-part UI
components expose local `data-slot` anatomy, while stable app concepts may expose semantic
attributes such as `data-property`, `data-command`, or `data-node-id`.

Reserve `data-test-id` for integration boundaries that have no meaningful user-facing or domain
identity. Do not add test-ID props to reusable components or generate compound IDs from current
component nesting.

### AI Agent Conventions

Developers and AI agents working on the codebase should read `AGENTS.md` in the repo root ([view on GitHub](https://github.com/open-pencil/open-pencil/blob/master/AGENTS.md)). Covers rendering, scene graph, components & instances, layout, UI, file format, Tauri conventions, and known issues.

## Making Changes

1. Implement the change
2. Run `bun run check` and `bun run test`
3. Submit a pull request

## Key Files

Core engine and host-owned plugin behavior live in `packages/core/src/`. Framework-agnostic Motion planning and sampling live in `packages/motion/src/`; low-code validation and runtime audit contracts live in `packages/lowcode/src/`; portable declarative plugin, trust, runtime-index, and marketplace contracts live in `packages/plugin-contracts/src/`. App-specific editor, document, AI, collaboration, shell, demo, and automation code lives under `src/app/*`; the Vue SDK owns reusable canvas/composable code under `packages/vue/src/`.

| File                                            | Purpose                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/scene-graph/src/`                     | Scene graph: nodes, variables, instances, hit testing, undo                                            |
| `packages/motion/src/`                          | Deterministic Motion planning, sampling, projection, paths, and input controllers                      |
| `packages/core/src/canvas/renderer.ts`          | CanvasKit rendering pipeline                                                                           |
| `packages/core/src/layout/`                     | Yoga layout adapter                                                                                    |
| `packages/core/src/clipboard.ts`                | Figma-compatible clipboard                                                                             |
| `packages/core/src/vector/`                     | Vector network model                                                                                   |
| `packages/core/src/io/formats/raster/render.ts` | Offscreen image export (PNG/JPG/WEBP)                                                                  |
| `packages/kiwi/src/schema-runtime/`             | Kiwi schema runtime and binary codec                                                                   |
| `packages/fig/src/node-change/`                 | SceneGraph and Figma NodeChange conversion policy                                                      |
| `packages/lowcode/src/`                         | Low-code expressions, validators, routes, workflows, and runtime audits                                |
| `packages/plugin-contracts/src/`                | Declarative plugin schemas, signing/trust, runtime, and marketplace contracts                          |
| `packages/core/src/io/formats/fig/`             | App-facing .fig read/write orchestration                                                               |
| `packages/cli/src/index.ts`                     | CLI entry point                                                                                        |
| `packages/core/src/tools/`                      | Unified tool definitions split by domain (read, create, modify, structure, variables, vector, analyze) |
| `packages/core/src/figma-api/`                  | Figma Plugin API implementation                                                                        |
| `packages/mcp/src/server.ts`                    | MCP server factory                                                                                     |
| `packages/cli/src/commands/`                    | CLI commands (info, tree, find, export, eval, analyze)                                                 |
| `src/app/editor/session/create.ts`              | Editor session assembly                                                                                |
| `packages/vue/src/canvas/CanvasRoot.vue`        | Canvas rendering composable                                                                            |
| `packages/vue/src/canvas/useCanvasInput.ts`     | Mouse/touch input handling                                                                             |
| `src/app/shell/keyboard/use.ts`                 | Keyboard shortcut handling                                                                             |
