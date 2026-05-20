import { describe, expect, test } from 'bun:test'

import { SceneGraph, sceneNodeToJSX } from '@open-pencil/core'

import { BLACK } from '#core/constants'

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
 * Vector shapes that are not ELLIPSE: LINE / POLYGON / STAR. Figma stores
 * them geometrically — the compiled <div> needs CSS clip-path (polygons)
 * or stroke-as-background (lines) to look like the source. Otherwise they
 * all render as rectangles in the iframe.
 */
describe('Tailwind JSX export — LINE / POLYGON / STAR', () => {
  test('LINE renders as a horizontal bar (stroke → background + height)', () => {
    const graph = makeGraph()
    const node = graph.createNode('LINE', pageId(graph), {
      width: 200,
      height: 0,
      strokes: [{ color: BLACK, weight: 4, align: 'CENTER', opacity: 1, visible: true }]
    })
    const jsx = tw(graph, node.id)
    // height should follow the stroke weight, not the source node.height.
    expect(jsx).toContain('h-1')
    // stroke colour reaches background, not border (so it actually shows).
    expect(jsx).toMatch(/bg-(?:black|\[.*\])/)
    expect(jsx).not.toContain('border')
  })

  test('LINE without a stroke does not invent a height', () => {
    const graph = makeGraph()
    const node = graph.createNode('LINE', pageId(graph), { width: 100, height: 0 })
    // No stroke → no background, no fabricated height — render is empty.
    const jsx = tw(graph, node.id)
    expect(jsx).not.toContain('h-1')
    expect(jsx).not.toContain('bg-')
  })

  test('POLYGON emits clip-path-[polygon(...)] sized to the bounding box', () => {
    const graph = makeGraph()
    const node = graph.createNode('POLYGON', pageId(graph), {
      width: 100,
      height: 100,
      pointCount: 3
    })
    const jsx = tw(graph, node.id)
    expect(jsx).toMatch(/clip-path-\[polygon\(/)
    // Top vertex at (50%, 0%); twirl underscores spaces.
    expect(jsx).toContain('50%_0%')
    // Border is suppressed — a polygon-clipped border reads as a thick fill,
    // not an outline.
    const strokeNode = graph.createNode('POLYGON', pageId(graph), {
      width: 80,
      height: 80,
      pointCount: 5,
      strokes: [{ color: BLACK, weight: 2, align: 'CENTER', opacity: 1, visible: true }]
    })
    expect(tw(graph, strokeNode.id)).not.toContain('border')
  })

  test('STAR emits a 10-point polygon clip-path with alternating radii', () => {
    const graph = makeGraph()
    const node = graph.createNode('STAR', pageId(graph), {
      width: 100,
      height: 100,
      pointCount: 5,
      starInnerRadius: 0.5
    })
    const jsx = tw(graph, node.id)
    expect(jsx).toMatch(/clip-path-\[polygon\(/)
    // 5-point star → 10 vertices → 9 commas inside the polygon(...)
    const match = /polygon\(([^)]+)\)/.exec(jsx)
    expect(match).not.toBeNull()
    if (match) {
      const commaCount = match[1].split(',').length
      expect(commaCount).toBe(10)
    }
  })

  test('POLYGON with default pointCount=5 (scene-graph default) still emits a polygon', () => {
    const graph = makeGraph()
    const node = graph.createNode('POLYGON', pageId(graph), { width: 60, height: 60 })
    expect(tw(graph, node.id)).toMatch(/clip-path-\[polygon\(/)
  })
})
