import { describe, expect, test } from 'bun:test'

import { getTool, setupToolTest } from '#tests/helpers/tools'

function action(operation: 'inspect' | 'retry' | 'acknowledge' = 'inspect') {
  return {
    id: 'recover-checkout',
    kind: 'backendCommandRecovery',
    commandId: 'checkout',
    idempotencyKeyTarget: 'attempt',
    operation,
    ...(operation === 'inspect' ? {} : { attemptKeyExpr: 'recovery.key' }),
    resultTarget: 'recovery',
    errorTarget: 'error',
    onSuccess: [{ id: 'success', kind: 'navigate', to: '/orders' }],
    onError: [{ id: 'failure', kind: 'toast', messageExpr: '"Recovery failed"' }]
  }
}

describe('AI command recovery authoring', () => {
  test.each(['inspect', 'retry', 'acknowledge'] as const)(
    'preserves %s fields and recursive continuations through the real registered tool',
    (operation) => {
      const { figma, graph } = setupToolTest()
      const button = figma.createRectangle()
      const events = { onClick: [action(operation)] }
      expect(
        getTool('update_lowcode_node').execute(figma, {
          id: button.id,
          patch_json: JSON.stringify({ events })
        })
      ).toMatchObject({ ok: true })
      expect(graph.getNode(button.id)?.events).toEqual(events)
    }
  )

  test('preserves opt-in command recovery and makes its contract discoverable', () => {
    const { figma, graph } = setupToolTest()
    const button = figma.createRectangle()
    const events = {
      onClick: [
        {
          id: 'buy',
          kind: 'backendCommand',
          commandId: 'checkout',
          idempotencyKeyTarget: 'attempt',
          recovery: 'browser',
          onSuccess: [action()]
        }
      ]
    }
    const tool = getTool('update_lowcode_node')
    expect(tool.description).toContain('backendCommandRecovery')
    expect(tool.description).toContain('attemptKeyExpr')
    expect(
      tool.execute(figma, { id: button.id, patch_json: JSON.stringify({ events }) })
    ).toMatchObject({ ok: true })
    expect(graph.getNode(button.id)?.events).toEqual(events)
  })

  test.each([
    { operation: 'retry', attemptKeyExpr: undefined },
    { payloadEntries: [{ key: 'ownerId', valueExpr: '"someone-else"' }] },
    { onSuccess: [{ ...action('acknowledge'), attemptKeyExpr: undefined }] },
    { onError: [{ id: 'nested', kind: 'backendCommand', recovery: 'automatic' }] }
  ])('rejects malformed recovery and nested branches atomically %#', (patch) => {
    const { figma, graph } = setupToolTest()
    const button = figma.createRectangle()
    const before = structuredClone(graph.getNode(button.id))
    expect(
      getTool('update_lowcode_node').execute(figma, {
        id: button.id,
        patch_json: JSON.stringify({
          interactiveProps: { text: 'Changed' },
          events: { onClick: [{ ...action(), ...patch }] }
        })
      })
    ).toMatchObject({ ok: false })
    expect(graph.getNode(button.id)).toEqual(before)
  })
})
