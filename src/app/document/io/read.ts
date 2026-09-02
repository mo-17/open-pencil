import type { Editor, EditorState } from '@open-pencil/core/editor'
import { populateLazyFigImportRoots } from '@open-pencil/core/kiwi'
import type { computeAllLayoutsAsync } from '@open-pencil/core/layout'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { describeDiagnosticError, recordDocumentFailure } from '@/app/diagnostics'
import { yieldToUI } from '@/app/document/io/browser'
import { readFigDocument } from '@/app/document/io/fig'
import { applyImportedDocument } from '@/app/document/io/imported-document'
import { readReloadSource } from '@/app/document/io/reload-source'
import {
  captureReloadState,
  resolveReloadPageId,
  restoreReloadState
} from '@/app/document/io/reload-state'
import type { EditorPreparationController } from '@/app/editor/preparation/controller'
import type { EditorPreparationHandle } from '@/app/editor/preparation/types'
import { notificationMessages } from '@/app/i18n/notifications'
import { toast } from '@/app/shell/ui'

type OpenDocumentState = EditorState & {
  documentName: string
}

type ReloadDocumentState = EditorState & { documentName: string }

type OpenFigFileOptions = {
  editor: Editor
  state: OpenDocumentState
  setDocumentSource: (
    fileName: string,
    sourceFormat: string,
    handle?: FileSystemFileHandle,
    path?: string
  ) => void
  fitCurrentPageToViewport: () => Promise<void>
  preparationController: EditorPreparationController
}

type ReloadActionsOptions = {
  editor: Editor
  state: ReloadDocumentState
  getFilePath: () => string | null
  getFileHandle: () => FileSystemFileHandle | null
  setSavedVersion: (version: number) => void
  preparationController?: EditorPreparationController
}

type ReloadActionsDependencies = {
  readSource?: typeof readReloadSource
  computeLayouts?: typeof computeAllLayoutsAsync
}

export function createOpenActions({
  editor,
  state,
  setDocumentSource,
  fitCurrentPageToViewport,
  preparationController
}: OpenFigFileOptions) {
  async function openFigFile(file: File, handle?: FileSystemFileHandle, path?: string) {
    const load = preparationController.begin({ kind: 'document-open', subject: file.name })
    let succeeded = false
    try {
      load.update({ phase: 'reading', detail: file.name })
      await yieldToUI()
      load.update({ phase: 'decoding', detail: file.name })
      const imported = await readFigDocument(file, load.signal)
      await yieldToUI()
      load.update({ phase: 'materializing', detail: file.name })
      await applyImportedDocument(editor, imported, load)
      state.documentName = file.name.replace(/\.fig$/i, '')
      setDocumentSource(file.name, 'fig', handle, path)
      await fitCurrentPageToViewport()
      load.update({ phase: 'preparing-render', detail: state.documentName })
      editor.requestRender()
      succeeded = true
    } catch (e) {
      if (load.signal.aborted) return
      const diagnostic = describeDiagnosticError(e)
      load.fail({
        code: 'decode-failed',
        message: e instanceof Error ? e.message : String(e),
        retryable: diagnostic.retryable ?? true
      })
      recordDocumentFailure({
        operation: 'open',
        format: 'fig',
        ...diagnostic,
        retryable: diagnostic.retryable
      })
      console.error('Failed to open .fig file:', e)
      toast.error(
        notificationMessages.get().openFileFailed({
          name: file.name,
          error: e instanceof Error ? e.message : String(e)
        })
      )
    } finally {
      if (succeeded) load.complete()
    }
  }

  return { openFigFile }
}

export function createReloadActions(
  {
    editor,
    state,
    getFilePath,
    getFileHandle,
    setSavedVersion,
    preparationController
  }: ReloadActionsOptions,
  dependencies: ReloadActionsDependencies = {}
) {
  const readSource = dependencies.readSource ?? readReloadSource
  const computeLayouts = dependencies.computeLayouts
  let requestedReloadVersion = 0
  let handledReloadVersion = 0
  let runningReloadVersion = 0
  let reloadPromise: Promise<void> | null = null
  let activeReloadController: AbortController | null = null
  let activePreparation: EditorPreparationHandle | null = null

  function wasSuperseded(version: number, controller: AbortController) {
    return controller.signal.aborted || version !== requestedReloadVersion
  }

  function reportReloadFailure(load: EditorPreparationHandle, error: unknown) {
    const diagnostic = describeDiagnosticError(error)
    load.fail({
      code: 'decode-failed',
      message: error instanceof Error ? error.message : String(error),
      retryable: diagnostic.retryable ?? true
    })
    recordDocumentFailure({
      operation: 'open',
      format: 'fig',
      ...diagnostic,
      retryable: diagnostic.retryable
    })
    toast.error(
      notificationMessages.get().openFileFailed({
        name: state.documentName,
        error: error instanceof Error ? error.message : String(error)
      })
    )
  }

  async function runReloadLoop() {
    runningReloadVersion = requestedReloadVersion
    const finishLoading = preparationController ? null : editor.beginLoading()
    try {
      while (handledReloadVersion < requestedReloadVersion) {
        const reloadVersion = requestedReloadVersion
        runningReloadVersion = reloadVersion
        const controller = new AbortController()
        activeReloadController = controller
        const load = preparationController?.begin({
          kind: 'document-reload',
          subject: state.documentName
        })
        activePreparation = load ?? null
        const snapshot = captureReloadState(editor, state)
        const filePath = getFilePath()
        const fileHandle = getFileHandle()
        const signal = load?.signal ?? controller.signal

        let imported: SceneGraph | null | undefined
        let ownsImported = false
        try {
          try {
            load?.update({ phase: 'reading', detail: state.documentName })
            imported = await readSource({
              documentName: state.documentName,
              filePath,
              fileHandle,
              signal
            })
            ownsImported = imported !== null && imported !== undefined
          } catch (error) {
            if (wasSuperseded(reloadVersion, controller)) continue
            handledReloadVersion = reloadVersion
            if (load?.signal.aborted) continue
            if (load) {
              reportReloadFailure(load, error)
              continue
            }
            throw error
          }
          if (wasSuperseded(reloadVersion, controller)) continue
          if (load?.signal.aborted) {
            handledReloadVersion = reloadVersion
            continue
          }
          if (!imported) {
            handledReloadVersion = reloadVersion
            load?.complete()
            continue
          }

          const pageId = resolveReloadPageId(imported, snapshot)
          try {
            if (computeLayouts) {
              // Test and host injection path: retain the fork's explicit preparation seam.
              // Production uses applyImportedDocument's isolated staging editor below.
              load?.update({ phase: 'materializing', detail: state.documentName })
              populateLazyFigImportRoots(imported, [pageId])
              await computeLayouts(imported, pageId, signal)
              signal.throwIfAborted()
              const previousGraph = editor.graph
              try {
                editor.replaceGraph(imported, { currentPageId: pageId })
              } finally {
                if (editor.graph === imported) {
                  ownsImported = false
                  if (previousGraph !== imported) editor.releaseGraphResources(previousGraph)
                }
              }
              editor.undo.clear()
            } else {
              // applyImportedDocument consumes ownership: it either installs imported or releases it.
              ownsImported = false
              await applyImportedDocument(editor, imported, load, pageId)
            }
          } catch (error) {
            if (wasSuperseded(reloadVersion, controller)) continue
            handledReloadVersion = reloadVersion
            if (load?.signal.aborted) continue
            if (load) {
              reportReloadFailure(load, error)
              continue
            }
            throw error
          }
          if (wasSuperseded(reloadVersion, controller)) continue
          if (load?.signal.aborted) {
            handledReloadVersion = reloadVersion
            continue
          }

          restoreReloadState(editor, state, snapshot)
          load?.update({ phase: 'preparing-render', detail: state.documentName })
          editor.requestRender()
          setSavedVersion(state.sceneVersion)
          handledReloadVersion = reloadVersion
          load?.complete()
        } finally {
          if (ownsImported && imported) editor.releaseGraphResources(imported)
        }
      }
    } finally {
      activeReloadController = null
      activePreparation = null
      finishLoading?.()
    }
  }

  function ensureReloadLoop(): Promise<void> {
    if (!reloadPromise) {
      const pending = runReloadLoop()
      const tracked = pending
        .catch((error) => {
          // Cover unexpected setup/apply/cleanup failures as well as the explicitly guarded read
          // and layout steps. A newer settlement-gap request still has a larger version and will
          // start a fresh runner instead of inheriting this failure.
          handledReloadVersion = Math.max(handledReloadVersion, runningReloadVersion)
          throw error
        })
        .finally(() => {
          if (reloadPromise === tracked) reloadPromise = null
        })
      reloadPromise = tracked
    }
    return reloadPromise
  }

  async function waitForReloadVersion(reloadVersion: number): Promise<void> {
    if (handledReloadVersion >= reloadVersion) return
    try {
      await ensureReloadLoop()
    } catch (error) {
      if (handledReloadVersion >= reloadVersion) throw error
    }
    return waitForReloadVersion(reloadVersion)
  }

  function reloadFromDisk(): Promise<void> {
    const reloadVersion = ++requestedReloadVersion
    activeReloadController?.abort()
    activePreparation?.cancel('superseded')
    return waitForReloadVersion(reloadVersion)
  }

  return { reloadFromDisk }
}
