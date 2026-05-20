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
 * Phase 1 §1: CANVAS-direct children are emitted as `position: absolute` with
 * `left/top` derived from SceneNode (x, y). Inner subtrees (any depth beyond
 * the page→direct-child boundary) keep their Flex/Grid/flow behaviour.
 */
describe('Tailwind JSX export — canvas-direct absolute positioning (Phase 1 §1)', () => {
  test('canvas-direct child gets absolute + left/top', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      name: 'Box',
      x: 120,
      y: 80,
      width: 100,
      height: 48
    })
    const jsx = tw(graph, node.id)
    expect(jsx).toContain('absolute')
    expect(jsx).toContain('left-30')
    expect(jsx).toContain('top-20')
    expect(jsx).toContain('w-25')
    expect(jsx).toContain('h-12')
  })

  test('canvas-direct child with arbitrary x/y uses bracket classes', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      x: 121,
      y: 83,
      width: 100,
      height: 50
    })
    const jsx = tw(graph, node.id)
    expect(jsx).toContain('absolute')
    expect(jsx).toContain('left-[121px]')
    expect(jsx).toContain('top-[83px]')
  })

  test('canvas-direct child at origin still gets absolute + left-0/top-0', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      width: 50,
      height: 50
    })
    const jsx = tw(graph, node.id)
    expect(jsx).toContain('absolute')
    expect(jsx).toContain('left-0')
    expect(jsx).toContain('top-0')
  })

  test('canvas-direct AutoLayout frame is absolute; its flex children are not', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      name: 'Row',
      x: 40,
      y: 60,
      width: 400,
      height: 100,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 16,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    const child = graph.createNode('RECTANGLE', frame.id, {
      name: 'Inner',
      width: 80,
      height: 80
    })

    const frameJsx = tw(graph, frame.id)
    expect(frameJsx).toContain('absolute')
    expect(frameJsx).toContain('left-10')
    expect(frameJsx).toContain('top-15')
    expect(frameJsx).toContain('flex ')

    const childJsx = tw(graph, child.id)
    expect(childJsx).not.toContain('absolute')
    expect(childJsx).not.toMatch(/\bleft-/)
    expect(childJsx).not.toMatch(/\btop-/)
  })

  test('canvas-direct HUG-sized child still gets explicit width/height fallback', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      name: 'Hug',
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG'
    })
    const jsx = tw(graph, frame.id)
    expect(jsx).toContain('absolute')
    expect(jsx).toContain('w-50')
    expect(jsx).toContain('h-20')
  })

  test('nested non-canvas frame is not absolute even at depth', () => {
    const graph = makeGraph()
    const outer = graph.createNode('FRAME', pageId(graph), {
      name: 'Outer',
      width: 400,
      height: 200,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    const middle = graph.createNode('FRAME', outer.id, {
      name: 'Middle',
      width: 100,
      height: 100
    })
    const inner = graph.createNode('RECTANGLE', middle.id, {
      name: 'Inner',
      width: 50,
      height: 50
    })
    const middleJsx = tw(graph, middle.id)
    expect(middleJsx).not.toContain('absolute')
    const innerJsx = tw(graph, inner.id)
    expect(innerJsx).not.toContain('absolute')
  })

  test('canvas-direct child preserves rotation transform alongside left/top', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      x: 40,
      y: 80,
      width: 60,
      height: 60,
      rotation: 45
    })
    const jsx = tw(graph, node.id)
    expect(jsx).toContain('absolute')
    expect(jsx).toContain('left-10')
    expect(jsx).toContain('top-20')
    expect(jsx).toContain('rotate-45')
  })
})
