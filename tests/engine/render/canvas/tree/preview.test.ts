import { expect, spyOn, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { renderTreeModulePreview } from '#core/canvas/modules/tree'
import { treeTextNode } from '#core/canvas/modules/tree/text'
import { createTreeModuleFrameOverrides } from '#core/plugins/tree'
import { missingGlyphCharacters } from '#core/text/resolver'

import { carouselPixelHarness } from '../carousel/helpers'
test('offline Tree canvas shapes Chinese rows, clips bounded previews and shows closed select values', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph(),
    shaped: SceneNode[] = [],
    missing: string[] = [],
    build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((node, color, options) => {
    const paragraph = build(node, color, options)
    shaped.push(node)
    missing.push(...missingGlyphCharacters(node.text, paragraph.getShapedLines()))
    return paragraph
  })
  try {
    const items = [
      { id: 'root', label: '项目资料', parentId: '', disabled: false },
      { id: 'design', label: '中文设计规范', parentId: 'root', disabled: false }
    ]
    const node = graph.createNode('FRAME', graph.getPages()[0].id, {
      ...createTreeModuleFrameOverrides({
        label: '目录',
        items,
        initialExpandedIds: ['root'],
        initialSelectedIds: ['design']
      }),
      textLanguage: 'en'
    })
    graph.updateNode(node.id, { interactiveProps: { ...node.interactiveProps, lang: 'zh-CN' } })
    expect(treeTextNode(node)?.text).toContain('中文设计规范')
    expect(treeTextNode(node)?.text).toContain('搜索树节点')
    expect(renderTreeModulePreview(h.renderer, h.canvas, node)).toBe(true)
    expect(shaped.map((item) => item.text)).toContain('中文设计规范')
    expect(shaped.map((item) => item.text)).toContain('搜索树节点')
    expect(missing).toEqual([])
    // The selection tint must remain translucent; opaque accent hides the same-color label.
    const pixels = h.pixels()
    const selectedRowY = 12 + 14 * 1.4 + 8 + 40 + 6 + 40
    const background = h.rgb(pixels, 20, Math.ceil(selectedRowY + 20))
    expect(background[0]).toBeGreaterThan(220)
    expect(background[1]).toBeGreaterThan(225)
    expect(background[2]).toBeGreaterThan(245)
    let accentGlyphPixels = 0
    for (let y = Math.ceil(selectedRowY + 10); y < selectedRowY + 32; y++) {
      for (let x = 54; x < 220; x++) {
        const [red, green, blue] = h.rgb(pixels, x, y)
        if (Math.abs(red - 37) <= 3 && Math.abs(green - 99) <= 3 && Math.abs(blue - 235) <= 3)
          accentGlyphPixels++
      }
    }
    expect(accentGlyphPixels).toBeGreaterThan(40)
    shaped.length = 0
    graph.updateNode(node.id, {
      ...createTreeModuleFrameOverrides({
        presentation: 'select',
        items,
        initialExpandedIds: ['root'],
        initialSelectedIds: ['design']
      }),
      width: 160,
      height: 160
    })
    expect(renderTreeModulePreview(h.renderer, h.canvas, node)).toBe(true)
    expect(shaped.map((item) => item.text)).not.toContain('项目资料')
    expect(shaped.map((item) => item.text)).toContain('中文设计规范')
    expect(shaped.every((item) => item.width >= 0 && item.width <= 136)).toBe(true)
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})
