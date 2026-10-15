import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderOrgChartModulePreview } from '#core/canvas/modules/org-chart'
import { orgChartTextNode } from '#core/canvas/modules/org-chart/text'
import {
  createOrgChartModuleFrameOverrides,
  ORG_CHART_MODULE_DEFAULT_CONFIG,
  orgChartLayout
} from '#core/plugins/org-chart'
import { collectGraphFontRequirements, requiredNodeFontFaces } from '#core/text/requirements'

import { expectModuleInstance } from '#tests/helpers/assert'

import { carouselPixelHarness } from '../carousel/helpers'

test('Org Chart canvas paints cards and connectors with readable CJK paragraphs and preloads hidden branches', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const config = {
    ...structuredClone(ORG_CHART_MODULE_DEFAULT_CONFIG),
    items: [
      { id: 'root', parentId: '', label: '组织团队', description: '产品与研发' },
      { id: 'design', parentId: 'root', label: '设计部门', description: '产品体验' },
      { id: 'dev', parentId: 'root', label: '研发部门', description: '平台技术' }
    ]
  }
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createOrgChartModuleFrameOverrides(config),
    textLanguage: 'zh-CN'
  })
  const shaped: string[] = [],
    build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    shaped.push(label.text)
    expect(label.fontSize).toBeGreaterThanOrEqual(12)
    return build(label, color, options)
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    expect(renderOrgChartModulePreview(h.renderer, h.canvas, node)).toBe(true)
    expect(shaped).toEqual([
      '组织团队',
      '产品与研发',
      '设计部门',
      '产品体验',
      '研发部门',
      '平台技术'
    ])
    const layout = orgChartLayout(640, config),
      root = layout.cards[0],
      pixels = h.pixels()
    expect(h.rgb(pixels, root.x + 6, root.y + 6)).toEqual([255, 255, 255])
    expect(h.rgb(pixels, root.x + root.width / 2, root.y + root.height + 5)).not.toEqual([
      248, 250, 252
    ])
    expect(h.rgb(pixels, 640, 100)).toEqual([255, 255, 255])
    const fonts = collectGraphFontRequirements(graph, [node.id])
    expect(fonts.characters).toContain('研')
    expect(requiredNodeFontFaces(fonts.nodes[0]).map((face) => face.style)).toContain('SemiBold')
    await h.save('org-chart-default')
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})

test('Org Chart compact canvas matches authored collapse and clips only at the host boundary', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const config = {
    ...structuredClone(ORG_CHART_MODULE_DEFAULT_CONFIG),
    initialCollapsedIds: ['design']
  }
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createOrgChartModuleFrameOverrides(config),
    width: 320
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    expect(renderOrgChartModulePreview(h.renderer, h.canvas, node)).toBe(true)
    expect(orgChartLayout(320, config).cards.map((card) => card.id)).not.toContain('designer')
    expect(orgChartTextNode(node)?.text).toContain('Designer')
    const pixels = h.pixels()
    expect(h.rgb(pixels, 319, 100)).toEqual([248, 250, 252])
    expect(h.rgb(pixels, 320, 100)).toEqual([255, 255, 255])
    await h.save('org-chart-compact')
  } finally {
    h.dispose()
  }
})

test('Org Chart rejects foreign or malformed module identity without painting', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createOrgChartModuleFrameOverrides()
  )
  const module = expectModuleInstance(node.interactiveProps?.module)
  if (!module) throw new Error('Expected module')
  module.configVersion = 99
  try {
    expect(renderOrgChartModulePreview(h.renderer, h.canvas, node)).toBe(false)
    expect(orgChartTextNode(node)).toBeNull()
  } finally {
    h.dispose()
  }
})

test('Org Chart long CJK labels stay inside their allotted two lines at the largest authoring size', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createOrgChartModuleFrameOverrides({
      fontSize: 24,
      items: [
        {
          id: 'root',
          parentId: '',
          label: '中文团队组织名称较长需要两行排版展示',
          description: '这是说明文字包含英文Product'
        }
      ]
    }),
    width: 320,
    textLanguage: 'zh-CN'
  })
  const measurements: { text: string; height: number; available: number; lines: number }[] = []
  const build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    const paragraph = build(label, color, options)
    measurements.push({
      text: label.text,
      height: paragraph.getHeight(),
      available: label.height,
      lines: paragraph.getShapedLines().length
    })
    return paragraph
  })
  try {
    expect(renderOrgChartModulePreview(h.renderer, h.canvas, node)).toBe(true)
    expect(measurements).toHaveLength(2)
    expect(measurements[0].lines).toBe(2)
    expect(measurements[1].lines).toBe(1)
    for (const measured of measurements)
      expect(measured.height).toBeLessThanOrEqual(measured.available + 1)
    await h.save('org-chart-large-cjk')
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})
