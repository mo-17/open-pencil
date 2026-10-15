import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createBreadcrumbModuleFrameOverrides } from '#core/plugins/breadcrumb'
import { createStepperModuleFrameOverrides } from '#core/plugins/stepper'
import { collectGraphFontRequirements } from '#core/text/requirements'
import { missingGlyphCharacters } from '#core/text/resolver'

import { carouselPixelHarness } from '../carousel/helpers'

test('navigation canvas shapes Chinese labels, draws state markers and clips narrow frames', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createStepperModuleFrameOverrides({
      items: [
        { title: '基本信息', description: '第一行说明', status: 'completed', disabled: false },
        { title: '核对资料', description: '正在填写', status: 'error', disabled: false }
      ],
      currentIndex: 1
    }),
    x: 20,
    y: 20,
    width: 400,
    height: 120,
    strokes: []
  })
  const breadcrumb = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createBreadcrumbModuleFrameOverrides({
      items: [
        { label: '首页', href: '/' },
        { label: '产品详情', href: '' }
      ]
    }),
    x: 20,
    y: 180,
    width: 180,
    height: 120,
    strokes: []
  })
  const shaped: string[] = []
  const missing: string[] = []
  const original = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    const paragraph = original(label, color, options)
    shaped.push(label.text)
    missing.push(...missingGlyphCharacters(label.text, paragraph.getShapedLines()))
    return paragraph
  })
  try {
    const before = structuredClone(node)
    h.canvas.clear(h.ck.WHITE)
    h.renderer.renderNode(h.canvas, graph, node.id, {})
    h.renderer.renderNode(h.canvas, graph, breadcrumb.id, {})
    expect(shaped).toContain('基本信息')
    expect(shaped).toContain('产品详情')
    expect(missing).toEqual([])
    expect(collectGraphFontRequirements(graph, [node.id, breadcrumb.id]).scripts).toContain(
      'cjk-sc'
    )
    const pixels = h.pixels()
    expect(h.rgb(pixels, 43, 47)[2]).toBeGreaterThan(150)
    expect(h.rgb(pixels, 19, 50)).toEqual([255, 255, 255])
    expect(node).toEqual(before)
    await h.save('navigation-modules')
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})

test.each([24, 32])(
  'vertical stepper keeps two-line descriptions clear of the next step at %ipx',
  async (fontSize) => {
    const h = await carouselPixelHarness()
    const graph = new SceneGraph()
    const node = graph.createNode('FRAME', graph.getPages()[0].id, {
      ...createStepperModuleFrameOverrides({
        orientation: 'vertical',
        fontSize,
        currentIndex: 0,
        items: [
          {
            title: 'First',
            description:
              'A long description that wraps onto two lines and still leaves room for the following step.',
            status: 'auto',
            disabled: false
          },
          { title: 'Next step', description: 'Second description', status: 'auto', disabled: false }
        ]
      }),
      width: 360,
      height: 380,
      strokes: []
    })
    const labels = new WeakMap<object, string>()
    const painted: Array<{ text: string; top: number; bottom: number }> = []
    const build = h.renderer.buildParagraph.bind(h.renderer)
    const nativeDraw = h.canvas.drawParagraph.bind(h.canvas)
    const buildSpy = spyOn(h.renderer, 'buildParagraph').mockImplementation(
      (label, color, options) => {
        const paragraph = build(label, color, options)
        for (const block of paragraph.blocks) labels.set(block.paragraph, label.text)
        return paragraph
      }
    )
    const drawSpy = spyOn(h.canvas, 'drawParagraph').mockImplementation((paragraph, left, top) => {
      painted.push({ text: labels.get(paragraph) ?? '', top, bottom: top + paragraph.getHeight() })
      nativeDraw(paragraph, left, top)
    })
    try {
      h.canvas.clear(h.ck.WHITE)
      h.renderer.renderNode(h.canvas, graph, node.id, {})
      const description = painted.find((item) => item.text.startsWith('A long description'))
      const next = painted.find((item) => item.text === 'Next step')
      expect(description).toBeDefined()
      expect(next).toBeDefined()
      expect(next?.top ?? 0).toBeGreaterThanOrEqual((description?.bottom ?? 1000) + 10)
    } finally {
      drawSpy.mockRestore()
      buildSpy.mockRestore()
      h.dispose()
    }
  }
)

test('nowrap breadcrumb gives its current page a visible ellipsized allocation after long ancestors', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const currentLabel = 'Current destination'
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createBreadcrumbModuleFrameOverrides({
      wrap: false,
      items: [
        { label: 'A long ancestor title that should shrink', href: '/' },
        { label: 'Another long category that should shrink', href: '' },
        { label: currentLabel, href: '' }
      ]
    }),
    width: 280,
    height: 60,
    strokes: []
  })
  const labels = new WeakMap<object, string>()
  const painted: Array<{ text: string; left: number; width: number }> = []
  const build = h.renderer.buildParagraph.bind(h.renderer)
  const nativeDraw = h.canvas.drawParagraph.bind(h.canvas)
  const buildSpy = spyOn(h.renderer, 'buildParagraph').mockImplementation(
    (label, color, options) => {
      const paragraph = build(label, color, options)
      for (const block of paragraph.blocks) labels.set(block.paragraph, label.text)
      return paragraph
    }
  )
  const drawSpy = spyOn(h.canvas, 'drawParagraph').mockImplementation((paragraph, left, top) => {
    painted.push({ text: labels.get(paragraph) ?? '', left, width: paragraph.getMaxWidth() })
    nativeDraw(paragraph, left, top)
  })
  try {
    h.renderer.renderNode(h.canvas, graph, node.id, {})
    const current = painted.find((item) => item.text === currentLabel)
    expect(current).toBeDefined()
    expect(current?.width ?? 0).toBeGreaterThan(20)
    expect((current?.left ?? 1000) + (current?.width ?? 1000)).toBeLessThanOrEqual(269)
  } finally {
    drawSpy.mockRestore()
    buildSpy.mockRestore()
    h.dispose()
  }
})

test('a 320px horizontal stepper paints all three short Chinese steps within its frame', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createStepperModuleFrameOverrides({
      items: [
        { title: '资料', description: '填写资料', status: 'auto', disabled: false },
        { title: '检查', description: '检查内容', status: 'auto', disabled: false },
        { title: '完成', description: '完成设置', status: 'auto', disabled: false }
      ]
    }),
    width: 320,
    height: 124,
    strokes: []
  })
  const finalLabels = new Set(['完成', '完成设置'])
  const finalParagraphs = new Map<object, string>()
  const paintedLabels: string[] = []
  const createParagraph = h.renderer.buildParagraph.bind(h.renderer)
  const paintParagraph = h.canvas.drawParagraph.bind(h.canvas)
  const shape = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    const paragraph = createParagraph(label, color, options)
    if (finalLabels.has(label.text))
      for (const block of paragraph.blocks) finalParagraphs.set(block.paragraph, label.text)
    return paragraph
  })
  const paint = spyOn(h.canvas, 'drawParagraph').mockImplementation((paragraph, x, y) => {
    const text = finalParagraphs.get(paragraph)
    if (text) {
      paintedLabels.push(text)
      expect(x).toBeGreaterThan(150)
      expect(x + paragraph.getMaxWidth()).toBeLessThanOrEqual(304)
      expect(paragraph.getMaxIntrinsicWidth()).toBeLessThanOrEqual(paragraph.getMaxWidth())
    }
    paintParagraph(paragraph, x, y)
  })
  try {
    h.renderer.renderNode(h.canvas, graph, node.id, {})
    expect(paintedLabels).toEqual(['完成', '完成设置'])
  } finally {
    shape.mockRestore()
    paint.mockRestore()
    h.dispose()
  }
})
