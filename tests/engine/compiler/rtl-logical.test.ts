import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function graphWithPaddedFrame(): { graph: SceneGraph; pageId: string } {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  graph.createNode('FRAME', pageId, {
    name: 'Padded',
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    layoutMode: 'VERTICAL',
    paddingTop: 4,
    paddingRight: 8,
    paddingBottom: 12,
    paddingLeft: 16
  })
  return { graph, pageId }
}

function compileApp(graph: SceneGraph, pageId: string, rtlLogicalProperties = false): string {
  const out = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({
      packageName: 'rtl-logical',
      ...(rtlLogicalProperties ? { rtlLogicalProperties } : {})
    })
  })
  return out.files.get('src/App.tsx') as string
}

describe('compile — RTL logical Tailwind padding (Phase 4 §9 v15)', () => {
  test('keeps physical left/right utilities by default', () => {
    const { graph, pageId } = graphWithPaddedFrame()
    const app = compileApp(graph, pageId)

    expect(app).toMatch(/\bpl-4\b/)
    expect(app).toMatch(/\bpr-2\b/)
    expect(app).not.toMatch(/\bps-4\b/)
    expect(app).not.toMatch(/\bpe-2\b/)
  })

  test('emits inline-start/end utilities when explicitly enabled', () => {
    const { graph, pageId } = graphWithPaddedFrame()
    const app = compileApp(graph, pageId, true)

    expect(app).toMatch(/\bps-4\b/)
    expect(app).toMatch(/\bpe-2\b/)
    expect(app).toMatch(/\bpt-1\b/)
    expect(app).toMatch(/\bpb-3\b/)
    expect(app).not.toMatch(/\bpl-4\b/)
    expect(app).not.toMatch(/\bpr-2\b/)
  })
})
