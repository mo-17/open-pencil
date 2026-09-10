import { describe, expect, test } from 'bun:test'

import {
  createSupabaseManagementBackfillDatabaseCASLedgerVerificationTransport,
  SupabaseManagementBackfillDatabaseCASLedgerVerificationTransportError
} from '@/app/plugins/host/deployment/supabase/management/backfill/database-cas-ledger-verification-transport'
import {
  createSupabaseManagementBackfillLiveCatalogTransport,
  SupabaseManagementBackfillLiveCatalogTransportError
} from '@/app/plugins/host/deployment/supabase/management/backfill/live-catalog-transport'
import {
  createSupabaseManagementBackfillWriteBarrierVerificationTransport,
  SupabaseManagementBackfillWriteBarrierVerificationTransportError
} from '@/app/plugins/host/deployment/supabase/management/backfill/write-barrier-verification-transport'

const AUTHORITY = Object.freeze({
  projectRef: 'abcdefghijklmnopqrst',
  accountId: 'account-1',
  grantGeneration: '123e4567-e89b-42d3-a456-426614174000'
})
const TRANSPORTS = [
  [
    'live catalog',
    createSupabaseManagementBackfillLiveCatalogTransport,
    SupabaseManagementBackfillLiveCatalogTransportError
  ],
  [
    'write barrier',
    createSupabaseManagementBackfillWriteBarrierVerificationTransport,
    SupabaseManagementBackfillWriteBarrierVerificationTransportError
  ],
  [
    'database CAS ledger',
    createSupabaseManagementBackfillDatabaseCASLedgerVerificationTransport,
    SupabaseManagementBackfillDatabaseCASLedgerVerificationTransportError
  ]
] as const

for (const [name, createTransport, TransportError] of TRANSPORTS) {
  describe(`${name} response cancellation deadline`, () => {
    test.each([
      ['timeout', 'timeout'],
      ['caller abort', 'aborted'],
      ['streamed byte overflow', 'response-too-large']
    ] as const)('%s settles before response cancellation completes', async (_scenario, code) => {
      let rejectCancellation: (cause: unknown) => void = () => undefined
      const cancellation = new Promise<void>((_resolve, reject) => {
        rejectCancellation = reject
      })
      const caller = new AbortController()
      let cancelCalls = 0
      let response: Response | undefined
      let requestSignal: AbortSignal | undefined
      const unhandledRejections: unknown[] = []
      const onUnhandledRejection = (cause: unknown) => {
        unhandledRejections.push(cause)
      }
      process.on('unhandledRejection', onUnhandledRejection)
      const transport = createTransport({
        personalAccessToken: 'sbp_cancel_deadline_test_canary_1234567890',
        authority: AUTHORITY,
        signal: caller.signal,
        requestTimeoutMs: code === 'timeout' ? 5 : 1_000,
        fetcher: async (_url, init, maximum) => {
          requestSignal = init?.signal ?? undefined
          response = new Response(
            new ReadableStream<Uint8Array>(
              {
                start(controller) {
                  if (code === 'response-too-large') {
                    controller.enqueue(new Uint8Array(maximum + 1))
                  }
                },
                pull() {
                  if (code === 'aborted') {
                    queueMicrotask(() => caller.abort(new Error('caller diagnostic canary')))
                  }
                },
                cancel() {
                  cancelCalls += 1
                  return cancellation
                }
              },
              { highWaterMark: 0 }
            ),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
          return response
        }
      })
      const operation = transport.getProjectAuthority(AUTHORITY).catch((cause: unknown) => cause)
      let guardTimer: ReturnType<typeof setTimeout> | undefined
      try {
        const failure = await Promise.race([
          operation,
          new Promise<string>((resolve) => {
            guardTimer = setTimeout(() => resolve('cancellation blocked the result'), 100)
          })
        ])
        expect(failure).toBeInstanceOf(TransportError)
        expect(failure).toMatchObject({ code })
        expect(String(failure)).not.toContain('canary')
        expect(cancelCalls).toBe(1)
        expect(response?.body?.locked).toBe(false)
        const requestWasAborted = requestSignal?.aborted
        caller.abort()
        expect(requestSignal?.aborted).toBe(requestWasAborted)
      } finally {
        clearTimeout(guardTimer)
        // Release even a failing baseline run, then observe rejection after the public result.
        rejectCancellation(new Error('late cancellation failure canary'))
        await operation
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0)
        })
        process.removeListener('unhandledRejection', onUnhandledRejection)
      }
      expect(unhandledRejections).toEqual([])
    })
  })
}
