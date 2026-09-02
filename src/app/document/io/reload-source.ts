import { readFigFile, readFigSource } from '@open-pencil/core/io/formats/fig'

import { isTauri } from '@/app/tauri/env'

export type ReloadSourceOptions = {
  documentName: string
  filePath: string | null
  fileHandle: FileSystemFileHandle | null
  signal?: AbortSignal
}

export async function readReloadSource({ filePath, fileHandle, signal }: ReloadSourceOptions) {
  signal?.throwIfAborted()
  if (filePath && isTauri()) {
    const { readFile: tauriRead, stat } = await import('@tauri-apps/plugin-fs')
    return readFigSource(
      {
        size: async () => {
          signal?.throwIfAborted()
          return (await stat(filePath)).size
        },
        read: async () => {
          signal?.throwIfAborted()
          const bytes = await tauriRead(filePath)
          signal?.throwIfAborted()
          return bytes
        }
      },
      { populate: 'first-page', signal }
    )
  }

  if (fileHandle) {
    const file = await fileHandle.getFile()
    signal?.throwIfAborted()
    return readFigFile(file, { populate: 'first-page', signal })
  }

  return null
}
