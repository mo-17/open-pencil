import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderPaginationModulePreview } from '#core/canvas/modules/pagination'
import { paginationTextNode } from '#core/canvas/modules/pagination/text'
import {
  createPaginationModuleFrameOverrides,
  PAGINATION_MODULE_DEFAULT_CONFIG,
  paginationLayout
} from '#core/plugins/pagination'

import { expectModuleInstance } from '#tests/helpers/assert'

import { carouselPixelHarness } from '../carousel/helpers'

test('Pagination canvas paints the authored current page and shapes bounded numbers with paragraphs', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const config = { ...PAGINATION_MODULE_DEFAULT_CONFIG, initialPage: 5 }
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createPaginationModuleFrameOverrides(config)
  )
  const shaped: string[] = [],
    build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    shaped.push(label.text)
    return build(label, color, options)
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    expect(renderPaginationModulePreview(h.renderer, h.canvas, node)).toBe(true)
    expect(shaped).toEqual(['1', '…', '4', '5', '6', '…', '10'])
    expect(paginationTextNode(node)?.text).toContain('4 5 6')
    const active = paginationLayout(node.width, config).cells.find((cell) => cell.active)
    if (!active) throw new Error('Expected selected page fixture')
    const pixels = h.pixels()
    expect(h.rgb(pixels, Math.round(active.x + active.width / 2), 8)).toEqual([37, 99, 235])
    expect(h.rgb(pixels, 450, 8)).toEqual([255, 255, 255])
    expect(h.rgb(pixels, 100, 50)).toEqual([255, 255, 255])
    await h.save('pagination-full')
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})

test('Pagination canvas displays empty state and large-page summary without painting outside small hosts', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  try {
    for (const total of [0, 1_000_000_000]) {
      const node = graph.createNode('FRAME', graph.getPages()[0].id, {
        ...createPaginationModuleFrameOverrides({
          total,
          pageSize: 1,
          initialPage: 500_000_000,
          showFirstLast: true,
          fontSize: 24
        }),
        width: 320,
        height: 48
      })
      h.canvas.clear(h.ck.WHITE)
      expect(renderPaginationModulePreview(h.renderer, h.canvas, node)).toBe(true)
      expect(paginationTextNode(node)?.text).toContain(total ? '500000000 / 1000000000' : '0 / 0')
      const pixels = h.pixels()
      for (const [x, y] of [
        [320, 24],
        [150, 48],
        [321, 49]
      ])
        expect(h.rgb(pixels, x, y)).toEqual([255, 255, 255])
      await h.save(total ? 'pagination-large' : 'pagination-empty')
    }
  } finally {
    h.dispose()
  }
})

test('invalid Pagination modules fail closed without painting', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createPaginationModuleFrameOverrides()
  )
  const module = expectModuleInstance(node.interactiveProps?.module)
  if (!module) throw new Error('Expected module fixture')
  module.configVersion = 9
  try {
    expect(renderPaginationModulePreview(h.renderer, h.canvas, node)).toBe(false)
    expect(paginationTextNode(node)).toBeNull()
  } finally {
    h.dispose()
  }
})

test.each(['comfortable', 'compact'] as const)(
  'Pagination canvas preserves both complete number lines in a narrow %s summary',
  async (size) => {
    const h = await carouselPixelHarness(),
      graph = new SceneGraph()
    const node = graph.createNode('FRAME', graph.getPages()[0].id, {
      ...createPaginationModuleFrameOverrides({
        total: 1_000_000_000,
        pageSize: 1,
        initialPage: 100_000_000,
        fontSize: 24,
        showFirstLast: true,
        size
      }),
      width: 180,
      height: 48
    })
    const measurements: {
      text: string
      lines: number
      width: number
      available: number
      height: number
    }[] = []
    const build = h.renderer.buildParagraph.bind(h.renderer)
    const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
      const paragraph = build(label, color, options)
      measurements.push({
        text: label.text,
        lines: paragraph.getShapedLines().length,
        width: paragraph.getLongestLine(),
        available: label.width,
        height: paragraph.getHeight()
      })
      return paragraph
    })
    try {
      h.canvas.clear(h.ck.WHITE)
      expect(renderPaginationModulePreview(h.renderer, h.canvas, node)).toBe(true)
      expect(measurements).toHaveLength(1)
      expect(measurements[0].text).toBe('100000000\n/ 1000000000')
      expect(measurements[0].lines).toBe(2)
      expect(measurements[0].width).toBeLessThanOrEqual(measurements[0].available)
      expect(measurements[0].height).toBeLessThanOrEqual(size === 'compact' ? 36 : 44)
      const pixels = h.pixels()
      expect(h.rgb(pixels, 180, 24)).toEqual([255, 255, 255])
      await h.save('pagination-narrow-' + size)
    } finally {
      spy.mockRestore()
      h.dispose()
    }
  }
)
