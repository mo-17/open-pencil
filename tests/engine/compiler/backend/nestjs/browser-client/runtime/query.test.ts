import { describe, expect, test } from 'bun:test'

import { browserApplication } from '../helpers'
import { runtimeFixture, tick } from './helpers'

const list = { resourceId: 'notes-api', operation: 'list' } as const

describe('generated query paging and cancellation', () => {
  test('keeps initial cursors but resets old paging when query meaning changes', async () => {
    const fixture = await runtimeFixture()
    try {
      const normalize = fixture.runtime.createBackendQueryState()
      const initial = {
        ...list,
        filter: { title: 'A' },
        q: 'alpha',
        sort: 'id',
        direction: 'asc' as const,
        after: 'old'
      }
      expect(normalize(initial).after).toBe('old')
      const changed = { ...initial, filter: { title: 'B' } }
      expect(normalize(changed).after).toBeUndefined()
      expect(normalize({ ...changed }).after).toBeUndefined()
      expect(normalize({ ...changed, after: 'new' }).after).toBe('new')
      expect(normalize({ ...changed, after: 'new', direction: 'desc' }).after).toBeUndefined()
    } finally {
      fixture.dispose()
    }
  })

  test('query replacement aborts the prior request, clears rows and never republishes a stale page', async () => {
    const app = browserApplication()
    if (!app.httpApi) throw new Error('Missing test API')
    app.httpApi.resources[0].query = {
      filterFields: ['title'],
      searchFields: ['title'],
      sortFields: ['id']
    }
    const fixture = await runtimeFixture(false, app)
    const rows: unknown[][] = []
    let stop: () => void = () => undefined
    try {
      fixture.auth.transition('user-a')
      stop = fixture.runtime.watchBackendResource(
        { ...list, filter: { title: 'A' }, q: 'alpha', sort: 'id', direction: 'asc' },
        (value) => rows.push(value)
      )
      await tick()
      const original = fixture.pending[0]
      const url = new URL(original.call.url, 'https://preview.example.test')
      expect(url.searchParams.get('filter')).toBe('{"title":"A"}')
      expect(url.searchParams.get('q')).toBe('alpha')
      expect(url.searchParams.get('sort')).toBe('id')
      stop()
      expect(original.call.init.signal?.aborted).toBe(true)
      stop = fixture.runtime.watchBackendResource({ ...list, filter: { title: 'B' } }, (value) =>
        rows.push(value)
      )
      expect(rows.at(-1)).toEqual([])
      await tick()
      original.respond({ data: [{ id: 'old', title: 'A' }], nextCursor: 'stale' })
      fixture.pending[1].respond({ data: [{ id: 'new', title: 'B' }], nextCursor: null })
      await tick()
      expect(rows.at(-1)).toEqual([{ id: 'new', title: 'B' }])
    } finally {
      stop()
      fixture.dispose()
    }
  })
})
