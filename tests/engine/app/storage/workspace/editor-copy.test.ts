import { describe, expect, test, vi } from 'bun:test'

import {
  GoogleDriveEditorCopyError,
  queueEditorDocumentCopyToStorage,
  queueEditorDocumentCopyToGoogleDrive
} from '@/app/storage/workspace/editor-copy'

const authority = {
  accountId: 'google-subject',
  authorizationVersion: 'grant-1'
}

describe('queueEditorDocumentCopyToGoogleDrive', () => {
  test('exports a snapshot and queues a copy without touching source identity', async () => {
    const source = {
      state: { documentName: '惊悚' },
      buildFigFileSnapshot: vi.fn(async () => ({
        data: new Uint8Array([1, 2, 3]),
        sceneVersion: 9
      })),
      getSourceIdentity: vi.fn(() => ({ path: '/tmp/惊悚.fig', handle: null })),
      getStorageBinding: vi.fn(() => null),
      setStorageDocumentSource: vi.fn(),
      saveFigFile: vi.fn()
    }
    const beforeIdentity = source.getSourceIdentity()
    const beforeBinding = source.getStorageBinding()
    const queue = vi.fn(async () => ({
      binding: {
        providerId: 'google-drive',
        profileId: 'personal',
        documentId: 'drive-document-1',
        authority
      },
      revision: 1,
      queueState: 'queued' as const
    }))

    await queueEditorDocumentCopyToGoogleDrive(source, {
      resolveTarget: async () => ({ profileId: 'personal', authority }),
      queue
    })

    expect(queue).toHaveBeenCalledWith({
      profileId: 'personal',
      authority,
      name: '惊悚',
      figBytes: new Uint8Array([1, 2, 3])
    })
    expect(source.getSourceIdentity()).toEqual(beforeIdentity)
    expect(source.getStorageBinding()).toBe(beforeBinding)
    expect(source.setStorageDocumentSource).not.toHaveBeenCalled()
    expect(source.saveFigFile).not.toHaveBeenCalled()
  })

  test('blocks duplicate clicks while the same document copy is in progress', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const source = {
      state: { documentName: 'Draft' },
      buildFigFileSnapshot: vi.fn(async () => {
        await gate
        return { data: new Uint8Array([1]), sceneVersion: 1 }
      })
    }
    const dependencies = {
      resolveTarget: async () => ({ profileId: 'personal', authority }),
      queue: vi.fn(async () => ({
        binding: {
          providerId: 'google-drive',
          profileId: 'personal',
          documentId: 'drive-document-1',
          authority
        },
        revision: 1,
        queueState: 'queued' as const
      }))
    }

    const first = queueEditorDocumentCopyToGoogleDrive(source, dependencies)
    await Promise.resolve()
    await expect(queueEditorDocumentCopyToGoogleDrive(source, dependencies)).rejects.toBeInstanceOf(
      GoogleDriveEditorCopyError
    )
    release()
    await first
    expect(dependencies.queue).toHaveBeenCalledTimes(1)
  })

  test('does not export the document when Google Drive is not connected', async () => {
    const source = {
      state: { documentName: 'Draft' },
      buildFigFileSnapshot: vi.fn(async () => ({ data: new Uint8Array([1]), sceneVersion: 1 }))
    }

    await expect(
      queueEditorDocumentCopyToGoogleDrive(source, {
        resolveTarget: async () => {
          throw new GoogleDriveEditorCopyError('not-connected')
        },
        queue: vi.fn()
      })
    ).rejects.toMatchObject({ code: 'not-connected' })
    expect(source.buildFigFileSnapshot).not.toHaveBeenCalled()
  })
})

describe('queueEditorDocumentCopyToStorage', () => {
  test('queues an independent OneDrive copy through the provider-neutral path', async () => {
    const oneDriveAuthority = {
      accountId: 'microsoft-subject',
      authorizationVersion: 'onedrive-grant-1'
    }
    const source = {
      state: { documentName: '惊悚' },
      buildFigFileSnapshot: vi.fn(async () => ({
        data: new Uint8Array([4, 5, 6]),
        sceneVersion: 10
      }))
    }
    const queue = vi.fn(async () => ({
      binding: {
        providerId: 'onedrive',
        profileId: 'personal',
        documentId: 'cf825723-d25a-4429-bb55-5adca589267d',
        authority: oneDriveAuthority
      },
      revision: 1,
      queueState: 'queued' as const
    }))

    await queueEditorDocumentCopyToStorage(source, 'onedrive', {
      resolveTarget: async (providerId) => ({
        providerId,
        profileId: 'personal',
        authority: oneDriveAuthority
      }),
      queue
    })

    expect(queue).toHaveBeenCalledWith({
      providerId: 'onedrive',
      profileId: 'personal',
      authority: oneDriveAuthority,
      name: '惊悚',
      figBytes: new Uint8Array([4, 5, 6])
    })
  })
})
