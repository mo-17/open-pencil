import { describe, expect, test } from 'bun:test'

import { commandApplication } from '../command/helpers'
import { commandAPIForTest, runtimeFixture, tick } from './helpers'

describe('generated client runtime test fixture bounds', () => {
  test('an absent request has a timer deadline that allows other timers to run', async () => {
    const fixture = await runtimeFixture(false, commandApplication())
    let timerRan = false
    const timer = setTimeout(() => {
      timerRan = true
    }, 0)
    const started = performance.now()
    try {
      await expect(fixture.waitForRequest(0, 20)).rejects.toThrow('test deadline')
      expect(timerRan).toBe(true)
      expect(performance.now() - started).toBeLessThan(1000)
    } finally {
      clearTimeout(timer)
      fixture.dispose()
    }
  })

  test('request notification resolves once and fixture disposal cancels outstanding waits', async () => {
    const fixture = await runtimeFixture(false, commandApplication())
    try {
      fixture.auth.transition('user-a')
      fixture.values.set('attempt', '')
      const requested = fixture.waitForRequest(0)
      const running = fixture.runtime.backendCommand({
        commandId: 'save-note',
        payload: { title: 'Test' },
        idempotencyKeyTarget: 'attempt'
      })
      const request = await requested
      expect(request).toBe(fixture.pending[0])
      expect(request.settled).toBe(false)
      const missing = fixture.waitForRequest(1).catch((error: unknown) => error)
      fixture.dispose()
      expect(await missing).toBeInstanceOf(Error)
      expect(await running).toEqual({ current: false })
      expect(request.call.init.signal?.aborted).toBe(true)
      expect(request.settled).toBe(true)
      await expect(fixture.waitForRequest(0)).rejects.toThrow('disposed')
    } finally {
      fixture.dispose()
    }
  })

  test('disposal stops list subscriptions and drains an ignored-abort transport', async () => {
    const fixture = await runtimeFixture()
    try {
      fixture.auth.transition('user-a')
      const rows: unknown[][] = []
      fixture.runtime.watchBackendResource(
        { resourceId: 'notes-api', operation: 'list' },
        (value) => rows.push(value)
      )
      const request = await fixture.waitForRequest(0)
      const before = rows.length
      fixture.dispose()
      fixture.auth.transition('user-b')
      request.respond({ data: [{ id: 'late-private' }], nextCursor: null })
      await tick()
      expect(rows).toHaveLength(before)
      expect(fixture.pending).toHaveLength(1)
      expect(request.settled).toBe(true)
      expect(request.call.init.signal?.aborted).toBe(true)
    } finally {
      fixture.dispose()
    }
  })

  test('a missing generated timeout marker or an unbounded override fails before tests can hang', async () => {
    expect(() => commandAPIForTest('const CHANGED_COMMAND_TIMEOUT_MS = 30_000', 25)).toThrow(
      'deadline could not be installed'
    )
    await expect(runtimeFixture(false, commandApplication(), Infinity)).rejects.toThrow(
      'deadline could not be installed'
    )
  })
})
