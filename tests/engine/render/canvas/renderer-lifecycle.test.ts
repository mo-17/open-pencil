import { expect, mock, test } from 'bun:test'

import type { Font, Image as CKImage, Paint, Surface } from 'canvaskit-wasm'

import { SkiaRenderer } from '#core/canvas/renderer'
import { destroyRenderer } from '#core/canvas/renderer/lifecycle'
import { transferLastGoodFrame } from '#core/canvas/renderer/state'

function deletable<T>() {
  return { delete: mock() } as T & { delete: ReturnType<typeof mock> }
}

function createRenderer() {
  const renderer: Partial<SkiaRenderer> = {
    ck: {} as SkiaRenderer['ck'],
    destroyed: false,
    imageCache: new Map(),
    vectorPathCache: new Map(),
    vectorStrokePathCache: new Map(),
    vectorStrokeOutlineCache: new Map(),
    fillGeometryCache: new Map(),
    strokeGeometryCache: new Map(),
    fillPaint: deletable<Paint>(),
    strokePaint: deletable<Paint>(),
    selectionPaint: deletable<Paint>(),
    parentOutlinePaint: deletable<Paint>(),
    snapPaint: deletable<Paint>(),
    auxFill: deletable<Paint>(),
    auxStroke: deletable<Paint>(),
    opacityPaint: deletable<Paint>(),
    effectLayerPaint: deletable<Paint>(),
    generatedEffectPaint: deletable<Paint>(),
    textFont: deletable<Font>(),
    labelFont: deletable<Font>(),
    sizeFont: deletable<Font>(),
    sectionTitleFont: deletable<Font>(),
    componentLabelFont: deletable<Font>(),
    fontMgr: null,
    fontProvider: null,
    fontsLoaded: true,
    rulerBgPaint: deletable<Paint>(),
    rulerTickPaint: deletable<Paint>(),
    rulerTextPaint: deletable<Paint>(),
    rulerHlPaint: deletable<Paint>(),
    rulerBadgePaint: deletable<Paint>(),
    rulerLabelPaint: deletable<Paint>(),
    penPathPaint: deletable<Paint>(),
    penLiveStrokePaint: deletable<Paint>(),
    penHandlePaint: deletable<Paint>(),
    penVertexFill: deletable<Paint>(),
    penVertexStroke: deletable<Paint>(),
    imageFilterCache: new Map(),
    maskFilterCache: new Map(),
    nodePictureCache: new Map(),
    subtreePictureCache: new Map(),
    scenePicture: null,
    sceneBacking: null,
    sceneBackingBuild: null,
    sceneBackingNeedsCrispRender: false,
    sceneBackingPreviewUntil: 0,
    sceneBackingAverageRecordMs: 40,
    sceneBackingAverageViewportIntervalMs: 80,
    sceneBackingLastViewportEventAt: 0,
    lastSceneViewport: null,
    panX: 0,
    panY: 0,
    zoom: 1,
    dpr: 1,
    viewportWidth: 100,
    viewportHeight: 100,
    pageColor: { r: 1, g: 1, b: 1 },
    pageId: 'page',
    _flashPaint: null,
    profiler: { destroy: mock() } as Partial<SkiaRenderer['profiler']> as SkiaRenderer['profiler'],
    surface: deletable<Surface>()
  }
  return renderer as SkiaRenderer
}

test('destroyRenderer deletes all renderer-owned paints and label fonts', () => {
  const renderer = createRenderer()
  const parentOutlinePaint = renderer.parentOutlinePaint
  const generatedEffectPaint = renderer.generatedEffectPaint
  const sectionTitleFont = renderer.sectionTitleFont
  const componentLabelFont = renderer.componentLabelFont

  destroyRenderer(renderer)

  expect(parentOutlinePaint.delete).toHaveBeenCalled()
  expect(generatedEffectPaint.delete).toHaveBeenCalled()
  expect(sectionTitleFont?.delete).toHaveBeenCalled()
  expect(componentLabelFont?.delete).toHaveBeenCalled()
})

test('last-good frame ownership survives source renderer destruction', () => {
  const source = createRenderer()
  const target = createRenderer()
  target.ck = source.ck
  const image = deletable<CKImage>()
  source.sceneBacking = {
    image,
    pageId: 'page',
    sceneVersion: 3,
    positionPreviewVersion: 2,
    fontGeneration: 1,
    panX: 12,
    panY: 24,
    zoom: 1,
    width: 300,
    height: 200,
    dpr: 1,
    worldX: -12,
    worldY: -24,
    worldWidth: 300,
    worldHeight: 200
  }

  expect(transferLastGoodFrame(source, target)).toBe(true)
  expect(source.sceneBacking).toBeNull()
  expect(target.sceneBacking?.image).toBe(image)

  destroyRenderer(source)
  expect(image.delete).not.toHaveBeenCalled()

  destroyRenderer(target)
  expect(image.delete).toHaveBeenCalledTimes(1)
})

test('surface replacement keeps the completed frame and cancels only the stale build', () => {
  const renderer = createRenderer()
  const previousSurface = renderer.surface
  const replacementSurface = deletable<Surface>()
  const image = deletable<CKImage>()
  const buildSurface = deletable<Surface>()
  renderer.sceneBacking = {
    image,
    pageId: 'page',
    sceneVersion: 3,
    positionPreviewVersion: 2,
    fontGeneration: 1,
    panX: 0,
    panY: 0,
    zoom: 1,
    width: 300,
    height: 200,
    dpr: 1,
    worldX: 0,
    worldY: 0,
    worldWidth: 300,
    worldHeight: 200
  }
  renderer.sceneBackingBuild = { surface: buildSurface } as SkiaRenderer['sceneBackingBuild']

  SkiaRenderer.prototype.replaceSurface.call(renderer, replacementSurface)

  expect(renderer.surface).toBe(replacementSurface)
  expect(previousSurface.delete).toHaveBeenCalledTimes(1)
  expect(renderer.sceneBacking?.image).toBe(image)
  expect(image.delete).not.toHaveBeenCalled()
  expect(buildSurface.delete).toHaveBeenCalledTimes(1)
  expect(renderer.sceneBackingBuild).toBeNull()
  expect(renderer.sceneBackingNeedsCrispRender).toBe(true)
})
