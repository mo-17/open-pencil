import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §7 — responsive breakpoints. A node's `responsiveOverrides` flow
 * through the compiler as breakpoint-prefixed Tailwind classes appended to the
 * emitted `className`, so the generated React app reflows by viewport with zero
 * runtime / zero new dependency.
 */
describe('compile — responsive breakpoints (Phase 3 §7)', () => {
  test('a VERTICAL stack with an md HORIZONTAL override emits `flex-col` + `md:flex-row`', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const stack = graph.createNode('FRAME', pageId, {
      name: 'Stack',
      width: 400,
      height: 200,
      layoutMode: 'VERTICAL',
      itemSpacing: 8,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    graph.updateNode(stack.id, {
      responsiveOverrides: { md: { layoutMode: 'HORIZONTAL', itemSpacing: 24 } }
    })
    graph.createNode('BUTTON', stack.id, { interactiveProps: { text: 'A' } })
    graph.createNode('BUTTON', stack.id, { interactiveProps: { text: 'B' } })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'responsive-stack' })
    })
    const app = out.files.get('src/App.tsx') as string
    // The auto-layout div carries the base direction + the breakpoint diff.
    const stackDiv = (app.match(/<div className="[^"]*flex-col[^"]*"/) ?? [])[0] ?? ''
    expect(stackDiv).toContain('flex-col')
    expect(stackDiv).toContain('md:flex-row')
    expect(stackDiv).toContain('md:gap-6')
  })

  test('visible:false at lg emits `lg:hidden`', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const banner = graph.createNode('FRAME', pageId, {
      name: 'Banner',
      width: 400,
      height: 60,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    graph.updateNode(banner.id, { responsiveOverrides: { lg: { visible: false } } })
    graph.createNode('BUTTON', banner.id, { interactiveProps: { text: 'X' } })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'responsive-hide' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toMatch(/<div className="[^"]*\blg:hidden\b[^"]*"/)
  })

  test('no overrides → no breakpoint-prefixed classes in the output (regression)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const stack = graph.createNode('FRAME', pageId, {
      name: 'Plain',
      width: 400,
      height: 200,
      layoutMode: 'VERTICAL',
      itemSpacing: 8,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    graph.createNode('BUTTON', stack.id, { interactiveProps: { text: 'A' } })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'no-responsive' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toMatch(/\b(sm|md|lg|xl):/)
  })
})
