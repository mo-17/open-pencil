# OpenPencil

Open-source design editor. Opens `.fig` and `.pen` design files, includes built-in AI, and ships as a programmable toolkit with a headless Vue SDK for building custom editors.

> **Status:** Active development. Usable today, with some rough edges as features evolve.

**[Try it online →](https://app.openpencil.dev/demo)** · [Download](https://github.com/open-pencil/open-pencil/releases/latest) · [Documentation](https://openpencil.dev) · [llms.txt](https://openpencil.dev/llms.txt)

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
- **Design-to-code export** — export selections as JSX/Tailwind, generate token outputs, and map designs into component-oriented code workflows
- **Code-based motion** — author bounded MotionSpec v1/v2/v3 timelines, structured channels, and
  cubic paths; choreograph page/frame scenes; build multi-node recipes, continuous drivers,
  prototypes, and Smart Match transitions; use personal, shared, or signed Team libraries; trigger
  tracks from lowcode workflows; compile to CSS/WAAPI with live reduced-motion handling; export
  deterministic PNG sequences or GIF plus capability-gated WebM/MP4; embed the public SSR-safe
  Motion Runtime SDK; and generate a fail-closed Figma Motion Plugin API adapter for the verified
  native subset
- **Lowcode app publishing** — turn pages into React/Tailwind apps with state, bindings, form validation, Supabase actions, workflows, i18n, shadcn/ui output, preview, build, and deploy flows
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

OpenPencil can compile a `.fig` or `.pen` document into a runnable Vite + React + TypeScript app. The lowcode compiler preserves layout, resolved web-font assets and script fallbacks, routes, interactive state, bindings, validation, workflows, Supabase auth/data actions, Stripe checkout and customer portal redirects through your own server endpoints, i18n catalogs, analytics hooks, controlled custom head/CSS metadata, and optional shadcn/ui components. Provider catalog policies are retained as provenance, but the compiler warns when a family-specific redistribution license still needs review.

```sh
openpencil compile app.fig -o generated-app
cd generated-app
npm install
npm run dev
```

Build a static SPA bundle for any static host:

```sh
openpencil build app.fig -o dist --ui-kit shadcn --i18n --locale fr
```

Deploy directly to Netlify, Vercel, or Cloudflare Pages:

```sh
NETLIFY_AUTH_TOKEN=... openpencil deploy app.fig --provider netlify --site my-site
VERCEL_TOKEN=... openpencil deploy app.fig --provider vercel --site my-project
CLOUDFLARE_API_TOKEN=... openpencil deploy app.fig --provider cloudflare --account-id <account-id> --site my-pages-project
```

For Supabase-backed apps, override production credentials at build/deploy time with `--supabase-url` and `--supabase-anon-key`, or set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Stripe checkout actions POST JSON to an author-owned endpoint and redirect to a returned `url` / `checkoutUrl`; Stripe customer portal actions POST JSON to an author-owned endpoint and redirect to a returned `url` / `portalUrl`. Stripe secret keys, webhook handling, subscriptions, and customer lookup stay on your server, never in the document or generated SPA. Lowcode analytics supports GA4, Plausible, and PostHog configuration stored in the document plus `trackEvent` actions, optional page views, Do Not Track, and a generated consent banner with local preference persistence, configurable copy, a configurable Analytics default state, and an EEA-style opt-in starter preset. Custom head/CSS support is limited to structured `<meta>`, `<link>`, `<style>`, and `index.css` output; arbitrary JavaScript is intentionally out of scope. See the [Lowcode Apps guide](https://openpencil.dev/user-guide/lowcode-apps) for the full path from preview to deploy.

For a safe end-to-end example, open or rebuild `packages/demos/lowcode/lowcode-onboarding-demo.fig`; it exercises Supabase, validation, workflows, Stripe checkout redirects through a demo endpoint, analytics hooks, i18n, shadcn/ui, and custom head/CSS using example provider values only.

## AI & MCP

### Built-in chat

Press <kbd>⌘</kbd><kbd>J</kbd> to open the AI assistant. Its curated built-in tool set covers common work such as rendering and editing nodes, fills, strokes, text, auto-layout, structure changes, and lowcode state. Attach a PNG, JPEG, WebP, or the current canvas selection as an explicit visual reference; a vision-capable model can analyze it and generate editable layout. A selected canvas reference can remain in place while the assistant builds beside it; a paperclip attachment stays chat-only and is not inserted onto the canvas. The composer shows which configured provider and model will receive the image. Model settings also offer default-off OpenRouter web search, provider-hosted OpenAI Code Interpreter, and selected Remote Streamable HTTP MCP servers; citations, generated-file references, and Direct MCP approval requests stay visible in chat. ACP agents apply their own redirect and permission policies for forwarded MCP servers. Bearer tokens use the unified credential store rather than model settings. Advanced component, variable, vector, analysis, and export operations are available through coding-agent and MCP integrations. Bring your own API key for OpenRouter, Anthropic, OpenAI, Google AI, DeepSeek, Z.ai, MiniMax, or compatible endpoints. No OpenPencil account or hosted backend is required.

### Coding agents (desktop)

Use Claude Code, Codex, or Gemini CLI directly in the chat panel. The agent connects to the editor's MCP server and uses all 140+ design operations. Requires the desktop app and the agent CLI installed locally.

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

Connect Claude Code, Cursor, Windsurf, or any MCP client to inspect, modify, and export design documents through 140+ design operations plus document/file lifecycle tools. The server connects to a running OpenPencil app for live-document operations, including `check_font` verification of text-node assignment and rendering plus conservative `audit_font_licenses` checks backed by exact bundled-font digests and embedded license evidence. [Full docs →](https://openpencil.dev/programmable/mcp-server)

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
