import type { SceneGraph } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { clearDecodedImageCache } from '#core/canvas/renderer/image-cache'

export function invalidateScenePicture(r: SkiaRenderer): void {
  r.scenePicture?.delete()
  r.scenePicture = null
  r.scenePictureVersion = -1
  r.scenePictureFontGeneration = -1
  r.sceneBacking?.image.delete()
  r.sceneBacking = null
  r.sceneBackingBuild?.surface.delete()
  r.sceneBackingBuild = null
}

/**
 * Cancels only the in-progress retained-frame build when the on-screen surface changes.
 *
 * A completed backing image is deliberately kept: it is the only safe frame we can present if
 * the first draw on the replacement surface fails. The next successful scene render will either
 * reuse it or replace it with geometry matching the new viewport.
 */
export function prepareSurfaceReplacement(r: SkiaRenderer): void {
  const build = r.sceneBackingBuild
  r.sceneBackingBuild = null
  try {
    build?.surface.delete()
  } catch (error) {
    console.warn('Retained-frame build cleanup failed during surface replacement', error)
  }
  clearSubtreePictureCache(r)
  r.sceneBackingNeedsCrispRender = !!r.sceneBacking
}

/** Moves ownership of the completed retained frame to a replacement renderer. */
export function transferLastGoodFrame(source: SkiaRenderer, target: SkiaRenderer): boolean {
  const backing = source.sceneBacking
  if (!backing || source.ck !== target.ck) return false

  target.sceneBackingBuild?.surface.delete()
  target.sceneBackingBuild = null
  target.sceneBacking?.image.delete()
  target.sceneBacking = backing
  source.sceneBacking = null

  // Prime the replacement with the presentation state needed to display the transferred image
  // before its first renderFromEditorState call. A failed first render refreshes these values from
  // editor state before recovery, while an immediate handoff can still show the old frame now.
  target.panX = source.panX
  target.panY = source.panY
  target.zoom = source.zoom
  target.dpr = source.dpr
  target.viewportWidth = source.viewportWidth
  target.viewportHeight = source.viewportHeight
  target.pageColor = source.pageColor
  target.pageId = source.pageId
  target.sceneBackingPreviewUntil = source.sceneBackingPreviewUntil
  target.sceneBackingAverageRecordMs = source.sceneBackingAverageRecordMs
  target.sceneBackingAverageViewportIntervalMs = source.sceneBackingAverageViewportIntervalMs
  target.sceneBackingLastViewportEventAt = source.sceneBackingLastViewportEventAt
  target.lastSceneViewport = source.lastSceneViewport ? { ...source.lastSceneViewport } : null
  target.renderCacheGraph = source.renderCacheGraph
  target.renderCachePageId = source.renderCachePageId
  target.sceneBackingNeedsCrispRender = true
  source.sceneBackingNeedsCrispRender = false
  return true
}

export function clearSubtreePictureCache(r: SkiaRenderer): void {
  for (const entry of r.subtreePictureCache.values()) entry.picture.delete()
  r.subtreePictureCache.clear()
  r.subtreePictureCachePageId = null
  r.subtreePictureCacheSceneVersion = -1
  r.subtreePictureCachePositionPreviewVersion = -1
  r.subtreePictureCacheFontGeneration = -1
}

export function invalidateAllPictures(r: SkiaRenderer): void {
  invalidateScenePicture(r)
  clearNodePictureCache(r)
  clearSubtreePictureCache(r)
}

function clearNodePictureCache(r: SkiaRenderer): void {
  for (const pic of r.nodePictureCache.values()) pic?.delete()
  r.nodePictureCache.clear()
  r.nodePictureCacheGenerations.clear()
}

function clearGeometryPathCaches(r: SkiaRenderer): void {
  for (const cache of [
    r.vectorPathCache,
    r.vectorStrokePathCache,
    r.vectorStrokeOutlineCache,
    r.fillGeometryCache,
    r.strokeGeometryCache
  ]) {
    for (const paths of cache.values()) {
      for (const path of paths) path.delete()
    }
    cache.clear()
  }
}

function clearEffectFilterCaches(r: SkiaRenderer): void {
  // A render failure can skip a paired layer cleanup. Detach shared Paint references before
  // deleting Embind wrappers from either the document cache or an isolated export cache.
  r.effectLayerPaint.setImageFilter(null)
  r.auxFill.setImageFilter(null)
  r.auxFill.setMaskFilter(null)
  for (const filter of r.imageFilterCache.values()) filter?.delete()
  r.imageFilterCache.clear()
  for (const filter of r.maskFilterCache.values()) filter?.delete()
  r.maskFilterCache.clear()
}

function clearNodeRenderCaches(r: SkiaRenderer): void {
  clearNodePictureCache(r)
  clearDecodedImageCache(r)
  clearGeometryPathCaches(r)
  clearEffectFilterCaches(r)
  r.textPictureGenerations.clear()
  r.pendingFontNodes.clear()
}

/** Release every native cache whose entries are scoped to a document graph or page. */
export function clearDocumentCaches(r: SkiaRenderer): void {
  // Pictures can retain decoded SkImages, so drop them before their decoded-image wrappers.
  invalidateScenePicture(r)
  clearSubtreePictureCache(r)
  clearNodeRenderCaches(r)
  r.labelCache.invalidate()
  r.renderCacheGraph = null
  r.renderCachePageId = null
}

/**
 * Render a different graph/page without evicting the interactive canvas's warm caches.
 *
 * Offscreen export reuses the renderer for fonts and paints, but its extracted graph can reuse node
 * IDs with different geometry or images. A short-lived cache set keeps that render correct and is
 * released immediately, while the visible page's native resources remain available afterward.
 */
export function withIsolatedDocumentCaches<T>(
  r: SkiaRenderer,
  graph: SceneGraph,
  pageId: string,
  render: () => T
): T {
  const previous = {
    pendingFontNodes: r.pendingFontNodes,
    textPictureGenerations: r.textPictureGenerations,
    imageCache: r.imageCache,
    imageCacheByteSize: r.imageCacheByteSize,
    imageCacheFrameDepth: r.imageCacheFrameDepth,
    imageCacheFrameUsed: r.imageCacheFrameUsed,
    imageFilterCache: r.imageFilterCache,
    maskFilterCache: r.maskFilterCache,
    renderCacheGraph: r.renderCacheGraph,
    renderCachePageId: r.renderCachePageId,
    vectorPathCache: r.vectorPathCache,
    vectorStrokePathCache: r.vectorStrokePathCache,
    vectorStrokeOutlineCache: r.vectorStrokeOutlineCache,
    fillGeometryCache: r.fillGeometryCache,
    strokeGeometryCache: r.strokeGeometryCache,
    nodePictureCache: r.nodePictureCache,
    nodePictureCacheGenerations: r.nodePictureCacheGenerations
  }

  r.pendingFontNodes = new Map()
  r.textPictureGenerations = new Map()
  r.imageCache = new Map()
  r.imageCacheByteSize = 0
  r.imageCacheFrameDepth = 0
  r.imageCacheFrameUsed = new Set()
  r.imageFilterCache = new Map()
  r.maskFilterCache = new Map()
  r.renderCacheGraph = graph
  r.renderCachePageId = pageId
  r.vectorPathCache = new Map()
  r.vectorStrokePathCache = new Map()
  r.vectorStrokeOutlineCache = new Map()
  r.fillGeometryCache = new Map()
  r.strokeGeometryCache = new Map()
  r.nodePictureCache = new Map()
  r.nodePictureCacheGenerations = new Map()

  try {
    return render()
  } finally {
    try {
      clearNodeRenderCaches(r)
    } finally {
      r.pendingFontNodes = previous.pendingFontNodes
      r.textPictureGenerations = previous.textPictureGenerations
      r.imageCache = previous.imageCache
      r.imageCacheByteSize = previous.imageCacheByteSize
      r.imageCacheFrameDepth = previous.imageCacheFrameDepth
      r.imageCacheFrameUsed = previous.imageCacheFrameUsed
      r.imageFilterCache = previous.imageFilterCache
      r.maskFilterCache = previous.maskFilterCache
      r.renderCacheGraph = previous.renderCacheGraph
      r.renderCachePageId = previous.renderCachePageId
      r.vectorPathCache = previous.vectorPathCache
      r.vectorStrokePathCache = previous.vectorStrokePathCache
      r.vectorStrokeOutlineCache = previous.vectorStrokeOutlineCache
      r.fillGeometryCache = previous.fillGeometryCache
      r.strokeGeometryCache = previous.strokeGeometryCache
      r.nodePictureCache = previous.nodePictureCache
      r.nodePictureCacheGenerations = previous.nodePictureCacheGenerations
    }
  }
}

export function invalidateNodePicture(r: SkiaRenderer, nodeId: string): void {
  const pic = r.nodePictureCache.get(nodeId)
  if (pic) {
    pic.delete()
    r.nodePictureCache.delete(nodeId)
    r.nodePictureCacheGenerations.delete(nodeId)
  }
  const subtree = r.subtreePictureCache.get(nodeId)
  if (subtree) {
    subtree.picture.delete()
    r.subtreePictureCache.delete(nodeId)
  }
}

export function flashNode(r: SkiaRenderer, nodeId: string): void {
  r._flashes.push({ nodeId, startTime: performance.now() })
}

export function aiMarkActive(r: SkiaRenderer, nodeIds: string[]): void {
  for (const id of nodeIds) r._aiActiveNodes.add(id)
}

export function aiMarkDone(r: SkiaRenderer, nodeIds: string[]): void {
  const now = performance.now()
  for (const id of nodeIds) {
    if (r._aiActiveNodes.delete(id)) {
      r._aiDoneFlashes.push({ nodeId: id, startTime: now })
    }
  }
}

export function aiFlashDone(r: SkiaRenderer, nodeIds: string[]): void {
  const now = performance.now()
  for (const id of nodeIds) {
    r._aiDoneFlashes.push({ nodeId: id, startTime: now })
  }
}

export function aiClearActive(r: SkiaRenderer): void {
  r._aiActiveNodes.clear()
}

export function aiClearAll(r: SkiaRenderer): void {
  r._aiActiveNodes.clear()
  r._aiDoneFlashes = []
}

export function hasActiveFlashes(r: SkiaRenderer): boolean {
  return r._flashes.length > 0 || r._aiActiveNodes.size > 0 || r._aiDoneFlashes.length > 0
}
