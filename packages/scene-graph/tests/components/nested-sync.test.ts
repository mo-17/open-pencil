import { expect, test } from 'bun:test'

import {
  SceneGraph,
  recordInstanceOverride,
  deleteInstanceOverride
} from '@open-pencil/scene-graph'

test('outer sync preserves a nested edit without blocking sibling or other-field inheritance', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const inner = graph.createNode('COMPONENT', page.id)
  graph.createNode('TEXT', inner.id, { text: 'Default', opacity: 1 })
  const outer = graph.createNode('COMPONENT', page.id)
  const nestedSource = graph.createInstance(inner.id, outer.id)
  const first = graph.createInstance(outer.id, page.id)
  const second = graph.createInstance(outer.id, page.id)
  if (!nestedSource || !first || !second) throw new Error('Missing instances')
  const firstNested = graph.getChildren(first.id)[0]
  const firstText = graph.getChildren(firstNested.id)[0]
  const secondText = graph.getChildren(graph.getChildren(second.id)[0].id)[0]
  const sourceText = graph.getChildren(nestedSource.id)[0]
  graph.updateNode(firstText.id, { text: 'Local edit' })
  recordInstanceOverride(graph, firstText.id, ['text'])
  graph.updateNode(sourceText.id, { text: 'Component edit', opacity: 0.5 })
  graph.syncInstances(outer.id)
  expect(firstText.text).toBe('Local edit')
  expect(firstText.opacity).toBe(0.5)
  expect(secondText.text).toBe('Component edit')
  expect(graph.getChildren(firstNested.id)).toHaveLength(1)

  deleteInstanceOverride(firstNested.instanceOverrides, firstNested.id, firstText.id, 'text')
  graph.syncInstances(outer.id)
  expect(firstText.text).toBe('Component edit')
})

test('nested component reorders keep copies under their actual parent and publish the move', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const component = graph.createNode('COMPONENT', page.id)
  const frame = graph.createNode('FRAME', component.id)
  graph.createNode('RECTANGLE', frame.id, { name: 'First' })
  const second = graph.createNode('RECTANGLE', frame.id, { name: 'Second' })
  const instance = graph.createInstance(component.id, page.id)
  if (!instance) throw new Error('Missing instance')
  const copyFrame = graph.getChildren(instance.id)[0]
  const [copyFirst, copySecond] = graph.getChildren(copyFrame.id)
  graph.insertChildAt(second.id, frame.id, 0)
  const moves: Array<{
    id: string
    parentId: string
    index: number
    previousParentId: string | null
  }> = []
  const stop = graph.onNodeEvents({
    reordered: (id, parentId, index, previousParentId) =>
      moves.push({ id, parentId, index, previousParentId })
  })
  graph.syncInstance(instance.id)
  stop()
  expect(instance.childIds).toEqual([copyFrame.id])
  expect(copyFrame.childIds).toEqual([copySecond.id, copyFirst.id])
  expect(copyFirst.parentId).toBe(copyFrame.id)
  expect(copySecond.parentId).toBe(copyFrame.id)
  expect(moves).toEqual([
    { id: copySecond.id, parentId: copyFrame.id, index: 0, previousParentId: copyFrame.id }
  ])
})
