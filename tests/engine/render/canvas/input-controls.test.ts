import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderTextInputContent } from '#core/canvas/lowcode'
import { textInputProjection } from '#core/text/lowcode'

import { carouselPixelHarness } from './carousel/helpers'

type Pixels = Uint8Array | Float32Array
type PixelRegion = readonly [left: number, top: number, right: number, bottom: number]

const FIELD: PixelRegion = [0, 0, 320, 44]
const LEFT_CONTROL: PixelRegion = [18, 12, 35, 32]
const RIGHT_CONTROL: PixelRegion = [282, 4, 308, 40]
const TEXT: PixelRegion = [48, 4, 180, 40]

function darkness(data: Pixels, [left, top, right, bottom]: PixelRegion): number {
  let sum = 0
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) sum += 255 - data[(y * 680 + x) * 4]
  }
  return sum
}

async function fixture() {
  const harness = await carouselPixelHarness()
  const graph = new SceneGraph()
  const node = graph.createNode('INPUT', graph.getPages()[0].id, {
    width: 320,
    height: 44,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 4,
    paddingBottom: 4,
    fontFamily: 'Inter',
    fontSize: 16
  })
  const draw = (interactiveProps: Record<string, unknown>) => {
    graph.updateNode(node.id, { interactiveProps })
    harness.canvas.clear(harness.ck.WHITE)
    renderTextInputContent(harness.renderer, harness.canvas, node, graph)
    return harness.pixels()
  }
  return { ...harness, graph, node, draw }
}

test('real CanvasKit distinguishes number end, sides and explicitly hidden controls while retaining the value', async () => {
  const h = await fixture()
  const config = { inputType: 'number', showStepper: true }
  try {
    const end = h.draw(config)
    expect(darkness(end, RIGHT_CONTROL)).toBeGreaterThan(2000)
    expect(darkness(end, LEFT_CONTROL)).toBe(0)
    const sides = h.draw({ ...config, stepperPlacement: 'sides' })
    expect(darkness(sides, LEFT_CONTROL)).toBeGreaterThan(2000)
    expect(darkness(sides, RIGHT_CONTROL)).toBeGreaterThan(darkness(sides, LEFT_CONTROL) * 1.5)
    const hidden = h.draw({ ...config, showStepper: false, stepperPlacement: 'sides' })
    expect(darkness(hidden, FIELD)).toBe(0)
    const value = h.draw({ ...config, value: '42', stepperPlacement: 'sides' })
    expect(darkness(value, TEXT)).toBeGreaterThan(5000)
    const hiddenValue = h.draw({ ...config, value: '42', showStepper: false })
    expect(darkness(hiddenValue, [12, 4, 50, 40])).toBe(darkness(value, TEXT))
    expect(darkness(hiddenValue, RIGHT_CONTROL)).toBe(0)
    expect(h.node.interactiveProps?.value).toBe('42')
  } finally {
    h.dispose()
  }
})

test('real CanvasKit masks password code points and keeps the eye visible for an empty password', async () => {
  const h = await fixture()
  const value = '密钥🔐A'
  const config = { inputType: 'password', showPasswordToggle: true }
  try {
    const masked = h.draw({ ...config, value })
    expect(textInputProjection(h.node)?.node.text).toBe('••••')
    expect(darkness(masked, RIGHT_CONTROL)).toBeGreaterThan(8000)
    const maskedText = darkness(masked, [12, 4, 200, 40])
    expect(maskedText).toBeGreaterThan(5000)
    const reference = h.draw({ inputType: 'text', value: '••••' })
    expect(darkness(reference, [12, 4, 200, 40])).toBe(maskedText)
    const empty = h.draw(config)
    expect(darkness(empty, [12, 4, 200, 40])).toBe(0)
    expect(darkness(empty, RIGHT_CONTROL)).toBeGreaterThan(8000)
    expect(textInputProjection(h.node)?.node.text).toBe('')
  } finally {
    h.dispose()
  }
})

test('number disabled, readonly and step-any affordances are muted without hiding content', async () => {
  const h = await fixture()
  const config = { inputType: 'number', showStepper: true, stepperPlacement: 'sides', value: '42' }
  try {
    const active = h.draw(config)
    const icon = darkness(active, RIGHT_CONTROL)
    const text = darkness(active, TEXT)
    for (const state of [{ disabled: true }, { readOnly: true }, { step: 'any' }]) {
      const muted = h.draw({ ...config, ...state })
      expect(darkness(muted, RIGHT_CONTROL)).toBeGreaterThan(icon * 0.3)
      expect(darkness(muted, RIGHT_CONTROL)).toBeLessThan(icon * 0.6)
      if ('disabled' in state) {
        expect(darkness(muted, TEXT)).toBeGreaterThan(text * 0.3)
        expect(darkness(muted, TEXT)).toBeLessThan(text * 0.6)
      } else expect(darkness(muted, TEXT)).toBe(text)
    }
    const password = { inputType: 'password', value: 'secret', showPasswordToggle: true }
    const eye = darkness(h.draw(password), RIGHT_CONTROL)
    expect(darkness(h.draw({ ...password, readOnly: true }), RIGHT_CONTROL)).toBe(eye)
    expect(darkness(h.draw({ ...password, disabled: true }), RIGHT_CONTROL)).toBeLessThan(eye * 0.6)
  } finally {
    h.dispose()
  }
})

test('long values and every authored input control remain clipped inside a narrow field', async () => {
  const h = await fixture()
  try {
    h.graph.updateNode(h.node.id, {
      width: 34,
      height: 20,
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 2,
      paddingBottom: 2
    })
    const variants = [
      { inputType: 'number', value: '123456789', showStepper: true },
      { inputType: 'number', value: '123456789', showStepper: true, stepperPlacement: 'sides' },
      { inputType: 'number', value: '123456789', showStepper: false },
      { inputType: 'password', value: '很长的密码🔐', showPasswordToggle: true }
    ]
    for (const properties of variants) {
      const pixels = h.draw(properties)
      expect(darkness(pixels, [2, 2, 32, 18])).toBeGreaterThan(500)
      expect(darkness(pixels, [0, 0, 2, 400])).toBe(0)
      expect(darkness(pixels, [32, 0, 680, 400])).toBe(0)
      expect(darkness(pixels, [0, 0, 680, 2])).toBe(0)
      expect(darkness(pixels, [0, 18, 680, 400])).toBe(0)
    }
  } finally {
    h.dispose()
  }
})

test('offline input controls evidence captures authored states without changing their values', async () => {
  const h = await fixture()
  const states = [
    { inputType: 'number', value: '42', showStepper: true },
    { inputType: 'number', value: '42', showStepper: true, stepperPlacement: 'sides' },
    { inputType: 'number', value: '42', showStepper: false },
    { inputType: 'number', value: '42', showStepper: true, readOnly: true },
    { inputType: 'number', value: '42', showStepper: true, disabled: true },
    { inputType: 'password', value: '密钥🔐A', showPasswordToggle: true },
    { inputType: 'password', value: '', showPasswordToggle: true }
  ]
  try {
    h.canvas.clear(h.ck.WHITE)
    states.forEach((interactiveProps, index) => {
      h.graph.updateNode(h.node.id, { interactiveProps })
      h.canvas.save()
      h.canvas.translate(20, 20 + index * 52)
      renderTextInputContent(h.renderer, h.canvas, h.node, h.graph)
      h.canvas.restore()
      expect(h.node.interactiveProps).toEqual(interactiveProps)
    })
    expect(darkness(h.pixels(), [20, 20, 340, 400])).toBeGreaterThan(100000)
    await h.save('input-control-states')
  } finally {
    h.dispose()
  }
})
