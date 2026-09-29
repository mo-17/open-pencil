import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createDropdownMenuModuleFrameOverrides } from '#core/plugins/dropdown-menu'
import { createSlideMenuModuleFrameOverrides } from '#core/plugins/slide-menu'
import { createTableModuleFrameOverrides } from '#core/plugins/table'
import { createUploadButtonModuleFrameOverrides } from '#core/plugins/upload-button'
import { fontManager } from '#core/text/fonts'
import { collectGraphFontRequirements } from '#core/text/requirements'
import { fontResolver, missingGlyphCharacters } from '#core/text/resolver'

import { carouselPixelHarness } from '../carousel/helpers'

const cases = [
  [
    'table',
    () =>
      createTableModuleFrameOverrides({
        table: { columns: ['姓名 Name', '状态'], rows: [['张三', '已启用']] }
      }),
    '姓名 Name'
  ],
  [
    'slide-menu',
    () => createSlideMenuModuleFrameOverrides({ triggerLabel: '打开导航 Menu' }),
    '打开导航 Menu'
  ],
  [
    'dropdown-menu',
    () => createDropdownMenuModuleFrameOverrides({ triggerLabel: '更多操作 More' }),
    '更多操作 More'
  ],
  [
    'upload-button',
    () => createUploadButtonModuleFrameOverrides({ triggerLabel: '选择文件 File' }),
    '选择文件 File'
  ]
] as const

for (const [name, overrides, expectedText] of cases) {
  test(`${name} preflights and shapes Chinese visible content with local fallback`, async () => {
    const h = await carouselPixelHarness()
    const graph = new SceneGraph()
    const node = graph.createNode('FRAME', graph.getPages()[0].id, {
      ...overrides(),
      x: 20,
      y: 20,
      width: 320,
      height: name === 'table' ? 120 : 48
    })
    const shaped: Array<{ text: string; missing: string[] }> = []
    const build = h.renderer.buildParagraph.bind(h.renderer)
    const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
      const paragraph = build(label, color, options)
      shaped.push({
        text: label.text,
        missing: missingGlyphCharacters(label.text, paragraph.getShapedLines())
      })
      return paragraph
    })
    try {
      const before = structuredClone(node)
      h.canvas.clear(h.ck.WHITE)
      h.renderer.renderNode(h.canvas, graph, node.id, {})
      await h.save(`module-${name}`)
      expect(collectGraphFontRequirements(graph, [node.id]).scripts).toContain('cjk-sc')
      expect(shaped).toContainEqual({ text: expectedText, missing: [] })
      expect(node).toEqual(before)
    } finally {
      spy.mockRestore()
      h.dispose()
    }
  })
}

for (const [name, overrides] of cases) {
  test(`${name} clips narrow frames and redraws changed text on the same host`, async () => {
    const h = await carouselPixelHarness()
    const graph = new SceneGraph()
    const node = graph.createNode('FRAME', graph.getPages()[0].id, {
      ...overrides(),
      x: 20,
      y: 20,
      width: 96,
      height: 48,
      strokes: []
    })
    const paint = () => {
      h.canvas.clear(h.ck.WHITE)
      h.renderer.renderNode(h.canvas, graph, node.id, {})
      return h.pixels()
    }
    try {
      const first = paint()
      for (const [x, y] of [
        [19, 30],
        [116, 30],
        [30, 19],
        [30, 68]
      ])
        expect(h.rgb(first, x, y)).toEqual([255, 255, 255])
      await h.save(`module-${name}-narrow`)
      const module = node.interactiveProps?.module
      if (!module || typeof module !== 'object' || Array.isArray(module))
        throw new Error('module unavailable')
      const config = module.config
      if (!config || typeof config !== 'object' || Array.isArray(config))
        throw new Error('module config unavailable')
      graph.updateNode(node.id, {
        interactiveProps: {
          module: {
            ...module,
            config:
              name === 'table'
                ? { ...config, table: { columns: ['新名称', '状态'], rows: [['更新', '已启用']] } }
                : { ...config, triggerLabel: '新标题 Updated' }
          }
        }
      })
      h.renderer.invalidateNodePicture(node.id)
      expect(paint()).not.toEqual(first)
    } finally {
      h.dispose()
    }
  })
}

test('module font preflight excludes hidden table rows, popup bodies and authored trigger children', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const table = graph.createNode('FRAME', page.id, {
    ...createTableModuleFrameOverrides({ table: { columns: ['Name'], rows: [['不显示']] } }),
    height: 22
  })
  expect(collectGraphFontRequirements(graph, [table.id]).characters).not.toContain('不')
  const trigger = graph.createNode(
    'FRAME',
    page.id,
    createSlideMenuModuleFrameOverrides({
      triggerLabel: 'Open',
      title: '隐形菜单',
      description: '其他说明'
    })
  )
  expect(collectGraphFontRequirements(graph, [trigger.id]).scripts).toEqual([])
  graph.updateNode(trigger.id, {
    interactiveProps: createSlideMenuModuleFrameOverrides({ triggerLabel: '不显示' })
      .interactiveProps
  })
  graph.createNode('TEXT', trigger.id, { text: 'Child' })
  expect(collectGraphFontRequirements(graph, [trigger.id]).characters).not.toContain('不')
})

for (const [name, overrides] of cases) {
  test(`${name} late fallback settlement invalidates its already recorded host`, async () => {
    const h = await carouselPixelHarness()
    const graph = new SceneGraph()
    const node = graph.createNode('FRAME', graph.getPages()[0].id, {
      ...overrides(),
      width: 320,
      height: name === 'table' ? 120 : 48,
      effects: [
        {
          type: 'DROP_SHADOW',
          color: { r: 0, g: 0, b: 0, a: 0.2 },
          offset: { x: 1, y: 1 },
          radius: 2,
          spread: 0,
          visible: true
        }
      ]
    })
    const release = Promise.withResolvers<undefined>()
    const settled = Promise.withResolvers<undefined>()
    // Keep the real registered local face, but delay its fallback availability through the normal resolver.
    fontManager.detachProvider(h.renderer.fontProvider)
    await h.renderer.loadFonts(() => {
      if (h.renderer.pendingFontNodes.size === 0) settled.resolve(undefined)
    })
    fontManager.getCJKFallbackFamilies().splice(0)
    fontResolver.resetMatching((demand) => demand.key.startsWith('coverage:cjk-sc:'))
    const fallback = spyOn(fontManager, 'ensureFallbackPack').mockImplementation(async () => {
      await release.promise
      fontManager.setCJKFallbackFamily('Noto Sans SC')
      return { 'cjk-sc': ['Noto Sans SC'] }
    })
    const paint = () => {
      h.canvas.clear(h.ck.WHITE)
      h.renderer.renderShape(h.canvas, node, graph)
      return h.pixels()
    }
    try {
      const pending = paint()
      expect(h.renderer.pendingFontNodes.has(node.id)).toBe(true)
      expect(h.renderer.nodePictureCache.has(node.id)).toBe(true)
      release.resolve(undefined)
      await settled.promise
      expect(h.renderer.nodePictureCache.has(node.id)).toBe(false)
      expect(h.renderer.pendingFontNodes.has(node.id)).toBe(false)
      expect(paint()).not.toEqual(pending)
    } finally {
      release.resolve(undefined)
      fallback.mockRestore()
      h.dispose()
    }
  })
}
