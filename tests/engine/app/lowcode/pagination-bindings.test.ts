import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  paginationBindingFromSelection,
  paginationBindingOptions,
  paginationBindingSelection
} from '@/app/lowcode/value-controls/pagination-bindings'

test('pagination writes only numeric mutable state while read bindings include computed numbers', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      { id: 'page', name: 'page', type: 'number', defaultValue: 1 },
      { id: 'count', name: 'count', type: 'number', defaultValue: 10, computedExpr: '5 + 5' },
      { id: 'text', name: 'text', type: 'string', defaultValue: '1' }
    ]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'doc-page', name: 'docPage', type: 'number', defaultValue: 1 },
      { id: 'doc-text', name: 'docText', type: 'string', defaultValue: '1' }
    ]
  })
  const node = graph.createNode('FRAME', page.id)
  const writable = paginationBindingOptions(graph, node, page.id, 'currentPage')
  expect(writable.map((option) => option.value)).toEqual(['state:page', 'doc:docPage'])
  const readable = paginationBindingOptions(graph, node, page.id, 'total')
  expect(readable.map((option) => option.value)).toEqual([
    'state:page',
    'state:count',
    'doc:docPage'
  ])
  expect(paginationBindingFromSelection('state:count', 'currentPage', writable)).toBeNull()
  expect(paginationBindingFromSelection('expression', 'currentPage', writable)).toBeNull()
  expect(paginationBindingFromSelection('expression', 'total', readable)).toEqual({
    kind: 'expr',
    expr: ''
  })
  expect(paginationBindingFromSelection('doc:docPage', 'currentPage', writable)).toEqual({
    kind: 'docState',
    docStateName: 'docPage'
  })
  expect(
    paginationBindingSelection({ kind: 'ref', stateId: 'count' }, 'currentPage', writable)
  ).toBe('invalid')
  expect(paginationBindingSelection({ kind: 'expr', expr: 'count' }, 'total', readable)).toBe(
    'expression'
  )
  expect(
    paginationBindingSelection({ kind: 'ref', stateId: 'missing' }, 'currentPage', writable)
  ).toBe('invalid')
  expect(
    paginationBindingSelection({ kind: 'ref', stateId: 'text' }, 'currentPage', writable)
  ).toBe('invalid')
  const component = graph.createNode('COMPONENT', page.id)
  const nested = graph.createNode('FRAME', component.id)
  expect(paginationBindingOptions(graph, nested, page.id, 'currentPage')).toEqual([
    { value: 'doc:docPage', name: 'docPage', scope: 'document' }
  ])
})
