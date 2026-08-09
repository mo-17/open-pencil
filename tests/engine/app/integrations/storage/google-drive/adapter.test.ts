import { describe, expect, test } from 'bun:test'

import {
  createGoogleDriveStorageAdapter,
  revisionsMatch
} from '@/app/integrations/storage/google-drive/adapter'
import { GoogleDriveClient } from '@/app/integrations/storage/google-drive/client'
import type { GoogleDriveTransport } from '@/app/integrations/storage/google-drive/types'

import type { RecordedGoogleDriveCall as RecordedCall } from '#tests/helpers/google-drive'

type ResponseFactory = (call: RecordedCall) => Response | Promise<Response>

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

function queuedClient(factories: ResponseFactory[]): {
  client: GoogleDriveClient
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
  return {
    client: new GoogleDriveClient({
      tokenSource: {
        getAccessToken: () =>
          Promise.resolve({
            accessToken: 'token',
            subject: 'oidc-subject',
            authorizationVersion: 'grant-v1'
          })
      },
      transport,
      sleep: () => Promise.resolve()
    }),
    calls
  }
}

function headers(call: RecordedCall): Headers {
  return new Headers(call.init.headers)
}

function callAt(calls: RecordedCall[], index: number): RecordedCall {
  const call = calls[index]
  if (!call) throw new Error(`Missing recorded Google Drive call ${index}`)
  return call
}

function jsonBody(call: RecordedCall): unknown {
  if (typeof call.init.body !== 'string') throw new Error('Expected a JSON string body')
  return JSON.parse(call.init.body) as unknown
}

describe('GoogleDriveStorageAdapter', () => {
  test('creates a visible marked .fig blob at a reserved Drive ID', async () => {
    const { client, calls } = queuedClient([
      () => new Response(null, { status: 404 }),
      () =>
        new Response(null, {
          headers: {
            location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=create-1'
          }
        }),
      () => jsonResponse(driveFile('document_1'), { headers: { etag: '"created"' } })
    ])
    const adapter = createGoogleDriveStorageAdapter(client)

    const result = await adapter.putDocument(
      'document_1',
      new Uint8Array([1, 2, 3]),
      { name: '惊悚', updatedAt: '2026-08-09T01:02:03.000Z' },
      { expectedRemoteRevision: null }
    )

    expect(result).toMatchObject({ outcome: 'created', remoteRevision: { etag: '"created"' } })
    const sessionMetadata = jsonBody(callAt(calls, 1))
    expect(sessionMetadata).toMatchObject({
      id: 'document_1',
      name: '惊悚.fig',
      mimeType: 'application/octet-stream',
      appProperties: { openPencil: 'document-v1' }
    })
    expect(calls[1]?.init.method).toBe('POST')
  })

  test('updates only after exact revision matching and sends If-Match', async () => {
    const current = driveFile('document_1')
    const { client, calls } = queuedClient([
      () => jsonResponse(current, { headers: { etag: '"etag-7"' } }),
      () =>
        new Response(null, {
          headers: {
            location:
              'https://www.googleapis.com/upload/drive/v3/files/document_1?upload_id=update-1'
          }
        }),
      () =>
        jsonResponse(driveFile('document_1', { version: '8', headRevisionId: 'head-8' }), {
          headers: { etag: '"etag-8"' }
        })
    ])
    const adapter = createGoogleDriveStorageAdapter(client)

    const result = await adapter.putDocument(
      'document_1',
      new Uint8Array([4, 5, 6]),
      { name: '惊悚.fig', updatedAt: '2026-08-09T02:00:00.000Z' },
      {
        expectedRemoteRevision: {
          version: '7',
          headRevisionId: 'head-7',
          checksum: '900150983cd24fb0d6963f7d28e17f72',
          etag: '"etag-7"'
        }
      }
    )

    expect(result).toMatchObject({
      outcome: 'updated',
      remoteRevision: { version: '8', etag: '"etag-8"' }
    })
    expect(calls[1]?.init.method).toBe('PATCH')
    expect(headers(callAt(calls, 1)).get('if-match')).toBe('"etag-7"')
  })

  test('does not continue a multi-request write after the expected grant is replaced', async () => {
    let tokenResolutions = 0
    const calls: RecordedCall[] = []
    const expectedAuthority = {
      accountId: 'oidc-subject',
      authorizationVersion: 'grant-v1'
    }
    const client = new GoogleDriveClient({
      tokenSource: {
        getAccessToken() {
          tokenResolutions += 1
          return Promise.resolve({
            accessToken: 'token',
            subject: expectedAuthority.accountId,
            authorizationVersion: tokenResolutions < 3 ? 'grant-v1' : 'grant-v2'
          })
        }
      },
      transport: async (input, init = {}) => {
        calls.push({ url: new URL(input), init })
        return jsonResponse(driveFile('document_1'), { headers: { etag: '"etag-7"' } })
      }
    })
    const adapter = createGoogleDriveStorageAdapter(client)

    await expect(
      adapter.putDocument(
        'document_1',
        new Uint8Array([4, 5, 6]),
        { name: 'Exact grant.fig', updatedAt: '2026-08-09T02:00:00.000Z' },
        {
          expectedAuthority,
          expectedRemoteRevision: { version: '7', etag: '"etag-7"' }
        }
      )
    ).rejects.toMatchObject({ code: 'authorization-changed' })
    expect(calls).toHaveLength(1)
  })

  test('preserves a conflict copy and keeps the original binding revision', async () => {
    const { client, calls } = queuedClient([
      () => jsonResponse(driveFile('document_1'), { headers: { etag: '"remote-etag"' } }),
      () => jsonResponse({ ids: ['conflict_copy_1'] }),
      () =>
        new Response(null, {
          headers: {
            location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=conflict-1'
          }
        }),
      () =>
        jsonResponse(driveFile('conflict_copy_1', { version: '1', headRevisionId: 'copy-head' }), {
          headers: { etag: '"copy-etag"' }
        })
    ])
    const adapter = createGoogleDriveStorageAdapter(client, {
      now: () => new Date('2026-08-09T03:04:05.000Z')
    })

    const result = await adapter.putDocument(
      'document_1',
      new Uint8Array([7, 8, 9]),
      { name: '惊悚.fig', updatedAt: '2026-08-09T03:00:00.000Z' },
      { expectedRemoteRevision: { version: '6' } }
    )

    expect(result).toEqual({
      outcome: 'conflict-copy',
      remoteRevision: {
        version: '7',
        headRevisionId: 'head-7',
        checksum: '900150983cd24fb0d6963f7d28e17f72',
        etag: '"remote-etag"'
      },
      conflictDocumentId: 'conflict_copy_1',
      conflictCopyRevision: {
        version: '1',
        headRevisionId: 'copy-head',
        checksum: '900150983cd24fb0d6963f7d28e17f72',
        etag: '"copy-etag"'
      }
    })
    const copyMetadata = jsonBody(callAt(calls, 2))
    expect(copyMetadata).toMatchObject({
      id: 'conflict_copy_1',
      name: '惊悚 (conflict 2026-08-09 03-04-05).fig',
      appProperties: {
        openPencil: 'document-v1',
        openPencilConflictOf: 'document_1'
      }
    })
  })

  test('never blind-overwrites when expected revision or metadata ETag is missing', async () => {
    const { client, calls } = queuedClient([
      () => jsonResponse(driveFile('document_1')),
      () => jsonResponse({ ids: ['conflict_copy_1'] }),
      () =>
        new Response(null, {
          headers: {
            location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=conflict-1'
          }
        }),
      () => jsonResponse(driveFile('conflict_copy_1'))
    ])
    const adapter = createGoogleDriveStorageAdapter(client)

    const result = await adapter.putDocument(
      'document_1',
      new Uint8Array([1]),
      { name: 'test.fig', updatedAt: '2026-08-09T01:00:00.000Z' },
      { expectedRemoteRevision: { version: '7' } }
    )

    expect(result.outcome).toBe('conflict-copy')
    expect(calls[2]?.init.method).toBe('POST')
    expect(headers(callAt(calls, 2)).has('if-match')).toBe(false)
  })

  test('treats checksum- or generation-only expectations as conflicts', async () => {
    expect(revisionsMatch({ generation: '7' }, { generation: '7', etag: '"current-etag"' })).toBe(
      false
    )

    const { client, calls } = queuedClient([
      () => jsonResponse(driveFile('document_1'), { headers: { etag: '"current-etag"' } }),
      () => jsonResponse({ ids: ['conflict_copy_1'] }),
      () =>
        new Response(null, {
          headers: {
            location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=conflict-1'
          }
        }),
      () => jsonResponse(driveFile('conflict_copy_1'), { headers: { etag: '"copy-etag"' } })
    ])
    const adapter = createGoogleDriveStorageAdapter(client)

    const result = await adapter.putDocument(
      'document_1',
      new Uint8Array([1]),
      { name: 'test.fig', updatedAt: '2026-08-09T01:00:00.000Z' },
      { expectedRemoteRevision: { checksum: '900150983cd24fb0d6963f7d28e17f72' } }
    )

    expect(result.outcome).toBe('conflict-copy')
    expect(calls[2]?.init.method).toBe('POST')
    expect(headers(callAt(calls, 2)).has('if-match')).toBe(false)
  })

  test('re-reads the original revision after a 412 race before reporting a conflict copy', async () => {
    const { client } = queuedClient([
      () => jsonResponse(driveFile('document_1'), { headers: { etag: '"etag-7"' } }),
      () =>
        jsonResponse(
          { error: { message: 'Precondition failed', errors: [{ reason: 'conditionNotMet' }] } },
          { status: 412 }
        ),
      () =>
        jsonResponse(driveFile('document_1', { version: '8' }), {
          headers: { etag: '"etag-8"' }
        }),
      () => jsonResponse({ ids: ['conflict_copy_1'] }),
      () =>
        new Response(null, {
          headers: {
            location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=conflict-1'
          }
        }),
      () => jsonResponse(driveFile('conflict_copy_1'), { headers: { etag: '"copy"' } })
    ])
    const adapter = createGoogleDriveStorageAdapter(client)

    const result = await adapter.putDocument(
      'document_1',
      new Uint8Array([1]),
      { name: 'test.fig', updatedAt: '2026-08-09T01:00:00.000Z' },
      {
        expectedRemoteRevision: {
          version: '7',
          headRevisionId: 'head-7',
          checksum: '900150983cd24fb0d6963f7d28e17f72',
          etag: '"etag-7"'
        }
      }
    )

    expect(result).toMatchObject({
      outcome: 'conflict-copy',
      remoteRevision: { version: '8', etag: '"etag-8"' },
      conflictCopyRevision: { etag: '"copy"' }
    })
  })

  test('trashes marked files and refuses to trash foreign Drive files', async () => {
    const { client: markedClient, calls: markedCalls } = queuedClient([
      () => jsonResponse(driveFile('document_1')),
      () => jsonResponse(driveFile('document_1', { trashed: true }))
    ])
    await createGoogleDriveStorageAdapter(markedClient).deleteDocument('document_1')
    expect(markedCalls[1]?.init.method).toBe('PATCH')
    expect(jsonBody(callAt(markedCalls, 1))).toEqual({ trashed: true })

    const { client: foreignClient, calls: foreignCalls } = queuedClient([
      () => jsonResponse(driveFile('foreign_1', { appProperties: {} }))
    ])
    await expect(
      createGoogleDriveStorageAdapter(foreignClient).deleteDocument('foreign_1')
    ).rejects.toMatchObject({ code: 'foreign-file' })
    expect(foreignCalls).toHaveLength(1)
  })

  test('exposes exact account and authorization grant authority', async () => {
    const { client } = queuedClient([])
    const adapter = createGoogleDriveStorageAdapter(client)

    await expect(adapter.getAuthority?.()).resolves.toEqual({
      accountId: 'oidc-subject',
      authorizationVersion: 'grant-v1'
    })
  })
})
