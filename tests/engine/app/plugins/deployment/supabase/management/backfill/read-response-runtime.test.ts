import { describe, expect, test } from 'bun:test'

import { createSupabaseManagementBackfillDatabaseCASLedgerVerificationTransport } from '@/app/plugins/host/deployment/supabase/management/backfill/database-cas-ledger-verification-transport'
import {
  createSupabaseManagementBackfillLiveCatalogTransport,
  SupabaseManagementBackfillLiveCatalogTransportError
} from '@/app/plugins/host/deployment/supabase/management/backfill/live-catalog-transport'
import { createSupabaseManagementBackfillWriteBarrierVerificationTransport } from '@/app/plugins/host/deployment/supabase/management/backfill/write-barrier-verification-transport'

const AUTHORITY = Object.freeze({
  projectRef: 'abcdefghijklmnopqrst',
  accountId: 'account-1',
  grantGeneration: '123e4567-e89b-42d3-a456-426614174000'
})
const PROJECT = new TextEncoder().encode(
  JSON.stringify({ ref: AUTHORITY.projectRef, organization_id: AUTHORITY.accountId })
)

describe('shared backfill response lifetime through readonly transports', () => {
  test('isolates concurrent cancellation and detaches caller signals after settlement', async () => {
    const callers = [new AbortController(), new AbortController(), new AbortController()]
    const requestSignals: AbortSignal[] = []
    const bodyControllers: ReadableStreamDefaultController<Uint8Array>[] = []
    const bodyCancelled = [false, false, false]
    const reading = [0, 1].map(() => {
      let resolve: () => void = () => undefined
      const promise = new Promise<boolean>((onReading) => {
        resolve = () => onReading(true)
      })
      return { promise, resolve }
    })
    const responses = callers.map(
      (_caller, index) =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              start(controller) {
                bodyControllers[index] = controller
                if (index === 2) {
                  controller.enqueue(PROJECT)
                  controller.close()
                }
              },
              pull() {
                reading[index]?.resolve()
              },
              cancel() {
                bodyCancelled[index] = true
              }
            },
            { highWaterMark: 0 }
          ),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    )
    const factories = [
      createSupabaseManagementBackfillLiveCatalogTransport,
      createSupabaseManagementBackfillWriteBarrierVerificationTransport,
      createSupabaseManagementBackfillDatabaseCASLedgerVerificationTransport
    ]
    const operations = factories.map((createTransport, index) =>
      createTransport({
        personalAccessToken: 'sbp_response_lifetime_test_canary_1234567890',
        authority: AUTHORITY,
        signal: callers[index].signal,
        requestTimeoutMs: 1_000,
        fetcher: async (_input, init) => {
          requestSignals[index] = init?.signal as AbortSignal
          return responses[index]
        }
      })
        .getProjectAuthority(AUTHORITY)
        .catch((cause: unknown) => cause)
    )

    await Promise.all(reading.map((entry) => entry.promise))
    expect(await operations[2]).toMatchObject({ projectRef: AUTHORITY.projectRef })
    callers[2].abort()
    expect(requestSignals[2].aborted).toBe(false)

    callers[0].abort(new Error('caller-only diagnostic'))
    const failure = await operations[0]
    expect(failure).toBeInstanceOf(SupabaseManagementBackfillLiveCatalogTransportError)
    expect(failure).toMatchObject({ code: 'aborted' })
    expect(bodyCancelled).toEqual([true, false, false])
    expect(responses[0].body?.locked).toBe(false)
    expect(requestSignals[1].aborted).toBe(false)

    bodyControllers[1].enqueue(PROJECT)
    bodyControllers[1].close()
    expect(await operations[1]).toMatchObject({ projectRef: AUTHORITY.projectRef })
    callers[1].abort()
    expect(requestSignals[1].aborted).toBe(false)
    expect(responses.every((response) => !response.body?.locked)).toBe(true)
  })
})
