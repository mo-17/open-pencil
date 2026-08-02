import type { StorageDocumentBinding } from '@/app/integrations/storage/types'
import { persistStorageCanvasLocally } from '@/app/storage/sync/persist'
import { isTauri } from '@/app/tauri/env'

export type DocumentWriteTarget =
  | Readonly<{
      kind: 'storage'
      binding: StorageDocumentBinding
      documentName: string
    }>
  | Readonly<{ kind: 'tauri-path'; path: string }>
  | Readonly<{ kind: 'browser-handle'; handle: FileSystemFileHandle }>

export function createDocumentWriter() {
  return async function writeFile(target: DocumentWriteTarget, data: Uint8Array): Promise<void> {
    if (target.kind === 'storage') {
      await persistStorageCanvasLocally({
        providerId: target.binding.providerId,
        canvasId: target.binding.documentId,
        name: target.documentName || 'Untitled',
        figBytes: data
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
}
