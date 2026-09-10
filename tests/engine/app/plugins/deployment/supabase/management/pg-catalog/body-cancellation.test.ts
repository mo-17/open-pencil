import { describe, expect, spyOn, test } from 'bun:test'

import {
  createSupabaseManagementPgCatalogTransport,
  SupabaseManagementPgCatalogTransportError
} from '@/app/plugins/host/deployment/supabase/management/pg-catalog-transport'
import {
  SUPABASE_PG_CATALOG_FIXED_QUERIES,
  SUPABASE_PG_CATALOG_QUERY_VERSION,
  type SupabasePgCatalogReadRequest
} from '@/app/plugins/host/deployment/supabase/pg-catalog-inspector'

const AUTHORITY = {
  projectRef: 'enekobitnhobuiuamvqj',
  grantGeneration: '123e4567-e89b-42d3-a456-426614174000'
}
const PROJECT = { ref: AUTHORITY.projectRef, organization_id: 'org-123', organization_slug: 'test' }
const REQUEST: SupabasePgCatalogReadRequest = {
  ...AUTHORITY,
  accountId: PROJECT.organization_id,
  queryVersion: SUPABASE_PG_CATALOG_QUERY_VERSION,
  schema: 'public',
  snapshotScope: 'single-statement',
  accessMode: 'read-only',
  queries: SUPABASE_PG_CATALOG_FIXED_QUERIES.map((query) => ({
    queryId: query.queryId,
    parameters: { schema: 'public', rowLimit: query.maximumRows + 1 }
  }))
}

for (const phase of ['authority', 'catalog'] as const) {
  describe(`${phase} response body cancellation`, () => {
    test.each([
      ['abort', 'aborted'],
      ['streamed-overflow', 'response-too-large'],
      ['declared-overflow', 'response-too-large'],
      ['body-error', 'network-failed']
    ] as const)(
      '%s settles with a static error before cleanup resolves',
      async (scenario, expectedCode) => {
        const caller = new AbortController()
        let rejectCancellation: (cause: unknown) => void = () => undefined
        const cancellation = new Promise<void>((_resolve, reject) => {
          rejectCancellation = reject
        })
        let response: Response | undefined
        let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
        let cancelCalls = 0
        const methods: string[] = []
        const failures: unknown[] = []
        const onUnhandled = (cause: unknown) => failures.push(cause)
        process.on('unhandledRejection', onUnhandled)
        const transport = createSupabaseManagementPgCatalogTransport({
          personalAccessToken: 'sbp_catalog_body_test_canary_1234567890',
          signal: caller.signal,
          fetcher: async (_url, init, maximum) => {
            methods.push(init?.method ?? '')
            if (phase === 'catalog' && init?.method === 'GET') return Response.json(PROJECT)
            const body = new ReadableStream<Uint8Array>(
              {
                start(controller) {
                  streamController = controller
                  if (scenario === 'streamed-overflow')
                    controller.enqueue(new Uint8Array(maximum + 1))
                },
                pull(controller) {
                  if (scenario === 'abort')
                    queueMicrotask(() => caller.abort(new Error('private abort canary')))
                  if (scenario === 'body-error') controller.error(new Error('private body canary'))
                },
                cancel() {
                  cancelCalls += 1
                  return cancellation
                }
              },
              { highWaterMark: 0 }
            )
            response = new Response(body, {
              status: phase === 'authority' ? 200 : 201,
              headers: {
                'content-type': 'application/json',
                ...(scenario === 'declared-overflow'
                  ? { 'content-length': String(maximum + 1) }
                  : {})
              }
            })
            return response
          }
        })
        const operation = (async () => {
          const authority = await transport.getProjectAuthority(AUTHORITY)
          return phase === 'authority' ? authority : transport.runReadOnlyCatalogQueries(REQUEST)
        })().catch((cause: unknown) => cause)
        let guard: ReturnType<typeof setTimeout> | undefined
        try {
          const failure = await Promise.race([
            operation,
            new Promise<string>((resolve) => {
              guard = setTimeout(() => resolve('body cancellation blocked the result'), 100)
            })
          ])
          expect(failure).toBeInstanceOf(SupabaseManagementPgCatalogTransportError)
          expect(failure).toMatchObject({ code: expectedCode })
          expect(String(failure)).not.toContain('canary')
          expect(cancelCalls).toBe(scenario === 'body-error' ? 0 : 1)
          expect(response?.body?.locked).toBe(false)
          expect(methods).toEqual(phase === 'authority' ? ['GET'] : ['GET', 'POST'])
        } finally {
          clearTimeout(guard)
          caller.abort()
          // Close the old pending read too, so a failing baseline cannot leave a hanging test.
          if (scenario === 'abort' && cancelCalls === 0) streamController?.close()
          if (cancelCalls > 0) rejectCancellation(new Error('late cleanup canary'))
          await operation
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 0)
          })
          process.removeListener('unhandledRejection', onUnhandled)
        }
        expect(failures).toEqual([])
      }
    )
  })
}

test('detaches successful body reads from a reusable caller signal', async () => {
  const caller = new AbortController()
  const additions = spyOn(caller.signal, 'addEventListener')
  const removals = spyOn(caller.signal, 'removeEventListener')
  let cancelCalls = 0
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(JSON.stringify(PROJECT))
        controller.enqueue(bytes.slice(0, 12))
        controller.enqueue(bytes.slice(12))
        controller.close()
      },
      cancel() {
        cancelCalls += 1
      }
    }),
    { headers: { 'content-type': 'application/json' } }
  )
  try {
    const transport = createSupabaseManagementPgCatalogTransport({
      personalAccessToken: 'sbp_catalog_body_test_canary_1234567890',
      signal: caller.signal,
      fetcher: async () => response
    })
    expect(await transport.getProjectAuthority(AUTHORITY)).toMatchObject({
      projectRef: AUTHORITY.projectRef
    })
    expect(response.body?.locked).toBe(false)
    const registered = additions.mock.calls
      .filter(([event]) => event === 'abort')
      .map(([, listener]) => listener)
    const detached = removals.mock.calls
      .filter(([event]) => event === 'abort')
      .map(([, listener]) => listener)
    expect(detached).toEqual(registered)
    caller.abort()
    expect(cancelCalls).toBe(0)
  } finally {
    additions.mockRestore()
    removals.mockRestore()
  }
})
