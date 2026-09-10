import { describe, expect, spyOn, test } from 'bun:test'

import { createMemoryBackendHostReleaseDispatchJournal } from '@/app/plugins/host/deployment/backend/release-journal'
import {
  createSupabaseManagementDatabaseApplyTransport,
  SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS,
  SupabaseManagementDatabaseApplyTransportError,
  type SupabaseManagementPreparedDatabaseApply
} from '@/app/plugins/host/deployment/supabase/management/database-apply-transport'

import {
  captureBrandedApplyContext,
  errorCode,
  PAT,
  projectResponse,
  runBrandedApply
} from './helpers'

const FAILURES = [
  'overflow pending cancel',
  'overflow rejected cancel',
  'declared overflow pending cancel',
  'declared overflow rejected cancel',
  'body abort',
  'body error',
  'body error during abort'
] as const
type BodyFailure = (typeof FAILURES)[number]

function failingBody(failure: BodyFailure, status: number, caller: AbortController) {
  const declaredOverflow = failure.startsWith('declared overflow')
  const bodyError = failure.startsWith('body error')
  const maximum =
    status === 201
      ? SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.maxApplyResponseBytes
      : SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.maxProjectResponseBytes
  let cancelCalls = 0
  let bodyController: ReadableStreamDefaultController<Uint8Array>
  let rejectCancellation: ((cause: unknown) => void) | undefined
  const response = new Response(
    new ReadableStream<Uint8Array>(
      {
        start(controller) {
          bodyController = controller
          if (failure !== 'body abort' && !declaredOverflow && !bodyError) {
            controller.enqueue(new Uint8Array(maximum + 1))
          }
        },
        pull() {
          if (failure === 'body abort') {
            queueMicrotask(() => caller.abort(new Error('caller reason secret canary')))
          }
          if (bodyError) {
            queueMicrotask(() => {
              bodyController.error(new Error(`private response diagnostic ${PAT}`))
              if (failure === 'body error during abort') caller.abort()
            })
          }
        },
        cancel() {
          cancelCalls += 1
          if (failure.endsWith('rejected cancel')) {
            return Promise.reject(new Error('cancellation rejection secret canary'))
          }
          return new Promise<void>((_resolve, reject) => {
            rejectCancellation = reject
          })
        }
      },
      { highWaterMark: 0 }
    ),
    {
      status,
      headers: {
        'content-type': 'application/json',
        ...(declaredOverflow ? { 'content-length': String(maximum + 1) } : {})
      }
    }
  )
  return {
    response,
    cancelCalls: () => cancelCalls,
    finish() {
      rejectCancellation?.(new Error('late cancellation rejection secret canary'))
      // A failing baseline can still be stuck in read(), before it ever requested cancellation.
      if (cancelCalls === 0 && !bodyError) bodyController.close()
    }
  }
}

function expectedBodyError(failure: BodyFailure) {
  if (failure === 'body abort' || failure === 'body error during abort') return 'aborted'
  return failure === 'body error' ? 'network-failed' : 'response-too-large'
}

async function guarded<T>(operation: Promise<T>, check: (value: T | string) => Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const value = await Promise.race([
      operation,
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve('body cleanup blocked the result'), 200)
      })
    ])
    await check(value)
  } finally {
    clearTimeout(timer)
  }
}

function observeUnhandledRejections() {
  const rejections: unknown[] = []
  const listener = (cause: unknown) => rejections.push(cause)
  process.on('unhandledRejection', listener)
  return {
    async finish() {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
      process.removeListener('unhandledRejection', listener)
      expect(rejections).toEqual([])
    }
  }
}

describe('Supabase Management database Apply body lifetime', () => {
  for (const phase of ['prepare', 'authority recheck', 'POST'] as const) {
    test.each(FAILURES)(
      `${phase}: %s preserves its error and releases the reader`,
      async (failure) => {
        const context = await captureBrandedApplyContext()
        const caller = new AbortController()
        const body = failingBody(failure, phase === 'POST' ? 201 : 200, caller)
        const unhandled = observeUnhandledRejections()
        const addListener = spyOn(caller.signal, 'addEventListener')
        const removeListener = spyOn(caller.signal, 'removeEventListener')
        let gets = 0
        let posts = 0
        const transport = createSupabaseManagementDatabaseApplyTransport({
          personalAccessToken: PAT,
          signal: failure === 'body error' ? undefined : caller.signal,
          fetcher: async (_url, init) => {
            if (init?.method === 'POST') posts += 1
            else gets += 1
            const failHere =
              phase === 'prepare' ||
              (phase === 'authority recheck' && gets === 2) ||
              (phase === 'POST' && init?.method === 'POST')
            return failHere ? body.response : projectResponse()
          }
        })
        let prepared: SupabaseManagementPreparedDatabaseApply | undefined
        const operation = (async () => {
          prepared = await transport.prepareReviewedMigration(context)
          if (phase !== 'prepare') await prepared.dispatch()
        })().catch((cause: unknown) => cause)
        try {
          await guarded(operation, async (cause) => {
            expect(cause).toBeInstanceOf(SupabaseManagementDatabaseApplyTransportError)
            const bodyError = expectedBodyError(failure)
            expect(cause).toMatchObject({
              code: phase === 'authority recheck' ? 'authority-recheck-failed' : bodyError
            })
            expect(String(cause)).not.toContain('canary')
            expect(String(cause)).not.toContain(PAT)
            expect(body.cancelCalls()).toBe(failure.startsWith('body error') ? 0 : 1)
            expect(body.response.body?.locked).toBe(false)
            expect(posts).toBe(phase === 'POST' ? 1 : 0)
            expect(removeListener.mock.calls).toHaveLength(addListener.mock.calls.length)
            if (failure === 'body abort') expect(addListener.mock.calls.length).toBeGreaterThan(0)
            if (prepared) expect(await errorCode(prepared.dispatch())).toBe('dispatch-already-used')
            expect(posts).toBe(phase === 'POST' ? 1 : 0)
          })
        } finally {
          body.finish()
          await operation
          addListener.mockRestore()
          removeListener.mockRestore()
          await unhandled.finish()
        }
      }
    )
  }

  test.each(FAILURES)('POST %s remains a journaled unknown with no retry', async (failure) => {
    const caller = new AbortController()
    const body = failingBody(failure, 201, caller)
    const unhandled = observeUnhandledRejections()
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let posts = 0
    const transport = createSupabaseManagementDatabaseApplyTransport({
      personalAccessToken: PAT,
      signal: failure === 'body error' ? undefined : caller.signal,
      fetcher: async (_url, init) => {
        if (init?.method !== 'POST') return projectResponse()
        posts += 1
        return body.response
      }
    })
    const operation = runBrandedApply(async (context) => {
      const prepared = await transport.prepareReviewedMigration(context)
      return {
        async dispatch() {
          const confirmation = await prepared.dispatch()
          return { ok: true as const, remoteOperationIds: confirmation.remoteOperationIds }
        }
      }
    }, journal)
    try {
      await guarded(operation, async (state) => {
        expect(state).toMatchObject({
          phase: 'receipt',
          outcome: 'outcome-unknown',
          dispatch: 'settled',
          automaticRetryAllowed: false,
          reconcileRequired: true
        })
        expect(state).toHaveProperty('receipt.outcome', 'outcome-unknown')
        expect(JSON.stringify(state)).not.toContain('canary')
        expect(body.cancelCalls()).toBe(failure.startsWith('body error') ? 0 : 1)
        expect(body.response.body?.locked).toBe(false)
        expect(posts).toBe(1)
        const retryTransport = createSupabaseManagementDatabaseApplyTransport({
          personalAccessToken: PAT,
          fetcher: async (_url, init) => {
            if (init?.method === 'POST') posts += 1
            return projectResponse()
          }
        })
        const retry = await runBrandedApply(async (context) => {
          const prepared = await retryTransport.prepareReviewedMigration(context)
          return {
            async dispatch() {
              const confirmation = await prepared.dispatch()
              return { ok: true as const, remoteOperationIds: confirmation.remoteOperationIds }
            }
          }
        }, journal)
        expect(retry.outcome).toBe('outcome-unknown')
        expect(retry.automaticRetryAllowed).toBe(false)
        expect(posts).toBe(1)
      })
    } finally {
      body.finish()
      await operation
      await unhandled.finish()
    }
  })
})
