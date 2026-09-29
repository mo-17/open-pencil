import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderRatingModulePreview } from '#core/canvas/modules/rating'
import { ratingTextNode } from '#core/canvas/modules/rating/text'
import { createRatingModuleFrameOverrides } from '#core/plugins/rating'

import { carouselPixelHarness } from '../carousel/helpers'

test('Rating canvas paints authored half stars with paths and shapes Chinese labels', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createRatingModuleFrameOverrides({
      label: '使用体验',
      clearLabel: '清空评分',
      allowHalf: true,
      initialValue: 3.5
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
    expect(renderRatingModulePreview(h.renderer, h.canvas, node)).toBe(true)
    const pixels = h.pixels()
    expect(h.rgb(pixels, 28, 62)).toEqual([217, 119, 6])
    expect(h.rgb(pixels, 120, 62)).toEqual([217, 119, 6])
    expect(h.rgb(pixels, 128, 62)).toEqual([209, 213, 219])
    expect(h.rgb(pixels, 156, 62)).toEqual([209, 213, 219])
    expect(shaped).toEqual(['使用体验', '3.5 / 5', '清空评分'])
    expect(ratingTextNode(node)?.text).toBe('使用体验\n3.5 / 5\n清空评分')
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})

test('Rating canvas shrinks ten stars within narrow frames and never paints outside its surface', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createRatingModuleFrameOverrides({ max: 10, initialValue: 10, starSize: 48 }),
    width: 80,
    height: 100
  })
  try {
    h.canvas.clear(h.ck.WHITE)
    renderRatingModulePreview(h.renderer, h.canvas, node)
    const pixels = h.pixels()
    let selectedPixels = 0
    let outsidePixels = 0
    for (let y = 0; y < 140; y++) {
      for (let x = 0; x < 140; x++) {
        const rgb = h.rgb(pixels, x, y)
        if (rgb[0] === 217 && rgb[1] === 119 && rgb[2] === 6) selectedPixels++
        if ((x >= 80 || y >= 100) && rgb.some((channel) => channel !== 255)) outsidePixels++
      }
    }
    expect(selectedPixels).toBeGreaterThan(10)
    expect(outsidePixels).toBe(0)
  } finally {
    h.dispose()
  }
})
