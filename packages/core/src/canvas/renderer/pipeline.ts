import type { Canvas } from 'canvaskit-wasm'

import { graphHasAnimatedGeneratedEffects } from '@open-pencil/motion'
import type { SceneGraph } from '@open-pencil/scene-graph'
import { computeDescendantVisualBounds } from '@open-pencil/scene-graph/geometry'

import { needsImagePreviews } from '#core/canvas/images/previews'
import type { RenderOverlays, SkiaRenderer } from '#core/canvas/renderer'
import { playIslandRoots } from '#core/editor/play/islands'
import type { EditorState } from '#core/editor/types'
import { computeMotionLayoutPreview } from '#core/layout'
import { emitNavigationTrace } from '#core/profiler'

import { prepareContentEditCache, renderContentEditRoot } from './content-edit'
import {
  beginDecodedImageCacheFrame,
  endDecodedImageCacheFrame,
  clearDecodedImageCache
} from './image-cache'
import { drawChromePass, drawLabelPass, drawOverlayPass } from './overlay-pass'
import {
  cancelSceneBackingBuild,
  drawLastGoodSceneBacking,
  renderSceneBacking,
  updateSceneBackingPreviewState
} from './retained-backing'
import { withIsolatedDocumentCaches } from './state'
import { hasTransientPreviews, renderPageWithPreviews } from './transient-previews'

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
  const previewMode = r.viewportImageRendering
  const staticExport = r.renderingStaticExport
  r.renderingStaticExport = true
  r.viewportImageRendering = false
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
    r.viewportImageRendering = previewMode
    r.renderingStaticExport = staticExport
    endDecodedImageCacheFrame(r, completed)
  }
}

function prepareViewportImages(r: SkiaRenderer, graph: SceneGraph, pageId: string): void {
  const previewMode = r.imagePreviews.enabled && needsImagePreviews(graph)
  if (
    r.imageMemoryGraph !== graph ||
    r.viewportImageRendering !== previewMode ||
    (previewMode && r.imageMemoryPage !== pageId)
  ) {
    r.invalidateAllPictures()
    clearDecodedImageCache(r)
    // Previews of another document hold its encoded images, which a document without
    // previews would otherwise keep alive.
    if (r.imageMemoryGraph !== graph) r.imagePreviews.release()
    r.imageMemoryGraph = graph
    r.imageMemoryPage = pageId
  }
  r.viewportImageRendering = previewMode
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
  layer: RenderLayer = 'full',
  interactive = false
): void {
  const reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const generatedEffectsAnimate = graphHasAnimatedGeneratedEffects(graph, {
    pageId: state.currentPageId,
    prefersReducedMotion: reducedMotion
  })
  prepareViewportImages(r, graph, state.currentPageId)
  r.dpr = dpr
  r.panX = state.panX
  r.panY = state.panY
  r.zoom = state.zoom
  r.viewportWidth = viewportWidth
  r.viewportHeight = viewportHeight
  r.showRulers = showRulers
  r.pageColor = state.pageColor
  r.rulerTheme = state.rulerTheme ?? null
  r.setSelectionTheme(state.selectionTheme)
  r.pageId = state.currentPageId
  r.navigationPhase = state.navigation.phase
  r.navigationGeneration = state.navigation.generation
  // A previewing canvas shows the design as it runs: no selection, hover, or edit chrome.
  const previewing = state.play !== null
  render(
    r,
    graph,
    previewing ? new Set<string>() : state.selectedIds,
    {
      contentRootId: state.contentEdit?.rootId,
      tabsPreview: state.tabsPreview,
      motionVisualStates: state.motionPreview?.visuals,
      ...(generatedEffectsAnimate ? { generatedEffectTimeMs: now() } : {}),
      generatedEffectMode: reducedMotion ? 'reduce' : 'allow',
      playing: previewing,
      playIslands: previewing ? new Set(playIslandRoots(graph, state.currentPageId)) : undefined,
      hoveredNodeId: previewing ? null : state.hoveredNodeId,
      showPixelGrid: !previewing && state.showPixelGrid !== false,
      gradientEdit: state.gradientEdit,
      transforming: state.transforming,
      measurementMode: state.measurementMode,
      enteredContainerId: state.enteredContainerId,
      editingTextId: state.editingTextId,
      textEditor: textEditor as RenderOverlays['textEditor'],
      marquee: state.marquee,
      snapGuides: state.snapGuides,
      guides: state.guides,
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
      pencilState: state.pencilState,
      nodeEditState: state.nodeEditState ?? null,
      presenceCursors: state.presenceCursors,
      designIssues: state.designIssues,
      codeFocusNodeId: state.codeFocusNodeId,
      autoLayoutHover: state.autoLayoutHover,
      shapeHandleHover: state.shapeHandleHover
    },
    // Recorded pictures follow what the canvas draws, not every document change.
    state.canvasVersion,
    layer,
    interactive
  )
}

export function hasVolatileOverlay(overlays: RenderOverlays): boolean {
  return (
    overlays.contentRootId !== undefined ||
    overlays.tabsPreview != null ||
    (overlays.motionVisualStates?.size ?? 0) > 0 ||
    overlays.generatedEffectTimeMs !== undefined ||
    overlays.rotationPreview != null ||
    overlays.nodeEditState != null ||
    overlays.playing === true
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
  if (hasTransientPreviews(r, graph)) return 'transient-preview'
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
  requiresUncachedSceneRender: boolean
): boolean {
  return (
    !requiresUncachedSceneRender &&
    !!r.scenePicture &&
    graph.positionPreviewVersion === r.scenePicturePositionPreviewVersion &&
    sceneVersion === r.scenePictureVersion &&
    r.fontGeneration === r.scenePictureFontGeneration &&
    r.pageId === r.scenePicturePageId
  )
}

function getSceneRenderPolicy(
  r: SkiaRenderer,
  graph: SceneGraph,
  overlays: RenderOverlays,
  sceneVersion: number,
  interactive: boolean
) {
  const hasPositionPreview =
    graph.positionPreviewVersion !== r.scenePicturePositionPreviewVersion &&
    sceneVersion === r.scenePictureVersion
  const requiresUncachedSceneRender =
    r.viewportImageRendering ||
    interactive ||
    hasPositionPreview ||
    hasVolatileOverlay(overlays) ||
    hasTransientPreviews(r, graph)
  return {
    requiresUncachedSceneRender,
    canUsePicture: canUseScenePicture(r, graph, sceneVersion, requiresUncachedSceneRender),
    cacheMissReason: interactive
      ? 'active-edit'
      : scenePictureMissReason(r, graph, overlays, sceneVersion, hasPositionPreview)
  }
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
): boolean {
  const drewSceneBacking =
    layer === 'scene' && !hasVolatileOverlays && renderSceneBacking(r, canvas, graph, sceneVersion)
  if (drewSceneBacking) {
    r.profiler.setScenePictureMode('hit', drewSceneBacking)
    return false
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
    return true
  }

  return renderSceneContent(
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
/** Labels, editing overlays, and rulers; a previewing canvas keeps only the rulers' chrome pass. */
function drawAboveScene(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  selectedIds: Set<string>,
  overlays: RenderOverlays,
  sceneVersion: number
): void {
  canvas.save()
  canvas.scale(r.dpr, r.dpr)
  r.labelCache.update(graph, r.pageId, sceneVersion, graph.positionPreviewVersion)
  if (!overlays.playing && !overlays.contentRootId)
    drawLabelPass(r, canvas, graph, selectedIds, overlays)
  canvas.restore()

  canvas.save()
  canvas.scale(r.dpr, r.dpr)
  if (!overlays.playing) drawOverlayPass(r, canvas, graph, selectedIds, overlays)
  drawChromePass(r, canvas, graph, selectedIds, overlays)
  canvas.restore()
}

function rememberFlushedLiveScene(
  r: SkiaRenderer,
  graph: SceneGraph,
  sceneVersion: number,
  liveScenePresented: boolean
): void {
  if (liveScenePresented) {
    // Advance only after a real live frame reaches the surface, never on a failed draw.
    r.lastLiveSceneContent = {
      pageId: r.pageId,
      sceneVersion,
      positionPreviewVersion: graph.positionPreviewVersion,
      fontGeneration: r.fontGeneration
    }
  }
}

export function render(
  r: SkiaRenderer,
  graph: SceneGraph,
  selectedIds: Set<string>,
  overlays: RenderOverlays = {},
  sceneVersion = -1,
  layer: RenderLayer = 'full',
  interactive = false
): void {
  prepareContentEditCache(r, overlays.contentRootId)
  prepareRenderCacheScope(r, graph)
  emitNavigationTrace('render:start', {
    layer,
    sceneVersion,
    panX: r.panX,
    panY: r.panY,
    zoom: r.zoom
  })
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
  let liveScenePresented = false
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

    const {
      requiresUncachedSceneRender: hasVolatileOverlays,
      canUsePicture,
      cacheMissReason
    } = getSceneRenderPolicy(r, graph, overlays, sceneVersion, interactive)
    if (layer !== 'overlays') {
      if (hasVolatileOverlays) {
        // A live frame replaces the paused build; only its completed backing remains reusable.
        if (r.sceneBackingBuild) cancelSceneBackingBuild(r)
        r.sceneBackingNeedsCrispRender = false
        r.tiledScenePending = false
      }
      canvas.save()
      canvas.scale(r.dpr, r.dpr)

      p.beginPhase('render:scene')
      let renderedScene = false
      if (layer === 'scene' && !hasVolatileOverlays && r.tiledSceneEnabled) {
        const backingPresented = renderSceneBacking(r, canvas, graph, sceneVersion)
        if (!backingPresented) {
          canvas.save()
          try {
            canvas.translate(r.panX, r.panY)
            canvas.scale(r.zoom, r.zoom)
            liveScenePresented = renderSceneContent(
              r,
              canvas,
              graph,
              overlays,
              sceneVersion,
              canUsePicture,
              cacheMissReason,
              hasVolatileOverlays
            )
          } finally {
            canvas.restore()
          }
        }
        const tiled = r.tiledScene.renderFrame(
          r,
          canvas,
          graph,
          sceneVersion,
          r.navigationGeneration
        )
        r.tiledScenePending = tiled.pending
        r.tiledSceneCovered = tiled.covered
        renderedScene = true
        p.setScenePictureMode('hit', tiled.covered ? 'tiled' : 'tiled-fallback')
      }
      if (!renderedScene) {
        liveScenePresented = renderSceneLayer(
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
      }
      p.endPhase('render:scene')

      canvas.restore()
    }

    if (layer !== 'scene') drawAboveScene(r, canvas, graph, selectedIds, overlays, sceneVersion)

    p.beginPhase('render:flush')
    const { duration: flushDuration } = measure(() => {
      r.surface.flush()
      surfaceFlushed = true
    })
    p.setFlushTime(flushDuration)
    p.endPhase('render:flush')
    rememberFlushedLiveScene(r, graph, sceneVersion, liveScenePresented)

    p.setNodeCounts(r._nodeCount, r._culledCount)
    p.endFrame()
    frameEnded = true
    emitNavigationTrace('render:end', {
      layer,
      sceneVersion,
      panX: r.panX,
      panY: r.panY,
      zoom: r.zoom,
      flushMs: flushDuration,
      nodes: r._nodeCount,
      culledNodes: r._culledCount,
      backingCrisp: !r.sceneBackingNeedsCrispRender
    })
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
): boolean {
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
  return !canUsePicture && hasVolatileOverlays
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
  if (renderContentEditRoot(r, canvas, graph, overlays)) return
  if (renderPageWithPreviews(r, canvas, graph, overlays)) return
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
