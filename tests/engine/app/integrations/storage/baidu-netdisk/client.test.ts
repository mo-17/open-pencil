import { describe, expect, test } from 'bun:test'

import {
  baiduNetdiskChunkMd5,
  baiduNetdiskRemoteRevision,
  BaiduNetdiskClient,
  protectBaiduNetdiskDecimalIds
} from '@/app/integrations/storage/baidu-netdisk/client'
import {
  BAIDU_NETDISK_APP_ROOT,
  BAIDU_NETDISK_MAX_DOCUMENT_BYTES,
  BAIDU_NETDISK_MAX_UPLOAD_PARTS,
  BAIDU_NETDISK_UPLOAD_CHUNK_BYTES
} from '@/app/integrations/storage/baidu-netdisk/config'
import type {
  BaiduNetdiskCapabilityKind,
  BaiduNetdiskTransport
} from '@/app/integrations/storage/baidu-netdisk/types'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const AUTHORITY = { accountId: '208281036', authorizationVersion: 'grant-1' }
const FS_ID = '1844674407370955161'

function fileValue(overrides: Record<string, unknown> = {}) {
  const serverFilename = `${DOCUMENT_ID}--惊悚.fig`
  return {
    fs_id: FS_ID,
    path: `${BAIDU_NETDISK_APP_ROOT}/${serverFilename}`,
    server_filename: serverFilename,
    size: 3,
    isdir: 0,
    server_mtime: 1_777_000_000,
    md5: '0123456789abcdef0123456789abcdef',
    ...overrides
  }
}

function losslessJSON(value: unknown): string {
  return JSON.stringify(value).replace(`"${FS_ID}"`, FS_ID)
}

function transportWithCapabilities(
  handler: (url: URL, init: RequestInit) => Promise<Response> | Response
): { transport: BaiduNetdiskTransport; registered: Array<[BaiduNetdiskCapabilityKind, string]> } {
  const registered: Array<[BaiduNetdiskCapabilityKind, string]> = []
  const transport = Object.assign(
    (input: RequestInfo | URL, init: RequestInit = {}) => {
      let href: string
      if (input instanceof URL) href = input.toString()
      else if (typeof input === 'string') href = input
      else href = input.url
      return handler(new URL(href), init)
    },
    {
      registerCapability(kind: BaiduNetdiskCapabilityKind, url: string) {
        registered.push([kind, url])
      }
    }
  )
  return { transport, registered }
}

function client(transport: BaiduNetdiskTransport, limits = {}) {
  return new BaiduNetdiskClient({
    resolveAccessToken: () =>
      Promise.resolve({ accessToken: 'access-token', authority: AUTHORITY }),
    transport,
    limits
  })
}

describe('BaiduNetdiskClient', () => {
  test('uses one explicit 512 MiB document and 128-part contract', () => {
    expect(BAIDU_NETDISK_MAX_DOCUMENT_BYTES).toBe(512 * 1024 * 1024)
    expect(BAIDU_NETDISK_MAX_UPLOAD_PARTS).toBe(128)
    expect(BAIDU_NETDISK_MAX_UPLOAD_PARTS * BAIDU_NETDISK_UPLOAD_CHUNK_BYTES).toBe(
      BAIDU_NETDISK_MAX_DOCUMENT_BYTES
    )
  })

  test('rejects an oversized document before chunking, hashing, token resolution, or transport', async () => {
    let tokenCalls = 0
    let transportCalls = 0
    const instance = new BaiduNetdiskClient({
      resolveAccessToken: () => {
        tokenCalls++
        return Promise.resolve({ accessToken: 'access-token', authority: AUTHORITY })
      },
      transport: Object.assign(
        () => {
          transportCalls++
          return Promise.reject(new Error('transport must not run'))
        },
        {
          registerCapability() {
            transportCalls++
          }
        }
      )
    })
    const oversized = new Uint8Array()
    Object.defineProperty(oversized, 'byteLength', {
      value: BAIDU_NETDISK_MAX_DOCUMENT_BYTES + 1
    })

    await expect(
      instance.uploadDocument({
        documentId: DOCUMENT_ID,
        name: 'oversized.fig',
        bytes: oversized,
        updatedAt: '2026-08-26T03:04:05.000Z'
      })
    ).rejects.toMatchObject({
      code: 'resource-limit',
      message: 'Baidu Netdisk document exceeds the 512 MiB limit'
    })
    expect(tokenCalls).toBe(0)
    expect(transportCalls).toBe(0)
  })

  test('rejects remote metadata beyond the same 512 MiB document limit', async () => {
    const { transport } = transportWithCapabilities(() =>
      Response.json({
        errno: 0,
        list: [fileValue({ size: BAIDU_NETDISK_MAX_DOCUMENT_BYTES + 1 })]
      })
    )

    await expect(client(transport).listDocuments()).rejects.toMatchObject({
      code: 'invalid-response'
    })
  })

  test('protects uk and fs_id before JSON.parse can round uint64 values', () => {
    const parsed = JSON.parse(
      protectBaiduNetdiskDecimalIds(
        `{"uk":208281036,"nested":{"fs_id":18446744073709551615},"text":"fs_id:123"}`
      )
    ) as { uk: string; nested: { fs_id: string }; text: string }

    expect(parsed.uk).toBe('208281036')
    expect(parsed.nested.fs_id).toBe('18446744073709551615')
    expect(parsed.text).toBe('fs_id:123')
  })

  test('uses the fixed app root and returns lossless string IDs from bounded offset pages', async () => {
    const starts: string[] = []
    const { transport } = transportWithCapabilities((url) => {
      expect(url.origin).toBe('https://pan.baidu.com')
      expect(url.searchParams.get('access_token')).toBe('access-token')
      expect(url.searchParams.get('dir')).toBe(BAIDU_NETDISK_APP_ROOT)
      starts.push(url.searchParams.get('start') ?? '')
      return new Response(losslessJSON({ errno: 0, list: [fileValue()] }), {
        headers: { 'content-type': 'application/json' }
      })
    })

    const documents = await client(transport).listDocuments()
    const first = documents[0]

    expect(starts).toEqual(['0'])
    expect(documents).toHaveLength(1)
    expect(first?.item.fsId).toBe(FS_ID)
    expect(typeof first?.item.fsId).toBe('string')
    if (!first) throw new Error('expected one document')
    expect(baiduNetdiskRemoteRevision(first).fsId).toBe(FS_ID)
  })

  test('fails closed when a full page reaches the configured page bound', async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => {
      const name = `foreign-${index}.fig`
      return {
        ...fileValue({ fs_id: String(index + 1) }),
        server_filename: name,
        path: `${BAIDU_NETDISK_APP_ROOT}/${name}`
      }
    })
    const { transport } = transportWithCapabilities(() =>
      Response.json({ errno: 0, list: fullPage })
    )

    await expect(client(transport, { maxListPages: 1 }).listDocuments()).rejects.toMatchObject({
      code: 'resource-limit'
    })
  })

  test('runs precreate, trusted locate, 4 MiB part uploads, then create without rtype=3', async () => {
    const bytes = new Uint8Array(BAIDU_NETDISK_UPLOAD_CHUNK_BYTES + 1)
    bytes[0] = 1
    bytes[bytes.length - 1] = 2
    let hashes: string[] = []
    const operations: string[] = []
    const { transport, registered } = transportWithCapabilities(async (url, init) => {
      const method = url.searchParams.get('method')
      if (method === 'precreate') {
        operations.push('precreate')
        const body = init.body as URLSearchParams
        expect(body.get('path')).toBe(`${BAIDU_NETDISK_APP_ROOT}/${DOCUMENT_ID}--惊悚.fig`)
        expect(body.get('rtype')).toBe('1')
        hashes = JSON.parse(body.get('block_list') ?? '[]') as string[]
        expect(hashes).toHaveLength(2)
        return Response.json({ errno: 0, uploadid: 'upload-1', block_list: [0, 1] })
      }
      if (method === 'locateupload') {
        operations.push('locate')
        expect(url.origin).toBe('https://d.pcs.baidu.com')
        return Response.json({
          error_code: 0,
          servers: [{ server: 'http://c2.pcs.baidu.com' }, { server: 'https://c3.pcs.baidu.com' }]
        })
      }
      if (method === 'upload') {
        const part = Number(url.searchParams.get('partseq'))
        operations.push(`upload-${part}`)
        expect(url.origin).toBe('https://c3.pcs.baidu.com')
        expect(registered).toContainEqual(['upload', url.toString()])
        expect(init.body).toBeInstanceOf(FormData)
        return Response.json({ md5: hashes[part] })
      }
      if (method === 'create') {
        operations.push('create')
        const body = init.body as URLSearchParams
        expect(body.get('rtype')).toBe('1')
        expect(body.get('rtype')).not.toBe('3')
        return new Response(
          losslessJSON({
            errno: 0,
            ...fileValue({ size: bytes.byteLength, md5: 'abcdefabcdefabcdefabcdefabcdefab' })
          })
        )
      }
      throw new Error(`unexpected request: ${url}`)
    })
    const progress: number[] = []

    const uploaded = await client(transport).uploadDocument({
      documentId: DOCUMENT_ID,
      name: '惊悚.fig',
      bytes,
      updatedAt: '2026-08-26T03:04:05.000Z',
      onProgress: ({ transferredBytes }) => progress.push(transferredBytes)
    })

    expect(operations).toEqual(['precreate', 'locate', 'upload-0', 'upload-1', 'create'])
    expect(uploaded.document.item.fsId).toBe(FS_ID)
    expect(progress.at(-1)).toBe(bytes.byteLength)
    expect(baiduNetdiskChunkMd5(new TextEncoder().encode('abc'))).toBe(
      '900150983cd24fb0d6963f7d28e17f72'
    )
  })

  test('rejects an upload host that was not issued as trusted HTTPS PCS capability', async () => {
    const { transport } = transportWithCapabilities((url) => {
      const method = url.searchParams.get('method')
      if (method === 'precreate') {
        return Response.json({ errno: 0, uploadid: 'upload-1', block_list: [0] })
      }
      if (method === 'locateupload') {
        return Response.json({ error_code: 0, servers: [{ server: 'https://evil.example' }] })
      }
      throw new Error('dynamic upload must not be attempted')
    })

    await expect(
      client(transport).uploadDocument({
        documentId: DOCUMENT_ID,
        name: '惊悚.fig',
        bytes: new Uint8Array([1]),
        updatedAt: '2026-08-26T03:04:05.000Z'
      })
    ).rejects.toMatchObject({ code: 'invalid-response' })
  })

  test('registers exact dlink redirects, sets User-Agent, and never forwards token to redirect', async () => {
    const calls: URL[] = []
    const { transport, registered } = transportWithCapabilities((url, init) => {
      calls.push(url)
      const method = url.searchParams.get('method')
      if (method === 'list') return new Response(losslessJSON({ errno: 0, list: [fileValue()] }))
      if (method === 'filemetas') {
        expect(url.searchParams.get('fsids')).toBe(`[${FS_ID}]`)
        return new Response(
          losslessJSON({
            errno: 0,
            list: [{ fs_id: FS_ID, dlink: 'https://d.pcs.baidu.com/file/exact?sign=issued' }]
          })
        )
      }
      expect(new Headers(init.headers).get('user-agent')).toBe('pan.baidu.com')
      if (url.hostname === 'd.pcs.baidu.com') {
        expect(url.searchParams.get('access_token')).toBe('access-token')
        return new Response(null, {
          status: 302,
          headers: { location: 'https://c3.pcs.baidu.com/file/final?cap=exact' }
        })
      }
      expect(url.hostname).toBe('c3.pcs.baidu.com')
      expect(url.searchParams.has('access_token')).toBe(false)
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } })
    })

    const result = await client(transport).downloadDocument(DOCUMENT_ID)

    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(registered).toEqual([
      ['download', 'https://d.pcs.baidu.com/file/exact?sign=issued'],
      ['download', 'https://c3.pcs.baidu.com/file/final?cap=exact']
    ])
    expect(
      calls.every(
        (url) => url.hostname === 'pan.baidu.com' || url.hostname.endsWith('.pcs.baidu.com')
      )
    ).toBe(true)
  })

  test('does not expose provider text or access tokens in errors', async () => {
    const { transport } = transportWithCapabilities(
      (url) =>
        new Response(
          JSON.stringify({
            errno: 10,
            error_msg: `secret ${url.searchParams.get('access_token')}`
          }),
          { status: 500 }
        )
    )

    const error = await client(transport)
      .listDocuments()
      .catch((value: unknown) => value)
    expect(error).toMatchObject({ code: 'server' })
    expect(String(error)).not.toContain('access-token')
    expect(String(error)).not.toContain('secret')
  })

  test('refuses trash before filemanager when the freshly listed revision changed', async () => {
    let fileManagerCalls = 0
    const original = fileValue()
    const { transport } = transportWithCapabilities((url) => {
      const method = url.searchParams.get('method')
      if (method === 'list') {
        return new Response(
          losslessJSON({ errno: 0, list: [{ ...original, server_mtime: 1_777_000_001 }] })
        )
      }
      if (method === 'filemanager') fileManagerCalls++
      return Response.json({ errno: 0, info: [] })
    })
    const instance = client(transport)
    const listed = {
      documentId: DOCUMENT_ID,
      name: '惊悚.fig',
      item: {
        fsId: FS_ID,
        path: original.path as string,
        serverFilename: original.server_filename as string,
        size: 3,
        isDirectory: false,
        serverMtime: 1_777_000_000,
        md5: original.md5 as string
      }
    }

    await expect(
      instance.trashDocumentFile(listed, baiduNetdiskRemoteRevision(listed))
    ).rejects.toMatchObject({ code: 'precondition' })
    expect(fileManagerCalls).toBe(0)
  })
})
