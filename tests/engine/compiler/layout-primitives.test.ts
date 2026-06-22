import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 4 §26 — layout primitives. Nodes can carry
 * `interactiveProps.layout` to emit sticky/fixed positioning, offsets,
 * overflow, and z-index as Tailwind utilities. Pure emit: no scene-graph/codec
 * changes and no runtime dependency.
 */
describe('compile — layout primitives (Phase 4 §26)', () => {
  function compileLayout(interactiveProps: Record<string, unknown>) {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, {
      name: 'Nav',
      width: 320,
      height: 64,
      interactiveProps
    })
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'layout-primitives' })
    })
    return {
      app: out.files.get('src/App.tsx') as string,
      css: out.files.get('src/index.css') as string
    }
  }

  test('fixed position emits position + offsets + z-index', () => {
    const { app } = compileLayout({
      layout: { position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50 }
    })
    expect(app).toContain('fixed')
    expect(app).toContain('top-[0px]')
    expect(app).toContain('left-[0px]')
    expect(app).toContain('right-[0px]')
    expect(app).toContain('z-[50]')
  })

  test('sticky position and overflow utilities emit from nested layout config', () => {
    const { app } = compileLayout({
      layout: { position: 'sticky', top: '1rem', overflow: 'auto', overflowY: 'scroll' }
    })
    expect(app).toContain('sticky')
    expect(app).toContain('top-[1rem]')
    expect(app).toContain('overflow-auto')
    expect(app).toContain('overflow-y-scroll')
  })

  test('direct legacy keys are supported', () => {
    const { app } = compileLayout({ position: 'sticky', top: '0', overflow: 'hidden' })
    expect(app).toContain('sticky')
    expect(app).toContain('top-[0px]')
    expect(app).toContain('overflow-hidden')
  })

  test('invalid primitive values are ignored', () => {
    const { app } = compileLayout({
      layout: { position: 'absolute', top: 'calc(100% - 1rem)', overflow: 'clip', zIndex: 'top' }
    })
    expect(app).not.toContain('sticky')
    expect(app).not.toContain('fixed inset')
    expect(app).not.toContain('calc(100%')
    expect(app).not.toContain('overflow-clip')
    expect(app).not.toContain('z-[top]')
  })

  test('layout primitive classes are seeded into Tailwind safelist', () => {
    const { css } = compileLayout({
      layout: { position: 'fixed', top: 0, overflow: 'auto', zIndex: 50 }
    })
    expect(css).toContain('fixed')
    expect(css).toContain('top-[0px]')
    expect(css).toContain('overflow-auto')
    expect(css).toContain('z-[50]')
  })

  test('no layout primitive config emits no primitive utilities', () => {
    const { app } = compileLayout({})
    expect(app).not.toContain('sticky')
    expect(app).not.toContain('z-[')
  })
})
