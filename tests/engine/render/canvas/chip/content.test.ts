import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createChipModuleFrameOverrides } from '#core/plugins/chip'
import { collectGraphFontRequirements } from '#core/text/requirements'
import { missingGlyphCharacters } from '#core/text/resolver'

import { carouselPixelHarness } from '../carousel/helpers'

test('chip canvas paints selection, disabled state, removal icons and offline Chinese text', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  const selected = graph.createNode('FRAME', page.id, {
    ...createChipModuleFrameOverrides({
      label: '已选择标签',
      selectable: true,
      initialSelected: true,
      deletable: true
    }),
    x: 20,
    y: 20,
    width: 220,
    height: 44
  })
  const disabled = graph.createNode('FRAME', page.id, {
    ...createChipModuleFrameOverrides({
      label: '禁用标签',
      variant: 'filled',
      disabled: true,
      deletable: true
    }),
    x: 20,
    y: 90,
    width: 220,
    height: 44
  })
  const narrow = graph.createNode('FRAME', page.id, {
    ...createChipModuleFrameOverrides({
      label: '很长的中文和English标签',
      variant: 'outlined',
      deletable: true
    }),
    x: 20,
    y: 160,
    width: 110,
    height: 44
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
    for (const node of [selected, disabled, narrow])
      h.renderer.renderNode(h.canvas, graph, node.id, {})
    expect(labels).toContain('已选择标签')
    expect(missing).toEqual([])
    expect(
      collectGraphFontRequirements(graph, [selected.id, disabled.id, narrow.id]).scripts
    ).toContain('cjk-sc')
    const pixels = h.pixels()
    expect(h.rgb(pixels, 28, 42)[2]).toBeGreaterThan(200)
    expect(h.rgb(pixels, 28, 42)[0]).toBeLessThan(80)
    expect(h.rgb(pixels, 28, 112)[0]).toBeGreaterThan(120)
    expect(h.rgb(pixels, 250, 42)).toEqual([255, 255, 255])
    expect(h.rgb(pixels, 218, 42)[0]).toBeGreaterThan(180)
    await h.save('chip-states')
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})
