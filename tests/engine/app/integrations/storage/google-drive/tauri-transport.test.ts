import { describe, expect, test } from 'bun:test'

import {
  createGoogleDriveTauriTransport,
  GoogleDriveNativeError,
  type GoogleDriveNativeTransferInvoker,
  type GoogleDriveNativeTransferRequest,
  type GoogleDriveNativeTransferResponse
} from '@/app/tauri/google-drive'

const MEBIBYTE = 1024 * 1024

function headerValue(request: GoogleDriveNativeTransferRequest, name: string): string | null {
  return request.headers?.find((header) => header.name.toLocaleLowerCase() === name)?.value ?? null
}

function nativeResponse(
  status: number,
  body: Uint8Array,
  headers: Array<[string, string]> = []
): GoogleDriveNativeTransferResponse {
  return {
    status,
    headers: headers.map(([name, value]) => ({ name, value })),
    body: [...body]
  }
}

describe('Google Drive Tauri transport', () => {
  test('classifies bounded JSON and resumable requests for the native bridge', async () => {
    const requests: GoogleDriveNativeTransferRequest[] = []
    const transfer: GoogleDriveNativeTransferInvoker = (request) => {
      requests.push(request)
      return Promise.resolve(nativeResponse(200, new TextEncoder().encode('{}')))
    }
    const transport = createGoogleDriveTauriTransport({ transfer })

    await transport('https://www.googleapis.com/drive/v3/files?pageSize=10', {
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: 'Bearer access-token' }
    })
    await transport(
      'https://www.googleapis.com/upload/drive/v3/files/file-id?uploadType=resumable',
      {
        method: 'PATCH',
        redirect: 'error',
        headers: {
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json',
          'If-Match': 'revision'
        },
        body: '{}'
      }
    )
    await transport('https://www.googleapis.com/upload/drive/v3/files/file-id?upload_id=session', {
      method: 'PUT',
      redirect: 'error',
      headers: {
        Authorization: 'Bearer access-token',
        'Content-Length': '3',
        'Content-Range': 'bytes 0-2/3'
      },
      body: new Uint8Array([1, 2, 3])
    })

    expect(requests.map((request) => request.kind)).toEqual([
      'api',
      'resumable-init',
      'upload-chunk'
    ])
    expect(requests[1].body).toEqual([...new TextEncoder().encode('{}')])
    expect(requests[2].body).toEqual([1, 2, 3])
    expect(requests.every((request) => request.maxResponseBytes === 2 * MEBIBYTE)).toBe(true)
  })

  test('reads a bounded body inherited from a Request input', async () => {
    let received: number[] | undefined
    const transfer: GoogleDriveNativeTransferInvoker = (request) => {
      received = request.body
      return Promise.resolve(nativeResponse(200, new TextEncoder().encode('{}')))
    }
    const transport = createGoogleDriveTauriTransport({ transfer })
    const request = new Request(
      'https://www.googleapis.com/upload/drive/v3/files/file-id?uploadType=resumable',
      {
        method: 'PATCH',
        redirect: 'error',
        headers: {
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json'
        },
        body: '{"name":"design.fig"}'
      }
    )

    await transport(request)

    expect(new TextDecoder().decode(new Uint8Array(received ?? []))).toBe('{"name":"design.fig"}')
  })

  test('streams alt=media through strict native Range chunks', async () => {
    const total = MEBIBYTE + 3
    const requests: GoogleDriveNativeTransferRequest[] = []
    const transfer: GoogleDriveNativeTransferInvoker = (request) => {
      requests.push(request)
      const range = headerValue(request, 'range')
      if (range === `bytes=0-${MEBIBYTE - 1}`) {
        return Promise.resolve(
          nativeResponse(206, new Uint8Array(MEBIBYTE).fill(7), [
            ['content-range', `bytes 0-${MEBIBYTE - 1}/${total}`],
            ['content-length', String(MEBIBYTE)],
            ['content-disposition', 'attachment; filename="design.fig"'],
            ['last-modified', 'Sat, 09 Aug 2026 00:00:00 GMT'],
            ['etag', '"revision-a"'],
            ['x-goog-generation', '42'],
            ['x-goog-hash', 'md5=AAAAAAAAAAAAAAAAAAAAAA==']
          ])
        )
      }
      expect(range).toBe(`bytes=${MEBIBYTE}-${2 * MEBIBYTE - 1}`)
      return Promise.resolve(
        nativeResponse(206, new Uint8Array([8, 9, 10]), [
          ['content-range', `bytes ${MEBIBYTE}-${total - 1}/${total}`],
          ['content-length', '3']
        ])
      )
    }
    const transport = createGoogleDriveTauriTransport({
      transfer,
      downloadChunkBytes: MEBIBYTE,
      maxDownloadBytes: 2 * MEBIBYTE
    })

    const response = await transport(
      'https://www.googleapis.com/drive/v3/files/file-id?alt=media',
      {
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: 'Bearer access-token' }
      }
    )
    const body = new Uint8Array(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(String(total))
    expect(response.headers.get('content-disposition')).toContain('design.fig')
    expect(response.headers.get('etag')).toBe('"revision-a"')
    expect(body.byteLength).toBe(total)
    expect(body[0]).toBe(7)
    expect(Array.from(body.slice(-3))).toEqual([8, 9, 10])
    expect(requests).toHaveLength(2)
    expect(requests.every((request) => request.kind === 'download-chunk')).toBe(true)
    expect(requests.every((request) => request.maxResponseBytes === MEBIBYTE)).toBe(true)
    expect(headerValue(requests[0], 'if-match')).toBeNull()
    expect(headerValue(requests[1], 'if-match')).toBe('"revision-a"')
  })

  test('retries the same continuation range for network, timeout, and 5xx failures', async () => {
    const total = MEBIBYTE + 3
    const requests: GoogleDriveNativeTransferRequest[] = []
    const delays: number[] = []
    let continuationAttempt = 0
    const transfer: GoogleDriveNativeTransferInvoker = (request) => {
      requests.push(request)
      if (headerValue(request, 'range') === `bytes=0-${MEBIBYTE - 1}`) {
        return Promise.resolve(
          nativeResponse(206, new Uint8Array(MEBIBYTE).fill(1), [
            ['content-range', `bytes 0-${MEBIBYTE - 1}/${total}`],
            ['etag', '"stable-revision"']
          ])
        )
      }
      continuationAttempt++
      if (continuationAttempt === 1) {
        return Promise.reject(new GoogleDriveNativeError('network-failed', 'network failed'))
      }
      if (continuationAttempt === 2) {
        return Promise.reject(new GoogleDriveNativeError('timeout', 'timed out'))
      }
      if (continuationAttempt === 3) {
        return Promise.resolve(nativeResponse(503, new Uint8Array(), [['retry-after', '1']]))
      }
      return Promise.resolve(
        nativeResponse(206, new Uint8Array([2, 3, 4]), [
          ['content-range', `bytes ${MEBIBYTE}-${total - 1}/${total}`],
          ['etag', '"stable-revision"']
        ])
      )
    }
    const transport = createGoogleDriveTauriTransport({
      transfer,
      downloadChunkBytes: MEBIBYTE,
      maxDownloadBytes: 2 * MEBIBYTE,
      sleep: (delayMs) => {
        delays.push(delayMs)
        return Promise.resolve()
      }
    })

    const response = await transport(
      'https://www.googleapis.com/drive/v3/files/file-id?alt=media',
      {
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: 'Bearer access-token' }
      }
    )
    const bytes = new Uint8Array(await response.arrayBuffer())

    expect(bytes.byteLength).toBe(total)
    expect(delays).toEqual([250, 500, 1_000])
    const continuation = requests.slice(1)
    expect(continuation).toHaveLength(4)
    expect(new Set(continuation.map((request) => request.url)).size).toBe(1)
    expect(
      continuation.every(
        (request) => headerValue(request, 'range') === `bytes=${MEBIBYTE}-${2 * MEBIBYTE - 1}`
      )
    ).toBe(true)
    expect(
      continuation.every((request) => headerValue(request, 'if-match') === '"stable-revision"')
    ).toBe(true)
    expect(
      continuation.every(
        (request) => headerValue(request, 'authorization') === 'Bearer access-token'
      )
    ).toBe(true)
  })

  test('bounds continuation retries and honors cancellation during Retry-After', async () => {
    const total = MEBIBYTE + 1
    const requests: GoogleDriveNativeTransferRequest[] = []
    let releaseSleep: (() => void) | undefined
    const sleepStarted = new Promise<void>((resolve) => {
      releaseSleep = resolve
    })
    const transfer: GoogleDriveNativeTransferInvoker = (request) => {
      requests.push(request)
      if (requests.length === 1) {
        return Promise.resolve(
          nativeResponse(206, new Uint8Array(MEBIBYTE), [
            ['content-range', `bytes 0-${MEBIBYTE - 1}/${total}`],
            ['etag', '"cancel-revision"']
          ])
        )
      }
      return Promise.resolve(nativeResponse(429, new Uint8Array(), [['retry-after', '60']]))
    }
    const transport = createGoogleDriveTauriTransport({
      transfer,
      downloadChunkBytes: MEBIBYTE,
      maxDownloadBytes: 2 * MEBIBYTE,
      sleep: (_delayMs, signal) => {
        releaseSleep?.()
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      }
    })
    const controller = new AbortController()
    const response = await transport(
      'https://www.googleapis.com/drive/v3/files/file-id?alt=media',
      {
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: 'Bearer access-token' },
        signal: controller.signal
      }
    )
    const body = response.arrayBuffer()
    await sleepStarted
    controller.abort(new Error('cancelled during retry'))

    await expect(body).rejects.toThrow('cancelled during retry')
    expect(requests).toHaveLength(2)
  })

  test('fails closed when the first ETag is missing or the remote file changes', async () => {
    const total = MEBIBYTE + 1
    const withoutEtag = createGoogleDriveTauriTransport({
      transfer: () =>
        Promise.resolve(
          nativeResponse(206, new Uint8Array(MEBIBYTE), [
            ['content-range', `bytes 0-${MEBIBYTE - 1}/${total}`]
          ])
        ),
      downloadChunkBytes: MEBIBYTE,
      maxDownloadBytes: 2 * MEBIBYTE
    })
    await expect(
      withoutEtag('https://www.googleapis.com/drive/v3/files/file-id?alt=media', {
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: 'Bearer access-token' }
      })
    ).rejects.toThrow('requires an ETag')

    const requests: GoogleDriveNativeTransferRequest[] = []
    const changed = createGoogleDriveTauriTransport({
      transfer: (request) => {
        requests.push(request)
        if (requests.length === 1) {
          return Promise.resolve(
            nativeResponse(206, new Uint8Array(MEBIBYTE), [
              ['content-range', `bytes 0-${MEBIBYTE - 1}/${total}`],
              ['etag', '"original-revision"']
            ])
          )
        }
        return Promise.resolve(nativeResponse(412, new Uint8Array()))
      },
      downloadChunkBytes: MEBIBYTE,
      maxDownloadBytes: 2 * MEBIBYTE
    })
    const response = await changed('https://www.googleapis.com/drive/v3/files/file-id?alt=media', {
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: 'Bearer access-token' }
    })

    await expect(response.arrayBuffer()).rejects.toThrow('file changed')
    expect(headerValue(requests[1], 'if-match')).toBe('"original-revision"')
  })

  test('stops after the bounded continuation attempt limit', async () => {
    const total = MEBIBYTE + 1
    let calls = 0
    const transport = createGoogleDriveTauriTransport({
      transfer: () => {
        calls++
        if (calls === 1) {
          return Promise.resolve(
            nativeResponse(206, new Uint8Array(MEBIBYTE), [
              ['content-range', `bytes 0-${MEBIBYTE - 1}/${total}`],
              ['etag', '"bounded-revision"']
            ])
          )
        }
        return Promise.resolve(nativeResponse(500, new Uint8Array()))
      },
      downloadChunkBytes: MEBIBYTE,
      maxDownloadBytes: 2 * MEBIBYTE,
      sleep: () => Promise.resolve()
    })
    const response = await transport(
      'https://www.googleapis.com/drive/v3/files/file-id?alt=media',
      {
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: 'Bearer access-token' }
      }
    )

    await expect(response.arrayBuffer()).rejects.toThrow('retry limit')
    expect(calls).toBe(5)
  })

  test('rejects inconsistent Content-Range totals before exposing a stream', async () => {
    const transfer: GoogleDriveNativeTransferInvoker = () =>
      Promise.resolve(
        nativeResponse(206, new Uint8Array([1, 2, 3]), [
          ['content-range', 'bytes 1-3/3'],
          ['content-length', '3']
        ])
      )
    const transport = createGoogleDriveTauriTransport({
      transfer,
      downloadChunkBytes: MEBIBYTE,
      maxDownloadBytes: MEBIBYTE
    })

    await expect(
      transport('https://www.googleapis.com/drive/v3/files/file-id?alt=media', {
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: 'Bearer access-token' }
      })
    ).rejects.toThrow('inconsistent ranged download bytes')
  })

  test('rejects a successful ranged download that does not return 206', async () => {
    const transfer: GoogleDriveNativeTransferInvoker = () =>
      Promise.resolve(nativeResponse(200, new Uint8Array([1, 2, 3])))
    const transport = createGoogleDriveTauriTransport({
      transfer,
      downloadChunkBytes: MEBIBYTE,
      maxDownloadBytes: MEBIBYTE
    })

    await expect(
      transport('https://www.googleapis.com/drive/v3/files/file-id?alt=media', {
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: 'Bearer access-token' }
      })
    ).rejects.toThrow('did not return 206')
  })

  test('propagates AbortSignal before dispatch', async () => {
    let calls = 0
    const transfer: GoogleDriveNativeTransferInvoker = () => {
      calls++
      return Promise.resolve(nativeResponse(200, new Uint8Array()))
    }
    const transport = createGoogleDriveTauriTransport({ transfer })
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))

    await expect(
      transport('https://www.googleapis.com/drive/v3/files', {
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: 'Bearer access-token' },
        signal: controller.signal
      })
    ).rejects.toThrow('cancelled')
    expect(calls).toBe(0)
  })
})
