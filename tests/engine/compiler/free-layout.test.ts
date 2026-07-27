import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function openingTagForNode(source: string, nodeId: string): string {
  const marker = `data-node-id="${nodeId}"`
  const markerIndex = source.indexOf(marker)
  if (markerIndex === -1) throw new Error(`Missing emitted node ${nodeId}`)
  const start = source.lastIndexOf('<', markerIndex)
  const end = source.indexOf('>', markerIndex)
  if (start === -1 || end === -1) throw new Error(`Malformed emitted node ${nodeId}`)
  return source.slice(start, end + 1)
}

/**
 * Phase 2 §6 — `layoutMode: 'FREE'` parent toggle + `layoutPositioning:
 * 'ABSOLUTE'` per-child opt-out emit honor. Tests cover the five canonical
 * cases for absolute positioning emit:
 *
 *   1. CANVAS direct child  → absolute (Phase 1 §1 regression — still works)
 *   2. NONE FRAME child     → absolute (legacy editor coordinate container)
 *   3. FREE FRAME child     → absolute (§6 decision #3 — parent-level toggle)
 *   4. ABSOLUTE child       → absolute (§6 邻近 — emit honor for the existing
 *                                       Figma field)
 *   5. Auto-layout child    → flex item (no false positives)
 */

describe("compile — `layoutMode: 'FREE'` (Phase 2 §6 parent-level)", () => {
  test("a FREE FRAME's direct child emits absolute + left/top", () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const card = graph.createNode('FRAME', pageId, {
      name: 'Card',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      layoutMode: 'FREE'
    })
    graph.createNode('BUTTON', card.id, {
      name: 'Inner',
      x: 40,
      y: 60,
      width: 100,
      height: 40,
      interactiveProps: { text: 'Go' }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'free-card' })
    })

    const app = out.files.get('src/App.tsx') as string
    // CANVAS direct child (the FREE FRAME) is itself absolute (CANVAS is
    // implicitly FREE per §6 decision #a).
    // The BUTTON inside the FREE FRAME also becomes absolute — that's the
    // new behaviour §6 unlocks.
    const buttonMatches = app.match(/<button[^>]*className="([^"]*)"/g) ?? []
    expect(buttonMatches.length).toBe(1)
    expect(buttonMatches[0]).toContain('absolute')
    expect(buttonMatches[0]).toMatch(/\bleft-10\b/) // 40px → 10 spacing units
    expect(buttonMatches[0]).toMatch(/\btop-15\b/) // 60px → 15 spacing units
  })

  test('a legacy NONE frame preserves nested canvas coordinates', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const column = graph.createNode('FRAME', pageId, {
      name: 'Column',
      width: 300,
      height: 300,
      layoutMode: 'VERTICAL'
    })
    const scene = graph.createNode('FRAME', column.id, {
      name: 'Coordinate scene',
      width: 280,
      height: 240,
      // NONE is the SceneGraph/editor default for a coordinate container.
      layoutMode: 'NONE',
      clipsContent: true
    })
    const frog = graph.createNode('RECTANGLE', scene.id, {
      name: 'Frog',
      x: 40,
      y: 60,
      width: 80,
      height: 90
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'legacy-coordinate-scene' })
    })
    const app = out.files.get('src/App.tsx') as string
    const sceneTag = openingTagForNode(app, scene.id)
    const frogTag = openingTagForNode(app, frog.id)

    // The scene is a containing block even though it remains a normal child
    // of the outer auto-layout column. Its descendants keep editor-local x/y.
    expect(sceneTag).toContain('relative')
    expect(sceneTag).toContain('overflow-hidden')
    expect(frogTag).toContain('absolute')
    expect(frogTag).toContain('left-10')
    expect(frogTag).toContain('top-15')
  })

  test('CANVAS is implicitly FREE — Phase 1 §1 regression stays green', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('BUTTON', pageId, {
      x: 120,
      y: 80,
      width: 120,
      height: 40,
      interactiveProps: { text: 'Go' }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'canvas-direct' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toMatch(/className="[^"]*\babsolute\b[^"]*"/)
    expect(app).toMatch(/className="[^"]*\bleft-30\b[^"]*"/)
    expect(app).toMatch(/className="[^"]*\btop-20\b[^"]*"/)
  })

  test('auto-layout FRAME inside FREE FRAME — the FRAME is absolute, its children flex', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const card = graph.createNode('FRAME', pageId, {
      name: 'Card',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      layoutMode: 'FREE'
    })
    const row = graph.createNode('FRAME', card.id, {
      name: 'Row',
      x: 20,
      y: 20,
      width: 200,
      height: 40,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 16,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    graph.createNode('BUTTON', row.id, { interactiveProps: { text: 'A' } })
    graph.createNode('BUTTON', row.id, { interactiveProps: { text: 'B' } })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'free-then-flex' })
    })
    const app = out.files.get('src/App.tsx') as string
    // The HORIZONTAL FRAME (Row) is itself a direct child of the FREE
    // FRAME → it must be absolute even though it's auto-layout itself.
    // Inside Row, the two buttons stay flex items (no absolute).
    const buttonMatches = app.match(/<button[^>]*className="([^"]*)"/g) ?? []
    expect(buttonMatches.length).toBe(2)
    for (const m of buttonMatches) {
      expect(m).not.toContain('absolute')
      expect(m).not.toMatch(/\bleft-\d/)
      expect(m).not.toMatch(/\btop-\d/)
    }
    // Row itself reads `flex` + `absolute`.
    expect(app).toMatch(/<div[^>]*className="[^"]*\bflex\b[^"]*\babsolute\b/)
  })

  test('FREE container child with HUG sizing still gets explicit width/height (§6 decision #g)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const card = graph.createNode('FRAME', pageId, {
      name: 'Card',
      width: 300,
      height: 200,
      layoutMode: 'FREE'
    })
    // A FRAME child with HORIZONTAL HUG sizing — without the fallback, the
    // absolute positioning would collapse its width/height to 0.
    const inner = graph.createNode('FRAME', card.id, {
      x: 10,
      y: 10,
      width: 80,
      height: 30,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG'
    })
    graph.createNode('BUTTON', inner.id, { interactiveProps: { text: 'X' } })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'hug-free-child' })
    })
    const app = out.files.get('src/App.tsx') as string
    // The HUG inner gets absolute + the §6 sizing fallback (w-20, h-* explicit).
    expect(app).toMatch(/<div[^>]*className="[^"]*\babsolute\b[^"]*\bw-20\b/)
  })
})

describe("compile — `layoutPositioning: 'ABSOLUTE'` per-child opt-out (Phase 2 §6 邻近)", () => {
  test('an ABSOLUTE child of an auto-layout FRAME emits absolute + left/top', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const column = graph.createNode('FRAME', pageId, {
      name: 'Column',
      width: 400,
      height: 160,
      layoutMode: 'VERTICAL'
    })
    const row = graph.createNode('FRAME', column.id, {
      name: 'Row',
      width: 400,
      height: 80,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 16,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    // Two flex siblings + one absolute opt-out.
    graph.createNode('BUTTON', row.id, { interactiveProps: { text: 'A' } })
    graph.createNode('BUTTON', row.id, {
      interactiveProps: { text: 'Tooltip' },
      x: 200,
      y: 16,
      width: 80,
      height: 24,
      layoutPositioning: 'ABSOLUTE'
    })
    graph.createNode('BUTTON', row.id, { interactiveProps: { text: 'B' } })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'abs-in-flex' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(openingTagForNode(app, row.id)).toContain('relative')
    const buttonMatches = app.match(/<button[^>]*className="([^"]*)"/g) ?? []
    expect(buttonMatches.length).toBe(3)
    const absMatches = buttonMatches.filter((m) => /\babsolute\b/.test(m))
    // Exactly one button — the ABSOLUTE opt-out — gets absolute classes.
    expect(absMatches.length).toBe(1)
    expect(absMatches[0]).toMatch(/\bleft-50\b/) // 200px → 50
    expect(absMatches[0]).toMatch(/\btop-4\b/) // 16px → 4
  })

  test('a plain (AUTO) child of an auto-layout FRAME stays a flex item', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const row = graph.createNode('FRAME', pageId, {
      name: 'Row',
      width: 400,
      height: 80,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 16,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    graph.createNode('BUTTON', row.id, { interactiveProps: { text: 'Inner' } })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'plain-flex' })
    })
    const app = out.files.get('src/App.tsx') as string
    const buttonMatches = app.match(/<button[^>]*className="([^"]*)"/g) ?? []
    expect(buttonMatches.length).toBe(1)
    expect(buttonMatches[0]).not.toContain('absolute')
  })
})
