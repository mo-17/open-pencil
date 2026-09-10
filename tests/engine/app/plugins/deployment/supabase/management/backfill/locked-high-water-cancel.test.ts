import { describe, expect, test } from 'bun:test'

import {
  captureSupabaseBackfillLockedHighWaterV1,
  SupabaseBackfillLockedHighWaterCaptureError
} from '@/app/plugins/host/deployment/supabase/backfill/locked-high-water-capture'
import { createSupabaseManagementBackfillLockedHighWaterCaptureTransport } from '@/app/plugins/host/deployment/supabase/management/backfill/locked-high-water-capture-transport'

import {
  BACKFILL_CAPTURE_FIXTURE_PAT,
  BACKFILL_CAPTURE_READ_AUTHORITY,
  createBackfillLockedHighWaterCaptureFixture
} from '#tests/engine/app/plugins/deployment/supabase/backfill/locked-high-water/helpers'

describe('locked high-water capture cancellation after dispatch', () => {
  test.each(['deadline', 'streamed byte overflow', 'caller abort'] as const)(
    '%s returns and burns the capture before cancellation settles',
    async (scenario) => {
      const fixture = await createBackfillLockedHighWaterCaptureFixture()
      const caller = new AbortController()
      let rejectCancellation: (cause: unknown) => void = () => undefined
      let resolveCancellation: () => void = () => undefined
      const cancellation = new Promise<void>((resolve, reject) => {
        rejectCancellation = reject
        resolveCancellation = resolve
      })
      const requestMethods: string[] = []
      let queryResponse: Response | undefined
      let cancelCalls = 0
      const transport = createSupabaseManagementBackfillLockedHighWaterCaptureTransport({
        personalAccessToken: BACKFILL_CAPTURE_FIXTURE_PAT,
        authority: fixture.writeAuthority,
        signal: caller.signal,
        requestTimeoutMs: scenario === 'deadline' ? 5 : 1_000,
        fetcher: async (_url, init, maximum) => {
          requestMethods.push(init?.method ?? '')
          if (init?.method === 'GET') {
            return new Response(
              JSON.stringify({
                ref: fixture.writeAuthority.projectRef,
                organization_id: fixture.writeAuthority.accountId
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            )
          }
          expect(JSON.parse(String(init?.body))).toEqual({
            query: fixture.captureReview.captureSql,
            read_only: false
          })
          queryResponse = new Response(
            new ReadableStream<Uint8Array>(
              {
                start(controller) {
                  if (scenario === 'streamed byte overflow') {
                    controller.enqueue(new Uint8Array(maximum + 1))
                  }
                },
                pull() {
                  if (scenario === 'caller abort') queueMicrotask(() => caller.abort())
                },
                cancel() {
                  cancelCalls += 1
                  return cancellation
                }
              },
              { highWaterMark: 0 }
            ),
            { status: 201, headers: { 'content-type': 'application/json' } }
          )
          return queryResponse
        }
      })
      const options = {
        captureReview: fixture.captureReview,
        stagingTargetBinding: fixture.install.stagingBinding,
        confirmation: fixture.confirmation,
        readCurrentCompilerInput: () => fixture.install.input,
        readCurrentReadAuthority: () => BACKFILL_CAPTURE_READ_AUTHORITY,
        readCurrentWriteAuthority: () => fixture.writeAuthority,
        readCurrentStagingTargetBinding: () => fixture.install.stagingBinding,
        transport
      }
      const unhandled: unknown[] = []
      const onUnhandled = (cause: unknown) => unhandled.push(cause)
      process.on('unhandledRejection', onUnhandled)
      const operation = captureSupabaseBackfillLockedHighWaterV1(options).catch(
        (cause: unknown) => cause
      )
      let guard: ReturnType<typeof setTimeout> | undefined
      try {
        const result = await Promise.race([
          operation,
          new Promise<string>((resolve) => {
            guard = setTimeout(() => resolve('pending cancellation blocked capture'), 100)
          })
        ])
        expect(result).toBeInstanceOf(SupabaseBackfillLockedHighWaterCaptureError)
        expect(result).toMatchObject({
          code: 'supabase-backfill-locked-high-water-transport-failed'
        })
        expect(cancelCalls).toBe(1)
        expect(queryResponse?.body?.locked).toBe(false)
        expect(requestMethods).toEqual(['GET', 'POST'])
        await expect(captureSupabaseBackfillLockedHighWaterV1(options)).rejects.toMatchObject({
          code: 'supabase-backfill-locked-high-water-proof-invalid'
        })
        expect(requestMethods).toEqual(['GET', 'POST'])
      } finally {
        clearTimeout(guard)
        // Baseline failures must also release their in-flight read and cancellation promises.
        caller.abort()
        if (cancelCalls > 0) rejectCancellation(new Error('late cancellation failure'))
        else resolveCancellation()
        await operation
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0)
        })
        process.removeListener('unhandledRejection', onUnhandled)
      }
      expect(unhandled).toEqual([])
    }
  )
})
