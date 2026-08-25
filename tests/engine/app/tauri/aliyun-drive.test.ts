import { describe, expect, test } from 'bun:test'

import { ALIYUN_DRIVE_MAX_UPLOAD_CHUNK_BYTES } from '@/app/integrations/storage/aliyun-drive/config'
import {
  ALIYUN_DRIVE_NATIVE_MAX_TRANSFER_CHUNK_BYTES,
  createAliyunDriveNativeBridge,
  createAliyunDriveNativeTransfer,
  createAliyunDriveTauriTransport,
  type AliyunDriveInvoke,
  type AliyunDriveNativeAuthorizeResult,
  type AliyunDriveNativeTransferRequest
} from '@/app/tauri/aliyun-drive'

const SCOPES = ['user:base', 'file:all:read', 'file:all:write']
const UPLOAD_URL = 'https://upload.example.test/exact-part'
const DOWNLOAD_URL = 'https://download.example.test/exact-file'

function invokeMock(
  implementation: (command: string, args?: Record<string, unknown>) => unknown
): AliyunDriveInvoke {
  return <T>(command: string, args?: Record<string, unknown>) =>
    Promise.resolve(implementation(command, args)) as Promise<T>
}

describe('Aliyun Drive native OAuth bridge', () => {
  test('authorizes the publisher Broker without renderer-controlled identity or secret', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    const result: AliyunDriveNativeAuthorizeResult = {
      grantType: 'refresh-grant',
      accessToken: 'access',
      refreshToken: 'rotated-refresh',
      expiresIn: 30 * 24 * 60 * 60,
      grantedScopes: SCOPES,
      subject: 'aliyun-user',
      email: 'person@example.com'
    }
    const bridge = createAliyunDriveNativeBridge(
      invokeMock((command, args) => {
        calls.push({ command, args })
        return result
      })
    )

    expect(
      await bridge.authorize({
        oauthClient: { mode: 'publisher-broker-confidential' },
        timeoutMs: 20_000
      })
    ).toEqual(result)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.command).toBe('aliyun_drive_oauth_authorize')
    expect(calls[0]?.args?.request).toEqual({
      oauthClient: { mode: 'publisher-broker-confidential' },
      timeoutMs: 20_000,
      operationId: expect.stringMatching(/^[0-9a-f]{32}$/)
    })
    expect(calls[0]?.args?.request).not.toHaveProperty('clientId')
    expect(calls[0]?.args?.request).not.toHaveProperty('clientSecret')
    expect(result.refreshToken).toBe('rotated-refresh')
  })

  test('refreshes only with an explicit confidential mode and expected subject', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    const bridge = createAliyunDriveNativeBridge(
      invokeMock((command, args) => {
        calls.push({ command, args })
        return {
          grantType: 'refresh-grant',
          accessToken: 'next-access',
          refreshToken: 'next-refresh',
          expiresIn: 7_200,
          grantedScopes: SCOPES,
          subject: 'aliyun-user'
        }
      })
    )

    await expect(
      bridge.refresh({
        oauthClient: { mode: 'publisher-broker-confidential' },
        refreshToken: 'prior-refresh',
        expectedSubject: 'aliyun-user'
      })
    ).resolves.toMatchObject({ refreshToken: 'next-refresh' })
    expect(calls[0]?.command).toBe('aliyun_drive_oauth_refresh')
    expect(calls[0]?.args?.request).toMatchObject({
      oauthClient: { mode: 'publisher-broker-confidential' },
      refreshToken: 'prior-refresh',
      expectedSubject: 'aliyun-user',
      operationId: expect.stringMatching(/^[0-9a-f]{32}$/)
    })
  })

  test('cancels an aborted operation without attempting revoke or refresh', async () => {
    const calls: string[] = []
    let settle!: (value: AliyunDriveNativeAuthorizeResult) => void
    const authorization = new Promise<AliyunDriveNativeAuthorizeResult>((resolve) => {
      settle = resolve
    })
    const invoke: AliyunDriveInvoke = <T>(command: string) => {
      calls.push(command)
      if (command === 'aliyun_drive_oauth_authorize') return authorization as Promise<T>
      return Promise.resolve(true as T)
    }
    const bridge = createAliyunDriveNativeBridge(invoke)
    const controller = new AbortController()
    const reason = new DOMException('stop', 'AbortError')
    const pending = bridge.authorize(
      { oauthClient: { mode: 'publisher-broker-confidential' } },
      controller.signal
    )

    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    settle({
      grantType: 'refresh-grant',
      accessToken: 'late-access',
      refreshToken: 'late-refresh',
      expiresIn: 30 * 24 * 60 * 60,
      grantedScopes: SCOPES,
      subject: 'aliyun-user'
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(calls).toContain('aliyun_drive_oauth_cancel')
    expect(calls.some((command) => command.includes('revoke'))).toBe(false)
    expect(calls.some((command) => command.includes('refresh'))).toBe(false)
  })
})

describe('Aliyun Drive native transfer bridge', () => {
  test('shares the integration client 10 MiB chunk ceiling', () => {
    expect(ALIYUN_DRIVE_NATIVE_MAX_TRANSFER_CHUNK_BYTES).toBe(10 * 1024 * 1024)
    expect(ALIYUN_DRIVE_NATIVE_MAX_TRANSFER_CHUNK_BYTES).toBe(
      ALIYUN_DRIVE_MAX_UPLOAD_CHUNK_BYTES
    )
  })

  test('invokes the dedicated command and maps static native errors', async () => {
    const requests: unknown[] = []
    const transfer = createAliyunDriveNativeTransfer(
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
        url: 'https://openapi.alipan.com/adrive/v1.0/user/getDriveInfo',
        method: 'POST',
        headers: [{ name: 'authorization', value: 'Bearer access' }],
        maxResponseBytes: 1_024
      })
    ).rejects.toMatchObject({
      code: 'response-too-large',
      message: 'Aliyun Drive response exceeded the byte limit'
    })
    expect(requests).toHaveLength(1)
  })

  test('allows only the fixed OpenAPI origin and exact capabilities learned from trusted responses', async () => {
    const kinds: string[] = []
    const transfer = async (request: AliyunDriveNativeTransferRequest) => {
      kinds.push(request.kind)
      if (request.url.endsWith('/openFile/create')) {
        return {
          status: 200,
          headers: [{ name: 'content-type', value: 'application/json' }],
          body: [
            ...new TextEncoder().encode(
              JSON.stringify({
                file_id: 'new-file',
                upload_id: 'upload-1',
                part_info_list: [{ part_number: 1, upload_url: UPLOAD_URL }]
              })
            )
          ]
        }
      }
      if (request.url.endsWith('/openFile/getDownloadUrl')) {
        return {
          status: 200,
          headers: [{ name: 'content-type', value: 'application/json' }],
          body: [...new TextEncoder().encode(JSON.stringify({ url: DOWNLOAD_URL }))]
        }
      }
      return { status: 200, headers: [], body: [] }
    }
    const transport = createAliyunDriveTauriTransport({ transfer })

    await transport('https://openapi.alipan.com/adrive/v1.0/openFile/create', {
      method: 'POST',
      headers: { authorization: 'Bearer access', 'content-type': 'application/json' },
      body: '{}',
      redirect: 'error'
    })
    await transport(UPLOAD_URL, {
      method: 'PUT',
      body: new Uint8Array([1, 2, 3]),
      redirect: 'error'
    })
    await transport('https://openapi.alipan.com/adrive/v1.0/openFile/getDownloadUrl', {
      method: 'POST',
      headers: { authorization: 'Bearer access', 'content-type': 'application/json' },
      body: '{}',
      redirect: 'error'
    })
    await transport(DOWNLOAD_URL, { method: 'GET', redirect: 'error' })

    expect(kinds).toEqual(['api', 'upload', 'api', 'download'])
    await expect(
      transport('https://openapi.alipan.com.evil.example/adrive/v1.0/openFile/list', {
        method: 'POST',
        headers: { authorization: 'Bearer access' },
        redirect: 'error'
      })
    ).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(
      transport('https://upload.example.test/different-part', {
        method: 'PUT',
        redirect: 'error'
      })
    ).rejects.toMatchObject({ code: 'invalid-request' })
  })

  test('rejects bearer forwarding and wrong methods on signed capabilities', async () => {
    const transport = createAliyunDriveTauriTransport({
      transfer: async (request) => {
        if (request.kind === 'api') {
          return {
            status: 200,
            headers: [{ name: 'content-type', value: 'application/json' }],
            body: [
              ...new TextEncoder().encode(
                JSON.stringify({
                  file_id: 'new-file',
                  upload_id: 'upload-1',
                  part_info_list: [{ part_number: 1, upload_url: UPLOAD_URL }]
                })
              )
            ]
          }
        }
        return { status: 200, headers: [], body: [] }
      }
    })
    await transport('https://openapi.alipan.com/adrive/v1.0/openFile/create', {
      method: 'POST',
      headers: { authorization: 'Bearer access', 'content-type': 'application/json' },
      body: '{}',
      redirect: 'error'
    })

    await expect(
      transport(UPLOAD_URL, {
        method: 'PUT',
        headers: { authorization: 'Bearer must-not-leak' },
        redirect: 'error'
      })
    ).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(
      transport(UPLOAD_URL, { method: 'GET', redirect: 'error' })
    ).rejects.toMatchObject({ code: 'invalid-request' })
  })

  test('bounds API request bodies before invoking native code', async () => {
    let invoked = false
    const transport = createAliyunDriveTauriTransport({
      transfer: async () => {
        invoked = true
        return { status: 200, headers: [], body: [] }
      }
    })

    await expect(
      transport('https://openapi.alipan.com/adrive/v1.0/openFile/create', {
        method: 'POST',
        body: new Uint8Array(1024 * 1024 + 1),
        headers: { authorization: 'Bearer access' },
        redirect: 'error'
      })
    ).rejects.toMatchObject({ code: 'invalid-request' })
    expect(invoked).toBe(false)
  })

  test('rejects oversized or malformed native responses', async () => {
    const oversized = createAliyunDriveTauriTransport({
      maxDownloadBytes: 3,
      transfer: async (request) =>
        request.kind === 'api'
          ? {
              status: 200,
              headers: [{ name: 'content-type', value: 'application/json' }],
              body: [...new TextEncoder().encode(JSON.stringify({ url: DOWNLOAD_URL }))]
            }
          : { status: 200, headers: [], body: [1, 2, 3, 4] }
    })
    const transport = createAliyunDriveTauriTransport({
      transfer: async () => ({ status: 200, headers: [], body: [256] })
    })

    await oversized('https://openapi.alipan.com/adrive/v1.0/openFile/getDownloadUrl', {
      method: 'POST',
      headers: { authorization: 'Bearer access' },
      body: '{}',
      redirect: 'error'
    })
    await expect(
      oversized(DOWNLOAD_URL, { method: 'GET', redirect: 'error' })
    ).rejects.toMatchObject({ code: 'invalid-response' })
    await expect(
      transport('https://openapi.alipan.com/adrive/v1.0/user/getDriveInfo', {
        method: 'POST',
        headers: { authorization: 'Bearer access' },
        body: '{}',
        redirect: 'error'
      })
    ).rejects.toMatchObject({ code: 'invalid-response' })
  })
})
