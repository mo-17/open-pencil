import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'

import { computeAllLayouts } from '@open-pencil/core/layout'
import {
  acceptLibraryUpdate,
  ensureLibraryCachePage,
  importLibraryComponent,
  type LibraryComponentManifestEntry,
  type LibraryManifest,
  type LibrarySource,
  type SceneGraph
} from '@open-pencil/scene-graph'
import { useI18n, useSceneComputed } from '@open-pencil/vue'

import {
  getActiveEditorStore,
  useActiveEditorStoreRef,
  useEditorStore
} from '@/app/editor/active-store'
import {
  libraryPanelRows,
  parseLibraryManifestText,
  readLibraryGraphFile,
  type LibraryPanelStatus
} from '@/app/lowcode/libraries'
import {
  loadRemoteLibraryCandidate,
  parseRemoteLibraryURL
} from '@/app/lowcode/remote-library-source'

interface StagedRemoteLibrary {
  manifestURL: string
  manifest: LibraryManifest
  sourceGraph: SceneGraph
  artifact: { url: string }
}

type BusyOperation = 'local' | 'loading' | 'checking' | 'importing' | 'accepting'
type MutationResult = { component: { key: string }; warnings?: string[] } | { error: string }

export function useLibrariesPanel() {
  const editor = useEditorStore()
  const activeEditor = useActiveEditorStoreRef()
  const { panels } = useI18n()
  const manifest = ref<LibraryManifest | null>(null)
  const libraryGraph = shallowRef<SceneGraph | null>(null)
  const remoteCandidate = shallowRef<StagedRemoteLibrary | null>(null)
  const manifestName = ref('')
  const libraryName = ref('')
  const remoteURL = ref('')
  const remoteURLTouched = ref(false)
  const manifestError = ref('')
  const libraryError = ref('')
  const operationError = ref('')
  const statusMessage = ref('')
  const busyOperation = ref<BusyOperation | null>(null)
  const busyComponentKey = ref('')
  const busyLibraryId = ref('')

  let operationToken = 0
  let activeController: AbortController | null = null

  const activeManifest = computed(() => remoteCandidate.value?.manifest ?? manifest.value)
  const activeLibraryGraph = computed(
    () => remoteCandidate.value?.sourceGraph ?? libraryGraph.value
  )
  const rows = useSceneComputed(() => {
    const active = activeManifest.value
    return libraryPanelRows(editor.graph, active).map((row) =>
      active && row.libraryId !== active.libraryId
        ? {
            ...row,
            currentVersion: importedComponentVersion(row.libraryId, row.componentKey),
            latestVersion: undefined,
            status: 'unknown' as const
          }
        : row
    )
  })
  const candidateComponents = useSceneComputed(() => {
    const candidate = remoteCandidate.value
    if (!candidate) return []
    return candidate.manifest.components.filter(
      (component) => !isComponentImported(candidate.manifest.libraryId, component.key)
    )
  })
  const hasLibraries = computed(() => rows.value.length > 0)
  const isBusy = computed(() => busyOperation.value !== null)
  const isMutationBusy = computed(
    () => busyOperation.value === 'importing' || busyOperation.value === 'accepting'
  )
  const remoteURLInvalid = computed(
    () => remoteURLTouched.value && !parseRemoteHTTPSURL(remoteURL.value)
  )

  async function loadManifest(event: Event): Promise<void> {
    await loadLocalFile(
      event,
      (file) => file.text().then(parseLibraryManifestText),
      (value, file) => {
        manifest.value = value
        manifestName.value = file.name
      },
      (error) => {
        manifest.value = null
        manifestName.value = ''
        manifestError.value = error
      }
    )
  }

  async function loadLibrary(event: Event): Promise<void> {
    await loadLocalFile(
      event,
      readLibraryGraphFile,
      (value, file) => {
        libraryGraph.value = value
        libraryName.value = file.name
      },
      (error) => {
        libraryGraph.value = null
        libraryName.value = ''
        libraryError.value = error
      }
    )
  }

  async function loadLocalFile<T>(
    event: Event,
    read: (file: File) => Promise<T>,
    apply: (value: T, file: File) => void,
    reject: (message: string) => void
  ): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file || isMutationBusy.value) return
    const token = beginReadOperation('local')
    clearMessages()
    remoteCandidate.value = null
    try {
      const value = await read(file)
      if (token !== operationToken) return
      apply(value, file)
    } catch (error) {
      if (token !== operationToken) return
      reject(errorMessage(error))
    } finally {
      finishReadOperation(token)
    }
  }

  async function loadRemoteURL(): Promise<void> {
    remoteURLTouched.value = true
    const url = parseRemoteHTTPSURL(remoteURL.value)
    if (!url) {
      operationError.value = panels.value.lowcodeLibrariesRemoteManifestUrlInvalid
      return
    }
    await stageRemoteCandidate(url.href, 'loading')
  }

  async function checkLibrary(libraryId: string): Promise<void> {
    const url = manifestSourceURL(libraryId)
    if (!url) return
    remoteURL.value = url
    remoteURLTouched.value = false
    await stageRemoteCandidate(url, 'checking', libraryId)
  }

  async function stageRemoteCandidate(
    url: string,
    operation: Extract<BusyOperation, 'loading' | 'checking'>,
    expectedLibraryId?: string
  ): Promise<void> {
    if (isMutationBusy.value) return
    const { controller, token } = beginRemoteOperation(operation, expectedLibraryId ?? '')
    clearMessages()
    manifest.value = null
    libraryGraph.value = null
    manifestName.value = ''
    libraryName.value = ''
    remoteCandidate.value = null
    statusMessage.value =
      operation === 'checking'
        ? panels.value.lowcodeLibrariesChecking
        : panels.value.lowcodeLibrariesLoadingRemote

    try {
      const candidate = await loadRemoteLibraryCandidate(url, { signal: controller.signal })
      if (token !== operationToken) return
      if (expectedLibraryId && candidate.manifest.libraryId !== expectedLibraryId) {
        throw new Error(
          panels.value.lowcodeLibrariesLibraryMismatch({
            expected: expectedLibraryId,
            actual: candidate.manifest.libraryId
          })
        )
      }
      remoteCandidate.value = candidate
      remoteURL.value = candidate.manifestURL
      remoteURLTouched.value = false
      statusMessage.value = panels.value.lowcodeLibrariesRemoteReady({
        name: candidate.manifest.name,
        count: String(candidate.manifest.components.length)
      })
    } catch (error) {
      if (token !== operationToken || controller.signal.aborted) return
      statusMessage.value = ''
      operationError.value = errorMessage(error)
    } finally {
      finishReadOperation(token)
    }
  }

  function importCandidateComponent(component: LibraryComponentManifestEntry): void {
    const candidate = remoteCandidate.value
    if (!candidate || isComponentImported(candidate.manifest.libraryId, component.key)) return
    const manifestSource = remoteManifestSource(candidate)
    runGraphMutation('importing', component.key, (targetGraph) => {
      const cachePage = ensureLibraryCachePage(targetGraph)
      return importLibraryComponent({
        sourceGraph: candidate.sourceGraph,
        targetGraph,
        manifest: candidate.manifest,
        componentKey: component.key,
        parentId: cachePage.id,
        source: { kind: 'url', ref: candidate.artifact.url },
        manifestSource
      })
    })
  }

  function acceptUpdate(componentKey: string): void {
    const currentManifest = activeManifest.value
    const sourceGraph = activeLibraryGraph.value
    if (!currentManifest || !sourceGraph) return
    const candidate = remoteCandidate.value
    runGraphMutation('accepting', componentKey, (targetGraph) =>
      acceptLibraryUpdate({
        sourceGraph,
        targetGraph,
        manifest: currentManifest,
        componentKey,
        ...(candidate ? { manifestSource: remoteManifestSource(candidate) } : {})
      })
    )
  }

  function runGraphMutation(
    operation: Extract<BusyOperation, 'importing' | 'accepting'>,
    componentKey: string,
    mutate: (targetGraph: SceneGraph) => MutationResult
  ): void {
    if (isBusy.value) return
    cancelActiveOperation()
    busyOperation.value = operation
    busyComponentKey.value = componentKey
    clearMessages()
    statusMessage.value =
      operation === 'importing'
        ? panels.value.lowcodeLibrariesImporting({ componentKey })
        : panels.value.lowcodeLibrariesAccepting({ componentKey })

    const targetGraph = getActiveEditorStore().graph
    const before = editor.snapshotDocument()
    try {
      const result = mutate(targetGraph)
      if ('error' in result) throw new Error(result.error)
      computeAllLayouts(targetGraph, editor.state.currentPageId)
      editor.requestRender()
      const after = editor.snapshotDocument()
      editor.pushUndoEntry({
        label:
          operation === 'importing'
            ? panels.value.lowcodeLibrariesImportUndo
            : panels.value.lowcodeLibrariesAcceptUndo,
        forward: () => editor.restoreDocumentFromSnapshot(after),
        inverse: () => editor.restoreDocumentFromSnapshot(before)
      })
      statusMessage.value = mutationSuccessMessage(operation, componentKey, result.warnings ?? [])
    } catch (error) {
      editor.restoreDocumentFromSnapshot(before)
      statusMessage.value = ''
      operationError.value = errorMessage(error)
    } finally {
      busyOperation.value = null
      busyComponentKey.value = ''
    }
  }

  function mutationSuccessMessage(
    operation: Extract<BusyOperation, 'importing' | 'accepting'>,
    componentKey: string,
    warnings: string[]
  ): string {
    if (operation === 'importing') {
      return panels.value.lowcodeLibrariesImported({ componentKey })
    }
    return warnings.length > 0
      ? panels.value.lowcodeLibrariesAcceptedWithWarnings({
          componentKey,
          warnings: warnings.join(' ')
        })
      : panels.value.lowcodeLibrariesAccepted({ componentKey })
  }

  function beginReadOperation(operation: BusyOperation): number {
    cancelActiveOperation()
    busyOperation.value = operation
    return operationToken
  }

  function beginRemoteOperation(
    operation: Extract<BusyOperation, 'loading' | 'checking'>,
    libraryId: string
  ): { controller: AbortController; token: number } {
    const token = beginReadOperation(operation)
    const controller = new AbortController()
    activeController = controller
    busyLibraryId.value = libraryId
    return { controller, token }
  }

  function finishReadOperation(token: number): void {
    if (token !== operationToken) return
    activeController = null
    busyOperation.value = null
    busyLibraryId.value = ''
  }

  function cancelActiveOperation(): void {
    operationToken += 1
    activeController?.abort()
    activeController = null
    busyOperation.value = null
    busyComponentKey.value = ''
    busyLibraryId.value = ''
  }

  function clearMessages(): void {
    manifestError.value = ''
    libraryError.value = ''
    operationError.value = ''
    statusMessage.value = ''
  }

  function clearStagedSources(): void {
    manifest.value = null
    libraryGraph.value = null
    remoteCandidate.value = null
    manifestName.value = ''
    libraryName.value = ''
    remoteURL.value = ''
    remoteURLTouched.value = false
  }

  function handleRemoteURLInput(): void {
    operationError.value = ''
    statusMessage.value = ''
  }

  function parseRemoteHTTPSURL(value: string): URL | null {
    try {
      return parseRemoteLibraryURL(value.trim())
    } catch {
      return null
    }
  }

  function remoteManifestSource(candidate: StagedRemoteLibrary): LibrarySource {
    return { kind: 'url', ref: candidate.manifestURL }
  }

  function isComponentImported(libraryId: string, componentKey: string): boolean {
    const root = editor.graph.getNode(editor.graph.rootId)
    return !!root?.lowcodeLibraries
      ?.find((library) => library.libraryId === libraryId)
      ?.importedComponents.some((component) => component.key === componentKey)
  }

  function importedComponentVersion(libraryId: string, componentKey: string): string | undefined {
    const root = editor.graph.getNode(editor.graph.rootId)
    return root?.lowcodeLibraries
      ?.find((library) => library.libraryId === libraryId)
      ?.importedComponents.find((component) => component.key === componentKey)?.version
  }

  function manifestSourceURL(libraryId: string): string | undefined {
    const root = editor.graph.getNode(editor.graph.rootId)
    const source = root?.lowcodeLibraries?.find(
      (library) => library.libraryId === libraryId
    )?.manifestSource
    return source?.kind === 'url' ? source.ref : undefined
  }

  function canAccept(row: { libraryId: string; status: LibraryPanelStatus }): boolean {
    return (
      row.status === 'outdated' &&
      activeManifest.value?.libraryId === row.libraryId &&
      !!activeLibraryGraph.value &&
      !isBusy.value
    )
  }

  function statusClass(status: LibraryPanelStatus): string {
    switch (status) {
      case 'outdated':
        return 'text-amber-400'
      case 'up-to-date':
        return 'text-emerald-400'
      case 'missing-manifest':
      case 'missing-cached-master':
        return 'text-red-400'
      default:
        return 'text-muted'
    }
  }

  function statusLabel(status: LibraryPanelStatus): string {
    switch (status) {
      case 'outdated':
        return panels.value.lowcodeLibrariesStatusOutdated
      case 'up-to-date':
        return panels.value.lowcodeLibrariesStatusUpToDate
      case 'missing-manifest':
        return panels.value.lowcodeLibrariesStatusMissingManifest
      case 'missing-cached-master':
        return panels.value.lowcodeLibrariesStatusMissingCachedMaster
      default:
        return panels.value.lowcodeLibrariesStatusUnknown
    }
  }

  watch(
    activeEditor,
    () => {
      cancelActiveOperation()
      clearStagedSources()
      clearMessages()
    },
    { flush: 'sync' }
  )
  onScopeDispose(cancelActiveOperation)
  return {
    acceptUpdate,
    busyComponentKey,
    busyLibraryId,
    busyOperation,
    candidateComponents,
    canAccept,
    checkLibrary,
    handleRemoteURLInput,
    hasLibraries,
    importCandidateComponent,
    isBusy,
    isMutationBusy,
    libraryError,
    libraryName,
    loadLibrary,
    loadManifest,
    loadRemoteURL,
    manifestError,
    manifestName,
    manifestSourceURL,
    operationError,
    panels,
    remoteCandidate,
    remoteURL,
    remoteURLInvalid,
    remoteURLTouched,
    rows,
    statusClass,
    statusLabel,
    statusMessage
  }
}

export type LibrariesPanelController = ReturnType<typeof useLibrariesPanel>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
