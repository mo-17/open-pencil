import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

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
})
