import { describe, expect, test } from 'bun:test'

import { browserApplication } from '../helpers'
import { runtimeFixture, tick } from './helpers'

function publicApplication() {
  const application = browserApplication()
  application.auth.rowAccess.push({
    id: 'catalog-public',
    entityId: 'notes',
    effect: 'allow',
    operations: ['select'],
    principal: { kind: 'anonymous' }
  })
  return application
}

describe('generated public Backend reads', () => {
  test('loads declared public LIST without a token while writes still require login', async () => {
    const fixture = await runtimeFixture(false, publicApplication())
    const rows: unknown[][] = []
    const stop = fixture.runtime.watchBackendResource(
      { resourceId: 'notes-api', operation: 'list' },
      (value) => rows.push(value)
    )
    try {
      await tick()
      expect(fixture.pending).toHaveLength(1)
      expect(new Headers(fixture.pending[0].call.init.headers).has('Authorization')).toBe(false)
      fixture.pending[0].respond({ data: [{ title: 'Public' }], nextCursor: null })
      await tick()
      expect(rows.at(-1)).toEqual([{ title: 'Public' }])
      await expect(
        fixture.runtime.backendRequest({
          resourceId: 'notes-api',
          operation: 'create',
          payload: { title: 'No' }
        })
      ).rejects.toThrow('Authentication required.')
      expect(fixture.pending).toHaveLength(1)
    } finally {
      stop()
      fixture.dispose()
    }
  })

  test('identity changes cancel public requests and clear authenticated rows before reloading anonymously', async () => {
    const fixture = await runtimeFixture(false, publicApplication())
    const rows: unknown[][] = []
    const stop = fixture.runtime.watchBackendResource(
      { resourceId: 'notes-api', operation: 'list' },
      (value) => rows.push(value)
    )
    try {
      await tick()
      fixture.auth.transition('buyer')
      await tick()
      expect(fixture.pending[0].call.init.signal?.aborted).toBe(true)
      expect(new Headers(fixture.pending[1].call.init.headers).get('Authorization')).toBe(
        'Bearer synthetic-session-token'
      )
      fixture.pending[0].respond({ data: [{ title: 'Stale anonymous' }], nextCursor: null })
      fixture.pending[1].respond({ data: [{ title: 'Signed in' }], nextCursor: null })
      await tick()
      expect(rows.at(-1)).toEqual([{ title: 'Signed in' }])
      fixture.auth.transition(null)
      expect(rows.at(-1)).toEqual([])
      await tick()
      expect(new Headers(fixture.pending[2].call.init.headers).has('Authorization')).toBe(false)
    } finally {
      stop()
      fixture.dispose()
    }
  })
})
