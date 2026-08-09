type NativeTransferResponse = {
  status: number
  headers: ReadonlyArray<{ name: string; value: string }>
}

export type GoogleDriveTransferSleep = (delayMs: number, signal: AbortSignal) => Promise<void>

const MAX_CONTINUATION_ATTEMPTS = 4
const MAX_RETRY_AFTER_MS = 60_000

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}

export const defaultGoogleDriveTransferSleep: GoogleDriveTransferSleep = (delayMs, signal) => {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal.addEventListener('abort', onAbort, { once: true })

    function onAbort() {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(abortReason(signal))
    }
  })
}

function responseHeader(response: NativeTransferResponse, name: string): string | null {
  const expected = name.toLowerCase()
  const matches = response.headers.filter((header) => header.name.toLowerCase() === expected)
  return matches.length === 1 ? (matches[0]?.value ?? null) : null
}

function retryAfterDelay(value: string | null, now = Date.now()): number | null {
  if (value === null || value.length === 0) return null
  const seconds = Number(value)
  let delay: number
  if (Number.isFinite(seconds)) delay = seconds < 0 ? Number.NaN : seconds * 1_000
  else delay = Date.parse(value) - now
  return Number.isFinite(delay)
    ? Math.min(Math.max(0, Math.round(delay)), MAX_RETRY_AFTER_MS)
    : null
}

function retryDelay(response: NativeTransferResponse | null, attempt: number): number {
  return (
    retryAfterDelay(response ? responseHeader(response, 'retry-after') : null) ??
    Math.min(250 * 2 ** Math.max(0, attempt - 1), 4_000)
  )
}

function retryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

function retryableError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false
  const code = (error as Error & { code?: unknown }).code
  return code === 'network-failed' || code === 'timeout'
}

export function parseStrongGoogleDriveEtag(value: string | null): string | null | undefined {
  if (value === null) return null
  if (value.length < 2 || value.length > 1_024 || value[0] !== '"' || value.at(-1) !== '"') {
    return undefined
  }
  for (let index = 1; index < value.length - 1; index++) {
    const code = value.charCodeAt(index)
    if (code !== 0x21 && (code < 0x23 || code > 0x7e)) return undefined
  }
  return value
}

export function linkedGoogleDriveAbortController(signal: AbortSignal): {
  controller: AbortController
  cleanup: () => void
} {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal.reason)
  if (signal.aborted) controller.abort(signal.reason)
  else signal.addEventListener('abort', onAbort, { once: true })
  return {
    controller,
    cleanup: () => signal.removeEventListener('abort', onAbort)
  }
}

export async function retryGoogleDriveContinuation<T extends NativeTransferResponse>(
  request: () => Promise<T>,
  sleep: GoogleDriveTransferSleep,
  signal: AbortSignal,
  retryLimitError: () => Error
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_CONTINUATION_ATTEMPTS; attempt++) {
    signal.throwIfAborted()
    let response: T
    try {
      response = await request()
    } catch (error) {
      signal.throwIfAborted()
      if (!retryableError(error)) throw error
      if (attempt === MAX_CONTINUATION_ATTEMPTS) throw retryLimitError()
      await sleep(retryDelay(null, attempt), signal)
      continue
    }
    if (!retryableStatus(response.status)) return response
    if (attempt === MAX_CONTINUATION_ATTEMPTS) throw retryLimitError()
    await sleep(retryDelay(response, attempt), signal)
  }
  throw retryLimitError()
}
