import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderSkeletonModulePreview } from '#core/canvas/modules/skeleton'
import { skeletonPreviewGeometry } from '#core/canvas/modules/skeleton/geometry'
import { skeletonTextNode } from '#core/canvas/modules/skeleton/text'
import {
  createSkeletonModuleFrameOverrides,
  SKELETON_MODULE_DEFAULT_CONFIG
} from '#core/plugins/skeleton'

import { carouselPixelHarness } from '../carousel/helpers'

test('text Skeleton paints the authored rows, gaps and shortened last line without animation', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createSkeletonModuleFrameOverrides()
  )
  try {
    h.canvas.clear(h.ck.WHITE)
    expect(renderSkeletonModulePreview(h.renderer, h.canvas, node)).toBe(true)
    const first = h.pixels()
    expect(h.rgb(first, 30, 24)).toEqual([226, 232, 240])
    expect(h.rgb(first, 30, 38)).toEqual([255, 255, 255])
    expect(h.rgb(first, 30, 52)).toEqual([226, 232, 240])
    expect(h.rgb(first, 30, 80)).toEqual([226, 232, 240])
    expect(h.rgb(first, 230, 80)).toEqual([255, 255, 255])
    h.canvas.clear(h.ck.WHITE)
    renderSkeletonModulePreview(h.renderer, h.canvas, node)
    expect(h.pixels()).toEqual(first)
    expect(skeletonTextNode(node)).toBeNull()
  } finally {
    h.dispose()
  }
})
test('Skeleton shapes the optional visible Chinese description and preflights only displayed text', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createSkeletonModuleFrameOverrides({
      label: '正在加载资料',
      showLabel: true,
      variant: 'rectangle'
    })
  )
  const shaped: string[] = [],
    build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((text, color, options) => {
    shaped.push(text.text)
    return build(text, color, options)
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    renderSkeletonModulePreview(h.renderer, h.canvas, node)
    expect(shaped).toEqual(['正在加载资料'])
    expect(skeletonTextNode(node)?.text).toBe('正在加载资料')
    expect(h.rgb(h.pixels(), 30, 60)).toEqual([226, 232, 240])
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})
test('Skeleton compresses all rows and gaps into short hosts and keeps circles circular', () => {
  const config = { ...SKELETON_MODULE_DEFAULT_CONFIG, rows: 12, lineHeight: 48, gap: 32 }
  const compact = skeletonPreviewGeometry(40, 24, config)
  expect(compact.shapes).toHaveLength(12)
  for (const shape of compact.shapes) {
    expect(shape.width).toBeGreaterThan(0)
    expect(shape.height).toBeGreaterThan(0)
    expect(shape.x + shape.width).toBeLessThanOrEqual(40)
    expect(shape.y + shape.height).toBeLessThanOrEqual(24)
  }
  const circle = skeletonPreviewGeometry(100, 80, { ...config, variant: 'circle' }).shapes[0]
  expect(circle.width).toBe(48)
  expect(circle.height).toBe(48)
  const exhausted = skeletonPreviewGeometry(40, 24, { ...config, showLabel: true, fontSize: 32 })
  expect(exhausted.shapes.every((shape) => shape.height === 0)).toBe(true)
})
test('circular Skeleton has empty corners and an invalid envelope retains static fallback', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createSkeletonModuleFrameOverrides({ variant: 'circle' }),
    width: 100,
    height: 80
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    renderSkeletonModulePreview(h.renderer, h.canvas, node)
    const first = h.pixels()
    expect(h.rgb(first, 5, 16)).toEqual([255, 255, 255])
    expect(h.rgb(first, 29, 40)).toEqual([226, 232, 240])
    if (!node.interactiveProps?.module) throw new Error('Missing skeleton')
    node.interactiveProps.module.config.rows = 99
    expect(renderSkeletonModulePreview(h.renderer, h.canvas, node)).toBe(false)
    expect(skeletonTextNode(node)).toBeNull()
  } finally {
    h.dispose()
  }
})
