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
  test('a synchronous consumer rebind dispatches once and cannot revive disposed subscriptions', async () => {
    const fixture = await runtimeFixture(false, publicApplication())
    let stop: () => void = () => undefined
    let stopOther: () => void = () => undefined
    let rebind = false
    let otherWrites = 0
    try {
      fixture.auth.transition('reader-a')
      const generation = fixture.runtime.getSession().generation
      stop = fixture.runtime.watchBackendResource(
        { resourceId: 'notes-api', operation: 'list', sessionGeneration: generation },
        () => {
          if (!rebind) return
          rebind = false
          stop()
          stopOther()
          stop = fixture.runtime.watchBackendResource(
            {
              resourceId: 'notes-api',
              operation: 'list',
              sessionGeneration: fixture.runtime.getSession().generation
            },
            () => undefined
          )
        }
      )
      stopOther = fixture.runtime.watchBackendResource(
        { resourceId: 'notes-api', operation: 'list', sessionGeneration: generation },
        () => {
          otherWrites++
        }
      )
      await tick()
      expect(fixture.pending).toHaveLength(2)
      const writesBeforeChange = otherWrites
      rebind = true
      fixture.auth.transition('reader-b')
      await tick()
      expect(fixture.pending).toHaveLength(3)
      expect(otherWrites).toBe(writesBeforeChange)
      expect(fixture.pending[0].call.init.signal?.aborted).toBe(true)
      expect(fixture.pending[1].call.init.signal?.aborted).toBe(true)
      expect(fixture.pending[2].call.init.signal?.aborted).toBe(false)
    } finally {
      stop()
      stopOther()
      fixture.dispose()
    }
  })

  test('waits for consumer rebinding before sending a selected public article filter in a new session', async () => {
    const application = publicApplication()
    if (!application.httpApi) throw new Error('Missing public API')
    application.httpApi.resources[0].query = {
      filterFields: ['id'],
      searchFields: [],
      sortFields: ['id']
    }
    const fixture = await runtimeFixture(false, application)
    const rows: unknown[][] = []
    let stop: () => void = () => undefined
    const firstId = '10000000-0000-4000-8000-000000000001'
    const secondId = '20000000-0000-4000-8000-000000000002'
    try {
      fixture.auth.transition('reader-a')
      const firstGeneration = fixture.runtime.getSession().generation
      fixture.runtime.setBackendState(firstGeneration, 'selected', { article_id: firstId }, {})
      stop = fixture.runtime.watchBackendResource(
        {
          resourceId: 'notes-api',
          operation: 'list',
          filter: { id: firstId },
          sessionGeneration: firstGeneration
        },
        (value) => rows.push(value)
      )
      await tick()
      expect(fixture.pending).toHaveLength(1)
      const oldRequest = fixture.pending[0]
      fixture.auth.transition('reader-b')
      expect(fixture.values.get('selected')).toEqual({})
      expect(rows.at(-1)).toEqual([])
      expect(oldRequest.call.init.signal?.aborted).toBe(true)
      await tick()
      expect(fixture.pending).toHaveLength(1)
      oldRequest.respond({ data: [{ id: firstId, title: 'Old article' }], nextCursor: null })
      await tick()
      expect(rows.at(-1)).toEqual([])
      stop()
      stop = fixture.runtime.watchBackendResource(
        {
          resourceId: 'notes-api',
          operation: 'list',
          filter: { id: secondId },
          sessionGeneration: fixture.runtime.getSession().generation
        },
        (value) => rows.push(value)
      )
      await tick()
      expect(fixture.pending).toHaveLength(2)
      const url = new URL(fixture.pending[1].call.url, 'https://generated.test')
      expect(url.searchParams.get('filter')).toBe(JSON.stringify({ id: secondId }))
      expect(url.searchParams.has('sessionGeneration')).toBe(false)
      fixture.pending[1].respond({
        data: [{ id: secondId, title: 'Current article' }],
        nextCursor: null
      })
      await tick()
      expect(rows.at(-1)).toEqual([{ id: secondId, title: 'Current article' }])
      fixture.auth.transition(null)
      expect(rows.at(-1)).toEqual([])
      await tick()
      expect(fixture.pending).toHaveLength(2)
    } finally {
      stop()
      fixture.dispose()
    }
  })

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
