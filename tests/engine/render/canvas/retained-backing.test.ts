import { expect, mock, test } from 'bun:test'

import type { Canvas, Image as CKImage, SkPicture, Surface } from 'canvaskit-wasm'

import { SceneGraph } from '@open-pencil/scene-graph'

import { DEFAULT_CANVAS_PERFORMANCE_MODE } from '#core/canvas'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { recoverLastGoodFrame } from '#core/canvas/renderer/pipeline'
import {
  drawLastGoodSceneBacking,
  renderSceneBacking,
  sceneBackingScaleForViewport
} from '#core/canvas/renderer/retained-backing'

function createRenderer(surfaceFactory: (descriptor?: unknown) => Surface | null) {
  const renderer: Partial<SkiaRenderer> = {
    ck: {
      AlphaType: { Premul: 'Premul' },
      ColorSpace: { SRGB: 'SRGB' },
      ColorType: { RGBA_8888: 'RGBA_8888' },
      Color4f: mock((r: number, g: number, b: number, a: number) => [r, g, b, a]),
      LTRBRect: mock((left: number, top: number, right: number, bottom: number) => [
        left,
        top,
        right,
        bottom
      ]),
      ClipOp: { Intersect: 'Intersect' },
      FilterMode: { Linear: 'Linear' },
      MipmapMode: { None: 'None' }
    } as SkiaRenderer['ck'],
    surface: {
      makeSurface: mock(surfaceFactory)
    } as SkiaRenderer['surface'],
    opacityPaint: {
      setAlphaf: mock()
    } as SkiaRenderer['opacityPaint'],
    panX: 0,
    panY: 0,
    zoom: 1,
    dpr: 1,
    viewportWidth: 100,
    viewportHeight: 100,
    pageColor: { r: 1, g: 1, b: 1 },
    pageId: 'page',
    fontGeneration: 0,
    sceneBacking: null,
    sceneBackingBuild: null,
    sceneBackingNeedsCrispRender: false,
    sceneBackingPreviewUntil: 0,
    sceneBackingAverageRecordMs: 40,
    sceneBackingAverageViewportIntervalMs: 80,
    performanceMode: DEFAULT_CANVAS_PERFORMANCE_MODE,
    scenePictureVersion: 0,
    scenePicturePositionPreviewVersion: 0,
    scenePicturePageId: null,
    subtreePictureCache: new Map(),
    subtreePictureCachePageId: null,
    subtreePictureCacheSceneVersion: 0,
    subtreePictureCachePositionPreviewVersion: 0,
    subtreePictureCacheFontGeneration: 0,
    worldViewport: { x: 0, y: 0, w: 0, h: 0 },
    renderNode: mock()
  }
  return renderer as SkiaRenderer
}

function createCanvas() {
  const canvas: Partial<Canvas> = {
    drawImageRect: mock(),
    drawImageRectOptions: mock()
  }
  return canvas as Canvas
}

function createGraph(positionPreviewVersion = 0) {
  const graph: Partial<SceneGraph> = {
    rootId: 'root',
    positionPreviewVersion,
    getNode: mock((id: string) => {
      if (id === 'page') return { id: 'page', type: 'CANVAS', childIds: [] }
      return null
    }),
    getAbsolutePosition: mock(() => ({ x: 0, y: 0 }))
  }
  return graph as SceneGraph
}

test('retained scene backing falls back when CanvasKit cannot create an offscreen surface', () => {
  const r = createRenderer(() => null)
  const canvas = createCanvas()
  const graph = createGraph()

  expect(renderSceneBacking(r, canvas, graph, 1)).toBe(false)
  expect(r.surface.makeSurface).toHaveBeenCalled()
  expect(canvas.drawImageRectOptions).not.toHaveBeenCalled()
  expect(r.sceneBacking).toBeNull()
})

test('retained scene backing caps device-pixel allocations on large high-DPI viewports', () => {
  let allocation: { width: number; height: number } | null = null
  const r = createRenderer((descriptor) => {
    allocation = descriptor as { width: number; height: number }
    return null
  })
  r.viewportWidth = 2_560
  r.viewportHeight = 1_600
  r.dpr = 2

  expect(sceneBackingScaleForViewport(r.viewportWidth, r.viewportHeight, r.dpr)).toBe(1)
  expect(renderSceneBacking(r, createCanvas(), createGraph(), 1)).toBe(false)
  expect(allocation).not.toBeNull()
  if (!allocation) throw new Error('Expected a retained-backing allocation attempt')
  expect(allocation.width * allocation.height).toBeLessThanOrEqual(12_000_000)
})

test('resource-saving retained backing reduces coverage and allocation footprint', () => {
  let allocation: { width: number; height: number } | null = null
  const r = createRenderer((descriptor) => {
    allocation = descriptor as { width: number; height: number }
    return null
  })
  r.performanceMode = 'resource-saving'
  r.viewportWidth = 1_000
  r.viewportHeight = 800
  r.dpr = 2

  expect(sceneBackingScaleForViewport(1_000, 800, 2, 'resource-saving')).toBeCloseTo(
    Math.sqrt(6_000_000 / 3_200_000)
  )
  expect(renderSceneBacking(r, createCanvas(), createGraph(), 1)).toBe(false)
  expect(allocation).not.toBeNull()
  if (!allocation) throw new Error('Expected a retained-backing allocation attempt')
  expect(allocation.width * allocation.height).toBeLessThanOrEqual(6_000_000)
})

test('retained scene backing treats allocation exceptions as a safe live-render fallback', () => {
  const r = createRenderer(() => {
    throw new Error('GPU allocation failed')
  })

  expect(() => renderSceneBacking(r, createCanvas(), createGraph(), 1)).not.toThrow()
  expect(r.sceneBacking).toBeNull()
})

test('last-good recovery is no-throw even when the surface cannot return a canvas', () => {
  const r = createRenderer(() => null)
  const lostSurface: Partial<Surface> = {
    getCanvas: mock(() => {
      throw new Error('surface lost')
    })
  }
  r.surface = lostSurface as Surface

  expect(() => recoverLastGoodFrame(r)).not.toThrow()
  expect(recoverLastGoodFrame(r)).toBe(false)
})

test('clearing an overlay surface is not reported as a recovered scene frame', () => {
  const partialCanvas: Partial<Canvas> = {
    getSaveCount: mock(() => 0),
    clear: mock(),
    restoreToCount: mock()
  }
  const canvas = partialCanvas as Canvas
  const r = createRenderer(() => null)
  const overlaySurface: Partial<Surface> = {
    getCanvas: mock(() => canvas),
    flush: mock()
  }
  r.surface = overlaySurface as Surface

  expect(recoverLastGoodFrame(r, 'overlays')).toBe(false)
  expect(r.surface.flush).toHaveBeenCalled()
})

test('last-good scene backing can be restored after graph metadata changes', () => {
  const r = createRenderer(() => null)
  r.sceneBacking = {
    image: { delete: mock() } as CKImage,
    pageId: 'page',
    sceneVersion: 1,
    positionPreviewVersion: 0,
    fontGeneration: 0,
    panX: 0,
    panY: 0,
    zoom: 1,
    width: 300,
    height: 300,
    dpr: 1,
    worldX: 0,
    worldY: 0,
    worldWidth: 300,
    worldHeight: 300
  } as NonNullable<SkiaRenderer['sceneBacking']>
  const canvas = createCanvas()

  expect(drawLastGoodSceneBacking(r, canvas)).toBe(true)
  expect(canvas.drawImageRectOptions).toHaveBeenCalled()
})

test('balanced to smooth hot switch reuses identical completed backing geometry', () => {
  const r = createRenderer(() => null)
  r.sceneBacking = {
    image: { delete: mock() } as CKImage,
    pageId: 'page',
    sceneVersion: 1,
    positionPreviewVersion: 0,
    fontGeneration: 0,
    panX: 100,
    panY: 100,
    zoom: 1,
    width: 300,
    height: 300,
    dpr: 1,
    worldX: -100,
    worldY: -100,
    worldWidth: 300,
    worldHeight: 300
  }
  r.performanceMode = 'smooth'
  const canvas = createCanvas()

  expect(renderSceneBacking(r, canvas, createGraph(), 1)).toBe(true)
  expect(r.surface.makeSurface).not.toHaveBeenCalled()
  expect(canvas.drawImageRectOptions).toHaveBeenCalledTimes(1)
})

test('scene-version changes rebuild incrementally while presenting the last-good frame', () => {
  const partialBuildCanvas: Partial<Canvas> = {
    clear: mock(),
    getSaveCount: mock(() => 0),
    save: mock(),
    scale: mock(),
    translate: mock(),
    clipRect: mock(),
    restoreToCount: mock()
  }
  const buildCanvas = partialBuildCanvas as Canvas
  const partialBuildSurface: Partial<Surface> = {
    getCanvas: mock(() => buildCanvas),
    flush: mock(),
    makeImageSnapshot: mock(),
    delete: mock()
  }
  const buildSurface = partialBuildSurface as Surface
  const r = createRenderer(() => buildSurface)
  r.viewportWidth = 400
  r.viewportHeight = 400
  const oldImage = { delete: mock() } as CKImage
  r.sceneBacking = {
    image: oldImage,
    pageId: 'page',
    sceneVersion: 1,
    positionPreviewVersion: 0,
    fontGeneration: 0,
    panX: 100,
    panY: 100,
    zoom: 1,
    width: 300,
    height: 300,
    dpr: 1,
    worldX: -100,
    worldY: -100,
    worldWidth: 300,
    worldHeight: 300
  }
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  r.pageId = page.id
  r.sceneBacking.pageId = page.id
  const first = graph.createNode('RECTANGLE', page.id, { width: 10, height: 10 })
  graph.createNode('RECTANGLE', page.id, { x: 20, width: 10, height: 10 })
  const stalePicture = { delete: mock() }
  r.subtreePictureCachePageId = page.id
  r.subtreePictureCacheSceneVersion = 2
  r.subtreePictureCachePositionPreviewVersion = graph.positionPreviewVersion
  r.subtreePictureCacheFontGeneration = r.fontGeneration
  r.subtreePictureCache.set(first.id, {
    picture: stalePicture as SkPicture,
    pageId: page.id,
    sceneVersion: 2,
    positionPreviewVersion: graph.positionPreviewVersion,
    fontGeneration: r.fontGeneration
  })
  const canvas = createCanvas()

  expect(renderSceneBacking(r, canvas, graph, 2)).toBe(true)
  expect(r.sceneBackingBuild?.index).toBe(1)
  expect(r.sceneBacking?.image).toBe(oldImage)
  expect(oldImage.delete).not.toHaveBeenCalled()
  expect(canvas.drawImageRectOptions).toHaveBeenCalled()
  expect(partialBuildSurface.flush).toHaveBeenCalledTimes(1)
  expect(partialBuildSurface.makeImageSnapshot).not.toHaveBeenCalled()
  expect(r.sceneBackingNeedsCrispRender).toBe(true)
  expect(r.subtreePictureCache.size).toBe(0)
  expect(stalePicture.delete).toHaveBeenCalledTimes(1)
})

test('first retained backing slices one huge top-level root and installs only the final snapshot', () => {
  const partialBuildCanvas: Partial<Canvas> = {
    clear: mock(),
    getSaveCount: mock(() => 0),
    save: mock(),
    scale: mock(),
    translate: mock(),
    clipRect: mock(),
    restoreToCount: mock()
  }
  const buildCanvas = partialBuildCanvas as Canvas
  const snapshot = { delete: mock() } as CKImage
  const partialBuildSurface: Partial<Surface> = {
    getCanvas: mock(() => buildCanvas),
    flush: mock(),
    makeImageSnapshot: mock(() => snapshot),
    delete: mock()
  }
  const r = createRenderer(() => partialBuildSurface as Surface)
  r.viewportWidth = 400
  r.viewportHeight = 400
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  r.pageId = page.id
  const hugeRoot = graph.createNode('FRAME', page.id, {
    x: -500,
    y: -500,
    width: 2_000,
    height: 2_000
  })
  const canvas = createCanvas()

  expect(renderSceneBacking(r, canvas, graph, 1)).toBe(true)
  expect(r.sceneBackingBuild?.index).toBe(1)
  expect(r.sceneBacking).toBeNull()
  expect(partialBuildSurface.flush).toHaveBeenCalledTimes(1)
  expect(partialBuildSurface.makeImageSnapshot).not.toHaveBeenCalled()
  expect(canvas.drawImageRectOptions).not.toHaveBeenCalled()
  expect(r.renderNode).toHaveBeenCalledTimes(1)
  expect(r.renderNode).toHaveBeenLastCalledWith(buildCanvas, graph, hugeRoot.id, {})
  expect(r.sceneBackingNeedsCrispRender).toBe(true)

  expect(renderSceneBacking(r, canvas, graph, 1)).toBe(true)
  expect(r.sceneBackingBuild?.index).toBe(2)
  expect(r.sceneBacking).toBeNull()
  expect(partialBuildSurface.flush).toHaveBeenCalledTimes(2)
  expect(partialBuildSurface.makeImageSnapshot).not.toHaveBeenCalled()
  expect(canvas.drawImageRectOptions).not.toHaveBeenCalled()

  let buildSteps = 2
  while (r.sceneBackingBuild && buildSteps < 20) {
    expect(renderSceneBacking(r, canvas, graph, 1)).toBe(true)
    buildSteps++
  }

  expect(buildSteps).toBe(9)
  expect(partialBuildSurface.flush).toHaveBeenCalledTimes(buildSteps)
  expect(partialBuildSurface.makeImageSnapshot).toHaveBeenCalledTimes(1)
  expect(partialBuildSurface.delete).toHaveBeenCalledTimes(1)
  expect(r.renderNode).toHaveBeenCalledTimes(buildSteps)
  expect(partialBuildCanvas.clipRect).toHaveBeenCalledTimes(buildSteps)
  expect(r.sceneBackingBuild).toBeNull()
  expect(r.sceneBacking?.image).toBe(snapshot)
  expect(canvas.drawImageRectOptions).toHaveBeenCalledTimes(1)
  expect(r.sceneBackingNeedsCrispRender).toBe(false)
})

test('smooth mode advances at most four retained tiles in one build step', () => {
  const partialBuildCanvas: Partial<Canvas> = {
    clear: mock(),
    getSaveCount: mock(() => 0),
    save: mock(),
    scale: mock(),
    translate: mock(),
    clipRect: mock(),
    restoreToCount: mock()
  }
  const partialBuildSurface: Partial<Surface> = {
    getCanvas: mock(() => partialBuildCanvas as Canvas),
    flush: mock(),
    makeImageSnapshot: mock(),
    delete: mock()
  }
  const r = createRenderer(() => partialBuildSurface as Surface)
  r.performanceMode = 'smooth'
  r.viewportWidth = 400
  r.viewportHeight = 400
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  r.pageId = page.id
  graph.createNode('FRAME', page.id, {
    x: -500,
    y: -500,
    width: 2_000,
    height: 2_000
  })

  expect(renderSceneBacking(r, createCanvas(), graph, 1)).toBe(true)
  expect(r.sceneBackingBuild?.index).toBe(4)
  expect(r.renderNode).toHaveBeenCalledTimes(4)
  expect(partialBuildCanvas.clipRect).toHaveBeenCalledTimes(4)
  expect(partialBuildSurface.flush).toHaveBeenCalledTimes(1)
  expect(partialBuildSurface.makeImageSnapshot).not.toHaveBeenCalled()
})

test('smooth mode stops retained tile work when its six millisecond step budget is spent', () => {
  const originalNow = performance.now
  let nowCalls = 0
  performance.now = mock(() => [0, 0, 0, 7][nowCalls++] ?? 7)
  try {
    const partialBuildCanvas: Partial<Canvas> = {
      clear: mock(),
      getSaveCount: mock(() => 0),
      save: mock(),
      scale: mock(),
      translate: mock(),
      clipRect: mock(),
      restoreToCount: mock()
    }
    const partialBuildSurface: Partial<Surface> = {
      getCanvas: mock(() => partialBuildCanvas as Canvas),
      flush: mock(),
      makeImageSnapshot: mock(),
      delete: mock()
    }
    const r = createRenderer(() => partialBuildSurface as Surface)
    r.performanceMode = 'smooth'
    r.viewportWidth = 400
    r.viewportHeight = 400
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    r.pageId = page.id
    graph.createNode('FRAME', page.id, {
      x: -500,
      y: -500,
      width: 2_000,
      height: 2_000
    })

    expect(renderSceneBacking(r, createCanvas(), graph, 1)).toBe(true)
    expect(r.sceneBackingBuild?.index).toBe(1)
    expect(r.renderNode).toHaveBeenCalledTimes(1)
    expect(partialBuildSurface.flush).toHaveBeenCalledTimes(1)
  } finally {
    performance.now = originalNow
  }
})

test('retained backing expands tile culling for effects larger than the default seam padding', () => {
  const partialBuildCanvas: Partial<Canvas> = {
    clear: mock(),
    getSaveCount: mock(() => 0),
    save: mock(),
    scale: mock(),
    translate: mock(),
    clipRect: mock(),
    restoreToCount: mock()
  }
  const partialBuildSurface: Partial<Surface> = {
    getCanvas: mock(() => partialBuildCanvas as Canvas),
    flush: mock(),
    makeImageSnapshot: mock(),
    delete: mock()
  }
  const r = createRenderer(() => partialBuildSurface as Surface)
  r.viewportWidth = 400
  r.viewportHeight = 400
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  r.pageId = page.id
  graph.createNode('RECTANGLE', page.id, {
    width: 100,
    height: 100,
    effects: [
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 1 },
        offset: { x: 0, y: 0 },
        radius: 300,
        spread: 0,
        visible: true
      }
    ]
  })
  const visitedViewports: SkiaRenderer['worldViewport'][] = []
  r.renderNode = mock(() => visitedViewports.push({ ...r.worldViewport }))

  expect(renderSceneBacking(r, createCanvas(), graph, 1)).toBe(true)
  expect(visitedViewports).toEqual([
    {
      x: -400,
      y: -400,
      w: 1_200,
      h: 1_200
    }
  ])
})

test('retained scene backing filters cross-zoom previews instead of falling back to live rendering', () => {
  const r = createRenderer(() => null)
  r.zoom = 1
  r.sceneBackingPreviewUntil = Number.POSITIVE_INFINITY
  r.sceneBacking = {
    image: { delete: mock() } as CKImage,
    pageId: 'page',
    sceneVersion: 1,
    positionPreviewVersion: 0,
    fontGeneration: 0,
    panX: 0,
    panY: 0,
    zoom: 0.5,
    width: 300,
    height: 300,
    dpr: 1,
    worldX: 0,
    worldY: 0,
    worldWidth: 600,
    worldHeight: 600
  } as NonNullable<SkiaRenderer['sceneBacking']>
  const canvas = createCanvas()
  const graph = createGraph()

  expect(renderSceneBacking(r, canvas, graph, 1)).toBe(true)
  expect(canvas.drawImageRectOptions).toHaveBeenCalledWith(
    r.sceneBacking.image,
    expect.anything(),
    expect.anything(),
    r.ck.FilterMode.Linear,
    r.ck.MipmapMode.None,
    r.opacityPaint
  )
})

test('retained scene backing allows same-zoom previews while panning', () => {
  const r = createRenderer(() => null)
  r.zoom = 1
  r.sceneBackingPreviewUntil = Number.POSITIVE_INFINITY
  r.sceneBacking = {
    image: { delete: mock() } as CKImage,
    pageId: 'page',
    sceneVersion: 1,
    positionPreviewVersion: 0,
    fontGeneration: 0,
    panX: 0,
    panY: 0,
    zoom: 1,
    width: 300,
    height: 300,
    dpr: 1,
    worldX: 0,
    worldY: 0,
    worldWidth: 300,
    worldHeight: 300
  } as NonNullable<SkiaRenderer['sceneBacking']>
  const canvas = createCanvas()
  const graph = createGraph()

  expect(renderSceneBacking(r, canvas, graph, 1)).toBe(true)
  expect(canvas.drawImageRectOptions).toHaveBeenCalled()
})

test('retained scene backing falls back live when a metadata rebuild cannot start', () => {
  const r = createRenderer(() => null)
  r.sceneBacking = {
    image: { delete: mock() } as CKImage,
    pageId: 'page',
    sceneVersion: 1,
    positionPreviewVersion: 1,
    fontGeneration: 0,
    panX: 0,
    panY: 0,
    zoom: 1,
    width: 100,
    height: 100,
    dpr: 1,
    worldX: 0,
    worldY: 0,
    worldWidth: 100,
    worldHeight: 100
  } as NonNullable<SkiaRenderer['sceneBacking']>
  r.scenePicturePositionPreviewVersion = 1
  const canvas = createCanvas()
  const graph = createGraph(2)

  expect(renderSceneBacking(r, canvas, graph, 1)).toBe(false)
  expect(canvas.drawImageRectOptions).not.toHaveBeenCalled()
})
