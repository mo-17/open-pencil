import { expect, spyOn, test } from 'bun:test'

import type { Paragraph } from 'canvaskit-wasm'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderCodeBlockModulePreview } from '#core/canvas/modules/code-block'
import { createCodeBlockModuleFrameOverrides } from '#core/plugins/code-block'
import { missingGlyphCharacters } from '#core/text/resolver'

import { carouselPixelHarness } from '../carousel/helpers'

test('CodeBlock shapes Chinese source, its authored title and Copy label, with numbers aligned to wrapped rows', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const first = '中文示例 const greeting = "你好，世界"; '.repeat(4)
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createCodeBlockModuleFrameOverrides({
      label: '中文代码示例',
      code: first + '\nconsole.log(greeting)',
      wrapLines: true
    }),
    width: 300,
    height: 380,
    textLanguage: 'en'
  })
  node.interactiveProps = { ...node.interactiveProps, lang: 'zh-CN' }
  const paragraphs = new Map<Paragraph, string>()
  const painted: { text: string; y: number; height: number }[] = []
  const missing: string[] = []
  const build = h.renderer.buildParagraph.bind(h.renderer)
  const draw = h.canvas.drawParagraph.bind(h.canvas)
  const buildSpy = spyOn(h.renderer, 'buildParagraph').mockImplementation(
    (label, color, options) => {
      const paragraph = build(label, color, options)
      for (const block of paragraph.blocks) paragraphs.set(block.paragraph, label.text)
      missing.push(...missingGlyphCharacters(label.text, paragraph.getShapedLines()))
      return paragraph
    }
  )
  const drawSpy = spyOn(h.canvas, 'drawParagraph').mockImplementation((paragraph, x, y) => {
    painted.push({ text: paragraphs.get(paragraph) ?? '', y, height: paragraph.getHeight() })
    draw(paragraph, x, y)
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    expect(renderCodeBlockModulePreview(h.renderer, h.canvas, node)).toBe(true)
    expect(painted.map((item) => item.text)).toContain('中文代码示例')
    expect(painted.map((item) => item.text)).toContain('复制')
    expect(missing).toEqual([])
    const firstLine = painted.find((item) => item.text === first)
    const secondLine = painted.find((item) => item.text === 'console.log(greeting)')
    expect(firstLine).toBeDefined()
    expect(secondLine).toBeDefined()
    expect(firstLine?.height).toBeGreaterThan(14 * 1.55)
    expect(secondLine?.y).toBeGreaterThanOrEqual((firstLine?.y ?? 0) + (firstLine?.height ?? 0))
    expect(painted.find((item) => item.text === '2')?.y).toBe(secondLine?.y)
    await h.save('code-block-wrap')
  } finally {
    drawSpy.mockRestore()
    buildSpy.mockRestore()
    h.dispose()
  }
})
