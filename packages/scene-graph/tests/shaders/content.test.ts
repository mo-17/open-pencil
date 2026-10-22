import { describe, expect, test } from 'bun:test'

import * as v from 'valibot'

import {
  shaderPaintSchema,
  createShaderPaint,
  SceneGraph,
  shaderContentKey,
  withShaderPaints
} from '@open-pencil/scene-graph'

describe('Shader content data compatibility', () => {
  test('old saved paint entries omit input and keep their original preset', () => {
    const old = {
      image: 'saved',
      preset: { components: [{ type: 'Aurora' }] },
      frame: { width: 40, height: 20, preset: 'old' }
    }
    const result = v.safeParse(shaderPaintSchema, old)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.output.input).toBeUndefined()
      expect(result.output.preset).toEqual(old.preset)
    }
    expect(
      v.safeParse(shaderPaintSchema, { ...old, input: { kind: 'self', version: 1, canvas: {} } })
        .success
    ).toBe(false)
  })

  test('image bytes, text and child order affect content signatures', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('FRAME', graph.getPages()[0].id)
    const image = graph.createNode('RECTANGLE', node.id, {
      fills: [
        {
          type: 'IMAGE',
          imageHash: 'image',
          color: { r: 0, g: 0, b: 0, a: 0 },
          visible: true,
          opacity: 1
        }
      ]
    })
    const text = graph.createNode('TEXT', node.id, { text: 'one' })
    const { shader, paint } = createShaderPaint({ components: [{ type: 'Pixelate' }] })
    graph.updateNode(node.id, {
      fills: [paint],
      pluginData: withShaderPaints(
        node,
        [paint],
        [{ ...shader, input: { kind: 'self', version: 1 } }]
      )
    })
    const initial = shaderContentKey(graph, node)
    graph.images.set('image', new Uint8Array([1]))
    const loaded = shaderContentKey(graph, node)
    expect(loaded).not.toBe(initial)
    graph.images.set('image', new Uint8Array([2]))
    expect(shaderContentKey(graph, node)).not.toBe(loaded)
    graph.updateNode(text.id, { text: 'two' })
    const changed = shaderContentKey(graph, node)
    graph.reorderChild(image.id, node.id, 2)
    expect(shaderContentKey(graph, node)).not.toBe(changed)
  })
})
