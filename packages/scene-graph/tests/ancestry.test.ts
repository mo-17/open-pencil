import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

describe('SceneGraph ancestry', () => {
  test('finds the owning page for pages and descendants', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id)
    const text = graph.createNode('TEXT', frame.id)

    expect(graph.getPageId(page.id)).toBe(page.id)
    expect(graph.getPageId(frame.id)).toBe(page.id)
    expect(graph.getPageId(text.id)).toBe(page.id)
    expect(graph.getPageId(graph.rootId)).toBeUndefined()
    expect(graph.getPageId('missing')).toBeUndefined()
  })

  test('stops safely when imported parent metadata contains a cycle', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id)
    const child = graph.createNode('FRAME', frame.id)
    frame.parentId = child.id

    expect(graph.getPageId(frame.id)).toBeUndefined()
  })
})
