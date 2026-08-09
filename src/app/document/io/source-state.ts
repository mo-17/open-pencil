import type { DocumentSourceIdentity } from '@/app/document/io/types'
import {
  resolveStorageDocumentBinding,
  type StorageDocumentBinding,
  type StorageDocumentBindingInput
} from '@/app/integrations/storage/types'

export function createDocumentSourceState() {
  let fileHandle: FileSystemFileHandle | null = null
  let filePath: string | null = null
  let downloadName: string | null = null
  let sourceIdentity: DocumentSourceIdentity = { handle: null, path: null }
  let storageBinding: StorageDocumentBinding | null = null
  let sourceRevision = 0
  const sourceChangeListeners = new Set<() => void>()
  let savedVersion = 0
  let lastWriteTime = 0

  return {
    getFileHandle: () => fileHandle,
    setFileHandle: (handle: FileSystemFileHandle | null) => {
      fileHandle = handle
    },
    getFilePath: () => filePath,
    setFilePath: (path: string | null) => {
      filePath = path
    },
    getDownloadName: () => downloadName,
    setDownloadName: (name: string | null) => {
      downloadName = name
    },
    getSourceIdentity: () => sourceIdentity,
    setSourceIdentity: (identity: DocumentSourceIdentity) => {
      sourceIdentity = identity
    },
    getSourceRevision: () => sourceRevision,
    markSourceChanged: () => {
      sourceRevision++
      for (const listener of sourceChangeListeners) {
        try {
          listener()
        } catch (error) {
          console.warn('[Document source] Source change listener failed:', error)
        }
      }
    },
    onSourceChanged: (listener: () => void) => {
      sourceChangeListeners.add(listener)
      return () => sourceChangeListeners.delete(listener)
    },
    getStorageBinding: () => storageBinding,
    setStorageBinding: (binding: StorageDocumentBindingInput | null) => {
      storageBinding = binding ? resolveStorageDocumentBinding(binding) : null
    },
    getSavedVersion: () => savedVersion,
    setSavedVersion: (version: number) => {
      savedVersion = version
    },
    getLastWriteTime: () => lastWriteTime,
    setLastWriteTime: (time: number) => {
      lastWriteTime = time
    }
  }
}
