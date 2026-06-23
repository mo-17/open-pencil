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

  test('computed state resolves read-context refs and topologically orders computed deps', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'cartCount', type: 'number', defaultValue: 1 }]
    })
    const page = graph.getNode(pageId)
    if (!page) throw new Error('no page')
    page.state = [
      { id: 's1', name: 'count', type: 'number', defaultValue: 2 },
      {
        id: 's3',
        name: 'summary',
        type: 'number',
        defaultValue: 0,
        computedExpr: 'doubleCount + cartCount + $query.bonus'
      },
      {
        id: 's2',
        name: 'doubleCount',
        type: 'number',
        defaultValue: 0,
        computedExpr: 'count * 2'
      }
    ]

    const ir = collectTree(graph, pageId)
    expect(ir.states.map((s) => s.name)).toEqual(['count', 'doubleCount', 'summary'])
    expect(ir.states[1].computed?.references).toEqual(['count'])
    expect(ir.states[2].computed?.references).toEqual(['doubleCount', 'cartCount', '$query'])
    expect(ir.docStateReads).toEqual(['cartCount'])
    expect(ir.usesQueryParams).toBe(true)
    expect(ir.warnings).toEqual([])
  })

  test('invalid computed state remains read-only fallback and keeps later collection safe', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const page = graph.getNode(pageId)
    if (!page) throw new Error('no page')
    page.state = [
      { id: 's1', name: 'a', type: 'number', defaultValue: 1, computedExpr: 'b + 1' },
      { id: 's2', name: 'b', type: 'number', defaultValue: 2, computedExpr: 'a + 1' },
      { id: 's3', name: 'missing', type: 'number', defaultValue: 3, computedExpr: 'nope + 1' }
    ]

    const ir = collectTree(graph, pageId)
    expect(ir.states.map((s) => [s.name, s.computedInvalid === true])).toEqual([
      ['a', true],
      ['b', true],
      ['missing', true]
    ])
    expect(ir.warnings.map((w) => w.code)).toContain('computed-state-cycle')
    expect(ir.warnings.map((w) => w.code)).toContain('computed-state-unknown')
  })

  test('computed state rejects prev refs and empty expressions as fallbacks', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const page = graph.getNode(pageId)
    if (!page) throw new Error('no page')
    page.state = [
      { id: 's1', name: 'count', type: 'number', defaultValue: 1 },
      {
        id: 's2',
        name: 'previous',
        type: 'number',
        defaultValue: 2,
        computedExpr: '$prev + count'
      },
      { id: 's3', name: 'blank', type: 'string', defaultValue: 'fallback', computedExpr: '   ' }
    ]

    const ir = collectTree(graph, pageId)
    expect(ir.states.map((s) => [s.name, s.computedInvalid === true])).toEqual([
      ['count', false],
      ['previous', true],
      ['blank', true]
    ])
    expect(ir.states.find((s) => s.name === 'previous')?.computed).toBeUndefined()
    expect(ir.states.find((s) => s.name === 'blank')?.computed).toBeUndefined()
    expect(ir.warnings.map((w) => w.code)).toContain('computed-state-prev')
    expect(ir.warnings.map((w) => w.code)).toContain('computed-state-empty')
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
