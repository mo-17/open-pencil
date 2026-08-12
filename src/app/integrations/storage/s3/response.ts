import { DOMParser } from '@xmldom/xmldom'

const KIBIBYTE = 1024
const MEBIBYTE = KIBIBYTE * KIBIBYTE

export const S3_RESPONSE_LIMITS = {
  /** One ListObjectsV2 page with at most 1,000 S3 keys and XML framing. */
  listBytes: 2 * MEBIBYTE,
  /** Provider error bodies are diagnostic only and must never dominate memory. */
  errorBytes: 64 * KIBIBYTE,
  /** OpenPencil's JSON sidecar and namespace marker are deliberately small. */
  metadataBytes: 64 * KIBIBYTE,
  /** Product limit shared with the Google Drive whole-document download path. */
  documentBytes: 512 * MEBIBYTE,
  /** Generated JPEG previews are bounded independently from full documents. */
  thumbnailBytes: 8 * MEBIBYTE
} as const

export class S3ResponseTooLargeError extends Error {
  readonly maxBytes: number

  constructor(maxBytes: number) {
    super(`S3 response exceeds the ${maxBytes}-byte limit`)
    this.name = 'S3ResponseTooLargeError'
    this.maxBytes = maxBytes
  }
}

type S3ResponseBoundaryOptions = {
  signal?: AbortSignal
  onFinalize?: () => void
}

function assertPositiveByteLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('S3 response byte limit must be a positive safe integer')
  }
}

function declaredContentLength(response: Response): number | null {
  const raw = response.headers.get('content-length')
  if (raw === null || !/^\d+$/.test(raw.trim())) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

/**
 * Wrap a response body with a streaming byte limit. The limit is enforced even when
 * Content-Length is missing or untrusted, and the upstream reader is cancelled on overflow.
 */
export function limitS3ResponseBody(
  response: Response,
  maxBytes: number,
  options: S3ResponseBoundaryOptions = {}
): Response {
  assertPositiveByteLimit(maxBytes)
  let finalized = false
  const finalize = () => {
    if (finalized) return
    finalized = true
    options.signal?.removeEventListener('abort', abort)
    options.onFinalize?.()
  }
  const announced = declaredContentLength(response)
  if (announced !== null && announced > maxBytes) {
    void response.body?.cancel().catch(() => undefined)
    finalize()
    throw new S3ResponseTooLargeError(maxBytes)
  }
  if (!response.body) {
    finalize()
    return response
  }

  const reader = response.body.getReader()
  let receivedBytes = 0
  let terminated = false
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
  let abortError: unknown = null
  const releaseReader = () => reader.releaseLock()
  function abort(): void {
    if (terminated) return
    terminated = true
    abortError =
      options.signal?.reason ?? new DOMException('The operation was aborted', 'AbortError')
    controllerRef?.error(abortError)
    void reader
      .cancel(abortError)
      .catch(() => undefined)
      .finally(() => {
        releaseReader()
        finalize()
      })
  }
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener('abort', abort, { once: true })

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      controllerRef = controller
      if (terminated) {
        if (abortError) controller.error(abortError)
        return
      }
      try {
        const { done, value } = await reader.read()
        // Abort can run while the reader promise is pending.
        // oxlint-disable-next-line typescript-eslint/no-unnecessary-condition
        if (terminated) return
        if (done) {
          terminated = true
          controller.close()
          releaseReader()
          finalize()
          return
        }
        receivedBytes += value.byteLength
        if (receivedBytes > maxBytes) {
          const error = new S3ResponseTooLargeError(maxBytes)
          terminated = true
          controller.error(error)
          void reader
            .cancel(error)
            .catch(() => undefined)
            .finally(() => {
              releaseReader()
              finalize()
            })
          return
        }
        controller.enqueue(value)
      } catch (error) {
        if (terminated) return
        terminated = true
        releaseReader()
        finalize()
        controller.error(error)
      }
    },
    async cancel(reason) {
      if (terminated) return
      terminated = true
      await reader.cancel(reason).catch(() => undefined)
      releaseReader()
      finalize()
    }
  })
  const bounded = new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
  Object.defineProperties(bounded, {
    redirected: { value: response.redirected },
    type: { value: response.type },
    url: { value: response.url }
  })
  return bounded
}

/** Reject malformed or non-list XML before the tolerant field extractor can see it. */
export function assertS3ListObjectsXML(source: string): void {
  let parseFailure: string | null = null
  let rootName: string | null = null
  try {
    const document = new DOMParser({
      onError: (_level, message) => {
        if (parseFailure === null) parseFailure = message
      }
    }).parseFromString(source, 'application/xml')
    rootName = document.documentElement?.localName ?? null
  } catch {
    parseFailure = 'parse failed'
  }
  if (parseFailure || rootName !== 'ListBucketResult') {
    throw new Error('S3 returned malformed ListObjectsV2 XML')
  }
}

export function assertS3ListPagination(
  isTruncated: boolean,
  nextContinuationToken: string | null
): void {
  if (isTruncated && !nextContinuationToken) {
    throw new Error('S3 returned a truncated listing without a continuation token')
  }
}
