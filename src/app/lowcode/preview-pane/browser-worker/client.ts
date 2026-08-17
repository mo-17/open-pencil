import { createPluginExportAbortError } from '@/app/plugins/host/exporter-abort'
import type { VueSourceWorkerLike } from '@/app/plugins/host/vue/worker/client'
import { hasCorrelatedWorkerRequestId, normalizeWorkerError } from '@/app/workers/correlation'

import { BROWSER_PREVIEW_WORKER_LIMITS } from './limits'
import {
  createBrowserPreviewWorkerRequest,
  parseBrowserPreviewWorkerResponse,
  type BrowserPreviewWorkerBuildResult,
  type BrowserPreviewWorkerRequest,
  type CreateBrowserPreviewWorkerRequestInput
} from './protocol'

export type BrowserPreviewWorkerLike = VueSourceWorkerLike

export interface CreateBrowserPreviewWorkerClientOptions {
  workerFactory?: () => BrowserPreviewWorkerLike
  /** Maximum silence between validated Worker stage messages. */
  timeoutMs?: number
  /** Hard request ceiling even when stage progress continues. */
  totalTimeoutMs?: number
  idleTimeoutMs?: number
}

const DEFAULT_IDLE_TIMEOUT_MS = 30_000

function defaultWorkerFactory(): BrowserPreviewWorkerLike {
  return new Worker(new URL('./worker.ts', import.meta.url), {
    name: 'openpencil-browser-preview',
    type: 'module'
  })
}

function resolveTimeout(value: number | undefined): number {
  const timeout = value ?? BROWSER_PREVIEW_WORKER_LIMITS.timeoutMs
  if (
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    timeout > BROWSER_PREVIEW_WORKER_LIMITS.timeoutMs
  ) {
    throw new TypeError(
      `Browser preview Worker timeout must be between 1 and ${BROWSER_PREVIEW_WORKER_LIMITS.timeoutMs}ms`
    )
  }
  return timeout
}

function resolveIdleTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_IDLE_TIMEOUT_MS
  if (
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    timeout > BROWSER_PREVIEW_WORKER_LIMITS.timeoutMs
  ) {
    throw new TypeError(
      `Browser preview Worker idle timeout must be between 1 and ${BROWSER_PREVIEW_WORKER_LIMITS.timeoutMs}ms`
    )
  }
  return timeout
}

function resolveTotalTimeout(value: number | undefined, stageTimeoutMs: number): number {
  const timeout = value ?? BROWSER_PREVIEW_WORKER_LIMITS.totalTimeoutMs
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < stageTimeoutMs ||
    timeout > BROWSER_PREVIEW_WORKER_LIMITS.totalTimeoutMs
  ) {
    throw new TypeError(
      `Browser preview Worker total timeout must be between ${stageTimeoutMs} and ${BROWSER_PREVIEW_WORKER_LIMITS.totalTimeoutMs}ms`
    )
  }
  return timeout
}

export function createBrowserPreviewWorkerClient(
  options: CreateBrowserPreviewWorkerClientOptions = {}
) {
  const workerFactory = options.workerFactory ?? defaultWorkerFactory
  const timeoutMs = resolveTimeout(options.timeoutMs)
  const totalTimeoutMs = resolveTotalTimeout(options.totalTimeoutMs, timeoutMs)
  const idleTimeoutMs = resolveIdleTimeout(options.idleTimeoutMs)
  let worker: BrowserPreviewWorkerLike | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let activeCancel: ((reason: Error) => void) | null = null
  let disposed = false

  function clearIdleTimer(): void {
    if (idleTimer === null) return
    clearTimeout(idleTimer)
    idleTimer = null
  }

  function terminateWorker(expected: BrowserPreviewWorkerLike | null = worker): void {
    clearIdleTimer()
    if (!expected) return
    expected.onmessage = null
    expected.onerror = null
    if (worker === expected) worker = null
    expected.terminate()
  }

  function scheduleIdleTermination(expected: BrowserPreviewWorkerLike): void {
    clearIdleTimer()
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (!activeCancel && worker === expected) terminateWorker(expected)
    }, idleTimeoutMs)
  }

  function currentWorker(): BrowserPreviewWorkerLike {
    if (disposed) throw new Error('Browser preview Worker client has been disposed')
    clearIdleTimer()
    worker ??= workerFactory()
    return worker
  }

  function runRequest(
    request: BrowserPreviewWorkerRequest,
    signal?: AbortSignal
  ): Promise<BrowserPreviewWorkerBuildResult> {
    if (disposed)
      return Promise.reject(new Error('Browser preview Worker client has been disposed'))
    if (signal?.aborted) {
      terminateWorker()
      return Promise.reject(createPluginExportAbortError())
    }

    let current: BrowserPreviewWorkerLike
    try {
      current = currentWorker()
    } catch (cause) {
      return Promise.reject(normalizeWorkerError(cause))
    }

    return new Promise<BrowserPreviewWorkerBuildResult>((resolve, reject) => {
      let settled = false
      let stageTimer: ReturnType<typeof setTimeout> | null = null
      let totalTimer: ReturnType<typeof setTimeout> | null = null
      let currentStage = 'starting'

      const finish = (reuseWorker: boolean, operation: () => void): void => {
        if (settled) return
        settled = true
        if (stageTimer !== null) clearTimeout(stageTimer)
        if (totalTimer !== null) clearTimeout(totalTimer)
        signal?.removeEventListener('abort', abort)
        current.onmessage = null
        current.onerror = null
        if (activeCancel === cancel) activeCancel = null
        if (reuseWorker && !disposed) scheduleIdleTermination(current)
        else terminateWorker(current)
        operation()
      }
      const cancel = (reason: Error): void => finish(false, () => reject(reason))
      const abort = (): void => cancel(createPluginExportAbortError())
      const scheduleStageTimeout = (): void => {
        if (stageTimer !== null) clearTimeout(stageTimer)
        stageTimer = setTimeout(
          () =>
            cancel(
              new Error(
                `Browser preview Worker exceeded ${timeoutMs}ms during stage "${currentStage}"`
              )
            ),
          timeoutMs
        )
      }
      activeCancel = cancel
      scheduleStageTimeout()
      totalTimer = setTimeout(
        () =>
          cancel(
            new Error(
              `Browser preview Worker exceeded the ${totalTimeoutMs}ms total limit during stage "${currentStage}"`
            )
          ),
        totalTimeoutMs
      )

      current.onmessage = (event) => {
        try {
          const response = parseBrowserPreviewWorkerResponse(
            event.data,
            request.requestId,
            request.generation
          )
          if (!response) {
            if (hasCorrelatedWorkerRequestId(event.data, request.requestId)) {
              cancel(new Error('Browser preview Worker returned an invalid response'))
            }
            return
          }
          if (response.type === 'error') {
            cancel(new Error(`Browser preview Worker failed: ${response.error}`))
            return
          }
          if (response.type === 'progress') {
            currentStage = response.stage
            scheduleStageTimeout()
            return
          }
          const result = response.result
          finish(result.status !== 'error', () => resolve(result))
        } catch (cause) {
          cancel(normalizeWorkerError(cause))
        }
      }
      current.onerror = (event) =>
        cancel(new Error(event.message || 'Browser preview Worker failed'))
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) {
        abort()
        return
      }
      try {
        // No transfer list: editor-owned graph and asset buffers must remain
        // attached for retry, warning display, and cancellation recovery.
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- this is a Worker, not Window.postMessage.
        current.postMessage(request)
      } catch (cause) {
        cancel(normalizeWorkerError(cause))
      }
    })
  }

  function build(
    input: CreateBrowserPreviewWorkerRequestInput,
    channelId: string,
    signal?: AbortSignal
  ): Promise<BrowserPreviewWorkerBuildResult> {
    if (disposed)
      return Promise.reject(new Error('Browser preview Worker client has been disposed'))
    if (signal?.aborted) return Promise.reject(createPluginExportAbortError())
    if (activeCancel) {
      return Promise.reject(new Error('Browser preview Worker already has an active build'))
    }
    let request: BrowserPreviewWorkerRequest
    try {
      request = createBrowserPreviewWorkerRequest(input, crypto.randomUUID(), channelId)
    } catch (cause) {
      return Promise.reject(normalizeWorkerError(cause))
    }
    return runRequest(request, signal)
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    if (activeCancel) activeCancel(createPluginExportAbortError())
    else terminateWorker()
  }

  return Object.freeze({ build, dispose })
}
