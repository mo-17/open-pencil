import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { recordRenderChunk, RenderChunkIndex } from '#core/canvas/renderer/chunks'
import { createAccordionModuleFrameOverrides } from '#core/plugins/accordion'
import { collectGraphFontKeys, collectGraphFontRequirements } from '#core/text/requirements'
import { missingGlyphCharacters } from '#core/text/resolver'

import { expectDefined } from '#tests/helpers/assert'

import { carouselPixelHarness } from '../carousel/helpers'

const items = [
  { id: 'one', title: '账户资料 Account', content: '第一行\n第二行 Mixed text\n第三行' },
  { id: 'two', title: '下一节', content: 'Hidden Arabic مرحبا' }
]

test('Accordion preflights initial visible text and both weights without including closed bodies', () => {
  const graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createAccordionModuleFrameOverrides({ items, initialOpenIds: ['one'] })
  )
  const before = structuredClone(node)
  const requirements = collectGraphFontRequirements(graph, [node.id])
  expect(requirements.scripts).toContain('cjk-sc')
  expect(requirements.scripts).not.toContain('arabic')
  expect(requirements.characters).toContain('下')
  expect(requirements.characters).toContain('三')
  expect(collectGraphFontKeys(graph, [node.id])).toEqual([
    ['Inter', 'Regular'],
    ['Inter', 'SemiBold']
  ])
  expect(node).toEqual(before)
})

test('Accordion actual Chinese paragraphs, right indicators, transparent dividers and chunk rendering agree', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const node = graph.createNode('FRAME', page.id, {
    ...createAccordionModuleFrameOverrides({ items, initialOpenIds: ['one'] }),
    x: 20,
    y: 20,
    width: 320,
    height: 220,
    strokes: []
  })
  const shaped: Array<{ text: string; lines: number; missing: string[] }> = []
  const nativeBuild = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    const paragraph = nativeBuild(label, color, options)
    shaped.push({
      text: label.text,
      lines: paragraph.getShapedLines().length,
      missing: missingGlyphCharacters(label.text, paragraph.getShapedLines())
    })
    return paragraph
  })
  const paint = () => {
    h.canvas.clear(h.ck.WHITE)
    h.renderer.renderNode(h.canvas, graph, node.id, {})
    return h.pixels()
  }
  try {
    const original = structuredClone(node)
    const direct = paint()
    expect(shaped).toContainEqual({ text: items[0].content, lines: 3, missing: [] })
    expect(shaped.some((entry) => entry.text === items[1].content)).toBe(false)
    expect(h.rgb(direct, 315, 42)[0]).toBeLessThan(80)
    expect(h.rgb(direct, 315, 42)[2]).toBeGreaterThan(200)
    expect(h.rgb(direct, 315, 38)).toEqual([255, 255, 255])
    // Divider follows the expanded body, rather than separating its header from its own text.
    expect(h.rgb(direct, 25, 64)).toEqual([255, 255, 255])
    const dividers: number[] = []
    for (let y = 64; y < 225; y++) {
      const [red, green, blue] = h.rgb(direct, 25, y)
      if (blue > red + 20 && green > red) dividers.push(y)
    }
    expect(dividers.length).toBeGreaterThan(0)
    expect(dividers[0]).toBeGreaterThan(135)
    expect(h.rgb(direct, 25, dividers[0])[0]).toBeGreaterThan(180)
    await h.save('accordion-multiline')
    const { index } = RenderChunkIndex.build(graph, page.id)
    try {
      const recorded = recordRenderChunk(
        h.renderer,
        graph,
        expectDefined(index.getChunksForNode(node.id)[0], 'Accordion chunk')
      )
      try {
        h.canvas.clear(h.ck.WHITE)
        h.canvas.drawPicture(recorded.picture)
        expect(h.pixels()).toEqual(direct)
      } finally {
        recorded.picture.delete()
      }
    } finally {
      index.dispose()
    }
    expect(node).toEqual(original)
    graph.updateNode(node.id, { width: 86, height: 76 })
    h.renderer.invalidateNodePicture(node.id)
    const narrow = paint()
    for (const [x, y] of [
      [19, 30],
      [106, 30],
      [30, 19],
      [30, 96]
    ])
      expect(h.rgb(narrow, x, y)).toEqual([255, 255, 255])
    await h.save('accordion-narrow')
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})
