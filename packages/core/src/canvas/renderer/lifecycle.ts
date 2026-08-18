import type { SkiaRenderer } from '#core/canvas/renderer'
import { clearDocumentCaches } from '#core/canvas/renderer/state'
import { fontManager } from '#core/text/fonts'

function clearGlyphSilhouetteCache(r: SkiaRenderer): void {
  // glyphSilhouetteCache maps to a single Path per entry (not an array).
  for (const path of r.glyphSilhouetteCache.values()) path.delete()
  r.glyphSilhouetteCache.clear()
}

export function destroyRenderer(r: SkiaRenderer): void {
  if (r.destroyed) return
  r.destroyed = true

  clearDocumentCaches(r)
  clearGlyphSilhouetteCache(r)
  r.fillPaint.delete()
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
  r.penHandlePaint.delete()
  r.penVertexFill.delete()
  r.penVertexStroke.delete()
  r.effectLayerPaint.delete()
  r.generatedEffectPaint.delete()
  r._flashPaint?.delete()
  r.profiler.destroy()
  r.surface.delete()
}
