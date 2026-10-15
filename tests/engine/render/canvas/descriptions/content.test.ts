import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderDescriptionsModulePreview } from '#core/canvas/modules/descriptions'
import { descriptionsTextNode } from '#core/canvas/modules/descriptions/text'
import { createDescriptionsModuleFrameOverrides } from '#core/plugins/descriptions'
import { collectGraphFontRequirements } from '#core/text/requirements'
import { missingGlyphCharacters } from '#core/text/resolver'

import { carouselPixelHarness } from '../carousel/helpers'

test.each(['horizontal', 'vertical'] as const)(
  'Descriptions canvas %s shapes real mixed text, wraps values and clips to host',
  async (layout) => {
    const h = await carouselPixelHarness(),
      graph = new SceneGraph()
    const node = graph.createNode('FRAME', graph.getPages()[0].id, {
      ...createDescriptionsModuleFrameOverrides({
        layout,
        columns: 3,
        items: [
          { id: 'name', label: '项目名称', value: '中文 English 详情\n继续阅读' },
          { id: 'notes', label: '说明', value: 'LongUnbrokenValue'.repeat(12) }
        ]
      }),
      width: 180,
      height: 300
    })
    const shaped: string[] = [],
      missing: string[] = [],
      blocks: { text: string; y: number; height: number }[] = []
    const build = h.renderer.buildParagraph.bind(h.renderer)
    const texts = new Map<object, string>()
    const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
      const paragraph = build(label, color, options)
      shaped.push(label.text)
      missing.push(...missingGlyphCharacters(label.text, paragraph.getShapedLines()))
      for (const block of paragraph.blocks) texts.set(block.paragraph, label.text)
      return paragraph
    })
    const draw = h.canvas.drawParagraph.bind(h.canvas)
    const drawSpy = spyOn(h.canvas, 'drawParagraph').mockImplementation((paragraph, x, y) => {
      blocks.push({ text: texts.get(paragraph) ?? '', y, height: paragraph.getHeight() })
      draw(paragraph, x, y)
    })
    try {
      h.canvas.clear(h.ck.WHITE)
      expect(renderDescriptionsModulePreview(h.renderer, h.canvas, node)).toBe(true)
      expect(shaped).toEqual([
        '项目名称',
        '中文 English 详情\n继续阅读',
        '说明',
        'LongUnbrokenValue'.repeat(12)
      ])
      expect(missing).toEqual([])
      expect(descriptionsTextNode(node)?.text).toContain('项目名称\n中文 English')
      expect(collectGraphFontRequirements(graph, [node.id]).scripts).toContain('cjk-sc')
      expect(blocks[2].y).toBeGreaterThan(blocks[0].y + blocks[0].height)
      expect(blocks[3].height).toBeGreaterThan(40)
      const pixels = h.pixels()
      expect(h.rgb(pixels, 180, 150)).toEqual([255, 255, 255])
      expect(h.rgb(pixels, 50, 301)).toEqual([255, 255, 255])
      await h.save('descriptions-' + layout)
    } finally {
      spy.mockRestore()
      drawSpy.mockRestore()
      h.dispose()
    }
  }
)

test('Descriptions vertical canvas reserves the same line for empty and single-line values without fake text', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const starts: number[] = [],
    painted: string[][] = []
  const draw = h.canvas.drawParagraph.bind(h.canvas)
  const build = h.renderer.buildParagraph.bind(h.renderer)
  const textByParagraph = new Map<object, string>()
  let current: string[] = []
  const buildSpy = spyOn(h.renderer, 'buildParagraph').mockImplementation(
    (label, color, options) => {
      const paragraph = build(label, color, options)
      for (const block of paragraph.blocks) textByParagraph.set(block.paragraph, label.text)
      return paragraph
    }
  )
  const drawSpy = spyOn(h.canvas, 'drawParagraph').mockImplementation((paragraph, x, y) => {
    const text = textByParagraph.get(paragraph) ?? ''
    current.push(text)
    if (text === 'Second') starts.push(y)
    draw(paragraph, x, y)
  })
  try {
    for (const value of ['', 'One line']) {
      current = []
      const node = graph.createNode('FRAME', graph.getPages()[0].id, {
        ...createDescriptionsModuleFrameOverrides({
          layout: 'vertical',
          columns: 1,
          items: [
            { id: 'first', label: 'First', value },
            { id: 'second', label: 'Second', value: 'Another line' }
          ]
        }),
        width: 320,
        height: 300
      })
      renderDescriptionsModulePreview(h.renderer, h.canvas, node)
      painted.push(current)
    }
    expect(starts).toHaveLength(2)
    expect(starts[0]).toBe(starts[1])
    expect(painted[0]).toEqual(['First', 'Second', 'Another line'])
    expect(painted[1]).toEqual(['First', 'One line', 'Second', 'Another line'])
  } finally {
    buildSpy.mockRestore()
    drawSpy.mockRestore()
    h.dispose()
  }
})
