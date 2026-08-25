import { describe, expect, test } from 'bun:test'

import { ONEDRIVE_MAX_UPLOAD_CHUNK_BYTES } from '@/app/integrations/storage/onedrive/config'
import {
  createOneDriveNativeBridge,
  createOneDriveNativeTransfer,
  createOneDriveTauriTransport,
  ONEDRIVE_NATIVE_MAX_TRANSFER_CHUNK_BYTES,
  type OneDriveInvoke,
  type OneDriveNativeAuthorizeResult,
  type OneDriveNativeRefreshResult,
  type OneDriveNativeTransferRequest,
  type OneDriveNativeTransferResponse
} from '@/app/tauri/onedrive'

const SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'https://graph.microsoft.com/Files.ReadWrite.AppFolder'
]

function invokeMock(
  implementation: (command: string, args?: Record<string, unknown>) => unknown
): OneDriveInvoke {
  return <T>(command: string, args?: Record<string, unknown>) =>
    Promise.resolve(implementation(command, args)) as Promise<T>
}

describe('OneDrive native OAuth bridge', () => {
  test('authorizes with only operation metadata and no renderer-controlled OAuth identity', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    const result: OneDriveNativeAuthorizeResult = {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 3_600,
      grantedScopes: SCOPES,
      subject: 'subject',
      email: 'person@example.com'
    }
    const bridge = createOneDriveNativeBridge(
      invokeMock((command, args) => {
        calls.push({ command, args })
        return result
      })
    )

    expect(await bridge.authorize({ timeoutMs: 20_000 })).toEqual(result)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.command).toBe('onedrive_oauth_authorize')
    expect(calls[0]?.args?.request).toEqual({
      timeoutMs: 20_000,
      operationId: expect.stringMatching(/^[0-9a-f]{32}$/)
    })
  })

  test('returns refresh-token rotation and the exact revalidated scope set', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    const result: OneDriveNativeRefreshResult = {
      accessToken: 'next-access',
      refreshToken: 'rotated-refresh',
      expiresIn: 3_600,
      grantedScopes: SCOPES,
      subject: 'subject'
    }
    const bridge = createOneDriveNativeBridge(
      invokeMock((command, args) => {
        calls.push({ command, args })
        return result
      })
    )

    expect(
      await bridge.refresh({ refreshToken: 'old-refresh', expectedSubject: 'subject' })
    ).toEqual(result)
    expect(calls[0]?.command).toBe('onedrive_oauth_refresh')
    expect(calls[0]?.args?.request).toEqual({
      refreshToken: 'old-refresh',
      expectedSubject: 'subject',
      operationId: expect.stringMatching(/^[0-9a-f]{32}$/)
    })
  })

  test('cancels an aborted operation without attempting a remote revoke', async () => {
    const calls: string[] = []
    let settle!: (value: OneDriveNativeAuthorizeResult) => void
    const authorization = new Promise<OneDriveNativeAuthorizeResult>((resolve) => {
      settle = resolve
    })
    const invoke: OneDriveInvoke = <T>(command: string) => {
      calls.push(command)
      if (command === 'onedrive_oauth_authorize') return authorization as Promise<T>
      return Promise.resolve(true as T)
    }
    const bridge = createOneDriveNativeBridge(invoke)
    const controller = new AbortController()
    const reason = new DOMException('stop', 'AbortError')
    const pending = bridge.authorize({}, controller.signal)

    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    settle({
      accessToken: 'late-access',
      refreshToken: 'late-refresh',
      expiresIn: 3_600,
      grantedScopes: SCOPES,
      subject: 'subject'
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(calls).toContain('onedrive_oauth_cancel')
    expect(calls.some((command) => command.includes('revoke'))).toBe(false)
  })
})

describe('OneDrive native transfer bridge', () => {
  test('shares the integration client 10 MiB chunk ceiling', () => {
    expect(ONEDRIVE_NATIVE_MAX_TRANSFER_CHUNK_BYTES).toBe(10 * 1024 * 1024)
    expect(ONEDRIVE_NATIVE_MAX_TRANSFER_CHUNK_BYTES).toBe(ONEDRIVE_MAX_UPLOAD_CHUNK_BYTES)
  })

  test('invokes the dedicated command and maps static native errors', async () => {
    const requests: unknown[] = []
    const transfer = createOneDriveNativeTransfer(
      invokeMock((_command, args) => {
        requests.push(args?.request)
        throw Object.assign(new Error('provider-controlled detail'), {
          code: 'response-too-large'
        })
      })
    )

    await expect(
      transfer({
        kind: 'api',
        url: 'https://graph.microsoft.com/v1.0/me/drive',
        method: 'GET',
        headers: [{ name: 'authorization', value: 'Bearer access' }],
        maxResponseBytes: 1024
      })
    ).rejects.toMatchObject({
      code: 'response-too-large',
      message: 'OneDrive response exceeded the byte limit'
    })
    expect(requests).toHaveLength(1)
  })

  test('classifies only Graph v1.0 and known preauthorized hosts', async () => {
    const kinds: string[] = []
    const transport = createOneDriveTauriTransport({
      transfer: async (request: OneDriveNativeTransferRequest) => {
        kinds.push(request.kind)
        return { status: 200, headers: [], body: [] }
      }
    })

    await transport('https://graph.microsoft.com/v1.0/me/drive', {
      headers: { authorization: 'Bearer access' },
      redirect: 'error'
    })
    await transport('https://sn3302.up.1drv.com/up/exact-capability', {
      method: 'POST',
      redirect: 'error'
    })
    expect(kinds).toEqual(['api', 'upload-session'])
    await expect(
      transport('https://graph.microsoft.com/beta/me/drive', { redirect: 'error' })
    ).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(
      transport('https://evil.example/v1.0/me/drive', { redirect: 'error' })
    ).rejects.toMatchObject({ code: 'invalid-request' })
  })

  test('keeps a SharePoint upload capability classified during PUT and status GET', async () => {
    const uploadURL = 'https://tenant.sharepoint.com/upload/exact-capability'
    const kinds: string[] = []
    const transport = createOneDriveTauriTransport({
      transfer: async (request: OneDriveNativeTransferRequest) => {
        kinds.push(request.kind)
        if (request.kind === 'api') {
          return {
            status: 200,
            headers: [{ name: 'content-type', value: 'application/json' }],
            body: [...new TextEncoder().encode(JSON.stringify({ uploadUrl: uploadURL }))]
          }
        }
        return {
          status: 200,
          headers: [{ name: 'content-type', value: 'application/json' }],
          body: [...new TextEncoder().encode(JSON.stringify({ nextExpectedRanges: ['0-'] }))]
        }
      }
    })

    await transport('https://graph.microsoft.com/v1.0/me/drive/createUploadSession', {
      method: 'POST',
      headers: { authorization: 'Bearer access', 'content-type': 'application/json' },
      body: '{}',
      redirect: 'error'
    })
    await transport(uploadURL, {
      method: 'PUT',
      headers: {
        'content-length': '3',
        'content-range': 'bytes 0-2/3',
        'content-type': 'application/octet-stream'
      },
      body: new Uint8Array([1, 2, 3]),
      redirect: 'error'
    })
    await transport(uploadURL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error'
    })

    expect(kinds).toEqual(['api', 'upload-session', 'upload-session'])
  })

  test('assembles bounded ranged downloads and pins continuations with If-Range', async () => {
    const chunkBytes = 320 * 1024
    const calls: Array<{ range: string | null; ifRange: string | null }> = []
    const transfer = async (
      request: OneDriveNativeTransferRequest
    ): Promise<OneDriveNativeTransferResponse> => {
      const headers = new Headers(
        request.headers?.map(({ name, value }): [string, string] => [name, value])
      )
      const range = headers.get('range')
      calls.push({ range, ifRange: headers.get('if-range') })
      const first = calls.length === 1
      return {
        status: 206,
        headers: [
          {
            name: 'content-range',
            value: first
              ? `bytes 0-${chunkBytes - 1}/${chunkBytes + 7}`
              : `bytes ${chunkBytes}-${chunkBytes + 6}/${chunkBytes + 7}`
          },
          { name: 'content-length', value: String(first ? chunkBytes : 7) },
          { name: 'etag', value: '"revision"' }
        ],
        body: [...new Uint8Array(first ? chunkBytes : 7).fill(first ? 1 : 2)]
      }
    }
    const transport = createOneDriveTauriTransport({
      transfer,
      downloadChunkBytes: chunkBytes,
      maxDownloadBytes: chunkBytes * 2
    })
    const response = await transport(
      'https://b0mpua-by3301.files.1drv.com/download/exact-capability',
      { redirect: 'error' }
    )

    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(response.status).toBe(200)
    expect(bytes).toHaveLength(chunkBytes + 7)
    expect(bytes[0]).toBe(1)
    expect(bytes.at(-1)).toBe(2)
    expect(calls).toEqual([
      { range: `bytes=0-${chunkBytes - 1}`, ifRange: null },
      { range: `bytes=${chunkBytes}-${chunkBytes * 2 - 1}`, ifRange: '"revision"' }
    ])
  })

  test('bounds Graph request bodies before invoking native code', async () => {
    let invoked = false
    const transport = createOneDriveTauriTransport({
      transfer: async () => {
        invoked = true
        return { status: 200, headers: [], body: [] }
      }
    })
    await expect(
      transport('https://graph.microsoft.com/v1.0/me/drive/items/id/content', {
        method: 'PUT',
        body: new Uint8Array(1024 * 1024 + 1),
        headers: { authorization: 'Bearer access' },
        redirect: 'error'
      })
    ).rejects.toMatchObject({ code: 'invalid-request' })
    expect(invoked).toBe(false)
  })
})
