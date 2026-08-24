import type { EditorState } from '@open-pencil/core/editor'

import { describeDiagnosticError, recordDocumentFailure } from '@/app/diagnostics'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'
import type { StorageProfileMutationLease } from '@/app/storage/mutation-drain'
import { persistStorageCanvasLocally } from '@/app/storage/sync/persist'
import { isTauri } from '@/app/tauri/env'

type WriteDocumentState = EditorState & { documentName: string }

export type DocumentWriteTarget =
  | Readonly<{
      kind: 'storage'
      binding: StorageDocumentBinding
      documentName: string
    }>
  | Readonly<{ kind: 'tauri-path'; path: string }>
  | Readonly<{ kind: 'browser-handle'; handle: FileSystemFileHandle }>

export type DocumentWriteOptions = Readonly<{
  storageMutationLease?: StorageProfileMutationLease
}>

type DocumentWriterOptions = {
  state: WriteDocumentState
  getFilePath: () => string | null
  getFileHandle: () => FileSystemFileHandle | null
  getStorageBinding: () => StorageDocumentBinding | null
  setSavedVersion: (version: number) => void
  setLastWriteTime: (time: number) => void
  onWriteSuccess?: (version: number) => void | Promise<void>
}

type TargetDocumentWriter = (
  target: DocumentWriteTarget,
  data: Uint8Array,
  options?: DocumentWriteOptions
) => Promise<void>

type CurrentDocumentWriter = (data: Uint8Array, version?: number) => Promise<boolean>

function currentWriteTarget(options: DocumentWriterOptions): DocumentWriteTarget | null {
  const storage = options.getStorageBinding()
  if (storage) {
    return { kind: 'storage', binding: { ...storage }, documentName: options.state.documentName }
  }
  const path = options.getFilePath()
  if (path && isTauri()) return { kind: 'tauri-path', path }
  const handle = options.getFileHandle()
  return handle ? { kind: 'browser-handle', handle } : null
}

async function writeDocumentTarget(
  target: DocumentWriteTarget,
  data: Uint8Array,
  options?: DocumentWriteOptions
): Promise<void> {
  if (target.kind === 'storage') {
    await persistStorageCanvasLocally({
      providerId: target.binding.providerId,
      profileId: target.binding.profileId,
      ...(target.binding.authority ? { authority: target.binding.authority } : {}),
      canvasId: target.binding.documentId,
      name: target.documentName || 'Untitled',
      figBytes: data,
      mutationLease: options?.storageMutationLease
    })
    return
  }

  if (target.kind === 'tauri-path') {
    if (!isTauri()) throw new Error('Cannot write a Tauri path outside the Tauri runtime')
    const { writeFile: tauriWrite } = await import('@tauri-apps/plugin-fs')
    await tauriWrite(target.path, data)
    return
  }

  const writable = await target.handle.createWritable()
  await writable.write(new Uint8Array(data))
  await writable.close()
}

export function createDocumentWriter(): TargetDocumentWriter
export function createDocumentWriter(options: DocumentWriterOptions): CurrentDocumentWriter
export function createDocumentWriter(
  options?: DocumentWriterOptions
): TargetDocumentWriter | CurrentDocumentWriter {
  if (!options) return writeDocumentTarget

  const { state, setSavedVersion, setLastWriteTime, onWriteSuccess } = options

  return async (data: Uint8Array, version?: number): Promise<boolean> => {
    const target = currentWriteTarget(options)
    if (!target) return false
    const savedVersion = version ?? state.sceneVersion

    setLastWriteTime(Date.now())
    try {
      await writeDocumentTarget(target, data)
      setSavedVersion(savedVersion)
      try {
        await onWriteSuccess?.(savedVersion)
      } catch (error) {
        console.warn('[Recovery] Cleanup after document write failed:', error)
      }
      return true
    } catch (error) {
      recordDocumentFailure({
        operation: 'save',
        format: 'fig',
        ...describeDiagnosticError(error)
      })
      throw error
    }
  }
}
