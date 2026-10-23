import { describe, expect, test } from 'bun:test'

import {
  installVueSourceCompilerWorkerBootstrap,
  type VueSourceCompilerWorkerRuntime
} from '@/app/plugins/host/vue/compiler/bootstrap'
import type { VueSourceCompilerWorkerResponse } from '@/app/plugins/host/vue/compiler/protocol'
import { VUE_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION } from '@/app/plugins/host/vue/compiler/version'
import type { VueSourceWorkerEntryScope } from '@/app/plugins/host/vue/worker/entry'

const REQUEST_ID = 'vue-source-bootstrap-request-0001'

class FakeScope implements VueSourceWorkerEntryScope {
  readonly messages: unknown[] = []
  closeCount = 0
  private listener: ((event: MessageEvent<unknown>) => void) | null = null

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listener = listener
  }

  postMessage(value: unknown): void {
    this.messages.push(value)
  }

  close(): void {
    this.closeCount += 1
  }

  dispatch(data: unknown): void {
    this.listener?.(new MessageEvent('message', { data }))
  }
}

async function flushQueue(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

describe('Vue source compiler Worker bootstrap', () => {
  test('retains the initial request while its heavy runtime loads and executes only once', async () => {
    const scope = new FakeScope()
    let finishLoading: ((runtime: VueSourceCompilerWorkerRuntime) => void) | undefined
    const loading = new Promise<VueSourceCompilerWorkerRuntime>((resolve) => {
      finishLoading = resolve
    })
    let loads = 0
    let executions = 0
    const request = { requestId: REQUEST_ID }
    const response = {
      version: VUE_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
      type: 'result' as const,
      requestId: REQUEST_ID,
      output: { files: new Map([['src/App.vue', '<template>Saved</template>']]), warnings: [] }
    } satisfies VueSourceCompilerWorkerResponse
    installVueSourceCompilerWorkerBootstrap(scope, {
      loadRuntime() {
        loads += 1
        return loading
      }
    })

    scope.dispatch(request)
    scope.dispatch({ requestId: 'second-vue-source-bootstrap-request' })
    expect(loads).toBe(1)
    expect(scope.messages).toEqual([])
    expect(scope.closeCount).toBe(0)
    if (!finishLoading) throw new Error('Expected a pending compiler runtime')
    finishLoading({
      executeVueSourceCompilerWorkerRequest(value) {
        expect(value).toBe(request)
        executions += 1
        return response
      }
    })
    await flushQueue()

    expect(executions).toBe(1)
    expect(scope.messages).toEqual([response])
    expect(scope.closeCount).toBe(1)
  })

  test('correlates a failed runtime import with the initial request', async () => {
    const scope = new FakeScope()
    installVueSourceCompilerWorkerBootstrap(scope, {
      loadRuntime: () => Promise.reject(new Error('compiler runtime failed to load'))
    })
    scope.dispatch({ requestId: REQUEST_ID })
    await flushQueue()

    expect(scope.messages).toEqual([
      {
        version: VUE_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId: REQUEST_ID,
        error: 'compiler runtime failed to load'
      }
    ])
    expect(scope.closeCount).toBe(1)
  })
})
