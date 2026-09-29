import { expect, spyOn, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { markdownTextNode, renderMarkdownModulePreview } from '#core/canvas/modules/markdown'
import {
  markdownPreviewBlocks,
  markdownPreviewLines
} from '#core/canvas/modules/markdown/projection'
import { createMarkdownModuleFrameOverrides } from '#core/plugins/markdown'
import { missingGlyphCharacters } from '#core/text/resolver'

import { carouselPixelHarness } from './carousel/helpers'

test('Markdown canvas shapes Chinese headings, list copy and literal fenced code without fetching media', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const shaped: SceneNode[] = [],
    missing: string[] = []
  const build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((node, color, options) => {
    const paragraph = build(node, color, options)
    shaped.push(node)
    missing.push(...missingGlyphCharacters(node.text, paragraph.getShapedLines()))
    return paragraph
  })
  try {
    const node = graph.createNode('FRAME', graph.getPages()[0].id, {
      ...createMarkdownModuleFrameOverrides({
        source:
          '# 中文标题\n\n- 列表内容\n> 引用说明\n```js\nconst 值 = "<script>**literal**</script>"\n```\n![本地图示](https://assets.example.com/tracker.png)'
      }),
      width: 320,
      height: 360
    })
    const fontNode = markdownTextNode(node)
    expect(fontNode?.text).toContain('中文标题')
    expect(fontNode?.text).toContain('const 值')
    expect(fontNode?.styleRuns.some((run) => run.style.fontWeight === 600)).toBe(true)
    h.canvas.clear(h.ck.WHITE)
    expect(renderMarkdownModulePreview(h.renderer, h.canvas, node)).toBe(true)
    expect(shaped.map((value) => value.text)).toContain('• 列表内容')
    expect(shaped.map((value) => value.text)).toContain('const 值 = "<script>**literal**</script>"')
    expect(shaped.find((value) => value.text === '中文标题')?.fontSize).toBeGreaterThan(16)
    expect(shaped.every((value) => value.width <= 288)).toBe(true)
    expect(missing).toEqual([])
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})

test('Markdown static projection is explicitly bounded and code remains text', () => {
  const blocks = markdownPreviewBlocks('```html\n<script>literal()</script>\n```\n# 标题')
  expect(blocks[0]).toMatchObject({ kind: 'code', text: '<script>literal()</script>' })
  expect(blocks[1]).toMatchObject({ kind: 'heading', text: '标题', level: 1 })
  expect(markdownPreviewBlocks(Array.from({ length: 1000 }, () => 'line').join('\n'))).toHaveLength(
    256
  )
  expect(markdownPreviewLines('hello', 0)).toEqual([])
})
