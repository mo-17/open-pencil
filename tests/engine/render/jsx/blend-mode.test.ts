import { describe, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/core'
import { collectTailwindClasses } from '@open-pencil/core/io/formats/jsx'

describe('jsx — blend mode classes', () => {
  function rectangleWithBlend(blendMode: SceneNode['blendMode']): {
    graph: SceneGraph
    node: SceneNode
  } {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const rect = graph.createNode('RECTANGLE', page.id, {
      name: 'Blend',
      width: 100,
      height: 100,
      blendMode
    })
    const node = graph.getNode(rect.id)
    if (!node) throw new Error('node missing')
    return { graph, node }
  }

  test('node blendMode emits a CSS mix-blend utility', () => {
    const { graph, node } = rectangleWithBlend('MULTIPLY')

    expect(collectTailwindClasses(node, graph)).toContain('mix-blend-multiply')
  })

  test('pass-through and normal blend modes do not add a mix-blend class', () => {
    for (const mode of ['PASS_THROUGH', 'NORMAL'] as const) {
      const { graph, node } = rectangleWithBlend(mode)

      expect(collectTailwindClasses(node, graph).some((c) => c.startsWith('mix-blend-'))).toBe(
        false
      )
    }
  })
})
