import { describe, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/core'
import { collectStateTailwindClasses } from '@open-pencil/core/io/formats/jsx'

/**
 * Phase 4 §20 — `collectStateTailwindClasses` derives interaction-state-prefixed
 * Tailwind classes (`hover:` / `focus:` / `active:` / `disabled:`) from a node's
 * `stateOverrides`, re-deriving the CSS style for the overridden node and
 * diffing it against the base at the property level (the same machinery as
 * `collectResponsiveTailwindClasses`, so a "back to default" change like
 * restoring full opacity still emits an explicit reset utility).
 */
describe('collectStateTailwindClasses (Phase 4 §20)', () => {
  const RED = {
    type: 'SOLID' as const,
    color: { r: 1, g: 0, b: 0, a: 1 },
    opacity: 1,
    visible: true
  }
  const SHADOW = {
    type: 'DROP_SHADOW' as const,
    color: { r: 0, g: 0, b: 0, a: 0.25 },
    offset: { x: 0, y: 2 },
    radius: 4,
    spread: 0,
    visible: true
  }

  function styledNode(graph: SceneGraph, props: Partial<SceneNode>): SceneNode {
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      name: 'Card',
      width: 200,
      height: 80,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
      ...props
    })
    const node = graph.getNode(frame.id)
    if (!node) throw new Error('frame missing')
    return node
  }

  test('no overrides → empty', () => {
    const graph = new SceneGraph()
    const node = styledNode(graph, {})
    expect(collectStateTailwindClasses(node, graph)).toEqual([])
  })

  test('hover background change emits a `hover:bg-…` utility', () => {
    const graph = new SceneGraph()
    const node = styledNode(graph, { stateOverrides: { hover: { fills: [RED] } } })
    const out = collectStateTailwindClasses(node, graph)
    expect(out).toContain('hover:bg-[#FF0000]')
  })

  test('disabled opacity emits `disabled:opacity-50`', () => {
    const graph = new SceneGraph()
    const node = styledNode(graph, { stateOverrides: { disabled: { opacity: 0.5 } } })
    expect(collectStateTailwindClasses(node, graph)).toContain('disabled:opacity-50')
  })

  test('focus adds a border → `focus:border-…` utilities', () => {
    const graph = new SceneGraph()
    const node = styledNode(graph, {
      strokes: [],
      stateOverrides: {
        focus: {
          strokes: [
            {
              color: { r: 1, g: 0, b: 0, a: 1 },
              weight: 2,
              opacity: 1,
              visible: true,
              align: 'INSIDE' as const
            }
          ]
        }
      }
    })
    const out = collectStateTailwindClasses(node, graph)
    expect(out.some((c) => c.startsWith('focus:border-'))).toBe(true)
  })

  test('hover adds a shadow → `hover:shadow-…` utility', () => {
    const graph = new SceneGraph()
    const node = styledNode(graph, {
      effects: [],
      stateOverrides: { hover: { effects: [SHADOW] } }
    })
    expect(
      collectStateTailwindClasses(node, graph).some((c) => c.startsWith('hover:shadow-'))
    ).toBe(true)
  })

  test('clearing a base prop re-asserts its default (base opacity 0.5 → hover opacity 1 → `hover:opacity-100`)', () => {
    const graph = new SceneGraph()
    const node = styledNode(graph, { opacity: 0.5, stateOverrides: { hover: { opacity: 1 } } })
    expect(collectStateTailwindClasses(node, graph)).toContain('hover:opacity-100')
  })

  test('unchanged props are not re-emitted (a fills-only override emits no border/opacity class)', () => {
    const graph = new SceneGraph()
    const node = styledNode(graph, { stateOverrides: { hover: { fills: [RED] } } })
    const out = collectStateTailwindClasses(node, graph)
    expect(out.some((c) => c.startsWith('hover:border-'))).toBe(false)
    expect(out.some((c) => c.startsWith('hover:opacity-'))).toBe(false)
  })

  test('multiple states emit independently', () => {
    const graph = new SceneGraph()
    const node = styledNode(graph, {
      stateOverrides: {
        hover: { fills: [RED] },
        active: { opacity: 0.75 }
      }
    })
    const out = collectStateTailwindClasses(node, graph)
    expect(out).toContain('hover:bg-[#FF0000]')
    expect(out).toContain('active:opacity-75')
  })
})
