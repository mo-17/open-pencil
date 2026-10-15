import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderProgressModulePreview } from '#core/canvas/modules/progress'
import { progressPreviewGeometry } from '#core/canvas/modules/progress/geometry'
import { progressTextNode } from '#core/canvas/modules/progress/text'
import {
  createProgressModuleFrameOverrides,
  PROGRESS_MODULE_DEFAULT_CONFIG
} from '#core/plugins/progress'

import { expectModuleInstance } from '#tests/helpers/assert'

import { carouselPixelHarness } from '../carousel/helpers'

test('linear Progress paints the real percentage and shapes Chinese labels', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createProgressModuleFrameOverrides({ label: '文件进度', value: 25 })
  )
  const shaped: string[] = []
  const build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    shaped.push(label.text)
    return build(label, color, options)
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    expect(renderProgressModulePreview(h.renderer, h.canvas, node)).toBe(true)
    expect(shaped).toEqual(['文件进度', '25%'])
    expect(progressTextNode(node)?.text).toBe('文件进度\n25%')
    const pixels = h.pixels()
    expect(h.rgb(pixels, 32, 53)).toEqual([37, 99, 235])
    expect(h.rgb(pixels, 100, 53)).toEqual([226, 232, 240])
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})

test('circular Progress distinguishes quarter completion from the remaining track', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createProgressModuleFrameOverrides({ variant: 'circular', value: 25 })
  )
  try {
    h.canvas.clear(h.ck.WHITE)
    renderProgressModulePreview(h.renderer, h.canvas, node)
    const pixels = h.pixels()
    expect(h.rgb(pixels, 200, 69)).toEqual([37, 99, 235])
    expect(h.rgb(pixels, 120, 69)).toEqual([226, 232, 240])
    expect(h.rgb(pixels, 160, 109)).toEqual([255, 255, 255])
  } finally {
    h.dispose()
  }
})

test('pending Progress remains deterministic, honest and clipped in a narrow canvas frame', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createProgressModuleFrameOverrides({
      variant: 'circular',
      value: 99,
      indeterminate: true,
      label: '正在处理',
      pendingLabel: '进度未提供',
      showLabel: false,
      showValue: false,
      diameter: 240
    }),
    width: 80,
    height: 120
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    expect(renderProgressModulePreview(h.renderer, h.canvas, node)).toBe(true)
    const first = h.pixels()
    expect(progressTextNode(node)?.text).toBe('进度未提供')
    h.canvas.clear(h.ck.WHITE)
    renderProgressModulePreview(h.renderer, h.canvas, node)
    expect(h.pixels()).toEqual(first)
    let colored = 0
    let outside = 0
    for (let y = 0; y < 180; y++)
      for (let x = 0; x < 140; x++) {
        const rgb = h.rgb(first, x, y)
        if (rgb.some((channel) => channel !== 255)) {
          if (x >= 80 || y >= 120) outside++
          else colored++
        }
      }
    expect(colored).toBeGreaterThan(10)
    expect(outside).toBe(0)
  } finally {
    h.dispose()
  }
})

test('invalid Progress configuration is not painted as a working module', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createProgressModuleFrameOverrides()
  )
  expectModuleInstance(node.interactiveProps?.module).config.value = 101
  try {
    expect(renderProgressModulePreview(h.renderer, h.canvas, node)).toBe(false)
    expect(progressTextNode(node)).toBeNull()
  } finally {
    h.dispose()
  }
})

test('a maximum-diameter ring fits the remaining height and still paints its complete bottom edge', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createProgressModuleFrameOverrides({ variant: 'circular', diameter: 240, value: 100 })
  )
  try {
    h.canvas.clear(h.ck.WHITE)
    renderProgressModulePreview(h.renderer, h.canvas, node)
    const pixels = h.pixels()
    // 200px host minus padding and the header leaves a 135px circle, not a clipped 240px arc.
    expect(h.rgb(pixels, 160, 182)).toEqual([37, 99, 235])
    expect(h.rgb(pixels, 160, 190)).toEqual([255, 255, 255])
  } finally {
    h.dispose()
  }
})

test('large labels and exhausted vertical space produce nonnegative, contained Progress geometry', async () => {
  const config = {
    ...PROGRESS_MODULE_DEFAULT_CONFIG,
    variant: 'circular' as const,
    diameter: 240,
    fontSize: 32
  }
  const small = progressPreviewGeometry(180, 110, config)
  expect(small.diameter).toBe(18)
  expect(small.circleY + small.diameter / 2).toBe(94)
  const emptyConfig = { ...config, showLabel: false, showValue: false }
  const empty = progressPreviewGeometry(180, 24, emptyConfig)
  expect(empty.diameter).toBe(0)
  expect(empty.circleStroke).toBe(0)
  expect(empty.linearHeight).toBe(0)
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createProgressModuleFrameOverrides(emptyConfig),
    width: 180,
    height: 24
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    renderProgressModulePreview(h.renderer, h.canvas, node)
    const pixels = h.pixels()
    let colored = 0
    for (let y = 0; y < 120; y += 4)
      for (let x = 0; x < 180; x += 4)
        if (h.rgb(pixels, x, y).some((channel) => channel !== 255)) colored++
    expect(colored).toBe(0)
  } finally {
    h.dispose()
  }
})
