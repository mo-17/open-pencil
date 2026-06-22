import { beforeAll, describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import {
  exportFigFile,
  initCodec,
  isAutoLayoutMode,
  parseFigFile,
  SceneGraph,
  type LayoutMode
} from '@open-pencil/core'

/**
 * Phase 2 §6 step 4 — cross-walker regression (经验 A).
 *
 * `'FREE'` is a new `LayoutMode` variant. Unlike Phase 2 §4's
 * `ExprAst.kind: 'template'` and Phase 2 §8's new NodeTypes, scalar
 * equality with the existing four values (`=== 'NONE'`, `!== 'NONE'`)
 * survives the union widening with NO tsgo error — so a missed sweep
 * site would silently drop FREE into one of the auto-layout branches.
 * Step 1 swept ~25 sites; this file pins the end-to-end semantic from
 * three angles a unit test can't cover:
 *
 *   - the `isAutoLayoutMode` helper itself stays exclusive of FREE
 *   - a full `compile()` honours FREE on a multi-page graph (no
 *     adapter walker drops the parent-level toggle silently)
 *   - the FREE flag survives a `.fig` round-trip end-to-end
 *
 * The walker-checklist log (`docs/lowcode-phase-2.md` §6.8) records
 * which sites the sweep covered vs. which stayed literal.
 */
describe('cross-walker — LayoutMode FREE is non-auto-layout everywhere', () => {
  test('isAutoLayoutMode rejects FREE alongside NONE (helper contract)', () => {
    // If a future contributor accidentally adds FREE into the helper's
    // narrow set, this assertion catches the regression immediately —
    // and every sweep site silently switches semantics.
    const allModes: LayoutMode[] = ['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID', 'FREE']
    const autoLayoutOnes = allModes.filter(isAutoLayoutMode)
    expect(autoLayoutOnes.sort()).toEqual(['GRID', 'HORIZONTAL', 'VERTICAL'])
  })
})

describe('cross-walker — FREE propagates through compile() and round-trips through .fig', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('FREE FRAME children emit absolute on a multi-page compile', () => {
    // Multi-page compile takes a different adapter branch than the
    // single-page suite covers (`adapters/react/index.ts:emitMultiPage`).
    // If that branch silently strips the FREE-derived absolute classes,
    // a single-page-only test would never catch it.
    const graph = new SceneGraph()
    const home = graph.getPages()[0]
    graph.updateNode(home.id, { name: 'Home' })
    const about = graph.addPage('About')

    const card = graph.createNode('FRAME', about.id, {
      name: 'Card',
      x: 10,
      y: 20,
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
      interactiveProps: { text: 'X' }
    })

    const out = compile({
      graph,
      pageIds: [home.id, about.id],
      options: withDefaults({ packageName: 'free-multipage' })
    })

    // About page lives under `src/pages/about.tsx` in multi-page mode.
    const aboutFile = out.files.get('src/pages/about.tsx') as string
    const buttonMatches = aboutFile.match(/<button[^>]*className="([^"]*)"/g) ?? []
    expect(buttonMatches.length).toBe(1)
    expect(buttonMatches[0]).toContain('absolute')
    expect(buttonMatches[0]).toMatch(/\bleft-10\b/)
    expect(buttonMatches[0]).toMatch(/\btop-15\b/)
  })

  test('FREE survives .fig round-trip and still drives compile after reload', async () => {
    // Combines the §6 step 3 persistence path with the §6 step 2 emit
    // path — if either silently drops the flag mid-walk, the reimported
    // compile loses the absolute classes.
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('FRAME', page.id, {
      name: 'FreeCard',
      width: 300,
      height: 200,
      layoutMode: 'FREE'
    })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedPage = reimported.getPages()[0]
    const reimportedFrame = [...reimported.getAllNodes()].find((n) => n.name === 'FreeCard')
    expect(reimportedFrame?.layoutMode).toBe('FREE')

    // Add a BUTTON to the reimported FREE FRAME and compile — the
    // reimported FREE flag should drive absolute emit just like the
    // pristine in-memory graph does.
    if (!reimportedFrame) throw new Error('reimport lost FreeCard FRAME')
    reimported.createNode('BUTTON', reimportedFrame.id, {
      name: 'X',
      x: 30,
      y: 50,
      width: 80,
      height: 32,
      interactiveProps: { text: 'X' }
    })

    const out = compile({
      graph: reimported,
      pageIds: [reimportedPage.id],
      options: withDefaults({ packageName: 'free-reimported' })
    })
    const app = out.files.get('src/App.tsx') as string
    const buttonMatch = app.match(/<button[^>]*className="([^"]*)"/)
    expect(buttonMatch?.[1] ?? '').toContain('absolute')
  })
})
