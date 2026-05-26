import { beforeAll, describe, expect, test } from 'bun:test'

import { SceneGraph, initCodec } from '@open-pencil/core'
import type { ActionDef, SupabaseConfig } from '@open-pencil/core/scene-graph'

import { emitEventHandler } from '@open-pencil/compiler/adapters/react/emit/event'
import { collectTree } from '#compiler/ir/collect/tree'
import type { IREventHandler, IRSupabaseMutationHandler } from '#compiler/ir/types'

/**
 * Phase 3 §3.v2 step 2 — `supabaseMutation.payloadEntries` IR collect +
 * React emit. Each entry binds a column to a value expression sharing the
 * same restricted sub-language as `SupabaseFilter.valueExpr`, so a
 * mutation can write controlled-INPUT-backed docState values directly
 * (the original `payloadJson` was JSON-literal-only and could not
 * interpolate state).
 */

const CONFIG: SupabaseConfig = { url: 'https://x.supabase.co', anonKey: 'anon-jwt' }

function setupGraph(opts: {
  docStates?: { id: string; name: string; type: 'string' | 'number'; defaultValue: unknown }[]
  onClick?: ActionDef[]
}): { graph: SceneGraph; pageId: string } {
  const graph = new SceneGraph()
  graph.updateNode(graph.rootId, {
    lowcodeSupabaseConfig: CONFIG,
    lowcodeDocumentState: opts.docStates ?? []
  })
  const page = graph.getPages()[0]
  if (opts.onClick) {
    graph.createNode('BUTTON', page.id, { events: { onClick: opts.onClick } })
  }
  return { graph, pageId: page.id }
}

function firstMutation(
  graph: SceneGraph,
  pageId: string
): IRSupabaseMutationHandler | undefined {
  const ir = collectTree(graph, pageId)
  const button = ir.children[0]
  if (!button || button.kind !== 'element') return undefined
  const handler = button.events?.onClick?.[0]
  return handler?.kind === 'supabaseMutation' ? handler : undefined
}

describe('IR collect supabaseMutation.payloadEntries (§3.v2 step 2)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('non-empty entries → resolved IRSupabasePayloadEntry[]; payload literal absent', () => {
    const { graph, pageId } = setupGraph({
      docStates: [
        { id: 'd-n', name: 'newName', type: 'string', defaultValue: '' },
        { id: 'd-a', name: 'newAge', type: 'number', defaultValue: 0 }
      ],
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseMutation',
          operation: 'insert',
          table: 'users',
          payloadEntries: [
            { key: 'name', valueExpr: 'newName' },
            { key: 'age', valueExpr: 'newAge' }
          ]
        }
      ]
    })
    const h = firstMutation(graph, pageId)
    expect(h?.payload).toBeUndefined()
    expect(h?.payloadEntries?.length).toBe(2)
    expect(h?.payloadEntries?.[0].key).toBe('name')
    expect(h?.payloadEntries?.[0].references).toContain('newName')
    expect(h?.payloadEntries?.[1].key).toBe('age')
  })

  test('both payloadEntries + payloadJson set → entries wins + payload-source-conflict warn', () => {
    const { graph, pageId } = setupGraph({
      docStates: [{ id: 'd-n', name: 'newName', type: 'string', defaultValue: '' }],
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseMutation',
          operation: 'insert',
          table: 'users',
          payloadJson: '{"name":"static"}',
          payloadEntries: [{ key: 'name', valueExpr: 'newName' }]
        }
      ]
    })
    const ir = collectTree(graph, pageId)
    const h = firstMutation(graph, pageId)
    expect(h?.payloadEntries?.length).toBe(1)
    expect(h?.payload).toBeUndefined()
    expect(
      ir.warnings.some(
        (w) => w.code === 'action-supabase-mutation-payload-source-conflict'
      )
    ).toBe(true)
  })

  test('delete + non-empty payloadEntries → dropped (unexpected-payload warn)', () => {
    const { graph, pageId } = setupGraph({
      docStates: [{ id: 'd-id', name: 'targetId', type: 'number', defaultValue: 0 }],
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseMutation',
          operation: 'delete',
          table: 'users',
          payloadEntries: [{ key: 'name', valueExpr: 'targetId' }],
          filters: [{ column: 'id', op: 'eq', valueExpr: 'targetId' }]
        }
      ]
    })
    const ir = collectTree(graph, pageId)
    expect(firstMutation(graph, pageId)).toBeUndefined()
    expect(
      ir.warnings.some((w) => w.code === 'action-supabase-mutation-unexpected-payload')
    ).toBe(true)
  })

  test('entry with non-identifier key → dropped (entry-invalid-key warn)', () => {
    const { graph, pageId } = setupGraph({
      docStates: [{ id: 'd-n', name: 'newName', type: 'string', defaultValue: '' }],
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseMutation',
          operation: 'insert',
          table: 'users',
          payloadEntries: [{ key: '1bad', valueExpr: 'newName' }]
        }
      ]
    })
    const ir = collectTree(graph, pageId)
    expect(firstMutation(graph, pageId)).toBeUndefined()
    expect(
      ir.warnings.some((w) => w.code === 'action-supabase-mutation-entry-invalid-key')
    ).toBe(true)
  })

  test('entry with duplicate key → dropped (entry-duplicate-key warn)', () => {
    const { graph, pageId } = setupGraph({
      docStates: [{ id: 'd-n', name: 'newName', type: 'string', defaultValue: '' }],
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseMutation',
          operation: 'insert',
          table: 'users',
          payloadEntries: [
            { key: 'name', valueExpr: 'newName' },
            { key: 'name', valueExpr: '"override"' }
          ]
        }
      ]
    })
    const ir = collectTree(graph, pageId)
    expect(firstMutation(graph, pageId)).toBeUndefined()
    expect(
      ir.warnings.some((w) => w.code === 'action-supabase-mutation-entry-duplicate-key')
    ).toBe(true)
  })

  test('entry with unparseable valueExpr → dropped (entry-invalid-value warn)', () => {
    const { graph, pageId } = setupGraph({
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseMutation',
          operation: 'insert',
          table: 'users',
          payloadEntries: [{ key: 'name', valueExpr: 'foo + ' }]
        }
      ]
    })
    const ir = collectTree(graph, pageId)
    expect(firstMutation(graph, pageId)).toBeUndefined()
    expect(
      ir.warnings.some((w) => w.code === 'action-supabase-mutation-entry-invalid-value')
    ).toBe(true)
  })

  test('entry referencing an unknown identifier → dropped (unknown-identifier warn)', () => {
    const { graph, pageId } = setupGraph({
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseMutation',
          operation: 'insert',
          table: 'users',
          payloadEntries: [{ key: 'name', valueExpr: 'someUndeclaredName' }]
        }
      ]
    })
    const ir = collectTree(graph, pageId)
    expect(firstMutation(graph, pageId)).toBeUndefined()
    expect(
      ir.warnings.some((w) =>
        w.code === 'action-supabase-mutation-unknown-identifier'
      )
    ).toBe(true)
  })
})

describe('React emit supabaseMutation.payloadEntries (§3.v2 step 2)', () => {
  function mutationHandler(opts: {
    operation: 'insert' | 'update' | 'delete' | 'upsert'
    payloadEntries?: { key: string; valueExpr: string }[]
    payload?: string
    filters?: IRSupabaseMutationHandler['filters']
  }): IREventHandler {
    return {
      kind: 'supabaseMutation',
      operation: opts.operation,
      table: 'users',
      payload: opts.payload,
      payloadEntries: opts.payloadEntries?.map((e) => ({
        key: e.key,
        ast: { kind: 'ident', name: e.valueExpr },
        references: [e.valueExpr]
      })),
      filters: opts.filters ?? []
    }
  }

  test('insert with payloadEntries → emits object literal of valueExpr expressions', () => {
    const out = emitEventHandler([
      mutationHandler({
        operation: 'insert',
        payloadEntries: [
          { key: 'name', valueExpr: 'newName' },
          { key: 'age', valueExpr: 'newAge' }
        ]
      })
    ])
    expect(out).toContain('.insert({ "name": newName, "age": newAge })')
  })

  test('upsert with payloadEntries → .upsert({...}) with expression values', () => {
    const out = emitEventHandler([
      mutationHandler({
        operation: 'upsert',
        payloadEntries: [{ key: 'id', valueExpr: 'rowId' }]
      })
    ])
    expect(out).toContain('.upsert({ "id": rowId })')
  })

  test('update with payloadEntries → .update({...}).eq(...) chain order', () => {
    const out = emitEventHandler([
      mutationHandler({
        operation: 'update',
        payloadEntries: [{ key: 'name', valueExpr: 'newName' }],
        filters: [
          {
            column: 'id',
            op: 'eq',
            ast: { kind: 'ident', name: 'targetId' },
            references: ['targetId']
          }
        ]
      })
    ])
    expect(out).toContain('.update({ "name": newName }).eq("id", targetId)')
  })

  test('payloadEntries wins over payload literal at emit time too', () => {
    const out = emitEventHandler([
      mutationHandler({
        operation: 'insert',
        payload: '{"name":"shouldBeIgnored"}',
        payloadEntries: [{ key: 'name', valueExpr: 'newName' }]
      })
    ])
    expect(out).toContain('.insert({ "name": newName })')
    expect(out).not.toContain('shouldBeIgnored')
  })
})
