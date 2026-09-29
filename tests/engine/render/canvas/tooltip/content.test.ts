import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderTooltipModulePreview } from '#core/canvas/modules/tooltip'
import { tooltipTextNode } from '#core/canvas/modules/tooltip/text'
import { createTooltipModuleFrameOverrides } from '#core/plugins/tooltip'

import { carouselPixelHarness } from '../carousel/helpers'

test('Tooltip canvas paints the real resting trigger and prepares Chinese glyphs without pretending the help is open', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createTooltipModuleFrameOverrides({
      triggerLabel: '查看说明',
      content: '运行时提示',
      fontSize: 16
    })
  )
  const drawn: string[] = [],
    build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    drawn.push(label.text)
    return build(label, color, options)
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    expect(renderTooltipModulePreview(h.renderer, h.canvas, node)).toBe(true)
    expect(drawn).toEqual(['查看说明'])
    expect(tooltipTextNode(node)?.text).toBe('查看说明')
    expect(tooltipTextNode(node)?.fontSize).toBe(16)
    expect(h.rgb(h.pixels(), 20, 10)).toEqual([239, 246, 255])
    expect(h.rgb(h.pixels(), 20, 60)).toEqual([255, 255, 255])
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})
