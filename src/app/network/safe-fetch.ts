export interface RequestClock {
  readonly signal: AbortSignal
  dispose(): void
}

export interface RequestClockOptions {
  readonly callerSignal?: AbortSignal
  readonly timeoutMs: number
  readonly maximumTimeoutMs: number
  readonly label: string
}

export function createRequestClock(options: RequestClockOptions): RequestClock {
  const { callerSignal, timeoutMs, maximumTimeoutMs, label } = options
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > maximumTimeoutMs) {
    throw new TypeError(`${label} timeoutMs must be an integer from 1 to ${maximumTimeoutMs}`)
  }
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(callerSignal?.reason)
  if (callerSignal?.aborted) forwardAbort()
  else callerSignal?.addEventListener('abort', forwardAbort, { once: true })
  const timer = setTimeout(() => {
    controller.abort(
      new DOMException(`${label} request timed out after ${timeoutMs}ms`, 'TimeoutError')
    )
  }, timeoutMs)
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', forwardAbort)
    }
  }
}

export function noCredentialGetRequest(accept: string, signal: AbortSignal): RequestInit {
  return {
    method: 'GET',
    headers: new Headers({ accept }),
    mode: 'cors',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    signal
  }
}

export function strictContentLength(value: string | null, label: string): number | undefined {
  if (value === null) return undefined
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new TypeError(`${label} returned an invalid Content-Length`)
  }
  const length = Number(value)
  if (!Number.isSafeInteger(length)) {
    throw new TypeError(`${label} returned an invalid Content-Length`)
  }
  return length
}

export async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
  label: string
): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  let complete = false
  const cancelForAbort = () => void reader.cancel(signal.reason).catch(() => undefined)
  signal.addEventListener('abort', cancelForAbort, { once: true })
  try {
    for (let result = await reader.read(); !result.done; result = await reader.read()) {
      throwIfAborted(signal)
      if (result.value.byteLength > maxBytes - length) {
        const error = new Error(`${label} exceeds the ${maxBytes} byte limit`)
        await reader.cancel(error).catch(() => undefined)
        throw error
      }
      chunks.push(result.value.slice())
      length += result.value.byteLength
    }
    throwIfAborted(signal)
    complete = true
  } catch (error) {
    if (!complete) await reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    signal.removeEventListener('abort', cancelForAbort)
    reader.releaseLock()
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal)
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError(signal))
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
        return undefined
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error instanceof Error ? error : new Error(String(error)))
        return undefined
      }
    )
  })
}

export function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  const message = signal.reason === undefined ? 'The operation was aborted' : String(signal.reason)
  return new DOMException(message, 'AbortError')
}
