import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { initCanvasKit } from '#cli/headless'
import { SkiaRenderer } from '#core/canvas/renderer'
import { recordRenderChunk, RenderChunkIndex } from '#core/canvas/renderer/chunks'
import { tabsPreviewGeometry } from '#core/plugins/content/tabs'
import { createTabsModuleFrameOverrides, resolveTabsModule } from '#core/plugins/tabs'
import { fontManager } from '#core/text/fonts'
import { collectGraphFontKeys, collectGraphFontRequirements } from '#core/text/requirements'
import { missingGlyphCharacters } from '#core/text/resolver'

import { expectDefined } from '#tests/helpers/assert'
import { repoPath } from '#tests/helpers/paths'

function fixture(orientation: 'horizontal' | 'vertical' = 'horizontal', width = 320, height = 160) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const node = graph.createNode('FRAME', page.id, {
    ...createTabsModuleFrameOverrides({
      orientation,
      tabs: [
        { id: 'one', label: '概览', content: '正文内容 Body' },
        { id: 'two', label: 'Details 详情', content: 'Inactive' }
      ],
      initialTabId: 'one'
    }),
    width,
    height,
    textLanguage: 'zh-CN',
    strokes: []
  })
  return { graph, page, node }
}

test('Tabs font preflight includes semibold headers and regular inline content without mutating the host', () => {
  const { graph, node } = fixture()
  const original = structuredClone(node)
  const requirements = collectGraphFontRequirements(graph, [node.id])
  expect(requirements.scripts).toContain('cjk-sc')
  for (const character of '概览详情正文内容') expect(requirements.characters).toContain(character)
  expect(requirements.characters).not.toContain('I')
  expect(collectGraphFontKeys(graph, [node.id])).toEqual([
    ['Inter', 'Regular'],
    ['Inter', 'SemiBold']
  ])
  expect(node).toEqual(original)
})

test('real Tabs headers use compact padded selected buttons, shaped Chinese labels, and bounded overflow', async () => {
  const ck = await initCanvasKit()
  const surface = expectDefined(ck.MakeSurface(360, 200), 'Tabs surface')
  const renderer = new SkiaRenderer(ck, surface)
  const provider = ck.TypefaceFontProvider.Make()
  const previousFallbacks = [...fontManager.getCJKFallbackFamilies()]
  const inter = await Bun.file(repoPath('packages/core/assets/Inter-Regular.ttf')).arrayBuffer()
  const semibold = await Bun.file(repoPath('packages/core/assets/Inter-SemiBold.ttf')).arrayBuffer()
  const cjk = await Bun.file(repoPath('tests/fixtures/fonts/NotoSansSC-Regular.ttf')).arrayBuffer()
  fontManager.attachProvider(ck, provider)
  fontManager.markLoaded('Inter', 'Regular', inter)
  fontManager.markLoaded('Inter', 'SemiBold', semibold)
  fontManager.markLoaded('Noto Sans SC', 'Regular', cjk)
  fontManager.setCJKFallbackFamily('Noto Sans SC')
  const typeface = expectDefined(ck.Typeface.MakeFreeTypeFaceFromData(inter), 'Tabs Inter')
  renderer.labelFont = new ck.Font(typeface, 11)
  renderer.fontProvider = provider
  renderer.fontsLoaded = true
  renderer.worldViewport = { x: 0, y: 0, w: 360, h: 200 }
  const canvas = surface.getCanvas()
  const shaped: Array<{ text: string; weight: number; missing: string[] }> = []
  const nativeBuild = renderer.buildParagraph.bind(renderer)
  const build = spyOn(renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    const paragraph = nativeBuild(label, color, options)
    shaped.push({
      text: label.text,
      weight: label.fontWeight,
      missing: missingGlyphCharacters(label.text, paragraph.getShapedLines())
    })
    return paragraph
  })
  const pixels = () => {
    const image = surface.makeImageSnapshot()
    try {
      return expectDefined(
        image.readPixels(0, 0, {
          width: 360,
          height: 200,
          colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Unpremul,
          colorSpace: ck.ColorSpace.SRGB
        }),
        'Tabs pixels'
      )
    } finally {
      image.delete()
    }
  }
  const rgb = (data: Uint8Array | Float32Array, x: number, y: number) =>
    Array.from(data.slice((y * 360 + x) * 4, (y * 360 + x) * 4 + 3))
  try {
    const { graph, page, node } = fixture()
    const original = structuredClone(node)
    canvas.clear(ck.WHITE)
    renderer.renderNode(canvas, graph, node.id, {})
    const direct = pixels()
    const prefix = process.env.OPENPENCIL_TABS_HEADER_EVIDENCE
    if (prefix) {
      const snapshot = surface.makeImageSnapshot()
      try {
        await Bun.write(`${prefix}.png`, expectDefined(snapshot.encodeToBytes(), 'Tabs PNG'))
      } finally {
        snapshot.delete()
      }
    }
    expect(rgb(direct, 16, 12)).toEqual([37, 99, 235])
    expect(rgb(direct, 4, 12)).toEqual([255, 255, 255])
    expect(rgb(direct, 150, 12)).toEqual([255, 255, 255])
    const resolved = resolveTabsModule(node.interactiveProps?.module)
    if (!resolved?.ok) throw new Error('Invalid Tabs fixture')
    const { header } = tabsPreviewGeometry(node, resolved.config)
    // The divider uses the accent at 0x55 alpha over the white panel, not an opaque blue rule.
    expect(rgb(direct, 160, header.height - 1)).toEqual([182, 203, 248])
    expect(rgb(direct, 160, header.height - 2)).toEqual([255, 255, 255])
    let lightLabelPixels = 0
    for (let y = 17; y < 33; y++)
      for (let x = 20; x < 48; x++) {
        if (rgb(direct, x, y).every((channel) => channel > 220)) lightLabelPixels++
      }
    expect(lightLabelPixels).toBeGreaterThan(25)
    expect(shaped).toContainEqual({ text: '概览', weight: 600, missing: [] })
    expect(shaped).toContainEqual({ text: 'Details 详情', weight: 600, missing: [] })
    expect(shaped).toContainEqual({ text: '正文内容 Body', weight: 400, missing: [] })
    expect(node).toEqual(original)
    const { index } = RenderChunkIndex.build(graph, page.id)
    try {
      const chunk = expectDefined(index.getChunksForNode(node.id)[0], 'Tabs chunk')
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
    graph.updateNode(node.id, { opacity: 0.4 })
    canvas.clear(ck.WHITE)
    renderer.renderNode(canvas, graph, node.id, {})
    const faded = rgb(pixels(), 16, 12)
    expect(faded[0]).toBeGreaterThan(150)
    expect(faded[0]).toBeLessThan(190)
    for (const [orientation, width, height] of [
      ['vertical', 260, 160],
      ['vertical', 320, 160],
      ['horizontal', 52, 90],
      ['vertical', 20, 60],
      ['horizontal', 8, 8]
    ] as const) {
      const small = fixture(orientation, width, height)
      renderer.clearDocumentCaches()
      canvas.clear(ck.WHITE)
      renderer.renderNode(canvas, small.graph, small.node.id, {})
      const painted = pixels()
      const headerWidth = Math.min(width * 0.42, Math.max(112, width * 0.3))
      let escapedInk = 0
      for (let y = 0; y < 200; y++)
        for (let x = 0; x < 360; x++) {
          if (x >= width || y >= height)
            escapedInk += rgb(painted, x, y).reduce((sum, channel) => sum + 255 - channel, 0)
        }
      expect(escapedInk).toBe(0)
      if (orientation === 'vertical' && width === 260) {
        expect(rgb(painted, 16, 12)).toEqual([37, 99, 235])
        expect(rgb(painted, Math.ceil(headerWidth) + 4, 12)).toEqual([255, 255, 255])
      }
      if (orientation === 'vertical' && width === 320) {
        expect(rgb(painted, headerWidth - 1, 140)).toEqual([182, 203, 248])
        expect(rgb(painted, headerWidth, 140)).toEqual([255, 255, 255])
      }
      if (prefix) {
        const snapshot = surface.makeImageSnapshot()
        try {
          await Bun.write(
            `${prefix}-${orientation}-${width}.png`,
            expectDefined(snapshot.encodeToBytes(), 'Tabs variant PNG')
          )
        } finally {
          snapshot.delete()
        }
      }
    }
  } finally {
    build.mockRestore()
    fontManager.getCJKFallbackFamilies().splice(0, Infinity, ...previousFallbacks)
    renderer.destroy()
    typeface.delete()
  }
})
