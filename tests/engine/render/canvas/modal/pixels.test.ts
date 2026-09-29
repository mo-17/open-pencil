import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { initCanvasKit } from '#cli/headless'
import { SkiaRenderer } from '#core/canvas/renderer'
import { recordRenderChunk, RenderChunkIndex } from '#core/canvas/renderer/chunks'
import { createModalModuleFrameOverrides } from '#core/plugins/modal'
import { fontManager } from '#core/text/fonts'
import { missingGlyphCharacters } from '#core/text/resolver'

import { expectDefined } from '#tests/helpers/assert'
import { repoPath } from '#tests/helpers/paths'

test('real Modal trigger shapes Chinese, hides mapped and unmapped content, and matches retained output', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const modal = graph.createNode('FRAME', page.id, {
    ...createModalModuleFrameOverrides({ triggerLabel: '编辑资料 Edit', contentChildName: 'Body' }),
    width: 320,
    height: 52,
    x: 20,
    y: 20,
    textLanguage: 'zh-CN',
    clipsContent: false
  })
  const body = graph.createNode('FORM', modal.id, { name: 'Body', width: 320, height: 300 })
  graph.createNode('TEXT', body.id, { text: '姓名', width: 320, height: 40 })
  graph.createNode('RECTANGLE', modal.id, {
    name: 'Unmapped',
    y: 80,
    width: 100,
    height: 100,
    fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
  })
  const ck = await initCanvasKit()
  const surface = expectDefined(ck.MakeSurface(360, 220), 'Modal surface')
  const renderer = new SkiaRenderer(ck, surface)
  const provider = ck.TypefaceFontProvider.Make()
  const previousFallbacks = [...fontManager.getCJKFallbackFamilies()]
  fontManager.attachProvider(ck, provider)
  fontManager.markLoaded(
    'Inter',
    'Regular',
    await Bun.file(repoPath('packages/core/assets/Inter-Regular.ttf')).arrayBuffer()
  )
  fontManager.markLoaded(
    'Noto Sans SC',
    'Regular',
    await Bun.file(repoPath('tests/fixtures/fonts/NotoSansSC-Regular.ttf')).arrayBuffer()
  )
  fontManager.setCJKFallbackFamily('Noto Sans SC')
  renderer.fontProvider = provider
  renderer.fontsLoaded = true
  renderer.worldViewport = { x: 0, y: 0, w: 360, h: 220 }
  const nativeBuild = renderer.buildParagraph.bind(renderer)
  const labels: Array<{ text: string; missing: string[] }> = []
  const build = spyOn(renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    const paragraph = nativeBuild(label, color, options)
    labels.push({
      text: label.text,
      missing: missingGlyphCharacters(label.text, paragraph.getShapedLines())
    })
    return paragraph
  })
  const canvas = surface.getCanvas()
  const snapshot = () => {
    const image = surface.makeImageSnapshot()
    try {
      return {
        png: expectDefined(image.encodeToBytes(), 'Modal PNG'),
        pixels: expectDefined(
          image.readPixels(0, 0, {
            width: 360,
            height: 220,
            colorType: ck.ColorType.RGBA_8888,
            alphaType: ck.AlphaType.Unpremul,
            colorSpace: ck.ColorSpace.SRGB
          }),
          'Modal pixels'
        )
      }
    } finally {
      image.delete()
    }
  }
  try {
    canvas.clear(ck.WHITE)
    renderer.renderNode(canvas, graph, modal.id, {})
    const direct = snapshot()
    const evidence = process.env.OPENPENCIL_MODAL_EVIDENCE
    if (evidence) await Bun.write(`${evidence}.png`, direct.png)
    expect(labels).toContainEqual({ text: '编辑资料 Edit', missing: [] })
    expect(labels.some(({ text }) => text === '姓名')).toBe(false)
    let outsideInk = 0
    for (let y = 73; y < 220; y++)
      for (let x = 0; x < 360; x++) outsideInk += 255 - direct.pixels[(y * 360 + x) * 4 + 1]
    expect(outsideInk).toBe(0)
    const { index } = RenderChunkIndex.build(graph, page.id)
    try {
      const chunk = expectDefined(index.getChunksForNode(modal.id)[0], 'Modal chunk')
      const recorded = recordRenderChunk(renderer, graph, chunk)
      try {
        canvas.clear(ck.WHITE)
        canvas.drawPicture(recorded.picture)
        expect(snapshot().pixels).toEqual(direct.pixels)
      } finally {
        recorded.picture.delete()
      }
    } finally {
      index.dispose()
    }
    graph.updateNode(modal.id, {
      ...createModalModuleFrameOverrides({
        triggerLabel: '重新编辑 Updated',
        contentChildName: 'Missing'
      }),
      width: 320,
      height: 52
    })
    renderer.invalidateNodePicture(modal.id)
    canvas.clear(ck.WHITE)
    renderer.renderNode(canvas, graph, modal.id, {})
    expect(labels).toContainEqual({ text: '重新编辑 Updated', missing: [] })
    expect(snapshot().pixels).not.toEqual(direct.pixels)
    expect(body.visible).toBe(true)
    graph.updateNode(modal.id, {
      fills: [{ type: 'SOLID', color: { r: 0, g: 0.6, b: 0.3, a: 1 }, opacity: 1, visible: true }]
    })
    renderer.invalidateNodePicture(modal.id)
    canvas.clear(ck.WHITE)
    renderer.renderNode(canvas, graph, modal.id, {})
    const recolored = snapshot().pixels
    expect(Array.from(recolored.slice((30 * 360 + 35) * 4, (30 * 360 + 35) * 4 + 4))).toEqual([
      0, 153, 77, 255
    ])
  } finally {
    build.mockRestore()
    fontManager.getCJKFallbackFamilies().splice(0, Infinity, ...previousFallbacks)
    renderer.destroy()
  }
})
