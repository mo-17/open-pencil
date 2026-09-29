import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { textInputDesignContent } from '#core/canvas/control-state'
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
    interactiveProps: { inputType: 'color', value: '#2563eb' }
  })
  return { graph, page, node }
}
function ink(
  data: Uint8Array | Float32Array,
  left: number,
  top: number,
  right: number,
  bottom: number
) {
  let n = 0
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) if (data[(y * 680 + x) * 4] < 240) n++
  return n
}
test('color projection reads string states without fabricating missing, invalid or incompatible colors', () => {
  const { graph, page, node } = fixture()
  expect(textInputProjection(node)?.node.text).toBe('#2563eb')
  graph.updateNode(page.id, {
    state: [
      { id: 'string', name: 'color', type: 'string', defaultValue: '#aabbcc' },
      { id: 'number', name: 'notColor', type: 'number', defaultValue: 123 }
    ]
  })
  graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId: 'string' } } })
  expect(textInputProjection(node, textInputDesignContent(graph, node))?.node.text).toBe('#aabbcc')
  graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId: 'number' } } })
  expect(textInputProjection(node, textInputDesignContent(graph, node))?.node.text).toBe('—')
  graph.updateNode(node.id, {
    bindings: {},
    interactiveProps: { inputType: 'color', value: 'not-a-color' }
  })
  expect(textInputProjection(node)?.node.text).toBe('not-a-color')
  graph.updateNode(node.id, { interactiveProps: { inputType: 'color' } })
  expect(textInputProjection(node)?.node.text).toBe('—')
})
test('real CanvasKit draws accurate color swatches and readable text, clips tiny fields and mutes disabled', async () => {
  const h = await carouselPixelHarness(),
    { graph, node } = fixture()
  const draw = () => {
    h.canvas.clear(h.ck.WHITE)
    renderTextInputContent(h.renderer, h.canvas, node, graph)
    return h.pixels()
  }
  try {
    const enabled = draw()
    expect(h.rgb(enabled, 25, 22)).toEqual([37, 99, 235])
    expect(ink(enabled, 52, 8, 170, 36)).toBeGreaterThan(140)
    expect(ink(enabled, 0, 0, 12, 70)).toBe(0)
    expect(ink(enabled, 320, 0, 680, 70)).toBe(0)
    graph.updateNode(node.id, {
      interactiveProps: { inputType: 'color', value: '#2563eb', disabled: true }
    })
    expect(h.rgb(draw(), 25, 22)[0]).toBeGreaterThan(130)
    graph.updateNode(node.id, {
      width: 22,
      height: 20,
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 2,
      paddingBottom: 2
    })
    const tiny = draw()
    expect(ink(tiny, 22, 0, 680, 70)).toBe(0)
    expect(ink(tiny, 0, 20, 680, 70)).toBe(0)
  } finally {
    h.dispose()
  }
})
test('canvas color state evidence includes valid, empty, invalid, readonly and disabled without document mutation', async () => {
  const h = await carouselPixelHarness(),
    { graph, node } = fixture()
  try {
    h.canvas.clear(h.ck.WHITE)
    const states = [
      { value: '#2563eb' },
      { value: '' },
      { value: 'not-a-color' },
      { value: '#ea580c', readOnly: true },
      { value: '#16a34a', disabled: true }
    ]
    states.forEach((props, index) => {
      graph.updateNode(node.id, { interactiveProps: { inputType: 'color', ...props } })
      const before = JSON.stringify(node.interactiveProps)
      h.canvas.save()
      h.canvas.translate(20, 20 + index * 60)
      renderTextInputContent(h.renderer, h.canvas, node, graph)
      h.canvas.restore()
      expect(JSON.stringify(node.interactiveProps)).toBe(before)
    })
    await h.save('color-input-states')
  } finally {
    h.dispose()
  }
})
