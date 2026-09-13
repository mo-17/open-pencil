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
  createDocumentInCurrentTab,
  createHomeTab,
  createTab,
  closeTab,
  getActiveStore,
  getOpeningStorageBinding,
  getTabsSnapshot,
  isStorageDocumentOpen,
  openFileInNewTab,
  openStorageDocumentInNewTab,
  showNewTab,
  switchTab,
  tabCount
} from '@/app/tabs'
import { fileIdentitiesMatch, findTabByFileIdentity } from '@/app/tabs/open/identity'

import { registerFigPopulationWorker } from '#core/kiwi/fig/population/client'

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

function acknowledgePendingPresentation(): void {
  for (const tab of getTabsSnapshot()) {
    if (tab.store.state.preparation?.phase !== 'preparing-render') continue
    tab.store.preparationController.acknowledgePresentation(tab.store.state.sceneVersion)
  }
}

type FileOpenOutcome = { status: 'fulfilled' } | { status: 'rejected'; reason: unknown }

async function settleFileOpen(opening: Promise<void>): Promise<void> {
  const outcome: Promise<FileOpenOutcome> = opening.then(
    () => ({ status: 'fulfilled' }),
    (reason: unknown) => ({ status: 'rejected', reason })
  )

  const awaitOutcome = async (): Promise<FileOpenOutcome> => {
    acknowledgePendingPresentation()
    const result = await Promise.race([
      outcome,
      new Promise<null>((resolve) => {
        setTimeout(resolve, 0)
      })
    ])
    return result ?? awaitOutcome()
  }

  const result = await awaitOutcome()
  if (result.status === 'rejected') throw result.reason
}

function makeHandle(
  name: string,
  isSameEntry: (other: FileSystemFileHandle) => Promise<boolean>
): FileSystemFileHandle {
  return { kind: 'file', name, isSameEntry } as FileSystemFileHandle
}

function trackGraphResource(graph: SceneGraph) {
  const terminate = vi.fn(() => undefined)
  registerFigPopulationWorker(graph, { terminate } as unknown as Worker)
  return terminate
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

  test('reuses the existing New tab when navigating to the files workspace', () => {
    const initialCount = tabCount()
    const initialHomeCount = getTabsSnapshot().filter((tab) => tab.kind === 'home').length

    showNewTab()
    showNewTab()

    expect(tabCount()).toBe(initialCount + (initialHomeCount === 0 ? 1 : 0))
    expect(getTabsSnapshot().filter((tab) => tab.kind === 'home')).toHaveLength(1)
  })

  test('converts the current New tab into a blank document', () => {
    createHomeTab()
    const home = getTabsSnapshot().at(-1)
    const count = tabCount()

    const document = createDocumentInCurrentTab()

    expect(tabCount()).toBe(count)
    expect(document.id).toBe(home?.id)
    expect(document.kind).toBe('document')
  })

  test('opens a file in the current New tab', async () => {
    createHomeTab()
    const home = getTabsSnapshot().at(-1)
    const count = tabCount()

    await settleFileOpen(
      openFileInNewTab(new File([], 'design.fig'), undefined, '/tmp/from-home.fig')
    )

    expect(tabCount()).toBe(count)
    expect(getTabsSnapshot().at(-1)?.id).toBe(home?.id)
    expect(getTabsSnapshot().at(-1)?.kind).toBe('document')
  })

  test('activates the existing tab when the same path is opened again', async () => {
    const initialCount = tabCount()
    const file = new File([], 'design.fig')

    await settleFileOpen(openFileInNewTab(file, undefined, '/tmp/design.fig'))
    const openedStore = getActiveStore()
    await settleFileOpen(openFileInNewTab(file, undefined, '/tmp/design.fig'))

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
    await Promise.all([settleFileOpen(first), settleFileOpen(second)])
    expect(tabCount()).toBe(initialCount)
  })

  test('starts preparation before a deferred desktop read and parses its buffer directly', async () => {
    let preparationDuringRead = false
    const read = vi.fn(async () => {
      preparationDuringRead = getActiveStore().state.preparation?.phase === 'decoding'
      return new Uint8Array([1, 2, 3])
    })

    await settleFileOpen(openFileInNewTab({ name: 'large.fig', read }, undefined, '/tmp/large.fig'))

    expect(preparationDuringRead).toBe(true)
    expect(read).toHaveBeenCalledTimes(1)
    expect(figModule.readFigSource).toHaveBeenCalledTimes(1)
    expect(figModule.readFigFile).not.toHaveBeenCalled()
  })

  test('releases a parsed tab graph when preparation throws before apply', async () => {
    const imported = new SceneGraph()
    const terminate = trackGraphResource(imported)
    ;(figModule.readFigFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(imported)
    ;(layoutModule.computeAllLayouts as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('layout failed')
    })

    await expect(
      settleFileOpen(openFileInNewTab(new File([], 'broken.fig'), undefined, '/tmp/broken.fig'))
    ).rejects.toThrow('layout failed')

    expect(terminate).toHaveBeenCalledTimes(1)
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
    await Promise.all([settleFileOpen(first), settleFileOpen(second)])
    expect(tabCount()).toBe(initialCount + 1)
  })

  test('removes a failed pending open so the file can be retried', async () => {
    ;(figModule.readFigFile as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(new SceneGraph())

    await expect(
      settleFileOpen(openFileInNewTab(new File([], 'retry.fig'), undefined, '/tmp/retry.fig'))
    ).rejects.toThrow('read failed')
    await expect(
      settleFileOpen(openFileInNewTab(new File([], 'retry.fig'), undefined, '/tmp/retry.fig'))
    ).resolves.toBeUndefined()

    expect(figModule.readFigFile).toHaveBeenCalledTimes(2)
    expect(getActiveStore().getSourceIdentity().path).toBe('/tmp/retry.fig')
  })

  test('keeps same-named files distinct without a path or handle', async () => {
    const initialCount = tabCount()
    const file = new File([], 'same-name.fig')

    await settleFileOpen(openFileInNewTab(file))
    await settleFileOpen(openFileInNewTab(file))

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
    await Promise.all([settleFileOpen(first), settleFileOpen(second)])
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

    await settleFileOpen(openStorageDocumentInNewTab(document, { ...binding, authority: grantOne }))
    const grantOneStore = getActiveStore()
    await settleFileOpen(openStorageDocumentInNewTab(document, { ...binding, authority: grantTwo }))
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
    expect(getOpeningStorageBinding(grantOneStore)).toEqual({ ...binding, authority: grantOne })
    expect(getOpeningStorageBinding(grantTwoStore)).toEqual({ ...binding, authority: grantTwo })
    const downloaded = (name: string): storageModule.StorageGetDocumentResult => ({
      bytes: new Uint8Array([1, 2, 3]),
      metadata: { name, updatedAt: document.updatedAt },
      remoteRevision: null
    })
    downloads[0].resolve(downloaded('Grant one'))
    downloads[1].resolve(downloaded('Grant two'))
    await Promise.all([settleFileOpen(first), settleFileOpen(second)])
    expect(grantOneStore.getStorageBinding()?.authority).toEqual(grantOne)
    expect(grantTwoStore.getStorageBinding()?.authority).toEqual(grantTwo)
    expect(getOpeningStorageBinding(grantOneStore)).toBeNull()
    expect(getOpeningStorageBinding(grantTwoStore)).toBeNull()
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
        onProgress: expect.any(Function),
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

    await settleFileOpen(
      openStorageDocumentInNewTab(
        {
          id: binding.documentId,
          name: 'Remote.fig',
          updatedAt: '2026-08-10T00:00:00.000Z',
          metadataAuthoritative: false,
          contentTimestampAuthoritative: true
        },
        binding
      )
    )

    expect(getDocument).toHaveBeenCalledTimes(1)
    expect(getDocument).toHaveBeenCalledWith(binding.documentId, {
      signal: expect.anything(),
      onProgress: expect.any(Function),
      expectedAuthority: authority
    })
  })

  test('downloads S3 content when neither a sidecar nor object timestamp is authoritative', async () => {
    const authority = {
      accountId: 's3-profile-incarnation',
      authorizationVersion: 's3-config-generation'
    }
    const binding = {
      providerId: 's3-compatible' as const,
      profileId: 'default',
      documentId: 's3-unknown-remote-time',
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
      metadata: { name: 'Remote.fig', updatedAt: new Date(0).toISOString() },
      remoteRevision: null
    }))
    vi.spyOn(storageModule, 'createActiveStorageAdapter').mockReturnValue({
      getAuthority: vi.fn(async () => authority),
      getDocument
    } as ReturnType<typeof storageModule.createActiveStorageAdapter>)

    await settleFileOpen(
      openStorageDocumentInNewTab(
        {
          id: binding.documentId,
          name: binding.documentId,
          updatedAt: new Date(0).toISOString(),
          metadataAuthoritative: false,
          contentTimestampAuthoritative: false
        },
        binding
      )
    )

    expect(getDocument).toHaveBeenCalledTimes(1)
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

    const opening = settleFileOpen(
      openStorageDocumentInNewTab(
        {
          id: binding.documentId,
          name: 'Cached drain.fig',
          updatedAt: '2026-08-10T00:00:00.000Z',
          metadataAuthoritative: true
        },
        binding
      )
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

    await expect(settleFileOpen(openStorageDocumentInNewTab(document))).rejects.toThrow(
      'parse failed'
    )
    await expect(settleFileOpen(openStorageDocumentInNewTab(document))).resolves.toBeUndefined()

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

  test('cloud deletion guards distinguish profiles, accounts, and S3 configuration generations', () => {
    const s3: storageModule.StorageDocumentBinding = {
      providerId: 's3-compatible',
      profileId: 'work',
      documentId: 'same-document',
      authority: { accountId: 'profile-incarnation', authorizationVersion: 'bucket-one' }
    }
    createTab().store.setStorageDocumentSource(s3, 'Untitled')
    expect(isStorageDocumentOpen(s3)).toBe(true)
    expect(isStorageDocumentOpen({ ...s3, profileId: 'personal' })).toBe(false)
    expect(isStorageDocumentOpen({ ...s3, documentId: 'another-document' })).toBe(false)
    expect(
      isStorageDocumentOpen({
        ...s3,
        authority: { accountId: 'another-incarnation', authorizationVersion: 'bucket-one' }
      })
    ).toBe(false)
    expect(
      isStorageDocumentOpen({
        ...s3,
        authority: { accountId: 'profile-incarnation', authorizationVersion: 'bucket-two' }
      })
    ).toBe(false)
    const drive = { ...s3, providerId: 'google-drive' }
    expect(isStorageDocumentOpen(drive)).toBe(false)
    createTab().store.setStorageDocumentSource(drive, 'Untitled')
    expect(
      isStorageDocumentOpen({
        ...drive,
        authority: { accountId: 'profile-incarnation', authorizationVersion: 'renewed-grant' }
      })
    ).toBe(true)
    expect(
      isStorageDocumentOpen({
        ...drive,
        authority: { accountId: 'another-account', authorizationVersion: 'renewed-grant' }
      })
    ).toBe(false)
  })

  for (const existingState of ['bound', 'closing'] as const) {
    test(`does not reuse a ${existingState} Untitled cloud tab`, async () => {
      const previous = createTab()
      const binding = {
        providerId: 's3-compatible',
        profileId: 'default',
        documentId: 'prior-cloud-document'
      }
      const persistence = Promise.withResolvers<undefined>()
      let closing: Promise<void> | undefined
      if (existingState === 'bound') {
        previous.store.setStorageDocumentSource(binding, 'Untitled')
      } else {
        vi.spyOn(previous.store, 'persistRecoveryNow').mockReturnValue(persistence.promise)
        closing = closeTab(previous.id)
      }
      vi.spyOn(storageModule, 'createActiveStorageAdapter').mockReturnValue({
        getDocument: vi.fn(async () => ({
          bytes: new Uint8Array([1, 2, 3]),
          metadata: { name: 'Next cloud', updatedAt: '2026-08-10T00:00:00.000Z' },
          remoteRevision: null
        }))
      } as ReturnType<typeof storageModule.createActiveStorageAdapter>)
      try {
        await settleFileOpen(
          openStorageDocumentInNewTab({
            id: 'next-cloud',
            name: 'Next cloud',
            updatedAt: '2026-08-10T00:00:00.000Z'
          })
        )
        expect(getActiveStore()).not.toBe(previous.store)
        expect(getActiveStore().getStorageBinding()?.documentId).toBe('next-cloud')
        if (existingState === 'bound') {
          expect(previous.store.getStorageBinding()).toEqual(binding)
          expect(isStorageDocumentOpen(binding)).toBe(true)
        }
      } finally {
        persistence.resolve(undefined)
        await closing
      }
    })
  }

  test('does not reuse an Untitled tab while another cloud document is still loading', async () => {
    createTab().store.state.documentName = 'Existing document'
    const downloaded = Promise.withResolvers<storageModule.StorageGetDocumentResult>()
    vi.spyOn(storageModule, 'createActiveStorageAdapter').mockReturnValue({
      getDocument: vi.fn(() => downloaded.promise)
    } as ReturnType<typeof storageModule.createActiveStorageAdapter>)
    const firstActivated = Promise.withResolvers<undefined>()
    const secondActivated = Promise.withResolvers<undefined>()
    const first = openStorageDocumentInNewTab(
      { id: 'untitled-first', name: 'Untitled', updatedAt: '2026-08-10T00:00:00.000Z' },
      undefined,
      { onTabActivated: () => firstActivated.resolve(undefined) }
    )
    await firstActivated.promise
    const firstStore = getActiveStore()
    const second = openStorageDocumentInNewTab(
      { id: 'untitled-second', name: 'Untitled', updatedAt: '2026-08-10T00:00:00.000Z' },
      undefined,
      { onTabActivated: () => secondActivated.resolve(undefined) }
    )
    await secondActivated.promise
    const secondStore = getActiveStore()
    expect(secondStore).not.toBe(firstStore)
    expect(firstStore.state.preparation?.kind).toBe('storage-open')
    const firstBinding = getOpeningStorageBinding(firstStore)
    const secondBinding = getOpeningStorageBinding(secondStore)
    if (!firstBinding || !secondBinding)
      throw new Error('Expected both cloud loads to own bindings')
    expect(firstBinding.documentId).toBe('untitled-first')
    expect(secondBinding.documentId).toBe('untitled-second')
    expect(isStorageDocumentOpen(firstBinding)).toBe(true)
    expect(isStorageDocumentOpen(secondBinding)).toBe(true)
    downloaded.resolve({
      bytes: new Uint8Array([1, 2, 3]),
      metadata: { name: 'Untitled', updatedAt: '2026-08-10T00:00:00.000Z' },
      remoteRevision: null
    })
    await Promise.all([settleFileOpen(first), settleFileOpen(second)])
    expect(firstStore.getStorageBinding()?.documentId).toBe('untitled-first')
    expect(secondStore.getStorageBinding()?.documentId).toBe('untitled-second')
    expect(getOpeningStorageBinding(firstStore)).toBeNull()
    expect(getOpeningStorageBinding(secondStore)).toBeNull()
  })

  test('does not reuse a cancelled Untitled cloud tab before its download settles', async () => {
    createTab().store.state.documentName = 'Existing document'
    const firstRequested = Promise.withResolvers<undefined>()
    const firstDownload = Promise.withResolvers<storageModule.StorageGetDocumentResult>()
    const getDocument = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      metadata: { name: 'Untitled', updatedAt: '2026-08-10T00:00:00.000Z' },
      remoteRevision: null
    }))
    getDocument.mockImplementationOnce(() => {
      firstRequested.resolve(undefined)
      return firstDownload.promise
    })
    vi.spyOn(storageModule, 'createActiveStorageAdapter').mockReturnValue({
      getDocument
    } as ReturnType<typeof storageModule.createActiveStorageAdapter>)
    const controller = new AbortController()
    const first = openStorageDocumentInNewTab(
      { id: 'cancelled-untitled', name: 'Untitled', updatedAt: '2026-08-10T00:00:00.000Z' },
      undefined,
      { signal: controller.signal }
    )
    const rejected = first.catch((reason: unknown) => reason)
    await firstRequested.promise
    const firstStore = getActiveStore()
    controller.abort()
    try {
      expect(firstStore.state.preparation).toBeNull()
      expect(getOpeningStorageBinding(firstStore)?.documentId).toBe('cancelled-untitled')
      await settleFileOpen(
        openStorageDocumentInNewTab({
          id: 'surviving-untitled',
          name: 'Untitled',
          updatedAt: '2026-08-10T00:00:00.000Z'
        })
      )
      expect(getActiveStore()).not.toBe(firstStore)
      expect(getActiveStore().getStorageBinding()?.documentId).toBe('surviving-untitled')
    } finally {
      firstDownload.reject(new DOMException('Delayed download cancellation', 'AbortError'))
      expect(await rejected).toHaveProperty('name', 'AbortError')
    }
    expect(getOpeningStorageBinding(firstStore)).toBeNull()
    expect(getActiveStore().getStorageBinding()?.documentId).toBe('surviving-untitled')
  })

  test('activates the cloud editor before download and still waits for presentation', async () => {
    const getDocument = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      metadata: { name: 'Presented cloud', updatedAt: '2026-08-10T00:00:00.000Z' },
      remoteRevision: null
    }))
    vi.spyOn(storageModule, 'createActiveStorageAdapter').mockReturnValue({
      getDocument
    } as ReturnType<typeof storageModule.createActiveStorageAdapter>)
    const activated = Promise.withResolvers<undefined>()
    const mounted = Promise.withResolvers<undefined>()
    const ready = Promise.withResolvers<undefined>()
    let completed = false
    const opening = openStorageDocumentInNewTab(
      {
        id: 'presentation-handoff',
        name: 'Presented cloud',
        updatedAt: '2026-08-10T00:00:00.000Z'
      },
      undefined,
      {
        reuseCurrentTab: false,
        onTabActivated: () => {
          activated.resolve(undefined)
          return mounted.promise
        }
      }
    ).then(() => {
      completed = true
      return undefined
    })
    await activated.promise
    const store = getActiveStore()
    expect(store.state.preparation?.kind).toBe('storage-open')
    expect(getOpeningStorageBinding(store)?.documentId).toBe('presentation-handoff')
    expect(getDocument).not.toHaveBeenCalled()
    const unbind = store.onPreparationEvent('preparation:updated', (preparation) => {
      if (preparation.phase === 'preparing-render') ready.resolve(undefined)
    })
    try {
      mounted.resolve(undefined)
      await ready.promise
      expect(completed).toBe(false)
      expect(store.state.preparation?.phase).toBe('preparing-render')
      store.preparationController.acknowledgePresentation(store.state.sceneVersion)
      await opening
      expect(store.state.preparation).toBeNull()
      expect(getOpeningStorageBinding(store)).toBeNull()
    } finally {
      unbind()
    }
  })

  test('cancelled editor navigation restores the prior tab without downloading or replacing its graph', async () => {
    const previous = createTab()
    previous.store.state.documentName = 'Previous document'
    const graph = previous.store.graph
    createTab().store.state.documentName = 'Another document'
    switchTab(previous.id)
    const count = tabCount()
    const getDocument = vi.fn()
    vi.spyOn(storageModule, 'createActiveStorageAdapter').mockReturnValue({
      getDocument
    } as ReturnType<typeof storageModule.createActiveStorageAdapter>)
    const controller = new AbortController()

    await expect(
      openStorageDocumentInNewTab(
        {
          id: 'navigation-cancelled',
          name: 'Cancelled cloud',
          updatedAt: '2026-08-10T00:00:00.000Z'
        },
        undefined,
        {
          signal: controller.signal,
          reuseCurrentTab: false,
          onTabActivated: () => {
            controller.abort()
            throw new DOMException('Navigation cancelled', 'AbortError')
          }
        }
      )
    ).rejects.toHaveProperty('name', 'AbortError')
    expect(getDocument).not.toHaveBeenCalled()
    expect(tabCount()).toBe(count)
    expect(getActiveStore()).toBe(previous.store)
    expect(previous.store.graph).toBe(graph)
    expect(previous.store.state.documentName).toBe('Previous document')
  })

  test('failed navigation to an existing cloud tab restores focus without closing the shared tab', async () => {
    vi.spyOn(storageModule, 'createActiveStorageAdapter').mockReturnValue({
      getDocument: vi.fn(async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        metadata: { name: 'Existing cloud', updatedAt: '2026-08-10T00:00:00.000Z' },
        remoteRevision: null
      }))
    } as ReturnType<typeof storageModule.createActiveStorageAdapter>)
    const document = {
      id: 'existing-navigation-failed',
      name: 'Existing cloud',
      updatedAt: '2026-08-10T00:00:00.000Z'
    }
    await settleFileOpen(openStorageDocumentInNewTab(document))
    const shared = getActiveStore()
    const previous = createTab()
    const count = tabCount()
    await expect(
      openStorageDocumentInNewTab(document, undefined, {
        onTabActivated: () => {
          throw new Error('Navigation failed')
        }
      })
    ).rejects.toThrow('Navigation failed')
    expect(getActiveStore()).toBe(previous.store)
    expect(tabCount()).toBe(count)
    expect(getTabsSnapshot().some((tab) => tab.store === shared)).toBe(true)
  })

  test('failed navigation to a pending cloud tab does not cancel its original open', async () => {
    const requested = Promise.withResolvers<undefined>()
    const downloaded = Promise.withResolvers<storageModule.StorageGetDocumentResult>()
    const getDocument = vi.fn(() => {
      requested.resolve(undefined)
      return downloaded.promise
    })
    vi.spyOn(storageModule, 'createActiveStorageAdapter').mockReturnValue({
      getDocument
    } as ReturnType<typeof storageModule.createActiveStorageAdapter>)
    const document = {
      id: 'pending-navigation-failed',
      name: 'Pending cloud',
      updatedAt: '2026-08-10T00:00:00.000Z'
    }
    const original = openStorageDocumentInNewTab(document, undefined, { reuseCurrentTab: false })
    await requested.promise
    const shared = getActiveStore()
    const previous = createTab()
    await expect(
      openStorageDocumentInNewTab(document, undefined, {
        onTabActivated: () => {
          throw new Error('Navigation failed')
        }
      })
    ).rejects.toThrow('Navigation failed')
    expect(getActiveStore()).toBe(previous.store)
    expect(shared.state.preparation?.kind).toBe('storage-open')
    expect(getDocument).toHaveBeenCalledTimes(1)
    downloaded.resolve({
      bytes: new Uint8Array([1, 2, 3]),
      metadata: { name: document.name, updatedAt: document.updatedAt },
      remoteRevision: null
    })
    await settleFileOpen(original)
    expect(shared.getStorageBinding()?.documentId).toBe(document.id)
  })

  test('closing a cloud tab does not steal focus selected while recovery persistence is pending', async () => {
    const requested = Promise.withResolvers<undefined>()
    vi.spyOn(storageModule, 'createActiveStorageAdapter').mockReturnValue({
      getDocument: vi.fn((_id: string, options?: storageModule.StorageTransferOptions) => {
        const signal = options?.signal
        if (!signal) throw new Error('Expected an abortable storage request')
        requested.resolve(undefined)
        return new Promise<storageModule.StorageGetDocumentResult>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true
          })
        })
      })
    } as ReturnType<typeof storageModule.createActiveStorageAdapter>)
    const previous = createTab()
    const selected = createTab()
    switchTab(previous.id)
    const opening = openStorageDocumentInNewTab(
      { id: 'cancel-focus', name: 'Cancel focus', updatedAt: '2026-08-10T00:00:00.000Z' },
      undefined,
      { reuseCurrentTab: false }
    )
    const rejected = opening.catch((reason: unknown) => reason)
    await requested.promise
    const cloud = getTabsSnapshot().find((tab) => tab.store === getActiveStore())
    if (!cloud) throw new Error('Expected cloud tab')
    expect(getOpeningStorageBinding(cloud.store)?.documentId).toBe('cancel-focus')
    const persistence = Promise.withResolvers<undefined>()
    vi.spyOn(cloud.store, 'persistRecoveryNow').mockReturnValue(persistence.promise)
    const closing = closeTab(cloud.id)
    expect(getOpeningStorageBinding(cloud.store)).toBeNull()
    switchTab(selected.id)
    persistence.resolve(undefined)
    await closing
    expect(await rejected).toHaveProperty('name', 'AbortError')
    expect(getOpeningStorageBinding(cloud.store)).toBeNull()
    expect(getActiveStore()).toBe(selected.store)
  })

  test('closing an inactive tab restores a surviving tab if selected during persistence', async () => {
    const closingTab = createTab()
    const survivor = createTab()
    const persistence = Promise.withResolvers<undefined>()
    vi.spyOn(closingTab.store, 'persistRecoveryNow').mockReturnValue(persistence.promise)
    const closing = closeTab(closingTab.id)
    switchTab(closingTab.id)
    persistence.resolve(undefined)
    await closing
    expect(getTabsSnapshot().some((tab) => tab.id === closingTab.id)).toBe(false)
    expect(getActiveStore()).toBe(survivor.store)
  })

  test('releases a parsed storage graph when cancellation wins before preparation', async () => {
    const imported = new SceneGraph()
    const terminate = trackGraphResource(imported)
    const parsing = Promise.withResolvers<SceneGraph>()
    const parsingStarted = Promise.withResolvers<undefined>()
    ;(figModule.readFigSource as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (source) => {
        await source.read()
        parsingStarted.resolve(undefined)
        return parsing.promise
      }
    )
    vi.spyOn(storageModule, 'createActiveStorageAdapter').mockReturnValue({
      getDocument: vi.fn(async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        metadata: { name: 'Cancelled.fig', updatedAt: '2026-08-10T00:00:00.000Z' },
        remoteRevision: null
      }))
    } as ReturnType<typeof storageModule.createActiveStorageAdapter>)
    const controller = new AbortController()
    const opening = openStorageDocumentInNewTab(
      {
        id: 'cancelled-after-parse',
        name: 'Cancelled.fig',
        updatedAt: '2026-08-10T00:00:00.000Z',
        metadataAuthoritative: true
      },
      undefined,
      { signal: controller.signal }
    )

    await parsingStarted.promise
    controller.abort()
    parsing.resolve(imported)

    await expect(opening).rejects.toHaveProperty('name', 'AbortError')
    expect(terminate).toHaveBeenCalledTimes(1)
  })
})
