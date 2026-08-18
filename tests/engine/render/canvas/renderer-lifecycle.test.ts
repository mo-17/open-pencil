import { expect, mock, test } from 'bun:test'

import type {
  Font,
  Image as CKImage,
  ImageFilter,
  MaskFilter,
  Paint,
  SkPicture,
  Surface
} from 'canvaskit-wasm'

import { SceneGraph } from '@open-pencil/scene-graph'

import { LabelCache } from '#core/canvas/labels/cache'
import { SkiaRenderer } from '#core/canvas/renderer'
import { destroyRenderer } from '#core/canvas/renderer/lifecycle'
import { transferLastGoodFrame, withIsolatedDocumentCaches } from '#core/canvas/renderer/state'

function deletable<T>() {
  return { delete: mock() } as T & { delete: ReturnType<typeof mock> }
}

function filterPaint() {
  return Object.assign(deletable<Paint>(), {
    setImageFilter: mock(),
    setMaskFilter: mock()
  })
}

function createRenderer() {
  const renderer: Partial<SkiaRenderer> = {
    ck: {} as SkiaRenderer['ck'],
    destroyed: false,
    imageCache: new Map(),
    imageCacheByteSize: 0,
    imageCacheByteBudget: 128 * 1024 * 1024,
    imageCacheFrameDepth: 0,
    imageCacheFrameUsed: new Set(),
    pendingFontNodes: new Map(),
    textPictureGenerations: new Map(),
    renderCacheGraph: null,
    renderCachePageId: null,
    vectorPathCache: new Map(),
    vectorStrokePathCache: new Map(),
    vectorStrokeOutlineCache: new Map(),
    fillGeometryCache: new Map(),
    strokeGeometryCache: new Map(),
    glyphSilhouetteCache: new Map(),
    fillPaint: deletable<Paint>(),
    strokePaint: deletable<Paint>(),
    selectionPaint: deletable<Paint>(),
    parentOutlinePaint: deletable<Paint>(),
    snapPaint: deletable<Paint>(),
    auxFill: filterPaint(),
    auxStroke: deletable<Paint>(),
    opacityPaint: deletable<Paint>(),
    effectLayerPaint: filterPaint(),
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
    nodePictureCacheGenerations: new Map(),
    subtreePictureCache: new Map(),
    labelCache: new LabelCache(),
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
  const cachedImage = deletable<CKImage>()
  renderer.imageCache.set('cached', { image: cachedImage, byteSize: 64 })
  renderer.imageCacheByteSize = 64
  renderer.imageCacheFrameDepth = 1
  renderer.imageCacheFrameUsed.add('cached')
  const parentOutlinePaint = renderer.parentOutlinePaint
  const generatedEffectPaint = renderer.generatedEffectPaint
  const sectionTitleFont = renderer.sectionTitleFont
  const componentLabelFont = renderer.componentLabelFont

  destroyRenderer(renderer)

  expect(parentOutlinePaint.delete).toHaveBeenCalled()
  expect(generatedEffectPaint.delete).toHaveBeenCalled()
  expect(sectionTitleFont?.delete).toHaveBeenCalled()
  expect(componentLabelFont?.delete).toHaveBeenCalled()
  expect(cachedImage.delete).toHaveBeenCalledTimes(1)
  expect(renderer.imageCacheByteSize).toBe(0)
  expect(renderer.imageCacheFrameDepth).toBe(0)
  expect(renderer.imageCacheFrameUsed.size).toBe(0)
})

test('last-good frame ownership survives source renderer destruction', () => {
  const source = createRenderer()
  const target = createRenderer()
  target.ck = source.ck
  const graph = {} as SkiaRenderer['renderCacheGraph']
  source.renderCacheGraph = graph
  source.renderCachePageId = 'page'
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
  expect(target.renderCacheGraph).toBe(graph)
  expect(target.renderCachePageId).toBe('page')

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
  const buildPicture = deletable<SkPicture>()
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
  renderer.subtreePictureCache.set('partial', {
    picture: buildPicture,
    pageId: 'page',
    sceneVersion: 4,
    positionPreviewVersion: 2,
    fontGeneration: 1
  })

  SkiaRenderer.prototype.replaceSurface.call(renderer, replacementSurface)

  expect(renderer.surface).toBe(replacementSurface)
  expect(previousSurface.delete).toHaveBeenCalledTimes(1)
  expect(renderer.sceneBacking?.image).toBe(image)
  expect(image.delete).not.toHaveBeenCalled()
  expect(buildSurface.delete).toHaveBeenCalledTimes(1)
  expect(buildPicture.delete).toHaveBeenCalledTimes(1)
  expect(renderer.subtreePictureCache.size).toBe(0)
  expect(renderer.sceneBackingBuild).toBeNull()
  expect(renderer.sceneBackingNeedsCrispRender).toBe(true)
})

test('isolated document caches restore warm filters and release temporary filters on failure', () => {
  const renderer = createRenderer()
  const warmImageFilter = deletable<ImageFilter>()
  const warmMaskFilter = deletable<MaskFilter>()
  const temporaryImageFilter = deletable<ImageFilter>()
  const temporaryMaskFilter = deletable<MaskFilter>()
  renderer.imageFilterCache.set('warm', warmImageFilter)
  renderer.maskFilterCache.set(1, warmMaskFilter)

  expect(() =>
    withIsolatedDocumentCaches(renderer, new SceneGraph(), 'export-page', () => {
      renderer.imageFilterCache.set('temporary', temporaryImageFilter)
      renderer.maskFilterCache.set(2, temporaryMaskFilter)
      renderer.effectLayerPaint.setImageFilter(temporaryImageFilter)
      renderer.auxFill.setImageFilter(temporaryImageFilter)
      renderer.auxFill.setMaskFilter(temporaryMaskFilter)
      throw new Error('synthetic export failure')
    })
  ).toThrow('synthetic export failure')

  expect(renderer.imageFilterCache.get('warm')).toBe(warmImageFilter)
  expect(renderer.maskFilterCache.get(1)).toBe(warmMaskFilter)
  expect(warmImageFilter.delete).not.toHaveBeenCalled()
  expect(warmMaskFilter.delete).not.toHaveBeenCalled()
  expect(temporaryImageFilter.delete).toHaveBeenCalledTimes(1)
  expect(temporaryMaskFilter.delete).toHaveBeenCalledTimes(1)
  expect(renderer.effectLayerPaint.setImageFilter).toHaveBeenLastCalledWith(null)
  expect(renderer.auxFill.setImageFilter).toHaveBeenLastCalledWith(null)
  expect(renderer.auxFill.setMaskFilter).toHaveBeenLastCalledWith(null)

  destroyRenderer(renderer)
  expect(warmImageFilter.delete).toHaveBeenCalledTimes(1)
  expect(warmMaskFilter.delete).toHaveBeenCalledTimes(1)
})
