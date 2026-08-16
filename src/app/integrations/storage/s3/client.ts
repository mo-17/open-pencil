import { AwsClient } from 'aws4fetch'

import { storageFetch } from '@/app/integrations/storage/s3/fetch'
import {
  S3_RANGE_CHUNK_BYTES,
  downloadS3ObjectByRange,
  type S3RangeRequest
} from '@/app/integrations/storage/s3/range-download'
import { inferS3Region } from '@/app/integrations/storage/s3/region'
import {
  S3_RESPONSE_LIMITS,
  assertS3ListObjectsXML,
  assertS3ListPagination
} from '@/app/integrations/storage/s3/response'
import type { S3CompatibleConfig } from '@/app/integrations/storage/s3/types'
import {
  parseListObjectsV2Page,
  parseS3ErrorXML,
  type ListedObject
} from '@/app/integrations/storage/s3/xml'
import type { LibraryObjectWriteOptions } from '@/app/integrations/storage/types'

export function resolveS3Region(config: S3CompatibleConfig): string {
  const explicit = config.region?.trim()
  if (explicit) return explicit
  return inferS3Region(config.endpoint)
}

export class S3HttpError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(status: number, message: string, code: string | null = null) {
    super(message)
    this.name = 'S3HttpError'
    this.status = status
    this.code = code
  }
}

export function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error('S3 endpoint is required')
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  return `https://${trimmed}`
}

/** Path-style object URL: {endpoint}/{bucket}/{key} — works with B2, MinIO, R2, AWS. */
export function objectURL(config: S3CompatibleConfig, key: string): string {
  const base = normalizeEndpoint(config.endpoint)
  const encodedKey = key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${base}/${encodeURIComponent(config.bucket)}/${encodedKey}`
}

export function createAwsClient(config: S3CompatibleConfig): AwsClient {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: resolveS3Region(config),
    service: 's3'
  })
}

async function readErrorBody(res: Response): Promise<{ message: string; code: string | null }> {
  const text = await res.text().catch(() => '')
  return parseS3ErrorXML(text, res.status)
}

/**
 * Known-length body types that UAs can send with Content-Length.
 * Prefer these over Request-wrapped streams — B2 rejects missing Content-Length (411)
 * and some browsers hang on chunked S3 PUTs.
 */
function bodyByteLength(body: BodyInit | null | undefined): number | null {
  if (body == null) return null
  if (typeof body === 'string') return new TextEncoder().encode(body).byteLength
  if (body instanceof ArrayBuffer) return body.byteLength
  if (ArrayBuffer.isView(body)) return body.byteLength
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size
  return null
}

export type UploadProgress = { sentBytes: number; totalBytes: number | null }

/**
 * fetch() cannot observe upload progress — replay the signed request over
 * XMLHttpRequest when a progress callback is attached (uploads only).
 */
function xhrSend(
  url: string,
  method: string,
  headers: Headers,
  body: BodyInit | undefined,
  onUploadProgress: (progress: UploadProgress) => void,
  maxResponseBytes: number,
  signal?: AbortSignal | null
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const rejectOnce = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error instanceof Error ? error : new Error('S3 request failed', { cause: error }))
    }
    const abort = () => {
      xhr.abort()
      const reason = signal?.reason
      rejectOnce(
        reason instanceof Error
          ? reason
          : new DOMException('The operation was aborted', 'AbortError')
      )
    }
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    xhr.open(method, url)
    headers.forEach((value, key) => {
      // Forbidden request headers are set by the browser itself
      if (/^(content-length|host)$/i.test(key)) return
      xhr.setRequestHeader(key, value)
    })
    xhr.responseType = 'arraybuffer'
    xhr.upload.onprogress = (e) => {
      onUploadProgress({ sentBytes: e.loaded, totalBytes: e.lengthComputable ? e.total : null })
    }
    xhr.onprogress = (event) => {
      if (event.loaded <= maxResponseBytes) return
      rejectOnce(new Error(`S3 response exceeds the ${maxResponseBytes}-byte limit`))
      xhr.abort()
    }
    xhr.onload = () => {
      if (settled) return
      settled = true
      cleanup()
      const bytes = xhr.response instanceof ArrayBuffer ? xhr.response : new ArrayBuffer(0)
      if (bytes.byteLength > maxResponseBytes) {
        reject(new Error(`S3 response exceeds the ${maxResponseBytes}-byte limit`))
        return
      }
      resolve(new Response(bytes.byteLength > 0 ? bytes : null, { status: xhr.status }))
    }
    // Same shape the fetch path throws so CORS/network detection keeps working
    xhr.onerror = () => {
      rejectOnce(new TypeError('Failed to fetch'))
    }
    xhr.onabort = cleanup
    xhr.send(body as XMLHttpRequestBodyInit)
  })
}

export async function s3Request(
  config: S3CompatibleConfig,
  url: string,
  init: RequestInit = {},
  onUploadProgress?: (progress: UploadProgress) => void,
  maxResponseBytes: number = S3_RESPONSE_LIMITS.metadataBytes
): Promise<Response> {
  const client = createAwsClient(config)
  const length = bodyByteLength(init.body ?? null)
  const headers = new Headers(init.headers)
  // Never send cookies; avoids credentialed CORS mode.
  // Set Content-Length when we know size. aws4fetch leaves it unsignable (correct for S3).
  // Critical for Backblaze B2 large binary PUTs.
  if (length != null && !headers.has('Content-Length')) {
    headers.set('Content-Length', String(length))
  }
  // Sign with aws4fetch, then re-issue with url+init so the body keeps a known length.
  // Passing only the signed Request object can drop Content-Length on some runtimes.
  const signed = await client.sign(url, {
    ...init,
    headers,
    credentials: 'omit'
  })
  let res: Response
  try {
    if (onUploadProgress && typeof XMLHttpRequest !== 'undefined') {
      res = await xhrSend(
        signed.url,
        signed.method,
        signed.headers,
        init.body ?? undefined,
        onUploadProgress,
        maxResponseBytes,
        init.signal
      )
    } else {
      res = await storageFetch(
        signed.url,
        {
          method: signed.method,
          headers: signed.headers,
          body: init.body ?? undefined,
          credentials: 'omit',
          signal: init.signal
        },
        maxResponseBytes,
        S3_RESPONSE_LIMITS.errorBytes
      )
    }
  } catch (error) {
    // Re-export as a typed error so UI can detect CORS/network blocks.
    const { CloudCORSError, isLikelyCORSOrNetworkError, formatBrowserCORSHelpMessage } =
      await import('@/app/integrations/storage/s3/cors')
    if (isLikelyCORSOrNetworkError(error)) {
      throw new CloudCORSError(formatBrowserCORSHelpMessage())
    }
    throw error
  }
  if (res.status === 404) {
    await res.body?.cancel().catch(() => undefined)
    return res
  }
  if (res.ok) return res
  const { message, code } = await readErrorBody(res)
  throw new S3HttpError(res.status, message, code)
}

export async function headObject(
  config: S3CompatibleConfig,
  key: string,
  signal?: AbortSignal
): Promise<boolean> {
  const res = await s3Request(
    config,
    objectURL(config, key),
    { method: 'HEAD', signal },
    undefined,
    s3ObjectResponseLimit(key)
  )
  if (res.status === 404) return false
  return true
}

export async function headObjectSize(
  config: S3CompatibleConfig,
  key: string,
  signal?: AbortSignal
): Promise<number | null> {
  const res = await s3Request(
    config,
    objectURL(config, key),
    { method: 'HEAD', signal },
    undefined,
    s3ObjectResponseLimit(key)
  )
  if (res.status === 404) return null
  const sizeHeader = res.headers.get('content-length')
  if (sizeHeader == null) return null
  const size = Number(sizeHeader)
  return Number.isSafeInteger(size) && size >= 0 ? size : null
}

export async function getObjectRange(
  config: S3CompatibleConfig,
  key: string,
  start: number,
  endExclusive: number,
  signal?: AbortSignal
): Promise<Uint8Array | null> {
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(endExclusive) ||
    endExclusive <= start
  ) {
    throw new Error('Invalid S3 byte range')
  }
  if (endExclusive - start > S3_RANGE_CHUNK_BYTES) {
    throw new Error('S3 byte range exceeds the bounded preview chunk size')
  }
  const res = await s3Request(
    config,
    objectURL(config, key),
    {
      method: 'GET',
      headers: { Range: `bytes=${start}-${endExclusive - 1}` },
      signal
    },
    undefined,
    S3_RANGE_CHUNK_BYTES
  )
  if (res.status === 404) return null
  if (res.status !== 206) throw new Error('Storage provider did not honor the thumbnail byte range')
  return new Uint8Array(await res.arrayBuffer())
}

export async function putObject(
  config: S3CompatibleConfig,
  key: string,
  body: Uint8Array | string,
  contentType: string,
  onUploadProgress?: (progress: UploadProgress) => void,
  requestOptions?: AbortSignal | LibraryObjectWriteOptions
): Promise<void> {
  const signal = isAbortSignal(requestOptions) ? requestOptions : undefined
  const options: LibraryObjectWriteOptions | undefined = isAbortSignal(requestOptions)
    ? undefined
    : requestOptions
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  // Exact ArrayBuffer so fetch/UA can set Content-Length (required by B2 for large PUTs).
  const payload = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
  const res = await s3Request(
    config,
    objectURL(config, key),
    {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        ...(options?.ifMatch ? { 'If-Match': options.ifMatch } : {}),
        ...(options?.ifNoneMatch ? { 'If-None-Match': options.ifNoneMatch } : {})
      },
      body: payload,
      signal
    },
    onUploadProgress,
    S3_RESPONSE_LIMITS.metadataBytes
  )
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined)
    throw new S3HttpError(res.status, `Failed to upload ${key}`)
  }
  await res.body?.cancel().catch(() => undefined)
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    'aborted' in value &&
    typeof (value as AbortSignal).addEventListener === 'function'
  )
}

export async function getObjectValue(
  config: S3CompatibleConfig,
  key: string
): Promise<{ bytes: Uint8Array | null; etag: string | null }> {
  const res = await s3Request(config, objectURL(config, key), { method: 'GET' })
  if (res.status === 404) return { bytes: null, etag: null }
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    etag: res.headers.get('etag')
  }
}

export type DownloadProgress = { receivedBytes: number; totalBytes: number | null }

export function s3ObjectResponseLimit(key: string): number {
  if (key.endsWith('.fig')) return S3_RESPONSE_LIMITS.documentBytes
  if (key.endsWith('.thumb.jpg')) return S3_RESPONSE_LIMITS.thumbnailBytes
  return S3_RESPONSE_LIMITS.metadataBytes
}

export async function getObject(
  config: S3CompatibleConfig,
  key: string,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<Uint8Array | null> {
  const maxResponseBytes = s3ObjectResponseLimit(key)
  const url = objectURL(config, key)
  if (maxResponseBytes === S3_RESPONSE_LIMITS.documentBytes) {
    return downloadS3ObjectByRange(
      (range: S3RangeRequest) => {
        const headers = new Headers({
          Range: `bytes=${range.start}-${range.endInclusive}`
        })
        if (range.ifMatch) headers.set('If-Match', range.ifMatch)
        return s3Request(
          config,
          url,
          { method: 'GET', headers, signal: range.signal },
          undefined,
          S3_RANGE_CHUNK_BYTES
        )
      },
      {
        signal,
        onProgress: onProgress
          ? (receivedBytes, totalBytes) => onProgress({ receivedBytes, totalBytes })
          : undefined,
        maxBytes: maxResponseBytes,
        chunkBytes: S3_RANGE_CHUNK_BYTES
      }
    )
  }
  const res = await s3Request(config, url, { method: 'GET', signal }, undefined, maxResponseBytes)
  if (res.status === 404) return null
  if (!onProgress || !res.body) {
    return new Uint8Array(await res.arrayBuffer())
  }

  // Stream so large figs can report download progress
  const contentLength = Number(res.headers.get('content-length'))
  const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let receivedBytes = 0
  for (;;) {
    signal?.throwIfAborted()
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    receivedBytes += value.byteLength
    onProgress({ receivedBytes, totalBytes })
  }
  const out = new Uint8Array(receivedBytes)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export async function deleteObject(
  config: S3CompatibleConfig,
  key: string,
  signal?: AbortSignal
): Promise<void> {
  const res = await s3Request(
    config,
    objectURL(config, key),
    { method: 'DELETE', signal },
    undefined,
    S3_RESPONSE_LIMITS.metadataBytes
  )
  await res.body?.cancel().catch(() => undefined)
  if (!res.ok && res.status !== 404) {
    throw new S3HttpError(res.status, `Failed to delete ${key}`)
  }
}

export async function listObjects(
  config: S3CompatibleConfig,
  prefix: string,
  signal?: AbortSignal
): Promise<ListedObject[]> {
  const base = normalizeEndpoint(config.endpoint)
  const all: ListedObject[] = []
  let continuationToken: string | null = null

  for (let page = 0; page < 50; page++) {
    signal?.throwIfAborted()
    const params = new URLSearchParams({
      'list-type': '2',
      prefix,
      'max-keys': '1000'
    })
    if (continuationToken) params.set('continuation-token', continuationToken)
    const url = `${base}/${encodeURIComponent(config.bucket)}?${params.toString()}`
    const res = await s3Request(
      config,
      url,
      { method: 'GET', signal },
      undefined,
      S3_RESPONSE_LIMITS.listBytes
    )
    if (!res.ok) {
      throw new S3HttpError(res.status, 'Failed to list objects')
    }
    const xml = await res.text()
    assertS3ListObjectsXML(xml)
    const parsed = parseListObjectsV2Page(xml)
    all.push(...parsed.objects)
    assertS3ListPagination(parsed.isTruncated, parsed.nextContinuationToken)
    if (!parsed.isTruncated) break
    if (page === 49) {
      throw new Error('S3 listing exceeded the 50,000-object safety limit')
    }
    continuationToken = parsed.nextContinuationToken
  }

  return all
}
