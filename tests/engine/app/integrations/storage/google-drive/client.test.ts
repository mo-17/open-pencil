import { describe, expect, test } from 'bun:test'

import { GoogleDriveClient } from '@/app/integrations/storage/google-drive/client'
import { GoogleDriveError } from '@/app/integrations/storage/google-drive/errors'
import type {
  GoogleDriveOAuthToken,
  GoogleDriveTransport
} from '@/app/integrations/storage/google-drive/types'
import {
  createGoogleDriveTauriTransport,
  type GoogleDriveNativeTransferInvoker,
  type GoogleDriveNativeTransferRequest
} from '@/app/tauri/google-drive'

import type { RecordedGoogleDriveCall as RecordedCall } from '#tests/helpers/google-drive'

type ResponseFactory = (call: RecordedCall) => Response | Promise<Response>

const TOKEN: GoogleDriveOAuthToken = {
  accessToken: 'access-token',
  accountId: 'oidc-subject-1',
  authorizationVersion: 'grant-1'
}

function tokenSource(token: GoogleDriveOAuthToken = TOKEN) {
  return { getAccessToken: () => Promise.resolve(token) }
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(value), { ...init, headers })
}

function driveFile(
  id: string,
  overrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    id,
    name: `${id}.fig`,
    mimeType: 'application/octet-stream',
    modifiedTime: '2026-08-09T01:02:03.000Z',
    size: '3',
    version: '7',
    md5Checksum: '900150983cd24fb0d6963f7d28e17f72',
    headRevisionId: 'head-7',
    trashed: false,
    appProperties: { openPencil: 'document-v1' },
    ...overrides
  }
}

function queuedTransport(factories: ResponseFactory[]): {
  transport: GoogleDriveTransport
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const transport: GoogleDriveTransport = async (input, init = {}) => {
    const call = { url: new URL(input), init }
    calls.push(call)
    const factory = factories.shift()
    if (!factory) throw new Error(`Unexpected Google Drive request: ${input}`)
    return factory(call)
  }
  return { transport, calls }
}

function requestHeaders(call: RecordedCall): Headers {
  return new Headers(call.init.headers)
}

function callAt(calls: RecordedCall[], index: number): RecordedCall {
  const call = calls[index]
  if (!call) throw new Error(`Missing recorded Google Drive call ${index}`)
  return call
}

function arrayBufferBody(call: RecordedCall): ArrayBuffer {
  if (!(call.init.body instanceof ArrayBuffer)) throw new Error('Expected an ArrayBuffer body')
  return call.init.body
}

function stringBody(call: RecordedCall): string {
  if (typeof call.init.body !== 'string') throw new Error('Expected a string body')
  return call.init.body
}

describe('GoogleDriveClient', () => {
  test('uses fixed Google origins, bearer auth, and generated Drive file IDs', async () => {
    const { transport, calls } = queuedTransport([
      () => jsonResponse({ ids: ['reserved_1'], kind: 'drive#generatedIds', space: 'drive' })
    ])
    const client = new GoogleDriveClient({ tokenSource: tokenSource(), transport })

    await expect(client.generateIds()).resolves.toEqual(['reserved_1'])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url.origin).toBe('https://www.googleapis.com')
    expect(calls[0]?.url.pathname).toBe('/drive/v3/files/generateIds')
    expect(calls[0]?.url.searchParams.get('space')).toBe('drive')
    expect(requestHeaders(callAt(calls, 0)).get('authorization')).toBe('Bearer access-token')
    expect(calls[0]?.init.credentials).toBe('omit')
    expect(calls[0]?.init.redirect).toBe('error')
  })

  test('lists only marked .fig files across bounded pages', async () => {
    const { transport, calls } = queuedTransport([
      () =>
        jsonResponse({
          files: [
            driveFile('document_1'),
            driveFile('not_fig', { name: 'notes.txt' }),
            driveFile('not_marked', { appProperties: {} })
          ],
          nextPageToken: 'page-2'
        }),
      () => jsonResponse({ files: [driveFile('document_2')] })
    ])
    const client = new GoogleDriveClient({ tokenSource: tokenSource(), transport })

    const files = await client.listFiles()

    expect(files.map((file) => file.id)).toEqual(['document_1', 'document_2'])
    expect(files[0]?.remoteRevision).toEqual({
      version: '7',
      headRevisionId: 'head-7',
      checksum: '900150983cd24fb0d6963f7d28e17f72'
    })
    expect(calls[0]?.url.searchParams.get('q')).toContain("key='openPencil'")
    expect(calls[1]?.url.searchParams.get('pageToken')).toBe('page-2')
  })

  test('fails closed when file pagination exceeds its configured bound', async () => {
    const { transport } = queuedTransport([
      () => jsonResponse({ files: [driveFile('document_1')], nextPageToken: 'page-2' })
    ])
    const client = new GoogleDriveClient({
      tokenSource: tokenSource(),
      transport,
      limits: { maxListPages: 1 }
    })

    await expect(client.listFiles()).rejects.toMatchObject({
      code: 'resource-limit'
    })
  })

  test('downloads media and derives bytes, metadata, and revision from one response', async () => {
    const progress: number[] = []
    const { transport, calls } = queuedTransport([
      () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 206,
          headers: {
            'content-length': '3',
            'content-disposition': "attachment; filename*=UTF-8''%E6%83%8A%E6%82%9A.fig",
            'last-modified': 'Sun, 09 Aug 2026 01:02:03 GMT',
            etag: '"media-etag"',
            'x-goog-generation': '42',
            'x-goog-hash': 'crc32c=AAAAAA==,md5=AAAAAAAAAAAAAAAAAAAAAA=='
          }
        })
    ])
    const client = new GoogleDriveClient({ tokenSource: tokenSource(), transport })

    const result = await client.downloadFile('document_1', {
      onProgress: ({ transferredBytes }) => progress.push(transferredBytes)
    })

    expect([...result.bytes]).toEqual([1, 2, 3])
    expect(result.metadata).toEqual({
      name: '惊悚.fig',
      updatedAt: '2026-08-09T01:02:03.000Z'
    })
    expect(result.remoteRevision).toEqual({
      checksum: '00000000000000000000000000000000',
      etag: '"media-etag"',
      generation: '42'
    })
    expect(progress).toEqual([3])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url.searchParams.get('alt')).toBe('media')
  })

  test('returns null revision when the media response exposes no version headers', async () => {
    const { transport } = queuedTransport([() => new Response(new Uint8Array([1]))])
    const client = new GoogleDriveClient({ tokenSource: tokenSource(), transport })

    const result = await client.downloadFile('document_1')

    expect(result.remoteRevision).toBeNull()
    expect(result.metadata).toEqual({
      name: 'document_1',
      updatedAt: '1970-01-01T00:00:00.000Z'
    })
  })

  test('uploads in 256 KiB resumable chunks and honors 308 acknowledgements', async () => {
    const bytes = new Uint8Array(256 * 1024 + 3).fill(7)
    const progress: number[] = []
    const { transport, calls } = queuedTransport([
      () =>
        new Response(null, {
          status: 200,
          headers: {
            location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=session-1'
          }
        }),
      () => new Response(null, { status: 308, headers: { range: 'bytes=0-262143' } }),
      () => jsonResponse(driveFile('document_1'), { status: 200, headers: { etag: '"v7"' } })
    ])
    const client = new GoogleDriveClient({ tokenSource: tokenSource(), transport })

    const result = await client.createFile({
      id: 'document_1',
      bytes,
      metadata: { name: '惊悚.fig', appProperties: { openPencil: 'tampered' } },
      onProgress: ({ transferredBytes }) => progress.push(transferredBytes)
    })

    expect(result.remoteRevision).toMatchObject({ version: '7', etag: '"v7"' })
    expect(calls.map((call) => call.init.method)).toEqual(['POST', 'PUT', 'PUT'])
    expect(requestHeaders(callAt(calls, 1)).get('content-range')).toBe(
      `bytes 0-262143/${bytes.byteLength}`
    )
    expect(requestHeaders(callAt(calls, 2)).get('content-range')).toBe(
      `bytes 262144-262146/${bytes.byteLength}`
    )
    expect(arrayBufferBody(callAt(calls, 1)).byteLength).toBe(256 * 1024)
    expect(arrayBufferBody(callAt(calls, 2)).byteLength).toBe(3)
    expect(JSON.parse(stringBody(callAt(calls, 0)))).toMatchObject({
      appProperties: { openPencil: 'document-v1' }
    })
    expect(progress).toEqual([0, 256 * 1024, bytes.byteLength])
  })

  test('probes an ambiguous 503 and restarts an expired resumable session', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const { transport, calls } = queuedTransport([
      () =>
        new Response(null, {
          status: 200,
          headers: {
            location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=expired'
          }
        }),
      () => new Response(null, { status: 503, headers: { 'retry-after': '0' } }),
      () => new Response(null, { status: 404 }),
      () =>
        new Response(null, {
          status: 200,
          headers: {
            location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=fresh'
          }
        }),
      () => jsonResponse(driveFile('document_1'))
    ])
    const client = new GoogleDriveClient({
      tokenSource: tokenSource(),
      transport,
      sleep: () => Promise.resolve()
    })

    await expect(
      client.createFile({ id: 'document_1', bytes, metadata: { name: 'test.fig' } })
    ).resolves.toMatchObject({ file: { id: 'document_1' } })

    expect(requestHeaders(callAt(calls, 2)).get('content-range')).toBe('bytes */3')
    expect(calls[3]?.url.searchParams.get('upload_id')).toBeNull()
    expect(calls[4]?.url.searchParams.get('upload_id')).toBe('fresh')
  })

  test('honors Retry-After on upload 429 and resumes from the probed offset', async () => {
    const { transport, calls } = queuedTransport([
      () =>
        new Response(null, {
          headers: {
            location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=limited'
          }
        }),
      () => new Response(null, { status: 429, headers: { 'retry-after': '1' } }),
      () => new Response(null, { status: 308 }),
      () => jsonResponse(driveFile('document_1'))
    ])
    const delays: number[] = []
    const client = new GoogleDriveClient({
      tokenSource: tokenSource(),
      transport,
      sleep: (delayMs) => {
        delays.push(delayMs)
        return Promise.resolve()
      }
    })

    await expect(
      client.createFile({
        id: 'document_1',
        bytes: new Uint8Array([1, 2, 3]),
        metadata: { name: 'test.fig' }
      })
    ).resolves.toMatchObject({ file: { id: 'document_1' } })

    expect(delays).toEqual([1_000])
    expect(requestHeaders(callAt(calls, 2)).get('content-range')).toBe('bytes */3')
    expect(requestHeaders(callAt(calls, 3)).get('content-range')).toBe('bytes 0-2/3')
  })

  test('rejects resumable locations outside the fixed Google origin', async () => {
    const { transport } = queuedTransport([
      () =>
        new Response(null, {
          status: 200,
          headers: { location: 'https://attacker.example/upload/drive/v3/files?id=stolen' }
        })
    ])
    const client = new GoogleDriveClient({ tokenSource: tokenSource(), transport })

    await expect(
      client.createFile({
        id: 'document_1',
        bytes: new Uint8Array([1]),
        metadata: { name: 'test.fig' }
      })
    ).rejects.toMatchObject({ code: 'invalid-response' })
  })

  test('uses changes tokens and trashes rather than permanently deleting', async () => {
    const { transport, calls } = queuedTransport([
      () =>
        jsonResponse({
          changes: [
            {
              fileId: 'document_1',
              removed: false,
              time: '2026-08-09T01:03:00.000Z',
              file: driveFile('document_1')
            }
          ],
          nextPageToken: 'next-change'
        }),
      () =>
        jsonResponse({
          changes: [{ fileId: 'document_2', removed: true, file: null }],
          newStartPageToken: 'fresh-start'
        }),
      () => jsonResponse(driveFile('document_1', { trashed: true }))
    ])
    const client = new GoogleDriveClient({ tokenSource: tokenSource(), transport })

    const changes = await client.listChanges('start-token')
    await client.trashFile('document_1')

    expect(changes.newStartPageToken).toBe('fresh-start')
    expect(changes.changes.map((change) => [change.fileId, change.removed])).toEqual([
      ['document_1', false],
      ['document_2', true]
    ])
    expect(calls[1]?.url.searchParams.get('pageToken')).toBe('next-change')
    expect(calls[2]?.init.method).toBe('PATCH')
    expect(JSON.parse(stringBody(callAt(calls, 2)))).toEqual({ trashed: true })
  })

  test('surfaces bounded structured rate-limit errors', async () => {
    const { transport } = queuedTransport([
      () =>
        jsonResponse(
          {
            error: {
              message: 'Too many requests',
              status: 'RESOURCE_EXHAUSTED',
              errors: [{ reason: 'rateLimitExceeded' }]
            }
          },
          { status: 429, headers: { 'retry-after': '2' } }
        )
    ])
    const client = new GoogleDriveClient({
      tokenSource: tokenSource(),
      transport,
      limits: { maxRequestAttempts: 1 }
    })

    try {
      await client.generateIds()
      throw new Error('Expected generateIds to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(GoogleDriveError)
      expect(error).toMatchObject({
        code: 'rate-limited',
        status: 429,
        retryable: true,
        retryAfterMs: 2_000,
        reason: 'rateLimitExceeded'
      })
    }
  })

  test('fails closed if the account or grant changes during an operation', async () => {
    let resolutions = 0
    const source = {
      getAccessToken() {
        resolutions += 1
        return Promise.resolve({
          ...TOKEN,
          authorizationVersion: resolutions === 1 ? 'grant-1' : 'grant-2'
        })
      }
    }
    let transportCalls = 0
    const client = new GoogleDriveClient({
      tokenSource: source,
      transport: () => {
        transportCalls += 1
        return Promise.resolve(jsonResponse({ ids: ['document_1'] }))
      }
    })

    await expect(client.generateIds()).rejects.toMatchObject({ code: 'authorization-changed' })
    expect(transportCalls).toBe(0)
  })

  test('does not retry an upload under a replacement authorization grant', async () => {
    let resolutions = 0
    const { transport, calls } = queuedTransport([
      () =>
        new Response(null, {
          headers: {
            location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=grant-switch'
          }
        })
    ])
    const client = new GoogleDriveClient({
      tokenSource: {
        getAccessToken() {
          resolutions += 1
          return Promise.resolve({
            ...TOKEN,
            authorizationVersion: resolutions < 3 ? 'grant-1' : 'grant-2'
          })
        }
      },
      transport,
      sleep: () => Promise.resolve()
    })

    await expect(
      client.createFile({
        id: 'document_1',
        bytes: new Uint8Array([1]),
        metadata: { name: 'test.fig' }
      })
    ).rejects.toMatchObject({ code: 'authorization-changed' })
    expect(calls).toHaveLength(1)
    expect(resolutions).toBe(3)
  })

  test('streams a ranged media download through the injected Tauri transport', async () => {
    const chunkBytes = 1024 * 1024
    const source = new Uint8Array(chunkBytes + 3).fill(5)
    const requests: GoogleDriveNativeTransferRequest[] = []
    const transfer: GoogleDriveNativeTransferInvoker = (request) => {
      requests.push(request)
      const range = new Headers(request.headers?.map(({ name, value }) => [name, value])).get(
        'range'
      )
      const match = range ? /^bytes=(\d+)-(\d+)$/.exec(range) : null
      if (!match) throw new Error('Expected a native ranged request')
      const start = Number(match[1])
      const requestedEnd = Number(match[2])
      const end = Math.min(requestedEnd, source.byteLength - 1)
      const body = [...source.subarray(start, end + 1)]
      return Promise.resolve({
        status: 206,
        headers: [
          { name: 'content-range', value: `bytes ${start}-${end}/${source.byteLength}` },
          { name: 'content-length', value: String(body.length) },
          { name: 'etag', value: '"native-media"' },
          { name: 'content-disposition', value: 'attachment; filename="native.fig"' }
        ],
        body
      })
    }
    const transport = createGoogleDriveTauriTransport({
      transfer,
      downloadChunkBytes: chunkBytes,
      maxDownloadBytes: chunkBytes * 2
    })
    const client = new GoogleDriveClient({ tokenSource: tokenSource(), transport })

    const result = await client.downloadFile('document_1')

    expect(result.bytes.byteLength).toBe(source.byteLength)
    expect(result.bytes[0]).toBe(5)
    expect(result.bytes.at(-1)).toBe(5)
    expect(result.metadata.name).toBe('native.fig')
    expect(result.remoteRevision).toEqual({ etag: '"native-media"' })
    expect(requests.map((request) => request.kind)).toEqual(['download-chunk', 'download-chunk'])
  })

  test('runs a resumable upload through the injected Tauri transport', async () => {
    const requests: GoogleDriveNativeTransferRequest[] = []
    const transfer: GoogleDriveNativeTransferInvoker = (request) => {
      requests.push(request)
      if (request.kind === 'resumable-init') {
        return Promise.resolve({
          status: 200,
          headers: [
            {
              name: 'location',
              value: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=native-upload'
            }
          ],
          body: []
        })
      }
      if (request.kind === 'upload-chunk') {
        return Promise.resolve({
          status: 200,
          headers: [{ name: 'etag', value: '"native-uploaded"' }],
          body: [...new TextEncoder().encode(JSON.stringify(driveFile('document_1')))]
        })
      }
      throw new Error(`Unexpected native transfer kind: ${request.kind}`)
    }
    const client = new GoogleDriveClient({
      tokenSource: tokenSource(),
      transport: createGoogleDriveTauriTransport({ transfer })
    })

    const result = await client.createFile({
      id: 'document_1',
      bytes: new Uint8Array([1, 2, 3]),
      metadata: { name: 'native.fig' }
    })

    expect(result).toMatchObject({
      file: { id: 'document_1' },
      remoteRevision: { etag: '"native-uploaded"' }
    })
    expect(requests.map((request) => request.kind)).toEqual(['resumable-init', 'upload-chunk'])
    expect(requests[1]?.body).toEqual([1, 2, 3])
    expect(
      new Headers(requests[1]?.headers?.map(({ name, value }) => [name, value])).get(
        'content-range'
      )
    ).toBe('bytes 0-2/3')
  })
})
