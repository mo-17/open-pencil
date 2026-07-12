import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { Fill, SceneGraph } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 4 §15.1 — FRAME→Card. When `uiKit: 'shadcn'` is set, a card-like
 * container FRAME (visible background fill + rounded corners) emits `<Card>`
 * instead of a bare `<div>`, with its children kept inside. The heuristic is
 * pure compiler-emit; off / non-card FRAMEs stay `<div>`, and card-like frames now
 * keep overflow clipping by class injection.
 */

const WHITE_FILL: Fill = {
  type: 'SOLID',
  color: { r: 1, g: 1, b: 1, a: 1 },
  opacity: 1,
  visible: true
}

function compileWith(graph: SceneGraph, pageId: string, uiKit?: 'shadcn') {
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'card-app', ...(uiKit ? { uiKit } : {}) })
  })
}

describe('compile — FRAME→Card (Phase 4 §15.1)', () => {
  test('a card-like FRAME (fill + rounded) emits <Card> + import + card.tsx, children kept', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      name: 'Card',
      fills: [WHITE_FILL],
      cornerRadius: 12
    })
    graph.createNode('TEXT', frame.id, { text: 'Inside the card' })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain(`import { Card } from '@/components/ui/card'`)
    expect(app).toContain('<Card')
    expect(app).toContain('</Card>')
    // Child content survives inside the Card (it wraps, not replaces).
    expect(app).toContain('Inside the card')
    // Inlined component source emitted.
    expect(out.files.has('src/components/ui/card.tsx')).toBe(true)
  })

  test('rounded FRAME parent adds clipping while nested non-card rounded child keeps its own radius classes', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const cardFrame = graph.createNode('FRAME', pageId, {
      name: 'Card',
      fills: [WHITE_FILL],
      cornerRadius: 12,
      width: 240,
      height: 160
    })
    const child = graph.createNode('FRAME', cardFrame.id, {
      name: 'Child',
      fills: [],
      cornerRadius: 16,
      width: 120,
      height: 80
    })
    graph.createNode('TEXT', child.id, { text: 'chip' })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string

    // Parent card container should receive overflow clipping even when mapped to Card.
    expect(app).toMatch(/<Card[^>]*className="[^"]*\boverflow-hidden\b[^"]*"/)

    // Child FRAME (no visible fill -> non-card in heuristic) should keep its own rounded style.
    const childMatch = app.match(/<div[^>]*className="[^"]*w-30 h-20[^"]*"/)?.[0]
    expect(childMatch).toBeDefined()
    expect(childMatch).toMatch(/\brounded-(?:\[[^\]]+\]|[a-z0-9]+)\b/)
    // Non-card child should not be forced clipping unless it has its own clip intent.
    expect(childMatch).not.toMatch(/\boverflow-hidden\b/)
  })

  test('Card pulls no Radix dep (plain styled div — base deps only)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, { fills: [WHITE_FILL], cornerRadius: 8 })
    graph.createNode('TEXT', frame.id, { text: 'x' })

    const out = compileWith(graph, pageId, 'shadcn')
    const pkg = JSON.parse(out.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies).toHaveProperty('clsx')
    expect(pkg.dependencies).toHaveProperty('tailwind-merge')
    // Card is a plain styled <div> — no Radix.
    const radixDeps = Object.keys(pkg.dependencies).filter((d) => d.startsWith('@radix-ui/'))
    expect(radixDeps).toEqual([])
  })

  test('a FRAME with a fill but no rounded corners stays a <div>', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, { fills: [WHITE_FILL], cornerRadius: 0 })
    graph.createNode('TEXT', frame.id, { text: 'flat' })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('<Card')
    expect(out.files.has('src/components/ui/card.tsx')).toBe(false)
  })

  test('a rounded FRAME with no visible fill stays a <div>', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, { fills: [], cornerRadius: 12 })
    graph.createNode('TEXT', frame.id, { text: 'transparent' })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('<Card')
  })

  test('an invisible fill does not qualify a FRAME as a card', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      fills: [{ ...WHITE_FILL, visible: false }],
      cornerRadius: 12
    })
    graph.createNode('TEXT', frame.id, { text: 'hidden fill' })

    const out = compileWith(graph, pageId, 'shadcn')
    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('<Card')
  })

  test('without a UI kit, a card-like FRAME stays a div and still gets clipping', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, { fills: [WHITE_FILL], cornerRadius: 12 })
    graph.createNode('TEXT', frame.id, { text: 'plain' })

    const out = compileWith(graph, pageId)
    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('Card')
    expect(app).toMatch(/<div[^>]*className="[^"]*rounded[^"]*overflow-hidden[^"]*"/)
    expect(out.files.has('src/components/ui/card.tsx')).toBe(false)
  })
})
