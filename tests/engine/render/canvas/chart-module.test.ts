import { describe, expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { ModuleCanvasAdapterRegistry, renderChartModulePreview } from '#core/canvas/modules'
import { renderShapeUncached } from '#core/canvas/scene'
import { createChartModuleFrameOverrides, createChartModuleInstance } from '#core/plugins/chart'

import { createMockCanvas, createMockRenderer } from './effects/helpers'

function chartFrame(overrides: Partial<SceneNode> = {}): SceneNode {
  return createDefaultNode(() => 'chart-1', 'FRAME', {
    ...createChartModuleFrameOverrides({
      values: [10, 40, -20],
      labels: ['A', 'B', 'C'],
      color: '#7C3AED'
    }),
    ...overrides
  })
}

describe('chart module canvas preview', () => {
  test('draws a bounded offline bar chart through the module adapter registry', () => {
    const canvas = createMockCanvas()
    const renderer = createMockRenderer({ zoom: 1 })

    const rendered = renderChartModulePreview(renderer, canvas as Canvas, chartFrame())

    expect(rendered).toBe(true)
    expect(canvas.save).toHaveBeenCalledTimes(1)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    // Baseline plus three bars.
    expect(canvas.drawRect).toHaveBeenCalledTimes(4)
    expect(canvas.restore).toHaveBeenCalledTimes(1)
  })

  test('regular FRAME rendering dispatches the chart without a chart branch', () => {
    const canvas = createMockCanvas()
    const renderer = createMockRenderer({ zoom: 1 })

    renderShapeUncached(renderer, canvas as Canvas, chartFrame(), new SceneGraph())

    expect(renderer.drawNodeFill).toHaveBeenCalledTimes(1)
    expect(canvas.drawRect).toHaveBeenCalledTimes(4)
  })

  test('draws bounded labels and optional values when the preview font is ready', () => {
    const canvas = {
      ...createMockCanvas(),
      drawText: mock(() => undefined)
    }
    const labelFont = {
      getGlyphIDs: (text: string) => [...text].map((_, index) => index),
      getGlyphWidths: (glyphs: number[]) => glyphs.map(() => 6)
    }
    const renderer = createMockRenderer({ zoom: 1, labelFont: labelFont as never })

    renderChartModulePreview(
      renderer,
      canvas as Canvas,
      chartFrame({
        interactiveProps: {
          module: createChartModuleInstance({
            values: [10, -5],
            labels: ['Positive', 'Negative'],
            showValues: true
          })
        }
      })
    )

    expect(canvas.drawText).toHaveBeenCalledTimes(4)
    expect(canvas.drawText.mock.calls.map((call) => call[0])).toEqual([
      'Positive',
      '10',
      'Negative',
      '-5'
    ])
  })

  test('unknown module identities fail closed without drawing', () => {
    const canvas = createMockCanvas()
    const renderer = createMockRenderer({ zoom: 1 })
    const node = chartFrame({
      interactiveProps: {
        module: {
          version: 1,
          pluginId: 'unknown.plugin',
          moduleType: 'chart',
          configVersion: 1,
          config: {}
        }
      }
    })

    expect(renderChartModulePreview(renderer, canvas as Canvas, node)).toBe(false)
    expect(canvas.drawRect).not.toHaveBeenCalled()
  })

  test('freezes trusted adapter registration and rejects invalid identities', () => {
    const render = () => true
    const registry = new ModuleCanvasAdapterRegistry().register({
      pluginId: 'example.chart',
      moduleType: 'chart',
      render
    })
    expect(() =>
      registry.register({ pluginId: 'example.chart', moduleType: 'chart', render })
    ).toThrow('Duplicate module canvas adapter')
    registry.freeze()
    expect(() =>
      registry.register({ pluginId: 'example.other', moduleType: 'chart', render })
    ).toThrow('frozen')
    expect(() =>
      new ModuleCanvasAdapterRegistry().register({
        pluginId: 'unsafe plugin',
        moduleType: 'chart',
        render
      })
    ).toThrow('canvas module pluginId')
  })
})
