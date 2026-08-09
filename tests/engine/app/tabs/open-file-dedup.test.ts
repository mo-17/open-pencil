import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test'

import * as figModule from '@open-pencil/core/io/formats/fig'
import * as layoutModule from '@open-pencil/core/layout'
import { SceneGraph } from '@open-pencil/scene-graph'

import { resolveBrowserFileURL } from '@/app/document/io/browser'
import type { DocumentSourceIdentity } from '@/app/document/io/types'
import * as storageModule from '@/app/integrations/storage'
import {
  createMemoryLocalCanvasStore,
  resetLocalCanvasStoreForTests
} from '@/app/storage/local-store'
import { withStorageProfileMutationDrain } from '@/app/storage/mutation-drain'
import { createMemoryOutbox, resetOutboxForTests } from '@/app/storage/sync/outbox'
import {
  createTab,
  getActiveStore,
  openFileInNewTab,
  openStorageDocumentInNewTab,
  tabCount
} from '@/app/tabs'
import { fileIdentitiesMatch, findTabByFileIdentity } from '@/app/tabs/open/identity'

function setupGlobals() {
  globalThis.window = {
    innerWidth: 1024,
    innerHeight: 768,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    },
    cancelAnimationFrame: vi.fn(),
    openPencil: {},
    location: { href: 'http://localhost/' } as Location,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  } as Window & typeof globalThis
  globalThis.document = {
    fonts: { add: vi.fn(), ready: Promise.resolve() }
  } as Document
  globalThis.requestAnimationFrame = window.requestAnimationFrame
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame
}

function makeHandle(
  name: string,
  isSameEntry: (other: FileSystemFileHandle) => Promise<boolean>
): FileSystemFileHandle {
  return { kind: 'file', name, isSameEntry } as FileSystemFileHandle
}

describe('file identity', () => {
  test('matches equivalent handles without using file names as identity', async () => {
    const stored = makeHandle('design.fig', async (other) => other.name === 'alias.fig')
    const alias = makeHandle('alias.fig', async () => false)
    const sameName = makeHandle('design.fig', async () => false)

    await expect(
      fileIdentitiesMatch({ handle: stored, path: null }, { handle: alias, path: null })
    ).resolves.toBe(true)
    await expect(
      fileIdentitiesMatch({ handle: stored, path: null }, { handle: sameName, path: null })
    ).resolves.toBe(false)
  })

  test('ignores an asynchronous handle match after the tab source changes', async () => {
    const comparison = Promise.withResolvers<boolean>()
    const started = Promise.withResolvers<undefined>()
    const storedHandle = makeHandle('stored.fig', async () => {
      started.resolve(undefined)
      return comparison.promise
    })
    const incomingHandle = makeHandle('incoming.fig', async () => false)
    let storedIdentity: DocumentSourceIdentity = { handle: storedHandle, path: null }
    const tab = { store: { getSourceIdentity: () => storedIdentity } }

    const finding = findTabByFileIdentity([tab], {
      handle: incomingHandle,
      path: null
    })
    await started.promise
    storedIdentity = { handle: storedHandle, path: '/other.fig' }
    comparison.resolve(true)

    await expect(finding).resolves.toBeNull()
  })

  test('finds a tab by path and ignores tabs without stable identity', async () => {
    const matchedIdentity = { handle: null, path: '/tmp/design.fig' }
    const matched = {
      store: { getSourceIdentity: () => matchedIdentity }
    }
    const unidentifiedIdentity = { handle: null, path: null }
    const unidentified = {
      store: { getSourceIdentity: () => unidentifiedIdentity }
    }

    await expect(
      findTabByFileIdentity([unidentified, matched], {
        handle: null,
        path: '/tmp/design.fig'
      })
    ).resolves.toBe(matched)
    await expect(
      findTabByFileIdentity([unidentified], { handle: null, path: null })
    ).resolves.toBeNull()
  })
})

describe('tab opening deduplication', () => {
  beforeEach(() => {
    setupGlobals()
    vi.spyOn(layoutModule, 'computeAllLayouts').mockReturnValue(undefined)
    vi.spyOn(figModule, 'readFigFile').mockResolvedValue(new SceneGraph())
    vi.spyOn(figModule, 'readFigSource').mockImplementation(async (source) => {
      await source.read()
      return new SceneGraph()
    })
    resetLocalCanvasStoreForTests(createMemoryLocalCanvasStore())
    resetOutboxForTests(createMemoryOutbox())
    createTab()
  })

  afterEach(() => {
    resetLocalCanvasStoreForTests()
    resetOutboxForTests()
    vi.restoreAllMocks()
    Reflect.deleteProperty(globalThis, 'window')
    Reflect.deleteProperty(globalThis, 'document')
    Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
    Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  })

  test('canonicalizes browser URLs before using them as file identity', () => {
    expect(resolveBrowserFileURL('/design.fig#selection').href).toBe('http://localhost/design.fig')
  })

  test('fails a cloud open before adapter or tab mutation when durable storage is unavailable', async () => {
    resetLocalCanvasStoreForTests()
    resetOutboxForTests()
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    Reflect.deleteProperty(globalThis, 'indexedDB')
    try {
      const createAdapter = vi.spyOn(storageModule, 'createActiveStorageAdapter')
      const initialCount = tabCount()

      await expect(
        openStorageDocumentInNewTab({
          id: 'not-opened',
          name: 'Not opened.fig',
          updatedAt: '2026-08-10T00:00:00.000Z'
        })
      ).rejects.toMatchObject({ code: 'durability-unavailable' })

      expect(createAdapter).not.toHaveBeenCalled()
      expect(tabCount()).toBe(initialCount)
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor)
    }
  })

  test('activates the existing tab when the same path is opened again', async () => {
    const initialCount = tabCount()
    const file = new File([], 'design.fig')

    await openFileInNewTab(file, undefined, '/tmp/design.fig')
    const openedStore = getActiveStore()
    await openFileInNewTab(file, undefined, '/tmp/design.fig')

    expect(tabCount()).toBe(initialCount)
    expect(getActiveStore()).toBe(openedStore)
    expect(figModule.readFigFile).toHaveBeenCalledTimes(1)
  })

  test('shares one load between concurrent opens of the same path', async () => {
    const started = Promise.withResolvers<undefined>()
    const read = Promise.withResolvers<SceneGraph>()
    ;(figModule.readFigFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      started.resolve(undefined)
      return read.promise
    })
    const initialCount = tabCount()
    const file = new File([], 'concurrent.fig')

    const first = openFileInNewTab(file, undefined, '/tmp/concurrent.fig')
    await started.promise
    const second = openFileInNewTab(file, undefined, '/tmp/concurrent.fig')
    await Promise.resolve()

    expect(figModule.readFigFile).toHaveBeenCalledTimes(1)
    read.resolve(new SceneGraph())
    await Promise.all([first, second])
    expect(tabCount()).toBe(initialCount)
  })

  test('starts loading before a deferred desktop read and parses its buffer directly', async () => {
    let loadingDuringRead = false
    const read = vi.fn(async () => {
      loadingDuringRead = getActiveStore().state.loading
      return new Uint8Array([1, 2, 3])
    })

    await openFileInNewTab({ name: 'large.fig', read }, undefined, '/tmp/large.fig')

    expect(loadingDuringRead).toBe(true)
    expect(read).toHaveBeenCalledTimes(1)
    expect(figModule.readFigSource).toHaveBeenCalledTimes(1)
    expect(figModule.readFigFile).not.toHaveBeenCalled()
  })

  test('allows different files to load concurrently', async () => {
    const reads = [Promise.withResolvers<SceneGraph>(), Promise.withResolvers<SceneGraph>()]
    const bothStarted = Promise.withResolvers<undefined>()
    let readIndex = 0
    ;(figModule.readFigFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const read = reads[readIndex++]
      if (readIndex === 2) bothStarted.resolve(undefined)
      return read?.promise ?? Promise.resolve(new SceneGraph())
    })
    const initialCount = tabCount()

    const first = openFileInNewTab(new File([], 'first.fig'), undefined, '/tmp/first.fig')
    const second = openFileInNewTab(new File([], 'second.fig'), undefined, '/tmp/second.fig')
    await bothStarted.promise

    expect(figModule.readFigFile).toHaveBeenCalledTimes(2)
    reads[0].resolve(new SceneGraph())
    reads[1].resolve(new SceneGraph())
    await Promise.all([first, second])
    expect(tabCount()).toBe(initialCount + 1)
  })

  test('removes a failed pending open so the file can be retried', async () => {
    ;(figModule.readFigFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(new SceneGraph())

    await expect(
      openFileInNewTab(new File([], 'retry.fig'), undefined, '/tmp/retry.fig')
    ).rejects.toThrow('read failed')
    await expect(
      openFileInNewTab(new File([], 'retry.fig'), undefined, '/tmp/retry.fig')
    ).resolves.toBeUndefined()

    expect(figModule.readFigFile).toHaveBeenCalledTimes(2)
    expect(getActiveStore().getSourceIdentity().path).toBe('/tmp/retry.fig')
  })

  test('keeps same-named files distinct without a path or handle', async () => {
    const initialCount = tabCount()
    const file = new File([], 'same-name.fig')

    await openFileInNewTab(file)
    await openFileInNewTab(file)

    expect(tabCount()).toBe(initialCount + 1)
    expect(figModule.readFigFile).toHaveBeenCalledTimes(2)
  })

  test('shares one download and parse between concurrent storage opens', async () => {
    const started = Promise.withResolvers<undefined>()
    const download = Promise.withResolvers<storageModule.StorageGetDocumentResult>()
    const getDocument = vi.fn(() => {
      started.resolve(undefined)
      return download.promise
    })
    vi.spyOn(storageModule, 'createActiveStorageAdapter').mockReturnValue({
      getDocument
    } as ReturnType<typeof storageModule.createActiveStorageAdapter>)
    const document = {
      id: 'storage-concurrent',
      name: 'Storage concurrent',
      updatedAt: '2026-07-31T00:00:00.000Z',
      metadataAuthoritative: true
    }
    const initialCount = tabCount()

    const first = openStorageDocumentInNewTab(document)
    await started.promise
    const second = openStorageDocumentInNewTab(document)
    await Promise.resolve()

    expect(getDocument).toHaveBeenCalledTimes(1)
    download.resolve({
      bytes: new Uint8Array([1, 2, 3]),
      metadata: { name: document.name, updatedAt: document.updatedAt },
      remoteRevision: null
    })
    await Promise.all([first, second])
    expect(tabCount()).toBe(initialCount)
    expect(getActiveStore().getStorageBinding()).toEqual({
      providerId: storageModule.activeStorageProviderID.value,
      profileId: storageModule.DEFAULT_STORAGE_PROFILE_ID,
      documentId: document.id
    })
  })

  test('does not reuse a storage tab after the same account receives a new grant', async () => {
    const grantOne = { accountId: 'account-1', authorizationVersion: 'grant-1' }
    const grantTwo = { accountId: 'account-1', authorizationVersion: 'grant-2' }
    const getDocument = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      metadata: { name: 'Reauthorized', updatedAt: '2026-08-09T00:00:00.000Z' },
      remoteRevision: null
    }))
    vi.spyOn(storageModule, 'createActiveStorageAdapter').mockReturnValue({
      getAuthority: vi.fn(async () => grantOne),
      getDocument
    } as ReturnType<typeof storageModule.createActiveStorageAdapter>)
    const document = {
      id: 'storage-reauthorized-existing',
      name: 'Reauthorized',
      updatedAt: '2026-08-09T00:00:00.000Z',
      metadataAuthoritative: true
    }
    const binding = {
      providerId: 'google-drive',
      profileId: 'default',
      documentId: document.id
    }
    const initialCount = tabCount()

    await openStorageDocumentInNewTab(document, { ...binding, authority: grantOne })
    const grantOneStore = getActiveStore()
    await openStorageDocumentInNewTab(document, { ...binding, authority: grantTwo })
    const grantTwoStore = getActiveStore()

    expect(tabCount()).toBe(initialCount + 1)
    expect(grantTwoStore).not.toBe(grantOneStore)
    expect(grantOneStore.getStorageBinding()?.authority).toEqual(grantOne)
    expect(grantTwoStore.getStorageBinding()?.authority).toEqual(grantTwo)
    expect(figModule.readFigSource).toHaveBeenCalledTimes(2)
    expect(getDocument).toHaveBeenCalledTimes(1)
  })

  test('does not join a pending storage open owned by an older grant', async () => {
    const grantOne = { accountId: 'account-2', authorizationVersion: 'grant-1' }
    const grantTwo = { accountId: 'account-2', authorizationVersion: 'grant-2' }
    const downloads = [
      Promise.withResolvers<storageModule.StorageGetDocumentResult>(),
      Promise.withResolvers<storageModule.StorageGetDocumentResult>()
    ]
    const bothStarted = Promise.withResolvers<undefined>()
    const getAuthority = vi.fn().mockResolvedValueOnce(grantOne).mockResolvedValueOnce(grantTwo)
    const getDocument = vi.fn(() => {
      const index = getDocument.mock.calls.length - 1
      if (getDocument.mock.calls.length === 2) bothStarted.resolve(undefined)
      return downloads[index]?.promise ?? Promise.reject(new Error('Unexpected storage download'))
    })
    vi.spyOn(storageModule, 'createActiveStorageAdapter').mockReturnValue({
      getAuthority,
      getDocument
    } as ReturnType<typeof storageModule.createActiveStorageAdapter>)
    const document = {
      id: 'storage-reauthorized-pending',
      name: 'Reauthorized pending',
      updatedAt: '2026-08-09T00:00:00.000Z',
      metadataAuthoritative: true
    }
    const binding = {
      providerId: 'google-drive',
      profileId: 'default',
      documentId: document.id
    }
    const initialCount = tabCount()

    const first = openStorageDocumentInNewTab(document, { ...binding, authority: grantOne })
    await Promise.resolve()
    const grantOneStore = getActiveStore()
    const second = openStorageDocumentInNewTab(document, { ...binding, authority: grantTwo })
    await bothStarted.promise
    const grantTwoStore = getActiveStore()

    expect(getDocument).toHaveBeenCalledTimes(2)
    expect(tabCount()).toBe(initialCount + 1)
    expect(grantTwoStore).not.toBe(grantOneStore)
    const downloaded = (name: string): storageModule.StorageGetDocumentResult => ({
      bytes: new Uint8Array([1, 2, 3]),
      metadata: { name, updatedAt: document.updatedAt },
      remoteRevision: null
    })
    downloads[0].resolve(downloaded('Grant one'))
    downloads[1].resolve(downloaded('Grant two'))
    await Promise.all([first, second])
    expect(grantOneStore.getStorageBinding()?.authority).toEqual(grantOne)
    expect(grantTwoStore.getStorageBinding()?.authority).toEqual(grantTwo)
  })

  for (const providerId of ['google-drive', 's3-compatible'] as const) {
    test(`binds ${providerId} downloads to the exact authority checked by the tab`, async () => {
      const authority = {
        accountId: `${providerId}-account`,
        authorizationVersion: `${providerId}-grant`
      }
      const controller = new AbortController()
      const getAuthority = vi.fn(async () => authority)
      const getDocument = vi.fn(async () => {
        throw new Error('The adapter rejected a replaced authorization')
      })
      vi.spyOn(storageModule, 'createActiveStorageAdapter').mockReturnValue({
        getAuthority,
        getDocument
      } as ReturnType<typeof storageModule.createActiveStorageAdapter>)
      const document = {
        id: `${providerId}-authority-race`,
        name: 'Authority race',
        updatedAt: '2026-08-10T00:00:00.000Z',
        metadataAuthoritative: true
      }

      await expect(
        openStorageDocumentInNewTab(
          document,
          {
            providerId,
            profileId: 'default',
            documentId: document.id,
            authority
          },
          { signal: controller.signal }
        )
      ).rejects.toThrow('replaced authorization')

      expect(getAuthority).toHaveBeenCalledWith({ signal: controller.signal })
      expect(getDocument).toHaveBeenCalledWith(document.id, {
        signal: controller.signal,
        expectedAuthority: authority
      })
    })
  }

  test('downloads a newer S3 object when its metadata sidecar is unavailable', async () => {
    const authority = {
      accountId: 's3-profile-incarnation',
      authorizationVersion: 's3-config-generation'
    }
    const binding = {
      providerId: 's3-compatible' as const,
      profileId: 'default',
      documentId: 's3-newer-without-sidecar',
      authority
    }
    const local = createMemoryLocalCanvasStore()
    resetLocalCanvasStoreForTests(local)
    await local.writeCanvas({
      ...binding,
      id: binding.documentId,
      name: 'Cached.fig',
      updatedAt: '2026-08-09T00:00:00.000Z',
      figBytes: new Uint8Array([1]),
      syncStatus: 'synced'
    })
    const getDocument = vi.fn(async () => ({
      bytes: new Uint8Array([2]),
      metadata: { name: 'Remote.fig', updatedAt: '2026-08-10T00:00:00.000Z' },
      remoteRevision: null
    }))
    vi.spyOn(storageModule, 'createActiveStorageAdapter').mockReturnValue({
      getAuthority: vi.fn(async () => authority),
      getDocument
    } as ReturnType<typeof storageModule.createActiveStorageAdapter>)

    await openStorageDocumentInNewTab(
      {
        id: binding.documentId,
        name: 'Remote.fig',
        updatedAt: '2026-08-10T00:00:00.000Z',
        metadataAuthoritative: false
      },
      binding
    )

    expect(getDocument).toHaveBeenCalledTimes(1)
    expect(getDocument).toHaveBeenCalledWith(binding.documentId, {
      expectedAuthority: authority
    })
  })

  test('holds the profile mutation lease until a cached storage open is fully bound', async () => {
    const authority = { accountId: 'cached-account', authorizationVersion: 'cached-grant' }
    const binding = {
      providerId: 'google-drive' as const,
      profileId: 'default',
      documentId: 'cached-drain-open',
      authority
    }
    const local = createMemoryLocalCanvasStore()
    resetLocalCanvasStoreForTests(local)
    await local.writeCanvas({
      ...binding,
      id: binding.documentId,
      name: 'Cached drain.fig',
      updatedAt: '2026-08-10T00:00:00.000Z',
      figBytes: new Uint8Array([1]),
      syncStatus: 'synced'
    })
    vi.spyOn(storageModule, 'createActiveStorageAdapter').mockReturnValue({
      getAuthority: vi.fn(async () => authority)
    } as ReturnType<typeof storageModule.createActiveStorageAdapter>)
    const parsing = Promise.withResolvers<SceneGraph>()
    const parsingStarted = Promise.withResolvers<undefined>()
    ;(figModule.readFigSource as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (source) => {
        await source.read()
        parsingStarted.resolve(undefined)
        return parsing.promise
      }
    )

    const opening = openStorageDocumentInNewTab(
      {
        id: binding.documentId,
        name: 'Cached drain.fig',
        updatedAt: '2026-08-10T00:00:00.000Z',
        metadataAuthoritative: true
      },
      binding
    )
    await parsingStarted.promise
    let drained = false
    const draining = withStorageProfileMutationDrain(binding, async () => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)

    parsing.resolve(new SceneGraph())
    await opening
    await draining
    expect(drained).toBe(true)
    expect(getActiveStore().getStorageBinding()).toEqual(binding)
  })

  test('removes a failed storage open and retries from the local cache', async () => {
    const getDocument = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      metadata: { name: 'Storage retry', updatedAt: '2026-07-31T00:00:00.000Z' },
      remoteRevision: null
    }))
    vi.spyOn(storageModule, 'createActiveStorageAdapter').mockReturnValue({
      getDocument
    } as ReturnType<typeof storageModule.createActiveStorageAdapter>)
    ;(figModule.readFigSource as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async (source) => {
        await source.read()
        throw new Error('parse failed')
      })
      .mockImplementationOnce(async (source) => {
        await source.read()
        return new SceneGraph()
      })
    const document = {
      id: 'storage-retry',
      name: 'Storage retry',
      updatedAt: '2026-07-31T00:00:00.000Z',
      metadataAuthoritative: true
    }

    await expect(openStorageDocumentInNewTab(document)).rejects.toThrow('parse failed')
    await expect(openStorageDocumentInNewTab(document)).resolves.toBeUndefined()

    expect(figModule.readFigSource).toHaveBeenCalledTimes(2)
    expect(getDocument).toHaveBeenCalledTimes(1)
    expect(getActiveStore().getStorageBinding()?.documentId).toBe(document.id)
  })

  test('does not create an adapter for an already-cancelled storage open', async () => {
    const createAdapter = vi.spyOn(storageModule, 'createActiveStorageAdapter')
    const controller = new AbortController()
    controller.abort()

    await expect(
      openStorageDocumentInNewTab(
        {
          id: 'cancelled-storage-open',
          name: 'Cancelled storage open',
          updatedAt: '2026-08-09T00:00:00.000Z'
        },
        undefined,
        { signal: controller.signal }
      )
    ).rejects.toHaveProperty('name', 'AbortError')
    expect(createAdapter).not.toHaveBeenCalled()
  })
})
