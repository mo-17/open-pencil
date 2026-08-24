import { readFigFile, readFigSource } from '@open-pencil/core/io/formats/fig'

import { isTauri } from '@/app/tauri/env'

export type ReloadSourceOptions = {
  documentName: string
  filePath: string | null
  fileHandle: FileSystemFileHandle | null
}

export async function readReloadSource({ filePath, fileHandle }: ReloadSourceOptions) {
  if (filePath && isTauri()) {
    const { readFile: tauriRead, stat } = await import('@tauri-apps/plugin-fs')
    return readFigSource(
      { size: async () => (await stat(filePath)).size, read: () => tauriRead(filePath) },
      { populate: 'first-page' }
    )
  }

  if (fileHandle) {
    const file = await fileHandle.getFile()
    return readFigFile(file, { populate: 'first-page' })
  }

  return null
}
