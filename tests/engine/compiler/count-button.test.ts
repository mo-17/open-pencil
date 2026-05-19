import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * End-to-end verification of the Phase 0 "count button" demo:
 *
 *   1. Page declares `count: number = 0`.
 *   2. Button onClick → setState(count, count + 1).
 *   3. Text node text is bound to `count`.
 *
 * The compiled App.tsx must contain a working `useState` hook, an `onClick`
 * handler that calls the setter, and a JSX expression that interpolates the
 * state into the text node.
 */
describe('count button — end-to-end compile', () => {
  test('emits useState, onClick handler, and text binding', () => {
    const graph = makeSceneGraph('Counter')
    const pageId = firstPageId(graph)
    const page = graph.getNode(pageId)
    if (!page) throw new Error('no page')

    page.state = [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }]

    const btn = graph.createNode('BUTTON', pageId, {
      interactiveProps: { text: '+1' }
    })
    btn.events = {
      onClick: [
        {
          id: 'a1',
          kind: 'setState',
          targetStateId: 's1',
          valueExpr: 'count + 1'
        }
      ]
    }

    const text = graph.createNode('TEXT', pageId, { text: '0' })
    text.bindings = { text: { kind: 'ref', stateId: 's1' } }

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'counter-demo' })
    })

    expect(out.warnings).toEqual([])

    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain("import { useState } from 'react'")
    expect(app).toContain('const [count, setCount] = useState(0)')
    expect(app).toContain('onClick={() => setCount(count + 1)}')
    // text node renders the dynamic expression, not the literal "0":
    expect(app).toContain('{count}')
    expect(app).not.toMatch(/<p[^>]*>0<\/p>/)
  })

  test('keeps warnings when an action expression is invalid', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const page = graph.getNode(pageId)
    if (!page) throw new Error('no page')
    page.state = [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }]
    const btn = graph.createNode('BUTTON', pageId)
    btn.events = {
      onClick: [
        { id: 'a1', kind: 'setState', targetStateId: 's1', valueExpr: 'fn(1)' }
      ]
    }

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'demo' })
    })

    expect(out.warnings.some((w) => w.code === 'action-invalid-expression')).toBe(true)
    const app = out.files.get('src/App.tsx') as string
    // No onClick wired because the only action was dropped:
    expect(app).not.toContain('onClick=')
  })

  test('state without bindings still compiles', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const page = graph.getNode(pageId)
    if (!page) throw new Error('no page')
    page.state = [{ id: 's1', name: 'value', type: 'string', defaultValue: 'hi' }]

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'demo' })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain("const [value, setValue] = useState(\"hi\")")
  })
})
