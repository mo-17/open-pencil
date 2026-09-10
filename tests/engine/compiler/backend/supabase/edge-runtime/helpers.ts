import { Script } from 'node:vm'

import {
  createBackendProviderPlan,
  createBuiltinBackendProviderRegistry,
  emitBackendProviderPlan,
  SUPABASE_ARTIFACT_PATHS,
  SUPABASE_BACKEND_PROVIDER_DESCRIPTOR
} from '@open-pencil/compiler/backend'
import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

type Handler = (request: Request) => Promise<Response>
type Fetcher = (url: URL, init: RequestInit) => Promise<Response>

function emittedSource(method: 'POST' | 'PUT'): string {
  const application: BackendApplicationSpecV1 = {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'bounded-edge-streams',
    dataModel: { version: 1, entities: [], enums: [], relations: [] },
    auth: {
      version: 1,
      identities: [{ id: 'user', kind: 'user' }],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: []
    },
    workflows: {
      version: 1,
      workflows: [
        {
          id: 'outbound',
          name: 'Outbound request',
          trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
          parameters: ['url', 'value'],
          steps: [
            {
              id: 'send',
              kind: 'http.request',
              method,
              url: { kind: 'expression', expression: 'url' },
              body: { kind: 'expression', expression: 'value' },
              resultName: 'response'
            },
            { id: 'respond', kind: 'respond', value: 'response' }
          ]
        }
      ]
    },
    capabilities: [
      { capability: 'auth.identity', required: true },
      { capability: 'server.functions', required: true },
      { capability: 'server.http', required: true }
    ],
    secrets: []
  }
  const selection = {
    descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
    packageDigest: `app-bundle-sha256:${'A'.repeat(43)}`,
    enabled: true
  }
  const registry = createBuiltinBackendProviderRegistry()
  const planned = createBackendProviderPlan(registry, {
    selection,
    application,
    target: 'react',
    mode: 'production'
  })
  if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics))
  const emitted = emitBackendProviderPlan(registry, { plan: planned.plan, selection })
  if (!emitted.ok) throw new Error(JSON.stringify(emitted.diagnostics))
  const source = emitted.emission.files.get(SUPABASE_ARTIFACT_PATHS.serverRuntimeSource)
  if (typeof source !== 'string') throw new Error('Expected generated Edge runtime source')
  return source
}

export function generatedRuntime(fetcher: Fetcher, method: 'POST' | 'PUT' = 'POST') {
  const source = emittedSource(method)
  const firstLineEnd = source.indexOf('\n')
  if (
    source.slice(0, firstLineEnd) !==
    "import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.100.0'"
  ) {
    throw new Error('Unexpected generated runtime import')
  }
  // Execute the entire emitted handler with local host dependencies; never load the remote SDK.
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    source.slice(firstLineEnd + 1)
  )
  let handler: Handler | undefined
  let timerCallback: (() => void) | undefined
  const delays: number[] = []
  const calls: { url: URL; init: RequestInit }[] = []
  let clearedTimers = 0
  const environment: Record<string, string> = {
    SUPABASE_URL: 'https://local-fixture.supabase.co',
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_local_fixture' }),
    OPENPENCIL_OUTBOUND_HTTP_HOSTS: 'api.example.com'
  }
  new Script(javascript).runInNewContext({
    Request,
    Response,
    URL,
    TextEncoder,
    TextDecoder,
    AbortController,
    Deno: {
      env: { get: (name: string) => environment[name] },
      serve: (callback: Handler) => {
        handler = callback
      }
    },
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'local-user' } }, error: null }) }
    }),
    fetch: (url: URL, init: RequestInit) => {
      calls.push({ url, init })
      return fetcher(url, init)
    },
    setTimeout: (callback: () => void, delay: number) => {
      timerCallback = callback
      delays.push(delay)
      return 1
    },
    clearTimeout: () => {
      timerCallback = undefined
      clearedTimers += 1
    }
  })
  if (!handler) throw new Error('Generated handler did not register')
  return {
    handler,
    source,
    calls,
    delays,
    get clearedTimers() {
      return clearedTimers
    },
    expire() {
      if (!timerCallback) throw new Error('HTTP deadline is not active')
      timerCallback()
    }
  }
}

export function workflowRequest(url = 'https://api.example.com/write', value: unknown = {}) {
  return new Request('https://edge.example.com/runtime', {
    method: 'POST',
    headers: { authorization: 'Bearer local-user-access', 'content-type': 'application/json' },
    body: JSON.stringify({ workflowId: 'outbound', args: { url, value } })
  })
}

export function controlledStream(bytes?: number) {
  const cancellation = Promise.withResolvers<undefined>()
  const reading = Promise.withResolvers<undefined>()
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let cancelCalls = 0
  const unhandled: unknown[] = []
  const onUnhandled = (cause: unknown) => unhandled.push(cause)
  process.on('unhandledRejection', onUnhandled)
  const stream = new ReadableStream<Uint8Array>(
    {
      start(value) {
        controller = value
        if (bytes !== undefined) value.enqueue(new Uint8Array(bytes))
      },
      pull() {
        reading.resolve(undefined)
      },
      cancel() {
        cancelCalls += 1
        return cancellation.promise
      }
    },
    { highWaterMark: 0 }
  )
  return {
    stream,
    unhandled,
    reading: reading.promise,
    get cancelCalls() {
      return cancelCalls
    },
    enqueue(text: string) {
      controller?.enqueue(new TextEncoder().encode(text))
    },
    release() {
      // Also unwind a red baseline whose reader never observes the deadline.
      if (cancelCalls === 0) controller?.error(new Error('released test stream'))
      cancellation.reject(new Error('late cancellation failure: private upstream detail'))
      if (cancelCalls === 0) void cancellation.promise.catch(() => undefined)
    },
    async dispose(operation: Promise<unknown>) {
      try {
        await operation
        await Bun.sleep(0)
      } finally {
        process.removeListener('unhandledRejection', onUnhandled)
      }
    }
  }
}

export async function promptly<T>(operation: Promise<T>): Promise<T | 'still pending'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<'still pending'>((resolve) => {
        timer = setTimeout(() => resolve('still pending'), 100)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
