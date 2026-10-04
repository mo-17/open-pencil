import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { moduleDataBindingCopy } from '@/app/lowcode/value-controls/data/copy'
import {
  readableStateBindingOptions,
  writableStateBindingOptions
} from '@/app/lowcode/value-controls/state-bindings'

test('readonly data choices expose unique computed data without write or reusable page authority', () => {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      { id: 'rows', name: 'rows', type: 'array', defaultValue: [] },
      { id: 'derived', name: 'derived', type: 'array', defaultValue: [], computedExpr: 'rows' },
      { id: 'object', name: 'chart', type: 'object', defaultValue: {} },
      { id: 'dupe1', name: 'duplicate', type: 'array', defaultValue: [] },
      { id: 'dupe2', name: 'duplicate', type: 'array', defaultValue: [] }
    ]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'doc', name: 'document', type: 'array', defaultValue: [], computedExpr: '[]' }
    ]
  })
  const node = graph.createNode('FRAME', page.id)
  const read = () => readableStateBindingOptions(graph, node, page.id, 'array', 'Page', 'Document')
  expect(read().map((o) => o.value)).toEqual(['state:rows', 'state:derived'])
  expect(
    writableStateBindingOptions(graph, node, page.id, 'array', 'Page', 'Document').map(
      (o) => o.value
    )
  ).toEqual(['state:rows'])
  for (const type of ['COMPONENT', 'INSTANCE'] as const) {
    const parent = graph.createNode(type, page.id)
    graph.reparentNode(node.id, parent.id)
    expect(read().map((o) => o.value)).toEqual([])
  }
})

test('data binding copy describes readonly data and fallback mode accurately', () => {
  expect(moduleDataBindingCopy('zh-CN').configured).toBe('配置数据')
  expect(moduleDataBindingCopy('en').configured).toBe('Configured data')
  expect(moduleDataBindingCopy('fr').rowsHint).toContain('Bound CSV import is disabled')
})

for (const cycle of ['self', 'pair'] as const)
  test(`data choices safely reject ${cycle} ancestry cycles`, () => {
    const graph = new SceneGraph(),
      page = graph.getPages()[0],
      node = graph.createNode('FRAME', page.id)
    graph.updateNode(page.id, {
      state: [{ id: 'rows', name: 'rows', type: 'array', defaultValue: [] }]
    })
    if (cycle === 'self') graph.updateNode(node.id, { parentId: node.id })
    else {
      const parent = graph.createNode('FRAME', page.id)
      graph.updateNode(node.id, { parentId: parent.id })
      graph.updateNode(parent.id, { parentId: node.id })
    }
    expect(readableStateBindingOptions(graph, node, page.id, 'array', 'Page', 'Document')).toEqual(
      []
    )
  })
