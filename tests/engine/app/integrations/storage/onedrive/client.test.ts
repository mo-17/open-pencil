import { describe, expect, test } from 'bun:test'

import { OneDriveClient } from '@/app/integrations/storage/onedrive/client'
import { resolveOneDriveClientId } from '@/app/integrations/storage/onedrive/config'
import type {
  OneDriveOAuthToken,
  OneDriveTransport
} from '@/app/integrations/storage/onedrive/types'

type RecordedCall = Readonly<{ url: URL; init: RequestInit }>
type ResponseFactory = (call: RecordedCall) => Response | Promise<Response>

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const AUTHORITY = { accountId: 'microsoft-subject', authorizationVersion: 'grant-1' }
const TOKEN: OneDriveOAuthToken = { accessToken: 'access-token', authority: AUTHORITY }

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(value), { ...init, headers })
}

function item(
  id: string,
  name: string,
  overrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    id,
    name,
    size: 0,
    lastModifiedDateTime: '2026-08-26T01:02:03.000Z',
    eTag: `"${id}-etag"`,
    parentReference: { driveId: 'drive-1', id: 'parent' },
    ...overrides
  }
}

function folder(
  id: string,
  name: string,
  parentId: string,
  overrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
  return item(id, name, {
    folder: { childCount: 0 },
    parentReference: { driveId: 'drive-1', id: parentId },
    ...overrides
  })
}

function figFile(
  id = 'item-1',
  folderId = 'document-folder',
  overrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
  return item(id, '惊悚.fig', {
    size: 3,
    file: { mimeType: 'application/octet-stream' },
    parentReference: { driveId: 'drive-1', id: folderId },
    ...overrides
  })
}

function namespaceFactories(): ResponseFactory[] {
  return [
    () => jsonResponse(folder('app-root', 'OpenPencil', 'root')),
    () => jsonResponse({ value: [folder('documents-folder', 'documents', 'app-root')] })
  ]
}

function queuedClient(
  factories: ResponseFactory[],
  options: Readonly<{ uploadChunkBytes?: number }> = {}
): {
  client: OneDriveClient
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const transport: OneDriveTransport = async (input, init = {}) => {
    const call = { url: new URL(input), init }
    calls.push(call)
    const factory = factories.shift()
    if (!factory) throw new Error(`Unexpected OneDrive request: ${input}`)
    return factory(call)
  }
  return {
    client: new OneDriveClient({
      tokenSource: { getAccessToken: () => Promise.resolve(TOKEN) },
      transport,
      sleep: () => Promise.resolve(),
      uploadChunkBytes: options.uploadChunkBytes
    }),
    calls
  }
}

function callAt(calls: RecordedCall[], index: number): RecordedCall {
  const call = calls[index]
  if (!call) throw new Error(`Missing OneDrive call ${index}`)
  return call
}

function headers(call: RecordedCall): Headers {
  return new Headers(call.init.headers)
}

describe('OneDriveClient', () => {
  test('accepts only the build-time UUID client ID and ignores profile preferences', () => {
    expect(
      resolveOneDriveClientId(
        { 'client-id': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
        'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB'
      )
    ).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
    expect(
      resolveOneDriveClientId({ 'client-id': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }, 'not-a-uuid')
    ).toBeNull()
  })

  test('lists only direct UUID-folder .fig documents with itemId and ETag revisions', async () => {
    const { client, calls } = queuedClient([
      ...namespaceFactories(),
      () =>
        jsonResponse({
          value: [
            folder('document-folder', DOCUMENT_ID, 'documents-folder'),
            folder('ignored-folder', 'not-a-uuid', 'documents-folder')
          ]
        }),
      () => jsonResponse({ value: [figFile()] })
    ])

    const documents = await client.listDocuments()

    expect(documents).toHaveLength(1)
    expect(documents[0]?.documentId).toBe(DOCUMENT_ID)
    expect(documents[0]?.file.id).toBe('item-1')
    expect(calls.every((call) => call.url.origin === 'https://graph.microsoft.com')).toBe(true)
    expect(headers(callAt(calls, 0)).get('authorization')).toBe('Bearer access-token')
    expect(calls[0]?.url.pathname).toBe('/v1.0/me/drive/special/approot')
    expect(calls[0]?.init.credentials).toBe('omit')
    expect(calls[0]?.init.redirect).toBe('error')
  })

  test('does not turn a failed child listing into a partial successful document list', async () => {
    const limited = () => jsonResponse({ error: { code: 'tooManyRequests' } }, { status: 429 })
    const { client } = queuedClient([
      ...namespaceFactories(),
      () =>
        jsonResponse({
          value: [folder('document-folder', DOCUMENT_ID, 'documents-folder')]
        }),
      limited,
      limited,
      limited
    ])

    await expect(client.listDocuments()).rejects.toMatchObject({ code: 'rate-limited' })
  })

  test('creates /approot/documents/<uuid>/<name>.fig and never sends bearer to uploadUrl', async () => {
    const { client, calls } = queuedClient([
      ...namespaceFactories(),
      () => jsonResponse({ value: [] }),
      () =>
        jsonResponse(folder('document-folder', DOCUMENT_ID, 'documents-folder'), { status: 201 }),
      () => jsonResponse({ value: [] }),
      () => jsonResponse({ uploadUrl: 'https://tenant.up.1drv.com/upload/session-1' }),
      () => jsonResponse(figFile('item-created'), { status: 201 })
    ])

    const result = await client.createDocument({
      documentId: DOCUMENT_ID,
      name: '惊悚.fig',
      bytes: new Uint8Array([1, 2, 3]),
      expectedAuthority: AUTHORITY
    })

    expect(result.remoteRevision).toEqual({ itemId: 'item-created', etag: '"item-created-etag"' })
    const folderCreate = callAt(calls, 3)
    expect(folderCreate.url.pathname).toBe('/v1.0/drives/drive-1/items/documents-folder/children')
    expect(folderCreate.init.method).toBe('POST')
    expect(JSON.parse(String(folderCreate.init.body))).toMatchObject({
      name: DOCUMENT_ID,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail'
    })
    const session = callAt(calls, 5)
    expect(session.url.pathname).toContain(
      `/items/document-folder:/${encodeURIComponent('惊悚.fig')}:/createUploadSession`
    )
    const upload = callAt(calls, 6)
    expect(upload.url.origin).toBe('https://tenant.up.1drv.com')
    expect(headers(upload).has('authorization')).toBe(false)
    expect(headers(upload).get('content-range')).toBe('bytes 0-2/3')
    expect(upload.init.credentials).toBe('omit')
    expect(upload.init.redirect).toBe('error')
  })

  test('updates by driveItem ID with the exact If-Match ETag', async () => {
    const { client, calls } = queuedClient([
      ...namespaceFactories(),
      () => jsonResponse({ value: [folder('document-folder', DOCUMENT_ID, 'documents-folder')] }),
      () => jsonResponse(figFile()),
      () => jsonResponse({ uploadUrl: 'https://tenant.up.1drv.com/upload/session-2' }),
      () =>
        jsonResponse(figFile('item-1', 'document-folder', { eTag: '"item-1-etag-2"' }), {
          status: 200
        })
    ])

    const result = await client.updateDocument({
      documentId: DOCUMENT_ID,
      itemId: 'item-1',
      expectedEtag: '"item-1-etag"',
      name: '惊悚.fig',
      bytes: new Uint8Array([4, 5, 6]),
      expectedAuthority: AUTHORITY
    })

    expect(result.remoteRevision).toEqual({ itemId: 'item-1', etag: '"item-1-etag-2"' })
    const session = callAt(calls, 4)
    expect(session.url.pathname).toBe('/v1.0/drives/drive-1/items/item-1/createUploadSession')
    expect(headers(session).get('if-match')).toBe('"item-1-etag"')
    expect(headers(callAt(calls, 5)).has('authorization')).toBe(false)
  })

  test('downloads only a Graph-observed download capability without forwarding bearer auth', async () => {
    const downloadURL = 'https://tenant.files.1drv.com/download/exact-capability'
    const downloadable = () =>
      figFile('item-1', 'document-folder', {
        '@microsoft.graph.downloadUrl': downloadURL
      })
    const { client, calls } = queuedClient([
      ...namespaceFactories(),
      () => jsonResponse({ value: [folder('document-folder', DOCUMENT_ID, 'documents-folder')] }),
      () => jsonResponse({ value: [downloadable()] }),
      ...namespaceFactories(),
      () => jsonResponse(downloadable()),
      () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-length': '3' }
        })
    ])

    const result = await client.downloadDocument(DOCUMENT_ID, {
      expectedAuthority: AUTHORITY
    })

    expect([...result.bytes]).toEqual([1, 2, 3])
    const download = callAt(calls, 7)
    expect(download.url.toString()).toBe(downloadURL)
    expect(headers(download).has('authorization')).toBe(false)
    expect(download.init.credentials).toBe('omit')
    expect(download.init.redirect).toBe('error')
  })

  test('recovers an ambiguous resumable chunk through upload-session status', async () => {
    const chunkBytes = 320 * 1024
    const bytes = new Uint8Array(chunkBytes * 2)
    const { client, calls } = queuedClient(
      [
        ...namespaceFactories(),
        () => jsonResponse({ value: [] }),
        () =>
          jsonResponse(folder('document-folder', DOCUMENT_ID, 'documents-folder'), {
            status: 201
          }),
        () => jsonResponse({ value: [] }),
        () => jsonResponse({ uploadUrl: 'https://tenant.up.1drv.com/upload/session-status' }),
        () => new Response(null, { status: 416 }),
        () => jsonResponse({ nextExpectedRanges: [`${chunkBytes}-`] }),
        () =>
          jsonResponse(
            figFile('item-created', 'document-folder', {
              size: bytes.byteLength
            }),
            { status: 201 }
          )
      ],
      { uploadChunkBytes: chunkBytes }
    )

    await expect(
      client.createDocument({ documentId: DOCUMENT_ID, name: '惊悚.fig', bytes })
    ).resolves.toMatchObject({
      remoteRevision: { itemId: 'item-created', etag: '"item-created-etag"' }
    })
    expect(callAt(calls, 7).init.method).toBe('GET')
    expect(headers(callAt(calls, 7)).has('authorization')).toBe(false)
    expect(headers(callAt(calls, 8)).get('content-range')).toBe(
      `bytes ${chunkBytes}-${bytes.byteLength - 1}/${bytes.byteLength}`
    )
  })

  test('rejects an upload capability URL outside Microsoft-owned hosts', async () => {
    const { client, calls } = queuedClient([
      ...namespaceFactories(),
      () => jsonResponse({ value: [] }),
      () =>
        jsonResponse(folder('document-folder', DOCUMENT_ID, 'documents-folder'), { status: 201 }),
      () => jsonResponse({ value: [] }),
      () => jsonResponse({ uploadUrl: 'https://attacker.example/upload/session' })
    ])

    await expect(
      client.createDocument({
        documentId: DOCUMENT_ID,
        name: '惊悚.fig',
        bytes: new Uint8Array([1, 2, 3])
      })
    ).rejects.toMatchObject({ code: 'invalid-response' })
    expect(calls).toHaveLength(6)
  })

  test('rejects a download-only Microsoft host when Graph returns it as an upload session', async () => {
    const { client } = queuedClient([
      ...namespaceFactories(),
      () => jsonResponse({ value: [] }),
      () =>
        jsonResponse(folder('document-folder', DOCUMENT_ID, 'documents-folder'), { status: 201 }),
      () => jsonResponse({ value: [] }),
      () => jsonResponse({ uploadUrl: 'https://tenant.files.1drv.com/upload/session' })
    ])

    await expect(
      client.createDocument({
        documentId: DOCUMENT_ID,
        name: '惊悚.fig',
        bytes: new Uint8Array([1, 2, 3])
      })
    ).rejects.toMatchObject({ code: 'invalid-response' })
  })

  test('deletes only the exact .fig item and leaves foreign folder children untouched', async () => {
    const { client, calls } = queuedClient([
      ...namespaceFactories(),
      () => jsonResponse({ value: [folder('document-folder', DOCUMENT_ID, 'documents-folder')] }),
      () =>
        jsonResponse({
          value: [
            figFile(),
            item('user-note', 'keep-me.txt', {
              file: { mimeType: 'text/plain' },
              parentReference: { driveId: 'drive-1', id: 'document-folder' }
            })
          ]
        }),
      () => new Response(null, { status: 204 })
    ])

    await client.deleteDocumentFile(DOCUMENT_ID, undefined, AUTHORITY)

    const deletion = callAt(calls, 4)
    expect(deletion.url.pathname).toBe('/v1.0/drives/drive-1/items/item-1')
    expect(deletion.init.method).toBe('DELETE')
    expect(headers(deletion).get('if-match')).toBe('"item-1-etag"')
  })
})
