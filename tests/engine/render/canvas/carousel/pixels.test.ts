import { expect, mock, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { recordRenderChunk, RenderChunkIndex } from '#core/canvas/renderer/chunks'
import { createCarouselModuleFrameOverrides } from '#core/plugins/carousel'
import { collectGraphFontKeys, collectGraphFontRequirements } from '#core/text/requirements'
import { missingGlyphCharacters } from '#core/text/resolver'

import { expectDefined } from '#tests/helpers/assert'

import { carouselPixelHarness } from './helpers'

const slides = [
  { title: 'Hidden first', description: 'Inactive text', imageUrl: '', alt: '', href: '' },
  {
    title: '城市与自然',
    description: '中文说明第一行\nMixed text 第二行',
    imageUrl: 'https://images.example.com/lake.webp',
    alt: '湖畔风景',
    href: ''
  },
  {
    title: 'Third slide',
    description: 'Text-only content\nAnother line',
    imageUrl: '',
    alt: '',
    href: ''
  }
]

function fixture(width = 640, height = 360, initialIndex = 1) {
  const graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createCarouselModuleFrameOverrides({ slides, initialIndex, autoplay: true, loop: false }),
    width,
    height,
    textLanguage: 'zh-CN',
    strokes: []
  })
  return { graph, node }
}

test('Carousel font preflight includes only initial-slide text and its actual weights', () => {
  const { graph, node } = fixture()
  const original = structuredClone(node)
  const requirements = collectGraphFontRequirements(graph, [node.id])
  expect(requirements.scripts).toContain('cjk-sc')
  for (const character of '城市与自然中文说明湖畔风景')
    expect(requirements.characters).toContain(character)
  expect(requirements.characters).not.toContain('H')
  expect(collectGraphFontKeys(graph, [node.id])).toEqual([
    ['Inter', 'Regular'],
    ['Inter', 'SemiBold']
  ])
  expect(node).toEqual(original)
})

test('real Carousel pixels show the selected CJK slide offline with multiline text, navigation and bounded small sizes', async () => {
  const { ck, canvas, renderer, pixels, rgb, save, dispose } = await carouselPixelHarness()
  const shaped: Array<{ text: string; weight: number; lines: number; missing: string[] }> = []
  const originalBuild = renderer.buildParagraph.bind(renderer)
  const build = spyOn(renderer, 'buildParagraph').mockImplementation((node, color, options) => {
    const paragraph = originalBuild(node, color, options)
    shaped.push({
      text: node.text,
      weight: node.fontWeight,
      lines: paragraph.getNumberOfLines(),
      missing: missingGlyphCharacters(node.text, paragraph.getShapedLines())
    })
    return paragraph
  })
  const originalFetch = globalThis.fetch
  const fetchMock = mock(() => Promise.reject(new Error('Carousel canvas must remain offline')))
  globalThis.fetch = fetchMock as typeof fetch
  try {
    const { graph, node } = fixture()
    const original = structuredClone(node)
    canvas.clear(ck.WHITE)
    renderer.renderNode(canvas, graph, node.id, {})
    await save('image')
    const direct = pixels()
    expect(shaped).toContainEqual({ text: slides[1].title, weight: 600, lines: 1, missing: [] })
    expect(shaped).toContainEqual({
      text: slides[1].description,
      weight: 400,
      lines: 2,
      missing: []
    })
    expect(shaped.some((item) => item.text === slides[1].alt && item.missing.length === 0)).toBe(
      true
    )
    expect(shaped.some((item) => item.text === slides[0].title)).toBe(false)
    expect(rgb(direct, 320, 342)).toEqual([96, 165, 250])
    expect(node).toEqual(original)
    const { index } = RenderChunkIndex.build(graph, graph.getPages()[0].id)
    try {
      const chunk = expectDefined(index.getChunksForNode(node.id)[0], 'Carousel chunk')
      const recording = recordRenderChunk(renderer, graph, chunk)
      try {
        canvas.clear(ck.WHITE)
        canvas.drawPicture(recording.picture)
        expect(pixels()).toEqual(direct)
      } finally {
        recording.picture.delete()
      }
    } finally {
      index.dispose()
    }

    for (const [width, height, initialIndex] of [
      [320, 220, 2],
      [120, 160, 1],
      [48, 80, 1],
      [8, 8, 1]
    ] as const) {
      const small = fixture(width, height, initialIndex)
      renderer.clearDocumentCaches()
      shaped.length = 0
      canvas.clear(ck.WHITE)
      renderer.renderNode(canvas, small.graph, small.node.id, {})
      await save(`${width}-${height}`)
      const painted = pixels()
      let escapedInk = 0
      for (let y = 0; y < 400; y++)
        for (let x = 0; x < 680; x++)
          if (x >= width || y >= height)
            escapedInk += rgb(painted, x, y).reduce((sum, value) => sum + 255 - value, 0)
      expect(escapedInk).toBe(0)
      if (initialIndex === 2) {
        expect(
          shaped.some((item) => item.text === slides[2].title && item.missing.length === 0)
        ).toBe(true)
        expect(shaped.some((item) => item.text === slides[1].title)).toBe(false)
        // Without media, the title begins near the top instead of below an empty media block.
        let titleInk = 0
        for (let y = 22; y < 52; y++)
          for (let x = 20; x < 250; x++) if (rgb(painted, x, y)[0] > 80) titleInk++
        expect(titleInk).toBeGreaterThan(80)
      }
    }
    const longDescription = '这是一段较长的中文说明，用于验证轮播图在固定尺寸内自动换行。'.repeat(5)
    const textOnly = fixture(320, 220)
    textOnly.graph.updateNode(textOnly.node.id, {
      interactiveProps: createCarouselModuleFrameOverrides({
        slides: [{ ...slides[1], imageUrl: '', alt: '', description: longDescription }],
        initialIndex: 0
      }).interactiveProps
    })
    renderer.clearDocumentCaches()
    shaped.length = 0
    canvas.clear(ck.WHITE)
    renderer.renderNode(canvas, textOnly.graph, textOnly.node.id, {})
    await save('chinese-text')
    const paragraph = expectDefined(
      shaped.find((item) => item.text === longDescription),
      'Long Chinese paragraph'
    )
    expect(paragraph.lines).toBeGreaterThan(5)
    expect(paragraph.missing).toEqual([])
    const clippedText = pixels()
    let footerGapInk = 0
    const background = [17, 24, 39]
    for (let y = 177; y < 184; y++)
      for (let x = 20; x < 300; x++)
        footerGapInk += rgb(clippedText, x, y).reduce(
          (sum, channel, index) => sum + Math.abs(channel - background[index]),
          0
        )
    expect(footerGapInk).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  } finally {
    globalThis.fetch = originalFetch
    build.mockRestore()
    dispose()
  }
})
