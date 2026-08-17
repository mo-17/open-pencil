import { describe, expect, test } from 'bun:test'

import {
  installBrowserPreviewWorkerBootstrap,
  type BrowserPreviewWorkerBootstrapScope,
  type BrowserPreviewWorkerRuntime
} from '@/app/lowcode/preview-pane/browser-worker/bootstrap'
import { BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION } from '@/app/lowcode/preview-pane/browser-worker/protocol'

const REQUEST_ID = 'browser-preview-request-0001'

class FakeScope implements BrowserPreviewWorkerBootstrapScope {
  readonly messages: unknown[] = []
  private listener: ((event: MessageEvent<unknown>) => void) | null = null

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listener = listener
  }

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  dispatch(data: unknown): void {
    this.listener?.({ data } as MessageEvent<unknown>)
  }
}

function request(generation = 7): object {
  return {
    version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
    type: 'build-browser-preview',
    requestId: REQUEST_ID,
    generation
  }
}

async function flushQueue(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

describe('browser preview Worker bootstrap', () => {
  test('reports worker-load before the heavy runtime resolves', async () => {
    const scope = new FakeScope()
    let resolveRuntime!: (runtime: BrowserPreviewWorkerRuntime) => void
    const runtimePromise = new Promise<BrowserPreviewWorkerRuntime>((resolve) => {
      resolveRuntime = resolve
    })
    let executed: unknown = null
    installBrowserPreviewWorkerBootstrap(scope, {
      loadRuntime: () => runtimePromise,
      now: () => 12
    })

    const value = request()
    scope.dispatch(value)
    await flushQueue()

    expect(scope.messages).toEqual([
      {
        version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
        type: 'progress',
        requestId: REQUEST_ID,
        generation: 7,
        stage: 'worker-load',
        elapsedMs: 0
      }
    ])
    resolveRuntime({
      async executeBrowserPreviewWorkerRequest(input: unknown) {
        executed = input
      }
    })
    await flushQueue()
    expect(executed).toBe(value)
  })

  test('returns a bounded correlated error when the runtime import fails', async () => {
    const scope = new FakeScope()
    installBrowserPreviewWorkerBootstrap(scope, {
      loadRuntime: () => Promise.reject(new Error('dynamic chunk missing')),
      now: () => 20
    })

    scope.dispatch(request(9))
    await flushQueue()

    expect(scope.messages).toEqual([
      {
        version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
        type: 'progress',
        requestId: REQUEST_ID,
        generation: 9,
        stage: 'worker-load',
        elapsedMs: 0
      },
      {
        version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId: REQUEST_ID,
        generation: 9,
        error: 'Browser preview Worker runtime failed to load: dynamic chunk missing'
      }
    ])
  })

  test('ignores an uncorrelated message without loading the heavy runtime', async () => {
    const scope = new FakeScope()
    let loadCalls = 0
    installBrowserPreviewWorkerBootstrap(scope, {
      loadRuntime: async () => {
        loadCalls += 1
        return { executeBrowserPreviewWorkerRequest: async () => undefined }
      }
    })

    scope.dispatch({ type: 'build-browser-preview', requestId: 'too-short', generation: 1 })
    await flushQueue()

    expect(loadCalls).toBe(0)
    expect(scope.messages).toEqual([])
  })
})
