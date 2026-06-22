import { beforeAll, describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph, initCodec } from '@open-pencil/core'

/**
 * Phase 2 §7 step 4 — cross-scenario regression for the canvas↔preview
 * bridge's widened message protocol (经验 A applied to a non-IR layer).
 *
 * §7 adds a `'navigate'` kind to the bridge's `type` union without
 * touching the compiler's IR walkers. The risk class is the same as
 * experience A: a `'select'`-only dispatch branch could silently drop
 * navigate. tsgo cannot enforce exhaustiveness on the template-literal
 * runtime, so this file pins (a) that every `compile()` path that emits
 * the bridge ships BOTH message kinds, and (b) that single-page emit
 * still ships the same bridge so its select channel doesn't regress
 * when no router exists to listen for navigate.
 */
describe('cross-walker — bridge navigate channel ships in every devMode compile', () => {
  beforeAll(async () => {
    await initCodec()
  })

  function expectBridgeWithBothKinds(bridge: string): void {
    // Both dispatch branches present, not just the protocol mentions.
    expect(bridge).toContain("if (data.type === 'select')")
    expect(bridge).toContain("if (data.type === 'navigate')")
    // Outbound emit for navigate (mirror of the inbound dispatch).
    expect(bridge).toMatch(/source: OUTBOUND_SOURCE,\s*type: 'navigate'/)
    // Echo-loop guard present — without this, an inbound navigate would
    // round-trip back to the editor and re-fire indefinitely.
    expect(bridge).toContain('let suppressOutbound = false')
  }

  test('single-page compile emits the bridge with both message kinds (devMode)', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults()
    })

    expect(out.files.has('src/__preview-bridge.ts')).toBe(true)
    expectBridgeWithBothKinds(out.files.get('src/__preview-bridge.ts') as string)
  })

  test('multi-page compile emits the same bridge with both message kinds', () => {
    const graph = new SceneGraph()
    const home = graph.getPages()[0]
    graph.updateNode(home.id, { name: 'Home' })
    const about = graph.addPage('About')

    const out = compile({
      graph,
      pageIds: [home.id, about.id],
      options: withDefaults()
    })

    // Multi-page emit produces a router shell + pages, all sharing the
    // same bridge file at the project root.
    expect(out.files.has('src/__preview-bridge.ts')).toBe(true)
    expectBridgeWithBothKinds(out.files.get('src/__preview-bridge.ts') as string)
  })

  test('devMode=false omits the bridge entirely (no channel shipped at all)', () => {
    // Sanity — confirms the navigate channel does not leak into production
    // emit. Phase 1 §11.4 / Phase 0 §5.4 contract preserved.
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ devMode: false })
    })

    expect(out.files.has('src/__preview-bridge.ts')).toBe(false)
  })
})
