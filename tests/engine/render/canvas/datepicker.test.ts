import { expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { renderDatePickerContent } from '#core/canvas/datepicker'
import { renderShapeUncached } from '#core/canvas/scene'

import { createMockCanvas, createMockRenderer, mockCalls } from './effects/helpers'

function draw(overrides: Partial<SceneNode> = {}) {
  const graph = new SceneGraph()
  const node = graph.createNode('DATEPICKER', graph.getPages()[0].id, {
    width: 240,
    height: 44,
    fontSize: 14,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 4,
    paddingBottom: 4,
    ...overrides
  })
  const canvas = createMockCanvas()
  const renderer = createMockRenderer()
  const render = () => renderDatePickerContent(renderer, canvas as Canvas, node, graph)
  const labels = () =>
    mockCalls(renderer.renderText as ReturnType<typeof mock>).map((call) => call[1])
  return { graph, node, canvas, renderer, render, labels }
}

test('the normal scene renderer overlays date content on its authored field shape', () => {
  const { graph, node, canvas } = draw({ interactiveProps: { value: '2026-09-24' } })
  const renderer = createMockRenderer({ renderEffects: mock(() => undefined) })
  renderShapeUncached(renderer, canvas as Canvas, node, graph)
  expect(mockCalls(renderer.renderText as ReturnType<typeof mock>)[0]?.[1]).toMatchObject({
    type: 'TEXT',
    text: '2026-09-24'
  })
  expect(canvas.drawRRect).toHaveBeenCalledTimes(1)
})

test.each(['2024-02-29', '2026-09-24', '2026-12-31'])(
  'draws the exact ISO date %s without locale or timezone conversion',
  (value) => {
    const { node, canvas, render, labels } = draw({ interactiveProps: { value } })
    const before = structuredClone(node)
    render()
    expect(labels()).toMatchObject([
      {
        type: 'TEXT',
        text: value,
        width: 192,
        height: 36,
        textAlignVertical: 'CENTER',
        maxLines: 1
      }
    ])
    expect(canvas.drawRRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawLine).toHaveBeenCalledTimes(3)
    expect(canvas.translate).toHaveBeenCalledWith(12, 4)
    expect(canvas.clipRect).toHaveBeenCalledWith(new Float32Array([0, 0, 216, 36]), 0, true)
    expect(node).toEqual(before)
  }
)

test.each(['', '2026-02-30', '2026-9-4', 'not a date', '2026-09-24T00:00:00Z'])(
  'shows a neutral format placeholder for empty or invalid date %s',
  (value) => {
    const { render, labels } = draw({
      interactiveProps: { value, placeholder: 'Tomorrow', min: '2026-01-01' }
    })
    render()
    expect(labels()).toMatchObject([{ text: 'YYYY-MM-DD' }])
  }
)

test('retains valid out-of-range dates and does not replace them with a fabricated valid value', () => {
  const { render, labels } = draw({
    interactiveProps: { value: '2024-02-29', min: '2026-01-01', max: '2026-12-31' }
  })
  render()
  expect(labels()).toMatchObject([{ text: '2024-02-29' }])
})

test('page and document binding defaults take priority, including empty and invalid bound values', () => {
  for (const kind of ['ref', 'docState'] as const) {
    const { graph, node, render, labels } = draw({
      interactiveProps: { value: '2026-01-01' },
      bindings: {
        value: kind === 'ref' ? { kind, stateId: 'date' } : { kind, docStateName: 'date' }
      }
    })
    for (const value of ['2024-02-29', '', 'invalid']) {
      graph.updateNode(kind === 'ref' ? graph.getPages()[0].id : graph.rootId, {
        [kind === 'ref' ? 'state' : 'lowcodeDocumentState']: [
          { id: 'date', name: 'date', type: 'string', defaultValue: value }
        ]
      })
      render()
      expect(labels().at(-1)).toMatchObject({ text: value === '2024-02-29' ? value : 'YYYY-MM-DD' })
      expect(node.interactiveProps.value).toBe('2026-01-01')
    }
  }
})

test('disabled content dims while readonly dates stay readable without a picker icon', () => {
  const disabled = draw({
    interactiveProps: { value: '2026-09-24', disabled: true, textColor: '#336699' }
  })
  disabled.render()
  expect(disabled.renderer.color4f).toHaveBeenCalledWith(0.2, 0.4, 0.6, 0.45)
  expect(disabled.canvas.drawRRect).toHaveBeenCalledTimes(1)
  const readonly = draw({
    interactiveProps: { value: '2026-09-24', readOnly: true, textColor: '#336699' }
  })
  readonly.render()
  expect(readonly.renderer.color4f).toHaveBeenCalledWith(0.2, 0.4, 0.6, 1)
  expect(readonly.canvas.drawRRect).not.toHaveBeenCalled()
  expect(readonly.labels()).toMatchObject([{ text: '2026-09-24', width: 216 }])
})

test('narrow and fully padded controls never paint unbounded text or invalid geometry', () => {
  const narrow = draw({ width: 30, interactiveProps: { value: '2026-09-24' } })
  narrow.render()
  expect(narrow.labels()).toEqual([])
  expect(narrow.canvas.clipRRect).toHaveBeenCalledTimes(1)
  const padded = draw({ width: 20 })
  padded.render()
  expect(padded.labels()).toEqual([])
  expect(padded.canvas.drawRRect).not.toHaveBeenCalled()
})
