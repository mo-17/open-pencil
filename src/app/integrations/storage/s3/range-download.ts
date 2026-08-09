import { S3_RESPONSE_LIMITS, S3ResponseTooLargeError, limitS3ResponseBody } from './response'

export const S3_RANGE_CHUNK_BYTES = 8 * 1024 * 1024

export type S3RangeRequest = {
  start: number
  endInclusive: number
  ifMatch?: string
  signal?: AbortSignal
}

export type S3RangeFetcher = (request: S3RangeRequest) => Promise<Response>

export type S3RangeDownloadOptions = {
  signal?: AbortSignal
  onProgress?: (receivedBytes: number, totalBytes: number) => void
  maxBytes?: number
  chunkBytes?: number
}

type ParsedContentRange = {
  start: number
  endInclusive: number
  totalBytes: number
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return value
}

export function parseS3ContentRange(value: string | null): ParsedContentRange {
  if (value === null) {
    throw new Error(
      'S3 did not expose Content-Range. Reapply the OpenPencil bucket CORS configuration.'
    )
  }
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value.trim())
  if (!match) throw new Error('S3 returned an invalid Content-Range header')
  const start = Number(match[1])
  const endInclusive = Number(match[2])
  const totalBytes = Number(match[3])
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(endInclusive) ||
    !Number.isSafeInteger(totalBytes) ||
    start < 0 ||
    endInclusive < start ||
    totalBytes < 1 ||
    endInclusive >= totalBytes
  ) {
    throw new Error('S3 returned an invalid Content-Range header')
  }
  return { start, endInclusive, totalBytes }
}

export function strongS3ETag(value: string | null): string | null {
  const etag = value?.trim() ?? ''
  if (
    etag.length < 2 ||
    etag.length > 512 ||
    etag.startsWith('W/') ||
    etag[0] !== '"' ||
    etag.at(-1) !== '"' ||
    /[\r\n]/.test(etag)
  ) {
    return null
  }
  return etag
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

async function rejectResponse(response: Response, error: Error): Promise<never> {
  await cancelBody(response)
  throw error
}

async function boundedRangeResponse(
  response: Response,
  chunkBytes: number,
  signal: AbortSignal | undefined
): Promise<Response | null> {
  if (response.status === 404) {
    await cancelBody(response)
    return null
  }
  if (response.status !== 200 && response.status !== 206) {
    return rejectResponse(
      response,
      new Error(`S3 range download failed with status ${response.status}`)
    )
  }
  return limitS3ResponseBody(response, chunkBytes, { signal })
}

async function readCompleteResponse(
  response: Response,
  offset: number,
  maxBytes: number,
  onProgress: S3RangeDownloadOptions['onProgress']
): Promise<Uint8Array> {
  if (offset !== 0) {
    return rejectResponse(response, new Error('S3 stopped honoring byte ranges during download'))
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new S3ResponseTooLargeError(maxBytes)
  onProgress?.(bytes.byteLength, bytes.byteLength)
  return bytes
}

async function validatedPartialRange(
  response: Response,
  expectedStart: number,
  requestedEnd: number,
  expectedTotal: number | null,
  expectedETag: string | null,
  maxBytes: number
): Promise<{ range: ParsedContentRange; etag: string | null }> {
  let range: ParsedContentRange
  try {
    range = parseS3ContentRange(response.headers.get('content-range'))
  } catch (error) {
    return rejectResponse(
      response,
      error instanceof Error ? error : new Error('S3 returned an invalid Content-Range header')
    )
  }
  if (
    range.start !== expectedStart ||
    range.endInclusive > requestedEnd ||
    (expectedTotal !== null && range.totalBytes !== expectedTotal)
  ) {
    return rejectResponse(response, new Error('S3 returned a non-contiguous range response'))
  }
  if (range.totalBytes > maxBytes) {
    return rejectResponse(response, new S3ResponseTooLargeError(maxBytes))
  }

  const isFinalRange = range.endInclusive + 1 === range.totalBytes
  const responseETag = strongS3ETag(response.headers.get('etag'))
  if (!isFinalRange && !responseETag) {
    return rejectResponse(
      response,
      new Error('S3 requires a strong ETag for a multi-range document download')
    )
  }
  if (expectedETag && responseETag !== expectedETag) {
    return rejectResponse(response, new Error('S3 document ETag changed during range download'))
  }
  return { range, etag: responseETag }
}

/**
 * Download one immutable S3 object through small range responses. A multi-range transfer
 * requires a strong ETag and applies If-Match to every continuation, so bytes from different
 * object versions can never be assembled together.
 */
export async function downloadS3ObjectByRange(
  fetchRange: S3RangeFetcher,
  options: S3RangeDownloadOptions = {}
): Promise<Uint8Array | null> {
  const maxBytes = positiveSafeInteger(
    options.maxBytes ?? S3_RESPONSE_LIMITS.documentBytes,
    'S3 document byte limit'
  )
  const chunkBytes = positiveSafeInteger(
    options.chunkBytes ?? S3_RANGE_CHUNK_BYTES,
    'S3 range chunk size'
  )
  if (chunkBytes > maxBytes) throw new TypeError('S3 range chunk size exceeds the document limit')

  let offset = 0
  let totalBytes: number | null = null
  let expectedETag: string | null = null
  let output: Uint8Array | null = null
  const maximumRequests = Math.ceil(maxBytes / chunkBytes) + 1

  for (let requestIndex = 0; requestIndex < maximumRequests; requestIndex++) {
    options.signal?.throwIfAborted()
    const endInclusive = Math.min(offset + chunkBytes - 1, maxBytes - 1)
    const rawResponse = await fetchRange({
      start: offset,
      endInclusive,
      ...(expectedETag ? { ifMatch: expectedETag } : {}),
      signal: options.signal
    })
    const response = await boundedRangeResponse(rawResponse, chunkBytes, options.signal)
    if (!response) return null

    if (response.status === 200) {
      return readCompleteResponse(response, offset, maxBytes, options.onProgress)
    }

    const validated = await validatedPartialRange(
      response,
      offset,
      endInclusive,
      totalBytes,
      expectedETag,
      maxBytes
    )
    const { range } = validated
    expectedETag ??= validated.etag
    totalBytes ??= range.totalBytes

    const bytes = new Uint8Array(await response.arrayBuffer())
    const expectedBytes = range.endInclusive - range.start + 1
    if (bytes.byteLength !== expectedBytes) {
      throw new Error('S3 range body length does not match Content-Range')
    }
    output ??= new Uint8Array(totalBytes)
    output.set(bytes, range.start)
    offset = range.endInclusive + 1
    options.onProgress?.(offset, totalBytes)
    if (offset === totalBytes) return output
  }

  throw new Error('S3 range download exceeded its bounded request count')
}
