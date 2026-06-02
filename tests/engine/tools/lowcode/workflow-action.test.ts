import { describe, expect, test } from 'bun:test'

import { getTool, setupToolTest } from '#tests/helpers/tools'

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string }

/**
 * Phase 3 §10 — workflow-orchestration action tool-boundary validation:
 * `condition` (recursive then/else validation, JSON-path error reporting),
 * `delay` (ms validation), `stop`. The tool surface is how AI / MCP / CLI
 * author workflows (GUI authoring panel is deferred).
 */
function update(
  id: string,
  events: Record<string, unknown>,
  figma: ReturnType<typeof setupToolTest>['figma']
): Result<{ id: string; updated: string[] }> {
  return getTool('update_lowcode_node').execute(figma, {
    id,
    patch_json: JSON.stringify({ events })
  }) as Result<{ id: string; updated: string[] }>
}

describe('update_lowcode_node — workflow actions (Phase 3 §10)', () => {
  test('persists a condition with nested then / else branches', () => {
    const { figma, graph } = setupToolTest()
    const btn = figma.createRectangle()
    const action = {
      id: 'c-1',
      kind: 'condition',
      condExpr: 'count > 0',
      consequent: [{ id: 't-1', kind: 'navigate', to: '/yes' }],
      alternate: [
        { id: 'e-1', kind: 'delay', ms: 200 },
        { id: 'e-2', kind: 'stop' }
      ]
    }
    const result = update(btn.id, { onClick: [action] }, figma)
    expect(result.ok).toBe(true)
    expect(graph.getNode(btn.id)?.events?.onClick?.[0]).toEqual(action)
  })

  test('persists a delay and a stop', () => {
    const { figma, graph } = setupToolTest()
    const btn = figma.createRectangle()
    const actions = [
      { id: 'd-1', kind: 'delay', ms: 500 },
      { id: 's-1', kind: 'stop' }
    ]
    const result = update(btn.id, { onClick: actions }, figma)
    expect(result.ok).toBe(true)
    expect(graph.getNode(btn.id)?.events?.onClick).toEqual(actions)
  })

  test('rejects a condition whose then is not an array', () => {
    const { figma } = setupToolTest()
    const btn = figma.createRectangle()
    const result = update(
      btn.id,
      { onClick: [{ id: 'c-1', kind: 'condition', condExpr: 'x', consequent: 'nope' }] },
      figma
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('.consequent')
  })

  test('rejects a nested action with a bad kind, reporting the JSON path', () => {
    const { figma } = setupToolTest()
    const btn = figma.createRectangle()
    const result = update(
      btn.id,
      {
        onClick: [
          {
            id: 'c-1',
            kind: 'condition',
            condExpr: 'x',
            consequent: [{ id: 'bad', kind: 'frobnicate' }]
          }
        ]
      },
      figma
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('.consequent[0]')
  })

  test('rejects a delay with a negative ms', () => {
    const { figma } = setupToolTest()
    const btn = figma.createRectangle()
    const result = update(btn.id, { onClick: [{ id: 'd-1', kind: 'delay', ms: -5 }] }, figma)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('.ms')
  })
})
