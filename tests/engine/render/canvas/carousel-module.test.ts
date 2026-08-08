import { describe, expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import {
  CAROUSEL_MODULE_CANVAS_ADAPTER,
  carouselPreviewLabel,
  renderCarouselModulePreview
} from '#core/canvas/modules/carousel'
import {
  createCarouselModuleFrameOverrides,
  createCarouselModuleInstance,
  type CarouselModuleConfigV1
} from '#core/plugins/carousel'

import { createMockCanvas, createMockRenderer } from './effects/helpers'

const CONFIG: CarouselModuleConfigV1 = {
  label: 'Featured projects',
  slides: [
    {
      title: 'First project',
      description: 'A bounded offline preview.',
      imageUrl: 'https://media.example.com/first.webp',
      alt: 'First project preview',
      href: '/first'
    },
    {
      title: 'Second project',
      description: 'Another project.',
      imageUrl: '',
      alt: '',
      href: ''
    }
  ],
  initialIndex: 0,
  transition: 'fade',
  autoplay: true,
  intervalMs: 5_000,
  loop: true,
  showArrows: true,
  showDots: true,
  pauseOnHover: true,
  backgroundColor: '#111827',
  textColor: '#FFFFFF',
  accentColor: '#60A5FA'
}

function carouselFrame(overrides: Partial<SceneNode> = {}): SceneNode {
  return createDefaultNode(() => 'carousel-1', 'FRAME', {
    ...createCarouselModuleFrameOverrides(CONFIG),
    width: 640,
    height: 360,
    ...overrides
  })
}

function rendererWithFont() {
  let size = 11
  const labelFont = {
    getGlyphIDs: (value: string) => Array.from(value, (_, index) => index),
    getGlyphWidths: (glyphs: number[]) => glyphs.map(() => 6),
    getSize: mock(() => size),
    setSize: mock((value: number) => {
      size = value
    })
  }
  return { renderer: createMockRenderer({ zoom: 1, labelFont: labelFont as never }), labelFont }
}

describe('carousel module canvas preview', () => {
  test('builds a deterministic slide summary', () => {
    expect(carouselPreviewLabel(CONFIG)).toBe('1 / 2 · fade')
  })

  test('draws an inert first-slide placeholder without requesting remote media', () => {
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const { renderer, labelFont } = rendererWithFont()
    const originalFetch = globalThis.fetch
    const fetchMock = mock(() => Promise.reject(new Error('Canvas carousel must remain offline')))
    globalThis.fetch = fetchMock as typeof fetch
    try {
      expect(renderCarouselModulePreview(renderer, canvas as Canvas, carouselFrame())).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(fetchMock).not.toHaveBeenCalled()
    expect(canvas.save).toHaveBeenCalledTimes(1)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawText.mock.calls.map((call) => call[0])).toContain('First project')
    expect(canvas.drawText.mock.calls.map((call) => call[0])).toContain('1 / 2 · fade')
    expect(canvas.restore).toHaveBeenCalledTimes(1)
    expect(labelFont.setSize.mock.calls.at(-1)?.[0]).toBe(11)
  })

  test('keeps empty, fontless, invalid, and throwing previews balanced', () => {
    const emptyCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const { renderer } = rendererWithFont()
    expect(
      renderCarouselModulePreview(renderer, emptyCanvas as Canvas, carouselFrame({ width: 0 }))
    ).toBe(true)
    expect(emptyCanvas.save).not.toHaveBeenCalled()

    const fontlessCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(
      renderCarouselModulePreview(
        createMockRenderer({ zoom: 1, labelFont: null }),
        fontlessCanvas as Canvas,
        carouselFrame()
      )
    ).toBe(true)
    expect(fontlessCanvas.restore).toHaveBeenCalledTimes(1)

    const invalidCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const invalid = carouselFrame({
      interactiveProps: {
        module: { ...createCarouselModuleInstance(CONFIG), configVersion: 2 }
      }
    })
    expect(renderCarouselModulePreview(renderer, invalidCanvas as Canvas, invalid)).toBe(false)
    expect(invalidCanvas.save).not.toHaveBeenCalled()

    const throwingCanvas = {
      ...createMockCanvas(),
      drawText: mock(() => {
        throw new Error('draw failed')
      })
    }
    expect(() =>
      renderCarouselModulePreview(renderer, throwingCanvas as Canvas, carouselFrame())
    ).toThrow('draw failed')
    expect(throwingCanvas.restore).toHaveBeenCalledTimes(1)
  })

  test('exports a canvas adapter with the exact trusted identity', () => {
    expect(CAROUSEL_MODULE_CANVAS_ADAPTER.pluginId).toBe('open-pencil.carousel')
    expect(CAROUSEL_MODULE_CANVAS_ADAPTER.moduleType).toBe('carousel')
  })
})
