import { describe, expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph, type NodeType, type SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { initCanvasKit } from '#cli/headless'
import { lowcodeTextProjection, renderTextInputContent } from '#core/canvas/lowcode'
import { SkiaRenderer } from '#core/canvas/renderer'
import { renderShapeUncached } from '#core/canvas/scene'
import { fontManager } from '#core/text/fonts'

import { expectDefined } from '#tests/helpers/assert'
import { repoPath } from '#tests/helpers/paths'

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

    renderShapeUncached(renderer, canvas as Canvas, node, new SceneGraph())

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

    renderTextInputContent(renderer, canvas as Canvas, node)

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

    renderTextInputContent(renderer, canvas as Canvas, node)

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

    const canvas = surface.getCanvas()
    canvas.clear(ck.WHITE)
    renderer.renderShape(canvas, node, graph)
    surface.flush()

    const image = surface.makeImageSnapshot()
    const pixels = image.readPixels(0, 0, {
      width: 220,
      height: 44,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB
    })
    image.delete()
    surface.delete()

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
  })
})
