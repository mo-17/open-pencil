import { createPluginExportAbortError } from '@/app/plugins/host/exporter-abort'

export type VueSourceWorkerLike = Pick<
  Worker,
  'onmessage' | 'onerror' | 'postMessage' | 'terminate'
>

export interface VueSourceWorkerClientOptions<
  TWorker extends VueSourceWorkerLike = VueSourceWorkerLike
> {
  workerFactory?: () => TWorker
  timeoutMs?: number
}

interface RunVueSourceWorkerRequestOptions<TRequest, TResponse, TResult> {
  label: string
  parseResponse(value: unknown, requestId: string): TResponse | null
  readResponse(response: TResponse): TResult
  request: TRequest
  requestId: string
  signal?: AbortSignal
  timeoutMs: number
  workerFactory(): VueSourceWorkerLike
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function hasCorrelatedRequestId(value: unknown, expected: string): boolean {
  if (value === null || typeof value !== 'object') return false
  return Object.getOwnPropertyDescriptor(value, 'requestId')?.value === expected
}

export function resolveVueSourceWorkerTimeout(value: number | undefined, label: string): number {
  const resolved = value ?? 60_000
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > 60_000) {
    throw new TypeError(`${label} timeout must be between 1 and 60000ms`)
  }
  return resolved
}

export function runVueSourceWorkerRequest<TRequest, TResponse, TResult>(
  options: RunVueSourceWorkerRequestOptions<TRequest, TResponse, TResult>
): Promise<TResult> {
  const { label, request, requestId, signal, timeoutMs } = options
  if (signal?.aborted) return Promise.reject(createPluginExportAbortError())
  const worker = options.workerFactory()

  return new Promise<TResult>((resolve, reject) => {
    let settled = false
    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      operation()
    }
    const abort = () => finish(() => reject(createPluginExportAbortError()))
    const timer = setTimeout(
      () => finish(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`))),
      timeoutMs
    )

    worker.onmessage = (event) => {
      try {
        const response = options.parseResponse(event.data, requestId)
        if (!response) {
          if (hasCorrelatedRequestId(event.data, requestId)) {
            finish(() => reject(new Error(`${label} returned an invalid response`)))
          }
          return
        }
        const result = options.readResponse(response)
        finish(() => resolve(result))
      } catch (cause) {
        finish(() => reject(asError(cause)))
      }
    }
    worker.onerror = (event) => finish(() => reject(new Error(event.message || `${label} failed`)))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    try {
      // No transfer list: editor-owned graph and asset buffers must remain
      // attached for retry, warning display, and cancellation recovery.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- this is a Worker, not Window.postMessage.
      worker.postMessage(request)
    } catch (cause) {
      finish(() => reject(asError(cause)))
    }
  })
}
