/// <reference lib="webworker" />
/* oxlint-disable unicorn/require-post-message-target-origin -- DedicatedWorkerGlobalScope postMessage has no target origin. */

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

interface VueSourceWorkerEntryOptions {
  defaultError: string
  execute(value: unknown): void | Promise<void>
  errorResponse(requestId: string, error: string): unknown
}

function candidateRequestId(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null
  const descriptor = Object.getOwnPropertyDescriptor(value, 'requestId')
  return typeof descriptor?.value === 'string' && REQUEST_ID_PATTERN.test(descriptor.value)
    ? descriptor.value
    : null
}

export function vueSourceWorkerErrorResponse<TVersion extends number>(
  version: TVersion,
  requestId: string,
  error: string
) {
  return { version, type: 'error' as const, requestId, error }
}

export function installVueSourceWorkerEntry(options: VueSourceWorkerEntryOptions): void {
  let consumed = false
  globalThis.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (consumed) return
    consumed = true
    const fallbackRequestId = candidateRequestId(event.data)
    void (async () => {
      try {
        await options.execute(event.data)
      } catch (cause) {
        if (fallbackRequestId) {
          const message = cause instanceof Error ? cause.message : options.defaultError
          globalThis.postMessage(options.errorResponse(fallbackRequestId, message.slice(0, 2_048)))
        }
      } finally {
        globalThis.close()
      }
    })()
  })
}
