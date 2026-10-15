import { expect, mock, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  createCarouselModuleFrameOverrides,
  type CarouselModuleConfigV2
} from '#core/plugins/carousel'
import { collectGraphFontRequirements } from '#core/text/requirements'

import { asDouble } from '#tests/engine/render/canvas/helpers'
import { expectModuleInstance, expectDefined } from '#tests/helpers/assert'

import { carouselPixelHarness } from './helpers'

const slide = { title: '中文 Mixed', description: '', imageUrl: '', alt: '', href: '' }

function fixture(config: Partial<CarouselModuleConfigV2>, width = 320, height = 220) {
  const graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createCarouselModuleFrameOverrides({ slides: [slide], showArrows: false, ...config }),
    width,
    height,
    textLanguage: 'zh-CN',
    strokes: []
  })
  return { graph, node }
}

test('Carousel numbered pagination fonts include all slide labels and disappear with pagination', () => {
  const slides = Array.from({ length: 12 }, (_, index) => ({
    ...slide,
    title: `Page ${index + 1}`
  }))
  const { graph, node } = fixture({ slides, paginationStyle: 'numbers', initialIndex: 0 })
  const requirements = collectGraphFontRequirements(graph, [node.id])
  for (const digit of '0123456789') expect(requirements.characters).toContain(digit)
  const hidden = fixture({ slides, paginationStyle: 'numbers', showDots: false, initialIndex: 0 })
  expect(collectGraphFontRequirements(hidden.graph, [hidden.node.id]).characters).not.toContain('9')
})

test('real Carousel overlay aligns shaped text, masks the media, and bounds every pagination style offline', async () => {
  const { ck, canvas, renderer, pixels, rgb, save, dispose } = await carouselPixelHarness()
  const fetchBefore = globalThis.fetch
  const fetchMock = mock(() =>
    Promise.reject(new Error('Canvas carousel cannot load remote media'))
  )
  globalThis.fetch = asDouble<typeof fetch>(fetchMock)
  const paint = (config: Partial<CarouselModuleConfigV2>, width = 320, height = 220) => {
    const value = fixture(config, width, height)
    renderer.clearDocumentCaches()
    canvas.clear(ck.WHITE)
    renderer.renderNode(canvas, value.graph, value.node.id, {})
    return { ...value, data: pixels() }
  }
  const textBounds = (data: Uint8Array | Float32Array) => {
    const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
    for (let y = 20; y < 176; y++) {
      for (let x = 20; x < 300; x++) {
        if (rgb(data, x, y)[0] < 180) continue
        bounds.left = Math.min(bounds.left, x)
        bounds.top = Math.min(bounds.top, y)
        bounds.right = Math.max(bounds.right, x)
        bounds.bottom = Math.max(bounds.bottom, y)
      }
    }
    expect(Number.isFinite(bounds.left)).toBe(true)
    return bounds
  }
  try {
    const positions: ReturnType<typeof textBounds>[][] = []
    for (const textPosition of ['top', 'center', 'bottom'] as const) {
      const row: ReturnType<typeof textBounds>[] = []
      for (const textAlign of ['left', 'center', 'right'] as const) {
        const { data } = paint({ layout: 'overlay', textPosition, textAlign, showDots: false })
        row.push(textBounds(data))
        await save(`overlay-${textPosition}-${textAlign}`)
      }
      positions.push(row)
    }
    for (const row of positions) {
      expect(row[0].left).toBeLessThan(25)
      expect(row[1].left).toBeGreaterThan(row[0].left + 40)
      expect(row[2].left).toBeGreaterThan(row[1].left + 40)
      expect(row[2].right).toBeGreaterThan(295)
      expect(row[0].top).toBe(row[2].top)
    }
    expect(positions[1][0].top).toBeGreaterThan(positions[0][0].top + 50)
    expect(positions[2][0].top).toBeGreaterThan(positions[1][0].top + 50)

    const edited = paint({
      layout: 'overlay',
      textPosition: 'top',
      textAlign: 'left',
      showDots: false
    })
    edited.graph.updateNode(edited.node.id, {
      interactiveProps: createCarouselModuleFrameOverrides({
        slides: [slide],
        layout: 'overlay',
        textPosition: 'bottom',
        textAlign: 'right',
        showDots: false,
        showArrows: false
      }).interactiveProps
    })
    canvas.clear(ck.WHITE)
    renderer.renderNode(canvas, edited.graph, edited.node.id, {})
    expect(textBounds(pixels())).toEqual(positions[2][2])

    const imageSlide = {
      ...slide,
      imageUrl: 'https://media.example.com/lake.webp',
      alt: '湖畔风景'
    }
    const visible = paint({
      layout: 'overlay',
      slides: [imageSlide],
      overlayOpacity: 0,
      showDots: false
    })
    const shade = paint({
      layout: 'overlay',
      slides: [imageSlide],
      overlayOpacity: 0.5,
      showDots: false
    })
    for (let index = 0; index < 3; index++) {
      expect(
        Math.abs(rgb(shade.data, 5, 200)[index] - rgb(visible.data, 5, 200)[index] * 0.5)
      ).toBeLessThanOrEqual(1)
    }
    await save('overlay-image-mask')
    // Without fetching the authored image, its aspect ratio is unknown: fit modes
    // intentionally share the same neutral offline placeholder.
    for (const imageFit of ['contain', 'fill'] as const) {
      expect(
        paint({
          layout: 'overlay',
          slides: [imageSlide],
          overlayOpacity: 0.5,
          showDots: false,
          imageFit
        }).data
      ).toEqual(shade.data)
    }

    const slides = Array.from({ length: 12 }, (_, index) => ({
      ...imageSlide,
      title: `第 ${index + 1} 页`,
      description: '中文说明与 Mixed text\n第二行'
    }))
    const numbers = paint(
      { slides, initialIndex: 11, paginationStyle: 'numbers', showArrows: true },
      200,
      220
    )
    expect(rgb(numbers.data, 118, 202)).toEqual([96, 165, 250])
    await save('numbers-narrow')
    paint({
      slides,
      initialIndex: 4,
      paginationStyle: 'fraction',
      layout: 'overlay',
      textAlign: 'center'
    })
    await save('fraction-overlay')
    paint(
      {
        slides,
        initialIndex: 1,
        paginationStyle: 'numbers',
        layout: 'overlay',
        textPosition: 'center',
        textAlign: 'right'
      },
      640,
      360
    )
    await save('numbers-overlay')

    for (const paginationStyle of ['dots', 'numbers', 'fraction'] as const) {
      const hidden = paint({ slides, showDots: false, showArrows: false, paginationStyle })
      const footerPixels = Array.from({ length: 280 }, (_, index) =>
        rgb(hidden.data, index + 20, 202)
      )
      expect(footerPixels.every((color) => color.join(',') === '17,24,39')).toBe(true)
      const longSlide = {
        ...imageSlide,
        description: '较长的中文段落应当换行并在正文区域裁剪。'.repeat(8)
      }
      const narrow = paint(
        { slides: [longSlide], layout: 'overlay', paginationStyle, textPosition: 'bottom' },
        120,
        160
      )
      await save(`narrow-${paginationStyle}`)
      for (let y = 0; y < 400; y++) {
        for (let x = 0; x < 680; x++) {
          if (x >= 120 || y >= 160) {
            if (rgb(narrow.data, x, y).some((value) => value !== 255))
              throw new Error('Carousel escaped node bounds')
          }
        }
      }
    }

    const current = paint({ slides: [imageSlide], showDots: true })
    const module = expectModuleInstance(
      expectDefined(current.node.interactiveProps?.module, 'Carousel module')
    )
    const {
      layout,
      imageFit,
      textPosition,
      textAlign,
      overlayOpacity,
      paginationStyle,
      arrowPosition,
      swipeEnabled,
      ...legacyConfig
    } = module.config
    expect({ arrowPosition, swipeEnabled }).toEqual({
      arrowPosition: 'bottom-corners',
      swipeEnabled: true
    })
    const previousVersions = [
      { version: 1, config: legacyConfig },
      {
        version: 2,
        config: {
          ...legacyConfig,
          layout,
          imageFit,
          textPosition,
          textAlign,
          overlayOpacity,
          paginationStyle
        }
      }
    ]
    for (const { version, config } of previousVersions) {
      current.graph.updateNode(current.node.id, {
        interactiveProps: { module: { ...module, configVersion: version, config } }
      })
      renderer.clearDocumentCaches()
      canvas.clear(ck.WHITE)
      renderer.renderNode(canvas, current.graph, current.node.id, {})
      expect(pixels()).toEqual(current.data)
      expect(expectModuleInstance(current.node.interactiveProps?.module).configVersion).toBe(
        version
      )
      expect(expectModuleInstance(current.node.interactiveProps?.module).config).toEqual(config)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  } finally {
    globalThis.fetch = fetchBefore
    dispose()
  }
})
