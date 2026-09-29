import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderTimelineModulePreview } from '#core/canvas/modules/timeline'
import { timelineTextNode } from '#core/canvas/modules/timeline/text'
import { createTimelineModuleFrameOverrides, TIMELINE_DEFAULT_ITEM } from '#core/plugins/timeline'
import { collectGraphFontRequirements } from '#core/text/requirements'
import { missingGlyphCharacters } from '#core/text/resolver'

import { carouselPixelHarness } from '../carousel/helpers'

test('Timeline canvas renders distinct status markers and preflights all authored Chinese text', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createTimelineModuleFrameOverrides({
      layout: 'alternate',
      items: [
        {
          ...TIMELINE_DEFAULT_ITEM,
          id: 'done',
          title: '完成整理',
          time: '上午九点',
          description: '资料已整理。',
          status: 'completed'
        },
        {
          ...TIMELINE_DEFAULT_ITEM,
          id: 'now',
          title: '当前审核',
          description: '人工检查中。',
          status: 'current'
        },
        { ...TIMELINE_DEFAULT_ITEM, id: 'issue', title: '需要补充', status: 'error' },
        { ...TIMELINE_DEFAULT_ITEM, id: 'later', title: '等待处理', status: 'pending' }
      ]
    }),
    width: 640,
    height: 380
  })
  const labels: string[] = [],
    missing: string[] = []
  const build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    const paragraph = build(label, color, options)
    labels.push(label.text)
    missing.push(...missingGlyphCharacters(label.text, paragraph.getShapedLines()))
    return paragraph
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    expect(renderTimelineModulePreview(h.renderer, h.canvas, node)).toBe(true)
    expect(labels).toContain('当前审核')
    expect(labels).toContain('上午九点')
    expect(missing).toEqual([])
    expect(collectGraphFontRequirements(graph, [node.id]).scripts).toContain('cjk-sc')
    expect(timelineTextNode(node)?.styleRuns).toHaveLength(4)
    const pixels = h.pixels()
    let green = 0,
      blue = 0,
      red = 0
    for (let y = 16; y < 300; y++)
      for (let x = 312; x < 328; x++) {
        const [r, g, b] = h.rgb(pixels, x, y)
        if (g > r * 2 && g > b * 1.3) green++
        if (b > r * 2 && b > g * 1.3) blue++
        if (r > g * 2 && r > b * 2) red++
      }
    expect(green).toBeGreaterThan(50)
    expect(blue).toBeGreaterThan(50)
    expect(red).toBeGreaterThan(50)
    expect(h.rgb(pixels, 650, 26)).toEqual([255, 255, 255])
    await h.save('timeline-alternate')
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})

test('Timeline canvas wraps large mixed text before placing the next event and clips to the host', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const description = '这是一段较长的中文说明和 English words，需要换行并为下一项保留空间。'
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createTimelineModuleFrameOverrides({
      fontSize: 24,
      layout: 'alternate',
      items: [
        { ...TIMELINE_DEFAULT_ITEM, id: 'long', title: '审核详情', description, status: 'current' },
        { ...TIMELINE_DEFAULT_ITEM, id: 'next', title: '下一事件', description: '下一段说明。' }
      ]
    }),
    width: 320,
    height: 360
  })
  const names = new Map<object, string>(),
    positions: { text: string; x: number; y: number; height: number }[] = []
  const build = h.renderer.buildParagraph.bind(h.renderer),
    draw = h.canvas.drawParagraph.bind(h.canvas)
  const buildSpy = spyOn(h.renderer, 'buildParagraph').mockImplementation(
    (label, color, options) => {
      const paragraph = build(label, color, options)
      names.set(paragraph, label.text)
      return paragraph
    }
  )
  const drawSpy = spyOn(h.canvas, 'drawParagraph').mockImplementation((paragraph, x, y) => {
    positions.push({ text: names.get(paragraph) ?? '', x, y, height: paragraph.getHeight() })
    draw(paragraph, x, y)
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    renderTimelineModulePreview(h.renderer, h.canvas, node)
    const long = positions.find((block) => block.text === description),
      next = positions.find((block) => block.text === '下一事件')
    if (!long || !next) throw new Error('Timeline paragraph missing')
    expect(long.height).toBeGreaterThan(24 * 1.5)
    expect(next.y).toBeGreaterThanOrEqual(long.y + long.height + 24)
    expect(next.x).toBe(44)
    const pixels = h.pixels()
    let overflow = 0
    for (let y = 0; y < 400; y++)
      for (let x = 0; x < 350; x++)
        if ((x >= 320 || y >= 360) && h.rgb(pixels, x, y).some((channel) => channel !== 255))
          overflow++
    expect(overflow).toBe(0)
    await h.save('timeline-long-text')
  } finally {
    buildSpy.mockRestore()
    drawSpy.mockRestore()
    h.dispose()
  }
})

test('Timeline empty state uses authored copy and has no phantom event markers', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createTimelineModuleFrameOverrides({ items: [], emptyText: '暂无事件' })
  )
  const labels: string[] = []
  const build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    labels.push(label.text)
    return build(label, color, options)
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    renderTimelineModulePreview(h.renderer, h.canvas, node)
    expect(labels).toEqual(['暂无事件'])
    expect(timelineTextNode(node)?.text).toBe('暂无事件')
    expect(h.rgb(h.pixels(), 24, 60)).toEqual([255, 255, 255])
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})
