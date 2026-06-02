import { beforeAll, describe, expect, test } from 'bun:test'

import { SceneGraph, initCodec } from '@open-pencil/core'
import type { ActionDef } from '@open-pencil/core/scene-graph'

import { collectTree } from '#compiler/ir/collect/tree'
import type { IRConditionalHandler, IREventHandler } from '#compiler/ir/types'

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
  }): { graph: SceneGraph; pageId: string } {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, { lowcodeDocumentState: opts.docStates ?? [] })
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
})
