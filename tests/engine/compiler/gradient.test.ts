import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 4 §24.2 — a gradient fill compiles to a `bg-[linear-gradient(...)]`
 * arbitrary-value class on the node AND is seeded into the Tailwind safelist
 * (the VFS-served iframe scans no disk, so an arbitrary value must be in
 * `index.css`'s `@source inline(...)` to survive). Emitted by core
 * `collectTailwindClasses`, which the compiler's `tailwindClassName` delegates to.
 */
describe('compile — gradient fills (Phase 4 §24.2)', () => {
  function compileGradient(): { app: string; css: string } {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RECTANGLE', pageId, {
      name: 'G',
      width: 200,
      height: 100,
      fills: [
        {
          type: 'GRADIENT_LINEAR',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          gradientStops: [
            { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
            { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 }
          ],
          gradientTransform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 }
        }
      ]
    })
    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'g' }) })
    return {
      app: out.files.get('src/App.tsx') as string,
      css: out.files.get('src/index.css') as string
    }
  }

  test('gradient node compiles to the arbitrary-value class', () => {
    expect(compileGradient().app).toContain(
      'bg-[linear-gradient(180deg,_#FF0000_0%,_#0000FF_100%)]'
    )
  })

  test('the gradient class is seeded into the Tailwind safelist (index.css)', () => {
    expect(compileGradient().css).toContain('linear-gradient(180deg,_#FF0000_0%,_#0000FF_100%)')
  })

  test('a node without a gradient fill emits no gradient class', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RECTANGLE', pageId, {
      name: 'Solid',
      width: 100,
      height: 100,
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    })
    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'g' }) })
    expect(out.files.get('src/App.tsx') as string).not.toContain('linear-gradient')
  })
})
