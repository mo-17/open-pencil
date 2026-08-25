import { describe, expect, test } from 'bun:test'

import { AliyunDriveClient } from '@/app/integrations/storage/aliyun-drive/client'
import { ALIYUN_DRIVE_OPENAPI_ORIGIN } from '@/app/integrations/storage/aliyun-drive/config'
import type { AliyunDriveError } from '@/app/integrations/storage/aliyun-drive/errors'
import type {
  AliyunDriveDocumentFile,
  AliyunDriveItem,
  AliyunDriveTransport
} from '@/app/integrations/storage/aliyun-drive/types'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const CONFLICT_ID = '22222222-2222-4222-8222-222222222222'
const AUTHORITY = { accountId: 'aliyun-user', authorizationVersion: 'grant-1' }
const DOWNLOAD_URL = 'https://download.example.test/signed-document'
const UPLOAD_URL = 'https://upload.example.test/signed-part-1'

type JSONObject = { [key: string]: unknown }

function toWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toWire)
  if (typeof value !== 'object' || value === null) return value
  const record = value as JSONObject
  if (
    typeof record.driveId === 'string' &&
    typeof record.fileId === 'string' &&
    typeof record.parentFileId === 'string'
  ) {
    const driveItem = value as AliyunDriveItem
    return {
      drive_id: driveItem.driveId,
      file_id: driveItem.fileId,
      parent_file_id: driveItem.parentFileId,
      name: driveItem.name,
      type: driveItem.type,
      size: driveItem.size,
      content_hash: driveItem.contentHash,
      created_at: driveItem.createdAt,
      updated_at: driveItem.updatedAt
    }
  }
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, toWire(child)]))
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(toWire(value)), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function parseBody(init?: RequestInit): JSONObject {
  if (typeof init?.body !== 'string') throw new Error('expected JSON body')
  return JSON.parse(init.body) as JSONObject
}

function item(
  fileId: string,
  name: string,
  parentFileId: string,
  overrides: Partial<AliyunDriveItem> = {}
): AliyunDriveItem {
  return {
    driveId: 'drive-1',
    fileId,
    parentFileId,
    name,
    type: 'file',
    size: 3,
    contentHash: `sha1-${fileId}`,
    createdAt: '2026-08-26T01:02:03.000Z',
    updatedAt: '2026-08-26T01:02:03.000Z',
    ...overrides
  }
}

function folder(fileId: string, name: string, parentFileId: string): AliyunDriveItem {
  return item(fileId, name, parentFileId, {
    type: 'folder',
    size: null,
    contentHash: null
  })
}

const documentsFolder = folder('documents-folder', 'documents', 'authorized-root')
const documentFolder = folder('document-folder', DOCUMENT_ID, documentsFolder.fileId)
const oldFile = item('old-file', '惊悚.fig', documentFolder.fileId, {
  contentHash: 'sha1-old'
})
const newFile = item('new-file', '惊悚.fig', documentFolder.fileId, {
  contentHash: 'sha1-new',
  updatedAt: '2026-08-26T02:00:00.000Z'
})

function createClient(transport: AliyunDriveTransport, extra = {}): AliyunDriveClient {
  return new AliyunDriveClient({
    resolveAccessToken: () => Promise.resolve({ accessToken: 'token-1', authority: AUTHORITY }),
    transport,
    sleep: () => Promise.resolve(),
    ...extra
  })
}

function driveInfo(): Response {
  return json({
    user_id: AUTHORITY.accountId,
    default_drive_id: 'drive-1',
    folder_id: 'authorized-root'
  })
}

describe('AliyunDriveClient', () => {
  test('downloads only from an API-registered signed URL and never forwards the bearer token', async () => {
    const capabilityHeaders: Headers[] = []
    const apiURLs: string[] = []
    const transport: AliyunDriveTransport = (input, init) => {
      if (input === DOWNLOAD_URL) {
        capabilityHeaders.push(new Headers(init?.headers))
        return Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]).buffer, {
            status: 200,
            headers: { 'Content-Length': '3' }
          })
        )
      }
      apiURLs.push(input)
      expect(input.startsWith(`${ALIYUN_DRIVE_OPENAPI_ORIGIN}/adrive/v1.0/`)).toBe(true)
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token-1')
      const path = new URL(input).pathname
      const body = parseBody(init)
      if (path.endsWith('/user/getDriveInfo')) return Promise.resolve(driveInfo())
      if (path.endsWith('/openFile/list')) {
        const parent = body.parent_file_id
        if (parent === 'authorized-root') return Promise.resolve(json({ items: [documentsFolder] }))
        if (parent === documentsFolder.fileId) return Promise.resolve(json({ items: [documentFolder] }))
        if (parent === documentFolder.fileId) return Promise.resolve(json({ items: [oldFile] }))
      }
      if (path.endsWith('/openFile/get')) return Promise.resolve(json(oldFile))
      if (path.endsWith('/openFile/getDownloadUrl')) {
        return Promise.resolve(json({ url: DOWNLOAD_URL }))
      }
      return Promise.reject(new Error(`unexpected request ${path}`))
    }
    const client = createClient(transport)

    const result = await client.downloadDocument(DOCUMENT_ID, { expectedAuthority: AUTHORITY })

    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(result.remoteRevision).toEqual({
      fileId: 'old-file',
      contentHash: 'sha1-old',
      updatedAt: oldFile.updatedAt,
      size: '3'
    })
    expect(apiURLs.length).toBeGreaterThan(0)
    expect(capabilityHeaders).toHaveLength(1)
    expect(capabilityHeaders[0]?.has('authorization')).toBe(false)
  })

  test('rejects repeated pagination markers within the configured bound', async () => {
    const transport: AliyunDriveTransport = (input, init) => {
      const path = new URL(input).pathname
      const body = parseBody(init)
      if (path.endsWith('/user/getDriveInfo')) return Promise.resolve(driveInfo())
      if (path.endsWith('/openFile/list')) {
        if (body.parent_file_id === 'authorized-root') {
          return Promise.resolve(json({ items: [documentsFolder] }))
        }
        if (body.parent_file_id === documentsFolder.fileId) {
          return Promise.resolve(json({ items: [documentFolder], next_marker: 'same-marker' }))
        }
      }
      return Promise.reject(new Error(`unexpected request ${path}`))
    }
    const client = createClient(transport)

    await expect(client.listDocuments()).rejects.toMatchObject<Partial<AliyunDriveError>>({
      code: 'invalid-response'
    })
  })

  test('creates a UUID-folder file with bounded parts and no bearer on upload URLs', async () => {
    let completed = false
    const events: string[] = []
    const apiBodies: Array<{ path: string; body: JSONObject }> = []
    const transport: AliyunDriveTransport = (input, init) => {
      if (input === UPLOAD_URL) {
        events.push('put-part')
        expect(new Headers(init?.headers).has('authorization')).toBe(false)
        expect(new Headers(init?.headers).get('content-length')).toBe('3')
        return Promise.resolve(new Response(null, { status: 200 }))
      }
      const path = new URL(input).pathname
      const body = parseBody(init)
      apiBodies.push({ path, body })
      if (path.endsWith('/user/getDriveInfo')) return Promise.resolve(driveInfo())
      if (path.endsWith('/openFile/list')) {
        if (body.parent_file_id === 'authorized-root') {
          return Promise.resolve(json({ items: [documentsFolder] }))
        }
        if (body.parent_file_id === documentsFolder.fileId) {
          return Promise.resolve(json({ items: [] }))
        }
        if (body.parent_file_id === documentFolder.fileId) {
          return Promise.resolve(json({ items: completed ? [newFile] : [] }))
        }
      }
      if (path.endsWith('/openFile/create') && body.type === 'folder') {
        events.push('create-folder')
        return Promise.resolve(json({ file_id: documentFolder.fileId }))
      }
      if (path.endsWith('/openFile/create') && body.type === 'file') {
        events.push('create-file')
        return Promise.resolve(
          json({
            file_id: newFile.fileId,
            upload_id: 'upload-1',
            part_info_list: [{ part_number: 1, upload_url: UPLOAD_URL }]
          })
        )
      }
      if (path.endsWith('/openFile/complete')) {
        events.push('complete')
        completed = true
        return Promise.resolve(new Response(null, { status: 200 }))
      }
      if (path.endsWith('/openFile/get')) {
        if (body.file_id === documentFolder.fileId) return Promise.resolve(json(documentFolder))
        if (body.file_id === newFile.fileId && completed) return Promise.resolve(json(newFile))
      }
      return Promise.reject(new Error(`unexpected request ${path}`))
    }
    const client = createClient(transport)

    const result = await client.createDocument({
      documentId: DOCUMENT_ID,
      name: '惊悚.fig',
      bytes: new Uint8Array([1, 2, 3]),
      expectedAuthority: AUTHORITY
    })

    expect(result.remoteRevision).toEqual({
      fileId: newFile.fileId,
      contentHash: 'sha1-new',
      updatedAt: newFile.updatedAt,
      size: '3'
    })
    expect(events).toEqual(['create-folder', 'create-file', 'put-part', 'complete'])
    const createFile = apiBodies.find(
      (entry) => entry.path.endsWith('/openFile/create') && entry.body.type === 'file'
    )
    expect(createFile?.body).toMatchObject({
      parent_file_id: documentFolder.fileId,
      check_name_mode: 'refuse',
      part_info_list: [{ part_number: 1 }]
    })
  })

  test('replaces by uploading a new item before trashing the exact old item', async () => {
    let completed = false
    let oldTrashed = false
    const events: string[] = []
    const transport: AliyunDriveTransport = (input, init) => {
      if (input === UPLOAD_URL) {
        events.push('put-part')
        return Promise.resolve(new Response(null, { status: 200 }))
      }
      const path = new URL(input).pathname
      const body = parseBody(init)
      if (path.endsWith('/user/getDriveInfo')) return Promise.resolve(driveInfo())
      if (path.endsWith('/openFile/list')) {
        if (body.parent_file_id === 'authorized-root') {
          return Promise.resolve(json({ items: [documentsFolder] }))
        }
        if (body.parent_file_id === documentsFolder.fileId) {
          return Promise.resolve(json({ items: [documentFolder] }))
        }
        if (body.parent_file_id === documentFolder.fileId) {
          const items = completed ? (oldTrashed ? [newFile] : [oldFile, newFile]) : [oldFile]
          return Promise.resolve(json({ items }))
        }
      }
      if (path.endsWith('/openFile/create') && body.type === 'file') {
        events.push('create-file')
        expect(body.check_name_mode).toBe('ignore')
        return Promise.resolve(
          json({
            file_id: newFile.fileId,
            upload_id: 'upload-1',
            part_info_list: [{ part_number: 1, upload_url: UPLOAD_URL }]
          })
        )
      }
      if (path.endsWith('/openFile/complete')) {
        events.push('complete')
        completed = true
        return Promise.resolve(new Response(null, { status: 200 }))
      }
      if (path.endsWith('/openFile/get')) {
        if (body.file_id === oldFile.fileId) return Promise.resolve(json(oldFile))
        if (body.file_id === newFile.fileId) return Promise.resolve(json(newFile))
      }
      if (path.endsWith('/recyclebin/trash')) {
        events.push('trash-old')
        expect(body.file_id).toBe(oldFile.fileId)
        oldTrashed = true
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.reject(new Error(`unexpected request ${path}`))
    }
    const client = createClient(transport)
    const current: AliyunDriveDocumentFile = {
      documentId: DOCUMENT_ID,
      folder: documentFolder,
      file: oldFile
    }

    const result = await client.replaceDocument({
      documentId: DOCUMENT_ID,
      name: '惊悚.fig',
      bytes: new Uint8Array([4, 5, 6]),
      current,
      expectedRemoteRevision: {
        fileId: oldFile.fileId,
        contentHash: oldFile.contentHash ?? '',
        updatedAt: oldFile.updatedAt,
        size: '3'
      },
      conflictDocumentId: CONFLICT_ID,
      conflictName: '惊悚 (conflict 2026-08-26 02-00-00).fig',
      expectedAuthority: AUTHORITY
    })

    expect(result.outcome).toBe('updated')
    expect(events).toEqual(['create-file', 'put-part', 'complete', 'trash-old'])
  })

  test('moves a newly uploaded item into an independent conflict folder when a race is detected', async () => {
    const conflictFolder = folder('conflict-folder', CONFLICT_ID, documentsFolder.fileId)
    const intruder = folder('intruder-folder', 'intruder', documentFolder.fileId)
    let completed = false
    let conflictCreated = false
    let moved = false
    const events: string[] = []
    // oxlint-disable-next-line eslint/complexity -- This stateful router makes every replacement race transition observable.
    const transport: AliyunDriveTransport = (input, init) => {
      if (input === UPLOAD_URL) {
        events.push('put-part')
        return Promise.resolve(new Response(null, { status: 200 }))
      }
      const path = new URL(input).pathname
      const body = parseBody(init)
      if (path.endsWith('/user/getDriveInfo')) return Promise.resolve(driveInfo())
      if (path.endsWith('/openFile/list')) {
        if (body.parent_file_id === 'authorized-root') {
          return Promise.resolve(json({ items: [documentsFolder] }))
        }
        if (body.parent_file_id === documentsFolder.fileId) {
          return Promise.resolve(
            json({ items: conflictCreated ? [documentFolder, conflictFolder] : [documentFolder] })
          )
        }
        if (body.parent_file_id === documentFolder.fileId) {
          if (!completed) return Promise.resolve(json({ items: [oldFile] }))
          return Promise.resolve(json({ items: moved ? [oldFile, intruder] : [oldFile, newFile, intruder] }))
        }
        if (body.parent_file_id === conflictFolder.fileId) {
          return Promise.resolve(json({ items: [] }))
        }
      }
      if (path.endsWith('/openFile/create') && body.type === 'file') {
        events.push('create-file')
        return Promise.resolve(
          json({
            file_id: newFile.fileId,
            upload_id: 'upload-1',
            part_info_list: [{ part_number: 1, upload_url: UPLOAD_URL }]
          })
        )
      }
      if (path.endsWith('/openFile/create') && body.type === 'folder') {
        events.push('create-conflict-folder')
        conflictCreated = true
        return Promise.resolve(json({ file_id: conflictFolder.fileId }))
      }
      if (path.endsWith('/openFile/complete')) {
        events.push('complete')
        completed = true
        return Promise.resolve(new Response(null, { status: 200 }))
      }
      if (path.endsWith('/openFile/move')) {
        events.push('move-conflict')
        expect(body.file_id).toBe(newFile.fileId)
        expect(body.to_parent_file_id).toBe(conflictFolder.fileId)
        moved = true
        return Promise.resolve(json({ file_id: newFile.fileId }))
      }
      if (path.endsWith('/openFile/get')) {
        if (body.file_id === oldFile.fileId) return Promise.resolve(json(oldFile))
        if (body.file_id === conflictFolder.fileId) return Promise.resolve(json(conflictFolder))
        if (body.file_id === newFile.fileId) {
          return Promise.resolve(
            json(
              moved
                ? {
                    ...newFile,
                    parentFileId: undefined,
                    parent_file_id: undefined
                  }
                : newFile
            )
          )
        }
      }
      if (path.endsWith('/recyclebin/trash')) {
        events.push('unexpected-trash')
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.reject(new Error(`unexpected request ${path}`))
    }

    // The API wire shape is snake_case; make the moved response explicit rather than reusing TS keys.
    const wireTransport: AliyunDriveTransport = async (input, init) => {
      if (input.includes('/openFile/get') && parseBody(init).file_id === newFile.fileId && moved) {
        return json({
          drive_id: newFile.driveId,
          file_id: newFile.fileId,
          parent_file_id: conflictFolder.fileId,
          name: '惊悚 (conflict 2026-08-26 02-00-00).fig',
          type: 'file',
          size: newFile.size,
          content_hash: newFile.contentHash,
          created_at: newFile.createdAt,
          updated_at: newFile.updatedAt
        })
      }
      return transport(input, init)
    }
    const client = createClient(wireTransport)
    const current: AliyunDriveDocumentFile = {
      documentId: DOCUMENT_ID,
      folder: documentFolder,
      file: oldFile
    }

    const result = await client.replaceDocument({
      documentId: DOCUMENT_ID,
      name: '惊悚.fig',
      bytes: new Uint8Array([4, 5, 6]),
      current,
      expectedRemoteRevision: {
        fileId: oldFile.fileId,
        contentHash: oldFile.contentHash ?? '',
        updatedAt: oldFile.updatedAt,
        size: '3'
      },
      conflictDocumentId: CONFLICT_ID,
      conflictName: '惊悚 (conflict 2026-08-26 02-00-00).fig',
      expectedAuthority: AUTHORITY
    })

    expect(result).toMatchObject({
      outcome: 'conflict-copy',
      remoteRevision: null,
      conflictDocumentId: CONFLICT_ID,
      conflictCopyRevision: { fileId: newFile.fileId, contentHash: 'sha1-new' }
    })
    expect(events).toEqual([
      'create-file',
      'put-part',
      'complete',
      'create-conflict-folder',
      'move-conflict'
    ])
    expect(events).not.toContain('unexpected-trash')
  })
})
