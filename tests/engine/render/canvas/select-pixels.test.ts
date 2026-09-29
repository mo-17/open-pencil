import { beforeAll, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { initCanvasKit } from '#cli/headless'
import { SkiaRenderer } from '#core/canvas/renderer'
import { recordRenderChunk, RenderChunkIndex } from '#core/canvas/renderer/chunks'
import { fontManager } from '#core/text/fonts'

import { expectDefined } from '#tests/helpers/assert'
import { repoPath } from '#tests/helpers/paths'

let ck: Awaited<ReturnType<typeof initCanvasKit>>
let inter: ArrayBuffer
let cjk: ArrayBuffer

beforeAll(async () => {
  ck = await initCanvasKit()
  inter = await Bun.file(repoPath('packages/core/assets/Inter-Regular.ttf')).arrayBuffer()
  cjk = await Bun.file(repoPath('tests/fixtures/fonts/NotoSansSC-Regular.ttf')).arrayBuffer()
})

function fixture(overrides: Partial<SceneNode> = {}) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const node = graph.createNode('SELECT', page.id, {
    width: 200,
    height: 44,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 4,
    paddingBottom: 4,
    fontFamily: 'Inter',
    fontSize: 14,
    fills: [],
    strokes: [],
    interactiveProps: {
      options: [{ label: '团队计划', value: 'team' }],
      value: 'team',
      placeholder: '请选择'
    },
    ...overrides
  })
  const surface = expectDefined(ck.MakeSurface(240, 80), 'select surface')
  const provider = ck.TypefaceFontProvider.Make()
  fontManager.attachProvider(ck, provider)
  fontManager.markLoaded('Inter', 'Regular', inter)
  fontManager.markLoaded('Noto Sans SC', 'Regular', cjk)
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
          width: 240,
          height: 80,
          colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Unpremul,
          colorSpace: ck.ColorSpace.SRGB
        }),
        'select pixels'
      )
    } finally {
      image.delete()
    }
  }
  return { graph, page, node, renderer, canvas, paint }
}

function darkness(pixels: Uint8Array | Float32Array, left = 0, top = 0, right = 240, bottom = 80) {
  let value = 0
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) value += 255 - pixels[(y * 240 + x) * 4]
  }
  return value
}

test('real CanvasKit draws Chinese option glyphs and a vector chevron in separate padded regions', () => {
  const { node, renderer, paint } = fixture()
  const before = structuredClone(node)
  try {
    const pixels = paint()
    expect(darkness(pixels, 12, 4, 164, 40)).toBeGreaterThan(30000)
    expect(darkness(pixels, 176, 16, 188, 28)).toBeGreaterThan(1200)
    expect(darkness(pixels, 0, 0, 12, 80)).toBe(0)
    expect(darkness(pixels, 200, 0, 240, 80)).toBe(0)
    expect(darkness(pixels, 0, 44, 240, 80)).toBe(0)
    expect(node).toEqual(before)
  } finally {
    renderer.destroy()
  }
})

test('placeholder has distinct pixels and disabled content reduces contrast without disappearing', () => {
  const { graph, node, renderer, paint } = fixture()
  try {
    const enabled = paint()
    graph.updateNode(node.id, { interactiveProps: { ...node.interactiveProps, disabled: true } })
    const disabled = paint()
    expect(darkness(disabled)).toBeGreaterThan(darkness(enabled) * 0.35)
    expect(darkness(disabled)).toBeLessThan(darkness(enabled) * 0.55)
    graph.updateNode(node.id, {
      interactiveProps: { ...node.interactiveProps, disabled: false, value: '' }
    })
    const placeholder = paint()
    expect(placeholder).not.toEqual(enabled)
    expect(darkness(placeholder, 12, 4, 164, 40)).toBeGreaterThan(5000)
  } finally {
    renderer.destroy()
  }
})

test('long labels truncate before the chevron and recorded chunks match direct rendering', () => {
  const { graph, page, renderer, canvas, paint } = fixture({
    width: 95,
    interactiveProps: {
      options: ['A very long label and 中文内容'],
      value: 'A very long label and 中文内容'
    }
  })
  const { index } = RenderChunkIndex.build(graph, page.id)
  const chunk = expectDefined(
    index.search({ minX: 0, minY: 0, maxX: 240, maxY: 80 })[0],
    'select chunk'
  )
  const recorded = recordRenderChunk(renderer, graph, chunk)
  try {
    const direct = paint()
    expect(paint(() => canvas.drawPicture(recorded.picture))).toEqual(direct)
    expect(darkness(direct, 12, 4, 63, 40)).toBeGreaterThan(5000)
    expect(darkness(direct, 71, 16, 83, 28)).toBeGreaterThan(1200)
    expect(darkness(direct, 95, 0, 240, 80)).toBe(0)
  } finally {
    recorded.picture.delete()
    index.dispose()
    renderer.destroy()
  }
})

test.each([false, true])(
  'value and dynamic-option state invalidate cached select content in raster mode %s',
  (raster) => {
    const { graph, page, node, renderer, paint } = fixture({
      bindings: { value: { kind: 'docState', docStateName: 'selection' } },
      interactiveProps: {
        value: 'ignored',
        placeholder: 'Loading',
        optionsSource: {
          kind: 'ref',
          stateId: 'choices',
          valueExpr: 'item.id',
          labelExpr: 'item.label'
        }
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
    const setChoices = (label: string) =>
      graph.updateNode(page.id, {
        state: [
          { id: 'choices', name: 'choices', type: 'array', defaultValue: [{ id: 'team', label }] }
        ]
      })
    const setValue = (defaultValue: string) =>
      graph.updateNode(graph.rootId, {
        lowcodeDocumentState: [{ id: 'selection', name: 'selection', type: 'string', defaultValue }]
      })
    renderer.renderingSceneBacking = raster
    try {
      setChoices('Team')
      setValue('team')
      const first = paint()
      expect(
        raster ? renderer.effectRasterCache.has(node.id) : renderer.nodePictureCache.has(node.id)
      ).toBe(true)
      setChoices('团队计划')
      renderer.invalidateNodePicture(page.id)
      const changedLabel = paint()
      expect(changedLabel).not.toEqual(first)
      setValue('')
      renderer.invalidateNodePicture(graph.rootId)
      expect(paint()).not.toEqual(changedLabel)
      expect(node.interactiveProps.value).toBe('ignored')
    } finally {
      renderer.destroy()
    }
  }
)
