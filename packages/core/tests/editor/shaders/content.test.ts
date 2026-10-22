import { afterAll, afterEach, describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import {
  SceneGraph,
  contentShader,
  shaderContentKey,
  shaderContentNode,
  supportsShaderContent
} from '@open-pencil/scene-graph'

import { SkiaRenderer } from '#core/canvas'
import { createEditor, type Editor } from '#core/editor'
import { renderShaderContent } from '#core/editor/shaders/content'
import { initCanvasKit } from '#core/io'

const ck = await initCanvasKit()
const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(1, 1)))
await renderer.loadFonts()
afterAll(() => renderer.destroy())
const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
})

function setup() {
  const graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    width: 40,
    height: 40,
    fills: [],
    clipsContent: true
  })
  const child = graph.createNode('RECTANGLE', node.id, {
    width: 40,
    height: 40,
    fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
  })
  const editor = createEditor({ graph })
  editors.push(editor)
  editor.setCanvasKit(ck, renderer)
  return { graph, node, child, editor }
}

describe('node-local Shader content', () => {
  test('selection eligibility rejects overlapping roots and status exposes newly dynamic content', () => {
    const { graph, node, child, editor } = setup()
    expect(editor.canSetContentShader([node.id])).toBe(true)
    expect(editor.canSetContentShader([node.id, child.id])).toBe(false)
    expect(editor.canSetContentShader([])).toBe(false)
    expect(() => editor.setContentShader([])).not.toThrow()
    editor.setContentShader([node.id])
    const image = expectDefined(contentShader(graph, node)).shader.image
    graph.images.set(image, new Uint8Array([7]))
    graph.updateNode(child.id, { type: 'INPUT' })
    expect(editor.canSetContentShader([node.id])).toBe(false)
    expect(editor.getShaderFrameStatus(node.id, image)).toEqual({
      phase: 'unsupported',
      hasSavedFrame: true,
      canRetry: false
    })
    const projected = shaderContentNode(graph, node)
    expect(projected.fills.some((paint) => paint.imageHash === image)).toBe(false)
    expect(projected.childIds).toEqual([child.id])
    expect(graph.getNode(child.id)?.type).toBe('INPUT')
    expect(node.childIds).toEqual([child.id])
  })

  test('copied subtrees keep independent output images when their content diverges', async () => {
    const { graph, node, child, editor } = setup()
    let frames = 0
    editor.setShaderRasterizer({ render: async () => new Uint8Array([++frames]) })
    editor.setContentShader([node.id])
    await editor.settleShaderFrames({ nodeIds: [node.id], requireFrames: true })
    const originalImage = expectDefined(contentShader(graph, node)).shader.image
    const copy = expectDefined(graph.cloneTree(node.id, graph.getPages()[0].id))
    graph.updateNode(copy.childIds[0], { width: 20 })
    await editor.settleShaderFrames({ nodeIds: [copy.id], requireFrames: true })
    const copiedImage = expectDefined(contentShader(graph, copy)).shader.image
    expect(copiedImage).not.toBe(originalImage)
    expect(graph.images.get(originalImage)).toEqual(new Uint8Array([1]))
    expect(graph.images.get(copiedImage)).toEqual(new Uint8Array([2]))
    graph.updateNode(child.id, { width: 10 })
    await editor.settleShaderFrames({ nodeIds: [node.id], requireFrames: true })
    expect(graph.images.get(copiedImage)).toEqual(new Uint8Array([2]))
    expect(graph.images.get(originalImage)).toEqual(new Uint8Array([3]))
  })

  test('captures original pixels, excluding even a saved content frame', () => {
    const { graph, node, editor } = setup()
    editor.setContentShader([node.id])
    const shader = expectDefined(contentShader(graph, node)).shader
    const before = expectDefined(renderShaderContent(graph, node, renderer))
    graph.images.set(shader.image, new Uint8Array([9, 9, 9]))
    const after = renderShaderContent(graph, node, renderer)
    expect(after).toEqual(before)
    expect(shaderContentNode(graph, node).childIds).toEqual([])
    expect(node.childIds).toHaveLength(1)
    const image = expectDefined(ck.MakeImageFromEncoded(before))
    expect(image.width()).toBe(80)
    image.delete()
  })

  test('content, visibility, hierarchy and image bytes invalidate the key; frame metadata does not', async () => {
    const { graph, node, child, editor } = setup()
    editor.setContentShader([node.id])
    const key = shaderContentKey(graph, node)
    graph.updateNode(child.id, { visible: false })
    expect(shaderContentKey(graph, node)).not.toBe(key)
    graph.updateNode(child.id, { visible: true })
    expect(shaderContentKey(graph, node)).toBe(key)
    const inputs: Uint8Array[] = []
    editor.setShaderRasterizer({
      render: (_preset, _size, options) => {
        inputs.push(expectDefined(options?.input))
        return Promise.resolve(new Uint8Array([inputs.length]))
      }
    })
    await editor.settleShaderFrames({ nodeIds: [node.id] })
    expect(shaderContentKey(graph, node)).toBe(key)
    await editor.settleShaderFrames({ nodeIds: [node.id] })
    expect(inputs).toHaveLength(1)
    graph.updateNode(child.id, { width: 20 })
    await editor.settleShaderFrames({ nodeIds: [node.id] })
    expect(inputs).toHaveLength(2)
    expect(inputs[0]).not.toEqual(inputs[1])
    editor.undoAction()
    expect(contentShader(graph, node)).toBeNull()
    editor.redoAction()
    expect(contentShader(graph, node)).not.toBeNull()
  })

  test('never flattens controls, bindings or generated/Motion runtime layers', () => {
    const { graph, node, child, editor } = setup()
    graph.updateNode(child.id, { type: 'INPUT' })
    expect(supportsShaderContent(graph, node)).toBe(false)
    expect(() => editor.setContentShader([node.id])).toThrow('static images')
    graph.updateNode(child.id, {
      type: 'TEXT',
      bindings: { text: { kind: 'literal', literalValue: 'x' } }
    })
    expect(supportsShaderContent(graph, node)).toBe(false)
    expect(shaderContentNode(graph, node)).toBe(node)
    graph.updateNode(child.id, {
      bindings: {},
      interactiveProps: {},
      motion: { version: 1, tracks: [] }
    })
    expect(supportsShaderContent(graph, node)).toBe(false)
    const animated = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
      motion: { version: 1, tracks: [] }
    })
    expect(supportsShaderContent(graph, animated)).toBe(false)
  })

  test('caps large input textures, and keeps the authored transform and opacity outside capture', () => {
    const { graph, node, editor } = setup()
    graph.updateNode(node.id, { width: 4000, height: 2000, rotation: 70, opacity: 0.4 })
    editor.setContentShader([node.id])
    const bytes = expectDefined(renderShaderContent(graph, node, renderer))
    const image = expectDefined(ck.MakeImageFromEncoded(bytes))
    expect([image.width(), image.height()]).toEqual([1024, 512])
    image.delete()
    expect(node.rotation).toBe(70)
    expect(node.opacity).toBe(0.4)
  })
})
