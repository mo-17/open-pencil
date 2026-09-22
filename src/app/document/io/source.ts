import type { Editor, EditorState } from '@open-pencil/core/editor'
import { exportFigFile, exportFigFileWithOptions } from '@open-pencil/core/io/formats/fig'

import { createAutosave } from '@/app/document/autosave'
import { createDocumentChanges } from '@/app/document/io/changes'
import {
  documentNameFromFigPath,
  downloadNameFromPath,
  figDownloadName
} from '@/app/document/io/names'
import { createSaveActions } from '@/app/document/io/save'
import { createDocumentSourceState } from '@/app/document/io/source-state'
import type { DocumentSourceAccess } from '@/app/document/io/types'
import type { DocumentWriteOptions } from '@/app/document/io/write'
import { createDocumentRecovery } from '@/app/document/recovery'
import { recoveryEnabled } from '@/app/document/recovery/preferences'
import {
  resolveStorageDocumentBinding,
  type StorageDocumentBindingInput
} from '@/app/integrations/storage/types'

type DocumentSourceState = EditorState & {
  documentName: string
  autosaveEnabled: boolean
}

export { createDocumentSourceState }

type DocumentSourceOptions = DocumentSourceAccess & {
  editor: Editor
  state: DocumentSourceState
  stopWatchingFile: () => void
  startWatchingFile: () => Promise<void>
  getRenderer: () => Editor['renderer']
}

export function createDocumentSourceActions({
  editor,
  state,
  stopWatchingFile,
  startWatchingFile,
  getFileHandle,
  setFileHandle,
  getFilePath,
  setFilePath,
  getDownloadName,
  setDownloadName,
  getStorageBinding,
  setStorageBinding,
  setSourceIdentity,
  getSourceRevision,
  markSourceChanged,
  getSavedVersion,
  setSavedVersion,
  setLastWriteTime,
  getRenderer
}: DocumentSourceOptions) {
  const changes = createDocumentChanges(editor)

  async function saveAndTrack(save: () => Promise<boolean>) {
    const revision = changes.capture()
    const saved = await save()
    if (saved) changes.markSaved(revision)
    return saved
  }

  async function buildFigFile() {
    const sceneVersion = state.sceneVersion
    const data = await exportFigFileWithOptions(editor.graph, {
      renderer: getRenderer() ?? undefined,
      thumbnailPageId: state.currentPageId,
      profile: 'figma-compatible'
    })
    return { data, sceneVersion }
  }

  function buildRecoveryFigFile() {
    return exportFigFile(editor.graph, undefined, undefined, state.currentPageId)
  }

  const recovery = createDocumentRecovery({
    state,
    isEnabled: () => recoveryEnabled.value,
    buildFigFile: buildRecoveryFigFile,
    hasWritableSource: () => !!getFileHandle() || !!getFilePath() || !!getStorageBinding()
  })

  const { saveFigFile, saveFigFileAs, getSaveStatus, disposeSaveActions } = createSaveActions({
    state,
    buildFigFile,
    getFilePath,
    setFilePath,
    getFileHandle,
    setFileHandle,
    getDownloadName,
    setDownloadName,
    getStorageBinding,
    setStorageBinding,
    setSourceIdentity,
    getSourceRevision,
    markSourceChanged,
    setSavedVersion,
    setLastWriteTime,
    startWatchingFile: () => {
      void startWatchingFile()
    },
    onWriteSuccess: (version) => recovery.markProtectedVersion(version),
    onDownloadSuccess: (version) => recovery.markProtectedVersion(version)
  })

  const autosave = createAutosave({
    state,
    getSavedVersion,
    hasWritableSource: () => !!getFileHandle() || !!getFilePath() || !!getStorageBinding(),
    saveCurrentDocument: async () => {
      await saveAndTrack(saveFigFile)
    }
  })

  function setDocumentSource(
    fileName: string,
    sourceFormat: string,
    handle?: FileSystemFileHandle,
    path?: string
  ) {
    stopWatchingFile()
    setStorageBinding(null)
    const isFig = sourceFormat === 'fig'
    setFileHandle(isFig ? (handle ?? null) : null)
    setFilePath(isFig ? (path ?? null) : null)
    setDownloadName(figDownloadName(fileName, sourceFormat))
    setSourceIdentity({ handle: handle ?? null, path: path ?? null })
    markSourceChanged()
    setLastWriteTime(0)
    setSavedVersion(state.sceneVersion)
    changes.markSaved()
    void recovery.markProtectedVersion(state.sceneVersion, true)
    if (isFig && (handle || path)) void startWatchingFile()
  }

  function setStorageDocumentSource(binding: StorageDocumentBindingInput, documentName: string) {
    stopWatchingFile()
    setFileHandle(null)
    setFilePath(null)
    setDownloadName(`${documentName}.fig`)
    setSourceIdentity({ handle: null, path: null })
    setStorageBinding(resolveStorageDocumentBinding(binding))
    state.documentName = documentName
    state.autosaveEnabled = true
    markSourceChanged()
    setLastWriteTime(0)
    setSavedVersion(state.sceneVersion)
    changes.markSaved()
    void recovery.markProtectedVersion(state.sceneVersion, true)
  }

  function setPlannedFilePath(path: string) {
    stopWatchingFile()
    setStorageBinding(null)
    setFileHandle(null)
    setFilePath(path)
    const downloadName = downloadNameFromPath(path)
    setDownloadName(downloadName)
    state.documentName = documentNameFromFigPath(downloadName)
    markSourceChanged()
    setLastWriteTime(0)
  }

  function startWatchingCurrentFile() {
    void startWatchingFile()
  }

  function disposeDocumentIO() {
    disposeSaveActions()
    changes.dispose()
    stopWatchingFile()
    autosave.disposeAutosave()
    recovery.disposeRecovery()
  }

  return {
    buildFigFileSnapshot: buildFigFile,
    setDocumentSource,
    setStorageDocumentSource,
    setPlannedFilePath,
    startWatchingCurrentFile,
    disposeDocumentIO,
    saveFigFile: (options?: DocumentWriteOptions) => saveAndTrack(() => saveFigFile(options)),
    saveFigFileAs: () => saveAndTrack(saveFigFileAs),
    hasUnsavedChanges: changes.hasUnsavedChanges,
    markDocumentSaved: changes.markSaved,
    getStorageBinding,
    getSaveStatus,
    getRecoveryStatus: () => recovery.getRecoveryStatus(),
    getRecoveryId: () => recovery.getRecoveryId(),
    adoptRecoverySnapshot: (id: string, version: number, updatedAt?: string) => {
      changes.markChanged()
      return recovery.adoptRecoverySnapshot(id, version, updatedAt)
    },
    persistRecoveryNow: () => recovery.persistNow(),
    discardRecovery: () => recovery.discardRecovery()
  }
}
