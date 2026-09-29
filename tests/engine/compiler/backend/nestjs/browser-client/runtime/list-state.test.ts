import { describe, expect, test } from 'bun:test'

import { runtimeFixture, tick, type RuntimeListState } from './helpers'

const input = { resourceId: 'notes-api', operation: 'list' } as const
const saved = [{ id: 'a', title: 'Saved row' }]

describe('generated Backend LIST state and safe retry', () => {
  test.each(['not-ready', 'signed-out'] as const)(
    'clears private rows when %s even if the session generation is unchanged',
    async (availability) => {
      const fixture = await runtimeFixture()
      const rows: unknown[][] = []
      const states: RuntimeListState[] = []
      try {
        fixture.auth.transition('reader-a')
        const stop = fixture.runtime.watchBackendResource(
          input,
          (value) => rows.push(value),
          undefined,
          undefined,
          (value) => states.push(value)
        )
        ;(await fixture.waitForRequest(0)).respond({ data: saved, nextCursor: null })
        await tick()
        fixture.auth.availability(availability !== 'not-ready', availability !== 'signed-out')
        expect(rows.at(-1)).toEqual([])
        expect(states.at(-1)).toEqual({ phase: 'idle', hasRows: false })
        stop.retry()
        await tick()
        expect(fixture.pending).toHaveLength(1)
      } finally {
        fixture.dispose()
      }
    }
  )

  test('initial load, empty success and error are distinct; retry is only a GET', async () => {
    const fixture = await runtimeFixture()
    const states: RuntimeListState[] = []
    try {
      fixture.auth.transition('reader-a')
      const stop = fixture.runtime.watchBackendResource(
        input,
        () => undefined,
        undefined,
        undefined,
        (state) => states.push(state)
      )
      expect(states.at(-1)?.phase).toBe('loading')
      const first = await fixture.waitForRequest(0)
      first.reject()
      await tick()
      expect(states.at(-1)).toEqual({ phase: 'error', hasRows: false, errorCode: 'request-failed' })
      stop.retry()
      expect(states.at(-1)?.phase).toBe('loading')
      const retry = await fixture.waitForRequest(1)
      expect(retry.call.init.method).toBe('GET')
      retry.respond({ data: [], nextCursor: null })
      await tick()
      expect(states.at(-1)?.phase).toBe('empty')
      stop()
    } finally {
      fixture.dispose()
    }
  })

  test('same-query effect rebinding retains rows, but a changed page and new account clear them', async () => {
    const fixture = await runtimeFixture()
    const rows: unknown[][] = []
    const states: RuntimeListState[] = []
    try {
      fixture.auth.transition('reader-a')
      const cache = fixture.runtime.createBackendResourceCache()
      const watch = (after?: string) =>
        fixture.runtime.watchBackendResource(
          { ...input, after },
          (value) => rows.push(value),
          undefined,
          undefined,
          (value) => states.push(value),
          cache
        )
      let stop = watch()
      ;(await fixture.waitForRequest(0)).respond({ data: saved, nextCursor: 'next' })
      await tick()
      expect(states.at(-1)?.phase).toBe('ready')
      stop()
      stop = watch()
      expect(rows.at(-1)).toEqual(saved)
      expect(states.at(-1)?.phase).toBe('refreshing')
      const stale = await fixture.waitForRequest(1)
      stop()
      stop = watch('next')
      expect(rows.at(-1)).toEqual([])
      expect(states.at(-1)?.phase).toBe('loading')
      const next = await fixture.waitForRequest(2)
      stale.respond({ data: saved, nextCursor: null })
      await tick()
      expect(rows.at(-1)).toEqual([])
      next.respond({ data: saved, nextCursor: null })
      await tick()
      fixture.auth.transition('reader-b')
      expect(rows.at(-1)).toEqual([])
      expect(states.at(-1)?.phase).toBe('loading')
      stop()
    } finally {
      fixture.dispose()
    }
  })

  test.each([401, 403])(
    'refresh failure HTTP %i clears retained rows and cursor',
    async (status) => {
      const fixture = await runtimeFixture()
      const rows: unknown[][] = []
      const states: RuntimeListState[] = []
      const cursors: string[] = []
      try {
        fixture.auth.transition('reader-a')
        const stop = fixture.runtime.watchBackendResource(
          input,
          (value) => rows.push(value),
          (value) => cursors.push(value),
          undefined,
          (value) => states.push(value)
        )
        ;(await fixture.waitForRequest(0)).respond({ data: saved, nextCursor: 'next' })
        await tick()
        stop.retry()
        expect(rows.at(-1)).toEqual(saved)
        expect(states.at(-1)?.phase).toBe('refreshing')
        ;(await fixture.waitForRequest(1)).respond({}, status)
        await tick()
        expect(rows.at(-1)).toEqual([])
        expect(cursors.at(-1)).toBe('')
        expect(states.at(-1)).toEqual({
          phase: 'error',
          hasRows: false,
          errorCode: status === 401 ? 'authentication-required' : 'forbidden'
        })
        stop()
      } finally {
        fixture.dispose()
      }
    }
  )

  test('network refresh errors keep old rows; disposal and superseded retries ignore late output', async () => {
    const fixture = await runtimeFixture()
    const rows: unknown[][] = []
    const states: RuntimeListState[] = []
    try {
      fixture.auth.transition('reader-a')
      const stop = fixture.runtime.watchBackendResource(
        input,
        (value) => rows.push(value),
        undefined,
        undefined,
        (value) => states.push(value)
      )
      ;(await fixture.waitForRequest(0)).respond({ data: saved, nextCursor: null })
      await tick()
      stop.retry()
      ;(await fixture.waitForRequest(1)).reject()
      await tick()
      expect(rows.at(-1)).toEqual(saved)
      expect(states.at(-1)).toEqual({ phase: 'error', hasRows: true, errorCode: 'request-failed' })
      stop.retry()
      const stale = await fixture.waitForRequest(2)
      stop.retry()
      const current = await fixture.waitForRequest(3)
      expect(stale.call.init.signal?.aborted).toBe(true)
      stale.respond({ data: [], nextCursor: null })
      await tick()
      expect(states.at(-1)?.phase).toBe('refreshing')
      const count = states.length
      stop()
      stop.retry()
      current.respond({ data: [], nextCursor: null })
      await tick()
      expect(states).toHaveLength(count)
      expect(fixture.pending).toHaveLength(4)
    } finally {
      fixture.dispose()
    }
  })
})
