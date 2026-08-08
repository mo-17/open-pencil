/* eslint-disable max-lines -- Retained backing geometry, preview, and incremental build share one lifecycle. */
import type { Canvas, Image as CKImage, Surface } from 'canvaskit-wasm'

import type { SceneGraph } from '@open-pencil/scene-graph'
import { effectOverflow, strokeOverflow } from '@open-pencil/scene-graph/geometry'

import { canvasPerformanceProfile } from '#core/canvas/performance'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { clearSubtreePictureCache } from '#core/canvas/renderer/state'

import type { RenderLayer } from './pipeline'

const now = typeof performance !== 'undefined' ? () => performance.now() : () => 0
const FRAME_BUDGET_60HZ_MS = 1000 / 60
const SCENE_BACKING_TILE_DEVICE_PX = 512
const SCENE_BACKING_TILE_CULL_PADDING_DEVICE_PX = 128

interface SceneBackingTile {
  sequence: number
  worldX: number
  worldY: number
  worldWidth: number
  worldHeight: number
  cullX: number
  cullY: number
  cullWidth: number
  cullHeight: number
}

const sceneBackingBuildTiles = new WeakMap<object, SceneBackingTile[]>()

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function smoothAverage(previous: number, next: number, weight = 0.2): number {
  return previous * (1 - weight) + next * weight
}

function sceneBackingPreviewIdleMs(r: SkiaRenderer): number {
  const profile = canvasPerformanceProfile(r.performanceMode)
  const minDelay = profile.sceneBackingMinCrispDelayMs
  const maxDelay = profile.sceneBackingMaxCrispDelayMs
  const renderMs = clamp(r.sceneBackingAverageRecordMs, minDelay, maxDelay)
  const inputIntervalMs = clamp(r.sceneBackingAverageViewportIntervalMs, 1, maxDelay)
  if (inputIntervalMs > FRAME_BUDGET_60HZ_MS * profile.sceneBackingMaxQuietInputIntervals) {
    return renderMs
  }

  const expectedEventsDuringRender = renderMs / inputIntervalMs
  const quietInputIntervals = clamp(
    expectedEventsDuringRender,
    1,
    profile.sceneBackingMaxQuietInputIntervals
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
    Math.abs(backing.dpr - expected.dpr) <= 0.0001 &&
    backing.width === expected.width &&
    backing.height === expected.height
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
  dpr: number,
  performanceMode: SkiaRenderer['performanceMode'] = 'balanced'
): number {
  const profile = canvasPerformanceProfile(performanceMode)
  const viewportDevicePixels = Math.max(1, viewportWidth * viewportHeight * dpr * dpr)
  return clamp(
    Math.sqrt(profile.sceneBackingMaxDevicePixels / viewportDevicePixels),
    1,
    profile.sceneBackingCoverageScale
  )
}

function sceneBackingGeometry(r: SkiaRenderer) {
  const profile = canvasPerformanceProfile(r.performanceMode)
  const backingScale = sceneBackingScaleForViewport(
    r.viewportWidth,
    r.viewportHeight,
    r.dpr,
    r.performanceMode
  )
  const marginX = r.viewportWidth * ((backingScale - 1) / 2)
  const marginY = r.viewportHeight * ((backingScale - 1) / 2)
  const width = Math.max(1, Math.ceil(r.viewportWidth + marginX * 2))
  const height = Math.max(1, Math.ceil(r.viewportHeight + marginY * 2))
  // A single viewport can itself exceed the cap on a large/high-DPI display.
  // Keep CSS coverage intact and lower only the retained preview resolution.
  const cappedDpr = Math.sqrt(profile.sceneBackingMaxDevicePixels / (width * height))
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
  if (r.sceneBackingAllocationFailed) return null
  const info = {
    width: Math.max(1, Math.floor(width * dpr)),
    height: Math.max(1, Math.floor(height * dpr)),
    colorType: r.ck.ColorType.RGBA_8888,
    alphaType: r.ck.AlphaType.Premul,
    colorSpace: r.ck.ColorSpace.SRGB
  }
  try {
    return r.surface.makeSurface(info)
  } catch (error) {
    r.sceneBackingAllocationFailed = true
    console.warn(
      `Disabling retained scene backing after CanvasKit failed to allocate ${info.width}×${info.height}`,
      error
    )
    return null
  }
}

function nodeVisualOverflow(node: NonNullable<ReturnType<SceneGraph['getNode']>>): number {
  const effectBounds = effectOverflow(node.effects)
  let overflow = Math.max(
    strokeOverflow(node.strokes),
    effectBounds.left,
    effectBounds.right,
    effectBounds.top,
    effectBounds.bottom
  )

  // Match the conservative CanvasKit layer bounds. They intentionally use two radii around a
  // blur/filter, which can exceed the format-neutral visual-bounds estimate above.
  for (const effect of node.effects) {
    if (!effect.visible) continue
    if (effect.type === 'LAYER_BLUR' || effect.type === 'FOREGROUND_BLUR') {
      overflow = Math.max(overflow, Math.abs(effect.radius) * 2)
    } else if (effect.type === 'DROP_SHADOW') {
      const filterPadding = Math.max(Math.abs(effect.radius) * 2, Math.abs(effect.spread))
      overflow = Math.max(
        overflow,
        filterPadding + Math.abs(effect.offset.x),
        filterPadding + Math.abs(effect.offset.y)
      )
    }
  }
  return overflow
}

function sceneBackingCullPaddingDevicePx(
  graph: SceneGraph,
  childIds: readonly string[],
  backing: ReturnType<typeof sceneBackingGeometry>,
  deviceWidth: number,
  deviceHeight: number
): number {
  const pending = [...childIds]
  const visited = new Set<string>()
  let maxWorldOverflow = 0
  while (pending.length > 0) {
    const nodeId = pending.pop()
    if (!nodeId || visited.has(nodeId)) continue
    visited.add(nodeId)
    const node = graph.getNode(nodeId)
    if (!node) continue
    const overflow = nodeVisualOverflow(node)
    if (!Number.isFinite(overflow)) return Math.max(deviceWidth, deviceHeight)
    maxWorldOverflow = Math.max(maxWorldOverflow, overflow)
    pending.push(...node.childIds)
  }

  const effectPadding = Math.ceil(maxWorldOverflow * backing.zoom * backing.dpr)
  return Math.min(
    Math.max(deviceWidth, deviceHeight),
    Math.max(SCENE_BACKING_TILE_CULL_PADDING_DEVICE_PX, effectPadding)
  )
}

function sceneBackingTiles(
  backing: ReturnType<typeof sceneBackingGeometry>,
  graph: SceneGraph,
  childIds: readonly string[]
): SceneBackingTile[] {
  const deviceWidth = Math.max(1, Math.floor(backing.width * backing.dpr))
  const deviceHeight = Math.max(1, Math.floor(backing.height * backing.dpr))
  const deviceWorldScale = Math.max(Number.EPSILON, backing.zoom * backing.dpr)
  const cullPaddingDevicePx = sceneBackingCullPaddingDevicePx(
    graph,
    childIds,
    backing,
    deviceWidth,
    deviceHeight
  )
  const tiles: SceneBackingTile[] = []
  let sequence = 0

  for (let deviceY = 0; deviceY < deviceHeight; deviceY += SCENE_BACKING_TILE_DEVICE_PX) {
    const tileDeviceHeight = Math.min(SCENE_BACKING_TILE_DEVICE_PX, deviceHeight - deviceY)
    for (let deviceX = 0; deviceX < deviceWidth; deviceX += SCENE_BACKING_TILE_DEVICE_PX) {
      const tileDeviceWidth = Math.min(SCENE_BACKING_TILE_DEVICE_PX, deviceWidth - deviceX)
      const cullDeviceX = Math.max(0, deviceX - cullPaddingDevicePx)
      const cullDeviceY = Math.max(0, deviceY - cullPaddingDevicePx)
      const cullDeviceRight = Math.min(deviceWidth, deviceX + tileDeviceWidth + cullPaddingDevicePx)
      const cullDeviceBottom = Math.min(
        deviceHeight,
        deviceY + tileDeviceHeight + cullPaddingDevicePx
      )
      tiles.push({
        sequence: sequence++,
        worldX: backing.worldX + deviceX / deviceWorldScale,
        worldY: backing.worldY + deviceY / deviceWorldScale,
        worldWidth: tileDeviceWidth / deviceWorldScale,
        worldHeight: tileDeviceHeight / deviceWorldScale,
        cullX: backing.worldX + cullDeviceX / deviceWorldScale,
        cullY: backing.worldY + cullDeviceY / deviceWorldScale,
        cullWidth: (cullDeviceRight - cullDeviceX) / deviceWorldScale,
        cullHeight: (cullDeviceBottom - cullDeviceY) / deviceWorldScale
      })
    }
  }

  const centerX = backing.worldX + backing.worldWidth / 2
  const centerY = backing.worldY + backing.worldHeight / 2
  return tiles.sort((first, second) => {
    const firstDx = first.worldX + first.worldWidth / 2 - centerX
    const firstDy = first.worldY + first.worldHeight / 2 - centerY
    const secondDx = second.worldX + second.worldWidth / 2 - centerX
    const secondDy = second.worldY + second.worldHeight / 2 - centerY
    return (
      firstDx * firstDx + firstDy * firstDy - (secondDx * secondDx + secondDy * secondDy) ||
      first.sequence - second.sequence
    )
  })
}

function renderBackingTile(
  r: SkiaRenderer,
  build: NonNullable<SkiaRenderer['sceneBackingBuild']>,
  tile: SceneBackingTile
): void {
  const canvas = build.surface.getCanvas()
  const previousViewport = r.worldViewport
  const initialSaveCount = canvas.getSaveCount()
  try {
    r.worldViewport = {
      x: tile.cullX,
      y: tile.cullY,
      w: tile.cullWidth,
      h: tile.cullHeight
    }
    canvas.save()
    canvas.scale(build.dpr, build.dpr)
    canvas.translate(build.panX, build.panY)
    canvas.scale(build.zoom, build.zoom)
    canvas.clipRect(
      r.ck.LTRBRect(
        tile.worldX,
        tile.worldY,
        tile.worldX + tile.worldWidth,
        tile.worldY + tile.worldHeight
      ),
      r.ck.ClipOp.Intersect,
      false
    )
    for (const childId of build.childIds) r.renderNode(canvas, build.graph, childId, {})
  } finally {
    r.worldViewport = previousViewport
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
  // The flushed snapshot owns its raster pixels. Keeping the recording pictures would retain all
  // source SkImages independently of the decoded-image LRU with no benefit to this completed frame.
  clearSubtreePictureCache(r)
}

function cancelSceneBackingBuild(r: SkiaRenderer): void {
  const build = r.sceneBackingBuild
  if (build) sceneBackingBuildTiles.delete(build)
  build?.surface.delete()
  r.sceneBackingBuild = null
  clearSubtreePictureCache(r)
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
    build.dpr === backing.dpr &&
    build.width === backing.width &&
    build.height === backing.height
  )
}

function startSceneBackingBuild(r: SkiaRenderer, graph: SceneGraph, sceneVersion: number): boolean {
  if (r.sceneBackingBuild) cancelSceneBackingBuild(r)
  const backing = sceneBackingGeometry(r)
  const pageNode = graph.getNode(r.pageId ?? graph.rootId)
  const surface = createSceneBackingSurface(r, backing.width, backing.height, backing.dpr)
  if (!surface) return false
  try {
    surface.getCanvas().clear(r.ck.Color4f(r.pageColor.r, r.pageColor.g, r.pageColor.b, 1))
  } catch {
    surface.delete()
    return false
  }
  clearSubtreePictureCache(r)
  const build: NonNullable<SkiaRenderer['sceneBackingBuild']> = {
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
  r.sceneBackingBuild = build
  sceneBackingBuildTiles.set(
    build,
    build.childIds.length > 0 ? sceneBackingTiles(backing, graph, build.childIds) : []
  )
  return true
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

  const backing = sceneBackingGeometryFromBuild(build)
  const tiles = sceneBackingBuildTiles.get(build)
  if (!tiles) {
    cancelSceneBackingBuild(r)
    return false
  }
  try {
    const profile = canvasPerformanceProfile(r.performanceMode)
    const stepStartedAt = now()
    let tilesRendered = 0
    while (build.index < tiles.length && tilesRendered < profile.sceneBackingMaxTilesPerStep) {
      if (
        tilesRendered > 0 &&
        profile.sceneBackingBuildStepBudgetMs !== null &&
        now() - stepStartedAt >= profile.sceneBackingBuildStepBudgetMs
      ) {
        break
      }
      const tile = tiles[build.index]
      renderBackingTile(r, build, tile)
      build.index++
      tilesRendered++
    }
    // Submit only the commands recorded by this bounded tile step. Deferring every GPU command
    // until the final snapshot would merely move the original whole-page stall to the last frame.
    build.surface.flush()
  } catch {
    cancelSceneBackingBuild(r)
    return false
  }

  if (build.index < tiles.length) return true

  let image: CKImage
  try {
    image = build.surface.makeImageSnapshot()
  } catch {
    cancelSceneBackingBuild(r)
    return false
  }
  sceneBackingBuildTiles.delete(build)
  build.surface.delete()
  r.sceneBackingBuild = null
  installSceneBackingImage(r, image, build.sceneVersion, build.positionPreviewVersion, backing)
  r.sceneBackingAverageRecordMs = smoothAverage(
    r.sceneBackingAverageRecordMs,
    clamp(now() - build.startedAt, 1, 1_000)
  )
  return true
}

export function renderSceneBacking(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  sceneVersion: number
): boolean {
  if (r.sceneBackingAllocationFailed) return false
  const positionPreviewVersion = graph.positionPreviewVersion
  const allowStaleZoom = now() < r.sceneBackingPreviewUntil
  const hasCoverage = backingCoverageContainsLiveViewport(
    r,
    sceneVersion,
    allowStaleZoom,
    positionPreviewVersion
  )
  if (!r.sceneBacking || !hasCoverage) {
    // First paint and metadata rebuilds use the same bounded path. A valid initial build owns the
    // scene layer while the pipeline's page-color clear remains visible; falling through to the
    // live renderer here would synchronously replay the very whole page this builder is slicing.
    if (!sceneBackingBuildMatches(r, sceneVersion)) startSceneBackingBuild(r, graph, sceneVersion)
  }
  if (r.sceneBackingBuild) {
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
  if (drewCurrent) return true
  if (r.sceneBackingBuild) {
    // The offscreen build is valid and will advance on the next scheduled scene frame. Preserve a
    // completed stale frame when available; otherwise the already-cleared page color is the safe,
    // responsive initial placeholder until the final snapshot can be installed atomically.
    drawLastGoodSceneBacking(r, canvas)
    return true
  }
  if (!hasCoverage) {
    // Allocation or recording failed. Presenting the stale image as a successful retained draw
    // would permanently suppress the viewport-culling live fallback in the render pipeline.
    return false
  }
  return drawLastGoodSceneBacking(r, canvas)
}
