import { describe, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/core'
import {
  collectResponsiveTailwindClasses,
  collectTailwindClasses
} from '@open-pencil/core/io/formats/jsx'

/**
 * Phase 3 §7 — `collectResponsiveTailwindClasses` derives breakpoint-prefixed
 * Tailwind classes from a node's `responsiveOverrides` by re-deriving the CSS
 * style for the overridden node and diffing it against the base at the
 * property level (so "back to default" changes like column→row still emit an
 * explicit reset utility, which a class-level diff would miss).
 */
describe('collectResponsiveTailwindClasses (Phase 3 §7)', () => {
  function autoLayoutFrame(graph: SceneGraph, overrides: SceneNode['responsiveOverrides']): SceneNode {
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      name: 'Stack',
      width: 400,
      height: 200,
      layoutMode: 'VERTICAL',
      itemSpacing: 8,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    graph.updateNode(frame.id, { responsiveOverrides: overrides })
    const node = graph.getNode(frame.id)
    if (!node) throw new Error('frame missing')
    return node
  }

  test('no overrides → empty', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, { layoutMode: 'VERTICAL', itemSpacing: 8 })
    expect(collectResponsiveTailwindClasses(graph.getNode(frame.id) as SceneNode, graph)).toEqual([])
  })

  test('column → row at md emits an explicit `md:flex-row` reset (class-diff would miss it)', () => {
    const graph = new SceneGraph()
    const node = autoLayoutFrame(graph, { md: { layoutMode: 'HORIZONTAL' } })
    // Base is VERTICAL → `flex-col`; HORIZONTAL drops the direction class, so
    // the reset must re-assert row explicitly.
    expect(collectTailwindClasses(node, graph)).toContain('flex-col')
    expect(collectResponsiveTailwindClasses(node, graph)).toContain('md:flex-row')
  })

  test('changed spacing / alignment emit prefixed utilities; unchanged props do not', () => {
    const graph = new SceneGraph()
    const node = autoLayoutFrame(graph, {
      md: { itemSpacing: 24, counterAxisAlign: 'CENTER' }
    })
    const out = collectResponsiveTailwindClasses(node, graph)
    expect(out).toContain('md:gap-6') // 24px → gap-6
    expect(out).toContain('md:items-center')
    // width/height unchanged at md → not re-emitted
    expect(out.some((c) => c.startsWith('md:w-'))).toBe(false)
    expect(out.some((c) => c.startsWith('md:h-'))).toBe(false)
  })

  test('itemSpacing → 0 at a breakpoint resets gap explicitly (`md:gap-0`)', () => {
    const graph = new SceneGraph()
    const node = autoLayoutFrame(graph, { md: { itemSpacing: 0 } })
    expect(collectResponsiveTailwindClasses(node, graph)).toContain('md:gap-0')
  })

  test('visible:false emits a breakpoint-prefixed hidden class', () => {
    const graph = new SceneGraph()
    const node = autoLayoutFrame(graph, { lg: { visible: false } })
    expect(collectResponsiveTailwindClasses(node, graph)).toContain('lg:hidden')
  })

  test('multiple breakpoints emit independently, in sm→md→lg→xl order', () => {
    const graph = new SceneGraph()
    const node = autoLayoutFrame(graph, {
      md: { layoutMode: 'HORIZONTAL' },
      xl: { itemSpacing: 40 }
    })
    const out = collectResponsiveTailwindClasses(node, graph)
    expect(out).toContain('md:flex-row')
    expect(out).toContain('xl:gap-10') // 40px → gap-10
    expect(out.findIndex((c) => c.startsWith('md:'))).toBeLessThan(
      out.findIndex((c) => c.startsWith('xl:'))
    )
  })

  test('FILL sizing override at md emits `md:w-full`', () => {
    const graph = new SceneGraph()
    const node = autoLayoutFrame(graph, { md: { primaryAxisSizing: 'FILL' } })
    // Base VERTICAL primary axis is height → FILL makes height 100%.
    expect(collectResponsiveTailwindClasses(node, graph)).toContain('md:h-full')
  })
})
