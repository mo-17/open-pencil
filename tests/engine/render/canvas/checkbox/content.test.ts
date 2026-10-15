import { expect, mock, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { checkboxDesignContent } from '#core/canvas/checkbox/state'
import { renderShapeUncached } from '#core/canvas/scene'
import { collectGraphFontRequirements } from '#core/text/requirements'

import { asCanvas } from '#tests/engine/render/canvas/helpers'

import { createMockCanvas, createMockRenderer, mockCalls } from '../effects/helpers'

test('CHECKBOX draws a checked mark and grouped option labels through the ordinary renderer', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const node = graph.createNode('CHECKBOX', page.id, { interactiveProps: { checked: true } })
  const canvas = createMockCanvas()
  const renderer = createMockRenderer({ renderEffects: mock(() => undefined) })
  renderShapeUncached(renderer, asCanvas(canvas), node, graph)
  expect(canvas.drawLine).toHaveBeenCalledTimes(2)
  graph.updateNode(node.id, {
    width: 220,
    height: 88,
    interactiveProps: { options: ['个人', '团队'] }
  })
  renderShapeUncached(renderer, asCanvas(canvas), node, graph)
  expect(
    mockCalls(renderer.renderText as ReturnType<typeof mock>).map((call) => call[1])
  ).toMatchObject([{ text: '个人' }, { text: '团队' }])
  expect(collectGraphFontRequirements(graph, [node.id]).scripts).toContain('cjk-sc')
})

test('CHECKBOX resolves boolean and string-array defaults without evaluating expressions or inheriting component page state', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      { id: 'enabled', name: 'enabled', type: 'boolean', defaultValue: false },
      { id: 'plans', name: 'plans', type: 'array', defaultValue: ['团队'] },
      { id: 'computed', name: 'computed', type: 'boolean', defaultValue: true, computedExpr: '' }
    ]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [{ id: 'doc', name: 'doc', type: 'array', defaultValue: ['个人'] }]
  })
  const node = graph.createNode('CHECKBOX', page.id, {
    interactiveProps: { checked: true },
    bindings: { value: { kind: 'ref', stateId: 'enabled' } }
  })
  expect(checkboxDesignContent(graph, node).checked).toBe(false)
  graph.updateNode(node.id, {
    interactiveProps: { options: ['个人', '团队'], checked: true },
    bindings: { value: { kind: 'ref', stateId: 'plans' } }
  })
  expect([...checkboxDesignContent(graph, node).selected]).toEqual(['团队'])
  graph.updateNode(node.id, { bindings: { value: { kind: 'docState', docStateName: 'doc' } } })
  expect([...checkboxDesignContent(graph, node).selected]).toEqual(['个人'])
  for (const stateId of ['missing', 'computed']) {
    graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId } } })
    expect(checkboxDesignContent(graph, node).checked).toBe(false)
    expect([...checkboxDesignContent(graph, node).selected]).toEqual([])
  }
  const component = graph.createNode('COMPONENT', page.id)
  graph.reparentNode(node.id, component.id)
  graph.updateNode(node.id, { bindings: { value: { kind: 'ref', stateId: 'plans' } } })
  expect([...checkboxDesignContent(graph, node).selected]).toEqual([])
})

test('CHECKBOX projects safe dynamic option labels and keeps unresolved sources empty', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      {
        id: 'options',
        name: 'options',
        type: 'array',
        defaultValue: [{ key: 'team', title: '中文团队' }]
      }
    ]
  })
  const node = graph.createNode('CHECKBOX', page.id, {
    interactiveProps: {
      options: ['Stale option'],
      optionsSource: {
        kind: 'ref',
        stateId: 'options',
        valueExpr: 'item.key',
        labelExpr: 'item.title'
      }
    }
  })
  const before = structuredClone(node)
  expect(checkboxDesignContent(graph, node).options).toEqual([{ value: 'team', label: '中文团队' }])
  expect(collectGraphFontRequirements(graph, [node.id]).characters).toContain('中')
  expect(node).toEqual(before)
  graph.updateNode(node.id, {
    interactiveProps: {
      ...node.interactiveProps,
      optionsSource: { kind: 'ref', stateId: 'missing' }
    }
  })
  expect(checkboxDesignContent(graph, node).options).toEqual([])
})

test('CHECKBOX uses bounded geometry, authored label color and disabled opacity', () => {
  const graph = new SceneGraph()
  const node = graph.createNode('CHECKBOX', graph.getPages()[0].id, {
    width: 80,
    height: 44,
    paddingLeft: 4,
    paddingRight: 4,
    interactiveProps: { options: ['Label'], disabled: true, textColor: '#336699' }
  })
  const renderer = createMockRenderer({ renderEffects: mock(() => undefined) })
  const canvas = createMockCanvas()
  renderShapeUncached(renderer, asCanvas(canvas), node, graph)
  expect(renderer.color4f).toHaveBeenCalledWith(0.2, 0.4, 0.6, 0.45)
  expect(canvas.clipRect).toHaveBeenCalledWith(new Float32Array([0, 0, 72, 44]), 0, true)
  graph.updateNode(node.id, { width: 4 })
  const smallCanvas = createMockCanvas()
  renderShapeUncached(renderer, asCanvas(smallCanvas), node, graph)
  expect(smallCanvas.drawLine).not.toHaveBeenCalled()
  expect(smallCanvas.drawRRect).not.toHaveBeenCalled()
})

test('a null options source preserves static CHECKBOX options while a configured invalid source stays unresolved', () => {
  const graph = new SceneGraph()
  const node = graph.createNode('CHECKBOX', graph.getPages()[0].id, {
    interactiveProps: { options: ['团队'], optionsSource: null }
  })
  expect(checkboxDesignContent(graph, node).options).toEqual([{ value: '团队', label: '团队' }])
  graph.updateNode(node.id, { interactiveProps: { options: ['团队'], optionsSource: {} } })
  expect(checkboxDesignContent(graph, node).options).toEqual([])
})

test('CHECKBOX balances nested clips and translations when drawing a selected mark fails', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [{ id: 'plans', name: 'plans', type: 'array', defaultValue: ['团队'] }]
  })
  const node = graph.createNode('CHECKBOX', page.id, {
    width: 120,
    height: 44,
    interactiveProps: { options: ['团队'] },
    bindings: { value: { kind: 'ref', stateId: 'plans' } }
  })
  const canvas = createMockCanvas()
  canvas.drawLine.mockImplementation(() => {
    throw new Error('paint failed')
  })
  const renderer = createMockRenderer({ renderEffects: mock(() => undefined) })
  expect(() => renderShapeUncached(renderer, asCanvas(canvas), node, graph)).toThrow('paint failed')
  expect(canvas.restore).toHaveBeenCalledTimes(canvas.save.mock.calls.length)
})
