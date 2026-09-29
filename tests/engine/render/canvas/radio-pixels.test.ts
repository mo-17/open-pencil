import { beforeAll, describe, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { initCanvasKit } from '#cli/headless'
import { SkiaRenderer } from '#core/canvas/renderer'
import { recordRenderChunk, RenderChunkIndex } from '#core/canvas/renderer/chunks'
import { fontManager } from '#core/text/fonts'

import { expectDefined } from '#tests/helpers/assert'
import { repoPath } from '#tests/helpers/paths'

let ck: Awaited<ReturnType<typeof initCanvasKit>>
let interData: ArrayBuffer
let cjkData: ArrayBuffer

beforeAll(async () => {
  ck = await initCanvasKit()
  interData = await Bun.file(repoPath('packages/core/assets/Inter-Regular.ttf')).arrayBuffer()
  cjkData = await Bun.file(repoPath('tests/fixtures/fonts/NotoSansSC-Regular.ttf')).arrayBuffer()
})

function fixture(overrides: Partial<SceneNode> = {}) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const node = graph.createNode('RADIO', page.id, {
    width: 160,
    height: 88,
    fontFamily: 'Inter',
    fontSize: 14,
    strokes: [],
    interactiveProps: { options: ['个人', '团队'], value: '团队', textColor: '#006644' },
    ...overrides
  })
  const surface = expectDefined(ck.MakeSurface(200, 120), 'radio surface')
  const provider = ck.TypefaceFontProvider.Make()
  fontManager.attachProvider(ck, provider)
  fontManager.markLoaded('Inter', 'Regular', interData)
  fontManager.markLoaded('Noto Sans SC', 'Regular', cjkData)
  fontManager.setCJKFallbackFamily('Noto Sans SC')
  const renderer = new SkiaRenderer(ck, surface)
  renderer.fontsLoaded = true
  renderer.fontProvider = provider
  const canvas = surface.getCanvas()
  const paint = (draw = () => renderer.renderShape(canvas, node, graph)) => {
    canvas.clear(ck.WHITE)
    draw()
    surface.flush()
    const image = surface.makeImageSnapshot()
    try {
      return expectDefined(
        image.readPixels(0, 0, {
          width: 200,
          height: 120,
          colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Unpremul,
          colorSpace: ck.ColorSpace.SRGB
        }),
        'radio pixels'
      )
    } finally {
      image.delete()
    }
  }
  return { graph, page, node, renderer, canvas, paint }
}

function redAt(pixels: Uint8Array | Float32Array, x: number, y: number) {
  return pixels[(y * 200 + x) * 4]
}

describe('RADIO CanvasKit pixels', () => {
  test('paints both Chinese option labels through font fallback and a single selected dot', () => {
    const { renderer, paint } = fixture()
    try {
      const pixels = paint()
      expect(redAt(pixels, 9, 10)).toBe(255)
      expect(redAt(pixels, 9, 39)).toBeLessThan(20)
      for (const top of [0, 29]) {
        let greenText = 0
        for (let y = top; y < top + 21; y++) {
          for (let x = 24; x < 80; x++) {
            const offset = (y * 200 + x) * 4
            if (pixels[offset] < 120 && pixels[offset + 1] > pixels[offset] + 30) greenText++
          }
        }
        expect(greenText).toBeGreaterThan(30)
      }
    } finally {
      renderer.destroy()
    }
  })

  test('matches recorded chunk pixels and clips long disabled labels to the control', () => {
    const { graph, page, renderer, canvas, paint } = fixture({
      width: 60,
      height: 32,
      interactiveProps: {
        options: ['个人 Individual long label', '团队'],
        value: '个人 Individual long label',
        disabled: true
      }
    })
    const { index } = RenderChunkIndex.build(graph, page.id)
    const chunk = expectDefined(
      index.search({ minX: 0, minY: 0, maxX: 200, maxY: 120 })[0],
      'radio chunk'
    )
    const recorded = recordRenderChunk(renderer, graph, chunk)
    try {
      const direct = paint()
      const cached = paint(() => canvas.drawPicture(recorded.picture))
      expect(cached).toEqual(direct)
      expect(redAt(direct, 9, 10)).toBeGreaterThan(100)
      expect(redAt(direct, 9, 10)).toBeLessThan(220)
      let outsideInk = 0
      for (let y = 0; y < 120; y++) {
        for (let x = 60; x < 200; x++) if (redAt(direct, x, y) !== 255) outsideInk++
      }
      expect(outsideInk).toBe(0)
      expect(redAt(direct, 9, 39)).toBe(255)
    } finally {
      recorded.picture.delete()
      index.dispose()
      renderer.destroy()
    }
  })

  test.each([
    ['page', false],
    ['page', true],
    ['document', false],
    ['document', true]
  ] as const)(
    'expires %s state effect content when retained raster mode is %s',
    (scope, raster) => {
      const { graph, page, node, renderer, paint } = fixture({
        bindings: {
          value:
            scope === 'page'
              ? { kind: 'ref', stateId: 'plan' }
              : { kind: 'docState', docStateName: 'plan' }
        },
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
      const stateOwner = scope === 'page' ? page.id : graph.rootId
      const setValue = (defaultValue: string) =>
        graph.updateNode(stateOwner, {
          [scope === 'page' ? 'state' : 'lowcodeDocumentState']: [
            { id: 'plan', name: 'plan', type: 'string', defaultValue }
          ]
        })
      renderer.renderingSceneBacking = raster
      try {
        setValue('个人')
        const first = paint()
        expect(redAt(first, 9, 10)).toBeLessThan(20)
        expect(redAt(first, 9, 39)).toBe(255)
        expect(
          raster ? renderer.effectRasterCache.has(node.id) : renderer.nodePictureCache.has(node.id)
        ).toBe(true)

        setValue('团队')
        renderer.invalidateNodePicture(stateOwner)
        const second = paint()
        expect(redAt(second, 9, 10)).toBe(255)
        expect(redAt(second, 9, 39)).toBeLessThan(20)
      } finally {
        renderer.destroy()
      }
    }
  )
})
