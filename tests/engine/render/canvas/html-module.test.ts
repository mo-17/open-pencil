import { describe, expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { htmlPreviewText, renderHtmlModulePreview } from '#core/canvas/modules'
import { renderShapeUncached } from '#core/canvas/scene'
import { createHtmlModuleFrameOverrides } from '#core/plugins/html'

import { createMockCanvas, createMockRenderer } from './effects/helpers'

function htmlFrame(overrides: Partial<SceneNode> = {}): SceneNode {
  return createDefaultNode(() => 'html-1', 'FRAME', {
    ...createHtmlModuleFrameOverrides({
      html: '<style>p{color:red}</style><main><h1>Guide</h1><p>Safe &amp; visible</p></main>'
    }),
    width: 640,
    height: 400,
    ...overrides
  })
}

function rendererWithFont() {
  const labelFont = {
    getGlyphIDs: (value: string) => Array.from(value, (_, index) => index),
    getGlyphWidths: (glyphs: number[]) => glyphs.map(() => 6)
  }
  return createMockRenderer({ zoom: 1, labelFont: labelFont as never })
}

describe('HTML module canvas preview', () => {
  test('reduces markup to an inert deterministic summary', () => {
    expect(
      htmlPreviewText(
        '<!-- hidden --><style>.x{color:red}</style><h1>Title</h1><p>A &amp; B</p><script>alert(1)</script>'
      )
    ).toBe('Title · A & B')
  })

  test('draws the module badge and summary through the registered preview', () => {
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const renderer = rendererWithFont()

    expect(renderHtmlModulePreview(renderer, canvas as Canvas, htmlFrame())).toBe(true)
    expect(canvas.drawText.mock.calls.map((call) => call[0])).toEqual([
      '</> HTML',
      'Guide · Safe & visible'
    ])
    expect(canvas.save).toHaveBeenCalledTimes(1)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    expect(canvas.restore).toHaveBeenCalledTimes(1)
  })

  test('regular FRAME dispatches HTML while an unknown identity fails closed', () => {
    const renderer = rendererWithFont()
    const validCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    renderShapeUncached(renderer, validCanvas as Canvas, htmlFrame(), new SceneGraph())
    expect(validCanvas.drawText).toHaveBeenCalled()

    const invalidCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const invalid = htmlFrame({
      interactiveProps: {
        module: {
          version: 1,
          pluginId: 'unknown.plugin',
          moduleType: 'html',
          configVersion: 1,
          config: { html: '<p>x</p>' }
        }
      }
    })
    expect(renderHtmlModulePreview(renderer, invalidCanvas as Canvas, invalid)).toBe(false)
    expect(invalidCanvas.drawText).not.toHaveBeenCalled()
  })
})
