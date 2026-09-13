import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { QUERY_SPEC, queryRuntime } from './helpers'

let fixture: Awaited<ReturnType<typeof queryRuntime>>
beforeAll(async () => {
  fixture = await queryRuntime()
})
afterAll(async () => {
  await fixture?.dispose()
})
const ID = '00000000-0000-4000-8000-000000000001'
const STATEMENT = {
  projection: '"title" AS "title"',
  table: '"public"."products"',
  key: '"id"',
  where: '"owner_id" = $1'
}

describe('generated NestJS query runtime', () => {
  test('keeps legacy UUID keyset paging and strips internal projections', () => {
    const query = fixture.runtime.listQuery({ limit: '1', after: ID }, 20)
    const values: unknown[] = ['verified-subject']
    const sql = fixture.runtime.listStatement(STATEMENT, query, values)
    expect(sql).toContain('WHERE ("owner_id" = $1) AND "id" > $2 ORDER BY "id" ASC LIMIT $3')
    expect(values).toEqual(['verified-subject', ID, 2])
    expect(
      fixture.runtime.listPage([{ title: 'one', __openpencil_cursor: ID }, { title: 'two' }], query)
    ).toEqual({ data: [{ title: 'one' }], nextCursor: ID })
  })

  test('binds filter/search as values, escapes LIKE wildcards and retains owner predicate', () => {
    const query = fixture.runtime.listQuery(
      {
        filter: JSON.stringify({ price: 1299, title: null }),
        q: "%_' OR TRUE --\\",
        sort: 'price',
        direction: 'desc'
      },
      20,
      QUERY_SPEC
    )
    const values: unknown[] = ['owner']
    const sql = fixture.runtime.listStatement(STATEMENT, query, values)
    expect(sql).toContain(
      'WHERE ("owner_id" = $1) AND "price_cents" = $2 AND "title" IS NULL AND ("title" ILIKE $3'
    )
    expect(sql).toContain('ORDER BY "price_cents" DESC, "id" DESC')
    expect(sql).not.toContain('OR TRUE')
    expect(values).toEqual(['owner', 1299, "%\\%\\_' OR TRUE --\\\\%", 21])
  })

  test('sorted cursor retains duplicate-value tie break and rejects changed query context', () => {
    const input = { limit: '1', sort: 'price', direction: 'desc', q: 'shoe' }
    const query = fixture.runtime.listQuery(input, 20, QUERY_SPEC)
    const page = fixture.runtime.listPage(
      [{ title: 'one', __openpencil_cursor: ID, __openpencil_sort: 1299 }, {}],
      query
    )
    expect(page.data).toEqual([{ title: 'one' }])
    const next = fixture.runtime.listQuery({ ...input, after: page.nextCursor }, 20, QUERY_SPEC)
    const values: unknown[] = ['owner']
    expect(fixture.runtime.listStatement(STATEMENT, next, values)).toContain(
      '("price_cents", "id") < ($3, $4)'
    )
    expect(values).toEqual(['owner', '%shoe%', 1299, ID, 2])
    expect(() =>
      fixture.runtime.listQuery({ ...input, q: 'bag', after: page.nextCursor }, 20, QUERY_SPEC)
    ).toThrow()
    expect(() =>
      fixture.runtime.listQuery(
        { ...input, direction: 'asc', after: page.nextCursor },
        20,
        QUERY_SPEC
      )
    ).toThrow()
  })

  test('uses UTC microseconds for datetime cursor without Date round trips', () => {
    const query = fixture.runtime.listQuery({ limit: '1', sort: 'created' }, 20, QUERY_SPEC)
    const value = '2026-09-12T01:02:03.123456Z'
    const page = fixture.runtime.listPage(
      [{ __openpencil_cursor: ID, __openpencil_sort: value }, {}],
      query
    )
    const next = fixture.runtime.listQuery(
      { sort: 'created', after: page.nextCursor },
      20,
      QUERY_SPEC
    )
    const values: unknown[] = []
    expect(fixture.runtime.listStatement(STATEMENT, next, values)).toContain("AT TIME ZONE 'UTC'")
    expect(values).toContain(value)
  })

  test.each([
    { filter: '{"price":"1299"}' },
    { filter: '{"hidden":1}' },
    { filter: '[]' },
    { q: '' },
    { q: ['shoe'] },
    { sort: 'title' },
    { direction: 'desc' },
    { sort: 'price', direction: ['asc'] },
    { limit: '101' },
    { limit: ['1'] },
    { after: 'forged' },
    { sort: 'price', after: ID },
    { filter: '{"__proto__":{}}' },
    { filter: '{"price":2147483648}' },
    { q: 'x'.repeat(129) },
    { sql: '1=1' }
  ])('rejects malformed and undeclared inputs %#', (input) => {
    expect(() => fixture.runtime.listQuery(input, 100, QUERY_SPEC)).toThrow()
  })
})
