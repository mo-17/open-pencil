import { beforeAll, expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { initCanvasKit } from '#cli/headless'
import { SkiaRenderer } from '#core/canvas'
import { render } from '#core/canvas/renderer/pipeline'
import { renderSceneBacking } from '#core/canvas/renderer/retained-backing'

import { expectDefined } from '#tests/helpers/assert'

import { expectRgbaPixels } from './helpers'

let ck: Awaited<ReturnType<typeof initCanvasKit>>

beforeAll(async () => {
  ck = await initCanvasKit()
})

function createFixture() {
  const graph = new SceneGraph()
  const page = expectDefined(graph.getPages()[0], 'page')
  for (const x of [20, 40.25, 60.5, 80.75]) {
    graph.createNode('RECTANGLE', page.id, {
      x,
      y: 20,
      width: 1,
      height: 80,
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    })
  }
  return { graph, pageId: page.id }
}

function createRenderer(pageId: string) {
  const surface = expectDefined(ck.MakeSurface(2176, 2128), 'surface')
  const renderer = new SkiaRenderer(ck, surface)
  renderer.setPerformanceMode('smooth')
  renderer.viewportWidth = 1088
  renderer.viewportHeight = 1064
  renderer.dpr = 2
  renderer.pageId = pageId
  renderer.pageColor = { r: 1, g: 1, b: 1, a: 1 }
  renderer.panX = 0.125
  renderer.panY = 0.375
  return renderer
}

for (const scope of ['matching', 'scene', 'preview', 'page', 'font'] as const) {
  test(`backing installation preserves only a matching whole-scene picture: ${scope}`, () => {
    const { graph, pageId } = createFixture()
    const renderer = createRenderer(pageId)
    try {
      render(renderer, graph, new Set(), {}, 1, 'full')
      const picture = expectDefined(renderer.scenePicture, 'whole-scene picture')
      const deletion = spyOn(picture, 'delete')
      try {
        if (scope === 'scene') renderer.scenePictureVersion--
        if (scope === 'preview') renderer.scenePicturePositionPreviewVersion--
        if (scope === 'page') renderer.scenePicturePageId = null
        if (scope === 'font') renderer.scenePictureFontGeneration--
        expect(renderSceneBacking(renderer, renderer.surface.getCanvas(), graph, 1)).not.toBe(false)
        while (renderer.sceneBackingBuild) {
          expect(renderSceneBacking(renderer, renderer.surface.getCanvas(), graph, 1)).not.toBe(
            false
          )
        }
        expect(renderer.scenePicture).toBe(scope === 'matching' ? picture : null)
        expect(deletion).toHaveBeenCalledTimes(scope === 'matching' ? 0 : 1)
        expect(renderer.scenePictureVersion).toBe(1)
        expect(renderer.scenePicturePositionPreviewVersion).toBe(graph.positionPreviewVersion)
      } finally {
        deletion.mockRestore()
      }
    } finally {
      renderer.destroy()
    }
  })
}

/** Local retained builds have a bounded tile budget; settle only after every tile is installed. */
function settleBacking(renderer: SkiaRenderer, graph: SceneGraph, sceneVersion = 1) {
  for (let frame = 0; frame < 128; frame++) {
    renderer.sceneBackingPreviewUntil = 0
    renderer.render(graph, new Set(), {}, sceneVersion, 'scene')
    if (!renderer.sceneBackingNeedsCrispRender) return
  }
  throw new Error('Retained backing did not settle within the bounded build frames')
}

function pixels(renderer: SkiaRenderer) {
  renderer.surface.flush()
  const image = renderer.surface.makeImageSnapshot()
  try {
    return expectRgbaPixels(
      image.readPixels(0, 0, {
        width: 200,
        height: 220,
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.SRGB
      }),
      'scene pixels'
    )
  } finally {
    image.delete()
  }
}

function directPixels(renderer: SkiaRenderer, graph: SceneGraph, pageId: string) {
  const canvas = renderer.surface.getCanvas()
  canvas.clear(ck.WHITE)
  canvas.save()
  try {
    canvas.scale(renderer.dpr, renderer.dpr)
    canvas.translate(renderer.panX, renderer.panY)
    canvas.scale(renderer.zoom, renderer.zoom)
    renderer.renderSceneToCanvas(canvas, graph, pageId)
  } finally {
    canvas.restore()
  }
  return pixels(renderer)
}

test('capped backing preserves the pixel grid after fractional pan and pixel-density changes', () => {
  const { graph, pageId } = createFixture()
  const direct = createRenderer(pageId)
  const retained = createRenderer(pageId)
  try {
    for (const { pan, dpr, zoom } of [
      { pan: 0.125, dpr: 2, zoom: 1 },
      { pan: 0.25, dpr: 2, zoom: 1 },
      { pan: 0.25, dpr: 1, zoom: 1 },
      { pan: 0.25, dpr: 2, zoom: 1 },
      { pan: 0.1, dpr: 1.25, zoom: 1 },
      { pan: 0.3, dpr: 1.5, zoom: 1 },
      { pan: 0.3, dpr: 1.5, zoom: 1.00001 }
    ]) {
      direct.zoom = zoom
      retained.zoom = zoom
      direct.panX = pan
      retained.panX = pan
      direct.dpr = dpr
      retained.dpr = dpr
      retained.sceneBackingPreviewUntil = 0
      retained.render(graph, new Set(), {}, 1, 'scene')
      for (let frame = 0; frame < 128 && retained.sceneBackingNeedsCrispRender; frame++) {
        retained.sceneBackingPreviewUntil = 0
        retained.render(graph, new Set(), {}, 1, 'scene')
      }
      expect(retained.sceneBackingNeedsCrispRender).toBe(false)
      const backing = expectDefined(retained.sceneBacking, 'settled backing')
      expect(backing.zoom).toBe(zoom)
      expect(backing.anchorPanX).toBe(pan)
      // Matching an unchanged viewport must not repeatedly rebuild due to
      // floating-point subtraction of the overscan margin.
      retained.render(graph, new Set(), {}, 1, 'scene')
      expect(retained.sceneBacking).toBe(backing)
      const expected = directPixels(direct, graph, pageId)
      const actual = pixels(retained)
      const differingChannels = actual.reduce(
        (count, value, index) => count + Number(value !== expected[index]),
        0
      )
      expect(differingChannels).toBe(0)
    }
  } finally {
    direct.destroy()
    retained.destroy()
  }
}, 120_000)

test('settlement reuses pictures and the navigation image without another cache', () => {
  const { graph, pageId } = createFixture()
  const renderer = createRenderer(pageId)
  try {
    settleBacking(renderer, graph)
    const backing = expectDefined(renderer.sceneBacking, 'backing')
    const pictures = new Map(
      [...renderer.subtreePictureCache].map(([id, entry]) => [id, entry.picture])
    )
    expect(pictures.size).toBeGreaterThan(0)
    const nodeDraws = spyOn(renderer, 'renderNode')
    const allocations = spyOn(renderer.surface, 'makeSurface')
    try {
      renderer.sceneBackingPreviewUntil = 0
      renderer.render(graph, new Set(), {}, 1, 'scene')
      expect(renderer.profiler.stats.scenePictureMissReason).toBe('retained-pictures')
      expect(renderer.sceneBacking).toBe(backing)
      expect(renderer.scenePicture).toBeNull()
      expect(renderer.subtreePictureCache.size).toBe(pictures.size)
      for (const [id, picture] of pictures)
        expect(renderer.subtreePictureCache.get(id)?.picture).toBe(picture)
      expect(nodeDraws).not.toHaveBeenCalled()
      expect(allocations).not.toHaveBeenCalled()
      renderer.navigationPhase = 'pan'
      renderer.render(graph, new Set(), {}, 1, 'scene')
      expect(renderer.profiler.stats.scenePictureMissReason).toBe('backing')
      expect(renderer.sceneBacking).toBe(backing)
      expect(nodeDraws).not.toHaveBeenCalled()
      expect(allocations).not.toHaveBeenCalled()
    } finally {
      nodeDraws.mockRestore()
      allocations.mockRestore()
    }
  } finally {
    renderer.destroy()
  }
})

test('active edits draw directly without replacing the overscan backing', () => {
  const { graph, pageId } = createFixture()
  const renderer = createRenderer(pageId)
  try {
    settleBacking(renderer, graph)
    const backing = expectDefined(renderer.sceneBacking, 'initial backing')
    renderer.sceneBackingNeedsCrispRender = true
    renderer.tiledScenePending = true
    for (const sceneVersion of [2, 3, 4]) {
      render(renderer, graph, new Set(), {}, sceneVersion, 'scene', true)
      expect(renderer.sceneBacking).toBe(backing)
      expect(renderer.sceneBackingBuild).toBeNull()
      expect(renderer.sceneBackingNeedsCrispRender).toBe(false)
      expect(renderer.tiledScenePending).toBe(false)
      expect(renderer.profiler.stats.scenePictureMode).toBe('volatile')
      expect(renderer.profiler.stats.scenePictureMissReason).toBe('active-edit')
    }
    settleBacking(renderer, graph, 4)
    expect(renderer.sceneBacking?.sceneVersion).toBe(4)
    expect(renderer.sceneBacking).not.toBe(backing)
  } finally {
    renderer.destroy()
  }
}, 30_000)

test('tiled active edits release an unfinished backing build and preserve the completed image', () => {
  const { graph, pageId } = createFixture()
  const renderer = createRenderer(pageId)
  try {
    settleBacking(renderer, graph)
    const backing = expectDefined(renderer.sceneBacking, 'completed backing')
    const childId = expectDefined(graph.getNode(pageId)?.childIds[0], 'editable rectangle')
    graph.updateNode(childId, { width: 8 })
    renderer.tiledSceneEnabled = true
    renderer.sceneBackingPreviewUntil = 0
    expect(renderSceneBacking(renderer, renderer.surface.getCanvas(), graph, 2)).toBe('backing')
    const build = expectDefined(renderer.sceneBackingBuild, 'unfinished backing build')
    expect(build.index).toBeGreaterThan(0)
    const releaseBuild = spyOn(build.surface, 'delete')
    const releaseCompletedImage = spyOn(backing.image, 'delete')
    try {
      render(renderer, graph, new Set(), {}, 2, 'scene', true)
      expect(releaseBuild).toHaveBeenCalledTimes(1)
      expect(renderer.sceneBackingBuild).toBeNull()
      expect(renderer.sceneBacking).toBe(backing)
      expect(releaseCompletedImage).not.toHaveBeenCalled()
      expect(renderer.sceneBackingNeedsCrispRender).toBe(false)
      expect(renderer.tiledScenePending).toBe(false)
      expect(renderer.profiler.stats.scenePictureMode).toBe('volatile')
      expect(renderer.profiler.stats.scenePictureMissReason).toBe('active-edit')
      const livePixels = pixels(renderer)
      expect(livePixels).toEqual(directPixels(renderer, graph, pageId))
      render(renderer, graph, new Set(), {}, 3, 'scene', true)
      expect(releaseBuild).toHaveBeenCalledTimes(1)
      expect(renderer.sceneBacking).toBe(backing)
      settleBacking(renderer, graph, 3)
      expect(renderer.sceneBackingBuild).toBeNull()
      expect(renderer.sceneBacking?.sceneVersion).toBe(3)
      expect(renderer.sceneBacking).not.toBe(backing)
      expect(releaseCompletedImage).toHaveBeenCalledTimes(1)
    } finally {
      releaseBuild.mockRestore()
      releaseCompletedImage.mockRestore()
    }
  } finally {
    renderer.destroy()
  }
}, 30_000)

/** Read the visible surface itself, including every intermediate flush during the bounded build. */
function visibleCenterPixel(renderer: SkiaRenderer) {
  const image = renderer.surface.makeImageSnapshot()
  try {
    return Array.from(
      expectRgbaPixels(
        image.readPixels(80, 80, {
          width: 1,
          height: 1,
          colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Unpremul,
          colorSpace: ck.ColorSpace.SRGB
        }),
        'visible rectangle center'
      )
    )
  } finally {
    image.delete()
  }
}

function assertLiveFrameSurvivesBackingRebuild(changed: 'scene' | 'position-preview'): void {
  const graph = new SceneGraph()
  const page = expectDefined(graph.getPages()[0], 'page')
  const renderer = createRenderer(page.id)
  renderer.setPerformanceMode('balanced')
  const blue = {
    type: 'SOLID' as const,
    color: { r: 0, g: 0, b: 1, a: 1 },
    opacity: 1,
    visible: true
  }
  const grey = {
    type: 'SOLID' as const,
    color: { r: 217 / 255, g: 217 / 255, b: 217 / 255, a: 1 },
    opacity: 1,
    visible: true
  }
  const node =
    changed === 'position-preview'
      ? graph.createNode('RECTANGLE', page.id, {
          x: 20,
          y: 20,
          width: 80,
          height: 80,
          fills: [blue]
        })
      : null
  try {
    settleBacking(renderer, graph, 1)
    const previous = expectDefined(renderer.sceneBacking, 'completed old backing')
    const previousImage = previous.image
    expect(visibleCenterPixel(renderer)).toEqual(
      changed === 'scene' ? [255, 255, 255, 255] : [0, 0, 255, 255]
    )
    const deletion = spyOn(previousImage, 'delete')
    const originalFlush = renderer.surface.flush.bind(renderer.surface)
    const observed: number[][] = []
    const flush = spyOn(renderer.surface, 'flush').mockImplementation(() => {
      originalFlush()
      observed.push(visibleCenterPixel(renderer))
    })
    try {
      if (node) graph.updateNodePreview(node.id, { x: 21, fills: [grey] })
      else
        graph.createNode('RECTANGLE', page.id, {
          x: 20,
          y: 20,
          width: 80,
          height: 80,
          fills: [grey]
        })
      const liveVersion = changed === 'scene' ? 2 : 1
      render(renderer, graph, new Set(), {}, liveVersion, 'scene', true)
      expect(visibleCenterPixel(renderer)).toEqual([217, 217, 217, 255])
      // A committed preview advances the canvas version, ending position-preview live policy.
      // Its preceding live watermark still shares the OLD backing's scene version, so the
      // position-preview component (not the scene-version comparison) must reject that image.
      const committedVersion = changed === 'scene' ? 3 : 2
      renderer.sceneBackingPreviewUntil = 0
      renderer.render(graph, new Set(), {}, committedVersion, 'scene')
      expect(renderer.sceneBackingBuild).not.toBeNull()
      expect(renderer.sceneBacking).toBe(previous)
      expect(deletion).not.toHaveBeenCalled()
      // The old implementation presents the previous white/blue image here.
      expect(visibleCenterPixel(renderer)).toEqual([217, 217, 217, 255])
      settleBacking(renderer, graph, committedVersion)
      expect(observed.length).toBeGreaterThan(4)
      for (const rgba of observed) expect(rgba).toEqual([217, 217, 217, 255])
      expect(renderer.sceneBackingBuild).toBeNull()
      expect(renderer.sceneBacking?.sceneVersion).toBe(committedVersion)
      expect(renderer.sceneBacking?.positionPreviewVersion).toBe(graph.positionPreviewVersion)
      expect(renderer.sceneBacking).not.toBe(previous)
      expect(deletion).toHaveBeenCalledTimes(1)
    } finally {
      flush.mockRestore()
      deletion.mockRestore()
    }
    const completed = expectDefined(renderer.sceneBacking, 'new completed backing')
    renderer.replaceSurface(expectDefined(ck.MakeSurface(2176, 2128), 'replacement surface'))
    expect(renderer.lastLiveSceneContent).toBeNull()
    expect(renderer.sceneBacking).toBe(completed)
    const otherPage = graph.createNode('CANVAS', graph.rootId)
    renderer.pageId = otherPage.id
    renderer.render(graph, new Set(), {}, 1, 'scene')
    expect(renderer.lastLiveSceneContent).toBeNull()
    expect(visibleCenterPixel(renderer)).toEqual([255, 255, 255, 255])
    renderer.clearDocumentCaches()
    expect(renderer.lastLiveSceneContent).toBeNull()
    expect(renderer.sceneBacking).toBeNull()
  } finally {
    renderer.destroy()
  }
  expect(renderer.lastLiveSceneContent).toBeNull()
}

for (const changed of ['scene', 'position-preview'] as const) {
  test(
    `a completed backing cannot erase a newer live ${changed} frame while rebuilding`,
    () => assertLiveFrameSurvivesBackingRebuild(changed),
    30_000
  )
}
