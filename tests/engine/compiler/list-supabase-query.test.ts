import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const SUPA_CONFIG = { url: 'https://x.supabase.co', anonKey: 'eyJ.anon.sig' }

/**
 * Phase 4 §17.1 — a LIST whose `dataSourceRef.kind === 'supabaseQuery'` emits a
 * per-LIST fetch hook (useState + useEffect running the Supabase chain) and the
 * `.map()` iterates the hook's rows. Filters reuse the §2 expression
 * sub-language, so a filter referencing a doc-state re-runs the effect when that
 * doc-state changes (live filtering). Requires Supabase configured.
 */
describe('compile — LIST Supabase query datasource (Phase 4 §17.1)', () => {
  function compileList(
    query: Record<string, unknown>,
    opts: { supabase?: boolean; docStates?: unknown[]; name?: string } = {}
  ): string {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    if (opts.supabase !== false)
      graph.updateNode(graph.rootId, { lowcodeSupabaseConfig: SUPA_CONFIG })
    if (opts.docStates) graph.updateNode(graph.rootId, { lowcodeDocumentState: opts.docStates })
    const list = graph.createNode('LIST', pageId, {
      name: opts.name ?? 'Products',
      width: 300,
      height: 400,
      interactiveProps: { dataSourceRef: { kind: 'supabaseQuery', query } }
    })
    graph.createNode('TEXT', list.id, { name: 'row', width: 200, height: 20, text: 'row' })
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'list-supa' })
    })
    return out.files.get('src/App.tsx') as string
  }

  test('emits a fetch hook + .map() + supabase import', () => {
    const app = compileList({ table: 'products', columns: '*' })
    expect(app).toContain("import { useState, useEffect } from 'react'")
    expect(app).toContain('import { getSupabaseClient }')
    expect(app).toContain('const [productsRows, setProductsRows] = useState([])')
    expect(app).toContain('getSupabaseClient().from("products").select("*")')
    expect(app).toContain('setProductsRows(data)')
    expect(app).toContain('{(productsRows).map((item, index) =>')
  })

  test('a filter referencing a doc-state re-runs the effect on change', () => {
    const app = compileList(
      { table: 'products', filters: [{ column: 'category', op: 'eq', valueExpr: 'category' }] },
      { docStates: [{ id: 'd1', name: 'category', type: 'string', defaultValue: '' }] }
    )
    expect(app).toContain('.eq("category", category)')
    expect(app).toContain('const category = useDocState("category")')
    expect(app).toMatch(/\}, \[category\]\)/)
  })

  test('orderBy + limit emit .order(...) + .limit(n)', () => {
    const app = compileList({
      table: 'products',
      orderBy: [
        { column: 'price', ascending: true },
        { column: 'name', ascending: false }
      ],
      limit: 20
    })
    expect(app).toContain('.order("price", { ascending: true })')
    expect(app).toContain('.order("name", { ascending: false })')
    expect(app).toContain('.limit(20)')
  })

  test('no Supabase config → warn + no fetch hook (empty list)', () => {
    const app = compileList({ table: 'products' }, { supabase: false })
    expect(app).not.toContain('getSupabaseClient')
    expect(app).not.toContain('useEffect')
  })

  test('missing table → no fetch hook', () => {
    const app = compileList({ columns: '*' })
    expect(app).not.toContain('useEffect')
    expect(app).not.toContain('.from(')
  })

  // ── §17.2 offset pagination ──
  const PAGE_STATE = [{ id: 'd1', name: 'page', type: 'number', defaultValue: 0 }]

  test('offsetExpr + limit emit .range(offset, offset + size - 1) and a page dep', () => {
    const app = compileList(
      { table: 'products', limit: 20, offsetExpr: 'page * 20' },
      { docStates: PAGE_STATE }
    )
    expect(app).toContain('.range(page * 20, page * 20 + 20 - 1)')
    expect(app).not.toContain('.limit(20)')
    expect(app).toMatch(/\}, \[page\]\)/)
  })

  test('limit without offset stays .limit(n) (no pagination)', () => {
    const app = compileList({ table: 'products', limit: 20 })
    expect(app).toContain('.limit(20)')
    expect(app).not.toContain('.range(')
  })

  test('offsetExpr without limit → warn + no range/limit (pagination ignored)', () => {
    const app = compileList(
      { table: 'products', offsetExpr: 'page * 20' },
      { docStates: PAGE_STATE }
    )
    expect(app).not.toContain('.range(')
    expect(app).not.toContain('.limit(')
    // the list still fetches (offset ignored, not the whole query dropped)
    expect(app).toContain('.from("products")')
  })

  // ── §17.3 dynamic sort ──
  const SORT_STATE = [
    { id: 'd1', name: 'sortCol', type: 'string', defaultValue: 'name' },
    { id: 'd2', name: 'sortAsc', type: 'boolean', defaultValue: true }
  ]

  test('reactive columnExpr / ascendingExpr emit .order(<expr>, …) + sort deps', () => {
    const app = compileList(
      {
        table: 'products',
        orderBy: [{ columnExpr: 'sortCol', ascendingExpr: 'sortAsc' }]
      },
      { docStates: SORT_STATE }
    )
    expect(app).toContain('.order(sortCol, { ascending: sortAsc })')
    expect(app).toContain('const sortCol = useDocState("sortCol")')
    expect(app).toMatch(/\}, \[sortCol, sortAsc\]\)/)
  })

  test('static and reactive order clauses coexist', () => {
    const app = compileList(
      {
        table: 'products',
        orderBy: [{ columnExpr: 'sortCol' }, { column: 'id', ascending: false }]
      },
      { docStates: SORT_STATE }
    )
    expect(app).toContain('.order(sortCol, { ascending: true })')
    expect(app).toContain('.order("id", { ascending: false })')
  })

  test('a malformed sort expression drops the whole list', () => {
    const app = compileList(
      { table: 'products', orderBy: [{ columnExpr: 'unknownState' }] },
      { docStates: SORT_STATE }
    )
    expect(app).not.toContain('.from("products")')
    expect(app).not.toContain('useEffect')
  })
})
