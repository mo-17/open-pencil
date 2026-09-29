import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createAccordionModuleFrameOverrides } from '#core/plugins/accordion'

import { carouselPixelHarness } from '../carousel/helpers'

type Harness = Awaited<ReturnType<typeof carouselPixelHarness>>

function configureViewport(h: Harness, graph: SceneGraph) {
  Object.assign(h.renderer, {
    pageId: graph.getPages()[0].id,
    viewportWidth: 320,
    viewportHeight: 240,
    dpr: 1,
    zoom: 1,
    panX: 0,
    panY: 0
  })
}

function paintSettledTiles(h: Harness, graph: SceneGraph, sceneVersion = 1) {
  for (let frame = 0; frame < 40; frame++) {
    h.canvas.clear(h.ck.WHITE)
    const result = h.renderer.tiledScene.renderFrame(h.renderer, h.canvas, graph, sceneVersion, 0)
    // Drain overscan as well as visible work so a stable repeat cannot pass by doing old jobs.
    const completed = result.metrics.mandatoryCompleted + result.metrics.interruptibleCompleted
    if (result.covered && !result.pending && completed === 0) return h.pixels()
  }
  throw new Error('Tile fixture did not settle')
}

function darkPixels(data: Uint8Array | Float32Array): number {
  let count = 0
  for (let y = 0; y < 240; y++) {
    for (let x = 0; x < 320; x++) {
      const offset = (y * 680 + x) * 4
      if (data[offset] < 100 && data[offset + 1] < 100 && data[offset + 2] < 100) count++
    }
  }
  return count
}

test('late font readiness repaints completed tiles without a scene edit and stable fonts reuse them', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createAccordionModuleFrameOverrides(),
    width: 320,
    height: 240
  })
  configureViewport(h, graph)
  const read = h.renderer.nodeFontReadiness.bind(h.renderer)
  let ready = false
  const readiness = spyOn(h.renderer, 'nodeFontReadiness').mockImplementation((label) =>
    ready ? read(label) : 'pending'
  )
  const recorded = spyOn(h.renderer, 'renderNode')
  try {
    const original = structuredClone(node)
    expect(darkPixels(paintSettledTiles(h, graph))).toBe(0)
    await h.save('accordion-tiled-font-pending')
    // Isolate the renderer's real settlement inputs. Fonts are local; no network/timer dependency.
    ready = true
    h.renderer.fontGeneration++
    h.renderer.invalidateNodePicture(node.id)
    const after = paintSettledTiles(h, graph)
    await h.save('accordion-tiled-font-ready')
    expect(darkPixels(after)).toBeGreaterThan(300)
    expect(node).toEqual(original)
    const count = recorded.mock.calls.length
    expect(paintSettledTiles(h, graph)).toEqual(after)
    expect(recorded).toHaveBeenCalledTimes(count)
  } finally {
    recorded.mockRestore()
    readiness.mockRestore()
    h.dispose()
  }
})

test('font invalidation preserves graph replacement and controller cleanup with reused node IDs', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    ...createAccordionModuleFrameOverrides(),
    width: 320,
    height: 240
  })
  configureViewport(h, graph)
  try {
    expect(darkPixels(paintSettledTiles(h, graph))).toBeGreaterThan(300)
    h.renderer.fontGeneration++
    expect(darkPixels(paintSettledTiles(h, graph))).toBeGreaterThan(300)
    const replacement = new SceneGraph()
    const rect = replacement.createNode('RECTANGLE', replacement.getPages()[0].id, {
      id: node.id,
      width: 320,
      height: 240,
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    })
    expect(rect.id).toBe(node.id)
    h.renderer.invalidateAllPictures()
    configureViewport(h, replacement)
    const after = paintSettledTiles(h, replacement)
    expect(darkPixels(after)).toBe(0)
    expect(h.rgb(after, 40, 40)).toEqual([255, 0, 0])
    h.renderer.tiledScene.destroy()
    expect(paintSettledTiles(h, replacement)).toEqual(after)
  } finally {
    h.dispose()
  }
})
