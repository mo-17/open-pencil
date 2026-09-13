import { describe, expect, test } from 'bun:test'

import { getTool, setupToolTest } from '#tests/helpers/tools'

function update(figma: ReturnType<typeof setupToolTest>['figma'], id: string, patch: unknown) {
  return getTool('update_lowcode_node').execute(figma, { id, patch_json: JSON.stringify(patch) })
}

describe('Backend client authoring tool', () => {
  test('preserves authentication and recursively validated request result branches', () => {
    const { figma, graph } = setupToolTest()
    const button = figma.createRectangle()
    const events = {
      onClick: [
        {
          id: 'create-note',
          kind: 'backendRequest',
          operation: 'create',
          resourceId: 'notes',
          payloadEntries: [{ key: 'title', valueExpr: 'titleInput' }],
          onSuccess: [{ id: 'clear', kind: 'setState', targetStateId: 'title', valueExpr: '""' }],
          onError: [{ id: 'login', kind: 'backendAuth', operation: 'signIn', returnPath: '/notes' }]
        }
      ]
    }
    expect(update(figma, button.id, { events })).toMatchObject({ ok: true })
    expect(graph.getNode(button.id)?.events).toEqual(events)
  })

  test('rejects an invalid nested action atomically and leaves previous document fields intact', () => {
    const { figma, graph } = setupToolTest()
    const button = figma.createRectangle()
    const before = structuredClone(graph.getNode(button.id))
    const action = {
      id: 'delete-note',
      kind: 'backendRequest',
      operation: 'delete',
      resourceId: 'notes',
      idExpr: 'item.id',
      onError: [
        { id: 'bad-login', kind: 'backendAuth', operation: 'signIn', returnPath: '//external.test' }
      ]
    }
    const result = update(figma, button.id, {
      interactiveProps: { text: 'must not change' },
      events: { onClick: [action] }
    })
    expect(result).toMatchObject({ ok: false })
    expect(graph.getNode(button.id)).toEqual(before)
  })

  test('requires a bounded resource LIST binding and rejects the binding on ordinary nodes', () => {
    const { figma, graph } = setupToolTest()
    const button = figma.createRectangle()
    const dataSourceRef = { kind: 'backendResource', resourceId: 'notes', limit: 20 }
    expect(update(figma, button.id, { interactiveProps: { dataSourceRef } })).toMatchObject({
      ok: false
    })
    graph.updateNode(button.id, { type: 'LIST' })
    expect(update(figma, button.id, { interactiveProps: { dataSourceRef } })).toMatchObject({
      ok: true
    })
    expect(graph.getNode(button.id)?.interactiveProps?.dataSourceRef).toEqual(dataSourceRef)
    expect(
      update(figma, button.id, {
        interactiveProps: { dataSourceRef: { ...dataSourceRef, limit: 1000 } }
      })
    ).toMatchObject({ ok: false })
    expect(graph.getNode(button.id)?.interactiveProps?.dataSourceRef).toEqual(dataSourceRef)
  })
})
