/* oxlint-disable unicorn/require-post-message-target-origin -- DedicatedWorkerGlobalScope has no target origin. */

import {
  readWorkerRequestCorrelation,
  type WorkerBootstrapRuntimeLoaderOptions
} from '@/app/workers/correlation'

import { MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION } from './worker-bootstrap-protocol'

export interface MiniProgramSourceCompilerWorkerRuntime {
  executeMiniProgramSourceCompilerWorkerRequest(
    value: unknown,
    scope: MiniProgramSourceCompilerWorkerBootstrapScope
  ): Promise<void>
}

export interface MiniProgramSourceCompilerWorkerBootstrapScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  postMessage(message: unknown): void
}

export type InstallMiniProgramSourceCompilerWorkerBootstrapOptions =
  WorkerBootstrapRuntimeLoaderOptions<MiniProgramSourceCompilerWorkerRuntime>

export interface MiniProgramSourceCompilerWorkerCorrelation {
  requestId: string
}

export function miniProgramSourceCompilerWorkerCorrelation(
  value: unknown
): MiniProgramSourceCompilerWorkerCorrelation | null {
  const correlation = readWorkerRequestCorrelation(
    value,
    MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
    'compile-miniprogram-source'
  )
  return correlation ? { requestId: correlation.requestId } : null
}

/**
 * Installs the message handler before importing the compiler module graph.
 * Mini-program compiler Workers are disposable and consume one correlated
 * request; cancellation is performed by terminating the Worker from the host.
 */
export function installMiniProgramSourceCompilerWorkerBootstrap(
  scope: MiniProgramSourceCompilerWorkerBootstrapScope,
  options: InstallMiniProgramSourceCompilerWorkerBootstrapOptions
): void {
  const now = options.now ?? (() => performance.now())
  let consumed = false

  scope.addEventListener('message', (event) => {
    if (consumed) return
    const correlation = miniProgramSourceCompilerWorkerCorrelation(event.data)
    if (!correlation) return
    consumed = true
    const startedAt = now()
    scope.postMessage({
      version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
      type: 'progress',
      requestId: correlation.requestId,
      stage: 'worker-load',
      elapsedMs: Math.max(0, now() - startedAt)
    })

    void options
      .loadRuntime()
      .then((runtime) => runtime.executeMiniProgramSourceCompilerWorkerRequest(event.data, scope))
      .catch(() => {
        scope.postMessage({
          version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
          type: 'error',
          requestId: correlation.requestId,
          error: 'Mini-program compiler Worker runtime failed to load'
        })
      })
  })
}
