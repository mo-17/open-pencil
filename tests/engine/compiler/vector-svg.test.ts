import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Vector-shape nodes (VECTOR / BOOLEAN_OPERATION / STAR / POLYGON / LINE) used
 * to emit as a plain `<div>` carrying only size + fill→background, i.e. a solid
 * colored box — icons showed up as squares in the preview. They now emit their
 * path geometry as an inline `<svg>` (via `dangerouslySetInnerHTML`, reusing
 * core's headless SVG exporter) inside the layout wrapper, and the wrapper sheds
 * its fill→`bg-[…]` so no box is painted behind the icon.
 */

/** A closed rectangle path as an OpenPencil geometry commands blob. */
function rectangleCommandsBlob(x: number, y: number, width: number, height: number): Uint8Array {
  const blob = new Uint8Array(1 + 4 * 9 + 1)
  const view = new DataView(blob.buffer)
  const points = [
    { command: 1, x, y },
    { command: 2, x: x + width, y },
    { command: 2, x: x + width, y: y + height },
    { command: 2, x, y: y + height }
  ]
  let offset = 0
  for (const point of points) {
    blob[offset] = point.command
    view.setFloat32(offset + 1, point.x, true)
    view.setFloat32(offset + 5, point.y, true)
    offset += 9
  }
  blob[offset] = 0
  return blob
}

describe('compile — vector shapes emit inline SVG (icons, not boxes)', () => {
  test('lets the wrapper own root presentation while preserving descendant presentation', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      width: 30,
      height: 20,
      opacity: 0.5,
      rotation: 30,
      blendMode: 'MULTIPLY',
      fills: []
    })
    const child = graph.createNode('VECTOR', frame.id, {
      width: 30,
      height: 20,
      opacity: 0.25,
      rotation: 10,
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(2, 2, 26, 16) }],
      fills: [
        {
          type: 'SOLID',
          color: { r: 0, g: 0, b: 1, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })

    const tree = collectTree(graph, pageId)
    const element = tree.children[0] as IRElement
    const rawHtml = element.rawHtml ?? ''
    const rootGroup = rawHtml.match(
      new RegExp(`<g[^>]*data-op-node-group="${frame.id}"[^>]*>`)
    )?.[0]
    const childGroup = rawHtml.match(
      new RegExp(`<g[^>]*data-op-node-group="${child.id}"[^>]*>`)
    )?.[0]
    expect(rootGroup).toBeDefined()
    expect(rootGroup).not.toContain('opacity=')
    expect(rootGroup).not.toContain('rotate(')
    expect(rootGroup).not.toContain('mix-blend-mode')
    expect(childGroup).toContain('opacity="0.25"')
    expect(childGroup).toContain('rotate(10, 15, 10)')
    expect(rawHtml).toContain('viewBox="0 0 30 20"')
    expect(rawHtml).toContain('overflow="visible"')
    expect(element.className).toContain('opacity-50')
  })

  test('a VECTOR emits <svg>/<path> via dangerouslySetInnerHTML, no fill→bg box', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('VECTOR', pageId, {
      x: 0,
      y: 0,
      width: 24,
      height: 24,
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(2, 2, 20, 20) }],
      fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.8, a: 1 }, opacity: 1, visible: true }]
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'icon-demo' })
    })
    const app = out.files.get('src/App.tsx') as string

    // Inline SVG, not an empty div.
    expect(app).toContain('dangerouslySetInnerHTML')
    expect(app).toContain('<svg')
    expect(app).toContain('<path')
    expect(app).toContain('viewBox')
    // Made responsive (fixed px width/height swapped for 100%).
    expect(app).toContain('100%')
    // The fill→bg box is gone — otherwise the icon would still look like a
    // solid square of its own color.
    expect(app).not.toContain('bg-[')
  })

  test('a plain FRAME with a fill is unaffected (still a CSS div)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, {
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'frame-demo' })
    })
    const app = out.files.get('src/App.tsx') as string

    // FRAME keeps the CSS-box representation; no SVG injection.
    expect(app).not.toContain('dangerouslySetInnerHTML')
    expect(app).toContain('bg-[')
  })

  test('a multi-path icon (FRAME of vector children) folds into ONE aligned svg', () => {
    // import_svg shape: a FRAME of full-size VECTOR children, one per path.
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const fill = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    const frame = graph.createNode('FRAME', pageId, {
      x: 0,
      y: 0,
      width: 24,
      height: 24,
      fills: []
    })
    graph.createNode('VECTOR', frame.id, {
      x: 0,
      y: 0,
      width: 24,
      height: 24,
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(2, 2, 8, 8) }],
      fills: fill
    })
    graph.createNode('VECTOR', frame.id, {
      x: 0,
      y: 0,
      width: 24,
      height: 24,
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(14, 14, 8, 8) }],
      fills: fill
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'icon-multi' })
    })
    const app = out.files.get('src/App.tsx') as string

    // Exactly ONE inline svg (the frame folded) — not one-per-child, which is
    // what made the paths stack/misalign.
    expect((app.match(/dangerouslySetInnerHTML/g) ?? []).length).toBe(1)
    // Both paths live in that single svg, at their true shared-viewBox coords.
    expect(app).toContain('M2 2')
    expect(app).toContain('M14 14')
  })

  test('a HUG auto-layout row of vector icons stays a layout container', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const fill = [
      {
        type: 'SOLID' as const,
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true
      }
    ]
    const row = graph.createNode('FRAME', pageId, {
      name: 'StatusIcons',
      width: 38,
      height: 16,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
      itemSpacing: 8,
      fills: []
    })
    graph.createNode('VECTOR', row.id, {
      x: 0,
      y: 1,
      width: 14,
      height: 14,
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(1, 1, 12, 12) }],
      fills: fill
    })
    graph.createNode('VECTOR', row.id, {
      x: 22,
      y: 0,
      width: 16,
      height: 16,
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(1, 1, 14, 14) }],
      fills: fill
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'status-icon-row' })
    })
    const app = out.files.get('src/App.tsx') as string

    // The row keeps its two fixed-size children, which provide its HUG
    // dimensions. Folding the whole row would leave one 100% SVG in a wrapper
    // with no width/height and trigger the browser's 300×150 SVG fallback.
    expect((app.match(/dangerouslySetInnerHTML/g) ?? []).length).toBe(2)
    expect(app).toMatch(/className="[^"]*\bflex\b[^"]*"/)
    expect(app).toMatch(/className="[^"]*\bgap-2\b[^"]*"/)
    expect(app).not.toContain('viewBox="0 0 38 16"')
  })

  test('LINE inline SVG keeps authored bounds instead of applying CSS line geometry twice', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const window = graph.createNode('FRAME', pageId, {
      name: 'HouseWindow',
      x: 22,
      y: 64,
      width: 76,
      height: 60,
      layoutMode: 'VERTICAL',
      clipsContent: true,
      fills: []
    })
    graph.createNode('LINE', window.id, {
      name: 'WindowCross',
      x: 36,
      y: 0,
      width: 1,
      height: 60,
      layoutPositioning: 'ABSOLUTE',
      fills: [],
      strokes: [
        {
          color: { r: 0.54, g: 0.36, b: 0.25, a: 1 },
          weight: 2,
          opacity: 1,
          visible: true,
          align: 'INSIDE'
        }
      ]
    })
    const frog = graph.createNode('FRAME', pageId, {
      name: 'FrogTravelerHero',
      x: 120,
      y: 200,
      width: 124,
      height: 90,
      layoutMode: 'VERTICAL',
      fills: []
    })
    graph.createNode('LINE', frog.id, {
      name: 'FrogMouth',
      x: 51,
      y: 46,
      width: 22,
      height: 1,
      layoutPositioning: 'ABSOLUTE',
      fills: [],
      strokes: [
        {
          color: { r: 0.18, g: 0.32, b: 0.22, a: 1 },
          weight: 2,
          opacity: 1,
          visible: true,
          align: 'INSIDE'
        }
      ]
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'line-bounds' })
    })
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain('className="absolute top-0 left-9 w-px h-15"')
    expect(app).toContain('viewBox=\\"0 0 1 60\\"')
    expect(app).toContain('x1=\\"0\\" y1=\\"0\\" x2=\\"1\\" y2=\\"60\\"')
    expect(app).toContain('className="absolute top-[46px] left-[51px] w-[22px] h-px"')
    expect(app).toContain('viewBox=\\"0 0 22 1\\"')
    expect(app).not.toContain('origin-left')
    expect(app).not.toContain('rotate-[89')
    expect(app).not.toContain('w-[60.008')
  })
})
