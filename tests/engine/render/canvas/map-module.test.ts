import { describe, expect, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { createMapModuleFrameOverrides } from '@open-pencil/core/plugins'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { renderMapModulePreview } from '#core/canvas/lowcode'
import { renderShapeUncached } from '#core/canvas/scene'

import { createMockCanvas, createMockRenderer } from './effects/helpers'

function mapFrame(overrides: Partial<SceneNode> = {}): SceneNode {
  return createDefaultNode(() => 'map-1', 'FRAME', {
    ...createMapModuleFrameOverrides({
      center: [121.4737, 31.2304],
      zoom: 10,
      style: 'dark',
      markers: [{ id: 'center', lng: 121.4737, lat: 31.2304, label: 'Shanghai' }]
    }),
    ...overrides
  })
}

describe('map module canvas preview', () => {
  test('draws a deterministic offline map preview inside the FRAME clip', () => {
    const node = mapFrame()
    const canvas = createMockCanvas()
    const renderer = createMockRenderer({ zoom: 1 })

    const rendered = renderMapModulePreview(renderer, canvas as Canvas, node)

    expect(rendered).toBe(true)
    expect(canvas.save).toHaveBeenCalledTimes(1)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawLine).toHaveBeenCalled()
    // One configured marker plus the authored center indicator, each with an inner dot.
    expect(canvas.drawCircle).toHaveBeenCalledTimes(4)
    expect(canvas.restore).toHaveBeenCalledTimes(1)
    expect(renderer.renderText).not.toHaveBeenCalled()
  })

  test('is integrated with regular FRAME rendering after the authored surface', () => {
    const node = mapFrame({ width: 420, height: 280 })
    const canvas = createMockCanvas()
    const renderer = createMockRenderer({ zoom: 2 })

    renderShapeUncached(renderer, canvas as Canvas, node, new SceneGraph())

    expect(renderer.drawNodeFill).toHaveBeenCalledTimes(1)
    expect(renderer.renderEffects).toHaveBeenCalledTimes(2)
    expect(canvas.drawRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawLine).toHaveBeenCalled()
  })

  test('ignores invalid or unrelated module data without changing the canvas', () => {
    const node = mapFrame({
      interactiveProps: {
        module: {
          version: 1,
          pluginId: 'unknown.plugin',
          moduleType: 'map',
          configVersion: 1,
          config: {}
        }
      }
    })
    const canvas = createMockCanvas()
    const renderer = createMockRenderer({ zoom: 1 })

    expect(renderMapModulePreview(renderer, canvas as Canvas, node)).toBe(false)
    expect(canvas.save).not.toHaveBeenCalled()
    expect(canvas.drawRect).not.toHaveBeenCalled()
  })
})
