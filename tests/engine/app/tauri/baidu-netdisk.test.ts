import { describe, expect, test } from 'bun:test'

import { BAIDU_NETDISK_MAX_DOCUMENT_BYTES } from '@/app/integrations/storage/baidu-netdisk/config'
import {
  createBaiduNetdiskNativeBridge,
  createBaiduNetdiskNativeTransfer,
  createBaiduNetdiskTauriTransport,
  type BaiduNetdiskInvoke,
  type BaiduNetdiskNativeAuthorizeResult,
  type BaiduNetdiskNativeRefreshResult,
  type BaiduNetdiskNativeTransferRequest,
  type BaiduNetdiskNativeTransferResponse
} from '@/app/tauri/baidu-netdisk'

const SCOPES = ['basic', 'netdisk']

function invokeMock(
  implementation: (command: string, args?: Record<string, unknown>) => unknown
): BaiduNetdiskInvoke {
  return <T>(command: string, args?: Record<string, unknown>) =>
    Promise.resolve(implementation(command, args)) as Promise<T>
}

describe('Baidu Netdisk native OAuth bridge', () => {
  test('authorizes without accepting renderer-controlled AppKey or SecretKey', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    const result: BaiduNetdiskNativeAuthorizeResult = {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 2_592_000,
      grantedScopes: SCOPES,
      uk: '208281036',
      netdiskName: 'person'
    }
    const bridge = createBaiduNetdiskNativeBridge(
      invokeMock((command, args) => {
        calls.push({ command, args })
        return result
      })
    )

    expect(
      await bridge.authorize({
        oauthClient: { mode: 'publisher-broker' },
        timeoutMs: 300_000
      })
    ).toEqual(result)
    expect(calls[0]?.command).toBe('baidu_netdisk_oauth_authorize')
    expect(calls[0]?.args?.request).toEqual({
      oauthClient: { mode: 'publisher-broker' },
      timeoutMs: 300_000,
      operationId: expect.stringMatching(/^[0-9a-f]{32}$/)
    })
    expect(JSON.stringify(calls[0]?.args)).not.toContain('clientSecret')
    expect(JSON.stringify(calls[0]?.args)).not.toContain('appKey')
  })

  test('returns the rotated refresh token and revalidated decimal uk', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    const result: BaiduNetdiskNativeRefreshResult = {
      accessToken: 'next-access',
      refreshToken: 'rotated-refresh',
      expiresIn: 2_592_000,
      grantedScopes: SCOPES,
      uk: '208281036'
    }
    const bridge = createBaiduNetdiskNativeBridge(
      invokeMock((command, args) => {
        calls.push({ command, args })
        return result
      })
    )

    expect(
      await bridge.refresh({
        oauthClient: { mode: 'publisher-broker' },
        refreshToken: 'old-refresh',
        expectedUk: '208281036'
      })
    ).toEqual(result)
    expect(calls[0]?.command).toBe('baidu_netdisk_oauth_refresh')
    expect(calls[0]?.args?.request).toEqual({
      oauthClient: { mode: 'publisher-broker' },
      refreshToken: 'old-refresh',
      expectedUk: '208281036',
      operationId: expect.stringMatching(/^[0-9a-f]{32}$/)
    })
  })

  test('forwards self-hosted credentials only for an explicit self-hosted request', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    const result: BaiduNetdiskNativeAuthorizeResult = {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 2_592_000,
      grantedScopes: SCOPES,
      uk: '208281036'
    }
    const bridge = createBaiduNetdiskNativeBridge(
      invokeMock((command, args) => {
        calls.push({ command, args })
        return result
      })
    )

    await bridge.authorize({
      oauthClient: {
        mode: 'self-hosted',
        appKey: 'abcdefghijklmnopqrstuvwx',
        secretKey: 's'.repeat(32)
      }
    })
    expect(calls[0]?.args?.request).toMatchObject({
      oauthClient: {
        mode: 'self-hosted',
        appKey: 'abcdefghijklmnopqrstuvwx',
        secretKey: 's'.repeat(32)
      }
    })
  })
})

describe('Baidu Netdisk native transfer bridge', () => {
  test('rejects renderer download limits above the shared 512 MiB contract', () => {
    expect(() =>
      createBaiduNetdiskTauriTransport({
        maxDownloadBytes: BAIDU_NETDISK_MAX_DOCUMENT_BYTES + 1
      })
    ).toThrow('Baidu Netdisk request is invalid')
  })

  test('maps native errors without retaining provider-controlled detail', async () => {
    const transfer = createBaiduNetdiskNativeTransfer(
      invokeMock(() => {
        throw Object.assign(new Error('access_token=secret'), { code: 'response-too-large' })
      })
    )

    await expect(
      transfer({
        kind: 'api',
        url: 'https://pan.baidu.com/rest/2.0/xpan/file?method=list',
        method: 'GET',
        maxResponseBytes: 1024
      })
    ).rejects.toMatchObject({
      code: 'response-too-large',
      message: 'Baidu Netdisk response exceeded the byte limit'
    })
  })

  test('allows only fixed official API methods and exact registered capabilities', async () => {
    const requests: BaiduNetdiskNativeTransferRequest[] = []
    const transport = createBaiduNetdiskTauriTransport({
      transfer: async (request) => {
        requests.push(request)
        return { status: 200, headers: [], body: [] }
      }
    })

    await transport(
      'https://pan.baidu.com/rest/2.0/xpan/file?method=list&dir=%2Fapps%2FOpenPencil&access_token=a',
      { credentials: 'omit', redirect: 'error' }
    )
    const dlink = 'https://d.pcs.baidu.com/file/exact?sign=issued'
    transport.registerCapability?.('download', dlink)
    await transport(`${dlink}&access_token=a`, {
      headers: { 'User-Agent': 'pan.baidu.com' },
      credentials: 'omit',
      redirect: 'manual'
    })

    expect(requests.map((request) => request.kind)).toEqual(['api', 'download'])
    await expect(
      transport('https://pan.baidu.com/rest/2.0/xpan/file?method=download&access_token=a', {
        credentials: 'omit',
        redirect: 'error'
      })
    ).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(
      transport('https://evil.example/rest/2.0/xpan/file?method=list&access_token=a', {
        credentials: 'omit',
        redirect: 'error'
      })
    ).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(
      transport('https://d.pcs.baidu.com/file/exact?sign=changed&access_token=a', {
        headers: { 'User-Agent': 'pan.baidu.com' },
        credentials: 'omit',
        redirect: 'manual'
      })
    ).rejects.toMatchObject({ code: 'invalid-request' })
  })

  test('pins an upload capability to the exact path, uploadid, partseq, and token', async () => {
    const requests: BaiduNetdiskNativeTransferRequest[] = []
    const transport = createBaiduNetdiskTauriTransport({
      transfer: async (request) => {
        requests.push(request)
        return { status: 200, headers: [], body: [] }
      }
    })
    const upload =
      'https://c3.pcs.baidu.com/rest/2.0/pcs/superfile2?method=upload&type=tmpfile&path=%2Fapps%2FOpenPencil%2Fdoc.fig&uploadid=u1&partseq=0&access_token=a'
    transport.registerCapability?.('upload', upload)

    await transport(upload, {
      method: 'POST',
      body: new Uint8Array([1, 2, 3]),
      credentials: 'omit',
      redirect: 'error'
    })

    expect(requests[0]?.kind).toBe('upload')
    await expect(
      transport(upload.replace('partseq=0', 'partseq=1'), {
        method: 'POST',
        body: new Uint8Array([1]),
        credentials: 'omit',
        redirect: 'error'
      })
    ).rejects.toMatchObject({ code: 'invalid-request' })
  })

  test('assembles bounded Range downloads and pins every continuation with If-Range', async () => {
    const chunkBytes = 256 * 1024
    const total = chunkBytes + 3
    const calls: Array<{ range: string | null; ifRange: string | null; userAgent: string | null }> =
      []
    const transfer = async (
      request: BaiduNetdiskNativeTransferRequest
    ): Promise<BaiduNetdiskNativeTransferResponse> => {
      const headers = new Headers(
        request.headers?.map(({ name, value }): [string, string] => [name, value])
      )
      const first = calls.length === 0
      calls.push({
        range: headers.get('range'),
        ifRange: headers.get('if-range'),
        userAgent: headers.get('user-agent')
      })
      return {
        status: 206,
        headers: [
          {
            name: 'content-range',
            value: first
              ? `bytes 0-${chunkBytes - 1}/${total}`
              : `bytes ${chunkBytes}-${total - 1}/${total}`
          },
          { name: 'etag', value: '"stable"' }
        ],
        body: [...new Uint8Array(first ? chunkBytes : 3).fill(first ? 1 : 2)]
      }
    }
    const transport = createBaiduNetdiskTauriTransport({
      transfer,
      downloadChunkBytes: chunkBytes,
      maxDownloadBytes: chunkBytes * 2
    })
    const dlink = 'https://d.pcs.baidu.com/file/exact?sign=issued'
    transport.registerCapability?.('download', dlink)

    const response = await transport(`${dlink}&access_token=a`, {
      headers: { 'User-Agent': 'pan.baidu.com' },
      credentials: 'omit',
      redirect: 'manual'
    })
    const bytes = new Uint8Array(await response.arrayBuffer())

    expect(bytes).toHaveLength(total)
    expect(calls).toEqual([
      { range: `bytes=0-${chunkBytes - 1}`, ifRange: null, userAgent: 'pan.baidu.com' },
      {
        range: `bytes=${chunkBytes}-${chunkBytes * 2 - 1}`,
        ifRange: '"stable"',
        userAgent: 'pan.baidu.com'
      }
    ])
  })

  test('bounds metadata request bodies before invoking native code', async () => {
    let invoked = false
    const transport = createBaiduNetdiskTauriTransport({
      transfer: async () => {
        invoked = true
        return { status: 200, headers: [], body: [] }
      }
    })

    await expect(
      transport('https://pan.baidu.com/rest/2.0/xpan/file?method=precreate&access_token=a', {
        method: 'POST',
        body: new Uint8Array(2 * 1024 * 1024 + 1),
        credentials: 'omit',
        redirect: 'error'
      })
    ).rejects.toMatchObject({ code: 'invalid-request' })
    expect(invoked).toBe(false)
  })
})
