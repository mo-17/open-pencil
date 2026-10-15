import type { SkiaRenderer } from '#core/canvas/renderer'
import { clearDocumentCaches } from '#core/canvas/renderer/state'
import { fontManager } from '#core/text/fonts'

function clearGlyphSilhouetteCache(r: SkiaRenderer): void {
  r.glyphSilhouetteCache.clear()
  r.derivedGlyphPathCache.clear()
}

/** Frees every live image `r`'s surface holds and forgets those an earlier surface held. */
export function releaseLiveImages(r: Pick<SkiaRenderer, 'liveImages' | 'surface'>): void {
  for (const { image, surface } of r.liveImages.values()) {
    if (surface === r.surface) image.delete()
  }
  r.liveImages.clear()
}

export function destroyRenderer(r: SkiaRenderer): void {
  if (r.destroyed) return
  r.destroyed = true
  r.transientPreviews.clear()

  r.onImagePreviewReady = null
  r.imagePreviews.destroy()
  releaseLiveImages(r)
  clearDocumentCaches(r)
  clearGlyphSilhouetteCache(r)
  r.fillPaint.delete()
  r.diamondGradientEffect?.delete()
  r.diamondGradientEffect = null
  r.pixelGridEffect?.delete()
  r.pixelGridEffect = null
  r.strokePaint.delete()
  r.selectionPaint.delete()
  r.parentOutlinePaint.delete()
  r.snapPaint.delete()
  r.auxFill.delete()
  r.auxStroke.delete()
  r.opacityPaint.delete()
  r.textFont?.delete()
  r.labelFont?.delete()
  r.sizeFont?.delete()
  r.valueFont?.delete()
  r.sectionTitleFont?.delete()
  r.componentLabelFont?.delete()
  r.fontMgr?.delete()
  const fontProvider = r.fontProvider
  fontProvider?.delete()
  r.fontProvider = null
  r.fontsLoaded = false
  fontManager.detachProvider(fontProvider)
  r.rulerBgPaint.delete()
  r.rulerTickPaint.delete()
  r.rulerTextPaint.delete()
  r.rulerHlPaint.delete()
  r.rulerBadgePaint.delete()
  r.rulerLabelPaint.delete()
  r.penPathPaint.delete()
  r.penLiveStrokePaint.delete()
  r.pencilStrokePaint.delete()
  r.penHandlePaint.delete()
  r.penVertexFill.delete()
  r.penVertexStroke.delete()
  r.effectLayerPaint.delete()
  r.generatedEffectPaint.delete()
  r.labelParagraphCache.clear()
  r.tiledScene.destroy()
  r._flashPaint?.delete()
  r.profiler.destroy()
  r.surface.delete()
}
