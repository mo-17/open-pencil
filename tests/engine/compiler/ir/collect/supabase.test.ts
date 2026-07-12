import { beforeAll, describe, expect, test } from 'bun:test'

import { collectTree } from '#compiler/ir/collect/tree'
import type {
  IREventHandler,
  IRSupabaseAuthHandler,
  IRSupabaseMutationHandler,
  IRSupabaseQueryHandler
} from '#compiler/ir/types'

import { SceneGraph, initCodec } from '@open-pencil/core'
import type { ActionDef, SupabaseConfig } from '@open-pencil/scene-graph'

/**
 * Phase 3 §2 step 2 — Supabase IR collect.
 *
 * Auto-registration of `$currentUser` when the root has `lowcodeSupabaseConfig`
 * + validation gates for `supabaseQuery` and `supabaseMutation` (mirroring the
 * Phase 2 §3 apiCall.test layout). Walker / cross-walker tests are step 5.
 */

const DEFAULT_CONFIG: SupabaseConfig = {
  url: 'https://abc.supabase.co',
  anonKey: 'anon-jwt'
}

describe('collect Supabase IR (Phase 3 §2)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  function makeGraph(opts: {
    config?: SupabaseConfig
    docStates?: { id: string; name: string; type: 'array' | 'object'; defaultValue: unknown }[]
    onClick?: ActionDef[]
  }): { graph: SceneGraph; pageId: string } {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeSupabaseConfig: opts.config,
      lowcodeDocumentState: opts.docStates ?? []
    })
    const page = graph.getPages()[0]
    if (opts.onClick) {
      graph.createNode('BUTTON', page.id, { events: { onClick: opts.onClick } })
    }
    return { graph, pageId: page.id }
  }

  function firstHandler<T extends IREventHandler>(
    graph: SceneGraph,
    pageId: string,
    kind: T['kind']
  ): T | undefined {
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (!button || button.kind !== 'element') return undefined
    const handler = button.events?.onClick?.[0]
    return handler?.kind === kind ? (handler as T) : undefined
  }

  test('root supabaseConfig auto-registers a $currentUser docState (object, null fields)', () => {
    const { graph, pageId } = makeGraph({ config: DEFAULT_CONFIG })
    const ir = collectTree(graph, pageId)
    const builtIn = ir.docStates.find((d) => d.name === '$currentUser')
    expect(builtIn).toBeDefined()
    expect(builtIn?.type).toBe('object')
    expect(builtIn?.defaultValue).toEqual({ id: null, email: null, signedIn: false })
  })

  test('without supabaseConfig the $currentUser docState is NOT registered', () => {
    const { graph, pageId } = makeGraph({})
    const ir = collectTree(graph, pageId)
    expect(ir.docStates.find((d) => d.name === '$currentUser')).toBeUndefined()
  })

  test('$currentUser sits before user-declared docStates so user names cannot shadow', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      docStates: [{ id: 'd-users', name: 'users', type: 'array', defaultValue: [] }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.docStates.map((d) => d.name)).toEqual(['$currentUser', 'users'])
  })

  test('supabaseQuery valid → IRSupabaseQueryHandler with defaults applied', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      docStates: [{ id: 'd-users', name: 'users', type: 'array', defaultValue: [] }],
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseQuery',
          table: 'users',
          resultTarget: 'users'
        }
      ]
    })
    const h = firstHandler<IRSupabaseQueryHandler>(graph, pageId, 'supabaseQuery')
    expect(h).toEqual({
      kind: 'supabaseQuery',
      table: 'users',
      columns: '*',
      filters: [],
      single: false,
      resultTarget: 'users',
      errorTarget: undefined
    })
  })

  test('supabaseQuery filter references a docState → identifier registered as read', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      docStates: [
        { id: 'd-users', name: 'users', type: 'array', defaultValue: [] },
        { id: 'd-uid', name: 'currentId', type: 'object', defaultValue: 0 }
      ],
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseQuery',
          table: 'users',
          filters: [{ column: 'id', op: 'eq', valueExpr: 'currentId' }],
          resultTarget: 'users'
        }
      ]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.docStateReads).toContain('currentId')
    const h = firstHandler<IRSupabaseQueryHandler>(graph, pageId, 'supabaseQuery')
    expect(h?.filters[0]).toEqual({
      column: 'id',
      op: 'eq',
      ast: { kind: 'ident', name: 'currentId' },
      references: ['currentId']
    })
  })

  test('supabaseQuery missing table → handler dropped + warning', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      docStates: [{ id: 'd-users', name: 'users', type: 'array', defaultValue: [] }],
      onClick: [{ id: 'a1', kind: 'supabaseQuery', table: '   ', resultTarget: 'users' }]
    })
    const ir = collectTree(graph, pageId)
    expect(firstHandler<IRSupabaseQueryHandler>(graph, pageId, 'supabaseQuery')).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'action-supabase-query-missing-table')).toBe(true)
  })

  test('supabaseQuery unknown resultTarget → handler dropped', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      onClick: [{ id: 'a1', kind: 'supabaseQuery', table: 'users', resultTarget: 'ghost' }]
    })
    const ir = collectTree(graph, pageId)
    expect(firstHandler<IRSupabaseQueryHandler>(graph, pageId, 'supabaseQuery')).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'action-supabase-query-unknown-target')).toBe(true)
  })

  test('supabaseQuery filter with unknown identifier → handler dropped', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      docStates: [{ id: 'd-users', name: 'users', type: 'array', defaultValue: [] }],
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseQuery',
          table: 'users',
          filters: [{ column: 'id', op: 'eq', valueExpr: 'mystery' }],
          resultTarget: 'users'
        }
      ]
    })
    const ir = collectTree(graph, pageId)
    expect(firstHandler<IRSupabaseQueryHandler>(graph, pageId, 'supabaseQuery')).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'action-supabase-query-unknown-identifier')).toBe(
      true
    )
  })

  test('supabaseMutation insert valid → compact JSON payload kept', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseMutation',
          operation: 'insert',
          table: 'users',
          payloadJson: '{ "name" : "Alice" }'
        }
      ]
    })
    const h = firstHandler<IRSupabaseMutationHandler>(graph, pageId, 'supabaseMutation')
    expect(h?.payload).toBe('{"name":"Alice"}')
  })

  test('supabaseMutation insert missing payload → dropped', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      onClick: [{ id: 'a1', kind: 'supabaseMutation', operation: 'insert', table: 'users' }]
    })
    const ir = collectTree(graph, pageId)
    expect(
      firstHandler<IRSupabaseMutationHandler>(graph, pageId, 'supabaseMutation')
    ).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'action-supabase-mutation-missing-payload')).toBe(
      true
    )
  })

  test('supabaseMutation update without filters → dropped (where clause required)', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseMutation',
          operation: 'update',
          table: 'users',
          payloadJson: '{"name":"A"}'
        }
      ]
    })
    const ir = collectTree(graph, pageId)
    expect(
      firstHandler<IRSupabaseMutationHandler>(graph, pageId, 'supabaseMutation')
    ).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'action-supabase-mutation-missing-filters')).toBe(
      true
    )
  })

  test('supabaseMutation delete with payload → dropped (delete must have no payload)', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseMutation',
          operation: 'delete',
          table: 'users',
          payloadJson: '{"name":"A"}',
          filters: [{ column: 'id', op: 'eq', valueExpr: '1' }]
        }
      ]
    })
    const ir = collectTree(graph, pageId)
    expect(
      firstHandler<IRSupabaseMutationHandler>(graph, pageId, 'supabaseMutation')
    ).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'action-supabase-mutation-unexpected-payload')).toBe(
      true
    )
  })

  test('supabaseMutation result/error targets register as docStateWrites', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      docStates: [
        { id: 'd-new', name: 'newUser', type: 'object', defaultValue: {} },
        { id: 'd-err', name: 'lastError', type: 'object', defaultValue: null }
      ],
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseMutation',
          operation: 'insert',
          table: 'users',
          payloadJson: '{"name":"A"}',
          resultTarget: 'newUser',
          errorTarget: 'lastError'
        }
      ]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.docStateWrites).toContain('newUser')
    expect(ir.docStateWrites).toContain('lastError')
  })

  // ── Phase 3 §2.v2: supabaseAuth signIn / signOut ──

  test('signIn lowers email/password exprs into a supabaseAuth handler', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseAuth',
          operation: 'signIn',
          emailExpr: "'a@b.co'",
          passwordExpr: "'secret'"
        }
      ]
    })
    const h = firstHandler<IRSupabaseAuthHandler>(graph, pageId, 'supabaseAuth')
    expect(h?.operation).toBe('signIn')
    expect(h?.emailAst).toBeDefined()
    expect(h?.passwordAst).toBeDefined()
  })

  test('signUp lowers email/password exprs like signIn (Phase 3 §2.v3)', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseAuth',
          operation: 'signUp',
          emailExpr: "'a@b.co'",
          passwordExpr: "'secret'"
        }
      ]
    })
    const h = firstHandler<IRSupabaseAuthHandler>(graph, pageId, 'supabaseAuth')
    expect(h?.operation).toBe('signUp')
    expect(h?.emailAst).toBeDefined()
    expect(h?.passwordAst).toBeDefined()
  })

  test('signUp with a missing credential is dropped with a warning (Phase 3 §2.v3)', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      onClick: [{ id: 'a1', kind: 'supabaseAuth', operation: 'signUp', emailExpr: "'a@b.co'" }]
    })
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    expect(button?.kind === 'element' && (button.events?.onClick?.length ?? 0)).toBe(0)
    const warn = ir.warnings.find((w) => w.code === 'action-supabase-auth-missing-credentials')
    expect(warn?.message).toContain('signUp')
  })

  test('resetPassword lowers email only (no password), Phase 3 §2.v4', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      onClick: [
        { id: 'a1', kind: 'supabaseAuth', operation: 'resetPassword', emailExpr: "'a@b.co'" }
      ]
    })
    const h = firstHandler<IRSupabaseAuthHandler>(graph, pageId, 'supabaseAuth')
    expect(h?.operation).toBe('resetPassword')
    expect(h?.emailAst).toBeDefined()
    expect(h?.passwordAst).toBeUndefined()
  })

  test('updatePassword lowers password only (no email), Phase 3 §2.v4', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      onClick: [
        { id: 'a1', kind: 'supabaseAuth', operation: 'updatePassword', passwordExpr: "'newpw'" }
      ]
    })
    const h = firstHandler<IRSupabaseAuthHandler>(graph, pageId, 'supabaseAuth')
    expect(h?.operation).toBe('updatePassword')
    expect(h?.passwordAst).toBeDefined()
    expect(h?.emailAst).toBeUndefined()
  })

  test('resetPassword with no email is dropped with a warning (Phase 3 §2.v4)', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      onClick: [{ id: 'a1', kind: 'supabaseAuth', operation: 'resetPassword' }]
    })
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    expect(button?.kind === 'element' && (button.events?.onClick?.length ?? 0)).toBe(0)
    const warn = ir.warnings.find((w) => w.code === 'action-supabase-auth-missing-credentials')
    expect(warn?.message).toContain('resetPassword')
    expect(warn?.message).toContain('email')
  })

  test('updatePassword with no password is dropped with a warning (Phase 3 §2.v4)', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      onClick: [{ id: 'a1', kind: 'supabaseAuth', operation: 'updatePassword' }]
    })
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    expect(button?.kind === 'element' && (button.events?.onClick?.length ?? 0)).toBe(0)
    const warn = ir.warnings.find((w) => w.code === 'action-supabase-auth-missing-credentials')
    expect(warn?.message).toContain('updatePassword')
    expect(warn?.message).toContain('password')
  })

  test('signOut needs no credentials', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      onClick: [{ id: 'a1', kind: 'supabaseAuth', operation: 'signOut' }]
    })
    const h = firstHandler<IRSupabaseAuthHandler>(graph, pageId, 'supabaseAuth')
    expect(h?.operation).toBe('signOut')
    expect(h?.emailAst).toBeUndefined()
  })

  test('signIn with a missing credential is dropped with a warning', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      onClick: [{ id: 'a1', kind: 'supabaseAuth', operation: 'signIn', emailExpr: "'a@b.co'" }]
    })
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    expect(button?.kind === 'element' && (button.events?.onClick?.length ?? 0)).toBe(0)
    expect(ir.warnings.some((w) => w.code === 'action-supabase-auth-missing-credentials')).toBe(
      true
    )
  })

  test('signIn errorTarget is recorded as a docState write', () => {
    const { graph, pageId } = makeGraph({
      config: DEFAULT_CONFIG,
      docStates: [{ id: 'e', name: 'authError', type: 'object', defaultValue: null }],
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseAuth',
          operation: 'signIn',
          emailExpr: "'a@b.co'",
          passwordExpr: "'secret'",
          errorTarget: 'authError'
        }
      ]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.docStateWrites).toContain('authError')
  })
})
