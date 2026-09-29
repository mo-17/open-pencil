import { initCanvasKit } from '#cli/headless'
import { SkiaRenderer } from '#core/canvas/renderer'
import { fontManager } from '#core/text/fonts'

import { expectDefined } from '#tests/helpers/assert'
import { repoPath } from '#tests/helpers/paths'

export async function carouselPixelHarness() {
  const ck = await initCanvasKit()
  const surface = expectDefined(ck.MakeSurface(680, 400), 'Carousel surface')
  const renderer = new SkiaRenderer(ck, surface)
  const provider = ck.TypefaceFontProvider.Make()
  const previousFallbacks = [...fontManager.getCJKFallbackFamilies()]
  const regular = await Bun.file(repoPath('packages/core/assets/Inter-Regular.ttf')).arrayBuffer()
  const semibold = await Bun.file(repoPath('packages/core/assets/Inter-SemiBold.ttf')).arrayBuffer()
  const cjk = await Bun.file(repoPath('tests/fixtures/fonts/NotoSansSC-Regular.ttf')).arrayBuffer()
  fontManager.attachProvider(ck, provider)
  fontManager.markLoaded('Inter', 'Regular', regular)
  fontManager.markLoaded('Inter', 'SemiBold', semibold)
  fontManager.markLoaded('Noto Sans SC', 'Regular', cjk)
  fontManager.setCJKFallbackFamily('Noto Sans SC')
  const typeface = expectDefined(ck.Typeface.MakeFreeTypeFaceFromData(regular), 'Carousel font')
  renderer.labelFont = new ck.Font(typeface, 11)
  renderer.fontProvider = provider
  renderer.fontsLoaded = true
  renderer.worldViewport = { x: 0, y: 0, w: 680, h: 400 }
  const canvas = surface.getCanvas()
  const pixels = () => {
    const image = surface.makeImageSnapshot()
    try {
      return expectDefined(
        image.readPixels(0, 0, {
          width: 680,
          height: 400,
          colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Unpremul,
          colorSpace: ck.ColorSpace.SRGB
        }),
        'Carousel pixels'
      )
    } finally {
      image.delete()
    }
  }
  const rgb = (data: Uint8Array | Float32Array, x: number, y: number) =>
    Array.from(data.slice((y * 680 + x) * 4, (y * 680 + x) * 4 + 3))
  const save = async (suffix: string) => {
    const prefix = process.env.OPENPENCIL_CAROUSEL_EVIDENCE
    if (!prefix) return
    const image = surface.makeImageSnapshot()
    try {
      await Bun.write(
        `${prefix}-${suffix}.png`,
        expectDefined(image.encodeToBytes(), 'Carousel PNG')
      )
    } finally {
      image.delete()
    }
  }
  return {
    ck,
    canvas,
    renderer,
    pixels,
    rgb,
    save,
    dispose() {
      fontManager.getCJKFallbackFamilies().splice(0, Infinity, ...previousFallbacks)
      renderer.destroy()
      typeface.delete()
    }
  }
}
