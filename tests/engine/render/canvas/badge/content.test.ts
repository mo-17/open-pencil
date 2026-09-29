import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { badgePreviewGeometry, renderBadgeModulePreview } from '#core/canvas/modules/badge'
import { badgeTextNode } from '#core/canvas/modules/badge/text'
import { createBadgeModuleFrameOverrides, resolveBadgeModule } from '#core/plugins/badge'

import { carouselPixelHarness } from '../carousel/helpers'

test('Badge canvas shapes Chinese host text and numeric overflow separately', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createBadgeModuleFrameOverrides({ hostLabel: '消息', label: '消息数', count: 120 })
  )
  const shaped: { text: string; size: number; weight: number }[] = []
  const build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    shaped.push({ text: label.text, size: label.fontSize, weight: label.fontWeight })
    return build(label, color, options)
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    expect(renderBadgeModulePreview(h.renderer, h.canvas, node)).toBe(true)
    expect(shaped).toEqual([
      { text: '消息', size: 14, weight: 400 },
      { text: '99+', size: 12, weight: 600 }
    ])
    expect(badgeTextNode(node)?.text).toBe('消息\n99+')
    expect(h.rgb(h.pixels(), 20, 40)).toEqual([243, 244, 246])
    expect(h.rgb(h.pixels(), 140, 3)).toEqual([220, 38, 38])
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})

test('Badge canvas keeps all four corners inside its frame and zero/dot semantics distinct', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  try {
    for (const placement of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      const node = graph.createNode('FRAME', graph.getPages()[0].id, {
        ...createBadgeModuleFrameOverrides({
          hostLabel: '角标',
          mode: 'dot',
          count: 999_999_999,
          placement,
          size: 'large'
        }),
        width: 100,
        height: 80
      })
      const resolved = resolveBadgeModule(node.interactiveProps?.module)
      if (!resolved?.ok) throw new Error('Badge did not resolve')
      const { badge } = badgePreviewGeometry(node, resolved.config)
      expect(badge.x).toBe(placement.endsWith('left') ? 0 : 88)
      expect(badge.y).toBe(placement.startsWith('top') ? 0 : 68)
      h.canvas.clear(h.ck.WHITE)
      renderBadgeModulePreview(h.renderer, h.canvas, node)
      const pixels = h.pixels()
      expect(h.rgb(pixels, badge.x + 6, badge.y + 6)).toEqual([220, 38, 38])
      let outside = 0
      for (let y = 0; y < 100; y++)
        for (let x = 0; x < 120; x++)
          if ((x >= 100 || y >= 80) && h.rgb(pixels, x, y).some((channel) => channel !== 255))
            outside++
      expect(outside).toBe(0)
      expect(badgeTextNode(node)?.text).toBe('角标')
    }
    const hidden = graph.createNode(
      'FRAME',
      graph.getPages()[0].id,
      createBadgeModuleFrameOverrides({ hostLabel: '零值', count: 0 })
    )
    h.canvas.clear(h.ck.WHITE)
    renderBadgeModulePreview(h.renderer, h.canvas, hidden)
    expect(h.rgb(h.pixels(), 150, 10)).toEqual([255, 255, 255])
    expect(badgeTextNode(hidden)?.text).toBe('零值')
  } finally {
    h.dispose()
  }
})
