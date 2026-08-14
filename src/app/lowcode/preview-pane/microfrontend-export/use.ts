import { onScopeDispose, ref, type Ref } from 'vue'

import { exportFigFileWithOptions } from '@open-pencil/core/io/formats/fig'

import { getActiveEditorStore, type EditorStore } from '@/app/editor/active-store'
import { safeSourceProjectPackageName } from '@/app/plugins/host/source-project'
import { isTauri } from '@/app/tauri/env'

import type {
  MicrofrontendExportResult,
  MicrofrontendExportTarget,
  MicrofrontendExportUIKit
} from './command'
import {
  createMicrofrontendExportAbortError,
  isMicrofrontendExportAbortError,
  runMicrofrontendExportCLI
} from './runner'

export interface MicrofrontendExportInput {
  target: MicrofrontendExportTarget
  uiKit: MicrofrontendExportUIKit
  appId: string
  version: string
}

export type MicrofrontendExportStatus =
  | { kind: 'idle' }
  | { kind: 'choosing' }
  | { kind: 'snapshotting' }
  | { kind: 'building'; outDir: string }
  | { kind: 'cancelling' }
  | { kind: 'done'; result: MicrofrontendExportResult; cleanupWarning?: string }
  | { kind: 'error'; message: string }

interface UseMicrofrontendExportResult {
  status: Ref<MicrofrontendExportStatus>
  exportAvailable: boolean
  unavailableReason: string | null
  exportProject(input: MicrofrontendExportInput): Promise<void>
  cancel(): void
  reset(): void
}

type MicrofrontendSnapshot = Awaited<ReturnType<typeof writeCurrentDocumentSnapshot>>

interface MicrofrontendExportOperation {
  id: number
  store: EditorStore
  graph: EditorStore['graph']
  documentIdentity: string
  documentName: string
  invalidated: boolean
  snapshot: MicrofrontendSnapshot | null
  buildController: AbortController | null
  unbindGraphReplaced(): void
  unbindSourceChanged(): void
}

async function chooseOutputDirectory(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Choose an empty folder for the microfrontend build'
  })
  return typeof selected === 'string' ? selected : null
}

async function writeCurrentDocumentSnapshot(requestStore: EditorStore): Promise<{
  path: string
  cleanup(): Promise<void>
}> {
  const [{ join, tempDir }, { remove, writeFile }] = await Promise.all([
    import('@tauri-apps/api/path'),
    import('@tauri-apps/plugin-fs')
  ])
  const snapshotPath = await join(
    await tempDir(),
    `openpencil-microfrontend-${crypto.randomUUID()}.fig`
  )
  try {
    const data = await exportFigFileWithOptions(requestStore.graph, {
      renderer: requestStore.renderer ?? undefined,
      thumbnailPageId: requestStore.state.currentPageId,
      profile: 'figma-compatible'
    })
    await writeFile(snapshotPath, data)
  } catch (error) {
    try {
      await remove(snapshotPath)
    } catch (cleanupError) {
      const primary = error instanceof Error ? error.message : String(error)
      const cleanup = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      throw new Error(
        `${primary} The partial temporary snapshot could not be removed from ${snapshotPath}: ${cleanup}`
      )
    }
    throw error
  }
  return {
    path: snapshotPath,
    cleanup: () => remove(snapshotPath)
  }
}

export function useMicrofrontendExport(): UseMicrofrontendExportResult {
  const status = ref<MicrofrontendExportStatus>({ kind: 'idle' })
  const tauri = isTauri()
  const exportAvailable = tauri && import.meta.env.DEV
  let unavailableReason: string | null = null
  if (!tauri) {
    unavailableReason = 'Built microfrontend export is currently available in the desktop app only.'
  } else if (!import.meta.env.DEV) {
    unavailableReason =
      'Built microfrontend export currently requires a desktop development checkout with Bun and the OpenPencil CLI.'
  }
  let operation = 0
  let controller: AbortController | null = null
  let active = false

  function reset(): void {
    if (active) return
    status.value = { kind: 'idle' }
  }

  function cancel(): void {
    if (!active) return
    operation++
    controller?.abort()
    controller = null
    status.value = { kind: 'cancelling' }
  }

  function requestIsCurrent(request: MicrofrontendExportOperation): boolean {
    return (
      !request.invalidated &&
      request.store === getActiveEditorStore() &&
      request.store.graph === request.graph &&
      request.store.state.documentName === request.documentIdentity
    )
  }

  function assertRequestIsCurrent(request: MicrofrontendExportOperation): void {
    if (request.id !== operation || !requestIsCurrent(request)) {
      throw createMicrofrontendExportAbortError()
    }
  }

  async function runExportPipeline(
    request: MicrofrontendExportOperation,
    input: MicrofrontendExportInput
  ): Promise<MicrofrontendExportResult | null> {
    const outDir = await chooseOutputDirectory()
    assertRequestIsCurrent(request)
    if (!outDir) return null

    status.value = { kind: 'snapshotting' }
    request.snapshot = await writeCurrentDocumentSnapshot(request.store)
    assertRequestIsCurrent(request)

    request.buildController = new AbortController()
    controller = request.buildController
    status.value = { kind: 'building', outDir }
    const result = await runMicrofrontendExportCLI(
      {
        snapshotPath: request.snapshot.path,
        outDir,
        target: input.target,
        uiKit: input.target === 'react' ? input.uiKit : 'none',
        appId: input.appId,
        version: input.version,
        packageName: safeSourceProjectPackageName(request.documentName)
      },
      request.buildController.signal
    )
    assertRequestIsCurrent(request)
    return result
  }

  function handleExportError(request: MicrofrontendExportOperation, error: unknown): void {
    if (request.id !== operation || isMicrofrontendExportAbortError(error)) return
    if (!requestIsCurrent(request)) return
    status.value = {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error)
    }
  }

  async function finishExportOperation(request: MicrofrontendExportOperation): Promise<void> {
    if (controller === request.buildController) controller = null
    request.unbindGraphReplaced()
    request.unbindSourceChanged()
    let cleanupMessage: string | null = null
    try {
      await request.snapshot?.cleanup()
    } catch (cleanupError) {
      cleanupMessage = `The temporary design snapshot could not be removed from ${request.snapshot?.path}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
    }
    active = false
    if (cleanupMessage && !request.invalidated && request.store === getActiveEditorStore()) {
      if (status.value.kind === 'done') {
        status.value = { ...status.value, cleanupWarning: cleanupMessage }
      } else if (status.value.kind === 'error') {
        status.value = { kind: 'error', message: `${status.value.message} ${cleanupMessage}` }
      } else {
        status.value = { kind: 'error', message: cleanupMessage }
      }
    } else if (request.id !== operation) {
      status.value = { kind: 'idle' }
    }
  }

  async function exportProject(input: MicrofrontendExportInput): Promise<void> {
    if (active) return
    if (!exportAvailable) {
      status.value = {
        kind: 'error',
        message: unavailableReason ?? 'Built microfrontend export is unavailable.'
      }
      return
    }

    const store = getActiveEditorStore()
    const documentIdentity = store.state.documentName
    const request: MicrofrontendExportOperation = {
      id: ++operation,
      store,
      graph: store.graph,
      documentIdentity,
      documentName: documentIdentity || 'OpenPencil App',
      invalidated: false,
      snapshot: null,
      buildController: null,
      unbindGraphReplaced: () => undefined,
      unbindSourceChanged: () => undefined
    }
    active = true
    status.value = { kind: 'choosing' }
    const invalidateRequest = (): void => {
      request.invalidated = true
      cancel()
    }
    request.unbindGraphReplaced = store.onEditorEvent('graph:replaced', invalidateRequest)
    request.unbindSourceChanged = store.onSourceChanged(invalidateRequest)
    try {
      const result = await runExportPipeline(request, input)
      status.value = result ? { kind: 'done', result } : { kind: 'idle' }
    } catch (error) {
      handleExportError(request, error)
    } finally {
      await finishExportOperation(request)
    }
  }

  onScopeDispose(cancel)
  return { status, exportAvailable, unavailableReason, exportProject, cancel, reset }
}
