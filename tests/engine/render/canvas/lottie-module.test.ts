import { describe, expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import {
  LOTTIE_MODULE_CANVAS_ADAPTER,
  lottiePreviewLabel,
  renderLottieModulePreview
} from '#core/canvas/modules/lottie'
import { renderShapeUncached } from '#core/canvas/scene'
import {
  createLottieModuleFrameOverrides,
  createLottieModuleInstance,
  type LottieModuleConfigV1
} from '#core/plugins/lottie'

import { createMockCanvas, createMockRenderer } from './effects/helpers'

function lottieFrame(overrides: Partial<SceneNode> = {}): SceneNode {
  return createDefaultNode(() => 'lottie-1', 'FRAME', {
    ...createLottieModuleFrameOverrides({
      source: 'url',
      url: 'https://animations.example.com/demo.json',
      data: {
        v: '5.13.0',
        fr: 30,
        ip: 0,
        op: 90,
        w: 360,
        h: 360,
        layers: []
      },
      loop: true,
      speed: 1.5,
      fit: 'cover'
    }),
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

describe('Lottie module CanvasKit preview', () => {
  test('builds deterministic metadata without resolving or loading the URL', () => {
    expect(
      lottiePreviewLabel({
        source: 'url',
        url: 'https://animations.example.com/demo.json',
        data: {
          v: '5.13.0',
          fr: 30,
          ip: 0,
          op: 90,
          w: 360,
          h: 360,
          layers: []
        },
        autoplay: true,
        loop: true,
        speed: 1.5,
        direction: 'reverse',
        fit: 'cover'
      } satisfies LottieModuleConfigV1)
    ).toBe('animations.example.com · 30 fps · 3.0 s · cover · 1.5x · reverse · loop')
  })

  test('draws a clipped offline placeholder through the exact adapter identity', () => {
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const renderer = rendererWithFont()

    expect(LOTTIE_MODULE_CANVAS_ADAPTER.pluginId).toBe('open-pencil.lottie')
    expect(LOTTIE_MODULE_CANVAS_ADAPTER.moduleType).toBe('lottie')
    expect(LOTTIE_MODULE_CANVAS_ADAPTER.render(renderer, canvas as Canvas, lottieFrame())).toBe(
      true
    )
    expect(canvas.save).toHaveBeenCalledTimes(1)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawCircle).toHaveBeenCalledTimes(2)
    expect(canvas.drawPath).toHaveBeenCalledTimes(1)
    expect(canvas.drawText).toHaveBeenCalledTimes(1)
    expect(canvas.restore).toHaveBeenCalledTimes(1)

    const registryCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    renderShapeUncached(renderer, registryCanvas as Canvas, lottieFrame(), new SceneGraph())
    expect(registryCanvas.drawPath).toHaveBeenCalledTimes(1)
  })

  test('fails closed for invalid identities and non-FRAME hosts', () => {
    const renderer = rendererWithFont()
    const invalidCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const invalid = lottieFrame({
      interactiveProps: {
        module: { ...createLottieModuleInstance(), pluginId: 'unknown.plugin' }
      }
    })

    expect(renderLottieModulePreview(renderer, invalidCanvas as Canvas, invalid)).toBe(false)
    expect(invalidCanvas.drawPath).not.toHaveBeenCalled()

    const rectangle = createDefaultNode(() => 'rectangle-1', 'RECTANGLE', {
      interactiveProps: { module: createLottieModuleInstance() }
    })
    expect(renderLottieModulePreview(renderer, invalidCanvas as Canvas, rectangle)).toBe(false)
  })
})
