import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderDateRangeModulePreview } from '#core/canvas/modules/date-range'
import { dateRangeTextNode } from '#core/canvas/modules/date-range/text'
import { createDateRangeModuleFrameOverrides, dateRangeGeometry } from '#core/plugins/date-range'
import { missingGlyphCharacters } from '#core/text/resolver'

import { carouselPixelHarness } from '../carousel/helpers'

test('offline date range paints native-style values, Chinese labels and stacked narrow fields', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph(),
    page = graph.getPages()[0]
  const frame = createDateRangeModuleFrameOverrides({
    label: '出行日期',
    initialStart: '2026-09-01',
    initialEnd: '2026-09-05'
  })
  const wide = graph.createNode('FRAME', page.id, {
    ...frame,
    width: 360,
    height: 188,
    textLanguage: 'en',
    interactiveProps: { ...frame.interactiveProps, lang: 'zh-CN' }
  })
  const narrow = graph.createNode('FRAME', page.id, {
    ...frame,
    width: 220,
    height: 280,
    interactiveProps: { ...frame.interactiveProps, lang: 'zh-CN' }
  })
  const texts: string[] = [],
    missing: string[] = []
  const build = h.renderer.buildParagraph.bind(h.renderer),
    spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
      const paragraph = build(label, color, options)
      texts.push(label.text)
      missing.push(...missingGlyphCharacters(label.text, paragraph.getShapedLines()))
      return paragraph
    })
  try {
    h.canvas.clear(h.ck.WHITE)
    expect(renderDateRangeModulePreview(h.renderer, h.canvas, wide)).toBe(true)
    h.canvas.save()
    h.canvas.translate(400, 0)
    renderDateRangeModulePreview(h.renderer, h.canvas, narrow)
    h.canvas.restore()
    expect(texts).toContain('开始日期')
    expect(texts).toContain('结束日期')
    expect(texts).toContain('2026-09-01')
    expect(texts).toContain('清空')
    expect(missing).toEqual([])
    expect(dateRangeTextNode(wide)?.textLanguage).toBe('zh-CN')
    const geometry = dateRangeGeometry(220, 14)
    expect(geometry.secondTop).toBeGreaterThan(geometry.fieldTop + geometry.fieldHeight)
    expect(geometry.footerTop + 44 + 12).toBeLessThanOrEqual(280)
    expect(h.rgb(h.pixels(), 13, wide.height - 1)).toEqual([255, 255, 255])
    await h.save('date-range-states')
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})
