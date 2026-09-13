import { describe, expect, test } from 'bun:test'

import {
  commandInput,
  journalRows,
  recoveryEnvironment,
  recoveryFixture,
  recoveryInput
} from './helpers'

describe('durable command slot contention', () => {
  test('arbitrates two tabs before HTTP, blocks acknowledgement while pending and prevents stale resurrection', async () => {
    const environment = recoveryEnvironment()
    const first = await recoveryFixture(environment)
    const second = await recoveryFixture(environment)
    try {
      const running = first.runtime.backendCommand(commandInput)
      const request = await first.waitForRequest(0)
      const key = String(first.values.get('attempt'))
      await expect(second.runtime.backendCommand(commandInput)).rejects.toMatchObject({
        status: 409
      })
      expect(second.pending).toHaveLength(0)
      expect(second.values.get('attempt')).toBe('')
      const info = await second.runtime.backendCommandRecovery({
        ...recoveryInput,
        operation: 'inspect'
      })
      expect(info).toMatchObject({ data: { status: 'recorded', key } })
      for (const operation of ['retry', 'acknowledge'] as const)
        await expect(
          second.runtime.backendCommandRecovery({ ...recoveryInput, operation, attemptKey: key })
        ).rejects.toMatchObject({ status: 409 })
      expect(await journalRows(environment.indexedDB)).toHaveLength(1)
      request.respond({ id: 'saved', title: 'Original' })
      await running
      second.values.set('attempt', key)
      await first.runtime.backendCommandRecovery({
        ...recoveryInput,
        operation: 'acknowledge',
        attemptKey: key
      })
      expect(first.values.get('attempt')).toBe('')
      expect(await journalRows(environment.indexedDB)).toEqual([])
      await expect(second.runtime.backendCommand(commandInput)).rejects.toMatchObject({
        status: 409
      })
      expect(second.pending).toHaveLength(0)
      const next = first.runtime.backendCommand({
        ...commandInput,
        payload: { title: 'Another intent' }
      })
      const nextRequest = await first.waitForRequest(1)
      const nextKey = first.values.get('attempt')
      expect(nextKey).not.toBe(key)
      nextRequest.respond({ id: 'another', title: 'Another intent' })
      await next
      await expect(
        second.runtime.backendCommandRecovery({
          ...recoveryInput,
          operation: 'acknowledge',
          attemptKey: key
        })
      ).rejects.toMatchObject({ status: 409 })
      expect(await journalRows(environment.indexedDB)).toMatchObject([{ key: nextKey }])
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  test('an account transition during asynchronous storage cannot dispatch under the next account', async () => {
    const environment = recoveryEnvironment()
    const fixture = await recoveryFixture(environment)
    try {
      const running = fixture.runtime.backendCommand(commandInput)
      const oldKey = fixture.values.get('attempt')
      fixture.auth.transition('user-b')
      expect(await running).toEqual({ current: false })
      expect(fixture.values.get('attempt')).toBe('')
      expect(fixture.pending).toHaveLength(0)
      expect(
        await fixture.runtime.backendCommandRecovery({ ...recoveryInput, operation: 'inspect' })
      ).toMatchObject({ data: { status: 'empty' } })
      const fresh = fixture.runtime.backendCommand(commandInput)
      const request = await fixture.waitForRequest(0)
      expect(fixture.values.get('attempt')).not.toBe(oldKey)
      request.respond({ id: 'user-b-only', title: 'B' })
      await fresh
    } finally {
      fixture.dispose()
    }
  })
})
