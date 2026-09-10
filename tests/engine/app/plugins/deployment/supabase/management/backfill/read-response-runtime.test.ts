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
const PROJECT = new TextEncoder().encode(
  JSON.stringify({ ref: AUTHORITY.projectRef, organization_id: AUTHORITY.accountId })
)
const READ_TRANSPORTS = [
  {
    name: 'live catalog',
    create: createSupabaseManagementBackfillLiveCatalogTransport,
    ErrorType: SupabaseManagementBackfillLiveCatalogTransportError
  },
  {
    name: 'write-barrier verification',
    create: createSupabaseManagementBackfillWriteBarrierVerificationTransport,
    ErrorType: SupabaseManagementBackfillWriteBarrierVerificationTransportError
  },
  {
    name: 'database CAS ledger verification',
    create: createSupabaseManagementBackfillDatabaseCASLedgerVerificationTransport,
    ErrorType: SupabaseManagementBackfillDatabaseCASLedgerVerificationTransportError
  }
]
const INVALID_HEADERS = [
  {
    name: 'invalid MIME',
    rawHeader: 'application/x-private-mime-canary',
    headers: new Headers({ 'content-type': 'application/x-private-mime-canary' })
  },
  {
    name: 'malformed content-length',
    rawHeader: 'private-length-canary',
    headers: new Headers({
      'content-type': 'application/json',
      'content-length': 'private-length-canary'
    })
  },
  {
    name: 'unsafe content-length integer',
    rawHeader: '9007199254740993',
    headers: new Headers({
      'content-type': 'application/json',
      'content-length': '9007199254740993'
    })
  }
]

interface RejectedResponseCase {
  readonly name: string
  readonly rawValue: string
  readonly errorCode: 'invalid-response' | 'http-error'
  createResponse(body: ReadableStream<Uint8Array>): Response
}

const REJECTED_RESPONSES: readonly RejectedResponseCase[] = [
  ...INVALID_HEADERS.map(
    (metadata): RejectedResponseCase => ({
      name: metadata.name,
      rawValue: metadata.rawHeader,
      errorCode: 'invalid-response',
      createResponse(body) {
        return new Response(body, { status: 200, headers: metadata.headers })
      }
    })
  ),
  {
    name: 'unexpected status',
    rawValue: 'private-status-canary',
    errorCode: 'http-error',
    createResponse(body) {
      return new Response(body, {
        status: 503,
        statusText: 'private-status-canary',
        headers: { 'content-type': 'application/json' }
      })
    }
  },
  {
    name: 'redirected response',
    rawValue: 'private-redirect-canary',
    errorCode: 'http-error',
    createResponse(body) {
      const response = new Response(body, {
        status: 200,
        statusText: 'private-redirect-canary',
        headers: { 'content-type': 'application/json' }
      })
      Object.defineProperty(response, 'redirected', { value: true })
      return response
    }
  },
  {
    name: 'final URL mismatch',
    rawValue: 'https://example.invalid/private-final-url-canary',
    errorCode: 'http-error',
    createResponse(body) {
      const response = new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
      Object.defineProperty(response, 'url', {
        value: 'https://example.invalid/private-final-url-canary'
      })
      return response
    }
  }
]

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

  for (const owner of READ_TRANSPORTS) {
    test(`${owner.name} reads successful multi-chunk responses without cancellation`, async () => {
      let cancelCalls = 0
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(PROJECT.slice(0, 3))
            controller.enqueue(PROJECT.slice(3, 11))
            controller.enqueue(PROJECT.slice(11))
            controller.close()
          },
          cancel() {
            cancelCalls++
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
      const requests: string[] = []
      const caller = new AbortController()
      const requestSignals: AbortSignal[] = []
      const transport = owner.create({
        personalAccessToken: 'test-only-test-only',
        authority: AUTHORITY,
        signal: caller.signal,
        fetcher: async (_input, init) => {
          requests.push(init?.method ?? 'GET')
          if (init?.signal) requestSignals.push(init.signal)
          return response
        }
      })
      expect(await transport.getProjectAuthority(AUTHORITY)).toEqual({
        projectRef: AUTHORITY.projectRef,
        organizationId: AUTHORITY.accountId,
        grantGeneration: AUTHORITY.grantGeneration
      })
      expect(requests).toEqual(['GET'])
      expect(cancelCalls).toBe(0)
      expect(response.bodyUsed).toBe(true)
      expect(response.body?.locked).toBe(false)
      expect(requestSignals).toHaveLength(1)
      caller.abort()
      expect(requestSignals[0].aborted).toBe(false)
    })

    for (const rejection of REJECTED_RESPONSES) {
      for (const cancellation of ['pending', 'rejected'] as const) {
        test(`${owner.name} cancels ${rejection.name} without waiting for ${cancellation} cleanup`, async () => {
          let resolveCancellation: () => void = () => undefined
          let rejectCancellation: (cause: Error) => void = () => undefined
          const cancelled = new Promise<void>((resolve, reject) => {
            resolveCancellation = resolve
            rejectCancellation = reject
          })
          let cancelCalls = 0
          let bodyReads = 0
          const response = rejection.createResponse(
            new ReadableStream<Uint8Array>(
              {
                pull() {
                  bodyReads++
                },
                cancel() {
                  cancelCalls++
                  return cancelled
                }
              },
              { highWaterMark: 0 }
            )
          )
          const requests: string[] = []
          const caller = new AbortController()
          const requestSignals: AbortSignal[] = []
          const transport = owner.create({
            personalAccessToken: 'test-only-test-only',
            authority: AUTHORITY,
            signal: caller.signal,
            requestTimeoutMs: 1_000,
            fetcher: async (_input, init) => {
              requests.push(init?.method ?? 'GET')
              if (init?.signal) requestSignals.push(init.signal)
              return response
            }
          })
          const unhandled: unknown[] = []
          const onUnhandled = (cause: unknown) => unhandled.push(cause)
          process.on('unhandledRejection', onUnhandled)
          let guard: ReturnType<typeof setTimeout> | undefined
          try {
            const failure = await Promise.race([
              transport.getProjectAuthority(AUTHORITY).catch((cause: unknown) => cause),
              new Promise<string>((resolve) => {
                guard = setTimeout(() => resolve('response cleanup blocked the result'), 100)
              })
            ])
            expect(failure).toBeInstanceOf(owner.ErrorType)
            expect(failure).toMatchObject({
              code: rejection.errorCode,
              message: new owner.ErrorType(rejection.errorCode).message
            })
            expect(String(failure)).not.toContain(rejection.rawValue)
            expect(JSON.stringify(failure)).not.toContain(rejection.rawValue)
            expect(requests).toEqual(['GET'])
            expect(bodyReads).toBe(0)
            expect(requestSignals).toHaveLength(1)
            caller.abort(new Error('caller abort after rejected response'))
            expect(requestSignals[0].aborted).toBe(false)
            await expect(transport.getProjectAuthority(AUTHORITY)).rejects.toMatchObject({
              code: 'invalid-request'
            })
            expect(requests).toEqual(['GET'])
            expect(cancelCalls).toBe(1)
            expect(response.bodyUsed).toBe(true)
            expect(response.body?.locked).toBe(false)
          } finally {
            if (guard !== undefined) clearTimeout(guard)
            if (cancelCalls > 0 && cancellation === 'rejected') {
              rejectCancellation(new Error('late response cleanup failure canary'))
            } else {
              resolveCancellation()
            }
            await new Promise<void>((resolve) => {
              setTimeout(resolve, 0)
            })
            process.removeListener('unhandledRejection', onUnhandled)
          }
          expect(unhandled).toEqual([])
        })
      }
    }
  }
})
