import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createEditor } from '@open-pencil/core/editor'
import { IORegistry, BUILTIN_IO_FORMATS, exportFigFile, parseFigFile } from '@open-pencil/core/io'
import { layerComponents, layerMarkup } from '@open-pencil/dom-css/export'
import { SceneGraph, readShaderPaints, withShaderPaints } from '@open-pencil/scene-graph'

function fixture() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const node = graph.createNode('FRAME', page.id, {
    name: 'Decoration',
    width: 100,
    height: 80,
    fills: []
  })
  graph.createNode('TEXT', node.id, { text: 'Original editable text', width: 90, height: 30 })
  const editor = createEditor({ graph })
  editor.setContentShader([node.id])
  const shader = readShaderPaints(node)[0]
  // A saved image is sufficient in this contract test; real GPU pixels have separate browser coverage.
  graph.images.set(shader.image, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  return { graph, page, node, editor }
}

describe('static Shader content across export owners', () => {
  test('HTML, ordinary React and Vue components use an image without a host Shader dependency', async () => {
    const { graph, node, editor } = fixture()
    const html = await layerMarkup(graph, [node.id])
    expect(html.html).toContain('<img')
    expect(html.html).not.toContain('Original editable text')
    for (const target of ['react', 'vue'] as const) {
      const files = (await layerComponents(graph, [node.id], target)).flatMap(
        (component) => component.files
      )
      const code = files
        .filter((file) => typeof file.content === 'string')
        .map((file) => file.content)
        .join('\n')
      expect(code).toContain('<img')
      expect(code).not.toContain('Original editable text')
      expect(code).not.toContain('shaders/')
    }
    expect(graph.getChildren(node.id)[0].text).toBe('Original editable text')
    editor.dispose()
  })

  test('unsupported edits restore authored procedural fills in ordinary components', async () => {
    const { graph, node, editor } = fixture()
    const fills = [
      { type: 'SOLID' as const, color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true },
      ...node.fills
    ]
    graph.updateNode(node.id, { fills, pluginData: withShaderPaints(node, fills) })
    editor.setShaderPaint([node.id], 'fills', 0, { components: [{ type: 'Aurora' }] })
    for (const target of ['react', 'vue'] as const) {
      const before = await layerComponents(graph, [node.id], target)
      expect(JSON.stringify(before)).not.toContain('shaders/')
    }
    graph.createNode('INPUT', node.id, { width: 80, height: 30 })
    for (const target of ['react', 'vue'] as const) {
      const after = await layerComponents(graph, [node.id], target)
      const source = JSON.stringify(after)
      expect(source).toContain('shaders/')
      expect(source).toContain('Aurora')
      expect(source).toContain('decoration__input')
      expect(source).toContain('Original editable text')
    }
    editor.dispose()
  })

  test('Lowcode React and Vue retain controls and bound data beside a static Shader decoration', () => {
    const { graph, page, editor } = fixture()
    graph.updateNode(page.id, {
      state: [{ id: 'value', name: 'value', type: 'string', defaultValue: 'hello' }]
    })
    graph.createNode('BUTTON', page.id, {
      name: 'Action',
      width: 80,
      height: 30,
      interactiveProps: { text: 'Action' }
    })
    graph.createNode('INPUT', page.id, {
      name: 'Input',
      width: 100,
      height: 30,
      bindings: { value: { kind: 'ref', stateId: 'value' } }
    })
    graph.createNode('SELECT', page.id, {
      name: 'Select',
      width: 100,
      height: 30,
      interactiveProps: { options: [{ label: 'One', value: 'one' }] }
    })
    for (const target of ['react', 'vue'] as const) {
      const result = compile({
        graph,
        pageIds: [page.id],
        options: withDefaults({ packageName: 'shader-test', target })
      })
      const code = [...result.files.values()]
        .filter((value) => typeof value === 'string')
        .join('\n')
      expect(result.files.size).toBeGreaterThan(0)
      expect(code).toContain('<button')
      expect(code).toContain('<input')
      expect(code).toContain('<select')
      expect(code).not.toContain('Original editable text')
      expect(code).not.toContain('shaders/')
      expect([...result.files.keys()].some((path) => path.endsWith('.png'))).toBe(true)
    }
    editor.dispose()
  })

  test('native document round trips preserve content input and editable children', async () => {
    const { graph, node, editor } = fixture()
    const fig = await exportFigFile(graph)
    const figGraph = await parseFigFile(new Uint8Array(fig).buffer)
    for (const restored of [figGraph]) {
      const layer = [...restored.getAllNodes()].find((candidate) => candidate.name === node.name)
      expect(layer).toBeDefined()
      if (!layer) throw new Error('Missing content layer')
      expect(readShaderPaints(layer)[0]?.input).toEqual({ kind: 'self', version: 1 })
      expect(restored.getChildren(layer.id)[0]?.text).toBe('Original editable text')
    }
    editor.dispose()
  })

  test('headless static export reports missing Shader frames instead of returning blank success', async () => {
    const { graph, page, editor } = fixture()
    graph.images.clear()
    const io = new IORegistry(BUILTIN_IO_FORMATS)
    await expect(
      io.exportContent('png', { graph, target: { scope: 'page', pageId: page.id } })
    ).rejects.toThrow('No usable saved Shader frame')
    expect(() => compile({ graph, pageIds: [page.id], options: withDefaults() })).toThrow(
      'No usable saved Shader frame'
    )
    editor.dispose()
  })
})
