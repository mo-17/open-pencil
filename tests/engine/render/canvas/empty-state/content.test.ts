import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderEmptyStateModulePreview } from '#core/canvas/modules/empty-state'
import { emptyStateTextNode } from '#core/canvas/modules/empty-state/text'
import { createEmptyStateModuleFrameOverrides } from '#core/plugins/empty-state'
import { collectGraphFontRequirements } from '#core/text/requirements'
import { missingGlyphCharacters } from '#core/text/resolver'

import { carouselPixelHarness } from '../carousel/helpers'

test('Empty State canvas preflights Chinese title and description and paints a real built-in illustration', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createEmptyStateModuleFrameOverrides({
      title: '暂无资料',
      description: '可以继续添加。English text',
      illustrationColor: '#2563EB'
    })
  )
  const shaped: { text: string; size: number; weight: number }[] = [],
    missing: string[] = []
  const build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    const paragraph = build(label, color, options)
    shaped.push({ text: label.text, size: label.fontSize, weight: label.fontWeight })
    missing.push(...missingGlyphCharacters(label.text, paragraph.getShapedLines()))
    return paragraph
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    expect(renderEmptyStateModulePreview(h.renderer, h.canvas, node)).toBe(true)
    expect(shaped).toEqual([
      { text: '暂无资料', size: 17.5, weight: 600 },
      { text: '可以继续添加。English text', size: 14, weight: 400 }
    ])
    expect(missing).toEqual([])
    expect(emptyStateTextNode(node)?.text).toBe('暂无资料\n可以继续添加。English text')
    expect(collectGraphFontRequirements(graph, [node.id]).scripts).toContain('cjk-sc')
    const pixels = h.pixels()
    let blue = 0
    for (let y = 24; y < 160; y++)
      for (let x = 145; x < 215; x++) {
        const [r, g, b] = h.rgb(pixels, x, y)
        if (b > r * 2 && b > g * 1.5) blue++
      }
    expect(blue).toBeGreaterThan(50)
    await h.save('empty-state-box')
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})

test('Empty State canvas wraps large mixed copy, preserves its beginning and clips within narrow frames', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createEmptyStateModuleFrameOverrides({
      title: '尚无匹配资料',
      description: '中文与 English long description '.repeat(5),
      illustration: 'search',
      alignment: 'left',
      padding: 64,
      fontSize: 24,
      iconSize: 128
    }),
    width: 180,
    height: 360
  })
  const blocks: { x: number; y: number; height: number }[] = []
  const draw = h.canvas.drawParagraph.bind(h.canvas)
  const spy = spyOn(h.canvas, 'drawParagraph').mockImplementation((paragraph, x, y) => {
    blocks.push({ x, y, height: paragraph.getHeight() })
    draw(paragraph, x, y)
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    renderEmptyStateModulePreview(h.renderer, h.canvas, node)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].x).toBe(45)
    expect(blocks[0].y).toBe(45 + 90 + 12)
    expect(blocks[0].height).toBeGreaterThan(30 * 1.5)
    expect(blocks[1].y).toBeGreaterThanOrEqual(blocks[0].y + blocks[0].height + 12)
    const pixels = h.pixels()
    let outside = 0
    for (let y = 0; y < 400; y++)
      for (let x = 0; x < 210; x++)
        if ((x >= 180 || y >= 360) && h.rgb(pixels, x, y).some((value) => value !== 255)) outside++
    expect(outside).toBe(0)
    await h.save('empty-state-long')
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})

test('Empty State without illustration or description centers only the authored title', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createEmptyStateModuleFrameOverrides({
      title: '只有标题',
      description: '',
      illustration: 'none'
    })
  )
  const positions: { y: number; height: number }[] = []
  const draw = h.canvas.drawParagraph.bind(h.canvas)
  const spy = spyOn(h.canvas, 'drawParagraph').mockImplementation((paragraph, x, y) => {
    positions.push({ y, height: paragraph.getHeight() })
    draw(paragraph, x, y)
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    renderEmptyStateModulePreview(h.renderer, h.canvas, node)
    expect(positions).toHaveLength(1)
    expect(positions[0].y).toBe((node.height - positions[0].height) / 2)
    expect(h.rgb(h.pixels(), 180, 40)).toEqual([255, 255, 255])
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})
