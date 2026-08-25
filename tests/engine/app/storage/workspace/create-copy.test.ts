import { describe, expect, test, vi } from 'bun:test'

import { GOOGLE_DRIVE_STORAGE_PROVIDER_ID } from '@/app/integrations/storage'
import type {
  StorageAdapter,
  StorageDocumentAuthority,
  StorageDocumentBinding
} from '@/app/integrations/storage'
import type { LocalCanvasMeta } from '@/app/storage/local-store'
import type { StorageProfileMutationLease } from '@/app/storage/mutation-drain'
import {
  GoogleDriveDocumentCopyError,
  queueStorageDocumentCopy,
  queueGoogleDriveDocumentCopy,
  type GoogleDriveDocumentCopyDependencies
} from '@/app/storage/workspace/create-copy'

const authority: StorageDocumentAuthority = {
  accountId: 'google-subject',
  authorizationVersion: 'grant-1'
}
const lease = {} as StorageProfileMutationLease

function adapter(overrides: Partial<StorageAdapter> = {}): StorageAdapter {
  return {
    getAuthority: vi.fn(async () => authority),
    reserveDocumentId: vi.fn(async () => 'drive-document-1'),
    ...overrides
  } as StorageAdapter
}

function metadata(binding: StorageDocumentBinding, name = '惊悚'): LocalCanvasMeta {
  return {
    key: 'local-key',
    id: binding.documentId,
    providerId: binding.providerId,
    profileId: binding.profileId,
    authority: binding.authority ?? null,
    name,
    updatedAt: '2026-08-25T00:00:00.000Z',
    revision: 1,
    syncStatus: 'pending',
    lastSyncedAt: null,
    lastSyncError: null,
    remoteRevision: null,
    tombstoned: false,
    hasFig: true,
    hasThumb: false
  }
}

function dependencies(
  overrides: Partial<GoogleDriveDocumentCopyDependencies> = {}
): GoogleDriveDocumentCopyDependencies {
  return {
    assertDurability: vi.fn(async () => undefined),
    createAdapter: vi.fn(() => adapter()),
    store: { getMeta: vi.fn(async () => null) },
    persist: vi.fn(async () => ({ revision: 1 })),
    withLease: async (_scope, operation) => operation(lease),
    recover: vi.fn(),
    emit: vi.fn(),
    warn: vi.fn(),
    ...overrides
  }
}

const input = {
  profileId: 'personal',
  authority,
  name: '惊悚',
  figBytes: new Uint8Array([1, 2, 3])
} as const

describe('queueGoogleDriveDocumentCopy', () => {
  test('reserves an authority-bound Drive ID before persisting through the inherited lease', async () => {
    const order: string[] = []
    const drive = adapter({
      getAuthority: vi.fn(async () => {
        order.push('authority')
        return authority
      }),
      reserveDocumentId: vi.fn(async (options) => {
        order.push('reserve')
        expect(options?.expectedAuthority).toEqual(authority)
        return 'drive-document-1'
      })
    })
    const runtime = dependencies({
      createAdapter: vi.fn(() => drive),
      store: {
        getMeta: vi.fn(async () => {
          order.push('collision-check')
          return null
        })
      },
      persist: vi.fn(async (options) => {
        order.push('persist')
        expect(options).toEqual({
          providerId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
          profileId: 'personal',
          authority,
          canvasId: 'drive-document-1',
          name: '惊悚',
          figBytes: input.figBytes,
          mutationLease: lease
        })
        return { revision: 7 }
      })
    })

    await expect(queueGoogleDriveDocumentCopy(input, runtime)).resolves.toEqual({
      binding: {
        providerId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
        profileId: 'personal',
        documentId: 'drive-document-1',
        authority
      },
      revision: 7,
      queueState: 'queued'
    })
    expect(order).toEqual(['authority', 'reserve', 'collision-check', 'persist'])
  })

  test('fails before reservation when the exact authorization grant changed', async () => {
    const reserve = vi.fn(async () => 'unused')
    const persist = vi.fn(async () => ({ revision: 1 }))
    const runtime = dependencies({
      createAdapter: () =>
        adapter({
          getAuthority: async () => ({ ...authority, authorizationVersion: 'grant-2' }),
          reserveDocumentId: reserve
        }),
      persist
    })

    await expect(queueGoogleDriveDocumentCopy(input, runtime)).rejects.toMatchObject({
      code: 'authorization-changed'
    })
    expect(reserve).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })

  test('fails closed when Drive ID reservation is unavailable', async () => {
    const persist = vi.fn(async () => ({ revision: 1 }))
    const runtime = dependencies({
      createAdapter: () => adapter({ reserveDocumentId: undefined }),
      persist
    })

    await expect(queueGoogleDriveDocumentCopy(input, runtime)).rejects.toBeInstanceOf(
      GoogleDriveDocumentCopyError
    )
    await expect(queueGoogleDriveDocumentCopy(input, runtime)).rejects.toMatchObject({
      code: 'reservation-unsupported'
    })
    expect(persist).not.toHaveBeenCalled()
  })

  test('does not overwrite a local row when a reserved ID collides', async () => {
    const binding: StorageDocumentBinding = {
      providerId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
      profileId: input.profileId,
      documentId: 'drive-document-1',
      authority
    }
    const persist = vi.fn(async () => ({ revision: 1 }))
    const runtime = dependencies({
      store: { getMeta: vi.fn(async () => metadata(binding)) },
      persist
    })

    await expect(queueGoogleDriveDocumentCopy(input, runtime)).rejects.toMatchObject({
      code: 'id-collision'
    })
    expect(persist).not.toHaveBeenCalled()
  })

  test('honors cancellation after reservation but before the local commit', async () => {
    const controller = new AbortController()
    const persist = vi.fn(async () => ({ revision: 1 }))
    const runtime = dependencies({
      createAdapter: () =>
        adapter({
          reserveDocumentId: async () => {
            controller.abort()
            return 'drive-document-1'
          }
        }),
      persist
    })

    await expect(
      queueGoogleDriveDocumentCopy({ ...input, signal: controller.signal }, runtime)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(persist).not.toHaveBeenCalled()
  })

  test('reports the durable row as recovery-pending when outbox enqueue fails', async () => {
    const binding: StorageDocumentBinding = {
      providerId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
      profileId: input.profileId,
      documentId: 'drive-document-1',
      authority
    }
    let reads = 0
    const runtime = dependencies({
      store: {
        getMeta: vi.fn(async () => (++reads === 1 ? null : metadata(binding)))
      },
      persist: vi.fn(async () => {
        throw new Error('outbox unavailable')
      })
    })

    await expect(queueGoogleDriveDocumentCopy(input, runtime)).resolves.toEqual({
      binding,
      revision: 1,
      queueState: 'recovery-pending'
    })
    expect(runtime.warn).toHaveBeenCalledTimes(1)
    expect(runtime.emit).toHaveBeenCalledWith(binding)
    expect(runtime.recover).toHaveBeenCalledTimes(1)
  })

  test('rethrows failures that happened before a local row was committed', async () => {
    const failure = new Error('local write failed')
    const runtime = dependencies({
      persist: vi.fn(async () => {
        throw failure
      })
    })

    await expect(queueGoogleDriveDocumentCopy(input, runtime)).rejects.toBe(failure)
    expect(runtime.recover).not.toHaveBeenCalled()
  })

  test('does not contact Drive when durable storage is unavailable', async () => {
    const createAdapter = vi.fn(() => adapter())
    const runtime = dependencies({
      assertDurability: vi.fn(async () => {
        throw new Error('durability unavailable')
      }),
      createAdapter
    })

    await expect(queueGoogleDriveDocumentCopy(input, runtime)).rejects.toThrow(
      'durability unavailable'
    )
    expect(createAdapter).not.toHaveBeenCalled()
  })
})

describe('queueStorageDocumentCopy', () => {
  test('keeps OneDrive identity on the durable row and adapter lookup', async () => {
    const oneDriveAuthority = {
      accountId: 'microsoft-subject',
      authorizationVersion: 'onedrive-grant-1'
    }
    const documentId = 'cf825723-d25a-4429-bb55-5adca589267d'
    const createAdapter = vi.fn((_profileId: string, _providerId?: string) =>
      adapter({
        getAuthority: vi.fn(async () => oneDriveAuthority),
        reserveDocumentId: vi.fn(async () => documentId)
      })
    )
    const persist = vi.fn(async () => ({ revision: 2 }))
    const runtime = dependencies({ createAdapter, persist })

    await queueStorageDocumentCopy(
      {
        providerId: 'onedrive',
        profileId: 'personal',
        authority: oneDriveAuthority,
        name: '惊悚',
        figBytes: new Uint8Array([4, 5, 6])
      },
      runtime
    )

    expect(createAdapter).toHaveBeenCalledWith('personal', 'onedrive')
    expect(persist).toHaveBeenCalledWith({
      providerId: 'onedrive',
      profileId: 'personal',
      authority: oneDriveAuthority,
      canvasId: documentId,
      name: '惊悚',
      figBytes: new Uint8Array([4, 5, 6]),
      mutationLease: lease
    })
  })
})
