import type { Editor, EditorState } from '@open-pencil/core/editor'
import { populateLazyFigImportRoots } from '@open-pencil/core/kiwi'
import { computeAllLayoutsAsync } from '@open-pencil/core/layout'

import { yieldToUI } from '@/app/document/io/browser'
import { readFigDocument } from '@/app/document/io/fig'
import { applyImportedDocument } from '@/app/document/io/imported-document'
import { readReloadSource } from '@/app/document/io/reload-source'
import {
  captureReloadState,
  resolveReloadPageId,
  restoreReloadState
} from '@/app/document/io/reload-state'
import { notificationMessages } from '@/app/i18n/notifications'
import { toast } from '@/app/shell/ui'

type OpenDocumentState = EditorState & {
  documentName: string
  loading: boolean
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
}

type ReloadActionsOptions = {
  editor: Editor
  state: ReloadDocumentState
  getFilePath: () => string | null
  getFileHandle: () => FileSystemFileHandle | null
  setSavedVersion: (version: number) => void
}

type ReloadActionsDependencies = {
  readSource?: typeof readReloadSource
  computeLayouts?: typeof computeAllLayoutsAsync
}

export function createOpenActions({
  editor,
  state,
  setDocumentSource,
  fitCurrentPageToViewport
}: OpenFigFileOptions) {
  async function openFigFile(file: File, handle?: FileSystemFileHandle, path?: string) {
    const finishLoading = editor.beginLoading()
    try {
      await yieldToUI()
      const imported = await readFigDocument(file, editor)
      await yieldToUI()
      await applyImportedDocument(editor, imported)
      state.documentName = file.name.replace(/\.fig$/i, '')
      setDocumentSource(file.name, 'fig', handle, path)
      await fitCurrentPageToViewport()
    } catch (e) {
      console.error('Failed to open .fig file:', e)
      toast.error(
        notificationMessages.get().openFileFailed({
          name: file.name,
          error: e instanceof Error ? e.message : String(e)
        })
      )
    } finally {
      finishLoading()
    }
  }

  return { openFigFile }
}

export function createReloadActions(
  { editor, state, getFilePath, getFileHandle, setSavedVersion }: ReloadActionsOptions,
  dependencies: ReloadActionsDependencies = {}
) {
  const readSource = dependencies.readSource ?? readReloadSource
  const computeLayouts = dependencies.computeLayouts ?? computeAllLayoutsAsync
  let requestedReloadVersion = 0
  let handledReloadVersion = 0
  let runningReloadVersion = 0
  let reloadPromise: Promise<void> | null = null
  let activeReloadController: AbortController | null = null

  function wasSuperseded(version: number, controller: AbortController) {
    return controller.signal.aborted || version !== requestedReloadVersion
  }

  async function runReloadLoop() {
    runningReloadVersion = requestedReloadVersion
    const finishLoading = editor.beginLoading()
    try {
      while (handledReloadVersion < requestedReloadVersion) {
        const reloadVersion = requestedReloadVersion
        runningReloadVersion = reloadVersion
        const controller = new AbortController()
        activeReloadController = controller
        const snapshot = captureReloadState(editor, state)
        const filePath = getFilePath()
        const fileHandle = getFileHandle()

        let imported
        try {
          imported = await readSource({
            documentName: state.documentName,
            filePath,
            fileHandle
          })
        } catch (error) {
          if (wasSuperseded(reloadVersion, controller)) continue
          handledReloadVersion = reloadVersion
          throw error
        }
        if (wasSuperseded(reloadVersion, controller)) continue
        if (!imported) {
          handledReloadVersion = reloadVersion
          continue
        }

        const pageId = resolveReloadPageId(imported, snapshot)
        populateLazyFigImportRoots(imported, [pageId])
        try {
          await computeLayouts(imported, pageId, controller.signal)
        } catch (error) {
          if (wasSuperseded(reloadVersion, controller)) continue
          handledReloadVersion = reloadVersion
          throw error
        }
        if (wasSuperseded(reloadVersion, controller)) continue

        editor.replaceGraph(imported, { currentPageId: pageId })
        editor.undo.clear()
        restoreReloadState(editor, state, snapshot)
        setSavedVersion(state.sceneVersion)
        handledReloadVersion = reloadVersion
      }
    } finally {
      activeReloadController = null
      finishLoading()
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
    return waitForReloadVersion(reloadVersion)
  }

  return { reloadFromDisk }
}
