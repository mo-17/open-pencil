/** Shared fail-closed helpers for correlated disposable and reusable module Workers. */
export function normalizeWorkerError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

export interface WorkerRequestCorrelation {
  request: object
  requestId: string
}

export interface WorkerBootstrapRuntimeLoaderOptions<TRuntime> {
  loadRuntime: () => Promise<TRuntime>
  now?: () => number
}

export interface PostWorkerRequestWithoutTransferOptions<TRequest> {
  worker: Pick<Worker, 'postMessage'>
  request: TRequest
  signal?: AbortSignal
  abort: () => void
  fail: (error: Error) => void
}

const WORKER_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

export function ownWorkerDataValue(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

/** Reads only the shallow, own-data correlation needed before a heavy Worker runtime loads. */
export function readWorkerRequestCorrelation(
  value: unknown,
  expectedVersion: number,
  expectedType: string
): WorkerRequestCorrelation | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const version = ownWorkerDataValue(value, 'version')
  const type = ownWorkerDataValue(value, 'type')
  const requestId = ownWorkerDataValue(value, 'requestId')
  if (
    version !== expectedVersion ||
    type !== expectedType ||
    typeof requestId !== 'string' ||
    !WORKER_REQUEST_ID_PATTERN.test(requestId)
  ) {
    return null
  }
  return { request: value, requestId }
}

/** Installs cancellation and posts without a transfer list so caller-owned buffers stay attached. */
export function postWorkerRequestWithoutTransfer<TRequest>(
  options: PostWorkerRequestWithoutTransferOptions<TRequest>
): void {
  options.signal?.addEventListener('abort', options.abort, { once: true })
  if (options.signal?.aborted) {
    options.abort()
    return
  }
  try {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- this is a Worker, not Window.postMessage.
    options.worker.postMessage(options.request)
  } catch (cause) {
    options.fail(normalizeWorkerError(cause))
  }
}

export function hasCorrelatedWorkerRequestId(value: unknown, expected: string): boolean {
  if (value === null || typeof value !== 'object') return false
  return Object.getOwnPropertyDescriptor(value, 'requestId')?.value === expected
}
