import { describe, expect, mock, test } from 'bun:test'

import type { TypefaceFontProvider } from 'canvaskit-wasm'

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

import {
  canvasMock,
  createMockCanvas,
  createMockRenderer
} from '#tests/engine/render/canvas/effects/helpers'
import { asDouble, asCanvas, textLayoutDouble } from '#tests/engine/render/canvas/helpers'

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
  const labels: SceneNode[] = []
  const dispose = mock(() => undefined)
  const renderer = createMockRenderer({
    zoom: 1,
    labelFont: labelFont as never,
    fontProvider: asDouble<TypefaceFontProvider>({}),
    fontsLoaded: true,
    nodeFontReadiness: () => 'ready',
    buildParagraph: (node) => {
      labels.push(node)
      return textLayoutDouble({ getHeight: () => node.fontSize * 1.5, delete: dispose })
    }
  })
  return { renderer, labelFont, labels, dispose }
}

describe('carousel module canvas preview', () => {
  test('builds a deterministic slide summary', () => {
    expect(carouselPreviewLabel(CONFIG)).toBe('1 / 2')
  })

  test('draws an inert first-slide placeholder without requesting remote media', () => {
    const canvas = createMockCanvas()
    const { renderer, labelFont, labels, dispose } = rendererWithFont()
    const originalFetch = globalThis.fetch
    const fetchMock = mock(() => Promise.reject(new Error('Canvas carousel must remain offline')))
    globalThis.fetch = asDouble<typeof fetch>(fetchMock)
    try {
      expect(renderCarouselModulePreview(renderer, asCanvas(canvas), carouselFrame())).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(fetchMock).not.toHaveBeenCalled()
    expect(canvas.save.mock.calls.length).toBe(canvas.restore.mock.calls.length)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    expect(labels.map((node) => node.text)).toEqual([
      'First project preview',
      'First project',
      'A bounded offline preview.'
    ])
    expect(dispose).toHaveBeenCalledTimes(3)
    expect(labelFont.getSize()).toBe(11)
  })

  test('keeps empty, fontless, invalid, and throwing previews balanced', () => {
    const emptyCanvas = { ...createMockCanvas(), drawText: canvasMock('drawText') }
    const { renderer, dispose } = rendererWithFont()
    expect(
      renderCarouselModulePreview(renderer, asCanvas(emptyCanvas), carouselFrame({ width: 0 }))
    ).toBe(true)
    expect(emptyCanvas.save).not.toHaveBeenCalled()

    const fontlessCanvas = { ...createMockCanvas(), drawText: canvasMock('drawText') }
    expect(
      renderCarouselModulePreview(
        createMockRenderer({ zoom: 1, labelFont: null }),
        asCanvas(fontlessCanvas),
        carouselFrame()
      )
    ).toBe(true)
    expect(fontlessCanvas.restore).toHaveBeenCalledTimes(1)

    const invalidCanvas = { ...createMockCanvas(), drawText: canvasMock('drawText') }
    const invalid = carouselFrame({
      interactiveProps: {
        module: { ...createCarouselModuleInstance(CONFIG), configVersion: 99 }
      }
    })
    expect(renderCarouselModulePreview(renderer, asCanvas(invalidCanvas), invalid)).toBe(false)
    expect(invalidCanvas.save).not.toHaveBeenCalled()

    const throwingCanvas = {
      ...createMockCanvas(),
      drawParagraph: mock(() => {
        throw new Error('draw failed')
      })
    }
    expect(() =>
      renderCarouselModulePreview(renderer, asCanvas(throwingCanvas), carouselFrame())
    ).toThrow('draw failed')
    expect(throwingCanvas.restore.mock.calls.length).toBe(throwingCanvas.save.mock.calls.length)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  test('respects the selected slide and hides disabled navigation features', () => {
    const canvas = createMockCanvas()
    const { renderer, labels } = rendererWithFont()
    const node = carouselFrame({
      interactiveProps: {
        module: createCarouselModuleInstance({
          ...CONFIG,
          initialIndex: 1,
          showArrows: false,
          showDots: false
        })
      }
    })
    const original = structuredClone(node)
    expect(renderCarouselModulePreview(renderer, asCanvas(canvas), node)).toBe(true)
    expect(labels.map((label) => label.text)).toEqual(['Second project', 'Another project.'])
    expect(canvas.drawCircle).not.toHaveBeenCalled()
    expect(canvas.drawLine).not.toHaveBeenCalled()
    expect(node).toEqual(original)
  })

  test('exports a canvas adapter with the exact trusted identity', () => {
    expect(CAROUSEL_MODULE_CANVAS_ADAPTER.pluginId).toBe('open-pencil.carousel')
    expect(CAROUSEL_MODULE_CANVAS_ADAPTER.moduleType).toBe('carousel')
  })

  test('a single slide has no misleading previous/next arrows or dot controls', () => {
    const canvas = createMockCanvas()
    const { renderer, labels } = rendererWithFont()
    const node = carouselFrame({
      interactiveProps: {
        module: createCarouselModuleInstance({
          ...CONFIG,
          slides: [CONFIG.slides[1]],
          initialIndex: 0
        })
      }
    })
    expect(renderCarouselModulePreview(renderer, asCanvas(canvas), node)).toBe(true)
    expect(canvas.drawCircle).not.toHaveBeenCalled()
    expect(canvas.drawLine).not.toHaveBeenCalled()
    expect(labels.map((label) => label.text)).toEqual(['Second project', 'Another project.'])
  })
})
