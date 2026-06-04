import { beforeAll, describe, expect, test } from 'bun:test'

import { SceneGraph, initCodec } from '@open-pencil/core'
import type { ActionDef } from '@open-pencil/core/scene-graph'

import { collectTree } from '#compiler/ir/collect/tree'
import type {
  IRClipboardHandler,
  IRConditionalHandler,
  IRConfirmHandler,
  IREventHandler,
  IRToastHandler
} from '#compiler/ir/types'

/**
 * Phase 3 §10 — workflow-orchestration collect: `condition` (recursive
 * then/else lowering + condExpr validation + docState read registration),
 * `delay` (ms validation), `stop`. Mirrors the Phase 3 §2 supabase collect
 * test layout.
 */
describe('collect workflow IR (Phase 3 §10)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  function makeGraph(opts: {
    docStates?: { id: string; name: string; type: 'string' | 'object'; defaultValue: unknown }[]
    onClick?: ActionDef[]
    workflows?: { id: string; name: string; params?: string[]; actions: ActionDef[] }[]
  }): { graph: SceneGraph; pageId: string } {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: opts.docStates ?? [],
      ...(opts.workflows ? { lowcodeWorkflows: opts.workflows } : {})
    })
    const page = graph.getPages()[0]
    if (opts.onClick) graph.createNode('BUTTON', page.id, { events: { onClick: opts.onClick } })
    return { graph, pageId: page.id }
  }

  function onClickHandlers(graph: SceneGraph, pageId: string): IREventHandler[] {
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (!button || button.kind !== 'element') throw new Error('expected element')
    return button.events?.onClick ?? []
  }

  test('condition lowers then/else branches recursively', () => {
    const { graph, pageId } = makeGraph({
      docStates: [{ id: 'd1', name: 'loaded', type: 'string', defaultValue: '' }],
      onClick: [
        {
          id: 'c1',
          kind: 'condition',
          condExpr: 'loaded',
          consequent: [{ id: 'n1', kind: 'navigate', to: '/yes' }],
          alternate: [{ id: 's1', kind: 'setVariable', targetName: 'loaded', valueExpr: '"done"' }]
        }
      ]
    })
    const handlers = onClickHandlers(graph, pageId)
    expect(handlers).toHaveLength(1)
    const cond = handlers[0] as IRConditionalHandler
    expect(cond.kind).toBe('condition')
    expect(cond.condAst).toEqual({ kind: 'ident', name: 'loaded' })
    expect(cond.consequent).toEqual([{ kind: 'navigate', to: '/yes' }])
    expect(cond.alternate?.[0].kind).toBe('setVariable')
  })

  test('condition condExpr referencing a docState registers a read', () => {
    const { graph, pageId } = makeGraph({
      docStates: [{ id: 'd1', name: 'profile', type: 'object', defaultValue: null }],
      onClick: [
        {
          id: 'c1',
          kind: 'condition',
          condExpr: 'profile',
          consequent: [{ id: 'st', kind: 'stop' }]
        }
      ]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.docStateReads).toContain('profile')
    const handlers = onClickHandlers(graph, pageId)
    const cond = handlers[0] as IRConditionalHandler
    expect(cond.consequent).toEqual([{ kind: 'stop' }])
    expect(cond.alternate).toBeUndefined()
  })

  test('nested supabaseMutation inside a condition registers its result write', () => {
    const { graph, pageId } = makeGraph({
      docStates: [
        { id: 'd1', name: 'flag', type: 'string', defaultValue: '' },
        { id: 'd2', name: 'res', type: 'object', defaultValue: null }
      ],
      onClick: [
        {
          id: 'c1',
          kind: 'condition',
          condExpr: 'flag',
          consequent: [
            {
              id: 'm1',
              kind: 'supabaseMutation',
              operation: 'insert',
              table: 'logs',
              payloadJson: '{"event":"x"}',
              resultTarget: 'res'
            }
          ]
        }
      ]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.docStateWrites).toContain('res')
  })

  test('condition with empty condExpr is dropped with a warning', () => {
    const { graph, pageId } = makeGraph({
      onClick: [{ id: 'c1', kind: 'condition', condExpr: '', consequent: [] }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.children[0].kind === 'element' && ir.children[0].events?.onClick).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'action-condition-missing-expression')).toBe(true)
  })

  test('condition with unparseable condExpr is dropped with a warning', () => {
    const { graph, pageId } = makeGraph({
      onClick: [{ id: 'c1', kind: 'condition', condExpr: ')(', consequent: [] }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-condition-invalid-expression')).toBe(true)
  })

  test('delay with a valid ms produces an IRDelayHandler', () => {
    const { graph, pageId } = makeGraph({
      onClick: [{ id: 'd', kind: 'delay', ms: 750 }]
    })
    const handlers = onClickHandlers(graph, pageId)
    expect(handlers).toEqual([{ kind: 'delay', ms: 750 }])
  })

  test('delay with a negative / non-finite ms is dropped with a warning', () => {
    const { graph, pageId } = makeGraph({
      onClick: [{ id: 'd', kind: 'delay', ms: -1 }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-delay-invalid-ms')).toBe(true)
  })

  test('stop produces an IRStopHandler', () => {
    const { graph, pageId } = makeGraph({
      onClick: [{ id: 's', kind: 'stop' }]
    })
    expect(onClickHandlers(graph, pageId)).toEqual([{ kind: 'stop' }])
  })

  // Phase 3 §10 v2 — toast.
  test('toast lowers messageExpr to an IRToastHandler (default variant info)', () => {
    const { graph, pageId } = makeGraph({
      onClick: [{ id: 't', kind: 'toast', messageExpr: '"Saved"' }]
    })
    expect(onClickHandlers(graph, pageId)).toEqual([
      { kind: 'toast', ast: { kind: 'string', value: 'Saved' }, references: [], variant: 'info' }
    ])
  })

  test('toast carries an explicit variant', () => {
    const { graph, pageId } = makeGraph({
      onClick: [{ id: 't', kind: 'toast', messageExpr: '"Oops"', variant: 'error' }]
    })
    const handlers = onClickHandlers(graph, pageId)
    expect(handlers[0]).toMatchObject({ kind: 'toast', variant: 'error' })
  })

  test('toast messageExpr referencing a docState registers a read', () => {
    const { graph, pageId } = makeGraph({
      docStates: [{ id: 'd1', name: 'userName', type: 'string', defaultValue: '' }],
      onClick: [{ id: 't', kind: 'toast', messageExpr: 'userName' }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.docStateReads).toContain('userName')
    const handlers = onClickHandlers(graph, pageId)
    expect(handlers[0]).toMatchObject({ kind: 'toast', references: ['userName'] })
  })

  test('an empty messageExpr drops the toast with a warning', () => {
    const { graph, pageId } = makeGraph({
      onClick: [{ id: 't', kind: 'toast', messageExpr: '   ' }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-toast-missing-message')).toBe(true)
    expect(onClickHandlers(graph, pageId)).toEqual([])
  })

  test('an unparseable messageExpr drops the toast with a warning', () => {
    const { graph, pageId } = makeGraph({
      onClick: [{ id: 't', kind: 'toast', messageExpr: ')(' }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-toast-invalid-message')).toBe(true)
  })

  // Phase 3 §10 v3 — confirm + clipboard.
  test('confirm lowers messageExpr + recursive then/else branches', () => {
    const { graph, pageId } = makeGraph({
      onClick: [
        {
          id: 'cf',
          kind: 'confirm',
          messageExpr: '"Delete?"',
          consequent: [{ id: 'n1', kind: 'navigate', to: '/gone' }],
          alternate: [{ id: 't1', kind: 'toast', messageExpr: '"Kept"' }]
        }
      ]
    })
    const handlers = onClickHandlers(graph, pageId)
    expect(handlers).toHaveLength(1)
    const confirm = handlers[0] as IRConfirmHandler
    expect(confirm.kind).toBe('confirm')
    expect(confirm.ast).toEqual({ kind: 'string', value: 'Delete?' })
    expect(confirm.consequent).toEqual([{ kind: 'navigate', to: '/gone' }])
    expect(confirm.alternate?.[0].kind).toBe('toast')
  })

  test('confirm with no cancel branch leaves alternate undefined', () => {
    const { graph, pageId } = makeGraph({
      onClick: [
        { id: 'cf', kind: 'confirm', messageExpr: '"Sure?"', consequent: [{ id: 's', kind: 'stop' }] }
      ]
    })
    const confirm = onClickHandlers(graph, pageId)[0] as IRConfirmHandler
    expect(confirm.consequent).toEqual([{ kind: 'stop' }])
    expect(confirm.alternate).toBeUndefined()
  })

  test('confirm messageExpr referencing a docState registers a read', () => {
    const { graph, pageId } = makeGraph({
      docStates: [{ id: 'd1', name: 'rowName', type: 'string', defaultValue: '' }],
      onClick: [
        { id: 'cf', kind: 'confirm', messageExpr: 'rowName', consequent: [{ id: 's', kind: 'stop' }] }
      ]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.docStateReads).toContain('rowName')
  })

  test('nested supabaseMutation inside a confirm registers its result write (rls descent)', () => {
    const { graph, pageId } = makeGraph({
      docStates: [{ id: 'd2', name: 'res', type: 'object', defaultValue: null }],
      onClick: [
        {
          id: 'cf',
          kind: 'confirm',
          messageExpr: '"Insert?"',
          consequent: [
            {
              id: 'm1',
              kind: 'supabaseMutation',
              operation: 'insert',
              table: 'logs',
              payloadJson: '{"event":"x"}',
              resultTarget: 'res'
            }
          ]
        }
      ]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.docStateWrites).toContain('res')
  })

  test('an empty confirm messageExpr drops the confirm with a warning', () => {
    const { graph, pageId } = makeGraph({
      onClick: [{ id: 'cf', kind: 'confirm', messageExpr: '   ', consequent: [] }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-confirm-missing-message')).toBe(true)
    expect(onClickHandlers(graph, pageId)).toEqual([])
  })

  test('clipboard lowers valueExpr to an IRClipboardHandler', () => {
    const { graph, pageId } = makeGraph({
      onClick: [{ id: 'cb', kind: 'clipboard', valueExpr: '"link"' }]
    })
    expect(onClickHandlers(graph, pageId)).toEqual([
      { kind: 'clipboard', ast: { kind: 'string', value: 'link' }, references: [] }
    ])
  })

  test('clipboard valueExpr referencing a docState registers a read', () => {
    const { graph, pageId } = makeGraph({
      docStates: [{ id: 'd1', name: 'shareUrl', type: 'string', defaultValue: '' }],
      onClick: [{ id: 'cb', kind: 'clipboard', valueExpr: 'shareUrl' }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.docStateReads).toContain('shareUrl')
    const clip = onClickHandlers(graph, pageId)[0] as IRClipboardHandler
    expect(clip.references).toEqual(['shareUrl'])
  })

  test('an empty clipboard valueExpr drops the action with a warning', () => {
    const { graph, pageId } = makeGraph({
      onClick: [{ id: 'cb', kind: 'clipboard', valueExpr: '  ' }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-clipboard-missing-value')).toBe(true)
    expect(onClickHandlers(graph, pageId)).toEqual([])
  })

  // ── Phase 3 §10 v4: named WorkflowDef (inline callWorkflow expansion) ──

  test('callWorkflow expands the workflow chain inline at the call site', () => {
    const { graph, pageId } = makeGraph({
      workflows: [
        {
          id: 'wf1',
          name: 'Notify & go',
          actions: [
            { id: 't1', kind: 'toast', messageExpr: '"Saved"', variant: 'success' },
            { id: 'n1', kind: 'navigate', to: '/done' }
          ]
        }
      ],
      onClick: [{ id: 'cw', kind: 'callWorkflow', workflowId: 'wf1' }]
    })
    // The single callWorkflow becomes the workflow's two handlers spliced in.
    expect(onClickHandlers(graph, pageId)).toEqual([
      { kind: 'toast', ast: { kind: 'string', value: 'Saved' }, references: [], variant: 'success' },
      { kind: 'navigate', to: '/done' }
    ])
  })

  test('callWorkflow splices around sibling actions in chain order', () => {
    const { graph, pageId } = makeGraph({
      workflows: [{ id: 'wf1', name: 'mid', actions: [{ id: 'n', kind: 'navigate', to: '/mid' }] }],
      onClick: [
        { id: 'a', kind: 'navigate', to: '/a' },
        { id: 'cw', kind: 'callWorkflow', workflowId: 'wf1' },
        { id: 'b', kind: 'navigate', to: '/b' }
      ]
    })
    expect(onClickHandlers(graph, pageId)).toEqual([
      { kind: 'navigate', to: '/a' },
      { kind: 'navigate', to: '/mid' },
      { kind: 'navigate', to: '/b' }
    ])
  })

  test('a workflow docState write registers through the caller context', () => {
    const { graph, pageId } = makeGraph({
      docStates: [{ id: 'd1', name: 'count', type: 'string', defaultValue: '' }],
      workflows: [
        {
          id: 'wf1',
          name: 'bump',
          actions: [{ id: 's', kind: 'setVariable', targetName: 'count', valueExpr: '"x"' }]
        }
      ],
      onClick: [{ id: 'cw', kind: 'callWorkflow', workflowId: 'wf1' }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.docStateWrites).toContain('count')
  })

  test('nested callWorkflow (wf calls wf) expands across levels', () => {
    const { graph, pageId } = makeGraph({
      workflows: [
        { id: 'wf2', name: 'inner', actions: [{ id: 'n2', kind: 'navigate', to: '/inner' }] },
        {
          id: 'wf1',
          name: 'outer',
          actions: [
            { id: 'n1', kind: 'navigate', to: '/outer' },
            { id: 'cw2', kind: 'callWorkflow', workflowId: 'wf2' }
          ]
        }
      ],
      onClick: [{ id: 'cw1', kind: 'callWorkflow', workflowId: 'wf1' }]
    })
    expect(onClickHandlers(graph, pageId)).toEqual([
      { kind: 'navigate', to: '/outer' },
      { kind: 'navigate', to: '/inner' }
    ])
  })

  test('a workflow cycle (A → B → A) is detected and dropped with a warning', () => {
    const { graph, pageId } = makeGraph({
      workflows: [
        {
          id: 'wfA',
          name: 'A',
          actions: [
            { id: 'na', kind: 'navigate', to: '/a' },
            { id: 'cwb', kind: 'callWorkflow', workflowId: 'wfB' }
          ]
        },
        {
          id: 'wfB',
          name: 'B',
          actions: [
            { id: 'nb', kind: 'navigate', to: '/b' },
            { id: 'cwa', kind: 'callWorkflow', workflowId: 'wfA' }
          ]
        }
      ],
      onClick: [{ id: 'cw', kind: 'callWorkflow', workflowId: 'wfA' }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-call-workflow-cycle')).toBe(true)
    // The cycle is cut, but the non-recursive prefix still expands.
    expect(onClickHandlers(graph, pageId)).toEqual([
      { kind: 'navigate', to: '/a' },
      { kind: 'navigate', to: '/b' }
    ])
  })

  test('an unknown workflowId is dropped with a warning', () => {
    const { graph, pageId } = makeGraph({
      onClick: [{ id: 'cw', kind: 'callWorkflow', workflowId: 'ghost' }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-call-workflow-unknown')).toBe(true)
    expect(onClickHandlers(graph, pageId)).toEqual([])
  })

  test('a missing workflowId is dropped with a warning', () => {
    const { graph, pageId } = makeGraph({
      onClick: [{ id: 'cw', kind: 'callWorkflow' }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-call-workflow-missing-id')).toBe(true)
    expect(onClickHandlers(graph, pageId)).toEqual([])
  })

  test('callWorkflow nested inside a condition branch expands within the branch', () => {
    const { graph, pageId } = makeGraph({
      docStates: [{ id: 'd1', name: 'ok', type: 'string', defaultValue: '' }],
      workflows: [{ id: 'wf1', name: 'go', actions: [{ id: 'n', kind: 'navigate', to: '/go' }] }],
      onClick: [
        {
          id: 'c1',
          kind: 'condition',
          condExpr: 'ok',
          consequent: [{ id: 'cw', kind: 'callWorkflow', workflowId: 'wf1' }]
        }
      ]
    })
    const cond = onClickHandlers(graph, pageId)[0] as IRConditionalHandler
    expect(cond.kind).toBe('condition')
    expect(cond.consequent).toEqual([{ kind: 'navigate', to: '/go' }])
  })

  // ── Phase 3 §10 v5: toast position/duration + confirm labels carry to IR ──

  test('toast position + durationMs carry to the IR handler', () => {
    const { graph, pageId } = makeGraph({
      onClick: [
        {
          id: 't',
          kind: 'toast',
          messageExpr: '"Saved"',
          variant: 'success',
          position: 'top-center',
          durationMs: 5000
        }
      ]
    })
    const toast = onClickHandlers(graph, pageId)[0] as IRToastHandler
    expect(toast.position).toBe('top-center')
    expect(toast.durationMs).toBe(5000)
  })

  test('an invalid toast durationMs warns but keeps the toast (default applied)', () => {
    const { graph, pageId } = makeGraph({
      onClick: [{ id: 't', kind: 'toast', messageExpr: '"Hi"', durationMs: -5 }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-toast-invalid-duration')).toBe(true)
    const toast = onClickHandlers(graph, pageId)[0] as IRToastHandler
    expect(toast.kind).toBe('toast')
    expect(toast.durationMs).toBeUndefined()
  })

  test('confirm custom labels carry to the IR handler', () => {
    const { graph, pageId } = makeGraph({
      onClick: [
        {
          id: 'cf',
          kind: 'confirm',
          messageExpr: '"Delete?"',
          consequent: [{ id: 's', kind: 'stop' }],
          confirmLabel: 'Delete',
          cancelLabel: 'Keep'
        }
      ]
    })
    const confirm = onClickHandlers(graph, pageId)[0] as IRConfirmHandler
    expect(confirm.confirmLabel).toBe('Delete')
    expect(confirm.cancelLabel).toBe('Keep')
  })

  // ── Phase 3 §10 v6: workflow parameters — callWorkflow args substitution ──

  test('a literal arg is substituted for the parameter identifier in the body', () => {
    const { graph, pageId } = makeGraph({
      workflows: [
        { id: 'notify', name: 'Notify', params: ['msg'], actions: [{ id: 't', kind: 'toast', messageExpr: 'msg' }] }
      ],
      onClick: [{ id: 'cw', kind: 'callWorkflow', workflowId: 'notify', args: { msg: '"Saved!"' } }]
    })
    const toast = onClickHandlers(graph, pageId)[0] as IRToastHandler
    expect(toast.kind).toBe('toast')
    expect(toast.ast).toEqual({ kind: 'string', value: 'Saved!' })
    expect(toast.references).toEqual([])
  })

  test('an expression arg is substituted whole (member/binary)', () => {
    const { graph, pageId } = makeGraph({
      docStates: [{ id: 'd1', name: 'user', type: 'object', defaultValue: {} }],
      workflows: [
        { id: 'greet', name: 'Greet', params: ['who'], actions: [{ id: 't', kind: 'toast', messageExpr: 'who' }] }
      ],
      onClick: [{ id: 'cw', kind: 'callWorkflow', workflowId: 'greet', args: { who: 'user.email' } }]
    })
    const toast = onClickHandlers(graph, pageId)[0] as IRToastHandler
    expect(toast.ast).toEqual({ kind: 'member', object: { kind: 'ident', name: 'user' }, property: 'email' })
    expect(toast.references).toEqual(['user'])
  })

  test('a docState referenced by an arg registers a read through the caller', () => {
    const { graph, pageId } = makeGraph({
      docStates: [{ id: 'd1', name: 'status', type: 'string', defaultValue: '' }],
      workflows: [
        { id: 'notify', name: 'Notify', params: ['msg'], actions: [{ id: 't', kind: 'toast', messageExpr: 'msg' }] }
      ],
      onClick: [{ id: 'cw', kind: 'callWorkflow', workflowId: 'notify', args: { msg: 'status' } }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.docStateReads).toContain('status')
  })

  test('nested workflow arg referencing the outer parameter resolves at the outer boundary', () => {
    const { graph, pageId } = makeGraph({
      workflows: [
        { id: 'inner', name: 'inner', params: ['q'], actions: [{ id: 't', kind: 'toast', messageExpr: 'q' }] },
        {
          id: 'outer',
          name: 'outer',
          params: ['p'],
          actions: [{ id: 'cw2', kind: 'callWorkflow', workflowId: 'inner', args: { q: 'p' } }]
        }
      ],
      onClick: [{ id: 'cw1', kind: 'callWorkflow', workflowId: 'outer', args: { p: '"hi"' } }]
    })
    const toast = onClickHandlers(graph, pageId)[0] as IRToastHandler
    // inner's `q` → outer's `p` → caller's "hi" — outermost boundary collapses it.
    expect(toast.ast).toEqual({ kind: 'string', value: 'hi' })
  })

  test('a missing argument drops the whole callWorkflow with a warning', () => {
    const { graph, pageId } = makeGraph({
      workflows: [
        { id: 'notify', name: 'Notify', params: ['msg'], actions: [{ id: 't', kind: 'toast', messageExpr: 'msg' }] }
      ],
      onClick: [{ id: 'cw', kind: 'callWorkflow', workflowId: 'notify' }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-call-workflow-missing-arg')).toBe(true)
    expect(onClickHandlers(graph, pageId)).toEqual([])
  })

  test('an extra arg (not a parameter) warns but still expands', () => {
    const { graph, pageId } = makeGraph({
      workflows: [{ id: 'wf', name: 'go', params: [], actions: [{ id: 'n', kind: 'navigate', to: '/go' }] }],
      onClick: [{ id: 'cw', kind: 'callWorkflow', workflowId: 'wf', args: { stray: '"x"' } }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-call-workflow-extra-arg')).toBe(true)
    expect(onClickHandlers(graph, pageId)).toEqual([{ kind: 'navigate', to: '/go' }])
  })

  test('an arg referencing an unknown identifier drops the callWorkflow with a warning', () => {
    const { graph, pageId } = makeGraph({
      workflows: [
        { id: 'notify', name: 'Notify', params: ['msg'], actions: [{ id: 't', kind: 'toast', messageExpr: 'msg' }] }
      ],
      onClick: [{ id: 'cw', kind: 'callWorkflow', workflowId: 'notify', args: { msg: 'ghost' } }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-call-workflow-arg-unknown-identifier')).toBe(true)
    expect(onClickHandlers(graph, pageId)).toEqual([])
  })

  test('a parameterless workflow + no args is byte-identical to §10 v4 (no substitution)', () => {
    const { graph, pageId } = makeGraph({
      workflows: [{ id: 'wf', name: 'go', actions: [{ id: 'n', kind: 'navigate', to: '/go' }] }],
      onClick: [{ id: 'cw', kind: 'callWorkflow', workflowId: 'wf' }]
    })
    expect(onClickHandlers(graph, pageId)).toEqual([{ kind: 'navigate', to: '/go' }])
  })
})
