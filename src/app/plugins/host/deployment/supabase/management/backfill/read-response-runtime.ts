import { waitForManagementOperation } from '../abortable-operation'
import type { SupabaseManagementRequestDeadline } from '../transport-runtime'

interface BackfillReadResponsePolicy {
  readonly abortMessage: string
  readonly fail: (code: 'invalid-response' | 'response-too-large') => never
}

/** Response lifetime only: fixed requests, authority and error classification stay in each owner. */
export function createBackfillReadDeadline(
  caller: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMessage: string
): SupabaseManagementRequestDeadline {
  const controller = new AbortController()
  let timedOut = false
  const onCallerAbort = () => controller.abort(caller?.reason)
  if (caller?.aborted) controller.abort(caller.reason)
  else caller?.addEventListener('abort', onCallerAbort, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException(timeoutMessage, 'TimeoutError'))
  }, timeoutMs)
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timeout)
      caller?.removeEventListener('abort', onCallerAbort)
    }
  }
}

export function waitForBackfillRead<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  abortMessage: string
): Promise<T> {
  return waitForManagementOperation(
    operation,
    signal,
    () => new DOMException(abortMessage, 'AbortError')
  )
}

function validJSONMediaType(response: Response): boolean {
  const value = response.headers.get('content-type')?.trim().toLowerCase()
  return value !== undefined && /^application\/json(?:\s*;\s*charset=utf-8)?$/u.test(value)
}

export async function readBackfillJSON(
  response: Response,
  maximum: number,
  signal: AbortSignal,
  { abortMessage, fail }: BackfillReadResponsePolicy
): Promise<unknown> {
  if (!validJSONMediaType(response)) return fail('invalid-response')
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) return fail('invalid-response')
    const parsed = Number(contentLength)
    if (!Number.isSafeInteger(parsed)) return fail('invalid-response')
    if (parsed > maximum) {
      void response.body?.cancel().catch(() => undefined)
      return fail('response-too-large')
    }
  }
  if (!response.body) return fail('invalid-response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    let chunk = await waitForBackfillRead(reader.read(), signal, abortMessage)
    while (!chunk.done) {
      byteLength += chunk.value.byteLength
      if (byteLength > maximum) {
        void reader.cancel().catch(() => undefined)
        return fail('response-too-large')
      }
      chunks.push(chunk.value)
      chunk = await waitForBackfillRead(reader.read(), signal, abortMessage)
    }
  } catch (cause) {
    void reader.cancel().catch(() => undefined)
    throw cause
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return fail('invalid-response')
  }
}
