import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createAccordionModuleFrameOverrides } from '#core/plugins/accordion'
import { collectGraphFontRequirements } from '#core/text/requirements'

import { carouselPixelHarness } from '../carousel/helpers'

test('Accordion shapes Chinese titles and multiline content within its frame', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createAccordionModuleFrameOverrides({
      items: [{ id: 'one', title: '展开内容', content: '第一行\n第二行 Mixed text\n第三行' }],
      initialOpenIds: ['one']
    }),
    width: 240,
    height: 180
  })
  const shaped: Array<{ text: string; lines: number }> = []
  const build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    const paragraph = build(label, color, options)
    shaped.push({ text: label.text, lines: paragraph.getShapedLines().length })
    return paragraph
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    h.renderer.renderNode(h.canvas, graph, node.id, {})
    expect(shaped).toContainEqual({ text: '第一行\n第二行 Mixed text\n第三行', lines: 3 })
    expect(collectGraphFontRequirements(graph, [node.id]).scripts).toContain('cjk-sc')
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})
