import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 4 §20 — interaction-state styling. A node's `stateOverrides` flow
 * through the compiler as state-prefixed Tailwind classes (`hover:` / `focus:` /
 * `active:` / `disabled:`) appended to the emitted `className`, so the generated
 * React app responds to interaction with zero runtime / zero new dependency.
 */
describe('compile — interaction-state styling (Phase 4 §20)', () => {
  test('a card with a hover background override emits `hover:bg-…` on its div', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const card = graph.createNode('FRAME', pageId, {
      name: 'Card',
      width: 200,
      height: 80,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
    })
    graph.updateNode(card.id, {
      stateOverrides: { hover: { fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }] } }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'state-card' })
    })
    const app = out.files.get('src/App.tsx') as string
    const cardDiv = (app.match(/<div className="[^"]*\bhover:bg-/) ?? [])[0] ?? ''
    expect(cardDiv).toContain('hover:bg-')
  })

  test('a disabled opacity override emits `disabled:opacity-50`', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const button = graph.createNode('BUTTON', pageId, { interactiveProps: { text: 'Save' } })
    graph.updateNode(button.id, { stateOverrides: { disabled: { opacity: 0.5 } } })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'state-button' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('disabled:opacity-50')
  })

  test('no override → no user-authored state-prefixed classes', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('FRAME', pageId, {
      name: 'Plain',
      width: 100,
      height: 40,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'state-plain' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('active:')
    expect(app).not.toContain('focus:')
  })
})
