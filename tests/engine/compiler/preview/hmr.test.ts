import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import { SceneGraph } from '@open-pencil/core'

/**
 * Phase 1 §10 regression coverage. Two latent bugs the §10 work hit:
 *
 *  1. Vite's CSS HMR appends `?t=<ts>` to the stylesheet URL on every
 *     `css-update` (and on the initial `import './index.css'` re-fetch from
 *     `main.tsx`). If the VFS `resolveId` / `load` doesn't strip that suffix
 *     it returns 404, Tailwind never re-emits, and the iframe freezes at
 *     first-paint CSS.
 *
 *  2. The compiled CSS output must reflect the *latest* `updateFiles`
 *     payload — not a cached transform from the first compile. Tailwind's
 *     `@source inline(...)` parsing relies on `requiresBuild()` returning
 *     true for VFS files (no mtime), and on `state.files` being swapped
 *     before any subsequent CSS request.
 *
 * Both bugs let the iframe render with stale styles even though the server
 * looked healthy. These tests prove resolveId+load and the
 * compile/updateFiles round-trip serve fresh content end-to-end.
 */

function buildFiles(x: number, y: number, w: number, h: number) {
  const g = new SceneGraph()
  g.addPage('Test')
  const pageId = g.getPages()[0].id
  g.createNode('BUTTON', pageId, {
    x,
    y,
    width: w,
    height: h,
    interactiveProps: { text: 'Go' }
  })
  return compile({ graph: g, pageIds: [pageId], options: withDefaults({ packageName: 'demo' }) })
    .files
}

async function fetchCSS(server: PreviewServer, withQuery: boolean): Promise<string> {
  const url = `${server.url}src/index.css${withQuery ? `?t=${Date.now()}` : ''}`
  const res = await fetch(url)
  if (res.status !== 200) throw new Error(`GET ${url} → ${res.status}`)
  const body = await res.text()
  // CSS files are served as JS modules in Vite dev mode; the actual CSS
  // string lives inside `const __vite__css = "..."`.
  const m = body.match(/const __vite__css = "((?:[^"\\]|\\.)*)"/)
  if (!m) throw new Error('no __vite__css in module body')
  return JSON.parse('"' + m[1] + '"')
}

describe('preview dev-server HMR round-trip (Phase 1 §10)', () => {
  let server: PreviewServer | null = null

  beforeEach(async () => {
    server = await createPreviewServer({})
  })

  afterEach(async () => {
    if (server) await server.close()
    server = null
  })

  test('serves index.css with `?t=` cache-bust query (200, not 404)', async () => {
    if (!server) throw new Error('no server')
    server.updateFiles(buildFiles(120, 80, 100, 40))

    const url = `${server.url}src/index.css?t=${Date.now()}`
    const res = await fetch(url)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('__vite__updateStyle')
  }, 15_000)

  test('re-fetched CSS reflects the latest updateFiles payload', async () => {
    if (!server) throw new Error('no server')

    // Initial: BUTTON at (120, 80) size 100×40 → top-20 left-30 w-25 h-10
    // (twirlwind maps 4-px multiples to clean Tailwind classes).
    server.updateFiles(buildFiles(120, 80, 100, 40))
    const first = await fetchCSS(server, false)
    expect(first).toMatch(/\.top-20\s*\{/)
    expect(first).toMatch(/\.left-30\s*\{/)

    // Move + resize to non-multiples → bracket notation for top/left/w.
    // New classes must appear, stale must disappear.
    server.updateFiles(buildFiles(111, 183, 125, 48))
    const second = await fetchCSS(server, true) // cache-busted
    expect(second).toMatch(/\.top-\\\[183px\\\]\s*\{/)
    expect(second).toMatch(/\.left-\\\[111px\\\]\s*\{/)
    expect(second).toMatch(/\.w-\\\[125px\\\]\s*\{/)
    expect(second).not.toMatch(/\.top-20\s*\{/)
    expect(second).not.toMatch(/\.left-30\s*\{/)
  }, 15_000)

  test('the page wrapper utilities (`relative`, `min-h-screen`) survive HMR', async () => {
    if (!server) throw new Error('no server')
    server.updateFiles(buildFiles(0, 0, 100, 40))
    server.updateFiles(buildFiles(50, 50, 100, 40))
    const css = await fetchCSS(server, true)
    expect(css).toMatch(/\.relative\s*\{/)
    expect(css).toMatch(/\.min-h-screen\s*\{/)
  }, 15_000)
})
