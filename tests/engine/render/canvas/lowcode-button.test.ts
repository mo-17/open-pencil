import { describe, expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { initCanvasKit } from '#cli/headless'
import { buttonLabelTextNode } from '#core/canvas/lowcode'
import { SkiaRenderer } from '#core/canvas/renderer'
import { renderShapeUncached } from '#core/canvas/scene'
import { fontManager } from '#core/text/fonts'

import { expectDefined } from '#tests/helpers/assert'
import { repoPath } from '#tests/helpers/paths'

import { createMockCanvas, createMockRenderer, mockCalls } from './effects/helpers'

function button(overrides: Partial<SceneNode> = {}): SceneNode {
  return createDefaultNode(() => 'button-1', 'BUTTON', {
    width: 171,
    height: 56,
    fontFamily: 'Inter',
    fontSize: 18,
    fontWeight: 600,
    italic: true,
    letterSpacing: 0.5,
    interactiveProps: { text: '整理行囊' },
    ...overrides
  })
}

describe('lowcode BUTTON canvas label', () => {
  test('projects interactiveProps.text with the button typography and centered layout', () => {
    const source = button({
      interactiveProps: { text: '出发 <远方> & "🐸"' },
      textAlignHorizontal: 'RIGHT',
      textAlignVertical: 'BOTTOM'
    })

    const label = buttonLabelTextNode(source)

    expect(label).not.toBeNull()
    expect(label).toMatchObject({
      id: source.id,
      type: 'TEXT',
      text: '出发 <远方> & "🐸"',
      width: 171,
      height: 56,
      fontFamily: 'Inter',
      fontSize: 18,
      fontWeight: 600,
      italic: true,
      letterSpacing: 0.5,
      textAlignHorizontal: 'CENTER',
      textAlignVertical: 'CENTER',
      textAutoResize: 'NONE',
      childIds: []
    })
    expect(source.type).toBe('BUTTON')
    expect(source.textAlignHorizontal).toBe('RIGHT')
    expect(source.textAlignVertical).toBe('BOTTOM')
  })

  test('does not create a drawable label for empty or invalid text', () => {
    expect(buttonLabelTextNode(button({ interactiveProps: { text: '' } }))).toBeNull()
    expect(buttonLabelTextNode(button({ interactiveProps: {} }))).toBeNull()
    expect(buttonLabelTextNode(button({ interactiveProps: { text: 42 } }))).toBeNull()
  })

  test('renders the projected label in its authored color after the button surface and effects', () => {
    const node = button({
      interactiveProps: { text: '整理行囊', textColor: '#A1B2C3' }
    })
    const canvas = createMockCanvas()
    const callOrder: string[] = []
    const renderText = mock((_canvas: Canvas, label: SceneNode) => {
      callOrder.push(`text:${label.text}`)
    })
    const r = createMockRenderer({
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
    const graph = new SceneGraph()

    renderShapeUncached(r, canvas as Canvas, node, graph)

    expect(callOrder).toEqual(['effects:behind', 'fill', 'effects:front', 'text:整理行囊'])
    expect(renderText).toHaveBeenCalledTimes(1)
    const renderedLabel = mockCalls(renderText)[0]?.[1] as SceneNode
    expect(renderedLabel.type).toBe('TEXT')
    expect(renderedLabel.textAlignHorizontal).toBe('CENTER')
    expect(renderedLabel.textAlignVertical).toBe('CENTER')
    expect(r.color4f).toHaveBeenCalledWith(0xa1 / 255, 0xb2 / 255, 0xc3 / 255, 1)
  })

  test('draws centered CJK and punctuation through the real CanvasKit text path', async () => {
    const ck = await initCanvasKit()
    const fontProvider = ck.TypefaceFontProvider.Make()
    fontManager.attachProvider(ck, fontProvider)
    const interData = await Bun.file(
      repoPath('packages/core/assets/Inter-Regular.ttf')
    ).arrayBuffer()
    const notoData = await Bun.file(
      repoPath('tests/fixtures/fonts/NotoSansSC-Regular.ttf')
    ).arrayBuffer()
    fontManager.markLoaded('Inter', 'Regular', interData)
    fontManager.markLoaded('Noto Sans SC', 'Regular', notoData)
    fontManager.setCJKFallbackFamily('Noto Sans SC')

    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const node = graph.createNode('BUTTON', page.id, {
      width: 180,
      height: 56,
      // Real lowcode buttons default to Inter even when their label is CJK.
      // Keep that combination here so the test exercises paragraph fallback.
      fontFamily: 'Inter',
      fontSize: 20,
      interactiveProps: { text: '整理行囊 <&>' },
      fills: [
        {
          type: 'SOLID',
          color: { r: 0.97, g: 0.94, b: 0.85, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    const surface = expectDefined(ck.MakeSurface(180, 56), 'CanvasKit surface')
    const renderer = new SkiaRenderer(ck, surface)
    renderer.fontsLoaded = true
    renderer.fontProvider = fontProvider

    const canvas = surface.getCanvas()
    canvas.clear(ck.WHITE)
    renderer.renderShape(canvas, node, graph)
    surface.flush()

    const image = surface.makeImageSnapshot()
    const pixels = image.readPixels(0, 0, {
      width: 180,
      height: 56,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB
    })
    image.delete()
    surface.delete()

    let darkPixels = 0
    let minX = 180
    let maxX = 0
    let minY = 56
    let maxY = 0
    for (let y = 4; y < 52; y++) {
      for (let x = 4; x < 176; x++) {
        const offset = (y * 180 + x) * 4
        if (pixels[offset] >= 100 || pixels[offset + 1] >= 100 || pixels[offset + 2] >= 100) {
          continue
        }
        darkPixels++
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    }

    expect(darkPixels).toBeGreaterThan(150)
    expect((minX + maxX) / 2).toBeWithin(86, 94)
    expect((minY + maxY) / 2).toBeWithin(25, 31)
  })
})
