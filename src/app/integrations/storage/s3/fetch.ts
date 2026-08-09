import { isTauri } from '@/app/tauri/env'

import { S3_RESPONSE_LIMITS, limitS3ResponseBody } from './response'

/** Avoid hung “Test connection” when CORS/network never resolves. */
const STORAGE_FETCH_TIMEOUT_MS = 20_000

function withTimeoutSignal(init?: RequestInit): {
  signal: AbortSignal
  timedOut: () => boolean
  cleanup: () => void
} {
  const controller = new AbortController()
  let didTimeOut = false
  const timer = setTimeout(() => {
    didTimeOut = true
    controller.abort(new DOMException('Storage request timed out', 'TimeoutError'))
  }, STORAGE_FETCH_TIMEOUT_MS)
  const external = init?.signal
  const abortFromExternal = () =>
    controller.abort(
      external?.reason ?? new DOMException('The operation was aborted', 'AbortError')
    )
  if (external) {
    if (external.aborted) abortFromExternal()
    else external.addEventListener('abort', abortFromExternal, { once: true })
  }
  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    cleanup: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', abortFromExternal)
    }
  }
}

/** Prefer Tauri HTTP bridge on desktop to avoid bucket CORS requirements. */
export async function storageFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  maxResponseBytes: number = S3_RESPONSE_LIMITS.metadataBytes,
  maxErrorResponseBytes: number = S3_RESPONSE_LIMITS.errorBytes
): Promise<Response> {
  const { signal, timedOut, cleanup } = withTimeoutSignal(init)
  let cleanupDeferredToBody = false
  try {
    if (isTauri()) {
      const { tauriFetch } = await import('@/app/tauri/http')
      const response = await tauriFetch(
        input,
        { ...init, signal },
        maxResponseBytes,
        STORAGE_FETCH_TIMEOUT_MS,
        undefined,
        maxErrorResponseBytes
      )
      return limitS3ResponseBody(response, response.ok ? maxResponseBytes : maxErrorResponseBytes)
    }
    // Request bodies are owned by the Request; re-wrap so we can attach a timeout signal.
    if (input instanceof Request) {
      const response = await fetch(new Request(input, { signal }))
      const bounded = limitS3ResponseBody(
        response,
        response.ok ? maxResponseBytes : maxErrorResponseBytes,
        { signal, onFinalize: cleanup }
      )
      cleanupDeferredToBody = true
      return bounded
    }
    const response = await fetch(input, { ...init, signal })
    const bounded = limitS3ResponseBody(
      response,
      response.ok ? maxResponseBytes : maxErrorResponseBytes,
      { signal, onFinalize: cleanup }
    )
    cleanupDeferredToBody = true
    return bounded
  } catch (error) {
    if (timedOut()) {
      throw new Error(
        'Storage request timed out. Check the endpoint URL, network, and bucket CORS settings.'
      )
    }
    if (signal.aborted) throw signal.reason ?? error
    throw error
  } finally {
    if (!cleanupDeferredToBody) cleanup()
  }
}
