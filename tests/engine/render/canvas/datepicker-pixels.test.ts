import { beforeAll, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { initCanvasKit } from '#cli/headless'
import { renderDatePickerContent } from '#core/canvas/datepicker'
import { SkiaRenderer } from '#core/canvas/renderer'
import { fontManager } from '#core/text/fonts'

import { expectDefined } from '#tests/helpers/assert'
import { repoPath } from '#tests/helpers/paths'

let ck: Awaited<ReturnType<typeof initCanvasKit>>
let font: ArrayBuffer

beforeAll(async () => {
  ck = await initCanvasKit()
  font = await Bun.file(repoPath('packages/core/assets/Inter-Regular.ttf')).arrayBuffer()
})

function fixture(overrides: Partial<SceneNode> = {}) {
  const graph = new SceneGraph()
  const node = graph.createNode('DATEPICKER', graph.getPages()[0].id, {
    width: 180,
    height: 44,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 4,
    paddingBottom: 4,
    fontFamily: 'Inter',
    fontSize: 14,
    interactiveProps: { value: '2026-09-24' },
    ...overrides
  })
  const surface = expectDefined(ck.MakeSurface(220, 70), 'date surface')
  const provider = ck.TypefaceFontProvider.Make()
  fontManager.attachProvider(ck, provider)
  fontManager.markLoaded('Inter', 'Regular', font)
  const renderer = new SkiaRenderer(ck, surface)
  renderer.fontsLoaded = true
  renderer.fontProvider = provider
  const canvas = surface.getCanvas()
  const pixels = () => {
    canvas.clear(ck.WHITE)
    renderDatePickerContent(renderer, canvas, node, graph)
    surface.flush()
    const image = surface.makeImageSnapshot()
    try {
      return expectDefined(
        image.readPixels(0, 0, {
          width: 220,
          height: 70,
          colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Unpremul,
          colorSpace: ck.ColorSpace.SRGB
        }),
        'date pixels'
      )
    } finally {
      image.delete()
    }
  }
  return { graph, node, renderer, pixels }
}

function ink(
  pixels: Uint8Array | Float32Array,
  left: number,
  top: number,
  right: number,
  bottom: number
): number {
  let count = 0
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      if (pixels[(y * 220 + x) * 4] < 240) count++
    }
  }
  return count
}

test('real CanvasKit draws readable date glyphs and a calendar inside the padded field', () => {
  const { renderer, pixels } = fixture()
  try {
    const rendered = pixels()
    expect(ink(rendered, 12, 4, 140, 40)).toBeGreaterThan(200)
    expect(ink(rendered, 152, 14, 169, 31)).toBeGreaterThan(35)
    expect(ink(rendered, 0, 0, 12, 70)).toBe(0)
    expect(ink(rendered, 180, 0, 220, 70)).toBe(0)
    expect(ink(rendered, 0, 44, 220, 70)).toBe(0)
  } finally {
    renderer.destroy()
  }
})

test('invalid dates paint the same neutral placeholder as empty values, while real dates differ', () => {
  const { graph, node, renderer, pixels } = fixture({ interactiveProps: {} })
  try {
    const empty = pixels()
    expect(ink(empty, 12, 4, 140, 40)).toBeGreaterThan(100)
    graph.updateNode(node.id, { interactiveProps: { value: '2026-02-30' } })
    expect(pixels()).toEqual(empty)
    graph.updateNode(node.id, { interactiveProps: { value: '2024-02-29' } })
    expect(pixels()).not.toEqual(empty)
  } finally {
    renderer.destroy()
  }
})

test('readonly removes the calendar without hiding the date and disabled reduces ink contrast', () => {
  const { graph, node, renderer, pixels } = fixture()
  try {
    const enabled = pixels()
    graph.updateNode(node.id, { interactiveProps: { value: '2026-09-24', readOnly: true } })
    const readonly = pixels()
    expect(ink(readonly, 152, 14, 169, 31)).toBe(0)
    expect(ink(readonly, 12, 4, 140, 40)).toBeGreaterThan(200)
    graph.updateNode(node.id, { interactiveProps: { value: '2026-09-24', disabled: true } })
    const disabled = pixels()
    const darkness = (rgba: Uint8Array | Float32Array) => {
      let total = 0
      for (let i = 0; i < rgba.length; i += 4) total += 255 - rgba[i]
      return total
    }
    expect(darkness(disabled)).toBeLessThan(darkness(enabled) * 0.6)
    expect(darkness(disabled)).toBeGreaterThan(darkness(enabled) * 0.3)
  } finally {
    renderer.destroy()
  }
})

test('small date controls clip both glyphs and calendar without leaking past their bounds', () => {
  const { renderer, pixels } = fixture({ width: 34, height: 20, paddingLeft: 2, paddingRight: 2 })
  try {
    const rendered = pixels()
    expect(ink(rendered, 0, 0, 34, 20)).toBeGreaterThan(10)
    expect(ink(rendered, 34, 0, 220, 70)).toBe(0)
    expect(ink(rendered, 0, 20, 220, 70)).toBe(0)
  } finally {
    renderer.destroy()
  }
})
