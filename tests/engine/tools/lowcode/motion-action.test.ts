import { describe, expect, test } from 'bun:test'

import { getTool, setupToolTest } from '#tests/helpers/tools'

type Result = { ok: true; data?: unknown } | { ok: false; error: string }

function updateEvents(
  id: string,
  events: Record<string, unknown>,
  figma: ReturnType<typeof setupToolTest>['figma']
): Result {
  return getTool('update_lowcode_node').execute(figma, {
    id,
    patch_json: JSON.stringify({ events })
  }) as Result
}

describe('update_lowcode_node — motion actions', () => {
  test('persists playMotion and stopMotion with optional track selection', () => {
    const { figma, graph } = setupToolTest()
    const button = figma.createRectangle()
    const actions = [
      { id: 'play-1', kind: 'playMotion', targetNodeId: 'animated-node', trackId: 'hover' },
      { id: 'stop-1', kind: 'stopMotion', targetNodeId: 'animated-node' }
    ]

    const result = updateEvents(button.id, { onClick: actions }, figma)

    expect(result.ok).toBe(true)
    expect(graph.getNode(button.id)?.events?.onClick).toEqual(actions)
  })

  test('persists toggleMotion and bounded awaitMotion controls', () => {
    const { figma, graph } = setupToolTest()
    const button = figma.createRectangle()
    const actions = [
      { id: 'toggle-1', kind: 'toggleMotion', targetNodeId: 'animated-node' },
      {
        id: 'await-1',
        kind: 'awaitMotion',
        targetNodeId: 'animated-node',
        trackId: 'page-exit',
        timeoutMs: 2_000,
        stopOnTimeout: true
      }
    ]

    expect(updateEvents(button.id, { onClick: actions }, figma).ok).toBe(true)
    expect(graph.getNode(button.id)?.events?.onClick).toEqual(actions)

    const invalid = updateEvents(
      button.id,
      {
        onClick: [
          {
            id: 'await-invalid',
            kind: 'awaitMotion',
            targetNodeId: 'animated-node',
            timeoutMs: 120_001
          }
        ]
      },
      figma
    )
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.error).toContain('.timeoutMs')
  })

  test('rejects missing targets and empty explicit track ids', () => {
    const { figma } = setupToolTest()
    const button = figma.createRectangle()

    const missingTarget = updateEvents(
      button.id,
      { onClick: [{ id: 'play-1', kind: 'playMotion' }] },
      figma
    )
    expect(missingTarget.ok).toBe(false)
    if (!missingTarget.ok) expect(missingTarget.error).toContain('.targetNodeId')

    const emptyTrack = updateEvents(
      button.id,
      {
        onClick: [{ id: 'stop-1', kind: 'stopMotion', targetNodeId: 'animated-node', trackId: '' }]
      },
      figma
    )
    expect(emptyTrack.ok).toBe(false)
    if (!emptyTrack.ok) expect(emptyTrack.error).toContain('.trackId')
  })
})
