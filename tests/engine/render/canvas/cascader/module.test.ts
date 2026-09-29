import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderCascaderModulePreview } from '#core/canvas/modules/cascader'
import { cascaderTextNode } from '#core/canvas/modules/cascader/text'
import { createCascaderModuleFrameOverrides } from '#core/plugins/cascader'

import { carouselPixelHarness } from '../carousel/helpers'

test('Cascader closed Canvas shapes CJK path, reserves arrow/clear space and never mutates live state', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph(),
    page = graph.getPages()[0]
  const items = [
    { id: 'cn', parentId: '', label: '中国', disabled: false },
    { id: 'xm', parentId: 'cn', label: '厦门', disabled: false }
  ]
  graph.updateNode(page.id, {
    state: [{ id: 'location', name: 'location', type: 'array', defaultValue: ['cn', 'xm'] }]
  })
  const node = graph.createNode('FRAME', page.id, {
    ...createCascaderModuleFrameOverrides({ items, placeholder: '请选择地点' }),
    textLanguage: 'zh-CN',
    bindings: { value: { kind: 'ref', stateId: 'location' } }
  })
  const before = structuredClone(node),
    texts: string[] = [],
    widths: number[] = [],
    original = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((text, color, options) => {
    texts.push(text.text)
    widths.push(text.width)
    return original(text, color, options)
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    expect(renderCascaderModulePreview(h.renderer, h.canvas, node, graph)).toBe(true)
    expect(texts).toContain('中国 / 厦门')
    expect(widths).toContain(240)
    expect(cascaderTextNode(node)?.text).toContain('厦门')
    expect(h.rgb(h.pixels(), 319, 22)).not.toEqual([255, 255, 255])
    expect(node).toEqual(before)
    await h.save('cascader-selected')
    graph.updateNode(page.id, {
      state: [{ id: 'location', name: 'location', type: 'array', defaultValue: ['missing'] }]
    })
    texts.length = 0
    renderCascaderModulePreview(h.renderer, h.canvas, node, graph)
    expect(texts).toContain('—')
    expect(texts).not.toContain('请选择地点')
    graph.updateNode(node.id, { bindings: {} })
    texts.length = 0
    renderCascaderModulePreview(h.renderer, h.canvas, node, graph)
    expect(texts).toContain('请选择地点')
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})

test('Cascader tiny/disabled hosts stay clipped and unknown version grants no Canvas renderer', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  try {
    for (const width of [0, 8, 80, 180]) {
      const node = graph.createNode('FRAME', graph.getPages()[0].id, {
        ...createCascaderModuleFrameOverrides({ disabled: true }),
        width,
        height: 44
      })
      h.canvas.clear(h.ck.WHITE)
      expect(renderCascaderModulePreview(h.renderer, h.canvas, node)).toBe(true)
      expect(h.rgb(h.pixels(), width + 1, 20)).toEqual([255, 255, 255])
    }
    const node = graph.createNode(
      'FRAME',
      graph.getPages()[0].id,
      createCascaderModuleFrameOverrides()
    )
    if (!node.interactiveProps?.module) throw new Error('Expected Cascader module')
    node.interactiveProps.module.configVersion = 99
    expect(renderCascaderModulePreview(h.renderer, h.canvas, node)).toBe(false)
    expect(cascaderTextNode(node)).toBeNull()
  } finally {
    h.dispose()
  }
})
