import { shallowRef, computed, triggerRef } from 'vue'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { readFigFile, readFigSource } from '@open-pencil/core/io/formats/fig'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { setOpenPencilStore } from '@/app/browser-bridge'
import type { DocumentSourceIdentity } from '@/app/document/io/types'
import { setActiveEditorStore } from '@/app/editor/active-store'
import { createEditorStore } from '@/app/editor/session'
import type { EditorStore } from '@/app/editor/session'
import {
  activeStorageProviderID,
  createActiveStorageAdapter,
  type StorageDocument
} from '@/app/integrations/storage'
import { getLocalCanvasStore } from '@/app/storage/local-store'
import { seedStorageCanvasFromRemote } from '@/app/storage/sync/persist'
import { createFileOpenCoordinator } from '@/app/tabs/open/coordinator'
import {
  exactArrayBuffer,
  isDeferredOpenFile,
  type OpenFileSource
} from '@/app/tabs/open/file-source'
import { findTabByFileIdentity } from '@/app/tabs/open/identity'

export interface Tab {
  id: string
  store: EditorStore
}

const io = new IORegistry(BUILTIN_IO_FORMATS)
const fileOpenCoordinator = createFileOpenCoordinator()

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
  const tab: Tab = { id: generateTabId(), store: s }
  tabsRef.value = [...tabsRef.value, tab]
  activateTab(tab)
  return tab
}

function activateTab(tab: Tab) {
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

export function closeTab(tabId: string) {
  const idx = tabsRef.value.findIndex((t) => t.id === tabId)
  if (idx === -1) return

  const closingTab = tabsRef.value[idx]
  const wasActive = activeTabId.value === tabId
  tabsRef.value = tabsRef.value.filter((t) => t.id !== tabId)

  if (tabsRef.value.length === 0) {
    createTab()
    closingTab.store.dispose()
    return
  }

  if (wasActive) {
    const newIdx = Math.min(idx, tabsRef.value.length - 1)
    activateTab(tabsRef.value[newIdx])
  }

  closingTab.store.dispose()
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

function reusableTabStore(): EditorStore {
  const current = activeTab.value
  const isUntouched =
    current?.store.state.documentName === 'Untitled' && !current.store.undo.canUndo
  return isUntouched ? current.store : createTab().store
}

function findStorageTab(providerId: string, documentId: string): Tab | undefined {
  return tabsRef.value.find((tab) => {
    const binding = tab.store.getStorageBinding()
    return binding?.providerId === providerId && binding.documentId === documentId
  })
}

function storageOpenIdentity(providerId: string, documentId: string): DocumentSourceIdentity {
  return {
    handle: null,
    path: `storage://${encodeURIComponent(providerId)}/${encodeURIComponent(documentId)}`
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
      return { kind: 'existing' as const }
    }

    const store = reusableTabStore()
    store.state.documentName = documentName
    const finishLoading = store.beginLoading()
    const completion = Promise.withResolvers<undefined>()
    void completion.promise.catch(() => undefined)
    const pendingOpen = { completion: completion.promise, identity, store }
    fileOpenCoordinator.add(pendingOpen)
    return { kind: 'owner' as const, completion, finishLoading, pendingOpen, store }
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

  const { completion, finishLoading, pendingOpen, store } = decision
  try {
    await open(store)
    completion.resolve(undefined)
  } catch (error) {
    completion.reject(error)
    throw error
  } finally {
    finishLoading()
    fileOpenCoordinator.remove(pendingOpen)
  }
}

async function finishImportedGraphOpen(
  store: EditorStore,
  imported: SceneGraph,
  setSource: () => void
): Promise<void> {
  store.replaceGraph(imported)
  store.undo.clear()
  setSource()
  store.clearSelection()
  const pageId = store.graph.getPages()[0]?.id ?? store.graph.rootId
  await store.switchPage(pageId)
  await store.fitCurrentPageToViewport()
}

export async function openStorageDocumentInNewTab(document: StorageDocument): Promise<void> {
  const providerId = activeStorageProviderID.value
  const identity = storageOpenIdentity(providerId, document.id)
  const decision = await decideDocumentOpen(identity, document.name, () =>
    findStorageTab(providerId, document.id)
  )

  await completeDocumentOpen(decision, async (store) => {
    const local = getLocalCanvasStore()
    const localMetadata = await local.getMeta(document.id)
    const localBytes = localMetadata?.hasFig ? await local.readFig(document.id) : null
    const localIsAuthoritative =
      localMetadata?.syncStatus !== 'synced' ||
      !document.metadataAuthoritative ||
      localMetadata.updatedAt >= document.updatedAt
    let bytes = localBytes && localIsAuthoritative ? localBytes : null

    if (!bytes) {
      bytes = await createActiveStorageAdapter(providerId).getDocument(document.id)
      await seedStorageCanvasFromRemote({
        providerId,
        canvasId: document.id,
        name: document.name,
        updatedAt: document.updatedAt,
        figBytes: bytes
      })
    }

    let initialBytes: Uint8Array | null = bytes
    const imported = await readFigSource(
      {
        async read() {
          if (initialBytes) {
            const current = initialBytes
            initialBytes = null
            return current
          }
          const cached = await local.readFig(document.id)
          if (!cached) throw new Error('Cached .fig data is unavailable for parser recovery')
          return cached
        }
      },
      { populate: 'first-page' }
    )
    await finishImportedGraphOpen(store, imported, () => {
      store.setStorageDocumentSource({ providerId, documentId: document.id }, document.name)
    })
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
      imported = isDeferredOpenFile(file)
        ? await readFigSource(file, { populate: 'first-page' })
        : await readFigFile(file, { populate: 'first-page' })
      sourceFormat = 'fig'
    } else {
      const result = await io.readDocument({
        name: file.name,
        mimeType: file.type || undefined,
        data: await readDeferredFile(file)
      })
      imported = result.graph
      sourceFormat = result.sourceFormat
    }

    await finishImportedGraphOpen(store, imported, () => {
      store.setDocumentSource(file.name, sourceFormat, handle, path)
    })
  })
}

export function tabCount(): number {
  return tabsRef.value.length
}

export function useTabsStore() {
  return {
    tabs: allTabs,
    activeTabId,
    createTab,
    switchTab,
    closeTab,
    getActiveTabId,
    getTabById,
    getTabForStore,
    getTabsSnapshot,
    openFileInNewTab,
    openStorageDocumentInNewTab,
    getActiveStore,
    tabCount
  }
}
