import { describe, expect, test } from 'bun:test'

import { s3ObjectResponseLimit } from '@/app/integrations/storage/s3/client'
import { storageFetch } from '@/app/integrations/storage/s3/fetch'
import {
  S3_RESPONSE_LIMITS,
  S3ResponseTooLargeError,
  assertS3ListObjectsXml,
  assertS3ListPagination,
  limitS3ResponseBody
} from '@/app/integrations/storage/s3/response'

function chunkedResponse(chunks: number[][], onCancel?: () => void): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift()
        if (chunk) controller.enqueue(new Uint8Array(chunk))
        else controller.close()
      },
      cancel() {
        onCancel?.()
      }
    })
  )
}

describe('S3 response boundaries', () => {
  test('fails a chunked response without Content-Length as soon as it crosses the limit', async () => {
    const bounded = limitS3ResponseBody(
      chunkedResponse([
        [1, 2, 3],
        [4, 5, 6]
      ]),
      5
    )

    await expect(bounded.arrayBuffer()).rejects.toBeInstanceOf(S3ResponseTooLargeError)
  })

  test('rejects an oversized declared Content-Length before consuming the response', () => {
    expect(() =>
      limitS3ResponseBody(
        new Response(new Uint8Array([1]), { headers: { 'Content-Length': '6' } }),
        5
      )
    ).toThrow('S3 response exceeds the 5-byte limit')
  })

  test('allows an exact-boundary response', async () => {
    const bounded = limitS3ResponseBody(
      chunkedResponse([
        [1, 2],
        [3, 4, 5]
      ]),
      5
    )
    expect(new Uint8Array(await bounded.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
  })

  test('preserves abort while an unbounded response stream is pending', async () => {
    const abortController = new AbortController()
    const reason = new DOMException('cancelled', 'AbortError')
    const bounded = limitS3ResponseBody(new Response(new ReadableStream<Uint8Array>()), 5, {
      signal: abortController.signal
    })
    const read = bounded.arrayBuffer()

    abortController.abort(reason)

    await expect(read).rejects.toBe(reason)
  })

  test('enforces the streaming boundary through the browser storage fetch path', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() =>
      Promise.resolve(
        chunkedResponse([
          [1, 2, 3],
          [4, 5, 6]
        ])
      )) as typeof fetch
    try {
      const response = await storageFetch('https://storage.example/document.fig', undefined, 5)
      await expect(response.arrayBuffer()).rejects.toBeInstanceOf(S3ResponseTooLargeError)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('uses the smaller error-body limit in the browser path', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3, 4]))
              controller.close()
            }
          }),
          { status: 500 }
        )
      )) as typeof fetch
    try {
      const response = await storageFetch('https://storage.example/error', undefined, 100, 3)
      await expect(response.arrayBuffer()).rejects.toBeInstanceOf(S3ResponseTooLargeError)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('assigns separate product limits to documents, thumbnails, and metadata', () => {
    expect(s3ObjectResponseLimit('open_pencil_storage/canvases/a.fig')).toBe(
      S3_RESPONSE_LIMITS.documentBytes
    )
    expect(s3ObjectResponseLimit('open_pencil_storage/canvases/a.thumb.jpg')).toBe(
      S3_RESPONSE_LIMITS.thumbnailBytes
    )
    expect(s3ObjectResponseLimit('open_pencil_storage/canvases/a.meta.json')).toBe(
      S3_RESPONSE_LIMITS.metadataBytes
    )
  })

  test('rejects malformed and non-list 200 XML responses', () => {
    expect(() => assertS3ListObjectsXml('<ListBucketResult><Contents>')).toThrow(
      'malformed ListObjectsV2 XML'
    )
    expect(() => assertS3ListObjectsXml('<Error><Code>AccessDenied</Code></Error>')).toThrow(
      'malformed ListObjectsV2 XML'
    )
    expect(() =>
      assertS3ListObjectsXml(
        '<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>'
      )
    ).not.toThrow()
  })

  test('rejects truncated list pages without a continuation token', () => {
    expect(() => assertS3ListPagination(true, null)).toThrow('without a continuation token')
    expect(() => assertS3ListPagination(true, 'next')).not.toThrow()
    expect(() => assertS3ListPagination(false, null)).not.toThrow()
  })
})
