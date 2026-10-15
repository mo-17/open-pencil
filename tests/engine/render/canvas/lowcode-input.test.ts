import { describe, expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph, type NodeType, type SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { initCanvasKit } from '#cli/headless'
import { controlDesignDependencies } from '#core/canvas/control-state'
import { lowcodeTextProjection, renderTextInputContent } from '#core/canvas/lowcode'
import { SkiaRenderer } from '#core/canvas/renderer'
import { renderShapeUncached } from '#core/canvas/scene'
import { fontManager } from '#core/text/fonts'
import { collectGraphFontRequirements } from '#core/text/requirements'
import { missingGlyphCharacters } from '#core/text/resolver'

import { expectRgbaPixels, asCanvas } from '#tests/engine/render/canvas/helpers'
import { expectDefined } from '#tests/helpers/assert'
import { repoPath } from '#tests/helpers/paths'

import { carouselPixelHarness } from './carousel/helpers'
import { createMockCanvas, createMockRenderer, mockCalls } from './effects/helpers'

type TextInputType = Extract<NodeType, 'INPUT' | 'TEXTAREA'>

function textInput(type: TextInputType, overrides: Partial<SceneNode> = {}): SceneNode {
  return createDefaultNode(() => `${type.toLowerCase()}-1`, type, {
    fontFamily: 'Inter',
    fontSize: 17,
    fontWeight: 500,
    letterSpacing: 0.25,
    ...overrides
  })
}

describe('lowcode INPUT and TEXTAREA canvas text', () => {
  test('projects an INPUT placeholder through the regular text model', () => {
    const source = textInput('INPUT', {
      width: 220,
      height: 44,
      paddingLeft: 16,
      paddingRight: 20,
      textAlignHorizontal: 'RIGHT',
      textAlignVertical: 'BOTTOM',
      interactiveProps: { placeholder: '请输入姓名', value: '' }
    })

    const projection = lowcodeTextProjection(source)

    expect(projection?.contentKind).toBe('input_placeholder')
    expect(projection?.node).toMatchObject({
      id: source.id,
      type: 'TEXT',
      text: '请输入姓名',
      width: 184,
      height: 44,
      fontFamily: 'Inter',
      fontSize: 17,
      fontWeight: 500,
      letterSpacing: 0.25,
      textAlignHorizontal: 'RIGHT',
      textAlignVertical: 'CENTER',
      textAutoResize: 'NONE',
      childIds: []
    })
    expect(source.type).toBe('INPUT')
    expect(source.textAlignVertical).toBe('BOTTOM')
  })

  test('prefers a TEXTAREA value and projects its padded content box', () => {
    const source = textInput('TEXTAREA', {
      width: 260,
      height: 120,
      paddingLeft: 12,
      paddingRight: 18,
      paddingTop: 10,
      paddingBottom: 14,
      textAlignVertical: 'BOTTOM',
      interactiveProps: {
        placeholder: 'Ignored placeholder',
        value: 'Actual\ncontent'
      }
    })

    const projection = lowcodeTextProjection(source)

    expect(projection?.contentKind).toBe('textarea_value')
    expect(projection?.node).toMatchObject({
      id: source.id,
      type: 'TEXT',
      text: 'Actual\ncontent',
      width: 230,
      height: 96,
      textAlignVertical: 'BOTTOM',
      textAutoResize: 'NONE',
      childIds: []
    })
    expect(source.type).toBe('TEXTAREA')
    expect(source.width).toBe(260)
    expect(source.height).toBe(120)
  })

  test('renders an INPUT placeholder after its surface with its authored local color', () => {
    const node = textInput('INPUT', {
      width: 220,
      height: 44,
      paddingLeft: 16,
      paddingRight: 20,
      interactiveProps: {
        placeholder: 'Email address',
        value: '',
        textColor: '#00FF00',
        placeholderColor: '#336699'
      }
    })
    const canvas = createMockCanvas()
    const callOrder: string[] = []
    const renderText = mock((_canvas: Canvas, textNode: SceneNode) => {
      callOrder.push(`text:${textNode.text}`)
    })
    const renderer = createMockRenderer({
      renderEffects: mock(
        (
          _canvas: Canvas,
          _node: SceneNode,
          _rect: Float32Array,
          _hasRadius: boolean,
          pass: 'behind' | 'front'
        ) => {
          callOrder.push(`effects:${pass}`)
        }
      ),
      drawNodeFill: mock(() => {
        callOrder.push('fill')
      }),
      renderText
    })

    renderShapeUncached(renderer, asCanvas(canvas), node, new SceneGraph())

    expect(callOrder).toEqual(['effects:behind', 'fill', 'effects:front', 'text:Email address'])
    expect(renderer.color4f).toHaveBeenCalledWith(0.2, 0.4, 0.6, 1)
    expect(canvas.translate).toHaveBeenCalledWith(16, 0)
    const rendered = mockCalls(renderText)[0]?.[1] as SceneNode
    expect(rendered).toMatchObject({
      type: 'TEXT',
      text: 'Email address',
      width: 184,
      height: 44,
      textAlignVertical: 'CENTER'
    })
  })

  test('renders a TEXTAREA value with textColor and both-axis padding', () => {
    const node = textInput('TEXTAREA', {
      width: 260,
      height: 120,
      paddingLeft: 14,
      paddingRight: 18,
      paddingTop: 11,
      paddingBottom: 13,
      interactiveProps: {
        placeholder: 'Notes',
        value: 'Saved note',
        textColor: '#00FF00',
        placeholderColor: '#FF0000'
      }
    })
    const canvas = createMockCanvas()
    const renderer = createMockRenderer()

    renderTextInputContent(renderer, asCanvas(canvas), node)

    expect(renderer.color4f).toHaveBeenCalledWith(0, 1, 0, 1)
    expect(canvas.translate).toHaveBeenCalledWith(14, 11)
    expect(renderer.renderText).toHaveBeenCalledTimes(1)
    const rendered = mockCalls(renderer.renderText as ReturnType<typeof mock>)[0]?.[1] as SceneNode
    expect(rendered).toMatchObject({
      type: 'TEXT',
      text: 'Saved note',
      width: 228,
      height: 96
    })
  })

  test('does not draw an empty control without a value or placeholder', () => {
    const node = textInput('INPUT', { interactiveProps: { value: '' } })
    const canvas = createMockCanvas()
    const renderer = createMockRenderer()

    renderTextInputContent(renderer, asCanvas(canvas), node)

    expect(renderer.renderText).not.toHaveBeenCalled()
    expect(canvas.save).not.toHaveBeenCalled()
    expect(renderer.color4f).not.toHaveBeenCalled()
  })

  test('draws the authored placeholder color through the real CanvasKit text path', async () => {
    const ck = await initCanvasKit()
    const fontProvider = ck.TypefaceFontProvider.Make()
    fontManager.attachProvider(ck, fontProvider)
    const interData = await Bun.file(
      repoPath('packages/core/assets/Inter-Regular.ttf')
    ).arrayBuffer()
    fontManager.markLoaded('Inter', 'Regular', interData)

    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const node = graph.createNode('INPUT', page.id, {
      width: 220,
      height: 44,
      paddingLeft: 16,
      paddingRight: 16,
      fontFamily: 'Inter',
      fontSize: 18,
      interactiveProps: {
        placeholder: 'Email address',
        value: '',
        placeholderColor: '#336699'
      },
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 1, b: 1, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    const surface = expectDefined(ck.MakeSurface(220, 44), 'CanvasKit surface')
    const renderer = new SkiaRenderer(ck, surface)
    renderer.fontsLoaded = true
    renderer.fontProvider = fontProvider

    try {
      const canvas = surface.getCanvas()
      canvas.clear(ck.WHITE)
      renderer.renderShape(canvas, node, graph)
      surface.flush()

      const image = surface.makeImageSnapshot()
      const pixels = expectRgbaPixels(
        image.readPixels(0, 0, {
          width: 220,
          height: 44,
          colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Unpremul,
          colorSpace: ck.ColorSpace.SRGB
        })
      )
      image.delete()

      let blueTextPixels = 0
      for (let y = 2; y < 42; y++) {
        for (let x = 2; x < 218; x++) {
          const offset = (y * 220 + x) * 4
          const red = pixels[offset]
          const green = pixels[offset + 1]
          const blue = pixels[offset + 2]
          if (blue > green + 8 && green > red + 8) blueTextPixels++
        }
      }

      expect(blueTextPixels).toBeGreaterThan(40)
    } finally {
      renderer.destroy()
    }
  })
})

test('INPUT and TEXTAREA canvas use the bound initial value rather than a stale literal', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [{ id: 'name', name: 'name', type: 'string', defaultValue: '张三' }]
  })
  for (const type of ['INPUT', 'TEXTAREA'] as const) {
    const node = graph.createNode(type, page.id, {
      interactiveProps: { value: 'Stale literal', placeholder: 'Name' },
      bindings: { value: { kind: 'ref', stateId: 'name' } }
    })
    const renderer = createMockRenderer({ renderEffects: mock(() => undefined) })
    renderShapeUncached(renderer, asCanvas(createMockCanvas()), node, graph)
    expect(mockCalls(renderer.renderText as ReturnType<typeof mock>)[0]?.[1]).toMatchObject({
      text: '张三'
    })
  }
})

test('input bindings honor empty/document defaults, unknown scopes and font preflight', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const node = graph.createNode('INPUT', page.id, {
    interactiveProps: { value: 'Stale', placeholder: '请输入' },
    bindings: { value: { kind: 'docState', docStateName: 'name' } }
  })
  const labels = () => {
    const renderer = createMockRenderer({ renderEffects: mock(() => undefined) })
    renderShapeUncached(renderer, asCanvas(createMockCanvas()), node, graph)
    return mockCalls(renderer.renderText as ReturnType<typeof mock>).map((call) => call[1])
  }
  for (const defaultValue of ['中文姓名', '']) {
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'name', name: 'name', type: 'string', defaultValue }]
    })
    expect(labels()).toMatchObject([{ text: defaultValue || '请输入' }])
    expect(collectGraphFontRequirements(graph, [node.id]).scripts).toContain('cjk-sc')
  }
  expect(controlDesignDependencies(graph, node)).toContain(graph.rootId)
  graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId: 'missing' } } })
  expect(labels()).toMatchObject([{ text: '请输入' }])
  graph.updateNode(page.id, {
    state: [{ id: 'missing', name: 'missing', type: 'string', defaultValue: 'Wrong scope' }]
  })
  const component = graph.createNode('COMPONENT', page.id)
  graph.reparentNode(node.id, component.id)
  expect(labels()).toMatchObject([{ text: '请输入' }])
  expect(node.interactiveProps?.value).toBe('Stale')
})

test('password values are masked, single-line inputs remove line breaks, and textareas retain them', () => {
  const source = textInput('INPUT', {
    interactiveProps: { inputType: 'password', value: 'Ab中文\n123' }
  })
  expect(lowcodeTextProjection(source)?.node).toMatchObject({ text: '•••••••', maxLines: 1 })
  expect(
    lowcodeTextProjection({ ...source, interactiveProps: { value: 'one\r\ntwo' } })?.node.text
  ).toBe('onetwo')
  expect(
    lowcodeTextProjection({ ...source, type: 'TEXTAREA', interactiveProps: { value: 'one\ntwo' } })
      ?.node.text
  ).toBe('one\ntwo')
  expect(
    lowcodeTextProjection({
      ...source,
      interactiveProps: { inputType: 'number', value: 'invalid', placeholder: 'Amount' }
    })?.node.text
  ).toBe('Amount')
  expect(
    lowcodeTextProjection({
      ...source,
      interactiveProps: { inputType: 'password', value: '', placeholder: 'Password' }
    })?.node.text
  ).toBe('Password')
})

test('disabled text dims, readonly text remains legible, and zero content area never draws', () => {
  const node = textInput('INPUT', {
    interactiveProps: { value: 'Text', textColor: '#336699', disabled: true }
  })
  const renderer = createMockRenderer()
  const canvas = createMockCanvas()
  renderTextInputContent(renderer, asCanvas(canvas), node)
  expect(renderer.color4f).toHaveBeenCalledWith(0.2, 0.4, 0.6, 0.45)
  renderTextInputContent(renderer, asCanvas(canvas), {
    ...node,
    interactiveProps: { value: 'Text', textColor: '#336699', readOnly: true }
  })
  expect(renderer.color4f).toHaveBeenCalledWith(0.2, 0.4, 0.6, 1)
  const count = mockCalls(renderer.renderText as ReturnType<typeof mock>).length
  renderTextInputContent(renderer, asCanvas(canvas), {
    ...node,
    width: 10,
    paddingLeft: 12,
    paddingRight: 12
  })
  expect(mockCalls(renderer.renderText as ReturnType<typeof mock>)).toHaveLength(count)
})

test.each([false, true])(
  'bound Chinese input content invalidates cached effects (raster=%s)',
  async (raster) => {
    const h = await carouselPixelHarness()
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const node = graph.createNode('INPUT', page.id, {
      width: 220,
      height: 44,
      fontSize: 16,
      bindings: { value: { kind: 'ref', stateId: 'name' } },
      interactiveProps: { placeholder: 'Name' },
      effects: [
        {
          type: 'DROP_SHADOW',
          color: { r: 0, g: 0, b: 0, a: 0.2 },
          offset: { x: 1, y: 1 },
          radius: 2,
          spread: 0,
          visible: true
        }
      ]
    })
    const set = (defaultValue: string) =>
      graph.updateNode(page.id, {
        state: [{ id: 'name', name: 'name', type: 'string', defaultValue }]
      })
    const paint = () => {
      h.canvas.clear(h.ck.WHITE)
      h.renderer.renderShape(h.canvas, node, graph)
      return h.pixels()
    }
    h.renderer.renderingSceneBacking = raster
    try {
      set('初始姓名')
      const first = paint()
      expect(
        raster
          ? h.renderer.effectRasterCache.has(node.id)
          : h.renderer.nodePictureCache.has(node.id)
      ).toBe(true)
      set('更新后的名字')
      h.renderer.invalidateNodePicture(page.id)
      const updated = paint()
      expect(updated).not.toEqual(first)
      const label = collectGraphFontRequirements(graph, [node.id]).nodes[0]
      const paragraph = h.renderer.buildParagraph(label, h.ck.BLACK)
      try {
        expect(missingGlyphCharacters(label.text, paragraph.getShapedLines())).toEqual([])
      } finally {
        paragraph.delete()
      }
      await h.save(`input-bound-${raster}`)
    } finally {
      h.dispose()
    }
  }
)

test('real single-line and multiline input pixels stay within small authored content bounds', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode('INPUT', graph.getPages()[0].id, {
    x: 20,
    y: 20,
    width: 100,
    height: 28,
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 4,
    paddingBottom: 4,
    strokes: [],
    fontSize: 16,
    interactiveProps: { value: 'First\nSecond 中文 Third' }
  })
  try {
    const projection = expectDefined(lowcodeTextProjection(node), 'input text projection')
    const paragraph = h.renderer.buildParagraph(projection.node, h.ck.BLACK)
    try {
      expect(paragraph.getShapedLines().length).toBe(1)
    } finally {
      paragraph.delete()
    }
    for (const type of ['INPUT', 'TEXTAREA'] as const) {
      graph.updateNode(node.id, { type })
      h.renderer.invalidateNodePicture(node.id)
      h.canvas.clear(h.ck.WHITE)
      h.renderer.renderNode(h.canvas, graph, node.id, {})
      const pixels = h.pixels()
      for (const [x, y] of [
        [30, 19],
        [30, 48],
        [19, 30],
        [120, 30]
      ])
        expect(h.rgb(pixels, x, y)).toEqual([255, 255, 255])
      await h.save(`bounded-${type.toLowerCase()}`)
    }
  } finally {
    h.dispose()
  }
})

test('number bindings are supported by INPUT but do not invent a valid TEXTAREA binding', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [{ id: 'amount', name: 'amount', type: 'number', defaultValue: 42 }]
  })
  for (const type of ['INPUT', 'TEXTAREA'] as const) {
    const node = graph.createNode(type, page.id, {
      interactiveProps: { placeholder: 'Not configured', value: 'Stale' },
      bindings: { value: { kind: 'ref', stateId: 'amount' } }
    })
    const renderer = createMockRenderer({ renderEffects: mock(() => undefined) })
    renderShapeUncached(renderer, asCanvas(createMockCanvas()), node, graph)
    expect(mockCalls(renderer.renderText as ReturnType<typeof mock>)[0]?.[1]).toMatchObject({
      text: type === 'INPUT' ? '42' : 'Not configured'
    })
  }
})
