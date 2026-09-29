import { describe, expect, mock, spyOn, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { ModuleCanvasAdapterRegistry, renderChartModulePreview } from '#core/canvas/modules'
import { chartTextNode } from '#core/canvas/modules/chart/text'
import { renderShapeUncached } from '#core/canvas/scene'
import { createChartModuleFrameOverrides } from '#core/plugins/chart'
import { collectGraphFontRequirements } from '#core/text/requirements'
import { missingGlyphCharacters } from '#core/text/resolver'

import { carouselPixelHarness } from './carousel/helpers'
import { createMockCanvas, createMockRenderer } from './effects/helpers'

function chartRenderer() {
  const renderer = createMockRenderer({ zoom: 1 })
  renderer.ck.Path.MakeFromSVGString = mock(() => new renderer.ck.PathBuilder().detachAndDelete())
  return renderer
}

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
  test('empty-state copy and font preflight use authored lang before the text-language fallback', async () => {
    const h = await carouselPixelHarness()
    const shaped: SceneNode[] = []
    const build = h.renderer.buildParagraph.bind(h.renderer)
    const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((node, color, options) => {
      shaped.push(node)
      return build(node, color, options)
    })
    try {
      for (const [lang, textLanguage, locale, copy] of [
        ['zh-CN', 'en', 'zh-CN', '暂无非零数据'],
        ['en', 'zh-CN', 'en', 'No non-zero values'],
        [' ', 'zh-CN', 'zh-CN', '暂无非零数据'],
        ['', '', 'en', 'No non-zero values']
      ]) {
        const overrides = createChartModuleFrameOverrides({
          chartType: 'donut',
          values: [0],
          labels: ['A']
        })
        const node = chartFrame({
          ...overrides,
          textLanguage,
          interactiveProps: { ...overrides.interactiveProps, lang }
        })
        const projection = chartTextNode(node)
        expect(projection?.textLanguage).toBe(locale)
        expect(projection?.text).toContain(copy)
        h.canvas.clear(h.ck.WHITE)
        expect(renderChartModulePreview(h.renderer, h.canvas, node)).toBe(true)
        expect(shaped.at(-1)?.text).toBe(copy)
        expect(shaped.at(-1)?.textLanguage).toBe(locale)
      }
    } finally {
      spy.mockRestore()
      h.dispose()
    }
  })

  test('draws a bounded offline bar chart through the module adapter registry', () => {
    const canvas = createMockCanvas()
    const renderer = chartRenderer()

    const rendered = renderChartModulePreview(renderer, canvas as Canvas, chartFrame())

    expect(rendered).toBe(true)
    expect(canvas.save).toHaveBeenCalledTimes(1)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    // Background plus three bars; the zero baseline is an SVG-compatible path.
    expect(canvas.drawRect).toHaveBeenCalledTimes(4)
    expect(canvas.drawPath).toHaveBeenCalledTimes(1)
    expect(canvas.restore).toHaveBeenCalledTimes(1)
  })

  test('regular FRAME rendering dispatches the chart without a chart branch', () => {
    const canvas = createMockCanvas()
    const renderer = chartRenderer()

    renderShapeUncached(renderer, canvas as Canvas, chartFrame(), new SceneGraph())

    expect(renderer.drawNodeFill).toHaveBeenCalledTimes(1)
    expect(canvas.drawRect).toHaveBeenCalledTimes(4)
  })

  test('all chart types shape Chinese labels without missing glyphs and paint offline geometry', async () => {
    const h = await carouselPixelHarness(),
      graph = new SceneGraph()
    const missing: string[] = [],
      shaped: string[] = []
    const build = h.renderer.buildParagraph.bind(h.renderer)
    const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((node, color, options) => {
      const paragraph = build(node, color, options)
      shaped.push(node.text)
      missing.push(...missingGlyphCharacters(node.text, paragraph.getShapedLines()))
      return paragraph
    })
    try {
      for (const chartType of ['bar', 'line', 'area', 'pie', 'donut']) {
        const node = graph.createNode('FRAME', graph.getPages()[0].id, {
          ...createChartModuleFrameOverrides({
            chartType,
            values: [12, 24, 36],
            labels: ['收入', '支出', '净额'],
            showValues: true
          }),
          textLanguage: 'zh-CN'
        })
        h.canvas.clear(h.ck.WHITE)
        expect(renderChartModulePreview(h.renderer, h.canvas, node)).toBe(true)
        expect(collectGraphFontRequirements(graph, [node.id]).scripts).toContain('cjk-sc')
        const pixels = h.pixels()
        let colored = 0
        for (let y = 0; y < 240; y++)
          for (let x = 0; x < 360; x++) {
            const [r, g, b] = h.rgb(pixels, x, y)
            if (b > r * 1.5 && b > g) colored++
          }
        expect(colored).toBeGreaterThan(50)
        await h.save('chart-' + chartType)
      }
      expect(missing).toEqual([])
      expect(shaped.some((text) => text.includes('收入'))).toBe(true)
      expect(shaped).toContain('12')
    } finally {
      spy.mockRestore()
      h.dispose()
    }
  })

  test('unknown module identities fail closed without drawing', () => {
    const canvas = createMockCanvas()
    const renderer = chartRenderer()
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
