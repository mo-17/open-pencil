# Testing

## Overview

| Type                  | Framework  | Command              | Location        |
| --------------------- | ---------- | -------------------- | --------------- |
| E2E visual regression | Playwright | `bun run test`       | `tests/e2e/`    |
| Figma CDP reference   | Playwright | `bun run test:figma` | `tests/figma/`  |
| Unit tests            | bun:test   | `bun run test:unit`  | `tests/engine/`, `packages/*/tests/` |

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

Engine and package unit tests use bun:test and target < 50ms execution:

```sh
bun run test:unit
```

Tests cover:

- Scene graph CRUD operations, parent-child relationships, z-ordering, hit testing
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

| Metric                | Target                        |
| --------------------- | ----------------------------- |
| E2E suite total       | < 3s                          |
| Unit test suite total | < 50ms                        |
| Screenshot comparison | toMatchSnapshot (pixel-level) |
