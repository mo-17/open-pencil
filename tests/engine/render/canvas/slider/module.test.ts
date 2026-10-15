import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderSliderModulePreview } from '#core/canvas/modules/slider'
import { sliderPreviewGeometry } from '#core/canvas/modules/slider/geometry'
import { sliderTextNode } from '#core/canvas/modules/slider/text'
import {
  SLIDER_MODULE_DEFAULT_CONFIG,
  createSliderModuleFrameOverrides
} from '#core/plugins/slider'

import { expectModuleInstance } from '#tests/helpers/assert'

import { carouselPixelHarness } from '../carousel/helpers'

test('Slider range geometry shares normalized values and stays inside narrow frames', () => {
  const config = {
    ...SLIDER_MODULE_DEFAULT_CONFIG,
    range: true,
    min: -0.3,
    max: 0.65,
    step: 0.1,
    initialValue: 0.3,
    initialEndValue: 0.65
  }
  for (const width of [0, 12, 32, 80, 320]) {
    const geometry = sliderPreviewGeometry(width, config)
    expect(geometry.values).toEqual([0.3, 0.6])
    expect(geometry.startX).toBeGreaterThanOrEqual(0)
    expect(geometry.endX).toBeLessThanOrEqual(width)
    expect(geometry.startX).toBeLessThanOrEqual(geometry.endX)
  }
})

test('Slider canvas shapes Chinese labels and paints both range handles offline', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createSliderModuleFrameOverrides({
      label: '价格范围',
      range: true,
      initialValue: 20,
      initialEndValue: 80
    })
  )
  const shaped: string[] = []
  const build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    shaped.push(label.text)
    return build(label, color, options)
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    expect(renderSliderModulePreview(h.renderer, h.canvas, node)).toBe(true)
    expect(shaped).toContain('价格范围')
    expect(shaped).toContain('20 – 80')
    expect(sliderTextNode(node)?.text).toContain('价格范围')
    const geometry = sliderPreviewGeometry(320, {
      ...SLIDER_MODULE_DEFAULT_CONFIG,
      range: true,
      initialValue: 20,
      initialEndValue: 80
    })
    const pixels = h.pixels()
    for (const x of [geometry.startX, geometry.endX]) {
      expect(h.rgb(pixels, Math.round(x), Math.round(geometry.trackY))).toEqual([37, 99, 235])
    }
    expect(h.rgb(pixels, 330, 60)).toEqual([255, 255, 255])
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})

test('invalid Slider modules fall back without throwing or painting', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, createSliderModuleFrameOverrides())
  const module = expectModuleInstance(node.interactiveProps?.module)
  if (!module) throw new Error('Expected module fixture')
  module.configVersion = 9
  try {
    expect(renderSliderModulePreview(h.renderer, h.canvas, node)).toBe(false)
    expect(sliderTextNode(node)).toBeNull()
  } finally {
    h.dispose()
  }
})
