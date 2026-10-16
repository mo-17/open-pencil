import { waitForManagementOperation } from '../abortable-operation'
import {
  collectManagementResponseChunks,
  joinManagementResponseChunks,
  parseManagementResponseJSON
} from '../response-body'
import { createManagementRequestDeadline } from '../transport-runtime'
import type { SupabaseManagementRequestDeadline } from '../transport-runtime'

interface BackfillReadResponsePolicy {
  readonly abortMessage: string
  readonly fail: (code: 'invalid-response' | 'response-too-large') => never
}

interface BackfillReadRequestPolicy {
  readonly abortMessage: string
  readonly timeoutMessage: string
  readonly ownsError: (cause: unknown) => boolean
  readonly fail: (
    code:
      | 'aborted'
      | 'timeout'
      | 'network-failed'
      | 'http-error'
      | 'invalid-response'
      | 'response-too-large'
  ) => never
}

type BackfillReadFetch = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  maximum: number,
  timeoutMs: number
) => Promise<Response>

/** Response lifetime only: fixed requests, authority and error classification stay in each owner. */
export function createBackfillReadDeadline(
  caller: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMessage: string
): SupabaseManagementRequestDeadline {
  return createManagementRequestDeadline(caller, timeoutMs, timeoutMessage, true)
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

export function discardUnreadBackfillResponse(response: Response): void {
  const body = response.body
  if (!body || response.bodyUsed || body.locked) return
  void body.cancel().catch(() => undefined)
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
  try {
    if (!validJSONMediaType(response)) return fail('invalid-response')
    const contentLength = response.headers.get('content-length')
    if (contentLength !== null) {
      if (!/^\d+$/u.test(contentLength)) return fail('invalid-response')
      const parsed = Number(contentLength)
      if (!Number.isSafeInteger(parsed)) return fail('invalid-response')
      if (parsed > maximum) return fail('response-too-large')
    }
  } catch (cause) {
    void response.body?.cancel().catch(() => undefined)
    throw cause
  }
  if (!response.body) return fail('invalid-response')
  const reader = response.body.getReader()
  let collected: Awaited<ReturnType<typeof collectManagementResponseChunks>>
  try {
    collected = await collectManagementResponseChunks(
      reader,
      maximum,
      (bodyReader) => waitForBackfillRead(bodyReader.read(), signal, abortMessage),
      (reader) => {
        void reader.cancel().catch(() => undefined)
        return fail('response-too-large')
      }
    )
  } catch (cause) {
    void reader.cancel().catch(() => undefined)
    throw cause
  } finally {
    reader.releaseLock()
  }
  const bytes = joinManagementResponseChunks(collected.chunks, collected.byteLength)
  return parseManagementResponseJSON(bytes, () => fail('invalid-response'))
}

/** Shared HTTP lifetime; fixed queries, project authority and error identities remain caller-owned. */
export function createBackfillJSONRequester({
  abortMessage,
  timeoutMessage,
  ownsError,
  fail
}: BackfillReadRequestPolicy) {
  return async function requestJSON(
    fetcher: BackfillReadFetch,
    url: string,
    init: RequestInit,
    expectedStatus: number,
    maximum: number,
    timeoutMs: number,
    callerSignal: AbortSignal | undefined
  ): Promise<unknown> {
    if (callerSignal?.aborted) return fail('aborted')
    const deadline = createBackfillReadDeadline(callerSignal, timeoutMs, timeoutMessage)
    try {
      const response = await waitForBackfillRead(
        fetcher(url, { ...init, redirect: 'error', signal: deadline.signal }, maximum, timeoutMs),
        deadline.signal,
        abortMessage
      )
      if (
        response.redirected ||
        (response.url !== '' && response.url !== url) ||
        response.status !== expectedStatus
      ) {
        discardUnreadBackfillResponse(response)
        return fail('http-error')
      }
      return await readBackfillJSON(response, maximum, deadline.signal, { abortMessage, fail })
    } catch (cause) {
      if (ownsError(cause)) throw cause
      if (deadline.timedOut()) return fail('timeout')
      if (callerSignal?.aborted) return fail('aborted')
      return fail('network-failed')
    } finally {
      deadline.dispose()
    }
  }
}
