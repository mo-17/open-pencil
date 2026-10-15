import { describe, expect, mock, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { renderShapeUncached } from '#core/canvas/scene'
import { renderSwitchContent, withSwitchSurface } from '#core/canvas/switch'

import { asCanvas } from '#tests/engine/render/canvas/helpers'

import { createMockCanvas, createMockRenderer, mockCalls } from './effects/helpers'

describe('SWITCH canvas content', () => {
  test('shows a switch thumb instead of only the template surface', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('SWITCH', graph.getPages()[0].id, {
      width: 44,
      height: 44,
      interactiveProps: { checked: true }
    })
    const canvas = createMockCanvas()
    const renderer = createMockRenderer({ renderEffects: mock(() => undefined) })

    renderShapeUncached(renderer, asCanvas(canvas), node, graph)

    expect(canvas.drawCircle).toHaveBeenCalledTimes(1)
    expect(mockCalls(renderer.drawNodeFill as ReturnType<typeof mock>)[0]?.[1]).toMatchObject({
      type: 'SWITCH',
      cornerRadius: 22,
      cornerSmoothing: 0,
      independentCorners: false,
      fills: [{ type: 'SOLID', color: { r: 37 / 255, g: 99 / 255, b: 235 / 255, a: 1 } }]
    })
    expect(node.height).toBe(44)
    expect(node.childIds).toEqual([])
    expect(mockCalls(renderer.applyFill as ReturnType<typeof mock>)[0]?.[3]).toBe(-1)
  })

  test.each([false, true])('places the thumb at the authored off/on position: %s', (checked) => {
    const graph = new SceneGraph()
    const node = graph.createNode('SWITCH', graph.getPages()[0].id, {
      interactiveProps: { checked }
    })
    const canvas = createMockCanvas()
    const renderer = createMockRenderer()

    renderSwitchContent(renderer, asCanvas(canvas), node, graph)

    expect(mockCalls(canvas.drawCircle)[0]?.[0]).toBeCloseTo(checked ? 32 : 12)
    expect(mockCalls(canvas.drawCircle)[0]?.[1]).toBeCloseTo(12)
    expect(mockCalls(canvas.drawCircle)[0]?.[2]).toBeCloseTo(9.6)
    expect(renderer.color4f).toHaveBeenCalledWith(1, 1, 1, 1)
  })

  test('uses a bound false value ahead of the static checked fallback', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 'enabled', name: 'enabled', type: 'boolean', defaultValue: false }]
    })
    const node = graph.createNode('SWITCH', page.id, {
      interactiveProps: { checked: true },
      bindings: { value: { kind: 'ref', stateId: 'enabled' } }
    })
    const canvas = createMockCanvas()
    const renderer = createMockRenderer()

    renderSwitchContent(renderer, asCanvas(canvas), node, graph)

    expect(mockCalls(canvas.drawCircle)[0]?.[0]).toBeCloseTo(12)
    expect(node.interactiveProps?.checked).toBe(true)
  })

  test('uses the padded wide geometry and dims the completed control exactly once', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('SWITCH', graph.getPages()[0].id, {
      width: 320,
      height: 44,
      paddingLeft: 12,
      paddingRight: 16,
      paddingTop: 4,
      paddingBottom: 6,
      interactiveProps: { checked: true, disabled: true }
    })
    const canvas = createMockCanvas()
    const renderer = createMockRenderer()

    withSwitchSurface(renderer, asCanvas(canvas), node, graph, (surface) => {
      renderSwitchContent(renderer, asCanvas(canvas), surface, graph)
    })

    expect(renderer.ck.LTRBRect).toHaveBeenCalledWith(0, 0, 320, 44)
    expect(mockCalls(canvas.drawCircle)[0]?.[0]).toBeCloseTo(287)
    expect(mockCalls(canvas.drawCircle)[0]?.[1]).toBeCloseTo(21)
    expect(mockCalls(canvas.drawCircle)[0]?.[2]).toBeCloseTo(13.6)
    expect(canvas.saveLayer).toHaveBeenCalledTimes(1)
    expect(renderer.opacityPaint.setAlphaf).toHaveBeenCalledWith(0.45)
    expect(renderer.opacityPaint.setAlphaf).toHaveBeenLastCalledWith(1)
    expect(renderer.color4f).toHaveBeenCalledWith(1, 1, 1, 1)
  })

  test.each([{ width: 0 }, { height: 0 }, { width: 10, paddingLeft: 12 }])(
    'does not draw outside an empty content box: %j',
    (size: Partial<SceneNode>) => {
      const graph = new SceneGraph()
      const node = graph.createNode('SWITCH', graph.getPages()[0].id, size)
      const canvas = createMockCanvas()

      renderSwitchContent(createMockRenderer(), asCanvas(canvas), node, graph)

      expect(canvas.drawCircle).not.toHaveBeenCalled()
      expect(canvas.save).not.toHaveBeenCalled()
    }
  )

  test('keeps the authored size and bounds the thumb for a one-pixel-tall node', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('SWITCH', graph.getPages()[0].id, { width: 2, height: 1 })
    const canvas = createMockCanvas()
    const renderer = createMockRenderer()

    renderSwitchContent(renderer, asCanvas(canvas), node, graph)

    expect(renderer.ck.LTRBRect).toHaveBeenCalledWith(0, 0, 2, 1)
    expect(mockCalls(canvas.drawCircle)[0]?.[0]).toBeCloseTo(0.5)
    expect(mockCalls(canvas.drawCircle)[0]?.[1]).toBeCloseTo(0.5)
    expect(mockCalls(canvas.drawCircle)[0]?.[2]).toBeCloseTo(0.4)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
  })

  test('restores disabled compositing state even if shape rendering fails', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('SWITCH', graph.getPages()[0].id, {
      interactiveProps: { disabled: true }
    })
    const canvas = createMockCanvas()
    const renderer = createMockRenderer()

    expect(() =>
      withSwitchSurface(renderer, asCanvas(canvas), node, graph, () => {
        throw new Error('render failure')
      })
    ).toThrow('render failure')

    expect(canvas.restore).toHaveBeenCalledTimes(1)
    expect(renderer.opacityPaint.setAlphaf).toHaveBeenLastCalledWith(1)
  })
})
