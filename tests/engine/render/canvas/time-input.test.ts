import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { textInputDesignContent } from '#core/canvas/control-state'
import { renderTextInputContent } from '#core/canvas/lowcode'
import { timeInputClockSize } from '#core/canvas/time-input'
import { textInputProjection } from '#core/text/lowcode'

import { carouselPixelHarness } from './carousel/helpers'

function fixture() {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  const node = graph.createNode('INPUT', page.id, {
    width: 220,
    height: 44,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 4,
    paddingBottom: 4,
    fontFamily: 'Inter',
    fontSize: 16,
    interactiveProps: { inputType: 'time', value: '09:30:15', step: 15 }
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
  let count = 0
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) if (data[(y * 680 + x) * 4] < 240) count++
  return count
}

test('time canvas shows valid initial string state and a neutral precision-aware empty display', () => {
  const { graph, page, node } = fixture()
  expect(textInputProjection(node)?.node.text).toBe('09:30:15')
  graph.updateNode(node.id, {
    interactiveProps: { inputType: 'time', value: 'bad', placeholder: 'Ignored by native time' }
  })
  expect(textInputProjection(node)?.node.text).toBe('HH:mm')
  graph.updateNode(node.id, { interactiveProps: { inputType: 'time', value: '09:\n30' } })
  expect(textInputProjection(node)?.node.text).toBe('HH:mm')
  graph.updateNode(node.id, { interactiveProps: { inputType: 'time', value: '', step: 1 } })
  expect(textInputProjection(node)?.node.text).toBe('HH:mm:ss')
  graph.updateNode(page.id, {
    state: [
      { id: 'time', name: 'appointment', type: 'string', defaultValue: '18:45' },
      { id: 'number', name: 'count', type: 'number', defaultValue: 1230 }
    ]
  })
  graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId: 'time' } } })
  expect(textInputProjection(node, textInputDesignContent(graph, node))?.node.text).toBe('18:45')
  graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId: 'number' } } })
  expect(textInputDesignContent(graph, node)).toEqual({ value: undefined, unresolved: true })
  expect(textInputProjection(node, textInputDesignContent(graph, node))?.node.text).toBe('HH:mm:ss')
})

test('real CanvasKit paints time text and clock, keeps readonly text and clips narrow fields', async () => {
  const harness = await carouselPixelHarness(),
    { graph, node } = fixture()
  const draw = () => {
    harness.canvas.clear(harness.ck.WHITE)
    renderTextInputContent(harness.renderer, harness.canvas, node, graph)
    return harness.pixels()
  }
  try {
    const enabled = draw()
    expect(ink(enabled, 12, 4, 160, 40)).toBeGreaterThan(150)
    expect(ink(enabled, 191, 13, 209, 31)).toBeGreaterThan(25)
    expect(ink(enabled, 0, 0, 12, 70)).toBe(0)
    expect(ink(enabled, 220, 0, 680, 70)).toBe(0)
    graph.updateNode(node.id, {
      interactiveProps: { inputType: 'time', value: '09:30:15', readOnly: true }
    })
    expect(timeInputClockSize(node, 196, 36)).toBe(0)
    const readonly = draw()
    expect(ink(readonly, 191, 13, 209, 31)).toBe(0)
    expect(ink(readonly, 12, 4, 160, 40)).toBeGreaterThan(150)
    graph.updateNode(node.id, {
      width: 34,
      height: 20,
      paddingLeft: 2,
      paddingRight: 2,
      interactiveProps: { inputType: 'time' }
    })
    const tiny = draw()
    expect(ink(tiny, 0, 0, 34, 20)).toBeGreaterThan(10)
    expect(ink(tiny, 34, 0, 680, 70)).toBe(0)
    expect(ink(tiny, 0, 20, 680, 70)).toBe(0)
  } finally {
    harness.dispose()
  }
})

test('disabled time is visually muted without hiding the value and emits local visual evidence', async () => {
  const harness = await carouselPixelHarness(),
    { graph, node } = fixture()
  const draw = () => {
    harness.canvas.clear(harness.ck.WHITE)
    renderTextInputContent(harness.renderer, harness.canvas, node, graph)
    return harness.pixels()
  }
  const darkness = (data: Uint8Array | Float32Array) => {
    let result = 0
    for (let i = 0; i < data.length; i += 4) result += 255 - data[i]
    return result
  }
  try {
    const enabled = draw()
    graph.updateNode(node.id, {
      interactiveProps: { inputType: 'time', value: '09:30:15', disabled: true }
    })
    const disabled = draw()
    expect(darkness(disabled)).toBeGreaterThan(darkness(enabled) * 0.3)
    expect(darkness(disabled)).toBeLessThan(darkness(enabled) * 0.6)
    harness.canvas.clear(harness.ck.WHITE)
    const states = [
      { inputType: 'time', value: '09:30' },
      { inputType: 'time', value: '18:45:30', step: 1 },
      { inputType: 'time', value: '', step: 1 },
      { inputType: 'time', value: '09:30', readOnly: true },
      { inputType: 'time', value: '09:30', disabled: true }
    ]
    states.forEach((interactiveProps, index) => {
      graph.updateNode(node.id, { interactiveProps })
      harness.canvas.save()
      harness.canvas.translate(20, 20 + index * 60)
      renderTextInputContent(harness.renderer, harness.canvas, node, graph)
      harness.canvas.restore()
    })
    await harness.save('time-input-states')
  } finally {
    harness.dispose()
  }
})
