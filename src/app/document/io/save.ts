import type { EditorState } from '@open-pencil/core/editor'

import { downloadBlob } from '@/app/document/io/browser'
import { documentNameFromFigPath } from '@/app/document/io/names'
import { chooseBrowserFigSaveHandle, chooseTauriFigSavePath } from '@/app/document/io/save-targets'
import type { DocumentSourceAccess } from '@/app/document/io/types'
import { createDocumentWriter, type DocumentWriteTarget } from '@/app/document/io/write'
import { IS_TAURI } from '@/constants'

type SaveDocumentState = EditorState & { documentName: string }

export type BuiltFigFile = Readonly<{
  data: Uint8Array
  sceneVersion: number
}>

type SaveActionsOptions = Omit<DocumentSourceAccess, 'getSavedVersion'> & {
  state: SaveDocumentState
  buildFigFile: () => BuiltFigFile | Promise<BuiltFigFile>
  startWatchingFile: () => void
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
  startWatchingFile
}: SaveActionsOptions) {
  const writeFile = createDocumentWriter()
  let saveQueue = Promise.resolve()

  function enqueueSave(operation: () => Promise<void>): Promise<void> {
    const result = saveQueue.then(operation, operation)
    saveQueue = result.catch(() => undefined)
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
        binding.documentId === target.binding.documentId
      )
    }
    if (target.kind === 'tauri-path') {
      return getStorageBinding() === null && getFilePath() === target.path
    }
    return getStorageBinding() === null && getFileHandle() === target.handle
  }

  function sourceIsUnchanged(revision: number, target?: DocumentWriteTarget): boolean {
    return (
      getSourceRevision() === revision && (target === undefined || isCurrentWriteTarget(target))
    )
  }

  async function saveFigFileNow(sourceRevision: number) {
    if (!sourceIsUnchanged(sourceRevision)) return
    const target = getCurrentWriteTarget()
    const downloadName = getDownloadName()
    if (target) {
      const { data, sceneVersion } = await buildFigFile()
      if (!sourceIsUnchanged(sourceRevision, target)) return
      setLastWriteTime(Date.now())
      await writeFile(target, data)
      if (!sourceIsUnchanged(sourceRevision, target)) return
      setLastWriteTime(Date.now())
      setSavedVersion(sceneVersion)
      if (target.kind === 'tauri-path') {
        setSourceIdentity({ handle: null, path: target.path })
      } else if (target.kind === 'browser-handle') {
        setSourceIdentity({ handle: target.handle, path: null })
      }
    } else if (downloadName) {
      const { data } = await buildFigFile()
      if (!sourceIsUnchanged(sourceRevision)) return
      downloadBlob(new Uint8Array(data), downloadName, 'application/octet-stream')
    } else {
      await saveFigFileAsNow(sourceRevision)
    }
  }

  async function saveFigFileAsNow(sourceRevision: number) {
    if (!sourceIsUnchanged(sourceRevision)) return

    if (IS_TAURI) {
      const path = await chooseTauriFigSavePath()
      if (!path || !sourceIsUnchanged(sourceRevision)) return
      const built = await buildFigFile()
      if (!sourceIsUnchanged(sourceRevision)) return
      await writeFile({ kind: 'tauri-path', path }, built.data)
      if (!sourceIsUnchanged(sourceRevision)) return
      setStorageBinding(null)
      setFilePath(path)
      setFileHandle(null)
      state.documentName = documentNameFromFigPath(path)
      setSourceIdentity({ handle: null, path })
      markSourceChanged()
      setLastWriteTime(Date.now())
      setSavedVersion(built.sceneVersion)
      startWatchingFile()
      return
    }

    if (window.showSaveFilePicker) {
      const handle = await chooseBrowserFigSaveHandle()
      if (!handle || !sourceIsUnchanged(sourceRevision)) return
      const built = await buildFigFile()
      if (!sourceIsUnchanged(sourceRevision)) return
      await writeFile({ kind: 'browser-handle', handle }, built.data)
      if (!sourceIsUnchanged(sourceRevision)) return
      setStorageBinding(null)
      setFileHandle(handle)
      setFilePath(null)
      state.documentName = documentNameFromFigPath(handle.name)
      setSourceIdentity({ handle, path: null })
      markSourceChanged()
      setLastWriteTime(Date.now())
      setSavedVersion(built.sceneVersion)
      startWatchingFile()
      return
    }

    const filename = prompt('Save as:', getDownloadName() ?? 'Untitled.fig')
    if (!filename || !sourceIsUnchanged(sourceRevision)) return
    const built = await buildFigFile()
    if (!sourceIsUnchanged(sourceRevision)) return
    downloadBlob(new Uint8Array(built.data), filename, 'application/octet-stream')
    setStorageBinding(null)
    setFileHandle(null)
    setFilePath(null)
    setDownloadName(filename)
    state.documentName = documentNameFromFigPath(filename)
    setSourceIdentity({ handle: null, path: null })
    markSourceChanged()
    setLastWriteTime(0)
  }

  function saveFigFile(): Promise<void> {
    const sourceRevision = getSourceRevision()
    return enqueueSave(() => saveFigFileNow(sourceRevision))
  }

  function saveFigFileAs(): Promise<void> {
    const sourceRevision = getSourceRevision()
    return enqueueSave(() => saveFigFileAsNow(sourceRevision))
  }

  return { saveFigFile, saveFigFileAs }
}
