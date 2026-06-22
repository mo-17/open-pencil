import { describe, expect, test } from 'bun:test'

import {
  type RlsTableRequirement,
  buildRlsPolicySql,
  collectRlsRequirements
} from '@open-pencil/core/lowcode-validation'
import type { ActionDef } from '@open-pencil/core/scene-graph'

/**
 * Phase 3 §3.v8 step 1 — direct unit coverage for the RLS policy advisor.
 * The editor panel (`SupabaseConfigPanel`) walks the scene graph and feeds
 * the collected actions in; these exercise the pure logic in isolation.
 */

function query(table: string): ActionDef {
  return { id: 'a', kind: 'supabaseQuery', table, resultTarget: 'rows' }
}

function mutation(table: string, operation: 'insert' | 'update' | 'delete' | 'upsert'): ActionDef {
  return { id: 'm', kind: 'supabaseMutation', operation, table }
}

function req(reqs: RlsTableRequirement[], table: string): RlsTableRequirement {
  const found = reqs.find((r) => r.table === table)
  if (!found) throw new Error(`no requirement for ${table}`)
  return found
}

describe('collectRlsRequirements', () => {
  test('maps query → SELECT and mutation operations → commands', () => {
    const reqs = collectRlsRequirements([
      query('posts'),
      mutation('comments', 'insert'),
      mutation('likes', 'delete')
    ])
    expect(req(reqs, 'posts').commands).toEqual(['SELECT'])
    expect(req(reqs, 'comments').commands).toEqual(['INSERT'])
    expect(req(reqs, 'likes').commands).toEqual(['DELETE'])
  })

  test('Phase 3 §10: descends into condition branches for nested supabase actions', () => {
    const reqs = collectRlsRequirements([
      {
        id: 'c1',
        kind: 'condition',
        condExpr: 'flag',
        consequent: [query('posts')],
        alternate: [
          {
            id: 'c2',
            kind: 'condition',
            condExpr: 'other',
            consequent: [mutation('comments', 'update')]
          }
        ]
      }
    ])
    // both the direct then-branch query and the doubly-nested else-branch
    // mutation must surface, or RLS policies inside workflows get missed.
    expect(req(reqs, 'posts').commands).toEqual(['SELECT'])
    expect(req(reqs, 'comments').commands).toEqual(['UPDATE'])
  })

  test('Phase 3 §10 v9: descends into apiCall/supabase onSuccess + onError branches', () => {
    const reqs = collectRlsRequirements([
      {
        id: 'm1',
        kind: 'supabaseMutation',
        operation: 'insert',
        table: 'orders',
        onSuccess: [query('receipts')],
        onError: [mutation('errors', 'insert')]
      }
    ])
    // the action itself + both result-branch supabase actions must surface, or
    // RLS policies inside onSuccess/onError get silently missed (经验 A).
    expect(req(reqs, 'orders').commands).toEqual(['INSERT'])
    expect(req(reqs, 'receipts').commands).toEqual(['SELECT'])
    expect(req(reqs, 'errors').commands).toEqual(['INSERT'])
  })

  test('Phase 3 §10 v4: descends into callWorkflow targets when workflows supplied', () => {
    const workflows = new Map<string, { id: string; name: string; actions: ActionDef[] }>([
      ['wf', { id: 'wf', name: 'w', actions: [mutation('audit', 'insert')] }]
    ])
    const actions: ActionDef[] = [
      query('posts'),
      { id: 'cw', kind: 'callWorkflow', workflowId: 'wf' }
    ]
    // without the workflow map, callWorkflow is opaque → only `posts` surfaces.
    expect(collectRlsRequirements(actions).find((r) => r.table === 'audit')).toBeUndefined()
    // with it, the workflow's nested mutation surfaces too.
    const reqs = collectRlsRequirements(actions, workflows)
    expect(req(reqs, 'posts').commands).toEqual(['SELECT'])
    expect(req(reqs, 'audit').commands).toEqual(['INSERT'])
  })

  test('Phase 3 §10 v4: a callWorkflow cycle does not infinite-loop the advisor', () => {
    const workflows = new Map<string, { id: string; name: string; actions: ActionDef[] }>([
      [
        'a',
        {
          id: 'a',
          name: 'a',
          actions: [mutation('t', 'insert'), { id: 'cb', kind: 'callWorkflow', workflowId: 'b' }]
        }
      ],
      ['b', { id: 'b', name: 'b', actions: [{ id: 'ca', kind: 'callWorkflow', workflowId: 'a' }] }]
    ])
    const reqs = collectRlsRequirements(
      [{ id: 'cw', kind: 'callWorkflow', workflowId: 'a' }],
      workflows
    )
    expect(req(reqs, 't').commands).toEqual(['INSERT'])
  })

  test('upsert needs both INSERT and UPDATE (footgun)', () => {
    const reqs = collectRlsRequirements([mutation('profiles', 'upsert')])
    expect(req(reqs, 'profiles').commands).toEqual(['INSERT', 'UPDATE'])
    expect(req(reqs, 'profiles').needsWriteWarning).toBe(true)
  })

  test('merges multiple actions on the same table and dedupes commands', () => {
    const reqs = collectRlsRequirements([
      query('orders'),
      mutation('orders', 'update'),
      query('orders'),
      mutation('orders', 'update')
    ])
    expect(reqs).toHaveLength(1)
    expect(req(reqs, 'orders').commands).toEqual(['SELECT', 'UPDATE'])
  })

  test('emits commands in fixed SELECT, INSERT, UPDATE, DELETE order', () => {
    const reqs = collectRlsRequirements([
      mutation('t', 'delete'),
      mutation('t', 'update'),
      mutation('t', 'insert'),
      query('t')
    ])
    expect(req(reqs, 't').commands).toEqual(['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
  })

  test('needsWriteWarning is true for UPDATE/DELETE, false for read-only or pure insert', () => {
    expect(collectRlsRequirements([query('t')])[0].needsWriteWarning).toBe(false)
    expect(collectRlsRequirements([mutation('t', 'insert')])[0].needsWriteWarning).toBe(false)
    expect(collectRlsRequirements([mutation('t', 'update')])[0].needsWriteWarning).toBe(true)
    expect(collectRlsRequirements([mutation('t', 'delete')])[0].needsWriteWarning).toBe(true)
  })

  test('skips blank table names and trims', () => {
    const reqs = collectRlsRequirements([query('   '), query(''), mutation('  spaced  ', 'insert')])
    expect(reqs.map((r) => r.table)).toEqual(['spaced'])
  })

  test('ignores non-Supabase actions', () => {
    const setState: ActionDef = {
      id: 's',
      kind: 'setState',
      targetStateId: 'x',
      valueExpr: '1'
    }
    expect(collectRlsRequirements([setState])).toEqual([])
  })
})

describe('buildRlsPolicySql', () => {
  test('enables RLS and emits one permissive anon policy per command with correct clause matrix', () => {
    const sql = buildRlsPolicySql({
      table: 'orders',
      commands: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
      needsWriteWarning: true
    })
    expect(sql).toContain('alter table "orders" enable row level security;')
    expect(sql).toContain('-- ⚠ replace (true) with a real predicate before production')
    // Postgres RLS clause matrix (decision §3.v8.2 d)
    expect(sql).toContain(
      'create policy "orders_select_anon" on "orders" for select to anon, authenticated using (true);'
    )
    expect(sql).toContain(
      'create policy "orders_insert_anon" on "orders" for insert to anon, authenticated with check (true);'
    )
    expect(sql).toContain(
      'create policy "orders_update_anon" on "orders" for update to anon, authenticated using (true) with check (true);'
    )
    expect(sql).toContain(
      'create policy "orders_delete_anon" on "orders" for delete to anon, authenticated using (true);'
    )
  })

  test('reminder comment is the first line', () => {
    const sql = buildRlsPolicySql({ table: 't', commands: ['SELECT'], needsWriteWarning: false })
    expect(sql.split('\n')[0]).toContain('replace (true) with a real predicate')
  })
})
