import { promiseTimeout } from '@vueuse/core'
import { shallowRef, computed, triggerRef } from 'vue'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { findFigThumbnailPageId, readFigSource } from '@open-pencil/core/io/formats/fig'
import { renderThumbnail } from '@open-pencil/core/io/formats/raster'
import { populateLazyFigImportRoots } from '@open-pencil/core/kiwi'
import { computeAllLayouts } from '@open-pencil/core/layout'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { setOpenPencilStore } from '@/app/browser-bridge'
import { readFigDocument, showFigPageManifest } from '@/app/document/io/fig'
import type { DocumentSourceIdentity } from '@/app/document/io/types'
import { getRecoveryStore, type RecoverySnapshotMeta } from '@/app/document/recovery'
import { setActiveEditorStore } from '@/app/editor/active-store'
import { createEditorStore } from '@/app/editor/session'
import type { EditorStore } from '@/app/editor/session'
import {
  activeStorageProviderID,
  createActiveStorageAdapter,
  readActiveStorageProfileID,
  resolveStorageDocumentBinding,
  storageDocumentAuthorityMatches,
  type StorageDocumentBindingInput,
  type StorageDocument,
  type StorageTransferOptions
} from '@/app/integrations/storage'
import {
  cacheRecentFileThumbnail,
  loadCachedRecentFileThumbnail,
  rememberRecentStorageDocument
} from '@/app/recent-files'
import { assertCloudStorageDurability } from '@/app/storage/durability'
import { getLocalCanvasStore } from '@/app/storage/local-store'
import { withStorageProfileMutationLease } from '@/app/storage/mutation-drain'
import { seedStorageCanvasFromRemote } from '@/app/storage/sync/persist'
import { createFileOpenCoordinator } from '@/app/tabs/open/coordinator'
import {
  exactArrayBuffer,
  isDeferredOpenFile,
  type OpenFileSource
} from '@/app/tabs/open/file-source'
import { findTabByFileIdentity } from '@/app/tabs/open/identity'

export type TabKind = 'home' | 'document'

export interface Tab {
  id: string
  store: EditorStore
  kind: TabKind
}

const io = new IORegistry(BUILTIN_IO_FORMATS)
const fileOpenCoordinator = createFileOpenCoordinator()
const RECENT_FILE_THUMBNAIL_SIZE = 512
const coverThumbnailListeners = new WeakMap<EditorStore, () => void>()

let nextTabId = 1

function generateTabId(): string {
  return `tab-${nextTabId++}`
}

const tabsRef = shallowRef<Tab[]>([])
const activeTabId = shallowRef('')

export const activeTab = computed(() => tabsRef.value.find((t) => t.id === activeTabId.value))

export const allTabs = computed(() =>
  tabsRef.value.map((t) => ({
    id: t.id,
    name: t.store.state.documentName,
    isHome: t.kind === 'home',
    isActive: t.id === activeTabId.value
  }))
)

export function getActiveStore(): EditorStore {
  const tab = tabsRef.value.find((t) => t.id === activeTabId.value)
  if (!tab) throw new Error('No active tab')
  return tab.store
}

export function getActiveTabId(): string {
  return activeTabId.value
}

export function getTabById(tabId: string): Tab | undefined {
  return tabsRef.value.find((tab) => tab.id === tabId)
}

export function getTabForStore(store: EditorStore): Tab | undefined {
  return tabsRef.value.find((tab) => tab.store === store)
}

export function getTabsSnapshot(): Tab[] {
  return [...tabsRef.value]
}

export function createTab(store?: EditorStore, initialGraph?: SceneGraph): Tab {
  const s = store ?? createEditorStore(initialGraph)
  const tab: Tab = { id: generateTabId(), store: s, kind: 'document' }
  tabsRef.value = [...tabsRef.value, tab]
  activateTab(tab)
  return tab
}

export function createHomeTab(): Tab {
  const tab: Tab = { id: generateTabId(), store: createEditorStore(), kind: 'home' }
  tabsRef.value = [...tabsRef.value, tab]
  activateTab(tab)
  return tab
}

export function leaveHome(tabId: string): void {
  const tabIndex = tabsRef.value.findIndex((candidate) => candidate.id === tabId)
  if (tabIndex === -1) return
  const tab = tabsRef.value[tabIndex]
  if (tab.kind !== 'home') return
  tabsRef.value = tabsRef.value.with(tabIndex, { ...tab, kind: 'document' })
}

export function createDocumentInCurrentTab(): Tab {
  const current = activeTab.value
  if (current?.kind !== 'home') return createTab()
  leaveHome(current.id)
  return getTabById(current.id) ?? current
}

export function showNewTab(): void {
  const homeTab = tabsRef.value.find((tab) => tab.kind === 'home')
  if (homeTab) {
    switchTab(homeTab.id)
    return
  }
  createHomeTab()
}

function activateTab(tab: Tab) {
  const previous = tabsRef.value.find((candidate) => candidate.id === activeTabId.value)
  previous?.store.setSnapGuides([])
  previous?.store.setLayoutInsertIndicator(null)
  previous?.store.setDropTarget(null)
  activeTabId.value = tab.id
  setActiveEditorStore(tab.store)
  triggerRef(tabsRef)
  setOpenPencilStore(tab.store)
}

export function switchTab(tabId: string) {
  const tab = tabsRef.value.find((t) => t.id === tabId)
  if (!tab) return
  activateTab(tab)
}

export async function closeTab(tabId: string): Promise<void> {
  const idx = tabsRef.value.findIndex((t) => t.id === tabId)
  if (idx === -1) return

  const closingTab = tabsRef.value[idx]
  if (closingTab.kind === 'home' && tabsRef.value.length === 1) return
  const wasActive = activeTabId.value === tabId
  coverThumbnailListeners.get(closingTab.store)?.()
  coverThumbnailListeners.delete(closingTab.store)
  await closingTab.store.persistRecoveryNow()
  closingTab.store.dispose()
  tabsRef.value = tabsRef.value.filter((t) => t.id !== tabId)

  if (tabsRef.value.length === 0) {
    createHomeTab()
    return
  }

  if (wasActive) {
    const newIdx = Math.min(idx, tabsRef.value.length - 1)
    activateTab(tabsRef.value[newIdx])
  }
}

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function isDOMImportFile(file: OpenFileSource): boolean {
  return /\.(html?|xhtml)$/i.test(file.name)
}

async function readDeferredFile(source: OpenFileSource): Promise<Uint8Array> {
  return isDeferredOpenFile(source) ? source.read() : new Uint8Array(await source.arrayBuffer())
}

async function openDOMSource(
  store: EditorStore,
  source: OpenFileSource,
  handle?: FileSystemFileHandle,
  path?: string
): Promise<void> {
  const file = isDeferredOpenFile(source)
    ? new File([exactArrayBuffer(await source.read())], source.name, { type: source.type })
    : source
  await store.openDOMFile(file, { handle, path })
}

function reusableTabStore(): { store: EditorStore; created: boolean } {
  const current = activeTab.value
  if (current?.kind === 'home') {
    leaveHome(current.id)
    return { store: current.store, created: false }
  }
  const isUntouched =
    current?.store.state.documentName === 'Untitled' && !current.store.undo.canUndo
  if (isUntouched) {
    leaveHome(current.id)
    return { store: current.store, created: false }
  }
  return { store: createTab().store, created: true }
}

function prepareFigGraphForTab(imported: SceneGraph): SceneGraph {
  const firstPageId = imported.getPages()[0]?.id
  if (firstPageId) computeAllLayouts(imported, firstPageId)
  const coverPageId = findFigThumbnailPageId(imported.getPages())
  if (coverPageId && coverPageId !== firstPageId) {
    populateLazyFigImportRoots(imported, [coverPageId])
    computeAllLayouts(imported, coverPageId)
  }
  return imported
}

async function readFigForTab(source: OpenFileSource, store: EditorStore): Promise<SceneGraph> {
  const imported = isDeferredOpenFile(source)
    ? await readFigSource(source, {
        populate: 'first-page',
        onPages: (pages) => showFigPageManifest(store, pages)
      })
    : await readFigDocument(source, store)
  return prepareFigGraphForTab(imported)
}

async function showImportedGraph(
  store: EditorStore,
  graph: SceneGraph,
  prepare?: () => void | Promise<void>
): Promise<void> {
  store.replaceGraph(graph)
  store.undo.clear()
  await prepare?.()
  store.clearSelection()
  const pageId = store.graph.getPages()[0]?.id ?? store.graph.rootId
  await store.switchPage(pageId)
  await store.fitCurrentPageToViewport()
}

async function cacheOpenedFigCover(path: string, store: EditorStore): Promise<void> {
  if (await loadCachedRecentFileThumbnail(path)) return
  const coverPageId = findFigThumbnailPageId(store.graph.getPages())
  if (!coverPageId) return
  for (let attempt = 0; attempt < 240 && !store.renderer; attempt++) {
    await promiseTimeout(250)
  }
  const renderer = store.renderer
  if (!renderer) {
    console.warn('[Recent files] Cover thumbnail skipped because the renderer was unavailable')
    return
  }
  const bytes = renderThumbnail(
    renderer.ck,
    renderer,
    store.graph,
    coverPageId,
    RECENT_FILE_THUMBNAIL_SIZE,
    RECENT_FILE_THUMBNAIL_SIZE
  )
  if (!bytes) {
    console.warn('[Recent files] Cover thumbnail skipped because the Cover page was empty')
    return
  }
  await cacheRecentFileThumbnail(path, bytes)
}

function watchOpenedFigCover(path: string, store: EditorStore): void {
  coverThumbnailListeners.get(store)?.()
  const coverPageId = findFigThumbnailPageId(store.graph.getPages())
  if (!coverPageId) return
  coverThumbnailListeners.set(
    store,
    store.onEditorEvent('page:changed', (pageId) => {
      if (pageId !== coverPageId) return
      void cacheOpenedFigCover(path, store).catch((error) => {
        console.warn('[Recent files] Failed to cache the Cover thumbnail', error)
      })
    })
  )
}

function storageOpenPath(binding: StorageDocumentBindingInput): string {
  const resolved = resolveStorageDocumentBinding(binding)
  return `storage://${[
    resolved.providerId,
    resolved.profileId,
    resolved.authority?.accountId ?? '',
    resolved.authority?.authorizationVersion ?? '',
    resolved.documentId
  ]
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}

function findStorageTab(binding: StorageDocumentBindingInput): Tab | undefined {
  const path = storageOpenPath(binding)
  return tabsRef.value.find((tab) => {
    const current = tab.store.getStorageBinding()
    return current ? storageOpenPath(current) === path : false
  })
}

function storageOpenIdentity(binding: StorageDocumentBindingInput): DocumentSourceIdentity {
  return {
    handle: null,
    path: storageOpenPath(binding)
  }
}

type ExistingTabLookup = () => Tab | null | undefined | Promise<Tab | null | undefined>

async function decideDocumentOpen(
  identity: DocumentSourceIdentity,
  documentName: string,
  findExisting: ExistingTabLookup
) {
  return fileOpenCoordinator.decide(async () => {
    const pending = await fileOpenCoordinator.findPending(identity)
    if (pending) {
      const tab = getTabForStore(pending.store)
      if (tab) switchTab(tab.id)
      return { kind: 'pending' as const, completion: pending.completion }
    }

    const existing = await findExisting()
    if (existing) {
      switchTab(existing.id)
      if (identity.path?.toLowerCase().endsWith('.fig')) {
        watchOpenedFigCover(identity.path, existing.store)
        void cacheOpenedFigCover(identity.path, existing.store).catch((error) => {
          console.warn('[Recent files] Failed to cache the Cover thumbnail', error)
        })
      }
      return { kind: 'existing' as const }
    }

    const { store, created } = reusableTabStore()
    store.state.documentName = documentName
    const finishLoading = store.beginLoading()
    const completion = Promise.withResolvers<undefined>()
    void completion.promise.catch(() => undefined)
    const pendingOpen = { completion: completion.promise, identity, store }
    fileOpenCoordinator.add(pendingOpen)
    return { kind: 'owner' as const, completion, finishLoading, pendingOpen, store, created }
  })
}

type DocumentOpenDecision = Awaited<ReturnType<typeof decideDocumentOpen>>

async function completeDocumentOpen(
  decision: DocumentOpenDecision,
  open: (store: EditorStore) => Promise<void>
): Promise<void> {
  if (decision.kind === 'existing') return
  if (decision.kind === 'pending') {
    await decision.completion
    return
  }

  const { completion, created, finishLoading, pendingOpen, store } = decision
  try {
    await open(store)
    completion.resolve(undefined)
  } catch (error) {
    completion.reject(error)
    if (created) {
      const tab = getTabForStore(store)
      if (tab) await closeTab(tab.id)
    }
    throw error
  } finally {
    finishLoading()
    fileOpenCoordinator.remove(pendingOpen)
  }
}

export async function openStorageDocumentInNewTab(
  document: StorageDocument,
  bindingInput?: StorageDocumentBindingInput,
  options: Pick<StorageTransferOptions, 'signal'> = {}
): Promise<void> {
  options.signal?.throwIfAborted()
  await assertCloudStorageDurability()
  options.signal?.throwIfAborted()
  const providerId = bindingInput?.providerId ?? activeStorageProviderID.value
  const profileId = bindingInput?.profileId ?? readActiveStorageProfileID(providerId)
  await withStorageProfileMutationLease({ providerId, profileId }, async () => {
    const adapter = createActiveStorageAdapter(providerId, profileId)
    const authority =
      bindingInput?.authority ??
      (await adapter.getAuthority?.({ signal: options.signal })) ??
      undefined
    const binding = resolveStorageDocumentBinding({
      providerId,
      profileId,
      documentId: document.id,
      ...(authority ? { authority } : {})
    })
    const identity = storageOpenIdentity(binding)
    const decision = await decideDocumentOpen(identity, document.name, () =>
      findStorageTab(binding)
    )

    await completeDocumentOpen(decision, async (store) => {
      options.signal?.throwIfAborted()
      const local = getLocalCanvasStore()
      const localMetadata = await local.getMeta(binding)
      const localBytes = localMetadata?.hasFig ? await local.readFig(binding) : null
      const localIsAuthoritative =
        localMetadata?.syncStatus !== 'synced' || localMetadata.updatedAt >= document.updatedAt
      let bytes = localBytes && localIsAuthoritative ? localBytes : null

      if (!bytes) {
        const currentAuthority = (await adapter.getAuthority?.({ signal: options.signal })) ?? null
        if (!storageDocumentAuthorityMatches(binding.authority, currentAuthority)) {
          throw new Error('Storage authorization changed while opening the document')
        }
        const downloaded = await adapter.getDocument(document.id, {
          ...options,
          ...(binding.authority ? { expectedAuthority: binding.authority } : {})
        })
        options.signal?.throwIfAborted()
        bytes = downloaded.bytes
        await seedStorageCanvasFromRemote({
          providerId: binding.providerId,
          profileId: binding.profileId,
          ...(binding.authority ? { authority: binding.authority } : {}),
          canvasId: document.id,
          name: downloaded.metadata.name,
          updatedAt: downloaded.metadata.updatedAt,
          figBytes: bytes,
          remoteRevision: downloaded.remoteRevision
        })
      }

      options.signal?.throwIfAborted()
      let initialBytes: Uint8Array | null = bytes
      const imported = await readFigSource(
        {
          size: bytes.byteLength,
          async read() {
            if (initialBytes) {
              const current = initialBytes
              initialBytes = null
              return current
            }
            const cached = await local.readFig(binding)
            if (!cached) throw new Error('Cached .fig data is unavailable for parser recovery')
            return cached
          }
        },
        {
          populate: 'first-page',
          signal: options.signal,
          onPages: (pages) => showFigPageManifest(store, pages)
        }
      )
      options.signal?.throwIfAborted()
      await showImportedGraph(store, prepareFigGraphForTab(imported), () => {
        store.setStorageDocumentSource(binding, document.name)
      })
    })
    rememberRecentStorageDocument(providerId, document.id, document.name)
  })
}

export async function openFileInNewTab(
  file: OpenFileSource,
  handle?: FileSystemFileHandle,
  path?: string
): Promise<void> {
  const identity: DocumentSourceIdentity = {
    handle: handle ?? null,
    path: path ?? null
  }
  const decision = await decideDocumentOpen(identity, file.name.replace(/\.[^.]+$/i, ''), () =>
    findTabByFileIdentity(tabsRef.value, identity)
  )

  await completeDocumentOpen(decision, async (store) => {
    if (isDOMImportFile(file)) {
      await openDOMSource(store, file, handle, path)
      return
    }

    await yieldToUI()
    const isFig = file.name.toLowerCase().endsWith('.fig')
    let imported: SceneGraph
    let sourceFormat: string
    if (isFig) {
      imported = await readFigForTab(file, store)
      sourceFormat = 'fig'
    } else {
      const result = await io.readDocument({
        name: file.name,
        mimeType: file.type || undefined,
        data: await readDeferredFile(file)
      })
      imported = result.graph
      sourceFormat = result.sourceFormat
      const firstPageId = imported.getPages()[0]?.id
      if (firstPageId) computeAllLayouts(imported, firstPageId)
    }

    await showImportedGraph(store, imported, () => {
      store.setDocumentSource(file.name, sourceFormat, handle, path)
      if (isFig && path) watchOpenedFigCover(path, store)
    })
    if (isFig && path) {
      void cacheOpenedFigCover(path, store).catch((error) => {
        console.warn('[Recent files] Failed to cache the Cover thumbnail', error)
      })
    }
  })
}

export async function listRecoverySnapshots(): Promise<RecoverySnapshotMeta[]> {
  return getRecoveryStore().list()
}

export async function discardRecoverySnapshot(id: string): Promise<void> {
  await getRecoveryStore().remove(id)
}

export async function restoreRecoverySnapshot(id: string): Promise<void> {
  const snapshot = await getRecoveryStore().read(id)
  if (!snapshot) throw new Error('Recovery snapshot is no longer available')

  const { store, created } = reusableTabStore()
  const finishLoading = store.beginLoading()
  try {
    const fileBytes = new Uint8Array(snapshot.figBytes)
    const file = new File([fileBytes.buffer], `${snapshot.documentName}.fig`, {
      type: 'application/octet-stream'
    })
    const imported = await readFigForTab(file, store)

    await showImportedGraph(store, imported, async () => {
      store.state.documentName = snapshot.documentName
      await store.adoptRecoverySnapshot(id, snapshot.sceneVersion)
    })
  } catch (error) {
    if (created) {
      const tab = getTabForStore(store)
      if (tab) await closeTab(tab.id)
    }
    throw error
  } finally {
    finishLoading()
  }
}

export async function prepareForReload(): Promise<void> {
  await Promise.all(tabsRef.value.map((tab) => tab.store.persistRecoveryNow()))
}

export function tabCount(): number {
  return tabsRef.value.length
}

export function useTabsStore() {
  return {
    tabs: allTabs,
    activeTabId,
    createHomeTab,
    createDocumentInCurrentTab,
    createTab,
    leaveHome,
    switchTab,
    closeTab,
    getActiveTabId,
    getTabById,
    getTabForStore,
    getTabsSnapshot,
    openFileInNewTab,
    openStorageDocumentInNewTab,
    listRecoverySnapshots,
    restoreRecoverySnapshot,
    discardRecoverySnapshot,
    prepareForReload,
    getActiveStore,
    tabCount
  }
}
