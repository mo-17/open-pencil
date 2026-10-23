/* oxlint-disable unicorn/require-post-message-target-origin -- DedicatedWorkerGlobalScope postMessage has no target origin. */

import {
  installVueSourceWorkerEntry,
  vueSourceWorkerErrorResponse,
  type VueSourceWorkerEntryScope
} from '../worker/entry'
import type { VueSourceCompilerWorkerResponse } from './protocol'
import { VUE_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION } from './version'

export interface VueSourceCompilerWorkerRuntime {
  executeVueSourceCompilerWorkerRequest(value: unknown): VueSourceCompilerWorkerResponse
}

export interface VueSourceCompilerWorkerBootstrapOptions {
  loadRuntime(): Promise<VueSourceCompilerWorkerRuntime>
}

/** Keep the first request queued across the compiler's top-level WASM initialization. */
export function installVueSourceCompilerWorkerBootstrap(
  scope: VueSourceWorkerEntryScope,
  options: VueSourceCompilerWorkerBootstrapOptions
): void {
  installVueSourceWorkerEntry(
    {
      defaultError: 'Vue compiler Worker failed',
      async execute(value) {
        const runtime = await options.loadRuntime()
        scope.postMessage(runtime.executeVueSourceCompilerWorkerRequest(value))
      },
      errorResponse(requestId, error) {
        return vueSourceWorkerErrorResponse(
          VUE_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
          requestId,
          error
        ) satisfies VueSourceCompilerWorkerResponse
      }
    },
    scope
  )
}
