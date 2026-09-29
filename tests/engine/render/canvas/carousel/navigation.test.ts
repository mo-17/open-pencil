import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  createCarouselModuleFrameOverrides,
  type CarouselModuleConfigV3
} from '#core/plugins/carousel'

import { carouselPixelHarness } from './helpers'

const slides = [
  { title: '正文应避让导航', description: 'Mixed 中文说明', imageUrl: '', alt: '', href: '' },
  { title: '第二页', description: '', imageUrl: '', alt: '', href: '' },
  { title: '第三页', description: '', imageUrl: '', alt: '', href: '' }
]
const positions = [
  [
    'sides',
    [
      [28, 110],
      [292, 110]
    ],
    12,
    12
  ],
  [
    'top-corners',
    [
      [28, 28],
      [292, 28]
    ],
    12,
    12
  ],
  [
    'bottom-corners',
    [
      [28, 202],
      [292, 202]
    ],
    52,
    52
  ],
  [
    'bottom-left',
    [
      [28, 202],
      [68, 202]
    ],
    96,
    12
  ],
  [
    'bottom-right',
    [
      [252, 202],
      [292, 202]
    ],
    12,
    96
  ]
] as const

test('real Carousel pixels place arrows, reserve the pagination lane, and move the same node without stale output', async () => {
  const { ck, canvas, renderer, pixels, rgb, save, dispose } = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createCarouselModuleFrameOverrides(),
    width: 320,
    height: 220,
    strokes: [],
    textLanguage: 'zh-CN'
  })
  const paint = (config: Partial<CarouselModuleConfigV3>, width = 320, height = 220) => {
    graph.updateNode(node.id, {
      width,
      height,
      interactiveProps: createCarouselModuleFrameOverrides({
        slides,
        layout: 'overlay',
        overlayOpacity: 0,
        textPosition: 'center',
        ...config
      }).interactiveProps
    })
    const original = structuredClone(node)
    canvas.clear(ck.WHITE)
    renderer.renderNode(canvas, graph, node.id, {})
    expect(node).toEqual(original)
    return pixels()
  }
  const numberPixels = (data: Uint8Array | Float32Array) => {
    const xs: number[] = []
    for (let x = 0; x < 320; x++) {
      const color = rgb(data, x, 193)
      if (color[2] > 150 && color[0] < 130 && color[1] > 100) xs.push(x)
    }
    return xs
  }
  const lightPixels = (
    data: Uint8Array | Float32Array,
    left: number,
    top: number,
    right: number,
    bottom: number
  ) => {
    let count = 0
    for (let y = top; y < bottom; y++)
      for (let x = left; x < right; x++) if (rgb(data, x, y)[0] > 180) count++
    return count
  }
  try {
    for (const [arrowPosition, centers, left, right] of positions) {
      for (const paginationStyle of ['dots', 'numbers', 'fraction'] as const) {
        const data = paint({ arrowPosition, paginationStyle })
        for (let index = 0; index < centers.length; index++) {
          const [x, y] = centers[index]
          const tipX = x + (index === 0 ? -3 : 3)
          expect(rgb(data, tipX, y)[0]).toBeGreaterThan(80)
        }
        const selectedCenter = left + (320 - left - right) / 2 - 28
        if (paginationStyle === 'numbers') {
          expect(rgb(data, selectedCenter, 193)).toEqual([96, 165, 250])
          const colored = numberPixels(data)
          expect(Math.min(...colored)).toBeGreaterThanOrEqual(left)
          expect(Math.max(...colored)).toBeLessThan(320 - right)
          await save(`arrows-${arrowPosition}`)
        }
      }
    }

    const top = paint({ arrowPosition: 'top-corners', textPosition: 'top', showDots: false })
    expect(lightPixels(top, 52, 12, 268, 48)).toBe(0)
    expect(lightPixels(top, 20, 52, 300, 90)).toBeGreaterThan(100)
    await save('top-arrows-top-text')

    const sides = paint({ arrowPosition: 'sides', textPosition: 'center', showDots: false })
    expect(lightPixels(sides, 20, 52, 52, 94)).toBe(0)

    const enabled = paint({ arrowPosition: 'bottom-left', swipeEnabled: true })
    const disabled = paint({ arrowPosition: 'bottom-left', swipeEnabled: false })
    expect(disabled).toEqual(enabled)
    const hidden = paint({
      arrowPosition: 'bottom-left',
      showArrows: false,
      paginationStyle: 'numbers'
    })
    expect(rgb(hidden, 132, 193)).toEqual([96, 165, 250])
    expect(rgb(hidden, 25, 202)).toEqual([17, 24, 39])
    const single = paint({
      arrowPosition: 'top-corners',
      slides: [slides[0]],
      paginationStyle: 'numbers'
    })
    expect(rgb(single, 160, 193)).toEqual([96, 165, 250])
    expect(rgb(single, 25, 28)).toEqual([17, 24, 39])

    for (const [arrowPosition] of positions) {
      const narrow = paint({ arrowPosition, paginationStyle: 'numbers' }, 120, 80)
      await save(`narrow-${arrowPosition}`)
      if (arrowPosition === 'sides') {
        expect(rgb(narrow, 25, 28)[0]).toBeGreaterThan(80)
        expect(rgb(narrow, 32, 53)).toEqual([96, 165, 250])
        expect(lightPixels(narrow, 12, 45, 108, 50)).toBe(0)
      }
      for (let y = 0; y < 400; y++)
        for (let x = 0; x < 680; x++)
          if ((x >= 120 || y >= 80) && rgb(narrow, x, y).some((channel) => channel !== 255))
            throw new Error(`Carousel ${arrowPosition} escaped its bounds`)
    }
  } finally {
    dispose()
  }
})
