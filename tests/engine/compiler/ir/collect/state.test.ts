import { describe, expect, test } from 'bun:test'

import { collectTree } from '@open-pencil/compiler/ir/collect/tree'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

describe('collectTree — page state', () => {
  test('no state on page → empty states array, no warnings', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const ir = collectTree(graph, pageId)
    expect(ir.states).toEqual([])
    expect(ir.warnings).toEqual([])
  })

  test('valid state → hoisted into IR', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const page = graph.getNode(pageId)
    if (!page) throw new Error('no page')
    page.state = [
      { id: 's1', name: 'count', type: 'number', defaultValue: 0 },
      { id: 's2', name: 'flag', type: 'boolean', defaultValue: false }
    ]

    const ir = collectTree(graph, pageId)
    expect(ir.states).toHaveLength(2)
    expect(ir.states[0]).toMatchObject({ id: 's1', name: 'count', type: 'number' })
    expect(ir.states[1]).toMatchObject({ id: 's2', name: 'flag', type: 'boolean' })
    expect(ir.warnings).toEqual([])
  })

  test('invalid identifier → dropped with warning', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const page = graph.getNode(pageId)
    if (!page) throw new Error('no page')
    page.state = [
      { id: 's1', name: '1bad', type: 'number', defaultValue: 0 },
      { id: 's2', name: 'good', type: 'number', defaultValue: 0 }
    ]

    const ir = collectTree(graph, pageId)
    expect(ir.states).toHaveLength(1)
    expect(ir.states[0].name).toBe('good')
    expect(ir.warnings.some((w) => w.code === 'state-invalid')).toBe(true)
  })

  test('duplicate name → second occurrence dropped', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const page = graph.getNode(pageId)
    if (!page) throw new Error('no page')
    page.state = [
      { id: 's1', name: 'count', type: 'number', defaultValue: 0 },
      { id: 's2', name: 'count', type: 'number', defaultValue: 1 }
    ]

    const ir = collectTree(graph, pageId)
    expect(ir.states).toHaveLength(1)
    expect(ir.states[0].id).toBe('s1')
    expect(ir.warnings.some((w) => w.code === 'state-invalid')).toBe(true)
  })
})

describe('collectTree — text bindings', () => {
  test('TEXT bound to state ref → emits IRExpression child', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const page = graph.getNode(pageId)
    if (!page) throw new Error('no page')
    page.state = [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }]
    const text = graph.createNode('TEXT', pageId, { text: 'fallback' })
    text.bindings = { text: { kind: 'ref', stateId: 's1' } }

    const ir = collectTree(graph, pageId)
    const textIR = ir.children[0]
    if (textIR.kind !== 'element') throw new Error('expected element')
    expect(textIR.children).toHaveLength(1)
    const child = textIR.children[0]
    expect(child.kind).toBe('expression')
    if (child.kind !== 'expression') throw new Error('unreachable')
    expect(child.references).toEqual(['count'])
  })

  test('TEXT bound to unknown state → warning + falls back to literal', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const text = graph.createNode('TEXT', pageId, { text: 'fallback' })
    text.bindings = { text: { kind: 'ref', stateId: 'missing' } }

    const ir = collectTree(graph, pageId)
    const textIR = ir.children[0]
    if (textIR.kind !== 'element') throw new Error('expected element')
    expect(textIR.children[0]).toEqual({ kind: 'text', value: 'fallback' })
    expect(ir.warnings.some((w) => w.code === 'binding-unknown-state')).toBe(true)
  })
})

describe('collectTree — events', () => {
  test('BUTTON onClick setState → IR event handler', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const page = graph.getNode(pageId)
    if (!page) throw new Error('no page')
    page.state = [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }]
    const btn = graph.createNode('BUTTON', pageId)
    btn.events = {
      onClick: [{ id: 'a1', kind: 'setState', targetStateId: 's1', valueExpr: 'count + 1' }]
    }

    const ir = collectTree(graph, pageId)
    const btnIR = ir.children[0]
    if (btnIR.kind !== 'element') throw new Error('expected element')
    expect(btnIR.events).toBeDefined()
    const handlers = btnIR.events?.onClick
    expect(handlers).toHaveLength(1)
    expect(handlers?.[0]).toMatchObject({ kind: 'setState', stateName: 'count' })
    expect(handlers?.[0].references).toEqual(['count'])
  })

  test('action with invalid expression → dropped with warning', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const page = graph.getNode(pageId)
    if (!page) throw new Error('no page')
    page.state = [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }]
    const btn = graph.createNode('BUTTON', pageId)
    btn.events = {
      onClick: [{ id: 'a1', kind: 'setState', targetStateId: 's1', valueExpr: 'foo(1)' }]
    }

    const ir = collectTree(graph, pageId)
    const btnIR = ir.children[0]
    if (btnIR.kind !== 'element') throw new Error('expected element')
    expect(btnIR.events).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'action-invalid-expression')).toBe(true)
  })

  test('action targeting unknown state → dropped with warning', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const btn = graph.createNode('BUTTON', pageId)
    btn.events = {
      onClick: [{ id: 'a1', kind: 'setState', targetStateId: 'missing', valueExpr: '1' }]
    }

    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-unknown-state')).toBe(true)
  })
})
