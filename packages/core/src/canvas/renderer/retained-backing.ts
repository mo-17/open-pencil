import type { Canvas, Image as CKImage, Surface } from 'canvaskit-wasm'

import type { SceneGraph } from '@open-pencil/scene-graph'
import { computeDescendantVisualBounds } from '@open-pencil/scene-graph/geometry'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { clearSubtreePictureCache } from '#core/canvas/renderer/state'

import type { RenderLayer } from './pipeline'

const now = typeof performance !== 'undefined' ? () => performance.now() : () => 0
const SCENE_BACKING_SCALE = 3
const MAX_SCENE_BACKING_DEVICE_PIXELS = 12_000_000
const FRAME_BUDGET_60HZ_MS = 1000 / 60
const MIN_SCENE_BACKING_IDLE_FRAMES = 2
const MAX_SCENE_BACKING_IDLE_FRAMES = 18
const MAX_SCENE_BACKING_QUIET_INPUT_INTERVALS = 4
const SCENE_BACKING_BUILD_BUDGET_MS = 6

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function smoothAverage(previous: number, next: number, weight = 0.2): number {
  return previous * (1 - weight) + next * weight
}

function sceneBackingPreviewIdleMs(r: SkiaRenderer): number {
  const minDelay = FRAME_BUDGET_60HZ_MS * MIN_SCENE_BACKING_IDLE_FRAMES
  const maxDelay = FRAME_BUDGET_60HZ_MS * MAX_SCENE_BACKING_IDLE_FRAMES
  const renderMs = clamp(r.sceneBackingAverageRecordMs, minDelay, maxDelay)
  const inputIntervalMs = clamp(r.sceneBackingAverageViewportIntervalMs, 1, maxDelay)
  if (inputIntervalMs > FRAME_BUDGET_60HZ_MS * MAX_SCENE_BACKING_QUIET_INPUT_INTERVALS) {
    return renderMs
  }

  const expectedEventsDuringRender = renderMs / inputIntervalMs
  const quietInputIntervals = clamp(
    expectedEventsDuringRender,
    1,
    MAX_SCENE_BACKING_QUIET_INPUT_INTERVALS
  )
  return clamp(Math.max(renderMs, inputIntervalMs * quietInputIntervals), minDelay, maxDelay)
}

export function updateSceneBackingPreviewState(r: SkiaRenderer, layer: RenderLayer): void {
  if (layer !== 'scene') return
  const previous = r.lastSceneViewport
  const viewportChanged =
    !previous || previous.panX !== r.panX || previous.panY !== r.panY || previous.zoom !== r.zoom
  if (viewportChanged) {
    const timestamp = now()
    if (r.sceneBackingLastViewportEventAt > 0) {
      const interval = timestamp - r.sceneBackingLastViewportEventAt
      r.sceneBackingAverageViewportIntervalMs = smoothAverage(
        r.sceneBackingAverageViewportIntervalMs,
        clamp(interval, 1, 500)
      )
    }
    r.sceneBackingLastViewportEventAt = timestamp
    r.sceneBackingPreviewUntil = timestamp + sceneBackingPreviewIdleMs(r)
    r.sceneBackingNeedsCrispRender = !!r.sceneBacking
    r.lastSceneViewport = { panX: r.panX, panY: r.panY, zoom: r.zoom }
  }
}

function backingMetadataMatches(
  r: SkiaRenderer,
  sceneVersion: number,
  positionPreviewVersion: number
): boolean {
  const backing = r.sceneBacking
  const expected = sceneBackingGeometry(r)
  return !!(
    backing &&
    backing.pageId === r.pageId &&
    backing.sceneVersion === sceneVersion &&
    backing.positionPreviewVersion === positionPreviewVersion &&
    backing.fontGeneration === r.fontGeneration &&
    Math.abs(backing.dpr - expected.dpr) <= 0.0001
  )
}

function backingScreenCoverageContainsViewport(r: SkiaRenderer): boolean {
  const backing = r.sceneBacking
  if (!backing) return false
  const scale = r.zoom / backing.zoom
  const x = r.panX - backing.panX * scale
  const y = r.panY - backing.panY * scale
  return (
    x <= 0 &&
    y <= 0 &&
    x + backing.width * scale >= r.viewportWidth &&
    y + backing.height * scale >= r.viewportHeight
  )
}

function backingWorldCoverageContainsLiveViewport(r: SkiaRenderer): boolean {
  const backing = r.sceneBacking
  if (!backing) return false
  const liveX = -r.panX / r.zoom
  const liveY = -r.panY / r.zoom
  const liveW = r.viewportWidth / r.zoom
  const liveH = r.viewportHeight / r.zoom
  return (
    liveX >= backing.worldX &&
    liveY >= backing.worldY &&
    liveX + liveW <= backing.worldX + backing.worldWidth &&
    liveY + liveH <= backing.worldY + backing.worldHeight
  )
}

function backingZoomMatchesLiveViewport(r: SkiaRenderer): boolean {
  return Math.abs((r.sceneBacking?.zoom ?? r.zoom) - r.zoom) <= 0.0001
}

function backingCoverageContainsLiveViewport(
  r: SkiaRenderer,
  sceneVersion: number,
  allowStaleZoom: boolean,
  positionPreviewVersion: number
): boolean {
  if (!backingMetadataMatches(r, sceneVersion, positionPreviewVersion)) return false
  const crispZoom = backingZoomMatchesLiveViewport(r)
  if (allowStaleZoom && backingScreenCoverageContainsViewport(r)) return true
  return crispZoom && backingWorldCoverageContainsLiveViewport(r)
}

function drawSceneBacking(
  r: SkiaRenderer,
  canvas: Canvas,
  sceneVersion: number,
  allowStaleZoom: boolean,
  positionPreviewVersion: number
): boolean {
  const backing = r.sceneBacking
  if (
    !backing ||
    !backingCoverageContainsLiveViewport(r, sceneVersion, allowStaleZoom, positionPreviewVersion)
  ) {
    return false
  }

  drawBackingImage(r, canvas, backing)
  return true
}

function drawBackingImage(
  r: SkiaRenderer,
  canvas: Canvas,
  backing: NonNullable<SkiaRenderer['sceneBacking']>
): void {
  const scale = r.zoom / backing.zoom
  const x = r.panX - backing.panX * scale
  const y = r.panY - backing.panY * scale
  r.opacityPaint.setAlphaf(1)
  canvas.drawImageRectOptions(
    backing.image,
    r.ck.LTRBRect(
      0,
      0,
      Math.max(1, Math.floor(backing.width * backing.dpr)),
      Math.max(1, Math.floor(backing.height * backing.dpr))
    ),
    r.ck.LTRBRect(x, y, x + backing.width * scale, y + backing.height * scale),
    r.ck.FilterMode.Linear,
    r.ck.MipmapMode.None,
    r.opacityPaint
  )
}

/** Draws the most recently completed scene even when its graph metadata is stale. */
export function drawLastGoodSceneBacking(r: SkiaRenderer, canvas: Canvas): boolean {
  const backing = r.sceneBacking
  if (!backing || backing.pageId !== r.pageId) return false
  drawBackingImage(r, canvas, backing)
  return true
}

export function sceneBackingScaleForViewport(
  viewportWidth: number,
  viewportHeight: number,
  dpr: number
): number {
  const viewportDevicePixels = Math.max(1, viewportWidth * viewportHeight * dpr * dpr)
  return clamp(
    Math.sqrt(MAX_SCENE_BACKING_DEVICE_PIXELS / viewportDevicePixels),
    1,
    SCENE_BACKING_SCALE
  )
}

function sceneBackingGeometry(r: SkiaRenderer) {
  const backingScale = sceneBackingScaleForViewport(r.viewportWidth, r.viewportHeight, r.dpr)
  const marginX = r.viewportWidth * ((backingScale - 1) / 2)
  const marginY = r.viewportHeight * ((backingScale - 1) / 2)
  const width = Math.max(1, Math.ceil(r.viewportWidth + marginX * 2))
  const height = Math.max(1, Math.ceil(r.viewportHeight + marginY * 2))
  // A single viewport can itself exceed the cap on a large/high-DPI display.
  // Keep CSS coverage intact and lower only the retained preview resolution.
  const cappedDpr = Math.sqrt(MAX_SCENE_BACKING_DEVICE_PIXELS / (width * height))
  const dpr = Math.max(0.1, Math.min(r.dpr, cappedDpr))
  const backingPanX = r.panX + marginX
  const backingPanY = r.panY + marginY
  return {
    panX: backingPanX,
    panY: backingPanY,
    width,
    height,
    worldX: -backingPanX / r.zoom,
    worldY: -backingPanY / r.zoom,
    worldWidth: width / r.zoom,
    worldHeight: height / r.zoom,
    zoom: r.zoom,
    dpr
  }
}

function createSceneBackingSurface(
  r: SkiaRenderer,
  width: number,
  height: number,
  dpr: number
): Surface | null {
  try {
    return r.surface.makeSurface({
      width: Math.max(1, Math.floor(width * dpr)),
      height: Math.max(1, Math.floor(height * dpr)),
      colorType: r.ck.ColorType.RGBA_8888,
      alphaType: r.ck.AlphaType.Premul,
      colorSpace: r.ck.ColorSpace.SRGB
    })
  } catch {
    // CanvasKit can throw instead of returning null under GPU memory pressure.
    // The caller will use the live renderer or the previous retained image.
    return null
  }
}

function ensureSubtreePictureCacheScope(
  r: SkiaRenderer,
  graph: SceneGraph,
  sceneVersion: number
): void {
  if (
    r.subtreePictureCachePageId === r.pageId &&
    r.subtreePictureCacheSceneVersion === sceneVersion &&
    r.subtreePictureCachePositionPreviewVersion === graph.positionPreviewVersion &&
    r.subtreePictureCacheFontGeneration === r.fontGeneration
  ) {
    return
  }
  clearSubtreePictureCache(r)
  r.subtreePictureCachePageId = r.pageId
  r.subtreePictureCacheSceneVersion = sceneVersion
  r.subtreePictureCachePositionPreviewVersion = graph.positionPreviewVersion
  r.subtreePictureCacheFontGeneration = r.fontGeneration
}

function cachedSubtreePicture(
  r: SkiaRenderer,
  graph: SceneGraph,
  childId: string,
  sceneVersion: number
) {
  ensureSubtreePictureCacheScope(r, graph, sceneVersion)
  const cached = r.subtreePictureCache.get(childId)
  if (
    cached &&
    cached.pageId === r.pageId &&
    cached.sceneVersion === sceneVersion &&
    cached.positionPreviewVersion === graph.positionPreviewVersion &&
    cached.fontGeneration === r.fontGeneration
  ) {
    return cached.picture
  }

  if (cached) {
    // Remove the entry before rebuilding. If CanvasKit throws while recording,
    // a later lookup must never return the already-deleted picture.
    r.subtreePictureCache.delete(childId)
    cached.picture.delete()
  }
  const bounds = computeDescendantVisualBounds(
    [childId],
    (id) => graph.getNode(id),
    (id) => graph.getAbsolutePosition(id)
  )
  if (!bounds) return null

  const recorder = new r.ck.PictureRecorder()
  const prevViewport = r.worldViewport
  try {
    const recCanvas = recorder.beginRecording(
      r.ck.LTRBRect(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY)
    )
    r.worldViewport = {
      x: bounds.minX,
      y: bounds.minY,
      w: bounds.maxX - bounds.minX,
      h: bounds.maxY - bounds.minY
    }
    r.renderNode(recCanvas, graph, childId, {})
    const picture = recorder.finishRecordingAsPicture()
    r.subtreePictureCache.set(childId, {
      picture,
      pageId: r.pageId,
      sceneVersion,
      positionPreviewVersion: graph.positionPreviewVersion,
      fontGeneration: r.fontGeneration
    })
    return picture
  } finally {
    r.worldViewport = prevViewport
    recorder.delete()
  }
}

function renderBackingChild(
  r: SkiaRenderer,
  graph: SceneGraph,
  surface: Surface,
  childId: string,
  backing: ReturnType<typeof sceneBackingGeometry>,
  sceneVersion: number
): void {
  const canvas = surface.getCanvas()
  const prevViewport = r.worldViewport
  const initialSaveCount = canvas.getSaveCount()
  try {
    r.worldViewport = {
      x: backing.worldX,
      y: backing.worldY,
      w: backing.worldWidth,
      h: backing.worldHeight
    }
    canvas.save()
    canvas.scale(backing.dpr, backing.dpr)
    canvas.translate(backing.panX, backing.panY)
    canvas.scale(r.zoom, r.zoom)
    const picture = cachedSubtreePicture(r, graph, childId, sceneVersion)
    if (picture) canvas.drawPicture(picture)
    else r.renderNode(canvas, graph, childId, {})
  } finally {
    r.worldViewport = prevViewport
    canvas.restoreToCount(initialSaveCount)
  }
}

function sceneBackingMetrics(backing: ReturnType<typeof sceneBackingGeometry>) {
  return {
    panX: backing.panX,
    panY: backing.panY,
    zoom: backing.zoom,
    width: backing.width,
    height: backing.height,
    dpr: backing.dpr,
    worldX: backing.worldX,
    worldY: backing.worldY,
    worldWidth: backing.worldWidth,
    worldHeight: backing.worldHeight
  }
}

function installSceneBackingImage(
  r: SkiaRenderer,
  image: CKImage,
  sceneVersion: number,
  positionPreviewVersion: number,
  backing: ReturnType<typeof sceneBackingGeometry>
): void {
  r.sceneBacking?.image.delete()
  r.sceneBacking = {
    image,
    pageId: r.pageId,
    sceneVersion,
    positionPreviewVersion,
    fontGeneration: r.fontGeneration,
    ...sceneBackingMetrics(backing)
  }
  r.scenePictureVersion = sceneVersion
  r.scenePicturePositionPreviewVersion = positionPreviewVersion
  r.scenePicturePageId = r.pageId
  r.sceneBackingNeedsCrispRender = false
}

function cancelSceneBackingBuild(r: SkiaRenderer): void {
  r.sceneBackingBuild?.surface.delete()
  r.sceneBackingBuild = null
}

function sceneBackingBuildMatches(r: SkiaRenderer, sceneVersion: number): boolean {
  const build = r.sceneBackingBuild
  if (!build) return false
  const backing = sceneBackingGeometry(r)
  return (
    build.pageId === r.pageId &&
    build.sceneVersion === sceneVersion &&
    build.positionPreviewVersion === build.graph.positionPreviewVersion &&
    build.fontGeneration === r.fontGeneration &&
    build.panX === backing.panX &&
    build.panY === backing.panY &&
    build.zoom === backing.zoom &&
    build.dpr === backing.dpr
  )
}

function startSceneBackingBuild(r: SkiaRenderer, graph: SceneGraph, sceneVersion: number): void {
  cancelSceneBackingBuild(r)
  const backing = sceneBackingGeometry(r)
  const pageNode = graph.getNode(r.pageId ?? graph.rootId)
  const surface = createSceneBackingSurface(r, backing.width, backing.height, backing.dpr)
  if (!surface) return
  try {
    surface.getCanvas().clear(r.ck.Color4f(r.pageColor.r, r.pageColor.g, r.pageColor.b, 1))
  } catch {
    surface.delete()
    return
  }
  r.sceneBackingBuild = {
    surface,
    graph,
    childIds: pageNode?.childIds ? [...pageNode.childIds] : [],
    index: 0,
    startedAt: now(),
    pageId: r.pageId,
    sceneVersion,
    positionPreviewVersion: graph.positionPreviewVersion,
    fontGeneration: r.fontGeneration,
    ...sceneBackingMetrics(backing)
  }
}

function sceneBackingGeometryFromBuild(build: NonNullable<SkiaRenderer['sceneBackingBuild']>) {
  return {
    panX: build.panX,
    panY: build.panY,
    width: build.width,
    height: build.height,
    worldX: build.worldX,
    worldY: build.worldY,
    worldWidth: build.worldWidth,
    worldHeight: build.worldHeight,
    zoom: build.zoom,
    dpr: build.dpr
  }
}

function stepSceneBackingBuild(r: SkiaRenderer, sceneVersion: number): boolean {
  const build = r.sceneBackingBuild
  if (!build) return false
  if (!sceneBackingBuildMatches(r, sceneVersion)) {
    cancelSceneBackingBuild(r)
    return false
  }

  const startedAt = now()
  const backing = sceneBackingGeometryFromBuild(build)
  try {
    do {
      const childId = build.childIds[build.index]
      if (!childId) break
      renderBackingChild(r, build.graph, build.surface, childId, backing, build.sceneVersion)
      build.index++
    } while (
      build.index < build.childIds.length &&
      now() - startedAt < SCENE_BACKING_BUILD_BUDGET_MS
    )
  } catch {
    cancelSceneBackingBuild(r)
    return false
  }

  if (build.index < build.childIds.length) return true

  let image: CKImage
  try {
    build.surface.flush()
    image = build.surface.makeImageSnapshot()
  } catch {
    cancelSceneBackingBuild(r)
    return false
  }
  build.surface.delete()
  r.sceneBackingBuild = null
  installSceneBackingImage(r, image, build.sceneVersion, build.positionPreviewVersion, backing)
  r.sceneBackingAverageRecordMs = smoothAverage(
    r.sceneBackingAverageRecordMs,
    clamp(now() - build.startedAt, 1, 1_000)
  )
  return true
}

function recordSceneBacking(r: SkiaRenderer, graph: SceneGraph, sceneVersion: number): boolean {
  const startedAt = now()
  const backing = sceneBackingGeometry(r)
  const surface = createSceneBackingSurface(r, backing.width, backing.height, backing.dpr)
  if (!surface) return false
  let image: CKImage
  try {
    const canvas = surface.getCanvas()
    canvas.clear(r.ck.Color4f(r.pageColor.r, r.pageColor.g, r.pageColor.b, 1))
    const pageNode = graph.getNode(r.pageId ?? graph.rootId)
    if (pageNode) {
      for (const childId of pageNode.childIds) {
        renderBackingChild(r, graph, surface, childId, backing, sceneVersion)
      }
    }
    surface.flush()
    image = surface.makeImageSnapshot()
  } catch {
    surface.delete()
    return false
  }
  surface.delete()
  installSceneBackingImage(r, image, sceneVersion, graph.positionPreviewVersion, backing)
  r.sceneBackingAverageRecordMs = smoothAverage(
    r.sceneBackingAverageRecordMs,
    clamp(now() - startedAt, 1, 1_000)
  )
  return true
}

export function renderSceneBacking(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  sceneVersion: number
): boolean {
  const positionPreviewVersion = graph.positionPreviewVersion
  const allowStaleZoom = now() < r.sceneBackingPreviewUntil
  const hasCoverage = backingCoverageContainsLiveViewport(
    r,
    sceneVersion,
    allowStaleZoom,
    positionPreviewVersion
  )
  if (!r.sceneBacking) {
    // The first retained frame has no fallback to present, so build it eagerly.
    recordSceneBacking(r, graph, sceneVersion)
  } else if (!hasCoverage) {
    // Once a completed frame exists, never synchronously redraw the entire
    // page for a graph change. Keep presenting the last-good frame while the
    // replacement is recorded in bounded slices.
    if (!sceneBackingBuildMatches(r, sceneVersion)) startSceneBackingBuild(r, graph, sceneVersion)
    stepSceneBackingBuild(r, sceneVersion)
  } else if (r.sceneBackingBuild) {
    stepSceneBackingBuild(r, sceneVersion)
  }

  const drewCurrent = drawSceneBacking(
    r,
    canvas,
    sceneVersion,
    allowStaleZoom || !!r.sceneBackingBuild,
    positionPreviewVersion
  )
  const crisp = Math.abs((r.sceneBacking?.zoom ?? r.zoom) - r.zoom) <= 0.0001
  r.sceneBackingNeedsCrispRender = !drewCurrent || !crisp || !!r.sceneBackingBuild
  return drewCurrent || drawLastGoodSceneBacking(r, canvas)
}
