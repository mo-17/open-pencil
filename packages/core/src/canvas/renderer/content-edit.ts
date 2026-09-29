import type { Canvas } from 'canvaskit-wasm'

import type { SceneGraph } from '@open-pencil/scene-graph'

import type { RenderOverlays, SkiaRenderer } from '#core/canvas/renderer'
import { createSceneGeometry } from '#core/geometry/scene'

const contentCacheScopes = new WeakMap<SkiaRenderer, string | undefined>()

export function prepareContentEditCache(r: SkiaRenderer, rootId: string | undefined) {
  if (contentCacheScopes.get(r) === rootId) return
  r.clearDocumentCaches()
  contentCacheScopes.set(r, rootId)
}

/** Keep world coordinates intact while omitting the trigger and the rest of the page. */
export function renderContentEditRoot(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  overlays: RenderOverlays
): boolean {
  if (!overlays.contentRootId) return false
  const root = graph.getNode(overlays.contentRootId)
  if (!root) return true
  const parent = root.parentId ? graph.getNode(root.parentId) : undefined
  canvas.save()
  try {
    if (parent)
      canvas.concat(createSceneGeometry(graph, overlays.rotationPreview).worldMatrix(parent))
    // The transformed-ancestor path culls every descendant with its authored world bounds.
    r.renderNode(canvas, graph, root.id, overlays, 0, 0, true)
  } finally {
    canvas.restore()
  }
  return true
}
