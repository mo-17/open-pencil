import { describe, expect, test } from 'bun:test'

import { getTool, setupToolTest } from '#tests/helpers/tools'

function action() {
  return {
    id: 'checkout',
    kind: 'backendCommand',
    commandId: 'checkout',
    idempotencyKeyTarget: 'attempt',
    payloadEntries: [{ key: 'productId', valueExpr: 'item.id' }],
    onSuccess: [{ id: 'success', kind: 'setVariable', targetName: 'result', valueExpr: 'data' }],
    onError: [{ id: 'error', kind: 'setVariable', targetName: 'error', valueExpr: 'error.code' }]
  }
}

describe('AI command action authoring', () => {
  test('preserves command parameters, attempt target and recursively validated continuation branches', () => {
    const { figma, graph } = setupToolTest()
    const button = figma.createRectangle()
    const events = { onClick: [action()] }
    expect(
      getTool('update_lowcode_node').execute(figma, {
        id: button.id,
        patch_json: JSON.stringify({ events })
      })
    ).toMatchObject({ ok: true })
    expect(graph.getNode(button.id)?.events).toEqual(events)
  })
  test('invalid nested command content fails atomically without changing the button', () => {
    const { figma, graph } = setupToolTest()
    const button = figma.createRectangle()
    const before = structuredClone(graph.getNode(button.id))
    const command = {
      ...action(),
      onSuccess: [{ ...action(), id: 'nested', idempotencyKeyTarget: '' }]
    }
    expect(
      getTool('update_lowcode_node').execute(figma, {
        id: button.id,
        patch_json: JSON.stringify({
          interactiveProps: { text: 'Changed' },
          events: { onClick: [command] }
        })
      })
    ).toMatchObject({ ok: false })
    expect(graph.getNode(button.id)).toEqual(before)
  })
})
