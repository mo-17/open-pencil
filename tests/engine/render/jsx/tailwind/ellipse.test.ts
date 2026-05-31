import { describe, expect, test } from 'bun:test'

import { SceneGraph, sceneNodeToJSX } from '@open-pencil/core'

function makeGraph() {
  const graph = new SceneGraph()
  graph.createNode('CANVAS', graph.rootId, { name: 'Page 1' })
  return graph
}

function pageId(graph: SceneGraph) {
  return graph.getPages()[0].id
}

function tw(graph: SceneGraph, nodeId: string) {
  return sceneNodeToJSX(nodeId, graph, 'tailwind')
}

/**
 * ELLIPSE in Figma is geometrically round — there is no border-radius the
 * user can set. The compiled <div> needs `border-radius: 50%` (Tailwind
 * `rounded-[50%]`) so width≠height nodes render as true ellipses rather
 * than the `9999px` pill that `rounded-full` would produce.
 */
describe('Tailwind JSX export — ELLIPSE', () => {
  test('emits rounded-[50%] for a circle', () => {
    const graph = makeGraph()
    const node = graph.createNode('ELLIPSE', pageId(graph), { width: 80, height: 80 })
    expect(tw(graph, node.id)).toContain('rounded-[50%]')
  })

  test('emits rounded-[50%] for a wide ellipse (not a pill)', () => {
    const graph = makeGraph()
    const node = graph.createNode('ELLIPSE', pageId(graph), { width: 100, height: 40 })
    const jsx = tw(graph, node.id)
    expect(jsx).toContain('rounded-[50%]')
    expect(jsx).not.toContain('rounded-full')
  })

  test('cornerRadius on ELLIPSE is overridden — ours wins', () => {
    const graph = makeGraph()
    const node = graph.createNode('ELLIPSE', pageId(graph), {
      width: 60,
      height: 60,
      cornerRadius: 20
    })
    const jsx = tw(graph, node.id)
    expect(jsx).toContain('rounded-[50%]')
    expect(jsx).not.toContain('rounded-[20px]')
  })

  test('RECTANGLE with default cornerRadius=0 emits no rounded class (unchanged)', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), { width: 80, height: 80 })
    expect(tw(graph, node.id)).not.toContain('rounded')
  })
})
