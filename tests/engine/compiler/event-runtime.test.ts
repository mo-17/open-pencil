import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 4 §28 — user event coverage. onChange/onFocus/onBlur emit end to end,
 * and event handlers get `$event` / `$value` locals. Controlled onChange keeps
 * the generated writer and then runs the user action chain.
 */
describe('compile — user events (Phase 4 §28)', () => {
  test('onFocus and onBlur user handlers emit with event locals', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'status', type: 'string', defaultValue: '' }]
    })
    graph.createNode('INPUT', pageId, {
      events: {
        onFocus: [{ id: 'f', kind: 'setVariable', targetName: 'status', valueExpr: '"focused"' }],
        onBlur: [{ id: 'b', kind: 'setVariable', targetName: 'status', valueExpr: '"blurred"' }]
      }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'events' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain(
      'onFocus={(e) => { const $event = e; const $value = (e.target as HTMLInputElement).value;'
    )
    expect(app).toContain('setDocState("status", "focused")')
    expect(app).toContain(
      'onBlur={(e) => { const $event = e; const $value = (e.target as HTMLInputElement).value;'
    )
    expect(app).toContain('setDocState("status", "blurred")')
  })

  test('controlled onChange runs generated writer before the user chain', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'd1', name: 'email', type: 'string', defaultValue: '' },
        { id: 'd2', name: 'lastValue', type: 'string', defaultValue: '' }
      ]
    })
    graph.createNode('INPUT', pageId, {
      bindings: { value: { kind: 'docState', docStateName: 'email' } },
      events: {
        onChange: [{ id: 'c', kind: 'setVariable', targetName: 'lastValue', valueExpr: '$value' }]
      }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'events' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(out.warnings).toEqual([])
    expect(app).toContain(
      'onChange={(e) => { const $event = e; const $value = (e.target as HTMLInputElement).value;'
    )
    expect(app).toContain('setDocState("email", e.target.value);')
    expect(app).toContain('setDocState("lastValue", $value);')
  })

  test('$value is rejected outside event-local handlers', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'lastValue', type: 'string', defaultValue: '' }]
    })
    graph.createNode('BUTTON', pageId, {
      events: {
        onClick: [{ id: 'c', kind: 'setVariable', targetName: 'lastValue', valueExpr: '$value' }]
      }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'events' })
    })
    expect(out.warnings.map((w) => w.code)).toContain('action-setvariable-unknown-identifier')
  })
})
