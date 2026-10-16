interface SupabaseManagementAbortScope {
  readonly signal: AbortSignal
}

interface SupabaseManagementDisposableScope {
  readonly dispose: () => void
}

/** Shared lifetime returned by Management transports that only merge abort signals. */
export type SupabaseManagementRequestLifetime = SupabaseManagementAbortScope &
  SupabaseManagementDisposableScope

/** Shared lifetime returned by Management transports that distinguish deadline expiry. */
export type SupabaseManagementRequestDeadline = SupabaseManagementRequestLifetime & {
  readonly timedOut: () => boolean
}

interface SupabaseManagementResponseBody {
  readonly bytes: Uint8Array
}

/** Bounded response snapshot retained after the native/fetch response body is consumed. */
export type SupabaseManagementBoundedResponse = Pick<Response, 'status' | 'url' | 'redirected'> &
  SupabaseManagementResponseBody & {
    readonly contentType: string | null
  }

export function isSupabaseManagementToken(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    new TextEncoder().encode(value).byteLength <= maximumBytes &&
    !/\p{Cc}/u.test(value)
  )
}

export function supabaseManagementTimeout(
  value: unknown,
  maximum: number,
  invalid: () => never
): number {
  if (value === undefined) return maximum
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum)
    return invalid()
  return value as number
}

export function managementAbortReason(signal: AbortSignal, message: string): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException(message, 'AbortError')
}

export async function fetchManagementResponse(
  fetcher: (
    url: RequestInfo | URL,
    init: RequestInit | undefined,
    maximum: number,
    timeoutMs: number
  ) => Promise<Response>,
  url: string,
  init: RequestInit,
  maximum: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  checkAbort: () => void,
  networkFailure: () => never
): Promise<Response> {
  checkAbort()
  let response: Response
  try {
    response = await fetcher(url, { ...init, redirect: 'error', signal }, maximum, timeoutMs)
  } catch {
    checkAbort()
    return networkFailure()
  }
  checkAbort()
  return response
}

export function fetchAbortableManagementResponse(
  fetcher: Parameters<typeof fetchManagementResponse>[0],
  url: string,
  init: RequestInit,
  maximum: number,
  timeoutMs: number,
  signal: AbortSignal,
  wait: <T>(operation: Promise<T>, signal: AbortSignal) => Promise<T>
): Promise<Response> {
  return wait(fetcher(url, { ...init, redirect: 'error', signal }, maximum, timeoutMs), signal)
}

export function createManagementResponseRequester<Context>(
  wait: <T>(operation: Promise<T>, signal: AbortSignal) => Promise<T>,
  checkAbort: (signal: AbortSignal) => void,
  rejectRedirect: (context: Context) => never
) {
  return async (
    fetcher: Parameters<typeof fetchManagementResponse>[0],
    url: string,
    init: RequestInit,
    maximum: number,
    timeoutMs: number,
    signal: AbortSignal,
    context: Context
  ): Promise<Response> => {
    checkAbort(signal)
    const response = await fetchAbortableManagementResponse(
      fetcher,
      url,
      init,
      maximum,
      timeoutMs,
      signal,
      wait
    )
    checkAbort(signal)
    if (response.redirected || (response.url !== '' && response.url !== url))
      return rejectRedirect(context)
    return response
  }
}

export function createManagementRequestDeadline(
  caller: AbortSignal | undefined,
  timeoutMs: number,
  message: string,
  scheduleAfterAbort = false
): SupabaseManagementRequestDeadline {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const onCallerAbort = () => controller.abort(caller?.reason)
  if (caller?.aborted) controller.abort(caller.reason)
  else caller?.addEventListener('abort', onCallerAbort, { once: true })
  if (!caller?.aborted || scheduleAfterAbort) {
    timeout = setTimeout(() => {
      timedOut = true
      controller.abort(new DOMException(message, 'TimeoutError'))
    }, timeoutMs)
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      if (timeout !== undefined) clearTimeout(timeout)
      caller?.removeEventListener('abort', onCallerAbort)
    }
  }
}
