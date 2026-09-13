# Testing

## Overview

| Type                  | Framework  | Command                   | Location                             |
| --------------------- | ---------- | ------------------------- | ------------------------------------ |
| E2E visual regression | Playwright | `bun run test`            | `tests/e2e/`                         |
| Figma CDP reference   | Playwright | `bun run test:figma`      | `tests/figma/`                       |
| Daily unit tests      | bun:test   | `bun run test:unit:quick` | `tests/engine/`, `packages/*/tests/` |
| Heavy unit tests      | bun:test   | `bun run test:unit:heavy` | Selected fixture and CLI test files  |

## Documentation Build Memory

The production documentation build avoids loading every page into one Vite/Rolldown module graph.
By default, it runs the English partition followed by the partially translated `zh-cn` section.
Each enabled locale is built in a separate process so its heap can be released before the next
partition starts. After all enabled partitions succeed, their HTML, shared assets, page hash map,
and sitemap are merged into the final VitePress output.

Within each partition, VitePress page rendering is bounded to one page at a time by default.
LLM-friendly Markdown is generated only after the site build, in a separate bounded-memory pass:
per-page files are written immediately and `llms-full.txt` is streamed with backpressure instead of
being assembled in memory.

```sh
bun run docs:build
```

For faster builds on a machine with more memory, increase either concurrency limit explicitly:

```sh
DOCS_BUILD_CONCURRENCY=2 DOCS_LLMS_CONCURRENCY=4 bun run docs:build
```

Use these environment variables when diagnosing a documentation build:

| Variable                 | Purpose                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `DOCS_BUILD_CONCURRENCY` | Maximum concurrent VitePress page renders per locale; defaults to `1`.  |
| `DOCS_LLMS_CONCURRENCY`  | Maximum concurrent LLM Markdown transforms; defaults to `2`.            |
| `DOCS_TWOSLASH=0`        | Temporarily disables Twoslash semantic analysis; Shiki remains active.  |
| `DOCS_LOCAL_SEARCH=0`    | Temporarily disables local-search indexing to isolate search memory.    |
| `DOCS_LOCALES`           | Comma-separated site locales; defaults to `en,zh-cn` and requires `en`. |
| `DOCS_BUILD_LOCALE`      | Selects one internal locale partition; the normal build sets this.      |
| `DOCS_OUT_DIR`           | Uses a `.vitepress/dist*` final directory for an isolated experiment.   |
| `DOCS_CACHE_DIR`         | Overrides VitePress's cache directory for an isolated experiment.       |
| `NODE_OPTIONS`           | Preserves custom Node flags and adds a 4 GiB heap unless overridden.    |

The maintained production documentation defaults to English and Simplified Chinese. Archived
German, French, Spanish, Italian, Polish, and Russian sources remain in the repository but are not
built, indexed, linked in the language menu, or advertised through localized SEO. Set an explicit
override such as `DOCS_LOCALES=en,de,zh-cn` to rebuild an archived locale temporarily; the canonical
English locale is always required.

Keep or restore `DOCS_BUILD_CONCURRENCY=1` first when diagnosing an out-of-memory failure. Increase
it only after measuring peak RSS on the target machine. Use the Twoslash and local-search switches
only as diagnostic probes, not for a production deployment. The normal build owns
`DOCS_BUILD_LOCALE` and its per-partition temporary output/cache paths.

SDK component reference loaders share one `vue-component-meta` checker per absolute repository
tsconfig and checker option set. Vite bundles each `.data.ts` loader independently; without this
process-wide cache, every loader would retain another full TypeScript program and memory would grow
linearly during the English partition.

Local-search indexes are partition-specific. Navigation within one language remains client-side,
but switching languages performs a full page load so the browser loads the destination locale's
search index and route metadata instead of retaining those from the previous partition.
Localized SEO alternates are also source-aware: a page is linked with `hreflang` and included in
the sitemap's alternate-language list only when its translated Markdown source exists. This keeps
the partial Simplified Chinese section from advertising untranslated `/zh-cn/` URLs that would
return a 404; its navigation links those entries to the canonical English pages instead.

## E2E Visual Regression

Playwright creates shapes on the canvas and compares screenshots against baseline PNGs.

```sh
bun run test              # Run tests, compare against baselines
bun run test:update       # Regenerate baseline screenshots
```

### Server ownership and worktrees

The canonical `playwright.config.ts` starts Vite from the current checkout and waits for its HTTP URL. Vite starts and stops its MCP companion. Server reuse is off by default and always off in CI, so a test run cannot silently attach to another checkout on the default port.

Defaults are app port `1420` and MCP port `7600`. For concurrent worktrees, choose a free, distinct pair:

```sh
OPENPENCIL_TEST_PORT=1482 OPENPENCIL_TEST_MCP_PORT=7682 \
  bunx playwright test tests/e2e/settings --project=openpencil
```

The configuration passes the app origin and MCP port to Vite; the companion receives matching CORS configuration and a port-specific socket/discovery directory. Port conflicts fail rather than silently selecting another endpoint. Do not reuse ports across concurrent runs.

For intentional local debugging against an already-running matching server, set `OPENPENCIL_TEST_REUSE_SERVER=1`. Do not use reuse for baseline comparisons: HTTP readiness does not establish checkout identity. Start a matching custom-port preview with `OPENPENCIL_DEV_ORIGIN=http://localhost:1482 OPENPENCIL_DEV_MCP_PORT=7682 bun run dev --port 1482`. Portless remains the preferred interactive worktree preview workflow, separate from managed fixed-port tests.

### How It Works

1. Tests load the editor in a headless browser
2. The editor signals readiness via a `data-ready` HTML attribute
3. Tests create shapes via the editor's API
4. Screenshots are taken and compared against baselines using `toMatchSnapshot`
5. Page is reused across test cases for speed (~2s total)

### No-Chrome Test Mode

The editor supports a test mode that hides UI chrome (toolbar, panels) for clean screenshot capture. Activated via URL parameter.

## Figma CDP Reference Tests

A separate Playwright project connects to Figma via Chrome DevTools Protocol to capture reference screenshots for pixel-perfect comparison.

```sh
bun run figma:web:debug   # Launch Figma Web in Chrome with debugging port
bun run test:figma        # Connect to Figma Web, capture references
```

Requires the debug Chrome profile to be signed in to Figma with a
`figma.com/design/...` file open. The legacy `bun run figma:debug` desktop path
is kept for older Figma builds, but Figma Desktop 126.x no longer exposes a
usable CDP endpoint even when launched with `--remote-debugging-port=9222`.

## Unit Tests

Engine and package unit tests use bun:test. Use the quick suite during everyday development;
it excludes the maintained heavy-file list and disables suites marked as heavy:

```sh
bun run test:unit:quick
```

For full unit coverage, also run the heavy suite. You can select one group while diagnosing a
failure, or list the selected files without running them:

```sh
bun run test:unit:heavy
bun run test:unit:heavy fig
bun tools/unit-tests/src/list.ts all --heavy-only
```

The existing `bun run test:unit` command remains available as the combined entry point. It
includes heavy tests, but does not use the new per-file heavy runner.

### Heavy Test Setup and Limits

Heavy tests parse real `.fig` fixtures, export documents, render with CanvasKit and invoke the
CLI. Fetch Git LFS assets and build workspace packages first:

```sh
git lfs pull
bun run build:packages
```

Install FFmpeg, including `ffprobe`, for motion-export tests. GIF inspection requires `ffprobe`
even when GIF encoding uses the built-in encoder. WebM and MP4 checks run only when FFmpeg
reports the corresponding codecs. Fonts used by this suite are bundled with the repository;
no separate browser or system-font installation is required.

```sh
ffmpeg -version
ffprobe -version
```

The heavy runner processes files sequentially in separate Bun processes and does not enable
test concurrency. It prints each file's elapsed time and exit code, and stops at the first
failure while preserving that exit code. A group without heavy files reports that fact and
does not launch tests.

Each child receives a default test timeout of 180 seconds. Explicit test, hook or suite timeouts
still apply, including the existing 30- and 60-second limits. Separately, each file has a
600-second wall-clock deadline that also bounds synchronous work Bun's test timer cannot
interrupt. A file deadline reports exit code 124.

The **Heavy tests** GitHub Actions workflow runs every Monday at **03:17 UTC**, or **11:17 Beijing
time on Monday**. Both scheduled and manual runs check out and test `lowcode-rebaseline`, regardless
of the branch selected for the workflow definition. Its manual **Run workflow** form allows a test
group to be selected; scheduled runs use `all`. The workflow definition must also be present on the
repository's default branch for scheduled runs to trigger. CI fetches LFS assets, installs FFmpeg
and builds workspace packages. The entire job has a separate **30-minute** limit, including setup
and builds, so it can end before every file has used its individual budget.

Tests cover:

- Scene graph CRUD operations, parent-child relationships, z-ordering, hit testing
- Public package contracts under `packages/*/tests/`, including the deterministic Motion kernel, low-code validation, and portable plugin trust/runtime schemas
- **Fig-import pipeline** — node type mapping, transforms, fills/strokes/effects, gradients, images, arcs, nested hierarchies (`tests/engine/io/fig/import/legacy/*.test.ts`)
- **Layout computation** — Yoga auto-layout: direction, gap, padding, justify, align, child sizing (fixed/fill/hug), cross-axis sizing, wrap, nested layouts (`tests/engine/layout/`)

### Writing Unit Tests

```typescript
import { describe, expect, it } from 'bun:test'
import { SceneGraph } from '@open-pencil/scene-graph'

describe('SceneGraph', () => {
  it('creates and retrieves a node', () => {
    const sg = new SceneGraph()
    const node = sg.createNode('RECTANGLE', sg.root, { name: 'Test' })
    expect(sg.getNode(node.guid)).toBeDefined()
  })
})
```

## E2E Test Coverage

| Test file                        | Scope                                                           |
| -------------------------------- | --------------------------------------------------------------- |
| `tests/e2e/layers-panel.spec.ts` | Layers panel tree structure, visibility toggles, selection sync |
| `tests/e2e/visual.spec.ts`       | Visual regression screenshots for shapes and rendering          |

## Test Helpers

| File                      | Purpose                                |
| ------------------------- | -------------------------------------- |
| `tests/helpers/canvas.ts` | Canvas setup and interaction utilities |
| `tests/helpers/figma.ts`  | Figma CDP connection helpers           |

## Performance Targets

| Metric                | Target                                                                   |
| --------------------- | ------------------------------------------------------------------------ |
| E2E suite total       | < 3s                                                                     |
| Unit tests            | Track quick and heavy durations separately; no fixed whole-suite target. |
| Screenshot comparison | toMatchSnapshot (pixel-level)                                            |
