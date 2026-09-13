import { describe, expect, test } from 'bun:test'

import { runtimeFixture, tick } from './helpers'
const list = { resourceId: 'notes-api', operation: 'list' } as const

describe('generated shared Backend request lifetime', () => {
  test('waits for auth, clears on logout, rejects late old-session rows and reloads the new session', async () => {
    const fixture = await runtimeFixture()
    const rows: unknown[][] = []
    const cursors: string[] = []
    const stop = fixture.runtime.watchBackendResource(
      list,
      (value) => rows.push(value),
      (value) => cursors.push(value)
    )
    try {
      await tick()
      expect(fixture.pending).toHaveLength(0)
      fixture.auth.transition('user-a')
      await tick()
      expect(fixture.pending).toHaveLength(1)
      expect(fixture.pending[0].call.url).toBe('/api/notes')
      expect(fixture.pending[0].call.init).toMatchObject({
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        headers: { Authorization: 'Bearer synthetic-session-token' }
      })
      fixture.auth.transition(null)
      expect(fixture.pending[0].call.init.signal?.aborted).toBe(true)
      fixture.pending[0].respond({ data: [{ id: 'a', title: 'private A' }], nextCursor: 'old' })
      await tick()
      expect(rows.at(-1)).toEqual([])
      expect(cursors.at(-1)).toBe('')
      fixture.auth.transition('user-b')
      await tick()
      fixture.pending[1].respond({ data: [{ id: 'b', title: 'B' }], nextCursor: null })
      await tick()
      expect(rows.at(-1)).toEqual([{ id: 'b', title: 'B' }])
      expect(fixture.values.get('$currentUser')).toMatchObject({
        id: 'user-b',
        ready: true,
        signedIn: true
      })
    } finally {
      stop()
      fixture.dispose()
    }
  })
  test('failed callback restores the configured login route, shows only a fixed alert and still finishes initialization', async () => {
    const fixture = await runtimeFixture(true)
    try {
      expect(fixture.browserEvents).toEqual([
        { kind: 'navigation', path: '/login' },
        { kind: 'alert', role: 'alert', text: 'Sign-in could not be completed. Please try again.' }
      ])
      expect(fixture.values.get('$currentUser')).toMatchObject({ ready: true, signedIn: false })
      await fixture.runtime.initializeBackendClient()
      expect(fixture.browserEvents).toHaveLength(2)
      fixture.auth.transition('user-a')
      expect(fixture.browserEvents.at(-1)).toEqual({ kind: 'removed' })
    } finally {
      fixture.dispose()
    }
  })
  test('mutation invalidates the declared resource once and unsubscribed list results cannot publish', async () => {
    const fixture = await runtimeFixture()
    let writes = 0
    const stop = fixture.runtime.watchBackendResource(list, () => writes++)
    try {
      fixture.auth.transition('user-a')
      await tick()
      fixture.pending[0].respond({ data: [], nextCursor: null })
      await tick()
      const mutation = fixture.runtime.backendRequest({
        resourceId: 'notes-api',
        operation: 'create',
        payload: { title: 'New' }
      })
      await tick()
      expect(fixture.pending[1].call.init.body).toBe('{"title":"New"}')
      fixture.pending[1].respond({ id: 'new', title: 'New' })
      expect((await mutation).current).toBe(true)
      await tick()
      expect(fixture.pending).toHaveLength(3)
      stop()
      const before = writes
      fixture.pending[2].respond({ data: [{ title: 'Late' }], nextCursor: null })
      await tick()
      expect(writes).toBe(before)
    } finally {
      stop()
      fixture.dispose()
    }
  })
  test('clears tracked Backend results and errors at identity change while preserving ordinary UI state', async () => {
    const fixture = await runtimeFixture()
    try {
      fixture.auth.transition('user-a')
      const generation = fixture.runtime.getSession().generation
      fixture.values.set('ordinaryInput', 'keep')
      fixture.runtime.setBackendState(generation, 'row', { title: 'Private A' }, {})
      fixture.runtime.setBackendState(generation, 'rows', [{ title: 'Private A' }], [])
      fixture.runtime.setBackendState(generation, 'cursor', 'private-cursor', '')
      fixture.runtime.setBackendState(generation, 'error', 'Backend request failed.', '')
      fixture.auth.transition(null)
      expect(Object.fromEntries(fixture.values)).toMatchObject({
        row: {},
        rows: [],
        cursor: '',
        error: '',
        ordinaryInput: 'keep'
      })
      fixture.auth.transition('user-b')
      fixture.runtime.setBackendState(generation, 'error', 'late-old-error', '')
      fixture.runtime.setBackendState(generation, 'row', { title: 'late A' }, {})
      expect(fixture.values.get('error')).toBe('')
      expect(fixture.values.get('row')).toEqual({})
    } finally {
      fixture.dispose()
    }
  })
  test('reports safe request errors and does not invalidate after failed or stale mutations', async () => {
    const fixture = await runtimeFixture()
    const errors: string[] = []
    const stop = fixture.runtime.watchBackendResource(
      list,
      () => {
        /* This case observes the error channel only. */
      },
      undefined,
      (value) => errors.push(value)
    )
    try {
      fixture.auth.transition('user-a')
      await tick()
      fixture.pending[0].respond({ details: 'synthetic-private' }, 503)
      await tick()
      expect(errors.at(-1)).toBe('Backend request failed.')
      const mutation = fixture.runtime.backendRequest({
        resourceId: 'notes-api',
        operation: 'create',
        payload: { title: 'New' }
      })
      await tick()
      fixture.auth.transition(null)
      fixture.pending[1].reject()
      expect((await mutation).current).toBe(false)
      expect(fixture.pending).toHaveLength(2)
    } finally {
      stop()
      fixture.dispose()
    }
  })
})
