import { describe, expect, spyOn, test } from 'bun:test'

import { waitForManagementOperation } from '@/app/plugins/host/deployment/supabase/management/abortable-operation'
import {
  createSupabaseManagementBackfillLiveCatalogTransport,
  SupabaseManagementBackfillLiveCatalogTransportError
} from '@/app/plugins/host/deployment/supabase/management/backfill/live-catalog-transport'
import {
  createSupabaseManagementBackfillWriteBarrierInstallTransport,
  SupabaseManagementBackfillWriteBarrierInstallTransportError
} from '@/app/plugins/host/deployment/supabase/management/backfill/write-barrier-install-transport'
import {
  createSupabaseManagementPgCatalogTransport,
  SupabaseManagementPgCatalogTransportError
} from '@/app/plugins/host/deployment/supabase/management/pg-catalog-transport'

import {
  BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
  BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
  BACKFILL_INSTALL_FIXTURE_READ_GRANT,
  createBackfillWriteBarrierInstallFixture
} from '#tests/engine/app/plugins/deployment/supabase/backfill/write-barrier/helpers'

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (cause: unknown) => void = () => undefined
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

describe('Management operation wait', () => {
  test('preserves the existing operation when no signal is supplied', async () => {
    const value = { operation: 'already started' }
    const operation = Promise.resolve(value)
    let errorCreations = 0
    const waited = waitForManagementOperation(operation, undefined, () => {
      errorCreations += 1
      return new Error('unused')
    })
    expect(waited).toBe(operation)
    expect(await waited).toBe(value)
    expect(errorCreations).toBe(0)
  })

  test.each(['resolved', 'rejected'] as const)(
    'detaches a %s operation before its caller signal is reused',
    async (outcome) => {
      const caller = new AbortController()
      const additions = spyOn(caller.signal, 'addEventListener')
      const removals = spyOn(caller.signal, 'removeEventListener')
      const pending = deferred<object>()
      const result =
        outcome === 'resolved' ? { result: 'complete' } : new Error('operation failure')
      let errorCreations = 0
      const waited = waitForManagementOperation(pending.promise, caller.signal, () => {
        errorCreations += 1
        return new Error('unused abort')
      }).catch((cause: unknown) => cause)
      try {
        if (outcome === 'resolved') pending.resolve(result)
        else pending.reject(result)
        expect(await waited).toBe(result)
        const registered = additions.mock.calls.filter(([event]) => event === 'abort')
        const removed = removals.mock.calls.filter(([event]) => event === 'abort')
        expect(registered).toHaveLength(1)
        expect(removed).toHaveLength(1)
        expect(removed[0][1]).toBe(registered[0][1])
        caller.abort(new Error('later operation'))
        expect(errorCreations).toBe(0)
        expect(await waited).toBe(result)
      } finally {
        additions.mockRestore()
        removals.mockRestore()
      }
    }
  )

  test.each([false, true])(
    'preserves the owner error and handles late operation rejection with pre-aborted=%s',
    async (alreadyAborted) => {
      const caller = new AbortController()
      const pending = deferred<undefined>()
      const ownerError = new SupabaseManagementPgCatalogTransportError('aborted')
      let errorCreations = 0
      const failures: unknown[] = []
      const onUnhandled = (cause: unknown) => failures.push(cause)
      process.on('unhandledRejection', onUnhandled)
      try {
        if (alreadyAborted) caller.abort(new Error('private caller reason'))
        const waited = waitForManagementOperation(pending.promise, caller.signal, () => {
          errorCreations += 1
          return ownerError
        }).catch((cause: unknown) => cause)
        if (!alreadyAborted) caller.abort(new Error('private caller reason'))
        expect(await waited).toBe(ownerError)
        expect(errorCreations).toBe(1)
        pending.reject(new Error('late operation failure'))
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0)
        })
        expect(failures).toEqual([])
      } finally {
        process.removeListener('unhandledRejection', onUnhandled)
      }
    }
  )

  test('isolates three concurrent transport owners and their response cleanup failures', async () => {
    const fixture = await createBackfillWriteBarrierInstallFixture()
    const authority = {
      projectRef: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
      accountId: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
      grantGeneration: BACKFILL_INSTALL_FIXTURE_READ_GRANT
    }
    const callers = [new AbortController(), new AbortController(), new AbortController()]
    const reading = callers.map(() => deferred<undefined>())
    const cleanup = callers.map(() => deferred<undefined>())
    const cancelled = [false, false, false]
    const requestSignals: AbortSignal[] = []
    const responses = callers.map(
      (_caller, index) =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull() {
                reading[index].resolve(undefined)
              },
              cancel() {
                cancelled[index] = true
                return cleanup[index].promise
              }
            },
            { highWaterMark: 0 }
          ),
          { headers: { 'content-type': 'application/json' } }
        )
    )
    const options = callers.map((caller, index) => ({
      personalAccessToken: 'sbp_shared_operation_test_canary_1234567890',
      signal: caller.signal,
      fetcher: async (_input: RequestInfo | URL, init: RequestInit | undefined) => {
        requestSignals[index] = init?.signal as AbortSignal
        return responses[index]
      }
    }))
    const operations = [
      createSupabaseManagementPgCatalogTransport(options[0]).getProjectAuthority(authority),
      createSupabaseManagementBackfillLiveCatalogTransport({
        ...options[1],
        authority
      }).getProjectAuthority(authority),
      createSupabaseManagementBackfillWriteBarrierInstallTransport(options[2]).prepareMigration(
        fixture.context
      )
    ].map((operation) => operation.catch((cause: unknown) => cause))
    const failures: unknown[] = []
    const onUnhandled = (cause: unknown) => failures.push(cause)
    process.on('unhandledRejection', onUnhandled)
    try {
      await Promise.all(reading.map((entry) => entry.promise))
      callers[0].abort(new Error('private pg caller'))
      const catalogError = await operations[0]
      expect(catalogError).toBeInstanceOf(SupabaseManagementPgCatalogTransportError)
      expect(catalogError).toMatchObject({ code: 'aborted' })
      expect(requestSignals.slice(1).every((signal) => !signal.aborted)).toBe(true)
      expect(cancelled).toEqual([true, false, false])

      callers[1].abort(new Error('private backfill caller'))
      const backfillError = await operations[1]
      expect(backfillError).toBeInstanceOf(SupabaseManagementBackfillLiveCatalogTransportError)
      expect(backfillError).toMatchObject({ code: 'aborted' })
      expect(requestSignals[2].aborted).toBe(false)
      expect(cancelled).toEqual([true, true, false])

      callers[2].abort(new Error('private install caller'))
      const installError = await operations[2]
      expect(installError).toBeInstanceOf(
        SupabaseManagementBackfillWriteBarrierInstallTransportError
      )
      expect(installError).toMatchObject({ code: 'aborted', outcome: 'not-dispatched' })
      expect(cancelled).toEqual([true, true, true])
      expect(responses.every((response) => !response.body?.locked)).toBe(true)
      for (const failure of [catalogError, backfillError, installError]) {
        expect(String(failure)).not.toContain('private')
      }
    } finally {
      callers.forEach((caller) => caller.abort())
      cleanup.forEach((entry) => entry.reject(new Error('late owner cleanup failure')))
      await Promise.all(operations)
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
      process.removeListener('unhandledRejection', onUnhandled)
    }
    expect(failures).toEqual([])
  })
})
