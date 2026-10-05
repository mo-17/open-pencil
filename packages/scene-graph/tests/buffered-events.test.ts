import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

test('buffered hydration retains its event tag but authored listener mutations have no trusted origin', () => {
  const graph = new SceneGraph()
  const node = graph.createNode('RECTANGLE', graph.getPages()[0].id)
  const origins: Array<string | undefined> = []
  graph.onNodeEvents({
    updated: (_id, changes, origin) => {
      origins.push(origin)
      if (changes.width === 20) graph.updateNode(node.id, { height: 30 })
    }
  })
  graph.withNodeMutationOrigin('source-hydration', () => {
    graph.withBufferedEvents(() => graph.updateNode(node.id, { width: 20 }))
    graph.updateNode(node.id, { opacity: 0.5 })
  })
  expect(origins).toEqual(['source-hydration', undefined, 'source-hydration'])
})

test('nested event buffers publish in order only after the outer action commits', () => {
  const graph = new SceneGraph()
  const events: string[] = []
  graph.onNodeEvents({ created: (node) => events.push(node.name) })
  const page = graph.getPages()[0]
  graph.withBufferedEvents(() => {
    graph.createNode('RECTANGLE', page.id, { name: 'First' })
    graph.withBufferedEvents(() => graph.createNode('RECTANGLE', page.id, { name: 'Second' }))
    expect(events).toEqual([])
  })
  expect(events).toEqual(['First', 'Second'])
  expect(() =>
    graph.withBufferedEvents(() => {
      graph.withBufferedEvents(() =>
        graph.createNode('RECTANGLE', page.id, { name: 'Discarded event' })
      )
      throw new Error('Fail')
    })
  ).toThrow('Fail')
  expect(events).toEqual(['First', 'Second'])
})

test('observer failure does not prevent later queued events or poison the emitter', () => {
  const graph = new SceneGraph()
  const names: string[] = []
  const off = graph.onNodeEvents({
    created: (node) => {
      names.push(node.name)
      if (node.name === 'First') throw new Error('Observer failed')
    }
  })
  const page = graph.getPages()[0]
  expect(() =>
    graph.withBufferedEvents(() => {
      graph.createNode('RECTANGLE', page.id, { name: 'First' })
      graph.createNode('RECTANGLE', page.id, { name: 'Second' })
    })
  ).toThrow('Committed graph event delivery failed')
  expect(names).toEqual(['First', 'Second'])
  expect(graph.getChildren(page.id)).toHaveLength(2)
  off()
  graph.withBufferedEvents(() => graph.createNode('RECTANGLE', page.id))
  expect(graph.getChildren(page.id)).toHaveLength(3)
})
