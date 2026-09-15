import { expect, spyOn, test } from 'bun:test'

import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { initCanvasKit } from '#cli/headless'
import { drawVRTourLabel, vrTourLabelTextNode } from '#core/canvas/modules/vr-tour-label'
import { SkiaRenderer } from '#core/canvas/renderer'
import { fontManager } from '#core/text/fonts'
import { missingGlyphCharacters } from '#core/text/resolver'

import { expectDefined } from '#tests/helpers/assert'
import { repoPath } from '#tests/helpers/paths'

test('transient VR text shares the host ID without mutating the graph or retaining glyph caches', () => {
  const host = createDefaultNode(() => 'actual-module', 'FRAME', { name: 'VR module' })
  const label = vrTourLabelTextNode(host, '用户房间', 180, 14, 'zh-CN')
  expect(label).toMatchObject({
    id: host.id,
    type: 'TEXT',
    text: '用户房间',
    textLanguage: 'zh-CN',
    width: 180,
    fontSize: 14,
    fontFamily: 'Inter',
    fontWeight: 400,
    maxLines: 1,
    textTruncation: 'ENDING',
    textAutoResize: 'NONE',
    childIds: [],
    textPicture: null,
    derivedTextGlyphs: null,
    textPathData: null,
    textPathBox: null
  })
  expect(host.type).toBe('FRAME')
  expect(host.text).toBe('')
  expect(vrTourLabelTextNode(host, '另一标签', 80, 12).id).toBe(host.id)
})

test('VR Chinese labels shape real CJK glyphs with the existing offline Noto fallback', async () => {
  const ck = await initCanvasKit()
  const provider = ck.TypefaceFontProvider.Make()
  fontManager.attachProvider(ck, provider)
  const inter = await Bun.file(repoPath('packages/core/assets/Inter-Regular.ttf')).arrayBuffer()
  const noto = await Bun.file(repoPath('tests/fixtures/fonts/NotoSansSC-Regular.ttf')).arrayBuffer()
  const previousFallbacks = [...fontManager.getCJKFallbackFamilies()]
  fontManager.markLoaded('Inter', 'Regular', inter)
  fontManager.markLoaded('Noto Sans SC', 'Regular', noto)
  fontManager.setCJKFallbackFamily('Noto Sans SC')
  const surface = expectDefined(ck.MakeSurface(320, 48), 'VR label surface')
  const renderer = new SkiaRenderer(ck, surface)
  const typeface = expectDefined(ck.Typeface.MakeFreeTypeFaceFromData(inter), 'Inter typeface')
  renderer.labelFont = new ck.Font(typeface, 20)
  renderer.fontProvider = provider
  renderer.fontsLoaded = true
  const canvas = surface.getCanvas()
  const text = '客厅 · 360° · 2 个场景'
  expect(Array.from(renderer.labelFont.getGlyphIDs(text))).toContain(0)
  const nativeDraw = canvas.drawParagraph.bind(canvas)
  const missing: string[][] = []
  const draw = spyOn(canvas, 'drawParagraph').mockImplementation((paragraph, x, y) => {
    missing.push(missingGlyphCharacters(text, paragraph.getShapedLines()))
    nativeDraw(paragraph, x, y)
  })
  try {
    canvas.clear(ck.WHITE)
    drawVRTourLabel(
      renderer,
      canvas,
      createDefaultNode(() => 'vr-label-host', 'FRAME'),
      {
        text,
        x: 4,
        baseline: 30,
        maxWidth: 300,
        color: '#000000',
        locale: 'zh-CN'
      }
    )
    surface.flush()
    expect(missing).toEqual([[]])
    const image = surface.makeImageSnapshot()
    try {
      const pixels = expectDefined(
        image.readPixels(0, 0, {
          width: 320,
          height: 48,
          colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Unpremul,
          colorSpace: ck.ColorSpace.SRGB
        }),
        'VR label pixels'
      )
      let ink = 0
      for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 100) ink++
      expect(ink).toBeGreaterThan(150)
    } finally {
      image.delete()
    }
    expect(renderer.pendingFontNodes.size).toBe(0)
    expect(renderer.nodePictureCache.size).toBe(0)
  } finally {
    draw.mockRestore()
    fontManager.getCJKFallbackFamilies().splice(0, Infinity, ...previousFallbacks)
    renderer.destroy()
    typeface.delete()
  }
})
