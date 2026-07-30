import type { SkiaRenderer } from '#core/canvas/renderer'

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
  for (const pic of r.nodePictureCache.values()) pic?.delete()
  r.nodePictureCache.clear()
  r.nodePictureCacheGenerations.clear()
  clearSubtreePictureCache(r)
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
