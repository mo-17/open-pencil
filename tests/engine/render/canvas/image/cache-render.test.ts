import { beforeAll, expect, mock, test } from 'bun:test'

import type { Path } from 'canvaskit-wasm'

import { SceneGraph, SkiaRenderer } from '@open-pencil/core'

import { initCanvasKit } from '#cli/headless'

import { expectDefined } from '#tests/helpers/assert'

let ck: Awaited<ReturnType<typeof initCanvasKit>>

beforeAll(async () => {
  ck = await initCanvasKit()
})

function solidPNG(red: number, green: number, blue: number): Uint8Array {
  const surface = expectDefined(ck.MakeSurface(2, 2), 'source image surface')
  try {
    surface.getCanvas().clear(ck.Color4f(red, green, blue, 1))
    surface.flush()
    const image = surface.makeImageSnapshot()
    try {
      return expectDefined(image.encodeToBytes(), 'source image bytes')
    } finally {
      image.delete()
    }
  } finally {
    surface.delete()
  }
}

function renderedPixels(renderer: SkiaRenderer): Uint8Array {
  const image = renderer.surface.makeImageSnapshot()
  try {
    return expectDefined(
      image.readPixels(0, 0, {
        width: 8,
        height: 4,
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.SRGB
      }),
      'rendered pixels'
    )
  } finally {
    image.delete()
  }
}

function pixel(pixels: Uint8Array, x: number, y: number): number[] {
  const index = (y * 8 + x) * 4
  return Array.from(pixels.slice(index, index + 4))
}

function createImageRectangle(graph: SceneGraph, pageId: string, hash: string, x = 0): void {
  graph.createNode('RECTANGLE', pageId, {
    x,
    width: 4,
    height: 4,
    fills: [
      {
        type: 'IMAGE',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: hash,
        imageScaleMode: 'FILL'
      }
    ]
  })
}

function imageGraph(): { graph: SceneGraph; pageId: string } {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.images.set('red', solidPNG(1, 0, 0))
  graph.images.set('blue', solidPNG(0, 0, 1))

  for (const [index, hash] of ['red', 'blue'].entries()) {
    createImageRectangle(graph, page.id, hash, index * 4)
  }
  return { graph, pageId: page.id }
}

function visibleAndOffscreenImageGraph(): { graph: SceneGraph; pageId: string } {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.images.set('visible', solidPNG(1, 0, 0))
  graph.images.set('offscreen', solidPNG(0, 0, 1))
  createImageRectangle(graph, page.id, 'visible')
  createImageRectangle(graph, page.id, 'offscreen', 1_000)
  return { graph, pageId: page.id }
}

function visibleFrameWithOffscreenImageChildGraph(): { graph: SceneGraph; pageId: string } {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.images.set('visible-child', solidPNG(1, 0, 0))
  graph.images.set('offscreen-child', solidPNG(0, 0, 1))
  const frame = graph.createNode('FRAME', page.id, {
    width: 2_000,
    height: 4,
    clipsContent: false,
    fills: []
  })
  createImageRectangle(graph, frame.id, 'visible-child')
  createImageRectangle(graph, frame.id, 'offscreen-child', 1_000)
  return { graph, pageId: page.id }
}

function fixedIdentityImageGraph(
  hash: string,
  red: number,
  blue: number
): {
  graph: SceneGraph
  pageId: string
  nodeId: string
} {
  const graph = new SceneGraph()
  graph.deleteNode(graph.getPages()[0].id)
  const pageId = 'shared-page'
  const nodeId = 'shared-image-node'
  graph.createNodeWithId(pageId, 'CANVAS', graph.rootId, { name: 'Shared page' })
  graph.images.set(hash, solidPNG(red, 0, blue))
  const node = graph.createNodeWithId(nodeId, 'RECTANGLE', pageId, {
    width: 4,
    height: 4
  })
  node.fills = [
    {
      type: 'IMAGE',
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true,
      imageHash: hash,
      imageScaleMode: 'FILL'
    }
  ]
  return { graph, pageId, nodeId }
}

function configureInteractiveRenderer(renderer: SkiaRenderer, pageId: string): void {
  renderer.viewportWidth = 8
  renderer.viewportHeight = 4
  renderer.dpr = 1
  renderer.panX = 0
  renderer.panY = 0
  renderer.zoom = 1
  renderer.showRulers = false
  renderer.pageId = pageId
}

test('frame-scoped eviction preserves image fills retained by the scene picture', () => {
  const { graph, pageId } = imageGraph()

  const surface = expectDefined(ck.MakeSurface(8, 4), 'render surface')
  const renderer = new SkiaRenderer(ck, surface)
  configureInteractiveRenderer(renderer, pageId)
  renderer.imageCacheByteBudget = 22

  try {
    renderer.render(graph, new Set(), {}, 1)
    expect(renderer.imageCache.size).toBe(1)
    expect(pixel(renderedPixels(renderer), 1, 1)).toEqual([255, 0, 0, 255])
    expect(pixel(renderedPixels(renderer), 5, 1)).toEqual([0, 0, 255, 255])

    renderer.render(graph, new Set(), {}, 1)
    expect(renderer.profiler.stats.scenePictureMode).toBe('hit')
    const retainedPixels = renderedPixels(renderer)
    expect(pixel(retainedPixels, 1, 1)).toEqual([255, 0, 0, 255])
    expect(pixel(retainedPixels, 5, 1)).toEqual([0, 0, 255, 255])
  } finally {
    renderer.destroy()
  }
})

test('retained backing decodes only intersecting top-level image subtrees', () => {
  const { graph, pageId } = visibleAndOffscreenImageGraph()

  const surface = expectDefined(ck.MakeSurface(8, 4), 'retained render surface')
  const renderer = new SkiaRenderer(ck, surface)
  configureInteractiveRenderer(renderer, pageId)

  try {
    renderer.render(graph, new Set(), {}, 1, 'scene')

    expect(renderer.profiler.stats.scenePictureMode).toBe('hit')
    expect(renderer.profiler.stats.scenePictureMissReason).toBe('backing')
    expect(renderer.sceneBacking).not.toBeNull()
    expect(renderer.scenePicture).toBeNull()
    expect(renderer.subtreePictureCache.size).toBe(0)
    expect([...renderer.imageCache.keys()]).toEqual(['visible'])
    expect(pixel(renderedPixels(renderer), 1, 1)).toEqual([255, 0, 0, 255])
  } finally {
    renderer.destroy()
  }
})

test('retained backing culls offscreen image descendants inside a visible large frame', () => {
  const { graph, pageId } = visibleFrameWithOffscreenImageChildGraph()

  const surface = expectDefined(ck.MakeSurface(8, 4), 'nested retained render surface')
  const renderer = new SkiaRenderer(ck, surface)
  configureInteractiveRenderer(renderer, pageId)

  try {
    renderer.render(graph, new Set(), {}, 1, 'scene')

    expect(renderer.sceneBacking).not.toBeNull()
    expect(renderer.subtreePictureCache.size).toBe(0)
    expect([...renderer.imageCache.keys()]).toEqual(['visible-child'])
    expect(pixel(renderedPixels(renderer), 1, 1)).toEqual([255, 0, 0, 255])
  } finally {
    renderer.destroy()
  }
})

test('scene backing allocation failure uses viewport-culling live rendering', () => {
  const { graph, pageId } = visibleAndOffscreenImageGraph()

  const surface = expectDefined(ck.MakeSurface(8, 4), 'live fallback surface')
  Object.defineProperty(surface, 'makeSurface', { value: () => null })
  const renderer = new SkiaRenderer(ck, surface)
  configureInteractiveRenderer(renderer, pageId)

  try {
    renderer.render(graph, new Set(), {}, 1, 'scene')

    expect(renderer.profiler.stats.scenePictureMode).toBe('volatile')
    expect(renderer.profiler.stats.scenePictureMissReason).toBe('backing-unavailable')
    expect(renderer.sceneBacking).toBeNull()
    expect(renderer.scenePicture).toBeNull()
    expect([...renderer.imageCache.keys()]).toEqual(['visible'])
    expect(pixel(renderedPixels(renderer), 1, 1)).toEqual([255, 0, 0, 255])
  } finally {
    renderer.destroy()
  }
})

test('stale scene backing allocation failure falls back to live viewport rendering', () => {
  const { graph, pageId } = visibleAndOffscreenImageGraph()
  const surface = expectDefined(ck.MakeSurface(8, 4), 'stale fallback surface')
  const staleImage = expectDefined(ck.MakeImageFromEncoded(solidPNG(0, 1, 0)), 'stale image')
  Object.defineProperty(surface, 'makeSurface', { value: () => null })
  const renderer = new SkiaRenderer(ck, surface)
  configureInteractiveRenderer(renderer, pageId)
  renderer.sceneBacking = {
    image: staleImage,
    pageId,
    sceneVersion: 0,
    positionPreviewVersion: 0,
    fontGeneration: renderer.fontGeneration,
    panX: -1_000,
    panY: 0,
    zoom: 1,
    width: 8,
    height: 4,
    dpr: 1,
    worldX: 1_000,
    worldY: 0,
    worldWidth: 8,
    worldHeight: 4
  }

  try {
    renderer.render(graph, new Set(), {}, 1, 'scene')

    expect(renderer.profiler.stats.scenePictureMode).toBe('volatile')
    expect(renderer.profiler.stats.scenePictureMissReason).toBe('backing-unavailable')
    expect(renderer.sceneBackingBuild).toBeNull()
    expect([...renderer.imageCache.keys()]).toEqual(['visible'])
    expect(pixel(renderedPixels(renderer), 1, 1)).toEqual([255, 0, 0, 255])
  } finally {
    renderer.destroy()
  }
})

test('same-ID graph replacement deletes every document-scoped native path cache', () => {
  const first = fixedIdentityImageGraph('first-image', 1, 0)
  const second = fixedIdentityImageGraph('second-image', 0, 1)
  const surface = expectDefined(ck.MakeSurface(8, 4), 'graph replacement surface')
  const renderer = new SkiaRenderer(ck, surface)
  configureInteractiveRenderer(renderer, first.pageId)

  try {
    renderer.render(first.graph, new Set(), {}, 1)
    const firstDecodedImage = expectDefined(
      renderer.imageCache.get('first-image'),
      'first decoded image'
    ).image
    const pathDeletes = Array.from({ length: 5 }, () => mock(() => undefined))
    const paths = pathDeletes.map((deletePath) => ({ delete: deletePath }) as Path)
    renderer.vectorPathCache.set(first.nodeId, [paths[0]])
    renderer.vectorStrokePathCache.set(first.nodeId, [paths[1]])
    renderer.vectorStrokeOutlineCache.set(`${first.nodeId}|outline`, [paths[2]])
    renderer.fillGeometryCache.set(first.nodeId, [paths[3]])
    renderer.strokeGeometryCache.set(first.nodeId, [paths[4]])
    const firstNode = expectDefined(first.graph.getNode(first.nodeId), 'first graph node')
    const textPictureBytes = new Uint8Array([1, 2, 3])
    renderer.textPictureGenerations.set(first.nodeId, {
      data: textPictureBytes,
      generation: renderer.fontGeneration
    })
    renderer.pendingFontNodes.set(first.nodeId, {
      node: firstNode,
      keys: new Set(['Inter-Regular'])
    })

    renderer.render(second.graph, new Set(), {}, 2)

    for (const deletePath of pathDeletes) expect(deletePath).toHaveBeenCalledTimes(1)
    expect(renderer.vectorPathCache.size).toBe(0)
    expect(renderer.vectorStrokePathCache.size).toBe(0)
    expect(renderer.vectorStrokeOutlineCache.size).toBe(0)
    expect(renderer.fillGeometryCache.size).toBe(0)
    expect(renderer.strokeGeometryCache.size).toBe(0)
    expect(renderer.textPictureGenerations.size).toBe(0)
    expect(renderer.pendingFontNodes.size).toBe(0)
    expect(firstDecodedImage.isDeleted()).toBe(true)
    expect([...renderer.imageCache.keys()]).toEqual(['second-image'])
    expect(pixel(renderedPixels(renderer), 1, 1)).toEqual([0, 0, 255, 255])
  } finally {
    renderer.destroy()
  }
})

test('renderer page changes release old picture and decoded-image cache scope', () => {
  const graph = new SceneGraph()
  const firstPage = graph.getPages()[0]
  const secondPage = graph.addPage('Second')
  graph.images.set('first', solidPNG(1, 0, 0))
  graph.images.set('second', solidPNG(0, 0, 1))
  for (const [pageId, hash] of [
    [firstPage.id, 'first'],
    [secondPage.id, 'second']
  ] as const) {
    createImageRectangle(graph, pageId, hash)
  }

  const surface = expectDefined(ck.MakeSurface(8, 4), 'page change surface')
  const renderer = new SkiaRenderer(ck, surface)
  configureInteractiveRenderer(renderer, firstPage.id)

  try {
    renderer.render(graph, new Set(), {}, 1, 'scene')
    expect([...renderer.imageCache.keys()]).toEqual(['first'])
    const firstBacking = expectDefined(renderer.sceneBacking, 'first page backing')

    renderer.pageId = secondPage.id
    renderer.render(graph, new Set(), {}, 2, 'scene')

    expect(renderer.renderCachePageId).toBe(secondPage.id)
    expect(renderer.sceneBacking?.pageId).toBe(secondPage.id)
    expect(renderer.sceneBacking).not.toBe(firstBacking)
    expect(firstBacking.image.isDeleted()).toBe(true)
    expect([...renderer.imageCache.keys()]).toEqual(['second'])
    expect(pixel(renderedPixels(renderer), 1, 1)).toEqual([0, 0, 255, 255])
  } finally {
    renderer.destroy()
  }
})

test('offscreen export isolates a different graph without evicting the interactive caches', () => {
  const first = fixedIdentityImageGraph('first-image', 1, 0)
  const second = fixedIdentityImageGraph('second-image', 0, 1)
  const surface = expectDefined(ck.MakeSurface(8, 4), 'interactive surface')
  const exportSurface = expectDefined(ck.MakeSurface(8, 4), 'export surface')
  const renderer = new SkiaRenderer(ck, surface)
  configureInteractiveRenderer(renderer, first.pageId)

  try {
    renderer.render(first.graph, new Set(), {}, 1, 'scene')
    const firstDecodedImage = expectDefined(
      renderer.imageCache.get('first-image'),
      'first decoded image'
    ).image
    const firstBacking = expectDefined(renderer.sceneBacking, 'interactive backing')

    renderer.renderSceneToCanvas(exportSurface.getCanvas(), second.graph, second.pageId)
    exportSurface.flush()

    expect(renderer.renderCacheGraph).toBe(first.graph)
    expect(renderer.renderCachePageId).toBe(first.pageId)
    expect(renderer.sceneBacking).toBe(firstBacking)
    expect(firstDecodedImage.isDeleted()).toBe(false)
    expect([...renderer.imageCache.keys()]).toEqual(['first-image'])
    const exportPixels = exportSurface.getCanvas().readPixels(0, 0, {
      alphaType: ck.AlphaType.Unpremul,
      colorType: ck.ColorType.RGBA_8888,
      colorSpace: ck.ColorSpace.SRGB,
      width: 8,
      height: 4
    })
    expect(exportPixels).not.toBeNull()
    expect(pixel(exportPixels as Uint8Array, 1, 1)).toEqual([0, 0, 255, 255])
  } finally {
    renderer.destroy()
    exportSurface.delete()
  }
})

test('offscreen frame eviction keeps draw commands valid until the caller flushes', () => {
  const { graph, pageId } = imageGraph()
  const surface = expectDefined(ck.MakeSurface(8, 4), 'offscreen surface')
  const renderer = new SkiaRenderer(ck, surface)
  renderer.imageCacheByteBudget = 22

  try {
    renderer.renderSceneToCanvas(surface.getCanvas(), graph, pageId)
    expect(renderer.imageCache.size).toBe(1)

    surface.flush()
    const pixels = renderedPixels(renderer)
    expect(pixel(pixels, 1, 1)).toEqual([255, 0, 0, 255])
    expect(pixel(pixels, 5, 1)).toEqual([0, 0, 255, 255])
  } finally {
    renderer.destroy()
  }
})
