import { describe, expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { radioDesignValue, renderRadioContent } from '#core/canvas/radio'
import { RenderChunkIndex } from '#core/canvas/renderer/chunks'
import { renderShapeUncached } from '#core/canvas/scene'

import { createMockCanvas, createMockRenderer, mockCalls } from './effects/helpers'

describe('RADIO canvas content', () => {
  test('draws option labels and one selected indicator inside the authored bounds', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const node = graph.createNode('RADIO', page.id, {
      width: 320,
      height: 88,
      fontSize: 14,
      interactiveProps: { options: ['个人', '团队'], value: '团队' }
    })
    const canvas = createMockCanvas()
    const renderer = createMockRenderer({ renderEffects: mock(() => undefined) })

    renderShapeUncached(renderer, canvas as Canvas, node, graph)

    expect(
      mockCalls(renderer.renderText as ReturnType<typeof mock>).map((call) => call[1])
    ).toMatchObject([
      { type: 'TEXT', text: '个人' },
      { type: 'TEXT', text: '团队' }
    ])
    expect(canvas.drawCircle).toHaveBeenCalledTimes(3)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    expect(node.childIds).toEqual([])
    expect(node.type).toBe('RADIO')
  })

  test('resolves writable string page/document defaults and keeps invalid bindings uncontrolled', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [
        { id: 'plan', name: 'plan', type: 'string', defaultValue: '团队' },
        {
          id: 'derived',
          name: 'derived',
          type: 'string',
          defaultValue: '团队',
          computedExpr: 'plan'
        },
        {
          id: 'empty-computed',
          name: 'emptyComputed',
          type: 'string',
          defaultValue: '团队',
          computedExpr: ''
        },
        { id: 'numeric', name: 'numeric', type: 'number', defaultValue: 2 }
      ]
    })
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'doc-plan', name: 'plan', type: 'string', defaultValue: '团队' }]
    })
    const node = graph.createNode('RADIO', page.id, {
      interactiveProps: { options: ['个人', '团队'], value: '个人' }
    })
    const valueWith = (bindings: SceneNode['bindings']) =>
      radioDesignValue(graph, { ...node, bindings })

    expect(valueWith({ value: { kind: 'ref', stateId: 'plan' } })).toBe('团队')
    expect(valueWith({ value: { kind: 'docState', docStateName: 'plan' } })).toBe('团队')
    for (const stateId of ['derived', 'empty-computed', 'numeric', 'missing']) {
      expect(valueWith({ value: { kind: 'ref', stateId } })).toBe('个人')
    }
    expect(valueWith({ value: { kind: 'literal', literalValue: '团队' } })).toBe('个人')
    expect(valueWith({ value: { kind: 'expr', expr: 'plan' } })).toBe('个人')
    expect(node.bindings).toBeUndefined()
  })

  test('does not show a blank draft option as selected or inherit page state inside a component', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 'plan', name: 'plan', type: 'string', defaultValue: '团队' }]
    })
    const component = graph.createNode('COMPONENT', page.id)
    const node = graph.createNode('RADIO', component.id, {
      interactiveProps: { options: [''], value: '' },
      bindings: { value: { kind: 'ref', stateId: 'plan' } }
    })
    const canvas = createMockCanvas()
    const renderer = createMockRenderer()

    renderRadioContent(renderer, canvas as Canvas, node, graph)

    expect(radioDesignValue(graph, node)).toBe('')
    expect(canvas.drawCircle).toHaveBeenCalledTimes(1)
  })

  test('uses the containing page after a move and indexes bound state as a render-chunk dependency', () => {
    const graph = new SceneGraph()
    const first = graph.getPages()[0]
    const second = graph.addPage('Second')
    graph.updateNode(first.id, {
      state: [{ id: 'plan', name: 'plan', type: 'string', defaultValue: '个人' }]
    })
    graph.updateNode(second.id, {
      state: [{ id: 'plan', name: 'plan', type: 'string', defaultValue: '团队' }]
    })
    const node = graph.createNode('RADIO', first.id, {
      interactiveProps: { options: ['个人', '团队'], value: '' },
      bindings: { value: { kind: 'ref', stateId: 'plan' } }
    })

    expect(radioDesignValue(graph, node)).toBe('个人')
    graph.reparentNode(node.id, second.id)
    expect(radioDesignValue(graph, node)).toBe('团队')
    const { index } = RenderChunkIndex.build(graph, second.id)
    expect(index.getChunksDependingOnNode(second.id).map((chunk) => chunk.nodeId)).toContain(
      node.id
    )
    expect(index.getChunksDependingOnNode(graph.rootId).map((chunk) => chunk.nodeId)).toContain(
      node.id
    )
    index.dispose()
  })

  test('bounds long option lists, drops malformed entries, and dims disabled glyphs', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RADIO', graph.getPages()[0].id, {
      width: 120,
      height: 35,
      paddingTop: 8,
      paddingLeft: 12,
      paddingRight: 10,
      fontSize: 14,
      interactiveProps: {
        options: ['个人', 42, null, '团队', ...Array.from({ length: 1000 }, () => 'other')],
        disabled: true,
        textColor: '#336699'
      }
    })
    const canvas = createMockCanvas()
    const renderer = createMockRenderer()

    renderRadioContent(renderer, canvas as Canvas, node, graph)

    expect(canvas.drawCircle).toHaveBeenCalledTimes(1)
    expect(canvas.translate).toHaveBeenCalledWith(12, 8)
    expect(renderer.renderText).toHaveBeenCalledTimes(1)
    expect(renderer.color4f).toHaveBeenCalledWith(0.2, 0.4, 0.6, 0.45)
    expect(mockCalls(renderer.renderText as ReturnType<typeof mock>)[0]?.[1]).toMatchObject({
      id: node.id,
      text: '个人',
      width: 74,
      textTruncation: 'ENDING',
      maxLines: 1
    })
  })

  test('lays out a horizontal group with measured labels and does not select an unknown default', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RADIO', graph.getPages()[0].id, {
      width: 200,
      height: 44,
      fontSize: 14,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 12,
      interactiveProps: { options: ['个人', '团队'], value: 'missing' }
    })
    const canvas = createMockCanvas()
    const renderer = createMockRenderer({
      measureTextNode: mock(() => ({ width: 28, height: 21 }))
    })

    renderRadioContent(renderer, canvas as Canvas, node, graph)

    expect(canvas.drawCircle).toHaveBeenCalledTimes(2)
    expect(canvas.translate).toHaveBeenCalledWith(64, 0)
  })
})
