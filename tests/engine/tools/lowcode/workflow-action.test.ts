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

  // Phase 3 §10 v2 — toast.
  test('persists a toast with messageExpr + variant', () => {
    const { figma, graph } = setupToolTest()
    const btn = figma.createRectangle()
    const action = { id: 'to-1', kind: 'toast', messageExpr: '"Saved"', variant: 'success' }
    const result = update(btn.id, { onClick: [action] }, figma)
    expect(result.ok).toBe(true)
    expect(graph.getNode(btn.id)?.events?.onClick?.[0]).toEqual(action)
  })

  test('rejects a toast with an unknown variant', () => {
    const { figma } = setupToolTest()
    const btn = figma.createRectangle()
    const result = update(
      btn.id,
      { onClick: [{ id: 'to-1', kind: 'toast', messageExpr: '"x"', variant: 'warning' }] },
      figma
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('.variant')
  })

  test('rejects a toast whose messageExpr is not a string', () => {
    const { figma } = setupToolTest()
    const btn = figma.createRectangle()
    const result = update(
      btn.id,
      { onClick: [{ id: 'to-1', kind: 'toast', messageExpr: 42 }] },
      figma
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('.messageExpr')
  })

  // Phase 3 §10 v3 — confirm + clipboard.
  test('persists a confirm with messageExpr + recursive then / else branches', () => {
    const { figma, graph } = setupToolTest()
    const btn = figma.createRectangle()
    const action = {
      id: 'cf-1',
      kind: 'confirm',
      messageExpr: '"Delete?"',
      consequent: [{ id: 'n-1', kind: 'navigate', to: '/gone' }],
      alternate: [{ id: 'cb-1', kind: 'clipboard', valueExpr: '"x"' }]
    }
    const result = update(btn.id, { onClick: [action] }, figma)
    expect(result.ok).toBe(true)
    expect(graph.getNode(btn.id)?.events?.onClick?.[0]).toEqual(action)
  })

  test('rejects a confirm whose consequent is not an array, reporting the path', () => {
    const { figma } = setupToolTest()
    const btn = figma.createRectangle()
    const result = update(
      btn.id,
      { onClick: [{ id: 'cf-1', kind: 'confirm', messageExpr: '"x"', consequent: 'nope' }] },
      figma
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('.consequent')
  })

  test('rejects a confirm action nested in another confirm with a bad kind, reporting the JSON path', () => {
    const { figma } = setupToolTest()
    const btn = figma.createRectangle()
    const result = update(
      btn.id,
      {
        onClick: [
          {
            id: 'cf-1',
            kind: 'confirm',
            messageExpr: '"x"',
            consequent: [{ id: 'bad', kind: 'frobnicate' }]
          }
        ]
      },
      figma
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('.consequent[0]')
  })

  test('persists a clipboard action and rejects a non-string valueExpr', () => {
    const { figma, graph } = setupToolTest()
    const btn = figma.createRectangle()
    const action = { id: 'cb-1', kind: 'clipboard', valueExpr: '"https://x.y"' }
    const ok = update(btn.id, { onClick: [action] }, figma)
    expect(ok.ok).toBe(true)
    expect(graph.getNode(btn.id)?.events?.onClick?.[0]).toEqual(action)

    const bad = update(
      btn.id,
      { onClick: [{ id: 'cb-2', kind: 'clipboard', valueExpr: 7 }] },
      figma
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('.valueExpr')
  })

  test('persists a callWorkflow action and rejects a non-string workflowId', () => {
    const { figma, graph } = setupToolTest()
    const btn = figma.createRectangle()
    const action = { id: 'cw-1', kind: 'callWorkflow', workflowId: 'wf-1' }
    const ok = update(btn.id, { onClick: [action] }, figma)
    expect(ok.ok).toBe(true)
    expect(graph.getNode(btn.id)?.events?.onClick?.[0]).toEqual(action)

    const bad = update(
      btn.id,
      { onClick: [{ id: 'cw-2', kind: 'callWorkflow', workflowId: 9 }] },
      figma
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('.workflowId')
  })

  // ── Phase 3 §10 v6: callWorkflow args ──

  test('persists callWorkflow args and rejects malformed args', () => {
    const { figma, graph } = setupToolTest()
    const btn = figma.createRectangle()
    const action = { id: 'cw-1', kind: 'callWorkflow', workflowId: 'wf-1', args: { msg: '"hi"' } }
    const ok = update(btn.id, { onClick: [action] }, figma)
    expect(ok.ok).toBe(true)
    expect(graph.getNode(btn.id)?.events?.onClick?.[0]).toEqual(action)

    const notObj = update(
      btn.id,
      { onClick: [{ id: 'c', kind: 'callWorkflow', workflowId: 'w', args: 'x' }] },
      figma
    )
    expect(notObj.ok).toBe(false)
    if (!notObj.ok) expect(notObj.error).toContain('.args')

    const badVal = update(
      btn.id,
      { onClick: [{ id: 'c', kind: 'callWorkflow', workflowId: 'w', args: { p: 5 } }] },
      figma
    )
    expect(badVal.ok).toBe(false)
    if (!badVal.ok) expect(badVal.error).toContain('.args.p')
  })

  // ── Phase 3 §10 v5: toast position/duration + confirm labels ──

  test('persists a toast with position + durationMs', () => {
    const { figma, graph } = setupToolTest()
    const btn = figma.createRectangle()
    const action = {
      id: 't-1',
      kind: 'toast',
      messageExpr: '"Saved"',
      variant: 'success',
      position: 'top-center',
      durationMs: 5000
    }
    const ok = update(btn.id, { onClick: [action] }, figma)
    expect(ok.ok).toBe(true)
    expect(graph.getNode(btn.id)?.events?.onClick?.[0]).toEqual(action)
  })

  test('rejects an invalid toast position and an invalid durationMs', () => {
    const { figma } = setupToolTest()
    const btn = figma.createRectangle()
    const badPos = update(
      btn.id,
      { onClick: [{ id: 't', kind: 'toast', messageExpr: '"x"', position: 'middle' }] },
      figma
    )
    expect(badPos.ok).toBe(false)
    if (!badPos.ok) expect(badPos.error).toContain('.position')

    const badMs = update(
      btn.id,
      { onClick: [{ id: 't', kind: 'toast', messageExpr: '"x"', durationMs: -1 }] },
      figma
    )
    expect(badMs.ok).toBe(false)
    if (!badMs.ok) expect(badMs.error).toContain('.durationMs')
  })

  test('persists confirm custom labels and rejects a non-string label', () => {
    const { figma, graph } = setupToolTest()
    const btn = figma.createRectangle()
    const action = {
      id: 'cf-1',
      kind: 'confirm',
      messageExpr: '"Delete?"',
      consequent: [{ id: 's', kind: 'stop' }],
      confirmLabel: 'Delete',
      cancelLabel: 'Keep'
    }
    const ok = update(btn.id, { onClick: [action] }, figma)
    expect(ok.ok).toBe(true)
    expect(graph.getNode(btn.id)?.events?.onClick?.[0]).toEqual(action)

    const bad = update(
      btn.id,
      {
        onClick: [
          { id: 'cf-2', kind: 'confirm', messageExpr: '"x"', consequent: [], confirmLabel: 7 }
        ]
      },
      figma
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('.confirmLabel')
  })
})

/** Phase 3 §10 v4: the `set_workflows` / `read_workflows` document-level tools
 *  that author named, reusable workflows on the root node. */
function setWorkflows(
  json: string,
  figma: ReturnType<typeof setupToolTest>['figma']
): Result<{ workflows: number; actions: number }> {
  return getTool('set_workflows').execute(figma, { workflows_json: json }) as Result<{
    workflows: number
    actions: number
  }>
}

describe('set_workflows / read_workflows (Phase 3 §10 v4)', () => {
  test('persists workflows on the root and reads them back', () => {
    const { figma, graph } = setupToolTest()
    const workflows = [
      {
        id: 'wf-1',
        name: 'Save',
        actions: [
          { id: 'a1', kind: 'toast', messageExpr: '"Saved"', variant: 'success' },
          { id: 'a2', kind: 'navigate', to: '/done' }
        ]
      }
    ]
    const r = setWorkflows(JSON.stringify(workflows), figma)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toEqual({ workflows: 1, actions: 2 })
    expect(graph.getNode(graph.rootId)?.lowcodeWorkflows).toEqual(workflows)

    const read = getTool('read_workflows').execute(figma, {}) as Result<typeof workflows>
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.data).toEqual(workflows)
  })

  test('persists workflow params and rejects bad / duplicate params (§10 v6)', () => {
    const { figma, graph } = setupToolTest()
    const workflows = [{ id: 'wf-1', name: 'Notify', params: ['msg', 'kind'], actions: [] }]
    const r = setWorkflows(JSON.stringify(workflows), figma)
    expect(r.ok).toBe(true)
    expect(graph.getNode(graph.rootId)?.lowcodeWorkflows).toEqual(workflows)

    const badParam = setWorkflows(
      JSON.stringify([{ id: 'w', name: 'a', params: ['$prev'], actions: [] }]),
      figma
    )
    expect(badParam.ok).toBe(false)
    if (!badParam.ok) expect(badParam.error).toContain('.params[0]')

    const dupParam = setWorkflows(
      JSON.stringify([{ id: 'w', name: 'a', params: ['x', 'x'], actions: [] }]),
      figma
    )
    expect(dupParam.ok).toBe(false)
    if (!dupParam.ok) expect(dupParam.error).toContain('duplicated')
  })

  test('persists workflow pageId and rejects malformed pageId (§10 phase 4)', () => {
    const { figma, graph } = setupToolTest()
    const pageId = graph.getPages()[0].id
    const workflows = [{ id: 'wf-1', name: 'Scoped', pageId, actions: [] }]
    const r = setWorkflows(JSON.stringify(workflows), figma)
    expect(r.ok).toBe(true)
    expect(graph.getNode(graph.rootId)?.lowcodeWorkflows).toEqual(workflows)

    const bad = setWorkflows(
      JSON.stringify([{ id: 'wf-2', name: 'Bad', pageId: '', actions: [] }]),
      figma
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('.pageId')

    const unknown = setWorkflows(
      JSON.stringify([{ id: 'wf-3', name: 'Unknown', pageId: 'missing-page', actions: [] }]),
      figma
    )
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error).toContain('existing page')
  })

  test('persists workflow paramDefaults and rejects non-param keys / empty values (§10 v7)', () => {
    const { figma, graph } = setupToolTest()
    const workflows = [
      { id: 'wf-1', name: 'Notify', params: ['msg'], paramDefaults: { msg: '"Done"' }, actions: [] }
    ]
    const r = setWorkflows(JSON.stringify(workflows), figma)
    expect(r.ok).toBe(true)
    expect(graph.getNode(graph.rootId)?.lowcodeWorkflows).toEqual(workflows)

    const notParam = setWorkflows(
      JSON.stringify([
        { id: 'w', name: 'a', params: ['msg'], paramDefaults: { other: '"x"' }, actions: [] }
      ]),
      figma
    )
    expect(notParam.ok).toBe(false)
    if (!notParam.ok) expect(notParam.error).toContain('.paramDefaults.other')

    const emptyVal = setWorkflows(
      JSON.stringify([
        { id: 'w', name: 'a', params: ['msg'], paramDefaults: { msg: '  ' }, actions: [] }
      ]),
      figma
    )
    expect(emptyVal.ok).toBe(false)
    if (!emptyVal.ok) expect(emptyVal.error).toContain('.paramDefaults.msg')
  })

  test('persists workflow optionalParams and rejects non-param / duplicate entries (§10 v8)', () => {
    const { figma, graph } = setupToolTest()
    const workflows = [
      {
        id: 'wf-1',
        name: 'Notify',
        params: ['msg', 'detail'],
        optionalParams: ['detail'],
        actions: []
      }
    ]
    const r = setWorkflows(JSON.stringify(workflows), figma)
    expect(r.ok).toBe(true)
    expect(graph.getNode(graph.rootId)?.lowcodeWorkflows).toEqual(workflows)

    const notParam = setWorkflows(
      JSON.stringify([
        { id: 'w', name: 'a', params: ['msg'], optionalParams: ['ghost'], actions: [] }
      ]),
      figma
    )
    expect(notParam.ok).toBe(false)
    if (!notParam.ok) expect(notParam.error).toContain('.optionalParams[0]')

    const dup = setWorkflows(
      JSON.stringify([
        { id: 'w', name: 'a', params: ['msg'], optionalParams: ['msg', 'msg'], actions: [] }
      ]),
      figma
    )
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error).toContain('.optionalParams[1]')
  })

  test('validates nested actions recursively, reporting the JSON path', () => {
    const { figma } = setupToolTest()
    const r = setWorkflows(
      JSON.stringify([{ id: 'wf-1', name: 'x', actions: [{ id: 'bad', kind: 'frobnicate' }] }]),
      figma
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('workflows_json[0].actions[0]')
  })

  test('rejects a duplicate workflow id', () => {
    const { figma } = setupToolTest()
    const r = setWorkflows(
      JSON.stringify([
        { id: 'dup', name: 'a', actions: [] },
        { id: 'dup', name: 'b', actions: [] }
      ]),
      figma
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('duplicated')
  })

  test('rejects a missing id / non-string name', () => {
    const { figma } = setupToolTest()
    const noId = setWorkflows(JSON.stringify([{ name: 'a', actions: [] }]), figma)
    expect(noId.ok).toBe(false)
    if (!noId.ok) expect(noId.error).toContain('.id')

    const badName = setWorkflows(JSON.stringify([{ id: 'w', name: 7, actions: [] }]), figma)
    expect(badName.ok).toBe(false)
    if (!badName.ok) expect(badName.error).toContain('.name')
  })

  test('null and [] both clear all workflows', () => {
    const { figma, graph } = setupToolTest()
    setWorkflows(JSON.stringify([{ id: 'w', name: 'a', actions: [] }]), figma)
    const cleared = setWorkflows('null', figma)
    expect(cleared.ok).toBe(true)
    if (cleared.ok) expect(cleared.data).toEqual({ workflows: 0, actions: 0 })
    expect(graph.getNode(graph.rootId)?.lowcodeWorkflows).toBeUndefined()

    setWorkflows(JSON.stringify([{ id: 'w', name: 'a', actions: [] }]), figma)
    setWorkflows('[]', figma)
    expect(graph.getNode(graph.rootId)?.lowcodeWorkflows).toBeUndefined()
  })

  test('read_workflows returns [] when none authored', () => {
    const { figma } = setupToolTest()
    const read = getTool('read_workflows').execute(figma, {}) as Result<unknown[]>
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.data).toEqual([])
  })
})
