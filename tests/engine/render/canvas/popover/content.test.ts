import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderPopoverModulePreview } from '#core/canvas/modules/popover'
import { popoverTriggerTextNode } from '#core/canvas/modules/popover/text'
import { createSelectionPresentation, isPresentedNode } from '#core/editor/selection/presentation'
import { createPopoverModuleFrameOverrides } from '#core/plugins/popover'

import { carouselPixelHarness } from '../carousel/helpers'

test('Popover canvas paints a bounded Chinese trigger, never its text body or confirmation actions', async () => {
  const harness = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createPopoverModuleFrameOverrides({
      triggerLabel: '查看内容',
      content: '不在画布打开',
      mode: 'confirm',
      fontSize: 16
    })
  )
  const text: string[] = []
  const build = harness.renderer.buildParagraph.bind(harness.renderer)
  const spy = spyOn(harness.renderer, 'buildParagraph').mockImplementation(
    (label, color, options) => {
      text.push(label.text)
      return build(label, color, options)
    }
  )
  try {
    harness.canvas.clear(harness.ck.WHITE)
    expect(renderPopoverModulePreview(harness.renderer, harness.canvas, node)).toBe(true)
    expect(text).toEqual(['查看内容'])
    expect(popoverTriggerTextNode(node)).toMatchObject({
      text: '查看内容',
      fontSize: 16,
      textAlignHorizontal: 'CENTER'
    })
    expect(harness.rgb(harness.pixels(), 20, 10)).toEqual([239, 246, 255])
    expect(harness.rgb(harness.pixels(), 20, 60)).toEqual([255, 255, 255])
  } finally {
    spy.mockRestore()
    harness.dispose()
  }
})

test('Popover child geometry is unavailable to ordinary canvas hit testing and visible in explicit content isolation', () => {
  const graph = new SceneGraph()
  const host = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createPopoverModuleFrameOverrides({ contentChildName: 'Body' })
  )
  const body = graph.createNode('FRAME', host.id, { name: 'Body', width: 280, height: 180 })
  const text = graph.createNode('TEXT', body.id, { text: 'Private panel content' })
  expect(isPresentedNode(graph, text, createSelectionPresentation(graph))).toBe(false)
  expect(isPresentedNode(graph, text, createSelectionPresentation(graph, body.id))).toBe(true)
})
