import { expect, spyOn, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { controlDesignDependencies } from '#core/canvas/control-state'
import { renderDateRangeModulePreview } from '#core/canvas/modules/date-range'
import { renderRatingModulePreview } from '#core/canvas/modules/rating'
import { renderSliderModulePreview } from '#core/canvas/modules/slider'
import { sliderPreviewGeometry } from '#core/canvas/modules/slider/geometry'
import { readModuleInitialValue } from '#core/canvas/modules/value-controls'
import { createDateRangeModuleFrameOverrides, DATE_RANGE_MESSAGES } from '#core/plugins/date-range'
import { createRatingModuleFrameOverrides } from '#core/plugins/rating'
import {
  createSliderModuleFrameOverrides,
  SLIDER_MODULE_DEFAULT_CONFIG
} from '#core/plugins/slider'
import { missingGlyphCharacters } from '#core/text/resolver'

import { carouselPixelHarness } from './carousel/helpers'

async function valueHarness() {
  const harness = await carouselPixelHarness(),
    texts: string[] = [],
    missing: string[] = [],
    build = harness.renderer.buildParagraph.bind(harness.renderer)
  const spy = spyOn(harness.renderer, 'buildParagraph').mockImplementation(
    (label, color, options) => {
      const paragraph = build(label, color, options)
      texts.push(label.text)
      missing.push(...missingGlyphCharacters(label.text, paragraph.getShapedLines()))
      return paragraph
    }
  )
  return {
    ...harness,
    texts,
    missing,
    reset() {
      texts.length = 0
      harness.canvas.clear(harness.ck.WHITE)
    },
    dispose() {
      spy.mockRestore()
      harness.dispose()
    }
  }
}
function graphValues(graph: SceneGraph, nodes: SceneNode[]) {
  return structuredClone([graph.getNode(graph.rootId), ...graph.getPages(), ...nodes])
}

test('bound module Canvas paints page and document defaults, both endpoints and CJK without writing the graph', async () => {
  const h = await valueHarness(),
    graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      { id: 'start', name: 'start', type: 'number', defaultValue: 20 },
      { id: 'date', name: 'date', type: 'string', defaultValue: '2026-09-03' }
    ]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'end', name: 'end', type: 'number', defaultValue: 80 },
      { id: 'score', name: 'score', type: 'number', defaultValue: 4.5 },
      { id: 'dateEnd', name: 'dateEnd', type: 'string', defaultValue: '2026-09-12' }
    ]
  })
  const slider = graph.createNode('FRAME', page.id, {
      ...createSliderModuleFrameOverrides({ label: '价格范围', range: true }),
      textLanguage: 'zh-CN',
      bindings: {
        value: { kind: 'ref', stateId: 'start' },
        endValue: { kind: 'docState', docStateName: 'end' }
      }
    }),
    rating = graph.createNode('FRAME', page.id, {
      ...createRatingModuleFrameOverrides({
        label: '使用体验',
        clearLabel: '清空评分',
        allowHalf: true
      }),
      textLanguage: 'zh-CN',
      bindings: { value: { kind: 'docState', docStateName: 'score' } }
    }),
    date = graph.createNode('FRAME', page.id, {
      ...createDateRangeModuleFrameOverrides({
        label: '出行日期',
        initialStart: '2026-09-01',
        initialEnd: '2026-09-05'
      }),
      textLanguage: 'zh-CN',
      bindings: {
        value: { kind: 'ref', stateId: 'date' },
        endValue: { kind: 'docState', docStateName: 'dateEnd' }
      }
    })
  const nodes = [slider, rating, date],
    before = graphValues(graph, nodes)
  try {
    h.reset()
    expect(renderSliderModulePreview(h.renderer, h.canvas, slider, graph)).toBe(true)
    h.canvas.save()
    h.canvas.translate(350, 0)
    expect(renderRatingModulePreview(h.renderer, h.canvas, rating, graph)).toBe(true)
    h.canvas.restore()
    h.canvas.save()
    h.canvas.translate(0, 160)
    expect(renderDateRangeModulePreview(h.renderer, h.canvas, date, graph)).toBe(true)
    h.canvas.restore()
    for (const label of [
      '价格范围',
      '20 – 80',
      '使用体验',
      '4.5 / 5',
      '出行日期',
      '2026-09-03',
      '2026-09-12'
    ])
      expect(h.texts).toContain(label)
    for (const authored of ['30 – 70', '3 / 5', '2026-09-01', '2026-09-05'])
      expect(h.texts).not.toContain(authored)
    expect(h.missing).toEqual([])
    const geometry = sliderPreviewGeometry(slider.width, {
      ...SLIDER_MODULE_DEFAULT_CONFIG,
      range: true,
      initialValue: 20,
      initialEndValue: 80
    })
    for (const x of [geometry.startX, geometry.endX])
      expect(h.rgb(h.pixels(), Math.round(x), Math.round(geometry.trackY))).toEqual([37, 99, 235])
    expect(graphValues(graph, nodes)).toEqual(before)
    expect(controlDesignDependencies(graph, slider)).toEqual([page.id, graph.rootId])
    expect(controlDesignDependencies(graph, rating)).toEqual([graph.rootId])
    expect(controlDesignDependencies(graph, date)).toEqual([page.id, graph.rootId])
    await h.save('module-values-bound')
    graph.updateNode(page.id, {
      state: [{ id: 'start', name: 'start', type: 'number', defaultValue: 40 }]
    })
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'end', name: 'end', type: 'number', defaultValue: 90 }]
    })
    h.reset()
    renderSliderModulePreview(h.renderer, h.canvas, slider, graph)
    expect(h.texts).toContain('40 – 90')
    expect(controlDesignDependencies(graph, slider)).toEqual([page.id, graph.rootId])
  } finally {
    h.dispose()
  }
})

test('invalid numeric defaults stay unavailable instead of becoming zero, authored defaults or rounded steps', async () => {
  const h = await valueHarness(),
    graph = new SceneGraph(),
    page = graph.getPages()[0]
  const slider = graph.createNode('FRAME', page.id, {
    ...createSliderModuleFrameOverrides({ step: 10 }),
    bindings: { value: { kind: 'ref', stateId: 'numeric' } }
  })
  const rating = graph.createNode('FRAME', page.id, {
    ...createRatingModuleFrameOverrides(),
    bindings: { value: { kind: 'ref', stateId: 'numeric' } }
  })
  try {
    for (const value of [21, -1, 101, Number.NaN]) {
      graph.updateNode(page.id, {
        state: [{ id: 'numeric', name: 'numeric', type: 'number', defaultValue: value }]
      })
      const before = graphValues(graph, [slider])
      h.reset()
      renderSliderModulePreview(h.renderer, h.canvas, slider, graph)
      expect(h.texts).toContain('—')
      expect(h.texts).not.toContain('30')
      expect(graphValues(graph, [slider])).toEqual(before)
    }
    for (const value of [3.5, 6, -1]) {
      graph.updateNode(page.id, {
        state: [{ id: 'numeric', name: 'numeric', type: 'number', defaultValue: value }]
      })
      h.reset()
      renderRatingModulePreview(h.renderer, h.canvas, rating, graph)
      expect(h.texts).toContain('—')
      expect(h.texts).not.toContain('3 / 5')
      expect(h.rgb(h.pixels(), 28, 62)).toEqual([209, 213, 219])
    }
    const range = graph.createNode('FRAME', page.id, {
      ...createSliderModuleFrameOverrides({ range: true }),
      bindings: { endValue: { kind: 'ref', stateId: 'missing' } }
    })
    h.reset()
    renderSliderModulePreview(h.renderer, h.canvas, range, graph)
    expect(h.texts).toContain('—')
    expect(h.texts).not.toContain('30 – 70')
  } finally {
    h.dispose()
  }
})

test('date endpoints retain their own values and show invalid or missing bindings without repairing state', async () => {
  const h = await valueHarness(),
    graph = new SceneGraph(),
    page = graph.getPages()[0]
  const node = graph.createNode('FRAME', page.id, {
    ...createDateRangeModuleFrameOverrides({
      initialStart: '2026-09-01',
      initialEnd: '2026-09-05'
    }),
    bindings: {
      value: { kind: 'ref', stateId: 'date' },
      endValue: { kind: 'docState', docStateName: 'deleted' }
    }
  })
  try {
    graph.updateNode(page.id, {
      state: [{ id: 'date', name: 'date', type: 'string', defaultValue: '2026-02-30' }]
    })
    const before = graphValues(graph, [node])
    h.reset()
    renderDateRangeModulePreview(h.renderer, h.canvas, node, graph)
    expect(h.texts.filter((text) => text === '—')).toHaveLength(2)
    expect(h.texts).not.toContain('2026-09-01')
    expect(h.texts).not.toContain('2026-09-05')
    expect(graphValues(graph, [node])).toEqual(before)
    graph.updateNode(page.id, {
      state: [{ id: 'date', name: 'date', type: 'string', defaultValue: '2026-09-20' }]
    })
    graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId: 'date' } } })
    h.reset()
    renderDateRangeModulePreview(h.renderer, h.canvas, node, graph)
    expect(h.texts).toContain('2026-09-20')
    expect(h.texts).toContain('2026-09-05')
    expect(h.texts).toContain(DATE_RANGE_MESSAGES.en.order)
  } finally {
    h.dispose()
  }
})

test('module default reads respect page/component scope, computed state and explicit missing bindings', () => {
  const graph = new SceneGraph(),
    page = graph.getPages()[0],
    second = graph.createNode('CANVAS', graph.rootId)
  graph.updateNode(page.id, {
    state: [{ id: 'local', name: 'local', type: 'number', defaultValue: 20 }]
  })
  graph.updateNode(second.id, {
    state: [{ id: 'local', name: 'local', type: 'number', defaultValue: 60 }]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [{ id: 'shared', name: 'shared', type: 'number', defaultValue: 80 }]
  })
  const node = graph.createNode('FRAME', page.id, {
    ...createSliderModuleFrameOverrides({ range: true }),
    bindings: {
      value: { kind: 'ref', stateId: 'local' },
      endValue: { kind: 'docState', docStateName: 'shared' }
    }
  })
  expect(readModuleInitialValue(graph, node, 'value', 'number')).toEqual({ bound: true, value: 20 })
  expect(readModuleInitialValue(graph, node, 'endValue', 'number')).toEqual({
    bound: true,
    value: 80
  })
  expect(readModuleInitialValue(undefined, node, 'value', 'number')).toEqual({
    bound: true,
    value: undefined
  })
  graph.reparentNode(node.id, second.id)
  expect(readModuleInitialValue(graph, node, 'value', 'number').value).toBe(60)
  expect(controlDesignDependencies(graph, node)).toEqual([second.id, graph.rootId])
  const master = graph.createNode('COMPONENT', second.id)
  graph.reparentNode(node.id, master.id)
  expect(readModuleInitialValue(graph, node, 'value', 'number')).toEqual({
    bound: true,
    value: undefined
  })
  expect(readModuleInitialValue(graph, node, 'endValue', 'number').value).toBe(80)
  graph.reparentNode(node.id, second.id)
  graph.updateNode(second.id, {
    state: [
      { id: 'local', name: 'local', type: 'number', defaultValue: 60, computedExpr: '20 * 3' }
    ]
  })
  expect(readModuleInitialValue(graph, node, 'value', 'number').value).toBeUndefined()
  graph.updateNode(node.id, { bindings: { value: { kind: 'expr', expr: '1 + 2' } } })
  expect(readModuleInitialValue(graph, node, 'value', 'number')).toEqual({
    bound: true,
    value: undefined
  })
  graph.updateNode(node.id, { bindings: {} })
  expect(readModuleInitialValue(graph, node, 'value', 'number')).toEqual({
    bound: false,
    value: undefined
  })
  expect(controlDesignDependencies(graph, node)).toEqual([])
})

test('Canvas does not display a valid-looking default from ambiguous or computed state', () => {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  const slider = graph.createNode('FRAME', page.id, {
    ...createSliderModuleFrameOverrides(),
    bindings: { value: { kind: 'ref', stateId: 'first' } }
  })
  graph.updateNode(page.id, {
    state: [
      { id: 'first', name: 'value', type: 'number', defaultValue: 20 },
      { id: 'second', name: 'value', type: 'number', defaultValue: 80 }
    ]
  })
  expect(readModuleInitialValue(graph, slider, 'value', 'number')).toEqual({
    bound: true,
    value: undefined
  })
  graph.updateNode(slider.id, {
    bindings: { value: { kind: 'docState', docStateName: 'computed' } }
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'computed', name: 'computed', type: 'number', defaultValue: 20, computedExpr: '20' }
    ]
  })
  expect(readModuleInitialValue(graph, slider, 'value', 'number')).toEqual({
    bound: true,
    value: undefined
  })
})
