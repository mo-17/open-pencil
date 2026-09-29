import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { textInputDesignContent } from '#core/canvas/control-state'
import { dateTimeInputCalendarSize } from '#core/canvas/date-time-input'
import { renderTextInputContent } from '#core/canvas/lowcode'
import { textInputProjection } from '#core/text/lowcode'

import { carouselPixelHarness } from './carousel/helpers'

function fixture() {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  const node = graph.createNode('INPUT', page.id, {
    width: 320,
    height: 44,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 4,
    paddingBottom: 4,
    fontFamily: 'Inter',
    fontSize: 16,
    interactiveProps: { inputType: 'datetime-local', value: '2026-09-28T09:30:15', step: 15 }
  })
  return { graph, page, node }
}

function ink(
  data: Uint8Array | Float32Array,
  left: number,
  top: number,
  right: number,
  bottom: number
): number {
  let result = 0
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) if (data[(y * 680 + x) * 4] < 240) result++
  return result
}

test('date-time canvas uses local authored text, rejects malformed strings and reflects string binding only', () => {
  const { graph, page, node } = fixture()
  expect(textInputProjection(node)?.node.text).toBe('2026-09-28 09:30:15')
  for (const value of ['2026-02-30T12:00', '2026-09-28T12:\n00', '2026-09-28T12:00Z']) {
    graph.updateNode(node.id, {
      interactiveProps: { inputType: 'datetime-local', value, placeholder: 'Not a date' }
    })
    expect(textInputProjection(node)?.node.text).toBe('YYYY-MM-DD HH:mm')
  }
  graph.updateNode(node.id, { interactiveProps: { inputType: 'datetime-local', step: 1 } })
  expect(textInputProjection(node)?.node.text).toBe('YYYY-MM-DD HH:mm:ss')
  graph.updateNode(page.id, {
    state: [
      { id: 'text', name: 'appointment', type: 'string', defaultValue: '2026-12-31T23:45' },
      { id: 'number', name: 'numericDate', type: 'number', defaultValue: 20261231 }
    ]
  })
  graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId: 'text' } } })
  expect(textInputProjection(node, textInputDesignContent(graph, node))?.node.text).toBe(
    '2026-12-31 23:45'
  )
  graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId: 'number' } } })
  expect(textInputDesignContent(graph, node)).toEqual({ value: undefined, unresolved: true })
  expect(textInputProjection(node, textInputDesignContent(graph, node))?.contentKind).toBe(
    'input_placeholder'
  )
})

test('real CanvasKit keeps date-time text and calendar inside field, removes readonly affordance', async () => {
  const harness = await carouselPixelHarness(),
    { graph, node } = fixture()
  const draw = () => {
    harness.canvas.clear(harness.ck.WHITE)
    renderTextInputContent(harness.renderer, harness.canvas, node, graph)
    return harness.pixels()
  }
  try {
    const enabled = draw()
    expect(ink(enabled, 12, 4, 280, 40)).toBeGreaterThan(400)
    expect(ink(enabled, 292, 13, 309, 31)).toBeGreaterThan(25)
    expect(ink(enabled, 0, 0, 12, 70)).toBe(0)
    expect(ink(enabled, 320, 0, 680, 70)).toBe(0)
    graph.updateNode(node.id, { interactiveProps: { ...node.interactiveProps, readOnly: true } })
    expect(dateTimeInputCalendarSize(node, 296, 36)).toBe(0)
    const readonly = draw()
    expect(ink(readonly, 292, 13, 309, 31)).toBe(0)
    expect(ink(readonly, 12, 4, 280, 40)).toBeGreaterThan(400)
    graph.updateNode(node.id, {
      width: 34,
      height: 20,
      paddingLeft: 2,
      paddingRight: 2,
      interactiveProps: { inputType: 'datetime-local' }
    })
    const tiny = draw()
    expect(ink(tiny, 0, 0, 34, 20)).toBeGreaterThan(10)
    expect(ink(tiny, 34, 0, 680, 70)).toBe(0)
    expect(ink(tiny, 0, 20, 680, 70)).toBe(0)
  } finally {
    harness.dispose()
  }
})

test('disabled date-time stays visible and offline render captures initial, seconds, empty and readonly states', async () => {
  const harness = await carouselPixelHarness(),
    { graph, node } = fixture()
  const darkness = () => {
    harness.canvas.clear(harness.ck.WHITE)
    renderTextInputContent(harness.renderer, harness.canvas, node, graph)
    return harness
      .pixels()
      .reduce((sum, channel, index) => sum + (index % 4 === 0 ? 255 - channel : 0), 0)
  }
  try {
    const enabled = darkness()
    graph.updateNode(node.id, { interactiveProps: { ...node.interactiveProps, disabled: true } })
    const disabled = darkness()
    expect(disabled).toBeGreaterThan(enabled * 0.3)
    expect(disabled).toBeLessThan(enabled * 0.6)
    harness.canvas.clear(harness.ck.WHITE)
    const states = [
      { value: '2026-09-28T09:30' },
      { value: '2026-09-28T09:30:15', step: 15 },
      { value: '', step: 1 },
      { value: '2026-09-28T09:30', readOnly: true },
      { value: '2026-09-28T09:30', disabled: true }
    ]
    states.forEach((properties, index) => {
      graph.updateNode(node.id, {
        interactiveProps: { inputType: 'datetime-local', ...properties }
      })
      harness.canvas.save()
      harness.canvas.translate(20, 20 + index * 60)
      renderTextInputContent(harness.renderer, harness.canvas, node, graph)
      harness.canvas.restore()
    })
    await harness.save('date-time-input-states')
  } finally {
    harness.dispose()
  }
})
