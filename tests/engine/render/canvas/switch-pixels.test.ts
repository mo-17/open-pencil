import { beforeAll, describe, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { initCanvasKit } from '#cli/headless'
import { SkiaRenderer } from '#core/canvas/renderer'
import { recordRenderChunk, RenderChunkIndex } from '#core/canvas/renderer/chunks'

import { expectDefined } from '#tests/helpers/assert'

let ck: Awaited<ReturnType<typeof initCanvasKit>>
beforeAll(async () => {
  ck = await initCanvasKit()
})

function fixture(overrides: Partial<SceneNode> = {}) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const node = graph.createNode('SWITCH', page.id, {
    width: 320,
    height: 44,
    cornerRadius: 8,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
    interactiveProps: { checked: true },
    ...overrides
  })
  const surface = expectDefined(ck.MakeSurface(360, 80), 'switch surface')
  const renderer = new SkiaRenderer(ck, surface)
  const canvas = surface.getCanvas()
  const paint = (draw = () => renderer.renderShape(canvas, node, graph)) => {
    canvas.clear(ck.WHITE)
    draw()
    surface.flush()
    const image = surface.makeImageSnapshot()
    try {
      return expectDefined(
        image.readPixels(0, 0, {
          width: 360,
          height: 80,
          colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Unpremul,
          colorSpace: ck.ColorSpace.SRGB
        }),
        'switch pixels'
      )
    } finally {
      image.delete()
    }
  }
  return { graph, page, node, renderer, canvas, paint }
}

function redAt(pixels: Uint8Array | Float32Array, x: number, y: number) {
  return pixels[(y * 360 + x) * 4]
}

describe('SWITCH CanvasKit pixels', () => {
  test('uses the whole authored size for a capsule track and moving thumb without graph edits', () => {
    const { graph, node, renderer, paint } = fixture()
    try {
      const on = paint()
      expect(redAt(on, 12, 22)).toBeLessThan(100)
      expect(redAt(on, 298, 22)).toBe(255)
      expect(redAt(on, 100, 22)).toBeLessThan(100)
      expect(redAt(on, 0, 0)).toBe(255)
      expect(node.width).toBe(320)
      expect(node.height).toBe(44)
      expect(node.cornerRadius).toBe(8)
      expect(node.fills[0].color.r).toBe(1)
      expect(node.type).toBe('SWITCH')
      expect(node.childIds).toEqual([])

      graph.updateNode(node.id, { interactiveProps: { checked: false } })
      renderer.invalidateNodePicture(node.id)
      const off = paint()
      expect(redAt(off, 22, 22)).toBe(255)
      expect(redAt(off, 298, 22)).toBeWithin(198, 209)
    } finally {
      renderer.destroy()
    }
  })

  test('uses shared track colors and dims the completed switch once', () => {
    const { renderer, paint } = fixture({
      fills: [
        { type: 'SOLID', color: { r: 0.9, g: 0.8, b: 0.7, a: 1 }, opacity: 1, visible: true }
      ],
      interactiveProps: { checked: true, disabled: true }
    })
    try {
      const pixels = paint()
      expect(redAt(pixels, 200, 22)).toBeWithin(154, 162)
      expect(redAt(pixels, 12, 22)).toBeWithin(154, 162)
      expect(redAt(pixels, 298, 22)).toBe(255)
    } finally {
      renderer.destroy()
    }
  })

  test('paints the authored border around the capsule instead of a second rectangular shell', () => {
    const { node, renderer, paint } = fixture({
      cornerRadius: 0,
      independentCorners: true,
      topLeftRadius: 0,
      topRightRadius: 0,
      bottomLeftRadius: 0,
      bottomRightRadius: 0,
      strokes: [
        { color: { r: 1, g: 0, b: 0, a: 1 }, weight: 2, opacity: 1, visible: true, align: 'INSIDE' }
      ]
    })
    try {
      const pixels = paint()
      const border = (1 * 360 + 160) * 4
      expect(pixels[border]).toBe(255)
      expect(pixels[border + 1]).toBe(0)
      expect(redAt(pixels, 0, 0)).toBe(255)
      expect(redAt(pixels, 160, 4)).toBeLessThan(100)
      expect(redAt(pixels, 298, 22)).toBe(255)
      expect(node.independentCorners).toBe(true)
      expect(node.cornerRadius).toBe(0)
    } finally {
      renderer.destroy()
    }
  })

  test('matches recorded-chunk rendering for a padded full-size control', () => {
    const { graph, page, renderer, canvas, paint } = fixture({
      width: 76,
      height: 48,
      paddingLeft: 10,
      paddingRight: 8,
      paddingTop: 4,
      paddingBottom: 6
    })
    const { index } = RenderChunkIndex.build(graph, page.id)
    const chunk = expectDefined(
      index.search({ minX: 0, minY: 0, maxX: 360, maxY: 80 })[0],
      'switch chunk'
    )
    const recorded = recordRenderChunk(renderer, graph, chunk)
    try {
      const direct = paint()
      expect(paint(() => canvas.drawPicture(recorded.picture))).toEqual(direct)
      expect(redAt(direct, 22, 23)).toBeLessThan(100)
      expect(redAt(direct, 42, 23)).toBe(255)
      expect(redAt(direct, 5, 23)).toBeLessThan(100)
      expect(redAt(direct, 70, 23)).toBeLessThan(100)
    } finally {
      recorded.picture.delete()
      index.dispose()
      renderer.destroy()
    }
  })

  test.each([false, true])(
    'expires document-state effect content in retained raster mode %s',
    (raster) => {
      const { graph, node, renderer, paint } = fixture({
        bindings: { value: { kind: 'docState', docStateName: 'enabled' } },
        effects: [
          {
            type: 'DROP_SHADOW',
            color: { r: 0, g: 0, b: 0, a: 0.2 },
            offset: { x: 1, y: 1 },
            radius: 2,
            spread: 0,
            visible: true
          }
        ]
      })
      const setValue = (defaultValue: boolean) =>
        graph.updateNode(graph.rootId, {
          lowcodeDocumentState: [{ id: 'enabled', name: 'enabled', type: 'boolean', defaultValue }]
        })
      renderer.renderingSceneBacking = raster
      try {
        setValue(true)
        expect(redAt(paint(), 12, 22)).toBeLessThan(100)
        expect(
          raster ? renderer.effectRasterCache.has(node.id) : renderer.nodePictureCache.has(node.id)
        ).toBe(true)
        setValue(false)
        renderer.invalidateNodePicture(graph.rootId)
        const changed = paint()
        expect(redAt(changed, 22, 22)).toBe(255)
        expect(redAt(changed, 298, 22)).toBeWithin(198, 209)
      } finally {
        renderer.destroy()
      }
    }
  )
})
