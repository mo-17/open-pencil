import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderWalktourModulePreview } from '#core/canvas/modules/walktour'
import { walktourTextNode } from '#core/canvas/modules/walktour/text'
import { createWalktourModuleFrameOverrides } from '#core/plugins/walktour'
import { collectGraphFontRequirements, requiredNodeFontFaces } from '#core/text/requirements'

import { carouselPixelHarness } from '../carousel/helpers'

test('Walktour Canvas paints only the closed 44px CJK trigger, retaining editable child content beneath', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const host = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createWalktourModuleFrameOverrides({ triggerLabel: '开始页面导览' }),
    height: 180,
    textLanguage: 'zh-CN'
  })
  graph.createNode('RECTANGLE', host.id, {
    name: 'Target',
    x: 12,
    y: 64,
    width: 120,
    height: 28,
    fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
  })
  const child = graph.createNode('TEXT', host.id, {
    name: 'Child text',
    text: '常规子图层',
    x: 12,
    y: 110,
    width: 140,
    height: 24,
    textLanguage: 'zh-CN'
  })
  const before = structuredClone(host),
    shaped: string[] = [],
    build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((node, color, options) => {
    shaped.push(node.text)
    return build(node, color, options)
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    h.renderer.renderNode(h.canvas, graph, host.id, {})
    expect(shaped).toContain('开始页面导览')
    expect(shaped).toContain(child.text)
    expect(shaped).not.toContain('Welcome')
    const pixels = h.pixels()
    expect(h.rgb(pixels, 8, 20)).toEqual([37, 99, 235])
    expect(h.rgb(pixels, 8, 44)).toEqual([255, 255, 255])
    expect(h.rgb(pixels, 20, 75)).toEqual([255, 0, 0])
    expect(h.rgb(pixels, 320, 20)).toEqual([255, 255, 255])
    const fonts = collectGraphFontRequirements(graph, [host.id])
    expect(fonts.characters).toContain('览')
    expect(fonts.characters).toContain('层')
    const trigger = walktourTextNode(host)
    if (!trigger) throw new Error('Expected guide trigger font projection')
    expect(requiredNodeFontFaces(trigger).map((face) => face.style)).toContain('SemiBold')
    expect(host).toEqual(before)
    await h.save('walktour-children')
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})

test('Walktour disabled trigger is muted and paint state does not dim ordinary descendants', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const host = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createWalktourModuleFrameOverrides({ disabled: true })
  )
  graph.createNode('RECTANGLE', host.id, {
    x: 0,
    y: 70,
    width: 100,
    height: 20,
    fills: [{ type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 }, opacity: 1, visible: true }]
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    h.renderer.renderNode(h.canvas, graph, host.id, {})
    const pixels = h.pixels(),
      muted = h.rgb(pixels, 8, 20)
    expect(muted[0]).toBeGreaterThan(140)
    expect(muted[0]).toBeLessThan(150)
    expect(h.rgb(pixels, 10, 80)).toEqual([0, 255, 0])
    await h.save('walktour-disabled')
  } finally {
    h.dispose()
  }
})

test('Walktour small hosts clip only their trigger and invalid contracts fail closed', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  try {
    for (const [width, height] of [
      [80, 20],
      [8, 8],
      [0, 44],
      [320, 0]
    ]) {
      const host = graph.createNode('FRAME', graph.getPages()[0].id, {
        ...createWalktourModuleFrameOverrides({
          triggerLabel: '长标题需要裁剪但不溢出',
          fontSize: 24
        }),
        width,
        height
      })
      h.canvas.clear(h.ck.WHITE)
      expect(renderWalktourModulePreview(h.renderer, h.canvas, host)).toBe(true)
      expect(h.rgb(h.pixels(), Math.max(1, width), Math.max(1, height))).toEqual([255, 255, 255])
    }
    const host = graph.createNode(
      'FRAME',
      graph.getPages()[0].id,
      createWalktourModuleFrameOverrides()
    )
    const module = host.interactiveProps?.module
    if (!module) throw new Error('Expected guide fixture')
    module.configVersion = 99
    expect(renderWalktourModulePreview(h.renderer, h.canvas, host)).toBe(false)
    expect(walktourTextNode(host)).toBeNull()
  } finally {
    h.dispose()
  }
})
