import type { Canvas } from 'canvaskit-wasm'

import type { SceneGraph } from '@open-pencil/scene-graph'
import { computeDescendantVisualBounds } from '@open-pencil/scene-graph/geometry'

import { drawPageGuides } from '#core/canvas/page-guides'
import type { RenderOverlays, SkiaRenderer } from '#core/canvas/renderer'
import type { EditorState } from '#core/editor/types'
import { computeMotionLayoutPreview } from '#core/layout'
import { graphHasAnimatedGeneratedEffects } from '#core/motion'

import { beginDecodedImageCacheFrame, endDecodedImageCacheFrame } from './image-cache'
import {
  drawLastGoodSceneBacking,
  renderSceneBacking,
  updateSceneBackingPreviewState
} from './retained-backing'
import { withIsolatedDocumentCaches } from './state'

function renderChildrenWithMotionLayout(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  childIds: readonly string[],
  overlays: RenderOverlays
): void {
  const motionLayoutNodes = computeMotionLayoutPreview(graph, overlays.motionVisualStates)
  const effectiveOverlays =
    motionLayoutNodes.size > 0 ? { ...overlays, motionLayoutNodes } : overlays
  for (const childId of childIds) {
    r.renderNode(canvas, graph, childId, effectiveOverlays)
  }
}

export function renderSceneToCanvas(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  pageId: string,
  overlays: RenderOverlays = {}
): void {
  const scopeDiffers =
    r.renderCacheGraph !== null && (r.renderCacheGraph !== graph || r.renderCachePageId !== pageId)
  if (scopeDiffers) {
    withIsolatedDocumentCaches(r, graph, pageId, () => {
      renderSceneToCanvasInCurrentScope(r, canvas, graph, pageId, overlays)
    })
    return
  }

  prepareRenderCacheScope(r, graph, pageId)
  renderSceneToCanvasInCurrentScope(r, canvas, graph, pageId, overlays)
}

function renderSceneToCanvasInCurrentScope(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  pageId: string,
  overlays: RenderOverlays
): void {
  beginDecodedImageCacheFrame(r)
  const prevViewport = r.worldViewport
  r.worldViewport = { x: -1e9, y: -1e9, w: 2e9, h: 2e9 }
  let completed = false
  try {
    const pageNode = graph.getNode(pageId)
    if (pageNode) {
      renderChildrenWithMotionLayout(r, canvas, graph, pageNode.childIds, overlays)
    }
    completed = true
  } finally {
    r.worldViewport = prevViewport
    endDecodedImageCacheFrame(r, completed)
  }
}

export type RenderLayer = 'full' | 'scene' | 'overlays'

export function renderFromEditorState(
  r: SkiaRenderer,
  state: EditorState,
  graph: SceneGraph,
  textEditor: unknown,
  viewportWidth: number,
  viewportHeight: number,
  showRulers = true,
  dpr = 1,
  layer: RenderLayer = 'full'
): void {
  const reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const generatedEffectsAnimate = graphHasAnimatedGeneratedEffects(graph, {
    pageId: state.currentPageId,
    prefersReducedMotion: reducedMotion
  })
  r.dpr = dpr
  r.panX = state.panX
  r.panY = state.panY
  r.zoom = state.zoom
  r.viewportWidth = viewportWidth
  r.viewportHeight = viewportHeight
  r.showRulers = showRulers
  r.pageColor = state.pageColor
  r.rulerTheme = state.rulerTheme ?? null
  r.pageId = state.currentPageId
  render(
    r,
    graph,
    state.selectedIds,
    {
      motionVisualStates: state.motionPreview?.visuals,
      ...(generatedEffectsAnimate ? { generatedEffectTimeMs: now() } : {}),
      generatedEffectMode: reducedMotion ? 'reduce' : 'allow',
      hoveredNodeId: state.hoveredNodeId,
      enteredContainerId: state.enteredContainerId,
      editingTextId: state.editingTextId,
      textEditor: textEditor as RenderOverlays['textEditor'],
      marquee: state.marquee,
      snapGuides: state.snapGuides,
      rotationPreview: state.rotationPreview,
      dropTargetId: state.dropTargetId,
      layoutInsertIndicator: state.layoutInsertIndicator,
      penState: state.penState
        ? ({
            ...state.penState,
            cursorX: state.penCursorX ?? undefined,
            cursorY: state.penCursorY ?? undefined
          } as RenderOverlays['penState'])
        : null,
      nodeEditState: state.nodeEditState ?? null,
      remoteCursors: state.remoteCursors,
      autoLayoutHover: state.autoLayoutHover
    },
    state.sceneVersion,
    layer
  )
}

export function hasVolatileOverlay(overlays: RenderOverlays): boolean {
  return (
    (overlays.motionVisualStates?.size ?? 0) > 0 ||
    overlays.generatedEffectTimeMs !== undefined ||
    overlays.dropTargetId != null ||
    overlays.rotationPreview != null ||
    overlays.editingTextId != null ||
    overlays.nodeEditState != null
  )
}

function scenePictureMissReason(
  r: SkiaRenderer,
  graph: SceneGraph,
  overlays: RenderOverlays,
  sceneVersion: number,
  hasPositionPreview: boolean
): string {
  if (hasPositionPreview) return 'position-preview'
  if (hasVolatileOverlay(overlays)) return 'volatile-overlay'
  if (!r.scenePicture) return 'missing-picture'
  if (graph.positionPreviewVersion !== r.scenePicturePositionPreviewVersion)
    return 'position-preview-version'
  if (sceneVersion !== r.scenePictureVersion) return 'scene-version'
  if (r.fontGeneration !== r.scenePictureFontGeneration) return 'font-generation'
  if (r.pageId !== r.scenePicturePageId) return 'page'
  return 'unknown'
}

function canUseScenePicture(
  r: SkiaRenderer,
  graph: SceneGraph,
  sceneVersion: number,
  hasVolatileOverlays: boolean
): boolean {
  return (
    !hasVolatileOverlays &&
    !!r.scenePicture &&
    graph.positionPreviewVersion === r.scenePicturePositionPreviewVersion &&
    sceneVersion === r.scenePictureVersion &&
    r.fontGeneration === r.scenePictureFontGeneration &&
    r.pageId === r.scenePicturePageId
  )
}

const now = typeof performance !== 'undefined' ? () => performance.now() : () => 0

function measure<T>(fn: () => T): { value: T; duration: number } {
  const start = now()
  const value = fn()
  return { value, duration: now() - start }
}

function prepareRenderCacheScope(r: SkiaRenderer, graph: SceneGraph, pageId = r.pageId): void {
  const previousGraph = r.renderCacheGraph
  const scopeChanged =
    previousGraph !== null && (previousGraph !== graph || r.renderCachePageId !== pageId)
  if (scopeChanged) {
    // A previous page's pictures can retain native SkImage references after the decoded-image
    // LRU drops its JS wrappers. They cannot be used to recover a different page, so release both
    // layers of caching before the new page starts decoding.
    r.clearDocumentCaches()
  }
  r.renderCacheGraph = graph
  r.renderCachePageId = pageId
}

function renderSceneLayer(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  overlays: RenderOverlays,
  sceneVersion: number,
  layer: RenderLayer,
  hasVolatileOverlays: boolean,
  canUsePicture: boolean,
  cacheMissReason: string
): void {
  const drewSceneBacking =
    layer === 'scene' && !hasVolatileOverlays && renderSceneBacking(r, canvas, graph, sceneVersion)
  if (drewSceneBacking) {
    r.profiler.setScenePictureMode('hit', 'backing')
    return
  }

  canvas.translate(r.panX, r.panY)
  canvas.scale(r.zoom, r.zoom)
  if (layer === 'scene') {
    renderLiveSceneContent(
      r,
      canvas,
      graph,
      overlays,
      hasVolatileOverlays ? cacheMissReason : 'backing-unavailable'
    )
    return
  }

  renderSceneContent(
    r,
    canvas,
    graph,
    overlays,
    sceneVersion,
    canUsePicture,
    cacheMissReason,
    hasVolatileOverlays
  )
}

export function render(
  r: SkiaRenderer,
  graph: SceneGraph,
  selectedIds: Set<string>,
  overlays: RenderOverlays = {},
  sceneVersion = -1,
  layer: RenderLayer = 'full'
): void {
  prepareRenderCacheScope(r, graph)
  r.syncFontGeneration()
  const p = r.profiler
  p.beginFrame()
  p.setScenePictureDrawTime(0)
  p.setScenePictureRecordTime(0)
  p.setFlushTime(0)

  let recoveryCanvas: Canvas | null = null
  let initialSaveCount = 0
  let frameEnded = false
  let surfaceFlushed = false
  beginDecodedImageCacheFrame(r)
  try {
    graph.clearAbsPosCache()

    const canvas = r.surface.getCanvas()
    recoveryCanvas = canvas
    initialSaveCount = canvas.getSaveCount()
    if (layer === 'overlays') {
      canvas.clear(r.ck.Color4f(0, 0, 0, 0))
    } else {
      canvas.clear(r.ck.Color4f(r.pageColor.r, r.pageColor.g, r.pageColor.b, 1))
    }

    r.worldViewport = {
      x: -r.panX / r.zoom,
      y: -r.panY / r.zoom,
      w: r.viewportWidth / r.zoom,
      h: r.viewportHeight / r.zoom
    }
    updateSceneBackingPreviewState(r, layer)

    const hasPositionPreview =
      graph.positionPreviewVersion !== r.scenePicturePositionPreviewVersion &&
      sceneVersion === r.scenePictureVersion
    const hasVolatileOverlays = hasPositionPreview || hasVolatileOverlay(overlays)

    const canUsePicture = canUseScenePicture(r, graph, sceneVersion, hasVolatileOverlays)
    const cacheMissReason = scenePictureMissReason(
      r,
      graph,
      overlays,
      sceneVersion,
      hasPositionPreview
    )

    if (layer !== 'overlays') {
      canvas.save()
      canvas.scale(r.dpr, r.dpr)

      p.beginPhase('render:scene')
      renderSceneLayer(
        r,
        canvas,
        graph,
        overlays,
        sceneVersion,
        layer,
        hasVolatileOverlays,
        canUsePicture,
        cacheMissReason
      )
      p.endPhase('render:scene')

      canvas.restore()
    }

    if (layer !== 'scene') {
      canvas.save()
      canvas.scale(r.dpr, r.dpr)
      r.labelCache.update(graph, r.pageId, sceneVersion, graph.positionPreviewVersion)
      p.beginPhase('render:sectionTitles')
      r.drawSectionTitles(canvas, graph)
      p.endPhase('render:sectionTitles')
      p.beginPhase('render:componentLabels')
      r.drawComponentLabels(canvas, graph)
      p.endPhase('render:componentLabels')
      canvas.restore()

      canvas.save()
      canvas.scale(r.dpr, r.dpr)

      r.drawHoverHighlight(
        canvas,
        graph,
        overlays.hoveredNodeId === overlays.nodeEditState?.nodeId ? null : overlays.hoveredNodeId
      )
      r.drawEnteredContainer(canvas, graph, overlays.enteredContainerId)
      p.beginPhase('render:selection')
      // Motion preview is scene-only; selection chrome stays on authored bounds.
      r.drawSelection(canvas, graph, selectedIds, overlays)
      p.endPhase('render:selection')
      r.drawFlashes(canvas, graph)
      drawPageGuides(r, canvas, graph)
      r.drawSnapGuides(canvas, overlays.snapGuides)
      r.drawMarquee(canvas, overlays.marquee)
      r.drawLayoutInsertIndicator(canvas, overlays.layoutInsertIndicator)
      r.drawAutoLayoutHover(canvas, graph, overlays.autoLayoutHover)
      r.drawNodeEditOverlay(canvas, graph, overlays.nodeEditState)
      r.drawPenOverlay(canvas, overlays.penState)
      r.drawRemoteCursors(canvas, graph, overlays.remoteCursors)
      p.beginPhase('render:rulers')
      if (r.showRulers) r.drawRulers(canvas, graph, selectedIds)
      p.endPhase('render:rulers')

      p.drawHUD(canvas, r.showRulers)

      canvas.restore()
    }

    p.beginPhase('render:flush')
    const { duration: flushDuration } = measure(() => {
      r.surface.flush()
      surfaceFlushed = true
    })
    p.setFlushTime(flushDuration)
    p.endPhase('render:flush')

    p.setNodeCounts(r._nodeCount, r._culledCount)
    p.endFrame()
    frameEnded = true
  } finally {
    // A CanvasKit exception in a node renderer must not poison the save stack
    // for the recovery frame or every render that follows it.
    try {
      recoveryCanvas?.restoreToCount(initialSaveCount)
    } catch (error) {
      console.warn('CanvasKit save stack could not be restored', error)
    }
    if (!frameEnded) {
      try {
        p.endFrame()
      } catch (error) {
        console.warn('Canvas profiler frame could not be closed', error)
      }
    }
    endDecodedImageCacheFrame(r, surfaceFlushed)
  }
}

/** Re-presents the latest completed retained frame after a failed render. */
export function recoverLastGoodFrame(r: SkiaRenderer, layer: RenderLayer = 'full'): boolean {
  try {
    const canvas = r.surface.getCanvas()
    const initialSaveCount = canvas.getSaveCount()
    try {
      canvas.clear(
        layer === 'overlays'
          ? r.ck.Color4f(0, 0, 0, 0)
          : r.ck.Color4f(r.pageColor.r, r.pageColor.g, r.pageColor.b, 1)
      )
      let recovered = false
      if (layer !== 'overlays') {
        canvas.save()
        canvas.scale(r.dpr, r.dpr)
        recovered = drawLastGoodSceneBacking(r, canvas)
        if (!recovered && r.scenePicture && r.scenePicturePageId === r.pageId) {
          canvas.translate(r.panX, r.panY)
          canvas.scale(r.zoom, r.zoom)
          canvas.drawPicture(r.scenePicture)
          recovered = true
        }
        canvas.restore()
      }
      r.surface.flush()
      return recovered
    } finally {
      try {
        canvas.restoreToCount(initialSaveCount)
      } catch (error) {
        console.warn('CanvasKit recovery save stack could not be restored', error)
      }
    }
  } catch {
    return false
  }
}

function renderSceneContent(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  overlays: RenderOverlays,
  sceneVersion: number,
  canUsePicture: boolean,
  cacheMissReason: string,
  hasVolatileOverlays: boolean
): void {
  const p = r.profiler
  if (canUsePicture) {
    p.setScenePictureMode('hit')
    p.beginPhase('render:drawPicture')
    if (r.scenePicture) {
      const picture = r.scenePicture
      const { duration } = measure(() => canvas.drawPicture(picture))
      p.setScenePictureDrawTime(duration)
    }
    p.endPhase('render:drawPicture')
  } else if (hasVolatileOverlays) {
    renderLiveSceneContent(r, canvas, graph, overlays, cacheMissReason)
  } else {
    p.setScenePictureMode('record', cacheMissReason)
    r._nodeCount = 0
    r._culledCount = 0
    p.beginPhase('render:recordPicture')
    const { duration } = measure(() => recordScenePicture(r, canvas, graph, sceneVersion))
    p.setScenePictureRecordTime(duration)
    p.endPhase('render:recordPicture')
  }
}

function renderLiveSceneContent(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  overlays: RenderOverlays,
  reason: string
): void {
  const p = r.profiler
  p.setScenePictureMode('volatile', reason)
  r._nodeCount = 0
  r._culledCount = 0
  p.beginPhase('render:volatile')
  renderPageChildren(r, canvas, graph, overlays)
  p.endPhase('render:volatile')
}

function renderPageChildren(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  overlays: RenderOverlays
): void {
  const pageNode = graph.getNode(r.pageId ?? graph.rootId)
  if (!pageNode) return
  renderChildrenWithMotionLayout(r, canvas, graph, pageNode.childIds, overlays)
}

function recordScenePicture(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  sceneVersion: number
): void {
  const prevViewport = r.worldViewport
  r.worldViewport = { x: -1e6, y: -1e6, w: 2e6, h: 2e6 }
  const recorder = new r.ck.PictureRecorder()
  try {
    const pageNode = graph.getNode(r.pageId ?? graph.rootId)
    const sceneContentBounds = pageNode
      ? computeDescendantVisualBounds(
          pageNode.childIds,
          (id) => graph.getNode(id),
          (id) => graph.getAbsolutePosition(id)
        )
      : null
    const sceneBounds = sceneContentBounds
      ? {
          x: sceneContentBounds.minX,
          y: sceneContentBounds.minY,
          width: sceneContentBounds.maxX - sceneContentBounds.minX,
          height: sceneContentBounds.maxY - sceneContentBounds.minY
        }
      : { x: 0, y: 0, width: 1, height: 1 }
    const padding = 1024
    const bounds = r.ck.LTRBRect(
      sceneBounds.x - padding,
      sceneBounds.y - padding,
      sceneBounds.x + sceneBounds.width + padding,
      sceneBounds.y + sceneBounds.height + padding
    )
    const recCanvas = recorder.beginRecording(bounds)
    if (pageNode) {
      for (const childId of pageNode.childIds) {
        r.renderNode(recCanvas, graph, childId, {})
      }
    }
    const picture = recorder.finishRecordingAsPicture()
    try {
      canvas.drawPicture(picture)
    } catch (error) {
      picture.delete()
      throw error
    }
    const previousPicture = r.scenePicture
    r.scenePicture = picture
    previousPicture?.delete()
    r.scenePictureVersion = sceneVersion
    r.scenePictureFontGeneration = r.fontGeneration
    r.scenePicturePositionPreviewVersion = graph.positionPreviewVersion
    r.scenePicturePageId = r.pageId
  } finally {
    recorder.delete()
    r.worldViewport = prevViewport
  }
}
