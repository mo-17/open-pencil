import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { alertContentGeometry, renderAlertModulePreview } from '#core/canvas/modules/alert'
import { alertTextNode } from '#core/canvas/modules/alert/text'
import { createAlertModuleFrameOverrides } from '#core/plugins/alert'

import { carouselPixelHarness } from '../carousel/helpers'

test('Alert canvas uses semantic surfaces, vector icons and shaped Chinese title/body', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createAlertModuleFrameOverrides({
      title: '保存成功',
      description: '修改已在本机保存。',
      tone: 'success'
    })
  )
  const labels: { text: string; weight: number; width: number }[] = []
  const build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    labels.push({ text: label.text, weight: label.fontWeight, width: label.width })
    return build(label, color, options)
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    expect(renderAlertModulePreview(h.renderer, h.canvas, node)).toBe(true)
    expect(h.rgb(h.pixels(), 180, 100)).toEqual([240, 253, 244])
    expect(labels).toEqual([
      { text: '保存成功', weight: 600, width: 256 },
      { text: '修改已在本机保存。', weight: 400, width: 256 }
    ])
    const projection = alertTextNode(node)
    expect(projection?.text).toBe('保存成功\n修改已在本机保存。')
    expect(projection?.styleRuns).toEqual([{ start: 0, length: 4, style: { fontWeight: 600 } }])
    let iconPixels = 0
    const pixels = h.pixels()
    for (let y = 16; y < 36; y++)
      for (let x = 16; x < 36; x++) {
        const rgb = h.rgb(pixels, x, y)
        if (rgb[0] < 100 && rgb[1] < 160 && rgb[2] < 100) iconPixels++
      }
    expect(iconPixels).toBeGreaterThan(30)
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})

test('Alert canvas wraps narrow content and clips all painting to the authored frame', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createAlertModuleFrameOverrides({
      title: '需要注意',
      description: '长中文说明内容需要自动换行，不越过画布容器边界。',
      tone: 'warning',
      variant: 'filled'
    }),
    width: 140,
    height: 160
  })
  try {
    expect(alertContentGeometry(140, { showIcon: true, closable: true })).toEqual({
      x: 48,
      width: 36,
      closeX: 100
    })
    expect(alertContentGeometry(140, { showIcon: false, closable: false }).width).toBe(108)
    h.canvas.clear(h.ck.WHITE)
    renderAlertModulePreview(h.renderer, h.canvas, node)
    const pixels = h.pixels()
    let outside = 0
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 200; x++) {
        if ((x >= 140 || y >= 160) && h.rgb(pixels, x, y).some((channel) => channel !== 255))
          outside++
      }
    expect(outside).toBe(0)
    expect(h.rgb(pixels, 80, 155)).toEqual([146, 64, 14])
  } finally {
    h.dispose()
  }
})
