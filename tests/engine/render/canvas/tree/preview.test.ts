import { expect, spyOn, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { renderTreeModulePreview } from '#core/canvas/modules/tree'
import { treeTextNode } from '#core/canvas/modules/tree/text'
import { createTreeModuleFrameOverrides } from '#core/plugins/tree'
import { collectGraphFontRequirements, requiredNodeFontFaceUsages } from '#core/text/requirements'
import { missingGlyphCharacters } from '#core/text/resolver'

import { carouselPixelHarness } from '../carousel/helpers'

test.each(['tree', 'select'] as const)(
  'offline %s shapes a semibold title and regular rows or selected values',
  async (presentation) => {
    const h = await carouselPixelHarness(),
      graph = new SceneGraph(),
      shaped: SceneNode[] = [],
      build = h.renderer.buildParagraph.bind(h.renderer)
    const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((node, color, options) => {
      shaped.push(node)
      return build(node, color, options)
    })
    try {
      const node = graph.createNode('FRAME', graph.getPages()[0].id, {
        ...createTreeModuleFrameOverrides({
          presentation,
          label: 'Tree title',
          items: [{ id: 'row', label: 'Row value', parentId: '', disabled: false }],
          initialSelectedIds: ['row'],
          initialExpandedIds: [],
          searchable: false
        })
      })
      const before = structuredClone(node)
      expect(renderTreeModulePreview(h.renderer, h.canvas, node)).toBe(true)
      expect(shaped.find((item) => item.text === 'Tree title')?.fontWeight).toBe(600)
      expect(shaped.find((item) => item.text === 'Row value')?.fontWeight).toBe(400)
      expect(shaped.find((item) => item.text === 'Selected: Row value')?.fontWeight).toBe(400)
      expect(node).toEqual(before)
    } finally {
      spy.mockRestore()
      h.dispose()
    }
  }
)

test.each(['tree', 'select'] as const)(
  '%s preflight requests regular content and the semibold title face under its host',
  (presentation) => {
    const graph = new SceneGraph(),
      node = graph.createNode('FRAME', graph.getPages()[0].id, {
        ...createTreeModuleFrameOverrides({
          presentation,
          label: '目录 Title',
          items: [{ id: 'row', label: '节点 Row', parentId: '', disabled: false }],
          initialSelectedIds: [],
          initialExpandedIds: []
        }),
        textLanguage: 'en'
      })
    graph.updateNode(node.id, { interactiveProps: { ...node.interactiveProps, lang: 'zh-CN' } })
    const before = structuredClone(node),
      requirements = collectGraphFontRequirements(graph, [node.id]),
      text = requirements.nodes[0]
    expect(text.id).toBe(node.id)
    expect(text.fontWeight).toBe(400)
    expect(text.textLanguage).toBe('zh-CN')
    expect(requirements.scripts).toContain('cjk-sc')
    expect(requiredNodeFontFaceUsages(text)).toEqual([
      { family: 'Inter', style: 'Regular', scopes: [{ kind: 'base' }] },
      { family: 'Inter', style: 'SemiBold', scopes: [{ kind: 'style_run', start: 0, end: 8 }] }
    ])
    expect(text.text.slice(0, 8)).toBe('目录 Title')
    expect(text.text).toContain('节点 Row')
    expect(node).toEqual(before)
  }
)

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

test('bound Tree canvas projects declared page and document defaults without example fallback', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph(),
    page = graph.getPages()[0],
    texts: string[] = [],
    build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((node, color, options) => {
    const paragraph = build(node, color, options)
    texts.push(node.text)
    return paragraph
  })
  try {
    const single = graph.createNode('FRAME', page.id, {
      ...createTreeModuleFrameOverrides({ presentation: 'select', initialSelectedIds: ['design'] }),
      bindings: { value: { kind: 'ref', stateId: 'choice' } }
    })
    graph.updateNode(page.id, {
      state: [{ id: 'choice', name: 'choice', type: 'string', defaultValue: 'project' }]
    })
    expect(renderTreeModulePreview(h.renderer, h.canvas, single, graph)).toBe(true)
    expect(texts).toContain('Project')
    expect(texts).not.toContain('Design')
    texts.length = 0
    graph.updateNode(page.id, {
      state: [{ id: 'choice', name: 'choice', type: 'string', defaultValue: 'missing' }]
    })
    renderTreeModulePreview(h.renderer, h.canvas, single, graph)
    expect(texts).toContain('—')
    expect(texts).not.toContain('Design')

    const multiple = graph.createNode('FRAME', page.id, {
      ...createTreeModuleFrameOverrides({
        selectionMode: 'multiple',
        initialSelectedIds: ['design']
      }),
      bindings: { value: { kind: 'docState', docStateName: 'selectedNodes' } }
    })
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'selectedNodes', name: 'selectedNodes', type: 'array', defaultValue: ['project'] }
      ]
    })
    texts.length = 0
    renderTreeModulePreview(h.renderer, h.canvas, multiple, graph)
    expect(texts).toContain('Selected: Project')
    expect(texts).not.toContain('Selected: Design')
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})
