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
  test('horizontal LINE (no stroke) uses fill colour, default 1px height', () => {
    // OpenPencil's default LINE has a BLACK fill, no stroke — the canvas
    // draws it via fillPaint, not strokePaint.
    const graph = makeGraph()
    const node = graph.createNode('LINE', pageId(graph), {
      x: 20,
      y: 100,
      width: 200,
      height: 0,
      fills: [{ type: 'SOLID', color: BLACK, opacity: 1, visible: true }]
    })
    const jsx = tw(graph, node.id)
    expect(jsx).toContain('w-50') // length = 200 → twirl spacing 50
    expect(jsx).toContain('h-px') // 1px hairline default
    expect(jsx).toMatch(/bg-(?:black|\[.*\])/)
    expect(jsx).toContain('origin-left')
    expect(jsx).not.toContain('border')
  })

  test('diagonal LINE rotates by atan2(height, width), pivot at first endpoint', () => {
    // OpenPencil encodes the line angle in the bbox geometry: the line
    // runs from (0, 0) to (width, height) in local coords. The compiled
    // CSS must render a horizontal bar of length sqrt(w²+h²), rotated to
    // point at the second endpoint, pivoting on the first endpoint.
    const graph = makeGraph()
    const node = graph.createNode('LINE', pageId(graph), {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fills: [{ type: 'SOLID', color: BLACK, opacity: 1, visible: true }]
    })
    const jsx = tw(graph, node.id)
    // sqrt(100² + 100²) ≈ 141.42 — not on a spacing tick, so Tailwind
    // falls back to an arbitrary value.
    expect(jsx).toMatch(/w-\[141\.42\d*px\]/)
    // atan2(100, 100) = 45°
    expect(jsx).toContain('rotate-45')
    expect(jsx).toContain('origin-left')
  })

  test('stroke takes precedence over fill when both present', () => {
    const graph = makeGraph()
    const node = graph.createNode('LINE', pageId(graph), {
      x: 0,
      y: 100,
      width: 200,
      height: 0,
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1, visible: true }],
      strokes: [{ color: BLACK, weight: 4, align: 'CENTER', opacity: 1, visible: true }]
    })
    const jsx = tw(graph, node.id)
    // stroke colour wins → black, not the red fill.
    expect(jsx).toMatch(/bg-(?:black|\[#000000\])/)
    // stroke weight 4 → h-1; top lifted by half a stroke (100 - 2 = 98).
    expect(jsx).toContain('h-1')
    expect(jsx).toContain('top-[98px]')
  })

  test('LINE without any colour source is invisible (no fabricated geometry)', () => {
    const graph = makeGraph()
    const node = graph.createNode('LINE', pageId(graph), {
      width: 100,
      height: 0,
      fills: [],
      strokes: []
    })
    const jsx = tw(graph, node.id)
    expect(jsx).not.toContain('bg-')
    expect(jsx).not.toContain('rotate-')
  })

  test('POLYGON emits [clip-path:polygon(...)] sized to the bounding box', () => {
    const graph = makeGraph()
    const node = graph.createNode('POLYGON', pageId(graph), {
      width: 100,
      height: 100,
      pointCount: 3
    })
    const jsx = tw(graph, node.id)
    // Tailwind v4 silently drops the v3-style `clip-path-[polygon(...)]` value
    // syntax; the arbitrary-property form `[clip-path:polygon(...)]` is what
    // actually survives `@source inline(...)` and reaches the compiled CSS.
    expect(jsx).toMatch(/\[clip-path:polygon\(/)
    // Top vertex at (50%, 0%); underscores stand in for spaces inside [].
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
    expect(jsx).toMatch(/\[clip-path:polygon\(/)
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
    expect(tw(graph, node.id)).toMatch(/\[clip-path:polygon\(/)
  })
})
