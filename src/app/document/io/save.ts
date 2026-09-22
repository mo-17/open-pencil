import { shallowRef } from 'vue'

import type { EditorState } from '@open-pencil/core/editor'
import { filesMessages } from '@open-pencil/vue'

import { downloadBlob } from '@/app/document/io/browser'
import { supportsFileSystemAccess } from '@/app/document/io/capability'
import { documentNameFromFigPath } from '@/app/document/io/names'
import { chooseBrowserFigSaveHandle, chooseTauriFigSavePath } from '@/app/document/io/save-targets'
import type { DocumentSourceAccess } from '@/app/document/io/types'
import {
  createDocumentWriter,
  type DocumentWriteOptions,
  type DocumentWriteTarget
} from '@/app/document/io/write'
import { IS_TAURI } from '@/constants'

export type DocumentSaveStatus = Readonly<{
  phase: 'idle' | 'saving' | 'saved' | 'failed'
  destination: 'file' | 'local-cache' | 'download'
  updatedAt: string | null
}>

const INITIAL_SAVE_STATUS: DocumentSaveStatus = {
  phase: 'idle',
  destination: 'file',
  updatedAt: null
}

type SaveDocumentState = EditorState & { documentName: string }

export type BuiltFigFile = Readonly<{
  data: Uint8Array
  sceneVersion: number
}>

type SaveActionsOptions = Omit<DocumentSourceAccess, 'getSavedVersion'> & {
  state: SaveDocumentState
  buildFigFile: () => BuiltFigFile | Promise<BuiltFigFile>
  startWatchingFile: () => void
  onWriteSuccess?: (version: number) => void | Promise<void>
  onDownloadSuccess?: (version: number) => void | Promise<void>
}

export function createSaveActions({
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
  startWatchingFile,
  onWriteSuccess,
  onDownloadSuccess
}: SaveActionsOptions) {
  const writeFile = createDocumentWriter()
  let saveQueue = Promise.resolve()
  let disposed = false
  let statusRevision = getSourceRevision()
  const status = shallowRef<DocumentSaveStatus>(INITIAL_SAVE_STATUS)

  function getSaveStatus(): DocumentSaveStatus {
    return statusRevision === getSourceRevision() ? status.value : INITIAL_SAVE_STATUS
  }

  function saved(destination: DocumentSaveStatus['destination']): void {
    statusRevision = getSourceRevision()
    status.value = { phase: 'saved', destination, updatedAt: new Date().toISOString() }
  }

  async function trackSave(revision: number, operation: () => Promise<boolean>): Promise<boolean> {
    if (!sourceIsUnchanged(revision)) return false
    const previous = getSaveStatus()
    statusRevision = revision
    status.value = { ...previous, phase: 'saving' }
    try {
      const result = await operation()
      if (!result && sourceIsUnchanged(revision)) status.value = previous
      return result && !disposed && statusRevision === getSourceRevision()
    } catch (error) {
      if (sourceIsUnchanged(revision)) status.value = { ...previous, phase: 'failed' }
      throw error
    }
  }

  function enqueueSave(operation: () => Promise<boolean>): Promise<boolean> {
    const result = saveQueue.then(operation, operation)
    saveQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  function getCurrentWriteTarget(): DocumentWriteTarget | null {
    const binding = getStorageBinding()
    if (binding) {
      return {
        kind: 'storage',
        binding: { ...binding },
        documentName: state.documentName
      }
    }
    const path = getFilePath()
    if (path && IS_TAURI) return { kind: 'tauri-path', path }
    const handle = getFileHandle()
    return handle ? { kind: 'browser-handle', handle } : null
  }

  function isCurrentWriteTarget(target: DocumentWriteTarget): boolean {
    if (target.kind === 'storage') {
      const binding = getStorageBinding()
      return (
        binding?.providerId === target.binding.providerId &&
        binding.profileId === target.binding.profileId &&
        binding.documentId === target.binding.documentId &&
        binding.authority?.accountId === target.binding.authority?.accountId &&
        binding.authority?.authorizationVersion === target.binding.authority?.authorizationVersion
      )
    }
    if (target.kind === 'tauri-path') {
      return getStorageBinding() === null && getFilePath() === target.path
    }
    return getStorageBinding() === null && getFileHandle() === target.handle
  }

  function sourceIsUnchanged(revision: number, target?: DocumentWriteTarget): boolean {
    return (
      !disposed &&
      getSourceRevision() === revision &&
      (target === undefined || isCurrentWriteTarget(target))
    )
  }

  async function notifyWriteSuccess(version: number): Promise<void> {
    setSavedVersion(version)
    try {
      await onWriteSuccess?.(version)
    } catch (error) {
      console.warn('[Recovery] Cleanup after document write failed:', error)
    }
  }

  async function notifyDownloadSuccess(version: number): Promise<void> {
    try {
      await onDownloadSuccess?.(version)
    } catch (error) {
      console.warn('[Recovery] Cleanup after document download failed:', error)
    }
  }

  async function saveFigFileNow(sourceRevision: number, options?: DocumentWriteOptions) {
    if (!sourceIsUnchanged(sourceRevision)) return false
    const target = getCurrentWriteTarget()
    const downloadName = getDownloadName()
    if (target) {
      const { data, sceneVersion } = await buildFigFile()
      if (!sourceIsUnchanged(sourceRevision, target)) return false
      setLastWriteTime(Date.now())
      await writeFile(target, data, options)
      if (!sourceIsUnchanged(sourceRevision, target)) return false
      setLastWriteTime(Date.now())
      saved(target.kind === 'storage' ? 'local-cache' : 'file')
      await notifyWriteSuccess(sceneVersion)
      if (!sourceIsUnchanged(sourceRevision, target)) return false
      if (target.kind === 'tauri-path') {
        setSourceIdentity({ handle: null, path: target.path })
      } else if (target.kind === 'browser-handle') {
        setSourceIdentity({ handle: target.handle, path: null })
      }
    } else if (downloadName) {
      const { data, sceneVersion } = await buildFigFile()
      if (!sourceIsUnchanged(sourceRevision)) return false
      downloadBlob(new Uint8Array(data), downloadName, 'application/octet-stream')
      saved('download')
      await notifyDownloadSuccess(sceneVersion)
    } else {
      return saveFigFileAsNow(sourceRevision)
    }
    return true
  }

  async function saveFigFileAsNow(sourceRevision: number) {
    if (!sourceIsUnchanged(sourceRevision)) return false

    if (IS_TAURI) {
      const path = await chooseTauriFigSavePath()
      if (!path || !sourceIsUnchanged(sourceRevision)) return false
      const built = await buildFigFile()
      if (!sourceIsUnchanged(sourceRevision)) return false
      await writeFile({ kind: 'tauri-path', path }, built.data)
      if (!sourceIsUnchanged(sourceRevision)) return false
      setStorageBinding(null)
      setFilePath(path)
      setFileHandle(null)
      state.documentName = documentNameFromFigPath(path)
      setSourceIdentity({ handle: null, path })
      markSourceChanged()
      setLastWriteTime(Date.now())
      saved('file')
      const savedSourceRevision = getSourceRevision()
      await notifyWriteSuccess(built.sceneVersion)
      if (!sourceIsUnchanged(savedSourceRevision)) return false
      startWatchingFile()
      return true
    }

    if (supportsFileSystemAccess()) {
      const handle = await chooseBrowserFigSaveHandle()
      if (!handle || !sourceIsUnchanged(sourceRevision)) return false
      const built = await buildFigFile()
      if (!sourceIsUnchanged(sourceRevision)) return false
      await writeFile({ kind: 'browser-handle', handle }, built.data)
      if (!sourceIsUnchanged(sourceRevision)) return false
      setStorageBinding(null)
      setFileHandle(handle)
      setFilePath(null)
      state.documentName = documentNameFromFigPath(handle.name)
      setSourceIdentity({ handle, path: null })
      markSourceChanged()
      setLastWriteTime(Date.now())
      saved('file')
      const savedSourceRevision = getSourceRevision()
      await notifyWriteSuccess(built.sceneVersion)
      if (!sourceIsUnchanged(savedSourceRevision)) return false
      startWatchingFile()
      return true
    }

    const filename = prompt(filesMessages.get().saveAsPrompt, getDownloadName() ?? 'Untitled.fig')
    if (!filename || !sourceIsUnchanged(sourceRevision)) return false
    const built = await buildFigFile()
    if (!sourceIsUnchanged(sourceRevision)) return false
    downloadBlob(new Uint8Array(built.data), filename, 'application/octet-stream')
    setStorageBinding(null)
    setFileHandle(null)
    setFilePath(null)
    setDownloadName(filename)
    state.documentName = documentNameFromFigPath(filename)
    setSourceIdentity({ handle: null, path: null })
    markSourceChanged()
    setLastWriteTime(0)
    saved('download')
    await notifyDownloadSuccess(built.sceneVersion)
    return true
  }

  function saveFigFile(options?: DocumentWriteOptions): Promise<boolean> {
    const sourceRevision = getSourceRevision()
    return enqueueSave(() =>
      trackSave(sourceRevision, () => saveFigFileNow(sourceRevision, options))
    )
  }

  function saveFigFileAs(): Promise<boolean> {
    const sourceRevision = getSourceRevision()
    return enqueueSave(() => trackSave(sourceRevision, () => saveFigFileAsNow(sourceRevision)))
  }

  return {
    saveFigFile,
    saveFigFileAs,
    getSaveStatus,
    disposeSaveActions: () => {
      disposed = true
    }
  }
}
