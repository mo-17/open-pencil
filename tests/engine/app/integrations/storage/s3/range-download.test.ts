import { describe, expect, test } from 'bun:test'

import {
  downloadS3ObjectByRange,
  parseS3ContentRange,
  strongS3ETag,
  type S3RangeRequest
} from '@/app/integrations/storage/s3/range-download'
import { S3ResponseTooLargeError } from '@/app/integrations/storage/s3/response'

function bytesResponse(
  bytes: number[],
  options: { status?: number; contentRange?: string; etag?: string } = {}
): Response {
  const headers = new Headers()
  if (options.contentRange) headers.set('Content-Range', options.contentRange)
  if (options.etag) headers.set('ETag', options.etag)
  return new Response(new Uint8Array(bytes), {
    status: options.status ?? 206,
    headers
  })
}

describe('S3 range download', () => {
  test('assembles contiguous chunks with a strong ETag and If-Match continuations', async () => {
    const requests: S3RangeRequest[] = []
    const responses = [
      bytesResponse([1, 2, 3], { contentRange: 'bytes 0-2/7', etag: '"v1"' }),
      bytesResponse([4, 5, 6], { contentRange: 'bytes 3-5/7', etag: '"v1"' }),
      bytesResponse([7], { contentRange: 'bytes 6-6/7', etag: '"v1"' })
    ]
    const progress: Array<[number, number]> = []

    const result = await downloadS3ObjectByRange(
      (request) => {
        requests.push(request)
        return Promise.resolve(responses.shift() as Response)
      },
      {
        chunkBytes: 3,
        maxBytes: 10,
        onProgress: (received, total) => progress.push([received, total])
      }
    )

    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7]))
    expect(
      requests.map(({ start, endInclusive, ifMatch }) => [start, endInclusive, ifMatch])
    ).toEqual([
      [0, 2, undefined],
      [3, 5, '"v1"'],
      [6, 8, '"v1"']
    ])
    expect(progress).toEqual([
      [3, 7],
      [6, 7],
      [7, 7]
    ])
  })

  test('fails closed when a multi-range response has no strong ETag', async () => {
    await expect(
      downloadS3ObjectByRange(
        () => Promise.resolve(bytesResponse([1, 2, 3], { contentRange: 'bytes 0-2/6' })),
        { chunkBytes: 3, maxBytes: 10 }
      )
    ).rejects.toThrow('requires a strong ETag')
  })

  test('fails closed when the ETag changes between ranges', async () => {
    const responses = [
      bytesResponse([1, 2, 3], { contentRange: 'bytes 0-2/6', etag: '"v1"' }),
      bytesResponse([4, 5, 6], { contentRange: 'bytes 3-5/6', etag: '"v2"' })
    ]
    await expect(
      downloadS3ObjectByRange(() => Promise.resolve(responses.shift() as Response), {
        chunkBytes: 3,
        maxBytes: 10
      })
    ).rejects.toThrow('ETag changed')
  })

  test('rejects non-contiguous ranges and mismatched body lengths', async () => {
    await expect(
      downloadS3ObjectByRange(
        () =>
          Promise.resolve(bytesResponse([1, 2, 3], { contentRange: 'bytes 1-3/6', etag: '"v1"' })),
        { chunkBytes: 3, maxBytes: 10 }
      )
    ).rejects.toThrow('non-contiguous')

    await expect(
      downloadS3ObjectByRange(
        () => Promise.resolve(bytesResponse([1, 2], { contentRange: 'bytes 0-2/3', etag: '"v1"' })),
        { chunkBytes: 3, maxBytes: 10 }
      )
    ).rejects.toThrow('body length does not match')
  })

  test('rejects an announced total above the product limit before assembly', async () => {
    await expect(
      downloadS3ObjectByRange(
        () =>
          Promise.resolve(bytesResponse([1, 2, 3], { contentRange: 'bytes 0-2/11', etag: '"v1"' })),
        { chunkBytes: 3, maxBytes: 10 }
      )
    ).rejects.toBeInstanceOf(S3ResponseTooLargeError)
  })

  test('accepts a small complete 200 response when a provider ignores Range', async () => {
    const result = await downloadS3ObjectByRange(
      () => Promise.resolve(bytesResponse([1, 2, 3], { status: 200 })),
      { chunkBytes: 3, maxBytes: 10 }
    )
    expect(result).toEqual(new Uint8Array([1, 2, 3]))
  })

  test('strictly parses Content-Range and strong ETags', () => {
    expect(parseS3ContentRange('bytes 3-5/6')).toEqual({
      start: 3,
      endInclusive: 5,
      totalBytes: 6
    })
    expect(() => parseS3ContentRange('bytes 5-3/6')).toThrow('invalid Content-Range')
    expect(() => parseS3ContentRange('bytes 0-2/*')).toThrow('invalid Content-Range')
    expect(() => parseS3ContentRange(null)).toThrow('Reapply the OpenPencil bucket CORS')
    expect(strongS3ETag('"abc"')).toBe('"abc"')
    expect(strongS3ETag('W/"abc"')).toBeNull()
    expect(strongS3ETag('abc')).toBeNull()
  })
})
