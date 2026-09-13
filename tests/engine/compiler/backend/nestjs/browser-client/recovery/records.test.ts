import { describe, expect, test } from 'bun:test'

import {
  commandInput,
  journalRows,
  recoveryEnvironment,
  recoveryFixture,
  recoveryInput,
  replaceJournalRows
} from './helpers'

describe('bounded recovery records', () => {
  test.each(['extra-field', 'invalid-payload', 'noncanonical-payload'] as const)(
    'rejects a %s without deletion or HTTP',
    async (mode) => {
      const environment = recoveryEnvironment()
      const fixture = await recoveryFixture(environment)
      try {
        const running = fixture.runtime.backendCommand(commandInput)
        const request = await fixture.waitForRequest(0)
        request.respond({ id: 'saved', title: 'Saved' })
        await running
        const key = String(fixture.values.get('attempt'))
        const [row] = await journalRows(environment.indexedDB)
        if (!row || typeof row !== 'object')
          throw new Error('Test recovery record was not persisted')
        const invalid =
          mode === 'extra-field'
            ? { ...row, token: 'not-a-token' }
            : {
                ...row,
                payload:
                  mode === 'invalid-payload' ? '{"title":42}' : '{ "title": "Immutable note" }'
              }
        await replaceJournalRows(environment.indexedDB, [invalid])
        await expect(
          fixture.runtime.backendCommandRecovery({ ...recoveryInput, operation: 'inspect' })
        ).rejects.toMatchObject({ status: 503 })
        await expect(
          fixture.runtime.backendCommandRecovery({
            ...recoveryInput,
            operation: 'retry',
            attemptKey: key
          })
        ).rejects.toMatchObject({ status: 503 })
        expect(fixture.pending).toHaveLength(1)
        expect(await journalRows(environment.indexedDB)).toEqual([invalid])
      } finally {
        fixture.dispose()
      }
    }
  )

  test('does not evict unfinished records at capacity or dispatch a request it cannot retain', async () => {
    const environment = recoveryEnvironment()
    const fixture = await recoveryFixture(environment)
    try {
      const running = fixture.runtime.backendCommand(commandInput)
      const request = await fixture.waitForRequest(0)
      request.respond({ id: 'saved', title: 'Saved' })
      await running
      const [record] = await journalRows(environment.indexedDB)
      if (!record || typeof record !== 'object')
        throw new Error('Test recovery record was not persisted')
      const rows = Array.from({ length: 256 }, (_, index) => ({
        ...record,
        slot: 'other-slot-' + index
      }))
      await replaceJournalRows(environment.indexedDB, rows)
      fixture.values.set('attempt', '')
      await expect(fixture.runtime.backendCommand(commandInput)).rejects.toMatchObject({
        status: 503
      })
      expect(fixture.pending).toHaveLength(1)
      expect(await journalRows(environment.indexedDB)).toEqual(
        rows.sort((left, right) => left.slot.localeCompare(right.slot))
      )
    } finally {
      fixture.dispose()
    }
  })
})
