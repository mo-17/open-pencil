import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  moduleBindingFromSelection,
  moduleBindingSelection
} from '@/app/lowcode/value-controls/form/fields'
import { writableStateBindingOptions } from '@/app/lowcode/value-controls/state-bindings'

test('Stepper choices reject computed, duplicate and component page state while retaining writable document state', () => {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      { id: 'step', name: 'step', type: 'number', defaultValue: 1 },
      { id: 'derived', name: 'derived', type: 'number', defaultValue: 0, computedExpr: 'step + 1' },
      { id: 'text', name: 'text', type: 'string', defaultValue: '1' },
      { id: 'a', name: 'ambiguous', type: 'number', defaultValue: 0 },
      { id: 'b', name: 'ambiguous', type: 'number', defaultValue: 2 }
    ]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [{ id: 'doc', name: 'doc', type: 'number', defaultValue: 2 }]
  })
  const node = graph.createNode('FRAME', page.id)
  const options = writableStateBindingOptions(graph, node, page.id, 'number', 'Page', 'Document')
  expect(options).toEqual([
    { value: 'state:step', label: 'Page: step' },
    { value: 'doc:doc', label: 'Document: doc' }
  ])
  expect(moduleBindingFromSelection('state:derived', options)).toBeNull()
  expect(moduleBindingSelection({ kind: 'ref', stateId: 'a' }, options)).toBe('invalid')
  expect(moduleBindingFromSelection('doc:doc', options)).toEqual({
    kind: 'docState',
    docStateName: 'doc'
  })
  const master = graph.createNode('COMPONENT', page.id)
  graph.reparentNode(node.id, master.id)
  expect(writableStateBindingOptions(graph, node, page.id, 'number', 'Page', 'Document')).toEqual([
    { value: 'doc:doc', label: 'Document: doc' }
  ])
  const instance = graph.createNode('INSTANCE', page.id)
  graph.reparentNode(node.id, instance.id)
  expect(
    writableStateBindingOptions(graph, node, page.id, 'number', 'Page', 'Document', {
      rejectInstancePageState: true
    })
  ).toEqual([{ value: 'doc:doc', label: 'Document: doc' }])
  // Existing module fields retain their prior instance binding contract.
  expect(writableStateBindingOptions(graph, node, page.id, 'number', 'Page', 'Document')).toEqual(
    options
  )
})
