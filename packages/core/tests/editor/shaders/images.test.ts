import { expect, test } from 'bun:test'

import {
  computeImageHash,
  createShaderPaint,
  SceneGraph,
  withShaderPaints
} from '@open-pencil/scene-graph'

import { createEditor } from '#core/editor'
import { shaderFrameTarget } from '#core/editor/shaders/images'

function fixture(canonical = true) {
  const graph = new SceneGraph()
  const saved = new Uint8Array([1, 2, 3])
  const created = createShaderPaint({ components: [{ type: 'Aurora' }] })
  const image = canonical ? computeImageHash(saved) : created.shader.image
  const shader = { ...created.shader, image }
  const paint = { ...created.paint, imageHash: image }
  const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
    width: 40,
    height: 20,
    fills: [paint],
    strokes: [{ ...paint, weight: 3, align: 'CENTER' }],
    pluginData: withShaderPaints({ pluginData: [] }, [paint], [shader])
  })
  graph.images.set(image, saved)
  return { graph, node, shader, saved }
}

test('canonical frame targets preserve source bytes and stroke geometry', () => {
  const { graph, node, shader, saved } = fixture()
  const target = shaderFrameTarget(graph, node, shader)
  expect(target.shader.image).not.toBe(shader.image)
  expect(target.node.fills[0].imageHash).toBe(target.shader.image)
  expect(target.node.strokes[0]).toMatchObject({
    imageHash: target.shader.image,
    weight: 3,
    align: 'CENTER'
  })
  expect(node.fills[0].imageHash).toBe(shader.image)
  expect(graph.images.get(shader.image)).toBe(saved)
})

test('mutable frame names are reused between redraws', () => {
  const { graph, node, shader } = fixture(false)
  const target = shaderFrameTarget(graph, node, shader)
  expect(target.node).toBe(node)
  expect(target.shader).toBe(shader)
})

test('failed redraws retain the canonical paint and saved bytes', async () => {
  const { graph, node, shader, saved } = fixture()
  const editor = createEditor({ graph, shaderRasterizer: { render: async () => null } })
  try {
    editor.setShaderPaint([node.id], 'fills', 0, { components: [{ type: 'Swirl' }] })
    await editor.settleShaderFrames()
    expect(node.fills[0].imageHash).toBe(shader.image)
    expect(graph.images.get(shader.image)).toBe(saved)
    expect(editor.getShaderFrameStatus(node.id, shader.image)).toMatchObject({
      phase: 'saved',
      reason: 'failed'
    })
  } finally {
    editor.dispose()
  }
})
